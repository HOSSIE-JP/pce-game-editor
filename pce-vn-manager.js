'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assetManager = require('./pce-asset-manager');

const VN_SCENE_FILE = path.join('assets', 'pce-vn-scenes.json');
const VN_FONT_FILE = path.join('assets', 'pce-font.json');
const GLYPH_END = 0xff;
const GLYPH_NEWLINE = 0xfe;
const DEFAULT_FONT_TILE_BASE = 712;
const PCE_SCREEN_WIDTH = 320;
const DEFAULT_CHARACTER_Y = 24;
const VN_VERSION = 2;
const VN_COMMAND_BACKGROUND = 0;
const VN_COMMAND_SPRITE = 1;
const VN_COMMAND_MESSAGE = 2;
const VN_COMMAND_AUDIO = 3;
const VN_COMMAND_PRELOAD = 4;
const VN_COMMAND_CHOICE = 5;
const VN_COMMAND_JUMP = 6;
const VN_COMMAND_WAIT = 7;
const VN_COMMAND_EFFECT = 8;
const VN_COMMAND_VARIABLE = 9;
const VN_COMMAND_IF = 10;
const VN_COMMAND_SWITCH = 11;
const VN_COMMAND_LABEL = 12;
const VN_COMMAND_GOTO = 13;
const VN_BG_TRANSITION_CUT = 0;
const VN_BG_TRANSITION_FADE = 1;
const VN_SPRITE_VISIBLE = 1;
const VN_SPRITE_FLIP_X = 2;
const VN_SPRITE_FLIP_Y = 4;
const VN_AUDIO_KIND_ADPCM = 0;
const VN_AUDIO_KIND_CDDA = 1;
const VN_AUDIO_ACTION_PLAY = 0x10;
const VN_AUDIO_ACTION_STOP = 0x20;
const VN_EFFECT_FADE_OUT = 0;
const VN_EFFECT_FADE_IN = 1;
const VN_EFFECT_BLANK = 2;
const VN_EFFECT_SHAKE = 3;
const VN_ADVANCE_BUTTON = 0;
const VN_ADVANCE_AUTO = 1;
const VN_VAR_OP_DEFINE = 0;
const VN_VAR_OP_SET = 1;
const VN_VAR_OP_ADD = 2;
const VN_VAR_OP_SUB = 3;
const VN_VAR_OP_RANDOM = 4;
const VN_COMPARE_EQ = 0;
const VN_COMPARE_NE = 1;
const VN_COMPARE_LT = 2;
const VN_COMPARE_LTE = 3;
const VN_COMPARE_GT = 4;
const VN_COMPARE_GTE = 5;
const VN_NO_COMMAND = 0xffff;
const VN_MAX_U8_COUNT = 255;
const VN_SCENE_PACK_DIR = path.join('assets', 'generated', 'vn', 'scenes');
// Font tiles are streamed from this CD data file into VRAM at boot (no longer
// resident in ram_bank132). One glyph = 16x16 px = 4 BG tiles = 128 bytes.
const VN_FONT_DATA_FILE = path.join('assets', 'generated', 'vn', 'font.bin');
const FONT_TILES_PER_GLYPH = 4;
const FONT_BYTES_PER_GLYPH = 128;
// glyph index space: 0..253 are drawable, 0xfe = newline, 0xff = end marker.
const VN_MAX_GLYPH_COUNT = 254;
// VRAM is 0x8000 words; SATB sits at 0x7f00 (tile 0x7f00/16 = 2032). Font tiles
// must end strictly below that. Sprite patterns are auto-placed above the font
// block by the asset converter, so warn well before the hard SATB ceiling.
const VN_FONT_VRAM_TILE_HARD_CEILING = 2032;
const VN_FONT_VRAM_TILE_SOFT_CEILING = 1728;
const VN_GLYPH_COUNT_SOFT_WARN = 224;
const VN_SCENE_PACK_CACHE_BYTES = 4096;
const VN_SCENE_PACK_VERSION = 1;
const VN_SCENE_PACK_HEADER_SIZE = 20;
const VN_SCENE_PACK_COMMAND_SIZE = 19;
const VN_SCENE_PACK_MESSAGE_SIZE = 11;
const VN_SCENE_PACK_CHOICE_SIZE = 6;
const VN_SCENE_PACK_OPTION_SIZE = 7;
const VN_SCENE_PACK_SWITCH_SIZE = 5;
const VN_SCENE_PACK_SWITCH_CASE_SIZE = 4;
const VN_SCENE_PACK_MAGIC = Buffer.from('PVNS');
const VN_CD_SECTOR_BYTES = 2048;
const DEFAULT_FONT_CONFIG = {
  version: 1,
  fontPath: '',
  fontSize: 15,
  threshold: 32,
  xOffset: 0,
  yOffset: 0,
  tileBase: DEFAULT_FONT_TILE_BASE,
  previewText: '320がめんです\n18もじx4ぎょう',
};

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function templateRuntimeDir() {
  return path.join(__dirname, 'template', 'template_pce_vn_cd', 'src');
}

function copyIfChanged(sourcePath, targetPath) {
  const source = fs.readFileSync(sourcePath);
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null;
  if (current && Buffer.compare(source, current) === 0) return false;
  ensureDirSync(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function getSceneFilePath(projectDir) {
  return path.join(projectDir, VN_SCENE_FILE);
}

function getFontFilePath(projectDir) {
  return path.join(projectDir, VN_FONT_FILE);
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampPositiveInt(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampSignedInt(value, fallback = 0) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(-32768, Math.min(32767, parsed));
}

function normalizeFontConfig(config = {}) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    version: 1,
    fontPath: String(raw.fontPath || '').trim(),
    fontSize: clampInt(raw.fontSize, 8, 32, DEFAULT_FONT_CONFIG.fontSize),
    threshold: clampInt(raw.threshold, 1, 254, DEFAULT_FONT_CONFIG.threshold),
    xOffset: clampInt(raw.xOffset, -8, 8, DEFAULT_FONT_CONFIG.xOffset),
    yOffset: clampInt(raw.yOffset, -8, 8, DEFAULT_FONT_CONFIG.yOffset),
    tileBase: clampInt(raw.tileBase, 0, 2047, DEFAULT_FONT_CONFIG.tileBase),
    previewText: String(raw.previewText || DEFAULT_FONT_CONFIG.previewText).slice(0, 512),
  };
}

function readFontConfig(projectDir) {
  const configPath = getFontFilePath(projectDir);
  if (!fs.existsSync(configPath)) return normalizeFontConfig(DEFAULT_FONT_CONFIG);
  try {
    return normalizeFontConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  } catch (_) {
    return normalizeFontConfig(DEFAULT_FONT_CONFIG);
  }
}

function writeFontConfig(projectDir, config = {}) {
  const normalized = normalizeFontConfig(config);
  const configPath = getFontFilePath(projectDir);
  ensureDirSync(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function safeId(value, fallback) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return id || fallback;
}

function normalizeVariableName(value = '', fallback = 'var_1') {
  return safeId(value, fallback).slice(0, 32);
}

function normalizeLabelName(value = '', fallback = '') {
  return safeId(value, fallback).slice(0, 32);
}

function firstAssetId(assets, type) {
  const found = assets.find((asset) => asset.type === type);
  return found ? found.id : '';
}

function findAsset(assetDoc = { assets: [] }, id = '') {
  return (assetDoc.assets || []).find((asset) => asset.id === id) || null;
}

function spritePixelWidth(asset = {}) {
  const options = asset.options && typeof asset.options === 'object' ? asset.options : {};
  const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
  const width = Number(options.width || generated.width);
  if (Number.isFinite(width) && width > 0) return Math.min(PCE_SCREEN_WIDTH, Math.round(width));
  const cellWidth = Number(options.cellWidth || generated.cellWidth);
  const columns = Number(options.cellColumns || generated.cellColumns || generated.columns);
  if (Number.isFinite(cellWidth) && cellWidth > 0 && Number.isFinite(columns) && columns > 0) {
    return Math.min(PCE_SCREEN_WIDTH, Math.round(cellWidth * columns));
  }
  return 64;
}

function defaultCharacterX(assetDoc, assetId) {
  const width = spritePixelWidth(findAsset(assetDoc, assetId));
  return Math.max(0, Math.floor((PCE_SCREEN_WIDTH - width) / 2));
}

function defaultSceneDocument(assetDoc = { assets: [] }) {
  const assets = Array.isArray(assetDoc.assets) ? assetDoc.assets : [];
  const backgroundAssetId = firstAssetId(assets, 'image');
  const voiceAssetId = firstAssetId(assets, 'adpcm');
  const commands = [];
  if (backgroundAssetId) {
    commands.push({
      type: 'background',
      assetId: backgroundAssetId,
      transition: 'fade',
      fadeOutFrames: 0,
      fadeInFrames: 16,
    });
  }
  commands.push({
    type: 'message',
    speaker: 'アカリ',
    text: '320がめんです',
    voiceAssetId,
    textSpeedFrames: 2,
    advanceMode: 'button',
    autoWaitFrames: 60,
    mouthSlot: 0,
    mouthAnimationId: '',
  });
  commands.push({
    type: 'message',
    speaker: 'アカリ',
    text: '18もじx4ぎょう',
    voiceAssetId: '',
    textSpeedFrames: 2,
    advanceMode: 'button',
    autoWaitFrames: 60,
    mouthSlot: 0,
    mouthAnimationId: '',
  });
  return {
    version: VN_VERSION,
    startScene: 'opening',
    scenes: [
      {
        id: 'opening',
        commands,
        nextSceneId: '',
      },
    ],
  };
}

function assetIdsByType(assetDoc = { assets: [] }) {
  const result = {
    image: new Set(),
    sprite: new Set(),
    'psg-song': new Set(),
    'psg-sfx': new Set(),
    adpcm: new Set(),
    'cdda-track': new Set(),
  };
  (assetDoc.assets || []).forEach((asset) => {
    if (result[asset.type]) result[asset.type].add(asset.id);
  });
  return result;
}

function assetTypeForId(assetDoc = { assets: [] }, assetId = '') {
  return findAsset(assetDoc, assetId)?.type || '';
}

function normalizeMessageCommand(message = {}, index = 0, valid = assetIdsByType()) {
  const raw = message && typeof message === 'object' ? message : {};
  const voiceAssetId = String(raw.voiceAssetId || '').trim();
  return {
    type: 'message',
    speaker: String(raw.speaker || '').trim().slice(0, 16),
    text: String(raw.text || (index === 0 ? 'メッセージを入力してください。' : '')).trim().slice(0, 96),
    voiceAssetId: valid.adpcm?.has(voiceAssetId) ? voiceAssetId : '',
    textSpeedFrames: clampInt(raw.textSpeedFrames ?? raw.speed, 0, 30, 2),
    advanceMode: String(raw.advanceMode || 'button') === 'auto' ? 'auto' : 'button',
    autoWaitFrames: clampInt(raw.autoWaitFrames, 0, 255, 60),
    mouthSlot: clampInt(raw.mouthSlot, 0, 3, 0),
    mouthAnimationId: String(raw.mouthAnimationId || '').trim().slice(0, 32),
  };
}

function normalizeLegacyCharacterCommand(character = {}, index = 0, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const raw = character && typeof character === 'object' ? character : {};
  const assetId = String(raw.assetId || '').trim();
  if (!valid.sprite?.has(assetId)) return null;
  return {
    type: 'sprite',
    slot: clampInt(raw.slot, 0, 3, index),
    assetId,
    x: clampInt(raw.x, 0, 319, defaultCharacterX(assetDoc, assetId)),
    y: clampInt(raw.y, 0, 223, DEFAULT_CHARACTER_Y),
    animationId: String(raw.animationId || raw.pose || 'default').trim().slice(0, 32) || 'default',
    flipX: Boolean(raw.flipX ?? raw.flippedX ?? raw.hflip),
    flipY: Boolean(raw.flipY ?? raw.flippedY ?? raw.vflip),
    durationFrames: clampInt(raw.durationFrames ?? raw.moveFrames ?? raw.frames, 0, 255, 0),
    visible: raw.visible !== false,
  };
}

function normalizeSceneRef(value = '') {
  return safeId(value, '');
}

function normalizeChoiceCommand(choice = {}) {
  const raw = choice && typeof choice === 'object' ? choice : {};
  const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
  const choices = rawChoices
    .map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const label = String(item.label || item.text || `選択肢${index + 1}`).trim().slice(0, 24);
      const targetSceneId = normalizeSceneRef(item.targetSceneId || item.sceneId || item.nextSceneId || item.target || '');
      const value = clampSignedInt(item.value ?? item.resultValue ?? index, index);
      if (!label) return null;
      return { label, value, targetSceneId };
    })
    .filter(Boolean)
    .slice(0, 4);
  if (!choices.length) return null;
  return {
    type: 'choice',
    variableName: String(raw.variableName || raw.variable || raw.resultVariable || '').trim()
      ? normalizeVariableName(raw.variableName || raw.variable || raw.resultVariable)
      : '',
    choices,
    defaultIndex: clampInt(raw.defaultIndex ?? raw.initialIndex, 0, choices.length - 1, 0),
  };
}

