'use strict';

// Standard MIDI File (SMF) -> PC Engine PSG step pattern importer.
//
// MIDI carries far more than the PSG can play (16 channels of polyphony,
// drums, pitch bend, CC, program changes, multiple tempos). This importer
// approximates: it reduces polyphony to the 6 PSG voices, maps note pitch ->
// period via the exact PSG frequency formula, velocity -> volume, renders the
// drum channel (MIDI ch 10 / index 9) as PSG noise on channels 4/5, and
// quantizes everything onto the same 16th-note grid the VGM importer uses.
//
// The conversion produces the shared "snapshot contract" (per-step arrays of
// `{period, volume, noise}` for the 6 voices) and hands it to pce-psg-quantize,
// so the snapshot->pattern logic is reused unchanged.

const quantize = require('./pce-psg-quantize');

const { clampInt, MAX_STEPS, gridForBpm, assembleConversion } = quantize;

const PSG_CLOCK = 3579545; // HuC6280 PSG clock; freq = clock / (32 * period).
const VOICE_COUNT = 6;
const DRUM_CHANNEL = 9; // MIDI channel 10 (0-indexed 9) is percussion.
const DEFAULT_TEMPO_MICROS = 500000; // 120 BPM.
const SAMPLE_RATE = 44100;

function midiNoteToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// Returns { period, clamped } — period is the 12-bit tone divider (1..4095).
function midiNoteToPeriod(note) {
  const raw = Math.round(PSG_CLOCK / (32 * midiNoteToFreq(note)));
  const period = Math.max(1, Math.min(4095, raw));
  return { period, clamped: raw !== period };
}

function velToVolume(vel) {
  return clampInt(Math.round((vel / 127) * 31), 0, 31, 0);
}

// General-MIDI drum notes ~35..81; map linearly to the 5-bit noise frequency.
function drumNoteToNoiseFreq(note) {
  return clampInt(Math.round(((note - 35) / 46) * 31), 0, 31, 0);
}

function readVarLen(buffer, pos) {
  let value = 0;
  let p = pos;
  for (let count = 0; count < 4; count += 1) {
    const byte = buffer[p];
    p += 1;
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return { value: value >>> 0, pos: p };
}

// Parse an SMF into per-track event lists (absolute ticks) plus a global tempo
// map. Exported so tests can assert the parser independently.
function parseSmf(rawBuffer) {
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'MThd') {
    throw new Error('MIDI ファイルではありません (MThd 不一致)');
  }
  const headerLen = buffer.readUInt32BE(4);
  const format = buffer.readUInt16BE(8);
  const ntrks = buffer.readUInt16BE(10);
  const division = buffer.readUInt16BE(12);

  let ppq = 0;
  let smpteDivision = false;
  let ticksPerSecond = 0;
  if (division & 0x8000) {
    smpteDivision = true;
    const fps = 256 - (division >> 8); // SMPTE format stored as negative high byte.
    const ticksPerFrame = division & 0xff;
    ticksPerSecond = fps * ticksPerFrame;
  } else {
    ppq = division & 0x7fff;
    if (!ppq) throw new Error('MIDI の division が不正です');
  }

  const tracks = [];
  const tempoMap = [];
  let pitchBendSeen = false;
  let pos = 8 + headerLen;

  for (let t = 0; t < ntrks && pos + 8 <= buffer.length; t += 1) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    const chunkLen = buffer.readUInt32BE(pos + 4);
    const dataStart = pos + 8;
    const dataEnd = Math.min(buffer.length, dataStart + chunkLen);
    pos = dataStart + chunkLen;
    if (chunkId !== 'MTrk') continue; // skip non-track chunks.

    const events = [];
    let p = dataStart;
    let absTick = 0;
    let running = null;
    while (p < dataEnd) {
      const delta = readVarLen(buffer, p);
      p = delta.pos;
      absTick += delta.value;
      if (p >= dataEnd) break;

      let status = buffer[p];
      if (status < 0x80) {
        status = running; // running status: reuse previous, byte is first data.
      } else {
        p += 1;
        running = status < 0xf0 ? status : null; // system messages clear running status.
      }
      if (status == null) break; // malformed stream.

      const hi = status & 0xf0;
      const ch = status & 0x0f;
      if (hi === 0x80) {
        const note = buffer[p]; p += 2;
        events.push({ tick: absTick, type: 'off', ch, note });
      } else if (hi === 0x90) {
        const note = buffer[p]; const vel = buffer[p + 1]; p += 2;
        events.push(vel === 0
          ? { tick: absTick, type: 'off', ch, note }
          : { tick: absTick, type: 'on', ch, note, vel });
      } else if (hi === 0xa0 || hi === 0xb0) {
        p += 2; // poly aftertouch / control change: ignored.
      } else if (hi === 0xc0 || hi === 0xd0) {
        p += 1; // program change / channel aftertouch: ignored.
      } else if (hi === 0xe0) {
        p += 2; pitchBendSeen = true; // pitch bend: ignored.
      } else if (status === 0xff) {
        const metaType = buffer[p]; p += 1;
        const len = readVarLen(buffer, p); p = len.pos;
        if (metaType === 0x51 && len.value === 3) {
          tempoMap.push({ tick: absTick, micros: (buffer[p] << 16) | (buffer[p + 1] << 8) | buffer[p + 2] });
        }
        p += len.value;
        running = null;
        if (metaType === 0x2f) break; // end of track.
      } else if (status === 0xf0 || status === 0xf7) {
        const len = readVarLen(buffer, p); p = len.pos;
        p += len.value; // sysex: skipped.
        running = null;
      } else {
        break; // unknown status: stop this track to avoid desync.
      }
    }
    tracks.push(events);
  }

  return { format, ntrks, division, ppq, smpteDivision, ticksPerSecond, tempoMap, tracks, pitchBendSeen };
}

