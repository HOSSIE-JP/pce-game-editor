'use strict';

const { parseWav } = require('./pce-audio-converter');

const GODOT_OGG_VORBIS_QUALITY = 4;
const PCM_CHUNK_FRAMES = 16384;

let createOggEncoderPromise = null;

async function defaultCreateOggEncoder(options) {
  if (!createOggEncoderPromise) {
    createOggEncoderPromise = import('@audio/encode-ogg')
      .then((module) => module.default);
  }
  const createOggEncoder = await createOggEncoderPromise;
  return createOggEncoder(options);
}

function pcmSampleToFloat(wav, frameIndex, channelIndex) {
  const bytesPerSample = wav.bitsPerSample / 8;
  const offset = (frameIndex * wav.blockAlign) + (channelIndex * bytesPerSample);
  if (wav.bitsPerSample === 8) {
    return (wav.data.readUInt8(offset) - 128) / 128;
  }
  if (wav.bitsPerSample === 16) {
    return wav.data.readInt16LE(offset) / 32768;
  }
  if (wav.bitsPerSample === 24) {
    return wav.data.readIntLE(offset, 3) / 8388608;
  }
  return wav.data.readInt32LE(offset) / 2147483648;
}

function wavChunkChannelData(wav, startFrame, frameCount) {
  const channels = Array.from({ length: wav.channels }, () => new Float32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < wav.channels; channel += 1) {
      channels[channel][frame] = pcmSampleToFloat(wav, startFrame + frame, channel);
    }
  }
  return channels;
}

async function encodeWavToOggVorbis(buffer, {
  quality = GODOT_OGG_VORBIS_QUALITY,
  createOggEncoder = defaultCreateOggEncoder,
} = {}) {
  const wav = parseWav(buffer);
  if (wav.frameCount <= 0) {
    throw new Error('WAV audio has no samples');
  }
  const numericQuality = Number(quality);
  const normalizedQuality = Math.max(-1, Math.min(10,
    Number.isFinite(numericQuality) ? numericQuality : GODOT_OGG_VORBIS_QUALITY));
  const encoder = await createOggEncoder({
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    quality: normalizedQuality,
  });
  const chunks = [];
  try {
    for (let startFrame = 0; startFrame < wav.frameCount; startFrame += PCM_CHUNK_FRAMES) {
      const frameCount = Math.min(PCM_CHUNK_FRAMES, wav.frameCount - startFrame);
      const encoded = encoder.encode(wavChunkChannelData(wav, startFrame, frameCount));
      if (encoded?.length) chunks.push(Buffer.from(encoded));
    }
    const tail = encoder.flush();
    if (tail?.length) chunks.push(Buffer.from(tail));
  } finally {
    encoder.free?.();
  }

  const output = Buffer.concat(chunks);
  if (output.length < 4 || output.toString('ascii', 0, 4) !== 'OggS') {
    throw new Error('Ogg Vorbis encoder returned an invalid stream');
  }
  return {
    output,
    codec: 'vorbis',
    container: 'ogg',
    extension: '.ogg',
    quality: normalizedQuality,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    frameCount: wav.frameCount,
    durationSeconds: wav.durationSeconds,
    sourceBytes: buffer.length,
    outputBytes: output.length,
  };
}

module.exports = {
  GODOT_OGG_VORBIS_QUALITY,
  PCM_CHUNK_FRAMES,
  encodeWavToOggVorbis,
};
