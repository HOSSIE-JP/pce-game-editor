'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createVnCdCatalog } = require('../pce-vn-cd-catalog');

test('VN CD catalog collects referenced raw payloads behind a dedicated boundary', () => {
  const root = path.join(__dirname, '..', 'node_modules', '.vn-catalog-test');
  fs.mkdirSync(root, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(root, 'project-'));
  ['assets/generated/bg/tiles.bin', 'assets/generated/bg/map_vram.bin', 'assets/generated/bg/tiles.rle']
    .forEach((relativePath) => {
      const absolutePath = path.join(projectDir, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, Buffer.from([1]));
    });
  const scene = { id: 'opening', commands: [{ type: 'background', assetId: 'bg' }] };
  const catalog = createVnCdCatalog({
    assetManager: {
      readAssetDocument: () => ({ assets: [{
        id: 'bg', type: 'image', data: { generated: {
          tilesFile: 'assets/generated/bg/tiles.bin',
          mapVramFile: 'assets/generated/bg/map_vram.bin',
          tilesCompressedFile: 'assets/generated/bg/tiles.rle',
        } },
      }] }),
      assetMetaShouldUseCd: () => false,
      ASSET_META_FILE: 'assets/generated/meta/asset_meta.bin',
    },
    compiledSceneCommands: (entry) => entry.commands || [],
    normalizeAssetId: (value) => String(value || ''),
    normalizeRelativePath: (value) => String(value || '').replace(/\\/g, '/'),
    readSceneDocument: () => ({ scenes: [scene] }),
    scenePackRelativePath: () => 'assets/generated/vn/scenes/000_opening.bin',
  });

  const files = catalog.collectCdDataFiles(projectDir);
  assert.deepEqual(files, [
    'assets/generated/vn/scenes/000_opening.bin',
    'assets/generated/bg/tiles.bin',
    'assets/generated/bg/map_vram.bin',
  ]);
  assert.equal(files.some((file) => file.endsWith('.rle')), false);
});

test('VN CD catalog keeps all runtime code blobs physical and ordered before payloads', () => {
  const root = path.join(__dirname, '..', 'node_modules', '.vn-catalog-test');
  fs.mkdirSync(root, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(root, 'runtime-blobs-'));
  const runtimeFiles = {
    overlayData: 'assets/generated/vn/overlay.bin',
    visualCodeData: 'assets/generated/vn/visual_code.bin',
    cdAsyncCodeData: 'assets/generated/vn/cd_async_code.bin',
    logicOverlayData: 'assets/generated/vn/logic_overlay.bin',
  };
  Object.values(runtimeFiles).forEach((relativePath) => {
    const absolutePath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.alloc(8192));
  });

  const catalog = createVnCdCatalog({
    assetManager: {
      readAssetDocument: () => ({ assets: [] }),
      assetMetaShouldUseCd: () => false,
      ASSET_META_FILE: 'assets/generated/meta/asset_meta.bin',
    },
    compiledSceneCommands: (entry) => entry.commands || [],
    normalizeAssetId: (value) => String(value || ''),
    normalizeRelativePath: (value) => String(value || '').replace(/\\/g, '/'),
    readSceneDocument: () => ({ scenes: [{ id: 'opening', commands: [] }] }),
    scenePackRelativePath: () => 'assets/generated/vn/scenes/000_opening.bin',
    enableVisualPayloadCache: true,
    files: runtimeFiles,
  });

  assert.deepEqual(catalog.collectCdDataFiles(projectDir), [
    'assets/generated/vn/overlay.bin',
    'assets/generated/vn/visual_code.bin',
    'assets/generated/vn/cd_async_code.bin',
    'assets/generated/vn/logic_overlay.bin',
    'assets/generated/vn/scenes/000_opening.bin',
  ]);
});