// Build a tick->seconds function from the (PPQ) tempo map, or real-time for SMPTE.
function makeTickToSeconds(parsed) {
  if (parsed.smpteDivision) {
    const tps = parsed.ticksPerSecond || 1;
    return (tick) => tick / tps;
  }
  const segs = parsed.tempoMap.slice().sort((a, b) => a.tick - b.tick);
  // Dedup same-tick tempos (keep last) and guarantee a segment at tick 0.
  const merged = [];
  for (const seg of segs) {
    if (merged.length && merged[merged.length - 1].tick === seg.tick) merged[merged.length - 1] = seg;
    else merged.push(seg);
  }
  if (!merged.length || merged[0].tick > 0) merged.unshift({ tick: 0, micros: DEFAULT_TEMPO_MICROS });
  const ppq = parsed.ppq || 480;
  const cum = [0];
  for (let i = 1; i < merged.length; i += 1) {
    const secPerTick = merged[i - 1].micros / 1e6 / ppq;
    cum[i] = cum[i - 1] + (merged[i].tick - merged[i - 1].tick) * secPerTick;
  }
  return (tick) => {
    let j = 0;
    while (j + 1 < merged.length && merged[j + 1].tick <= tick) j += 1;
    const secPerTick = merged[j].micros / 1e6 / ppq;
    return cum[j] + (tick - merged[j].tick) * secPerTick;
  };
}

function firstTempoMicros(parsed) {
  const zero = parsed.tempoMap.filter((seg) => seg.tick === 0).pop();
  if (zero) return zero.micros;
  const sorted = parsed.tempoMap.slice().sort((a, b) => a.tick - b.tick);
  return sorted.length ? sorted[0].micros : DEFAULT_TEMPO_MICROS;
}

