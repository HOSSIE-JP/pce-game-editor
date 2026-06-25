'use strict';

// Shared PSG step-pattern quantizer used by both the VGM and MIDI importers.
//
// This module knows nothing about VGM or MIDI. It only consumes the "snapshot
// contract": an array of steps, where each step is a PSG_CHANNEL_COUNT-element
// array of `{ period, volume, noise? }` describing what each PSG voice is doing
// at that step boundary. The PC Engine PSG runtime holds a voice until it is
// changed, so the pattern only needs to record CHANGES (see buildPattern).
//
// `period` is the 12-bit tone divider (1-4095) for tone voices, or the 5-bit
// noise frequency for noise voices (channels 4/5, `noise: 1`). `volume` is the
// 5-bit amplitude (0 = silence / note-off).

const PSG_CHANNEL_COUNT = 6;
const MAX_STEPS = 256; // matches the asset model's pattern/steps cap.
const MAX_PATTERN_ENTRIES = 256;
const DEFAULT_SAMPLE_RATE = 44100; // VGM/MIDI both quantize on a 44100Hz grid.

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

// Step grid, mirroring the runtime's frames_per_step so imported timing matches
// playback: one step is a 16th note at `bpm`, 735 samples == one 60Hz frame.
function gridForBpm(bpm) {
  const clamped = clampInt(bpm, 30, 300, 150);
  const framesPerStep = Math.max(2, Math.min(24, Math.floor(3600 / (clamped * 4))));
  return { bpm: clamped, framesPerStep, stepSamples: 735 * framesPerStep };
}

// Turn per-step channel snapshots into compact pattern entries. A voice is held
// by the runtime until changed, so we only emit when (period, volume, noise)
// differs from the previously emitted state for that channel (silence is the
// baseline). The `noise` key is only attached when set, so tone-only patterns
// keep the historical `{ step, channel, period, volume }` shape.
function buildPattern(snapshots) {
  const pattern = [];
  const last = Array.from({ length: PSG_CHANNEL_COUNT }, () => ({ period: 0, volume: 0, noise: 0 }));
  let truncated = false;
  for (let step = 0; step < snapshots.length; step += 1) {
    for (let ch = 0; ch < PSG_CHANNEL_COUNT; ch += 1) {
      const cell = snapshots[step][ch] || { period: 0, volume: 0, noise: 0 };
      const noise = cell.noise ? 1 : 0;
      const period = cell.period > 0 ? cell.period : 0;
      const volume = cell.volume;
      if (period === last[ch].period && volume === last[ch].volume && noise === last[ch].noise) continue;
      last[ch] = { period, volume, noise };
      if (pattern.length >= MAX_PATTERN_ENTRIES) { truncated = true; continue; }
      const entry = {
        step,
        channel: ch,
        period: Math.max(1, Math.min(4095, period)),
        volume: clampInt(volume, 0, 31, 0),
      };
      if (noise) entry.noise = 1;
      pattern.push(entry);
    }
  }
  return { pattern, truncated };
}

// Assemble the canonical conversion result shared by both importers.
// opts: { bpm, framesPerStep, stepSamples, isSong, stats, warnings, sampleRate }
function assembleConversion(snapshots, opts = {}) {
  const { pattern, truncated } = buildPattern(snapshots);
  const steps = Math.max(1, Math.min(MAX_STEPS, snapshots.length));
  const stepSamples = opts.stepSamples || 0;
  const sampleRate = opts.sampleRate || DEFAULT_SAMPLE_RATE;

  let usedChannels = 1;
  for (const entry of pattern) {
    if (entry.volume > 0) usedChannels = Math.max(usedChannels, entry.channel + 1);
  }
  // Representative tone period (ignore noise entries, whose period is a noise freq).
  const firstTone = pattern.find((entry) => entry.volume > 0 && entry.period > 0 && !entry.noise);

  const warnings = Array.isArray(opts.warnings) ? opts.warnings.slice() : [];
  if (truncated) warnings.push(`pattern が ${MAX_PATTERN_ENTRIES} エントリを超えたため切り詰めました`);
  if (snapshots.length >= MAX_STEPS && stepSamples) {
    warnings.push(`曲が長いため先頭 ${MAX_STEPS} ステップ (約 ${((MAX_STEPS * stepSamples) / sampleRate).toFixed(1)} 秒) のみ取り込みました`);
  }

  return {
    isSong: Boolean(opts.isSong),
    bpm: opts.bpm,
    steps,
    channels: clampInt(usedChannels, 1, 6, 1),
    period: firstTone ? firstTone.period : 512,
    pattern,
    stats: { ...(opts.stats || {}), patternCount: pattern.length, stepCount: steps },
    warnings,
  };
}

module.exports = {
  PSG_CHANNEL_COUNT,
  MAX_STEPS,
  MAX_PATTERN_ENTRIES,
  DEFAULT_SAMPLE_RATE,
  clampInt,
  gridForBpm,
  buildPattern,
  assembleConversion,
};
