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

function writeAssetDocument(projectDir, tracks) {
  const assetsDir = path.join(projectDir, 'assets');
  const cddaDir = path.join(assetsDir, 'cdda');
  fs.mkdirSync(cddaDir, { recursive: true });
  const assets = tracks.map(({ id, track }) => {
    const source = `assets/cdda/${id}.wav`;
    fs.writeFileSync(path.join(projectDir, source), Buffer.from(`wav-${id}`));
    return { id, type: 'cdda-track', source, options: { track, loop: true } };
  });
  fs.writeFileSync(
    path.join(assetsDir, 'pce-assets.json'),
    JSON.stringify({ version: 2, assets }, null, 2),
    'utf8',
  );
}

test('PCE CD CUE rejects missing track 2 and emits only contiguous track numbers', () => {
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

  fs.writeFileSync(isoPath, Buffer.from('iso'));
  buildSystem.writeCueFile({ cuePath, isoPath, cddaTracks });
  const cue = fs.readFileSync(cuePath, 'utf8');
  assert.match(cue, /TRACK 01 MODE1\/2048[\s\S]*TRACK 02 AUDIO[\s\S]*TRACK 03 AUDIO/);
  assert.doesNotMatch(cue, /TRACK 04 AUDIO/);
});

