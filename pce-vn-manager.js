'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const assetManager = require('./pce-asset-manager');

const VN_SCENE_FILE = path.join('assets', 'pce-vn-scenes.json');
const VN_FONT_FILE = path.join('assets', 'pce-font.json');
// BG message / choice glyph streams stay byte-oriented so the common case costs
// one byte per glyph, but a 0xfd escape prefix lets the project-wide font exceed
// the old 254-glyph cap: glyph indices 0..252 are written as a single byte, while
// indices >= 253 are written as 0xfd followed by a 16-bit little-endian index. The
// stream byte 0xfe is the newline marker and 0xff the terminator. The runtime
// decodes these back to PCE_VN_GLYPH_NEWLINE (0xfffe) / PCE_VN_GLYPH_END (0xffff),
// values that escaped indices (<= VN_MAX_GLYPH_COUNT) can never collide with. The
// masks live in VRAM (not a RAM bank); the real ceiling is VRAM, not the index
// width (see computeFontBudget / VN_MAX_GLYPH_COUNT).
const GLYPH_END_BYTE = 0xff;
const GLYPH_NEWLINE_BYTE = 0xfe;
const GLYPH_ESCAPE_BYTE = 0xfd;
const GLYPH_DIRECT_MAX = 0xfc; // highest glyph index encodable as a single byte
// Append one glyph index to a stream: a single byte for 0..252, otherwise an
// escape prefix plus a 16-bit little-endian index. Returns nothing; the caller
// tracks the entry count (one per glyph/newline) for glyph_count.
function pushGlyphIndexEntry(bytes, index) {
  const i = index & 0xffff;
  if (i <= GLYPH_DIRECT_MAX) {
    bytes.push(i);
    return;
  }
  bytes.push(GLYPH_ESCAPE_BYTE, i & 0xff, (i >> 8) & 0xff);
}
const DEFAULT_FONT_TILE_BASE = 712;
const PCE_SCREEN_WIDTH = 256;
const PCE_SCREEN_HEIGHT = 224;
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
const VN_COMMAND_INPUTCHECK = 14;
const VN_COMMAND_SPRITETEXT = 15;
const VN_BG_TRANSITION_CUT = 0;
const VN_BG_TRANSITION_FADE = 1;
const VN_SPRITE_VISIBLE = 1;
const VN_SPRITE_FLIP_X = 2;
const VN_SPRITE_FLIP_Y = 4;
const VN_AUDIO_KIND_ADPCM = 0;
const VN_AUDIO_KIND_CDDA = 1;
const VN_AUDIO_KIND_PSG = 2;
const VN_AUDIO_ACTION_PLAY = 0x10;
const VN_AUDIO_ACTION_STOP = 0x20;
// Input check command modes (stored in command flags).
const VN_INPUT_MODE_SYNC = 0;
const VN_INPUT_MODE_ASYNC = 1;
const VN_INPUT_MODE_CANCEL = 2;
// Joypad button bits, matching the VN runtime PAD_* constants.
const VN_PAD_I = 0x01;
const VN_PAD_II = 0x02;
const VN_PAD_SELECT = 0x04;
const VN_PAD_RUN = 0x08;
const VN_PAD_UP = 0x10;
const VN_PAD_RIGHT = 0x20;
const VN_PAD_DOWN = 0x40;
const VN_PAD_LEFT = 0x80;
const VN_INPUT_BUTTON_BITS = {
  up: VN_PAD_UP,
  down: VN_PAD_DOWN,
  left: VN_PAD_LEFT,
  right: VN_PAD_RIGHT,
  select: VN_PAD_SELECT,
  run: VN_PAD_RUN,
  i: VN_PAD_I,
  ii: VN_PAD_II,
};
const VN_INPUT_BUTTON_KEYS = ['up', 'down', 'left', 'right', 'select', 'run', 'i', 'ii'];
// Sentinel meaning "no text color override" in a message record (use default UI white).
const VN_MESSAGE_COLOR_NONE = 0xffff;
const VN_EFFECT_FADE_OUT = 0;
const VN_EFFECT_FADE_IN = 1;
const VN_EFFECT_BLANK = 2;
const VN_EFFECT_SHAKE = 3;
const VN_EFFECT_FLASH = 4;
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
const VN_SCENE_FLAG_FULL_SCREEN_BG = 1;
const VN_SCENE_PACK_DIR = path.join('assets', 'generated', 'vn', 'scenes');
// Font tiles are streamed from this CD data file into VRAM at boot (no longer
// resident in ram_bank132). One glyph = 16x16 px = 4 BG tiles = 128 bytes.
const VN_FONT_DATA_FILE = path.join('assets', 'generated', 'vn', 'font.bin');
// Overlay code blob (Path B, Phase B1). The overlay functions now live in
// pce_vn_runtime.c (section .vn_overlay), compiled in the SAME link as the main
// program so zp imaginary registers and resident symbols resolve. The linker
// fragment overlay_insert.ld locates .vn_overlay at CPU 0x8000 (MPR slot 4) with
// a benign LMA in the loaded image (VN_OVERLAY_LMA, bank132's unused tail), then
// finalizeOverlayBlob() objcopy's the section out of main.elf into overlay.bin.
// It is carried as a CD data file and streamed into physical RAM bank133 at boot
// (the IPL only auto-loads banks 128-132), time-shared into slot 4 with bank130.
// overlay.bin is reserved at a fixed size up front (so its CD sector is assigned
// before the link) and the extracted section is padded to that size afterwards.
const VN_OVERLAY_DATA_FILE = path.join('assets', 'generated', 'vn', 'overlay.bin');
const VN_OVERLAY_FRAGMENT_FILE = path.join('src', 'generated', 'overlay_insert.ld');
const VN_OVERLAY_SECTION = '.vn_overlay';
const VN_OVERLAY_VRAM_LOAD_ADDR = 0x8000; // CPU address the overlay is linked at / loaded to
// Reserved on-CD/bank133 size for the overlay blob, in whole CD sectors. The
// extracted .vn_overlay must fit this; it is also bounded by VN_OVERLAY_LMA's
// headroom inside bank132 (0xd000..0xdfff = 4 KB). Two sectors (4 KB) covers the
// current cd_rle_* overlay (~3.3 KB) with headroom.
const VN_OVERLAY_RESERVED_SECTORS = 2;
const VN_OVERLAY_RESERVED_BYTES = VN_OVERLAY_RESERVED_SECTORS * 2048; // 2048 = VN_CD_SECTOR_BYTES (defined below)
// LMA (physical/load address) for the .vn_overlay section: bank132's unused tail
// (region 0x0184c000..0x0184dfff, CPU 0xc000..0xdfff in slot 6). The IPL loads
// these bytes into bank132 RAM we never read (the real copy is CD-loaded into
// bank133), so the in-image copy is benign. Keep the section <= 4 KB so it stays
// within the bank132 region.
const VN_OVERLAY_LMA = 0x0184d000;
// Sprite-format copy of the glyphs used by `spritetext` commands. Only the
// characters referenced by spritetext are encoded here (BG-format font tiles
// cannot be reused for hardware sprites), so this stays small even when the BG
// font has hundreds of glyphs. One glyph = 16x16 px = 1 hardware sprite = 128
// bytes of sprite pattern data.
const VN_FONT_SPRITE_DATA_FILE = path.join('assets', 'generated', 'vn', 'font_sprite.bin');
// VCE sprite palette bank reserved for spritetext glyphs. Lit pixels use color
// index 15 of this bank; the runtime writes each command's color into that
// entry at draw time. Keep clear of the sprite asset palette banks (default 1).
const DEFAULT_FONT_SPRITE_PALETTE_BANK = 15;
// Upper bound of drawable glyphs per spritetext command (matches the runtime
// per-slot buffer). Newlines (0xfe) count toward this budget.
const VN_SPRITETEXT_MAX_GLYPHS = 32;
// Number of distinct sprite-font glyphs we will encode (index space 0..253,
// 0xfe = newline marker in command glyph streams).
const VN_FONT_SPRITE_MAX_GLYPH_COUNT = 254;
// Message glyphs are 12x12 px. font.bin stores one 12x12 1bpp mask per glyph
// (12 words = 24 bytes; per row the high byte = pixels 0..7, low byte high nibble
// = pixels 8..11, so VRAM word bit 0x8000 = leftmost pixel). The runtime streams
// the masks to VRAM and composites them into the message strip at a 12px pitch
// via pce_vdc_copy_from_vram. (Was 16x16 pre-baked as 4 BG tiles = 128 bytes.)
const FONT_GLYPH_PX = 12;
const FONT_GLYPH_MASK_WORDS = 12;
const FONT_BYTES_PER_GLYPH = FONT_GLYPH_MASK_WORDS * 2; // 24
// Fixed 26x8-tile VRAM region the runtime compositor owns for the message window
// (mirrors the runtime VN_MSG_TILE_COUNT), plus one dedicated blank tile.
const VN_MSG_STRIP_TILES = 208;
const VN_SATB_VRAM_WORD = 0x7f00;
// BG message/choice glyph index space is 16-bit (0..0xfffd drawable, 0xfffe =
// newline, 0xffff = end). The binding limit is no longer the index width but the
// VRAM the 12-word glyph masks occupy below the SATB; computeFontBudget() does the
// precise per-tileBase check. VN_MAX_GLYPH_COUNT is the headline cap we slice to
// and surface in the editor: at the default tileBase it stays clear of both the
// VRAM soft ceiling and the sprite pattern region.
const VN_MAX_GLYPH_COUNT = 1000;
// VRAM is 0x8000 words; SATB sits at 0x7f00 (tile 0x7f00/16 = 2032). Font tiles
// must end strictly below that. Sprite patterns are auto-placed above the font
// block by the asset converter, so warn well before the hard SATB ceiling.
const VN_FONT_VRAM_TILE_HARD_CEILING = 2032;
const VN_FONT_VRAM_TILE_SOFT_CEILING = 1728;
const VN_GLYPH_COUNT_SOFT_WARN = 900;
const VN_SCENE_PACK_CACHE_BYTES = 4096;
const VN_SCENE_PACK_VERSION = 1;
const VN_SCENE_PACK_HEADER_SIZE = 20;
const VN_SCENE_PACK_COMMAND_SIZE = 19;
const VN_SCENE_PACK_MESSAGE_SIZE = 13;
const VN_SCENE_PACK_CHOICE_SIZE = 6;
const VN_SCENE_PACK_OPTION_SIZE = 7;
const VN_SCENE_PACK_SWITCH_SIZE = 5;
const VN_SCENE_PACK_SWITCH_CASE_SIZE = 4;
const VN_SCENE_PACK_MAGIC = Buffer.from('PVNS');
const VN_CD_SECTOR_BYTES = 2048;
const VN_ADPCM_FRAME_RATE = 60;
const VN_ADPCM_END_PAD_FRAMES = 2;
const DEFAULT_FONT_CONFIG = {
  version: 1,
  fontPath: '',
  fontSize: 11,
  threshold: 32,
  xOffset: 0,
  yOffset: 0,
  tileBase: DEFAULT_FONT_TILE_BASE,
  previewText: '256がめんです\n17もじx4ぎょう',
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

function generatedFileByteLength(projectDir = '', relativePath = '') {
  if (!projectDir || !relativePath) return 0;
  const root = path.resolve(projectDir);
  const filePath = path.resolve(projectDir, normalizeRelativePath(relativePath));
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return 0;
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch (_) {
    return 0;
  }
}

function adpcmVoiceFrameCount(asset = {}, projectDir = '') {
  if (!asset || asset.type !== 'adpcm' || asset.options?.loop) return 0;
  const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
  const byteLength = (Number(generated.byteLength) || 0) || generatedFileByteLength(projectDir, generated.outputFile);
  const sampleRate = Number(asset.options?.sampleRate || generated.sampleRate) || 16000;
  let frames = 0;
  if (byteLength > 0 && sampleRate > 0) {
    frames = Math.ceil((byteLength * 2 * VN_ADPCM_FRAME_RATE) / sampleRate);
  } else {
    const durationSeconds = Number(generated.durationSeconds) || 0;
    if (durationSeconds > 0) frames = Math.ceil(durationSeconds * VN_ADPCM_FRAME_RATE);
  }
  if (!frames) return 0;
  return Math.min(65535, frames + VN_ADPCM_END_PAD_FRAMES);
}

function voiceSyncedTextSpeedFrames(command = {}, glyphCount = 0, assetDoc = { assets: [] }, projectDir = '') {
  const fallback = clampInt(command.textSpeedFrames, 0, 255, 2);
  if (!command.voiceAssetId || !glyphCount) return fallback;
  const frames = adpcmVoiceFrameCount(findAsset(assetDoc, command.voiceAssetId), projectDir);
  if (!frames) return fallback;
  return clampInt(Math.ceil(frames / glyphCount), 1, 255, 1);
}

function assetPixelSize(asset = {}) {
  const raw = asset && typeof asset === 'object' ? asset : {};
  const options = raw.options && typeof raw.options === 'object' ? raw.options : {};
  const generated = raw.data?.generated && typeof raw.data.generated === 'object' ? raw.data.generated : {};
  return {
    width: Math.round(Number(options.width || generated.width) || 0),
    height: Math.round(Number(options.height || generated.height) || 0),
  };
}

function validateFullScreenBgScene(scene = {}, assetDoc = { assets: [] }) {
  if (!scene.fullScreenBg) return;
  const sceneId = scene.id || 'scene';
  (scene.commands || []).forEach((command) => {
    if (!command) return;
    if (command.type === 'message' || command.type === 'choice') {
      throw new Error(`PCE VN scene "${sceneId}" uses fullScreenBg and cannot contain ${command.type} commands`);
    }
    if (command.type === 'sprite' && command.visible !== false) {
      throw new Error(`PCE VN scene "${sceneId}" uses fullScreenBg and cannot show sprites`);
    }
    if (command.type === 'spritetext' && command.visible !== false) {
      throw new Error(`PCE VN scene "${sceneId}" uses fullScreenBg and cannot show spritetext`);
    }
    if (command.type === 'background') {
      if (command.x || command.y) {
        throw new Error(`PCE VN scene "${sceneId}" uses fullScreenBg; background commands must use x:0 and y:0`);
      }
      const asset = findAsset(assetDoc, command.assetId);
      const size = assetPixelSize(asset);
      if (size.width !== PCE_SCREEN_WIDTH || size.height !== PCE_SCREEN_HEIGHT) {
        throw new Error(`PCE VN scene "${sceneId}" uses fullScreenBg; background "${command.assetId || '(none)'}" must be ${PCE_SCREEN_WIDTH}x${PCE_SCREEN_HEIGHT}px`);
      }
    }
  });
}

function spritePixelWidth(asset = {}) {
  const raw = asset && typeof asset === 'object' ? asset : {};
  const options = raw.options && typeof raw.options === 'object' ? raw.options : {};
  const generated = raw.data?.generated && typeof raw.data.generated === 'object' ? raw.data.generated : {};
  const width = assetPixelSize(asset).width;
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
    text: '256がめんです',
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
    text: '17もじx4ぎょう',
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
        fullScreenBg: false,
        commands,
        nextSceneId: '',
      },
    ],
  };
}

