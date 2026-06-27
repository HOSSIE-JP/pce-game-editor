'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const audioConverter = require('./pce-audio-converter');
const vgmImporter = require('./pce-vgm-import');
const midiImporter = require('./pce-midi-import');
const { normalizeRelativePath, resolveUnderRoot } = require('./pce-file-safety');

const ASSET_FILE = path.join('assets', 'pce-assets.json');
const PCE_INTERNAL_IMAGE_CONVERTER = 'Internal PCE image converter';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SUPPORTED_TYPES = new Set(['image', 'sprite', 'psg-sequence', 'psg-song', 'psg-sfx', 'adpcm', 'cdda-track', 'tileset', 'tilemap', 'palette']);
const IMAGE_EXTENSIONS = new Set(['.png', '.bmp', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3']);
const VGM_EXTENSIONS = new Set(['.vgm', '.vgz']);
const MIDI_EXTENSIONS = new Set(['.mid', '.midi']);
const SPRITE_CELL_SIZES = new Set(['16x16', '16x32', '16x64', '32x16', '32x32', '32x64']);
const ROM_BANKED_CHUNK_SIZE = 8192;
const BANKED_DATA_THRESHOLD = 1024;
const CD_DATA_BASE_SECTOR = 64;
const CD_SECTOR_BYTES = 2048;
const CD_AUDIO_MIN_SECTOR = 450;
const CDDA_SECTORS_PER_SECOND = 75;
const CDDA_PLAYBACK_GUARD_FRAMES = 2;
const CD_MSF_LEAD_IN_SECTORS = 150;
const PCE_CATALOG_MAX_ASSETS_PER_TYPE = 512;
const PCE_CDDA_MAX_AUDIO_TRACKS = 98; // CD-DA track numbers 2..99.
const PCE_BG_MAP_WIDTH_TILES = 32;
const PCE_BG_MAP_HEIGHT_TILES = 32;
const PCE_BG_AUTO_MAP_BASE = 0;
const PCE_BG_AUTO_TILE_BASE = Math.ceil((PCE_BG_MAP_WIDTH_TILES * PCE_BG_MAP_HEIGHT_TILES) / 16);
const PCE_SATB_VRAM_WORD = 0x7f00;
const PCE_VISUAL_COMPRESSION_NONE = 'none';
const PCE_VISUAL_COMPRESSION_AUTO = 'auto';
const PCE_VISUAL_COMPRESSION_RLE = 'rle';
const PCE_EDITOR_CD_COMPRESSION_NONE = 0;
const PCE_EDITOR_CD_COMPRESSION_RLE = 1;
const PCE_ADPCM_CODEC = audioConverter.PCE_ADPCM_CODEC || 'oki-msm5205';
const PCE_ADPCM_ENCODER_VERSION = audioConverter.PCE_ADPCM_ENCODER_VERSION || 2;
const PCE_ADPCM_NIBBLE_ORDER = audioConverter.PCE_ADPCM_NIBBLE_ORDER || 'msn-first';
const PCE_ADPCM_MIN_SAMPLE_RATE = audioConverter.PCE_ADPCM_MIN_SAMPLE_RATE || 4000;
const PCE_ADPCM_MAX_SAMPLE_RATE = audioConverter.PCE_ADPCM_MAX_SAMPLE_RATE || 32000;
const DEFAULT_BG_OPTIONS = Object.freeze({
  kind: 'background',
  paletteBank: 0,
  tileBase: PCE_BG_AUTO_TILE_BASE,
  mapBase: PCE_BG_AUTO_MAP_BASE,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  cellWidth: 8,
  cellHeight: 8,
  transparentIndex: 0,
});
const DEFAULT_SPRITE_OPTIONS = Object.freeze({
  kind: 'sprite',
  paletteBank: 0,
  // Sprite pattern base (in 32-word units). 704 -> VRAM word 22528, which sits
  // above the VN message/font tiles and below the SATB at 0x7f00; this is the
  // shared region the VN runtime swaps character sprites through.
  tileBase: 704,
  mapBase: 0,
  x: 144,
  y: 104,
  width: 0,
  height: 0,
  cellWidth: 16,
  cellHeight: 16,
  transparentIndex: 0,
  animations: [],
});
const DEFAULT_SPRITE_ANIMATION = Object.freeze({
  id: 'default',
  name: 'Default',
  frameWidth: 0,
  frameHeight: 0,
  firstCell: 0,
  frameCount: 1,
  frameDelay: 8,
  frameStrideCells: 0,
  loop: true,
});
const DEFAULT_PALETTE_OPTIONS = Object.freeze({
  target: 'bg',
  paletteBank: 0,
  colors: [],
});
const DEFAULT_PSG_OPTIONS = Object.freeze({
  kind: 'sfx',
  bpm: 150,
  speed: 6,
  period: 512,
  channels: 6,
  steps: 32,
  volume: 100,
  pattern: [],
});
const PCE_PSG_MAX_STEPS = 4096;
const PCE_PSG_MAX_PATTERN_ENTRIES = 2048;
const PCE_PSG_SERIALIZED_STEP_BYTES = 8;
const DEFAULT_ADPCM_OPTIONS = Object.freeze({
  sampleRate: 16000,
  loop: false,
  stream: false,
  adpcmAddress: 0,
  divider: 0,
});
const DEFAULT_CDDA_OPTIONS = Object.freeze({
  track: 2,
  loop: false,
});

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isLikelyAbsolutePath(value = '') {
  const raw = String(value || '');
  return path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw);
}

function getAssetFilePath(projectDir) {
  return path.join(path.resolve(projectDir), ASSET_FILE);
}

function defaultAssets() {
  return {
    version: 2,
    assets: [],
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function clampPositiveInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function sanitizeAssetId(value, fallback = 'asset') {
  const base = String(value || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || fallback;
}

function normalizeAssetSource(source = '') {
  const raw = String(source || '').trim();
  if (!raw) return '';
  if (isLikelyAbsolutePath(raw)) {
    throw new Error(`project relative asset path is required: ${raw}`);
  }
  const cleaned = normalizeRelativePath(raw);
  if (cleaned.split('/').includes('..')) {
    throw new Error(`project relative asset path is required: ${raw}`);
  }
  return cleaned;
}

// Parse the sprite editor's per-frame time matrix string ("[[8,8,8][4,4,4]]")
// into rows of integers. Lets projects saved before per-animation frameDelays
// existed still pick up their per-frame times on rebuild (one row per animation).
function parseSpriteTimeMatrixRows(value) {
  if (typeof value !== 'string') return [];
  return Array.from(value.matchAll(/\[([^[\]]*)\]/g)).map((match) => match[1]
    .split(',')
    .map((cell) => parseInt(cell, 10))
    .map((num) => (Number.isFinite(num) ? num : 0)));
}

function normalizeSpriteAnimations(options = {}, asset = {}) {
  const spriteTimeRows = parseSpriteTimeMatrixRows(options.spriteEditor?.time);
  const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
  const cellWidth = clampPositiveInt(options.cellWidth ?? generated.cellWidth, 16, 32, DEFAULT_SPRITE_OPTIONS.cellWidth);
  const cellHeight = clampPositiveInt(options.cellHeight ?? generated.cellHeight, 16, 64, DEFAULT_SPRITE_OPTIONS.cellHeight);
  const generatedColumns = clampPositiveInt(generated.cellColumns ?? generated.columns, 1, 64, 0);
  const generatedRows = clampPositiveInt(generated.cellRows ?? generated.rows, 1, 64, 0);
  const generatedWidth = clampPositiveInt(generated.width, cellWidth, 1024, generatedColumns ? generatedColumns * cellWidth : 0);
  const generatedHeight = clampPositiveInt(generated.height, cellHeight, 1024, generatedRows ? generatedRows * cellHeight : 0);
  const width = clampPositiveInt(options.width, cellWidth, 1024, generatedWidth || cellWidth);
  const height = clampPositiveInt(options.height, cellHeight, 1024, generatedHeight || cellHeight);
  const sheetColumns = Math.max(1, Math.ceil(width / cellWidth));
  const sheetRows = Math.max(1, Math.ceil(height / cellHeight));
  const totalCells = Math.max(1, sheetColumns * sheetRows);
  const rawAnimations = Array.isArray(options.animations) ? options.animations : [];

  const normalizeOne = (entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry : {};
    const fallbackFrameWidth = index === 0 ? width : cellWidth;
    const fallbackFrameHeight = index === 0 ? height : cellHeight;
    const frameWidth = clampPositiveInt(raw.frameWidth, cellWidth, 256, fallbackFrameWidth);
    const frameHeight = clampPositiveInt(raw.frameHeight, cellHeight, 256, fallbackFrameHeight);
    const frameCellsX = Math.max(1, Math.ceil(frameWidth / cellWidth));
    const frameCellsY = Math.max(1, Math.ceil(frameHeight / cellHeight));
    const frameCells = Math.max(1, frameCellsX * frameCellsY);
    const firstCell = clampInt(raw.firstCell, 0, totalCells - 1, 0);
    const maxFrames = Math.max(1, Math.floor((totalCells - firstCell + frameCells - 1) / frameCells));
    const frameCount = clampPositiveInt(raw.frameCount, 1, 64, Math.min(1, maxFrames));
    const frameStrideCells = clampPositiveInt(raw.frameStrideCells, 1, totalCells, frameCells);
    const resolvedFrameCount = Math.min(frameCount, Math.max(1, Math.floor((totalCells - firstCell + frameStrideCells - 1) / frameStrideCells)));
    const frameDelay = clampInt(raw.frameDelay, 1, 60, DEFAULT_SPRITE_ANIMATION.frameDelay);
    // Preserve the per-frame display times so each frame keeps its own duration
    // through normalization. Prefer explicit per-animation frameDelays; otherwise
    // migrate from the sprite editor's per-row time matrix. Missing/invalid
    // entries fall back to frameDelay.
    const rawFrameDelays = Array.isArray(raw.frameDelays) && raw.frameDelays.length
      ? raw.frameDelays
      : (spriteTimeRows[index] || []);
    const frameDelays = Array.from({ length: resolvedFrameCount }, (_, frameIndex) => clampInt(rawFrameDelays[frameIndex], 1, 60, frameDelay));
    return {
      id: sanitizeAssetId(raw.id, index === 0 ? 'default' : `anim_${index + 1}`).slice(0, 32),
      name: String(raw.name || raw.id || (index === 0 ? 'Default' : `Animation ${index + 1}`)).trim().slice(0, 48),
      frameWidth: frameCellsX * cellWidth,
      frameHeight: frameCellsY * cellHeight,
      firstCell,
      frameCount: resolvedFrameCount,
      frameDelay,
      frameDelays,
      frameStrideCells,
      loop: raw.loop !== false,
    };
  };

  const normalized = (rawAnimations.length ? rawAnimations : [DEFAULT_SPRITE_ANIMATION])
    .map(normalizeOne)
    .filter((entry) => entry.id)
    .slice(0, 16);
  const seen = new Set();
  return normalized.map((entry, index) => {
    let id = entry.id;
    if (seen.has(id)) id = `${id}_${index + 1}`.slice(0, 32);
    seen.add(id);
    return { ...entry, id };
  });
}

function autoBackgroundVramOptions() {
  return {
    tileBase: PCE_BG_AUTO_TILE_BASE,
    mapBase: PCE_BG_AUTO_MAP_BASE,
  };
}

function normalizeVisualCompression(value, fallback = PCE_VISUAL_COMPRESSION_AUTO) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['none', 'raw', 'off', 'false', '0'].includes(raw)) return PCE_VISUAL_COMPRESSION_NONE;
  if (['rle', 'pce-rle', 'pce_rle'].includes(raw)) return PCE_VISUAL_COMPRESSION_RLE;
  if (['auto', 'best', 'fast', 'aplib', 'lz4w', 'true', '1'].includes(raw)) return PCE_VISUAL_COMPRESSION_AUTO;
  return fallback;
}

function normalizeImageOptions(asset = {}) {
  const rawOptions = asset.options && typeof asset.options === 'object' ? { ...asset.options } : {};
  const isSprite = asset.type === 'sprite' || rawOptions.kind === 'sprite';
  const defaults = isSprite ? DEFAULT_SPRITE_OPTIONS : DEFAULT_BG_OPTIONS;
  const options = { ...defaults, ...rawOptions };
  options.kind = isSprite ? 'sprite' : 'background';
  // RLE removed: assets are always uncompressed. Drop any legacy compression option
  // carried in older asset docs so it no longer appears in the normalized schema.
  delete options.compression;
  options.paletteBank = clampInt(options.paletteBank, 0, 15, defaults.paletteBank);
  options.tileBase = clampInt(options.tileBase, 0, 2047, defaults.tileBase);
  options.mapBase = clampInt(options.mapBase, 0, 2047, defaults.mapBase);
  options.x = clampInt(options.x, 0, 255, defaults.x);
  options.y = clampInt(options.y, 0, 255, defaults.y);
  options.width = clampInt(options.width, 0, 1024, defaults.width);
  options.height = clampInt(options.height, 0, 1024, defaults.height);
  options.transparentIndex = clampInt(options.transparentIndex, 0, 15, defaults.transparentIndex);
  if (isSprite) {
    let cellWidth = clampInt(options.cellWidth, 16, 32, defaults.cellWidth);
    let cellHeight = clampInt(options.cellHeight, 16, 64, defaults.cellHeight);
    const key = `${cellWidth}x${cellHeight}`;
    if (!SPRITE_CELL_SIZES.has(key)) {
      cellWidth = defaults.cellWidth;
      cellHeight = defaults.cellHeight;
    }
    options.cellWidth = cellWidth;
    options.cellHeight = cellHeight;
    options.animations = normalizeSpriteAnimations(options, asset);
  } else {
    const autoVram = autoBackgroundVramOptions(options.width, options.height);
    options.tileBase = autoVram.tileBase;
    options.mapBase = autoVram.mapBase;
    options.cellWidth = 8;
    options.cellHeight = 8;
    delete options.animations;
  }
  return options;
}

function normalizeGeneratedCompressionSlot(slot = {}) {
  if (!slot || typeof slot !== 'object') {
    return {
      codec: PCE_VISUAL_COMPRESSION_NONE,
      file: '',
      rawBytes: 0,
      byteLength: 0,
      savedBytes: 0,
    };
  }
  const codec = normalizeVisualCompression(slot.codec || slot.method || slot.compression, PCE_VISUAL_COMPRESSION_NONE) === PCE_VISUAL_COMPRESSION_RLE
    ? PCE_VISUAL_COMPRESSION_RLE
    : PCE_VISUAL_COMPRESSION_NONE;
  const rawBytes = clampInt(slot.rawBytes ?? slot.uncompressedBytes, 0, 0x7fffffff, 0);
  const byteLength = clampInt(slot.byteLength ?? slot.compressedBytes, 0, 0x7fffffff, 0);
  return {
    codec,
    file: normalizeAssetSource(slot.file || slot.path || ''),
    rawBytes,
    byteLength,
    savedBytes: clampInt(slot.savedBytes, 0, 0x7fffffff, Math.max(0, rawBytes - byteLength)),
  };
}

function normalizeGeneratedCompression(compression = {}) {
  if (!compression || typeof compression !== 'object') {
    return {
      policy: PCE_VISUAL_COMPRESSION_AUTO,
      tiles: normalizeGeneratedCompressionSlot(),
      map: normalizeGeneratedCompressionSlot(),
    };
  }
  return {
    policy: normalizeVisualCompression(compression.policy ?? compression.requested, PCE_VISUAL_COMPRESSION_AUTO),
    tiles: normalizeGeneratedCompressionSlot(compression.tiles),
    map: normalizeGeneratedCompressionSlot(compression.map),
  };
}

function normalizeGeneratedData(data = {}) {
  if (!data || typeof data !== 'object') return {};
  const generated = data.generated && typeof data.generated === 'object'
    ? {
        ...data.generated,
        paletteFile: normalizeAssetSource(data.generated.paletteFile || ''),
        tilesFile: normalizeAssetSource(data.generated.tilesFile || ''),
        tilesCompressedFile: normalizeAssetSource(data.generated.tilesCompressedFile || ''),
        cellMapFile: normalizeAssetSource(data.generated.cellMapFile || ''),
        mapFile: normalizeAssetSource(data.generated.mapFile || ''),
        mapVramFile: normalizeAssetSource(data.generated.mapVramFile || ''),
        mapVramCompressedFile: normalizeAssetSource(data.generated.mapVramCompressedFile || ''),
        outputFile: normalizeAssetSource(data.generated.outputFile || ''),
        previewFile: normalizeAssetSource(data.generated.previewFile || ''),
        tileCount: clampInt(data.generated.tileCount, 0, 65535, 0),
        paletteCount: clampInt(data.generated.paletteCount, 0, 32, 0),
        vramBytes: clampInt(data.generated.vramBytes, 0, 65535, 0),
        byteLength: clampInt(data.generated.byteLength, 0, 0x7fffffff, 0),
        sampleRate: clampInt(data.generated.sampleRate, 0, 192000, 0),
        channels: clampInt(data.generated.channels, 0, 8, 0),
        durationSeconds: Number.isFinite(Number(data.generated.durationSeconds)) ? Number(data.generated.durationSeconds) : 0,
        warnings: Array.isArray(data.generated.warnings)
          ? data.generated.warnings.map((warning) => String(warning)).filter(Boolean)
          : [],
        paletteColors: Array.isArray(data.generated.paletteColors)
          ? data.generated.paletteColors.map((color) => String(color)).filter(Boolean).slice(0, 256)
          : [],
        waveform: Array.isArray(data.generated.waveform)
          ? data.generated.waveform.map((value) => Math.max(0, Math.min(1, Number(value) || 0))).slice(0, 256)
          : [],
        compression: normalizeGeneratedCompression(data.generated.compression),
      }
    : null;
  return generated ? { ...data, generated } : { ...data };
}

function normalizePaletteOptions(asset = {}) {
  const rawOptions = asset.options && typeof asset.options === 'object' ? { ...asset.options } : {};
  const colors = Array.isArray(rawOptions.colors)
    ? rawOptions.colors.map((color) => String(color || '').trim()).filter(Boolean).slice(0, 16)
    : [];
  return {
    ...DEFAULT_PALETTE_OPTIONS,
    ...rawOptions,
    target: rawOptions.target === 'sprite' ? 'sprite' : 'bg',
    paletteBank: clampInt(rawOptions.paletteBank, 0, 15, DEFAULT_PALETTE_OPTIONS.paletteBank),
    colors,
  };
}

function normalizePsgOptions(asset = {}) {
  const rawOptions = asset.options && typeof asset.options === 'object' ? { ...asset.options } : {};
  const type = asset.type === 'psg-song' ? 'song' : 'sfx';
  return {
    ...DEFAULT_PSG_OPTIONS,
    ...rawOptions,
    kind: type,
    bpm: clampInt(rawOptions.bpm, 30, 300, DEFAULT_PSG_OPTIONS.bpm),
    speed: clampInt(rawOptions.speed, 1, 16, DEFAULT_PSG_OPTIONS.speed),
    period: clampInt(rawOptions.period, 1, 4095, DEFAULT_PSG_OPTIONS.period),
    channels: clampInt(rawOptions.channels, 1, 6, DEFAULT_PSG_OPTIONS.channels),
    steps: clampInt(rawOptions.steps, 1, PCE_PSG_MAX_STEPS, DEFAULT_PSG_OPTIONS.steps),
    volume: clampInt(rawOptions.volume, 0, 100, DEFAULT_PSG_OPTIONS.volume),
    pattern: Array.isArray(rawOptions.pattern) ? rawOptions.pattern.slice(0, PCE_PSG_MAX_PATTERN_ENTRIES) : [],
  };
}

function normalizeAdpcmOptions(asset = {}) {
  const rawOptions = asset.options && typeof asset.options === 'object' ? { ...asset.options } : {};
  const sampleRate = clampInt(rawOptions.sampleRate, PCE_ADPCM_MIN_SAMPLE_RATE, PCE_ADPCM_MAX_SAMPLE_RATE, DEFAULT_ADPCM_OPTIONS.sampleRate);
  const autoDivider = audioConverter.sampleRateToAdpcmDivider(sampleRate);
  const rawDivider = rawOptions.divider;
  const normalizedDivider = clampInt(rawDivider, 0, 15, autoDivider);
  const legacyDivider = typeof audioConverter.legacySampleRateToAdpcmDivider === 'function'
    ? audioConverter.legacySampleRateToAdpcmDivider(sampleRate)
    : autoDivider;
  const slowLegacyDivider = typeof audioConverter.slowLegacySampleRateToAdpcmDivider === 'function'
    ? audioConverter.slowLegacySampleRateToAdpcmDivider(sampleRate)
    : autoDivider;
  const divider = rawDivider == null
    || rawDivider === ''
    || normalizedDivider === legacyDivider
    || normalizedDivider === slowLegacyDivider
    || normalizedDivider < 8
    ? autoDivider
    : normalizedDivider;
  return {
    ...DEFAULT_ADPCM_OPTIONS,
    ...rawOptions,
    sampleRate,
    loop: Boolean(rawOptions.loop),
    stream: Boolean(rawOptions.stream ?? rawOptions.streaming),
    adpcmAddress: clampInt(rawOptions.adpcmAddress, 0, 65535, DEFAULT_ADPCM_OPTIONS.adpcmAddress),
    divider,
  };
}

function normalizeCddaOptions(asset = {}) {
  const rawOptions = asset.options && typeof asset.options === 'object' ? { ...asset.options } : {};
  return {
    ...DEFAULT_CDDA_OPTIONS,
    ...rawOptions,
    track: clampInt(rawOptions.track, 2, 99, DEFAULT_CDDA_OPTIONS.track),
    loop: Boolean(rawOptions.loop),
  };
}

function normalizeAsset(asset = {}) {
  const id = sanitizeAssetId(asset.id || asset.name || '');
  let type = String(asset.type || '').trim().toLowerCase();
  if (type === 'psg-sequence') type = 'psg-sfx';
  if (!id) throw new Error('asset id is required');
  if (!SUPPORTED_TYPES.has(type)) throw new Error(`unsupported asset type: ${type}`);
  const normalized = {
    id,
    type,
    name: String(asset.name || id).trim(),
    source: normalizeAssetSource(asset.source || ''),
    options: asset.options && typeof asset.options === 'object' ? { ...asset.options } : {},
  };
  if (asset.data && typeof asset.data === 'object') normalized.data = normalizeGeneratedData(asset.data);
  if (type === 'image' || type === 'sprite') {
    normalized.options = normalizeImageOptions({ ...normalized, type });
  } else if (type === 'palette') {
    normalized.options = normalizePaletteOptions({ ...normalized, type });
  } else if (type === 'psg-song' || type === 'psg-sfx') {
    normalized.options = normalizePsgOptions({ ...normalized, type });
  } else if (type === 'adpcm') {
    normalized.options = normalizeAdpcmOptions({ ...normalized, type });
  } else if (type === 'cdda-track') {
    normalized.options = normalizeCddaOptions({ ...normalized, type });
  }
  return normalized;
}

function normalizeAssetDocument(doc = {}) {
  const assets = Array.isArray(doc.assets) ? doc.assets : [];
  return {
    version: Math.max(2, Number(doc.version) || 2),
    assets: assets.map(normalizeAsset),
  };
}

function ensureAssetFile(projectDir) {
  const filePath = getAssetFilePath(projectDir);
  if (!fs.existsSync(filePath)) {
    ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(defaultAssets(), null, 2), 'utf-8');
  }
  return filePath;
}

function readAssetDocument(projectDir) {
  const filePath = ensureAssetFile(projectDir);
  try {
    return normalizeAssetDocument(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (err) {
    throw new Error(`asset file parse failed: ${err.message || err}`);
  }
}

function readRawAssetDocument(projectDir) {
  const filePath = ensureAssetFile(projectDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : defaultAssets();
  } catch (err) {
    throw new Error(`asset file parse failed: ${err.message || err}`);
  }
}

function writeAssetDocument(projectDir, doc) {
  const normalized = normalizeAssetDocument(doc);
  const filePath = getAssetFilePath(projectDir);
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function resolveAssetSource(projectDir, asset) {
  const normalized = normalizeAsset(asset);
  if (!normalized.source) return { asset: normalized, absPath: null };
  const { absPath } = resolveUnderRoot(projectDir, normalized.source, 'project');
  return { asset: normalized, absPath };
}

function getMimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.json') return 'application/json';
  if (ext === '.bin') return 'application/octet-stream';
  return 'application/octet-stream';
}

function listAssets(projectDir) {
  const doc = readAssetDocument(projectDir);
  return {
    file: ASSET_FILE,
    assets: doc.assets.map((asset) => {
      let exists = true;
      let pathError = '';
      if (asset.source) {
        try {
          const { absPath } = resolveUnderRoot(projectDir, asset.source, 'project');
          exists = fs.existsSync(absPath);
        } catch (err) {
          exists = false;
          pathError = err.message || String(err);
        }
      }
      return {
        ...asset,
        exists,
        pathError,
      };
    }),
  };
}

function upsertAsset(projectDir, nextAsset) {
  const doc = readAssetDocument(projectDir);
  const asset = normalizeAsset(nextAsset);
  const index = doc.assets.findIndex((entry) => entry.id === asset.id);
  if (index >= 0) {
    doc.assets[index] = asset;
  } else {
    doc.assets.push(asset);
  }
  return writeAssetDocument(projectDir, doc);
}

function deleteAsset(projectDir, id) {
  const doc = readAssetDocument(projectDir);
  const assetId = String(id || '').trim();
  const nextAssets = doc.assets.filter((asset) => asset.id !== assetId);
  if (nextAssets.length === doc.assets.length) {
    throw new Error(`asset not found: ${assetId}`);
  }
  return writeAssetDocument(projectDir, { ...doc, assets: nextAssets });
}

function reorderAssets(projectDir, ids = []) {
  const doc = readAssetDocument(projectDir);
  const order = Array.isArray(ids) ? ids.map((id) => String(id)).filter(Boolean) : [];
  const byId = new Map(doc.assets.map((asset) => [asset.id, asset]));
  const nextAssets = [];
  for (const id of order) {
    if (byId.has(id)) {
      nextAssets.push(byId.get(id));
      byId.delete(id);
    }
  }
  nextAssets.push(...doc.assets.filter((asset) => byId.has(asset.id)));
  return writeAssetDocument(projectDir, { ...doc, assets: nextAssets });
}

function readPceImageJson(absPath) {
  const parsed = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  const width = Math.max(1, Math.min(64, Number(parsed.width) || 16));
  const height = Math.max(1, Math.min(64, Number(parsed.height) || 16));
  const pixels = Array.isArray(parsed.pixels) ? parsed.pixels : [];
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Array.isArray(pixels[y]) ? pixels[y] : [];
    rows.push(Array.from({ length: width }, (_unused, x) => Number(row[x]) & 0x0f));
  }
  return {
    width,
    height,
    pixels: rows,
    palette: Array.isArray(parsed.palette) ? parsed.palette.slice(0, 16) : [],
  };
}

function parsePngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseBmpSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 26) return null;
  if (buffer.toString('ascii', 0, 2) !== 'BM') return null;
  const width = buffer.readInt32LE(18);
  const height = Math.abs(buffer.readInt32LE(22));
  return width > 0 && height > 0 ? { width, height } : null;
}

