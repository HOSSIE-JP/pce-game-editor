const path = require('path');
const fs = require('fs');
const { shell } = require('electron');
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { loadAppConfig, applyPortableMode } = require('./game-editor-common');
const { spawn } = require('child_process');
const cdBundle = require('./pce-cd-bundle');
const pceExport = require('./pce-export');
const { exportIrodoriBatchZip } = require('./pce-vn-irodori-export');
const { inspectIrodoriVoiceAssignments } = require('./pce-vn-irodori-assign');
const systemCardProfile = require('./pce-system-card-profile');
const { resolveUnderRoot } = require('./pce-file-safety');
const {
  PCE_CD_SYSTEM_CARD_EMULATOR_NAME,
  createPceTestPlayStaticRoots,
  resolvePceEmulatorJsRuntime,
  samePceTestPlayStaticRoots,
  startPceTestPlayStaticServer: createPceTestPlayStaticServer,
  stopPceTestPlayStaticServer: closePceTestPlayStaticServer,
} = require('./pce-testplay-server');
const gameEditorAppConfig = loadAppConfig(require('./app.config'));
if (typeof app.setName === 'function') app.setName(gameEditorAppConfig.productName || gameEditorAppConfig.displayName || app.getName());
const electronPackageJson = require('./package.json');
const iconv = require('iconv-lite');

// ── アプリビルドメタ読み込み ──────────────────────────────────────────────
// npm start / prepare:dist 時に scripts/inject-build-meta.js が生成する。
function readAppBuildMeta() {
  const metaPath = path.join(__dirname, 'build-meta.json');
  try {
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }
  } catch (err) {
    console.warn(`[app] build metadata could not be read: ${String(err?.message || err)}`);
  }
  return { buildNumber: 'dev', buildAt: null };
}

const appBuildMeta = readAppBuildMeta();

// ── Portable mode detection ────────────────────────────────────────────────
// Must run before any app.getPath() call (including those inside require'd modules).
(function applyConfiguredPortableMode() {
  applyPortableMode(app, __dirname);
})();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const buildSystem = require('./core-manager');
const pceAssetManager = require('./pce-asset-manager');
const { registerPceAssetIpc } = require('./pce-asset-ipc');
const testPlaySettings = require('./pce-testplay-settings');
const pluginManager = require('./plugin-manager');
const appDiagnostics = require('./app-diagnostics');
const { registerPluginIpc } = require('./plugin-ipc');
const {
  createEditorControlService,
  createEditorControlServer,
} = require('./editor-control-service');

let mainWindow = null;
let setupWindow = null;
let testPlayWindow = null;
let testPlaySettingsWindow = null;
let logWindow = null;
let currentTestPlayContext = null;
let pceTestPlayLaunchSerial = 0;
let pceTestPlayStaticServer = null;
let pceTestPlayStaticPort = null;
let pceTestPlayStaticRoots = null;
let editorControlService = null;
let editorControlServer = null;
let latestLogSnapshot = { entries: [] };
let isQuitting = false;
let forcedQuitTimer = null;

const MAIN_WINDOW_DEFAULT_BOUNDS = { width: 1280, height: 860 };
const MAIN_WINDOW_MIN_BOUNDS = { width: 960, height: 640 };
const WINDOW_STATE_FILE = 'window-state.json';

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function normalizeWindowBounds(bounds = {}) {
  const width = Math.max(
    MAIN_WINDOW_MIN_BOUNDS.width,
    Math.min(3840, Math.round(Number(bounds.width) || MAIN_WINDOW_DEFAULT_BOUNDS.width)),
  );
  const height = Math.max(
    MAIN_WINDOW_MIN_BOUNDS.height,
    Math.min(2160, Math.round(Number(bounds.height) || MAIN_WINDOW_DEFAULT_BOUNDS.height)),
  );
  return { width, height };
}

function readMainWindowBounds() {
  try {
    const statePath = getWindowStatePath();
    if (!fs.existsSync(statePath)) {
      return { ...MAIN_WINDOW_DEFAULT_BOUNDS };
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return normalizeWindowBounds(parsed?.mainWindow || parsed || {});
  } catch (_) {
    return { ...MAIN_WINDOW_DEFAULT_BOUNDS };
  }
}

function saveMainWindowBounds(win) {
  if (!win || win.isDestroyed?.()) return false;
  try {
    const bounds = typeof win.getNormalBounds === 'function'
      ? win.getNormalBounds()
      : win.getBounds();
    const statePath = getWindowStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      mainWindow: normalizeWindowBounds(bounds),
    }, null, 2), 'utf-8');
    return true;
  } catch (_) {
    return false;
  }
}

function closeDevToolsForWindow(win) {
  if (!win || win.isDestroyed?.()) return false;
  const contents = win.webContents;
  if (!contents || typeof contents.closeDevTools !== 'function') return false;

  try {
    if (typeof contents.isDevToolsOpened === 'function' && !contents.isDevToolsOpened()) {
      return false;
    }
    contents.closeDevTools();
    return true;
  } catch (_) {
    return false;
  }
}

function getTrackedWindows() {
  const tracked = [
    mainWindow,
    setupWindow,
    testPlayWindow,
    testPlaySettingsWindow,
    logWindow,
  ];
  const all = typeof BrowserWindow.getAllWindows === 'function'
    ? BrowserWindow.getAllWindows()
    : [];
  const seen = new Set();
  return [...tracked, ...all].filter((win) => {
    if (!win || win.isDestroyed?.()) return false;
    if (seen.has(win)) return false;
    seen.add(win);
    return true;
  });
}

function closeOpenDevTools() {
  return getTrackedWindows()
    .map(closeDevToolsForWindow)
    .filter(Boolean).length;
}

function registerWindowCloseDevTools(win) {
  if (win && typeof win.on === 'function') {
    win.on('close', () => {
      closeDevToolsForWindow(win);
    });
  }
  return win;
}

function closeWindowIfOpen(win) {
  if (!win || win.isDestroyed?.()) return false;
  try {
    closeDevToolsForWindow(win);
    win.close();
    return true;
  } catch (_) {
    return false;
  }
}

function closeAuxiliaryWindows() {
  [
    setupWindow,
    testPlayWindow,
    testPlaySettingsWindow,
    logWindow,
  ].forEach(closeWindowIfOpen);
}

function stopEditorControlServer() {
  if (!editorControlServer) return false;
  const server = editorControlServer;
  editorControlServer = null;
  try {
    void server.stop();
    return true;
  } catch (_) {
    return false;
  }
}

function prepareForAppQuit() {
  isQuitting = true;
  closeOpenDevTools();
  saveMainWindowBounds(mainWindow);
  closeAuxiliaryWindows();
  stopEditorControlServer();
}

function requestAppQuit(options = {}) {
  const forceExitAfterMs = Number(options.forceExitAfterMs ?? 2500);
  const exitCode = Number.isInteger(options.exitCode) ? options.exitCode : 0;

  prepareForAppQuit();
  app.quit();

  if (forceExitAfterMs > 0 && process.versions?.electron) {
    if (forcedQuitTimer) {
      clearTimeout(forcedQuitTimer);
    }
    forcedQuitTimer = setTimeout(() => {
      process.exit(exitCode);
    }, forceExitAfterMs);
    forcedQuitTimer.unref?.();
  }

  return { ok: true };
}

function installProcessTerminationHandlers() {
  if (!process.versions?.electron) return;
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.once(signal, () => {
      requestAppQuit({ exitCode: 0, forceExitAfterMs: 2500 });
    });
  });
}

installProcessTerminationHandlers();

function createWindow() {
  const bounds = readMainWindowBounds();
  mainWindow = registerWindowCloseDevTools(new BrowserWindow({
    ...bounds,
    backgroundColor: '#101217',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // renderer / plugin が window.open() で開く補助ウィンドウ（VN プレビューなど）は
  // メニューバーを出さない素のコンテンツウィンドウとして許可する。
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      backgroundColor: '#05070a',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    },
  }));

  mainWindow.webContents.on('did-create-window', (childWindow) => {
    try { childWindow.removeMenu(); } catch (_) {}
  });

  mainWindow.on('close', () => {
    saveMainWindowBounds(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!isQuitting && process.platform !== 'darwin') {
      app.quit();
    }
  });
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

