'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function loadBuildSystem() {
  const electronPath = require.resolve('electron');
  const previous = require.cache[electronPath];
  require.cache[electronPath] = { exports: { app: { getPath: () => os.tmpdir() } } };
  const modulePath = require.resolve('../pce-build-system');
  delete require.cache[modulePath];
  const result = require('../pce-build-system');
  if (previous) require.cache[electronPath] = previous;
  else delete require.cache[electronPath];
  return result;
}

function makeCddaWav(sampleFrames = 203) {
  const dataSize = sampleFrames * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < dataSize; i += 1) buffer[44 + i] = (i % 251) + 1;
  return buffer;
}

function writeAssetDocument(projectDir, tracks) {
  const assetsDir = path.join(projectDir, 'assets');
  const cddaDir = path.join(assetsDir, 'cdda');
  fs.mkdirSync(cddaDir, { recursive: true });
  const assets = tracks.map(({ id, track }) => {
    const source = `assets/cdda/${id}.wav`;
    fs.writeFileSync(path.join(projectDir, source), makeCddaWav(200 + track));
    return { id, type: 'cdda-track', source, options: { track, loop: true } };
  });
  fs.writeFileSync(
    path.join(assetsDir, 'pce-assets.json'),
    JSON.stringify({ version: 2, assets }, null, 2),
    'utf8',
  );
}

test('PCE CD CUE rejects missing track 2 and emits TurboRip-compatible pregap and WAV sectors', () => {
  const buildSystem = loadBuildSystem();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-cdda-cue-'));
  const outDir = path.join(projectDir, 'out');
  const cuePath = path.join(outDir, 'game.cue');
  const isoPath = path.join(outDir, 'game.iso');
  fs.mkdirSync(outDir, { recursive: true });

  writeAssetDocument(projectDir, [
    { id: 'jazz09', track: 3 },
    { id: 'wind04', track: 4 },
  ]);
  assert.throws(
    () => buildSystem.collectCddaTracks(projectDir, cuePath),
    /contiguous from track 2 without gaps; expected track 2, but "jazz09" uses track 3/,
  );

  writeAssetDocument(projectDir, [
    { id: 'jazz09', track: 2 },
    { id: 'wind04', track: 3 },
  ]);
  const cddaTracks = buildSystem.collectCddaTracks(projectDir, cuePath);
  assert.deepEqual(cddaTracks.map((entry) => entry.track), [2, 3]);

  fs.writeFileSync(isoPath, Buffer.concat([
    Buffer.alloc(300 * 2048, 0x5a),
    Buffer.alloc(150 * 2048),
  ]));
  const imageLayout = buildSystem.normalizePceCdImageForCdda({ isoPath, cddaTracks });
  assert.deepEqual(imageLayout, {
    normalized: true,
    dataSectors: 300,
    pregapSectors: 150,
    strippedSectors: 150,
  });
  assert.equal(fs.statSync(isoPath).size, 300 * 2048);
  buildSystem.writeCueFile({ cuePath, isoPath, cddaTracks });
  const cue = fs.readFileSync(cuePath, 'utf8');
  assert.match(cue, /TRACK 01 MODE1\/2048[\s\S]*TRACK 02 AUDIO[\s\S]*TRACK 03 AUDIO/);
  assert.match(cue, /TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 01 00:00:00/);
  assert.equal((cue.match(/PREGAP/g) || []).length, 1);
  assert.doesNotMatch(cue, /TRACK 04 AUDIO/);
  cddaTracks.forEach((track) => {
    const source = fs.readFileSync(track.sourcePath);
    const output = fs.readFileSync(track.outputPath);
    const sourceDataSize = source.readUInt32LE(40);
    const outputDataSize = output.readUInt32LE(40);
    assert.equal(outputDataSize % 2352, 0);
    assert.deepEqual(output.subarray(44, 44 + sourceDataSize), source.subarray(44));
    assert.equal(output.subarray(44 + sourceDataSize).every((byte) => byte === 0), true);
    assert.equal(output.readUInt32LE(4), output.length - 8);
  });
});

test('PCE CD image normalization refuses to strip non-zero sectors', () => {
  const buildSystem = loadBuildSystem();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-cdda-cue-nonzero-'));
  const isoPath = path.join(projectDir, 'game.iso');
  const original = Buffer.concat([
    Buffer.alloc(300 * 2048, 0x5a),
    Buffer.alloc(149 * 2048),
    Buffer.alloc(2048, 0x01),
  ]);
  fs.writeFileSync(isoPath, original);

  assert.throws(
    () => buildSystem.normalizePceCdImageForCdda({ isoPath, cddaTracks: [{ track: 2 }] }),
    /does not end with the expected 150 zero sectors/,
  );
  assert.deepEqual(fs.readFileSync(isoPath), original);
});
