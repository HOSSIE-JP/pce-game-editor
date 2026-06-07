'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-editor-setup-test-'));
}

function loadSetupManager(userData) {
  return loadWithMockedElectron(path.join(__dirname, '..', 'setup-manager.js'), { userData });
}

test('test play settings are normalized before saving', () => {
  const userData = makeTempUserData();
  const setupManager = loadSetupManager(userData);

  const saved = setupManager.saveTestPlaySettings({
    keyboard: { A: ' KeyQ ', START: '' },
    gamepad: { B: 'button:5', INVALID: 'button:99' },
    gamepadDeadzone: 2,
    debug: { autoRefresh: false, vramTileLayout: 'bad-layout' },
  });

  assert.equal(saved.keyboard.A, 'KeyQ');
  assert.equal(saved.keyboard.START, 'Enter');
  assert.equal(saved.gamepad.B, 'button:5');
  assert.equal(saved.gamepad.INVALID, undefined);
  assert.equal(saved.gamepadDeadzone, 0.95);
  assert.equal(saved.debug.autoRefresh, false);
  assert.equal(saved.debug.vramTileLayout, '256x512');

  const reloaded = setupManager.getTestPlaySettings();
  assert.deepEqual(reloaded, saved);
});

test('default test play settings are returned as independent objects', () => {
  const setupManager = loadSetupManager(makeTempUserData());
  const first = setupManager.getDefaultTestPlaySettings();
  first.keyboard.A = 'KeyP';

  const second = setupManager.getDefaultTestPlaySettings();
  assert.equal(second.keyboard.A, 'KeyA');
});

test('SGDK auto detection picks the newest extracted toolchain with makelib.gen', () => {
  const userData = makeTempUserData();
  const sgdkRoot = path.join(userData, 'tools', 'sgdk');
  fs.mkdirSync(path.join(sgdkRoot, 'SGDK-1.80'), { recursive: true });
  fs.mkdirSync(path.join(sgdkRoot, 'SGDK-2.11'), { recursive: true });
  fs.writeFileSync(path.join(sgdkRoot, 'SGDK-2.11', 'makelib.gen'), '', 'utf-8');

  const setupManager = loadSetupManager(userData);
  const status = setupManager.checkSgdk();

  assert.equal(status.installed, true);
  assert.equal(status.version, '2.11');
  assert.equal(status.path, path.join(sgdkRoot, 'SGDK-2.11'));
});

test('Marsdev path resolution accepts either the root or m68k-elf directory', () => {
  const userData = makeTempUserData();
  const marsdevRoot = path.join(userData, 'marsdev-custom');
  const gdkDir = path.join(marsdevRoot, 'm68k-elf');
  fs.mkdirSync(gdkDir, { recursive: true });
  fs.writeFileSync(path.join(gdkDir, 'makelib.gen'), '', 'utf-8');

  const setupManager = loadSetupManager(userData);
  setupManager.setMarsdevPath(marsdevRoot);

  assert.equal(setupManager.getMarsdevPath(), gdkDir);
  const status = setupManager.checkMarsdev();
  assert.equal(status.installed, true);
  assert.equal(status.path, gdkDir);
  assert.equal(typeof status.version, 'string');
});

test('toolchain selection prefers XGM2-capable SGDK over older Marsdev on Unix', () => {
  const userData = makeTempUserData();
  const sgdkPath = path.join(userData, 'tools', 'sgdk', 'SGDK-2.11');
  const marsdevRoot = path.join(userData, 'tools', 'marsdev', 'mars');
  const marsdevPath = path.join(marsdevRoot, 'm68k-elf');
  fs.mkdirSync(path.join(sgdkPath, 'inc', 'snd'), { recursive: true });
  fs.mkdirSync(path.join(sgdkPath, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(marsdevPath, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(sgdkPath, 'makelib.gen'), '', 'utf-8');
  fs.writeFileSync(path.join(sgdkPath, 'inc', 'snd', 'xgm2.h'), '', 'utf-8');
  fs.writeFileSync(path.join(sgdkPath, 'inc', 'z80_ctrl.h'), '#define Z80_DRIVER_XGM2 5\n', 'utf-8');
  fs.writeFileSync(path.join(sgdkPath, 'bin', 'rescomp.txt'), 'WAV driver XGM2\n', 'utf-8');
  fs.writeFileSync(path.join(sgdkPath, 'bin', 'xgm2tool.jar'), '', 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'makelib.gen'), '', 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'bin', 'm68k-elf-gcc'), '', 'utf-8');

  const setupManager = loadSetupManager(userData);

  assert.equal(setupManager.toolchainSupportsXgm2(sgdkPath), true);
  assert.equal(setupManager.selectToolchainDir({ platform: 'darwin', sgdkPath, marsdevPath }), sgdkPath);
  assert.equal(setupManager.selectToolchainDir({ platform: 'linux', sgdkPath, marsdevPath }), sgdkPath);
  assert.equal(setupManager.selectToolchainDir({ platform: 'win32', sgdkPath, marsdevPath }), sgdkPath);
});

test('toolchain selection keeps Marsdev when SGDK is not XGM2-capable', () => {
  const userData = makeTempUserData();
  const sgdkPath = path.join(userData, 'tools', 'sgdk', 'SGDK-1.80');
  const marsdevPath = path.join(userData, 'tools', 'marsdev', 'mars', 'm68k-elf');
  fs.mkdirSync(sgdkPath, { recursive: true });
  fs.mkdirSync(marsdevPath, { recursive: true });
  fs.writeFileSync(path.join(sgdkPath, 'makelib.gen'), '', 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'makelib.gen'), '', 'utf-8');

  const setupManager = loadSetupManager(userData);

  assert.equal(setupManager.toolchainSupportsXgm2(sgdkPath), false);
  assert.equal(setupManager.selectToolchainDir({ platform: 'darwin', sgdkPath, marsdevPath }), marsdevPath);
  assert.equal(setupManager.selectToolchainDir({ platform: 'win32', sgdkPath, marsdevPath }), sgdkPath);
});