function normalizeVariableOperation(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'define' || raw === 'def') return 'define';
  if (raw === 'add' || raw === 'inc' || raw === '+') return 'add';
  if (raw === 'sub' || raw === 'subtract' || raw === 'dec' || raw === '-') return 'sub';
  if (raw === 'random' || raw === 'rand') return 'random';
  return 'set';
}

function normalizeCompareOperator(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === '!=' || raw === '<>' || raw === 'ne' || raw === 'notEquals') return 'ne';
  if (raw === '<' || raw === 'lt') return 'lt';
  if (raw === '<=' || raw === 'lte' || raw === 'le') return 'lte';
  if (raw === '>' || raw === 'gt') return 'gt';
  if (raw === '>=' || raw === 'gte' || raw === 'ge') return 'gte';
  return 'eq';
}

function normalizeVariableCommand(command = {}) {
  const raw = command && typeof command === 'object' ? command : {};
  const operation = normalizeVariableOperation(raw.operation || raw.op || raw.action || (raw.define ? 'define' : 'set'));
  let min = clampSignedInt(raw.min ?? raw.minimum ?? 0, 0);
  let max = clampSignedInt(raw.max ?? raw.maximum ?? 9, 9);
  if (min > max) [min, max] = [max, min];
  return {
    type: 'variable',
    variableName: normalizeVariableName(raw.variableName || raw.variable || raw.name),
    operation,
    value: clampSignedInt(raw.value ?? raw.initialValue ?? raw.amount, 0),
    min,
    max,
  };
}

function normalizeIfCommand(command = {}) {
  const raw = command && typeof command === 'object' ? command : {};
  return {
    type: 'if',
    variableName: normalizeVariableName(raw.variableName || raw.variable || raw.name),
    operator: normalizeCompareOperator(raw.operator || raw.compare || raw.condition),
    value: clampSignedInt(raw.value ?? raw.compareValue ?? 0, 0),
    targetLabel: normalizeLabelName(raw.targetLabel || raw.thenLabel || raw.trueLabel || raw.label || raw.target, ''),
    elseLabel: normalizeLabelName(raw.elseLabel || raw.falseLabel || '', ''),
  };
}

function normalizeSwitchCommand(command = {}) {
  const raw = command && typeof command === 'object' ? command : {};
  const cases = (Array.isArray(raw.cases) ? raw.cases : [])
    .map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const targetLabel = normalizeLabelName(item.targetLabel || item.label || item.target || '', '');
      return {
        value: clampSignedInt(item.value ?? index, index),
        targetLabel,
      };
    })
    .slice(0, 16);
  return {
    type: 'switch',
    variableName: normalizeVariableName(raw.variableName || raw.variable || raw.name),
    cases: cases.length ? cases : [{ value: 0, targetLabel: '' }],
    defaultLabel: normalizeLabelName(raw.defaultLabel || raw.elseLabel || raw.default || '', ''),
  };
}

function normalizeEffectKind(value = '') {
  const raw = String(value || '').trim();
  if (raw === 'fadeIn' || raw === 'fade-in' || raw === 'in') return 'fadeIn';
  if (raw === 'blank' || raw === 'black') return 'blank';
  if (raw === 'shake' || raw === 'screenShake' || raw === 'screen-shake') return 'shake';
  return 'fadeOut';
}

function normalizeCommand(command = {}, index = 0, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const raw = command && typeof command === 'object' ? command : {};
  const type = String(raw.type || '').trim();
  if (type === 'background') {
    const assetId = String(raw.assetId || raw.backgroundAssetId || '').trim();
    const fallbackAssetId = firstAssetId(assetDoc.assets || [], 'image') || '';
    return {
      type: 'background',
      assetId: valid.image?.has(assetId) ? assetId : fallbackAssetId,
      transition: String(raw.transition || 'cut') === 'fade' ? 'fade' : 'cut',
      fadeOutFrames: clampInt(raw.fadeOutFrames, 0, 60, 0),
      fadeInFrames: clampInt(raw.fadeInFrames, 0, 60, String(raw.transition || '') === 'fade' ? 16 : 0),
      x: clampInt(raw.x ?? raw.tileX ?? raw.mapX, 0, 63, 0),
      y: clampInt(raw.y ?? raw.tileY ?? raw.mapY, 0, 31, 0),
    };
  }
  if (type === 'sprite') {
    const assetId = String(raw.assetId || '').trim();
    const visible = raw.visible !== false;
    if (visible && !valid.sprite?.has(assetId)) return null;
    return {
      type: 'sprite',
      slot: clampInt(raw.slot, 0, 3, 0),
      assetId: valid.sprite?.has(assetId) ? assetId : '',
      x: clampInt(raw.x, 0, 319, defaultCharacterX(assetDoc, assetId)),
      y: clampInt(raw.y, 0, 223, DEFAULT_CHARACTER_Y),
      animationId: String(raw.animationId || 'default').trim().slice(0, 32) || 'default',
      flipX: Boolean(raw.flipX ?? raw.flippedX ?? raw.hflip),
      flipY: Boolean(raw.flipY ?? raw.flippedY ?? raw.vflip),
      durationFrames: clampInt(raw.durationFrames ?? raw.moveFrames ?? raw.frames, 0, 255, 0),
      visible,
    };
  }
  if (type === 'message') {
    return normalizeMessageCommand(raw, index, valid);
  }
  if (type === 'audio') {
    const action = String(raw.action || 'play') === 'stop' ? 'stop' : 'play';
    const assetId = String(raw.assetId || raw.bgmAssetId || raw.voiceAssetId || '').trim();
    const actualType = assetTypeForId(assetDoc, assetId);
    const kind = String(raw.kind || (actualType === 'adpcm' ? 'adpcm' : 'cdda')) === 'adpcm' ? 'adpcm' : 'cdda';
    const validAsset = kind === 'adpcm' ? valid.adpcm?.has(assetId) : valid['cdda-track']?.has(assetId);
    return {
      type: 'audio',
      kind,
      action,
      assetId: action === 'play' && validAsset ? assetId : '',
    };
  }
  if (type === 'preload') {
    return {
      type: 'preload',
      sceneId: normalizeSceneRef(raw.sceneId || raw.nextSceneId || raw.targetSceneId || ''),
    };
  }
  if (type === 'choice') {
    return normalizeChoiceCommand(raw);
  }
  if (type === 'variable' || type === 'var') {
    return normalizeVariableCommand(raw);
  }
  if (type === 'if') {
    return normalizeIfCommand(raw);
  }
  if (type === 'switch') {
    return normalizeSwitchCommand(raw);
  }
  if (type === 'label') {
    return {
      type: 'label',
      name: normalizeLabelName(raw.name || raw.label || raw.id, `label_${index + 1}`),
    };
  }
  if (type === 'goto') {
    return {
      type: 'goto',
      targetLabel: normalizeLabelName(raw.targetLabel || raw.label || raw.target || '', ''),
    };
  }
  if (type === 'jump') {
    return {
      type: 'jump',
      sceneId: normalizeSceneRef(raw.sceneId || raw.targetSceneId || raw.nextSceneId || ''),
    };
  }
  if (type === 'wait') {
    return {
      type: 'wait',
      frames: clampInt(raw.frames ?? raw.durationFrames, 0, 65535, 30),
    };
  }
  if (type === 'effect') {
    const effect = normalizeEffectKind(raw.effect || raw.kind || raw.name);
    return {
      type: 'effect',
      effect,
      frames: clampInt(raw.frames ?? raw.durationFrames, 0, 255, 16),
      intensity: effect === 'shake' ? clampInt(raw.intensity ?? raw.power ?? raw.amplitude, 1, 16, 4) : 0,
    };
  }
  return null;
}

function legacyCommandsForScene(raw = {}, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const commands = [];
  const backgroundAssetId = String(raw.backgroundAssetId || '').trim();
  const bgmAssetId = String(raw.bgmAssetId || '').trim();
  if (valid.image?.has(backgroundAssetId)) {
    commands.push(normalizeCommand({
      type: 'background',
      assetId: backgroundAssetId,
      transition: raw.backgroundTransition || 'cut',
      fadeOutFrames: raw.fadeOutFrames,
      fadeInFrames: raw.fadeInFrames,
    }, commands.length, valid, assetDoc));
  }
  (Array.isArray(raw.characters) ? raw.characters : [])
    .map((character, index) => normalizeLegacyCharacterCommand(character, index, valid, assetDoc))
    .filter(Boolean)
    .slice(0, 4)
    .forEach((command) => commands.push(command));
  if (valid['cdda-track']?.has(bgmAssetId)) {
    commands.push(normalizeCommand({ type: 'audio', kind: 'cdda', action: 'play', assetId: bgmAssetId }, commands.length, valid, assetDoc));
  }
  const messages = Array.isArray(raw.messages) && raw.messages.length
    ? raw.messages
    : defaultSceneDocument(assetDoc).scenes[0].commands.filter((command) => command.type === 'message');
  messages
    .map((message, index) => normalizeMessageCommand(message, index, valid))
    .filter((message) => message.text)
    .forEach((command) => commands.push(command));
  return commands.filter(Boolean);
}

function normalizeScene(scene = {}, index = 0, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const raw = scene && typeof scene === 'object' ? scene : {};
  const commands = Array.isArray(raw.commands) && raw.commands.length
    ? raw.commands.map((command, commandIndex) => normalizeCommand(command, commandIndex, valid, assetDoc)).filter(Boolean)
    : legacyCommandsForScene(raw, valid, assetDoc);
  return {
    id: safeId(raw.id, index === 0 ? 'opening' : `scene_${index + 1}`),
    commands,
    nextSceneId: safeId(raw.nextSceneId, ''),
  };
}

