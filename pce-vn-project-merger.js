'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vnManager = require('./pce-vn-manager');

const MERGE_MARKER_FILE = '.pce-vn-merge.json';
const MERGE_MARKER_VERSION = 1;
const CD_TEMPLATE_ID = 'template_pce_vn_cd';
const CD_BUILDER_ID = 'pce-visual-novel-builder';
const ASSET_ID_LIMIT = 48;
const SCENE_ID_LIMIT = 48;
const VARIABLE_NAME_LIMIT = 32;
const SELECTOR_COUNTER_SLOT = 2;
const SELECTOR_COUNTER_Y = 194;
const SELECTOR_COUNTER_HEIGHT = 16;
const SELECTOR_COUNTER_PITCH_X = 12;
const SELECTOR_COUNTER_SCREEN_WIDTH = 256;
const RESERVED_VARIABLES = new Set(['AUTO_ENABLE', 'MSG_SPEED']);
const FILE_BACKED_ASSET_TYPES = new Set(['image', 'sprite', 'adpcm', 'cdda-track', 'cdda-warning']);
const SCENE_REFERENCE_KEYS = new Set(['sceneId', 'targetSceneId', 'nextSceneId']);
const ASSET_REFERENCE_KEYS = new Set([
  'assetId', 'voiceAssetId', 'animationAssetId',
  'backgroundAssetId', 'bgmAssetId', 'bgAssetId', 'spriteAssetId',
]);
const GENERATED_FILE_KEYS = new Set([
  'paletteFile', 'tilesFile', 'cellMapFile', 'mapFile',
  'mapVramFile', 'outputFile', 'previewFile',
]);
const SELECTOR_COUNTER_BOUNDARY_TYPES = new Set([
  'inputcheck', 'jump', 'goto', 'choice', 'if', 'switch', 'label', 'wait', 'message',
]);

const projectPathCollator = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'base',
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function diagnostic(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asProjectList(options = {}) {
  const value = options.projects ?? options.inputProjects ?? options.inputs;
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}

function isPathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function canonicalDirectory(value, label, cwd) {
  const requested = path.resolve(cwd, String(value || '').trim());
  if (!fs.existsSync(requested)) throw new Error(`${label} does not exist: ${requested}`);
  const resolved = fs.realpathSync(requested);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} is not a directory: ${resolved}`);
  return resolved;
}

function naturalProjectPathCompare(left, right) {
  return projectPathCollator.compare(String(left || '').replace(/\\/g, '/'), String(right || '').replace(/\\/g, '/'));
}

function outputDirectory(options, cwd) {
  if (options.outputParent != null || options.outputName != null) {
    const parent = canonicalDirectory(options.outputParent, 'output parent', cwd);
    const name = String(options.outputName || '').trim();
    if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name)) {
      throw new Error(`invalid output name: ${name || '(empty)'}`);
    }
    return path.join(parent, name);
  }
  const raw = String(options.output ?? options.outputDir ?? '').trim();
  if (!raw) throw new Error('output directory is required');
  const requested = path.resolve(cwd, raw);
  const parent = canonicalDirectory(path.dirname(requested), 'output parent', cwd);
  return path.join(parent, path.basename(requested));
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${filePath}: ${error.message || error}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object: ${filePath}`);
  }
  return parsed;
}

function requireProjectFile(projectDir, relativePath, label) {
  const filePath = path.join(projectDir, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  const realFile = fs.realpathSync(filePath);
  if (!isPathWithin(projectDir, realFile)) throw new Error(`${label} escapes the project: ${relativePath}`);
  return realFile;
}

function normalizeProjectRelative(value, label) {
  const text = String(value || '').replace(/\\/g, '/').trim();
  if (!text || path.posix.isAbsolute(text) || /^[A-Za-z]:\//.test(text)) {
    throw new Error(`${label} must be a project-relative file path: ${text || '(empty)'}`);
  }
  const normalized = path.posix.normalize(text);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} escapes the project: ${text}`);
  }
  return normalized;
}

function registeredFile(projectDir, relativePath, label) {
  const normalized = normalizeProjectRelative(relativePath, label);
  const absolute = path.resolve(projectDir, ...normalized.split('/'));
  if (!isPathWithin(projectDir, absolute)) throw new Error(`${label} escapes the project: ${normalized}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`${label} is missing: ${absolute}`);
  }
  const canonical = fs.realpathSync(absolute);
  if (!isPathWithin(projectDir, canonical)) throw new Error(`${label} symlink escapes the project: ${normalized}`);
  return { normalized, absolute: canonical, size: fs.statSync(canonical).size };
}

function collectAssetPathEntries(project, asset, assetIndex) {
  const entries = [];
  const add = (owner, key, kind, required = false) => {
    const value = owner?.[key];
    if (value == null || String(value).trim() === '') {
      if (required) throw new Error(`asset "${asset.id}" has no ${key}`);
      return;
    }
    const file = registeredFile(project.canonicalPath, value, `asset "${asset.id}" ${key}`);
    entries.push({ owner, key, kind, ...file });
  };
  add(asset, 'source', 'source', FILE_BACKED_ASSET_TYPES.has(String(asset.type || '')));
  const generated = asset?.data?.generated;
  if (generated && typeof generated === 'object') {
    GENERATED_FILE_KEYS.forEach((key) => add(generated, key, 'generated'));
  }
  const imported = asset?.data?.import;
  if (imported && typeof imported === 'object') add(imported, 'highQualitySource', 'high-quality');
  return entries.map((entry) => ({ ...entry, assetIndex }));
}

