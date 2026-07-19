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
    inspectAdpcmBatch: (dir, payload) => ({ rows: [payload], dir }),
    importAdpcmBatch: async (dir, payload, options) => {
      options.onProgress({ batchId: payload.batchId, status: 'complete' });
      return { batchId: payload.batchId, assets: [], dir };
    },
    cancelAdpcmBatch: (dir, payload) => ({ batchId: payload.batchId, canceled: true, dir }),
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
    'assets:inspectAdpcmBatch',
    'assets:importAdpcmBatch',
    'assets:cancelAdpcmBatch',
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

  const sent = [];
  const batch = await handlers.get('assets:importAdpcmBatch')({
    sender: { isDestroyed: () => false, send: (...args) => sent.push(args) },
  }, { batchId: 'batch-1' });
  assert.equal(batch.ok, true);
  assert.equal(batch.batchId, 'batch-1');
  assert.deepEqual(sent, [['assets:adpcmBatchProgress', { batchId: 'batch-1', status: 'complete' }]]);
});
