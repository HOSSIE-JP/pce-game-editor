'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const assetManager = require('../pce-asset-manager');
const systemCardPsg = require('../pce-system-card-psg');

const SAMPLE_DIR = path.join(__dirname, '..', 'samples', 'pce-psg-bgm');
const JSON_PATH = path.join(SAMPLE_DIR, 'nonki_bukatsu_bgm.psg.json');
const HUCARD_PATH = path.join(SAMPLE_DIR, 'nonki_bukatsu_bgm.hucard.psg.bin');
const CD_PATH = path.join(SAMPLE_DIR, 'nonki_bukatsu_bgm.super-cd.psg.bin');

function readAsset() {
  const document = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  assert.equal(document.version, 2);
  assert.equal(document.assets.length, 1);
  return assetManager.normalizeAsset(document.assets[0]);
}

test('のんきな部活動 is a 16-bar slow PSG song with melody and chorus markers', () => {
  const asset = readAsset();
  assert.equal(asset.type, 'psg-song');
  assert.equal(asset.options.bpm, 72);
  assert.equal(asset.options.steps, 256);
  assert.equal(asset.options.bars, 16);
  assert.equal(asset.options.stepsPerBar, 16);
  assert.equal(asset.options.loop, true);
  assert.deepEqual(asset.options.sections, [
    { name: 'メロ', startBar: 1, endBar: 8, startStep: 0 },
    { name: 'サビ', startBar: 9, endBar: 16, startStep: 128 },
  ]);

  const pattern = asset.options.pattern;
  assert.ok(pattern.length > 0 && pattern.length <= 2048);
  assert.deepEqual(new Set(pattern.filter((entry) => entry.volume > 0).map((entry) => entry.channel)), new Set([0, 1, 2, 3, 4, 5]));
  assert.equal(new Set(pattern.map((entry) => `${entry.step}:${entry.channel}`)).size, pattern.length);
  assert.ok(pattern.every((entry) => entry.step >= 0 && entry.step < 256));

  const melodyA = pattern.filter((entry) => entry.channel === 0 && entry.volume > 0 && entry.step < 128);
  const melodyChorus = pattern.filter((entry) => entry.channel === 0 && entry.volume > 0 && entry.step >= 128);
  assert.ok(melodyChorus.length > melodyA.length, 'chorus melody has denser motion');
  const meanPeriod = (entries) => entries.reduce((sum, entry) => sum + entry.period, 0) / entries.length;
  assert.ok(meanPeriod(melodyChorus) < meanPeriod(melodyA), 'chorus melody is in a higher register');
});

test('のんきな部活動 PSG JSON can be inspected and imported without changing its source', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-psg-json-sample-'));
  const inspection = assetManager.inspectPsgJson(projectDir, { sourcePath: JSON_PATH });
  assert.equal(inspection.summary.bars, 16);
  assert.equal(inspection.summary.sections[0].name, 'メロ');
  assert.equal(inspection.summary.sections[1].name, 'サビ');
  assert.equal(inspection.previewAsset.options.pattern.length, 453);
  assert.deepEqual(inspection.collisionIds, []);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets', 'pce-assets.json')), false);

  const imported = assetManager.importPsgJson(projectDir, { sourcePath: JSON_PATH });
  assert.equal(imported.asset.id, 'nonki_bukatsu_bgm');
  assert.equal(imported.asset.data.import.quantizerVersion, undefined);
  assert.deepEqual(
    fs.readFileSync(path.join(projectDir, imported.asset.source)),
    fs.readFileSync(JSON_PATH),
  );
});

test('generated HuCARD PSG bytes exactly match the canonical normalized pattern', () => {
  const asset = readAsset();
  const expected = assetManager.psgPatternBytes(asset);
  const actual = fs.readFileSync(HUCARD_PATH);
  assert.deepEqual(actual, expected);
  assert.equal(actual.length % 8, 0);
});

test('generated Super CD-ROM2 PSG package is valid, six-channel, and loops', () => {
  const asset = readAsset();
  const compiled = systemCardPsg.compileSystemCardPsgPackage(asset, 0);
  const actual = fs.readFileSync(CD_PATH);
  assert.deepEqual(actual, compiled.bytes);
  assert.deepEqual(compiled.usedChannels, [0, 1, 2, 3, 4, 5]);
  assert.ok(compiled.bytes.length <= systemCardPsg.PSG_BGM_MAX_BYTES);
  compiled.streamOffsets.forEach((stream) => {
    const bytes = compiled.bytes.subarray(stream.offset, stream.offset + stream.byteLength);
    assert.ok(bytes.includes(systemCardPsg.COMMAND.SEGNO));
    assert.equal(bytes.at(-1), systemCardPsg.COMMAND.DAL_SEGNO);
  });
});
