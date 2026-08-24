'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeAssetDocument, resolveAssetSource } = require('./pce-asset-manager');
const { isCommandSkipped, normalizeSceneDocument } = require('./pce-vn-manager');
const { isPathInside, normalizeRelativePath } = require('./pce-file-safety');
const { DEFAULT_FONT } = require('./pce-vn-gb-studio-font');
const { buildConversionModel, buildGbStudioFiles, buildMusic, speakerToneFrequency, targetlessAsyncContinuation, transformBackgrounds, validateExternalMod } = require('./pce-vn-gb-studio-project');

const EXPORTER_FORMAT = 'pce-vn-gb-studio-export';
const EXPORTER_VERSION = 1;
const TARGET_GB_STUDIO_VERSION = '4.3.2';
const SUPPORTED_GB_STUDIO_VERSIONS = Object.freeze(['4.3.1', '4.3.2']);
const TARGET_ENGINE_VERSION = '4.3.0-e1';
const SIDECAR_FILE = path.join('assets', 'pce-vn-gb-studio-export.json');
const MANIFEST_FILE = 'pce-vn-gb-studio-export.manifest.json';

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function sourceProjectIdentity(projectDir) { const resolved = path.resolve(projectDir); const canonical = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved; return sha256(canonical.replace(/\//g, path.sep).toLowerCase()); }
function stableValue(value) { if (Array.isArray(value)) return value.map(stableValue); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])); return value; }
function stableJson(value) { return JSON.stringify(stableValue(value)); }
function diagnostic(severity, code, message, location = '', data = {}) { return { severity, code, message, location, data }; }
function readJson(filePath, label = path.basename(filePath)) { try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (error) { throw new Error(`${label}を読み込めません: ${error?.message || error}`); } }

function readAsarEntry(asarPath, entryPath) {
  // Electron replaces node:fs with an ASAR-aware virtual filesystem. Opening the
  // archive itself through that patched API fails with "ENOENT, not found in
  // ...app.asar". @electron/asar deliberately uses original-fs in Electron and
  // regular fs in the CLI, so keep all raw archive access behind its public API.
  return require('@electron/asar').extractFile(asarPath, path.join(...String(entryPath).split('/').filter(Boolean)));
}

function normalizeGbStudioExecutablePath(input) {
  let value = String(input || '').trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1).trim();
  return path.resolve(value);
}

function isSupportedGbStudioInstallation(installation) {
  return Boolean(installation?.verified && SUPPORTED_GB_STUDIO_VERSIONS.includes(String(installation.version || '')) && String(installation.engineVersion || '') === TARGET_ENGINE_VERSION);
}

function inspectGbStudioInstallation(input) {
  if (input && typeof input === 'object' && input.version) return { executablePath: String(input.executablePath || ''), version: String(input.version), engineVersion: String(input.engineVersion || ''), verified: Boolean(input.verified ?? true) };
  const executablePath = normalizeGbStudioExecutablePath(input); if (!String(input || '').trim() || !fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) return { executablePath, version: '', engineVersion: '', verified: false, error: 'GB Studio実行ファイルが見つかりません' };
  try { const asarPath = path.join(path.dirname(executablePath), 'resources', 'app.asar'); const pkg = JSON.parse(readAsarEntry(asarPath, 'package.json').toString('utf-8')); const engine = JSON.parse(readAsarEntry(asarPath, 'appData/engine/engine.json').toString('utf-8')); return { executablePath, version: String(pkg.version || ''), engineVersion: String(engine.version || ''), verified: true }; } catch (error) { return { executablePath, version: '', engineVersion: '', verified: false, error: String(error?.message || error) }; }
}

function normalizeSidecar(value = {}) {
  const raw = value && typeof value === 'object' ? value : {}; return { format: EXPORTER_FORMAT, version: EXPORTER_VERSION, font: String(raw.font || DEFAULT_FONT), visualOmissionsConfirmed: Boolean(raw.visualOmissionsConfirmed), warningsAcknowledged: Boolean(raw.warningsAcknowledged), cddaMappings: raw.cddaMappings && typeof raw.cddaMappings === 'object' ? raw.cddaMappings : {}, audioSubstitutions: raw.audioSubstitutions && typeof raw.audioSubstitutions === 'object' ? raw.audioSubstitutions : {}, backgrounds: raw.backgrounds && typeof raw.backgrounds === 'object' ? raw.backgrounds : {} };
}

function readSidecar(projectDir) { const filePath = path.join(projectDir, SIDECAR_FILE); return fs.existsSync(filePath) ? normalizeSidecar(readJson(filePath, SIDECAR_FILE)) : normalizeSidecar(); }
function mergedSettings(projectDir, explicit = {}) { const sidecar = readSidecar(projectDir); return normalizeSidecar({ ...sidecar, ...explicit, cddaMappings: { ...sidecar.cddaMappings, ...(explicit.cddaMappings || {}) }, audioSubstitutions: { ...sidecar.audioSubstitutions, ...(explicit.audioSubstitutions || {}) }, backgrounds: { ...sidecar.backgrounds, ...(explicit.backgrounds || {}) } }); }

