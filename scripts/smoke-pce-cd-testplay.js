'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const setupManager = require('../pce-setup-manager');
const cdBundle = require('../pce-cd-bundle');

const repoDir = path.resolve(__dirname, '..');
const dataDir = path.join(repoDir, 'data');
const PCE_CD_SYSTEM_CARD_EMULATOR_NAME = 'syscard3.pce';

function findPceEmulatorCore(dataRoot) {
  const coresDir = path.join(dataRoot, 'cores');
  if (!fs.existsSync(coresDir)) return null;
  return fs.readdirSync(coresDir).find((fileName) => /^mednafen_pce.*-wasm\.data$/i.test(fileName)) || null;
}

function resolvePceEmulatorJsRuntime(emulatorJsDir) {
  const root = path.resolve(emulatorJsDir || '');
  const directLoader = path.join(root, 'loader.js');
  const nestedDataDir = path.join(root, 'data');
  const nestedLoader = path.join(nestedDataDir, 'loader.js');
  if (fs.existsSync(directLoader)) {
    return { rootDir: path.dirname(root), dataDir: root, loaderPath: directLoader, coreAsset: findPceEmulatorCore(root) };
  }
  if (fs.existsSync(nestedLoader)) {
    return { rootDir: root, dataDir: nestedDataDir, loaderPath: nestedLoader, coreAsset: findPceEmulatorCore(nestedDataDir) };
  }
  return { rootDir: root, dataDir: nestedDataDir, loaderPath: nestedLoader, coreAsset: null };
}

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.cue') return 'text/plain; charset=utf-8';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

function resolveStaticPath(rootDir, requestPath) {
  const root = fs.realpathSync(rootDir);
  const normalized = decodeURIComponent(String(requestPath || '')).replace(/^\/+/, '');
  const target = path.resolve(root, normalized);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  const realTarget = fs.realpathSync(target);
  const realRel = path.relative(root, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) return null;
  return realTarget;
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Range',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...headers,
  });
  if (body == null) res.end();
  else res.end(body);
}

