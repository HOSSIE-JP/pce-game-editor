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
