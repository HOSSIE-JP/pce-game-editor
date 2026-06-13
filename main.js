const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { shell } = require('electron');
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { loadAppConfig, applyPortableMode } = require('game-editor-common');
const { spawn, spawnSync } = require('child_process');
const cdBundle = require('./pce-cd-bundle');
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
  } catch (_) {}
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

const setupManager = require('./setup-manager');
const buildSystem = require('./core-manager');
const rescompManager = require('./rescomp-manager');
const pceAssetManager = require('./pce-asset-manager');
const pluginManager = require('./plugin-manager');
const {
  createEditorControlService,
  createEditorControlServer,
} = require('./editor-control-service');

let mainWindow = null;
let debugWindow = null;
let setupWindow = null;
let testPlayWindow = null;
let testPlaySettingsWindow = null;
let logWindow = null;
let currentTestPlayContext = null;
let pceTestPlayLaunchSerial = 0;
let apiServerProcess = null;
let apiServerPort = null;
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

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

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
    debugWindow,
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
    debugWindow,
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

function stopApiServerSync() {
  if (!apiServerProcess) {
    apiServerPort = null;
    return false;
  }

  const proc = apiServerProcess;
  apiServerProcess = null;
  apiServerPort = null;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return true;
  }

  signalApiServerProcess(proc, 'SIGTERM');
  const forceKillTimer = setTimeout(() => {
    signalApiServerProcess(proc, 'SIGKILL');
  }, 1500);
  forceKillTimer.unref?.();
  return true;
}

function prepareForAppQuit() {
  isQuitting = true;
  closeOpenDevTools();
  saveMainWindowBounds(mainWindow);
  closeAuxiliaryWindows();
  stopEditorControlServer();
  stopApiServerSync();
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

function openDebugWindow(options = {}) {
  const mode = options.mode || 'api';
  const port = options.apiPort || apiServerPort || 8080;

  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.focus();
    return { opened: true, reused: true };
  }

  debugWindow = registerWindowCloseDevTools(new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#101217',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'debug-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));

  const debugFile = mode === 'wasm'
    ? path.join(__dirname, 'renderer', 'debug-wasm.html')
    : path.join(getRepoRoot(), 'frontend', 'debug.html');
  let didFinishLoad = false;

  if (!fs.existsSync(debugFile)) {
    const html = `
      <html><body style="background:#101217;color:#e6edf3;font-family:monospace;padding:16px">
      <h2>Debug Window Load Failed</h2>
      <p>electron debug page was not found.</p>
      <p>Path: ${debugFile}</p>
      </body></html>
    `;
    debugWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return { opened: true, reused: false, missingFile: true };
  }

  debugWindow.webContents.on('did-finish-load', () => {
    didFinishLoad = true;
    const script = `
      (function() {
        var params = new URLSearchParams(window.location.search);
        params.set('mode', ${JSON.stringify(mode)});
        params.set('apiPort', ${JSON.stringify(String(port))});
        history.replaceState(null, '', window.location.pathname + '?' + params.toString());

        var input = document.getElementById('apiBase');
        if (input) {
          input.value = 'http://127.0.0.1:${port}';
        }
        var refresh = document.getElementById('btnRefresh');
        if (refresh) {
          refresh.click();
        }
      })();
    `;
    debugWindow.webContents.executeJavaScript(script).catch(() => {});
  });

  debugWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (didFinishLoad || !isMainFrame) {
      return;
    }
    const html = `
      <html><body style="background:#101217;color:#e6edf3;font-family:monospace;padding:16px">
      <h2>Debug Window Load Failed</h2>
      <p>URL: ${validatedURL || debugFile}</p>
      <p>Code: ${errorCode}</p>
      <p>Message: ${errorDescription}</p>
      <p>File exists: ${fs.existsSync(debugFile)}</p>
      </body></html>
    `;
    debugWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  debugWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  debugWindow.loadFile(debugFile);

  debugWindow.on('closed', () => {
    debugWindow = null;
  });

  return { opened: true, reused: false };
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

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
    title: 'Log - MD Game Editor',
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
  [testPlayWindow, debugWindow, testPlaySettingsWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('testplay:settings-changed', settings);
    }
  });
}

