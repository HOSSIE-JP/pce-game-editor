'use strict';

const NOTE_NAMES = Object.freeze({ C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 });
const SOURCE_TO_MOD_CHANNEL = Object.freeze([0, 1, 2, 1, 3, 3]);
const SOURCE_INSTRUMENT = Object.freeze([1, 2, 3, 2, 16, 18]);

function asciiBuffer(value, length) { const output = Buffer.alloc(length); Buffer.from(String(value || ''), 'ascii').copy(output, 0, 0, length); return output; }

function noteToPeriod(note, audit, context) {
  const match = /^([A-G](?:#)?)(-?\d+)$/u.exec(String(note || '').trim());
  if (!match) return 0;
  const semitone = NOTE_NAMES[match[1]]; const sourceOctave = Number(match[2]); let modOctave = sourceOctave - 1; let transposed = 0;
  while (modOctave < 1) { modOctave += 1; transposed += 12; }
  while (modOctave > 5) { modOctave -= 1; transposed -= 12; }
  if (transposed) audit.transposedEvents.push({ ...context, note, semitones: transposed, reason: 'ProTracker period range' });
  const midi = (modOctave + 1) * 12 + semitone; const period = Math.round(1712 * 2 ** ((36 - midi) / 12));
  return Math.max(57, Math.min(1712, period));
}

function eventBytes(event = {}) {
  const sample = Math.max(0, Math.min(31, Number(event.sample) || 0)); const period = Math.max(0, Math.min(0x0fff, Number(event.period) || 0)); const effect = Math.max(0, Math.min(15, Number(event.effect) || 0)); const param = Math.max(0, Math.min(255, Number(event.param) || 0));
  return Buffer.from([(sample & 0xf0) | ((period >> 8) & 0x0f), period & 0xff, ((sample & 0x0f) << 4) | effect, param]);
}

function chooseEvents(options, audit) {
  const steps = Math.max(1, Math.min(4096, Number(options.steps) || 1)); const byStepChannel = new Map();
  for (const source of options.pattern || []) {
    const step = Math.trunc(Number(source.step)); const sourceChannel = Math.trunc(Number(source.channel));
    if (step < 0 || step >= steps || sourceChannel < 0 || sourceChannel > 5) { audit.droppedEvents.push({ step, sourceChannel, reason: 'out-of-range-event', source }); continue; }
    const modChannel = SOURCE_TO_MOD_CHANNEL[sourceChannel]; const key = `${step}:${modChannel}`; const candidate = { source, step, sourceChannel, modChannel, volume: Math.max(0, Number(source.volume) || 0) };
    const previous = byStepChannel.get(key);
    if (!previous || candidate.volume > previous.volume || (candidate.volume === previous.volume && sourceChannel < previous.sourceChannel)) {
      if (previous) audit.droppedEvents.push({ step, sourceChannel: previous.sourceChannel, modChannel, reason: 'channel-conflict', keptSourceChannel: sourceChannel, source: previous.source });
      byStepChannel.set(key, candidate);
    } else audit.droppedEvents.push({ step, sourceChannel, modChannel, reason: 'channel-conflict', keptSourceChannel: previous.sourceChannel, source });
  }
  return { steps, events: [...byStepChannel.values()] };
}

function buildSegments(steps, loopPoint) {
  const boundaries = new Set([0, steps]); for (let step = 64; step < steps; step += 64) boundaries.add(step); if (loopPoint > 0 && loopPoint < steps) boundaries.add(loopPoint);
  const sorted = [...boundaries].sort((a, b) => a - b); const segments = [];
  for (let index = 0; index + 1 < sorted.length; index += 1) { let start = sorted[index]; const end = sorted[index + 1]; while (start < end) { const next = Math.min(end, start + 64); segments.push({ start, end: next }); start = next; } }
  return segments;
}

function putControl(patternRows, row, effect, param, audit, label) {
  for (let channel = 3; channel >= 0; channel -= 1) {
    const current = patternRows[row][channel];
    if (!current.effect) { patternRows[row][channel] = { ...current, effect, param }; return; }
  }
  const replaced = patternRows[row][3]; audit.controlConflicts.push({ row, label, replaced }); patternRows[row][3] = { ...replaced, effect, param };
}

function convertPsgToMod(asset) {
  const options = asset.options || {}; const audit = { assetId: asset.id, sourceChannels: 6, targetChannels: 4, sourceEvents: (options.pattern || []).length, emittedEvents: 0, droppedEvents: [], transposedEvents: [], controlConflicts: [] };
  const chosen = chooseEvents(options, audit); const loopEnabled = options.loop !== false; const loopPoint = Math.max(0, Math.min(chosen.steps - 1, Math.trunc(Number(options.loopPoint ?? options.loopStep) || 0))); const segments = buildSegments(chosen.steps, loopPoint);
  if (segments.length > 128) { const error = new Error(`MOD order数が128を超えます: ${asset.id}`); error.code = 'GBVN_PSG_EVENT_DROPPED'; throw error; }
  const segmentForStep = (step) => segments.findIndex((segment) => step >= segment.start && step < segment.end); const patterns = segments.map(() => Array.from({ length: 64 }, () => Array.from({ length: 4 }, () => ({}))));
  chosen.events.forEach((entry) => {
    const patternIndex = segmentForStep(entry.step); if (patternIndex < 0) return; const row = entry.step - segments[patternIndex].start; const source = entry.source; const volume = Math.max(0, Number(source.volume) || 0); const period = volume > 0 ? noteToPeriod(source.note, audit, { step: entry.step, sourceChannel: entry.sourceChannel }) : 0;
    const converted = { sample: volume > 0 ? SOURCE_INSTRUMENT[entry.sourceChannel] : 0, period };
    if (Number.isFinite(Number(source.volume))) { converted.effect = 0x0c; converted.param = Math.max(0, Math.min(64, Math.round(volume * 64 / 31))); }
    patterns[patternIndex][row][entry.modChannel] = converted; audit.emittedEvents += 1;
  });
  if (patterns.length) {
    putControl(patterns[0], 0, 0x0f, Math.max(32, Math.min(255, Math.round(Number(options.bpm) || 150))), audit, 'tempo');
    const speed = Math.max(1, Math.min(31, Math.round(Number(options.speed) || 6))); if (speed !== 6) putControl(patterns[0], 0, 0x0f, speed, audit, 'speed');
  }
  segments.forEach((segment, index) => { const row = Math.max(0, segment.end - segment.start - 1); if (index + 1 < segments.length && segment.end - segment.start < 64) putControl(patterns[index], row, 0x0d, 0x00, audit, 'short-pattern-next'); });
  if (loopEnabled && patterns.length) { const loopOrder = Math.max(0, segmentForStep(loopPoint)); const last = segments.length - 1; const row = Math.max(0, segments[last].end - segments[last].start - 1); putControl(patterns[last], row, 0x0b, loopOrder, audit, 'loop'); }

  const headers = [asciiBuffer(asset.name || asset.id || 'PCE PSG', 20)];
  for (let instrument = 1; instrument <= 31; instrument += 1) { const header = Buffer.alloc(30); asciiBuffer(`GB ${instrument}`, 22).copy(header); header[24] = 0; header[25] = 64; headers.push(header); }
  const song = Buffer.alloc(130); song[0] = Math.max(1, patterns.length); song[1] = 0x7f; segments.forEach((segment, index) => { song[2 + index] = index; });
  const patternData = [];
  patterns.forEach((rows) => rows.forEach((row) => row.forEach((event) => patternData.push(eventBytes(event)))));
  const buffer = Buffer.concat([...headers, song, Buffer.from('M.K.', 'ascii'), ...patternData]);
  audit.steps = chosen.steps; audit.loop = { enabled: loopEnabled, sourceStep: loopPoint, targetOrder: segmentForStep(loopPoint) }; audit.patterns = patterns.length; audit.bytes = buffer.length; audit.status = audit.droppedEvents.length || audit.transposedEvents.length || audit.controlConflicts.length ? 'warning' : 'exact';
  return { buffer, audit };
}

module.exports = { SOURCE_INSTRUMENT, SOURCE_TO_MOD_CHANNEL, buildSegments, convertPsgToMod, eventBytes, noteToPeriod };
