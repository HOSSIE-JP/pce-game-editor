#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') args.help = true;
    else if (key.startsWith('--')) {
      const value = argv[index + 1];
      if (value == null || value.startsWith('--')) throw new Error(`missing value for ${key}`);
      args[key.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unexpected argument: ${key}`);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node compose-pce-psg.js --score <score.json> --out <output-dir>',
    '',
    'Writes exactly one <id>.psg.json file.',
  ].join('\n');
}

function requireInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function noteNameToMidi(value) {
  const match = String(value || '').trim().match(/^([A-Ga-g])([#b]?)(-?\d)$/);
  if (!match) throw new Error(`invalid note name: ${value}`);
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semitone = semitones[match[1].toUpperCase()];
  if (match[2] === '#') semitone += 1;
  if (match[2] === 'b') semitone -= 1;
  const midi = ((Number(match[3]) + 1) * 12) + semitone;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new Error(`note is outside MIDI 0..127: ${value}`);
  }
  return midi;
}

function midiNotePeriod(midi) {
  const frequency = 440 * (2 ** ((midi - 69) / 12));
  return Math.round(3579545 / (32 * frequency));
}

function eventStart(event, stepsPerBar, label) {
  if (event.start != null) return requireInteger(event.start, 0, 4095, `${label}.start`);
  const bar = requireInteger(event.bar, 1, 4096, `${label}.bar`);
  const offset = requireInteger(event.offset == null ? 0 : event.offset, 0, stepsPerBar - 1, `${label}.offset`);
  return ((bar - 1) * stepsPerBar) + offset;
}

function expandTrackEvents(track, stepsPerBar, totalSteps, trackIndex) {
  if (!Array.isArray(track.events)) throw new Error(`tracks[${trackIndex}].events must be an array`);
  const expanded = [];
  track.events.forEach((source, sourceIndex) => {
    const label = `tracks[${trackIndex}].events[${sourceIndex}]`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`${label} must be an object`);
    const initialStart = eventStart(source, stepsPerBar, label);
    const duration = requireInteger(source.duration, 1, 4096, `${label}.duration`);
    const repeatEvery = source.repeatEvery == null ? 0 : requireInteger(source.repeatEvery, 1, 4096, `${label}.repeatEvery`);
    const repeatCount = source.repeatCount == null ? 1 : requireInteger(source.repeatCount, 1, 4096, `${label}.repeatCount`);
    for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
      const start = initialStart + (repeatEvery * repeatIndex);
      if (start + duration > totalSteps) throw new Error(`${label} extends beyond the song at repeat ${repeatIndex + 1}`);
      const event = {
        start,
        duration,
        volume: requireInteger(source.volume, 0, 31, `${label}.volume`),
        sourceIndex,
      };
      if (source.noise != null) {
        event.noiseValue = requireInteger(source.noise, 1, 31, `${label}.noise`);
      } else if (source.period != null) {
        event.period = requireInteger(source.period, 1, 4095, `${label}.period`);
      } else {
        event.note = String(source.note || '').trim();
        event.period = requireInteger(midiNotePeriod(noteNameToMidi(event.note)), 1, 4095, `${label}.note period`);
      }
      event.wave = source.wave == null ? track.wave : source.wave;
      if (event.noiseValue == null) event.wave = requireInteger(event.wave == null ? 45 : event.wave, 0, 45, `${label}.wave`);
      expanded.push(event);
    }
  });
  expanded.sort((a, b) => (a.start - b.start) || (a.sourceIndex - b.sourceIndex));
  for (let index = 1; index < expanded.length; index += 1) {
    const previous = expanded[index - 1];
    const current = expanded[index];
    if (current.start < previous.start + previous.duration) {
      throw new Error(`tracks[${trackIndex}] has overlapping events at steps ${previous.start} and ${current.start}`);
    }
  }
  return expanded;
}

function buildDocument(score) {
  if (!score || typeof score !== 'object' || Array.isArray(score)) throw new Error('score root must be an object');
  if (score.version !== 1) throw new Error('score version must be 1');
  const metadata = score.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata must be an object');
  const id = String(metadata.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) throw new Error('metadata.id must use 1..48 letters, numbers, _ or -');
  const name = String(metadata.name || id).trim() || id;
  const type = metadata.type === 'psg-song' ? 'psg-song' : metadata.type === 'psg-sfx' ? 'psg-sfx' : '';
  if (!type) throw new Error('metadata.type must be psg-song or psg-sfx');
  const bpm = requireInteger(metadata.bpm, 30, 300, 'metadata.bpm');
  const bars = requireInteger(metadata.bars, 1, 4096, 'metadata.bars');
  const stepsPerBar = requireInteger(metadata.stepsPerBar, 1, 4096, 'metadata.stepsPerBar');
  const totalSteps = bars * stepsPerBar;
  requireInteger(totalSteps, 1, 4096, 'total steps');
  const masterVolume = requireInteger(metadata.volume == null ? 100 : metadata.volume, 0, 100, 'metadata.volume');
  const loop = Boolean(metadata.loop);
  if (type === 'psg-song' && !loop) throw new Error('psg-song must set metadata.loop to true');
  if (type === 'psg-sfx' && loop) throw new Error('psg-sfx must set metadata.loop to false');

  const sections = Array.isArray(metadata.sections) ? metadata.sections.map((section, index) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error(`metadata.sections[${index}] must be an object`);
    const startBar = requireInteger(section.startBar, 1, bars, `metadata.sections[${index}].startBar`);
    const endBar = requireInteger(section.endBar, startBar, bars, `metadata.sections[${index}].endBar`);
    return {
      name: String(section.name || `Section ${index + 1}`),
      startBar,
      endBar,
      startStep: (startBar - 1) * stepsPerBar,
    };
  }) : [];
  if (sections.length) {
    if (sections[0].startBar !== 1 || sections[sections.length - 1].endBar !== bars) {
      throw new Error('sections must cover the first through final bar');
    }
    for (let index = 1; index < sections.length; index += 1) {
      if (sections[index].startBar !== sections[index - 1].endBar + 1) {
        throw new Error('sections must be contiguous and ordered');
      }
    }
  }

  if (!Array.isArray(score.tracks) || !score.tracks.length) throw new Error('tracks must contain at least one track');
  const channels = new Set();
  const pattern = [];
  score.tracks.forEach((track, trackIndex) => {
    if (!track || typeof track !== 'object' || Array.isArray(track)) throw new Error(`tracks[${trackIndex}] must be an object`);
    const channel = requireInteger(track.channel, 0, 5, `tracks[${trackIndex}].channel`);
    if (channels.has(channel)) throw new Error(`channel ${channel} is assigned to more than one track`);
    channels.add(channel);
    const events = expandTrackEvents(track, stepsPerBar, totalSteps, trackIndex);
    if (events.some((event) => event.noiseValue != null) && channel !== 4 && channel !== 5) {
      throw new Error(`noise track ${trackIndex} must use channel 4 or 5`);
    }
    events.forEach((event, eventIndex) => {
      const next = events[eventIndex + 1];
      const base = {
        step: event.start,
        channel,
        period: event.noiseValue == null ? event.period : event.noiseValue,
        volume: event.volume,
      };
      if (event.note) base.note = event.note;
      if (event.noiseValue != null) base.noise = 1;
      else base.wave = event.wave;
      pattern.push(base);
      const end = event.start + event.duration;
      if (end < totalSteps && (!next || next.start !== end)) {
        pattern.push({
          step: end,
          channel,
          period: base.period,
          volume: 0,
          ...(event.noiseValue != null ? { noise: 1 } : { wave: event.wave }),
        });
      }
    });
  });

  pattern.sort((a, b) => (a.step - b.step) || (a.channel - b.channel));
  if (pattern.length > 2048) throw new Error(`generated pattern has ${pattern.length} events (limit 2048)`);
  const occupied = new Set();
  pattern.forEach((event, index) => {
    const key = `${event.step}:${event.channel}`;
    if (occupied.has(key)) throw new Error(`generated pattern event ${index} duplicates ${key}`);
    occupied.add(key);
    requireInteger(event.step, 0, totalSteps - 1, `pattern[${index}].step`);
    requireInteger(event.channel, 0, 5, `pattern[${index}].channel`);
    requireInteger(event.period, 1, 4095, `pattern[${index}].period`);
    requireInteger(event.volume, 0, 31, `pattern[${index}].volume`);
    if (event.wave != null) requireInteger(event.wave, 0, 45, `pattern[${index}].wave`);
    if (event.noise && event.channel !== 4 && event.channel !== 5) throw new Error(`pattern[${index}] noise channel violation`);
  });

  const firstTone = pattern.find((event) => !event.noise && event.volume > 0);
  const asset = {
    id,
    type,
    name,
    source: '',
    options: {
      kind: type === 'psg-song' ? 'song' : 'sfx',
      bpm,
      speed: 6,
      period: firstTone?.period || 512,
      wave: firstTone?.wave == null ? 45 : firstTone.wave,
      channels: 6,
      steps: totalSteps,
      volume: masterVolume,
      loop,
      timeSignature: String(metadata.timeSignature || '4/4'),
      bars,
      stepsPerBar,
      sections,
      pattern,
    },
  };
  return { document: { version: 2, assets: [asset] }, asset, patternEvents: pattern.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.score || !args.out) throw new Error(`--score and --out are required\n${usage()}`);
  const scorePath = path.resolve(args.score);
  const outputDir = path.resolve(args.out);
  const result = buildDocument(JSON.parse(fs.readFileSync(scorePath, 'utf-8')));
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${result.asset.id}.psg.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(result.document, null, 2)}\n`, 'utf-8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    id: result.asset.id,
    name: result.asset.name,
    type: result.asset.type,
    bpm: result.asset.options.bpm,
    bars: result.asset.options.bars,
    steps: result.asset.options.steps,
    patternEvents: result.patternEvents,
    output: outputPath,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`compose-pce-psg: ${error?.message || error}\n`);
  process.exitCode = 1;
}
