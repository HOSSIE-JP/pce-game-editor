'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

test('renderer project settings normalize only the current PCE fields', async () => {
  const settings = await import(pathToFileURL(path.join(__dirname, '..', 'renderer', 'project-settings.mjs')).href);
  const config = settings.buildPceProjectSettings({ romName: 'stable' }, {
    title: 'Demo', externalEmulator: { executablePath: '  C:/emu.exe ', extraArgs: ' --fullscreen ' },
  });
  assert.equal(config.coreId, 'pc-engine');
  assert.equal(config.toolchain, 'llvm-mos');
  assert.equal(config.title, 'Demo');
  assert.deepEqual(config.testPlay.externalEmulator, { executablePath: 'C:/emu.exe', extraArgs: '--fullscreen' });
  assert.equal(Object.hasOwn(config, 'author'), false);
});
