'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const assetManager = require('./pce-asset-manager');
const { mergeCurrentCdDataFiles } = require('./pce-vn-cd-data-files');
const { createVnCdCatalog } = require('./pce-vn-cd-catalog');
const { createVnScenePackCodec } = require('./pce-vn-scene-pack');
const systemCardPsg = require('./pce-system-card-psg');
const systemCardFont = require('./pce-system-card-font');

const VN_SCENE_FILE = path.join('assets', 'pce-vn-scenes.json');
const VN_FONT_FILE = path.join('assets', 'pce-font.json');
// Imported font files are copied here (project-relative) so builds do not
// depend on an external absolute path that may move or become unavailable.
const VN_FONT_DIR = path.join('assets', 'fonts');
const FONT_FILE_EXTS = ['.ttf', '.otf', '.ttc'];
const VN_BUILD_STAMP_FILE = path.join('assets', 'generated', 'vn', 'build-stamp.json');
const VN_BUILD_STAMP_VERSION = 5;
const PCE_VISUAL_NOVEL_BUILDER_ID = 'pce-visual-novel-builder';
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
const MESSAGE_WAIT_GLYPH = '▼';
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
const DEFAULT_FONT_TILE_BASE = 540;
const PCE_SCREEN_WIDTH = 256;
const PCE_SCREEN_HEIGHT = 224;
const VN_BG_DEFAULT_TILE_X = 2;
const VN_BG_DEFAULT_TILE_Y = 1;
const DEFAULT_CHARACTER_Y = 24;
const VN_VERSION = 2;
const VN_COMMAND_BACKGROUND = 0;
const VN_COMMAND_SPRITE = 1;
const VN_COMMAND_MESSAGE = 2;
const VN_COMMAND_AUDIO = 3;
const VN_COMMAND_CHOICE = 4;
const VN_COMMAND_JUMP = 5;
const VN_COMMAND_WAIT = 6;
const VN_COMMAND_EFFECT = 7;
const VN_COMMAND_VARIABLE = 8;
const VN_COMMAND_IF = 9;
const VN_COMMAND_SWITCH = 10;
const VN_COMMAND_LABEL = 11;
const VN_COMMAND_GOTO = 12;
const VN_COMMAND_INPUTCHECK = 13;
const VN_COMMAND_SPRITETEXT = 14;
const VN_COMMAND_CACHE = 15;
const VN_COMMAND_SPRITE_MOVE = 16;
const VN_SPRITE_MOVE_ASYNC = 1;
const VN_CACHE_ACTION_CLEAR = 0;
const VN_CACHE_ACTION_LOAD = 1;
const VN_CACHE_SCOPE_VISUAL = 0;
const VN_CACHE_SCOPE_BG = 1;
const VN_CACHE_SCOPE_SPRITE = 2;
const VN_CACHE_SCOPE_ADPCM = 3;
const VN_CACHE_SCOPE_PSG = 4;
const VN_CACHE_SCOPE_ALL = 5;
const VN_CACHE_SCOPES = ['visual', 'bg', 'sprite', 'adpcm', 'psg', 'all'];
const VN_ENABLE_VISUAL_PAYLOAD_CACHE = true;
const VN_BG_TRANSITION_CUT = 0;
const VN_BG_TRANSITION_FADE = 1;
const VN_BG_FADE_FRAME_OPTIONS = [10, 20, 30, 40, 50, 60];
const VN_BG_DEFAULT_FADE_FRAMES = 30;
const VN_MESSAGE_SPEED_FRAME_OPTIONS = [0, 10, 20, 30, 40, 50];
const VN_DEFAULT_MESSAGE_SPEED_FRAMES = 10;
const VN_DEFAULT_MESSAGE_AUTO_WAIT_FRAMES = 60;
const VN_VARIABLE_AUTO_ENABLE_NAME = 'AUTO_ENABLE';
const VN_VARIABLE_MSG_SPEED_NAME = 'MSG_SPEED';
const VN_VARIABLE_AUTO_ENABLE_INDEX = 0;
const VN_VARIABLE_MSG_SPEED_INDEX = 1;
const VN_RESERVED_VARIABLE_COUNT = 2;
const VN_SPRITE_VISIBLE = 1;
const VN_SPRITE_FLIP_X = 2;
const VN_SPRITE_FLIP_Y = 4;
const VN_AUDIO_KIND_ADPCM = 0;
const VN_AUDIO_KIND_CDDA = 1;
const VN_AUDIO_KIND_PSG = 2;
const VN_AUDIO_ACTION_PLAY = 0x10;
const VN_AUDIO_ACTION_STOP = 0x20;
const VN_PSG_STOP_ALL = 0;
const VN_PSG_STOP_BGM = 1;
const VN_PSG_STOP_SFX = 2;
// Input check command modes (stored in command flags).
const VN_INPUT_MODE_SYNC = 0;
const VN_INPUT_MODE_ASYNC = 1;
const VN_INPUT_MODE_CANCEL = 2;
// Joypad button bits, matching the VN runtime PAD_* constants.
const VN_PAD_I = 0x01;
const VN_PAD_II = 0x02;
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
  run: VN_PAD_RUN,
  i: VN_PAD_I,
  ii: VN_PAD_II,
};
const VN_INPUT_BUTTON_KEYS = ['up', 'down', 'left', 'right', 'run', 'i', 'ii'];
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
const VN_SPRITE_FRAME_DELAY_MAX = 0xffff;
const VN_MAX_U8_COUNT = 255;
const VN_MAX_SPRITE_ANIMATION_COUNT = 512;
const VN_SCENE_FLAG_FULL_SCREEN_BG = 1;
const VN_SCENE_PACK_DIR = path.join('assets', 'generated', 'vn', 'scenes');
// HuCard-only message font payload. CD builds obtain glyphs from EX_GETFNT and
// keep this path solely in managed-output cleanup so stale files are removed.
const VN_FONT_DATA_FILE = path.join('assets', 'generated', 'vn', 'font.bin');
// Overlay code blob (Path B, Phase B1). The overlay functions now live in
// pce_vn_runtime.c (section .vn_overlay), compiled in the SAME link as the main
// program so zp imaginary registers and resident symbols resolve. The linker
// fragment overlay_insert.ld places .vn_overlay in its OWN load region
// (ram_bank133, VN_OVERLAY_LINK_ADDR, low 16 bits = CPU 0x8000 / MPR slot 4),
// then finalizeOverlayBlob() objcopy's the section out into overlay.bin AND
// removes the section + neutralizes its PT_LOAD program header (exactly like the
// bank121 visual-code blob). Resident code reaches the overlay ONLY through a
// single fixed entry via an indirect call to the literal CPU 0x8000 (see
// vn_overlay_entry / VN_OVERLAY_CALL in pce_vn_runtime.c), so there is no
// resident->overlay relocation pinning the section in the image. That frees the
// overlay from the old bank132-tail benign-LMA window (~4 KB cap) and lets it use
// the FULL physical bank133 (8 KB), streamed in at boot (the IPL only auto-loads
// banks 128-132), time-shared into slot 4 with bank130/bank121.
// overlay.bin is reserved at a fixed size up front (so its CD sector is assigned
// before the link) and the extracted section is padded to that size afterwards.
const VN_OVERLAY_DATA_FILE = path.join('assets', 'generated', 'vn', 'overlay.bin');
const VN_OVERLAY_FRAGMENT_FILE = path.join('src', 'generated', 'overlay_insert.ld');
const VN_OVERLAY_SECTION = '.vn_overlay';
const VN_OVERLAY_VRAM_LOAD_ADDR = 0x8000; // CPU address the overlay runs at (slot 4)
// Linker load region for .vn_overlay: ram_bank133 (ORIGIN 0x01850000 + 0x8000).
// Its low 16 bits are 0x8000 so the code executes at CPU 0x8000; the high bits
// only separate it from bank130 (0x0182xxxx) in the linker's address space. The
// section is dropped from the ELF after extraction, so this is purely link-time.
const VN_OVERLAY_LINK_ADDR = 0x01858000;
// Reserved on-CD/bank133 size for the overlay blob, in whole CD sectors. The
// extracted .vn_overlay must fit this. Four sectors (8 KB) = the full physical
// bank133, giving durable headroom for engine code that does not fit the three
// resident code banks (128/129/130).
const VN_OVERLAY_RESERVED_SECTORS = 4;
const VN_OVERLAY_RESERVED_BYTES = VN_OVERLAY_RESERVED_SECTORS * 2048; // 2048 = VN_CD_SECTOR_BYTES (defined below)
// Experimental Super CD-ROM2 visual cache. Helper code is loaded into bank121,
// while raw BG/Sprite payload pages use low System Card RAM banks 104-119. Keep
// this behind one constant so the build can be switched back to the CD->scratch
// path if a target emulator/hardware combination rejects the low-RAM cache.
const VN_VISUAL_CODE_DATA_FILE = path.join('assets', 'generated', 'vn', 'visual_code.bin');
const VN_VISUAL_CODE_SECTION = '.vn_visual_code';
const VN_VISUAL_CODE_VRAM_LOAD_ADDR = 0x8000;
const VN_VISUAL_CODE_LINK_ADDR = 0x01798000;
const VN_VISUAL_CODE_RESERVED_SECTORS = 4;
const VN_VISUAL_CODE_RESERVED_BYTES = VN_VISUAL_CODE_RESERVED_SECTORS * 2048;
// Experimental low-level CD data reader helper code. This is kept out of the
// crowded resident banks and out of the bank121 visual helper/cache design: the
// blob is streamed into bank122 and mapped into slot 4 only while direct SCSI
// service code runs.
const VN_CD_ASYNC_CODE_DATA_FILE = path.join('assets', 'generated', 'vn', 'cd_async_code.bin');
const VN_CD_ASYNC_CODE_SECTION = '.vn_cd_async_code';
const VN_CD_ASYNC_CODE_VRAM_LOAD_ADDR = 0x8000;
const VN_CD_ASYNC_CODE_LINK_ADDR = 0x017a8000;
const VN_CD_ASYNC_CODE_RESERVED_SECTORS = 4;
const VN_CD_ASYNC_CODE_RESERVED_BYTES = VN_CD_ASYNC_CODE_RESERVED_SECTORS * 2048;
// CPU run-address (MPR slot 6) of the .ram_bank132_tail NOLOAD buffers. bank132
// (8 KB) holds GROWING resident metadata (cd_data_refs, sprite cell_maps, the
// scene-pack directory) climbing up from 0xc000, while the large write-before-read
// runtime buffers (cd_transfer_scratch + message_glyph_cache_masks + BG palette
// storage, ~3.9 KB) live NOLOAD in the tail at 0xd078..0xdfff. Previously this
// tail also doubled as the overlay's benign LMA window; the overlay now loads to
// bank133, so the tail is just plain bank132 RAM and the metadata budget
// [0xc000, 0xd078) is unchanged.
const VN_BANK132_TAIL_VMA = 0xd078;
// Sprite-format copy of the glyphs used by `spritetext` commands. Only the
// characters referenced by spritetext are encoded here (BG-format font tiles
// cannot be reused for hardware sprites), so this stays small even when the BG
// HuCard-only SpriteText payload. One visible glyph is 12x12 px, centered in a
// 16x16 hardware sprite (= 128 bytes of pattern data); CD builds obtain the
// same 12x12 glyph from EX_GETFNT and convert it on demand.
const VN_FONT_SPRITE_DATA_FILE = path.join('assets', 'generated', 'vn', 'font_sprite.bin');
const VN_HUCARD_PSG_DIR = path.join('assets', 'generated', 'vn', 'psg');
const VN_SYSTEM_CARD_PSG_DIR = path.join('assets', 'generated', 'vn', 'system-card-psg');
// VCE sprite palette bank reserved for spritetext glyphs. Lit pixels use color
// index 15 of this bank; the runtime writes each command's color into that
// entry at draw time. Keep clear of the sprite asset palette banks (default 1).
const DEFAULT_FONT_SPRITE_PALETTE_BANK = 15;
// Upper bound of drawable glyphs per spritetext command (matches the runtime
// per-slot buffer). Newlines (0xfe) count toward this budget.
const VN_SPRITETEXT_MAX_GLYPHS = 32;
// CD builds convert SpriteText glyphs through EX_GETFNT on demand. The runtime
// cache has a 64-glyph hard ceiling, but the VRAM reservation only needs the
// distinct glyphs that the compiled scene document can actually request.
const VN_CD_SPRITETEXT_CACHE_MAX_GLYPHS = 64;
// Number of distinct sprite-font glyphs we will encode (index space 0..253,
// 0xfe = newline marker in command glyph streams).
const VN_FONT_SPRITE_MAX_GLYPH_COUNT = 254;
// HuCard message glyphs are 12x12 px. font.bin stores one 12x12 1bpp mask per
// glyph (12 words = 24 bytes; per row the high byte = pixels 0..7, low byte high
// nibble = pixels 8..11). The HuCARD runtime reads each mask directly from its
// banked ROM data_ref and composites it into the fixed message strip; the masks
// themselves are never resident in VRAM. (Was 16x16 pre-baked as 4 BG tiles.)
const FONT_GLYPH_PX = 12;
const FONT_GLYPH_MASK_WORDS = 12;
const FONT_BYTES_PER_GLYPH = FONT_GLYPH_MASK_WORDS * 2; // 24
// Fixed 26x8-tile VRAM region the runtime compositor owns for the message window
// (mirrors the runtime VN_MSG_TILE_COUNT), plus one dedicated blank tile.
const VN_MSG_STRIP_TILES = 208;
const VN_SATB_VRAM_WORD = 0x7f00;
// BG message/choice glyph index space is 16-bit (0..0xfffd drawable, 0xfffe =
// newline, 0xffff = end). VN_MAX_GLYPH_COUNT is the practical project cap we
// slice to and surface in the editor; glyph count consumes banked ROM and scene
// pack bytes, but not additional VRAM.
const VN_MAX_GLYPH_COUNT = 1000;
// VRAM is 0x8000 words; SATB sits at 0x7f00 (tile 0x7f00/16 = 2032). Font tiles
// must end strictly below that. Sprite patterns are auto-placed above the font
// block by the asset converter, so warn well before the hard SATB ceiling.
const VN_FONT_VRAM_TILE_HARD_CEILING = 2032;
const VN_FONT_VRAM_TILE_SOFT_CEILING = 1728;
const VN_GLYPH_COUNT_SOFT_WARN = 900;
const VN_SCENE_PACK_CACHE_BYTES = 8192;
const VN_HUCARD_SCENE_PACK_CACHE_BYTES = 4096;
const VN_SCENE_PACK_VERSION = 3;
const VN_HUCARD_SCENE_PACK_VERSION = 2;
const VN_SCENE_PACK_HEADER_SIZE = 20;
const VN_SCENE_PACK_COMMAND_SIZE = 19;
const VN_SCENE_PACK_MESSAGE_SIZE = 13;
const VN_MESSAGE_INSTANT_GLYPH_MAX = 0xff;
const VN_SCENE_PACK_CHOICE_SIZE = 6;
const VN_SCENE_PACK_OPTION_SIZE = 7;
const VN_SCENE_PACK_SWITCH_SIZE = 5;
const VN_SCENE_PACK_SWITCH_CASE_SIZE = 4;
const VN_SCENE_PACK_MAGIC = Buffer.from('PVNS');
const VN_CD_SECTOR_BYTES = 2048;
const VN_ADPCM_FRAME_RATE = 60;
const VN_ADPCM_END_PAD_FRAMES = 2;
const VN_ADPCM_BUFFERED_SAFE_BYTES = 32767;
// Mirror the runtime ADPCM rate quantization (pce_vn_runtime.c adpcm_code_sample_rate /
// adpcm_rate_code): the PCE ADPCM hardware can only play at 32000/(16-code) Hz for a
// 4-bit rate code 0..15, so the nominal asset sample rate is snapped to the nearest
// representable rate. The typewriter must be timed against the rate the runtime
// ACTUALLY plays, not the nominal rate, or voice and text drift apart.
const VN_ADPCM_BASE_SAMPLE_RATE = 32000;
const VN_ADPCM_MAX_RATE_CODE = 15;
function adpcmRepresentableSampleRate(code) {
  const c = Math.max(0, Math.min(VN_ADPCM_MAX_RATE_CODE, code));
  return Math.floor(VN_ADPCM_BASE_SAMPLE_RATE / (16 - c));
}
function adpcmRateCodeForSampleRate(sampleRate) {
  const rate = sampleRate > 0 ? sampleRate : 16000;
  let best = 0;
  let bestDiff = Infinity;
  for (let code = 0; code <= VN_ADPCM_MAX_RATE_CODE; code += 1) {
    const diff = Math.abs(adpcmRepresentableSampleRate(code) - rate);
    if (diff < bestDiff) {
      best = code;
      bestDiff = diff;
      if (diff === 0) break;
    }
  }
  return best;
}
function adpcmActualSampleRate(sampleRate) {
  return adpcmRepresentableSampleRate(adpcmRateCodeForSampleRate(sampleRate));
}
const DEFAULT_FONT_CONFIG = {
  version: 1,
  fontPath: '',
  fonts: [],
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

function formatBuildDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function logBuildTiming(logger, label, startedAt, detail = '') {
  if (!logger || typeof logger.info !== 'function') return;
  const suffix = detail ? ` (${detail})` : '';
  logger.info(`VN timing: ${label} done in ${formatBuildDuration(Date.now() - startedAt)}${suffix}`);
}

function sha1Text(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function readTextHash(absPath) {
  try {
    return fs.existsSync(absPath) ? sha1Text(fs.readFileSync(absPath, 'utf-8')) : null;
  } catch (_) {
    return null;
  }
}

function readProjectTextHash(projectDir, relativePath) {
  return readTextHash(path.join(projectDir, normalizeRelativePath(relativePath)));
}

function fileSizeSignature(projectDir, relativePath) {
  const normalized = normalizeRelativePath(relativePath || '');
  if (!normalized) return { path: '', exists: false, size: 0 };
  const absPath = path.isAbsolute(normalized) ? normalized : path.join(projectDir, normalized);
  try {
    const stat = fs.statSync(absPath);
    return { path: normalized, exists: stat.isFile(), size: stat.isFile() ? stat.size : 0 };
  } catch (_) {
    return { path: normalized, exists: false, size: 0 };
  }
}

function vnBuildStampPath(projectDir) {
  return path.join(projectDir, VN_BUILD_STAMP_FILE);
}

function readVnBuildStamp(projectDir) {
  try {
    const stamp = JSON.parse(fs.readFileSync(vnBuildStampPath(projectDir), 'utf-8'));
    return stamp && stamp.version === VN_BUILD_STAMP_VERSION ? stamp : null;
  } catch (_) {
    return null;
  }
}

function writeVnBuildStamp(projectDir, stamp) {
  const stampPath = vnBuildStampPath(projectDir);
  ensureDirSync(path.dirname(stampPath));
  fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2), 'utf-8');
}

