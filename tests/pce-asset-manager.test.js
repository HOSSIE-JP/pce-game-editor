'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadAssetManager(userData = makeTempDir('pce-assets-user-data-')) {
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-asset-manager.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-assets-home-') },
  });
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = PNG_CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePngDataUrl(width = 16, height = 16) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const colors = [
    [0, 0, 0, 0],
    [0, 36, 72, 255],
    [108, 180, 216, 255],
    [252, 216, 144, 255],
  ];
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const color = colors[((x >> 3) + (y >> 3)) % colors.length];
      const offset = row + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND'),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeSinglePixelPngDataUrl(width = 16, height = 16, pixel = { x: 0, y: 0, rgba: [255, 0, 0, 255] }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const rgba = x === pixel.x && y === pixel.y ? pixel.rgba : [0, 0, 0, 0];
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND'),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeSolidPngDataUrl(width = 8, height = 8, rgba = [0, 146, 219, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND'),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeWavBuffer(sampleRate = 8000, frames = 32) {
  const dataSize = frames * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
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
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(i % 2 ? 12000 : -12000, 44 + (i * 2));
  }
  return buffer;
}

function writeFile(projectDir, relativePath, bytes) {
  const absPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
}

test('PCE asset schema supports BG image, sprite, generated metadata, and legacy mosaic', () => {
  const assetManager = loadAssetManager();
  const image = assetManager.normalizeAsset({
    id: 'title-bg',
    type: 'image',
    name: 'Title BG',
    source: 'assets/images/title.png',
    options: { paletteBank: 2, tileBase: 64 },
    data: {
      generated: {
        paletteFile: 'assets/generated/title-bg/palette.bin',
        tilesFile: 'assets/generated/title-bg/tiles.bin',
        mapFile: 'assets/generated/title-bg/map.bin',
        previewFile: 'assets/generated/title-bg/preview.json',
        tileCount: 12,
        paletteCount: 2,
        vramBytes: 512,
        warnings: ['ok'],
      },
    },
  });
  const sprite = assetManager.normalizeAsset({
    id: 'hero',
    type: 'sprite',
    source: 'assets/sprites/hero.png',
    options: { cellWidth: 32, cellHeight: 64, paletteBank: 1 },
  });
  const psg = assetManager.normalizeAsset({ id: 'old-beep', type: 'psg-sequence', options: { period: 384 } });
  const adpcm = assetManager.normalizeAsset({ id: 'voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', options: { sampleRate: 12000 } });
  const cdda = assetManager.normalizeAsset({ id: 'track', type: 'cdda-track', source: 'assets/cdda/track.wav', options: { track: 3 } });

  assert.equal(image.options.kind, 'background');
  assert.equal(image.options.cellWidth, 8);
  assert.equal(image.data.generated.tileCount, 12);
  assert.equal(sprite.options.kind, 'sprite');
  assert.equal(sprite.options.cellWidth, 32);
  assert.equal(sprite.options.cellHeight, 64);
  assert.equal(psg.type, 'psg-sfx');
  assert.equal(psg.options.period, 384);
  assert.equal(adpcm.options.sampleRate, 12000);
  assert.equal(cdda.options.track, 3);
  assert.throws(() => assetManager.normalizeAsset({ id: 'bad', type: 'image', source: '/tmp/bad.png' }), /project relative/);
  assert.throws(() => assetManager.normalizeAsset({ id: 'bad', type: 'image', source: 'C:\\bad\\asset.png' }), /project relative/);
  assert.throws(() => assetManager.normalizeAsset({ id: 'bad', type: 'image', source: '../bad.png' }), /project relative/);
});

test('PCE audio import converts WAV into ADPCM and CD-DA assets', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-audio-');
  const source = path.join(makeTempDir('pce-assets-audio-source-'), 'voice.wav');
  fs.writeFileSync(source, makeWavBuffer());

  const adpcm = assetManager.importAudio(projectDir, {
    sourcePath: source,
    sourceFileName: 'voice.wav',
    kind: 'adpcm',
    id: 'voice',
    sampleRate: 12000,
  });
  const cdda = assetManager.importAudio(projectDir, {
    sourcePath: source,
    sourceFileName: 'track.wav',
    kind: 'cdda-track',
    id: 'track',
    track: 4,
  });

  assert.equal(adpcm.asset.type, 'adpcm');
  assert.equal(adpcm.asset.options.sampleRate, 12000);
  assert.match(adpcm.asset.data.generated.outputFile, /adpcm\.bin$/);
  assert.equal(fs.existsSync(path.join(projectDir, adpcm.asset.data.generated.outputFile)), true);
  assert.equal(cdda.asset.type, 'cdda-track');
  assert.equal(cdda.asset.options.track, 4);
  assert.match(cdda.asset.data.generated.outputFile, /cdda\.wav$/);
  assert.equal(fs.existsSync(path.join(projectDir, cdda.asset.data.generated.outputFile)), true);
});

