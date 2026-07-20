import { createAdpcmBatchImporter } from './adpcm-batch-import.js';

const AUDIO_EXTS = ['.wav', '.mp3'];
const ADPCM_DEFAULT_SAMPLE_RATE = 8000;
const ADPCM_SAMPLE_RATES = Object.freeze([4000, 4571, 5333, 6400, 8000, 10666, 16000, 32000]);
const ADPCM_SAFE_BYTES = 65535;

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

function supportedAdpcmSampleRate(value, fallback = ADPCM_DEFAULT_SAMPLE_RATE) {
  const safeFallback = ADPCM_SAMPLE_RATES.includes(fallback) ? fallback : ADPCM_DEFAULT_SAMPLE_RATE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return safeFallback;
  return ADPCM_SAMPLE_RATES.reduce((best, rate) => (
    Math.abs(rate - parsed) < Math.abs(best - parsed) ? rate : best
  ), safeFallback);
}

function adpcmSampleRateOptions(selectedValue = ADPCM_DEFAULT_SAMPLE_RATE) {
  const selected = supportedAdpcmSampleRate(selectedValue);
  return ADPCM_SAMPLE_RATES.map((rate) => (
    `<option value="${rate}" ${rate === selected ? 'selected' : ''}>${rate} Hz${rate === ADPCM_DEFAULT_SAMPLE_RATE ? ' (default)' : ''}</option>`
  )).join('');
}

