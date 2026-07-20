'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const batchCsv = require('../pce-adpcm-batch-csv');
const { buildIrodoriBatchBundle } = require('../pce-vn-irodori-batch');
const { inspectIrodoriVoiceAssignments } = require('../pce-vn-irodori-assign');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeWavBuffer(sampleRate = 8000, frames = 32) {
  const dataSize = frames * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < frames; index += 1) {
    buffer.writeInt16LE(index % 2 ? 12000 : -12000, 44 + (index * 2));
  }
  return buffer;
}

function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function loadAssetManager() {
  const userData = makeTempDir('pce-adpcm-batch-user-');
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-asset-manager.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-adpcm-batch-home-') },
  });
}

function loadBuildSystem() {
  const userData = makeTempDir('pce-adpcm-batch-build-user-');
  delete require.cache[require.resolve('../pce-build-system')];
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-vn-manager')];
  delete require.cache[require.resolve('../pce-vn-hucard-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-build-system.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-adpcm-batch-build-home-') },
  });
}

test('ADPCM batch CSV accepts UTF-8 BOM, CRLF, quoted commas, relative paths, and canonical defaults', () => {
  const dir = makeTempDir('pce-adpcm-csv-');
  writeFile(dir, 'voices/voice,01.wav', makeWavBuffer(16000, 80));
  const csvPath = writeFile(dir, 'voices.csv', Buffer.from(
    '\uFEFFsource,id,name,sampleRate,loop,splitPolicy\r\n"voices/voice,01.wav",voice_01,"voice/アカリ, 01",8000,1,auto\r\n',
    'utf8'
  ));

  const inspected = batchCsv.inspectAdpcmBatchCsv(csvPath, [{ id: 'voice_01', type: 'adpcm', data: {} }]);
  assert.equal(inspected.summary.validRows, 1);
  assert.equal(inspected.rows[0].lineNumber, 2);
  assert.equal(inspected.rows[0].name, 'voice/アカリ, 01');
  assert.equal(inspected.rows[0].sampleRate, 8000);
  assert.equal(inspected.rows[0].loop, true);
  assert.deepEqual(inspected.rows[0].overwriteIds, ['voice_01']);
  assert.equal(inspected.rows[0].resolvedSourcePath, path.join(dir, 'voices', 'voice,01.wav'));

  const defaultsCsv = writeFile(dir, 'defaults.csv', [
    'id,source',
    `defaults,"${path.join(dir, 'voices', 'voice,01.wav')}"`,
  ].join('\n'));
  const defaults = batchCsv.inspectAdpcmBatchCsv(defaultsCsv, []);
  assert.equal(defaults.rows[0].name, 'voice,01');
  assert.equal(defaults.rows[0].sampleRate, 8000);
  assert.equal(defaults.rows[0].loop, false);
  assert.equal(defaults.rows[0].splitPolicy, 'auto');
});

test('ADPCM batch CSV resolves relative WAV files from an optional source root for inspection and import', async () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-adpcm-source-root-project-');
  const csvDir = makeTempDir('pce-adpcm-source-root-csv-');
  const wavRoot = makeTempDir('pce-adpcm-source-root-wav-');
  const absoluteWav = writeFile(wavRoot, 'absolute.wav', makeWavBuffer(8000, 48));
  writeFile(wavRoot, 'アカリ/voice_0001.wav', makeWavBuffer(16000, 80));
  const csvPath = writeFile(csvDir, 'adpcm-import.csv', [
    'source,id,name,sampleRate,loop,splitPolicy',
    'アカリ/voice_0001.wav,voice_0001,voice/アカリ/voice_0001,8000,false,auto',
    `${absoluteWav},absolute_voice,,8000,false,auto`,
  ].join('\n'));

  const csvRelative = batchCsv.inspectAdpcmBatchCsv(csvPath, []);
  assert.equal(csvRelative.rows[0].valid, false);
  assert.match(csvRelative.rows[0].errors.join(' '), /source が見つかりません/);

  const rooted = batchCsv.inspectAdpcmBatchCsv(csvPath, [], { sourceRoot: wavRoot });
  assert.equal(rooted.sourceRoot, path.resolve(wavRoot));
  assert.equal(rooted.sourceBaseDir, path.resolve(wavRoot));
  assert.equal(rooted.summary.validRows, 2);
  assert.equal(rooted.rows[0].resolvedSourcePath, path.join(wavRoot, 'アカリ', 'voice_0001.wav'));
  assert.equal(rooted.rows[1].resolvedSourcePath, path.resolve(absoluteWav));
  assert.throws(
    () => batchCsv.inspectAdpcmBatchCsv(csvPath, [], { sourceRoot: path.join(wavRoot, 'missing') }),
    /WAVルートフォルダーが見つかりません/,
  );

  const imported = await assetManager.importAdpcmBatch(projectDir, {
    csvPath,
    sourceRoot: wavRoot,
    batchId: 'source-root',
  });
  assert.equal(imported.summary.succeededRows, 2);
  assert.deepEqual(imported.results.map((row) => row.assetIds[0]), ['voice_0001', 'absolute_voice']);
});

