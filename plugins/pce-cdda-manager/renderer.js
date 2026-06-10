const AUDIO_EXTS = ['.wav', '.mp3'];

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

function safeId(value, fallback = 'cdda_track') {
  const id = String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return id || fallback;
}

function clampTrack(value, fallback = 2) {
  return Math.max(2, Math.min(99, Math.trunc(asNumber(value, fallback))));
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

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.innerHTML = `
    <div class="pce-cdda-layout" data-plugin-root="${esc(plugin.id)}">
      <section class="pce-cdda-list-panel">
        <div class="pce-cdda-header">
          <div>
            <h2>CD-DA Tracks</h2>
            <div class="pce-cdda-summary" data-role="summary">-</div>
          </div>
          <div class="pce-cdda-actions">
            <button class="icon-btn" type="button" data-action="add" title="追加" aria-label="追加">＋</button>
            <button class="icon-btn" type="button" data-action="refresh" title="更新" aria-label="更新">↻</button>
          </div>
        </div>
        <div class="pce-cdda-table-wrap">
          <table class="pce-cdda-table">
            <thead>
              <tr>
                <th class="pce-cdda-drag-th"></th>
                <th>Track</th>
                <th>Name</th>
                <th>Time</th>
                <th>Loop</th>
                <th class="pce-cdda-row-actions"></th>
              </tr>
            </thead>
            <tbody data-role="rows">
              <tr><td colspan="6" class="pce-cdda-empty">読み込み中...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="form-error pce-cdda-status" data-role="status"></div>
      </section>

      <aside class="pce-cdda-detail-panel">
        <div class="asset-no-selection-hint" data-role="empty-detail">トラックを選択してください</div>
        <form class="settings-form compact-form pce-cdda-form" data-role="form" hidden>
          <div class="pce-cdda-detail-head">
            <div>
              <h2 data-role="detail-title">CD-DA</h2>
              <code data-role="detail-source"></code>
            </div>
            <button class="icon-btn" type="button" data-action="play" title="プレビュー" aria-label="プレビュー">▶</button>
          </div>
          <div class="pce-cdda-form-grid">
            <label class="form-group">
              <span class="form-label">ID</span>
              <input class="form-input form-input-mono" name="id" />
            </label>
            <label class="form-group">
              <span class="form-label">Track</span>
              <input class="form-input" name="track" type="number" min="2" max="99" />
            </label>
            <label class="form-group pce-cdda-wide">
              <span class="form-label">Name</span>
              <input class="form-input" name="name" />
            </label>
            <label class="form-group">
              <span class="form-label">Loop</span>
              <label class="pce-cdda-check"><input name="loop" type="checkbox" /><span>loop</span></label>
            </label>
          </div>
          <audio controls data-role="preview" hidden></audio>
          <div class="pce-cdda-stats" data-role="stats"></div>
          <div class="pce-cdda-files" data-role="files"></div>
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

  let assets = [];
  let selectedId = '';
  let draggedId = '';
  let importBusy = false;

  function setStatus(message = '', kind = '') {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function trackNumber(asset = {}) {
    return clampTrack(asset.options?.track, 2);
  }

  function cddaAssets() {
    return assets
      .map((asset, index) => ({ asset, index }))
      .filter((entry) => entry.asset.type === 'cdda-track')
      .sort((a, b) => trackNumber(a.asset) - trackNumber(b.asset) || a.index - b.index || a.asset.id.localeCompare(b.asset.id, 'ja'))
      .map((entry) => entry.asset);
  }

  function selectedAsset() {
    return cddaAssets().find((asset) => asset.id === selectedId) || null;
  }

  function nextTrackNumber() {
    const tracks = cddaAssets().map(trackNumber);
    return Math.min(99, Math.max(1, ...tracks) + 1);
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
        // Browser audio policies may still block autoplay; the controls remain available.
      }
    }
  }

  function renderStats(asset) {
    const generated = generatedInfo(asset);
    statsEl.innerHTML = `
      <div><span>Sample rate</span><strong>${esc(generated.sampleRate || 44100)} Hz</strong></div>
      <div><span>Length</span><strong>${esc(formatSeconds(generated.durationSeconds))}</strong></div>
      <div><span>Size</span><strong>${esc(formatBytes(generated.byteLength))}</strong></div>
    `;
    const files = [
      ['audio', generated.outputFile],
      ['source', asset.source],
      ['preview', generated.previewFile],
    ].filter((entry) => entry[1]);
    filesEl.innerHTML = files.length
      ? files.map(([label, file]) => `<div><span>${esc(label)}</span><code>${esc(file)}</code></div>`).join('')
      : '<p class="asset-no-selection-hint">変換結果がありません</p>';
  }

  function fillForm(asset, options = {}) {
    formErrorEl.textContent = '';
    clearPreview();
    emptyDetailEl.hidden = Boolean(asset);
    formEl.hidden = !asset;
    if (!asset) {
      titleEl.textContent = 'CD-DA';
      sourceEl.textContent = '';
      statsEl.innerHTML = '';
      filesEl.innerHTML = '';
      return;
    }
    titleEl.textContent = asset.name || asset.id;
    sourceEl.textContent = asset.source || '';
    formEl.elements.id.value = asset.id || '';
    formEl.elements.name.value = asset.name || asset.id || '';
    formEl.elements.track.value = trackNumber(asset);
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
    const tracks = cddaAssets();
    summaryEl.textContent = tracks.length ? `${tracks.length} tracks` : '0 tracks';
    if (!tracks.length) {
      rowsEl.innerHTML = '<tr><td colspan="6" class="pce-cdda-empty">CD-DA track がありません</td></tr>';
      return;
    }
    rowsEl.innerHTML = tracks.map((asset) => {
      const generated = generatedInfo(asset);
      return `
        <tr class="pce-cdda-row ${asset.id === selectedId ? 'active' : ''}" draggable="true" data-id="${esc(asset.id)}">
          <td class="pce-cdda-drag-cell"><span class="drag-handle" title="並び替え">&#8942;&#8942;</span></td>
          <td><strong>${String(trackNumber(asset)).padStart(2, '0')}</strong></td>
          <td><span>${esc(asset.name || asset.id)}</span><code>${esc(asset.id)}</code></td>
          <td>${esc(formatSeconds(generated.durationSeconds))}</td>
          <td>${asset.options?.loop ? '<span class="pce-cdda-loop">Loop</span>' : '<span class="pce-cdda-muted">-</span>'}</td>
          <td class="pce-cdda-row-actions">
            <button class="icon-btn-xs" type="button" data-row-play="${esc(asset.id)}" title="プレビュー" aria-label="プレビュー">▶</button>
            <button class="icon-btn-xs" type="button" data-row-delete="${esc(asset.id)}" title="削除" aria-label="削除">✕</button>
          </td>
        </tr>
      `;
    }).join('');
    rowsEl.querySelectorAll('.pce-cdda-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target?.closest?.('button')) return;
        selectAsset(row.dataset.id || '');
      });
      row.addEventListener('dragstart', (event) => {
        draggedId = row.dataset.id || '';
        row.classList.add('drag-source');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedId);
      });
      row.addEventListener('dragover', (event) => {
        if (!draggedId || draggedId === row.dataset.id) return;
        event.preventDefault();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (event) => {
        event.preventDefault();
        row.classList.remove('drag-over');
        await moveTrack(draggedId, row.dataset.id || '');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('drag-source');
        rowsEl.querySelectorAll('.drag-over').forEach((entry) => entry.classList.remove('drag-over'));
        draggedId = '';
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
      rowsEl.innerHTML = `<tr><td colspan="6" class="pce-cdda-empty">${esc(result?.error || 'PCE assets を読み込めません')}</td></tr>`;
      return;
    }
    assets = result.assets || [];
    const tracks = cddaAssets();
    if (selectedId && !tracks.some((asset) => asset.id === selectedId)) selectedId = '';
    if (!selectedId && tracks.length) selectedId = tracks[0].id;
    renderRows();
    fillForm(selectedAsset());
  }

  async function saveTrackOrder(order, preferredId = selectedId) {
    if (order.length > 98) throw new Error('CD-DA track は 98 件までです');
    let changed = false;
    for (const [index, asset] of order.entries()) {
      const nextTrack = index + 2;
      if (trackNumber(asset) === nextTrack) continue;
      changed = true;
      const result = await api.electronAPI.upsertAsset({
        ...asset,
        options: {
          ...(asset.options || {}),
          track: nextTrack,
        },
      });
      if (!result?.ok) throw new Error(result?.error || 'トラック順を保存できませんでした');
      assets = result.assets || assets;
    }
    selectedId = preferredId || selectedId;
    if (changed) await reload();
    else {
      renderRows();
      fillForm(selectedAsset());
    }
  }

  async function moveTrack(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    try {
      const order = cddaAssets();
      const from = order.findIndex((asset) => asset.id === sourceId);
      const to = order.findIndex((asset) => asset.id === targetId);
      if (from < 0 || to < 0) return;
      order.splice(to, 0, order.splice(from, 1)[0]);
      await saveTrackOrder(order, sourceId);
      setStatus('トラック順を保存しました', 'ok');
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  function collectFormAsset() {
    const asset = selectedAsset();
    if (!asset) return null;
    const id = safeId(formEl.elements.id.value, asset.id);
    return {
      ...asset,
      id,
      type: 'cdda-track',
      name: String(formEl.elements.name.value || id).trim(),
      options: {
        ...(asset.options || {}),
        track: clampTrack(formEl.elements.track.value, trackNumber(asset)),
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
    await saveTrackOrder(cddaAssets(), selectedId);
    setStatus('保存しました', 'ok');
  }

  function askDelete(assetId) {
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `${plugin.id}-delete-${Date.now()}`,
        panelClassName: 'app-panel app-panel-sm',
        html: `
          <div class="page-header modal-header">
            <h2>CD-DA 削除</h2>
            <button class="icon-btn" type="button" data-decision="cancel">✕</button>
          </div>
          <div class="settings-form compact-form pce-cdda-delete-modal">
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
      const before = cddaAssets();
      const oldIndex = Math.max(0, before.findIndex((asset) => asset.id === assetId));
      const result = await api.electronAPI.deleteAsset(assetId);
      if (!result?.ok) throw new Error(result?.error || '削除できませんでした');
      assets = result.assets || assets;
      const after = cddaAssets();
      selectedId = after[Math.min(oldIndex, after.length - 1)]?.id || '';
      await saveTrackOrder(after, selectedId);
      setStatus('削除しました', 'ok');
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  function openImportSettingsModal(picked) {
    return new Promise((resolve) => {
      const baseName = sourceBasename(picked.fileName || picked.sourcePath).replace(/\.[^.]+$/, '');
      const defaultId = safeId(baseName, 'cdda_track');
      const modal = api.createModal({
        id: `${plugin.id}-import-${Date.now()}`,
        panelClassName: 'app-panel pce-cdda-import-panel',
        html: `
          <div class="page-header modal-header">
            <h2>CD-DA 追加</h2>
            <button class="icon-btn" type="button" data-import-cancel>✕</button>
          </div>
          <form class="settings-form compact-form pce-cdda-import-form">
            <code class="pce-cdda-picked-file">${esc(picked.sourcePath)}</code>
            <div class="pce-cdda-form-grid">
              <label class="form-group">
                <span class="form-label">ID</span>
                <input class="form-input form-input-mono" name="id" value="${esc(defaultId)}" />
              </label>
              <label class="form-group">
                <span class="form-label">Track</span>
                <input class="form-input" name="track" type="number" min="2" max="99" value="${esc(nextTrackNumber())}" />
              </label>
              <label class="form-group pce-cdda-wide">
                <span class="form-label">Name</span>
                <input class="form-input" name="name" value="${esc(baseName)}" />
              </label>
              <label class="form-group">
                <span class="form-label">Loop</span>
                <label class="pce-cdda-check"><input name="loop" type="checkbox" /><span>loop</span></label>
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
        modal.close();
        modal.destroy?.();
        resolve({
          id,
          name: String(form.elements.name.value || id).trim(),
          track: clampTrack(form.elements.track.value, nextTrackNumber()),
          loop: Boolean(form.elements.loop.checked),
        });
      });
      modal.open();
    });
  }

  async function importCddaTrack() {
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
        kind: 'cdda-track',
        picked,
        targetFileName: `${details.id}.wav`,
        defaults: {
          sampleRate: 44100,
          mono: false,
        },
      });
      if (!converted?.ok || !converted.dataUrl) return null;
      const result = await api.electronAPI.importAssetAudio({
        dataUrl: converted.dataUrl,
        sourceFileName: `${details.id}.wav`,
        originalFileName: converted.originalFileName || picked.fileName,
        kind: 'cdda-track',
        id: details.id,
        name: details.name,
        track: details.track,
        loop: details.loop,
        processing: converted.processing || {},
      });
      if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
      assets = result.assets || assets;
      selectedId = result.asset?.id || details.id;
      logger.info(`PCE CD-DA imported: ${selectedId}`);
      await saveTrackOrder(cddaAssets(), selectedId);
      setStatus('追加しました', 'ok');
      return result.asset || null;
    } catch (err) {
      const message = err.message || String(err);
      logger.error(`PCE CD-DA import failed: ${message}`);
      setStatus(message, 'error');
      return null;
    } finally {
      importBusy = false;
    }
  }

  formEl.addEventListener('submit', saveSelected);
  root.querySelector('[data-action="add"]').addEventListener('click', () => { void importCddaTrack(); });
  root.querySelector('[data-action="refresh"]').addEventListener('click', () => { void reload(); });
  root.querySelector('[data-action="play"]').addEventListener('click', () => {
    const asset = selectedAsset();
    if (asset) void loadPreview(asset, { autoplay: true });
  });
  root.querySelector('[data-action="delete"]').addEventListener('click', () => { void deleteAsset(); });

  registerCapability('cdda-manager', {
    pluginId: plugin.id,
    reload,
    importCddaTrack,
  });
  void reload();
  return { deactivate: clearPreview };
}