function normalizeSceneDocument(doc = {}, assetDoc = { assets: [] }) {
  const raw = doc && typeof doc === 'object' ? doc : {};
  const valid = assetIdsByType(assetDoc);
  const scenes = Array.isArray(raw.scenes) && raw.scenes.length
    ? raw.scenes.map((scene, index) => normalizeScene(scene, index, valid, assetDoc))
    : defaultSceneDocument(assetDoc).scenes.map((scene, index) => normalizeScene(scene, index, valid, assetDoc));
  const ids = new Set();
  const deduped = scenes.map((scene, index) => {
    let id = scene.id;
    if (ids.has(id)) id = `${id}_${index + 1}`;
    ids.add(id);
    return { ...scene, id };
  });
  const startScene = deduped.some((scene) => scene.id === raw.startScene)
    ? raw.startScene
    : (deduped[0]?.id || 'opening');
  const sceneIds = new Set(deduped.map((scene) => scene.id));
  const normalizedScenes = deduped.map((scene) => ({
    ...scene,
    nextSceneId: scene.nextSceneId && sceneIds.has(scene.nextSceneId) ? scene.nextSceneId : '',
    commands: (() => {
      const labels = new Set((scene.commands || [])
        .filter((command) => command.type === 'label' && command.name)
        .map((command) => command.name));
      return (scene.commands || []).map((command) => {
      if (command.type === 'preload' || command.type === 'jump') {
        return {
          ...command,
          sceneId: command.sceneId && sceneIds.has(command.sceneId) ? command.sceneId : '',
        };
      }
      if (command.type === 'choice') {
        return {
          ...command,
          choices: (command.choices || []).map((choice) => ({
            ...choice,
            targetSceneId: choice.targetSceneId && sceneIds.has(choice.targetSceneId) ? choice.targetSceneId : '',
          })),
        };
      }
      if (command.type === 'goto') {
        return {
          ...command,
          targetLabel: command.targetLabel && labels.has(command.targetLabel) ? command.targetLabel : '',
        };
      }
      if (command.type === 'if') {
        return {
          ...command,
          targetLabel: command.targetLabel && labels.has(command.targetLabel) ? command.targetLabel : '',
          elseLabel: command.elseLabel && labels.has(command.elseLabel) ? command.elseLabel : '',
        };
      }
      if (command.type === 'switch') {
        return {
          ...command,
          cases: (command.cases || []).map((branch) => ({
            ...branch,
            targetLabel: branch.targetLabel && labels.has(branch.targetLabel) ? branch.targetLabel : '',
          })),
          defaultLabel: command.defaultLabel && labels.has(command.defaultLabel) ? command.defaultLabel : '',
        };
      }
      return command;
      });
    })(),
  }));
  return {
    version: VN_VERSION,
    startScene,
    scenes: normalizedScenes,
  };
}

function readSceneDocument(projectDir) {
  const assetDoc = assetManager.readAssetDocument(projectDir);
  const scenePath = getSceneFilePath(projectDir);
  if (!fs.existsSync(scenePath)) return normalizeSceneDocument(defaultSceneDocument(assetDoc), assetDoc);
  try {
    return normalizeSceneDocument(JSON.parse(fs.readFileSync(scenePath, 'utf-8')), assetDoc);
  } catch (_) {
    return normalizeSceneDocument(defaultSceneDocument(assetDoc), assetDoc);
  }
}

function writeSceneDocument(projectDir, doc) {
  const assetDoc = assetManager.readAssetDocument(projectDir);
  const normalized = normalizeSceneDocument(doc, assetDoc);
  const scenePath = getSceneFilePath(projectDir);
  ensureDirSync(path.dirname(scenePath));
  fs.writeFileSync(scenePath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function ensureSceneFile(projectDir) {
  const scenePath = getSceneFilePath(projectDir);
  if (fs.existsSync(scenePath)) return readSceneDocument(projectDir);
  return writeSceneDocument(projectDir, defaultSceneDocument(assetManager.readAssetDocument(projectDir)));
}

function messageDisplayText(message) {
  const speaker = String(message.speaker || '').trim();
  const text = String(message.text || '').trim();
  return speaker ? `${speaker}「${text}」` : text;
}

// Every distinct character that appears in messages/choices, untruncated.
// The leading ' ' and '>' are always present (blank cell and choice cursor).
function collectGlyphsRaw(doc) {
  const glyphs = [' ', '>'];
  const seen = new Set(glyphs);
  (doc.scenes || []).forEach((scene) => {
    (scene.commands || []).forEach((command) => {
      const text = command.type === 'message'
        ? messageDisplayText(command)
        : (command.type === 'choice' ? (command.choices || []).map((choice) => choice.label || '').join('') : '');
      if (!text) return;
      for (const char of text) {
        if (char === '\n' || char === '\r') continue;
        if (!seen.has(char)) {
          seen.add(char);
          glyphs.push(char);
        }
      }
    });
  });
  return glyphs;
}

function collectGlyphs(doc) {
  return collectGlyphsRaw(doc).slice(0, VN_MAX_GLYPH_COUNT);
}

// Build-time budget report for the glyph font. After moving the tiles to a CD
// data file the binding limits are (a) the 254-entry glyph index space and
// (b) the VRAM tile span the streamed tiles occupy. Returns the byte/sector
// footprint plus human-readable warnings/errors so the build can surface them.
function computeFontBudget(rawGlyphCount, tileBase) {
  const usedGlyphCount = Math.min(rawGlyphCount, VN_MAX_GLYPH_COUNT);
  const droppedGlyphCount = Math.max(0, rawGlyphCount - VN_MAX_GLYPH_COUNT);
  const byteSize = usedGlyphCount * FONT_BYTES_PER_GLYPH;
  const sectorCount = Math.max(1, Math.ceil(byteSize / VN_CD_SECTOR_BYTES));
  const endTile = tileBase + (usedGlyphCount * FONT_TILES_PER_GLYPH);
  const warnings = [];
  const errors = [];
  if (droppedGlyphCount > 0) {
    warnings.push(`フォント: 使用文字が ${rawGlyphCount} 種類あり、上限 ${VN_MAX_GLYPH_COUNT} を超えています。`
      + `超過した ${droppedGlyphCount} 文字は空白として表示されます。シーンで使う文字種を減らしてください。`);
  } else if (usedGlyphCount >= VN_GLYPH_COUNT_SOFT_WARN) {
    warnings.push(`フォント: 使用文字が ${usedGlyphCount} 種類で上限 ${VN_MAX_GLYPH_COUNT} に近づいています。`);
  }
  if (endTile > VN_FONT_VRAM_TILE_HARD_CEILING) {
    errors.push(`フォント: タイル配置 (tileBase ${tileBase} + ${usedGlyphCount} グリフ) が VRAM 末尾 (SATB tile ${VN_FONT_VRAM_TILE_HARD_CEILING}) を超えます。`
      + `tileBase を下げるか文字種を減らしてください。`);
  } else if (endTile > VN_FONT_VRAM_TILE_SOFT_CEILING) {
    warnings.push(`フォント: タイル末尾が ${endTile} でスプライトパターン領域に接近しています (推奨上限 ${VN_FONT_VRAM_TILE_SOFT_CEILING})。`);
  }
  return { usedGlyphCount, rawGlyphCount, droppedGlyphCount, byteSize, sectorCount, tileBase, endTile, warnings, errors };
}

function fontCandidates(config = {}) {
  const normalized = normalizeFontConfig(config);
  const candidates = [];
  const addCandidate = (candidate) => {
    if (candidate && fs.existsSync(candidate)) candidates.push(candidate);
  };
  addCandidate(normalized.fontPath);
  try {
    const systemFonts = path.join('/System', 'Library', 'Fonts');
    fs.readdirSync(systemFonts)
      .filter((fileName) => /ヒラ.*角|Hiragino/i.test(fileName))
      .sort((a, b) => {
        const rank = (fileName) => {
          const weight = /W3/i.test(fileName) ? 0
            : /W4/i.test(fileName) ? 1
              : /W5/i.test(fileName) ? 2
                : /W6/i.test(fileName) ? 3
                  : /W2/i.test(fileName) ? 4
                    : /W7/i.test(fileName) ? 5
                      : /W1/i.test(fileName) ? 6
                        : /W8/i.test(fileName) ? 7
                          : /W9/i.test(fileName) ? 8
                            : 9;
          const japanese = /ヒラ/i.test(fileName) ? 0 : 10;
          return japanese + weight;
        };
        return rank(a) - rank(b);
      })
      .forEach((fileName) => addCandidate(path.join(systemFonts, fileName)));
  } catch (_) {}
  [
    path.join('/Library', 'Fonts', 'Arial Unicode.ttf'),
    path.join('/System', 'Library', 'Fonts', 'Hiragino Sans GB.ttc'),
    path.join('/System', 'Library', 'Fonts', 'CJKSymbolsFallback.ttc'),
    'C:\\Windows\\Fonts\\meiryo.ttc',
    'C:\\Windows\\Fonts\\msgothic.ttc',
  ].forEach(addCandidate);
  return Array.from(new Set(candidates));
}

function fallbackGlyphBitmap(glyph, glyphIndex) {
  const bitmap = new Array(256).fill(0);
  if (glyph === ' ') return bitmap;
  for (let y = 1; y < 15; y += 1) {
    for (let x = 1; x < 15; x += 1) {
      const border = x === 1 || x === 14 || y === 1 || y === 14;
      const pattern = ((x * 17 + y * 31 + glyph.charCodeAt(0) + glyphIndex) % 7) === 0;
      bitmap[(y * 16) + x] = border || pattern ? 1 : 0;
    }
  }
  return bitmap;
}

function escapeFfmpegFilterValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:');
}

function escapeFfmpegDrawText(value) {
  return escapeFfmpegFilterValue(value)
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function renderGlyphBitmapWithFfmpeg(glyph, fontPath, config = {}) {
  if (glyph === ' ') return new Array(256).fill(0);
  const normalized = normalizeFontConfig(config);
  const filter = [
    `drawtext=fontfile='${escapeFfmpegFilterValue(fontPath)}'`,
    `text='${escapeFfmpegDrawText(glyph)}'`,
    'fontcolor=white',
    `fontsize=${normalized.fontSize}`,
    `x=(w-text_w)/2+${normalized.xOffset}`,
    `y=(h-text_h)/2+${normalized.yOffset}`,
  ].join(':');
  const proc = spawnSync('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=16x16',
    '-vf', filter,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-',
  ], { maxBuffer: 1024 * 64 });
  if (proc.error || proc.status !== 0 || !Buffer.isBuffer(proc.stdout) || proc.stdout.length < 256) {
    return null;
  }
  return Array.from(proc.stdout.subarray(0, 256), (value) => (value >= normalized.threshold ? 1 : 0));
}

function renderGlyphBitmapsWithFfmpeg(glyphs, config = {}) {
  const candidates = fontCandidates(config);
  if (!candidates.length) return null;
  for (const fontPath of candidates) {
    const bitmaps = [];
    let visibleGlyph = false;
    let ok = true;
    for (const glyph of glyphs) {
      const bitmap = renderGlyphBitmapWithFfmpeg(glyph, fontPath, config);
      if (!bitmap) {
        ok = false;
        break;
      }
      if (glyph !== ' ' && bitmap.some(Boolean)) visibleGlyph = true;
      bitmaps.push(bitmap);
    }
    if (ok && visibleGlyph) return { bitmaps, renderer: 'ffmpeg', fontPath };
  }
  return null;
}

function renderGlyphBitmapsWithPython(glyphs, config = {}) {
  const candidates = fontCandidates(config);
  const normalized = normalizeFontConfig(config);
  if (!candidates.length) return null;
  const script = String.raw`
import json, sys
try:
    from PIL import Image, ImageDraw, ImageFont
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
    raise SystemExit(0)

payload = json.load(sys.stdin)
font = None
font_path_used = ""
for font_path in payload.get("fontPaths", []):
    try:
        font = ImageFont.truetype(font_path, int(payload.get("fontSize", 15)))
        font_path_used = font_path
        break
    except Exception:
        pass
if font is None:
    print(json.dumps({"ok": False, "error": "font not found"}))
    raise SystemExit(0)

bitmaps = []
for glyph in payload.get("glyphs", []):
    img = Image.new("L", (16, 16), 0)
    if glyph != " ":
        draw = ImageDraw.Draw(img)
        bbox = draw.textbbox((0, 0), glyph, font=font)
        width = max(1, bbox[2] - bbox[0])
        height = max(1, bbox[3] - bbox[1])
        x = (16 - width) // 2 - bbox[0]
        y = (16 - height) // 2 - bbox[1]
        draw.text((x, y), glyph, fill=255, font=font)
    threshold = int(payload.get("threshold", 32))
    bitmaps.append([1 if value >= threshold else 0 for value in img.getdata()])
print(json.dumps({"ok": True, "bitmaps": bitmaps, "fontPath": font_path_used}, ensure_ascii=False))
`;
  const proc = spawnSync('python3', ['-c', script], {
    input: JSON.stringify({ glyphs, fontPaths: candidates, fontSize: normalized.fontSize, threshold: normalized.threshold }),
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 4,
  });
  if (proc.status !== 0 || !proc.stdout) return null;
  try {
    const parsed = JSON.parse(proc.stdout);
    if (parsed.ok && Array.isArray(parsed.bitmaps) && parsed.bitmaps.length === glyphs.length) {
      return { bitmaps: parsed.bitmaps, renderer: 'python', fontPath: parsed.fontPath || '' };
    }
  } catch (_) {}
  return null;
}

function encode8x8Tile(bitmap, offsetX, offsetY) {
  const lowPlanes = [];
  const highPlanes = [];
  for (let y = 0; y < 8; y += 1) {
    const planes = [0, 0, 0, 0];
    for (let x = 0; x < 8; x += 1) {
      const value = bitmap[((offsetY + y) * 16) + offsetX + x] ? 15 : 0;
      for (let plane = 0; plane < 4; plane += 1) {
        if (value & (1 << plane)) planes[plane] |= (1 << (7 - x));
      }
    }
    lowPlanes.push(planes[0], planes[1]);
    highPlanes.push(planes[2], planes[3]);
  }
  return lowPlanes.concat(highPlanes);
}

function encodeGlyphTileData(bitmaps) {
  const bytes = [];
  bitmaps.forEach((bitmap) => {
    bytes.push(...encode8x8Tile(bitmap, 0, 0));
    bytes.push(...encode8x8Tile(bitmap, 8, 0));
    bytes.push(...encode8x8Tile(bitmap, 0, 8));
    bytes.push(...encode8x8Tile(bitmap, 8, 8));
  });
  return Buffer.from(bytes);
}

function renderGlyphBitmaps(glyphs, config = {}) {
  return renderGlyphBitmapsWithFfmpeg(glyphs, config)
    || renderGlyphBitmapsWithPython(glyphs, config)
    || {
      bitmaps: glyphs.map((glyph, index) => fallbackGlyphBitmap(glyph, index)),
      renderer: 'fallback',
      fontPath: '',
    };
}

function renderGlyphTileData(glyphs, config = {}) {
  return encodeGlyphTileData(renderGlyphBitmaps(glyphs, config).bitmaps);
}

function toCIdentifier(value) {
  return String(value || 'vn')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^([0-9])/, '_$1') || 'vn';
}

