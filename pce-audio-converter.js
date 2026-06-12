'use strict';

const RIFF = 'RIFF';
const WAVE = 'WAVE';

function readAscii(buffer, offset, length) {
  return buffer.toString('ascii', offset, offset + length);
}

function parseWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error('WAV data is too small');
  }
  if (readAscii(buffer, 0, 4) !== RIFF || readAscii(buffer, 8, 4) !== WAVE) {
    throw new Error('RIFF/WAVE PCM file is required');
  }

  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = readAscii(buffer, offset, 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + size, buffer.length);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('WAV fmt chunk is invalid');
      fmt = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(start, end);
    }
    offset = end + (size % 2);
  }

  if (!fmt) throw new Error('WAV fmt chunk is missing');
  if (!data) throw new Error('WAV data chunk is missing');
  if (fmt.audioFormat !== 1) throw new Error('Only PCM WAV files are supported');
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) {
    throw new Error(`Unsupported WAV bit depth: ${fmt.bitsPerSample}`);
  }
  if (fmt.channels < 1 || fmt.channels > 2) {
    throw new Error('Mono or stereo WAV files are supported');
  }
  if (!fmt.blockAlign) throw new Error('WAV block alignment is invalid');

  const frameCount = Math.floor(data.length / fmt.blockAlign);
  return {
    ...fmt,
    data,
    frameCount,
    durationSeconds: frameCount / fmt.sampleRate,
  };
}

function sampleAt(wav, frameIndex, channelIndex) {
  const channels = wav.channels;
  const channel = Math.min(channelIndex, channels - 1);
  const bytesPerSample = wav.bitsPerSample / 8;
  const offset = (frameIndex * wav.blockAlign) + (channel * bytesPerSample);
  if (offset < 0 || offset + bytesPerSample > wav.data.length) return 0;
  if (wav.bitsPerSample === 8) {
    return ((wav.data.readUInt8(offset) - 128) << 8);
  }
  if (wav.bitsPerSample === 16) {
    return wav.data.readInt16LE(offset);
  }
  if (wav.bitsPerSample === 24) {
    const raw = wav.data.readIntLE(offset, 3);
    return Math.max(-32768, Math.min(32767, raw >> 8));
  }
  return Math.max(-32768, Math.min(32767, wav.data.readInt32LE(offset) >> 16));
}

function mixSample(wav, frameIndex) {
  if (wav.channels === 1) return sampleAt(wav, frameIndex, 0);
  return Math.trunc((sampleAt(wav, frameIndex, 0) + sampleAt(wav, frameIndex, 1)) / 2);
}

function renderPcm16(wav, options = {}) {
  const sampleRate = Math.max(4000, Math.min(96000, Number(options.sampleRate) || wav.sampleRate));
  const channels = Math.max(1, Math.min(2, Number(options.channels) || wav.channels));
  const frameCount = Math.max(1, Math.ceil(wav.durationSeconds * sampleRate));
  const output = Buffer.alloc(frameCount * channels * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const srcFrame = Math.min(wav.frameCount - 1, Math.floor((frame * wav.sampleRate) / sampleRate));
    for (let ch = 0; ch < channels; ch += 1) {
      const sample = channels === 1 ? mixSample(wav, srcFrame) : sampleAt(wav, srcFrame, ch);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), (frame * channels + ch) * 2);
    }
  }
  return { sampleRate, channels, frameCount, pcm: output };
}

