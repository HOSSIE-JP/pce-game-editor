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

function writeAssetDocument(projectDir, tracks, options = {}) {
  const assetsDir = path.join(projectDir, 'assets');
  const cddaDir = path.join(assetsDir, 'cdda');
  fs.mkdirSync(cddaDir, { recursive: true });
  const assets = [];
  if (options.includeWarning !== false) {
    const warningSource = 'assets/cdda/cdda_warning.wav';
    fs.writeFileSync(
      path.join(projectDir, warningSource),
      makeCddaWav(options.warningSampleFrames || (3365 * 588)),
    );
    assets.push({
      id: 'cdda_warning',
      type: 'cdda-warning',
      source: warningSource,
      name: 'Warning Audio',
    });
  }
  assets.push(...tracks.map(({ id, track }) => {
    const source = `assets/cdda/${id}.wav`;
    fs.writeFileSync(path.join(projectDir, source), makeCddaWav(200 + track));
    return { id, type: 'cdda-track', source, options: { track, loop: true } };
  }));
  fs.writeFileSync(
    path.join(assetsDir, 'pce-assets.json'),
    JSON.stringify({ version: 2, assets }, null, 2),
    'utf8',
  );
}

test('PCE CD CUE emits warning/data/game tracks with fixed pregaps and sector-aligned WAVs', () => {
  const buildSystem = loadBuildSystem();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-cdda-cue-'));
  const outDir = path.join(projectDir, 'out');
  const cuePath = path.join(outDir, 'game.cue');
  const isoPath = path.join(outDir, 'game.iso');
  fs.mkdirSync(outDir, { recursive: true });

  writeAssetDocument(projectDir, [
    { id: 'legacy', track: 2 },
  ], { includeWarning: false });
  assert.throws(
    () => buildSystem.buildCommandForProject(projectDir, {
      title: 'game',
      targetMedia: 'cd',
      toolchain: 'llvm-mos',
      cd: { dataFiles: [] },
    }),
    /requires Track 1 warning audio/,
  );

  writeAssetDocument(projectDir, [
    { id: 'legacy', track: 2 },
  ]);
  assert.throws(
    () => buildSystem.buildCommandForProject(projectDir, {
      title: 'game',
      targetMedia: 'cd',
      toolchain: 'llvm-mos',
      cd: { dataFiles: [] },
    }),
    /invalid track 2.*Renumber from Track 3/,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'pce-assets.json'), 'utf8'))
      .assets.find((asset) => asset.id === 'legacy').options.track,
    2,
  );

  writeAssetDocument(projectDir, [
    { id: 'jazz09', track: 3 },
    { id: 'wind04', track: 4 },
  ]);
  const discLayout = require('../pce-asset-manager').getCddaWarningDiscLayout(projectDir);
  assert.equal(discLayout.warningSectors, 3365);
  assert.equal(discLayout.dataTrackStartLba, 3590);
  const warningTrack = buildSystem.collectCddaWarningTrack(projectDir, cuePath, discLayout);
  const cddaTracks = buildSystem.collectCddaTracks(projectDir, cuePath);
  assert.deepEqual(cddaTracks.map((entry) => entry.track), [3, 4]);

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
  buildSystem.writeCueFile({
    cuePath,
    isoPath,
    warningTrack,
    cddaTracks,
    discLayout: {
      warningSectors: discLayout.warningSectors,
      dataPregapSectors: 225,
      dataTrackStartLba: discLayout.dataTrackStartLba,
      gameAudioPregapSectors: 150,
    },
  });
  const cue = fs.readFileSync(cuePath, 'utf8');
  const trackLines = cue.split(/\r?\n/).filter((line) => line.trim().startsWith('TRACK ')).map((line) => line.trim());
  assert.deepEqual(trackLines, [
    'TRACK 01 AUDIO',
    'TRACK 02 MODE1/2048',
    'TRACK 03 AUDIO',
    'TRACK 04 AUDIO',
  ]);
  assert.ok(cue.includes('TRACK 02 MODE1/2048\n    PREGAP 00:03:00\n    INDEX 01 00:00:00'));
  assert.ok(cue.includes('TRACK 03 AUDIO\n    PREGAP 00:02:00\n    INDEX 01 00:00:00'));
  assert.equal((cue.match(/PREGAP/g) || []).length, 2);
  assert.doesNotMatch(cue, /TRACK 05 AUDIO/);
  [warningTrack, ...cddaTracks].forEach((track) => {
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
    () => buildSystem.normalizePceCdImageForCdda({ isoPath, cddaTracks: [{ track: 3 }] }),
    /does not end with the expected 150 zero sectors/,
  );
  assert.deepEqual(fs.readFileSync(isoPath), original);
});