function bytesToCArray(name, buffer, qualifier = 'static const unsigned char') {
  const lines = [`${qualifier} ${name}[] = {`];
  for (let i = 0; i < buffer.length; i += 14) {
    const chunk = Array.from(buffer.subarray(i, i + 14)).map((value) => `0x${value.toString(16).padStart(2, '0')}`);
    lines.push(`  ${chunk.join(', ')}${i + 14 < buffer.length ? ',' : ''}`);
  }
  lines.push('};');
  return lines;
}

function indexAssets(assets, type) {
  const map = new Map();
  assets.filter((asset) => asset.type === type).forEach((asset, index) => map.set(asset.id, index));
  return map;
}

function buildSpriteAnimationIndex(assetDoc = { assets: [] }, spriteIndex = new Map()) {
  const meta = [];
  const index = new Map();
  (assetDoc.assets || [])
    .filter((asset) => asset.type === 'sprite' && spriteIndex.has(asset.id))
    .forEach((asset) => {
      const options = asset.options || {};
      const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
      const cellWidth = clampPositiveInt(options.cellWidth ?? generated.cellWidth, 16, 32, 16);
      const cellHeight = clampPositiveInt(options.cellHeight ?? generated.cellHeight, 16, 64, 16);
      const generatedColumns = clampPositiveInt(generated.cellColumns ?? generated.columns, 1, 64, 0);
      const generatedRows = clampPositiveInt(generated.cellRows ?? generated.rows, 1, 64, 0);
      const generatedWidth = clampPositiveInt(generated.width, cellWidth, 1024, generatedColumns ? generatedColumns * cellWidth : 0);
      const generatedHeight = clampPositiveInt(generated.height, cellHeight, 1024, generatedRows ? generatedRows * cellHeight : 0);
      const width = clampPositiveInt(options.width, cellWidth, 1024, generatedWidth || cellWidth);
      const height = clampPositiveInt(options.height, cellHeight, 1024, generatedHeight || cellHeight);
      const defaultAnimation = {
        id: 'default',
        frameWidth: width,
        frameHeight: height,
        firstCell: 0,
        frameCount: 1,
        frameDelay: 8,
        frameStrideCells: Math.max(1, Math.ceil(width / cellWidth) * Math.ceil(height / cellHeight)),
        loop: true,
      };
      let animations = Array.isArray(options.animations) && options.animations.length ? options.animations : [defaultAnimation];
      if (animations.length === 1) {
        const only = animations[0] && typeof animations[0] === 'object' ? animations[0] : {};
        const onlyId = String(only.id || 'default').trim() || 'default';
        const looksLikeLegacyDefault = onlyId === 'default'
          && width > cellWidth
          && height > cellHeight
          && clampPositiveInt(only.frameWidth, 1, 1024, 0) <= cellWidth
          && clampPositiveInt(only.frameHeight, 1, 1024, 0) <= cellHeight
          && clampPositiveInt(only.frameStrideCells, 1, 255, 0) <= 1;
        if (looksLikeLegacyDefault) {
          animations = [{
            ...only,
            frameWidth: width,
            frameHeight: height,
            frameStrideCells: defaultAnimation.frameStrideCells,
          }];
        }
      }
      animations.forEach((animation) => {
        const animId = String(animation.id || 'default').trim() || 'default';
        const frameWidth = clampPositiveInt(animation.frameWidth, cellWidth, 256, width);
        const frameHeight = clampPositiveInt(animation.frameHeight, cellHeight, 256, height);
        const frameWidthCells = Math.max(1, Math.ceil(frameWidth / cellWidth));
        const frameHeightCells = Math.max(1, Math.ceil(frameHeight / cellHeight));
        const animIndex = meta.length;
        index.set(`${asset.id}:${animId}`, animIndex);
        if (animId === 'default' && !index.has(`${asset.id}:`)) index.set(`${asset.id}:`, animIndex);
        meta.push({
          spriteIndex: spriteIndex.get(asset.id),
          firstCell: clampInt(animation.firstCell, 0, 255, 0),
          frameCount: clampInt(animation.frameCount, 1, 64, 1),
          frameDelay: clampInt(animation.frameDelay, 1, 60, 8),
          frameWidthCells: clampInt(frameWidthCells, 1, 16, 1),
          frameHeightCells: clampInt(frameHeightCells, 1, 16, 1),
          frameStrideCells: clampPositiveInt(animation.frameStrideCells, 1, 255, frameWidthCells * frameHeightCells),
          loop: animation.loop !== false,
        });
      });
    });
  return { index, meta };
}

function collectVariableDefinitions(doc = {}) {
  const index = new Map();
  const initialValues = [];
  const defined = new Set();
  const add = (name, initialValue = 0, isDefinition = false) => {
    const key = normalizeVariableName(name || '');
    if (!index.has(key)) {
      index.set(key, index.size);
      initialValues.push(0);
    }
    if (isDefinition && !defined.has(key)) {
      initialValues[index.get(key)] = clampSignedInt(initialValue, 0);
      defined.add(key);
    }
  };
  (doc.scenes || []).forEach((scene) => {
    (scene.commands || []).forEach((command) => {
      if (command.type === 'variable') {
        add(command.variableName, command.value, command.operation === 'define');
      } else if (command.type === 'choice' && command.variableName) {
        add(command.variableName);
      } else if ((command.type === 'if' || command.type === 'switch') && command.variableName) {
        add(command.variableName);
      }
    });
  });
  return { index, initialValues };
}

function int16Literal(value) {
  return String(clampSignedInt(value, 0));
}

function uint16Value(value) {
  return clampSignedInt(value, 0) & 0xffff;
}

function int16ArgBytes(value) {
  const encoded = uint16Value(value);
  return [encoded & 0xff, (encoded >> 8) & 0xff];
}

function varOperationCode(operation) {
  if (operation === 'define') return VN_VAR_OP_DEFINE;
  if (operation === 'add') return VN_VAR_OP_ADD;
  if (operation === 'sub') return VN_VAR_OP_SUB;
  if (operation === 'random') return VN_VAR_OP_RANDOM;
  return VN_VAR_OP_SET;
}

function compareCode(operator) {
  if (operator === 'ne') return VN_COMPARE_NE;
  if (operator === 'lt') return VN_COMPARE_LT;
  if (operator === 'lte') return VN_COMPARE_LTE;
  if (operator === 'gt') return VN_COMPARE_GT;
  if (operator === 'gte') return VN_COMPARE_GTE;
  return VN_COMPARE_EQ;
}

function commandEntry(type, {
  assetIndex = -1,
  slot = 0,
  flags = 0,
  arg0 = 0,
  arg1 = 0,
  x = 0,
  y = 0,
  messageIndex = -1,
  animationIndex = -1,
  sceneIndex = -1,
  choiceIndex = -1,
} = {}) {
  return `  { ${type}u, ${assetIndex}, ${slot}u, ${flags}u, ${arg0}u, ${arg1}u, ${x}u, ${y}u, ${messageIndex}, ${animationIndex}, ${sceneIndex}, ${choiceIndex} }`;
}

