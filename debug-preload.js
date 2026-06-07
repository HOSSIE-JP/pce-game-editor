const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronDebug', {
  getWasmSnapshot: (options) => ipcRenderer.invoke('debug:getWasmSnapshot', options || {}),
  getTestPlaySettings: () => ipcRenderer.invoke('testplay:getSettings'),
  onTestPlaySettingsChanged: (callback) => {
    ipcRenderer.on('testplay:settings-changed', (_event, payload) => callback(payload));
  },
});
