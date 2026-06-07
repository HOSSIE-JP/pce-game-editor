'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const extractor = require('../pce-ipl-extractor');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pce-ipl-test-'));
}

function makePayload(seed) {
  const buffer = Buffer.alloc(extractor.IPL_SIZE);
  for (let i = 0; i < buffer.length; i++) buffer[i] = (seed + i) & 0xff;
  return buffer;
}

function makeRawMode1Sector(payload) {
  const sector = Buffer.alloc(extractor.RAW_MODE1_SECTOR_SIZE);
  sector[0] = 0x00;
  for (let i = 1; i <= 10; i++) sector[i] = 0xff;
  sector[11] = 0x00;
  sector[15] = 0x01;
  Buffer.from(payload).copy(sector, 16, 0, extractor.IPL_SIZE);
  return sector;
}

test('PCE IPL extractor reads direct ISO first 2048-byte sector', () => {
  const dir = makeTempDir();
  const payload = makePayload(3);
  const isoPath = path.join(dir, 'disc.iso');
  fs.writeFileSync(isoPath, Buffer.concat([payload, Buffer.alloc(128)]));

  const result = extractor.extractIplBuffer(isoPath);

  assert.equal(result.inputFormat, 'iso');
  assert.equal(result.trackMode, 'MODE1/2048');
  assert.deepEqual(result.buffer, payload);
});

test('PCE IPL extractor reads CUE MODE1/2352 INDEX 01 user data', () => {
  const dir = makeTempDir();
  const junk = makePayload(9);
  const payload = makePayload(42);
  const binPath = path.join(dir, 'disc.bin');
  const cuePath = path.join(dir, 'disc.cue');
  fs.writeFileSync(binPath, Buffer.concat([makeRawMode1Sector(junk), makeRawMode1Sector(payload)]));
  fs.writeFileSync(cuePath, [
    'FILE "disc.bin" BINARY',
    '  TRACK 01 MODE1/2352',
    '    INDEX 01 00:00:01',
    '',
  ].join('\n'));

  const result = extractor.extractIplBuffer(cuePath);

  assert.equal(result.inputFormat, 'cue');
  assert.equal(result.trackMode, 'MODE1/2352');
  assert.equal(result.sectorIndex, 1);
  assert.deepEqual(result.buffer, payload);
});

test('PCE IPL extractor rejects CUE file references outside cue directory', () => {
  const dir = makeTempDir();
  const outside = path.join(dir, 'outside.bin');
  const cueDir = path.join(dir, 'cue');
  fs.mkdirSync(cueDir, { recursive: true });
  fs.writeFileSync(outside, makePayload(1));
  const cuePath = path.join(cueDir, 'bad.cue');
  fs.writeFileSync(cuePath, [
    'FILE "../outside.bin" BINARY',
    '  TRACK 01 MODE1/2048',
    '    INDEX 01 00:00:00',
  ].join('\n'));

  assert.throws(() => extractor.extractIplBuffer(cuePath), /escapes cue directory/);
});

test('PCE IPL extractor writes portable ipl.bin and metadata', () => {
  const dir = makeTempDir();
  const payload = makePayload(7);
  const isoPath = path.join(dir, 'disc.iso');
  const outDir = path.join(dir, 'out');
  fs.writeFileSync(isoPath, payload);

  const result = extractor.extractIplToDirectory(isoPath, outDir);
  const metadata = JSON.parse(fs.readFileSync(result.metadataPath, 'utf-8'));

  assert.equal(result.ok, true);
  assert.equal(path.basename(result.outputPath), 'ipl.bin');
  assert.equal(fs.readFileSync(result.outputPath).length, extractor.IPL_SIZE);
  assert.equal(metadata.type, 'pce-cd-ipl');
  assert.equal(metadata.byteLength, extractor.IPL_SIZE);
  assert.match(metadata.sha256, /^[0-9a-f]{64}$/);
});
