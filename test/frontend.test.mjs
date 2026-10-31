import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { sealPackage } from '../collaboration-format.mjs';
import { preferencePatch, publicPreferences } from '../preferences.mjs';

// Minimal DOM/event adapter for executing the actual browser scripts. It does
// not pretend to verify layout, CSS, native dialogs, or browser accessibility.
class Events {
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
  dispatchEvent(event){event.target ||= this;for(const fn of this.listeners.get(event.type)||[])fn(event);return !event.defaultPrevented;}
}
class UIEvent {
  constructor(type,properties={}){this.type=type;this.defaultPrevented=false;Object.assign(this,properties);}
  preventDefault(){this.defaultPrevented=true;}
}
class Element extends Events {
  constructor(tag,document){super();this.tagName=tag.toUpperCase();this.document=document;this.childNodes=[];this.parentNode=null;this.attributes={};this.dataset={};this.style={};this.className='';this.id='';this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.open=false;this.scrollTop=0;this.scrollHeight=100;this.clientHeight=500;this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false),toggle:(name,on)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));if(on===undefined)on=!set.has(name);if(on)set.add(name);else set.delete(name);this.className=[...set].join(' ');return on;}};}
  get nodeType(){return this.tagName==='#TEXT'?3:1;}
  get children(){return this.childNodes.filter(child=>child.tagName!=='#TEXT');}
  get firstChild(){return this.childNodes[0]||null;}get lastChild(){return this.childNodes.at(-1)||null;}get firstElementChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}
  get textContent(){return this.tagName==='#TEXT'?this.data:this.childNodes.map(child=>child.textContent).join('');}
  set textContent(value){if(this.tagName==='#TEXT')this.data=String(value);else this.replaceChildren(this.document.createTextNode(String(value)));}
  set innerHTML(_){throw new Error('Untrusted innerHTML is forbidden by this test DOM.');}
  append(...nodes){for(let child of nodes){if(typeof child==='string')child=this.document.createTextNode(child);if(child.tagName==='#FRAGMENT'){this.append(...[...child.childNodes]);continue;}child.remove();child.parentNode=this;this.childNodes.push(child);if(this.tagName==='SELECT'&&child.tagName==='OPTION'&&!this.value)this.value=child.value||child.textContent;}}
  prepend(child){child.remove();child.parentNode=this;this.childNodes.unshift(child);}
  replaceChildren(...nodes){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this.append(...nodes);}
  remove(){if(this.parentNode){this.parentNode.childNodes=this.parentNode.childNodes.filter(child=>child!==this);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);if(key==='class')this.className=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5)]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}removeAttribute(key){delete this.attributes[key];}
  matches(selector){if(selector===':popover-open')return this.popoverOpen===true;if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));const attr=selector.match(/^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/);if(attr)return (!attr[1]||this.tagName===attr[1].toUpperCase())&&(attr[2]==='open'?this.open:attr[3]===undefined?this.getAttribute(attr[2])!==null:this.getAttribute(attr[2])===attr[3]);return this.tagName===selector.toUpperCase();}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let current=this;current;current=current.parentNode)if(current.matches(selector))return current;return selector==='.sidebar'?this.document.sidebar:null;}
  getBoundingClientRect(){return this.bounds || {left:40,top:750,right:240,bottom:774,width:200,height:24};}
  showPopover(){this.popoverOpen=true;this.dispatchEvent(new UIEvent('toggle',{newState:'open'}));}
  hidePopover(){this.popoverOpen=false;this.dispatchEvent(new UIEvent('toggle',{newState:'closed'}));}
  focus(){this.document.activeElement=this;}select(){}click(){if(!this.disabled)this.dispatchEvent(new UIEvent('click'));}showModal(){this.open=true;}close(){if(this.open){this.open=false;this.dispatchEvent(new UIEvent('close'));}}
}
function documentFixture(){
  const document=new Events();document.hidden=false;document.createElement=tag=>new Element(tag,document);document.createTextNode=text=>{const node=new Element('#text',document);node.data=String(text);return node;};document.createDocumentFragment=()=>new Element('#fragment',document);
  const root=document.createElement('document');document.body=root;document.querySelectorAll=selector=>root.querySelectorAll(selector);document.querySelector=selector=>root.querySelector(selector);document.getElementById=id=>root.querySelector('#'+id);document.sidebar=document.createElement('aside');document.sidebar.className='sidebar';root.append(document.sidebar);
  // IDs/tags come from the shipped page. Only the small static child structure
  // accessed by app.js is needed; workbench elements are created by real JS.
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');for(const match of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const node=document.createElement(match[1]);node.id=match[2];if(/\bhidden(?:\s|>|=)/.test(match[0]))node.hidden=true;root.append(node);}
  for(const match of html.matchAll(/<button\b[^>]*data-import-(provider|scope)="([^"]+)"[^>]*>/g)){const button=document.createElement('button');button.setAttribute('data-import-'+match[1],match[2]);button.dataset[match[1]==='scope'?'importScope':'importProvider']=match[2];root.append(button);}
  // theme.js sets the palette on <html> and the theme-color meta. The element records every palette it is given.
  const page=document.createElement('html');page.palettes=[];const setPageAttribute=page.setAttribute.bind(page);page.setAttribute=(key,value)=>{if(key==='data-theme')page.palettes.push(String(value));setPageAttribute(key,value);};document.documentElement=page;
  const meta=document.createElement('meta');meta.setAttribute('name','theme-color');root.append(meta);
  const appearance=document.getElementById('appearance-options')||root;for(const match of html.matchAll(/<button\b[^>]*data-appearance="([^"]+)"[^>]*>/g)){const button=document.createElement('button');button.setAttribute('data-appearance',match[1]);appearance.append(button);}
  for(const id of ['send-button','stop-button','conversation-state'])document.getElementById(id).append(document.createElement('span'),document.createElement('span'));
  for(const id of ['save-project','save-folder'])document.getElementById(id).append(document.createTextNode('Save '),document.createElement('span'));
  return document;
}
const clone=value=>JSON.parse(JSON.stringify(value));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data),json:async()=>clone(data)});
async function flush(){for(let index=0;index<12;index++)await new Promise(resolve=>setImmediate(resolve));}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

