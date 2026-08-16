#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const DEFAULT_SERIES_CONTEXT = path.resolve(SCRIPT_DIR, '..', 'references', 'series-context.md');
const DEFAULT_EPISODE_CONTEXTS = path.resolve(SCRIPT_DIR, '..', 'references', 'episode-contexts.json');
const OPERATIONS = new Set([
  'replace', 'insert-before', 'insert-after', 'delete', 'replace-choice-label',
]);
const DECISIONS = new Set(['proposed', 'approved', 'rejected', 'needs-discussion']);
const SEVERITIES = new Set(['high', 'medium', 'low']);
const CATEGORIES = new Set([
  'unnatural-japanese', 'abrupt-context', 'continuity', 'character-voice',
  'abstract', 'redundancy', 'factual-risk', 'speaker-metadata',
  'pce-layout', 'structure',
]);
const MOUTH = new Map([['部長', 0], ['チカ', 1], ['レン', 2]]);

function parseCli(argv) {
  const command = argv[0] || '';
  const options = {};
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error('Unexpected argument: ' + token);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key] || options[key] === true) throw new Error('Missing --' + key);
  return String(options[key]);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function codePoints(value) {
  return Array.from(String(value ?? '')).length;
}

function locationId(episodeId, sceneId, index) {
  return episodeId.toUpperCase() + '::' + sceneId + '::C' + String(index + 1).padStart(3, '0');
}

function parseLocationId(value) {
  const match = /^EP(\d{2})::([^:]+)::C(\d+)$/.exec(String(value || ''));
  return match ? {
    episodeId: 'ep' + match[1],
    sceneId: match[2],
    commandIndex: Number(match[3]) - 1,
  } : null;
}

function snapshotMessage(command) {
  return {
    speaker: typeof command.speaker === 'string' ? command.speaker : '',
    text: typeof command.text === 'string' ? command.text : '',
    mouthSlot: command.mouthSlot === undefined ? null : command.mouthSlot,
  };
}

function snapshotChoice(option) {
  return { label: typeof option?.label === 'string' ? option.label : '' };
}

function sameSnapshot(a, b) {
  return Boolean(a && b) && a.speaker === b.speaker
    && a.text === b.text && a.mouthSlot === b.mouthSlot;
}

function sameChoiceSnapshot(a, b) {
  return Boolean(a && b) && a.label === b.label;
}

function deriveEpisodeId(doc) {
  const found = new Set();
  for (const scene of Array.isArray(doc.scenes) ? doc.scenes : []) {
    const match = /^(ep\d{2})_/.exec(String(scene.id || ''));
    if (match) found.add(match[1]);
  }
  if (found.size !== 1) {
    throw new Error('Expected one episode prefix; found ' + Array.from(found).join(', '));
  }
  return Array.from(found)[0];
}

async function loadProject(input) {
  const projectDir = path.resolve(input);
  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const assetPath = path.join(projectDir, 'assets', 'pce-assets.json');
  const sceneBytes = await fs.readFile(scenePath);
  const doc = JSON.parse(sceneBytes.toString('utf8'));
  let assetDoc = { assets: [] };
  try {
    assetDoc = JSON.parse(await fs.readFile(assetPath, 'utf8'));
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  return {
    projectDir,
    projectName: path.basename(projectDir),
    scenePath,
    sceneBytes,
    sourceHash: hash(sceneBytes),
    doc,
    assetDoc,
    episodeId: deriveEpisodeId(doc),
  };
}

function episodeScenes(project) {
  return project.doc.scenes.filter((scene) =>
    String(scene.id || '').startsWith(project.episodeId + '_'));
}

function checkMessage(message, label, errors, warnings, options = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    errors.push(label + ': message must be an object');
    return;
  }
  if (typeof message.speaker !== 'string') errors.push(label + ': speaker must be a string');
  if (typeof message.text !== 'string') {
    errors.push(label + ': text must be a string');
    return;
  }
  const lines = message.text.split('\n');
  const maxLines = message.speaker ? 3 : 4;
  if (lines.length > maxLines) errors.push(label + ': too many lines (' + lines.length + ')');
  lines.forEach((line, i) => {
    if (codePoints(line) > 17) {
      errors.push(label + ': line ' + (i + 1) + ' is ' + codePoints(line) + ' characters');
    }
  });
  if (codePoints(message.text) > 96) errors.push(label + ': text exceeds 96 characters');
  if (/[。、]/u.test(message.text)) warnings.push(label + ': contains Japanese comma or period');
  if (message.speaker) {
    if (!MOUTH.has(message.speaker)) warnings.push(label + ': unknown speaker ' + message.speaker);
    else if (!options.skipMouth && message.mouthSlot !== MOUTH.get(message.speaker)) {
      errors.push(label + ': ' + message.speaker + ' requires mouthSlot '
        + MOUTH.get(message.speaker) + ', found ' + String(message.mouthSlot));
    }
  } else if (!options.skipMouth && message.mouthSlot !== null) {
    errors.push(label + ': narration requires mouthSlot null');
  }
}

