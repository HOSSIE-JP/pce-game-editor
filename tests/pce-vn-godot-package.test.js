'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ASSET_DOCUMENT_VERSION,
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

const { encodeWavToOggVorbis } = require('../pce-vn-godot-audio');
const { encodeIndexedPng } = require('../pce-vn-gb-studio-image');
const { decodeSpriteIndices } = require('../pce-vn-godot-image');
const { decodePngImage } = require('../pce-png-decoder');

function makeWavBuffer(sampleRate = 8000, channels = 1, durationSeconds = 1) {
  const frameCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const blockAlign = channels * 2;
  const dataSize = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(Math.sin((frame / sampleRate) * Math.PI * 2 * 440) * 12000);
    for (let channel = 0; channel < channels; channel += 1) {
      buffer.writeInt16LE(sample, 44 + ((frame * channels + channel) * 2));
    }
  }
  return buffer;
}

async function fakeTranscodeWavToOgg() {
  return { output: Buffer.from('OggS-test-vorbis') };
}

function makeIndexedPng(width, height, colorIndex, palette) {
  return encodeIndexedPng({
    width,
    height,
    indices: new Uint8Array(width * height).fill(colorIndex),
    palette,
  });
}

function makeSolidPceBgTile(colorIndex) {
  const tile = Buffer.alloc(32);
  for (let y = 0; y < 8; y += 1) {
    for (let plane = 0; plane < 4; plane += 1) {
      const offset = plane < 2 ? (y * 2) + plane : 16 + (y * 2) + (plane - 2);
      tile[offset] = colorIndex & (1 << plane) ? 0xff : 0;
    }
  }
  return tile;
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-godot-'));
  fs.mkdirSync(path.join(dir, 'assets', 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'images-hd'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'audio'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'generated', 'bg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    coreId: 'pc-engine',
    title: 'Godot Test',
    author: 'PCE',
    serial: 'PCEVN-GODOT-001',
    platform: 'pce',
    targetMedia: 'cd',
  }));
  fs.writeFileSync(path.join(dir, 'assets', 'images', 'bg.png'), makeIndexedPng(8, 8, 1, [[0, 0, 0], [200, 0, 0]]));
  fs.writeFileSync(path.join(dir, 'assets', 'images-hd', 'bg.png'), makeIndexedPng(8, 8, 1, [[0, 0, 0], [255, 120, 64]]));
  const pcePalette = Buffer.alloc(32);
  pcePalette.writeUInt16LE(7 << 3, 2);
  fs.writeFileSync(path.join(dir, 'assets', 'generated', 'bg', 'palette.bin'), pcePalette);
  fs.writeFileSync(path.join(dir, 'assets', 'generated', 'bg', 'tiles.bin'), makeSolidPceBgTile(1));
  const compactMap = Buffer.alloc(2);
  compactMap.writeUInt16LE(64, 0);
  const vramMap = Buffer.alloc(64);
  vramMap.writeUInt16LE(64, 0);
  fs.writeFileSync(path.join(dir, 'assets', 'generated', 'bg', 'map.bin'), compactMap);
  fs.writeFileSync(path.join(dir, 'assets', 'generated', 'bg', 'map_vram.bin'), vramMap);
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'voice.wav'), makeWavBuffer(8000, 1, 1));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'unused.wav'), makeWavBuffer(8000, 1, 0.1));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'cdda-source.wav'), makeWavBuffer(22050, 1, 0.5));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'cdda.wav'), makeWavBuffer(44100, 2, 0.5));
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
        options: { kind: 'background', width: 8, height: 8 },
        data: {
          import: { highQualitySource: 'assets/images-hd/bg.png' },
          generated: {
            paletteFile: 'assets/generated/bg/palette.bin',
            tilesFile: 'assets/generated/bg/tiles.bin',
            mapFile: 'assets/generated/bg/map.bin',
            mapVramFile: 'assets/generated/bg/map_vram.bin',
            previewFile: 'assets/generated/bg/preview.json',
            tileCount: 1,
            paletteCount: 1,
            vramBytes: 96,
          },
        },
      },
      {
        id: 'cdda',
        type: 'cdda-track',
        name: 'CD audio',
        source: 'assets/audio/cdda-source.wav',
        options: { track: 3, loop: true },
        data: { generated: { outputFile: 'assets/audio/cdda.wav', durationSeconds: 0.5 } },
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
        { type: 'audio', kind: 'cdda', action: 'play', assetId: 'cdda' },
        { type: 'message', speaker: '', text: 'test', voiceAssetId: 'voice' },
        { type: 'audio', kind: 'adpcm', action: 'play', assetId: 'unused', skip: true },
      ],
      nextSceneId: '',
    }],
  };
}

