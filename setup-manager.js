'use strict';

/**
 * setup-manager.js
 * SGDK / Java の存在確認・自動ダウンロード・セットアップ管理
 * Main process 専用モジュール
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync, spawn } = require('child_process');
const { app } = require('electron');

const SGDK_OWNER = 'Stephane-D';
const SGDK_REPO = 'SGDK';
const MARSDEV_OWNER = 'andwn';
const MARSDEV_REPO = 'marsdev';
const NUKED_OPN2_OWNER = 'nukeykt';
const NUKED_OPN2_REPO = 'Nuked-OPN2';
const EMSDK_OWNER = 'emscripten-core';
const EMSDK_REPO = 'emsdk';
const EMSDK_BRANCH = 'main';

// ------------------------------------------------------------------ paths --

function getToolsDir() {
  return path.join(app.getPath('userData'), 'tools');
}

function getSgdkBaseDir() {
  return path.join(getToolsDir(), 'sgdk');
}

function getJreBaseDir() {
  return path.join(getToolsDir(), 'jre');
}

function getMarsdevBaseDir() {
  return path.join(getToolsDir(), 'marsdev');
}

function getEmsdkBaseDir() {
  return path.join(getToolsDir(), 'emsdk');
}

function getAudioEngineBaseDir() {
  return path.join(getToolsDir(), 'audio-engines');
}

function getNukedOpn2BaseDir() {
  return path.join(getAudioEngineBaseDir(), 'nuked-opn2');
}

function getSettingsPath() {
  return path.join(getToolsDir(), 'settings.json');
}

const TESTPLAY_ACTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'C', 'START'];
const TESTPLAY_VRAM_LAYOUTS = ['256x512', '512x256', '128x1024', '1024x128'];
const DEFAULT_TESTPLAY_SETTINGS = Object.freeze({
  keyboard: Object.freeze({
    UP: 'ArrowUp',
    DOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    A: 'KeyA',
    B: 'KeyZ',
    C: 'KeyX',
    START: 'Enter',
  }),
  gamepad: Object.freeze({
    UP: 'button:12',
    DOWN: 'button:13',
    LEFT: 'button:14',
    RIGHT: 'button:15',
    A: 'button:2',
    B: 'button:0',
    C: 'button:1',
    START: 'button:9',
  }),
  gamepadDeadzone: 0.5,
  debug: Object.freeze({
    autoRefresh: true,
    vramTileLayout: '256x512',
  }),
});

function cloneDefaultTestPlaySettings() {
  return {
    keyboard: { ...DEFAULT_TESTPLAY_SETTINGS.keyboard },
    gamepad: { ...DEFAULT_TESTPLAY_SETTINGS.gamepad },
    gamepadDeadzone: DEFAULT_TESTPLAY_SETTINGS.gamepadDeadzone,
    debug: { ...DEFAULT_TESTPLAY_SETTINGS.debug },
  };
}

function normalizeBindingMap(candidate, fallback) {
  const result = { ...fallback };
  if (!candidate || typeof candidate !== 'object') {
    return result;
  }
  for (const action of TESTPLAY_ACTIONS) {
    const value = candidate[action];
    if (typeof value === 'string' && value.trim()) {
      result[action] = value.trim();
    }
  }
  return result;
}

function normalizeTestPlaySettings(candidate = {}) {
  const normalized = cloneDefaultTestPlaySettings();
  if (!candidate || typeof candidate !== 'object') {
    return normalized;
  }

  normalized.keyboard = normalizeBindingMap(candidate.keyboard, DEFAULT_TESTPLAY_SETTINGS.keyboard);
  normalized.gamepad = normalizeBindingMap(candidate.gamepad, DEFAULT_TESTPLAY_SETTINGS.gamepad);

  if (typeof candidate.gamepadDeadzone === 'number' && Number.isFinite(candidate.gamepadDeadzone)) {
    normalized.gamepadDeadzone = Math.min(0.95, Math.max(0.05, candidate.gamepadDeadzone));
  }

  if (candidate.debug && typeof candidate.debug === 'object') {
    if (typeof candidate.debug.autoRefresh === 'boolean') {
      normalized.debug.autoRefresh = candidate.debug.autoRefresh;
    }
    if (typeof candidate.debug.vramTileLayout === 'string' && TESTPLAY_VRAM_LAYOUTS.includes(candidate.debug.vramTileLayout)) {
      normalized.debug.vramTileLayout = candidate.debug.vramTileLayout;
    }
  }

  return normalized;
}

function getDefaultTestPlaySettings() {
  return cloneDefaultTestPlaySettings();
}

function getTestPlaySettings() {
  const settings = loadSettings();
  return normalizeTestPlaySettings(settings.testPlay);
}

function saveTestPlaySettings(next) {
  const current = getTestPlaySettings();
  const merged = {
    keyboard: { ...current.keyboard, ...(next && typeof next.keyboard === 'object' ? next.keyboard : {}) },
    gamepad: { ...current.gamepad, ...(next && typeof next.gamepad === 'object' ? next.gamepad : {}) },
    gamepadDeadzone: next && Object.prototype.hasOwnProperty.call(next, 'gamepadDeadzone')
      ? next.gamepadDeadzone
      : current.gamepadDeadzone,
    debug: { ...current.debug, ...(next && typeof next.debug === 'object' ? next.debug : {}) },
  };
  const normalized = normalizeTestPlaySettings(merged);
  saveSettings({ testPlay: normalized });
  return normalized;
}

// ---------------------------------------------------------------- settings --

function loadSettings() {
  const p = getSettingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(obj) {
  const dir = getToolsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = loadSettings();
  fs.writeFileSync(getSettingsPath(), JSON.stringify({ ...current, ...obj }, null, 2), 'utf-8');
}

// ------------------------------------------------------------- SGDK path --

/**
 * 自動展開先のディレクトリ内の最初のサブディレクトリを返す
 * GitHub から DL した zip は SGDK-X.XX/ という名前のサブフォルダになる
 */
function findExtractedSgdkDir() {
  const base = getSgdkBaseDir();
  if (!fs.existsSync(base)) return null;
  const entries = fs.readdirSync(base).filter((e) => {
    try { return fs.statSync(path.join(base, e)).isDirectory(); } catch { return false; }
  });
  if (entries.length === 0) {
    return null;
  }

  const parseVer = (name) => {
    const m = name.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  };

  entries.sort((a, b) => {
    const va = parseVer(a);
    const vb = parseVer(b);
    for (let i = 0; i < 3; i += 1) {
      if (va[i] !== vb[i]) return vb[i] - va[i];
    }
    return b.localeCompare(a);
  });

  return path.join(base, entries[0]);
}

function getSgdkPath() {
  const settings = loadSettings();
  if (settings.sgdkPath && fs.existsSync(settings.sgdkPath)) {
    return settings.sgdkPath;
  }
  return findExtractedSgdkDir();
}

