'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadPreloadWithMockedElectron } = require('./helpers/mock-electron');

test('main preload exposes renderer API methods with the expected IPC channels', async () => {
  const { exposed, invocations, listeners } = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'preload.js'));
  const api = exposed.electronAPI;

  assert.equal(typeof api.generateProject, 'function');
  assert.equal(typeof api.pickFile, 'function');
  assert.equal(typeof api.readFileAsDataUrl, 'function');
  assert.equal(typeof api.listPlugins, 'function');
  assert.equal(typeof api.listPluginDiagnostics, 'function');
  assert.equal(typeof api.getPluginRendererAssets, 'function');
  assert.equal(typeof api.invokePluginHook, 'function');
  assert.equal(typeof api.getPluginRoles, 'function');
  assert.equal(typeof api.setPluginRole, 'function');
  assert.equal(typeof api.setPluginTrusted, 'function');
  assert.equal(typeof api.listDiagnostics, 'function');
  assert.equal(typeof api.onDiagnostic, 'function');
  assert.equal(typeof api.saveProjectConfig, 'function');
  assert.equal(typeof api.listAssets, 'function');
  assert.equal(typeof api.upsertAsset, 'function');
  assert.equal(typeof api.deleteAsset, 'function');
  assert.equal(typeof api.importAssetImage, 'function');
  assert.equal(typeof api.importAssetAudio, 'function');
  assert.equal(typeof api.inspectAssetAdpcmBatch, 'function');
  assert.equal(typeof api.importAssetAdpcmBatch, 'function');
  assert.equal(typeof api.cancelAssetAdpcmBatch, 'function');
  assert.equal(typeof api.onAssetAdpcmBatchProgress, 'function');
  assert.equal(typeof api.importAssetVgm, 'function');
  assert.equal(typeof api.importAssetMidi, 'function');
  assert.equal(typeof api.previewAssetMidi, 'function');
  assert.equal(typeof api.inspectAssetPsgJson, 'function');
  assert.equal(typeof api.importAssetPsgJson, 'function');
  assert.equal(typeof api.previewAssetSource, 'function');
  assert.equal(typeof api.reorderAssets, 'function');
  assert.equal(typeof api.openLogWindow, 'function');
  assert.equal(typeof api.syncLogWindow, 'function');
  assert.equal(typeof api.appendLogWindowEntry, 'function');
  assert.equal(typeof api.onLogWindowClosed, 'function');
  assert.equal(typeof api.exportHtml, 'function');
  assert.equal(typeof api.exportVnIrodoriBatch, 'function');
  assert.equal(typeof api.exportVnGodotPackage, 'function');
  assert.equal(typeof api.inspectVnIrodoriVoiceAssignments, 'function');
  assert.equal(typeof api.getProjectStartupState, 'function');
  assert.equal(typeof api.startAiControlServer, 'function');
  assert.equal(typeof api.getAiControlStatus, 'function');
  assert.equal(typeof api.listAiControlTools, 'function');
  assert.equal(typeof api.renameCodeEntry, 'function');
  assert.equal(typeof api.quitApp, 'function');

  await api.pickFile({ title: 'Pick' });
  await api.readFileAsDataUrl('assets/voice.wav');
  await api.setPluginRole('builder', 'pce-slideshow-builder');
  await api.setPluginTrusted('custom-plugin', true);
  await api.listPluginDiagnostics({ includeIncompatible: true });
  await api.listDiagnostics();
  await api.saveProjectConfig({ title: 'Saved' });
  await api.runBuild({ skipClean: true });
  await api.getPluginRendererAssets('pce-asset-manager');
  await api.listAssets();
  await api.upsertAsset({ id: 'img', type: 'image' });
  await api.deleteAsset('img');
  await api.importAssetImage({ id: 'img', sourcePath: '/tmp/img.png' });
  await api.importAssetAudio({ id: 'voice', sourcePath: '/tmp/voice.wav' });
  await api.inspectAssetAdpcmBatch({ csvPath: '/tmp/voices.csv', sourceRoot: '/tmp/output' });
  await api.importAssetAdpcmBatch({ csvPath: '/tmp/voices.csv', sourceRoot: '/tmp/output', batchId: 'batch-1' });
  await api.cancelAssetAdpcmBatch({ batchId: 'batch-1' });
  await api.importAssetVgm({ id: 'song', sourcePath: '/tmp/song.vgm' });
  await api.importAssetMidi({ id: 'song', sourcePath: '/tmp/song.mid' });
  await api.previewAssetMidi({ id: 'song', sourcePath: '/tmp/song.mid' });
  await api.inspectAssetPsgJson({ sourcePath: '/tmp/song.psg.json' });
  await api.importAssetPsgJson({ id: 'song', sourcePath: '/tmp/song.psg.json', replace: true });
  await api.previewAssetSource('assets/images/img.png');
  await api.reorderAssets(['img']);
  await api.exportVnIrodoriBatch({ doc: { scenes: [] }, assetIds: ['voice'] });
  await api.exportVnGodotPackage({ doc: { scenes: [] } });
  await api.inspectVnIrodoriVoiceAssignments({ manifestPath: '/tmp/manifest.csv', doc: { scenes: [] }, assets: [] });
  await api.invokePluginHook('pce-audio-converter', 'convertAudio', { sourcePath: 'in.wav' });
  await api.openLogWindow({ entries: [] });
  await api.appendLogWindowEntry({ source: 'app', text: 'hello' });
  await api.createCodeEntry({ path: 'src/new.c', type: 'file' });
  await api.renameCodeEntry({ fromPath: 'src/new.c', toPath: 'src/renamed.c' });
  await api.startAiControlServer({ port: 17777 });
  await api.getProjectStartupState();
  await api.quitApp();

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
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:importVgm'), {
    channel: 'assets:importVgm',
    args: [{ id: 'song', sourcePath: '/tmp/song.vgm' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:importMidi'), {
    channel: 'assets:importMidi',
    args: [{ id: 'song', sourcePath: '/tmp/song.mid' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:previewMidi'), {
    channel: 'assets:previewMidi',
    args: [{ id: 'song', sourcePath: '/tmp/song.mid' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:previewSource'), {
    channel: 'assets:previewSource',
    args: [{ relativePath: 'assets/images/img.png' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:reorder'), {
    channel: 'assets:reorder',
    args: [{ ids: ['img'] }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:inspectPsgJson'), {
    channel: 'assets:inspectPsgJson',
    args: [{ sourcePath: '/tmp/song.psg.json' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:importPsgJson'), {
    channel: 'assets:importPsgJson',
    args: [{ id: 'song', sourcePath: '/tmp/song.psg.json', replace: true }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:inspectAdpcmBatch'), {
    channel: 'assets:inspectAdpcmBatch',
    args: [{ csvPath: '/tmp/voices.csv', sourceRoot: '/tmp/output' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:importAdpcmBatch'), {
    channel: 'assets:importAdpcmBatch',
    args: [{ csvPath: '/tmp/voices.csv', sourceRoot: '/tmp/output', batchId: 'batch-1' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'assets:cancelAdpcmBatch'), {
    channel: 'assets:cancelAdpcmBatch',
    args: [{ batchId: 'batch-1' }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'vn:exportIrodoriBatch'), {
    channel: 'vn:exportIrodoriBatch',
    args: [{ doc: { scenes: [] }, assetIds: ['voice'] }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'vn:exportGodotPackage'), {
    channel: 'vn:exportGodotPackage',
    args: [{ doc: { scenes: [] } }],
  });
  assert.deepEqual(invocations.find((entry) => entry.channel === 'vn:inspectIrodoriVoiceAssignments'), {
    channel: 'vn:inspectIrodoriVoiceAssignments',
    args: [{ manifestPath: '/tmp/manifest.csv', doc: { scenes: [] }, assets: [] }],
  });

  let received = null;
  api.onBuildLog((payload) => { received = payload; });
  listeners.get('build-log')({}, { line: 'ok' });
  assert.deepEqual(received, { line: 'ok' });

  let adpcmBatchProgress = null;
  api.onAssetAdpcmBatchProgress((payload) => { adpcmBatchProgress = payload; });
  listeners.get('assets:adpcmBatchProgress')({}, { batchId: 'batch-1', completedRows: 2 });
  assert.deepEqual(adpcmBatchProgress, { batchId: 'batch-1', completedRows: 2 });

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
  await api.getCatalog();
  await api.listVersions('llvmMos');
  await api.downloadTool({ kind: 'llvmMos' });
  await api.setToolPath('llvmMos', '/tools/mos-pce-clang');
  await api.selectPceCdImage();
  await api.extractPceCdIpl({ sourcePath: '/disc/game.cue', confirmOwnedSource: true });

  assert.deepEqual(invocations, [
    { channel: 'setup:getStatus', args: [] },
    { channel: 'setup:getCatalog', args: [] },
    { channel: 'setup:listVersions', args: [{ kind: 'llvmMos' }] },
    { channel: 'setup:downloadTool', args: [{ kind: 'llvmMos' }] },
    { channel: 'setup:setToolPath', args: [{ kind: 'llvmMos', value: '/tools/mos-pce-clang' }] },
    { channel: 'setup:selectPceCdImage', args: [] },
    { channel: 'setup:extractPceCdIpl', args: [{ sourcePath: '/disc/game.cue', confirmOwnedSource: true }] },
  ]);

  let received = null;
  api.onProgress((payload) => { received = payload; });
  listeners.get('setup-progress')({}, { percent: 50 });
  assert.deepEqual(received, { percent: 50 });
});

test('testplay preload APIs route to their IPC channels', async () => {
  const testplay = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'plugins', 'pce-standard-emulator', 'testplay-preload.js'));
  await testplay.exposed.pceTestPlay.getContext();
  await testplay.exposed.pceTestPlay.getSettings();
  assert.deepEqual(testplay.invocations, [
    { channel: 'testplay:getContext', args: [] },
    { channel: 'testplay:getSettings', args: [] },
  ]);

  const settings = loadPreloadWithMockedElectron(path.join(__dirname, '..', 'testplay-settings-preload.js'));
  await settings.exposed.testPlaySettingsAPI.saveSettings({ gamepadDeadzone: 0.25 });
  assert.deepEqual(settings.invocations, [
    { channel: 'testplay:saveSettings', args: [{ gamepadDeadzone: 0.25 }] },
  ]);
});
