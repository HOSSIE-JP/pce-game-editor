'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CORE_ID = 'default';

const DEFAULT_CONFIG = Object.freeze({
  appId: 'jp.co.geroneko.game.editor.desktop',
  productName: 'GameEditor',
  displayName: 'Game Editor',
  defaultCoreId: DEFAULT_CORE_ID,
  allowedCoreIds: [DEFAULT_CORE_ID],
  coreAliases: {},
  pluginsRoot: 'plugins',
  templatesRoot: 'template',
  projectsRootName: 'projects',
  toolsRootName: 'tools',
});

function normalizeCoreToken(value, fallback = '') {
  const raw = String(value || '').trim().toLowerCase();
  return raw || String(fallback || '').trim().toLowerCase();
}

function normalizeAliasMap(value = {}) {
  const aliases = {};
  if (!value || typeof value !== 'object') return aliases;
  Object.entries(value).forEach(([key, target]) => {
    const alias = normalizeCoreToken(key);
    const normalizedTarget = normalizeCoreToken(target);
    if (alias && normalizedTarget) aliases[alias] = normalizedTarget;
  });
  return aliases;
}

function normalizeCoreId(value, config = getCurrentAppConfig()) {
  const aliases = normalizeAliasMap(config.coreAliases);
  const fallback = normalizeCoreToken(config.defaultCoreId || DEFAULT_CORE_ID, DEFAULT_CORE_ID);
  const raw = normalizeCoreToken(value, fallback);
  return aliases[raw] || raw || fallback;
}

function normalizeAllowedCoreIds(value, config = DEFAULT_CONFIG) {
  const source = Array.isArray(value) && value.length > 0 ? value : config.allowedCoreIds;
  const allowed = Array.from(new Set(source.map((coreId) => normalizeCoreId(coreId, config)).filter(Boolean)));
  return allowed.length > 0 ? allowed : [normalizeCoreId(config.defaultCoreId || DEFAULT_CORE_ID, config)];
}

function resolveMaybeRelative(appRoot, value, fallbackName) {
  const raw = String(value || fallbackName || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.join(appRoot, raw);
}

function normalizeAppConfig(raw = {}) {
  const appRoot = path.resolve(raw.appRoot || raw.rootDir || process.cwd());
  const base = {
    ...DEFAULT_CONFIG,
    ...raw,
    appRoot,
    coreAliases: normalizeAliasMap(raw.coreAliases || DEFAULT_CONFIG.coreAliases),
  };
  const allowedCoreIds = normalizeAllowedCoreIds(raw.allowedCoreIds, base);
  const defaultCandidate = normalizeCoreId(raw.defaultCoreId || allowedCoreIds[0], base);
  const defaultCoreId = allowedCoreIds.includes(defaultCandidate) ? defaultCandidate : allowedCoreIds[0];
  return {
    ...base,
    appRoot,
    defaultCoreId,
    allowedCoreIds,
    pluginsRoot: resolveMaybeRelative(appRoot, raw.pluginsRoot, DEFAULT_CONFIG.pluginsRoot),
    templatesRoot: resolveMaybeRelative(appRoot, raw.templatesRoot, DEFAULT_CONFIG.templatesRoot),
    projectsRootName: String(raw.projectsRootName || DEFAULT_CONFIG.projectsRootName),
    toolsRootName: String(raw.toolsRootName || DEFAULT_CONFIG.toolsRootName),
    migration: raw.migration && typeof raw.migration === 'object' ? { ...raw.migration } : {},
  };
}

function loadAppConfig(raw = {}) {
  const config = normalizeAppConfig(raw);
  global.__GAME_EDITOR_APP_CONFIG__ = config;
  return config;
}

function getCurrentAppConfig() {
  if (global.__GAME_EDITOR_APP_CONFIG__) return global.__GAME_EDITOR_APP_CONFIG__;
  return loadAppConfig(DEFAULT_CONFIG);
}

function getDefaultCoreId() {
  return getCurrentAppConfig().defaultCoreId;
}

function isCoreAllowed(coreId) {
  const config = getCurrentAppConfig();
  return config.allowedCoreIds.includes(normalizeCoreId(coreId, config));
}

function normalizeCoreIdForApp(value) {
  const config = getCurrentAppConfig();
  const normalized = normalizeCoreId(value || config.defaultCoreId, config);
  return config.allowedCoreIds.includes(normalized) ? normalized : config.defaultCoreId;
}

function filterCoresForApp(cores) {
  const config = getCurrentAppConfig();
  const allowed = new Set(config.allowedCoreIds);
  return (Array.isArray(cores) ? cores : []).filter((core) => allowed.has(normalizeCoreId(core?.id || core, config)));
}

function pluginAllowedForApp(supportedCores) {
  const config = getCurrentAppConfig();
  const cores = Array.isArray(supportedCores) && supportedCores.length > 0
    ? supportedCores.map((core) => normalizeCoreId(core, config)).filter(Boolean)
    : [config.defaultCoreId];
  if (cores.includes('*')) return true;
  return config.allowedCoreIds.some((core) => cores.includes(core));
}

function applyPortableMode(electronApp, appRoot = getCurrentAppConfig().appRoot) {
  let markerExists = false;
  let dataDir;

  if (electronApp.isPackaged) {
    const exeDir = path.dirname(electronApp.getPath('exe'));
    markerExists = fs.existsSync(path.join(exeDir, 'portable'));
    dataDir = path.join(exeDir, 'data');
  } else {
    markerExists = fs.existsSync(path.join(appRoot, '.portable'));
    dataDir = path.join(appRoot, 'data');
  }

  if (markerExists) {
    electronApp.setPath('userData', dataDir);
    electronApp.setPath('logs', path.join(dataDir, 'logs'));
  }
}

function createGameEditorApp(config, launcher) {
  const normalized = loadAppConfig(config);
  if (typeof launcher === 'function') return launcher(normalized);
  return normalized;
}

module.exports = {
  DEFAULT_CORE_ID,
  applyPortableMode,
  createGameEditorApp,
  filterCoresForApp,
  getCurrentAppConfig,
  getDefaultCoreId,
  isCoreAllowed,
  loadAppConfig,
  normalizeAppConfig,
  normalizeCoreId,
  normalizeCoreIdForApp,
  pluginAllowedForApp,
};
