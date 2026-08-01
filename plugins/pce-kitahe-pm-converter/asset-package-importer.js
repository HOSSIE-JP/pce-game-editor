const PLUGIN_ID = 'pce-kitahe-pm-converter';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fileName(value) {
  return String(value || '').split(/[\\/]/).pop() || '';
}

function diagnosticText(entry) {
  if (typeof entry === 'string') return entry;
  return String(entry?.message || entry?.reason || entry?.code || '診断');
}

function diagnosticLevel(entry) {
  const value = String(entry?.severity || entry?.level || 'warning').toLowerCase();
  return value === 'error' || value === 'fatal' ? 'error' : (value === 'info' ? 'info' : 'warning');
}

function rowKey(row, index) {
  return `${Number(row?.lineNumber || row?.row || index + 2)}:${String(row?.sourceKey || row?.id || index)}`;
}

function targetLabel(row) {
  const labels = {
    background: 'BG',
    sprite: 'Sprite',
    adpcm: 'ADPCM',
    'psg-song': 'PSG Song',
  };
  return labels[row?.targetType] || String(row?.targetType || '-');
}

function rowPreviewHtml(row) {
  const preview = row?.preview || {};
  const dataUrl = String(preview.dataUrl || '');
  if (row?.kind === 'image') {
    return `
      <div class="pce-kitahe-package-thumb">
        ${dataUrl ? `<img src="${esc(dataUrl)}" alt="${esc(row.name || row.id || '画像')}" />` : '<span>PNG</span>'}
      </div>
      <small>${esc(preview.width || row?.details?.width || '-')} × ${esc(preview.height || row?.details?.height || '-')} px</small>
    `;
  }
  if (row?.kind === 'p04') {
    const previewWarnings = asArray(preview.warnings);
    const sourceRate = Number(preview.sourceSampleRate || preview.playbackRate || 0);
    const targetRate = Number(preview.sampleRate || row.sampleRate || 0);
    const rateText = sourceRate && targetRate && sourceRate !== targetRate
      ? `${sourceRate}→${targetRate} Hz`
      : `${targetRate || sourceRate || '-'} Hz`;
    const encodedBytes = preview.encodedAdpcmBytes ?? preview.estimatedAdpcmBytes;
    const p04Details = [
      preview.durationSeconds == null ? '' : `${Number(preview.durationSeconds).toFixed(2)} sec`,
      rateText,
      preview.channels ? `${preview.channels} ch` : '',
      encodedBytes == null ? '' : `ADPCM ${encodedBytes} bytes`,
    ].filter(Boolean).join(' / ');
    return `
      ${dataUrl ? `<audio controls preload="metadata" src="${esc(dataUrl)}"></audio>` : '<span class="pce-kitahe-package-file-badge">WAV</span>'}
      <small>${esc(p04Details)}</small>
      ${previewWarnings.length ? `
        <div class="pce-kitahe-package-preview-notes">
          ${previewWarnings.map((entry) => `<small>INFO: ${esc(diagnosticText(entry))}</small>`).join('')}
        </div>
      ` : ''}
    `;
  }
  const midiPreview = preview.stats || preview.conversion?.stats || preview.conversion?.summary || preview.conversion || {};
  const bpm = preview.bpm ?? midiPreview.bpm;
  const steps = preview.steps ?? preview.stepCount ?? midiPreview.steps ?? midiPreview.stepCount;
  const patternCount = preview.patternCount ?? midiPreview.patternCount;
  const channelCount = preview.channelCount ?? midiPreview.channelCount;
  const midiDetails = [
    bpm ? `${bpm} BPM` : '',
    steps ? `${steps} steps` : '',
    patternCount ? `${patternCount} patterns` : '',
    channelCount ? `${channelCount} ch` : '',
  ].filter(Boolean).join(' / ');
  return `
    <span class="pce-kitahe-package-file-badge">MIDI → PSG</span>
    <small>${esc(midiDetails || `${preview.byteLength || '-'} bytes`)}</small>
  `;
}

