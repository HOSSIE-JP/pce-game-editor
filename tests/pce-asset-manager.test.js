'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const audioConverter = require('../pce-audio-converter');
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

function makeWavDataUrl(sampleRate = 8000, frames = 32) {
  return `data:audio/wav;base64,${makeWavBuffer(sampleRate, frames).toString('base64')}`;
}

function pcmBufferErrorScore(left, right) {
  const count = Math.min(Math.floor(left.length / 2), Math.floor(right.length / 2));
  let squaredError = 0;
  for (let index = 0; index < count; index += 1) {
    const error = left.readInt16LE(index * 2) - right.readInt16LE(index * 2);
    squaredError += error * error;
  }
  return Math.sqrt(squaredError / Math.max(1, count));
}

function swapNibbles(buffer) {
  return Buffer.from(buffer.map((byte) => ((byte & 0x0f) << 4) | (byte >> 4)));
}

function writeFile(projectDir, relativePath, bytes) {
  const absPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
}

function makeRleRun(length, byte) {
  const chunks = [];
  let remaining = length;
  while (remaining > 0) {
    const run = Math.min(130, remaining);
    if (run >= 3) {
      chunks.push(0x80 | (run - 3), byte & 0xff);
      remaining -= run;
    } else {
      chunks.push(run - 1);
      for (let i = 0; i < run; i += 1) chunks.push(byte & 0xff);
      remaining -= run;
    }
  }
  return Buffer.from(chunks);
}

function decodePceRle(buffer, expectedLength) {
  const output = [];
  let offset = 0;
  while (offset < buffer.length && output.length < expectedLength) {
    const token = buffer[offset];
    offset += 1;
    if (token & 0x80) {
      const count = (token & 0x7f) + 3;
      const value = buffer[offset];
      offset += 1;
      for (let i = 0; i < count && output.length < expectedLength; i += 1) output.push(value);
    } else {
      const count = (token & 0x7f) + 1;
      for (let i = 0; i < count && output.length < expectedLength; i += 1) {
        output.push(buffer[offset]);
        offset += 1;
      }
    }
  }
  return Buffer.from(output);
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
  const satbOverlapSprite = assetManager.normalizeAsset({
    id: 'talking-hero',
    type: 'sprite',
    source: 'assets/sprites/talking-hero.png',
    options: { width: 256, height: 128, cellWidth: 16, cellHeight: 16, tileBase: 768, paletteBank: 1 },
    data: { generated: { vramBytes: 16384, warnings: ['Sprite patterns overlap the SATB VRAM area; lower tileBase or reduce sprite sheet size'] } },
  });
  const psg = assetManager.normalizeAsset({ id: 'old-beep', type: 'psg-sequence', options: { period: 384 } });
  const adpcm = assetManager.normalizeAsset({ id: 'voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', options: { sampleRate: 12000 } });
  const legacyAdpcm = assetManager.normalizeAsset({ id: 'legacy-voice', type: 'adpcm', source: 'assets/adpcm/legacy.wav', options: { sampleRate: 16000, divider: 1 } });
  const defaultDividerAdpcm = assetManager.normalizeAsset({ id: 'old-default', type: 'adpcm', source: 'assets/adpcm/default.wav', options: { sampleRate: 8000, divider: 0 } });
  const cdda = assetManager.normalizeAsset({ id: 'track', type: 'cdda-track', source: 'assets/cdda/track.wav', options: { track: 3 } });

  assert.equal(image.options.kind, 'background');
  assert.equal(image.options.cellWidth, 8);
  assert.equal(image.options.tileBase, 64);
  assert.equal(image.options.mapBase, 0);
  assert.equal(image.data.generated.tileCount, 12);
  assert.equal(sprite.options.kind, 'sprite');
  assert.equal(sprite.options.cellWidth, 32);
  assert.equal(sprite.options.cellHeight, 64);
  assert.match(satbOverlapSprite.data.generated.warnings.join('\n'), /Sprite patterns overlap the SATB VRAM area/);
  assert.equal(psg.type, 'psg-sfx');
  assert.equal(psg.options.period, 384);
  assert.equal(adpcm.options.sampleRate, 12000);
  assert.equal(adpcm.options.divider, 13);
  assert.equal(legacyAdpcm.options.divider, 14);
  assert.equal(defaultDividerAdpcm.options.divider, 12);
  assert.equal(assetManager.sampleRateToAdpcmDivider(16000), 14);
  assert.equal(assetManager.sampleRateToAdpcmDivider(8000), 12);
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
  assert.equal(adpcm.asset.options.divider, 13);
  assert.match(adpcm.asset.data.generated.outputFile, /adpcm\.bin$/);
  assert.equal(adpcm.asset.data.generated.codec, audioConverter.PCE_ADPCM_CODEC);
  assert.equal(adpcm.asset.data.generated.encoderVersion, audioConverter.PCE_ADPCM_ENCODER_VERSION);
  assert.equal(adpcm.asset.data.generated.nibbleOrder, 'msn-first');
  const adpcmBytes = fs.readFileSync(path.join(projectDir, adpcm.asset.data.generated.outputFile));
  const renderedPcm = audioConverter.renderPcm16(audioConverter.parseWav(fs.readFileSync(source)), { sampleRate: 12000, channels: 1 }).pcm;
  const highNibbleError = pcmBufferErrorScore(renderedPcm, audioConverter.decodeOkiAdpcm(adpcmBytes, { sampleRate: 12000, nibbleOrder: 'msn-first' }).pcm);
  const lowNibbleError = pcmBufferErrorScore(renderedPcm, audioConverter.decodeOkiAdpcm(adpcmBytes, { sampleRate: 12000, nibbleOrder: 'lsn-first' }).pcm);
  assert.equal(fs.existsSync(path.join(projectDir, adpcm.asset.data.generated.outputFile)), true);
  assert.ok(highNibbleError < lowNibbleError / 4);
  assert.equal(cdda.asset.type, 'cdda-track');
  assert.equal(cdda.asset.options.track, 4);
  assert.match(cdda.asset.data.generated.outputFile, /cdda\.wav$/);
  assert.equal(fs.existsSync(path.join(projectDir, cdda.asset.data.generated.outputFile)), true);
});