function updateVisualNovelBuildStamp(projectDir, config = {}, generated = {}, mergedDataFiles = [], mergedCddaTracks = []) {
  if (!generated || typeof generated !== 'object') return null;
  const stampGenerated = { ...generated };
  delete stampGenerated.incrementalSkipped;
  const signature = vnBuildSignature(projectDir, config, mergedDataFiles, mergedCddaTracks);
  const stamp = {
    version: VN_BUILD_STAMP_VERSION,
    signature,
    generated: stampGenerated,
    mergedDataFiles: (Array.isArray(mergedDataFiles) ? mergedDataFiles : []).map((entry) => normalizeRelativePath(entry || '')).filter(Boolean),
    mergedCddaTracks: (Array.isArray(mergedCddaTracks) ? mergedCddaTracks : []).map((entry) => normalizeRelativePath(entry || '')).filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  writeVnBuildStamp(projectDir, stamp);
  return stamp;
}

function vnRuntimeSignature(config = {}) {
  const targetMedia = String(config?.targetMedia || '').trim().toLowerCase() === 'hucard' ? 'hucard' : 'cd';
  if (targetMedia === 'hucard') {
    const templateDir = path.join(__dirname, 'template', 'template_pce_vn_hucard', 'src');
    return {
      targetMedia,
      manager: readTextHash(__filename),
      hucardManager: readTextHash(path.join(__dirname, 'pce-vn-hucard-manager.js')),
      runtime: readTextHash(path.join(templateDir, 'pce_vn_hucard_runtime.c')),
      banks: readTextHash(path.join(templateDir, 'pce_vn_hucard_banks.h')),
      main: readTextHash(path.join(templateDir, 'main.c')),
    };
  }
  const templateDir = templateRuntimeDir();
  return {
    targetMedia,
    manager: readTextHash(__filename),
    // Phase A module split: the umbrella (pce_vn_runtime.c) alone no longer
    // changes when a module does, so hash every synced runtime source
    // (umbrella + vn_* modules). main.c keeps its own field for stamp
    // compatibility.
    runtime: sha1Text(vnRuntimeSourceFileNames()
      .filter((fileName) => fileName !== 'main.c')
      .map((fileName) => `${fileName}:${readTextHash(path.join(templateDir, fileName))}`)
      .join('\n')),
    main: readTextHash(path.join(templateDir, 'main.c')),
  };
}

function vnBuildSignature(projectDir, _config = {}, mergedDataFiles = [], mergedCddaTracks = []) {
  const signature = {
    version: VN_BUILD_STAMP_VERSION,
    generator: vnRuntimeSignature(_config),
    inputs: {
      scenes: readProjectTextHash(projectDir, VN_SCENE_FILE),
      assets: readProjectTextHash(projectDir, assetManager.ASSET_FILE || path.join('assets', 'pce-assets.json')),
      font: readProjectTextHash(projectDir, VN_FONT_FILE),
    },
    outputSizes: (Array.isArray(mergedDataFiles) ? mergedDataFiles : [])
      .map((entry) => normalizeRelativePath(entry || ''))
      .filter(Boolean)
      .sort()
      .map((entry) => fileSizeSignature(projectDir, entry)),
    mergedDataFiles: (Array.isArray(mergedDataFiles) ? mergedDataFiles : []).map((entry) => normalizeRelativePath(entry || '')).filter(Boolean),
    mergedCddaTracks: (Array.isArray(mergedCddaTracks) ? mergedCddaTracks : []).map((entry) => normalizeRelativePath(entry || '')).filter(Boolean),
  };
  return sha1Text(JSON.stringify(signature));
}

function generatedDataFilePath(entry) {
  if (entry && typeof entry === 'object') {
    return normalizeRelativePath(entry.relativePath || entry.path || entry.file || '');
  }
  return normalizeRelativePath(entry || '');
}

function vnGeneratedOutputsReady(projectDir, generated = {}) {
  const required = [
    path.join('src', 'generated', 'vn.h'),
    path.join('src', 'generated', 'vn.c'),
    ...(generated.targetMedia === 'hucard' ? [VN_FONT_DATA_FILE] : []),
    ...((generated.scenePackPaths || []).map((entry) => generatedDataFilePath(entry)).filter(Boolean)),
    ...((generated.extraDataFiles || []).map((entry) => generatedDataFilePath(entry)).filter(Boolean)),
  ];
  if (generated.targetMedia === 'hucard' && Number(generated.fontSpriteByteSize || 0) > 0) {
    required.push(VN_FONT_SPRITE_DATA_FILE);
  }
  return required.every((relativePath) => fs.existsSync(path.join(projectDir, relativePath)));
}

function templateRuntimeDir() {
  return path.join(__dirname, 'template', 'template_pce_vn_cd', 'src');
}

// Runtime source file names synced from the template into <project>/src and
// hashed into the VN build signature: the thin main.c, the umbrella
// pce_vn_runtime.c and every vn_*.c / vn_*.h module the umbrella #includes
// (Phase A module split). Top-level files only — generated/ stays excluded.
function vnRuntimeSourceFileNames() {
  const sourceDir = templateRuntimeDir();
  const modules = [];
  try {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (/^vn_.*\.(c|h)$/.test(entry.name)) modules.push(entry.name);
    }
  } catch (_) { /* fall through to the fixed core list */ }
  modules.sort();
  return ['main.c', 'pce_vn_runtime.c', ...modules];
}

