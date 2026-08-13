'use strict';

/*
 * Super System Card 3.0 PSG track compiler.
 *
 * This module implements the public Hu7 track-data format from the official
 * CD-ROM2 programming manual. It does not contain BIOS code or driver data.
 * CD builds compile the editor's existing step pattern into a self-contained
 * package whose channel pointers are relocated for bank134 ($8024) or
 * bank135 ($A000). HuCard builds continue to use the legacy step format.
 */

const PSG_CLOCK = 3579545;
const PSG_CHANNEL_COUNT = 6;
const PSG_USER_WAVE_NUMBER = 45;
const PSG_BGM_LOAD_ADDRESS = 0x8024;
const PSG_SFX_LOAD_ADDRESS = 0xa000;
const PSG_BGM_MAX_BYTES = 0x2000 - 0x24;
const PSG_SFX_MAX_BYTES = 0x2000;
const PSG_DIRECT_LENGTH_MAX = 255;

const COMMAND = Object.freeze({
  TIME_BASE: 0xd0,
  OCTAVE_1: 0xd1,
  TIE: 0xda,
  VOLUME: 0xdc,
  PAN: 0xdd,
  GATE: 0xde,
  DAL_SEGNO: 0xe1,
  SEGNO: 0xe2,
  WAVE: 0xe5,
  DETUNE: 0xec,
  TRANSPOSE: 0xf2,
  MODE: 0xf8,
  DATA_END: 0xff,
});

const NOTE_CODES = Object.freeze([
  0x10, 0x20, 0x30, 0x40, 0x50, 0x60,
  0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0,
]);

const SYSTEM_CARD_SQUARE_WAVE = Buffer.from([
  31, 31, 31, 31, 31, 31, 31, 31,
  31, 31, 31, 31, 31, 31, 31, 31,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
]);

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function midiNoteFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

function midiNotePeriod(note) {
  return Math.round(PSG_CLOCK / (32 * midiNoteFrequency(note)));
}

const BIOS_NOTE_TABLE = Object.freeze(Array.from({ length: 7 * 12 }, (_unused, index) => {
  const octave = Math.floor(index / 12) + 1;
  const semitone = index % 12;
  const midiNote = ((octave + 1) * 12) + semitone;
  return Object.freeze({
    octave,
    semitone,
    noteCode: NOTE_CODES[semitone],
    period: midiNotePeriod(midiNote),
  });
}));

function sourceLocation(context, entry) {
  const asset = context.assetId ? 'asset "' + context.assetId + '"' : 'PSG asset';
  const sourceIndex = Number.isInteger(entry?.sourceIndex) ? entry.sourceIndex : '?';
  return asset + ', pattern[' + sourceIndex + ']';
}

function resolveTonePeriod(period, context = {}, entry = {}) {
  const target = clampInt(period, 1, 4095, 0);
  let best = null;
  BIOS_NOTE_TABLE.forEach((note) => {
    const detune = target - note.period;
    const distance = Math.abs(detune);
    if (!best || distance < best.distance) best = { ...note, detune, distance };
  });
  if (best && best.detune >= -128 && best.detune <= 127) return best;

  // The System Card driver can only add signed 8-bit detune to its BIOS note
  // table. Very low HuC6280 periods (for example MIDI bass note period 3624)
  // sit just outside that range. Keep the event playable by selecting the
  // closest period the driver can express instead of failing the whole VN.
  let approximation = null;
  BIOS_NOTE_TABLE.forEach((note) => {
    const detune = clampInt(target - note.period, -128, 127, 0);
    const representedPeriod = note.period + detune;
    const approximationError = Math.abs(target - representedPeriod);
    const candidate = {
      ...note,
      detune,
      distance: Math.abs(detune),
      requestedPeriod: target,
      representedPeriod,
      approximationError,
    };
    if (!approximation
      || candidate.approximationError < approximation.approximationError
      || (candidate.approximationError === approximation.approximationError
        && candidate.distance < approximation.distance)) {
      approximation = candidate;
    }
  });
  if (!approximation) {
    throw new Error(sourceLocation(context, entry) + ': tone period ' + target + ' cannot be resolved');
  }
  return approximation;
}

function frameAtStep(step, bpm) {
  return Math.round((clampInt(step, 0, 65535, 0) * 900) / bpm);
}

