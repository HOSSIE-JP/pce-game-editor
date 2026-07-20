'use strict';

const fs = require('node:fs');
const path = require('node:path');

const assetManager = require('../../pce-asset-manager');
const systemCardPsg = require('../../pce-system-card-psg');

const BPM = 72;
const BAR_STEPS = 16;
const BARS = 16;
const TOTAL_STEPS = BAR_STEPS * BARS;

const OUTPUT_JSON = 'nonki_bukatsu_bgm.psg.json';
const OUTPUT_HUCARD = 'nonki_bukatsu_bgm.hucard.psg.bin';
const OUTPUT_CD = 'nonki_bukatsu_bgm.super-cd.psg.bin';

const WAVE = Object.freeze({
  melody: 22,
  harmony: 8,
  arpeggio: 35,
  bass: 20,
});

const pattern = [];
const lastTonePeriod = Array(6).fill(512);

function midiPeriod(midiNote) {
  return Math.round(3579545 / (32 * (440 * (2 ** ((midiNote - 69) / 12)))));
}

function noteName(midiNote) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
}

function tone(step, channel, midiNote, volume, wave) {
  if (!Number.isInteger(step) || step < 0 || step >= TOTAL_STEPS) {
    throw new Error(`tone step out of range: ${step}`);
  }
  const period = midiPeriod(midiNote);
  lastTonePeriod[channel] = period;
  pattern.push({ step, channel, note: noteName(midiNote), period, volume, wave });
}

function silence(step, channel) {
  if (step < 0 || step >= TOTAL_STEPS) return;
  pattern.push({ step, channel, period: lastTonePeriod[channel], volume: 0 });
}

function noisePulse(step, channel, noiseValue, volume, length = 1) {
  pattern.push({ step, channel, period: noiseValue, volume, noise: 1 });
  if (step + length < TOTAL_STEPS) {
    pattern.push({ step: step + length, channel, period: noiseValue, volume: 0, noise: 1 });
  }
}

function scoreBars(channel, bars, volume, wave) {
  if (bars.length !== BARS) throw new Error(`channel ${channel}: expected ${BARS} bars`);
  bars.forEach((bar, barIndex) => {
    const duration = bar.reduce((sum, entry) => sum + entry[1], 0);
    if (duration !== BAR_STEPS) {
      throw new Error(`channel ${channel}, bar ${barIndex + 1}: ${duration} steps (expected ${BAR_STEPS})`);
    }
    let cursor = barIndex * BAR_STEPS;
    let sounding = false;
    bar.forEach(([midiNote, steps]) => {
      if (midiNote == null) {
        if (sounding) silence(cursor, channel);
        sounding = false;
      } else {
        tone(cursor, channel, midiNote, volume, wave);
        sounding = true;
      }
      cursor += steps;
    });
  });
}

// Channel 0: main melody. Bars 1-8 are relaxed and sparse; bars 9-16 rise into
// the chorus and use more eighth-note motion.
scoreBars(0, [
  [[64, 8], [67, 4], [69, 4]],
  [[67, 8], [64, 4], [62, 4]],
  [[60, 4], [64, 4], [67, 4], [64, 4]],
  [[62, 8], [67, 8]],
  [[65, 8], [69, 4], [67, 4]],
  [[64, 8], [62, 4], [60, 4]],
  [[62, 4], [64, 4], [67, 4], [69, 4]],
  [[67, 8], [null, 4], [67, 4]],
  [[72, 4], [71, 2], [69, 2], [67, 4], [64, 4]],
  [[65, 4], [67, 4], [69, 8]],
  [[72, 4], [76, 4], [74, 4], [72, 4]],
  [[71, 8], [67, 4], [69, 4]],
  [[72, 4], [76, 4], [79, 4], [76, 4]],
  [[74, 4], [72, 4], [69, 8]],
  [[65, 4], [67, 4], [69, 4], [71, 4]],
  [[74, 4], [71, 4], [67, 8]],
], 18, WAVE.melody);

// Channel 1: a quiet long-note cushion in the melody, then a more active
// countermelody in the chorus.
scoreBars(1, [
  [[55, 16]], [[55, 16]], [[57, 16]], [[55, 16]],
  [[53, 16]], [[52, 16]], [[53, 16]], [[55, 16]],
  [[67, 8], [64, 8]],
  [[69, 8], [65, 8]],
  [[69, 4], [72, 4], [71, 4], [69, 4]],
  [[67, 8], [62, 4], [65, 4]],
  [[67, 4], [72, 4], [76, 4], [72, 4]],
  [[69, 8], [64, 8]],
  [[62, 4], [64, 4], [65, 4], [67, 4]],
  [[69, 8], [62, 8]],
], 9, WAVE.harmony);