function referencedFiles(projectDir, sceneDoc, assetDoc, settings) {
  const ids = new Set(); for (const scene of sceneDoc.scenes || []) for (const command of scene.commands || []) for (const key of ['assetId', 'voiceAssetId', 'animationAssetId']) if (command[key]) ids.add(command[key]); Object.values(settings.cddaMappings || {}).forEach((mapping) => ids.add(typeof mapping === 'string' ? mapping : mapping?.targetAssetId));
  const assets = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset])); const files = [path.join(projectDir, 'project.json'), path.join(projectDir, 'assets', 'pce-assets.json'), path.join(projectDir, 'assets', 'pce-vn-scenes.json')];
  ids.forEach((id) => { const asset = assets.get(id); if (!asset) return; try { const source = resolveAssetSource(projectDir, asset).absPath; if (source) files.push(source); } catch (_) {} });
  if (settings.font && settings.font !== DEFAULT_FONT && path.isAbsolute(settings.font) && fs.existsSync(settings.font)) files.push(settings.font);
  Object.values(settings.cddaMappings || {}).forEach((mapping) => { if (mapping?.type !== 'external-mod' || !mapping.source) return; const source = path.isAbsolute(mapping.source) ? path.resolve(mapping.source) : path.resolve(projectDir, mapping.source); if (fs.existsSync(source)) files.push(source); });
  return [...new Set(files.map((file) => path.resolve(file)).filter((file) => fs.existsSync(file) && fs.statSync(file).isFile()))].sort();
}

function sourceSnapshot(projectDir, sceneDoc, assetDoc, settings) { const files = referencedFiles(projectDir, sceneDoc, assetDoc, settings).map((file) => ({ path: isPathInside(projectDir, file) ? normalizeRelativePath(path.relative(projectDir, file)) : `external:${path.basename(file)}`, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) })); return { files, signature: sha256(stableJson({ sceneDoc, assetDoc, settings, files })) }; }

