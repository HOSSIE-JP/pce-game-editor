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
  assert.equal(pkg.devDependencies?.['iconv-lite'], undefined);
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

test('packaging keeps WASM runtime assets inside the standard emulator plugin', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*plugins/);
  assert.match(config, /to:\s*plugins/);
  assert.doesNotMatch(config, /^\s*-\s*pkg\/\*\*/m);
  assert.doesNotMatch(config, /^\s*-\s*md-emulator\.js/m);
  assert.doesNotMatch(config, /^\s*-\s*md-emulator\.d\.ts/m);
});

test('packaging keeps md-api binary inside the standard API emulator plugin', () => {
  const config = readPackageConfig();

  assert.match(config, /from:\s*plugins/);
  assert.match(config, /to:\s*plugins/);
  assert.doesNotMatch(config, /from:\s*bin/);
  assert.doesNotMatch(config, /to:\s*bin/);
});
