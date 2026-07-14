'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const compiler = require('../pce-system-card-psg');

function makeAsset(overrides = {}) {
  return {
    id: overrides.id || 'tone',
    type: overrides.type || 'psg-song',
    options: {
      bpm: 150,
      steps: 4,
      period: 512,
      volume: 100,
      pattern: [{ step: 0, channel: 0, period: 512, volume: 20 }],
      ...(overrides.options || {}),
    },
  };
}

function streamBytes(compiled, channel = compiled.usedChannels[0]) {
  const stream = compiled.streamOffsets.find((entry) => entry.channel === channel);
  assert.ok(stream);
  return compiled.bytes.subarray(stream.offset, stream.offset + stream.byteLength);
}

test('System Card PSG compiler emits relocated main/sub headers and channel pointers', () => {
  const bgm = compiler.compileSystemCardPsgPackage(makeAsset({
    options: {
      pattern: [
        { step: 0, channel: 0, period: 512, volume: 20 },
        { step: 0, channel: 2, period: 384, volume: 18 },
      ],
    },
  }), 1);
  assert.equal(bgm.bytes[0], 0x0a); // main track, shifted channels 1 and 3
  assert.deepEqual(bgm.usedChannels, [1, 3]);
  assert.equal(bgm.bytes.readUInt16LE(1), compiler.PSG_BGM_LOAD_ADDRESS + 5);
  assert.equal(bgm.bytes.readUInt16LE(3), compiler.PSG_BGM_LOAD_ADDRESS + 5 + bgm.streamOffsets[0].byteLength);

  const sfx = compiler.compileSystemCardPsgPackage(makeAsset({
    type: 'psg-sfx',
    options: { pattern: [{ step: 0, channel: 0, period: 512, volume: 20 }] },
  }), 4);
  assert.equal(sfx.bytes[0], 0x90); // sub track, channel 4
  assert.equal(sfx.bytes.readUInt16LE(1), compiler.PSG_SFX_LOAD_ADDRESS + 3);
});

test('System Card PSG song loops with SEGNO/DAL SEGNO while SFX terminates', () => {
  const song = streamBytes(compiler.compileSystemCardPsgPackage(makeAsset()));
  assert.ok(song.includes(compiler.COMMAND.SEGNO));
  assert.equal(song.at(-1), compiler.COMMAND.DAL_SEGNO);

  const sfx = streamBytes(compiler.compileSystemCardPsgPackage(makeAsset({ type: 'psg-sfx' })));
  assert.ok(!sfx.includes(compiler.COMMAND.SEGNO));
  assert.equal(sfx.at(-1), compiler.COMMAND.DATA_END);
});

test('System Card PSG duration conversion splits long notes and ties each continuation', () => {
  const compiled = compiler.compileSystemCardPsgPackage(makeAsset({
    type: 'psg-sfx',
    options: {
      bpm: 30,
      steps: 20, // 600 frames
      pattern: [{ step: 0, channel: 0, period: compiler.midiNotePeriod(69), volume: 31 }],
    },
  }));
  const stream = streamBytes(compiled);
  const a4 = stream.indexOf(0xa0);
  assert.ok(a4 >= 0);
  assert.deepEqual(Array.from(stream.subarray(a4, a4 + 8)), [
    0xa0, 255,
    compiler.COMMAND.TIE, 0xa0, 255,
    compiler.COMMAND.TIE, 0xa0, 90,
  ]);
});

test('System Card PSG represents exact tone period with octave/note plus signed detune', () => {
  const a4 = compiler.midiNotePeriod(69);
  assert.deepEqual(compiler.resolveTonePeriod(a4), {
    octave: 4,
    semitone: 9,
    noteCode: 0xa0,
    period: a4,
    detune: 0,
    distance: 0,
  });
  const detuned = compiler.resolveTonePeriod(a4 + 17);
  assert.equal(detuned.octave, 4);
  assert.equal(detuned.period + detuned.detune, a4 + 17);
  assert.ok(detuned.detune >= -128 && detuned.detune <= 127);
  assert.throws(
    () => compiler.compileSystemCardPsgPackage(makeAsset({
      id: 'unrepresentable',
      options: { pattern: [{ step: 0, channel: 0, period: 4095, volume: 20 }] },
    })),
    /asset "unrepresentable", pattern\[0\].*period 4095.*detune/,
  );
});

