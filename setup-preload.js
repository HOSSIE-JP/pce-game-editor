'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSetup', {
  getStatus: () => ipcRenderer.invoke('setup:getStatus'),
  getCatalog: () => ipcRenderer.invoke('setup:getCatalog'),
  listVersions: (kind) => ipcRenderer.invoke('setup:listVersions', { kind }),
  downloadTool: (payload) => ipcRenderer.invoke('setup:downloadTool', payload || {}),
  setToolPath: (kind, value) => ipcRenderer.invoke('setup:setToolPath', { kind, value }),
  selectPceCdImage: () => ipcRenderer.invoke('setup:selectPceCdImage'),
  selectPceSystemCard: () => ipcRenderer.invoke('setup:selectPceSystemCard'),
  extractPceCdIpl: (payload) => ipcRenderer.invoke('setup:extractPceCdIpl', payload || {}),
  onProgress: (callback) => {
    ipcRenderer.on('setup-progress', (_event, payload) => callback(payload));
  },
});
