'use strict';

function registerPluginIpc(options = {}) {
  const {
    ipcMain,
    shell,
    fs,
    pluginManager,
    buildSystem,
    invokeRendererPluginHook,
    runPluginGeneratorAndWrite,
  } = options;
  if (!ipcMain || !pluginManager || !buildSystem) throw new Error('plugin IPC dependencies are required');

  const scanOptions = (requestOptions = {}) => ({
    coreId: buildSystem.getActiveCoreId(),
    includeIncompatible: requestOptions?.includeIncompatible !== false,
  });

  ipcMain.handle('plugins:list', (_event, requestOptions = {}) => (
    pluginManager.listPlugins(scanOptions(requestOptions))
  ));

  ipcMain.handle('plugins:listDiagnostics', (_event, requestOptions = {}) => (
    pluginManager.listPluginDiagnostics(scanOptions(requestOptions))
  ));

  ipcMain.handle('plugins:getRendererAssets', (_event, { id }) => pluginManager.getRendererAssets(id));

  ipcMain.handle('plugins:setEnabled', (_event, { id, enabled }) => {
    const result = pluginManager.setEnabledWithDependencies(id, Boolean(enabled), {
      coreId: buildSystem.getActiveCoreId(),
    });
    return result?.ok ? result : { ...result, ok: false, error: result?.error || 'plugin enable failed' };
  });

  ipcMain.handle('plugins:setTrusted', (_event, { id, trusted }) => (
    pluginManager.setUserPluginTrusted(id, Boolean(trusted))
  ));

  ipcMain.handle('plugins:openFolder', async () => {
    const pluginsDir = pluginManager.getUserPluginsDir();
    try {
      fs.mkdirSync(pluginsDir, { recursive: true });
      const error = await shell.openPath(pluginsDir);
      return error ? { ok: false, error } : { ok: true, path: pluginsDir };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('plugins:invokeHook', async (_event, { id, hook, payload }) => (
    invokeRendererPluginHook(id, hook, payload || {})
  ));

  ipcMain.handle('plugins:runGenerator', async (_event, { id }) => runPluginGeneratorAndWrite(id));
}

module.exports = { registerPluginIpc };
