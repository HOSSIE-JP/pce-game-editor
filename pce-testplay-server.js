'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const PCE_CD_SYSTEM_CARD_EMULATOR_NAME = 'syscard3.pce';

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
    if (await canBindPort(port)) return port;
  }
  return null;
}

function findPceEmulatorCore(dataDir) {
  const coresDir = path.join(dataDir, 'cores');
  if (!fs.existsSync(coresDir)) return null;
  return fs.readdirSync(coresDir).find((fileName) => /^mednafen_pce.*-wasm\.data$/i.test(fileName)) || null;
}

function resolvePceEmulatorJsRuntime(emulatorJsDir) {
  const root = path.resolve(emulatorJsDir || '');
  const directLoader = path.join(root, 'loader.js');
  const nestedDataDir = path.join(root, 'data');
  const nestedLoader = path.join(nestedDataDir, 'loader.js');

  if (fs.existsSync(directLoader)) {
    return {
      rootDir: path.dirname(root),
      dataDir: root,
      loaderPath: directLoader,
      coreAsset: findPceEmulatorCore(root),
    };
  }
  if (fs.existsSync(nestedLoader)) {
    return {
      rootDir: root,
      dataDir: nestedDataDir,
      loaderPath: nestedLoader,
      coreAsset: findPceEmulatorCore(nestedDataDir),
    };
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
  if (ext === '.pce' || ext === '.bin' || ext === '.iso' || ext === '.data') return 'application/octet-stream';
  return 'application/octet-stream';
}

function sendStaticResponse(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Range',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...headers,
  });
  if (body != null) res.end(body);
  else res.end();
}

function resolveStaticPath(rootDir, requestPath) {
  const root = fs.realpathSync(rootDir);
  const normalizedRequest = decodeURIComponent(String(requestPath || '')).replace(/^\/+/, '');
  const target = path.resolve(root, normalizedRequest);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  const realTarget = fs.realpathSync(target);
  const realRel = path.relative(root, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) return null;
  return realTarget;
}

function createPceTestPlayStaticRoots({ romPath, runtime, systemCardPath = null }) {
  return {
    romPath: path.resolve(romPath),
    mediaRoot: path.resolve(path.dirname(romPath)),
    systemCardPath: systemCardPath ? path.resolve(systemCardPath) : '',
    emulatorRoot: path.resolve(runtime.rootDir),
    dataRoot: path.resolve(runtime.dataDir),
  };
}

function samePceTestPlayStaticRoots(left, right) {
  return Boolean(left && right
    && left.romPath === right.romPath
    && left.mediaRoot === right.mediaRoot
    && left.systemCardPath === right.systemCardPath
    && left.emulatorRoot === right.emulatorRoot
    && left.dataRoot === right.dataRoot);
}

async function startPceTestPlayStaticServer({ roots, preferredPort = 18730, maxOffset = 50 }) {
  const port = await findAvailablePort(preferredPort, maxOffset);
  if (port == null) throw new Error('PCE Test Play local server port is unavailable');

  const server = http.createServer((req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        sendStaticResponse(res, 204, null);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendStaticResponse(res, 405, 'method not allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const parsed = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      let filePath = null;
      if (parsed.pathname.startsWith('/rom/')) {
        filePath = resolveStaticPath(roots.mediaRoot, parsed.pathname.slice('/rom/'.length));
      } else if (parsed.pathname.startsWith('/bios/')) {
        const requested = decodeURIComponent(parsed.pathname.slice('/bios/'.length));
        if (roots.systemCardPath && (requested === path.basename(roots.systemCardPath) || requested === PCE_CD_SYSTEM_CARD_EMULATOR_NAME)) {
          filePath = roots.systemCardPath;
        }
      } else if (parsed.pathname.startsWith('/emulatorjs-data/')) {
        filePath = resolveStaticPath(roots.dataRoot, parsed.pathname.slice('/emulatorjs-data/'.length));
      } else if (parsed.pathname.startsWith('/emulatorjs/')) {
        filePath = resolveStaticPath(roots.emulatorRoot, parsed.pathname.slice('/emulatorjs/'.length));
      }
      if (!filePath) {
        sendStaticResponse(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const stat = fs.statSync(filePath);
      sendStaticResponse(res, 200, req.method === 'HEAD' ? null : fs.readFileSync(filePath), {
        'Content-Type': contentTypeForFile(filePath),
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
      });
    } catch (err) {
      sendStaticResponse(res, 500, String(err?.message || err), { 'Content-Type': 'text/plain; charset=utf-8' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, roots };
}

function stopPceTestPlayStaticServer(server) {
  if (!server) return;
  try { server.close(); } catch (_) {}
}

module.exports = {
  PCE_CD_SYSTEM_CARD_EMULATOR_NAME,
  contentTypeForFile,
  createPceTestPlayStaticRoots,
  findPceEmulatorCore,
  findAvailablePort,
  resolvePceEmulatorJsRuntime,
  resolveStaticPath,
  samePceTestPlayStaticRoots,
  startPceTestPlayStaticServer,
  stopPceTestPlayStaticServer,
};