test('PCE image import generates BG and sprite assets with the internal converter', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-import-');
  const bg = assetManager.importImage(projectDir, {
    sourceFileName: 'title.png',
    convertedDataUrl: makePngDataUrl(32, 16),
    kind: 'background',
    id: 'title',
    tileBase: 48,
  });
  const sprite = assetManager.importImage(projectDir, {
    sourceFileName: 'hero.bmp',
    convertedDataUrl: makePngDataUrl(32, 32),
    kind: 'sprite',
    id: 'hero',
    cellWidth: 32,
    cellHeight: 32,
  });

  assert.equal(bg.asset.type, 'image');
  assert.equal(bg.commandInfo.mode, 'internal-pce');
  assert.equal(bg.commandInfo.command, 'Internal PCE image converter');
  assert.deepEqual(bg.commandInfo.args, []);
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.paletteFile)), true);
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.tilesFile)), true);
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.mapFile)), true);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.paletteFile)).length, 32);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.tilesFile)).length, 256);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.mapFile)).length, 16);
  assert.equal(bg.asset.data.generated.tileCount, 8);
  assert.equal(sprite.asset.type, 'sprite');
  assert.equal(sprite.commandInfo.mode, 'internal-pce');
  assert.equal(sprite.commandInfo.outputKind, 'sprite');
  assert.equal(fs.existsSync(path.join(projectDir, sprite.asset.data.generated.paletteFile)), true);
  assert.equal(fs.existsSync(path.join(projectDir, sprite.asset.data.generated.tilesFile)), true);
  assert.equal(fs.readFileSync(path.join(projectDir, sprite.asset.data.generated.tilesFile)).length, 512);
  assert.equal(sprite.asset.data.generated.tileCount, 4);
  assert.match(sprite.asset.source, /^assets\/sprites\/hero\.png$/);
});

test('PCE sprite import writes VCE colors and sprite pattern words in hardware order', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-sprite-order-');
  const imported = assetManager.importImage(projectDir, {
    sourceFileName: 'marker.png',
    convertedDataUrl: makeSinglePixelPngDataUrl(),
    kind: 'sprite',
    id: 'marker',
    cellWidth: 16,
    cellHeight: 16,
  });

  const palette = fs.readFileSync(path.join(projectDir, imported.asset.data.generated.paletteFile));
  const patterns = fs.readFileSync(path.join(projectDir, imported.asset.data.generated.tilesFile));

  assert.equal(palette.readUInt16LE(2), 0x0038);
  assert.equal(imported.asset.data.generated.paletteColors[1], '#ff0000');
  assert.equal(patterns.readUInt16LE(0), 0x8000);
  assert.equal(patterns.subarray(2).every((byte) => byte === 0), true);
});

test('PCE background import reserves palette color 0 for black backdrop', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-bg-backdrop-');
  const imported = assetManager.importImage(projectDir, {
    sourceFileName: 'sky.png',
    convertedDataUrl: makeSolidPngDataUrl(8, 8, [0, 146, 219, 255]),
    kind: 'background',
    id: 'sky',
  });

  const palette = fs.readFileSync(path.join(projectDir, imported.asset.data.generated.paletteFile));
  const tiles = fs.readFileSync(path.join(projectDir, imported.asset.data.generated.tilesFile));

  assert.equal(palette.readUInt16LE(0), 0x0000);
  assert.equal(palette.readUInt16LE(2), 0x0106);
  assert.equal(imported.asset.data.generated.paletteColors[0], '#000000');
  assert.equal(imported.asset.data.generated.paletteColors[1], '#0092db');
  for (let y = 0; y < 8; y += 1) {
    assert.equal(tiles[y * 2], 0xff);
    assert.equal(tiles[(y * 2) + 1], 0x00);
    assert.equal(tiles[16 + (y * 2)], 0x00);
    assert.equal(tiles[16 + (y * 2) + 1], 0x00);
  }
});