function setSgdkPath(p) {
  saveSettings({ sgdkPath: p });
}

// --------------------------------------------------------- Marsdev path --

function findExtractedMarsdevDir() {
  const base = getMarsdevBaseDir();
  if (!fs.existsSync(base)) return null;
  const entries = fs.readdirSync(base).filter((e) => {
    try { return fs.statSync(path.join(base, e)).isDirectory(); } catch { return false; }
  });
  if (entries.length === 0) {
    return null;
  }

  const parseVer = (name) => {
    const m = name.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  };

  entries.sort((a, b) => {
    const va = parseVer(a);
    const vb = parseVer(b);
    for (let i = 0; i < 3; i += 1) {
      if (va[i] !== vb[i]) return vb[i] - va[i];
    }
    return b.localeCompare(a);
  });

  return path.join(base, entries[0]);
}

function resolveMarsdevGdkPath(basePath) {
  if (!basePath || !fs.existsSync(basePath)) return null;
  if (fs.existsSync(path.join(basePath, 'makelib.gen'))) {
    return basePath;
  }
  const gdkPath = path.join(basePath, 'm68k-elf');
  if (fs.existsSync(path.join(gdkPath, 'makelib.gen'))) {
    return gdkPath;
  }
  return null;
}

function getMarsdevPath() {
  const settings = loadSettings();
  if (settings.marsdevPath && fs.existsSync(settings.marsdevPath)) {
    const resolved = resolveMarsdevGdkPath(settings.marsdevPath);
    if (resolved) return resolved;
  }
  return resolveMarsdevGdkPath(findExtractedMarsdevDir());
}

function setMarsdevPath(p) {
  saveSettings({ marsdevPath: p });
}

// ------------------------------------------------------------- Emscripten --

function findExtractedEmsdkDir() {
  const base = getEmsdkBaseDir();
  if (!fs.existsSync(base)) return null;
  const candidates = [base, ...fs.readdirSync(base).map((entry) => path.join(base, entry))];
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isDirectory()) continue;
      const command = getEmsdkCommand(candidate);
      if (command && fs.existsSync(command)) return candidate;
    } catch {
      // ignore invalid entries
    }
  }
  return null;
}

function getEmsdkPath() {
  const settings = loadSettings();
  if (settings.emsdkPath && fs.existsSync(settings.emsdkPath)) return settings.emsdkPath;
  return findExtractedEmsdkDir();
}

function getEmsdkCommand(emsdkPath = getEmsdkPath()) {
  if (!emsdkPath) return null;
  return path.join(emsdkPath, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk');
}

function getEmccPath(emsdkPath = getEmsdkPath()) {
  if (!emsdkPath) return null;
  return path.join(emsdkPath, 'upstream', 'emscripten', process.platform === 'win32' ? 'emcc.bat' : 'emcc');
}

function getEmsdkEnv(emsdkPath = getEmsdkPath()) {
  if (!emsdkPath) return { ...process.env };
  const emscriptenDir = path.join(emsdkPath, 'upstream', 'emscripten');
  const binaryenDir = path.join(emsdkPath, 'upstream', 'bin');
  const nodeDir = path.join(emsdkPath, 'node');
  return {
    ...process.env,
    EMSDK: emsdkPath,
    EM_CONFIG: path.join(emsdkPath, '.emscripten'),
    PATH: [emscriptenDir, binaryenDir, nodeDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter),
  };
}

function getCommandVersion(command, args = ['-v'], options = {}) {
  if (!command || !fs.existsSync(command)) return null;
  try {
    const result = require('child_process').spawnSync(command, args, {
      cwd: options.cwd || path.dirname(command),
      env: options.env || process.env,
      encoding: 'utf-8',
      windowsHide: true,
      timeout: options.timeout || 10000,
    });
    const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return out.split(/\r?\n/).find(Boolean) || null;
  } catch {
    return null;
  }
}

function checkEmsdk() {
  const emsdkPath = getEmsdkPath();
  const command = getEmsdkCommand(emsdkPath);
  const emccPath = getEmccPath(emsdkPath);
  const installed = !!(emsdkPath && command && fs.existsSync(command));
  const emccInstalled = !!(emccPath && fs.existsSync(emccPath));
  const settings = loadSettings();
  const emccVersion = emccInstalled
    ? (settings.emccVersion || getCommandVersion(emccPath, ['-v'], { cwd: emsdkPath, env: getEmsdkEnv(emsdkPath) }))
    : null;
  return {
    installed,
    path: installed ? emsdkPath : null,
    command: installed ? command : null,
    emccPath: emccInstalled ? emccPath : null,
    emccInstalled,
    emccVersion,
    source: `${EMSDK_OWNER}/${EMSDK_REPO}`,
  };
}

// ------------------------------------------------------ optional audio cores --

function findExtractedNukedOpn2Dir() {
  const base = getNukedOpn2BaseDir();
  if (!fs.existsSync(base)) return null;
  const candidates = [base, ...fs.readdirSync(base).map((entry) => path.join(base, entry))];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) continue;
      if (
        fs.existsSync(path.join(candidate, 'ym3438.c'))
        && fs.existsSync(path.join(candidate, 'ym3438.h'))
        && fs.existsSync(path.join(candidate, 'LICENSE'))
      ) {
        return candidate;
      }
    } catch {
      // ignore invalid entries
    }
  }
  return null;
}

function getNukedOpn2Path() {
  const settings = loadSettings();
  if (settings.nukedOpn2Path && fs.existsSync(settings.nukedOpn2Path)) {
    return settings.nukedOpn2Path;
  }
  return findExtractedNukedOpn2Dir();
}

function checkNukedOpn2() {
  const sourcePath = getNukedOpn2Path();
  if (!sourcePath) {
    return {
      installed: false,
      sourcePath: null,
      wasmPath: null,
      wasmInstalled: false,
      license: 'LGPL-2.1-or-later',
      source: `${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}`,
    };
  }
  const wasmCandidates = [
    path.join(sourcePath, 'build', 'dist', 'nuked-opn2.wasm'),
    path.join(sourcePath, 'dist', 'nuked-opn2.wasm'),
    path.join(sourcePath, 'nuked-opn2.wasm'),
  ];
  const wasmPath = wasmCandidates.find((candidate) => fs.existsSync(candidate)) || null;
  const jsPath = wasmPath ? path.join(path.dirname(wasmPath), 'nuked-opn2.js') : null;
  const buildInfoPath = wasmPath ? path.join(path.dirname(wasmPath), 'BUILD_INFO.json') : null;
  return {
    installed: true,
    sourcePath,
    jsPath: jsPath && fs.existsSync(jsPath) ? jsPath : null,
    wasmPath,
    wasmInstalled: !!wasmPath,
    buildInfoPath: buildInfoPath && fs.existsSync(buildInfoPath) ? buildInfoPath : null,
    licensePath: fs.existsSync(path.join(sourcePath, 'LICENSE')) ? path.join(sourcePath, 'LICENSE') : null,
    license: 'LGPL-2.1-or-later',
    source: `${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}`,
  };
}

