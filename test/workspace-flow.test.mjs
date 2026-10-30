import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {ProjectRegistry} from '../projects.mjs';
import {CollaborationService} from '../collaboration.mjs';
import {createRelayServer} from '../server.mjs';
import {sealSolution} from '../collaboration-format.mjs';

function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-workspace-flow-')),dataRoot=path.join(root,'data'),paths={};for(const name of ['frontend','backend','friend-ui','friend-api']){paths[name]=path.join(root,name);fs.mkdirSync(paths[name]);}
 const registry=new ProjectRegistry({dataRoot,bins:{codex:'/not-installed/codex',claude:'/not-installed/claude'}});let modelCalls=0;const original=registry.broker.bind(registry);registry.broker=id=>{const b=original(id);b.start=()=>{modelCalls++;throw Error('No model calls in workspace collaboration');};return b;};const service=new CollaborationService({registry,dataRoot});
 t.after(async()=>{await registry.close();assert.equal(modelCalls,0);fs.rmSync(root,{recursive:true,force:true});});return {root,paths,registry,service};
}
function solution(handoff,files){return sealSolution({schema:'ai-relay.solution',version:1,id:randomUUID(),handoffId:handoff.id,createdAt:new Date().toISOString(),explanation:'Changes in the selected workspace folders.',assumptions:[],verification:[],patch:{format:'ai-relay.text.v1',files}});}
async function approve(e,p,input){const c=e.registry.mainConversation(p.id),preview=e.service.prepare(p.id,c.id,input);return e.service.approve(p.id,c.id,{package:preview.package,approvedIntegrity:preview.package.integrity});}

test('multi-folder handoff maps friend roots deliberately, applies each file once, verifies and recovers without inference',async t=>{
 const e=setup(t),p=e.registry.add({name:'One workspace',folders:[e.paths.frontend,e.paths.backend]}),friend=e.registry.add({folders:[e.paths['friend-ui'],e.paths['friend-api']]});
 fs.writeFileSync(path.join(e.paths.frontend,'app.js'),'export const ui = 1;\n');fs.writeFileSync(path.join(e.paths.backend,'app.js'),'export const api = 1;\n');
 const handoff=await approve(e,p,{mode:'source',files:['frontend/app.js','backend/app.js'],newPaths:['frontend/lib/new.js'],goal:'Update both components'});
 assert.deepEqual(handoff.package.folderLayout,{style:'namespaced',folders:['frontend','backend']});assert.equal(JSON.stringify(handoff.package).includes(e.root),false);
 const folders=friend.folders,folderMapping={frontend:folders[0].id,backend:folders[1].id};
 const imported=await e.service.importRequest(friend.id,handoff.package,{folderMapping});const main=e.registry.mainConversation(friend.id);assert.equal(imported.conversationId,main.id);
 assert.equal((await e.service.importRequest(friend.id,handoff.package,{folderMapping})).conversationId,main.id);assert.equal(e.registry.broker(friend.id).conversations.size,1);
 await assert.rejects(e.service.importRequest(friend.id,{...handoff.package},{folderMapping:{frontend:folders[0].id,backend:folders[0].id}}),/different local folder/);
 fs.writeFileSync(path.join(e.paths['friend-ui'],'app.js'),'export const ui = 2;\n');fs.mkdirSync(path.join(e.paths['friend-ui'],'lib'));fs.writeFileSync(path.join(e.paths['friend-ui'],'lib/new.js'),'export const created = true;\n');fs.writeFileSync(path.join(e.paths['friend-api'],'app.js'),'export const api = 2;\n');
 const returned=e.service.buildSolution(friend.id,handoff.id,{files:['frontend/app.js','backend/app.js','frontend/lib/new.js'],explanation:'A two-folder update.'});e.service.receiveSolution(p.id,returned);
 assert.equal(e.service.previewSolution(p.id,returned.id).status,'applicable');await e.service.applySolution(p.id,returned.id,{approvedIntegrity:returned.integrity});
 assert.match(fs.readFileSync(path.join(e.paths.frontend,'app.js'),'utf8'),/ui = 2/);assert.match(fs.readFileSync(path.join(e.paths.backend,'app.js'),'utf8'),/api = 2/);assert.equal(fs.existsSync(path.join(e.paths.frontend,'frontend')),false);assert.ok(fs.existsSync(path.join(e.paths.frontend,'lib/new.js')));
 assert.equal((await e.service.verify(p.id,returned.id,{argv:['node','--check','backend/app.js'],reviewed:true})).passed,true);
 await e.service.applySolution(p.id,returned.id,{approvedIntegrity:returned.integrity});await e.service.recoverApplication(p.id,returned.id);
 assert.match(fs.readFileSync(path.join(e.paths.frontend,'app.js'),'utf8'),/ui = 1/);assert.match(fs.readFileSync(path.join(e.paths.backend,'app.js'),'utf8'),/api = 1/);assert.equal(fs.existsSync(path.join(e.paths.frontend,'lib/new.js')),false);assert.equal(e.registry.broker(p.id).conversations.size,1);
});