appDiagnostics.subscribe((diagnostic) => {
  sendToRenderer('app-diagnostic', diagnostic);
});

function sendToLogWindow(channel, payload) {
  if (!logWindow || logWindow.isDestroyed()) {
    return;
  }
  logWindow.webContents.send(channel, payload);
}

function normalizeLogEntry(entry = {}) {
  return {
    source: String(entry.source || 'app'),
    text: String(entry.text || ''),
    level: String(entry.level || 'info'),
    timestamp: Number(entry.timestamp) || Date.now(),
  };
}

function normalizeLogSnapshot(snapshot = {}) {
  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries.map(normalizeLogEntry).slice(-4000)
    : [];
  return { entries };
}

function openLogWindow(snapshot = latestLogSnapshot) {
  latestLogSnapshot = normalizeLogSnapshot(snapshot);

  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    sendToLogWindow('log:snapshot', latestLogSnapshot);
    return { ok: true, reused: true };
  }

  logWindow = registerWindowCloseDevTools(new BrowserWindow({
    width: 920,
    height: 560,
    title: 'Log - PCE Game Editor',
    backgroundColor: '#0b0f16',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'log-viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));
  logWindow.setMenu(null);
  logWindow.setMenuBarVisibility(false);

  logWindow.webContents.on('did-finish-load', () => {
    sendToLogWindow('log:snapshot', latestLogSnapshot);
  });

  logWindow.loadFile(path.join(__dirname, 'renderer', 'log-viewer.html'));
  logWindow.on('closed', () => {
    logWindow = null;
    sendToRenderer('log:windowClosed', {});
  });

  return { ok: true, reused: false };
}

function sendToSetupWindow(channel, payload) {
  if (!setupWindow || setupWindow.isDestroyed()) {
    return;
  }
  setupWindow.webContents.send(channel, payload);
}

function broadcastTestPlaySettings(settings) {
  [testPlayWindow, testPlaySettingsWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('testplay:settings-changed', settings);
    }
  });
}

function collectProjectAssets(projectDir) {
  try {
    return pceAssetManager.listAssets(projectDir).assets;
  } catch (_) {
    return [];
  }
}

function createPluginLogger(pluginId) {
  const emit = (level, message) => {
    const payload = {
      pluginId,
      source: `plugin:${pluginId}`,
      level: level || 'info',
      text: String(message || ''),
    };
    sendToRenderer('plugin-log', payload);
    sendToRenderer('build-log', {
      text: `[${pluginId}] ${payload.text}`,
      level: payload.level,
    });
  };

  return {
    info: (message) => emit('info', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
    debug: (message) => emit('debug', message),
    log: (message) => emit('info', message),
  };
}

const DEFAULT_ASSET_FILE_FILTERS = [
  { name: 'Assets', extensions: ['png', 'bmp', 'webp', 'pal', 'tsx', 'tmx', 'vgm', 'xgm', 'mid', 'midi', 'wav', 'mp3', 'ogg'] },
  { name: 'All Files', extensions: ['*'] },
];

function normalizeDialogFilters(filters) {
  if (!Array.isArray(filters) || filters.length === 0) return DEFAULT_ASSET_FILE_FILTERS;
  const normalized = filters.map((filter) => ({
    name: String(filter?.name || 'Files'),
    extensions: Array.isArray(filter?.extensions)
      ? filter.extensions.map((ext) => String(ext || '').replace(/^\./, '').trim()).filter(Boolean)
      : ['*'],
  })).filter((filter) => filter.extensions.length > 0);
  return normalized.length > 0 ? normalized : DEFAULT_ASSET_FILE_FILTERS;
}

function normalizeDialogProperties(properties) {
  const allowed = new Set(['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles']);
  const values = Array.isArray(properties) ? properties : ['openFile'];
  const normalized = values.map((prop) => String(prop || '').trim()).filter((prop) => allowed.has(prop));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['openFile'];
}

async function pickFile(options = {}) {
  const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
  const result = await dialog.showOpenDialog(owner, {
    title: options?.title ? String(options.title) : undefined,
    properties: normalizeDialogProperties(options?.properties),
    filters: normalizeDialogFilters(options?.filters),
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filePaths: [] };
  }

  const filePaths = result.filePaths;
  const sourcePath = filePaths[0];
  return {
    canceled: false,
    filePaths,
    sourcePath,
    fileName: path.basename(sourcePath),
    ext: path.extname(sourcePath).toLowerCase(),
  };
}

async function invokePluginHookSafe(pluginId, hookName, payload, context = {}) {
  if (!pluginId) return { ok: true, skipped: true };
  const result = await pluginManager.invokeHook(pluginId, hookName, payload, context);
  if (!result.ok) {
    const msg = `[Plugin:${pluginId}] hook ${hookName} failed: ${result.error || 'unknown error'}`;
    sendToRenderer('build-log', { text: msg, level: 'error' });
  }
  return result;
}

async function invokeRendererPluginHook(pluginId, hookName, payload) {
  const projectDir = buildSystem.getProjectDir();
  return pluginManager.invokeRendererHook(pluginId, hookName, payload || {}, {
    coreId: buildSystem.getActiveCoreId(),
    projectDir,
    assets: collectProjectAssets(projectDir),
    logger: createPluginLogger(pluginId),
  });
}

function getMimeForPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

function pluginSupportsRole(plugin, roleId) {
  const role = String(roleId || '').trim();
  if (!role) return false;
  if (plugin && !pluginManager.pluginSupportsCore(plugin, buildSystem.getActiveCoreId())) return false;
  const roles = Array.isArray(plugin?.roles) ? plugin.roles : [];
  return roles.some((entry) => entry?.id === role);
}

function resolvePluginForRole(roleId) {
  let pluginId = buildSystem.getPluginRole(roleId);
  if (!pluginId) {
    const fallback = pluginManager.listPlugins({ coreId: buildSystem.getActiveCoreId(), includeIncompatible: false })
      .filter((p) => p.enabled && pluginSupportsRole(p, roleId))
      .sort((a, b) => {
        const roleA = (a.roles || []).find((role) => role.id === roleId);
        const roleB = (b.roles || []).find((role) => role.id === roleId);
        const orderA = Number(roleA?.order ?? 1000);
        const orderB = Number(roleB?.order ?? 1000);
        if (orderA !== orderB) return orderA - orderB;
        return String(a.name || a.id).localeCompare(String(b.name || b.id), 'ja');
      })[0];
    if (fallback) {
      pluginId = fallback.id;
      try {
        buildSystem.setPluginRole(roleId, pluginId);
      } catch (err) {
        appDiagnostics.report({
          source: 'plugin',
          code: 'plugin-role-save-failed',
          level: 'error',
          error: err,
          details: { roleId, pluginId },
        });
      }
    }
  }
  return pluginId || '';
}

function resolvePluginAssetPath(pluginId, relativePath) {
  const pluginDir = pluginManager.getPluginDirectory(pluginId);
  if (!pluginDir) {
    throw new Error(`plugin directory not found: ${pluginId}`);
  }

  const root = path.resolve(pluginDir);
  const target = path.resolve(root, String(relativePath || ''));
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`invalid plugin asset path: ${relativePath}`);
  }
  if (!fs.existsSync(target)) {
    throw new Error(`plugin asset not found: ${relativePath}`);
  }
  return target;
}

function focusExistingTestPlayWindow() {
  if (testPlayWindow && !testPlayWindow.isDestroyed()) {
    testPlayWindow.focus();
    return true;
  }
  return false;
}

