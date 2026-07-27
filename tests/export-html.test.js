'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  collectPceEmulatorJsAssets,
  createPceItchIoBundle,
  generatePceItchIoHtml,
  preparePceExportMedia,
} = require('../pce-export');

function readMain() {
  return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
}

function minimalEmulatorAssets() {
  return {
    coreAsset: 'mednafen_pce-legacy-wasm.data',
    licenseText: Buffer.from('GPL-3.0 license text'),
    coreLicenseText: Buffer.from('GPL-2.0 license text'),
    sourceInfo: {
      emulatorJsVersion: '4.2.4-test',
      emulatorJsRepository: 'https://example.invalid/EmulatorJS',
      coreRepository: 'https://example.invalid/beetle-pce-libretro',
      coreLicenseFile: 'COPYING',
      coreSha256: '0123456789abcdef',
    },
    assets: [
      { relativePath: 'loader.js', buffer: Buffer.from('loader') },
      { relativePath: 'emulator.min.js', buffer: Buffer.from('runtime') },
      { relativePath: 'emulator.min.css', buffer: Buffer.from('css') },
      { relativePath: 'compression/extract7z.js', buffer: Buffer.from('extractor') },
      { relativePath: 'cores/mednafen_pce-legacy-wasm.data', buffer: Buffer.from('core') },
    ],
  };
}

function sampleMedia() {
  return {
    mediaType: 'hucard',
    label: 'sample.pce',
    gameName: 'sample.pce',
    entryName: 'sample.pce',
    buffer: Buffer.from([0x50, 0x43, 0x45]),
    fileSize: 3,
    crc32: '0x12345678',
  };
}

test('itch.io export defaults to a project-title ZIP filename', () => {
  const main = readMain();

  assert.match(main, /function sanitizeExportFileName\(value,\s*fallback = 'rom'\)/);
  assert.match(main, /const projectName = cfg\?\.title \|\| cfg\?\.romName \|\| cfg\?\.name \|\| buildSystem\.getProjectInfo\(\)\?\.projectName/);
  assert.match(main, /suggested = `\$\{sanitizeExportFileName\(projectName,\s*'rom'\)\}-itchio\.zip`/);
  assert.match(main, /title: 'itch\.io 用 HTML5 ZIP をエクスポート'/);
  assert.match(main, /filters: \[\{ name: 'ZIP ファイル', extensions: \['zip'\] \}\]/);
});