function collectFontPathEntries(project, fontDocument) {
  if (!fontDocument) return [];
  const paths = new Set();
  if (String(fontDocument.fontPath || '').trim()) paths.add(String(fontDocument.fontPath));
  (Array.isArray(fontDocument.fonts) ? fontDocument.fonts : []).forEach((font) => {
    if (String(font?.file || '').trim()) paths.add(String(font.file));
  });
  return Array.from(paths).map((relativePath) => ({
    ...registeredFile(project.canonicalPath, relativePath, 'font file'),
    kind: 'font',
  }));
}

function collectInputProject(projectPath, namespace, cwd) {
  const canonicalPath = canonicalDirectory(projectPath, 'input project', cwd);
  if (fs.existsSync(path.join(canonicalPath, MERGE_MARKER_FILE))) {
    throw codedError('merged_input_project', `owned merge output cannot be used as an input project: ${canonicalPath}`);
  }
  const projectFile = requireProjectFile(canonicalPath, 'project.json', 'project config');
  const sceneFile = requireProjectFile(canonicalPath, path.join('assets', 'pce-vn-scenes.json'), 'VN scene document');
  const assetFile = requireProjectFile(canonicalPath, path.join('assets', 'pce-assets.json'), 'asset document');
  const config = readJson(projectFile, 'project config');
  const sceneDocument = readJson(sceneFile, 'VN scene document');
  const assetDocument = readJson(assetFile, 'asset document');
  const scenes = Array.isArray(sceneDocument.scenes) ? sceneDocument.scenes : [];
  const assets = Array.isArray(assetDocument.assets) ? assetDocument.assets : [];
  if (!scenes.length) throw new Error(`VN scene document is empty: ${canonicalPath}`);
  if (String(config.coreId || 'pc-engine') !== 'pc-engine') throw new Error(`input is not a PC Engine project: ${canonicalPath}`);
  if (String(config.targetMedia || '').toLowerCase() !== 'cd') throw new Error(`input is not a CD-ROM2 project: ${canonicalPath}`);

  const sceneIds = new Set();
  scenes.forEach((scene, index) => {
    const id = String(scene?.id || '').trim();
    if (!id) throw new Error(`scene ${index + 1} has no id: ${canonicalPath}`);
    if (sceneIds.has(id)) throw new Error(`duplicate scene id "${id}": ${canonicalPath}`);
    sceneIds.add(id);
  });
  const startScene = String(sceneDocument.startScene || '').trim();
  if (!startScene || !sceneIds.has(startScene)) throw new Error(`startScene is unresolved: ${canonicalPath}: ${startScene || '(empty)'}`);
  const selectorScene = scenes.find((scene) => String(scene?.id || '') === startScene);
  validateSelectorSceneForCounter(selectorScene, canonicalPath);

  const assetIds = new Set();
  assets.forEach((asset, index) => {
    const id = String(asset?.id || '').trim();
    if (!id) throw new Error(`asset ${index + 1} has no id: ${canonicalPath}`);
    if (assetIds.has(id)) throw new Error(`duplicate asset id "${id}": ${canonicalPath}`);
    assetIds.add(id);
  });
  const project = {
    canonicalPath, namespace, config, sceneDocument, assetDocument,
    projectFile, sceneFile, assetFile, sceneIds, assetIds,
  };
  project.assetPathEntries = assets.flatMap((asset, index) => collectAssetPathEntries(project, asset, index));
  const fontRelative = path.join('assets', 'pce-font.json');
  const fontPath = path.join(canonicalPath, fontRelative);
  project.fontDocument = fs.existsSync(fontPath)
    ? readJson(requireProjectFile(canonicalPath, fontRelative, 'font config'), 'font config')
    : null;
  project.fontPathEntries = collectFontPathEntries(project, project.fontDocument);

  const signatureFiles = [projectFile, sceneFile, assetFile];
  if (project.fontDocument) signatureFiles.push(fs.realpathSync(fontPath));
  project.assetPathEntries.forEach((entry) => signatureFiles.push(entry.absolute));
  project.fontPathEntries.forEach((entry) => signatureFiles.push(entry.absolute));
  const uniqueFiles = Array.from(new Set(signatureFiles.map((entry) => pathKey(entry))))
    .map((key) => signatureFiles.find((entry) => pathKey(entry) === key))
    .sort((left, right) => path.relative(canonicalPath, left).localeCompare(path.relative(canonicalPath, right), 'en'));
  const hashes = uniqueFiles.map((absolute) => ({
    path: path.relative(canonicalPath, absolute).replace(/\\/g, '/'),
    bytes: fs.statSync(absolute).size,
    sha256: sha256(fs.readFileSync(absolute)),
  }));
  project.signature = sha256(stableJson({ canonicalPath: pathKey(canonicalPath), files: hashes }));
  project.signatureFiles = hashes;
  project.bytes = hashes.reduce((sum, entry) => sum + entry.bytes, 0);
  return project;
}

