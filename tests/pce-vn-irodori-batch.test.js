'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildIrodoriBatchBundle,
} = require('../pce-vn-irodori-batch');
const { exportIrodoriBatchZip } = require('../pce-vn-irodori-export');

function entryText(bundle, name) {
  const entry = bundle.entries.find((item) => item.name === name);
  assert.ok(entry, `missing ZIP entry: ${name}`);
  return entry.data.toString('utf-8');
}

function minimalDoc(command = { type: 'message', speaker: 'アカリ', text: 'こんにちは' }) {
  return {
    scenes: [{ id: 'opening', name: 'Chapter 1/Opening', commands: [command] }],
  };
}

test('Irodori batch groups all active messages by speaker and keeps narration', () => {
  const bundle = buildIrodoriBatchBundle({
    doc: {
      scenes: [
        {
          id: 'opening',
          name: 'Chapter 1/Opening',
          commands: [
            { type: 'message', speaker: 'アカリ', text: '  hello,\r\n"world"  ', voiceAssetId: 'akari_voice_001' },
            { type: 'message', speaker: 'ミカ', text: 'skip me', skip: true },
            { type: 'message', speaker: 'ミカ', text: '   ' },
            { type: 'message', speaker: '', text: 'ナレーションです。' },
          ],
        },
        {
          id: 'next',
          name: 'Chapter 1/Next',
          commands: [
            { type: 'message', speaker: 'ミカ', text: 'やあ。' },
            { type: 'message', speaker: 'アカリ', text: 'hello,\n"world"', voiceAssetId: 'akari_voice_001' },
            { type: 'comment', text: 'not a message' },
          ],
        },
      ],
    },
    assetIds: ['akari_voice_001'],
  });

  assert.equal(bundle.speakerCount, 3);
  assert.equal(bundle.messageCount, 4);
  assert.equal(bundle.jobCount, 3);
  assert.deepEqual(bundle.entries.map((entry) => entry.name), [
    'batches/speaker_001.csv',
    'batches/narrator.csv',
    'batches/speaker_002.csv',
    'manifest.csv',
  ]);
  assert.equal(
    entryText(bundle, 'batches/speaker_001.csv'),
    '\ufeffid,text,output_dir\r\nakari_voice_001,"hello,\n""world""",/output/アカリ\r\n',
  );
  assert.equal(
    entryText(bundle, 'batches/narrator.csv'),
    '\ufeffid,text,output_dir\r\nvoice_0001,ナレーションです。,/output/narrator\r\n',
  );
  assert.equal(
    entryText(bundle, 'batches/speaker_002.csv'),
    '\ufeffid,text,output_dir\r\nvoice_0002,やあ。,/output/ミカ\r\n',
  );
  assert.equal(bundle.manifestRows.length, 4);
  assert.deepEqual(bundle.manifestRows[0], {
    id: 'akari_voice_001',
    speaker_kind: 'character',
    speaker: 'アカリ',
    scene_id: 'opening',
    scene_name: 'Chapter 1/Opening',
    command_index: 1,
    text: 'hello,\n"world"',
    source_voice_asset_id: 'akari_voice_001',
    id_source: 'existing',
    batch_csv: 'batches/speaker_001.csv',
    output_dir: '/output/アカリ',
    output_wav: '/output/アカリ/akari_voice_001.wav',
  });
  assert.equal(bundle.manifestRows[3].id, 'akari_voice_001');
  assert.match(entryText(bundle, 'manifest.csv'), /^\ufeffid,speaker_kind,speaker,scene_id,/);
});

test('Irodori batch allocates collision-free generated IDs and safe unique speaker folders', () => {
  const bundle = buildIrodoriBatchBundle({
    doc: {
      scenes: [{
        id: 's',
        commands: [
          { type: 'message', speaker: 'A/B', text: 'one' },
          { type: 'message', speaker: 'A:B', text: 'two' },
          { type: 'message', speaker: 'CON', text: 'three' },
          { type: 'message', speaker: '..', text: 'four' },
          { type: 'message', speaker: 'narrator', text: 'character' },
          { type: 'message', speaker: '', text: 'narration' },
        ],
      }],
    },
    assetIds: ['voice_0001', 'voice_0002'],
  });

  assert.deepEqual(bundle.manifestRows.map((row) => row.id), [
    'voice_0003', 'voice_0004', 'voice_0005', 'voice_0006', 'voice_0007', 'voice_0008',
  ]);
  assert.deepEqual(bundle.manifestRows.map((row) => row.output_dir), [
    '/output/A_B',
    '/output/A_B_2',
    '/output/speaker_CON',
    '/output/speaker_004',
    '/output/narrator_2',
    '/output/narrator',
  ]);
});