function checkSgdk() {
  const p = getSgdkPath();
  if (!p) return { installed: false, path: null, version: null };
  const makelib = path.join(p, 'makelib.gen');
  const installed = fs.existsSync(makelib);
  // バージョンをディレクトリ名から推定
  const version = path.basename(p).replace(/^SGDK-?/i, '') || 'unknown';
  return { installed, path: installed ? p : null, version };
}

function checkMarsdev() {
  const p = getMarsdevPath();
  if (!p) return { installed: false, path: null, version: null };
  const makelib = path.join(p, 'makelib.gen');
  const installed = fs.existsSync(makelib);
  const settings = loadSettings();
  let version = settings.marsdevVersion || 'unknown';
  if (!settings.marsdevVersion) {
    // 旧レイアウト向けにディレクトリ名から推定（失敗時は unknown）
    const guessed = path.basename(path.dirname(path.dirname(p))).replace(/^marsdev-?/i, '');
    if (guessed && /\d/.test(guessed)) {
      version = guessed;
    }
  }
  return { installed, path: installed ? p : null, version };
}

function findFirstExisting(baseDir, relativeCandidates) {
  for (const rel of relativeCandidates) {
    const abs = path.join(baseDir, rel);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }
  return null;
}

function getBundledTools(toolchainPath, isMarsdev = false) {
  if (!toolchainPath || !fs.existsSync(toolchainPath)) {
    return { make: null, gcc: null, java: null, as: null };
  }

  const isWin = process.platform === 'win32';

  let make, gcc, java, as;

  if (isMarsdev || process.platform !== 'win32') {
    // Marsdev or Unix-like platform: look for native binaries
    make = findFirstExisting(toolchainPath, ['bin/make', 'make']);
    gcc = findFirstExisting(toolchainPath, [
      'bin/m68k-elf-gcc',
      'm68k-elf-gcc',
      'bin/gcc',
      'gcc',
    ]);
    as = findFirstExisting(toolchainPath, [
      'bin/m68k-elf-as',
      'm68k-elf-as',
      'bin/as',
      'as',
    ]);
    java = findFirstExisting(toolchainPath, [
      'bin/java',
      'java',
    ]);
  } else {
    // Windows: prefer .exe versions
    make = findFirstExisting(toolchainPath, [
      'bin/make/make.exe',
      'bin/make.exe',
    ]);
    gcc = findFirstExisting(toolchainPath, [
      'bin/gcc/bin/m68k-elf-gcc.exe',
      'bin/m68k-elf-gcc.exe',
      'bin/gcc.exe',
    ]);
    java = findFirstExisting(toolchainPath, [
      'bin/java/bin/java.exe',
      'bin/java/bin/java',
    ]);
  }

  return { make, gcc, java, as };
}

function getSgdkBundledTools(sgdkPath) {
  return getBundledTools(sgdkPath, false);
}

function getMarsdevBundledTools(marsdevPath) {
  return getBundledTools(marsdevPath, true);
}