function stopPceTestPlayStaticServer() {
  if (!pceTestPlayStaticServer) return;
  const server = pceTestPlayStaticServer;
  pceTestPlayStaticServer = null;
  pceTestPlayStaticPort = null;
  pceTestPlayStaticRoots = null;
  closePceTestPlayStaticServer(server);
}

async function startPceTestPlayStaticServer({ romPath, runtime, systemCardPath = null }) {
  const roots = createPceTestPlayStaticRoots({ romPath, runtime, systemCardPath });
  if (pceTestPlayStaticServer && pceTestPlayStaticPort && samePceTestPlayStaticRoots(pceTestPlayStaticRoots, roots)) {
    return { port: pceTestPlayStaticPort };
  }
  stopPceTestPlayStaticServer();
  const started = await createPceTestPlayStaticServer({ roots, preferredPort: 18730, maxOffset: 50 });
  pceTestPlayStaticServer = started.server;
  pceTestPlayStaticPort = started.port;
  pceTestPlayStaticRoots = started.roots;
  return { port: started.port };
}

async function makePceTestPlayContext(options = {}) {
  const romPath = options.romPath || null;
  if (!romPath || !fs.existsSync(romPath)) {
    return {
      ok: false,
      error: 'ROM が未生成です。Build を成功させてから Test Play を実行してください。',
      needsBuild: true,
    };
  }

  const pceSetupManager = buildSystem.getPceSetupManager();
  const emulatorJsDir = pceSetupManager.getEmulatorJsDir();
  if (!emulatorJsDir) {
    return {
      ok: false,
      error: 'EmulatorJS / mednafen_pce core is not configured. Setup で取得またはパス指定してください。',
      needsSetup: true,
    };
  }

  const runtime = resolvePceEmulatorJsRuntime(emulatorJsDir);
  if (!fs.existsSync(runtime.loaderPath)) {
    return {
      ok: false,
      error: `EmulatorJS loader.js が見つかりません: ${runtime.loaderPath}`,
      needsSetup: true,
    };
  }
  if (!runtime.coreAsset) {
    return {
      ok: false,
      error: `EmulatorJS mednafen_pce core が見つかりません: ${path.join(runtime.dataDir, 'cores')}`,
      needsSetup: true,
    };
  }

  const isCdMedia = path.extname(romPath).toLowerCase() === '.cue';
  const systemCardPath = isCdMedia ? pceSetupManager.getPceCdSystemCardPath() : null;
  if (isCdMedia && !systemCardPath) {
    return {
      ok: false,
      error: 'SUPER CD-ROM2 Test Play requires System Card ROM. Setup で System Card パスを指定してください。',
      needsSetup: true,
    };
  }
  const projectConfig = buildSystem.loadProjectConfig();
  const isCdVisualNovel = isCdMedia
    && projectConfig?.pluginRoles?.builder === 'pce-visual-novel-builder';
  if (isCdVisualNovel && projectConfig?.cd?.systemCardProfile !== systemCardProfile.SYSTEM_CARD_PROFILE_JP_V3) {
    return {
      ok: false,
      error: 'CD visual novel requires cd.systemCardProfile: "jp-v3". Build the current project before Test Play.',
      needsBuild: true,
    };
  }
  if (isCdVisualNovel) {
    const profile = systemCardProfile.inspectSystemCardFile(systemCardPath);
    if (!profile.ok || profile.profile !== systemCardProfile.SYSTEM_CARD_PROFILE_JP_V3) {
      return {
        ok: false,
        error: `Test Play requires a Japanese Super System Card 3.0 ROM for profile jp-v3: ${profile.error}`,
        needsSetup: true,
      };
    }
  }

  const bundle = isCdMedia ? cdBundle.createCdTestPlayBundle(romPath) : null;
  const servedRomPath = bundle?.zipPath || romPath;
  const staticServer = await startPceTestPlayStaticServer({ romPath: servedRomPath, runtime, systemCardPath });
  const staticBaseUrl = `http://127.0.0.1:${staticServer.port}`;
  const romStat = fs.statSync(servedRomPath);
  const mediaRoot = path.dirname(servedRomPath);
  const launchId = `${Date.now()}-${++pceTestPlayLaunchSerial}`;
  return {
    ok: true,
    context: {
      romPath,
      romUrl: `${staticBaseUrl}/rom/${encodeURIComponent(path.basename(servedRomPath))}`,
      isCdMedia,
      mediaRootUrl: `${staticBaseUrl}/rom/`,
      systemCardUrl: systemCardPath ? `${staticBaseUrl}/bios/${PCE_CD_SYSTEM_CARD_EMULATOR_NAME}` : '',
      cdBundlePath: bundle?.zipPath || '',
      cdBundleEntryName: bundle?.entryName || '',
      romMtimeMs: romStat.mtimeMs,
      romSize: romStat.size,
      gameId: `${path.basename(romPath)}-${romStat.mtimeMs}-${romStat.size}-${launchId}`,
      mediaRoot,
      emulatorJsDir: runtime.rootDir,
      emulatorJsUrl: `${staticBaseUrl}/emulatorjs/`,
      emulatorJsDataDir: runtime.dataDir,
      emulatorJsDataUrl: `${staticBaseUrl}/emulatorjs-data/`,
      emulatorJsLoaderUrl: `${staticBaseUrl}/emulatorjs-data/loader.js`,
      core: 'pce',
      coreAsset: runtime.coreAsset,
    },
  };
}

async function openWasmTestPlayWindow(options = {}) {
  const pluginId = String(options.pluginId || 'pce-standard-emulator');
  if (pluginId === 'pce-standard-emulator') {
    if (testPlayWindow && !testPlayWindow.isDestroyed()) {
      testPlayWindow.destroy();
      testPlayWindow = null;
      currentTestPlayContext = null;
      stopPceTestPlayStaticServer();
    }
    const contextResult = await makePceTestPlayContext(options);
    if (!contextResult.ok) return { opened: false, ...contextResult };
    currentTestPlayContext = contextResult.context;
  }
  if (focusExistingTestPlayWindow()) {
    if (pluginId === 'pce-standard-emulator') {
      const htmlPath = resolvePluginAssetPath(pluginId, 'testplay.html');
      testPlayWindow.loadFile(htmlPath);
    }
    return { opened: true, reused: true };
  }

  const htmlPath = resolvePluginAssetPath(pluginId, 'testplay.html');
  const preloadPath = resolvePluginAssetPath(pluginId, 'testplay-preload.js');

  testPlayWindow = registerWindowCloseDevTools(new BrowserWindow({
    width: 800,
    height: 720,
    title: pluginId === 'pce-standard-emulator' ? 'PCE Test Play' : 'Test Play - PCE Game Editor',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));
  const romQuery = options.romPath ? `?romPath=${encodeURIComponent(options.romPath)}` : '';
  if (pluginId === 'pce-standard-emulator') {
    testPlayWindow.loadFile(htmlPath);
  } else {
    testPlayWindow.loadFile(htmlPath, { search: romQuery });
  }
  testPlayWindow.on('closed', () => {
    testPlayWindow = null;
    currentTestPlayContext = null;
    if (pluginId === 'pce-standard-emulator') stopPceTestPlayStaticServer();
  });
  return { opened: true, reused: false };
}

function createTestPlayHostApi(pluginId) {
  return {
    openWasmWindow: (options = {}) => openWasmTestPlayWindow({
      ...options,
      pluginId: options.pluginId || pluginId,
    }),
    getProjectConfig: () => buildSystem.loadProjectConfig(),
    getSystemCardProfileStatus: () => systemCardProfile.inspectSystemCardFile(
      buildSystem.getPceSetupManager().getPceCdSystemCardPath(),
    ),
    launchExternalEmulator: (options = {}) => launchExternalEmulator(options),
    getEmulatorStatus: () => buildSystem.getPceSetupManager().getStatus().emulatorJs,
  };
}

function resolveMacAppBundleExecutable(appPath) {
  if (process.platform !== 'darwin' || path.extname(appPath).toLowerCase() !== '.app') return '';
  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  const candidates = [];
  try {
    const plist = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf-8');
    const match = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/);
    if (match?.[1]) candidates.push(match[1]);
  } catch (err) {
    appDiagnostics.report({
      source: 'testplay',
      code: 'mac-app-plist-read-failed',
      level: 'warn',
      error: err,
      details: { appPath },
    });
  }
  candidates.push(path.basename(appPath, '.app'), path.basename(appPath, '.app').toLowerCase(), 'geargrafx');

  for (const name of Array.from(new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean)))) {
    const candidate = path.join(macosDir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {}
  }
  return '';
}

