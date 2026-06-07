'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

async function loadPreviewModule() {
  return import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'midi-converter', 'vgm-preview-player.mjs')).href);
}

function makeVgmFixture() {
  const header = Buffer.alloc(0x40);
  header.write('Vgm ', 0, 4, 'ascii');
  header.writeUInt32LE(0x00000151, 0x08);
  header.writeUInt32LE(3579545, 0x0c);
  header.writeUInt32LE(7670454, 0x2c);
  const body = Buffer.from([
    0x52, 0xa0, 0x34,
    0x52, 0xa4, 0x2c,
    0x52, 0x28, 0xf0,
    0x50, 0x90,
    0x61, 0x10, 0x00,
    0x67, 0x66, 0x00, 0x02, 0x00, 0x00, 0x00, 0xaa, 0xbb,
    0x70,
    0x52, 0x28, 0x00,
    0x66,
  ]);
  return Buffer.concat([header, body]);
}

test('VGM preview parser reads YM2612, PSG, waits, data blocks, and end', async () => {
  const preview = await loadPreviewModule();
  const parsed = preview.parseVgmBytes(makeVgmFixture());

  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.version, 0x00000151);
  assert.equal(parsed.ym2612Clock, 7670454);
  assert.equal(parsed.sn76489Clock, 3579545);
  assert.equal(parsed.meta.format, 'VGM');
  assert.equal(parsed.meta.version, 0x00000151);
  assert.equal(parsed.meta.fileSizeBytes, makeVgmFixture().length);
  assert.equal(parsed.meta.dataOffset, 0x40);
  assert.equal(parsed.meta.ym2612Writes, 4);
  assert.equal(parsed.meta.psgWrites, 1);
  assert.equal(parsed.meta.waitSamples, 17);
  assert.equal(parsed.meta.durationSec, 17 / 44100);
  assert.equal(parsed.warnings.length, 0);
});

test('VGM preview parser reports unsupported commands and canPreview only accepts VGM sources', async () => {
  const preview = await loadPreviewModule();
  const fixture = Buffer.concat([makeVgmFixture().subarray(0, -1), Buffer.from([0xff])]);
  const parsed = preview.parseVgmBytes(fixture);

  assert.equal(parsed.ok, true, parsed.error);
  assert.ok(parsed.warnings.some((warning) => warning.includes('Unsupported VGM command')));
  assert.equal(preview.canPreviewVgmEntry({ type: 'XGM2', sourcePath: 'music/theme.vgm' }), true);
  assert.equal(preview.canPreviewVgmEntry({ type: 'XGM2', files: ['music/theme.vgm'] }), true);
  assert.equal(preview.canPreviewVgmEntry({ type: 'XGM', sourcePath: 'music/theme.xgm' }), false);
});

test('VGM preview player exposes high-accuracy engine fallback warning', async () => {
  const preview = await loadPreviewModule();
  const player = preview.createVgmPreviewPlayer();
  const dataUrl = `data:audio/vgm;base64,${makeVgmFixture().toString('base64')}`;
  const loaded = player.load({ dataUrl });

  assert.equal(loaded.ok, true, loaded.error);
  assert.equal(loaded.previewEngine.highAccuracyAvailable, false);
  assert.equal(loaded.meta.previewEngine.label, '簡易 Web Audio');
  assert.ok(loaded.warnings.some((warning) => warning.includes('高精度WASM')));
  const highAccuracy = await player.loadHighAccuracyEngine();
  assert.equal(highAccuracy.ok, false);
  assert.match(highAccuracy.warning, /高精度WASM/);
  assert.equal(player.getEngineStatus().state, 'fallback');
});

test('VGM preview player loads optional Nuked-OPN2 WASM engine payload', async () => {
  const preview = await loadPreviewModule();
  const moduleSource = 'export default async function(){ return { renderVgmEvents(){ return { ok: true, pcm: [new Float32Array([0]), new Float32Array([0])], channels: 2, sampleRate: 44100, warnings: [] }; } }; }';
  const previousElectronAPI = globalThis.electronAPI;
  const previousCandidate = globalThis.__MD_NUKED_OPN2_PREVIEW__;
  delete globalThis.__MD_NUKED_OPN2_PREVIEW__;
  globalThis.electronAPI = {
    loadOptionalAudioEngine: async (engineId) => ({
      ok: engineId === 'nuked-opn2',
      jsDataUrl: `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`,
      wasmDataUrl: 'data:application/wasm;base64,AGFzbQ==',
      buildInfo: { source: 'nukeykt/Nuked-OPN2' },
    }),
  };

  try {
    const player = preview.createVgmPreviewPlayer();
    const highAccuracy = await player.loadHighAccuracyEngine();
    assert.equal(highAccuracy.ok, true, highAccuracy.warning);
    assert.equal(highAccuracy.status.highAccuracyAvailable, true);
    assert.equal(player.getEngineStatus().label, 'Nuked-OPN2 WASM');
    assert.equal(typeof highAccuracy.engine.renderVgmEvents, 'function');
  } finally {
    globalThis.electronAPI = previousElectronAPI;
    if (previousCandidate) globalThis.__MD_NUKED_OPN2_PREVIEW__ = previousCandidate;
  }
});

test('XGM metadata parser reads header, frame duration, clocks proxy stats, and warnings', async () => {
  const preview = await loadPreviewModule();
  const header = Buffer.alloc(0x108);
  header.write('XGM ', 0, 4, 'ascii');
  header.writeUInt16LE(0, 0x100);
  header[0x102] = 1;
  header[0x103] = 0;
  const music = Buffer.from([
    0x10, 0x90,
    0x20, 0x22, 0x34,
    0x50, 0x01,
    0x00,
    0x00,
    0x7f,
  ]);
  header.writeUInt32LE(music.length, 0x104);
  const parsed = preview.parseXgmBytes(Buffer.concat([header, music]));

  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.meta.format, 'XGM');
  assert.equal(parsed.meta.version, 1);
  assert.equal(parsed.meta.timing, 'NTSC');
  assert.equal(parsed.meta.durationFrames, 2);
  assert.equal(parsed.meta.durationSec, 2 / 60);
  assert.equal(parsed.meta.musicDataOffset, 0x108);
  assert.equal(parsed.meta.musicDataSize, music.length);
  assert.equal(parsed.meta.ym2612Writes, 1);
  assert.equal(parsed.meta.psgWrites, 1);
  assert.equal(parsed.meta.pcmCommands, 1);
  assert.match(parsed.meta.headerHex, /^58 47 4D 20/);
});
