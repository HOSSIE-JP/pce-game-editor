'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const converter = require('../plugins/pce-kitahe-pm-converter/converter');
const plugin = require('../plugins/pce-kitahe-pm-converter');
const assetPackage = require('../plugins/pce-kitahe-pm-converter/asset-package');
const assetManager = require('../pce-asset-manager');
const { loadWithMockedElectron } = require('./helpers/mock-electron');
const { addCdWarningAudio } = require('./helpers/cdda-warning');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadBuildSystem() {
  const userData = tempDir('pce-kitahe-package-build-user-');
  delete require.cache[require.resolve('../pce-build-system')];
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-vn-manager')];
  delete require.cache[require.resolve('../pce-vn-hucard-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-build-system.js'), {
    userData,
    paths: { userData, home: tempDir('pce-kitahe-package-build-home-') },
  });
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([size, typeBytes, data, crc]);
}

function makePng(width = 16, height = 16) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + (x * 4);
      scanlines[offset] = x * 8;
      scanlines[offset + 1] = y * 8;
      scanlines[offset + 2] = 96;
      scanlines[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND'),
  ]);
}

function makeWav(sampleRate = 22050, frames = 2205) {
  const dataBytes = frames * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function makeMidi() {
  const track = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 69, 100,
    0x81, 0x70, 0x80, 69, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  return Buffer.concat([
    Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]),
    Buffer.from([0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length]),
    Buffer.from(track),
  ]);
}

