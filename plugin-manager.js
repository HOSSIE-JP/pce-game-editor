'use strict';

/**
 * plugin-manager.js
 * pce-game-editor/plugins/ フォルダのプラグインを管理する（Main プロセス専用）。
 *
 * プラグイン構成:
 *   pce-game-editor/plugins/<id>/manifest.json
 *   pce-game-editor/plugins/<id>/index.js
 *
 * Current manifest format:
 *   {
 *     "id": "plugin-id",
 *     "name": "Plugin Name",
 *     "description": "...",
 *     "version": "1.0.0",
 *     "icon": "puzzle",
 *     "types": ["build", "logger"],
 *     "supportedCores": ["pc-engine"] | ["*"],
 *     "roles": [{ "id": "builder", "label": "Build", "exclusive": true }],
 *     "hooks": ["onBuildStart", "onBuildLog", "onBuildEnd"]
 *   }
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const { getCurrentAppConfig, pluginAllowedForApp } = require('./game-editor-common');
const appDiagnostics = require('./app-diagnostics');

function getPluginsDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'plugins');
  }
  return getCurrentAppConfig().pluginsRoot || path.join(__dirname, 'plugins');
}

// ユーザーが独自に追加できるプラグインディレクトリ (常に書き込み可能)
function getUserPluginsDir() {
  return path.join(app.getPath('userData'), 'plugins');
}

// ── ステート永続化 ─────────────────────────────────────────────────────────

function getStateFile() {
  return path.join(app.getPath('userData'), 'plugins-state.json');
}

function readState() {
  try {
    if (fs.existsSync(getStateFile())) {
      return JSON.parse(fs.readFileSync(getStateFile(), 'utf-8'));
    }
  } catch (err) {
    appDiagnostics.report({
      source: 'plugin',
      code: 'plugin-state-read-failed',
      level: 'error',
      error: err,
      details: { file: getStateFile() },
    });
  }
  return {};
}

function writeState(s) {
  const dir = path.dirname(getStateFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStateFile(), JSON.stringify(s, null, 2), 'utf-8');
}

function normalizePluginTypes(manifest) {
  if (Array.isArray(manifest.types) && manifest.types.length > 0) {
    return manifest.types.map((t) => String(t || '').trim()).filter(Boolean);
  }
  return ['unknown'];
}

function normalizeSupportedCores(manifest, pluginTypes = []) {
  return Array.from(new Set(manifest.supportedCores.map((value) => String(value).trim())));
}

function validateManifest(manifest, directoryId) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest.json must contain an object'];
  }
  const id = String(manifest.id || '').trim();
  if (!id) errors.push('id is required');
  else if (id !== directoryId) errors.push(`id must match plugin directory: ${directoryId}`);
  if (!String(manifest.name || '').trim()) errors.push('name is required');
  if (!String(manifest.version || '').trim()) errors.push('version is required');
  if (!Array.isArray(manifest.types) || manifest.types.length === 0 || manifest.types.some((item) => !String(item || '').trim())) {
    errors.push('types must be a non-empty string array');
  }
  if (!Array.isArray(manifest.supportedCores) || manifest.supportedCores.length === 0) {
    errors.push('supportedCores must be a non-empty array');
  } else {
    const invalid = manifest.supportedCores.filter((item) => !['pc-engine', '*'].includes(String(item || '').trim()));
    if (invalid.length > 0) errors.push(`unsupported core id: ${invalid.join(', ')}`);
  }
  if (Array.isArray(manifest.types) && manifest.types.includes('core') && String(manifest.core?.id || '').trim() !== 'pc-engine') {
    errors.push('core plugins must declare core.id as pc-engine');
  }
  return errors;
}

function normalizeCoreMetadata(manifest, pluginTypes, supportedCores) {
  if (!pluginTypes.includes('core')) return null;
  const core = manifest.core && typeof manifest.core === 'object' ? manifest.core : {};
  const id = String(core.id || supportedCores.find((item) => item !== '*') || manifest.id || '').trim();
  if (!id) return null;
  return {
    id,
    label: String(core.label || core.name || manifest.name || id).trim(),
    platform: String(core.platform || '').trim(),
  };
}

function detectGeneratorExport(manifest, pluginDir) {
  if (manifest.generator === false || manifest.hasGenerator === false) return false;
  if (manifest.generator === true || manifest.hasGenerator === true) return true;

  const indexPath = path.join(pluginDir, 'index.js');
  if (!fs.existsSync(indexPath)) return false;
  try {
    const source = fs.readFileSync(indexPath, 'utf-8');
    return /\bgenerateSource(?:Async)?\b/.test(source);
  } catch (_) {
    return false;
  }
}

function pluginSupportsCore(plugin, coreId) {
  const core = String(coreId || '').trim();
  if (!core) return true;
  const cores = Array.isArray(plugin?.supportedCores) ? plugin.supportedCores : [];
  return cores.includes('*') || cores.includes(core);
}

function normalizeHooks(manifest) {
  if (!Array.isArray(manifest.hooks)) return [];
  return manifest.hooks.map((h) => String(h || '').trim()).filter(Boolean);
}

function normalizeDependencies(manifest) {
  if (!Array.isArray(manifest.dependencies)) return [];
  return Array.from(new Set(
    manifest.dependencies
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  ));
}

function normalizeRendererCapabilities(renderer) {
  if (!Array.isArray(renderer?.capabilities)) return [];
  return Array.from(new Set(
    renderer.capabilities
      .map((capability) => String(capability || '').trim())
      .filter(Boolean),
  ));
}

function normalizeIcon(manifest) {
  const raw = typeof manifest.icon === 'string' && manifest.icon.trim()
    ? manifest.icon
    : manifest.tab?.icon;
  return String(raw || '').trim().toLowerCase();
}

function normalizeMainApi(manifest) {
  const raw = manifest.mainApi && typeof manifest.mainApi === 'object'
    ? manifest.mainApi
    : {};
  const normalizeList = (value) => (Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
    : []);
  return {
    hooks: normalizeList(raw.hooks),
    capabilities: normalizeList(raw.capabilities),
  };
}

function normalizePermissions(manifest) {
  if (!Array.isArray(manifest.permissions)) return [];
  return Array.from(new Set(
    manifest.permissions
      .map((permission) => String(permission || '').trim())
      .filter(Boolean),
  ));
}

function normalizeRoles(manifest) {
  const roles = [];
  const seen = new Set();

  const addRole = (role) => {
    if (!role) return;
    const id = String(typeof role === 'string' ? role : role.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const label = String(typeof role === 'object' && role.label ? role.label : (
      id === 'builder' ? 'Build' : id === 'testplay' ? 'Test Play' : id
    )).trim();
    const order = Number(typeof role === 'object' ? role.order : NaN);
    roles.push({
      id,
      label,
      exclusive: typeof role === 'object' && Object.prototype.hasOwnProperty.call(role, 'exclusive')
        ? Boolean(role.exclusive)
        : true,
      order: Number.isFinite(order) ? order : (id === 'builder' ? 10 : id === 'testplay' ? 20 : 100),
    });
  };

  if (Array.isArray(manifest.roles)) {
    manifest.roles.forEach((role) => addRole(role));
  }

  return roles.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id, 'ja');
  });
}

function pluginSupportsExclusiveRole(plugin, roleId) {
  const role = String(roleId || '').trim();
  if (!role) return false;
  const roles = Array.isArray(plugin?.roles) ? plugin.roles : [];
  return roles.some((entry) => entry?.id === role && entry.exclusive !== false);
}

function getExclusiveRoleIds(plugin) {
  const roles = Array.isArray(plugin?.roles) ? plugin.roles : [];
  return roles
    .filter((entry) => entry?.id && entry.exclusive !== false)
    .map((entry) => String(entry.id));
}

function resolvePluginFile(pluginDir, relativePath) {
  const value = String(relativePath || '').trim();
  if (!value || path.isAbsolute(value)) return null;

  const root = path.resolve(pluginDir);
  const abs = path.resolve(root, value);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return abs;
}

function normalizeRenderer(manifest, pluginDir) {
  const raw = manifest.renderer && typeof manifest.renderer === 'object'
    ? manifest.renderer
    : null;
  if (!raw) {
    return { renderer: null, rendererAssets: null, hasRenderer: false };
  }

  const renderer = {
    entry: String(raw.entry || '').trim(),
    styles: Array.isArray(raw.styles)
      ? raw.styles.map((style) => String(style || '').trim()).filter(Boolean)
      : [],
    page: String(raw.page || raw.mountPage || manifest.tab?.page || '').trim(),
    capabilities: normalizeRendererCapabilities(raw),
  };

  const entryPath = resolvePluginFile(pluginDir, renderer.entry);
  if (!entryPath || !fs.existsSync(entryPath)) {
    return {
      renderer: { ...renderer, error: 'renderer entry is missing or outside plugin directory' },
      rendererAssets: null,
      hasRenderer: false,
    };
  }

  const stylePaths = [];
  for (const style of renderer.styles) {
    const stylePath = resolvePluginFile(pluginDir, style);
    if (!stylePath || !fs.existsSync(stylePath)) {
      return {
        renderer: { ...renderer, error: `renderer style is missing or outside plugin directory: ${style}` },
        rendererAssets: null,
        hasRenderer: false,
      };
    }
    stylePaths.push(stylePath);
  }

  return {
    renderer,
    rendererAssets: {
      scriptUrl: pathToFileURL(entryPath).href,
      styleUrls: stylePaths.map((stylePath) => pathToFileURL(stylePath).href),
    },
    hasRenderer: true,
  };
}

function isPluginEnabled(id) {
  const plugin = listPlugins({ includeIncompatible: true }).find((entry) => entry.id === id);
  return Boolean(plugin?.enabled);
}

function isHiddenPluginManifest(manifest) {
  return Boolean(manifest?.hidden || manifest?.private || manifest?.internal);
}

// ── プラグイン一覧 ──────────────────────────────────────────────────────────

function scanPlugins(options = {}) {
  const coreId = String(options.coreId || '').trim();
  const includeIncompatible = options.includeIncompatible !== false;
  const builtinDir = getPluginsDir();
  const userDir = getUserPluginsDir();
  const state = readState();
  const diagnostics = [];
  const pluginEntries = [];

  function collectFrom(dir, isUser) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .forEach((entry) => pluginEntries.push({ id: entry.name, baseDir: dir, isUser }));
  }

  collectFrom(userDir, true);
  collectFrom(builtinDir, false);

  // A valid user plugin shadows a built-in plugin with the same id. An invalid
  // user plugin is reported but does not hide the valid built-in fallback.
  const selected = new Map();
  pluginEntries.forEach(({ id, baseDir, isUser }) => {
    if (selected.has(id)) return;
    const manifestPath = path.join(baseDir, id, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      diagnostics.push({
        pluginId: id,
        source: isUser ? 'user' : 'builtin',
        code: 'manifest-read-failed',
        level: 'error',
        path: manifestPath,
        messages: [String(err?.message || err)],
      });
      return;
    }
    if (isHiddenPluginManifest(manifest)) return;
    const manifestErrors = validateManifest(manifest, id);
    if (manifestErrors.length > 0) {
      diagnostics.push({
        pluginId: id,
        source: isUser ? 'user' : 'builtin',
        code: 'manifest-invalid',
        level: 'error',
        path: manifestPath,
        messages: manifestErrors,
      });
      return;
    }

    const pluginDir = path.join(baseDir, id);
    const pluginTypes = normalizePluginTypes(manifest);
    const supportedCores = normalizeSupportedCores(manifest, pluginTypes);
    const rendererInfo = normalizeRenderer(manifest, pluginDir);
    const trusted = !isUser || state[id]?.trusted === true;
    const configuredEnabled = Boolean(state[id]?.enabled ?? !isUser);
    const plugin = {
      id,
      name: manifest.name || id,
      description: manifest.description || '',
      version: manifest.version || '0.0.0',
      icon: normalizeIcon(manifest),
      pluginTypes,
      pluginType: pluginTypes[0] || 'unknown',
      supportedCores,
      core: normalizeCoreMetadata(manifest, pluginTypes, supportedCores),
      compatibleWithActiveCore: pluginSupportsCore({ supportedCores }, coreId),
      tab: manifest.tab || null,
      dependencies: normalizeDependencies(manifest),
      hooks: normalizeHooks(manifest),
      mainApi: normalizeMainApi(manifest),
      permissions: normalizePermissions(manifest),
      roles: normalizeRoles(manifest),
      hasGenerator: detectGeneratorExport(manifest, pluginDir),
      renderer: rendererInfo.renderer,
      hasRenderer: rendererInfo.hasRenderer,
      rendererAssets: rendererInfo.rendererAssets,
      enabled: configuredEnabled && trusted,
      configuredEnabled,
      trusted,
      isUserPlugin: isUser,
      missingDependencies: [],
    };
    if (pluginAllowedForApp(plugin.supportedCores)) selected.set(id, plugin);
  });

  const allPlugins = Array.from(selected.values());
  const availableIds = new Set(allPlugins.map((plugin) => plugin.id));
  allPlugins.forEach((plugin) => {
    plugin.missingDependencies = (plugin.dependencies || []).filter((dependencyId) => !availableIds.has(dependencyId));
    if (plugin.missingDependencies.length > 0) {
      diagnostics.push({
        pluginId: plugin.id,
        source: plugin.isUserPlugin ? 'user' : 'builtin',
        code: 'dependency-missing',
        level: 'error',
        path: '',
        messages: [`missing dependencies: ${plugin.missingDependencies.join(', ')}`],
      });
    }
  });

  const plugins = allPlugins
    .filter((plugin) => includeIncompatible || pluginSupportsCore(plugin, coreId))
    .sort((a, b) => a.id.localeCompare(b.id, 'ja'));
  return { plugins, diagnostics };
}

function listPlugins(options = {}) {
  return scanPlugins(options).plugins;
}

function listPluginDiagnostics(options = {}) {
  return scanPlugins(options).diagnostics;
}

function setUserPluginTrusted(id, trusted) {
  const pluginId = String(id || '').trim();
  const plugin = listPlugins({ includeIncompatible: true }).find((entry) => entry.id === pluginId);
  if (!plugin) return { ok: false, error: `plugin not found: ${pluginId}` };
  if (!plugin.isUserPlugin) return { ok: false, error: `built-in plugin trust cannot be changed: ${pluginId}` };
  const state = readState();
  state[pluginId] = {
    ...(state[pluginId] || {}),
    trusted: Boolean(trusted),
    ...(trusted ? {} : { enabled: false }),
  };
  writeState(state);
  return { ok: true, id: pluginId, trusted: Boolean(trusted) };
}

function canInvokeRendererHook(pluginInfo, hookName) {
  const hook = String(hookName || '').trim();
  if (!hook || !pluginInfo?.enabled) return false;
  const declaredHooks = Array.isArray(pluginInfo.hooks) ? pluginInfo.hooks : [];
  const allowedHooks = Array.isArray(pluginInfo.mainApi?.hooks) ? pluginInfo.mainApi.hooks : [];
  return declaredHooks.includes(hook) && allowedHooks.includes(hook);
}

async function invokeRendererHook(id, hookName, payload = {}, context = {}) {
  const pluginId = String(id || '').trim();
  const hook = String(hookName || '').trim();
  const pluginInfo = listPlugins().find((plugin) => plugin.id === pluginId);
  if (!pluginInfo) {
    return { ok: false, error: `plugin not found: ${pluginId}` };
  }
  if (!canInvokeRendererHook(pluginInfo, hook)) {
    return { ok: false, error: `renderer is not allowed to invoke hook: ${pluginId}.${hook}` };
  }
  return invokeHook(pluginId, hook, payload, context);
}

function getRendererAssets(id) {
  const plugin = listPlugins().find((p) => p.id === id);
  if (!plugin) {
    return { ok: false, error: `plugin not found: ${id}` };
  }
  if (!plugin.hasRenderer || !plugin.rendererAssets) {
    return { ok: false, error: `plugin has no renderer module: ${id}` };
  }
  if (plugin.isUserPlugin && !plugin.trusted) {
    return { ok: false, error: `user plugin trust is required: ${id}`, requiresTrust: true };
  }
  return {
    ok: true,
    id: plugin.id,
    renderer: plugin.renderer,
    rendererAssets: plugin.rendererAssets,
  };
}

// ── 有効 / 無効切替 ────────────────────────────────────────────────────────

function setEnabled(id, enabled) {
  const s = readState();
  s[id] = { ...(s[id] || {}), enabled: Boolean(enabled) };
  writeState(s);
}

function setEnabledWithDependencies(id, enabled, options = {}) {
  const pluginId = String(id || '').trim();
  const coreId = String(options.coreId || '').trim();
  if (!pluginId) {
    return { ok: false, error: 'plugin id is empty', changed: [], changedIds: [] };
  }

  const plugins = listPlugins();
  const pluginMap = new Map(plugins.map((p) => [p.id, p]));
  if (!pluginMap.has(pluginId)) {
    return { ok: false, error: `plugin not found: ${pluginId}`, changed: [], changedIds: [] };
  }
  if (enabled && coreId && !pluginSupportsCore(pluginMap.get(pluginId), coreId)) {
    return { ok: false, error: `plugin ${pluginId} is not compatible with core: ${coreId}`, changed: [], changedIds: [] };
  }

  if (enabled) {
    const pendingTrust = [pluginId];
    const trustVisited = new Set();
    const untrustedPluginIds = [];
    while (pendingTrust.length > 0) {
      const currentId = pendingTrust.pop();
      if (trustVisited.has(currentId)) continue;
      trustVisited.add(currentId);
      const current = pluginMap.get(currentId);
      if (!current) continue;
      if (current.isUserPlugin && !current.trusted) untrustedPluginIds.push(currentId);
      (current.dependencies || []).forEach((dependencyId) => pendingTrust.push(dependencyId));
    }
    if (untrustedPluginIds.length > 0) {
      const ids = Array.from(new Set(untrustedPluginIds));
      return {
        ok: false,
        error: `user plugin trust is required: ${ids.join(', ')}`,
        requiresTrust: true,
        untrustedPluginIds: ids,
        changed: [],
        changedIds: [],
      };
    }
  }

  const state = readState();
  const changed = [];
  const missingDependencies = [];

  if (enabled) {
    const pending = [pluginId];
    const visited = new Set();
    while (pending.length > 0) {
      const currentId = pending.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = pluginMap.get(currentId);
      if (!current) {
        missingDependencies.push(currentId);
        continue;
      }
      (current.dependencies || []).forEach((dependencyId) => pending.push(dependencyId));
    }
    if (missingDependencies.length > 0) {
      const missing = Array.from(new Set(missingDependencies));
      return {
        ok: false,
        error: `missing plugin dependencies: ${missing.join(', ')}`,
        changed: [],
        changedIds: [],
        missingDependencies: missing,
      };
    }
  }

  const setStateEnabled = (targetId, nextEnabled, reason) => {
    const prevEnabled = Boolean(state[targetId]?.enabled ?? true);
    if (prevEnabled === nextEnabled) return;
    state[targetId] = { ...(state[targetId] || {}), enabled: nextEnabled };
    changed.push({ id: targetId, enabled: nextEnabled, reason });
  };

  const buildDependentsMap = () => {
    const dependentsMap = new Map();
    plugins.forEach((plugin) => {
      (plugin.dependencies || []).forEach((depId) => {
        const current = dependentsMap.get(depId) || [];
        current.push(plugin.id);
        dependentsMap.set(depId, current);
      });
    });
    return dependentsMap;
  };

  const disableWithDependents = (targetId, reasonForRoot) => {
    const dependentsMap = buildDependentsMap();
    const stack = [targetId];
    const visited = new Set();
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      setStateEnabled(currentId, false, currentId === targetId ? reasonForRoot : `depends-on:${targetId}`);
      const dependents = dependentsMap.get(currentId) || [];
      dependents.forEach((dependerId) => stack.push(dependerId));
    }
  };

  if (enabled) {
    const stack = [pluginId];
    const visited = new Set();
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const current = pluginMap.get(currentId);
      if (!current) continue;
      setStateEnabled(currentId, true, currentId === pluginId ? 'self' : `required-by:${pluginId}`);

      (current.dependencies || []).forEach((depId) => {
        if (pluginMap.has(depId)) {
          stack.push(depId);
        }
      });
    }

    getExclusiveRoleIds(pluginMap.get(pluginId)).forEach((roleId) => {
      plugins.forEach((plugin) => {
        if (plugin.id === pluginId) return;
        if (coreId && !pluginSupportsCore(plugin, coreId)) return;
        if (pluginSupportsExclusiveRole(plugin, roleId)) {
          disableWithDependents(plugin.id, `exclusive-role:${roleId}`);
        }
      });
    });
  } else {
    disableWithDependents(pluginId, 'self');
  }

  writeState(state);
  return {
    ok: true,
    changed,
    changedIds: changed.map((entry) => entry.id),
    missingDependencies: Array.from(new Set(missingDependencies)),
  };
}

function getPluginDirectory(id) {
  const pluginId = String(id || '').trim();
  if (!pluginId) return null;
  const userDir = path.join(getUserPluginsDir(), pluginId);
  if (fs.existsSync(userDir)) return userDir;
  const builtinDir = path.join(getPluginsDir(), pluginId);
  if (fs.existsSync(builtinDir)) return builtinDir;
  return null;
}

function setExclusiveRoleSelection(roleId, id, options = {}) {
  const role = String(roleId || '').trim();
  const pluginId = String(id || '').trim();
  const coreId = String(options.coreId || '').trim();
  if (!role) {
    return { ok: false, error: 'role id is empty', changed: [], changedIds: [] };
  }
  if (!pluginId) {
    return { ok: true, changed: [], changedIds: [], missingDependencies: [] };
  }

  const plugins = listPlugins();
  const selected = plugins.find((plugin) => plugin.id === pluginId);
  if (!selected) {
    return { ok: false, error: `plugin not found: ${pluginId}`, changed: [], changedIds: [] };
  }
  if (coreId && !pluginSupportsCore(selected, coreId)) {
    return { ok: false, error: `plugin ${pluginId} is not compatible with core: ${coreId}`, changed: [], changedIds: [] };
  }
  if (!pluginSupportsExclusiveRole(selected, role)) {
    return { ok: false, error: `plugin ${pluginId} does not support exclusive role: ${role}`, changed: [], changedIds: [] };
  }

  return setEnabledWithDependencies(pluginId, true, options);
}

// ── ジェネレータ実行 ────────────────────────────────────────────────────────

function getPlugin(id) {
  // ユーザープラグインを優先して探す
  const userIndexPath = path.join(getUserPluginsDir(), id, 'index.js');
  const builtinIndexPath = path.join(getPluginsDir(), id, 'index.js');
  const indexPath = fs.existsSync(userIndexPath) ? userIndexPath
    : fs.existsSync(builtinIndexPath) ? builtinIndexPath
    : null;
  if (!indexPath) return null;
  // require キャッシュを強制クリアしてリロードに対応
  const resolved = path.resolve(indexPath);
  delete require.cache[resolved];
  try {
    return require(resolved);
  } catch (e) {
    return { _loadError: String(e.message || e) };
  }
}

async function runGenerator(id, assets, context = {}) {
  const pluginInfo = listPlugins().find((plugin) => plugin.id === id);
  if (context.coreId && pluginInfo && !pluginSupportsCore(pluginInfo, context.coreId)) {
    return { ok: false, error: `プラグイン "${id}" は core "${context.coreId}" に対応していません` };
  }
  if (!isPluginEnabled(id)) {
    return { ok: false, error: `プラグイン "${id}" は無効になっています` };
  }
  const plugin = getPlugin(id);
  if (!plugin) return { ok: false, error: `プラグイン "${id}" の index.js が見つかりません` };
  if (plugin._loadError) return { ok: false, error: `プラグイン "${id}" の読み込みエラー: ${plugin._loadError}` };

  const fn = typeof plugin.generateSourceAsync === 'function'
    ? plugin.generateSourceAsync
    : plugin.generateSource;

  if (typeof fn !== 'function') {
    return { ok: false, error: `プラグイン "${id}" に generateSource 関数がありません` };
  }

  try {
    const result = await fn(assets, context);
    return result || { ok: true, sourceCode: '' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function invokeHook(id, hookName, payload = {}, context = {}) {
  const pluginInfo = listPlugins().find((plugin) => plugin.id === id);
  if (context.coreId && pluginInfo && !pluginSupportsCore(pluginInfo, context.coreId)) {
    return { ok: false, error: `プラグイン "${id}" は core "${context.coreId}" に対応していません` };
  }
  if (!isPluginEnabled(id)) {
    return { ok: false, error: `プラグイン "${id}" は無効になっています` };
  }

  const plugin = getPlugin(id);
  if (!plugin) return { ok: false, error: `プラグイン "${id}" の index.js が見つかりません` };
  if (plugin._loadError) return { ok: false, error: `プラグイン "${id}" の読み込みエラー: ${plugin._loadError}` };

  const hookFn = plugin[hookName];
  if (typeof hookFn !== 'function') {
    return { ok: true, skipped: true };
  }

  try {
    const result = await hookFn(payload, context);
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
      return result;
    }
    return { ok: true, result: result === undefined ? null : result };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = {
  scanPlugins,
  listPlugins,
  listPluginDiagnostics,
  getRendererAssets,
  setEnabled,
  setEnabledWithDependencies,
  setExclusiveRoleSelection,
  canInvokeRendererHook,
  runGenerator,
  invokeHook,
  invokeRendererHook,
  isPluginEnabled,
  setUserPluginTrusted,
  pluginSupportsCore,
  getPluginsDir,
  getPluginDirectory,
  getUserPluginsDir,
  validateManifest,
};
