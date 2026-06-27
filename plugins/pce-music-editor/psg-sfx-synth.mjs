// Pure PSG sound-effect synthesizer.
//
// Turns a small set of beginner-friendly parameters (preset + a few sliders)
// into the editor's canonical PSG step pattern, the exact same
// `options.pattern = [{ step, channel, period, volume, noise }]` shape that the
// VGM/MIDI importers, the build pipeline (serializePsgPattern / generatePsgMetadata)
// and the runtime (play_psg_asset / tick_psg) already consume. Generating a
// pattern here therefore needs NO runtime or build changes.
//
// The module is intentionally free of browser globals (no AudioContext, DOM,
// etc.) so it can be unit-tested directly in Node via dynamic import().
//
// HuC6280 PSG facts used here:
//   - tone period: 12-bit divider 1..4095, freq = 3579545 / (32 * period)
//   - noise (channels 4/5): 5-bit noise frequency 0..31
//   - volume: 5-bit 0..31 (0 = silence)

const PSG_CLOCK = 3579545;
const PERIOD_MIN = 1;
const PERIOD_MAX = 4095;
const NOISE_MIN = 0;
const NOISE_MAX = 31;
const VOLUME_MAX = 31;

// Keep generated SFX resident (.rodata) for instant playback: the build marks a
// pattern as CD-streamed above 256 serialized bytes = 32 entries (8 bytes each).
// A monotonic sweep emits at most one entry per step, so capping the authored
// length at 31 steps + a trailing note-off keeps us at <= 32 entries.
const MAX_LENGTH_STEPS = 31;
const MAX_PATTERN_ENTRIES = 32;

// Tone channel anchored at 0, noise anchored at the first noise-capable channel
// (4). At play time the AUDIO command's `channel` is added as a base offset and
// clamped to 0..5, matching the existing runtime behavior.
const TONE_CHANNEL = 0;
const NOISE_CHANNEL = 4;

// UI-facing slider ranges (Hz for pitch). Pitch is edited in the frequency
// domain and stored as a period, which is what the runtime wants.
const PITCH_MIN_HZ = 55;    // ~A1
const PITCH_MAX_HZ = 3520;  // ~A7

const SFX_PARAM_RANGES = Object.freeze({
  pitchHz: { min: PITCH_MIN_HZ, max: PITCH_MAX_HZ },
  noise: { min: NOISE_MIN, max: NOISE_MAX },
  lengthSteps: { min: 1, max: MAX_LENGTH_STEPS },
  bpm: { min: 60, max: 300 },
  volume: { min: 0, max: VOLUME_MAX },
  vibratoDepth: { min: 0, max: 100 },   // percent of pitch
  vibratoRate: { min: 0, max: 16 },     // oscillations across the whole sound
});

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function psgFreqFromPeriod(period) {
  const raw = Number(period);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return PSG_CLOCK / (32 * raw);
}

function psgPeriodFromFreq(freq) {
  const raw = Number(freq);
  if (!Number.isFinite(raw) || raw <= 0) return PERIOD_MAX;
  return clampInt(PSG_CLOCK / (32 * raw), PERIOD_MIN, PERIOD_MAX, PERIOD_MAX);
}

// HuC6280 noise (channels 4/5): the 5-bit value sets the noise rate so a LARGER
// value yields a HIGHER-pitched, brighter noise and a smaller value a lower
// rumble. This matches the real PSG / the standard emulator core and the repo's
// MIDI drum mapping (low drums -> small values, cymbals -> large values). The
// editor preview clocks its LFSR at this rate so its noise matches the runtime
// instead of an arbitrary bandpass white-noise approximation.
const PSG_NOISE_CLOCK = PSG_CLOCK / 64; // ~55930 Hz base for the 5-bit divider
function psgNoiseHzFromValue(value) {
  const v = (Number(value) | 0) & 0x1f;
  return PSG_NOISE_CLOCK / (32 - v);
}

// Seedable RNG so randomize/mutate are deterministic in tests. Accepts either an
// existing rng function, a numeric seed, or nothing (falls back to Math.random).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seedOrRng) {
  if (typeof seedOrRng === 'function') return seedOrRng;
  if (Number.isFinite(seedOrRng)) return mulberry32(Number(seedOrRng) >>> 0);
  return Math.random;
}

