const IMAGE_EXTS = ['.png', '.bmp', '.webp'];
const SPRITE_CELL_SIZES = ['16x16', '16x32', '16x64', '32x16', '32x32', '32x64'];
const PCE_BG_AUTO_TILE_BASE = 128;
const PCE_BG_AUTO_MAP_BASE = 0;
const DEFAULT_SPRITE_TILE_BASE = 704;
const DEFAULT_SPRITE_PALETTE_BANK = 0;
const DEFAULT_SPRITE_X = 144;
const DEFAULT_SPRITE_Y = 104;
const DEFAULT_SPRITE_TRANSPARENT_INDEX = 0;
const DEFAULT_IMPORT_FRAME_WIDTH = 16;
const DEFAULT_IMPORT_FRAME_HEIGHT = 16;
const DEFAULT_IMPORT_FRAME_COUNT = 1;
const DEFAULT_IMPORT_FRAME_DELAY = 1;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function extname(filePath = '') {
  const match = String(filePath).toLowerCase().match(/(\.[^.\\/]+)$/);
  return match ? match[1] : '';
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function safeId(value, fallback = 'image_asset') {
  const id = String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return id || fallback;
}

function sourceBasename(source = '') {
  return String(source || '').split(/[\\/]/).pop() || '';
}

function assetNameParts(asset = {}) {
  const label = String(asset.name || asset.id || '').trim();
  const parts = label.split('/').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [label || asset.id || ''];
}

function assetDisplayName(asset = {}) {
  const parts = assetNameParts(asset);
  return parts[parts.length - 1] || asset.id || '';
}

function assetGroupParts(asset = {}) {
  const parts = assetNameParts(asset);
  return parts.slice(0, -1);
}

function assetFullName(asset = {}) {
  return assetNameParts(asset).join('/');
}

function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'ja', { numeric: true, sensitivity: 'base' });
}

function compareSortValues(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftList = Array.isArray(left) ? left : [left];
    const rightList = Array.isArray(right) ? right : [right];
    const length = Math.max(leftList.length, rightList.length);
    for (let index = 0; index < length; index += 1) {
      const result = compareSortValues(leftList[index], rightList[index]);
      if (result) return result;
    }
    return 0;
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return compareText(left, right);
}

function imageKind(asset = {}) {
  return asset.type === 'sprite' || asset.options?.kind === 'sprite' ? 'sprite' : 'background';
}

function generatedInfo(asset = {}) {
  return asset.data?.generated || {};
}

function formatSize(asset = {}) {
  const options = asset.options || {};
  const generated = generatedInfo(asset);
  const width = options.width || generated.width || 0;
  const height = options.height || generated.height || 0;
  return width && height ? `${width}x${height}` : '-';
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = dataUrl;
  });
}