test('PCE ADPCM diagnostic codec supports low and high nibble orders', () => {
  const wav = audioConverter.parseWav(makeWavBuffer(16000, 256));
  const rendered = audioConverter.renderPcm16(wav, { sampleRate: 16000, channels: 1 });
  const lsnAdpcm = audioConverter.encodeOkiAdpcm(rendered, 0, rendered.frameCount, { nibbleOrder: 'lsn-first' });
  const msnAdpcm = audioConverter.encodeOkiAdpcm(rendered, 0, rendered.frameCount, { nibbleOrder: 'msn-first' });
  const lsnCorrect = audioConverter.decodeOkiAdpcm(lsnAdpcm, { sampleRate: 16000, nibbleOrder: 'lsn-first' });
  const lsnWrong = audioConverter.decodeOkiAdpcm(lsnAdpcm, { sampleRate: 16000, nibbleOrder: 'msn-first' });
  const msnCorrect = audioConverter.decodeOkiAdpcm(msnAdpcm, { sampleRate: 16000, nibbleOrder: 'msn-first' });
  const msnWrong = audioConverter.decodeOkiAdpcm(msnAdpcm, { sampleRate: 16000, nibbleOrder: 'lsn-first' });

  assert.equal(audioConverter.normalizeAdpcmNibbleOrder('high-first'), 'msn-first');
  assert.equal(lsnCorrect.nibbleOrder, 'lsn-first');
  assert.equal(msnCorrect.nibbleOrder, 'msn-first');
  assert.ok(pcmBufferErrorScore(rendered.pcm, lsnCorrect.pcm) < pcmBufferErrorScore(rendered.pcm, lsnWrong.pcm));
  assert.ok(pcmBufferErrorScore(rendered.pcm, msnCorrect.pcm) < pcmBufferErrorScore(rendered.pcm, msnWrong.pcm));
});

test('PCE audio import accepts processed WAV data URLs and keeps MP3 provenance', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-audio-dataurl-');
  const adpcm = assetManager.importAudio(projectDir, {
    dataUrl: makeWavDataUrl(),
    sourceFileName: 'voice.wav',
    originalFileName: 'voice.mp3',
    kind: 'adpcm',
    id: 'voice_from_mp3',
    processing: { trimStartSec: 0.1, trimEndSec: 0.2, normalize: true, volumeDb: -3, fadeInSec: 0.02, fadeOutSec: 0.03, mono: true, sampleRate: 16000, channels: 1 },
    splitPolicy: 'auto',
  });
  const cdda = assetManager.importAudio(projectDir, {
    dataUrl: makeWavDataUrl(),
    sourceFileName: 'theme.wav',
    kind: 'cdda-track',
    id: 'theme',
    track: 5,
  });

  assert.equal(adpcm.asset.type, 'adpcm');
  assert.equal(adpcm.asset.source, 'assets/adpcm/voice_from_mp3.wav');
  assert.equal(adpcm.asset.data.import.originalFileName, 'voice.mp3');
  assert.equal(adpcm.asset.data.import.processing.normalize, true);
  assert.equal(fs.existsSync(path.join(projectDir, adpcm.asset.source)), true);
  assert.equal(cdda.asset.type, 'cdda-track');
  assert.equal(cdda.asset.options.track, 5);
});