async function browser({existing=true,available=true,providers={},authenticated=true,billingSource='subscription',accountErrors=[],workbench=false,insights=false,historyUI=insights,empty=false,moreProjects=false,desktop=false,wide=false,stored={},usage=null,setup=false,savedPreferences={},desktopControls=false,filesUI=false,searchUI=false,launch=null,theme=false,systemDark=true}={}){
  const document=documentFixture(),window=new Events(),storage=new Map(Object.entries(stored)),timers=new Map(),requests=[],handoffs=[],pickedFolders=[],dataChoices=[];let timerId=0,intercept=null;
  let preferences=clone(savedPreferences);
  window.innerWidth=1280;window.innerHeight=800;
  const awakeChanges=[];
  const folder=(id,name,folderPath)=>({id,name,displayName:name,path:folderPath,available:true});
  const project={id:'project-one',name:'Example workspace',path:'/workspace/example/frontend',available:true,folders:[folder('frontend','Frontend','/workspace/example/frontend'),folder('backend','Backend','/workspace/example/backend')]};
  const projects=empty?[]:[project],removedProjects=new Map();if(moreProjects)projects.push({id:'project-two',name:'Other workspace',path:'/workspace/other/api',available:true,folders:[folder('api','API','/workspace/other/api')]});
  const newConversation=()=>({id:randomUUID(),title:'Conversation',provider:'codex',mode:'edit',models:{},status:'idle',messages:[],context:{goal:'',decisions:[],tasks:[]},updatedAt:'2026-10-20T00:00:00.000Z'});
  const conversations=[],canonical=new Map(),submissions=new Map();let chatCreations=0;
  const snapshots=new Map();
  const importSources=[
    {id:'claude-one',provider:'claude',title:'Plan the API',folder:'frontend',cwd:'/workspace/example/frontend',updatedAt:'2026-10-20T09:02:00.000Z',messages:[{sourceId:'c1',role:'user',text:'Plan the API',timestamp:'2026-10-20T09:00:00.000Z'},{sourceId:'c2',role:'assistant',text:'Claude planned it',timestamp:'2026-10-20T09:02:00.000Z'}]},
    {id:'codex-one',provider:'codex',title:'Build the API',folder:'frontend',cwd:'/workspace/example/frontend',updatedAt:'2026-10-20T09:03:00.000Z',messages:[{sourceId:'x1',role:'user',text:'Build the API',timestamp:'2026-10-20T09:01:00.000Z'},{sourceId:'x2',role:'assistant',text:'Codex built it',timestamp:'2026-10-20T09:03:00.000Z'}]},
    {id:'codex-new',provider:'codex',title:'Start new app',folder:'new-app',cwd:'/workspace/new-app',updatedAt:'2026-10-19T09:00:00.000Z',messages:[{sourceId:'n1',role:'user',text:'Start new app',timestamp:'2026-10-19T09:00:00.000Z'}]}];
  const ensureChat=project=>{if(!canonical.has(project.id)){const conversation=newConversation();canonical.set(project.id,conversation);conversations.push(conversation);project.conversationId=conversation.id;chatCreations++;}return canonical.get(project.id);};
  const providerStatus=provider=>({available,...providers[provider]});
  const providerAccount=provider=>({installed:providerStatus(provider).available,authenticated:typeof authenticated==='object'?authenticated[provider]:authenticated,billingSource,usage:'unknown'});
  if(existing)for(const project of projects)ensureChat(project);
  async function fetch(url,options={}){
    const address=new URL(url,'http://127.0.0.1:4318');const request={path:address.pathname,projectId:address.searchParams.get('projectId'),params:Object.fromEntries(address.searchParams),method:options.method||'GET',body:options.body?JSON.parse(options.body):null};requests.push(request);
    const next=()=>{
      if(request.path==='/api/files')return response({entries:[],nextOffset:null});
      if(request.path==='/api/attachments'&&request.method==='POST'){const id=(snapshots.size+1).toString(16).padStart(64,'0'), file={id,name:request.body.name,kind:'text',mime:'text/plain',bytes:10};snapshots.set(id,file);return response(file,201);}
      if(request.path==='/api/attachments/preview')return response({...snapshots.get(request.params.id),text:'snapshot'});
      if(request.path==='/api/preferences'){if(request.method==='POST')preferences={...preferences,...preferencePatch(request.body,preferences)};return response(publicPreferences(preferences,projects.length>0));}
      if(request.path==='/api/appearance'){if(request.method==='POST'){try{preferences={...preferences,...preferencePatch({theme:request.body.theme},preferences)};}catch(error){return response({error:error.message},400);}return response({theme:request.body.theme});}return response({theme:publicPreferences(preferences,true).theme});}
      if(request.path==='/api/sharing/config')return response({baseUrl:null});
      const rename=request.path.match(/^\/api\/projects\/([^/]+)$/);if(rename&&request.method==='POST'){const project=projects.find(item=>item.id===rename[1]);if(request.body.name!==undefined)project.name=request.body.name;if(request.body.previousConversationsDismissed!==undefined)project.previousConversationsDismissed=request.body.previousConversationsDismissed;return response(clone(project));}
      if(request.path==='/api/projects'&&request.method==='GET')return response(clone(projects));
      if(request.path==='/api/projects'&&request.method==='POST'){
        assert(Array.isArray(request.body.folders),'Workspace creation must explicitly list its folders.');
        const paths=request.body.folders;const added={id:'project-'+(projects.length+1),name:request.body.name||paths[0].split('/').pop(),path:paths[0],available:true,folders:paths.map((folderPath,index)=>folder('folder-'+index,folderPath.split('/').pop(),folderPath))};projects.push(added);return response(clone(added),201);
      }
      const account=request.path.match(/^\/api\/providers\/(codex|claude)\/account$/);
      const usageRead=request.path.match(/^\/api\/providers\/(codex|claude)\/usage$/);
      if(request.path==='/api/import-sources'){const {scope,provider}=request.params;const project=projects.find(project=>project.id===request.projectId);if(scope==='workspace')assert(project,'Workspace-scoped discovery names its workspace.');return response({sessions:importSources.filter(row=>row.provider===provider&&(scope!=='workspace'||project.folders.some(folder=>folder.path===row.cwd))).map(({messages,...row})=>clone(row)),nextCursor:null});}
      if(request.path==='/api/import-sources/preview'){const source=importSources.find(row=>row.provider===request.body.provider&&row.id===request.body.sessionId);return response({provider:source.provider,sessionId:source.id,title:source.title,cwd:source.cwd,digest:'digest-'+source.id,messageCount:source.messages.length,clipped:false,messages:clone(source.messages)});}
      if(request.path==='/api/import-sources/file-preview'){const shared=request.body.package;assert.equal(shared.schema,'ai-relay.conversation');return response({provider:'file',sessionId:shared.id,title:shared.workspace.name,cwd:null,folders:shared.workspace.folders,exportedAt:shared.exportedAt,context:null,clipped:false,messages:shared.messages.map(message=>({sourceId:message.id,role:message.role,text:message.text,provider:message.provider,timestamp:message.createdAt})),messageCount:shared.messages.length,digest:'digest-'+shared.id});}
      if(request.path==='/api/import-sources/import'){
        const chosen=(request.body.sessions||[]).map(item=>{const source=importSources.find(row=>row.provider===item.provider&&row.id===item.sessionId);assert.equal(item.approvedDigest,'digest-'+source.id,'Only reviewed content is imported.');return source;});
        for(const item of request.body.files||[]){assert.equal(item.approvedDigest,'digest-'+item.package.id,'Only the reviewed file is imported.');chosen.push({provider:'file',cwd:null,messages:item.package.messages.map(message=>({sourceId:message.id,role:message.role,text:message.text,provider:message.provider,timestamp:message.createdAt}))});}
        let target=projects.find(project=>project.id===request.body.projectId);const where=chosen.find(source=>source.cwd)?.cwd||request.body.folders?.[0];
        if(!target){assert(where,'A new workspace needs a local folder.');target={id:'project-'+(projects.length+1),name:request.body.name,path:where,available:true,folders:[folder('imported',where.split('/').pop(),where)]};projects.push(target);}
        const chat=ensureChat(target),merged=chosen.flatMap(source=>source.messages.map(message=>({...message,provider:source.provider==='file'?message.provider:source.provider}))).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
        chat.messages.push(...merged.map(({timestamp,sourceId,...message})=>({...message,id:sourceId,imported:true,createdAt:timestamp})));
        target.previousConversationsDismissed=true;
        return response({imported:merged.length,updated:0,duplicate:false,conversationId:chat.id,projectId:target.id,projectName:target.name,conversations:chosen.length,missingFolders:[]});
      }
      if(usageRead){assert.equal(request.method,'GET','Usage is read-only.');return response(usage?.[usageRead[1]]||{provider:usageRead[1],available:false,reason:'Not reported.'});}
      if(account){assert.equal(request.method,'GET','Account discovery is metadata-only.');if(accountErrors.includes(account[1]))return response({error:'Account metadata is unavailable.'},503);return response(providerAccount(account[1]));}
      const workspaceAction=request.path.match(/^\/api\/projects\/([^/]+)\/(remove|restore)$/);
      if(workspaceAction){assert.equal(request.method,'POST');const id=workspaceAction[1];if(workspaceAction[2]==='remove'){const index=projects.findIndex(project=>project.id===id);if(index>=0)removedProjects.set(id,projects.splice(index,1)[0]);return response({id,removed:true});}const restored=removedProjects.get(id)||projects.find(project=>project.id===id);assert(restored);if(!projects.some(project=>project.id===id))projects.push(restored);removedProjects.delete(id);return response(clone(restored));}
      const membership=request.path.match(/^\/api\/projects\/([^/]+)\/folders(?:\/([^/]+)\/remove)?$/);
      if(membership){const selected=projects.find(project=>project.id===membership[1]);assert(selected);if(membership[2]){if(selected.folders.length<=1)return response({error:'A workspace needs a folder.'},400);selected.folders=selected.folders.filter(folder=>folder.id!==membership[2]);}else{const folderPath=request.body.path;selected.folders.push(folder(randomUUID(),folderPath.split('/').pop(),folderPath));}selected.path=selected.folders[0].path;return response(clone(selected));}
      if (/^\/api\/providers\/(codex|claude)\/models$/.test(request.path)) return response({models:[{id:'model-one',value:'model-one',displayName:'Model One',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{id:'model-two',value:'model-two',displayName:'Model Two',supportedEffortLevels:['low','medium']}]});
      const selected=projects.find(project=>project.id===request.projectId);assert(selected,'Project-owned requests need an explicit valid project ID.');

      if (request.path==='/api/git') return response({checkedAt:new Date().toISOString(),repositories:[{folderId:'frontend',name:'Frontend',available:true,branch:'feature/design',totalChanges:1,changes:[{path:'app.js',code:' M',staged:false}],commits:[{hash:'abc',shortHash:'abc123',author:'Fixture author',date:new Date().toISOString(),subject:'Improve workspace navigation'}]}]});
      if (request.path==='/api/git/diff') return response({folderId:'frontend',path:'app.js',code:' M',diff:'diff --git a/app.js b/app.js\nindex 1..2 100644\n--- a/app.js\n+++ b/app.js\n@@ -1,2 +1,2 @@\n const value = 1;\n--- old SQL comment\n+// updated\n',truncated:false});
      if (request.path==='/api/imports/preview') return response({provider:'codex',sessionId:'external-one',title:'Existing native task',digest:'reviewed-source',messageCount:2,messages:[{sourceId:'u',role:'user',text:'Original task'},{sourceId:'a',role:'assistant',text:'Saved native answer'}]});
      if (request.path==='/api/imports') {
        if (request.method==='GET') return response({sessions:[{id:'external-one',provider:'codex',title:'Existing native task',folder:'Frontend',updatedAt:new Date().toISOString()}],nextCursor:null});
        assert.equal(request.body.approvedDigest,'reviewed-source');const chat=ensureChat(selected);chat.messages.push({id:'imported-one',provider:'codex',role:'user',text:'Original task',imported:true},{id:'imported-two',provider:'codex',role:'assistant',text:'Saved native answer',imported:true});return response({imported:2,conversationId:chat.id});
      }

      if(request.path==='/api/conversation/export'){const redacted=request.params.redact!=='0';return response({package:{schema:'ai-relay.conversation',version:1,id:'export-one',workspace:{name:selected.name,folders:['frontend']},messages:clone(ensureChat(selected).messages).map(message=>({id:message.id,role:message.role,text:message.text})),digest:'exported'},stats:{messages:ensureChat(selected).messages.length,omitted:0,bytes:420,from:null,to:null,providers:[]},findings:{secrets:1,localPaths:0},redacted});}
      if(request.path==='/api/status')return response({workspace:selected.path,projectId:selected.id,project:clone(selected),providers:{codex:providerStatus('codex'),claude:providerStatus('claude')},runningConversationId:canonical.get(selected.id)?.status==='running'?canonical.get(selected.id).id:null});
      if(request.path==='/api/conversation')return response(clone(ensureChat(selected)));
      if(request.path==='/api/collaboration/handoffs/prepare'){const body=request.body;const outgoing=body.draft?sealPackage(body.draft):sealPackage({schema:'ai-relay.handoff',version:1,id:randomUUID(),createdAt:'2026-10-20T00:00:00.000Z',mode:body.mode||'context',goal:body.goal||'',problem:body.problem||'',expectedOutcome:body.expectedOutcome||'',decisions:body.decisions||[],tasks:body.tasks||[],messages:[],files:[],baseline:[]});return response({package:outgoing,warnings:[]});}
      if(request.path==='/api/collaboration/handoffs/approve'){const record={id:request.body.package.id,package:request.body.package,direction:'outgoing',status:'approved'};handoffs.push(record);return response(clone(record));}
      const match=request.path.match(/^\/api\/conversations\/([^/]+)(?:\/(provider|messages|continue))?$/);
      if(match){const conversation=canonical.get(selected.id);assert(conversation&&conversation.id===match[1],'The browser must target this workspace’s permanent conversation.');if(request.method==='GET')return response(clone(conversation));if(match[2]==='provider'){const provider=request.body.provider,model=request.body.model===undefined?conversation.models[provider]||null:request.body.model;conversation.efforts ||= {};const effort=request.body.effort===undefined?conversation.efforts[provider]?.[model||'default']??null:request.body.effort;Object.assign(conversation,{provider,mode:request.body.mode,model,effort});conversation.models[provider]=model;conversation.efforts[provider] ||= {};conversation.efforts[provider][model||'default']=effort;return response(clone(conversation));}if(['messages','continue'].includes(match[2])){if(!submissions.has(request.body.requestId)){submissions.set(request.body.requestId,{runId:randomUUID()});conversation.messages.push({id:randomUUID(),role:'user',text:request.body.text||'Continue',createdAt:'2026-10-20T00:00:00.000Z'});}conversation.status='complete';return response(submissions.get(request.body.requestId),202);}}
      throw new Error('Unexpected browser request: '+request.method+' '+request.path);
    };return intercept?intercept(request,next):next();
  }
  // prefers-color-scheme reports the OS appearance; setSystemDark changes it the way the OS would.
  const colorScheme={matches:systemDark,listeners:[],addEventListener(type,fn){if(type==='change')this.listeners.push(fn);}};
  if(wide||theme)window.matchMedia=query=>query==='(prefers-color-scheme: dark)'?colorScheme:{matches:wide};
  if(desktop)window.relayDesktop={token:'desktop-test-token',pickFolder:async()=>pickedFolders.shift()||null};
  if(desktop)Object.assign(window.relayDesktop,{getKeepAwake:async()=>({enabled:false,active:false,runningCount:0}),setKeepAwake:async enabled=>{awakeChanges.push(enabled);return {enabled,active:false,runningCount:0};},onKeepAwakeChanged:callback=>{window.addEventListener('desktop-keep-awake',event=>callback(event.detail));return ()=>{};}});
  if(desktop&&launch)Object.assign(window.relayDesktop,{getLaunchState:async()=>clone(launch),chooseData:async choice=>{dataChoices.push(choice);return {...clone(launch),choice:false};}});
  // Custom Highlight API stand-ins: ranges record their boundaries, and the registry is a Map.
  class Range{setStart(node,offset){this.startContainer=node;this.startOffset=offset;}setEnd(node,offset){this.endContainer=node;this.endOffset=offset;}getBoundingClientRect(){return this.startContainer.parentNode.getBoundingClientRect();}}
  class Highlight extends Set{constructor(...ranges){super(ranges);this.priority=0;}}
  const highlights=new Map();document.createRange=()=>new Range();
  const context=vm.createContext({document,window,fetch,console,CSS:{highlights},Highlight,crypto:{randomUUID},CustomEvent:UIEvent,Event:UIEvent,EventSource:class extends Events{},requestAnimationFrame:fn=>fn(),setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))},URL,Blob,navigator:{clipboard:{writeText:async()=>{}}}});
  if(theme)vm.runInContext(fs.readFileSync(new URL('../public/theme.js',import.meta.url),'utf8'),context,{filename:'public/theme.js'});
  vm.runInContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context,{filename:'public/app.js'});if(workbench)vm.runInContext(fs.readFileSync(new URL('../public/workbench.js',import.meta.url),'utf8'),context,{filename:'public/workbench.js'});
  if(insights)vm.runInContext(fs.readFileSync(new URL('../public/insights.js',import.meta.url),'utf8'),context,{filename:'public/insights.js'});
  if(historyUI)vm.runInContext(fs.readFileSync(new URL('../public/conversation-history.js',import.meta.url),'utf8'),context,{filename:'public/conversation-history.js'});
  if(desktopControls)vm.runInContext(fs.readFileSync(new URL('../public/desktop-controls.js',import.meta.url),'utf8'),context,{filename:'public/desktop-controls.js'});
  if(setup)vm.runInContext(fs.readFileSync(new URL('../public/setup.js',import.meta.url),'utf8'),context,{filename:'public/setup.js'});
  if(filesUI)vm.runInContext(fs.readFileSync(new URL('../public/files.js',import.meta.url),'utf8'),context,{filename:'public/files.js'});
  if(searchUI)vm.runInContext(fs.readFileSync(new URL('../public/conversation-search.js',import.meta.url),'utf8'),context,{filename:'public/conversation-search.js'});
  if(theme)document.dispatchEvent(new UIEvent('DOMContentLoaded'));
  await flush();assert.equal(window.relayUI.getState().ready,!empty);assert.equal(window.relayUI.getState().loading,false);
  const $=id=>document.getElementById(id);const fire=(id,type)=>$(id).dispatchEvent(new UIEvent(type));const findButton=text=>document.querySelectorAll('button').find(button=>button.textContent===text);
  const labelledInput=label=>{const entry=document.querySelectorAll('label').find(item=>item.textContent.startsWith(label));assert(entry,'Missing field: '+label);return entry.children.find(child=>['INPUT','TEXTAREA','SELECT'].includes(child.tagName));};
  const switchProject=async id=>{$('project-select').value=id;fire('project-select','change');await flush();};
  const textNodes=node=>node.nodeType===3?[node]:node.childNodes.flatMap(textNodes);
  const rangeText=range=>{const nodes=textNodes($('messages')),first=nodes.indexOf(range.startContainer),last=nodes.indexOf(range.endContainer);return nodes.slice(first,last+1).map((node,index)=>node.data.slice(index===0?range.startOffset:0,first+index===last?range.endOffset:undefined)).join('');};
  return {document,window,$,fire,findButton,highlights,rangeText,labelledInput,requests,conversations,submissions,handoffs,projects,canonical,pickedFolders,dataChoices,storage,switchProject,awakeChanges,get chatCreations(){return chatCreations;},setIntercept:fn=>{intercept=fn;},setSystemDark:value=>{colorScheme.matches=value;for(const fn of colorScheme.listeners)fn({matches:value});},state:()=>window.relayUI.getState()};
}

test('late same-project refresh cannot restore superseded provider/access settings',async()=>{
  const ui=await browser(),held=deferred();let waiting=false;
  ui.setIntercept((request,next)=>{if(!waiting&&request.method==='GET'&&request.path==='/api/conversation'){waiting=true;const stale=next();return held.promise.then(()=>stale);}return next();});
  const refreshing=ui.window.relayUI.refresh();await flush();assert.equal(waiting,true);
  ui.$('select-claude').click();ui.$('mode-select').value='read';ui.fire('mode-select','change');await flush();assert.equal(ui.state().settingsPending,0,'Finish settings POSTs before releasing the older GET.');assert.equal(ui.conversations[0].provider,'claude');assert.equal(ui.conversations[0].mode,'read');
  held.resolve();await refreshing;await flush();assert.equal(ui.state().provider,'claude');assert.equal(ui.state().mode,'read');assert.equal(ui.$('select-claude').getAttribute('aria-pressed'),'true');assert.equal(ui.$('mode-select').value,'read');
});

for(const existing of [true,false])test('accepted-send response loss preserves requestId on retry '+(existing?'in an existing chat':'when the canonical chat is first opened'),async()=>{
  const ui=await browser({existing});let lost=false;ui.setIntercept((request,next)=>{const result=next();if(request.path.endsWith('/messages')&&!lost){lost=true;throw new Error('Response lost after acceptance and completion.');}return result;});
  ui.$('message-input').value='Fix this task exactly once';ui.fire('message-input','input');ui.fire('composer','submit');ui.fire('composer','submit');await flush();assert.equal(lost,true);assert.equal(ui.state().pending,null);assert.equal(ui.$('notice').hidden,false);assert.equal(ui.$('message-input').value,'Fix this task exactly once');assert.equal(ui.submissions.size,1);
  ui.$('notice-retry').click();await flush();const sends=ui.requests.filter(request=>request.path.endsWith('/messages'));assert.equal(sends.length,2);assert.match(sends[0].body.requestId,/^[a-f0-9-]{36}$/);assert.equal(sends[1].body.requestId,sends[0].body.requestId);assert.equal(sends[1].path,sends[0].path);assert.equal(ui.submissions.size,1);assert.equal(ui.$('message-input').value,'');assert.equal(ui.conversations.length,1);
  assert.equal(ui.requests.filter(request=>request.path==='/api/conversations'&&request.method==='POST').length,0,'The UI never creates additional conversations.');assert.equal(ui.chatCreations,1);
});

