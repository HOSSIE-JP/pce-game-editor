'use strict';

const path = require('path');
const { normalizeRelativePath } = require('./pce-file-safety');

function isLikelyAbsolutePath(value = '') {
  const raw = String(value || '');
  return path.isAbsolute(raw) || /^[a-zA-Z]:[\/]/.test(raw) || /^\\/.test(raw);
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

function normalizedInt(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function normalizeGeneratedData(data = {}) {
  if (!data || typeof data !== 'object') return {};
  if (!data.generated || typeof data.generated !== 'object') return { ...data };
  const raw = data.generated;
  const generated = {
    paletteFile: normalizeAssetSource(raw.paletteFile || ''),
    tilesFile: normalizeAssetSource(raw.tilesFile || ''),
    cellMapFile: normalizeAssetSource(raw.cellMapFile || ''),
    mapFile: normalizeAssetSource(raw.mapFile || ''),
    mapVramFile: normalizeAssetSource(raw.mapVramFile || ''),
    outputFile: normalizeAssetSource(raw.outputFile || ''),
    previewFile: normalizeAssetSource(raw.previewFile || ''),
    tileCount: normalizedInt(raw.tileCount, 0, 65535),
    paletteCount: normalizedInt(raw.paletteCount, 0, 32),
    vramBytes: normalizedInt(raw.vramBytes, 0, 65535),
    byteLength: normalizedInt(raw.byteLength, 0, 0x7fffffff),
    sampleRate: normalizedInt(raw.sampleRate, 0, 192000),
    channels: normalizedInt(raw.channels, 0, 8),
    durationSeconds: Number.isFinite(Number(raw.durationSeconds)) ? Number(raw.durationSeconds) : 0,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).filter(Boolean) : [],
    paletteColors: Array.isArray(raw.paletteColors) ? raw.paletteColors.map(String).filter(Boolean).slice(0, 256) : [],
    waveform: Array.isArray(raw.waveform)
      ? raw.waveform.map((value) => Math.max(0, Math.min(1, Number(value) || 0))).slice(0, 256)
      : [],
  };
  if (raw.codec) generated.codec = String(raw.codec).trim();
  if (raw.encoderVersion != null) generated.encoderVersion = normalizedInt(raw.encoderVersion, 0, 0xffff);
  if (raw.nibbleOrder) generated.nibbleOrder = String(raw.nibbleOrder).trim();
  return {
    ...data,
    generated,
  };
}

function normalizeSpriteEditorMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  return {
    frameWidth: normalizedInt(metadata.frameWidth, 1, 1024, 16),
    frameHeight: normalizedInt(metadata.frameHeight, 1, 1024, 16),
    time: String(metadata.time || ''),
    rowFrameCounts: Array.isArray(metadata.rowFrameCounts)
      ? metadata.rowFrameCounts.map((value) => normalizedInt(value, 1, 64, 1)).slice(0, 64)
      : [],
    rowDefaultTimes: Array.isArray(metadata.rowDefaultTimes)
      ? metadata.rowDefaultTimes.map((value) => String(value || '')).slice(0, 64)
      : [],
    collision: String(metadata.collision || 'NONE'),
  };
}

module.exports = {
  isLikelyAbsolutePath,
  normalizeAssetSource,
  normalizeGeneratedData,
  normalizeSpriteEditorMetadata,
};
