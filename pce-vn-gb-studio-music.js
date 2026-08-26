'use strict';

const crypto = require('node:crypto');

const PCE_CLOCK = 3579545;
const TARGET_ROLES = Object.freeze(['pulse1', 'pulse2', 'wave', 'noise']);
const ROLE_TO_CHANNEL = Object.freeze({ pulse1: 0, pulse2: 1, wave: 2, noise: 3 });
const PERIOD_TO_CODE = Object.freeze([
  1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 907,
  856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
  428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
  107, 101, 95, 90, 85, 80, 75, 71, 67, 63, 60, 56, 53, 50,
  47, 45, 42, 40, 37, 35, 33, 31, 30, 28,
]);
const NOTE_BASE = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const NOTE_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
const SINE_WAVES = new Set([1, 8, 13]);
const SAW_WAVES = new Set([2, 5, 11, 30, 35, 43]);
const TRIANGLE_WAVES = new Set([6, 20, 22, 24, 25, 31]);

function asciiBuffer(value, length) { const output = Buffer.alloc(length); Buffer.from(String(value || ''), 'ascii').copy(output, 0, 0, length); return output; }
function clampNumber(value, min, max, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; }
function clampInt(value, min, max, fallback) { return Math.trunc(clampNumber(value, min, max, fallback)); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function normalizeNote(note) {
  const source = String(note || '').trim().normalize('NFKC').replace(/♯/gu, '#').replace(/♭/gu, 'b');
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/u.exec(source);
  if (!match) return null;
  let semitone = NOTE_BASE[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  let octave = Number(match[3]);
  while (semitone < 0) { semitone += 12; octave -= 1; }
  while (semitone >= 12) { semitone -= 12; octave += 1; }
  return { source, canonical: `${NOTE_NAMES[semitone]}${octave}`, semitone, octave, code: (octave - 2) * 12 + semitone };
}

function foldCodeToRange(code) {
  let value = Math.trunc(code); let adjustment = 0;
  while (value < 0) { value += 12; adjustment += 12; }
  while (value >= PERIOD_TO_CODE.length) { value -= 12; adjustment -= 12; }
  return { code: value, adjustment };
}

function noteToPeriod(note, audit = {}, context = {}) {
  const parsed = normalizeNote(note);
  if (!parsed) return 0;
  audit.normalizedNotes ||= [];
  audit.transposedEvents ||= [];
  if (parsed.source !== parsed.canonical) audit.normalizedNotes.push({ ...context, source: parsed.source, normalized: parsed.canonical });
  const folded = foldCodeToRange(parsed.code);
  if (folded.adjustment) audit.transposedEvents.push({ ...context, note: parsed.source, semitones: folded.adjustment, reason: 'GB Studio 4.3.x period range' });
  return PERIOD_TO_CODE[folded.code];
}

function nearestPeriod(period) {
  const source = Number(period);
  if (!Number.isFinite(source) || source <= 0) return null;
  let bestCode = 0; let bestCents = Infinity;
  PERIOD_TO_CODE.forEach((candidate, code) => {
    const cents = 1200 * Math.log2(source / candidate);
    if (Math.abs(cents) < Math.abs(bestCents)) { bestCode = code; bestCents = cents; }
  });
  return { code: bestCode, period: PERIOD_TO_CODE[bestCode], cents: bestCents };
}

function normalizeMusicTrackSettings(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const channels = {};
  for (let channel = 0; channel < 6; channel += 1) {
    const source = raw.channels?.[channel] && typeof raw.channels[channel] === 'object' ? raw.channels[channel] : {};
    const target = ['auto', 'pulse1', 'pulse2', 'wave', 'noise', 'mute'].includes(source.target) ? source.target : 'auto';
    const instrumentValue = Number(source.instrument);
    channels[channel] = {
      target,
      instrument: source.instrument === 'auto' || !Number.isFinite(instrumentValue) ? 'auto' : clampInt(instrumentValue, 1, 31, 1),
      volumeScale: clampInt(source.volumeScale, 0, 200, 100),
      transpose: clampInt(source.transpose, -24, 24, 0),
      priority: clampInt(source.priority, 0, 100, 50),
    };
  }
  return { tempoScale: clampInt(raw.tempoScale, 50, 200, 100), channels };
}

function waveFamily(wave) {
  const value = clampInt(wave, 0, 45, 45);
  if (SINE_WAVES.has(value)) return 'sine';
  if (SAW_WAVES.has(value)) return 'saw';
  if (TRIANGLE_WAVES.has(value)) return 'triangle';
  return 'square';
}

function eventBytes(event = {}) {
  const sample = Math.max(0, Math.min(31, Number(event.sample) || 0)); const period = Math.max(0, Math.min(0x0fff, Number(event.period) || 0)); const effect = Math.max(0, Math.min(15, Number(event.effect) || 0)); const param = Math.max(0, Math.min(255, Number(event.param) || 0));
  return Buffer.from([(sample & 0xf0) | ((period >> 8) & 0x0f), period & 0xff, ((sample & 0x0f) << 4) | effect, param]);
}

function analyzeChannels(options, settings) {
  const steps = Math.max(1, Math.min(4096, Number(options.steps) || 1));
  return Array.from({ length: 6 }, (_, channel) => {
    const events = (options.pattern || []).filter((entry) => Math.trunc(Number(entry?.channel)) === channel).sort((a, b) => Number(a.step) - Number(b.step));
    const familyWeights = { sine: 0, saw: 0, triangle: 0, square: 0 }; let activity = 0; let pitchWeighted = 0; let pitchWeight = 0; let noiseWeight = 0;
    events.forEach((entry, index) => {
      const volume = Math.max(0, Number(entry.volume) || 0); if (!volume) return;
      const step = Math.max(0, Math.min(steps - 1, Math.trunc(Number(entry.step) || 0))); const nextStep = Math.max(step + 1, Math.min(steps, Math.trunc(Number(events[index + 1]?.step) || steps))); const duration = Math.max(1, nextStep - step); const weight = volume * duration;
      activity += weight;
      if (entry.noise) noiseWeight += weight;
      else {
        familyWeights[waveFamily(entry.wave)] += weight;
        const pitch = nearestPeriod(entry.period) || (normalizeNote(entry.note) ? { code: foldCodeToRange(normalizeNote(entry.note).code).code } : null);
        if (pitch) { pitchWeighted += pitch.code * weight; pitchWeight += weight; }
      }
    });
    const family = Object.entries(familyWeights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][1] ? Object.entries(familyWeights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] : 'square';
    return { sourceChannel: channel, activity, isNoise: noiseWeight > 0 && noiseWeight >= activity / 2, family, averageCode: pitchWeight ? pitchWeighted / pitchWeight : 36, priority: settings.channels[channel].priority, events: events.length };
  });
}

function assignmentCost(analysis, role) {
  if (analysis.isNoise) return role === 'noise' ? 0 : 1000;
  if (role === 'noise') return 1000;
  if (role === 'wave') return analysis.family === 'square' ? 4 : Math.max(0, (analysis.averageCode - 36) / 200);
  if (analysis.family === 'square') return 0;
  if (analysis.family === 'saw') return 3;
  return 1;
}

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const output = [];
  values.forEach((value, index) => permutations(values.filter((_, at) => at !== index)).forEach((tail) => output.push([value, ...tail])));
  return output;
}

function assignChannels(options, settings, audit) {
  const analyses = analyzeChannels(options, settings); const assignments = Array(6).fill(null); const occupied = new Set();
  for (const analysis of analyses) {
    const configured = settings.channels[analysis.sourceChannel];
    if (configured.target === 'mute') assignments[analysis.sourceChannel] = { ...analysis, ...configured, target: 'mute', mode: 'manual' };
    else if (configured.target !== 'auto') { assignments[analysis.sourceChannel] = { ...analysis, ...configured, target: configured.target, mode: 'manual' }; occupied.add(configured.target); }
  }
  const autos = analyses.filter((analysis) => !assignments[analysis.sourceChannel] && analysis.activity > 0);
  const noise = autos.filter((analysis) => analysis.isNoise).sort((a, b) => b.priority - a.priority || b.activity - a.activity || a.sourceChannel - b.sourceChannel);
  if (!occupied.has('noise') && noise.length) { const selected = noise.shift(); assignments[selected.sourceChannel] = { ...selected, ...settings.channels[selected.sourceChannel], target: 'noise', mode: 'auto' }; occupied.add('noise'); }
  noise.forEach((analysis) => { assignments[analysis.sourceChannel] = { ...analysis, ...settings.channels[analysis.sourceChannel], target: 'mute', mode: 'auto-capacity' }; });
  const roles = ['pulse1', 'pulse2', 'wave'].filter((role) => !occupied.has(role));
  const tones = autos.filter((analysis) => !analysis.isNoise).sort((a, b) => b.priority - a.priority || b.activity - a.activity || a.sourceChannel - b.sourceChannel);
  const selected = tones.splice(0, roles.length);
  if (selected.length) {
    let best = null;
    for (const roleOrder of permutations(roles).map((entry) => entry.slice(0, selected.length))) {
      const cost = selected.reduce((sum, analysis, index) => sum + assignmentCost(analysis, roleOrder[index]), 0); const identity = roleOrder.join(',');
      if (!best || cost < best.cost || (cost === best.cost && identity < best.identity)) best = { roleOrder, cost, identity };
    }
    selected.forEach((analysis, index) => { assignments[analysis.sourceChannel] = { ...analysis, ...settings.channels[analysis.sourceChannel], target: best.roleOrder[index], mode: 'auto' }; });
  }
  tones.forEach((analysis) => { assignments[analysis.sourceChannel] = { ...analysis, ...settings.channels[analysis.sourceChannel], target: 'mute', mode: 'auto-capacity' }; });
  analyses.forEach((analysis) => { if (!assignments[analysis.sourceChannel]) assignments[analysis.sourceChannel] = { ...analysis, ...settings.channels[analysis.sourceChannel], target: 'mute', mode: 'idle' }; });
  for (const role of TARGET_ROLES) {
    const users = assignments.filter((entry) => entry.target === role);
    if (users.length > 1) audit.channelConflicts.push({ target: role, sourceChannels: users.map((entry) => entry.sourceChannel), reason: 'multiple-source-channels-forced-to-one-target' });
  }
  audit.channelAssignments = assignments.map((entry) => ({ sourceChannel: entry.sourceChannel, target: entry.target, targetChannel: ROLE_TO_CHANNEL[entry.target] ?? -1, mode: entry.mode, activity: entry.activity, family: entry.family, priority: entry.priority, volumeScale: entry.volumeScale, transpose: entry.transpose, instrument: entry.instrument }));
  return assignments;
}

function pitchForEvent(source, assignment, audit, context) {
  const parsed = normalizeNote(source.note);
  if (parsed && parsed.source !== parsed.canonical) audit.normalizedNotes.push({ ...context, source: parsed.source, normalized: parsed.canonical });
  let nearest = nearestPeriod(source.period); let origin = 'period';
  if (!nearest && parsed) { const folded = foldCodeToRange(parsed.code); nearest = { code: folded.code, period: PERIOD_TO_CODE[folded.code], cents: 0 }; origin = 'note'; if (folded.adjustment) audit.transposedEvents.push({ ...context, note: parsed.source, semitones: folded.adjustment, reason: 'GB Studio 4.3.x period range' }); }
  if (!nearest) { const error = new Error(`${context.assetId}: step ${context.step} channel ${context.sourceChannel} に有効なperiod/noteがありません`); error.code = 'GBVN_PSG_INVALID_NOTE'; throw error; }
  if (parsed) {
    const parsedCode = foldCodeToRange(parsed.code).code;
    if (parsedCode !== nearest.code) audit.noteDisagreements.push({ ...context, note: parsed.source, noteCode: parsedCode, period: Number(source.period), periodCode: nearest.code });
  }
  const transposed = foldCodeToRange(nearest.code + assignment.transpose);
  if (assignment.transpose || transposed.adjustment) audit.transposedEvents.push({ ...context, semitones: assignment.transpose + transposed.adjustment, requestedSemitones: assignment.transpose, rangeAdjustment: transposed.adjustment, reason: assignment.transpose ? 'manual transpose' : 'GB Studio 4.3.x period range' });
  const targetPeriod = PERIOD_TO_CODE[transposed.code]; const sourcePeriod = Number(source.period) > 0 ? Number(source.period) : PERIOD_TO_CODE[nearest.code]; const centsError = 1200 * Math.log2(sourcePeriod / targetPeriod) - assignment.transpose * 100;
  const detail = { ...context, origin, note: source.note || '', normalizedNote: parsed?.canonical || '', sourcePeriod, targetPeriod, sourceCode: nearest.code, targetCode: transposed.code, centsError };
  audit.pitchEvents.push(detail);
  if (sourcePeriod !== targetPeriod || Math.abs(centsError) > 0.01) audit.pitchQuantizedEvents.push(detail);
  return { period: targetPeriod, code: transposed.code, centsError };
}

function automaticInstrument(source, assignment) {
  if (assignment.target === 'noise') {
    const white = source.noiseMode === 'white' || source.whiteNoise === true; const base = white ? 24 : 16; return base + Math.max(0, Math.min(7, Math.round((Number(source.period) & 31) * 7 / 31)));
  }
  const family = waveFamily(source.wave);
  if (assignment.target === 'wave') return { sine: 15, saw: 13, triangle: 12, square: 14 }[family];
  return family === 'saw' ? 1 : family === 'square' ? 2 : 2;
}

function instrumentForEvent(source, assignment, audit, context) {
  const automatic = automaticInstrument(source, assignment); if (assignment.instrument === 'auto') return automatic;
  const requested = Number(assignment.instrument); const [min, max] = assignment.target === 'noise' ? [16, 31] : assignment.target === 'wave' ? [8, 15] : [1, 4]; const value = clampInt(requested, min, max, automatic);
  if (value !== requested) audit.instrumentAdjustments.push({ ...context, requested, selected: value, target: assignment.target });
  return value;
}

function chooseEvents(options, trackSettings, audit, assetId = '') {
  const steps = Math.max(1, Math.min(4096, Number(options.steps) || 1)); const assignments = assignChannels(options, trackSettings, audit); const byStepChannel = new Map(); const assetVolume = clampNumber(options.volume, 0, 100, 100);
  for (const source of options.pattern || []) {
    const step = Math.trunc(Number(source.step)); const sourceChannel = Math.trunc(Number(source.channel));
    if (step < 0 || step >= steps || sourceChannel < 0 || sourceChannel > 5) { audit.droppedEvents.push({ step, sourceChannel, reason: 'out-of-range-event', source }); continue; }
    const assignment = assignments[sourceChannel]; const sourceVolume = Math.max(0, Number(source.volume) || 0);
    if (assignment.target === 'mute') { if (sourceVolume > 0) audit.droppedEvents.push({ step, sourceChannel, reason: assignment.mode === 'manual' ? 'manual-mute' : 'target-channel-capacity', source }); continue; }
    const targetChannel = ROLE_TO_CHANNEL[assignment.target]; const volume = Math.max(0, Math.min(31, Math.round(sourceVolume * assetVolume / 100 * assignment.volumeScale / 100))); const context = { assetId, step, sourceChannel, target: assignment.target, targetChannel };
    const pitch = volume > 0 ? pitchForEvent(source, assignment, audit, context) : { period: 0, code: null, centsError: 0 }; const instrument = volume > 0 ? instrumentForEvent(source, assignment, audit, context) : 0; const family = waveFamily(source.wave);
    if (volume > 0) audit.waveSubstitutions.push({ ...context, sourceWave: Number(source.wave ?? 45), family, instrument, target: assignment.target });
    const candidate = { source, step, sourceChannel, targetChannel, target: assignment.target, volume, period: pitch.period, code: pitch.code, instrument, priority: assignment.priority, family };
    const key = `${step}:${targetChannel}`; const previous = byStepChannel.get(key);
    if (!previous || candidate.priority > previous.priority || (candidate.priority === previous.priority && candidate.volume > previous.volume) || (candidate.priority === previous.priority && candidate.volume === previous.volume && sourceChannel < previous.sourceChannel)) {
      if (previous) audit.droppedEvents.push({ step, sourceChannel: previous.sourceChannel, targetChannel, reason: 'channel-conflict', keptSourceChannel: sourceChannel, source: previous.source });
      byStepChannel.set(key, candidate);
    } else audit.droppedEvents.push({ step, sourceChannel, targetChannel, reason: 'channel-conflict', keptSourceChannel: previous.sourceChannel, source });
  }
  const events = [...byStepChannel.values()].sort((a, b) => a.step - b.step || a.targetChannel - b.targetChannel || a.sourceChannel - b.sourceChannel);
  audit.mappedEvents = events.map((entry) => ({ step: entry.step, sourceChannel: entry.sourceChannel, targetChannel: entry.targetChannel, target: entry.target, volume: entry.volume, period: entry.period, instrument: entry.instrument }));
  return { steps, events, assignments };
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

function targetWaveform(target, instrument) {
  if (target === 'noise') return 'noise';
  if (target !== 'wave') return 'square';
  return instrument === 15 ? 'sine' : instrument === 13 ? 'sawtooth' : instrument === 12 ? 'triangle' : 'square';
}

function buildTargetPreview(chosen, options, settings, loopPoint) {
  const byStep = Array.from({ length: chosen.steps }, () => []);
  chosen.events.forEach((entry) => byStep[entry.step].push(entry));
  const state = Array.from({ length: 4 }, (_, channel) => ({ channel, target: TARGET_ROLES[channel], period: 0, frequency: 0, volume: 0, instrument: 0, waveform: channel === 3 ? 'noise' : 'square', noise: channel === 3 }));
  const rows = byStep.map((entries) => {
    entries.forEach((entry) => { state[entry.targetChannel] = { channel: entry.targetChannel, target: entry.target, period: entry.period, frequency: entry.period ? PCE_CLOCK / (32 * entry.period) : 0, volume: entry.volume, instrument: entry.instrument, waveform: targetWaveform(entry.target, entry.instrument), noise: entry.target === 'noise' }; });
    return state.map((cell) => ({ ...cell }));
  });
  return { kind: 'gb-studio-approximation', steps: chosen.steps, bpm: Math.max(32, Math.min(255, Math.round((Number(options.bpm) || 150) * settings.tempoScale / 100))), loop: options.loop !== false, loopPoint, rows };
}

function buildPsgSourcePreview(asset) {
  const options = asset?.options || {}; const steps = Math.max(1, Math.min(4096, Number(options.steps) || 1)); const byStep = Array.from({ length: steps }, () => []); const master = clampNumber(options.volume, 0, 100, 100);
  for (const source of options.pattern || []) { const step = Math.trunc(Number(source.step)); const channel = Math.trunc(Number(source.channel)); if (step >= 0 && step < steps && channel >= 0 && channel < 6) byStep[step].push(source); }
  const state = Array.from({ length: 6 }, (_, channel) => ({ channel, period: 0, frequency: 0, volume: 0, wave: 45, waveform: 'square', noise: channel >= 4 }));
  const rows = byStep.map((entries) => {
    entries.forEach((entry) => { const channel = Math.trunc(Number(entry.channel)); const period = Number(entry.period) > 0 ? Number(entry.period) : noteToPeriod(entry.note); const noise = Boolean(entry.noise); const family = waveFamily(entry.wave); state[channel] = { channel, period, frequency: period ? PCE_CLOCK / (32 * period) : 0, volume: Math.max(0, Math.min(31, Math.round((Number(entry.volume) || 0) * master / 100))), wave: Number(entry.wave ?? 45), waveform: noise ? 'noise' : family === 'saw' ? 'sawtooth' : family, noise }; });
    return state.map((cell) => ({ ...cell }));
  });
  return { kind: 'pce-source-approximation', steps, bpm: Math.max(30, Math.min(300, Number(options.bpm) || 150)), loop: options.loop !== false, loopPoint: Math.max(0, Math.min(steps - 1, Math.trunc(Number(options.loopPoint ?? options.loopStep) || 0))), rows };
}

function convertPsgToMod(asset, rawSettings = {}) {
  const options = asset.options || {}; const settings = normalizeMusicTrackSettings(rawSettings);
  const audit = { assetId: asset.id, sourceChannels: 6, targetChannels: 4, sourceEvents: (options.pattern || []).length, emittedEvents: 0, mappedEvents: [], droppedEvents: [], normalizedNotes: [], noteDisagreements: [], pitchEvents: [], pitchQuantizedEvents: [], transposedEvents: [], waveSubstitutions: [], instrumentAdjustments: [], channelAssignments: [], channelConflicts: [], controlConflicts: [], settings };
  const chosen = chooseEvents(options, settings, audit, asset.id); const loopEnabled = options.loop !== false; const loopPoint = Math.max(0, Math.min(chosen.steps - 1, Math.trunc(Number(options.loopPoint ?? options.loopStep) || 0))); const segments = buildSegments(chosen.steps, loopPoint);
  audit.sourceHash = sha256(Buffer.from(JSON.stringify({ options, settings }), 'utf-8')); audit.normalizedEventHash = sha256(Buffer.from(JSON.stringify(audit.mappedEvents), 'utf-8'));
  if (segments.length > 128) { const error = new Error(`MOD order数が128を超えます: ${asset.id}`); error.code = 'GBVN_PSG_EVENT_DROPPED'; throw error; }
  const segmentForStep = (step) => segments.findIndex((segment) => step >= segment.start && step < segment.end); const patterns = segments.map(() => Array.from({ length: 64 }, () => Array.from({ length: 4 }, () => ({}))));
  chosen.events.forEach((entry) => {
    const patternIndex = segmentForStep(entry.step); if (patternIndex < 0) return; const row = entry.step - segments[patternIndex].start; const converted = { sample: entry.volume > 0 ? entry.instrument : 0, period: entry.volume > 0 ? entry.period : 0 };
    converted.effect = 0x0c; converted.param = Math.max(0, Math.min(64, Math.round(entry.volume * 64 / 31))); patterns[patternIndex][row][entry.targetChannel] = converted; audit.emittedEvents += 1;
  });
  const targetBpm = Math.max(32, Math.min(255, Math.round((Number(options.bpm) || 150) * settings.tempoScale / 100)));
  if (patterns.length) {
    putControl(patterns[0], 0, 0x0f, targetBpm, audit, 'tempo');
    const speed = Math.max(1, Math.min(31, Math.round(Number(options.speed) || 6))); if (speed !== 6) putControl(patterns[0], 0, 0x0f, speed, audit, 'speed');
  }
  segments.forEach((segment, index) => { const row = Math.max(0, segment.end - segment.start - 1); if (index + 1 < segments.length && segment.end - segment.start < 64) putControl(patterns[index], row, 0x0d, 0x00, audit, 'short-pattern-next'); });
  if (loopEnabled && patterns.length) { const loopOrder = Math.max(0, segmentForStep(loopPoint)); const last = segments.length - 1; const row = Math.max(0, segments[last].end - segments[last].start - 1); putControl(patterns[last], row, 0x0b, loopOrder, audit, 'loop'); }

  const headers = [asciiBuffer(asset.name || asset.id || 'PCE PSG', 20)];
  for (let instrument = 1; instrument <= 31; instrument += 1) { const header = Buffer.alloc(30); asciiBuffer(`GB ${instrument}`, 22).copy(header); header[24] = 0; header[25] = 64; headers.push(header); }
  const song = Buffer.alloc(130); song[0] = Math.max(1, patterns.length); song[1] = 0x7f; segments.forEach((segment, index) => { song[2 + index] = index; });
  const patternData = []; patterns.forEach((rows) => rows.forEach((row) => row.forEach((item) => patternData.push(eventBytes(item)))));
  const buffer = Buffer.concat([...headers, song, Buffer.from('M.K.', 'ascii'), ...patternData]); const preview = buildTargetPreview(chosen, options, settings, loopPoint);
  audit.steps = chosen.steps; audit.sourceBpm = Number(options.bpm) || 150; audit.targetBpm = targetBpm; audit.tempoScale = settings.tempoScale; audit.loop = { enabled: loopEnabled, sourceStep: loopPoint, targetOrder: segmentForStep(loopPoint) }; audit.patterns = patterns.length; audit.bytes = buffer.length; audit.outputHash = sha256(buffer); audit.timingErrorRows = 0;
  const hasWarning = audit.droppedEvents.length || audit.channelConflicts.length || audit.controlConflicts.length; const hasApproximation = audit.pitchQuantizedEvents.length || audit.waveSubstitutions.length || audit.transposedEvents.length || settings.tempoScale !== 100;
  audit.status = hasWarning ? 'warning' : hasApproximation ? 'approximated' : 'exact';
  return { buffer, audit, preview };
}

module.exports = { PERIOD_TO_CODE, ROLE_TO_CHANNEL, TARGET_ROLES, buildPsgSourcePreview, buildSegments, convertPsgToMod, eventBytes, nearestPeriod, normalizeMusicTrackSettings, normalizeNote, noteToPeriod, waveFamily };