test('export handlers use the last built HuCard without triggering a build', () => {
  const main = readMain();
  const romHandler = main.match(/async function handleExportRom\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const htmlHandler = main.match(/async function handleExportHtml\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(main, /function getLastBuiltMediaPath\(\)/);
  assert.match(romHandler, /const romPath = getLastBuiltMediaPath\(\)/);
  assert.match(htmlHandler, /const romPath = getLastBuiltMediaPath\(\)/);
  assert.match(romHandler, /pceExport\.preparePceExportMedia\(romPath\)/);
  assert.match(htmlHandler, /pceExport\.preparePceExportMedia\(romPath\)/);
  assert.match(htmlHandler, /pceExport\.createPceItchIoBundle\(/);
  assert.match(htmlHandler, /cdBundle\.createStoredZipBuffer\(bundle\.entries\)/);
  assert.doesNotMatch(htmlHandler, /readSystemCard/);
  assert.doesNotMatch(htmlHandler, /runBuildFull\(/);
  assert.match(htmlHandler, /エクスポートできるビルド済み PCE メディアがありません/);
});

test('PCE HuCard itch.io page uses normal relative package paths', () => {
  const html = generatePceItchIoHtml({ media: sampleMedia(), emulatorAssets: minimalEmulatorAssets() });

  assert.match(html, /<script src="data\/loader\.js"><\/script>/);
  assert.match(html, /window\.EJS_core = 'pce'/);
  assert.match(html, /new URL\("rom\/sample\.pce", window\.location\.href\)\.href/);
  assert.match(html, /new URL\('data\/', window\.location\.href\)\.href/);
  assert.match(html, /window\.EJS_forceLegacyCores = true/);
  assert.match(html, /window\.EJS_defaultOptions = \{ vsync: 'disabled' \}/);
  assert.doesNotMatch(html, /pce-export-payload/);
  assert.doesNotMatch(html, /URL\.createObjectURL/);
  assert.doesNotMatch(html, /window\.EJS_paths/);
});

test('PCE HuCard itch.io ZIP puts index.html, ROM, runtime, licenses, and source notice at fixed paths', () => {
  const bundle = createPceItchIoBundle({ media: sampleMedia(), emulatorAssets: minimalEmulatorAssets() });
  const names = bundle.entries.map((entry) => entry.name).sort();

  assert.equal(bundle.entryName, 'index.html');
  assert.ok(names.includes('index.html'));
  assert.ok(names.includes('rom/sample.pce'));
  assert.ok(names.includes('data/loader.js'));
  assert.ok(names.includes('data/compression/extract7z.js'));
  assert.ok(names.includes('data/cores/mednafen_pce-legacy-wasm.data'));
  assert.ok(names.includes('LICENSES/EmulatorJS-GPL-3.0.txt'));
  assert.ok(names.includes('LICENSES/mednafen_pce-GPL-2.0-only.txt'));
  assert.ok(names.includes('LICENSES/NOTICE.txt'));
  assert.ok(names.includes('SOURCE.md'));
  assert.equal(bundle.entries.find((entry) => entry.name === 'rom/sample.pce').data.equals(sampleMedia().buffer), true);
  assert.match(bundle.entries.find((entry) => entry.name === 'LICENSES/NOTICE.txt').data.toString('utf-8'), /complete corresponding source/);
  const source = bundle.entries.find((entry) => entry.name === 'SOURCE.md').data.toString('utf-8');
  assert.match(source, /sample-source\.zip/);
  assert.match(source, /https:\/\/example\.invalid\/EmulatorJS/);
  assert.match(source, /mednafen_pce-GPL-2\.0-only\.txt/);
  assert.match(source, /0123456789abcdef/);
});

test('PCE Export rejects CD-ROM2 media and never emits a System Card payload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-export-cd-reject-'));
  const cuePath = path.join(dir, 'game.cue');
  fs.writeFileSync(cuePath, 'FILE "game.iso" BINARY\n  TRACK 01 MODE1/2048\n', 'utf-8');
  assert.throws(() => preparePceExportMedia(cuePath), /CD-ROM2 プロジェクトは Export の対象外です/);
  assert.throws(
    () => createPceItchIoBundle({ media: { mediaType: 'cdrom2' }, emulatorAssets: minimalEmulatorAssets() }),
    /CD-ROM2 プロジェクトは itch\.io Export の対象外です/,
  );
});

test('PCE EmulatorJS asset collection selects the legacy core and the 7z extractor', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-export-runtime-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, 'cores', 'reports'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'compression'), { recursive: true });
  fs.writeFileSync(path.join(root, 'LICENSE'), 'GPL-3.0');
  fs.writeFileSync(path.join(dataDir, 'loader.js'), 'loader');
  fs.writeFileSync(path.join(dataDir, 'emulator.min.js'), 'runtime');
  fs.writeFileSync(path.join(dataDir, 'emulator.min.css'), 'css');
  fs.writeFileSync(path.join(dataDir, 'compression', 'extract7z.js'), 'extractor');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '4.2.4-test', repository: { url: 'https://example.invalid/EmulatorJS' } }));
  fs.writeFileSync(path.join(dataDir, 'cores', 'cores.json'), JSON.stringify([{ name: 'mednafen_pce', repo: 'https://example.invalid/beetle-pce-libretro', license: 'COPYING' }]));
  fs.writeFileSync(path.join(dataDir, 'cores', 'reports', 'mednafen_pce.json'), '{}');
  fs.writeFileSync(path.join(dataDir, 'cores', 'mednafen_pce-wasm.data'), 'modern core');
  fs.writeFileSync(path.join(dataDir, 'cores', 'mednafen_pce-legacy-wasm.data'), 'legacy core');
  const collected = collectPceEmulatorJsAssets({
    rootDir: root,
    dataDir,
    loaderPath: path.join(dataDir, 'loader.js'),
    coreAsset: 'mednafen_pce-wasm.data',
  });
  const paths = collected.assets.map((asset) => asset.relativePath).sort();

  assert.equal(collected.coreAsset, 'mednafen_pce-legacy-wasm.data');
  assert.equal(collected.licenseText.toString('utf-8'), 'GPL-3.0');
  assert.match(collected.coreLicenseText.toString('utf-8'), /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 2/);
  assert.equal(collected.sourceInfo.emulatorJsVersion, '4.2.4-test');
  assert.equal(collected.sourceInfo.coreRepository, 'https://example.invalid/beetle-pce-libretro');
  assert.match(collected.sourceInfo.coreSha256, /^[a-f0-9]{64}$/);
  assert.ok(paths.includes('loader.js'));
  assert.ok(paths.includes('compression/extract7z.js'));
  assert.ok(paths.includes('cores/mednafen_pce-legacy-wasm.data'));
  assert.ok(!paths.includes('cores/mednafen_pce-wasm.data'));
});