function validateCommands(sceneDoc, assetDoc, settings, projectDir) {
  const diagnostics = []; const omissions = []; const assets = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset])); const sceneIds = new Set((sceneDoc.scenes || []).map((scene) => scene.id));
  const add = (severity, code, message, location, data) => diagnostics.push(diagnostic(severity, code, message, location, data));
  for (const scene of sceneDoc.scenes || []) {
    const labels = new Set((scene.commands || []).filter((command) => command.type === 'label').map((command) => command.name));
    for (let index = 0; index < (scene.commands || []).length; index += 1) {
      const command = scene.commands[index]; if (!command || isCommandSkipped(command) || command.type === 'comment') continue; const location = `${scene.id}.commands[${index}]`;
      if (!['background', 'message', 'choice', 'jump', 'wait', 'audio', 'variable', 'if', 'switch', 'label', 'goto', 'inputcheck', 'spritetext', 'sprite', 'spritemove', 'effect', 'cache'].includes(command.type)) { add('error', 'GBVN_UNKNOWN_COMMAND', `未対応commandです: ${command.type}`, location); continue; }
      if (command.type === 'background' && (!command.assetId || assets.get(command.assetId)?.type !== 'image')) add('error', 'GBVN_UNRESOLVED_ASSET', `背景assetを解決できません: ${command.assetId || '(空)'}`, location);
      if (command.type === 'jump' && (!command.sceneId || !sceneIds.has(command.sceneId))) add('error', 'GBVN_UNRESOLVED_SCENE', `jump先sceneを解決できません: ${command.sceneId || '(空)'}`, location);
      if (command.type === 'choice') {
        if ((command.choices || []).length !== 2) add('error', 'GBVN_CHOICE_OPTION_COUNT', `Phase 1のchoiceは2択必須です: ${(command.choices || []).length}択`, location);
        for (const choice of command.choices || []) if (!choice.targetSceneId || !sceneIds.has(choice.targetSceneId)) add('error', 'GBVN_UNRESOLVED_SCENE', `choice先sceneを解決できません: ${choice.targetSceneId || '(空)'}`, location);
      }
      if (command.type === 'goto' && (!command.targetLabel || !labels.has(command.targetLabel))) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `goto先labelを解決できません: ${command.targetLabel || '(空)'}`, location);
      if (command.type === 'if') { if (!command.targetLabel || !labels.has(command.targetLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `if true labelを解決できません: ${command.targetLabel || '(空)'}`, location); if (command.elseLabel && !labels.has(command.elseLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `if false labelを解決できません: ${command.elseLabel}`, location); }
      if (command.type === 'switch') for (const branch of command.cases || []) if (!branch.targetLabel || !labels.has(branch.targetLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `switch labelを解決できません: ${branch.targetLabel || '(空)'}`, location);
      if (command.type === 'inputcheck' && command.mode === 'async' && !command.targetLabel && !targetlessAsyncContinuation(scene.commands, index)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', 'targetLabelなしasync inputcheckは直後のwait、または後続のsync inputcheckの通常継続と組である必要があります', location);
      if (command.type === 'sprite' || command.type === 'spritemove') { omissions.push({ sceneId: scene.id, commandIndex: index, type: command.type, reason: 'Phase 1立ち絵省略' }); if (!settings.visualOmissionsConfirmed) add('error', 'GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION', `${command.type}を省略するには明示確認が必要です`, location); }
      if (command.type === 'effect' && command.effect !== 'shake') { omissions.push({ sceneId: scene.id, commandIndex: index, type: `effect:${command.effect}`, reason: 'Phase 1視覚効果省略' }); if (!settings.visualOmissionsConfirmed) add('error', 'GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION', `effect ${command.effect}を省略するには明示確認が必要です`, location); }
      if (command.type === 'cache') omissions.push({ sceneId: scene.id, commandIndex: index, type: 'cache', reason: 'GB Studioでは事前cache不要' });
      if (command.type === 'audio' && command.action === 'play') {
        const asset = assets.get(command.assetId); if (!asset) add('error', 'GBVN_UNRESOLVED_ASSET', `audio assetを解決できません: ${command.assetId || '(空)'}`, location);
        else if (command.kind === 'cdda') { const mapping = settings.cddaMappings[command.assetId]; const target = typeof mapping === 'string' ? mapping : mapping?.targetAssetId; if (mapping?.type === 'external-mod') { const source = path.isAbsolute(mapping.source || '') ? path.resolve(mapping.source) : path.resolve(projectDir, mapping.source || ''); try { if (!mapping.source || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('MOD fileが見つかりません'); validateExternalMod(fs.readFileSync(source), command.assetId); } catch (error) { add('error', 'GBVN_CDDA_MAPPING_REQUIRED', `CDDA ${command.assetId} の外部MODが無効です: ${error.message}`, location); } } else if (!target || assets.get(target)?.type !== 'psg-song') add('error', 'GBVN_CDDA_MAPPING_REQUIRED', `CDDA ${command.assetId} にPSG-songまたは外部MOD代替の指定が必要です`, location); }
        else if ((asset.type === 'psg-sfx' || asset.type === 'adpcm') && !settings.audioSubstitutions[command.assetId]) add('error', 'GBVN_UNRESOLVED_ASSET', `${asset.type} ${command.assetId} にtone/omit代替の指定が必要です`, location);
      }
    }
  }
  return { diagnostics, omissions };
}

function inspectGbStudioExport({ projectDir, doc, assets, settings: explicitSettings = {}, gbStudio } = {}) {
  const root = path.resolve(String(projectDir || '')); const diagnostics = [];
  try {
    if (!root || !fs.existsSync(path.join(root, 'project.json'))) throw new Error('有効なPC Engineプロジェクトが開かれていません');
    const project = readJson(path.join(root, 'project.json'), 'project.json'); if (String(project.coreId || '') !== 'pc-engine') throw new Error('PC EngineプロジェクトだけをGB Studioへ変換できます');
    const rawAssets = assets && typeof assets === 'object' ? assets : readJson(path.join(root, 'assets', 'pce-assets.json'), 'assets/pce-assets.json'); const assetDoc = normalizeAssetDocument(rawAssets);
    const rawDoc = doc && typeof doc === 'object' ? doc : readJson(path.join(root, 'assets', 'pce-vn-scenes.json'), 'assets/pce-vn-scenes.json'); const sceneDoc = normalizeSceneDocument(rawDoc, assetDoc); const settings = mergedSettings(root, explicitSettings); const installation = inspectGbStudioInstallation(gbStudio || explicitSettings.gbStudioExecutable);
    if (!isSupportedGbStudioInstallation(installation)) { const detail = installation.error ? `; ${installation.error}` : ''; diagnostics.push(diagnostic('error', 'GBVN_GB_STUDIO_VERSION_MISMATCH', `GB Studio ${SUPPORTED_GB_STUDIO_VERSIONS.join(' または ')} / engine ${TARGET_ENGINE_VERSION} が必要です（検出: ${installation.version || '不明'} / ${installation.engineVersion || '不明'}${detail}）`, 'gbStudio', installation)); }
    const commandValidation = validateCommands(sceneDoc, assetDoc, settings, root); diagnostics.push(...commandValidation.diagnostics);
    let model = null; let backgrounds = null; let music = null;
    try { model = buildConversionModel({ projectDir: root, project, sceneDoc, assetDoc, settings, gbStudio: installation }); } catch (error) { diagnostics.push(diagnostic('error', error.code || 'GBVN_FONT_GLYPH_MISSING', String(error?.message || error), 'font', { glyphs: error.glyphs || [] })); }
    if (model) {
      try { backgrounds = transformBackgrounds(model); backgrounds.audits.forEach((audit) => { if (audit.gbc.palettes > 7 || audit.gbc.maxColorsPerTile > 4) diagnostics.push(diagnostic('error', 'GBVN_GBC_PALETTE_OVERFLOW', `${audit.key}: GBC palette制約を超えています`, `background:${audit.key}`, audit.gbc)); if (audit.dmg.uniqueTiles > 192) diagnostics.push(diagnostic('error', 'GBVN_DMG_TILE_OVERFLOW', `${audit.key}: DMG固有tileが192を超えています`, `background:${audit.key}`, audit.dmg)); if (audit.dmg.meaningfulShades < 4) diagnostics.push(diagnostic('warning', 'GBVN_DMG_SHADE_UNDERUSE', `${audit.key}: 原画の階調が少ないためDMG 4階調の一部を有意量使用していません`, `background:${audit.key}`, audit.dmg)); }); } catch (error) { diagnostics.push(diagnostic('error', error.code || 'GBVN_UNRESOLVED_ASSET', String(error?.message || error), 'backgrounds')); }
      try { music = buildMusic(model); music.audits.forEach((audit) => { if (audit.droppedEvents.length || audit.transposedEvents.length || audit.controlConflicts.length) diagnostics.push(diagnostic('warning', 'GBVN_PSG_EVENT_DROPPED', `${audit.assetId}: channel競合等を監査reportへ記録します（drop ${audit.droppedEvents.length} / transpose ${audit.transposedEvents.length}）`, `music:${audit.assetId}`, audit)); }); } catch (error) { diagnostics.push(diagnostic('error', error.code || 'GBVN_PSG_EVENT_DROPPED', String(error?.message || error), 'music')); }
    }
    commandValidation.omissions.forEach((omission) => diagnostics.push(diagnostic('warning', 'GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION', `${omission.type}を変換対象から省略します: ${omission.reason}`, `${omission.sceneId}.commands[${omission.commandIndex}]`, omission)));
    const referencedCdda = new Set(); const referencedSubstitutions = new Set(); const automaticVoiceSubstitutions = []; const assetTypes = new Map(assetDoc.assets.map((asset) => [asset.id, asset.type])); for (const scene of sceneDoc.scenes) for (const [commandIndex, command] of scene.commands.entries()) { if (command.type === 'audio' && command.action === 'play' && command.kind === 'cdda' && command.assetId) referencedCdda.add(command.assetId); if (command.type === 'audio' && command.action === 'play' && ['adpcm', 'psg'].includes(command.kind) && ['adpcm', 'psg-sfx'].includes(assetTypes.get(command.assetId))) referencedSubstitutions.add(command.assetId); if (command.type === 'message' && command.voiceAssetId) automaticVoiceSubstitutions.push({ sceneId: scene.id, commandIndex, voiceAssetId: command.voiceAssetId, speaker: String(command.speaker || ''), frequency: speakerToneFrequency(command.speaker), substitution: 'text-tone' }); }
    const psgSongs = assetDoc.assets.filter((asset) => asset.type === 'psg-song').map((asset) => ({ id: asset.id, name: asset.name || asset.id })); const snapshot = sourceSnapshot(root, sceneDoc, assetDoc, settings); const errors = diagnostics.filter((entry) => entry.severity === 'error'); const warnings = diagnostics.filter((entry) => entry.severity === 'warning');
    const result = { ok: errors.length === 0, format: EXPORTER_FORMAT, version: EXPORTER_VERSION, projectDir: root, project: { title: project.title || project.name || '', romName: project.romName || '' }, settings, gbStudio: installation, sourceSignature: snapshot.signature, sourceFiles: snapshot.files, errors, warnings, omissions: commandValidation.omissions, requirements: { cdda: [...referencedCdda].map((id) => ({ id, name: assetDoc.assets.find((asset) => asset.id === id)?.name || id, mapping: settings.cddaMappings[id] || '' })), audioSubstitutions: [...referencedSubstitutions].map((id) => ({ id, name: assetDoc.assets.find((asset) => asset.id === id)?.name || id, type: assetDoc.assets.find((asset) => asset.id === id)?.type || '', mapping: settings.audioSubstitutions[id] || '' })), automaticVoiceSubstitutions, psgSongs }, summary: { sourceScenes: sceneDoc.scenes.length, sourceCommands: sceneDoc.scenes.reduce((sum, scene) => sum + scene.commands.length, 0), outputScenes: model ? model.graph.segments.length * 2 + 1 : 0, backgroundVariants: model ? model.backgroundVariants.length : 0, fontGlyphs: model ? model.font.glyphCount : 0, fontPages: model ? model.font.pages.length : 0, musicTracks: model ? model.music.length + (model.externalMusic?.length || 0) : 0, variables: model ? model.variables.names.length : 0, automaticVoiceSubstitutions: automaticVoiceSubstitutions.length }, audits: { backgrounds: backgrounds?.audits || [], music: music?.audits || [] } };
    Object.defineProperties(result, { _model: { value: model, enumerable: false }, _backgrounds: { value: backgrounds, enumerable: false }, _music: { value: music, enumerable: false }, _request: { value: { projectDir: root, doc: rawDoc, assets: rawAssets, settings: explicitSettings, gbStudio: installation }, enumerable: false } }); return result;
  } catch (error) { const entry = diagnostic('error', 'GBVN_INPUT_SIGNATURE_CHANGED', String(error?.message || error), 'project'); return { ok: false, format: EXPORTER_FORMAT, version: EXPORTER_VERSION, projectDir: root, errors: [entry], warnings: [], omissions: [], summary: {}, audits: { backgrounds: [], music: [] } }; }
}

function walkFiles(root) { const output = []; if (!fs.existsSync(root)) return output; const visit = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) visit(absolute); else if (entry.isFile()) output.push(absolute); } }; visit(root); return output; }
function safeRelative(relativePath) { const normalized = normalizeRelativePath(String(relativePath || '')); if (!normalized || normalized.split('/').includes('..') || path.isAbsolute(normalized)) throw new Error(`不正な生成pathです: ${relativePath}`); return normalized; }
function writeFileMap(root, files) { for (const [relative, data] of files) { const safe = safeRelative(relative); const absolute = path.resolve(root, safe); if (!isPathInside(root, absolute)) throw new Error(`出力path traversalを拒否しました: ${relative}`); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, data); } }

