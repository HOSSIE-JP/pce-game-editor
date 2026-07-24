'use strict';

const { normalizeRelativePath } = require('./pce-file-safety');

function isUnsupportedGeneratedVisualRleFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath || '');
  return normalized.startsWith('assets/generated/')
    && /\/(?:patterns|tiles|map_vram)\.rle$/i.test(normalized);
}

function isManagedGeneratedFile(relativePath) {
  return normalizeRelativePath(relativePath || '').startsWith('assets/generated/');
}

function mergeCurrentCdDataFiles({
  generatedDataFiles = [],
  configuredDataFiles = [],
  managedPaths = [],
  scenePackDir = '',
} = {}) {
  const managed = managedPaths instanceof Set ? managedPaths : new Set(managedPaths);
  const scenePackPrefix = `${normalizeRelativePath(scenePackDir || '')}/`;
  const merged = new Set(generatedDataFiles.map((entry) => normalizeRelativePath(entry || '')).filter(Boolean));
  (Array.isArray(configuredDataFiles) ? configuredDataFiles : []).forEach((entry) => {
    const normalized = normalizeRelativePath(entry || '');
    if (!normalized || merged.has(normalized)) return;
    if (managed.has(normalized) || (scenePackDir && normalized.startsWith(scenePackPrefix))) return;
    // assets/generated is build output. Entries not present in the freshly
    // generated catalog are stale (for example after switching HuCARD -> CD or
    // changing an asset ID) and must not survive as manually configured data.
    if (isManagedGeneratedFile(normalized)) return;
    if (isUnsupportedGeneratedVisualRleFile(normalized)) return;
    merged.add(normalized);
  });
  return Array.from(merged);
}

module.exports = {
  isManagedGeneratedFile,
  isUnsupportedGeneratedVisualRleFile,
  mergeCurrentCdDataFiles,
};