test('ADPCM batch CSV reports strict row validation, duplicate output IDs, and protected asset collisions', () => {
  const dir = makeTempDir('pce-adpcm-csv-invalid-');
  writeFile(dir, 'voice.wav', makeWavBuffer());
  const csvPath = writeFile(dir, 'voices.csv', [
    'source,id,name,sampleRate,loop,splitPolicy',
    'voice.wav,bad id,,12000,maybe,unknown',
    'voice.wav,dup,,8000,false,auto',
    'voice.wav,dup,,8000,false,auto',
    'voice.wav,bg,,8000,false,auto',
  ].join('\n'));

  const inspected = batchCsv.inspectAdpcmBatchCsv(csvPath, [{ id: 'bg', type: 'image', data: {} }]);
  assert.equal(inspected.summary.validRows, 0);
  assert.match(inspected.rows[0].errors.join(' '), /id は英数字/);
  assert.match(inspected.rows[0].errors.join(' '), /sampleRate/);
  assert.match(inspected.rows[0].errors.join(' '), /loop/);
  assert.match(inspected.rows[0].errors.join(' '), /splitPolicy/);
  assert.match(inspected.rows[1].errors.join(' '), /重複/);
  assert.match(inspected.rows[2].errors.join(' '), /重複/);
  assert.match(inspected.rows[3].errors.join(' '), /非ADPCM/);

  const unknownHeader = writeFile(dir, 'unknown.csv', 'source,id,sample_rate\nvoice.wav,voice,8000\n');
  assert.throws(() => batchCsv.inspectAdpcmBatchCsv(unknownHeader, []), /sample_rate.*サポートされていません/);
  const missingHeader = writeFile(dir, 'missing.csv', 'source,name\nvoice.wav,voice\n');
  assert.throws(() => batchCsv.inspectAdpcmBatchCsv(missingHeader, []), /header "id" が必要/);
});

test('ADPCM batch CSV predicts auto parts, rejects oversize error policy, and detects part ID collisions', () => {
  const dir = makeTempDir('pce-adpcm-csv-split-');
  writeFile(dir, 'long.wav', makeWavBuffer(8000, 70000));
  writeFile(dir, 'short.wav', makeWavBuffer(8000, 16));
  const csvPath = writeFile(dir, 'split.csv', [
    'source,id,splitPolicy',
    'long.wav,long_auto,auto',
    'long.wav,long_error,error',
  ].join('\n'));
  const inspected = batchCsv.inspectAdpcmBatchCsv(csvPath, []);
  assert.equal(inspected.rows[0].valid, true);
  assert.equal(inspected.rows[0].estimatedPartCount, 2);
  assert.deepEqual(inspected.rows[0].outputIds, ['long_auto_part01', 'long_auto_part02']);
  assert.equal(inspected.rows[1].valid, false);
  assert.match(inspected.rows[1].errors.join(' '), /上限 32767 bytes/);

  const collisionPath = writeFile(dir, 'collision.csv', [
    'source,id,splitPolicy',
    'long.wav,long,auto',
    'short.wav,long_part01,auto',
  ].join('\n'));
  const collision = batchCsv.inspectAdpcmBatchCsv(collisionPath, []);
  assert.equal(collision.rows[0].valid, false);
  assert.equal(collision.rows[1].valid, false);
  assert.match(collision.rows[0].errors.join(' '), /long_part01.*衝突/);
  assert.match(collision.rows[1].errors.join(' '), /long_part01.*衝突/);
});