test('offline Ask a Friend remains enabled with both CLIs absent and request controls never submit model messages',async()=>{
  const ui=await browser({existing:false,available:false,workbench:true});assert.equal(ui.$('select-codex').disabled,true);assert.equal(ui.$('select-claude').disabled,true);assert.equal(ui.$('send-button').disabled,true);assert.equal(ui.$('ask-friend').disabled,false);
  ui.$('ask-friend').click();await flush();assert.equal(ui.$('workbench').open,true);ui.labelledInput('Goal').value='Offline request';ui.findButton('Prepare offline preview').click();await flush();
  const editor=ui.labelledInput('Editable package JSON'),outgoing=JSON.parse(editor.value);assert.equal(outgoing.goal,'Offline request');assert.equal(outgoing.mode,'context');assert.equal(outgoing.messages.length,0);assert.equal(ui.findButton('Approve exact package').disabled,false);
  outgoing.goal='Explicitly edited offline goal';editor.value=JSON.stringify(outgoing);editor.dispatchEvent(new UIEvent('input'));assert.equal(ui.findButton('Approve exact package').disabled,true);ui.findButton('Refresh edited preview').click();await flush();const refreshed=JSON.parse(editor.value);assert.notEqual(refreshed.integrity,outgoing.integrity);
  ui.labelledInput('I inspected the exact package').checked=true;ui.findButton('Approve exact package').click();await flush();assert.equal(ui.handoffs.length,1);assert.equal(ui.handoffs[0].package.integrity,refreshed.integrity);assert(ui.findButton('Export approved request'));
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);assert.equal(ui.requests.filter(request=>request.path.startsWith('/api/providers/')).length,0);assert.equal(ui.requests.filter(request=>/\/(?:publish|retrieve|revoke)$/.test(request.path)).length,0,'Approval cannot publish implicitly.');const prepared=ui.requests.find(request=>request.path==='/api/collaboration/handoffs/prepare');assert.equal(prepared.body.messageIds.length,0);assert.equal(prepared.body.files.length,0);assert.equal(prepared.body.newPaths.length,0);
});


test('each workspace automatically opens one permanent chat and switching preserves separate drafts',async()=>{
  const ui=await browser({moreProjects:true});const firstId=ui.state().conversation.id;
  assert.equal(ui.$('new-chat'),null);assert.equal(ui.$('conversation-list'),null);assert.equal(ui.$('history-toggle'),null);
  assert.equal(ui.$('workspace-count').textContent,'2');assert(ui.$('workspace-list').textContent.includes('Frontend'));assert(ui.$('workspace-list').textContent.includes('Backend'));
  ui.$('message-input').value='first workspace draft';ui.fire('message-input','input');
  await ui.switchProject('project-two');const secondId=ui.state().conversation.id;assert.notEqual(firstId,secondId);assert.equal(ui.$('message-input').value,'');
  ui.$('message-input').value='second workspace draft';ui.fire('message-input','input');await ui.switchProject('project-one');assert.equal(ui.state().conversation.id,firstId);assert.equal(ui.$('message-input').value,'first workspace draft');
  await ui.window.relayUI.ensureConversation();await ui.window.relayUI.ensureConversation();await ui.window.relayUI.refresh();assert.equal(ui.state().conversation.id,firstId);assert.equal(ui.chatCreations,2);assert.equal(ui.requests.filter(request=>request.path==='/api/conversations').length,0);
});

test('workspace creation explicitly accepts multiple folders and opens its canonical chat without a create-chat request',async()=>{
  const ui=await browser({empty:true,existing:false,desktop:true});assert.equal(ui.$('project-empty-state').hidden,false);assert.equal(ui.$('send-button').disabled,true);
  ui.$('add-first-project').click();ui.$('project-name').value='Full stack';ui.$('project-paths').value='/workspace/frontend';ui.pickedFolders.push('/workspace/backend');ui.$('pick-folder').click();await flush();assert.equal(ui.$('project-paths').value,'/workspace/frontend\n/workspace/backend');
  ui.$('project-paths').value+='\n/workspace/frontend';ui.fire('project-form','submit');await flush();const creation=ui.requests.find(request=>request.path==='/api/projects'&&request.method==='POST');assert.deepEqual(creation.body,{name:'Full stack',folders:['/workspace/frontend','/workspace/backend']});assert.equal(ui.state().ready,true);assert.equal(ui.state().conversation.id,ui.canonical.get(ui.state().projectId).id);assert.equal(ui.chatCreations,1);assert.equal(ui.projects[0].folders.length,2);assert.equal(ui.$('project-empty-state').hidden,true);
});

test('adding/removing folders keeps the same chat and draft, including removal of the primary root',async()=>{
  const ui=await browser({moreProjects:true});const chatId=ui.state().conversation.id;
  ui.$('message-input').value='draft across folder changes';ui.fire('message-input','input');ui.findButton('Add folder').click();ui.$('folder-path').value='/workspace/shared';ui.fire('folder-form','submit');await flush();
  assert.equal(ui.projects[0].folders.length,3);assert.equal(ui.state().conversation.id,chatId);assert.equal(ui.$('message-input').value,'draft across folder changes');assert(ui.$('workspace-list').textContent.includes('shared'));
  const remove=ui.document.querySelectorAll('.folder-options').find(button=>button.dataset.folderId==='frontend');remove.click();assert.equal(ui.$('folder-options-dialog').open,true);assert.equal(ui.projects[0].folders.length,3);ui.$('confirm-remove-folder').click();await flush();assert.equal(ui.projects[0].folders.length,2);assert.equal(ui.projects[0].path,'/workspace/example/backend');assert.equal(ui.state().conversation.id,chatId);
  await ui.switchProject('project-two');await ui.switchProject('project-one');assert.equal(ui.$('message-input').value,'draft across folder changes');assert.equal(ui.state().conversation.id,chatId);
  ui.document.querySelectorAll('.folder-options')[0].click();ui.$('confirm-remove-folder').click();await flush();assert.equal(ui.projects[0].folders.length,1);ui.document.querySelectorAll('.folder-options')[0].click();const last=ui.$('confirm-remove-folder');assert.equal(last.disabled,true);const count=ui.requests.length;last.click();await flush();assert.equal(ui.requests.length,count);assert.equal(ui.chatCreations,2);
});

test('folder mutations lock switching while pending and active runs lock folder changes, not workspace selection',async()=>{
  const ui=await browser({moreProjects:true});const held=deferred();let pending=false;
  ui.setIntercept((request,next)=>{const result=next();if(request.path==='/api/projects/project-one/folders'){pending=true;return held.promise.then(()=>result);}return result;});
  ui.findButton('Add folder').click();ui.$('folder-path').value='/workspace/shared';ui.fire('folder-form','submit');await flush();assert.equal(pending,true);assert.equal(ui.$('project-select').disabled,true);await ui.switchProject('project-two');assert.equal(ui.state().projectId,'project-one');held.resolve();await flush();assert.equal(ui.$('project-select').disabled,false);
  ui.canonical.get('project-one').status='running';await ui.window.relayUI.refresh();assert.equal(ui.findButton('Add folder').disabled,true);ui.document.querySelectorAll('.folder-options')[0].click();assert.equal(ui.$('confirm-remove-folder').disabled,true);ui.$('close-folder-options').click();assert.equal(ui.$('project-select').disabled,false);await ui.switchProject('project-two');assert.equal(ui.state().projectId,'project-two');
});

test('late canonical response from a previous workspace cannot replace the current workspace chat',async()=>{
  const ui=await browser({moreProjects:true}),held=deferred();let waiting=false;
  ui.setIntercept((request,next)=>{const result=next();if(!waiting&&request.path==='/api/conversation'&&request.projectId==='project-one'){waiting=true;return held.promise.then(()=>result);}return result;});
  const refreshing=ui.window.relayUI.refresh();await flush();assert.equal(waiting,true);await ui.switchProject('project-two');const current=ui.state().conversation.id;held.resolve();await refreshing;await flush();assert.equal(ui.state().projectId,'project-two');assert.equal(ui.state().conversation.id,current);
});

test('startup checks account metadata without starting a model or repeatedly probing on focus',async()=>{
  const ui=await browser();
  const accountRequests=()=>ui.requests.filter(request=>/^\/api\/providers\/[^/]+\/account$/.test(request.path));
  assert.deepEqual(accountRequests().map(request=>request.path).sort(),['/api/providers/claude/account','/api/providers/codex/account']);
  assert(accountRequests().every(request=>request.method==='GET'));
  assert.equal(ui.$('codex-status-text').textContent,'Connected');assert.equal(ui.$('claude-status-text').textContent,'Connected');
  ui.window.dispatchEvent(new UIEvent('focus'));ui.window.dispatchEvent(new UIEvent('focus'));await flush();
  assert.equal(accountRequests().length,2,'Fresh metadata is cached across repeated focus events.');
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue|connect|models)$/.test(request.path)).length,0,'Metadata discovery never sends prompts, starts login or loads model choices.');
});

test('known signed-out provider offers account setup and blocks Send and Continue',async()=>{
  const ui=await browser({authenticated:{codex:false,claude:true},workbench:true});
  ui.$('message-input').value='Keep this draft while I sign in';ui.fire('message-input','input');
  assert.equal(ui.$('send-button').disabled,true);assert.equal(ui.$('connection-notice').hidden,false);
  assert.equal(ui.$('connection-notice-text').textContent,'Codex is not signed in.');assert.equal(ui.$('connection-action').textContent,'Connect account');
  assert.equal(ui.$('conversation-state').textContent,'Connection required');
  const conversation=ui.canonical.get('project-one');conversation.status='incomplete';conversation.lastRun={provider:'codex',errorCategory:'auth'};await ui.window.relayUI.refresh();
  assert.equal(ui.$('continue-button').disabled,true);ui.fire('composer','submit');ui.$('continue-button').click();await flush();
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
  ui.$('connection-action').click();await flush();assert.equal(ui.$('workbench').open,true);assert.equal(ui.$('workbench-title').textContent,'Connections');
  assert.equal(ui.$('message-input').value,'Keep this draft while I sign in');
});

test('Settings is available before any workspace and account discovery is global',async()=>{
  const ui=await browser({empty:true,existing:false,workbench:true});
  assert.equal(ui.$('relay-settings').disabled,false);assert.equal(ui.$('ask-friend').disabled,true);
  ui.$('relay-settings').click();await flush();
  assert.equal(ui.$('workbench').open,true);assert.equal(ui.$('workbench-title').textContent,'Connections');assert.equal(ui.$('workbench-error').hidden,true);
  const requests=ui.requests.filter(request=>/^\/api\/providers\/[^/]+\/account$/.test(request.path));assert.equal(requests.length,2);assert(requests.every(request=>request.projectId===null));
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue|connect|models)$/.test(request.path)).length,0);
});

test('an unavailable selected provider offers the installed alternative without silently changing saved selection',async()=>{
  const ui=await browser({providers:{codex:{available:false},claude:{available:true}}});
  ui.$('message-input').value='Draft for either assistant';ui.fire('message-input','input');
  assert.equal(ui.state().provider,'codex');assert.equal(ui.$('select-codex').disabled,true);assert.equal(ui.$('select-claude').disabled,false);assert.equal(ui.$('send-button').disabled,true);
  assert.equal(ui.$('connection-notice').hidden,false);assert.equal(ui.$('connection-action').textContent,'Use Claude');
  assert.deepEqual(ui.requests.filter(request=>/^\/api\/providers\/[^/]+\/account$/.test(request.path)).map(request=>request.path),['/api/providers/claude/account']);
  ui.$('connection-action').click();await flush();
  assert.equal(ui.state().provider,'claude');assert.equal(ui.canonical.get('project-one').provider,'claude');assert.equal(ui.$('connection-notice').hidden,true);assert.equal(ui.$('send-button').disabled,false);assert.equal(ui.$('message-input').value,'Draft for either assistant');
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
});

test('both missing providers show one setup next action while offline collaboration stays usable',async()=>{
  const ui=await browser({available:false,workbench:true});
  assert.equal(ui.$('provider-empty-state').hidden,false);assert.equal(ui.$('empty-state').hidden,true);assert.equal(ui.$('connection-notice').hidden,true);
  assert.equal(ui.$('conversation-state').textContent,'Connection required');assert.equal(ui.$('ask-friend').disabled,false);assert.equal(ui.$('relay-settings').disabled,false);
  assert.equal(ui.requests.filter(request=>request.path.startsWith('/api/providers/')).length,0,'Installed-false providers are not probed during startup.');
  ui.$('connect-assistant').click();await flush();assert.equal(ui.$('workbench').open,true);assert.equal(ui.$('workbench-title').textContent,'Connections');
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue|connect)$/.test(request.path)).length,0);
});

test('failed account probes remain advisory and do not invent an authentication or billing block',async()=>{
  const ui=await browser({accountErrors:['codex','claude']});
  assert.equal(ui.state().accounts?.codex,undefined);assert.equal(ui.state().accounts?.claude,undefined);
  ui.$('message-input').value='Explicit request after unavailable metadata';ui.fire('message-input','input');
  assert.equal(ui.$('send-button').disabled,false);assert.equal(ui.$('conversation-state').textContent,'Not verified');
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
});

const accountReply=(authenticated,extra={})=>response({installed:true,authenticated,billingSource:authenticated===true?'subscription':'unknown',usage:'unknown',...extra});
test('a routine account check keeps a verified connection on screen while it runs',async()=>{
  const ui=await browser(),held=deferred();
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'?held.promise.then(next):next());
  ui.$('message-input').value='Keep working during the check';ui.fire('message-input','input');
  ui.state().accountsCheckedAt=0;ui.window.dispatchEvent(new UIEvent('focus'));await flush();
  assert.equal(ui.requests.filter(request=>request.path==='/api/providers/codex/account').length,2,'Refocusing after a minute checks the account again.');
  assert.equal(ui.$('codex-status-text').textContent,'Connected');assert.equal(ui.$('connection-notice').hidden,true);assert.equal(ui.$('conversation-state').textContent,'Ready');assert.equal(ui.$('send-button').disabled,false);
  held.resolve();await flush();assert.equal(ui.$('codex-status-text').textContent,'Connected');assert.equal(ui.state().accountRefresh,null);
});

test('a first check with nothing known yet shows compact progress without a notice',async()=>{
  const ui=await browser(),held=deferred();
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'?held.promise.then(next):next());
  delete ui.state().accounts.codex;ui.state().accountsCheckedAt=0;const checking=ui.window.relayUI.refreshAccounts();await flush();
  assert.equal(ui.$('codex-status-text').textContent,'Checking…');assert.equal(ui.$('conversation-state').textContent,'Checking connection');assert.equal(ui.$('connection-notice').hidden,true,'A first check does not interrupt the conversation.');
  held.resolve();await checking;assert.equal(ui.$('codex-status-text').textContent,'Connected');assert.equal(ui.$('conversation-state').textContent,'Ready');
});