function rowDiagnosticsHtml(row) {
  const errors = asArray(row?.errors);
  const warnings = asArray(row?.warnings);
  if (!errors.length && !warnings.length) return '';
  return `
    <div class="pce-kitahe-package-row-diagnostics">
      ${errors.map((entry) => `<p data-level="error">ERROR: ${esc(diagnosticText(entry))}</p>`).join('')}
      ${warnings.map((entry) => `<p data-level="warning">WARN: ${esc(diagnosticText(entry))}</p>`).join('')}
    </div>
  `;
}

function blockingErrorCount(inspection) {
  const summaryCount = Number(inspection?.summary?.errorCount);
  if (Number.isFinite(summaryCount)) return Math.max(0, summaryCount);
  const rowErrors = asArray(inspection?.rows).reduce((total, row) => total + asArray(row?.errors).length, 0);
  const diagnostics = asArray(inspection?.diagnostics).filter((entry) => diagnosticLevel(entry) === 'error').length;
  return Math.max(rowErrors, diagnostics);
}

function warningCount(inspection) {
  const summaryCount = Number(inspection?.summary?.warningCount);
  if (Number.isFinite(summaryCount)) return Math.max(0, summaryCount);
  const rowWarnings = asArray(inspection?.rows).reduce((total, row) => total + asArray(row?.warnings).length, 0);
  const diagnostics = asArray(inspection?.diagnostics).filter((entry) => diagnosticLevel(entry) === 'warning').length;
  return Math.max(rowWarnings, diagnostics);
}

