'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ADPCM_BATCH_ID_PATTERN,
  decodeUtf8Csv,
  parseCsvRows,
} = require('./pce-adpcm-batch-csv');
const { normalizeBatchText } = require('./pce-vn-irodori-batch');

const IRODORI_ASSIGN_REQUIRED_HEADERS = Object.freeze([
  'id',
  'speaker_kind',
  'speaker',
  'scene_id',
  'command_index',
  'text',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeSpeaker(value) {
  return String(value == null ? '' : value).trim().normalize('NFC');
}

function isSkipped(command = {}) {
  return command.skip === true || command.skipped === true || command.debugSkip === true;
}

function indexManifestHeaders(values = []) {
  const indexes = new Map();
  values.forEach((value, index) => {
    const header = String(value || '').trim();
    if (!header) throw new Error('manifest.csv に空のheaderがあります');
    if (indexes.has(header)) throw new Error(`manifest.csv header "${header}" が重複しています`);
    indexes.set(header, index);
  });
  for (const required of IRODORI_ASSIGN_REQUIRED_HEADERS) {
    if (!indexes.has(required)) throw new Error(`manifest.csv header "${required}" が必要です`);
  }
  return indexes;
}

function addError(row, message) {
  const value = String(message || '').trim();
  if (value && !row.errors.includes(value)) row.errors.push(value);
  row.status = 'error';
  row.reason = row.errors.join(' / ');
}

function skipRow(row, reason) {
  row.status = 'skipped';
  row.reason = String(reason || '反映対象外です');
}

function inspectIrodoriVoiceAssignments({ manifestPath, doc = {}, assets = [] } = {}) {
  const absoluteManifestPath = path.resolve(String(manifestPath || ''));
  if (!manifestPath || !fs.existsSync(absoluteManifestPath) || !fs.statSync(absoluteManifestPath).isFile()) {
    throw new Error('Irodori-TTS manifest.csv が見つかりません');
  }
  if (path.extname(absoluteManifestPath).toLowerCase() !== '.csv') {
    throw new Error('音声バッチ反映には manifest.csv を指定してください');
  }

  const manifestBuffer = fs.readFileSync(absoluteManifestPath);
  const parsedRows = parseCsvRows(decodeUtf8Csv(manifestBuffer));
  if (!parsedRows.length) throw new Error('manifest.csv が空です');
  const headerIndexes = indexManifestHeaders(parsedRows[0].values);
  const headers = parsedRows[0].values.map((value) => String(value || '').trim());
  const field = (record, name) => String(record.values[headerIndexes.get(name)] ?? '').trim();
  const optionalField = (record, name) => (
    headerIndexes.has(name) ? String(record.values[headerIndexes.get(name)] ?? '').trim() : ''
  );

  const rows = parsedRows.slice(1).map((record) => {
    const commandIndexText = field(record, 'command_index');
    const row = {
      lineNumber: record.lineNumber,
      id: field(record, 'id'),
      speakerKind: field(record, 'speaker_kind').toLowerCase(),
      speaker: normalizeSpeaker(field(record, 'speaker')),
      sceneId: field(record, 'scene_id'),
      sceneName: optionalField(record, 'scene_name'),
      commandIndex: Number(commandIndexText),
      text: normalizeBatchText(field(record, 'text')),
      previousVoiceAssetId: '',
      status: '',
      reason: '',
      duplicateOfLine: 0,
      errors: [],
    };
    if (record.values.length > headers.length) addError(row, '列数がheaderより多くなっています');
    if (!ADPCM_BATCH_ID_PATTERN.test(row.id)) addError(row, 'id は英数字・_・-だけで1～48文字にしてください');
    if (!row.sceneId) addError(row, 'scene_id は必須です');
    if (!Number.isInteger(row.commandIndex) || row.commandIndex < 1) {
      addError(row, 'command_index は1以上の整数にしてください');
    }
    if (row.speakerKind !== 'character' && row.speakerKind !== 'narration') {
      addError(row, 'speaker_kind は character / narration のいずれかです');
    } else if (row.speakerKind === 'narration' && row.speaker) {
      addError(row, 'narration の speaker は空欄にしてください');
    } else if (row.speakerKind === 'character' && !row.speaker) {
      addError(row, 'character の speaker は必須です');
    }
    if (!row.text) addError(row, 'text は必須です');
    return row;
  });

  const rowsByTarget = new Map();
  for (const row of rows.filter((entry) => entry.sceneId && Number.isInteger(entry.commandIndex) && entry.commandIndex >= 1)) {
    const targetKey = `${row.sceneId}\u0000${row.commandIndex}`;
    if (!rowsByTarget.has(targetKey)) rowsByTarget.set(targetKey, []);
    rowsByTarget.get(targetKey).push(row);
  }
  for (const targetRows of rowsByTarget.values()) {
    if (targetRows.length < 2) continue;
    const contents = new Set(targetRows.map((row) => (
      JSON.stringify([row.id, row.speakerKind, row.speaker, row.text])
    )));
    if (contents.size > 1) {
      targetRows.forEach((row) => addError(row, '同じMessage位置に異なるmanifest内容が指定されています'));
      continue;
    }
    const primary = targetRows.find((row) => row.errors.length === 0) || targetRows[0];
    targetRows.filter((row) => row !== primary && row.errors.length === 0).forEach((row) => {
      row.duplicateOfLine = primary.lineNumber;
      skipRow(row, `${primary.lineNumber}行目と同一内容のため集約しました`);
    });
  }

  const sceneListsById = new Map();
  for (const scene of (Array.isArray(doc?.scenes) ? doc.scenes : [])) {
    const sceneId = String(scene?.id || '');
    if (!sceneListsById.has(sceneId)) sceneListsById.set(sceneId, []);
    sceneListsById.get(sceneId).push(scene);
  }
  const assetsById = new Map();
  const normalizedAssets = (Array.isArray(assets) ? assets : []).map((asset) => ({
    id: String(asset?.id || ''),
    type: String(asset?.type || ''),
  }));
  normalizedAssets.forEach((asset) => {
    if (!assetsById.has(asset.id)) assetsById.set(asset.id, []);
    assetsById.get(asset.id).push(asset);
  });

  for (const row of rows) {
    if (row.errors.length > 0 || row.duplicateOfLine) continue;
    const matchingScenes = sceneListsById.get(row.sceneId) || [];
    if (matchingScenes.length === 0) {
      skipRow(row, `scene_id "${row.sceneId}" が現在のシーンにありません`);
      continue;
    }
    if (matchingScenes.length > 1) {
      addError(row, `scene_id "${row.sceneId}" が現在のシーンで重複しています`);
      continue;
    }
    const scene = matchingScenes[0];
    const command = Array.isArray(scene?.commands) ? scene.commands[row.commandIndex - 1] : null;
    if (!command) {
      skipRow(row, `command #${row.commandIndex} が現在のシーンにありません`);
      continue;
    }
    if (command.type !== 'message') {
      skipRow(row, `command #${row.commandIndex} は現在Messageではありません`);
      continue;
    }
    if (isSkipped(command)) {
      skipRow(row, `command #${row.commandIndex} は現在skipされています`);
      continue;
    }
    const currentSpeaker = normalizeSpeaker(command.speaker);
    const currentSpeakerKind = currentSpeaker ? 'character' : 'narration';
    if (currentSpeakerKind !== row.speakerKind || currentSpeaker !== row.speaker) {
      skipRow(row, '話者が音声バッチ出力時から変更されています');
      continue;
    }
    if (normalizeBatchText(command.text) !== row.text) {
      skipRow(row, '本文が音声バッチ出力時から変更されています');
      continue;
    }

    const exactAssets = assetsById.get(row.id) || [];
    if (exactAssets.length > 1) {
      addError(row, `asset id "${row.id}" が重複しています`);
      continue;
    }
    if (exactAssets.length === 0) {
      const partPrefix = `${row.id}_part`;
      const hasSplitParts = normalizedAssets.some((asset) => (
        asset.type === 'adpcm'
        && asset.id.startsWith(partPrefix)
        && /^\d{2,}$/.test(asset.id.slice(partPrefix.length))
      ));
      skipRow(
        row,
        hasSplitParts
          ? `元ID "${row.id}" の単一ADPCMがなく、分割partはMessageへ自動連結できません`
          : `ADPCM asset "${row.id}" が登録されていません`,
      );
      continue;
    }
    if (exactAssets[0].type !== 'adpcm') {
      addError(row, `asset "${row.id}" はADPCMではありません`);
      continue;
    }

    row.previousVoiceAssetId = String(command.voiceAssetId || '');
    if (row.previousVoiceAssetId === row.id) {
      row.status = 'already_set';
      row.reason = '設定済み';
    } else if (row.previousVoiceAssetId) {
      row.status = 'replace';
      row.reason = `既存 ${row.previousVoiceAssetId} から置換`;
    } else {
      row.status = 'new';
      row.reason = '新規設定';
    }
  }

  const assignments = rows
    .filter((row) => row.status === 'new' || row.status === 'replace')
    .map((row) => ({
      lineNumber: row.lineNumber,
      sceneId: row.sceneId,
      commandIndex: row.commandIndex,
      id: row.id,
      previousVoiceAssetId: row.previousVoiceAssetId,
      action: row.status,
    }));
  const count = (status) => rows.filter((row) => row.status === status).length;
  const summary = {
    totalRows: rows.length,
    assignableRows: assignments.length,
    newRows: count('new'),
    replaceRows: count('replace'),
    alreadySetRows: count('already_set'),
    skippedRows: count('skipped'),
    errorRows: count('error'),
  };
  const manifestSignature = sha256(manifestBuffer);
  const docSignature = sha256(JSON.stringify(doc || {}));
  const assetSignature = sha256(JSON.stringify(normalizedAssets.sort((a, b) => (
    a.id.localeCompare(b.id) || a.type.localeCompare(b.type)
  ))));
  const inspectionSignature = sha256(JSON.stringify({
    manifestSignature,
    rows: rows.map((row) => [
      row.lineNumber,
      row.id,
      row.sceneId,
      row.commandIndex,
      row.status,
      row.reason,
      row.previousVoiceAssetId,
    ]),
    assignments,
  }));

  return {
    manifestPath: absoluteManifestPath,
    manifestFileName: path.basename(absoluteManifestPath),
    headers,
    rows,
    assignments,
    summary,
    manifestSignature,
    docSignature,
    assetSignature,
    inspectionSignature,
  };
}

module.exports = {
  IRODORI_ASSIGN_REQUIRED_HEADERS,
  indexManifestHeaders,
  inspectIrodoriVoiceAssignments,
  normalizeSpeaker,
};