test('a check that times out or fails keeps the last verified connection, and Settings says why it may be out of date',async()=>{
  const ui=await browser({workbench:true});let reply=null;
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'&&reply?reply():next());
  ui.$('message-input').value='Draft during checks';ui.fire('message-input','input');
  reply=()=>accountReply('unknown',{errorCategory:'timeout'});await ui.window.relayUI.refreshAccounts({force:true});
  assert.equal(ui.state().accounts.codex.authenticated,true);assert.equal(ui.$('codex-status-text').textContent,'Connected');assert.equal(ui.$('connection-notice').hidden,true);assert.equal(ui.$('conversation-state').textContent,'Ready');
  ui.$('relay-settings').click();await flush();
  const card=()=>ui.document.querySelectorAll('.connection-card').find(card=>card.dataset.provider==='codex'),refresh=()=>card().querySelectorAll('button').find(button=>button.textContent==='Refresh status');
  assert.match(card().textContent,/Connected/);assert.match(card().textContent,/Last checked/);assert.match(card().textContent,/latest check timed out/i);
  reply=()=>response({error:'Account metadata is unavailable.'},503);refresh().click();await flush();
  assert.match(card().textContent,/Connected/);assert.match(card().textContent,/latest check failed/i);assert.equal(ui.$('codex-status-text').textContent,'Connected');
  reply=()=>accountReply(false);ui.state().accountsCheckedAt=0;ui.window.dispatchEvent(new UIEvent('focus'));await flush();
  assert.equal(ui.$('codex-status-text').textContent,'Sign in required','A real change still replaces the last result.');assert.equal(ui.$('connection-notice-text').textContent,'Codex is not signed in.');assert.equal(ui.$('send-button').disabled,true);
  assert.match(card().textContent,/Sign-in required/);assert.doesNotMatch(card().textContent,/latest check/i);
});

test('overlapping routine checks share one probe, and an older answer cannot overwrite a newer recheck',async()=>{
  const ui=await browser(),older=deferred();let probes=0;
  ui.setIntercept((request,next)=>{if(request.path!=='/api/providers/codex/account')return next();probes++;return probes===1?older.promise.then(()=>accountReply(true)):accountReply(false);});
  ui.state().accountsCheckedAt=0;const routine=ui.window.relayUI.refreshAccounts(),again=ui.window.relayUI.refreshAccounts();ui.window.dispatchEvent(new UIEvent('focus'));await flush();
  assert.equal(probes,1,'Routine checks that overlap share the probe already running.');
  const explicit=ui.window.relayUI.refreshAccounts({force:true});await flush();assert.equal(probes,2,'An explicit recheck asks again instead of reusing an older answer.');
  await explicit;assert.equal(ui.$('codex-status-text').textContent,'Sign in required');
  older.resolve();await routine;await again;await flush();
  assert.equal(ui.$('codex-status-text').textContent,'Sign in required','The older answer arrives last but cannot restore Connected.');assert.equal(ui.state().accounts.codex.authenticated,false);
});

test('an explicit recheck keeps its progress until its own answer arrives',async()=>{
  const ui=await browser(),older=deferred(),newer=deferred();let probes=0;
  ui.setIntercept((request,next)=>{if(request.path!=='/api/providers/codex/account')return next();const call=++probes;return (call===1?older:newer).promise.then(()=>accountReply(call===1));});
  delete ui.state().accounts.codex;ui.state().accountsCheckedAt=0;const routine=ui.window.relayUI.refreshAccounts();await flush();
  const explicit=ui.window.relayUI.refreshAccounts({force:true});await flush();assert.equal(probes,2);
  older.resolve();await routine;await flush();assert.equal(ui.$('codex-status-text').textContent,'Checking…','The recheck is still running after the older answer arrives.');
  newer.resolve();await explicit;assert.equal(ui.$('codex-status-text').textContent,'Sign in required');
});

test('a CLI removed after a failed check shows as not installed, without the earlier failure',async()=>{
  const providers={codex:{available:true},claude:{available:true}},ui=await browser({workbench:true,providers});
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'?accountReply('unknown',{errorCategory:'timeout'}):next());
  await ui.window.relayUI.refreshAccounts({force:true});assert.equal(ui.$('codex-status-text').textContent,'Connected');
  providers.codex.available=false;await ui.window.relayUI.refresh();await ui.window.relayUI.refreshAccounts({force:true});
  assert.equal(ui.$('codex-status-text').textContent,'Not installed');assert.equal(ui.$('connection-notice-text').textContent,'Codex is not installed.');assert.equal(ui.$('connection-action').textContent,'Use Claude');
  ui.$('relay-settings').click();await flush();const card=ui.document.querySelectorAll('.connection-card').find(card=>card.dataset.provider==='codex').textContent;
  assert.match(card,/Not installed/);assert.doesNotMatch(card,/latest check|Not yet/i);
});

test('Settings shows every connection at once, with progress on the card being rechecked',async()=>{
  const ui=await browser({workbench:true}),held=deferred();ui.$('relay-settings').click();await flush();
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'?held.promise.then(next):next());
  const text=provider=>ui.document.querySelectorAll('.connection-card').find(card=>card.dataset.provider===provider)?.textContent;
  ui.document.querySelectorAll('.connection-card')[0].querySelectorAll('button').find(button=>button.textContent==='Refresh status').click();await flush();
  assert.match(text('codex'),/Checking…/);assert.match(text('claude'),/Connected/,'A slow Codex check does not hide Claude.');assert.doesNotMatch(text('claude'),/Checking…/);
  assert.equal(ui.$('workbench').getAttribute('aria-busy'),null,'The dialog stays usable while the check runs.');
  held.resolve();await flush();assert.match(text('codex'),/Connected/);assert.doesNotMatch(text('codex'),/Checking…/);
});

test('Settings retries a connection that has not been checked successfully yet',async()=>{
  const ui=await browser({workbench:true,accountErrors:['codex']});ui.$('relay-settings').click();await flush();
  const card=()=>ui.document.querySelectorAll('.connection-card').find(card=>card.dataset.provider==='codex');
  assert.match(card().textContent,/Status unavailable/);assert.match(card().textContent,/Account metadata is unavailable/);
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'?accountReply(true):next());
  card().querySelectorAll('button').find(button=>button.textContent==='Try again').click();await flush();
  assert.match(card().textContent,/Connected/);assert.equal(ui.$('codex-status-text').textContent,'Connected');
});

test('setup shows progress while it refreshes connections, and none after a check has failed',async()=>{
  const ui=await browser({empty:true,existing:false,setup:true,accountErrors:['codex']});ui.document.querySelector('.onboarding-cta').click();await flush();
  const status=provider=>ui.document.querySelectorAll('.setup-agent').find(card=>card.dataset.provider===provider).querySelector('.setup-account-state').textContent;
  assert.equal(status('codex'),'Not verified','A failed check does not look like it is still running.');assert.match(status('claude'),/^Connected/);
  const held=deferred();ui.setIntercept((request,next)=>/^\/api\/providers\/(codex|claude)\/account$/.test(request.path)?held.promise.then(next):next());
  ui.findButton('Refresh').click();await flush();assert.equal(status('claude'),'Checking…');
  held.resolve();await flush();assert.match(status('claude'),/^Connected/);
  ui.setIntercept((request,next)=>request.path==='/api/providers/codex/account'?accountReply('unknown',{errorCategory:'timeout'}):next());
  ui.state().accountsCheckedAt=0;ui.window.dispatchEvent(new UIEvent('focus'));await flush();assert.equal(status('codex'),'Check timed out');
});

test('an explicit recheck reloads the model list, but opening Settings does not',async()=>{
  const ui=await browser({workbench:true,insights:true}),models=()=>ui.requests.filter(request=>request.path==='/api/providers/codex/models').length,before=models();
  ui.$('relay-settings').click();await flush();assert.equal(models(),before,'Opening Settings does not ask Codex for its models again.');
  ui.document.querySelectorAll('.connection-card')[0].querySelectorAll('button').find(button=>button.textContent==='Refresh status').click();await flush();
  assert(models()>before,'A connection that may have changed loads its models again.');
});

for(const billingSource of ['api','unknown'])test('known '+billingSource+' billing waits for explicit session confirmation',async()=>{
  const ui=await browser({billingSource});ui.$('message-input').value='Explicitly billed request';ui.fire('message-input','input');
  assert.equal(ui.$('send-button').disabled,true);assert.equal(ui.$('conversation-state').textContent,'Review billing');
  ui.fire('composer','submit');await flush();assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
  ui.window.relayBillingConfirmed=true;await ui.window.relayUI.refresh();assert.equal(ui.$('send-button').disabled,false);
});

test('workspace header, folder metadata and idle state have distinct concise information',async()=>{
  const ui=await browser({moreProjects:true});assert.equal(ui.$('conversation-title').textContent,'Example workspace');assert.equal(ui.$('conversation-subtitle').textContent,'Conversation');assert.equal(ui.$('conversation-state').textContent,'Ready');assert.equal(ui.$('workspace-count').textContent,'2');
  assert.deepEqual(ui.document.querySelectorAll('.workspace-item-meta').map(item=>item.textContent),['2 folders','1 folder']);
  assert.doesNotMatch(ui.$('workspace-list').textContent,/shared chat|Switch assistants|One conversation/i);assert.doesNotMatch(ui.$('conversation-subtitle').textContent,/folder|switch|shared/i);
  const conversation=ui.canonical.get('project-one');conversation.lastRun={provider:'claude',effectiveModel:'previous-provider-model'};await ui.window.relayUI.refresh();assert.doesNotMatch(ui.$('conversation-subtitle').textContent,/previous-provider-model/,'A model used by the other provider cannot label the current selection.');
});

test('quota, active execution and pending approval use distinct human-readable states',async()=>{
  const ui=await browser(),conversation=ui.canonical.get('project-one');
  conversation.status='incomplete';conversation.lastRun={provider:'codex',errorCategory:'quota'};await ui.window.relayUI.refresh();
  assert.equal(ui.$('conversation-state').textContent,'Stopped');assert.equal(ui.$('continuation').hidden,false);assert.equal(ui.$('select-claude').disabled,false);assert.match(ui.$('continuation-text').textContent,/usage limit/i);assert.match(ui.$('continue-button').textContent,/^Continue with Claude/);
  assert.equal(ui.state().provider,'codex','A limit does not silently switch the selected assistant.');assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
  ui.$('continue-button').click();await flush();const continuation=ui.requests.filter(request=>request.path.endsWith('/continue'));assert.equal(continuation.length,1);assert.equal(continuation[0].body.provider,'claude');assert.equal(conversation.provider,'claude');
  conversation.status='running';conversation.activeRun={provider:'codex'};await ui.window.relayUI.refresh();
  assert.equal(ui.$('conversation-state').textContent,'Running');assert.equal(ui.$('continuation').hidden,true);assert.equal(ui.$('stop-button').hidden,false);
  conversation.pendingApprovals=[{id:'approval-one',runId:'run-one',provider:'codex',kind:'command',command:'git status'}];await ui.window.relayUI.refresh();
  assert.equal(ui.$('conversation-state').textContent,'Approval required');
});

test('a failed Approve or Deny is shown on the page, and a request that is no longer pending disappears',async()=>{
  const ui=await browser({workbench:true}),conversation=ui.canonical.get('project-one'),answers=[];
  const cards=()=>ui.$('pending-approvals')?.querySelectorAll('article')||[],choice=text=>cards()[0].querySelectorAll('button').find(button=>button.textContent===text);
  conversation.status='running';conversation.activeRun={provider:'codex'};conversation.pendingApprovals=[{id:'approval-one',runId:'run-one',provider:'codex',kind:'command',command:'git status'}];await ui.window.relayUI.refresh();
  // The run has already moved on, so the server no longer holds this request.
  ui.setIntercept((request,next)=>{if(!request.path.endsWith('/approval'))return next();answers.push(request.body);conversation.pendingApprovals=[];return response({error:'This approval is no longer pending.'},409);});
  choice('Approve').click();await flush();
  assert.deepEqual(answers,[{runId:'run-one',approvalId:'approval-one',allow:true}]);assert.equal(ui.$('notice').hidden,false);assert.equal(ui.$('notice-text').textContent,'This approval is no longer pending.');assert.equal(cards().length,0,'The stale request disappears.');
  // A failure while the request is still pending keeps the card, and its buttons work again.
  conversation.pendingApprovals=[{id:'approval-two',runId:'run-one',provider:'codex',kind:'command',command:'npm test'}];await ui.window.relayUI.refresh();
  ui.setIntercept((request,next)=>{if(!request.path.endsWith('/approval'))return next();answers.push(request.body);return response({error:'Local server error.'},500);});
  choice('Deny').click();choice('Deny').click();await flush();
  assert.equal(answers.length,2,'A second click while the answer is being sent does nothing.');assert.deepEqual(answers[1],{runId:'run-one',approvalId:'approval-two',allow:false});
  assert.equal(ui.$('notice-text').textContent,'Local server error.');assert.equal(cards().length,1);assert.equal(choice('Deny').disabled,false);assert.equal(ui.$('workbench-error').hidden,true);
});

test('shipped markup has one conversation header and retains distinct primary controls',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const tags=[...html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)];
  const ids=tags.map(match=>match[2]);assert.equal(new Set(ids).size,ids.length,'Control IDs must be unique.');
  for(const id of ['create-workspace','add-first-project','ask-friend','open-setup','relay-settings','connect-assistant','connection-action'])assert.equal(ids.filter(value=>value===id).length,1,'Expected one '+id+' control.');
  assert.equal([...html.matchAll(/class="conversation-header"/g)].length,1);assert.doesNotMatch(html,/class="topbar"/);
  const tag=id=>tags.find(match=>match[2]===id)?.[0]||'';
  assert.match(tag('add-project'),/\bhidden(?:\s|>|=)/);assert.doesNotMatch(tag('create-workspace'),/\bhidden(?:\s|>|=)/);
  assert.match(tag('project-select'),/aria-hidden="true"/);assert.match(tag('project-select'),/tabindex="-1"/);
});

