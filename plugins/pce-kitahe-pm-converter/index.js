'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vnManager = require('../../pce-vn-manager');
const converter = require('./converter');
const assetPackage = require('./asset-package');

const SIDECAR_FILE = path.join('assets', 'kitahe-pm-conversion.json');
const REPORT_FILE = path.join('assets', 'kitahe-pm-conversion-report.json');
const BACKUP_FILE = path.join('assets', 'pce-vn-scenes.kitahe-backup.json');
const MAX_SCRIPT_FILES = 2048;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_SELECTED_BYTES = 64 * 1024 * 1024;

function requireProjectDir(context = {}) {
  const projectDir = String(context.projectDir || '').trim();
  if (!projectDir) throw new Error('projectDir が取得できません');
  const resolved = fs.realpathSync(projectDir);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('projectDirはdirectoryではありません');
  return resolved;
}

function withinPath(root, candidate) {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function assertResolvedPathWithin(root, candidate, label) {
  const canonicalRoot = fs.realpathSync(root);
  const absoluteCandidate = path.resolve(candidate);
  if (!withinPath(canonicalRoot, absoluteCandidate)) {
    throw new Error(`${label}がproject外です`);
  }
  let existing = absoluteCandidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing || !withinPath(canonicalRoot, parent)) {
      throw new Error(`${label}の既存parentをproject内で解決できません`);
    }
    existing = parent;
  }
  const resolvedExisting = fs.realpathSync(existing);
  if (!withinPath(canonicalRoot, resolvedExisting)) {
    throw new Error(`${label}のsymlink/junctionがproject外を参照しています`);
  }
}

