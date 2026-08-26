'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeAssetDocument, resolveAssetSource } = require('./pce-asset-manager');
const { isCommandSkipped, normalizeSceneDocument } = require('./pce-vn-manager');
const { isPathInside, normalizeRelativePath } = require('./pce-file-safety');
const { DEFAULT_FONT } = require('./pce-vn-gb-studio-font');
const { DIALOGUE_FRAME_EVENT, buildConversionModel, buildGbStudioFiles, buildMusic, speakerToneFrequency, targetlessAsyncContinuation, transformBackgrounds, transformBackgroundVariant, validateExternalMod, wrapChoiceLabel } = require('./pce-vn-gb-studio-project');
const { buildPsgSourcePreview, convertPsgToMod, normalizeMusicTrackSettings } = require('./pce-vn-gb-studio-music');
const { encodeRgbaPng } = require('./pce-vn-gb-studio-image');

const EXPORTER_FORMAT = 'pce-vn-gb-studio-export';
const EXPORTER_VERSION = 1;
const EXPORTER_RELEASE_VERSION = '1.3.0';
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
  const executablePath = normalizeGbStudioExecutablePath(input); if (!String(input || '').trim() || !fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) return { executablePath, version: '', engineVersion: '', verified: false, errorCode: 'GBVN_GB_STUDIO_EXECUTABLE_NOT_FOUND', error: 'GB Studio実行ファイルが見つかりません' };
  try { const asarPath = path.join(path.dirname(executablePath), 'resources', 'app.asar'); const pkg = JSON.parse(readAsarEntry(asarPath, 'package.json').toString('utf-8')); const engine = JSON.parse(readAsarEntry(asarPath, 'appData/engine/engine.json').toString('utf-8')); return { executablePath, version: String(pkg.version || ''), engineVersion: String(engine.version || ''), verified: true }; } catch (error) { return { executablePath, version: '', engineVersion: '', verified: false, error: String(error?.message || error) }; }
}

function normalizeBackgroundSetting(value = {}) {
  const raw = value && typeof value === 'object' ? value : {}; const clamp = (input, min, max, fallback) => { const parsed = Number(input); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; };
  return { brightness: clamp(raw.brightness, -100, 100, 0), saturation: clamp(raw.saturation, 0, 200, 100), gbcDither: Boolean(raw.gbcDither), dmgDither: Boolean(raw.dmgDither), focusX: clamp(raw.focusX, 0, 1, 0.5), focusY: clamp(raw.focusY, 0, 1, 0.5) };
}

function normalizeSettingMap(value, normalizeEntry) { const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; return Object.fromEntries(Object.entries(raw).filter(([key]) => key && key.length <= 256 && !/[\\/\0]/.test(key)).map(([key, entry]) => [key, normalizeEntry(entry)])); }

function normalizeSidecar(value = {}) {
  const raw = value && typeof value === 'object' ? value : {}; return { format: EXPORTER_FORMAT, version: EXPORTER_VERSION, font: String(raw.font || DEFAULT_FONT), visualOmissionsConfirmed: Boolean(raw.visualOmissionsConfirmed), warningsAcknowledged: Boolean(raw.warningsAcknowledged), cddaMappings: raw.cddaMappings && typeof raw.cddaMappings === 'object' ? raw.cddaMappings : {}, audioSubstitutions: raw.audioSubstitutions && typeof raw.audioSubstitutions === 'object' ? raw.audioSubstitutions : {}, backgrounds: normalizeSettingMap(raw.backgrounds, normalizeBackgroundSetting), music: normalizeSettingMap(raw.music, normalizeMusicTrackSettings) };
}

function readSidecar(projectDir) { const filePath = path.join(projectDir, SIDECAR_FILE); return fs.existsSync(filePath) ? normalizeSidecar(readJson(filePath, SIDECAR_FILE)) : normalizeSidecar(); }
function mergedSettings(projectDir, explicit = {}) {
  const sidecar = readSidecar(projectDir); const backgroundIds = new Set([...Object.keys(sidecar.backgrounds || {}), ...Object.keys(explicit.backgrounds || {})]); const musicIds = new Set([...Object.keys(sidecar.music || {}), ...Object.keys(explicit.music || {})]);
  const backgrounds = Object.fromEntries([...backgroundIds].map((id) => [id, { ...(sidecar.backgrounds?.[id] || {}), ...(explicit.backgrounds?.[id] || {}) }]));
  const music = Object.fromEntries([...musicIds].map((id) => { const saved = sidecar.music?.[id] || {}; const override = explicit.music?.[id] || {}; const channels = Array.from({ length: 6 }, (_, index) => ({ ...(saved.channels?.[index] || {}), ...(override.channels?.[index] || {}) })); return [id, { ...saved, ...override, channels }]; }));
  return normalizeSidecar({ ...sidecar, ...explicit, cddaMappings: { ...sidecar.cddaMappings, ...(explicit.cddaMappings || {}) }, audioSubstitutions: { ...sidecar.audioSubstitutions, ...(explicit.audioSubstitutions || {}) }, backgrounds, music });
}

function referencedFiles(projectDir, sceneDoc, assetDoc, settings) {
  const ids = new Set(); for (const scene of sceneDoc.scenes || []) for (const command of scene.commands || []) for (const key of ['assetId', 'voiceAssetId', 'animationAssetId']) if (command[key]) ids.add(command[key]); Object.values(settings.cddaMappings || {}).forEach((mapping) => ids.add(typeof mapping === 'string' ? mapping : mapping?.targetAssetId));
  const assets = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset])); const files = [path.join(projectDir, 'project.json'), path.join(projectDir, 'assets', 'pce-assets.json'), path.join(projectDir, 'assets', 'pce-vn-scenes.json')];
  ids.forEach((id) => { const asset = assets.get(id); if (!asset) return; try { const source = resolveAssetSource(projectDir, asset).absPath; if (source) files.push(source); } catch (_) {} });
  if (settings.font && settings.font !== DEFAULT_FONT && path.isAbsolute(settings.font) && fs.existsSync(settings.font)) files.push(settings.font);
  Object.values(settings.cddaMappings || {}).forEach((mapping) => { if (mapping?.type !== 'external-mod' || !mapping.source) return; const source = path.isAbsolute(mapping.source) ? path.resolve(mapping.source) : path.resolve(projectDir, mapping.source); if (fs.existsSync(source)) files.push(source); });
  return [...new Set(files.map((file) => path.resolve(file)).filter((file) => fs.existsSync(file) && fs.statSync(file).isFile()))].sort();
}