test('PCE generated sources refresh stale ADPCM encoder output before build', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-adpcm-refresh-');
  const source = path.join(makeTempDir('pce-assets-adpcm-refresh-source-'), 'voice.wav');
  fs.writeFileSync(source, makeWavBuffer(8000, 64));

  const imported = assetManager.importAudio(projectDir, {
    sourcePath: source,
    sourceFileName: 'voice.wav',
    kind: 'adpcm',
    id: 'voice',
    sampleRate: 8000,
  });
  const outputPath = path.join(projectDir, imported.asset.data.generated.outputFile);
  const expected = fs.readFileSync(outputPath);
  fs.writeFileSync(outputPath, swapNibbles(expected));

  const assetPath = path.join(projectDir, 'assets', 'pce-assets.json');
  const doc = JSON.parse(fs.readFileSync(assetPath, 'utf-8'));
  doc.assets[0].data.generated.encoderVersion = 1;
  fs.writeFileSync(assetPath, JSON.stringify(doc, null, 2), 'utf-8');

  assetManager.generateAssetSources(projectDir);

  const refreshed = fs.readFileSync(outputPath);
  const refreshedDoc = JSON.parse(fs.readFileSync(assetPath, 'utf-8'));
  assert.deepEqual(refreshed, expected);
  assert.equal(refreshedDoc.assets[0].data.generated.codec, audioConverter.PCE_ADPCM_CODEC);
  assert.equal(refreshedDoc.assets[0].data.generated.encoderVersion, audioConverter.PCE_ADPCM_ENCODER_VERSION);
  assert.equal(refreshedDoc.assets[0].data.generated.nibbleOrder, 'msn-first');
});

test('PCE ADPCM import auto-splits assets that exceed runtime-safe size', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-audio-split-');
  writeFile(projectDir, 'project.json', JSON.stringify({ targetMedia: 'cd', toolchain: 'llvm-mos' }, null, 2));

  const result = assetManager.importAudio(projectDir, {
    dataUrl: makeWavDataUrl(8000, 96),
    sourceFileName: 'long.wav',
    kind: 'adpcm',
    id: 'long_voice',
    sampleRate: 8000,
    adpcmAddress: 65530,
    splitPolicy: 'auto',
  });
  const parts = result.assets.filter((asset) => asset.data?.import?.groupId === 'long_voice');

  assert.equal(result.asset.id, 'long_voice_part01');
  assert.equal(result.conversion.partCount > 1, true);
  assert.equal(parts.length, result.conversion.partCount);
  for (const [index, part] of parts.entries()) {
    assert.equal(part.id, `long_voice_part${String(index + 1).padStart(2, '0')}`);
    assert.equal(part.data.import.partCount, result.conversion.partCount);
    assert.equal(part.data.import.maxAdpcmBytes, 6);
    assert.equal(fs.statSync(path.join(projectDir, part.data.generated.outputFile)).size <= 6, true);
  }
  assert.deepEqual(assetManager.collectCdDataFiles(projectDir), parts.map((part) => part.data.generated.outputFile));
});