function csvField(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeManifest(packageRoot, rows, headers = assetPackage.MANIFEST_HEADERS, options = {}) {
  const lines = [headers.join(',')];
  rows.forEach((row) => lines.push(headers.map((header) => csvField(row[header])).join(',')));
  const manifestPath = path.join(packageRoot, assetPackage.MANIFEST_FILE_NAME);
  const bom = options.bom === false ? '' : '\uFEFF';
  fs.writeFileSync(manifestPath, Buffer.from(`${bom}${lines.join('\r\n')}\r\n`, 'utf-8'));
  return manifestPath;
}

function makePackage() {
  const packageRoot = tempDir('pce-kitahe-package-');
  const projectDir = tempDir('pce-kitahe-package-project-');
  fs.mkdirSync(path.join(packageRoot, 'images'));
  fs.mkdirSync(path.join(packageRoot, 'audio'));
  fs.mkdirSync(path.join(packageRoot, 'midi'));
  const png = makePng();
  const wav = makeWav();
  const midi = makeMidi();
  fs.writeFileSync(path.join(packageRoot, 'images', 'bgf011.png'), png);
  fs.writeFileSync(path.join(packageRoot, 'audio', 'v001.wav'), wav);
  fs.writeFileSync(path.join(packageRoot, 'midi', 'track11.mid'), midi);
  const imageSource = 'BG/KYOTSUU/BGF011_A.PVR + BG/KYOTSUU/BGF011_B.PVR';
  const imageDetails = {
    crops: [{ height: 240, width: 320 }, { height: 240, width: 320 }],
    exportCrop: { height: 16, width: 16, x: 0, y: 0 },
    fileSha256: converter.sha256(png),
    orderedSlots: ['0', '1'],
    parts: ['BG/KYOTSUU/BGF011_A.PVR', 'BG/KYOTSUU/BGF011_B.PVR'],
    source: imageSource,
  };
  const p04Details = {
    fileSha256: converter.sha256(wav),
    loop: false,
    playbackRate: 22050,
    source: 'VOICE/AY/V001.P04',
    targetSampleRate: 8000,
    usage: 'voice',
  };
  const midiDetails = {
    fileSha256: converter.sha256(midi),
    source: 'MIDI/PM_bank00_track11.mid',
    track: 11,
  };
  const rows = [
    {
      version: 1,
      kind: 'image',
      targetType: 'background',
      sourceKey: converter.assetSourceKey('image', imageDetails.parts, imageDetails),
      source: imageDetails.parts.join(' + '),
      file: 'images/bgf011.png',
      id: 'bgf011',
      name: 'BG/KYOTSUU/BGF011',
      usage: '',
      playbackRate: '',
      loop: false,
      sampleRate: '',
      splitPolicy: '',
      details: converter.stableJson(imageDetails),
    },
    {
      version: 1,
      kind: 'p04',
      targetType: 'adpcm',
      sourceKey: converter.assetSourceKey('p04', 'VOICE/AY/V001.P04', p04Details),
      source: 'VOICE/AY/V001.P04',
      file: 'audio/v001.wav',
      id: 'voice_v001',
      name: 'VOICE/AY/V001',
      usage: 'voice',
      playbackRate: 22050,
      loop: false,
      sampleRate: 8000,
      splitPolicy: 'error',
      details: converter.stableJson(p04Details),
    },
    {
      version: 1,
      kind: 'midi',
      targetType: 'psg-song',
      sourceKey: converter.assetSourceKey('midi', 'MIDI/PM_bank00_track11.mid'),
      source: 'MIDI/PM_bank00_track11.mid',
      file: 'midi/track11.mid',
      id: 'track11',
      name: 'MIDI/PM_bank00_track11',
      usage: 'bgm',
      playbackRate: '',
      loop: false,
      sampleRate: '',
      splitPolicy: '',
      details: converter.stableJson(midiDetails),
    },
  ];
  return { packageRoot, projectDir, rows, manifestPath: writeManifest(packageRoot, rows) };
}

test('Kitahe PM asset package strict inspector validates PNG/WAV/MIDI and signatures', () => {
  const fixture = makePackage();
  const context = { projectDir: fixture.projectDir, assets: [], logger: {} };
  try {
    const inspected = plugin.inspectKitahePmAssetPackage({
      manifestPath: fixture.manifestPath,
      targetMedia: 'cd',
    }, context);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.canImport, true);
    assert.deepEqual(inspected.summary, {
      total: 3,
      valid: 3,
      error: 0,
      warning: 0,
      create: 3,
      update: 0,
      errorCount: 0,
      warningCount: 0,
    });
    assert.match(inspected.rows[0].preview.dataUrl, /^data:image\/png;base64,/u);
    assert.equal(inspected.rows[0].preview.width, 16);
    assert.equal(inspected.rows[1].preview.dataUrl, undefined);
    assert.equal(inspected.rows[1].preview.sampleRate, 8000);
    assert.ok(inspected.rows[1].preview.estimatedAdpcmBytes > 0);
    assert.equal(inspected.rows[2].preview.dataUrl, undefined);
    assert.equal(inspected.rows[2].preview.type, 'psg-song');
    assert.ok(inspected.rows.every((row) => /^[a-f0-9]{64}$/u.test(row.hash)));

    fs.writeFileSync(path.join(fixture.packageRoot, 'audio', 'v001.wav'), makeWav(22050, 4410));
    const changed = plugin.inspectKitahePmAssetPackage({
      manifestPath: fixture.manifestPath,
      targetMedia: 'cd',
    }, context);
    assert.equal(changed.ok, true);
    assert.notEqual(changed.inspectionSignature, inspected.inspectionSignature);
    assert.equal(changed.canImport, false);
    assert.ok(changed.rows[1].errors.some((message) => /fileSha256/u.test(message)));

    const stale = plugin.inspectKitahePmAssetPackage({
      manifestPath: fixture.manifestPath,
      targetMedia: 'cd',
      assetCatalogSignature: '0'.repeat(64),
    }, context);
    assert.equal(stale.ok, false);
  } finally {
    fs.rmSync(fixture.packageRoot, { recursive: true, force: true });
    fs.rmSync(fixture.projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM asset package rejects strict header, traversal, foreign collision, and junction', () => {
  const fixture = makePackage();
  const outsideRoot = tempDir('pce-kitahe-outside-');
  try {
    const badHeader = writeManifest(fixture.packageRoot, fixture.rows, [...assetPackage.MANIFEST_HEADERS].reverse());
    const headerResult = plugin.inspectKitahePmAssetPackage({ manifestPath: badHeader, targetMedia: 'cd' }, {
      projectDir: fixture.projectDir,
      assets: [],
      logger: {},
    });
    assert.equal(headerResult.ok, false);
    assert.match(headerResult.error, /固定順/u);
    const strictHeaderVariants = [
      ['whitespace', [' version ', ...assetPackage.MANIFEST_HEADERS.slice(1)]],
      ['duplicate', ['version', 'version', ...assetPackage.MANIFEST_HEADERS.slice(2)]],
      ['extra', [...assetPackage.MANIFEST_HEADERS, 'extra']],
    ];
    for (const [label, headers] of strictHeaderVariants) {
      writeManifest(fixture.packageRoot, fixture.rows, headers);
      const result = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
        projectDir: fixture.projectDir,
        assets: [],
        logger: {},
      });
      assert.equal(result.ok, false, label);
      assert.match(result.error, /固定順/u, label);
    }

    writeManifest(fixture.packageRoot, fixture.rows, assetPackage.MANIFEST_HEADERS, { bom: false });
    const missingBom = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
      projectDir: fixture.projectDir,
      assets: [],
      logger: {},
    });
    assert.equal(missingBom.ok, false);
    assert.match(missingBom.error, /BOM/u);


    fixture.rows[0].file = '../outside.png';
    writeManifest(fixture.packageRoot, fixture.rows);
    const traversal = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
      projectDir: fixture.projectDir,
      assets: [],
      logger: {},
    });
    assert.equal(traversal.ok, true);
    assert.equal(traversal.canImport, false);
    assert.ok(traversal.rows[0].errors.some((message) => /traversal/u.test(message)));

    for (const unsafePath of ['images/bgf011.png:stream', 'images/\u0000bgf011.png', 'images/\u0001bgf011.png']) {
      fixture.rows[0].file = unsafePath;
      writeManifest(fixture.packageRoot, fixture.rows);
      const unsafe = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
        projectDir: fixture.projectDir,
        assets: [],
        logger: {},
      });
      assert.equal(unsafe.ok, true);
      assert.equal(unsafe.canImport, false);
      assert.ok(unsafe.rows[0].errors.some((message) => /relative path/u.test(message)));
    }

    fixture.rows[0].file = 'images/bgf011.png';
    writeManifest(fixture.packageRoot, fixture.rows);
    const foreign = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
      projectDir: fixture.projectDir,
      assets: [{ id: 'bgf011', type: 'image' }],
      logger: {},
    });
    assert.equal(foreign.canImport, false);
    assert.ok(foreign.rows[0].errors.some((message) => /package外/u.test(message)));

    fixture.rows[1].usage = 'sfx';
    writeManifest(fixture.packageRoot, fixture.rows);
    const tamperedDetails = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
      projectDir: fixture.projectDir,
      assets: [],
      logger: {},
    });
    assert.ok(tamperedDetails.rows[1].errors.some((message) => /details\.usage/u.test(message)));
    fixture.rows[1].usage = 'voice';

    fs.writeFileSync(path.join(outsideRoot, 'linked.png'), makePng());
    fs.symlinkSync(outsideRoot, path.join(fixture.packageRoot, 'linked-images'), 'junction');
    fixture.rows[0].file = 'linked-images/linked.png';
    writeManifest(fixture.packageRoot, fixture.rows);
    const junction = plugin.inspectKitahePmAssetPackage({ manifestPath: fixture.manifestPath, targetMedia: 'cd' }, {
      projectDir: fixture.projectDir,
      assets: [],
      logger: {},
    });
    assert.equal(junction.canImport, false);
    assert.ok(junction.rows[0].errors.some((message) => /symlink\/junction/u.test(message)));
  } finally {
    fs.rmSync(fixture.packageRoot, { recursive: true, force: true });
    fs.rmSync(fixture.projectDir, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('Kitahe PM inspected package imports BG, Sprite, ADPCM, and PSG into a CD VN dry build', async () => {
  const fixture = makePackage();
  try {
    fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), fixture.projectDir, { recursive: true });
    addCdWarningAudio(fixture.projectDir);

    const spriteBytes = makePng(16, 16);
    fs.writeFileSync(path.join(fixture.packageRoot, 'images', 'ayu_sprite.png'), spriteBytes);
    const spriteSource = 'NEW/AYU/KAPM_001.PVR';
    const spriteDetails = {
      crops: [{ height: null, width: null }],
      exportCrop: { height: 16, width: 16, x: 0, y: 0 },
      fileSha256: converter.sha256(spriteBytes),
      orderedSlots: ['0'],
      outputSize: { height: 16, width: 16 },
      parts: [spriteSource],
      source: spriteSource,
      sourceCrop: { height: 334, width: 251, x: 114, y: 0 },
      sourceSize: { height: 480, width: 512 },
      spriteCell: { height: 16, width: 16 },
    };
    fixture.rows.push({
      version: 1,
      kind: 'image',
      targetType: 'sprite',
      sourceKey: converter.assetSourceKey('image', spriteDetails.parts, spriteDetails),
      source: spriteSource,
      file: 'images/ayu_sprite.png',
      id: 'ayu_sprite',
      name: 'NEW/AYU/KAPM_001',
      usage: '',
      playbackRate: '',
      loop: false,
      sampleRate: '',
      splitPolicy: '',
      details: converter.stableJson(spriteDetails),
    });
    fixture.manifestPath = writeManifest(fixture.packageRoot, fixture.rows);

    const inspected = plugin.inspectKitahePmAssetPackage({
      manifestPath: fixture.manifestPath,
      targetMedia: 'cd',
    }, {
      projectDir: fixture.projectDir,
      assets: assetManager.listAssets(fixture.projectDir).assets,
      logger: {},
    });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.canImport, true);
    assert.equal(inspected.rows.length, 4);
    const inspectedSprite = inspected.rows.find((row) => row.id === 'ayu_sprite');
    assert.deepEqual(inspectedSprite.provenance.imageTransform, {
      sourceSize: { width: 512, height: 480 },
      sourceCrop: { x: 114, y: 0, width: 251, height: 334 },
      outputSize: { width: 16, height: 16 },
    });

    for (const row of inspected.rows) {
      const common = {
        sourcePath: row.filePath,
        sourceFileName: path.basename(row.file),
        id: row.id,
        name: row.name,
        replacePolicy: 'owned-source-key',
        kitahePm: row.provenance,
      };
      let imported;
      if (row.kind === 'image') {
        imported = assetManager.importImage(fixture.projectDir, {
          ...common,
          kind: row.targetType === 'sprite' ? 'sprite' : 'background',
          width: row.preview.width,
          height: row.preview.height,
          cellWidth: row.targetType === 'sprite' ? row.cellWidth : undefined,
          cellHeight: row.targetType === 'sprite' ? row.cellHeight : undefined,
        });
      } else if (row.kind === 'p04') {
        imported = assetManager.importAudio(fixture.projectDir, {
          ...common,
          kind: 'adpcm',
          sampleRate: row.sampleRate,
          loop: row.loop,
          splitPolicy: 'error',
          rejectOversize: true,
        });
      } else {
        imported = assetManager.importMidi(fixture.projectDir, {
          ...common,
          type: 'psg-song',
        });
      }
      assert.equal(imported.asset.data.import.kitahePm.sourceKey, row.sourceKey);
    }

    const importedById = new Map(assetManager.listAssets(fixture.projectDir).assets.map((asset) => [asset.id, asset]));
    assert.equal(importedById.get('bgf011').type, 'image');
    assert.equal(importedById.get('ayu_sprite').type, 'sprite');
    assert.deepEqual(importedById.get('ayu_sprite').data.import.kitahePm.imageTransform, inspectedSprite.provenance.imageTransform);
    assert.equal(importedById.get('voice_v001').type, 'adpcm');
    assert.equal(importedById.get('track11').type, 'psg-song');

    const scenePath = path.join(fixture.projectDir, 'assets', 'pce-vn-scenes.json');
    const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    sceneDoc.startScene = 'opening';
    sceneDoc.scenes = [{
      id: 'opening',
      fullScreenBg: false,
      commands: [
        { type: 'background', assetId: 'bgf011', x: 0, y: 0 },
        { type: 'sprite', slot: 0, assetId: 'ayu_sprite', x: 16, y: 16, visible: true },
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'track11', channel: 0 },
        { type: 'audio', kind: 'adpcm', action: 'play', assetId: 'voice_v001', channel: 0 },
        { type: 'message', speaker: 'PM', text: 'PACKAGE IMPORT OK', voiceAssetId: 'voice_v001', mouthSlot: 0 },
      ],
      nextSceneId: '',
    }];
    fs.writeFileSync(scenePath, JSON.stringify(sceneDoc, null, 2), 'utf8');

    const buildSystem = loadBuildSystem();
    buildSystem.openProject(fixture.projectDir);
    const result = await buildSystem.buildProject(() => {}, {
      dryRun: true,
      allowMissingToolchain: true,
    });
    assert.equal(result.success, true, result.error || 'CD VN dry build failed');
    assert.equal(path.extname(result.commandInfo.cuePath), '.cue');
    assert.equal(result.generated.visualNovel.sceneCount, 1);
    assert.equal(result.generated.visualNovel.messageCount, 1);
  } finally {
    fs.rmSync(fixture.packageRoot, { recursive: true, force: true });
    fs.rmSync(fixture.projectDir, { recursive: true, force: true });
  }
});