function requireDirectory(value, label) {
  const requested = String(value || '').trim();
  if (!requested || !path.isAbsolute(requested)) {
    throw new Error(`${label}には絶対directory pathを指定してください`);
  }
  const resolved = fs.realpathSync(requested);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label}はdirectoryではありません`);
  return resolved;
}

function resolveScriptRoot(sourceRoot) {
  const root = requireDirectory(sourceRoot, 'sourceRoot');
  if (path.basename(root).toUpperCase() === 'SCRIPT') return root;
  const entry = fs.readdirSync(root, { withFileTypes: true })
    .find((candidate) => candidate.isDirectory() && candidate.name.toUpperCase() === 'SCRIPT');
  if (!entry) throw new Error('選択directory直下にSCRIPT directoryがありません');
  const scriptRoot = fs.realpathSync(path.join(root, entry.name));
  if (!withinPath(root, scriptRoot)) throw new Error('SCRIPT directoryがsource root外を参照しています');
  return scriptRoot;
}

function discoverScriptFiles(sourceRoot) {
  const scriptRoot = resolveScriptRoot(sourceRoot);
  const discovered = [];
  const pending = [scriptRoot];
  while (pending.length) {
    const directory = pending.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const realDirectory = fs.realpathSync(candidate);
        if (!withinPath(scriptRoot, realDirectory)) {
          throw new Error('SCRIPT directory外を参照するdirectoryを拒否しました');
        }
        pending.push(realDirectory);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toUpperCase() !== '.SCR') continue;
      const realFile = fs.realpathSync(candidate);
      if (!withinPath(scriptRoot, realFile)) throw new Error('SCRIPT directory外を参照するSCRを拒否しました');
      const relativePath = converter.normalizeRelativeScriptPath(path.relative(scriptRoot, realFile));
      if (!relativePath) throw new Error('安全でないSCR relative pathを拒否しました');
      const stat = fs.statSync(realFile);
      if (stat.size > MAX_SCRIPT_BYTES) {
        throw new Error(`${relativePath} は1 SCRの上限 ${MAX_SCRIPT_BYTES} bytesを超えます`);
      }
      discovered.push({
        path: relativePath,
        absolutePath: realFile,
        name: path.basename(relativePath),
        size: stat.size,
      });
      if (discovered.length > MAX_SCRIPT_FILES) {
        throw new Error(`SCR数が上限 ${MAX_SCRIPT_FILES} を超えます`);
      }
    }
  }
  return {
    scriptRoot,
    files: discovered.sort((left, right) => left.path.localeCompare(right.path, 'ja')),
  };
}

function normalizeSelectedScripts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((entry) => {
    const raw = entry && typeof entry === 'object'
      ? (entry.relativePath || entry.path || entry.name)
      : entry;
    return converter.normalizeRelativeScriptPath(raw);
  }).filter((entry) => {
    const key = entry.toUpperCase();
    if (!entry || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.localeCompare(right, 'ja'));
}

function selectAndReadScripts(discovered, selectedScripts) {
  const byPath = new Map(discovered.files.map((file) => [file.path.toUpperCase(), file]));
  const byName = new Map();
  discovered.files.forEach((file) => {
    const key = file.name.toUpperCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(file);
  });
  let totalBytes = 0;
  return selectedScripts.map((selected) => {
    let file = byPath.get(selected.toUpperCase());
    if (!file) {
      const sameName = byName.get(path.basename(selected).toUpperCase()) || [];
      if (sameName.length === 1) [file] = sameName;
    }
    if (!file) throw new Error(`選択SCR ${selected} がSCRIPT directoryにありません`);
    totalBytes += file.size;
    if (totalBytes > MAX_SELECTED_BYTES) {
      throw new Error(`選択SCRの合計が上限 ${MAX_SELECTED_BYTES} bytesを超えます`);
    }
    const buffer = fs.readFileSync(file.absolutePath);
    return {
      path: file.path,
      buffer,
      hash: converter.sha256(buffer),
    };
  });
}

function minimalScripts(discovered, selectedScripts) {
  const selected = new Set(selectedScripts.map((entry) => entry.toUpperCase()));
  return discovered.files.map((file) => ({
    path: file.path,
    relativePath: file.path,
    name: file.name,
    size: file.size,
    selected: selected.has(file.path.toUpperCase()),
  }));
}

function assetCatalog(context = {}) {
  return Array.isArray(context.assets) ? context.assets : [];
}

function assetDocument(context = {}) {
  return { version: 1, assets: assetCatalog(context) };
}

function automaticAssetTypes(requirement = {}) {
  if (requirement.kind === 'image') return ['image', 'sprite'];
  if (requirement.kind === 'p04') return ['adpcm'];
  if (requirement.kind === 'midi') return ['psg-song'];
  if (requirement.kind === 'cdda') return ['cdda-track'];
  return [];
}

function suggestAssetRequirements(requirements = [], assets = []) {
  return requirements.map((requirement) => {
    const suggestedAssetName = converter.assetMatchName(requirement);
    const nameKey = converter.assetMatchKey(suggestedAssetName);
    const acceptedTypes = new Set(automaticAssetTypes(requirement));
    const sourceKeyMatches = assets.filter((asset) => (
      acceptedTypes.has(String(asset?.type || ''))
      && asset?.data?.import?.kitahePm?.sourceKey === requirement.key));
    const nameMatches = nameKey
      ? assets.filter((asset) => (
        acceptedTypes.has(String(asset?.type || ''))
        && !asset?.data?.import?.kitahePm?.sourceKey
        && converter.assetMatchKey(asset?.name) === nameKey
      ))
      : [];
    nameMatches.sort((left, right) => {
      if (requirement.kind === 'image') {
        const leftRank = String(left?.type || '') === 'image' ? 0 : 1;
        const rightRank = String(right?.type || '') === 'image' ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return String(left?.id || '').localeCompare(String(right?.id || ''), 'ja');
    });
    const suggested = sourceKeyMatches.length === 1 ? sourceKeyMatches[0] : (sourceKeyMatches.length ? null : nameMatches[0]);
    return {
      ...requirement,
      suggestedAssetName,
      suggestedAssetId: String(suggested?.id || ''),
      suggestedAssetType: String(suggested?.type || ''),
      suggestedBy: suggested ? (sourceKeyMatches.length === 1 ? 'sourceKey' : 'name') : '',
      sourceKeyMatchCount: sourceKeyMatches.length,
    };
  });
}

function readDiskSceneSnapshot(projectDir) {
  const scenePath = path.resolve(projectDir, vnManager.VN_SCENE_FILE);
  if (!withinPath(projectDir, scenePath)) throw new Error('scene file pathがproject外です');
  assertResolvedPathWithin(projectDir, scenePath, 'scene file path');
  if (!fs.existsSync(scenePath)) return { exists: false, hash: '', document: null };
  const bytes = fs.readFileSync(scenePath);
  try {
    return {
      exists: true,
      hash: converter.sha256(bytes),
      document: JSON.parse(bytes.toString('utf-8')),
    };
  } catch (error) {
    throw new Error(`既存scene documentをJSONとして読めません: ${String(error.message || error)}`);
  }
}

function readSidecarSnapshot(projectDir) {
  const sidecarPath = path.resolve(projectDir, SIDECAR_FILE);
  if (!withinPath(projectDir, sidecarPath)) throw new Error('sidecar file pathがproject外です');
  assertResolvedPathWithin(projectDir, sidecarPath, 'sidecar file path');
  if (!fs.existsSync(sidecarPath)) return { exists: false, hash: '', document: null };
  const bytes = fs.readFileSync(sidecarPath);
  try {
    return {
      exists: true,
      hash: converter.sha256(bytes),
      document: JSON.parse(bytes.toString('utf-8')),
    };
  } catch (error) {
    throw new Error(`既存conversion sidecarをJSONとして読めません: ${String(error.message || error)}`);
  }
}

function authoritativeDocument(projectDir, payload = {}, diskSnapshot = null) {
  if (diskSnapshot?.exists && diskSnapshot.document && typeof diskSnapshot.document === 'object') {
    return diskSnapshot.document;
  }
  if (payload.doc && typeof payload.doc === 'object') return payload.doc;
  return vnManager.readSceneDocument(projectDir);
}

function normalizeTargetMedia(value) {
  return String(value || '').trim().toLowerCase();
}

function sourceRootDisplayName(sourceRoot) {
  const normalized = String(sourceRoot || '').replace(/[\\/]+$/, '');
  return path.basename(normalized) || 'SCRIPT';
}

function importIdentity(selectedScripts, entryScript) {
  return converter.sha256(converter.stableJson({
    selectedScripts: [...selectedScripts].sort((left, right) => left.localeCompare(right)),
    entryScript,
  })).slice(0, 16);
}

function sameImportIdentity(candidate, selectedScripts, entryScript) {
  return Boolean(candidate)
    && converter.stableJson([...(candidate.selectedScripts || [])].sort((left, right) => left.localeCompare(right)))
      === converter.stableJson([...selectedScripts].sort((left, right) => left.localeCompare(right)))
    && String(candidate.entry || '') === String(entryScript || '');
}

function previousImportRecord(sidecar, selectedScripts, entryScript) {
  const identity = importIdentity(selectedScripts, entryScript);
  if (sidecar?.imports?.[identity] && sameImportIdentity(sidecar.imports[identity], selectedScripts, entryScript)) {
    return sidecar.imports[identity];
  }
  return sameImportIdentity(sidecar, selectedScripts, entryScript) ? sidecar : null;
}

function savedMappingFromRecord(record) {
  return {
    speakers: {},
    assets: record?.assetMappings && typeof record.assetMappings === 'object'
      ? record.assetMappings
      : {},
  };
}

function sanitizeSpeakerMappings(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([token, raw]) => {
    const entry = raw && typeof raw === 'object' ? raw : {};
    return [token, {
      mode: entry.mode === 'narration' ? 'narration' : 'speaker',
      name: String(entry.name || '').trim(),
    }];
  }));
}

function sanitizeAssetMappings(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    const entry = raw && typeof raw === 'object' ? raw : {};
    return [key, {
      action: entry.action === 'omit' ? 'omit' : 'map',
      assetId: String(entry.assetId || '').trim(),
      display: entry.display === 'sprite' ? 'sprite' : 'background',
      x: Number.isFinite(Number(entry.x)) ? Math.round(Number(entry.x)) : 0,
      y: Number.isFinite(Number(entry.y)) ? Math.round(Number(entry.y)) : 0,
      slot: Number.isFinite(Number(entry.slot)) ? Math.round(Number(entry.slot)) : 0,
      animationId: String(entry.animationId || 'default').trim() || 'default',
    }];
  }));
}

function sanitizeImportRecord(record) {
  const raw = record && typeof record === 'object' ? record : {};
  return {
    selectedScripts: normalizeSelectedScripts(raw.selectedScripts),
    entry: converter.normalizeRelativeScriptPath(raw.entry),
    protagonistName: String(raw.protagonistName || ''),
    namespace: String(raw.namespace || ''),
    speakerMappings: sanitizeSpeakerMappings(raw.speakerMappings),
    assetMappings: sanitizeAssetMappings(raw.assetMappings),
    ownedSceneIds: Array.isArray(raw.ownedSceneIds)
      ? raw.ownedSceneIds.map((entry) => String(entry || '')).filter(Boolean)
      : [],
  };
}

function sanitizeImportCollection(sidecar) {
  if (sidecar?.imports && typeof sidecar.imports === 'object') {
    return Object.fromEntries(Object.entries(sidecar.imports)
      .map(([identity, record]) => [String(identity), sanitizeImportRecord(record)]));
  }
  if (sidecar?.ownedSceneIds && sidecar?.entry) {
    const record = sanitizeImportRecord(sidecar);
    return {
      [importIdentity(record.selectedScripts, record.entry)]: record,
    };
  }
  return {};
}

function makeSignature({
  files,
  selectedScripts,
  entryScript,
  payload,
  doc,
  assets,
  sidecarSnapshot,
  diskSnapshot,
  buildPreview = false,
}) {
  const mode = payload.mode === 'append' ? 'append' : 'replace';
  return converter.conversionSignature({
    files,
    selectedScripts,
    entryScript,
    protagonistName: payload.protagonistName,
    targetMedia: normalizeTargetMedia(payload.targetMedia),
    document: {
      authoritative: doc,
      renderer: payload.doc && typeof payload.doc === 'object' ? payload.doc : null,
    },
    assetCatalog: assets,
    mapping: payload.mapping && typeof payload.mapping === 'object' ? payload.mapping : null,
    sidecar: sidecarSnapshot,
    diskSceneSnapshot: diskSnapshot
      ? { exists: diskSnapshot.exists, hash: diskSnapshot.hash }
      : null,
    conversionOptions: {
      mode,
      setStartScene: mode === 'append' && payload.setStartScene === true,
      buildPreview,
    },
  });
}

function targetMediaDiagnostic(targetMedia) {
  if (normalizeTargetMedia(targetMedia) === 'cd') return [];
  return [{
    severity: 'error',
    code: 'target-media',
    message: '北へ。PhotoMemories SCR取込はCD-ROM2 VN project専用です。',
  }];
}

function uniqueDiagnostics(entries = []) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = [
      entry?.severity || '',
      entry?.code || '',
      entry?.script || '',
      entry?.line || 0,
      entry?.message || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inspectKitahePmSource(payload = {}, context = {}) {
  try {
    const projectDir = requireProjectDir(context);
    const sidecarSnapshot = readSidecarSnapshot(projectDir);
    const previousSidecar = sidecarSnapshot.document;
    const diskSnapshot = readDiskSceneSnapshot(projectDir);
    let savedMapping = savedMappingFromRecord(null);
    const discovered = discoverScriptFiles(payload.sourceRoot);
    const selectedScripts = normalizeSelectedScripts(payload.selectedScripts);
    const scripts = minimalScripts(discovered, selectedScripts);
    const doc = authoritativeDocument(projectDir, payload, diskSnapshot);
    const assets = assetCatalog(context);
    const targetDiagnostics = targetMediaDiagnostic(payload.targetMedia);

    if (!selectedScripts.length) {
      const signature = makeSignature({
        files: [],
        selectedScripts,
        entryScript: '',
        payload,
        doc,
        assets,
        sidecarSnapshot,
        diskSnapshot,
        buildPreview: false,
      });
      return {
        ok: true,
        canApply: false,
        signature,
        sourceRootName: sourceRootDisplayName(payload.sourceRoot),
        scripts,
        entryCandidates: [],
        entryScript: '',
        selectedScripts: [],
        colorTokens: [],
        assetRequirements: [],
        reachableInstructions: [],
        mapping: savedMapping,
        diagnostics: targetDiagnostics,
        summary: {
          discoveredScriptCount: scripts.length,
          selectedScriptCount: 0,
          reachableInstructionCount: 0,
          colorTokenCount: 0,
          assetRequirementCount: 0,
          warningCount: 0,
          errorCount: targetDiagnostics.length,
        },
      };
    }

    const files = selectAndReadScripts(discovered, selectedScripts);
    const selectedCanonical = files.map((file) => file.path);
    const requestedEntry = converter.normalizeRelativeScriptPath(payload.entryScript || selectedCanonical[0]);
    const previousImport = previousImportRecord(previousSidecar, selectedCanonical, requestedEntry);
    savedMapping = savedMappingFromRecord(previousImport);
    const analysis = converter.inspectScripts({
      files,
      entryScript: requestedEntry,
      protagonistName: payload.protagonistName,
    });
    const publicResult = converter.publicInspection(analysis);
    publicResult.assetRequirements = suggestAssetRequirements(publicResult.assetRequirements, assets);
    let diagnostics = [...targetDiagnostics, ...publicResult.diagnostics];
    let sceneBudgets = [];
    let totals = {};
    if (payload.previewConversion === true) {
      const namespace = conversionNamespace(selectedCanonical, analysis.entryScript);
      const converted = converter.convertScripts(analysis, {
        mapping: payload.mapping,
        assetCatalog: assets,
        namespace,
      });
      diagnostics = [...targetDiagnostics, ...converted.diagnostics];
      totals = converted.totals || {};
      if (converted.ok && !targetDiagnostics.some((entry) => entry.severity === 'error')) {
        try {
          const proposed = proposedDocument(
            doc,
            converted,
            payload,
            previousImport,
            namespace,
          );
          const buildInspection = vnManager.inspectVnSceneDocumentBuild(projectDir, {
            doc: proposed,
            assetDoc: assetDocument(context),
            targetMedia: 'cd',
          });
          sceneBudgets = buildInspection.sceneBudgets || [];
          totals = { ...totals, ...(buildInspection.totals || {}) };
          diagnostics.push(...(buildInspection.diagnostics || []));
          if (!buildInspection.ok
            && !(buildInspection.diagnostics || []).some((entry) => entry.severity === 'error')) {
            diagnostics.push({
              severity: 'error',
              code: 'build-inspection-failed',
              message: 'PCE VN build検査に失敗しました。',
            });
          }
        } catch (error) {
          diagnostics.push(thrownPreviewDiagnostic(error));
        }
      }
      diagnostics = uniqueDiagnostics(diagnostics);
    }
    const signature = makeSignature({
      files,
      selectedScripts: selectedCanonical,
      entryScript: analysis.entryScript,
      payload,
      doc,
      assets,
      sidecarSnapshot,
      diskSnapshot,
      buildPreview: payload.previewConversion === true,
    });
    return {
      ok: true,
      ...publicResult,
      canApply: !diagnostics.some((entry) => entry.severity === 'error'),
      previewed: payload.previewConversion === true,
      signature,
      sourceRootName: sourceRootDisplayName(payload.sourceRoot),
      scripts,
      selectedScripts: selectedCanonical,
      entryCandidates: selectedCanonical,
      entryScript: analysis.entryScript,
      mapping: payload.mapping && typeof payload.mapping === 'object' ? payload.mapping : savedMapping,
      diagnostics,
      sceneBudgets,
      totals,
      summary: {
        ...publicResult.summary,
        discoveredScriptCount: scripts.length,
        ...(payload.previewConversion === true ? {
          importedSceneCount: Number(totals.scenes || 0),
          commandCount: Number(totals.commands || 0),
        } : {}),
        errorCount: diagnostics.filter((entry) => entry.severity === 'error').length,
        warningCount: diagnostics.filter((entry) => entry.severity === 'warning').length,
      },
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

function atomicWriteJsonTransaction(projectDir, entries) {
  const root = path.resolve(projectDir);
  const staged = [];
  const originals = new Map();
  const committed = [];
  try {
    entries.forEach(({ relativePath, value }) => {
      const destination = path.resolve(projectDir, relativePath);
      if (!withinPath(root, destination)) throw new Error(`project外への書込みを拒否しました: ${relativePath}`);
      assertResolvedPathWithin(root, destination, `書込み先 ${relativePath}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      assertResolvedPathWithin(root, path.dirname(destination), `書込み先parent ${relativePath}`);
      if (fs.existsSync(destination)) {
        assertResolvedPathWithin(root, destination, `既存書込み先 ${relativePath}`);
      }
      originals.set(destination, fs.existsSync(destination) ? fs.readFileSync(destination) : null);
      const temporary = path.join(
        path.dirname(destination),
        `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`,
      );
      fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
      staged.push({ destination, temporary });
    });
    staged.forEach(({ destination, temporary }) => {
      fs.renameSync(temporary, destination);
      committed.push(destination);
    });
  } catch (error) {
    committed.reverse().forEach((destination) => {
      const original = originals.get(destination);
      try {
        if (original == null) {
          if (fs.existsSync(destination)) fs.unlinkSync(destination);
        } else {
          const restore = path.join(
            path.dirname(destination),
            `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.restore`,
          );
          fs.writeFileSync(restore, original);
          fs.renameSync(restore, destination);
        }
      } catch (_) {}
    });
    throw error;
  } finally {
    staged.forEach(({ temporary }) => {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch (_) {}
    });
  }
}

