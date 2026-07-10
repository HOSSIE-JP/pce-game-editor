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
    files: { fontData: 'assets/generated/vn/font.bin' },
  });

  const files = catalog.collectCdDataFiles(projectDir);
  assert.deepEqual(files, [
    'assets/generated/vn/font.bin',
    'assets/generated/vn/scenes/000_opening.bin',
    'assets/generated/bg/tiles.bin',
    'assets/generated/bg/map_vram.bin',
  ]);
  assert.equal(files.some((file) => file.endsWith('.rle')), false);
});
