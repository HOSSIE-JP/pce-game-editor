'use strict';

// VGM (Video Game Music log) -> PC Engine PSG step pattern importer.
//
// A VGM file is a timestamped log of sound-chip register writes. For the
// PC Engine the relevant chip is the HuC6280 PSG, whose register writes use
// VGM command 0xB9 (`0xB9 aa dd` = write value dd to PSG register aa).
//
// The pce-game-editor PSG asset model is a simple 16th-note step sequencer
// (see normalizePsgPatternEntries / generatePsgMetadata in pce-asset-manager.js
// and tick_psg / psg_apply_step_row in the VN runtime): a fixed number of
// `steps`, each step optionally SETs a channel's (period, volume). A voice
// persists until a later step changes it. Step duration is derived from `bpm`
// exactly as the runtime does: frames_per_step = clamp(floor(3600/(bpm*4)),2,24).
//
// We therefore decode the VGM by simulating the PSG register state over time,
// sampling each channel at every step boundary, and emitting a pattern entry
// only when a channel's (period, volume) changes from the previous step. This
// is inherently lossy (no waveform/LFO/noise/DDA, capped at 256 steps and the
// 16th-note grid) and is intended for short jingles / SFX, mirroring how PSG is
// used in this editor.

const zlib = require('zlib');

const quantize = require('./pce-psg-quantize');

const VGM_SAMPLE_RATE = 44100; // VGM wait commands count samples at 44100 Hz.
const { PSG_CHANNEL_COUNT, MAX_STEPS, clampInt } = quantize;

function maybeGunzip(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return zlib.gunzipSync(buffer);
  }
  return buffer;
}

// Number of operand bytes that follow a VGM command byte, so unknown commands
// can be skipped without losing stream sync. Data-block commands (0x67/0x68)
// and waits are handled explicitly by the walker.
function operandSize(cmd, version) {
  if (cmd === 0x61) return 2; // wait nnnn samples
  if (cmd === 0x62 || cmd === 0x63 || cmd === 0x66) return 0; // wait 735 / 882 / end
  if (cmd >= 0x70 && cmd <= 0x8f) return 0; // wait n+1 / YM2612 PCM+wait
  if (cmd === 0x4f || cmd === 0x50) return 1; // GG stereo / PSG
  if (cmd >= 0x51 && cmd <= 0x5f) return 2; // FM chip register writes
  if (cmd >= 0x40 && cmd <= 0x4e) return version >= 0x160 ? 2 : 1; // reserved (version dependent)
  if (cmd === 0x94) return 1; // DAC stream: stop
  if (cmd === 0x92) return 5; // DAC stream: start
  if (cmd === 0x93) return 10; // DAC stream: start fast
  if (cmd === 0x90 || cmd === 0x91 || cmd === 0x95) return 4; // DAC stream control
  if (cmd >= 0xa0 && cmd <= 0xbf) return 2; // AY8910 / second-chip / HuC6280 (0xB9) etc.
  if (cmd >= 0xc0 && cmd <= 0xdf) return 3; // 16-bit address chip writes
  if (cmd >= 0xe0 && cmd <= 0xff) return 4; // seek / reserved
  if (cmd >= 0x30 && cmd <= 0x3f) return 1; // reserved single-operand
  return 0;
}

function parseVgmHeader(buffer) {
  if (buffer.length < 0x40) throw new Error('VGM ファイルが小さすぎます');
  if (buffer.toString('ascii', 0, 4) !== 'Vgm ') {
    throw new Error('VGM ファイルではありません (magic 不一致)');
  }
  const version = buffer.readUInt32LE(0x08);
  const totalSamples = buffer.readUInt32LE(0x18);
  const loopOffsetRel = buffer.readUInt32LE(0x1c);
  const loopSamples = buffer.readUInt32LE(0x20);
  let dataStart = 0x40;
  if (version >= 0x150) {
    const rel = buffer.readUInt32LE(0x34);
    dataStart = rel ? 0x34 + rel : 0x40;
  }
  // HuC6280 clock lives at 0xA4 for VGM >= 1.61; 0 means the chip is unused.
  let huc6280Clock = 0;
  if (version >= 0x161 && buffer.length >= 0xa8) {
    huc6280Clock = buffer.readUInt32LE(0xa4);
  }
  if (dataStart < 0x40 || dataStart >= buffer.length) dataStart = 0x40;
  return {
    version,
    totalSamples,
    loopSamples,
    loopOffsetRel,
    huc6280Clock,
    dataStart,
  };
}

