import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateLegacyData,preferredUserData} from '../desktop/storage.mjs';

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