function startServer({ cuePath, runtime, systemCardPath }) {
  const roots = {
    mediaRoot: path.dirname(cuePath),
    emulatorRoot: runtime.rootDir,
    dataRoot: runtime.dataDir,
    systemCardPath,
  };
  const server = http.createServer((req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      let filePath = null;
      if (parsed.pathname.startsWith('/rom/')) {
        filePath = resolveStaticPath(roots.mediaRoot, parsed.pathname.slice('/rom/'.length));
      } else if (parsed.pathname.startsWith('/bios/')) {
        const requested = decodeURIComponent(parsed.pathname.slice('/bios/'.length));
        if (requested === path.basename(roots.systemCardPath) || requested === PCE_CD_SYSTEM_CARD_EMULATOR_NAME) filePath = roots.systemCardPath;
      } else if (parsed.pathname.startsWith('/emulatorjs-data/')) {
        filePath = resolveStaticPath(roots.dataRoot, parsed.pathname.slice('/emulatorjs-data/'.length));
      } else if (parsed.pathname.startsWith('/emulatorjs/')) {
        filePath = resolveStaticPath(roots.emulatorRoot, parsed.pathname.slice('/emulatorjs/'.length));
      }
      if (!filePath) return send(res, 404, 'not found');
      const stat = fs.statSync(filePath);
      return send(res, 200, req.method === 'HEAD' ? null : fs.readFileSync(filePath), {
        'Content-Type': contentTypeForFile(filePath),
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
      });
    } catch (err) {
      return send(res, 500, String(err?.message || err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const cuePath = path.resolve(process.argv[2] || '');
  if (!cuePath || !fs.existsSync(cuePath)) throw new Error(`cue not found: ${cuePath}`);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.setPath('userData', dataDir);
  await app.whenReady();

  const emulatorJsDir = setupManager.getEmulatorJsDir();
  const systemCardPath = setupManager.getPceCdSystemCardPath();
  if (!emulatorJsDir) throw new Error('EmulatorJS is not configured');
  if (!systemCardPath) throw new Error('System Card is not configured');
  const runtime = resolvePceEmulatorJsRuntime(emulatorJsDir);
  if (!fs.existsSync(runtime.loaderPath) || !runtime.coreAsset) throw new Error('EmulatorJS loader/core is missing');
  const bundle = cdBundle.createCdTestPlayBundle(cuePath);
  const { server, port } = await startServer({ cuePath: bundle.zipPath, runtime, systemCardPath });
  const base = `http://127.0.0.1:${port}`;
  const stat = fs.statSync(bundle.zipPath);
  const context = {
    romPath: cuePath,
    romUrl: `${base}/rom/${encodeURIComponent(path.basename(bundle.zipPath))}`,
    isCdMedia: true,
    mediaRootUrl: `${base}/rom/`,
    systemCardUrl: `${base}/bios/${PCE_CD_SYSTEM_CARD_EMULATOR_NAME}`,
    cdBundlePath: bundle.zipPath,
    cdBundleEntryName: bundle.entryName,
    romMtimeMs: stat.mtimeMs,
    romSize: stat.size,
    gameId: `${path.basename(cuePath)}-${stat.mtimeMs}-${stat.size}`,
    emulatorJsDir: runtime.rootDir,
    emulatorJsUrl: `${base}/emulatorjs/`,
    emulatorJsDataDir: runtime.dataDir,
    emulatorJsDataUrl: `${base}/emulatorjs-data/`,
    emulatorJsLoaderUrl: `${base}/emulatorjs-data/loader.js`,
    core: 'pce',
    coreAsset: runtime.coreAsset,
    debug: true,
  };
  ipcMain.handle('testplay:getContext', () => ({ context }));

  const win = new BrowserWindow({
    width: 960,
    height: 760,
    show: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(repoDir, 'plugins', 'pce-standard-emulator', 'testplay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const logs = [];
  win.webContents.on('console-message', (_event, level, message) => {
    logs.push({ level, message });
    process.stdout.write(`[console:${level}] ${message}\n`);
  });
  await win.loadFile(path.join(repoDir, 'plugins', 'pce-standard-emulator', 'testplay.html'));
  const deadline = Date.now() + 45000;
  let state = null;
  while (Date.now() < deadline) {
    state = await win.webContents.executeJavaScript(`(() => {
      const status = document.getElementById('status')?.textContent || '';
      const canvas = document.querySelector('canvas');
      const error = document.querySelector('.error')?.textContent || '';
      return { status, hasCanvas: !!canvas, canvasWidth: canvas?.width || 0, canvasHeight: canvas?.height || 0, error };
    })()`);
    if (state.error) throw new Error(state.error);
    if (state.hasCanvas && /Running|Emulator ready|Ready/.test(state.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await win.webContents.executeJavaScript(`(() => new Promise((resolve) => {
    let attempts = 0;
    const pressRun = () => {
      const manager = window.EJS_emulator && window.EJS_emulator.gameManager;
      if (manager && typeof manager.simulateInput === 'function') {
        manager.simulateInput(0, 3, 1);
        setTimeout(() => manager.simulateInput(0, 3, 0), 260);
        attempts += 1;
        if (attempts >= 8) return resolve(true);
        setTimeout(pressRun, 850);
        return;
      }
      attempts += 1;
      if (attempts >= 8) return resolve(false);
      setTimeout(pressRun, 850);
    };
    pressRun();
  }))()`);
  await new Promise((resolve) => setTimeout(resolve, 13000));
  state = await win.webContents.executeJavaScript(`(() => {
    const status = document.getElementById('status')?.textContent || '';
    const canvas = document.querySelector('canvas');
    const error = document.querySelector('.error')?.textContent || '';
    return { status, hasCanvas: !!canvas, canvasWidth: canvas?.width || 0, canvasHeight: canvas?.height || 0, error };
  })()`);
  const screenshotPath = path.join('/private/tmp', 'pce-vn-cd-testplay.png');
  const image = await win.webContents.capturePage();
  fs.writeFileSync(screenshotPath, image.toPNG());
  server.close();
  await win.close();
  app.quit();
  if (!state?.hasCanvas) throw new Error(`canvas not found: ${JSON.stringify(state)}`);
  if (!/Running|Emulator ready/.test(state.status)) {
    throw new Error(`emulator did not start: ${JSON.stringify({ state, logs: logs.slice(-10), screenshotPath })}`);
  }
  process.stdout.write(`SMOKE_OK ${JSON.stringify({ state, screenshotPath })}\n`);
}

main().catch((err) => {
  process.stderr.write(`SMOKE_FAIL ${err?.stack || err}\n`);
  app.quit();
  process.exit(1);
});