function positiveNumber(value, fallback = 0) {
  const parsed = asNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function spriteSheetMetrics(asset = {}) {
  const options = asset.options || {};
  const generated = generatedInfo(asset);
  const cellWidth = Math.max(16, positiveNumber(options.cellWidth ?? generated.cellWidth, 16));
  const cellHeight = Math.max(16, positiveNumber(options.cellHeight ?? generated.cellHeight, 16));
  const generatedColumns = positiveNumber(generated.cellColumns ?? generated.columns, 0);
  const generatedRows = positiveNumber(generated.cellRows ?? generated.rows, 0);
  const generatedWidth = positiveNumber(generated.width, generatedColumns ? generatedColumns * cellWidth : 0);
  const generatedHeight = positiveNumber(generated.height, generatedRows ? generatedRows * cellHeight : 0);
  const width = Math.max(cellWidth, positiveNumber(options.width, generatedWidth || cellWidth));
  const height = Math.max(cellHeight, positiveNumber(options.height, generatedHeight || cellHeight));
  const columns = Math.max(1, Math.floor(width / cellWidth));
  const rows = Math.max(1, Math.floor(height / cellHeight));
  return {
    cellWidth,
    cellHeight,
    width,
    height,
    columns,
    rows,
    totalCells: Math.max(1, columns * rows),
  };
}

function spriteAnimationDefaults(asset = {}, mode = 'whole') {
  const metrics = spriteSheetMetrics(asset);
  const useCells = mode === 'cells';
  const frameWidth = useCells ? metrics.cellWidth : metrics.width;
  const frameHeight = useCells ? metrics.cellHeight : metrics.height;
  const frameWidthCells = Math.max(1, Math.ceil(frameWidth / metrics.cellWidth));
  const frameHeightCells = Math.max(1, Math.ceil(frameHeight / metrics.cellHeight));
  const frameStrideCells = Math.max(1, frameWidthCells * frameHeightCells);
  return {
    id: 'default',
    name: 'Default',
    frameWidth,
    frameHeight,
    firstCell: 0,
    frameCount: useCells ? metrics.totalCells : 1,
    frameDelay: 8,
    frameStrideCells: useCells ? frameStrideCells : metrics.totalCells,
    loop: true,
  };
}

function normalizeAnimationForPreview(animation = {}, asset = {}, index = 0) {
  const metrics = spriteSheetMetrics(asset);
  const fallback = spriteAnimationDefaults(asset, index === 0 ? 'whole' : 'cells');
  const raw = animation && typeof animation === 'object' ? animation : {};
  const frameWidth = Math.max(
    metrics.cellWidth,
    Math.ceil(clampInt(raw.frameWidth, metrics.cellWidth, 256, fallback.frameWidth) / metrics.cellWidth) * metrics.cellWidth,
  );
  const frameHeight = Math.max(
    metrics.cellHeight,
    Math.ceil(clampInt(raw.frameHeight, metrics.cellHeight, 256, fallback.frameHeight) / metrics.cellHeight) * metrics.cellHeight,
  );
  const frameWidthCells = Math.max(1, Math.ceil(frameWidth / metrics.cellWidth));
  const frameHeightCells = Math.max(1, Math.ceil(frameHeight / metrics.cellHeight));
  const frameCells = Math.max(1, frameWidthCells * frameHeightCells);
  const firstCell = clampInt(raw.firstCell, 0, Math.max(0, metrics.totalCells - 1), fallback.firstCell);
  const frameStrideCells = clampInt(raw.frameStrideCells, 1, metrics.totalCells, fallback.frameStrideCells || frameCells);
  const maxFrames = Math.max(1, Math.floor((metrics.totalCells - firstCell - frameCells) / frameStrideCells) + 1);
  const id = safeId(raw.id, index === 0 ? 'default' : `anim_${index + 1}`).slice(0, 32);
  const frameCount = Math.min(clampInt(raw.frameCount, 1, 64, fallback.frameCount), maxFrames);
  const frameDelay = clampInt(raw.frameDelay, 1, 60, fallback.frameDelay);
  const rawFrameDelays = Array.isArray(raw.frameDelays) ? raw.frameDelays : [];
  return {
    id,
    name: String(raw.name || id || fallback.name).trim().slice(0, 48),
    frameWidth,
    frameHeight,
    firstCell,
    frameCount,
    frameDelay,
    frameDelays: Array.from({ length: frameCount }, (_, frameIndex) => clampInt(rawFrameDelays[frameIndex], 1, 60, frameDelay)),
    frameStrideCells,
    loop: raw.loop !== false,
  };
}

function spriteAnimationsForAsset(asset = {}) {
  const animations = Array.isArray(asset.options?.animations) && asset.options.animations.length
    ? asset.options.animations
    : [spriteAnimationDefaults(asset, 'whole')];
  return animations.map((animation, index) => normalizeAnimationForPreview(animation, asset, index));
}

function spriteFrameRect(animation = {}, asset = {}, image = null, frameIndex = 0) {
  const metrics = spriteSheetMetrics(asset);
  const sheetWidth = Math.max(metrics.cellWidth, image?.naturalWidth || image?.width || metrics.width);
  const sheetHeight = Math.max(metrics.cellHeight, image?.naturalHeight || image?.height || metrics.height);
  const columns = Math.max(1, Math.floor(sheetWidth / metrics.cellWidth));
  const safeFrame = clampInt(frameIndex, 0, Math.max(0, (animation.frameCount || 1) - 1), 0);
  const startCell = clampInt(
    (animation.firstCell || 0) + (safeFrame * Math.max(1, animation.frameStrideCells || 1)),
    0,
    Math.max(0, columns * Math.max(1, Math.floor(sheetHeight / metrics.cellHeight)) - 1),
    0,
  );
  const x = (startCell % columns) * metrics.cellWidth;
  const y = Math.floor(startCell / columns) * metrics.cellHeight;
  return {
    x,
    y,
    width: Math.max(1, Math.min(animation.frameWidth || metrics.cellWidth, sheetWidth - x)),
    height: Math.max(1, Math.min(animation.frameHeight || metrics.cellHeight, sheetHeight - y)),
  };
}

function getImagePipeline(api) {
  const all = typeof api.capabilities.all === 'function'
    ? api.capabilities.all('image-import-pipeline')
    : [];
  const fallback = api.capabilities.get('image-import-pipeline');
  return [...all, fallback].find((pipeline) => pipeline?.convertToIndexed16) || null;
}

export function createImageAssetManagerPlugin(config = {}) {
  const kind = config.kind === 'sprite' ? 'sprite' : 'background';
  const assetType = kind === 'sprite' ? 'sprite' : 'image';
  const title = config.title || (kind === 'sprite' ? 'Sprite Sheets' : 'Backgrounds');
  const summaryLabel = config.summaryLabel || (kind === 'sprite' ? 'sheets' : 'backgrounds');
  const importTitle = config.importTitle || (kind === 'sprite' ? 'スプライト追加' : '背景追加');
  const capabilityName = config.capabilityName || (kind === 'sprite' ? 'sprite-manager' : 'background-manager');
  const defaultTileBase = kind === 'sprite' ? DEFAULT_SPRITE_TILE_BASE : PCE_BG_AUTO_TILE_BASE;
  const defaultWidth = kind === 'sprite' ? 64 : 224;
  const defaultHeight = kind === 'sprite' ? 128 : 136;
  const fallbackId = kind === 'sprite' ? 'sprite_asset' : 'bg_asset';

  return function activatePlugin({ plugin, root, api, logger, registerCapability }) {
    root.innerHTML = `
      <div class="pce-image-manager-layout pce-image-manager-${kind}" data-plugin-root="${esc(plugin.id)}">
        <section class="pce-image-manager-list-panel">
          <div class="pce-image-manager-header">
            <div>
              <h2>${esc(title)}</h2>
              <div class="pce-image-manager-summary" data-role="summary">-</div>
            </div>
            <div class="pce-image-manager-actions">
              <button class="icon-btn" type="button" data-action="add" title="追加" aria-label="追加">＋</button>
              <button class="icon-btn" type="button" data-action="refresh" title="更新" aria-label="更新">↻</button>
            </div>
          </div>
          <div class="pce-image-manager-table-wrap">
            <table class="pce-image-manager-table">
              <thead>
                <tr>
                  <th><button class="pce-image-manager-sort" type="button" data-sort-key="name">Name <span data-sort-indicator></span></button></th>
                  <th><button class="pce-image-manager-sort" type="button" data-sort-key="id">ID <span data-sort-indicator></span></button></th>
                  <th><button class="pce-image-manager-sort" type="button" data-sort-key="size">Size <span data-sort-indicator></span></button></th>
                  <th><button class="pce-image-manager-sort" type="button" data-sort-key="tiles">Tiles <span data-sort-indicator></span></button></th>
                  <th><button class="pce-image-manager-sort" type="button" data-sort-key="source">Source <span data-sort-indicator></span></button></th>
                  <th class="pce-image-manager-row-actions"></th>
                </tr>
              </thead>
              <tbody data-role="rows">
                <tr><td colspan="7" class="pce-image-manager-empty">読み込み中...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="form-error pce-image-manager-status" data-role="status"></div>
        </section>

        <div class="pce-image-manager-resizer" data-role="pane-resizer" role="separator" aria-orientation="vertical" aria-label="一覧と詳細の幅を変更"></div>

        <aside class="pce-image-manager-detail-panel">
          <div class="asset-no-selection-hint" data-role="empty-detail">アセットを選択してください</div>
          <form class="settings-form compact-form pce-image-manager-form" data-role="form" hidden>
            <div class="pce-image-manager-detail-head">
              <div>
                <h2 data-role="detail-title">${esc(title)}</h2>
                <code data-role="detail-source"></code>
              </div>
            </div>
            <div class="image-preview-frame pce-image-manager-preview">
              <img data-role="preview" alt="PCE image preview" hidden />
              <canvas class="pce-image-manager-sprite-preview" data-role="sprite-preview" hidden></canvas>
              <div class="inline-no-preview" data-role="no-preview">プレビューできる画像がありません</div>
            </div>
            <div class="pce-image-manager-form-grid">
              <label class="form-group">
                <span class="form-label">ID</span>
                <input class="form-input form-input-mono" name="id" />
              </label>
              <label class="form-group">
                <span class="form-label">Name</span>
                <input class="form-input" name="name" />
              </label>
              ${kind === 'sprite' ? `
                <label class="form-group">
                  <span class="form-label">Tile base</span>
                  <input class="form-input" name="tileBase" type="number" min="0" max="2047" />
                </label>
                <label class="form-group">
                  <span class="form-label">X</span>
                  <input class="form-input" name="x" type="number" min="0" max="255" />
                </label>
                <label class="form-group">
                  <span class="form-label">Y</span>
                  <input class="form-input" name="y" type="number" min="0" max="255" />
                </label>
                <label class="form-group">
                  <span class="form-label">Cell size</span>
                  <select class="form-select" name="cellSize">
                    ${SPRITE_CELL_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
                  </select>
                </label>
              ` : ''}
              ${kind === 'sprite' ? '' : `
                  <input name="tileBase" type="hidden" value="${PCE_BG_AUTO_TILE_BASE}" />
                  <input name="mapBase" type="hidden" value="${PCE_BG_AUTO_MAP_BASE}" />
              `}
            </div>
            <div class="pce-image-manager-animation-editor" data-role="animation-editor" hidden></div>
            <div class="pce-image-manager-stats" data-role="stats"></div>
            <div class="image-preview-palette pce-image-manager-palette" data-role="palette"></div>
            <div class="pce-image-manager-files" data-role="files"></div>
            <div class="pce-image-manager-diagnostics" data-role="diagnostics"></div>
            <div class="form-actions-inline">
              <button class="btn-primary" type="submit">保存</button>
              <button class="icon-btn" type="button" data-action="delete" title="削除" aria-label="削除">✕</button>
            </div>
            <div class="form-error" data-role="form-error"></div>
          </form>
        </aside>
      </div>
    `;

    const layoutEl = root.querySelector('.pce-image-manager-layout');
    const listPanelEl = root.querySelector('.pce-image-manager-list-panel');
    const paneResizerEl = root.querySelector('[data-role="pane-resizer"]');
    const rowsEl = root.querySelector('[data-role="rows"]');
    const summaryEl = root.querySelector('[data-role="summary"]');
    const statusEl = root.querySelector('[data-role="status"]');
    const emptyDetailEl = root.querySelector('[data-role="empty-detail"]');
    const formEl = root.querySelector('[data-role="form"]');
    const formErrorEl = root.querySelector('[data-role="form-error"]');
    const titleEl = root.querySelector('[data-role="detail-title"]');
    const sourceEl = root.querySelector('[data-role="detail-source"]');
    const previewFrameEl = root.querySelector('.pce-image-manager-preview');
    const previewEl = root.querySelector('[data-role="preview"]');
    const spritePreviewEl = root.querySelector('[data-role="sprite-preview"]');
    const noPreviewEl = root.querySelector('[data-role="no-preview"]');
    const animationEditorEl = root.querySelector('[data-role="animation-editor"]');
    const statsEl = root.querySelector('[data-role="stats"]');
    const paletteEl = root.querySelector('[data-role="palette"]');
    const filesEl = root.querySelector('[data-role="files"]');
    const diagnosticsEl = root.querySelector('[data-role="diagnostics"]');

    let assets = [];
    let selectedId = '';
    let importBusy = false;
    let previewLoadToken = 0;
    let sortState = { key: 'name', direction: 'asc' };
    const spritePreviewState = {
      image: null,
      assetId: '',
      animationIndex: 0,
      frameIndex: 0,
      playing: false,
      timer: 0,
    };
    const previewViewportState = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      panning: false,
      pointerId: 0,
      startX: 0,
      startY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
    };
    const assetApi = api.assets || {};

    const listPceAssets = (options = {}) => assetApi.listPceAssets
      ? assetApi.listPceAssets(options)
      : api.electronAPI.listAssets();
    const upsertPceAsset = (asset) => assetApi.upsertPceAsset
      ? assetApi.upsertPceAsset(asset)
      : api.electronAPI.upsertAsset(asset);
    const deletePceAsset = (assetId) => assetApi.deletePceAsset
      ? assetApi.deletePceAsset(assetId)
      : api.electronAPI.deleteAsset(assetId);
    const importPceImage = (payload) => assetApi.importPceImage
      ? assetApi.importPceImage(payload)
      : api.electronAPI.importAssetImage(payload);
    const previewPceAssetSource = (relativePath) => assetApi.previewPceAssetSource
      ? assetApi.previewPceAssetSource(relativePath)
      : api.electronAPI.previewAssetSource(relativePath);

    function setStatus(message = '', type = '') {
      statusEl.textContent = message;
      statusEl.dataset.kind = type;
    }

    function previewTargets() {
      return [previewEl, spritePreviewEl].filter(Boolean);
    }

    function hasVisiblePreview() {
      return Boolean((previewEl && !previewEl.hidden) || (spritePreviewEl && !spritePreviewEl.hidden));
    }

    function applyPreviewViewport() {
      const transform = `translate(${previewViewportState.offsetX}px, ${previewViewportState.offsetY}px) scale(${previewViewportState.scale})`;
      previewTargets().forEach((target) => {
        target.style.transform = transform;
      });
      previewFrameEl?.classList.toggle('is-zoomed', previewViewportState.scale > 1.001);
    }

    function resetPreviewViewport() {
      previewViewportState.scale = 1;
      previewViewportState.offsetX = 0;
      previewViewportState.offsetY = 0;
      previewViewportState.panning = false;
      previewFrameEl?.classList.remove('is-panning');
      applyPreviewViewport();
    }

    function zoomPreview(event) {
      if (!hasVisiblePreview()) return;
      event.preventDefault();
      const rect = previewFrameEl.getBoundingClientRect();
      const oldScale = previewViewportState.scale;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextScale = Math.max(1, Math.min(16, oldScale * factor));
      if (Math.abs(nextScale - oldScale) < 0.001) return;
      const pointerX = event.clientX - rect.left - (rect.width / 2);
      const pointerY = event.clientY - rect.top - (rect.height / 2);
      const ratio = nextScale / oldScale;
      previewViewportState.offsetX = pointerX - ((pointerX - previewViewportState.offsetX) * ratio);
      previewViewportState.offsetY = pointerY - ((pointerY - previewViewportState.offsetY) * ratio);
      previewViewportState.scale = nextScale;
      applyPreviewViewport();
    }

    function beginPreviewPan(event) {
      if (event.button !== 1 || !hasVisiblePreview()) return;
      event.preventDefault();
      previewViewportState.panning = true;
      previewViewportState.pointerId = event.pointerId;
      previewViewportState.startX = event.clientX;
      previewViewportState.startY = event.clientY;
      previewViewportState.startOffsetX = previewViewportState.offsetX;
      previewViewportState.startOffsetY = previewViewportState.offsetY;
      previewFrameEl.classList.add('is-panning');
      previewFrameEl.setPointerCapture?.(event.pointerId);
    }

    function movePreviewPan(event) {
      if (!previewViewportState.panning || event.pointerId !== previewViewportState.pointerId) return;
      event.preventDefault();
      previewViewportState.offsetX = previewViewportState.startOffsetX + (event.clientX - previewViewportState.startX);
      previewViewportState.offsetY = previewViewportState.startOffsetY + (event.clientY - previewViewportState.startY);
      applyPreviewViewport();
    }

    function endPreviewPan(event) {
      if (!previewViewportState.panning || event.pointerId !== previewViewportState.pointerId) return;
      previewViewportState.panning = false;
      previewFrameEl.classList.remove('is-panning');
      previewFrameEl.releasePointerCapture?.(event.pointerId);
    }

    function setupInteractivePreview() {
      if (!previewFrameEl) return () => {};
      const preventMiddleClick = (event) => {
        if (event.button === 1) event.preventDefault();
      };
      previewFrameEl.addEventListener('wheel', zoomPreview, { passive: false });
      previewFrameEl.addEventListener('pointerdown', beginPreviewPan);
      previewFrameEl.addEventListener('pointermove', movePreviewPan);
      previewFrameEl.addEventListener('pointerup', endPreviewPan);
      previewFrameEl.addEventListener('pointercancel', endPreviewPan);
      previewFrameEl.addEventListener('auxclick', preventMiddleClick);
      return () => {
        previewFrameEl.removeEventListener('wheel', zoomPreview);
        previewFrameEl.removeEventListener('pointerdown', beginPreviewPan);
        previewFrameEl.removeEventListener('pointermove', movePreviewPan);
        previewFrameEl.removeEventListener('pointerup', endPreviewPan);
        previewFrameEl.removeEventListener('pointercancel', endPreviewPan);
        previewFrameEl.removeEventListener('auxclick', preventMiddleClick);
      };
    }

    function setupPaneResizer() {
      if (!layoutEl || !listPanelEl || !paneResizerEl) return () => {};
      const storageKey = `pce-image-manager.${kind}.listWidth.v1`;
      const resizerWidth = 6;
      const minListWidth = 280;
      const minDetailWidth = 300;

      function clampListWidth(width) {
        const total = layoutEl.getBoundingClientRect().width || 0;
        const maxWidth = total > 0
          ? Math.max(minListWidth, total - minDetailWidth - resizerWidth)
          : Math.max(minListWidth, Number(width) || minListWidth);
        return Math.max(minListWidth, Math.min(maxWidth, Number(width) || minListWidth));
      }

      function applyListWidth(width, persist = false) {
        const nextWidth = clampListWidth(width);
        layoutEl.style.gridTemplateColumns = `${nextWidth}px ${resizerWidth}px minmax(${minDetailWidth}px, 1fr)`;
        if (persist) {
          try {
            window.localStorage?.setItem(storageKey, String(Math.round(nextWidth)));
          } catch (_err) {
            // localStorage may be unavailable in tests or hardened runtimes.
          }
        }
      }

      try {
        const saved = Number(window.localStorage?.getItem(storageKey));
        if (Number.isFinite(saved) && saved > 0) {
          window.requestAnimationFrame(() => applyListWidth(saved));
        }
      } catch (_err) {
        // ignore storage read errors
      }

      let resizeState = null;
      const move = (event) => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        event.preventDefault();
        applyListWidth(resizeState.startWidth + (event.clientX - resizeState.startX));
      };
      const finish = (event) => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        event.preventDefault();
        applyListWidth(resizeState.startWidth + (event.clientX - resizeState.startX), true);
        resizeState = null;
        paneResizerEl.classList.remove('is-dragging');
        paneResizerEl.releasePointerCapture?.(event.pointerId);
      };
      const begin = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        resizeState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: listPanelEl.getBoundingClientRect().width,
        };
        paneResizerEl.classList.add('is-dragging');
        paneResizerEl.setPointerCapture?.(event.pointerId);
      };

      paneResizerEl.addEventListener('pointerdown', begin);
      paneResizerEl.addEventListener('pointermove', move);
      paneResizerEl.addEventListener('pointerup', finish);
      paneResizerEl.addEventListener('pointercancel', finish);
      return () => {
        paneResizerEl.removeEventListener('pointerdown', begin);
        paneResizerEl.removeEventListener('pointermove', move);
        paneResizerEl.removeEventListener('pointerup', finish);
        paneResizerEl.removeEventListener('pointercancel', finish);
      };
    }

    function managedAssets() {
      return assets
        .map((asset, index) => ({ asset, index }))
        .filter((entry) => kind === 'sprite'
          ? imageKind(entry.asset) === 'sprite'
          : entry.asset.type === 'image' && imageKind(entry.asset) === 'background')
        .sort((a, b) => a.index - b.index || a.asset.id.localeCompare(b.asset.id, 'ja'))
        .map((entry) => entry.asset);
    }

    function imageSortValue(asset, key, index = 0) {
      const generated = generatedInfo(asset);
      const options = asset.options || {};
      const width = options.width || generated.width || 0;
      const height = options.height || generated.height || 0;
      switch (key) {
        case 'id': return asset.id || '';
        case 'size': return [width, height];
        case 'tiles': return generated.tileCount || 0;
        case 'source': return asset.source || '';
        case 'order': return index;
        case 'name':
        default:
          return assetFullName(asset);
      }
    }

    function sortedManagedAssets() {
      const direction = sortState.direction === 'desc' ? -1 : 1;
      return managedAssets()
        .map((asset, index) => ({ asset, index }))
        .sort((left, right) => {
          const primary = compareSortValues(
            imageSortValue(left.asset, sortState.key, left.index),
            imageSortValue(right.asset, sortState.key, right.index),
          );
          if (primary) return primary * direction;
          return left.index - right.index || compareText(left.asset.id, right.asset.id);
        })
        .map((entry) => entry.asset);
    }

    function updateSortHeaders() {
      root.querySelectorAll('[data-sort-key]').forEach((button) => {
        const active = button.dataset.sortKey === sortState.key;
        button.dataset.sortDirection = active ? sortState.direction : '';
        button.setAttribute('aria-sort', active ? (sortState.direction === 'desc' ? 'descending' : 'ascending') : 'none');
        const indicator = button.querySelector('[data-sort-indicator]');
        if (indicator) indicator.textContent = active ? (sortState.direction === 'desc' ? '▼' : '▲') : '↕';
      });
    }

    function renderGroupedRows(list, colSpan, rowRenderer) {
      let previousGroup = [];
      return list.map((asset) => {
        const group = assetGroupParts(asset);
        let shared = 0;
        while (shared < previousGroup.length && shared < group.length && previousGroup[shared] === group[shared]) {
          shared += 1;
        }
        let html = '';
        for (let depth = shared; depth < group.length; depth += 1) {
          const path = group.slice(0, depth + 1).join(' / ');
          html += `
            <tr class="pce-image-manager-group-row">
              <td colspan="${colSpan}" style="--asset-group-indent:${depth * 14}px">
                <span>${esc(group[depth])}</span>
                <code>${esc(path)}</code>
              </td>
            </tr>
          `;
        }
        previousGroup = group;
        return html + rowRenderer(asset);
      });
    }

    function selectedAsset() {
      return managedAssets().find((asset) => asset.id === selectedId) || null;
    }

    function stopSpritePlayback() {
      spritePreviewState.playing = false;
      if (spritePreviewState.timer) window.clearTimeout(spritePreviewState.timer);
      spritePreviewState.timer = 0;
      syncSpritePlaybackButton();
    }

    function clearPreview() {
      previewLoadToken += 1;
      stopSpritePlayback();
      resetPreviewViewport();
      previewEl.removeAttribute('src');
      previewEl.hidden = true;
      spritePreviewEl.hidden = true;
      spritePreviewState.image = null;
      spritePreviewState.assetId = '';
      spritePreviewState.frameIndex = 0;
      noPreviewEl.hidden = false;
    }

    function collectAnimationRows() {
      if (kind !== 'sprite' || !animationEditorEl || animationEditorEl.hidden) return [];
      return Array.from(animationEditorEl.querySelectorAll('[data-animation-row]')).map((row, index) => {
        const field = (name) => row.querySelector(`[data-animation-field="${name}"]`);
        const id = safeId(field('id')?.value, index === 0 ? 'default' : `anim_${index + 1}`).slice(0, 32);
        return {
          id,
          name: String(field('name')?.value || id).trim(),
          frameWidth: asNumber(field('frameWidth')?.value, 16),
          frameHeight: asNumber(field('frameHeight')?.value, 16),
          firstCell: asNumber(field('firstCell')?.value, 0),
          frameCount: asNumber(field('frameCount')?.value, 1),
          frameDelay: asNumber(field('frameDelay')?.value, 8),
          frameStrideCells: asNumber(field('frameStrideCells')?.value, 1),
          loop: Boolean(field('loop')?.checked),
        };
      });
    }

    function draftAssetForAnimation() {
      const current = selectedAsset();
      if (!current || kind !== 'sprite') return current;
      const [cellWidth, cellHeight] = String(formEl.elements.cellSize?.value || `${current.options?.cellWidth || 16}x${current.options?.cellHeight || 16}`)
        .split('x')
        .map((value) => asNumber(value, 16));
      const generated = generatedInfo(current);
      return {
        ...current,
        options: {
          ...(current.options || {}),
          width: current.options?.width || generated.width || defaultWidth,
          height: current.options?.height || generated.height || defaultHeight,
          cellWidth,
          cellHeight,
          animations: collectAnimationRows(),
        },
      };
    }

    function selectedPreviewAnimation(asset = draftAssetForAnimation()) {
      const rawAnimations = collectAnimationRows();
      const animations = rawAnimations.length ? rawAnimations : spriteAnimationsForAsset(asset || {});
      const index = clampInt(spritePreviewState.animationIndex, 0, Math.max(0, animations.length - 1), 0);
      spritePreviewState.animationIndex = index;
      return normalizeAnimationForPreview(animations[index], asset || {}, index);
    }

    function syncAnimationSelection() {
      if (!animationEditorEl || animationEditorEl.hidden) return;
      const rows = Array.from(animationEditorEl.querySelectorAll('[data-animation-row]'));
      const selectedIndex = clampInt(spritePreviewState.animationIndex, 0, Math.max(0, rows.length - 1), 0);
      rows.forEach((row, index) => row.classList.toggle('is-selected', index === selectedIndex));
      const select = animationEditorEl.querySelector('[data-animation-select]');
      if (select) select.value = String(selectedIndex);
      const status = animationEditorEl.querySelector('[data-animation-status]');
      const animation = selectedPreviewAnimation();
      if (status) {
        status.textContent = `${spritePreviewState.frameIndex + 1}/${animation.frameCount} frames / ${animation.frameDelay}f`;
      }
      syncSpritePlaybackButton();
    }

    function syncSpritePlaybackButton() {
      const button = animationEditorEl?.querySelector?.('[data-animation-play]');
      if (button) {
        button.textContent = spritePreviewState.playing ? '⏸' : '▶';
        button.setAttribute('aria-pressed', String(spritePreviewState.playing));
      }
    }

    function drawSpritePreviewFrame() {
      if (kind !== 'sprite' || !spritePreviewState.image || spritePreviewEl.hidden) return;
      const asset = draftAssetForAnimation();
      const animation = selectedPreviewAnimation(asset);
      spritePreviewState.frameIndex = clampInt(spritePreviewState.frameIndex, 0, Math.max(0, animation.frameCount - 1), 0);
      const frame = spriteFrameRect(animation, asset || {}, spritePreviewState.image, spritePreviewState.frameIndex);
      const availableWidth = Math.max(1, (previewFrameEl?.clientWidth || 320) - 24);
      const availableHeight = Math.max(1, (previewFrameEl?.clientHeight || 220) - 24);
      const scale = Math.max(1, Math.min(6, Math.floor(Math.min(availableWidth / frame.width, availableHeight / frame.height)) || 1));
      spritePreviewEl.width = Math.max(1, frame.width * scale);
      spritePreviewEl.height = Math.max(1, frame.height * scale);
      const ctx = spritePreviewEl.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, spritePreviewEl.width, spritePreviewEl.height);
      ctx.drawImage(
        spritePreviewState.image,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        spritePreviewEl.width,
        spritePreviewEl.height,
      );
      applyPreviewViewport();
      syncAnimationSelection();
    }

    function scheduleSpritePlayback() {
      if (!spritePreviewState.playing) return;
      const animation = selectedPreviewAnimation();
      const frameDelay = Array.isArray(animation.frameDelays)
        ? animation.frameDelays[clampInt(spritePreviewState.frameIndex, 0, Math.max(0, animation.frameCount - 1), 0)]
        : animation.frameDelay;
      const delayMs = Math.max(1, frameDelay || animation.frameDelay) * (1000 / 60);
      spritePreviewState.timer = window.setTimeout(() => {
        const lastFrame = Math.max(0, animation.frameCount - 1);
        if (spritePreviewState.frameIndex >= lastFrame) {
          if (!animation.loop) {
            stopSpritePlayback();
            return;
          }
          spritePreviewState.frameIndex = 0;
        } else {
          spritePreviewState.frameIndex += 1;
        }
        drawSpritePreviewFrame();
        scheduleSpritePlayback();
      }, delayMs);
    }

    async function startSpritePlayback() {
      if (kind !== 'sprite') return;
      if (!spritePreviewState.image) await loadPreview();
      if (!spritePreviewState.image || spritePreviewState.playing) return;
      spritePreviewState.playing = true;
      syncSpritePlaybackButton();
      scheduleSpritePlayback();
    }

    function toggleSpritePlayback() {
      if (spritePreviewState.playing) {
        stopSpritePlayback();
      } else {
        void startSpritePlayback();
      }
    }

    async function loadPreview(asset = selectedAsset()) {
      clearPreview();
      if (!asset?.source) return;
      const token = previewLoadToken;
      const result = await previewPceAssetSource(asset.source);
      if (token !== previewLoadToken) return;
      if (!result?.ok || !result.dataUrl) {
        formErrorEl.textContent = result?.error || 'プレビューを取得できませんでした';
        return;
      }
      if (kind === 'sprite' || imageKind(asset) === 'sprite') {
        try {
          const image = await loadImageFromDataUrl(result.dataUrl);
          if (token !== previewLoadToken) return;
          spritePreviewState.image = image;
          spritePreviewState.assetId = asset.id || '';
          spritePreviewState.frameIndex = 0;
          previewEl.hidden = true;
          spritePreviewEl.hidden = false;
          noPreviewEl.hidden = true;
          drawSpritePreviewFrame();
          return;
        } catch (err) {
          formErrorEl.textContent = err.message || String(err);
          return;
        }
      }
      previewEl.src = result.dataUrl;
      previewEl.hidden = false;
      spritePreviewEl.hidden = true;
      noPreviewEl.hidden = true;
      applyPreviewViewport();
    }

    function renderGenerated(asset) {
      const generated = generatedInfo(asset);
      const warnings = [...(generated.warnings || []), asset?.pathError].filter(Boolean);
      statsEl.innerHTML = `
        <div><span>${kind === 'sprite' ? 'Pattern' : 'Tile'}</span><strong>${esc(generated.tileCount || 0)}</strong></div>
        <div><span>Palette</span><strong>${esc(generated.paletteCount || 0)}</strong></div>
        <div><span>VRAM bytes</span><strong>${esc(generated.vramBytes || 0)}</strong></div>
      `;
      const colors = Array.isArray(generated.paletteColors) ? generated.paletteColors : [];
      paletteEl.innerHTML = colors.length
        ? colors.slice(0, 64).map((color, index) => `<span class="palette-swatch ${index % 16 === 0 ? 'is-transparent' : ''}" style="background:${esc(color)}" title="${index}: ${esc(color)}"></span>`).join('')
        : Array.from({ length: 16 }, (_unused, index) => `<span class="palette-swatch is-empty ${index === 0 ? 'is-transparent' : ''}" title="${index}"></span>`).join('');
      const files = [
        ['palette', generated.paletteFile],
        [kind === 'sprite' ? 'patterns' : 'tiles', generated.tilesFile],
        [kind === 'sprite' ? 'patterns.rle' : 'tiles.rle', generated.tilesCompressedFile],
        ['map', kind === 'sprite' ? '' : generated.mapFile],
        ['map.rle', kind === 'sprite' ? '' : generated.mapVramCompressedFile],
        ['preview', generated.previewFile],
        ['source', asset?.source],
      ].filter((entry) => entry[1]);
      filesEl.innerHTML = files.length
        ? files.map(([label, file]) => `<div><span>${esc(label)}</span><code>${esc(file)}</code></div>`).join('')
        : '<p class="asset-no-selection-hint">まだ変換結果がありません</p>';
      diagnosticsEl.innerHTML = warnings.length
        ? warnings.map((warning) => `<div class="asset-warning">${esc(warning)}</div>`).join('')
        : '<p class="pce-image-manager-muted">警告はありません</p>';
    }

    function animationRowHtml(animation = {}, index = 0, asset = selectedAsset()) {
      const item = normalizeAnimationForPreview(animation, asset || {}, index);
      return `
        <section class="pce-image-manager-animation-row ${index === spritePreviewState.animationIndex ? 'is-selected' : ''}" data-animation-row>
          <div class="pce-image-manager-animation-head">
            <button class="btn-sm" type="button" data-animation-pick="${index}">Pattern ${index + 1}</button>
            <button class="icon-btn-xs" type="button" data-animation-delete title="アニメーション削除" aria-label="アニメーション削除">✕</button>
          </div>
          <div class="pce-image-manager-animation-grid">
            <label class="form-group">
              <span class="form-label">ID</span>
              <input class="form-input form-input-mono" data-animation-field="id" value="${esc(item.id)}" />
            </label>
            <label class="form-group">
              <span class="form-label">Name</span>
              <input class="form-input" data-animation-field="name" value="${esc(item.name)}" />
            </label>
            <label class="form-group">
              <span class="form-label">Frame W</span>
              <input class="form-input" data-animation-field="frameWidth" type="number" min="16" max="256" step="16" value="${esc(item.frameWidth)}" />
            </label>
            <label class="form-group">
              <span class="form-label">Frame H</span>
              <input class="form-input" data-animation-field="frameHeight" type="number" min="16" max="256" step="16" value="${esc(item.frameHeight)}" />
            </label>
            <label class="form-group">
              <span class="form-label">First cell</span>
              <input class="form-input" data-animation-field="firstCell" type="number" min="0" max="255" value="${esc(item.firstCell)}" />
            </label>
            <label class="form-group">
              <span class="form-label">Frames</span>
              <input class="form-input" data-animation-field="frameCount" type="number" min="1" max="64" value="${esc(item.frameCount)}" />
            </label>
            <label class="form-group">
              <span class="form-label">Speed</span>
              <input class="form-input" data-animation-field="frameDelay" type="number" min="1" max="60" value="${esc(item.frameDelay)}" />
            </label>
            <label class="form-group">
              <span class="form-label">Stride</span>
              <input class="form-input" data-animation-field="frameStrideCells" type="number" min="1" max="255" value="${esc(item.frameStrideCells)}" />
            </label>
            <label class="pce-image-manager-check">
              <input data-animation-field="loop" type="checkbox" ${item.loop !== false ? 'checked' : ''} />
              <span>Loop</span>
            </label>
          </div>
        </section>
      `;
    }

    function renderAnimationEditor(asset) {
      if (!animationEditorEl) return;
      const isSprite = kind === 'sprite' && (asset?.type === 'sprite' || asset?.options?.kind === 'sprite');
      animationEditorEl.hidden = !isSprite;
      stopSpritePlayback();
      if (!isSprite) {
        animationEditorEl.innerHTML = '';
        return;
      }
      const animations = spriteAnimationsForAsset(asset);
      spritePreviewState.animationIndex = clampInt(spritePreviewState.animationIndex, 0, Math.max(0, animations.length - 1), 0);
      animationEditorEl.innerHTML = `
        <div class="pce-image-manager-animation-title">
          <span>Animation pattern</span>
          <span class="pce-image-manager-animation-status" data-animation-status></span>
        </div>
        <div class="pce-image-manager-animation-toolbar">
          <select class="form-select" data-animation-select aria-label="Animation pattern">
            ${animations.map((animation, index) => `<option value="${index}">${esc(animation.name || animation.id || `Pattern ${index + 1}`)}</option>`).join('')}
          </select>
          <button class="icon-btn-xs" type="button" data-animation-step="-1" title="前フレーム" aria-label="前フレーム">⏮</button>
          <button class="icon-btn-xs" type="button" data-animation-play title="再生" aria-label="再生">▶</button>
          <button class="icon-btn-xs" type="button" data-animation-step="1" title="次フレーム" aria-label="次フレーム">⏭</button>
          <button class="btn-sm" type="button" data-animation-add>追加</button>
        </div>
        ${animations.map((animation, index) => animationRowHtml(animation, index, asset)).join('')}
      `;
      syncAnimationSelection();
    }

    function fillForm(asset, options = {}) {
      formErrorEl.textContent = '';
      clearPreview();
      emptyDetailEl.hidden = Boolean(asset);
      formEl.hidden = !asset;
      if (!asset) {
        titleEl.textContent = title;
        sourceEl.textContent = '';
        statsEl.innerHTML = '';
        paletteEl.innerHTML = '';
        filesEl.innerHTML = '';
        diagnosticsEl.innerHTML = '';
        renderAnimationEditor(null);
        return;
      }
      const assetOptions = asset.options || {};
      const generated = generatedInfo(asset);
      titleEl.textContent = asset.name || asset.id;
      sourceEl.textContent = asset.source || '';
      formEl.elements.id.value = asset.id || '';
      formEl.elements.name.value = asset.name || asset.id || '';
      if (kind === 'sprite') {
        formEl.elements.tileBase.value = assetOptions.tileBase ?? defaultTileBase;
        formEl.elements.x.value = assetOptions.x ?? 144;
        formEl.elements.y.value = assetOptions.y ?? 104;
        formEl.elements.cellSize.value = `${assetOptions.cellWidth || 16}x${assetOptions.cellHeight || 16}`;
      } else {
        formEl.elements.tileBase.value = PCE_BG_AUTO_TILE_BASE;
        formEl.elements.mapBase.value = PCE_BG_AUTO_MAP_BASE;
      }
      renderAnimationEditor(asset);
      renderGenerated(asset);
      if (options.preview !== false) void loadPreview(asset);
    }

    function selectAsset(id, options = {}) {
      selectedId = id || '';
      renderRows();
      fillForm(selectedAsset(), options);
    }

    function renderRows() {
      const list = sortedManagedAssets();
      summaryEl.textContent = `${list.length} ${summaryLabel}`;
      updateSortHeaders();
      if (!list.length) {
        rowsEl.innerHTML = '<tr><td colspan="7" class="pce-image-manager-empty">アセットがありません</td></tr>';
        return;
      }
      rowsEl.innerHTML = renderGroupedRows(list, 6, (asset) => {
        const generated = generatedInfo(asset);
        const warnings = [...(generated.warnings || []), asset.pathError].filter(Boolean);
        return `
          <tr class="pce-image-manager-row ${asset.id === selectedId ? 'active' : ''}" data-id="${esc(asset.id)}">
            <td class="pce-image-manager-name-cell"><span>${esc(assetDisplayName(asset))}</span></td>
            <td class="pce-image-manager-id-cell"><code>${esc(asset.id)}</code></td>
            <td>${esc(formatSize(asset))}</td>
            <td>${esc(generated.tileCount || 0)}</td>
            <td><code>${esc(asset.source || '')}</code>${warnings.length ? `<div class="asset-warning">${warnings.length}</div>` : ''}</td>
            <td class="pce-image-manager-row-actions">
              <button class="icon-btn-xs" type="button" data-row-delete="${esc(asset.id)}" title="削除" aria-label="削除">✕</button>
            </td>
          </tr>
        `;
      }).join('');
      rowsEl.querySelectorAll('.pce-image-manager-row').forEach((row) => {
        row.addEventListener('click', (event) => {
          if (event.target?.closest?.('button')) return;
          selectAsset(row.dataset.id || '');
        });
      });
      rowsEl.querySelectorAll('[data-row-delete]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          void deleteAsset(button.dataset.rowDelete || '');
        });
      });
    }

    async function reload(options = {}) {
      const result = await listPceAssets({ force: Boolean(options.force) });
      if (!result?.ok) {
        rowsEl.innerHTML = `<tr><td colspan="7" class="pce-image-manager-empty">${esc(result?.error || 'PCE assets を読み込めません')}</td></tr>`;
        return;
      }
      assets = result.assets || [];
      const list = managedAssets();
      if (selectedId && !list.some((asset) => asset.id === selectedId)) selectedId = '';
      if (!selectedId && list.length) selectedId = list[0].id;
      renderRows();
      fillForm(selectedAsset(), { preview: options.preview !== false });
    }

    function isPluginPageActive() {
      const page = root.closest?.('.editor-page');
      return page ? page.classList.contains('active') : !root.hidden;
    }

    function setupAssetRefreshEvents() {
      let queued = false;
      const queueReload = () => {
        if (queued) return;
        queued = true;
        window.setTimeout(() => {
          queued = false;
          if (isPluginPageActive()) void reload({ force: true });
        }, 0);
      };
      const offChanged = api.events?.on?.('assets:pce:changed', queueReload) || (() => {});
      const offActivated = api.events?.on?.('page:activated', () => {
        if (isPluginPageActive()) queueReload();
      }) || (() => {});
      return () => {
        offChanged();
        offActivated();
      };
    }

    function collectFormAsset() {
      const current = selectedAsset();
      if (!current) return null;
      const [cellWidth, cellHeight] = kind === 'sprite'
        ? String(formEl.elements.cellSize.value || '16x16').split('x').map((value) => asNumber(value, 16))
        : [8, 8];
      const id = safeId(formEl.elements.id.value, current.id || fallbackId);
      return {
        ...current,
        id,
        type: assetType,
        name: String(formEl.elements.name.value || id).trim(),
        options: {
          ...(current.options || {}),
          kind,
          tileBase: kind === 'sprite' ? clampInt(formEl.elements.tileBase.value, 0, 2047, defaultTileBase) : PCE_BG_AUTO_TILE_BASE,
          mapBase: PCE_BG_AUTO_MAP_BASE,
          x: kind === 'sprite' ? clampInt(formEl.elements.x.value, 0, 255, 144) : 0,
          y: kind === 'sprite' ? clampInt(formEl.elements.y.value, 0, 255, 104) : 0,
          cellWidth,
          cellHeight,
          ...(kind === 'sprite' ? { animations: collectAnimationRows() } : {}),
        },
      };
    }

    async function saveSelected(event) {
      event.preventDefault();
      const current = selectedAsset();
      const asset = collectFormAsset();
      if (!current || !asset) return;
      formErrorEl.textContent = '';
      if (asset.id !== current.id && assets.some((entry) => entry.id === asset.id)) {
        formErrorEl.textContent = '同じ ID のアセットが既にあります';
        return;
      }
      const result = await upsertPceAsset(asset);
      if (!result?.ok) {
        formErrorEl.textContent = result?.error || '保存できませんでした';
        return;
      }
      assets = result.assets || assets;
      if (asset.id !== current.id) {
        const deleted = await deletePceAsset(current.id);
        if (!deleted?.ok) {
          formErrorEl.textContent = deleted?.error || '旧 ID の削除に失敗しました';
          return;
        }
        assets = deleted.assets || assets;
      }
      selectedId = asset.id;
      setStatus('保存しました', 'ok');
      await reload();
    }

    function askDelete(assetId) {
      return new Promise((resolve) => {
        const modal = api.createModal({
          id: `${plugin.id}-delete-${Date.now()}`,
          panelClassName: 'app-panel app-panel-sm',
          html: `
            <div class="page-header modal-header">
              <h2>アセット削除</h2>
              <button class="icon-btn" type="button" data-decision="cancel">✕</button>
            </div>
            <div class="settings-form compact-form pce-image-manager-delete-modal">
              <p><code>${esc(assetId)}</code> を削除します。</p>
              <div class="form-actions-inline modal-actions-end">
                <button class="btn-sm" type="button" data-decision="cancel">キャンセル</button>
                <button class="btn-primary" type="button" data-decision="delete">削除</button>
              </div>
            </div>
          `,
        });
        modal.panel.querySelectorAll('[data-decision]').forEach((button) => {
          button.addEventListener('click', () => {
            const decision = button.dataset.decision;
            modal.close();
            modal.destroy?.();
            resolve(decision === 'delete');
          }, { once: true });
        });
        modal.open();
      });
    }

    async function deleteAsset(assetId = selectedId) {
      if (!assetId || !(await askDelete(assetId))) return;
      try {
        const before = managedAssets();
        const oldIndex = Math.max(0, before.findIndex((asset) => asset.id === assetId));
        const result = await deletePceAsset(assetId);
        if (!result?.ok) throw new Error(result?.error || '削除できませんでした');
        assets = result.assets || assets;
        const after = managedAssets();
        selectedId = after[Math.min(oldIndex, after.length - 1)]?.id || '';
        setStatus('削除しました', 'ok');
        renderRows();
        fillForm(selectedAsset(), { preview: false });
      } catch (err) {
        setStatus(err.message || String(err), 'error');
      }
    }

    async function pickImageFile() {
      const picked = await api.electronAPI.pickFile({
        properties: ['openFile'],
        filters: [{ name: 'PNG / BMP / WebP', extensions: ['png', 'bmp', 'webp'] }],
      });
      const sourcePath = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
      if (picked?.canceled || !sourcePath) return null;
      const fileName = sourceBasename(sourcePath);
      const ext = extname(fileName || sourcePath);
      if (!IMAGE_EXTS.includes(ext)) {
        setStatus('PNG / BMP / WebP を選択してください', 'error');
        return null;
      }
      const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
      if (!read?.ok || !read.dataUrl) {
        setStatus(read?.error || '画像を読み込めません', 'error');
        return null;
      }
      return { sourcePath, fileName, ext, sourceDataUrl: read.dataUrl };
    }

    function openImportSettingsModal(picked) {
      return new Promise((resolve) => {
        const baseName = sourceBasename(picked.fileName || picked.sourcePath).replace(/\.[^.]+$/, '');
        const defaultId = safeId(baseName, fallbackId);
        const modal = api.createModal({
          id: `${plugin.id}-import-${Date.now()}`,
          panelClassName: 'app-panel pce-image-manager-import-panel',
          html: `
            <div class="page-header modal-header">
              <h2>${esc(importTitle)}</h2>
              <button class="icon-btn" type="button" data-import-cancel>✕</button>
            </div>
            <form class="settings-form compact-form pce-image-manager-import-form">
              <code class="pce-image-manager-picked-file">${esc(picked.sourcePath)}</code>
              <div class="image-preview-frame pce-image-manager-import-preview">
                <img data-import-preview alt="Import preview" />
              </div>
              <div class="pce-image-manager-form-grid">
                <label class="form-group">
                  <span class="form-label">ID</span>
                  <input class="form-input form-input-mono" name="id" value="${esc(defaultId)}" />
                </label>
                <label class="form-group">
                  <span class="form-label">Name</span>
                  <input class="form-input" name="name" value="${esc(baseName)}" />
                </label>
                ${kind === 'sprite' ? `
                  <label class="form-group">
                    <span class="form-label">Cell size</span>
                    <select class="form-select" name="cellSize">
                      ${SPRITE_CELL_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
                    </select>
                  </label>
                ` : ''}
                ${kind === 'sprite' ? '' : `
                  <input name="tileBase" type="hidden" value="${PCE_BG_AUTO_TILE_BASE}" />
                  <input name="mapBase" type="hidden" value="${PCE_BG_AUTO_MAP_BASE}" />
                `}
                <label class="form-group">
                  <span class="form-label">Output width</span>
                  <input class="form-input" name="outputWidth" type="number" min="8" max="1024" step="8" value="${defaultWidth}" />
                </label>
                <label class="form-group">
                  <span class="form-label">Output height</span>
                  <input class="form-input" name="outputHeight" type="number" min="8" max="1024" step="8" value="${defaultHeight}" />
                </label>
              </div>
              <div class="form-error" data-import-error></div>
              <div class="form-actions-inline modal-actions-end">
                <button class="btn-sm" type="button" data-import-cancel>キャンセル</button>
                <button class="btn-primary" type="submit">変換して保存</button>
              </div>
            </form>
          `,
        });
        const form = modal.panel.querySelector('form');
        const error = modal.panel.querySelector('[data-import-error]');
        const importPreview = modal.panel.querySelector('[data-import-preview]');
        if (importPreview) importPreview.src = picked.sourceDataUrl;
        modal.panel.querySelectorAll('[data-import-cancel]').forEach((button) => {
          button.addEventListener('click', () => {
            modal.close();
            modal.destroy?.();
            resolve(null);
          }, { once: true });
        });
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const id = safeId(form.elements.id.value, defaultId);
          if (assets.some((asset) => asset.id === id)) {
            error.textContent = '同じ ID のアセットが既にあります';
            return;
          }
          const outputWidth = clampInt(form.elements.outputWidth.value, 8, 1024, defaultWidth);
          const outputHeight = clampInt(form.elements.outputHeight.value, 8, 1024, defaultHeight);
          const [cellWidth, cellHeight] = kind === 'sprite'
            ? String(form.elements.cellSize.value || '16x16').split('x').map((value) => asNumber(value, 16))
            : [8, 8];
          const animFrameWidth = kind === 'sprite' ? DEFAULT_IMPORT_FRAME_WIDTH : 0;
          const animFrameHeight = kind === 'sprite' ? DEFAULT_IMPORT_FRAME_HEIGHT : 0;
          const animFrameCells = kind === 'sprite'
            ? Math.max(1, Math.ceil(animFrameWidth / cellWidth) * Math.ceil(animFrameHeight / cellHeight))
            : 1;
          modal.close();
          modal.destroy?.();
          resolve({
            id,
            name: String(form.elements.name.value || id).trim(),
            paletteBank: kind === 'sprite' ? DEFAULT_SPRITE_PALETTE_BANK : 0,
            tileBase: kind === 'sprite' ? DEFAULT_SPRITE_TILE_BASE : PCE_BG_AUTO_TILE_BASE,
            mapBase: PCE_BG_AUTO_MAP_BASE,
            x: kind === 'sprite' ? DEFAULT_SPRITE_X : 0,
            y: kind === 'sprite' ? DEFAULT_SPRITE_Y : 0,
            cellWidth,
            cellHeight,
            outputWidth,
            outputHeight,
            transparentIndex: kind === 'sprite' ? DEFAULT_SPRITE_TRANSPARENT_INDEX : 0,
            animations: kind === 'sprite' ? [{
              id: 'default',
              name: 'Default',
              frameWidth: animFrameWidth,
              frameHeight: animFrameHeight,
              firstCell: 0,
              frameCount: DEFAULT_IMPORT_FRAME_COUNT,
              frameDelay: DEFAULT_IMPORT_FRAME_DELAY,
              frameStrideCells: animFrameCells,
              loop: true,
            }] : [],
          });
        });
        modal.open();
      });
    }

    async function importImageAsset() {
      if (importBusy) return null;
      importBusy = true;
      setStatus('');
      try {
        const picked = await pickImageFile();
        if (!picked) return null;
        const details = await openImportSettingsModal(picked);
        if (!details) return null;
        const pipeline = getImagePipeline(api);
        if (!pipeline?.convertToIndexed16) {
          throw new Error('画像コンバータープラグインが無効または未インストールです');
        }
        const converted = await pipeline.convertToIndexed16({
          sourcePath: picked.sourcePath,
          sourceDataUrl: picked.sourceDataUrl,
          targetSize: { width: details.outputWidth, height: details.outputHeight },
        });
        if (converted?.canceled) {
          setStatus(converted.warning || '画像取り込みをキャンセルしました', 'error');
          return null;
        }
        const finalWidth = asNumber(converted.width, details.outputWidth);
        const finalHeight = asNumber(converted.height, details.outputHeight);
        if (kind === 'sprite' && (finalWidth % 16 !== 0 || finalHeight % 16 !== 0)) {
          throw new Error('Sprite sheet の出力サイズは16px単位にしてください');
        }
        if (kind !== 'sprite' && (finalWidth % 8 !== 0 || finalHeight % 8 !== 0)) {
          throw new Error('BG image の出力サイズは8px単位にしてください');
        }
        const result = await importPceImage({
          sourcePath: picked.sourcePath,
          sourceFileName: picked.fileName,
          convertedDataUrl: converted.convertedDataUrl || '',
          kind,
          id: details.id,
          name: details.name,
          paletteBank: details.paletteBank,
          tileBase: details.tileBase,
          mapBase: details.mapBase,
          x: details.x,
          y: details.y,
          cellWidth: details.cellWidth,
          cellHeight: details.cellHeight,
          transparentIndex: details.transparentIndex,
          width: finalWidth,
          height: finalHeight,
          options: kind === 'sprite' ? { animations: details.animations || [] } : {},
        });
        if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
        assets = result.assets || assets;
        selectedId = result.asset?.id || details.id;
        setStatus('追加しました', 'ok');
        logger.info(`PCE ${kind} imported: ${selectedId}${converted.warning ? ` (${converted.warning})` : ''}`);
        renderRows();
        fillForm(selectedAsset(), { preview: true });
        await reload();
        return result.asset || null;
      } catch (err) {
        const message = err.message || String(err);
        logger.error(`PCE ${kind} import failed: ${message}`);
        setStatus(message, 'error');
        return null;
      } finally {
        importBusy = false;
      }
    }

    animationEditorEl?.addEventListener('click', (event) => {
      const pick = event.target?.closest?.('[data-animation-pick]');
      if (pick) {
        spritePreviewState.animationIndex = clampInt(pick.dataset.animationPick, 0, Math.max(0, collectAnimationRows().length - 1), 0);
        spritePreviewState.frameIndex = 0;
        drawSpritePreviewFrame();
        return;
      }
      const add = event.target?.closest?.('[data-animation-add]');
      if (add) {
        const rows = collectAnimationRows();
        rows.push({
          ...spriteAnimationDefaults(draftAssetForAnimation() || selectedAsset() || {}, 'cells'),
          id: `anim_${rows.length + 1}`,
          name: `Animation ${rows.length + 1}`,
        });
        const draft = draftAssetForAnimation() || selectedAsset();
        renderAnimationEditor({ ...draft, options: { ...(draft?.options || {}), animations: rows } });
        spritePreviewState.animationIndex = rows.length - 1;
        drawSpritePreviewFrame();
        return;
      }
      const del = event.target?.closest?.('[data-animation-delete]');
      if (del) {
        const rows = collectAnimationRows();
        const row = del.closest('[data-animation-row]');
        const index = Array.from(animationEditorEl.querySelectorAll('[data-animation-row]')).indexOf(row);
        if (rows.length <= 1) return;
        rows.splice(Math.max(0, index), 1);
        spritePreviewState.animationIndex = clampInt(spritePreviewState.animationIndex, 0, rows.length - 1, 0);
        const draft = draftAssetForAnimation() || selectedAsset();
        renderAnimationEditor({ ...draft, options: { ...(draft?.options || {}), animations: rows } });
        drawSpritePreviewFrame();
        return;
      }
      const step = event.target?.closest?.('[data-animation-step]');
      if (step) {
        const animation = selectedPreviewAnimation();
        const direction = clampInt(step.dataset.animationStep, -1, 1, 1);
        spritePreviewState.frameIndex = clampInt(
          spritePreviewState.frameIndex + direction,
          0,
          Math.max(0, animation.frameCount - 1),
          0,
        );
        drawSpritePreviewFrame();
        return;
      }
      if (event.target?.closest?.('[data-animation-play]')) {
        toggleSpritePlayback();
      }
    });
    animationEditorEl?.addEventListener('change', (event) => {
      const select = event.target?.closest?.('[data-animation-select]');
      if (select) {
        spritePreviewState.animationIndex = clampInt(select.value, 0, Math.max(0, collectAnimationRows().length - 1), 0);
        spritePreviewState.frameIndex = 0;
        drawSpritePreviewFrame();
        return;
      }
      if (event.target?.closest?.('[data-animation-field]')) {
        spritePreviewState.frameIndex = 0;
        drawSpritePreviewFrame();
      }
    });
    animationEditorEl?.addEventListener('input', (event) => {
      if (event.target?.closest?.('[data-animation-field]')) {
        stopSpritePlayback();
        drawSpritePreviewFrame();
      }
    });
    formEl.addEventListener('change', (event) => {
      if (kind === 'sprite' && event.target?.closest?.('[name="cellSize"]')) {
        stopSpritePlayback();
        drawSpritePreviewFrame();
      }
    });
    formEl.addEventListener('submit', saveSelected);
    root.querySelectorAll('[data-sort-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.sortKey || 'name';
        sortState = sortState.key === key
          ? { key, direction: sortState.direction === 'asc' ? 'desc' : 'asc' }
          : { key, direction: 'asc' };
        renderRows();
      });
    });
    root.querySelector('[data-action="add"]').addEventListener('click', () => { void importImageAsset(); });
    root.querySelector('[data-action="refresh"]').addEventListener('click', () => { void reload({ force: true }); });
    root.querySelector('[data-action="delete"]').addEventListener('click', () => { void deleteAsset(); });

    registerCapability(capabilityName, {
      pluginId: plugin.id,
      reload,
      importImageAsset,
    });
    const teardownAssetRefreshEvents = setupAssetRefreshEvents();
    const teardownPaneResizer = setupPaneResizer();
    const teardownInteractivePreview = setupInteractivePreview();
    void reload();
    return {
      deactivate() {
        teardownAssetRefreshEvents();
        teardownPaneResizer();
        teardownInteractivePreview();
        clearPreview();
      },
    };
  };
}
