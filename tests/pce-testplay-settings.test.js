'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

function loadSettingsManager(userData) {
  const electron = { app: { getPath: () => userData } };
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve('../pce-testplay-settings');
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test('PCE Test Play settings preserve the shared PCE setup document', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-testplay-settings-'));
  const toolsDir = path.join(userData, 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(toolsDir, 'settings.json'), JSON.stringify({ llvmMosPath: '/tools/mos' }), 'utf-8');
  const manager = loadSettingsManager(userData);

  const saved = manager.saveTestPlaySettings({
    keyboard: { A: 'Space' },
    gamepadDeadzone: 0.25,
    debug: { autoRefresh: false, vramTileLayout: '512x256' },
  });
  const document = JSON.parse(fs.readFileSync(path.join(toolsDir, 'settings.json'), 'utf-8'));

  assert.equal(saved.keyboard.A, 'Space');
  assert.equal(saved.gamepadDeadzone, 0.25);
  assert.equal(saved.debug.vramTileLayout, '512x256');
  assert.equal(document.llvmMosPath, '/tools/mos');
  assert.deepEqual(document.testPlay, saved);
});

test('PCE Test Play settings clamp invalid values to current defaults', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-testplay-defaults-'));
  const manager = loadSettingsManager(userData);
  const normalized = manager.normalizeTestPlaySettings({
    keyboard: { A: '  KeyQ  ', B: '' },
    gamepadDeadzone: 4,
    debug: { vramTileLayout: 'invalid' },
  });

  assert.equal(normalized.keyboard.A, 'KeyQ');
  assert.equal(normalized.keyboard.B, 'KeyZ');
  assert.equal(normalized.gamepadDeadzone, 0.95);
  assert.equal(normalized.debug.vramTileLayout, '256x512');
});
