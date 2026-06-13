'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const setupManager = require('../pce-setup-manager');
const cdBundle = require('../pce-cd-bundle');
const {
  PCE_CD_SYSTEM_CARD_EMULATOR_NAME,
  createPceTestPlayStaticRoots,
  resolvePceEmulatorJsRuntime,
  startPceTestPlayStaticServer,
  stopPceTestPlayStaticServer,
} = require('../pce-testplay-server');

const repoDir = path.resolve(__dirname, '..');
const dataDir = path.join(repoDir, 'data');

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
  const roots = createPceTestPlayStaticRoots({ romPath: bundle.zipPath, runtime, systemCardPath });
  const { server, port } = await startPceTestPlayStaticServer({ roots, preferredPort: 0, maxOffset: 0 });
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
  stopPceTestPlayStaticServer(server);
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
