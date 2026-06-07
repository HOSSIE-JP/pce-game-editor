const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- 既存 ---
  openRomDialog: () => ipcRenderer.invoke('dialog:openRomFile'),
  readRomFile: (filePath) => ipcRenderer.invoke('fs:readRomFile', filePath),
  startApiServer: (options) => ipcRenderer.invoke('api:startServer', options),
  stopApiServer: () => ipcRenderer.invoke('api:stopServer'),
  isApiServerRunning: () => ipcRenderer.invoke('api:isRunning'),
  startAiControlServer: (options) => ipcRenderer.invoke('ai-control:start', options || {}),
  stopAiControlServer: () => ipcRenderer.invoke('ai-control:stop'),
  getAiControlStatus: () => ipcRenderer.invoke('ai-control:status'),
  listAiControlTools: () => ipcRenderer.invoke('ai-control:listTools'),
  openDebugWindow: (options) => ipcRenderer.invoke('window:openDebug', options),
  onRomSelected: (callback) => {
    ipcRenderer.on('rom-selected', (_event, payload) => callback(payload));
  },
  onApiLog: (callback) => {
    ipcRenderer.on('api-log', (_event, payload) => callback(payload));
  },
  onApiExit: (callback) => {
    ipcRenderer.on('api-exit', (_event, payload) => callback(payload));
  },
  onAiControlLog: (callback) => {
    ipcRenderer.on('ai-control-log', (_event, payload) => callback(payload));
  },
  // --- エディタ追加 ---
  openSetupWindow: () => ipcRenderer.invoke('window:openSetup'),
  openTestPlayWindow: (romPath) => ipcRenderer.invoke('window:openTestPlay', romPath),
  generateProject: (sourceCode, config) => ipcRenderer.invoke('build:generateProject', sourceCode, config),
  generateStructureOnly: (config) => ipcRenderer.invoke('build:generateStructureOnly', config),
  runBuild: (options) => ipcRenderer.invoke('build:run', options || {}),
  getRomPath: () => ipcRenderer.invoke('build:getRomPath'),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  openPathInExplorer: (targetPath, options) => ipcRenderer.invoke('fs:openPathInExplorer', targetPath, options || {}),
  saveRomAs: (sourcePath) => ipcRenderer.invoke('fs:saveRomAs', sourcePath),
  getProjectConfig: () => ipcRenderer.invoke('build:getProjectConfig'),
  saveProjectConfig: (patch) => ipcRenderer.invoke('build:saveProjectConfig', patch || {}),
  getCurrentSource: () => ipcRenderer.invoke('build:getCurrentSource'),
  generateSample: () => ipcRenderer.invoke('build:getSampleCode'),
  onBuildLog: (callback) => {
    ipcRenderer.on('build-log', (_event, payload) => callback(payload));
  },
  onBuildEnd: (callback) => {
    ipcRenderer.on('build-end', (_event, payload) => callback(payload));
  },
  onPluginLog: (callback) => {
    ipcRenderer.on('plugin-log', (_event, payload) => callback(payload));
  },
  onLogWindowClosed: (callback) => {
    ipcRenderer.on('log:windowClosed', (_event, payload) => callback(payload));
  },
  onMenuOpenSetup: (callback) => {
    ipcRenderer.on('menu:openSetup', (_event) => callback());
  },
  onMenuOpenProjects: (callback) => {
    ipcRenderer.on('menu:openProjects', (_event) => callback());
  },
  onMenuOpenAbout: (callback) => {
    ipcRenderer.on('menu:openAbout', (_event) => callback());
  },
  openLogWindow: (snapshot) => ipcRenderer.invoke('log:openWindow', snapshot || {}),
  syncLogWindow: (snapshot) => ipcRenderer.invoke('log:syncWindow', snapshot || {}),
  appendLogWindowEntry: (entry) => ipcRenderer.invoke('log:appendEntry', entry || {}),
  listResDefinitions: () => ipcRenderer.invoke('res:listDefinitions'),
  createResFile: (relativePath) => ipcRenderer.invoke('res:createFile', relativePath),
  deleteResFile: (relativePath) => ipcRenderer.invoke('res:deleteFile', relativePath),
  addResEntry: (payload) => ipcRenderer.invoke('res:addEntry', payload),
  updateResEntry: (payload) => ipcRenderer.invoke('res:updateEntry', payload),
  deleteResEntry: (payload) => ipcRenderer.invoke('res:deleteEntry', payload),
  openResDirectory: () => ipcRenderer.invoke('res:openDirectory'),
  reorderResEntries: (payload) => ipcRenderer.invoke('res:reorderEntries', payload),
  pickFile: (options) => ipcRenderer.invoke('dialog:pickFile', options || {}),
  pickAssetSource: () => ipcRenderer.invoke('res:pickAssetSource'),
  readFileAsDataUrl: (sourcePath) => ipcRenderer.invoke('res:readFileAsDataUrl', sourcePath),
  readTempFileAsDataUrl: (sourcePath, options) => ipcRenderer.invoke('res:readTempFileAsDataUrl', sourcePath, options || {}),
  deleteTempFile: (sourcePath) => ipcRenderer.invoke('res:deleteTempFile', sourcePath),
  loadOptionalAudioEngine: (engineId) => ipcRenderer.invoke('setup:loadOptionalAudioEngine', engineId),
  writeAssetFile: (payload) => ipcRenderer.invoke('res:writeAssetFile', payload),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),
  getProjectStartupState: () => ipcRenderer.invoke('project:getStartupState'),
  listProjects: () => ipcRenderer.invoke('project:list'),
  openExistingProject: (payload) => ipcRenderer.invoke('project:openExisting', payload),
  createNewProject: (payload) => ipcRenderer.invoke('project:createNew', payload),
  // --- コードエディタ向け (プロジェクト配下) ---
  getCodeRoot: () => ipcRenderer.invoke('codefs:getRoot'),
  listCodeTree: (payload) => ipcRenderer.invoke('codefs:list', payload),
  readCodeFile: (payload) => ipcRenderer.invoke('codefs:read', payload),
  writeCodeFile: (payload) => ipcRenderer.invoke('codefs:write', payload),
  createCodeEntry: (payload) => ipcRenderer.invoke('codefs:create', payload),
  deleteCodeEntry: (payload) => ipcRenderer.invoke('codefs:delete', payload),
  renameCodeEntry: (payload) => ipcRenderer.invoke('codefs:rename', payload),
  // --- プラグイン ---
  listPlugins: (options) => ipcRenderer.invoke('plugins:list', options || {}),
  getPluginRendererAssets: (id) => ipcRenderer.invoke('plugins:getRendererAssets', { id }),
  invokePluginHook: (id, hook, payload) => ipcRenderer.invoke('plugins:invokeHook', { id, hook, payload }),
  getPluginRoles: () => ipcRenderer.invoke('plugins:getRoles'),
  getPluginRole: (roleId) => ipcRenderer.invoke('plugins:getRole', { roleId }),
  setPluginRole: (roleId, id) => ipcRenderer.invoke('plugins:setRole', { roleId, id }),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', { id, enabled }),
  runPluginGenerator: (id) => ipcRenderer.invoke('plugins:runGenerator', { id }),
  openPluginsFolder: () => ipcRenderer.invoke('plugins:openFolder'),
  listCores: () => ipcRenderer.invoke('cores:list'),
  getActiveCore: () => ipcRenderer.invoke('cores:getActive'),
  listAssets: () => ipcRenderer.invoke('assets:list'),
  upsertAsset: (asset) => ipcRenderer.invoke('assets:upsert', asset || {}),
  deleteAsset: (id) => ipcRenderer.invoke('assets:delete', { id }),
  importAssetImage: (payload) => ipcRenderer.invoke('assets:importImage', payload || {}),
  importAssetAudio: (payload) => ipcRenderer.invoke('assets:importAudio', payload || {}),
  previewAssetSource: (relativePath) => ipcRenderer.invoke('assets:previewSource', { relativePath }),
  reorderAssets: (ids) => ipcRenderer.invoke('assets:reorder', { ids }),
  // --- エクスポート ---
  exportRom: () => ipcRenderer.invoke('export:rom'),
  exportHtml: () => ipcRenderer.invoke('export:html'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