test('folder changes cannot retarget an unapproved preview to identical content under a new primary',async t=>{
 const e=setup(t),p=e.registry.add({path:e.paths.frontend}),c=e.registry.mainConversation(p.id);for(const key of ['frontend','backend'])fs.writeFileSync(path.join(e.paths[key],'same.txt'),'same content\n');
 const preview=e.service.prepare(p.id,c.id,{mode:'source',files:['same.txt']});e.registry.addFolder(p.id,{path:e.paths.backend});e.registry.removeFolder(p.id,p.folders[0].id);
 await assert.rejects(e.service.approve(p.id,c.id,{package:preview.package,approvedIntegrity:preview.package.integrity}),/Workspace folders changed/);assert.equal(e.registry.mainConversation(p.id).id,c.id);assert.equal(e.service.listHandoffs(p.id).length,0);
});

test('legacy approved handoffs keep original target after primary removal and resume safely after reattachment',async t=>{
 const e=setup(t),p=e.registry.add({path:e.paths.frontend}),c=e.registry.mainConversation(p.id);for(const key of ['frontend','backend'])fs.writeFileSync(path.join(e.paths[key],'same.txt'),'same content\n');
 const h=await approve(e,p,{mode:'source',files:['same.txt']});delete h.workspace;e.service.save(p.id,'handoffs',h);const returned=solution(h,[{path:'same.txt',baseHash:h.package.baseline[0].sha256,content:'friend change\n'}]);e.service.receiveSolution(p.id,returned);
 e.registry.addFolder(p.id,{path:e.paths.backend});assert.equal(e.service.getHandoff(p.id,h.id).workspace.path,fs.realpathSync(e.paths.frontend));e.registry.removeFolder(p.id,p.folders[0].id);
 assert.equal(e.service.previewSolution(p.id,returned.id).status,'stale');await assert.rejects(e.service.applySolution(p.id,returned.id,{approvedIntegrity:returned.integrity}),/stale/);assert.equal(fs.readFileSync(path.join(e.paths.backend,'same.txt'),'utf8'),'same content\n');
 e.registry.addFolder(p.id,{path:e.paths.frontend});await e.service.applySolution(p.id,returned.id,{approvedIntegrity:returned.integrity});assert.equal(fs.readFileSync(path.join(e.paths.frontend,'same.txt'),'utf8'),'friend change\n');assert.equal(fs.readFileSync(path.join(e.paths.backend,'same.txt'),'utf8'),'same content\n');assert.equal(e.registry.mainConversation(p.id).id,c.id);
});

test('HTTP project folder membership and repeated open/create keep a single saved chat',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-workspace-http-'));const a=path.join(root,'a'),b=path.join(root,'b');fs.mkdirSync(a);fs.mkdirSync(b);const app=createRelayServer({dataRoot:path.join(root,'private'),bins:{codex:'/missing/codex',claude:'/missing/claude'}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
 async function api(route,value){const r=await fetch(base+route,{method:value?'POST':'GET',headers:{'X-AI-Relay':'1',...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{})});assert.ok(r.ok,await r.clone().text());return r.json();}
 const project=await api('/api/projects',{name:'Workspace',folders:[a,b]}),scope='?projectId='+project.id;const c=await api('/api/conversation'+scope);const repeated=await api('/api/conversations'+scope,{});assert.equal(repeated.id,c.id);assert.equal((await api('/api/conversations'+scope)).length,1);
 await api('/api/conversations/'+c.id+'/context'+scope,{goal:'Preserve this workspace conversation'});const reduced=await api('/api/projects/'+project.id+'/folders/'+project.folders[0].id+'/remove',{});assert.equal(reduced.folders.length,1);assert.equal(reduced.path,fs.realpathSync(b));const current=await api('/api/conversation'+scope);assert.equal(current.id,c.id);assert.equal(current.context.goal,'Preserve this workspace conversation');assert.equal(app.registry.broker(project.id).conversations.size,1);
});