function defaultSfxParams() {
  return {
    wave: 'tone',          // 'tone' | 'noise'
    startPeriod: psgPeriodFromFreq(880),
    endPeriod: psgPeriodFromFreq(880),
    startNoise: 16,
    endNoise: 16,
    lengthSteps: 10,
    bpm: 240,              // snappy step length for SFX
    volumeStart: 28,
    volumeEnd: 0,
    decayCurve: 'linear',  // 'linear' | 'exp'
    vibratoDepth: 0,       // 0..100 (% of pitch)
    vibratoRate: 0,        // oscillations across the whole sound
    arpSteps: 0,           // every N steps jump pitch (0 = off)
    arpAmount: 0,          // semitones per arp jump (can be negative)
  };
}

function normalizeParams(params = {}) {
  const base = defaultSfxParams();
  const merged = { ...base, ...params };
  return {
    wave: merged.wave === 'noise' ? 'noise' : 'tone',
    startPeriod: clampInt(merged.startPeriod, PERIOD_MIN, PERIOD_MAX, base.startPeriod),
    endPeriod: clampInt(merged.endPeriod, PERIOD_MIN, PERIOD_MAX, base.endPeriod),
    startNoise: clampInt(merged.startNoise, NOISE_MIN, NOISE_MAX, base.startNoise),
    endNoise: clampInt(merged.endNoise, NOISE_MIN, NOISE_MAX, base.endNoise),
    lengthSteps: clampInt(merged.lengthSteps, 1, MAX_LENGTH_STEPS, base.lengthSteps),
    bpm: clampInt(merged.bpm, 30, 300, base.bpm),
    volumeStart: clampInt(merged.volumeStart, 0, VOLUME_MAX, base.volumeStart),
    volumeEnd: clampInt(merged.volumeEnd, 0, VOLUME_MAX, base.volumeEnd),
    decayCurve: merged.decayCurve === 'exp' ? 'exp' : 'linear',
    vibratoDepth: clamp(Number(merged.vibratoDepth) || 0, 0, 100),
    vibratoRate: clamp(Number(merged.vibratoRate) || 0, 0, 16),
    arpSteps: clampInt(merged.arpSteps, 0, MAX_LENGTH_STEPS, 0),
    arpAmount: clampInt(merged.arpAmount, -24, 24, 0),
  };
}

function envelopeVolume(p, t) {
  if (p.decayCurve === 'exp') {
    // Fast initial drop, long tail.
    const k = 1 - t;
    return p.volumeEnd + (p.volumeStart - p.volumeEnd) * (k * k);
  }
  return p.volumeStart + (p.volumeEnd - p.volumeStart) * t;
}

