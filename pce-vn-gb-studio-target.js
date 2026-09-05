'use strict';

const OUTPUT_TARGET_MODES = Object.freeze(['dual', 'gbc', 'gb']);

function normalizeOutputTargetMode(value) {
  return OUTPUT_TARGET_MODES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'dual';
}

function outputModesForTarget(value) {
  const target = normalizeOutputTargetMode(value);
  if (target === 'gbc') return ['gbc'];
  if (target === 'gb') return ['dmg'];
  return ['gbc', 'dmg'];
}

function gbStudioColorMode(value) {
  const target = normalizeOutputTargetMode(value);
  return target === 'gbc' ? 'color' : target === 'gb' ? 'mono' : 'mixed';
}

function sceneColorModeOverride(targetValue, outputMode) {
  if (outputMode === 'gbc') return 'color';
  return normalizeOutputTargetMode(targetValue) === 'gb' ? 'none' : 'mixed';
}

function expectedCgbFlag(value) {
  const target = normalizeOutputTargetMode(value);
  return target === 'gbc' ? 0xc0 : target === 'gb' ? 0x00 : 0x80;
}

function outputTargetLabel(value) {
  const target = normalizeOutputTargetMode(value);
  return target === 'gbc' ? 'GBC専用 (Color)' : target === 'gb' ? 'GB専用 (Monochrome)' : 'GB/GBC両対応 (Color + Monochrome)';
}

module.exports = {
  OUTPUT_TARGET_MODES,
  expectedCgbFlag,
  gbStudioColorMode,
  normalizeOutputTargetMode,
  outputModesForTarget,
  outputTargetLabel,
  sceneColorModeOverride,
};
