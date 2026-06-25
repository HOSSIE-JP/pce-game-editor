'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const midiImporter = require('../pce-midi-import');

// --- Minimal in-memory Standard MIDI File builder ---------------------------
function vlq(value) {
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

function u32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

// tracks: array of byte arrays (raw MTrk event data, sans the 'MTrk'+len header).
function buildSmf({ format = 0, division = 480, tracks = [] } = {}) {
  const head = Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    (format >> 8) & 0xff, format & 0xff,
    (tracks.length >> 8) & 0xff, tracks.length & 0xff,
    (division >> 8) & 0xff, division & 0xff,
  ]);
  const chunks = tracks.map((data) => Buffer.concat([
    Buffer.from([0x4d, 0x54, 0x72, 0x6b]),
    Buffer.from(u32(data.length)),
    Buffer.from(data),
  ]));
  return Buffer.concat([head, ...chunks]);
}

const TEMPO = (micros) => [0x00, 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff];
const END = [0x00, 0xff, 0x2f, 0x00];

function expectedPeriod(note) {
  return midiImporter.midiNoteToPeriod(note).period;
}

test('convertMidiToPsg maps a single note to period and a note-off to silence', () => {
  const track = [
    ...TEMPO(500000), // 120 BPM
    0x00, 0x90, 69, 100, // note-on A4
    ...vlq(480), 0x80, 69, 0, // note-off after a quarter note
    ...END,
  ];
  const result = midiImporter.convertMidiToPsg(buildSmf({ tracks: [track] }), { bpm: 150 });
  assert.equal(result.bpm, 150);
  assert.equal(result.isSong, true);
  // A4 (note 69): round(3579545 / (32*440)) === 254. Locks the frequency formula.
  const first = result.pattern.find((e) => e.volume > 0);
  assert.equal(first.channel, 0);
  assert.equal(first.period, 254);
  assert.equal(first.volume, 24); // round(100/127*31)
  assert.ok(!first.noise);
  assert.ok(result.pattern.some((e) => e.channel === 0 && e.volume === 0)); // note-off
});

test('convertMidiToPsg allocates simultaneous notes to the lowest free voices', () => {
  const track = [
    0x00, 0x90, 60, 100,
    0x00, 0x90, 64, 100,
    0x00, 0x90, 67, 100,
    ...vlq(240), ...END,
  ];
  const result = midiImporter.convertMidiToPsg(buildSmf({ tracks: [track] }), { bpm: 150 });
  const step0 = result.pattern.filter((e) => e.step === 0).sort((a, b) => a.channel - b.channel);
  assert.deepEqual(step0.map((e) => e.channel), [0, 1, 2]);
  assert.deepEqual(step0.map((e) => e.period), [60, 64, 67].map(expectedPeriod));
});

test('convertMidiToPsg reduces >6 simultaneous notes and keeps the highest pitches', () => {
  const notes = [60, 62, 64, 65, 67, 69, 71]; // 7 notes -> 6 voices
  const on = [];
  notes.forEach((n) => on.push(0x00, 0x90, n, 100));
  const track = [...on, ...vlq(240), ...END];
  const result = midiImporter.convertMidiToPsg(buildSmf({ tracks: [track] }), { bpm: 150 });
  const step0 = result.pattern.filter((e) => e.step === 0);
  assert.equal(step0.length, 6);
  assert.equal(result.stats.stolenVoices, 1);
  // The lowest note (60) is dropped; the top six (62..71) survive.
  const periods = step0.map((e) => e.period).sort((a, b) => a - b);
  assert.deepEqual(periods, [62, 64, 65, 67, 69, 71].map(expectedPeriod).sort((a, b) => a - b));
});

test('convertMidiToPsg derives BPM from the MIDI tempo when not overridden', () => {
  const track = [...TEMPO(300000), 0x00, 0x90, 60, 100, ...vlq(240), 0x80, 60, 0, ...END];
  const result = midiImporter.convertMidiToPsg(buildSmf({ tracks: [track] }));
  assert.equal(result.bpm, 200); // round(60000000 / 300000)
  assert.equal(result.stats.midiBpm, 200);
});

test('convertMidiToPsg renders the drum channel as PSG noise on channels 4/5', () => {
  const track = [0x00, 0x99, 38, 100, ...vlq(240), 0x89, 38, 0, ...END]; // ch10 snare
  const result = midiImporter.convertMidiToPsg(buildSmf({ tracks: [track] }), { bpm: 150 });
  const hit = result.pattern.find((e) => e.noise);
  assert.ok(hit, 'expected a noise entry');
  assert.equal(hit.noise, 1);
  assert.ok(hit.channel === 4 || hit.channel === 5);
  assert.ok(result.stats.drumNotes >= 1);
  assert.ok(result.warnings.some((w) => w.includes('ドラム')));
});

test('convertMidiToPsg caps long songs at 256 steps with a warning', () => {
  // One long note forces far more than 256 steps; expect truncation to the cap.
  const track = [0x00, 0x90, 60, 100, ...vlq(20000), 0x80, 60, 0, ...END];
  const result = midiImporter.convertMidiToPsg(buildSmf({ tracks: [track] }), { bpm: 300 });
  assert.equal(result.steps, 256);
  assert.ok(result.warnings.some((w) => w.includes('256')));
});

test('parseSmf handles running status and format-1 multi-track merge', () => {
  // Track 0: tempo only. Track 1: two note-ons sharing a running status byte.
  const tempoTrack = [...TEMPO(500000), ...END];
  const noteTrack = [
    0x00, 0x90, 60, 100, // explicit status
    ...vlq(120), 64, 100, // running status (no 0x90 repeated)
    ...vlq(120), 0x80, 60, 0,
    ...vlq(120), 0x80, 64, 0,
    ...END,
  ];
  const buf = buildSmf({ format: 1, tracks: [tempoTrack, noteTrack] });
  const parsed = midiImporter.parseSmf(buf);
  assert.equal(parsed.format, 1);
  assert.equal(parsed.ntrks, 2);
  const ons = parsed.tracks.flat().filter((e) => e.type === 'on');
  assert.equal(ons.length, 2);
  assert.deepEqual(ons.map((e) => e.note).sort((a, b) => a - b), [60, 64]);

  const result = midiImporter.convertMidiToPsg(buf, { bpm: 150 });
  assert.equal(result.stats.noteCount, 2);
});

test('convertMidiToPsg rejects non-MIDI and note-less input', () => {
  assert.throws(() => midiImporter.convertMidiToPsg(Buffer.alloc(32)), /MIDI/);
  const empty = buildSmf({ tracks: [[...END]] });
  assert.throws(() => midiImporter.convertMidiToPsg(empty), /音符/);
});