function copyIfChanged(sourcePath, targetPath) {
  const source = fs.readFileSync(sourcePath);
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null;
  if (current && Buffer.compare(source, current) === 0) return false;
  ensureDirSync(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function writeFileIfChanged(targetPath, content, encoding = undefined) {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(String(content), encoding || 'utf-8');
  try {
    const current = fs.readFileSync(targetPath);
    if (current.length === next.length && current.equals(next)) return false;
  } catch (_) { /* missing/unreadable output is rewritten below */ }
  ensureDirSync(path.dirname(targetPath));
  fs.writeFileSync(targetPath, next);
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

function normalizeBgFadeFrames(value, fallback = VN_BG_DEFAULT_FADE_FRAMES) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  let best = VN_BG_FADE_FRAME_OPTIONS[0];
  let bestDistance = Math.abs(parsed - best);
  for (const option of VN_BG_FADE_FRAME_OPTIONS.slice(1)) {
    const distance = Math.abs(parsed - option);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestOption(value, options = [], fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || !options.length) return fallback;
  let best = options[0];
  let bestDistance = Math.abs(parsed - best);
  for (const option of options.slice(1)) {
    const distance = Math.abs(parsed - option);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

function normalizeMessageSpeedFrames(value, fallback = VN_DEFAULT_MESSAGE_SPEED_FRAMES) {
  return nearestOption(value, VN_MESSAGE_SPEED_FRAME_OPTIONS, fallback);
}

function normalizeVnSystemSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  const advanceMode = String(raw.messageAdvanceMode ?? raw.advanceMode ?? raw.advance ?? 'button').trim().toLowerCase() === 'auto'
    ? 'auto'
    : 'button';
  return {
    messageSpeedFrames: normalizeMessageSpeedFrames(raw.messageSpeedFrames ?? raw.textSpeedFrames ?? raw.speed),
    messageAdvanceMode: advanceMode,
    messageAutoWaitFrames: clampInt(raw.messageAutoWaitFrames ?? raw.autoWaitFrames ?? raw.autoWait, 0, 255, VN_DEFAULT_MESSAGE_AUTO_WAIT_FRAMES),
  };
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

// A managed font library entry: `file` is a project-relative path under
// assets/fonts (always forward-slash), `label` is a human-friendly name.
function normalizeFontEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const file = normalizeRelativePath(entry);
    if (!file) return null;
    return { file, label: path.basename(file) };
  }
  if (typeof entry === 'object') {
    const file = normalizeRelativePath(String(entry.file || entry.path || ''));
    if (!file) return null;
    const label = String(entry.label || path.basename(file)).trim().slice(0, 120) || path.basename(file);
    return { file, label };
  }
  return null;
}

function normalizeFontEntries(rawFonts) {
  const list = Array.isArray(rawFonts) ? rawFonts : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const normalized = normalizeFontEntry(entry);
    if (!normalized || seen.has(normalized.file)) continue;
    seen.add(normalized.file);
    out.push(normalized);
  }
  return out;
}

function normalizeFontConfig(config = {}) {
  const raw = config && typeof config === 'object' ? config : {};
  return {
    version: 1,
    fontPath: String(raw.fontPath || '').replace(/\\/g, '/').trim(),
    fonts: normalizeFontEntries(raw.fonts),
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

function getFontDirPath(projectDir) {
  return path.join(projectDir, VN_FONT_DIR);
}

function fontFileSha1(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

// Build a portable ASCII destination stem so project-local font paths are safe
// across the supported host platforms and toolchains.
function safeFontStem(sourceName) {
  const base = String(sourceName || '').replace(/\.[^.]+$/, '');
  const ascii = base.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return ascii || 'font';
}

// Copy a font file into the project (assets/fonts) and register it in the font
// config, making it the active selection. Re-importing identical bytes reuses
// the existing copy instead of duplicating it.
function importFontFile(projectDir, sourcePath) {
  const source = String(sourcePath || '').trim();
  if (!source) throw new Error('フォントファイルが指定されていません');
  if (!fs.existsSync(source)) throw new Error('フォントファイルが見つかりません');
  const ext = path.extname(source).toLowerCase();
  if (!FONT_FILE_EXTS.includes(ext)) {
    throw new Error('対応していないフォント形式です (.ttf / .otf / .ttc)');
  }
  const config = readFontConfig(projectDir);
  const fontDir = getFontDirPath(projectDir);
  ensureDirSync(fontDir);
  const originalName = path.basename(source);
  const sourceHash = fontFileSha1(source);

  // Reuse an existing imported copy with identical content.
  const existing = config.fonts.find((entry) => {
    const abs = path.join(projectDir, entry.file);
    return fs.existsSync(abs) && fontFileSha1(abs) === sourceHash;
  });
  if (existing) {
    const nextConfig = normalizeFontConfig({ ...config, fontPath: existing.file });
    return { config: writeFontConfig(projectDir, nextConfig), imported: existing };
  }

  // Pick a unique ASCII destination name.
  const stem = safeFontStem(originalName);
  let destName = `${stem}${ext}`;
  let counter = 1;
  while (fs.existsSync(path.join(fontDir, destName))) {
    destName = `${stem}_${counter}${ext}`;
    counter += 1;
  }
  fs.copyFileSync(source, path.join(fontDir, destName));
  const relFile = normalizeRelativePath(path.join(VN_FONT_DIR, destName));
  const fonts = config.fonts.filter((entry) => entry.file !== relFile);
  fonts.push({ file: relFile, label: originalName });
  const nextConfig = normalizeFontConfig({ ...config, fonts, fontPath: relFile });
  return { config: writeFontConfig(projectDir, nextConfig), imported: { file: relFile, label: originalName } };
}

// Remove a project-local font copy and unregister it. Refuses paths outside
// assets/fonts. If the removed font was active, falls back to the OS font.
function deleteFontFile(projectDir, file) {
  const rel = normalizeRelativePath(file);
  if (!rel) throw new Error('削除するフォントが指定されていません');
  const abs = path.resolve(projectDir, rel);
  const fontDirAbs = path.resolve(projectDir, VN_FONT_DIR);
  const within = abs === fontDirAbs || abs.startsWith(fontDirAbs + path.sep);
  if (!within) throw new Error('プロジェクト内のフォントのみ削除できます');
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch (_) {}
  }
  const config = readFontConfig(projectDir);
  const fonts = config.fonts.filter((entry) => entry.file !== rel);
  const fontPath = normalizeRelativePath(config.fontPath) === rel ? '' : config.fontPath;
  const nextConfig = normalizeFontConfig({ ...config, fonts, fontPath });
  return { config: writeFontConfig(projectDir, nextConfig) };
}

function resolveBuildFontTileBase(savedConfig, options = {}) {
  const explicitTileBase = options.fontTileBase ?? options.fontConfig?.tileBase;
  if (explicitTileBase !== undefined && explicitTileBase !== null && explicitTileBase !== '') {
    return clampInt(explicitTileBase, 0, 2047, DEFAULT_FONT_TILE_BASE);
  }
  const savedTileBase = Number(savedConfig?.tileBase);
  if (!Number.isFinite(savedTileBase)) {
    return DEFAULT_FONT_TILE_BASE;
  }
  return clampInt(savedTileBase, 0, 2047, DEFAULT_FONT_TILE_BASE);
}

function safeId(value, fallback) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return id || fallback;
}

function normalizeSceneName(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .slice(0, 96);
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

// Frames of actual ADPCM voice playback, computed against the rate the runtime
// really plays (representable rate, not the nominal asset rate). This is the
// audible voice length used to pace the typewriter, so it deliberately excludes
// the runtime's small end-of-playback silence pad (VN_ADPCM_END_PAD_FRAMES),
// which is only there to avoid clipping the tail and should not slow the text.
function adpcmVoiceFrameCount(asset = {}, projectDir = '') {
  if (!asset || asset.type !== 'adpcm' || asset.options?.loop) return 0;
  const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
  const byteLength = (Number(generated.byteLength) || 0) || generatedFileByteLength(projectDir, generated.outputFile);
  const nominalRate = Number(asset.options?.sampleRate || generated.sampleRate) || 16000;
  const rate = adpcmActualSampleRate(nominalRate);
  let frames = 0;
  if (byteLength > 0 && rate > 0) {
    frames = Math.round((byteLength * 2 * VN_ADPCM_FRAME_RATE) / rate);
  } else {
    const durationSeconds = Number(generated.durationSeconds) || 0;
    if (durationSeconds > 0) frames = Math.round(durationSeconds * VN_ADPCM_FRAME_RATE);
  }
  if (!frames) return 0;
  return Math.min(65535, frames);
}

function adpcmGeneratedByteLength(asset = {}, projectDir = '') {
  const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
  return (Number(generated.byteLength) || 0) || generatedFileByteLength(projectDir, generated.outputFile);
}

function adpcmBufferedSafeBytes(asset = {}) {
  const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
  const rawAddress = Number(asset.options?.adpcmAddress ?? generated.adpcmAddress ?? 0) || 0;
  const address = Math.max(0, Math.min(65535, Math.trunc(rawAddress)));
  return Math.max(1, Math.min(VN_ADPCM_BUFFERED_SAFE_BYTES, 65536 - address));
}

function assertBufferedMessageVoice(assetDoc = { assets: [] }, assetId = '', projectDir = '', sceneId = '') {
  if (!assetId) return;
  const asset = findAsset(assetDoc, assetId);
  if (!asset || asset.type !== 'adpcm') return;
  const byteLength = adpcmGeneratedByteLength(asset, projectDir);
  const safeBytes = adpcmBufferedSafeBytes(asset);
  const label = sceneId ? `scene "${sceneId}"` : 'VN scene';
  if (byteLength > safeBytes) {
    throw new Error(`PCE VN message voice "${assetId}" in ${label} is ${byteLength} bytes, exceeding buffered ADPCM limit ${safeBytes} bytes. Split the voice, lower the sample rate, or use CD-DA.`);
  }
}

function voiceSyncedTextSpeedFrames(command = {}, glyphCount = 0, assetDoc = { assets: [] }, projectDir = '', fallbackSpeedFrames = VN_DEFAULT_MESSAGE_SPEED_FRAMES) {
  const fallback = clampInt(fallbackSpeedFrames, 0, 255, VN_DEFAULT_MESSAGE_SPEED_FRAMES);
  if (!command.voiceAssetId || !glyphCount) return fallback;
  const frames = adpcmVoiceFrameCount(findAsset(assetDoc, command.voiceAssetId), projectDir);
  if (!frames) return fallback;
  // Round (not ceil) so the typewriter total lands as close as possible to the
  // voice length instead of systematically overshooting by up to one frame per
  // glyph (which is what made long voiced lines finish well after the audio).
  return clampInt(Math.round(frames / glyphCount), 1, 255, 1);
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

function isCommandSkipped(command = {}) {
  return command?.skip === true || command?.skipped === true || command?.debugSkip === true;
}

function applyCommandDebugFlags(rawCommand = {}, normalizedCommand = null) {
  if (!normalizedCommand) return null;
  return isCommandSkipped(rawCommand) ? { ...normalizedCommand, skip: true } : normalizedCommand;
}

function compiledSceneCommands(scene = {}) {
  return (Array.isArray(scene.commands) ? scene.commands : [])
    .filter((command) => command && command.type !== 'comment' && !isCommandSkipped(command));
}

function validateFullScreenBgScene(scene = {}, assetDoc = { assets: [] }) {
  if (!scene.fullScreenBg) return;
  const sceneId = scene.id || 'scene';
  compiledSceneCommands(scene).forEach((command) => {
    if (!command) return;
    if (command.type === 'message' || command.type === 'choice') {
      throw new Error(`PCE VN scene "${sceneId}" uses fullScreenBg and cannot contain ${command.type} commands`);
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
      fadeOutFrames: VN_BG_DEFAULT_FADE_FRAMES,
      fadeInFrames: VN_BG_DEFAULT_FADE_FRAMES,
      x: VN_BG_DEFAULT_TILE_X,
      y: VN_BG_DEFAULT_TILE_Y,
    });
  }
  commands.push({
    type: 'message',
    speaker: 'アカリ',
    text: '256がめんです',
    voiceAssetId,
    mouthSlot: null,
  });
  commands.push({
    type: 'message',
    speaker: 'アカリ',
    text: '17もじx4ぎょう',
    voiceAssetId: '',
    mouthSlot: null,
  });
  return {
    version: VN_VERSION,
    settings: normalizeVnSystemSettings(),
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

function normalizeMessageMouthSlot(raw) {
  if (raw.mouthSlot == null || String(raw.mouthSlot).trim() === '') return null;
  const parsed = Math.round(Number(raw.mouthSlot));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 3 ? parsed : null;
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
    mouthSlot: normalizeMessageMouthSlot(raw),
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

function normalizeCacheScope(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return VN_CACHE_SCOPES.includes(raw) ? raw : 'visual';
}

function normalizeCacheAction(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'load' ? 'load' : 'clear';
}

function cacheActionCode(action = '') {
  return normalizeCacheAction(action) === 'load' ? VN_CACHE_ACTION_LOAD : VN_CACHE_ACTION_CLEAR;
}

function cacheScopeCode(scope = '') {
  const normalized = normalizeCacheScope(scope);
  if (normalized === 'bg') return VN_CACHE_SCOPE_BG;
  if (normalized === 'sprite') return VN_CACHE_SCOPE_SPRITE;
  if (normalized === 'adpcm') return VN_CACHE_SCOPE_ADPCM;
  if (normalized === 'psg') return VN_CACHE_SCOPE_PSG;
  if (normalized === 'all') return VN_CACHE_SCOPE_ALL;
  return VN_CACHE_SCOPE_VISUAL;
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
      transition: 'fade',
      fadeOutFrames: normalizeBgFadeFrames(raw.fadeOutFrames),
      fadeInFrames: normalizeBgFadeFrames(raw.fadeInFrames),
      x: clampInt(raw.x ?? raw.tileX ?? raw.mapX, 0, 63, VN_BG_DEFAULT_TILE_X),
      y: clampInt(raw.y ?? raw.tileY ?? raw.mapY, 0, 31, VN_BG_DEFAULT_TILE_Y),
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
      visible,
    };
  }
  if (type === 'spritemove') {
    const animationId = String(raw.animationId || '').trim().slice(0, 32);
    const animationAssetId = String(raw.animationAssetId || raw.assetId || '').trim();
    return {
      type: 'spritemove',
      slot: clampInt(raw.slot, 0, 3, 0),
      x: clampInt(raw.x, 0, 319, 0),
      y: clampInt(raw.y, 0, 223, 0),
      frames: clampInt(raw.frames ?? raw.durationFrames, 1, 65535, 30),
      async: raw.async === true || raw.mode === 'async',
      animationAssetId: animationId ? animationAssetId : '',
      animationId,
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
      ...(kind === 'psg' && action === 'stop'
        ? { target: raw.target === 'bgm' || raw.target === 'sfx' ? raw.target : 'all' }
        : {}),
    };
  }
  if (type === 'inputcheck') {
    return normalizeInputCheckCommand(raw);
  }
  if (type === 'cache') {
    const action = normalizeCacheAction(raw.action);
    const rawScope = normalizeCacheScope(raw.scope);
    if (action === 'load') {
      const assetId = String(raw.assetId || raw.bgAssetId || raw.spriteAssetId || raw.voiceAssetId || '').trim();
      const actualType = assetTypeForId(assetDoc, assetId);
      let scope = rawScope;
      if (scope === 'visual') {
        if (actualType === 'image') scope = 'bg';
        else if (actualType === 'sprite') scope = 'sprite';
        else if (actualType === 'psg-song' || actualType === 'psg-sfx') scope = 'psg';
      }
      const validAsset = (scope === 'bg' && valid.image?.has(assetId))
        || (scope === 'sprite' && valid.sprite?.has(assetId))
        || (scope === 'adpcm' && valid.adpcm?.has(assetId))
        || (scope === 'psg' && (valid['psg-song']?.has(assetId) || valid['psg-sfx']?.has(assetId)));
      return {
        type: 'cache',
        action: 'load',
        scope,
        assetId: validAsset ? assetId : '',
        ...(scope === 'psg' ? { channel: clampInt(raw.channel ?? raw.slot, 0, 5, 0) } : {}),
        slot: clampInt(raw.slot, 0, 3, 0),
        x: clampInt(raw.x ?? raw.tileX ?? raw.mapX, 0, 63, 0),
        y: clampInt(raw.y ?? raw.tileY ?? raw.mapY, 0, 31, 0),
      };
    }
    return {
      type: 'cache',
      action: 'clear',
      scope: rawScope,
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
  if (type === 'comment') {
    // Editor-only annotation: kept in the saved scene document so it persists,
    // but excluded from the compiled scene pack (see the scene compile loop).
    return {
      type: 'comment',
      text: String(raw.text == null ? '' : raw.text).slice(0, 200),
      color: normalizeHexColor(raw.color) || '',
    };
  }
  return null;
}

function normalizeFullScreenBgCommand(rawCommand = {}, normalizedCommand = null) {
  if (!normalizedCommand || normalizedCommand.type !== 'background') return normalizedCommand;
  const raw = rawCommand && typeof rawCommand === 'object' ? rawCommand : {};
  const hasX = raw.x != null || raw.tileX != null || raw.mapX != null;
  const hasY = raw.y != null || raw.tileY != null || raw.mapY != null;
  return {
    ...normalizedCommand,
    x: hasX ? normalizedCommand.x : 0,
    y: hasY ? normalizedCommand.y : 0,
  };
}

function normalizeScene(scene = {}, index = 0, valid = assetIdsByType(), assetDoc = { assets: [] }) {
  const raw = scene && typeof scene === 'object' ? scene : {};
  const fullScreenBg = normalizeFullScreenBg(raw.fullScreenBg ?? raw.fullscreenBg ?? raw.fullScreenBackground ?? raw.layout ?? raw.displayMode);
  const commands = Array.isArray(raw.commands)
    ? raw.commands
      .map((command, commandIndex) => {
        const normalized = normalizeCommand(command, commandIndex, valid, assetDoc);
        const sceneAdjusted = fullScreenBg ? normalizeFullScreenBgCommand(command, normalized) : normalized;
        return applyCommandDebugFlags(command, sceneAdjusted);
      })
      .filter(Boolean)
    : [];
  const name = normalizeSceneName(raw.name ?? raw.title ?? raw.label ?? '');
  return {
    id: safeId(raw.id, index === 0 ? 'opening' : `scene_${index + 1}`),
    ...(name ? { name } : {}),
    fullScreenBg,
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
  const normalizedStartScene = safeId(raw.startScene, '');
  const startScene = deduped.some((scene) => scene.id === normalizedStartScene)
    ? normalizedStartScene
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
      if (command.type === 'jump') {
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
    settings: normalizeVnSystemSettings(raw.settings || raw.systemSettings || raw.system),
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

function countGlyphStreamEntries(text = '') {
  let count = 0;
  for (const glyph of String(text || '')) {
    if (glyph === '\r') continue;
    count += 1;
  }
  return count;
}

function countDrawableGlyphs(text = '') {
  let count = 0;
  for (const glyph of String(text || '')) {
    if (glyph === '\r' || glyph === '\n') continue;
    count += 1;
  }
  return count;
}

function messageDisplayParts(message) {
  const speaker = String(message.speaker || '').trim();
  const text = String(message.text || '').trim();
  const prefix = speaker ? `${speaker}：\n` : '';
  return {
    prefix,
    body: text,
    full: `${prefix}${text}`,
    instantGlyphCount: countGlyphStreamEntries(prefix),
    bodyDrawableCount: countDrawableGlyphs(text),
  };
}

function messageDisplayText(message) {
  return messageDisplayParts(message).full;
}

// Every distinct character that appears in messages/choices, untruncated.
// The leading ' ', '>', and wait marker are always present because the runtime
// draws blank cells, choice cursors, and the blinking page-advance marker.
function collectGlyphsRaw(doc) {
  const glyphs = [' ', '>', MESSAGE_WAIT_GLYPH];
  const seen = new Set(glyphs);
  (doc.scenes || []).forEach((scene) => {
    compiledSceneCommands(scene).forEach((command) => {
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
// are encoded into the HuCard sprite-format font (font_sprite.bin). CD builds
// instead retain this set as metadata and obtain each glyph from EX_GETFNT.
// Returns [] when no scene uses spritetext (no sprite font is generated then).
function collectSpriteTextGlyphsRaw(doc) {
  const glyphs = [];
  const seen = new Set();
  let used = false;
  (doc.scenes || []).forEach((scene) => {
    compiledSceneCommands(scene).forEach((command) => {
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

// Build-time budget report for the glyph font. HuCARD keeps the mask payload in
// banked ROM and reads it through pce_vn_font_data_ref while composing a glyph.
// Only the fixed 208-tile message strip and one blank tile occupy VRAM, so glyph
// count affects ROM/scene-pack budgets but must not move the sprite VRAM layout.
function computeFontBudget(rawGlyphCount, tileBase) {
  const usedGlyphCount = Math.min(rawGlyphCount, VN_MAX_GLYPH_COUNT);
  const droppedGlyphCount = Math.max(0, rawGlyphCount - VN_MAX_GLYPH_COUNT);
  const byteSize = usedGlyphCount * FONT_BYTES_PER_GLYPH;
  const sectorCount = Math.max(1, Math.ceil(byteSize / VN_CD_SECTOR_BYTES));
  // VRAM layout: [strip 208 tiles][blank tile]. The runtime derives the same
  // addresses from PCE_VN_FONT_TILE_BASE. Glyph masks remain in banked ROM.
  const blankTile = tileBase + VN_MSG_STRIP_TILES; // dedicated blank tile
  const vramEndWord = (blankTile + 1) * 16;
  const endTile = Math.ceil(vramEndWord / 16); // spritetext placement + reporting
  const warnings = [];
  const errors = [];
  if (droppedGlyphCount > 0) {
    warnings.push(`フォント: 使用文字が ${rawGlyphCount} 種類あり、上限 ${VN_MAX_GLYPH_COUNT} を超えています。`
      + `超過した ${droppedGlyphCount} 文字は空白として表示されます。シーンで使う文字種を減らしてください。`);
  } else if (usedGlyphCount >= VN_GLYPH_COUNT_SOFT_WARN) {
    warnings.push(`フォント: 使用文字が ${usedGlyphCount} 種類で上限 ${VN_MAX_GLYPH_COUNT} に近づいています。`);
  }
  if (vramEndWord > VN_SATB_VRAM_WORD) {
    errors.push(`メッセージ表示領域 (tileBase ${tileBase} + 208タイル + blank 1タイル) が VRAM 末尾 (SATB word 0x7f00) を超えます。tileBase を下げてください。`);
  } else if (endTile > VN_FONT_VRAM_TILE_SOFT_CEILING) {
    warnings.push(`メッセージ表示タイル末尾が tile ${endTile} でスプライトパターン領域に接近しています (推奨上限 ${VN_FONT_VRAM_TILE_SOFT_CEILING})。`);
  }
  return { usedGlyphCount, rawGlyphCount, droppedGlyphCount, byteSize, sectorCount, tileBase, blankTile, vramEndWord, endTile, warnings, errors };
}

// PCE VRAM is one shared 32768-word space (0x0000..0x7FFF). The BAT, BG tiles, the
// message display strip, the spritetext font, sprite patterns, and the SATB are
// each placed by independent rules, so a large asset in one category can silently
// overwrite a neighbour's VRAM -- the "layout breaks down" corruption. This is the
// single authoritative reservation check: it lays every category out as a word range
// and rejects (build error) any overlap between DIFFERENT categories. BG images are
// reduced to their category union because only one BG is active at a time. Sprite
// patterns use build-time fixed SLOT reservations sized to the largest asset that
// can appear in each SLOT, so replacing one SLOT never relocates another SLOT.
const VN_VRAM_TOTAL_WORDS = 0x8000;
const VN_BAT_VRAM_WORDS = 32 * 32; // 32x32 BAT = 1024 words at map base 0
const VN_BG_DEFAULT_TILE_BASE = 64; // word units *16 (matches PCE_BG_AUTO_TILE_BASE)
const VN_NORMAL_BG_MAX_TILE_COUNT = 28 * 17; // 224x136 tiles, excluding Full BG mode
const VN_SPRITE_DEFAULT_TILE_BASE = 704; // 32-word units (matches sprite asset default)

function normalizeAssetId(value) {
  return String(value || '').trim();
}

function collectFullScreenBgAssetIds(doc = {}) {
  const fullScreenBgIds = new Set();
  const regularBgIds = new Set();
  (doc.scenes || []).forEach((scene) => {
    const target = scene?.fullScreenBg ? fullScreenBgIds : regularBgIds;
    compiledSceneCommands(scene).forEach((command) => {
      if (command?.type !== 'background') return;
      const assetId = normalizeAssetId(command.assetId);
      if (assetId) target.add(assetId);
    });
  });
  regularBgIds.forEach((assetId) => fullScreenBgIds.delete(assetId));
  return fullScreenBgIds;
}

function collectSceneVisualAssetUsage(doc = {}) {
  const imageAssetIds = new Set();
  const spriteAssetIds = new Set();
  const spriteSlotLayouts = [];
  const layoutKeys = new Set();
  const scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
  const sceneById = new Map();
  const sceneIds = scenes.map((scene, index) => String(scene?.id || `__scene_${index}`));
  scenes.forEach((scene, index) => {
    sceneById.set(sceneIds[index], scene);
  });
  const addSpriteLayout = (spriteSlots) => {
    const visibleLayout = spriteSlots.slice(0, 4);
    while (visibleLayout.length < 4) visibleLayout.push('');
    if (!visibleLayout.some(Boolean)) return;
    const key = visibleLayout.join('\0');
    if (layoutKeys.has(key)) return;
    layoutKeys.add(key);
    spriteSlotLayouts.push(visibleLayout);
  };
  const visited = new Set();
  const queue = [];
  const enqueue = (sceneId, spriteSlots) => {
    if (!sceneId || !sceneById.has(String(sceneId))) return;
    const slots = Array.isArray(spriteSlots) ? spriteSlots.slice(0, 4) : ['', '', '', ''];
    while (slots.length < 4) slots.push('');
    const key = `${sceneId}\0${slots.join('\0')}`;
    if (visited.has(key)) return;
    visited.add(key);
    queue.push({ sceneId: String(sceneId), spriteSlots: slots });
  };
  const drainQueue = () => {
    while (queue.length) {
      const { sceneId, spriteSlots: entrySlots } = queue.shift();
      const scene = sceneById.get(sceneId);
      const spriteSlots = scene?.fullScreenBg ? ['', '', '', ''] : entrySlots.slice(0, 4);
      compiledSceneCommands(scene).forEach((command) => {
        if (command?.type === 'background') {
          const assetId = normalizeAssetId(command.assetId);
          if (assetId) imageAssetIds.add(assetId);
        } else if (command?.type === 'sprite' && command.visible !== false) {
          const assetId = normalizeAssetId(command.assetId);
          const slot = clampInt(command.slot, 0, 3, 0);
          if (assetId) {
            spriteAssetIds.add(assetId);
            spriteSlots[slot] = assetId;
          } else {
            spriteSlots[slot] = '';
          }
          addSpriteLayout(spriteSlots);
        } else if (command?.type === 'sprite') {
          const slot = clampInt(command.slot, 0, 3, 0);
          spriteSlots[slot] = '';
          addSpriteLayout(spriteSlots);
        } else if (command?.type === 'spritemove') {
          const assetId = normalizeAssetId(command.animationAssetId);
          if (assetId) spriteAssetIds.add(assetId);
        } else if (command?.type === 'cache' && command.action === 'load') {
          const assetId = normalizeAssetId(command.assetId);
          if (command.scope === 'bg' && assetId) {
            imageAssetIds.add(assetId);
          } else if (command.scope === 'sprite' && assetId) {
            spriteAssetIds.add(assetId);
          }
        } else if (command?.type === 'jump') {
          enqueue(command.sceneId, spriteSlots);
        } else if (command?.type === 'choice') {
          (command.choices || []).forEach((choice) => enqueue(choice?.targetSceneId, spriteSlots));
        }
      });
      enqueue(scene?.nextSceneId, spriteSlots);
    }
  };
  if (doc.startScene && sceneById.has(String(doc.startScene))) enqueue(String(doc.startScene), ['', '', '', '']);
  else if (sceneIds[0]) enqueue(sceneIds[0], ['', '', '', '']);
  drainQueue();
  scenes.forEach((_scene, index) => {
    enqueue(sceneIds[index], ['', '', '', '']);
    drainQueue();
  });
  const fullScreenBgUsesSprites = scenes.some((scene) => (
    scene?.fullScreenBg
    && compiledSceneCommands(scene).some((command) => (
      (command?.type === 'sprite' && command.visible !== false)
      || command?.type === 'spritemove'
    ))
  ));
  const fullScreenBgUsesSpriteText = scenes.some((scene) => (
    scene?.fullScreenBg
    && compiledSceneCommands(scene).some((command) => (
      command?.type === 'spritetext' && command.visible !== false
    ))
  ));
  return {
    imageAssetIds,
    spriteAssetIds,
    spriteSlotLayouts,
    fullScreenBgAssetIds: collectFullScreenBgAssetIds(doc),
    fullScreenBgUsesSprites,
    fullScreenBgUsesSpriteText,
  };
}

function computeVnNormalBgExtent(assets, options = {}) {
  const fullScreenBgAssetIds = options.fullScreenBgAssetIds instanceof Set
    ? options.fullScreenBgAssetIds
    : new Set(options.fullScreenBgAssetIds || []);
  const imageAssetIds = options.imageAssetIds
    ? (options.imageAssetIds instanceof Set ? options.imageAssetIds : new Set(options.imageAssetIds))
    : null;
  let start = Infinity;
  let end = 0;
  for (const asset of assets || []) {
    if (!asset || asset.type !== 'image') continue;
    if (imageAssetIds && (!asset.id || !imageAssetIds.has(String(asset.id)))) continue;
    if (asset.id && fullScreenBgAssetIds.has(String(asset.id))) continue;
    const gen = (asset.data && asset.data.generated) || {};
    const tileCount = Number(gen.tileCount) || 0;
    if (!tileCount) continue;
    const rawBase = Number(asset.options && asset.options.tileBase);
    const tileBase = Number.isFinite(rawBase) ? rawBase : VN_BG_DEFAULT_TILE_BASE;
    const regionStart = tileBase * 16;
    const regionEnd = regionStart + (tileCount * 16);
    if (regionStart < start) start = regionStart;
    if (regionEnd > end) end = regionEnd;
  }
  return end > start ? { start, end } : null;
}

function computeVnSpritePatternBanks(assetDoc, fontBudget, options = {}) {
  const assets = (assetDoc && Array.isArray(assetDoc.assets)) ? assetDoc.assets : [];
  const reservedNormalBgEndWord = (VN_BG_DEFAULT_TILE_BASE + VN_NORMAL_BG_MAX_TILE_COUNT) * 16;
  const bg = computeVnNormalBgExtent(assets, options);
  const extraStart = Math.ceil(Math.max(reservedNormalBgEndWord, bg ? bg.end : 0) / 32);
  const extraEndRaw = Math.floor((Number(fontBudget?.tileBase || DEFAULT_FONT_TILE_BASE) * 16) / 32);
  return {
    extraStart,
    extraEnd: Math.max(extraStart, extraEndRaw),
    mainDefaultStart: VN_SPRITE_DEFAULT_TILE_BASE,
  };
}

function computeVnSpritePatternBase(fontBudget, fontSpritePatternBase, spriteTextGlyphCount) {
  const fontEndWord = Math.max(
    Number(fontBudget?.vramEndWord) || 0,
    (fontSpritePatternBase + (spriteTextGlyphCount * 2)) * 32,
  );
  return Math.ceil(fontEndWord / 32);
}

function computeVnFullScreenBgPatternBase(assetDoc, options = {}) {
  const assets = (assetDoc && Array.isArray(assetDoc.assets)) ? assetDoc.assets : [];
  const fullScreenBgAssetIds = options.fullScreenBgAssetIds instanceof Set
    ? options.fullScreenBgAssetIds
    : new Set(options.fullScreenBgAssetIds || []);
  const imageAssetIds = options.imageAssetIds
    ? (options.imageAssetIds instanceof Set ? options.imageAssetIds : new Set(options.imageAssetIds))
    : null;
  let endWord = 0;
  for (const asset of assets) {
    if (!asset || asset.type !== 'image' || !asset.id) continue;
    const assetId = String(asset.id);
    if (!fullScreenBgAssetIds.has(assetId)) continue;
    if (imageAssetIds && !imageAssetIds.has(assetId)) continue;
    const tileCount = Number(asset.data?.generated?.tileCount) || 0;
    if (!tileCount) continue;
    const rawBase = Number(asset.options?.tileBase);
    const tileBase = Number.isFinite(rawBase) ? rawBase : VN_BG_DEFAULT_TILE_BASE;
    endWord = Math.max(endWord, (tileBase + tileCount) * 16);
  }
  return Math.ceil(endWord / 32);
}

function computeVnFullScreenBgSpritePatternBase(assetDoc, options = {}) {
  return options.fullScreenBgUsesSprites
    ? computeVnFullScreenBgPatternBase(assetDoc, options)
    : 0;
}

function computeVnFullScreenBgSpriteTextPatternBase(assetDoc, options = {}) {
  if (!options.fullScreenBgUsesSpriteText) return 0;
  const patternBase = computeVnFullScreenBgPatternBase(assetDoc, options);
  // A 16x16 hardware sprite consumes two 32-word pattern units, and the VDC
  // ignores the low address bit. Keep the first glyph on an even unit.
  return Math.ceil(patternBase / 2) * 2;
}

function spritePatternAlignmentForAsset(asset) {
  const options = asset?.options || {};
  const cellWidth = clampInt(options.cellWidth, 16, 32, 16);
  const cellHeight = clampInt(options.cellHeight, 16, 64, 16);
  let alignment = 2;
  if (cellWidth >= 32) alignment = Math.max(alignment, 4);
  if (cellHeight >= 64) alignment = 16;
  else if (cellHeight >= 32) alignment = Math.max(alignment, 8);
  return alignment;
}

// Give every logical sprite SLOT a build-time VRAM reservation sized for the
// largest asset that can appear in that SLOT. A Sprite command may then replace
// only its own patterns/palette without relocating or hiding unrelated SLOTs.
function computeVnSpriteSlotPatternLayout(assetDoc, spritePatternBase, options = {}) {
  const assets = (assetDoc && Array.isArray(assetDoc.assets)) ? assetDoc.assets : [];
  const spriteAssetIds = options.spriteAssetIds
    ? (options.spriteAssetIds instanceof Set ? options.spriteAssetIds : new Set(options.spriteAssetIds))
    : null;
  const assetById = new Map();
  for (const asset of assets) {
    if (asset?.id) assetById.set(String(asset.id), asset);
  }
  const requirements = Array.from({ length: 4 }, (_unused, slot) => ({
    slot,
    capacity: 0,
    alignment: 2,
    assetIds: new Set(),
  }));
  const addAsset = (slot, assetId) => {
    if (slot < 0 || slot >= requirements.length) return;
    const directAsset = assetId && typeof assetId === 'object' ? assetId : null;
    const key = String(directAsset?.id || assetId || '');
    const asset = directAsset || assetById.get(key);
    if (!asset || asset.type !== 'sprite') return;
    if (spriteAssetIds && (!key || !spriteAssetIds.has(key))) return;
    const gen = (asset.data && asset.data.generated) || {};
    const words = Number(gen.tileCount)
      ? Number(gen.tileCount) * 64
      : Math.ceil((Number(gen.vramBytes) || 0) / 2);
    const units = Math.ceil(words / 32);
    if (!units) return;
    const requirement = requirements[slot];
    requirement.capacity = Math.max(requirement.capacity, units);
    requirement.alignment = Math.max(requirement.alignment, spritePatternAlignmentForAsset(asset));
    if (key) requirement.assetIds.add(key);
  };
  const spriteSlotLayouts = Array.isArray(options.spriteSlotLayouts) ? options.spriteSlotLayouts : [];
  if (spriteSlotLayouts.length) {
    for (const layout of spriteSlotLayouts) {
      if (!Array.isArray(layout)) continue;
      for (let slot = 0; slot < 4; slot += 1) addAsset(slot, layout[slot]);
    }
  } else {
    for (const asset of assets) {
      if (asset?.type === 'sprite' && (!spriteAssetIds || spriteAssetIds.has(String(asset.id || '')))) {
        addAsset(0, asset);
      }
    }
  }
  let nextPatternBase = Number(spritePatternBase) || 0;
  return requirements.map((requirement) => {
    const base = Math.ceil(nextPatternBase / requirement.alignment) * requirement.alignment;
    nextPatternBase = base + requirement.capacity;
    return {
      ...requirement,
      base,
      assetIds: Array.from(requirement.assetIds),
    };
  });
}

function computeVnHardwareSpriteLayout(assetDoc, fontBudget, spriteTextGlyphCount, options = {}) {
  const glyphPatternUnits = Math.max(0, Number(spriteTextGlyphCount) || 0) * 2;
  const normalFontBase = Math.ceil((Number(fontBudget?.endTile) * 16) / 64) * 2;
  const messageEndPatternBase = Math.ceil((Number(fontBudget?.vramEndWord) || 0) / 32);
  const fullBgSpriteFloor = computeVnFullScreenBgSpritePatternBase(assetDoc, options);
  const fullBgSpriteTextFloor = computeVnFullScreenBgSpriteTextPatternBase(assetDoc, options);
  const layoutEnd = (layout, fallback) => layout.reduce(
    (end, slot) => Math.max(end, Number(slot.base || 0) + Number(slot.capacity || 0)),
    fallback,
  );
  const fontFirstBase = Math.max(normalFontBase, fullBgSpriteTextFloor);
  const fontFirstEnd = fontFirstBase + glyphPatternUnits;
  const fontFirstSpriteBase = Math.max(messageEndPatternBase, fontFirstEnd, fullBgSpriteFloor);
  const fontFirstSlots = computeVnSpriteSlotPatternLayout(assetDoc, fontFirstSpriteBase, options);
  const fontFirst = {
    fontSpritePatternBase: fontFirstBase,
    spritePatternBase: fontFirstSpriteBase,
    spriteSlotPatternLayout: fontFirstSlots,
    endPatternBase: Math.max(fontFirstEnd, layoutEnd(fontFirstSlots, fontFirstSpriteBase)),
  };

  // When only SpriteText is used over Full BG, keeping ordinary scene sprites
  // in their traditional lower range and placing the font after those slots
  // can save enough high VRAM to stay below SATB. Both orders are valid because
  // their generated regions remain disjoint; choose the smaller packed end.
  const spriteFirstBase = Math.max(messageEndPatternBase, fullBgSpriteFloor);
  const spriteFirstSlots = computeVnSpriteSlotPatternLayout(assetDoc, spriteFirstBase, options);
  const spriteFirstEnd = layoutEnd(spriteFirstSlots, spriteFirstBase);
  const spriteFirstFontBase = Math.ceil(Math.max(
    normalFontBase,
    spriteFirstEnd,
    fullBgSpriteTextFloor,
  ) / 2) * 2;
  const spriteFirst = {
    fontSpritePatternBase: spriteFirstFontBase,
    spritePatternBase: spriteFirstBase,
    spriteSlotPatternLayout: spriteFirstSlots,
    endPatternBase: Math.max(spriteFirstEnd, spriteFirstFontBase + glyphPatternUnits),
  };
  return spriteFirst.endPatternBase < fontFirst.endPatternBase ? spriteFirst : fontFirst;
}

function computeVnVramLayout(assetDoc, fontBudget, fontSpritePatternBase, spriteTextGlyphCount, options = {}) {
  return computeVnVramLayoutPacked(assetDoc, fontBudget, fontSpritePatternBase, spriteTextGlyphCount, options);
  const assets = (assetDoc && Array.isArray(assetDoc.assets)) ? assetDoc.assets : [];
  const fullScreenBgAssetIds = options.fullScreenBgAssetIds instanceof Set
    ? options.fullScreenBgAssetIds
    : new Set(options.fullScreenBgAssetIds || []);
  const imageAssetIds = options.imageAssetIds
    ? (options.imageAssetIds instanceof Set ? options.imageAssetIds : new Set(options.imageAssetIds))
    : null;
  const spriteAssetIds = options.spriteAssetIds
    ? (options.spriteAssetIds instanceof Set ? options.spriteAssetIds : new Set(options.spriteAssetIds))
    : null;
  const regions = [];
  const addRegion = (name, startWord, endWord) => {
    if (endWord > startWord) regions.push({ name, start: startWord, end: endWord });
  };
  const isReferencedAsset = (asset, ids) => !ids || (asset?.id && ids.has(String(asset.id)));
  const isFullScreenOnlyBgAsset = (asset) => (
    asset?.type === 'image'
    && asset.id
    && isReferencedAsset(asset, imageAssetIds)
    && fullScreenBgAssetIds.has(String(asset.id))
  );
  const assetById = new Map();
  for (const asset of assets) {
    if (asset?.id) assetById.set(String(asset.id), asset);
  }
  addRegion('BAT (BGマップ)', 0, VN_BAT_VRAM_WORDS);
  addRegion('SATB (スプライト属性)', VN_SATB_VRAM_WORD, VN_VRAM_TOTAL_WORDS);
  // Message: fixed compositor strip + blank tile. Glyph masks stay in ROM.
  addRegion('メッセージ表示タイル', fontBudget.tileBase * 16, fontBudget.vramEndWord);
  if (spriteTextGlyphCount > 0) {
    addRegion('spritetextフォント', fontSpritePatternBase * 32, (fontSpritePatternBase + (spriteTextGlyphCount * 2)) * 32);
  }
  // BG tiles: union extent of all referenced assets.
  const unionExtent = (type, tileBaseScale, wordsFor, defaultTileBase, includeAsset = () => true) => {
    let start = Infinity;
    let end = 0;
    for (const asset of assets) {
      if (!asset || asset.type !== type) continue;
      if (!includeAsset(asset)) continue;
      const gen = (asset.data && asset.data.generated) || {};
      const words = wordsFor(gen);
      if (!words) continue;
      const rawBase = Number(asset.options && asset.options.tileBase);
      const base = (Number.isFinite(rawBase) ? rawBase : defaultTileBase) * tileBaseScale;
      if (base < start) start = base;
      if (base + words > end) end = base + words;
    }
    return end > start ? { start, end } : null;
  };
  const bgWords = (gen) => (Number(gen.tileCount) || 0) * 16;
  const bg = unionExtent('image', 16, bgWords, VN_BG_DEFAULT_TILE_BASE,
    (asset) => isReferencedAsset(asset, imageAssetIds) && !isFullScreenOnlyBgAsset(asset));
  if (bg) addRegion('BGタイル', bg.start, bg.end);
  const fullBg = unionExtent('image', 16, bgWords, VN_BG_DEFAULT_TILE_BASE, isFullScreenOnlyBgAsset);
  if (fullBg) addRegion('Full BGタイル', fullBg.start, fullBg.end);
  const spriteWords = (gen) => (Number(gen.tileCount) ? Number(gen.tileCount) * 64 : Math.ceil((Number(gen.vramBytes) || 0) / 2));
  const spriteBaseWord = (asset) => {
    const rawBase = Number(asset.options && asset.options.tileBase);
    return (Number.isFinite(rawBase) ? rawBase : VN_SPRITE_DEFAULT_TILE_BASE) * 32;
  };
  const spritePatternUnits = (gen) => Math.ceil(spriteWords(gen) / 32);
  const spriteBanks = computeVnSpritePatternBanks(assetDoc, fontBudget, {
    fullScreenBgAssetIds,
    imageAssetIds,
  });
  const spriteSlotLayouts = Array.isArray(options.spriteSlotLayouts) ? options.spriteSlotLayouts : [];
  const spriteRegions = [];
  if (spriteSlotLayouts.length) {
    for (const layout of spriteSlotLayouts) {
      if (!Array.isArray(layout)) continue;
      let extraNext = spriteBanks.extraStart;
      let mainNextWord = 0;
      let mainStarted = false;
      for (const assetId of layout) {
        const asset = assetById.get(String(assetId));
        if (!asset || asset.type !== 'sprite' || !isReferencedAsset(asset, spriteAssetIds)) continue;
        const gen = (asset.data && asset.data.generated) || {};
        const words = spriteWords(gen);
        if (!words) continue;
        if (!started) {
          nextWord = spriteBaseWord(asset);
          if (nextWord < start) start = nextWord;
          started = true;
        }
        nextWord += Math.ceil(words / 32) * 32;
      }
      if (started && nextWord > end) end = nextWord;
    }
    if (end > start) sprite = { start, end };
  } else {
    sprite = unionExtent('sprite', 32, spriteWords, VN_SPRITE_DEFAULT_TILE_BASE,
      (asset) => isReferencedAsset(asset, spriteAssetIds));
  }
  if (sprite) addRegion('スプライトpattern', sprite.start, sprite.end);
  return regions;
}

function isAllowedVnVramOverlap(a, b) {
  const names = new Set([a.name, b.name]);
  if (!names.has('Full BGタイル')) return false;
  // Full BG may overwrite message VRAM because message/choice are rejected in
  // that scene and restored afterward. The packed layout used by builds moves
  // simultaneously visible sprite patterns and spritetext font patterns past
  // the Full BG tile end.
  // BAT and SATB remain hardware-owned and must never overlap.
  return !names.has('BAT (BGマップ)') && !names.has('SATB (スプライト属性)');
}

function isAllowedVnVramOverlapPacked(a, b, options = {}) {
  const names = new Set([a.name, b.name]);
  if (names.size === 1 && names.has('sprite patterns')) return true;
  if (!names.has('Full BG tiles')) return false;
  if (options.fullScreenBgUsesSprites && names.has('sprite patterns')) return false;
  if (options.fullScreenBgUsesSpriteText && names.has('spritetext font')) return false;
  return !names.has('BAT') && !names.has('SATB');
}

function computeVnVramLayoutPacked(assetDoc, fontBudget, fontSpritePatternBase, spriteTextGlyphCount, options = {}) {
  const assets = (assetDoc && Array.isArray(assetDoc.assets)) ? assetDoc.assets : [];
  const fullScreenBgAssetIds = options.fullScreenBgAssetIds instanceof Set
    ? options.fullScreenBgAssetIds
    : new Set(options.fullScreenBgAssetIds || []);
  const imageAssetIds = options.imageAssetIds
    ? (options.imageAssetIds instanceof Set ? options.imageAssetIds : new Set(options.imageAssetIds))
    : null;
  const spriteAssetIds = options.spriteAssetIds
    ? (options.spriteAssetIds instanceof Set ? options.spriteAssetIds : new Set(options.spriteAssetIds))
    : null;
  const regions = [];
  const addRegion = (name, startWord, endWord) => {
    if (endWord > startWord) regions.push({ name, start: startWord, end: endWord });
  };
  const isReferencedAsset = (asset, ids) => !ids || (asset?.id && ids.has(String(asset.id)));
  const isFullScreenOnlyBgAsset = (asset) => (
    asset?.type === 'image'
    && asset.id
    && isReferencedAsset(asset, imageAssetIds)
    && fullScreenBgAssetIds.has(String(asset.id))
  );
  addRegion('BAT', 0, VN_BAT_VRAM_WORDS);
  addRegion('SATB', VN_SATB_VRAM_WORD, VN_VRAM_TOTAL_WORDS);
  addRegion('message display tiles', fontBudget.tileBase * 16, fontBudget.vramEndWord);
  if (spriteTextGlyphCount > 0) {
    addRegion('spritetext font', fontSpritePatternBase * 32, (fontSpritePatternBase + (spriteTextGlyphCount * 2)) * 32);
  }
  const unionExtent = (type, tileBaseScale, wordsFor, defaultTileBase, includeAsset = () => true) => {
    let start = Infinity;
    let end = 0;
    for (const asset of assets) {
      if (!asset || asset.type !== type) continue;
      if (!includeAsset(asset)) continue;
      const gen = (asset.data && asset.data.generated) || {};
      const words = wordsFor(gen);
      if (!words) continue;
      const rawBase = Number(asset.options && asset.options.tileBase);
      const base = (Number.isFinite(rawBase) ? rawBase : defaultTileBase) * tileBaseScale;
      if (base < start) start = base;
      if (base + words > end) end = base + words;
    }
    return end > start ? { start, end } : null;
  };
  const bgWords = (gen) => (Number(gen.tileCount) || 0) * 16;
  const bg = unionExtent('image', 16, bgWords, VN_BG_DEFAULT_TILE_BASE,
    (asset) => isReferencedAsset(asset, imageAssetIds) && !isFullScreenOnlyBgAsset(asset));
  if (bg) addRegion('BG tiles', bg.start, bg.end);
  const fullBg = unionExtent('image', 16, bgWords, VN_BG_DEFAULT_TILE_BASE, isFullScreenOnlyBgAsset);
  if (fullBg) addRegion('Full BG tiles', fullBg.start, fullBg.end);

  const spriteWords = (gen) => (Number(gen.tileCount) ? Number(gen.tileCount) * 64 : Math.ceil((Number(gen.vramBytes) || 0) / 2));
  const configuredSpritePatternBase = Number(options.spritePatternBase);
  const spritePatternBase = Number.isFinite(configuredSpritePatternBase)
    ? configuredSpritePatternBase
    : Math.max(
      computeVnSpritePatternBase(fontBudget, fontSpritePatternBase, spriteTextGlyphCount),
      computeVnFullScreenBgSpritePatternBase(assetDoc, options),
    );
  const spriteSlotPatternLayout = Array.isArray(options.spriteSlotPatternLayout)
    ? options.spriteSlotPatternLayout
    : computeVnSpriteSlotPatternLayout(assetDoc, spritePatternBase, options);
  for (const slotLayout of spriteSlotPatternLayout) {
    if (slotLayout.capacity) {
      addRegion('sprite patterns', slotLayout.base * 32, (slotLayout.base + slotLayout.capacity) * 32);
    }
  }
  return regions;
}

// Throw a build error if any two VRAM categories overlap, or any region runs past
// the end of VRAM. The user-facing message names both regions and the overlap range.
function validateVnVramLayout(assetDoc, fontBudget, fontSpritePatternBase, spriteTextGlyphCount, options = {}) {
  const regions = computeVnVramLayoutPacked(assetDoc, fontBudget, fontSpritePatternBase, spriteTextGlyphCount, options);
  // Multiple scene paths can produce the same packed geometry. Report each
  // actionable collision once instead of repeating an identical line for every
  // scene/layout that reaches it.
  const errors = new Set();
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i];
      const b = regions[j];
      const overlapStart = Math.max(a.start, b.start);
      const overlapEnd = Math.min(a.end, b.end);
      if (overlapEnd > overlapStart) {
        if (isAllowedVnVramOverlapPacked(a, b, options)) continue;
        errors.add(`「${a.name}」(VRAM word ${a.start}–${a.end}) と 「${b.name}」(word ${b.start}–${b.end}) が word ${overlapStart}–${overlapEnd} で重複しています。`);
      }
    }
  }
  for (const r of regions) {
    if (r.end > VN_VRAM_TOTAL_WORDS) {
      errors.add(`「${r.name}」が VRAM 末尾 (word ${VN_VRAM_TOTAL_WORDS}) を超えています (word ${r.start}–${r.end})。`);
    }
  }
  if (errors.size) {
    throw new Error(
      'VN VRAM 領域の排他予約に失敗しました。BG/スプライト/メッセージのいずれかを縮小するか font tileBase を調整してください:\n  '
      + Array.from(errors).join('\n  '));
  }
  return regions;
}

function validateVnSpritePaletteLayout(assetDoc, fontSpritePaletteBank = DEFAULT_FONT_SPRITE_PALETTE_BANK, options = {}) {
  const assets = (assetDoc && Array.isArray(assetDoc.assets)) ? assetDoc.assets : [];
  const spriteAssetIds = options.spriteAssetIds
    ? (options.spriteAssetIds instanceof Set ? options.spriteAssetIds : new Set(options.spriteAssetIds))
    : null;
  const spriteSlotLayouts = Array.isArray(options.spriteSlotLayouts) ? options.spriteSlotLayouts : [];
  if (!spriteSlotLayouts.length) return;
  const assetById = new Map();
  for (const asset of assets) {
    if (asset?.id) assetById.set(String(asset.id), asset);
  }
  const isReferencedAsset = (asset, ids) => !ids || (asset?.id && ids.has(String(asset.id)));
  const errors = new Set();
  for (const layout of spriteSlotLayouts) {
    if (!Array.isArray(layout)) continue;
    const usedBanks = new Map();
    for (let slot = 0; slot < 4; slot += 1) {
      const assetId = layout[slot];
      const key = String(assetId);
      const asset = assetById.get(key);
      if (!asset || asset.type !== 'sprite' || !isReferencedAsset(asset, spriteAssetIds)) continue;
      const rawBank = Number(asset.options && asset.options.paletteBank);
      const bank = (Number.isFinite(rawBank) ? rawBank : 0) + slot;
      if (bank >= fontSpritePaletteBank) {
        errors.add(`sprite palette bank ${bank} for SLOT${slot} (${key}) is reserved/out of range. Lower sprite paletteBank or reduce the SLOT number.`);
        continue;
      }
      const previous = usedBanks.get(bank);
      if (previous) {
        errors.add(`sprite palette bank ${bank} is used by both SLOT${previous.slot} (${previous.key}) and SLOT${slot} (${key}). Lower sprite paletteBank.`);
      } else {
        usedBanks.set(bank, { slot, key });
      }
    }
  }
  if (errors.size) {
    throw new Error(`VN sprite palette bank allocation failed:\n  ${Array.from(errors).join('\n  ')}`);
  }
}

// Resolve a font reference to an absolute path. Project-relative references
// (assets/fonts/...) are joined against projectDir so rendering uses the copy
// inside the project rather than the original external path.
function resolveFontPath(reference, projectDir = '') {
  const value = String(reference || '').trim();
  if (!value) return '';
  if (path.isAbsolute(value)) return value;
  return projectDir ? path.join(projectDir, value) : value;
}

function fontCandidates(config = {}, projectDir = '') {
  const normalized = normalizeFontConfig(config);
  const candidates = [];
  const addCandidate = (candidate) => {
    const resolved = resolveFontPath(candidate, projectDir);
    if (resolved && fs.existsSync(resolved)) candidates.push(resolved);
  };
  // Active selection first, then the rest of the imported library, then OS fonts.
  addCandidate(normalized.fontPath);
  normalized.fonts.forEach((entry) => addCandidate(entry.file));
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

function renderGlyphBitmapsWithPython(glyphs, config = {}, projectDir = '') {
  const candidates = fontCandidates(config, projectDir);
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

function renderGlyphBitmapsWithWindowsDrawing(glyphs, config = {}, projectDir = '') {
  if (process.platform !== 'win32') return null;
  const candidates = fontCandidates(config, projectDir);
  const normalized = normalizeFontConfig(config);
  if (!candidates.length) return null;
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Drawing
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $fontSize = [int]$payload.fontSize
  $threshold = [int]$payload.threshold
  $xOffset = [int]$payload.xOffset
  $yOffset = [int]$payload.yOffset
  $font = $null
  $fontPathUsed = ''
  $privateFonts = $null
  foreach ($fontPath in @($payload.fontPaths)) {
    if (-not $fontPath -or -not (Test-Path -LiteralPath $fontPath)) { continue }
    try {
      $privateFonts = New-Object System.Drawing.Text.PrivateFontCollection
      $privateFonts.AddFontFile($fontPath)
      if ($privateFonts.Families.Count -gt 0) {
        $font = New-Object System.Drawing.Font($privateFonts.Families[0], $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $fontPathUsed = $fontPath
        break
      }
    } catch {
      if ($privateFonts) { $privateFonts.Dispose(); $privateFonts = $null }
    }
  }
  if ($font -eq $null) {
    foreach ($familyName in @('Yu Gothic', 'Meiryo', 'MS Gothic', 'Microsoft Sans Serif')) {
      try {
        $font = New-Object System.Drawing.Font($familyName, $fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $fontPathUsed = $familyName
        break
      } catch {}
    }
  }
  if ($font -eq $null) {
    [Console]::Out.WriteLine((@{ ok = $false; error = 'font not found' } | ConvertTo-Json -Compress))
    exit 0
  }
  $format = New-Object System.Drawing.StringFormat
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
  $format.Alignment = [System.Drawing.StringAlignment]::Near
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $bitmaps = New-Object System.Collections.ArrayList
  foreach ($glyph in @($payload.glyphs)) {
    $bitmap = New-Object System.Drawing.Bitmap(${FONT_GLYPH_PX}, ${FONT_GLYPH_PX}, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Black)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    if ($glyph -ne ' ') {
      $size = $graphics.MeasureString($glyph, $font, 128, $format)
      $x = [Math]::Floor((${FONT_GLYPH_PX} - $size.Width) / 2) + $xOffset
      $y = [Math]::Floor((${FONT_GLYPH_PX} - $size.Height) / 2) + $yOffset
      $graphics.DrawString($glyph, $font, [System.Drawing.Brushes]::White, [single]$x, [single]$y, $format)
    }
    $pixels = New-Object System.Collections.ArrayList
    for ($py = 0; $py -lt ${FONT_GLYPH_PX}; $py++) {
      for ($px = 0; $px -lt ${FONT_GLYPH_PX}; $px++) {
        [void]$pixels.Add($(if ($bitmap.GetPixel($px, $py).R -ge $threshold) { 1 } else { 0 }))
      }
    }
    $graphics.Dispose()
    $bitmap.Dispose()
    [void]$bitmaps.Add($pixels)
  }
  $font.Dispose()
  if ($privateFonts) { $privateFonts.Dispose() }
  [Console]::Out.WriteLine((@{ ok = $true; bitmaps = $bitmaps; fontPath = $fontPathUsed } | ConvertTo-Json -Compress -Depth 5))
} catch {
  [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
}
`;
  const proc = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ], {
    input: JSON.stringify({
      glyphs,
      fontPaths: candidates,
      fontSize: normalized.fontSize,
      threshold: normalized.threshold,
      xOffset: normalized.xOffset,
      yOffset: normalized.yOffset,
    }),
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 4,
    windowsHide: true,
  });
  if (proc.error || proc.status !== 0 || !proc.stdout) return null;
  try {
    const parsed = JSON.parse(proc.stdout);
    if (parsed.ok && Array.isArray(parsed.bitmaps) && parsed.bitmaps.length === glyphs.length) {
      const visibleGlyph = glyphs.some((glyph, index) => glyph !== ' ' && Array.isArray(parsed.bitmaps[index]) && parsed.bitmaps[index].some(Boolean));
      if (visibleGlyph) return { bitmaps: parsed.bitmaps, renderer: 'windows', fontPath: parsed.fontPath || '' };
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

function renderGlyphBitmaps(glyphs, config = {}, projectDir = '') {
  return renderGlyphBitmapsWithWindowsDrawing(glyphs, config, projectDir)
    || renderGlyphBitmapsWithPython(glyphs, config, projectDir)
    || {
      bitmaps: glyphs.map((glyph, index) => fallbackGlyphBitmap(glyph, index)),
      renderer: 'fallback',
      fontPath: '',
    };
}

function renderGlyphMaskData(glyphs, config = {}, projectDir = '') {
  return encodeGlyphMaskData(renderGlyphBitmaps(glyphs, config, projectDir).bitmaps);
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
      const generatedColumns = clampPositiveInt(generated.cellColumns ?? generated.columns, 1, assetManager.PCE_IMAGE_MAX_WIDTH / 16, 0);
      const generatedRows = clampPositiveInt(generated.cellRows ?? generated.rows, 1, assetManager.PCE_SPRITE_MAX_HEIGHT / 16, 0);
      const generatedWidth = clampPositiveInt(generated.width, cellWidth, assetManager.PCE_IMAGE_MAX_WIDTH, generatedColumns ? generatedColumns * cellWidth : 0);
      const generatedHeight = clampPositiveInt(generated.height, cellHeight, assetManager.PCE_SPRITE_MAX_HEIGHT, generatedRows ? generatedRows * cellHeight : 0);
      const width = clampPositiveInt(options.width, cellWidth, assetManager.PCE_IMAGE_MAX_WIDTH, generatedWidth || cellWidth);
      const height = clampPositiveInt(options.height, cellHeight, assetManager.PCE_SPRITE_MAX_HEIGHT, generatedHeight || cellHeight);
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
        if (onlyId === 'default' && clampInt(only.frameCount, 1, 64, 1) <= 1) {
          return;
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
        const frameCount = clampInt(animation.frameCount, 1, 64, 1);
        const frameDelay = clampInt(animation.frameDelay, 1, VN_SPRITE_FRAME_DELAY_MAX, 8);
        // Per-frame delay table (length frameCount); cells fall back to frameDelay.
        // The runtime advances each frame after its own delay instead of one
        // uniform frame_delay for the whole animation.
        const rawFrameDelays = Array.isArray(animation.frameDelays) ? animation.frameDelays : [];
        const frameDelays = Array.from({ length: frameCount }, (_, frameIndex) => clampInt(rawFrameDelays[frameIndex], 1, VN_SPRITE_FRAME_DELAY_MAX, frameDelay));
        const customFrameDelays = frameDelays.some((delay) => delay !== frameDelay) ? frameDelays : [];
        meta.push({
          spriteIndex: spriteIndex.get(asset.id),
          firstCell: clampInt(animation.firstCell, 0, 255, 0),
          frameCount,
          frameDelay,
          frameDelays: customFrameDelays,
          frameWidthCells: clampInt(frameWidthCells, 1, 16, 1),
          frameHeightCells: clampInt(frameHeightCells, 1, 16, 1),
          frameStrideCells: clampPositiveInt(animation.frameStrideCells, 1, 255, frameWidthCells * frameHeightCells),
          loop: animation.loop !== false,
        });
      });
    });
  return { index, meta };
}

function collectVariableDefinitions(doc = {}, systemSettings = normalizeVnSystemSettings(doc.settings)) {
  const index = new Map([
    [VN_VARIABLE_AUTO_ENABLE_NAME, VN_VARIABLE_AUTO_ENABLE_INDEX],
    [VN_VARIABLE_MSG_SPEED_NAME, VN_VARIABLE_MSG_SPEED_INDEX],
  ]);
  const initialValues = [
    systemSettings.messageAdvanceMode === 'auto' ? 1 : 0,
    0,
  ];
  const defined = new Set([
    VN_VARIABLE_AUTO_ENABLE_NAME,
    VN_VARIABLE_MSG_SPEED_NAME,
  ]);
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
    compiledSceneCommands(scene).forEach((command) => {
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

const vnScenePackCodecInstances = new Map();
function buildScenePack(sceneBuild, hucardMode = false) {
  const key = hucardMode ? 'hucard-v1' : 'jp-v3-v2';
  if (!vnScenePackCodecInstances.has(key)) {
    vnScenePackCodecInstances.set(key, createVnScenePackCodec({
      clampInt,
      clampSignedInt,
      constants: {
        cacheBytes: hucardMode ? VN_HUCARD_SCENE_PACK_CACHE_BYTES : VN_SCENE_PACK_CACHE_BYTES,
        magic: VN_SCENE_PACK_MAGIC,
        version: hucardMode ? VN_HUCARD_SCENE_PACK_VERSION : VN_SCENE_PACK_VERSION,
        headerSize: VN_SCENE_PACK_HEADER_SIZE,
        commandSize: VN_SCENE_PACK_COMMAND_SIZE,
        messageSize: VN_SCENE_PACK_MESSAGE_SIZE,
        choiceSize: VN_SCENE_PACK_CHOICE_SIZE,
        switchSize: VN_SCENE_PACK_SWITCH_SIZE,
        spriteTextCommand: VN_COMMAND_SPRITETEXT,
        instantGlyphMax: VN_MESSAGE_INSTANT_GLYPH_MAX,
      },
    }));
  }
  return vnScenePackCodecInstances.get(key).buildScenePack(sceneBuild);
}

function writeScenePack(projectDir, sceneBuild) {
  const relativePath = sceneBuild.packPath;
  const absPath = path.join(projectDir, relativePath);
  writeFileIfChanged(absPath, sceneBuild.packBuffer);
  return relativePath;
}

function hucardDataRefSymbol(base) {
  return toCIdentifier(base);
}

function hucardScenePackRefSymbol(index) {
  return hucardDataRefSymbol(`pce_vn_scene_pack_ref_${index}`);
}

function hucardPsgPatternPath(asset, index) {
  const id = toCIdentifier(asset?.id || `psg_${index}`);
  return normalizeRelativePath(path.join(VN_HUCARD_PSG_DIR, `${id}.bin`));
}

function hucardPsgPatternRefSymbol(index) {
  return hucardDataRefSymbol(`pce_vn_psg_pattern_ref_${index}`);
}

function writeHuCardPsgPatternFiles(projectDir, psgAssets = []) {
  const entries = [];
  psgAssets.forEach((asset, index) => {
    const options = assetManager.normalizePsgOptions(asset);
    const pattern = assetManager.normalizePsgPatternEntries(asset, options);
    const relativePath = hucardPsgPatternPath(asset, index);
    const absPath = path.join(projectDir, relativePath);
    const bytes = assetManager.serializePsgPattern(pattern);
    writeFileIfChanged(absPath, bytes);
    entries.push({
      asset,
      options,
      pattern,
      relativePath,
      symbol: hucardPsgPatternRefSymbol(index),
      byteSize: bytes.length,
    });
  });
  return entries;
}

function hucardExtraDataFiles(sceneBuilds = [], psgEntries = [], includeFontSprite = false) {
  const banked = (entry) => ({ ...entry, forceBanked: true });
  const files = [
    banked({ symbol: 'pce_vn_font_data_ref', relativePath: normalizeRelativePath(VN_FONT_DATA_FILE) }),
    ...sceneBuilds.map((sceneBuild, index) => banked({
      symbol: hucardScenePackRefSymbol(index),
      relativePath: sceneBuild.packPath,
    })),
  ];
  if (includeFontSprite) {
    files.push(banked({ symbol: 'pce_vn_font_sprite_data_ref', relativePath: normalizeRelativePath(VN_FONT_SPRITE_DATA_FILE) }));
  }
  psgEntries.forEach((entry) => {
    files.push(banked({ symbol: entry.symbol, relativePath: entry.relativePath }));
  });
  return files;
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

function systemCardPsgPackagePath(asset, channel) {
  const ident = toCIdentifier(asset?.id || 'psg');
  return normalizeRelativePath(path.join(VN_SYSTEM_CARD_PSG_DIR, ident + '.ch' + clampInt(channel, 0, 5, 0) + '.bin'));
}

function collectSystemCardPsgVariants(doc, assetDoc) {
  const assets = new Map((assetDoc.assets || [])
    .filter((asset) => asset?.id && (asset.type === 'psg-song' || asset.type === 'psg-sfx'))
    .map((asset) => [String(asset.id), asset]));
  const variants = new Map();
  const add = (assetId, channel, location) => {
    const asset = assets.get(String(assetId || ''));
    if (!asset) return;
    const resolvedChannel = clampInt(channel, 0, 5, 0);
    const key = systemCardPsg.systemCardPsgVariantKey(asset.id, resolvedChannel);
    if (!variants.has(key)) {
      variants.set(key, {
        key,
        asset,
        channel: resolvedChannel,
        bus: asset.type === 'psg-song' ? 'bgm' : 'sfx',
        location,
      });
    }
  };
  (doc.scenes || []).forEach((scene, sceneIndex) => {
    const active = { bgm: '', sfx: '' };
    compiledSceneCommands(scene).forEach((command, commandIndex) => {
      const location = 'scene "' + (scene.id || sceneIndex) + '", command ' + commandIndex;
      if (command.type === 'audio' && command.kind === 'psg') {
        if (command.action === 'play' && command.assetId) {
          add(command.assetId, command.channel, location);
          const asset = assets.get(String(command.assetId));
          if (asset) active[asset.type === 'psg-song' ? 'bgm' : 'sfx'] = systemCardPsg.systemCardPsgVariantKey(asset.id, command.channel);
        } else if (command.action === 'stop') {
          const target = command.target === 'bgm' || command.target === 'sfx' ? command.target : 'all';
          if (target === 'all' || target === 'bgm') active.bgm = '';
          if (target === 'all' || target === 'sfx') active.sfx = '';
        }
      }
      if (command.type === 'cache' && command.action === 'load' && command.scope === 'psg' && command.assetId) {
        add(command.assetId, command.channel, location);
        const asset = assets.get(String(command.assetId));
        if (asset) {
          const bus = asset.type === 'psg-song' ? 'bgm' : 'sfx';
          const key = systemCardPsg.systemCardPsgVariantKey(asset.id, command.channel);
          if (active[bus] && active[bus] !== key) {
            throw new Error(location + ': cannot preload System Card PSG package "' + key
              + '" while another ' + bus.toUpperCase() + ' package is playing; stop that bus first');
          }
        }
      }
    });
  });
  return Array.from(variants.values());
}

function writeSystemCardPsgPackages(projectDir, variants) {
  const dir = path.join(projectDir, VN_SYSTEM_CARD_PSG_DIR);
  ensureDirSync(dir);
  const expected = new Set();
  const compiled = variants.map((variant) => {
    const result = systemCardPsg.compileSystemCardPsgPackage(variant.asset, variant.channel);
    const relativePath = systemCardPsgPackagePath(variant.asset, variant.channel);
    const absPath = path.join(projectDir, relativePath);
    expected.add(path.resolve(absPath));
    ensureDirSync(path.dirname(absPath));
    fs.writeFileSync(absPath, result.bytes);
    return { ...variant, ...result, relativePath };
  });
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.bin')) continue;
    const absPath = path.resolve(dir, entry.name);
    if (!expected.has(absPath)) fs.unlinkSync(absPath);
  }
  return compiled;
}

function generateVnSources(projectDir, options = {}) {
  const targetMedia = String(options.targetMedia || options.target || '').trim().toLowerCase();
  const hucardMode = targetMedia === 'hucard';
  const assetDoc = assetManager.readAssetDocument(projectDir);
  const doc = writeSceneDocument(projectDir, readSceneDocument(projectDir));
  const runtimeAssetIds = collectSceneRuntimeAssetIds(doc);
  const runtimeAssetDoc = {
    ...assetDoc,
    assets: (assetDoc.assets || []).filter((asset) => asset?.id && runtimeAssetIds.has(String(asset.id))),
  };
  const visualAssetUsage = collectSceneVisualAssetUsage(doc);
  const systemPsgVariants = hucardMode
    ? []
    : writeSystemCardPsgPackages(projectDir, collectSystemCardPsgVariants(doc, runtimeAssetDoc));
  const systemPsgVariantIndex = new Map(systemPsgVariants.map((variant, index) => [variant.key, index]));
  const systemSettings = normalizeVnSystemSettings(doc.settings);
  if ((doc.scenes || []).length > VN_MAX_U8_COUNT) {
    throw new Error(`PCE VN supports up to ${VN_MAX_U8_COUNT} scenes`);
  }
  const rawGlyphs = collectGlyphsRaw(doc);
  const glyphs = rawGlyphs.slice(0, VN_MAX_GLYPH_COUNT);
  const glyphIndex = new Map(glyphs.map((glyph, index) => [glyph, index]));
  const savedFontConfig = readFontConfig(projectDir);
  const fontConfig = normalizeFontConfig({
    ...savedFontConfig,
    ...(options.fontConfig || {}),
    tileBase: resolveBuildFontTileBase(savedFontConfig, options),
  });
  const fontTileBase = Number(fontConfig.tileBase || DEFAULT_FONT_TILE_BASE);
  const fontBudget = computeFontBudget(hucardMode ? rawGlyphs.length : 0, fontTileBase);
  if (fontBudget.errors.length) {
    throw new Error(fontBudget.errors.join(' '));
  }

  // HuCARD owns both the BG message font and the optional spritetext font.
  // Render their union in one host call, then fan the bitmaps back out. The old
  // path rendered each set independently, and some host renderers launched a
  // process per glyph, making generation scale with process startup.
  const spriteTextGlyphs = collectSpriteTextGlyphsRaw(doc).slice(0, VN_FONT_SPRITE_MAX_GLYPH_COUNT);
  const systemSpriteGlyphCapacity = hucardMode
    ? spriteTextGlyphs.length
    : Math.min(spriteTextGlyphs.length, VN_CD_SPRITETEXT_CACHE_MAX_GLYPHS);
  const spriteGlyphIndex = new Map(spriteTextGlyphs.map((glyph, index) => [glyph, index]));
  const renderGlyphs = hucardMode ? Array.from(new Set([...glyphs, ...spriteTextGlyphs])) : [];
  const combinedFontRender = hucardMode
    ? renderGlyphBitmaps(renderGlyphs, fontConfig, projectDir)
    : { bitmaps: [], renderer: 'system-card-jp-v3', fontPath: '' };
  const bitmapByGlyph = new Map(renderGlyphs.map((glyph, index) => [glyph, combinedFontRender.bitmaps[index]]));
  const fontRender = {
    bitmaps: glyphs.map((glyph) => bitmapByGlyph.get(glyph)),
    renderer: combinedFontRender.renderer,
    fontPath: combinedFontRender.fontPath,
  };
  const fontTiles = hucardMode ? encodeGlyphMaskData(fontRender.bitmaps) : Buffer.alloc(0);
  const fontDataPath = normalizeRelativePath(VN_FONT_DATA_FILE);
  const fontDataAbsPath = path.join(projectDir, fontDataPath);
  if (hucardMode) {
    writeFileIfChanged(fontDataAbsPath, fontTiles);
  } else if (fs.existsSync(fontDataAbsPath)) {
    fs.unlinkSync(fontDataAbsPath);
  }

  // Sprite-format font for `spritetext` overlays. Only the characters used by
  // spritetext are encoded, and only when at least one scene uses the command.
  const fontSpriteDataPath = normalizeRelativePath(VN_FONT_SPRITE_DATA_FILE);
  const fontSpriteDataAbsPath = path.join(projectDir, fontSpriteDataPath);
  const fontSpriteWarnings = [];
  let fontSpriteTiles = Buffer.alloc(0);
  let fontSpriteRenderer = '';
  // Pack the spritetext font and the four fixed sprite SLOT ranges in the order
  // that leaves the smaller high-water mark. When either is visible over Full
  // BG, its floor is raised past the Full BG tiles. Font starts remain even for
  // the VDC's 16x16 sprite addressing rule.
  const hardwareSpriteLayout = computeVnHardwareSpriteLayout(
    assetDoc,
    fontBudget,
    systemSpriteGlyphCapacity,
    visualAssetUsage,
  );
  const fontSpritePatternBase = hardwareSpriteLayout.fontSpritePatternBase;
  const fontSpritePaletteBank = clampInt(
    options.fontConfig?.spritePaletteBank ?? fontConfig.spritePaletteBank,
    0, 15, DEFAULT_FONT_SPRITE_PALETTE_BANK,
  );
  if (hucardMode && spriteTextGlyphs.length) {
    fontSpriteRenderer = combinedFontRender.renderer;
    fontSpriteTiles = encodeGlyphSpriteData(spriteTextGlyphs.map((glyph) => bitmapByGlyph.get(glyph)));
    writeFileIfChanged(fontSpriteDataAbsPath, fontSpriteTiles);
    // Warn (non-fatal) when the sprite font would collide with sprite asset
    // patterns or run past the SATB. Author controls glyph count, so this is a
    // budget hint rather than a hard error.
    const spriteFontEndWord = (fontSpritePatternBase + (spriteTextGlyphs.length * 2)) * 32;
    if (spriteFontEndWord > 0x7f00) {
      fontSpriteWarnings.push(`スプライトフォント: ${spriteTextGlyphs.length} グリフが VRAM 末尾 (SATB) を超えます。spritetext の文字種を減らしてください。`);
    }
  } else if (fs.existsSync(fontSpriteDataAbsPath)) {
    // No spritetext in the project: drop a stale generated file so the CD layout
    // does not keep reserving a sector for it.
    try { fs.unlinkSync(fontSpriteDataAbsPath); } catch (_) {}
  }
  const fontSpriteBudget = {
    glyphCount: hucardMode ? spriteTextGlyphs.length : 0,
    byteSize: fontSpriteTiles.length,
    sectorCount: Math.max(1, Math.ceil(fontSpriteTiles.length / VN_CD_SECTOR_BYTES)),
  };
  doc.scenes.forEach((scene) => validateFullScreenBgScene(scene, assetDoc));

  // Single authoritative VRAM reservation check: reject any overlap between BG,
  // message display tiles, spritetext font, sprite patterns, BAT, and SATB.
  const packedVisualUsage = {
    ...visualAssetUsage,
    spritePatternBase: hardwareSpriteLayout.spritePatternBase,
    spriteSlotPatternLayout: hardwareSpriteLayout.spriteSlotPatternLayout,
  };
  validateVnVramLayout(assetDoc, fontBudget, fontSpritePatternBase, systemSpriteGlyphCapacity, packedVisualUsage);
  validateVnSpritePaletteLayout(assetDoc, fontSpritePaletteBank, visualAssetUsage);
  const spritePatternBase = hardwareSpriteLayout.spritePatternBase;
  const spriteSlotPatternLayout = hardwareSpriteLayout.spriteSlotPatternLayout;

  const imageIndex = indexAssets(runtimeAssetDoc.assets || [], 'image');
  const spriteIndex = indexAssets(runtimeAssetDoc.assets || [], 'sprite');
  const adpcmIndex = indexAssets(runtimeAssetDoc.assets || [], 'adpcm');
  const cddaIndex = indexAssets(runtimeAssetDoc.assets || [], 'cdda-track');
  const psgIndex = indexPsgAssets(runtimeAssetDoc.assets || []);
  const spriteAnimations = buildSpriteAnimationIndex(runtimeAssetDoc, spriteIndex);
  if (spriteAnimations.meta.length > VN_MAX_SPRITE_ANIMATION_COUNT) {
    throw new Error(`PCE VN supports up to ${VN_MAX_SPRITE_ANIMATION_COUNT} sprite animations`);
  }
  const sceneIndex = new Map(doc.scenes.map((scene, index) => [scene.id, index]));
  const variables = collectVariableDefinitions(doc, systemSettings);
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
      flags: scene.fullScreenBg ? VN_SCENE_FLAG_FULL_SCREEN_BG : 0,
      commands: [],
      messages: [],
      choices: [],
      switches: [],
    };
    const slotSpriteAssets = ['', '', '', ''];
    // Comment and debug-skipped commands are editor-only. Drop them before both
    // the label pass and the emit pass so program-counter / label targets stay
    // in sync with the emitted command records.
    const compiledCommands = compiledSceneCommands(scene);
    const labels = new Map();
    compiledCommands.forEach((command, commandIndex) => {
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
    let previousExplicitAdpcmPreloadAssetId = '';
    const pushInternalAdpcmPreload = (assetId) => {
      const assetIndex = adpcmIndex.get(assetId) ?? -1;
      if (assetIndex < 0) return;
      pushCommand({
        type: VN_COMMAND_CACHE,
        assetIndex,
        slot: 0,
        flags: VN_CACHE_ACTION_LOAD,
        arg0: VN_CACHE_SCOPE_ADPCM,
        arg1: 0,
        x: 0,
        y: 0,
        messageIndex: -1,
        animationIndex: -1,
        sceneIndex: -1,
        choiceIndex: -1,
      });
    };
    const firstHoistableAdpcmPreloadAssetId = () => {
      if (hucardMode) return '';
      for (const command of compiledCommands) {
        if (command.type === 'message') {
          return command.voiceAssetId || '';
        }
        if (command.type === 'cache') {
          const scope = normalizeCacheScope(command.scope);
          if (scope === 'adpcm' || scope === 'all') return '';
        }
        if (command.type === 'audio' && command.kind === 'adpcm') return '';
        if (command.type === 'choice' || command.type === 'inputcheck' || command.type === 'if' || command.type === 'switch' || command.type === 'goto') return '';
      }
      return '';
    };
    let knownAdpcmPreloadAssetId = '';
    const hoistedAdpcmPreloadAssetId = firstHoistableAdpcmPreloadAssetId();
    if (hoistedAdpcmPreloadAssetId) {
      assertBufferedMessageVoice(assetDoc, hoistedAdpcmPreloadAssetId, projectDir, sceneBuild.sceneId);
      pushInternalAdpcmPreload(hoistedAdpcmPreloadAssetId);
      knownAdpcmPreloadAssetId = hoistedAdpcmPreloadAssetId;
    }
    compiledCommands.forEach((command, commandIndex) => {
      if (command.type === 'background') {
        previousExplicitAdpcmPreloadAssetId = '';
        const bgIndex = imageIndex.has(command.assetId) ? imageIndex.get(command.assetId) : -1;
        pushCommand({
          type: VN_COMMAND_BACKGROUND,
          assetIndex: bgIndex,
          flags: VN_BG_TRANSITION_FADE,
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
        previousExplicitAdpcmPreloadAssetId = '';
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
          arg0: 0,
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
      if (command.type === 'spritemove') {
        previousExplicitAdpcmPreloadAssetId = '';
        const slot = clampInt(command.slot, 0, 3, 0);
        const frames = clampInt(command.frames, 1, 65535, 30);
        let spriteAssetIndex = -1;
        let animationIndex = -1;
        if (command.animationId) {
          const spriteAssetId = command.animationAssetId || slotSpriteAssets[slot] || '';
          spriteAssetIndex = spriteIndex.has(spriteAssetId) ? spriteIndex.get(spriteAssetId) : -1;
          animationIndex = spriteAssetIndex >= 0
            ? (spriteAnimations.index.get(`${spriteAssetId}:${command.animationId}`) ?? -1)
            : -1;
          if (spriteAssetIndex < 0 || animationIndex < 0) {
            throw new Error(`PCE VN scene "${sceneBuild.sceneId}" command ${commandIndex + 1}: spritemove animation "${command.animationId}" is not defined for sprite "${spriteAssetId || '(none)'}"`);
          }
          if (slotSpriteAssets[slot] && slotSpriteAssets[slot] !== spriteAssetId) {
            throw new Error(`PCE VN scene "${sceneBuild.sceneId}" command ${commandIndex + 1}: spritemove animation sprite "${spriteAssetId}" does not match slot ${slot} sprite "${slotSpriteAssets[slot]}"`);
          }
        }
        pushCommand({
          type: VN_COMMAND_SPRITE_MOVE,
          assetIndex: spriteAssetIndex,
          slot,
          flags: command.async ? VN_SPRITE_MOVE_ASYNC : 0,
          arg0: frames & 0xff,
          arg1: (frames >> 8) & 0xff,
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
        // HuCARD strips ADPCM/CD audio, so a voiced message carries no ADPCM on
        // that target (voiceIndex resolves to -1 below). Skip the buffered-voice
        // validation and the internal ADPCM preload injection there so the
        // command stream matches the stripped output (otherwise an extra CACHE
        // preload command shifts every following command index).
        if (!hucardMode && command.voiceAssetId) {
          assertBufferedMessageVoice(assetDoc, command.voiceAssetId, projectDir, sceneBuild.sceneId);
          if (previousExplicitAdpcmPreloadAssetId !== command.voiceAssetId
            && knownAdpcmPreloadAssetId !== command.voiceAssetId) {
            pushInternalAdpcmPreload(command.voiceAssetId);
            knownAdpcmPreloadAssetId = command.voiceAssetId;
          }
        }
        previousExplicitAdpcmPreloadAssetId = '';
        if (sceneBuild.messages.length >= VN_MAX_U8_COUNT) {
          throw new Error('PCE VN supports up to 255 messages per scene');
        }
        const display = messageDisplayParts(command);
        let bytes;
        let entryCount;
        if (hucardMode) {
          bytes = [];
          entryCount = 0;
          for (const glyph of display.full) {
            if (glyph === '\r') continue;
            if (glyph === '\n') {
              bytes.push(GLYPH_NEWLINE_BYTE);
              entryCount += 1;
              continue;
            }
            pushGlyphIndexEntry(bytes, glyphIndex.get(glyph) ?? 0);
            entryCount += 1;
          }
          bytes.push(GLYPH_END_BYTE);
        } else {
          const encoded = systemCardFont.encodeSystemCardText(display.full, {
            sceneId: sceneBuild.sceneId, commandIndex, field: 'message',
          }, { maxCharacters: 68 });
          bytes = Array.from(encoded.buffer);
          entryCount = encoded.length;
        }
        // glyph_count is the number of entries (glyphs + newlines), excluding the
        // terminator. It is stored as a u8, so cap at 255 entries.
        if (entryCount > VN_MAX_U8_COUNT) {
          throw new Error(`PCE VN message in scene "${sceneBuild.sceneId}" exceeds 255 glyphs`);
        }
        const mouthSlot = command.mouthSlot == null ? -1 : clampInt(command.mouthSlot, 0, 3, 0);
        const voiceIndex = !hucardMode && command.voiceAssetId && adpcmIndex.has(command.voiceAssetId)
          ? adpcmIndex.get(command.voiceAssetId)
          : -1;
        const messageIndex = sceneBuild.messages.length;
        sceneBuild.messages.push({
          glyphs: Buffer.from(bytes),
          glyphCount: entryCount,
          voiceIndex,
          textSpeedFrames: hucardMode
            ? systemSettings.messageSpeedFrames
            : voiceSyncedTextSpeedFrames(command, display.bodyDrawableCount, assetDoc, projectDir, systemSettings.messageSpeedFrames),
          advanceMode: systemSettings.messageAdvanceMode === 'auto' ? VN_ADVANCE_AUTO : VN_ADVANCE_BUTTON,
          autoWaitFrames: systemSettings.messageAutoWaitFrames,
          mouthSlot,
          instantGlyphCount: display.instantGlyphCount,
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
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = command.kind === 'adpcm' && command.action === 'play' ? command.assetId : knownAdpcmPreloadAssetId;
        const kindCode = command.kind === 'adpcm'
          ? VN_AUDIO_KIND_ADPCM
          : (command.kind === 'psg' ? VN_AUDIO_KIND_PSG : VN_AUDIO_KIND_CDDA);
        const action = command.action === 'stop' ? VN_AUDIO_ACTION_STOP : VN_AUDIO_ACTION_PLAY;
        const lookupIndex = () => {
          if (kindCode === VN_AUDIO_KIND_ADPCM) return adpcmIndex.get(command.assetId) ?? -1;
          if (kindCode === VN_AUDIO_KIND_PSG) {
            if (hucardMode) return psgIndex.get(command.assetId) ?? -1;
            return systemPsgVariantIndex.get(systemCardPsg.systemCardPsgVariantKey(command.assetId, command.channel)) ?? -1;
          }
          return cddaIndex.get(command.assetId) ?? -1;
        };
        const assetIndex = command.action === 'play' && (!hucardMode || kindCode === VN_AUDIO_KIND_PSG)
          ? lookupIndex()
          : -1;
        const flags = kindCode | action;
        pushCommand({
          type: VN_COMMAND_AUDIO,
          assetIndex,
          // HuCard resolves base channel at runtime. CD package variants are
          // already shifted/clamped and the package record selects main/sub.
          slot: kindCode === VN_AUDIO_KIND_PSG && hucardMode ? clampInt(command.channel, 0, 5, 0) : 0,
          flags,
          arg0: kindCode === VN_AUDIO_KIND_PSG && action === VN_AUDIO_ACTION_STOP
            ? (command.target === 'bgm' ? VN_PSG_STOP_BGM : (command.target === 'sfx' ? VN_PSG_STOP_SFX : VN_PSG_STOP_ALL))
            : 0,
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
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = '';
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
      if (command.type === 'cache') {
        const cacheAction = cacheActionCode(command.action);
        let assetIndex = -1;
        let slot = 0;
        let x = 0;
        let y = 0;
        if (cacheAction === VN_CACHE_ACTION_LOAD && command.assetId) {
          if (command.scope === 'bg') {
            assetIndex = imageIndex.get(command.assetId) ?? -1;
            x = command.x;
            y = command.y;
          } else if (command.scope === 'sprite') {
            assetIndex = spriteIndex.get(command.assetId) ?? -1;
            slot = command.slot;
          } else if (command.scope === 'adpcm' && !hucardMode) {
            assetIndex = adpcmIndex.get(command.assetId) ?? -1;
          } else if (command.scope === 'psg') {
            assetIndex = hucardMode
              ? (psgIndex.get(command.assetId) ?? -1)
              : (systemPsgVariantIndex.get(systemCardPsg.systemCardPsgVariantKey(command.assetId, command.channel)) ?? -1);
            slot = hucardMode ? clampInt(command.channel, 0, 5, 0) : 0;
          }
        }
        pushCommand({
          type: VN_COMMAND_CACHE,
          assetIndex,
          slot,
          flags: cacheAction,
          arg0: cacheScopeCode(command.scope),
          arg1: 0,
          x,
          y,
          messageIndex: -1,
          animationIndex: -1,
          sceneIndex: -1,
          choiceIndex: -1,
        });
        previousExplicitAdpcmPreloadAssetId = cacheAction === VN_CACHE_ACTION_LOAD
          && command.scope === 'adpcm'
          && command.assetId
          ? command.assetId
          : '';
        if (cacheAction === VN_CACHE_ACTION_LOAD && command.scope === 'adpcm' && command.assetId) {
          knownAdpcmPreloadAssetId = command.assetId;
        } else if (cacheAction === VN_CACHE_ACTION_CLEAR) {
          const scope = normalizeCacheScope(command.scope);
          if (scope === 'adpcm' || scope === 'all') knownAdpcmPreloadAssetId = '';
        }
        return;
      }
      if (command.type === 'choice') {
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = '';
        if (sceneBuild.choices.length >= VN_MAX_U8_COUNT) {
          throw new Error('PCE VN supports up to 255 choices per scene');
        }
        const options = (command.choices || []).slice(0, 4);
        const encodedOptions = options.map((option, optionIndex) => {
          let bytes;
          let entryCount;
          if (hucardMode) {
            bytes = [];
            entryCount = 0;
            for (const glyph of String(option.label || '')) {
              if (glyph === '\r' || glyph === '\n') continue;
              pushGlyphIndexEntry(bytes, glyphIndex.get(glyph) ?? 0);
              entryCount += 1;
            }
            bytes.push(GLYPH_END_BYTE);
          } else {
            const encoded = systemCardFont.encodeSystemCardText(String(option.label || '').replace(/[\r\n]/g, ''), {
              sceneId: sceneBuild.sceneId, commandIndex, field: `choice[${optionIndex}]`,
            }, { maxCharacters: 68 });
            bytes = Array.from(encoded.buffer);
            entryCount = encoded.length;
          }
          if (entryCount > VN_MAX_U8_COUNT) {
            throw new Error(`PCE VN choice label in scene "${sceneBuild.sceneId}" exceeds 255 glyphs`);
          }
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
        previousExplicitAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
        knownAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
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
        previousExplicitAdpcmPreloadAssetId = '';
        let glyphBytes;
        let spriteTextLength;
        if (hucardMode) {
          glyphBytes = [];
          for (const char of String(command.text || '')) {
            if (glyphBytes.length >= VN_SPRITETEXT_MAX_GLYPHS) break;
            if (char === '\n') { glyphBytes.push(0xfe); continue; }
            if (char === '\r') continue;
            if (spriteGlyphIndex.has(char)) glyphBytes.push(spriteGlyphIndex.get(char));
          }
          spriteTextLength = glyphBytes.length;
        } else {
          const encoded = systemCardFont.encodeSystemCardText(String(command.text || ''), {
            sceneId: sceneBuild.sceneId, commandIndex, field: 'spritetext',
          }, { maxCharacters: VN_SPRITETEXT_MAX_GLYPHS, terminate: false });
          glyphBytes = Array.from(encoded.buffer);
          spriteTextLength = encoded.length;
        }
        pushCommand({
          type: VN_COMMAND_SPRITETEXT,
          // assetIndex is patched to the glyph data offset in buildScenePack.
          assetIndex: 0,
          slot: clampInt(command.slot, 0, 3, 0),
          flags: command.visible ? VN_SPRITE_VISIBLE : 0,
          arg0: clampInt(command.blinkFrames, 0, 255, 0),
          arg1: spriteTextLength,
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
    sceneBuild.packBuffer = buildScenePack(sceneBuild, hucardMode);
    writeScenePack(projectDir, sceneBuild);
    sceneBuilds.push(sceneBuild);
  });

  // CD per-frame delay tables are project-sized generated data, so keep them in
  // bank132 with the animation records instead of consuming fixed bank128
  // resident rodata. The CD runtime maps bank132 before animation ticks. HuCARD
  // keeps the same tables in its generated ROM data.
  const animationDelayTables = spriteAnimations.meta.map((animation, index) => (
    animation.frameDelays && animation.frameDelays.length
      ? `static const unsigned int${hucardMode ? '' : ' PCE_VN_DATA_SECTION'} pce_vn_sprite_anim_delays_${index}[] = { ${animation.frameDelays.map((delay) => `${clampInt(delay, 1, VN_SPRITE_FRAME_DELAY_MAX, animation.frameDelay)}u`).join(', ')} };`
      : ''
  )).filter(Boolean);
  const animationMeta = spriteAnimations.meta.map((animation, index) => (
    `  { ${animation.spriteIndex}u, ${animation.firstCell}u, ${animation.frameCount}u, ${animation.frameDelay}u, ${animation.frameWidthCells}u, ${animation.frameHeightCells}u, ${animation.frameStrideCells}u, ${animation.loop ? '1u' : '0u'}, ${animation.frameDelays && animation.frameDelays.length ? `pce_vn_sprite_anim_delays_${index}` : '(const unsigned int *)0'} }${index + 1 < spriteAnimations.meta.length ? ',' : ''}`
  ));
  const hucardPsgAssets = hucardMode
    ? (runtimeAssetDoc.assets || []).filter((asset) => asset.type === 'psg-song' || asset.type === 'psg-sfx')
    : [];
  const hucardPsgEntries = hucardMode ? writeHuCardPsgPatternFiles(projectDir, hucardPsgAssets) : [];
  const cdDataFiles = Array.isArray(options.cdDataFiles)
    ? (hucardMode ? [] : options.cdDataFiles.map((entry) => normalizeRelativePath(entry || '')).filter(Boolean))
    : (hucardMode ? [] : collectCdDataFiles(projectDir));
  const cdLayout = hucardMode ? new Map() : cdLayoutForFiles(projectDir, cdDataFiles);
  const fontLayout = cdLayout.get(fontDataPath) || {};
  const fontSectorCount = hucardMode ? (fontLayout.sectorCount || fontBudget.sectorCount) : 0;
  const fontDataInitializer = hucardMode
    ? `{ ${cdSectorInitializer(fontLayout)}, ${fontSectorCount}u, ${fontBudget.byteSize}u }`
    : '{ { 0u, 0u, 0u }, 0u, 0u }';
  const fontSpriteLayout = cdLayout.get(fontSpriteDataPath) || {};
  const fontSpriteSectorCount = fontSpriteBudget.byteSize
    ? (fontSpriteLayout.sectorCount || fontSpriteBudget.sectorCount)
    : 0;
  const fontSpriteDataInitializer = `{ ${cdSectorInitializer(fontSpriteLayout)}, ${fontSpriteSectorCount}u, ${fontSpriteBudget.byteSize}u }`;
  const hasFullScreenBg = doc.scenes.some((scene) => !!scene.fullScreenBg);
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
  const visualCodeDataPath = normalizeRelativePath(VN_VISUAL_CODE_DATA_FILE);
  const visualCodeAbsPath = path.join(projectDir, visualCodeDataPath);
  const visualCodeExists = fs.existsSync(visualCodeAbsPath);
  const visualCodeLayout = visualCodeExists ? (cdLayout.get(visualCodeDataPath) || {}) : {};
  const visualCodeByteSize = visualCodeExists ? fs.statSync(visualCodeAbsPath).size : 0;
  const visualCodeSectorCount = visualCodeExists
    ? (visualCodeLayout.sectorCount || Math.max(1, Math.ceil(visualCodeByteSize / VN_CD_SECTOR_BYTES)))
    : 0;
  const visualCodeDataInitializer = `{ ${cdSectorInitializer(visualCodeLayout)}, ${visualCodeSectorCount}u, ${visualCodeByteSize}u }`;
  const cdAsyncCodeDataPath = normalizeRelativePath(VN_CD_ASYNC_CODE_DATA_FILE);
  const cdAsyncCodeAbsPath = path.join(projectDir, cdAsyncCodeDataPath);
  const cdAsyncCodeExists = fs.existsSync(cdAsyncCodeAbsPath);
  const cdAsyncCodeLayout = cdAsyncCodeExists ? (cdLayout.get(cdAsyncCodeDataPath) || {}) : {};
  const cdAsyncCodeByteSize = cdAsyncCodeExists ? fs.statSync(cdAsyncCodeAbsPath).size : 0;
  const cdAsyncCodeSectorCount = cdAsyncCodeExists
    ? (cdAsyncCodeLayout.sectorCount || Math.max(1, Math.ceil(cdAsyncCodeByteSize / VN_CD_SECTOR_BYTES)))
    : 0;
  const cdAsyncCodeDataInitializer = `{ ${cdSectorInitializer(cdAsyncCodeLayout)}, ${cdAsyncCodeSectorCount}u, ${cdAsyncCodeByteSize}u }`;
  const scenePackMeta = sceneBuilds.map((sceneBuild, index) => {
    if (hucardMode) {
      return `  { &${hucardScenePackRefSymbol(index)}, ${sceneBuild.packBuffer.length}u, ${sceneBuild.nextScene} }${index + 1 < sceneBuilds.length ? ',' : ''}`;
    }
    const layout = cdLayout.get(sceneBuild.packPath) || {};
    const sectorCount = layout.sectorCount || Math.max(1, Math.ceil(sceneBuild.packBuffer.length / VN_CD_SECTOR_BYTES));
    return `  { ${cdSectorInitializer(layout)}, ${sectorCount}u, ${sceneBuild.packBuffer.length}u, ${sceneBuild.nextScene} }${index + 1 < sceneBuilds.length ? ',' : ''}`;
  });
  const systemPsgMeta = systemPsgVariants.map((variant, index) => {
    const layout = cdLayout.get(variant.relativePath) || {};
    const sectorCount = layout.sectorCount || Math.max(1, Math.ceil(variant.bytes.length / VN_CD_SECTOR_BYTES));
    const bus = variant.bus === 'bgm' ? 0 : 1;
    return `  { { ${cdSectorInitializer(layout)}, ${sectorCount}u, ${variant.bytes.length}u }, ${bus}u, ${variant.channel}u }${index + 1 < systemPsgVariants.length ? ',' : ''}`;
  });
  const hucardPsgMeta = hucardPsgEntries.map((entry, index) => (
    `  { ${entry.asset.type === 'psg-song' ? '1u' : '0u'}, ${assetManager.firstPsgPeriod ? assetManager.firstPsgPeriod(entry.asset) : '512'}u, ${entry.options.bpm}u, ${entry.options.steps}u, &${entry.symbol}, ${entry.pattern.length}u }${index + 1 < hucardPsgEntries.length ? ',' : ''}`
  ));
  const visualAssetIds = Array.from(runtimeAssetIds).filter((assetId) => {
    const asset = (assetDoc.assets || []).find((entry) => entry?.id && String(entry.id) === String(assetId));
    return asset && (asset.type === 'image' || asset.type === 'sprite');
  });
  const hucardExtraData = hucardMode
    ? hucardExtraDataFiles(sceneBuilds, hucardPsgEntries, fontSpriteBudget.byteSize > 0)
    : [];
  const systemChoiceCursorGlyph = hucardMode ? 0 : systemCardFont.encodeSystemCardText('>', 'choice cursor', { terminate: false }).words[0];
  const systemMessageWaitGlyph = hucardMode ? 0 : systemCardFont.encodeSystemCardText(MESSAGE_WAIT_GLYPH, 'message wait glyph', { terminate: false }).words[0];

  const headerPath = path.join(generatedDir, 'vn.h');
  const sourcePath = path.join(generatedDir, 'vn.c');
  const header = [
    '#ifndef PCE_EDITOR_GENERATED_VN_H',
    '#define PCE_EDITOR_GENERATED_VN_H',
    '',
    ...(hucardMode ? ['#include "assets.h"', ''] : []),
    ...(!hucardMode ? ['#define PCE_VN_SYSTEM_CARD_PROFILE_JP_V3 1u', ''] : []),
    `#define PCE_VN_COMMAND_BACKGROUND ${VN_COMMAND_BACKGROUND}u`,
    `#define PCE_VN_COMMAND_SPRITE ${VN_COMMAND_SPRITE}u`,
    `#define PCE_VN_COMMAND_MESSAGE ${VN_COMMAND_MESSAGE}u`,
    `#define PCE_VN_COMMAND_AUDIO ${VN_COMMAND_AUDIO}u`,
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
    `#define PCE_VN_COMMAND_CACHE ${VN_COMMAND_CACHE}u`,
    `#define PCE_VN_COMMAND_SPRITE_MOVE ${VN_COMMAND_SPRITE_MOVE}u`,
    `#define PCE_VN_SPRITE_MOVE_ASYNC ${VN_SPRITE_MOVE_ASYNC}u`,
    `#define PCE_VN_CACHE_ACTION_CLEAR ${VN_CACHE_ACTION_CLEAR}u`,
    `#define PCE_VN_CACHE_ACTION_LOAD ${VN_CACHE_ACTION_LOAD}u`,
    `#define PCE_VN_CACHE_SCOPE_VISUAL ${VN_CACHE_SCOPE_VISUAL}u`,
    `#define PCE_VN_CACHE_SCOPE_BG ${VN_CACHE_SCOPE_BG}u`,
    `#define PCE_VN_CACHE_SCOPE_SPRITE ${VN_CACHE_SCOPE_SPRITE}u`,
    `#define PCE_VN_CACHE_SCOPE_ADPCM ${VN_CACHE_SCOPE_ADPCM}u`,
    `#define PCE_VN_CACHE_SCOPE_PSG ${VN_CACHE_SCOPE_PSG}u`,
    `#define PCE_VN_CACHE_SCOPE_ALL ${VN_CACHE_SCOPE_ALL}u`,
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
    `#define PCE_VN_PSG_STOP_ALL ${VN_PSG_STOP_ALL}u`,
    `#define PCE_VN_PSG_STOP_BGM ${VN_PSG_STOP_BGM}u`,
    `#define PCE_VN_PSG_STOP_SFX ${VN_PSG_STOP_SFX}u`,
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
    `#define PCE_VN_HAS_FULL_SCREEN_BG ${hasFullScreenBg ? 1 : 0}u`,
    `#define PCE_VN_HAS_SPRITE_ANIMATIONS ${spriteAnimations.meta.length ? 1 : 0}u`,
    `#define PCE_VN_HAS_SPRITETEXT ${spriteTextGlyphs.length ? 1 : 0}u`,
    `#define PCE_VN_VARIABLE_AUTO_ENABLE_INDEX ${VN_VARIABLE_AUTO_ENABLE_INDEX}u`,
    `#define PCE_VN_VARIABLE_MSG_SPEED_INDEX ${VN_VARIABLE_MSG_SPEED_INDEX}u`,
    `#define PCE_VN_VARIABLE_USER_BASE_INDEX ${VN_RESERVED_VARIABLE_COUNT}u`,
    '#define PCE_VN_AUTO_ENABLE_OFF 0u',
    '#define PCE_VN_AUTO_ENABLE_ON 1u',
    '#define PCE_VN_MSG_SPEED_DEFAULT 0u',
    '#define PCE_VN_MSG_SPEED_MAX 6u',
    `#define PCE_VN_VARIABLE_STORAGE_COUNT ${Math.max(1, variables.initialValues.length)}u`,
    `#define PCE_VN_SCENE_PACK_CACHE_BYTES ${hucardMode ? VN_HUCARD_SCENE_PACK_CACHE_BYTES : VN_SCENE_PACK_CACHE_BYTES}u`,
    `#define PCE_VN_SCENE_PACK_VERSION ${hucardMode ? VN_HUCARD_SCENE_PACK_VERSION : VN_SCENE_PACK_VERSION}u`,
    `#define PCE_VN_SCENE_PACK_HEADER_SIZE ${VN_SCENE_PACK_HEADER_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_COMMAND_SIZE ${VN_SCENE_PACK_COMMAND_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_MESSAGE_SIZE ${VN_SCENE_PACK_MESSAGE_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_CHOICE_SIZE ${VN_SCENE_PACK_CHOICE_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_OPTION_SIZE ${VN_SCENE_PACK_OPTION_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_SWITCH_SIZE ${VN_SCENE_PACK_SWITCH_SIZE}u`,
    `#define PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE ${VN_SCENE_PACK_SWITCH_CASE_SIZE}u`,
    '',
    'typedef struct {',
    '  unsigned int sprite_index;',
    '  unsigned char first_cell;',
    '  unsigned char frame_count;',
    '  unsigned int frame_delay;',
    '  unsigned char frame_width_cells;',
    '  unsigned char frame_height_cells;',
    '  unsigned char frame_stride_cells;',
    '  unsigned char loop;',
    '  const unsigned int *frame_delays;',
    '} pce_vn_sprite_anim_t;',
    '',
    'typedef struct {',
    '  const unsigned char *glyphs;',
    '  unsigned char glyph_count;',
    '  signed int voice_index;',
    '  unsigned char text_speed_frames;',
    '  unsigned char advance_mode;',
    '  unsigned char auto_wait_frames;',
    '  signed int mouth_slot;',
    '  unsigned char instant_glyph_count;',
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
    ...(hucardMode
      ? [
        'typedef struct {',
        '  const pce_editor_data_ref_t *data;',
        '  unsigned int byte_size;',
        '  signed int next_scene;',
        '} pce_vn_scene_pack_t;',
        '',
        'typedef struct {',
        '  unsigned char is_song;',
        '  unsigned int period;',
        '  unsigned int bpm;',
        '  unsigned int steps;',
        '  const pce_editor_data_ref_t *pattern;',
        '  unsigned int pattern_count;',
        '} pce_vn_psg_asset_t;',
        '',
      ]
      : [
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
        '  pce_vn_cd_data_ref_t data;',
        '  unsigned char bus;',
        '  unsigned char channel;',
        '} pce_vn_system_psg_package_t;',
        '',
        'typedef struct {',
        '  pce_vn_cd_sector_t sector;',
        '  unsigned int sector_count;',
        '  unsigned int byte_size;',
        '  signed int next_scene;',
        '} pce_vn_scene_pack_t;',
        '',
      ]),
    `#define PCE_VN_FONT_TILE_BASE ${Number(fontConfig.tileBase || DEFAULT_FONT_TILE_BASE)}u`,
    `#define PCE_VN_CHOICE_CURSOR_GLYPH ${hucardMode ? (glyphIndex.get('>') ?? 0) : systemChoiceCursorGlyph}u`,
    `#define PCE_VN_MESSAGE_WAIT_GLYPH ${hucardMode ? (glyphIndex.get(MESSAGE_WAIT_GLYPH) ?? 0) : systemMessageWaitGlyph}u`,
    '#define PCE_VN_GLYPH_END 0xffffu',
    '#define PCE_VN_GLYPH_NEWLINE 0xfffeu',
    ...(hucardMode ? ['#define PCE_VN_GLYPH_ESCAPE 0xfdu'] : []),
    `#define PCE_VN_FONT_SPRITE_PATTERN_BASE ${fontSpritePatternBase}u`,
    `#define PCE_VN_FONT_SPRITE_GLYPH_CAPACITY ${systemSpriteGlyphCapacity}u`,
    `#define PCE_VN_FONT_SPRITE_PALETTE_BANK ${fontSpritePaletteBank}u`,
    `#define PCE_VN_SPRITE_PATTERN_BASE ${spritePatternBase}u`,
    ...spriteSlotPatternLayout.flatMap((slotLayout) => [
      `#define PCE_VN_SPRITE_SLOT${slotLayout.slot}_PATTERN_BASE ${slotLayout.base}u`,
      `#define PCE_VN_SPRITE_SLOT${slotLayout.slot}_PATTERN_CAPACITY ${slotLayout.capacity}u`,
    ]),
    '',
    ...(hucardMode
      ? [
        'extern const pce_editor_data_ref_t pce_vn_font_data_ref;',
        'extern const unsigned int pce_vn_font_glyph_count;',
        'void pce_vn_font_tiles_map(void);',
        '#if PCE_VN_HAS_SPRITETEXT',
        'extern const pce_editor_data_ref_t pce_vn_font_sprite_data_ref;',
        '#endif',
        'extern const unsigned char pce_vn_font_sprite_glyph_count;',
      ]
      : [
        '#if defined(__PCE_CD__)',
        `#define PCE_VN_OVERLAY_LOAD_ADDR ${VN_OVERLAY_VRAM_LOAD_ADDR}u`,
        'extern const pce_vn_cd_data_ref_t pce_vn_overlay_data;',
        ...(VN_ENABLE_VISUAL_PAYLOAD_CACHE
          ? [
            `#define PCE_VN_VISUAL_CODE_LOAD_ADDR ${VN_VISUAL_CODE_VRAM_LOAD_ADDR}u`,
            'extern const pce_vn_cd_data_ref_t pce_vn_visual_code_data;',
          ]
          : []),
        `#define PCE_VN_CD_ASYNC_CODE_LOAD_ADDR ${VN_CD_ASYNC_CODE_VRAM_LOAD_ADDR}u`,
        'extern const pce_vn_cd_data_ref_t pce_vn_cd_async_code_data;',
        '#endif',
        'void pce_vn_data_map(void);',
      ]),
    'extern const pce_vn_sprite_anim_t pce_vn_sprite_animations[];',
    'extern const unsigned int pce_vn_sprite_animation_count;',
    'extern const signed int pce_vn_variable_initial_values[];',
    'extern const unsigned char pce_vn_variable_count;',
    'extern const pce_vn_scene_pack_t pce_vn_scene_packs[];',
    ...(!hucardMode
      ? [
        'extern const pce_vn_system_psg_package_t pce_vn_system_psg_packages[];',
        'extern const unsigned int pce_vn_system_psg_package_count;',
      ]
      : []),
    ...(hucardMode
      ? [
        'extern const pce_vn_psg_asset_t pce_vn_psg_assets[];',
        'extern const unsigned int pce_vn_psg_asset_count;',
      ]
      : []),
    'extern const unsigned char pce_vn_scene_count;',
    'extern const unsigned char pce_vn_start_scene;',
    '',
    '#endif',
    '',
  ];
  const startScene = sceneIndex.has(doc.startScene) ? sceneIndex.get(doc.startScene) : 0;
  const source = hucardMode ? [
    '#include "vn.h"',
    '',
    `const unsigned int pce_vn_font_glyph_count = ${glyphs.length}u;`,
    '',
    'void pce_vn_font_tiles_map(void)',
    '{',
    '}',
    '',
    `const unsigned char pce_vn_font_sprite_glyph_count = ${fontSpriteBudget.glyphCount}u;`,
    '',
    ...animationDelayTables,
    'const pce_vn_sprite_anim_t pce_vn_sprite_animations[] = {',
    ...(animationMeta.length ? animationMeta : ['  { 0u, 0u, 1u, 8u, 1u, 1u, 1u, 1u, (const unsigned int *)0 }']),
    '};',
    `const unsigned int pce_vn_sprite_animation_count = ${spriteAnimations.meta.length};`,
    '',
    'const signed int pce_vn_variable_initial_values[] = {',
    ...(variables.initialValues.length
      ? variables.initialValues.map((value, index) => `  ${int16Literal(value)}${index + 1 < variables.initialValues.length ? ',' : ''}`)
      : ['  0']),
    '};',
    `const unsigned char pce_vn_variable_count = ${variables.initialValues.length};`,
    '',
    'const pce_vn_scene_pack_t pce_vn_scene_packs[] = {',
    ...(scenePackMeta.length ? scenePackMeta : ['  { (const pce_editor_data_ref_t *)0, 0u, -1 }']),
    '};',
    '',
    'const pce_vn_psg_asset_t pce_vn_psg_assets[] = {',
    ...(hucardPsgMeta.length ? hucardPsgMeta : ['  { 0u, 512u, 150u, 0u, (const pce_editor_data_ref_t *)0, 0u }']),
    '};',
    `const unsigned int pce_vn_psg_asset_count = ${hucardPsgEntries.length}u;`,
    '',
    `const unsigned char pce_vn_scene_count = ${doc.scenes.length};`,
    `const unsigned char pce_vn_start_scene = ${startScene}u;`,
    '',
  ] : [
    '#if defined(__PCE_CD__)',
    '#include <pce-cd.h>',
    'PCE_RAM_BANK_AT(132, 6);',
    '#define PCE_VN_DATA_SECTION __attribute__((section(".ram_bank132")))',
    '#else',
    '#define PCE_VN_DATA_SECTION',
    '#endif',
    '',
    '#include "vn.h"',
    '',
    `const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_overlay_data = ${overlayDataInitializer};`,
    ...(VN_ENABLE_VISUAL_PAYLOAD_CACHE
      ? [`const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_visual_code_data = ${visualCodeDataInitializer};`]
      : []),
    `const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_cd_async_code_data = ${cdAsyncCodeDataInitializer};`,
    '',
    'void pce_vn_data_map(void)',
    '{',
    '#if defined(__PCE_CD__)',
    '  pce_ram_bank132_map();',
    '#endif',
    '}',
    '',
    ...animationDelayTables,
    'const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations[] = {',
    ...(animationMeta.length ? animationMeta : ['  { 0u, 0u, 1u, 8u, 1u, 1u, 1u, 1u, (const unsigned int *)0 }']),
    '};',
    `const unsigned int PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = ${spriteAnimations.meta.length};`,
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
    '',
    'const pce_vn_system_psg_package_t PCE_VN_DATA_SECTION pce_vn_system_psg_packages[] = {',
    ...(systemPsgMeta.length ? systemPsgMeta : ['  { { { 0u, 0u, 0u }, 0u, 0u }, 0u, 0u }']),
    '};',
    `const unsigned int PCE_VN_DATA_SECTION pce_vn_system_psg_package_count = ${systemPsgVariants.length}u;`,
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_scene_count = ${doc.scenes.length};`,
    `const unsigned char PCE_VN_DATA_SECTION pce_vn_start_scene = ${startScene}u;`,
    '',
  ];
  writeFileIfChanged(headerPath, header.join('\n'), 'utf-8');
  writeFileIfChanged(sourcePath, source.join('\n'), 'utf-8');
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
    fontDataPath: hucardMode ? fontDataPath : '',
    fontByteSize: fontBudget.byteSize,
    fontSectorCount: fontSectorCount,
    fontTileBase,
    fontEndTile: fontBudget.endTile,
    droppedGlyphCount: fontBudget.droppedGlyphCount,
    fontSpriteDataPath: hucardMode ? fontSpriteDataPath : '',
    fontSpriteGlyphCount: fontSpriteBudget.glyphCount,
    fontSpriteByteSize: fontSpriteBudget.byteSize,
    fontSpritePatternBase,
    fontSpritePaletteBank,
    fontSpriteRenderer,
    targetMedia: hucardMode ? 'hucard' : 'cd',
    assetIds: Array.from(runtimeAssetIds),
    visualAssetIds,
    psgAssetIds: hucardPsgEntries.map((entry) => String(entry.asset.id || '')),
    extraDataFiles: hucardExtraData,
    hucardPsgAssetCount: hucardPsgEntries.length,
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
  const render = renderGlyphBitmaps(glyphs.slice(0, VN_MAX_GLYPH_COUNT), config, projectDir);
  return {
    config,
    text,
    glyphs: glyphs.slice(0, VN_MAX_GLYPH_COUNT).map((glyph, index) => ({ glyph, bitmap: render.bitmaps[index] })),
    renderer: render.renderer,
    fontPath: render.fontPath,
  };
}

let vnCdCatalogInstance = null;
function getVnCdCatalog() {
  if (!vnCdCatalogInstance) {
    vnCdCatalogInstance = createVnCdCatalog({
      assetManager,
      compiledSceneCommands,
      normalizeAssetId,
      normalizeRelativePath,
      readSceneDocument,
      scenePackRelativePath,
      enableVisualPayloadCache: VN_ENABLE_VISUAL_PAYLOAD_CACHE,
      files: {
        fontData: VN_FONT_DATA_FILE,
        overlayData: VN_OVERLAY_DATA_FILE,
        visualCodeData: VN_VISUAL_CODE_DATA_FILE,
        cdAsyncCodeData: VN_CD_ASYNC_CODE_DATA_FILE,
        fontSpriteData: VN_FONT_SPRITE_DATA_FILE,
      },
    });
  }
  return vnCdCatalogInstance;
}

function collectSceneRuntimeAssetIds(doc = {}) {
  return getVnCdCatalog().collectSceneRuntimeAssetIds(doc);
}

function collectCdDataFiles(projectDir) {
  const files = getVnCdCatalog().collectCdDataFiles(projectDir);
  const psgDir = path.join(projectDir, VN_SYSTEM_CARD_PSG_DIR);
  if (fs.existsSync(psgDir)) {
    for (const entry of fs.readdirSync(psgDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.bin')) {
        files.push(normalizeRelativePath(path.join(VN_SYSTEM_CARD_PSG_DIR, entry.name)));
      }
    }
  }
  return Array.from(new Set(files));
}

function syncVisualNovelRuntime(projectDir, logger) {
  const sourceDir = templateRuntimeDir();
  // Phase A module split: the runtime is the umbrella pce_vn_runtime.c plus the
  // vn_*.c / vn_*.h modules it #includes. Enumerate the template dir (top level
  // only, so generated/ is never picked up) so new modules sync automatically.
  const targets = vnRuntimeSourceFileNames()
    .map((fileName) => [fileName, path.join(projectDir, 'src', fileName)]);
  const changed = targets
    .map(([fileName, targetPath]) => copyIfChanged(path.join(sourceDir, fileName), targetPath))
    .some(Boolean);
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
  const overlayAddr = `0x${VN_OVERLAY_LINK_ADDR.toString(16)}`;
  // .ram_bank132_tail: NOLOAD write-before-read buffers parked in bank132's tail
  // (CPU 0xd078..0xdfff, MPR slot 6). No longer overlaps the overlay (now in
  // bank133); it just keeps these buffers out of the GROWING metadata region.
  const tailVma = `0x${VN_BANK132_TAIL_VMA.toString(16)}`;
  const visualCodeAddr = `0x${VN_VISUAL_CODE_LINK_ADDR.toString(16)}`;
  const cdAsyncCodeAddr = `0x${VN_CD_ASYNC_CODE_LINK_ADDR.toString(16)}`;
  const visualCodeSection = VN_ENABLE_VISUAL_PAYLOAD_CACHE
    ? [
      `  ${VN_VISUAL_CODE_SECTION} ${visualCodeAddr} : {`,
      '    __vn_visual_code_start = .;',
      `    KEEP(*(${VN_VISUAL_CODE_SECTION}.entry ${VN_VISUAL_CODE_SECTION}.entry.*))`,
      `    KEEP(*(${VN_VISUAL_CODE_SECTION}.impl ${VN_VISUAL_CODE_SECTION}.impl.*))`,
      '    __vn_visual_code_end = .;',
      '  } >ram_bank121',
    ]
    : [];
  const body = [
    'SECTIONS {',
    ...visualCodeSection,
    `  ${VN_CD_ASYNC_CODE_SECTION} ${cdAsyncCodeAddr} : {`,
    '    __vn_cd_async_code_start = .;',
    `    KEEP(*(${VN_CD_ASYNC_CODE_SECTION}.entry ${VN_CD_ASYNC_CODE_SECTION}.entry.*))`,
    `    KEEP(*(${VN_CD_ASYNC_CODE_SECTION}.impl ${VN_CD_ASYNC_CODE_SECTION}.impl.*))`,
    '    __vn_cd_async_code_end = .;',
    '  } >ram_bank122',
    `  ${VN_OVERLAY_SECTION} ${overlayAddr} : {`,
    '    __vn_overlay_start = .;',
    `    KEEP(*(${VN_OVERLAY_SECTION}.entry ${VN_OVERLAY_SECTION}.entry.*))`,
    `    KEEP(*(${VN_OVERLAY_SECTION} ${VN_OVERLAY_SECTION}.*))`,
    '    __vn_overlay_end = .;',
    '  } >ram_bank133',
    `  .ram_bank132_tail ${tailVma} (NOLOAD) : {`,
    '    KEEP(*(.ram_bank132_tail .ram_bank132_tail.*))',
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

function ensureVisualCodeReservation(projectDir) {
  const visualCodeBin = path.join(projectDir, VN_VISUAL_CODE_DATA_FILE);
  if (!VN_ENABLE_VISUAL_PAYLOAD_CACHE) {
    try {
      if (fs.existsSync(visualCodeBin)) fs.unlinkSync(visualCodeBin);
    } catch (_) {}
    return null;
  }
  ensureDirSync(path.dirname(visualCodeBin));
  const ok = fs.existsSync(visualCodeBin) && fs.statSync(visualCodeBin).size === VN_VISUAL_CODE_RESERVED_BYTES;
  if (!ok) fs.writeFileSync(visualCodeBin, Buffer.alloc(VN_VISUAL_CODE_RESERVED_BYTES));
  return { byteSize: VN_VISUAL_CODE_RESERVED_BYTES, sectorCount: VN_VISUAL_CODE_RESERVED_SECTORS };
}

function ensureCdAsyncCodeReservation(projectDir) {
  const cdAsyncCodeBin = path.join(projectDir, VN_CD_ASYNC_CODE_DATA_FILE);
  ensureDirSync(path.dirname(cdAsyncCodeBin));
  const ok = fs.existsSync(cdAsyncCodeBin) && fs.statSync(cdAsyncCodeBin).size === VN_CD_ASYNC_CODE_RESERVED_BYTES;
  if (!ok) fs.writeFileSync(cdAsyncCodeBin, Buffer.alloc(VN_CD_ASYNC_CODE_RESERVED_BYTES));
  return { byteSize: VN_CD_ASYNC_CODE_RESERVED_BYTES, sectorCount: VN_CD_ASYNC_CODE_RESERVED_SECTORS };
}

function neutralizeElfLoadSegments(elfPath, startAddress, byteLength) {
  const buf = fs.readFileSync(elfPath);
  if (buf.length < 52
    || buf[0] !== 0x7f
    || buf[1] !== 0x45
    || buf[2] !== 0x4c
    || buf[3] !== 0x46
    || buf[4] !== 1
    || buf[5] !== 1) {
    throw new Error(`Cannot sanitize visual cache ELF load segments in ${path.basename(elfPath)}: expected ELF32 little-endian`);
  }

  const phoff = buf.readUInt32LE(28);
  const phentsize = buf.readUInt16LE(42);
  const phnum = buf.readUInt16LE(44);
  if (phentsize < 32 || phoff + (phentsize * phnum) > buf.length) {
    throw new Error(`Cannot sanitize visual cache ELF load segments in ${path.basename(elfPath)}: invalid program header table`);
  }

  const endAddress = startAddress + byteLength;
  let patched = 0;
  for (let i = 0; i < phnum; i++) {
    const off = phoff + (i * phentsize);
    const type = buf.readUInt32LE(off);
    const vaddr = buf.readUInt32LE(off + 8);
    const paddr = buf.readUInt32LE(off + 12);
    const filesz = buf.readUInt32LE(off + 16);
    const memsz = buf.readUInt32LE(off + 20);
    const segEnd = paddr + Math.max(filesz, memsz);
    if (type === 1 && paddr >= startAddress && segEnd <= endAddress && vaddr >= startAddress && vaddr < endAddress) {
      // llvm-objcopy removes the section header but can leave the PT_LOAD entry.
      // pce-mkcd follows program headers, so make this segment explicitly inert.
      buf.writeUInt32LE(0, off);
      buf.writeUInt32LE(0, off + 16);
      buf.writeUInt32LE(0, off + 20);
      buf.writeUInt32LE(0, off + 24);
      patched++;
    }
  }

  if (patched) fs.writeFileSync(elfPath, buf);
  return patched;
}

// Post-link: objcopy runtime helper blobs out of the freshly linked main.elf:
// .vn_overlay -> overlay.bin (section body stays in the ELF with only its rela
// table stripped), and .vn_visual_code -> visual_code.bin (section body is removed
// from the ELF because pce-mkcd cannot encode that load-address range). objcopy
// can still leave a PT_LOAD program header for the removed section, so the final
// ELF is sanitized after stripping; otherwise the System Card boot loader can see
// the bank121 helper as part of the initial program image. Both outputs are
// padded to their reserved sizes so their CD sectors stay stable.
// The strip is required because pce-mkcd RE-APPLIES the ELF's
// relocations when it assembles the image, and the overlay's internal relocations
// live at the overlay's run-address VMA (CPU 0x8000, MPR slot 4) which is outside
// the encoded bank range mkcd accepts ("File address 0x8001 out of range"). lld
// already applied those relocations in the executable, so the extracted overlay.bin
// is final machine code; dropping .rela.vn_overlay just stops mkcd from re-applying
// them. The .vn_overlay section itself stays (its benign LMA copy loads into
// bank132's unused tail and keeps the dispatcher's direct calls resolvable);
// visual_code.bin is called through a fixed 0x8000 entry, so the ELF can drop the
// bank121 section entirely. Errors if a section is missing or exceeds its
// reservation. Returns {realSize, byteSize, visualCode} or null when there is no
// toolchain / elf.
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
    throw new Error(`overlay code ${realSize} bytes exceeds reserved ${VN_OVERLAY_RESERVED_BYTES} bytes (${VN_OVERLAY_RESERVED_SECTORS} sectors = full physical bank133). Move fewer functions into VN_OVERLAY_CODE, or offload to the bank121 visual-code region instead.`);
  }
  if (realSize < VN_OVERLAY_RESERVED_BYTES) {
    const buf = Buffer.alloc(VN_OVERLAY_RESERVED_BYTES);
    fs.readFileSync(overlayBin).copy(buf);
    fs.writeFileSync(overlayBin, buf);
  }
  let visualRealSize = 0;
  let visualCodeInfo = null;
  if (VN_ENABLE_VISUAL_PAYLOAD_CACHE) {
    const visualCodeBin = path.join(projectDir, VN_VISUAL_CODE_DATA_FILE);
    ensureDirSync(path.dirname(visualCodeBin));
    run(['-O', 'binary', `--only-section=${VN_VISUAL_CODE_SECTION}`, elfPath, visualCodeBin], 'visual code objcopy extract');
    visualRealSize = fs.existsSync(visualCodeBin) ? fs.statSync(visualCodeBin).size : 0;
    if (visualRealSize === 0) {
      throw new Error(`visual cache code section ${VN_VISUAL_CODE_SECTION} was empty in ${path.basename(elfPath)} — visual cache code not linked`);
    }
    if (visualRealSize > VN_VISUAL_CODE_RESERVED_BYTES) {
      throw new Error(`visual cache code ${visualRealSize} bytes exceeds reserved ${VN_VISUAL_CODE_RESERVED_BYTES} bytes (${VN_VISUAL_CODE_RESERVED_SECTORS} sectors). Move fewer functions into VN_VISUAL_CACHE_CODE or raise VN_VISUAL_CODE_RESERVED_SECTORS.`);
    }
    if (visualRealSize < VN_VISUAL_CODE_RESERVED_BYTES) {
      const buf = Buffer.alloc(VN_VISUAL_CODE_RESERVED_BYTES);
      fs.readFileSync(visualCodeBin).copy(buf);
      fs.writeFileSync(visualCodeBin, buf);
    }
    visualCodeInfo = { realSize: visualRealSize, byteSize: VN_VISUAL_CODE_RESERVED_BYTES };
  }
  const cdAsyncCodeBin = path.join(projectDir, VN_CD_ASYNC_CODE_DATA_FILE);
  ensureDirSync(path.dirname(cdAsyncCodeBin));
  run(['-O', 'binary', `--only-section=${VN_CD_ASYNC_CODE_SECTION}`, elfPath, cdAsyncCodeBin], 'CD async code objcopy extract');
  const cdAsyncCodeRealSize = fs.existsSync(cdAsyncCodeBin) ? fs.statSync(cdAsyncCodeBin).size : 0;
  if (cdAsyncCodeRealSize === 0) {
    throw new Error(`CD async code section ${VN_CD_ASYNC_CODE_SECTION} was empty in ${path.basename(elfPath)} — direct SCSI helper code not linked`);
  }
  if (cdAsyncCodeRealSize > VN_CD_ASYNC_CODE_RESERVED_BYTES) {
    throw new Error(`CD async code ${cdAsyncCodeRealSize} bytes exceeds reserved ${VN_CD_ASYNC_CODE_RESERVED_BYTES} bytes (${VN_CD_ASYNC_CODE_RESERVED_SECTORS} sectors). Move fewer functions into VN_CD_ASYNC_CODE or raise VN_CD_ASYNC_CODE_RESERVED_SECTORS.`);
  }
  if (cdAsyncCodeRealSize < VN_CD_ASYNC_CODE_RESERVED_BYTES) {
    const buf = Buffer.alloc(VN_CD_ASYNC_CODE_RESERVED_BYTES);
    fs.readFileSync(cdAsyncCodeBin).copy(buf);
    fs.writeFileSync(cdAsyncCodeBin, buf);
  }
  const cdAsyncCodeInfo = { realSize: cdAsyncCodeRealSize, byteSize: VN_CD_ASYNC_CODE_RESERVED_BYTES };
  // Strip BOTH runtime code blobs out of the program image: they are loaded from
  // CD into bank133 (.vn_overlay) and bank121 (.vn_visual_code) at boot, not part
  // of the main program. Remove each section AND its relocation table — mkcd
  // RE-APPLIES the ELF's relocations, and the overlay's internal relocs live at
  // the 0x8000 run-address VMA which is outside the bank range mkcd accepts
  // ("File address 0x8001 out of range"); lld already applied them in the
  // extracted .bin, so it is final machine code. Resident code reaches both blobs
  // through fixed-address indirect calls (vn_overlay_entry / visual_cache_entry),
  // so no resident->blob relocation dangles after removal. Write the stripped
  // result to a temp file and atomically rename it over main.elf rather than
  // letting llvm-objcopy rewrite the ELF in place: on Windows an in-place rewrite can
  // race with antivirus/file-indexing scanning the freshly written executable and
  // leave a transient ZERO-LENGTH main.elf. pce-mkcd mmaps the ELF without checking
  // the result and SEGFAULTS (exit 0xC0000005 / 3221225781) on an empty input, which
  // surfaced as "pce-mkcd failed (exit code: 3221225781)" with the probe also failing.
  // Verifying the temp is non-empty before the rename guarantees mkcd never observes a
  // half-written ELF. (macOS never hit this because there is no such scanner race.)
  const strippedElf = `${elfPath}.stripped`;
  const stripArgs = ['--remove-section', `.rela${VN_OVERLAY_SECTION}`, '--remove-section', VN_OVERLAY_SECTION];
  if (VN_ENABLE_VISUAL_PAYLOAD_CACHE) {
    stripArgs.push('--remove-section', `.rela${VN_VISUAL_CODE_SECTION}`);
    stripArgs.push('--remove-section', VN_VISUAL_CODE_SECTION);
  }
  stripArgs.push('--remove-section', `.rela${VN_CD_ASYNC_CODE_SECTION}`);
  stripArgs.push('--remove-section', VN_CD_ASYNC_CODE_SECTION);
  stripArgs.push(elfPath, strippedElf);
  run(stripArgs, 'objcopy strip runtime blobs');
  const strippedSize = fs.existsSync(strippedElf) ? fs.statSync(strippedElf).size : 0;
  if (strippedSize === 0) {
    try { if (fs.existsSync(strippedElf)) fs.unlinkSync(strippedElf); } catch (_) {}
    throw new Error(`overlay strip produced an empty ELF (${path.basename(strippedElf)}) — aborting before pce-mkcd to avoid a crash on an unreadable ELF`);
  }
  fs.renameSync(strippedElf, elfPath);
  // The overlay (like the visual-code blob) is now its own ram_bank133 load
  // region; objcopy --remove-section drops the section header but can leave the
  // PT_LOAD program header, which mkcd follows. PT_NULL it so the System Card boot
  // loader does not treat bank133 as part of the initial program image.
  const overlayLoadSegmentsRemoved = neutralizeElfLoadSegments(elfPath, VN_OVERLAY_LINK_ADDR, VN_OVERLAY_RESERVED_BYTES);
  let visualLoadSegmentsRemoved = 0;
  if (VN_ENABLE_VISUAL_PAYLOAD_CACHE) {
    visualLoadSegmentsRemoved = neutralizeElfLoadSegments(elfPath, VN_VISUAL_CODE_LINK_ADDR, VN_VISUAL_CODE_RESERVED_BYTES);
  }
  const cdAsyncLoadSegmentsRemoved = neutralizeElfLoadSegments(elfPath, VN_CD_ASYNC_CODE_LINK_ADDR, VN_CD_ASYNC_CODE_RESERVED_BYTES);
  logger?.info?.(`PCE VN overlay blob: ${realSize} bytes (reserved ${VN_OVERLAY_RESERVED_BYTES}, full bank133) を main.elf から ${VN_OVERLAY_DATA_FILE} に抽出 (${VN_OVERLAY_SECTION} 除去)`);
  if (overlayLoadSegmentsRemoved) logger?.info?.(`PCE VN overlay PT_LOAD ${overlayLoadSegmentsRemoved} 件を main.elf から無効化`);
  if (VN_ENABLE_VISUAL_PAYLOAD_CACHE) logger?.info?.(`PCE VN visual cache code blob: ${visualRealSize} bytes (reserved ${VN_VISUAL_CODE_RESERVED_BYTES}) を main.elf から ${VN_VISUAL_CODE_DATA_FILE} に抽出 (${VN_VISUAL_CODE_SECTION} 除去)`);
  if (visualLoadSegmentsRemoved) logger?.info?.(`PCE VN visual cache code PT_LOAD ${visualLoadSegmentsRemoved} 件を main.elf から無効化`);
  logger?.info?.(`PCE VN CD async code blob: ${cdAsyncCodeRealSize} bytes (reserved ${VN_CD_ASYNC_CODE_RESERVED_BYTES}) を main.elf から ${VN_CD_ASYNC_CODE_DATA_FILE} に抽出 (${VN_CD_ASYNC_CODE_SECTION} 除去)`);
  if (cdAsyncLoadSegmentsRemoved) logger?.info?.(`PCE VN CD async code PT_LOAD ${cdAsyncLoadSegmentsRemoved} 件を main.elf から無効化`);
  return {
    realSize,
    byteSize: VN_OVERLAY_RESERVED_BYTES,
    visualCode: visualCodeInfo,
    cdAsyncCode: cdAsyncCodeInfo,
  };
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
  addManagedGeneratedPath(managed, VN_VISUAL_CODE_DATA_FILE);
  addManagedGeneratedPath(managed, VN_CD_ASYNC_CODE_DATA_FILE);
  addManagedGeneratedPath(managed, VN_FONT_SPRITE_DATA_FILE);
  addManagedGeneratedPath(managed, VN_SYSTEM_CARD_PSG_DIR);
  const scenePackDir = normalizeRelativePath(VN_SCENE_PACK_DIR);
  try {
    const assetDoc = assetManager.readAssetDocument(projectDir);
    (assetDoc.assets || []).forEach((asset) => {
      const generated = asset.data?.generated || {};
      if (asset.type === 'image') {
        addManagedGeneratedPath(managed, generated.tilesFile);
        addManagedGeneratedPath(managed, generated.mapVramFile);
      } else if (asset.type === 'sprite') {
        addManagedGeneratedPath(managed, generated.tilesFile);
      } else if (asset.type === 'adpcm') {
        addManagedGeneratedPath(managed, generated.outputFile);
      }
    });
  } catch (_) {}
  (readSceneDocument(projectDir).scenes || []).forEach((scene, sceneIndex) => {
    addManagedGeneratedPath(managed, scenePackRelativePath(scene, sceneIndex));
  });
  managed.add(scenePackDir);
  managed.add(normalizeRelativePath(VN_SYSTEM_CARD_PSG_DIR));
  return managed;
}

function mergeCdDataFiles(projectDir, generatedDataFiles = [], configuredDataFiles = []) {
  const managed = collectManagedGeneratedCdDataFiles(projectDir);
  return mergeCurrentCdDataFiles({
    generatedDataFiles,
    configuredDataFiles,
    managedPaths: managed,
    scenePackDir: VN_SCENE_PACK_DIR,
  });
}

function prepareVisualNovelBuild(projectDir, config = {}, clangPath = null, logger = null, options = {}) {
  let stage = Date.now();
  syncVisualNovelRuntime(projectDir);
  logBuildTiming(logger, 'runtime sync', stage);
  stage = Date.now();
  ensureSceneFile(projectDir);
  // Reserve the consolidated asset-metadata file at its final size before the CD
  // layout is computed so its sector (and every file after it) stays stable, the
  // same reserve/overwrite contract used for the overlay blob below.
  {
    const assetDoc = assetManager.readAssetDocument(projectDir);
    if (typeof assetManager.ensurePsgImportedAssets === 'function') {
      assetManager.ensurePsgImportedAssets(projectDir, assetDoc);
    }
    const sceneDoc = readSceneDocument(projectDir);
    const runtimeAssetIds = collectSceneRuntimeAssetIds(sceneDoc);
    const runtimeAssetDoc = {
      ...assetDoc,
      assets: (assetDoc.assets || []).filter((asset) => asset?.id && runtimeAssetIds.has(String(asset.id))),
    };
    if (typeof assetManager.ensurePsgPatternFiles === 'function') {
      assetManager.ensurePsgPatternFiles(projectDir, runtimeAssetDoc);
    }
    assetManager.ensureAssetMetaReservation(projectDir, runtimeAssetDoc);
  }
  // Reserve the overlay blob's CD footprint and write the linker fragment BEFORE
  // generating sources / computing the CD layout. The actual overlay bytes are
  // extracted from main.elf after the link by finalizeOverlayBlob(); reserving a
  // fixed size up front keeps the CD sector stable across that two-step flow.
  // (clangPath is unused here now — extraction needs the linked main.elf and runs
  // in the build system post-link.)
  ensureOverlayReservation(projectDir);
  ensureVisualCodeReservation(projectDir);
  ensureCdAsyncCodeReservation(projectDir);
  writeOverlayFragment(projectDir);
  logBuildTiming(logger, 'reserve CD layout placeholders', stage);
  if (options.incremental) {
    stage = Date.now();
    const cached = readVnBuildStamp(projectDir);
    if (cached?.generated && Array.isArray(cached.mergedDataFiles) && vnGeneratedOutputsReady(projectDir, cached.generated)) {
      const signature = vnBuildSignature(projectDir, config, cached.mergedDataFiles, cached.mergedCddaTracks || []);
      if (signature === cached.signature) {
        logBuildTiming(logger, 'incremental cache check', stage, 'up-to-date');
        logger?.info?.(`VN generation skipped: inputs unchanged (${cached.generated.sceneCount || 0} scene(s), ${cached.generated.messageCount || 0} message(s), ${cached.generated.glyphCount || 0} glyph(s))`);
        const cd = config.cd && typeof config.cd === 'object' ? config.cd : {};
        return {
          ok: true,
          generated: {
            ...cached.generated,
            incrementalSkipped: true,
          },
          stampInfo: {
            dataFiles: cached.mergedDataFiles,
            cddaTracks: cached.mergedCddaTracks || [],
          },
          configPatch: {
            toolchain: 'llvm-mos',
            targetMedia: 'cd',
            cd: {
              ...cd,
              systemCardProfile: 'jp-v3',
              dataFiles: cached.mergedDataFiles,
              cddaTracks: cached.mergedCddaTracks || [],
            },
            pluginSettings: {
              ...(config.pluginSettings || {}),
              [PCE_VISUAL_NOVEL_BUILDER_ID]: {
                ...(config.pluginSettings?.[PCE_VISUAL_NOVEL_BUILDER_ID] || {}),
                template: 'visual-novel-cd',
              },
            },
          },
        };
      }
    }
    logBuildTiming(logger, 'incremental cache check', stage, 'changed');
  }
  stage = Date.now();
  generateVnSources(projectDir);
  logBuildTiming(logger, 'generate pass 1', stage);
  stage = Date.now();
  const dataFiles = collectCdDataFiles(projectDir);
  const cddaTracks = collectCddaTracks(projectDir);
  const cd = config.cd && typeof config.cd === 'object' ? config.cd : {};
  const mergedDataFiles = mergeCdDataFiles(projectDir, dataFiles, cd.dataFiles);
  const mergedCddaTracks = Array.from(new Set([...(Array.isArray(cd.cddaTracks) ? cd.cddaTracks : []), ...cddaTracks]));
  logBuildTiming(logger, 'merge CD data files', stage, `${mergedDataFiles.length} data file(s), ${mergedCddaTracks.length} configured CD-DA track(s)`);
  stage = Date.now();
  const generated = generateVnSources(projectDir, { cdDataFiles: mergedDataFiles });
  logBuildTiming(logger, 'generate pass 2', stage);
  updateVisualNovelBuildStamp(projectDir, config, generated, mergedDataFiles, mergedCddaTracks);
  return {
    ok: true,
    generated,
    stampInfo: {
      dataFiles: mergedDataFiles,
      cddaTracks: mergedCddaTracks,
    },
    configPatch: {
      toolchain: 'llvm-mos',
      targetMedia: 'cd',
      cd: {
        ...cd,
        systemCardProfile: 'jp-v3',
        dataFiles: mergedDataFiles,
        cddaTracks: mergedCddaTracks,
      },
      pluginSettings: {
        ...(config.pluginSettings || {}),
        [PCE_VISUAL_NOVEL_BUILDER_ID]: {
          ...(config.pluginSettings?.[PCE_VISUAL_NOVEL_BUILDER_ID] || {}),
          template: 'visual-novel-cd',
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
  VN_FONT_DIR,
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
  VN_COMMAND_CACHE,
  VN_COMMAND_SPRITE_MOVE,
  VN_SPRITE_MOVE_ASYNC,
  VN_CACHE_ACTION_CLEAR,
  VN_CACHE_ACTION_LOAD,
  VN_CACHE_SCOPE_VISUAL,
  VN_CACHE_SCOPE_BG,
  VN_CACHE_SCOPE_SPRITE,
  VN_CACHE_SCOPE_ADPCM,
  VN_CACHE_SCOPE_PSG,
  VN_CACHE_SCOPE_ALL,
  VN_BG_TRANSITION_CUT,
  VN_BG_TRANSITION_FADE,
  VN_BG_FADE_FRAME_OPTIONS,
  VN_BG_DEFAULT_FADE_FRAMES,
  VN_BG_DEFAULT_TILE_X,
  VN_BG_DEFAULT_TILE_Y,
  VN_MESSAGE_SPEED_FRAME_OPTIONS,
  VN_DEFAULT_MESSAGE_SPEED_FRAMES,
  VN_DEFAULT_MESSAGE_AUTO_WAIT_FRAMES,
  VN_SPRITE_VISIBLE,
  VN_ADVANCE_BUTTON,
  VN_ADVANCE_AUTO,
  VN_AUDIO_KIND_PSG,
  VN_PSG_STOP_ALL,
  VN_PSG_STOP_BGM,
  VN_PSG_STOP_SFX,
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
  normalizeVnSystemSettings,
  collectCdDataFiles,
  collectGlyphs,
  collectGlyphsRaw,
  collectFullScreenBgAssetIds,
  collectSceneVisualAssetUsage,
  collectSceneRuntimeAssetIds,
  collectSpriteTextGlyphsRaw,
  isCommandSkipped,
  computeFontBudget,
  computeVnHardwareSpriteLayout,
  computeVnSpritePatternBase,
  computeVnSpritePatternBanks,
  computeVnVramLayout: computeVnVramLayoutPacked,
  validateVnVramLayout,
  validateVnSpritePaletteLayout,
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
  fontCandidates,
  resolveFontPath,
  importFontFile,
  deleteFontFile,
  prepareVisualNovelBuild,
  previewFontText,
  readFontConfig,
  readSceneDocument,
  renderGlyphBitmaps,
  renderGlyphMaskData,
  finalizeOverlayBlob,
  neutralizeElfLoadSegments,
  overlayLinkerArgs,
  overlayFragmentPath,
  syncVisualNovelRuntime,
  readVnBuildStamp,
  updateVisualNovelBuildStamp,
  vnBuildSignature,
  vnGeneratedOutputsReady,
  writeFontConfig,
  writeSceneDocument,
};