function shortenId(prefix, original, limit, kind, occupied) {
  const full = `${prefix}${original}`;
  const make = (hashLength, salt = '') => {
    const suffix = sha256(`${kind}:${prefix}:${original}:${salt}`).slice(0, hashLength);
    const base = full.slice(0, Math.max(1, limit - hashLength - 1));
    return `${base}_${suffix}`;
  };
  let candidate = full.length <= limit ? full : make(8);
  let attempt = 0;
  while (occupied.has(candidate) && occupied.get(candidate) !== original) {
    attempt += 1;
    candidate = make(Math.min(16, 8 + attempt), String(attempt));
  }
  occupied.set(candidate, original);
  return candidate;
}

function walkCommands(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkCommands(entry, visitor));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, entry]) => {
    visitor(value, key, entry);
    walkCommands(entry, visitor);
  });
}

function isVariableReference(owner, key) {
  if (key === 'variableName' || key === 'variable' || key === 'resultVariable') return true;
  return key === 'name' && ['variable', 'if', 'switch'].includes(String(owner?.type || '').toLowerCase());
}

function selectorJump(scene, labelName, projectLabel) {
  const commands = Array.isArray(scene?.commands) ? scene.commands : [];
  const matches = [];
  commands.forEach((command, index) => {
    if (String(command?.type || '').toLowerCase() === 'label' && String(command.name || '') === labelName) matches.push(index);
  });
  if (matches.length !== 1) {
    throw new Error(`${projectLabel} start scene must contain exactly one ${labelName} label`);
  }
  const jump = commands[matches[0] + 1];
  if (String(jump?.type || '').toLowerCase() !== 'jump') {
    throw new Error(`${projectLabel} start scene ${labelName} must be followed immediately by Jump`);
  }
  return jump;
}

function selectorCounterInsertionIndex(scene) {
  const commands = Array.isArray(scene?.commands) ? scene.commands : [];
  const boundary = commands.findIndex((command) => (
    SELECTOR_COUNTER_BOUNDARY_TYPES.has(String(command?.type || '').toLowerCase())
  ));
  return boundary < 0 ? commands.length : boundary;
}

function spriteTextOverlapsCounterRow(command) {
  if (String(command?.type || '').toLowerCase() !== 'spritetext' || command.visible === false) return false;
  const text = String(command.text || '').replace(/\r/g, '');
  const baseY = Number(command.y) || 0;
  return text.split('\n').some((line, lineIndex) => {
    if (!line.length) return false;
    const top = baseY + (lineIndex * SELECTOR_COUNTER_HEIGHT);
    const bottom = top + SELECTOR_COUNTER_HEIGHT;
    return top < SELECTOR_COUNTER_Y + SELECTOR_COUNTER_HEIGHT && bottom > SELECTOR_COUNTER_Y;
  });
}

function validateSelectorSceneForCounter(scene, projectLabel = 'input project') {
  selectorJump(scene, 'NEXT_SCR', projectLabel);
  selectorJump(scene, 'PREV_SCR', projectLabel);
  const commands = Array.isArray(scene?.commands) ? scene.commands : [];
  if (commands.some((command) => (
    String(command?.type || '').toLowerCase() === 'spritetext'
      && Number(command.slot) === SELECTOR_COUNTER_SLOT
  ))) {
    throw codedError(
      'selector_counter_slot_conflict',
      `${projectLabel} start scene already uses SpriteText slot ${SELECTOR_COUNTER_SLOT}`,
    );
  }
  const insertionIndex = selectorCounterInsertionIndex(scene);
  const prefix = commands.slice(0, insertionIndex);
  if (prefix.some((command) => spriteTextOverlapsCounterRow(command))) {
    throw codedError(
      'selector_counter_row_conflict',
      `${projectLabel} start scene has visible SpriteText overlapping y=${SELECTOR_COUNTER_Y}`,
    );
  }
  let color = '#ffffff';
  prefix.forEach((command) => {
    if (String(command?.type || '').toLowerCase() !== 'spritetext' || command.visible === false) return;
    if (!String(command.text || '').length) return;
    color = String(command.color || '').trim() || '#ffffff';
  });
  return { insertionIndex, color };
}

function scenarioCounterText(index, total) {
  return `(${index + 1}/${total})`;
}

function injectScenarioCounter(scene, index, total, projectLabel = 'input project') {
  const placement = validateSelectorSceneForCounter(scene, projectLabel);
  const text = scenarioCounterText(index, total);
  const glyphCount = Array.from(text).length;
  const command = {
    type: 'spritetext',
    slot: SELECTOR_COUNTER_SLOT,
    text,
    x: Math.floor((SELECTOR_COUNTER_SCREEN_WIDTH - (glyphCount * SELECTOR_COUNTER_PITCH_X)) / 2),
    y: SELECTOR_COUNTER_Y,
    color: placement.color,
    blinkFrames: 0,
    visible: true,
  };
  scene.commands.splice(placement.insertionIndex, 0, command);
  return command;
}

function sanitizedConfigForComparison(config) {
  const value = clone(config || {});
  delete value.title;
  delete value.romName;
  delete value.generatedAt;
  if (value.cd && typeof value.cd === 'object') {
    delete value.cd.dataFiles;
    delete value.cd.cddaTracks;
    delete value.cd.isoName;
  }
  if (value.pluginRoles && typeof value.pluginRoles === 'object') delete value.pluginRoles.builder;
  return value;
}