// Build the canonical step pattern from parameters. Emits an entry only when the
// effective (period|noise, volume, noise) changes, mirroring buildPattern() in
// pce-psg-quantize.js, then appends a trailing note-off so one-shot SFX stop
// cleanly. Returns an object shaped for asset.options.
function synthesizeSfxPattern(params = {}) {
  const p = normalizeParams(params);
  const isNoise = p.wave === 'noise';
  const channel = isNoise ? NOISE_CHANNEL : TONE_CHANNEL;
  const len = p.lengthSteps;
  const noiseFlag = isNoise ? 1 : 0;

  const fStart = isNoise ? 0 : psgFreqFromPeriod(p.startPeriod);
  const fEnd = isNoise ? 0 : psgFreqFromPeriod(p.endPeriod);

  const pattern = [];
  let last = { value: -1, volume: -1 };
  let lastValue = isNoise ? p.startNoise : p.startPeriod;

  for (let i = 0; i < len; i += 1) {
    const t = len > 1 ? i / (len - 1) : 0;
    const volume = clampInt(envelopeVolume(p, t), 0, VOLUME_MAX, 0);

    let value;
    if (isNoise) {
      value = clampInt(p.startNoise + (p.endNoise - p.startNoise) * t, NOISE_MIN, NOISE_MAX, p.startNoise);
    } else {
      // Logarithmic (musical) pitch sweep between start and end frequency.
      let freq = fStart > 0 && fEnd > 0 ? fStart * Math.pow(fEnd / fStart, t) : (fStart || fEnd);
      if (p.arpSteps > 0 && p.arpAmount !== 0) {
        const arpIndex = Math.floor(i / p.arpSteps);
        freq *= Math.pow(2, (arpIndex * p.arpAmount) / 12);
      }
      if (p.vibratoDepth > 0 && p.vibratoRate > 0) {
        const lfo = Math.sin((i / Math.max(1, len)) * p.vibratoRate * 2 * Math.PI);
        freq *= 1 + (p.vibratoDepth / 100) * lfo;
      }
      value = psgPeriodFromFreq(freq);
    }
    lastValue = value;

    if (value === last.value && volume === last.volume) continue;
    last = { value, volume };
    if (pattern.length >= MAX_PATTERN_ENTRIES - 1) break; // reserve slot for note-off
    const entry = { step: i, channel, period: clampInt(value, isNoise ? NOISE_MIN : PERIOD_MIN, isNoise ? NOISE_MAX : PERIOD_MAX, isNoise ? 16 : 256), volume };
    if (noiseFlag) entry.noise = 1;
    pattern.push(entry);
  }

  // Trailing note-off so the voice is silenced when the one-shot ends.
  const offEntry = { step: len, channel, period: clampInt(lastValue, PERIOD_MIN, PERIOD_MAX, 1), volume: 0 };
  if (noiseFlag) offEntry.noise = 1;
  pattern.push(offEntry);

  const firstTone = pattern.find((entry) => entry.volume > 0 && !entry.noise && entry.period > 0);
  return {
    kind: 'sfx',
    bpm: p.bpm,
    steps: len + 1,
    period: firstTone ? firstTone.period : clampInt(p.startPeriod, PERIOD_MIN, PERIOD_MAX, 256),
    channels: channel + 1,
    pattern,
  };
}

// Beginner presets. Each is a partial params object layered over defaults; the
// `params` are stored verbatim into the asset so the sound can be re-edited.
function buildPresets() {
  return [
    {
      id: 'coin', label: 'コイン',
      params: { wave: 'tone', startPeriod: psgPeriodFromFreq(988), endPeriod: psgPeriodFromFreq(988), lengthSteps: 8, bpm: 300, volumeStart: 26, volumeEnd: 20, decayCurve: 'linear', arpSteps: 3, arpAmount: 7 },
    },
    {
      id: 'jump', label: 'ジャンプ',
      params: { wave: 'tone', startPeriod: psgPeriodFromFreq(262), endPeriod: psgPeriodFromFreq(880), lengthSteps: 10, bpm: 280, volumeStart: 26, volumeEnd: 6, decayCurve: 'linear' },
    },
    {
      id: 'laser', label: 'レーザー',
      params: { wave: 'tone', startPeriod: psgPeriodFromFreq(1760), endPeriod: psgPeriodFromFreq(220), lengthSteps: 10, bpm: 300, volumeStart: 28, volumeEnd: 0, decayCurve: 'exp', vibratoDepth: 6, vibratoRate: 8 },
    },
    {
      id: 'explosion', label: '爆発',
      params: { wave: 'noise', startNoise: 24, endNoise: 3, lengthSteps: 20, bpm: 200, volumeStart: 30, volumeEnd: 0, decayCurve: 'exp' },
    },
    {
      id: 'hit', label: 'ヒット',
      params: { wave: 'noise', startNoise: 16, endNoise: 6, lengthSteps: 5, bpm: 300, volumeStart: 26, volumeEnd: 0, decayCurve: 'exp' },
    },
    {
      id: 'powerup', label: 'パワーアップ',
      params: { wave: 'tone', startPeriod: psgPeriodFromFreq(262), endPeriod: psgPeriodFromFreq(1047), lengthSteps: 16, bpm: 280, volumeStart: 24, volumeEnd: 10, decayCurve: 'linear', arpSteps: 2, arpAmount: 4 },
    },
    {
      id: 'select', label: 'セレクト',
      params: { wave: 'tone', startPeriod: psgPeriodFromFreq(880), endPeriod: psgPeriodFromFreq(880), lengthSteps: 3, bpm: 300, volumeStart: 22, volumeEnd: 0, decayCurve: 'exp' },
    },
    {
      id: 'alarm', label: '警告',
      params: { wave: 'tone', startPeriod: psgPeriodFromFreq(660), endPeriod: psgPeriodFromFreq(660), lengthSteps: 20, bpm: 240, volumeStart: 24, volumeEnd: 20, decayCurve: 'linear', vibratoDepth: 40, vibratoRate: 6 },
    },
  ];
}