function sourceSnapshot(projectDir, sceneDoc, assetDoc, settings) { const files = referencedFiles(projectDir, sceneDoc, assetDoc, settings).map((file) => ({ path: isPathInside(projectDir, file) ? normalizeRelativePath(path.relative(projectDir, file)) : `external:${path.basename(file)}`, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) })); return { files, signature: sha256(stableJson({ sceneDoc, assetDoc, settings, files })) }; }

function sourceSnapshotRaw(projectDir, sceneDoc, assetDoc, settings, rawDoc) { const snapshot = sourceSnapshot(projectDir, sceneDoc, assetDoc, settings); return { ...snapshot, signature: sha256(stableJson({ sceneDoc: rawDoc, assetDoc, settings, files: snapshot.files })) }; }

const MAX_PREVIEW_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_DATA_URL_BYTES = 8 * 1024 * 1024;
function previewError(code, message) { const error = new Error(message); error.code = code; return error; }
function validatePreviewAssetId(assetId) { const id = String(assetId || ''); if (!id || id.length > 256 || id.includes('\0') || /[\\/]/.test(id) || id === '..') throw previewError('GBVN_PREVIEW_ASSET_INVALID', 'preview asset IDが不正です'); return id; }
function previewProject(projectDir, assets) {
  const root = path.resolve(String(projectDir || '')); if (!fs.existsSync(path.join(root, 'project.json'))) throw previewError('GBVN_PREVIEW_PROJECT_INVALID', '有効なPC Engine projectがありません');
  const project = readJson(path.join(root, 'project.json'), 'project.json'); if (String(project.coreId || '') !== 'pc-engine') throw previewError('GBVN_PREVIEW_PROJECT_INVALID', 'PC Engine projectだけをpreviewできます');
  const rawAssets = assets && typeof assets === 'object' ? assets : readJson(path.join(root, 'assets', 'pce-assets.json'), 'assets/pce-assets.json'); let assetDoc; try { assetDoc = normalizeAssetDocument(rawAssets); } catch (error) { const outside = /project relative asset path/i.test(String(error?.message || error)); throw previewError(outside ? 'GBVN_PREVIEW_PATH_OUTSIDE_PROJECT' : 'GBVN_PREVIEW_ASSET_INVALID', String(error?.message || error)); } return { root, project, assetDoc, assetsById: new Map(assetDoc.assets.map((asset) => [asset.id, asset])) };
}
function previewDataUrl(image, label) { if (image.width > 4096 || image.height > 4096 || image.width * image.height > 16777216) throw previewError('GBVN_PREVIEW_DATA_TOO_LARGE', `${label}の画像寸法がpreview上限を超えています`); const buffer = encodeRgbaPng(image); if (buffer.length > MAX_PREVIEW_DATA_URL_BYTES) throw previewError('GBVN_PREVIEW_DATA_TOO_LARGE', `${label}のdata URLがpreview上限を超えています`); return `data:image/png;base64,${buffer.toString('base64')}`; }

function previewVnGbStudioMusic({ projectDir, assets, assetId, settings = {}, generation = 0 } = {}) {
  const context = previewProject(projectDir, assets); const id = validatePreviewAssetId(assetId); const asset = context.assetsById.get(id); if (!asset || asset.type !== 'psg-song') throw previewError('GBVN_PREVIEW_ASSET_INVALID', `PSG song assetを解決できません: ${id}`);
  if ((asset.options?.pattern || []).length > 65536) throw previewError('GBVN_PREVIEW_DATA_TOO_LARGE', `${id}: PSG event数がpreview上限を超えています`);
  const trackSettings = settings.music?.[id] || settings; const converted = convertPsgToMod(asset, trackSettings); const sourcePreview = buildPsgSourcePreview(asset);
  return { ok: true, generation: Number(generation) || 0, asset: { id, name: asset.name || id }, settings: converted.audit.settings, audit: converted.audit, sourcePreview, gbPreview: converted.preview, outputHash: converted.audit.outputHash };
}

