'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createCdTestPlayBundle,
  createStoredZipBuffer,
  parseCueFileReferences,
} = require('../pce-cd-bundle');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('PCE CD bundle includes CUE sidecars for EmulatorJS Test Play', () => {
  const dir = makeTempDir('pce-cd-bundle-');
  fs.writeFileSync(path.join(dir, 'game.iso'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'track02.wav'), Buffer.from([4, 5, 6]));
  const cuePath = path.join(dir, 'game.cue');
  fs.writeFileSync(cuePath, 'FILE "game.iso" BINARY\n  TRACK 01 MODE1/2048\nFILE "track02.wav" WAVE\n  TRACK 02 AUDIO\n', 'utf-8');

  assert.deepEqual(parseCueFileReferences(cuePath).map((filePath) => path.basename(filePath)), ['game.iso', 'track02.wav']);
  const bundle = createCdTestPlayBundle(cuePath);
  const zip = fs.readFileSync(bundle.zipPath);
  assert.equal(bundle.entryName, 'game.cue');
  assert.match(zip.toString('latin1'), /game\.cue/);
  assert.match(zip.toString('latin1'), /game\.iso/);
  assert.match(zip.toString('latin1'), /track02\.wav/);
});

test('PCE CD bundle rejects CUE references outside output directory', () => {
  const dir = makeTempDir('pce-cd-bundle-escape-');
  const cuePath = path.join(dir, 'bad.cue');
  fs.writeFileSync(cuePath, 'FILE "../escape.iso" BINARY\n  TRACK 01 MODE1/2048\n', 'utf-8');
  assert.throws(() => parseCueFileReferences(cuePath), /escapes output directory/);
});

test('stored ZIP writer emits a valid ZIP signature sequence', () => {
  const zip = createStoredZipBuffer([{ name: 'a.txt', data: Buffer.from('hello') }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
