'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ASSETS_FILE,
  MANIFEST_FILE,
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  SCENES_FILE,
  buildGodotPackageBundle,
  exportGodotPackageZip,
  stableProjectId,
} = require('../pce-vn-godot-package');
const {
  exportVnGodotPackage,
  sanitizeExportFileName,
} = require('../plugins/pce-vn-godot-exporter');

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-godot-'));
  fs.mkdirSync(path.join(dir, 'assets', 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'audio'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    coreId: 'pc-engine',
    title: 'Godot Test',
    author: 'PCE',
    serial: 'PCEVN-GODOT-001',
    platform: 'pce',
    targetMedia: 'cd',
  }));
  fs.writeFileSync(path.join(dir, 'assets', 'images', 'bg.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'voice.wav'), Buffer.from('RIFF-test'));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'unused.wav'), Buffer.from('RIFF-unused'));
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'font.ttf'), Buffer.from('font'));
  fs.writeFileSync(path.join(dir, 'assets', 'pce-font.json'), JSON.stringify({
    version: 1,
    fontPath: 'assets/fonts/font.ttf',
    fonts: [{ id: 'font', name: 'font', file: 'assets/fonts/font.ttf' }],
  }));
  fs.writeFileSync(path.join(dir, 'assets', 'pce-assets.json'), JSON.stringify({
    version: 2,
    assets: [
      {
        id: 'bg',
        type: 'image',
        name: 'BG',
        source: 'assets/images/bg.png',
        options: { kind: 'background', width: 256, height: 224 },
      },
      {
        id: 'voice',
        type: 'adpcm',
        name: 'Voice',
        source: 'assets/audio/voice.wav',
        options: { sampleRate: 8000, loop: false },
        data: { generated: { byteLength: 8000, durationSeconds: 2 } },
      },
      {
        id: 'unused',
        type: 'adpcm',
        source: 'assets/audio/unused.wav',
        options: { sampleRate: 8000 },
      },
      {
        id: 'song',
        type: 'psg-song',
        name: 'Song',
        options: { bpm: 150, steps: 1, loop: true, pattern: [{ step: 0, channel: 0, period: 512, volume: 16 }] },
      },
    ],
  }));
  return dir;
}

function scenes() {
  return {
    version: 2,
    settings: { messageSpeedFrames: 10, messageAdvanceMode: 'button', messageAutoWaitFrames: 60 },
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'background', assetId: 'bg', x: 0, y: 0 },
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'song' },
        { type: 'message', speaker: '', text: 'test', voiceAssetId: 'voice' },
        { type: 'audio', kind: 'adpcm', action: 'play', assetId: 'unused', skip: true },
      ],
      nextSceneId: '',
    }],
  };
}

test('Godot package contains normalized scenes and referenced playback assets only', () => {
  const dir = makeProject();
  const bundle = buildGodotPackageBundle({
    projectDir: dir,
    sceneDoc: scenes(),
    now: () => new Date('2026-07-26T00:00:00.000Z'),
  });

  assert.equal(bundle.manifest.format, PACKAGE_FORMAT);
  assert.equal(bundle.manifest.version, PACKAGE_VERSION);
  assert.equal(bundle.manifest.project.id, stableProjectId(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'))), dir));
  assert.deepEqual(bundle.entries.map((entry) => entry.name).slice(0, 3), [
    MANIFEST_FILE,
    ASSETS_FILE,
    SCENES_FILE,
  ]);
  const assets = JSON.parse(bundle.entries.find((entry) => entry.name === ASSETS_FILE).data);
  assert.deepEqual(assets.assets.map((asset) => asset.id), ['bg', 'song', 'voice']);
  assert.equal(assets.assets.find((asset) => asset.id === 'song').file, '');
  assert.match(assets.assets.find((asset) => asset.id === 'voice').file, /^media\//);
  assert.ok(bundle.entries.some((entry) => entry.name === 'font/font.ttf'));
  assert.equal(bundle.manifest.entrypoints.border, '');
  assert.equal(bundle.entries.some((entry) => entry.name === 'presentation/player-border.png'), false);
  assert.equal(bundle.manifest.files.some((entry) => entry.path === 'presentation/player-border.png'), false);
  assert.equal(bundle.manifest.stats.scenes, 1);
  assert.equal(bundle.manifest.stats.commands, 3);
  assert.equal(bundle.manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)), true);
});

test('Godot package ignores the legacy project-local player border', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'assets', 'images', 'player-border.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x42]));
  const bundle = buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes() });
  assert.equal(bundle.manifest.entrypoints.border, '');
  assert.equal(bundle.entries.some((entry) => entry.name === 'presentation/player-border.png'), false);
});

