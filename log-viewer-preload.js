const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logViewerAPI', {
  onSnapshot: (callback) => {
    ipcRenderer.on('log:snapshot', (_event, payload) => callback(payload));
  },
  onEntry: (callback) => {
    ipcRenderer.on('log:entry', (_event, payload) => callback(payload));
  },
});
