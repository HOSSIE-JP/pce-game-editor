'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('testPlaySettingsAPI', {
  getSettings: () => ipcRenderer.invoke('testplay:getSettings'),
  getDefaultSettings: () => ipcRenderer.invoke('testplay:getDefaultSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('testplay:saveSettings', settings || {}),
  onSettingsChanged: (callback) => {
    ipcRenderer.on('testplay:settings-changed', (_event, payload) => callback(payload));
  },
});