test('composer model and effort choices use provider metadata and save without sending a prompt',async()=>{
  const ui=await browser({insights:true});assert.equal(ui.$('model-select').disabled,false);assert.equal(ui.$('effort-select').disabled,false);
  ui.$('model-select').value='model-one';ui.fire('model-select','change');await flush();ui.$('effort-select').value='high';ui.fire('effort-select','change');await flush();
  assert.equal(ui.state().model,'model-one');assert.equal(ui.state().effort,'high');assert.match(ui.$('model-description').textContent,/Model One.*High/);
  const saved=ui.requests.filter(request=>request.path.endsWith('/provider')).at(-1);assert.equal(saved.body.effort,'high');assert.equal(saved.body.model,'model-one');assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
  ui.$('model-select').value='model-two';ui.fire('model-select','change');await flush();assert.equal(ui.state().effort,null);assert.deepEqual(ui.$('effort-select').children.map(option=>option.value),['','low','medium']);
  ui.$('model-select').value='model-one';ui.fire('model-select','change');await flush();assert.equal(ui.state().effort,'high');
});

test('a custom model can be entered in the composer without starting inference',async()=>{
  const ui=await browser({insights:true});ui.$('model-select').value='__custom__';ui.fire('model-select','change');await flush();assert.equal(ui.$('custom-model-editor').hidden,false);ui.$('custom-model-input').value='custom-model-id';ui.$('save-custom-model').click();await flush();assert.equal(ui.state().model,'custom-model-id');assert.equal(ui.$('model-select').value,'custom-model-id');assert.equal(ui.$('custom-model-editor').hidden,true);assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
});

test('Enter in the custom model field saves the model instead of sending the draft',async()=>{
  const ui=await browser({insights:true});ui.$('message-input').value='Draft for the new model';ui.$('model-select').value='__custom__';ui.fire('model-select','change');await flush();
  ui.$('custom-model-input').value='custom-model-id';const enter=new UIEvent('keydown',{key:'Enter'});ui.$('custom-model-input').dispatchEvent(enter);await flush();
  assert.equal(enter.defaultPrevented,true,'The field is inside the composer form, so an unhandled Enter submits the draft.');assert.equal(ui.state().model,'custom-model-id');assert.equal(ui.$('custom-model-editor').hidden,true);assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
});

test('Git inspector sends workspace-scoped reads and shows changes and commit history',async()=>{
  const ui=await browser({insights:true});ui.$('open-git').click();await flush();assert.equal(ui.$('git-panel').hidden,false);assert.match(ui.$('git-summary').textContent,/feature\/design/);assert.match(ui.$('git-content').textContent,/app.js/);
  const request=ui.requests.find(row=>row.path==='/api/git');assert.equal(request.projectId,'project-one');assert.equal(request.method,'GET');ui.$('git-commits-tab').click();await flush();assert.match(ui.$('git-content').textContent,/Improve workspace navigation/);ui.$('close-git').click();assert.equal(ui.$('git-panel').hidden,true);
});

test('Git panel stays open on wide layouts unless closed, and changed files open a line diff',async()=>{
  const ui=await browser({insights:true,wide:true});assert.equal(ui.$('git-panel').hidden,false,'Docked layouts open Git activity by default.');await flush();assert(ui.requests.some(row=>row.path==='/api/git'));
  const file=ui.document.querySelectorAll('.git-file')[0];assert.equal(file.tagName,'BUTTON');file.click();await flush();
  const diff=ui.requests.find(row=>row.path==='/api/git/diff');assert.equal(diff.projectId,'project-one');assert.equal(ui.$('diff-dialog').open,true);assert.equal(ui.$('diff-title').textContent,'app.js');
  const lines=ui.document.querySelectorAll('.diff-line');assert.deepEqual(lines.map(line=>line.className.replace('diff-line ','')),['hunk','context','del','add']);assert.equal(lines[2].children.at(-1).textContent,'-- old SQL comment','Removed lines that start with dashes are content, not file headers.');assert.match(ui.$('diff-meta').textContent,/\+1 -1/);
  ui.$('close-git').click();assert.equal(ui.storage.get('ai-relay:git-panel'),'closed');
  const closed=await browser({insights:true,wide:true,stored:{'ai-relay:git-panel':'closed'}});assert.equal(closed.$('git-panel').hidden,true,'A closed panel stays closed.');
  const narrow=await browser({insights:true});assert.equal(narrow.$('git-panel').hidden,true,'Overlay layouts start with the panel closed.');
});

test('plan usage shows remaining percent for both agents and the selected model',async()=>{
  const windows={codex:{provider:'codex',available:true,windows:[{id:'primary',label:'5-hour',usedPercent:80,resetsAt:null},{id:'secondary',label:'Weekly',usedPercent:18,resetsAt:null}]},claude:{provider:'claude',available:true,windows:[{id:'five_hour',label:'5-hour',usedPercent:20,resetsAt:null},{id:'seven_day_opus',label:'Weekly · Opus',usedPercent:95,resetsAt:null,scope:'opus'}]}};
  const ui=await browser({insights:true,usage:windows});await ui.window.relayUI.refreshAccounts({force:true});await flush();
  assert.equal(ui.$('codex-usage').hidden,false);assert.match(ui.$('codex-usage').textContent,/5h.*20% left/);assert.doesNotMatch(ui.$('codex-usage').textContent,/82%/,'The footer shows only the tightest window; the card lists all of them.');assert.match(ui.$('claude-usage').textContent,/5h.*80% left/);assert.doesNotMatch(ui.$('claude-usage').textContent,/Opus/,'Model-specific limits appear only for that model.');
  assert.equal(ui.$('usage-chip').textContent,'5h · 20% left');assert.match(ui.$('usage-chip').className,/\blow\b/);
  ui.$('select-claude').click();await flush();ui.state().model='claude-opus';ui.window.dispatchEvent(new UIEvent('relay-state'));assert.equal(ui.$('usage-chip').textContent,'Opus · 5% left');assert.match(ui.$('usage-chip').className,/critical/);
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0,'Reading usage never starts inference.');
});

test('separate Claude and Codex chats merge by time into the current workspace after review, without inference',async()=>{
  const ui=await browser({historyUI:true,setup:true});const id=ui.state().conversation.id;ui.canonical.get('project-one').messages.push({id:'existing',role:'user',text:'Keep existing history'});
  assert.equal(ui.$('previous-chats-notice').hidden,false);assert.match(ui.$('previous-chats-text').textContent,/Found 2 previous conversations/);
  assert.equal(ui.$('import-dialog').open,false,'Discovery suggests chats without interrupting the workspace.');
  ui.$('review-previous-chats').click();await flush();assert.equal(ui.$('import-dialog').open,true);assert.equal(ui.$('import-workspace-name').textContent,'Example workspace');assert.equal(ui.$('confirm-import').disabled,true);
  const lists=ui.requests.filter(row=>row.path==='/api/import-sources');assert.deepEqual(lists.map(row=>row.params.provider).sort(),['claude','codex']);assert(lists.every(row=>row.params.scope==='workspace'&&row.params.projectId==='project-one'));
  const sessions=ui.document.querySelectorAll('.import-session');assert.equal(sessions.length,2);assert.ok(sessions.every(session=>session.getAttribute('aria-checked')==='false'),'Nothing is selected automatically.');for(const session of sessions)session.click();await flush();
  assert.match(ui.$('import-preview').textContent,/2 conversations, merged by time/);assert.match(ui.$('import-preview').textContent,/Plan the API.*Build the API.*Claude planned it.*Codex built it/s,'The preview interleaves both chats in original time order.');
  assert.equal(ui.$('confirm-import').disabled,true,'Importing requires confirming the review.');ui.$('import-confirm').checked=true;ui.fire('import-confirm','change');assert.equal(ui.$('confirm-import').disabled,false);
  ui.$('confirm-import').click();await flush();
  const sent=ui.requests.find(row=>row.path==='/api/import-sources/import');assert.equal(sent.body.projectId,'project-one');assert.deepEqual(sent.body.sessions.map(row=>row.approvedDigest).sort(),['digest-claude-one','digest-codex-one']);
  assert.equal(ui.state().conversation.id,id);assert.deepEqual([...ui.state().conversation.messages.map(row=>row.text)],['Keep existing history','Plan the API','Build the API','Claude planned it','Codex built it']);
  assert.match(ui.$('import-result').textContent,/Merged 4 messages into Example workspace/);assert.equal(ui.$('import-dialog').open,false);assert.equal(ui.$('previous-chats-notice').hidden,true);assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
});

test('Not now is saved for its workspace and previous chats stay available manually',async()=>{
  const ui=await browser({insights:true,setup:true,moreProjects:true});
  assert.equal(ui.$('previous-chats-notice').hidden,false);ui.$('dismiss-previous-chats').click();await flush();
  const dismissal=ui.requests.find(request=>request.path==='/api/projects/project-one'&&request.body?.previousConversationsDismissed);
  assert(dismissal);assert.equal(ui.projects[0].previousConversationsDismissed,true);assert.equal(ui.projects[0].name,'Example workspace');assert.equal(ui.$('previous-chats-notice').hidden,true);
  await ui.switchProject('project-two');assert.equal(ui.$('previous-chats-notice').hidden,true);
  await ui.switchProject('project-one');await ui.window.relayUI.refreshProjects();await flush();assert.equal(ui.$('previous-chats-notice').hidden,true);
  assert.equal(ui.requests.filter(request=>request.path==='/api/import-sources'&&request.projectId==='project-one').length,2,'Returning to a dismissed workspace does not repeat discovery.');
  ui.$('open-import').click();await flush();assert.equal(ui.$('import-dialog').open,true);assert.equal(ui.document.querySelectorAll('.import-session').length,2);
});

test('late discovery results stay with their workspace, and the empty workspace is not prompted',async()=>{
  const ui=await browser({insights:true,moreProjects:true}),held=deferred();
  ui.setIntercept((request,next)=>request.path==='/api/import-sources'&&request.projectId==='project-one'?held.promise.then(next):next());
  ui.window.dispatchEvent(new UIEvent('relay-setup-ready'));await flush();assert.equal(ui.$('previous-chats-notice').hidden,true);
  await ui.switchProject('project-two');assert.equal(ui.$('previous-chats-notice').hidden,true);
  held.resolve();await flush();assert.equal(ui.state().projectId,'project-two');assert.equal(ui.$('previous-chats-notice').hidden,true,'Another project’s conversations never appear in the current workspace.');
  await ui.switchProject('project-one');assert.match(ui.$('previous-chats-text').textContent,/Found 2 previous conversations/);
  assert.equal(ui.requests.filter(request=>request.path==='/api/import-sources'&&request.projectId==='project-one').length,2,'Completed discovery is reused for this session.');
  ui.$('review-previous-chats').click();await flush();await ui.switchProject('project-two');assert.equal(ui.$('import-dialog').open,false,'Changing workspaces closes the previous workspace’s review.');
});

test('discovery ignores already merged chats and rechecks when workspace folders change',async()=>{
  const ui=await browser({insights:true});
  ui.setIntercept(async(request,next)=>{
    const result=next();if(request.path!=='/api/import-sources')return result;
    const payload=JSON.parse(await result.text());payload.sessions=payload.sessions.map(session=>({...session,imported:true}));return response(payload);
  });
  ui.window.dispatchEvent(new UIEvent('relay-setup-ready'));await flush();assert.equal(ui.$('previous-chats-notice').hidden,true);
  ui.$('open-import').click();await flush();assert.match(ui.$('import-list').textContent,/Previously merged/);assert.equal(ui.$('confirm-import').disabled,true);ui.$('close-import').click();
  ui.setIntercept(null);ui.projects[0].folders=[{id:'new',name:'new-app',path:'/workspace/new-app',available:true}];await ui.window.relayUI.refreshProjects();await flush();
  assert.match(ui.$('previous-chats-text').textContent,/Found 1 previous conversation/);ui.$('review-previous-chats').click();await flush();
  assert.match(ui.$('import-list').textContent,/Start new app/);assert.doesNotMatch(ui.$('import-list').textContent,/Plan the API/);
});

test('background discovery failures stay quiet, and a failed dismissal does not hide the suggestion permanently',async()=>{
  const ui=await browser({insights:true});
  ui.setIntercept((request,next)=>request.path==='/api/import-sources'?response({error:'Local history is unavailable.'},503):next());
  ui.window.dispatchEvent(new UIEvent('relay-setup-ready'));await flush();assert.equal(ui.$('previous-chats-notice').hidden,true);assert.equal(ui.$('notice').hidden,true);assert.equal(ui.$('import-dialog').open,false);
  ui.$('open-import').click();await flush();assert.match(ui.$('import-error').textContent,/Local history is unavailable/);
  ui.setIntercept(null);ui.$('refresh-imports').click();await flush();assert.equal(ui.document.querySelectorAll('.import-session').length,2);ui.$('close-import').click();
  const other=await browser({insights:true,setup:true});
  other.setIntercept((request,next)=>request.path==='/api/projects/project-one'&&request.method==='POST'?response({error:'Could not save preferences.'},503):next());
  other.$('dismiss-previous-chats').click();await flush();assert.equal(other.$('previous-chats-notice').hidden,false);assert.match(other.$('notice-text').textContent,/Could not save this choice/);
  assert.equal(other.projects[0].previousConversationsDismissed,undefined);
});

test('the setup launcher shows only while setup is unfinished, and Settings reopens the guide',async()=>{
  const fresh=await browser({setup:true,savedPreferences:{onboarding:{step:1}}});assert.equal(fresh.$('open-setup').hidden,false);assert.equal(fresh.$('setup-dialog').open,false,'Setup does not interrupt someone who already has workspaces.');
  fresh.$('open-setup').click();await flush();assert.equal(fresh.$('setup-dialog').dataset.screen,'flow','Resuming skips the welcome.');assert.match(fresh.$('setup-step-status').textContent,/2 of 3/);assert.equal(fresh.$('close-setup').textContent,'Skip for now');
  fresh.$('close-setup').click();await flush();assert.equal(fresh.$('setup-dialog').open,false);assert.equal(fresh.$('open-setup').hidden,true,'Closing setup removes the sidebar launcher.');
  const done=await browser({setup:true,workbench:true,savedPreferences:{onboarding:{step:2,completedAt:'2026-10-29T00:00:00.000Z'}}});assert.equal(done.$('open-setup').hidden,true);
  done.$('relay-settings').click();await flush();assert.equal(done.$('workbench').open,true);done.$('open-setup-guide').click();await flush();
  assert.equal(done.$('workbench').open,false);assert.equal(done.$('setup-dialog').open,true);assert.match(done.$('setup-step-status').textContent,/1 of 3/,'The guide starts from the beginning once setup is complete.');
  assert.equal(done.$('close-setup').textContent,'Close');assert.equal(done.$('setup-back').disabled,true);
  done.$('setup-next').click();await flush();done.$('setup-next').click();await flush();assert.equal(done.$('setup-next').textContent,'Done');
  done.$('setup-next').click();await flush();assert.equal(done.$('setup-dialog').open,false,'Reviewing skips the welcome and the summary.');
});

