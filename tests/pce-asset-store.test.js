'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createPceAssetStore } = require('../pce-asset-store');
const { resolveUnderRoot } = require('../pce-file-safety');

test('PCE asset store owns normalized document CRUD and path status', () => {
  const tempRoot = path.join(__dirname, '..', 'node_modules', '.asset-store-test');
  fs.mkdirSync(tempRoot, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(tempRoot, 'project-'));
  const normalizeAsset = (asset = {}) => ({ id: String(asset.id), type: String(asset.type), source: String(asset.source || '') });
  const normalizeAssetDocument = (doc = {}) => ({ version: 2, assets: (doc.assets || []).map(normalizeAsset) });
  const store = createPceAssetStore({ normalizeAsset, normalizeAssetDocument, resolveUnderRoot });

  assert.deepEqual(store.readAssetDocument(projectDir), { version: 2, assets: [] });
  store.upsertAsset(projectDir, { id: 'bg', type: 'image', source: 'assets/bg.png' });
  assert.equal(store.listAssets(projectDir).assets[0].exists, false);
  store.upsertAsset(projectDir, { id: 'voice', type: 'adpcm' });
  store.reorderAssets(projectDir, ['voice', 'bg']);
  assert.deepEqual(store.readAssetDocument(projectDir).assets.map((asset) => asset.id), ['voice', 'bg']);
  store.deleteAsset(projectDir, 'bg');
  assert.deepEqual(store.readAssetDocument(projectDir).assets.map((asset) => asset.id), ['voice']);
});