function readImageSize(absPath) {
  const buffer = fs.readFileSync(absPath);
  return parsePngSize(buffer) || parseBmpSize(buffer) || { width: 0, height: 0 };
}

function decodeDataUrl(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error('invalid image data URL');
  const mime = match[1] || 'application/octet-stream';
  const payload = match[3] || '';
  const buffer = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8');
  return { mime, buffer };
}

function sourcePathForImport(payload = {}) {
  const raw = String(payload.sourcePath || '').trim();
  if (!raw) return null;
  if (isLikelyAbsolutePath(raw)) {
    if (!fs.existsSync(raw)) throw new Error(`source file not found: ${raw}`);
    return path.resolve(raw);
  }
  throw new Error('import source must be selected with an absolute file path');
}

function buildImageWarnings(asset, imageSize, generated = {}) {
  const options = normalizeImageOptions(asset);
  const warnings = [];
  const width = options.width || imageSize.width || 0;
  const height = options.height || imageSize.height || 0;
  if (options.kind === 'sprite') {
    const cellKey = `${options.cellWidth}x${options.cellHeight}`;
    if (!SPRITE_CELL_SIZES.has(cellKey)) {
      warnings.push(`PCE sprite cell size must be one of ${Array.from(SPRITE_CELL_SIZES).join(', ')}`);
    }
    if (width && width % 16 !== 0) warnings.push('Sprite sheet width is not aligned to 16px patterns');
    if (height && height % 16 !== 0) warnings.push('Sprite sheet height is not aligned to 16px patterns');
    const frameCount = width && height
      ? Math.max(1, Math.floor(width / options.cellWidth) * Math.floor(height / options.cellHeight))
      : 1;
    if (frameCount > 64) warnings.push('Sprite sheet contains more than 64 cells; PCE SATB displays up to 64 sprites');
    if (Math.floor(width / options.cellWidth) > 16) warnings.push('Many cells share the same scanline; hardware limit is 16 sprites per scanline');
    const patternWords = Math.ceil((generated.vramBytes || 0) / 2);
    if (patternWords && (options.tileBase * 32) + patternWords > PCE_SATB_VRAM_WORD) {
      warnings.push('Sprite patterns overlap the SATB VRAM area; lower tileBase or reduce sprite sheet size');
    }
  } else {
    if (width && width % 8 !== 0) warnings.push('BG image width is not aligned to 8px tiles');
    if (height && height % 8 !== 0) warnings.push('BG image height is not aligned to 8px tiles');
    if (width > 256 || height > 224) warnings.push('BG image exceeds the v1 recommended 256x224 viewport');
    const tileCount = generated.tileCount || 0;
    const tileStartWord = options.tileBase * 16;
    const tileEndWord = tileStartWord + (tileCount * 16);
    const batStartWord = 0;
    const batWords = PCE_BG_MAP_WIDTH_TILES * PCE_BG_MAP_HEIGHT_TILES;
    const batEndWord = batStartWord + batWords;
    if (tileCount && tileStartWord < batEndWord && tileEndWord > batStartWord) {
      warnings.push(`BG tiles overlap the BAT VRAM area; use tileBase ${PCE_BG_AUTO_TILE_BASE} or higher for this map size`);
    }
    if (tileCount && options.tileBase < 704 && options.tileBase + tileCount > 704) {
      warnings.push('BG tiles overlap the sample UI/font VRAM area at tile 704');
    }
  }
  const paletteCount = generated.paletteCount || 0;
  if (paletteCount > 16) warnings.push('PCE image assets can use at most 16 palettes in v1');
  return warnings;
}

function vceWordToHex(word) {
  const b = word & 0x07;
  const r = (word >> 3) & 0x07;
  const g = (word >> 6) & 0x07;
  const to8 = (v) => Math.round((v / 7) * 255).toString(16).padStart(2, '0');
  return `#${to8(r)}${to8(g)}${to8(b)}`;
}

function readPaletteColors(buffer) {
  if (!Buffer.isBuffer(buffer)) return [];
  const colors = [];
  for (let offset = 0; offset + 1 < buffer.length && colors.length < 256; offset += 2) {
    colors.push(vceWordToHex(buffer.readUInt16LE(offset)));
  }
  return colors;
}

function relativeGeneratedPath(assetId, fileName) {
  return normalizeRelativePath(path.join('assets', 'generated', assetId, fileName));
}

function buildInternalPceConversionPlan(projectDir, asset) {
  const normalized = normalizeAsset(asset);
  const kind = normalized.type === 'sprite' ? 'sprite' : 'background';
  const generatedDir = path.join(projectDir, 'assets', 'generated', normalized.id);
  const paletteFile = relativeGeneratedPath(normalized.id, 'palette.bin');
  const tilesFile = relativeGeneratedPath(normalized.id, kind === 'sprite' ? 'patterns.bin' : 'tiles.bin');
  const tilesCompressedFile = relativeGeneratedPath(normalized.id, kind === 'sprite' ? 'patterns.rle' : 'tiles.rle');
  const cellMapFile = kind === 'sprite' ? relativeGeneratedPath(normalized.id, 'cellmap.bin') : '';
  const mapFile = kind === 'sprite' ? '' : relativeGeneratedPath(normalized.id, 'map.bin');
  const mapVramFile = kind === 'sprite' ? '' : relativeGeneratedPath(normalized.id, 'map_vram.bin');
  const mapVramCompressedFile = kind === 'sprite' ? '' : relativeGeneratedPath(normalized.id, 'map_vram.rle');
  const previewFile = relativeGeneratedPath(normalized.id, 'preview.json');
  const paletteAbs = path.join(projectDir, paletteFile);
  const tilesAbs = path.join(projectDir, tilesFile);
  const tilesCompressedAbs = path.join(projectDir, tilesCompressedFile);
  const cellMapAbs = cellMapFile ? path.join(projectDir, cellMapFile) : '';
  const mapAbs = mapFile ? path.join(projectDir, mapFile) : '';
  const mapVramAbs = mapVramFile ? path.join(projectDir, mapVramFile) : '';
  const mapVramCompressedAbs = mapVramCompressedFile ? path.join(projectDir, mapVramCompressedFile) : '';
  return {
    kind,
    command: PCE_INTERNAL_IMAGE_CONVERTER,
    args: [],
    cwd: projectDir,
    files: { paletteFile, tilesFile, tilesCompressedFile, cellMapFile, mapFile, mapVramFile, mapVramCompressedFile, previewFile },
    absFiles: { paletteAbs, tilesAbs, tilesCompressedAbs, cellMapAbs, mapAbs, mapVramAbs, mapVramCompressedAbs, previewAbs: path.join(projectDir, previewFile) },
    generatedDir,
  };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterPngScanlines(input, width, height, rowBytes, bytesPerPixel) {
  const output = Buffer.alloc(rowBytes * height);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    if (src >= input.length) throw new Error('PNG data is truncated');
    const filter = input[src];
    src += 1;
    const rowOffset = y * rowBytes;
    const prevOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      if (src >= input.length) throw new Error('PNG data is truncated');
      const raw = input[src];
      src += 1;
      const left = x >= bytesPerPixel ? output[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[prevOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? output[prevOffset + x - bytesPerPixel] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
      else throw new Error(`unsupported PNG filter: ${filter}`);
      output[rowOffset + x] = value & 0xff;
    }
  }
  return output;
}

function unpackPngSample(row, x, bitDepth) {
  if (bitDepth === 8) return row[x] || 0;
  const bitOffset = x * bitDepth;
  const byte = row[Math.floor(bitOffset / 8)] || 0;
  const shift = 8 - bitDepth - (bitOffset % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function decodePngImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG image is required');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = [];
  let alphaTable = [];
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error('PNG chunk is truncated');
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      interlace = data[12];
      if (compression !== 0 || filter !== 0) throw new Error('unsupported PNG compression/filter method');
      if (interlace !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i + 2 < data.length; i += 3) {
        palette.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    } else if (type === 'tRNS') {
      alphaTable = Array.from(data);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || idat.length === 0) throw new Error('invalid PNG image');
  let bitsPerPixel;
  if (colorType === 0) bitsPerPixel = bitDepth;
  else if (colorType === 2) bitsPerPixel = bitDepth * 3;
  else if (colorType === 3) bitsPerPixel = bitDepth;
  else if (colorType === 4) bitsPerPixel = bitDepth * 2;
  else if (colorType === 6) bitsPerPixel = bitDepth * 4;
  else throw new Error(`unsupported PNG color type: ${colorType}`);
  if (![1, 2, 4, 8].includes(bitDepth) || (colorType !== 3 && bitDepth !== 8)) {
    throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  }
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rows = unfilterPngScanlines(inflated, width, height, rowBytes, bytesPerPixel);
  if (colorType === 3) {
    if (palette.length === 0) throw new Error('indexed PNG is missing PLTE');
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let x = 0; x < width; x += 1) {
        indices[(y * width) + x] = unpackPngSample(row, x, bitDepth);
      }
    }
    return {
      format: 'indexed',
      width,
      height,
      indices,
      palette,
      alphaTable,
    };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < width; x += 1) {
      const dest = ((y * width) + x) * 4;
      if (colorType === 0) {
        const gray = row[x];
        rgba[dest] = gray;
        rgba[dest + 1] = gray;
        rgba[dest + 2] = gray;
        rgba[dest + 3] = 255;
      } else if (colorType === 2) {
        const src = x * 3;
        rgba[dest] = row[src];
        rgba[dest + 1] = row[src + 1];
        rgba[dest + 2] = row[src + 2];
        rgba[dest + 3] = 255;
      } else if (colorType === 4) {
        const src = x * 2;
        rgba[dest] = row[src];
        rgba[dest + 1] = row[src];
        rgba[dest + 2] = row[src];
        rgba[dest + 3] = row[src + 1];
      } else if (colorType === 6) {
        const src = x * 4;
        rgba[dest] = row[src];
        rgba[dest + 1] = row[src + 1];
        rgba[dest + 2] = row[src + 2];
        rgba[dest + 3] = row[src + 3];
      }
    }
  }
  return { format: 'rgba', width, height, rgba };
}

function pceColorComponent(value) {
  const n = Math.max(0, Math.min(255, Number(value) || 0));
  return Math.max(0, Math.min(7, Math.round(n / 255 * 7)));
}

function pceColorFromRgb(color = {}) {
  return {
    r: pceColorComponent(color.r),
    g: pceColorComponent(color.g),
    b: pceColorComponent(color.b),
  };
}

function pceColorKey(color = {}) {
  return `${color.r & 7},${color.g & 7},${color.b & 7}`;
}

function pceColorDistanceSq(a = {}, b = {}) {
  const dr = (a.r & 7) - (b.r & 7);
  const dg = (a.g & 7) - (b.g & 7);
  const db = (a.b & 7) - (b.b & 7);
  return (dr * dr) + (dg * dg) + (db * db);
}

function pcePaletteWord(color = {}) {
  return (color.b & 7) | ((color.r & 7) << 3) | ((color.g & 7) << 6);
}

function decodedPixelRgba(decoded, pixelIndex) {
  if (decoded.format === 'indexed') {
    const index = decoded.indices[pixelIndex] || 0;
    const color = decoded.palette[index] || { r: 0, g: 0, b: 0 };
    const alpha = decoded.alphaTable[index] ?? 255;
    return { r: color.r || 0, g: color.g || 0, b: color.b || 0, a: alpha };
  }
  const offset = pixelIndex * 4;
  return {
    r: decoded.rgba[offset] || 0,
    g: decoded.rgba[offset + 1] || 0,
    b: decoded.rgba[offset + 2] || 0,
    a: decoded.rgba[offset + 3] ?? 255,
  };
}

function shouldSkipPaletteIndex(index, skipIndexes) {
  if (skipIndexes instanceof Set) return skipIndexes.has(index);
  if (Array.isArray(skipIndexes)) return skipIndexes.includes(index);
  return index === skipIndexes;
}

function nearestPcePaletteIndex(color, palette, skipIndexes = -1) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    if (shouldSkipPaletteIndex(i, skipIndexes)) continue;
    const candidate = palette[i];
    if (!candidate) continue;
    const dist = pceColorDistanceSq(color, candidate);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  if (bestDist !== Infinity) return best;
  for (let i = 0; i < palette.length; i += 1) {
    if (!shouldSkipPaletteIndex(i, skipIndexes)) return i;
  }
  return 0;
}

function convertDecodedToIndexed16(decoded, options = {}) {
  const width = decoded.width || 0;
  const height = decoded.height || 0;
  const transparentIndex = clampInt(options.transparentIndex, 0, 15, 0);
  const pixelCount = width * height;
  const warnings = [];
  const reserveBackdrop = options.kind !== 'sprite';
  if (decoded.format === 'indexed' && decoded.palette.length <= 16 && !reserveBackdrop) {
    const palette = Array.from({ length: 16 }, (_unused, index) => (
      decoded.palette[index] ? pceColorFromRgb(decoded.palette[index]) : { r: 0, g: 0, b: 0 }
    ));
    const indices = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) {
      const sourceIndex = decoded.indices[i] || 0;
      const alpha = decoded.alphaTable[sourceIndex] ?? 255;
      indices[i] = alpha < 128 ? transparentIndex : (sourceIndex & 0x0f);
    }
    return { width, height, indices, palette, warnings };
  }

  const counts = new Map();
  let transparentPixels = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const rgba = decodedPixelRgba(decoded, i);
    if (rgba.a < 128) {
      transparentPixels += 1;
      continue;
    }
    const color = pceColorFromRgb(rgba);
    const key = pceColorKey(color);
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { color, count: 1 });
  }

  const reserveTransparent = options.kind === 'sprite' || transparentPixels > 0;
  const reservedIndexes = new Set();
  if (reserveBackdrop) reservedIndexes.add(0);
  if (reserveTransparent) reservedIndexes.add(transparentIndex);
  const palette = Array.from({ length: 16 }, () => null);
  reservedIndexes.forEach((index) => {
    palette[index] = { r: 0, g: 0, b: 0 };
  });
  const sorted = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const capacity = 16 - reservedIndexes.size;
  if (sorted.length > capacity) {
    warnings.push(`Image uses ${sorted.length} PCE colors; remapped to ${capacity} opaque color slots`);
  }
  let cursor = 0;
  sorted.slice(0, capacity).forEach(({ color }) => {
    while (cursor < 16 && palette[cursor]) cursor += 1;
    if (cursor < 16) {
      palette[cursor] = color;
      cursor += 1;
    }
  });
  for (let i = 0; i < 16; i += 1) {
    if (!palette[i]) palette[i] = { r: 0, g: 0, b: 0 };
  }

  const indices = new Uint8Array(pixelCount);
  const skipReservedForOpaque = reservedIndexes.size > 0 && sorted.length > 0 ? reservedIndexes : -1;
  for (let i = 0; i < pixelCount; i += 1) {
    const rgba = decodedPixelRgba(decoded, i);
    if (rgba.a < 128) {
      indices[i] = transparentIndex;
      continue;
    }
    indices[i] = nearestPcePaletteIndex(pceColorFromRgb(rgba), palette, skipReservedForOpaque);
  }
  return { width, height, indices, palette, warnings };
}

function encodePcePaletteBuffer(palette = []) {
  const buffer = Buffer.alloc(32);
  for (let i = 0; i < 16; i += 1) {
    buffer.writeUInt16LE(pcePaletteWord(palette[i] || { r: 0, g: 0, b: 0 }), i * 2);
  }
  return buffer;
}