test('export shows what a shareable conversation file contains before saving it',async()=>{
  const ui=await browser({historyUI:true});assert.equal(ui.$('open-export').disabled,true,'There is nothing to export yet.');
  ui.canonical.get('project-one').messages.push({id:'m1',role:'user',text:'Plan checkout'});await ui.window.relayUI.refresh();assert.equal(ui.$('open-export').disabled,false);
  ui.$('open-export').click();await flush();assert.equal(ui.$('export-dialog').open,true);
  let request=ui.requests.filter(row=>row.path==='/api/conversation/export').at(-1);assert.equal(request.projectId,'project-one');assert.equal(request.params.redact,'1');assert.equal(request.params.activity,'0');assert.equal(request.params.range,'all');
  assert.match(ui.$('export-summary').textContent,/Cleaned 1 message with possible secrets/);assert.equal(ui.$('export-download').disabled,false);
  ui.$('export-redact').checked=false;ui.fire('export-redact','change');await flush();request=ui.requests.filter(row=>row.path==='/api/conversation/export').at(-1);assert.equal(request.params.redact,'0');assert.match(ui.$('export-summary').textContent,/Review before sharing/);
  ui.$('export-download').click();ui.$('export-markdown').click();assert.equal(ui.requests.filter(row=>/\/(?:messages|continue)$/.test(row.path)).length,0);
});

test('a shared conversation file merges into the open workspace without another destination or folder step',async()=>{
  const ui=await browser({insights:true});ui.$('open-import').click();await flush();
  const shared={schema:'ai-relay.conversation',version:1,id:'shared-one',exportedAt:'2026-10-21T00:00:00.000Z',workspace:{name:'Shop',folders:['web']},messages:[{id:'s1',role:'user',text:'Ship it',createdAt:'2026-10-20T09:00:00.000Z'},{id:'s2',role:'assistant',provider:'claude',text:'Shipped',createdAt:'2026-10-20T09:01:00.000Z'}],digest:'from-sender'};
  ui.$('import-file').files=[{size:600,text:async()=>JSON.stringify(shared)}];ui.fire('import-file','change');await flush();
  assert.equal(ui.requests.find(row=>row.path==='/api/import-sources/file-preview').body.package.id,'shared-one');
  assert.match(ui.$('import-preview').textContent,/import files only from people you trust/);assert.match(ui.$('import-preview').textContent,/User.*Ship it.*Claude.*Shipped/s);
  assert.equal(ui.$('import-workspace-name').textContent,'Example workspace');assert.equal(ui.$('import-target'),null);assert.equal(ui.$('import-folder-path'),null);
  ui.$('import-confirm').checked=true;ui.fire('import-confirm','change');assert.equal(ui.$('confirm-import').disabled,false);ui.$('confirm-import').click();await flush();
  const sent=ui.requests.find(row=>row.path==='/api/import-sources/import');assert.equal(sent.body.projectId,'project-one');assert.equal(sent.body.files[0].approvedDigest,'digest-shared-one');assert.equal(sent.body.sessions.length,0);
  assert.equal(ui.projects.length,1);assert.equal(ui.state().projectId,'project-one');assert.deepEqual([...ui.state().conversation.messages.map(row=>row.text)],['Ship it','Shipped']);assert.equal(ui.requests.filter(row=>/\/(?:messages|continue)$/.test(row.path)).length,0);
});

test('a multi-folder workspace lists its folders and the Files view shows only the selected one',async()=>{
  const ui=await browser({filesUI:true,insights:true});const picks=ui.document.querySelectorAll('.workspace-folder-pick');
  assert.deepEqual([...picks.map(pick=>pick.textContent)],['Frontend','Backend']);assert.equal(picks[0].getAttribute('aria-pressed'),'true');
  assert.deepEqual([...ui.document.querySelectorAll('.tree-root').map(root=>root.textContent)],['Frontend'],'Only the selected folder is browsed.');
  picks[1].click();await flush();assert.deepEqual([...ui.document.querySelectorAll('.tree-root').map(root=>root.textContent)],['Backend']);
  assert.equal(ui.storage.get('ai-relay:folder:project-one'),'backend');assert.equal(ui.document.querySelectorAll('.workspace-folder-pick')[1].getAttribute('aria-pressed'),'true');
  assert.equal(ui.document.querySelectorAll('.workspace-folder-disclosure').length,0,'Folder management lives in Workspace settings.');assert(ui.$('workspace-folder-settings').textContent.includes('Add folder'));
});

test('changing export options keeps the current summary in place until the new one is ready',async()=>{
  const ui=await browser({insights:true});ui.canonical.get('project-one').messages.push({id:'m1',role:'user',text:'Plan checkout'});await ui.window.relayUI.refresh();
  ui.$('open-export').click();await flush();assert.match(ui.$('export-summary').textContent,/Messages/);
  const gate=deferred();ui.setIntercept(async(request,next)=>{if(request.path==='/api/conversation/export'&&request.params.activity==='1')await gate.promise;return next();});
  ui.$('export-activity').checked=true;ui.fire('export-activity','change');await flush();
  assert.match(ui.$('export-summary').textContent,/Messages/,'The summary is not swapped for a loading line, so the dialog keeps its size.');assert.equal(ui.$('export-summary').getAttribute('aria-busy'),'true');assert.equal(ui.$('export-download').disabled,true);
  gate.resolve();await flush();assert.equal(ui.$('export-summary').getAttribute('aria-busy'),null);assert.equal(ui.$('export-download').disabled,false);
});

test('code blocks are syntax colored without parsing HTML',async()=>{
  const ui=await browser();ui.canonical.get('project-one').messages.push({id:'a1',role:'assistant',provider:'codex',text:'Try this:\n```js\nconst total = sum(items); // <b>not markup</b>\n```'});await ui.window.relayUI.refresh();
  const kinds=ui.document.querySelectorAll('.code-block')[0].querySelectorAll('span').map(span=>span.className+':'+span.textContent);
  assert(kinds.includes('tok-keyword:const'));assert(kinds.includes('tok-function:sum'));assert(kinds.includes('tok-comment:// <b>not markup</b>'));
});

test('code blocks labelled with built-in object property names render as plain code',async()=>{
  const ui=await browser();ui.canonical.get('project-one').messages.push({id:'a1',role:'assistant',provider:'codex',text:'```constructor\nconst a = 1;\n```\n\n```__proto__\nlet b = 2;\n```\n\n```toString\nvar c = 3;\n```'});await ui.window.relayUI.refresh();
  assert.deepEqual(ui.document.querySelectorAll('.code-block').map(block=>block.querySelector('code').textContent),['const a = 1;\n','let b = 2;\n','var c = 3;\n']);
});

test('Find in the conversation matches text across formatting, skips interface labels and moves between matches',async()=>{
  const ui=await browser({searchUI:true});ui.canonical.get('project-one').messages.push({id:'u1',role:'user',text:'Where is the retry limit set?'},{id:'a1',role:'assistant',provider:'codex',text:'The **retry** limit is in `config.js`:\n```js\nconst retryLimit = 3;\n```'},{id:'u2',role:'user',text:'Raise the RETRY limit to 5.'});await ui.window.relayUI.refresh();
  const find=new UIEvent('keydown',{key:'f',ctrlKey:true});ui.document.dispatchEvent(find);assert.equal(find.defaultPrevented,true);assert.equal(ui.$('conversation-search').hidden,false);assert.equal(ui.document.activeElement,ui.$('conversation-search-input'));
  const search=async text=>{ui.$('conversation-search-input').value=text;ui.fire('conversation-search-input','input');await flush();},key=(key,shiftKey=false)=>ui.$('conversation-search-input').dispatchEvent(new UIEvent('keydown',{key,shiftKey})),texts=name=>[...ui.highlights.get(name)||[]].map(ui.rangeText),count=()=>ui.$('conversation-search-count').textContent;
  await search('retry');assert.deepEqual(texts('conversation-search'),['retry','retry','retry','RETRY']);assert.equal(count(),'1 of 4');assert.deepEqual(texts('conversation-search-current'),['retry']);
  key('Enter');assert.equal(count(),'2 of 4');key('Enter',true);key('Enter',true);assert.equal(count(),'4 of 4','Moving back from the first match wraps to the last.');assert.deepEqual(texts('conversation-search-current'),['RETRY']);
  await search('const retry');assert.deepEqual(texts('conversation-search'),['const retry'],'A match can span syntax-colored tokens.');
  await search('js');assert.equal(count(),'1 of 1','The code block language label is not conversation text.');
  await search('codex');assert.equal(count(),'No results','Author names, times and buttons are not conversation text.');assert.equal(texts('conversation-search').length,0);
});

test('Find in the conversation reveals a collapsed activity match, follows re-renders and Escape returns to the composer',async()=>{
  const ui=await browser({searchUI:true}),chat=ui.canonical.get('project-one');chat.messages.push({id:'u1',role:'user',text:'Run the tests'},{id:'t1',role:'activity',text:'Ran npm test: 12 passed'},{id:'a1',role:'assistant',provider:'codex',text:'All tests pass.'});await ui.window.relayUI.refresh();
  ui.document.dispatchEvent(new UIEvent('keydown',{key:'f',ctrlKey:true}));const search=async text=>{ui.$('conversation-search-input').value=text;ui.fire('conversation-search-input','input');await flush();};
  await search('workspace activity');assert.equal(ui.$('conversation-search-count').textContent,'No results','The group summary is not conversation text.');assert.equal(ui.document.querySelector('.activity-group').open,false);
  await search('npm test');
  assert.equal(ui.$('conversation-search-count').textContent,'1 of 1');assert.equal(ui.document.querySelector('.activity-group').open,true,'The collapsed group holding the match opens.');
  chat.messages.push({id:'a2',role:'assistant',provider:'codex',text:'Run npm test again after the change.'});await ui.window.relayUI.refresh();
  const attached=node=>{for(let current=node;current;current=current.parentNode)if(current===ui.$('messages'))return true;return false;};
  assert.equal(ui.$('conversation-search-count').textContent,'1 of 2');assert.equal(ui.document.querySelector('.activity-group').open,true);assert([...ui.highlights.get('conversation-search')].every(range=>attached(range.startContainer)),'Highlights move to the re-rendered messages.');
  const escape=new UIEvent('keydown',{key:'Escape'});ui.$('conversation-search-input').dispatchEvent(escape);
  assert.equal(escape.defaultPrevented,true);assert.equal(ui.$('conversation-search').hidden,true);assert.equal(ui.highlights.size,0);assert.equal(ui.document.activeElement,ui.$('message-input'));
});

test('Find in the conversation starts from the match in view, or the closest one above it',async()=>{
  const ui=await browser({searchUI:true});ui.canonical.get('project-one').messages.push({id:'u1',role:'user',text:'retry one'},{id:'u2',role:'user',text:'retry two'},{id:'u3',role:'user',text:'retry three'});await ui.window.relayUI.refresh();
  const place=tops=>ui.document.querySelectorAll('.message-text').forEach((node,index)=>{node.bounds={top:tops[index],bottom:tops[index]+20,height:20};});ui.$('messages-scroll').bounds={top:100,bottom:600,height:500};
  const search=async text=>{ui.$('conversation-search-input').value=text;ui.fire('conversation-search-input','input');await flush();},count=()=>ui.$('conversation-search-count').textContent;
  ui.document.dispatchEvent(new UIEvent('keydown',{key:'f',ctrlKey:true}));place([-400,200,900]);
  const before=ui.$('messages-scroll').scrollTop;await search('retry');assert.equal(count(),'2 of 3');assert.equal(ui.$('messages-scroll').scrollTop,before,'A match already in view does not scroll.');
  place([-900,-600,-300]);await search('retry t');assert.equal(count(),'2 of 2','With every match above the view, the closest one is current.');
  assert.equal(ui.$('messages-scroll').scrollTop,before-300-100-(500-20)/2,'The current match is scrolled to the middle of the view.');
});

test('Find in the conversation closes when another workspace opens',async()=>{
  const ui=await browser({searchUI:true,moreProjects:true});ui.canonical.get('project-one').messages.push({id:'u1',role:'user',text:'Check the retry limit'});await ui.window.relayUI.refresh();
  ui.document.dispatchEvent(new UIEvent('keydown',{key:'f',ctrlKey:true}));ui.$('conversation-search-input').value='retry';ui.fire('conversation-search-input','input');await flush();assert.equal(ui.$('conversation-search-count').textContent,'1 of 1');
  await ui.switchProject('project-two');assert.equal(ui.$('conversation-search').hidden,true,'Matches from the previous conversation are gone.');assert.equal(ui.highlights.size,0);
});

test('previous chats require an open workspace, with other projects available only by explicit choice',async()=>{
  const empty=await browser({insights:true,empty:true});assert.equal(empty.$('project-empty-state').hidden,false);assert.equal(empty.$('open-import').disabled,true);assert.equal(empty.$('import-first'),null);
  empty.$('open-import').click();await flush();assert.equal(empty.$('import-dialog').open,false);assert.equal(empty.requests.filter(request=>request.path==='/api/import-sources').length,0);
  const ui=await browser({insights:true});ui.$('open-import').click();await flush();assert.equal(ui.document.querySelectorAll('.import-session').length,2);assert.doesNotMatch(ui.$('import-list').textContent,/Start new app/);
  ui.document.querySelectorAll('[data-import-scope]').find(button=>button.dataset.importScope==='all').click();await flush();
  const session=ui.document.querySelectorAll('.import-session').find(button=>/Start new app/.test(button.textContent));assert(session);assert.equal(session.getAttribute('aria-checked'),'false');assert.equal(ui.$('confirm-import').disabled,true);
  session.click();await flush();ui.$('import-confirm').checked=true;ui.fire('import-confirm','change');ui.$('confirm-import').click();await flush();
  const sent=ui.requests.find(row=>row.path==='/api/import-sources/import');assert.equal(sent.body.projectId,'project-one');assert.equal(ui.projects.length,1);assert.equal(ui.state().projectId,'project-one');
});