test('same-title projects in different editor directories keep separate library ids', () => {
  const first = makeProject();
  const second = makeProject();
  const project = JSON.parse(fs.readFileSync(path.join(first, 'project.json')));
  assert.notEqual(stableProjectId(project, first), stableProjectId(project, second));
});

test('Godot package uses the font selected in pce-font.json and not an arbitrary font file', () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'aaa.ttf'), Buffer.from('wrong-font'));
  const bundle = buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes() });
  assert.equal(bundle.manifest.entrypoints.font, 'font/font.ttf');
  assert.equal(bundle.entries.find((entry) => entry.name === 'font/font.ttf').data.toString(), 'font');

  fs.writeFileSync(path.join(dir, 'assets', 'pce-font.json'), JSON.stringify({ version: 1, fontPath: '', fonts: [] }));
  const fallbackBundle = buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes() });
  assert.equal(fallbackBundle.manifest.entrypoints.font, '');
  assert.equal(fallbackBundle.entries.some((entry) => entry.name.startsWith('font/')), false);
});

test('Godot package rejects playback assets outside the project', () => {
  const dir = makeProject();
  const assetPath = path.join(dir, 'assets', 'pce-assets.json');
  const assets = JSON.parse(fs.readFileSync(assetPath));
  assets.assets[0].source = '../outside.png';
  fs.writeFileSync(assetPath, JSON.stringify(assets));
  assert.throws(
    () => buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes() }),
    /project relative asset path|再生用素材/,
  );
});

test('Godot package export writes one ZIP after save confirmation', async () => {
  const dir = makeProject();
  let zippedEntries = [];
  const writes = [];
  const result = await exportGodotPackageZip({
    projectDir: dir,
    sceneDoc: scenes(),
    defaultPath: 'game.pcevn.zip',
    showSaveDialog: async (_owner, options) => {
      assert.equal(options.defaultPath, 'game.pcevn.zip');
      return { canceled: false, filePath: 'C:/out/game.pcevn.zip' };
    },
    createStoredZipBuffer: (entries) => {
      zippedEntries = entries;
      return Buffer.from('zip');
    },
    writeFileSync: (filePath, data) => writes.push({ filePath, data: data.toString() }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sceneCount, 1);
  assert.equal(result.assetCount, 3);
  assert.equal(zippedEntries[0].name, MANIFEST_FILE);
  assert.deepEqual(writes, [{ filePath: 'C:/out/game.pcevn.zip', data: 'zip' }]);
});

test('Godot exporter plugin hook owns the save dialog and delegates package creation', async () => {
  const dir = makeProject();
  const writes = [];
  let dialogOptions = null;
  let packagedEntries = [];
  const result = await exportVnGodotPackage({ doc: scenes() }, {
    projectDir: dir,
    appModules: {
      'pce-vn-godot-package.js': require('../pce-vn-godot-package'),
      'pce-cd-bundle.js': {
        createStoredZipBuffer: (entries) => {
          packagedEntries = entries;
          return Buffer.from('plugin-zip');
        },
      },
    },
    showSaveDialog: async (_owner, options) => {
      dialogOptions = options;
      return { canceled: false, filePath: 'C:/out/godot-test.pcevn.zip' };
    },
    writeFileSync: (filePath, data) => writes.push({ filePath, data: data.toString() }),
  });

  assert.equal(sanitizeExportFileName('..bad/name'), 'bad_name');
  assert.equal(dialogOptions.defaultPath, 'Godot Test.pcevn.zip');
  assert.equal(result.ok, true);
  assert.equal(result.sceneCount, 1);
  assert.equal(packagedEntries[0].name, MANIFEST_FILE);
  assert.deepEqual(writes, [{
    filePath: 'C:/out/godot-test.pcevn.zip',
    data: 'plugin-zip',
  }]);
});