test('PCE ADPCM streaming import keeps long samples as one CD data file', (t) => {
  // Force CD on-demand metadata so this exercises the meta directory path.
  process.env.PCE_ASSET_META_BUDGET = '0';
  t.after(() => { delete process.env.PCE_ASSET_META_BUDGET; });
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-audio-stream-');
  writeFile(projectDir, 'project.json', JSON.stringify({ targetMedia: 'cd', toolchain: 'llvm-mos' }, null, 2));

  const result = assetManager.importAudio(projectDir, {
    dataUrl: makeWavDataUrl(8000, 96),
    sourceFileName: 'long.wav',
    kind: 'adpcm',
    id: 'long_stream',
    sampleRate: 8000,
    adpcmAddress: 65530,
    stream: true,
    splitPolicy: 'auto',
  });
  const generatedPath = path.join(projectDir, result.asset.data.generated.outputFile);

  assert.equal(result.asset.id, 'long_stream');
  assert.equal(result.asset.options.stream, true);
  assert.equal(result.conversion.partCount, 1);
  assert.equal(fs.statSync(generatedPath).size > 6, true);
  assert.deepEqual(assetManager.collectCdDataFiles(projectDir), ['assets/generated/long_stream/adpcm.bin']);

  const generated = assetManager.generateAssetSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.match(header, /unsigned long data_size;/);
  // ADPCM descriptors are CD on-demand now: a constant region directory + the
  // record bytes in ASSET_META_FILE (adpcm.bin@64, meta@65 -> adpcm region@65).
  assert.match(source, /const pce_editor_meta_region_t pce_editor_adpcm_meta = \{ \{ 65u, 0u, 0u \}, 1u \};/);
  assert.match(source, /const unsigned char pce_editor_adpcm_asset_count = 1;/);
  assert.doesNotMatch(source, /pce_editor_adpcm_long_stream_data_cd PCE_EDITOR_CD_REF_SECTION/);
  const meta = fs.readFileSync(path.join(projectDir, 'assets/generated/meta/asset_meta.bin'));
  assert.equal(meta.readUInt16LE(6), 8000); // sample_rate
  assert.equal(meta.readUInt16LE(8), 65530); // adpcm_address
  assert.equal(meta[10], 12); // divider (8000Hz quantized code)
  assert.equal(meta[12], 1); // stream
  assert.equal(meta[15], 64); // adpcm cd sector lo
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
  const overlapSprite = assetManager.importImage(projectDir, {
    sourceFileName: 'talking-hero.png',
    convertedDataUrl: makePngDataUrl(256, 128),
    kind: 'sprite',
    id: 'talking_hero',
    cellWidth: 16,
    cellHeight: 16,
    tileBase: 2040,
  });
  const webp = assetManager.importImage(projectDir, {
    sourceFileName: 'cover.webp',
    convertedDataUrl: makePngDataUrl(16, 16),
    kind: 'background',
    id: 'cover_webp',
  });

  assert.equal(bg.asset.type, 'image');
  assert.equal(bg.asset.options.tileBase, 64);
  assert.equal(bg.asset.options.mapBase, 0);
  assert.equal(bg.asset.options.compression, 'auto');
  assert.equal(bg.commandInfo.mode, 'internal-pce');
  assert.equal(bg.commandInfo.command, 'Internal PCE image converter');
  assert.deepEqual(bg.commandInfo.args, []);
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.paletteFile)), true);
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.tilesFile)), true);
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.mapFile)), true);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.paletteFile)).length, 32);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.tilesFile)).length, 256);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.mapFile)).length, 16);
  assert.equal(fs.readFileSync(path.join(projectDir, bg.asset.data.generated.mapVramFile)).readUInt16LE(0) & 0x0fff, 64);
  assert.equal(bg.asset.data.generated.compression.map.codec, 'rle');
  assert.equal(fs.existsSync(path.join(projectDir, bg.asset.data.generated.mapVramCompressedFile)), true);
  assert.ok(fs.statSync(path.join(projectDir, bg.asset.data.generated.mapVramCompressedFile)).size < fs.statSync(path.join(projectDir, bg.asset.data.generated.mapVramFile)).size);
  assert.equal(bg.asset.data.generated.tileCount, 8);
  assert.equal(sprite.asset.type, 'sprite');
  assert.equal(sprite.asset.options.compression, 'auto');
  assert.equal(sprite.commandInfo.mode, 'internal-pce');
  assert.equal(sprite.commandInfo.outputKind, 'sprite');
  assert.equal(fs.existsSync(path.join(projectDir, sprite.asset.data.generated.paletteFile)), true);
  assert.equal(fs.existsSync(path.join(projectDir, sprite.asset.data.generated.tilesFile)), true);
  // The 32x32 checkerboard sprite has 4 cells but only 2 are unique, so the
  // deduplicated pattern buffer is 2 * 128 = 256 bytes.
  assert.equal(fs.readFileSync(path.join(projectDir, sprite.asset.data.generated.tilesFile)).length, 256);
  assert.equal(sprite.asset.data.generated.tileCount, 2);
  // The cell map keeps one entry per positional sheet cell (4) pointing into the
  // 2 unique patterns.
  assert.equal(fs.existsSync(path.join(projectDir, sprite.asset.data.generated.cellMapFile)), true);
  const heroCellMap = fs.readFileSync(path.join(projectDir, sprite.asset.data.generated.cellMapFile));
  assert.equal(heroCellMap.length, 4);
  assert.ok(Array.from(heroCellMap).every((slot) => slot < 2));
  assert.match(sprite.asset.source, /^assets\/sprites\/hero\.png$/);
  assert.match(overlapSprite.asset.data.generated.warnings.join('\n'), /Sprite patterns overlap the SATB VRAM area/);
  assert.equal(webp.asset.type, 'image');
  assert.equal(webp.asset.source, 'assets/images/cover_webp.png');
  assert.equal(fs.existsSync(path.join(projectDir, webp.asset.source)), true);
});

test('PCE source generation hard-errors when sprite patterns overrun the SATB', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-satb-');
  assetManager.importImage(projectDir, {
    sourceFileName: 'huge.png',
    convertedDataUrl: makePngDataUrl(256, 128),
    kind: 'sprite',
    id: 'huge',
    cellWidth: 16,
    cellHeight: 16,
    tileBase: 2040,
  });
  assert.throws(() => assetManager.generateAssetSources(projectDir), /overrun the SATB/);
});