function readOwnership(outputDir) {
  const manifestPath = path.join(outputDir, MANIFEST_FILE); if (!fs.existsSync(manifestPath)) return null; const manifest = readJson(manifestPath, MANIFEST_FILE); if (manifest.format !== EXPORTER_FORMAT || manifest.version !== EXPORTER_VERSION || !Array.isArray(manifest.ownedPaths)) return null;
  manifest.ownedPaths.forEach((entry) => safeRelative(typeof entry === 'string' ? entry : entry.path)); return manifest;
}

function ensureOutputTarget(outputDir, projectDir) { const target = path.resolve(String(outputDir || '')); if (!target || path.parse(target).root === target || target === path.resolve(projectDir)) throw new Error('出力先にrootまたは入力project自身は指定できません'); const parent = path.dirname(target); if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true }); return target; }

function staticValidateFiles(files) {
  const errors = []; const resources = { scenes: new Map(), backgrounds: new Set(), fonts: new Set(), music: new Set() }; let settings = null; let descriptor = 0;
  for (const [relative, data] of files) {
    if (relative.endsWith('.gbsproj')) descriptor += 1; if (!relative.endsWith('.gbsres')) continue;
    try { const value = JSON.parse(Buffer.from(data).toString('utf-8')); if (value._resourceType === 'settings') settings = value; if (value._resourceType === 'scene') resources.scenes.set(value.id, value); if (value._resourceType === 'background') resources.backgrounds.add(value.id); if (value._resourceType === 'font') resources.fonts.add(value.id); if (value._resourceType === 'music') resources.music.add(value.id); if (value.filename && (path.isAbsolute(value.filename) || String(value.filename).includes('..'))) errors.push(`resource filenameが不正です: ${relative}`); } catch (error) { errors.push(`JSON resourceを読めません: ${relative}: ${error.message}`); }
  }
  if (descriptor !== 1) errors.push(`.gbsprojは1個必要です: ${descriptor}`); if (!settings || settings.colorMode !== 'mixed') errors.push('settings.colorModeはmixed必須です'); if (settings && !resources.scenes.has(settings.startSceneId)) errors.push('startSceneIdを解決できません');
  const scanEvents = (events, location) => { let prepared = false; for (const item of events || []) { if (item.command === 'PCE_VN_EVENT_DIALOGUE_PREPARE') prepared = true; if (item.command === 'EVENT_TEXT' || item.command === 'EVENT_CHOICE') { if (!prepared) errors.push(`${location}: framed text前にdialogue prepareがありません`); prepared = false; } if (item.command === 'EVENT_SWITCH_SCENE' && !resources.scenes.has(item.args?.sceneId)) errors.push(`${location}: scene参照を解決できません ${item.args?.sceneId}`); if (item.command === 'EVENT_MUSIC_PLAY' && !resources.music.has(item.args?.musicId)) errors.push(`${location}: music参照を解決できません ${item.args?.musicId}`); if (item.command === 'EVENT_SET_FONT' && !resources.fonts.has(item.args?.fontId)) errors.push(`${location}: font参照を解決できません ${item.args?.fontId}`); Object.entries(item.children || {}).forEach(([key, children]) => scanEvents(children, `${location}/${item.id}/${key}`)); } };
  for (const scene of resources.scenes.values()) { if (!resources.backgrounds.has(scene.backgroundId)) errors.push(`${scene.id}: background参照を解決できません ${scene.backgroundId}`); scanEvents(scene.script, scene.id); }
  for (const required of ['plugins/pce-vn-dialogue-prepare/engine/engine.json', 'plugins/pce-vn-dialogue-prepare/events/eventPceVnDialoguePrepare.js', 'plugins/pce-vn-dialogue-prepare/engine/src/core/pce_vn_dialogue_prepare.c']) if (!files.has(required)) errors.push(`必須dialogue plugin fileがありません: ${required}`);
  return { ok: errors.length === 0, errors, counts: { scenes: resources.scenes.size, backgrounds: resources.backgrounds.size, fonts: resources.fonts.size, music: resources.music.size } };
}

