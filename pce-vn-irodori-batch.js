'use strict';

const VOICE_ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const DEFAULT_VOICE_ID_PREFIX = 'voice';
const VOICE_ID_PREFIX_RE = VOICE_ID_RE;
const MANIFEST_HEADER = [
  'id',
  'speaker_kind',
  'speaker',
  'scene_id',
  'scene_name',
  'command_index',
  'text',
  'source_voice_asset_id',
  'id_source',
  'batch_csv',
  'output_dir',
  'output_wav',
];
const ADPCM_IMPORT_HEADER = [
  'source',
  'id',
  'name',
  'sampleRate',
  'loop',
  'splitPolicy',
];

function normalizeBatchText(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
}

function normalizeVoiceIdPrefix(value = DEFAULT_VOICE_ID_PREFIX) {
  const prefix = String(value).trim();
  if (!VOICE_ID_PREFIX_RE.test(prefix)) {
    throw new Error(
      `音声IDプレフィクス "${prefix}" は [A-Za-z0-9_-]{1,48} に一致しません。`,
    );
  }
  return prefix;
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function encodeCsv(header, rows) {
  const lines = [
    header.map(csvEscape).join(','),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(',')),
  ];
  return Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf-8');
}

function isSkipped(command = {}) {
  return command.skip === true || command.skipped === true || command.debugSkip === true;
}

function truncateCodePoints(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join('');
}

function baseSpeakerFolder(value, fallback) {
  let segment = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[ .]+|[ .]+$/g, '')
    .replace(/_+/g, '_');
  segment = truncateCodePoints(segment, 48);
  segment = segment.replace(/[ .]+$/g, '');
  if (!segment || segment === '.' || segment === '..') segment = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)) {
    segment = `speaker_${segment}`;
  }
  return segment;
}

function uniqueSpeakerFolder(value, fallback, usedNames) {
  const base = baseSpeakerFolder(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.normalize('NFC').toLowerCase())) {
    const marker = `_${suffix}`;
    candidate = `${truncateCodePoints(base, Math.max(1, 48 - marker.length))}${marker}`;
    suffix += 1;
  }
  usedNames.add(candidate.normalize('NFC').toLowerCase());
  return candidate;
}

function commandLocation(message) {
  return `scene "${message.sceneId}" command #${message.commandIndex}`;
}

function collectMessages(doc = {}) {
  const messages = [];
  const scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
  scenes.forEach((scene, sceneIndex) => {
    const commands = Array.isArray(scene?.commands) ? scene.commands : [];
    commands.forEach((command, commandIndex) => {
      if (!command || command.type !== 'message' || isSkipped(command)) return;
      const text = normalizeBatchText(command.text);
      if (!text) return;
      const speaker = String(command.speaker || '').trim().normalize('NFC');
      const voiceAssetId = String(command.voiceAssetId || '').trim();
      messages.push({
        sceneIndex,
        sceneId: String(scene?.id || `scene_${sceneIndex + 1}`),
        sceneName: String(scene?.name || ''),
        commandIndex: commandIndex + 1,
        speaker,
        speakerKind: speaker ? 'character' : 'narration',
        text,
        voiceAssetId,
      });
    });
  });
  return messages;
}

