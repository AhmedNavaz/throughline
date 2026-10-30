(() => {
  'use strict';
  const $ = id => document.getElementById(id), api = window.relayUI;
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const name = provider => provider === 'claude' ? 'Claude' : 'Codex';
  const title = value => value ? value[0].toUpperCase() + value.slice(1) : 'Provider default';
  const duration = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; };
  const date = value => !value || Number.isNaN(new Date(value).getTime()) ? 'Date unavailable' : new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const action = (text, fn, cls) => { const button = el('button', text, cls); button.type = 'button'; button.addEventListener('click', fn); return button; };
  const external = async url => { if (window.relayDesktop) await window.relayDesktop.openExternal(url); else window.open(url, '_blank', 'noopener,noreferrer'); };
  const catalog = {}, loadingModels = {}, attemptedModels = {};
  let modelSignature = '', lastProject = null;

  function modelControls() {
    const state = api.getState(), provider = state.provider, rows = catalog[provider] || [];
    const signature = JSON.stringify([provider, state.model, state.effort, rows]);
    const selected = rows.find(row => [row.id, row.model, row.value, row.resolvedModel].includes(state.model)) || (!state.model && rows.find(row => row.isDefault || row.value === 'default'));
    if (signature !== modelSignature) {
      modelSignature = signature;
      $('model-select').replaceChildren();
      const base = el('option', 'Provider default'); base.value = ''; $('model-select').append(base);
      for (const row of rows.filter(row => row.value !== 'default')) { const option = el('option', row.displayName || row.name || row.id || row.value); option.value = row.id || row.model || row.value; $('model-select').append(option); }
      if (state.model && !rows.some(row => (row.id || row.model || row.value) === state.model)) { const option = el('option', state.model); option.value = state.model; $('model-select').append(option); }
      const custom = el('option', 'Enter a model ID…'); custom.value = '__custom__'; $('model-select').append(custom);
      $('model-select').value = state.model || '';
      const effortDefault = el('option', selected?.defaultReasoningEffort ? `Default (${selected.defaultReasoningEffort})` : 'Provider default'); effortDefault.value = '';
      $('effort-select').replaceChildren(effortDefault);
      const efforts = selected?.supportedEffortLevels || selected?.supportedReasoningEfforts?.map(row => row.reasoningEffort) || [];
      for (const effort of efforts) { const option = el('option', title(effort)); option.value = effort; $('effort-select').append(option); }
      if (state.effort && !efforts.includes(state.effort)) { const option = el('option', `${title(state.effort)} (saved)`); option.value = state.effort; $('effort-select').append(option); }
      $('effort-select').value = state.effort || '';
      $('effort-select').dataset.supported = String(efforts.length > 0);
    }
    const locked = !state.ready || state.pending || state.settingsPending || state.conversation?.status === 'running';
    $('model-select').disabled = Boolean(locked || loadingModels[provider]);
    $('save-custom-model').disabled = Boolean(locked);
    $('custom-model-input').disabled = Boolean(locked);
    $('refresh-models').disabled = Boolean(locked || loadingModels[provider]);
    $('refresh-models').setAttribute('aria-busy', String(Boolean(loadingModels[provider])));
    $('effort-select').disabled = Boolean(locked || $('effort-select').dataset.supported !== 'true');
    $('model-description').textContent = loadingModels[provider] ? `Loading ${name(provider)} models…` : `${name(provider)} · ${selected?.displayName || state.model || 'Provider default'} · ${state.effort ? title(state.effort) + ' reasoning effort' : 'Default reasoning effort'}${!rows.length ? ' — refresh to load available models' : ''}`;
  }
  async function loadModels(force = false) {
    const state = api.getState(), provider = state.provider;
    if (loadingModels[provider] || (!force && catalog[provider]?.length) || !state.ready) return;
    loadingModels[provider] = true; attemptedModels[provider] = true; modelControls();
    try { const result = await api.api(`/api/providers/${provider}/models`, {}, state.projectId); catalog[provider] = result.models || []; }
    catch (error) { api.showNotice(`Could not load ${name(provider)} models. ${error.message}`); }
    finally { loadingModels[provider] = false; modelControls(); }
  }
  $('model-select').addEventListener('focus', () => loadModels());
  $('refresh-models').addEventListener('click', () => loadModels(true));
  $('model-select').addEventListener('change', async () => {
    const state = api.getState(), model = $('model-select').value;
    if (model === '__custom__') { $('custom-model-editor').hidden = false; $('custom-model-input').value = state.model || ''; $('custom-model-input').focus(); return; }
    $('custom-model-editor').hidden = true;
    const effort = state.conversation?.efforts?.[state.provider]?.[model || 'default'] ?? null;
    try { await api.setConfiguration({ model, effort }); } catch (error) { api.showNotice(error.message); } finally { modelControls(); }
  });
  $('cancel-custom-model').addEventListener('click', () => { $('custom-model-editor').hidden = true; $('model-select').value = api.getState().model || ''; });
  $('save-custom-model').addEventListener('click', async () => {
    const model = $('custom-model-input').value.trim();
    if (!model || model.length > 200) { api.showNotice('Enter a supported model ID of at most 200 characters.'); return; }
    try { await api.setConfiguration({ model, effort: null }); $('custom-model-editor').hidden = true; }
    catch (error) { api.showNotice(error.message); } finally { modelControls(); }
  });
  $('effort-select').addEventListener('change', async () => { try { await api.setConfiguration({ effort: $('effort-select').value || null }); } catch (error) { api.showNotice(error.message); } finally { modelControls(); } });

  function progress() {
    const state = api.getState(), c = state.conversation, running = c?.status === 'running', run = running ? c.activeRun : c?.lastRun;
    $('run-progress').hidden = !run;
    if (!run) return;
    const elapsed = running ? Date.now() - Date.parse(run.startedAt) : run.elapsedMs || Date.parse(run.endedAt) - Date.parse(run.startedAt);
    const silence = Date.now() - Date.parse(run.lastEventAt || run.startedAt);
    const phase = c.pendingApprovals?.length ? 'approval' : run.phase || 'starting';
    const quiet = running && !c.pendingApprovals?.length && silence > 30000;
    const phaseLabel = { starting: 'Starting agent', working: 'Working', reasoning: 'Reasoning', responding: 'Writing response', tool: 'Running tools', compacting: 'Organizing context', approval: 'Waiting for approval' }[phase] || 'Working';
    $('run-phase').textContent = running ? state.streamConnected === false ? 'Reconnecting to app' : quiet ? 'Waiting for provider' : phaseLabel : run.status === 'complete' ? 'Completed' : run.errorCategory === 'quota' ? 'Usage limit reached' : 'Run stopped';
    $('run-phase').className = `run-phase ${running ? quiet ? 'quiet' : phase === 'approval' ? 'approval' : 'active' : run.status === 'complete' ? 'complete' : 'quiet'}`;
    $('run-elapsed').textContent = `${running ? 'Elapsed ' : ''}${Number.isFinite(elapsed) ? duration(elapsed) : 'Duration not recorded'}`;
    const model = run.effectiveModel && run.effectiveModel !== 'unknown' ? run.effectiveModel : run.model || 'Provider default';
    const effort = run.effectiveEffort || run.effort;
    $('run-detail').textContent = running ? state.streamConnected === false ? 'The app connection was interrupted. The agent may still be running; reconnecting to restore its live status.' : phase === 'approval' ? 'Review the permission request below to let the agent continue.' : quiet ? `No provider activity for ${duration(silence)}. This can happen during a long request; you can wait or stop the run.` : phase === 'reasoning' ? `${name(run.provider)} reported reasoning activity. Its private reasoning stays private.` : phase === 'tool' ? `${name(run.provider)} is using workspace tools. Open workspace activity to see commands and file changes.` : phase === 'responding' ? 'The response is arriving live.' : 'The agent is running. New activity appears here as it arrives.' : `${name(run.provider)} · ${model}${effort ? ' · ' + title(effort) + ' effort' : ''}`;
    const metrics = [];
    if (running) metrics.push(`${name(run.provider)} · ${model}${effort ? ' · ' + title(effort) : ''}`, `${state.streamConnected === false ? 'Reconnecting to app' : 'Live updates'}`, `Last activity ${duration(silence)} ago`);
    if (run.toolCount) metrics.push(`${run.toolCount} tool step${run.toolCount === 1 ? '' : 's'}`);
    const usage = run.usage?.total || run.usage, input = usage?.inputTokens ?? usage?.input_tokens, output = usage?.outputTokens ?? usage?.output_tokens;
    if (typeof input === 'number') metrics.push(`${input.toLocaleString()} input tokens`);
    if (typeof output === 'number') metrics.push(`${output.toLocaleString()} output tokens`);
    $('run-metrics').replaceChildren(...metrics.map(value => el('span', value)));
  }

  let gitData = null, gitScope = null, gitBusy = false, gitView = 'changes', gitRequest = 0;
  function renderGit() {
    const repositories = gitData?.repositories || [], select = $('git-repository');
    const selectedId = select.value;
    select.replaceChildren(...repositories.map(row => { const option = el('option', row.name); option.value = row.folderId; return option; }));
    const folderId = api.selectedFolderId?.();
    if (repositories.some(row => row.folderId === folderId)) select.value = folderId; else if (repositories.some(row => row.folderId === selectedId)) select.value = selectedId;
    const repo = repositories.find(row => row.folderId === select.value) || repositories[0];
    $('git-summary').replaceChildren(); $('git-content').replaceChildren();
    $('git-changes-tab').setAttribute('aria-pressed', String(gitView === 'changes')); $('git-commits-tab').setAttribute('aria-pressed', String(gitView === 'commits'));
    if (!repo) { $('git-content').append(el('p', 'Add a workspace folder to view Git activity.', 'inspector-empty')); return; }
    if (!repo.available) { $('git-content').append(el('p', repo.error || 'Git is not available for this folder.', 'inspector-empty')); return; }
    $('git-summary').dataset.clean = String(repo.totalChanges === 0);
    $('git-summary').append(el('span', repo.branch, 'git-branch'), el('span', `${repo.totalChanges} changed`, 'git-change-count'));
    if (repo.githubURL) $('git-summary').append(action('Open on GitHub ↗', () => external(repo.githubURL), 'text-link'));
    if (repo.error) $('git-content').append(el('p', repo.error, 'import-error'));
    if (gitView === 'changes') {
      if (!repo.totalChanges) $('git-content').append(el('div', '✓ Working tree is clean', 'inspector-empty'));
      for (const file of repo.changes) { const status = file.code.includes('D') ? 'deleted' : file.code === '??' ? 'untracked' : file.code.includes('A') ? 'added' : file.code.includes('R') ? 'renamed' : 'modified', row = action('', () => openDiff(repo, file, status), 'git-file'); row.dataset.status = status; row.title = 'Show changes'; row.append(el('span', file.code.trim() || 'M', 'git-file-code'), el('span', file.path, 'git-file-name'), el('span', (file.staged ? 'Staged · ' : '') + ({ added: 'Added', untracked: 'New', deleted: 'Deleted', renamed: 'Renamed', modified: 'Modified' }[row.dataset.status]), 'git-file-status')); $('git-content').append(row); }
      if (repo.changesClipped) $('git-content').append(el('p', 'Showing the first 100 changed files.', 'muted'));
    } else {
      if (!repo.commits.length) $('git-content').append(el('p', 'No commits yet. Your commits will appear here.', 'inspector-empty'));
      for (const commit of repo.commits) {
        const row = el('article', undefined, 'commit-card'); row.append(el('h3', commit.subject), el('p', `${commit.author} · ${date(commit.date)}`));
        row.append(commit.url ? action(commit.shortHash + ' ↗', () => external(commit.url), 'commit-hash') : el('code', commit.shortHash, 'commit-hash')); $('git-content').append(row);
      }
    }
    $('git-updated').textContent = (gitView === 'commits' ? 'Latest 15 local commits · refreshed ' : 'Local Git · refreshed ') + date(gitData.checkedAt);
  }
  async function loadGit() {
    const projectId = api.getState().projectId; if (!projectId || gitBusy) return;
    const request = ++gitRequest; gitBusy = true; gitScope = projectId; $('refresh-git').disabled = true; $('refresh-git').setAttribute('aria-busy', 'true');
    if (!gitData) $('git-content').replaceChildren(el('p', 'Reading local Git activity…', 'inspector-empty'));
    try { const result = await api.api('/api/git', {}, projectId); if (request === gitRequest && api.getState().projectId === projectId) { gitData = result; renderGit(); } }
    catch (error) { if (request === gitRequest) $('git-content').replaceChildren(el('p', error.message, 'inspector-empty')); }
    finally { if (request === gitRequest) { gitBusy = false; $('refresh-git').disabled = false; $('refresh-git').setAttribute('aria-busy', 'false'); } }
  }
  function setGitPanel(open, remember = true) {
    $('git-panel').hidden = !open; $('open-git').setAttribute('aria-expanded', String(open));
    if (remember) try { localStorage.setItem('ai-relay:git-panel', open ? 'open' : 'closed'); } catch { /* Panel state is a convenience. */ }
    if (open) loadGit();
  }
  $('open-git').addEventListener('click', () => setGitPanel($('git-panel').hidden));
  $('close-git').addEventListener('click', () => { setGitPanel(false); $('open-git').focus(); });
  // Docked layouts keep the panel open unless it was closed; narrow layouts overlay it, so it starts closed there.
  function wantsGitPanel() { let preference = null; try { preference = localStorage.getItem('ai-relay:git-panel'); } catch { /* Defaults apply. */ } return preference !== 'closed' && Boolean(window.matchMedia?.('(min-width: 1101px)').matches); }

  const diffDialog = $('diff-dialog'), statusNames = { added: 'Added', untracked: 'New file', deleted: 'Deleted', renamed: 'Renamed', modified: 'Modified' };
  let diffRequest = 0;
  async function openDiff(repo, file, status) {
    const projectId = api.getState().projectId, request = ++diffRequest;
    $('diff-title').textContent = file.path; $('diff-meta').replaceChildren(`${repo.name} · ${statusNames[status]}${file.staged ? ' · staged' : ''}`);
    $('diff-content').replaceChildren(el('p', 'Loading changes…', 'inspector-empty'));
    if (!diffDialog.open) diffDialog.showModal();
    try { const result = await api.api(`/api/git/diff?folderId=${encodeURIComponent(repo.folderId)}&path=${encodeURIComponent(file.path)}`, {}, projectId); if (request === diffRequest) renderDiff(result); }
    catch (error) { if (request === diffRequest) $('diff-content').replaceChildren(el('p', error.message, 'inspector-empty')); }
  }
  function renderDiff(result) {
    const lines = el('div', undefined, 'diff-lines'), maxRows = 5000;
    let oldLine = 0, newLine = 0, added = 0, removed = 0, rows = 0, inHunk = false;
    const row = (kind, before, after, text) => { const line = el('div', undefined, 'diff-line ' + kind); line.append(el('span', String(before), 'diff-number'), el('span', String(after), 'diff-number'), el('span', kind === 'add' ? '+' : kind === 'del' ? '-' : '', 'diff-sign'), el('span', text, 'diff-text')); lines.append(line); rows++; };
    for (const line of result.diff.split('\n')) {
      if (line.startsWith('diff --git')) { inHunk = false; continue; }
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { inHunk = true; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); if (rows < maxRows) row('hunk', '', '', line); continue; }
      if (!inHunk) { if (line.startsWith('Binary files')) row('note', '', '', 'Binary file changed. Its contents are not shown.'); continue; }
      if (line.startsWith('+')) { added++; if (rows < maxRows) row('add', '', newLine, line.slice(1)); newLine++; }
      else if (line.startsWith('-')) { removed++; if (rows < maxRows) row('del', oldLine, '', line.slice(1)); oldLine++; }
      else if (line.startsWith(' ')) { if (rows < maxRows) row('context', oldLine, newLine, line.slice(1)); oldLine++; newLine++; }
      else if (line.startsWith('\\') && rows < maxRows) row('note', '', '', line.slice(2));
    }
    if (added || removed) $('diff-meta').append(el('span', ` +${added}`, 'diff-added'), el('span', ` -${removed}`, 'diff-removed'));
    if (!rows) $('diff-content').replaceChildren(el('p', result.directory ? 'This is a new folder. Add its files to Git to review them individually.' : 'No line changes to show. Only file metadata changed.', 'inspector-empty'));
    else { $('diff-content').replaceChildren(lines); if (result.truncated || rows >= maxRows) $('diff-content').append(el('p', 'This change is large. Only the first part is shown.', 'diff-truncated')); }
  }
  $('close-diff').addEventListener('click', () => diffDialog.close());

  // Plan usage for both agents: status bar meters, plus a composer chip for the selected agent and model.
  const usage = {}, usageLoading = {}, usageAttempted = {}, usageErrors = {};
  let usageProvider = null, usageAnchor = null;
  const usagePopover = $('usage-dialog');
  const usageIsOpen = () => usagePopover.matches(':popover-open');
  const remaining = row => Math.max(0, Math.min(100, Math.round(100 - row.usedPercent)));
  const usageLevel = percent => percent <= 10 ? 'critical' : percent <= 25 ? 'low' : 'ok';
  const shortLabel = label => label === 'Weekly' ? 'wk' : label.replace(/^(\d+)-hour$/, '$1h').replace(/^Weekly · /, '');
  function resetLabel(value) {
    const at = new Date(value || ''); if (Number.isNaN(at.getTime())) return '';
    return 'resets ' + at.toLocaleString(undefined, at.toDateString() === new Date().toDateString() ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  const describeWindow = row => `${row.label}: ${remaining(row)}% left${resetLabel(row.resetsAt) ? ', ' + resetLabel(row.resetsAt) : ''}`;
  function usageWindows(provider) {
    const state = api.getState(), result = usage[provider]; if (!result?.available) return [];
    const model = String((provider === state.provider ? state.model : state.conversation?.models?.[provider]) || '').toLowerCase();
    return result.windows.filter(row => !row.scope || (model && model.includes(row.scope)));
  }
  function renderUsage() {
    const state = api.getState();
    for (const provider of ['codex', 'claude']) {
      const meter = $(`${provider}-usage`), rows = usageWindows(provider);
      meter.closest('.provider-status')?.classList.toggle('selected', state.provider === provider);
      const tightest = rows.reduce((low, row) => !low || remaining(row) < remaining(low) ? row : low, null);
      meter.hidden = !tightest; meter.replaceChildren();
      if (tightest) { meter.dataset.level = usageLevel(remaining(tightest)); meter.append(el('span', shortLabel(tightest.label), 'usage-label'), el('span', `${remaining(tightest)}% left`, 'usage-value')); }
      const summary = rows.length ? `${name(provider)} plan usage. ${rows.map(describeWindow).join('. ')}. Select for usage and reset details.` : '';
      meter.title = summary; meter.setAttribute('aria-label', summary);
    }
    const chip = $('usage-chip'), rows = usageWindows(state.provider), tightest = rows.reduce((low, row) => !low || remaining(row) < remaining(low) ? row : low, null);
    chip.hidden = !tightest;
    if (tightest) { chip.className = 'usage-chip ' + usageLevel(remaining(tightest)); chip.textContent = `${shortLabel(tightest.label)} · ${remaining(tightest)}% left`; chip.title = `${name(state.provider)} plan usage. ${rows.map(describeWindow).join('. ')}.`; }
  }
  async function loadUsage(provider, refresh = false) {
    if (usageLoading[provider] || api.getState().accounts?.[provider]?.authenticated !== true) return;
    usageLoading[provider] = usageAttempted[provider] = true; usageErrors[provider] = null; renderUsageDetails();
    try { usage[provider] = { ...await api.api(`/api/providers/${provider}/usage${refresh ? '?refresh=1' : ''}`, {}, null), fetchedAt: Date.now() }; api.getState().usage = { ...usage }; }
    catch (error) { usageErrors[provider] = error.message; }
    finally { usageLoading[provider] = false; renderUsage(); renderUsageDetails(); }
  }
  for (const provider of ['codex', 'claude']) $(`${provider}-usage`).addEventListener('click', event => openUsage(provider, event.currentTarget || $(`${provider}-usage`)));
  $('usage-chip').addEventListener('click', () => openUsage(api.getState().provider, $('usage-chip')));
  function resetCountdown(value) {
    const at = new Date(value || ''); if (Number.isNaN(at.getTime())) return 'Reset time not reported';
    const minutes = Math.ceil((at.getTime() - Date.now()) / 60000);
    if (minutes <= 0) return 'Reset time passed · refresh for the current allowance';
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
    return 'Resets in ' + [days ? days + 'd' : '', hours ? hours + 'h' : '', mins ? mins + 'm' : ''].filter(Boolean).join(' ');
  }
  // The card shows only the agent whose meter or chip opened it.
  function renderUsageDetails() {
    if (!usageProvider || !usageIsOpen()) return;
    const state = api.getState(), provider = usageProvider, account = state.accounts?.[provider], result = usage[provider], plan = result?.plan || account?.planType || account?.subscriptionType;
    $('usage-title').textContent = 'Plan usage'; $('usage-plan').textContent = `From your own ${name(provider)} account`;
    const section = el('section', undefined, 'usage-provider'), heading = el('div', undefined, 'usage-provider-heading'), icon = el('i', undefined, 'agent-icon ' + provider);
    section.dataset.provider = provider; icon.setAttribute('aria-hidden', 'true');
    heading.append(icon, el('h3', name(provider))); if (plan) heading.append(el('span', String(plan).replace(/[_-]/g, ' '), 'usage-plan-badge'));
    section.append(heading);
    const rows = (result?.windows || []).filter(row => Number.isFinite(row.usedPercent));
    for (const row of rows) {
      const left = remaining(row), item = el('div', undefined, 'usage-window-row'), top = el('div', undefined, 'usage-window-top'), track = el('div', undefined, 'usage-track'), fill = el('i'), bottom = el('div', undefined, 'usage-window-bottom');
      item.dataset.level = usageLevel(left); fill.style.width = left + '%'; track.append(fill); track.setAttribute('role', 'img'); track.setAttribute('aria-label', `${left}% of the ${row.label} allowance left`);
      top.append(el('span', row.label, 'usage-window-label'), el('strong', `${left}% left`)); bottom.append(el('span', resetCountdown(row.resetsAt)));
      const at = new Date(row.resetsAt || '');
      if (!Number.isNaN(at.getTime())) { const time = el('time', at.toLocaleString(undefined, at.toDateString() === new Date().toDateString() ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })); time.setAttribute('datetime', at.toISOString()); time.title = at.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }); bottom.append(time); }
      item.append(top, track, bottom); section.append(item);
    }
    if (!rows.length) section.append(el('p', usageLoading[provider] ? 'Reading the current allowance…' : account?.authenticated === false ? 'Not signed in' : result?.reason || 'Not reported for this account.', 'usage-empty'));
    if (usageErrors[provider]) section.append(el('p', 'Could not refresh. ' + usageErrors[provider] + (result?.fetchedAt ? ' The last successful reading is shown.' : ''), 'usage-error'));
    $('usage-details').replaceChildren(section);
    const checked = result?.fetchedAt || 0, busy = Boolean(usageLoading[provider]);
    $('usage-updated').textContent = checked ? 'Checked ' + new Date(checked).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' · reset times in your time zone' : 'Reported by each provider';
    $('refresh-usage').disabled = busy; $('refresh-usage').textContent = busy ? 'Refreshing…' : 'Refresh';
    positionUsage();
  }
  function positionUsage() {
    if (!usageIsOpen() || !usageAnchor) return;
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight, gap = 10, edge = 12;
    const width = Math.min(340, viewportWidth - edge * 2);
    usagePopover.style.width = width + 'px'; usagePopover.style.maxHeight = (viewportHeight - edge * 2) + 'px';
    const anchor = usageAnchor.getBoundingClientRect(), height = usagePopover.getBoundingClientRect().height;
    const above = anchor.top - gap - height, below = anchor.bottom + gap;
    const top = above >= edge ? above : below + height <= viewportHeight - edge ? below : Math.max(edge, viewportHeight - edge - height);
    usagePopover.style.left = Math.max(edge, Math.min(anchor.left, viewportWidth - width - edge)) + 'px';
    usagePopover.style.top = top + 'px';
  }
  function closeUsage(restoreFocus = false) {
    if (usageIsOpen()) usagePopover.hidePopover();
    usageAnchor?.setAttribute('aria-expanded','false');
    if (restoreFocus) usageAnchor?.focus();
  }
  function openUsage(provider, anchor) {
    const nextAnchor = anchor || (!$(`${provider}-usage`).hidden ? $(`${provider}-usage`) : $('relay-settings'));
    if (usageIsOpen() && provider === usageProvider && nextAnchor === usageAnchor) { closeUsage(); return; }
    usageAnchor?.setAttribute('aria-expanded','false'); usageProvider = provider; usageAnchor = nextAnchor;
    usageAnchor.setAttribute('aria-expanded','true');
    if (!usageIsOpen()) usagePopover.showPopover();
    renderUsageDetails(); positionUsage(); loadUsage(provider,true);
  }
  window.relayUsage = { open: openUsage };
  for (const trigger of [$('codex-usage'), $('claude-usage'), $('usage-chip')]) { trigger.setAttribute('aria-controls','usage-dialog'); trigger.setAttribute('aria-haspopup','dialog'); trigger.setAttribute('aria-expanded','false'); }
  usagePopover.addEventListener('toggle',() => { if (!usageIsOpen()) usageAnchor?.setAttribute('aria-expanded','false'); });
  $('close-usage').addEventListener('click',()=>closeUsage(true));
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && usageIsOpen()){event.preventDefault();closeUsage(true);}});
  document.addEventListener('scroll',positionUsage,true); window.addEventListener('resize',positionUsage);
  $('refresh-usage').addEventListener('click',()=>{ if (usageProvider) loadUsage(usageProvider,true); });
  setInterval(renderUsageDetails,60000);
  $('refresh-git').addEventListener('click', loadGit); $('git-repository').addEventListener('change', () => { api.selectFolder?.($('git-repository').value); renderGit(); });
  $('git-changes-tab').addEventListener('click', () => { gitView = 'changes'; renderGit(); }); $('git-commits-tab').addEventListener('click', () => { gitView = 'commits'; renderGit(); });

  // Import: list Claude Code and Codex chats from this workspace or any project, review them merged by time, then add them
  // to an existing workspace or a new one made from their folders. Reading and importing never runs an assistant.
  const dialog = $('import-dialog');
  const imports = { filter: 'all', scope: 'all', sessions: [], cursors: {}, selected: new Map(), files: new Map(), loading: false, busy: false, request: 0, nameEdited: false };
  const sessionKey = session => `${session.provider}:${session.id}`;
  const sourceName = provider => provider === 'claude' ? 'Claude Code' : provider === 'file' ? 'Conversation file' : 'Codex';
  const isFile = entry => entry.session.provider === 'file';
  const baseName = folder => String(folder || '').split(/[\\/]/).filter(Boolean).pop() || folder;
  const homePath = folder => String(folder || '').replace(/^\/(?:Users|home)\/[^/]+/, '~');
  const agentIcon = provider => { const icon = el('i', undefined, 'agent-icon ' + provider); icon.setAttribute('aria-hidden', 'true'); return icon; };
  function importError(message = '') { $('import-error').textContent = message; $('import-error').hidden = !message; }
  function mergedMessages(previews) {
    // Same ordering as the server: original time, keeping untimed messages after their predecessor.
    return previews.flatMap((preview, source) => { let time = 0; return preview.messages.map((message, index) => { const at = Date.parse(message.timestamp); if (Number.isFinite(at)) time = at; return { preview, message, time, source, index }; }); }).sort((a, b) => a.time - b.time || a.source - b.source || a.index - b.index);
  }
  function selectedFolders() { return [...new Set([...imports.selected.values()].map(entry => entry.preview?.cwd || entry.session.cwd).filter(Boolean))]; }
  function renderSessions() {
    const query = $('import-search').value.trim().toLowerCase(), list = $('import-list'), groups = new Map();
    const rows = imports.sessions.filter(row => (imports.filter === 'all' || row.provider === imports.filter) && (!query || `${row.title} ${row.folder} ${row.cwd || ''}`.toLowerCase().includes(query))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const row of rows) { const key = row.cwd || row.folder; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
    list.replaceChildren();
    for (const sessions of groups.values()) {
      const group = el('section', undefined, 'import-group'), heading = el('div', undefined, 'import-group-heading'), folder = sessions[0].cwd;
      heading.append(el('span', sessions[0].folder, 'import-group-name')); if (folder) { const where = el('span', homePath(folder), 'import-group-path'); where.title = folder; heading.append(where); }
      group.append(heading);
      for (const session of sessions) {
        const selected = imports.selected.has(sessionKey(session)), button = action('', () => toggleSession(session), 'import-session' + (selected ? ' selected' : ''));
        button.setAttribute('aria-pressed', String(selected)); button.disabled = imports.busy;
        const text = el('span', undefined, 'import-session-text'); text.append(el('strong', session.title), el('span', `${sourceName(session.provider)} · ${date(session.updatedAt)}`));
        button.append(el('span', undefined, 'import-check'), agentIcon(session.provider), text); group.append(button);
      }
      list.append(group);
    }
    if (!list.children.length) list.append(el('p', imports.loading ? 'Finding conversations…' : query ? 'No matching conversations.' : imports.scope === 'workspace' ? 'No Claude Code or Codex chats were found for this workspace’s folders. Try All projects.' : 'No Claude Code or Codex chats were found on this computer.', 'inspector-empty'));
    $('import-more').hidden = !Object.values(imports.cursors).some(Boolean);
  }
  function renderPreview() {
    const entries = [...imports.selected.values()], pane = $('import-preview');
    if (!entries.length) { const empty = el('div', undefined, 'import-placeholder'); empty.append(el('h3', 'Choose conversations'), el('p', 'Select one or more chats to review them here. Chats from Claude Code and Codex merge in the order they happened.')); pane.replaceChildren(empty); return; }
    const ready = entries.filter(entry => entry.preview).map(entry => entry.preview), heading = el('div', undefined, 'import-preview-heading'), sources = el('ul', undefined, 'import-sources');
    heading.append(el('h3', entries.length === 1 ? entries[0].preview?.title || entries[0].session.title : `${entries.length} conversations, merged by time`), el('p', `${ready.reduce((sum, preview) => sum + preview.messageCount, 0)} text message${ready.reduce((sum, preview) => sum + preview.messageCount, 0) === 1 ? '' : 's'}${ready.length < entries.length ? ' · loading…' : ''}`));
    for (const entry of entries) { const item = el('li'); item.append(agentIcon(entry.session.provider), el('span', entry.preview?.title || entry.session.title, 'import-source-title'), el('span', entry.error || (entry.preview ? `${entry.preview.messageCount} message${entry.preview.messageCount === 1 ? '' : 's'}${entry.preview.clipped ? ', most recent only' : ''}` : 'Loading…'), entry.error ? 'import-source-error' : 'import-source-meta')); sources.append(item); }
    heading.append(sources, el('p', 'Only the visible text of each chat is imported. Tool runs and private reasoning stay out, and nothing runs until you send a message with your own Claude or Codex account.', 'muted'));
    if (entries.some(isFile)) heading.append(el('p', 'Conversation files come from other people. Their messages become context for your assistant, so import files only from people you trust.', 'import-trust-note'));
    pane.replaceChildren(heading);
    const merged = mergedMessages(ready), shown = merged.slice(-300);
    if (merged.length > shown.length) pane.append(el('p', `Showing the latest ${shown.length} of ${merged.length} messages. All of them will be imported.`, 'import-preview-note'));
    for (const { preview, message } of shown) {
      const row = el('article', undefined, 'import-message'), who = el('div', undefined, 'import-message-heading'), text = message.text.length > 1500 ? message.text.slice(0, 1500) + '…' : message.text;
      const agent = preview.provider === 'file' ? message.provider : preview.provider;
      who.append(agentIcon(message.role === 'user' ? 'user' : agent), el('strong', message.role === 'user' ? (preview.provider === 'file' ? 'User' : 'You') : message.role === 'activity' ? 'Tool activity' : name(agent)), el('span', `${message.timestamp ? date(message.timestamp) : ''}${ready.length > 1 ? ` · ${preview.title}` : ''}`));
      row.append(who, el('p', text)); pane.append(row);
    }
  }
  // Shared files carry no local paths, so a new workspace from files alone needs the recipient's own folder.
  function needsLocalFolder() { const entries = [...imports.selected.values()]; return !$('import-target').value && entries.length > 0 && !selectedFolders().length; }
  function renderDestination() {
    const state = api.getState(), project = state.projects.find(entry => entry.id === $('import-target').value), folders = selectedFolders(), shared = [...imports.selected.values()].filter(isFile);
    $('import-name').hidden = Boolean(project); $('import-folder-field').hidden = !needsLocalFolder();
    if (!project && !imports.nameEdited) $('import-name').value = folders.length ? baseName(folders[0]) : shared[0]?.preview?.title || '';
    const adding = project ? folders.filter(folder => !(project.folders || []).some(entry => folder === entry.path || folder.startsWith(entry.path + '/'))) : folders;
    const sharedFolders = [...new Set(shared.flatMap(entry => entry.preview?.folders || []))];
    $('import-folders').textContent = needsLocalFolder() ? `Choose your copy of the project${sharedFolders.length ? ` (the sender used ${sharedFolders.join(', ')})` : ''}.` : !folders.length ? (project && shared.length ? `Adds the shared messages to ${project.name}.` : '') : !project ? `Creates a workspace with ${folders.map(baseName).join(', ')}.` : adding.length ? `Also adds ${adding.map(baseName).join(', ')} to ${project.name}.` : `Uses ${project.name}’s existing folders.`;
  }
  function importControls() {
    const entries = [...imports.selected.values()], ready = entries.length > 0 && entries.every(entry => entry.preview), newWorkspace = !$('import-target').value;
    $('confirm-import').disabled = !ready || imports.busy || !$('import-confirm').checked || (newWorkspace && !$('import-name').value.trim()) || (needsLocalFolder() && !$('import-folder-path').value.trim());
    $('confirm-import').textContent = imports.busy ? 'Importing…' : entries.length > 1 ? `Import ${entries.length} conversations` : 'Import conversation';
    $('import-confirm').disabled = !ready || imports.busy;
    $('import-confirm-text').textContent = !entries.length ? 'Select conversations to import.' : `I reviewed ${entries.length === 1 ? 'this conversation' : `these ${entries.length} conversations`}. Add the messages without running an assistant.`;
    $('refresh-imports').disabled = imports.busy; $('refresh-imports').setAttribute('aria-busy', String(imports.loading)); $('import-more').disabled = imports.busy || imports.loading;
    $('import-scope').hidden = !api.getState().projectId;
    for (const button of document.querySelectorAll('[data-import-provider]')) button.setAttribute('aria-pressed', String(button.dataset.importProvider === imports.filter));
    for (const button of document.querySelectorAll('[data-import-scope]')) button.setAttribute('aria-pressed', String(button.dataset.importScope === imports.scope));
  }
  function selectionChanged() { $('import-confirm').checked = false; renderSessions(); renderPreview(); renderDestination(); importControls(); }
  async function toggleSession(session) {
    const key = sessionKey(session);
    if (imports.busy) return;
    if (imports.selected.has(key)) { imports.selected.delete(key); selectionChanged(); return; }
    if (imports.selected.size >= 20) { importError('Select at most 20 conversations at a time.'); return; }
    if (imports.files.has(key)) { imports.selected.set(key, imports.files.get(key)); selectionChanged(); return; }
    const entry = { session, preview: null, error: null }; imports.selected.set(key, entry); importError(''); selectionChanged();
    try { entry.preview = await api.post('/api/import-sources/preview', { provider: session.provider, sessionId: session.id }, null); }
    catch (error) { entry.error = error.message; }
    if (imports.selected.get(key) === entry) selectionChanged();
  }
  async function loadSessions(more = false) {
    const request = ++imports.request, state = api.getState(), scope = imports.scope === 'workspace' && state.projectId ? 'workspace' : 'all', errors = [];
    if (!more) { imports.sessions = imports.sessions.filter(row => row.provider === 'file'); imports.cursors = {}; }
    imports.loading = true; importError(''); renderSessions(); importControls();
    await Promise.all(['claude', 'codex'].map(async provider => {
      if (more && !imports.cursors[provider]) return;
      const query = `provider=${provider}&scope=${scope}${scope === 'workspace' ? `&projectId=${encodeURIComponent(state.projectId)}` : ''}${more ? `&cursor=${encodeURIComponent(imports.cursors[provider])}` : ''}`;
      try {
        const result = await api.api(`/api/import-sources?${query}`, {}, null); if (request !== imports.request) return;
        imports.sessions.push(...result.sessions.filter(row => !imports.sessions.some(item => sessionKey(item) === sessionKey(row)))); imports.cursors[provider] = result.nextCursor || null;
      } catch (error) { errors.push(`${sourceName(provider)}: ${error.message}`); imports.cursors[provider] = null; }
    }));
    if (request !== imports.request) return;
    imports.loading = false; importError(errors.join(' ')); renderSessions(); importControls();
  }
  function openImport({ newWorkspace = false } = {}) {
    const state = api.getState(), target = newWorkspace || !state.projectId ? '' : state.projectId;
    imports.scope = target ? 'workspace' : 'all'; imports.filter = 'all'; imports.selected.clear(); imports.files.clear(); imports.sessions = []; imports.nameEdited = false;
    $('import-search').value = ''; $('import-confirm').checked = false; $('import-result').textContent = ''; $('import-name').value = ''; $('import-folder-path').value = '';
    const select = $('import-target'), created = el('option', 'New workspace'); created.value = '';
    select.replaceChildren(...state.projects.map(project => { const option = el('option', project.name); option.value = project.id; return option; }), created); select.value = target;
    if (!dialog.open) dialog.showModal();
    renderPreview(); renderDestination(); loadSessions();
  }
  $('open-import').addEventListener('click', () => openImport());
  $('import-first').addEventListener('click', () => openImport({ newWorkspace: true }));
  $('import-from-panel').addEventListener('click', () => { $('close-project').click(); openImport({ newWorkspace: true }); });
  $('close-import').addEventListener('click', () => { if (!imports.busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (imports.busy) event.preventDefault(); });
  for (const button of document.querySelectorAll('[data-import-provider]')) button.addEventListener('click', () => { imports.filter = button.dataset.importProvider; renderSessions(); importControls(); });
  for (const button of document.querySelectorAll('[data-import-scope]')) button.addEventListener('click', () => { if (imports.scope !== button.dataset.importScope) { imports.scope = button.dataset.importScope; loadSessions(); } });
  $('refresh-imports').addEventListener('click', () => loadSessions()); $('import-more').addEventListener('click', () => loadSessions(true)); $('import-search').addEventListener('input', renderSessions);
  $('import-target').addEventListener('change', () => { renderDestination(); importControls(); });
  $('import-name').addEventListener('input', () => { imports.nameEdited = true; importControls(); });
  $('import-confirm').addEventListener('change', importControls);
  $('import-folder-path').addEventListener('input', importControls);
  if (window.relayDesktop) { $('import-folder-pick').hidden = false; $('import-folder-pick').addEventListener('click', async () => { try { const picked = await window.relayDesktop.pickFolder(); if (picked) { $('import-folder-path').value = Array.isArray(picked) ? picked[0] || '' : picked; importControls(); } } catch (error) { importError(error.message); } }); }
  $('import-file-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files?.[0]; $('import-file').value = ''; if (!file) return;
    importError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('This conversation file is larger than 2 MB.');
      let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('This file is not an Throughline conversation file.'); }
      const preview = await api.post('/api/import-sources/file-preview', { package: data }, null);
      const session = { id: preview.sessionId, provider: 'file', title: preview.title, folder: 'Conversation files', cwd: null, updatedAt: preview.exportedAt || new Date().toISOString() }, key = sessionKey(session);
      if (!imports.selected.has(key) && imports.selected.size >= 20) throw new Error('Select at most 20 conversations at a time.');
      const entry = { session, preview, package: data, error: null }; imports.files.set(key, entry); imports.selected.set(key, entry);
      if (!imports.sessions.some(row => sessionKey(row) === key)) imports.sessions.push(session);
      selectionChanged();
    } catch (error) { importError(error.message); }
  });
  $('confirm-import').addEventListener('click', async () => {
    if ($('confirm-import').disabled) return;
    const entries = [...imports.selected.values()], target = $('import-target').value;
    imports.busy = true; importError(''); renderSessions(); importControls();
    try {
      const result = await api.post('/api/import-sources/import', { sessions: entries.filter(entry => !isFile(entry)).map(({ preview }) => ({ provider: preview.provider, sessionId: preview.sessionId, approvedDigest: preview.digest })), files: entries.filter(isFile).map(entry => ({ package: entry.package, approvedDigest: entry.preview.digest })), ...(target ? { projectId: target } : { name: $('import-name').value.trim(), ...(needsLocalFolder() ? { folders: [$('import-folder-path').value.trim()] } : {}) }) }, null);
      const missing = result.missingFolders?.length ? ` ${result.missingFolders.map(baseName).join(', ')} ${result.missingFolders.length === 1 ? 'no longer exists on this computer, so it was' : 'no longer exist on this computer, so they were'} not added as a folder.` : '';
      $('import-result').textContent = (result.duplicate ? `These conversations are already in ${result.projectName}.` : `Imported ${result.imported} messages${result.updated ? ` and updated ${result.updated}` : ''} into ${result.projectName}.`) + missing;
      await api.refreshProjects(); await api.selectProject(result.projectId); await api.refresh();
      imports.selected.clear();
      if (missing) api.showNotice($('import-result').textContent); else dialog.close();
    } catch (error) { importError(error.message); }
    finally { imports.busy = false; renderSessions(); importControls(); }
  });

  // Export: a portable conversation file (and a readable Markdown copy) for another Throughline user.
  const exportDialog = $('export-dialog');
  let exported = null, exportRequest = 0;
  const fileSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const count = (value, noun) => `${value} message${value === 1 ? '' : 's'} with ${noun}`;
  function exportControls() { const empty = !exported?.stats.messages; $('export-download').disabled = empty; $('export-markdown').disabled = empty; }
  function renderExportSummary() {
    const { stats, findings, redacted } = exported, facts = el('dl', undefined, 'export-facts');
    for (const [label, value] of [['Messages', `${stats.messages}${stats.omitted ? ` (the oldest ${stats.omitted} are left out to stay under 2 MB)` : ''}`], ['Assistants', stats.providers.map(name).join(' and ') || 'None'], ['Period', stats.from && stats.to ? `${date(stats.from)} – ${date(stats.to)}` : 'Not recorded'], ['File size', fileSize(stats.bytes)]]) facts.append(el('dt', label), el('dd', value));
    const sensitive = [findings.secrets && count(findings.secrets, 'possible secrets'), findings.localPaths && count(findings.localPaths, 'local paths')].filter(Boolean);
    $('export-summary').replaceChildren(facts, el('p', !sensitive.length ? 'No secrets or local paths found.' : redacted ? `Cleaned ${sensitive.join(' and ')}.` : `Contains ${sensitive.join(' and ')}. Review before sharing, or turn on removal.`, !sensitive.length || redacted ? 'export-safe' : 'export-warning'));
  }
  async function prepareExport() {
    // The previous summary stays (dimmed) while options change, so the dialog never resizes or jumps.
    const request = ++exportRequest; $('export-error').hidden = true; $('export-download').disabled = true; $('export-markdown').disabled = true;
    if (exported) $('export-summary').setAttribute('aria-busy', 'true'); else $('export-summary').replaceChildren(el('p', 'Preparing export…', 'muted'));
    try {
      const result = await api.api(`/api/conversation/export?range=${encodeURIComponent($('export-range').value)}&redact=${$('export-redact').checked ? 1 : 0}&activity=${$('export-activity').checked ? 1 : 0}`, {}, api.getState().projectId);
      if (request === exportRequest) { exported = result; renderExportSummary(); }
    } catch (error) { if (request === exportRequest) { exported = null; $('export-summary').replaceChildren(); $('export-error').textContent = error.message; $('export-error').hidden = false; } }
    finally { if (request === exportRequest) { $('export-summary').removeAttribute('aria-busy'); exportControls(); } }
  }
  function saveFile(fileName, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
    link.href = url; link.download = fileName; document.body?.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportName() { const state = api.getState(), title = state.projects.find(project => project.id === state.projectId)?.name || 'conversation'; return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation'}-${new Date().toISOString().slice(0, 10)}`; }
  function markdown(file) {
    const context = file.context || {}, lines = [`# ${file.workspace?.name || 'Conversation'}`, '', `Exported from Throughline on ${date(file.exportedAt)}.`, ''];
    if (context.goal) lines.push(`**Goal:** ${context.goal}`, '');
    if (context.summary) lines.push('**Summary**', '', context.summary, '');
    for (const [title, items] of [['Decisions', context.decisions], ['Unfinished tasks', context.tasks]]) if (items?.length) lines.push(`**${title}**`, '', ...items.map(item => `- ${item}`), '');
    for (const message of file.messages) lines.push('---', '', `**${message.role === 'user' ? 'User' : message.role === 'activity' ? 'Tool activity' : name(message.provider)}**${message.createdAt ? ` · ${date(message.createdAt)}` : ''}`, '', message.role === 'activity' ? '```\n' + message.text + '\n```' : message.text, '');
    return lines.join('\n');
  }
  // Every export starts from the safe defaults: whole conversation, secrets and local paths removed, no tool output.
  $('open-export').addEventListener('click', () => { exported = null; $('export-range').value = 'all'; $('export-redact').checked = true; $('export-activity').checked = false; if (!exportDialog.open) exportDialog.showModal(); prepareExport(); });
  $('close-export').addEventListener('click', () => exportDialog.close());
  for (const id of ['export-range', 'export-redact', 'export-activity']) $(id).addEventListener('change', prepareExport);
  $('export-download').addEventListener('click', () => { saveFile(`${exportName()}.throughline.json`, JSON.stringify(exported.package, null, 2), 'application/json'); api.announce?.('Conversation file saved.'); });
  $('export-markdown').addEventListener('click', () => saveFile(`${exportName()}.md`, markdown(exported.package), 'text/markdown'));
  $('export-ask-friend').addEventListener('click', () => { exportDialog.close(); $('ask-friend').click(); });

  let runningProject = null, lastFolder = null;
  function render() {
    if (lastFolder !== api.selectedFolderId?.()) { lastFolder = api.selectedFolderId?.(); if (gitData) renderGit(); }
    const state = api.getState(); modelControls(); progress();
    for (const provider of ['codex', 'claude']) if (state.accounts?.[provider]?.authenticated === true && !usageAttempted[provider]) loadUsage(provider);
    // A finished run changes files and consumes usage.
    const running = state.conversation?.status === 'running' ? state.projectId : null;
    if (runningProject && runningProject === state.projectId && !running) { if (!$('git-panel').hidden) loadGit(); for (const provider of ['codex', 'claude']) loadUsage(provider, true); }
    runningProject = running;
    renderUsage();
    if (state.ready && state.status?.providers?.[state.provider]?.available && state.accounts?.[state.provider]?.authenticated === true && !catalog[state.provider] && !attemptedModels[state.provider] && !loadingModels[state.provider]) loadModels();
    $('open-git').disabled = !state.projectId; $('open-import').disabled = Boolean(state.pending || state.projectSaving); $('open-export').disabled = !state.projectId || !state.conversation?.messages?.length;
    if (lastProject !== state.projectId) {
      lastProject = state.projectId; $('custom-model-editor').hidden = true; gitData = null; gitRequest++; gitBusy = false; $('git-repository').replaceChildren(); $('git-summary').replaceChildren(); $('git-updated').textContent = '';
      // There is nothing to inspect without a workspace.
      if (!state.projectId) { $('git-panel').hidden = true; $('open-git').setAttribute('aria-expanded', 'false'); }
      else if (!$('git-panel').hidden) loadGit();
      else if (wantsGitPanel()) setGitPanel(true, false);
      if (diffDialog.open) { diffRequest++; diffDialog.close(); }
      if (exportDialog.open) { exportRequest++; exportDialog.close(); }
    }
  }
  window.addEventListener('relay-state', render);
  window.addEventListener('relay-account', event => { const provider = event.detail?.provider || api.getState().provider; delete catalog[provider]; delete attemptedModels[provider]; modelSignature = ''; modelControls(); });
  setInterval(() => { if (!document.hidden) progress(); }, 1000);
  setInterval(() => { if (!document.hidden && !$('git-panel').hidden && !gitBusy && gitScope === api.getState().projectId) loadGit(); }, 15000);
  setInterval(() => { if (!document.hidden) for (const provider of ['codex', 'claude']) if (Date.now() - (usage[provider]?.fetchedAt || 0) > 300000) loadUsage(provider); }, 60000);
  render();
})();
