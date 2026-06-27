'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// The synth is an ESM renderer module (no browser globals), loaded here via
// dynamic import so the same single source of truth is exercised by the tests.
const SYNTH_URL = pathToFileURL(
  path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'psg-sfx-synth.mjs'),
).href;
const synthPromise = import(SYNTH_URL);

function assertValidPattern(result, { noise } = {}) {
  assert.ok(Array.isArray(result.pattern), 'pattern is an array');
  assert.ok(result.pattern.length >= 1, 'pattern has entries');
  assert.ok(result.pattern.length <= 32, `pattern stays resident (<=32 entries), got ${result.pattern.length}`);
  assert.equal(result.kind, 'sfx');
  assert.equal(result.steps, result.pattern[result.pattern.length - 1].step + 1, 'steps covers the note-off');
  result.pattern.forEach((entry) => {
    assert.ok(Number.isInteger(entry.step) && entry.step >= 0 && entry.step < 4096, 'step in range');
    assert.ok(Number.isInteger(entry.channel) && entry.channel >= 0 && entry.channel <= 5, 'channel in range');
    assert.ok(entry.period >= 1 && entry.period <= 4095, 'period in 1..4095');
    assert.ok(entry.volume >= 0 && entry.volume <= 31, 'volume in 0..31');
    if (noise) {
      assert.equal(entry.channel, 4, 'noise SFX anchored at channel 4');
      assert.equal(entry.noise, 1, 'noise entries carry the noise flag');
    } else {
      assert.equal(entry.channel, 0, 'tone SFX anchored at channel 0');
      assert.ok(entry.noise == null, 'tone entries have no noise flag');
    }
  });
  // Last entry is a clean note-off.
  const off = result.pattern[result.pattern.length - 1];
  assert.equal(off.volume, 0, 'pattern ends with a note-off (volume 0)');
}

test('every preset produces a valid resident pattern', async () => {
  const { SFX_PRESETS, presetParams, synthesizeSfxPattern } = await synthPromise;
  assert.ok(SFX_PRESETS.length >= 8, 'at least 8 presets');
  for (const preset of SFX_PRESETS) {
    const params = presetParams(preset.id);
    const result = synthesizeSfxPattern(params);
    assertValidPattern(result, { noise: params.wave === 'noise' });
  }
});

test('tone SFX uses channel 0 and no noise flag; noise SFX uses channel 4 with noise flag', async () => {
  const { synthesizeSfxPattern, defaultSfxParams } = await synthPromise;
  const tone = synthesizeSfxPattern({ ...defaultSfxParams(), wave: 'tone' });
  assertValidPattern(tone, { noise: false });
  const noise = synthesizeSfxPattern({ ...defaultSfxParams(), wave: 'noise' });
  assertValidPattern(noise, { noise: true });
});

test('descending pitch sweep yields non-decreasing periods (lower freq = larger period)', async () => {
  const { synthesizeSfxPattern, psgPeriodFromFreq } = await synthPromise;
  const result = synthesizeSfxPattern({
    wave: 'tone',
    startPeriod: psgPeriodFromFreq(1760),
    endPeriod: psgPeriodFromFreq(220),
    lengthSteps: 12,
    volumeStart: 24,
    volumeEnd: 24,
    decayCurve: 'linear',
  });
  const tones = result.pattern.filter((entry) => entry.volume > 0);
  for (let i = 1; i < tones.length; i += 1) {
    assert.ok(tones[i].period >= tones[i - 1].period, 'period grows as the pitch falls');
  }
  // Start near 1760Hz, end near 220Hz.
  assert.ok(tones[0].period < tones[tones.length - 1].period, 'overall downward sweep');
});

test('ascending pitch sweep yields non-increasing periods', async () => {
  const { synthesizeSfxPattern, psgPeriodFromFreq } = await synthPromise;
  const result = synthesizeSfxPattern({
    wave: 'tone',
    startPeriod: psgPeriodFromFreq(220),
    endPeriod: psgPeriodFromFreq(1760),
    lengthSteps: 12,
    volumeStart: 24,
    volumeEnd: 24,
    decayCurve: 'linear',
  });
  const tones = result.pattern.filter((entry) => entry.volume > 0);
  for (let i = 1; i < tones.length; i += 1) {
    assert.ok(tones[i].period <= tones[i - 1].period, 'period shrinks as the pitch rises');
  }
});

test('length is capped so the pattern stays resident', async () => {
  const { synthesizeSfxPattern, psgPeriodFromFreq } = await synthPromise;
  // Request a longer-than-allowed sweep where every step changes.
  const result = synthesizeSfxPattern({
    wave: 'tone',
    startPeriod: psgPeriodFromFreq(2000),
    endPeriod: psgPeriodFromFreq(100),
    lengthSteps: 999,
    volumeStart: 31,
    volumeEnd: 0,
  });
  assert.ok(result.pattern.length <= 32, 'hard cap at 32 entries');
});

test('randomizeSfxParams is deterministic for a given seed and stays in range', async () => {
  const { randomizeSfxParams, synthesizeSfxPattern } = await synthPromise;
  const a = randomizeSfxParams(12345);
  const b = randomizeSfxParams(12345);
  assert.deepEqual(a, b, 'same seed -> same params');
  const c = randomizeSfxParams(54321);
  assert.notDeepEqual(a, c, 'different seed -> different params');
  // Generated params must always synthesize a valid pattern.
  for (const seed of [1, 2, 3, 100, 9999]) {
    const params = randomizeSfxParams(seed);
    const result = synthesizeSfxPattern(params);
    assertValidPattern(result, { noise: params.wave === 'noise' });
  }
});

test('psgNoiseHzFromValue: larger value = higher-pitched noise (matches PSG / MIDI drum mapping)', async () => {
  const { psgNoiseHzFromValue } = await synthPromise;
  // The runtime writes the 5-bit value straight to the PSG noise register; on
  // real PSG a larger value is a higher/brighter noise (cymbals use large values,
  // kicks small). The preview clocks its LFSR at this same rate to match.
  assert.ok(psgNoiseHzFromValue(31) > psgNoiseHzFromValue(0), 'value 31 brighter than value 0');
  for (let v = 1; v <= 31; v += 1) {
    assert.ok(psgNoiseHzFromValue(v) >= psgNoiseHzFromValue(v - 1), `monotonic at ${v}`);
  }
  // Whole 0..31 range stays finite and positive (no divide-by-zero).
  for (let v = 0; v <= 31; v += 1) {
    assert.ok(Number.isFinite(psgNoiseHzFromValue(v)) && psgNoiseHzFromValue(v) > 0, `finite at ${v}`);
  }
});

test('mutateSfxParams keeps params valid and within range', async () => {
  const { defaultSfxParams, mutateSfxParams, synthesizeSfxPattern } = await synthPromise;
  let params = defaultSfxParams();
  for (const seed of [7, 8, 9, 10]) {
    params = mutateSfxParams(params, seed);
    assert.ok(params.lengthSteps >= 1 && params.lengthSteps <= 31);
    assert.ok(params.bpm >= 60 && params.bpm <= 300);
    assert.ok(params.volumeStart >= 0 && params.volumeStart <= 31);
    const result = synthesizeSfxPattern(params);
    assertValidPattern(result, { noise: params.wave === 'noise' });
  }
});
