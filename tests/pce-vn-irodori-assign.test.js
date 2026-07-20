'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { encodeCsv } = require('../pce-vn-irodori-batch');
const { inspectIrodoriVoiceAssignments } = require('../pce-vn-irodori-assign');

const HEADER = ['id', 'speaker_kind', 'speaker', 'scene_id', 'scene_name', 'command_index', 'text', 'extra'];

function makeManifest(rows, header = HEADER) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-irodori-assign-'));
  const manifestPath = path.join(dir, 'manifest.csv');
  fs.writeFileSync(manifestPath, encodeCsv(header, rows));
  return manifestPath;
}

function message(speaker, text, voiceAssetId = '') {
  return { type: 'message', speaker, text, voiceAssetId };
}

test('Irodori voice assignment inspects new, replacement, existing, missing, split, and protected rows', () => {
  const doc = {
    scenes: [{
      id: 'opening',
      name: 'Opening',
      commands: [
        message('アカリ', 'こんにちは'),
        message('', 'ナレーション', 'old_voice'),
        message('アカリ', 'こんにちは', 'voice_akari'),
        { type: 'comment', text: 'not message' },
        message('ミカ', '変更後'),
        message('ミカ', 'split voice'),
        message('ミカ', 'protected'),
        message('ミカ', 'missing'),
      ],
    }],
  };
  const manifestPath = makeManifest([
    { id: 'voice_akari', speaker_kind: 'character', speaker: 'アカリ', scene_id: 'opening', scene_name: 'Opening', command_index: 1, text: 'こんにちは', extra: 'allowed' },
    { id: 'voice_narrator', speaker_kind: 'narration', speaker: '', scene_id: 'opening', scene_name: 'Opening', command_index: 2, text: 'ナレーション' },
    { id: 'voice_akari', speaker_kind: 'character', speaker: 'アカリ', scene_id: 'opening', scene_name: 'Opening', command_index: 3, text: 'こんにちは' },
    { id: 'voice_comment', speaker_kind: 'narration', speaker: '', scene_id: 'opening', scene_name: 'Opening', command_index: 4, text: 'not message' },
    { id: 'voice_changed', speaker_kind: 'character', speaker: 'ミカ', scene_id: 'opening', scene_name: 'Opening', command_index: 5, text: '変更前' },
    { id: 'voice_split', speaker_kind: 'character', speaker: 'ミカ', scene_id: 'opening', scene_name: 'Opening', command_index: 6, text: 'split voice' },
    { id: 'voice_protected', speaker_kind: 'character', speaker: 'ミカ', scene_id: 'opening', scene_name: 'Opening', command_index: 7, text: 'protected' },
    { id: 'voice_missing', speaker_kind: 'character', speaker: 'ミカ', scene_id: 'opening', scene_name: 'Opening', command_index: 8, text: 'missing' },
  ]);
  const assets = [
    { id: 'voice_akari', type: 'adpcm' },
    { id: 'voice_narrator', type: 'adpcm' },
    { id: 'voice_comment', type: 'adpcm' },
    { id: 'voice_changed', type: 'adpcm' },
    { id: 'voice_split_part01', type: 'adpcm' },
    { id: 'voice_split_part02', type: 'adpcm' },
    { id: 'voice_protected', type: 'image' },
  ];

  const inspected = inspectIrodoriVoiceAssignments({ manifestPath, doc, assets });
  assert.deepEqual(inspected.rows.map((row) => row.status), [
    'new', 'replace', 'already_set', 'skipped', 'skipped', 'skipped', 'error', 'skipped',
  ]);
  assert.match(inspected.rows[3].reason, /Messageではありません/);
  assert.match(inspected.rows[4].reason, /本文.*変更/);
  assert.match(inspected.rows[5].reason, /分割part.*自動連結/);
  assert.match(inspected.rows[6].reason, /ADPCMではありません/);
  assert.match(inspected.rows[7].reason, /登録されていません/);
  assert.deepEqual(inspected.summary, {
    totalRows: 8,
    assignableRows: 2,
    newRows: 1,
    replaceRows: 1,
    alreadySetRows: 1,
    skippedRows: 4,
    errorRows: 1,
  });
  assert.deepEqual(inspected.assignments.map((assignment) => ({
    sceneId: assignment.sceneId,
    commandIndex: assignment.commandIndex,
    id: assignment.id,
    previousVoiceAssetId: assignment.previousVoiceAssetId,
  })), [
    { sceneId: 'opening', commandIndex: 1, id: 'voice_akari', previousVoiceAssetId: '' },
    { sceneId: 'opening', commandIndex: 2, id: 'voice_narrator', previousVoiceAssetId: 'old_voice' },
  ]);
  assert.match(inspected.inspectionSignature, /^[a-f0-9]{64}$/);
});