function fileContains(filePath, pattern) {
  try {
    return pattern.test(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return false;
  }
}

function toolchainSupportsXgm2(toolchainPath) {
  if (!toolchainPath || !fs.existsSync(toolchainPath)) return false;
  const xgm2Header = path.join(toolchainPath, 'inc', 'snd', 'xgm2.h');
  const z80Header = path.join(toolchainPath, 'inc', 'z80_ctrl.h');
  const rescompDoc = path.join(toolchainPath, 'bin', 'rescomp.txt');
  const xgm2Tool = path.join(toolchainPath, 'bin', 'xgm2tool.jar');
  const rescompDocOk = !fs.existsSync(rescompDoc) || fileContains(rescompDoc, /\bXGM2\b/);

  return fs.existsSync(xgm2Header)
    && fs.existsSync(xgm2Tool)
    && fileContains(z80Header, /\bZ80_DRIVER_XGM2\b/)
    && rescompDocOk;
}

// -------------------------------------------------------------- Java path --

function findExtractedJreDir() {
  const base = getJreBaseDir();
  if (!fs.existsSync(base)) return null;
  const entries = fs.readdirSync(base).filter((e) => {
    try { return fs.statSync(path.join(base, e)).isDirectory(); } catch { return false; }
  });
  if (entries.length === 0) return null;
  const javaExe = path.join(base, entries[0], 'bin', 'java.exe');
  return fs.existsSync(javaExe) ? path.join(base, entries[0]) : null;
}

function getJavaExePath() {
  const settings = loadSettings();
  if (settings.javaPath) {
    const abs = settings.javaPath.endsWith('java') || settings.javaPath.endsWith('java.exe')
      ? settings.javaPath
      : path.join(settings.javaPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(abs)) return abs;
  }

  const sgdkPath = getSgdkPath();
  const bundled = getSgdkBundledTools(sgdkPath).java;
  if (bundled) {
    return bundled;
  }

  if (process.platform === 'win32') {
    // 別途 DL した JRE
    const jreDir = findExtractedJreDir();
    if (jreDir) return path.join(jreDir, 'bin', 'java.exe');
    return null;
  }

  // macOS/Linux: システム java を確認
  try {
    execSync('java -version', { stdio: 'ignore' });
    return 'java';
  } catch {
    return null;
  }
}

function checkJava() {
  const javaBin = getJavaExePath();
  if (!javaBin) {
    return { installed: false, system: process.platform !== 'win32', path: null };
  }
  return {
    installed: true,
    system: javaBin === 'java',
    path: javaBin,
  };
}

function checkM68kGcc() {
  if (process.platform === 'win32') {
    // Windows: SGDK bundled tools only
    const sgdkPath = getSgdkPath();
    if (!sgdkPath) return { installed: false, path: null, source: 'none' };
    const tools = getSgdkBundledTools(sgdkPath);
    return {
      installed: !!tools.gcc,
      path: tools.gcc,
      source: 'sgdk',
    };
  }

  // macOS/Linux: Marsdev → SGDK (if native) → system
  const marsdevPath = getMarsdevPath();
  if (marsdevPath) {
    const tools = getMarsdevBundledTools(marsdevPath);
    if (tools.gcc) {
      return { installed: true, path: tools.gcc, source: 'marsdev' };
    }
  }

  const sgdkPath = getSgdkPath();
  if (sgdkPath) {
    const tools = getSgdkBundledTools(sgdkPath);
    if (tools.gcc) {
      return { installed: true, path: tools.gcc, source: 'sgdk' };
    }
  }

  try {
    const which = execSync('which m68k-elf-gcc', { encoding: 'utf-8' }).trim();
    if (which) {
      return { installed: true, path: which, source: 'system' };
    }
  } catch (_err) {
  }

  return { installed: false, path: null, source: 'none' };
}

function tryPatchMachODylib(binaryPath, oldPath, newPath) {
  const { spawnSync } = require('child_process');
  const inspect = spawnSync('otool', ['-L', binaryPath], { encoding: 'utf-8' });
  if (inspect.status !== 0 || !String(inspect.stdout || '').includes(oldPath)) {
    return false;
  }
  const patch = spawnSync('install_name_tool', ['-change', oldPath, newPath, binaryPath], { encoding: 'utf-8' });
  return patch.status === 0;
}

function getMachOArches(filePath) {
  const { spawnSync } = require('child_process');
  const res = spawnSync('lipo', ['-archs', filePath], { encoding: 'utf-8' });
  if (res.status !== 0) return [];
  return String(res.stdout || '').trim().split(/\s+/).filter(Boolean);
}

function ensureMarsdevX64Libintl() {
  const targetDir = path.join(getToolsDir(), 'marsdev', 'runtime-lib', 'x86_64');
  const targetLib = path.join(targetDir, 'libintl.8.dylib');
  if (fs.existsSync(targetLib) && getMachOArches(targetLib).includes('x86_64')) {
    return { ok: true, path: targetLib, source: 'cache' };
  }

  const { spawnSync, execSync } = require('child_process');
  try {
    const formulaJson = execSync('curl -fsSL https://formulae.brew.sh/api/formula/gettext.json', { encoding: 'utf-8' });
    const formula = JSON.parse(formulaJson);
    const files = formula?.bottle?.stable?.files || {};

    // Select Intel macOS bottle dynamically.
    // Newer Homebrew keys can be like: arm64_tahoe, arm64_sequoia, sonoma, etc.
    // We need non-arm64 and non-linux key.
    const allKeys = Object.keys(files);
    const intelMacKeys = allKeys.filter((k) => {
      const key = String(k || '').toLowerCase();
      return !key.startsWith('arm64_') && !key.includes('linux');
    });

    // Prefer newer macOS keys first if multiple exist.
    const keyPriority = ['tahoe', 'sequoia', 'sonoma', 'ventura', 'monterey', 'big_sur', 'catalina', 'mojave', 'high_sierra'];
    intelMacKeys.sort((a, b) => {
      const ai = keyPriority.indexOf(String(a).toLowerCase());
      const bi = keyPriority.indexOf(String(b).toLowerCase());
      const ar = ai === -1 ? 999 : ai;
      const br = bi === -1 ? 999 : bi;
      return ar - br;
    });

    let bottleUrl = null;
    for (const tag of intelMacKeys) {
      if (files[tag] && files[tag].url) {
        bottleUrl = files[tag].url;
        break;
      }
    }
    if (!bottleUrl) {
      return { ok: false, error: 'x86_64 gettext bottle URL was not found in formula metadata.' };
    }

    const tmpDir = path.join(getToolsDir(), 'tmp-gettext-x64');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const bottlePath = path.join(tmpDir, 'gettext-x64.tar.gz');

    const dl = spawnSync('curl', ['-fL', bottleUrl, '-o', bottlePath], { encoding: 'utf-8' });
    if (dl.status !== 0 || !fs.existsSync(bottlePath)) {
      return { ok: false, error: 'Failed to download x86_64 gettext bottle.' };
    }

    const list = spawnSync('tar', ['-tzf', bottlePath], { encoding: 'utf-8' });
    if (list.status !== 0) {
      return { ok: false, error: 'Failed to inspect gettext bottle archive.' };
    }
    const lines = String(list.stdout || '').split('\n');
    const dylibEntry = lines.find((l) => l.endsWith('/lib/libintl.8.dylib'));
    if (!dylibEntry) {
      return { ok: false, error: 'libintl.8.dylib not found inside gettext bottle.' };
    }

    const extract = spawnSync('tar', ['-xzf', bottlePath, '-C', tmpDir, dylibEntry], { encoding: 'utf-8' });
    if (extract.status !== 0) {
      return { ok: false, error: 'Failed to extract libintl.8.dylib from gettext bottle.' };
    }

    const extractedPath = path.join(tmpDir, dylibEntry);
    if (!fs.existsSync(extractedPath)) {
      return { ok: false, error: 'Extracted libintl.8.dylib path was not found.' };
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(extractedPath, targetLib);

    if (!getMachOArches(targetLib).includes('x86_64')) {
      return { ok: false, error: 'Extracted libintl.8.dylib is not x86_64 architecture.' };
    }

    return { ok: true, path: targetLib, source: 'download' };
  } catch (err) {
    return { ok: false, error: `Failed to prepare x86_64 libintl: ${err.message || String(err)}` };
  }
}

function fixMarsdevMacosGettext(marsdevPath) {
  if (process.platform !== 'darwin') {
    return { ok: true, patched: 0, reason: 'not-macos' };
  }
  if (!marsdevPath || !fs.existsSync(marsdevPath)) {
    return { ok: false, patched: 0, error: 'Marsdev path is not set' };
  }

  const legacyIntl = '/usr/local/opt/gettext/lib/libintl.8.dylib';
  const armIntl = '/opt/homebrew/opt/gettext/lib/libintl.8.dylib';

  const gccBin = path.join(marsdevPath, 'bin', 'm68k-elf-gcc');
  const gccArches = fs.existsSync(gccBin) ? getMachOArches(gccBin) : [];
  if (gccArches.length === 0) {
    return { ok: false, patched: 0, error: `Cannot inspect Marsdev binary architecture: ${gccBin}` };
  }

  let targetIntl = null;
  let targetArch = null;

  if (gccArches.includes('x86_64')) {
    targetArch = 'x86_64';
    if (fs.existsSync(legacyIntl) && getMachOArches(legacyIntl).includes('x86_64')) {
      targetIntl = legacyIntl;
    } else {
      const localLib = ensureMarsdevX64Libintl();
      if (localLib.ok) {
        targetIntl = localLib.path;
      } else {
        return {
          ok: false,
          patched: 0,
          error: `${localLib.error}\nMarsdev が x86_64 バイナリのため、x86_64 の gettext が必要です。\n自動復旧に失敗した場合は Intel Homebrew で gettext を導入してください。\n例:\n1) softwareupdate --install-rosetta --agree-to-license\n2) arch -x86_64 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n3) arch -x86_64 /usr/local/bin/brew install gettext\n4) その後に再ビルド\n※ /usr/local/bin/brew が無い場合は Intel Homebrew の導入が未完了です。`,
        };
      }
    }
  } else if (gccArches.includes('arm64')) {
    targetArch = 'arm64';
    if (fs.existsSync(armIntl) && getMachOArches(armIntl).includes('arm64')) {
      targetIntl = armIntl;
    } else {
      return {
        ok: false,
        patched: 0,
        error: 'Marsdev が arm64 バイナリですが、`/opt/homebrew/opt/gettext/lib/libintl.8.dylib` (arm64) が見つかりません。`brew install gettext` を実行してください。',
      };
    }
  } else {
    return {
      ok: false,
      patched: 0,
      error: `Unsupported Marsdev binary architecture: ${gccArches.join(', ')}`,
    };
  }

  const binDir = path.join(marsdevPath, 'bin');
  if (!fs.existsSync(binDir)) {
    return { ok: false, patched: 0, error: `Marsdev bin directory not found: ${binDir}` };
  }

  const entries = fs.readdirSync(binDir);
  let patched = 0;
  for (const e of entries) {
    const p = path.join(binDir, e);
    let st;
    try {
      st = fs.statSync(p);
    } catch (_err) {
      continue;
    }
    if (!st.isFile()) continue;
    if ((st.mode & 0o111) === 0) continue;

    try {
      // 旧参照 -> 目標参照 の補正（両方向に対応してアーキ不一致を解消）
      for (const candidate of [legacyIntl, armIntl]) {
        if (candidate === targetIntl) continue;
        if (tryPatchMachODylib(p, candidate, targetIntl)) {
          patched += 1;
        }
      }
    } catch (_err) {
      // Ignore single-file patch errors and continue.
    }
  }

  return { ok: true, patched, reason: `patched-or-already-healthy (${targetArch})` };
}

// ---------------------------------------------------------------- network --

function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = { ...options, headers: { 'User-Agent': 'md-game-editor/1.0', ...(options.headers || {}) } };
    const req = https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGet(res.headers.location, options));
        return;
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

function downloadToFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      const opts = { headers: { 'User-Agent': 'md-game-editor/1.0' } };
      https.get(u, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received, total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
        res.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    };
    doGet(url);
  });
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function normalizeSpawnCommand(command, args) {
  if (process.platform !== 'win32' || !/\.bat$/i.test(command)) {
    return { command, args };
  }
  const line = [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(' ');
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', line] };
}

function runProcess(command, args, options = {}, onProgress) {
  return new Promise((resolve) => {
    const normalized = normalizeSpawnCommand(command, args);
    let settled = false;
    let lastProgressAt = Date.now();
    const timeoutMs = options.timeoutMs || 45 * 60 * 1000;
    const heartbeatMs = options.heartbeatMs || 15000;
    const proc = spawn(normalized.command, normalized.args, {
      cwd: options.cwd || undefined,
      env: options.env || process.env,
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      lastProgressAt = Date.now();
      onProgress && onProgress({ phase: options.phase || 'run', message: text.trim().slice(-200) || options.message || command, percent: options.percent || 0 });
    });
    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      lastProgressAt = Date.now();
      onProgress && onProgress({ phase: options.phase || 'run', message: text.trim().slice(-200) || options.message || command, percent: options.percent || 0 });
    });
    const heartbeat = setInterval(() => {
      if (Date.now() - lastProgressAt >= heartbeatMs) {
        onProgress && onProgress({ phase: options.phase || 'run', message: options.message || `${path.basename(command)} is still running...`, percent: options.percent || 0 });
        lastProgressAt = Date.now();
      }
    }, heartbeatMs);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      proc.kill();
      resolve({ ok: false, code: -1, stdout, stderr, error: `${path.basename(command)} timed out` });
    }, timeoutMs);
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr, error: error.message });
    });
    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, error: code === 0 ? null : `${path.basename(command)} exited with code ${code}` });
    });
  });
}

