'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadPreloadWithMockedElectron } = require('./helpers/mock-electron');

test('main preload exposes renderer API methods with the expected IPC channels', async () => {
  const { exposed, invocations, listeners } = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'preload.js'));
  const api = exposed.electronAPI;

  assert.equal(typeof api.openRomDialog, 'function');
  assert.equal(typeof api.generateProject, 'function');
  assert.equal(typeof api.listResDefinitions, 'function');
  assert.equal(typeof api.deleteResFile, 'function');
  assert.equal(typeof api.pickFile, 'function');
  assert.equal(typeof api.readTempFileAsDataUrl, 'function');
  assert.equal(typeof api.listPlugins, 'function');
  assert.equal(typeof api.getPluginRendererAssets, 'function');
  assert.equal(typeof api.invokePluginHook, 'function');
  assert.equal(typeof api.getPluginRoles, 'function');
  assert.equal(typeof api.setPluginRole, 'function');
  assert.equal(typeof api.saveProjectConfig, 'function');
  assert.equal(typeof api.listCores, 'function');
  assert.equal(typeof api.getActiveCore, 'function');
  assert.equal(typeof api.listAssets, 'function');
  assert.equal(typeof api.upsertAsset, 'function');
  assert.equal(typeof api.deleteAsset, 'function');
  assert.equal(typeof api.importAssetImage, 'function');
  assert.equal(typeof api.importAssetAudio, 'function');
  assert.equal(typeof api.previewAssetSource, 'function');
  assert.equal(typeof api.reorderAssets, 'function');
  assert.equal(typeof api.openLogWindow, 'function');
  assert.equal(typeof api.syncLogWindow, 'function');
  assert.equal(typeof api.appendLogWindowEntry, 'function');
  assert.equal(typeof api.onLogWindowClosed, 'function');
  assert.equal(typeof api.loadOptionalAudioEngine, 'function');
  assert.equal(typeof api.exportHtml, 'function');
  assert.equal(typeof api.getProjectStartupState, 'function');
  assert.equal(typeof api.startAiControlServer, 'function');
  assert.equal(typeof api.getAiControlStatus, 'function');
  assert.equal(typeof api.listAiControlTools, 'function');
  assert.equal(typeof api.renameCodeEntry, 'function');
  assert.equal(typeof api.quitApp, 'function');

  await api.readRomFile('game.bin');
  await api.pickFile({ title: 'Pick' });
  await api.readTempFileAsDataUrl('tmp.wav', { deleteAfter: true });
  await api.deleteResFile('resources.res');
  await api.setPluginRole('builder', 'slideshow');
  await api.saveProjectConfig({ title: 'Saved' });
  await api.runBuild({ skipClean: true });
  await api.getPluginRendererAssets('asset-manager');
  await api.listCores();
  await api.getActiveCore();
  await api.listAssets();
  await api.upsertAsset({ id: 'img', type: 'image' });
  await api.deleteAsset('img');
  await api.importAssetImage({ id: 'img', sourcePath: '/tmp/img.png' });
  await api.importAssetAudio({ id: 'voice', sourcePath: '/tmp/voice.wav' });
  await api.previewAssetSource('assets/images/img.png');
  await api.reorderAssets(['img']);
  await api.invokePluginHook('audio-converter', 'convertAudio', { sourcePath: 'in.wav' });
  await api.loadOptionalAudioEngine('nuked-opn2');
  await api.openLogWindow({ entries: [] });
  await api.appendLogWindowEntry({ source: 'app', text: 'hello' });
  await api.createCodeEntry({ path: 'src/new.c', type: 'file' });
  await api.renameCodeEntry({ fromPath: 'src/new.c', toPath: 'src/renamed.c' });
  await api.startAiControlServer({ port: 17777 });
  await api.getProjectStartupState();
  await api.quitApp();

  assert.deepEqual(invocations.find((entry) => entry.channel === 'res:deleteFile'), {
    channel: 'res:deleteFile',
    args: ['resources.res'],
  });

  assert.deepEqual(invocations.slice(-5), [
    { channel: 'codefs:create', args: [{ path: 'src/new.c', type: 'file' }] },
    { channel: 'codefs:rename', args: [{ fromPath: 'src/new.c', toPath: 'src/renamed.c' }] },
    { channel: 'ai-control:start', args: [{ port: 17777 }] },
    { channel: 'project:getStartupState', args: [] },
    { channel: 'app:quit', args: [] },
  ]);

  assert.deepEqual(invocations.find((entry) => entry.channel === 'build:saveProjectConfig'), {
    channel: 'build:saveProjectConfig',
    args: [{ title: 'Saved' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'build:run'), {
    channel: 'build:run',
    args: [{ skipClean: true }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'setup:loadOptionalAudioEngine'), {
    channel: 'setup:loadOptionalAudioEngine',
    args: ['nuked-opn2'],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'cores:list'), {
    channel: 'cores:list',
    args: [],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:upsert'), {
    channel: 'assets:upsert',
    args: [{ id: 'img', type: 'image' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:importImage'), {
    channel: 'assets:importImage',
    args: [{ id: 'img', sourcePath: '/tmp/img.png' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:importAudio'), {
    channel: 'assets:importAudio',
    args: [{ id: 'voice', sourcePath: '/tmp/voice.wav' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:previewSource'), {
    channel: 'assets:previewSource',
    args: [{ relativePath: 'assets/images/img.png' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:reorder'), {
    channel: 'assets:reorder',
    args: [{ ids: ['img'] }],
  });

  let received = null;
  api.onBuildLog((payload) => { received = payload; });
  listeners.get('build-log')({}, { line: 'ok' });
  assert.deepEqual(received, { line: 'ok' });

  let aiControlLog = null;
  api.onAiControlLog((payload) => { aiControlLog = payload; });
  listeners.get('ai-control-log')({}, { message: 'started' });
  assert.deepEqual(aiControlLog, { message: 'started' });

  let logWindowClosed = null;
  api.onLogWindowClosed((payload) => { logWindowClosed = payload; });
  listeners.get('log:windowClosed')({}, { closed: true });
  assert.deepEqual(logWindowClosed, { closed: true });
});

test('setup preload exposes setup IPC helpers and progress listener', async () => {
  const { exposed, invocations, listeners } = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'setup-preload.js'));
  const api = exposed.electronSetup;

  await api.getStatus();
  await api.getActiveCore();
  await api.getCatalog();
  await api.listVersions('llvmMos');
  await api.downloadTool({ kind: 'llvmMos' });
  await api.setToolPath('llvmMos', '/tools/mos-pce-clang');
  await api.selectPceCdImage();
  await api.extractPceCdIpl({ sourcePath: '/disc/game.cue', confirmOwnedSource: true });
  await api.downloadSgdk('v2.11');
  await api.downloadEmsdk();
  await api.downloadNukedOpn2();
  await api.buildNukedOpn2Wasm();
  await api.setMarsdevPath('C:/marsdev');

  assert.deepEqual(invocations, [
    { channel: 'setup:getStatus', args: [] },
    { channel: 'cores:getActive', args: [] },
    { channel: 'setup:getCatalog', args: [] },
    { channel: 'setup:listVersions', args: [{ kind: 'llvmMos' }] },
    { channel: 'setup:downloadTool', args: [{ kind: 'llvmMos' }] },
    { channel: 'setup:setToolPath', args: [{ kind: 'llvmMos', value: '/tools/mos-pce-clang' }] },
    { channel: 'setup:selectPceCdImage', args: [] },
    { channel: 'setup:extractPceCdIpl', args: [{ sourcePath: '/disc/game.cue', confirmOwnedSource: true }] },
    { channel: 'setup:downloadSgdk', args: ['v2.11'] },
    { channel: 'setup:downloadEmsdk', args: [] },
    { channel: 'setup:downloadNukedOpn2', args: [] },
    { channel: 'setup:buildNukedOpn2Wasm', args: [] },
    { channel: 'setup:setMarsdevPath', args: ['C:/marsdev'] },
  ]);

  let received = null;
  api.onProgress((payload) => { received = payload; });
  listeners.get('setup-progress')({}, { percent: 50 });
  assert.deepEqual(received, { percent: 50 });
});

test('testplay and debug preload APIs route to their IPC channels', async () => {
  const testplay = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'plugins', 'standard-emulator', 'testplay-preload.js'));
  await testplay.exposed.electronTestPlay.openDebugWindow({ tab: 'vram' });
  await testplay.exposed.electronTestPlay.getSettings();
  assert.deepEqual(testplay.invocations, [
    { channel: 'window:openDebug', args: [{ tab: 'vram' }] },
    { channel: 'testplay:getSettings', args: [] },
  ]);

  const settings = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'testplay-settings-preload.js'));
  await settings.exposed.testPlaySettingsAPI.saveSettings({ gamepadDeadzone: 0.25 });
  assert.deepEqual(settings.invocations, [
    { channel: 'testplay:saveSettings', args: [{ gamepadDeadzone: 0.25 }] },
  ]);

  const debug = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'debug-preload.js'));
  await debug.exposed.electronDebug.getWasmSnapshot();
  assert.deepEqual(debug.invocations, [
    { channel: 'debug:getWasmSnapshot', args: [{}] },
  ]);
});

test('api testplay preload routes API lifecycle IPC channels', async () => {
  const api = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'plugins', 'standard-api-emulator', 'api-testplay-preload.js'));

  await api.exposed.apiTestPlay.stopApiServer();
  await api.exposed.apiTestPlay.isApiServerRunning();

  assert.deepEqual(api.invocations, [
    { channel: 'api:stopServer', args: [] },
    { channel: 'api:isRunning', args: [] },
  ]);
});