function settingDifferencePaths(first, other, prefix = '') {
  if (stableJson(first) === stableJson(other)) return [];
  if (!first || !other || typeof first !== 'object' || typeof other !== 'object' || Array.isArray(first) || Array.isArray(other)) {
    return [prefix || '(root)'];
  }
  const keys = Array.from(new Set([...Object.keys(first), ...Object.keys(other)])).sort();
  return keys.flatMap((key) => settingDifferencePaths(first[key], other[key], prefix ? `${prefix}.${key}` : key));
}

function mergedRelativePath(namespace, original) {
  const normalized = normalizeProjectRelative(original, 'registered asset file');
  const withoutAssets = normalized.startsWith('assets/') ? normalized.slice('assets/'.length) : normalized;
  return path.posix.join('assets', 'merged', namespace, withoutAssets);
}

function addCopyFile(copyFiles, source, destination, bytes, label) {
  const destinationKey = process.platform === 'win32' ? destination.toLowerCase() : destination;
  const existing = copyFiles.get(destinationKey);
  if (existing && pathKey(existing.source) !== pathKey(source)) {
    throw new Error(`copy destination collision for ${label}: ${destination}: ${existing.source} <> ${source}`);
  }
  copyFiles.set(destinationKey, { source, destination, bytes });
}

function transformAssetPaths(asset, sourceProject, namespace, copyFiles) {
  const remap = (owner, key) => {
    if (!owner || !String(owner[key] || '').trim()) return;
    const original = normalizeProjectRelative(owner[key], `asset "${asset.id}" ${key}`);
    const source = registeredFile(sourceProject.canonicalPath, original, `asset "${asset.id}" ${key}`);
    const destination = mergedRelativePath(namespace, original);
    owner[key] = destination;
    addCopyFile(copyFiles, source.absolute, destination, source.size, `asset "${asset.id}" ${key}`);
  };
  remap(asset, 'source');
  const generated = asset?.data?.generated;
  if (generated && typeof generated === 'object') GENERATED_FILE_KEYS.forEach((key) => remap(generated, key));
  const imported = asset?.data?.import;
  if (imported && typeof imported === 'object') remap(imported, 'highQualitySource');
}

function transformScene(scene, maps, projectLabel) {
  const transformed = clone(scene);
  transformed.id = maps.scene.get(String(scene.id));
  if (String(transformed.name || '').trim()) transformed.name = `${maps.namespace}/${transformed.name}`;
  if (String(transformed.nextSceneId || '').trim()) {
    const mapped = maps.scene.get(String(transformed.nextSceneId));
    if (!mapped) throw new Error(`${projectLabel} scene "${scene.id}" has unresolved nextSceneId "${transformed.nextSceneId}"`);
    transformed.nextSceneId = mapped;
  }
  walkCommands(transformed.commands || [], (owner, key, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (SCENE_REFERENCE_KEYS.has(key)) {
      const mapped = maps.scene.get(value);
      if (!mapped) throw new Error(`${projectLabel} scene "${scene.id}" has unresolved scene reference "${value}"`);
      owner[key] = mapped;
    } else if (key === 'target' && maps.scene.has(value)) {
      owner[key] = maps.scene.get(value);
    } else if (ASSET_REFERENCE_KEYS.has(key)) {
      const mapped = maps.asset.get(value);
      if (!mapped) throw new Error(`${projectLabel} scene "${scene.id}" has unresolved asset reference "${value}"`);
      owner[key] = mapped;
    } else if (isVariableReference(owner, key)) {
      owner[key] = maps.variable.get(value) || value;
    }
  });
  return transformed;
}