function normalizePattern(pattern, options = {}, baseChannel = 0) {
  const source = Array.isArray(pattern) ? pattern : [];
  const masterVolume = clampInt(options.volume, 0, 100, 100);
  const defaultPeriod = clampInt(options.period, 1, 4095, 512);
  const defaultWave = options.wave == null
    ? PSG_USER_WAVE_NUMBER
    : clampInt(options.wave, 0, PSG_USER_WAVE_NUMBER, PSG_USER_WAVE_NUMBER);
  const resolvedBase = clampInt(baseChannel, 0, 5, 0);
  return source.map((rawEntry, sourceIndex) => {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const sourceChannel = clampInt(entry.channel, 0, 5, 0);
    const volume = clampInt(
      Math.round((clampInt(entry.volume, 0, 31, 16) * masterVolume) / 100),
      0,
      31,
      16,
    );
    return {
      sourceIndex,
      step: clampInt(entry.step ?? sourceIndex, 0, 65535, sourceIndex),
      channel: Math.min(5, resolvedBase + sourceChannel),
      period: clampInt(entry.period, 1, 4095, defaultPeriod),
      volume,
      noise: clampInt(entry.noise, 0, 1, 0),
      wave: entry.wave == null
        ? defaultWave
        : clampInt(entry.wave, 0, PSG_USER_WAVE_NUMBER, defaultWave),
    };
  }).sort((a, b) => {
    if (a.step !== b.step) return a.step - b.step;
    if (a.channel !== b.channel) return a.channel - b.channel;
    return a.sourceIndex - b.sourceIndex;
  });
}

function mergeClampedChannelEvents(pattern) {
  const byKey = new Map();
  pattern.forEach((entry) => {
    // Preserve current runtime semantics: entries are applied in source order,
    // therefore the last entry for a clamped channel at one step wins.
    byKey.set(entry.channel + ':' + entry.step, entry);
  });
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.channel !== b.channel) return a.channel - b.channel;
    if (a.step !== b.step) return a.step - b.step;
    return a.sourceIndex - b.sourceIndex;
  });
}

function emitDirectInterval(bytes, noteCode, frames, tie) {
  let remaining = Math.max(1, frames);
  let first = true;
  while (remaining > 0) {
    const length = Math.min(PSG_DIRECT_LENGTH_MAX, remaining);
    if (!first && tie && noteCode !== 0) bytes.push(COMMAND.TIE);
    bytes.push(noteCode, length);
    remaining -= length;
    first = false;
  }
}

function compileToneEvent(bytes, entry, duration, state, context) {
  if (entry.volume === 0) {
    emitDirectInterval(bytes, 0, duration, false);
    return;
  }
  const note = resolveTonePeriod(entry.period, context, entry);
  if (note.approximationError > 0 && Array.isArray(context.toneApproximations)) {
    context.toneApproximations.push({
      sourceIndex: entry.sourceIndex,
      requestedPeriod: note.requestedPeriod,
      representedPeriod: note.representedPeriod,
      approximationError: note.approximationError,
    });
  }
  if (state.mode !== 0) {
    bytes.push(COMMAND.MODE, 0);
    state.mode = 0;
  }
  if (state.wave !== entry.wave) {
    bytes.push(COMMAND.WAVE, entry.wave);
    state.wave = entry.wave;
  }
  if (state.octave !== note.octave) {
    bytes.push(COMMAND.OCTAVE_1 + note.octave - 1);
    state.octave = note.octave;
  }
  if (state.detune !== note.detune) {
    bytes.push(COMMAND.DETUNE, note.detune & 0xff);
    state.detune = note.detune;
  }
  if (state.volume !== entry.volume) {
    bytes.push(COMMAND.VOLUME, entry.volume);
    state.volume = entry.volume;
  }
  emitDirectInterval(bytes, note.noteCode, duration, true);
}

function compileNoiseEvent(bytes, entry, duration, state) {
  if (entry.volume === 0) {
    emitDirectInterval(bytes, 0, duration, false);
    return;
  }
  const noise = entry.period & 0x1f;
  if (state.mode !== 2) {
    bytes.push(COMMAND.MODE, 2);
    state.mode = 2;
  }
  if (state.transpose !== noise) {
    bytes.push(COMMAND.TRANSPOSE, noise & 0xff);
    state.transpose = noise;
  }
  if (state.volume !== entry.volume) {
    bytes.push(COMMAND.VOLUME, entry.volume);
    state.volume = entry.volume;
  }
  // In noise mode interval $10 is noise number 0; transpose raises it to
  // the requested 0..31 value as documented by the Hu7 manual.
  emitDirectInterval(bytes, 0x10, duration, true);
}

function compileChannelStream(events, options, context) {
  const bpm = clampInt(options.bpm, 30, 300, 150);
  const totalSteps = clampInt(options.steps, 1, 65535, 16);
  const song = Boolean(options.isSong);
  const bytes = [
    COMMAND.TIME_BASE, 0,
    COMMAND.PAN, 0xff,
    COMMAND.GATE, 8,
  ];
  const state = {
    mode: null,
    octave: null,
    detune: null,
    transpose: null,
    volume: null,
    wave: null,
  };
  if (song) bytes.push(COMMAND.SEGNO);

  let cursorStep = 0;
  events.forEach((entry, index) => {
    const eventStep = Math.min(totalSteps, entry.step);
    if (eventStep > cursorStep) {
      const gap = Math.max(1, frameAtStep(eventStep, bpm) - frameAtStep(cursorStep, bpm));
      emitDirectInterval(bytes, 0, gap, false);
    }
    const nextStep = index + 1 < events.length
      ? Math.min(totalSteps, Math.max(eventStep + 1, events[index + 1].step))
      : totalSteps;
    const duration = Math.max(1, frameAtStep(nextStep, bpm) - frameAtStep(eventStep, bpm));
    if (entry.noise && entry.channel >= 4) {
      compileNoiseEvent(bytes, entry, duration, state);
    } else {
      compileToneEvent(bytes, entry, duration, state, context);
    }
    cursorStep = nextStep;
  });

  if (!events.length) {
    emitDirectInterval(bytes, 0, Math.max(1, frameAtStep(totalSteps, bpm)), false);
  } else if (cursorStep < totalSteps) {
    const tail = Math.max(1, frameAtStep(totalSteps, bpm) - frameAtStep(cursorStep, bpm));
    emitDirectInterval(bytes, 0, tail, false);
  }
  bytes.push(song ? COMMAND.DAL_SEGNO : COMMAND.DATA_END);
  return Buffer.from(bytes);
}