function encodePceBgTile(indices, width, startX, startY) {
  const tile = Buffer.alloc(32);
  for (let y = 0; y < 8; y += 1) {
    for (let plane = 0; plane < 4; plane += 1) {
      let value = 0;
      for (let x = 0; x < 8; x += 1) {
        const color = indices[((startY + y) * width) + startX + x] & 0x0f;
        if (color & (1 << plane)) value |= (0x80 >> x);
      }
      const offset = plane < 2 ? (y * 2) + plane : 16 + (y * 2) + (plane - 2);
      tile[offset] = value;
    }
  }
  return tile;
}

function encodePceSpritePattern(indices, width, startX, startY) {
  const pattern = Buffer.alloc(128);
  for (let y = 0; y < 16; y += 1) {
    for (let plane = 0; plane < 4; plane += 1) {
      let left = 0;
      let right = 0;
      for (let x = 0; x < 8; x += 1) {
        const color = indices[((startY + y) * width) + startX + x] & 0x0f;
        if (color & (1 << plane)) left |= (0x80 >> x);
      }
      for (let x = 0; x < 8; x += 1) {
        const color = indices[((startY + y) * width) + startX + 8 + x] & 0x0f;
        if (color & (1 << plane)) right |= (0x80 >> x);
      }
      const offset = (plane * 32) + (y * 2);
      pattern[offset] = right;
      pattern[offset + 1] = left;
    }
  }
  return pattern;
}

function spriteHardwarePatternSlots(cellWidth, cellHeight) {
  const patternCols = Math.max(1, Math.ceil(cellWidth / 16));
  const patternRows = Math.max(1, Math.ceil(cellHeight / 16));
  const rowPatternSlots = patternRows > 1 ? Math.max(patternCols, 2) : patternCols;
  return rowPatternSlots * patternRows;
}

function encodePceBackground(indexed, asset) {
  const options = normalizeImageOptions(asset);
  if (indexed.width % 8 || indexed.height % 8) throw new Error('BG image size must be aligned to 8px tiles');
  const tiles = [];
  const widthTiles = indexed.width / 8;
  const heightTiles = indexed.height / 8;
  // The runtime BAT (and the streamed map_vram.bin source rows) are
  // PCE_BG_MAP_WIDTH_TILES wide; a wider BG cannot be laid out without the rows
  // wrapping, so reject it with an actionable error instead of overflowing.
  if (widthTiles > PCE_BG_MAP_WIDTH_TILES || heightTiles > PCE_BG_MAP_HEIGHT_TILES) {
    throw new Error(`BG image ${indexed.width}x${indexed.height} exceeds the ${PCE_BG_MAP_WIDTH_TILES * 8}x${PCE_BG_MAP_HEIGHT_TILES * 8} BG limit; resize the background to fit the 256x224 screen.`);
  }
  const map = Buffer.alloc(widthTiles * heightTiles * 2);
  const vramMap = Buffer.alloc(PCE_BG_MAP_WIDTH_TILES * heightTiles * 2);
  let mapOffset = 0;
  for (let tileY = 0; tileY < indexed.height; tileY += 8) {
    for (let tileX = 0; tileX < indexed.width; tileX += 8) {
      const tile = encodePceBgTile(indexed.indices, indexed.width, tileX, tileY);
      const tileIndex = tiles.length;
      tiles.push(tile);
      const word = ((options.paletteBank & 0x0f) << 12) | ((options.tileBase + tileIndex) & 0x0fff);
      map.writeUInt16LE(word, mapOffset);
      vramMap.writeUInt16LE(word, (((tileY / 8) * PCE_BG_MAP_WIDTH_TILES) + (tileX / 8)) * 2);
      mapOffset += 2;
    }
  }
  return {
    tiles: Buffer.concat(tiles),
    map,
    vramMap,
  };
}

// Encode a sprite sheet into display-cell blocks, deduplicating identical
// blocks so the VRAM upload carries only the unique cells used by SATB entries.
// The VDC fetches tall 16px-wide sprites at a two-pattern row pitch (bit 0 is the
// 16px lane; vertical rows advance by two pattern slots), so 16x32/16x64 cells
// include padding slots between rows. The runtime indexes this map by display
// cell, so larger PCE sprite sizes must stay contiguous in patterns.bin.
function encodePceSprites(indexed, options = DEFAULT_SPRITE_OPTIONS) {
  if (indexed.width % 16 || indexed.height % 16) throw new Error('Sprite sheet size must be aligned to 16px patterns');
  const cellWidth = clampPositiveInt(options.cellWidth, 16, 32, DEFAULT_SPRITE_OPTIONS.cellWidth);
  const cellHeight = clampPositiveInt(options.cellHeight, 16, 64, DEFAULT_SPRITE_OPTIONS.cellHeight);
  if (indexed.width % cellWidth || indexed.height % cellHeight) {
    throw new Error(`Sprite sheet size must be aligned to ${cellWidth}x${cellHeight} sprite cells`);
  }
  const patternCols = Math.max(1, Math.ceil(cellWidth / 16));
  const patternRows = Math.max(1, Math.ceil(cellHeight / 16));
  const rowPatternSlots = patternRows > 1 ? Math.max(patternCols, 2) : patternCols;
  const blankSpritePattern = Buffer.alloc(128);
  const uniqueBlocks = [];
  const lookup = new Map();
  const cellMap = [];
  for (let y = 0; y < indexed.height; y += cellHeight) {
    for (let x = 0; x < indexed.width; x += cellWidth) {
      const blockPatterns = [];
      for (let patternY = 0; patternY < patternRows; patternY += 1) {
        for (let patternX = 0; patternX < patternCols; patternX += 1) {
          blockPatterns.push(encodePceSpritePattern(
            indexed.indices,
            indexed.width,
            x + patternX * 16,
            y + patternY * 16,
          ));
        }
        for (let patternX = patternCols; patternX < rowPatternSlots; patternX += 1) {
          blockPatterns.push(blankSpritePattern);
        }
      }
      const block = Buffer.concat(blockPatterns);
      const key = block.toString('latin1');
      let slot = lookup.get(key);
      if (slot === undefined) {
        slot = uniqueBlocks.length;
        lookup.set(key, slot);
        uniqueBlocks.push(block);
      }
      cellMap.push(slot);
    }
  }
  if (uniqueBlocks.length > 256) {
    throw new Error(`Sprite sheet has ${uniqueBlocks.length} unique ${cellWidth}x${cellHeight} cells; the VN runtime cell map supports at most 256. Reduce the sheet or split it.`);
  }
  return { patterns: Buffer.concat(uniqueBlocks), cellMap: Buffer.from(cellMap) };
}

function encodePceRleBuffer(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) return Buffer.alloc(0);
  const output = [];
  let offset = 0;
  while (offset < input.length) {
    let runLength = 1;
    while (
      offset + runLength < input.length
      && runLength < 130
      && input[offset + runLength] === input[offset]
    ) {
      runLength += 1;
    }
    if (runLength >= 3) {
      output.push(0x80 | (runLength - 3), input[offset]);
      offset += runLength;
      continue;
    }

    const literalStart = offset;
    offset += runLength;
    while (offset < input.length && offset - literalStart < 128) {
      runLength = 1;
      while (
        offset + runLength < input.length
        && runLength < 130
        && input[offset + runLength] === input[offset]
      ) {
        runLength += 1;
      }
      if (runLength >= 3) break;
      if ((offset - literalStart) + runLength > 128) {
        offset = literalStart + 128;
        break;
      }
      offset += runLength;
    }
    const literalLength = offset - literalStart;
    output.push(literalLength - 1);
    for (let i = literalStart; i < offset; i += 1) output.push(input[i]);
  }
  return Buffer.from(output);
}

// RLE visual compression was removed: the CD-ROM2 VN runtime decodes raw tiles/maps/
// patterns only (the RLE streaming decoder held the VDC write address across CD reads
// and consumed ~87% of the bank133 overlay). Visual assets always ship uncompressed,
// so this never emits a sidecar. `policy` is kept for signature compatibility.
function selectVisualCompression(rawBuffer, policy = PCE_VISUAL_COMPRESSION_AUTO) {
  return { codec: PCE_VISUAL_COMPRESSION_NONE, buffer: Buffer.alloc(0), rawBytes: (Buffer.isBuffer(rawBuffer) ? rawBuffer.length : 0), byteLength: 0, savedBytes: 0 };
}

function writeVisualCompressionSidecar(rawBuffer, absPath, policy) {
  const result = selectVisualCompression(rawBuffer, policy);
  if (result.codec === PCE_VISUAL_COMPRESSION_RLE && absPath) {
    ensureDirSync(path.dirname(absPath));
    fs.writeFileSync(absPath, result.buffer);
  } else if (absPath && fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
  }
  return result;
}

function runInternalPceImageConversion(plan, sourceAbs, asset, options = {}) {
  ensureDirSync(plan.generatedDir);
  if (options.dryRun) {
    return { ok: true, converter: PCE_INTERNAL_IMAGE_CONVERTER, warnings: [], dryRun: true };
  }
  const decoded = decodePngImage(fs.readFileSync(sourceAbs));
  const indexed = convertDecodedToIndexed16(decoded, normalizeImageOptions(asset));
  const imageOptions = normalizeImageOptions(asset);
  fs.writeFileSync(plan.absFiles.paletteAbs, encodePcePaletteBuffer(indexed.palette));
  if (plan.kind === 'background') {
    const encoded = encodePceBackground(indexed, asset);
    fs.writeFileSync(plan.absFiles.tilesAbs, encoded.tiles);
    fs.writeFileSync(plan.absFiles.mapAbs, encoded.map);
    fs.writeFileSync(plan.absFiles.mapVramAbs, encoded.vramMap);
    writeVisualCompressionSidecar(encoded.tiles, plan.absFiles.tilesCompressedAbs, imageOptions.compression);
    writeVisualCompressionSidecar(encoded.vramMap, plan.absFiles.mapVramCompressedAbs, imageOptions.compression);
  } else {
    const { patterns, cellMap } = encodePceSprites(indexed, imageOptions);
    fs.writeFileSync(plan.absFiles.tilesAbs, patterns);
    writeVisualCompressionSidecar(patterns, plan.absFiles.tilesCompressedAbs, imageOptions.compression);
    if (plan.absFiles.cellMapAbs) fs.writeFileSync(plan.absFiles.cellMapAbs, cellMap);
  }
  return {
    ok: true,
    converter: PCE_INTERNAL_IMAGE_CONVERTER,
    warnings: indexed.warnings,
    width: indexed.width,
    height: indexed.height,
  };
}

function uniqueWarnings(warnings = []) {
  return Array.from(new Set(warnings.map((warning) => String(warning || '').trim()).filter(Boolean)));
}

// RLE removed: visual assets are always uncompressed, so the generated metadata slot
// is always NONE with no compressed sidecar file.
function generatedCompressionSlot(policy, rawBuffer, compressedBuffer, compressedFile) {
  const rawBytes = Buffer.isBuffer(rawBuffer) ? rawBuffer.length : 0;
  return { codec: PCE_VISUAL_COMPRESSION_NONE, file: '', rawBytes, byteLength: 0, savedBytes: 0 };
}

function createGeneratedMetadata(projectDir, asset, plan, sourceRel, imageSize, extraWarnings = []) {
  const palette = fs.existsSync(plan.absFiles.paletteAbs) ? fs.readFileSync(plan.absFiles.paletteAbs) : Buffer.alloc(0);
  const tiles = fs.existsSync(plan.absFiles.tilesAbs) ? fs.readFileSync(plan.absFiles.tilesAbs) : Buffer.alloc(0);
  const tilesCompressed = fs.existsSync(plan.absFiles.tilesCompressedAbs) ? fs.readFileSync(plan.absFiles.tilesCompressedAbs) : Buffer.alloc(0);
  const map = plan.absFiles.mapAbs && fs.existsSync(plan.absFiles.mapAbs) ? fs.readFileSync(plan.absFiles.mapAbs) : Buffer.alloc(0);
  const vramMap = plan.absFiles.mapVramAbs && fs.existsSync(plan.absFiles.mapVramAbs) ? fs.readFileSync(plan.absFiles.mapVramAbs) : Buffer.alloc(0);
  const vramMapCompressed = plan.absFiles.mapVramCompressedAbs && fs.existsSync(plan.absFiles.mapVramCompressedAbs) ? fs.readFileSync(plan.absFiles.mapVramCompressedAbs) : Buffer.alloc(0);
  const isSprite = asset.type === 'sprite';
  const options = normalizeImageOptions(asset);
  const tilesCompression = generatedCompressionSlot(options.compression, tiles, tilesCompressed, plan.files.tilesCompressedFile);
  const mapCompression = isSprite
    ? generatedCompressionSlot(PCE_VISUAL_COMPRESSION_NONE, Buffer.alloc(0), Buffer.alloc(0), '')
    : generatedCompressionSlot(options.compression, vramMap, vramMapCompressed, plan.files.mapVramCompressedFile);
  const generated = {
    ...plan.files,
    tilesCompressedFile: tilesCompression.codec === PCE_VISUAL_COMPRESSION_RLE ? plan.files.tilesCompressedFile : '',
    mapVramCompressedFile: mapCompression.codec === PCE_VISUAL_COMPRESSION_RLE ? plan.files.mapVramCompressedFile : '',
    tileCount: isSprite ? Math.floor(tiles.length / 128) : Math.floor(tiles.length / 32),
    paletteCount: Math.ceil(palette.length / 32),
    vramBytes: tiles.length + (isSprite ? 0 : (vramMap.length || map.length)),
    warnings: [],
    paletteColors: readPaletteColors(palette),
    compression: {
      policy: PCE_VISUAL_COMPRESSION_NONE,
      tiles: tilesCompression,
      map: mapCompression,
    },
  };
  generated.warnings = uniqueWarnings([...extraWarnings, ...buildImageWarnings(asset, imageSize, generated)]);
  const preview = {
    source: sourceRel,
    kind: isSprite ? 'sprite' : 'background',
    width: imageSize.width || 0,
    height: imageSize.height || 0,
    tileCount: generated.tileCount,
    paletteCount: generated.paletteCount,
    vramBytes: generated.vramBytes,
    compression: generated.compression,
    warnings: generated.warnings,
  };
  ensureDirSync(path.dirname(plan.absFiles.previewAbs));
  fs.writeFileSync(plan.absFiles.previewAbs, JSON.stringify(preview, null, 2), 'utf-8');
  return { ...generated, previewFile: plan.files.previewFile };
}

function readFirstTileIndex(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return null;
  return buffer.readUInt16LE(0) & 0x0fff;
}

function generatedCompressionNeedsRefresh(projectDir, asset, slots = ['tiles']) {
  if (!asset || (asset.type !== 'image' && asset.type !== 'sprite')) return false;
  const generated = asset.data?.generated || {};
  const compression = normalizeGeneratedCompression(generated.compression);
  // RLE removed: an asset only needs regenerating if it still carries a stale RLE
  // codec from older generation, so it gets rewritten as raw (uncompressed).
  return slots.some((slot) => (compression[slot] || {}).codec === PCE_VISUAL_COMPRESSION_RLE);
}

function backgroundGeneratedAssetNeedsRefresh(projectDir, asset) {
  if (!asset || asset.type !== 'image') return false;
  const options = normalizeImageOptions(asset);
  const generated = asset.data?.generated || {};
  const widthTiles = Math.max(1, Math.ceil((options.width || 0) / 8));
  const heightTiles = Math.max(1, Math.ceil((options.height || 0) / 8));
  const expectedMapBytes = widthTiles * heightTiles * 2;
  const expectedVramMapBytes = PCE_BG_MAP_WIDTH_TILES * heightTiles * 2;
  const tiles = readGeneratedBuffer(projectDir, generated.tilesFile);
  const map = readGeneratedBuffer(projectDir, generated.mapFile);
  const vramMap = readGeneratedBuffer(projectDir, generated.mapVramFile);
  const tileBase = options.tileBase & 0x0fff;
  const vramFirstTile = readFirstTileIndex(vramMap);
  const mapFirstTile = readFirstTileIndex(map);

  if (!tiles.length || !map.length || !vramMap.length) return true;
  if (expectedMapBytes && map.length !== expectedMapBytes) return true;
  if (expectedVramMapBytes && vramMap.length !== expectedVramMapBytes) return true;
  if (vramFirstTile !== null && vramFirstTile !== tileBase) return true;
  if (mapFirstTile !== null && mapFirstTile !== tileBase) return true;
  if (generatedCompressionNeedsRefresh(projectDir, asset, ['tiles', 'map'])) return true;
  return false;
}

function spriteGeneratedAssetNeedsRefresh(projectDir, asset) {
  if (!asset || asset.type !== 'sprite') return false;
  const options = normalizeImageOptions(asset);
  const generated = asset.data?.generated || {};
  const patterns = readGeneratedBuffer(projectDir, generated.tilesFile);
  const cellWidth = clampPositiveInt(options.cellWidth, 16, 32, DEFAULT_SPRITE_OPTIONS.cellWidth);
  const cellHeight = clampPositiveInt(options.cellHeight, 16, 64, DEFAULT_SPRITE_OPTIONS.cellHeight);
  const cellColumns = Math.max(1, Math.ceil((options.width || cellWidth) / cellWidth));
  const cellRows = Math.max(1, Math.ceil((options.height || cellHeight) / cellHeight));
  const expectedCells = cellColumns * cellRows;
  const patternsPerCell = spriteHardwarePatternSlots(cellWidth, cellHeight);
  const bytesPerCellBlock = patternsPerCell * 128;
  if (!patterns.length) return true;
  // Patterns are deduplicated by display-cell block. Validate via the cell map:
  // it must cover every display cell, and each entry must point at a real block.
  if (patterns.length % bytesPerCellBlock !== 0) return true;
  const uniqueCells = patterns.length / bytesPerCellBlock;
  const cellMap = readGeneratedBuffer(projectDir, generated.cellMapFile);
  if (!generated.cellMapFile || cellMap.length !== expectedCells) return true;
  for (let i = 0; i < cellMap.length; i += 1) {
    if (cellMap[i] >= uniqueCells) return true;
  }
  if (generatedCompressionNeedsRefresh(projectDir, asset, ['tiles'])) return true;
  return false;
}

function regenerateVisualGeneratedAsset(projectDir, asset) {
  const sourceRel = normalizeAssetSource(asset.source || '');
  if (!sourceRel) return asset;
  const { absPath: sourceAbs } = resolveUnderRoot(projectDir, sourceRel, 'project');
  if (!fs.existsSync(sourceAbs)) return asset;
  const plan = buildInternalPceConversionPlan(projectDir, asset);
  const result = runInternalPceImageConversion(plan, sourceAbs, asset);
  const imageSize = readImageSize(sourceAbs);
  const generated = createGeneratedMetadata(projectDir, asset, plan, sourceRel, imageSize, result.warnings || []);
  return normalizeAsset({
    ...asset,
    data: {
      ...(asset.data || {}),
      generated,
      import: {
        ...(asset.data?.import || {}),
        converter: PCE_INTERNAL_IMAGE_CONVERTER,
        regeneratedAt: new Date().toISOString(),
      },
    },
  });
}

function ensureVisualGeneratedAssets(projectDir, doc) {
  let changed = false;
  doc.assets = (doc.assets || []).map((asset) => {
    if (!backgroundGeneratedAssetNeedsRefresh(projectDir, asset) && !spriteGeneratedAssetNeedsRefresh(projectDir, asset)) return asset;
    const regenerated = regenerateVisualGeneratedAsset(projectDir, asset);
    if (regenerated !== asset) changed = true;
    return regenerated;
  });
  if (changed) writeAssetDocument(projectDir, doc);
  return changed;
}

function importImage(projectDir, payload = {}, options = {}) {
  const kind = payload.kind === 'sprite' || payload.type === 'sprite' ? 'sprite' : 'background';
  const sourceAbs = sourcePathForImport(payload);
  const sourceName = String(payload.sourceFileName || (sourceAbs ? path.basename(sourceAbs) : 'asset.png'));
  const sourceExt = path.extname(sourceName || sourceAbs || '').toLowerCase();
  if (!IMAGE_EXTENSIONS.has(sourceExt)) {
    throw new Error('PNG/BMP/WebP image files are supported');
  }
  if (sourceExt !== '.png' && !payload.convertedDataUrl) {
    throw new Error('BMP/WebP import requires renderer-side PNG conversion before PCE image conversion');
  }
  const id = sanitizeAssetId(payload.id || sourceName, kind === 'sprite' ? 'sprite_asset' : 'bg_asset');
  const assetType = kind === 'sprite' ? 'sprite' : 'image';
  const sourceSubdir = kind === 'sprite' ? 'assets/sprites' : 'assets/images';
  const storedExt = payload.convertedDataUrl ? '.png' : sourceExt;
  const sourceRel = normalizeRelativePath(path.join(sourceSubdir, `${id}${storedExt}`));
  const { absPath: destAbs } = resolveUnderRoot(projectDir, sourceRel, 'project');
  ensureDirSync(path.dirname(destAbs));
  if (payload.convertedDataUrl) {
    const decoded = decodeDataUrl(payload.convertedDataUrl);
    if (decoded.mime && decoded.mime !== 'image/png') {
      throw new Error('converted image must be PNG');
    }
    fs.writeFileSync(destAbs, decoded.buffer);
  } else if (sourceAbs) {
    fs.copyFileSync(sourceAbs, destAbs);
  }
  const imageSize = readImageSize(destAbs);
  const baseAsset = normalizeAsset({
    id,
    type: assetType,
    name: String(payload.name || sourceName.replace(/\.[^.]+$/, '') || id).trim(),
    source: sourceRel,
    options: {
      ...payload.options,
      kind,
      compression: payload.compression ?? payload.options?.compression,
      paletteBank: payload.paletteBank ?? payload.options?.paletteBank,
      tileBase: payload.tileBase ?? payload.options?.tileBase,
      mapBase: payload.mapBase ?? payload.options?.mapBase,
      x: payload.x ?? payload.options?.x,
      y: payload.y ?? payload.options?.y,
      width: payload.width ?? payload.options?.width ?? imageSize.width,
      height: payload.height ?? payload.options?.height ?? imageSize.height,
      cellWidth: payload.cellWidth ?? payload.options?.cellWidth,
      cellHeight: payload.cellHeight ?? payload.options?.cellHeight,
      transparentIndex: payload.transparentIndex ?? payload.options?.transparentIndex,
    },
  });
  const plan = buildInternalPceConversionPlan(projectDir, baseAsset);
  const commandResult = runInternalPceImageConversion(plan, destAbs, baseAsset, options);
  const generated = createGeneratedMetadata(projectDir, baseAsset, plan, sourceRel, imageSize, commandResult.warnings || []);
  const asset = normalizeAsset({
    ...baseAsset,
    data: {
      ...(baseAsset.data || {}),
      generated,
      import: {
        originalFileName: sourceName,
        importedAt: new Date().toISOString(),
        converter: PCE_INTERNAL_IMAGE_CONVERTER,
      },
    },
  });
  const doc = readAssetDocument(projectDir);
  const index = doc.assets.findIndex((entry) => entry.id === asset.id);
  if (index >= 0) doc.assets[index] = asset;
  else doc.assets.push(asset);
  const saved = writeAssetDocument(projectDir, doc);
  return {
    asset,
    assets: saved.assets,
    commandInfo: {
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
      mode: 'internal-pce',
      outputKind: kind,
      dryRun: Boolean(options.dryRun),
    },
    conversion: commandResult,
  };
}