function writeWavPcm16(rendered) {
  const dataSize = rendered.pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write(RIFF, 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write(WAVE, 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(rendered.channels, 22);
  buffer.writeUInt32LE(rendered.sampleRate, 24);
  buffer.writeUInt32LE(rendered.sampleRate * rendered.channels * 2, 28);
  buffer.writeUInt16LE(rendered.channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  rendered.pcm.copy(buffer, 44);
  return buffer;
}

const OKI_STEP_TABLE = Object.freeze([
  16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66,
  73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658,
  724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552,
]);

const OKI_INDEX_SHIFT = Object.freeze([-1, -1, -1, -1, 2, 4, 6, 8]);
const PCE_ADPCM_MIN_SAMPLE_RATE = 4000;
const PCE_ADPCM_MAX_SAMPLE_RATE = 32000;
const PCE_ADPCM_BASE_SAMPLE_RATE = 32000;
const PCE_ADPCM_LEGACY_BASE_SAMPLE_RATE = 32000;
const PCE_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE = 16000;
const PCE_ADPCM_CODEC = 'oki-msm5205';
const PCE_ADPCM_EXPERIMENTAL_CODEC = 'pce-cd-adpcm-experimental';
const PCE_ADPCM_NIBBLE_ORDER = 'msn-first';
const PCE_ADPCM_ENCODER_VERSION = 2;

function normalizeAdpcmNibbleOrder(value = PCE_ADPCM_NIBBLE_ORDER) {
  const order = String(value || '').trim().toLowerCase();
  if (order === 'msn-first' || order === 'high-first' || order === 'high') return 'msn-first';
  if (order === 'lsn-first' || order === 'low-first' || order === 'low') return 'lsn-first';
  return PCE_ADPCM_NIBBLE_ORDER;
}

function sampleRateToAdpcmDivider(sampleRate = 16000) {
  const rate = Math.max(PCE_ADPCM_MIN_SAMPLE_RATE, Math.min(PCE_ADPCM_MAX_SAMPLE_RATE, Number(sampleRate) || 16000));
  let best = 0;
  let bestDiff = Infinity;
  for (let code = 0; code <= 15; code += 1) {
    const actual = adpcmDividerToSampleRate(code);
    const diff = Math.abs(actual - rate);
    if (diff < bestDiff) {
      best = code;
      bestDiff = diff;
    }
  }
  return best;
}

function legacySampleRateToAdpcmDivider(sampleRate = 16000) {
  const rate = Math.max(1, Number(sampleRate) || 16000);
  const divider = Math.round((PCE_ADPCM_LEGACY_BASE_SAMPLE_RATE / rate) - 1);
  return Math.max(0, Math.min(255, divider));
}

function slowLegacySampleRateToAdpcmDivider(sampleRate = 16000) {
  const rate = Math.max(1, Number(sampleRate) || 16000);
  const divider = Math.round((PCE_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE / rate) - 1);
  return Math.max(0, Math.min(255, divider));
}

function adpcmDividerToSampleRate(divider = 0) {
  const value = Math.max(0, Math.min(15, Math.trunc(Number(divider) || 0)));
  return Math.round(PCE_ADPCM_BASE_SAMPLE_RATE / (16 - value));
}

function decodeOkiNibble(state, nibble) {
  const step = OKI_STEP_TABLE[state.index];
  let delta = step >> 3;
  if (nibble & 1) delta += step >> 2;
  if (nibble & 2) delta += step >> 1;
  if (nibble & 4) delta += step;
  const signal = (state.signal + ((nibble & 8) ? -delta : delta)) & 0x0fff;
  const index = Math.max(0, Math.min(OKI_STEP_TABLE.length - 1, state.index + OKI_INDEX_SHIFT[nibble & 7]));
  return { signal, index };
}

function okiSignalToPcm16(signal) {
  return ((signal & 0x0fff) - 2048) << 4;
}

function encodeOkiAdpcm(rendered, startFrame = 0, frameCount = null, options = {}) {
  const nibbleOrder = normalizeAdpcmNibbleOrder(options.nibbleOrder);
  const firstFrame = Math.max(0, Math.min(rendered.frameCount || 0, Math.trunc(Number(startFrame) || 0)));
  const frames = Math.max(0, Math.min(
    (rendered.frameCount || 0) - firstFrame,
    frameCount == null ? (rendered.frameCount || 0) - firstFrame : Math.trunc(Number(frameCount) || 0)
  ));
  const channels = Math.max(1, Number(rendered.channels) || 1);
  const out = Buffer.alloc(Math.ceil(frames / 2));
  let state = { signal: 2048, index: 0 };
  for (let index = 0; index < frames; index += 1) {
    const offset = ((firstFrame + index) * channels) * 2;
    const sample = rendered.pcm.readInt16LE(offset);
    let bestNibble = 0;
    let bestState = state;
    let bestError = Infinity;
    for (let nibble = 0; nibble < 16; nibble += 1) {
      const next = decodeOkiNibble(state, nibble);
      const error = Math.abs(sample - okiSignalToPcm16(next.signal));
      if (error < bestError) {
        bestError = error;
        bestNibble = nibble;
        bestState = next;
        if (error === 0) break;
      }
    }
    state = bestState;
    const byteIndex = Math.floor(index / 2);
    if (nibbleOrder === 'msn-first') {
      if (index % 2 === 0) out[byteIndex] = (bestNibble & 0x0f) << 4;
      else out[byteIndex] |= bestNibble & 0x0f;
    } else if (index % 2 === 0) out[byteIndex] = bestNibble & 0x0f;
    else out[byteIndex] |= (bestNibble & 0x0f) << 4;
  }
  return out;
}

function decodeOkiAdpcm(buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const sampleRate = Math.max(4000, Math.min(32000, Number(options.sampleRate) || 16000));
  const nibbleOrder = normalizeAdpcmNibbleOrder(options.nibbleOrder);
  const pcm = Buffer.alloc(input.length * 4);
  const state = { signal: 2048, index: 0 };
  let sampleIndex = 0;

  for (const byte of input) {
    const first = nibbleOrder === 'msn-first' ? (byte >> 4) : (byte & 0x0f);
    const second = nibbleOrder === 'msn-first' ? (byte & 0x0f) : (byte >> 4);
    const firstState = decodeOkiNibble(state, first);
    state.signal = firstState.signal;
    state.index = firstState.index;
    pcm.writeInt16LE(okiSignalToPcm16(state.signal), sampleIndex * 2);
    sampleIndex += 1;

    const secondState = decodeOkiNibble(state, second);
    state.signal = secondState.signal;
    state.index = secondState.index;
    pcm.writeInt16LE(okiSignalToPcm16(state.signal), sampleIndex * 2);
    sampleIndex += 1;
  }

  return {
    sampleRate,
    channels: 1,
    frameCount: sampleIndex,
    pcm,
    codec: 'oki-msm5205',
    nibbleOrder,
  };
}

const PCE_ADPCM_QUANT_SCALE = Object.freeze([230, 230, 230, 230, 307, 409, 512, 614]);
const PCE_ADPCM_DELTA_SCALE = Object.freeze([1, 3, 5, 7, 9, 11, 13, 15]);

function clampPcm16(value) {
  return Math.max(-32768, Math.min(32767, value));
}

function decodePceAdpcmNibble(state, nibble) {
  const magnitude = nibble & 7;
  const sign = (nibble & 8) ? -1 : 1;
  const delta = (state.quant * PCE_ADPCM_DELTA_SCALE[magnitude]) >> 3;
  const value = clampPcm16(state.value + (sign * delta));
  const quant = Math.max(127, Math.min(24576, (state.quant * PCE_ADPCM_QUANT_SCALE[magnitude]) >> 8));
  return { value, quant };
}

function encodePceAdpcm(rendered, startFrame = 0, frameCount = null, options = {}) {
  const nibbleOrder = normalizeAdpcmNibbleOrder(options.nibbleOrder);
  const firstFrame = Math.max(0, Math.min(rendered.frameCount || 0, Math.trunc(Number(startFrame) || 0)));
  const frames = Math.max(0, Math.min(
    (rendered.frameCount || 0) - firstFrame,
    frameCount == null ? (rendered.frameCount || 0) - firstFrame : Math.trunc(Number(frameCount) || 0)
  ));
  const out = Buffer.alloc(Math.ceil(frames / 2));
  const channels = Math.max(1, Number(rendered.channels) || 1);
  let state = { value: 0, quant: 127 };
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = ((firstFrame + frame) * channels) * 2;
    const sample = rendered.pcm.readInt16LE(offset);
    let bestNibble = 0;
    let bestState = state;
    let bestError = Infinity;
    for (let nibble = 0; nibble < 16; nibble += 1) {
      const next = decodePceAdpcmNibble(state, nibble);
      const error = Math.abs(sample - next.value);
      if (error < bestError) {
        bestError = error;
        bestNibble = nibble;
        bestState = next;
        if (error === 0) break;
      }
    }
    state = bestState;
    const byteIndex = Math.floor(frame / 2);
    if (nibbleOrder === 'msn-first') {
      if (frame % 2 === 0) out[byteIndex] = (bestNibble & 0x0f) << 4;
      else out[byteIndex] |= bestNibble & 0x0f;
    } else if (frame % 2 === 0) out[byteIndex] = bestNibble & 0x0f;
    else out[byteIndex] |= (bestNibble & 0x0f) << 4;
  }
  return out;
}

function decodePceAdpcm(buffer, options = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const sampleRate = Math.max(4000, Math.min(32000, Number(options.sampleRate) || 16000));
  const nibbleOrder = normalizeAdpcmNibbleOrder(options.nibbleOrder);
  const pcm = Buffer.alloc(input.length * 4);
  let state = { value: 0, quant: 127 };
  let sampleIndex = 0;

  for (const byte of input) {
    const first = nibbleOrder === 'msn-first' ? (byte >> 4) : (byte & 0x0f);
    const second = nibbleOrder === 'msn-first' ? (byte & 0x0f) : (byte >> 4);
    state = decodePceAdpcmNibble(state, first);
    pcm.writeInt16LE(state.value, sampleIndex * 2);
    sampleIndex += 1;
    state = decodePceAdpcmNibble(state, second);
    pcm.writeInt16LE(state.value, sampleIndex * 2);
    sampleIndex += 1;
  }

  return {
    sampleRate,
    channels: 1,
    frameCount: sampleIndex,
    pcm,
    codec: PCE_ADPCM_EXPERIMENTAL_CODEC,
    nibbleOrder,
  };
}

function makeWarnings(wav, rendered, kind) {
  const warnings = [];
  if (wav.sampleRate !== rendered.sampleRate) warnings.push(`${kind}: resampled ${wav.sampleRate}Hz -> ${rendered.sampleRate}Hz`);
  if (wav.channels !== rendered.channels) warnings.push(`${kind}: channel count ${wav.channels} -> ${rendered.channels}`);
  if (wav.bitsPerSample !== 16) warnings.push(`${kind}: normalized ${wav.bitsPerSample}-bit PCM to 16-bit`);
  return warnings;
}

function waveformPeaks(wav, bucketCount = 64) {
  const buckets = Math.max(8, Math.min(256, Number(bucketCount) || 64));
  const peaks = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor((bucket / buckets) * wav.frameCount);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / buckets) * wav.frameCount));
    let peak = 0;
    for (let frame = start; frame < end; frame += 1) {
      peak = Math.max(peak, Math.abs(mixSample(wav, frame)));
    }
    peaks.push(Math.round((peak / 32768) * 1000) / 1000);
  }
  return peaks;
}

