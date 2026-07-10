'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createVnScenePackCodec } = require('../pce-vn-scene-pack');

test('VN scene pack codec owns the binary header and cache limit', () => {
  const codec = createVnScenePackCodec({
    clampInt: (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.trunc(Number(value)))) : fallback,
    clampSignedInt: (value, fallback) => Number.isFinite(Number(value)) ? Math.max(-32768, Math.min(32767, Math.trunc(Number(value)))) : fallback,
    constants: {
      cacheBytes: 32,
      magic: Buffer.from('PVN2'),
      version: 2,
      headerSize: 20,
      commandSize: 19,
      messageSize: 14,
      choiceSize: 6,
      switchSize: 5,
      spriteTextCommand: 15,
      instantGlyphMax: 7,
      mouthSlotMask: 3,
      mouthSlotBits: 2,
    },
  });
  const pack = codec.buildScenePack({ sceneId: 'empty', commands: [], messages: [], choices: [], switches: [] });
  assert.equal(pack.subarray(0, 4).toString('ascii'), 'PVN2');
  assert.equal(pack.length, 20);
  assert.throws(() => codec.buildScenePack({
    sceneId: 'large',
    commands: [],
    messages: [{ glyphs: Buffer.alloc(20), glyphCount: 20 }],
    choices: [],
    switches: [],
  }), /split the scene/);
});