const CHORDS = [
  [60, 64, 67], [59, 62, 67], [57, 60, 64], [55, 59, 62],
  [53, 57, 60], [52, 55, 60], [50, 53, 57], [55, 59, 62],
  [60, 64, 67], [53, 57, 60], [57, 60, 64], [55, 59, 62],
  [60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62],
];

// Channel 2: steady eighth-note clubroom arpeggios. The chorus lifts the last
// two notes by an octave and gets slightly louder.
CHORDS.forEach((chord, barIndex) => {
  const base = barIndex * BAR_STEPS;
  const notes = barIndex < 8
    ? [chord[0], chord[1], chord[2], chord[1], chord[0], chord[1], chord[2], chord[1]]
    : [chord[0], chord[1], chord[2], chord[1], chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12];
  notes.forEach((midiNote, index) => tone(base + (index * 2), 2, midiNote, barIndex < 8 ? 6 : 8, WAVE.arpeggio));
});

// Channel 3: half-note bass in the melody; quarter-note walking bass in the
// chorus. The final G dominant leads directly back to the first C.
CHORDS.forEach((chord, barIndex) => {
  const base = barIndex * BAR_STEPS;
  const root = chord[0] - 12;
  const fifth = chord[2] - 12;
  if (barIndex < 8) {
    tone(base, 3, root, 11, WAVE.bass);
    tone(base + 8, 3, fifth, 9, WAVE.bass);
  } else {
    [root, fifth, root + 12, fifth].forEach((midiNote, index) => {
      tone(base + (index * 4), 3, midiNote, 12, WAVE.bass);
    });
  }
});

// Channels 4/5: restrained two-beat percussion before the chorus, then a
// brighter four-beat groove. Noise values map directly to HuC6280 noise pitch.
for (let barIndex = 0; barIndex < BARS; barIndex += 1) {
  const base = barIndex * BAR_STEPS;
  if (barIndex < 8) {
    noisePulse(base, 4, 2, 6);
    noisePulse(base + 8, 4, 15, 5);
    noisePulse(base + 4, 5, 28, 3);
    noisePulse(base + 12, 5, 28, 3);
  } else {
    noisePulse(base, 4, 2, 7);
    noisePulse(base + 4, 4, 17, 6);
    noisePulse(base + 8, 4, 2, 7);
    noisePulse(base + 12, 4, 19, 7);
    [2, 6, 10, 14].forEach((offset) => noisePulse(base + offset, 5, 30, 4));
  }
}

pattern.sort((a, b) => (a.step - b.step) || (a.channel - b.channel));

const duplicateKeys = new Set();
for (const entry of pattern) {
  const key = `${entry.step}:${entry.channel}`;
  if (duplicateKeys.has(key)) throw new Error(`duplicate pattern event: ${key}`);
  duplicateKeys.add(key);
}

const asset = {
  id: 'nonki_bukatsu_bgm',
  type: 'psg-song',
  name: 'のんきな部活動',
  source: '',
  options: {
    kind: 'song',
    bpm: BPM,
    speed: 6,
    period: midiPeriod(64),
    wave: WAVE.melody,
    channels: 6,
    steps: TOTAL_STEPS,
    volume: 100,
    loop: true,
    timeSignature: '4/4',
    bars: BARS,
    stepsPerBar: BAR_STEPS,
    sections: [
      { name: 'メロ', startBar: 1, endBar: 8, startStep: 0 },
      { name: 'サビ', startBar: 9, endBar: 16, startStep: 128 },
    ],
    pattern,
  },
};

const normalizedAsset = assetManager.normalizeAsset(asset);
const normalizedPattern = assetManager.normalizePsgPatternEntries(
  normalizedAsset,
  normalizedAsset.options,
);
const huCardBytes = assetManager.serializePsgPattern(normalizedPattern);
const cdPackage = systemCardPsg.compileSystemCardPsgPackage(normalizedAsset, 0);

const assetDocument = {
  version: 2,
  assets: [asset],
};

fs.writeFileSync(path.join(__dirname, OUTPUT_JSON), `${JSON.stringify(assetDocument, null, 2)}\n`);
fs.writeFileSync(path.join(__dirname, OUTPUT_HUCARD), huCardBytes);
fs.writeFileSync(path.join(__dirname, OUTPUT_CD), cdPackage.bytes);

const durationSeconds = (TOTAL_STEPS * 900) / BPM / 60;
process.stdout.write(`${JSON.stringify({
  title: asset.name,
  bpm: BPM,
  bars: BARS,
  steps: TOTAL_STEPS,
  durationSeconds,
  patternEntries: normalizedPattern.length,
  huCardBytes: huCardBytes.length,
  superCdBytes: cdPackage.bytes.length,
  superCdChannels: cdPackage.usedChannels,
  outputs: [OUTPUT_JSON, OUTPUT_HUCARD, OUTPUT_CD],
}, null, 2)}\n`);

