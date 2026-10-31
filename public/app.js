(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    workspaceList: $("workspace-list"), workspaceCount: $("workspace-count"), createWorkspace: $("create-workspace"), workspaceToggle: $("workspace-toggle"),
    title: $("conversation-title"), subtitle: $("conversation-subtitle"), state: $("conversation-state"),
    workspace: $("workspace-name"), breadcrumb: $("workspace-breadcrumb"),
    messages: $("messages"), scroll: $("messages-scroll"), empty: $("empty-state"),
    form: $("composer"), input: $("message-input"), send: $("send-button"), stop: $("stop-button"),
    agent: $("agent-select"), mode: $("mode-select"), codex: $("select-codex"), claude: $("select-claude"), gemini: $("select-gemini"),
    continuation: $("continuation"), continueText: $("continuation-text"), continueButton: $("continue-button"),
    otherRunning: $("other-running"), viewRunning: $("view-running"),
    notice: $("notice"), noticeText: $("notice-text"), retry: $("notice-retry"), dismiss: $("notice-dismiss"),
    announcer: $("announcer"), hint: $("composer-hint"),
    projectSelect: $("project-select"), addProject: $("add-project"), projectPanel: $("project-panel"),
    projectForm: $("project-form"), projectName: $("project-name"), projectPaths: $("project-paths"),
    projectSave: $("save-project"), projectClose: $("close-project"), projectError: $("project-error"),
    projectEmpty: $("project-empty-state"), addFirstProject: $("add-first-project"), composerRegion: $("composer-region"),
    folderPanel: $("folder-panel"), folderForm: $("folder-form"), folderPath: $("folder-path"), folderSave: $("save-folder"), folderClose: $("close-folder"), folderError: $("folder-error"),
    removeDialog: $("remove-workspace-dialog"), removeName: $("remove-workspace-name"), removeConfirm: $("confirm-remove-workspace"), removeCancel: $("cancel-remove-workspace"), removeError: $("remove-workspace-error"),
  };
  const state = {
    accounts: {}, accountsChecking: {}, accountChecks: {}, accountCheck: 0, accountsCheckedAt: 0, accountRefresh: null, connectionAction: null, model: "", effort: null, workspaceFilter: "", streamConnected: null, retrySubmission: null, status: null, conversation: null, provider: "codex", mode: "edit",
    pending: null, loading: false, selectionVersion: 0, refreshPromise: null, refreshAgain: false,
    settingsRevision: 0, settingsPending: 0, settingsPromise: Promise.resolve(),
    noticeRetry: null, eventTimer: null, messagesSignature: "", listSignature: "", ready: false,
    projects: [], projectId: null, projectVersion: 0, projectsLoaded: false, projectSaving: false,
    projectListSignature: "", events: null, pollTimer: null,
    projectsRequestVersion: 0, projectsTimer: null, removingProjectId: null,
  };

  function storageKey(key) {
    const workspace = state.status?.workspace;
    const scope = state.projectId ? "project:" + state.projectId : typeof workspace === "string" ? workspace : workspace?.path || workspace?.name || "unconnected";
    return `ai-relay:${scope}:${key.replace(/^ai-relay:/, "")}`;
  }
  function storedRead(key) {
    try {
      const current = localStorage.getItem(storageKey(key));
      if (current !== null) return current;
      const workspace = state.status?.workspace;
      return typeof workspace === "string" ? localStorage.getItem(`ai-relay:${workspace}:${key.replace(/^ai-relay:/, "")}`) : null;
    } catch { return null; }
  }
  function storedWrite(key, value) {
    try { localStorage.setItem(storageKey(key), value); } catch { /* The app also works without browser storage. */ }
  }
  function activeProjectRead() { try { return localStorage.getItem("ai-relay:active-project"); } catch { return null; } }
  function activeProjectWrite(id) { try { localStorage.setItem("ai-relay:active-project", id); } catch { /* Browser storage is optional. */ } }
  function draftKey(id = state.conversation?.id) { return `ai-relay:draft:${id || "new"}`; }
  function saveDraft() { if (state.status && state.ready && !state.loading) storedWrite(draftKey(), ui.input.value); }
  function restoreDraft() { ui.input.value = storedRead(draftKey()) || ""; resizeInput(); }
  function label(provider) { return provider === "gemini" ? "Gemini" : provider === "claude" ? "Claude" : "Codex"; }
  function available(provider) { return Boolean(state.status?.providers?.[provider]?.available); }
  function isRunning() { return state.conversation?.status === "running" || Boolean(state.conversation?.id && state.status?.runningConversationId === state.conversation.id); }
  function isOtherRunning() { return Boolean(state.status?.runningConversationId && state.status.runningConversationId !== state.conversation?.id); }
  function endpoint(id, action = "") { return `/api/conversations/${encodeURIComponent(id)}${action ? `/${action}` : ""}`; }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function announce(text) { ui.announcer.textContent = text; }
  function closeWorkspaceMenu() {
    ui.workspaceToggle.setAttribute("aria-expanded", "false");
    ui.workspaceToggle.closest(".sidebar").classList.remove("workspaces-open");
  }
  function showNotice(message, retry = null, actionLabel = "Retry") {
    ui.noticeText.textContent = message;
    state.noticeRetry = retry;
    ui.retry.hidden = !retry;
    ui.retry.textContent = actionLabel;
    ui.notice.hidden = false;
  }
  function hideNotice() { ui.notice.hidden = true; state.noticeRetry = null; }
  function projectBusy() { return Boolean(state.pending || state.settingsPending || state.projectSaving); }
  function currentProject() { return state.projects.find((project) => project.id === state.projectId); }
  function sameProject(id, version) { return state.projectId === id && state.projectVersion === version; }
  function toggleProjectForm(open) {
    if (state.projectSaving) return;
    ui.projectPanel.hidden = !open;
    ui.addProject.setAttribute("aria-expanded", String(open));
    if (open) { closeWorkspaceMenu(); ui.folderPanel.hidden = true; ui.projectError.hidden = true; ui.projectPaths.focus(); }
    else ui.createWorkspace.focus();
  }
  async function api(path, options = {}, projectId = state.projectId) {
    const providerEndpoint = /^\/api\/providers(?:\/|$)/.test(path);
    if (/^\/api\/(?:status|conversation|conversations|collaboration|git|imports|files|attachments|reviews|local-models)(?:\/|$|\?)/.test(path) || (providerEndpoint && projectId)) {
      if (!projectId) throw new Error("Choose a project first.");
      path += `${path.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(projectId)}`;
    }
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.method === "POST" ? { "X-AI-Relay": "1" } : {}), ...(window.relayDesktop?.token ? {"X-AI-Relay-Token":window.relayDesktop.token} : {}), ...options.headers },
      });
    } catch {
      throw new Error("Cannot reach Throughline. Make sure its local server is still running.");
    }
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || data.message || `The request could not be completed (${response.status}).`);
    return data;
  }
  function post(path, data = {}, projectId = state.projectId) { return api(path, { method: "POST", body: JSON.stringify(data) }, projectId); }

  function foldersFor(project) {
    if (Array.isArray(project?.folders)) return project.folders;
    return project?.path ? [{id:'primary',name:project.path.split(/[\\/]/).pop() || 'Project folder',path:project.path,available:project.available}] : [];
  }
  function renderProjects() {
    const signature = JSON.stringify([state.projects,state.projectId,state.projectsLoaded]);
    if (signature !== state.projectListSignature) {
      state.projectListSignature = signature;
      ui.projectSelect.replaceChildren();
      if (!state.projects.length) {
        const option = element('option','',state.projectsLoaded ? 'No workspaces added' : 'Loading workspaces…');
        option.value = ''; ui.projectSelect.append(option);
      }
      for (const project of state.projects) {
        const suffix = project.available === false ? ' · unavailable' : project.runningConversationId ? ' · running' : '';
        const option = element('option','',project.name + suffix); option.value = project.id; ui.projectSelect.append(option);
      }
      ui.projectSelect.value = state.projectId || '';
    }
    const busy = projectBusy();
    ui.projectSelect.disabled = !state.projects.length || busy;
    ui.addProject.disabled = busy; ui.createWorkspace.disabled = busy; ui.addFirstProject.disabled = busy;
    ui.projectSave.disabled = busy; ui.projectName.disabled = state.projectSaving; ui.projectPaths.disabled = state.projectSaving; ui.projectClose.disabled = state.projectSaving;
    ui.projectSave.firstChild.textContent = state.projectSaving ? 'Saving… ' : 'Create workspace ';
    ui.folderSave.disabled = busy || isRunning(); ui.folderPath.disabled = state.projectSaving; ui.folderClose.disabled = state.projectSaving;
    ui.folderSave.firstChild.textContent = state.projectSaving ? 'Saving… ' : 'Add folder ';
    ui.removeConfirm.disabled = busy; ui.removeCancel.disabled = state.projectSaving;
    ui.removeConfirm.textContent = state.projectSaving ? 'Removing…' : 'Remove workspace';
    ui.projectEmpty.hidden = !state.projectsLoaded || state.projects.length > 0; ui.composerRegion.hidden = !state.projectId;
  }

  function connection(provider) {
    const account=state.accounts[provider];
    const installed=state.status ? available(provider) : account?.installed === true;
    const checking=Boolean(state.accountsChecking[provider]);
    const needsSignIn=installed && account?.authenticated === false;
    const needsBilling=installed && !needsSignIn && Boolean(account) && account.billingSource !== 'subscription' && window.relayBillingConfirmed !== true;
    return {account,installed,checking,needsSignIn,needsBilling,blocked:!installed||needsSignIn||needsBilling};
  }
  async function refreshAccounts({force=false}={}) {
    // Routine checks share one probe and run at most once a minute; an explicit recheck always asks again.
    if(!force&&(state.accountRefresh||Date.now()-state.accountsCheckedAt<60000))return state.accountRefresh;
    const check=++state.accountCheck;
    const refresh=state.accountRefresh=Promise.all(['codex','claude','gemini'].map(async provider=>{
      if(state.status?.providers?.[provider]?.available===false){
        state.accounts[provider]={installed:false,authenticated:'unknown',billingSource:'unknown',usage:'unknown'};state.accountChecks[provider]={checkedAt:Date.now()};
        return;
      }
      // Progress replaces the status only for an explicit recheck or while nothing is known; a routine check keeps the last result on screen.
      if(force||!state.accounts[provider]){state.accountsChecking[provider]=check;renderStatus();renderControls();}
      let account=null,error=null;
      try {account=await api('/api/providers/'+provider+'/account',{},null);}
      catch(failure) {error=failure.message;/* A status-probe failure is advisory; native execution still validates its connection. */}
      if(state.accountsChecking[provider]===check)delete state.accountsChecking[provider];
      // A newer check owns the result. A timeout or failed check confirms nothing, so it keeps the last result and records why it may be out of date.
      if(check===state.accountCheck){
        if(!account||account.errorCategory==='timeout'||account.installed&&account.authenticated==='unknown'&&account.errorCategory)state.accountChecks[provider]={checkedAt:state.accountChecks[provider]?.checkedAt||null,failedAt:Date.now(),failure:account?.errorCategory==='timeout'?'timeout':'failed',error:error||account?.error||null};
        else {state.accounts[provider]=account;state.accountChecks[provider]={checkedAt:Date.now()};if(force)window.dispatchEvent(new CustomEvent('relay-account',{detail:{provider,account}}));}
      }
      renderStatus();renderControls();window.dispatchEvent(new CustomEvent('relay-state'));
    })).then(()=>{state.accountsCheckedAt=Date.now();});
    try {await refresh;} finally {if(state.accountRefresh===refresh)state.accountRefresh=null;render();}
  }
  const installGuides = {
    claude: "https://code.claude.com/docs/en/overview",
    codex: "https://github.com/openai/codex",
    gemini: "https://geminicli.com/docs/get-started/",
  };
  const openExternal = (url) => window.relayDesktop ? window.relayDesktop.openExternal(url) : window.open(url, "_blank", "noopener,noreferrer");
  function renderStatus() {
    const workspace=state.status?.workspace || currentProject()?.path || '';
    ui.workspace.textContent=currentProject()?.name || 'No workspace selected';
    ui.workspace.title=workspace;ui.breadcrumb.textContent=workspace;
    for(const provider of ['codex','claude','gemini']) {
      const info=connection(provider);
      const text=info.checking?'Checking…':info.installed?(info.needsSignIn?'Sign in required':info.account?.authenticated===true?(info.account.billingSource==='api'?'API account':'Connected'):'Not verified'):state.status||info.account?'Not installed':'Not checked';
      $(`${provider}-status-text`).textContent=text;
      $(`${provider}-status-dot`).className='status-dot '+(info.installed&&!info.needsSignIn?'available':info.needsSignIn?'attention':'unavailable');
      const pill=$(`${provider}-status`);
      if(pill)pill.title=!info.installed&&(state.status||info.account)?`${label(provider)} is not installed — click for install instructions`:`${label(provider)} connection`;
    }
  }
  function renderConnectionNotice() {
    const notice=$('connection-notice'),install=$('connection-install');if(!notice)return;
    const info=connection(state.provider),other=['codex','claude','gemini'].find(provider=>provider!==state.provider&&available(provider)) || 'codex',name=label(state.provider);
    const fresh=!state.conversation?.messages?.length,none=!['codex','claude','gemini'].some(available);
    notice.hidden=true;state.connectionAction=null;state.installUrl=null;if(install)install.hidden=true;
    if(!state.ready||isRunning()||(fresh&&none))return;
    let text='',action='';
    if(!info.installed){
      text=name+' is not installed.';
      state.installUrl=installGuides[state.provider]||null;
      if(install&&state.installUrl){install.hidden=false;install.textContent='How to install '+name+' ↗';}
      if(available(other)){action='Use '+label(other);state.connectionAction=()=>changeSettings(other,state.mode);}
      else {action='Open settings';state.connectionAction=()=>$('relay-settings').click();}
    } else if(info.needsSignIn){text=name+' is not signed in.';action='Connect account';state.connectionAction=()=>$('relay-settings').click();}
    else if(info.needsBilling){text=info.account.billingSource==='api'?'This connection uses API billing. Review it before sending.':'Billing could not be confirmed. Review this connection before sending.';action='Review connection';state.connectionAction=()=>$('relay-settings').click();}
    // Progress for a first check or an explicit recheck shows in the header and composer state, not as a notice.
    else if(!info.checking&&info.account?.authenticated!==true){text='Sign-in status has not been verified.';action='Check connection';state.connectionAction=()=>$('relay-settings').click();}
    if(text){notice.hidden=false;$('connection-notice-text').textContent=text;$('connection-action').textContent=action;$('connection-action').hidden=!action;}
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  // Each workspace remembers which of its folders the Files view and Git panel show.
  function selectedFolderId(project = currentProject()) {
    const folders = foldersFor(project); if (!folders.length) return null;
    let id = state.selectedFolders?.[project.id];
    if (id === undefined) { try { id = localStorage.getItem('ai-relay:folder:' + project.id); } catch { id = null; } }
    return folders.some(folder => folder.id === id) ? id : folders[0].id;
  }
  function selectFolder(folderId, projectId = state.projectId) {
    const project = state.projects.find(item => item.id === projectId); if (!foldersFor(project).some(folder => folder.id === folderId)) return;
    state.selectedFolders = { ...state.selectedFolders, [projectId]: folderId };
    try { localStorage.setItem('ai-relay:folder:' + projectId, folderId); } catch { /* Folder choice is a convenience. */ }
    renderWorkspaceList(); window.dispatchEvent(new CustomEvent("relay-state"));
  }
  function filteredProjects() { return state.projects.filter(project => project.name.toLowerCase().includes(state.workspaceFilter.toLowerCase())); }
  function renderWorkspaceList() {
    const signature = JSON.stringify([state.projects,state.projectId,projectBusy(),state.loading,state.status?.runningConversationId,state.workspaceFilter,selectedFolderId()]);
    if (signature === state.listSignature) return;
    renderFolderSettings();
    state.listSignature = signature; ui.workspaceList.replaceChildren(); ui.workspaceCount.textContent = String(state.projects.length);
    if (!state.projects.length) { ui.workspaceList.append(element('p','empty-list','No workspaces')); return; }
    for (const project of filteredProjects()) {
      const active = project.id === state.projectId;
      const group = element('div','workspace-group' + (active ? ' active' : ''));
      const button = element('button','workspace-item' + (active ? ' active' : ''));
      button.type = 'button'; button.disabled = projectBusy(); button.dataset.projectId = project.id; button.title = project.name;
      if (active) button.setAttribute('aria-current','page');
      const heading = element('span','workspace-item-heading'), mark = element('span','workspace-project-icon',''); mark.setAttribute('aria-hidden','true'); heading.append(mark,element('span','workspace-item-title',project.name));
      const folders = foldersFor(project); const meta = folders.length + (folders.length === 1 ? ' folder' : ' folders') + (project.runningConversationId ? ' · running' : '');
      // Single-folder counts are noise; the text stays for screen readers and a running workspace shows a pulse.
      const metaNode = element('span','workspace-item-meta' + (folders.length === 1 ? ' single' : '') + (project.runningConversationId ? ' running' : ''),meta);
      button.append(heading,metaNode); button.addEventListener('click',()=>selectProject(project.id)); const row = element('div','workspace-row');
      const options = element('button','workspace-options'); options.type = 'button'; options.disabled = projectBusy(); options.dataset.projectId = project.id;
      options.setAttribute('aria-label','Workspace options for ' + project.name); options.title = 'Workspace settings'; options.addEventListener('click',()=>openWorkspaceOptions(project.id));
      row.append(button,options); group.append(row);
      // A multi-folder workspace lists its folders; the selected one drives the Files view and Git panel.
      if (active && folders.length > 1) {
        const list = element('ul','workspace-folders'), current = selectedFolderId(project);
        for (const folder of folders) {
          const repeated = folders.filter(entry=>(entry.displayName||entry.name)===(folder.displayName||folder.name)).length>1;
          const item = element('li','workspace-folder' + (folder.id === current ? ' selected' : '') + (folder.available === false ? ' unavailable' : ''));
          const pick = element('button','workspace-folder-pick'); pick.type = 'button'; pick.title = folder.path + (folder.available === false ? ' · folder not found' : ''); pick.setAttribute('aria-pressed',String(folder.id === current));
          const icon = element('span','workspace-folder-icon'); icon.setAttribute('aria-hidden','true');
          pick.append(icon,element('span','workspace-folder-name',repeated?folder.name:folder.displayName||folder.name)); pick.addEventListener('click',()=>selectFolder(folder.id,project.id));
          item.append(pick); list.append(item);
        }
        group.append(list);
      }
      ui.workspaceList.append(group);
    }
  }

  function messageTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  // Assistant replies use a small Markdown subset, built as DOM nodes so provider text is never parsed as HTML.
  function renderInline(parent, text) {
    let last = 0;
    for (const match of text.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*/g)) {
      if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
      parent.append(match[1] !== undefined ? element("code", "", match[1]) : element("strong", "", match[2]));
      last = match.index + match[0].length;
    }
    if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
  }
  // Lightweight syntax coloring for code blocks and file previews. Tokens become text nodes and spans, never HTML.
  const syntaxFamilies = {
    c: { comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//, string: /`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/, keywords: 'abstract as async await break case catch class const continue debugger default defer delete do else enum export extends false final finally fn for from func function if impl implements import in instanceof interface let mut new nil null of package private protected pub public readonly return self static struct super switch this throw throws trait true try type typeof undefined var void while with yield' },
    hash: { comment: /#[^\n]*/, string: /"""[\s\S]*?"""|'''[\s\S]*?'''|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/, keywords: 'and as assert async await break case class def del do done elif else end esac except export false False fi finally for from function global if import in is lambda local None nonlocal not or pass raise return self then true True try until while with yield' },
    json: { string: /"(?:\\.|[^"\\\n])*"/, keywords: 'true false null' },
    css: { comment: /\/\*[\s\S]*?\*\//, string: /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/, keywords: 'important' },
    markup: { comment: /<!--[\s\S]*?-->/, string: /'[^'\n]*'|"[^"\n]*"/, tag: /<\/?[A-Za-z][\w:-]*|\/?>/ },
    sql: { comment: /--[^\n]*|\/\*[\s\S]*?\*\//, string: /'(?:''|[^'])*'/, keywords: 'select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as distinct null is in exists case when then else end primary key references unique default returning with union all' },
  };
  const syntaxLanguages = { js: 'c', jsx: 'c', ts: 'c', tsx: 'c', mjs: 'c', cjs: 'c', javascript: 'c', typescript: 'c', jsonc: 'c', java: 'c', c: 'c', h: 'c', cpp: 'c', cs: 'c', go: 'c', rs: 'c', rust: 'c', swift: 'c', kt: 'c', dart: 'c', php: 'c', css: 'css', scss: 'css', less: 'css', json: 'json', py: 'hash', python: 'hash', sh: 'hash', bash: 'hash', zsh: 'hash', shell: 'hash', yaml: 'hash', yml: 'hash', toml: 'hash', rb: 'hash', ruby: 'hash', dockerfile: 'hash', makefile: 'hash', html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', svelte: 'markup', sql: 'sql' };
  const syntaxPatterns = {};
  function syntaxPattern(family) {
    if (syntaxPatterns[family]) return syntaxPatterns[family];
    const spec = syntaxFamilies[family], parts = [];
    for (const kind of ['comment', 'string', 'tag']) if (spec[kind]) parts.push(`(?<${kind}>${spec[kind].source})`);
    parts.push(String.raw`(?<number>\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b)`, String.raw`(?<word>[A-Za-z_$][\w$]*)`);
    return syntaxPatterns[family] = { pattern: new RegExp(parts.join('|'), 'g'), keywords: new Set((spec.keywords || '').split(' ')), caseless: family === 'sql' };
  }
  // Splits code into lines of [kind, text] tokens; kind is '' for plain text.
  function highlightLines(text, language) {
    // Own keys only, so a label such as "constructor" is not read from Object.prototype.
    const key = String(language || '').toLowerCase(), family = Object.hasOwn(syntaxLanguages, key) ? syntaxLanguages[key] : null, lines = [[]];
    const push = (kind, value) => value.split('\n').forEach((part, index) => { if (index) lines.push([]); if (part) lines.at(-1).push([kind, part]); });
    if (!family) { push('', text); return lines; }
    const { pattern, keywords, caseless } = syntaxPattern(family); let last = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0], end = match.index + value.length, next = text.slice(end, end + 16), groups = match.groups;
      if (match.index > last) push('', text.slice(last, match.index));
      push(groups.comment ? 'comment' : groups.string ? (family === 'json' && /^\s*:/.test(next) ? 'property' : 'string') : groups.tag ? 'tag' : groups.number ? 'number' : keywords.has(caseless ? value.toLowerCase() : value) ? 'keyword' : /^\s*\(/.test(next) ? 'function' : '', value);
      last = end;
    }
    if (last < text.length) push('', text.slice(last));
    return lines;
  }
  function highlightedCode(text, language) {
    const code = element('code');
    highlightLines(text, language).forEach((line, index) => { if (index) code.append(document.createTextNode('\n')); for (const [kind, value] of line) code.append(kind ? element('span', 'tok-' + kind, value) : document.createTextNode(value)); });
    return code;
  }
  async function copyText(button, text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      // Fallback for renderers that deny the async clipboard permission.
      const buffer = element("textarea", "clipboard-buffer"); buffer.value = text; document.body.append(buffer); buffer.select();
      const copied = document.execCommand("copy"); buffer.remove(); if (!copied) { announce("Copy failed."); return; }
    }
    button.classList.add("copied"); announce("Copied to clipboard.");
    setTimeout(() => button.classList.remove("copied"), 1500);
  }
  function copyButton(className, label, text) {
    const button = element("button", className); button.type = "button"; button.title = label; button.setAttribute("aria-label", label);
    button.addEventListener("click", () => copyText(button, text));
    return button;
  }
  function tableCells(row) { return row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()); }
  function renderProse(parent, text) {
    const lines = text.split("\n"), tableRow = /^\s*\|.*\|\s*$/, tableRule = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
    let block = null, list = null;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) { block = list = null; continue; }
      if (tableRow.test(line) && tableRule.test(lines[index + 1] || "")) {
        block = list = null;
        const wrap = element("div", "md-table"), table = element("table"), head = element("thead"), body = element("tbody"), headRow = element("tr");
        for (const cell of tableCells(line)) { const th = element("th"); renderInline(th, cell); headRow.append(th); }
        head.append(headRow); index++;
        while (tableRow.test(lines[index + 1] || "")) { const row = element("tr"); for (const cell of tableCells(lines[++index])) { const td = element("td"); renderInline(td, cell); row.append(td); } body.append(row); }
        table.append(head, body); wrap.append(table); parent.append(wrap); continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { block = list = null; parent.append(element("hr")); continue; }
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (heading) { block = list = null; const node = element(`h${Math.min(heading[1].length + 2, 6)}`); renderInline(node, heading[2]); parent.append(node); continue; }
      const item = line.match(/^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/);
      if (item) {
        block = null;
        const tag = item[2] === undefined ? "ul" : "ol";
        if (!list || list.tagName !== tag.toUpperCase()) { list = element(tag); if (item[2] && item[2] !== "1") list.setAttribute("start", item[2]); parent.append(list); }
        const entry = element("li", item[1].length >= 2 ? "nested" : ""); renderInline(entry, item[3]); list.append(entry); continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      list = null;
      if (quote && block?.tagName !== "BLOCKQUOTE") { block = element("blockquote"); parent.append(block); }
      else if (block) block.append(document.createTextNode("\n"));
      else { block = element("p"); parent.append(block); }
      renderInline(block, quote ? quote[1] : line);
    }
  }
  function renderMessage(message) {
    if (message.role === "error") {
      const error = element("div", "message-error", message.text || "The assistant stopped before finishing.");
      error.setAttribute("role", "note");
      return error;
    }
    if (message.role === "system") return element("div", "message-system", message.text || "");
    const user = message.role === "user";
    const provider = message.provider || state.conversation?.provider || "codex";
    const streaming = !user && (message.status === "streaming" || message.status === "running");
    const row = element("article", `message ${user ? "message-user" : "message-assistant"}${streaming ? " message-streaming" : ""}`);
    const heading = element("div", "message-heading");
    const avatar = element("span", `message-avatar ${user ? "user" : message.connection === 'local' ? 'local' : provider}`);
    avatar.setAttribute("aria-hidden", "true");
    heading.append(avatar, element("span", "message-author", user ? "You" : message.connection === 'local' ? 'Local · Ollama' : label(provider)));
    if (!user && message.model && message.model !== "unknown") heading.append(element("span", "message-model", message.model));
    if (!user && message.effort) heading.append(element("span", "message-effort", message.effort + " effort"));
    if (message.imported) heading.append(element("span", "message-label", "Imported"));
    if (streaming) heading.append(element("span", "message-label", "Working"));
    const time = element("time", "message-time", messageTime(message.createdAt));
    if (message.createdAt) time.dateTime = message.createdAt;
    heading.append(time);
    if (message.text) heading.append(copyButton("message-copy", "Copy message", message.text));
    const body=element('div',user?'message-text':'message-text markdown');
    if (!user && message.reviewId) {
      const review = state.conversation?.reviews?.find(item => item.id === message.reviewId);
      body.append(element('p', '', review?.summary || (streaming ? 'Read-only review in progress…' : 'Read-only review response.')));
      if (review) { const view = element('button', 'secondary-button', 'View review'); view.type = 'button'; view.addEventListener('click', () => window.relayReviews?.open(message.reviewId)); body.append(view); }
      const raw = element('details', 'review-raw'); raw.append(element('summary', '', 'Agent response'), element('pre', '', message.text || 'Waiting for the reviewer…')); body.append(raw);
      row.append(heading, body); return row;
    }
    const text=message.text || (streaming ? '' : 'No text response.');
    const parts=text.split(/```([^\n`]*)\n([\s\S]*?)```/g);
    for(let i=0;i<parts.length;i+=3){if(parts[i]){if(user)body.append(document.createTextNode(parts[i]));else renderProse(body,parts[i]);}if(parts[i+2]!==undefined){const block=element('div','code-block'),head=element('div','code-head'),pre=element('pre');head.append(element('span','code-language',parts[i+1].trim()||'code'),copyButton('code-copy','Copy code',parts[i+2]));pre.append(highlightedCode(parts[i+2],parts[i+1].trim()));block.append(head,pre);body.append(block);}}
    row.append(heading,body);
    window.relayFiles?.renderMessageAttachments(row, message.attachments);
    return row;
  }
  function updateJump() { $("jump-latest").hidden = ui.scroll.scrollHeight - ui.scroll.scrollTop - ui.scroll.clientHeight < 240; }
  function renderMessages(forceScroll = false) {
    const messages = state.conversation?.messages || [];
    const signature = JSON.stringify([state.projectId, state.conversation?.id, messages, state.conversation?.reviews?.map(({ id, status, summary }) => [id, status, summary])]);
    const noProvider=state.ready&&!messages.length&&!['codex','claude','gemini'].some(available);
    ui.empty.hidden = messages.length > 0 || !state.ready || noProvider;
    if($('provider-empty-state'))$('provider-empty-state').hidden=!noProvider;
    if (signature === state.messagesSignature) return;
    state.messagesSignature = signature;
    const nearBottom = ui.scroll.scrollHeight - ui.scroll.scrollTop - ui.scroll.clientHeight < 110;
    const oldTop = ui.scroll.scrollTop;
    const openActivity = new Set([...ui.messages.querySelectorAll("details[open]")].map((node) => node.dataset.group));
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.role !== "activity") { fragment.append(renderMessage(message)); continue; }
      const activities = [message];
      while (messages[index + 1]?.role === "activity") activities.push(messages[++index]);
      const groupKey = String(message.id || `${message.runId || "run"}-${index}`);
      const details = element("details", "activity-group");
      details.dataset.group = groupKey;
      details.open = openActivity.has(groupKey);
      const summary = element("summary", "", "Workspace activity");
      summary.append(element("span", "", `${activities.length} ${activities.length === 1 ? "event" : "events"}`));
      details.append(summary);
      activities.forEach((activity) => details.append(element("div", "activity-entry", activity.text || "Working…")));
      fragment.append(details);
    }
    ui.messages.replaceChildren(fragment);
    if (forceScroll || nearBottom) requestAnimationFrame(() => { ui.scroll.scrollTop = ui.scroll.scrollHeight; updateJump(); });
    else { ui.scroll.scrollTop = oldTop; updateJump(); }
  }

  function renderControls() {
    const running = isRunning();
    const otherRunning = isOtherRunning();
    const busy = Boolean(state.pending) || state.loading || state.projectSaving;
    const name = state.conversation?.activeRun?.connection === 'local' ? 'Local model' : label(state.provider);
    const selectedConnection=connection(state.provider);
    ui.codex.classList.toggle("selected", state.provider === "codex");
    ui.claude.classList.toggle("selected", state.provider === "claude");
    for (const provider of ["codex", "claude", "gemini"]) {
      ui[provider].classList.toggle("selected", state.provider === provider);
      ui[provider].setAttribute("aria-pressed", String(state.provider === provider));
      ui[provider].disabled = !state.ready || busy || running || !available(provider);
      ui[provider].title = available(provider) ? `Use ${label(provider)} for your next message` : `${label(provider)} CLI is not installed`;
    }
    ui.agent.value = state.provider;
    ui.agent.disabled = !state.ready || busy || running;
    for (const option of ui.agent.querySelectorAll("option")) option.disabled = option.value !== "local" && !available(option.value);
    ui.mode.value = state.mode;
    ui.mode.disabled = !state.ready || busy || running;
    ui.input.disabled = !state.ready || state.loading || state.pending === "new";
    ui.input.placeholder = running ? "Draft your next message…" : "Describe the task or ask a question…";
    ui.send.hidden = running;
    ui.send.disabled = !state.ready || busy || otherRunning || selectedConnection.blocked || window.relayFiles?.uploading() || (!ui.input.value.trim() && !window.relayFiles?.ids().length);
    ui.send.firstElementChild.textContent = state.pending === "send" ? "Sending…" : "Send";
    ui.stop.hidden = !running;
    ui.stop.disabled = busy;
    ui.stop.lastChild.textContent = state.pending === "stop" ? " Stopping…" : " Stop";
    ui.otherRunning.hidden = !otherRunning;
    const incomplete = ["incomplete", "interrupted"].includes(state.conversation?.status);
    const lastMessage = state.conversation?.messages?.at(-1);
    const canContinue = !running && state.conversation?.lastRun?.purpose !== 'review' && (incomplete || lastMessage?.role === "error");
    ui.continuation.hidden = !canContinue;
    const previous=state.conversation?.lastRun;
    const reason={quota:'Usage limit reached.',authentication:'Sign-in required.',permission:'A permission request was declined.',protocol:'The assistant connection stopped.',interrupted:'Run stopped.'}[previous?.errorCategory] || 'The previous run did not finish.';
    ui.continueText.textContent = reason;
    const alternative=['codex','claude','gemini'].find(provider=>provider!==state.provider&&!connection(provider).blocked) || state.provider;
    const continuationProvider=previous?.errorCategory==='quota' && previous.provider===state.provider && !connection(alternative).blocked ? alternative : state.provider;
    state.continuationProvider=continuationProvider;
    ui.continueButton.replaceChildren(document.createTextNode(state.pending === "continue" ? "Continuing…" : `Continue with ${label(continuationProvider)} `), element("span", "", "→"));
    ui.continueButton.disabled = busy || otherRunning || connection(continuationProvider).blocked;
    const hasMessages = Boolean(state.conversation?.messages?.length);
    ui.title.textContent=state.loading&&state.projectId?'Opening workspace…':currentProject()?.name||'Throughline';
    const run=state.conversation?.activeRun || state.conversation?.lastRun;
    const effective=run?.provider===state.provider?run.effectiveModel:null;
    ui.subtitle.textContent=state.projectId?'Conversation':'Workspace';
    ui.state.classList.toggle('running',running);
    ui.state.hidden=!state.projectId||!state.ready;
    const approvals=state.conversation?.pendingApprovals?.length;
    let status=running?(approvals?'Approval required':'Running'):selectedConnection.needsSignIn||!selectedConnection.installed?'Connection required':selectedConnection.needsBilling?'Review billing':selectedConnection.checking?'Checking connection':selectedConnection.account?.authenticated!==true?'Not verified':'Ready';
    if (running && run?.purpose === 'review') status = 'Reviewing';
    if(incomplete && run?.provider===state.provider)status='Stopped';
    if(state.pending==='stop')status='Stopping…';else if(state.pending==='send'||state.pending==='continue')status='Sending…';
    ui.state.lastElementChild.textContent=status;
    ui.state.dataset.status=running?(approvals?'approval':'running'):incomplete?'stopped':selectedConnection.blocked?'setup':'ready';
    renderConnectionNotice();
    document.title = currentProject() ? currentProject().name + " · Throughline" : "Throughline · Your project workspaces";
  }
  function render(forceScroll = false) { renderProjects(); renderStatus(); renderWorkspaceList(); renderMessages(forceScroll); renderControls(); window.dispatchEvent(new CustomEvent("relay-state")); }
  function resizeInput() {
    ui.input.style.height = "auto";
    ui.input.style.height = `${Math.min(Math.max(ui.input.scrollHeight, 64), 200)}px`;
  }

  function applyConversation(conversation, { adoptSettings = true } = {}) {
    const previousStatus = state.conversation?.status;
    state.conversation = conversation;
    if (adoptSettings && !state.settingsPending) {
      state.provider = ['codex','claude','gemini'].includes(conversation.provider) ? conversation.provider : 'codex';
      state.mode = conversation.mode === "read" ? "read" : "edit";
      state.model = conversation.models?.[state.provider] || conversation.model || "";
      state.effort = conversation.effort ?? conversation.efforts?.[state.provider]?.[state.model || "default"] ?? null;
    }
    if (conversation.status === "running" && state.status) state.status.runningConversationId = conversation.id;
    if (previousStatus === "running" && conversation.status !== "running") announce(conversation.status === "complete" ? `${label(conversation.provider)} finished its response.` : "The assistant stopped. You can continue this conversation.");
  }
  async function ensureCanonicalConversation() {
    if (!state.projectId || !state.ready) throw new Error('Choose an available workspace first.');
    if (state.conversation) return state.conversation;
    const projectId = state.projectId, version = state.projectVersion;
    const conversation = await api('/api/conversation',{},projectId);
    if (!sameProject(projectId,version)) throw new Error('The workspace changed while opening its chat.');
    applyConversation(conversation); restoreDraft(); render(); return conversation;
  }

  async function refresh() {
    const projectId = state.projectId;
    const projectVersion = state.projectVersion;
    if (!projectId || !state.ready) return;
    if (state.refreshPromise?.projectId === projectId && state.refreshPromise.version === projectVersion) { state.refreshAgain = true; return state.refreshPromise.promise; }
    const settingsRevision = state.settingsRevision;
    const request = { projectId, version: projectVersion, promise: null };
    state.refreshPromise = request;
    request.promise = (async () => {
      try {
        const [status, conversation] = await Promise.all([api('/api/status',{},projectId),api('/api/conversation',{},projectId)]);
        if (!sameProject(projectId,projectVersion)) return;
        state.status = status;
        applyConversation(conversation,{adoptSettings:settingsRevision === state.settingsRevision});
        render();
      } catch (error) { if (sameProject(projectId, projectVersion)) showNotice(error.message, refresh); }
      finally {
        if (state.refreshPromise === request) {
          state.refreshPromise = null;
          if (state.refreshAgain) { state.refreshAgain = false; scheduleRefresh(); }
        }
      }
    })();
    return request.promise;
  }
  function scheduleRefresh() {
    if (state.eventTimer) return;
    state.eventTimer = setTimeout(() => { state.eventTimer = null; refresh(); }, 120);
  }

  function changeSettings(provider, mode) {
    if (!state.ready || state.loading || state.projectSaving || isRunning() || state.pending) return;
    if (provider !== state.provider) { state.model = state.conversation?.models?.[provider] || ""; state.effort = state.conversation?.efforts?.[provider]?.[state.model || "default"] ?? null; }
    state.provider = provider;
    state.mode = mode;
    renderControls();
    window.dispatchEvent(new CustomEvent("relay-state"));
    if (!state.conversation) return;
    const id = state.conversation.id;
    const projectId = state.projectId;
    const projectVersion = state.projectVersion;
    const revision = ++state.settingsRevision;
    state.settingsPending++;
    renderProjects();
    renderWorkspaceList();
    state.settingsPromise = state.settingsPromise.catch(() => {}).then(async () => {
      try {
        const conversation = await post(endpoint(id, "provider"), { provider, mode }, projectId);
        if (sameProject(projectId, projectVersion) && state.conversation?.id === id && revision === state.settingsRevision) applyConversation(conversation, { adoptSettings: false });
      } catch (error) {
        if (sameProject(projectId, projectVersion)) showNotice(`Could not save the assistant selection. ${error.message}`, () => changeSettings(provider, mode));
      } finally { state.settingsPending--; renderProjects(); renderWorkspaceList(); scheduleRefresh(); }
    });
  }

  async function run(continuing = false) {
    const attachments = continuing ? [] : window.relayFiles?.ids() || [];
    const text = ui.input.value.trim() || (attachments.length ? "Please review the attached files." : "");
    if (window.relayFiles?.uploading()) return;
    if (state.pending || state.loading || state.projectSaving || isRunning() || isOtherRunning() || !state.ready || connection(state.provider).blocked || (!continuing && !text)) return;
    const provider = state.provider;
    const mode = state.mode;
    const originalDraft = ui.input.value;
    const payloadKey = JSON.stringify([state.projectId,state.conversation?.id,continuing,text,provider,mode,state.model,state.effort,attachments]);
    const requestId = state.retrySubmission?.key === payloadKey ? state.retrySubmission.id : crypto.randomUUID();
    state.retrySubmission = {key:payloadKey,id:requestId};
    const projectId = state.projectId;
    state.pending = continuing ? "continue" : "send";
    saveDraft();
    render();
    hideNotice();
    try {
      await state.settingsPromise;
      if (!state.conversation) await ensureCanonicalConversation();
      const id = state.conversation.id;
      state.retrySubmission.key = JSON.stringify([state.projectId,id,continuing,text,provider,mode,state.model,state.effort,attachments]);
      await post(endpoint(id, continuing ? "continue" : "messages"), continuing ? { provider, mode, requestId, model:state.model || undefined, effort:state.effort || null, billingConfirmed:window.relayBillingConfirmed === true } : { text, attachments, provider, mode, requestId, model:state.model || undefined, effort:state.effort || null, billingConfirmed:window.relayBillingConfirmed === true }, projectId);
      state.retrySubmission = null;
      if (!continuing) window.relayFiles?.accepted(projectId, attachments);
      if (!continuing && ui.input.value === originalDraft) {
        ui.input.value = "";
        storedWrite(draftKey(), "");
        storedWrite(draftKey(null), "");
        resizeInput();
      }
      state.conversation.status = "running";
      state.conversation.provider = provider;
      state.conversation.mode = mode;
      if (state.status) state.status.runningConversationId = id;
      announce(`${label(provider)} is working.`);
      await refresh();
      render(true);
    } catch (error) {
      showNotice(error.message, () => run(continuing));
      await refresh();
    } finally { state.pending = null; render(); ui.input.focus(); }
  }

  async function stop() {
    if (!isRunning() || state.pending || state.projectSaving) return;
    state.pending = "stop";
    const projectId = state.projectId;
    render();
    try {
      await post(endpoint(state.conversation.id, "stop"), {}, projectId);
      announce("Stop requested. Waiting for the assistant to finish stopping.");
      await refresh();
    } catch (error) { showNotice(error.message, stop); }
    finally { state.pending = null; render(); }
  }

  async function selectProject(id) {
    if (projectBusy() || !id || !state.projects.some((project) => project.id === id)) {
      ui.projectSelect.value = state.projectId || "";
      return;
    }
    if (id === state.projectId && state.ready) return;
    saveDraft();
    closeWorkspaceMenu();
    hideNotice();
    const version = ++state.projectVersion;
    ++state.selectionVersion;
    state.projectId = id;
    state.status = null;
    state.conversation = null;
    state.ready = false;
    state.loading = true;
    state.refreshAgain = false;
    ui.input.value = "";
    activeProjectWrite(id);
    ui.projectPanel.hidden = true; ui.folderPanel.hidden = true;
    ui.addProject.setAttribute("aria-expanded", "false");
    render(true);
    try {
      const [status, conversation] = await Promise.all([api('/api/status',{},id),api('/api/conversation',{},id)]);
      if (!sameProject(id,version)) return;
      state.status = status; applyConversation(conversation);
      state.ready = true; state.loading = false; restoreDraft();
      if (sameProject(id, version)) { render(true); announce(`Opened project ${currentProject()?.name || "workspace"}.`); }
    } catch (error) {
      if (sameProject(id, version)) showNotice(error.message, () => selectProject(id));
    } finally {
      if (sameProject(id, version)) { state.loading = false; render(); }
    }
  }

  async function refreshProjects({ choose = false } = {}) {
    const version = ++state.projectsRequestVersion;
    const projects = await api("/api/projects");
    if (version !== state.projectsRequestVersion) return;
    state.projects = Array.isArray(projects) ? projects : projects.projects || [];
    state.projectsLoaded = true;
    render();
    await reconcileProjectSelection(choose);
  }
  async function reconcileProjectSelection(choose = true) {
    if (projectBusy()) return;
    if (state.projectId && !state.projects.some(project => project.id === state.projectId)) {
      saveDraft(); ++state.projectVersion; ++state.selectionVersion;
      state.projectId = null; state.status = null; state.conversation = null;
      state.ready = false; state.loading = false; state.refreshAgain = false;
      ui.input.value = ''; activeProjectWrite('');
      ui.projectPanel.hidden = true; ui.folderPanel.hidden = true;
      ui.addProject.setAttribute('aria-expanded','false');
      render(true);
    }
    if (choose && !state.projectId && state.projects.length) {
      const remembered = activeProjectRead();
      const selected = state.projects.find((project) => project.id === remembered) || state.projects[0];
      await selectProject(selected.id);
    }
  }
  function scheduleProjectsRefresh() {
    if (state.projectsTimer) return;
    state.projectsTimer = setTimeout(() => {
      state.projectsTimer = null;
      refreshProjects({ choose: true }).catch((error) => showNotice(error.message, initialize));
    }, 400);
  }
  function folderPaths(text) { return [...new Set(text.split('\n').map(value=>value.trim()).filter(Boolean))]; }
  function validFolderPath(value) { return value === '~' || value.startsWith('~/') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value); }
  function toggleFolderForm(open) {
    if (projectBusy() || open && (!state.projectId || isRunning())) return;
    ui.folderPanel.hidden = !open;
    if (open) { closeWorkspaceMenu(); ui.projectPanel.hidden = true; ui.addProject.setAttribute('aria-expanded','false'); ui.folderError.hidden = true; $('folder-panel-description').textContent = 'Add a folder to ' + currentProject().name + '. It joins the same existing chat; files stay where they are.'; ui.folderPath.focus(); }
  }
  async function addProject(event) {
    event.preventDefault(); if (projectBusy()) return;
    const folders = folderPaths(ui.projectPaths.value), name = ui.projectName.value.trim();
    if (!folders.length || folders.some(value=>!validFolderPath(value))) { ui.projectError.textContent = 'Enter one or more absolute or ~/ folder paths, one per line.'; ui.projectError.hidden = false; ui.projectPaths.focus(); return; }
    saveDraft(); state.projectSaving = true; ui.projectError.hidden = true; render();
    try {
      const project = await post('/api/projects',{folders,...(name ? {name} : {})});
      if (!state.projects.some(item=>item.id === project.id)) state.projects = [...state.projects,project]; else state.projects = state.projects.map(item=>item.id === project.id ? project : item);
      state.projectsLoaded = true; await refreshProjects().catch(()=>{}); state.projectSaving = false; ui.projectName.value = ''; ui.projectPaths.value = ''; await selectProject(project.id);
    } catch (error) { ui.projectError.textContent = error.message; ui.projectError.hidden = false; }
    finally { state.projectSaving = false; render(); }
  }
  async function addFolder(event) {
    event.preventDefault(); if (projectBusy() || isRunning() || !state.projectId) return;
    const folder = ui.folderPath.value.trim(), projectId = state.projectId;
    if (!validFolderPath(folder)) { ui.folderError.textContent = 'Enter an absolute folder path or a path beginning with ~/.'; ui.folderError.hidden = false; ui.folderPath.focus(); return; }
    saveDraft(); state.projectSaving = true; ui.folderError.hidden = true; render();
    try {
      const project = await post('/api/projects/' + encodeURIComponent(projectId) + '/folders',{path:folder});
      state.projects = state.projects.map(item=>item.id === project.id ? project : item); ui.folderPath.value = ''; ui.folderPanel.hidden = true; await refresh(); announce('Folder added to this workspace. The same conversation is open.');
    } catch (error) { ui.folderError.textContent = error.message; ui.folderError.hidden = false; }
    finally { state.projectSaving = false; render(); }
  }
  async function removeFolder(projectId,folderId) {
    if (projectBusy() || isRunning() || projectId !== state.projectId || foldersFor(currentProject()).length <= 1) return;
    saveDraft(); state.projectSaving = true; render();
    try {
      const project = await post('/api/projects/' + encodeURIComponent(projectId) + '/folders/' + encodeURIComponent(folderId) + '/remove');
      state.projects = state.projects.map(item=>item.id === project.id ? project : item); await refresh(); announce('Folder removed from this workspace. Files remain on disk and the conversation is unchanged.');
    } catch (error) { showNotice(error.message,()=>removeFolder(projectId,folderId)); }
    finally { state.projectSaving = false; render(); }
  }
  let optionsProjectId = null, optionsFolderId = null;
  // Workspace settings lists the folders of the workspace it is open for (the active one otherwise).
  function renderFolderSettings(id = $('workspace-options-dialog').open && optionsProjectId || state.projectId) {
    const host = $('workspace-folder-settings'), project = state.projects.find(item => item.id === id); host.replaceChildren(); if (!project) return;
    const folders = foldersFor(project), list = element('ul','settings-folder-list'), running = Boolean(project.runningConversationId || id === state.projectId && isRunning());
    for (const folder of folders) {
      const item = element('li','settings-folder' + (folder.available === false ? ' unavailable' : '')), info = element('div','settings-folder-info'), icon = element('span','workspace-folder-icon');
      icon.setAttribute('aria-hidden','true'); info.append(element('span','settings-folder-name',folder.displayName || folder.name),element('span','settings-folder-path',folder.path.replace(/^\/(?:Users|home)\/[^/]+/,'~'))); info.title = folder.path;
      const remove = element('button','folder-options'); remove.type = 'button'; remove.dataset.folderId = folder.id; remove.disabled = projectBusy();
      remove.setAttribute('aria-label','Remove ' + (folder.displayName || folder.name) + ' from workspace'); remove.title = folders.length <= 1 ? 'A workspace needs at least one folder' : 'Remove from workspace';
      remove.addEventListener('click',()=>openFolderOptions(id,folder.id)); item.append(icon,info,remove); list.append(item);
    }
    const add = element('button','workspace-add-folder','Add folder'); add.type = 'button'; add.disabled = projectBusy() || running;
    add.addEventListener('click',async()=>{ $('workspace-options-dialog').close(); if (id !== state.projectId) await selectProject(id); toggleFolderForm(true); });
    host.append(list,add);
  }
  function openWorkspaceOptions(id) {
    const project = state.projects.find(item => item.id === id); if (!project || projectBusy()) return;
    optionsProjectId = id; renderFolderSettings(id); $('rename-workspace-name').value = project.name; $('workspace-options-error').hidden = true;
    $('workspace-remove').disabled = Boolean(project.runningConversationId || id === state.projectId && isRunning());
    $('workspace-remove').title = $('workspace-remove').disabled ? 'Stop the current run before removing this workspace.' : '';
    $('workspace-options-dialog').showModal(); $('rename-workspace-name').focus();
  }
  $('close-workspace-options').addEventListener('click',()=>{ if (!state.projectSaving) $('workspace-options-dialog').close(); });
  $('workspace-options-dialog').addEventListener('cancel',event=>{if(state.projectSaving)event.preventDefault();});
  $('workspace-remove').addEventListener('click',()=>{ $('workspace-options-dialog').close(); confirmRemoveWorkspace(optionsProjectId); });
  $('rename-workspace-form').addEventListener('submit',async event=>{
    event.preventDefault(); if (projectBusy()) return;
    const id = optionsProjectId, name = $('rename-workspace-name').value.trim();
    if (!name || name.length > 120) { $('workspace-options-error').textContent = 'Enter a name between 1 and 120 characters.'; $('workspace-options-error').hidden = false; return; }
    state.projectSaving = true; $('save-workspace-name').disabled = true; render();
    try { const project = await post('/api/projects/' + encodeURIComponent(id),{name}); ++state.projectsRequestVersion;
      state.projects = state.projects.map(item=>item.id === id ? project : item); if (id === state.projectId && state.status) state.status.project = project;
      $('workspace-options-dialog').close(); announce('Workspace renamed to ' + project.name + '.');
    } catch(error) { $('workspace-options-error').textContent = error.message; $('workspace-options-error').hidden = false; }
    finally { state.projectSaving = false; $('save-workspace-name').disabled = false; render(); }
  });
  function openFolderOptions(projectId,folderId) {
    if (projectBusy()) return;
    const project = state.projects.find(item=>item.id === projectId), folder = foldersFor(project).find(item=>item.id === folderId); if (!folder) return;
    optionsProjectId = projectId; optionsFolderId = folderId; $('folder-options-path').textContent = folder.path;
    const last = foldersFor(project).length <= 1, running = Boolean(project.runningConversationId || projectId === state.projectId && isRunning());
    $('folder-options-description').textContent = last ? 'This is the last folder. Add another folder before removing it, or remove the whole workspace from Workspace settings.' : running ? 'Stop the current run before changing workspace folders.' : 'Removing this folder detaches it from this workspace. Files stay on disk and the shared chat is kept.';
    $('confirm-remove-folder').disabled = last || running; $('folder-options-dialog').showModal(); $('close-folder-options').focus();
  }
  $('close-folder-options').addEventListener('click',()=>$('folder-options-dialog').close());
  $('confirm-remove-folder').addEventListener('click',()=>{ $('folder-options-dialog').close(); removeFolder(optionsProjectId,optionsFolderId); });
  function confirmRemoveWorkspace(id) {
    const project = state.projects.find(project => project.id === id);
    if (!project || projectBusy() || project.runningConversationId || id === state.projectId && isRunning()) return;
    state.removingProjectId = id; ui.removeName.textContent = project.name; ui.removeError.hidden = true;
    ui.removeDialog.showModal(); ui.removeCancel.focus();
  }
  function closeRemoveWorkspace() {
    if (state.projectSaving) return;
    ui.removeDialog.close(); state.removingProjectId = null;
    ui.workspaceList.querySelector('.workspace-options')?.focus();
  }
  async function removeWorkspace() {
    const id = state.removingProjectId;
    if (projectBusy() || !id) return;
    // A list refresh may already hide an accepted removal whose response was lost.
    const name = ui.removeName.textContent;
    saveDraft(); state.projectSaving = true; ui.removeError.hidden = true; render();
    try {
      await post('/api/projects/' + encodeURIComponent(id) + '/remove');
      ++state.projectsRequestVersion;
      state.projects = state.projects.filter(project => project.id !== id);
      state.projectSaving = false; closeRemoveWorkspace();
      await reconcileProjectSelection();
      showNotice(name + ' removed. Project files and saved chat are kept.', () => restoreWorkspace(id), 'Undo');
      announce('Workspace removed. Undo is available.');
      if (!state.projectId) ui.addFirstProject.focus();
    } catch (error) { ui.removeError.textContent = error.message; ui.removeError.hidden = false; }
    finally { state.projectSaving = false; render(); }
  }
  async function restoreWorkspace(id) {
    if (projectBusy()) return;
    saveDraft(); state.projectSaving = true; render();
    try {
      const project = await post('/api/projects/' + encodeURIComponent(id) + '/restore');
      ++state.projectsRequestVersion;
      if (!state.projects.some(item => item.id === id)) state.projects.push(project);
      state.projectSaving = false; await selectProject(id);
      announce('Workspace restored with its saved chat.');
    } catch (error) { showNotice(error.message, () => restoreWorkspace(id), 'Retry Undo'); }
    finally { state.projectSaving = false; render(); }
  }
  ui.removeConfirm.addEventListener('click', removeWorkspace);
  ui.removeCancel.addEventListener('click', closeRemoveWorkspace);
  ui.removeDialog.addEventListener('cancel', event => { event.preventDefault(); closeRemoveWorkspace(); });
  function connectEvents() {
    if (state.events) return;
    state.events = new EventSource("/api/events" + (window.relayDesktop?.token ? "?token="+encodeURIComponent(window.relayDesktop.token) : ""));
    state.events.addEventListener("update", (event) => {
      let update;
      try { update = JSON.parse(event.data); } catch { return; }
      if (update.projectId === state.projectId) scheduleRefresh();
      else scheduleProjectsRefresh();
    });
    state.events.addEventListener("projects", scheduleProjectsRefresh);
    state.events.addEventListener("error", () => { state.streamConnected = false; window.dispatchEvent(new CustomEvent("relay-state")); });
    state.events.addEventListener("ready", () => { state.streamConnected = true; scheduleProjectsRefresh(); scheduleRefresh(); });
    state.events.addEventListener("open", () => { state.streamConnected = true; scheduleProjectsRefresh(); scheduleRefresh(); });
    // Recover from missed events and a sleeping browser tab.
    state.pollTimer = setInterval(() => { if (!document.hidden) { scheduleProjectsRefresh(); scheduleRefresh(); } }, 15000);
    window.addEventListener("focus", () => { scheduleProjectsRefresh(); scheduleRefresh(); refreshAccounts().catch(()=>{}); });
  }
  async function initialize() {
    try {
      await refreshProjects({ choose: true });
      render();
      connectEvents();
      refreshAccounts().catch(()=>{});
    } catch (error) { showNotice(error.message, initialize); }
  }

  $("workspace-search")?.addEventListener("input", () => { state.workspaceFilter = $("workspace-search").value; renderWorkspaceList(); });
  $("workspace-search")?.addEventListener("keydown", (event) => {
    // Enter opens the first match and Escape clears the filter, so the field doubles as a quick switcher.
    // While an input method is composing, those keys finish or cancel the composition instead.
    if (event.isComposing) return;
    if (event.key === "Enter") { const match = filteredProjects()[0]; if (match) { event.preventDefault(); selectProject(match.id); ui.input.focus(); } }
    if (event.key === "Escape" && $("workspace-search").value) { event.preventDefault(); $("workspace-search").value = ""; state.workspaceFilter = ""; renderWorkspaceList(); }
  });
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || ""), shortcut = (key, shift = false) => mac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
  $("workspace-search").placeholder = `Filter workspaces  ${shortcut("K")}`;
  $("open-git").title = `Git activity (${shortcut("G", true)})`;
  ui.input.title = `Focus with ${shortcut("L")}`;
  // Shortcuts and the desktop menu bar run these commands. Each returns whether the page handled it, and a shortcut
  // is only claimed when it did, so a key the page leaves alone goes on to the menu, whose item makes the same check.
  // A command that stands in for a button waits while a dialog covers it.
  const covered = () => Boolean(document.querySelector("dialog[open]"));
  const press = id => () => { const control = $(id); if (covered() || !control || control.disabled || control.hidden) return false; control.click(); return true; };
  const commands = {
    "filter-workspaces": () => { $("workspace-search").focus(); $("workspace-search").select(); return true; },
    "focus-message": () => { if (!ui.input.disabled) ui.input.focus(); return true; },
    git: () => { $("open-git").click(); return true; },
    stop: () => { if (!isRunning()) return false; stop(); return true; },
    workspace: number => { const project = filteredProjects()[number - 1]; if (!project) return false; selectProject(project.id); return true; },
    settings: press("relay-settings"), "setup-guide": press("open-setup-guide"), "new-workspace": press("create-workspace"), review: press("open-review"),
    "whats-new": () => { if (covered() || !window.relayUpdates) return false; window.relayUpdates.open(); return true; },
    "local-models": () => window.relayLocal?.open(),
    "previous-chats": press("open-import"), export: press("open-export"), files: press("toggle-explorer"), "keep-awake": press("keep-awake"),
    "add-folder": () => { if (covered()) return false; toggleFolderForm(true); return true; },
    agent: provider => ["codex", "claude", "gemini"].includes(provider) && press("select-" + provider)(),
    continue: () => !ui.continuation.hidden && press("continue-button")(),
    appearance: value => { if (!["system", "graphite", "light"].includes(value)) return false; window.relayTheme?.choose(value); return true; },
    "workspace-settings": () => { if (covered() || !state.projectId) return false; openWorkspaceOptions(state.projectId); return true; },
    "remove-workspace": () => { if (covered() || !state.projectId) return false; confirmRemoveWorkspace(state.projectId); return true; },
  };
  document.addEventListener("keydown", (event) => {
    if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase(), run = (name, value) => { if (commands[name](value)) event.preventDefault(); };
    if (key === "k" && !event.shiftKey) run("filter-workspaces");
    else if (key === "l" && !event.shiftKey) run("focus-message");
    else if (key === "g" && event.shiftKey) run("git");
    else if (key === ".") run("stop");
    else if (/^[1-9]$/.test(event.key) && !event.shiftKey) run("workspace", Number(event.key));
  });
  ui.scroll.addEventListener("scroll", updateJump, { passive: true });
  $("jump-latest").addEventListener("click", () => { ui.scroll.scrollTo({ top: ui.scroll.scrollHeight, behavior: "smooth" }); ui.input.focus(); });
  ui.projectSelect.addEventListener("change", () => selectProject(ui.projectSelect.value));
  ui.addProject.addEventListener("click", () => toggleProjectForm(ui.projectPanel.hidden));
  ui.addFirstProject.addEventListener("click", () => toggleProjectForm(true));
  ui.projectClose.addEventListener("click", () => toggleProjectForm(false));
  ui.projectForm.addEventListener("submit", addProject);
  ui.createWorkspace.addEventListener("click",()=>toggleProjectForm(true));
  ui.folderForm.addEventListener("submit",addFolder);
  ui.folderClose.addEventListener("click",()=>toggleFolderForm(false));
  ui.workspaceToggle.addEventListener("click", () => {
    const open = ui.workspaceToggle.getAttribute("aria-expanded") !== "true";
    ui.workspaceToggle.setAttribute("aria-expanded", String(open));
    ui.workspaceToggle.closest(".sidebar").classList.toggle("workspaces-open", open);
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".sidebar")) closeWorkspaceMenu(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !event.isComposing) { closeWorkspaceMenu(); if (!ui.projectPanel.hidden) toggleProjectForm(false); if (!ui.folderPanel.hidden) toggleFolderForm(false); } });
  ui.form.addEventListener("submit", (event) => { event.preventDefault(); run(); });
  ui.input.addEventListener("input", () => { resizeInput(); saveDraft(); renderControls(); });
  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!ui.send.disabled && !ui.send.hidden) run(); }
  });
  ui.agent.addEventListener("change", () => {
    const selected = ui.agent.value;
    if (selected === "local") { ui.agent.value = state.provider; window.relayLocal?.open(); }
    else if (["codex", "claude", "gemini"].includes(selected) && available(selected)) changeSettings(selected, state.mode);
  });
  ui.codex.addEventListener("click", () => changeSettings("codex", state.mode));
  ui.claude.addEventListener("click", () => changeSettings("claude", state.mode));
  ui.gemini.addEventListener("click", () => changeSettings("gemini", state.mode));
  ui.mode.addEventListener("change", () => changeSettings(state.provider, ui.mode.value));
  ui.stop.addEventListener("click", stop);
  ui.continueButton.addEventListener("click", () => {const target=state.continuationProvider||state.provider;if(target!==state.provider)changeSettings(target,state.mode);run(true);});
  ui.viewRunning.addEventListener("click",refresh);
  ui.dismiss.addEventListener("click", hideNotice);
  ui.retry.addEventListener("click", () => { const retry = state.noticeRetry; hideNotice(); if (retry) retry(); });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    if (ui.input.disabled) return;
    ui.input.value = button.dataset.prompt;
    resizeInput(); saveDraft(); renderControls(); ui.input.focus();
  }));
  $('connect-assistant')?.addEventListener('click',()=>$('relay-settings').click());
  $('connection-install')?.addEventListener('click',()=>{if(state.installUrl)openExternal(state.installUrl);});
  $('connection-action')?.addEventListener('click',()=>state.connectionAction?.());
  for(const provider of ['codex','claude','gemini'])$(`${provider}-status`)?.addEventListener('click',event=>{if(!event.target?.closest?.('.usage-meter'))$('relay-settings')?.click();});
  window.addEventListener('relay-account',()=>{renderStatus();renderControls();});
  window.addEventListener('relay-billing',()=>{renderStatus();renderControls();});
  window.addEventListener("beforeunload", saveDraft);
  window.relayUI = {
    getState: () => state, api, post, refresh, renderControls, showNotice, selectProject, refreshAccounts, refreshProjects, announce, selectedFolderId: () => selectedFolderId(), selectFolder, highlightLines,
    commands, isRunning, filteredProjects,
    ensureConversation: ensureCanonicalConversation,
    async setModel(model) { return window.relayUI.setConfiguration({ model, effort: null }); },
    async setConfiguration({model = state.model, effort = null}) {
      if (!state.ready || state.pending || state.settingsPending || isRunning()) throw new Error('Finish the current run before changing the model or effort.');
      model = model?.trim() || null;
      const projectId = state.projectId, version = state.projectVersion, conversationId = state.conversation?.id, provider = state.provider;
      const revision = ++state.settingsRevision;
      state.settingsPending++; render();
      const operation = state.settingsPromise.catch(() => {}).then(() => post(endpoint(conversationId,'provider'), {provider,mode:state.mode,model,effort},projectId));
      state.settingsPromise = operation;
      try {
        const conversation = await operation;
        if (sameProject(projectId,version) && revision === state.settingsRevision) {
          state.conversation = conversation; state.model = model || ''; state.effort = effort;
        }
      } finally { state.settingsPending--; if (sameProject(projectId,version)) render(); }
    },
  };
  if (window.relayDesktop) {
    $('pick-folder').hidden = false; $('pick-add-folder').hidden = false;
    $('pick-folder').addEventListener('click',async()=>{try { const picked = await window.relayDesktop.pickFolder(); const folders = Array.isArray(picked) ? picked : picked ? [picked] : []; if (folders.length) ui.projectPaths.value = [...new Set([...folderPaths(ui.projectPaths.value),...folders])].join('\n'); } catch (error) { showNotice(error.message); }});
    $('pick-add-folder').addEventListener('click',async()=>{try { const picked = await window.relayDesktop.pickFolder(); if (picked) ui.folderPath.value = Array.isArray(picked) ? picked[0] || '' : picked; } catch (error) { showNotice(error.message); }});
  }
  render();
  initialize();
})();
