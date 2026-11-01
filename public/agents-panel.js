(() => {
  'use strict';
  // The Agents panel holds two settings: Routing (Auto, #12), which chooses the agent, model and effort for each
  // message, and Handoff (#17), which moves a running task to another agent before a usage limit. While routing is on,
  // the model button in the message box shows the mode and opens Routing here. One side panel shows at a time; the
  // last one chosen is remembered, and Agents opens on first launch.
  const $ = id => document.getElementById(id), api = window.relayUI, panel = $('agents-panel'), button = $('open-agents');
  if (!panel || !api) return;
  const PANEL_KEY = 'throughline:side-panel';
  const options = [
    { mode: null, name: 'Manual', hint: 'Uses the agent, model and effort you pick.' },
    { mode: 'saving', name: 'Cost saving', hint: 'Lighter models; prefers the agent with the most allowance left.' },
    { mode: 'balanced', name: 'Balanced', hint: 'Matches the model and effort to each message.' },
    { mode: 'quality', name: 'Maximum quality', hint: 'Strongest model and highest effort for every message.' },
  ];
  const node = (tag, cls, text) => { const value = document.createElement(tag); if (cls) value.className = cls; if (text !== undefined) value.textContent = text; return value; };
  const routing = () => api.getState().conversation?.routing || null;
  let busy = false, preferences = null;

  function error(message) { $('agents-error').textContent = message || ''; $('agents-error').hidden = !message; }
  async function choose(choice) {
    if (busy) return;
    busy = true; render();
    try { await api.setRouting(choice); error(''); }
    catch (failure) { error(failure.message); api.showNotice?.(failure.message); }
    finally { busy = false; render(); }
  }

  // The four answers to "who answers each message", as radio rows with a line on what each does.
  function renderOptions(host) {
    const current = routing(), locked = busy || !api.getState().projectId || api.isRunning();
    host.replaceChildren(...options.map(option => {
      const selected = (current?.mode || null) === option.mode, row = node('button', 'routing-option');
      row.type = 'button'; row.disabled = locked;
      row.setAttribute('role', 'radio'); row.setAttribute('aria-checked', String(selected));
      row.dataset.mode = option.mode || 'manual';
      const text = node('span', 'routing-option-text');
      text.append(node('strong', '', option.name), node('small', '', option.hint));
      row.append(node('span', 'routing-option-mark'), text);
      row.addEventListener('click', () => { if (!selected) choose({ mode: option.mode, allowApi: current?.allowApi === true }); });
      return row;
    }));
  }

  async function loadPreferences() {
    try { preferences = await api.api('/api/handoff-preferences'); } catch { preferences = null; }
    render();
  }
  async function savePreferences(patch) {
    try { preferences = await api.post('/api/handoff-preferences', patch); error(''); }
    catch (failure) { error(failure.message); }
    render();
  }

  function render() {
    const state = api.getState(), current = routing();
    if (panel.hidden) return;
    renderOptions($('routing-options'));
    $('routing-api-row').hidden = !current;
    $('routing-allow-api').checked = current?.allowApi === true;
    $('routing-allow-api').disabled = busy || api.isRunning();
    $('handoff-threshold').value = String(preferences?.threshold ?? 90);
    $('handoff-threshold').disabled = !preferences;
    $('handoff-automatic').checked = preferences?.automatic === true;
    $('handoff-automatic').disabled = !preferences || preferences.threshold === 0;
  }

  const remember = value => { try { localStorage.setItem(PANEL_KEY, value); } catch { /* The panel choice is a convenience. */ } };
  const preferred = () => { try { return localStorage.getItem(PANEL_KEY) || 'agents'; } catch { return 'agents'; } };
  // Opening the panel; it shares the right-hand side with Git activity and reviews.
  function setOpen(open, section = null, keep = true) {
    panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
    if (keep) remember(open ? 'agents' : 'none');
    if (open) {
      window.relayGit?.close();
      window.relayReviews?.closePanel?.();
      loadPreferences();
      render();
      if (section) { const target = $(`agents-${section}`); target?.scrollIntoView?.({ block: 'start' }); target?.classList.add('flash'); setTimeout(() => target?.classList.remove('flash'), 1200); }
    }
  }
  button.addEventListener('click', () => setOpen(panel.hidden));
  $('routing-allow-api').addEventListener('change', () => { const current = routing(); if (current) choose({ mode: current.mode, allowApi: $('routing-allow-api').checked }); });
  $('handoff-threshold').addEventListener('change', () => savePreferences({ threshold: Number($('handoff-threshold').value) }));
  $('handoff-automatic').addEventListener('change', () => savePreferences({ automatic: $('handoff-automatic').checked }));
  // The overview in a new conversation links to the matching part of the panel.
  document.querySelectorAll('[data-agents]').forEach(link => link.addEventListener('click', () => setOpen(true, link.dataset.agents)));
  // On a docked layout, a workspace opens with the side panel last chosen, Agents at first.
  let lastProject = null;
  window.addEventListener('relay-state', () => {
    const projectId = api.getState().projectId;
    if (projectId !== lastProject) {
      lastProject = projectId;
      if (!projectId) setOpen(false, null, false);
      else if (panel.hidden && preferred() === 'agents' && window.matchMedia?.('(min-width: 1101px)').matches) setOpen(true, null, false);
    }
    render();
  });
  window.relayAgents = { open: section => setOpen(true, section), close: () => setOpen(false, null, false), isOpen: () => !panel.hidden };
  render();
})();
