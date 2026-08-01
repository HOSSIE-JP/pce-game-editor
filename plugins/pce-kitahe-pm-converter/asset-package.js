'use strict';

const fs = require('node:fs');
const path = require('node:path');
const converter = require('./converter');
const assetManager = require('../../pce-asset-manager');
const audioConverter = require('../../pce-audio-converter');
const adpcmCsv = require('../../pce-adpcm-batch-csv');

const MANIFEST_FILE_NAME = 'kitahe-pm-assets.csv';
const MANIFEST_VERSION = '1';
const MANIFEST_HEADERS = Object.freeze([
  'version',
  'kind',
  'targetType',
  'sourceKey',
  'source',
  'file',
  'id',
  'name',
  'usage',
  'playbackRate',
  'loop',
  'sampleRate',
  'splitPolicy',
  'details',
]);
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_FILE_BYTES = 64 * 1024 * 1024;
const IMAGE_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function withinPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function addError(row, message) {
  const text = String(message || '').trim();
  if (text && !row.errors.includes(text)) row.errors.push(text);
}

function addWarning(row, message) {
  const text = String(message || '').trim();
  if (text && !row.warnings.includes(text)) row.warnings.push(text);
}

function requireManifest(manifestPath) {
  const requested = String(manifestPath || '').trim();
  if (!requested || !path.isAbsolute(requested)) throw new Error('manifestPathには絶対pathを指定してください');
  if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) throw new Error('北へ。PM asset manifestが見つかりません');
  if (fs.lstatSync(requested).isSymbolicLink()) throw new Error('manifestのsymlinkは使用できません');
  const absolutePath = fs.realpathSync(requested);
  if (path.basename(absolutePath) !== MANIFEST_FILE_NAME) {
    throw new Error(`manifest file名は${MANIFEST_FILE_NAME}である必要があります`);
  }
  const stat = fs.statSync(absolutePath);
  if (stat.size > MAX_MANIFEST_BYTES) throw new Error(`manifestが${MAX_MANIFEST_BYTES} bytesを超えます`);
  return {
    manifestPath: absolutePath,
    manifestFileName: path.basename(absolutePath),
    packageRoot: fs.realpathSync(path.dirname(absolutePath)),
    bytes: fs.readFileSync(absolutePath),
  };
}