function scenePackRelativePath(scene = {}, index = 0) {
  const ordinal = String(index).padStart(3, '0');
  const sceneId = toCIdentifier(scene.id || `scene_${index}`);
  return normalizeRelativePath(path.join(VN_SCENE_PACK_DIR, `${ordinal}_${sceneId}.bin`));
}

function pushU8(bytes, value) {
  bytes.push(clampInt(value, 0, 255, 0) & 0xff);
}

function pushU16(bytes, value) {
  const encoded = clampInt(value, 0, 0xffff, 0) & 0xffff;
  bytes.push(encoded & 0xff, (encoded >> 8) & 0xff);
}

function pushS16(bytes, value) {
  const encoded = clampSignedInt(value, 0) & 0xffff;
  bytes.push(encoded & 0xff, (encoded >> 8) & 0xff);
}

function appendPackData(chunks, state, buffer) {
  const chunk = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const offset = state.offset;
  state.offset += chunk.length;
  chunks.push(chunk);
  return offset;
}

function encodeCommandRecord(command = {}) {
  const bytes = [];
  pushU8(bytes, command.type);
  pushS16(bytes, command.assetIndex);
  pushU8(bytes, command.slot);
  pushU8(bytes, command.flags);
  pushU8(bytes, command.arg0);
  pushU8(bytes, command.arg1);
  pushU16(bytes, command.x);
  pushU16(bytes, command.y);
  pushS16(bytes, command.messageIndex);
  pushS16(bytes, command.animationIndex);
  pushS16(bytes, command.sceneIndex);
  pushS16(bytes, command.choiceIndex);
  return Buffer.from(bytes);
}

function encodeMessageRecord(message = {}) {
  const bytes = [];
  pushU16(bytes, message.glyphOffset);
  pushU8(bytes, message.glyphCount);
  pushS16(bytes, message.voiceIndex);
  pushU8(bytes, message.textSpeedFrames);
  pushU8(bytes, message.advanceMode);
  pushU8(bytes, message.autoWaitFrames);
  pushS16(bytes, message.mouthAnimationIndex);
  pushU8(bytes, message.mouthSlot);
  return Buffer.from(bytes);
}

function encodeChoiceRecord(choice = {}) {
  const bytes = [];
  pushU16(bytes, choice.optionOffset);
  pushU8(bytes, choice.optionCount);
  pushU8(bytes, choice.defaultIndex);
  pushS16(bytes, choice.variableIndex);
  return Buffer.from(bytes);
}

function encodeChoiceOptionRecord(option = {}) {
  const bytes = [];
  pushU16(bytes, option.glyphOffset);
  pushU8(bytes, option.glyphCount);
  pushS16(bytes, option.value);
  pushS16(bytes, option.targetScene);
  return Buffer.from(bytes);
}

function encodeSwitchRecord(branch = {}) {
  const bytes = [];
  pushU16(bytes, branch.caseOffset);
  pushU8(bytes, branch.caseCount);
  pushU16(bytes, branch.defaultCommand);
  return Buffer.from(bytes);
}

function encodeSwitchCaseRecord(branchCase = {}) {
  const bytes = [];
  pushS16(bytes, branchCase.value);
  pushU16(bytes, branchCase.command);
  return Buffer.from(bytes);
}