function resolveExternalEmulatorLaunchTarget(executablePath, args = []) {
  const appExecutable = resolveMacAppBundleExecutable(executablePath);
  if (appExecutable) return { command: appExecutable, args };
  const isMacAppBundle = process.platform === 'darwin' && path.extname(executablePath).toLowerCase() === '.app';
  if (isMacAppBundle) return { command: 'open', args: [executablePath, '--args', ...args] };
  return { command: executablePath, args };
}

function launchExternalEmulator(options = {}) {
  const executablePath = String(options.executablePath || '').trim();
  const args = Array.isArray(options.args)
    ? options.args.map((arg) => String(arg))
    : [];

  if (!executablePath) {
    return { ok: false, error: '外部エミュレーターの起動パスが未設定です。Project Settings で設定してください。' };
  }
  if (!fs.existsSync(executablePath)) {
    return { ok: false, error: `外部エミュレーターが見つかりません: ${executablePath}` };
  }

  const launchTarget = resolveExternalEmulatorLaunchTarget(executablePath, args);

  try {
    const proc = spawn(launchTarget.command, launchTarget.args, {
      cwd: buildSystem.getProjectDir(),
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    return {
      ok: true,
      launched: true,
      pid: proc.pid || null,
      command: launchTarget.command,
      args: launchTarget.args,
    };
  } catch (err) {
    return { ok: false, error: `外部エミュレーター起動に失敗しました: ${String(err?.message || err)}` };
  }
}

function syncProjectPluginRoleState() {
  const roles = buildSystem.getPluginRoles();
  const synced = [];
  const failed = [];

  Object.entries(roles || {}).forEach(([roleId, pluginId]) => {
    if (!roleId || !pluginId) return;
    const result = pluginManager.setExclusiveRoleSelection(roleId, pluginId, { coreId: buildSystem.getActiveCoreId() });
    if (result?.ok) {
      synced.push({
        roleId,
        pluginId,
        changedIds: Array.isArray(result.changedIds) ? result.changedIds : [],
      });
    } else {
      failed.push({
        roleId,
        pluginId,
        error: result?.error || 'plugin role sync failed',
      });
    }
  });

  return { ok: failed.length === 0, synced, failed };
}

function getCodeRoot() {
  return buildSystem.getProjectDir();
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return;
    }
    shell.openExternal(parsed.toString());
  } catch (_err) {
  }
}

function resolveUnderCodeRoot(relativePath = '') {
  const { root: codeRoot, absPath } = resolveUnderRoot(getCodeRoot(), relativePath, 'project');
  return { codeRoot, absPath };
}

function readCodeTree(absDir, codeRoot) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, 'ja');
    });

  return entries.map((entry) => {
    const fullPath = path.join(absDir, entry.name);
    const relPath = path.relative(codeRoot, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      return {
        type: 'directory',
        name: entry.name,
        path: relPath,
        children: readCodeTree(fullPath, codeRoot),
      };
    }
    return {
      type: 'file',
      name: entry.name,
      path: relPath,
      size: fs.statSync(fullPath).size,
    };
  });
}

