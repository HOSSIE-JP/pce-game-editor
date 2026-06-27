import { psgNoiseHzFromValue } from './psg-sfx-synth.mjs';

const PSG_CLOCK = 3579545;
const PSG_CHANNEL_COUNT = 6;

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function psgFramesPerStep(bpm) {
  const value = clampInt(bpm, 30, 300, 150);
  return Math.max(2, Math.min(24, Math.floor(3600 / (value * 4))));
}

export function psgFrequencyFromPeriod(period) {
  const raw = Number(period);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(40, Math.min(8000, PSG_CLOCK / (32 * raw)));
}

function noteToPeriod(note = 'C4') {
  const base = { C: 1024, D: 912, E: 812, F: 768, G: 684, A: 608, B: 542 };
  const name = String(note).slice(0, 1).toUpperCase();
  const octave = asNumber(String(note).slice(1), 4);
  const shift = Math.max(-2, Math.min(3, 4 - octave));
  return Math.max(32, Math.min(4095, Math.round((base[name] || 1024) * (2 ** shift))));
}

export function normalizePsgPreviewPattern(asset = {}) {
  const options = asset.options || {};
  const rawPattern = Array.isArray(options.pattern) ? options.pattern : [];
  // Per-asset master volume (0-100%), mirrored from the build so the preview level
  // matches the generated runtime.
  const volumeScale = clampInt(options.volume, 0, 100, 100);
  const scaleVolume = (volume) => clampInt(Math.round((volume * volumeScale) / 100), 0, 31, volume);
  if (!rawPattern.length) {
    const period = clampInt(options.period, 1, 4095, 512);
    return period ? [{ step: 0, channel: 0, period, volume: scaleVolume(16), noise: 0 }] : [];
  }
  return rawPattern.map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry : {};
    const hasNote = typeof raw.note === 'string' && raw.note.trim();
    const fallbackPeriod = hasNote ? noteToPeriod(raw.note) : 0;
    const period = raw.period == null
      ? fallbackPeriod
      : clampInt(raw.period, 0, 4095, fallbackPeriod);
    const volumeFallback = period > 0 ? 16 : 0;
    return {
      step: clampInt(raw.step ?? index, 0, 4095, index),
      channel: clampInt(raw.channel, 0, PSG_CHANNEL_COUNT - 1, 0),
      period,
      volume: scaleVolume(clampInt(raw.volume, 0, 31, volumeFallback)),
      noise: clampInt(raw.noise, 0, 1, 0),
    };
  });
}

export function expandPsgPreviewStates(asset = {}) {
  const options = asset.options || {};
  const steps = clampInt(options.steps, 1, 4096, 16);
  const byStep = Array.from({ length: steps }, () => []);
  normalizePsgPreviewPattern(asset).forEach((entry) => {
    if (entry.step >= 0 && entry.step < steps) byStep[entry.step].push(entry);
  });
  const state = Array.from({ length: PSG_CHANNEL_COUNT }, () => ({ period: 0, volume: 0, noise: 0 }));
  return byStep.map((entries) => {
    entries.forEach((entry) => {
      state[entry.channel] = { period: entry.period, volume: entry.volume, noise: entry.noise };
    });
    return state.map((cell) => ({ ...cell }));
  });
}

export function psgPreviewStats(asset = {}) {
  const entries = normalizePsgPreviewPattern(asset);
  const used = new Set(entries.filter((entry) => entry.volume > 0).map((entry) => entry.channel));
  const noiseCount = entries.filter((entry) => entry.noise && entry.volume > 0).length;
  const firstTone = entries.find((entry) => entry.volume > 0 && entry.period > 0 && !entry.noise);
  return {
    entries: entries.length,
    channels: used.size || 0,
    noiseCount,
    firstPeriod: firstTone?.period || clampInt(asset.options?.period, 1, 4095, 512),
  };
}