function collectProjectAssets(projectDir) {
  if (buildSystem.getCoreIdForProjectDir(projectDir) === 'pc-engine') {
    try {
      return pceAssetManager.listAssets(projectDir).assets;
    } catch (_) {
      return [];
    }
  }
  let allAssets = [];
  try {
    const defs = rescompManager.listResDefinitions(projectDir);
    (defs.files || []).forEach((f) => {
      (f.entries || []).forEach((e) => allAssets.push({ ...e, resFile: f.file }));
    });
  } catch (_) {}
  return allAssets;
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

function isTempPath(filePath) {
  if (!filePath) return false;
  const tempRoot = path.resolve(os.tmpdir());
  const target = path.resolve(filePath);
  const rel = path.relative(tempRoot, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
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
      try { buildSystem.setPluginRole(roleId, pluginId); } catch (_) {}
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
  const pluginId = String(options.pluginId || 'standard-emulator');
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

async function openApiTestPlayWindow(options = {}) {
  const pluginId = String(options.pluginId || 'standard-api-emulator');
  if (focusExistingTestPlayWindow()) {
    return { opened: true, reused: true, port: apiServerPort };
  }

  const htmlPath = resolvePluginAssetPath(pluginId, 'api-testplay.html');
  const preloadPath = resolvePluginAssetPath(pluginId, 'api-testplay-preload.js');
  const startResult = await startApiServer(options.port || 8080);
  const port = startResult.port || startResult.currentPort || apiServerPort || options.port || 8080;

  testPlayWindow = registerWindowCloseDevTools(new BrowserWindow({
    width: 1120,
    height: 760,
    title: 'Test Play API - PCE Game Editor',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }));

  const search = new URLSearchParams();
  search.set('port', String(port));
  if (options.romPath) search.set('romPath', options.romPath);

  testPlayWindow.loadFile(htmlPath, { search: `?${search.toString()}` });
  testPlayWindow.on('closed', async () => {
    testPlayWindow = null;
    await stopApiServer();
  });

  return { opened: true, reused: false, port, apiStarted: !startResult.alreadyRunning };
}

function createTestPlayHostApi(pluginId) {
  return {
    openWasmWindow: (options = {}) => openWasmTestPlayWindow({
      ...options,
      pluginId: options.pluginId || pluginId,
    }),
    openApiWindow: (options = {}) => openApiTestPlayWindow({
      ...options,
      pluginId: options.pluginId || pluginId,
    }),
    startApiServer: (options = {}) => startApiServer(options.port || 8080),
    stopApiServer,
    isApiServerRunning: () => ({ running: !!apiServerProcess, port: apiServerPort }),
    getEmulatorStatus: () => buildSystem.getActiveCoreId() === 'pc-engine'
      ? buildSystem.getPceSetupManager().getStatus().emulatorJs
      : setupManager.getStatus(),
  };
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

  if (hookResult.ok && hookResult.result && hookResult.result.handled) {
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
    asset_list: async () => buildSystem.getActiveCoreId() === 'pc-engine'
      ? pceAssetManager.listAssets(buildSystem.getProjectDir())
      : rescompManager.listResDefinitions(buildSystem.getProjectDir()),
    asset_add: async ({ file, entry }) => rescompManager.addResEntry(buildSystem.getProjectDir(), file || 'resources.res', entry || {}),
    asset_write_file: async ({ targetPath, dataBase64, dataUrl, sourcePath }) => {
      const payload = {
        targetSubdir: path.dirname(String(targetPath || '')).replace(/^[./\\]+$/, '') || 'assets',
        targetFileName: path.basename(String(targetPath || '')),
        sourcePath,
        dataUrl,
      };
      if (!payload.dataUrl && dataBase64) {
        payload.dataUrl = `data:application/octet-stream;base64,${dataBase64}`;
      }
      if (!payload.targetFileName) throw new Error('targetPath is required');
      return rescompManager.writeAssetIntoRes(buildSystem.getProjectDir(), payload);
    },
    asset_update: async ({ file, lineNumber, entry }) => rescompManager.updateResEntry(buildSystem.getProjectDir(), file || 'resources.res', lineNumber, entry || {}),
    asset_delete: async ({ file, lineNumber }) => rescompManager.deleteResEntry(buildSystem.getProjectDir(), file || 'resources.res', lineNumber),
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
    token: process.env.MD_EDITOR_CONTROL_TOKEN || undefined,
    port: process.env.MD_EDITOR_CONTROL_PORT || undefined,
    onLog(entry) {
      sendToRenderer('ai-control-log', entry);
    },
  });
  return editorControlServer;
}

async function maybeAutoStartEditorControlServer() {
  const flag = String(process.env.MD_EDITOR_CONTROL_AUTOSTART || '').trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(flag)) return;
  try {
    const result = await getEditorControlServer().start({
      port: process.env.MD_EDITOR_CONTROL_PORT,
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
          label: 'About MD Game Editor',
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
  const standardEmulatorDir = pluginManager.getPluginDirectory('standard-emulator')
    || path.join(__dirname, 'plugins', 'standard-emulator');
  const pkgPath = path.join(standardEmulatorDir, 'pkg', 'package.json');
  const buildMetaPath = path.join(standardEmulatorDir, 'pkg', 'build_meta.js');
  let packageVersion = 'unknown';
  let buildVersion = 'unknown';

  try {
    if (fs.existsSync(pkgPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      packageVersion = String(pkgJson.version || 'unknown');
    }
  } catch (_err) {
  }

  try {
    if (fs.existsSync(buildMetaPath)) {
      const meta = fs.readFileSync(buildMetaPath, 'utf-8');
      const m = meta.match(/__BUILD_META_VERSION\s*=\s*"([^"]+)"/);
      if (m && m[1]) {
        buildVersion = m[1];
      }
    }
  } catch (_err) {
  }

  return {
    packageVersion,
    buildVersion,
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

function waitForProcessExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();

    function finish(exited) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.off?.('exit', onExit);
      proc.off?.('error', onError);
      resolve(exited);
    }

    function onExit() {
      finish(true);
    }

    function onError() {
      finish(false);
    }

    proc.once('exit', onExit);
    proc.once('error', onError);
  });
}

function signalApiServerProcess(proc, signal) {
  if (!proc || !proc.pid) return false;
  if (process.platform === 'win32') {
    try {
      return proc.kill(signal);
    } catch (_) {
      return false;
    }
  }

  try {
    process.kill(-proc.pid, signal);
    return true;
  } catch (_) {
    try {
      return proc.kill(signal);
    } catch (__) {
      return false;
    }
  }
}

async function stopApiServer() {
  if (!apiServerProcess) {
    apiServerPort = null;
    return false;
  }

  const proc = apiServerProcess;

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('exit', () => {});
  } else {
    signalApiServerProcess(proc, 'SIGTERM');

    const forceKillTimer = setTimeout(() => {
      signalApiServerProcess(proc, 'SIGKILL');
    }, 1500);
    forceKillTimer.unref?.();
  }

  apiServerProcess = null;
  apiServerPort = null;
  return waitForProcessExit(proc, 3500);
}

function resolveApiLaunch() {
  const repoRoot = getRepoRoot();
  const isWin = process.platform === 'win32';

  if (app.isPackaged) {
    const binName = isWin ? 'md-api.exe' : 'md-api';
    const standardApiEmulatorDir = pluginManager.getPluginDirectory('standard-api-emulator')
      || path.join(process.resourcesPath, 'plugins', 'standard-api-emulator');
    const packagedBin = path.join(standardApiEmulatorDir, 'bin', binName);
    if (!fs.existsSync(packagedBin)) {
      throw new Error(`md-api binary not found: ${packagedBin}`);
    }

    return {
      command: packagedBin,
      args: [],
      cwd: standardApiEmulatorDir,
    };
  }

  return {
    command: isWin ? 'cargo.exe' : 'cargo',
    args: ['run', '-p', 'md-api'],
    cwd: repoRoot,
  };
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferredPort, maxOffset = 20) {
  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const port = preferredPort + offset;
    if (await canBindPort(port)) {
      return port;
    }
  }
  return null;
}

async function startApiServer(port) {
  if (apiServerProcess) {
    return { alreadyRunning: true, port: apiServerPort, currentPort: apiServerPort };
  }

  const preferredPort = port || 8080;
  const launchPort = await findAvailablePort(preferredPort);
  if (launchPort == null) {
    throw new Error(`no available port found from ${preferredPort} to ${preferredPort + 20}`);
  }

  const launch = resolveApiLaunch();
  const env = { ...process.env, MD_API_PORT: String(launchPort) };

  apiServerProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  apiServerPort = launchPort;

  apiServerProcess.stdout.on('data', (chunk) => {
    sendToRenderer('api-log', { level: 'info', message: chunk.toString() });
  });

  apiServerProcess.stderr.on('data', (chunk) => {
    sendToRenderer('api-log', { level: 'error', message: chunk.toString() });
  });

  apiServerProcess.on('exit', (code, signal) => {
    sendToRenderer('api-exit', { code, signal });
    apiServerProcess = null;
    apiServerPort = null;
  });

  return {
    started: true,
    port: launchPort,
    fallbackUsed: launchPort !== preferredPort,
    requestedPort: preferredPort,
  };
}