function importAudio(projectDir, payload = {}, options = {}) {
  const kind = payload.kind === 'cdda-track' || payload.type === 'cdda-track' ? 'cdda-track' : 'adpcm';
  const sourceAbs = sourcePathForImport(payload);
  const originalFileName = path.basename(String(payload.originalFileName || payload.sourceFileName || (sourceAbs ? path.basename(sourceAbs) : 'sound.wav')));
  const sourceName = path.basename(String(payload.sourceFileName || originalFileName || 'sound.wav'));
  const sourceExt = path.extname(sourceName || sourceAbs || originalFileName || '').toLowerCase();
  if (!AUDIO_EXTENSIONS.has(sourceExt)) {
    throw new Error('WAV / MP3 audio files are supported');
  }
  if (!payload.dataUrl && sourceExt !== '.wav') {
    throw new Error('MP3 audio must be converted to WAV before import');
  }
  const id = sanitizeAssetId(payload.id || sourceName, kind === 'cdda-track' ? 'cdda_track' : 'adpcm_sample');
  const sourceSubdir = kind === 'cdda-track' ? 'assets/cdda' : 'assets/adpcm';
  const sourceRel = normalizeRelativePath(path.join(sourceSubdir, `${id}.wav`));
  const { absPath: destAbs } = resolveUnderRoot(projectDir, sourceRel, 'project');

  ensureDirSync(path.dirname(destAbs));
  if (payload.dataUrl) {
    const decoded = decodeDataUrl(payload.dataUrl);
    fs.writeFileSync(destAbs, decoded.buffer);
  } else if (sourceAbs) {
    fs.copyFileSync(sourceAbs, destAbs);
  }

  const input = fs.readFileSync(destAbs);
  const importedAt = new Date().toISOString();
  const processing = payload.processing && typeof payload.processing === 'object'
    ? {
        trimStartSec: Number.isFinite(Number(payload.processing.trimStartSec)) ? Number(payload.processing.trimStartSec) : null,
        trimEndSec: Number.isFinite(Number(payload.processing.trimEndSec)) ? Number(payload.processing.trimEndSec) : null,
        normalize: Boolean(payload.processing.normalize),
        volumeDb: Number.isFinite(Number(payload.processing.volumeDb)) ? Number(payload.processing.volumeDb) : 0,
        fadeInSec: Number.isFinite(Number(payload.processing.fadeInSec)) ? Math.max(0, Number(payload.processing.fadeInSec)) : 0,
        fadeOutSec: Number.isFinite(Number(payload.processing.fadeOutSec)) ? Math.max(0, Number(payload.processing.fadeOutSec)) : 0,
        mono: Boolean(payload.processing.mono),
        sampleRate: Number.isFinite(Number(payload.processing.sampleRate)) ? Math.max(0, Math.trunc(Number(payload.processing.sampleRate))) : 0,
        channels: Number.isFinite(Number(payload.processing.channels)) ? Math.max(0, Math.trunc(Number(payload.processing.channels))) : 0,
        skipped: Boolean(payload.processing.skipped),
      }
    : {};
  const doc = readAssetDocument(projectDir);
  let assetsToWrite = [];

  if (kind === 'cdda-track') {
    const outputFile = relativeGeneratedPath(id, 'cdda.wav');
    const previewFile = relativeGeneratedPath(id, 'preview.json');
    const { absPath: outputAbs } = resolveUnderRoot(projectDir, outputFile, 'project');
    const { absPath: previewAbs } = resolveUnderRoot(projectDir, previewFile, 'project');
    ensureDirSync(path.dirname(outputAbs));
    const converted = audioConverter.convertWavForCdda(input);
    fs.writeFileSync(outputAbs, converted.output);
    fs.writeFileSync(previewAbs, JSON.stringify({
      source: sourceRel,
      kind,
      sampleRate: converted.sampleRate,
      channels: converted.channels,
      durationSeconds: converted.durationSeconds,
      bytes: converted.output.length,
      waveform: converted.waveform,
      warnings: converted.warnings,
      processing,
    }, null, 2), 'utf-8');
    const baseOptions = normalizeCddaOptions({
      type: kind,
      options: {
        ...payload.options,
        track: payload.track ?? payload.options?.track,
        loop: payload.loop ?? payload.options?.loop,
      },
    });
    assetsToWrite = [normalizeAsset({
      id,
      type: kind,
      name: String(payload.name || originalFileName.replace(/\.[^.]+$/, '') || id).trim(),
      source: sourceRel,
      options: baseOptions,
      data: {
        generated: {
          outputFile,
          previewFile,
          byteLength: converted.output.length,
          sampleRate: converted.sampleRate,
          channels: converted.channels,
          durationSeconds: converted.durationSeconds,
          waveform: converted.waveform,
          warnings: converted.warnings,
        },
        import: {
          originalFileName,
          importedAt,
          converter: 'Internal WAV/CD-DA normalizer',
          processing,
        },
      },
    })];
  } else {
    const baseOptions = normalizeAdpcmOptions({
      type: kind,
      options: {
        ...payload.options,
        sampleRate: payload.sampleRate ?? payload.options?.sampleRate,
        loop: payload.loop ?? payload.options?.loop,
        stream: payload.stream ?? payload.streaming ?? payload.options?.stream ?? payload.options?.streaming,
        adpcmAddress: payload.adpcmAddress ?? payload.options?.adpcmAddress,
        divider: payload.divider ?? payload.options?.divider,
      },
    });
    const maxAdpcmBytes = baseOptions.stream
      ? 0x7ffffff
      : Math.max(1, Math.min(65535, 65536 - baseOptions.adpcmAddress));
    const splitPolicy = payload.splitPolicy === 'auto' && !baseOptions.stream ? 'auto' : '';
    const converted = splitPolicy === 'auto'
      ? audioConverter.convertWavForAdpcmParts(input, { sampleRate: baseOptions.sampleRate, maxBytes: maxAdpcmBytes })
      : audioConverter.convertWavForAdpcm(input, { sampleRate: baseOptions.sampleRate });
    const parts = splitPolicy === 'auto'
      ? converted.parts
      : [{
        output: converted.output,
        codec: converted.codec,
        encoderVersion: converted.encoderVersion,
        nibbleOrder: converted.nibbleOrder,
        sampleRate: converted.sampleRate,
          channels: converted.channels,
          durationSeconds: converted.durationSeconds,
          waveform: converted.waveform,
        }];
    const partCount = parts.length;
    assetsToWrite = parts.map((part, partIndex) => {
      const assetId = partCount > 1 ? `${id}_part${String(partIndex + 1).padStart(2, '0')}` : id;
      const outputFile = relativeGeneratedPath(assetId, 'adpcm.bin');
      const previewFile = relativeGeneratedPath(assetId, 'preview.json');
      const { absPath: outputAbs } = resolveUnderRoot(projectDir, outputFile, 'project');
      const { absPath: previewAbs } = resolveUnderRoot(projectDir, previewFile, 'project');
      const warnings = [
        ...(converted.warnings || []),
        ...(!baseOptions.stream && part.output.length > maxAdpcmBytes ? [`ADPCM: ${part.output.length} bytes exceeds runtime-safe limit ${maxAdpcmBytes}`] : []),
      ];
      ensureDirSync(path.dirname(outputAbs));
      fs.writeFileSync(outputAbs, part.output);
      fs.writeFileSync(previewAbs, JSON.stringify({
        source: sourceRel,
        kind,
        sampleRate: part.sampleRate,
        channels: part.channels,
        durationSeconds: part.durationSeconds,
        bytes: part.output.length,
        codec: part.codec || PCE_ADPCM_CODEC,
        encoderVersion: part.encoderVersion || PCE_ADPCM_ENCODER_VERSION,
        nibbleOrder: part.nibbleOrder || PCE_ADPCM_NIBBLE_ORDER,
        waveform: part.waveform,
        warnings,
        processing,
        groupId: id,
        partIndex: partIndex + 1,
        partCount,
        splitPolicy,
        maxAdpcmBytes,
      }, null, 2), 'utf-8');
      return normalizeAsset({
        id: assetId,
        type: kind,
        name: partCount > 1
          ? `${String(payload.name || originalFileName.replace(/\.[^.]+$/, '') || id).trim()} ${partIndex + 1}/${partCount}`
          : String(payload.name || originalFileName.replace(/\.[^.]+$/, '') || id).trim(),
        source: sourceRel,
        options: { ...baseOptions, sampleRate: part.sampleRate },
        data: {
          generated: {
            outputFile,
            previewFile,
            byteLength: part.output.length,
            sampleRate: part.sampleRate,
            channels: part.channels,
            durationSeconds: part.durationSeconds,
            codec: part.codec || PCE_ADPCM_CODEC,
            encoderVersion: part.encoderVersion || PCE_ADPCM_ENCODER_VERSION,
            nibbleOrder: part.nibbleOrder || PCE_ADPCM_NIBBLE_ORDER,
            waveform: part.waveform,
            warnings,
          },
        import: {
          originalFileName,
          importedAt,
          converter: 'Internal WAV/ADPCM encoder',
          encoderVersion: part.encoderVersion || PCE_ADPCM_ENCODER_VERSION,
          processing,
            groupId: id,
            partIndex: partIndex + 1,
            partCount,
            splitPolicy,
            maxAdpcmBytes,
          },
        },
      });
    });
  }

  const groupId = id;
  doc.assets = doc.assets.filter((entry) => {
    if (entry.id === id) return false;
    if (entry.data?.import?.groupId === groupId) return false;
    return true;
  });
  for (const asset of assetsToWrite) {
    const index = doc.assets.findIndex((entry) => entry.id === asset.id);
    if (index >= 0) doc.assets[index] = asset;
    else doc.assets.push(asset);
  }
  const saved = writeAssetDocument(projectDir, doc);
  const asset = assetsToWrite[0];
  return {
    asset,
    assets: saved.assets,
    conversion: {
      ok: true,
      kind,
      outputFile: asset?.data?.generated?.outputFile || '',
      previewFile: asset?.data?.generated?.previewFile || '',
      sampleRate: asset?.data?.generated?.sampleRate || 0,
      channels: asset?.data?.generated?.channels || 0,
      byteLength: asset?.data?.generated?.byteLength || 0,
      partCount: assetsToWrite.length,
      dryRun: Boolean(options.dryRun),
    },
  };
}

function importVgm(projectDir, payload = {}) {
  const sourceAbs = sourcePathForImport(payload);
  if (!sourceAbs) throw new Error('VGM ファイルを選択してください');
  const originalFileName = path.basename(sourceAbs);
  const sourceExt = path.extname(originalFileName).toLowerCase();
  if (!VGM_EXTENSIONS.has(sourceExt)) {
    throw new Error('VGM / VGZ ファイルを選択してください');
  }
  const id = sanitizeAssetId(payload.id || originalFileName, 'psg_track');
  const bpm = clampInt(payload.bpm, 30, 300, DEFAULT_PSG_OPTIONS.bpm);

  const input = fs.readFileSync(sourceAbs);
  const converted = vgmImporter.convertVgmToPsg(input, { bpm });

  const requestedType = String(payload.type || '').trim().toLowerCase();
  const type = requestedType === 'psg-song' || requestedType === 'psg-sfx'
    ? requestedType
    : (converted.isSong ? 'psg-song' : 'psg-sfx');

  // Keep the original VGM/VGZ next to the project for traceability.
  const sourceRel = normalizeRelativePath(path.join('assets/psg', `${id}${sourceExt}`));
  const { absPath: destAbs } = resolveUnderRoot(projectDir, sourceRel, 'project');
  ensureDirSync(path.dirname(destAbs));
  fs.copyFileSync(sourceAbs, destAbs);

  const asset = normalizeAsset({
    id,
    type,
    name: String(payload.name || originalFileName.replace(/\.[^.]+$/, '') || id).trim(),
    source: sourceRel,
    options: {
      kind: type === 'psg-song' ? 'song' : 'sfx',
      bpm: converted.bpm,
      steps: converted.steps,
      channels: converted.channels,
      period: converted.period,
      pattern: converted.pattern,
    },
    data: {
      import: {
        originalFileName,
        importedAt: new Date().toISOString(),
        converter: 'Internal VGM/VGZ -> PSG step importer',
        vgm: converted.stats,
        warnings: converted.warnings,
      },
    },
  });

  const doc = readAssetDocument(projectDir);
  const index = doc.assets.findIndex((entry) => entry.id === asset.id);
  if (index >= 0) doc.assets[index] = asset;
  else doc.assets.push(asset);
  const saved = writeAssetDocument(projectDir, doc);

  return {
    asset,
    assets: saved.assets,
    conversion: {
      ok: true,
      kind: type,
      steps: converted.steps,
      patternCount: converted.pattern.length,
      bpm: converted.bpm,
      isSong: converted.isSong,
      warnings: converted.warnings,
      stats: converted.stats,
    },
  };
}

function midiImportOptionsFromPayload(payload = {}) {
  const nested = payload.midiOptions && typeof payload.midiOptions === 'object'
    ? payload.midiOptions
    : {};
  const raw = { ...nested };
  [
    'maxToneVoices',
    'drumMode',
    'drumVolumeScale',
    'toneVolumeScale',
    'minVelocity',
    'voicePriority',
    'patternDetail',
  ].forEach((key) => {
    if (payload[key] != null && payload[key] !== '') raw[key] = payload[key];
  });
  return typeof midiImporter.normalizeMidiPsgOptions === 'function'
    ? midiImporter.normalizeMidiPsgOptions(raw)
    : raw;
}

function importMidi(projectDir, payload = {}) {
  const sourceAbs = sourcePathForImport(payload);
  if (!sourceAbs) throw new Error('MIDI ファイルを選択してください');
  const originalFileName = path.basename(sourceAbs);
  const sourceExt = path.extname(originalFileName).toLowerCase();
  if (!MIDI_EXTENSIONS.has(sourceExt)) {
    throw new Error('MIDI (.mid / .midi) ファイルを選択してください');
  }
  const id = sanitizeAssetId(payload.id || originalFileName, 'psg_track');
  // Blank/omitted bpm lets the MIDI tempo drive the grid (do not force 150).
  const bpm = payload.bpm != null && payload.bpm !== ''
    ? clampInt(payload.bpm, 30, 300, DEFAULT_PSG_OPTIONS.bpm)
    : undefined;
  const midiOptions = midiImportOptionsFromPayload(payload);

  const input = fs.readFileSync(sourceAbs);
  const converted = midiImporter.convertMidiToPsg(input, { bpm, ...midiOptions });

  const requestedType = String(payload.type || '').trim().toLowerCase();
  // MIDI files are usually tunes, so default the "auto" type to a looping song.
  const type = requestedType === 'psg-song' || requestedType === 'psg-sfx'
    ? requestedType
    : 'psg-song';

  // Keep the original MIDI next to the project for traceability.
  const sourceRel = normalizeRelativePath(path.join('assets/psg', `${id}${sourceExt}`));
  const { absPath: destAbs } = resolveUnderRoot(projectDir, sourceRel, 'project');
  ensureDirSync(path.dirname(destAbs));
  fs.copyFileSync(sourceAbs, destAbs);

  const asset = normalizeAsset({
    id,
    type,
    name: String(payload.name || originalFileName.replace(/\.[^.]+$/, '') || id).trim(),
    source: sourceRel,
    options: {
      kind: type === 'psg-song' ? 'song' : 'sfx',
      bpm: converted.bpm,
      steps: converted.steps,
      channels: converted.channels,
      period: converted.period,
      pattern: converted.pattern,
    },
    data: {
      import: {
        originalFileName,
        importedAt: new Date().toISOString(),
        converter: 'Internal MIDI -> PSG step importer',
        midi: converted.stats,
        midiOptions: converted.stats?.midiOptions || midiOptions,
        warnings: converted.warnings,
      },
    },
  });

  const doc = readAssetDocument(projectDir);
  const index = doc.assets.findIndex((entry) => entry.id === asset.id);
  if (index >= 0) doc.assets[index] = asset;
  else doc.assets.push(asset);
  const saved = writeAssetDocument(projectDir, doc);

  return {
    asset,
    assets: saved.assets,
    conversion: {
      ok: true,
      kind: type,
      steps: converted.steps,
      patternCount: converted.pattern.length,
      bpm: converted.bpm,
      isSong: converted.isSong,
      warnings: converted.warnings,
      stats: converted.stats,
    },
  };
}

function previewMidi(projectDir, payload = {}) {
  const sourceAbs = sourcePathForImport(payload);
  if (!sourceAbs) throw new Error('MIDI ファイルを選択してください');
  const originalFileName = path.basename(sourceAbs);
  const sourceExt = path.extname(originalFileName).toLowerCase();
  if (!MIDI_EXTENSIONS.has(sourceExt)) {
    throw new Error('MIDI (.mid / .midi) ファイルを選択してください');
  }
  const bpm = payload.bpm != null && payload.bpm !== ''
    ? clampInt(payload.bpm, 30, 300, DEFAULT_PSG_OPTIONS.bpm)
    : undefined;
  const requestedType = payload.type || payload.assetType || '';
  const type = requestedType === 'psg-sfx' ? 'psg-sfx' : 'psg-song';
  const midiOptions = midiImportOptionsFromPayload(payload);
  const converted = midiImporter.convertMidiToPsg(fs.readFileSync(sourceAbs), { bpm, ...midiOptions });
  return {
    preview: {
      type,
      options: {
        kind: type === 'psg-song' ? 'song' : 'sfx',
        bpm: converted.bpm,
        steps: converted.steps,
        channels: converted.channels,
        period: converted.period,
        pattern: converted.pattern,
      },
    },
    conversion: {
      ok: true,
      kind: type,
      steps: converted.steps,
      patternCount: converted.pattern.length,
      bpm: converted.bpm,
      isSong: converted.isSong,
      warnings: converted.warnings,
      stats: converted.stats,
    },
  };
}

function previewSource(projectDir, relativePath = '') {
  if (!relativePath) throw new Error('asset source is required');
  const { absPath } = resolveUnderRoot(projectDir, relativePath, 'project');
  if (!fs.existsSync(absPath)) throw new Error('asset source not found');
  const data = fs.readFileSync(absPath).toString('base64');
  return {
    dataUrl: `data:${getMimeForPath(absPath)};base64,${data}`,
    mime: getMimeForPath(absPath),
    size: fs.statSync(absPath).size,
  };
}

function generateTextMosaicForImage(projectDir, asset) {
  const { absPath } = resolveAssetSource(projectDir, asset);
  if (!absPath || !fs.existsSync(absPath)) {
    return ['IMAGE FILE MISSING'];
  }
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.json' || ext === '.pceimg') {
    const image = readPceImageJson(absPath);
    return image.pixels.map((row) => row.map((value) => (value ? '#' : '.')).join(''));
  }
  return [`PNG:${path.basename(absPath)}`, 'Converted assets are', 'listed on screen.'];
}

function toCIdentifier(value) {
  const ident = String(value || 'asset').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^([0-9])/, '_$1');
  return ident || 'asset';
}

function bufferToCArray(name, buffer, section = 'PCE_EDITOR_RODATA_SECTION') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return [];
  const lines = [`static const unsigned char ${name}[] ${section} = {`];
  for (let i = 0; i < buffer.length; i += 12) {
    const chunk = Array.from(buffer.subarray(i, i + 12)).map((value) => `0x${value.toString(16).padStart(2, '0')}`);
    lines.push(`  ${chunk.join(', ')}${i + 12 < buffer.length ? ',' : ''}`);
  }
  lines.push('};');
  return lines;
}

function createRomBankAllocator() {
  return {
    kind: 'rom',
    nextBank: 1,
    maxBank: 127,
    sectionPrefix: 'rom_bank',
    banks: [],
  };
}

function createCdRamBankAllocator() {
  return {
    kind: 'ram',
    nextBank: 130,
    maxBank: 131,
    sectionPrefix: 'ram_bank',
    banks: [],
  };
}

