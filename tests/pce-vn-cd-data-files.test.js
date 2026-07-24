'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeCurrentCdDataFiles } = require('../pce-vn-cd-data-files');

test('VN CD data file policy keeps current raw files and rejects generated RLE sidecars', () => {
  const result = mergeCurrentCdDataFiles({
    generatedDataFiles: ['assets/generated/bg/tiles.bin'],
    configuredDataFiles: [
      'assets/generated/bg/tiles.bin',
      'assets/generated/bg/tiles.rle',
      'assets/generated/vn/scenes/old.bin',
      'assets/generated/removed_asset/tiles.bin',
      'assets/custom/extra.bin',
    ],
    managedPaths: new Set(['assets/generated/vn/scenes/old.bin']),
    scenePackDir: 'assets/generated/vn/scenes',
  });

  assert.deepEqual(result, [
    'assets/generated/bg/tiles.bin',
    'assets/custom/extra.bin',
  ]);
});
