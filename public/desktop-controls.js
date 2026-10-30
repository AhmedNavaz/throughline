(() => {
  'use strict';
  const button = document.getElementById('keep-awake'), label = document.getElementById('keep-awake-label'), bridge = window.relayDesktop;
  if (!bridge?.getKeepAwake || !bridge?.setKeepAwake) return;
  let state = {enabled:false,active:false,runningCount:0}, pending = false;
  function render(next) {
    if (next) state = next;
    button.hidden = false; button.disabled = pending;
    button.dataset.state = state.error ? 'error' : state.active ? 'active' : state.enabled ? 'armed' : 'off';
    label.textContent = state.error ? 'Keep awake · Error' : state.active ? 'Keep awake · On' : state.enabled ? 'Keep awake · Auto' : 'Keep awake · Off';
    button.setAttribute('aria-pressed',String(state.enabled));
    button.setAttribute('aria-busy',String(pending));
    button.title = state.error ? state.error : state.active ? `Keeping the display awake for ${state.runningCount} active ${state.runningCount === 1 ? 'agent' : 'agents'}. Click to turn off.` : state.enabled ? 'Enabled. The display will stay awake while any workspace has a running agent. Currently idle; normal display sleep is allowed.' : 'Keep the display awake while agents are working in any workspace. Currently off.';
    button.setAttribute('aria-label',label.textContent + '. ' + button.title);
  }
  const unsubscribe = bridge.onKeepAwakeChanged?.(next => render(next));
  bridge.getKeepAwake().then(render).catch(error => render({...state,error:error.message || 'Could not read display sleep settings.'}));
  button.addEventListener('click',async()=>{
    if(pending)return;
    pending = true; render();
    try { render(await bridge.setKeepAwake(!state.enabled)); }
    catch(error) { window.relayUI?.showNotice('Could not update keep awake. ' + (error.message || 'Try again.')); }
    finally { pending = false; render(); }
  });
  window.addEventListener('beforeunload',()=>unsubscribe?.());
})();