function allocateAssetBank(allocator) {
  if (!allocator) throw new Error('ROM bank allocator is required');
  if (allocator.nextBank > allocator.maxBank) {
    throw new Error(allocator.kind === 'ram'
      ? 'PCE-CD banked asset data exceeds reserved fallback RAM banks 130-131'
      : 'PCE HuCard banked asset data exceeds 127 ROM banks');
  }
  const bank = allocator.nextBank;
  allocator.nextBank += 1;
  allocator.banks.push(bank);
  return bank;
}

function bufferToBankedCArray(name, buffer, allocator) {
  const lines = [];
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += ROM_BANKED_CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, Math.min(offset + ROM_BANKED_CHUNK_SIZE, buffer.length));
    const bank = allocateAssetBank(allocator);
    const chunkName = `${name}_bank${bank}`;
    lines.push(`static const unsigned char PCE_EDITOR_BANKED_SECTION(".${allocator.sectionPrefix}${bank}") ${chunkName}[] = {`);
    for (let i = 0; i < chunk.length; i += 12) {
      const row = Array.from(chunk.subarray(i, i + 12)).map((value) => `0x${value.toString(16).padStart(2, '0')}`);
      lines.push(`  ${row.join(', ')}${i + 12 < chunk.length ? ',' : ''}`);
    }
    lines.push('};');
    lines.push('');
    chunks.push({ bank, name: chunkName, size: chunk.length });
  }
  if (chunks.length) {
    lines.push(`static const pce_editor_data_chunk_t ${name}_chunks[] PCE_EDITOR_RODATA_SECTION = {`);
    chunks.forEach((chunk, index) => {
      lines.push(`  { ${chunk.bank}u, ${chunk.name}, ${chunk.size}u }${index + 1 < chunks.length ? ',' : ''}`);
    });
    lines.push('};');
  }
  return {
    lines,
    chunksName: chunks.length ? `${name}_chunks` : '(const pce_editor_data_chunk_t *)0',
    chunkCount: chunks.length,
  };
}

function emitDataRef(name, buffer, allocator, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      lines: [],
      pointer: '(const unsigned char *)0',
      size: 0,
      chunks: '(const pce_editor_data_chunk_t *)0',
      chunkCount: 0,
      cd: '(const pce_editor_cd_data_ref_t *)0',
    };
  }
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : BANKED_DATA_THRESHOLD;
  if (options.allowBanking !== false && buffer.length > threshold) {
    const banked = bufferToBankedCArray(name, buffer, allocator);
    return {
      lines: banked.lines,
      pointer: '(const unsigned char *)0',
      size: buffer.length,
      chunks: banked.chunksName,
      chunkCount: banked.chunkCount,
      cd: '(const pce_editor_cd_data_ref_t *)0',
    };
  }
  return {
    lines: bufferToCArray(name, buffer),
    pointer: name,
    size: buffer.length,
    chunks: '(const pce_editor_data_chunk_t *)0',
    chunkCount: 0,
    cd: '(const pce_editor_cd_data_ref_t *)0',
  };
}

function emitCdFileRef(name, buffer, relativePath = '', options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || !relativePath) {
    return emitDataRef(name, buffer, null, { allowBanking: false });
  }
  const layout = options.cdLayout?.get(normalizeRelativePath(relativePath));
  const sector = layout?.sector || 0;
  const sectorCount = layout?.sectorCount || Math.ceil(buffer.length / CD_SECTOR_BYTES);
  const byteSize = clampInt(options.byteSize ?? buffer.length, 0, 0x7fffffff, buffer.length);
  const uncompressedSize = clampInt(options.uncompressedSize ?? buffer.length, 0, 0x7fffffff, buffer.length);
  const compression = normalizeVisualCompression(options.compression, PCE_VISUAL_COMPRESSION_NONE) === PCE_VISUAL_COMPRESSION_RLE
    ? PCE_EDITOR_CD_COMPRESSION_RLE
    : PCE_EDITOR_CD_COMPRESSION_NONE;
  const cdRefName = `${name}_cd`;
  return {
    lines: [
      '#if defined(__PCE_CD__)',
      `static const pce_editor_cd_data_ref_t ${cdRefName} PCE_EDITOR_CD_REF_SECTION = { { ${(sector & 0xff)}u, ${((sector >> 8) & 0xff)}u, ${((sector >> 16) & 0xff)}u }, ${sectorCount}u, ${byteSize}u, ${compression}u };`,
      '#endif',
    ],
    pointer: '(const unsigned char *)0',
    size: uncompressedSize,
    chunks: '(const pce_editor_data_chunk_t *)0',
    chunkCount: 0,
    cd: `&${cdRefName}`,
  };
}

function dataRefLiteral(ref) {
  return `{ ${ref.pointer}, ${ref.size}u, ${ref.chunks}, ${ref.chunkCount}u, ${ref.cd || '(const pce_editor_cd_data_ref_t *)0'} }`;
}

function readGeneratedBuffer(projectDir, relativePath) {
  if (!relativePath) return Buffer.alloc(0);
  try {
    const { absPath } = resolveUnderRoot(projectDir, relativePath, 'project');
    return fs.existsSync(absPath) ? fs.readFileSync(absPath) : Buffer.alloc(0);
  } catch (_err) {
    return Buffer.alloc(0);
  }
}

function generatedCompressionEntry(generated = {}, slot = 'tiles') {
  const compression = normalizeGeneratedCompression(generated.compression);
  return slot === 'map' ? compression.map : compression.tiles;
}

// RLE removed: always ship the raw tile/map/pattern buffer on CD. Any stale RLE
// codec/sidecar left in older generated metadata is ignored, so existing projects
// build correctly against the raw-only runtime without forcing a regenerate.
function generatedCdPayload(projectDir, generated = {}, slot = 'tiles') {
  const rawPath = slot === 'map' ? generated.mapVramFile : generated.tilesFile;
  const raw = readGeneratedBuffer(projectDir, rawPath);
  return {
    buffer: raw,
    relativePath: rawPath,
    uncompressedSize: raw.length,
    byteSize: raw.length,
    compression: PCE_VISUAL_COMPRESSION_NONE,
  };
}

function cPointer(name, buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 0 ? name : '(const unsigned char *)0';
}

function numeric(value, min, max, fallback = 0) {
  return clampInt(value, min, max, fallback);
}

function generateConvertedAssetArrays(projectDir, assets, type, bankAllocator, generationOptions = {}) {
  const isSprite = type === 'sprite';
  const useCdFiles = generationOptions.targetsCd && generationOptions.useCdDataFiles;
  const converted = assets.filter((asset) => asset.type === type && asset.data?.generated);
  const arrayLines = [];
  const metaLines = [];
  const drawMetaLines = [];
  converted.forEach((asset, index) => {
    const ident = toCIdentifier(`pce_editor_${type}_${asset.id}`);
    const generated = asset.data.generated || {};
    const palette = readGeneratedBuffer(projectDir, generated.paletteFile);
    const cellMap = isSprite ? readGeneratedBuffer(projectDir, generated.cellMapFile) : Buffer.alloc(0);
    const tilesPayload = useCdFiles
      ? generatedCdPayload(projectDir, generated, 'tiles')
      : { buffer: readGeneratedBuffer(projectDir, generated.tilesFile), relativePath: generated.tilesFile, uncompressedSize: 0, byteSize: 0, compression: PCE_VISUAL_COMPRESSION_NONE };
    const tiles = tilesPayload.buffer;
    const mapFile = useCdFiles && !isSprite && generated.mapVramFile ? generated.mapVramFile : generated.mapFile;
    const mapPayload = useCdFiles && !isSprite && generated.mapVramFile
      ? generatedCdPayload(projectDir, generated, 'map')
      : { buffer: isSprite ? Buffer.alloc(0) : readGeneratedBuffer(projectDir, mapFile), relativePath: mapFile, uncompressedSize: 0, byteSize: 0, compression: PCE_VISUAL_COMPRESSION_NONE };
    const map = mapPayload.buffer;
    const paletteRef = emitDataRef(`${ident}_palette`, palette, bankAllocator, { threshold: Number.MAX_SAFE_INTEGER, allowBanking: generationOptions.allowBanking });
    const tilesRef = useCdFiles
      ? emitCdFileRef(`${ident}_${isSprite ? 'patterns' : 'tiles'}`, tiles, tilesPayload.relativePath, {
          cdLayout: generationOptions.cdLayout,
          uncompressedSize: tilesPayload.uncompressedSize,
          byteSize: tilesPayload.byteSize,
          compression: tilesPayload.compression,
        })
      : emitDataRef(`${ident}_${isSprite ? 'patterns' : 'tiles'}`, tiles, bankAllocator, { allowBanking: generationOptions.allowBanking });
    const mapRef = isSprite
      ? emitDataRef(`${ident}_map`, map, bankAllocator, { allowBanking: generationOptions.allowBanking })
      : (useCdFiles && generated.mapVramFile
          ? emitCdFileRef(`${ident}_map`, map, mapPayload.relativePath, {
              cdLayout: generationOptions.cdLayout,
              uncompressedSize: mapPayload.uncompressedSize,
              byteSize: mapPayload.byteSize,
              compression: mapPayload.compression,
            })
          : emitDataRef(`${ident}_map`, map, bankAllocator, { allowBanking: generationOptions.allowBanking }));
    const cellMapName = `${ident}_cellmap`;
    const cellMapSection = generationOptions.targetsCd ? 'PCE_EDITOR_CD_REF_SECTION' : 'PCE_EDITOR_RODATA_SECTION';
    const cellMapLines = isSprite ? bufferToCArray(cellMapName, cellMap, cellMapSection) : [];
    arrayLines.push(...paletteRef.lines);
    arrayLines.push(...tilesRef.lines);
    if (isSprite) arrayLines.push(...cellMapLines);
    if (!isSprite) arrayLines.push(...mapRef.lines);
    if (arrayLines[arrayLines.length - 1] !== '') arrayLines.push('');
    const options = normalizeImageOptions(asset);
    if (isSprite) {
      const cellWidth = numeric(options.cellWidth, 16, 32, 16);
      const cellHeight = numeric(options.cellHeight, 16, 64, 16);
      const cellColumns = Math.max(1, Math.ceil(numeric(options.width, 0, 1024, cellWidth) / cellWidth));
      const cellRows = Math.max(1, Math.ceil(numeric(options.height, 0, 1024, cellHeight) / cellHeight));
      const patternBase = numeric(options.tileBase, 0, 2047, 704);
      const paletteBank = numeric(options.paletteBank, 0, 15, 0);
      // Hard error (not just a warning) when the deduplicated sprite patterns
      // still overrun the SATB VRAM area: shipping this silently corrupts the
      // sprite attribute table and the VN message/glyph VRAM below it.
      const patternWords = Math.ceil(tiles.length / 2);
      if (patternWords && (patternBase * 32) + patternWords > PCE_SATB_VRAM_WORD) {
        throw new Error(`Sprite "${asset.id}" patterns (${patternWords} words from VRAM word ${patternBase * 32}) overrun the SATB at 0x${PCE_SATB_VRAM_WORD.toString(16)}. Lower the sprite tileBase or reduce the sheet (unique cells: ${Math.floor(tiles.length / 128)}).`);
      }
      const cellMapPointer = (isSprite && cellMap.length) ? cellMapName : '(const unsigned char *)0';
      metaLines.push(`  { ${dataRefLiteral(paletteRef)}, ${dataRefLiteral(tilesRef)}, ${cellWidth}u, ${cellHeight}u, ${cellColumns}u, ${cellRows}u, ${patternBase}u, ${paletteBank}u, ${numeric(options.x, 0, 255, 144)}u, ${numeric(options.y, 0, 255, 104)}u, ${cellMapPointer} }${index + 1 < converted.length ? ',' : ''}`);
      drawMetaLines.push(`  { ${cellWidth}u, ${cellHeight}u, ${cellColumns}u, ${cellRows}u, ${patternBase}u, ${paletteBank}u }${index + 1 < converted.length ? ',' : ''}`);
    } else {
      const widthTiles = Math.max(1, Math.ceil(numeric(options.width, 0, 1024, 0) / 8));
      const heightTiles = Math.max(1, Math.ceil(numeric(options.height, 0, 1024, 0) / 8));
      metaLines.push(`  { ${dataRefLiteral(paletteRef)}, ${dataRefLiteral(tilesRef)}, ${dataRefLiteral(mapRef)}, ${widthTiles}u, ${heightTiles}u, ${numeric(options.tileBase, 0, 2047, 32)}u, ${numeric(options.mapBase, 0, 2047, 0)}u, ${numeric(options.paletteBank, 0, 15, 0)}u }${index + 1 < converted.length ? ',' : ''}`);
    }
  });
  return { converted, arrayLines, metaLines, drawMetaLines };
}

function projectTargetsCd(projectDir) {
  try {
    const configPath = path.join(projectDir, 'project.json');
    if (!fs.existsSync(configPath)) return false;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return String(config.targetMedia || config.media || '').trim().toLowerCase() === 'cd';
  } catch (_) {
    return false;
  }
}

function cdRamBankOffset(bank) {
  if (bank === 129) return 3;
  if (bank === 130) return 4;
  if (bank === 131) return 5;
  return 6;
}

function firstPsgPeriod(asset) {
  const pattern = asset?.options?.pattern;
  if (Array.isArray(pattern)) {
    // Skip noise entries: their "period" field holds a 5-bit noise frequency.
    const note = pattern.find((entry) => entry && Number(entry.period) > 0 && !Number(entry.noise));
    if (note) return clampInt(note.period, 1, 4095, 512);
  }
  return clampInt(asset?.options?.period, 1, 4095, 512);
}

function normalizePsgPatternEntries(asset, options) {
  const pattern = Array.isArray(options.pattern) ? options.pattern : [];
  // Per-asset master volume (0-100%) scales every step amplitude at build time so
  // the same control works for designer SFX and imported songs alike.
  const volumeScale = clampInt(options.volume, 0, 100, 100);
  return pattern.slice(0, PCE_PSG_MAX_PATTERN_ENTRIES).map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry : {};
    const baseVolume = clampInt(raw.volume, 0, 31, 16);
    return {
      step: clampInt(raw.step ?? index, 0, PCE_PSG_MAX_STEPS - 1, index),
      channel: clampInt(raw.channel, 0, 5, 0),
      period: clampInt(raw.period, 1, 4095, options.period),
      volume: clampInt(Math.round((baseVolume * volumeScale) / 100), 0, 31, baseVolume),
      noise: clampInt(raw.noise, 0, 1, 0),
    };
  });
}

// PSG step patterns up to this many serialized bytes stay resident (.rodata)
// for instant SFX playback; larger ones (imported PSG/VGM/MIDI songs) stream
// from CD into RAM bank134 only while playing, so they never sit in the scarce
// resident banks. 8 bytes/step keeps CD-streamed records aligned to the 8KB
// bank134/bank135 split used by the VN runtime.
const PSG_PATTERN_CD_THRESHOLD_BYTES = 256;

function serializePsgPattern(pattern) {
  const buffer = Buffer.alloc(pattern.length * PCE_PSG_SERIALIZED_STEP_BYTES);
  pattern.forEach((step, index) => {
    const offset = index * PCE_PSG_SERIALIZED_STEP_BYTES;
    buffer.writeUInt16LE(step.step & 0xffff, offset);
    buffer[offset + 2] = step.channel & 0xff;
    buffer.writeUInt16LE(step.period & 0xffff, offset + 3);
    buffer[offset + 5] = step.volume & 0xff;
    buffer[offset + 6] = step.noise & 0xff;
    buffer[offset + 7] = 0;
  });
  return buffer;
}

function psgPatternFile(asset) {
  return normalizeRelativePath(path.join('assets/generated/psg', `${toCIdentifier(asset.id)}.bin`));
}

function psgPatternBytes(asset) {
  const options = normalizePsgOptions(asset);
  return serializePsgPattern(normalizePsgPatternEntries(asset, options));
}

// True when this asset's pattern streams from CD (CD builds only). Catalog mode
// intentionally streams even tiny SFX so hundreds of PSG assets do not create
// hundreds of resident .rodata pattern arrays.
function psgAssetStreamsFromCd(asset, targetsCd, options = {}) {
  if (!targetsCd) return false;
  if (options.catalogMode) return true;
  return psgPatternBytes(asset).length > PSG_PATTERN_CD_THRESHOLD_BYTES;
}

// Write the CD data file for every streamed PSG pattern before the CD layout is
// computed, so each lands on the ISO with a stable sector (mirrors how ADPCM /
// BG / sprite payloads are written before collectCdDataFiles/buildCdDataLayout).
function ensurePsgPatternFiles(projectDir, doc) {
  if (!projectTargetsCd(projectDir)) return;
  const catalogMode = assetMetaShouldUseCd(projectDir, doc);
  (doc.assets || []).forEach((asset) => {
    if (asset.type !== 'psg-song' && asset.type !== 'psg-sfx') return;
    if (!psgAssetStreamsFromCd(asset, true, { catalogMode })) return;
    const bytes = psgPatternBytes(asset);
    if (!bytes.length) return;
    const { absPath } = resolveUnderRoot(projectDir, psgPatternFile(asset), 'project');
    ensureDirSync(path.dirname(absPath));
    fs.writeFileSync(absPath, bytes);
  });
}

function generatePsgMetadata(projectDir, assets, generationOptions = {}) {
  const targetsCd = Boolean(generationOptions.targetsCd);
  const catalogMode = Boolean(generationOptions.catalogMode);
  const psgAssets = assets.filter((asset) => asset.type === 'psg-song' || asset.type === 'psg-sfx');
  const arrayLines = [];
  const metaLines = psgAssets.map((asset, index) => {
    const options = normalizePsgOptions(asset);
    const pattern = normalizePsgPatternEntries(asset, options);
    const ident = toCIdentifier(`pce_editor_psg_${asset.id}`);
    const last = index + 1 >= psgAssets.length;
    let patternPtr = '(const pce_editor_psg_step_t *)0';
    let patternCd = '(const pce_editor_cd_data_ref_t *)0';
    if (catalogMode) {
      return `  { ${asset.type === 'psg-song' ? '1u' : '0u'}, ${firstPsgPeriod(asset)}u, ${options.bpm}u, ${options.steps}u, (const pce_editor_psg_step_t *)0, ${pattern.length}u, (const pce_editor_cd_data_ref_t *)0 }${last ? '' : ','}`;
    }
    if (pattern.length && psgAssetStreamsFromCd(asset, targetsCd)) {
      const ref = emitCdFileRef(`${ident}_pattern`, serializePsgPattern(pattern), psgPatternFile(asset), {
        cdLayout: generationOptions.cdLayout,
      });
      arrayLines.push(...ref.lines);
      patternCd = ref.cd;
    } else if (pattern.length) {
      arrayLines.push(`static const pce_editor_psg_step_t ${ident}_pattern[] PCE_EDITOR_RODATA_SECTION = {`);
      pattern.forEach((step, stepIndex) => {
        arrayLines.push(`  { ${step.step}u, ${step.channel}u, ${step.period}u, ${step.volume}u, ${step.noise}u, 0u }${stepIndex + 1 < pattern.length ? ',' : ''}`);
      });
      arrayLines.push('};');
      arrayLines.push('');
      patternPtr = `${ident}_pattern`;
    }
    return `  { ${asset.type === 'psg-song' ? '1u' : '0u'}, ${firstPsgPeriod(asset)}u, ${options.bpm}u, ${options.steps}u, ${patternPtr}, ${pattern.length}u, ${patternCd} }${last ? '' : ','}`;
  });
  return { psgAssets, arrayLines, metaLines };
}

function generateAdpcmMetadata(projectDir, assets, generationOptions = {}) {
  const adpcmAssets = assets.filter((asset) => asset.type === 'adpcm');
  const arrayLines = [];
  const metaLines = [];
  adpcmAssets.forEach((asset, index) => {
    const ident = toCIdentifier(`pce_editor_adpcm_${asset.id}`);
    const generated = asset.data?.generated || {};
    const data = readGeneratedBuffer(projectDir, generated.outputFile);
    const dataRef = generationOptions.targetsCd
      ? emitCdFileRef(`${ident}_data`, data, generated.outputFile, { cdLayout: generationOptions.cdLayout })
      : emitDataRef(`${ident}_data`, data, null, { allowBanking: false });
    arrayLines.push(...dataRef.lines);
    if (arrayLines[arrayLines.length - 1] !== '') arrayLines.push('');
    const options = normalizeAdpcmOptions(asset);
    metaLines.push(`  { ${dataRef.pointer}, ${data.length}ul, ${options.sampleRate}u, ${options.adpcmAddress}u, ${options.divider}u, ${options.loop ? '1u' : '0u'}, ${options.stream ? '1u' : '0u'}, ${dataRef.cd} }${index + 1 < adpcmAssets.length ? ',' : ''}`);
  });
  return { adpcmAssets, arrayLines, metaLines };
}

function sectorToGeneratedSector(sector) {
  const value = Math.max(0, Math.trunc(Number(sector) || 0));
  return {
    lo: value & 0xff,
    md: (value >> 8) & 0xff,
    hi: (value >> 16) & 0xff,
  };
}

function sectorToCInitializer(sector) {
  const value = sectorToGeneratedSector(sector);
  return `{ ${value.lo}u, ${value.md}u, ${value.hi}u }`;
}

