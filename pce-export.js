'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readBundledLicense(fileName) {
  const licensePath = path.join(__dirname, 'licenses', fileName);
  if (!fs.existsSync(licensePath)) {
    throw new Error(`PCE Game Editor のライセンス文書が見つかりません: ${licensePath}`);
  }
  return fs.readFileSync(licensePath);
}

function isCdRomPath(filePath) {
  return path.extname(String(filePath || '')).toLowerCase() === '.cue';
}

function crc32Hex(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return `0x${((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}

function preparePceExportMedia(romPath) {
  const resolved = path.resolve(romPath || '');
  if (!romPath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error('エクスポートできるビルド済み PCE メディアがありません。先に Build を実行してください。');
  }
  if (isCdRomPath(resolved)) {
    throw new Error('CD-ROM2 プロジェクトは Export の対象外です。HuCard プロジェクトを Build してください。');
  }

  const buffer = fs.readFileSync(resolved);
  return {
    mediaType: 'hucard',
    sourcePath: resolved,
    label: path.basename(resolved),
    gameName: path.basename(resolved),
    entryName: path.basename(resolved),
    buffer,
    files: [resolved],
    fileSize: buffer.length,
    crc32: crc32Hex(buffer),
  };
}

function mimeTypeForRelativePath(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'application/javascript';
  if (ext === '.css') return 'text/css';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

function addAsset(assets, dataDir, relativePath, options = {}) {
  const filePath = path.resolve(dataDir, relativePath);
  if (!fs.existsSync(filePath)) {
    if (options.required) throw new Error(`${options.label || relativePath} が見つかりません: ${filePath}`);
    return;
  }
  if (!fs.statSync(filePath).isFile()) return;
  assets.push({
    relativePath: relativePath.replace(/\\/g, '/'),
    mime: options.mime || mimeTypeForRelativePath(relativePath),
    buffer: fs.readFileSync(filePath),
  });
}

function findLegacyPceCore(dataDir, preferredAsset) {
  const coresDir = path.join(dataDir, 'cores');
  if (!fs.existsSync(coresDir)) return null;
  if (/legacy-wasm\.data$/i.test(String(preferredAsset || ''))
    && fs.existsSync(path.join(coresDir, preferredAsset))) return preferredAsset;
  const candidates = fs.readdirSync(coresDir)
    .filter((name) => /^mednafen_pce-legacy-wasm\.data$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  return candidates[0] || null;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function findCoreCatalogEntry(dataDir, coreName) {
  const catalog = readJsonFile(path.join(dataDir, 'cores', 'cores.json'));
  const entries = Array.isArray(catalog) ? catalog : Object.values(catalog || {});
  return entries.find((entry) => entry && entry.name === coreName) || null;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function collectPceEmulatorJsAssets(runtime) {
  if (!runtime || !runtime.dataDir || !runtime.loaderPath) {
    throw new Error('EmulatorJS runtime が未設定です。Setup で取得またはパス指定してください。');
  }
  if (!fs.existsSync(runtime.loaderPath)) {
    throw new Error(`EmulatorJS loader.js が見つかりません: ${runtime.loaderPath}`);
  }

  const dataDir = path.resolve(runtime.dataDir);
  const coreAsset = findLegacyPceCore(dataDir, runtime.coreAsset);
  if (!coreAsset) {
    throw new Error(`itch.io Export には EmulatorJS mednafen_pce legacy core が必要です: ${path.join(dataDir, 'cores')}`);
  }

  const assets = [];
  addAsset(assets, dataDir, 'loader.js', { required: true });
  addAsset(assets, dataDir, 'emulator.min.js', { required: true });
  addAsset(assets, dataDir, 'emulator.min.css', { required: true });
  addAsset(assets, dataDir, 'compression/extract7z.js', { required: true, label: 'EmulatorJS 7z 展開スクリプト' });
  addAsset(assets, dataDir, 'cores/cores.json');
  addAsset(assets, dataDir, 'cores/reports/mednafen_pce.json');
  addAsset(assets, dataDir, `cores/${coreAsset}`, { required: true });

  const runtimeRoot = path.resolve(runtime.rootDir || path.dirname(dataDir));
  const licensePath = path.join(runtimeRoot, 'LICENSE');
  if (!fs.existsSync(licensePath)) {
    throw new Error(`EmulatorJS LICENSE が見つかりません: ${licensePath}`);
  }

  const runtimePackage = readJsonFile(path.join(runtimeRoot, 'package.json')) || {};
  const coreCatalogEntry = findCoreCatalogEntry(dataDir, 'mednafen_pce') || {};
  const coreBuffer = assets.find((asset) => asset.relativePath === `cores/${coreAsset}`)?.buffer;

  return {
    assets,
    coreAsset,
    licenseText: fs.readFileSync(licensePath),
    coreLicenseText: readBundledLicense('GPL-2.0-only.txt'),
    sourceInfo: {
      emulatorJsVersion: String(runtimePackage.version || 'unrecorded'),
      emulatorJsRepository: String(runtimePackage.repository?.url || 'https://github.com/EmulatorJS/EmulatorJS'),
      coreRepository: String(coreCatalogEntry.repo || 'unrecorded'),
      coreLicenseFile: String(coreCatalogEntry.license || 'COPYING'),
      coreSha256: coreBuffer ? sha256Hex(coreBuffer) : 'unrecorded',
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function safeArchiveFileName(value, fallback = 'game.pce') {
  const basename = path.basename(String(value || fallback));
  const cleaned = basename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return cleaned || fallback;
}

function generatePceItchIoHtml({ media, emulatorAssets, appVersion = 'unknown' }) {
  if (media?.mediaType !== 'hucard') {
    throw new Error('CD-ROM2 プロジェクトは itch.io Export の対象外です。HuCard メディアだけを出力できます。');
  }
  const romName = safeArchiveFileName(media.entryName || media.label);
  const title = `${media.gameName || media.label} - PC Engine`;
  const gameUrl = `rom/${romName}`;

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { width: 100%; min-height: 100%; margin: 0; background: #000; color: #eee; font-family: system-ui, sans-serif; }
    #game { width: 100%; min-height: 100vh; }
    #fallback { position: fixed; inset: auto 12px 12px; margin: 0; color: #f3c66a; font-size: 12px; opacity: .8; pointer-events: none; }
  </style>
</head>
<body>
  <div id="game" aria-label="PC Engine game screen"></div>
  <p id="fallback">Loading ${escapeHtml(media.label)}…</p>
  <script>
    window.EJS_player = '#game';
    window.EJS_core = 'pce';
    window.EJS_gameName = ${escapedJson(romName)};
    window.EJS_gameID = ${escapedJson(`hucard:${media.crc32}`)};
    window.EJS_gameUrl = new URL(${escapedJson(gameUrl)}, window.location.href).href;
    window.EJS_pathtodata = new URL('data/', window.location.href).href;
    window.EJS_startOnLoaded = true;
    window.EJS_language = 'en-US';
    window.EJS_forceLegacyCores = true;
    window.EJS_disableDatabases = true;
    window.EJS_disableLocalStorage = true;
    window.EJS_defaultOptions = { vsync: 'disabled' };
    window.EJS_ready = () => { document.getElementById('fallback')?.remove(); };
    window.EJS_onGameStart = () => { document.getElementById('fallback')?.remove(); };
    window.addEventListener('error', (event) => {
      const fallback = document.getElementById('fallback');
      if (fallback) fallback.textContent = 'EmulatorJS error: ' + (event.message || 'unknown error');
    });
  </script>
  <script src="data/loader.js"></script>
</body>
</html>`;
}

