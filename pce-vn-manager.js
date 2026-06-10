'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assetManager = require('./pce-asset-manager');

const VN_SCENE_FILE = path.join('assets', 'pce-vn-scenes.json');
const VN_FONT_FILE = path.join('assets', 'pce-font.json');
const GLYPH_END = 0xff;
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
  const bgmAssetId = firstAssetId(assets, 'cdda-track') || firstAssetId(assets, 'psg-song');
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
  if (bgmAssetId) {
    commands.push({
      type: 'audio',
      kind: 'cdda',
      action: 'play',
      assetId: bgmAssetId,
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
      if (!label) return null;
      return { label, targetSceneId };
    })
    .filter(Boolean)
    .slice(0, 4);
  if (!choices.length) return null;
  return {
    type: 'choice',
    choices,
    defaultIndex: clampInt(raw.defaultIndex ?? raw.initialIndex, 0, choices.length - 1, 0),
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
    commands: (scene.commands || []).map((command) => {
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
      return command;
    }),
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

function collectGlyphs(doc) {
  const glyphs = [' ', '>'];
  const seen = new Set(glyphs);
  (doc.scenes || []).forEach((scene) => {
    (scene.commands || []).forEach((command) => {
      const text = command.type === 'message'
        ? messageDisplayText(command)
        : (command.type === 'choice' ? (command.choices || []).map((choice) => choice.label || '').join('') : '');
      if (!text) return;
      for (const char of text) {
        if (!seen.has(char)) {
          seen.add(char);
          glyphs.push(char);
        }
      }
    });
  });
  return glyphs.slice(0, 254);
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

function generateVnSources(projectDir, options = {}) {
  const assetDoc = assetManager.readAssetDocument(projectDir);
  const doc = writeSceneDocument(projectDir, readSceneDocument(projectDir));
  const glyphs = collectGlyphs(doc);
  const glyphIndex = new Map(glyphs.map((glyph, index) => [glyph, index]));
  const fontConfig = normalizeFontConfig({
    ...readFontConfig(projectDir),
    ...(options.fontConfig || {}),
    tileBase: options.fontTileBase || options.fontConfig?.tileBase || readFontConfig(projectDir).tileBase,
  });
  const fontRender = renderGlyphBitmaps(glyphs, fontConfig);
  const fontTiles = encodeGlyphTileData(fontRender.bitmaps);
  const imageIndex = indexAssets(assetDoc.assets || [], 'image');
  const spriteIndex = indexAssets(assetDoc.assets || [], 'sprite');
  const adpcmIndex = indexAssets(assetDoc.assets || [], 'adpcm');
  const cddaIndex = indexAssets(assetDoc.assets || [], 'cdda-track');
  const spriteAnimations = buildSpriteAnimationIndex(assetDoc, spriteIndex);
  const sceneIndex = new Map(doc.scenes.map((scene, index) => [scene.id, index]));
  const generatedDir = path.join(projectDir, 'src', 'generated');
  ensureDirSync(generatedDir);
  const vnDataSection = 'PCE_VN_DATA_SECTION';

  const messageArrays = [];
  const messageMeta = [];
  const choiceArrays = [];
  const choiceMeta = [];
  const commandMeta = [];
  const sceneMeta = [];
  let messageCount = 0;
  let choiceCount = 0;
  let commandCount = 0;

  doc.scenes.forEach((scene, sceneIdx) => {
    const firstCommand = commandCount;
    const slotSpriteAssets = ['', '', '', ''];
    (scene.commands || []).forEach((command) => {
      if (commandCount >= 255) throw new Error('PCE VN supports up to 255 commands');
      if (command.type === 'background') {
        const bgIndex = imageIndex.has(command.assetId) ? imageIndex.get(command.assetId) : -1;
        commandMeta.push(`  { ${VN_COMMAND_BACKGROUND}u, ${bgIndex}, 0u, ${command.transition === 'fade' ? VN_BG_TRANSITION_FADE : VN_BG_TRANSITION_CUT}u, ${command.fadeOutFrames}u, ${command.fadeInFrames}u, 0u, 0u, -1, -1, -1, -1 }`);
        commandCount += 1;
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
        commandMeta.push(`  { ${VN_COMMAND_SPRITE}u, ${spriteAssetIndex}, ${slot}u, ${flags}u, ${command.durationFrames}u, 0u, ${command.x}u, ${command.y}u, -1, ${animationIndex}, -1, -1 }`);
        commandCount += 1;
        return;
      }
      if (command.type === 'message') {
        if (messageCount >= 255) throw new Error('PCE VN supports up to 255 messages');
        const bytes = [];
        for (const glyph of messageDisplayText(command)) {
          bytes.push(glyphIndex.get(glyph) ?? 0);
        }
        bytes.push(GLYPH_END);
        const name = `pce_vn_message_${messageCount}_glyphs`;
        const mouthSlot = clampInt(command.mouthSlot, 0, 3, 0);
        const mouthSpriteId = slotSpriteAssets[mouthSlot] || '';
        const mouthAnimationIndex = command.mouthAnimationId && mouthSpriteId
          ? (spriteAnimations.index.get(`${mouthSpriteId}:${command.mouthAnimationId}`) ?? -1)
          : -1;
        messageArrays.push(...bytesToCArray(`${vnDataSection} ${name}`, Buffer.from(bytes)));
        messageArrays.push('');
        const voiceIndex = command.voiceAssetId && adpcmIndex.has(command.voiceAssetId)
          ? adpcmIndex.get(command.voiceAssetId)
          : -1;
        messageMeta.push(`  { ${name}, ${Math.max(0, bytes.length - 1)}u, ${voiceIndex}, ${command.textSpeedFrames}u, ${command.advanceMode === 'auto' ? VN_ADVANCE_AUTO : VN_ADVANCE_BUTTON}u, ${command.autoWaitFrames}u, ${mouthAnimationIndex}, ${mouthSlot}u }`);
        commandMeta.push(`  { ${VN_COMMAND_MESSAGE}u, -1, 0u, 0u, 0u, 0u, 0u, 0u, ${messageCount}, -1, -1, -1 }`);
        messageCount += 1;
        commandCount += 1;
        return;
      }
      if (command.type === 'audio') {
        const isAdpcm = command.kind === 'adpcm';
        const action = command.action === 'stop' ? VN_AUDIO_ACTION_STOP : VN_AUDIO_ACTION_PLAY;
        const assetIndex = command.action === 'play'
          ? (isAdpcm ? (adpcmIndex.get(command.assetId) ?? -1) : (cddaIndex.get(command.assetId) ?? -1))
          : -1;
        const flags = (isAdpcm ? VN_AUDIO_KIND_ADPCM : VN_AUDIO_KIND_CDDA) | action;
        commandMeta.push(`  { ${VN_COMMAND_AUDIO}u, ${assetIndex}, 0u, ${flags}u, 0u, 0u, 0u, 0u, -1, -1, -1, -1 }`);
        commandCount += 1;
        return;
      }
      if (command.type === 'preload') {
        const target = command.sceneId && sceneIndex.has(command.sceneId) ? sceneIndex.get(command.sceneId) : -1;
        commandMeta.push(`  { ${VN_COMMAND_PRELOAD}u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, ${target}, -1 }`);
        commandCount += 1;
        return;
      }
      if (command.type === 'choice') {
        if (choiceCount >= 255) throw new Error('PCE VN supports up to 255 choices');
        const choiceName = `pce_vn_choice_${choiceCount}`;
        const options = (command.choices || []).slice(0, 4);
        options.forEach((option, optionIndex) => {
          const bytes = [];
          for (const glyph of String(option.label || '')) {
            bytes.push(glyphIndex.get(glyph) ?? 0);
          }
          bytes.push(GLYPH_END);
          choiceArrays.push(...bytesToCArray(`${vnDataSection} ${choiceName}_option_${optionIndex}_glyphs`, Buffer.from(bytes)));
          choiceArrays.push('');
        });
        choiceArrays.push(`static const pce_vn_choice_option_t ${vnDataSection} ${choiceName}_options[] = {`);
        options.forEach((option, optionIndex) => {
          let glyphCount = 0;
          for (const _glyph of String(option.label || '')) glyphCount += 1;
          const target = option.targetSceneId && sceneIndex.has(option.targetSceneId) ? sceneIndex.get(option.targetSceneId) : -1;
          const suffix = optionIndex + 1 < options.length ? ',' : '';
          choiceArrays.push(`  { ${choiceName}_option_${optionIndex}_glyphs, ${glyphCount}u, ${target} }${suffix}`);
        });
        choiceArrays.push('};');
        choiceArrays.push('');
        choiceMeta.push(`  { ${choiceName}_options, ${options.length}u, ${clampInt(command.defaultIndex, 0, Math.max(0, options.length - 1), 0)}u }`);
        commandMeta.push(`  { ${VN_COMMAND_CHOICE}u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, -1, ${choiceCount} }`);
        choiceCount += 1;
        commandCount += 1;
        return;
      }
      if (command.type === 'jump') {
        const target = command.sceneId && sceneIndex.has(command.sceneId) ? sceneIndex.get(command.sceneId) : -1;
        commandMeta.push(`  { ${VN_COMMAND_JUMP}u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, ${target}, -1 }`);
        commandCount += 1;
        return;
      }
      if (command.type === 'wait') {
        const frames = clampInt(command.frames, 0, 65535, 30);
        commandMeta.push(`  { ${VN_COMMAND_WAIT}u, -1, 0u, 0u, ${frames & 0xff}u, ${(frames >> 8) & 0xff}u, 0u, 0u, -1, -1, -1, -1 }`);
        commandCount += 1;
        return;
      }
      if (command.type === 'effect') {
        const effect = command.effect === 'fadeIn'
          ? VN_EFFECT_FADE_IN
          : (command.effect === 'blank' ? VN_EFFECT_BLANK : (command.effect === 'shake' ? VN_EFFECT_SHAKE : VN_EFFECT_FADE_OUT));
        commandMeta.push(`  { ${VN_COMMAND_EFFECT}u, -1, 0u, ${effect}u, ${clampInt(command.frames, 0, 255, 16)}u, ${clampInt(command.intensity, 0, 16, 0)}u, 0u, 0u, -1, -1, -1, -1 }`);
        commandCount += 1;
      }
    });
    const next = scene.nextSceneId && sceneIndex.has(scene.nextSceneId) ? sceneIndex.get(scene.nextSceneId) : -1;
    sceneMeta.push(`  { ${firstCommand}u, ${commandCount - firstCommand}u, ${next} }${sceneIdx + 1 < doc.scenes.length ? ',' : ''}`);
  });

  const animationMeta = spriteAnimations.meta.map((animation, index) => (
    `  { ${animation.spriteIndex}u, ${animation.firstCell}u, ${animation.frameCount}u, ${animation.frameDelay}u, ${animation.frameWidthCells}u, ${animation.frameHeightCells}u, ${animation.frameStrideCells}u, ${animation.loop ? '1u' : '0u'} }${index + 1 < spriteAnimations.meta.length ? ',' : ''}`
  ));

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
    '  signed char voice_index;',
    '  unsigned char text_speed_frames;',
    '  unsigned char advance_mode;',
    '  unsigned char auto_wait_frames;',
    '  signed char mouth_animation_index;',
    '  unsigned char mouth_slot;',
    '} pce_vn_message_t;',
    '',
    'typedef struct {',
    '  const unsigned char *glyphs;',
    '  unsigned char glyph_count;',
    '  signed char target_scene;',
    '} pce_vn_choice_option_t;',
    '',
    'typedef struct {',
    '  const pce_vn_choice_option_t *options;',
    '  unsigned char option_count;',
    '  unsigned char default_index;',
    '} pce_vn_choice_t;',
    '',
    'typedef struct {',
    '  unsigned char type;',
    '  signed char asset_index;',
    '  unsigned char slot;',
    '  unsigned char flags;',
    '  unsigned char arg0;',
    '  unsigned char arg1;',
    '  unsigned int x;',
    '  unsigned int y;',
    '  signed char message_index;',
    '  signed char animation_index;',
    '  signed char scene_index;',
    '  signed char choice_index;',
    '} pce_vn_command_t;',
    '',
    'typedef struct {',
    '  unsigned char command_start;',
    '  unsigned char command_count;',
    '  signed char next_scene;',
    '} pce_vn_scene_t;',
    '',
    `#define PCE_VN_FONT_TILE_BASE ${Number(fontConfig.tileBase || DEFAULT_FONT_TILE_BASE)}u`,
    `#define PCE_VN_CHOICE_CURSOR_GLYPH ${glyphIndex.get('>') ?? 0}u`,
    '#define PCE_VN_GLYPH_END 0xffu',
    '',
    'extern const unsigned char pce_vn_font_tiles[];',
    'extern const unsigned char pce_vn_font_glyph_count;',
    'void pce_vn_font_tiles_map(void);',
    'extern const pce_vn_sprite_anim_t pce_vn_sprite_animations[];',
    'extern const unsigned char pce_vn_sprite_animation_count;',
    'extern const pce_vn_message_t pce_vn_messages[];',
    'extern const unsigned char pce_vn_message_count;',
    'extern const pce_vn_choice_t pce_vn_choices[];',
    'extern const unsigned char pce_vn_choice_count;',
    'extern const pce_vn_command_t pce_vn_commands[];',
    'extern const unsigned char pce_vn_command_count;',
    'extern const pce_vn_scene_t pce_vn_scenes[];',
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
    ...bytesToCArray('PCE_VN_FONT_SECTION pce_vn_font_tiles', fontTiles, 'const unsigned char'),
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_font_glyph_count = ${glyphs.length};`,
    '',
    'void pce_vn_font_tiles_map(void)',
    '{',
    '#if defined(__PCE_CD__)',
    '  pce_ram_bank132_map();',
    '#endif',
    '}',
    '',
    ...messageArrays,
    'const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations[] = {',
    ...(animationMeta.length ? animationMeta : ['  { 0u, 0u, 1u, 8u, 1u, 1u, 1u, 1u }']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = ${spriteAnimations.meta.length};`,
    '',
    'const pce_vn_message_t PCE_VN_DATA_SECTION pce_vn_messages[] = {',
    ...(messageMeta.length ? messageMeta.map((line, index) => `${line}${index + 1 < messageMeta.length ? ',' : ''}`) : ['  { (const unsigned char *)0, 0u, -1, 0u, 0u, 0u, -1, 0u }']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_message_count = ${messageCount};`,
    '',
    ...choiceArrays,
    'const pce_vn_choice_t PCE_VN_DATA_SECTION pce_vn_choices[] = {',
    ...(choiceMeta.length ? choiceMeta.map((line, index) => `${line}${index + 1 < choiceMeta.length ? ',' : ''}`) : ['  { (const pce_vn_choice_option_t *)0, 0u, 0u }']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_choice_count = ${choiceCount};`,
    '',
    'const pce_vn_command_t PCE_VN_DATA_SECTION pce_vn_commands[] = {',
    ...(commandMeta.length ? commandMeta.map((line, index) => `${line}${index + 1 < commandMeta.length ? ',' : ''}`) : ['  { 0u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, -1, -1 }']),
    '};',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_command_count = ${commandCount};`,
    '',
    'const pce_vn_scene_t PCE_VN_DATA_SECTION pce_vn_scenes[] = {',
    ...sceneMeta,
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
    commandCount,
    spriteAnimationCount: spriteAnimations.meta.length,
    sceneCount: doc.scenes.length,
    fontRenderer: fontRender.renderer,
    fontPath: fontRender.fontPath,
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

function addAssetCdDataFiles(projectDir, files, seen, asset) {
  if (!asset) return;
  const generated = asset.data?.generated || {};
  if (asset.type === 'image') {
    addExistingCdDataFile(projectDir, files, seen, generated.tilesFile);
    addExistingCdDataFile(projectDir, files, seen, generated.mapVramFile);
  } else if (asset.type === 'sprite') {
    addExistingCdDataFile(projectDir, files, seen, generated.tilesFile);
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
  (doc.scenes || []).forEach((scene) => {
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

function prepareVisualNovelBuild(projectDir, config = {}) {
  syncVisualNovelRuntime(projectDir);
  ensureSceneFile(projectDir);
  const generated = generateVnSources(projectDir);
  const dataFiles = collectCdDataFiles(projectDir);
  const cddaTracks = collectCddaTracks(projectDir);
  const cd = config.cd && typeof config.cd === 'object' ? config.cd : {};
  const mergedDataFiles = Array.from(new Set([...dataFiles, ...(Array.isArray(cd.dataFiles) ? cd.dataFiles : [])]));
  const mergedCddaTracks = Array.from(new Set([...(Array.isArray(cd.cddaTracks) ? cd.cddaTracks : []), ...cddaTracks]));
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
  VN_FONT_FILE,
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
  collectCdDataFiles,
  collectGlyphs,
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
