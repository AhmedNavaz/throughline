import {app,BrowserWindow,Menu,dialog,ipcMain,nativeTheme,shell,powerSaveBlocker} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createRelayServer} from '../server.mjs';
import {migrateLegacyData,preferredUserData,installIdentity,readInstall,recordInstall,savedData,setDataAside} from './storage.mjs';
import {createKeepAwake} from './keep-awake.mjs';
import {createAppearance} from './appearance.mjs';
import {menuTemplate,menuState} from './menu.mjs';
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
    const appearance=createAppearance({nativeTheme,onBackground:color=>{if(win&&!win.isDestroyed())win.setBackgroundColor(color);}});
    // The menu bar shows what the page last reported, the saved appearance and Keep Awake.
    let page=null,awake=false;
    const updateMenu=()=>Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({platform:process.platform,packaged:app.isPackaged,version:app.getVersion(),osVersion:process.getSystemVersion(),arch:process.arch,state:page,appearance:relay.getAppearancePreference(),keepAwake:awake,open:url=>shell.openExternal(url),
      // A clicked checkbox or radio item ticks itself, so the menu is rebuilt to show the page's answer instead.
      send:(...command)=>{if(win&&!win.isDestroyed())win.webContents.send('relay:menu-command',...command);updateMenu();}})));
    app.setAboutPanelOptions({applicationName:'Throughline',applicationVersion:app.getVersion(),version:''});
    async function start(){
      relay=createRelayServer({dataRoot:data,accessToken:token,onAppearance:preference=>{appearance.set(preference);updateMenu();}});
      appearance.set(relay.getAppearancePreference());
      keepAwake=createKeepAwake({registry:relay.registry,blocker:powerSaveBlocker,enabled:relay.getKeepAwakePreference(),save:relay.setKeepAwakePreference,onChange:state=>{awake=state.enabled;if(win&&!win.isDestroyed())win.webContents.send('relay:keep-awake-changed',state);updateMenu();}});
      await new Promise((resolve,reject)=>{relay.server.once('error',reject);relay.server.listen(0,'127.0.0.1',resolve);});
      origin=`http://127.0.0.1:${relay.server.address().port}`;
    }
    await start();
    win=new BrowserWindow({width:1440,height:1000,minWidth:900,minHeight:680,show:false,title:'Throughline',icon:path.join(root,'assets','icon.png'),backgroundColor:appearance.background(),...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:13}}:{}),webPreferences:{preload:path.join(root,'desktop','preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,additionalArguments:[`--relay-token=${token}`]}});
    if(!smoke) win.once('ready-to-show',()=>win.show());
    const trusted=event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && event.senderFrame.url.startsWith(origin+'/');
    ipcMain.handle('relay:keep-awake:get',event=>{if(!trusted(event))throw Error('Untrusted renderer');return keepAwake.getState();});
    ipcMain.handle('relay:keep-awake:set',(event,enabled)=>{if(!trusted(event))throw Error('Untrusted renderer');return keepAwake.setEnabled(enabled);});
    ipcMain.handle('relay:launch',event=>{if(!trusted(event))throw Error('Untrusted renderer');return launch;});
    ipcMain.on('relay:menu-state',(event,input)=>{if(!trusted(event))return;const next=menuState(input);if(next){page=next;updateMenu();}});
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
      // The menu bar is Throughline's. The page reports its state to it, and an item's command reaches the page and comes back as a tick.
      const settled=async done=>{for(let tries=0;!done()&&tries<250;tries++)await new Promise(resolve=>setTimeout(resolve,20));return done();};
      const reported=await settled(()=>page!==null);
      Menu.getApplicationMenu().getMenuItemById('appearance-light').click();
      const ticked=await settled(()=>nativeTheme.themeSource==='light'&&Menu.getApplicationMenu().getMenuItemById('appearance-light').checked);
      result.menu={labels:Menu.getApplicationMenu().items.map(item=>item.label),reported,ticked,theme:await win.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`)};
      // The setup header lies under the window-drag strip; each of its controls must still be what a click at its center reaches.
      result.setupHeader=await win.webContents.executeJavaScript(`window.relaySetup.open().then(()=>{const controls=[...document.querySelectorAll('.onboarding-header :is(button,a)')];return controls.length>0&&controls.every(control=>{const box=control.getBoundingClientRect();return control.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));});})`);
      if(!result.isolated||!result.bridge||!result.launchBridge||!result.keepAwakeBridge||!result.usagePopover||!result.ui||!result.configuration||!result.models||!result.git||!result.imports||!result.setupHeader||!['File','Edit','View','Agent','Workspace','Window','Help'].every(label=>result.menu.labels.includes(label))||!result.menu.reported||!result.menu.ticked||result.menu.theme!=='light')throw Error('Desktop smoke check failed: '+JSON.stringify(result));
      console.log('AI_RELAY_DESKTOP_SMOKE '+JSON.stringify(result));app.quit();
    }
  }).catch(error=>{console.error(error);if(!smoke)dialog.showErrorBox('Throughline could not start',error.message);app.exit(1);});
}