function generatePceExportSourceMarkdown({ media, emulatorAssets }) {
  const romName = safeArchiveFileName(media.entryName || media.label);
  const sourceArchive = `${path.basename(romName, path.extname(romName))}-source.zip`;
  const sourceInfo = emulatorAssets.sourceInfo || {};
  const emulatorJsVersion = sourceInfo.emulatorJsVersion || 'unrecorded';
  const emulatorJsRepository = sourceInfo.emulatorJsRepository || 'https://github.com/EmulatorJS/EmulatorJS';
  const coreRepository = sourceInfo.coreRepository || 'unrecorded';
  const coreLicenseFile = sourceInfo.coreLicenseFile || 'COPYING';
  const coreSha256 = sourceInfo.coreSha256 || 'unrecorded';

  return `# Source availability\n\nThis document accompanies the HTML5 package for \`${romName}\`. It identifies GPL-licensed components bundled with the game package.\n\n## Where to obtain the corresponding source\n\nThe publisher must make a file named \`${sourceArchive}\` available as a separate downloadable file on the same itch.io game page as this HTML5 ZIP (or provide an equally prominent, no-charge download URL). \`SOURCE.md\` is an index to that source package; it is **not** the corresponding source by itself.\n\nThe source archive must contain the exact source snapshots, local patches, and build instructions/scripts used for the bundled components below. Keep it available for as long as this game package is distributed.\n\n## Bundled GPL components\n\n| Component | Bundled artifact | License information | Source reference | Build identity |\n| --- | --- | --- | --- | --- |\n| EmulatorJS | \`data/loader.js\`, \`data/emulator.min.js\`, \`data/emulator.min.css\`, \`data/compression/extract7z.js\` | GPL-3.0; see \`LICENSES/EmulatorJS-GPL-3.0.txt\` | ${emulatorJsRepository} (version \`${emulatorJsVersion}\`) | Include \`package.json\`, lockfile, minify/build scripts, and all local patches in \`${sourceArchive}\`. |\n| mednafen_pce legacy core | \`data/cores/${emulatorAssets.coreAsset || 'mednafen_pce-legacy-wasm.data'}\` | GPL-2.0-only; see \`LICENSES/mednafen_pce-GPL-2.0-only.txt\`, upstream \`${coreLicenseFile}\`, and all notices in the source snapshot. | ${coreRepository} | SHA-256 of bundled core data: \`${coreSha256}\`. Include the exact source commit, WASM build scripts/toolchain settings, and local patches in \`${sourceArchive}\`. |\n\n## Scope\n\nThe HuCard ROM \`rom/${romName}\` is game content loaded by the emulator. Its source is not made GPL-covered merely by running it in EmulatorJS. The PCE Game Editor application is not bundled in this HTML5 package; its whole source is not required by this notice. If the publisher distributes modified EmulatorJS, modified core code, or another combined GPL-covered component, the matching source for that work must be included in \`${sourceArchive}\`.\n\nNo PC Engine System Card or IPL is included in this package.\n`;
}