test('Ogg encoder handles PCE voice rates and CD-quality stereo WAV', async () => {
  const cases = [4000, 4571, 5333, 6400, 8000, 10666, 16000, 32000]
    .map((sampleRate) => [sampleRate, 1]);
  cases.push([44100, 2]);
  for (const [sampleRate, channels] of cases) {
    const source = makeWavBuffer(sampleRate, channels, 1);
    const encoded = await encodeWavToOggVorbis(source);
    assert.equal(encoded.output.toString('ascii', 0, 4), 'OggS');
    assert.notEqual(encoded.output.indexOf(Buffer.from('vorbis')), -1);
    assert.equal(encoded.sampleRate, sampleRate);
    assert.equal(encoded.channels, channels);
    assert.ok(encoded.output.length < source.length);
  }
});

test('PCE sprite decoder expands deduplicated hardware pattern cells', () => {
  const pattern = Buffer.alloc(128);
  for (let y = 0; y < 16; y += 1) {
    pattern[y * 2] = 0xff;
    pattern[y * 2 + 1] = 0xff;
  }
  const indices = decodeSpriteIndices(pattern, Buffer.from([0, 0]), 32, 16, 16, 16);
  assert.equal(indices.length, 32 * 16);
  assert.equal(indices.every((value) => value === 1), true);
});

test('Godot package contains normalized scenes and Ogg-compressed playback assets only', async () => {
  const dir = makeProject();
  const bundle = await buildGodotPackageBundle({
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
  assert.equal(assets.version, ASSET_DOCUMENT_VERSION);
  assert.deepEqual(assets.assets.map((asset) => asset.id), ['bg', 'cdda', 'song', 'voice']);
  assert.equal(assets.assets.find((asset) => asset.id === 'song').file, '');
  assert.match(assets.assets.find((asset) => asset.id === 'voice').file, /^media\/.*\.ogg$/);
  assert.match(assets.assets.find((asset) => asset.id === 'cdda').file, /^media\/.*\.ogg$/);
  const background = assets.assets.find((asset) => asset.id === 'bg');
  assert.match(background.file, /^media\/.*\/hd\.png$/);
  assert.equal(background.visual.defaultMode, 'hd');
  assert.equal(background.visual.hd.source, 'pre-pce-quantize');
  assert.match(background.visual.pce.file, /^media\/.*\/pce\.png$/);
  const pceEntry = bundle.entries.find((entry) => entry.name === background.visual.pce.file);
  const decodedPce = decodePngImage(pceEntry.data);
  assert.equal(decodedPce.indices.every((value) => value === 1), true);
  assert.deepEqual(decodedPce.palette[1], { r: 255, g: 0, b: 0 });
  const audioEntries = bundle.entries.filter((entry) => /media\/.*\.ogg$/.test(entry.name));
  assert.equal(audioEntries.length, 2);
  assert.equal(audioEntries.every((entry) => entry.data.toString('ascii', 0, 4) === 'OggS'), true);
  assert.equal(bundle.entries.some((entry) => /media\/.*\.wav$/i.test(entry.name)), false);
  assert.ok(bundle.entries.some((entry) => entry.name === 'font/font.ttf'));
  assert.equal(bundle.manifest.entrypoints.border, '');
  assert.deepEqual(bundle.manifest.audio, {
    wavTranscode: 'ogg-vorbis',
    extension: '.ogg',
    quality: 4,
  });
  assert.deepEqual(bundle.manifest.visual, { defaultMode: 'hd', modes: ['hd', 'pce'] });
  assert.equal(bundle.manifest.stats.visualAssets, 1);
  assert.equal(bundle.manifest.stats.visualHighQualityFallbackAssets, 0);
  assert.ok(bundle.manifest.stats.visualHighQualityBytes > 0 && bundle.manifest.stats.visualPceBytes > 0);
  assert.equal(bundle.entries.some((entry) => entry.name === 'presentation/player-border.png'), false);
  assert.equal(bundle.manifest.files.some((entry) => entry.path === 'presentation/player-border.png'), false);
  assert.equal(bundle.manifest.stats.scenes, 1);
  assert.equal(bundle.manifest.stats.commands, 4);
  assert.equal(bundle.manifest.stats.assets, 4);
  assert.equal(bundle.manifest.stats.audioAssets, 2);
  assert.equal(bundle.manifest.stats.transcodedAudioAssets, 2);
  assert.ok(bundle.manifest.stats.audioPackageBytes < bundle.manifest.stats.audioSourceBytes);
  assert.equal(bundle.manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256)), true);
});