function createMergedPlan(projects, outputDir, title, replace, sourceRoot = '') {
  const copyFiles = new Map();
  const maps = [];
  const sceneOccupied = new Map();
  const assetOccupied = new Map();
  const variableOccupied = new Map();
  projects.forEach((project) => {
    const scene = new Map();
    const asset = new Map();
    const variable = new Map();
    project.sceneDocument.scenes.forEach((entry) => {
      scene.set(String(entry.id), shortenId(project.namespace, String(entry.id), SCENE_ID_LIMIT, 'scene', sceneOccupied));
    });
    project.assetDocument.assets.forEach((entry) => {
      const original = String(entry.id);
      asset.set(original, entry.type === 'cdda-warning'
        ? 'cdda_warning'
        : shortenId(project.namespace, original, ASSET_ID_LIMIT, 'asset', assetOccupied));
    });
    walkCommands(project.sceneDocument.scenes, (owner, key, value) => {
      if (!isVariableReference(owner, key) || typeof value !== 'string' || !value.trim() || RESERVED_VARIABLES.has(value)) return;
      if (!variable.has(value)) {
        variable.set(value, shortenId(project.namespace, value, VARIABLE_NAME_LIMIT, 'variable', variableOccupied));
      }
    });
    RESERVED_VARIABLES.forEach((name) => variable.set(name, name));
    maps.push({ namespace: project.namespace, scene, asset, variable });
  });

  const mergedScenes = [];
  projects.forEach((project, index) => {
    const transformed = project.sceneDocument.scenes.map((scene) => transformScene(scene, maps[index], project.canonicalPath));
    const startId = maps[index].scene.get(String(project.sceneDocument.startScene));
    const startScene = transformed.find((scene) => scene.id === startId);
    const nextIndex = (index + 1) % projects.length;
    const previousIndex = (index + projects.length - 1) % projects.length;
    const nextStart = maps[nextIndex].scene.get(String(projects[nextIndex].sceneDocument.startScene));
    const previousStart = maps[previousIndex].scene.get(String(projects[previousIndex].sceneDocument.startScene));
    selectorJump(startScene, 'NEXT_SCR', project.canonicalPath).sceneId = nextStart;
    selectorJump(startScene, 'PREV_SCR', project.canonicalPath).sceneId = previousStart;
    injectScenarioCounter(startScene, index, projects.length, project.canonicalPath);
    mergedScenes.push(...transformed);
  });

  const warningEntries = projects.flatMap((project, projectIndex) => (
    project.assetDocument.assets
      .map((asset, assetIndex) => ({ asset, projectIndex, assetIndex }))
      .filter((entry) => entry.asset.type === 'cdda-warning')
  ));
  const mergedAssets = [];
  if (warningEntries.length) {
    const firstWarning = warningEntries[0];
    const warning = clone(firstWarning.asset);
    warning.id = 'cdda_warning';
    transformAssetPaths(warning, projects[firstWarning.projectIndex], projects[firstWarning.projectIndex].namespace, copyFiles);
    mergedAssets.push(warning);
  }
  const cddaTracks = [];
  projects.forEach((project, projectIndex) => {
    project.assetDocument.assets.forEach((sourceAsset, assetIndex) => {
      if (sourceAsset.type === 'cdda-warning') return;
      const asset = clone(sourceAsset);
      asset.id = maps[projectIndex].asset.get(String(sourceAsset.id));
      if (String(asset.name || '').trim()) asset.name = `${project.namespace}/${asset.name}`;
      transformAssetPaths(asset, project, project.namespace, copyFiles);
      if (asset.type === 'cdda-track') {
        cddaTracks.push({ asset, projectIndex, assetIndex, originalTrack: Number(asset.options?.track) || Number.MAX_SAFE_INTEGER });
      } else {
        mergedAssets.push(asset);
      }
    });
  });
  cddaTracks.sort((left, right) => left.projectIndex - right.projectIndex
    || left.originalTrack - right.originalTrack
    || left.assetIndex - right.assetIndex);
  cddaTracks.forEach((entry, index) => {
    entry.asset.options = { ...(entry.asset.options || {}), track: index + 3 };
    mergedAssets.push(entry.asset);
  });

  const mergedSceneDocument = {
    version: Number(projects[0].sceneDocument.version) || 2,
    settings: clone(projects[0].sceneDocument.settings || {}),
    startScene: maps[0].scene.get(String(projects[0].sceneDocument.startScene)),
    scenes: mergedScenes,
  };
  const mergedAssetDocument = { version: Number(projects[0].assetDocument.version) || 2, assets: mergedAssets };
  if (projects[0].fontDocument) {
    projects[0].fontPathEntries.forEach((entry) => {
      addCopyFile(copyFiles, entry.absolute, entry.normalized, entry.size, 'font file');
    });
  }

  const firstConfig = clone(projects[0].config);
  const outputConfig = {
    ...firstConfig,
    coreId: 'pc-engine',
    platform: 'pce',
    title,
    romName: title,
    toolchain: 'llvm-mos',
    targetMedia: 'cd',
    cd: {
      ...(firstConfig.cd || {}),
      systemCardProfile: String(firstConfig.cd?.systemCardProfile || 'jp-v3'),
      isoName: '',
      dataFiles: [],
      cddaTracks: [],
    },
    pluginRoles: { ...(firstConfig.pluginRoles || {}), builder: CD_BUILDER_ID },
    pluginSettings: {
      ...(firstConfig.pluginSettings || {}),
      [CD_BUILDER_ID]: {
        ...(firstConfig.pluginSettings?.[CD_BUILDER_ID] || {}),
        template: 'visual-novel-cd',
      },
    },
  };
  delete outputConfig.generatedAt;

  const assetCounts = {};
  mergedAssets.forEach((asset) => { assetCounts[asset.type] = (assetCounts[asset.type] || 0) + 1; });
  const inputSignature = sha256(stableJson(projects.map((project) => ({
    canonicalPath: pathKey(project.canonicalPath),
    namespace: project.namespace,
    signature: project.signature,
  }))));
  const signature = sha256(stableJson({
    inputSignature, outputDir: pathKey(outputDir), title,
    replace: Boolean(replace), markerVersion: MERGE_MARKER_VERSION,
    sourceRoot: sourceRoot ? pathKey(sourceRoot) : '',
  }));
  const marker = {
    version: MERGE_MARKER_VERSION,
    tool: 'pce-vn-project-merger',
    createdAt: new Date().toISOString(),
    title,
    outputDir,
    sourceRoot: sourceRoot || undefined,
    signature,
    inputSignature,
    inputs: projects.map((project, index) => ({
      order: index + 1,
      canonicalPath: project.canonicalPath,
      signature: project.signature,
      namespace: project.namespace,
      sceneMap: Object.fromEntries(maps[index].scene),
      assetMap: Object.fromEntries(maps[index].asset),
      variableMap: Object.fromEntries(maps[index].variable),
      counts: {
        scenes: project.sceneDocument.scenes.length,
        assets: project.assetDocument.assets.length,
      },
    })),
    counts: {
      scenes: mergedScenes.length,
      assets: mergedAssets.length,
      assetTypes: assetCounts,
      copiedFiles: copyFiles.size,
      copiedBytes: Array.from(copyFiles.values()).reduce((sum, entry) => sum + entry.bytes, 0),
    },
  };
  return {
    outputDir, title, replace: Boolean(replace), sourceRoot, projects, maps,
    sceneDocument: mergedSceneDocument,
    assetDocument: mergedAssetDocument,
    fontDocument: clone(projects[0].fontDocument),
    outputConfig,
    copyFiles: Array.from(copyFiles.values()),
    marker,
    inputSignature,
    signature,
  };
}