function waveformPeaksFromRendered(rendered, startFrame = 0, frameCount = null, bucketCount = 64) {
  const buckets = Math.max(8, Math.min(256, Number(bucketCount) || 64));
  const firstFrame = Math.max(0, Math.min(rendered.frameCount || 0, Math.trunc(Number(startFrame) || 0)));
  const frames = Math.max(1, Math.min(
    (rendered.frameCount || 0) - firstFrame,
    frameCount == null ? (rendered.frameCount || 0) - firstFrame : Math.trunc(Number(frameCount) || 0)
  ));
  const channels = Math.max(1, Number(rendered.channels) || 1);
  const peaks = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = firstFrame + Math.floor((bucket / buckets) * frames);
    const end = Math.max(start + 1, firstFrame + Math.floor(((bucket + 1) / buckets) * frames));
    let peak = 0;
    for (let frame = start; frame < Math.min(firstFrame + frames, end); frame += 1) {
      const offset = (frame * channels) * 2;
      peak = Math.max(peak, Math.abs(rendered.pcm.readInt16LE(offset)));
    }
    peaks.push(Math.round((peak / 32768) * 1000) / 1000);
  }
  return peaks;
}

function convertWavForCdda(buffer) {
  const wav = parseWav(buffer);
  const rendered = renderPcm16(wav, { sampleRate: 44100, channels: 2 });
  return {
    wav,
    output: writeWavPcm16(rendered),
    sampleRate: rendered.sampleRate,
    channels: rendered.channels,
    frameCount: rendered.frameCount,
    durationSeconds: rendered.frameCount / rendered.sampleRate,
    warnings: makeWarnings(wav, rendered, 'CD-DA'),
    waveform: waveformPeaks(wav),
  };
}

