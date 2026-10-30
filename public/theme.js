(() => {
  'use strict';
  const key = 'ai-relay:appearance';
  let revision = 0, saving = Promise.resolve();
  const headers = () => window.relayDesktop?.token ? { 'X-AI-Relay-Token': window.relayDesktop.token } : {};
  function message(text = '') { const status = document.getElementById('appearance-status'); if (status) status.textContent = text; }
  function apply(value, save = false) {
    const theme = value === 'light' ? 'light' : 'graphite';
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'graphite' ? '#181818' : '#f8f8f8');
    document.querySelectorAll('[data-appearance]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.appearance === theme)));
    try { localStorage.setItem(key, theme); } catch { /* Appearance also works without storage. */ }
    if (save) {
      revision++;
      saving = saving.catch(() => {}).then(async () => {
        try {
          const response = await fetch('/api/appearance', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json', 'X-AI-Relay': '1' }, body: JSON.stringify({ theme }) });
          if (!response.ok) throw new Error();
          message();
        } catch { message('Appearance could not be saved. Choose it again to retry.'); }
      });
    }
  }
  // The macOS desktop window draws its own title bar; leave room for the window controls.
  if (window.relayDesktop?.platform === 'darwin') document.documentElement.classList.add('mac-titlebar');
  let initial;
  try { initial = localStorage.getItem(key); } catch {}
  apply(initial);
  fetch('/api/appearance', { headers: headers() }).then(response => response.ok ? response.json() : null).then(saved => {
    if (!revision && ['graphite', 'light'].includes(saved?.theme)) apply(saved.theme);
  }).catch(() => {});
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-appearance]').forEach(button => button.addEventListener('click', () => apply(button.dataset.appearance, true)));
    apply(document.documentElement.getAttribute('data-theme'));
  });
  window.relayTheme = { apply(value) { revision++; apply(value); }, current: () => document.documentElement.getAttribute('data-theme') || 'graphite' };
  window.addEventListener('storage', event => { if (event.key === key) apply(event.newValue); });
})();