function normalizeFullScreenBg(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return value === true
    || raw === 'true'
    || raw === '1'
    || raw === 'full'
    || raw === 'fullscreen'
    || raw === 'full-screen'
    || raw === 'fullscreenbg'
    || raw === 'full-screen-bg';
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

// Snap a hex color string to a normalized "#rrggbb" form, or '' if blank/invalid.
function normalizeHexColor(value) {
  if (value == null) return '';
  let s = String(value).trim();
  if (!s) return '';
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '';
  return `#${s.toLowerCase()}`;
}

function hexToRgb(hex) {
  const s = hex.replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

// Snap a hex color to the nearest PCE-displayable color (3 bits/channel),
// returned as a normalized "#rrggbb" string, or '' when no color is set.
function normalizeMessageColor(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return '';
  const pce = assetManager.pceColorFromRgb(hexToRgb(hex));
  const to8 = (c) => Math.round((c & 7) * 255 / 7);
  return `#${[to8(pce.r), to8(pce.g), to8(pce.b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// Convert a message textColor to a 9-bit PCE palette word, or the
// VN_MESSAGE_COLOR_NONE sentinel when no override is set.
function messageColorWord(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return VN_MESSAGE_COLOR_NONE;
  return assetManager.pcePaletteWord(assetManager.pceColorFromRgb(hexToRgb(hex)));
}

// Convert a spritetext color to a 9-bit PCE palette word. Unlike message text
// this has no "none" sentinel: a blank/invalid color defaults to white (0x1ff).
function spriteTextColorWord(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return 0x1ff;
  return assetManager.pcePaletteWord(assetManager.pceColorFromRgb(hexToRgb(hex)));
}

function effectColorWord(value, fallback = '#000000') {
  const hex = normalizeHexColor(value) || normalizeHexColor(fallback) || '#000000';
  return assetManager.pcePaletteWord(assetManager.pceColorFromRgb(hexToRgb(hex)));
}

// Resolve a message body: only fall back to the placeholder when the field is
// absent. An explicitly empty body stays empty so it can clear the window.
function resolveMessageText(raw, index) {
  const fallback = index === 0 ? 'メッセージを入力してください。' : '';
  const value = raw.text == null ? fallback : String(raw.text);
  return value.trim().slice(0, 96);
}

function normalizeMessageCommand(message = {}, index = 0, valid = assetIdsByType()) {
  const raw = message && typeof message === 'object' ? message : {};
  const voiceAssetId = String(raw.voiceAssetId || '').trim();
  return {
    type: 'message',
    speaker: String(raw.speaker || '').trim().slice(0, 16),
    text: resolveMessageText(raw, index),
    textColor: normalizeMessageColor(raw.textColor),
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

function normalizeInputButtons(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const buttons = [];
  list.forEach((entry) => {
    const key = String(entry || '').trim().toLowerCase();
    if (VN_INPUT_BUTTON_BITS[key] !== undefined && !seen.has(key)) {
      seen.add(key);
      buttons.push(key);
    }
  });
  // Keep a stable canonical order.
  return VN_INPUT_BUTTON_KEYS.filter((key) => seen.has(key));
}

function inputButtonsMask(buttons = []) {
  return buttons.reduce((mask, key) => mask | (VN_INPUT_BUTTON_BITS[key] || 0), 0) & 0xff;
}

function normalizeInputMode(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'async') return 'async';
  if (raw === 'cancel') return 'cancel';
  return 'sync';
}

function normalizeInputCheckCommand(command = {}) {
  const raw = command && typeof command === 'object' ? command : {};
  const mode = normalizeInputMode(raw.mode);
  const buttons = mode === 'cancel' ? [] : normalizeInputButtons(raw.buttons);
  return {
    type: 'inputcheck',
    buttons: buttons.length ? buttons : (mode === 'cancel' ? [] : ['i']),
    mode,
    targetLabel: mode === 'cancel' ? '' : normalizeLabelName(raw.targetLabel || raw.label || raw.target || '', ''),
  };
}

function normalizeEffectKind(value = '') {
  const raw = String(value || '').trim();
  if (raw === 'fadeIn' || raw === 'fade-in' || raw === 'in') return 'fadeIn';
  if (raw === 'blank' || raw === 'black') return 'blank';
  if (raw === 'shake' || raw === 'screenShake' || raw === 'screen-shake') return 'shake';
  if (raw === 'flash') return 'flash';
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
    const kindHint = String(raw.kind
      || (actualType === 'adpcm' ? 'adpcm' : (actualType === 'psg-song' || actualType === 'psg-sfx' ? 'psg' : 'cdda')));
    const kind = kindHint === 'adpcm' ? 'adpcm' : (kindHint === 'psg' ? 'psg' : 'cdda');
    const validAsset = kind === 'adpcm'
      ? valid.adpcm?.has(assetId)
      : (kind === 'psg'
        ? (valid['psg-song']?.has(assetId) || valid['psg-sfx']?.has(assetId))
        : valid['cdda-track']?.has(assetId));
    return {
      type: 'audio',
      kind,
      action,
      assetId: action === 'play' && validAsset ? assetId : '',
      channel: clampInt(raw.channel, 0, 5, 0),
    };
  }
  if (type === 'inputcheck') {
    return normalizeInputCheckCommand(raw);
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
    const defaultColor = effect === 'flash' ? '#ffffff' : (effect === 'fadeOut' ? '#000000' : '');
    return {
      type: 'effect',
      effect,
      frames: clampInt(raw.frames ?? raw.durationFrames, 0, 255, 16),
      intensity: effect === 'shake' ? clampInt(raw.intensity ?? raw.power ?? raw.amplitude, 1, 16, 4) : 0,
      color: normalizeMessageColor(raw.color) || defaultColor,
    };
  }
  if (type === 'spritetext') {
    // Overlay a short string drawn with hardware sprites on top of the BG/UI.
    // `text` is intentionally length-capped: sprites share the 64-entry SATB and
    // the 16-per-scanline limit with character sprites, so this is for accents
    // like "PRESS RUN BUTTON", not full message bodies.
    const text = String(raw.text == null ? '' : raw.text).replace(/\r/g, '').slice(0, 64);
    const visible = raw.visible !== false;
    return {
      type: 'spritetext',
      slot: clampInt(raw.slot, 0, 3, 0),
      text,
      x: clampInt(raw.x, 0, 319, 0),
      y: clampInt(raw.y, 0, 223, 0),
      color: normalizeMessageColor(raw.color) || '#ffffff',
      blinkFrames: clampInt(raw.blinkFrames ?? raw.blink, 0, 255, 0),
      visible,
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
    fullScreenBg: normalizeFullScreenBg(raw.fullScreenBg ?? raw.fullscreenBg ?? raw.fullScreenBackground ?? raw.layout ?? raw.displayMode),
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

// Distinct characters used by `spritetext` commands across the whole VN. These
// are encoded into the sprite-format font (font_sprite.bin), kept separate from
// the BG glyph font so the BG font is not bloated by overlay-only characters.
// Returns [] when no scene uses spritetext (no sprite font is generated then).
function collectSpriteTextGlyphsRaw(doc) {
  const glyphs = [];
  const seen = new Set();
  let used = false;
  (doc.scenes || []).forEach((scene) => {
    (scene.commands || []).forEach((command) => {
      if (command.type !== 'spritetext') return;
      used = true;
      for (const char of String(command.text || '')) {
        if (char === '\n' || char === '\r') continue;
        if (!seen.has(char)) {
          seen.add(char);
          glyphs.push(char);
        }
      }
    });
  });
  return used ? glyphs : [];
}

// Build-time budget report for the glyph font. Masks stream to VRAM (after the
// 208-tile strip + blank tile), so with the 16-bit glyph index the binding limit
// is the VRAM the mask region occupies below the SATB (the index width no longer
// caps it). VN_MAX_GLYPH_COUNT is a headline slice; the VRAM check below is the
// real guard. Returns the byte/sector footprint plus warnings/errors.
function computeFontBudget(rawGlyphCount, tileBase) {
  const usedGlyphCount = Math.min(rawGlyphCount, VN_MAX_GLYPH_COUNT);
  const droppedGlyphCount = Math.max(0, rawGlyphCount - VN_MAX_GLYPH_COUNT);
  const byteSize = usedGlyphCount * FONT_BYTES_PER_GLYPH;
  const sectorCount = Math.max(1, Math.ceil(byteSize / VN_CD_SECTOR_BYTES));
  // VRAM layout: [strip 208 tiles][blank tile][glyph masks: glyphs*12 words]. The
  // blank tile sits at (tileBase + 208); the mask region starts one tile later. The
  // runtime derives the same addresses from PCE_VN_FONT_TILE_BASE.
  const blankTile = tileBase + VN_MSG_STRIP_TILES; // dedicated blank tile
  const maskBaseWord = (blankTile + 1) * 16;
  const maskEndWord = maskBaseWord + (usedGlyphCount * FONT_GLYPH_MASK_WORDS);
  const endTile = Math.ceil(maskEndWord / 16); // tile-aligned end (spritetext font + reporting)
  const warnings = [];
  const errors = [];
  if (droppedGlyphCount > 0) {
    warnings.push(`フォント: 使用文字が ${rawGlyphCount} 種類あり、上限 ${VN_MAX_GLYPH_COUNT} を超えています。`
      + `超過した ${droppedGlyphCount} 文字は空白として表示されます。シーンで使う文字種を減らしてください。`);
  } else if (usedGlyphCount >= VN_GLYPH_COUNT_SOFT_WARN) {
    warnings.push(`フォント: 使用文字が ${usedGlyphCount} 種類で上限 ${VN_MAX_GLYPH_COUNT} に近づいています。`);
  }
  if (maskEndWord > VN_SATB_VRAM_WORD) {
    errors.push(`フォント: グリフマスク領域 (tileBase ${tileBase} + 208タイル + ${usedGlyphCount} グリフ) が VRAM 末尾 (SATB word 0x7f00) を超えます。tileBase を下げるか文字種を減らしてください。`);
  } else if (endTile > VN_FONT_VRAM_TILE_SOFT_CEILING) {
    warnings.push(`フォント: グリフマスク末尾が tile ${endTile} でスプライトパターン領域に接近しています (推奨上限 ${VN_FONT_VRAM_TILE_SOFT_CEILING})。`);
  }
  return { usedGlyphCount, rawGlyphCount, droppedGlyphCount, byteSize, sectorCount, tileBase, blankTile, maskBaseWord, maskEndWord, endTile, warnings, errors };
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
  const bitmap = new Array(FONT_GLYPH_PX * FONT_GLYPH_PX).fill(0);
  if (glyph === ' ') return bitmap;
  for (let y = 1; y < FONT_GLYPH_PX - 1; y += 1) {
    for (let x = 1; x < FONT_GLYPH_PX - 1; x += 1) {
      const border = x === 1 || x === FONT_GLYPH_PX - 2 || y === 1 || y === FONT_GLYPH_PX - 2;
      const pattern = ((x * 17 + y * 31 + glyph.charCodeAt(0) + glyphIndex) % 7) === 0;
      bitmap[(y * FONT_GLYPH_PX) + x] = border || pattern ? 1 : 0;
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
  const pixelCount = FONT_GLYPH_PX * FONT_GLYPH_PX;
  if (glyph === ' ') return new Array(pixelCount).fill(0);
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
    '-i', `color=c=black:s=${FONT_GLYPH_PX}x${FONT_GLYPH_PX}`,
    '-vf', filter,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-',
  ], { maxBuffer: 1024 * 64 });
  if (proc.error || proc.status !== 0 || !Buffer.isBuffer(proc.stdout) || proc.stdout.length < pixelCount) {
    return null;
  }
  return Array.from(proc.stdout.subarray(0, pixelCount), (value) => (value >= normalized.threshold ? 1 : 0));
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
    img = Image.new("L", (${FONT_GLYPH_PX}, ${FONT_GLYPH_PX}), 0)
    if glyph != " ":
        draw = ImageDraw.Draw(img)
        bbox = draw.textbbox((0, 0), glyph, font=font)
        width = max(1, bbox[2] - bbox[0])
        height = max(1, bbox[3] - bbox[1])
        x = (${FONT_GLYPH_PX} - width) // 2 - bbox[0]
        y = (${FONT_GLYPH_PX} - height) // 2 - bbox[1]
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

// Encode a 12x12 glyph bitmap (0/1, 144 entries) as 12 mask words (24 bytes).
// Per row: high byte = pixels 0..7, low byte high-nibble = pixels 8..11, so the
// VRAM word's bit 0x8000 is the leftmost pixel. Bytes are emitted VRAM-word
// little-endian (low byte first) to match pce_editor_vram_copy / the runtime
// pce_vdc_copy_from_vram readback.
function encodeGlyphMask12(bitmap) {
  const buf = Buffer.alloc(FONT_BYTES_PER_GLYPH);
  for (let y = 0; y < FONT_GLYPH_PX; y += 1) {
    let hi = 0;
    let lo = 0;
    for (let x = 0; x < FONT_GLYPH_PX; x += 1) {
      if (!bitmap[(y * FONT_GLYPH_PX) + x]) continue;
      if (x < 8) hi |= (0x80 >> x);
      else lo |= (0x80 >> (x - 8));
    }
    buf[y * 2] = lo;
    buf[(y * 2) + 1] = hi;
  }
  return buf;
}

function encodeGlyphMaskData(bitmaps) {
  return Buffer.concat(bitmaps.map((bitmap) => encodeGlyphMask12(bitmap)));
}

// Encode a 12x12 glyph bitmap (0/1, 144 entries) as a single PCE 16x16 hardware
// sprite pattern (128 bytes), centering the 12x12 art in the 16x16 cell. Lit
// pixels map to color index 15 (all four bitplanes set); the runtime supplies
// the actual color via the reserved sprite palette bank's entry 15. Layout
// matches encodePceSpritePattern: per row y, byte (plane*32 + y*2) = right half,
// +1 = left half.
function encodeGlyphSpritePattern(bitmap) {
  const pattern = Buffer.alloc(128);
  const off = (16 - FONT_GLYPH_PX) >> 1; // center 12 in 16 -> 2px pad
  for (let gy = 0; gy < FONT_GLYPH_PX; gy += 1) {
    const y = gy + off;
    let left = 0;
    let right = 0;
    for (let gx = 0; gx < FONT_GLYPH_PX; gx += 1) {
      if (!bitmap[(gy * FONT_GLYPH_PX) + gx]) continue;
      const x = gx + off; // 2..13
      if (x < 8) left |= (0x80 >> x);
      else right |= (0x80 >> (x - 8));
    }
    for (let plane = 0; plane < 4; plane += 1) {
      pattern[(plane * 32) + (y * 2)] = right;
      pattern[(plane * 32) + (y * 2) + 1] = left;
    }
  }
  return pattern;
}

function encodeGlyphSpriteData(bitmaps) {
  return Buffer.concat(bitmaps.map((bitmap) => encodeGlyphSpritePattern(bitmap)));
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

function renderGlyphMaskData(glyphs, config = {}) {
  return encodeGlyphMaskData(renderGlyphBitmaps(glyphs, config).bitmaps);
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

// Index PSG assets in the same order the asset manager emits pce_editor_psg_assets[]
// (psg-song and psg-sfx share a single array, kept in document order).
function indexPsgAssets(assets) {
  const map = new Map();
  assets
    .filter((asset) => asset.type === 'psg-song' || asset.type === 'psg-sfx')
    .forEach((asset, index) => map.set(asset.id, index));
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
  pushU16(bytes, message.textColor);
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
  // spritetext commands carry their glyph stream inline; append it to the pack
  // data and patch the command's assetIndex to the resulting offset. Commands
  // are encoded after this, so the patched offset is picked up below.
  commands.forEach((command) => {
    if (command.type !== VN_COMMAND_SPRITETEXT) return;
    const glyphs = Buffer.isBuffer(command.spriteTextGlyphs) ? command.spriteTextGlyphs : Buffer.alloc(0);
    command.assetIndex = glyphs.length ? appendPackData(dataChunks, state, glyphs) : 0;
  });

  const header = Buffer.alloc(VN_SCENE_PACK_HEADER_SIZE);
  VN_SCENE_PACK_MAGIC.copy(header, 0);
  header.writeUInt8(VN_SCENE_PACK_VERSION, 4);
  header.writeUInt8(commands.length, 5);
  header.writeUInt8(messages.length, 6);
  header.writeUInt8(choices.length, 7);
  header.writeUInt8(switches.length, 8);
  header.writeUInt8(sceneBuild.flags || 0, 9);
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
  const fontTiles = encodeGlyphMaskData(fontRender.bitmaps);
  // Glyph masks live on the CD as a streamed data file, not in ram_bank132.
  const fontDataPath = normalizeRelativePath(VN_FONT_DATA_FILE);
  const fontDataAbsPath = path.join(projectDir, fontDataPath);
  ensureDirSync(path.dirname(fontDataAbsPath));
  fs.writeFileSync(fontDataAbsPath, fontTiles);

  // Sprite-format font for `spritetext` overlays. Only the characters used by
  // spritetext are encoded, and only when at least one scene uses the command.
  const spriteTextGlyphs = collectSpriteTextGlyphsRaw(doc).slice(0, VN_FONT_SPRITE_MAX_GLYPH_COUNT);
  const spriteGlyphIndex = new Map(spriteTextGlyphs.map((glyph, index) => [glyph, index]));
  const fontSpriteDataPath = normalizeRelativePath(VN_FONT_SPRITE_DATA_FILE);
  const fontSpriteDataAbsPath = path.join(projectDir, fontSpriteDataPath);
  const fontSpriteWarnings = [];
  let fontSpriteTiles = Buffer.alloc(0);
  let fontSpriteRenderer = '';
  // Place the sprite font right after the BG glyph font, in 32-word pattern
  // units (a 16x16 sprite pattern spans two units). This sits between the BG
  // font and the sprite asset region (default sprite tileBase 880).
  const fontSpritePatternBase = Math.ceil((fontBudget.endTile * 16) / 32);
  const fontSpritePaletteBank = clampInt(
    options.fontConfig?.spritePaletteBank ?? fontConfig.spritePaletteBank,
    0, 15, DEFAULT_FONT_SPRITE_PALETTE_BANK,
  );
  if (spriteTextGlyphs.length) {
    const fontSpriteRender = renderGlyphBitmaps(spriteTextGlyphs, fontConfig);
    fontSpriteRenderer = fontSpriteRender.renderer;
    fontSpriteTiles = encodeGlyphSpriteData(fontSpriteRender.bitmaps);
    ensureDirSync(path.dirname(fontSpriteDataAbsPath));
    fs.writeFileSync(fontSpriteDataAbsPath, fontSpriteTiles);
    // Warn (non-fatal) when the sprite font would collide with sprite asset
    // patterns or run past the SATB. Author controls glyph count, so this is a
    // budget hint rather than a hard error.
    const spriteFontEndWord = (fontSpritePatternBase + (spriteTextGlyphs.length * 2)) * 32;
    const spriteAssetTileBases = (assetDoc.assets || [])
      .filter((asset) => asset.type === 'sprite')
      .map((asset) => Number(asset.options?.tileBase))
      .filter((value) => Number.isFinite(value));
    const minSpriteAssetWord = spriteAssetTileBases.length
      ? Math.min(...spriteAssetTileBases) * 32
      : 880 * 32;
    if (spriteFontEndWord > 0x7f00) {
      fontSpriteWarnings.push(`スプライトフォント: ${spriteTextGlyphs.length} グリフが VRAM 末尾 (SATB) を超えます。spritetext の文字種を減らしてください。`);
    } else if (spriteFontEndWord > minSpriteAssetWord) {
      fontSpriteWarnings.push(`スプライトフォント: ${spriteTextGlyphs.length} グリフがスプライト asset の pattern 領域 (tileBase) と重なる可能性があります。spritetext の文字種を減らすか sprite tileBase を上げてください。`);
    }
  } else if (fs.existsSync(fontSpriteDataAbsPath)) {
    // No spritetext in the project: drop a stale generated file so the CD layout
    // does not keep reserving a sector for it.
    try { fs.unlinkSync(fontSpriteDataAbsPath); } catch (_) {}
  }
  const fontSpriteBudget = {
    glyphCount: spriteTextGlyphs.length,
    byteSize: fontSpriteTiles.length,
    sectorCount: Math.max(1, Math.ceil(fontSpriteTiles.length / VN_CD_SECTOR_BYTES)),
  };

  const imageIndex = indexAssets(assetDoc.assets || [], 'image');
  const spriteIndex = indexAssets(assetDoc.assets || [], 'sprite');
  const adpcmIndex = indexAssets(assetDoc.assets || [], 'adpcm');
  const cddaIndex = indexAssets(assetDoc.assets || [], 'cdda-track');
  const psgIndex = indexPsgAssets(assetDoc.assets || []);
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
    validateFullScreenBgScene(scene, assetDoc);
    const sceneBuild = {
      sceneId: scene.id || `scene_${sceneIdx}`,
      packPath: scenePackRelativePath(scene, sceneIdx),
      nextScene: scene.nextSceneId && sceneIndex.has(scene.nextSceneId) ? sceneIndex.get(scene.nextSceneId) : -1,
      flags: scene.fullScreenBg ? VN_SCENE_FLAG_FULL_SCREEN_BG : 0,
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
        let entryCount = 0;
        for (const glyph of messageDisplayText(command)) {
          if (glyph === '\r') continue;
          if (glyph === '\n') {
            bytes.push(GLYPH_NEWLINE_BYTE);
            entryCount += 1;
            continue;
          }
          pushGlyphIndexEntry(bytes, glyphIndex.get(glyph) ?? 0);
          entryCount += 1;
        }
        // glyph_count is the number of entries (glyphs + newlines), excluding the
        // terminator. It is stored as a u8, so cap at 255 entries.
        if (entryCount > VN_MAX_U8_COUNT) {
          throw new Error(`PCE VN message in scene "${sceneBuild.sceneId}" exceeds 255 glyphs`);
        }
        bytes.push(GLYPH_END_BYTE);
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
          glyphCount: entryCount,
          voiceIndex,
          textSpeedFrames: voiceSyncedTextSpeedFrames(command, entryCount, assetDoc, projectDir),
          advanceMode: command.advanceMode === 'auto' ? VN_ADVANCE_AUTO : VN_ADVANCE_BUTTON,
          autoWaitFrames: command.autoWaitFrames,
          mouthAnimationIndex,
          mouthSlot,
          textColor: messageColorWord(command.textColor),
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
        const kindCode = command.kind === 'adpcm'
          ? VN_AUDIO_KIND_ADPCM
          : (command.kind === 'psg' ? VN_AUDIO_KIND_PSG : VN_AUDIO_KIND_CDDA);
        const action = command.action === 'stop' ? VN_AUDIO_ACTION_STOP : VN_AUDIO_ACTION_PLAY;
        const lookupIndex = () => {
          if (kindCode === VN_AUDIO_KIND_ADPCM) return adpcmIndex.get(command.assetId) ?? -1;
          if (kindCode === VN_AUDIO_KIND_PSG) return psgIndex.get(command.assetId) ?? -1;
          return cddaIndex.get(command.assetId) ?? -1;
        };
        const assetIndex = command.action === 'play' ? lookupIndex() : -1;
        const flags = kindCode | action;
        pushCommand({
          type: VN_COMMAND_AUDIO,
          assetIndex,
          // For PSG, slot carries the base channel (0-5).
          slot: kindCode === VN_AUDIO_KIND_PSG ? clampInt(command.channel, 0, 5, 0) : 0,
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
      if (command.type === 'inputcheck') {
        const mode = command.mode === 'async'
          ? VN_INPUT_MODE_ASYNC
          : (command.mode === 'cancel' ? VN_INPUT_MODE_CANCEL : VN_INPUT_MODE_SYNC);
        pushCommand({
          type: VN_COMMAND_INPUTCHECK,
          assetIndex: -1,
          slot: 0,
          flags: mode,
          arg0: inputButtonsMask(command.buttons),
          arg1: 0,
          x: command.mode === 'cancel' ? VN_NO_COMMAND : labelCommand(command.targetLabel),
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
          let entryCount = 0;
          for (const glyph of String(option.label || '')) {
            if (glyph === '\r' || glyph === '\n') continue;
            pushGlyphIndexEntry(bytes, glyphIndex.get(glyph) ?? 0);
            entryCount += 1;
          }
          if (entryCount > VN_MAX_U8_COUNT) {
            throw new Error(`PCE VN choice label in scene "${sceneBuild.sceneId}" exceeds 255 glyphs`);
          }
          bytes.push(GLYPH_END_BYTE);
          const target = option.targetSceneId && sceneIndex.has(option.targetSceneId) ? sceneIndex.get(option.targetSceneId) : -1;
          return {
            glyphs: Buffer.from(bytes),
            glyphCount: entryCount,
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
          : (command.effect === 'blank'
            ? VN_EFFECT_BLANK
            : (command.effect === 'shake'
              ? VN_EFFECT_SHAKE
              : (command.effect === 'flash' ? VN_EFFECT_FLASH : VN_EFFECT_FADE_OUT)));
        const defaultColor = effect === VN_EFFECT_FLASH ? '#ffffff' : '#000000';
        pushCommand({
          type: VN_COMMAND_EFFECT,
          assetIndex: -1,
          slot: 0,
          flags: effect,
          arg0: clampInt(command.frames, 0, 255, 16),
          arg1: clampInt(command.intensity, 0, 16, 0),
          x: effectColorWord(command.color, defaultColor),
          y: 0,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
      }
      if (command.type === 'spritetext') {
        const glyphBytes = [];
        for (const char of String(command.text || '')) {
          if (glyphBytes.length >= VN_SPRITETEXT_MAX_GLYPHS) break;
          if (char === '\n') { glyphBytes.push(0xfe); continue; }
          if (char === '\r') continue;
          if (spriteGlyphIndex.has(char)) glyphBytes.push(spriteGlyphIndex.get(char));
        }
        pushCommand({
          type: VN_COMMAND_SPRITETEXT,
          // assetIndex is patched to the glyph data offset in buildScenePack.
          assetIndex: 0,
          slot: clampInt(command.slot, 0, 3, 0),
          flags: command.visible ? VN_SPRITE_VISIBLE : 0,
          arg0: clampInt(command.blinkFrames, 0, 255, 0),
          arg1: glyphBytes.length,
          x: clampInt(command.x, 0, 319, 0),
          y: clampInt(command.y, 0, 223, 0),
          messageIndex: spriteTextColorWord(command.color),
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
          spriteTextGlyphs: Buffer.from(glyphBytes),
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
  const fontSpriteLayout = cdLayout.get(fontSpriteDataPath) || {};
  const fontSpriteSectorCount = fontSpriteBudget.byteSize
    ? (fontSpriteLayout.sectorCount || fontSpriteBudget.sectorCount)
    : 0;
  const fontSpriteDataInitializer = `{ ${cdSectorInitializer(fontSpriteLayout)}, ${fontSpriteSectorCount}u, ${fontSpriteBudget.byteSize}u }`;
  // Overlay code blob CD ref. The blob is extracted from main.elf AFTER this link
  // (finalizeOverlayBlob), but its on-CD footprint is reserved up front at a fixed
  // size so the CD sector assigned here matches what mkcd writes. ensureOverlayBin
  // guarantees overlay.bin already exists at the reserved size, so cdLayout (which
  // stats files) puts it on a stable sector. Zeroed only when reservation was
  // skipped (no toolchain), in which case the runtime loader is a no-op.
  const overlayDataPath = normalizeRelativePath(VN_OVERLAY_DATA_FILE);
  const overlayAbsPath = path.join(projectDir, overlayDataPath);
  const overlayExists = fs.existsSync(overlayAbsPath);
  const overlayLayout = overlayExists ? (cdLayout.get(overlayDataPath) || {}) : {};
  const overlayByteSize = overlayExists ? fs.statSync(overlayAbsPath).size : 0;
  const overlaySectorCount = overlayExists
    ? (overlayLayout.sectorCount || Math.max(1, Math.ceil(overlayByteSize / VN_CD_SECTOR_BYTES)))
    : 0;
  const overlayDataInitializer = `{ ${cdSectorInitializer(overlayLayout)}, ${overlaySectorCount}u, ${overlayByteSize}u }`;
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
    `#define PCE_VN_COMMAND_INPUTCHECK ${VN_COMMAND_INPUTCHECK}u`,
    `#define PCE_VN_COMMAND_SPRITETEXT ${VN_COMMAND_SPRITETEXT}u`,
    `#define PCE_VN_BG_TRANSITION_CUT ${VN_BG_TRANSITION_CUT}u`,
    `#define PCE_VN_BG_TRANSITION_FADE ${VN_BG_TRANSITION_FADE}u`,
    `#define PCE_VN_SPRITE_VISIBLE ${VN_SPRITE_VISIBLE}u`,
    `#define PCE_VN_SPRITE_FLIP_X ${VN_SPRITE_FLIP_X}u`,
    `#define PCE_VN_SPRITE_FLIP_Y ${VN_SPRITE_FLIP_Y}u`,
    `#define PCE_VN_AUDIO_KIND_ADPCM ${VN_AUDIO_KIND_ADPCM}u`,
    `#define PCE_VN_AUDIO_KIND_CDDA ${VN_AUDIO_KIND_CDDA}u`,
    `#define PCE_VN_AUDIO_KIND_PSG ${VN_AUDIO_KIND_PSG}u`,
    `#define PCE_VN_AUDIO_ACTION_PLAY ${VN_AUDIO_ACTION_PLAY}u`,
    `#define PCE_VN_AUDIO_ACTION_STOP ${VN_AUDIO_ACTION_STOP}u`,
    `#define PCE_VN_INPUT_MODE_SYNC ${VN_INPUT_MODE_SYNC}u`,
    `#define PCE_VN_INPUT_MODE_ASYNC ${VN_INPUT_MODE_ASYNC}u`,
    `#define PCE_VN_INPUT_MODE_CANCEL ${VN_INPUT_MODE_CANCEL}u`,
    `#define PCE_VN_MESSAGE_COLOR_NONE ${VN_MESSAGE_COLOR_NONE}u`,
    `#define PCE_VN_EFFECT_FADE_OUT ${VN_EFFECT_FADE_OUT}u`,
    `#define PCE_VN_EFFECT_FADE_IN ${VN_EFFECT_FADE_IN}u`,
    `#define PCE_VN_EFFECT_BLANK ${VN_EFFECT_BLANK}u`,
    `#define PCE_VN_EFFECT_SHAKE ${VN_EFFECT_SHAKE}u`,
    `#define PCE_VN_EFFECT_FLASH ${VN_EFFECT_FLASH}u`,
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
    `#define PCE_VN_SCENE_FLAG_FULL_SCREEN_BG ${VN_SCENE_FLAG_FULL_SCREEN_BG}u`,
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
    '  unsigned int text_color;',
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
    '#define PCE_VN_GLYPH_END 0xffffu',
    '#define PCE_VN_GLYPH_NEWLINE 0xfffeu',
    '#define PCE_VN_GLYPH_ESCAPE 0xfdu',
    `#define PCE_VN_FONT_SPRITE_PATTERN_BASE ${fontSpritePatternBase}u`,
    `#define PCE_VN_FONT_SPRITE_PALETTE_BANK ${fontSpritePaletteBank}u`,
    '',
    '#if defined(__PCE_CD__)',
    'extern const pce_vn_cd_data_ref_t pce_vn_font_data;',
    `#define PCE_VN_OVERLAY_LOAD_ADDR ${VN_OVERLAY_VRAM_LOAD_ADDR}u`,
    'extern const pce_vn_cd_data_ref_t pce_vn_overlay_data;',
    '#else',
    'extern const unsigned char pce_vn_font_tiles[];',
    '#endif',
    'extern const unsigned char pce_vn_font_glyph_count;',
    'void pce_vn_font_tiles_map(void);',
    '#if defined(__PCE_CD__)',
    'extern const pce_vn_cd_data_ref_t pce_vn_font_sprite_data;',
    '#else',
    'extern const unsigned char pce_vn_font_sprite_tiles[];',
    '#endif',
    'extern const unsigned char pce_vn_font_sprite_glyph_count;',
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
    `const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_overlay_data = ${overlayDataInitializer};`,
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
    '#if defined(__PCE_CD__)',
    `const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_font_sprite_data = ${fontSpriteDataInitializer};`,
    '#else',
    ...(fontSpriteTiles.length
      ? bytesToCArray('PCE_VN_FONT_SECTION pce_vn_font_sprite_tiles', fontSpriteTiles, 'const unsigned char')
      : ['const unsigned char PCE_VN_FONT_SECTION pce_vn_font_sprite_tiles[] = { 0u };']),
    '#endif',
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_font_sprite_glyph_count = ${fontSpriteBudget.glyphCount}u;`,
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
    fontSpriteDataPath,
    fontSpriteGlyphCount: fontSpriteBudget.glyphCount,
    fontSpriteByteSize: fontSpriteBudget.byteSize,
    fontSpritePatternBase,
    fontSpritePaletteBank,
    fontSpriteRenderer,
    warnings: [...fontBudget.warnings, ...fontSpriteWarnings],
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
  const render = renderGlyphBitmaps(glyphs.slice(0, VN_MAX_GLYPH_COUNT), config);
  return {
    config,
    text,
    glyphs: glyphs.slice(0, VN_MAX_GLYPH_COUNT).map((glyph, index) => ({ glyph, bitmap: render.bitmaps[index] })),
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
  // Overlay code blob, streamed into bank133 at boot. Placed right after the font
  // so its CD sector stays stable across scene edits. Only when it was built.
  addExistingCdDataFile(projectDir, files, seen, VN_OVERLAY_DATA_FILE);
  // The sprite-format font is only generated when spritetext is used; include it
  // only when the file actually exists so we never reserve a sector for nothing.
  addExistingCdDataFile(projectDir, files, seen, VN_FONT_SPRITE_DATA_FILE);
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
  // Remove the obsolete Phase B0 standalone overlay TU if a previous build left it
  // in the project; the overlay code now lives in pce_vn_runtime.c.
  const legacyOverlaySrc = path.join(projectDir, 'src', 'pce_vn_overlay.c');
  if (fs.existsSync(legacyOverlaySrc)) {
    try { fs.unlinkSync(legacyOverlaySrc); } catch (_) { /* best-effort */ }
  }
  if (changed) logger?.info?.('PCE visual novel runtime を src/ に同期しました');
  return { changed };
}

// Absolute path of the linker fragment that places the .vn_overlay section. The
// main link must include it via -Wl,-T (see overlayLinkerArgs()).
function overlayFragmentPath(projectDir) {
  return path.join(projectDir, VN_OVERLAY_FRAGMENT_FILE);
}

// Extra clang/link args that splice the overlay section into the main link, or []
// when no fragment has been written (non-VN or reservation skipped).
function overlayLinkerArgs(projectDir) {
  const fragment = overlayFragmentPath(projectDir);
  return fs.existsSync(fragment) ? [`-Wl,-T,${fragment}`] : [];
}

// Write the INSERT linker fragment. It locates .vn_overlay at CPU 0x8000 (run
// address in MPR slot 4) with its LMA in bank132's unused tail, so the section is
// PROGBITS (objcopy can extract it) and the in-image copy the IPL loads is benign.
// INSERT AFTER keeps the SDK's own SECTIONS (zp/imag-regs, banks) intact.
function writeOverlayFragment(projectDir) {
  const fragment = overlayFragmentPath(projectDir);
  ensureDirSync(path.dirname(fragment));
  const lma = `0x${VN_OVERLAY_LMA.toString(16)}`;
  const vma = `0x${VN_OVERLAY_VRAM_LOAD_ADDR.toString(16)}`;
  const body = [
    'SECTIONS {',
    `  ${VN_OVERLAY_SECTION} ${vma} : AT(${lma}) {`,
    '    __vn_overlay_start = .;',
    `    KEEP(*(${VN_OVERLAY_SECTION} ${VN_OVERLAY_SECTION}.*))`,
    '    __vn_overlay_end = .;',
    '  }',
    '} INSERT AFTER .ram_bank132;',
    '',
  ].join('\n');
  const prev = fs.existsSync(fragment) ? fs.readFileSync(fragment, 'utf-8') : null;
  if (prev !== body) fs.writeFileSync(fragment, body);
  return fragment;
}

// Ensure overlay.bin exists at exactly the reserved size BEFORE generateVnSources
// runs, so buildCdDataLayout (which stats files) assigns a stable CD sector that
// matches what mkcd writes. The real bytes are filled in by finalizeOverlayBlob
// after the link; this just reserves the footprint (zero-fill placeholder when
// missing or wrong-sized; an existing correctly-sized blob is left untouched).
function ensureOverlayReservation(projectDir) {
  const overlayBin = path.join(projectDir, VN_OVERLAY_DATA_FILE);
  ensureDirSync(path.dirname(overlayBin));
  const ok = fs.existsSync(overlayBin) && fs.statSync(overlayBin).size === VN_OVERLAY_RESERVED_BYTES;
  if (!ok) fs.writeFileSync(overlayBin, Buffer.alloc(VN_OVERLAY_RESERVED_BYTES));
  return { byteSize: VN_OVERLAY_RESERVED_BYTES, sectorCount: VN_OVERLAY_RESERVED_SECTORS };
}

// Post-link: objcopy the .vn_overlay section out of the freshly linked main.elf
// into overlay.bin (padded to the reserved size so the reserved CD sector still
// matches), THEN strip the section's relocation table (.rela.vn_overlay) from
// main.elf in place. The strip is required because pce-mkcd RE-APPLIES the ELF's
// relocations when it assembles the image, and the overlay's internal relocations
// live at the overlay's run-address VMA (CPU 0x8000, MPR slot 4) which is outside
// the encoded bank range mkcd accepts ("File address 0x8001 out of range"). lld
// already applied those relocations in the executable, so the extracted overlay.bin
// is final machine code; dropping .rela.vn_overlay just stops mkcd from re-applying
// them. The .vn_overlay section itself stays (its benign LMA copy loads into
// bank132's unused tail and keeps the dispatcher's direct calls resolvable); the
// resident code banks are unaffected, so bank130 stays relieved. Errors if the
// section is missing or exceeds the reservation. Returns {realSize, byteSize} or
// null when there is no toolchain / elf.
function finalizeOverlayBlob(projectDir, elfPath, clangPath, logger) {
  if (!clangPath || !elfPath || !fs.existsSync(elfPath)) return null;
  const binDir = path.dirname(clangPath);
  // The toolchain driver (mos-pce-cd-clang) is a .bat wrapper on Windows, but
  // llvm-objcopy ships as a native .exe there — NOT a .bat. Deriving objcopy's
  // extension from the driver yields a nonexistent llvm-objcopy.bat, and Node
  // additionally throws EINVAL when spawnSync targets a .bat/.cmd without
  // shell:true. So probe for the real binary (prefer .exe on Windows) instead of
  // copying the driver's extension, and only fall back to shell execution if all
  // that exists is a .bat/.cmd wrapper.
  const objcopyCandidates = process.platform === 'win32'
    ? ['llvm-objcopy.exe', 'llvm-objcopy.cmd', 'llvm-objcopy.bat', 'llvm-objcopy']
    : ['llvm-objcopy'];
  let objcopy = path.join(binDir, objcopyCandidates[0]);
  for (const name of objcopyCandidates) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) { objcopy = candidate; break; }
  }
  const useShell = process.platform === 'win32' && /\.(bat|cmd)$/i.test(objcopy);
  const run = (args, label) => {
    const r = spawnSync(objcopy, args, { encoding: 'utf-8', windowsHide: true, shell: useShell });
    if (r.error || r.status !== 0) {
      throw new Error(`overlay ${label} failed: ${r.stderr || r.stdout || r.error || `exit ${r.status}`}`);
    }
  };
  const overlayBin = path.join(projectDir, VN_OVERLAY_DATA_FILE);
  ensureDirSync(path.dirname(overlayBin));
  run(['-O', 'binary', `--only-section=${VN_OVERLAY_SECTION}`, elfPath, overlayBin], 'objcopy extract');
  const realSize = fs.existsSync(overlayBin) ? fs.statSync(overlayBin).size : 0;
  if (realSize === 0) {
    throw new Error(`overlay section ${VN_OVERLAY_SECTION} was empty in ${path.basename(elfPath)} — overlay code not linked`);
  }
  if (realSize > VN_OVERLAY_RESERVED_BYTES) {
    throw new Error(`overlay code ${realSize} bytes exceeds reserved ${VN_OVERLAY_RESERVED_BYTES} bytes (${VN_OVERLAY_RESERVED_SECTORS} sectors). Move fewer functions into VN_OVERLAY_CODE or raise VN_OVERLAY_RESERVED_SECTORS (and confirm the bank132-tail LMA still fits).`);
  }
  if (realSize < VN_OVERLAY_RESERVED_BYTES) {
    const buf = Buffer.alloc(VN_OVERLAY_RESERVED_BYTES);
    fs.readFileSync(overlayBin).copy(buf);
    fs.writeFileSync(overlayBin, buf);
  }
  // Strip the overlay's relocation table so mkcd does not re-apply overlay-internal
  // relocations at the out-of-range 0x8000 VMA (the section itself stays). Write the
  // stripped result to a temp file and atomically rename it over main.elf rather than
  // letting llvm-objcopy rewrite the ELF in place: on Windows an in-place rewrite can
  // race with antivirus/file-indexing scanning the freshly written executable and
  // leave a transient ZERO-LENGTH main.elf. pce-mkcd mmaps the ELF without checking
  // the result and SEGFAULTS (exit 0xC0000005 / 3221225781) on an empty input, which
  // surfaced as "pce-mkcd failed (exit code: 3221225781)" with the probe also failing.
  // Verifying the temp is non-empty before the rename guarantees mkcd never observes a
  // half-written ELF. (macOS never hit this because there is no such scanner race.)
  const strippedElf = `${elfPath}.stripped`;
  run(['--remove-section', `.rela${VN_OVERLAY_SECTION}`, elfPath, strippedElf], 'objcopy strip rela');
  const strippedSize = fs.existsSync(strippedElf) ? fs.statSync(strippedElf).size : 0;
  if (strippedSize === 0) {
    try { if (fs.existsSync(strippedElf)) fs.unlinkSync(strippedElf); } catch (_) {}
    throw new Error(`overlay strip produced an empty ELF (${path.basename(strippedElf)}) — aborting before pce-mkcd to avoid a crash on an unreadable ELF`);
  }
  fs.renameSync(strippedElf, elfPath);
  logger?.info?.(`PCE VN overlay blob: ${realSize} bytes (reserved ${VN_OVERLAY_RESERVED_BYTES}) を main.elf から ${VN_OVERLAY_DATA_FILE} に抽出 (.rela${VN_OVERLAY_SECTION} 除去)`);
  return { realSize, byteSize: VN_OVERLAY_RESERVED_BYTES };
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
  addManagedGeneratedPath(managed, VN_OVERLAY_DATA_FILE);
  addManagedGeneratedPath(managed, VN_FONT_SPRITE_DATA_FILE);
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

function prepareVisualNovelBuild(projectDir, config = {}, clangPath = null) {
  syncVisualNovelRuntime(projectDir);
  ensureSceneFile(projectDir);
  // Reserve the overlay blob's CD footprint and write the linker fragment BEFORE
  // generating sources / computing the CD layout. The actual overlay bytes are
  // extracted from main.elf after the link by finalizeOverlayBlob(); reserving a
  // fixed size up front keeps the CD sector stable across that two-step flow.
  // (clangPath is unused here now — extraction needs the linked main.elf and runs
  // in the build system post-link.)
  ensureOverlayReservation(projectDir);
  writeOverlayFragment(projectDir);
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
  VN_FONT_SPRITE_DATA_FILE,
  VN_MAX_GLYPH_COUNT,
  DEFAULT_FONT_TILE_BASE,
  DEFAULT_FONT_CONFIG,
  GLYPH_END_BYTE,
  GLYPH_NEWLINE_BYTE,
  GLYPH_ESCAPE_BYTE,
  GLYPH_DIRECT_MAX,
  pushGlyphIndexEntry,
  VN_GLYPH_COUNT_SOFT_WARN,
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
  VN_COMMAND_INPUTCHECK,
  VN_COMMAND_SPRITETEXT,
  VN_SPRITE_VISIBLE,
  VN_AUDIO_KIND_PSG,
  VN_INPUT_MODE_SYNC,
  VN_INPUT_MODE_ASYNC,
  VN_INPUT_MODE_CANCEL,
  VN_SCENE_PACK_MESSAGE_SIZE,
  VN_MESSAGE_COLOR_NONE,
  VN_SCENE_FLAG_FULL_SCREEN_BG,
  inputButtonsMask,
  effectColorWord,
  messageColorWord,
  normalizeMessageColor,
  collectCdDataFiles,
  collectGlyphs,
  collectGlyphsRaw,
  collectSpriteTextGlyphsRaw,
  computeFontBudget,
  defaultSceneDocument,
  encodeGlyphMask12,
  encodeGlyphMaskData,
  encodeGlyphSpriteData,
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
  renderGlyphMaskData,
  finalizeOverlayBlob,
  overlayLinkerArgs,
  overlayFragmentPath,
  syncVisualNovelRuntime,
  writeFontConfig,
  writeSceneDocument,
};