test('Godot package keeps already compressed OGG and MP3 without lossy transcoding', async () => {
  const dir = makeProject();
  const assetPath = path.join(dir, 'assets', 'pce-assets.json');
  const assetDoc = JSON.parse(fs.readFileSync(assetPath));
  const voice = assetDoc.assets.find((asset) => asset.id === 'voice');
  const cdda = assetDoc.assets.find((asset) => asset.id === 'cdda');
  voice.source = 'assets/audio/voice.ogg';
  cdda.data.generated.outputFile = 'assets/audio/cdda.mp3';
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'voice.ogg'), Buffer.from('OggS-existing-vorbis'));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'cdda.mp3'), Buffer.from('ID3-existing-mp3'));
  fs.writeFileSync(assetPath, JSON.stringify(assetDoc));
  let transcodeCalls = 0;
  const bundle = await buildGodotPackageBundle({
    projectDir: dir,
    sceneDoc: scenes(),
    transcodeWavToOgg: async () => {
      transcodeCalls += 1;
      return { output: Buffer.from('unexpected') };
    },
  });
  assert.equal(transcodeCalls, 0);
  assert.equal(bundle.entries.find((entry) => entry.name.endsWith('/voice.ogg')).data.toString(), 'OggS-existing-vorbis');
  assert.equal(bundle.entries.find((entry) => entry.name.endsWith('/cdda.mp3')).data.toString(), 'ID3-existing-mp3');
  assert.equal(bundle.manifest.stats.transcodedAudioAssets, 0);
  assert.equal(bundle.manifest.stats.audioPackageBytes, bundle.manifest.stats.audioSourceBytes);
});

test('Godot package ignores the legacy project-local player border', async () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'assets', 'images', 'player-border.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x42]));
  const bundle = await buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes(), transcodeWavToOgg: fakeTranscodeWavToOgg });
  assert.equal(bundle.manifest.entrypoints.border, '');
  assert.equal(bundle.entries.some((entry) => entry.name === 'presentation/player-border.png'), false);
});

test('Godot package marks legacy visual source fallback when no pre-quantize image is stored', async () => {
  const dir = makeProject();
  const assetPath = path.join(dir, 'assets', 'pce-assets.json');
  const assetDoc = JSON.parse(fs.readFileSync(assetPath));
  delete assetDoc.assets.find((asset) => asset.id === 'bg').data.import.highQualitySource;
  fs.writeFileSync(assetPath, JSON.stringify(assetDoc));
  const bundle = await buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes(), transcodeWavToOgg: fakeTranscodeWavToOgg });
  const assets = JSON.parse(bundle.entries.find((entry) => entry.name === ASSETS_FILE).data);
  assert.equal(assets.assets.find((asset) => asset.id === 'bg').visual.hd.source, 'asset-source-fallback');
  assert.equal(bundle.manifest.stats.visualHighQualityFallbackAssets, 1);
});

test('same-title projects in different editor directories keep separate library ids', () => {
  const first = makeProject();
  const second = makeProject();
  const project = JSON.parse(fs.readFileSync(path.join(first, 'project.json')));
  assert.notEqual(stableProjectId(project, first), stableProjectId(project, second));
});

test('Godot package uses the font selected in pce-font.json and not an arbitrary font file', async () => {
  const dir = makeProject();
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'aaa.ttf'), Buffer.from('wrong-font'));
  const bundle = await buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes(), transcodeWavToOgg: fakeTranscodeWavToOgg });
  assert.equal(bundle.manifest.entrypoints.font, 'font/font.ttf');
  assert.equal(bundle.entries.find((entry) => entry.name === 'font/font.ttf').data.toString(), 'font');

  fs.writeFileSync(path.join(dir, 'assets', 'pce-font.json'), JSON.stringify({ version: 1, fontPath: '', fonts: [] }));
  const fallbackBundle = await buildGodotPackageBundle({ projectDir: dir, sceneDoc: scenes(), transcodeWavToOgg: fakeTranscodeWavToOgg });
  assert.equal(fallbackBundle.manifest.entrypoints.font, '');
  assert.equal(fallbackBundle.entries.some((entry) => entry.name.startsWith('font/')), false);
});

test('Godot package rejects playback assets outside the project', async () => {
  const dir = makeProject();
  const assetPath = path.join(dir, 'assets', 'pce-assets.json');
  const assets = JSON.parse(fs.readFileSync(assetPath));
  assets.assets[0].source = '../outside.png';
  assets.assets[0].data.import.highQualitySource = '../outside.png';
  fs.writeFileSync(assetPath, JSON.stringify(assets));
  await assert.rejects(
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
    transcodeWavToOgg: fakeTranscodeWavToOgg,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sceneCount, 1);
  assert.equal(result.commandCount, 4);
  assert.equal(result.assetCount, 4);
  assert.equal(result.visualAssetCount, 1);
  assert.equal(result.visualHighQualityFallbackAssetCount, 0);
  assert.ok(result.visualHighQualityBytes > 0);
  assert.ok(result.visualPceBytes > 0);
  assert.equal(result.audioAssetCount, 2);
  assert.equal(result.transcodedAudioAssetCount, 2);
  assert.ok(result.audioPackageBytes < result.audioSourceBytes);
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
    transcodeWavToOgg: fakeTranscodeWavToOgg,
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
