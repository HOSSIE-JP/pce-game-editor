'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pluginDir = path.join(__dirname, '..', 'plugins', 'midi-converter');
const converter = require(path.join(pluginDir, 'index.js'));
const core = require(path.join(pluginDir, 'converter-core.js'));

function vlq(value) {
  let buffer = value & 0x7F;
  let n = value >>> 7;
  while (n > 0) {
    buffer <<= 8;
    buffer |= ((n & 0x7F) | 0x80);
    n >>>= 7;
  }
  const out = [];
  for (;;) {
    out.push(buffer & 0xFF);
    if (buffer & 0x80) buffer >>>= 8;
    else break;
  }
  return Buffer.from(out.reverse());
}

function chunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function meta(delta, type, payload) {
  return Buffer.concat([vlq(delta), Buffer.from([0xFF, type]), vlq(payload.length), payload]);
}

function midi(delta, bytes) {
  return Buffer.concat([vlq(delta), Buffer.from(bytes)]);
}

function makeMidiFixture() {
  const header = Buffer.alloc(6);
  header.writeUInt16BE(1, 0);
  header.writeUInt16BE(2, 2);
  header.writeUInt16BE(96, 4);

  const tempoTrack = Buffer.concat([
    meta(0, 0x03, Buffer.from('Tempo')),
    meta(0, 0x51, Buffer.from([0x07, 0xA1, 0x20])),
    meta(0, 0x2F, Buffer.alloc(0)),
  ]);

  const noteTrack = Buffer.concat([
    meta(0, 0x03, Buffer.from('Lead')),
    midi(0, [0xC0, 0x10]),
    midi(0, [0xB0, 0x07, 0x64]),
    midi(0, [0x90, 60, 100]),
    midi(96, [0x80, 60, 0]),
    meta(0, 0x2F, Buffer.alloc(0)),
  ]);

  return Buffer.concat([
    chunk('MThd', header),
    chunk('MTrk', tempoTrack),
    chunk('MTrk', noteTrack),
  ]);
}