export function createPsgPreviewController({ onStateChange, onError } = {}) {
  let audioContext = null;
  let previewState = null;

  const emitState = () => {
    try { onStateChange?.(Boolean(previewState)); } catch (_) {}
  };

  const emitError = (message) => {
    try { onError?.(message); } catch (_) {}
  };

  function rememberNode(node) {
    if (!previewState || !node) return;
    previewState.nodes.push(node);
    node.onended = () => {
      if (!previewState) return;
      previewState.nodes = previewState.nodes.filter((entry) => entry !== node);
    };
  }

  function scheduleEnvelope(gain, start, duration, level) {
    const end = start + Math.max(0.02, duration);
    gain.gain.cancelScheduledValues(start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.006);
    gain.gain.setValueAtTime(level, Math.max(start + 0.008, end - 0.018));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  function scheduleTone(cell, start, duration) {
    const frequency = psgFrequencyFromPeriod(cell.period);
    if (!frequency || !audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, start);
    scheduleEnvelope(gain, start, duration, Math.min(0.12, (cell.volume / 31) * 0.1));
    osc.connect(gain).connect(audioContext.destination);
    osc.start(start);
    osc.stop(start + duration);
    rememberNode(osc);
  }

  function scheduleNoise(cell, start, duration) {
    if (!audioContext) return;
    const playDuration = Math.min(duration, 0.12);
    const sampleRate = audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * playDuration));
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    // Faithful PSG noise: a sample-and-hold LFSR clocked at the real HuC6280
    // noise rate, not a bandpass-filtered white noise. This gives the metallic
    // LFSR character (buzzy at low values, hiss at high) of the actual PSG /
    // runtime, so designed SFX sound the same once built. The 5-bit value maps
    // to pitch via psgNoiseHzFromValue (shared with the runtime convention).
    const noiseHz = psgNoiseHzFromValue(cell.period & 0x1f);
    const holdSamples = Math.max(1, Math.round(sampleRate / noiseHz));
    let lfsr = 0x7fff;
    let out = 1;
    let counter = 0;
    for (let i = 0; i < length; i += 1) {
      if (counter <= 0) {
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        out = (lfsr & 1) ? 1 : -1;
        counter = holdSamples;
      }
      counter -= 1;
      data[i] = out;
    }
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    scheduleEnvelope(gain, start, playDuration, Math.min(0.08, (cell.volume / 31) * 0.07));
    source.connect(gain).connect(audioContext.destination);
    source.start(start);
    source.stop(start + playDuration);
    rememberNode(source);
  }

  function scheduleStep() {
    const state = previewState;
    if (!state || !audioContext) return;
    if (state.step >= state.rows.length) {
      if (!state.loop) {
        stop();
        return;
      }
      state.step = 0;
    }
    const row = state.rows[state.step] || [];
    const start = audioContext.currentTime + 0.012;
    row.forEach((cell, channel) => {
      if (!cell || cell.volume <= 0 || cell.period <= 0) return;
      if (cell.noise && channel >= 4) scheduleNoise(cell, start, state.stepSeconds);
      else scheduleTone(cell, start, state.stepSeconds * 0.96);
    });
    state.step += 1;
    const timer = window.setTimeout(() => {
      if (previewState) previewState.timers = previewState.timers.filter((entry) => entry !== timer);
      scheduleStep();
    }, Math.max(20, state.stepSeconds * 1000));
    state.timers.push(timer);
  }

  function stop() {
    const state = previewState;
    previewState = null;
    if (!state) {
      emitState();
      return;
    }
    state.timers.forEach((timer) => window.clearTimeout(timer));
    state.nodes.forEach((node) => {
      try { node.stop?.(); } catch (_) {}
      try { node.disconnect?.(); } catch (_) {}
    });
    emitState();
  }

  async function play(asset = {}, options = {}) {
    stop();
    const rows = expandPsgPreviewStates(asset);
    if (!rows.some((row) => row.some((cell) => cell.volume > 0 && cell.period > 0))) {
      emitError('再生できる PSG pattern がありません');
      return false;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      emitError('この環境では WebAudio preview を利用できません');
      return false;
    }
    audioContext = audioContext || new AudioCtor();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const framesPerStep = psgFramesPerStep(asset.options?.bpm || 150);
    previewState = {
      rows,
      step: 0,
      loop: options.loop ?? asset.type === 'psg-song',
      stepSeconds: framesPerStep / 60,
      timers: [],
      nodes: [],
    };
    emitState();
    scheduleStep();
    return true;
  }

  async function toggle(asset = {}, options = {}) {
    if (previewState) {
      stop();
      return false;
    }
    return play(asset, options);
  }

  function close() {
    stop();
    const ctx = audioContext;
    audioContext = null;
    if (ctx && typeof ctx.close === 'function') void ctx.close().catch(() => {});
  }

  return {
    get isPlaying() { return Boolean(previewState); },
    play,
    stop,
    toggle,
    close,
  };
}