// Convert a raw MIDI buffer into a PSG asset description (same shape as
// convertVgmToPsg). options: { bpm } — omit/blank to use the MIDI tempo.
function convertMidiToPsg(rawBuffer, options = {}) {
  const parsed = parseSmf(rawBuffer);

  // Merge all tracks into one absolute-tick event stream.
  const events = [];
  for (const track of parsed.tracks) {
    for (const ev of track) events.push(ev);
  }
  // Stable, deterministic ordering: tick, note-off before note-on, channel, note.
  events.sort((a, b) => a.tick - b.tick
    || (a.type === 'off' ? 0 : 1) - (b.type === 'off' ? 0 : 1)
    || a.ch - b.ch
    || a.note - b.note);

  if (!events.some((ev) => ev.type === 'on')) {
    throw new Error('MIDI に取り込める音符が見つかりませんでした');
  }

  const tickToSeconds = makeTickToSeconds(parsed);
  for (const ev of events) ev.seconds = tickToSeconds(ev.tick);

  const midiBpm = clampInt(Math.round(60000000 / firstTempoMicros(parsed)), 30, 300, 150);
  const explicitBpm = options.bpm != null && options.bpm !== '' && Number.isFinite(Number(options.bpm));
  const { bpm, framesPerStep, stepSamples } = gridForBpm(explicitBpm ? options.bpm : midiBpm);
  const stepSeconds = stepSamples / SAMPLE_RATE;

  const hasDrums = events.some((ev) => ev.ch === DRUM_CHANNEL && ev.type === 'on');
  // PSG noise only exists on channels 4/5, so reserve them for drums when present.
  const melodicChannels = hasDrums ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5];
  const drumChannels = hasDrums ? [4, 5] : [];

  const voices = Array.from({ length: VOICE_COUNT }, () => ({
    active: false, note: 0, period: 0, volume: 0, noise: 0, key: -1,
  }));
  const stats = { noteCount: 0, drumNotes: 0, stolenVoices: 0, droppedNotes: 0, clampedNotes: 0 };

  const keyOf = (ev) => ev.ch * 128 + ev.note;

  const allocMelodic = (ev) => {
    stats.noteCount += 1;
    const { period, clamped } = midiNoteToPeriod(ev.note);
    if (clamped) stats.clampedNotes += 1;
    const volume = velToVolume(ev.vel);
    if (!volume) return;
    const key = keyOf(ev);
    for (const sl of melodicChannels) {
      if (voices[sl].active && voices[sl].key === key) {
        voices[sl].period = period; voices[sl].volume = volume; voices[sl].note = ev.note;
        return;
      }
    }
    let target = -1;
    for (const sl of melodicChannels) { if (!voices[sl].active) { target = sl; break; } }
    if (target === -1) {
      // Voice steal: evict the lowest-pitched active voice (keep the melody on
      // top); tie-break to the higher slot index for determinism.
      let victim = -1;
      let victimNote = Infinity;
      for (const sl of melodicChannels) {
        if (voices[sl].active && voices[sl].note <= victimNote) { victimNote = voices[sl].note; victim = sl; }
      }
      if (ev.note > victimNote) { stats.stolenVoices += 1; target = victim; } else { stats.droppedNotes += 1; return; }
    }
    voices[target] = { active: true, note: ev.note, period, volume, noise: 0, key };
  };

  const freeMelodic = (ev) => {
    const key = keyOf(ev);
    for (const sl of melodicChannels) {
      if (voices[sl].active && voices[sl].key === key) {
        voices[sl].active = false; voices[sl].volume = 0; voices[sl].key = -1;
        return;
      }
    }
  };

  const allocDrum = (ev) => {
    stats.noteCount += 1;
    stats.drumNotes += 1;
    const volume = velToVolume(ev.vel);
    if (!volume) return;
    let target = -1;
    for (const sl of drumChannels) { if (!voices[sl].active) { target = sl; break; } }
    if (target === -1) target = drumChannels[drumChannels.length - 1];
    voices[target] = { active: true, note: ev.note, period: drumNoteToNoiseFreq(ev.note), volume, noise: 1, key: -1 };
  };

  const applyEvent = (ev) => {
    if (ev.type === 'on') {
      if (ev.ch === DRUM_CHANNEL) { if (drumChannels.length) allocDrum(ev); }
      else allocMelodic(ev);
    } else if (ev.ch !== DRUM_CHANNEL) {
      freeMelodic(ev); // drums are one-shot, their note-offs are ignored.
    }
  };

  const lastSeconds = events.length ? events[events.length - 1].seconds : 0;
  const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(lastSeconds / stepSeconds) + 1));

  const snapshots = [];
  let cursor = 0;
  for (let step = 0; step < steps; step += 1) {
    const t = step * stepSeconds;
    while (cursor < events.length && events[cursor].seconds <= t + 1e-9) {
      applyEvent(events[cursor]);
      cursor += 1;
    }
    snapshots.push(voices.map((v) => ({
      period: v.active ? v.period : 0,
      volume: v.active ? v.volume : 0,
      noise: v.active ? v.noise : 0,
    })));
    // Drums are one-shot: clear their voices so each hit lasts a single step.
    for (const dch of drumChannels) { voices[dch].active = false; voices[dch].volume = 0; voices[dch].noise = 0; }
  }

  const warnings = [];
  if (hasDrums) warnings.push('MIDI のドラム (10ch) は PSG ノイズ (ch4/5) で近似しました');
  if (stats.stolenVoices > 0 || stats.droppedNotes > 0) warnings.push('同時発音数が 6 を超えたため一部の音を間引きました');
  if (stats.clampedNotes > 0) warnings.push('音域外の音は period 範囲 (1..4095) にクランプされました');
  warnings.push('ピッチベンド / コントロールチェンジ / プログラムチェンジは再現されません');
  if (parsed.smpteDivision) warnings.push('SMPTE 分解能のため tempo を無視して実時間で量子化しました');
  if (parsed.format === 2) warnings.push('format 2 の独立トラックは連結して近似しました');
  if (parsed.tempoMap.length > 1) warnings.push(`テンポ変化が複数あるため最初のテンポ (${midiBpm} BPM) でグリッドを固定しました`);

  return assembleConversion(snapshots, {
    bpm,
    framesPerStep,
    stepSamples,
    sampleRate: SAMPLE_RATE,
    isSong: true, // MIDI files are usually tunes; default to a looping song.
    warnings,
    stats: {
      format: parsed.format,
      ntracks: parsed.ntrks,
      division: parsed.division,
      ppq: parsed.ppq,
      smpteDivision: parsed.smpteDivision,
      midiBpm,
      tempoChanges: parsed.tempoMap.length,
      noteCount: stats.noteCount,
      drumNotes: stats.drumNotes,
      stolenVoices: stats.stolenVoices,
      droppedNotes: stats.droppedNotes,
      clampedNotes: stats.clampedNotes,
      framesPerStep,
      durationSeconds: lastSeconds,
    },
  });
}

module.exports = {
  PSG_CLOCK,
  midiNoteToPeriod,
  drumNoteToNoiseFreq,
  parseSmf,
  convertMidiToPsg,
};