test('midi-converter manifest exposes main hook and renderer capability', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf-8'));
  const rendererSource = fs.readFileSync(path.join(pluginDir, 'renderer.js'), 'utf-8');

  assert.deepEqual(manifest.types, ['converter', 'asset']);
  assert.deepEqual(manifest.hooks, ['convertMidiMusic']);
  assert.deepEqual(manifest.mainApi.hooks, ['convertMidiMusic']);
  assert.ok(manifest.renderer.capabilities.includes('midi-convert-ui'));
  assert.ok(manifest.renderer.capabilities.includes('asset-import-handler'));
  assert.ok(manifest.renderer.capabilities.includes('vgm-preview-player'));
  assert.match(rendererSource, /registerCapability\(['"]midi-convert-ui['"]/);
  assert.match(rendererSource, /registerCapability\(['"]asset-import-handler['"]/);
  assert.match(rendererSource, /registerCapability\(['"]vgm-preview-player['"]/);
  assert.match(rendererSource, /createVgmPreviewPlayer/);
  assert.match(rendererSource, /async function handleImport/);
  assert.match(rendererSource, /convertMidiMusic\(\{/);
  assert.match(rendererSource, /addResEntry/);
  assert.match(rendererSource, /XGM2/);
  assert.match(rendererSource, /XGM/);
  const converterCoreSource = fs.readFileSync(path.join(pluginDir, 'converter-core.js'), 'utf-8');
  const sharedAudioSource = fs.readFileSync(path.join(pluginDir, '..', 'shared', 'md-audio-engine.js'), 'utf-8');
  assert.match(converterCoreSource, /shared\/md-audio-engine/);
  assert.doesNotMatch(`${converterCoreSource}\n${sharedAudioSource}`, /furnace|tildearrow/i);
  assert.doesNotMatch(fs.readFileSync(path.join(pluginDir, 'index.js'), 'utf-8'), /python|midi2vgm\.py|runPython/i);
  assert.doesNotMatch(rendererSource, /window\.prompt|window\.alert|window\.confirm/);
  assert.doesNotMatch(rendererSource, /MIDI 変換ウィザードを開きました|設定を確認して Convert/);
});

test('JS converter core reads MIDI and emits Mega Drive VGM data', () => {
  const parsed = core.parseMidi(makeMidiFixture());
  const result = core.convertMidiBufferToVgm(makeMidiFixture());

  assert.equal(parsed.format, 1);
  assert.equal(result.ok, true);
  assert.equal(result.vgm.toString('ascii', 0, 4), 'Vgm ');
  assert.equal(result.vgm.readUInt32LE(0x08), 0x00000170);
  assert.equal(result.vgm.readUInt32LE(0x0C), 3579545);
  assert.equal(result.vgm.readUInt32LE(0x2C), 7670454);
  assert.ok(result.vgm.includes(0x52));
  assert.ok(result.vgm.includes(0x61) || result.vgm.some((byte) => byte >= 0x70 && byte <= 0x7F));
  assert.equal(result.vgm[result.vgm.length - 1], 0x66);
  assert.equal(result.stats.note_on, 1);
  assert.equal(result.stats.voice_steal, 0);
});

test('JS converter reports voice steal when MIDI polyphony exceeds YM2612 channels', () => {
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(1, 2);
  header.writeUInt16BE(96, 4);
  const notes = [];
  for (let i = 0; i < 8; i += 1) notes.push(midi(0, [0x90, 60 + i, 100]));
  for (let i = 0; i < 8; i += 1) notes.push(midi(i === 0 ? 96 : 0, [0x80, 60 + i, 0]));
  const fixture = Buffer.concat([
    chunk('MThd', header),
    chunk('MTrk', Buffer.concat([...notes, meta(0, 0x2F, Buffer.alloc(0))])),
  ]);

  const result = core.convertMidiBufferToVgm(fixture);
  assert.equal(result.ok, true);
  assert.ok(result.stats.max_global_polyphony > 6);
  assert.ok(result.stats.voice_steal > 0);
  assert.ok(result.warnings.some((warning) => warning.includes('voice steal')));
});

test('main hook saves MIDI conversion outputs under project res/music', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midi-converter-hook-'));
  const midiPath = path.join(projectDir, 'lead.mid');
  fs.writeFileSync(midiPath, makeMidiFixture());

  const result = converter.convertMidiMusic({
    sourcePath: midiPath,
    symbol: 'Imported Theme',
    outputs: { vgm: true, xgm: true, registerAsset: true },
    xgmToolPath: path.join(projectDir, 'missing-xgmtool.exe'),
  }, { projectDir });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.symbol, 'imported_theme');
  assert.equal(result.files.vgm, 'res/music/imported_theme.vgm');
  assert.equal(result.files.xgm, undefined);
  assert.equal(result.asset.type, 'XGM2');
  assert.equal(result.asset.sourcePath, 'music/imported_theme.vgm');
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'imported_theme.vgm')));
  assert.ok(result.warnings.some((warning) => warning.includes('xgmtool')));
});

test('main hook honors asset-manager output target settings', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midi-converter-target-'));
  const midiPath = path.join(projectDir, 'lead.mid');
  fs.writeFileSync(midiPath, makeMidiFixture());

  const result = converter.convertMidiMusic({
    sourcePath: midiPath,
    symbol: 'Asset Name',
    targetSubdir: 'music/stage 1',
    targetFileName: 'stage theme.mid',
    outputs: { vgm: true, xgm: false, registerAsset: true },
  }, { projectDir });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.files.vgm, 'res/music/stage_1/stage_theme.vgm');
  assert.equal(result.asset.sourcePath, 'music/stage_1/stage_theme.vgm');
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'stage_1', 'stage_theme.vgm')));
});

test('main hook converts XGM when bundled xgmtool is available', (t) => {
  const xgmTool = converter._private.findBundledXgmTool();
  if (!xgmTool) {
    t.skip('bundled xgmtool.exe が見つかりません。');
    return;
  }
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'midi-converter-xgm-'));
  const midiPath = path.join(projectDir, 'lead.mid');
  fs.writeFileSync(midiPath, makeMidiFixture());

  const result = converter.convertMidiMusic({
    sourcePath: midiPath,
    symbol: 'xgm_theme',
    outputs: { vgm: true, xgm: true, registerAsset: false },
    xgmToolPath: xgmTool,
  }, { projectDir });

  assert.equal(result.ok, true, result.error);
  if (!result.files.xgm && result.warnings.some((warning) => /EPERM/.test(warning))) {
    t.skip(`xgmtool execution is blocked in this sandbox: ${result.warnings.join('; ')}`);
    return;
  }
  assert.equal(result.files.vgm, 'res/music/xgm_theme.vgm');
  assert.equal(result.files.xgm, 'res/music/xgm_theme.xgm');
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'xgm_theme.xgm')));
});