const CODE_MEDIA_MIME_BY_EXT = {
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

function normalizeCodeEncoding(value) {
  const key = String(value || 'auto').trim().toLowerCase().replace(/[-\s]/g, '_');
  if (key === 'utf8' || key === 'utf_8') return 'utf8';
  if (key === 'sjis' || key === 'shift_jis' || key === 'cp932') return 'shift_jis';
  return 'auto';
}

function isUtf8Buffer(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch (_err) {
    return false;
  }
}

function decodeCodeBuffer(buffer, requestedEncoding = 'auto') {
  const requested = normalizeCodeEncoding(requestedEncoding);
  if (requested === 'shift_jis') {
    return { content: iconv.decode(buffer, 'cp932'), encoding: 'shift_jis' };
  }
  if (requested === 'utf8') {
    return { content: buffer.toString('utf-8').replace(/^\uFEFF/, ''), encoding: 'utf8' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return { content: buffer.toString('utf-8').replace(/^\uFEFF/, ''), encoding: 'utf8' };
  }
  if (isUtf8Buffer(buffer)) {
    return { content: buffer.toString('utf-8'), encoding: 'utf8' };
  }
  return { content: iconv.decode(buffer, 'cp932'), encoding: 'shift_jis' };
}

function encodeCodeContent(content, requestedEncoding = 'utf8') {
  const encoding = normalizeCodeEncoding(requestedEncoding);
  if (encoding === 'shift_jis') {
    return { buffer: iconv.encode(String(content ?? ''), 'cp932'), encoding: 'shift_jis' };
  }
  return { buffer: Buffer.from(String(content ?? ''), 'utf-8'), encoding: 'utf8' };
}

function readCodeFilePayload(absPath, relativePath, options = {}) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = CODE_MEDIA_MIME_BY_EXT[ext];
  const data = fs.readFileSync(absPath);
  if (mime) {
    return {
      ok: true,
      path: relativePath || '',
      media: true,
      previewKind: mime.startsWith('image/') ? 'image' : 'audio',
      mime,
      size: data.length,
      dataUrl: `data:${mime};base64,${data.toString('base64')}`,
    };
  }
  if (data.includes(0)) {
    return {
      ok: true,
      path: relativePath || '',
      media: true,
      previewKind: 'binary',
      mime: 'application/octet-stream',
      size: data.length,
    };
  }
  const decoded = decodeCodeBuffer(data, options.encoding);
  return {
    ok: true,
    path: relativePath || '',
    content: decoded.content,
    encoding: decoded.encoding,
  };
}

function resultOrThrow(result) {
  if (result && result.ok === false) {
    throw new Error(result.error || result.message || 'operation failed');
  }
  return result;
}

async function runPluginGeneratorAndWrite(id) {
  const projectDir = buildSystem.getProjectDir();
  const allAssets = collectProjectAssets(projectDir);
  const genResult = await pluginManager.runGenerator(id, allAssets, {
    coreId: buildSystem.getActiveCoreId(),
    projectDir,
    assets: allAssets,
    logger: createPluginLogger(id),
  });
  if (!genResult.ok) {
    return genResult;
  }
  if (typeof genResult.sourceCode === 'string') {
    const srcPath = path.join(projectDir, 'src', 'main.c');
    fs.mkdirSync(path.dirname(srcPath), { recursive: true });
    fs.writeFileSync(srcPath, genResult.sourceCode, 'utf-8');
    return { ok: true, srcPath, ...genResult };
  }
  return { ok: true, ...genResult };
}

async function openTestPlayWithPlugin(romPath) {
  const emulatorPluginId = resolvePluginForRole('testplay');
  if (!emulatorPluginId) {
    return { opened: false, error: '有効な Emulator プラグインが未設定です' };
  }
  if (!pluginManager.isPluginEnabled(emulatorPluginId)) {
    return { opened: false, error: `Emulator プラグイン "${emulatorPluginId}" は無効です` };
  }
  const emulatorMeta = pluginManager.listPlugins({ coreId: buildSystem.getActiveCoreId(), includeIncompatible: true }).find((p) => p.id === emulatorPluginId);
  if (!pluginSupportsRole(emulatorMeta, 'testplay')) {
    return { opened: false, error: `Emulator プラグイン "${emulatorPluginId}" は testplay role ではありません` };
  }

  const hookResult = await invokePluginHookSafe(
    emulatorPluginId,
    'onTestPlay',
    {
      romPath: romPath || null,
      projectDir: buildSystem.getProjectDir(),
    },
    {
      coreId: buildSystem.getActiveCoreId(),
      projectDir: buildSystem.getProjectDir(),
      logger: createPluginLogger(emulatorPluginId),
      testPlay: createTestPlayHostApi(emulatorPluginId),
    }
  );

  const handledByHook = Boolean(hookResult.ok && (
    hookResult.handled || (hookResult.result && hookResult.result.handled)
  ));
  if (handledByHook) {
    return { opened: true, reused: false, handledByPlugin: emulatorPluginId };
  }
  if (!hookResult.ok) {
    return { opened: false, error: hookResult.error || 'Emulator フック実行に失敗しました' };
  }

  return openWasmTestPlayWindow({
    romPath: romPath || null,
    pluginId: emulatorPluginId,
  });
}

function getEditorControlService() {
  if (editorControlService) return editorControlService;
  editorControlService = createEditorControlService({
    editor_status: async () => ({
      app: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
      },
      project: buildSystem.getProjectInfo(),
      aiControl: editorControlServer ? editorControlServer.status() : { running: false },
    }),
    project_list: async () => buildSystem.listProjects(),
    project_open: async ({ projectName, projectDir }) => {
      const selectedDir = String(projectDir || '').trim();
      const info = selectedDir
        ? buildSystem.openProject(selectedDir)
        : buildSystem.openProjectByName(String(projectName || '').trim());
      return { ...info, pluginRoleSync: syncProjectPluginRoleState() };
    },
    project_create: async ({ projectName, parentDir, templateId, config, sourceCode }) => {
      const created = buildSystem.createProjectInParent(
        parentDir || buildSystem.getProjectsRootDir(),
        String(projectName || '').trim(),
        config || {},
        sourceCode || null,
        { templateId: templateId || '' },
      );
      return {
        projectDir: created.projectDir,
        projectName: path.basename(created.projectDir),
        pluginRoleSync: syncProjectPluginRoleState(),
      };
    },
    project_config_get: async () => buildSystem.loadProjectConfig(),
    project_config_update: async ({ patch }) => ({ config: buildSystem.saveProjectConfig(patch || {}) }),
    asset_list: async () => pceAssetManager.listAssets(buildSystem.getProjectDir()),
    asset_upsert: async ({ asset }) => ({
      file: 'assets/pce-assets.json',
      ...pceAssetManager.upsertAsset(buildSystem.getProjectDir(), asset || {}),
    }),
    asset_delete: async ({ id }) => ({
      file: 'assets/pce-assets.json',
      ...pceAssetManager.deleteAsset(buildSystem.getProjectDir(), id),
    }),
    code_tree: async ({ path: relPath }) => {
      const { codeRoot, absPath } = resolveUnderCodeRoot(relPath || '');
      if (!fs.existsSync(absPath)) throw new Error(`path not found: ${relPath || ''}`);
      if (!fs.statSync(absPath).isDirectory()) throw new Error('directory path is required');
      return {
        root: codeRoot,
        path: path.relative(codeRoot, absPath).replace(/\\/g, '/'),
        entries: readCodeTree(absPath, codeRoot),
      };
    },
    code_read: async ({ path: relPath }) => {
      const { absPath } = resolveUnderCodeRoot(relPath || '');
      if (!fs.existsSync(absPath)) throw new Error(`file not found: ${relPath || ''}`);
      if (!fs.statSync(absPath).isFile()) throw new Error('file path is required');
      return { path: relPath || '', content: fs.readFileSync(absPath, 'utf-8') };
    },
    code_write: async ({ path: relPath, content }) => {
      const { absPath } = resolveUnderCodeRoot(relPath || '');
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, String(content ?? ''), 'utf-8');
      return { path: relPath || '' };
    },
    plugin_list: async () => ({ plugins: pluginManager.listPlugins({ coreId: buildSystem.getActiveCoreId(), includeIncompatible: true }), roles: buildSystem.getPluginRoles() }),
    plugin_set_role: async ({ roleId, id }) => {
      const syncResult = pluginManager.setExclusiveRoleSelection(roleId, id || null, { coreId: buildSystem.getActiveCoreId() });
      resultOrThrow(syncResult);
      buildSystem.setPluginRole(roleId, id || null);
      return syncResult;
    },
    plugin_run_generator: async ({ id }) => runPluginGeneratorAndWrite(id),
    build_run: async () => runBuildFull(),
    testplay_open: async () => openTestPlayWithPlugin(buildSystem.getLastRomPath()),
    export_rom: async () => handleExportRom(),
    export_html: async () => handleExportHtml(),
  });
  return editorControlService;
}

function getEditorControlServer() {
  if (editorControlServer) return editorControlServer;
  editorControlServer = createEditorControlServer(getEditorControlService(), {
    token: process.env.PCE_EDITOR_CONTROL_TOKEN || undefined,
    port: process.env.PCE_EDITOR_CONTROL_PORT || undefined,
    onLog(entry) {
      sendToRenderer('ai-control-log', entry);
    },
  });
  return editorControlServer;
}