function portableSidecar(projectDir, settings) {
  const sidecar = normalizeSidecar(settings); sidecar.cddaMappings = { ...sidecar.cddaMappings }; const copies = [];
  const portableFile = (spec, subdirectory) => { const source = path.isAbsolute(spec) ? path.resolve(spec) : path.resolve(projectDir, spec); if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`保存対象fileが見つかりません: ${spec}`); if (isPathInside(projectDir, source)) return normalizeRelativePath(path.relative(projectDir, source)); const extension = path.extname(source).toLowerCase(); const relative = normalizeRelativePath(path.join('assets', subdirectory, `${sha256(fs.readFileSync(source)).slice(0, 16)}${extension}`)); copies.push({ source, relative }); return relative; };
  if (sidecar.font !== DEFAULT_FONT) sidecar.font = portableFile(sidecar.font, path.join('fonts', 'gb-studio-export'));
  for (const [assetId, mapping] of Object.entries(sidecar.cddaMappings)) if (mapping?.type === 'external-mod' && mapping.source) sidecar.cddaMappings[assetId] = { ...mapping, source: portableFile(mapping.source, path.join('music', 'gb-studio-export')) };
  return { sidecar, copies };
}

function writeJsonAtomic(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf-8'); fs.renameSync(temporary, filePath); }

function runOfficialBuildSync(inspection, outputDir, descriptorPath) {
  const script = path.join(__dirname, 'tools', 'dev', 'pce-vn-gb-studio-official-build.js'); const result = spawnSync(process.execPath, [script, '--gb-studio', inspection.gbStudio.executablePath, '--gb-studio-version', inspection.gbStudio.version, '--engine-version', inspection.gbStudio.engineVersion, '--project', descriptorPath, '--out', outputDir], { cwd: __dirname, encoding: 'utf-8', timeout: 420000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) { const report = { status: 'fail', code: 'GBVN_OFFICIAL_BUILD_WARNING', error: String(result.error?.message || result.stderr || `exit ${result.status}`), stdout: result.stdout || '', stderr: result.stderr || '' }; writeJsonAtomic(path.join(outputDir, 'build', 'qa', 'official-build-report.json'), report); const error = new Error(`GB Studio公式buildに失敗しました: ${report.error}`); error.code = 'GBVN_OFFICIAL_BUILD_WARNING'; error.report = report; throw error; }
  try { return JSON.parse(result.stdout); } catch (error) { throw new Error(`GB Studio公式build reportを解析できません: ${error.message}`); }
}

function refreshManifestBuildOwnership(outputDir) {
  const manifestPath = path.join(outputDir, MANIFEST_FILE); const manifest = readJson(manifestPath, MANIFEST_FILE); const buildFiles = walkFiles(path.join(outputDir, 'build')).filter((file) => /build[\\/](rom|web|qa)[\\/]/i.test(file)); const byPath = new Map(manifest.ownedPaths.map((entry) => [typeof entry === 'string' ? entry : entry.path, entry]));
  buildFiles.forEach((absolute) => { const relative = normalizeRelativePath(path.relative(outputDir, absolute)); byPath.set(relative, { path: relative, size: fs.statSync(absolute).size, sha256: sha256(fs.readFileSync(absolute)) }); }); manifest.ownedPaths = [...byPath.values()].sort((a, b) => String(a.path || a).localeCompare(String(b.path || b))); writeJsonAtomic(manifestPath, manifest); return manifest;
}

function manifestFor(files, inspection, stats) {
  const ownedPaths = [...files].map(([relative, data]) => ({ path: safeRelative(relative), size: Buffer.byteLength(data), sha256: sha256(data) })).sort((a, b) => a.path.localeCompare(b.path)); ownedPaths.push({ path: MANIFEST_FILE, size: 0, sha256: '' });
  const font = inspection.settings.font === DEFAULT_FONT ? { kind: 'builtin', id: DEFAULT_FONT, name: 'Misaki Gothic', version: '2021-05-05', sourceSha256: '28a8745552c844f7c73f11bdf4470225f5e08645a98c5404b2e25bb326a5cabd', license: 'Misaki Font License' } : { kind: 'custom', filename: path.basename(inspection.settings.font) };
  return { format: EXPORTER_FORMAT, version: EXPORTER_VERSION, exporter: { id: 'pce-vn-gb-studio-exporter', version: '1.1.1' }, generatedAt: new Date().toISOString(), sourceProject: { identity: sourceProjectIdentity(inspection.projectDir), title: inspection.project?.title || '', romName: inspection.project?.romName || '' }, sourceSignature: inspection.sourceSignature, gbStudio: { version: inspection.gbStudio.version, engineVersion: inspection.gbStudio.engineVersion }, conversion: { font, cddaMappings: stableValue(inspection.settings.cddaMappings || {}), audioSubstitutions: stableValue(inspection.settings.audioSubstitutions || {}), automaticVoiceSubstitutions: inspection.requirements?.automaticVoiceSubstitutions || [], visualOmissions: inspection.omissions || [] }, stats, ownedPaths };
}

function commitFileMap(outputDir, stageDir, files, oldManifest) {
  const existed = fs.existsSync(outputDir); const existingFiles = existed ? walkFiles(outputDir) : []; if (existed && existingFiles.length && !oldManifest) { const error = new Error('出力先はexporter所有ではありません。空フォルダかmanifest付き生成物を指定してください'); error.code = 'GBVN_OUTPUT_NOT_OWNED'; throw error; }
  let backupPath = '';
  if (oldManifest) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); backupPath = path.join(path.dirname(outputDir), `${path.basename(outputDir)}.pce-vn-gb-backup-${timestamp}`); const oldEntries = oldManifest.ownedPaths.map((entry) => safeRelative(typeof entry === 'string' ? entry : entry.path));
    for (const relative of oldEntries) { const source = path.resolve(outputDir, relative); if (!isPathInside(outputDir, source) || !fs.existsSync(source) || !fs.statSync(source).isFile()) continue; const destination = path.resolve(backupPath, relative); if (!isPathInside(backupPath, destination)) throw new Error('backup path traversalを拒否しました'); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination); }
  }
  if (!existed || existingFiles.length === 0) { if (existed) fs.rmdirSync(outputDir); fs.renameSync(stageDir, outputDir); return { backupPath }; }
  const newPaths = new Set(files.keys());
  for (const [relative] of files) { const source = path.resolve(stageDir, relative); const destination = path.resolve(outputDir, relative); if (!isPathInside(outputDir, destination)) throw new Error('commit path traversalを拒否しました'); fs.mkdirSync(path.dirname(destination), { recursive: true }); const temporary = `${destination}.tmp-${process.pid}`; fs.copyFileSync(source, temporary); fs.renameSync(temporary, destination); }
  for (const entry of oldManifest.ownedPaths) { const relative = safeRelative(typeof entry === 'string' ? entry : entry.path); if (newPaths.has(relative)) continue; const absolute = path.resolve(outputDir, relative); if (isPathInside(outputDir, absolute) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) fs.unlinkSync(absolute); }
  const stageParent = path.dirname(stageDir); if (!isPathInside(stageParent, stageDir) || !path.basename(stageDir).startsWith('.pce-vn-gb-stage-')) throw new Error('stage cleanup安全検査に失敗しました'); fs.rmSync(stageDir, { recursive: true, force: true }); return { backupPath };
}

