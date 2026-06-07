'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { app } = require('electron');
const iplExtractor = require('./pce-ipl-extractor');

const REQUEST_HEADERS = Object.freeze({
  'User-Agent': 'pce-game-editor-setup',
  Accept: 'application/vnd.github+json, application/json, text/plain, */*',
});

const ARCHIVE_EXTENSIONS = Object.freeze([
  '.tar.gz',
  '.tar.xz',
  '.tar.bz2',
  '.tgz',
  '.txz',
  '.tbz2',
  '.zip',
  '.7z',
  '.tar',
]);

const TOOL_DEFINITIONS = Object.freeze({
  llvmMos: {
    kind: 'llvmMos',
    label: 'llvm-mos-sdk',
    description: 'llvm-mos SDK と mos-pce-clang',
    license: 'Apache-2.0 with LLVM exceptions / MIT-style components',
    homepage: 'https://github.com/llvm-mos/llvm-mos-sdk',
    targetSubdir: ['llvm-mos-sdk'],
    executableBaseNames: ['mos-pce-clang'],
    requiresPlatformAsset: true,
    github: {
      owner: 'llvm-mos',
      repo: 'llvm-mos-sdk',
      includeSourceArchives: false,
    },
  },
  emulatorJs: {
    kind: 'emulatorJs',
    label: 'EmulatorJS / mednafen_pce',
    description: 'WASM Test Play 用 EmulatorJS runtime/core',
    license: 'GPL-family runtime/core, downloaded by user action',
    homepage: 'https://github.com/EmulatorJS/EmulatorJS',
    targetSubdir: ['emulators', 'emulatorjs-pce'],
    executableBaseNames: [],
    requiresPlatformAsset: false,
    note: 'EmulatorJS runtime/core は GPL 系のためリポジトリには同梱せず、ユーザー操作で data/tools 配下へ取得します。CDN 配布は .7z のため展開には 7z / 7za / bsdtar のいずれかが必要です。',
    github: {
      owner: 'EmulatorJS',
      repo: 'EmulatorJS',
      includeSourceArchives: false,
    },
    cdnIndex: {
      url: 'https://cdn.emulatorjs.org/releases/',
      archivePattern: /\.7z$/i,
      source: 'emulatorjs-cdn',
    },
  },
});

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getToolsDir() {
  return path.join(app.getPath('userData'), 'tools');
}

function getSettingsPath() {
  return path.join(getToolsDir(), 'settings.json');
}

function getDefaultTargetDir(kind) {
  const tool = getToolDefinition(kind);
  return path.join(getToolsDir(), ...tool.targetSubdir);
}

function getLlvmMosBaseDir() {
  return getDefaultTargetDir('llvmMos');
}

function getEmulatorBaseDir() {
  return getDefaultTargetDir('emulatorJs');
}

function getToolDefinition(kind) {
  const tool = TOOL_DEFINITIONS[kind];
  if (!tool) throw new Error(`unknown tool kind: ${kind}`);
  return tool;
}

function publicToolDefinition(tool) {
  return {
    kind: tool.kind,
    label: tool.label,
    description: tool.description,
    license: tool.license,
    homepage: tool.homepage,
    note: tool.note || '',
    defaultTargetDir: getDefaultTargetDir(tool.kind),
    sources: [
      ...(tool.fixedVersions || []).map((item) => ({
        type: 'fixed',
        label: item.label,
        source: item.source,
        platforms: item.platforms || null,
      })),
      tool.github ? {
        type: 'github-releases',
        label: `${tool.github.owner}/${tool.github.repo}`,
        owner: tool.github.owner,
        repo: tool.github.repo,
        url: `https://github.com/${tool.github.owner}/${tool.github.repo}/releases`,
      } : null,
      tool.homebrew ? {
        type: 'homebrew-bottle',
        label: `Homebrew ${tool.homebrew.formula}`,
        url: tool.homebrew.apiUrl,
      } : null,
      tool.cdnIndex ? {
        type: 'cdn-index',
        label: 'EmulatorJS CDN',
        url: tool.cdnIndex.url,
      } : null,
    ].filter(Boolean),
  };
}

function getDownloadCatalog() {
  return {
    ok: true,
    toolsDir: getToolsDir(),
    platform: process.platform,
    arch: process.arch,
    tools: Object.values(TOOL_DEFINITIONS).map(publicToolDefinition),
  };
}

function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