test('PCE image import no longer requires an external converter tool', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-internal-tool-');

  const imported = assetManager.importImage(projectDir, {
    sourceFileName: 'title.png',
    convertedDataUrl: makePngDataUrl(16, 16),
    kind: 'background',
    id: 'title',
  });
  assert.equal(imported.conversion.ok, true);
  assert.equal(imported.asset.data.import.converter, 'Internal PCE image converter');
});

test('PCE asset preview and reorder stay inside project root', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-safety-');
  writeFile(projectDir, 'assets/images/title.png', Buffer.from([137, 80, 78, 71]));
  assetManager.writeAssetDocument(projectDir, {
    version: 1,
    assets: [
      { id: 'a', type: 'image', source: 'assets/images/title.png' },
      { id: 'b', type: 'sprite', source: 'assets/images/title.png' },
    ],
  });

  assert.equal(assetManager.previewSource(projectDir, 'assets/images/title.png').mime, 'image/png');
  assert.throws(() => assetManager.previewSource(projectDir, '../outside.png'), /project/);
  assert.throws(() => assetManager.previewSource(projectDir, '/tmp/outside.png'), /project/);

  const outsideDir = makeTempDir('pce-assets-outside-');
  const outsideFile = path.join(outsideDir, 'outside.png');
  fs.writeFileSync(outsideFile, Buffer.from([1, 2, 3]));
  fs.mkdirSync(path.join(projectDir, 'assets', 'links'), { recursive: true });
  try {
    fs.symlinkSync(outsideFile, path.join(projectDir, 'assets', 'links', 'outside.png'));
    assert.throws(() => assetManager.previewSource(projectDir, 'assets/links/outside.png'), /escapes root/);
  } catch (err) {
    if (!['EPERM', 'EACCES'].includes(err.code)) throw err;
  }

  const reordered = assetManager.reorderAssets(projectDir, ['b', 'a']);
  assert.deepEqual(reordered.assets.map((asset) => asset.id), ['b', 'a']);
});

test('PCE generated assets emit BG and sprite C arrays plus legacy fallback', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-generate-');
  writeFile(projectDir, 'assets/generated/bg/palette.bin', Buffer.alloc(32, 0x07));
  writeFile(projectDir, 'assets/generated/bg/tiles.bin', Buffer.alloc(64, 0x11));
  writeFile(projectDir, 'assets/generated/bg/map.bin', Buffer.alloc(8, 0x22));
  writeFile(projectDir, 'assets/generated/spr/palette.bin', Buffer.alloc(32, 0x03));
  writeFile(projectDir, 'assets/generated/spr/patterns.bin', Buffer.alloc(128, 0x44));
  assetManager.writeAssetDocument(projectDir, {
    version: 1,
    assets: [
      {
        id: 'bg',
        type: 'image',
        source: 'assets/images/bg.png',
        options: { width: 16, height: 16, tileBase: 32, mapBase: 0 },
        data: {
          generated: {
            paletteFile: 'assets/generated/bg/palette.bin',
            tilesFile: 'assets/generated/bg/tiles.bin',
            mapFile: 'assets/generated/bg/map.bin',
            tileCount: 2,
            paletteCount: 1,
            vramBytes: 72,
          },
        },
      },
      {
        id: 'spr',
        type: 'sprite',
        source: 'assets/sprites/spr.png',
        options: { width: 16, height: 16, cellWidth: 16, cellHeight: 16, tileBase: 384 },
        data: {
          generated: {
            paletteFile: 'assets/generated/spr/palette.bin',
            tilesFile: 'assets/generated/spr/patterns.bin',
            tileCount: 1,
            paletteCount: 1,
            vramBytes: 128,
          },
        },
      },
      {
        id: 'beep',
        type: 'psg-sfx',
        source: '',
        options: {
          period: 512,
          bpm: 150,
          steps: 16,
          pattern: [
            { step: 0, channel: 0, period: 512, volume: 20 },
            { step: 2, channel: 1, period: 1024, volume: 12 },
          ],
        },
      },
      {
        id: 'voice',
        type: 'adpcm',
        source: 'assets/adpcm/voice.wav',
        options: { sampleRate: 16000 },
        data: {
          generated: {
            outputFile: 'assets/generated/voice/adpcm.bin',
            byteLength: 4,
            sampleRate: 16000,
          },
        },
      },
      {
        id: 'track',
        type: 'cdda-track',
        source: 'assets/cdda/track.wav',
        options: { track: 2 },
      },
    ],
  });
  writeFile(projectDir, 'assets/generated/voice/adpcm.bin', Buffer.from([1, 2, 3, 4]));

  const result = assetManager.generateAssetSources(projectDir);
  const header = fs.readFileSync(result.headerPath, 'utf-8');
  const source = fs.readFileSync(result.sourcePath, 'utf-8');

  assert.equal(result.bgCount, 1);
  assert.equal(result.spriteCount, 1);
  assert.match(header, /pce_editor_bg_asset_t/);
  assert.match(header, /pce_editor_sprite_asset_t/);
  assert.match(header, /pce_editor_psg_asset_t/);
  assert.match(header, /pce_editor_adpcm_asset_t/);
  assert.match(header, /pce_editor_cdda_asset_t/);
  assert.match(source, /static const unsigned char pce_editor_image_bg_palette\[\]/);
  assert.match(source, /static const unsigned char pce_editor_sprite_spr_patterns\[\]/);
  assert.match(source, /static const pce_editor_psg_step_t pce_editor_psg_beep_pattern\[\]/);
  assert.match(source, /static const unsigned char pce_editor_adpcm_voice_data\[\]/);
  assert.match(source, /const unsigned char pce_editor_bg_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_sprite_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_psg_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_adpcm_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_cdda_asset_count = 1/);
  assert.match(source, /pce_editor_image_rows/);
});

