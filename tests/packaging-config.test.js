'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readPackageConfig() {
  return fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf-8');
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
}

test('packaging declares main-process runtime dependencies', () => {
  const pkg = readPackageJson();

  assert.equal(pkg.dependencies?.['iconv-lite'], '0.6.3');
  assert.equal(pkg.dependencies?.['@audio/encode-ogg'], '1.2.2');
  assert.equal(pkg.dependencies?.['@electron/asar'], '3.4.1');
  assert.equal(pkg.devDependencies?.['iconv-lite'], undefined);
  const config = readPackageConfig();
  assert.match(config, /!node_modules\/wasm-media-encoders\/\*\*/);
  assert.match(config, /!node_modules\/@swc\/helpers\/\*\*/);
});

test('development start script forwards stop signals to Electron', () => {
  const pkg = readPackageJson();
  const scriptPath = path.join(__dirname, '..', 'scripts', 'start-electron.js');
  const script = fs.readFileSync(scriptPath, 'utf-8');

  assert.equal(pkg.scripts?.start, 'node scripts/start-electron.js');
  assert.match(script, /SIGTERM/);
  assert.match(script, /child\.kill\(signal\)/);
  assert.match(script, /child\.kill\('SIGKILL'\)/);
});

test('packaging includes the bundled game editor template projects', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*template/);
  assert.match(config, /to:\s*template/);
  assert.match(config, /!\*\*\/out\/\*\*/);
  assert.doesNotMatch(config, /from:\s*projects\/sample_block_game/);
  assert.doesNotMatch(config, /from:\s*projects\/sample_slideshow/);
  assert.doesNotMatch(config, /from:\s*projects\/sample\s/);
  assert.doesNotMatch(config, /to:\s*projects\/sample\s/);
});

test('packaging includes the PCE standard emulator plugin assets', () => {
  const config = readPackageConfig();
  const pluginDir = path.join(__dirname, '..', 'plugins', 'pce-standard-emulator');

  assert.match(config, /from:\s*plugins/);
  assert.match(config, /to:\s*plugins/);
  ['manifest.json', 'index.js', 'testplay.html', 'testplay-preload.js'].forEach((file) => {
    assert.equal(fs.existsSync(path.join(pluginDir, file)), true, `missing pce-standard-emulator/${file}`);
  });
});

test('packaging exposes third-party notices and exact license texts', () => {
  const config = readPackageConfig();
  const root = path.join(__dirname, '..');

  assert.match(config, /from:\s*LICENSE/);
  assert.match(config, /THIRD_PARTY_NOTICES\.md/);
  assert.match(config, /from:\s*licenses/);
  assert.match(config, /third_party\/\*\*/);
  [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses/Electron-MIT.txt',
    'licenses/electron-asar-MIT.txt',
    'licenses/iconv-lite-MIT.txt',
    'licenses/safer-buffer-MIT.txt',
    'licenses/electron-builder-MIT.txt',
    'licenses/GPL-2.0-only.txt',
    'licenses/audio-encode-ogg-MIT.txt',
    'licenses/wasm-media-encoders-MIT.txt',
    'licenses/swc-helpers-Apache-2.0.txt',
    'licenses/libogg-1.3.4-BSD.txt',
    'licenses/libvorbis-1.3.7-BSD.txt',
    'third_party/misaki-font/LICENSE.txt',
  ].forEach((file) => {
    assert.equal(fs.existsSync(path.join(root, file)), true, `missing ${file}`);
  });

  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf-8');
  const appLicense = fs.readFileSync(path.join(root, 'LICENSE'), 'utf-8');
  const pkg = readPackageJson();
  assert.equal(pkg.author, 'HOSSIE');
  assert.equal(pkg.license, 'MIT');
  assert.match(appLicense, /MIT License[\s\S]*Copyright \(c\) 2026 HOSSIE/);
  assert.ok(notices.includes(`| Electron | ${pkg.devDependencies.electron} |`));
  assert.ok(notices.includes(`| @electron/asar | ${pkg.dependencies['@electron/asar']} |`));
  assert.ok(notices.includes(`| iconv-lite | ${pkg.dependencies['iconv-lite']} |`));
  assert.ok(notices.includes(`| @audio/encode-ogg | ${pkg.dependencies['@audio/encode-ogg']} |`));
  assert.match(notices, /\| Misaki Gothic \| 2021-05-05 \|/);
});