test('ADPCM batch CSV warns but permits projected counts above the VN 512-asset limit', () => {
  const dir = makeTempDir('pce-adpcm-csv-limit-');
  writeFile(dir, 'voice.wav', makeWavBuffer());
  const csvPath = writeFile(dir, 'limit.csv', 'source,id\nvoice.wav,new_voice\n');
  const existing = Array.from({ length: 512 }, (_unused, index) => ({ id: `voice_${index}`, type: 'adpcm' }));
  const inspected = batchCsv.inspectAdpcmBatchCsv(csvPath, existing);
  assert.equal(inspected.summary.validRows, 1);
  assert.equal(inspected.summary.projectedAdpcmCount, 513);
  assert.match(inspected.warnings.join(' '), /512件/);
});

test('ADPCM batch import keeps successes, preserves failed existing sources, overwrites ADPCM, and cleans old parts', async () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-adpcm-batch-project-');
  const sourcesDir = makeTempDir('pce-adpcm-batch-source-');
  const replacement = writeFile(sourcesDir, 'replacement.wav', makeWavBuffer(8000, 64));
  const invalid = writeFile(sourcesDir, 'invalid.wav', Buffer.from('not a wav'));
  const shortLong = writeFile(sourcesDir, 'long.wav', makeWavBuffer(8000, 40));
  const oldProtectedSource = writeFile(projectDir, 'assets/adpcm/protected.wav', makeWavBuffer(8000, 16));
  const oldProtectedBytes = fs.readFileSync(oldProtectedSource);
  writeFile(projectDir, 'assets/generated/long_part01/adpcm.bin', Buffer.alloc(10, 1));
  writeFile(projectDir, 'assets/generated/long_part01/preview.json', '{}');
  writeFile(projectDir, 'assets/generated/long_part02/adpcm.bin', Buffer.alloc(10, 2));
  writeFile(projectDir, 'assets/generated/long_part02/preview.json', '{}');
  writeFile(projectDir, 'assets/pce-assets.json', JSON.stringify({
    version: 2,
    assets: [
      { id: 'bg', type: 'image', source: '', options: {} },
      { id: 'voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', options: { sampleRate: 8000 }, data: {} },
      { id: 'protected', type: 'adpcm', source: 'assets/adpcm/protected.wav', options: { sampleRate: 8000 }, data: {} },
      { id: 'long_part01', type: 'adpcm', source: 'assets/adpcm/long.wav', options: { sampleRate: 8000 }, data: { generated: { outputFile: 'assets/generated/long_part01/adpcm.bin', previewFile: 'assets/generated/long_part01/preview.json' }, import: { groupId: 'long', partIndex: 1, partCount: 2 } } },
      { id: 'long_part02', type: 'adpcm', source: 'assets/adpcm/long.wav', options: { sampleRate: 8000 }, data: { generated: { outputFile: 'assets/generated/long_part02/adpcm.bin', previewFile: 'assets/generated/long_part02/preview.json' }, import: { groupId: 'long', partIndex: 2, partCount: 2 } } },
    ],
  }, null, 2));
  const csvPath = writeFile(sourcesDir, 'batch.csv', [
    'source,id,name,sampleRate,loop,splitPolicy',
    `${replacement},voice,voice/new,8000,true,auto`,
    `${invalid},protected,voice/protected,8000,false,auto`,
    `${shortLong},long,voice/long,8000,false,auto`,
  ].join('\n'));
  const progress = [];

  const result = await assetManager.importAdpcmBatch(projectDir, { csvPath, batchId: 'batch-test' }, {
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal(result.summary.succeededRows, 2);
  assert.equal(result.summary.failedRows, 1);
  assert.equal(result.summary.succeededAssetCount, 2);
  assert.equal(result.results.find((entry) => entry.id === 'protected').status, 'failed');
  assert.deepEqual(fs.readFileSync(oldProtectedSource), oldProtectedBytes);
  const doc = assetManager.readAssetDocument(projectDir);
  const voice = doc.assets.find((asset) => asset.id === 'voice');
  const long = doc.assets.find((asset) => asset.id === 'long');
  assert.equal(voice.name, 'voice/new');
  assert.equal(voice.options.loop, true);
  assert.equal(voice.data.import.batchFileName, 'batch.csv');
  assert.equal(voice.data.import.batchRow, 2);
  assert.ok(long);
  assert.equal(doc.assets.some((asset) => asset.id === 'long_part01' || asset.id === 'long_part02'), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets/generated/long_part01/adpcm.bin')), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets/generated/long_part02/adpcm.bin')), false);
  assert.equal(progress.some((entry) => entry.status === 'complete'), true);
});

