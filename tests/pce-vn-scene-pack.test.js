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
      version: 3,
      headerSize: 20,
      commandSize: 19,
      messageSize: 13,
      choiceSize: 6,
      switchSize: 5,
      spriteTextCommand: 15,
      instantGlyphMax: 255,
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

test('VN scene pack keeps the 13-byte message record with nullable mouth slot and full instant count', () => {
  const codec = createVnScenePackCodec({
    clampInt: (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.trunc(Number(value)))) : fallback,
    clampSignedInt: (value, fallback) => Number.isFinite(Number(value)) ? Math.max(-32768, Math.min(32767, Math.trunc(Number(value)))) : fallback,
    constants: {
      cacheBytes: 128,
      magic: Buffer.from('PVNS'),
      version: 3,
      headerSize: 20,
      commandSize: 19,
      messageSize: 13,
      choiceSize: 6,
      switchSize: 5,
      spriteTextCommand: 15,
      instantGlyphMax: 255,
    },
  });
  const makePack = (mouthSlot) => codec.buildScenePack({
    sceneId: 'message',
    commands: [],
    messages: [{
      glyphs: Buffer.from([0x41]),
      glyphCount: 1,
      voiceIndex: -1,
      textSpeedFrames: 10,
      advanceMode: 0,
      autoWaitFrames: 60,
      mouthSlot,
      instantGlyphCount: 255,
      textColor: 0x1ff,
    }],
    choices: [],
    switches: [],
  });

  const unspecified = makePack(null);
  assert.equal(unspecified.length, 34);
  assert.equal(unspecified.readInt16LE(28), -1);
  assert.equal(unspecified[30], 255);
  assert.equal(makePack(-1).readInt16LE(28), -1);

  const clamped = makePack(99);
  assert.equal(clamped.readInt16LE(28), 3);
  assert.equal(clamped[30], 255);
});
