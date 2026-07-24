'use strict';

const fs = require('fs');
const path = require('path');
const BASE64_CHUNK_SIZE = 32768;

function isCdRomPath(filePath) {
  return path.extname(String(filePath || '')).toLowerCase() === '.cue';
}

function mimeTypeForRelativePath(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'application/javascript';
  if (ext === '.css') return 'text/css';
  if (ext === '.json') return 'application/json';
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.pce' || ext === '.data' || ext === '.cue' || ext === '.iso' || ext === '.wav') return 'application/octet-stream';
  return 'application/octet-stream';
}

function splitBase64(buffer, chunkSize = BASE64_CHUNK_SIZE) {
  const b64 = Buffer.from(buffer || Buffer.alloc(0)).toString('base64');
  const chunks = [];
  for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize));
  }
  return chunks;
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

function addAsset(assets, dataDir, relativePath, options = {}) {
  const filePath = path.resolve(dataDir, relativePath);
  if (!fs.existsSync(filePath)) {
    if (options.required) {
      throw new Error(`${options.label || relativePath} が見つかりません: ${filePath}`);
    }
    return;
  }
  if (!fs.statSync(filePath).isFile()) return;
  assets.push({
    key: options.key || path.basename(relativePath),
    relativePath: relativePath.replace(/\\/g, '/'),
    mime: options.mime || mimeTypeForRelativePath(relativePath),
    size: fs.statSync(filePath).size,
    buffer: fs.readFileSync(filePath),
  });
}

function collectPceEmulatorJsAssets(runtime) {
  if (!runtime || !runtime.dataDir || !runtime.loaderPath) {
    throw new Error('EmulatorJS runtime が未設定です。Setup で取得またはパス指定してください。');
  }
  if (!fs.existsSync(runtime.loaderPath)) {
    throw new Error(`EmulatorJS loader.js が見つかりません: ${runtime.loaderPath}`);
  }
  if (!runtime.coreAsset) {
    throw new Error(`EmulatorJS mednafen_pce core が見つかりません: ${path.join(runtime.dataDir, 'cores')}`);
  }

  const dataDir = path.resolve(runtime.dataDir);
  const assets = [];
  addAsset(assets, dataDir, 'emulator.min.js', { required: true });
  addAsset(assets, dataDir, 'emulator.min.css', { required: true });
  addAsset(assets, dataDir, 'cores/cores.json', { required: false });
  addAsset(assets, dataDir, 'cores/reports/mednafen_pce.json', { required: false, key: 'mednafen_pce.json' });

  const coresDir = path.join(dataDir, 'cores');
  if (fs.existsSync(coresDir)) {
    fs.readdirSync(coresDir)
      .filter((fileName) => /^mednafen_pce.*-wasm\.data$/i.test(fileName))
      .sort((left, right) => left.localeCompare(right))
      .forEach((fileName) => addAsset(assets, dataDir, `cores/${fileName}`, { required: false }));
  }
  if (!assets.some((asset) => asset.key === runtime.coreAsset)) {
    addAsset(assets, dataDir, `cores/${runtime.coreAsset}`, { required: true });
  }

  return {
    loaderText: fs.readFileSync(runtime.loaderPath, 'utf-8'),
    assets,
    runtimeRoot: runtime.rootDir || path.dirname(dataDir),
    dataDir,
    coreAsset: runtime.coreAsset,
  };
}

function escapedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeScriptContent(value) {
  return String(value || '').replace(/<\/script>/gi, '<\\/script>');
}

function buildExportPayload({ media, emulatorAssets }) {
  return {
    media: {
      label: media.label,
      gameName: media.gameName,
      entryName: media.entryName,
      mediaType: media.mediaType,
      mime: 'application/octet-stream',
      size: media.fileSize,
      crc32: media.crc32,
      chunks: splitBase64(media.buffer),
    },
    assets: emulatorAssets.assets.map((asset) => ({
      key: asset.key,
      relativePath: asset.relativePath,
      mime: asset.mime,
      size: asset.size,
      chunks: splitBase64(asset.buffer),
    })),
  };
}