function saveSettings(patch = {}) {
  const settingsPath = getSettingsPath();
  ensureDirSync(path.dirname(settingsPath));
  const current = loadSettings();
  const next = { ...current, ...patch };
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function executableNamesForTool(tool) {
  const names = new Set();
  tool.executableBaseNames.forEach((name) => {
    names.add(executableName(name));
    names.add(name);
    names.add(`${name}.exe`);
    names.add(`${name}.cmd`);
    names.add(`${name}.bat`);
  });
  return Array.from(names);
}

function isUsableExecutableCandidate(absPath) {
  try {
    const stat = fs.lstatSync(absPath);
    if (stat.isFile()) return true;
    if (stat.isSymbolicLink()) {
      fs.statSync(absPath);
      return true;
    }
  } catch (_) {}
  return false;
}

function findExecutable(baseDir, names) {
  if (!baseDir || !fs.existsSync(baseDir)) return null;
  const wanted = new Set(names);
  const queue = [baseDir];
  let scannedDirs = 0;
  while (queue.length > 0 && scannedDirs < 10000) {
    const current = queue.shift();
    scannedDirs += 1;

    for (const name of wanted) {
      const direct = path.join(current, name);
      if (isUsableExecutableCandidate(direct)) return direct;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['.git', 'node_modules'].includes(entry.name)) queue.push(abs);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && wanted.has(entry.name) && isUsableExecutableCandidate(abs)) {
        return abs;
      }
    }
  }
  return null;
}

function findDirectory(baseDir, predicate) {
  if (!baseDir || !fs.existsSync(baseDir)) return null;
  const queue = [baseDir];
  let scanned = 0;
  while (queue.length > 0 && scanned < 2000) {
    const current = queue.shift();
    scanned += 1;
    if (predicate(current)) return current;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name)) {
        queue.push(path.join(current, entry.name));
      }
    }
  }
  return null;
}

function findEmulatorJsRuntimeDir(baseDir) {
  return findDirectory(baseDir, (dir) => {
    const hasLoader = fs.existsSync(path.join(dir, 'loader.js'));
    const hasDataDir = fs.existsSync(path.join(dir, 'data')) && fs.statSync(path.join(dir, 'data')).isDirectory();
    return hasLoader || hasDataDir;
  });
}

function getCc65Path() {
  const settings = loadSettings();
  if (settings.cc65Path && fs.existsSync(settings.cc65Path)) return settings.cc65Path;
  return findExecutable(getCc65BaseDir(), executableNamesForTool(TOOL_DEFINITIONS.cc65));
}

function getLlvmMosPath() {
  const settings = loadSettings();
  if (settings.llvmMosPath && fs.existsSync(settings.llvmMosPath)) return settings.llvmMosPath;
  return findExecutable(getLlvmMosBaseDir(), executableNamesForTool(TOOL_DEFINITIONS.llvmMos));
}

function getLlvmMosCompanionTool(baseName, settingKey) {
  const settings = loadSettings();
  if (settingKey && settings[settingKey] && fs.existsSync(settings[settingKey])) return settings[settingKey];
  const names = [
    executableName(baseName),
    baseName,
    `${baseName}.exe`,
    `${baseName}.cmd`,
    `${baseName}.bat`,
  ];
  const primary = getLlvmMosPath();
  if (primary) {
    const candidate = findExecutable(path.dirname(primary), names);
    if (candidate) return candidate;
  }
  return findExecutable(getLlvmMosBaseDir(), names);
}

function getLlvmMosPceCdPath() {
  return getLlvmMosCompanionTool('mos-pce-cd-clang', 'llvmMosPceCdPath');
}

function getPceMkcdPath() {
  return getLlvmMosCompanionTool('pce-mkcd', 'pceMkcdPath');
}

function getEmulatorJsDir() {
  const settings = loadSettings();
  if (settings.emulatorJsDir && fs.existsSync(settings.emulatorJsDir)) return settings.emulatorJsDir;
  return findEmulatorJsRuntimeDir(getEmulatorBaseDir());
}

function getOptionalFileSetting(key) {
  const settings = loadSettings();
  return settings[key] && fs.existsSync(settings[key]) ? settings[key] : null;
}

function getPceCdIplPath() {
  return getOptionalFileSetting('pceCdIplPath');
}

function getPceCdSystemCardPath() {
  return getOptionalFileSetting('pceCdSystemCardPath');
}

function getPceCdIplExtractDir() {
  return path.join(getToolsDir(), 'pce-cd', 'ipl');
}