test('Irodori voice assignment deduplicates exact targets and rejects order-independent conflicts', () => {
  const doc = { scenes: [{ id: 's', commands: [message('A', 'line'), message('B', 'line 2')] }] };
  const manifestPath = makeManifest([
    { id: 'voice_a', speaker_kind: 'character', speaker: 'A', scene_id: 's', command_index: 1, text: 'line' },
    { id: 'voice_a', speaker_kind: 'character', speaker: 'A', scene_id: 's', command_index: 1, text: 'line' },
    { id: 'voice_b', speaker_kind: 'character', speaker: 'B', scene_id: 's', command_index: 2, text: 'line 2' },
    { id: 'voice_c', speaker_kind: 'character', speaker: 'B', scene_id: 's', command_index: 2, text: 'line 2' },
  ]);
  const assets = ['voice_a', 'voice_b', 'voice_c'].map((id) => ({ id, type: 'adpcm' }));

  const inspected = inspectIrodoriVoiceAssignments({ manifestPath, doc, assets });
  assert.equal(inspected.rows[0].status, 'new');
  assert.equal(inspected.rows[1].status, 'skipped');
  assert.match(inspected.rows[1].reason, /同一内容/);
  assert.equal(inspected.rows[2].status, 'error');
  assert.equal(inspected.rows[3].status, 'error');
  assert.match(inspected.rows[2].reason, /同じMessage位置に異なるmanifest内容/);
  assert.deepEqual(inspected.assignments.map((assignment) => assignment.id), ['voice_a']);
});

test('Irodori voice assignment validates required columns and changes its signature after relevant edits', () => {
  const invalidPath = makeManifest([{ id: 'voice' }], ['id']);
  assert.throws(
    () => inspectIrodoriVoiceAssignments({ manifestPath: invalidPath, doc: {}, assets: [] }),
    /speaker_kind.*必要/,
  );

  const manifestPath = makeManifest([
    { id: 'voice', speaker_kind: 'character', speaker: 'A', scene_id: 's', command_index: 1, text: 'line' },
  ]);
  const doc = { scenes: [{ id: 's', commands: [message('A', 'line')] }] };
  const first = inspectIrodoriVoiceAssignments({ manifestPath, doc, assets: [{ id: 'voice', type: 'adpcm' }] });
  const changedText = inspectIrodoriVoiceAssignments({
    manifestPath,
    doc: { scenes: [{ id: 's', commands: [message('A', 'changed')] }] },
    assets: [{ id: 'voice', type: 'adpcm' }],
  });
  const changedAsset = inspectIrodoriVoiceAssignments({ manifestPath, doc, assets: [{ id: 'voice', type: 'image' }] });
  assert.notEqual(changedText.inspectionSignature, first.inspectionSignature);
  assert.notEqual(changedAsset.inspectionSignature, first.inspectionSignature);
  assert.equal(changedText.rows[0].status, 'skipped');
  assert.equal(changedAsset.rows[0].status, 'error');
});
