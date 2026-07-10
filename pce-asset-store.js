'use strict';

const fs = require('fs');
const path = require('path');

function createPceAssetStore({ assetFile = 'assets/pce-assets.json', normalizeAsset, normalizeAssetDocument, resolveUnderRoot } = {}) {
  if (typeof normalizeAsset !== 'function' || typeof normalizeAssetDocument !== 'function' || typeof resolveUnderRoot !== 'function') {
    throw new Error('PCE asset store dependencies are required');
  }
  const defaultAssets = () => ({ version: 2, assets: [] });
  const getAssetFilePath = (projectDir) => path.join(path.resolve(projectDir), assetFile);

  function ensureAssetFile(projectDir) {
    const filePath = getAssetFilePath(projectDir);
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(defaultAssets(), null, 2), 'utf-8');
    }
    return filePath;
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

  const readAssetDocument = (projectDir) => normalizeAssetDocument(readRawAssetDocument(projectDir));

  function writeAssetDocument(projectDir, doc) {
    const normalized = normalizeAssetDocument(doc);
    const filePath = getAssetFilePath(projectDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
  }

  function resolveAssetSource(projectDir, asset) {
    const normalized = normalizeAsset(asset);
    if (!normalized.source) return { asset: normalized, absPath: null };
    const { absPath } = resolveUnderRoot(projectDir, normalized.source, 'project');
    return { asset: normalized, absPath };
  }

  function listAssets(projectDir) {
    const doc = readAssetDocument(projectDir);
    return {
      file: assetFile,
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
        return { ...asset, exists, pathError };
      }),
    };
  }

  function upsertAsset(projectDir, nextAsset) {
    const doc = readAssetDocument(projectDir);
    const asset = normalizeAsset(nextAsset);
    const index = doc.assets.findIndex((entry) => entry.id === asset.id);
    if (index >= 0) doc.assets[index] = asset;
    else doc.assets.push(asset);
    return writeAssetDocument(projectDir, doc);
  }

  function deleteAsset(projectDir, id) {
    const doc = readAssetDocument(projectDir);
    const assetId = String(id || '').trim();
    const nextAssets = doc.assets.filter((asset) => asset.id !== assetId);
    if (nextAssets.length === doc.assets.length) throw new Error(`asset not found: ${assetId}`);
    return writeAssetDocument(projectDir, { ...doc, assets: nextAssets });
  }

  function reorderAssets(projectDir, ids = []) {
    const doc = readAssetDocument(projectDir);
    const order = Array.isArray(ids) ? ids.map((id) => String(id)).filter(Boolean) : [];
    const byId = new Map(doc.assets.map((asset) => [asset.id, asset]));
    const nextAssets = [];
    order.forEach((id) => {
      if (!byId.has(id)) return;
      nextAssets.push(byId.get(id));
      byId.delete(id);
    });
    nextAssets.push(...doc.assets.filter((asset) => byId.has(asset.id)));
    return writeAssetDocument(projectDir, { ...doc, assets: nextAssets });
  }

  return {
    defaultAssets, deleteAsset, ensureAssetFile, getAssetFilePath, listAssets,
    readAssetDocument, readRawAssetDocument, reorderAssets, resolveAssetSource,
    upsertAsset, writeAssetDocument,
  };
}

module.exports = { createPceAssetStore };