function buildIrodoriBatchBundle({
  doc = {},
  assetIds = [],
  voiceIdPrefix = DEFAULT_VOICE_ID_PREFIX,
} = {}) {
  const normalizedVoiceIdPrefix = normalizeVoiceIdPrefix(voiceIdPrefix);
  const messages = collectMessages(doc);
  if (!messages.length) {
    throw new Error('音声バッチへ出力できる有効な Message がありません。');
  }

  const reservedIds = new Set(
    (Array.isArray(assetIds) ? assetIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  messages.forEach((message) => {
    if (!message.voiceAssetId) return;
    if (!VOICE_ID_RE.test(message.voiceAssetId)) {
      throw new Error(
        `音声ID "${message.voiceAssetId}" は [A-Za-z0-9_-]{1,48} に一致しません (${commandLocation(message)})。`,
      );
    }
    reservedIds.add(message.voiceAssetId);
  });

  const groups = [];
  const groupByKey = new Map();
  // Narration always owns /output/<prefix>/narrator, even when a character is literally named "narrator".
  const usedFolders = new Set(['narrator']);
  let characterNumber = 0;
  function groupFor(message) {
    const key = message.speakerKind === 'narration' ? '\u0000narration' : `character:${message.speaker}`;
    let group = groupByKey.get(key);
    if (group) return group;
    if (message.speakerKind === 'narration') {
      group = {
        key,
        speakerKind: 'narration',
        speaker: '',
        outputFolder: 'narrator',
        batchCsv: 'batches/narrator.csv',
        outputDir: `/output/${normalizedVoiceIdPrefix}/narrator`,
        jobs: [],
      };
    } else {
      characterNumber += 1;
      const fallback = `speaker_${String(characterNumber).padStart(3, '0')}`;
      const folder = uniqueSpeakerFolder(message.speaker, fallback, usedFolders);
      group = {
        key,
        speakerKind: 'character',
        speaker: message.speaker,
        outputFolder: folder,
        batchCsv: `batches/speaker_${String(characterNumber).padStart(3, '0')}.csv`,
        outputDir: `/output/${normalizedVoiceIdPrefix}/${folder}`,
        jobs: [],
      };
    }
    groups.push(group);
    groupByKey.set(key, group);
    return group;
  }

  let generatedNumber = 1;
  function nextGeneratedId() {
    while (true) {
      const id = `${normalizedVoiceIdPrefix}_${String(generatedNumber).padStart(4, '0')}`;
      generatedNumber += 1;
      if (!VOICE_ID_RE.test(id)) {
        throw new Error(
          `音声IDプレフィクス "${normalizedVoiceIdPrefix}" から生成したID "${id}" が48文字を超えます。`,
        );
      }
      if (reservedIds.has(id)) continue;
      reservedIds.add(id);
      return id;
    }
  }

  const jobById = new Map();
  const manifestRows = [];
  messages.forEach((message) => {
    const group = groupFor(message);
    const idSource = message.voiceAssetId ? 'existing' : 'generated';
    const id = message.voiceAssetId || nextGeneratedId();
    const existing = jobById.get(id);
    if (existing) {
      const sameSpeaker = existing.speakerKind === message.speakerKind && existing.speaker === message.speaker;
      if (!sameSpeaker || existing.text !== message.text) {
        throw new Error(
          `音声ID "${id}" が異なる話者または本文で重複しています: `
          + `${commandLocation(existing.message)} / ${commandLocation(message)}。`,
        );
      }
    } else {
      const job = {
        id,
        text: message.text,
        output_dir: group.outputDir,
      };
      group.jobs.push(job);
      jobById.set(id, {
        ...job,
        speakerKind: message.speakerKind,
        speaker: message.speaker,
        outputFolder: group.outputFolder,
        message,
      });
    }

    manifestRows.push({
      id,
      speaker_kind: message.speakerKind,
      speaker: message.speaker,
      scene_id: message.sceneId,
      scene_name: message.sceneName,
      command_index: message.commandIndex,
      text: message.text,
      source_voice_asset_id: message.voiceAssetId,
      id_source: idSource,
      batch_csv: group.batchCsv,
      output_dir: group.outputDir,
      output_wav: `${group.outputDir}/${id}.wav`,
    });
  });

  const entries = groups.map((group) => ({
    name: group.batchCsv,
    data: encodeCsv(['id', 'text', 'output_dir'], group.jobs),
  }));
  entries.push({ name: 'manifest.csv', data: encodeCsv(MANIFEST_HEADER, manifestRows) });
  const adpcmRows = Array.from(jobById.values()).map((job) => ({
    source: `${normalizedVoiceIdPrefix}/${job.outputFolder}/${job.id}.wav`,
    id: job.id,
    name: `${normalizedVoiceIdPrefix}/${job.outputFolder}/${job.id}`,
    sampleRate: 8000,
    loop: false,
    splitPolicy: 'auto',
  }));
  entries.push({
    name: 'output/adpcm-import.csv',
    data: encodeCsv(ADPCM_IMPORT_HEADER, adpcmRows),
  });

  return {
    entries,
    groups,
    manifestRows,
    adpcmRows,
    speakerCount: groups.length,
    messageCount: messages.length,
    jobCount: jobById.size,
  };
}

module.exports = {
  ADPCM_IMPORT_HEADER,
  MANIFEST_HEADER,
  DEFAULT_VOICE_ID_PREFIX,
  VOICE_ID_RE,
  baseSpeakerFolder,
  VOICE_ID_PREFIX_RE,
  buildIrodoriBatchBundle,
  collectMessages,
  csvEscape,
  encodeCsv,
  normalizeBatchText,
  uniqueSpeakerFolder,
  normalizeVoiceIdPrefix,
};
