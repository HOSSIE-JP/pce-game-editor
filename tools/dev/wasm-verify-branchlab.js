'use strict';
// Headless WASM verification: boot the real mednafen_pce core, drive RUN long
// enough to pass opening -> branch_lab (the ADPCM mid-playback stop), capture
// frames. Disables Chromium background throttling so rAF runs at full speed.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const setupManager = require('../../pce-setup-manager');
const cdBundle = require('../../pce-cd-bundle');
const {
  PCE_CD_SYSTEM_CARD_EMULATOR_NAME,
  createPceTestPlayStaticRoots,
  resolvePceEmulatorJsRuntime,
  startPceTestPlayStaticServer,
  stopPceTestPlayStaticServer,
} = require('../../pce-testplay-server');

const repoDir = path.resolve(__dirname, '..', '..');
const dataDir = path.join(repoDir, 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cuePath = path.resolve(process.argv[2] || '');
  if (!cuePath || !fs.existsSync(cuePath)) throw new Error(`cue not found: ${cuePath}`);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.setPath('userData', dataDir);
  await app.whenReady();

  const emulatorJsDir = setupManager.getEmulatorJsDir();
  const systemCardPath = setupManager.getPceCdSystemCardPath();
  const runtime = resolvePceEmulatorJsRuntime(emulatorJsDir);
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
    width: 960, height: 760, show: true, backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(repoDir, 'plugins', 'pce-standard-emulator', 'testplay-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
    },
  });
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _l, m) => { if (/error/i.test(m)) process.stdout.write(`[c] ${m}\n`); });
  await win.loadFile(path.join(repoDir, 'plugins', 'pce-standard-emulator', 'testplay.html'));

  // Wait for the core to be Running.
  for (let i = 0; i < 45; i++) {
    const s = await win.webContents.executeJavaScript(`(document.getElementById('status')?.textContent||'')`);
    if (/Running|Emulator ready|Ready/.test(s)) break;
    await sleep(1000);
  }
  await sleep(2000);

  const haveMgr = await win.webContents.executeJavaScript(
    `!!(window.EJS_emulator && window.EJS_emulator.gameManager && window.EJS_emulator.gameManager.simulateInput)`);
  process.stdout.write(`MANAGER_READY ${haveMgr}\n`);

  // Tap RUN (button 3) many times to advance opening -> jump to branch_lab.
  // Capture a frame after each batch so we can see how far it got.
  const shotDir = '/private/tmp/wasm-verify';
  fs.mkdirSync(shotDir, { recursive: true });
  const tapRun = () => win.webContents.executeJavaScript(`(() => {
    const m = window.EJS_emulator && window.EJS_emulator.gameManager;
    if (!m || !m.simulateInput) return false;
    m.simulateInput(0, 3, 1);
    setTimeout(() => m.simulateInput(0, 3, 0), 120);
    return true;
  })()`);

  for (let i = 0; i < 45; i++) {
    await tapRun();
    await sleep(900);
    if (i % 5 === 4) {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(shotDir, `shot-${String(i + 1).padStart(2, '0')}.png`), img.toPNG());
    }
  }
  // Settle captures: 6 frames over 12s with no further input, to distinguish a
  // genuine freeze (identical frames) from a healthy wait-for-input message.
  for (let k = 0; k < 6; k++) {
    await sleep(2000);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, `settle-${k}.png`), img.toPNG());
  }
  const finalPath = path.join(shotDir, 'settle-5.png');
  process.stdout.write(`DONE ${finalPath}\n`);

  stopPceTestPlayStaticServer(server);
  await win.close();
  app.quit();
}
main().catch((e) => { process.stderr.write(`FAIL ${e?.stack || e}\n`); app.quit(); process.exit(1); });
