import {
  SPRITE_CELL_SIZES,
  applyDefaultTimeToRow,
  asNumber,
  assetDisplayName,
  assetFullName,
  assetGroupParts,
  buildAnimationsFromEditorState,
  clampInt,
  compareText,
  computeFrameGrid,
  editorStateFromAsset,
  esc,
  extname,
  parseCellSize,
  parseSpriteTime,
  resizeSpriteTimeRow,
  safeId,
  serializeSpriteTime,
  sourceBasename,
  spriteSheetMetrics,
  updateSpriteTimeCell,
} from './sprite-editor-utils.mjs';

const IMAGE_EXTS = ['.png', '.bmp', '.webp'];
const DEFAULT_TILE_BASE = 384;
const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 128;
const STORAGE_KEY = 'pce.spriteEditor.layout.v1';

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = dataUrl;
  });
}

function getImagePipeline(api) {
  const capabilities = api.capabilities || {};
  const all = typeof capabilities.all === 'function' ? capabilities.all('image-import-pipeline') : [];
  const fallback = typeof capabilities.get === 'function' ? capabilities.get('image-import-pipeline') : null;
  return [...all, fallback].find((pipeline) => pipeline?.convertToIndexed16) || null;
}

function layoutDefaults() {
  try {
    const stored = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) || '{}');
    return {
      left: clampInt(stored.left, 220, 520, 270),
      right: clampInt(stored.right, 260, 520, 310),
      preview: clampInt(stored.preview, 180, 520, 290),
    };
  } catch (_err) {
    return { left: 270, right: 310, preview: 290 };
  }
}

function saveLayout(layout) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch (_err) {
    // localStorage can be disabled in tests or restricted environments.
  }
}

