'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pce-setup-test-'));
}

function loadPceSetupManager(userData) {
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-setup-manager.js'), { userData });
}

test('PCE setup manager detects llvm-mos PCE-CD companion tools and user-provided BIOS paths', () => {
  const userData = makeTempUserData();
  const binDir = path.join(userData, 'tools', 'llvm-mos-sdk', 'llvm-mos', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'mos-pce-clang.exe' : 'mos-pce-clang'), '', 'utf-8');
  fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'mos-pce-cd-clang.exe' : 'mos-pce-cd-clang'), '', 'utf-8');
  fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'pce-mkcd.exe' : 'pce-mkcd'), '', 'utf-8');
  const ipl = path.join(userData, 'ipl.bin');
  const syscard = path.join(userData, 'syscard3.pce');
  fs.writeFileSync(ipl, Buffer.from([1, 2, 3]));
  fs.writeFileSync(syscard, Buffer.from([4, 5, 6]));

  const setupManager = loadPceSetupManager(userData);
  setupManager.setToolPath('pceCdIpl', ipl);
  setupManager.setToolPath('pceCdSystemCard', syscard);
  const status = setupManager.getStatus();
  const catalog = setupManager.getDownloadCatalog();

  assert.equal(status.llvmMos.configured, true);
  assert.equal(status.llvmMosPceCd.configured, true);
  assert.equal(status.pceMkcd.configured, true);
  assert.equal(status.pceCdIpl.path, ipl);
  assert.equal(status.pceCdSystemCard.path, syscard);
  assert.deepEqual(catalog.tools.map((tool) => tool.kind), ['llvmMos', 'emulatorJs']);
  assert.equal(Object.hasOwn(status, 'superfamiconv'), false);
});

test('PCE setup manager extracts user-owned IPL into portable tools directory', () => {
  const userData = makeTempUserData();
  const source = path.join(userData, 'owned-disc.iso');
  const payload = Buffer.alloc(2048, 0x5a);
  fs.writeFileSync(source, payload);

  const setupManager = loadPceSetupManager(userData);
  const rejected = setupManager.extractPceCdIpl({ sourcePath: source });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /確認/);

  const result = setupManager.extractPceCdIpl({ sourcePath: source, confirmOwnedSource: true });
  const status = setupManager.getStatus();

  assert.equal(result.ok, true);
  assert.equal(path.dirname(result.path), setupManager.getPceCdIplExtractDir());
  assert.equal(fs.readFileSync(result.path).length, 2048);
  assert.equal(status.pceCdIpl.path, result.path);
  assert.equal(result.metadata.sourceFileName, 'owned-disc.iso');
  assert.match(result.metadata.sha256, /^[0-9a-f]{64}$/);
});