test('PCE CD warning audio changes the incremental signature and Track 2 LBA', () => {
  const buildSystem = loadBuildSystem();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-cdda-signature-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), 'int main(void) { return 0; }\n');
  writeAssetDocument(projectDir, [], { warningSampleFrames: 588 });
  const config = {
    title: 'signature',
    targetMedia: 'cd',
    toolchain: 'llvm-mos',
    cd: { dataFiles: [] },
  };
  const first = buildSystem.buildCommandForProject(projectDir, config);
  const firstSignature = buildSystem.computeBuildOutputSignature(projectDir, config, first);
  assert.equal(first.discLayout.warningSectors, 1);
  assert.equal(first.discLayout.dataTrackStartLba, 226);

  const warningPath = path.join(projectDir, 'assets', 'cdda', 'cdda_warning.wav');
  const sameSizeWarning = fs.readFileSync(warningPath);
  sameSizeWarning[sameSizeWarning.length - 1] ^= 0x01;
  fs.writeFileSync(warningPath, sameSizeWarning);
  const contentChanged = buildSystem.buildCommandForProject(projectDir, config);
  const contentChangedSignature = buildSystem.computeBuildOutputSignature(projectDir, config, contentChanged);
  assert.equal(contentChanged.discLayout.warningSectors, 1);
  assert.equal(contentChanged.discLayout.dataTrackStartLba, 226);
  assert.notEqual(contentChangedSignature, firstSignature);

  fs.writeFileSync(
    warningPath,
    makeCddaWav(2 * 588),
  );
  const second = buildSystem.buildCommandForProject(projectDir, config);
  const secondSignature = buildSystem.computeBuildOutputSignature(projectDir, config, second);
  assert.equal(second.discLayout.warningSectors, 2);
  assert.equal(second.discLayout.dataTrackStartLba, 227);
  assert.notEqual(secondSignature, firstSignature);
});

test('PCE CD CUE keeps the ISO tail when no game CD-DA tracks exist', () => {
  const buildSystem = loadBuildSystem();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-cdda-cue-data-only-'));
  const outDir = path.join(projectDir, 'out');
  const cuePath = path.join(outDir, 'game.cue');
  const isoPath = path.join(outDir, 'game.iso');
  fs.mkdirSync(outDir, { recursive: true });
  writeAssetDocument(projectDir, [], { warningSampleFrames: 588 });
  const assetManager = require('../pce-asset-manager');
  const discLayout = assetManager.getCddaWarningDiscLayout(projectDir);
  const warningTrack = buildSystem.collectCddaWarningTrack(projectDir, cuePath, discLayout);
  const original = Buffer.alloc(450 * 2048, 0x5a);
  fs.writeFileSync(isoPath, original);

  assert.deepEqual(
    buildSystem.normalizePceCdImageForCdda({ isoPath, cddaTracks: [] }),
    { normalized: false, pregapSectors: 0, strippedSectors: 0 },
  );
  buildSystem.writeCueFile({
    cuePath,
    isoPath,
    warningTrack,
    cddaTracks: [],
    discLayout,
  });
  assert.deepEqual(fs.readFileSync(isoPath), original);
  const trackLines = fs.readFileSync(cuePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('TRACK '))
    .map((line) => line.trim());
  assert.deepEqual(trackLines, ['TRACK 01 AUDIO', 'TRACK 02 MODE1/2048']);
});