test('run indicators distinguish reasoning, quiet providers, approvals, and real token counts',async()=>{
  const ui=await browser({insights:true}),c=ui.canonical.get('project-one');c.status='running';c.activeRun={provider:'codex',phase:'reasoning',startedAt:new Date(Date.now()-50000).toISOString(),lastEventAt:new Date().toISOString(),effectiveModel:'model-one',effort:'high',usage:{total:{inputTokens:100,outputTokens:20}}};await ui.window.relayUI.refresh();
  assert.equal(ui.$('run-phase').textContent,'Reasoning');assert.match(ui.$('run-detail').textContent,/reported reasoning activity/);assert.match(ui.$('run-metrics').textContent,/100 input tokens/);assert.equal(ui.$('model-select').disabled,true);
  c.activeRun.lastEventAt=new Date(Date.now()-40000).toISOString();await ui.window.relayUI.refresh();assert.equal(ui.$('run-phase').textContent,'Waiting for provider');assert.match(ui.$('run-detail').textContent,/No provider activity/);assert.doesNotMatch(ui.$('run-detail').textContent,/stuck/i);
  c.pendingApprovals=[{id:'approval'}];await ui.window.relayUI.refresh();assert.equal(ui.$('run-phase').textContent,'Waiting for approval');
});

test('workspace removal confirms, switches safely, and Undo restores the same chat and draft', async()=>{
  const ui=await browser({moreProjects:true}), chatId=ui.state().conversation.id;
  ui.$('message-input').value='Keep my draft';ui.fire('message-input','input');
  ui.document.querySelectorAll('.workspace-options')[0].click();ui.$('workspace-remove').click();
  assert.equal(ui.$('remove-workspace-dialog').open,true);assert.equal(ui.$('remove-workspace-name').textContent,'Example workspace');
  assert.equal(ui.document.activeElement,ui.$('cancel-remove-workspace'));
  ui.$('cancel-remove-workspace').click();await flush();
  assert.equal(ui.$('remove-workspace-dialog').open,false);assert.equal(ui.projects.length,2);
  ui.document.querySelectorAll('.workspace-options')[0].click();ui.$('workspace-remove').click();ui.$('confirm-remove-workspace').click();await flush();
  assert.equal(ui.projects.length,1);assert.equal(ui.state().projectId,'project-two');assert.equal(ui.$('workspace-count').textContent,'1');
  assert.equal(ui.$('remove-workspace-dialog').open,false);assert.equal(ui.$('notice-retry').textContent,'Undo');
  ui.$('notice-retry').click();await flush();
  assert.equal(ui.projects.length,2);assert.equal(ui.state().projectId,'project-one');assert.equal(ui.state().conversation.id,chatId);
  assert.equal(ui.$('message-input').value,'Keep my draft');assert.equal(ui.chatCreations,2);
});

test('last workspace removal clears stale refreshes and Undo restores it', async()=>{
  const ui=await browser(),held=deferred(),chatId=ui.state().conversation.id;let waiting=false;
  ui.setIntercept((request,next)=>{if(!waiting&&request.path==='/api/conversation'){waiting=true;const result=next();return held.promise.then(()=>result);}return next();});
  const refresh=ui.window.relayUI.refresh();await flush();
  ui.document.querySelectorAll('.workspace-options')[0].click();ui.$('workspace-remove').click();ui.$('confirm-remove-workspace').click();await flush();
  assert.equal(ui.state().projectId,null);assert.equal(ui.$('project-empty-state').hidden,false);assert.equal(ui.$('composer-region').hidden,true);
  assert.equal(ui.$('workspace-count').textContent,'0');held.resolve();await refresh;await flush();assert.equal(ui.state().conversation,null);
  ui.$('notice-retry').click();await flush();assert.equal(ui.state().conversation.id,chatId);assert.equal(ui.$('project-empty-state').hidden,true);
});

test('workspace removal failures keep the dialog and current chat; accepted response loss can be retried',async()=>{
  const ui=await browser(),chatId=ui.state().conversation.id;let blocked=true,lost=false;
  ui.setIntercept((request,next)=>{if(request.path.endsWith('/project-one/remove')){if(blocked)return response({error:'Stop the current run before removing this workspace.'},409);const result=next();if(!lost){lost=true;throw new Error('Response lost');}return result;}return next();});
  ui.document.querySelectorAll('.workspace-options')[0].click();ui.$('workspace-remove').click();ui.$('confirm-remove-workspace').click();await flush();
  assert.equal(ui.$('remove-workspace-dialog').open,true);assert.equal(ui.$('remove-workspace-error').hidden,false);assert.equal(ui.state().conversation.id,chatId);
  blocked=false;ui.$('confirm-remove-workspace').click();await flush();assert.equal(ui.$('remove-workspace-dialog').open,true);
  ui.$('confirm-remove-workspace').click();await flush();assert.equal(ui.state().projectId,null);assert.equal(ui.$('notice-retry').textContent,'Undo');
});

const palette=ui=>ui.document.documentElement.getAttribute('data-theme');
const themeColor=ui=>ui.document.querySelector('meta[name="theme-color"]').getAttribute('content');
const pressedAppearance=(ui,scope=ui.document)=>scope.querySelectorAll('[data-appearance]').filter(button=>button.getAttribute('aria-pressed')==='true').map(button=>button.dataset.appearance);
// Setup cards are read by their labels, which earlier versions share.
const pressedCards=ui=>ui.document.querySelectorAll('.setup-theme').filter(card=>card.getAttribute('aria-pressed')==='true').map(card=>card.querySelector('strong').textContent);
const appearanceSaves=ui=>ui.requests.filter(request=>request.path==='/api/appearance'&&request.method==='POST').map(request=>request.body.theme);
const appearanceButton=(ui,value)=>{const button=ui.document.querySelectorAll('[data-appearance]').find(item=>item.dataset.appearance===value);assert(button,'Missing appearance choice: '+value);return button;};

test('first run welcomes, walks through three steps and a summary, saves real choices and never starts a provider run',async()=>{
  const ui=await browser({empty:true,existing:false,setup:true,insights:true,theme:true}),dialog=ui.$('setup-dialog');
  await flush();
  assert.equal(dialog.open,true);assert.equal(dialog.dataset.screen,'welcome');assert.equal(ui.$('setup-flow').hidden,true);assert.match(ui.$('setup-hero-content').textContent,/Your workspace for AI coding agents/);
  assert.equal(ui.$('launch-screen').classList.contains('done'),true,'The launch screen gives way once setup knows what to show.');
  ui.document.querySelector('.onboarding-cta').click();await flush();
  assert.equal(dialog.dataset.screen,'flow');assert.equal(ui.$('setup-hero').hidden,true);assert.match(ui.$('setup-step-status').textContent,/1 of 3/);assert.match(ui.$('setup-content').textContent,/your subscription/);
  ui.$('setup-back').click();await flush();assert.equal(dialog.dataset.screen,'welcome','Back from the first step returns to the welcome.');ui.document.querySelector('.onboarding-cta').click();await flush();
  ui.document.querySelectorAll('.setup-agent-select').find(button=>button.textContent.startsWith('Claude')).click();await flush();ui.$('setup-next').click();await flush();
  assert.match(ui.$('setup-content').textContent,/Make it yours/);
  const model=ui.labelledInput('Default model');model.value='model-one';model.dispatchEvent(new UIEvent('change'));
  const effort=ui.labelledInput('Reasoning effort');effort.value='high';effort.dispatchEvent(new UIEvent('change'));
  ui.document.querySelectorAll('.setup-access-option').find(button=>button.dataset.mode==='read').click();await flush();
  assert.deepEqual(pressedCards(ui),['System'],'A new profile starts on System.');
  ui.document.querySelectorAll('.setup-theme').find(button=>button.dataset.appearance==='light').click();await flush();
  ui.$('setup-next').click();await flush();assert.match(ui.$('setup-content').textContent,/Choose the folders/);assert.equal(ui.document.querySelector('.setup-import-card'),null);
  ui.$('close-setup').click();await flush();assert.equal(dialog.open,false);
  const saved=ui.requests.filter(request=>request.path==='/api/preferences'&&request.method==='POST').at(-1).body;
  assert.deepEqual(saved.defaults,{provider:'claude',model:'model-one',effort:'high',mode:'read',billing:'subscription'});assert.equal(saved.theme,undefined);
  assert.deepEqual(ui.requests.filter(request=>request.path==='/api/appearance'&&request.method==='POST').map(request=>request.body.theme),['light'],'The theme is saved once, the same way as from the status bar.');
  assert.equal(saved.onboarding.step,2);assert.equal(saved.onboarding.dismissed,true);
  ui.$('open-setup').click();await flush();assert.equal(dialog.dataset.screen,'flow');assert.match(ui.$('setup-step-status').textContent,/3 of 3/,'Setup resumes where it was left.');
  ui.$('setup-next').click();await flush();assert.equal(dialog.dataset.screen,'done');
  assert.match(ui.$('setup-hero-content').textContent,/Claude Code starts the conversation/);assert.match(ui.$('setup-hero-content').textContent,/Light theme/);assert.match(ui.$('setup-hero-content').textContent,/read only/);
  ui.document.querySelector('.onboarding-cta').click();await flush();assert.equal(dialog.open,false);assert.equal(ui.$('setup-progress').textContent,'Review');
  assert.equal(ui.window.relayBillingConfirmed,undefined,'Setup does not accept API charges.');
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue|connect)$/.test(request.path)).length,0);
  const completed=ui.requests.filter(request=>request.path==='/api/preferences'&&request.method==='POST').at(-1).body;assert.equal(completed.onboarding.completed,true);
});

test('a new profile paints the system appearance first and follows the OS while System is selected',async()=>{
  for(const systemDark of [false,true]){
    const ui=await browser({theme:true,systemDark});
    assert.equal(ui.document.documentElement.palettes[0],systemDark?'graphite':'light','The palette set before the stylesheets load already matches the OS.');
    assert.equal(ui.window.relayTheme.preference(),'system');assert.deepEqual(pressedAppearance(ui),['system']);assert.equal(themeColor(ui),systemDark?'#181818':'#f8f8f8');
    ui.setSystemDark(!systemDark);assert.equal(palette(ui),systemDark?'light':'graphite');assert.equal(themeColor(ui),systemDark?'#f8f8f8':'#181818');
    ui.setSystemDark(systemDark);assert.equal(palette(ui),systemDark?'graphite':'light');assert.deepEqual(pressedAppearance(ui),['system']);
    assert.deepEqual(appearanceSaves(ui),[],'Following the OS never saves a choice.');assert.equal(ui.storage.get('ai-relay:appearance'),'system','The preference is cached, not the palette it resolved to.');
  }
});

test('a saved Light or Dark choice ignores OS changes, and returning to System adopts the OS at once',async()=>{
  const ui=await browser({theme:true,systemDark:true,savedPreferences:{appearance:'light'}});
  assert.equal(palette(ui),'light');assert.deepEqual(pressedAppearance(ui),['light']);
  ui.setSystemDark(false);ui.setSystemDark(true);assert.equal(palette(ui),'light','A manual choice ignores the OS.');
  appearanceButton(ui,'system').click();assert.equal(palette(ui),'graphite');assert.equal(themeColor(ui),'#181818');assert.deepEqual(pressedAppearance(ui),['system']);
  appearanceButton(ui,'graphite').click();ui.setSystemDark(false);assert.equal(palette(ui),'graphite');
  await flush();assert.deepEqual(appearanceSaves(ui),['system','graphite']);assert.equal(ui.storage.get('ai-relay:appearance'),'graphite');
});

test('the preference this browser cached paints first, then the saved preference replaces it',async()=>{
  // Earlier versions cached the palette, so a Dark cache can stand for a profile that now follows a light OS.
  const ui=await browser({theme:true,systemDark:false,stored:{'ai-relay:appearance':'graphite'},savedPreferences:{appearance:'system'}});
  assert.equal(ui.document.documentElement.palettes[0],'graphite');assert.equal(palette(ui),'light');
  assert.equal(ui.window.relayTheme.preference(),'system');assert.equal(ui.storage.get('ai-relay:appearance'),'system');assert.deepEqual(appearanceSaves(ui),[]);
});

test('an appearance chosen in the status bar survives reopening the setup checklist',async()=>{
  const ui=await browser({theme:true,setup:true,savedPreferences:{appearance:'graphite',onboarding:{step:1}}});
  appearanceButton(ui,'light').click();await flush();assert.equal(palette(ui),'light');
  ui.window.relaySetup.open();await flush();
  assert.deepEqual(pressedCards(ui),['Light'],'Setup shows the choice made in the status bar.');
  ui.$('setup-next').click();await flush();assert.match(ui.$('setup-content').textContent,/Choose the folders/);
  assert.equal(palette(ui),'light','Moving through setup keeps the choice made since the page loaded.');assert.deepEqual(appearanceSaves(ui),['light']);
});

test('Settings, setup, the status bar and other windows agree on one appearance preference',async()=>{
  const ui=await browser({theme:true,setup:true,workbench:true,systemDark:true,savedPreferences:{onboarding:{step:1}}});
  ui.$('relay-settings').click();await flush();
  const settings=ui.$('workbench-content').querySelectorAll('[data-appearance]');
  assert.deepEqual(settings.map(button=>button.textContent),['System','Dark','Light']);assert.deepEqual(pressedAppearance(ui,ui.$('workbench-content')),['system']);
  settings.find(button=>button.dataset.appearance==='light').click();await flush();
  assert.equal(palette(ui),'light');assert.deepEqual([...new Set(pressedAppearance(ui))],['light'],'The status bar shows the choice made in Settings.');
  ui.findButton('Open setup checklist').click();await flush();assert.equal(ui.$('setup-dialog').open,true);
  const cards=ui.document.querySelectorAll('.setup-theme');assert.deepEqual(cards.map(card=>card.dataset.appearance),['system','graphite','light']);
  assert.deepEqual(pressedCards(ui),['Light']);
  cards.find(card=>card.dataset.appearance==='system').click();await flush();
  assert.equal(palette(ui),'graphite');assert.deepEqual([...new Set(pressedAppearance(ui))],['system'],'Setup, Settings and the status bar show the same choice.');
  ui.$('setup-next').click();await flush();assert.equal(ui.window.relayTheme.preference(),'system');
  // A choice made in another window arrives through storage. That window already saved it.
  ui.window.dispatchEvent(new UIEvent('storage',{key:'ai-relay:appearance',newValue:'light'}));
  assert.equal(palette(ui),'light');assert.deepEqual([...new Set(pressedAppearance(ui))],['light']);
  assert.deepEqual(appearanceSaves(ui),['light','system'],'Each choice is saved once, through one request.');
  assert.equal(ui.requests.some(request=>request.path==='/api/preferences'&&request.method==='POST'&&request.body.theme!==undefined),false);
});