test('PCE background generation refreshes stale map tile references before source output', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-stale-bg-');
  const imported = assetManager.importImage(projectDir, {
    sourceFileName: 'title.png',
    convertedDataUrl: makePngDataUrl(16, 16),
    kind: 'background',
    id: 'title',
  });
  const mapPath = path.join(projectDir, imported.asset.data.generated.mapFile);
  const mapVramPath = path.join(projectDir, imported.asset.data.generated.mapVramFile);
  const staleMap = fs.readFileSync(mapPath);
  const staleVramMap = fs.readFileSync(mapVramPath);
  staleMap.writeUInt16LE(32, 0);
  staleVramMap.writeUInt16LE(32, 0);
  fs.writeFileSync(mapPath, staleMap);
  fs.writeFileSync(mapVramPath, staleVramMap);

  assetManager.generateAssetSources(projectDir);

  const refreshed = fs.readFileSync(mapVramPath);
  const saved = assetManager.readAssetDocument(projectDir);
  assert.equal(refreshed.readUInt16LE(0) & 0x0fff, 64);
  assert.equal(saved.assets[0].data.import.converter, 'Internal PCE image converter');
  assert.equal(typeof saved.assets[0].data.import.regeneratedAt, 'string');
});

test('PCE visual generation refreshes stale compressed sidecars before source output', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-assets-stale-compression-');
  const imported = assetManager.importImage(projectDir, {
    sourceFileName: 'solid.png',
    convertedDataUrl: makeSolidPngDataUrl(32, 16, [0, 146, 219, 255]),
    kind: 'background',
    id: 'solid_bg',
  });
  const generated = imported.asset.data.generated;
  assert.equal(generated.compression.tiles.codec, 'rle');
  const tilesPath = path.join(projectDir, generated.tilesFile);
  const compressedPath = path.join(projectDir, generated.tilesCompressedFile);
  fs.writeFileSync(compressedPath, makeRleRun(fs.readFileSync(tilesPath).length, 0xff));

  assetManager.generateAssetSources(projectDir);

  const raw = fs.readFileSync(tilesPath);
  const refreshed = fs.readFileSync(compressedPath);
  assert.notDeepEqual(refreshed, makeRleRun(raw.length, 0xff));
  assert.deepEqual(decodePceRle(refreshed, raw.length), raw);
  const saved = assetManager.readAssetDocument(projectDir);
  assert.equal(saved.assets[0].data.generated.compression.tiles.byteLength, refreshed.length);
  assert.equal(typeof saved.assets[0].data.import.regeneratedAt, 'string');
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
        options: { width: 16, height: 16, tileBase: 32, mapBase: 9 },
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
  assert.match(header, /pce_editor_sprite_draw_meta_t/);
  assert.match(header, /extern const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta\[\];/);
  assert.match(header, /pce_editor_psg_asset_t/);
  assert.match(header, /pce_editor_adpcm_asset_t/);
  assert.match(header, /unsigned long data_size;/);
  assert.match(header, /unsigned char stream;/);
  assert.match(header, /pce_editor_cdda_asset_t/);
  assert.doesNotMatch(header, /const char \*id;/);
  assert.match(source, /static const unsigned char pce_editor_image_bg_palette\[\]/);
  assert.match(source, /static const unsigned char pce_editor_sprite_spr_patterns\[\]/);
  assert.match(source, /static const pce_editor_psg_step_t pce_editor_psg_beep_pattern\[\]/);
  assert.match(source, /static const unsigned char pce_editor_adpcm_voice_data\[\]/);
  assert.match(source, /\{ pce_editor_image_bg_palette, 32u, \(const pce_editor_data_chunk_t \*\)0, 0u, \(const pce_editor_cd_data_ref_t \*\)0 \}, \{ pce_editor_image_bg_tiles, 64u, \(const pce_editor_data_chunk_t \*\)0, 0u, \(const pce_editor_cd_data_ref_t \*\)0 \}, \{ pce_editor_image_bg_map, 8u, \(const pce_editor_data_chunk_t \*\)0, 0u, \(const pce_editor_cd_data_ref_t \*\)0 \}, 2u, 2u, 64u, 0u, 0u \}/);
  assert.match(source, /\{ pce_editor_adpcm_voice_data, 4ul, 16000u, 0u, 14u, 0u, 0u, \(const pce_editor_cd_data_ref_t \*\)0 \}/);
  assert.match(source, /const unsigned char pce_editor_bg_asset_count = 1/);
  assert.match(source, /const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta\[\] = \{\n  \{ 16u, 16u, 1u, 1u, 384u, 0u \}\n\};/);
  assert.match(source, /const unsigned char pce_editor_sprite_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_psg_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_adpcm_asset_count = 1/);
  assert.match(source, /const unsigned char pce_editor_cdda_asset_count = 1/);
  assert.match(source, /pce_editor_image_rows/);
});