async function maybeAutoStartEditorControlServer() {
  const flag = String(process.env.PCE_EDITOR_CONTROL_AUTOSTART || '').trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(flag)) return;
  try {
    const result = await getEditorControlServer().start({
      port: process.env.PCE_EDITOR_CONTROL_PORT,
    });
    console.log(`[ai-control] listening on ${result.baseUrl || `http://127.0.0.1:${result.port}`}`);
  } catch (err) {
    console.error(`[ai-control] autostart failed: ${err?.message || err}`);
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Projects',
          accelerator: process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O',
          click: () => {
            sendToRenderer('menu:openProjects');
          },
        },
        { type: 'separator' },
        {
          label: 'Setup',
          click: () => {
            sendToRenderer('menu:openSetup');
          },
        },
        { type: 'separator' },
        {
          label: 'Export ROM',
          accelerator: process.platform === 'darwin' ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
          click: async () => {
            const result = await handleExportRom();
            if (result.ok) {
              sendToRenderer('build-log', { text: `ROM をエクスポートしました: ${result.path}`, level: 'info' });
            } else if (!result.canceled) {
              sendToRenderer('build-log', { text: `Export ROM 失敗: ${result.error}`, level: 'error' });
            }
          },
        },
        {
          label: 'Export HTML',
          click: async () => {
            const result = await handleExportHtml();
            if (result.ok) {
              sendToRenderer('build-log', { text: `HTML をエクスポートしました: ${result.path}`, level: 'info' });
              shell.openPath(path.dirname(result.path)).catch(() => {});
            } else if (!result.canceled) {
              sendToRenderer('build-log', { text: `Export HTML 失敗: ${result.error}`, level: 'error' });
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PCE Game Editor',
          click: () => {
            sendToRenderer('menu:openAbout');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function readEmbeddedWasmInfo() {
  const pceSetupManager = buildSystem.getPceSetupManager();
  const emulatorJsDir = pceSetupManager.getEmulatorJsDir();
  if (!emulatorJsDir) {
    return {
      packageVersion: 'not configured',
      buildVersion: 'not configured',
      runtimePath: '',
      coreAsset: '',
    };
  }

  const runtime = resolvePceEmulatorJsRuntime(emulatorJsDir);
  let packageVersion = 'unknown';
  try {
    const pkgPath = path.join(runtime.rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      packageVersion = String(pkgJson.version || 'unknown');
    }
  } catch (_err) {
  }

  return {
    packageVersion,
    buildVersion: runtime.coreAsset || 'missing mednafen_pce core',
    runtimePath: runtime.rootDir,
    dataPath: runtime.dataDir,
    coreAsset: runtime.coreAsset || '',
  };
}

function sanitizeExportFileName(value, fallback = 'rom') {
  const base = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80);
  return base || fallback;
}

ipcMain.handle('fs:openPathInExplorer', async (_event, targetPath, options = {}) => {
  try {
    if (!targetPath) {
      return { ok: false, error: 'path is empty' };
    }
    const normalized = path.resolve(targetPath);
    const finalTarget = options.parentOnly ? path.dirname(normalized) : normalized;
    if (!fs.existsSync(finalTarget)) {
      return { ok: false, error: `path not found: ${finalTarget}` };
    }
    const error = await shell.openPath(finalTarget);
    if (error) {
      return { ok: false, error };
    }
    return { ok: true, path: finalTarget };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('fs:saveRomAs', async (_event, sourcePath) => {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'source ROM not found' };
    }
    const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
    const suggestedName = path.basename(sourcePath);
    const result = await dialog.showSaveDialog(owner, {
      title: 'ビルド済み ROM を保存',
      defaultPath: suggestedName,
      filters: [
        { name: 'PC Engine ROM', extensions: ['pce'] },
        { name: 'PC Engine CD image', extensions: ['cue', 'iso'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    fs.copyFileSync(sourcePath, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:getRoot', async () => {
  try {
    const codeRoot = getCodeRoot();
    fs.mkdirSync(codeRoot, { recursive: true });
    return { ok: true, root: codeRoot };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:list', async (_event, payload) => {
  try {
    const { codeRoot, absPath } = resolveUnderCodeRoot(payload?.path || '');
    if (!fs.existsSync(absPath)) {
      return { ok: false, error: `path not found: ${payload?.path || ''}` };
    }
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'directory path is required' };
    }
    return {
      ok: true,
      root: codeRoot,
      path: path.relative(codeRoot, absPath).replace(/\\/g, '/'),
      entries: readCodeTree(absPath, codeRoot),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:read', async (_event, payload) => {
  try {
    const { absPath } = resolveUnderCodeRoot(payload?.path || '');
    if (!fs.existsSync(absPath)) {
      return { ok: false, error: `file not found: ${payload?.path || ''}` };
    }
    if (!fs.statSync(absPath).isFile()) {
      return { ok: false, error: 'file path is required' };
    }
    return readCodeFilePayload(absPath, payload?.path || '', { encoding: payload?.encoding });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:write', async (_event, payload) => {
  try {
    const { absPath } = resolveUnderCodeRoot(payload?.path || '');
    const encoded = encodeCodeContent(payload?.content, payload?.encoding);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, encoded.buffer);
    return { ok: true, path: payload?.path || '', encoding: encoded.encoding };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:create', async (_event, payload) => {
  try {
    const targetType = String(payload?.type || 'file');
    const { absPath } = resolveUnderCodeRoot(payload?.path || '');
    if (fs.existsSync(absPath)) {
      return { ok: false, error: `already exists: ${payload?.path || ''}` };
    }

    if (targetType === 'directory') {
      fs.mkdirSync(absPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, String(payload?.content ?? ''), 'utf-8');
    }
    return { ok: true, path: payload?.path || '', type: targetType };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:delete', async (_event, payload) => {
  try {
    const { absPath, codeRoot } = resolveUnderCodeRoot(payload?.path || '');
    if (absPath === codeRoot) {
      return { ok: false, error: 'project root は削除できません' };
    }
    if (!fs.existsSync(absPath)) {
      return { ok: false, error: `not found: ${payload?.path || ''}` };
    }
    fs.rmSync(absPath, { recursive: true, force: true });
    return { ok: true, path: payload?.path || '' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('codefs:rename', async (_event, payload) => {
  try {
    const fromPath = String(payload?.fromPath || '').replace(/^[/\\]+/, '');
    const toPath = String(payload?.toPath || '').replace(/^[/\\]+/, '');
    if (!fromPath || !toPath) {
      return { ok: false, error: 'rename path is required' };
    }
    const from = resolveUnderCodeRoot(fromPath);
    const to = resolveUnderCodeRoot(toPath);
    if (from.absPath === from.codeRoot) {
      return { ok: false, error: 'project root はリネームできません' };
    }
    if (!fs.existsSync(from.absPath)) {
      return { ok: false, error: `not found: ${fromPath}` };
    }
    if (fs.existsSync(to.absPath)) {
      return { ok: false, error: `already exists: ${toPath}` };
    }
    fs.mkdirSync(path.dirname(to.absPath), { recursive: true });
    fs.renameSync(from.absPath, to.absPath);
    return { ok: true, fromPath, toPath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('dialog:pickFile', async (_event, options) => pickFile(options || {}));

ipcMain.handle('files:readAsDataUrl', async (_event, sourcePath) => {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'source file not found' };
    }
    const data = fs.readFileSync(sourcePath).toString('base64');
    return { ok: true, dataUrl: `data:${getMimeForPath(sourcePath)};base64,${data}` };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

registerPceAssetIpc({
  ipcMain,
  assetManager: pceAssetManager,
  getProjectDir: () => buildSystem.getProjectDir(),
});

ipcMain.handle('ai-control:start', async (_event, options = {}) => {
  try {
    return { ok: true, ...(await getEditorControlServer().start(options || {})) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('ai-control:stop', async () => {
  try {
    if (!editorControlServer) return { ok: true, stopped: false, running: false };
    return { ok: true, ...(await editorControlServer.stop()) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('ai-control:status', async () => {
  try {
    return { ok: true, ...(editorControlServer ? editorControlServer.status() : { running: false }) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('ai-control:listTools', async () => {
  return { ok: true, tools: getEditorControlService().listTools() };
});

ipcMain.handle('diagnostics:list', async () => ({ ok: true, diagnostics: appDiagnostics.list() }));

registerPluginIpc({
  ipcMain,
  shell,
  fs,
  pluginManager,
  buildSystem,
  invokeRendererPluginHook,
  runPluginGeneratorAndWrite,
});

ipcMain.handle('testplay:getSettings', async () => {
  return testPlaySettings.getTestPlaySettings();
});

ipcMain.handle('testplay:getContext', async () => ({ ok: true, context: currentTestPlayContext }));

ipcMain.handle('testplay:getDefaultSettings', async () => {
  return testPlaySettings.getDefaultTestPlaySettings();
});

ipcMain.handle('testplay:saveSettings', async (_event, settings) => {
  const saved = testPlaySettings.saveTestPlaySettings(settings || {});
  broadcastTestPlaySettings(saved);
  return saved;
});

ipcMain.handle('window:openTestPlaySettings', async () => {
  if (testPlaySettingsWindow && !testPlaySettingsWindow.isDestroyed()) {
    testPlaySettingsWindow.focus();
    return { opened: true, reused: true };
  }
  testPlaySettingsWindow = registerWindowCloseDevTools(new BrowserWindow({
    width: 840,
    height: 760,
    title: 'Test Play Settings - PCE Game Editor',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'testplay-settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));
  testPlaySettingsWindow.loadFile(path.join(__dirname, 'renderer', 'testplay-settings.html'));
  testPlaySettingsWindow.on('closed', () => { testPlaySettingsWindow = null; });
  return { opened: true, reused: false };
});

// ---- Setup window ----
ipcMain.handle('window:openSetup', async () => {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return { opened: true, reused: true };
  }
  setupWindow = registerWindowCloseDevTools(new BrowserWindow({
    width: 720,
    height: 640,
    title: 'Setup - PCE Game Editor',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
  return { opened: true, reused: false };
});

ipcMain.handle('setup:getStatus', async () => {
  return buildSystem.getPceSetupManager().getStatus();
});

ipcMain.handle('setup:getCatalog', async () => {
  return buildSystem.getPceSetupManager().getDownloadCatalog();
});

ipcMain.handle('setup:listVersions', async (_event, { kind } = {}) => {
  return buildSystem.getPceSetupManager().listToolVersions(kind);
});

ipcMain.handle('setup:downloadTool', async (_event, payload = {}) => {
  return buildSystem.getPceSetupManager().downloadTool(payload || {}, (progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:setToolPath', async (_event, { kind, value } = {}) => {
  return buildSystem.getPceSetupManager().setToolPath(kind, value);
});

ipcMain.handle('setup:selectPceCdImage', async () => {
  const owner = (setupWindow && !setupWindow.isDestroyed()) ? setupWindow : mainWindow;
  const result = await dialog.showOpenDialog(owner, {
    title: 'PCE-CD ISO/CUE/BIN を選択',
    properties: ['openFile'],
    filters: [
      { name: 'PCE-CD Images', extensions: ['iso', 'cue', 'bin', 'img'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, canceled: true, filePaths: [] };
  }
  const sourcePath = result.filePaths[0];
  return {
    ok: true,
    canceled: false,
    sourcePath,
    filePaths: result.filePaths,
    fileName: path.basename(sourcePath),
  };
});

ipcMain.handle('setup:selectPceSystemCard', async () => {
  const owner = (setupWindow && !setupWindow.isDestroyed()) ? setupWindow : mainWindow;
  const result = await dialog.showOpenDialog(owner, {
    title: 'System Card ROM を選択',
    properties: ['openFile'],
    filters: [
      { name: 'System Card ROM', extensions: ['pce', 'bin', 'rom'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, canceled: true, filePaths: [] };
  }
  const sourcePath = result.filePaths[0];
  return {
    ok: true,
    canceled: false,
    sourcePath,
    filePaths: result.filePaths,
    fileName: path.basename(sourcePath),
  };
});

ipcMain.handle('setup:extractPceCdIpl', async (_event, payload = {}) => {
  return buildSystem.getPceSetupManager().extractPceCdIpl(payload || {});
});

// ---- Test play window ----
ipcMain.handle('window:openTestPlay', async (_event, romPath) => {
  return openTestPlayWithPlugin(romPath);
});

// ---- Build IPC ----
ipcMain.handle('build:generateProject', async (_event, sourceCode, config) => {
  try {
    const result = await buildSystem.generateProject(sourceCode, config);
    return { ok: true, projectDir: result.projectDir };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// src/main.c を上書きせずプロジェクト構造だけ整備する (プラグインビルド用)
ipcMain.handle('build:generateStructureOnly', async (_event, config) => {
  try {
    const result = buildSystem.generateProjectStructureOnly(config);
    return { ok: true, projectDir: result.projectDir };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// ── ビルド共通ロジック ──────────────────────────────────────────────────────

async function runBuildFull(options = {}) {
  return runPceBuildFull(options);
}

async function runPceBuildFull(options = {}) {
  try {
    const projectDir = buildSystem.getProjectDir();
    let config = buildSystem.loadProjectConfig();
    const builderPluginId = resolvePluginForRole('builder');
    if (!builderPluginId) {
      return { success: false, error: '有効な PCE Build プラグインが未設定です。Plugins 画面で有効化してください。' };
    }
    if (!pluginManager.isPluginEnabled(builderPluginId)) {
      return { success: false, error: `Build プラグイン "${builderPluginId}" は無効です` };
    }
    const builderMeta = pluginManager.listPlugins({ coreId: 'pc-engine', includeIncompatible: true }).find((p) => p.id === builderPluginId);
    if (!pluginSupportsRole(builderMeta, 'builder')) {
      return { success: false, error: `Build プラグイン "${builderPluginId}" は pc-engine builder role ではありません` };
    }

    const assets = collectProjectAssets(projectDir);
    const pluginContext = {
      coreId: 'pc-engine',
      projectDir,
      assets,
      logger: createPluginLogger(builderPluginId),
    };
    const buildStartResult = await invokePluginHookSafe(builderPluginId, 'onBuildStart', {
      projectDir,
      toolchain: config.toolchain,
      toolchainPath: buildSystem.getPceSetupManager().getToolchainPath(config.toolchain),
    }, pluginContext);
    if (!buildStartResult?.ok) {
      const failed = { success: false, error: buildStartResult?.error || `Build plugin onBuildStart failed: ${builderPluginId}` };
      sendToRenderer('build-end', failed);
      return failed;
    }
    config = buildSystem.loadProjectConfig();

    const result = await buildSystem.buildProject((line, level) => {
      sendToRenderer('build-log', { text: line, level: level || 'info' });
      void pluginManager.invokeHook(builderPluginId, 'onBuildLog', {
        line,
        level: level || 'info',
      }, pluginContext).catch(() => {});
    }, {
      ...options,
      config,
    });

    if (result.success) {
      await invokePluginHookSafe(builderPluginId, 'onBuildEnd', result, pluginContext);
    } else {
      await invokePluginHookSafe(builderPluginId, 'onBuildError', {
        error: result.error || 'build failed',
        result,
      }, pluginContext);
    }
    sendToRenderer('build-end', result);
    return result;
  } catch (err) {
    const r = { success: false, error: err.message || String(err) };
    sendToRenderer('build-end', r);
    return r;
  }
}

// ── Export ハンドラ ─────────────────────────────────────────────────────────

async function handleExportRom() {
  const romPath = buildSystem.getLastRomPath();
  if (!romPath || !fs.existsSync(romPath)) {
    return { ok: false, error: 'エクスポートできるビルド済み PCE メディアがありません。先に Build を実行してください。' };
  }

  let media;
  try {
    media = pceExport.preparePceExportMedia(romPath);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }

  const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
  let suggested = path.basename(romPath);
  try {
    const cfg = buildSystem.loadProjectConfig();
    const projectName = cfg?.title || cfg?.romName || cfg?.name || buildSystem.getProjectInfo()?.projectName;
    if (projectName) suggested = `${sanitizeExportFileName(projectName, 'rom')}.pce`;
  } catch (err) {
    appDiagnostics.report({
      source: 'export',
      code: 'export-project-name-read-failed',
      level: 'warn',
      error: err,
      details: { mediaType: 'hucard' },
    });
  }

  const result = await dialog.showSaveDialog(owner, {
    title: 'HuCard ROM をエクスポート',
    defaultPath: suggested,
    filters: [
      { name: 'PC Engine HuCard ROM', extensions: ['pce'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, media.buffer);
  return { ok: true, path: result.filePath };
}

async function handleExportHtml() {
  const romPath = buildSystem.getLastRomPath();
  if (!romPath || !fs.existsSync(romPath)) {
    return { ok: false, error: 'エクスポートできるビルド済み PCE メディアがありません。先に Build を実行してください。' };
  }

  let media;
  try {
    media = pceExport.preparePceExportMedia(romPath);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }

  const pceSetupManager = buildSystem.getPceSetupManager();
  const emulatorJsDir = pceSetupManager.getEmulatorJsDir();
  if (!emulatorJsDir) {
    return {
      ok: false,
      needsSetup: true,
      error: 'EmulatorJS / mednafen_pce core is not configured. Setup で取得またはパス指定してください。',
    };
  }

  const runtime = resolvePceEmulatorJsRuntime(emulatorJsDir);
  if (!fs.existsSync(runtime.loaderPath)) {
    return { ok: false, needsSetup: true, error: `EmulatorJS loader.js が見つかりません: ${runtime.loaderPath}` };
  }
  if (!runtime.coreAsset) {
    return { ok: false, needsSetup: true, error: `EmulatorJS mednafen_pce core が見つかりません: ${path.join(runtime.dataDir, 'cores')}` };
  }

  // 保存先 HTML ファイルを選択（シングルファイル・サーバー不要）
  const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
  let suggested = `${sanitizeExportFileName(path.basename(romPath, path.extname(romPath)), 'rom')}.html`;
  try {
    const cfg = buildSystem.loadProjectConfig();
    const projectName = cfg?.title || cfg?.romName || cfg?.name || buildSystem.getProjectInfo()?.projectName;
    if (projectName) suggested = `${sanitizeExportFileName(projectName, 'rom')}.html`;
  } catch (err) {
    appDiagnostics.report({
      source: 'export',
      code: 'export-project-name-read-failed',
      level: 'warn',
      error: err,
      details: { mediaType: 'html' },
    });
  }

  const saveResult = await dialog.showSaveDialog(owner, {
    title: 'HTML をエクスポート（スタンドアロン・サーバー不要）',
    defaultPath: suggested,
    filters: [{ name: 'HTML ファイル', extensions: ['html'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };

  let emulatorAssets;
  try {
    emulatorAssets = pceExport.collectPceEmulatorJsAssets(runtime);
  } catch (err) {
    return { ok: false, needsSetup: true, error: String(err?.message || err) };
  }

  const html = pceExport.generatePceExportHtml({
    media,
    emulatorAssets,
    appVersion: electronPackageJson.version,
    appBuildNumber: appBuildMeta.buildNumber,
    appBuildAt: appBuildMeta.buildAt,
  });
  fs.writeFileSync(saveResult.filePath, html, 'utf-8');

  return { ok: true, path: saveResult.filePath };
}

async function handleExportVnIrodoriBatch(payload = {}) {
  let projectName = 'pce-vn';
  try {
    const cfg = buildSystem.loadProjectConfig();
    projectName = cfg?.title || cfg?.romName || cfg?.name || buildSystem.getProjectInfo()?.projectName || projectName;
  } catch (err) {
    appDiagnostics.report({
      source: 'export',
      code: 'irodori-project-name-read-failed',
      level: 'warn',
      error: err,
    });
  }
  const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
  const defaultPath = `${sanitizeExportFileName(projectName, 'pce-vn')}_irodori_voice_batches.zip`;
  return exportIrodoriBatchZip({
    doc: payload?.doc || {},
    assetIds: Array.isArray(payload?.assetIds) ? payload.assetIds : [],
    defaultPath,
    owner,
    showSaveDialog: (dialogOwner, options) => dialog.showSaveDialog(dialogOwner, options),
    createStoredZipBuffer: (entries) => cdBundle.createStoredZipBuffer(entries),
    writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data),
  });
}

ipcMain.handle('build:run', async (_event, options = {}) => {
  return runBuildFull({
    skipClean: Boolean(options?.skipClean),
  });
});

ipcMain.handle('export:rom', async () => {
  return handleExportRom();
});

ipcMain.handle('export:html', async () => {
  return handleExportHtml();
});

ipcMain.handle('vn:exportIrodoriBatch', async (_event, payload = {}) => {
  return handleExportVnIrodoriBatch(payload);
});

ipcMain.handle('vn:inspectIrodoriVoiceAssignments', async (_event, payload = {}) => {
  try {
    return {
      ok: true,
      ...inspectIrodoriVoiceAssignments({
        manifestPath: payload?.manifestPath || payload?.sourcePath || '',
        doc: payload?.doc || {},
        assets: Array.isArray(payload?.assets) ? payload.assets : [],
      }),
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle('log:openWindow', async (_event, snapshot) => {
  return openLogWindow(snapshot || {});
});

ipcMain.handle('log:syncWindow', async (_event, snapshot) => {
  latestLogSnapshot = normalizeLogSnapshot(snapshot || {});
  sendToLogWindow('log:snapshot', latestLogSnapshot);
  return { ok: true };
});

ipcMain.handle('log:appendEntry', async (_event, entry) => {
  const normalized = normalizeLogEntry(entry || {});
  latestLogSnapshot.entries.push(normalized);
  if (latestLogSnapshot.entries.length > 4000) {
    latestLogSnapshot.entries.splice(0, latestLogSnapshot.entries.length - 4000);
  }
  sendToLogWindow('log:entry', normalized);
  return { ok: true };
});

ipcMain.handle('build:getRomPath', async () => {
  return buildSystem.getLastRomPath();
});

ipcMain.handle('build:getProjectConfig', async () => {
  return buildSystem.loadProjectConfig();
});

ipcMain.handle('build:saveProjectConfig', async (_event, patch) => {
  try {
    return { ok: true, config: buildSystem.saveProjectConfig(patch || {}) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('plugins:getRoles', async () => {
  return { ok: true, roles: buildSystem.getPluginRoles() };
});

ipcMain.handle('plugins:getRole', async (_event, { roleId }) => {
  return { ok: true, id: buildSystem.getPluginRole(roleId), roleId };
});

ipcMain.handle('plugins:setRole', async (_event, { roleId, id }) => {
  const syncResult = pluginManager.setExclusiveRoleSelection(roleId, id || null, { coreId: buildSystem.getActiveCoreId() });
  if (!syncResult?.ok) {
    return { ok: false, error: syncResult?.error || 'plugin role selection failed' };
  }
  buildSystem.setPluginRole(roleId, id || null);
  return syncResult;
});

ipcMain.handle('build:getCurrentSource', async () => {
  return buildSystem.loadCurrentSource();
});

ipcMain.handle('build:getSampleCode', async () => {
  const samplePath = buildSystem.getSampleSourceCode();
  return samplePath || null;
});

ipcMain.handle('app:getInfo', async () => {
  const wasm = readEmbeddedWasmInfo();
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    buildNumber: appBuildMeta.buildNumber,
    buildAt: appBuildMeta.buildAt,
    appDescription: electronPackageJson.description || '',
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    embeddedWasm: wasm,
  };
});

ipcMain.handle('project:getCurrent', async () => {
  try {
    return { ok: true, ...buildSystem.getProjectInfo() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('project:getStartupState', async () => {
  try {
    return { ok: true, ...buildSystem.getProjectStartupState() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('project:list', async () => {
  try {
    return { ok: true, ...buildSystem.listProjects() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('project:openExisting', async (_event, payload) => {
  try {
    const projectDir = String(payload?.projectDir || '').trim();
    const projectName = String(payload?.projectName || '').trim();
    if (!projectDir && !projectName) {
      return { ok: false, error: 'project path or name is empty' };
    }
    const info = projectDir
      ? buildSystem.openProject(projectDir)
      : buildSystem.openProjectByName(projectName);
    const pluginRoleSync = syncProjectPluginRoleState();
    return { ok: true, ...info, pluginRoleSync };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('project:createNew', async (_event, payload) => {
  try {
    const projectName = String(payload?.projectName || '').trim();
    if (!projectName) {
      return { ok: false, error: 'project name is empty' };
    }

    const created = buildSystem.createProjectInParent(
      payload?.parentDir || buildSystem.getProjectsRootDir(),
      projectName,
      payload?.config || {},
      payload?.sourceCode || null,
      { templateId: payload?.templateId || '' },
    );
    const pluginRoleSync = syncProjectPluginRoleState();
    return {
      ok: true,
      projectDir: created.projectDir,
      projectName: path.basename(created.projectDir),
      title: payload?.config?.title || payload?.projectName,
      coreId: buildSystem.getCoreIdForProjectDir(created.projectDir),
      defaultProjectDir: buildSystem.getDefaultProjectDir(),
      projectsRootDir: buildSystem.getProjectsRootDir(),
      pluginRoleSync,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('app:quit', async () => {
  return requestAppQuit({ forceExitAfterMs: 2500 });
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized?.()) {
      mainWindow.restore();
    }
    mainWindow.show?.();
    mainWindow.focus();
    return;
  }

  if (app.isReady?.()) {
    createWindow();
  }
});

app.whenReady().then(() => {
  createMenu();
  createWindow();
  maybeAutoStartEditorControlServer();

  app.on('activate', () => {
    if (!isQuitting && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  prepareForAppQuit();
});

app.on('will-quit', () => {
  closeOpenDevTools();
  stopEditorControlServer();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  app.quit();
});

module.exports.__test = {
  DEFAULT_ASSET_FILE_FILTERS,
  normalizeDialogFilters,
  normalizeWindowBounds,
  readMainWindowBounds,
  saveMainWindowBounds,
  normalizeLogEntry,
  normalizeLogSnapshot,
  buildSystem,
  syncProjectPluginRoleState,
  getEditorControlService,
  closeDevToolsForWindow,
  closeOpenDevTools,
  closeWindowIfOpen,
  closeAuxiliaryWindows,
  stopEditorControlServer,
  prepareForAppQuit,
  requestAppQuit,
  resolveUnderCodeRoot,
};