test('PCE CD asset source generation streams large payloads through cd.dataFiles', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-cd-assets-');
  writeFile(projectDir, 'project.json', JSON.stringify({ targetMedia: 'cd', toolchain: 'llvm-mos' }, null, 2));
  writeFile(projectDir, 'assets/generated/bg/palette.bin', Buffer.alloc(32, 0x01));
  writeFile(projectDir, 'assets/generated/bg/tiles.bin', Buffer.alloc(2048, 0x22));
  writeFile(projectDir, 'assets/generated/bg/map.bin', Buffer.alloc(1152, 0x80));
  writeFile(projectDir, 'assets/generated/bg/map_vram.bin', Buffer.alloc(2048, 0x80));
  writeFile(projectDir, 'assets/generated/hero/palette.bin', Buffer.alloc(32, 0x02));
  writeFile(projectDir, 'assets/generated/hero/patterns.bin', Buffer.alloc(4096, 0x33));
  writeFile(projectDir, 'assets/generated/voice/adpcm.bin', Buffer.alloc(4096, 0x44));
  writeFile(projectDir, 'assets/pce-assets.json', JSON.stringify({
    version: 2,
    assets: [
      {
        id: 'bg',
        type: 'image',
        source: 'assets/images/bg.png',
        options: { width: 288, height: 128, tileBase: 128, mapBase: 130 },
        data: { generated: {
          paletteFile: 'assets/generated/bg/palette.bin',
          tilesFile: 'assets/generated/bg/tiles.bin',
          mapFile: 'assets/generated/bg/map.bin',
          mapVramFile: 'assets/generated/bg/map_vram.bin',
        } },
      },
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: { width: 64, height: 128, cellWidth: 16, cellHeight: 16, patternBase: 880, paletteBank: 1 },
        data: { generated: {
          paletteFile: 'assets/generated/hero/palette.bin',
          tilesFile: 'assets/generated/hero/patterns.bin',
        } },
      },
      {
        id: 'voice',
        type: 'adpcm',
        source: 'assets/adpcm/voice.wav',
        data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } },
      },
    ],
  }, null, 2));

  const result = assetManager.generateAssetSources(projectDir);
  const header = fs.readFileSync(result.headerPath, 'utf-8');
  const source = fs.readFileSync(result.sourcePath, 'utf-8');

  assert.equal(result.imageRows, 0);
  assert.equal(result.bankedChunkCount, 0);
  assert.deepEqual(assetManager.collectCdDataFiles(projectDir), [
    'assets/generated/bg/tiles.bin',
    'assets/generated/bg/map_vram.bin',
    'assets/generated/hero/patterns.bin',
    'assets/generated/voice/adpcm.bin',
  ]);
  assert.match(header, /pce_editor_cd_data_ref_t/);
  assert.doesNotMatch(source, /PCE_RAM_BANK_AT\(129, 3\);/);
  assert.doesNotMatch(source, /pce_editor_image_bg_map_bank129/);
  assert.match(source, /pce_editor_image_bg_tiles_cd = \{ \{ 64u, 0u, 0u \}, 1u \};/);
  assert.match(source, /pce_editor_image_bg_map_cd = \{ \{ 65u, 0u, 0u \}, 1u \};/);
  assert.match(source, /pce_editor_sprite_hero_patterns_cd = \{ \{ 66u, 0u, 0u \}, 2u \};/);
  assert.match(source, /pce_editor_adpcm_voice_data_cd = \{ \{ 68u, 0u, 0u \}, 2u \};/);
  assert.doesNotMatch(source, /extern const unsigned char __cd_assets_generated_bg_tiles_bin/);
  assert.doesNotMatch(source, /__cd_assets_generated_bg_tiles_bin_sector/);
  assert.doesNotMatch(source, /pce_editor_cd_sector_t __cd_assets_generated_bg_tiles_bin =/);
  assert.doesNotMatch(source, /_sector = \{ 0u, 0u, 0u \};/);
  assert.doesNotMatch(source, /_sector_count = 0u;/);
  assert.match(source, /&pce_editor_image_bg_tiles_cd/);
  assert.match(source, /&pce_editor_image_bg_map_cd/);
  assert.match(source, /&pce_editor_sprite_hero_patterns_cd/);
  assert.match(source, /&pce_editor_adpcm_voice_data_cd/);
  assert.doesNotMatch(source, /static const unsigned char pce_editor_image_bg_tiles\[\]/);
  assert.doesNotMatch(source, /static const unsigned char pce_editor_image_bg_map\[\]/);
  assert.doesNotMatch(source, /pce_editor_sprite_hero_patterns_bank129/);
  assert.doesNotMatch(source, /static const unsigned char pce_editor_adpcm_voice_data\[\]/);
});