function convertWavForAdpcm(buffer, options = {}) {
  const wav = parseWav(buffer);
  const sampleRate = Math.max(PCE_ADPCM_MIN_SAMPLE_RATE, Math.min(PCE_ADPCM_MAX_SAMPLE_RATE, Number(options.sampleRate) || 16000));
  const nibbleOrder = normalizeAdpcmNibbleOrder(options.nibbleOrder);
  const rendered = renderPcm16(wav, { sampleRate, channels: 1 });
  const output = encodeOkiAdpcm(rendered, 0, null, { nibbleOrder });
  return {
    wav,
    output,
    codec: PCE_ADPCM_CODEC,
    encoderVersion: PCE_ADPCM_ENCODER_VERSION,
    nibbleOrder,
    sampleRate: rendered.sampleRate,
    channels: 1,
    frameCount: rendered.frameCount,
    durationSeconds: rendered.frameCount / rendered.sampleRate,
    warnings: makeWarnings(wav, rendered, 'ADPCM'),
    waveform: waveformPeaks(wav),
  };
}

function convertWavForAdpcmParts(buffer, options = {}) {
  const wav = parseWav(buffer);
  const sampleRate = Math.max(PCE_ADPCM_MIN_SAMPLE_RATE, Math.min(PCE_ADPCM_MAX_SAMPLE_RATE, Number(options.sampleRate) || 16000));
  const nibbleOrder = normalizeAdpcmNibbleOrder(options.nibbleOrder);
  const maxBytes = Math.max(1, Math.min(65535, Math.trunc(Number(options.maxBytes) || 65535)));
  const rendered = renderPcm16(wav, { sampleRate, channels: 1 });
  const maxFrames = Math.max(1, maxBytes * 2);
  const parts = [];
  for (let startFrame = 0; startFrame < rendered.frameCount; startFrame += maxFrames) {
    const frameCount = Math.min(maxFrames, rendered.frameCount - startFrame);
    const output = encodeOkiAdpcm(rendered, startFrame, frameCount, { nibbleOrder });
    parts.push({
      output,
      codec: PCE_ADPCM_CODEC,
      encoderVersion: PCE_ADPCM_ENCODER_VERSION,
      nibbleOrder,
      sampleRate: rendered.sampleRate,
      channels: 1,
      frameCount,
      durationSeconds: frameCount / rendered.sampleRate,
      waveform: waveformPeaksFromRendered(rendered, startFrame, frameCount),
    });
  }
  return {
    wav,
    sampleRate: rendered.sampleRate,
    channels: 1,
    frameCount: rendered.frameCount,
    durationSeconds: rendered.frameCount / rendered.sampleRate,
    warnings: makeWarnings(wav, rendered, 'ADPCM'),
    waveform: waveformPeaks(wav),
    maxBytes,
    parts,
  };
}

module.exports = {
  PCE_ADPCM_BASE_SAMPLE_RATE,
  PCE_ADPCM_CODEC,
  PCE_ADPCM_ENCODER_VERSION,
  PCE_ADPCM_EXPERIMENTAL_CODEC,
  PCE_ADPCM_LEGACY_BASE_SAMPLE_RATE,
  PCE_ADPCM_MAX_SAMPLE_RATE,
  PCE_ADPCM_MIN_SAMPLE_RATE,
  PCE_ADPCM_NIBBLE_ORDER,
  PCE_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE,
  adpcmDividerToSampleRate,
  convertWavForAdpcm,
  convertWavForAdpcmParts,
  convertWavForCdda,
  decodeOkiAdpcm,
  decodePceAdpcm,
  encodeOkiAdpcm,
  encodePceAdpcm,
  legacySampleRateToAdpcmDivider,
  normalizeAdpcmNibbleOrder,
  parseWav,
  renderPcm16,
  sampleRateToAdpcmDivider,
  slowLegacySampleRateToAdpcmDivider,
  waveformPeaks,
  waveformPeaksFromRendered,
  writeWavPcm16,
};