function compileSystemCardPsgPackage(asset, baseChannel = 0, compileOptions = {}) {
  const options = asset?.options && typeof asset.options === 'object' ? asset.options : {};
  const isSong = asset?.type === 'psg-song' || options.kind === 'song';
  const loadAddress = clampInt(
    compileOptions.loadAddress,
    0,
    0xffff,
    isSong ? PSG_BGM_LOAD_ADDRESS : PSG_SFX_LOAD_ADDRESS,
  );
  const maxBytes = clampInt(
    compileOptions.maxBytes,
    1,
    0xffff,
    isSong ? PSG_BGM_MAX_BYTES : PSG_SFX_MAX_BYTES,
  );
  const context = { assetId: String(asset?.id || ''), toneApproximations: [] };
  const normalized = mergeClampedChannelEvents(normalizePattern(options.pattern, options, baseChannel));
  const channelEvents = Array.from({ length: PSG_CHANNEL_COUNT }, () => []);
  normalized.forEach((entry) => channelEvents[entry.channel].push(entry));
  if (!normalized.length) {
    const channel = clampInt(baseChannel, 0, 5, 0);
    channelEvents[channel].push({
      sourceIndex: 0,
      step: 0,
      channel,
      period: clampInt(options.period, 1, 4095, 512),
      volume: 0,
      noise: 0,
      wave: options.wave == null
        ? PSG_USER_WAVE_NUMBER
        : clampInt(options.wave, 0, PSG_USER_WAVE_NUMBER, PSG_USER_WAVE_NUMBER),
    });
  }
  const usedChannels = channelEvents
    .map((events, channel) => (events.length ? channel : -1))
    .filter((channel) => channel >= 0);
  const headerBytes = 1 + (usedChannels.length * 2);
  const streams = usedChannels.map((channel) => ({
    channel,
    bytes: compileChannelStream(channelEvents[channel], {
      bpm: options.bpm,
      steps: options.steps,
      isSong,
    }, context),
  }));
  const packageSize = headerBytes + streams.reduce((sum, stream) => sum + stream.bytes.length, 0);
  if (packageSize > maxBytes) {
    throw new Error('asset "' + context.assetId + '", channel variant ' + clampInt(baseChannel, 0, 5, 0)
      + ': System Card ' + (isSong ? 'BGM' : 'SFX') + ' package is ' + packageSize
      + ' bytes (limit ' + maxBytes + ')');
  }

  const output = Buffer.alloc(packageSize);
  let mask = 0;
  usedChannels.forEach((channel) => { mask |= (1 << channel); });
  output[0] = (isSong ? 0 : 0x80) | mask;
  let pointerOffset = 1;
  let streamOffset = headerBytes;
  streams.forEach((stream) => {
    output.writeUInt16LE((loadAddress + streamOffset) & 0xffff, pointerOffset);
    stream.bytes.copy(output, streamOffset);
    pointerOffset += 2;
    streamOffset += stream.bytes.length;
  });
  return {
    bytes: output,
    assetId: context.assetId,
    baseChannel: clampInt(baseChannel, 0, 5, 0),
    bus: isSong ? 'bgm' : 'sfx',
    loadAddress,
    usedChannels,
    channelMask: mask,
    toneApproximations: context.toneApproximations,
    streamOffsets: streams.map((stream, index) => ({
      channel: stream.channel,
      offset: output.readUInt16LE(1 + (index * 2)) - loadAddress,
      address: output.readUInt16LE(1 + (index * 2)),
      byteLength: stream.bytes.length,
    })),
  };
}

function systemCardPsgVariantKey(assetId, baseChannel) {
  return String(assetId || '') + '@ch' + clampInt(baseChannel, 0, 5, 0);
}

module.exports = {
  BIOS_NOTE_TABLE,
  COMMAND,
  NOTE_CODES,
  PSG_BGM_LOAD_ADDRESS,
  PSG_BGM_MAX_BYTES,
  PSG_SFX_LOAD_ADDRESS,
  PSG_SFX_MAX_BYTES,
  PSG_USER_WAVE_NUMBER,
  SYSTEM_CARD_SQUARE_WAVE,
  compileSystemCardPsgPackage,
  frameAtStep,
  midiNotePeriod,
  resolveTonePeriod,
  systemCardPsgVariantKey,
};