function extractPceCdIpl(payload = {}) {
  const sourcePath = String(payload.sourcePath || payload.inputPath || '').trim();
  if (!payload.confirmOwnedSource) {
    return { ok: false, error: '所有する PCE-CD イメージから抽出することを確認してください。' };
  }
  if (!sourcePath) {
    return { ok: false, error: 'ISO/CUE/BIN ファイルを選択してください。' };
  }
  try {
    const result = iplExtractor.extractIplToDirectory(sourcePath, getPceCdIplExtractDir());
    saveSettings({ pceCdIplPath: result.outputPath });
    return {
      ok: true,
      path: result.outputPath,
      metadataPath: result.metadataPath,
      metadata: result.metadata,
      status: getStatus(),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function setToolPath(kind, value) {
  const abs = value ? path.resolve(String(value)) : '';
  const keyByKind = {
    llvmMos: 'llvmMosPath',
    llvmMosPceCd: 'llvmMosPceCdPath',
    pceMkcd: 'pceMkcdPath',
    emulatorJs: 'emulatorJsDir',
    pceCdIpl: 'pceCdIplPath',
    pceCdSystemCard: 'pceCdSystemCardPath',
  };
  const key = keyByKind[kind];
  if (!key) throw new Error(`unknown tool kind: ${kind}`);
  return saveSettings({ [key]: abs });
}

function getToolchainPath() {
  return getLlvmMosPath();
}

function getStatus() {
  const llvmMosPath = getLlvmMosPath();
  const llvmMosPceCdPath = getLlvmMosPceCdPath();
  const pceMkcdPath = getPceMkcdPath();
  const emulatorJsDir = getEmulatorJsDir();
  const pceCdIplPath = getPceCdIplPath();
  const pceCdSystemCardPath = getPceCdSystemCardPath();
  return {
    toolsDir: getToolsDir(),
    llvmMos: { configured: Boolean(llvmMosPath), path: llvmMosPath },
    llvmMosPceCd: { configured: Boolean(llvmMosPceCdPath), path: llvmMosPceCdPath },
    pceMkcd: { configured: Boolean(pceMkcdPath), path: pceMkcdPath },
    emulatorJs: { configured: Boolean(emulatorJsDir), path: emulatorJsDir },
    pceCdIpl: { configured: Boolean(pceCdIplPath), path: pceCdIplPath },
    pceCdSystemCard: { configured: Boolean(pceCdSystemCardPath), path: pceCdSystemCardPath },
  };
}

function requestText(url, options = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('too many redirects'));
  }
  return new Promise((resolve, reject) => {
    const request = https.get(new URL(url), {
      headers: { ...REQUEST_HEADERS, ...(options.headers || {}) },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error('redirect without location'));
          return;
        }
        requestText(new URL(location, url).href, options, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`request failed: HTTP ${response.statusCode}`));
        return;
      }
      response.setEncoding('utf-8');
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function requestJson(url, options = {}) {
  const body = await requestText(url, options);
  return JSON.parse(body);
}

function parseBearerAuthenticateHeader(header) {
  const text = String(header || '').trim();
  if (!/^Bearer\s+/i.test(text)) return null;
  const params = {};
  const body = text.replace(/^Bearer\s+/i, '');
  const pattern = /([A-Za-z_][A-Za-z0-9_-]*)=("([^"]*)"|[^,]*)/g;
  let match = pattern.exec(body);
  while (match) {
    params[match[1]] = match[3] ?? String(match[2] || '').trim();
    match = pattern.exec(body);
  }
  if (!params.realm) return null;
  return params;
}

function buildBearerTokenUrl(auth) {
  const url = new URL(auth.realm);
  if (auth.service) url.searchParams.set('service', auth.service);
  if (auth.scope) url.searchParams.set('scope', auth.scope);
  return url.href;
}

async function getBearerAuthorizationHeader(wwwAuthenticate) {
  const auth = parseBearerAuthenticateHeader(wwwAuthenticate);
  if (!auth) return null;
  const tokenResponse = await requestJson(buildBearerTokenUrl(auth));
  const token = tokenResponse.token || tokenResponse.access_token;
  return token ? `Bearer ${token}` : null;
}

function archiveExtension(fileName) {
  const lower = String(fileName || '').toLowerCase();
  return ARCHIVE_EXTENSIONS.find((ext) => lower.endsWith(ext)) || '';
}

function isArchiveAsset(asset) {
  return Boolean(archiveExtension(asset?.name || asset?.browser_download_url || ''));
}

function isChecksumAsset(asset) {
  const name = String(asset?.name || '').toLowerCase();
  return /(^|[._-])(sha256|sha512|checksum|checksums|sig|asc|debug|symbols)([._-]|$)/.test(name);
}

function nameTokens(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function assetPlatformSet(name) {
  const tokens = nameTokens(name);
  const platforms = new Set();
  if (tokens.some((token) => ['win', 'win32', 'win64', 'windows', 'mingw', 'msvc'].includes(token))) {
    platforms.add('win32');
  }
  if (tokens.some((token) => ['mac', 'macos', 'osx', 'darwin', 'apple'].includes(token))) {
    platforms.add('darwin');
  }
  if (tokens.some((token) => ['linux', 'gnu'].includes(token))) {
    platforms.add('linux');
  }
  return platforms;
}

function assetArchSet(name) {
  const lower = String(name || '').toLowerCase();
  const archs = new Set();
  if (/universal/.test(lower)) archs.add('universal');
  if (/(x86[_-]?64|amd64|x64|win64|linux64)/.test(lower)) archs.add('x64');
  if (/(arm64|aarch64|apple[_-]?silicon)/.test(lower)) archs.add('arm64');
  if (/(^|[._-])(x86|i386|i686|win32)([._-]|$)/.test(lower)) archs.add('ia32');
  return archs;
}

function normalizePlatform(platform) {
  if (platform === 'windows') return 'win32';
  if (platform === 'macos') return 'darwin';
  return platform || process.platform;
}

function normalizeArch(arch) {
  if (arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch || process.arch;
}

function assetMatchesPlatform(asset, tool, options = {}) {
  if (!isArchiveAsset(asset) || isChecksumAsset(asset)) return false;
  const name = String(asset.name || '');
  const lower = name.toLowerCase();
  if (/(^|[._-])(src|source)([._-]|$)/.test(lower) && tool.requiresPlatformAsset) return false;

  const platform = normalizePlatform(options.platform);
  const arch = normalizeArch(options.arch);
  const platforms = assetPlatformSet(name);
  const archs = assetArchSet(name);

  if (platforms.size > 0 && !platforms.has(platform)) return false;
  if (platforms.size === 0 && tool.requiresPlatformAsset) return false;
  if (archs.size > 0 && !archs.has(arch) && !archs.has('universal')) return false;
  return true;
}

function assetScore(asset, tool, options = {}) {
  if (!assetMatchesPlatform(asset, tool, options)) return -1;
  const name = String(asset.name || '').toLowerCase();
  const platforms = assetPlatformSet(name);
  const archs = assetArchSet(name);
  let score = 10;
  if (platforms.size > 0) score += 100;
  if (archs.size > 0) score += 25;
  if (archiveExtension(name) === '.zip') score += 6;
  if (archiveExtension(name).startsWith('.tar')) score += 4;
  if (tool.kind === 'llvmMos' && /sdk/.test(name)) score += 15;
  if (tool.kind === 'emulatorJs' && /emulatorjs/.test(name)) score += 15;
  return score;
}

function selectReleaseAsset(release, toolOrKind, options = {}) {
  const tool = typeof toolOrKind === 'string' ? getToolDefinition(toolOrKind) : toolOrKind;
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets
    .map((asset) => ({ asset, score: assetScore(asset, tool, options) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || String(a.asset.name).localeCompare(String(b.asset.name), 'ja'))[0]?.asset || null;
}

function versionLabel(label, detail) {
  return detail ? `${label} / ${detail}` : label;
}

function makeVersionOption(tool, patch) {
  return {
    kind: tool.kind,
    targetDir: getDefaultTargetDir(tool.kind),
    license: tool.license,
    homepage: tool.homepage,
    available: Boolean(patch.available),
    prerelease: Boolean(patch.prerelease),
    ...patch,
  };
}

function buildFixedVersionOptions(toolOrKind, options = {}) {
  const tool = typeof toolOrKind === 'string' ? getToolDefinition(toolOrKind) : toolOrKind;
  const platform = normalizePlatform(options.platform);
  return (tool.fixedVersions || []).map((item) => {
    const platformOk = !item.platforms || item.platforms.includes(platform);
    return makeVersionOption(tool, {
      id: item.id,
      label: item.label,
      version: item.version,
      source: item.source || 'fixed',
      sourceUrl: item.url,
      downloadUrl: item.url,
      archiveName: item.archiveName,
      assetName: item.archiveName,
      available: platformOk && Boolean(item.url),
      note: platformOk ? item.note || '' : `${platform} ではこの配布物は使えません。`,
    });
  });
}

function homebrewBottleMatchesPlatform(key, options = {}) {
  const platform = normalizePlatform(options.platform);
  const arch = normalizeArch(options.arch);
  const lower = String(key || '').toLowerCase();

  if (platform === 'win32') return false;
  if (platform === 'linux') {
    if (!lower.includes('linux')) return false;
    if (arch === 'arm64') return lower.includes('arm64') || lower.includes('aarch64');
    if (arch === 'x64') return lower.includes('x86_64') || lower.includes('amd64') || lower.includes('linux');
    return true;
  }
  if (platform === 'darwin') {
    if (lower.includes('linux')) return false;
    if (arch === 'arm64') return lower.startsWith('arm64');
    if (arch === 'x64') return !lower.startsWith('arm64');
    return true;
  }
  return false;
}

function buildHomebrewBottleOptions(toolOrKind, formula, options = {}) {
  const tool = typeof toolOrKind === 'string' ? getToolDefinition(toolOrKind) : toolOrKind;
  if (!tool.homebrew) return [];
  const files = formula?.bottle?.stable?.files || {};
  const version = formula?.versions?.stable || formula?.version || 'stable';
  const candidates = Object.entries(files)
    .filter(([, file]) => file?.url)
    .filter(([key]) => homebrewBottleMatchesPlatform(key, options))
    .map(([key, file]) => {
      const urlName = archiveNameFromUrl(file.url);
      const archiveName = archiveExtension(urlName) ? urlName : `${tool.kind}-${version}-${key}.bottle.tar.gz`;
      return makeVersionOption(tool, {
        id: `${tool.kind}:homebrew:${version}:${key}`,
        label: versionLabel(`Homebrew ${version}`, key),
        version,
        source: 'homebrew-bottle',
        sourceUrl: `https://formulae.brew.sh/formula/${tool.homebrew.formula}`,
        downloadUrl: file.url,
        archiveName,
        assetName: archiveName,
        available: true,
        note: 'Homebrew の bottle アーカイブを data/tools 配下に展開して使用します。',
      });
    });

  if (candidates.length > 0) return candidates;
  return [makeVersionOption(tool, {
    id: `${tool.kind}:homebrew:${version}:unavailable`,
    label: versionLabel(`Homebrew ${version}`, '対応 bottle なし'),
    version,
    source: 'homebrew-bottle',
    sourceUrl: `https://formulae.brew.sh/formula/${tool.homebrew.formula}`,
    available: false,
    note: 'このOS/CPU向けの Homebrew bottle が見つかりません。',
  })];
}

function buildGithubReleaseOptions(toolOrKind, releases, options = {}) {
  const tool = typeof toolOrKind === 'string' ? getToolDefinition(toolOrKind) : toolOrKind;
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => !release?.draft)
    .map((release) => {
      const tag = String(release.tag_name || release.name || release.id || '').trim();
      const title = String(release.name || tag || 'release').trim();
      const asset = selectReleaseAsset(release, tool, options);
      const id = `${tool.kind}:github:${tag || release.id}`;
      if (!asset) {
        return makeVersionOption(tool, {
          id,
          label: versionLabel(title, '対応アーカイブなし'),
          version: tag,
          source: 'github-release',
          sourceUrl: release.html_url || `https://github.com/${tool.github.owner}/${tool.github.repo}/releases`,
          publishedAt: release.published_at || '',
          prerelease: Boolean(release.prerelease),
          available: false,
          note: 'このOS/CPU向けの実行バイナリアーカイブが見つかりません。',
        });
      }
      return makeVersionOption(tool, {
        id,
        label: versionLabel(title, asset.name),
        version: tag,
        source: 'github-release',
        sourceUrl: release.html_url || asset.browser_download_url,
        publishedAt: release.published_at || '',
        prerelease: Boolean(release.prerelease),
        assetName: asset.name,
        archiveName: asset.name,
        downloadUrl: asset.browser_download_url,
        available: true,
        note: release.prerelease ? 'pre-release' : '',
      });
    });
}

function semverishKey(value) {
  return String(value || '').match(/\d+|[a-z]+/gi)?.map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase())) || [];
}

function compareSemverishDesc(a, b) {
  const left = semverishKey(a.version || a.label);
  const right = semverishKey(b.version || b.label);
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return 1;
    if (r === undefined) return -1;
    if (typeof l === 'number' && typeof r === 'number' && l !== r) return r - l;
    const compared = String(r).localeCompare(String(l), 'en', { numeric: true });
    if (compared !== 0) return compared;
  }
  return 0;
}

function parseCdnArchiveIndex(html, baseUrl, archivePattern = /\.(zip|7z|tar\.gz|tgz)$/i) {
  const files = [];
  const seen = new Set();
  const pattern = /href=["']([^"']+)["']/gi;
  let match = pattern.exec(String(html || ''));
  while (match) {
    const href = match[1];
    const decoded = decodeURIComponent(href);
    if (archivePattern.test(decoded) && !seen.has(decoded)) {
      seen.add(decoded);
      const url = new URL(href, baseUrl).href;
      files.push({ fileName: path.basename(decoded), url });
    }
    match = pattern.exec(String(html || ''));
  }
  return files;
}

function buildCdnIndexOptions(toolOrKind, html, options = {}) {
  const tool = typeof toolOrKind === 'string' ? getToolDefinition(toolOrKind) : toolOrKind;
  const cdn = tool.cdnIndex;
  if (!cdn) return [];
  return parseCdnArchiveIndex(html, cdn.url, cdn.archivePattern)
    .map((file) => {
      const version = file.fileName.replace(archiveExtension(file.fileName), '');
      return makeVersionOption(tool, {
        id: `${tool.kind}:cdn:${version}`,
        label: versionLabel(version, file.fileName),
        version,
        source: cdn.source || 'cdn-index',
        sourceUrl: cdn.url,
        downloadUrl: file.url,
        archiveName: file.fileName,
        assetName: file.fileName,
        available: true,
        note: options.note || 'EmulatorJS CDN 配布物です。',
      });
    })
    .sort(compareSemverishDesc);
}

async function fetchGithubReleases(github, options = {}) {
  const perPage = Number(options.perPage || 20);
  const url = `https://api.github.com/repos/${github.owner}/${github.repo}/releases?per_page=${perPage}`;
  const releases = await requestJson(url);
  if (!Array.isArray(releases)) throw new Error('GitHub releases response is not an array');
  return releases;
}

async function listToolVersions(kind, options = {}) {
  const tool = getToolDefinition(kind);
  const errors = [];
  const versions = [];
  versions.push(...buildFixedVersionOptions(tool, options));

  if (tool.github) {
    try {
      const releases = options.releases || await fetchGithubReleases(tool.github, options);
      versions.push(...buildGithubReleaseOptions(tool, releases, options));
    } catch (err) {
      errors.push(`GitHub releases: ${err?.message || err}`);
    }
  }

  if (tool.homebrew) {
    try {
      const formula = options.homebrewFormula || await requestJson(tool.homebrew.apiUrl);
      versions.push(...buildHomebrewBottleOptions(tool, formula, options));
    } catch (err) {
      errors.push(`Homebrew bottle: ${err?.message || err}`);
    }
  }

  if (tool.cdnIndex) {
    try {
      const html = options.cdnHtml || await requestText(tool.cdnIndex.url);
      versions.push(...buildCdnIndexOptions(tool, html, options).slice(0, Number(options.cdnLimit || 20)));
    } catch (err) {
      errors.push(`CDN index: ${err?.message || err}`);
    }
  }

  return {
    ok: errors.length === 0 || versions.length > 0,
    kind: tool.kind,
    label: tool.label,
    platform: normalizePlatform(options.platform),
    arch: normalizeArch(options.arch),
    errors,
    versions,
  };
}

function downloadToFile(url, destPath, onProgress, options = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('too many redirects'));
  }
  ensureDirSync(path.dirname(destPath));
  return new Promise((resolve, reject) => {
    const request = https.get(new URL(url), {
      headers: {
        ...REQUEST_HEADERS,
        ...(options.headers || {}),
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error('redirect without location'));
          return;
        }
        downloadToFile(new URL(location, url).href, destPath, onProgress, options, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode === 401 && !options.authRetried && response.headers['www-authenticate']) {
        const authenticate = response.headers['www-authenticate'];
        response.resume();
        getBearerAuthorizationHeader(authenticate).then((authorization) => {
          if (!authorization) throw new Error('download failed: HTTP 401');
          return downloadToFile(url, destPath, onProgress, {
            ...options,
            authRetried: true,
            headers: {
              ...(options.headers || {}),
              Authorization: authorization,
              Accept: 'application/vnd.oci.image.layer.v1.tar+gzip, application/octet-stream, */*',
            },
          }, redirectCount);
        }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`download failed: HTTP ${response.statusCode}`));
        return;
      }
      const total = Number(response.headers['content-length'] || 0);
      let received = 0;
      let lastEmitAt = 0;
      let lastPercent = -1;
      const out = fs.createWriteStream(destPath);
      response.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        const percent = total > 0 ? Math.min(80, Math.floor((received / total) * 80)) : null;
        if (percent !== lastPercent || now - lastEmitAt >= 250 || received === total) {
          lastEmitAt = now;
          lastPercent = percent;
          onProgress?.({ phase: 'download', message: '受信中...', received, total, percent });
        }
      });
      response.on('error', reject);
      response.pipe(out);
      out.on('finish', () => out.close(() => resolve(destPath)));
      out.on('error', reject);
    });
    request.on('error', reject);
  });
}