// Decode the PSG register log into per-step channel snapshots.
function simulatePsg(buffer, header, stepSamples, maxSteps) {
  const channels = Array.from({ length: PSG_CHANNEL_COUNT }, () => ({
    freqLow: 0,
    freqHigh: 0,
    enabled: 0,
    dda: 0,
    volume: 0,
  }));
  let selected = 0;
  let huc6280Writes = 0;
  let usedNoise = false;
  let usedDda = false;

  const snapshots = [];
  const snapshot = () => {
    snapshots.push(channels.map((c) => ({
      period: ((c.freqHigh & 0x0f) << 8) | (c.freqLow & 0xff),
      volume: c.enabled ? (c.volume & 0x1f) : 0,
    })));
  };

  let sample = 0;
  let nextBoundary = 0;
  const advance = (count) => {
    const target = sample + count;
    while (nextBoundary <= target && snapshots.length < maxSteps) {
      snapshot();
      nextBoundary += stepSamples;
    }
    sample = target;
  };

  let pos = header.dataStart;
  let ended = false;
  while (pos < buffer.length && snapshots.length < maxSteps) {
    const cmd = buffer[pos++];
    if (cmd === 0x66) { ended = true; break; }
    if (cmd === 0x61) {
      advance(buffer.readUInt16LE(pos));
      pos += 2;
      continue;
    }
    if (cmd === 0x62) { advance(735); continue; }
    if (cmd === 0x63) { advance(882); continue; }
    if (cmd >= 0x70 && cmd <= 0x7f) { advance((cmd & 0x0f) + 1); continue; }
    if (cmd >= 0x80 && cmd <= 0x8f) { advance(cmd & 0x0f); continue; } // YM2612 PCM write + wait
    if (cmd === 0x67) {
      // data block: 0x67 0x66 tt ssssssss <data>
      const size = buffer.readUInt32LE(pos + 2);
      pos += 6 + size;
      continue;
    }
    if (cmd === 0x68) { pos += 11; continue; } // PCM RAM write
    if (cmd === 0xb9) {
      const reg = buffer[pos];
      const val = buffer[pos + 1];
      pos += 2;
      huc6280Writes += 1;
      if (reg === 0x00) {
        selected = val & 0x07;
      } else if (selected < PSG_CHANNEL_COUNT) {
        const ch = channels[selected];
        if (reg === 0x02) {
          ch.freqLow = val & 0xff;
        } else if (reg === 0x03) {
          ch.freqHigh = val & 0x0f;
        } else if (reg === 0x04) {
          ch.enabled = (val >> 7) & 1;
          ch.dda = (val >> 6) & 1;
          ch.volume = val & 0x1f;
          if (ch.dda) usedDda = true;
        }
      }
      if (reg === 0x07 && (val & 0x80)) usedNoise = true; // per-channel noise enable
      continue;
    }
    // Any other command: skip its operands to stay in sync.
    pos += operandSize(cmd, header.version);
  }

  // Guarantee at least one row so a write-only / truncated log still imports.
  if (!snapshots.length) snapshot();

  return { snapshots, huc6280Writes, usedNoise, usedDda, ended };
}

// Convert a raw VGM/VGZ buffer into a PSG asset description.
// options: { bpm }. Returns { isSong, bpm, steps, channels, period, pattern, stats, warnings }.
function convertVgmToPsg(rawBuffer, options = {}) {
  const buffer = maybeGunzip(Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer));
  const header = parseVgmHeader(buffer);
  // Mirror the runtime's frames_per_step so imported timing matches playback.
  const { bpm, framesPerStep, stepSamples } = quantize.gridForBpm(options.bpm);

  const sim = simulatePsg(buffer, header, stepSamples, MAX_STEPS);
  if (!sim.huc6280Writes) {
    throw new Error('VGM に PC Engine (HuC6280) PSG データが見つかりませんでした');
  }

  const steps = Math.max(1, Math.min(MAX_STEPS, sim.snapshots.length));
  const durationSeconds = header.totalSamples > 0
    ? header.totalSamples / VGM_SAMPLE_RATE
    : (steps * stepSamples) / VGM_SAMPLE_RATE;

  const warnings = [];
  if (sim.usedNoise) warnings.push('VGM のノイズチャンネルは PSG step では音程として扱われます');
  if (sim.usedDda) warnings.push('VGM の DDA (直接波形) は再現されず音程として近似されます');

  return quantize.assembleConversion(sim.snapshots, {
    bpm,
    framesPerStep,
    stepSamples,
    sampleRate: VGM_SAMPLE_RATE,
    isSong: header.loopSamples > 0,
    warnings,
    stats: {
      version: header.version,
      totalSamples: header.totalSamples,
      durationSeconds,
      huc6280Clock: header.huc6280Clock,
      huc6280Writes: sim.huc6280Writes,
      framesPerStep,
      looped: header.loopSamples > 0,
    },
  });
}

module.exports = {
  VGM_SAMPLE_RATE,
  MAX_STEPS,
  maybeGunzip,
  parseVgmHeader,
  convertVgmToPsg,
};