test('setup resumes its folder step without importing, and failed saves keep the current step',async()=>{
  const ui=await browser({empty:true,existing:false,setup:true,insights:true,savedPreferences:{onboarding:{step:3,dismissed:true}}});
  assert.equal(ui.$('setup-dialog').open,false);ui.$('open-setup').click();await flush();assert.match(ui.$('setup-step-status').textContent,/3 of 3/,'A step saved by the earlier four-step setup resumes at the last step.');
  assert.equal(ui.document.querySelector('.setup-import-card'),null);assert.equal(ui.$('import-dialog').open,false);
  assert.equal(ui.requests.some(request=>request.path==='/api/import-sources'),false,'Onboarding does not discover or import chats.');
  ui.setIntercept((request,next)=>request.path==='/api/preferences'&&request.method==='POST'?response({error:'Preferences could not be written.'},503):next());
  ui.$('setup-back').click();await flush();assert.match(ui.$('setup-step-status').textContent,/3 of 3/);assert.equal(ui.$('setup-error').hidden,false);assert.match(ui.$('setup-error').textContent,/could not be written/);
});

test('onboarding finishes folder setup and the summary before discovering project conversations',async()=>{
  const ui=await browser({empty:true,existing:false,desktop:true,setup:true,insights:true}),setup=ui.$('setup-dialog');
  ui.document.querySelector('.onboarding-cta').click();await flush();
  ui.$('setup-next').click();await flush();ui.$('setup-next').click();await flush();
  assert.equal(ui.document.querySelector('.setup-import-card'),null);ui.pickedFolders.push('/workspace/example/frontend');ui.document.querySelector('.setup-folder-card').click();await flush();
  assert.equal(setup.open,true);assert.equal(setup.dataset.screen,'flow');assert.match(ui.$('setup-content').textContent,/frontend is ready/);
  assert.equal(ui.$('previous-chats-notice').hidden,true);assert.equal(ui.requests.some(request=>request.path==='/api/import-sources'),false);
  ui.$('setup-next').click();await flush();assert.equal(setup.dataset.screen,'done');assert.equal(setup.open,true);assert.match(ui.$('setup-hero-content').textContent,/frontend is ready/);
  assert.equal(ui.requests.some(request=>request.path==='/api/import-sources'),false,'Discovery waits until the user enters the workspace.');
  ui.document.querySelector('.onboarding-cta').click();await flush();assert.equal(setup.open,false);
  assert.equal(ui.requests.filter(request=>request.path==='/api/preferences'&&request.method==='POST').at(-1).body.onboarding.completed,true);
  assert.equal(ui.$('previous-chats-notice').hidden,false);assert.match(ui.$('previous-chats-text').textContent,/Found 2 previous conversations/);assert.equal(ui.$('import-dialog').open,false);
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue|connect)$/.test(request.path)).length,0);
  ui.$('open-import').click();await flush();ui.$('close-import').click();await flush();assert.equal(setup.open,false,'Later imports from the main app do not reopen onboarding.');
});

test('a failed merge can be cancelled with Escape without changing the workspace or its conversation',async()=>{
  const ui=await browser({insights:true});const conversationId=ui.state().conversation.id;
  ui.$('open-import').click();await flush();
  ui.document.querySelectorAll('.import-session')[0].click();await flush();ui.$('import-confirm').checked=true;ui.fire('import-confirm','change');
  ui.setIntercept((request,next)=>request.path==='/api/import-sources/import'?response({error:'The source changed; review it again.'},409):next());
  ui.$('confirm-import').click();await flush();assert.equal(ui.$('import-dialog').open,true);assert.match(ui.$('import-error').textContent,/source changed/);
  const cancel=new UIEvent('cancel');ui.$('import-dialog').dispatchEvent(cancel);if(!cancel.defaultPrevented)ui.$('import-dialog').close();await flush();
  assert.equal(ui.$('import-dialog').open,false);assert.equal(ui.state().projectId,'project-one');assert.equal(ui.state().conversation.id,conversationId);assert.equal(ui.state().conversation.messages.length,0);
});

test('a new install that finds saved workspaces asks to continue or start fresh',async()=>{
  const ui=await browser({setup:true,desktop:true,launch:{choice:true,workspaces:4,lastUsed:'2026-10-30T09:00:00.000Z'}});
  assert.equal(ui.$('setup-dialog').open,true);assert.equal(ui.$('setup-dialog').dataset.screen,'returning');assert.equal(ui.$('setup-title').textContent,'Welcome back');
  assert.match(ui.$('setup-hero-content').textContent,/found 4 workspaces/);assert.match(ui.$('setup-hero-content').textContent,/kept as a backup, never deleted/);
  ui.document.querySelectorAll('.onboarding-choice').find(choice=>choice.dataset.choice==='continue').click();await flush();
  assert.deepEqual([...ui.dataChoices],['continue']);assert.equal(ui.$('setup-dialog').open,false,'Continuing opens the saved workspaces without setup.');
  const fresh=await browser({setup:true,desktop:true,launch:{choice:true,workspaces:1,lastUsed:null}});
  fresh.document.querySelectorAll('.onboarding-choice').find(choice=>choice.dataset.choice==='fresh').click();await flush();
  assert.deepEqual([...fresh.dataChoices],['fresh']);const cards=fresh.document.querySelectorAll('.onboarding-choice');assert.ok(cards.every(card=>card.disabled),'Both choices lock while the choice is applied.');assert.match(cards.find(card=>card.dataset.choice==='fresh').textContent,/starting fresh…/);assert.equal(fresh.$('setup-dialog').open,true,'The window reloads into the fresh profile rather than showing the old data.');
  const ordinary=await browser({setup:true,desktop:true});await flush();assert.equal(ordinary.$('setup-dialog').open,false,'Ordinary launches go straight to the app.');assert.equal(ordinary.$('launch-screen').classList.contains('done'),true);
});

test('workspace options rename without changing chat or draft and never remove on the first click',async()=>{
  const ui=await browser();const id=ui.state().conversation.id;
  ui.$('message-input').value='Keep this draft';ui.fire('message-input','input');
  assert.equal(ui.document.querySelectorAll('.remove-workspace').length,0);assert.equal(ui.document.querySelectorAll('.remove-workspace-folder').length,0);
  ui.document.querySelectorAll('.workspace-options')[0].click();assert.equal(ui.$('workspace-options-dialog').open,true);assert.equal(ui.$('remove-workspace-dialog').open,false);
  ui.$('rename-workspace-name').value='Customer portal';ui.fire('rename-workspace-form','submit');await flush();
  assert.equal(ui.$('workspace-options-dialog').open,false);assert.match(ui.$('workspace-list').textContent,/Customer portal/);
  assert.equal(ui.state().conversation.id,id);assert.equal(ui.$('message-input').value,'Keep this draft');
  assert.equal(ui.requests.filter(request=>request.path.endsWith('/remove')).length,0);
});

test('usage details show exact resets and scoped limits, and retain readings after a refresh error',async()=>{
  const reset=new Date(Date.now()+125*60000).toISOString();
  const ui=await browser({insights:true,usage:{codex:{available:true,plan:'pro',windows:[{id:'primary',label:'5-hour',usedPercent:70,resetsAt:reset},{id:'weekly',label:'Weekly',usedPercent:10,resetsAt:null}]}}});
  ui.$('codex-usage').click();await flush();assert.equal(ui.$('usage-dialog').matches(':popover-open'),true);assert.equal(ui.$('usage-title').textContent,'Plan usage');assert.deepEqual([...ui.$('usage-details').children].map(section=>section.dataset.provider),['codex'],'Only the clicked agent is shown.');assert.equal(ui.$('usage-plan').textContent,'From your own Codex account');
  assert.match(ui.$('usage-details').textContent,/30% left/);assert.match(ui.$('usage-details').textContent,/Resets in 2h/);assert.match(ui.$('usage-details').textContent,/Reset time not reported/);
  const time=ui.document.querySelectorAll('time')[0];assert.equal(time.getAttribute('datetime'),reset);assert.match(ui.$('usage-details').children[0].textContent,/pro/);
  ui.setIntercept((request,next)=>request.path.endsWith('/usage')?response({error:'Provider unavailable'},503):next());ui.$('refresh-usage').click();await flush();
  assert.match(ui.$('usage-details').textContent,/30% left/);assert.match(ui.$('usage-details').textContent,/last successful reading/);assert.equal(ui.$('refresh-usage').disabled,false);
  assert.equal(ui.requests.filter(request=>/\/(?:messages|continue)$/.test(request.path)).length,0);
});

test('Ask a Friend explains the round trip and disables private links when no service is configured',async()=>{
  const ui=await browser({workbench:true,available:false,existing:false});ui.$('ask-friend').click();await flush();
  assert.match(ui.$('workbench-content').textContent,/Share with a person/);ui.labelledInput('Goal').value='Help review this';ui.findButton('Prepare offline preview').click();await flush();
  ui.labelledInput('I inspected the exact package').checked=true;ui.findButton('Approve exact package').click();await flush();
  assert.equal(ui.findButton('Link service not configured').disabled,true);assert.equal(ui.findButton('Export approved request').disabled,false);
  assert.match(ui.$('workbench-content').textContent,/Help someone/);assert.equal(ui.requests.filter(request=>request.path.endsWith('/publish')).length,0);
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.doesNotMatch(html,/id="open-context"|data-tab="context"/);
});

test('usage opens beside its meter, switches providers in place and closes on Escape',async()=>{
  const usage={available:true,windows:[{id:'primary',label:'5-hour',usedPercent:20,resetsAt:null}]};
  const ui=await browser({insights:true,usage:{codex:usage,claude:usage}});
  ui.$('usage-dialog').bounds={left:0,top:0,width:340,height:390,right:340,bottom:390};
  ui.$('codex-usage').bounds={left:80,top:772,bottom:794,right:290,width:210,height:22};
  ui.$('codex-usage').click();await flush();
  const card=ui.$('usage-dialog');assert.equal(card.tagName,'DIV');assert.equal(card.matches(':popover-open'),true);assert.equal(ui.$('codex-usage').getAttribute('aria-expanded'),'true');
  assert.equal(card.style.left,'80px');assert.ok(Number.parseFloat(card.style.top)+390<772,'The card stays above its footer meter.');
  ui.$('claude-usage').click();await flush();assert.deepEqual([...ui.$('usage-details').children].map(section=>section.dataset.provider),['claude']);assert.equal(ui.$('codex-usage').getAttribute('aria-expanded'),'false');
  ui.$('claude-usage').click();await flush();assert.equal(card.matches(':popover-open'),false);
  ui.$('usage-chip').bounds={left:1190,top:700,bottom:726,right:1270,width:80,height:26};ui.$('usage-chip').click();await flush();assert.ok(Number.parseFloat(card.style.left)+340<=1280-12,'Composer usage stays inside the window.');
  assert.deepEqual([...ui.$('usage-details').children].map(section=>section.dataset.provider),[ui.state().provider],'The composer chip shows only the selected agent.');
  ui.document.dispatchEvent(new UIEvent('keydown',{key:'Escape'}));assert.equal(card.matches(':popover-open'),false);assert.equal(ui.document.activeElement,ui.$('usage-chip'));
});

test('footer keep awake shows armed and native active states, handles errors and stays hidden in web mode',async()=>{
  const web=await browser({desktopControls:true});assert.equal(web.$('keep-awake').hidden,true);
  const ui=await browser({desktop:true,desktopControls:true});assert.equal(ui.$('keep-awake').hidden,false);assert.equal(ui.$('keep-awake').dataset.state,'off');
  ui.$('keep-awake').click();await flush();assert.deepEqual(ui.awakeChanges,[true]);assert.equal(ui.$('keep-awake-label').textContent,'Keep awake · Auto');
  ui.window.dispatchEvent(new UIEvent('desktop-keep-awake',{detail:{enabled:true,active:true,runningCount:2,error:null}}));assert.equal(ui.$('keep-awake-label').textContent,'Keep awake · On');assert.match(ui.$('keep-awake').title,/2 active agents/);
  ui.window.dispatchEvent(new UIEvent('desktop-keep-awake',{detail:{enabled:true,active:false,runningCount:0,error:null}}));assert.equal(ui.$('keep-awake').dataset.state,'armed');
  ui.window.relayDesktop.setKeepAwake=async()=>{throw Error('Disk unavailable');};ui.$('keep-awake').click();await flush();assert.match(ui.$('notice-text').textContent,/Disk unavailable/);assert.equal(ui.$('keep-awake').getAttribute('aria-pressed'),'true');assert.equal(ui.$('keep-awake').disabled,false);
});


test('attachments stay with their workspace and accepted-send retry preserves attachment identity',async()=>{
  const ui=await browser({filesUI:true,moreProjects:true});
  await ui.window.relayFiles.addSnapshots([{name:'notes.md',data:'bm90ZXM='}]);await flush();
  const id=ui.window.relayFiles.ids()[0];assert.equal(ui.$('send-button').disabled,false,'Attachment-only messages can be sent.');
  await ui.switchProject('project-two');assert.equal(ui.window.relayFiles.ids().length,0);
  await ui.switchProject('project-one');assert.equal(ui.window.relayFiles.ids()[0],id);
  const submissions=[];
  ui.setIntercept((request,next)=>{if(request.path.endsWith('/messages')){submissions.push(request.body);if(submissions.length===1)return response({error:'Connection lost'},503);}return next();});
  ui.fire('composer','submit');await flush();assert.equal(ui.window.relayFiles.ids()[0],id);
  ui.$('notice-retry').click();await flush();
  assert.equal(submissions.length,2);assert.equal(submissions[0].requestId,submissions[1].requestId);
  assert.deepEqual(submissions[1].attachments,[id]);assert.equal(submissions[1].text,'Please review the attached files.');assert.equal(ui.window.relayFiles.ids().length,0);
});

test('late attachment uploads stay with their original workspace and block premature send',async()=>{
  const ui=await browser({filesUI:true,moreProjects:true}), gate=deferred();
  ui.setIntercept(async(request,next)=>{if(request.path==='/api/attachments'){await gate.promise;}return next();});
  const adding=ui.window.relayFiles.addSnapshots([{name:'notes.md',data:'bm90ZXM='}]);
  ui.$('message-input').value='Review';ui.fire('message-input','input');assert.equal(ui.$('send-button').disabled,true);
  await ui.switchProject('project-two');gate.resolve();await adding;await flush();assert.equal(ui.window.relayFiles.ids().length,0);
  await ui.switchProject('project-one');assert.equal(ui.window.relayFiles.ids().length,1);assert.equal(ui.$('send-button').disabled,false);
});
