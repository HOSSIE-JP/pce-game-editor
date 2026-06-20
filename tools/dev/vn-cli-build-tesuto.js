const path = require('path');
const Module = require('module');
const mockApp = {
  isPackaged: false,
  getPath: () => path.join(process.cwd(), 'data'),
  getAppPath: () => process.cwd(),
  getName: () => 'pce-test',
  getVersion: () => '0.0.0',
  setPath() {}, on() {}, quit() {},
  whenReady: () => Promise.resolve(), isReady: () => true,
  requestSingleInstanceLock: () => true,
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { app: mockApp, ipcMain: { on(){}, handle(){} }, BrowserWindow: function(){}, dialog: {} };
  return origLoad.apply(this, arguments);
};
const bs = require(path.join(process.cwd(), 'pce-build-system.js'));
const projectDir = path.join(process.cwd(), 'data/projects/テスト');
bs.setProjectDir(projectDir);
const log = (m, lvl='info') => console.log(`[${lvl}] ${m}`);
bs.buildProject(log, {}).then((r) => {
  console.log('RESULT:', JSON.stringify({ success: r.success, error: r.error, rom: r.romPath || r.cuePath }));
  process.exit(r.success ? 0 : 1);
}).catch((e) => { console.error('THREW', e && e.stack || e); process.exit(2); });