function sectorToTimeParts(sector) {
  let value = Math.max(0, Math.trunc(Number(sector) || 0) + CD_MSF_LEAD_IN_SECTORS);
  const frame = value % CDDA_SECTORS_PER_SECOND;
  value = Math.floor(value / CDDA_SECTORS_PER_SECOND);
  const second = value % 60;
  const minute = Math.floor(value / 60);
  return { frame, second, minute };
}

function sectorToTimeInitializer(sector) {
  const { frame, second, minute } = sectorToTimeParts(sector);
  return `{ ${frame}u, ${second}u, ${minute}u }`;
}

function readWavAudioInfo(filePath) {
  const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  if (!buffer || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let sampleRate = 0;
  let blockAlign = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) break;
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      sampleRate = buffer.readUInt32LE(dataOffset + 4);
      blockAlign = buffer.readUInt16LE(dataOffset + 12);
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return { sampleRate, blockAlign, dataBytes };
}

function cddaSectorCountForAsset(projectDir, asset) {
  const generated = asset.data?.generated || {};
  const rel = normalizeRelativePath(generated.outputFile || asset.source || '');
  const absPath = rel ? path.join(projectDir, rel) : '';
  const info = absPath ? readWavAudioInfo(absPath) : null;
  if (!info || !info.dataBytes) return 1;
  if (info.sampleRate > 0 && info.blockAlign > 0) {
    const sampleFrames = Math.ceil(info.dataBytes / info.blockAlign);
    return Math.max(1, Math.ceil((sampleFrames * CDDA_SECTORS_PER_SECOND) / info.sampleRate));
  }
  return Math.max(1, Math.ceil(info.dataBytes / 2352));
}

function cdDataEndSector(cdLayout) {
  let sector = CD_DATA_BASE_SECTOR;
  for (const entry of cdLayout?.values?.() || []) {
    sector = Math.max(sector, entry.sector + entry.sectorCount);
  }
  return sector;
}

function buildCddaTrackLayout(projectDir, cddaAssets, cdLayout) {
  const layout = new Map();
  let sector = Math.max(CD_AUDIO_MIN_SECTOR, cdDataEndSector(cdLayout));
  const sorted = [...cddaAssets].sort((a, b) => {
    const aTrack = normalizeCddaOptions(a).track;
    const bTrack = normalizeCddaOptions(b).track;
    return aTrack - bTrack || String(a.id || '').localeCompare(String(b.id || ''), 'ja');
  });
  sorted.forEach((asset) => {
    const sectorCount = cddaSectorCountForAsset(projectDir, asset);
    const nominalFrames = Math.ceil((sectorCount * 60) / CDDA_SECTORS_PER_SECOND);
    layout.set(asset.id, {
      startSector: sector,
      endSector: sector + sectorCount - 1,
      sectorCount,
      playFrames: Math.max(1, nominalFrames - CDDA_PLAYBACK_GUARD_FRAMES),
    });
    sector += sectorCount;
  });
  return layout;
}

function generateCddaMetadata(projectDir, assets, generationOptions = {}) {
  const cddaAssets = assets.filter((asset) => asset.type === 'cdda-track');
  const cddaLayout = generationOptions.targetsCd
    ? buildCddaTrackLayout(projectDir, cddaAssets, generationOptions.cdLayout)
    : new Map();
  const metaLines = cddaAssets.map((asset, index) => {
    const options = normalizeCddaOptions(asset);
    const layout = cddaLayout.get(asset.id) || { startSector: 0, endSector: 0, playFrames: 0 };
    return `  { ${options.track}u, ${options.loop ? '1u' : '0u'}, ${sectorToCInitializer(layout.startSector)}, ${sectorToCInitializer(layout.endSector)}, ${sectorToTimeInitializer(layout.endSector)}, ${layout.playFrames}u }${index + 1 < cddaAssets.length ? ',' : ''}`;
  });
  return { cddaAssets, metaLines };
}

// === Asset metadata CD on-demand layout =====================================
// Per-asset TOC (palette + descriptor struct + cd refs + sprite cell_map) used
// to scale resident RAM (bank128 .rodata / bank132 cd refs) with asset count and
// overflow the link. For CD builds we serialize that metadata into a single CD
// data file (ASSET_META_FILE) with fixed-size, sector-aligned record slots so the
// runtime can address record N arithmetically and stream it on demand, leaving
// only a tiny constant directory resident. See docs/pce-asset-meta-cd-ondemand.md.
const ASSET_META_FILE = path.join('assets', 'generated', 'meta', 'asset_meta.bin');
// Record slots hold a packed image of the in-memory descriptor struct (so the
// runtime decodes with a single memcpy) plus an appendix for the palette and CD
// refs. The offsets below mirror the packed struct layout (1-byte alignment,
// little-endian) and are locked by _Static_assert in the runtime.
const META_BG_SLOT = 128;
const META_SPRITE_SLOT = 512;
const META_ADPCM_SLOT = 32;
const META_PSG_SLOT = 32;
const META_CDDA_SLOT = 32;
const META_CELL_MAP_MAX = 384; // inline cell_map cap; must match runtime VN_META_CELL_MAP_MAX
// Struct-image field offsets (packed pce_editor_*_asset_t).
const META_BG_TILES_SIZE = 11;   // tiles.size
const META_BG_MAP_SIZE = 20;     // map.size
const META_BG_PALETTE_SIZE = 2;  // palette.size
const META_BG_WIDTH = 27;
const META_BG_HEIGHT = 28;
const META_BG_TILE_BASE = 29;
const META_BG_MAP_BASE = 31;
const META_BG_PALETTE_BANK = 33;
const META_BG_PALETTE_APPENDIX = 34;
const META_BG_TILES_CD = 66;
const META_BG_MAP_CD = 74;
const META_SPR_PALETTE_SIZE = 2;
const META_SPR_PATTERNS_SIZE = 11;
const META_SPR_CELL_WIDTH = 18;
const META_SPR_CELL_HEIGHT = 19;
const META_SPR_CELL_COLUMNS = 20;
const META_SPR_CELL_ROWS = 21;
const META_SPR_PATTERN_BASE = 22;
const META_SPR_PALETTE_BANK = 24;
const META_SPR_X = 25;
const META_SPR_Y = 26;
const META_SPR_PALETTE_APPENDIX = 29;
const META_SPR_PATTERNS_CD = 61;
const META_SPR_CELL_MAP_LEN = 69;
const META_SPR_CELL_MAP = 71; // inline cell_map bytes (was a cd ref to a separate file)
const META_ADPCM_DATA_SIZE = 2;
const META_ADPCM_SAMPLE_RATE = 6;
const META_ADPCM_ADDRESS = 8;
const META_ADPCM_DIVIDER = 10;
const META_ADPCM_LOOP = 11;
const META_ADPCM_STREAM = 12;
const META_ADPCM_CD = 15;
const META_PSG_IS_SONG = 0;
const META_PSG_PERIOD = 1;
const META_PSG_BPM = 3;
const META_PSG_STEPS = 5;
const META_PSG_PATTERN_COUNT = 7;
const META_PSG_PATTERN_CD = 9;
const META_CDDA_TRACK = 0;
const META_CDDA_LOOP = 1;
const META_CDDA_START_SECTOR = 2;
const META_CDDA_END_SECTOR = 5;
const META_CDDA_END_TIME = 8;
const META_CDDA_PLAY_FRAMES = 11;

function metaRegionSectors(count, slot) {
  if (!count) return 0;
  const perSector = Math.floor(CD_SECTOR_BYTES / slot);
  return Math.ceil(count / perSector);
}

function computeAssetMetaLayout(doc) {
  const assets = doc.assets || [];
  const bg = assets.filter((a) => a.type === 'image' && a.data?.generated);
  const sprite = assets.filter((a) => a.type === 'sprite' && a.data?.generated);
  const adpcm = assets.filter((a) => a.type === 'adpcm' && a.data?.generated);
  const psg = assets.filter((a) => a.type === 'psg-song' || a.type === 'psg-sfx');
  const cdda = assets.filter((a) => a.type === 'cdda-track');
  const bgSectors = metaRegionSectors(bg.length, META_BG_SLOT);
  const spriteSectors = metaRegionSectors(sprite.length, META_SPRITE_SLOT);
  const adpcmSectors = metaRegionSectors(adpcm.length, META_ADPCM_SLOT);
  const psgSectors = metaRegionSectors(psg.length, META_PSG_SLOT);
  const cddaSectors = metaRegionSectors(cdda.length, META_CDDA_SLOT);
  const bgOffset = 0;
  const spriteOffset = bgOffset + bgSectors;
  const adpcmOffset = spriteOffset + spriteSectors;
  const psgOffset = adpcmOffset + adpcmSectors;
  const cddaOffset = psgOffset + psgSectors;
  const totalSectors = cddaOffset + cddaSectors;
  return {
    bg, sprite, adpcm, psg, cdda,
    bgSectors, spriteSectors, adpcmSectors, psgSectors, cddaSectors,
    bgOffset, spriteOffset, adpcmOffset, psgOffset, cddaOffset, totalSectors,
    byteSize: Math.max(0, totalSectors) * CD_SECTOR_BYTES,
  };
}

// Moving the per-asset metadata onto CD trades a fixed ~1.4KB of resident accessor
// code (in the already-tight code banks 128/129/130) for O(1) resident bank132
// metadata. So the CD on-demand path engages only once the resident metadata would
// otherwise OVERFLOW bank132; below that we keep the proven resident arrays and the
// accessors get dropped by DCE (zero code cost).
//
// The decision is therefore keyed off the real bank132 init-data budget, not a flat
// asset-meta number: the same bank holds the asset cd_data_refs + sprite cell_maps
// AND the VN-generated data (the scene-pack directory grows with the story). The
// two large fixed runtime buffers were relocated onto the overlay's never-read tail
// (see pce-vn-manager.js / .ram_bank132_tail), so the whole [0xc000, VN_OVERLAY_LMA)
// region is available for this metadata.
//
// BANK132_INIT_BUDGET MUST track VN_OVERLAY_LMA in pce-vn-manager.js
// (VN_OVERLAY_LMA - 0x0184c000). A safety cushion absorbs estimation slack; if the
// estimate is still optimistic the linker reports the overflow and the budget can be
// lowered via PCE_ASSET_META_BUDGET.
const BANK132_INIT_BUDGET = 0x1078;          // 4216 B = VN_OVERLAY_LMA - bank132 base
const BANK132_META_SAFETY = 512;
const META_RESIDENT_BUDGET = BANK132_INIT_BUDGET - BANK132_META_SAFETY; // 3704 B
// Rough per-record resident bank132 sizes; only the magnitude matters for the switch.
const META_CD_REF_BYTES = 8;                 // pce_editor_cd_data_ref_t / pce_vn_cd_data_ref_t
const META_SCENE_PACK_BYTES = 9;             // pce_vn_scene_pack_t directory entry
const META_VN_BASE_BYTES = 160;              // sprite anims + variables + font/overlay refs + counts
const META_BANK128_ACCESSOR_COST_ESTIMATE = 1536;
const META_CATALOG_COUNT_THRESHOLD = 32;
const META_PSG_RESIDENT_PATTERN_BUDGET = 512;

// The budget is tunable via PCE_ASSET_META_BUDGET (bytes): lower it to offload
// metadata to CD sooner, raise it to keep more resident. Read per-call so callers
// (and tests) can force either mode deterministically. 0 forces CD on demand for
// every CD project; a very large value pins everything resident.
function assetMetaBudget() {
  const env = Number(process.env.PCE_ASSET_META_BUDGET);
  return Number.isFinite(env) && env >= 0 ? env : META_RESIDENT_BUDGET;
}

// Count VN scenes straight from the project file (no require of pce-vn-manager,
// which would be a cycle). The scene-pack directory is resident in bank132 and is
// usually the dominant GROWING contributor, so the on-demand decision must see it.
function readVnSceneCount(projectDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), 'utf-8'));
    return Array.isArray(raw.scenes) ? raw.scenes.length : 0;
  } catch (_) {
    return 0;
  }
}

// Approximate the bytes that would sit resident in bank132 if the asset metadata
// stays resident: asset cd_data_refs + sprite cell_maps (the bank132 portion; the
// descriptor structs and palettes live in bank128 .rodata and are excluded) PLUS
// the VN-generated data (scene-pack directory + a base for anims/variables/font
// refs). When this would exceed the bank132 budget we offload the asset metadata.
function estimateResidentBank132Bytes(projectDir, doc) {
  const layout = computeAssetMetaLayout(doc);
  let bytes = 0;
  bytes += layout.bg.length * (2 * META_CD_REF_BYTES); // tiles + map cd refs
  layout.sprite.forEach((asset) => {
    const cellMap = readGeneratedBuffer(projectDir, asset.data.generated?.cellMapFile);
    bytes += META_CD_REF_BYTES + cellMap.length; // patterns cd ref + inline cell_map
  });
  bytes += layout.adpcm.length * META_CD_REF_BYTES;
  const sceneCount = readVnSceneCount(projectDir);
  if (sceneCount) bytes += sceneCount * META_SCENE_PACK_BYTES + META_VN_BASE_BYTES;
  return bytes;
}

function estimateResidentBank128Bytes(projectDir, doc) {
  const layout = computeAssetMetaLayout(doc);
  let bytes = 0;
  layout.bg.forEach((asset) => {
    const palette = readGeneratedBuffer(projectDir, asset.data.generated?.paletteFile);
    bytes += 40 + Math.min(palette.length, 32); // descriptor + palette payload.
  });
  layout.sprite.forEach((asset) => {
    const palette = readGeneratedBuffer(projectDir, asset.data.generated?.paletteFile);
    bytes += 28 + 8 + Math.min(palette.length, 32); // descriptor + draw_meta + palette.
  });
  bytes += layout.adpcm.length * 28;
  layout.psg.forEach((asset) => {
    const patternBytes = psgPatternBytes(asset).length;
    bytes += 16;
    if (!psgAssetStreamsFromCd(asset, projectTargetsCd(projectDir))) bytes += patternBytes;
  });
  bytes += layout.cdda.length * 13;
  bytes += 10; // five count constants after widening to unsigned int.
  return bytes;
}

function estimateResidentPsgPatternBytes(doc) {
  return (doc.assets || [])
    .filter((asset) => asset.type === 'psg-song' || asset.type === 'psg-sfx')
    .reduce((sum, asset) => (psgAssetStreamsFromCd(asset, true) ? sum : sum + psgPatternBytes(asset).length), 0);
}

function assetMetaDecision(projectDir, doc) {
  const document = doc || readAssetDocument(projectDir);
  if (!projectTargetsCd(projectDir)) {
    return {
      useCd: false,
      reason: 'non-cd-target',
      bank128Bytes: 0,
      bank132Bytes: 0,
      psgPatternBytes: 0,
      maxTypeCount: 0,
      budget: assetMetaBudget(),
    };
  }
  const layout = computeAssetMetaLayout(document);
  const counts = {
    bg: layout.bg.length,
    sprite: layout.sprite.length,
    adpcm: layout.adpcm.length,
    psg: layout.psg.length,
    cdda: layout.cdda.length,
  };
  const maxTypeCount = Math.max(counts.bg, counts.sprite, counts.adpcm, counts.psg);
  const bank132Bytes = estimateResidentBank132Bytes(projectDir, document);
  const bank128Bytes = estimateResidentBank128Bytes(projectDir, document);
  const psgPatternBytesTotal = estimateResidentPsgPatternBytes(document);
  const budget = assetMetaBudget();
  const pressure = Math.max(bank132Bytes, bank128Bytes, psgPatternBytesTotal);
  if (pressure > budget) {
    return { useCd: true, reason: `resident-metadata ${pressure}B > budget ${budget}B`, bank128Bytes, bank132Bytes, psgPatternBytes: psgPatternBytesTotal, maxTypeCount, counts, budget };
  }
  if (maxTypeCount > META_CATALOG_COUNT_THRESHOLD) {
    return { useCd: true, reason: `asset-count ${maxTypeCount} > ${META_CATALOG_COUNT_THRESHOLD}`, bank128Bytes, bank132Bytes, psgPatternBytes: psgPatternBytesTotal, maxTypeCount, counts, budget };
  }
  if (psgPatternBytesTotal > META_PSG_RESIDENT_PATTERN_BUDGET) {
    return { useCd: true, reason: `psg-patterns ${psgPatternBytesTotal}B > ${META_PSG_RESIDENT_PATTERN_BUDGET}B`, bank128Bytes, bank132Bytes, psgPatternBytes: psgPatternBytesTotal, maxTypeCount, counts, budget };
  }
  return { useCd: false, reason: 'resident-metadata-within-budget', bank128Bytes, bank132Bytes, psgPatternBytes: psgPatternBytesTotal, maxTypeCount, counts, budget };
}

// Decide whether this project's metadata should be streamed from CD on demand.
// Only CD targets are eligible, and only once the resident bank132 footprint crosses
// the budget. Pure function of the project on disk so the reservation, CD file list,
// and source emission all reach the same answer.
function assetMetaShouldUseCd(projectDir, doc) {
  return assetMetaDecision(projectDir, doc).useCd;
}

function validateGeneratedAssetScale(projectDir, doc, assetIds = null) {
  const layout = computeAssetMetaLayout(doc);
  const checks = [
    ['BG', layout.bg.length],
    ['sprite', layout.sprite.length],
    ['ADPCM', layout.adpcm.length],
    ['PSG', layout.psg.length],
  ];
  checks.forEach(([label, count]) => {
    if (count > PCE_CATALOG_MAX_ASSETS_PER_TYPE) {
      throw new Error(`PCE-CD VN supports up to ${PCE_CATALOG_MAX_ASSETS_PER_TYPE} referenced ${label} assets (got ${count}).`);
    }
  });
  if (layout.cdda.length > PCE_CDDA_MAX_AUDIO_TRACKS) {
    throw new Error(`CD-DA supports up to ${PCE_CDDA_MAX_AUDIO_TRACKS} audio tracks (track 2..99; got ${layout.cdda.length}). Use ADPCM or PSG for large audio libraries.`);
  }
  const tracks = new Map();
  const rawDoc = readRawAssetDocument(projectDir);
  const idFilter = assetIds instanceof Set ? assetIds : null;
  (Array.isArray(rawDoc.assets) ? rawDoc.assets : []).forEach((asset) => {
    if (!asset || asset.type !== 'cdda-track') return;
    if (idFilter && !idFilter.has(String(asset.id || ''))) return;
    const rawTrack = asset.options?.track;
    const parsed = rawTrack == null || rawTrack === '' ? DEFAULT_CDDA_OPTIONS.track : Number(rawTrack);
    if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed < 2 || parsed > 99) {
      throw new Error(`CD-DA asset "${asset.id}" has invalid track ${rawTrack}; use an integer track number from 2 to 99.`);
    }
  });
  layout.cdda.forEach((asset) => {
    const rawTrack = asset.options?.track;
    const parsed = rawTrack == null || rawTrack === '' ? DEFAULT_CDDA_OPTIONS.track : Number(rawTrack);
    if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed < 2 || parsed > 99) {
      throw new Error(`CD-DA asset "${asset.id}" has invalid track ${rawTrack}; use an integer track number from 2 to 99.`);
    }
    const track = Math.trunc(parsed);
    const previous = tracks.get(track);
    if (previous) {
      throw new Error(`CD-DA track ${track} is used by both "${previous}" and "${asset.id}". Track numbers must be unique.`);
    }
    tracks.set(track, asset.id);
  });
}

// Write ASSET_META_FILE at its final (count-derived) size up front, BEFORE any
// buildCdDataLayout stats it, so its CD sector and every file after it stay
// stable across the reserve→overwrite flow (same pattern as overlay.bin). Returns
// the layout so callers can avoid recomputing it.
function ensureAssetMetaReservation(projectDir, doc) {
  const document = doc || readAssetDocument(projectDir);
  const layout = computeAssetMetaLayout(document);
  const { absPath } = resolveUnderRoot(projectDir, ASSET_META_FILE, 'project');
  // Resident-mode projects (small enough to keep descriptors in RAM) get no CD
  // metadata file at all. Remove a stale one left by a previous large-mode build so
  // it can't be picked up by collectCdDataFiles or waste an ISO sector.
  if (!assetMetaShouldUseCd(projectDir, document)) {
    if (fs.existsSync(absPath)) fs.rmSync(absPath);
    return layout;
  }
  const current = fs.existsSync(absPath) ? fs.statSync(absPath).size : -1;
  if (current !== layout.byteSize) {
    ensureDirSync(path.dirname(absPath));
    fs.writeFileSync(absPath, Buffer.alloc(layout.byteSize));
  }
  return layout;
}

function writeMetaCdRef(buf, off, ref) {
  buf[off] = ref.sector & 0xff;
  buf[off + 1] = (ref.sector >> 8) & 0xff;
  buf[off + 2] = (ref.sector >> 16) & 0xff;
  buf.writeUInt16LE(ref.sectorCount & 0xffff, off + 3);
  buf.writeUInt16LE(ref.byteSize & 0xffff, off + 5);
  buf[off + 7] = ref.compression & 0xff;
}

function metaCdRefForFile(cdLayout, relativePath, byteSize, compression) {
  const norm = normalizeRelativePath(relativePath || '');
  const entry = norm ? cdLayout?.get(norm) : null;
  const sector = entry?.sector || 0;
  const sectorCount = entry?.sectorCount || Math.max(1, Math.ceil((byteSize || 0) / CD_SECTOR_BYTES));
  return {
    sector,
    sectorCount,
    byteSize: byteSize || 0,
    compression: compression === PCE_VISUAL_COMPRESSION_RLE ? PCE_EDITOR_CD_COMPRESSION_RLE : PCE_EDITOR_CD_COMPRESSION_NONE,
  };
}

