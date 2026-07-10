'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { registerPceAssetIpc } = require('../pce-asset-ipc');

test('PCE asset IPC registers the raw asset manager contract', async () => {
  const handlers = new Map();
  const calls = [];
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const assetManager = {
    listAssets: (dir) => ({ assets: [{ id: 'bg' }], dir }),
    upsertAsset: (dir, asset) => ({ assets: [asset], dir }),
    deleteAsset: (dir, id) => ({ assets: [], dir, id }),
    importImage: (dir, payload) => ({ asset: payload, dir }),
    importAudio: (dir, payload) => ({ asset: payload, dir }),
    importVgm: (dir, payload) => ({ asset: payload, dir }),
    importMidi: (dir, payload) => ({ asset: payload, dir }),
    previewMidi: (dir, payload) => ({ preview: payload, dir }),
    previewSource: (dir, relativePath) => ({ relativePath, dir }),
    reorderAssets: (dir, ids) => ({ ids, dir }),
  };

  registerPceAssetIpc({
    ipcMain,
    assetManager: new Proxy(assetManager, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== 'function') return value;
        return (...args) => {
          calls.push([key, ...args]);
          return value(...args);
        };
      },
    }),
    getProjectDir: () => 'project',
  });

  assert.deepEqual([...handlers.keys()], [
    'assets:list',
    'assets:upsert',
    'assets:delete',
    'assets:importImage',
    'assets:importAudio',
    'assets:importVgm',
    'assets:importMidi',
    'assets:previewMidi',
    'assets:previewSource',
    'assets:reorder',
  ]);
  assert.deepEqual(await handlers.get('assets:delete')({}, { id: 'bg' }), {
    ok: true,
    assets: [],
    dir: 'project',
    id: 'bg',
  });
  assert.deepEqual(calls[0], ['deleteAsset', 'project', 'bg']);
});