const SFX_PRESETS = buildPresets();

function presetParams(id) {
  const preset = SFX_PRESETS.find((entry) => entry.id === id);
  return preset ? normalizeParams({ ...defaultSfxParams(), ...preset.params }) : defaultSfxParams();
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Fresh random SFX: start from a random preset family, then jitter the key
// parameters so non-experts can "roll" for a sound.
function randomizeSfxParams(seedOrRng) {
  const rng = makeRng(seedOrRng);
  const preset = SFX_PRESETS[randInt(rng, 0, SFX_PRESETS.length - 1)];
  const params = normalizeParams({ ...defaultSfxParams(), ...preset.params });
  params.lengthSteps = randInt(rng, 4, MAX_LENGTH_STEPS);
  params.bpm = randInt(rng, 180, 300);
  params.volumeStart = randInt(rng, 20, VOLUME_MAX);
  params.volumeEnd = randInt(rng, 0, 8);
  params.decayCurve = rng() < 0.5 ? 'linear' : 'exp';
  if (params.wave === 'noise') {
    params.startNoise = randInt(rng, NOISE_MIN, NOISE_MAX);
    params.endNoise = randInt(rng, NOISE_MIN, NOISE_MAX);
  } else {
    const startHz = Math.round(PITCH_MIN_HZ * Math.pow(PITCH_MAX_HZ / PITCH_MIN_HZ, rng()));
    const endHz = Math.round(PITCH_MIN_HZ * Math.pow(PITCH_MAX_HZ / PITCH_MIN_HZ, rng()));
    params.startPeriod = psgPeriodFromFreq(startHz);
    params.endPeriod = psgPeriodFromFreq(endHz);
    params.vibratoDepth = rng() < 0.35 ? randInt(rng, 5, 50) : 0;
    params.vibratoRate = params.vibratoDepth ? randInt(rng, 2, 12) : 0;
    params.arpSteps = rng() < 0.3 ? randInt(rng, 2, 4) : 0;
    params.arpAmount = params.arpSteps ? randInt(rng, -7, 7) : 0;
  }
  return normalizeParams(params);
}

// Small relative tweak of an existing sound ("少し変える").
function mutateSfxParams(params, seedOrRng) {
  const rng = makeRng(seedOrRng);
  const p = normalizeParams(params);
  const jitter = (value, amount, min, max) => clampInt(value + Math.round((rng() * 2 - 1) * amount), min, max, value);
  p.lengthSteps = jitter(p.lengthSteps, 3, 1, MAX_LENGTH_STEPS);
  p.bpm = jitter(p.bpm, 30, 60, 300);
  p.volumeStart = jitter(p.volumeStart, 4, 0, VOLUME_MAX);
  p.volumeEnd = jitter(p.volumeEnd, 3, 0, VOLUME_MAX);
  if (p.wave === 'noise') {
    p.startNoise = jitter(p.startNoise, 4, NOISE_MIN, NOISE_MAX);
    p.endNoise = jitter(p.endNoise, 4, NOISE_MIN, NOISE_MAX);
  } else {
    p.startPeriod = jitter(p.startPeriod, 60, PERIOD_MIN, PERIOD_MAX);
    p.endPeriod = jitter(p.endPeriod, 120, PERIOD_MIN, PERIOD_MAX);
    p.vibratoDepth = clamp(jitter(p.vibratoDepth, 10, 0, 100), 0, 100);
  }
  return normalizeParams(p);
}

export {
  SFX_PRESETS,
  SFX_PARAM_RANGES,
  MAX_LENGTH_STEPS,
  MAX_PATTERN_ENTRIES,
  defaultSfxParams,
  normalizeParams,
  presetParams,
  synthesizeSfxPattern,
  randomizeSfxParams,
  mutateSfxParams,
  psgFreqFromPeriod,
  psgPeriodFromFreq,
  psgNoiseHzFromValue,
};
