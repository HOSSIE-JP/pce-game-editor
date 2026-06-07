'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readManifest(pluginId) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', pluginId, 'manifest.json'),
    'utf-8',
  ));
}

test('standard WASM emulator owns its bundled testplay assets and handles launch', async () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-emulator');
  const manifest = readManifest('standard-emulator');
  const plugin = require(path.join(pluginDir, 'index.js'));

  assert.ok(manifest.permissions.includes('testplay.launch'));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay.html')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay-preload.js')));
  const html = fs.readFileSync(path.join(pluginDir, 'testplay.html'), 'utf-8');
  assert.match(html, /import MdEmulator from ['"]\.\/md-emulator\.js['"]/);
  assert.match(html, /new URL\(['"]\.\/pkg\/md_wasm\.js['"],\s*import\.meta\.url\)/);
  assert.doesNotMatch(html, /\.\.\/\.\.\/pkg\/md_wasm\.js/);

  let received = null;
  const result = await plugin.onTestPlay({ romPath: 'game.bin' }, {
    testPlay: {
      openWasmWindow: async (options) => {
        received = options;
        return { opened: true };
      },
    },
  });

  assert.deepEqual(received, { romPath: 'game.bin', pluginId: 'standard-emulator' });
  assert.equal(result.ok, true);
  assert.equal(result.handled, true);
});

test('standard API emulator declares testplay role and opens API-backed testplay window', async () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-api-emulator');
  const manifest = readManifest('standard-api-emulator');
  const plugin = require(path.join(pluginDir, 'index.js'));
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const prepareDistSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-dist.js'), 'utf-8');

  assert.equal(manifest.tab, undefined);
  assert.equal(manifest.renderer, undefined);
  assert.deepEqual(manifest.roles, [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 21 }]);
  assert.ok(manifest.permissions.includes('api.start'));
  assert.ok(fs.existsSync(path.join(pluginDir, 'api-testplay.html')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'api-testplay-preload.js')));
  assert.match(prepareDistSource, /'plugins',\s*'standard-api-emulator',\s*'bin'/);
  assert.match(mainSource, /getPluginDirectory\('standard-api-emulator'\)/);
  assert.match(mainSource, /path\.join\(standardApiEmulatorDir,\s*'bin',\s*binName\)/);
  assert.doesNotMatch(mainSource, /process\.resourcesPath,\s*'bin'/);

  let received = null;
  const result = await plugin.onTestPlay({ romPath: 'game.bin' }, {
    testPlay: {
      openApiWindow: async (options) => {
        received = options;
        return { opened: true, port: 8080 };
      },
    },
    logger: { info() {} },
  });

  assert.deepEqual(received, { romPath: 'game.bin', pluginId: 'standard-api-emulator' });
  assert.equal(result.ok, true);
  assert.equal(result.handled, true);
});