test('PCE sample template registers slideshow images and PSG BGM assets', () => {
  const templateDir = path.join(__dirname, '..', 'template', 'template_pce_sample');
  const doc = JSON.parse(fs.readFileSync(path.join(templateDir, 'assets', 'pce-assets.json'), 'utf-8'));
  const slides = doc.assets.filter((entry) => entry.type === 'image' && entry.id.startsWith('slide_'));
  const bgm = doc.assets.find((entry) => entry.id === 'slideshow_bgm');

  assert.equal(doc.version, 2);
  assert.equal(slides.length, 5);
  assert.ok(slides.every((asset) => asset.options.kind === 'background'));
  assert.ok(slides.every((asset) => asset.options.width === 256 && asset.options.height === 224));
  assert.ok(slides.every((asset) => asset.options.tileBase === 64 && asset.options.mapBase === 0));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.source))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.paletteFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.tilesFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.mapFile))));
  assert.ok(bgm);
  assert.equal(bgm.type, 'psg-song');
  assert.equal(bgm.options.kind, 'song');
  assert.ok(bgm.options.pattern.length >= 32);
  const sampleMain = fs.readFileSync(path.join(templateDir, 'src', 'main.c'), 'utf-8');
  assert.match(sampleMain, /show_slide/);
  assert.match(sampleMain, /apply_bg_palette_level/);
  assert.match(sampleMain, /bgm_tick/);
  assert.match(sampleMain, /PCE_VDC_CR_VRAM_ADD_1/);
  assert.match(sampleMain, /pce_editor_vdc_write\(5,\s*PCE_VDC_CR_BG_ENABLE \| PCE_VDC_CR_DRAM_REFRESH \| PCE_VDC_CR_VRAM_ADD_1\)/);

  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-slideshow-template-');
  fs.cpSync(templateDir, projectDir, { recursive: true });
  const generated = assetManager.generateAssetSources(projectDir);
  const generatedSource = fs.readFileSync(generated.sourcePath, 'utf-8');
  const generatedHeader = fs.readFileSync(generated.headerPath, 'utf-8');
  assert.equal(generated.bgCount, 5);
  assert.match(generatedHeader, /pce_editor_data_ref_t/);
  assert.match(generatedSource, /PCE_ROM_BANK_AT\(1, 6\)/);
  assert.ok(generatedSource.includes('PCE_EDITOR_BANKED_SECTION(".rom_bank1")'));
  assert.match(generatedSource, /pce_editor_image_slide_01_seaside_tiles_chunks/);
  assert.match(generatedSource, /pce_editor_map_asset_bank/);
});