function previewVnGbStudioBackground({ projectDir, assets, assetId, fullScreen = false, settings = {}, generation = 0 } = {}) {
  const context = previewProject(projectDir, assets); const id = validatePreviewAssetId(assetId); const asset = context.assetsById.get(id); if (!asset || asset.type !== 'image') throw previewError('GBVN_PREVIEW_ASSET_INVALID', `背景image assetを解決できません: ${id}`);
  const resolved = resolveAssetSource(context.root, asset).absPath; if (!isPathInside(context.root, resolved)) throw previewError('GBVN_PREVIEW_PATH_OUTSIDE_PROJECT', `project外の背景素材はpreviewできません: ${id}`); if (!fs.existsSync(resolved) || fs.statSync(resolved).size > MAX_PREVIEW_SOURCE_BYTES) throw previewError('GBVN_PREVIEW_DATA_TOO_LARGE', `${id}: source PNGがpreview上限を超えるか存在しません`);
  const header = fs.readFileSync(resolved).subarray(0, 24); if (header.length < 24 || header.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw previewError('GBVN_PREVIEW_ASSET_INVALID', `${id}: preview入力はPNGのみです`); const sourceWidth = header.readUInt32BE(16); const sourceHeight = header.readUInt32BE(20); if (!sourceWidth || !sourceHeight || sourceWidth > 4096 || sourceHeight > 4096 || sourceWidth * sourceHeight > 16777216) throw previewError('GBVN_PREVIEW_DATA_TOO_LARGE', `${id}: source PNGの展開寸法がpreview上限を超えています`);
  const backgroundSetting = settings.backgrounds?.[id] || settings; const normalized = normalizeBackgroundSetting(backgroundSetting); const model = { projectDir: context.root, assetsById: context.assetsById, settings: { backgrounds: { [id]: normalized } } }; const variant = { key: `${id}:${fullScreen ? 'fullscreen' : 'dialogue'}`, assetId: id, fullScreen: Boolean(fullScreen) }; const transformed = transformBackgroundVariant(model, variant);
  return { ok: true, generation: Number(generation) || 0, asset: { id, name: asset.name || id }, fullScreen: Boolean(fullScreen), settings: transformed.settings, hashes: transformed.hashes, audit: transformed.audit, images: { source: previewDataUrl(transformed.sourceImage, `${id}/source`), prepared: previewDataUrl(transformed.prepared, `${id}/prepared`), gbc: previewDataUrl(transformed.gbc.image, `${id}/gbc`), dmg: previewDataUrl(transformed.dmg.image, `${id}/dmg`) } };
}

const SOURCE_COMMAND_TYPES = new Set(['background', 'message', 'choice', 'jump', 'wait', 'audio', 'variable', 'var', 'if', 'switch', 'label', 'goto', 'inputcheck', 'spritetext', 'sprite', 'spritemove', 'effect', 'cache', 'comment']);

function sourceProcessingCategory(command, assetDoc) {
  const type = String(command?.type || '');
  if (type === 'message' || type === 'spritetext') return 'text';
  if (['choice', 'jump', 'goto', 'if', 'switch', 'inputcheck'].includes(type)) return 'branch';
  if (type === 'variable' || type === 'var') return 'state';
  if (type === 'audio') {
    const asset = (assetDoc?.assets || []).find((entry) => entry.id === command.assetId);
    if (command.action === 'stop' || command.kind === 'cdda' || asset?.type === 'psg-song' || asset?.type === 'cdda-track') return 'bgm';
    return 'audio';
  }
  if (type === 'background' || type === 'sprite' || type === 'spritemove' || type === 'effect') return 'visual';
  if (type === 'wait') return 'timing';
  if (type === 'label' || type === 'cache' || type === 'comment') return 'metadata';
  return 'unclassified';
}

function sourceCommandInventory(rawDoc, sceneDoc, assetDoc) {
  const diagnostics = []; const commands = []; const byKey = new Map();
  const rawScenes = Array.isArray(rawDoc?.scenes) ? rawDoc.scenes : [];
  const addError = (code, message, location, data = {}) => diagnostics.push(diagnostic('error', code, message, location, data));
  for (let sceneIndex = 0; sceneIndex < rawScenes.length; sceneIndex += 1) {
    const rawScene = rawScenes[sceneIndex] && typeof rawScenes[sceneIndex] === 'object' ? rawScenes[sceneIndex] : {};
    const scene = sceneDoc.scenes?.[sceneIndex]; if (!scene) continue;
    const normalized = scene.commands || []; let normalizedIndex = 0;
    for (let commandIndex = 0; commandIndex < (Array.isArray(rawScene.commands) ? rawScene.commands.length : 0); commandIndex += 1) {
      const rawCommand = rawScene.commands[commandIndex] && typeof rawScene.commands[commandIndex] === 'object' ? rawScene.commands[commandIndex] : {};
      const rawType = String(rawCommand.type || '').trim(); const location = `${scene.id}.commands[${commandIndex}]`; const key = `${scene.id}:${commandIndex}`;
      const entry = { key, sceneId: scene.id, commandIndex, sourceType: rawType || '(empty)', normalizedType: '', processingCategory: sourceProcessingCategory(rawCommand, assetDoc), disposition: 'pending', reachable: false, generated: { gbc: { sceneIds: [], eventIds: [] }, dmg: { sceneIds: [], eventIds: [] } } };
      commands.push(entry); byKey.set(key, entry);
      if (rawType === 'choice' && !isCommandSkipped(rawCommand)) {
        const count = Array.isArray(rawCommand.choices) ? rawCommand.choices.length : 0; entry.choiceCount = count;
        if (count < 2 || count > 4) addError('GBVN_CHOICE_OPTION_COUNT', `choiceは2～4択必須です: ${count}択`, location, { count });
      }
      if (isCommandSkipped(rawCommand)) {
        entry.disposition = 'skipped-source';
        if (SOURCE_COMMAND_TYPES.has(rawType)) {
          const probe = normalizeSceneDocument({ version: 2, startScene: 'probe', scenes: [{ id: 'probe', fullScreenBg: rawScene.fullScreenBg, commands: [rawCommand] }] }, assetDoc).scenes?.[0]?.commands?.[0] || null;
          if (probe) { const normalizedCommand = normalized[normalizedIndex++]; entry.normalizedType = normalizedCommand?.type || probe.type; entry.processingCategory = sourceProcessingCategory(normalizedCommand || probe, assetDoc); if (normalizedCommand) Object.defineProperty(normalizedCommand, '_gbvnSource', { value: { key, sceneId: scene.id, commandIndex }, enumerable: false, configurable: true }); }
        }
        continue;
      }
      if (!SOURCE_COMMAND_TYPES.has(rawType)) { entry.disposition = 'error'; addError('GBVN_UNKNOWN_COMMAND', `未知commandです: ${rawType || '(空)'}`, location, { type: rawType }); continue; }
      const probe = normalizeSceneDocument({ version: 2, startScene: 'probe', scenes: [{ id: 'probe', fullScreenBg: rawScene.fullScreenBg, commands: [rawCommand] }] }, assetDoc).scenes?.[0]?.commands?.[0] || null;
      if (!probe) { entry.disposition = 'error'; addError('GBVN_UNCONSUMED_COMMAND', `${rawType} commandが正規化時に消失しました`, location, { type: rawType }); continue; }
      const normalizedCommand = normalized[normalizedIndex++];
      if (!normalizedCommand || normalizedCommand.type !== probe.type) { entry.disposition = 'error'; addError('GBVN_UNCONSUMED_COMMAND', `${rawType} commandを正規化後のcommandへ一意に対応付けできません`, location, { expected: probe.type, actual: normalizedCommand?.type || '' }); continue; }
      entry.normalizedType = normalizedCommand.type;
      entry.processingCategory = sourceProcessingCategory(normalizedCommand, assetDoc);
      if (normalizedCommand.type === 'choice') {
        const rawChoices = Array.isArray(rawCommand.choices) ? rawCommand.choices : [];
        normalizedCommand.choices.forEach((choice, index) => {
          const rawChoice = rawChoices[index] && typeof rawChoices[index] === 'object' ? rawChoices[index] : {};
          choice.label = String(rawChoice.label ?? rawChoice.text ?? `選択肢${index + 1}`).trim() || `選択肢${index + 1}`;
        });
      }
      Object.defineProperty(normalizedCommand, '_gbvnSource', { value: { key, sceneId: scene.id, commandIndex }, enumerable: false, configurable: true });
    }
    if (normalizedIndex !== normalized.length) addError('GBVN_UNCONSUMED_COMMAND', `正規化後command ${normalized.length - normalizedIndex}件にsource位置がありません`, `${scene.id}.commands`, { normalizedIndex, normalizedCount: normalized.length });
  }
  return { commands, byKey, diagnostics };
}

function validateCommands(sceneDoc, assetDoc, settings, projectDir) {
  const diagnostics = []; const omissions = []; const assets = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset])); const sceneIds = new Set((sceneDoc.scenes || []).map((scene) => scene.id));
  const add = (severity, code, message, location, data) => diagnostics.push(diagnostic(severity, code, message, location, data));
  for (const scene of sceneDoc.scenes || []) {
    const labels = new Set((scene.commands || []).filter((command) => command.type === 'label' && !isCommandSkipped(command)).map((command) => command.name));
    for (let index = 0; index < (scene.commands || []).length; index += 1) {
      const command = scene.commands[index]; if (!command || isCommandSkipped(command) || command.type === 'comment') continue; const sourceIndex = command._gbvnSource?.commandIndex ?? index; const location = `${scene.id}.commands[${sourceIndex}]`;
      if (!['background', 'message', 'choice', 'jump', 'wait', 'audio', 'variable', 'if', 'switch', 'label', 'goto', 'inputcheck', 'spritetext', 'sprite', 'spritemove', 'effect', 'cache'].includes(command.type)) { add('error', 'GBVN_UNKNOWN_COMMAND', `未対応commandです: ${command.type}`, location); continue; }
      if (command.type === 'background' && (!command.assetId || assets.get(command.assetId)?.type !== 'image')) add('error', 'GBVN_UNRESOLVED_ASSET', `背景assetを解決できません: ${command.assetId || '(空)'}`, location);
      if (command.type === 'jump' && (!command.sceneId || !sceneIds.has(command.sceneId))) add('error', 'GBVN_UNRESOLVED_SCENE', `jump先sceneを解決できません: ${command.sceneId || '(空)'}`, location);
      if (command.type === 'choice') {
        if ((command.choices || []).length < 2 || (command.choices || []).length > 4) add('error', 'GBVN_CHOICE_OPTION_COUNT', `choiceは2～4択必須です: ${(command.choices || []).length}択`, location);
        const totalLines = (command.choices || []).reduce((sum, choice) => sum + wrapChoiceLabel(choice.label).split('\n').length, 0);
        if (totalLines > 16) add('error', 'GBVN_CHOICE_MENU_OVERFLOW', `choiceの折返し後行数が画面上限16行を超えています: ${totalLines}行`, location, { totalLines, limit: 16 });
        for (const choice of command.choices || []) if (!choice.targetSceneId || !sceneIds.has(choice.targetSceneId)) add('error', 'GBVN_UNRESOLVED_SCENE', `choice先sceneを解決できません: ${choice.targetSceneId || '(空)'}`, location);
      }
      if (command.type === 'goto' && (!command.targetLabel || !labels.has(command.targetLabel))) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `goto先labelを解決できません: ${command.targetLabel || '(空)'}`, location);
      if (command.type === 'if') { if (!command.targetLabel || !labels.has(command.targetLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `if true labelを解決できません: ${command.targetLabel || '(空)'}`, location); if (command.elseLabel && !labels.has(command.elseLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `if false labelを解決できません: ${command.elseLabel}`, location); }
      if (command.type === 'switch') { for (const branch of command.cases || []) if (!branch.targetLabel || !labels.has(branch.targetLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `switch labelを解決できません: ${branch.targetLabel || '(空)'}`, location); if (command.defaultLabel && !labels.has(command.defaultLabel)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', `switch default labelを解決できません: ${command.defaultLabel}`, location); }
      if (command.type === 'inputcheck' && command.mode === 'async' && !command.targetLabel && !targetlessAsyncContinuation(scene.commands, index)) add('error', 'GBVN_UNSUPPORTED_CONTROL_COMMAND', 'targetLabelなしasync inputcheckは直後のwait、または後続のsync inputcheckの通常継続と組である必要があります', location);
      if (command.type === 'sprite' || command.type === 'spritemove') { omissions.push({ sceneId: scene.id, commandIndex: sourceIndex, type: command.type, reason: 'Phase 3立ち絵省略' }); if (!settings.visualOmissionsConfirmed) add('error', 'GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION', `${command.type}を省略するには明示確認が必要です`, location); }
      if (command.type === 'effect' && command.effect !== 'shake') { omissions.push({ sceneId: scene.id, commandIndex: sourceIndex, type: `effect:${command.effect}`, reason: 'Phase 3視覚効果省略' }); if (!settings.visualOmissionsConfirmed) add('error', 'GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION', `effect ${command.effect}を省略するには明示確認が必要です`, location); }
      if (command.type === 'cache') omissions.push({ sceneId: scene.id, commandIndex: sourceIndex, type: 'cache', reason: 'GB Studioでは事前cache不要' });
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
    const rawDoc = doc && typeof doc === 'object' ? doc : readJson(path.join(root, 'assets', 'pce-vn-scenes.json'), 'assets/pce-vn-scenes.json'); const sceneDoc = normalizeSceneDocument(rawDoc, assetDoc); const inventory = sourceCommandInventory(rawDoc, sceneDoc, assetDoc); diagnostics.push(...inventory.diagnostics); const settings = mergedSettings(root, explicitSettings); const installation = inspectGbStudioInstallation(gbStudio || explicitSettings.gbStudioExecutable);
    if (!isSupportedGbStudioInstallation(installation)) { const detail = installation.error ? `; ${installation.error}` : ''; const code = installation.errorCode || 'GBVN_GB_STUDIO_VERSION_MISMATCH'; const message = code === 'GBVN_GB_STUDIO_EXECUTABLE_NOT_FOUND' ? `GB Studio実行ファイルが見つかりません: ${installation.executablePath || '未指定'}` : `GB Studio ${SUPPORTED_GB_STUDIO_VERSIONS.join(' または ')} / engine ${TARGET_ENGINE_VERSION} が必要です（検出: ${installation.version || '不明'} / ${installation.engineVersion || '不明'}${detail}）`; diagnostics.push(diagnostic('error', code, message, 'gbStudio', installation)); }
    const commandValidation = validateCommands(sceneDoc, assetDoc, settings, root); diagnostics.push(...commandValidation.diagnostics);
    let model = null; let backgrounds = null; let music = null;
    try { model = buildConversionModel({ projectDir: root, project, rawDoc, sceneDoc, assetDoc, settings, gbStudio: installation, sourceInventory: inventory }); } catch (error) { diagnostics.push(diagnostic('error', error.code || 'GBVN_FONT_GLYPH_MISSING', String(error?.message || error), 'font', { glyphs: error.glyphs || [] })); }
    if (model) {
      for (const key of model.graph.unreachable) diagnostics.push(diagnostic('warning', 'GBVN_UNREACHABLE_BLOCK', `到達不能blockです: ${key}`, `graph:${key}`, { key }));
      try { backgrounds = transformBackgrounds(model); backgrounds.audits.forEach((audit) => { if (audit.gbc.palettes > 7 || audit.gbc.maxColorsPerTile > 4) diagnostics.push(diagnostic('error', 'GBVN_GBC_PALETTE_OVERFLOW', `${audit.key}: GBC palette制約を超えています`, `background:${audit.key}`, audit.gbc)); if (audit.dmg.uniqueTiles > 192) diagnostics.push(diagnostic('error', 'GBVN_DMG_TILE_OVERFLOW', `${audit.key}: DMG固有tileが192を超えています`, `background:${audit.key}`, audit.dmg)); if (audit.dmg.meaningfulShades < 4) diagnostics.push(diagnostic('warning', 'GBVN_DMG_SHADE_UNDERUSE', `${audit.key}: 原画の階調が少ないためDMG 4階調の一部を有意量使用していません`, `background:${audit.key}`, audit.dmg)); }); } catch (error) { diagnostics.push(diagnostic('error', error.code || 'GBVN_UNRESOLVED_ASSET', String(error?.message || error), 'backgrounds')); }
      try { music = buildMusic(model); music.audits.forEach((audit) => { if (audit.status === 'warning' || audit.droppedEvents.length || audit.channelConflicts?.length || audit.controlConflicts.length) diagnostics.push(diagnostic('warning', 'GBVN_PSG_EVENT_DROPPED', `${audit.assetId}: channel競合等を監査reportへ記録します（drop ${audit.droppedEvents.length} / conflict ${(audit.channelConflicts?.length || 0) + audit.controlConflicts.length}）`, `music:${audit.assetId}`, audit)); }); } catch (error) { diagnostics.push(diagnostic('error', error.code || 'GBVN_PSG_EVENT_DROPPED', String(error?.message || error), 'music')); }
    }
    commandValidation.omissions.forEach((omission) => diagnostics.push(diagnostic('warning', 'GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION', `${omission.type}を変換対象から省略します: ${omission.reason}`, `${omission.sceneId}.commands[${omission.commandIndex}]`, omission)));
    const referencedCdda = new Set(); const referencedSubstitutions = new Set(); const automaticVoiceSubstitutions = []; const assetTypes = new Map(assetDoc.assets.map((asset) => [asset.id, asset.type])); for (const scene of sceneDoc.scenes) for (const [commandIndex, command] of scene.commands.entries()) { if (command.type === 'audio' && command.action === 'play' && command.kind === 'cdda' && command.assetId) referencedCdda.add(command.assetId); if (command.type === 'audio' && command.action === 'play' && ['adpcm', 'psg'].includes(command.kind) && ['adpcm', 'psg-sfx'].includes(assetTypes.get(command.assetId))) referencedSubstitutions.add(command.assetId); if (command.type === 'message' && command.voiceAssetId) automaticVoiceSubstitutions.push({ sceneId: scene.id, commandIndex, voiceAssetId: command.voiceAssetId, speaker: String(command.speaker || ''), frequency: speakerToneFrequency(command.speaker), substitution: 'text-tone' }); }
    const psgSongs = assetDoc.assets.filter((asset) => asset.type === 'psg-song').map((asset) => { const audit = music?.audits.find((entry) => entry.assetId === asset.id); return { id: asset.id, name: asset.name || asset.id, settings: settings.music?.[asset.id] || normalizeMusicTrackSettings(), auditStatus: audit?.status || 'unused' }; });
    const backgroundCatalog = model ? [...new Set(model.backgroundVariants.filter((variant) => variant.assetId).map((variant) => variant.assetId))].map((id) => { const asset = assetDoc.assets.find((entry) => entry.id === id); return { id, name: asset?.name || id, variants: model.backgroundVariants.filter((variant) => variant.assetId === id).map((variant) => ({ key: variant.key, fullScreen: variant.fullScreen })), settings: settings.backgrounds?.[id] || normalizeBackgroundSetting() }; }) : [];
    const snapshot = sourceSnapshotRaw(root, sceneDoc, assetDoc, settings, rawDoc); const errors = diagnostics.filter((entry) => entry.severity === 'error'); const warnings = diagnostics.filter((entry) => entry.severity === 'warning');
    const choiceCounts = { 2: 0, 3: 0, 4: 0 }; inventory.commands.forEach((entry) => { if (choiceCounts[entry.choiceCount] !== undefined) choiceCounts[entry.choiceCount] += 1; }); const commandConsumption = { total: inventory.commands.length, normalized: inventory.commands.filter((entry) => entry.normalizedType).length, skipped: inventory.commands.filter((entry) => entry.disposition === 'skipped-source').length, errors: inventory.commands.filter((entry) => entry.disposition === 'error').length };
    const customEventReferences = []; if (choiceCounts[2] + choiceCounts[3] + choiceCounts[4]) customEventReferences.push('PCE_VN_EVENT_MENU'); if (sceneDoc.scenes.some((scene) => scene.commands.some((command) => command.type === 'variable' && command.operation === 'random' && !isCommandSkipped(command)))) customEventReferences.push('PCE_VN_EVENT_RANDOM'); const generatedPlugins = customEventReferences.length ? [{ id: 'pce-vn-control', version: '1.0.0', gbsVersion: installation.version, events: customEventReferences }] : [];
    const result = { ok: errors.length === 0, format: EXPORTER_FORMAT, version: EXPORTER_VERSION, exporterReleaseVersion: EXPORTER_RELEASE_VERSION, projectDir: root, project: { title: project.title || project.name || '', romName: project.romName || '' }, settings, gbStudio: installation, sourceSignature: snapshot.signature, sourceFiles: snapshot.files, errors, warnings, omissions: commandValidation.omissions, requirements: { cdda: [...referencedCdda].map((id) => ({ id, name: assetDoc.assets.find((asset) => asset.id === id)?.name || id, mapping: settings.cddaMappings[id] || '' })), audioSubstitutions: [...referencedSubstitutions].map((id) => ({ id, name: assetDoc.assets.find((asset) => asset.id === id)?.name || id, type: assetDoc.assets.find((asset) => asset.id === id)?.type || '', mapping: settings.audioSubstitutions[id] || '' })), automaticVoiceSubstitutions, psgSongs, backgrounds: backgroundCatalog, generatedPlugins, customEventReferences }, summary: { sourceScenes: sceneDoc.scenes.length, sourceCommands: inventory.commands.length, outputScenes: model ? model.graph.segments.length * 2 + 1 : 0, backgroundVariants: model ? model.backgroundVariants.length : 0, fontGlyphs: model ? model.font.glyphCount : 0, fontPages: model ? model.font.pages.length : 0, musicTracks: model ? model.music.length + (model.externalMusic?.length || 0) : 0, variables: model ? model.variables.names.length : 0, automaticVoiceSubstitutions: automaticVoiceSubstitutions.length, choices: choiceCounts, reachableBlocks: model ? model.graph.reachable.length : 0, unreachableBlocks: model ? model.graph.unreachable.length : 0, generatedPlugins: generatedPlugins.length, customEventReferences: customEventReferences.length, commandConsumption }, audits: { backgrounds: backgrounds?.audits || [], music: music?.audits || [], controlFlow: model ? { startKey: model.graph.startKey, reachable: model.graph.reachable, unreachable: model.graph.unreachable, joins: model.graph.joins, loops: model.graph.loops, segments: model.graph.segments.map((segment) => ({ key: segment.key, originBlockKey: segment.originBlockKey, reachable: segment.reachable, entryBackgroundKey: segment.entryBackgroundKey, effectiveBackgroundKey: segment.effectiveBackgroundKey, backgroundSource: segment.backgroundSource })) } : {} } };
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
  const errors = []; const resources = { scenes: new Map(), backgrounds: new Set(), fonts: new Map(), music: new Set(), variables: new Set() }; const customEvents = new Set(); const eventIds = new Set(); let settings = null; let descriptor = 0;
  for (const [relative, data] of files) {
    if (relative.endsWith('.gbsproj')) descriptor += 1;
    if (/^plugins\/[^/]+\/events\/.+\.js$/i.test(relative)) { const match = /const\s+id\s*=\s*["']([^"']+)["']/.exec(Buffer.from(data).toString('utf-8')); if (match) customEvents.add(match[1]); else errors.push(`custom event IDを読めません: ${relative}`); }
    if (/^plugins\/[^/]+\/plugin\.json$/i.test(relative)) try { const plugin = JSON.parse(Buffer.from(data).toString('utf-8')); if (plugin.type !== 'eventsPlugin') errors.push(`eventsPlugin typeが不正です: ${relative}`); if (!String(plugin.id || '').trim()) errors.push(`eventsPlugin idがありません: ${relative}`); if (!String(plugin.version || '').trim()) errors.push(`eventsPlugin versionがありません: ${relative}`); if (!SUPPORTED_GB_STUDIO_VERSIONS.includes(String(plugin.gbsVersion || ''))) errors.push(`eventsPlugin gbsVersionが未対応です: ${plugin.gbsVersion || ''}`); } catch (error) { errors.push(`plugin.jsonを読めません: ${relative}: ${error.message}`); }
    if (!relative.endsWith('.gbsres')) continue;
    try { const value = JSON.parse(Buffer.from(data).toString('utf-8')); if (value._resourceType === 'settings') settings = value; if (value._resourceType === 'scene') resources.scenes.set(value.id, value); if (value._resourceType === 'background') resources.backgrounds.add(value.id); if (value._resourceType === 'font') resources.fonts.set(value.id, value); if (value._resourceType === 'music') resources.music.add(value.id); if (value._resourceType === 'variables') for (const variable of value.variables || []) resources.variables.add(String(variable.id)); if (value.filename && (path.isAbsolute(value.filename) || String(value.filename).includes('..'))) errors.push(`resource filenameが不正です: ${relative}`); } catch (error) { errors.push(`JSON resourceを読めません: ${relative}: ${error.message}`); }
  }
  if (descriptor !== 1) errors.push(`.gbsprojは1個必要です: ${descriptor}`); if (!settings || settings.colorMode !== 'mixed') errors.push('settings.colorModeはmixed必須です'); if (settings && !resources.scenes.has(settings.startSceneId)) errors.push('startSceneIdを解決できません');
  for (const [fontResourceId, font] of resources.fonts) {
    const imagePath = safeRelative(path.posix.join('assets/fonts', String(font.filename || '').replace(/\\/g, '/'))); const sidecarPath = imagePath.replace(/\.png$/i, '.json');
    if (!files.has(imagePath)) errors.push(`${fontResourceId}: font PNGがありません ${imagePath}`);
    if (!files.has(sidecarPath)) errors.push(`${fontResourceId}: GB Studio compiler用font mapping JSONがありません ${sidecarPath}`);
    else try { const sidecar = JSON.parse(Buffer.from(files.get(sidecarPath)).toString('utf-8')); if (stableJson(sidecar.mapping || {}) !== stableJson(font.mapping || {})) errors.push(`${fontResourceId}: font mapping JSONとresource mappingが一致しません`); } catch (error) { errors.push(`${fontResourceId}: font mapping JSONを読めません: ${error.message}`); }
  }
  const validateMappedText = (value, location) => { for (const text of [].concat(value || [])) { const match = /^!F:([^!]+)!/.exec(String(text)); if (!match) errors.push(`${location}: compiler用inline font指定がありません`); else if (!resources.fonts.has(match[1])) errors.push(`${location}: inline font参照を解決できません ${match[1]}`); } };
  const validateVariable = (value, location) => { if (!resources.variables.has(String(value))) errors.push(`${location}: variable参照を解決できません ${value}`); };
  const scanEvents = (events, location) => {
    let prepared = false;
    for (const item of events || []) {
      if (!item?.id) errors.push(`${location}: event IDがありません`); else if (eventIds.has(item.id)) errors.push(`${location}: event IDが重複しています ${item.id}`); else eventIds.add(item.id);
      if (item.command === DIALOGUE_FRAME_EVENT) prepared = true;
      if (item.command === 'EVENT_TEXT' || item.command === 'EVENT_CHOICE' || item.command === 'PCE_VN_EVENT_MENU') {
        if (!prepared) errors.push(`${location}: framed text前に標準dialogue frame設定がありません`);
        if (item.command === 'EVENT_TEXT') validateMappedText(item.args?.text, `${location}/${item.id}/text`);
        else if (item.command === 'EVENT_CHOICE') { validateMappedText(item.args?.trueText, `${location}/${item.id}/trueText`); validateMappedText(item.args?.falseText, `${location}/${item.id}/falseText`); }
        else { const count = Number(item.args?.items); let totalLines = 0; if (!customEvents.has(item.command)) errors.push(`${location}: custom menu pluginがありません`); if (count < 2 || count > 4) errors.push(`${location}: custom menuは2～4択必須です`); for (let index = 1; index <= count; index += 1) { const option = String(item.args?.[`option${index}`] || ''); validateMappedText(option, `${location}/${item.id}/option${index}`); const visible = option.replace(/^!F:[^!]+!/, ''); const lines = visible.split('\n'); totalLines += lines.length; if (lines.some((line) => Array.from(line).length > 16)) errors.push(`${location}/${item.id}/option${index}: 16セル折返しを超えています`); } if (totalLines > 16) errors.push(`${location}/${item.id}: custom menuは画面上限16行を超えています ${totalLines}`); validateVariable(item.args?.variable, `${location}/${item.id}`); }
        prepared = false;
      }
      if (item.command === 'PCE_VN_EVENT_RANDOM') { if (!customEvents.has(item.command)) errors.push(`${location}: random custom event pluginがありません`); validateVariable(item.args?.variable, `${location}/${item.id}`); const range = Number(item.args?.range); if (range < 1 || range > 65535) errors.push(`${location}/${item.id}: random rangeが不正です ${range}`); }
      if (item.command === 'EVENT_SET_VALUE') validateVariable(item.args?.variable, `${location}/${item.id}`); if (item.command === 'EVENT_VARIABLE_MATH') validateVariable(item.args?.vectorX, `${location}/${item.id}`);
      if (item.command === 'EVENT_TEXT_DRAW') validateMappedText(item.args?.text, `${location}/${item.id}/text`); if (item.command === 'EVENT_SWITCH_SCENE' && !resources.scenes.has(item.args?.sceneId)) errors.push(`${location}: scene参照を解決できません ${item.args?.sceneId}`); if (item.command === 'EVENT_MUSIC_PLAY' && !resources.music.has(item.args?.musicId)) errors.push(`${location}: music参照を解決できません ${item.args?.musicId}`); if (item.command === 'EVENT_SET_FONT' && !resources.fonts.has(item.args?.fontId)) errors.push(`${location}: font参照を解決できません ${item.args?.fontId}`);
      Object.entries(item.children || {}).forEach(([key, children]) => scanEvents(children, `${location}/${item.id}/${key}`));
    }
  };
  for (const scene of resources.scenes.values()) { if (!resources.backgrounds.has(scene.backgroundId)) errors.push(`${scene.id}: background参照を解決できません ${scene.backgroundId}`); scanEvents(scene.script, scene.id); }
  const auditPath = 'build/qa/control-flow-audit.json'; if (!files.has(auditPath)) errors.push('control-flow-audit.jsonがありません'); else try { const audit = JSON.parse(Buffer.from(files.get(auditPath)).toString('utf-8')); if (audit.status !== 'pass' || audit.failures?.length) errors.push('control-flow監査がpassではありません'); const keys = new Set(); for (const command of audit.commands || []) { if (keys.has(command.key)) errors.push(`source command keyが重複しています: ${command.key}`); keys.add(command.key); if (command.disposition !== 'skipped-source' && (!String(command.processingCategory || '') || command.processingCategory === 'unclassified')) errors.push(`${command.key}: 処理区分が未分類です`); for (const mode of ['gbc', 'dmg']) for (const id of command.generated?.[mode]?.eventIds || []) if (!eventIds.has(id)) errors.push(`${command.key}: 監査event IDを解決できません ${id}`); } if (Number(audit.summary?.sourceCommands) !== (audit.commands || []).length || keys.size !== (audit.commands || []).length) errors.push('control-flow監査のsource command件数が一致しません'); } catch (error) { errors.push(`control-flow-audit.jsonを読めません: ${error.message}`); }
  return { ok: errors.length === 0, errors, counts: { scenes: resources.scenes.size, backgrounds: resources.backgrounds.size, fonts: resources.fonts.size, music: resources.music.size, variables: resources.variables.size, customEvents: customEvents.size } };
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
  const backgroundOutputs = (inspection.audits?.backgrounds || []).map((audit) => ({ key: audit.key, assetId: audit.assetId, settings: audit.settings, hashes: audit.hashes })); const musicOutputs = (inspection.audits?.music || []).map((audit) => ({ assetId: audit.assetId, status: audit.status, settings: audit.settings, sourceHash: audit.sourceHash, normalizedEventHash: audit.normalizedEventHash, outputHash: audit.outputHash }));
  return { format: EXPORTER_FORMAT, version: EXPORTER_VERSION, exporter: { id: 'pce-vn-gb-studio-exporter', version: EXPORTER_RELEASE_VERSION }, generatedAt: new Date().toISOString(), sourceProject: { identity: sourceProjectIdentity(inspection.projectDir), title: inspection.project?.title || '', romName: inspection.project?.romName || '' }, sourceSignature: inspection.sourceSignature, gbStudio: { version: inspection.gbStudio.version, engineVersion: inspection.gbStudio.engineVersion }, conversion: { font, cddaMappings: stableValue(inspection.settings.cddaMappings || {}), audioSubstitutions: stableValue(inspection.settings.audioSubstitutions || {}), backgrounds: stableValue(inspection.settings.backgrounds || {}), music: stableValue(inspection.settings.music || {}), backgroundOutputs: stableValue(backgroundOutputs), musicOutputs: stableValue(musicOutputs), backgroundAuditHash: sha256(stableJson(backgroundOutputs)), musicAuditHash: sha256(stableJson(musicOutputs)), automaticVoiceSubstitutions: inspection.requirements?.automaticVoiceSubstitutions || [], visualOmissions: inspection.omissions || [] }, stats, ownedPaths };
}

function pruneEmptyDirectories(root, boundary) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return; for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) pruneEmptyDirectories(path.join(root, entry.name), boundary); if (path.resolve(root) !== path.resolve(boundary) && isPathInside(boundary, root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
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
  pruneEmptyDirectories(path.join(outputDir, 'plugins'), outputDir);
  const stageParent = path.dirname(stageDir); if (!isPathInside(stageParent, stageDir) || !path.basename(stageDir).startsWith('.pce-vn-gb-stage-')) throw new Error('stage cleanup安全検査に失敗しました'); fs.rmSync(stageDir, { recursive: true, force: true }); return { backupPath };
}

function generateGbStudioProject({ inspection, outputDir, mode = 'generate' } = {}) {
  if (!inspection || inspection.format !== EXPORTER_FORMAT) throw new Error('有効なpreflight結果が必要です');
  if (inspection.errors?.length) { const error = new Error(`preflight errorが${inspection.errors.length}件あります`); error.code = inspection.errors[0].code; error.diagnostics = inspection.errors; throw error; }
  if (inspection.warnings?.length && !inspection.settings?.warningsAcknowledged) { const error = new Error(`warning ${inspection.warnings.length}件の明示確認が必要です`); error.code = 'GBVN_OFFICIAL_BUILD_WARNING'; error.diagnostics = inspection.warnings; throw error; }
  if (!inspection._model || !inspection._backgrounds || !inspection._music) throw new Error('このpreflight結果には生成modelがありません。同じprocessで再preflightしてください');
  const before = sourceSnapshotRaw(inspection.projectDir, inspection._model.sceneDoc, inspection._model.assetDoc, inspection._model.settings, inspection._model.rawDoc); if (before.signature !== inspection.sourceSignature) { const error = new Error('preflight後に入力が変更されました。再preflightしてください'); error.code = 'GBVN_INPUT_SIGNATURE_CHANGED'; throw error; }
  const built = buildGbStudioFiles(inspection._model, inspection._backgrounds, inspection._music); const staticValidation = staticValidateFiles(built.files); if (!staticValidation.ok) { const error = new Error(`生成resourceの静的検査に失敗しました:\n${staticValidation.errors.join('\n')}`); error.code = 'GBVN_OFFICIAL_BUILD_WARNING'; error.validation = staticValidation; throw error; }
  const target = ensureOutputTarget(outputDir, inspection.projectDir); const oldManifest = fs.existsSync(target) ? readOwnership(target) : null; const sameExporter = oldManifest?.exporter?.id === 'pce-vn-gb-studio-exporter'; const sameIdentity = oldManifest?.sourceProject?.identity === sourceProjectIdentity(inspection.projectDir); const sameLegacySnapshot = ['1.1.0', '1.1.1'].includes(String(oldManifest?.exporter?.version || '')) && Boolean(oldManifest?.sourceSignature && oldManifest.sourceSignature === inspection.sourceSignature); if (oldManifest && (!sameExporter || (!sameIdentity && !sameLegacySnapshot))) { const error = new Error('出力先manifestのexporterまたはsource project identityが一致しません'); error.code = 'GBVN_OUTPUT_NOT_OWNED'; throw error; } const stage = path.join(path.dirname(target), `.pce-vn-gb-stage-${process.pid}-${crypto.randomBytes(6).toString('hex')}`); if (fs.existsSync(stage)) throw new Error('stage pathが既に存在します'); fs.mkdirSync(stage, { recursive: false });
  let committed = false;
  try {
    const manifest = manifestFor(built.files, inspection, built.stats); built.files.set(MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')); writeFileMap(stage, built.files);
    const after = sourceSnapshotRaw(inspection.projectDir, inspection._model.sceneDoc, inspection._model.assetDoc, inspection._model.settings, inspection._model.rawDoc); if (after.signature !== before.signature) { const error = new Error('生成中に入力fileが変更されました'); error.code = 'GBVN_INPUT_SIGNATURE_CHANGED'; throw error; }
    const commit = commitFileMap(target, stage, built.files, oldManifest); committed = true; const portable = portableSidecar(inspection.projectDir, inspection.settings); for (const copy of portable.copies) { const destination = path.resolve(inspection.projectDir, copy.relative); if (!isPathInside(inspection.projectDir, destination)) throw new Error('portable asset取込path traversalを拒否しました'); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(copy.source, destination); }
    writeJsonAtomic(path.join(inspection.projectDir, SIDECAR_FILE), portable.sidecar); let officialBuild = null; if (mode === 'verify') { officialBuild = runOfficialBuildSync(inspection, target, path.join(target, built.descriptor)); refreshManifestBuildOwnership(target); } const validation = validateGbStudioProject({ outputDir: target, inspection, requireBuild: mode === 'verify' });
    return { ok: validation.ok, outputDir: target, descriptorPath: path.join(target, built.descriptor), manifestPath: path.join(target, MANIFEST_FILE), sidecarPath: path.join(inspection.projectDir, SIDECAR_FILE), backupPath: commit.backupPath, stats: built.stats, officialBuild, validation, runtime: { ran: false, code: 'GBVN_RUNTIME_NOT_RUN', message: 'GB Studio内蔵emulatorの実入力smokeは未実行です' } };
  } finally { if (!committed && fs.existsSync(stage) && isPathInside(path.dirname(stage), stage) && path.basename(stage).startsWith('.pce-vn-gb-stage-')) fs.rmSync(stage, { recursive: true, force: true }); }
}

function validateGbStudioProject({ outputDir, inspection, requireBuild = false } = {}) {
  const root = path.resolve(String(outputDir || '')); const errors = []; const warnings = []; if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { ok: false, errors: [diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', '出力folderがありません', root)], warnings };
  const manifest = readOwnership(root); if (!manifest) errors.push(diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', 'exporter manifestがありません', MANIFEST_FILE));
  const files = new Map(); for (const absolute of walkFiles(root)) { const relative = normalizeRelativePath(path.relative(root, absolute)); if (relative.endsWith('.gbsres') || relative.endsWith('.gbsproj') || relative.startsWith('plugins/') || relative.startsWith('assets/fonts/') || relative === 'build/qa/control-flow-audit.json') files.set(relative, fs.readFileSync(absolute)); }
  const staticValidation = staticValidateFiles(files); staticValidation.errors.forEach((message) => errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', message, root)));
  if (manifest) for (const entry of manifest.ownedPaths) { const relative = safeRelative(typeof entry === 'string' ? entry : entry.path); if (relative === MANIFEST_FILE) continue; const absolute = path.resolve(root, relative); if (!fs.existsSync(absolute)) errors.push(diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', `owned fileがありません: ${relative}`, relative)); else if (entry.sha256 && sha256(fs.readFileSync(absolute)) !== entry.sha256) errors.push(diagnostic('error', 'GBVN_OUTPUT_NOT_OWNED', `owned fileのhashが一致しません: ${relative}`, relative)); }
  const roms = walkFiles(path.join(root, 'build', 'rom')).filter((file) => /\.(gb|gbc)$/i.test(file)); const webIndex = path.join(root, 'build', 'web', 'index.html'); const webRoms = walkFiles(path.join(root, 'build', 'web', 'rom')).filter((file) => /\.(gb|gbc)$/i.test(file)); if (requireBuild && !roms.length) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio ROM build成果物がありません', 'build/rom')); if (requireBuild && !fs.existsSync(webIndex)) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio Web build成果物がありません', 'build/web/index.html')); if (requireBuild && !webRoms.length) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio Web内ROMがありません', 'build/web/rom')); if (requireBuild && roms.length && webRoms.length && sha256(fs.readFileSync(roms[0])) !== sha256(fs.readFileSync(webRoms[0]))) errors.push(diagnostic('error', 'GBVN_OFFICIAL_BUILD_WARNING', '公式ROMとWeb内ROMのhashが一致しません', 'build/web/rom')); if (!requireBuild && !roms.length) warnings.push(diagnostic('warning', 'GBVN_OFFICIAL_BUILD_WARNING', '公式GB Studio buildは未実行です', 'build/rom'));
  if (!inspection?.runtime?.ran) warnings.push(diagnostic('warning', 'GBVN_RUNTIME_NOT_RUN', 'GB Studio内蔵emulatorの実入力runtime smokeは未実行です', 'runtime'));
  return { ok: errors.length === 0, errors, warnings, static: staticValidation, roms: roms.map((file) => ({ path: file, size: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) })) };
}

module.exports = { EXPORTER_FORMAT, EXPORTER_RELEASE_VERSION, EXPORTER_VERSION, MANIFEST_FILE, SIDECAR_FILE, SUPPORTED_GB_STUDIO_VERSIONS, TARGET_ENGINE_VERSION, TARGET_GB_STUDIO_VERSION, generateGbStudioProject, inspectGbStudioExport, inspectGbStudioInstallation, isSupportedGbStudioInstallation, normalizeBackgroundSetting, normalizeGbStudioExecutablePath, normalizeSidecar, previewVnGbStudioBackground, previewVnGbStudioMusic, readAsarEntry, readSidecar, sourceCommandInventory, sourceSnapshot, validateGbStudioProject };