test('Irodori batch rejects invalid and conflicting existing voice IDs with locations', () => {
  assert.throws(
    () => buildIrodoriBatchBundle({
      doc: minimalDoc({ type: 'message', speaker: 'アカリ', text: 'hello', voiceAssetId: 'bad/id' }),
    }),
    /bad\/id.*scene "opening" command #1/,
  );

  assert.throws(
    () => buildIrodoriBatchBundle({
      doc: {
        scenes: [
          { id: 'a', commands: [{ type: 'message', speaker: 'アカリ', text: 'hello', voiceAssetId: 'shared_voice' }] },
          { id: 'b', commands: [{ type: 'message', speaker: 'アカリ', text: 'different', voiceAssetId: 'shared_voice' }] },
        ],
      },
    }),
    /shared_voice.*scene "a" command #1.*scene "b" command #1/,
  );

  assert.throws(
    () => buildIrodoriBatchBundle({
      doc: {
        scenes: [{
          id: 'a',
          commands: [
            { type: 'message', speaker: 'アカリ', text: 'hello', voiceAssetId: 'shared_voice' },
            { type: 'message', speaker: 'ミカ', text: 'hello', voiceAssetId: 'shared_voice' },
          ],
        }],
      },
    }),
    /shared_voice.*異なる話者または本文/,
  );
  assert.throws(() => buildIrodoriBatchBundle({ doc: { scenes: [] } }), /有効な Message がありません/);
});

test('Irodori generated IDs expand beyond four digits', () => {
  const commands = Array.from({ length: 10000 }, (_, index) => ({
    type: 'message',
    speaker: 'アカリ',
    text: `line ${index + 1}`,
  }));
  const bundle = buildIrodoriBatchBundle({
    doc: { scenes: [{ id: 'long', commands }] },
  });
  assert.equal(bundle.jobCount, 10000);
  assert.equal(bundle.manifestRows.at(-1).id, 'voice_10000');
});

test('Irodori ZIP exporter handles success, cancel, validation, and write failure', async () => {
  const writes = [];
  let dialogOptions = null;
  let zippedEntries = null;
  const success = await exportIrodoriBatchZip({
    doc: minimalDoc(),
    defaultPath: 'game_irodori_voice_batches.zip',
    owner: { id: 'window' },
    showSaveDialog: async (_owner, options) => {
      dialogOptions = options;
      return { canceled: false, filePath: 'C:/out/game.zip' };
    },
    createStoredZipBuffer: (entries) => {
      zippedEntries = entries;
      return Buffer.from('zip');
    },
    writeFileSync: (filePath, data) => writes.push({ filePath, data: data.toString() }),
  });
  assert.deepEqual(success, {
    ok: true,
    canceled: false,
    path: 'C:/out/game.zip',
    speakerCount: 1,
    messageCount: 1,
    jobCount: 1,
    error: '',
  });
  assert.equal(dialogOptions.defaultPath, 'game_irodori_voice_batches.zip');
  assert.deepEqual(zippedEntries.map((entry) => entry.name), ['batches/speaker_001.csv', 'manifest.csv']);
  assert.deepEqual(writes, [{ filePath: 'C:/out/game.zip', data: 'zip' }]);

  let canceledWrite = false;
  const canceled = await exportIrodoriBatchZip({
    doc: minimalDoc(),
    showSaveDialog: async () => ({ canceled: true }),
    createStoredZipBuffer: () => Buffer.from('zip'),
    writeFileSync: () => { canceledWrite = true; },
  });
  assert.equal(canceled.canceled, true);
  assert.equal(canceledWrite, false);

  let validationDialog = false;
  const validation = await exportIrodoriBatchZip({
    doc: { scenes: [] },
    showSaveDialog: async () => { validationDialog = true; },
  });
  assert.equal(validation.ok, false);
  assert.match(validation.error, /有効な Message/);
  assert.equal(validationDialog, false);

  const failed = await exportIrodoriBatchZip({
    doc: minimalDoc(),
    showSaveDialog: async () => ({ canceled: false, filePath: 'C:/out/game.zip' }),
    createStoredZipBuffer: () => Buffer.from('zip'),
    writeFileSync: () => { throw new Error('disk full'); },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.canceled, false);
  assert.match(failed.error, /disk full/);
});