test('ADPCM single import validates WAV before overwriting an existing project source', () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-adpcm-safe-single-');
  const sourcePath = writeFile(projectDir, 'assets/adpcm/voice.wav', makeWavBuffer(8000, 16));
  const before = fs.readFileSync(sourcePath);
  const invalid = writeFile(makeTempDir('pce-adpcm-safe-source-'), 'voice.wav', Buffer.from('invalid'));

  assert.throws(() => assetManager.importAudio(projectDir, {
    sourcePath: invalid,
    sourceFileName: 'voice.wav',
    kind: 'adpcm',
    id: 'voice',
    sampleRate: 8000,
  }), /WAV data is too small|RIFF\/WAVE/);
  assert.deepEqual(fs.readFileSync(sourcePath), before);
});

test('ADPCM batch import registers auto parts in CSV order and stops after the active row on cancel', async () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-adpcm-batch-cancel-project-');
  const sourceDir = makeTempDir('pce-adpcm-batch-cancel-source-');
  const first = writeFile(sourceDir, 'first.wav', makeWavBuffer(8000, 70000));
  const second = writeFile(sourceDir, 'second.wav', makeWavBuffer(8000, 16));
  const third = writeFile(sourceDir, 'third.wav', makeWavBuffer(8000, 16));
  writeFile(projectDir, 'assets/pce-assets.json', JSON.stringify({
    version: 2,
    assets: [{ id: 'bg', type: 'image', source: '', options: {} }],
  }));
  const csvPath = writeFile(sourceDir, 'cancel.csv', [
    'source,id',
    `${first},first`,
    `${second},second`,
    `${third},third`,
  ].join('\n'));

  const result = await assetManager.importAdpcmBatch(projectDir, { csvPath, batchId: 'cancel-after-first' }, {
    onProgress(entry) {
      if (entry.id === 'first' && entry.status === 'success') {
        assetManager.cancelAdpcmBatch(projectDir, { batchId: 'cancel-after-first' });
      }
    },
  });

  assert.equal(result.summary.succeededRows, 1);
  assert.equal(result.summary.canceledRows, 2);
  assert.equal(result.summary.succeededAssetCount, 2);
  assert.deepEqual(result.assets.map((asset) => asset.id), ['bg', 'first_part01', 'first_part02']);
  assert.deepEqual(result.results.map((entry) => entry.status), ['success', 'canceled', 'canceled']);
});

test('ADPCM batch conversion failure after inspection preserves project-local WAV and generated files', async () => {
  const assetManager = loadAssetManager();
  const projectDir = makeTempDir('pce-adpcm-batch-safe-project-');
  const sourceDir = makeTempDir('pce-adpcm-batch-safe-source-');
  const external = writeFile(sourceDir, 'voice.wav', makeWavBuffer(8000, 32));
  const projectSource = writeFile(projectDir, 'assets/adpcm/voice.wav', makeWavBuffer(8000, 16));
  const generated = writeFile(projectDir, 'assets/generated/voice/adpcm.bin', Buffer.from([1, 2, 3, 4]));
  const beforeSource = fs.readFileSync(projectSource);
  const beforeGenerated = fs.readFileSync(generated);
  writeFile(projectDir, 'assets/pce-assets.json', JSON.stringify({
    version: 2,
    assets: [{
      id: 'voice',
      type: 'adpcm',
      source: 'assets/adpcm/voice.wav',
      options: { sampleRate: 8000 },
      data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' }, import: { groupId: 'voice' } },
    }],
  }));
  const csvPath = writeFile(sourceDir, 'safe.csv', `source,id\n${external},voice\n`);
  let invalidated = false;

  const result = await assetManager.importAdpcmBatch(projectDir, { csvPath, batchId: 'safe-failure' }, {
    onProgress(entry) {
      if (!invalidated && entry.id === 'voice' && entry.status === 'processing') {
        invalidated = true;
        fs.writeFileSync(external, Buffer.from('invalid after inspection'));
      }
    },
  });

  assert.equal(result.summary.failedRows, 1);
  assert.deepEqual(fs.readFileSync(projectSource), beforeSource);
  assert.deepEqual(fs.readFileSync(generated), beforeGenerated);
});

