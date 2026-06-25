'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const vgmImporter = require('../pce-vgm-import');

// Build a minimal PC Engine VGM in memory: one PSG channel that plays a note,
// changes its period, then is silenced. Waits are sized so that, at bpm 150
// (framesPerStep = 6 -> stepSamples = 4410), the timeline lands on clean step
// boundaries that the importer can quantize deterministically.
function buildPceVgm({ loopSamples = 0 } = {}) {
  const header = Buffer.alloc(0x40);
  header.write('Vgm ', 0, 'ascii');
  header.writeUInt32LE(0x150, 0x08); // version 1.50 -> data offset taken from 0x34
  header.writeUInt32LE(30870, 0x18); // total samples
  header.writeUInt32LE(loopSamples, 0x20);
  header.writeUInt32LE(0x0c, 0x34); // data offset (relative to 0x34) -> data starts at 0x40

  const data = Buffer.from([
    0xb9, 0x00, 0x00, // select channel 0
    0xb9, 0x02, 0x00, // freq low = 0x00
    0xb9, 0x03, 0x02, // freq high = 0x02 -> period 0x200 = 512
    0xb9, 0x04, 0x9f, // control: enable(bit7) + volume 31
    0x61, 0xce, 0x33, // wait 13230 samples (3 steps)
    0xb9, 0x02, 0x00, // freq low = 0x00
    0xb9, 0x03, 0x01, // freq high = 0x01 -> period 0x100 = 256
    0x61, 0xce, 0x33, // wait 13230 samples (3 steps)
    0xb9, 0x04, 0x1f, // control: disable(bit7=0) -> note off
    0x61, 0x3a, 0x11, // wait 4410 samples (1 step)
    0x66, // end of sound data
  ]);
  return Buffer.concat([header, data]);
}

test('convertVgmToPsg quantizes PSG register writes into a step pattern', () => {
  const result = vgmImporter.convertVgmToPsg(buildPceVgm(), { bpm: 150 });
  assert.equal(result.isSong, false);
  assert.equal(result.bpm, 150);
  assert.equal(result.steps, 8);
  assert.equal(result.channels, 1);
  assert.equal(result.period, 512);
  assert.deepEqual(result.pattern, [
    { step: 0, channel: 0, period: 512, volume: 31 },
    { step: 4, channel: 0, period: 256, volume: 31 },
    { step: 7, channel: 0, period: 256, volume: 0 },
  ]);
  assert.equal(result.stats.huc6280Writes > 0, true);
});

test('convertVgmToPsg marks looping VGM as a song', () => {
  const result = vgmImporter.convertVgmToPsg(buildPceVgm({ loopSamples: 13230 }), { bpm: 150 });
  assert.equal(result.isSong, true);
});

test('convertVgmToPsg transparently decompresses VGZ (gzip) input', () => {
  const vgz = zlib.gzipSync(buildPceVgm());
  const result = vgmImporter.convertVgmToPsg(vgz, { bpm: 150 });
  assert.equal(result.steps, 8);
  assert.equal(result.pattern.length, 3);
});

test('convertVgmToPsg rejects VGM without HuC6280 PSG data', () => {
  const header = Buffer.alloc(0x40);
  header.write('Vgm ', 0, 'ascii');
  header.writeUInt32LE(0x150, 0x08);
  header.writeUInt32LE(0x0c, 0x34);
  // PSG SN76489 write (0x50) + end, no HuC6280 (0xB9) commands.
  const data = Buffer.from([0x50, 0x9f, 0x61, 0x3a, 0x11, 0x66]);
  assert.throws(() => vgmImporter.convertVgmToPsg(Buffer.concat([header, data])), /HuC6280/);
});

test('convertVgmToPsg rejects non-VGM input', () => {
  assert.throws(() => vgmImporter.convertVgmToPsg(Buffer.alloc(0x40)), /VGM/);
});

test('bpm changes the step quantization grid', () => {
  // Lower bpm -> larger step duration -> fewer steps for the same VGM length.
  const slow = vgmImporter.convertVgmToPsg(buildPceVgm(), { bpm: 75 });
  const fast = vgmImporter.convertVgmToPsg(buildPceVgm(), { bpm: 150 });
  assert.equal(slow.steps < fast.steps, true);
});
