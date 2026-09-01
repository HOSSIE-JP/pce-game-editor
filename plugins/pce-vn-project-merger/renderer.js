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

function projectPathKey(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function filterMergeCandidates(candidates, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return list(candidates);
  return list(candidates).filter((candidate) => (
    `${candidate?.relativePath || ''}\n${candidate?.title || ''}`.toLocaleLowerCase().includes(needle)
  ));
}

export function mergeVisibleSelection(selected, visibleCandidates, allCandidates, preserveOrder = false) {
  const selectedKeys = new Set(list(selected).map(projectPathKey));
  const additions = list(visibleCandidates)
    .filter((candidate) => candidate?.eligible && !selectedKeys.has(projectPathKey(candidate.path)))
    .map((candidate) => candidate.path);
  if (preserveOrder) return [...list(selected), ...additions];
  const wanted = new Set([...list(selected), ...additions].map(projectPathKey));
  return list(allCandidates)
    .filter((candidate) => candidate?.eligible && wanted.has(projectPathKey(candidate.path)))
    .map((candidate) => candidate.path);
}

export function moveMergeSelection(selected, index, delta) {
  const result = [...list(selected)];
  const target = index + delta;
  if (!Number.isInteger(index) || !Number.isInteger(target)
    || index < 0 || index >= result.length || target < 0 || target >= result.length) return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
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
    const initialRoot = parentPath(currentProject);
    const state = {
      busy: false,
      scanning: false,
      scanToken: 0,
      root: initialRoot,
      candidates: [],
      filter: '',
      projects: [],
      orderCustomized: false,
      outputParent: initialRoot,
      outputName: `${baseName(initialRoot)}_merged`,
      outputNameEdited: false,
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
      state.scanToken += 1;
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
    };
    const payload = () => ({
      root: state.root,
      projects: [...state.projects],
      outputParent: state.outputParent,
      outputName: state.outputName,
      title: state.title,
      replace: state.replace,
    });
    const candidateByPath = (projectPath) => state.candidates.find((candidate) => (
      projectPathKey(candidate.path) === projectPathKey(projectPath)
    ));
    const isSelected = (projectPath) => state.projects.some((entry) => (
      projectPathKey(entry) === projectPathKey(projectPath)
    ));
    const visibleCandidates = () => filterMergeCandidates(state.candidates, state.filter);

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
    const candidateRows = () => {
      const rows = visibleCandidates();
      if (!rows.length) return '<p class="pce-vn-merge-empty">該当するprojectはありません。</p>';
      return rows.map((candidate) => {
        const reasons = list(candidate.reasons).map((reason) => reason.message).join(' / ');
        return `
          <label class="pce-vn-merge-candidate" data-eligible="${candidate.eligible ? 'true' : 'false'}" title="${esc(reasons || candidate.path)}">
            <input type="checkbox" data-project-path="${esc(candidate.path)}"${isSelected(candidate.path) ? ' checked' : ''}${candidate.eligible ? '' : ' disabled'}>
            <span class="pce-vn-merge-candidate-copy"><strong>${esc(candidate.title)}</strong><span>${esc(candidate.relativePath)}</span>${reasons ? `<small>${esc(reasons)}</small>` : ''}</span>
          </label>`;
      }).join('');
    };
    const selectedRows = () => {
      if (!state.projects.length) return '<p class="pce-vn-merge-empty">projectを2件以上選択してください。</p>';
      return state.projects.map((projectPath, index) => {
        const candidate = candidateByPath(projectPath);
        return `
          <div class="pce-vn-merge-selected-row" data-project-index="${index}">
            <span class="pce-vn-merge-order">${index + 1}</span>
            <span class="pce-vn-merge-selected-copy"><strong>${esc(candidate?.title || baseName(projectPath))}</strong><span>${esc(candidate?.relativePath || projectPath)}</span></span>
            <button type="button" class="btn-sm" data-action="up" ${index === 0 ? 'disabled' : ''} title="前へ">↑</button>
            <button type="button" class="btn-sm" data-action="down" ${index === state.projects.length - 1 ? 'disabled' : ''} title="後へ">↓</button>
            <button type="button" class="btn-sm" data-action="remove" title="選択解除">解除</button>
          </div>`;
      }).join('');
    };

    const render = (focusField = '') => {
      const eligibleCount = state.candidates.filter((candidate) => candidate.eligible).length;
      const visibleCount = visibleCandidates().length;
      const locked = state.busy || state.scanning;
      modal.panel.innerHTML = `
        <div class="pce-vn-merge-layout">
          <header><h2 id="pce-vn-merge-title">プロジェクト結合</h2><p>root配下から選択した順にNEXT_SCR / PREV_SCRを輪状接続し、各選択sceneへ(n/N)を追加します。</p></header>
          <section class="pce-vn-merge-root">
            <label><span>project root</span><span class="pce-vn-merge-field"><input value="${esc(state.root)}" readonly><button type="button" class="btn-sm" data-action="pick-root" ${locked ? 'disabled' : ''}>選択</button><button type="button" class="btn-sm" data-action="refresh" ${locked ? 'disabled' : ''}>再探索</button></span></label>
          </section>
          <section class="pce-vn-merge-picker">
            <div class="pce-vn-merge-picker-toolbar">
              <input data-field="filter" type="search" value="${esc(state.filter)}" placeholder="タイトル・相対pathを検索" ${locked ? 'disabled' : ''}>
              <span>${esc(visibleCount)} / ${esc(state.candidates.length)} candidates（有効 ${esc(eligibleCount)}）</span>
              <button type="button" class="btn-sm" data-action="select-visible" ${locked ? 'disabled' : ''}>表示中を全選択</button>
              <button type="button" class="btn-sm" data-action="clear-selection" ${locked || !state.projects.length ? 'disabled' : ''}>全解除</button>
            </div>
            <div class="pce-vn-merge-panes">
              <div class="pce-vn-merge-pane"><h3>候補project</h3><div class="pce-vn-merge-candidates">${state.scanning ? '<p class="pce-vn-merge-empty">探索中…</p>' : candidateRows()}</div></div>
              <div class="pce-vn-merge-pane"><h3>統合順 (${esc(state.projects.length)})</h3><div class="pce-vn-merge-selected">${selectedRows()}</div></div>
            </div>
          </section>
          <section class="pce-vn-merge-form">
            <label><span>出力親folder</span><span class="pce-vn-merge-field"><input data-field="outputParent" value="${esc(state.outputParent)}" readonly><button type="button" class="btn-sm" data-action="pick-output" ${locked ? 'disabled' : ''}>選択</button></span></label>
            <label><span>出力名</span><input data-field="outputName" value="${esc(state.outputName)}" maxlength="120" ${locked ? 'disabled' : ''}></label>
            <label><span>タイトル（空欄は出力名）</span><input data-field="title" value="${esc(state.title)}" maxlength="120" ${locked ? 'disabled' : ''}></label>
            <label class="pce-vn-merge-check"><input data-field="replace" type="checkbox"${state.replace ? ' checked' : ''} ${locked ? 'disabled' : ''}><span>既存の所有merge出力を置換</span></label>
          </section>
          ${summaryHtml()}
          <section class="pce-vn-merge-diagnostics">${diagnosticsHtml()}</section>
          <p class="pce-vn-merge-status" data-level="${esc(state.statusLevel)}">${esc(state.status)}</p>
          <footer>
            <button type="button" class="btn-sm" data-action="cancel" ${state.busy ? 'disabled' : ''}>キャンセル</button>
            <button type="button" class="btn-sm" data-action="inspect" ${locked || state.projects.length < 2 ? 'disabled' : ''}>検査</button>
            <button type="button" class="btn-primary" data-action="apply" ${locked || !state.inspection?.ok ? 'disabled' : ''}>結合</button>
          </footer>
        </div>
      `;
      if (focusField) {
        const input = modal.panel.querySelector(`[data-field="${focusField}"]`);
        input?.focus();
        input?.setSelectionRange?.(input.value.length, input.value.length);
      }
    };

    const scanRoot = async ({ selectCurrent = false } = {}) => {
      const token = ++state.scanToken;
      state.scanning = true;
      state.inspection = null;
      state.status = 'root配下のprojectを探索しています…';
      state.statusLevel = 'info';
      render();
      try {
        const result = await invoke('discoverVnProjectMergeCandidates', { root: state.root });
        if (settled || token !== state.scanToken) return;
        state.root = String(result.root || state.root);
        state.candidates = list(result.candidates);
        const eligibleKeys = new Set(state.candidates.filter((candidate) => candidate.eligible).map((candidate) => projectPathKey(candidate.path)));
        state.projects = state.projects.filter((projectPath) => eligibleKeys.has(projectPathKey(projectPath)));
        if (selectCurrent) {
          const currentCandidate = state.candidates.find((candidate) => (
            candidate.eligible && projectPathKey(candidate.path) === projectPathKey(currentProject)
          ));
          state.projects = currentCandidate ? [currentCandidate.path] : [];
          state.orderCustomized = false;
        }
        const invalidCount = state.candidates.length - eligibleKeys.size;
        state.status = `探索完了: 有効 ${eligibleKeys.size} / 無効 ${invalidCount}`;
        state.statusLevel = list(result.diagnostics).length ? 'warning' : 'success';
        logger?.info?.(`VN project候補探索完了: ${state.status}`);
      } catch (error) {
        if (settled || token !== state.scanToken) return;
        state.candidates = [];
        state.projects = [];
        state.status = `探索失敗: ${error.message || error}`;
        state.statusLevel = 'error';
        logger?.error?.(state.status);
      } finally {
        if (!settled && token === state.scanToken) {
          state.scanning = false;
          render();
        }
      }
    };

    const inspect = async () => {
      if (state.projects.length < 2) return;
      state.busy = true;
      const includesCurrent = state.projects.some((projectPath) => projectPathKey(projectPath) === projectPathKey(currentProject));
      state.status = includesCurrent
        ? '現在のVN編集内容を保存し、選択projectを検査しています…'
        : '選択projectを検査しています…';
      state.statusLevel = 'info';
      render();
      try {
        if (includesCurrent) {
          const snapshot = await editor.getSnapshot({ refreshAssets: true });
          await editor.saveSnapshot(snapshot);
        }
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
      if (!button) return;
      const action = button.dataset.action;
      if ((state.busy || state.scanning) && action !== 'cancel') return;
      if (action === 'cancel') cancel();
      else if (action === 'pick-root') {
        const picked = await api.electronAPI.pickFile({ title: 'PCE VN project群のroot folder', properties: ['openDirectory'] });
        const selected = pickedPath(picked);
        if (selected) {
          state.root = selected;
          state.projects = [];
          state.orderCustomized = false;
          state.outputParent = selected;
          if (!state.outputNameEdited) state.outputName = `${baseName(selected)}_merged`;
          invalidate('rootを変更しました。候補を再探索します。');
          await scanRoot({ selectCurrent: true });
        }
      } else if (action === 'refresh') await scanRoot();
      else if (action === 'select-visible') {
        state.projects = mergeVisibleSelection(state.projects, visibleCandidates(), state.candidates, state.orderCustomized);
        invalidate();
        render();
      } else if (action === 'clear-selection') {
        state.projects = [];
        state.orderCustomized = false;
        invalidate();
        render();
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
        if (!Number.isInteger(index) || index < 0) return;
        if (action === 'remove') state.projects.splice(index, 1);
        else if (action === 'up') {
          state.projects = moveMergeSelection(state.projects, index, -1);
          state.orderCustomized = true;
        } else if (action === 'down') {
          state.projects = moveMergeSelection(state.projects, index, 1);
          state.orderCustomized = true;
        }
        invalidate();
        render();
      }
    });
    modal.panel.addEventListener('change', (event) => {
      const projectPath = event.target?.dataset?.projectPath;
      if (projectPath) {
        if (event.target.checked) {
          const candidate = candidateByPath(projectPath);
          state.projects = mergeVisibleSelection(
            state.projects,
            candidate ? [candidate] : [],
            state.candidates,
            state.orderCustomized,
          );
        } else {
          state.projects = state.projects.filter((entry) => projectPathKey(entry) !== projectPathKey(projectPath));
        }
        invalidate();
        render();
        return;
      }
      const field = event.target?.dataset?.field;
      if (field === 'replace') {
        state.replace = Boolean(event.target.checked);
        invalidate();
        render();
      }
    });
    modal.panel.addEventListener('input', (event) => {
      const field = event.target?.dataset?.field;
      if (field === 'filter') {
        state.filter = event.target.value;
        render('filter');
      } else if (field === 'outputName' || field === 'title') {
        state[field] = event.target.value;
        if (field === 'outputName') state.outputNameEdited = true;
        invalidate();
        render(field);
      }
    });
    window.addEventListener('keydown', onKeyDown);
    render();
    modal.open();
    activeSession = { modal, promise };
    scanRoot({ selectCurrent: true });
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
    title: 'root配下から複数のCD-ROM2 VN projectを選択して名前空間付きで結合',
    priority: 100,
    order: 10,
    placement: 'after-preview',
    supportedTargetMedia: ['cd'],
    run: openMerger,
  });
}