// Serialize the metadata records into the reserved-size buffer. Records use the
// fixed offsets documented in docs/pce-asset-meta-cd-ondemand.md and mirrored by
// the runtime decoder (META_* offsets in pce_vn_runtime.c).
function buildAssetMetaBuffer(projectDir, doc, cdLayout, metaLayout) {
  const layout = metaLayout || computeAssetMetaLayout(doc);
  const buf = Buffer.alloc(layout.byteSize);
  layout.bg.forEach((asset, index) => {
    const base = (layout.bgOffset * CD_SECTOR_BYTES) + (index * META_BG_SLOT);
    const generated = asset.data.generated || {};
    const options = normalizeImageOptions(asset);
    const palette = readGeneratedBuffer(projectDir, generated.paletteFile);
    const tilesPayload = generatedCdPayload(projectDir, generated, 'tiles');
    const hasMap = Boolean(generated.mapVramFile);
    const mapPayload = hasMap
      ? generatedCdPayload(projectDir, generated, 'map')
      : { relativePath: generated.mapFile, uncompressedSize: 0, byteSize: 0, compression: PCE_VISUAL_COMPRESSION_NONE };
    // Struct image (pointer fields left zero; the runtime fixes them up).
    buf.writeUInt16LE(Math.min(palette.length, 32) & 0xffff, base + META_BG_PALETTE_SIZE);
    buf.writeUInt16LE((tilesPayload.uncompressedSize || 0) & 0xffff, base + META_BG_TILES_SIZE);
    buf.writeUInt16LE((mapPayload.uncompressedSize || 0) & 0xffff, base + META_BG_MAP_SIZE);
    buf[base + META_BG_WIDTH] = Math.max(1, Math.ceil(numeric(options.width, 0, 1024, 0) / 8)) & 0xff;
    buf[base + META_BG_HEIGHT] = Math.max(1, Math.ceil(numeric(options.height, 0, 1024, 0) / 8)) & 0xff;
    buf.writeUInt16LE(numeric(options.tileBase, 0, 2047, 32) & 0xffff, base + META_BG_TILE_BASE);
    buf.writeUInt16LE(numeric(options.mapBase, 0, 2047, 0) & 0xffff, base + META_BG_MAP_BASE);
    buf[base + META_BG_PALETTE_BANK] = numeric(options.paletteBank, 0, 15, 0) & 0xff;
    // Appendix.
    palette.copy(buf, base + META_BG_PALETTE_APPENDIX, 0, Math.min(palette.length, 32));
    writeMetaCdRef(buf, base + META_BG_TILES_CD, metaCdRefForFile(cdLayout, tilesPayload.relativePath, tilesPayload.byteSize, tilesPayload.compression));
    writeMetaCdRef(buf, base + META_BG_MAP_CD, metaCdRefForFile(cdLayout, mapPayload.relativePath, mapPayload.byteSize, mapPayload.compression));
  });
  layout.sprite.forEach((asset, index) => {
    const base = (layout.spriteOffset * CD_SECTOR_BYTES) + (index * META_SPRITE_SLOT);
    const generated = asset.data.generated || {};
    const options = normalizeImageOptions(asset);
    const palette = readGeneratedBuffer(projectDir, generated.paletteFile);
    const cellMap = readGeneratedBuffer(projectDir, generated.cellMapFile);
    // The runtime streams cell_map into a fixed per-slot console_ram buffer
    // (VN_META_CELL_MAP_MAX). A larger positional cell count would truncate and
    // mis-map sprite cells, so fail the build instead. Keep this in sync with the
    // runtime's VN_META_CELL_MAP_MAX.
    if (cellMap.length > 384) {
      throw new Error(`Sprite "${asset.id}" cell_map has ${cellMap.length} cells (> 384). Reduce the sheet's positional cell count (columns × rows).`);
    }
    const patternsPayload = generatedCdPayload(projectDir, generated, 'tiles');
    const cellWidth = numeric(options.cellWidth, 16, 32, 16);
    const cellHeight = numeric(options.cellHeight, 16, 64, 16);
    buf.writeUInt16LE(Math.min(palette.length, 32) & 0xffff, base + META_SPR_PALETTE_SIZE);
    buf.writeUInt16LE((patternsPayload.uncompressedSize || 0) & 0xffff, base + META_SPR_PATTERNS_SIZE);
    buf[base + META_SPR_CELL_WIDTH] = cellWidth & 0xff;
    buf[base + META_SPR_CELL_HEIGHT] = cellHeight & 0xff;
    buf[base + META_SPR_CELL_COLUMNS] = Math.max(1, Math.ceil(numeric(options.width, 0, 1024, cellWidth) / cellWidth)) & 0xff;
    buf[base + META_SPR_CELL_ROWS] = Math.max(1, Math.ceil(numeric(options.height, 0, 1024, cellHeight) / cellHeight)) & 0xff;
    buf.writeUInt16LE(numeric(options.tileBase, 0, 2047, 704) & 0xffff, base + META_SPR_PATTERN_BASE);
    buf[base + META_SPR_PALETTE_BANK] = numeric(options.paletteBank, 0, 15, 0) & 0xff;
    buf[base + META_SPR_X] = numeric(options.x, 0, 255, 144) & 0xff;
    buf[base + META_SPR_Y] = numeric(options.y, 0, 255, 104) & 0xff;
    // Appendix. cell_map is stored INLINE in the record (not a separate CD file),
    // so the runtime decodes it from the same meta sector — no extra CD read / no
    // streaming loop.
    palette.copy(buf, base + META_SPR_PALETTE_APPENDIX, 0, Math.min(palette.length, 32));
    writeMetaCdRef(buf, base + META_SPR_PATTERNS_CD, metaCdRefForFile(cdLayout, patternsPayload.relativePath, patternsPayload.byteSize, patternsPayload.compression));
    buf.writeUInt16LE(Math.min(cellMap.length, META_CELL_MAP_MAX) & 0xffff, base + META_SPR_CELL_MAP_LEN);
    cellMap.copy(buf, base + META_SPR_CELL_MAP, 0, Math.min(cellMap.length, META_CELL_MAP_MAX));
  });
  layout.adpcm.forEach((asset, index) => {
    const base = (layout.adpcmOffset * CD_SECTOR_BYTES) + (index * META_ADPCM_SLOT);
    const generated = asset.data.generated || {};
    const options = normalizeAdpcmOptions(asset);
    const data = readGeneratedBuffer(projectDir, generated.outputFile);
    buf.writeUInt32LE(data.length >>> 0, base + META_ADPCM_DATA_SIZE);
    buf.writeUInt16LE(numeric(options.sampleRate, 0, 65535, 0) & 0xffff, base + META_ADPCM_SAMPLE_RATE);
    buf.writeUInt16LE(numeric(options.adpcmAddress, 0, 65535, 0) & 0xffff, base + META_ADPCM_ADDRESS);
    buf[base + META_ADPCM_DIVIDER] = numeric(options.divider, 0, 15, 0) & 0xff;
    buf[base + META_ADPCM_LOOP] = options.loop ? 1 : 0;
    buf[base + META_ADPCM_STREAM] = options.stream ? 1 : 0;
    writeMetaCdRef(buf, base + META_ADPCM_CD, metaCdRefForFile(cdLayout, generated.outputFile, data.length, PCE_VISUAL_COMPRESSION_NONE));
  });
  layout.psg.forEach((asset, index) => {
    const base = (layout.psgOffset * CD_SECTOR_BYTES) + (index * META_PSG_SLOT);
    const options = normalizePsgOptions(asset);
    const pattern = normalizePsgPatternEntries(asset, options);
    const patternBytes = serializePsgPattern(pattern);
    buf[base + META_PSG_IS_SONG] = asset.type === 'psg-song' ? 1 : 0;
    buf.writeUInt16LE(firstPsgPeriod(asset) & 0xffff, base + META_PSG_PERIOD);
    buf.writeUInt16LE(options.bpm & 0xffff, base + META_PSG_BPM);
    buf.writeUInt16LE(options.steps & 0xffff, base + META_PSG_STEPS);
    buf.writeUInt16LE(pattern.length & 0xffff, base + META_PSG_PATTERN_COUNT);
    if (patternBytes.length) {
      writeMetaCdRef(buf, base + META_PSG_PATTERN_CD, metaCdRefForFile(cdLayout, psgPatternFile(asset), patternBytes.length, PCE_VISUAL_COMPRESSION_NONE));
    }
  });
  {
    const cddaLayout = buildCddaTrackLayout(projectDir, layout.cdda, cdLayout);
    layout.cdda.forEach((asset, index) => {
      const base = (layout.cddaOffset * CD_SECTOR_BYTES) + (index * META_CDDA_SLOT);
      const options = normalizeCddaOptions(asset);
      const cdda = cddaLayout.get(asset.id) || { startSector: 0, endSector: 0, playFrames: 0 };
      const endTime = sectorToTimeParts(cdda.endSector);
      buf[base + META_CDDA_TRACK] = options.track & 0xff;
      buf[base + META_CDDA_LOOP] = options.loop ? 1 : 0;
      const start = sectorToGeneratedSector(cdda.startSector);
      const end = sectorToGeneratedSector(cdda.endSector);
      buf[base + META_CDDA_START_SECTOR] = start.lo;
      buf[base + META_CDDA_START_SECTOR + 1] = start.md;
      buf[base + META_CDDA_START_SECTOR + 2] = start.hi;
      buf[base + META_CDDA_END_SECTOR] = end.lo;
      buf[base + META_CDDA_END_SECTOR + 1] = end.md;
      buf[base + META_CDDA_END_SECTOR + 2] = end.hi;
      buf[base + META_CDDA_END_TIME] = endTime.frame & 0xff;
      buf[base + META_CDDA_END_TIME + 1] = endTime.second & 0xff;
      buf[base + META_CDDA_END_TIME + 2] = endTime.minute & 0xff;
      buf.writeUInt16LE((cdda.playFrames || 0) & 0xffff, base + META_CDDA_PLAY_FRAMES);
    });
  }
  return buf;
}

function collectCdDataFilesForDocument(projectDir, doc) {
  const catalogMode = assetMetaShouldUseCd(projectDir, doc);
  const files = [];
  (doc.assets || []).forEach((asset) => {
    const generated = asset.data?.generated || {};
    if (asset.type === 'image' || asset.type === 'sprite') {
      files.push(generatedCdPayload(projectDir, generated, 'tiles').relativePath || '');
      if (asset.type === 'image') files.push(generatedCdPayload(projectDir, generated, 'map').relativePath || '');
      // sprite cell_map is stored inline in asset_meta.bin, not as its own CD file.
    } else if (asset.type === 'adpcm') {
      files.push(generated.outputFile || '');
    } else if (asset.type === 'psg-song' || asset.type === 'psg-sfx') {
      // Catalog mode streams even tiny PSG patterns so resident metadata is O(1).
      if (psgPatternBytes(asset).length && psgAssetStreamsFromCd(asset, true, { catalogMode })) files.push(psgPatternFile(asset));
    }
  });
  // The consolidated metadata file (reserved at final size by
  // ensureAssetMetaReservation) so it lands on the ISO with a stable sector. Only
  // emitted once the project is large enough to stream metadata on demand.
  if (assetMetaShouldUseCd(projectDir, doc)) files.push(ASSET_META_FILE);
  return Array.from(new Set(files
    .map((entry) => normalizeRelativePath(entry || ''))
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(projectDir, relativePath)))));
}

function filterAssetDocumentByIds(doc, assetIds) {
  if (!Array.isArray(assetIds)) return doc;
  const ids = new Set(assetIds.map((id) => String(id || '').trim()).filter(Boolean));
  return {
    ...doc,
    assets: (doc.assets || []).filter((asset) => asset?.id && ids.has(String(asset.id))),
  };
}

function collectCdDataFiles(projectDir, options = {}) {
  const doc = options?.doc || readAssetDocument(projectDir);
  return collectCdDataFilesForDocument(projectDir, filterAssetDocumentByIds(doc, options?.assetIds));
}

function adpcmAssetNeedsRegeneration(projectDir, asset) {
  const generated = asset?.data?.generated || {};
  if (!generated.outputFile) return Boolean(asset?.source);
  const outputPath = path.join(projectDir, normalizeRelativePath(generated.outputFile));
  if (!fs.existsSync(outputPath)) return true;
  if (generated.codec !== PCE_ADPCM_CODEC) return true;
  if (generated.encoderVersion !== PCE_ADPCM_ENCODER_VERSION) return true;
  if (generated.nibbleOrder !== PCE_ADPCM_NIBBLE_ORDER) return true;
  return false;
}

function updateAdpcmGeneratedAsset(projectDir, asset, part, shared = {}) {
  const generated = asset.data?.generated || {};
  const outputFile = normalizeRelativePath(generated.outputFile || relativeGeneratedPath(asset.id, 'adpcm.bin'));
  const previewFile = normalizeRelativePath(generated.previewFile || relativeGeneratedPath(asset.id, 'preview.json'));
  const { absPath: outputAbs } = resolveUnderRoot(projectDir, outputFile, 'project');
  const { absPath: previewAbs } = resolveUnderRoot(projectDir, previewFile, 'project');
  const warnings = [
    ...(shared.warnings || []),
    ...(!shared.stream && part.output.length > shared.maxAdpcmBytes ? [`ADPCM: ${part.output.length} bytes exceeds runtime-safe limit ${shared.maxAdpcmBytes}`] : []),
  ];
  ensureDirSync(path.dirname(outputAbs));
  fs.writeFileSync(outputAbs, part.output);
  fs.writeFileSync(previewAbs, JSON.stringify({
    source: shared.sourceRel,
    kind: 'adpcm',
    sampleRate: part.sampleRate,
    channels: part.channels,
    durationSeconds: part.durationSeconds,
    bytes: part.output.length,
    codec: part.codec || PCE_ADPCM_CODEC,
    encoderVersion: part.encoderVersion || PCE_ADPCM_ENCODER_VERSION,
    nibbleOrder: part.nibbleOrder || PCE_ADPCM_NIBBLE_ORDER,
    waveform: part.waveform,
    warnings,
    processing: shared.processing || {},
    groupId: shared.groupId,
    partIndex: shared.partIndex,
    partCount: shared.partCount,
    splitPolicy: shared.splitPolicy,
    maxAdpcmBytes: shared.maxAdpcmBytes,
  }, null, 2), 'utf-8');
  asset.data = {
    ...(asset.data || {}),
    generated: {
      ...generated,
      outputFile,
      previewFile,
      byteLength: part.output.length,
      sampleRate: part.sampleRate,
      channels: part.channels,
      durationSeconds: part.durationSeconds,
      codec: part.codec || PCE_ADPCM_CODEC,
      encoderVersion: part.encoderVersion || PCE_ADPCM_ENCODER_VERSION,
      nibbleOrder: part.nibbleOrder || PCE_ADPCM_NIBBLE_ORDER,
      waveform: part.waveform,
      warnings,
    },
    import: {
      ...(asset.data?.import || {}),
      codec: part.codec || PCE_ADPCM_CODEC,
      encoderVersion: part.encoderVersion || PCE_ADPCM_ENCODER_VERSION,
      nibbleOrder: part.nibbleOrder || PCE_ADPCM_NIBBLE_ORDER,
      regeneratedAt: new Date().toISOString(),
    },
  };
}

function ensureAdpcmGeneratedAssets(projectDir, doc) {
  const adpcmAssets = (doc.assets || []).filter((asset) => asset.type === 'adpcm');
  const groupIds = new Set();
  let changed = false;
  for (const asset of adpcmAssets) {
    const groupId = String(asset.data?.import?.groupId || asset.id || '');
    if (!groupId || groupIds.has(groupId)) continue;
    groupIds.add(groupId);
    const group = adpcmAssets
      .filter((entry) => String(entry.data?.import?.groupId || entry.id || '') === groupId)
      .sort((a, b) => clampInt(a.data?.import?.partIndex, 1, 65535, 1) - clampInt(b.data?.import?.partIndex, 1, 65535, 1));
    if (!group.some((entry) => adpcmAssetNeedsRegeneration(projectDir, entry))) continue;
    const first = group[0];
    const sourceRel = normalizeRelativePath(first.source || '');
    if (!sourceRel) continue;
    const { absPath: sourceAbs } = resolveUnderRoot(projectDir, sourceRel, 'project');
    if (!fs.existsSync(sourceAbs)) {
      if (group.every((entry) => {
        const generated = entry.data?.generated || {};
        return generated.outputFile && fs.existsSync(path.join(projectDir, normalizeRelativePath(generated.outputFile)));
      })) {
        continue;
      }
      throw new Error(`ADPCM source not found for regeneration: ${sourceRel}`);
    }
    const input = fs.readFileSync(sourceAbs);
    const options = normalizeAdpcmOptions(first);
    const maxAdpcmBytes = options.stream
      ? 0x7ffffff
      : Math.max(1, Math.min(65535, clampInt(first.data?.import?.maxAdpcmBytes, 1, 65535, 65536 - options.adpcmAddress)));
    const splitPolicy = !options.stream && (first.data?.import?.splitPolicy === 'auto' || group.length > 1) ? 'auto' : '';
    const converted = splitPolicy === 'auto'
      ? audioConverter.convertWavForAdpcmParts(input, { sampleRate: options.sampleRate, maxBytes: maxAdpcmBytes })
      : audioConverter.convertWavForAdpcm(input, { sampleRate: options.sampleRate });
    const parts = splitPolicy === 'auto'
      ? converted.parts
      : [{
          output: converted.output,
          codec: converted.codec,
          encoderVersion: converted.encoderVersion,
          nibbleOrder: converted.nibbleOrder,
          sampleRate: converted.sampleRate,
          channels: converted.channels,
          durationSeconds: converted.durationSeconds,
          waveform: converted.waveform,
        }];
    if (parts.length !== group.length) {
      throw new Error(`ADPCM split count changed for ${groupId}; please re-import the asset`);
    }
    group.forEach((entry, index) => {
      updateAdpcmGeneratedAsset(projectDir, entry, parts[index], {
        sourceRel,
        warnings: converted.warnings || [],
        processing: entry.data?.import?.processing || {},
        groupId,
        partIndex: index + 1,
        partCount: group.length,
        splitPolicy,
        maxAdpcmBytes,
        stream: options.stream,
      });
      changed = true;
    });
  }
  if (changed) writeAssetDocument(projectDir, doc);
  return changed;
}

function buildCdDataLayout(projectDir, dataFiles) {
  const layout = new Map();
  let sector = CD_DATA_BASE_SECTOR;
  (dataFiles || []).forEach((relativePath) => {
    const normalized = normalizeRelativePath(relativePath || '');
    if (!normalized || layout.has(normalized)) return;
    const absPath = path.join(projectDir, normalized);
    const size = fs.existsSync(absPath) ? fs.statSync(absPath).size : 0;
    const sectorCount = Math.max(1, Math.ceil(size / CD_SECTOR_BYTES));
    layout.set(normalized, { sector, sectorCount });
    sector += sectorCount;
  });
  return layout;
}

function normalizeCdDataFileList(projectDir, entries = []) {
  return Array.from(new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeRelativePath(entry || ''))
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(projectDir, relativePath)))));
}