function createPceItchIoBundle({ media, emulatorAssets, appVersion = 'unknown' }) {
  if (media?.mediaType !== 'hucard') {
    throw new Error('CD-ROM2 プロジェクトは itch.io Export の対象外です。HuCard メディアだけを出力できます。');
  }
  const romName = safeArchiveFileName(media.entryName || media.label);
  const indexHtml = generatePceItchIoHtml({ media: { ...media, entryName: romName }, emulatorAssets, appVersion });
  const sourceMarkdown = generatePceExportSourceMarkdown({ media: { ...media, entryName: romName }, emulatorAssets });
  const notice = [
    'This HTML5 package bundles EmulatorJS and the mednafen_pce legacy core.',
    'EmulatorJS is distributed under GPL-3.0; mednafen_pce is distributed under GPL-2.0-only.',
    'See LICENSES/EmulatorJS-GPL-3.0.txt and LICENSES/mednafen_pce-GPL-2.0-only.txt.',
    'Before distributing this package, provide the complete corresponding source and license notices for the exact bundled versions, including your modifications and build instructions when required by the applicable licenses.',
    'PCE Game Editor does not include EmulatorJS source, the emulation-core source, any PC Engine System Card, or IPL in this package.',
  ].join('\n');
  const entries = [
    { name: 'index.html', data: Buffer.from(indexHtml, 'utf-8') },
    { name: `rom/${romName}`, data: media.buffer },
    ...emulatorAssets.assets.map((asset) => ({ name: `data/${asset.relativePath}`, data: asset.buffer })),
    { name: 'LICENSES/EmulatorJS-GPL-3.0.txt', data: emulatorAssets.licenseText },
    { name: 'LICENSES/mednafen_pce-GPL-2.0-only.txt', data: emulatorAssets.coreLicenseText || readBundledLicense('GPL-2.0-only.txt') },
    { name: 'LICENSES/NOTICE.txt', data: Buffer.from(notice, 'utf-8') },
    { name: 'SOURCE.md', data: Buffer.from(sourceMarkdown, 'utf-8') },
  ];
  return { entries, entryName: 'index.html', fileCount: entries.length, coreAsset: emulatorAssets.coreAsset };
}

module.exports = {
  collectPceEmulatorJsAssets,
  createPceItchIoBundle,
  crc32Hex,
  generatePceExportSourceMarkdown,
  generatePceItchIoHtml,
  isCdRomPath,
  preparePceExportMedia,
};