function readMergeMarker(outputDir) {
  const markerPath = path.join(outputDir, MERGE_MARKER_FILE);
  if (!fs.existsSync(markerPath) || !fs.statSync(markerPath).isFile()) return null;
  try {
    const marker = readJson(markerPath, 'merge marker');
    return marker.version === MERGE_MARKER_VERSION && marker.tool === 'pce-vn-project-merger' ? marker : null;
  } catch (_error) {
    return null;
  }
}

function candidateReason(code, message) {
  return { code, message };
}

function probeProjectMergeCandidate(projectDir, rootDir) {
  const relativePath = path.relative(rootDir, projectDir).replace(/\\/g, '/') || '.';
  const candidate = {
    path: projectDir,
    relativePath,
    title: path.basename(projectDir),
    eligible: false,
    reasons: [],
  };
  if (fs.existsSync(path.join(projectDir, MERGE_MARKER_FILE))) {
    candidate.reasons.push(candidateReason('merged_output', '以前生成した結合済みprojectは再入力できません。'));
    return candidate;
  }
  let config;
  try {
    const configPath = requireProjectFile(projectDir, 'project.json', 'project config');
    config = readJson(configPath, 'project config');
    candidate.title = String(config.title || config.romName || '').trim() || candidate.title;
  } catch (error) {
    candidate.reasons.push(candidateReason('project_config', String(error.message || error)));
    return candidate;
  }
  if (String(config.coreId || 'pc-engine') !== 'pc-engine') {
    candidate.reasons.push(candidateReason('unsupported_core', 'PC Engine projectではありません。'));
  }
  if (String(config.targetMedia || '').toLowerCase() !== 'cd') {
    candidate.reasons.push(candidateReason('unsupported_media', 'CD-ROM2 VN projectではありません。'));
  }
  let sceneDocument;
  try {
    const scenePath = requireProjectFile(projectDir, path.join('assets', 'pce-vn-scenes.json'), 'VN scene document');
    sceneDocument = readJson(scenePath, 'VN scene document');
  } catch (error) {
    candidate.reasons.push(candidateReason('scene_document', String(error.message || error)));
  }
  try {
    const assetPath = requireProjectFile(projectDir, path.join('assets', 'pce-assets.json'), 'asset document');
    const assetDocument = readJson(assetPath, 'asset document');
    if (!Array.isArray(assetDocument.assets)) throw new Error('asset document assets must be an array');
  } catch (error) {
    candidate.reasons.push(candidateReason('asset_document', String(error.message || error)));
  }
  if (sceneDocument) {
    try {
      const scenes = Array.isArray(sceneDocument.scenes) ? sceneDocument.scenes : [];
      if (!scenes.length) throw new Error('VN scene document is empty');
      const startSceneId = String(sceneDocument.startScene || '').trim();
      const startScene = scenes.find((scene) => String(scene?.id || '') === startSceneId);
      if (!startScene) throw new Error(`startScene is unresolved: ${startSceneId || '(empty)'}`);
      validateSelectorSceneForCounter(startScene, projectDir);
    } catch (error) {
      candidate.reasons.push(candidateReason(error.code || 'selector_contract', String(error.message || error)));
    }
  }
  candidate.eligible = candidate.reasons.length === 0;
  return candidate;
}

async function discoverProjectMergeCandidates(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  try {
    const rootDir = canonicalDirectory(options.root, 'project root', cwd);
    const rootKey = pathKey(rootDir);
    const queue = [rootDir];
    const visited = new Set();
    const candidates = [];
    const diagnostics = [];
    while (queue.length) {
      const requested = queue.shift();
      let current;
      try {
        // Keep the same Windows path form as canonicalDirectory(); mixing the
        // promise and sync realpath variants can produce C:\\... vs \\\\?\\C:\\....
        current = fs.realpathSync(requested);
        if (!isPathWithin(rootDir, current)) continue;
        const key = pathKey(current);
        if (visited.has(key)) continue;
        visited.add(key);
        const stat = await fs.promises.lstat(current);
        if (!stat.isDirectory()) continue;
      } catch (error) {
        diagnostics.push(diagnostic('warning', 'directory_unreadable', String(error.message || error), { path: requested }));
        continue;
      }
      let entries;
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch (error) {
        if (pathKey(current) === rootKey) throw error;
        diagnostics.push(diagnostic('warning', 'directory_unreadable', String(error.message || error), { path: current }));
        continue;
      }
      if (entries.some((entry) => entry.isFile() && entry.name === 'project.json')) {
        candidates.push(probeProjectMergeCandidate(current, rootDir));
        continue;
      }
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .sort((left, right) => naturalProjectPathCompare(left.name, right.name))
        .forEach((entry) => queue.push(path.join(current, entry.name)));
    }
    candidates.sort((left, right) => naturalProjectPathCompare(left.relativePath, right.relativePath));
    return { ok: true, root: rootDir, candidates, diagnostics };
  } catch (error) {
    return {
      ok: false,
      error: String(error.message || error),
      candidates: [],
      diagnostics: [diagnostic('error', error.code || 'project_discovery', String(error.message || error))],
    };
  }
}