async function getLatestSgdkRelease() {
  const url = `https://api.github.com/repos/${SGDK_OWNER}/${SGDK_REPO}/releases/latest`;
  const res = await httpsGet(url);
  if (res.statusCode !== 200) throw new Error(`GitHub API returned ${res.statusCode}`);
  const data = JSON.parse(res.body);
  const tag = data.tag_name; // e.g. "v2.00"
  const zipUrl = `https://github.com/${SGDK_OWNER}/${SGDK_REPO}/archive/refs/tags/${tag}.zip`;
  return { tag, zipUrl, name: data.name };
}

async function listSgdkReleases(limit = 20) {
  const url = `https://api.github.com/repos/${SGDK_OWNER}/${SGDK_REPO}/releases?per_page=${Math.max(1, Math.min(limit, 50))}`;
  const res = await httpsGet(url);
  if (res.statusCode !== 200) throw new Error(`GitHub API returned ${res.statusCode}`);
  const data = JSON.parse(res.body);
  const releases = (Array.isArray(data) ? data : [])
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      prerelease: !!r.prerelease,
      publishedAt: r.published_at || null,
    }));
  return { releases };
}

async function listMarsdevReleases(limit = 20) {
  const url = `https://api.github.com/repos/${MARSDEV_OWNER}/${MARSDEV_REPO}/releases?per_page=${Math.max(1, Math.min(limit, 50))}`;
  const res = await httpsGet(url);
  if (res.statusCode !== 200) throw new Error(`GitHub API returned ${res.statusCode}`);
  const data = JSON.parse(res.body);
  const releases = (Array.isArray(data) ? data : [])
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      prerelease: !!r.prerelease,
      publishedAt: r.published_at || null,
    }));
  return { releases };
}

// -------------------------------------------------------------- extraction --

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    let proc;
    if (process.platform === 'win32') {
      proc = spawn('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`,
      ], { windowsHide: true });
    } else {
      proc = spawn('unzip', ['-q', '-o', zipPath, '-d', destDir]);
    }

    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function extractTarGz(tarPath, destDir) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const proc = spawn('tar', ['-xf', tarPath, '-C', destDir]);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// ---------------------------------------------------------------- download --

async function downloadSgdk(selectedTag, onProgress) {
  let tag = selectedTag;
  let zipUrl;

  if (!tag) {
    const latest = await getLatestSgdkRelease();
    tag = latest.tag;
    zipUrl = latest.zipUrl;
  } else {
    zipUrl = `https://github.com/${SGDK_OWNER}/${SGDK_REPO}/archive/refs/tags/${tag}.zip`;
  }

  const toolsDir = getToolsDir();
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });

  const zipPath = path.join(toolsDir, `sgdk-${tag}.zip`);

  onProgress && onProgress({ phase: 'download', message: `Downloading SGDK ${tag}...`, percent: 0 });
  await downloadToFile(zipUrl, zipPath, (received, total) => {
    onProgress && onProgress({ phase: 'download', message: `Downloading SGDK ${tag}...`, percent: Math.round((received / total) * 70) });
  });

  onProgress && onProgress({ phase: 'extract', message: 'Extracting...', percent: 75 });
  const sgdkBase = getSgdkBaseDir();
  if (fs.existsSync(sgdkBase)) fs.rmSync(sgdkBase, { recursive: true, force: true });
  await extractZip(zipPath, sgdkBase);

  // 展開後 zip を削除
  fs.unlink(zipPath, () => {});

  onProgress && onProgress({ phase: 'done', message: `SGDK ${tag} installed`, percent: 100 });
  return { ok: true, tag };
}

