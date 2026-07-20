function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function resultKey(entry = {}) {
  return `${Number(entry.lineNumber) || 0}:${String(entry.id || '')}`;
}

export function createAdpcmBatchImporter({ plugin, api, logger }) {
  const assetApi = api.assets || {};
  let modal = null;
  let inspection = null;
  let activeBatchId = '';
  let running = false;

  function progressElements() {
    return {
      progress: modal?.panel?.querySelector?.('[data-batch-progress]'),
      label: modal?.panel?.querySelector?.('[data-batch-progress-label]'),
    };
  }

  function handleProgress(payload = {}) {
    if (!modal || !activeBatchId || payload.batchId !== activeBatchId) return;
    const { progress, label } = progressElements();
    const total = Math.max(1, Number(payload.total) || 1);
    const completed = Math.max(0, Math.min(total, Number(payload.completed) || 0));
    if (progress) {
      progress.max = total;
      progress.value = completed;
    }
    if (label) {
      const id = payload.id ? ` / ${payload.id}` : '';
      label.textContent = `${completed}/${total}${id} ${payload.message || ''}`.trim();
      label.dataset.kind = payload.status === 'failed' ? 'error' : (payload.status === 'success' ? 'ok' : '');
    }
  }

  const offProgress = api.electronAPI.onAssetAdpcmBatchProgress?.(handleProgress) || (() => {});

  function inspectionStatus(row) {
    if (!row.valid) return `<span class="adpcm-batch-status error">${esc(row.errors.join(' / '))}</span>`;
    if (row.overwriteIds?.length) {
      return `<span class="adpcm-batch-status warn">置換: ${esc(row.overwriteIds.join(', '))}</span>`;
    }
    if (row.warnings?.length) return `<span class="adpcm-batch-status warn">${esc(row.warnings.join(' / '))}</span>`;
    return '<span class="adpcm-batch-status ok">取込可能</span>';
  }

  function renderInspectionRows(rows = []) {
    const tbody = modal?.panel?.querySelector?.('[data-batch-rows]');
    if (!tbody) return;
    tbody.innerHTML = rows.map((row) => `
      <tr data-batch-line="${Number(row.lineNumber) || 0}" class="${row.valid ? '' : 'is-error'}">
        <td>${Number(row.lineNumber) || '-'}</td>
        <td><code>${esc(row.id || '-')}</code></td>
        <td title="${esc(row.source)}">${esc(row.source || '-')}</td>
        <td>${Number(row.sampleRate) || '-'} Hz</td>
        <td>${row.estimatedPartCount || '-'} / ${formatBytes(row.estimatedBytes)}</td>
        <td>${inspectionStatus(row)}</td>
      </tr>
    `).join('');
  }

  function renderResults(result = {}) {
    const byKey = new Map((result.results || []).map((entry) => [resultKey(entry), entry]));
    const tbody = modal?.panel?.querySelector?.('[data-batch-rows]');
    if (tbody) {
      tbody.innerHTML = (inspection?.rows || []).map((row) => {
        const entry = byKey.get(resultKey(row));
        let status = inspectionStatus(row);
        let rowClass = row.valid ? '' : 'is-error';
        if (entry?.status === 'success') {
          status = `<span class="adpcm-batch-status ok">登録: ${esc(entry.assetIds.join(', '))}</span>`;
          rowClass = 'is-success';
        } else if (entry?.status === 'failed') {
          status = `<span class="adpcm-batch-status error">${esc(entry.errors.join(' / '))}</span>`;
          rowClass = 'is-error';
        } else if (entry?.status === 'canceled') {
          status = '<span class="adpcm-batch-status warn">未処理</span>';
          rowClass = 'is-canceled';
        }
        return `
          <tr class="${rowClass}">
            <td>${Number(row.lineNumber) || '-'}</td>
            <td><code>${esc(row.id || '-')}</code></td>
            <td title="${esc(row.source)}">${esc(row.source || '-')}</td>
            <td>${Number(row.sampleRate) || '-'} Hz</td>
            <td>${row.estimatedPartCount || '-'} / ${formatBytes(row.estimatedBytes)}</td>
            <td>${status}</td>
          </tr>
        `;
      }).join('');
    }
    const summary = result.summary || {};
    const summaryEl = modal?.panel?.querySelector?.('[data-batch-summary]');
    if (summaryEl) {
      summaryEl.innerHTML = `成功 <strong>${Number(summary.succeededRows) || 0}</strong> 行 / 失敗 <strong>${Number(summary.failedRows) || 0}</strong> 行 / 未処理 <strong>${Number(summary.canceledRows) || 0}</strong> 行 / 登録 <strong>${Number(summary.succeededAssetCount) || 0}</strong> asset`;
    }
    const importButton = modal?.panel?.querySelector?.('[data-batch-import]');
    const cancelButton = modal?.panel?.querySelector?.('[data-batch-cancel-run]');
    const closeButton = modal?.panel?.querySelector?.('[data-batch-close-footer]');
    if (importButton) importButton.hidden = true;
    if (cancelButton) cancelButton.hidden = true;
    if (closeButton) closeButton.textContent = '閉じる';
  }

  async function requestCancel() {
    if (!running || !activeBatchId) return;
    const button = modal?.panel?.querySelector?.('[data-batch-cancel-run]');
    if (button) {
      button.disabled = true;
      button.textContent = 'キャンセル要求済み';
    }
    await assetApi.cancelPceAdpcmBatch?.({ batchId: activeBatchId });
  }

  function closeModal() {
    if (running) {
      void requestCancel();
      return;
    }
    modal?.close?.();
    modal?.destroy?.();
    modal = null;
    inspection = null;
    activeBatchId = '';
  }

  async function runImport() {
    if (running || !inspection || !assetApi.importPceAdpcmBatch) return;
    running = true;
    activeBatchId = `adpcm-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const importButton = modal.panel.querySelector('[data-batch-import]');
    const cancelButton = modal.panel.querySelector('[data-batch-cancel-run]');
    const closeButton = modal.panel.querySelector('[data-batch-close-footer]');
    importButton.disabled = true;
    importButton.textContent = '変換中...';
    cancelButton.hidden = false;
    closeButton.textContent = '実行中';
    closeButton.disabled = true;
    try {
      const result = await assetApi.importPceAdpcmBatch({
        csvPath: inspection.csvPath,
        sourceRoot: inspection.sourceRoot || '',
        batchId: activeBatchId,
      });
      if (!result?.ok) throw new Error(result?.error || 'ADPCM batch importに失敗しました');
      renderResults(result);
      logger.info(`ADPCM CSV batch imported: success=${result.summary?.succeededRows || 0}, failed=${result.summary?.failedRows || 0}`);
    } catch (error) {
      const label = modal?.panel?.querySelector?.('[data-batch-progress-label]');
      if (label) {
        label.textContent = error?.message || String(error);
        label.dataset.kind = 'error';
      }
      importButton.disabled = false;
      importButton.textContent = '有効な行を一括取込';
      logger.error(`ADPCM CSV batch import failed: ${error?.message || error}`);
    } finally {
      running = false;
      activeBatchId = '';
      cancelButton.hidden = true;
      closeButton.disabled = false;
      if (!importButton.hidden) importButton.disabled = false;
    }
  }

  async function reinspectWithSourceRoot(sourceRoot = '') {
    if (running || !inspection) return;
    const label = modal?.panel?.querySelector?.('[data-batch-source-root-error]');
    if (label) label.textContent = '';
    try {
      const inspected = await assetApi.inspectPceAdpcmBatch({
        csvPath: inspection.csvPath,
        sourceRoot,
      });
      if (!inspected?.ok) throw new Error(inspected?.error || 'CSVを再検査できませんでした');
      modal?.close?.();
      modal?.destroy?.();
      modal = null;
      inspection = inspected;
      openInspectionModal();
    } catch (error) {
      if (label) label.textContent = error?.message || String(error);
      logger.error(`ADPCM CSV source root failed: ${error?.message || error}`);
    }
  }

  async function chooseSourceRoot() {
    const picked = await api.electronAPI.pickFile({
      title: 'ADPCM WAVルートフォルダーを選択',
      properties: ['openDirectory'],
    });
    const sourceRoot = picked?.sourcePath || picked?.filePaths?.[0] || '';
    if (picked?.canceled || !sourceRoot) return;
    await reinspectWithSourceRoot(sourceRoot);
  }

  function openInspectionModal() {
    const summary = inspection.summary || {};
    const globalWarnings = (inspection.warnings || []).map((warning) => `<div class="form-hint adpcm-batch-warning">${esc(warning)}</div>`).join('');
    modal = api.createModal({
      id: `${plugin.id}-adpcm-batch-${Date.now()}`,
      panelClassName: 'app-panel adpcm-batch-panel',
      html: `
        <div class="page-header modal-header">
          <div>
            <h2>ADPCM CSV一括取込</h2>
            <code>${esc(inspection.csvPath)}</code>
          </div>
          <button class="icon-btn" type="button" data-batch-close>✕</button>
        </div>
        <div class="adpcm-batch-body">
          <div class="adpcm-batch-summary" data-batch-summary>
            全 ${summary.totalRows || 0} 行 / 取込可能 <strong>${summary.validRows || 0}</strong> / エラー <strong>${summary.invalidRows || 0}</strong> / 生成予定 <strong>${summary.estimatedAssetCount || 0}</strong> asset
          </div>
          <div class="form-hint">既存の同一ID ADPCMは常に置換します。非ADPCMとの衝突は行エラーになります。</div>
          <div class="adpcm-batch-source-root-row">
            <label class="form-group">
              <span class="form-label">WAVルート（任意）</span>
              <input class="form-input" data-batch-source-root value="${esc(inspection.sourceRoot || '')}" readonly placeholder="未指定: CSV所在フォルダー" />
            </label>
            <button class="btn-sm" type="button" data-batch-select-source-root>フォルダー選択</button>
            <button class="btn-sm" type="button" data-batch-clear-source-root ${inspection.sourceRoot ? '' : 'disabled'}>CSV基準へ戻す</button>
          </div>
          <div class="form-error" data-batch-source-root-error></div>
          ${globalWarnings}
          <div class="adpcm-batch-table-wrap">
            <table class="adpcm-batch-table">
              <thead><tr><th>行</th><th>ID</th><th>Source</th><th>Rate</th><th>Parts / Size</th><th>状態</th></tr></thead>
              <tbody data-batch-rows></tbody>
            </table>
          </div>
          <div class="adpcm-batch-progress-row">
            <progress data-batch-progress max="${Math.max(1, summary.totalRows || 1)}" value="0"></progress>
            <div data-batch-progress-label></div>
          </div>
          <div class="form-actions-inline modal-actions-end">
            <button class="btn-sm" type="button" data-batch-cancel-run hidden>残りをキャンセル</button>
            <button class="btn-sm" type="button" data-batch-close-footer>閉じる</button>
            <button class="btn-primary" type="button" data-batch-import ${summary.validRows > 0 ? '' : 'disabled'}>有効な行を一括取込</button>
          </div>
        </div>
      `,
    });
    renderInspectionRows(inspection.rows);
    modal.panel.querySelectorAll('[data-batch-close], [data-batch-close-footer]').forEach((button) => {
      button.addEventListener('click', closeModal);
    });
    modal.panel.querySelector('[data-batch-import]').addEventListener('click', () => { void runImport(); });
    modal.panel.querySelector('[data-batch-cancel-run]').addEventListener('click', () => { void requestCancel(); });
    modal.panel.querySelector('[data-batch-select-source-root]').addEventListener('click', () => { void chooseSourceRoot(); });
    modal.panel.querySelector('[data-batch-clear-source-root]').addEventListener('click', () => { void reinspectWithSourceRoot(''); });
    modal.open();
  }

  async function open() {
    if (running) return null;
    if (!assetApi.inspectPceAdpcmBatch || !assetApi.importPceAdpcmBatch || !assetApi.cancelPceAdpcmBatch) {
      throw new Error('ADPCM CSV batch APIが利用できません');
    }
    const picked = await api.electronAPI.pickFile({
      title: 'ADPCM batch CSVを選択',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    const csvPath = picked?.sourcePath || picked?.filePaths?.[0] || '';
    if (picked?.canceled || !csvPath) return null;
    const inspected = await assetApi.inspectPceAdpcmBatch({ csvPath });
    if (!inspected?.ok) throw new Error(inspected?.error || 'CSVを検査できませんでした');
    inspection = inspected;
    openInspectionModal();
    return inspected;
  }

  return {
    open,
    destroy() {
      if (running) void requestCancel();
      offProgress();
      modal?.destroy?.();
      modal = null;
      inspection = null;
      activeBatchId = '';
    },
  };
}