function generatePceExportHtml({
  media,
  emulatorAssets,
  appVersion = 'unknown',
  appBuildNumber = 'dev',
  appBuildAt = 'N/A',
}) {
  if (media?.mediaType !== 'hucard') {
    throw new Error('CD-ROM2 プロジェクトは HTML Export の対象外です。HuCard メディアだけを出力できます。');
  }
  const payload = buildExportPayload({ media, emulatorAssets });
  const title = `${media.label} - PC Engine`;
  const mediaKind = 'HuCard';
  const loaderText = escapeScriptContent(emulatorAssets.loaderText);
  const payloadJson = escapedJson(payload);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; background: #101315; color: #edf4f2; font-family: system-ui, "Segoe UI", sans-serif; }
    body { display: flex; flex-direction: column; }
    header { min-height: 48px; display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid #2b3638; background: #151a1d; }
    h1 { margin: 0; font-size: 15px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    main { flex: 1; display: grid; grid-template-rows: minmax(260px, 1fr) auto; min-height: 0; }
    #game { position: relative; min-height: 260px; outline: none; background: #000; }
    .status-bar { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-top: 1px solid #2b3638; background: #151a1d; flex-wrap: wrap; }
    #status { color: #6fd7cf; font-size: 12px; min-height: 18px; flex: 1 1 240px; }
    button { border: 1px solid #445155; background: #263235; color: #edf4f2; border-radius: 7px; padding: 7px 11px; font-size: 13px; cursor: pointer; }
    button:hover { border-color: #6fd7cf; background: #2d3d40; }
    .media-details { border-top: 1px solid #2b3638; background: #11181a; padding: 8px 12px; font-size: 12px; color: #c5d0cf; }
    .media-details summary { cursor: pointer; color: #f4c86a; font-weight: 700; }
    .info-grid { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 5px 12px; margin-top: 8px; }
    .info-grid dt { color: #8fb1ae; }
    .info-grid dd { margin: 0; word-break: break-all; }
    .virtual-gamepad { position: absolute; inset: auto 12px 12px; display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; pointer-events: none; opacity: 0.72; z-index: 6; }
    .dpad { display: grid; grid-template-columns: repeat(3, 44px); grid-template-rows: repeat(3, 44px); gap: 5px; pointer-events: auto; }
    .face-buttons { display: grid; grid-template-columns: repeat(2, 52px); grid-template-rows: 52px 30px; gap: 9px; pointer-events: auto; }
    .pad-btn { touch-action: none; user-select: none; -webkit-user-select: none; border-radius: 999px; padding: 0; font-weight: 800; background: rgba(26, 35, 38, 0.74); border-color: rgba(237, 244, 242, 0.28); }
    .pad-btn:active, .pad-btn.active { background: rgba(111, 215, 207, 0.72); color: #071011; }
    .pad-up { grid-column: 2; grid-row: 1; }
    .pad-left { grid-column: 1; grid-row: 2; }
    .pad-right { grid-column: 3; grid-row: 2; }
    .pad-down { grid-column: 2; grid-row: 3; }
    .pad-a { grid-column: 1; grid-row: 1; }
    .pad-b { grid-column: 2; grid-row: 1; }
    .pad-select { grid-column: 1; grid-row: 2; border-radius: 16px; height: 30px; font-size: 11px; }
    .pad-start { grid-column: 2; grid-row: 2; border-radius: 16px; height: 30px; font-size: 11px; }
    @media (pointer: fine) and (min-width: 760px) {
      .virtual-gamepad { opacity: 0; }
      #game:hover .virtual-gamepad { opacity: 0.56; }
    }
    @media (max-width: 560px) {
      .info-grid { grid-template-columns: 1fr; }
      .dpad { grid-template-columns: repeat(3, 38px); grid-template-rows: repeat(3, 38px); }
      .face-buttons { grid-template-columns: repeat(2, 46px); grid-template-rows: 46px 28px; }
      .status-bar button { flex: 1 1 auto; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(media.gameName || media.label)}</h1>
  </header>
  <main>
    <div id="game" tabindex="0" aria-label="PC Engine game screen">
      <div class="virtual-gamepad" aria-label="Virtual PCE gamepad">
        <div class="dpad" aria-label="Directional buttons">
          <button class="pad-btn pad-up" data-pce-btn="UP" type="button" aria-label="Up">U</button>
          <button class="pad-btn pad-left" data-pce-btn="LEFT" type="button" aria-label="Left">L</button>
          <button class="pad-btn pad-right" data-pce-btn="RIGHT" type="button" aria-label="Right">R</button>
          <button class="pad-btn pad-down" data-pce-btn="DOWN" type="button" aria-label="Down">D</button>
        </div>
        <div class="face-buttons" aria-label="Action buttons">
          <button class="pad-btn pad-a" data-pce-btn="A" type="button" aria-label="Button I">I</button>
          <button class="pad-btn pad-b" data-pce-btn="B" type="button" aria-label="Button II">II</button>
          <button class="pad-btn pad-select" data-pce-btn="SELECT" type="button" aria-label="Select">SELECT</button>
          <button class="pad-btn pad-start" data-pce-btn="START" type="button" aria-label="Run">RUN</button>
        </div>
      </div>
    </div>
    <div>
      <div class="status-bar">
        <span id="status">Loading embedded PC Engine export...</span>
        <button id="downloadMedia" type="button">Download media</button>
        <button id="fullscreen" type="button">Fullscreen</button>
      </div>
      <details class="media-details">
        <summary>Export Information</summary>
        <dl class="info-grid">
          <dt>Media</dt><dd>${escapeHtml(mediaKind)}</dd>
          <dt>File</dt><dd>${escapeHtml(media.label)}</dd>
          <dt>Entry</dt><dd>${escapeHtml(media.entryName || media.label)}</dd>
          <dt>Size</dt><dd id="mediaSize">${escapeHtml(String(media.fileSize))} bytes</dd>
          <dt>CRC32</dt><dd>${escapeHtml(media.crc32)}</dd>
          <dt>EmulatorJS core</dt><dd>${escapeHtml(emulatorAssets.coreAsset || 'mednafen_pce')}</dd>
          <dt>Export build</dt><dd>${escapeHtml(String(appVersion))} / ${escapeHtml(String(appBuildNumber))} / ${escapeHtml(String(appBuildAt || 'N/A'))}</dd>
        </dl>
      </details>
    </div>
  </main>
  <script id="pce-export-payload" type="application/json">${payloadJson}</script>
  <script>
(() => {
  const payload = JSON.parse(document.getElementById('pce-export-payload').textContent);
  const status = document.getElementById('status');
  const game = document.getElementById('game');
  const objectUrls = [];
  const inputIndexes = { UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, B: 0, SELECT: 2, START: 3 };
  const keyboard = new Map([
    ['ArrowUp', inputIndexes.UP], ['ArrowDown', inputIndexes.DOWN],
    ['ArrowLeft', inputIndexes.LEFT], ['ArrowRight', inputIndexes.RIGHT],
    ['KeyA', inputIndexes.A], ['Space', inputIndexes.A],
    ['KeyZ', inputIndexes.B], ['ShiftLeft', inputIndexes.SELECT],
    ['ShiftRight', inputIndexes.SELECT], ['Enter', inputIndexes.START],
    ['NumpadEnter', inputIndexes.START],
  ]);
  const setStatus = (text, isError = false) => {
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#ff9b9b' : '#6fd7cf';
  };
  const blobFromChunks = (chunks, mime) => {
    const parts = [];
    for (const chunk of chunks || []) {
      const binary = atob(chunk);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
    }
    return new Blob(parts, { type: mime || 'application/octet-stream' });
  };
  const urlFor = (entry) => {
    const url = URL.createObjectURL(blobFromChunks(entry.chunks, entry.mime));
    objectUrls.push(url);
    return url;
  };
  const assetUrls = {};
  for (const asset of payload.assets || []) {
    assetUrls[asset.key] = urlFor(asset);
  }
  window.__PCE_EXPORT_ASSET_URLS = assetUrls;
  window.EJS_paths = assetUrls;

  const assetUrlForRequest = (resource) => {
    const rawUrl = typeof resource === 'string' ? resource : (resource && resource.url) || '';
    const basename = String(rawUrl).split('/').pop().replace(/[?#].*$/, '');
    return assetUrls[basename] || '';
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (resource, init) => {
    const assetUrl = assetUrlForRequest(resource);
    if (assetUrl) return nativeFetch(assetUrl, init);
    return nativeFetch(resource, init);
  };

  function installRuntimeGlobalBridge() {
    const NativeBlob = window.Blob;
    const NativeAppendChild = Element.prototype.appendChild;
    const NativeInsertBefore = Element.prototype.insertBefore;
    const bridgeCode = ';try{if(typeof EJS_Runtime!=="undefined"){globalThis.EJS_Runtime=EJS_Runtime;}}catch(_e){}';
    const mapAssetElement = (child) => {
      if (child instanceof HTMLScriptElement && child.src) {
        const assetUrl = assetUrlForRequest(child.src);
        if (assetUrl) child.src = assetUrl;
      } else if (child instanceof HTMLLinkElement && child.href) {
        const assetUrl = assetUrlForRequest(child.href);
        if (assetUrl) child.href = assetUrl;
      }
      return child;
    };
    const appendScriptWithBridge = (owner, script, append) => {
      nativeFetch(script.src)
        .then((response) => response.ok ? response.text() : Promise.reject(new Error('HTTP ' + response.status)))
        .then((source) => {
          const bridgedUrl = URL.createObjectURL(new NativeBlob([source, '\\n', bridgeCode, '\\n'], { type: script.type || 'application/javascript' }));
          objectUrls.push(bridgedUrl);
          script.src = bridgedUrl;
          append.call(owner, script);
        })
        .catch(() => append.call(owner, script));
      return script;
    };
    Element.prototype.appendChild = function appendChildWithRuntimeBridge(child) {
      mapAssetElement(child);
      if (child instanceof HTMLScriptElement && child.src && child.src.startsWith('blob:')) {
        return appendScriptWithBridge(this, child, NativeAppendChild);
      }
      return NativeAppendChild.call(this, child);
    };
    Element.prototype.insertBefore = function insertBeforeWithRuntimeBridge(child, referenceNode) {
      mapAssetElement(child);
      if (child instanceof HTMLScriptElement && child.src && child.src.startsWith('blob:')) {
        return appendScriptWithBridge(this, child, function appendBefore(script) {
          return NativeInsertBefore.call(this, script, referenceNode);
        });
      }
      return NativeInsertBefore.call(this, child, referenceNode);
    };
  }

  const focusGame = () => {
    window.focus();
    game?.focus({ preventScroll: true });
  };
  const gameManager = () => window.EJS_emulator && window.EJS_emulator.gameManager;
  const sendInput = (button, down) => {
    const manager = gameManager();
    if (!manager || typeof manager.simulateInput !== 'function') return false;
    manager.simulateInput(0, button, down ? 1 : 0);
    return true;
  };
  const pressedKeys = new Map();
  const isEditableTarget = (target) => Boolean(target && typeof target.closest === 'function' && target.closest('input, textarea, select, button, [contenteditable="true"]'));
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
    const button = keyboard.get(event.code) ?? keyboard.get(event.key);
    if (button == null) return;
    if (pressedKeys.get(event.code)) {
      event.preventDefault();
      return;
    }
    pressedKeys.set(event.code, button);
    if (sendInput(button, true)) {
      event.preventDefault();
      focusGame();
    }
  }, true);
  window.addEventListener('keyup', (event) => {
    const button = pressedKeys.get(event.code);
    if (button == null) return;
    pressedKeys.delete(event.code);
    if (sendInput(button, false)) event.preventDefault();
  }, true);
  window.addEventListener('blur', () => {
    pressedKeys.forEach((button) => sendInput(button, false));
    pressedKeys.clear();
  });
  document.querySelectorAll('[data-pce-btn]').forEach((button) => {
    const index = inputIndexes[button.dataset.pceBtn];
    if (index == null) return;
    const release = () => {
      button.classList.remove('active');
      sendInput(index, false);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add('active');
      sendInput(index, true);
      focusGame();
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });

  document.getElementById('downloadMedia')?.addEventListener('click', () => {
    const url = urlFor(payload.media);
    const link = document.createElement('a');
    link.href = url;
    link.download = payload.media.label || 'pce-export.bin';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('fullscreen')?.addEventListener('click', () => {
    const target = document.getElementById('game');
    if (document.fullscreenElement) document.exitFullscreen();
    else target?.requestFullscreen?.();
  });

  window.addEventListener('error', (event) => setStatus('Error: ' + (event.message || 'runtime error'), true));
  window.addEventListener('unhandledrejection', (event) => setStatus('Error: ' + (event.reason?.message || event.reason || 'runtime error'), true));
  window.addEventListener('beforeunload', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
  window.addEventListener('pointerdown', focusGame, true);

  installRuntimeGlobalBridge();
  window.EJS_player = '#game';
  window.EJS_core = 'pce';
  window.EJS_gameName = payload.media.entryName || payload.media.label || 'pce-export.pce';
  window.EJS_gameID = payload.media.mediaType + ':' + payload.media.crc32;
  window.EJS_color = '#6fd7cf';
  window.EJS_backgroundColor = '#000000';
  window.EJS_startOnLoaded = true;
  window.EJS_language = 'en-US';
  window.EJS_disableDatabases = true;
  window.EJS_disableLocalStorage = true;
  window.EJS_defaultOptions = { webgl2Enabled: 'enabled' };
  window.EJS_cacheConfig = { enabled: false, cacheMaxSizeMB: 1, cacheMaxAgeMins: 1 };
  window.EJS_pathtodata = 'pce-export-data/';
  window.EJS_gameUrl = urlFor(payload.media);
  window.EJS_ready = () => {
    setStatus('Emulator ready');
    focusGame();
  };
  window.EJS_onGameStart = () => {
    setStatus('Running');
    focusGame();
  };
})();
  </script>
  <script>
${loaderText}
  </script>
</body>
</html>`;
}

module.exports = {
  collectPceEmulatorJsAssets,
  crc32Hex,
  generatePceExportHtml,
  isCdRomPath,
  preparePceExportMedia,
  splitBase64,
};
