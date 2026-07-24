'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  collectPceEmulatorJsAssets,
  generatePceExportHtml,
  preparePceExportMedia,
} = require('../pce-export');

function readMain() {
  return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
}

function minimalEmulatorAssets(extraAssets = []) {
  return {
    loaderText: 'window.__PCE_EXPORT_LOADER_RAN = true;',
    coreAsset: 'mednafen_pce-wasm.data',
    assets: [
      { key: 'emulator.min.js', relativePath: 'emulator.min.js', mime: 'application/javascript', size: 16, buffer: Buffer.from('export default class EmulatorJS {}') },
      { key: 'emulator.min.css', relativePath: 'emulator.min.css', mime: 'text/css', size: 4, buffer: Buffer.from('body{}') },
      { key: 'mednafen_pce-wasm.data', relativePath: 'cores/mednafen_pce-wasm.data', mime: 'application/octet-stream', size: 4, buffer: Buffer.from([1, 2, 3, 4]) },
      ...extraAssets,
    ],
  };
}

function payloadFromHtml(html) {
  const match = html.match(/<script id="pce-export-payload" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'embedded payload script is present');
  return JSON.parse(match[1]);
}

test('exported HTML defaults to project title filename', () => {
  const main = readMain();

  assert.match(main, /function sanitizeExportFileName\(value,\s*fallback = 'rom'\)/);
  assert.match(main, /const projectName = cfg\?\.title \|\| cfg\?\.romName \|\| cfg\?\.name \|\| buildSystem\.getProjectInfo\(\)\?\.projectName/);
  assert.match(main, /suggested = `\$\{sanitizeExportFileName\(projectName,\s*'rom'\)\}\.html`/);
});

test('export handlers use the last built media without triggering a build', () => {
  const main = readMain();

  const romHandler = main.match(/async function handleExportRom\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const htmlHandler = main.match(/async function handleExportHtml\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(romHandler, /buildSystem\.getLastRomPath\(\)/);
  assert.match(htmlHandler, /buildSystem\.getLastRomPath\(\)/);
  assert.match(romHandler, /pceExport\.preparePceExportMedia\(romPath\)/);
  assert.match(htmlHandler, /pceExport\.generatePceExportHtml\(/);
  assert.match(htmlHandler, /pceExport\.preparePceExportMedia\(romPath\)/);
  assert.doesNotMatch(romHandler, /isCdRomPath/);
  assert.doesNotMatch(htmlHandler, /readSystemCard/);
  assert.doesNotMatch(romHandler, /runBuildFull\(/);
  assert.doesNotMatch(htmlHandler, /runBuildFull\(/);
  assert.match(romHandler, /エクスポートできるビルド済み PCE メディアがありません/);
  assert.match(htmlHandler, /エクスポートできるビルド済み PCE メディアがありません/);
});

test('PCE HuCard export HTML embeds media and EmulatorJS bootstrap', () => {
  const media = {
    mediaType: 'hucard',
    label: 'sample.pce',
    gameName: 'sample.pce',
    entryName: 'sample.pce',
    buffer: Buffer.from([0x50, 0x43, 0x45]),
    fileSize: 3,
    crc32: '0x12345678',
  };
  const html = generatePceExportHtml({
    media,
    emulatorAssets: minimalEmulatorAssets(),
    appVersion: '0.0.0-test',
    appBuildNumber: 'test',
    appBuildAt: 'now',
  });
  const payload = payloadFromHtml(html);

  assert.equal(payload.media.mediaType, 'hucard');
  assert.deepEqual(payload.media.chunks, [Buffer.from([0x50, 0x43, 0x45]).toString('base64')]);
  assert.equal(payload.assets.some((asset) => asset.key === 'mednafen_pce-wasm.data'), true);
  assert.match(html, /window\.EJS_core = 'pce'/);
  assert.match(html, /window\.EJS_paths = assetUrls/);
  assert.match(html, /window\.EJS_language = 'en-US'/);
  assert.match(html, /assetUrlForRequest/);
  assert.match(html, /child instanceof HTMLLinkElement/);
  assert.match(html, /insertBeforeWithRuntimeBridge/);
  assert.match(html, /installRuntimeGlobalBridge/);
  assert.match(html, /simulateInput\(0,\s*button,\s*down \? 1 : 0\)/);
  assert.match(html, /id="downloadMedia"/);
  assert.match(html, /data-pce-btn="START"/);
  assert.doesNotMatch(html, /md_wasm/);
  assert.doesNotMatch(html, /wasm-player/);
  assert.doesNotMatch(html, /MD Emulator/);
});

test('PCE Export rejects CD-ROM2 media and never emits a System Card payload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-export-cd-reject-'));
  const cuePath = path.join(dir, 'game.cue');
  fs.writeFileSync(cuePath, 'FILE "game.iso" BINARY\n  TRACK 01 MODE1/2048\n', 'utf-8');
  assert.throws(
    () => preparePceExportMedia(cuePath),
    /CD-ROM2 プロジェクトは Export の対象外です/,
  );
  assert.throws(
    () => generatePceExportHtml({
      media: { mediaType: 'cdrom2' },
      emulatorAssets: minimalEmulatorAssets(),
    }),
    /CD-ROM2 プロジェクトは HTML Export の対象外です/,
  );
});

test('PCE EmulatorJS asset collection includes only the HuCard runtime assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-export-runtime-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, 'cores', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'loader.js'), 'loader');
  fs.writeFileSync(path.join(dataDir, 'emulator.min.js'), 'emulator');
  fs.writeFileSync(path.join(dataDir, 'emulator.min.css'), 'css');
  fs.writeFileSync(path.join(dataDir, 'cores', 'cores.json'), '{}');
  fs.writeFileSync(path.join(dataDir, 'cores', 'reports', 'mednafen_pce.json'), '{}');
  fs.writeFileSync(path.join(dataDir, 'cores', 'mednafen_pce-wasm.data'), 'core');
  const collected = collectPceEmulatorJsAssets({
    rootDir: root,
    dataDir,
    loaderPath: path.join(dataDir, 'loader.js'),
    coreAsset: 'mednafen_pce-wasm.data',
  });
  const keys = collected.assets.map((asset) => asset.key).sort();

  assert.equal(collected.loaderText, 'loader');
  assert.ok(keys.includes('emulator.min.js'));
  assert.ok(keys.includes('emulator.min.css'));
  assert.ok(keys.includes('mednafen_pce-wasm.data'));
  assert.ok(keys.includes('mednafen_pce.json'));
  assert.ok(!keys.includes('extractzip.js'));
});