ipcMain.handle('dialog:openRomFile', async () => {
  if (!mainWindow) {
    return { canceled: true, filePath: null };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Mega Drive ROM', extensions: ['bin', 'md', 'gen', 'smd', 'sms', 'zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, filePath: null };
  }

  return { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle('fs:readRomFile', async (_event, filePath) => {
  const data = fs.readFileSync(filePath);
  return new Uint8Array(data);
});

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
        { name: 'Mega Drive ROM', extensions: ['bin', 'md', 'gen', 'smd', 'sms'] },
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

ipcMain.handle('res:listDefinitions', async () => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const data = rescompManager.listResDefinitions(projectDir);
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:createFile', async (_event, relativePath) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.createResFile(projectDir, relativePath);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:deleteFile', async (_event, relativePath) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.deleteResFile(projectDir, relativePath);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:reorderEntries', async (_event, payload) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.reorderResEntries(projectDir, payload?.file, payload?.orderedLineNumbers || []);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:addEntry', async (_event, payload) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.addResEntry(projectDir, payload?.file, payload?.entry || {});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:updateEntry', async (_event, payload) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.updateResEntry(projectDir, payload?.file, payload?.lineNumber, payload?.entry || {});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:deleteEntry', async (_event, payload) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.deleteResEntry(projectDir, payload?.file, payload?.lineNumber);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:openDirectory', async () => {
  try {
    const resRoot = path.join(buildSystem.getProjectDir(), 'res');
    fs.mkdirSync(resRoot, { recursive: true });
    const error = await shell.openPath(resRoot);
    if (error) {
      return { ok: false, error };
    }
    return { ok: true, path: resRoot };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('dialog:pickFile', async (_event, options) => pickFile(options || {}));

ipcMain.handle('res:pickAssetSource', async () => pickFile({
  properties: ['openFile'],
  filters: DEFAULT_ASSET_FILE_FILTERS,
}));

ipcMain.handle('res:readFileAsDataUrl', async (_event, sourcePath) => {
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

ipcMain.handle('res:readTempFileAsDataUrl', async (_event, sourcePath, options = {}) => {
  try {
    if (!sourcePath || !isTempPath(sourcePath)) {
      return { ok: false, error: 'temp file path is outside the allowed temp directory' };
    }
    if (!fs.existsSync(sourcePath)) {
      return { ok: false, error: 'temp file not found' };
    }
    const data = fs.readFileSync(sourcePath).toString('base64');
    const dataUrl = `data:${getMimeForPath(sourcePath)};base64,${data}`;
    if (options?.deleteAfter) {
      try { fs.unlinkSync(sourcePath); } catch (_) {}
    }
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:deleteTempFile', async (_event, sourcePath) => {
  try {
    if (!sourcePath || !isTempPath(sourcePath)) {
      return { ok: false, error: 'temp file path is outside the allowed temp directory' };
    }
    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('res:writeAssetFile', async (_event, payload) => {
  try {
    const projectDir = buildSystem.getProjectDir();
    const result = rescompManager.writeAssetIntoRes(projectDir, payload || {});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:list', async () => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:list is available for PC Engine projects only' };
    }
    return { ok: true, ...pceAssetManager.listAssets(buildSystem.getProjectDir()) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:upsert', async (_event, asset) => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:upsert is available for PC Engine projects only' };
    }
    const doc = pceAssetManager.upsertAsset(buildSystem.getProjectDir(), asset || {});
    return { ok: true, ...doc };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:delete', async (_event, payload) => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:delete is available for PC Engine projects only' };
    }
    const doc = pceAssetManager.deleteAsset(buildSystem.getProjectDir(), payload?.id || payload);
    return { ok: true, ...doc };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:importImage', async (_event, payload) => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:importImage is available for PC Engine projects only' };
    }
    const result = pceAssetManager.importImage(buildSystem.getProjectDir(), payload || {});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:importAudio', async (_event, payload) => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:importAudio is available for PC Engine projects only' };
    }
    const result = pceAssetManager.importAudio(buildSystem.getProjectDir(), payload || {});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:previewSource', async (_event, payload) => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:previewSource is available for PC Engine projects only' };
    }
    const result = pceAssetManager.previewSource(buildSystem.getProjectDir(), payload?.relativePath || payload);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('assets:reorder', async (_event, payload) => {
  try {
    if (buildSystem.getActiveCoreId() !== 'pc-engine') {
      return { ok: false, error: 'assets:reorder is available for PC Engine projects only' };
    }
    const doc = pceAssetManager.reorderAssets(buildSystem.getProjectDir(), payload?.ids || payload);
    return { ok: true, ...doc };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('api:startServer', async (_event, options) => {
  return startApiServer(options?.port ?? 8080);
});

ipcMain.handle('api:stopServer', async () => {
  return { stopped: await stopApiServer() };
});

ipcMain.handle('api:isRunning', async () => {
  return { running: !!apiServerProcess, port: apiServerPort };
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

ipcMain.handle('window:openDebug', async (_event, options) => {
  return openDebugWindow(options || {});
});

ipcMain.handle('debug:getWasmSnapshot', async (_event, options) => {
  // testPlayWindow (または mainWindow) から debug bridge を読む
  const targetWin = (testPlayWindow && !testPlayWindow.isDestroyed()) ? testPlayWindow
    : (mainWindow && !mainWindow.isDestroyed()) ? mainWindow
    : null;

  if (!targetWin) {
    return { ok: false, error: 'no available window' };
  }

  const palette = Number(options?.palette ?? 0);
  const script = `
    (async function () {
      if (!window.__mdDebugBridge || !window.__mdDebugBridge.getWasmDebugSnapshot) {
        return { ok: false, error: 'WASM debug bridge is not ready' };
      }
      return await window.__mdDebugBridge.getWasmDebugSnapshot(${Number.isFinite(palette) ? palette : 0});
    })();
  `;

  try {
    const result = await targetWin.webContents.executeJavaScript(script, true);
    return result;
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

// ---- Plugin handlers ----
ipcMain.handle('plugins:list', (_event, options = {}) => {
  return pluginManager.listPlugins({
    coreId: buildSystem.getActiveCoreId(),
    includeIncompatible: options?.includeIncompatible !== false,
  });
});

ipcMain.handle('plugins:getRendererAssets', (_event, { id }) => {
  return pluginManager.getRendererAssets(id);
});

ipcMain.handle('plugins:setEnabled', (_event, { id, enabled }) => {
  const result = pluginManager.setEnabledWithDependencies(id, Boolean(enabled), { coreId: buildSystem.getActiveCoreId() });
  if (!result?.ok) {
    return { ok: false, error: result?.error || 'plugin enable failed' };
  }
  return result;
});

ipcMain.handle('plugins:openFolder', async () => {
  const pluginsDir = pluginManager.getPluginsDir();
  try {
    if (!fs.existsSync(pluginsDir)) {
      return { ok: false, error: `plugins フォルダが見つかりません: ${pluginsDir}` };
    }
    const error = await shell.openPath(pluginsDir);
    return error ? { ok: false, error } : { ok: true, path: pluginsDir };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('plugins:invokeHook', async (_event, { id, hook, payload }) => {
  return invokeRendererPluginHook(id, hook, payload || {});
});

ipcMain.handle('plugins:runGenerator', async (_event, { id }) => {
  return runPluginGeneratorAndWrite(id);
});

ipcMain.handle('testplay:getSettings', async () => {
  return setupManager.getTestPlaySettings();
});

ipcMain.handle('testplay:getContext', async () => ({ ok: true, context: currentTestPlayContext }));

ipcMain.handle('testplay:getDefaultSettings', async () => {
  return setupManager.getDefaultTestPlaySettings();
});

ipcMain.handle('testplay:saveSettings', async (_event, settings) => {
  const saved = setupManager.saveTestPlaySettings(settings || {});
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
    title: 'Test Play Settings - MD Game Editor',
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
    title: 'Setup - MD Game Editor',
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
  if (buildSystem.getActiveCoreId() === 'pc-engine') {
    return buildSystem.getPceSetupManager().getStatus();
  }
  return setupManager.getStatus();
});

ipcMain.handle('setup:getCatalog', async () => {
  if (buildSystem.getActiveCoreId() === 'pc-engine') {
    return buildSystem.getPceSetupManager().getDownloadCatalog();
  }
  return { ok: false, error: 'generic setup catalog is available for PC Engine projects only' };
});

ipcMain.handle('setup:listVersions', async (_event, { kind } = {}) => {
  if (buildSystem.getActiveCoreId() === 'pc-engine') {
    return buildSystem.getPceSetupManager().listToolVersions(kind);
  }
  return { ok: false, error: 'generic setup versions are available for PC Engine projects only', versions: [] };
});

ipcMain.handle('setup:downloadTool', async (_event, payload = {}) => {
  if (buildSystem.getActiveCoreId() === 'pc-engine') {
    return buildSystem.getPceSetupManager().downloadTool(payload || {}, (progress) => {
      sendToSetupWindow('setup-progress', progress);
    });
  }
  return { ok: false, error: 'generic setup download is available for PC Engine projects only' };
});

ipcMain.handle('setup:setToolPath', async (_event, { kind, value } = {}) => {
  if (buildSystem.getActiveCoreId() === 'pc-engine') {
    return buildSystem.getPceSetupManager().setToolPath(kind, value);
  }
  return { ok: false, error: 'generic setup path is available for PC Engine projects only' };
});

ipcMain.handle('setup:selectPceCdImage', async () => {
  if (buildSystem.getActiveCoreId() !== 'pc-engine') {
    return { ok: false, error: 'PCE-CD image selection is available for PC Engine projects only' };
  }
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
  if (buildSystem.getActiveCoreId() !== 'pc-engine') {
    return { ok: false, error: 'System Card selection is available for PC Engine projects only' };
  }
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
  if (buildSystem.getActiveCoreId() === 'pc-engine') {
    return buildSystem.getPceSetupManager().extractPceCdIpl(payload || {});
  }
  return { ok: false, error: 'PCE-CD IPL extraction is available for PC Engine projects only' };
});

ipcMain.handle('setup:listSgdkVersions', async () => {
  return setupManager.listSgdkReleases(30);
});

ipcMain.handle('setup:downloadSgdk', async (_event, tag) => {
  return setupManager.downloadSgdk(tag, (progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:downloadJava', async () => {
  return setupManager.downloadJava((progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:downloadEmsdk', async () => {
  return setupManager.downloadEmsdk((progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:downloadNukedOpn2', async () => {
  return setupManager.downloadNukedOpn2((progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:buildNukedOpn2Wasm', async () => {
  return setupManager.buildNukedOpn2Wasm((progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:loadOptionalAudioEngine', async (_event, engineId) => {
  return setupManager.loadOptionalAudioEngine(engineId);
});

ipcMain.handle('setup:setSgdkPath', async (_event, p) => {
  return setupManager.setSgdkPath(p);
});

ipcMain.handle('setup:listMarsdevVersions', async () => {
  return setupManager.listMarsdevReleases(30);
});

ipcMain.handle('setup:downloadMarsdev', async (_event, tag) => {
  return setupManager.downloadMarsdev(tag, (progress) => {
    sendToSetupWindow('setup-progress', progress);
  });
});

ipcMain.handle('setup:setMarsdevPath', async (_event, p) => {
  return setupManager.setMarsdevPath(p);
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
  try {
    if (buildSystem.getActiveCoreId() === 'pc-engine') {
      return runPceBuildFull(options);
    }
    const toolchainPath = setupManager.getToolchainDir();
    const javaPath = setupManager.getJavaExePath();
    const projectDir = buildSystem.getProjectDir();
    let builderPluginId = resolvePluginForRole('builder');
    if (!toolchainPath) {
      return { success: false, error: 'ツールチェーンが設定されていません。Setup を実行してください。' };
    }
    if (!builderPluginId) {
      return { success: false, error: '有効な Build プラグインが未設定です。Plugins 画面で有効化してください。' };
    }
    if (!pluginManager.isPluginEnabled(builderPluginId)) {
      return { success: false, error: `Build プラグイン "${builderPluginId}" は無効です` };
    }
    const builderMeta = pluginManager.listPlugins().find((p) => p.id === builderPluginId);
    if (!pluginSupportsRole(builderMeta, 'builder')) {
      return { success: false, error: `Build プラグイン "${builderPluginId}" は builder role ではありません` };
    }

    const pluginContext = {
      projectDir,
      assets: collectProjectAssets(projectDir),
    };

    const buildOptions = {
      skipClean: Boolean(options?.skipClean),
    };
    if (builderPluginId) {
      const buildStartResult = await invokePluginHookSafe(builderPluginId, 'onBuildStart', {
        projectDir,
        toolchainPath,
      }, {
        ...pluginContext,
        coreId: buildSystem.getActiveCoreId(),
        logger: createPluginLogger(builderPluginId),
      });
      if (buildStartResult?.ok && buildStartResult.makeVariables && typeof buildStartResult.makeVariables === 'object') {
        buildOptions.makeVariables = buildStartResult.makeVariables;
      }
      if (buildStartResult?.ok && buildStartResult.env && typeof buildStartResult.env === 'object') {
        buildOptions.env = buildStartResult.env;
      }
      if (buildStartResult?.ok && Array.isArray(buildStartResult.makeTargets)) {
        buildOptions.makeTargets = buildStartResult.makeTargets;
      }
      if (buildStartResult?.ok && Object.prototype.hasOwnProperty.call(buildStartResult, 'skipClean')) {
        buildOptions.skipClean = Boolean(buildStartResult.skipClean);
      }
    }

    const result = await buildSystem.buildProject(toolchainPath, javaPath, (line, level) => {
      sendToRenderer('build-log', { text: line, level: level || 'info' });
      if (builderPluginId) {
        void pluginManager.invokeHook(builderPluginId, 'onBuildLog', {
          line,
          level: level || 'info',
        }, {
          ...pluginContext,
          coreId: buildSystem.getActiveCoreId(),
          logger: createPluginLogger(builderPluginId),
        }).catch(() => {});
      }
    }, buildOptions);

    if (builderPluginId) {
      if (result.success) {
        await invokePluginHookSafe(builderPluginId, 'onBuildEnd', result, {
          ...pluginContext,
          coreId: buildSystem.getActiveCoreId(),
          logger: createPluginLogger(builderPluginId),
        });
      } else {
        await invokePluginHookSafe(builderPluginId, 'onBuildError', {
          error: result.error || 'build failed',
          result,
        }, {
          ...pluginContext,
          coreId: buildSystem.getActiveCoreId(),
          logger: createPluginLogger(builderPluginId),
        });
      }
    }

    sendToRenderer('build-end', result);
    return result;
  } catch (err) {
    const r = { success: false, error: err.message || String(err) };
    sendToRenderer('build-end', r);
    return r;
  }
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
    await invokePluginHookSafe(builderPluginId, 'onBuildStart', {
      projectDir,
      toolchain: config.toolchain,
      toolchainPath: buildSystem.getPceSetupManager().getToolchainPath(config.toolchain),
    }, pluginContext);
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

// ── Export HTML ジェネレータ ────────────────────────────────────────────────

function parseRomHeaderInfo(romBytes, romLabel) {
  const safeAscii = (start, len) => {
    if (romBytes.length <= start) return '';
    const end = Math.min(romBytes.length, start + len);
    return romBytes
      .subarray(start, end)
      .toString('ascii')
      .replace(/\0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const readU16BE = (offset) => {
    if (offset + 1 >= romBytes.length) return null;
    return romBytes.readUInt16BE(offset);
  };

  const readU32BE = (offset) => {
    if (offset + 3 >= romBytes.length) return null;
    return romBytes.readUInt32BE(offset);
  };

  const checksum = readU16BE(0x18E);
  const romStart = readU32BE(0x1A0);
  const romEnd = readU32BE(0x1A4);

  return {
    fileName: romLabel,
    fileSize: romBytes.length,
    consoleName: safeAscii(0x100, 16),
    domesticTitle: safeAscii(0x120, 48),
    overseasTitle: safeAscii(0x150, 48),
    serial: safeAscii(0x180, 14),
    ioSupport: safeAscii(0x190, 16),
    region: safeAscii(0x1F0, 3),
    checksum: checksum == null ? 'N/A' : `0x${checksum.toString(16).padStart(4, '0').toUpperCase()}`,
    romRange: (romStart == null || romEnd == null)
      ? 'N/A'
      : `0x${romStart.toString(16).padStart(8, '0').toUpperCase()} - 0x${romEnd.toString(16).padStart(8, '0').toUpperCase()}`,
  };
}

function generateExportHtml({
  romBase64,
  romLabel,
  wasmJsText,
  wasmBase64,
  playerJsText,
  romInfo,
  appVersion,
  appBuildNumber,
  appBuildAt,
}) {
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escJs(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // ── md_wasm.js パッチ: ES module exports 除去 + 内部変数名衝突を解消 ──
  let wasmJs = wasmJsText;
  wasmJs = wasmJs.replace('export class EmulatorHandle {', 'class EmulatorHandle {');
  wasmJs = wasmJs.replace('let wasmModule, wasm;', 'let __wbgInternalModule, wasm;');
  wasmJs = wasmJs.replace('    wasmModule = module;', '    __wbgInternalModule = module;');
  wasmJs = wasmJs.replace('export { initSync, __wbg_init as default };', '// [exports removed for standalone build]');

  // ── wasm-player.js パッチ: dynamic import を廃止し WASM を ArrayBuffer で直接初期化 ──
  let playerJs = playerJsText;
  playerJs = playerJs.replace(
    '    wasmModule = await import(`./pkg/md_wasm.js?v=${cacheBust}`);',
    '    wasmModule = { EmulatorHandle, default: __wbg_init };',
  );
  playerJs = playerJs.replace(
    '    await wasmModule.default(`./pkg/md_wasm_bg.wasm?v=${cacheBust}`);',
    '    { const _wb = atob(window.__WASM_B64), _wa = new Uint8Array(_wb.length);' +
    ' for (let _wi = 0; _wi < _wb.length; _wi++) _wa[_wi] = _wb.charCodeAt(_wi);' +
    ' await __wbg_init(_wa.buffer); }',
  );

  const romInfoLiteral = JSON.stringify(romInfo || {}).replace(/<\/script>/gi, '<\\/script>');
  const appVersionLiteral = escJs(appVersion || 'unknown');
  const appBuildNumberLiteral = escJs(appBuildNumber || 'dev');
  const appBuildAtLiteral = escJs(appBuildAt || 'N/A');

  const standaloneUiPatch = `
(() => {
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const fmtBytes = (n) => {
    const num = Number(n || 0);
    if (!Number.isFinite(num)) return '0 bytes';
    if (num >= 1024 * 1024) return (num / (1024 * 1024)).toFixed(2) + ' MB (' + num + ' bytes)';
    if (num >= 1024) return (num / 1024).toFixed(2) + ' KB (' + num + ' bytes)';
    return num + ' bytes';
  };

  window.__ROM_INFO = ${romInfoLiteral};
  const romInfo = window.__ROM_INFO || {};

  setText('romFileName', romInfo.fileName || 'unknown');
  setText('romFileSize', fmtBytes(romInfo.fileSize));
  setText('romConsoleName', romInfo.consoleName || 'N/A');
  setText('romDomesticTitle', romInfo.domesticTitle || 'N/A');
  setText('romOverseasTitle', romInfo.overseasTitle || 'N/A');
  setText('romSerial', romInfo.serial || 'N/A');
  setText('romRegion', romInfo.region || 'N/A');
  setText('romChecksum', romInfo.checksum || 'N/A');
  setText('romRange', romInfo.romRange || 'N/A');
  setText('romIoSupport', romInfo.ioSupport || 'N/A');

  const appVersion = "${appVersionLiteral}";
  const appBuildNumber = "${appBuildNumberLiteral}";
  const appBuildAt = "${appBuildAtLiteral}";
  setText('helpVersionApp', 'MD Emulator v' + appVersion + ' / build ' + appBuildNumber);
  setText('helpVersionBuildAt', appBuildAt);

  const updateWasmVersion = () => {
    let wasmVersion = 'unknown';
    try {
      if (typeof EmulatorHandle !== 'undefined' && EmulatorHandle && EmulatorHandle.build_version) {
        wasmVersion = EmulatorHandle.build_version();
      }
    } catch (_) {}
    setText('helpVersionWasm', wasmVersion);
  };

  let versionRetry = 0;
  const versionTimer = setInterval(() => {
    versionRetry += 1;
    updateWasmVersion();
    if (versionRetry > 30) clearInterval(versionTimer);
  }, 200);
  updateWasmVersion();

  const runBtn = document.getElementById('toggleRun');
  let autoPlayRetries = 0;
  const autoPlayTimer = setInterval(() => {
    autoPlayRetries += 1;
    if (runBtn && !runBtn.disabled && String(runBtn.textContent || '').includes('▶')) {
      runBtn.click();
    }
    if (runBtn && String(runBtn.textContent || '').includes('⏸')) {
      clearInterval(autoPlayTimer);
    } else if (autoPlayRetries > 40) {
      clearInterval(autoPlayTimer);
    }
  }, 120);

  const dlRom = document.getElementById('downloadRom');
  if (dlRom) {
    dlRom.addEventListener('click', () => {
      try {
        const b64 = (window.__AUTOSTART_ROM_B64 && window.__AUTOSTART_ROM_B64.data) || '';
        const label = (window.__AUTOSTART_ROM_B64 && window.__AUTOSTART_ROM_B64.label) || (romInfo.fileName || 'game.bin');
        const bstr = atob(b64);
        const bytes = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) bytes[i] = bstr.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = label;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        const st = document.getElementById('status');
        if (st) st.textContent = 'ROM download failed: ' + err;
      }
    });
  }

  const helpModal = document.getElementById('helpModal');
  const helpBtn = document.getElementById('helpBtn');
  const helpClose = document.getElementById('helpClose');
  const helpBackdrop = document.getElementById('helpBackdrop');

  const closeHelp = () => {
    if (!helpModal) return;
    helpModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  };

  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      if (!helpModal) return;
      helpModal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    });
  }
  if (helpClose) helpClose.addEventListener('click', closeHelp);
  if (helpBackdrop) helpBackdrop.addEventListener('click', closeHelp);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHelp();
  });
})();`;

  // </script> が HTML を壊さないようエスケープ
  const scriptEscape = (s) => s.replace(/<\/script>/gi, '<\\/script>');
  const combinedScript = scriptEscape(wasmJs + '\n\n' + playerJs + '\n\n' + standaloneUiPatch);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MD Emulator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; background: #050a17; color: #ebf3ff;
      font-family: system-ui, "Segoe UI", sans-serif; }
    body { display: flex; flex-direction: column; align-items: center; }
    body.modal-open { overflow: hidden; }
    header { width: 100%; max-width: 640px; padding: 10px 14px;
      display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid #1a2a42; }
    h1 { font-size: 15px; font-weight: 600; flex: 1;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    main { width: 100%; max-width: 640px; padding: 8px; flex: 1;
      display: flex; flex-direction: column; gap: 8px; }
    .screen-stage { width: 100%; aspect-ratio: 320 / 224; background: #000;
      border-radius: 8px; overflow: hidden; border: 1px solid #1a2a42;
      position: relative; transform-origin: center; }
    .screen-stage:fullscreen { width: 100vw; height: 100vh; border-radius: 0;
      max-height: none;
      display: flex; align-items: center; justify-content: center; }
    .screen-rotator {
      position: relative;
      width: 100%;
      height: 100%;
      transform-origin: center;
      transition: transform 0.3s ease;
    }
    .screen-stage:fullscreen .screen-rotator {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 100vw;
      height: 100vh;
      transform: translate(-50%, -50%);
    }
    canvas#screen { width: 100%; height: 100%; object-fit: contain;
      image-rendering: pixelated; display: block; }
    .controls { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    button { background: #163154; border: 1px solid #2a3f5e; color: #ebf3ff;
      border-radius: 8px; padding: 7px 12px; cursor: pointer; font-size: 13px; }
    button:hover { background: #1d3e68; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .spacer { flex: 1; }
    #status { font-size: 12px; color: #4bc8ff; min-height: 18px; }
    #buildVersion, #gamepadStatus, #devPanel, #installPwa { display: none; }
    input[type="file"] { display: none; }
    #dropZone { display: contents; }
    .virtual-gamepad {
      position: absolute;
      inset: auto 10px 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 14px;
      pointer-events: none;
      opacity: 0.84;
      transition: opacity 160ms ease;
      touch-action: none;
      z-index: 5;
    }
    .screen-stage:fullscreen .virtual-gamepad {
      inset: auto max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      opacity: 0.58;
    }
    .screen-stage:fullscreen .virtual-gamepad:active { opacity: 0.82; }
    .analog-stick {
      position: relative;
      width: 132px;
      height: 132px;
      border-radius: 999px;
      border: 1px solid rgba(235, 243, 255, 0.26);
      background:
        radial-gradient(circle at 50% 50%, rgba(54, 133, 210, 0.28), transparent 34%),
        rgba(7, 15, 28, 0.52);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.38);
      pointer-events: auto;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
    }
    .analog-stick::before,
    .analog-stick::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      background: rgba(235, 243, 255, 0.18);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .analog-stick::before {
      width: 70%;
      height: 1px;
    }
    .analog-stick::after {
      width: 1px;
      height: 70%;
    }
    .stick-thumb {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 58px;
      height: 58px;
      border-radius: 999px;
      border: 1px solid rgba(235, 243, 255, 0.34);
      background: rgba(22, 55, 94, 0.9);
      box-shadow: 0 7px 18px rgba(0, 0, 0, 0.42);
      transform: translate(-50%, -50%);
      pointer-events: none;
      transition: background 120ms ease;
    }
    .analog-stick.active .stick-thumb {
      background: rgba(57, 130, 205, 0.96);
    }
    .face-buttons {
      display: grid;
      grid-template-columns: repeat(3, 52px);
      grid-template-rows: 52px 28px;
      gap: 8px;
      align-items: center;
      pointer-events: auto;
    }
    .gamepad-btn {
      min-width: 0;
      width: 100%;
      height: 100%;
      border-radius: 999px;
      border: 1px solid rgba(235, 243, 255, 0.35);
      background: rgba(8, 17, 32, 0.62);
      color: #fff;
      font-weight: 700;
      text-shadow: 0 1px 2px #000;
      -webkit-user-select: none;
      user-select: none;
      touch-action: none;
    }
    .gamepad-btn:active { background: rgba(75, 200, 255, 0.72); }
    .gamepad-btn.up { grid-column: 2; grid-row: 1; }
    .gamepad-btn.left { grid-column: 1; grid-row: 2; }
    .gamepad-btn.right { grid-column: 3; grid-row: 2; }
    .gamepad-btn.down { grid-column: 2; grid-row: 3; }
    .gamepad-btn.a { grid-column: 1; grid-row: 1; }
    .gamepad-btn.b { grid-column: 2; grid-row: 1; }
    .gamepad-btn.c { grid-column: 3; grid-row: 1; }
    .gamepad-btn.start {
      grid-column: 1 / 4;
      grid-row: 2;
      height: 28px;
      font-size: 11px;
      letter-spacing: 0;
    }
    .fs-stage-btn {
      position: absolute;
      top: max(14px, env(safe-area-inset-top));
      z-index: 6;
      display: none;
      opacity: 0.62;
      min-width: 40px;
      min-height: 40px;
      padding: 0;
    }
    .fs-fullscreen-btn { left: max(14px, env(safe-area-inset-left)); }
    .screen-stage:fullscreen .fs-stage-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .rom-panel {
      margin-top: 8px;
      border: 1px solid #1a2a42;
      background: #0b1528;
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 6px;
      font-size: 12px;
    }
    .rom-panel summary {
      cursor: pointer;
      color: #8cb4de;
      font-weight: 700;
      list-style-position: inside;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 4px 10px;
      align-items: baseline;
      margin-top: 8px;
    }
    .info-grid dt { color: #8cb4de; }
    .info-grid dd { word-break: break-all; }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal.hidden { display: none; }
    .modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.62);
    }
    .modal-card {
      position: relative;
      width: min(640px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      overflow: auto;
      background: #0b1528;
      border: 1px solid #2a3f5e;
      border-radius: 10px;
      padding: 14px;
    }
    .modal-card h3 { font-size: 16px; margin-bottom: 8px; }
    .modal-card h4 { font-size: 13px; margin: 10px 0 6px; color: #8cb4de; }
    .help-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .help-table th, .help-table td {
      border: 1px solid #1f3250;
      padding: 6px;
      text-align: left;
    }
    .help-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
    @media (pointer: fine) and (min-width: 720px) {
      .virtual-gamepad { opacity: 0; }
      .screen-stage:hover .virtual-gamepad,
      .screen-stage:fullscreen .virtual-gamepad { opacity: 0.58; }
    }
    @media (max-width: 480px) {
      .info-grid { grid-template-columns: 1fr; }
      .controls button { flex: 1 1 auto; }
      .analog-stick { width: 116px; height: 116px; }
      .stick-thumb { width: 52px; height: 52px; }
      .face-buttons {
        grid-template-columns: repeat(3, 46px);
        grid-template-rows: 46px 26px;
      }
    }
  </style>
  <script>
    window.__AUTOSTART_ROM_B64 = { data: "${romBase64}", label: "${escJs(romLabel)}" };
    window.__WASM_B64 = "${wasmBase64}";
  </script>
</head>
<body>
  <header>
    <h1>MD Emulator</h1>
    <span id="buildVersion"></span>
  </header>
  <main>
    <div id="dropZone">
      <div class="screen-stage">
        <div class="screen-rotator">
          <canvas id="screen" width="320" height="224"></canvas>
          <div class="virtual-gamepad" aria-label="Virtual gamepad">
            <div class="analog-stick" data-stick="direction" role="application" aria-label="Analog direction stick">
              <span class="stick-thumb" aria-hidden="true"></span>
            </div>
            <div class="face-buttons" aria-label="Action buttons">
              <button class="gamepad-btn a" data-btn="a" type="button" aria-label="Button A">A</button>
              <button class="gamepad-btn b" data-btn="b" type="button" aria-label="Button B">B</button>
              <button class="gamepad-btn c" data-btn="c" type="button" aria-label="Button C">C</button>
              <button class="gamepad-btn start" data-btn="start" type="button" aria-label="Start">START</button>
            </div>
          </div>
          <button id="fsFullscreen" class="fs-stage-btn fs-fullscreen-btn" title="フルスクリーン解除" type="button">&#x26F6;</button>
        </div>
      </div>
    </div>
    <div id="status">読み込み中...</div>
    <div id="gamepadStatus"></div>
    <div class="controls">
      <button id="toggleRun" title="再生 / 一時停止" disabled>&#9654;</button>
      <button id="reset" title="リセット" disabled>&#8634;</button>
      <button id="toggleAudio" title="ミュート切替" disabled>&#128266;</button>
      <span class="spacer"></span>
      <button id="downloadRom" title="ROM をダウンロード">Download ROM</button>
      <button id="helpBtn" title="ヘルプを表示">Help</button>
      <button id="fullscreen" title="フルスクリーン">&#x26F6;</button>
    </div>
    <input type="file" id="romFile" accept=".bin,.md,.gen,.smd">
    <button id="loadRom" style="display:none">Load ROM</button>
    <select id="bundledRom" style="display:none"></select>
    <button id="loadBundled" style="display:none">Load Bundled</button>
    <div id="meta" style="display:none"></div>
    <details class="rom-panel">
      <summary>ROM Information</summary>
      <dl class="info-grid">
        <dt>File Name</dt><dd id="romFileName">-</dd>
        <dt>File Size</dt><dd id="romFileSize">-</dd>
        <dt>Console</dt><dd id="romConsoleName">-</dd>
        <dt>Domestic Title</dt><dd id="romDomesticTitle">-</dd>
        <dt>Overseas Title</dt><dd id="romOverseasTitle">-</dd>
        <dt>Serial</dt><dd id="romSerial">-</dd>
        <dt>Region</dt><dd id="romRegion">-</dd>
        <dt>Checksum</dt><dd id="romChecksum">-</dd>
        <dt>ROM Range</dt><dd id="romRange">-</dd>
        <dt>I/O Support</dt><dd id="romIoSupport">-</dd>
      </dl>
    </details>
    <div id="installPwa"></div>
    <div id="fsOverlay"></div>
    <div id="devPanel"></div>
  </main>

  <div id="helpModal" class="modal hidden" aria-hidden="true">
    <div id="helpBackdrop" class="modal-backdrop"></div>
    <section class="modal-card" role="dialog" aria-modal="true" aria-label="Help">
      <h3>MD Emulator Help</h3>

      <h4>Keyboard Controller Mapping</h4>
      <table class="help-table">
        <thead>
          <tr><th>Controller</th><th>Keyboard</th></tr>
        </thead>
        <tbody>
          <tr><td>Up / Down / Left / Right</td><td>Arrow Keys or W / S / A / D</td></tr>
          <tr><td>Button A</td><td>U</td></tr>
          <tr><td>Button B</td><td>J</td></tr>
          <tr><td>Button C</td><td>K</td></tr>
          <tr><td>Start</td><td>Enter</td></tr>
        </tbody>
      </table>

      <h4>Version Information</h4>
      <table class="help-table">
        <tbody>
          <tr><th>App</th><td id="helpVersionApp">-</td></tr>
          <tr><th>Build At</th><td id="helpVersionBuildAt">-</td></tr>
          <tr><th>WASM</th><td id="helpVersionWasm">-</td></tr>
        </tbody>
      </table>

      <div class="help-actions">
        <button id="helpClose">Close</button>
      </div>
    </section>
  </div>

  <script type="module">
${combinedScript}
  </script>
</body>
</html>`;
}

// ── Export ハンドラ ─────────────────────────────────────────────────────────

async function handleExportRom() {
  const romPath = buildSystem.getLastRomPath();
  if (!romPath || !fs.existsSync(romPath)) {
    return { ok: false, error: 'エクスポートできるビルド済み ROM がありません。先に Build を実行してください。' };
  }

  const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
  let suggested = path.basename(romPath);
  try {
    const cfg = buildSystem.loadProjectConfig();
    const projectName = cfg?.title || cfg?.romName || cfg?.name || buildSystem.getProjectInfo()?.projectName;
    if (projectName) suggested = `${sanitizeExportFileName(projectName, 'rom')}${buildSystem.getActiveCoreId() === 'pc-engine' ? '.pce' : '.bin'}`;
  } catch (_) {}

  const result = await dialog.showSaveDialog(owner, {
    title: 'ROM をエクスポート',
    defaultPath: suggested,
    filters: [
      buildSystem.getActiveCoreId() === 'pc-engine'
        ? { name: 'PC Engine ROM', extensions: ['pce'] }
        : { name: 'Mega Drive ROM', extensions: ['bin', 'md', 'gen'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.copyFileSync(romPath, result.filePath);
  return { ok: true, path: result.filePath };
}

async function handleExportHtml() {
  const romPath = buildSystem.getLastRomPath();
  if (!romPath || !fs.existsSync(romPath)) {
    return { ok: false, error: 'エクスポートできるビルド済み ROM がありません。先に Build を実行してください。' };
  }

  // ソースファイルパスを確認
  const standardEmulatorDir = pluginManager.getPluginDirectory('standard-emulator')
    || path.join(__dirname, 'plugins', 'standard-emulator');
  const pkgDir = path.join(standardEmulatorDir, 'pkg');
  const wasmJsPath = path.join(pkgDir, 'md_wasm.js');
  const wasmBinPath = path.join(pkgDir, 'md_wasm_bg.wasm');
  const playerJsPath = path.join(standardEmulatorDir, 'wasm-player.js');

  for (const [label, p] of [['md_wasm.js', wasmJsPath], ['md_wasm_bg.wasm', wasmBinPath], ['wasm-player.js', playerJsPath]]) {
    if (!fs.existsSync(p)) {
      return { ok: false, error: `${label} が見つかりません。npm run copy-pkg を実行してください。` };
    }
  }

  const wasmJsText = fs.readFileSync(wasmJsPath, 'utf-8');
  const wasmBase64 = fs.readFileSync(wasmBinPath).toString('base64');
  const playerJsText = fs.readFileSync(playerJsPath, 'utf-8');
  const romBytes = fs.readFileSync(romPath);
  const romBase64 = romBytes.toString('base64');
  const romLabel = path.basename(romPath);
  const romInfo = parseRomHeaderInfo(romBytes, romLabel);

  // 保存先 HTML ファイルを選択（シングルファイル・サーバー不要）
  const owner = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined;
  let suggested = `${sanitizeExportFileName(romLabel.replace(/\.(bin|md|gen|smd)$/i, ''), 'rom')}.html`;
  try {
    const cfg = buildSystem.loadProjectConfig();
    const projectName = cfg?.title || cfg?.romName || cfg?.name || buildSystem.getProjectInfo()?.projectName;
    if (projectName) suggested = `${sanitizeExportFileName(projectName, 'rom')}.html`;
  } catch (_) {}

  const saveResult = await dialog.showSaveDialog(owner, {
    title: 'HTML をエクスポート（スタンドアロン・サーバー不要）',
    defaultPath: suggested,
    filters: [{ name: 'HTML ファイル', extensions: ['html'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };

  const html = generateExportHtml({
    romBase64,
    romLabel,
    wasmJsText,
    wasmBase64,
    playerJsText,
    romInfo,
    appVersion: electronPackageJson.version,
    appBuildNumber: appBuildMeta.buildNumber,
    appBuildAt: appBuildMeta.buildAt,
  });
  fs.writeFileSync(saveResult.filePath, html, 'utf-8');

  return { ok: true, path: saveResult.filePath };
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

ipcMain.handle('cores:list', async () => {
  return { ok: true, cores: buildSystem.listCores(), activeCoreId: buildSystem.getActiveCoreId() };
});

ipcMain.handle('cores:getActive', async () => {
  return { ok: true, coreId: buildSystem.getActiveCoreId(), core: buildSystem.getCore(buildSystem.getActiveCoreId()) };
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
  stopApiServerSync();
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
  stopApiServerSync,
  stopEditorControlServer,
  prepareForAppQuit,
  requestAppQuit,
  waitForProcessExit,
  resolveUnderCodeRoot,
};