test('CD VN dry build catalogs a batch-imported ADPCM referenced by message voice', async () => {
  const assetManager = loadAssetManager();
  const projectDir = path.join(makeTempDir('pce-adpcm-batch-vn-build-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), projectDir, { recursive: true });
  const sourceDir = makeTempDir('pce-adpcm-batch-vn-source-');
  writeFile(sourceDir, 'voice.wav', makeWavBuffer(8000, 8000));
  const csvPath = writeFile(sourceDir, 'voices.csv', [
    'source,id,name',
    'voice.wav,batch_voice,voice/smoke/batch_voice',
  ].join('\n'));
  const batch = await assetManager.importAdpcmBatch(projectDir, { csvPath, batchId: 'vn-build' });
  assert.equal(batch.summary.succeededRows, 1);

  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  sceneDoc.scenes[0].commands = [{
    type: 'message',
    speaker: 'Batch',
    text: 'BATCH VOICE',
    voiceAssetId: 'batch_voice',
    mouthSlot: 0,
    mouthAnimationId: '',
  }];
  sceneDoc.scenes[0].nextSceneId = '';
  sceneDoc.scenes = [sceneDoc.scenes[0]];
  fs.writeFileSync(scenePath, JSON.stringify(sceneDoc, null, 2), 'utf8');

  const buildSystem = loadBuildSystem();
  buildSystem.openProject(projectDir);
  const result = await buildSystem.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });
  const catalogPath = path.join(projectDir, 'assets', 'generated', 'meta', 'asset_meta.bin');
  assert.equal(result.success, true);
  assert.equal(path.extname(result.commandInfo.cuePath), '.cue');
  assert.equal(result.generated.visualNovel.messageCount, 1);
  assert.ok(result.commandInfo.mkcdArgs.some((entry) => /assets[\\/]generated[\\/]batch_voice[\\/]adpcm\.bin$/.test(entry)));
  assert.ok(result.commandInfo.mkcdArgs.some((entry) => /assets[\\/]generated[\\/]meta[\\/]asset_meta\.bin$/.test(entry)));
  assert.ok(fs.statSync(catalogPath).size > 0);
});

test('Irodori export to ADPCM CSV import and manifest assignment completes a CD VN dry build', async () => {
  const assetManager = loadAssetManager();
  const projectDir = path.join(makeTempDir('pce-irodori-workflow-project-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), projectDir, { recursive: true });
  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  sceneDoc.scenes[0].commands = [{
    type: 'message',
    speaker: 'Batch',
    text: 'IRODORI WORKFLOW',
    voiceAssetId: '',
    mouthSlot: 0,
    mouthAnimationId: '',
  }];
  sceneDoc.scenes[0].nextSceneId = '';
  sceneDoc.scenes = [sceneDoc.scenes[0]];

  const bundle = buildIrodoriBatchBundle({ doc: sceneDoc, assetIds: [] });
  const packageDir = makeTempDir('pce-irodori-workflow-package-');
  bundle.entries.forEach((entry) => writeFile(packageDir, entry.name, entry.data));
  writeFile(packageDir, 'output/Batch/voice_0001.wav', makeWavBuffer(8000, 8000));

  const batch = await assetManager.importAdpcmBatch(projectDir, {
    csvPath: path.join(packageDir, 'output', 'adpcm-import.csv'),
    batchId: 'irodori-workflow',
  });
  assert.equal(batch.summary.succeededRows, 1);
  const assets = assetManager.listAssets(projectDir).assets;
  const assignment = inspectIrodoriVoiceAssignments({
    manifestPath: path.join(packageDir, 'manifest.csv'),
    doc: sceneDoc,
    assets,
  });
  assert.deepEqual(assignment.assignments.map((entry) => entry.id), ['voice_0001']);
  assignment.assignments.forEach((entry) => {
    sceneDoc.scenes.find((scene) => scene.id === entry.sceneId).commands[entry.commandIndex - 1].voiceAssetId = entry.id;
  });
  fs.writeFileSync(scenePath, JSON.stringify(sceneDoc, null, 2), 'utf8');

  const buildSystem = loadBuildSystem();
  buildSystem.openProject(projectDir);
  const result = await buildSystem.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });
  assert.equal(result.success, true);
  assert.equal(result.generated.visualNovel.messageCount, 1);
  assert.ok(result.commandInfo.mkcdArgs.some((entry) => /assets[\\/]generated[\\/]voice_0001[\\/]adpcm\.bin$/.test(entry)));
  assert.ok(result.commandInfo.mkcdArgs.some((entry) => /assets[\\/]generated[\\/]meta[\\/]asset_meta\.bin$/.test(entry)));
});