function collectMergeProjects(options, cwd) {
  const root = String(options.root || '').trim()
    ? canonicalDirectory(options.root, 'project root', cwd)
    : '';
  const projects = asProjectList(options).map((projectPath, index) => collectInputProject(
    projectPath, `m${String(index + 1).padStart(3, '0')}_`, cwd,
  ));
  if (root) {
    projects.forEach((project) => {
      if (!isPathWithin(root, project.canonicalPath)) {
        throw codedError('input_outside_root', `input project is outside the selected root: ${project.canonicalPath}`);
      }
    });
  }
  return { root, projects };
}

function inspectProjectMerge(options = {}) {
  const diagnostics = [];
  try {
    const cwd = path.resolve(options.cwd || process.cwd());
    const projectPaths = asProjectList(options);
    if (projectPaths.length < 2) throw new Error('at least two input projects are required');
    const outputDir = outputDirectory(options, cwd);
    const replace = options.replace === true;
    const { root, projects } = collectMergeProjects(options, cwd);
    const seen = new Set();
    projects.forEach((project) => {
      const key = pathKey(project.canonicalPath);
      if (seen.has(key)) throw new Error(`duplicate input project: ${project.canonicalPath}`);
      seen.add(key);
      if (isPathWithin(project.canonicalPath, outputDir) || isPathWithin(outputDir, project.canonicalPath)) {
        throw new Error(`input and output directories must not contain each other: ${project.canonicalPath} <-> ${outputDir}`);
      }
    });
    for (let i = 0; i < projects.length; i += 1) {
      for (let j = i + 1; j < projects.length; j += 1) {
        if (isPathWithin(projects[i].canonicalPath, projects[j].canonicalPath)
          || isPathWithin(projects[j].canonicalPath, projects[i].canonicalPath)) {
          throw new Error(`input projects must not contain each other: ${projects[i].canonicalPath} <-> ${projects[j].canonicalPath}`);
        }
      }
    }
    if (fs.existsSync(outputDir)) {
      if (!replace) throw new Error(`output already exists; use --replace for an owned merge output: ${outputDir}`);
      if (!fs.statSync(outputDir).isDirectory() || !readMergeMarker(outputDir)) {
        throw new Error(`--replace is allowed only for a directory containing ${MERGE_MARKER_FILE}: ${outputDir}`);
      }
    }
    const title = String(options.title || '').trim() || path.basename(outputDir);
    if (!title) throw new Error('title is empty');
    const plan = createMergedPlan(projects, outputDir, title, replace, root);

    const baselineConfig = sanitizedConfigForComparison(projects[0].config);
    projects.slice(1).forEach((project, index) => {
      const configDifferences = settingDifferencePaths(baselineConfig, sanitizedConfigForComparison(project.config));
      const differences = [...configDifferences];
      if (stableJson(projects[0].sceneDocument.settings || {}) !== stableJson(project.sceneDocument.settings || {})) {
        differences.push('vn.settings');
      }
      if (stableJson(projects[0].fontDocument || null) !== stableJson(project.fontDocument || null)) differences.push('font');
      if (differences.length) {
        diagnostics.push(diagnostic(
          'warning', 'settings_difference',
          `input ${index + 2} settings differ from input 1; input 1 values will be used`,
          { project: project.canonicalPath, fields: Array.from(new Set(differences)).sort() },
        ));
      }
    });
    if (!plan.assetDocument.assets.some((asset) => asset.type === 'cdda-warning')) {
      diagnostics.push(diagnostic('error', 'missing_cdda_warning', 'no valid cdda_warning asset was found'));
    }
    const buildInspection = vnManager.inspectVnSceneDocumentBuild('', {
      doc: plan.sceneDocument,
      assetDoc: plan.assetDocument,
      targetMedia: 'cd',
    });
    diagnostics.push(...(buildInspection.diagnostics || []));
    const errors = diagnostics.filter((entry) => entry.severity === 'error');
    const warnings = diagnostics.filter((entry) => entry.severity === 'warning');
    return {
      ok: errors.length === 0,
      outputDir, title, replace, root: root || undefined,
      signature: plan.signature,
      inputSignature: plan.inputSignature,
      inputs: plan.marker.inputs,
      namespaces: plan.marker.inputs.map((entry) => entry.namespace),
      counts: plan.marker.counts,
      diagnostics, errors, warnings,
      buildInspection: {
        ok: buildInspection.ok,
        totals: buildInspection.totals,
        limits: buildInspection.limits,
        sceneBudgets: buildInspection.sceneBudgets,
      },
      marker: plan.marker,
    };
  } catch (error) {
    diagnostics.push(diagnostic('error', error.code || 'merge_inspection', String(error.message || error)));
    return {
      ok: false,
      error: String(error.message || error),
      diagnostics,
      errors: diagnostics,
      warnings: [],
    };
  }
}

