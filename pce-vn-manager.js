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
  const width = Number(options.width);
  if (Number.isFinite(width) && width > 0) return Math.min(PCE_SCREEN_WIDTH, Math.round(width));
  const cellWidth = Number(options.cellWidth);
  const columns = Number(options.cellColumns);
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
  return {
    version: 1,
    startScene: 'opening',
    scenes: [
      {
        id: 'opening',
        backgroundAssetId,
        characters: [],
        bgmAssetId,
        nextSceneId: '',
        messages: [
          {
            speaker: 'アカリ',
            text: '320がめんです',
            voiceAssetId,
            advanceMode: 'button',
          },
          {
            speaker: 'アカリ',
            text: '18もじx4ぎょう',
            voiceAssetId: '',
            advanceMode: 'button',
          },
        ],
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

function normalizeMessage(message = {}, index = 0, valid = assetIdsByType()) {
  const raw = message && typeof message === 'object' ? message : {};
  const voiceAssetId = String(raw.voiceAssetId || '').trim();
  return {
    speaker: String(raw.speaker || '').trim().slice(0, 16),
    text: String(raw.text || (index === 0 ? 'メッセージを入力してください。' : '')).trim().slice(0, 96),
    voiceAssetId: valid.adpcm?.has(voiceAssetId) ? voiceAssetId : '',
    advanceMode: String(raw.advanceMode || 'button') === 'auto' ? 'auto' : 'button',
  };
}

function normalizeCharacter(character = {}, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const raw = character && typeof character === 'object' ? character : {};
  const assetId = String(raw.assetId || '').trim();
  if (!valid.sprite?.has(assetId)) return null;
  const x = clampInt(raw.x, 0, 319, defaultCharacterX(assetDoc, assetId));
  const y = clampInt(raw.y, 0, 223, DEFAULT_CHARACTER_Y);
  return {
    assetId,
    x,
    y,
    pose: String(raw.pose || 'default').trim().slice(0, 32) || 'default',
  };
}

function normalizeScene(scene = {}, index = 0, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const raw = scene && typeof scene === 'object' ? scene : {};
  const backgroundAssetId = String(raw.backgroundAssetId || '').trim();
  const bgmAssetId = String(raw.bgmAssetId || '').trim();
  const fallback = defaultSceneDocument(assetDoc).scenes[0];
  const messages = Array.isArray(raw.messages) && raw.messages.length
    ? raw.messages.map((message, msgIndex) => normalizeMessage(message, msgIndex, valid)).filter((message) => message.text)
    : fallback.messages.map((message, msgIndex) => normalizeMessage(message, msgIndex, valid));
  const characters = (Array.isArray(raw.characters) ? raw.characters : fallback.characters)
    .map((character) => normalizeCharacter(character, valid, assetDoc))
    .filter(Boolean)
    .slice(0, 4);
  return {
    id: safeId(raw.id, index === 0 ? 'opening' : `scene_${index + 1}`),
    backgroundAssetId: valid.image?.has(backgroundAssetId) ? backgroundAssetId : firstAssetId(assetDoc.assets || [], 'image'),
    characters,
    messages,
    bgmAssetId: valid['cdda-track']?.has(bgmAssetId) || valid['psg-song']?.has(bgmAssetId) ? bgmAssetId : firstAssetId(assetDoc.assets || [], 'cdda-track'),
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
  }));
  return {
    version: 1,
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
  const glyphs = [' '];
  const seen = new Set(glyphs);
  (doc.scenes || []).forEach((scene) => {
    (scene.messages || []).forEach((message) => {
      for (const char of messageDisplayText(message)) {
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

function psgOrCddaTrack(assetDoc, assetId) {
  const asset = (assetDoc.assets || []).find((entry) => entry.id === assetId);
  if (!asset) return 0;
  if (asset.type === 'cdda-track') return Math.max(2, Math.min(99, Number(asset.options?.track) || 2));
  return 0;
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
  const sceneIndex = new Map(doc.scenes.map((scene, index) => [scene.id, index]));
  const generatedDir = path.join(projectDir, 'src', 'generated');
  ensureDirSync(generatedDir);

  const messageArrays = [];
  const messageMeta = [];
  const characterArrays = [];
  const sceneMeta = [];
  let messageCount = 0;

  doc.scenes.forEach((scene, sceneIdx) => {
    const sceneMessages = scene.messages || [];
    const firstMessage = messageCount;
    sceneMessages.forEach((message) => {
      const bytes = [];
      for (const glyph of messageDisplayText(message)) {
        bytes.push(glyphIndex.get(glyph) ?? 0);
      }
      bytes.push(GLYPH_END);
      const name = `pce_vn_message_${messageCount}_glyphs`;
      messageArrays.push(...bytesToCArray(name, Buffer.from(bytes)));
      messageArrays.push('');
      const voiceIndex = message.voiceAssetId && adpcmIndex.has(message.voiceAssetId)
        ? adpcmIndex.get(message.voiceAssetId)
        : -1;
      messageMeta.push(`  { ${name}, ${Math.max(0, bytes.length - 1)}u, ${voiceIndex} }${messageCount + 1 < 255 ? ',' : ''}`);
      messageCount += 1;
    });
    const chars = (scene.characters || []).filter((character) => spriteIndex.has(character.assetId)).slice(0, 4);
    const charArrayName = `pce_vn_scene_${sceneIdx}_characters`;
    if (chars.length) {
      characterArrays.push(`static const pce_vn_character_t ${charArrayName}[] = {`);
      chars.forEach((character, index) => {
        characterArrays.push(`  { ${spriteIndex.get(character.assetId)}u, ${character.x}u, ${character.y}u }${index + 1 < chars.length ? ',' : ''}`);
      });
      characterArrays.push('};');
      characterArrays.push('');
    }
    const next = scene.nextSceneId && sceneIndex.has(scene.nextSceneId) ? sceneIndex.get(scene.nextSceneId) : -1;
    const bgIndex = imageIndex.has(scene.backgroundAssetId) ? imageIndex.get(scene.backgroundAssetId) : 0;
    const cddaTrack = psgOrCddaTrack(assetDoc, scene.bgmAssetId);
    sceneMeta.push(`  { ${bgIndex}u, ${chars.length ? charArrayName : '(const pce_vn_character_t *)0'}, ${chars.length}u, ${firstMessage}u, ${sceneMessages.length}u, ${cddaTrack}u, ${next} }${sceneIdx + 1 < doc.scenes.length ? ',' : ''}`);
  });

  const headerPath = path.join(generatedDir, 'vn.h');
  const sourcePath = path.join(generatedDir, 'vn.c');
  const header = [
    '#ifndef PCE_EDITOR_GENERATED_VN_H',
    '#define PCE_EDITOR_GENERATED_VN_H',
    '',
    'typedef struct {',
    '  unsigned char sprite_index;',
    '  unsigned int x;',
    '  unsigned int y;',
    '} pce_vn_character_t;',
    '',
    'typedef struct {',
    '  const unsigned char *glyphs;',
    '  unsigned char glyph_count;',
    '  signed char voice_index;',
    '} pce_vn_message_t;',
    '',
    'typedef struct {',
    '  unsigned char bg_index;',
    '  const pce_vn_character_t *characters;',
    '  unsigned char character_count;',
    '  unsigned char message_start;',
    '  unsigned char message_count;',
    '  unsigned char cdda_track;',
    '  signed char next_scene;',
    '} pce_vn_scene_t;',
    '',
    `#define PCE_VN_FONT_TILE_BASE ${Number(fontConfig.tileBase || DEFAULT_FONT_TILE_BASE)}u`,
    '#define PCE_VN_GLYPH_END 0xffu',
    '',
    'extern const unsigned char pce_vn_font_tiles[];',
    'extern const unsigned char pce_vn_font_glyph_count;',
    'extern const pce_vn_message_t pce_vn_messages[];',
    'extern const unsigned char pce_vn_message_count;',
    'extern const pce_vn_scene_t pce_vn_scenes[];',
    'extern const unsigned char pce_vn_scene_count;',
    'extern const unsigned char pce_vn_start_scene;',
    '',
    '#endif',
    '',
  ];
  const startScene = sceneIndex.get(doc.startScene) || 0;
  const source = [
    '#include "vn.h"',
    '',
    ...bytesToCArray('pce_vn_font_tiles', fontTiles, 'const unsigned char'),
    `const unsigned char pce_vn_font_glyph_count = ${glyphs.length};`,
    '',
    ...messageArrays,
    ...characterArrays,
    'const pce_vn_message_t pce_vn_messages[] = {',
    ...(messageMeta.length ? messageMeta.map((line, index) => line.replace(/,$/, index + 1 < messageMeta.length ? ',' : '')) : ['  { (const unsigned char *)0, 0u, -1 }']),
    '};',
    `const unsigned char pce_vn_message_count = ${messageCount};`,
    '',
    'const pce_vn_scene_t pce_vn_scenes[] = {',
    ...sceneMeta,
    '};',
    `const unsigned char pce_vn_scene_count = ${doc.scenes.length};`,
    `const unsigned char pce_vn_start_scene = ${startScene}u;`,
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

function collectCdDataFiles(projectDir) {
  const doc = assetManager.readAssetDocument(projectDir);
  return (doc.assets || [])
    .filter((asset) => asset.type === 'adpcm')
    .map((asset) => normalizeRelativePath(asset.data?.generated?.outputFile || ''))
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(projectDir, relativePath)));
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
  ensureSceneFile(projectDir);
  const generated = generateVnSources(projectDir);
  const dataFiles = collectCdDataFiles(projectDir);
  const cddaTracks = collectCddaTracks(projectDir);
  const cd = config.cd && typeof config.cd === 'object' ? config.cd : {};
  const mergedDataFiles = Array.from(new Set([...(Array.isArray(cd.dataFiles) ? cd.dataFiles : []), ...dataFiles]));
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
  writeFontConfig,
  writeSceneDocument,
};