test('System Card PSG noise uses channel 4/5 mode 2 and transpose for noise 0..31', () => {
  const compiled = compiler.compileSystemCardPsgPackage(makeAsset({
    type: 'psg-sfx',
    options: {
      pattern: [{ step: 0, channel: 0, period: 29, volume: 12, noise: 1 }],
    },
  }), 4);
  const stream = streamBytes(compiled, 4);
  const mode = stream.indexOf(compiler.COMMAND.MODE);
  assert.deepEqual(Array.from(stream.subarray(mode, mode + 6)), [
    compiler.COMMAND.MODE, 2,
    compiler.COMMAND.TRANSPOSE, 29,
    compiler.COMMAND.VOLUME, 12,
  ]);
  assert.ok(stream.includes(0x10));
});

test('System Card PSG channel variants shift and clamp with last entry winning collisions', () => {
  const compiled = compiler.compileSystemCardPsgPackage(makeAsset({
    type: 'psg-sfx',
    options: {
      pattern: [
        { step: 0, channel: 1, period: compiler.midiNotePeriod(60), volume: 9 },
        { step: 0, channel: 5, period: compiler.midiNotePeriod(69), volume: 23 },
      ],
    },
  }), 5);
  assert.deepEqual(compiled.usedChannels, [5]);
  const stream = streamBytes(compiled, 5);
  assert.ok(stream.includes(0xa0));
  assert.ok(stream.includes(23));
  assert.ok(!stream.includes(9));
});

test('System Card PSG package enforces the selected bank byte limit with location', () => {
  assert.throws(
    () => compiler.compileSystemCardPsgPackage(makeAsset({ id: 'oversize' }), 0, { maxBytes: 16 }),
    /asset "oversize", channel variant 0.*package is .*limit 16/,
  );
});

test('System Card PSG fixed waveform is user waveform 45 and exactly 32 bytes', () => {
  assert.equal(compiler.PSG_USER_WAVE_NUMBER, 45);
  assert.equal(compiler.SYSTEM_CARD_SQUARE_WAVE.length, 32);
  assert.deepEqual(Array.from(compiler.SYSTEM_CARD_SQUARE_WAVE.subarray(0, 16)), Array(16).fill(31));
  assert.deepEqual(Array.from(compiler.SYSTEM_CARD_SQUARE_WAVE.subarray(16)), Array(16).fill(0));
});

test('System Card PSG emits per-note BIOS waveform allocation and keeps wave 45 as fallback', () => {
  const allocated = streamBytes(compiler.compileSystemCardPsgPackage(makeAsset({
    options: {
      steps: 3,
      pattern: [
        { step: 0, channel: 0, period: compiler.midiNotePeriod(60), volume: 20, wave: 9 },
        { step: 1, channel: 0, period: compiler.midiNotePeriod(64), volume: 20, wave: 35 },
      ],
    },
  })));
  const firstWave = allocated.indexOf(compiler.COMMAND.WAVE);
  assert.ok(firstWave >= 0);
  assert.deepEqual(Array.from(allocated.subarray(firstWave, firstWave + 2)), [compiler.COMMAND.WAVE, 9]);
  const secondWave = allocated.indexOf(compiler.COMMAND.WAVE, firstWave + 2);
  assert.ok(secondWave > firstWave);
  assert.deepEqual(Array.from(allocated.subarray(secondWave, secondWave + 2)), [compiler.COMMAND.WAVE, 35]);

  const legacy = streamBytes(compiler.compileSystemCardPsgPackage(makeAsset()));
  const legacyWave = legacy.indexOf(compiler.COMMAND.WAVE);
  assert.deepEqual(Array.from(legacy.subarray(legacyWave, legacyWave + 2)), [compiler.COMMAND.WAVE, 45]);

  const nullWave = streamBytes(compiler.compileSystemCardPsgPackage(makeAsset({
    options: { pattern: [{ step: 0, channel: 0, period: 512, volume: 20, wave: null }] },
  })));
  const nullWaveCommand = nullWave.indexOf(compiler.COMMAND.WAVE);
  assert.deepEqual(Array.from(nullWave.subarray(nullWaveCommand, nullWaveCommand + 2)), [compiler.COMMAND.WAVE, 45]);
});