function copyTemplateTree(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.readdirSync(sourceDir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'out' || entry.name === 'assets' || entry.name === 'project.json') return;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyTemplateTree(source, target);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function materializePlan(plan, targetDir) {
  const templateDir = path.join(__dirname, 'template', CD_TEMPLATE_ID);
  if (!fs.existsSync(templateDir)) throw new Error(`CD VN template is missing: ${templateDir}`);
  copyTemplateTree(templateDir, targetDir);
  writeJson(path.join(targetDir, 'project.json'), plan.outputConfig);
  writeJson(path.join(targetDir, 'assets', 'pce-assets.json'), plan.assetDocument);
  writeJson(path.join(targetDir, 'assets', 'pce-vn-scenes.json'), plan.sceneDocument);
  if (plan.fontDocument) writeJson(path.join(targetDir, 'assets', 'pce-font.json'), plan.fontDocument);
  plan.copyFiles.forEach((entry) => {
    const destination = path.resolve(targetDir, ...entry.destination.split('/'));
    if (!isPathWithin(targetDir, destination)) throw new Error(`copy destination escapes output: ${entry.destination}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(entry.source, destination);
  });
  writeJson(path.join(targetDir, MERGE_MARKER_FILE), plan.marker);
}

function removeTemporaryDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  const parent = path.dirname(directory);
  if (!isPathWithin(parent, directory) || path.resolve(parent) === path.resolve(directory)) {
    throw new Error(`refusing to remove unsafe temporary directory: ${directory}`);
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

function applyProjectMerge(options = {}) {
  const initial = inspectProjectMerge(options);
  if (!initial.ok) return initial;
  const expectedSignature = String(options.signature || options.inspectionSignature || '').trim();
  if (!expectedSignature) {
    return {
      ok: false,
      error: 'inspection signature is required',
      diagnostics: [diagnostic('error', 'signature_required', 'inspection signature is required')],
    };
  }
  if (expectedSignature !== initial.signature) {
    return {
      ok: false,
      error: 'inputs or merge options changed after inspection; inspect again',
      signature: initial.signature,
      diagnostics: [diagnostic('error', 'signature_mismatch', 'inputs or merge options changed after inspection; inspect again')],
    };
  }

  const cwd = path.resolve(options.cwd || process.cwd());
  const { root, projects } = collectMergeProjects(options, cwd);
  const plan = createMergedPlan(projects, initial.outputDir, initial.title, initial.replace, root);
  const parent = path.dirname(plan.outputDir);
  const tempDir = fs.mkdtempSync(path.join(parent, `.${path.basename(plan.outputDir)}.merge-`));
  let backupDir = '';
  try {
    materializePlan(plan, tempDir);
    const buildInspection = vnManager.inspectVnSceneDocumentBuild(tempDir, {
      doc: plan.sceneDocument,
      assetDoc: plan.assetDocument,
      targetMedia: 'cd',
    });
    if (!buildInspection.ok) {
      const message = (buildInspection.errors || []).map((entry) => entry.message).join('; ') || 'build inspection failed';
      throw new Error(message);
    }
    const finalInspection = inspectProjectMerge(options);
    if (!finalInspection.ok || finalInspection.signature !== expectedSignature) {
      const error = new Error('inputs changed while the merge output was being prepared; inspect again');
      error.code = 'signature_mismatch';
      throw error;
    }
    if (fs.existsSync(plan.outputDir)) {
      if (!plan.replace || !readMergeMarker(plan.outputDir)) {
        throw new Error(`existing output is not an owned merge output: ${plan.outputDir}`);
      }
      backupDir = path.join(parent, `.${path.basename(plan.outputDir)}.merge-backup-${crypto.randomUUID()}`);
      fs.renameSync(plan.outputDir, backupDir);
    }
    try {
      fs.renameSync(tempDir, plan.outputDir);
    } catch (error) {
      if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(plan.outputDir)) fs.renameSync(backupDir, plan.outputDir);
      throw error;
    }
    if (backupDir && fs.existsSync(backupDir)) removeTemporaryDirectory(backupDir);
    return {
      ...finalInspection,
      ok: true,
      applied: true,
      outputDir: plan.outputDir,
      markerPath: path.join(plan.outputDir, MERGE_MARKER_FILE),
      buildInspection: {
        ok: true,
        totals: buildInspection.totals,
        limits: buildInspection.limits,
        sceneBudgets: buildInspection.sceneBudgets,
      },
    };
  } catch (error) {
    if (fs.existsSync(tempDir)) removeTemporaryDirectory(tempDir);
    if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(plan.outputDir)) fs.renameSync(backupDir, plan.outputDir);
    return {
      ok: false,
      error: String(error.message || error),
      signature: plan.signature,
      diagnostics: [diagnostic('error', error.code || 'merge_apply', String(error.message || error))],
    };
  }
}

module.exports = {
  MERGE_MARKER_FILE,
  MERGE_MARKER_VERSION,
  ASSET_ID_LIMIT,
  SCENE_ID_LIMIT,
  VARIABLE_NAME_LIMIT,
  SELECTOR_COUNTER_SLOT,
  SELECTOR_COUNTER_Y,
  naturalProjectPathCompare,
  validateSelectorSceneForCounter,
  injectScenarioCounter,
  discoverProjectMergeCandidates,
  inspectProjectMerge,
  applyProjectMerge,
  readMergeMarker,
};