test('packaging has no legacy MD emulator or md-api plugin', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*plugins/);
  assert.match(config, /to:\s*plugins/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'plugins', 'standard-emulator')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'plugins', 'standard-api-emulator')), false);
});

test('Windows self-extracting exe and zip use x64 targets without enabling portable storage', () => {
  const config = readPackageConfig();
  const pkg = readPackageJson();
  assert.match(config, /target: portable\s+arch: \[x64\]/);
  assert.match(config, /target: zip\s+arch: \[x64\]/);
  assert.match(config, /artifactName: "\$\{productName\}-\$\{version\}-win-\$\{arch\}\.\$\{ext\}"/);
  assert.match(config, /portable:\s+artifactName: "PCEGameEditor-\$\{version\}-Portable-\$\{arch\}\.exe"\s+useZip: true\s+requestExecutionLevel: user/);
  assert.doesNotMatch(config, /(?:target: nsis|^nsis:)/m);
  assert.doesNotMatch(config, /from:\s*build\/portable/);
  assert.match(config, /afterPack: scripts\/verify-distribution\.js/);
  assert.match(config, /- build-meta\.json/);
  assert.match(pkg.scripts['build:win'], /electron-builder --win --x64$/);
  assert.match(pkg.scripts['build:win:exe'], /electron-builder --win portable --x64$/);
  assert.equal(pkg.scripts['build:win:installer'], undefined);
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[''].version);
});

test('distribution audit rejects personal data, toolchains, BIOS and prebuilt game media', () => {
  const { validateEntry } = require('../scripts/verify-distribution');
  for (const entry of ['data/settings.json', '.git/config', 'tools/dev/task.js', 'scripts/helper.js', 'build/portable']) {
    assert.throws(() => validateEntry(entry, 'app'), /distribution|build asset/);
  }
  for (const entry of ['template/sample/out/game.pce', 'template/sample/syscard3.pce', 'plugins/sdk/tool.exe', 'plugins/game.iso', 'plugins/.env', 'plugins/example/.env.local']) {
    assert.throws(() => validateEntry(entry, 'resources'), /distribution/);
  }
  // Runtime source, converted template assets, notices and dependency internals are required.
  for (const entry of ['template/template_pce_vn_cd/src/vn_system_card.c', 'template/sample/assets/generated/palette.bin', 'licenses/Electron-MIT.txt']) {
    assert.doesNotThrow(() => validateEntry(entry, 'resources'));
  }
  assert.doesNotThrow(() => validateEntry('node_modules/@electron/asar/lib/disk.js', 'app'));
});

test('distribution audit reads real ASAR paths and detects altered license copies', async (t) => {
  const os = require('node:os');
  const asar = require('@electron/asar');
  const { verifyDistribution } = require('../scripts/verify-distribution');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-distribution-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('pce-distribution-test-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const source = path.join(fixture, 'source');
  const appOut = path.join(fixture, 'win-unpacked');
  const resources = path.join(appOut, 'resources');
  const write = (base, file, text) => {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), text);
  };
  write(source, 'package.json', JSON.stringify({ version: '0.4.1' }));
  write(source, 'build-meta.json', JSON.stringify({ buildNumber: '20260912.120000', buildAt: '2026-09-12T12:00:00Z' }));
  for (const entry of ['main.js', 'renderer/index.html', 'renderer/log-viewer.html', 'renderer/setup.html', 'renderer/testplay-settings.html', 'third_party/misaki-font/LICENSE.txt']) {
    write(source, entry, 'fixture');
  }
  for (const entry of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/example.txt']) {
    write(source, entry, 'exact license text');
    write(resources, entry, 'exact license text');
  }
  for (const entry of ['plugins/pc-engine-core/manifest.json', 'template/template_pce_vn_cd/project.json', 'template/template_pce_vn_hucard/project.json']) {
    write(resources, entry, '{}');
  }
  const archiveSource = path.join(fixture, 'archive-source');
  fs.cpSync(source, archiveSource, { recursive: true });
  // electron-builder copies root notices as extraResources rather than ASAR entries.
  fs.unlinkSync(path.join(archiveSource, 'LICENSE'));
  fs.unlinkSync(path.join(archiveSource, 'THIRD_PARTY_NOTICES.md'));
  await asar.createPackage(archiveSource, path.join(resources, 'app.asar'));
  assert.equal(verifyDistribution(appOut, resources, source).version, '0.4.1');
  write(resources, 'licenses/example.txt', 'altered license text');
  assert.throws(() => verifyDistribution(appOut, resources, source), /Missing or altered external license/);
});