test('PCE CD asset source generation streams large payloads through cd.dataFiles', (t) => {
  // Force CD on-demand metadata so this exercises the meta directory path.
  process.env.PCE_ASSET_META_BUDGET = '0';
  t.after(() => { delete process.env.PCE_ASSET_META_BUDGET; });
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
  writeFile(projectDir, 'assets/generated/opening/cdda.wav', makeWavBuffer(44100, 44100));
  writeFile(projectDir, 'assets/generated/ending/cdda.wav', makeWavBuffer(44100, 88200));
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
        options: { width: 64, height: 128, cellWidth: 16, cellHeight: 16, tileBase: 880, paletteBank: 1 },
        data: { generated: {
          paletteFile: 'assets/generated/hero/palette.bin',
          tilesFile: 'assets/generated/hero/patterns.bin',
        } },
      },
      {
        id: 'voice',
        type: 'adpcm',
        source: 'assets/adpcm/voice.wav',
        options: { stream: true },
        data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } },
      },
      {
        id: 'ending',
        type: 'cdda-track',
        source: 'assets/cdda/ending.wav',
        options: { track: 3 },
        data: { generated: { outputFile: 'assets/generated/ending/cdda.wav' } },
      },
      {
        id: 'opening',
        type: 'cdda-track',
        source: 'assets/cdda/opening.wav',
        options: { track: 2, loop: true },
        data: { generated: { outputFile: 'assets/generated/opening/cdda.wav' } },
      },
    ],
  }, null, 2));

  const result = assetManager.generateAssetSources(projectDir);
  const header = fs.readFileSync(result.headerPath, 'utf-8');
  const source = fs.readFileSync(result.sourcePath, 'utf-8');

  assert.equal(result.imageRows, 0);
  assert.equal(result.bankedChunkCount, 0);
  // CD builds consolidate per-asset metadata into ASSET_META_FILE (on-demand) and
  // keep only a constant resident directory; the big resident arrays and per-asset
  // cd refs are gone. See docs/pce-asset-meta-cd-ondemand.md.
  assert.deepEqual(assetManager.collectCdDataFiles(projectDir), [
    'assets/generated/bg/tiles.bin',
    'assets/generated/bg/map_vram.bin',
    'assets/generated/hero/patterns.bin',
    'assets/generated/voice/adpcm.bin',
    'assets/generated/meta/asset_meta.bin',
  ]);
  assert.match(header, /pce_editor_cd_data_ref_t/);
  assert.match(header, /pce_editor_meta_region_t/);
  assert.match(header, /extern const pce_editor_meta_region_t pce_editor_bg_meta;/);
  assert.match(header, /extern const pce_editor_meta_region_t pce_editor_sprite_meta;/);
  assert.match(header, /extern const pce_editor_meta_region_t pce_editor_adpcm_meta;/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_DATA_SIZE 2u/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_SAMPLE_RATE 6u/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_ADDRESS 8u/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_DIVIDER 10u/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_LOOP 11u/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_STREAM 12u/);
  assert.match(header, /#define PCE_EDITOR_META_ADPCM_CD 15u/);
  // Resident directory: payloads occupy sectors 64..69, so the meta file lands at
  // sector 70; its regions are bg@70, sprite@71, adpcm@72.
  assert.match(source, /const pce_editor_meta_region_t pce_editor_bg_meta = \{ \{ 70u, 0u, 0u \}, 1u \};/);
  assert.match(source, /const pce_editor_meta_region_t pce_editor_sprite_meta = \{ \{ 71u, 0u, 0u \}, 1u \};/);
  assert.match(source, /const pce_editor_meta_region_t pce_editor_adpcm_meta = \{ \{ 72u, 0u, 0u \}, 1u \};/);
  assert.match(source, /const unsigned char pce_editor_bg_asset_count = 1;/);
  assert.match(source, /const unsigned char pce_editor_sprite_asset_count = 1;/);
  assert.match(source, /const unsigned char pce_editor_adpcm_asset_count = 1;/);
  // The resident arrays and per-asset cd refs are no longer emitted on CD.
  assert.doesNotMatch(source, /pce_editor_bg_assets\[\] = \{/);
  assert.doesNotMatch(source, /pce_editor_sprite_draw_meta\[\] = \{/);
  assert.doesNotMatch(source, /pce_editor_image_bg_tiles_cd PCE_EDITOR_CD_REF_SECTION/);
  assert.doesNotMatch(source, /pce_editor_adpcm_voice_data_cd PCE_EDITOR_CD_REF_SECTION/);
  // CDDA stays resident (does not scale with images); its table is unchanged.
  assert.match(header, /pce_editor_cd_sector_t start_sector;/);
  assert.match(source, /\{ 3u, 0u, \{ 13u, 2u, 0u \}, \{ 162u, 2u, 0u \}, \{ 74u, 10u, 0u \}, 118u \}/);
  assert.match(source, /\{ 2u, 1u, \{ 194u, 1u, 0u \}, \{ 12u, 2u, 0u \}, \{ 74u, 8u, 0u \}, 58u \}/);

  // Lock the on-CD record format: decode the bg record (slot 0) and verify a few
  // fields and the embedded cd refs (tiles@64, map@65).
  // Records are packed struct images + appendix (see docs/pce-asset-meta-cd-ondemand.md).
  const meta = fs.readFileSync(path.join(projectDir, 'assets/generated/meta/asset_meta.bin'));
  assert.equal(meta.length, 3 * 2048);
  assert.equal(meta[27], 36); // bg width_tiles = ceil(288/8)
  assert.equal(meta[28], 16); // bg height_tiles = ceil(128/8)
  assert.equal(meta.readUInt16LE(29), 64); // tile_base (BG auto-forced)
  assert.equal(meta.readUInt16LE(31), 0); // map_base (BG auto-forced)
  assert.equal(meta.readUInt16LE(11), 2048); // tiles.size (uncompressed)
  assert.equal(meta[66], 64); // tiles cd sector lo
  assert.equal(meta.readUInt16LE(69), 1); // tiles cd sector_count
  assert.equal(meta.readUInt16LE(71), 2048); // tiles cd byte_size
  assert.equal(meta[74], 65); // map cd sector lo
  // Sprite record (region at sector 71 -> byte offset 1*2048).
  const sprBase = 1 * 2048;
  assert.equal(meta.readUInt16LE(sprBase + 22), 880); // pattern_base
  assert.equal(meta[sprBase + 24], 1); // palette_bank
  assert.equal(meta[sprBase + 61], 66); // patterns cd sector lo
  // ADPCM record (region at sector 72 -> byte offset 2*2048).
  const adBase = 2 * 2048;
  assert.equal(meta.readUInt32LE(adBase + 2), 4096); // data_size
  assert.equal(meta[adBase + 12], 1); // stream flag
  assert.equal(meta[adBase + 15], 68); // adpcm cd sector lo
});

test('PCE CD asset source generation uses compressed BG and sprite sidecars when available', (t) => {
  // Force CD on-demand metadata so this exercises the meta directory path.
  process.env.PCE_ASSET_META_BUDGET = '0';
  t.after(() => { delete process.env.PCE_ASSET_META_BUDGET; });
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-cd-assets-compressed-');
  const bgTilesRle = makeRleRun(2048, 0x22);
  const bgMapRle = makeRleRun(2048, 0x80);
  const spritePatternsRle = makeRleRun(4096, 0x33);
  writeFile(projectDir, 'project.json', JSON.stringify({ targetMedia: 'cd', toolchain: 'llvm-mos' }, null, 2));
  writeFile(projectDir, 'assets/generated/bg/palette.bin', Buffer.alloc(32, 0x01));
  writeFile(projectDir, 'assets/generated/bg/tiles.bin', Buffer.alloc(2048, 0x22));
  writeFile(projectDir, 'assets/generated/bg/tiles.rle', bgTilesRle);
  writeFile(projectDir, 'assets/generated/bg/map_vram.bin', Buffer.alloc(2048, 0x80));
  writeFile(projectDir, 'assets/generated/bg/map_vram.rle', bgMapRle);
  writeFile(projectDir, 'assets/generated/hero/palette.bin', Buffer.alloc(32, 0x02));
  writeFile(projectDir, 'assets/generated/hero/patterns.bin', Buffer.alloc(4096, 0x33));
  writeFile(projectDir, 'assets/generated/hero/patterns.rle', spritePatternsRle);
  writeFile(projectDir, 'assets/pce-assets.json', JSON.stringify({
    version: 2,
    assets: [
      {
        id: 'bg',
        type: 'image',
        source: 'assets/images/bg.png',
        options: { width: 288, height: 128, compression: 'auto' },
        data: { generated: {
          paletteFile: 'assets/generated/bg/palette.bin',
          tilesFile: 'assets/generated/bg/tiles.bin',
          tilesCompressedFile: 'assets/generated/bg/tiles.rle',
          mapVramFile: 'assets/generated/bg/map_vram.bin',
          mapVramCompressedFile: 'assets/generated/bg/map_vram.rle',
          compression: {
            policy: 'auto',
            tiles: { codec: 'rle', file: 'assets/generated/bg/tiles.rle', rawBytes: 2048, byteLength: bgTilesRle.length },
            map: { codec: 'rle', file: 'assets/generated/bg/map_vram.rle', rawBytes: 2048, byteLength: bgMapRle.length },
          },
        } },
      },
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: { width: 64, height: 128, cellWidth: 16, cellHeight: 16, compression: 'auto' },
        data: { generated: {
          paletteFile: 'assets/generated/hero/palette.bin',
          tilesFile: 'assets/generated/hero/patterns.bin',
          tilesCompressedFile: 'assets/generated/hero/patterns.rle',
          compression: {
            policy: 'auto',
            tiles: { codec: 'rle', file: 'assets/generated/hero/patterns.rle', rawBytes: 4096, byteLength: spritePatternsRle.length },
          },
        } },
      },
    ],
  }, null, 2));

  const result = assetManager.generateAssetSources(projectDir);
  const source = fs.readFileSync(result.sourcePath, 'utf-8');

  assert.deepEqual(assetManager.collectCdDataFiles(projectDir), [
    'assets/generated/bg/tiles.rle',
    'assets/generated/bg/map_vram.rle',
    'assets/generated/hero/patterns.rle',
    'assets/generated/meta/asset_meta.bin',
  ]);
  // RLE sidecars sit at sectors 64..66, so the meta file lands at sector 67
  // (regions bg@67, sprite@68). The compressed byte_size / compression flag live
  // in the on-CD records now, not in resident cd refs.
  assert.match(source, /const pce_editor_meta_region_t pce_editor_bg_meta = \{ \{ 67u, 0u, 0u \}, 1u \};/);
  assert.match(source, /const pce_editor_meta_region_t pce_editor_sprite_meta = \{ \{ 68u, 0u, 0u \}, 1u \};/);
  assert.doesNotMatch(source, /pce_editor_image_bg_tiles_cd PCE_EDITOR_CD_REF_SECTION/);

  const meta = fs.readFileSync(path.join(projectDir, 'assets/generated/meta/asset_meta.bin'));
  assert.equal(meta.length, 2 * 2048);
  // BG tiles: uncompressed size 2048, cd ref sector 64, compressed byte_size, RLE flag.
  assert.equal(meta.readUInt16LE(11), 2048); // tiles.size (uncompressed)
  assert.equal(meta[66], 64); // tiles cd sector lo
  assert.equal(meta.readUInt16LE(71), bgTilesRle.length); // tiles cd byte_size
  assert.equal(meta[73], 1); // tiles compression = RLE
  assert.equal(meta[74], 65); // map cd sector lo
  assert.equal(meta.readUInt16LE(79), bgMapRle.length); // map cd byte_size
  assert.equal(meta[81], 1); // map compression = RLE
  // Sprite patterns (record at sector 68 -> byte 2048).
  const sprBase = 2048;
  assert.equal(meta.readUInt16LE(sprBase + 11), 4096); // patterns uncompressed size
  assert.equal(meta[sprBase + 61], 66); // patterns cd sector lo
  assert.equal(meta.readUInt16LE(sprBase + 66), spritePatternsRle.length); // patterns cd byte_size
  assert.equal(meta[sprBase + 68], 1); // patterns compression = RLE
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
  assert.ok(slides.every((asset) => asset.options.tileBase === 128 && asset.options.mapBase === 0));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.source))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.paletteFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.tilesFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.mapFile))));
  assert.ok(slides.every((asset) => asset.options.compression === 'auto'));
  assert.ok(slides.every((asset) => asset.data.generated.compression?.tiles?.codec === 'rle'));
  assert.ok(slides.every((asset) => asset.data.generated.compression?.map?.codec === 'rle'));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.tilesCompressedFile))));
  assert.ok(slides.every((asset) => fs.existsSync(path.join(templateDir, asset.data.generated.mapVramCompressedFile))));
  slides.forEach((asset) => {
    const generated = asset.data.generated;
    const tiles = fs.readFileSync(path.join(templateDir, generated.tilesFile));
    const tilesRle = fs.readFileSync(path.join(templateDir, generated.tilesCompressedFile));
    const map = fs.readFileSync(path.join(templateDir, generated.mapVramFile));
    const mapRle = fs.readFileSync(path.join(templateDir, generated.mapVramCompressedFile));
    assert.deepEqual(decodePceRle(tilesRle, tiles.length), tiles);
    assert.deepEqual(decodePceRle(mapRle, map.length), map);
  });
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

test('PCE visual novel template compressed visual assets decode to raw data', () => {
  const templateDir = path.join(__dirname, '..', 'template', 'template_pce_vn_cd');
  const doc = JSON.parse(fs.readFileSync(path.join(templateDir, 'assets', 'pce-assets.json'), 'utf-8'));
  const visuals = doc.assets.filter((entry) => entry.type === 'image' || entry.type === 'sprite');
  assert.ok(visuals.length >= 4);
  visuals.forEach((asset) => {
    const generated = asset.data.generated;
    const tiles = fs.readFileSync(path.join(templateDir, generated.tilesFile));
    const tilesRle = fs.readFileSync(path.join(templateDir, generated.tilesCompressedFile));
    assert.deepEqual(decodePceRle(tilesRle, tiles.length), tiles);
    if (asset.type === 'image') {
      const map = fs.readFileSync(path.join(templateDir, generated.mapVramFile));
      const mapRle = fs.readFileSync(path.join(templateDir, generated.mapVramCompressedFile));
      assert.deepEqual(decodePceRle(mapRle, map.length), map);
    }
  });
});