function packageRowsHtml(state) {
  const rows = asArray(state.inspection?.rows);
  if (!rows.length) return '<p class="pce-kitahe-empty">取込対象はありません。</p>';
  return `
    <div class="pce-kitahe-package-list">
      ${rows.map((row, index) => {
        const key = rowKey(row, index);
        const imported = state.importResults.get(key);
        const level = asArray(row.errors).length ? 'error' : (asArray(row.warnings).length ? 'warning' : 'ok');
        const action = row.action === 'update' || row.existingAssetId
          ? `更新: ${row.existingAssetId || row.id}`
          : `新規: ${row.id}`;
        return `
          <article class="pce-kitahe-package-row" data-level="${level}" data-import-status="${esc(imported?.status || '')}">
            <div class="pce-kitahe-package-preview">${rowPreviewHtml(row)}</div>
            <div class="pce-kitahe-package-main">
              <header>
                <strong>${esc(row.name || row.id || row.source)}</strong>
                <span>${esc(targetLabel(row))}</span>
              </header>
              <code>${esc(row.file || row.source || '')}</code>
              <dl>
                <dt>ID</dt><dd>${esc(row.id || '-')}</dd>
                <dt>sourceKey</dt><dd><code>${esc(row.sourceKey || '-')}</code></dd>
                <dt>登録</dt><dd>${esc(action)}</dd>
              </dl>
              ${rowDiagnosticsHtml(row)}
              ${imported ? `<p class="pce-kitahe-package-result" data-level="${imported.status === 'failed' ? 'error' : 'ok'}">${esc(imported.message)}</p>` : ''}
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function render(modal, state) {
  const previousScrollTop = modal.panel.querySelector('.pce-kitahe-package-list')?.scrollTop || 0;
  const summary = state.inspection?.summary || {};
  const errors = blockingErrorCount(state.inspection);
  const warnings = warningCount(state.inspection);
  const canImport = state.targetMedia === 'cd'
    && state.inspection
    && asArray(state.inspection.rows).length > 0
    && errors === 0
    && (warnings === 0 || state.warningConfirmed)
    && !state.busy
    && !state.completed;
  modal.panel.innerHTML = `
    <div class="page-header modal-header">
      <div>
        <h2 id="pce-kitahe-package-title">北へ。PM素材 一括取込</h2>
        <p>Viewerで確定したBG / Sprite / ADPCM / PSG素材をCD-ROM2 projectへ登録します。</p>
      </div>
      <button class="icon-btn" type="button" data-package-action="close" ${state.busy ? 'disabled' : ''}>✕</button>
    </div>
    <div class="pce-kitahe-package-toolbar">
      <button class="btn-sm" type="button" data-package-action="pick" ${state.busy || state.targetMedia !== 'cd' ? 'disabled' : ''}>manifestを選択</button>
      <code title="${esc(state.manifestPath)}">${esc(state.manifestPath || 'kitahe-pm-assets.csv を選択してください')}</code>
    </div>
    ${state.targetMedia !== 'cd' ? '<div class="form-error">北へ。PM素材の一括取込はCD-ROM2 project専用です。</div>' : ''}
    ${state.inspection ? `
      <div class="pce-kitahe-package-summary">
        <span>全 ${esc(summary.total ?? asArray(state.inspection.rows).length)}</span>
        <span>新規 ${esc(summary.create ?? 0)}</span>
        <span>更新 ${esc(summary.update ?? 0)}</span>
        <span>警告 ${esc(summary.warning ?? 0)}</span>
        <span data-level="${errors ? 'error' : 'ok'}">エラー ${esc(errors)}</span>
      </div>
      ${packageRowsHtml(state)}
      ${warnings ? `<label class="pce-kitahe-check pce-kitahe-warning-check pce-kitahe-package-warning-confirm">
        <input type="checkbox" data-package-confirm-warnings ${state.warningConfirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''} />
        <span>${warnings}件の警告を確認し、この内容で登録します</span>
      </label>` : ''}
    ` : '<div class="pce-kitahe-empty pce-kitahe-package-empty">manifestはまだ検査されていません。</div>'}
    <div class="form-error pce-kitahe-package-status" data-level="${esc(state.statusLevel)}">${esc(state.status)}</div>
    <div class="form-actions-inline modal-actions-end">
      ${state.busy ? '<button class="btn-sm" type="button" data-package-action="cancel-rest">残りをキャンセル</button>' : ''}
      <button class="btn-sm" type="button" data-package-action="close" ${state.busy ? 'disabled' : ''}>${state.completed ? '閉じる' : 'キャンセル'}</button>
      <button class="btn-primary" type="button" data-package-action="import" ${canImport ? '' : 'disabled'}>一括登録</button>
    </div>
  `;
  const nextList = modal.panel.querySelector('.pce-kitahe-package-list');
  if (nextList) nextList.scrollTop = previousScrollTop;
}

function spriteCell(details = {}) {
  const raw = details.spriteCell || details.cellSize || details.cell || {};
  if (typeof raw === 'string') {
    const matched = raw.match(/^(16|32)x(16|32|64)$/i);
    if (matched) return { width: Number(matched[1]), height: Number(matched[2]) };
  }
  const width = Number(raw.width || raw.cellWidth || details.cellWidth || 16);
  const height = Number(raw.height || raw.cellHeight || details.cellHeight || 16);
  return { width, height };
}

function provenance(row, inspection) {
  return {
    version: Number(inspection?.version || 1),
    sourceKey: String(row.sourceKey || ''),
    kind: String(row.kind || ''),
    source: String(row.source || ''),
    manifestFileName: String(inspection?.manifestFileName || fileName(inspection?.manifestPath)),
    row: Number(row.lineNumber || row.row || 0),
  };
}

async function importPackageRow(api, inspection, row) {
  const common = {
    sourcePath: row.filePath,
    sourceFileName: fileName(row.file),
    id: row.id,
    name: row.name,
    replacePolicy: 'owned-source-key',
    kitahePm: provenance(row, inspection),
  };
  if (row.kind === 'image') {
    const kind = row.targetType === 'sprite' ? 'sprite' : 'background';
    const cell = spriteCell(row.details || {});
    return api.assets.importPceImage({
      ...common,
      kind,
      width: Number(row.preview?.width || row.details?.width || 0),
      height: Number(row.preview?.height || row.details?.height || 0),
      cellWidth: kind === 'sprite' ? cell.width : undefined,
      cellHeight: kind === 'sprite' ? cell.height : undefined,
      transparentIndex: kind === 'sprite' ? Number(row.details?.transparentIndex || 0) : 0,
    });
  }
  if (row.kind === 'p04') {
    return api.assets.importPceAudio({
      ...common,
      kind: 'adpcm',
      sampleRate: Number(row.sampleRate || 8000),
      loop: Boolean(row.loop),
      splitPolicy: '',
      rejectOversize: true,
    });
  }
  if (row.kind === 'midi') {
    return api.assets.importPceMidi({
      ...common,
      type: 'psg-song',
      bpm: row.details?.bpm || '',
      midiOptions: row.details?.midiOptions || {},
    });
  }
  throw new Error(`未対応のmanifest kindです: ${row.kind}`);
}

export function createKitahePmAssetPackageImporter({ plugin, api, logger, invoke }) {
  let activeSession = null;

  const open = (options = {}) => {
    if (activeSession) {
      activeSession.modal.open();
      return activeSession.promise;
    }
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const modal = api.createModal({
      id: `${plugin?.id || PLUGIN_ID}-asset-package-${Date.now()}`,
      panelClassName: 'app-panel pce-kitahe-package-panel',
      labelledBy: 'pce-kitahe-package-title',
    });
    const state = {
      targetMedia: String(options.targetMedia || '').toLowerCase(),
      manifestPath: '',
      inspection: null,
      busy: false,
      cancelRequested: false,
      completed: false,
      warningConfirmed: false,
      status: '',
      statusLevel: '',
      importResults: new Map(),
      summary: { succeeded: 0, failed: 0, unprocessed: 0 },
    };
    let settled = false;

    const finish = (result = {}) => {
      if (settled) return;
      settled = true;
      modal.close();
      modal.destroy?.();
      activeSession = null;
      resolvePromise(result);
    };

    const inspect = async (manifestPath, expectedCatalogSignature = '') => {
      const inspected = await invoke('inspectKitahePmAssetPackage', {
        manifestPath,
        targetMedia: state.targetMedia,
        assetCatalogSignature: expectedCatalogSignature || undefined,
      });
      if (!inspected?.ok) {
        throw new Error(inspected?.error || 'manifest検査に失敗しました');
      }
      state.manifestPath = inspected.manifestPath || manifestPath;
      state.inspection = inspected;
      return inspected;
    };

    const pickManifest = async () => {
      const picked = await api.electronAPI.pickFile({
        title: 'kitahe-pm-assets.csv を選択',
        properties: ['openFile'],
        filters: [{ name: '北へ。PM asset manifest', extensions: ['csv'] }],
      });
      const selected = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
      if (picked?.canceled || !selected) return;
      state.busy = true;
      state.status = 'manifestと素材を検査しています…';
      state.statusLevel = '';
      state.completed = false;
      state.warningConfirmed = false;
      state.importResults.clear();
      render(modal, state);
      try {
        await inspect(selected);
        state.status = blockingErrorCount(state.inspection)
          ? 'エラーを修正してViewerからpackageを再出力してください。'
          : '検査が完了しました。登録内容を確認してください。';
        state.statusLevel = blockingErrorCount(state.inspection) ? 'error' : 'ok';
        logger?.info?.(`北へ。PM素材検査: ${asArray(state.inspection?.rows).length}件`);
      } catch (error) {
        state.inspection = null;
        state.status = `manifest検査失敗: ${error?.message || error}`;
        state.statusLevel = 'error';
        logger?.error?.(state.status);
      } finally {
        state.busy = false;
        render(modal, state);
      }
    };

    const runImport = async () => {
      if (!state.inspection || blockingErrorCount(state.inspection)) return;
      if (warningCount(state.inspection) && !state.warningConfirmed) return;
      state.busy = true;
      state.cancelRequested = false;
      state.completed = false;
      state.status = '実行直前のsignatureを再検査しています…';
      state.statusLevel = '';
      state.importResults.clear();
      render(modal, state);
      try {
        const previousSignature = String(state.inspection.inspectionSignature || '');
        const fresh = await inspect(state.manifestPath, state.inspection.assetCatalogSignature || '');
        if (!previousSignature || String(fresh.inspectionSignature || '') !== previousSignature) {
          state.warningConfirmed = false;
          throw new Error('manifest・素材・asset catalogがpreview後に変更されました。最新結果を確認して再実行してください。');
        }
        if (blockingErrorCount(fresh)) throw new Error('実行直前検査でエラーが見つかりました。');
        const rows = asArray(fresh.rows);
        let succeeded = 0;
        let failed = 0;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const key = rowKey(row, index);
          state.status = `${index + 1} / ${rows.length}: ${row.name || row.id || row.file} を登録中…`;
          render(modal, state);
          try {
            const result = await importPackageRow(api, fresh, row);
            if (!result?.ok) throw new Error(result?.error || 'assetを登録できませんでした');
            succeeded += 1;
            state.importResults.set(key, { status: 'succeeded', message: `登録完了: ${result.asset?.id || row.id}` });
          } catch (error) {
            failed += 1;
            const message = error?.message || String(error);
            state.importResults.set(key, { status: 'failed', message });
            logger?.error?.(`北へ。PM素材 ${row.file || row.source}: ${message}`);
          }
          if (state.cancelRequested) break;
        }
        const processed = succeeded + failed;
        state.summary = { succeeded, failed, unprocessed: Math.max(0, rows.length - processed) };
        state.completed = true;
        state.status = state.cancelRequested
          ? `キャンセルしました。成功 ${succeeded} / 失敗 ${failed} / 未処理 ${state.summary.unprocessed}`
          : `一括登録完了: 成功 ${succeeded} / 失敗 ${failed}`;
        state.statusLevel = failed ? 'warning' : 'ok';
        logger?.[failed ? 'warn' : 'info']?.(state.status);
        await options.reload?.();
      } catch (error) {
        state.status = `一括登録を開始できません: ${error?.message || error}`;
        state.statusLevel = 'error';
        logger?.error?.(state.status);
      } finally {
        state.busy = false;
        render(modal, state);
      }
    };

    modal.panel.addEventListener('click', (event) => {
      const action = event.target?.closest?.('[data-package-action]')?.dataset?.packageAction;
      if (action === 'pick') void pickManifest();
      else if (action === 'import') void runImport();
      else if (action === 'cancel-rest' && state.busy) {
        state.cancelRequested = true;
        state.status = '現在行の完了後に残りをキャンセルします…';
        state.statusLevel = 'warning';
        render(modal, state);
      } else if (action === 'close' && !state.busy) {
        finish({
          ok: state.summary.succeeded > 0,
          canceled: !state.completed || state.cancelRequested,
          summary: state.summary,
        });
      }
    });

    modal.panel.addEventListener('change', (event) => {
      const target = event.target;
      if (target?.matches?.('[data-package-confirm-warnings]')) {
        state.warningConfirmed = Boolean(target.checked);
        render(modal, state);
      }
    });

    modal.modal.querySelector('[data-modal-close]')?.addEventListener('click', () => {
      if (!state.busy) finish({ ok: state.summary.succeeded > 0, canceled: true, summary: state.summary });
    });
    activeSession = { modal, promise, finish };
    render(modal, state);
    modal.open();
    return promise;
  };

  return {
    open,
    destroy() {
      activeSession?.finish?.({ ok: false, canceled: true });
      activeSession = null;
    },
  };
}