function runExtractor(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf-8' });
  if (result.status === 0) return true;
  return result.stderr || result.stdout || result.error?.message || `${command} failed`;
}

function powershellExpandArchiveArgs(archivePath, destDir) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    '& { param($ArchivePath, $DestinationPath) Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath -Force }',
    archivePath,
    destDir,
  ];
}

function runExtractors(extractors, run = runExtractor) {
  const failures = [];
  for (const [command, args] of extractors) {
    const result = run(command, args);
    if (result === true) return true;
    failures.push(result);
  }
  throw new Error(failures.filter(Boolean).join(' | ') || 'archive extraction failed');
}

function extractArchive(archivePath, destDir, options = {}) {
  ensureDirSync(destDir);
  const platform = normalizePlatform(options.platform);
  const run = options.runExtractor || runExtractor;
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    const extractors = platform === 'win32'
      ? [
        ['powershell.exe', powershellExpandArchiveArgs(archivePath, destDir)],
        ['pwsh', powershellExpandArchiveArgs(archivePath, destDir)],
        ['tar', ['-xf', archivePath, '-C', destDir]],
        ['unzip', ['-o', archivePath, '-d', destDir]],
      ]
      : [
        ['unzip', ['-o', archivePath, '-d', destDir]],
        ['tar', ['-xf', archivePath, '-C', destDir]],
      ];
    runExtractors(extractors, run);
    return { ok: true, destDir };
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const extractors = platform === 'win32'
      ? [['tar', ['-xf', archivePath, '-C', destDir]]]
      : [
        ['tar', ['-xzf', archivePath, '-C', destDir]],
        ['tar', ['-xf', archivePath, '-C', destDir]],
      ];
    runExtractors(extractors, run);
    return { ok: true, destDir };
  }
  if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) {
    const extractors = platform === 'win32'
      ? [['tar', ['-xf', archivePath, '-C', destDir]]]
      : [
        ['tar', ['-xJf', archivePath, '-C', destDir]],
        ['tar', ['-xf', archivePath, '-C', destDir]],
      ];
    runExtractors(extractors, run);
    return { ok: true, destDir };
  }
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) {
    const extractors = platform === 'win32'
      ? [['tar', ['-xf', archivePath, '-C', destDir]]]
      : [
        ['tar', ['-xjf', archivePath, '-C', destDir]],
        ['tar', ['-xf', archivePath, '-C', destDir]],
      ];
    runExtractors(extractors, run);
    return { ok: true, destDir };
  }
  if (lower.endsWith('.tar')) {
    runExtractors([['tar', ['-xf', archivePath, '-C', destDir]]], run);
    return { ok: true, destDir };
  }
  if (lower.endsWith('.7z')) {
    const extractors = [
      ['7z', ['x', '-y', `-o${destDir}`, archivePath]],
      ['7za', ['x', '-y', `-o${destDir}`, archivePath]],
      ['bsdtar', ['-xf', archivePath, '-C', destDir]],
      ['tar', ['-xf', archivePath, '-C', destDir]],
    ];
    const failures = [];
    for (const [command, args] of extractors) {
      const result = run(command, args);
      if (result === true) return { ok: true, destDir };
      failures.push(result);
    }
    throw new Error(`7z extraction failed. Install 7z/7za or bsdtar. ${failures.filter(Boolean).join(' | ')}`);
  }
  throw new Error(`unsupported archive: ${archivePath}`);
}