export async function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  const layout = layoutDefaults();
  root.innerHTML = `
    <div
      class="pce-sprite-editor-root"
      data-plugin-root="${esc(plugin.id)}"
      style="--sprite-left-width:${layout.left}px; --sprite-right-width:${layout.right}px; --sprite-preview-height:${layout.preview}px;"
    >
      <aside class="pce-sprite-editor-sidebar">
        <header class="pce-sprite-editor-panel-header">
          <div>
            <h2>SPRITE</h2>
            <span data-role="summary">-</span>
          </div>
          <button class="icon-btn" type="button" data-action="add" title="追加" aria-label="追加">＋</button>
        </header>
        <div class="pce-sprite-editor-filter">
          <label>
            <span>ソース ファイル</span>
            <select class="form-select" data-role="source-filter">
              <option value="">すべて</option>
            </select>
          </label>
          <label>
            <span>アセット名</span>
            <input class="form-input" data-role="keyword" placeholder="keyword" />
          </label>
        </div>
        <div class="pce-sprite-editor-list" data-role="asset-list"></div>
        <p class="pce-sprite-editor-status" data-role="status"></p>
      </aside>
      <div class="pce-sprite-editor-column-resizer" data-column-resizer="left" role="separator" aria-label="Resize asset list"></div>
      <main class="pce-sprite-editor-workbench">
        <section class="pce-sprite-editor-frame-panel">
          <header class="pce-sprite-editor-toolbar">
            <div>
              <h3>Frame Preview</h3>
            </div>
            <label class="pce-sprite-editor-mini-field">
              <span>倍率</span>
              <input class="form-input" type="number" min="1" max="16" value="4" data-role="frame-scale" />
            </label>
            <label class="pce-sprite-editor-grid-toggle" title="8x8 grid">
              <input type="checkbox" data-role="show-grid" checked />
              <span>8x8</span>
            </label>
            <button class="icon-btn" type="button" data-action="first-frame" title="先頭フレーム" aria-label="先頭フレーム">↤</button>
            <button class="icon-btn" type="button" data-action="play" title="再生" aria-label="再生">▶</button>
            <button class="icon-btn" type="button" data-action="last-frame" title="最後のフレーム" aria-label="最後のフレーム">↦</button>
            <button class="icon-btn active" type="button" data-action="loop" title="ループ" aria-label="ループ">↻</button>
            <label class="pce-sprite-editor-mini-field">
              <span>ROW</span>
              <input class="form-input" type="number" min="0" value="0" data-role="preview-row" />
            </label>
            <label class="pce-sprite-editor-mini-field">
              <span>Frame</span>
              <input class="form-input" type="number" min="0" value="0" data-role="preview-frame" />
            </label>
            <label class="pce-sprite-editor-time-field">
              <span>Time</span>
              <input class="form-input" type="number" min="0" max="60" value="4" data-role="preview-time" />
            </label>
          </header>
          <div class="pce-sprite-editor-preview-stage" data-role="preview-stage">
            <canvas data-role="preview-canvas"></canvas>
          </div>
        </section>
        <div class="pce-sprite-editor-row-resizer" data-row-resizer role="separator" aria-label="Resize preview"></div>
        <section class="pce-sprite-editor-sheet-panel">
          <header class="pce-sprite-editor-toolbar">
            <div>
              <h3>Sprite Sheet</h3>
              <span data-role="sheet-info">-</span>
            </div>
            <label class="pce-sprite-editor-mini-field">
              <span>倍率</span>
              <input class="form-input" type="number" min="1" max="16" value="4" data-role="sheet-scale" />
            </label>
            <label class="pce-sprite-editor-mini-field">
              <span>幅(px)</span>
              <input class="form-input" type="number" min="16" max="256" step="16" value="16" data-role="frame-width" />
            </label>
            <label class="pce-sprite-editor-mini-field">
              <span>高さ(px)</span>
              <input class="form-input" type="number" min="16" max="256" step="16" value="16" data-role="frame-height" />
            </label>
          </header>
          <div class="pce-sprite-editor-sheet-stage" data-role="sheet-stage">
            <canvas data-role="sheet-canvas"></canvas>
          </div>
        </section>
        <section class="pce-sprite-editor-animation-rows">
          <header class="pce-sprite-editor-animation-header">
            <strong>ANIMATION ROWS</strong>
            <span data-role="animation-summary">-</span>
          </header>
          <div class="pce-sprite-editor-animation-grid" data-role="animation-rows"></div>
        </section>
      </main>
      <div class="pce-sprite-editor-column-resizer" data-column-resizer="right" role="separator" aria-label="Resize properties"></div>
      <aside class="pce-sprite-editor-properties">
        <form class="settings-form compact-form" data-role="properties-form">
          <header class="pce-sprite-editor-panel-header">
            <div>
              <h2>Properties</h2>
              <span data-role="selected-source">-</span>
            </div>
          </header>
          <label class="form-group">
            <span class="form-label">ID</span>
            <input class="form-input form-input-mono" name="id" />
          </label>
          <label class="form-group">
            <span class="form-label">name</span>
            <input class="form-input" name="name" />
          </label>
          <label class="form-group">
            <span class="form-label">sourcePath</span>
            <input class="form-input" name="sourcePath" />
          </label>
          <div class="pce-sprite-editor-prop-grid">
            <label class="form-group">
              <span class="form-label">cell size</span>
              <select class="form-select" name="cellSize">
                ${SPRITE_CELL_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
              </select>
            </label>
            <label class="form-group">
              <span class="form-label">tileBase</span>
              <input class="form-input" name="tileBase" type="number" min="0" max="2047" />
            </label>
            <label class="form-group">
              <span class="form-label">x</span>
              <input class="form-input" name="x" type="number" min="0" max="255" />
            </label>
            <label class="form-group">
              <span class="form-label">y</span>
              <input class="form-input" name="y" type="number" min="0" max="255" />
            </label>
          </div>
          <label class="form-group">
            <span class="form-label">compression</span>
            <select class="form-select" name="compression"><option>NONE</option><option>BEST</option><option>AUTO</option><option>APLIB</option><option>FAST</option><option>LZ4W</option></select>
          </label>
          <label class="form-group">
            <span class="form-label">collision</span>
            <select class="form-select" name="collision"><option>NONE</option><option>CIRCLE</option><option>BOX</option></select>
          </label>
          <label class="form-group">
            <span class="form-label">time</span>
            <input class="form-input form-input-mono" name="time" />
          </label>
          <div class="pce-sprite-editor-prop-grid">
            <label class="form-group">
              <span class="form-label">opt_type</span>
              <select class="form-select" name="optType"><option>BALANCED</option><option>SPRITE</option><option>TILE</option><option>NONE</option></select>
            </label>
            <label class="form-group">
              <span class="form-label">opt_level</span>
              <select class="form-select" name="optLevel"><option>FAST</option><option>MEDIUM</option><option>SLOW</option><option>MAX</option></select>
            </label>
          </div>
          <label class="form-group">
            <span class="form-label">opt_duplicate</span>
            <select class="form-select" name="optDuplicate"><option>FALSE</option><option>TRUE</option></select>
          </label>
          <label class="form-group">
            <span class="form-label">comment</span>
            <textarea class="form-input" name="comment" rows="4"></textarea>
          </label>
          <div class="pce-sprite-editor-stats" data-role="stats"></div>
          <div class="form-error" data-role="form-error"></div>
          <div class="form-actions-inline">
            <button class="btn-primary" type="submit">保存</button>
            <button class="icon-btn" type="button" data-action="delete-selected" title="削除" aria-label="削除">×</button>
          </div>
        </form>
      </aside>
    </div>
  `;

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

  const els = {
    shell: root.querySelector('.pce-sprite-editor-root'),
    summary: root.querySelector('[data-role="summary"]'),
    list: root.querySelector('[data-role="asset-list"]'),
    sourceFilter: root.querySelector('[data-role="source-filter"]'),
    keyword: root.querySelector('[data-role="keyword"]'),
    status: root.querySelector('[data-role="status"]'),
    previewStage: root.querySelector('[data-role="preview-stage"]'),
    previewCanvas: root.querySelector('[data-role="preview-canvas"]'),
    sheetStage: root.querySelector('[data-role="sheet-stage"]'),
    sheetCanvas: root.querySelector('[data-role="sheet-canvas"]'),
    sheetInfo: root.querySelector('[data-role="sheet-info"]'),
    animationRows: root.querySelector('[data-role="animation-rows"]'),
    animationSummary: root.querySelector('[data-role="animation-summary"]'),
    frameScale: root.querySelector('[data-role="frame-scale"]'),
    sheetScale: root.querySelector('[data-role="sheet-scale"]'),
    showGrid: root.querySelector('[data-role="show-grid"]'),
    previewRow: root.querySelector('[data-role="preview-row"]'),
    previewFrame: root.querySelector('[data-role="preview-frame"]'),
    previewTime: root.querySelector('[data-role="preview-time"]'),
    frameWidth: root.querySelector('[data-role="frame-width"]'),
    frameHeight: root.querySelector('[data-role="frame-height"]'),
    form: root.querySelector('[data-role="properties-form"]'),
    sourceLabel: root.querySelector('[data-role="selected-source"]'),
    stats: root.querySelector('[data-role="stats"]'),
    formError: root.querySelector('[data-role="form-error"]'),
  };

  let assets = [];
  let selectedId = '';
  let importBusy = false;
  // Folder paths (from "/"-separated names) the user has collapsed in the list.
  const collapsedGroups = new Set();
  let sourceImage = null;
  let previewToken = 0;
  let playing = false;
  let playbackTimer = 0;
  let loopPlayback = true;

  function selectedAsset() {
    return spriteAssets().find((asset) => asset.id === selectedId) || null;
  }

  function spriteAssets() {
    return assets.filter((asset) => asset.type === 'sprite' || asset.options?.kind === 'sprite');
  }

  function setStatus(message = '', type = '') {
    els.status.textContent = message;
    els.status.dataset.kind = type;
  }

  function setFormError(message = '') {
    els.formError.textContent = message;
  }

  function sourceGroups() {
    const groups = new Set();
    spriteAssets().forEach((asset) => {
      const source = String(asset.source || '');
      const group = source.includes('/') ? source.split('/').slice(0, -1).join('/') : '';
      if (group) groups.add(group);
    });
    return Array.from(groups).sort(compareText);
  }

  function renderSourceFilter() {
    const current = els.sourceFilter.value || '';
    const groups = sourceGroups();
    els.sourceFilter.innerHTML = `<option value="">すべて</option>${groups.map((group) => `<option value="${esc(group)}">${esc(group)}</option>`).join('')}`;
    els.sourceFilter.value = groups.includes(current) ? current : '';
  }

  function filteredAssets() {
    const keyword = String(els.keyword.value || '').trim().toLowerCase();
    const sourceFilter = String(els.sourceFilter.value || '');
    return spriteAssets()
      .filter((asset) => {
        if (sourceFilter && !String(asset.source || '').startsWith(`${sourceFilter}/`)) return false;
        if (!keyword) return true;
        return `${assetFullName(asset)} ${asset.id || ''} ${asset.source || ''}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => compareText(assetFullName(a), assetFullName(b)) || compareText(a.id, b.id));
  }

  function renderAssetList() {
    const list = filteredAssets();
    els.summary.textContent = `${spriteAssets().length} sprites`;
    if (!list.length) {
      els.list.innerHTML = '<div class="pce-sprite-editor-empty">Sprite asset がありません</div>';
      return;
    }
    // A group is hidden when an ancestor folder is collapsed; the collapsed
    // folder's own header still shows so it can be reopened.
    const underCollapsed = (path) => [...collapsedGroups].some((c) => path === c || path.startsWith(`${c}/`));
    const html = [];
    let previousGroup = '';
    list.forEach((asset) => {
      const group = assetGroupParts(asset).join('/');
      if (group && group !== previousGroup && !group.split('/').slice(0, -1).some((_, i, segs) => collapsedGroups.has(segs.slice(0, i + 1).join('/')))) {
        const collapsed = collapsedGroups.has(group);
        html.push(`<div class="pce-sprite-editor-group" data-group-path="${esc(group)}"><span class="pce-sprite-editor-group-toggle">${collapsed ? '▸' : '▾'}</span><span>${esc(group)}</span></div>`);
      }
      previousGroup = group;
      if (group && underCollapsed(group)) return;
      const metrics = spriteSheetMetrics(asset);
      html.push(`
        <button class="pce-sprite-editor-item${asset.id === selectedId ? ' active' : ''}" type="button" data-asset-id="${esc(asset.id)}">
          <span class="pce-sprite-editor-thumb" data-thumb="${esc(asset.id)}"></span>
          <span class="pce-sprite-editor-item-main">
            <strong>${esc(assetDisplayName(asset))}</strong>
            <code>${esc(asset.id || '')}</code>
          </span>
          <span class="pce-sprite-editor-item-meta">${metrics.columns} x ${metrics.rows}</span>
          <span class="pce-sprite-editor-item-actions">
            <span class="icon-btn" role="button" tabindex="0" data-delete-asset="${esc(asset.id)}" title="削除" aria-label="削除">×</span>
          </span>
        </button>
      `);
    });
    els.list.innerHTML = html.join('');
    loadListThumbnails(list);
  }

  function loadListThumbnails(list) {
    list.slice(0, 48).forEach(async (asset) => {
      const escapedId = window.CSS?.escape
        ? window.CSS.escape(asset.id)
        : String(asset.id || '').replace(/["\\]/g, '\\$&');
      const target = els.list.querySelector(`[data-thumb="${escapedId}"]`);
      if (!target || !asset.source) return;
      const result = await previewPceAssetSource(asset.source);
      if (!result?.ok || !result.dataUrl || !target.isConnected) return;
      target.innerHTML = `<img src="${esc(result.dataUrl)}" alt="" />`;
    });
  }

  function readFrameConfig() {
    const asset = selectedAsset() || {};
    const metrics = spriteSheetMetrics(asset, sourceImage);
    const frameWidth = Math.max(metrics.cellWidth, Math.ceil(clampInt(els.frameWidth.value, metrics.cellWidth, 256, metrics.cellWidth) / metrics.cellWidth) * metrics.cellWidth);
    const frameHeight = Math.max(metrics.cellHeight, Math.ceil(clampInt(els.frameHeight.value, metrics.cellHeight, 256, metrics.cellHeight) / metrics.cellHeight) * metrics.cellHeight);
    const grid = computeFrameGrid(metrics.width, metrics.height, frameWidth, frameHeight, metrics.cellWidth, metrics.cellHeight);
    return { metrics, frameWidth, frameHeight, grid };
  }

  function readRowFrameCounts(grid) {
    return Array.from({ length: grid.rows }, (_, row) => {
      const input = els.animationRows.querySelector(`[data-row-frame-count="${row}"]`);
      return clampInt(input?.value, 0, grid.columns, row === 0 ? 1 : 0);
    });
  }

  function readRowDefaultTimes(grid) {
    return Array.from({ length: grid.rows }, (_, row) => {
      const input = els.animationRows.querySelector(`[data-row-default-time="${row}"]`);
      return String(clampInt(input?.value, 0, 60, 4));
    });
  }

  function syncPreviewControls() {
    const { grid } = readFrameConfig();
    const row = clampInt(els.previewRow.value, 0, Math.max(0, grid.rows - 1), 0);
    const counts = readRowFrameCounts(grid);
    const maxFrame = Math.max(0, Math.min(grid.columns, counts[row] || 0) - 1);
    const frame = clampInt(els.previewFrame.value, 0, maxFrame, 0);
    els.previewRow.max = String(Math.max(0, grid.rows - 1));
    els.previewFrame.max = String(maxFrame);
    els.previewRow.value = String(row);
    els.previewFrame.value = String(frame);
    const matrix = parseSpriteTime(els.form.elements.time.value, grid.rows, grid.columns);
    els.previewTime.value = String(matrix[row]?.[frame] ?? '0');
    return { row, frame, counts };
  }

  function renderProperties(asset) {
    stopPlayback();
    setFormError('');
    const form = els.form;
    const disabled = !asset;
    Array.from(form.elements).forEach((field) => {
      field.disabled = disabled;
    });
    if (!asset) {
      form.reset();
      els.sourceLabel.textContent = '-';
      els.stats.innerHTML = '';
      els.animationRows.innerHTML = '';
      els.sheetInfo.textContent = '-';
      sourceImage = null;
      drawFramePreview();
      drawSheetPreview();
      return;
    }
    const metrics = spriteSheetMetrics(asset);
    const options = asset.options || {};
    const editorState = editorStateFromAsset(asset);
    form.elements.id.value = asset.id || '';
    form.elements.name.value = asset.name || asset.id || '';
    form.elements.sourcePath.value = asset.source || '';
    form.elements.cellSize.value = `${metrics.cellWidth}x${metrics.cellHeight}`;
    form.elements.tileBase.value = clampInt(options.tileBase, 0, 2047, DEFAULT_TILE_BASE);
    form.elements.x.value = clampInt(options.x, 0, 255, 144);
    form.elements.y.value = clampInt(options.y, 0, 255, 104);
    form.elements.compression.value = editorState.compression;
    form.elements.collision.value = editorState.collision;
    form.elements.time.value = editorState.time;
    form.elements.optType.value = editorState.optType;
    form.elements.optLevel.value = editorState.optLevel;
    form.elements.optDuplicate.value = editorState.optDuplicate;
    form.elements.comment.value = editorState.comment;
    els.frameWidth.value = editorState.frameWidth;
    els.frameHeight.value = editorState.frameHeight;
    els.sourceLabel.textContent = asset.source || '-';
    els.stats.innerHTML = `
      <span>Cell <strong>${metrics.cellWidth}x${metrics.cellHeight}</strong></span>
      <span>Sheet <strong>${metrics.width}x${metrics.height}</strong></span>
      <span>Tiles <strong>${asset.data?.generated?.tileCount || '-'}</strong></span>
      <span>VRAM <strong>${asset.data?.generated?.vramBytes || '-'}</strong></span>
    `;
    renderAnimationRows(editorState.rowFrameCounts, editorState.rowDefaultTimes);
    loadSelectedImage(asset);
  }

  async function loadSelectedImage(asset) {
    const token = ++previewToken;
    sourceImage = null;
    drawFramePreview();
    drawSheetPreview();
    if (!asset?.source) return;
    const result = await previewPceAssetSource(asset.source);
    if (token !== previewToken) return;
    if (!result?.ok || !result.dataUrl) {
      setStatus(result?.error || 'preview を読み込めません', 'error');
      return;
    }
    try {
      sourceImage = await loadImageFromDataUrl(result.dataUrl);
      if (token !== previewToken) return;
      setStatus('');
      drawFramePreview();
      drawSheetPreview();
      renderAnimationRows();
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  function renderAnimationRows(rowFrameCounts = null, rowDefaultTimes = null) {
    const { grid } = readFrameConfig();
    const fallbackCounts = rowFrameCounts || readRowFrameCounts(grid);
    const fallbackTimes = rowDefaultTimes || readRowDefaultTimes(grid);
    els.animationSummary.textContent = `${grid.rows} rows / ${grid.columns} frames`;
    const rows = [];
    rows.push(`
      <div class="pce-sprite-editor-animation-row pce-sprite-editor-animation-row-head">
        <span>ROW</span>
        <span>有効</span>
        <span>既定 time</span>
        <span>状態</span>
      </div>
    `);
    for (let row = 0; row < grid.rows; row += 1) {
      const count = clampInt(fallbackCounts[row], 0, grid.columns, row === 0 ? 1 : 0);
      const time = clampInt(fallbackTimes[row], 0, 60, 4);
      const active = row === clampInt(els.previewRow.value, 0, Math.max(0, grid.rows - 1), 0);
      rows.push(`
        <div class="pce-sprite-editor-animation-row${active ? ' is-selected' : ''}" data-animation-row="${row}">
          <button class="btn-sm" type="button" data-pick-row="${row}">ROW ${row}</button>
          <input class="form-input" type="number" min="0" max="${grid.columns}" value="${count}" data-row-frame-count="${row}" />
          <input class="form-input" type="number" min="0" max="60" value="${time}" data-row-default-time="${row}" />
          <span>${count > 0 ? '編集中' : '-'}</span>
        </div>
      `);
    }
    els.animationRows.innerHTML = rows.join('');
    syncPreviewControls();
  }

  function frameRect(row, frame) {
    const { grid } = readFrameConfig();
    return grid.frames.find((item) => item.row === row && item.frame === frame) || grid.frames[0] || { x: 0, y: 0, width: grid.width, height: grid.height };
  }

  function drawFrameGrid(ctx, x, y, width, height, scale, step = 8) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    for (let px = step; px < width; px += step) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x + px * scale) + 0.5, y);
      ctx.lineTo(Math.round(x + px * scale) + 0.5, y + height * scale);
      ctx.stroke();
    }
    for (let py = step; py < height; py += step) {
      ctx.beginPath();
      ctx.moveTo(x, Math.round(y + py * scale) + 0.5);
      ctx.lineTo(x + width * scale, Math.round(y + py * scale) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCollisionOverlay(ctx, x, y, width, height, scale) {
    const collision = els.form.elements.collision?.value || 'NONE';
    if (collision === 'NONE') return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 210, 82, 0.9)';
    ctx.lineWidth = 1.5;
    if (collision === 'CIRCLE') {
      ctx.beginPath();
      ctx.ellipse(x + (width * scale) / 2, y + (height * scale) / 2, (width * scale) / 2, (height * scale) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(x + 0.5, y + 0.5, width * scale - 1, height * scale - 1);
    }
    ctx.restore();
  }

  function drawFramePreview() {
    const canvas = els.previewCanvas;
    const stage = els.previewStage;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, stage.clientWidth || 400);
    const height = Math.max(1, stage.clientHeight || 260);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#090d15';
    ctx.fillRect(0, 0, width, height);
    const asset = selectedAsset();
    if (!asset || !sourceImage) {
      ctx.fillStyle = '#9aa8bd';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(asset ? 'preview を読み込み中' : 'Sprite asset を選択してください', width / 2, height / 2);
      return;
    }
    const { row, frame } = syncPreviewControls();
    const rect = frameRect(row, frame);
    const scale = clampInt(els.frameScale.value, 1, 16, 4);
    const dw = rect.width * scale;
    const dh = rect.height * scale;
    const dx = Math.floor((width - dw) / 2);
    const dy = Math.floor((height - dh) / 2);
    ctx.drawImage(sourceImage, rect.x, rect.y, rect.width, rect.height, dx, dy, dw, dh);
    ctx.strokeStyle = '#3fb7ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx - 1, dy - 1, dw + 2, dh + 2);
    if (els.showGrid.checked) drawFrameGrid(ctx, dx, dy, rect.width, rect.height, scale);
    drawCollisionOverlay(ctx, dx, dy, rect.width, rect.height, scale);
  }

  function drawSheetPreview() {
    const canvas = els.sheetCanvas;
    const ctx = canvas.getContext('2d');
    const asset = selectedAsset();
    const { grid, metrics } = readFrameConfig();
    const sheetWidth = sourceImage?.naturalWidth || metrics.width;
    const sheetHeight = sourceImage?.naturalHeight || metrics.height;
    const scale = clampInt(els.sheetScale.value, 1, 16, 4);
    canvas.width = Math.max(1, sheetWidth * scale);
    canvas.height = Math.max(1, sheetHeight * scale);
    canvas.style.width = `${sheetWidth * scale}px`;
    canvas.style.height = `${sheetHeight * scale}px`;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#090d15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (sourceImage) {
      ctx.drawImage(sourceImage, 0, 0, sheetWidth, sheetHeight, 0, 0, sheetWidth * scale, sheetHeight * scale);
    }
    drawSheetGrid(ctx, grid, scale);
    els.sheetInfo.textContent = asset
      ? `${grid.columns}/${grid.rows} frames  ${sheetWidth}x${sheetHeight}px`
      : '-';
  }

  function drawSheetGrid(ctx, grid, scale) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    grid.frames.forEach((frame) => {
      ctx.strokeRect(Math.round(frame.x * scale) + 0.5, Math.round(frame.y * scale) + 0.5, frame.width * scale, frame.height * scale);
    });
    const selected = frameRect(
      clampInt(els.previewRow.value, 0, Math.max(0, grid.rows - 1), 0),
      clampInt(els.previewFrame.value, 0, Math.max(0, grid.columns - 1), 0),
    );
    ctx.strokeStyle = '#ffd252';
    ctx.lineWidth = 2;
    ctx.strokeRect(selected.x * scale + 1, selected.y * scale + 1, selected.width * scale - 2, selected.height * scale - 2);
    ctx.restore();
  }

  function advanceFrame() {
    const { grid } = readFrameConfig();
    const { row, frame, counts } = syncPreviewControls();
    const count = Math.max(1, counts[row] || 1);
    if (frame + 1 < count) {
      els.previewFrame.value = String(frame + 1);
    } else if (loopPlayback) {
      els.previewFrame.value = '0';
    } else {
      stopPlayback();
      return;
    }
    const matrix = parseSpriteTime(els.form.elements.time.value, grid.rows, grid.columns);
    const nextTime = clampInt(matrix[row]?.[clampInt(els.previewFrame.value, 0, count - 1, 0)], 1, 60, 4);
    drawFramePreview();
    drawSheetPreview();
    playbackTimer = window.setTimeout(advanceFrame, nextTime * 1000 / 60);
  }

  function startPlayback() {
    if (playing) return;
    playing = true;
    root.querySelector('[data-action="play"]').textContent = 'Ⅱ';
    const time = clampInt(els.previewTime.value, 1, 60, 4);
    playbackTimer = window.setTimeout(advanceFrame, time * 1000 / 60);
  }

  function stopPlayback() {
    if (playbackTimer) window.clearTimeout(playbackTimer);
    playbackTimer = 0;
    playing = false;
    const button = root.querySelector('[data-action="play"]');
    if (button) button.textContent = '▶';
  }

  function togglePlayback() {
    if (playing) stopPlayback();
    else startPlayback();
  }

  function saveRowFrameCount(row, value) {
    const { grid } = readFrameConfig();
    const input = els.animationRows.querySelector(`[data-row-default-time="${row}"]`);
    const fill = input?.value || els.previewTime.value || '4';
    els.form.elements.time.value = resizeSpriteTimeRow(els.form.elements.time.value, grid.rows, grid.columns, row, value, fill);
    renderAnimationRows();
    drawFramePreview();
    drawSheetPreview();
  }

  function applyRowDefaultTime(row, value) {
    const { grid } = readFrameConfig();
    const countInput = els.animationRows.querySelector(`[data-row-frame-count="${row}"]`);
    const count = clampInt(countInput?.value, 0, grid.columns, row === 0 ? 1 : 0);
    els.form.elements.time.value = applyDefaultTimeToRow(els.form.elements.time.value, grid.rows, grid.columns, row, count, value);
    syncPreviewControls();
    drawFramePreview();
  }

  function updatePreviewTime(value) {
    const { grid } = readFrameConfig();
    const row = clampInt(els.previewRow.value, 0, Math.max(0, grid.rows - 1), 0);
    const frame = clampInt(els.previewFrame.value, 0, Math.max(0, grid.columns - 1), 0);
    els.form.elements.time.value = updateSpriteTimeCell(els.form.elements.time.value, grid.rows, grid.columns, row, frame, value);
    renderAnimationRows();
    drawFramePreview();
  }

  function collectFormAsset() {
    const current = selectedAsset();
    if (!current) return null;
    const [cellWidth, cellHeight] = parseCellSize(els.form.elements.cellSize.value || '16x16');
    const draftForMetrics = {
      ...current,
      options: {
        ...(current.options || {}),
        cellWidth,
        cellHeight,
      },
    };
    const { grid, frameWidth, frameHeight } = readFrameConfig();
    const rowFrameCounts = readRowFrameCounts(grid);
    const rowDefaultTimes = readRowDefaultTimes(grid);
    const id = safeId(els.form.elements.id.value, current.id || 'sprite_asset');
    const animations = buildAnimationsFromEditorState({
      asset: draftForMetrics,
      image: sourceImage,
      frameWidth,
      frameHeight,
      time: els.form.elements.time.value,
      rowFrameCounts,
      rowDefaultTimes,
    });
    return {
      ...current,
      id,
      type: 'sprite',
      name: String(els.form.elements.name.value || id).trim(),
      source: String(els.form.elements.sourcePath.value || current.source || '').trim(),
      options: {
        ...(current.options || {}),
        kind: 'sprite',
        tileBase: clampInt(els.form.elements.tileBase.value, 0, 2047, DEFAULT_TILE_BASE),
        mapBase: 0,
        x: clampInt(els.form.elements.x.value, 0, 255, 144),
        y: clampInt(els.form.elements.y.value, 0, 255, 104),
        cellWidth,
        cellHeight,
        animations,
        spriteEditor: {
          frameWidth,
          frameHeight,
          time: serializeSpriteTime(parseSpriteTime(els.form.elements.time.value, grid.rows, grid.columns)),
          rowFrameCounts,
          rowDefaultTimes,
          compression: els.form.elements.compression.value,
          collision: els.form.elements.collision.value,
          optType: els.form.elements.optType.value,
          optLevel: els.form.elements.optLevel.value,
          optDuplicate: els.form.elements.optDuplicate.value,
          comment: els.form.elements.comment.value,
        },
      },
    };
  }

  async function saveSelected(event) {
    event.preventDefault();
    const current = selectedAsset();
    const asset = collectFormAsset();
    if (!current || !asset) return;
    setFormError('');
    if (asset.id !== current.id && assets.some((entry) => entry.id === asset.id)) {
      setFormError('同じ ID のアセットが既にあります');
      return;
    }
    try {
      const result = await upsertPceAsset(asset);
      if (!result?.ok) throw new Error(result?.error || '保存できませんでした');
      assets = result.assets || assets;
      if (asset.id !== current.id) {
        const deleted = await deletePceAsset(current.id);
        if (!deleted?.ok) throw new Error(deleted?.error || '旧 ID の削除に失敗しました');
        assets = deleted.assets || assets;
      }
      selectedId = asset.id;
      setStatus('保存しました', 'ok');
      await reload({ force: true, keepStatus: true });
    } catch (err) {
      setFormError(err.message || String(err));
    }
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
          <div class="settings-form compact-form">
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
      const before = spriteAssets();
      const oldIndex = Math.max(0, before.findIndex((asset) => asset.id === assetId));
      const result = await deletePceAsset(assetId);
      if (!result?.ok) throw new Error(result?.error || '削除できませんでした');
      assets = result.assets || assets;
      const after = spriteAssets();
      selectedId = after[Math.min(oldIndex, after.length - 1)]?.id || '';
      setStatus('削除しました', 'ok');
      renderSourceFilter();
      renderAssetList();
      renderProperties(selectedAsset());
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
    return { sourcePath, fileName, sourceDataUrl: read.dataUrl };
  }

  function openImportSettingsModal(picked) {
    return new Promise((resolve) => {
      const baseName = sourceBasename(picked.fileName || picked.sourcePath).replace(/\.[^.]+$/, '');
      const defaultId = safeId(baseName, 'sprite_asset');
      const modal = api.createModal({
        id: `${plugin.id}-import-${Date.now()}`,
        panelClassName: 'app-panel pce-sprite-editor-import-panel',
        html: `
          <div class="page-header modal-header">
            <h2>スプライト追加</h2>
            <button class="icon-btn" type="button" data-import-cancel>✕</button>
          </div>
          <form class="settings-form compact-form pce-sprite-editor-import-form">
            <code class="pce-sprite-editor-picked-file">${esc(picked.sourcePath)}</code>
            <div class="image-preview-frame pce-sprite-editor-import-preview"><img data-import-preview alt="Import preview" /></div>
            <div class="pce-sprite-editor-import-grid">
              <label class="form-group"><span class="form-label">ID</span><input class="form-input form-input-mono" name="id" value="${esc(defaultId)}" /></label>
              <label class="form-group"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(baseName)}" /></label>
              <label class="form-group"><span class="form-label">Palette bank</span><input class="form-input" name="paletteBank" type="number" min="0" max="15" value="0" /></label>
              <label class="form-group"><span class="form-label">Tile base</span><input class="form-input" name="tileBase" type="number" min="0" max="2047" value="${DEFAULT_TILE_BASE}" /></label>
              <label class="form-group"><span class="form-label">X</span><input class="form-input" name="x" type="number" min="0" max="255" value="144" /></label>
              <label class="form-group"><span class="form-label">Y</span><input class="form-input" name="y" type="number" min="0" max="255" value="104" /></label>
              <label class="form-group"><span class="form-label">Cell size</span><select class="form-select" name="cellSize">${SPRITE_CELL_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}</select></label>
              <label class="form-group"><span class="form-label">Output width</span><input class="form-input" name="outputWidth" type="number" min="16" max="1024" step="16" value="${DEFAULT_WIDTH}" /></label>
              <label class="form-group"><span class="form-label">Output height</span><input class="form-input" name="outputHeight" type="number" min="16" max="1024" step="16" value="${DEFAULT_HEIGHT}" /></label>
              <label class="form-group"><span class="form-label">Transparent index</span><input class="form-input" name="transparentIndex" type="number" min="0" max="15" value="0" /></label>
              <label class="form-group"><span class="form-label">Frame W</span><input class="form-input" name="frameWidth" type="number" min="16" max="256" step="16" value="${DEFAULT_WIDTH}" /></label>
              <label class="form-group"><span class="form-label">Frame H</span><input class="form-input" name="frameHeight" type="number" min="16" max="256" step="16" value="${DEFAULT_HEIGHT}" /></label>
              <label class="form-group"><span class="form-label">Frames</span><input class="form-input" name="frameCount" type="number" min="1" max="64" value="1" /></label>
              <label class="form-group"><span class="form-label">Speed</span><input class="form-input" name="frameDelay" type="number" min="1" max="60" value="8" /></label>
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
      const preview = modal.panel.querySelector('[data-import-preview]');
      if (preview) preview.src = picked.sourceDataUrl;
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
        const [cellWidth, cellHeight] = parseCellSize(form.elements.cellSize.value || '16x16');
        const frameWidth = Math.max(cellWidth, Math.ceil(clampInt(form.elements.frameWidth.value, cellWidth, 256, DEFAULT_WIDTH) / cellWidth) * cellWidth);
        const frameHeight = Math.max(cellHeight, Math.ceil(clampInt(form.elements.frameHeight.value, cellHeight, 256, DEFAULT_HEIGHT) / cellHeight) * cellHeight);
        const frameWidthCells = Math.max(1, Math.ceil(frameWidth / cellWidth));
        modal.close();
        modal.destroy?.();
        resolve({
          id,
          name: String(form.elements.name.value || id).trim(),
          paletteBank: clampInt(form.elements.paletteBank.value, 0, 15, 0),
          tileBase: clampInt(form.elements.tileBase.value, 0, 2047, DEFAULT_TILE_BASE),
          x: clampInt(form.elements.x.value, 0, 255, 144),
          y: clampInt(form.elements.y.value, 0, 255, 104),
          cellWidth,
          cellHeight,
          outputWidth: clampInt(form.elements.outputWidth.value, 16, 1024, DEFAULT_WIDTH),
          outputHeight: clampInt(form.elements.outputHeight.value, 16, 1024, DEFAULT_HEIGHT),
          transparentIndex: clampInt(form.elements.transparentIndex.value, 0, 15, 0),
          frameWidth,
          frameHeight,
          frameCount: clampInt(form.elements.frameCount.value, 1, 64, 1),
          frameDelay: clampInt(form.elements.frameDelay.value, 1, 60, 8),
          frameStrideCells: frameWidthCells,
        });
      });
      modal.open();
    });
  }

  async function importSpriteAsset() {
    if (importBusy) return null;
    importBusy = true;
    setStatus('');
    try {
      const picked = await pickImageFile();
      if (!picked) return null;
      const details = await openImportSettingsModal(picked);
      if (!details) return null;
      const pipeline = getImagePipeline(api);
      if (!pipeline?.convertToIndexed16) throw new Error('画像コンバータープラグインが無効または未インストールです');
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
      if (finalWidth % 16 !== 0 || finalHeight % 16 !== 0) {
        throw new Error('Sprite sheet の出力サイズは16px単位にしてください');
      }
      const result = await importPceImage({
        sourcePath: picked.sourcePath,
        sourceFileName: picked.fileName,
        convertedDataUrl: converted.convertedDataUrl || '',
        kind: 'sprite',
        id: details.id,
        name: details.name,
        paletteBank: details.paletteBank,
        tileBase: details.tileBase,
        mapBase: 0,
        x: details.x,
        y: details.y,
        cellWidth: details.cellWidth,
        cellHeight: details.cellHeight,
        transparentIndex: details.transparentIndex,
        width: finalWidth,
        height: finalHeight,
        options: {
          animations: [{
            id: 'default',
            name: 'ROW 0',
            frameWidth: details.frameWidth,
            frameHeight: details.frameHeight,
            firstCell: 0,
            frameCount: details.frameCount,
            frameDelay: details.frameDelay,
            frameStrideCells: details.frameStrideCells,
            loop: true,
          }],
          spriteEditor: {
            frameWidth: details.frameWidth,
            frameHeight: details.frameHeight,
            time: `[[${Array.from({ length: details.frameCount }, () => String(details.frameDelay)).join(',')}]]`,
            rowFrameCounts: [details.frameCount],
            rowDefaultTimes: [String(details.frameDelay)],
            compression: 'NONE',
            collision: 'NONE',
            optType: 'BALANCED',
            optLevel: 'FAST',
            optDuplicate: 'FALSE',
            comment: '',
          },
        },
      });
      if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
      assets = result.assets || assets;
      selectedId = result.asset?.id || details.id;
      setStatus('追加しました', 'ok');
      logger?.info?.(`PCE sprite imported: ${selectedId}${converted.warning ? ` (${converted.warning})` : ''}`);
      renderSourceFilter();
      renderAssetList();
      renderProperties(selectedAsset());
      await reload({ force: true, keepStatus: true });
      return result.asset || null;
    } catch (err) {
      const message = err.message || String(err);
      logger?.error?.(`PCE sprite import failed: ${message}`);
      setStatus(message, 'error');
      return null;
    } finally {
      importBusy = false;
    }
  }

  async function reload(options = {}) {
    const result = await listPceAssets({ force: Boolean(options.force) });
    assets = result.assets || [];
    const list = spriteAssets();
    if (selectedId && !list.some((asset) => asset.id === selectedId)) selectedId = '';
    if (!selectedId && list.length) selectedId = list[0].id;
    renderSourceFilter();
    renderAssetList();
    renderProperties(selectedAsset());
    if (!options.keepStatus) setStatus('');
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

  function setupColumnResizers() {
    const cleanup = [];
    root.querySelectorAll('[data-column-resizer]').forEach((resizer) => {
      const side = resizer.dataset.columnResizer;
      const onPointerDown = (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startLeft = clampInt(getComputedStyle(els.shell).getPropertyValue('--sprite-left-width'), 220, 520, layout.left);
        const startRight = clampInt(getComputedStyle(els.shell).getPropertyValue('--sprite-right-width'), 260, 520, layout.right);
        resizer.classList.add('is-dragging');
        resizer.setPointerCapture?.(event.pointerId);
        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          if (side === 'left') {
            layout.left = clampInt(startLeft + dx, 220, 520, startLeft);
            els.shell.style.setProperty('--sprite-left-width', `${layout.left}px`);
          } else {
            layout.right = clampInt(startRight - dx, 260, 520, startRight);
            els.shell.style.setProperty('--sprite-right-width', `${layout.right}px`);
          }
          drawFramePreview();
        };
        const onUp = () => {
          resizer.classList.remove('is-dragging');
          saveLayout(layout);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
      };
      resizer.addEventListener('pointerdown', onPointerDown);
      cleanup.push(() => resizer.removeEventListener('pointerdown', onPointerDown));
    });
    return () => cleanup.forEach((fn) => fn());
  }

  function setupRowResizer() {
    const resizer = root.querySelector('[data-row-resizer]');
    if (!resizer) return () => {};
    const onPointerDown = (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = clampInt(getComputedStyle(els.shell).getPropertyValue('--sprite-preview-height'), 180, 520, layout.preview);
      resizer.classList.add('is-dragging');
      const onMove = (moveEvent) => {
        layout.preview = clampInt(startHeight + (moveEvent.clientY - startY), 180, 520, startHeight);
        els.shell.style.setProperty('--sprite-preview-height', `${layout.preview}px`);
        drawFramePreview();
      };
      const onUp = () => {
        resizer.classList.remove('is-dragging');
        saveLayout(layout);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    };
    resizer.addEventListener('pointerdown', onPointerDown);
    return () => resizer.removeEventListener('pointerdown', onPointerDown);
  }

  els.list.addEventListener('click', (event) => {
    const del = event.target?.closest?.('[data-delete-asset]');
    if (del) {
      event.preventDefault();
      event.stopPropagation();
      void deleteAsset(del.dataset.deleteAsset);
      return;
    }
    const groupHeader = event.target?.closest?.('[data-group-path]');
    if (groupHeader) {
      const path = groupHeader.dataset.groupPath || '';
      if (collapsedGroups.has(path)) collapsedGroups.delete(path);
      else if (path) collapsedGroups.add(path);
      renderAssetList();
      return;
    }
    const item = event.target?.closest?.('[data-asset-id]');
    if (!item) return;
    selectedId = item.dataset.assetId || '';
    renderAssetList();
    renderProperties(selectedAsset());
  });

  els.sourceFilter.addEventListener('change', renderAssetList);
  els.keyword.addEventListener('input', renderAssetList);
  root.querySelector('[data-action="add"]').addEventListener('click', () => { void importSpriteAsset(); });
  root.querySelector('[data-action="delete-selected"]').addEventListener('click', () => { void deleteAsset(); });
  root.querySelector('[data-action="first-frame"]').addEventListener('click', () => {
    els.previewFrame.value = '0';
    stopPlayback();
    drawFramePreview();
    drawSheetPreview();
  });
  root.querySelector('[data-action="last-frame"]').addEventListener('click', () => {
    const { counts } = syncPreviewControls();
    const row = clampInt(els.previewRow.value, 0, counts.length - 1, 0);
    els.previewFrame.value = String(Math.max(0, (counts[row] || 1) - 1));
    stopPlayback();
    drawFramePreview();
    drawSheetPreview();
  });
  root.querySelector('[data-action="play"]').addEventListener('click', togglePlayback);
  root.querySelector('[data-action="loop"]').addEventListener('click', (event) => {
    loopPlayback = !loopPlayback;
    event.currentTarget.classList.toggle('active', loopPlayback);
  });
  [els.frameScale, els.sheetScale, els.showGrid, els.previewRow, els.previewFrame, els.frameWidth, els.frameHeight].forEach((control) => {
    control.addEventListener('input', () => {
      stopPlayback();
      if (control === els.frameWidth || control === els.frameHeight) renderAnimationRows();
      drawFramePreview();
      drawSheetPreview();
    });
  });
  els.previewTime.addEventListener('input', () => {
    stopPlayback();
    updatePreviewTime(els.previewTime.value);
  });
  els.animationRows.addEventListener('click', (event) => {
    const pick = event.target?.closest?.('[data-pick-row]');
    if (!pick) return;
    els.previewRow.value = pick.dataset.pickRow || '0';
    els.previewFrame.value = '0';
    renderAnimationRows();
    drawFramePreview();
    drawSheetPreview();
  });
  els.animationRows.addEventListener('change', (event) => {
    const count = event.target?.closest?.('[data-row-frame-count]');
    if (count) {
      saveRowFrameCount(Number(count.dataset.rowFrameCount), count.value);
      return;
    }
    const time = event.target?.closest?.('[data-row-default-time]');
    if (time) applyRowDefaultTime(Number(time.dataset.rowDefaultTime), time.value);
  });
  ['cellSize', 'collision', 'time'].forEach((name) => {
    els.form.elements[name].addEventListener('input', () => {
      stopPlayback();
      if (name === 'cellSize' || name === 'time') renderAnimationRows();
      drawFramePreview();
      drawSheetPreview();
    });
  });
  els.form.addEventListener('submit', saveSelected);
  window.addEventListener('resize', drawFramePreview);

  registerCapability('sprite-manager', {
    pluginId: plugin.id,
    reload,
    importSpriteAsset,
  });

  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  const teardownColumnResizers = setupColumnResizers();
  const teardownRowResizer = setupRowResizer();
  await reload();
  return {
    deactivate() {
      stopPlayback();
      teardownAssetRefreshEvents();
      teardownColumnResizers();
      teardownRowResizer();
      window.removeEventListener('resize', drawFramePreview);
    },
  };
}
