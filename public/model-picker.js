(() => {
  'use strict';
  const $ = id => document.getElementById(id), api = window.relayUI, popup = $('model-picker-popover'), trigger = $('model-picker-button');
  const names = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini', local: 'Local · Ollama' }, cache = new Map();
  let provider = 'codex', scope = null, revision = 0, loading = false, saving = false, result = null, failure = '';
  let preloadedProject = null;

  const node = (tag, text, cls) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (cls) value.className = cls; return value; };
  const button = (text, fn, cls) => { const value = node('button', text, cls); value.type = 'button'; value.addEventListener('click', fn); return value; };
  const open = () => popup?.matches?.(':popover-open');

  function position() {
    if (!open()) return;
    const anchor = trigger.getBoundingClientRect(), width = Math.min(360, window.innerWidth - 24);
    popup.style.width = width + 'px';
    popup.style.left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)) + 'px';
    popup.style.bottom = Math.max(12, window.innerHeight - anchor.top + 8) + 'px';
    popup.style.maxHeight = Math.max(200, anchor.top - 24) + 'px';
  }

  function close() { ++revision; loading = false; if (open()) popup.hidePopover(); trigger.setAttribute('aria-expanded', 'false'); }

  function label() {
    const state = api.getState(), local = state.localSelections?.[state.projectId], actual = local ? 'local' : state.provider;
    $('picked-agent').textContent = names[actual];
    $('picked-model').textContent = local?.model || state.model || 'Provider default';
    $('picked-agent-icon').className = 'agent-icon ' + (actual === 'local' ? 'codex' : actual);
    trigger.disabled = !state.ready || !state.projectId || Boolean(state.pending || state.settingsPending || api.isRunning());
    trigger.setAttribute('aria-label', `Choose agent and model. Current: ${names[actual]}, ${local?.model || state.model || 'provider default'}`);
    if (local) {
      $('model-description').textContent = `Local · ${local.model} · Downloaded model · No cloud model charges`;
      $('effort-select').disabled = true;
    }
    if (open() && scope !== state.projectId) close();
    if (state.projectId && state.projectId !== preloadedProject) {
      preloadedProject = state.projectId;
      preloadAll(state.projectId);
    }
  }

  function render() {
    const state = api.getState(), choices = $('picker-agents');
    if (choices) {
      choices.replaceChildren();
      for (const value of Object.keys(names)) {
        const choice = button('', () => {
          provider = value;
          if ($('picker-custom')) $('picker-custom').hidden = true;
          load();
        }, 'agent-choice');
        choice.disabled = saving;
        choice.setAttribute('aria-pressed', String(provider === value));
        const icon = node('i', undefined, 'agent-icon ' + (value === 'local' ? 'codex' : value));
        icon.setAttribute('aria-hidden', 'true');
        choice.append(icon, node('span', names[value]));
        choices.append(choice);
      }
    }

    const host = $('picker-models');
    if (!host) return;
    host.replaceChildren();

    if ($('picker-custom-button')) $('picker-custom-button').hidden = provider === 'local';
    if ($('picker-status')) $('picker-status').textContent = failure || (loading && !result ? 'Loading models…' : result?.message || '');

    if (loading && !result) {
      host.append(node('p', 'Loading available models…', 'picker-empty'));
      return;
    }
    if (failure && !result) {
      host.append(node('p', failure, 'picker-empty'));
      return;
    }

    const installed = provider === 'local' ? result?.installed : (state.status?.providers?.[provider]?.available || state.accounts?.[provider]?.available || state.accounts?.[provider]?.installed);
    if (!installed) {
      host.append(node('p', provider === 'local' ? 'Install Codex CLI to use local workspace tools.' : state.accounts?.[provider]?.message || `Install and configure ${names[provider]} to use this connection.`, 'picker-empty'));
      host.append(button('Open connection settings', () => { close(); $('relay-settings')?.click(); }, 'text-link'));
      return;
    }

    const rows = provider === 'local'
      ? (result?.models || [])
      : [{ id: '', displayName: 'Provider default', description: 'Default model configured by the agent' }, ...(result?.models || []).filter(row => row.value !== 'default')];

    let count = 0;
    for (const row of rows) {
      const id = row.id || row.model || row.value || '', title = row.displayName || row.name || id;
      const desc = provider === 'local'
        ? [row.parameterSize, 'Downloaded'].filter(Boolean).join(' · ')
        : (row.description && row.description !== id ? row.description : (id ? id : 'Default configured model'));
      const local = state.localSelections?.[scope], selected = provider === 'local'
        ? (local?.model === id && local.digest === row.digest)
        : (!local && state.provider === provider && (state.model || '') === id);

      const choice = button('', () => choose(row), 'model-choice');
      choice.disabled = saving;
      choice.setAttribute('aria-pressed', String(selected));
      const text = node('span');
      text.append(node('strong', title), node('small', desc));
      choice.append(text, node('span', selected ? '✓' : '', 'model-choice-check'));
      host.append(choice);
      count++;
    }

    if (!count) {
      host.append(node('p', provider === 'local' ? 'No compatible models found in Ollama.' : 'No models reported.', 'picker-empty'));
    }
  }

  async function preloadAll(projectId) {
    if (!projectId) return;
    const providers = ['codex', 'claude', 'gemini', 'local'];
    for (const p of providers) {
      const key = projectId + ':' + p;
      if (!cache.has(key)) {
        try {
          const data = await api.api(p === 'local' ? '/api/local-models' : `/api/providers/${p}/models`, {}, projectId);
          cache.set(key, data);
          cache.set(key + ':time', Date.now());
        } catch {}
      }
    }
    if (open()) render();
  }

  async function quietRefresh(key, projectId, selectedProvider) {
    try {
      const data = await api.api(selectedProvider === 'local' ? '/api/local-models' : `/api/providers/${selectedProvider}/models`, {}, projectId);
      cache.set(key, data);
      cache.set(key + ':time', Date.now());
      if (open() && scope === projectId && provider === selectedProvider) {
        result = data;
        render();
      }
    } catch {}
  }

  async function load(force = false) {
    const token = ++revision, projectId = scope, selectedProvider = provider, key = projectId + ':' + selectedProvider;
    result = cache.get(key) || null;
    failure = '';
    if (result && !force) {
      loading = false;
      render();
      if (Date.now() - (cache.get(key + ':time') || 0) > 60000) {
        quietRefresh(key, projectId, selectedProvider);
      }
      return;
    }
    if (selectedProvider !== 'local' && !api.getState().status?.providers?.[selectedProvider]?.available && !api.getState().accounts?.[selectedProvider]?.available && !api.getState().accounts?.[selectedProvider]?.installed) {
      result = null; loading = false; render(); return;
    }
    loading = true; render();
    try {
      const data = await api.api(selectedProvider === 'local' ? '/api/local-models' : `/api/providers/${selectedProvider}/models`, {}, projectId);
      cache.set(key, data);
      cache.set(key + ':time', Date.now());
      if (token !== revision || projectId !== api.getState().projectId) return;
      result = data;
    } catch (error) {
      if (token === revision) failure = error.message;
    } finally {
      if (token === revision) { loading = false; render(); }
    }
  }

  async function choose(row) {
    if (saving || scope !== api.getState().projectId) return;
    const token = revision, projectId = scope, selectedProvider = provider;
    saving = true; failure = ''; render();
    try {
      if (selectedProvider === 'local') api.selectLocalModel({ model: row.id, digest: row.digest });
      else await api.selectAgentModel(selectedProvider, row.id || row.model || row.value || null);
      if (token === revision && projectId === api.getState().projectId) {
        close();
        $('message-input')?.focus();
      }
    } catch (error) {
      if (token === revision) failure = error.message;
    } finally {
      saving = false; label(); if (open()) render();
    }
  }

  trigger.addEventListener('click', () => {
    if (open()) { close(); return; }
    const state = api.getState();
    scope = state.projectId;
    provider = state.localSelections?.[scope] ? 'local' : state.provider;
    if ($('picker-custom')) $('picker-custom').hidden = true;
    popup.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    position();
    load();
  });

  $('picker-custom-button')?.addEventListener('click', () => {
    if ($('picker-custom')) {
      $('picker-custom').hidden = !$('picker-custom').hidden;
      if (!$('picker-custom').hidden) $('picker-custom-id')?.focus();
    }
  });

  $('picker-custom-save')?.addEventListener('click', () => {
    const id = $('picker-custom-id')?.value.trim();
    if (id && id.length <= 200) choose({ id });
  });

  popup.addEventListener('toggle', () => {
    trigger.setAttribute('aria-expanded', String(open()));
    if (!open()) ++revision;
  });

  window.addEventListener('resize', position);
  window.addEventListener('relay-state', label);
  label();
  document.documentElement.classList.add('rich-model-picker');
  window.relayModelPicker = { open: () => trigger.click(), close };

  setTimeout(() => {
    const state = api?.getState?.();
    if (state?.projectId) preloadAll(state.projectId);
  }, 200);
})();