async function downloadMarsdev(selectedTag, onProgress) {
  let tag = selectedTag;
  let release;

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return { ok: false, error: 'Marsdev is only available for macOS and Linux' };
  }

  if (!tag) {
    const url = `https://api.github.com/repos/${MARSDEV_OWNER}/${MARSDEV_REPO}/releases/latest`;
    const res = await httpsGet(url);
    if (res.statusCode !== 200) throw new Error(`GitHub API returned ${res.statusCode}`);
    release = JSON.parse(res.body);
    tag = release.tag_name;
  } else {
    const url = `https://api.github.com/repos/${MARSDEV_OWNER}/${MARSDEV_REPO}/releases/tags/${tag}`;
    const res = await httpsGet(url);
    if (res.statusCode !== 200) throw new Error(`GitHub API returned ${res.statusCode}`);
    release = JSON.parse(res.body);
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const platformTokens = process.platform === 'darwin'
    ? ['macos', 'darwin']
    : ['linux'];
  const archTokens = process.arch === 'arm64'
    ? ['arm64', 'aarch64']
    : ['x86_64', 'x64', 'amd64'];

  const isSupportedArchive = (name) => (
    name.endsWith('.tar.xz') || name.endsWith('.tar.gz') || name.endsWith('.zip')
  );

  const platformAssets = assets.filter((a) => {
    const n = String(a.name || '').toLowerCase();
    return isSupportedArchive(n) && platformTokens.some((t) => n.includes(t));
  });

  const preferredAsset = platformAssets.find((a) => {
    const n = String(a.name || '').toLowerCase();
    return archTokens.some((t) => n.includes(t));
  }) || platformAssets[0];

  if (!preferredAsset) {
    const available = assets.map((a) => a.name).join(', ');
    throw new Error(`No Marsdev asset found for ${process.platform}. Available: ${available}`);
  }

  const downloadUrl = preferredAsset.browser_download_url;

  const toolsDir = getToolsDir();
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });

  const lowerName = String(preferredAsset.name || '').toLowerCase();
  const ext = lowerName.endsWith('.tar.xz')
    ? '.tar.xz'
    : (lowerName.endsWith('.tar.gz') ? '.tar.gz' : '.zip');
  const fileName = `marsdev-${tag}${ext}`;
  const filePath = path.join(toolsDir, fileName);

  onProgress && onProgress({ phase: 'download', message: `Downloading Marsdev ${tag}...`, percent: 0 });
  await downloadToFile(downloadUrl, filePath, (received, total) => {
    onProgress && onProgress({ phase: 'download', message: `Downloading Marsdev ${tag}...`, percent: Math.round((received / total) * 70) });
  });

  onProgress && onProgress({ phase: 'extract', message: 'Extracting...', percent: 75 });
  const marsdevBase = getMarsdevBaseDir();
  if (fs.existsSync(marsdevBase)) fs.rmSync(marsdevBase, { recursive: true, force: true });

  if (ext === '.tar.xz' || ext === '.tar.gz') {
    await extractTarGz(filePath, marsdevBase);
  } else {
    await extractZip(filePath, marsdevBase);
  }

  fs.unlink(filePath, () => {});

  const installedPath = getMarsdevPath();
  if (installedPath) {
    saveSettings({ marsdevPath: installedPath, marsdevVersion: tag });
    const fix = fixMarsdevMacosGettext(installedPath);
    if (!fix.ok) {
      return { ok: false, error: fix.error };
    }
  }

  onProgress && onProgress({ phase: 'done', message: `Marsdev ${tag} installed`, percent: 100 });
  return { ok: true, tag, path: installedPath };
}

async function downloadJava(onProgress) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Java auto-download is Windows only' };
  }

  // Adoptium Temurin 21 LTS for Windows x64
  const url = 'https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jre';
  onProgress && onProgress({ phase: 'fetch', message: 'Fetching Java download URL...', percent: 5 });

  const res = await httpsGet(url);
  if (res.statusCode !== 200) throw new Error(`Adoptium API ${res.statusCode}`);
  const assets = JSON.parse(res.body);
  if (!assets || assets.length === 0) throw new Error('No Java assets found');

  const asset = assets[0];
  const downloadUrl = asset.binary?.package?.link;
  if (!downloadUrl) throw new Error('Could not find Java download URL');

  const toolsDir = getToolsDir();
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });

  const zipPath = path.join(toolsDir, 'jre-temurin.zip');
  onProgress && onProgress({ phase: 'download', message: 'Downloading Java JRE...', percent: 10 });

  await downloadToFile(downloadUrl, zipPath, (received, total) => {
    onProgress && onProgress({ phase: 'download', message: 'Downloading Java JRE...', percent: 10 + Math.round((received / total) * 65) });
  });

  onProgress && onProgress({ phase: 'extract', message: 'Extracting Java JRE...', percent: 80 });
  const jreBase = getJreBaseDir();
  if (fs.existsSync(jreBase)) fs.rmSync(jreBase, { recursive: true, force: true });
  await extractZip(zipPath, jreBase);
  fs.unlink(zipPath, () => {});

  onProgress && onProgress({ phase: 'done', message: 'Java JRE installed', percent: 100 });
  return { ok: true };
}

