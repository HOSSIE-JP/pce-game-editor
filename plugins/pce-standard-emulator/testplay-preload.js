'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pceTestPlay', {
  getContext: () => ipcRenderer.invoke('testplay:getContext'),
});
