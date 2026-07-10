'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerPluginIpc } = require('../plugin-ipc');

test('plugin IPC exposes scan diagnostics and explicit user trust changes', async () => {
  const handlers = new Map();
  const calls = [];
  registerPluginIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: { openPath: async () => '' },
    fs: { mkdirSync: () => {} },
    buildSystem: { getActiveCoreId: () => 'pc-engine' },
    pluginManager: {
      listPlugins: (options) => [{ id: 'demo', options }],
      listPluginDiagnostics: () => [{ pluginId: 'broken', code: 'manifest-invalid' }],
      getRendererAssets: () => ({ ok: true }),
      setEnabledWithDependencies: () => ({ ok: true, changedIds: [] }),
      setUserPluginTrusted: (id, trusted) => { calls.push([id, trusted]); return { ok: true, id, trusted }; },
      getUserPluginsDir: () => 'C:/plugins',
    },
    invokeRendererPluginHook: async () => ({ ok: true }),
    runPluginGeneratorAndWrite: async () => ({ ok: true }),
  });

  assert.deepEqual(await handlers.get('plugins:listDiagnostics')({}, {}), [{ pluginId: 'broken', code: 'manifest-invalid' }]);
  assert.deepEqual(await handlers.get('plugins:setTrusted')({}, { id: 'demo', trusted: true }), {
    ok: true, id: 'demo', trusted: true,
  });
  assert.deepEqual(calls, [['demo', true]]);
});
