(() => {
  'use strict';
  const $ = id => document.getElementById(id), api = window.relayUI, dialog = $('setup-dialog');
  const titles = ['Your assistants', 'How you work', 'Your environment', 'Your first workspace'];
  const steps = ['Assistants', 'Defaults', 'Appearance', 'Workspace'];
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, fn, cls = 'secondary-button') => { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', () => perform(fn)); return el; };
  const field = (label, tag, value = '') => { const wrap = node('label',label), input = node(tag); input.value = value; wrap.append(input); return {wrap,input}; };
  const option = (select, text, value) => { const el = node('option',text); el.value = value; select.append(el); };
  const providerName = p => p === 'claude' ? 'Claude' : 'Codex';
  let connectionSignature = '';
  let preferences, step = 0, busy = false, revision = 0, catalog = {}, draft = {provider:'codex',model:null,effort:null,mode:'edit',billing:'subscription'}, theme = 'graphite', projectName = '', projectPaths = '';
  function progress() {
    const completed = preferences?.onboarding?.completedAt;
    // The sidebar launcher is for unfinished setup only; Settings › Setup guide reopens it later.
    $('open-setup').hidden = Boolean(completed || preferences?.onboarding?.dismissed);
    $('setup-progress').textContent = completed ? 'Review' : `${step + 1} of 4`;
    $('open-setup').setAttribute('aria-label', completed ? 'Review setup and app defaults' : `Getting started, step ${step + 1} of 4`);
  }
  function error(message = '') { $('setup-error').textContent = message; $('setup-error').hidden = !message; }
  async function perform(fn) {
    if (busy) return; busy = true; error(); controls();
    try { await fn(); } catch (e) { error(e.message || 'Could not save setup. Try again.'); }
    finally { busy = false; controls(); }
  }
  function controls() { $('setup-next').disabled = busy; $('setup-back').disabled = busy || step === 0; $('close-setup').disabled = busy; dialog.setAttribute('aria-busy',String(busy)); }
  async function save({completed = false, dismissed = false} = {}) {
    preferences = await api.post('/api/preferences',{defaults:draft,theme,onboarding:{step,completed,dismissed}},null);
    window.relayTheme?.apply(theme); progress();
  }
  async function move(next) { const before=step; step = next; try { await save(); } catch(e) { step=before; throw e; } render(); }
  async function close() { await save({dismissed:true}); dialog.close(); $('open-setup').focus(); }
  function render() {
    progress(); const version = ++revision, host = $('setup-content'); host.replaceChildren(); $('setup-steps').replaceChildren();
    steps.forEach((title,index) => { const entry = button('',()=>move(index),'setup-step'); entry.append(node('span',index < step ? '✓' : String(index + 1),'step-number'),node('span',title)); entry.setAttribute('aria-current',index === step ? 'step' : 'false'); entry.dataset.complete=String(index < step); $('setup-steps').append(entry); });
    host.dataset.step=String(step);
    $('setup-next').textContent = step === 3 ? 'Finish setup' : 'Continue'; $('setup-step-status').textContent = `Step ${step + 1} of 4`; controls();
    host.append(node('h3',titles[step]));
    if (step === 0) connections(host);
    if (step === 1) defaults(host,version);
    if (step === 2) appearance(host);
    if (step === 3) workspace(host);
  }
  function connections(host) {
    connectionSignature=JSON.stringify(api.getState().accounts);
    host.append(node('p','Choose who starts the conversation. You can switch assistants anytime without losing the thread.','setup-description'));
    const cards = node('div',undefined,'setup-agent-grid'); host.append(cards);
    for (const provider of ['codex','claude']) {
      const account = api.getState().accounts?.[provider], card = node('section',undefined,'setup-agent'); card.dataset.provider = provider; card.dataset.selected=String(draft.provider===provider);
      const select = button('',()=>{draft.provider=provider;draft.model=null;draft.effort=null;render();},'setup-agent-select'); select.append(node('i',undefined,'agent-icon '+provider),node('strong',providerName(provider)),node('span',draft.provider===provider?'Selected':'Select','setup-selection')); select.setAttribute('aria-pressed',String(draft.provider === provider));
      card.append(select,node('span',!account ? 'Checking connection…' : !account.installed ? 'CLI not installed' : account.authenticated === true ? 'Connected on this computer' : account.authenticated === false ? 'Sign-in required' : 'Connection not verified','setup-account-state')); card.lastElementChild.dataset.connected=String(account?.authenticated===true);
      if (account?.planType || account?.subscriptionType) card.append(node('p',String(account.planType || account.subscriptionType).replace(/[_-]/g,' '),'setup-plan'));
      card.append(node('p',account?.billingSource === 'subscription' ? 'Uses your subscription' : account?.billingSource === 'api' ? 'Detected API billing' : 'Billing not reported','muted'));
      if (account?.installed && account.authenticated !== true) card.append(button('Connect ' + providerName(provider),async()=>{
        const result = await api.post(`/api/providers/${provider}/connect`,{},null), url = result.authUrl || result.url;
        card.append(node('p',result.message || 'Finish signing in with the provider, then refresh connections.','setup-description'));
        if (url) card.append(button('Open sign-in page',async()=>{ if(window.relayDesktop) await window.relayDesktop.openExternal(url); else window.open(url,'_blank','noopener,noreferrer'); }));
      }));
      if (account?.installed === false) card.append(node('p',`Install ${provider === 'codex' ? 'Codex CLI' : 'Claude Code'}, then refresh connections.`,'muted'));
      cards.append(card);
    }
    const connectionTools = node('div',undefined,'setup-connection-tools'); host.append(connectionTools);
    connectionTools.append(button('Refresh connections',async()=>{await api.refreshAccounts({force:true});render();}));
    const billing = field('Preferred billing connection','select',draft.billing); option(billing.input,'My existing subscription','subscription'); option(billing.input,'My existing API connection','api'); billing.input.value=draft.billing; billing.input.addEventListener('change',()=>{draft.billing=billing.input.value;}); const advanced=node('details',undefined,'setup-advanced'); advanced.append(node('summary','Connection preferences'),billing.wrap); host.append(advanced);
    advanced.append(node('p','Uses the accounts already on this computer. This preference does not purchase or change a plan. API billing requires review before a run.','setup-footnote'));
    connectionTools.append(node('span','Connect now or come back later.','setup-footnote'));
  }
  function defaults(host,version) {
    host.append(node('p','Set your starting point. Each conversation can use its own model, effort and file access.','setup-description'));
    const provider = field('Default assistant','select',draft.provider); option(provider.input,'Codex','codex'); option(provider.input,'Claude','claude'); provider.input.value=draft.provider;
    provider.input.addEventListener('change',()=>{draft.provider=provider.input.value;draft.model=null;draft.effort=null;render();}); host.append(provider.wrap);
    const model = field('Default model','select'), effort = field('Reasoning effort','select'); host.append(model.wrap,effort.wrap);
    const note = node('p','Provider default follows the agent’s recommended model and reasoning effort.','setup-footnote');
    function populate() {
      const rows=catalog[draft.provider] || [], selected=rows.find(row=>[row.id,row.model,row.value].includes(draft.model)) || (!draft.model && rows.find(row=>row.isDefault || row.value==='default'));
      model.input.replaceChildren(); option(model.input,'Provider default' + (selected && !draft.model ? ' · ' + (selected.displayName || selected.id || selected.value) : ''),'');
      for (const row of rows.filter(row=>row.value !== 'default')) option(model.input,row.displayName || row.name || row.id || row.value,row.id || row.model || row.value);
      if (draft.model && !rows.some(row=>[row.id,row.model,row.value].includes(draft.model))) option(model.input,draft.model + ' (saved)',draft.model);
      model.input.value=draft.model || ''; effort.input.replaceChildren(); option(effort.input,'Provider default','');
      const levels=selected?.supportedEffortLevels || selected?.supportedReasoningEfforts?.map(row=>row.reasoningEffort) || [];
      for(const value of levels) option(effort.input,value[0].toUpperCase()+value.slice(1),value);
      if(draft.effort && !levels.includes(draft.effort)) option(effort.input,draft.effort+' (saved)',draft.effort);
      effort.input.value=draft.effort || ''; effort.input.disabled=!levels.length;
    }
    model.input.addEventListener('change',()=>{draft.model=model.input.value || null;draft.effort=null;populate();}); effort.input.addEventListener('change',()=>{draft.effort=effort.input.value || null;}); populate();
    const access=field('Default workspace access','select',draft.mode); option(access.input,'Can edit files','edit');option(access.input,'Read only','read');access.input.value=draft.mode;access.input.addEventListener('change',()=>{draft.mode=access.input.value;});host.append(access.wrap,note);
    if(!catalog[draft.provider]) { const requested=draft.provider; model.input.disabled=true; note.textContent='Loading models reported by '+providerName(requested)+'…';
      api.api(`/api/providers/${requested}/models`,{},null).then(result=>{catalog[requested]=result.models || [];if(revision===version){populate();note.textContent='Provider default follows the agent’s recommended model. You can change models per chat.';}}).catch(()=>{if(revision===version) note.textContent='Models could not be loaded. Provider default remains available; refresh this step after connecting.';}).finally(()=>{if(revision===version)model.input.disabled=false;});
    }
  }
  function appearance(host) {
    host.append(node('p','A quiet editor palette with color for assistants, activity and changes.','setup-description'));
    const choices=node('div',undefined,'setup-theme-grid');
    for(const [value,label] of [['graphite','Graphite'],['light','Light']]) {
      const choice=button('',()=>{theme=value;window.relayTheme?.apply(theme);render();},'setup-theme'); choice.dataset.theme=value;choice.setAttribute('aria-pressed',String(theme===value));
      const preview=node('span',undefined,'theme-preview'), rail=node('i'), canvas=node('span',undefined,'theme-preview-canvas'); rail.append(node('b'),node('b'),node('b')); canvas.append(node('b','Your workspace'),node('em','✓ Ready to build'),node('i'),node('i'),node('small','Ask anything about your project…'));preview.append(rail,canvas);choice.append(preview,node('strong',label),node('span',value==='graphite'?'Dark, neutral surfaces':'Light, clear contrast','muted'));choices.append(choice);
    }
    host.append(choices,node('p','You can switch themes anytime in the status bar.','setup-footnote'));
  }
  function workspace(host) {
    host.append(node('p','Continue an existing Claude or Codex conversation, or add the folders for a new project.','setup-description'));
    if(api.getState().projects.length)host.append(node('p',`${api.getState().projects.length} workspace${api.getState().projects.length===1?' is':'s are'} ready. Your saved chats stay as they are.`,'setup-ready'));
    const importCard=button('',async()=>{await save({dismissed:true});dialog.close();$('open-import').click();},'setup-import-card'); importCard.append(node('span','↳','setup-import-icon'),node('strong','Import existing chats'),node('span','Pick up a Claude or Codex conversation','muted'),node('i','→')); host.append(importCard);
    const form=node('div',undefined,'setup-project'); form.append(node('h4','Start with a project folder'));
    const name=field('Workspace name (optional)','input',projectName),paths=field('Folder paths, one per line','textarea',projectPaths);paths.input.rows=2;paths.input.placeholder='~/projects/frontend\n~/projects/backend';name.input.maxLength=120;
    name.input.addEventListener('input',()=>{projectName=name.input.value;});paths.input.addEventListener('input',()=>{projectPaths=paths.input.value;});form.append(name.wrap); const pathDetails=node('details',undefined,'setup-advanced setup-paths'); pathDetails.open=!window.relayDesktop || Boolean(projectPaths); pathDetails.append(node('summary','Enter folder paths manually'),paths.wrap); form.append(pathDetails);
    if(window.relayDesktop)form.append(button('Choose folder…',async()=>{const picked=await window.relayDesktop.pickFolder();if(picked){projectPaths=[...new Set([...projectPaths.split('\n').filter(Boolean),...(Array.isArray(picked)?picked:[picked])])].join('\n');paths.input.value=projectPaths;pathDetails.open=true;}}));
    form.append(button('Create workspace',async()=>{const folders=[...new Set(projectPaths.split('\n').map(text=>text.trim()).filter(Boolean))];if(!folders.length)throw Error('Choose at least one project folder.');await save();const project=await api.post('/api/projects',{folders,...(projectName.trim()?{name:projectName.trim()}:{})},null);await api.refreshProjects();await api.selectProject(project.id);projectPaths='';projectName='';render();},'secondary-button'));host.append(form,node('p','Imports are previewed before you approve them. You can also finish setup and add a workspace later.','setup-footnote'));
  }
  async function open() { await ready; step=preferences?.onboarding?.step || 0; draft={...preferences.defaults};theme=preferences.theme;error();dialog.showModal();render(); }
  window.relaySetup={open};
  $('open-setup').addEventListener('click',()=>perform(open));
  $('open-setup-guide')?.addEventListener('click',()=>{$('workbench').close();perform(async()=>{await open();if(preferences?.onboarding?.completedAt){step=0;render();}});});
  $('close-setup').addEventListener('click',()=>perform(close));
  dialog.addEventListener('cancel',event=>{event.preventDefault();perform(close);});
  $('setup-back').addEventListener('click',()=>perform(()=>move(Math.max(0,step-1))));
  $('setup-next').addEventListener('click',()=>perform(async()=>{if(step<3)return move(step+1);await save({completed:true});dialog.close();api.showNotice('Setup complete. Your defaults will be used for new workspaces.');}));
  window.addEventListener('relay-state',()=>{if(dialog.open && step===0 && !busy && connectionSignature!==JSON.stringify(api.getState().accounts))render();});
  window.addEventListener('relay-account',()=>{if(dialog.open && step===0 && !busy)render();});
  const ready=api.api('/api/preferences',{},null).then(value=>{preferences=value;step=value.onboarding?.step || 0;draft={...value.defaults};theme=value.theme;progress();if(value.firstRun){dialog.showModal();render();}}).catch(e=>{preferences={defaults:draft,theme,onboarding:{step:0}};api.showNotice('Setup preferences could not be loaded. '+e.message);});
})();
