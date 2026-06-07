'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pluginDir = path.join(__dirname, '..', 'plugins', 'pce-standard-emulator');

test('PCE standard emulator exposes Test Play assets and launch hook', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf-8'));
  const plugin = require(path.join(pluginDir, 'index.js'));

  assert.deepEqual(manifest.supportedCores, ['pc-engine']);
  assert.deepEqual(manifest.roles, [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 20 }]);
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay.html')));
  assert.ok(fs.existsSync(path.join(pluginDir, 'testplay-preload.js')));

  let received = null;
  const result = await plugin.onTestPlay({ romPath: 'sample.pce' }, {
    testPlay: {
      openWasmWindow: async (options) => {
        received = options;
        return { opened: true };
      },
    },
  });

  assert.deepEqual(received, { romPath: 'sample.pce', pluginId: 'pce-standard-emulator' });
  assert.equal(result.ok, true);
  assert.equal(result.handled, true);
});

test('PCE EmulatorJS page bridges core EJS_Runtime into window global', () => {
  const html = fs.readFileSync(path.join(pluginDir, 'testplay.html'), 'utf-8');

  assert.match(html, /installRuntimeGlobalBridge/);
  assert.match(html, /globalThis\.EJS_Runtime=EJS_Runtime/);
  assert.match(html, /new NativeBlob\(bridgedParts,\s*options\)/);
  assert.match(html, /Element\.prototype\.appendChild/);
  assert.match(html, /fetch\(script\.src\)/);
  assert.match(html, /window\.EJS_core = 'pce'/);
  assert.match(html, /window\.EJS_startOnLoaded = true/);
  assert.match(html, /window\.EJS_cacheConfig = \{ enabled: false/);
  assert.match(html, /window\.EJS_pathtodata/);
});