async function downloadEmsdk(onProgress) {
  let emsdkPath = findExtractedEmsdkDir();
  const toolsDir = getToolsDir();
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });

  if (!emsdkPath) {
    const zipUrl = `https://github.com/${EMSDK_OWNER}/${EMSDK_REPO}/archive/refs/heads/${EMSDK_BRANCH}.zip`;
    const zipPath = path.join(toolsDir, `emsdk-${EMSDK_BRANCH}.zip`);

    onProgress && onProgress({ phase: 'download', message: `Downloading emsdk (${EMSDK_BRANCH})...`, percent: 0 });
    await downloadToFile(zipUrl, zipPath, (received, total) => {
      onProgress && onProgress({ phase: 'download', message: `Downloading emsdk (${EMSDK_BRANCH})...`, percent: Math.round((received / total) * 35) });
    });

    onProgress && onProgress({ phase: 'extract', message: 'Extracting emsdk...', percent: 40 });
    const base = getEmsdkBaseDir();
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
    await extractZip(zipPath, base);
    fs.unlink(zipPath, () => {});
    emsdkPath = findExtractedEmsdkDir();
  } else {
    onProgress && onProgress({ phase: 'install', message: 'Using existing emsdk source. Installing latest toolchain...', percent: 45 });
  }

  if (!emsdkPath) return { ok: false, error: 'emsdk command was not found after extraction.' };
  const command = getEmsdkCommand(emsdkPath);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(command, 0o755); } catch {}
  }
  saveSettings({ emsdkPath, emsdkSource: `${EMSDK_OWNER}/${EMSDK_REPO}`, emsdkBranch: EMSDK_BRANCH });

  onProgress && onProgress({ phase: 'install', message: 'Installing Emscripten SDK latest...', percent: 48 });
  const install = await runProcess(command, ['install', 'latest'], { cwd: emsdkPath, phase: 'install', percent: 65, message: 'Installing Emscripten SDK latest...' }, onProgress);
  if (!install.ok) return { ok: false, error: install.error, stdout: install.stdout, stderr: install.stderr };

  onProgress && onProgress({ phase: 'activate', message: 'Activating Emscripten SDK latest...', percent: 82 });
  const activate = await runProcess(command, ['activate', 'latest'], { cwd: emsdkPath, phase: 'activate', percent: 90, message: 'Activating Emscripten SDK latest...' }, onProgress);
  if (!activate.ok) return { ok: false, error: activate.error, stdout: activate.stdout, stderr: activate.stderr };

  const emccPath = getEmccPath(emsdkPath);
  const emccVersion = getCommandVersion(emccPath, ['-v'], { cwd: emsdkPath, env: getEmsdkEnv(emsdkPath) });
  saveSettings({ emsdkPath, emccVersion });
  onProgress && onProgress({ phase: 'done', message: 'Emscripten SDK installed', percent: 100 });
  return { ok: true, path: emsdkPath, emccPath, emccVersion };
}

async function downloadNukedOpn2(onProgress) {
  const apiUrl = `https://api.github.com/repos/${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}`;
  onProgress && onProgress({ phase: 'fetch', message: 'Fetching Nuked-OPN2 repository metadata...', percent: 5 });
  const res = await httpsGet(apiUrl);
  if (res.statusCode !== 200) throw new Error(`GitHub API returned ${res.statusCode}`);
  const repo = JSON.parse(res.body);
  const branch = repo.default_branch || 'master';
  const zipUrl = `https://github.com/${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}/archive/refs/heads/${branch}.zip`;

  const toolsDir = getToolsDir();
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
  const zipPath = path.join(toolsDir, `nuked-opn2-${branch}.zip`);

  onProgress && onProgress({ phase: 'download', message: `Downloading Nuked-OPN2 (${branch})...`, percent: 10 });
  await downloadToFile(zipUrl, zipPath, (received, total) => {
    onProgress && onProgress({ phase: 'download', message: `Downloading Nuked-OPN2 (${branch})...`, percent: 10 + Math.round((received / total) * 60) });
  });

  onProgress && onProgress({ phase: 'extract', message: 'Extracting Nuked-OPN2 source...', percent: 75 });
  const base = getNukedOpn2BaseDir();
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  await extractZip(zipPath, base);
  fs.unlink(zipPath, () => {});

  const installedPath = findExtractedNukedOpn2Dir();
  if (!installedPath) {
    return { ok: false, error: 'Nuked-OPN2 source files were not found after extraction.' };
  }
  saveSettings({ nukedOpn2Path: installedPath, nukedOpn2Source: `${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}`, nukedOpn2Branch: branch });

  onProgress && onProgress({ phase: 'done', message: 'Nuked-OPN2 source installed', percent: 100 });
  return { ok: true, path: installedPath, branch, license: 'LGPL-2.1-or-later' };
}

function getNukedOpn2WrapperSource() {
  return `#include <stdint.h>
#include "ym3438.h"

static ym3438_t chip;
static double clocks_per_sample = 173.0;
static double clock_fraction = 0.0;

void nuke_init(int sample_rate, int chip_type) {
  if (sample_rate <= 0) sample_rate = 44100;
  OPN2_SetChipType(chip_type ? (uint32_t)chip_type : ym3438_mode_ym2612);
  OPN2_Reset(&chip);
  clocks_per_sample = 7670454.0 / (double)sample_rate;
  clock_fraction = 0.0;
}

void nuke_reset(void) {
  OPN2_Reset(&chip);
  clock_fraction = 0.0;
}

void nuke_write(int port, int address, int value) {
  OPN2_Write(&chip, (uint32_t)(port * 2), (uint8_t)(address & 0xff));
  OPN2_Write(&chip, (uint32_t)(port * 2 + 1), (uint8_t)(value & 0xff));
}

void nuke_render(int samples, int16_t *out) {
  if (!out || samples <= 0) return;
  for (int i = 0; i < samples; i++) {
    Bit16s frame[2] = { 0, 0 };
    int clocks = (int)clocks_per_sample;
    clock_fraction += clocks_per_sample - (double)clocks;
    if (clock_fraction >= 1.0) {
      clocks++;
      clock_fraction -= 1.0;
    }
    if (clocks < 1) clocks = 1;
    for (int c = 0; c < clocks; c++) {
      OPN2_Clock(&chip, frame);
    }
    out[i * 2] = frame[0];
    out[i * 2 + 1] = frame[1];
  }
}
`;
}

function getNukedOpn2BuildPlan() {
  const emsdk = checkEmsdk();
  const nuked = checkNukedOpn2();
  const sourcePath = nuked.sourcePath;
  const buildDir = sourcePath ? path.join(sourcePath, 'build') : null;
  const distDir = buildDir ? path.join(buildDir, 'dist') : null;
  const wrapperPath = buildDir ? path.join(buildDir, 'md_nuked_opn2_wrapper.c') : null;
  const outputJs = distDir ? path.join(distDir, 'nuked-opn2.js') : null;
  const outputWasm = distDir ? path.join(distDir, 'nuked-opn2.wasm') : null;
  const sourceC = sourcePath ? path.join(sourcePath, 'ym3438.c') : null;
  const emccPath = emsdk.emccPath;
  const args = emccPath && sourcePath ? [
    wrapperPath,
    sourceC,
    '-O3',
    '--no-entry',
    '-I', sourcePath,
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createNukedOpn2Module',
    '-sENVIRONMENT=web',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sEXPORTED_FUNCTIONS=_nuke_init,_nuke_reset,_nuke_write,_nuke_render,_malloc,_free',
    '-sEXPORTED_RUNTIME_METHODS=cwrap,HEAP16',
    '-o', outputJs,
  ] : [];
  return {
    ok: !!(emsdk.emccInstalled && nuked.installed),
    emsdk,
    nuked,
    emccPath,
    sourcePath,
    buildDir,
    distDir,
    wrapperPath,
    outputJs,
    outputWasm,
    args,
    command: emccPath,
  };
}