function sanitizeArchiveName(name) {
  return path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]/g, '_');
}

function archiveNameFromUrl(url) {
  try {
    return sanitizeArchiveName(decodeURIComponent(path.basename(new URL(url).pathname)));
  } catch (_) {
    return '';
  }
}

function makeArchiveName({ destName, url, settingKind }) {
  const explicit = sanitizeArchiveName(destName);
  if (explicit && archiveExtension(explicit)) return explicit;
  const fromUrl = archiveNameFromUrl(url);
  if (fromUrl && archiveExtension(fromUrl)) return fromUrl;
  const ext = archiveExtension(explicit || fromUrl) || '.zip';
  const base = sanitizeArchiveName(explicit || fromUrl || `${settingKind || 'tool'}-${Date.now()}`);
  return `${base.replace(/\.+$/, '')}${ext}`;
}

function resolveToolTargetDir(kind, targetDir) {
  getToolDefinition(kind);
  const root = path.resolve(getToolsDir());
  const resolved = path.resolve(targetDir || getDefaultTargetDir(kind));
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('tool target directory must be under data/tools');
  }
  return resolved;
}

function configureExtractedTool(kind, targetDir) {
  const tool = getToolDefinition(kind);
  if (kind === 'emulatorJs') {
    const runtimeDir = findEmulatorJsRuntimeDir(targetDir);
    if (runtimeDir) {
      setToolPath('emulatorJs', runtimeDir);
      return runtimeDir;
    }
    return null;
  }

  const executable = findExecutable(targetDir, executableNamesForTool(tool));
  if (executable) {
    setToolPath(kind, executable);
    return executable;
  }
  return null;
}

