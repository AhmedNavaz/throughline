const { contextBridge, ipcRenderer } = require('electron');
const token = process.argv.find(value => value.startsWith('--relay-token='))?.slice(14);
contextBridge.exposeInMainWorld('relayDesktop', Object.freeze({
  token,
  pickFolder: () => ipcRenderer.invoke('relay:pick-folder'),
  openExternal: url => ipcRenderer.invoke('relay:open-external',url),
  platform: process.platform,
  getLaunchState: () => ipcRenderer.invoke('relay:launch'),
  chooseData: choice => ipcRenderer.invoke('relay:choose-data', choice),
  getKeepAwake: () => ipcRenderer.invoke('relay:keep-awake:get'),
  setKeepAwake: enabled => ipcRenderer.invoke('relay:keep-awake:set', enabled),
  onKeepAwakeChanged: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('relay:keep-awake-changed', listener);
    return () => ipcRenderer.removeListener('relay:keep-awake-changed', listener);
  },
  onMenuCommand: callback => {
    const listener = (_event, name, value) => callback(name, value);
    ipcRenderer.on('relay:menu-command', listener);
    return () => ipcRenderer.removeListener('relay:menu-command', listener);
  },
  setMenuState: state => ipcRenderer.send('relay:menu-state', state),
}));