function conversionNamespace(selectedScripts, entryScript) {
  const identity = importIdentity(selectedScripts, entryScript).slice(0, 8);
  const stem = path.basename(entryScript, path.extname(entryScript));
  const suffix = `_${identity}`;
  const safeStem = converter.safeIdentifier(stem, 'import', 24 - 'khpm_'.length - suffix.length);
  return `khpm_${safeStem}${suffix}`;
}

function validatePreviousImportOwnership(previousImport, namespace) {
  if (!previousImport) return;
  if (String(previousImport.namespace || '') !== namespace) {
    throw new Error(`既存sidecarのnamespaceがimport identityと一致しません: ${previousImport.namespace || '(空)'}`);
  }
  const expectedPrefix = `${namespace}_`;
  const invalidOwnedId = (previousImport.ownedSceneIds || [])
    .find((sceneId) => !String(sceneId || '').startsWith(expectedPrefix));
  if (invalidOwnedId) {
    throw new Error(`既存sidecarのownedSceneId ${invalidOwnedId} はnamespace ${namespace} の所有範囲外です`);
  }
}

function appendDocument(existing, importedScenes, entrySceneId, previousImport, namespace, setStartScene) {
  validatePreviousImportOwnership(previousImport, namespace);
  const owned = new Set(Array.isArray(previousImport?.ownedSceneIds) ? previousImport.ownedSceneIds : []);
  const existingScenes = Array.isArray(existing?.scenes) ? existing.scenes : [];
  const preserved = existingScenes.filter((scene) => !owned.has(scene?.id));
  const preservedIds = new Set(preserved.map((scene) => scene.id));
  const collision = importedScenes.find((scene) => preservedIds.has(scene.id));
  if (collision) throw new Error(`未所有scene ID ${collision.id} とimport sceneが衝突します`);
  return {
    version: existing?.version || 1,
    settings: existing?.settings && typeof existing.settings === 'object' ? existing.settings : {},
    startScene: setStartScene ? entrySceneId : String(existing?.startScene || ''),
    scenes: [...preserved, ...importedScenes],
  };
}

