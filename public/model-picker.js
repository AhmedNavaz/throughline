(() => {
  'use strict';
  const $ = id => document.getElementById(id), api = window.relayUI, popup = $('model-picker-popover'), trigger = $('model-picker-button');
  const names = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini', local: 'Local · Ollama' }, cache = new Map();
  let provider = 'codex', scope = null, revision = 0, loading = false, saving = false, result = null, failure = '';
  const node = (tag, text, cls) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (cls) value.className = cls; return value; };
  const button = (text, fn, cls) => { const value = node('button', text, cls); value.type = 'button'; value.addEventListener('click', fn); return value; };
  const open = () => popup.matches(':popover-open');
  function position() {
    if (!open()) return;
    const anchor = trigger.getBoundingClientRect(), width = Math.min(520, window.innerWidth - 24);
    popup.style.width = width + 'px'; popup.style.left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)) + 'px';
    popup.style.bottom = Math.max(12, window.innerHeight - anchor.top + 8) + 'px';
    popup.style.maxHeight = Math.max(180, anchor.top - 24) + 'px';
  }
  function close() { ++revision; loading = false; if (open()) popup.hidePopover(); trigger.setAttribute('aria-expanded', 'false'); }
  function label() {
    const state = api.getState(), local = state.localSelections?.[state.projectId], actual = local ? 'local' : state.provider;
    $('picked-agent').textContent = names[actual]; $('picked-model').textContent = local?.model || state.model || 'Provider default';
    $('picked-agent-icon').className = 'agent-icon ' + (actual === 'local' ? 'codex' : actual);
    trigger.disabled = !state.ready || !state.projectId || Boolean(state.pending || state.settingsPending || api.isRunning());
    trigger.setAttribute('aria-label', `Choose agent and model. Current: ${names[actual]}, ${local?.model || state.model || 'provider default'}`);
    if (local) { $('model-description').textContent = `Local · ${local.model} · Downloaded model · No cloud model charges`; $('effort-select').disabled = true; }
    if (open() && scope !== state.projectId) close();
  }
  function render() {
    const state = api.getState(), choices = $('picker-agents'); choices.replaceChildren();
    for (const value of Object.keys(names)) {
      const choice = button('', () => { provider = value; $('picker-search').value = ''; $('picker-custom').hidden = true; load(); }, 'agent-choice');
      choice.disabled = saving; choice.setAttribute('aria-pressed', String(provider === value));
      const icon = node('i', undefined, 'agent-icon ' + (value === 'local' ? 'codex' : value)); icon.setAttribute('aria-hidden', 'true');
      choice.append(icon, node('span', names[value])); choices.append(choice);
    }
    const host = $('picker-models'); host.replaceChildren();
    $('picker-title').textContent = names[provider];
    $('picker-note').textContent = provider === 'local' ? 'Downloaded models on this computer. Uses Codex for workspace tools.' : 'Uses your own account. Select a model for the next prompt.';
    $('picker-refresh').disabled = loading || saving; $('picker-custom-button').hidden = provider === 'local';
    $('picker-status').textContent = failure || (loading ? 'Loading available models…' : result?.message || '');
    if (loading || failure) return;
    const installed = provider === 'local' ? result?.installed : state.status?.providers?.[provider]?.available;
    if (!installed) {
      host.append(node('p', provider === 'local' ? 'Install Codex CLI to use local workspace tools.' : state.accounts?.[provider]?.message || `Install and configure ${names[provider]} to use this connection.`, 'picker-empty'));
      host.append(button('Open connection settings', () => { close(); $('relay-settings').click(); }, 'text-link')); return;
    }
    const rows = provider === 'local' ? result?.models || [] : [{ id: '', displayName: 'Provider default', description: 'Use the default configured by the installed agent.' }, ...(result?.models || []).filter(row => row.value !== 'default')];
    const query = $('picker-search').value.trim().toLowerCase(); let count = 0;
    for (const row of rows) {
      const id = row.id || row.model || row.value || '', title = row.displayName || row.name || id, description = provider === 'local' ? [row.parameterSize, 'Downloaded', 'Local inference'].filter(Boolean).join(' · ') : row.description || id || 'Native default';
      if (query && !(title + ' ' + id).toLowerCase().includes(query)) continue;
      const local = state.localSelections?.[scope], selected = provider === 'local' ? local?.model === id && local.digest === row.digest : !local && state.provider === provider && (state.model || '') === id;
      const choice = button('', () => choose(row), 'model-choice'); choice.disabled = saving; choice.setAttribute('aria-pressed', String(selected));
      const text = node('span'); text.append(node('strong', title), node('small', description)); choice.append(text, node('span', selected ? '✓' : '', 'model-choice-check')); host.append(choice); count++;
    }
    if (!count) host.append(node('p', query ? 'No matching models.' : provider === 'local' ? 'No compatible downloaded models. Start Ollama, download a model with tool support, then refresh.' : 'No models reported. Use the native default or enter an available model ID.', 'picker-empty'));
  }
  async function load(force = false) {
    const token = ++revision, projectId = scope, selectedProvider = provider, key = projectId + ':' + selectedProvider;
    result = cache.get(key) || null; failure = '';
    if (result && !force) { loading = false; render(); return; }
    if (selectedProvider !== 'local' && !api.getState().status?.providers?.[selectedProvider]?.available) { result = null; loading = false; render(); return; }
    loading = true; render();
    try {
      const data = await api.api(selectedProvider === 'local' ? '/api/local-models' : `/api/providers/${selectedProvider}/models`, {}, projectId);
      cache.set(key, data);
      if (token !== revision || projectId !== api.getState().projectId) return;
      result = data;
    } catch (error) { if (token === revision) failure = error.message; }
    finally { if (token === revision) { loading = false; render(); } }
  }
  async function choose(row) {
    if (saving || scope !== api.getState().projectId) return;
    const token = revision, projectId = scope, selectedProvider = provider;
    saving = true; failure = ''; render();
    try {
      if (selectedProvider === 'local') api.selectLocalModel({ model: row.id, digest: row.digest });
      else await api.selectAgentModel(selectedProvider, row.id || row.model || row.value || null);
      if (token === revision && projectId === api.getState().projectId) { close(); $('message-input').focus(); }
    } catch (error) { if (token === revision) failure = error.message; }
    finally { saving = false; label(); if (open()) render(); }
  }
  trigger.addEventListener('click', () => {
    if (open()) { close(); return; }
    const state = api.getState(); scope = state.projectId; provider = state.localSelections?.[scope] ? 'local' : state.provider;
    $('picker-search').value = ''; $('picker-custom').hidden = true; popup.showPopover(); trigger.setAttribute('aria-expanded', 'true'); position(); load(); $('picker-search').focus();
  });
  $('picker-search').addEventListener('input', render); $('picker-refresh').addEventListener('click', () => load(true));
  $('picker-custom-button').addEventListener('click', () => { $('picker-custom').hidden = !$('picker-custom').hidden; if (!$('picker-custom').hidden) $('picker-custom-id').focus(); });
  $('picker-custom-save').addEventListener('click', () => { const id = $('picker-custom-id').value.trim(); if (id && id.length <= 200) choose({ id }); });
  popup.addEventListener('toggle', () => { trigger.setAttribute('aria-expanded', String(open())); if (!open()) ++revision; });
  window.addEventListener('resize', position); window.addEventListener('relay-state', label); label();
  document.documentElement.classList.add('rich-model-picker');
  window.relayModelPicker = { open: () => trigger.click(), close };
})();
