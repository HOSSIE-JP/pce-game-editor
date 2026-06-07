'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSetup', {
  getStatus: () => ipcRenderer.invoke('setup:getStatus'),
  getActiveCore: () => ipcRenderer.invoke('cores:getActive'),
  getCatalog: () => ipcRenderer.invoke('setup:getCatalog'),
  listVersions: (kind) => ipcRenderer.invoke('setup:listVersions', { kind }),
  downloadTool: (payload) => ipcRenderer.invoke('setup:downloadTool', payload || {}),
  setToolPath: (kind, value) => ipcRenderer.invoke('setup:setToolPath', { kind, value }),
  selectPceCdImage: () => ipcRenderer.invoke('setup:selectPceCdImage'),
  selectPceSystemCard: () => ipcRenderer.invoke('setup:selectPceSystemCard'),
  extractPceCdIpl: (payload) => ipcRenderer.invoke('setup:extractPceCdIpl', payload || {}),
  listSgdkVersions: () => ipcRenderer.invoke('setup:listSgdkVersions'),
  downloadSgdk: (tag) => ipcRenderer.invoke('setup:downloadSgdk', tag),
  setSgdkPath: (p) => ipcRenderer.invoke('setup:setSgdkPath', p),
  listMarsdevVersions: () => ipcRenderer.invoke('setup:listMarsdevVersions'),
  downloadMarsdev: (tag) => ipcRenderer.invoke('setup:downloadMarsdev', tag),
  setMarsdevPath: (p) => ipcRenderer.invoke('setup:setMarsdevPath', p),
  downloadJava: () => ipcRenderer.invoke('setup:downloadJava'),
  downloadEmsdk: () => ipcRenderer.invoke('setup:downloadEmsdk'),
  downloadNukedOpn2: () => ipcRenderer.invoke('setup:downloadNukedOpn2'),
  buildNukedOpn2Wasm: () => ipcRenderer.invoke('setup:buildNukedOpn2Wasm'),

  onProgress: (callback) => {
    ipcRenderer.on('setup-progress', (_event, payload) => callback(payload));
  },
});