function proposedDocument(existing, converted, payload, previousImport, namespace) {
  const mode = payload.mode === 'append' ? 'append' : 'replace';
  if (mode === 'append') {
    return appendDocument(
      existing,
      converted.scenes,
      converted.entrySceneId,
      previousImport,
      namespace,
      payload.setStartScene === true,
    );
  }
  return {
    version: existing?.version || 1,
    settings: existing?.settings && typeof existing.settings === 'object' ? existing.settings : {},
    startScene: converted.entrySceneId,
    scenes: converted.scenes,
  };
}

function thrownPreviewDiagnostic(error) {
  return {
    severity: 'error',
    code: 'conversion-preview',
    message: String(error?.message || error),
  };
}

function applyKitahePmConversion(payload = {}, context = {}) {
  try {
    const projectDir = requireProjectDir(context);
    if (normalizeTargetMedia(payload.targetMedia) !== 'cd') {
      return { ok: false, error: '北へ。PhotoMemories SCR取込はCD-ROM2 VN project専用です。' };
    }
    const selectedScripts = normalizeSelectedScripts(payload.selectedScripts);
    if (!selectedScripts.length) return { ok: false, error: '変換対象SCRが選択されていません。' };
    const discovered = discoverScriptFiles(payload.sourceRoot);
    const files = selectAndReadScripts(discovered, selectedScripts);
    const selectedCanonical = files.map((file) => file.path);
    const entryScript = converter.normalizeRelativeScriptPath(payload.entryScript || selectedCanonical[0]);
    const diskSnapshot = readDiskSceneSnapshot(projectDir);
    const existing = authoritativeDocument(projectDir, payload, diskSnapshot);
    const assets = assetCatalog(context);
    const sidecarSnapshot = readSidecarSnapshot(projectDir);
    const previousSidecar = sidecarSnapshot.document;
    const signature = makeSignature({
      files,
      selectedScripts: selectedCanonical,
      entryScript,
      payload,
      doc: existing,
      assets,
      sidecarSnapshot,
      diskSnapshot,
      buildPreview: true,
    });
    if (!payload.signature || payload.signature !== signature) {
      return {
        ok: false,
        stale: true,
        error: 'SCR、scene document、asset catalogのいずれかがpreview後に変更されました。再検査してください。',
        signature,
      };
    }

    const analysis = converter.inspectScripts({
      files,
      entryScript,
      protagonistName: payload.protagonistName,
    });
    if (analysis.diagnostics.some((entry) => entry.severity === 'error')) {
      return {
        ok: false,
        error: 'SCR検査にerrorがあるため適用できません。',
        diagnostics: analysis.diagnostics,
      };
    }
    if (analysis.diagnostics.some((entry) => entry.severity === 'warning') && payload.confirmWarnings !== true) {
      return {
        ok: false,
        warningConfirmationRequired: true,
        error: 'warningを確認してから適用してください。',
        diagnostics: analysis.diagnostics,
      };
    }

    const previousImport = previousImportRecord(previousSidecar, selectedCanonical, entryScript);
    const namespace = conversionNamespace(selectedCanonical, entryScript);
    const converted = converter.convertScripts(analysis, {
      mapping: payload.mapping,
      assetCatalog: assets,
      namespace,
    });
    if (!converted.ok) {
      return {
        ok: false,
        error: 'mappingまたは変換結果にerrorがあるため適用できません。',
        diagnostics: converted.diagnostics,
      };
    }
    if (converted.diagnostics.some((entry) => entry.severity === 'warning') && payload.confirmWarnings !== true) {
      return {
        ok: false,
        warningConfirmationRequired: true,
        error: 'mappingによる省略・近似warningを確認してから適用してください。',
        diagnostics: converted.diagnostics,
      };
    }

    const mode = payload.mode === 'append' ? 'append' : 'replace';
    const proposed = proposedDocument(existing, converted, payload, previousImport, namespace);

    const buildInspection = vnManager.inspectVnSceneDocumentBuild(projectDir, {
      doc: proposed,
      assetDoc: assetDocument(context),
      targetMedia: 'cd',
    });
    const diagnostics = uniqueDiagnostics([
      ...converted.diagnostics,
      ...(buildInspection.diagnostics || []),
    ]);
    if (!buildInspection.ok || diagnostics.some((entry) => entry.severity === 'error')) {
      return {
        ok: false,
        error: 'PCE VN build検査に失敗したためscene documentは変更していません。',
        diagnostics,
        sceneBudgets: buildInspection.sceneBudgets,
        totals: buildInspection.totals,
      };
    }
    if ((buildInspection.diagnostics || []).some((entry) => entry.severity === 'warning')
      && payload.confirmWarnings !== true) {
      return {
        ok: false,
        warningConfirmationRequired: true,
        error: 'PCE VN build検査のwarningを確認してから適用してください。',
        diagnostics,
        sceneBudgets: buildInspection.sceneBudgets,
        totals: buildInspection.totals,
      };
    }
    const normalizedDocument = buildInspection.document || buildInspection.normalizedDocument;
    const importedSceneIds = converted.scenes.map((scene) => scene.id);
    const importRecord = sanitizeImportRecord({
      selectedScripts: selectedCanonical,
      entry: entryScript,
      protagonistName: String(payload.protagonistName || ''),
      namespace,
      speakerMappings: {},
      assetMappings: converted.normalizedMapping.assets,
      ownedSceneIds: importedSceneIds,
    });
    const imports = mode === 'append'
      ? {
        ...sanitizeImportCollection(previousSidecar),
        [importIdentity(selectedCanonical, entryScript)]: importRecord,
      }
      : { [importIdentity(selectedCanonical, entryScript)]: importRecord };
    const sidecar = {
      version: 1,
      ...importRecord,
      imports,
    };
    const report = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceRootName: sourceRootDisplayName(payload.sourceRoot),
      summary: {
        mode,
        selectedScriptCount: selectedCanonical.length,
        importedSceneCount: importedSceneIds.length,
        warningCount: diagnostics.filter((entry) => entry.severity === 'warning').length,
        errorCount: diagnostics.filter((entry) => entry.severity === 'error').length,
        ...converted.totals,
      },
      diagnostics,
      assetRequirements: analysis.requirements,
      approximations: diagnostics.filter((entry) => (
        entry.severity === 'warning'
        && /approximation|approximated|omitted|truncated|replaced/.test(String(entry.code || ''))
      )),
      sceneBudgets: buildInspection.sceneBudgets,
      totals: buildInspection.totals,
      sourceMap: converted.sourceMap,
      sourceRanges: converted.sourceRanges,
    };

    atomicWriteJsonTransaction(projectDir, [
      { relativePath: BACKUP_FILE, value: existing },
      { relativePath: SIDECAR_FILE, value: sidecar },
      { relativePath: REPORT_FILE, value: report },
      { relativePath: vnManager.VN_SCENE_FILE, value: normalizedDocument },
    ]);

    context.logger?.info?.(
      `北へ。PM SCR取込: ${selectedCanonical.length} SCR / ${importedSceneIds.length} sceneを${mode === 'append' ? '追加' : '置換'}しました`,
    );
    return {
      ok: true,
      doc: normalizedDocument,
      startScene: normalizedDocument.startScene,
      importedSceneIds,
      diagnostics,
      summary: report.summary,
      files: {
        scene: vnManager.VN_SCENE_FILE.replace(/\\/g, '/'),
        backup: BACKUP_FILE.replace(/\\/g, '/'),
        sidecar: SIDECAR_FILE.replace(/\\/g, '/'),
        report: REPORT_FILE.replace(/\\/g, '/'),
      },
    };
  } catch (error) {
    context.logger?.error?.(`北へ。PM SCR取込失敗: ${String(error.message || error)}`);
    return { ok: false, error: String(error.message || error) };
  }
}

function inspectKitahePmAssetPackage(payload = {}, context = {}) {
  try {
    const projectDir = requireProjectDir(context);
    const result = assetPackage.inspectAssetPackage(payload, {
      projectDir,
      assets: assetCatalog(context),
      targetMedia: payload.targetMedia,
    });
    context.logger?.info?.(
      `北へ。PM素材検査: ${result.summary.valid}/${result.summary.total}件有効、error ${result.summary.errorCount}件`,
    );
    return result;
  } catch (error) {
    context.logger?.error?.(`北へ。PM素材検査失敗: ${String(error.message || error)}`);
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = {
  SIDECAR_FILE,
  REPORT_FILE,
  BACKUP_FILE,
  discoverScriptFiles,
  suggestAssetRequirements,
  inspectKitahePmSource,
  applyKitahePmConversion,
  inspectKitahePmAssetPackage,
};