function generateAssetSources(projectDir, options = {}) {
  const doc = readAssetDocument(projectDir);
  ensureVisualGeneratedAssets(projectDir, doc);
  ensureAdpcmGeneratedAssets(projectDir, doc);
  const assetIdFilter = Array.isArray(options.assetIds)
    ? new Set(options.assetIds.map((id) => String(id || '').trim()).filter(Boolean))
    : null;
  const sourceDoc = assetIdFilter
    ? { ...doc, assets: (doc.assets || []).filter((asset) => asset?.id && assetIdFilter.has(String(asset.id))) }
    : doc;
  validateGeneratedAssetScale(projectDir, sourceDoc, assetIdFilter);
  ensurePsgPatternFiles(projectDir, sourceDoc);
  const assetMetaInfo = assetMetaDecision(projectDir, sourceDoc);
  // Reserve the consolidated metadata file at its final size before any CD layout
  // is computed, so its sector (and every file after it) stays stable.
  const metaLayout = ensureAssetMetaReservation(projectDir, sourceDoc);
  const image = sourceDoc.assets.find((asset) => asset.type === 'image');
  const sound = sourceDoc.assets.find((asset) => asset.type === 'psg-sfx' || asset.type === 'psg-song');
  const targetsCd = projectTargetsCd(projectDir);
  // CD on-demand metadata engages only above the resident budget (see
  // assetMetaShouldUseCd). Small CD projects keep the resident-array path used by
  // HuCard builds, so the accessor code is DCE'd and there is no regression.
  const assetMetaOnCd = assetMetaInfo.useCd;
  const rows = targetsCd ? [] : (image ? generateTextMosaicForImage(projectDir, image).slice(0, 14) : ['NO IMAGE ASSET']);
  const tonePeriod = firstPsgPeriod(sound || {});
  const allowBanking = true;
  const bankAllocator = targetsCd ? createCdRamBankAllocator() : createRomBankAllocator();
  const requestedCdDataFiles = Array.isArray(options.cdDataFiles) ? options.cdDataFiles : null;
  const cdDataFiles = targetsCd
    ? normalizeCdDataFileList(projectDir, requestedCdDataFiles || collectCdDataFilesForDocument(projectDir, sourceDoc))
    : [];
  const cdLayout = targetsCd ? buildCdDataLayout(projectDir, cdDataFiles) : new Map();
  const bgGenerated = generateConvertedAssetArrays(projectDir, sourceDoc.assets, 'image', bankAllocator, { allowBanking, targetsCd, useCdDataFiles: targetsCd, cdLayout });
  const spriteGenerated = generateConvertedAssetArrays(projectDir, sourceDoc.assets, 'sprite', bankAllocator, { allowBanking, targetsCd, useCdDataFiles: targetsCd, cdLayout });
  const psgGenerated = generatePsgMetadata(projectDir, sourceDoc.assets, { targetsCd, cdLayout, catalogMode: assetMetaOnCd });
  const adpcmGenerated = generateAdpcmMetadata(projectDir, sourceDoc.assets, { targetsCd, cdLayout });
  const cddaGenerated = generateCddaMetadata(projectDir, sourceDoc.assets, { targetsCd, cdLayout });
  const emptyDataRef = '{ (const unsigned char *)0, 0u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }';

  // For CD builds, serialize the per-asset metadata into ASSET_META_FILE (already
  // reserved at final size) and emit only a constant resident directory. This is
  // what keeps bank128 .rodata / bank132 cd refs O(1) in asset count.
  let metaRegionLines = [];
  if (assetMetaOnCd) {
    const metaBuffer = buildAssetMetaBuffer(projectDir, sourceDoc, cdLayout, metaLayout);
    const { absPath: metaAbs } = resolveUnderRoot(projectDir, ASSET_META_FILE, 'project');
    ensureDirSync(path.dirname(metaAbs));
    fs.writeFileSync(metaAbs, metaBuffer);
    const metaEntry = cdLayout.get(normalizeRelativePath(ASSET_META_FILE));
    const metaSector = metaEntry?.sector || 0;
    const region = (offsetSectors, count) => `{ ${sectorToCInitializer(metaSector + offsetSectors)}, ${count}u }`;
    metaRegionLines = [
      `const pce_editor_meta_region_t pce_editor_bg_meta PCE_EDITOR_RODATA_SECTION = ${region(metaLayout.bgOffset, bgGenerated.converted.length)};`,
      `const pce_editor_meta_region_t pce_editor_sprite_meta PCE_EDITOR_RODATA_SECTION = ${region(metaLayout.spriteOffset, spriteGenerated.converted.length)};`,
      `const pce_editor_meta_region_t pce_editor_adpcm_meta PCE_EDITOR_RODATA_SECTION = ${region(metaLayout.adpcmOffset, adpcmGenerated.adpcmAssets.length)};`,
      `const pce_editor_meta_region_t pce_editor_psg_meta PCE_EDITOR_RODATA_SECTION = ${region(metaLayout.psgOffset, psgGenerated.psgAssets.length)};`,
      `const pce_editor_meta_region_t pce_editor_cdda_meta PCE_EDITOR_RODATA_SECTION = ${region(metaLayout.cddaOffset, cddaGenerated.cddaAssets.length)};`,
    ];
  }

  const linesH = [
    '#ifndef PCE_EDITOR_GENERATED_ASSETS_H',
    '#define PCE_EDITOR_GENERATED_ASSETS_H',
    '',
    'typedef struct {',
    '  unsigned char bank;',
    '  const unsigned char *data;',
    '  unsigned int size;',
    '} pce_editor_data_chunk_t;',
    '',
    'typedef struct {',
    '  unsigned char lo;',
    '  unsigned char md;',
    '  unsigned char hi;',
    '} pce_editor_cd_sector_t;',
    '',
    'typedef struct {',
    '  unsigned char frame;',
    '  unsigned char second;',
    '  unsigned char minute;',
    '} pce_editor_cd_time_t;',
    '',
    'typedef struct {',
    '  pce_editor_cd_sector_t sector;',
    '  unsigned int sector_count;',
    '  unsigned int byte_size;',
    '  unsigned char compression;',
    '} pce_editor_cd_data_ref_t;',
    '',
    '#define PCE_EDITOR_CD_COMPRESSION_NONE 0u',
    '#define PCE_EDITOR_CD_COMPRESSION_RLE 1u',
    '',
    'typedef struct {',
    '  const unsigned char *data;',
    '  unsigned int size;',
    '  const pce_editor_data_chunk_t *chunks;',
    '  unsigned char chunk_count;',
    '  const pce_editor_cd_data_ref_t *cd;',
    '} pce_editor_data_ref_t;',
    '',
    'typedef struct {',
    '  pce_editor_data_ref_t palette;',
    '  pce_editor_data_ref_t tiles;',
    '  pce_editor_data_ref_t map;',
    '  unsigned char width_tiles;',
    '  unsigned char height_tiles;',
    '  unsigned int tile_base;',
    '  unsigned int map_base;',
    '  unsigned char palette_bank;',
    '} pce_editor_bg_asset_t;',
    '',
    'typedef struct {',
    '  pce_editor_data_ref_t palette;',
    '  pce_editor_data_ref_t patterns;',
    '  unsigned char cell_width;',
    '  unsigned char cell_height;',
    '  unsigned char cell_columns;',
    '  unsigned char cell_rows;',
    '  unsigned int pattern_base;',
    '  unsigned char palette_bank;',
    '  unsigned char x;',
    '  unsigned char y;',
    '  const unsigned char *cell_map;',
    '} pce_editor_sprite_asset_t;',
    '',
    'typedef struct {',
    '  unsigned char cell_width;',
    '  unsigned char cell_height;',
    '  unsigned char cell_columns;',
    '  unsigned char cell_rows;',
    '  unsigned int pattern_base;',
    '  unsigned char palette_bank;',
    '} pce_editor_sprite_draw_meta_t;',
    '',
    'typedef struct __attribute__((packed)) {',
    '  unsigned int step;',
    '  unsigned char channel;',
    '  unsigned int period;',
    '  unsigned char volume;',
    '  unsigned char noise;',
    '  unsigned char reserved;',
    '} pce_editor_psg_step_t;',
    '',
    'typedef struct {',
    '  unsigned char is_song;',
    '  unsigned int period;',
    '  unsigned int bpm;',
    '  unsigned int steps;',
    '  const pce_editor_psg_step_t *pattern;',
    '  unsigned int pattern_count;',
    '  const pce_editor_cd_data_ref_t *pattern_cd;',
    '} pce_editor_psg_asset_t;',
    '',
    'typedef struct {',
    '  const unsigned char *data;',
    '  unsigned long data_size;',
    '  unsigned int sample_rate;',
    '  unsigned int adpcm_address;',
    '  unsigned char divider;',
    '  unsigned char loop;',
    '  unsigned char stream;',
    '  const pce_editor_cd_data_ref_t *cd;',
    '} pce_editor_adpcm_asset_t;',
    '',
    'typedef struct {',
    '  unsigned char track;',
    '  unsigned char loop;',
    '  pce_editor_cd_sector_t start_sector;',
    '  pce_editor_cd_sector_t end_sector;',
    '  pce_editor_cd_time_t end_time;',
    '  unsigned int play_frames;',
    '} pce_editor_cdda_asset_t;',
    '',
    '/* CD on-demand metadata directory (see docs/pce-asset-meta-cd-ondemand.md). On',
    '   CD builds the per-asset BG/sprite/ADPCM descriptors live in a CD data file as',
    '   fixed-size, sector-aligned record slots; only this constant directory stays',
    '   resident. Record N is at sector (region.sector + N / records_per_sector) and',
    '   byte offset (N % records_per_sector) * slot. */',
    'typedef struct {',
    '  pce_editor_cd_sector_t sector;',
    '  unsigned int count;',
    '} pce_editor_meta_region_t;',
    '/* BG/sprite records are packed images of the in-memory descriptor struct',
    '   (pointer fields zeroed) followed by appendices holding palettes, CD refs,',
    '   and sprite cell maps. ADPCM records keep the same fixed offsets but are',
    '   decoded field-by-field so the CD metadata path does not depend on copying',
    '   zeroed pointer slots back into a resident struct image. _Static_assert in',
    '   the runtime locks this against struct drift. */',
    '#define PCE_EDITOR_META_BG_SLOT 128u',
    '#define PCE_EDITOR_META_BG_PALETTE 34u',
    '#define PCE_EDITOR_META_BG_TILES_CD 66u',
    '#define PCE_EDITOR_META_BG_MAP_CD 74u',
    '#define PCE_EDITOR_META_SPRITE_SLOT 512u',
    '#define PCE_EDITOR_META_SPR_PALETTE 29u',
    '#define PCE_EDITOR_META_SPR_PATTERNS_CD 61u',
    '#define PCE_EDITOR_META_SPR_CELL_MAP_LEN 69u',
    '#define PCE_EDITOR_META_SPR_CELL_MAP 71u',
    '#define PCE_EDITOR_META_ADPCM_SLOT 32u',
    '#define PCE_EDITOR_META_ADPCM_DATA_SIZE 2u',
    '#define PCE_EDITOR_META_ADPCM_SAMPLE_RATE 6u',
    '#define PCE_EDITOR_META_ADPCM_ADDRESS 8u',
    '#define PCE_EDITOR_META_ADPCM_DIVIDER 10u',
    '#define PCE_EDITOR_META_ADPCM_LOOP 11u',
    '#define PCE_EDITOR_META_ADPCM_STREAM 12u',
    '#define PCE_EDITOR_META_ADPCM_CD 15u',
    '#define PCE_EDITOR_META_PSG_SLOT 32u',
    '#define PCE_EDITOR_META_PSG_IS_SONG 0u',
    '#define PCE_EDITOR_META_PSG_PERIOD 1u',
    '#define PCE_EDITOR_META_PSG_BPM 3u',
    '#define PCE_EDITOR_META_PSG_STEPS 5u',
    '#define PCE_EDITOR_META_PSG_PATTERN_COUNT 7u',
    '#define PCE_EDITOR_META_PSG_PATTERN_CD 9u',
    '#define PCE_EDITOR_META_CDDA_SLOT 32u',
    '#define PCE_EDITOR_META_CDDA_TRACK 0u',
    '#define PCE_EDITOR_META_CDDA_LOOP 1u',
    '#define PCE_EDITOR_META_CDDA_START_SECTOR 2u',
    '#define PCE_EDITOR_META_CDDA_END_SECTOR 5u',
    '#define PCE_EDITOR_META_CDDA_END_TIME 8u',
    '#define PCE_EDITOR_META_CDDA_PLAY_FRAMES 11u',
    '/* 1 = descriptors stream from CD via pce_editor_*_meta (large projects);',
    '   0 = descriptors resident in pce_editor_*_assets[] (small projects / HuCard).',
    '   The runtime selects its accessor path on this; the unused path is DCE-dropped. */',
    `#define PCE_EDITOR_ASSET_META_ON_CD ${assetMetaOnCd ? '1' : '0'}`,
    'extern const pce_editor_meta_region_t pce_editor_bg_meta;',
    'extern const pce_editor_meta_region_t pce_editor_sprite_meta;',
    'extern const pce_editor_meta_region_t pce_editor_adpcm_meta;',
    'extern const pce_editor_meta_region_t pce_editor_psg_meta;',
    'extern const pce_editor_meta_region_t pce_editor_cdda_meta;',
    '',
    'extern const pce_editor_bg_asset_t pce_editor_bg_assets[];',
    'extern const unsigned int pce_editor_bg_asset_count;',
    'extern const pce_editor_sprite_asset_t pce_editor_sprite_assets[];',
    'extern const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[];',
    'extern const unsigned int pce_editor_sprite_asset_count;',
    'extern const pce_editor_psg_asset_t pce_editor_psg_assets[];',
    'extern const unsigned int pce_editor_psg_asset_count;',
    'extern const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[];',
    'extern const unsigned int pce_editor_adpcm_asset_count;',
    'extern const pce_editor_cdda_asset_t pce_editor_cdda_assets[];',
    'extern const unsigned int pce_editor_cdda_asset_count;',
    'extern const char * const pce_editor_image_rows[];',
    'extern const unsigned char pce_editor_image_row_count;',
    'extern const unsigned int pce_editor_tone_period;',
    'void pce_editor_map_asset_bank(unsigned char bank);',
    '',
    '#endif',
    '',
  ];

  const quotedRows = rows.map((row) => `  "${String(row).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  const cdBankDeclarations = targetsCd
    ? bankAllocator.banks.map((bank) => `PCE_RAM_BANK_AT(${bank}, ${cdRamBankOffset(bank)});`)
    : [];
  const romBankDeclarations = !targetsCd
    ? bankAllocator.banks.map((bank) => `PCE_ROM_BANK_AT(${bank}, 6);`)
    : [];
  const bankSwitchLines = bankAllocator.banks.map((bank) => (targetsCd
    ? `    case ${bank}u: pce_ram_bank${bank}_map(); return;`
    : `    case ${bank}u: pce_rom_bank${bank}_map(); return;`));
  const linesC = [
    '#if defined(__PCE_CD__)',
    '#define PCE_CONFIG_IMPLEMENTATION',
    '#include <pce-cd.h>',
    ...cdBankDeclarations,
    '#define PCE_EDITOR_BANKED_SECTION(name) __attribute__((section(name)))',
    '#define PCE_EDITOR_CD_REF_SECTION __attribute__((section(".ram_bank132")))',
    '#define PCE_EDITOR_RODATA_SECTION __attribute__((section(".rodata")))',
    '#elif defined(__PCE__) && !defined(__CC65__) && !defined(PCE_EDITOR_TARGET_CD)',
    '#define PCE_CONFIG_IMPLEMENTATION',
    '#include <pce.h>',
    ...romBankDeclarations,
    '#define PCE_EDITOR_BANKED_SECTION(name) __attribute__((section(name)))',
    '#define PCE_EDITOR_RODATA_SECTION __attribute__((section(".rodata")))',
    '#define PCE_EDITOR_CD_REF_SECTION PCE_EDITOR_RODATA_SECTION',
    '#else',
    '#define PCE_EDITOR_BANKED_SECTION(name)',
    '#define PCE_EDITOR_CD_REF_SECTION',
    '#define PCE_EDITOR_RODATA_SECTION',
    '#endif',
    '',
    '#include "assets.h"',
    '',
    ...(assetMetaOnCd ? [] : psgGenerated.arrayLines),
    // BG/sprite/ADPCM descriptors: resident arrays for HuCard and small CD
    // projects, CD on-demand directory once large (records live in ASSET_META_FILE;
    // see metaRegionLines / assetMetaOnCd).
    ...(assetMetaOnCd ? [] : [
      ...bgGenerated.arrayLines,
      ...spriteGenerated.arrayLines,
      ...adpcmGenerated.arrayLines,
    ]),
    ...(assetMetaOnCd ? [
      ...metaRegionLines,
      '',
      `const unsigned int pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = ${bgGenerated.converted.length};`,
      `const unsigned int pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = ${spriteGenerated.converted.length};`,
      `const unsigned int pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = ${adpcmGenerated.adpcmAssets.length};`,
      `const unsigned int pce_editor_psg_asset_count PCE_EDITOR_RODATA_SECTION = ${psgGenerated.psgAssets.length};`,
      `const unsigned int pce_editor_cdda_asset_count PCE_EDITOR_RODATA_SECTION = ${cddaGenerated.cddaAssets.length};`,
      '',
    ] : [
      'const pce_editor_bg_asset_t pce_editor_bg_assets[] PCE_EDITOR_RODATA_SECTION = {',
      ...(bgGenerated.metaLines.length ? bgGenerated.metaLines : [`  { ${emptyDataRef}, ${emptyDataRef}, ${emptyDataRef}, 0u, 0u, 0u, 0u, 0u }`]),
      '};',
      `const unsigned int pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = ${bgGenerated.converted.length};`,
      '',
      'const pce_editor_sprite_asset_t pce_editor_sprite_assets[] PCE_EDITOR_RODATA_SECTION = {',
      ...(spriteGenerated.metaLines.length ? spriteGenerated.metaLines : [`  { ${emptyDataRef}, ${emptyDataRef}, 0u, 0u, 0u, 0u, 0u, 0u }`]),
      '};',
      'const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[] PCE_EDITOR_RODATA_SECTION = {',
      ...(spriteGenerated.drawMetaLines.length ? spriteGenerated.drawMetaLines : ['  { 16u, 16u, 1u, 1u, 384u, 0u }']),
      '};',
      `const unsigned int pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = ${spriteGenerated.converted.length};`,
      '',
      'const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[] PCE_EDITOR_RODATA_SECTION = {',
      ...(adpcmGenerated.metaLines.length ? adpcmGenerated.metaLines : ['  { (const unsigned char *)0, 0u, 0u, 0u, 0u, 0u, 0u, (const pce_editor_cd_data_ref_t *)0 }']),
      '};',
      `const unsigned int pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = ${adpcmGenerated.adpcmAssets.length};`,
      '',
      'const pce_editor_psg_asset_t pce_editor_psg_assets[] PCE_EDITOR_RODATA_SECTION = {',
      ...(psgGenerated.metaLines.length ? psgGenerated.metaLines : ['  { 0u, 512u, 150u, 0u, (const pce_editor_psg_step_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }']),
      '};',
      `const unsigned int pce_editor_psg_asset_count PCE_EDITOR_RODATA_SECTION = ${psgGenerated.psgAssets.length};`,
      '',
      'const pce_editor_cdda_asset_t pce_editor_cdda_assets[] PCE_EDITOR_RODATA_SECTION = {',
      ...(cddaGenerated.metaLines.length ? cddaGenerated.metaLines : ['  { 0u, 0u, { 0u, 0u, 0u }, { 0u, 0u, 0u }, { 0u, 0u, 0u }, 0u }']),
      '};',
      `const unsigned int pce_editor_cdda_asset_count PCE_EDITOR_RODATA_SECTION = ${cddaGenerated.cddaAssets.length};`,
      '',
    ]),
    '',
    'const char * const pce_editor_image_rows[] PCE_EDITOR_RODATA_SECTION = {',
    `${quotedRows.join(',\n')}`,
    '};',
    `const unsigned char pce_editor_image_row_count PCE_EDITOR_RODATA_SECTION = ${rows.length};`,
    `const unsigned int pce_editor_tone_period PCE_EDITOR_RODATA_SECTION = ${Math.max(1, Math.min(4095, tonePeriod))};`,
    '',
    'void pce_editor_map_asset_bank(unsigned char bank)',
    '{',
    '#if defined(__PCE__) && !defined(__CC65__)',
    '  switch (bank) {',
    ...bankSwitchLines,
    '    default: break;',
    '  }',
    '#else',
    '  (void)bank;',
    '#endif',
    '}',
    'unsigned char pce_editor_cc65_bss_anchor;',
    '',
  ];

  const generatedDir = path.join(projectDir, 'src', 'generated');
  ensureDirSync(generatedDir);
  const headerPath = path.join(generatedDir, 'assets.h');
  const sourcePath = path.join(generatedDir, 'assets.c');
  fs.writeFileSync(headerPath, linesH.join('\n'), 'utf-8');
  fs.writeFileSync(sourcePath, linesC.join('\n'), 'utf-8');
  return {
    headerPath,
    sourcePath,
    assetCount: sourceDoc.assets.length,
    imageRows: rows.length,
    bgCount: bgGenerated.converted.length,
    spriteCount: spriteGenerated.converted.length,
    bankedChunkCount: bankAllocator.banks.length,
    requiresLlvmMos: bankAllocator.banks.length > 0,
    psgCount: psgGenerated.psgAssets.length,
    adpcmCount: adpcmGenerated.adpcmAssets.length,
    cddaCount: cddaGenerated.cddaAssets.length,
    assetCatalogMode: assetMetaOnCd ? 'cd' : 'resident',
    assetCatalogReason: assetMetaInfo.reason,
    assetCatalogBytes: assetMetaOnCd ? metaLayout.byteSize : 0,
    assetCatalogCounts: assetMetaInfo.counts || {
      bg: bgGenerated.converted.length,
      sprite: spriteGenerated.converted.length,
      adpcm: adpcmGenerated.adpcmAssets.length,
      psg: psgGenerated.psgAssets.length,
      cdda: cddaGenerated.cddaAssets.length,
    },
  };
}

module.exports = {
  ASSET_FILE,
  DEFAULT_BG_OPTIONS,
  DEFAULT_ADPCM_OPTIONS,
  DEFAULT_CDDA_OPTIONS,
  DEFAULT_PALETTE_OPTIONS,
  DEFAULT_PSG_OPTIONS,
  DEFAULT_SPRITE_OPTIONS,
  DEFAULT_SPRITE_ANIMATION,
  SPRITE_CELL_SIZES,
  SUPPORTED_TYPES,
  buildInternalPceConversionPlan,
  buildCdDataLayout,
  assetMetaDecision,
  assetMetaShouldUseCd,
  buildAssetMetaBuffer,
  computeAssetMetaLayout,
  ensurePsgPatternFiles,
  ensureAssetMetaReservation,
  collectCdDataFiles,
  ASSET_META_FILE,
  psgPatternFile,
  defaultAssets,
  deleteAsset,
  decodePngImage,
  ensureAssetFile,
  generateAssetSources,
  getAssetFilePath,
  importAudio,
  importImage,
  importVgm,
  importMidi,
  previewMidi,
  listAssets,
  normalizeAsset,
  normalizeAssetDocument,
  previewSource,
  readAssetDocument,
  readPceImageJson,
  reorderAssets,
  resolveAssetSource,
  runInternalPceImageConversion,
  pceColorComponent,
  pceColorFromRgb,
  pcePaletteWord,
  sampleRateToAdpcmDivider: audioConverter.sampleRateToAdpcmDivider,
  upsertAsset,
  writeAssetDocument,
};