function generateGbStudioProject({ inspection, outputDir, mode = 'generate' } = {}) {
  if (!inspection || inspection.format !== EXPORTER_FORMAT) throw new Error('有効なpreflight結果が必要です');
  if (inspection.errors?.length) { const error = new Error(`preflight errorが${inspection.errors.length}件あります`); error.code = inspection.errors[0].code; error.diagnostics = inspection.errors; throw error; }
  if (inspection.warnings?.length && !inspection.settings?.warningsAcknowledged) { const error = new Error(`warning ${inspection.warnings.length}件の明示確認が必要です`); error.code = 'GBVN_OFFICIAL_BUILD_WARNING'; error.diagnostics = inspection.warnings; throw error; }
  if (!inspection._model || !inspection._backgrounds || !inspection._music) throw new Error('このpreflight結果には生成modelがありません。同じprocessで再preflightしてください');
  const before = sourceSnapshot(inspection.projectDir, inspection._model.sceneDoc, inspection._model.assetDoc, inspection._model.settings); if (before.signature !== inspection.sourceSignature) { const error = new Error('preflight後に入力が変更されました。再preflightしてください'); error.code = 'GBVN_INPUT_SIGNATURE_CHANGED'; throw error; }
  const built = buildGbStudioFiles(inspection._model, inspection._backgrounds, inspection._music); const staticValidation = staticValidateFiles(built.files); if (!staticValidation.ok) { const error = new Error(`生成resourceの静的検査に失敗しました:\n${staticValidation.errors.join('\n')}`); error.code = 'GBVN_OFFICIAL_BUILD_WARNING'; error.validation = staticValidation; throw error; }
  const target = ensureOutputTarget(outputDir, inspection.projectDir); const oldManifest = fs.existsSync(target) ? readOwnership(target) : null; if (oldManifest && (oldManifest.exporter?.id !== 'pce-vn-gb-studio-exporter' || oldManifest.sourceProject?.identity !== sourceProjectIdentity(inspection.projectDir))) { const error = new Error('出力先manifestのexporterまたはsource project identityが一致しません'); error.code = 'GBVN_OUTPUT_NOT_OWNED'; throw error; } const stage = path.join(path.dirname(target), `.pce-vn-gb-stage-${process.pid}-${crypto.randomBytes(6).toString('hex')}`); if (fs.existsSync(stage)) throw new Error('stage pathが既に存在します'); fs.mkdirSync(stage, { recursive: false });
  let committed = false;
  try {
    const manifest = manifestFor(built.files, inspection, built.stats); built.files.set(MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')); writeFileMap(stage, built.files);
    const after = sourceSnapshot(inspection.projectDir, inspection._model.sceneDoc, inspection._model.assetDoc, inspection._model.settings); if (after.signature !== before.signature) { const error = new Error('生成中に入力fileが変更されました'); error.code = 'GBVN_INPUT_SIGNATURE_CHANGED'; throw error; }
    const commit = commitFileMap(target, stage, built.files, oldManifest); committed = true; const portable = portableSidecar(inspection.projectDir, inspection.settings); for (const copy of portable.copies) { const destination = path.resolve(inspection.projectDir, copy.relative); if (!isPathInside(inspection.projectDir, destination)) throw new Error('portable asset取込path traversalを拒否しました'); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(copy.source, destination); }
    writeJsonAtomic(path.join(inspection.projectDir, SIDECAR_FILE), portable.sidecar); let officialBuild = null; if (mode === 'verify') { officialBuild = runOfficialBuildSync(inspection, target, path.join(target, built.descriptor)); refreshManifestBuildOwnership(target); } const validation = validateGbStudioProject({ outputDir: target, inspection, requireBuild: mode === 'verify' });
    return { ok: validation.ok, outputDir: target, descriptorPath: path.join(target, built.descriptor), manifestPath: path.join(target, MANIFEST_FILE), sidecarPath: path.join(inspection.projectDir, SIDECAR_FILE), backupPath: commit.backupPath, stats: built.stats, officialBuild, validation, runtime: { ran: false, code: 'GBVN_RUNTIME_NOT_RUN', message: 'GB Studio内蔵emulatorの実入力smokeは未実行です' } };
  } finally { if (!committed && fs.existsSync(stage) && isPathInside(path.dirname(stage), stage) && path.basename(stage).startsWith('.pce-vn-gb-stage-')) fs.rmSync(stage, { recursive: true, force: true }); }
}

function validateGbStudioProject({ outputDir, inspection, requireBuild = false } = {}) {
  const root = path.resolve(String(outputDir || '')); const errors = []; const warnings = []; if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { ok: false, errors: [diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', '出力folderがありません', root)], warnings };
  const manifest = readOwnership(root); if (!manifest) errors.push(diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', 'exporter manifestがありません', MANIFEST_FILE));
  const files = new Map(); for (const absolute of walkFiles(root)) { const relative = normalizeRelativePath(path.relative(root, absolute)); if (relative.endsWith('.gbsres') || relative.endsWith('.gbsproj') || relative.startsWith('plugins/')) files.set(relative, fs.readFileSync(absolute)); }
  const staticValidation = staticValidateFiles(files); staticValidation.errors.forEach((message) => errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', message, root)));
  if (manifest) for (const entry of manifest.ownedPaths) { const relative = safeRelative(typeof entry === 'string' ? entry : entry.path); if (relative === MANIFEST_FILE) continue; const absolute = path.resolve(root, relative); if (!fs.existsSync(absolute)) errors.push(diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', `owned fileがありません: ${relative}`, relative)); else if (entry.sha256 && sha256(fs.readFileSync(absolute)) !== entry.sha256) errors.push(diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', `owned fileのhashが一致しません: ${relative}`, relative)); }
  const roms = walkFiles(path.join(root, 'build', 'rom')).filter((file) => /\.(gb|gbc)$/i.test(file)); const webIndex = path.join(root, 'build', 'web', 'index.html'); const webRoms = walkFiles(path.join(root, 'build', 'web', 'rom')).filter((file) => /\.(gb|gbc)$/i.test(file)); if (requireBuild && !roms.length) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio ROM build成果物がありません', 'build/rom')); if (requireBuild && !fs.existsSync(webIndex)) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio Web build成果物がありません', 'build/web/index.html')); if (requireBuild && !webRoms.length) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio Web内ROMがありません', 'build/web/rom')); if (requireBuild && roms.length && webRoms.length && sha256(fs.readFileSync(roms[0])) !== sha256(fs.readFileSync(webRoms[0]))) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式ROMとWeb内ROMのhashが一致しません', 'build/web/rom')); if (!requireBuild && !roms.length) warnings.push(diagnostic('warning', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio buildは未実行です', 'build/rom'));
  if (!inspection?.runtime?.ran) warnings.push(diagnostic('warning', 'GBVN_RUNTIME_NOT_RUN', 'GB Studio内蔵emulatorの実入力runtime smokeは未実行です', 'runtime'));
  return { ok: errors.length === 0, errors, warnings, static: staticValidation, roms: roms.map((file) => ({ path: file, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) })) };
}

module.exports = { EXPORTER_FORMAT, EXPORTER_VERSION, MANIFEST_FILE, SIDECAR_FILE, SUPPORTED_GB_STUDIO_VERSIONS, TARGET_ENGINE_VERSION, TARGET_GB_STUDIO_VERSION, generateGbStudioProject, inspectGbStudioExport, inspectGbStudioInstallation, isSupportedGbStudioInstallation, normalizeGbStudioExecutablePath, normalizeSidecar, readAsarEntry, readSidecar, sourceSnapshot, validateGbStudioProject };
