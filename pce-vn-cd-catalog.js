'use strict';

const fs = require('fs');
const path = require('path');

function createVnCdCatalog(options = {}) {
  const {
    assetManager,
    compiledSceneCommands,
    normalizeAssetId,
    normalizeRelativePath,
    readSceneDocument,
    scenePackRelativePath,
    enableVisualPayloadCache = false,
    files: managedFiles = {},
  } = options;
  if (!assetManager || typeof readSceneDocument !== 'function' || typeof compiledSceneCommands !== 'function') {
    throw new Error('VN CD catalog dependencies are required');
  }

  function addExisting(projectDir, files, seen, relativePath) {
    const normalized = normalizeRelativePath(relativePath || '');
    if (!normalized || seen.has(normalized) || !fs.existsSync(path.join(projectDir, normalized))) return;
    seen.add(normalized);
    files.push(normalized);
  }

  function add(files, seen, relativePath) {
    const normalized = normalizeRelativePath(relativePath || '');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    files.push(normalized);
  }

  function addAssetFiles(projectDir, files, seen, asset, catalogMode) {
    if (!asset) return;
    const generated = asset.data?.generated || {};
    if (asset.type === 'image') {
      addExisting(projectDir, files, seen, generated.tilesFile);
      addExisting(projectDir, files, seen, generated.mapVramFile);
    } else if (asset.type === 'sprite') {
      addExisting(projectDir, files, seen, generated.tilesFile);
    } else if (asset.type === 'adpcm') {
      addExisting(projectDir, files, seen, generated.outputFile);
    } else if ((asset.type === 'psg-song' || asset.type === 'psg-sfx') && catalogMode && typeof assetManager.psgPatternFile === 'function') {
      addExisting(projectDir, files, seen, assetManager.psgPatternFile(asset));
    }
  }

  function commandAssetIds(scene = {}) {
    const ids = [];
    compiledSceneCommands(scene).forEach((command) => {
      if (command.type === 'background' || command.type === 'sprite') {
        if (command.assetId) ids.push(command.assetId);
      } else if (command.type === 'message') {
        if (command.voiceAssetId) ids.push(command.voiceAssetId);
      } else if (command.type === 'audio' && command.action === 'play') {
        if (command.assetId) ids.push(command.assetId);
      } else if (command.type === 'cache' && command.action === 'load' && command.assetId) {
        ids.push(command.assetId);
      }
    });
    return ids;
  }

  function collectSceneRuntimeAssetIds(doc = {}) {
    const ids = new Set();
    (doc.scenes || []).forEach((scene) => commandAssetIds(scene).forEach((assetId) => {
      const normalized = normalizeAssetId(assetId);
      if (normalized) ids.add(normalized);
    }));
    return ids;
  }

  function collectCdDataFiles(projectDir) {
    const assetDoc = assetManager.readAssetDocument(projectDir);
    const doc = readSceneDocument(projectDir);
    const assets = new Map((assetDoc.assets || []).filter((asset) => asset?.id).map((asset) => [asset.id, asset]));
    const runtimeAssetIds = collectSceneRuntimeAssetIds(doc);
    const runtimeAssetDoc = {
      ...assetDoc,
      assets: (assetDoc.assets || []).filter((asset) => asset?.id && runtimeAssetIds.has(String(asset.id))),
    };
    const catalogMode = typeof assetManager.assetMetaShouldUseCd === 'function'
      && assetManager.assetMetaShouldUseCd(projectDir, runtimeAssetDoc);
    const files = [];
    const seen = new Set();
    add(files, seen, managedFiles.fontData);
    addExisting(projectDir, files, seen, managedFiles.overlayData);
    if (enableVisualPayloadCache) addExisting(projectDir, files, seen, managedFiles.visualCodeData);
    addExisting(projectDir, files, seen, managedFiles.cdAsyncCodeData);
    addExisting(projectDir, files, seen, managedFiles.fontSpriteData);
    if (catalogMode) addExisting(projectDir, files, seen, assetManager.ASSET_META_FILE);
    (doc.scenes || []).forEach((scene, sceneIndex) => {
      add(files, seen, scenePackRelativePath(scene, sceneIndex));
      commandAssetIds(scene).forEach((assetId) => addAssetFiles(projectDir, files, seen, assets.get(assetId), catalogMode));
    });
    return files;
  }

  return { collectCdDataFiles, collectSceneRuntimeAssetIds };
}

module.exports = { createVnCdCatalog };