test('optional Nuked-OPN2 source is detected outside the bundled app payload', () => {
  const userData = makeTempUserData();
  const sourceDir = path.join(userData, 'tools', 'audio-engines', 'nuked-opn2', 'Nuked-OPN2-master');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'ym3438.c'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'ym3438.h'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'LICENSE'), 'LGPL-2.1', 'utf-8');

  const setupManager = loadSetupManager(userData);
  const status = setupManager.checkNukedOpn2();
  const fullStatus = setupManager.getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.wasmInstalled, false);
  assert.equal(status.sourcePath, sourceDir);
  assert.equal(status.license, 'LGPL-2.1-or-later');
  assert.deepEqual(fullStatus.audioEngines.nukedOpn2, status);
});

test('emsdk and emcc are detected from the user tools directory', () => {
  const userData = makeTempUserData();
  const emsdkDir = path.join(userData, 'tools', 'emsdk', 'emsdk-main');
  const emccDir = path.join(emsdkDir, 'upstream', 'emscripten');
  fs.mkdirSync(emccDir, { recursive: true });
  fs.writeFileSync(path.join(emsdkDir, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk'), '', 'utf-8');
  fs.writeFileSync(path.join(emccDir, process.platform === 'win32' ? 'emcc.bat' : 'emcc'), '', 'utf-8');
  fs.mkdirSync(path.join(userData, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'tools', 'settings.json'), JSON.stringify({ emsdkPath: emsdkDir, emccVersion: 'emcc test version' }), 'utf-8');

  const setupManager = loadSetupManager(userData);
  const status = setupManager.checkEmsdk();
  const fullStatus = setupManager.getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.emccInstalled, true);
  assert.equal(status.path, emsdkDir);
  assert.equal(status.emccVersion, 'emcc test version');
  assert.equal(fullStatus.emsdk.path, emsdkDir);
  assert.equal(fullStatus.emcc.installed, true);
});

test('Nuked-OPN2 build plan wires emcc, wrapper source, ym3438.c, and wasm outputs', () => {
  const userData = makeTempUserData();
  const toolsDir = path.join(userData, 'tools');
  const emsdkDir = path.join(toolsDir, 'emsdk', 'emsdk-main');
  const emccDir = path.join(emsdkDir, 'upstream', 'emscripten');
  const sourceDir = path.join(toolsDir, 'audio-engines', 'nuked-opn2', 'Nuked-OPN2-master');
  fs.mkdirSync(emccDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(emsdkDir, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk'), '', 'utf-8');
  fs.writeFileSync(path.join(emccDir, process.platform === 'win32' ? 'emcc.bat' : 'emcc'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'ym3438.c'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'ym3438.h'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'LICENSE'), 'LGPL-2.1', 'utf-8');
  fs.writeFileSync(path.join(toolsDir, 'settings.json'), JSON.stringify({ emsdkPath: emsdkDir, emccVersion: 'emcc test version' }), 'utf-8');

  const setupManager = loadSetupManager(userData);
  const plan = setupManager.getNukedOpn2BuildPlan();

  assert.equal(plan.ok, true);
  assert.equal(plan.command, path.join(emccDir, process.platform === 'win32' ? 'emcc.bat' : 'emcc'));
  assert.ok(plan.args.includes(path.join(sourceDir, 'ym3438.c')));
  assert.ok(plan.args.includes(path.join(sourceDir, 'build', 'md_nuked_opn2_wrapper.c')));
  assert.ok(plan.args.includes(path.join(sourceDir, 'build', 'dist', 'nuked-opn2.js')));
  assert.ok(plan.args.includes('-sEXPORTED_FUNCTIONS=_nuke_init,_nuke_reset,_nuke_write,_nuke_render,_malloc,_free'));
  assert.ok(plan.args.includes('-sEXPORTED_RUNTIME_METHODS=cwrap,HEAP16'));
});

test('optional Nuked-OPN2 WASM engine payload is loaded only from user tools', () => {
  const userData = makeTempUserData();
  const sourceDir = path.join(userData, 'tools', 'audio-engines', 'nuked-opn2', 'Nuked-OPN2-master');
  const distDir = path.join(sourceDir, 'build', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'ym3438.c'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'ym3438.h'), '', 'utf-8');
  fs.writeFileSync(path.join(sourceDir, 'LICENSE'), 'LGPL-2.1', 'utf-8');
  fs.writeFileSync(path.join(distDir, 'nuked-opn2.js'), 'export default async () => ({ renderVgmEvents() {} });', 'utf-8');
  fs.writeFileSync(path.join(distDir, 'nuked-opn2.wasm'), Buffer.from([0, 97, 115, 109]));
  fs.writeFileSync(path.join(distDir, 'BUILD_INFO.json'), JSON.stringify({ source: 'nukeykt/Nuked-OPN2' }), 'utf-8');

  const setupManager = loadSetupManager(userData);
  const payload = setupManager.loadOptionalAudioEngine('nuked-opn2');

  assert.equal(payload.ok, true, payload.error);
  assert.match(payload.jsDataUrl, /^data:text\/javascript;base64,/);
  assert.match(payload.wasmDataUrl, /^data:application\/wasm;base64,/);
  assert.equal(payload.buildInfo.source, 'nukeykt/Nuked-OPN2');
});