async function buildNukedOpn2Wasm(onProgress) {
  const plan = getNukedOpn2BuildPlan();
  if (!plan.nuked.installed) return { ok: false, error: 'Nuked-OPN2 source is not installed.' };
  if (!plan.emsdk.emccInstalled) return { ok: false, error: 'Emscripten emcc is not installed.' };
  fs.mkdirSync(plan.buildDir, { recursive: true });
  fs.mkdirSync(plan.distDir, { recursive: true });
  fs.writeFileSync(plan.wrapperPath, getNukedOpn2WrapperSource(), 'utf-8');

  onProgress && onProgress({ phase: 'build', message: 'Building Nuked-OPN2 WASM with emcc...', percent: 20 });
  const result = await runProcess(plan.command, plan.args, {
    cwd: plan.sourcePath,
    env: getEmsdkEnv(plan.emsdk.path),
    phase: 'build',
    percent: 60,
  }, onProgress);
  if (!result.ok) return { ok: false, error: result.error, stdout: result.stdout, stderr: result.stderr };
  if (!fs.existsSync(plan.outputJs) || !fs.existsSync(plan.outputWasm)) {
    return { ok: false, error: 'emcc completed but nuked-opn2.js/wasm was not generated.' };
  }

  const licenseSource = path.join(plan.sourcePath, 'LICENSE');
  const licenseTarget = path.join(plan.distDir, 'LICENSE');
  if (fs.existsSync(licenseSource)) fs.copyFileSync(licenseSource, licenseTarget);
  fs.writeFileSync(path.join(plan.distDir, 'SOURCE.txt'), [
    `Source: https://github.com/${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}`,
    `Local source: ${plan.sourcePath}`,
    'License: LGPL-2.1-or-later',
    '',
  ].join('\n'), 'utf-8');
  const emccVersion = getCommandVersion(plan.emccPath, ['-v'], { cwd: plan.emsdk.path, env: getEmsdkEnv(plan.emsdk.path) });
  const buildInfo = {
    source: `${NUKED_OPN2_OWNER}/${NUKED_OPN2_REPO}`,
    license: 'LGPL-2.1-or-later',
    sourcePath: plan.sourcePath,
    emsdkPath: plan.emsdk.path,
    emccPath: plan.emccPath,
    emccVersion,
    builtAt: new Date().toISOString(),
    outputJs: plan.outputJs,
    outputWasm: plan.outputWasm,
    exportedRuntimeMethods: 'cwrap,HEAP16',
  };
  fs.writeFileSync(path.join(plan.distDir, 'BUILD_INFO.json'), JSON.stringify(buildInfo, null, 2), 'utf-8');
  saveSettings({ nukedOpn2WasmPath: plan.outputWasm, nukedOpn2JsPath: plan.outputJs, emccVersion });
  onProgress && onProgress({ phase: 'done', message: 'Nuked-OPN2 WASM built', percent: 100 });
  return { ok: true, jsPath: plan.outputJs, wasmPath: plan.outputWasm, buildInfo };
}

function isPathInside(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function loadOptionalAudioEngine(engineId) {
  if (engineId !== 'nuked-opn2') return { ok: false, error: `Unknown audio engine: ${engineId}` };
  const status = checkNukedOpn2();
  if (!status.wasmInstalled || !status.jsPath || !status.wasmPath) {
    return { ok: false, error: 'Nuked-OPN2 WASM is not built.' };
  }
  const toolsDir = getToolsDir();
  if (!isPathInside(toolsDir, status.jsPath) || !isPathInside(toolsDir, status.wasmPath)) {
    return { ok: false, error: 'audio engine path is outside the tools directory' };
  }
  return {
    ok: true,
    id: engineId,
    jsDataUrl: `data:text/javascript;base64,${fs.readFileSync(status.jsPath).toString('base64')}`,
    wasmDataUrl: `data:application/wasm;base64,${fs.readFileSync(status.wasmPath).toString('base64')}`,
    buildInfo: status.buildInfoPath ? readJsonFile(status.buildInfoPath) : null,
    license: status.license,
    source: status.source,
  };
}

// ------------------------------------------------------------------ status --

function getStatus() {
  const sgdk = checkSgdk();
  const marsdev = checkMarsdev();
  const java = checkJava();
  const gcc = checkM68kGcc();
  const emsdk = checkEmsdk();
  const nukedOpn2 = checkNukedOpn2();
  const audioEngines = {
    nukedOpn2,
    nukedOpn2Wasm: {
      installed: !!(nukedOpn2.wasmInstalled && nukedOpn2.jsPath),
      jsPath: nukedOpn2.jsPath || null,
      wasmPath: nukedOpn2.wasmPath || null,
      buildInfoPath: nukedOpn2.buildInfoPath || null,
    },
  };
  return { sgdk, marsdev, java, gcc, emsdk, emcc: { installed: emsdk.emccInstalled, path: emsdk.emccPath, version: emsdk.emccVersion }, audioEngines, platform: process.platform };
}

function selectToolchainDir(options = {}) {
  const platform = options.platform || process.platform;
  const sgdkPath = Object.prototype.hasOwnProperty.call(options, 'sgdkPath') ? options.sgdkPath : getSgdkPath();
  const marsdevPath = Object.prototype.hasOwnProperty.call(options, 'marsdevPath') ? options.marsdevPath : getMarsdevPath();

  // Windows uses SGDK directly. On macOS/Linux, prefer a modern SGDK runtime
  // when it supports XGM2; Marsdev can still provide the native m68k tools.
  if (platform === 'win32') {
    return sgdkPath;
  }
  if (toolchainSupportsXgm2(sgdkPath)) return sgdkPath;
  if (marsdevPath) return marsdevPath;
  return sgdkPath;
}

function getToolchainDir() {
  return selectToolchainDir();
}

module.exports = {
  getStatus,
  listSgdkReleases,
  listMarsdevReleases,
  getDefaultTestPlaySettings,
  getTestPlaySettings,
  saveTestPlaySettings,
  getSgdkPath,
  setSgdkPath,
  getMarsdevPath,
  setMarsdevPath,
  getEmsdkPath,
  getEmsdkCommand,
  getEmccPath,
  getEmsdkEnv,
  getNukedOpn2Path,
  getNukedOpn2BuildPlan,
  loadOptionalAudioEngine,
  getToolchainDir,
  selectToolchainDir,
  toolchainSupportsXgm2,
  getSgdkBundledTools,
  getMarsdevBundledTools,
  fixMarsdevMacosGettext,
  getJavaExePath,
  checkSgdk,
  checkMarsdev,
  checkJava,
  checkM68kGcc,
  checkEmsdk,
  checkNukedOpn2,
  downloadSgdk,
  downloadMarsdev,
  downloadJava,
  downloadEmsdk,
  downloadNukedOpn2,
  buildNukedOpn2Wasm,
};
