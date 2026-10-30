import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {migrateLegacyData,preferredUserData,installIdentity,readInstall,recordInstall,savedData,setDataAside} from '../desktop/storage.mjs';

test('the macOS installer is valid POSIX shell and verifies checksums before installing',()=>{const script=new URL('../install.sh',import.meta.url);const check=spawnSync('sh',['-n',script.pathname],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);const source=fs.readFileSync(script,'utf8');assert.ok(source.indexOf('SHA256SUMS.txt')<source.indexOf('mv "$tmp/app/Throughline.app"'),'The checksum is checked before anything is moved into place.');});

test('desktop migration copies history reversibly and is idempotent',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-migration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const legacy=path.join(root,'legacy'),dest=path.join(root,'data');fs.mkdirSync(path.join(legacy,'p'),{recursive:true});fs.writeFileSync(path.join(legacy,'projects.json'),'{"version":1,"projects":[]}');fs.writeFileSync(path.join(legacy,'p','history.jsonl'),'user history\n');fs.writeFileSync(path.join(legacy,'p','server.lock'),JSON.stringify({pid:2147483647}));const result=migrateLegacyData(legacy,dest);assert.equal(result.migrated,true);assert.equal(fs.readFileSync(path.join(legacy,'p','history.jsonl'),'utf8'),'user history\n');assert.equal(fs.readFileSync(path.join(dest,'p','history.jsonl'),'utf8'),'user history\n');assert.equal(fs.existsSync(path.join(dest,'p','server.lock')),false);assert.equal(migrateLegacyData(legacy,dest).migrated,false);});
test('desktop migration refuses a live old server rather than copying active journals',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-migration-lock-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const legacy=path.join(root,'legacy');fs.mkdirSync(path.join(legacy,'p'),{recursive:true});fs.writeFileSync(path.join(legacy,'projects.json'),'{}');fs.writeFileSync(path.join(legacy,'p','server.lock'),JSON.stringify({pid:process.pid}));assert.throws(()=>migrateLegacyData(legacy,path.join(root,'new')),/Close the existing/);assert.equal(fs.existsSync(path.join(root,'new')),false);});


test('migration rejects numeric live legacy locks and unfinished guards without partial data',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-migration-guards-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const legacy=path.join(root,'legacy');fs.mkdirSync(path.join(legacy,'p'),{recursive:true});fs.writeFileSync(path.join(legacy,'projects.json'),'{}');const lock=path.join(legacy,'p','server.lock');fs.writeFileSync(lock,String(process.pid));assert.throws(()=>migrateLegacyData(legacy,path.join(root,'new')),/Close the existing/);fs.unlinkSync(lock);fs.mkdirSync(path.join(legacy,'projects.json.guard'));assert.throws(()=>migrateLegacyData(legacy,path.join(root,'new')),/unfinished operation guard/);assert.equal(fs.existsSync(path.join(root,'new')),false);assert.ok(fs.existsSync(path.join(legacy,'projects.json')));
});

test('existing installations keep their pre-rename data folder even after Electron creates the new one',t=>{
  const appData=fs.mkdtempSync(path.join(os.tmpdir(),'relay-appdata-'));t.after(()=>fs.rmSync(appData,{recursive:true,force:true}));
  const current=path.join(appData,'Throughline'),legacy=path.join(appData,'AI Relay');fs.mkdirSync(current);
  assert.equal(preferredUserData(appData,current),current,'New installations use the Throughline folder.');
  fs.mkdirSync(path.join(legacy,'relay-data'),{recursive:true});assert.equal(preferredUserData(appData,current),current,'An empty legacy folder is ignored.');
  fs.writeFileSync(path.join(legacy,'relay-data','projects.json'),'{}');fs.mkdirSync(path.join(current,'relay-data'));
  assert.equal(preferredUserData(appData,current),legacy,'Saved workspaces in the legacy folder win over a freshly created default.');
});

test('a new install finds saved workspaces, and starting fresh keeps them as a backup',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-install-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data=path.join(root,'relay-data');assert.deepEqual(savedData(data),{workspaces:0,lastUsed:null});
  fs.mkdirSync(path.join(data,'p1'),{recursive:true});fs.writeFileSync(path.join(data,'projects.json'),JSON.stringify({version:2,projects:[{id:'p1'},{id:'p2',removedAt:'2026-10-01T00:00:00.000Z'}]}));fs.writeFileSync(path.join(data,'p1','chat.jsonl'),'history\n');
  const later=new Date('2030-01-01T00:00:00.000Z');fs.utimesSync(path.join(data,'p1','chat.jsonl'),later,later);
  const found=savedData(data);assert.equal(found.workspaces,1,'Removed workspaces are not counted.');assert.equal(found.lastUsed,later.toISOString(),'The newest conversation file sets the last-used date.');
  const backup=setDataAside(data,new Date('2026-10-30T12:00:00.000Z'));assert.equal(path.basename(backup),'relay-data-backup-2026-10-30T12-00-00-000Z');
  assert.equal(fs.existsSync(data),false);assert.equal(fs.readFileSync(path.join(backup,'p1','chat.jsonl'),'utf8'),'history\n','Starting fresh moves the data aside instead of deleting it.');
  const marker=path.join(root,'install.json');assert.equal(readInstall(marker),null);recordInstall(marker,'1730000000000');assert.equal(readInstall(marker),'1730000000000');
  const executable=path.join(root,'Throughline.app','Contents','MacOS','Throughline');fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(executable,'');
  assert.equal(installIdentity(executable),installIdentity(path.join(root,'Throughline.app')),'The app bundle, not the executable inside it, identifies an install.');
  fs.cpSync(path.join(root,'Throughline.app'),path.join(root,'Reinstalled.app'),{recursive:true});assert.notEqual(installIdentity(path.join(root,'Reinstalled.app')),installIdentity(executable),'A newly written copy counts as a new install.');
  const moved=path.join(root,'Moved.app'),before=installIdentity(executable);fs.renameSync(path.join(root,'Throughline.app'),moved);assert.equal(installIdentity(moved),before,'Moving the app is not a reinstall.');
  assert.equal(installIdentity('/private/var/folders/x/AppTranslocation/ABC/d/Throughline.app/Contents/MacOS/Throughline'),null);
});