function safeId(value, fallback = 'adpcm_sample') {
  const id = String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return id || fallback;
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function generatedInfo(asset = {}) {
  return asset.data?.generated || {};
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
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return compareText(left, right);
}

function adpcmMaxBytes(asset = {}) {
  return ADPCM_SAFE_BYTES;
}

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.innerHTML = `
    <div class="pce-adpcm-layout" data-plugin-root="${esc(plugin.id)}">
      <section class="pce-adpcm-list-panel">
        <div class="pce-adpcm-header">
          <div>
            <h2>ADPCM Samples</h2>
            <div class="pce-adpcm-summary" data-role="summary">-</div>
          </div>
          <div class="pce-adpcm-actions">
            <button class="icon-btn" type="button" data-action="add" title="追加" aria-label="追加">＋</button>
            <button class="btn-sm" type="button" data-action="batch-import" title="CSVからADPCMを一括取込">CSV一括</button>
            <button class="icon-btn" type="button" data-action="refresh" title="更新" aria-label="更新">↻</button>
          </div>
        </div>
        <div class="pce-adpcm-table-wrap">
          <table class="pce-adpcm-table">
            <thead>
              <tr>
                <th><button class="pce-adpcm-sort" type="button" data-sort-key="name">Name <span data-sort-indicator></span></button></th>
                <th><button class="pce-adpcm-sort" type="button" data-sort-key="id">ID <span data-sort-indicator></span></button></th>
                <th><button class="pce-adpcm-sort" type="button" data-sort-key="rate">Rate <span data-sort-indicator></span></button></th>
                <th><button class="pce-adpcm-sort" type="button" data-sort-key="length">Length <span data-sort-indicator></span></button></th>
                <th><button class="pce-adpcm-sort" type="button" data-sort-key="size">Size <span data-sort-indicator></span></button></th>
                <th><button class="pce-adpcm-sort" type="button" data-sort-key="loop">Loop <span data-sort-indicator></span></button></th>
                <th class="pce-adpcm-row-actions"></th>
              </tr>
            </thead>
            <tbody data-role="rows">
              <tr><td colspan="7" class="pce-adpcm-empty">読み込み中...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="form-error pce-adpcm-status" data-role="status"></div>
      </section>

      <div class="pce-adpcm-resizer" data-role="pane-resizer" role="separator" aria-orientation="vertical" aria-label="一覧と詳細の幅を変更"></div>

      <aside class="pce-adpcm-detail-panel">
        <div class="asset-no-selection-hint" data-role="empty-detail">ADPCM アセットを選択してください</div>
        <form class="settings-form compact-form pce-adpcm-form" data-role="form" hidden>
          <div class="pce-adpcm-detail-head">
            <div>
              <h2 data-role="detail-title">ADPCM</h2>
              <code data-role="detail-source"></code>
            </div>
            <button class="icon-btn" type="button" data-action="play" title="プレビュー" aria-label="プレビュー">▶</button>
          </div>
          <div class="pce-adpcm-form-grid">
            <label class="form-group">
              <span class="form-label">ID</span>
              <input class="form-input form-input-mono" name="id" />
            </label>
            <label class="form-group">
              <span class="form-label">Sample rate</span>
              <select class="form-select" name="sampleRate">${adpcmSampleRateOptions()}</select>
            </label>
            <label class="form-group pce-adpcm-wide">
              <span class="form-label">Name</span>
              <input class="form-input" name="name" />
            </label>
            <label class="form-group">
              <span class="form-label">Loop</span>
              <label class="pce-adpcm-check"><input name="loop" type="checkbox" /><span>loop</span></label>
            </label>
          </div>
          <audio controls data-role="preview" hidden></audio>
          <div class="pce-adpcm-stats" data-role="stats"></div>
          <div class="pce-adpcm-files" data-role="files"></div>
          <div class="pce-adpcm-diagnostics" data-role="diagnostics"></div>
          <div class="form-actions-inline">
            <button class="btn-primary" type="submit">保存</button>
            <button class="icon-btn" type="button" data-action="delete" title="削除" aria-label="削除">✕</button>
          </div>
          <div class="form-error" data-role="form-error"></div>
        </form>
      </aside>
    </div>
  `;

  const layoutEl = root.querySelector('.pce-adpcm-layout');
  const listPanelEl = root.querySelector('.pce-adpcm-list-panel');
  const paneResizerEl = root.querySelector('[data-role="pane-resizer"]');
  const rowsEl = root.querySelector('[data-role="rows"]');
  const summaryEl = root.querySelector('[data-role="summary"]');
  const statusEl = root.querySelector('[data-role="status"]');
  const emptyDetailEl = root.querySelector('[data-role="empty-detail"]');
  const formEl = root.querySelector('[data-role="form"]');
  const formErrorEl = root.querySelector('[data-role="form-error"]');
  const titleEl = root.querySelector('[data-role="detail-title"]');
  const sourceEl = root.querySelector('[data-role="detail-source"]');
  const previewEl = root.querySelector('[data-role="preview"]');
  const statsEl = root.querySelector('[data-role="stats"]');
  const filesEl = root.querySelector('[data-role="files"]');
  const diagnosticsEl = root.querySelector('[data-role="diagnostics"]');

  let assets = [];
  let selectedId = '';
  let draftAsset = null;
  let draftSourceId = '';
  let importBusy = false;
  let sortState = { key: 'name', direction: 'asc' };
  // Folder paths (from "/"-separated names) the user has collapsed in the list.
  const collapsedGroups = new Set();
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
  const importPceAudio = (payload) => assetApi.importPceAudio
    ? assetApi.importPceAudio(payload)
    : api.electronAPI.importAssetAudio(payload);
  const previewPceAssetSource = (relativePath) => assetApi.previewPceAssetSource
    ? assetApi.previewPceAssetSource(relativePath)
    : api.electronAPI.previewAssetSource(relativePath);
  const batchImporter = createAdpcmBatchImporter({ plugin, api, logger });

  function setStatus(message = '', kind = '') {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function setupPaneResizer() {
    if (!layoutEl || !listPanelEl || !paneResizerEl) return () => {};
    const storageKey = 'pce-adpcm-manager.listWidth.v1';
    const resizerWidth = 6;
    const minListWidth = 300;
    const minDetailWidth = 320;

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

  function adpcmAssets() {
    return assets
      .map((asset, index) => ({ asset, index }))
      .filter((entry) => entry.asset.type === 'adpcm')
      .sort((a, b) => a.index - b.index || a.asset.id.localeCompare(b.asset.id, 'ja'))
      .map((entry) => entry.asset);
  }

  function adpcmListMetrics(asset = {}) {
    const generated = generatedInfo(asset);
    const sampleRate = generated.sampleRate || asset.options?.sampleRate || ADPCM_DEFAULT_SAMPLE_RATE;
    const byteLength = generated.byteLength || 0;
    const estimatedSeconds = byteLength ? byteLength * 2 / Math.max(1, sampleRate) : generated.durationSeconds;
    return { generated, sampleRate, byteLength, estimatedSeconds };
  }

  function displayAssetForRow(asset) {
    return draftAsset && draftSourceId === asset.id ? draftAsset : asset;
  }

  function adpcmSortValue(asset, key, index = 0) {
    const metrics = adpcmListMetrics(asset);
    switch (key) {
      case 'id': return asset.id || '';
      case 'rate': return metrics.sampleRate;
      case 'length': return metrics.estimatedSeconds || 0;
      case 'size': return metrics.byteLength || 0;
      case 'loop': return asset.options?.loop ? 1 : 0;
      case 'order': return index;
      case 'name':
      default:
        return assetFullName(asset);
    }
  }

  function sortedAdpcmAssets() {
    const direction = sortState.direction === 'desc' ? -1 : 1;
    return adpcmAssets()
      .map((asset, index) => ({ asset, index }))
      .sort((left, right) => {
        const primary = compareSortValues(
          adpcmSortValue(left.asset, sortState.key, left.index),
          adpcmSortValue(right.asset, sortState.key, right.index),
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
      const pathAt = (depth) => group.slice(0, depth + 1).join('/');
      let shared = 0;
      while (shared < previousGroup.length && shared < group.length && previousGroup[shared] === group[shared]) {
        shared += 1;
      }
      let html = '';
      let ancestorCollapsed = false;
      for (let depth = 0; depth < group.length; depth += 1) {
        const path = pathAt(depth);
        const collapsed = collapsedGroups.has(path);
        if (depth >= shared && !ancestorCollapsed) {
          html += `
            <tr class="pce-adpcm-group-row" data-group-path="${esc(path)}">
              <td colspan="${colSpan}" style="--asset-group-indent:${depth * 14}px">
                <span class="pce-adpcm-group-toggle">${collapsed ? '▸' : '▾'}</span>
                <span>${esc(group[depth])}</span>
                <code>${esc(group.slice(0, depth + 1).join(' / '))}</code>
              </td>
            </tr>
          `;
        }
        if (collapsed) ancestorCollapsed = true;
      }
      previousGroup = group;
      // Hide an asset row when any of its ancestor groups is collapsed.
      return html + (ancestorCollapsed ? '' : rowRenderer(asset, group.length));
    });
  }

  function toggleGroupCollapse(path) {
    if (!path) return;
    if (collapsedGroups.has(path)) collapsedGroups.delete(path);
    else collapsedGroups.add(path);
    renderRows();
  }

  function selectedAsset() {
    return adpcmAssets().find((asset) => asset.id === selectedId) || null;
  }

  async function pickAudioFile() {
    const picked = await api.electronAPI.pickFile({
      properties: ['openFile'],
      filters: [{ name: 'WAV / MP3', extensions: ['wav', 'mp3'] }],
    });
    const sourcePath = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
    if (picked?.canceled || !sourcePath) return null;
    const fileName = sourceBasename(sourcePath);
    const ext = extname(fileName || sourcePath);
    if (!AUDIO_EXTS.includes(ext)) {
      setStatus('WAV / MP3 を選択してください', 'error');
      return null;
    }
    return { sourcePath, fileName, ext };
  }

  function clearPreview() {
    if (previewEl.src) {
      previewEl.pause();
      previewEl.removeAttribute('src');
    }
    previewEl.hidden = true;
  }

  async function loadPreview(asset, { autoplay = false } = {}) {
    clearPreview();
    if (!asset?.source) return;
    const previewTargetId = asset.id;
    const result = await previewPceAssetSource(asset.source);
    if (selectedId !== previewTargetId) return;
    if (!result?.ok || !result.dataUrl) {
      formErrorEl.textContent = result?.error || 'プレビューを取得できませんでした';
      return;
    }
    previewEl.src = result.dataUrl;
    previewEl.hidden = false;
    if (autoplay) {
      try {
        await previewEl.play();
      } catch (_) {
        // Browser audio policies may block autoplay; controls remain visible.
      }
    }
  }

  function renderDiagnostics(asset) {
    const generated = generatedInfo(asset);
    const warnings = Array.isArray(generated.warnings) ? generated.warnings : [];
    const waveform = Array.isArray(generated.waveform) && generated.waveform.length
      ? `<div class="pce-adpcm-waveform">${generated.waveform.slice(0, 64).map((value) => `<span style="height:${Math.max(2, Math.round(Number(value) * 30))}px"></span>`).join('')}</div>`
      : '';
    diagnosticsEl.innerHTML = warnings.length
      ? `${waveform}${warnings.map((warning) => `<div class="asset-warning">${esc(warning)}</div>`).join('')}`
      : waveform || '<p class="asset-no-selection-hint">警告はありません</p>';
  }

  function renderStats(asset) {
    const generated = generatedInfo(asset);
    const sampleRate = generated.sampleRate || asset.options?.sampleRate || ADPCM_DEFAULT_SAMPLE_RATE;
    const byteLength = generated.byteLength || 0;
    const estimatedSeconds = byteLength ? byteLength * 2 / Math.max(1, sampleRate) : generated.durationSeconds;
    statsEl.innerHTML = `
      <div><span>Sample rate</span><strong>${esc(sampleRate)} Hz</strong></div>
      <div><span>Length</span><strong>${esc(formatSeconds(estimatedSeconds))}</strong></div>
      <div><span>Limit</span><strong>${esc(formatBytes(adpcmMaxBytes(asset)))}</strong></div>
      <div><span>Size</span><strong>${esc(formatBytes(byteLength))}</strong></div>
    `;
    const files = [
      ['adpcm', generated.outputFile],
      ['source', asset.source],
      ['preview', generated.previewFile],
    ].filter((entry) => entry[1]);
    filesEl.innerHTML = files.length
      ? files.map(([label, file]) => `<div><span>${esc(label)}</span><code>${esc(file)}</code></div>`).join('')
      : '<p class="asset-no-selection-hint">変換結果がありません</p>';
    renderDiagnostics(asset);
  }

  function fillForm(asset, options = {}) {
    formErrorEl.textContent = '';
    clearPreview();
    emptyDetailEl.hidden = Boolean(asset);
    formEl.hidden = !asset;
    if (!asset) {
      titleEl.textContent = 'ADPCM';
      sourceEl.textContent = '';
      statsEl.innerHTML = '';
      filesEl.innerHTML = '';
      diagnosticsEl.innerHTML = '';
      return;
    }
    titleEl.textContent = asset.name || asset.id;
    sourceEl.textContent = asset.source || '';
    formEl.elements.id.value = asset.id || '';
    formEl.elements.name.value = asset.name || asset.id || '';
    formEl.elements.sampleRate.value = supportedAdpcmSampleRate(asset.options?.sampleRate ?? generatedInfo(asset).sampleRate ?? ADPCM_DEFAULT_SAMPLE_RATE);
    formEl.elements.loop.checked = Boolean(asset.options?.loop);
    renderStats(asset);
    void loadPreview(asset, options);
  }

  function selectAsset(id, options = {}) {
    selectedId = id || '';
    renderRows();
    fillForm(selectedAsset(), options);
  }

  function renderRows() {
    const samples = sortedAdpcmAssets();
    summaryEl.textContent = samples.length ? `${samples.length} samples` : '0 samples';
    updateSortHeaders();
    if (!samples.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="pce-adpcm-empty">ADPCM アセットがありません</td></tr>';
      return;
    }
    rowsEl.innerHTML = renderGroupedRows(samples, 7, (asset, depth = 0) => {
      const displayAsset = displayAssetForRow(asset);
      const { sampleRate, byteLength, estimatedSeconds } = adpcmListMetrics(displayAsset);
      return `
        <tr class="pce-adpcm-row ${asset.id === selectedId ? 'active' : ''}" data-id="${esc(asset.id)}" data-tree-depth="${depth}">
          <td class="pce-adpcm-name-cell" style="--asset-tree-indent:${depth * 14}px"><span>${esc(assetDisplayName(displayAsset))}</span></td>
          <td class="pce-adpcm-id-cell"><code>${esc(displayAsset.id)}</code></td>
          <td>${esc(sampleRate)} Hz</td>
          <td>${esc(formatSeconds(estimatedSeconds))}</td>
          <td>${esc(formatBytes(byteLength))}</td>
          <td>${displayAsset.options?.loop ? '<span class="pce-adpcm-loop">Loop</span>' : '<span class="pce-adpcm-muted">-</span>'}</td>
          <td class="pce-adpcm-row-actions">
            <button class="icon-btn-xs" type="button" data-row-play="${esc(asset.id)}" title="プレビュー" aria-label="プレビュー">▶</button>
            <button class="icon-btn-xs" type="button" data-row-delete="${esc(asset.id)}" title="削除" aria-label="削除">✕</button>
          </td>
        </tr>
      `;
    }).join('');
    rowsEl.querySelectorAll('.pce-adpcm-group-row').forEach((row) => {
      row.addEventListener('click', () => toggleGroupCollapse(row.dataset.groupPath || ''));
    });
    rowsEl.querySelectorAll('.pce-adpcm-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target?.closest?.('button')) return;
        selectAsset(row.dataset.id || '');
      });
    });
    rowsEl.querySelectorAll('[data-row-play]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        selectAsset(button.dataset.rowPlay || '', { autoplay: true });
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
    draftAsset = null;
    draftSourceId = '';
    const result = await listPceAssets({ force: Boolean(options.force) });
    if (!result?.ok) {
      rowsEl.innerHTML = `<tr><td colspan="7" class="pce-adpcm-empty">${esc(result?.error || 'PCE assets を読み込めません')}</td></tr>`;
      return;
    }
    assets = result.assets || [];
    const samples = adpcmAssets();
    if (selectedId && !samples.some((asset) => asset.id === selectedId)) selectedId = '';
    if (!selectedId && samples.length) selectedId = samples[0].id;
    renderRows();
    fillForm(selectedAsset());
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
    const asset = selectedAsset();
    if (!asset) return null;
    const id = safeId(formEl.elements.id.value, asset.id);
    const sampleRate = supportedAdpcmSampleRate(formEl.elements.sampleRate.value);
    const options = { ...(asset.options || {}) };
    delete options.adpcmAddress;
    delete options.divider;
    delete options.stream;
    delete options.streaming;
    return {
      ...asset,
      id,
      type: 'adpcm',
      name: String(formEl.elements.name.value || id).trim(),
      options: {
        ...options,
        sampleRate,
        loop: Boolean(formEl.elements.loop.checked),
      },
    };
  }

  function updateDraftFromForm() {
    const asset = collectFormAsset();
    if (!asset) return;
    draftAsset = asset;
    draftSourceId = selectedId;
    titleEl.textContent = asset.name || asset.id;
    sourceEl.textContent = asset.source || '';
    renderStats(asset);
    renderRows();
    setStatus('未保存の変更があります', 'warn');
  }

  async function saveSelected(event) {
    event.preventDefault();
    const current = selectedAsset();
    const asset = collectFormAsset();
    if (!asset || !current) return;
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
    draftAsset = null;
    draftSourceId = '';
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
            <h2>ADPCM 削除</h2>
            <button class="icon-btn" type="button" data-decision="cancel">✕</button>
          </div>
          <div class="settings-form compact-form pce-adpcm-delete-modal">
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
      const before = adpcmAssets();
      const oldIndex = Math.max(0, before.findIndex((asset) => asset.id === assetId));
      const result = await deletePceAsset(assetId);
      if (!result?.ok) throw new Error(result?.error || '削除できませんでした');
      assets = result.assets || assets;
      const after = adpcmAssets();
      selectedId = after[Math.min(oldIndex, after.length - 1)]?.id || '';
      setStatus('削除しました', 'ok');
      renderRows();
      fillForm(selectedAsset());
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  function openImportSettingsModal(picked) {
    return new Promise((resolve) => {
      const baseName = sourceBasename(picked.fileName || picked.sourcePath).replace(/\.[^.]+$/, '');
      const defaultId = safeId(baseName, 'adpcm_sample');
      const modal = api.createModal({
        id: `${plugin.id}-import-${Date.now()}`,
        panelClassName: 'app-panel pce-adpcm-import-panel',
        html: `
          <div class="page-header modal-header">
            <h2>ADPCM 追加</h2>
            <button class="icon-btn" type="button" data-import-cancel>✕</button>
          </div>
          <form class="settings-form compact-form pce-adpcm-import-form">
            <code class="pce-adpcm-picked-file">${esc(picked.sourcePath)}</code>
            <div class="pce-adpcm-form-grid">
              <label class="form-group">
                <span class="form-label">ID</span>
                <input class="form-input form-input-mono" name="id" value="${esc(defaultId)}" />
              </label>
              <label class="form-group">
                <span class="form-label">Sample rate</span>
                <select class="form-select" name="sampleRate">${adpcmSampleRateOptions()}</select>
              </label>
              <label class="form-group pce-adpcm-wide">
                <span class="form-label">Name</span>
                <input class="form-input" name="name" value="${esc(baseName)}" />
              </label>
              <label class="form-group">
                <span class="form-label">Loop</span>
                <label class="pce-adpcm-check"><input name="loop" type="checkbox" /><span>loop</span></label>
              </label>
              <label class="form-group pce-adpcm-wide">
                <span class="form-label">Split</span>
                <label class="pce-adpcm-check"><input name="splitPolicy" type="checkbox" checked /><span>16-bit size 制約に合わせて自動分割</span></label>
              </label>
            </div>
            <div class="form-error" data-import-error></div>
            <div class="form-actions-inline modal-actions-end">
              <button class="btn-sm" type="button" data-import-cancel>キャンセル</button>
              <button class="btn-primary" type="submit">変換して追加</button>
            </div>
          </form>
        `,
      });
      const form = modal.panel.querySelector('form');
      const error = modal.panel.querySelector('[data-import-error]');
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
        const sampleRate = supportedAdpcmSampleRate(form.elements.sampleRate.value);
        modal.close();
        modal.destroy?.();
        resolve({
          id,
          name: String(form.elements.name.value || id).trim(),
          sampleRate,
          loop: Boolean(form.elements.loop.checked),
          splitPolicy: Boolean(form.elements.splitPolicy.checked),
        });
      });
      modal.open();
    });
  }

  async function importAdpcmAsset() {
    if (importBusy) return null;
    importBusy = true;
    setStatus('');
    try {
      const picked = await pickAudioFile();
      if (!picked) return null;
      const details = await openImportSettingsModal(picked);
      if (!details) return null;
      const audioCapability = api.capabilities.get('audio-convert-ui');
      if (!audioCapability?.openAudioConvertModal) {
        throw new Error('音声コンバータープラグインが無効または未インストールです');
      }
      const converted = await audioCapability.openAudioConvertModal({
        mode: 'pce-asset',
        returnResult: true,
        kind: 'adpcm',
        picked,
        targetFileName: `${details.id}.wav`,
        defaults: {
          sampleRate: details.sampleRate,
          mono: true,
        },
      });
      if (!converted?.ok || !converted.dataUrl) return null;
      const processedSampleRate = Number(converted.processing?.sampleRate);
      const sampleRate = Number.isFinite(processedSampleRate) && processedSampleRate > 0
        ? supportedAdpcmSampleRate(processedSampleRate, details.sampleRate)
        : details.sampleRate;
      const result = await importPceAudio({
        dataUrl: converted.dataUrl,
        sourceFileName: `${details.id}.wav`,
        originalFileName: converted.originalFileName || picked.fileName,
        kind: 'adpcm',
        id: details.id,
        name: details.name,
        sampleRate,
        loop: details.loop,
        processing: converted.processing || {},
        splitPolicy: details.splitPolicy ? 'auto' : '',
      });
      if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
      selectedId = result.asset?.id || details.id;
      logger.info(`ADPCM imported: ${selectedId}`);
      setStatus('追加しました', 'ok');
      await reload();
      return result.asset || null;
    } catch (err) {
      const message = err.message || String(err);
      logger.error(`ADPCM import failed: ${message}`);
      setStatus(message, 'error');
      return null;
    } finally {
      importBusy = false;
    }
  }

  formEl.addEventListener('submit', saveSelected);
  formEl.elements.sampleRate.addEventListener('change', () => {
    updateDraftFromForm();
  });
  ['id', 'name', 'loop'].forEach((name) => {
    formEl.elements[name]?.addEventListener('input', updateDraftFromForm);
  });
  root.querySelectorAll('[data-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sortKey || 'name';
      sortState = sortState.key === key
        ? { key, direction: sortState.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' };
      renderRows();
    });
  });
  root.querySelector('[data-action="add"]').addEventListener('click', () => { void importAdpcmAsset(); });
  root.querySelector('[data-action="batch-import"]').addEventListener('click', () => {
    void batchImporter.open().catch((error) => {
      const message = error?.message || String(error);
      logger.error(`ADPCM CSV batch open failed: ${message}`);
      setStatus(message, 'error');
    });
  });
  root.querySelector('[data-action="refresh"]').addEventListener('click', () => { void reload({ force: true }); });
  root.querySelector('[data-action="play"]').addEventListener('click', () => {
    const asset = selectedAsset();
    if (asset) void loadPreview(asset, { autoplay: true });
  });
  root.querySelector('[data-action="delete"]').addEventListener('click', () => { void deleteAsset(); });

  registerCapability('adpcm-manager', {
    pluginId: plugin.id,
    reload,
    importAdpcmAsset,
    importAdpcmBatchCsv: batchImporter.open,
  });
  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  const teardownPaneResizer = setupPaneResizer();
  void reload();
  return {
    deactivate() {
      teardownAssetRefreshEvents();
      teardownPaneResizer();
      batchImporter.destroy();
      clearPreview();
    },
  };
}