async function downloadTool({ url, destName, targetDir, settingKind, kind }, onProgress) {
  const toolKind = settingKind || kind;
  const tool = getToolDefinition(toolKind);
  if (!/^https:\/\//.test(String(url || ''))) {
    return { ok: false, error: 'https URL is required' };
  }
  let resolvedTargetDir;
  try {
    resolvedTargetDir = resolveToolTargetDir(tool.kind, targetDir);
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }

  const archiveName = makeArchiveName({ destName, url, settingKind: tool.kind });
  const archivePath = path.join(getToolsDir(), 'downloads', archiveName);
  try {
    onProgress?.({ phase: 'download', message: `${tool.label} をダウンロードしています`, percent: 0 });
    await downloadToFile(url, archivePath, onProgress);
    onProgress?.({ phase: 'extract', message: '展開しています...', percent: 90 });
    extractArchive(archivePath, resolvedTargetDir);
    const configuredPath = configureExtractedTool(tool.kind, resolvedTargetDir);
    if (!configuredPath) {
      return {
        ok: false,
        error: `${tool.label} を展開しましたが、必要な実行ファイルまたは runtime を検出できませんでした。`,
        path: resolvedTargetDir,
      };
    }
    onProgress?.({ phase: 'done', message: '完了しました', percent: 100 });
    return { ok: true, path: resolvedTargetDir, configuredPath, status: getStatus() };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function ensureEmulatorPlaceholder() {
  const base = getEmulatorBaseDir();
  ensureDirSync(base);
  const noticePath = path.join(base, 'README.txt');
  if (!fs.existsSync(noticePath)) {
    fs.writeFileSync(noticePath, [
      'EmulatorJS / mednafen_pce assets are GPL-3.0/GPL-2.0-family components.',
      'They are intentionally not bundled in this repository.',
      'Use the setup screen to download or select a local EmulatorJS distribution.',
      '',
    ].join('\n'), 'utf-8');
  }
  return base;
}

module.exports = {
  archiveExtension,
  assetMatchesPlatform,
  buildCdnIndexOptions,
  buildFixedVersionOptions,
  buildGithubReleaseOptions,
  buildHomebrewBottleOptions,
  buildBearerTokenUrl,
  downloadTool,
  ensureEmulatorPlaceholder,
  executableName,
  extractPceCdIpl,
  extractArchive,
  findEmulatorJsRuntimeDir,
  findExecutable,
  getDefaultTargetDir,
  getDownloadCatalog,
  getEmulatorBaseDir,
  getEmulatorJsDir,
  getLlvmMosBaseDir,
  getLlvmMosPceCdPath,
  getLlvmMosPath,
  getPceCdIplPath,
  getPceCdIplExtractDir,
  getPceCdSystemCardPath,
  getPceMkcdPath,
  getSettingsPath,
  getStatus,
  getToolDefinition,
  getToolchainPath,
  getToolsDir,
  listToolVersions,
  loadSettings,
  parseCdnArchiveIndex,
  parseBearerAuthenticateHeader,
  saveSettings,
  selectReleaseAsset,
  setToolPath,
};
