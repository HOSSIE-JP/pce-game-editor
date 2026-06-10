const AUDIO_EXTS = ['.wav', '.mp3'];
const ADPCM_BASE_SAMPLE_RATE = 32000;

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

function safeId(value, fallback = 'adpcm_sample') {
  const id = String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return id || fallback;
}

function sampleRateToDivider(sampleRate) {
  const rate = clampInt(sampleRate, 4000, 32000, 16000);
  return clampInt(Math.round((ADPCM_BASE_SAMPLE_RATE / rate) - 1), 0, 255, 1);
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

function adpcmMaxBytes(asset = {}) {
  const address = clampInt(asset.options?.adpcmAddress, 0, 65535, 0);
  return Math.max(1, Math.min(65535, 65536 - address));
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
            <button class="icon-btn" type="button" data-action="refresh" title="更新" aria-label="更新">↻</button>
          </div>
        </div>
        <div class="pce-adpcm-table-wrap">
          <table class="pce-adpcm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rate</th>
                <th>Length</th>
                <th>Size</th>
                <th>Loop</th>
                <th class="pce-adpcm-row-actions"></th>
              </tr>
            </thead>
            <tbody data-role="rows">
              <tr><td colspan="6" class="pce-adpcm-empty">読み込み中...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="form-error pce-adpcm-status" data-role="status"></div>
      </section>

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
              <input class="form-input" name="sampleRate" type="number" min="4000" max="32000" />
            </label>
            <label class="form-group pce-adpcm-wide">
              <span class="form-label">Name</span>
              <input class="form-input" name="name" />
            </label>
            <label class="form-group">
              <span class="form-label">ADPCM address</span>
              <input class="form-input" name="adpcmAddress" type="number" min="0" max="65535" />
            </label>
            <label class="form-group">
              <span class="form-label">Divider</span>
              <div class="pce-adpcm-field-action">
                <input class="form-input" name="divider" type="number" min="0" max="255" />
                <button class="icon-btn-xs" type="button" data-action="auto-divider" title="Sample rate から divider を補完" aria-label="Sample rate から divider を補完">↺</button>
              </div>
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
  let importBusy = false;

  function setStatus(message = '', kind = '') {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function adpcmAssets() {
    return assets
      .map((asset, index) => ({ asset, index }))
      .filter((entry) => entry.asset.type === 'adpcm')
      .sort((a, b) => a.index - b.index || a.asset.id.localeCompare(b.asset.id, 'ja'))
      .map((entry) => entry.asset);
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
    const result = await api.electronAPI.previewAssetSource(asset.source);
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
    const sampleRate = generated.sampleRate || asset.options?.sampleRate || 16000;
    const byteLength = generated.byteLength || 0;
    const estimatedSeconds = byteLength ? byteLength * 2 / Math.max(1, sampleRate) : generated.durationSeconds;
    statsEl.innerHTML = `
      <div><span>Sample rate</span><strong>${esc(sampleRate)} Hz</strong></div>
      <div><span>Divider</span><strong>${esc(asset.options?.divider ?? sampleRateToDivider(sampleRate))}</strong></div>
      <div><span>Length</span><strong>${esc(formatSeconds(estimatedSeconds))}</strong></div>
      <div><span>Limit</span><strong>${esc(formatBytes(adpcmMaxBytes(asset)))}</strong></div>
      <div><span>Size</span><strong>${esc(formatBytes(byteLength))}</strong></div>
      <div><span>Address</span><strong>${esc(asset.options?.adpcmAddress ?? 0)}</strong></div>
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
    formEl.elements.sampleRate.value = asset.options?.sampleRate ?? generatedInfo(asset).sampleRate ?? 16000;
    formEl.elements.adpcmAddress.value = asset.options?.adpcmAddress ?? 0;
    formEl.elements.divider.value = asset.options?.divider ?? sampleRateToDivider(formEl.elements.sampleRate.value);
    delete formEl.elements.divider.dataset.touched;
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
    const samples = adpcmAssets();
    summaryEl.textContent = samples.length ? `${samples.length} samples` : '0 samples';
    if (!samples.length) {
      rowsEl.innerHTML = '<tr><td colspan="6" class="pce-adpcm-empty">ADPCM アセットがありません</td></tr>';
      return;
    }
    rowsEl.innerHTML = samples.map((asset) => {
      const generated = generatedInfo(asset);
      const sampleRate = generated.sampleRate || asset.options?.sampleRate || 16000;
      const byteLength = generated.byteLength || 0;
      const estimatedSeconds = byteLength ? byteLength * 2 / Math.max(1, sampleRate) : generated.durationSeconds;
      return `
        <tr class="pce-adpcm-row ${asset.id === selectedId ? 'active' : ''}" data-id="${esc(asset.id)}">
          <td><span>${esc(asset.name || asset.id)}</span><code>${esc(asset.id)}</code></td>
          <td>${esc(sampleRate)} Hz</td>
          <td>${esc(formatSeconds(estimatedSeconds))}</td>
          <td>${esc(formatBytes(byteLength))}</td>
          <td>${asset.options?.loop ? '<span class="pce-adpcm-loop">Loop</span>' : '<span class="pce-adpcm-muted">-</span>'}</td>
          <td class="pce-adpcm-row-actions">
            <button class="icon-btn-xs" type="button" data-row-play="${esc(asset.id)}" title="プレビュー" aria-label="プレビュー">▶</button>
            <button class="icon-btn-xs" type="button" data-row-delete="${esc(asset.id)}" title="削除" aria-label="削除">✕</button>
          </td>
        </tr>
      `;
    }).join('');
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

  async function reload() {
    const result = await api.electronAPI.listAssets();
    if (!result?.ok) {
      rowsEl.innerHTML = `<tr><td colspan="6" class="pce-adpcm-empty">${esc(result?.error || 'PCE assets を読み込めません')}</td></tr>`;
      return;
    }
    assets = result.assets || [];
    const samples = adpcmAssets();
    if (selectedId && !samples.some((asset) => asset.id === selectedId)) selectedId = '';
    if (!selectedId && samples.length) selectedId = samples[0].id;
    renderRows();
    fillForm(selectedAsset());
  }

  function collectFormAsset() {
    const asset = selectedAsset();
    if (!asset) return null;
    const id = safeId(formEl.elements.id.value, asset.id);
    const sampleRate = clampInt(formEl.elements.sampleRate.value, 4000, 32000, 16000);
    return {
      ...asset,
      id,
      type: 'adpcm',
      name: String(formEl.elements.name.value || id).trim(),
      options: {
        ...(asset.options || {}),
        sampleRate,
        adpcmAddress: clampInt(formEl.elements.adpcmAddress.value, 0, 65535, 0),
        divider: clampInt(formEl.elements.divider.value, 0, 255, sampleRateToDivider(sampleRate)),
        loop: Boolean(formEl.elements.loop.checked),
      },
    };
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
    const result = await api.electronAPI.upsertAsset(asset);
    if (!result?.ok) {
      formErrorEl.textContent = result?.error || '保存できませんでした';
      return;
    }
    assets = result.assets || assets;
    if (asset.id !== current.id) {
      const deleted = await api.electronAPI.deleteAsset(current.id);
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
      const result = await api.electronAPI.deleteAsset(assetId);
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
                <input class="form-input" name="sampleRate" type="number" min="4000" max="32000" value="16000" />
              </label>
              <label class="form-group pce-adpcm-wide">
                <span class="form-label">Name</span>
                <input class="form-input" name="name" value="${esc(baseName)}" />
              </label>
              <label class="form-group">
                <span class="form-label">ADPCM address</span>
                <input class="form-input" name="adpcmAddress" type="number" min="0" max="65535" value="0" />
              </label>
              <label class="form-group">
                <span class="form-label">Divider</span>
                <div class="pce-adpcm-field-action">
                  <input class="form-input" name="divider" type="number" min="0" max="255" value="1" />
                  <button class="icon-btn-xs" type="button" data-import-auto-divider title="Sample rate から divider を補完" aria-label="Sample rate から divider を補完">↺</button>
                </div>
              </label>
              <label class="form-group">
                <span class="form-label">Loop</span>
                <label class="pce-adpcm-check"><input name="loop" type="checkbox" /><span>loop</span></label>
              </label>
              <label class="form-group pce-adpcm-wide">
                <span class="form-label">Split</span>
                <label class="pce-adpcm-check"><input name="splitPolicy" type="checkbox" checked /><span>16-bit size/address 制約に合わせて自動分割</span></label>
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
      const syncDivider = () => {
        form.elements.divider.value = sampleRateToDivider(form.elements.sampleRate.value);
      };
      form.elements.sampleRate.addEventListener('input', syncDivider);
      modal.panel.querySelector('[data-import-auto-divider]').addEventListener('click', syncDivider);
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
        const sampleRate = clampInt(form.elements.sampleRate.value, 4000, 32000, 16000);
        modal.close();
        modal.destroy?.();
        resolve({
          id,
          name: String(form.elements.name.value || id).trim(),
          sampleRate,
          adpcmAddress: clampInt(form.elements.adpcmAddress.value, 0, 65535, 0),
          divider: clampInt(form.elements.divider.value, 0, 255, sampleRateToDivider(sampleRate)),
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
        throw new Error('PCE 音声コンバータープラグインが無効または未インストールです');
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
        ? clampInt(processedSampleRate, 4000, 32000, details.sampleRate)
        : details.sampleRate;
      const result = await api.electronAPI.importAssetAudio({
        dataUrl: converted.dataUrl,
        sourceFileName: `${details.id}.wav`,
        originalFileName: converted.originalFileName || picked.fileName,
        kind: 'adpcm',
        id: details.id,
        name: details.name,
        sampleRate,
        adpcmAddress: details.adpcmAddress,
        divider: details.divider,
        loop: details.loop,
        processing: converted.processing || {},
        splitPolicy: details.splitPolicy ? 'auto' : '',
      });
      if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
      selectedId = result.asset?.id || details.id;
      logger.info(`PCE ADPCM imported: ${selectedId}`);
      setStatus('追加しました', 'ok');
      await reload();
      return result.asset || null;
    } catch (err) {
      const message = err.message || String(err);
      logger.error(`PCE ADPCM import failed: ${message}`);
      setStatus(message, 'error');
      return null;
    } finally {
      importBusy = false;
    }
  }

  formEl.addEventListener('submit', saveSelected);
  formEl.elements.sampleRate.addEventListener('input', () => {
    if (!formEl.elements.divider.dataset.touched) {
      formEl.elements.divider.value = sampleRateToDivider(formEl.elements.sampleRate.value);
    }
  });
  formEl.elements.divider.addEventListener('input', () => {
    formEl.elements.divider.dataset.touched = '1';
  });
  root.querySelector('[data-action="auto-divider"]').addEventListener('click', () => {
    formEl.elements.divider.value = sampleRateToDivider(formEl.elements.sampleRate.value);
    delete formEl.elements.divider.dataset.touched;
  });
  root.querySelector('[data-action="add"]').addEventListener('click', () => { void importAdpcmAsset(); });
  root.querySelector('[data-action="refresh"]').addEventListener('click', () => { void reload(); });
  root.querySelector('[data-action="play"]').addEventListener('click', () => {
    const asset = selectedAsset();
    if (asset) void loadPreview(asset, { autoplay: true });
  });
  root.querySelector('[data-action="delete"]').addEventListener('click', () => { void deleteAsset(); });

  registerCapability('adpcm-manager', {
    pluginId: plugin.id,
    reload,
    importAdpcmAsset,
  });
  void reload();
  return { deactivate: clearPreview };
}
