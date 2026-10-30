import {app,BrowserWindow,dialog,ipcMain,shell,powerSaveBlocker} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRelayServer} from '../server.mjs';
import {migrateLegacyData,preferredUserData,installIdentity,readInstall,recordInstall,savedData,setDataAside} from './storage.mjs';
import {createKeepAwake} from './keep-awake.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const smoke=process.argv.includes('--smoke-test');
if(process.env.AI_RELAY_DESKTOP_DATA) app.setPath('userData',path.resolve(process.env.AI_RELAY_DESKTOP_DATA));
else app.setPath('userData',preferredUserData(app.getPath('appData'),app.getPath('userData')));
const primary=app.requestSingleInstanceLock();
let relay,win,origin,keepAwake,quitting=false;
if(!primary) app.quit();
else {
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
  app.on('before-quit',event=>{if(relay&&!quitting){event.preventDefault();quitting=true;keepAwake?.dispose();relay.close().finally(()=>app.quit());}});
  app.on('will-quit',()=>keepAwake?.dispose());
  app.on('window-all-closed',()=>app.quit());
  app.whenReady().then(async()=>{
    if(process.platform==='darwin'&&!app.isPackaged) app.dock?.setIcon(path.join(root,'assets','icon.png'));
    const data=path.join(app.getPath('userData'),'relay-data');
    migrateLegacyData(process.env.AI_RELAY_LEGACY_DATA_DIR || path.join(root,'.data'),data);
    // A newly installed copy that finds saved workspaces asks whether to continue with them or start fresh.
    // AI_RELAY_INSTALL_ID stands in for the bundle identity when testing this from a checkout.
    const installFile=path.join(app.getPath('userData'),'install.json'), install=process.env.AI_RELAY_INSTALL_ID || (app.isPackaged?installIdentity(app.getPath('exe')):null);
    let launch={choice:false,...savedData(data)};
    if(install&&readInstall(installFile)!==install){if(launch.workspaces)launch.choice=true;else recordInstall(installFile,install);}
    const token=randomBytes(32).toString('hex');
    async function start(){
      relay=createRelayServer({dataRoot:data,accessToken:token});
      keepAwake=createKeepAwake({registry:relay.registry,blocker:powerSaveBlocker,enabled:relay.getKeepAwakePreference(),save:relay.setKeepAwakePreference,onChange:state=>{if(win&&!win.isDestroyed())win.webContents.send('relay:keep-awake-changed',state);}});
      await new Promise((resolve,reject)=>{relay.server.once('error',reject);relay.server.listen(0,'127.0.0.1',resolve);});
      origin=`http://127.0.0.1:${relay.server.address().port}`;
    }
    await start();
    win=new BrowserWindow({width:1440,height:1000,minWidth:900,minHeight:680,show:false,title:'Throughline',icon:path.join(root,'assets','icon.png'),backgroundColor:'#1f1f1f',...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:13}}:{}),webPreferences:{preload:path.join(root,'desktop','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,additionalArguments:[`--relay-token=${token}`]}});
    if(!smoke) win.once('ready-to-show',()=>win.show());
    const trusted=event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && event.senderFrame.url.startsWith(origin+'/');
    ipcMain.handle('relay:keep-awake:get',event=>{if(!trusted(event))throw Error('Untrusted renderer');return keepAwake.getState();});
    ipcMain.handle('relay:keep-awake:set',(event,enabled)=>{if(!trusted(event))throw Error('Untrusted renderer');return keepAwake.setEnabled(enabled);});
    ipcMain.handle('relay:launch',event=>{if(!trusted(event))throw Error('Untrusted renderer');return launch;});
    ipcMain.handle('relay:choose-data',async(event,choice)=>{
      if(!trusted(event))throw Error('Untrusted renderer');
      if(!['continue','fresh'].includes(choice))throw Error('Choose to continue or start fresh.');
      if(!launch.choice)return launch;
      if(choice==='fresh'){
        keepAwake.dispose();await relay.close({force:true});setDataAside(data);
        await win.webContents.session.clearStorageData({storages:['localstorage']});
        await start();
      }
      recordInstall(installFile,install);launch={choice:false,...savedData(data)};
      if(choice==='fresh')win.loadURL(origin);
      return launch;
    });
    ipcMain.handle('relay:pick-folder',async event=>{if(!trusted(event))throw Error('Untrusted renderer');const choice=await dialog.showOpenDialog(win,{properties:['openDirectory']});return choice.canceled?null:choice.filePaths[0];});
    ipcMain.handle('relay:open-external',async(event,input)=>{if(!trusted(event))throw Error('Untrusted renderer');const url=new URL(input);if(url.username||url.password||(url.protocol!=='https:' && !(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw Error('Only HTTPS or local test links without credentials may open');await shell.openExternal(url.href);return true;});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/'))event.preventDefault();});
    // Only clipboard writes (Copy buttons) are granted; every other permission stays denied.
    win.webContents.session.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'));
    await win.loadURL(origin);
    if(smoke){
      const blockerId=powerSaveBlocker.start('prevent-display-sleep');
      const nativeAwake=powerSaveBlocker.isStarted(blockerId);powerSaveBlocker.stop(blockerId);
      if(!nativeAwake||powerSaveBlocker.isStarted(blockerId))throw Error('Native display sleep blocker check failed.');
      const result=await win.webContents.executeJavaScript(`({title:document.title,isolated:typeof require==='undefined',bridge:typeof window.relayDesktop?.pickFolder==='function',launchBridge:typeof window.relayDesktop?.getLaunchState==='function'&&typeof window.relayDesktop?.chooseData==='function',keepAwakeBridge:typeof window.relayDesktop?.getKeepAwake==='function'&&typeof window.relayDesktop?.setKeepAwake==='function'&&typeof window.relayDesktop?.onKeepAwakeChanged==='function',usagePopover:typeof document.getElementById('usage-dialog')?.showPopover==='function',ui:!!document.getElementById('ask-friend'),configuration:typeof window.relayUI?.setConfiguration==='function',models:!!document.getElementById('model-select'),git:!!document.getElementById('open-git'),imports:!!document.getElementById('import-dialog')})`);
      result.nativeAwake=nativeAwake;
      if(!result.isolated||!result.bridge||!result.launchBridge||!result.keepAwakeBridge||!result.usagePopover||!result.ui||!result.configuration||!result.models||!result.git||!result.imports)throw Error('Desktop smoke check failed: '+JSON.stringify(result));
      console.log('AI_RELAY_DESKTOP_SMOKE '+JSON.stringify(result));app.quit();
    }
  }).catch(error=>{console.error(error);if(!smoke)dialog.showErrorBox('Throughline could not start',error.message);app.exit(1);});
}
