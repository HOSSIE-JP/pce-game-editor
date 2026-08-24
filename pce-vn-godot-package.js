'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ensureVisualGeneratedAsset, normalizeAssetDocument } = require('./pce-asset-manager');
const { isCommandSkipped, normalizeSceneDocument, readFontConfig } = require('./pce-vn-manager');
const { isPathInside, normalizeRelativePath } = require('./pce-file-safety');
const { GODOT_OGG_VORBIS_QUALITY, encodeWavToOggVorbis } = require('./pce-vn-godot-audio');
const { buildPceVisualPng } = require('./pce-vn-godot-image');

const PACKAGE_FORMAT = 'pce-vn-godot-package';
const PACKAGE_VERSION = 3;
const ASSET_DOCUMENT_VERSION = 2;
const MANIFEST_FILE = 'pcevn-package.json';
const SCENES_FILE = 'data/scenes.json';
const ASSETS_FILE = 'data/assets.json';
const SUPPORTED_VISUAL_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.wav', '.ogg', '.mp3']);

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(`${label}を読み込めません: ${error?.message || error}`);
  }
}

function stableProjectId(project = {}, projectDir = '') {
  const seed = String(project.serial || project.romName || project.title || project.name || 'pce-vn').trim();
  const slug = seed
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'pce-vn';
  const identity = [
    project.coreId || 'pc-engine',
    project.id || project.projectId || project.uuid || path.resolve(String(projectDir || '')).toLowerCase(),
    project.serial || '',
    project.romName || '',
    project.title || project.name || '',
  ].join('\0');
  return `${slug}-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}

function packageSafeName(value, fallback = 'asset') {
  return String(value || fallback)
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
    .slice(0, 80) || fallback;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function referencedAssetIds(sceneDoc = {}) {
  const ids = new Set();
  (sceneDoc.scenes || []).forEach((scene) => {
    (scene.commands || []).forEach((command) => {
      if (!command || isCommandSkipped(command)) return;
      ['assetId', 'voiceAssetId', 'animationAssetId'].forEach((key) => {
        const id = String(command[key] || '').trim();
        if (id) ids.add(id);
      });
    });
  });
  return ids;
}

function resolveProjectFile(projectDir, relativePath) {
  const cleaned = normalizeRelativePath(String(relativePath || '').trim());
  if (!cleaned || cleaned.split('/').includes('..')) return '';
  const absolute = path.resolve(projectDir, cleaned);
  if (!isPathInside(projectDir, absolute) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return '';
  return absolute;
}

function previewSourceCandidates(asset = {}) {
  const generated = asset?.data?.generated || {};
  const values = asset.type === 'cdda-track'
    ? [generated.outputFile, asset.source]
    : [asset.source, generated.outputFile];
  return values.map((value) => String(value || '').trim()).filter((value, index, all) => value && all.indexOf(value) === index);
}

function requiredExtensionSet(asset = {}) {
  if (asset.type === 'image' || asset.type === 'sprite') return SUPPORTED_VISUAL_EXTENSIONS;
  if (asset.type === 'adpcm' || asset.type === 'cdda-track') return SUPPORTED_AUDIO_EXTENSIONS;
  return null;
}

function resolvePlaybackSource(projectDir, asset = {}) {
  const supported = requiredExtensionSet(asset);
  if (!supported) return null;
  for (const candidate of previewSourceCandidates(asset)) {
    const absolute = resolveProjectFile(projectDir, candidate);
    if (!absolute) continue;
    if (!supported.has(path.extname(absolute).toLowerCase())) continue;
    return absolute;
  }
  throw new Error(`再生用素材が見つかりません: ${asset.id} (${asset.type})`);
}

function resolveHighQualityVisualSource(projectDir, asset = {}) {
  const configured = String(asset?.data?.import?.highQualitySource || '').trim();
  if (!configured) {
    return { path: resolvePlaybackSource(projectDir, asset), fallback: true };
  }
  const absolute = resolveProjectFile(projectDir, configured);
  if (!absolute) {
    throw new Error(`HD版画像が見つかりません: ${asset.id} (${configured})`);
  }
  if (!SUPPORTED_VISUAL_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    throw new Error(`HD版画像形式に対応していません: ${asset.id} (${path.extname(absolute)})`);
  }
  return { path: absolute, fallback: false };
}

function resolveProjectFont(projectDir) {
  const config = readFontConfig(projectDir);
  const selected = resolveProjectFile(projectDir, config.fontPath);
  if (!selected) return '';
  return ['.ttf', '.otf', '.woff', '.woff2'].includes(path.extname(selected).toLowerCase()) ? selected : '';
}

function minimalAsset(asset, packagePath = '', visual = null) {
  const result = {
    id: asset.id,
    type: asset.type,
    name: asset.name || asset.id,
    file: packagePath,
    options: asset.options || {},
    data: {
      generated: asset?.data?.generated || {},
    },
  };
  if (visual) result.visual = visual;
  return result;
}

function audioPackageFileName(sourcePath, extension) {
  const sourceName = path.basename(sourcePath);
  return `${sourceName.slice(0, sourceName.length - path.extname(sourceName).length)}${extension}`;
}

async function buildGodotPackageBundle({
  projectDir,
  sceneDoc,
  now = () => new Date(),
  transcodeWavToOgg = encodeWavToOggVorbis,
} = {}) {
  const root = path.resolve(String(projectDir || ''));
  if (!root || !fs.existsSync(path.join(root, 'project.json'))) {
    throw new Error('有効なPC Engineプロジェクトが開かれていません。');
  }
  const project = readJsonFile(path.join(root, 'project.json'), 'project.json');
  if (String(project.coreId || '') !== 'pc-engine') {
    throw new Error('PC EngineプロジェクトだけをGodot再生パッケージへ出力できます。');
  }
  const rawAssetDoc = readJsonFile(path.join(root, 'assets', 'pce-assets.json'), 'assets/pce-assets.json');
  const assetDoc = normalizeAssetDocument(rawAssetDoc);
  const sourceScenes = sceneDoc && typeof sceneDoc === 'object'
    ? sceneDoc
    : readJsonFile(path.join(root, 'assets', 'pce-vn-scenes.json'), 'assets/pce-vn-scenes.json');
  const scenes = normalizeSceneDocument(sourceScenes, assetDoc);
  const referenced = referencedAssetIds(scenes);
  const assetsById = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset]));
  const missingIds = [...referenced].filter((id) => !assetsById.has(id)).sort();
  if (missingIds.length) {
    throw new Error(`未登録アセットを参照しています: ${missingIds.join(', ')}`);
  }

  const mediaEntries = [];
  const packagedAssets = [];
  const audioStats = {
    assets: 0,
    transcoded: 0,
    sourceBytes: 0,
    packageBytes: 0,
  };
  const visualStats = {
    assets: 0,
    highQualityBytes: 0,
    pceBytes: 0,
    highQualityFallbacks: 0,
  };
  const referencedIds = [...referenced].sort();
  for (let index = 0; index < referencedIds.length; index += 1) {
    const id = referencedIds[index];
    let asset = assetsById.get(id);
    const isVisual = asset.type === 'image' || asset.type === 'sprite';
    let packagePath = '';
    let visual = null;
    if (isVisual) {
      asset = ensureVisualGeneratedAsset(root, asset);
      const highQuality = resolveHighQualityVisualSource(root, asset);
      const highQualityExtension = path.extname(highQuality.path).toLowerCase();
      const highQualityData = fs.readFileSync(highQuality.path);
      const pceImage = buildPceVisualPng(root, asset);
      const mediaRoot = `media/${String(index).padStart(4, '0')}_${packageSafeName(id)}`;
      const highQualityPackagePath = `${mediaRoot}/hd${highQualityExtension}`;
      const pcePackagePath = `${mediaRoot}/pce.png`;
      mediaEntries.push(
        {
          name: highQualityPackagePath,
          data: highQualityData,
          mtime: fs.statSync(highQuality.path).mtime,
        },
        {
          name: pcePackagePath,
          data: pceImage.data,
          mtime: fs.statSync(highQuality.path).mtime,
        },
      );
      packagePath = highQualityPackagePath;
      visual = {
        defaultMode: 'hd',
        hd: {
          file: highQualityPackagePath,
          width: pceImage.width,
          height: pceImage.height,
          source: highQuality.fallback ? 'asset-source-fallback' : 'pre-pce-quantize',
        },
        pce: {
          file: pcePackagePath,
          width: pceImage.width,
          height: pceImage.height,
          source: 'generated-pce-binary',
        },
      };
      visualStats.assets += 1;
      visualStats.highQualityBytes += highQualityData.length;
      visualStats.pceBytes += pceImage.data.length;
      if (highQuality.fallback) visualStats.highQualityFallbacks += 1;
    } else {
      const sourcePath = resolvePlaybackSource(root, asset);
      if (!sourcePath) {
        packagedAssets.push(minimalAsset(asset));
        continue;
      }
      const sourceExtension = path.extname(sourcePath).toLowerCase();
      const isAudio = asset.type === 'adpcm' || asset.type === 'cdda-track';
      const sourceData = fs.readFileSync(sourcePath);
      let packageData = sourceData;
      let packageFileName = path.basename(sourcePath);
      if (isAudio) {
        audioStats.assets += 1;
        audioStats.sourceBytes += sourceData.length;
        if (sourceExtension === '.wav') {
          let conversion;
          try {
            conversion = await transcodeWavToOgg(sourceData, {
              quality: GODOT_OGG_VORBIS_QUALITY,
              asset,
              sourcePath,
            });
          } catch (error) {
            throw new Error(`Ogg Vorbisへ変換できません: ${asset.id} (${error?.message || error})`);
          }
          packageData = conversion?.output;
          if (!Buffer.isBuffer(packageData) || packageData.length === 0) {
            throw new Error(`Ogg Vorbis変換結果が不正です: ${asset.id}`);
          }
          packageFileName = audioPackageFileName(sourcePath, '.ogg');
          audioStats.transcoded += 1;
        }
        audioStats.packageBytes += packageData.length;
      }
      const fileName = packageSafeName(packageFileName, `asset${path.extname(packageFileName)}`);
      packagePath = `media/${String(index).padStart(4, '0')}_${packageSafeName(id)}/${fileName}`;
      mediaEntries.push({
        name: packagePath,
        data: packageData,
        mtime: fs.statSync(sourcePath).mtime,
      });
    }
    packagedAssets.push(minimalAsset(asset, packagePath, visual));
  }

  const fontPath = resolveProjectFont(root);
  let packageFontPath = '';
  if (fontPath) {
    packageFontPath = `font/${packageSafeName(path.basename(fontPath), 'message-font.ttf')}`;
    mediaEntries.push({
      name: packageFontPath,
      data: fs.readFileSync(fontPath),
      mtime: fs.statSync(fontPath).mtime,
    });
  }

  const scenesBuffer = jsonBuffer(scenes);
  const assetsBuffer = jsonBuffer({ version: ASSET_DOCUMENT_VERSION, assets: packagedAssets });
  const contentEntries = [
    { name: SCENES_FILE, data: scenesBuffer },
    { name: ASSETS_FILE, data: assetsBuffer },
    ...mediaEntries,
  ].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const files = contentEntries.map((entry) => ({
    path: entry.name,
    bytes: entry.data.length,
    sha256: sha256(entry.data),
  }));
  const manifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    createdAt: now().toISOString(),
    project: {
      id: stableProjectId(project, root),
      title: String(project.title || project.romName || project.name || 'PCE VN'),
      author: String(project.author || ''),
      serial: String(project.serial || ''),
      platform: String(project.platform || 'pce'),
      targetMedia: String(project.targetMedia || ''),
    },
    entrypoints: {
      scenes: SCENES_FILE,
      assets: ASSETS_FILE,
      font: packageFontPath,
      border: '',
    },
    visual: {
      defaultMode: 'hd',
      modes: ['hd', 'pce'],
    },
    audio: {
      wavTranscode: 'ogg-vorbis',
      extension: '.ogg',
      quality: GODOT_OGG_VORBIS_QUALITY,
    },
    stats: {
      scenes: scenes.scenes.length,
      commands: scenes.scenes.reduce((sum, scene) => sum + scene.commands.filter((command) => !isCommandSkipped(command) && command.type !== 'comment').length, 0),
      assets: packagedAssets.length,
      visualAssets: visualStats.assets,
      visualHighQualityBytes: visualStats.highQualityBytes,
      visualPceBytes: visualStats.pceBytes,
      visualHighQualityFallbackAssets: visualStats.highQualityFallbacks,
      audioAssets: audioStats.assets,
      transcodedAudioAssets: audioStats.transcoded,
      audioSourceBytes: audioStats.sourceBytes,
      audioPackageBytes: audioStats.packageBytes,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    },
    files,
  };
  return {
    manifest,
    entries: [
      { name: MANIFEST_FILE, data: jsonBuffer(manifest) },
      ...contentEntries,
    ],
  };
}

async function exportGodotPackageZip({
  projectDir,
  sceneDoc,
  defaultPath = 'pce-vn.pcevn.zip',
  owner,
  showSaveDialog,
  createStoredZipBuffer,
  writeFileSync,
  transcodeWavToOgg,
} = {}) {
  try {
    const result = await showSaveDialog(owner, {
      title: 'Godot再生パッケージをエクスポート',
      defaultPath,
      filters: [
        { name: 'PCE VN Godot package', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result?.canceled || !result?.filePath) {
      return { ok: false, canceled: true, path: '', error: '' };
    }
    const bundle = await buildGodotPackageBundle({ projectDir, sceneDoc, transcodeWavToOgg });
    writeFileSync(result.filePath, createStoredZipBuffer(bundle.entries));
    return {
      ok: true,
      canceled: false,
      path: result.filePath,
      projectId: bundle.manifest.project.id,
      sceneCount: bundle.manifest.stats.scenes,
      commandCount: bundle.manifest.stats.commands,
      assetCount: bundle.manifest.stats.assets,
      contentBytes: bundle.manifest.stats.bytes,
      visualAssetCount: bundle.manifest.stats.visualAssets,
      visualHighQualityBytes: bundle.manifest.stats.visualHighQualityBytes,
      visualPceBytes: bundle.manifest.stats.visualPceBytes,
      visualHighQualityFallbackAssetCount: bundle.manifest.stats.visualHighQualityFallbackAssets,
      audioAssetCount: bundle.manifest.stats.audioAssets,
      transcodedAudioAssetCount: bundle.manifest.stats.transcodedAudioAssets,
      audioSourceBytes: bundle.manifest.stats.audioSourceBytes,
      audioPackageBytes: bundle.manifest.stats.audioPackageBytes,
      error: '',
    };
  } catch (error) {
    return { ok: false, canceled: false, path: '', error: String(error?.message || error) };
  }
}

module.exports = {
  ASSET_DOCUMENT_VERSION,
  ASSETS_FILE,
  MANIFEST_FILE,
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  SCENES_FILE,
  buildGodotPackageBundle,
  exportGodotPackageZip,
  referencedAssetIds,
  stableProjectId,
};
