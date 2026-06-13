'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PCE_CD_SYSTEM_CARD_EMULATOR_NAME,
  createPceTestPlayStaticRoots,
  resolvePceEmulatorJsRuntime,
  samePceTestPlayStaticRoots,
  startPceTestPlayStaticServer,
  stopPceTestPlayStaticServer,
} = require('../pce-testplay-server');

function makeRuntime(root) {
  const runtimeDir = path.join(root, 'emulatorjs');
  const dataDir = path.join(runtimeDir, 'data');
  fs.mkdirSync(path.join(dataDir, 'cores'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'loader.js'), 'loader\n');
  fs.writeFileSync(path.join(dataDir, 'cores', 'mednafen_pce-fast-wasm.data'), 'core\n');
  return { runtimeDir, runtime: resolvePceEmulatorJsRuntime(runtimeDir) };
}

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('PCE testplay server resolves EmulatorJS runtime layouts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-testplay-runtime-'));
  const { runtimeDir, runtime } = makeRuntime(root);

  assert.equal(runtime.rootDir, runtimeDir);
  assert.equal(runtime.dataDir, path.join(runtimeDir, 'data'));
  assert.equal(runtime.loaderPath, path.join(runtimeDir, 'data', 'loader.js'));
  assert.equal(runtime.coreAsset, 'mednafen_pce-fast-wasm.data');
});

test('PCE testplay server serves rom, bios, and EmulatorJS files inside allowed roots', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-testplay-server-'));
  const mediaRoot = path.join(root, 'media');
  fs.mkdirSync(mediaRoot, { recursive: true });
  const romPath = path.join(mediaRoot, 'game.pce');
  const systemCardPath = path.join(root, 'syscard.pce');
  fs.writeFileSync(romPath, Buffer.from([0x50, 0x43, 0x45]));
  fs.writeFileSync(systemCardPath, Buffer.from([0x53, 0x43]));
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside');
  const { runtime } = makeRuntime(root);
  const roots = createPceTestPlayStaticRoots({ romPath, runtime, systemCardPath });
  const started = await startPceTestPlayStaticServer({ roots, preferredPort: 0, maxOffset: 0 });

  try {
    const rom = await request(started.port, '/rom/game.pce');
    assert.equal(rom.statusCode, 200);
    assert.equal(rom.headers['content-type'], 'application/octet-stream');
    assert.deepEqual([...rom.body], [0x50, 0x43, 0x45]);

    const loader = await request(started.port, '/emulatorjs-data/loader.js', 'HEAD');
    assert.equal(loader.statusCode, 200);
    assert.equal(loader.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(loader.body.length, 0);

    const bios = await request(started.port, `/bios/${PCE_CD_SYSTEM_CARD_EMULATOR_NAME}`);
    assert.equal(bios.statusCode, 200);
    assert.deepEqual([...bios.body], [0x53, 0x43]);

    const escaped = await request(started.port, '/rom/../outside.txt');
    assert.equal(escaped.statusCode, 404);
  } finally {
    stopPceTestPlayStaticServer(started.server);
  }
});

test('PCE testplay server root comparison detects reusable server roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-testplay-roots-'));
  const mediaRoot = path.join(root, 'media');
  fs.mkdirSync(mediaRoot, { recursive: true });
  const romPath = path.join(mediaRoot, 'game.pce');
  fs.writeFileSync(romPath, '');
  const { runtime } = makeRuntime(root);

  const left = createPceTestPlayStaticRoots({ romPath, runtime });
  const right = createPceTestPlayStaticRoots({ romPath, runtime });
  const other = createPceTestPlayStaticRoots({ romPath: path.join(mediaRoot, 'other.pce'), runtime });

  assert.equal(samePceTestPlayStaticRoots(left, right), true);
  assert.equal(samePceTestPlayStaticRoots(left, other), false);
});
