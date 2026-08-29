const PLUGIN_ID = 'pce-vn-project-merger';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function pickedPath(result) {
  return String(result?.sourcePath || result?.filePath || result?.filePaths?.[0] || '').trim();
}

function parentPath(value) {
  return String(value || '').replace(/[\\/][^\\/]+[\\/]?$/, '');
}

function baseName(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || 'merged-vn';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function activatePlugin({ plugin, api, logger, registerCapability }) {
  let activeSession = null;

  const invoke = async (hook, payload) => {
    const response = await api.plugins.invokeHook(plugin.id, hook, payload);
    if (!response?.ok) throw new Error(response?.error || `${hook} に失敗しました`);
    const result = response.result && typeof response.result === 'object' ? response.result : response;
    if (!result?.ok) {
      const error = new Error(result?.error || result?.errors?.[0]?.message || `${hook} に失敗しました`);
      error.result = result;
      throw error;
    }
    return result;
  };

  const openMerger = async (editor = {}) => {
    if (activeSession) {
      activeSession.modal.open();
      return activeSession.promise;
    }
    if (typeof editor.getSnapshot !== 'function' || typeof editor.saveSnapshot !== 'function') {
      throw new Error('Novel editorのsnapshot APIが不足しています');
    }
    const context = await invoke('inspectVnProjectMerge', { contextOnly: true });
    const currentProject = String(context.currentProject || '').trim();
    if (!currentProject) throw new Error('現在のproject directoryを取得できません');

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const modal = api.createModal({
      id: `${PLUGIN_ID}-modal-${Date.now()}`,
      panelClassName: 'app-panel pce-vn-merge-panel',
      labelledBy: 'pce-vn-merge-title',
    });
    const state = {
      busy: false,
      projects: [currentProject],
      outputParent: parentPath(currentProject),
      outputName: `${baseName(currentProject)}_merged`,
      title: '',
      replace: false,
      inspection: null,
      status: '',
      statusLevel: '',
    };
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKeyDown);
      modal.close();
      modal.destroy?.();
      activeSession = null;
      resolvePromise(result);
    };
    const cancel = () => {
      logger?.info?.('VN project結合をキャンセルしました。');
      finish({ ok: false, canceled: true });
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !state.busy) cancel();
    };
    const invalidate = (message = '設定を変更しました。再検査してください。') => {
      state.inspection = null;
      state.status = message;
      state.statusLevel = 'info';
      const applyButton = modal.panel.querySelector('[data-action="apply"]');
      if (applyButton) applyButton.disabled = true;
      const status = modal.panel.querySelector('.pce-vn-merge-status');
      if (status) {
        status.textContent = state.status;
        status.dataset.level = state.statusLevel;
      }
    };
    const payload = () => ({
      projects: [...state.projects],
      outputParent: state.outputParent,
      outputName: state.outputName,
      title: state.title,
      replace: state.replace,
    });
    const diagnosticsHtml = () => {
      if (!state.inspection) return '<p class="pce-vn-merge-empty">「検査」を実行してください。</p>';
      const rows = list(state.inspection.diagnostics);
      if (!rows.length) return '<p class="pce-vn-merge-ok">エラー・警告はありません。</p>';
      return rows.map((entry) => (
        `<p class="pce-vn-merge-diagnostic" data-severity="${esc(entry.severity)}"><strong>${esc(entry.code)}</strong> ${esc(entry.message)}</p>`
      )).join('');
    };
    const summaryHtml = () => {
      const counts = state.inspection?.counts;
      if (!counts) return '';
      const types = Object.entries(counts.assetTypes || {}).map(([type, count]) => `${esc(type)} ${esc(count)}`).join(' / ');
      return `<div class="pce-vn-merge-summary"><strong>Scene ${esc(counts.scenes)} / Asset ${esc(counts.assets)}</strong><span>${types}</span><span>Copy ${esc(counts.copiedFiles)} files / ${esc(counts.copiedBytes)} bytes</span></div>`;
    };
    const projectRows = () => state.projects.map((projectPath, index) => `
      <div class="pce-vn-merge-project-row" data-project-index="${index}">
        <span class="pce-vn-merge-order">${index + 1}</span>
        <input type="text" value="${esc(projectPath)}" readonly title="${esc(projectPath)}">
        <button type="button" class="btn-sm" data-action="up" ${index === 0 || index === 1 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn-sm" data-action="down" ${index === 0 || index === state.projects.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn-sm" data-action="remove" ${index === 0 ? 'disabled' : ''}>削除</button>
      </div>
    `).join('');

    const render = () => {
      modal.panel.innerHTML = `
        <div class="pce-vn-merge-layout">
          <header><h2 id="pce-vn-merge-title">プロジェクト結合</h2><p>入力順にNEXT_SCR / PREV_SCRを輪状接続し、CD-ROM2 VN projectを生成します。</p></header>
          <section>
            <div class="pce-vn-merge-heading"><strong>入力project</strong><button type="button" class="btn-sm" data-action="add">追加</button></div>
            <div class="pce-vn-merge-projects">${projectRows()}</div>
          </section>
          <section class="pce-vn-merge-form">
            <label><span>出力親folder</span><span class="pce-vn-merge-field"><input data-field="outputParent" value="${esc(state.outputParent)}" readonly><button type="button" class="btn-sm" data-action="pick-output">選択</button></span></label>
            <label><span>出力名</span><input data-field="outputName" value="${esc(state.outputName)}" maxlength="120"></label>
            <label><span>タイトル（空欄は出力名）</span><input data-field="title" value="${esc(state.title)}" maxlength="120"></label>
            <label class="pce-vn-merge-check"><input data-field="replace" type="checkbox"${state.replace ? ' checked' : ''}><span>既存の所有merge出力を置換</span></label>
          </section>
          ${summaryHtml()}
          <section class="pce-vn-merge-diagnostics">${diagnosticsHtml()}</section>
          <p class="pce-vn-merge-status" data-level="${esc(state.statusLevel)}">${esc(state.status)}</p>
          <footer>
            <button type="button" class="btn-sm" data-action="cancel" ${state.busy ? 'disabled' : ''}>キャンセル</button>
            <button type="button" class="btn-sm" data-action="inspect" ${state.busy ? 'disabled' : ''}>検査</button>
            <button type="button" class="btn-primary" data-action="apply" ${state.busy || !state.inspection?.ok ? 'disabled' : ''}>結合</button>
          </footer>
        </div>
      `;
    };

    const inspect = async () => {
      if (state.projects.length < 2) {
        state.status = '入力projectを2件以上指定してください。';
        state.statusLevel = 'error';
        render();
        return;
      }
      state.busy = true;
      state.status = '現在のVN編集内容を保存し、入力を検査しています…';
      state.statusLevel = 'info';
      render();
      try {
        const snapshot = await editor.getSnapshot({ refreshAssets: true });
        await editor.saveSnapshot(snapshot);
        state.inspection = await invoke('inspectVnProjectMerge', payload());
        state.status = `検査完了: ${state.inspection.counts.scenes} scenes / ${state.inspection.counts.assets} assets`;
        state.statusLevel = state.inspection.warnings?.length ? 'warning' : 'success';
        logger?.info?.(`VN project結合検査完了: ${state.status}`);
      } catch (error) {
        state.inspection = error.result || null;
        state.status = `検査失敗: ${error.message || error}`;
        state.statusLevel = 'error';
        logger?.error?.(state.status);
      } finally {
        state.busy = false;
        render();
      }
    };

    const apply = async () => {
      if (!state.inspection?.signature) return;
      state.busy = true;
      state.status = '一時directoryで生成・build検査しています…';
      state.statusLevel = 'info';
      render();
      try {
        const result = await invoke('applyVnProjectMerge', {
          ...payload(),
          signature: state.inspection.signature,
        });
        const message = `VN projectを結合しました: ${result.outputDir} (Scene ${result.counts.scenes} / Asset ${result.counts.assets})`;
        logger?.info?.(message);
        finish({ ok: true, message, outputDir: result.outputDir });
      } catch (error) {
        state.inspection = null;
        state.status = `結合失敗: ${error.message || error}`;
        state.statusLevel = 'error';
        logger?.error?.(state.status);
        state.busy = false;
        render();
      }
    };

    modal.panel.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-action]');
      if (!button || state.busy) return;
      const action = button.dataset.action;
      if (action === 'cancel') cancel();
      else if (action === 'add') {
        const picked = await api.electronAPI.pickFile({ title: '追加するPCE VN project', properties: ['openDirectory'] });
        const selected = pickedPath(picked);
        if (selected) {
          state.projects.push(selected);
          invalidate();
          render();
        }
      } else if (action === 'pick-output') {
        const picked = await api.electronAPI.pickFile({ title: '出力親folder', properties: ['openDirectory'] });
        const selected = pickedPath(picked);
        if (selected) {
          state.outputParent = selected;
          invalidate();
          render();
        }
      } else if (action === 'inspect') await inspect();
      else if (action === 'apply') await apply();
      else {
        const row = button.closest('[data-project-index]');
        const index = Number(row?.dataset.projectIndex);
        if (!Number.isInteger(index) || index <= 0) return;
        if (action === 'remove') state.projects.splice(index, 1);
        else if (action === 'up' && index > 1) [state.projects[index - 1], state.projects[index]] = [state.projects[index], state.projects[index - 1]];
        else if (action === 'down' && index < state.projects.length - 1) [state.projects[index + 1], state.projects[index]] = [state.projects[index], state.projects[index + 1]];
        invalidate();
        render();
      }
    });
    modal.panel.addEventListener('input', (event) => {
      const field = event.target?.dataset?.field;
      if (field === 'outputName' || field === 'title') {
        state[field] = event.target.value;
        invalidate();
      } else if (field === 'replace') {
        state.replace = Boolean(event.target.checked);
        invalidate();
      }
    });
    window.addEventListener('keydown', onKeyDown);
    render();
    modal.open();
    activeSession = { modal, promise };
    return promise;
  };

  registerCapability('vn-project-merger', {
    pluginId: plugin.id,
    label: 'プロジェクト結合',
    open: openMerger,
  });
  registerCapability('novel-toolbar-action', {
    id: 'vn-project-merge',
    pluginId: plugin.id,
    label: 'プロジェクト結合',
    title: '複数のCD-ROM2 VN projectを名前空間付きで結合',
    priority: 100,
    order: 10,
    placement: 'after-preview',
    supportedTargetMedia: ['cd'],
    run: openMerger,
  });
}