function resolvePackageFile(packageRoot, relativePath) {
  const raw = String(relativePath || '').trim();
  if (!raw || /[\u0000-\u001f\u007f:]/u.test(raw)
    || raw.includes('\\') || path.isAbsolute(raw) || /^[a-z]:/iu.test(raw)) {
    throw new Error('fileにはpackage rootからのforward-slash relative pathを指定してください');
  }
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('fileのpath traversalを拒否しました');
  }
  let candidate = packageRoot;
  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    if (!fs.existsSync(candidate)) throw new Error(`fileが見つかりません: ${raw}`);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error(`fileのsymlink/junctionを拒否しました: ${raw}`);
  }
  const resolved = fs.realpathSync(candidate);
  if (!withinPath(packageRoot, resolved)) throw new Error(`fileがpackage root外を参照しています: ${raw}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`fileは通常fileではありません: ${raw}`);
  if (stat.size > MAX_PACKAGE_FILE_BYTES) throw new Error(`fileが${MAX_PACKAGE_FILE_BYTES} bytesを超えます: ${raw}`);
  return { relativePath: segments.join('/'), absolutePath: resolved, size: stat.size };
}

function parseDetails(raw, row) {
  const text = String(raw || '').trim();
  if (!text) {
    addError(row, 'detailsは必須です');
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      addError(row, 'detailsはJSON objectである必要があります');
      return {};
    }
    if (converter.stableJson(parsed) !== text) addError(row, 'detailsはcanonical JSONである必要があります');
    return parsed;
  } catch (error) {
    addError(row, `details JSONを読めません: ${String(error.message || error)}`);
    return {};
  }
}

function parsePositiveInteger(value, label, row, fallback = 0) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    addError(row, `${label}は正の整数である必要があります`);
    return fallback;
  }
  return parsed;
}

function expectedSourceKey(row) {
  if (row.kind === 'image') return converter.assetSourceKey('image', row.details.parts, row.details);
  if (row.kind === 'p04') {
    return converter.assetSourceKey('p04', row.source, {
      usage: row.usage,
      loop: row.loop,
      playbackRate: row.playbackRate,
    });
  }
  if (row.kind === 'midi') return converter.assetSourceKey('midi', row.source, row.details);
  return '';
}

function inspectImage(row, bytes) {
  if (!IMAGE_SIGNATURE.equals(bytes.subarray(0, IMAGE_SIGNATURE.length))) {
    addError(row, 'image fileはPNGではありません');
    return;
  }
  try {
    const decoded = assetManager.decodePngImage(bytes);
    row.preview = {
      mime: 'image/png',
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      width: decoded.width,
      height: decoded.height,
      byteLength: bytes.length,
    };
    if (row.targetType === 'background') {
      if ((decoded.width % 8) !== 0 || (decoded.height % 8) !== 0) {
        addError(row, 'BG PNGは幅・高さとも8px境界である必要があります');
      }
      if (decoded.width > 256 || decoded.height > 224) addError(row, 'BG PNGは最大256x224pxです');
    } else {
      const cell = row.details.spriteCell && typeof row.details.spriteCell === 'object'
        ? row.details.spriteCell
        : {};
      const cellWidth = Number(row.details.cellWidth ?? cell.width);
      const cellHeight = Number(row.details.cellHeight ?? cell.height);
      row.cellWidth = cellWidth;
      row.cellHeight = cellHeight;
      if (!assetManager.SPRITE_CELL_SIZES.has(`${cellWidth}x${cellHeight}`)) {
        addError(row, `Sprite cell sizeは${Array.from(assetManager.SPRITE_CELL_SIZES).join(', ')}のいずれかです`);
      } else if ((decoded.width % cellWidth) !== 0 || (decoded.height % cellHeight) !== 0) {
        addError(row, 'Sprite PNGは選択cell size境界である必要があります');
      }
      if (decoded.width > assetManager.PCE_IMAGE_MAX_WIDTH || decoded.height > assetManager.PCE_SPRITE_MAX_HEIGHT) {
        addError(row, 'Sprite PNGがPCE asset寸法上限を超えます');
      }
    }
  } catch (error) {
    addError(row, `PNGを読み込めません: ${String(error.message || error)}`);
  }
}

function inspectP04(row, bytes) {
  try {
    const wav = audioConverter.parseWav(bytes);
    if (wav.sampleRate !== row.playbackRate) {
      addError(row, `WAV sample rate ${wav.sampleRate}HzとplaybackRate ${row.playbackRate}Hzが一致しません`);
    }
    const converted = audioConverter.convertWavForAdpcm(bytes, { sampleRate: row.sampleRate });
    const encodedBytes = converted.output.length;
    const warnings = Array.isArray(converted.warnings) ? converted.warnings : [];
    row.preview = {
      mime: 'audio/wav',
      durationSeconds: wav.durationSeconds,
      sourceSampleRate: wav.sampleRate,
      channels: wav.channels,
      sampleRate: row.sampleRate,
      playbackRate: row.playbackRate,
      encodedAdpcmBytes: encodedBytes,
      estimatedAdpcmBytes: encodedBytes,
      warnings,
      byteLength: bytes.length,
    };
    if (encodedBytes > adpcmCsv.ADPCM_BATCH_MAX_BYTES) {
      addError(row, `変換後${encodedBytes} bytesがADPCM上限${adpcmCsv.ADPCM_BATCH_MAX_BYTES} bytesを超えます`);
    }
  } catch (error) {
    addError(row, `WAVを読み込めません: ${String(error.message || error)}`);
  }
}

function inspectMidi(row, bytes, projectDir) {
  if (bytes.length < 14 || bytes.toString('ascii', 0, 4) !== 'MThd') {
    addError(row, 'MIDI file headerが不正です');
    return;
  }
  try {
    const converted = assetManager.previewMidi(projectDir, {
      sourcePath: row.filePath,
      type: 'psg-song',
    });
    row.preview = {
      mime: 'audio/midi',
      byteLength: bytes.length,
      type: converted.preview?.type || 'psg-song',
      bpm: converted.preview?.options?.bpm || 0,
      steps: converted.conversion?.steps || 0,
      patternCount: converted.conversion?.patternCount || 0,
      warnings: converted.conversion?.warnings || [],
      stats: converted.conversion?.stats || {},
    };
    (converted.conversion?.warnings || []).forEach((warning) => addWarning(row, warning));
  } catch (error) {
    addError(row, `MIDI→PSG previewに失敗しました: ${String(error.message || error)}`);
  }
}

function validateKindFields(row) {
  const expectedTargets = {
    image: new Set(['background', 'sprite']),
    p04: new Set(['adpcm']),
    midi: new Set(['psg-song']),
  };
  if (!expectedTargets[row.kind]) addError(row, 'kindはimage / p04 / midiのいずれかです');
  else if (!expectedTargets[row.kind].has(row.targetType)) addError(row, `${row.kind}のtargetTypeが不正です`);
  if (!/^[a-f0-9]{64}$/u.test(String(row.details.fileSha256 || ''))) {
    addError(row, 'details.fileSha256は64桁のlowercase hexである必要があります');
  }

  if (row.kind === 'image') {
    if (path.extname(row.file).toLowerCase() !== '.png') addError(row, 'image fileは.pngである必要があります');
    if (row.details.source !== row.source) addError(row, 'image details.sourceとsource列が一致しません');
    if (!Array.isArray(row.details.parts) || row.details.parts.length === 0) addError(row, 'image details.partsは必須です');
    if (!Array.isArray(row.details.crops) || row.details.crops.length !== row.details.parts?.length) {
      addError(row, 'image details.cropsはpartsと同数である必要があります');
    }
    const sourceFromParts = Array.isArray(row.details.parts) ? row.details.parts.join(' + ') : '';
    if (sourceFromParts && sourceFromParts !== row.source) addError(row, 'image sourceとdetails.partsが一致しません');
  } else if (row.kind === 'p04') {
    if (path.extname(row.file).toLowerCase() !== '.wav') addError(row, 'p04 fileは.wavである必要があります');
    if (!['voice', 'sfx'].includes(row.usage)) addError(row, 'p04 usageはvoice / sfxのいずれかです');
    row.playbackRate = parsePositiveInteger(row.playbackRate, 'playbackRate', row, 32000);
    try {
      row.sampleRate = adpcmCsv.parseSampleRate(row.sampleRate);
    } catch (error) {
      addError(row, String(error.message || error));
    }
    if (row.splitPolicy !== 'error') addError(row, 'p04 splitPolicyはerrorである必要があります');
    if (row.details.source !== row.source) addError(row, 'p04 details.sourceとsource列が一致しません');
    if (String(row.details.usage || '').trim().toLowerCase() !== row.usage) addError(row, 'p04 details.usageとusage列が一致しません');
    if (row.details.loop !== row.loop) addError(row, 'p04 details.loopとloop列が一致しません');
    if (Number(row.details.playbackRate) !== row.playbackRate) addError(row, 'p04 details.playbackRateとplaybackRate列が一致しません');
    if (Number(row.details.targetSampleRate) !== row.sampleRate) addError(row, 'p04 details.targetSampleRateとsampleRate列が一致しません');
  } else if (row.kind === 'midi') {
    if (!['.mid', '.midi'].includes(path.extname(row.file).toLowerCase())) addError(row, 'midi fileは.mid / .midiである必要があります');
    if (row.details.source !== row.source) addError(row, 'midi details.sourceとsource列が一致しません');
  }
}

function inspectAssetPackage(payload = {}, options = {}) {
  const targetMedia = String(payload.targetMedia || options.targetMedia || '').trim().toLowerCase();
  if (targetMedia !== 'cd') throw new Error('北へ。PM素材一括取込はCD-ROM2専用です');
  const projectDir = String(options.projectDir || '').trim();
  if (!projectDir || !path.isAbsolute(projectDir)) throw new Error('projectDirが取得できません');
  const existingAssets = Array.isArray(options.assets) ? options.assets : [];
  const manifest = requireManifest(payload.manifestPath || payload.sourcePath);
  if (manifest.bytes.length < UTF8_BOM.length
    || !manifest.bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    throw new Error('manifest CSVはUTF-8 BOM付きである必要があります');
  }
  const manifestHash = converter.sha256(manifest.bytes);
  const records = adpcmCsv.parseCsvRows(adpcmCsv.decodeUtf8Csv(manifest.bytes));
  if (!records.length) throw new Error('manifest CSVが空です');
  const headers = records[0].values.map((value) => String(value ?? ''));
  if (headers.length !== MANIFEST_HEADERS.length
    || headers.some((header, index) => header !== MANIFEST_HEADERS[index])) {
    throw new Error(`manifest headerは${MANIFEST_HEADERS.join(',')}の固定順である必要があります`);
  }

  const rows = records.slice(1).map((record, rowIndex) => {
    const values = Object.fromEntries(MANIFEST_HEADERS.map((header, index) => [header, String(record.values[index] ?? '').trim()]));
    const row = {
      rowIndex,
      row: record.lineNumber,
      lineNumber: record.lineNumber,
      version: values.version,
      kind: values.kind.toLowerCase(),
      targetType: values.targetType.toLowerCase(),
      sourceKey: values.sourceKey,
      source: values.source,
      file: values.file,
      filePath: '',
      id: values.id,
      name: values.name,
      usage: values.usage.toLowerCase(),
      playbackRate: values.playbackRate,
      loop: false,
      sampleRate: values.sampleRate,
      splitPolicy: values.splitPolicy.toLowerCase(),
      details: {},
      hash: '',
      preview: {},
      action: '',
      existingAssetId: '',
      warnings: [],
      errors: [],
    };
    if (record.values.length !== MANIFEST_HEADERS.length) addError(row, 'manifest rowの列数がheaderと一致しません');
    if (row.version !== MANIFEST_VERSION) addError(row, `versionは${MANIFEST_VERSION}である必要があります`);
    if (!adpcmCsv.ADPCM_BATCH_ID_PATTERN.test(row.id)) addError(row, 'idは英数字・_・-だけで1～48文字にしてください');
    if (!row.name) addError(row, 'nameは必須です');
    if (!row.source) addError(row, 'sourceは必須です');
    if (!row.sourceKey) addError(row, 'sourceKeyは必須です');
    row.details = parseDetails(values.details, row);
    try {
      row.loop = adpcmCsv.parseLoop(values.loop);
    } catch (error) {
      addError(row, String(error.message || error));
    }
    validateKindFields(row);

    try {
      const resolved = resolvePackageFile(manifest.packageRoot, row.file);
      row.file = resolved.relativePath;
      row.filePath = resolved.absolutePath;
      const bytes = fs.readFileSync(resolved.absolutePath);
      row.hash = converter.sha256(bytes);
      if (row.details.fileSha256 && row.details.fileSha256 !== row.hash) {
        addError(row, `details.fileSha256と実file hashが一致しません（actual: ${row.hash}）`);
      }
      if (row.kind === 'image') inspectImage(row, bytes);
      else if (row.kind === 'p04') inspectP04(row, bytes);
      else if (row.kind === 'midi') inspectMidi(row, bytes, projectDir);
    } catch (error) {
      addError(row, String(error.message || error));
    }

    try {
      const recalculated = expectedSourceKey(row);
      if (!recalculated || recalculated !== row.sourceKey) {
        addError(row, `sourceKeyが一致しません（expected: ${recalculated || '(none)'}）`);
      }
    } catch (error) {
      addError(row, `sourceKeyを再計算できません: ${String(error.message || error)}`);
    }

    const targetAssetType = row.targetType === 'background' ? 'image' : row.targetType;
    row.targetAssetType = targetAssetType;
    try {
      const importTarget = assetManager.resolveKitahePmImportTarget(existingAssets, row.id, targetAssetType, {
        replacePolicy: 'owned-source-key',
        kitahePm: {
          version: 1,
          sourceKey: row.sourceKey,
          kind: row.kind,
          source: row.source,
          manifestFileName: manifest.manifestFileName,
          row: record.lineNumber,
        },
      });
      row.action = importTarget.action;
      row.existingAssetId = importTarget.existingAssetId || '';
      row.importId = importTarget.id;
      row.provenance = importTarget.provenance;
    } catch (error) {
      addError(row, String(error.message || error));
    }
    return row;
  });

  const markDuplicates = (property, label) => {
    const groups = new Map();
    rows.forEach((row) => {
      const value = String(row[property] || '');
      if (!value) return;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    });
    groups.forEach((duplicates, value) => {
      if (duplicates.length > 1) duplicates.forEach((row) => addError(row, `${label} ${value}がmanifest内で重複しています`));
    });
  };
  markDuplicates('sourceKey', 'sourceKey');
  markDuplicates('id', 'id');

  rows.forEach((row) => { row.valid = row.errors.length === 0; });
  const diagnostics = rows.flatMap((row) => [
    ...row.errors.map((message) => ({ severity: 'error', lineNumber: row.lineNumber, message })),
    ...row.warnings.map((message) => ({ severity: 'warning', lineNumber: row.lineNumber, message })),
  ]);
  const assetCatalogSignature = converter.sha256(converter.stableJson(existingAssets.map((asset) => ({
    id: String(asset?.id || ''),
    type: String(asset?.type || ''),
    sourceKey: String(asset?.data?.import?.kitahePm?.sourceKey || ''),
  })).sort((left, right) => left.id.localeCompare(right.id))));
  const requestedAssetCatalogSignature = String(payload.assetCatalogSignature || '').trim();
  if (requestedAssetCatalogSignature && requestedAssetCatalogSignature !== assetCatalogSignature) {
    throw new Error('asset catalogが検査後に変更されました。packageを再検査してください');
  }
  const inspectionSignature = converter.sha256(converter.stableJson({
    manifestHash,
    targetMedia,
    assetCatalogSignature,
    files: rows.map((row) => ({ file: row.file, hash: row.hash, sourceKey: row.sourceKey })),
  }));
  const errorCount = diagnostics.filter((entry) => entry.severity === 'error').length;
  const warningCount = diagnostics.filter((entry) => entry.severity === 'warning').length;
  const summary = {
    total: rows.length,
    valid: rows.filter((row) => row.valid).length,
    error: rows.filter((row) => row.errors.length > 0).length,
    warning: rows.filter((row) => row.warnings.length > 0).length,
    create: rows.filter((row) => row.valid && row.action === 'create').length,
    update: rows.filter((row) => row.valid && row.action === 'update').length,
    errorCount,
    warningCount,
  };
  return {
    ok: true,
    canImport: rows.length > 0 && errorCount === 0,
    manifestPath: manifest.manifestPath,
    packageRoot: manifest.packageRoot,
    manifestFileName: manifest.manifestFileName,
    version: Number(MANIFEST_VERSION),
    rows,
    diagnostics,
    summary,
    manifestHash,
    assetCatalogSignature,
    inspectionSignature,
  };
}

module.exports = {
  MANIFEST_FILE_NAME,
  MANIFEST_HEADERS,
  MANIFEST_VERSION,
  inspectAssetPackage,
  resolvePackageFile,
};