function buildScenePack(sceneBuild) {
  const commands = sceneBuild.commands || [];
  const messages = sceneBuild.messages || [];
  const choices = sceneBuild.choices || [];
  const switches = sceneBuild.switches || [];
  const commandOffset = VN_SCENE_PACK_HEADER_SIZE;
  const messageOffset = commandOffset + (commands.length * VN_SCENE_PACK_COMMAND_SIZE);
  const choiceOffset = messageOffset + (messages.length * VN_SCENE_PACK_MESSAGE_SIZE);
  const switchOffset = choiceOffset + (choices.length * VN_SCENE_PACK_CHOICE_SIZE);
  const dataOffset = switchOffset + (switches.length * VN_SCENE_PACK_SWITCH_SIZE);
  const dataChunks = [];
  const state = { offset: dataOffset };

  messages.forEach((message) => {
    message.glyphOffset = appendPackData(dataChunks, state, message.glyphs);
  });
  choices.forEach((choice) => {
    const optionRecords = [];
    choice.options.forEach((option) => {
      option.glyphOffset = appendPackData(dataChunks, state, option.glyphs);
      optionRecords.push(encodeChoiceOptionRecord(option));
    });
    choice.optionOffset = optionRecords.length
      ? appendPackData(dataChunks, state, Buffer.concat(optionRecords))
      : 0;
  });
  switches.forEach((branch) => {
    const caseRecords = branch.cases.map((branchCase) => encodeSwitchCaseRecord(branchCase));
    branch.caseOffset = caseRecords.length
      ? appendPackData(dataChunks, state, Buffer.concat(caseRecords))
      : 0;
  });

  const header = Buffer.alloc(VN_SCENE_PACK_HEADER_SIZE);
  VN_SCENE_PACK_MAGIC.copy(header, 0);
  header.writeUInt8(VN_SCENE_PACK_VERSION, 4);
  header.writeUInt8(commands.length, 5);
  header.writeUInt8(messages.length, 6);
  header.writeUInt8(choices.length, 7);
  header.writeUInt8(switches.length, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(commandOffset, 10);
  header.writeUInt16LE(messageOffset, 12);
  header.writeUInt16LE(choiceOffset, 14);
  header.writeUInt16LE(switchOffset, 16);
  header.writeUInt16LE(dataOffset, 18);

  const pack = Buffer.concat([
    header,
    ...commands.map((command) => encodeCommandRecord(command)),
    ...messages.map((message) => encodeMessageRecord(message)),
    ...choices.map((choice) => encodeChoiceRecord(choice)),
    ...switches.map((branch) => encodeSwitchRecord(branch)),
    ...dataChunks,
  ]);
  if (pack.length > VN_SCENE_PACK_CACHE_BYTES) {
    throw new Error(`PCE VN scene pack "${sceneBuild.sceneId}" is ${pack.length} bytes; split the scene to stay within ${VN_SCENE_PACK_CACHE_BYTES} bytes`);
  }
  return pack;
}

function writeScenePack(projectDir, sceneBuild) {
  const relativePath = sceneBuild.packPath;
  const absPath = path.join(projectDir, relativePath);
  ensureDirSync(path.dirname(absPath));
  fs.writeFileSync(absPath, sceneBuild.packBuffer);
  return relativePath;
}

function cdLayoutForFiles(projectDir, dataFiles = []) {
  return typeof assetManager.buildCdDataLayout === 'function'
    ? assetManager.buildCdDataLayout(projectDir, dataFiles)
    : new Map();
}

function cdSectorInitializer(layoutEntry = {}) {
  const sector = Math.max(0, Math.trunc(Number(layoutEntry.sector) || 0));
  return `{ ${sector & 0xff}u, ${(sector >> 8) & 0xff}u, ${(sector >> 16) & 0xff}u }`;
}

function generateVnSources(projectDir, options = {}) {
  const assetDoc = assetManager.readAssetDocument(projectDir);
  const doc = writeSceneDocument(projectDir, readSceneDocument(projectDir));
  if ((doc.scenes || []).length > VN_MAX_U8_COUNT) {
    throw new Error(`PCE VN supports up to ${VN_MAX_U8_COUNT} scenes`);
  }
  const rawGlyphs = collectGlyphsRaw(doc);
  const glyphs = rawGlyphs.slice(0, VN_MAX_GLYPH_COUNT);
  const glyphIndex = new Map(glyphs.map((glyph, index) => [glyph, index]));
  const fontConfig = normalizeFontConfig({
    ...readFontConfig(projectDir),
    ...(options.fontConfig || {}),
    tileBase: options.fontTileBase || options.fontConfig?.tileBase || readFontConfig(projectDir).tileBase,
  });
  const fontTileBase = Number(fontConfig.tileBase || DEFAULT_FONT_TILE_BASE);
  const fontBudget = computeFontBudget(rawGlyphs.length, fontTileBase);
  if (fontBudget.errors.length) {
    throw new Error(fontBudget.errors.join(' '));
  }
  const fontRender = renderGlyphBitmaps(glyphs, fontConfig);
  const fontTiles = encodeGlyphTileData(fontRender.bitmaps);
  // Font tiles live on the CD as a streamed data file, not in ram_bank132.
  const fontDataPath = normalizeRelativePath(VN_FONT_DATA_FILE);
  const fontDataAbsPath = path.join(projectDir, fontDataPath);
  ensureDirSync(path.dirname(fontDataAbsPath));
  fs.writeFileSync(fontDataAbsPath, fontTiles);
  const imageIndex = indexAssets(assetDoc.assets || [], 'image');
  const spriteIndex = indexAssets(assetDoc.assets || [], 'sprite');
  const adpcmIndex = indexAssets(assetDoc.assets || [], 'adpcm');
  const cddaIndex = indexAssets(assetDoc.assets || [], 'cdda-track');
  const spriteAnimations = buildSpriteAnimationIndex(assetDoc, spriteIndex);
  if (spriteAnimations.meta.length > VN_MAX_U8_COUNT) {
    throw new Error(`PCE VN supports up to ${VN_MAX_U8_COUNT} sprite animations`);
  }
  const sceneIndex = new Map(doc.scenes.map((scene, index) => [scene.id, index]));
  const variables = collectVariableDefinitions(doc);
  if (variables.initialValues.length > VN_MAX_U8_COUNT) {
    throw new Error(`PCE VN supports up to ${VN_MAX_U8_COUNT} variables`);
  }
  const variableIndex = variables.index;
  const generatedDir = path.join(projectDir, 'src', 'generated');
  ensureDirSync(generatedDir);
  const sceneBuilds = [];
  let messageCount = 0;
  let choiceCount = 0;
  let switchCount = 0;
  let commandCount = 0;

  doc.scenes.forEach((scene, sceneIdx) => {
    const sceneBuild = {
      sceneId: scene.id || `scene_${sceneIdx}`,
      packPath: scenePackRelativePath(scene, sceneIdx),
      nextScene: scene.nextSceneId && sceneIndex.has(scene.nextSceneId) ? sceneIndex.get(scene.nextSceneId) : -1,
      commands: [],
      messages: [],
      choices: [],
      switches: [],
    };
    const slotSpriteAssets = ['', '', '', ''];
    const labels = new Map();
    (scene.commands || []).forEach((command, commandIndex) => {
      if (command.type === 'label' && command.name && !labels.has(command.name)) {
        labels.set(command.name, commandIndex);
      }
    });
    const labelCommand = (name) => (name && labels.has(name) ? labels.get(name) : VN_NO_COMMAND);
    const pushCommand = (entry) => {
      if (sceneBuild.commands.length >= VN_MAX_U8_COUNT) {
        throw new Error('PCE VN supports up to 255 commands per scene');
      }
      sceneBuild.commands.push(entry);
      commandCount += 1;
    };
    (scene.commands || []).forEach((command) => {
      if (command.type === 'background') {
        const bgIndex = imageIndex.has(command.assetId) ? imageIndex.get(command.assetId) : -1;
        pushCommand({
          type: VN_COMMAND_BACKGROUND,
          assetIndex: bgIndex,
          flags: command.transition === 'fade' ? VN_BG_TRANSITION_FADE : VN_BG_TRANSITION_CUT,
          arg0: command.fadeOutFrames,
          arg1: command.fadeInFrames,
          x: command.x,
          y: command.y,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'sprite') {
        const slot = clampInt(command.slot, 0, 3, 0);
        const spriteAssetId = command.assetId || '';
        const spriteAssetIndex = command.visible && spriteIndex.has(spriteAssetId) ? spriteIndex.get(spriteAssetId) : -1;
        const animationIndex = spriteAssetIndex >= 0
          ? (spriteAnimations.index.get(`${spriteAssetId}:${command.animationId || 'default'}`) ?? spriteAnimations.index.get(`${spriteAssetId}:default`) ?? -1)
          : -1;
        const flags = (command.visible ? VN_SPRITE_VISIBLE : 0)
          | (command.flipX ? VN_SPRITE_FLIP_X : 0)
          | (command.flipY ? VN_SPRITE_FLIP_Y : 0);
        slotSpriteAssets[slot] = spriteAssetIndex >= 0 ? spriteAssetId : '';
        pushCommand({
          type: VN_COMMAND_SPRITE,
          assetIndex: spriteAssetIndex,
          slot,
          flags,
          arg0: command.durationFrames,
          arg1: 0,
          x: command.x,
          y: command.y,
          animationIndex,
          messageIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'message') {
        if (sceneBuild.messages.length >= VN_MAX_U8_COUNT) {
          throw new Error('PCE VN supports up to 255 messages per scene');
        }
        const bytes = [];
        for (const glyph of messageDisplayText(command)) {
          if (glyph === '\r') continue;
          if (glyph === '\n') {
            bytes.push(GLYPH_NEWLINE);
            continue;
          }
          bytes.push(glyphIndex.get(glyph) ?? 0);
        }
        if (bytes.length > VN_MAX_U8_COUNT) {
          throw new Error(`PCE VN message in scene "${sceneBuild.sceneId}" exceeds 255 glyphs`);
        }
        bytes.push(GLYPH_END);
        const mouthSlot = clampInt(command.mouthSlot, 0, 3, 0);
        const mouthSpriteId = slotSpriteAssets[mouthSlot] || '';
        const mouthAnimationIndex = command.mouthAnimationId && mouthSpriteId
          ? (spriteAnimations.index.get(`${mouthSpriteId}:${command.mouthAnimationId}`) ?? -1)
          : -1;
        const voiceIndex = command.voiceAssetId && adpcmIndex.has(command.voiceAssetId)
          ? adpcmIndex.get(command.voiceAssetId)
          : -1;
        const messageIndex = sceneBuild.messages.length;
        sceneBuild.messages.push({
          glyphs: Buffer.from(bytes),
          glyphCount: Math.max(0, bytes.length - 1),
          voiceIndex,
          textSpeedFrames: command.textSpeedFrames,
          advanceMode: command.advanceMode === 'auto' ? VN_ADVANCE_AUTO : VN_ADVANCE_BUTTON,
          autoWaitFrames: command.autoWaitFrames,
          mouthAnimationIndex,
          mouthSlot,
        });
        pushCommand({
          type: VN_COMMAND_MESSAGE,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        messageCount += 1;
        return;
      }
      if (command.type === 'audio') {
        const isAdpcm = command.kind === 'adpcm';
        const action = command.action === 'stop' ? VN_AUDIO_ACTION_STOP : VN_AUDIO_ACTION_PLAY;
        const assetIndex = command.action === 'play'
          ? (isAdpcm ? (adpcmIndex.get(command.assetId) ?? -1) : (cddaIndex.get(command.assetId) ?? -1))
          : -1;
        const flags = (isAdpcm ? VN_AUDIO_KIND_ADPCM : VN_AUDIO_KIND_CDDA) | action;
        pushCommand({
          type: VN_COMMAND_AUDIO,
          assetIndex,
          slot: 0,
          flags,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'preload') {
        const target = command.sceneId && sceneIndex.has(command.sceneId) ? sceneIndex.get(command.sceneId) : -1;
        pushCommand({
          type: VN_COMMAND_PRELOAD,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: target,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'choice') {
        if (sceneBuild.choices.length >= VN_MAX_U8_COUNT) {
          throw new Error('PCE VN supports up to 255 choices per scene');
        }
        const options = (command.choices || []).slice(0, 4);
        const encodedOptions = options.map((option) => {
          const bytes = [];
          for (const glyph of String(option.label || '')) {
            bytes.push(glyphIndex.get(glyph) ?? 0);
          }
          if (bytes.length > VN_MAX_U8_COUNT) {
            throw new Error(`PCE VN choice label in scene "${sceneBuild.sceneId}" exceeds 255 glyphs`);
          }
          bytes.push(GLYPH_END);
          const target = option.targetSceneId && sceneIndex.has(option.targetSceneId) ? sceneIndex.get(option.targetSceneId) : -1;
          return {
            glyphs: Buffer.from(bytes),
            glyphCount: Math.max(0, bytes.length - 1),
            value: option.value,
            targetScene: target,
          };
        });
        const resultVariable = command.variableName && variableIndex.has(command.variableName)
          ? variableIndex.get(command.variableName)
          : -1;
        const choiceIndex = sceneBuild.choices.length;
        sceneBuild.choices.push({
          options: encodedOptions,
          optionCount: encodedOptions.length,
          defaultIndex: clampInt(command.defaultIndex, 0, Math.max(0, encodedOptions.length - 1), 0),
          variableIndex: resultVariable,
        });
        pushCommand({
          type: VN_COMMAND_CHOICE,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex,
        });
        choiceCount += 1;
        return;
      }
      if (command.type === 'variable') {
        const varIndex = command.variableName && variableIndex.has(command.variableName) ? variableIndex.get(command.variableName) : -1;
        const [arg0, arg1] = int16ArgBytes(command.value);
        pushCommand({
          type: VN_COMMAND_VARIABLE,
          assetIndex: varIndex,
          slot: 0,
          flags: varOperationCode(command.operation),
          arg0,
          arg1,
          x: command.operation === 'random' ? uint16Value(command.min) : 0,
          y: command.operation === 'random' ? uint16Value(command.max) : 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'if') {
        const varIndex = command.variableName && variableIndex.has(command.variableName) ? variableIndex.get(command.variableName) : -1;
        const [arg0, arg1] = int16ArgBytes(command.value);
        pushCommand({
          type: VN_COMMAND_IF,
          assetIndex: varIndex,
          slot: 0,
          flags: compareCode(command.operator),
          arg0,
          arg1,
          x: labelCommand(command.targetLabel),
          y: labelCommand(command.elseLabel),
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'switch') {
        if (sceneBuild.switches.length >= VN_MAX_U8_COUNT) {
          throw new Error('PCE VN supports up to 255 switch commands per scene');
        }
        const cases = (command.cases || []).slice(0, 16);
        const switchIndex = sceneBuild.switches.length;
        sceneBuild.switches.push({
          cases: cases.map((branch) => ({
            value: branch.value,
            command: labelCommand(branch.targetLabel),
          })),
          caseCount: cases.length,
          defaultCommand: labelCommand(command.defaultLabel),
        });
        const varIndex = command.variableName && variableIndex.has(command.variableName) ? variableIndex.get(command.variableName) : -1;
        pushCommand({
          type: VN_COMMAND_SWITCH,
          assetIndex: varIndex,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: switchIndex,
        });
        switchCount += 1;
        return;
      }
      if (command.type === 'label') {
        pushCommand({
          type: VN_COMMAND_LABEL,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'goto') {
        pushCommand({
          type: VN_COMMAND_GOTO,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: labelCommand(command.targetLabel),
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'jump') {
        const target = command.sceneId && sceneIndex.has(command.sceneId) ? sceneIndex.get(command.sceneId) : -1;
        pushCommand({
          type: VN_COMMAND_JUMP,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: 0,
          arg1: 0,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: target,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'wait') {
        const frames = clampInt(command.frames, 0, 65535, 30);
        pushCommand({
          type: VN_COMMAND_WAIT,
          assetIndex: -1,
          slot: 0,
          flags: 0,
          arg0: frames & 0xff,
          arg1: (frames >> 8) & 0xff,
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        return;
      }
      if (command.type === 'effect') {
        const effect = command.effect === 'fadeIn'
          ? VN_EFFECT_FADE_IN
          : (command.effect === 'blank' ? VN_EFFECT_BLANK : (command.effect === 'shake' ? VN_EFFECT_SHAKE : VN_EFFECT_FADE_OUT));
        pushCommand({
          type: VN_COMMAND_EFFECT,
          assetIndex: -1,
          slot: 0,
          flags: effect,
          arg0: clampInt(command.frames, 0, 255, 16),
          arg1: clampInt(command.intensity, 0, 16, 0),
          x: 0,
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
      }
    });
    sceneBuild.packBuffer = buildScenePack(sceneBuild);
    writeScenePack(projectDir, sceneBuild);
    sceneBuilds.push(sceneBuild);
  });

  const animationMeta = spriteAnimations.meta.map((animation, index) => (
    `  { ${animation.spriteIndex}u, ${animation.firstCell}u, ${animation.frameCount}u, ${animation.frameDelay}u, ${animation.frameWidthCells}u, ${animation.frameHeightCells}u, ${animation.frameStrideCells}u, ${animation.loop ? '1u' : '0u'} }${index + 1 < spriteAnimations.meta.length ? ',' : ''}`
  ));
  const cdDataFiles = Array.isArray(options.cdDataFiles)
    ? options.cdDataFiles.map((entry) => normalizeRelativePath(entry || '')).filter(Boolean)
    : collectCdDataFiles(projectDir);
  const cdLayout = cdLayoutForFiles(projectDir, cdDataFiles);
  const fontLayout = cdLayout.get(fontDataPath) || {};
  const fontSectorCount = fontLayout.sectorCount || fontBudget.sectorCount;
  const fontDataInitializer = `{ ${cdSectorInitializer(fontLayout)}, ${fontSectorCount}u, ${fontBudget.byteSize}u }`;
  const scenePackMeta = sceneBuilds.map((sceneBuild, index) => {
    const layout = cdLayout.get(sceneBuild.packPath) || {};
    const sectorCount = layout.sectorCount || Math.max(1, Math.ceil(sceneBuild.packBuffer.length / VN_CD_SECTOR_BYTES));
    return `  { ${cdSectorInitializer(layout)}, ${sectorCount}u, ${sceneBuild.packBuffer.length}u, ${sceneBuild.nextScene} }${index + 1 < sceneBuilds.length ? ',' : ''}`;
  });

  const headerPath = path.join(generatedDir, 'vn.h');
  const sourcePath = path.join(generatedDir, 'vn.c');
  const header = [
    '#ifndef PCE_EDITOR_GENERATED_VN_H',
    '#define PCE_EDITOR_GENERATED_VN_H',
    '',
    `#define PCE_VN_COMMAND_BACKGROUND ${VN_COMMAND_BACKGROUND}u`,
    `#define PCE_VN_COMMAND_SPRITE ${VN_COMMAND_SPRITE}u`,
    `#define PCE_VN_COMMAND_MESSAGE ${VN_COMMAND_MESSAGE}u`,
    `#define PCE_VN_COMMAND_AUDIO ${VN_COMMAND_AUDIO}u`,
    `#define PCE_VN_COMMAND_PRELOAD ${VN_COMMAND_PRELOAD}u`,
    `#define PCE_VN_COMMAND_CHOICE ${VN_COMMAND_CHOICE}u`,
    `#define PCE_VN_COMMAND_JUMP ${VN_COMMAND_JUMP}u`,
    `#define PCE_VN_COMMAND_WAIT ${VN_COMMAND_WAIT}u`,
    `#define PCE_VN_COMMAND_EFFECT ${VN_COMMAND_EFFECT}u`,
    `#define PCE_VN_COMMAND_VARIABLE ${VN_COMMAND_VARIABLE}u`,
    `#define PCE_VN_COMMAND_IF ${VN_COMMAND_IF}u`,
    `#define PCE_VN_COMMAND_SWITCH ${VN_COMMAND_SWITCH}u`,
    `#define PCE_VN_COMMAND_LABEL ${VN_COMMAND_LABEL}u`,
    `#define PCE_VN_COMMAND_GOTO ${VN_COMMAND_GOTO}u`,
    `#define PCE_VN_BG_TRANSITION_CUT ${VN_BG_TRANSITION_CUT}u`,
    `#define PCE_VN_BG_TRANSITION_FADE ${VN_BG_TRANSITION_FADE}u`,
    `#define PCE_VN_SPRITE_VISIBLE ${VN_SPRITE_VISIBLE}u`,
    `#define PCE_VN_SPRITE_FLIP_X ${VN_SPRITE_FLIP_X}u`,
    `#define PCE_VN_SPRITE_FLIP_Y ${VN_SPRITE_FLIP_Y}u`,
    `#define PCE_VN_AUDIO_KIND_ADPCM ${VN_AUDIO_KIND_ADPCM}u`,
    `#define PCE_VN_AUDIO_KIND_CDDA ${VN_AUDIO_KIND_CDDA}u`,
    `#define PCE_VN_AUDIO_ACTION_PLAY ${VN_AUDIO_ACTION_PLAY}u`,
    `#define PCE_VN_AUDIO_ACTION_STOP ${VN_AUDIO_ACTION_STOP}u`,
    `#define PCE_VN_EFFECT_FADE_OUT ${VN_EFFECT_FADE_OUT}u`,
    `#define PCE_VN_EFFECT_FADE_IN ${VN_EFFECT_FADE_IN}u`,
    `#define PCE_VN_EFFECT_BLANK ${VN_EFFECT_BLANK}u`,
    `#define PCE_VN_EFFECT_SHAKE ${VN_EFFECT_SHAKE}u`,
    `#define PCE_VN_ADVANCE_BUTTON ${VN_ADVANCE_BUTTON}u`,
    `#define PCE_VN_ADVANCE_AUTO ${VN_ADVANCE_AUTO}u`,
    `#define PCE_VN_VAR_OP_DEFINE ${VN_VAR_OP_DEFINE}u`,
    `#define PCE_VN_VAR_OP_SET ${VN_VAR_OP_SET}u`,
    `#define PCE_VN_VAR_OP_ADD ${VN_VAR_OP_ADD}u`,
    `#define PCE_VN_VAR_OP_SUB ${VN_VAR_OP_SUB}u`,
    `#define PCE_VN_VAR_OP_RANDOM ${VN_VAR_OP_RANDOM}u`,
    `#define PCE_VN_COMPARE_EQ ${VN_COMPARE_EQ}u`,
    `#define PCE_VN_COMPARE_NE ${VN_COMPARE_NE}u`,
    `#define PCE_VN_COMPARE_LT ${VN_COMPARE_LT}u`,
    `#define PCE_VN_COMPARE_LTE ${VN_COMPARE_LTE}u`,
    `#define PCE_VN_COMPARE_GT ${VN_COMPARE_GT}u`,
    `#define PCE_VN_COMPARE_GTE ${VN_COMPARE_GTE}u`,
    `#define PCE_VN_NO_COMMAND ${VN_NO_COMMAND}u`,
    `#define PCE_VN_VARIABLE_STORAGE_COUNT ${Math.max(1, variables.initialValues.length)}u`,
    `#define PCE_VN_SCENE_PACK_CACHE_BYTES ${VN_SCENE_PACK_CACHE_BYTES}u`,
    `#define PCE_VN_SCENE_PACK_VERSION ${VN_SCENE_PACK_VERSION}u`,
    `#define PCE_VN_SCENE_PACK_HEADER_SIZE ${VN_SCENE_PACK_HEADER_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_COMMAND_SIZE ${VN_SCENE_PACK_COMMAND_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_MESSAGE_SIZE ${VN_SCENE_PACK_MESSAGE_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_CHOICE_SIZE ${VN_SCENE_PACK_CHOICE_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_OPTION_SIZE ${VN_SCENE_PACK_OPTION_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_SWITCH_SIZE ${VN_SCENE_PACK_SWITCH_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE ${VN_SCENE_PACK_SWITCH_CASE_SIZE}u`,
    '',
    'typedef struct {',
    '  unsigned char sprite_index;',
    '  unsigned char first_cell;',
    '  unsigned char frame_count;',
    '  unsigned char frame_delay;',
    '  unsigned char frame_width_cells;',
    '  unsigned char frame_height_cells;',
    '  unsigned char frame_stride_cells;',
    '  unsigned char loop;',
    '} pce_vn_sprite_anim_t;',
    '',
    'typedef struct {',
    '  const unsigned char *glyphs;',
    '  unsigned char glyph_count;',
    '  signed int voice_index;',
    '  unsigned char text_speed_frames;',
    '  unsigned char advance_mode;',
    '  unsigned char auto_wait_frames;',
    '  signed int mouth_animation_index;',
    '  unsigned char mouth_slot;',
    '} pce_vn_message_t;',
    '',
    'typedef struct {',
    '  const unsigned char *glyphs;',
    '  unsigned char glyph_count;',
    '  signed int value;',
    '  signed int target_scene;',
    '} pce_vn_choice_option_t;',
    '',
    'typedef struct {',
    '  unsigned int options_offset;',
    '  unsigned char option_count;',
    '  unsigned char default_index;',
    '  signed int variable_index;',
    '} pce_vn_choice_t;',
    '',
    'typedef struct {',
    '  signed int value;',
    '  unsigned int command;',
    '} pce_vn_switch_case_t;',
    '',
    'typedef struct {',
    '  unsigned int cases_offset;',
    '  unsigned char case_count;',
    '  unsigned int default_command;',
    '} pce_vn_switch_t;',
    '',
    'typedef struct {',
    '  unsigned char type;',
    '  signed int asset_index;',
    '  unsigned char slot;',
    '  unsigned char flags;',
    '  unsigned char arg0;',
    '  unsigned char arg1;',
    '  unsigned int x;',
    '  unsigned int y;',
    '  signed int message_index;',
    '  signed int animation_index;',
    '  signed int scene_index;',
    '  signed int choice_index;',
    '} pce_vn_command_t;',
    '',
    'typedef struct {',
    '  unsigned char lo;',
    '  unsigned char md;',
    '  unsigned char hi;',
    '} pce_vn_cd_sector_t;',
    '',
    'typedef struct {',
    '  pce_vn_cd_sector_t sector;',
    '  unsigned int sector_count;',
    '  unsigned int byte_size;',
    '} pce_vn_cd_data_ref_t;',
    '',
    'typedef struct {',
    '  pce_vn_cd_sector_t sector;',
    '  unsigned int sector_count;',
    '  unsigned int byte_size;',
    '  signed int next_scene;',
    '} pce_vn_scene_pack_t;',
    '',
    `#define PCE_VN_FONT_TILE_BASE ${Number(fontConfig.tileBase || DEFAULT_FONT_TILE_BASE)}u`,
    `#define PCE_VN_CHOICE_CURSOR_GLYPH ${glyphIndex.get('>') ?? 0}u`,
    '#define PCE_VN_GLYPH_END 0xffu',
    '#define PCE_VN_GLYPH_NEWLINE 0xfeu',
    '',
    '#if defined(__PCE_CD__)',
    'extern const pce_vn_cd_data_ref_t pce_vn_font_data;',
    '#else',
    'extern const unsigned char pce_vn_font_tiles[];',
    '#endif',
    'extern const unsigned char pce_vn_font_glyph_count;',
    'void pce_vn_font_tiles_map(void);',
    'extern const pce_vn_sprite_anim_t pce_vn_sprite_animations[];',
    'extern const unsigned char pce_vn_sprite_animation_count;',
    'extern const signed int pce_vn_variable_initial_values[];',
    'extern const unsigned char pce_vn_variable_count;',
    'extern const pce_vn_scene_pack_t pce_vn_scene_packs[];',
    'extern const unsigned char pce_vn_scene_count;',
    'extern const unsigned char pce_vn_start_scene;',
    '',
    '#endif',
    '',
  ];
  const startScene = sceneIndex.get(doc.startScene) || 0;
  const source = [
    '#if defined(__PCE_CD__)',
    '#include <pce-cd.h>',
    'PCE_RAM_BANK_AT(132, 6);',
    '#define PCE_VN_FONT_SECTION __attribute__((section(".ram_bank132")))',
    '#define PCE_VN_DATA_SECTION __attribute__((section(".ram_bank132")))',
    '#else',
    '#define PCE_VN_FONT_SECTION',
    '#define PCE_VN_DATA_SECTION',
    '#endif',
    '',
    '#include "vn.h"',
    '',
    '#if defined(__PCE_CD__)',
    `const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_font_data = ${fontDataInitializer};`,
    '#else',
    ...bytesToCArray('PCE_VN_FONT_SECTION pce_vn_font_tiles', fontTiles, 'const unsigned char'),
    '#endif',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_font_glyph_count = ${glyphs.length};`,
    '',
    'void pce_vn_font_tiles_map(void)',
    '{',
    '#if defined(__PCE_CD__)',
    '  pce_ram_bank132_map();',
    '#endif',
    '}',
    '',
    'const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations[] = {',
    ...(animationMeta.length ? animationMeta : ['  { 0u, 0u, 1u, 8u, 1u, 1u, 1u, 1u }']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = ${spriteAnimations.meta.length};`,
    '',
    'const signed int PCE_VN_DATA_SECTION pce_vn_variable_initial_values[] = {',
    ...(variables.initialValues.length
      ? variables.initialValues.map((value, index) => `  ${int16Literal(value)}${index + 1 < variables.initialValues.length ? ',' : ''}`)
      : ['  0']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_variable_count = ${variables.initialValues.length};`,
    '',
    'const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs[] = {',
    ...(scenePackMeta.length ? scenePackMeta : ['  { { 0u, 0u, 0u }, 0u, 0u, -1 }']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_scene_count = ${doc.scenes.length};`,
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_start_scene = ${startScene}u;`,
    '',
  ];
  fs.writeFileSync(headerPath, header.join('\n'), 'utf-8');
  fs.writeFileSync(sourcePath, source.join('\n'), 'utf-8');
  return {
    scenePath: getSceneFilePath(projectDir),
    headerPath,
    sourcePath,
    glyphCount: glyphs.length,
    messageCount,
    choiceCount,
    switchCount,
    variableCount: variables.initialValues.length,
    commandCount,
    spriteAnimationCount: spriteAnimations.meta.length,
    sceneCount: doc.scenes.length,
    scenePackPaths: sceneBuilds.map((sceneBuild) => sceneBuild.packPath),
    scenePackBytes: sceneBuilds.map((sceneBuild) => sceneBuild.packBuffer.length),
    fontRenderer: fontRender.renderer,
    fontPath: fontRender.fontPath,
    fontDataPath,
    fontByteSize: fontBudget.byteSize,
    fontSectorCount: fontSectorCount,
    fontTileBase,
    fontEndTile: fontBudget.endTile,
    droppedGlyphCount: fontBudget.droppedGlyphCount,
    warnings: fontBudget.warnings,
  };
}

function previewFontText(projectDir, payload = {}) {
  const base = readFontConfig(projectDir);
  const config = normalizeFontConfig({
    ...base,
    ...(payload.config || {}),
    ...payload,
  });
  const text = String(payload.text || config.previewText || DEFAULT_FONT_CONFIG.previewText).slice(0, 512);
  const glyphs = [' '];
  const seen = new Set(glyphs);
  for (const char of text) {
    if (char === '\r' || char === '\n') continue;
    if (!seen.has(char)) {
      seen.add(char);
      glyphs.push(char);
    }
  }
  const render = renderGlyphBitmaps(glyphs.slice(0, 254), config);
  return {
    config,
    text,
    glyphs: glyphs.slice(0, 254).map((glyph, index) => ({ glyph, bitmap: render.bitmaps[index] })),
    renderer: render.renderer,
    fontPath: render.fontPath,
  };
}

function assetById(assetDoc = { assets: [] }) {
  const map = new Map();
  (assetDoc.assets || []).forEach((asset) => {
    if (asset?.id) map.set(asset.id, asset);
  });
  return map;
}

function addExistingCdDataFile(projectDir, files, seen, relativePath) {
  const normalized = normalizeRelativePath(relativePath || '');
  if (!normalized || seen.has(normalized)) return;
  if (!fs.existsSync(path.join(projectDir, normalized))) return;
  seen.add(normalized);
  files.push(normalized);
}

function addCdDataFile(files, seen, relativePath) {
  const normalized = normalizeRelativePath(relativePath || '');
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  files.push(normalized);
}

function generatedCompressionEntry(generated = {}, slot = 'tiles') {
  const compression = generated.compression || {};
  const entry = slot === 'map' ? compression.map : compression.tiles;
  return entry && typeof entry === 'object' ? entry : {};
}

function generatedVisualCdDataFile(projectDir, generated = {}, slot = 'tiles') {
  const rawPath = slot === 'map' ? generated.mapVramFile : generated.tilesFile;
  const compressedPath = slot === 'map' ? generated.mapVramCompressedFile : generated.tilesCompressedFile;
  const entry = generatedCompressionEntry(generated, slot);
  const normalizedCompressed = normalizeRelativePath(compressedPath || '');
  if (
    entry.codec === 'rle'
    && normalizedCompressed
    && normalizeRelativePath(entry.file || '') === normalizedCompressed
    && fs.existsSync(path.join(projectDir, normalizedCompressed))
  ) {
    return normalizedCompressed;
  }
  return rawPath;
}

function addAssetCdDataFiles(projectDir, files, seen, asset) {
  if (!asset) return;
  const generated = asset.data?.generated || {};
  if (asset.type === 'image') {
    addExistingCdDataFile(projectDir, files, seen, generatedVisualCdDataFile(projectDir, generated, 'tiles'));
    addExistingCdDataFile(projectDir, files, seen, generatedVisualCdDataFile(projectDir, generated, 'map'));
  } else if (asset.type === 'sprite') {
    addExistingCdDataFile(projectDir, files, seen, generatedVisualCdDataFile(projectDir, generated, 'tiles'));
  } else if (asset.type === 'adpcm') {
    addExistingCdDataFile(projectDir, files, seen, generated.outputFile);
  }
}

function collectSceneCommandAssetIds(scene = {}) {
  const ids = [];
  (scene.commands || []).forEach((command) => {
    if (command.type === 'background' || command.type === 'sprite') {
      if (command.assetId) ids.push(command.assetId);
    } else if (command.type === 'message') {
      if (command.voiceAssetId) ids.push(command.voiceAssetId);
    } else if (command.type === 'audio' && command.kind === 'adpcm' && command.action === 'play') {
      if (command.assetId) ids.push(command.assetId);
    }
  });
  return ids;
}

function collectCdDataFiles(projectDir) {
  const assetDoc = assetManager.readAssetDocument(projectDir);
  const doc = readSceneDocument(projectDir);
  const assets = assetById(assetDoc);
  const files = [];
  const seen = new Set();
  // Shared glyph font is streamed into VRAM at boot; place it first so its
  // CD sector stays stable regardless of scene edits.
  addCdDataFile(files, seen, VN_FONT_DATA_FILE);
  (doc.scenes || []).forEach((scene, sceneIndex) => {
    addCdDataFile(files, seen, scenePackRelativePath(scene, sceneIndex));
    collectSceneCommandAssetIds(scene).forEach((assetId) => {
      addAssetCdDataFiles(projectDir, files, seen, assets.get(assetId));
    });
  });
  const fallback = typeof assetManager.collectCdDataFiles === 'function'
    ? assetManager.collectCdDataFiles(projectDir)
    : [];
  fallback.forEach((relativePath) => addExistingCdDataFile(projectDir, files, seen, relativePath));
  return files;
}

function syncVisualNovelRuntime(projectDir, logger) {
  const sourceDir = templateRuntimeDir();
  const targets = [
    ['main.c', path.join(projectDir, 'src', 'main.c')],
    ['pce_vn_runtime.c', path.join(projectDir, 'src', 'pce_vn_runtime.c')],
  ];
  const changed = targets
    .map(([fileName, targetPath]) => copyIfChanged(path.join(sourceDir, fileName), targetPath))
    .some(Boolean);
  if (changed) logger?.info?.('PCE visual novel runtime を src/ に同期しました');
  return { changed };
}

function collectCddaTracks(projectDir) {
  const doc = assetManager.readAssetDocument(projectDir);
  return (doc.assets || [])
    .filter((asset) => asset.type === 'cdda-track')
    .map((asset) => normalizeRelativePath(asset.data?.generated?.outputFile || asset.source || ''))
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(projectDir, relativePath)));
}

function addManagedGeneratedPath(files, relativePath) {
  const normalized = normalizeRelativePath(relativePath || '');
  if (normalized) files.add(normalized);
}

function collectManagedGeneratedCdDataFiles(projectDir) {
  const managed = new Set();
  addManagedGeneratedPath(managed, VN_FONT_DATA_FILE);
  const scenePackDir = normalizeRelativePath(VN_SCENE_PACK_DIR);
  try {
    const assetDoc = assetManager.readAssetDocument(projectDir);
    (assetDoc.assets || []).forEach((asset) => {
      const generated = asset.data?.generated || {};
      if (asset.type === 'image') {
        addManagedGeneratedPath(managed, generated.tilesFile);
        addManagedGeneratedPath(managed, generated.tilesCompressedFile);
        addManagedGeneratedPath(managed, generated.mapVramFile);
        addManagedGeneratedPath(managed, generated.mapVramCompressedFile);
      } else if (asset.type === 'sprite') {
        addManagedGeneratedPath(managed, generated.tilesFile);
        addManagedGeneratedPath(managed, generated.tilesCompressedFile);
      } else if (asset.type === 'adpcm') {
        addManagedGeneratedPath(managed, generated.outputFile);
      }
    });
  } catch (_) {}
  (readSceneDocument(projectDir).scenes || []).forEach((scene, sceneIndex) => {
    addManagedGeneratedPath(managed, scenePackRelativePath(scene, sceneIndex));
  });
  managed.add(scenePackDir);
  return managed;
}

function mergeCdDataFiles(projectDir, generatedDataFiles = [], configuredDataFiles = []) {
  const managed = collectManagedGeneratedCdDataFiles(projectDir);
  const scenePackPrefix = `${normalizeRelativePath(VN_SCENE_PACK_DIR)}/`;
  const merged = new Set(generatedDataFiles.map((entry) => normalizeRelativePath(entry || '')).filter(Boolean));
  (Array.isArray(configuredDataFiles) ? configuredDataFiles : []).forEach((entry) => {
    const normalized = normalizeRelativePath(entry || '');
    if (!normalized || merged.has(normalized)) return;
    if (managed.has(normalized) || normalized.startsWith(scenePackPrefix)) return;
    merged.add(normalized);
  });
  return Array.from(merged);
}

function prepareVisualNovelBuild(projectDir, config = {}) {
  syncVisualNovelRuntime(projectDir);
  ensureSceneFile(projectDir);
  generateVnSources(projectDir);
  const dataFiles = collectCdDataFiles(projectDir);
  const cddaTracks = collectCddaTracks(projectDir);
  const cd = config.cd && typeof config.cd === 'object' ? config.cd : {};
  const mergedDataFiles = mergeCdDataFiles(projectDir, dataFiles, cd.dataFiles);
  const mergedCddaTracks = Array.from(new Set([...(Array.isArray(cd.cddaTracks) ? cd.cddaTracks : []), ...cddaTracks]));
  const generated = generateVnSources(projectDir, { cdDataFiles: mergedDataFiles });
  return {
    ok: true,
    generated,
    configPatch: {
      toolchain: 'llvm-mos',
      targetMedia: 'cd',
      cd: {
        ...cd,
        dataFiles: mergedDataFiles,
        cddaTracks: mergedCddaTracks,
      },
      pluginSettings: {
        ...(config.pluginSettings || {}),
        'pce-sample-builder': {
          ...(config.pluginSettings?.['pce-sample-builder'] || {}),
          sample: 'visual-novel-cd',
        },
      },
    },
  };
}

module.exports = {
  VN_SCENE_FILE,
  VN_SCENE_PACK_DIR,
  VN_SCENE_PACK_CACHE_BYTES,
  VN_FONT_FILE,
  VN_FONT_DATA_FILE,
  VN_MAX_GLYPH_COUNT,
  DEFAULT_FONT_TILE_BASE,
  DEFAULT_FONT_CONFIG,
  GLYPH_END,
  VN_VERSION,
  VN_COMMAND_BACKGROUND,
  VN_COMMAND_SPRITE,
  VN_COMMAND_MESSAGE,
  VN_COMMAND_AUDIO,
  VN_COMMAND_PRELOAD,
  VN_COMMAND_CHOICE,
  VN_COMMAND_JUMP,
  VN_COMMAND_WAIT,
  VN_COMMAND_EFFECT,
  VN_COMMAND_VARIABLE,
  VN_COMMAND_IF,
  VN_COMMAND_SWITCH,
  VN_COMMAND_LABEL,
  VN_COMMAND_GOTO,
  collectCdDataFiles,
  collectGlyphs,
  collectGlyphsRaw,
  computeFontBudget,
  defaultSceneDocument,
  encodeGlyphTileData,
  ensureSceneFile,
  generateVnSources,
  getFontFilePath,
  getSceneFilePath,
  normalizeSceneDocument,
  normalizeFontConfig,
  prepareVisualNovelBuild,
  previewFontText,
  readFontConfig,
  readSceneDocument,
  renderGlyphBitmaps,
  renderGlyphTileData,
  syncVisualNovelRuntime,
  writeFontConfig,
  writeSceneDocument,
};