function auditDocument(project) {
  const findings = [];
  for (const scene of episodeScenes(project)) {
    (scene.commands || []).forEach((command, index) => {
      if (command.type !== 'message') return;
      const id = locationId(project.episodeId, scene.id, index);
      const errors = [];
      const warnings = [];
      checkMessage(snapshotMessage(command), id, errors, warnings);
      errors.forEach((message) => findings.push({ level: 'error', locationId: id, message }));
      warnings.forEach((message) => findings.push({ level: 'warning', locationId: id, message }));
    });
  }
  return findings;
}

function assetsList(assetDoc) {
  if (Array.isArray(assetDoc)) return assetDoc;
  return Array.isArray(assetDoc && assetDoc.assets) ? assetDoc.assets : [];
}

function buildEpisodeModel(project, episodeContext = null) {
  const scenes = episodeScenes(project);
  const speakers = new Map();
  const transitions = [];
  const choices = [];
  const usage = new Map();
  const voices = new Set();
  let messages = 0;

  function useAsset(id, sceneId, kind) {
    if (!id) return;
    if (!usage.has(id)) usage.set(id, { id, count: 0, scenes: new Set(), kinds: new Set() });
    const item = usage.get(id);
    item.count += 1;
    item.scenes.add(sceneId);
    item.kinds.add(kind);
  }

  for (const scene of scenes) {
    (scene.commands || []).forEach((command, index) => {
      if (command.type === 'message') {
        messages += 1;
        const speaker = command.speaker || 'ナレーション';
        speakers.set(speaker, (speakers.get(speaker) || 0) + 1);
        if (command.voiceAssetId) voices.add(command.voiceAssetId);
      }
      if (command.assetId) useAsset(command.assetId, scene.id, command.type);
      if (command.type === 'jump' && command.sceneId) {
        transitions.push({ from: scene.id, to: command.sceneId, via: 'jump' });
      }
      if (command.type === 'choice') {
        const item = {
          locationId: locationId(project.episodeId, scene.id, index),
          sceneId: scene.id,
          choices: [],
        };
        for (const option of Array.isArray(command.choices) ? command.choices : []) {
          item.choices.push({
            label: option.label || '',
            targetSceneId: option.targetSceneId || '',
          });
          if (option.targetSceneId) {
            transitions.push({
              from: scene.id,
              to: option.targetSceneId,
              via: 'choice: ' + (option.label || ''),
            });
          }
        }
        choices.push(item);
      }
    });
    if (scene.nextSceneId) {
      transitions.push({ from: scene.id, to: scene.nextSceneId, via: 'nextSceneId' });
    }
  }

  const incoming = new Map();
  for (const edge of transitions) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge);
  }
  const catalog = new Map(assetsList(project.assetDoc).map((asset) => [asset.id, asset]));
  const usedAssets = Array.from(usage.values()).map((item) => {
    const asset = catalog.get(item.id) || {};
    return {
      id: item.id,
      type: asset.type || 'unregistered',
      name: asset.name || '',
      count: item.count,
      scenes: Array.from(item.scenes),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return {
    episodeId: project.episodeId,
    projectName: project.projectName,
    sourceHash: project.sourceHash,
    sourceSceneFile: 'assets/pce-vn-scenes.json',
    version: project.doc.version,
    startScene: project.doc.startScene,
    allSceneCount: project.doc.scenes.length,
    scenes,
    sceneCount: scenes.length,
    messageCount: messages,
    choiceCount: choices.length,
    choices,
    incoming,
    speakerCounts: Object.fromEntries(speakers),
    usedAssets,
    voiceCount: voices.size,
    findings: auditDocument(project),
    episodeContext,
  };
}

function md(value) {
  return String(value ?? '').replaceAll('&', '&amp;')
    .replaceAll('|', '&#124;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function arraySection(lines, title, values) {
  lines.push('### ' + title, '');
  if (!Array.isArray(values) || values.length === 0) lines.push('- なし／未登録');
  else values.forEach((value) => lines.push('- ' + value));
  lines.push('');
}


function renderEpisodeContext(lines, context) {
  lines.push('## 話数固有コンセプト', '');
  if (!context) {
    lines.push('補足コンテキストは未登録です。scene一覧と全文台本から要約し、事実と推測を分けてください。', '');
    return;
  }
  lines.push('- 仮題／題材: ' + (context.title || '未設定'));
  lines.push('- 中心トピック: ' + (context.topic || '未設定'));
  lines.push('- コンセプト: ' + (context.concept || '未設定'));
  lines.push('- 風刺する行動: ' + (context.satireTarget || '未設定'), '');
  arraySection(lines, 'この話の前提となる連続性', context.continuityBefore);
  arraySection(lines, '確認済み事実', context.confirmedFacts);
  arraySection(lines, '断定禁止・要確認', context.unknowns);
  arraySection(lines, '話末に残る連続性', context.continuityAfter);
}

function formatCommand(model, scene, command, index) {
  const id = locationId(model.episodeId, scene.id, index);
  if (command.type === 'message') {
    const quote = String(command.text || '').split('\n')
      .map((line) => '> ' + line).join('\n>\n');
    return [
      '#### ' + id + ' — MESSAGE ' + (command.speaker || 'ナレーション'),
      '',
      quote || '> （空）',
      '',
      '- mouthSlot: ' + String(command.mouthSlot === undefined ? null : command.mouthSlot)
        + ' / voiceAssetId: ' + (command.voiceAssetId || 'なし'),
      '',
    ];
  }
  if (command.type === 'choice') {
    const result = ['- [' + id + '] CHOICE ' + (command.variableName || '')];
    for (const option of Array.isArray(command.choices) ? command.choices : []) {
      result.push('  - 「' + (option.label || '') + '」 -> ' + (option.targetSceneId || '未指定'));
    }
    return result;
  }
  if (command.type === 'background') {
    return ['- [' + id + '] BACKGROUND ' + (command.assetId || '')
      + ' @(' + String(command.x ?? '') + ',' + String(command.y ?? '') + ')'];
  }
  if (command.type === 'sprite') {
    return ['- [' + id + '] SPRITE slot ' + String(command.slot) + ' '
      + (command.visible === false ? 'hide ' : 'show ') + (command.assetId || '')];
  }
  if (command.type === 'spritemove') {
    return ['- [' + id + '] SPRITEMOVE slot ' + String(command.slot) + ' -> ('
      + String(command.x ?? '') + ',' + String(command.y ?? '') + ')'];
  }
  if (command.type === 'audio') {
    return ['- [' + id + '] AUDIO ' + (command.kind || '') + ' '
      + (command.action || '') + ' ' + (command.assetId || command.target || '')];
  }
  if (command.type === 'jump') return ['- [' + id + '] JUMP -> ' + (command.sceneId || '')];
  if (command.type === 'effect') return ['- [' + id + '] EFFECT ' + (command.effect || '')];
  if (command.type === 'wait') return ['- [' + id + '] WAIT ' + String(command.frames ?? '') + ' frames'];
  return ['- [' + id + '] ' + String(command.type || 'unknown').toUpperCase()];
}

function renderReviewPack(model, seriesContext) {
  const label = '第' + model.episodeId.slice(2) + '話';
  const lines = [
    '# 「いしのうらにいる！？」' + label + ' 外部レビュー用パック',
    '',
    '## レビュー対象',
    '',
    '- project: ' + model.projectName,
    '- sceneFile: ' + model.sourceSceneFile,
    '- sourceSha256: ' + model.sourceHash,
    '- document version: ' + model.version,
    '- startScene: ' + model.startScene,
    '- 対象scene: ' + model.sceneCount + ' / 文書全体 ' + model.allSceneCount,
    '- message: ' + model.messageCount,
    '- choice: ' + model.choiceCount,
    '- 参照voice ID: ' + model.voiceCount,
    '',
    'このパックは正本を変更しない読み取り専用スナップショットです。修正は変更票へproposedとして記入し、承認前に正本へ適用しないでください。',
    '',
    '## シリーズ設定・コンセプト',
    '',
    seriesContext.trim(),
    '',
  ];
  renderEpisodeContext(lines, model.episodeContext);

  lines.push('## 構成サマリー', '', '### 話者別message数', '');
  lines.push('| 話者 | 件数 |', '| --- | ---: |');
  Object.entries(model.speakerCounts).forEach(([speaker, count]) =>
    lines.push('| ' + md(speaker) + ' | ' + count + ' |'));
  lines.push('', '### scene一覧', '');
  lines.push('| scene | name | message | inbound |', '| --- | --- | ---: | --- |');
  for (const scene of model.scenes) {
    const count = (scene.commands || []).filter((c) => c.type === 'message').length;
    const inbound = (model.incoming.get(scene.id) || [])
      .map((edge) => edge.from + ' (' + edge.via + ')').join('<br>');
    lines.push('| ' + md(scene.id) + ' | ' + md(scene.name || '') + ' | '
      + count + ' | ' + md(inbound || '文書外／直前なし') + ' |');
  }

  lines.push('', '### choiceと分岐', '');
  if (model.choices.length === 0) lines.push('- choiceなし');
  for (const choice of model.choices) {
    lines.push('- ' + choice.locationId + ' (' + choice.sceneId + ')');
    choice.choices.forEach((option) =>
      lines.push('  - 「' + option.label + '」 -> ' + option.targetSceneId));
  }

  lines.push('', '### 使用asset（台詞voiceを除く）', '');
  lines.push('| ID | type | name | uses | scenes |', '| --- | --- | --- | ---: | --- |');
  for (const asset of model.usedAssets) {
    lines.push('| ' + md(asset.id) + ' | ' + md(asset.type) + ' | ' + md(asset.name)
      + ' | ' + asset.count + ' | ' + md(asset.scenes.join(', ')) + ' |');
  }

  lines.push('', '## 機械検査', '');
  if (model.findings.length === 0) {
    lines.push('- PCE行長、行数、mouthSlotの機械検査で指摘なし。自然さと構成は別途全文レビューが必要。');
  } else {
    model.findings.forEach((finding) =>
      lines.push('- [' + finding.level.toUpperCase() + '] '
        + finding.locationId + ': ' + finding.message));
  }

  lines.push('', '## 外部reviewerへの依頼', '');
  lines.push('- 全messageと両分岐を読む。');
  lines.push('- 不自然な日本語、唐突な話題、設定矛盾、抽象的なAI調、人物口調、重複を確認する。');
  lines.push('- 変更ごとにlocationIdを使い、before、after、文脈、理由を変更票へ書く。');
  lines.push('- scene順を変える案はcategoryにstructureを含め、単純校正と分ける。');
  lines.push('- 台詞変更後は音声再生成が必要と扱う。', '');

  lines.push('## 演出付き全文台本', '');
  for (const scene of model.scenes) {
    lines.push('### ' + scene.id + ' — ' + (scene.name || ''), '');
    const incoming = model.incoming.get(scene.id) || [];
    lines.push('- inbound: ' + (incoming.length
      ? incoming.map((edge) => edge.from + ' (' + edge.via + ')').join(', ')
      : '文書外／直前なし'));
    if (scene.nextSceneId) lines.push('- nextSceneId: ' + scene.nextSceneId);
    lines.push('');
    (scene.commands || []).forEach((command, index) =>
      lines.push(...formatCommand(model, scene, command, index)));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function createReviewTemplate(model) {
  return {
    schemaVersion: 1,
    episodeId: model.episodeId,
    source: {
      project: model.projectName,
      sceneFile: model.sourceSceneFile,
      sha256: model.sourceHash,
    },
    reviewer: '',
    reviewSummary: {
      episodeTitle: model.episodeContext?.title || '',
      premise: model.episodeContext?.concept || '',
      strengths: [],
      structuralFindings: [],
      continuityFindings: [],
      coverage: {
        messagesRead: 0,
        messagesTotal: model.messageCount,
        scenesRead: 0,
        scenesTotal: model.sceneCount,
        choicesChecked: 0,
        notes: '',
      },
    },
    changes: [],
  };
}

function resolveCommand(project, rawId) {
  const parsed = parseLocationId(rawId);
  if (!parsed) return { error: 'invalid locationId' };
  if (parsed.episodeId !== project.episodeId) return { error: 'episode mismatch' };
  const scene = project.doc.scenes.find((item) => item.id === parsed.sceneId);
  if (!scene) return { error: 'scene not found: ' + parsed.sceneId };
  const command = (scene.commands || [])[parsed.commandIndex];
  if (!command) return { error: 'command not found at C' + (parsed.commandIndex + 1) };
  return { parsed, scene, command };
}

function resolveMessage(project, rawId) {
  const resolved = resolveCommand(project, rawId);
  if (resolved.error) return resolved;
  if (resolved.command.type !== 'message') {
    return { error: 'target is ' + resolved.command.type + ', not message' };
  }
  return resolved;
}

function resolveChoice(project, rawId, choiceNumber) {
  const resolved = resolveCommand(project, rawId);
  if (resolved.error) return resolved;
  if (resolved.command.type !== 'choice') {
    return { error: 'target is ' + resolved.command.type + ', not choice' };
  }
  if (!Number.isInteger(choiceNumber) || choiceNumber < 1) {
    return { error: 'choiceNumber must be a positive 1-based integer' };
  }
  const option = (resolved.command.choices || [])[choiceNumber - 1];
  if (!option) return { error: 'choice option not found: ' + choiceNumber };
  return { ...resolved, choiceNumber, option };
}

function validateChangeSet(project, set) {
  const errors = [];
  const warnings = [];
  if (!set || typeof set !== 'object') return { errors: ['change set must be an object'], warnings };
  if (set.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (set.episodeId !== project.episodeId) errors.push('episodeId must be ' + project.episodeId);
  if (!set.source || set.source.sha256 !== project.sourceHash) {
    errors.push('source.sha256 does not match current JSON');
  }

  const scenes = episodeScenes(project);
  const totalMessages = scenes.reduce((n, s) =>
    n + (s.commands || []).filter((c) => c.type === 'message').length, 0);
  const totalChoices = scenes.reduce((n, s) =>
    n + (s.commands || []).filter((c) => c.type === 'choice').length, 0);
  const coverage = set.reviewSummary?.coverage;
  if (!coverage) warnings.push('reviewSummary.coverage is missing');
  else {
    if (coverage.messagesTotal !== totalMessages) warnings.push('messagesTotal should be ' + totalMessages);
    if (coverage.scenesTotal !== scenes.length) warnings.push('scenesTotal should be ' + scenes.length);
    if (coverage.messagesRead !== totalMessages || coverage.scenesRead !== scenes.length
      || coverage.choicesChecked !== totalChoices) {
      warnings.push('coverage is incomplete for SELF_REVIEWED');
    }
  }

  if (!Array.isArray(set.changes)) {
    errors.push('changes must be an array');
    return { errors, warnings };
  }

  const ids = new Set();
  const destructive = new Map();
  set.changes.forEach((change, index) => {
    const label = 'changes[' + index + ']';
    if (!change || typeof change !== 'object') {
      errors.push(label + ' must be an object');
      return;
    }
    if (!change.changeId) errors.push(label + '.changeId is required');
    else if (ids.has(change.changeId)) errors.push(label + '.changeId is duplicate');
    else ids.add(change.changeId);
    if (!OPERATIONS.has(change.operation)) errors.push(label + '.operation is invalid');
    if (!DECISIONS.has(change.decision)) errors.push(label + '.decision is invalid');
    if (!SEVERITIES.has(change.severity)) errors.push(label + '.severity is invalid');
    if (!Array.isArray(change.category) || change.category.length === 0) {
      errors.push(label + '.category must be non-empty');
    } else {
      change.category.forEach((category) => {
        if (!CATEGORIES.has(category)) errors.push(label + '.category is invalid: ' + category);
      });
    }
    if (!change.reason) errors.push(label + '.reason is required');
    if (!change.context) warnings.push(label + '.context is empty');

    if (change.operation === 'replace-choice-label') {
      const resolved = resolveChoice(project, change.locationId, change.choiceNumber);
      if (resolved.error) {
        errors.push(label + ': ' + resolved.error);
        return;
      }
      const current = snapshotChoice(resolved.option);
      if (!sameChoiceSnapshot(change.before, current)) {
        errors.push(label + '.before does not exactly match choice ' + change.choiceNumber
          + ' at ' + change.locationId);
      }
      if (!change.after || typeof change.after.label !== 'string'
        || change.after.label.trim() === '') {
        errors.push(label + '.after.label must be a non-empty string');
      }
      if (sameChoiceSnapshot(change.before, change.after)) {
        errors.push(label + ' replace-choice-label has no change');
      }
      const key = change.locationId + '#choice' + change.choiceNumber;
      if (destructive.has(key)) errors.push(label + ' conflicts at ' + key);
      else destructive.set(key, change.changeId);
      return;
    }

    const resolved = resolveMessage(project, change.locationId);
    if (resolved.error) {
      errors.push(label + ': ' + resolved.error);
      return;
    }
    const current = snapshotMessage(resolved.command);
    if (change.operation === 'replace' || change.operation === 'delete') {
      if (!sameSnapshot(change.before, current)) {
        errors.push(label + '.before does not exactly match ' + change.locationId);
      }
      if (destructive.has(change.locationId)) {
        errors.push(label + ' conflicts at ' + change.locationId);
      } else destructive.set(change.locationId, change.changeId);
    } else if (change.before !== null) {
      errors.push(label + '.before must be null for insert');
    }

    if (change.operation === 'delete') {
      if (change.after !== null) errors.push(label + '.after must be null for delete');
    } else {
      const keepsMouth = change.operation === 'replace'
        && change.before?.speaker === change.after?.speaker
        && change.before?.mouthSlot === change.after?.mouthSlot;
      checkMessage(change.after, label + '.after', errors, warnings, { skipMouth: keepsMouth });
    }
    if (change.operation === 'replace' && sameSnapshot(change.before, change.after)) {
      errors.push(label + ' replace has no change');
    }
  });
  return { errors, warnings };
}


function messageCell(message, empty) {
  if (!message) return md(empty);
  if (Object.hasOwn(message, 'label')) {
    return '<strong>選択肢ラベル</strong><br>' + md(message.label || '（空）');
  }
  const speaker = message.speaker || 'ナレーション';
  return '<strong>' + md(speaker) + ' / mouth ' + md(String(message.mouthSlot))
    + '</strong><br>' + md(message.text || '（空）').replaceAll('\n', '<br>');
}

function renderDiffReport(project, set, validation) {
  const summary = set.reviewSummary || {};
  const coverage = summary.coverage || {};
  const lines = [
    '# 「いしのうらにいる！？」' + project.episodeId.toUpperCase() + ' 自己レビュー差分',
    '',
    '- project: ' + project.projectName,
    '- sourceSha256: ' + project.sourceHash,
    '- reviewer: ' + (set.reviewer || '未記入'),
    '- status: SELF_REVIEWED / EXTERNAL_REVIEW_PENDING',
    '',
    '## 話数レビュー要約',
    '',
    '- 題名／題材: ' + (summary.episodeTitle || '未記入'),
    '- premise: ' + (summary.premise || '未記入'),
    '- coverage: messages ' + (coverage.messagesRead ?? 0) + '/' + (coverage.messagesTotal ?? 0)
      + ', scenes ' + (coverage.scenesRead ?? 0) + '/' + (coverage.scenesTotal ?? 0)
      + ', choices ' + (coverage.choicesChecked ?? 0),
    '',
  ];
  arraySection(lines, '良い点', summary.strengths);
  arraySection(lines, '構成所見', summary.structuralFindings);
  arraySection(lines, '連続性所見', summary.continuityFindings);

  const counts = { high: 0, medium: 0, low: 0 };
  set.changes.forEach((change) => { counts[change.severity] += 1; });
  lines.push('## 変更集計', '', '- total: ' + set.changes.length,
    '- high: ' + counts.high + ' / medium: ' + counts.medium + ' / low: ' + counts.low, '');

  lines.push('## 検査結果', '');
  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    lines.push('- error 0 / warning 0');
  } else {
    validation.errors.forEach((item) => lines.push('- [ERROR] ' + item));
    validation.warnings.forEach((item) => lines.push('- [WARNING] ' + item));
  }
  lines.push('', '## 修正前後', '');
  if (set.changes.length === 0) lines.push('- 変更提案なし');
  for (const change of set.changes) {
    lines.push('### ' + change.changeId + ' — ' + change.category.join(' / '), '');
    lines.push('- 場所: ' + change.locationId
      + (change.operation === 'replace-choice-label' ? ' / 選択肢 ' + change.choiceNumber : ''));
    lines.push('- operation: ' + change.operation + ' / 重要度: ' + change.severity
      + ' / decision: ' + change.decision);
    lines.push('- 文脈: ' + change.context, '');
    lines.push('| 修正前 | 修正後 |', '| --- | --- |');
    lines.push('| ' + messageCell(change.before, '（なし）') + ' | '
      + messageCell(change.after, change.operation === 'delete' ? '（削除）' : '（なし）') + ' |');
    lines.push('', '理由: ' + change.reason, '');
  }
  lines.push('## 引き渡し状態', '', '- SELF_REVIEWED', '- EXTERNAL_REVIEW_PENDING');
  if (set.changes.length > 0) lines.push('- VOICE_REGEN_REQUIRED（採用後）');
  lines.push('');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function insertedMessage(after) {
  return {
    type: 'message',
    speaker: after.speaker,
    text: after.text,
    textColor: '',
    voiceAssetId: '',
    mouthSlot: after.mouthSlot,
  };
}

function applyApprovedChanges(project, set, clearVoices) {
  const approved = set.changes.filter((change) => change.decision === 'approved');
  if (approved.length === 0) throw new Error('No approved changes');
  const output = structuredClone(project.doc);
  const grouped = new Map();

  for (const change of approved) {
    if (change.operation === 'replace-choice-label') {
      const resolved = resolveChoice(project, change.locationId, change.choiceNumber);
      if (resolved.error) throw new Error(change.changeId + ': ' + resolved.error);
      const outputScene = output.scenes.find((scene) => scene.id === resolved.scene.id);
      const outputCommand = outputScene?.commands?.[resolved.parsed.commandIndex];
      const outputOption = outputCommand?.choices?.[change.choiceNumber - 1];
      if (!outputOption) throw new Error(change.changeId + ': output choice option not found');
      outputOption.label = change.after.label;
      continue;
    }

    const resolved = resolveMessage(project, change.locationId);
    if (resolved.error) throw new Error(change.changeId + ': ' + resolved.error);
    if (!grouped.has(resolved.scene.id)) grouped.set(resolved.scene.id, []);
    grouped.get(resolved.scene.id).push({
      change,
      index: resolved.parsed.commandIndex,
    });
  }

  for (const scene of output.scenes) {
    if (!grouped.has(scene.id)) continue;
    const byIndex = new Map();
    for (const entry of grouped.get(scene.id)) {
      if (!byIndex.has(entry.index)) byIndex.set(entry.index, []);
      byIndex.get(entry.index).push(entry.change);
    }
    const rebuilt = [];
    scene.commands.forEach((command, index) => {
      const changes = byIndex.get(index) || [];
      changes.filter((c) => c.operation === 'insert-before')
        .forEach((c) => rebuilt.push(insertedMessage(c.after)));
      const replacement = changes.find((c) => c.operation === 'replace');
      const deletion = changes.find((c) => c.operation === 'delete');
      if (!deletion) {
        if (!replacement) rebuilt.push(command);
        else {
          const next = { ...command };
          const speechChanged = next.speaker !== replacement.after.speaker
            || next.text !== replacement.after.text;
          if (speechChanged && next.voiceAssetId && !clearVoices) {
            throw new Error(replacement.changeId
              + ': stale voiceAssetId; use --clear-voices');
          }
          next.speaker = replacement.after.speaker;
          next.text = replacement.after.text;
          next.mouthSlot = replacement.after.mouthSlot;
          if (speechChanged && clearVoices) next.voiceAssetId = '';
          rebuilt.push(next);
        }
      }
      changes.filter((c) => c.operation === 'insert-after')
        .forEach((c) => rebuilt.push(insertedMessage(c.after)));
    });
    scene.commands = rebuilt;
  }
  return output;
}

async function readContext(file, episodeId) {
  try {
    const doc = JSON.parse(await fs.readFile(file, 'utf8'));
    return doc.episodes?.[episodeId] || null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function extract(options) {
  const project = await loadProject(required(options, 'project'));
  const out = path.resolve(required(options, 'out'));
  const seriesFile = path.resolve(String(options['series-context'] || DEFAULT_SERIES_CONTEXT));
  const contextsFile = path.resolve(String(options['episode-contexts'] || DEFAULT_EPISODE_CONTEXTS));
  const [series, context] = await Promise.all([
    fs.readFile(seriesFile, 'utf8'),
    readContext(contextsFile, project.episodeId),
  ]);
  const model = buildEpisodeModel(project, context);
  await fs.mkdir(out, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(out, 'review-pack.md'), renderReviewPack(model, series), 'utf8'),
    fs.writeFile(path.join(out, 'review-changes.template.json'),
      JSON.stringify(createReviewTemplate(model), null, 2) + '\n', 'utf8'),
  ]);
  return {
    ok: true,
    command: 'extract',
    episodeId: model.episodeId,
    project: model.projectName,
    scenes: model.sceneCount,
    messages: model.messageCount,
    choices: model.choiceCount,
    machineFindings: model.findings.length,
    out: out.replaceAll('\\', '/'),
  };
}

async function loadChanges(options) {
  const project = await loadProject(required(options, 'project'));
  const file = path.resolve(required(options, 'changes'));
  const set = JSON.parse(await fs.readFile(file, 'utf8'));
  return { project, set, validation: validateChangeSet(project, set) };
}

async function validateCommand(options) {
  const loaded = await loadChanges(options);
  return {
    ok: loaded.validation.errors.length === 0,
    command: 'validate',
    episodeId: loaded.project.episodeId,
    changes: loaded.set.changes.length,
    errors: loaded.validation.errors,
    warnings: loaded.validation.warnings,
  };
}

async function renderCommand(options) {
  const loaded = await loadChanges(options);
  if (loaded.validation.errors.length) {
    throw new Error('Invalid changes:\n' + loaded.validation.errors.join('\n'));
  }
  const out = path.resolve(required(options, 'out'));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, renderDiffReport(loaded.project, loaded.set, loaded.validation), 'utf8');
  return {
    ok: true,
    command: 'render',
    episodeId: loaded.project.episodeId,
    changes: loaded.set.changes.length,
    warnings: loaded.validation.warnings,
    out: out.replaceAll('\\', '/'),
  };
}

async function applyCommand(options) {
  const loaded = await loadChanges(options);
  if (loaded.validation.errors.length) {
    throw new Error('Invalid changes:\n' + loaded.validation.errors.join('\n'));
  }
  const out = path.resolve(required(options, 'out'));
  if (out === loaded.project.scenePath) throw new Error('Refusing to overwrite source JSON');
  const doc = applyApprovedChanges(loaded.project, loaded.set, options['clear-voices'] === true);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return {
    ok: true,
    command: 'apply',
    episodeId: loaded.project.episodeId,
    approved: loaded.set.changes.filter((c) => c.decision === 'approved').length,
    voicesCleared: options['clear-voices'] === true,
    out: out.replaceAll('\\', '/'),
  };
}

function usage() {
  return [
    'Usage:',
    '  episode-review.mjs extract --project DIR --out DIR',
    '  episode-review.mjs validate --project DIR --changes FILE',
    '  episode-review.mjs render --project DIR --changes FILE --out FILE',
    '  episode-review.mjs apply --project DIR --changes FILE --out FILE [--clear-voices]',
  ].join('\n');
}

async function main(argv) {
  const { command, options } = parseCli(argv);
  if (command === 'extract') return extract(options);
  if (command === 'validate') return validateCommand(options);
  if (command === 'render') return renderCommand(options);
  if (command === 'apply') return applyCommand(options);
  throw new Error(usage());
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.ok === false) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(String(error?.stack || error) + '\n');
    process.exitCode = 1;
  });
}

export {
  applyApprovedChanges,
  auditDocument,
  buildEpisodeModel,
  createReviewTemplate,
  deriveEpisodeId,
  loadProject,
  locationId,
  parseLocationId,
  renderDiffReport,
  renderReviewPack,
  snapshotChoice,
  snapshotMessage,
  validateChangeSet,
};

