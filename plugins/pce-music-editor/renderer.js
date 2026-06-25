import {
  createPsgPreviewController,
  psgPreviewStats,
} from './psg-preview.js';

const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const MIDI_IMPORT_DEFAULTS = Object.freeze({
  maxToneVoices: 4,
  drumMode: 'soft',
  toneVolumeScale: 100,
  drumVolumeScale: 35,
  minVelocity: 8,
  voicePriority: 'melodyBass',
  patternDetail: 'auto',
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeId(value, fallback = 'psg_track') {
  const id = String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return id || fallback;
}

function noteToPeriod(note = 'C4') {
  const base = { C: 1024, D: 912, E: 812, F: 768, G: 684, A: 608, B: 542 };
  const name = String(note).slice(0, 1).toUpperCase();
  const octave = asNumber(String(note).slice(1), 4);
  const shift = Math.max(-2, Math.min(3, 4 - octave));
  return Math.max(32, Math.min(4095, Math.round((base[name] || 1024) * (2 ** shift))));
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

export function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-music-editor-shell">
      <aside class="pce-plugin-list">
        <div class="pce-plugin-header"><h2>PSG</h2><div class="pce-plugin-header-actions"><button class="btn-sm" type="button" data-import>取込</button><button class="btn-sm" type="button" data-new>新規</button></div></div>
        <div data-list class="pce-plugin-items"></div>
      </aside>
      <main class="pce-plugin-main">
        <section class="pce-tracker-panel">
          <div class="pce-tracker-toolbar">
            <button class="icon-btn" type="button" data-preview-toggle title="PSG プレビュー再生" aria-label="PSG プレビュー再生">▶</button>
            <button class="btn-primary" type="button" data-save>保存</button>
          </div>
          <div class="pce-tracker-grid" data-grid></div>
        </section>
        <form class="settings-form compact-form pce-plugin-form" data-form>
          <label class="form-group"><span class="form-label">Name</span><input class="form-input" name="name" /></label>
          <label class="form-group"><span class="form-label">Type</span><select class="form-select" name="type"><option value="psg-sfx">SFX</option><option value="psg-song">Song</option></select></label>
          <div class="pce-form-grid">
            <label class="form-group"><span class="form-label">BPM</span><input class="form-input" name="bpm" type="number" min="30" max="300" /></label>
            <label class="form-group"><span class="form-label">Steps</span><input class="form-input" name="steps" type="number" min="1" max="4096" /></label>
          </div>
          <div class="form-error" data-error></div>
        </form>
      </main>
    </div>
  `;
  const listEl = root.querySelector('[data-list]');
  const gridEl = root.querySelector('[data-grid]');
  const form = root.querySelector('[data-form]');
  const error = root.querySelector('[data-error]');
  const previewToggleButton = root.querySelector('[data-preview-toggle]');
  let assets = [];
  let selectedId = '';
  const assetApi = api.assets || {};

  const listPceAssets = (options = {}) => assetApi.listPceAssets
    ? assetApi.listPceAssets(options)
    : api.electronAPI.listAssets();
  const upsertPceAsset = (asset) => assetApi.upsertPceAsset
    ? assetApi.upsertPceAsset(asset)
    : api.electronAPI.upsertAsset(asset);
  const deletePceAsset = (id) => assetApi.deletePceAsset
    ? assetApi.deletePceAsset(id)
    : api.electronAPI.deleteAsset(id);
  const importPceVgm = (payload) => assetApi.importPceVgm
    ? assetApi.importPceVgm(payload)
    : api.electronAPI.importAssetVgm(payload);
  const importPceMidi = (payload) => assetApi.importPceMidi
    ? assetApi.importPceMidi(payload)
    : api.electronAPI.importAssetMidi(payload);
  const previewPceMidi = (payload) => assetApi.previewPceMidi
    ? assetApi.previewPceMidi(payload)
    : api.electronAPI.previewAssetMidi(payload);
  let importBusy = false;
  const previewController = createPsgPreviewController({
    onStateChange: (playing) => {
      previewToggleButton.textContent = playing ? '■' : '▶';
      previewToggleButton.title = playing ? 'PSG プレビュー停止' : 'PSG プレビュー再生';
      previewToggleButton.setAttribute('aria-label', previewToggleButton.title);
      previewToggleButton.classList.toggle('is-active', playing);
    },
    onError: (message) => { error.textContent = message; },
  });

  function selected() {
    return assets.find((asset) => asset.id === selectedId) || null;
  }

  function psgAssets() {
    return assets
      .slice()
      .sort((left, right) => compareText(assetFullName(left), assetFullName(right)) || compareText(left.id, right.id));
  }

  function renderGroupedList(list, itemRenderer) {
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
        html += `<div class="pce-plugin-group" style="--asset-group-indent:${depth * 14}px"><strong>${esc(group[depth])}</strong><code>${esc(path)}</code></div>`;
      }
      previousGroup = group;
      return html + itemRenderer(asset);
    }).join('');
  }

  function renderList() {
    const list = psgAssets();
    listEl.innerHTML = list.length
        ? renderGroupedList(list, (asset) => `
          <div class="pce-music-list-row${asset.id === selectedId ? ' active' : ''}" data-row-id="${esc(asset.id)}">
            <button class="pce-music-list-select" type="button" data-id="${esc(asset.id)}"><strong>${esc(assetDisplayName(asset))}</strong><code>${esc(asset.id)}</code><span>${esc(asset.type)}</span></button>
            <button class="icon-btn-xs pce-music-list-delete" type="button" data-delete-id="${esc(asset.id)}" title="削除" aria-label="削除">×</button>
          </div>
        `)
      : '<p class="asset-no-selection-hint">PSG アセットがありません</p>';
    listEl.querySelectorAll('[data-id]').forEach((button) => {
      button.addEventListener('click', () => {
        previewController.stop();
        selectedId = button.dataset.id;
        render();
      });
    });
    listEl.querySelectorAll('[data-delete-id]').forEach((button) => {
      button.addEventListener('click', () => { void deleteSelectedAsset(button.dataset.deleteId); });
    });
  }

  function isTrackerEditable(asset) {
    const rawPattern = asset?.options?.pattern;
    if (!Array.isArray(rawPattern) || !rawPattern.length) return true;
    return rawPattern.every((entry, index) => {
      const raw = entry && typeof entry === 'object' ? entry : {};
      const step = raw.step == null ? index : asNumber(raw.step, index);
      const channel = raw.channel == null ? 0 : asNumber(raw.channel, 0);
      const noise = raw.noise == null ? 0 : asNumber(raw.noise, 0);
      return step === index
        && channel === 0
        && !noise
        && raw.volume == null
        && Object.prototype.hasOwnProperty.call(raw, 'note');
    });
  }

  function trackerPattern(asset) {
    const options = asset?.options || {};
    const steps = Math.max(1, Math.min(64, asNumber(options.steps, 16)));
    return Array.from({ length: steps }, (_unused, index) => options.pattern?.[index] || { note: index === 0 ? 'C4' : '', period: index === 0 ? 512 : 0 });
  }

  function renderGrid() {
    const asset = selected();
    if (!asset) {
      gridEl.innerHTML = '<p class="asset-no-selection-hint">PSG アセットを選択してください</p>';
      form.hidden = true;
      return;
    }
    form.hidden = false;
    form.elements.name.value = asset.name || asset.id;
    form.elements.type.value = asset.type === 'psg-song' ? 'psg-song' : 'psg-sfx';
    form.elements.bpm.value = asset.options?.bpm || 150;
    form.elements.steps.value = asset.options?.steps || 16;
    if (!isTrackerEditable(asset)) {
      const stats = psgPreviewStats(asset);
      gridEl.innerHTML = `
        <div class="pce-tracker-summary" data-psg-pattern-summary>
          <strong>Pattern events</strong>
          <span>${esc(stats.entries)} events / ${esc(asset.options?.steps || 16)} steps / ${esc(stats.channels)} channels${stats.noiseCount ? ` / ${esc(stats.noiseCount)} noise` : ''}</span>
          <code>${esc((asset.options?.pattern || []).slice(0, 18).map((entry) => `s${entry.step ?? 0}:ch${entry.channel ?? 0}:p${entry.period ?? 0}:v${entry.volume ?? 0}${entry.noise ? ':n' : ''}`).join('  '))}</code>
        </div>
      `;
      return;
    }
    gridEl.innerHTML = trackerPattern(asset).map((entry, index) => `
      <label>
        <span>${String(index + 1).padStart(2, '0')}</span>
        <select data-step="${index}">
          <option value=""></option>
          ${NOTES.map((note) => `<option value="${note}4" ${entry.note === `${note}4` ? 'selected' : ''}>${note}4</option>`).join('')}
        </select>
      </label>
    `).join('');
  }

  function render() {
    renderList();
    renderGrid();
  }

  async function reload(options = {}) {
    const result = await listPceAssets({ force: Boolean(options.force) });
    assets = (result?.assets || []).filter((asset) => asset.type === 'psg-song' || asset.type === 'psg-sfx');
    if (!assets.some((asset) => asset.id === selectedId)) selectedId = assets[0]?.id || '';
    render();
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

  async function save() {
    const asset = selected();
    if (!asset) return;
    const canEditPattern = isTrackerEditable(asset);
    const nextPattern = canEditPattern
      ? Array.from(gridEl.querySelectorAll('[data-step]')).map((select, index) => ({
        step: index,
        note: select.value,
        period: select.value ? noteToPeriod(select.value) : 0,
      }))
      : (Array.isArray(asset.options?.pattern) ? asset.options.pattern.slice() : []);
    const result = await upsertPceAsset({
      ...asset,
      type: form.elements.type.value,
      name: form.elements.name.value,
      options: {
        ...(asset.options || {}),
        kind: form.elements.type.value === 'psg-song' ? 'song' : 'sfx',
        bpm: asNumber(form.elements.bpm.value, 150),
        steps: asNumber(form.elements.steps.value, 16),
        period: canEditPattern
          ? (nextPattern.find((entry) => entry.period)?.period || 512)
          : (asset.options?.period || nextPattern.find((entry) => entry.period && !entry.noise)?.period || 512),
        pattern: nextPattern,
      },
    });
    if (!result?.ok) {
      error.textContent = result?.error || '保存できませんでした';
      return;
    }
    await reload({ force: true });
  }

  async function deleteSelectedAsset(assetId = selectedId) {
    const asset = assets.find((entry) => entry.id === assetId);
    if (!asset) return;
    const ok = window.confirm ? window.confirm(`PSG アセット「${asset.name || asset.id}」を削除します。`) : true;
    if (!ok) return;
    previewController.stop();
    const result = await deletePceAsset(asset.id);
    if (!result?.ok) {
      error.textContent = result?.error || '削除できませんでした';
      return;
    }
    if (selectedId === asset.id) selectedId = '';
    await reload({ force: true });
  }

  async function toggleSelectedPreview() {
    const asset = selected();
    if (!asset) return;
    error.textContent = '';
    await previewController.toggle(asset);
  }

  async function pickImportFile() {
    const picked = await api.electronAPI.pickFile({
      properties: ['openFile'],
      filters: [{ name: 'PSG ソース (VGM/VGZ/MIDI)', extensions: ['vgm', 'vgz', 'mid', 'midi'] }],
    });
    const sourcePath = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
    if (picked?.canceled || !sourcePath) return null;
    const fileName = String(sourcePath).split(/[\\/]/).pop() || '';
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const format = ext === 'mid' || ext === 'midi' ? 'midi' : 'vgm';
    return { sourcePath, fileName, ext, format };
  }

  function openImportModal(picked) {
    const isMidi = picked.format === 'midi';
    return new Promise((resolve) => {
      const baseName = picked.fileName.replace(/\.[^.]+$/, '');
      const defaultId = safeId(baseName, 'psg_track');
      const title = isMidi ? 'MIDI 取込' : 'VGM 取込';
      const bpmField = isMidi
        ? '<input class="form-input" name="bpm" type="number" min="30" max="300" placeholder="auto (MIDI tempo)" />'
        : '<input class="form-input" name="bpm" type="number" min="30" max="300" value="150" />';
      const midiControls = isMidi ? `
            <div class="pce-music-midi-controls" data-midi-controls>
              <div class="pce-form-grid">
                <label class="form-group"><span class="form-label">Tone voices</span><input class="form-input" name="maxToneVoices" type="number" min="1" max="6" value="${MIDI_IMPORT_DEFAULTS.maxToneVoices}" /></label>
                <label class="form-group"><span class="form-label">Drum/noise</span><select class="form-select" name="drumMode"><option value="soft" selected>Soft ch5</option><option value="off">Off</option><option value="full">Full ch4/5</option></select></label>
                <label class="form-group"><span class="form-label">Tone volume %</span><input class="form-input" name="toneVolumeScale" type="number" min="0" max="100" value="${MIDI_IMPORT_DEFAULTS.toneVolumeScale}" /></label>
              </div>
              <details class="pce-music-midi-details">
                <summary>詳細</summary>
                <div class="pce-form-grid">
                  <label class="form-group"><span class="form-label">Drum volume %</span><input class="form-input" name="drumVolumeScale" type="number" min="0" max="100" value="${MIDI_IMPORT_DEFAULTS.drumVolumeScale}" /></label>
                  <label class="form-group"><span class="form-label">Min velocity</span><input class="form-input" name="minVelocity" type="number" min="0" max="127" value="${MIDI_IMPORT_DEFAULTS.minVelocity}" /></label>
                  <label class="form-group"><span class="form-label">Voice priority</span><select class="form-select" name="voicePriority"><option value="melodyBass" selected>Melody + bass</option><option value="high">High notes</option><option value="low">Low notes</option><option value="loud">Loud notes</option></select></label>
                  <label class="form-group"><span class="form-label">Pattern detail</span><select class="form-select" name="patternDetail"><option value="auto" selected>Auto reduce</option><option value="full">Full</option><option value="half">1/2 updates</option><option value="quarter">1/4 updates</option><option value="eighth">1/8 updates</option></select></label>
                </div>
              </details>
            </div>
      ` : '';
      const note = isMidi
        ? 'MIDI を PSG pattern へ近似します。既定では tone 4 voice、drum は控えめな ch5 noise、音量 100% で取り込みます。BPM 空欄で MIDI のテンポを使用します。'
        : 'VGM の PSG レジスタ書き込みを 16 分音符グリッド (最大 4096 ステップ) へ量子化します。BPM でステップ間隔が決まります。波形 / LFO / ノイズ / DDA は近似されません。';
      const typeAutoLabel = isMidi ? '自動 (曲として登録)' : '自動 (ループで判定)';
      const previewButton = isMidi ? '<button class="btn-sm" type="button" data-preview-midi>▶ 試聴</button>' : '';
      const modal = api.createModal({
        id: `pce-music-import-${Date.now()}`,
        panelClassName: 'app-panel app-panel-sm',
        html: `
          <div class="page-header modal-header">
            <h2>${esc(title)}</h2>
            <button class="icon-btn" type="button" data-cancel>✕</button>
          </div>
          <form class="settings-form compact-form pce-music-vgm-form">
            <code class="pce-music-vgm-file">${esc(picked.sourcePath)}</code>
            <div class="pce-form-grid">
              <label class="form-group"><span class="form-label">ID</span><input class="form-input" name="id" value="${esc(defaultId)}" /></label>
              <label class="form-group"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(baseName)}" /></label>
              <label class="form-group"><span class="form-label">BPM</span>${bpmField}</label>
              <label class="form-group"><span class="form-label">Type</span><select class="form-select" name="type"><option value="auto">${esc(typeAutoLabel)}</option><option value="psg-sfx">SFX</option><option value="psg-song">Song</option></select></label>
            </div>
            ${midiControls}
            <p class="pce-music-vgm-note">${esc(note)}</p>
            <div class="form-error" data-modal-error></div>
            <div class="form-actions-inline modal-actions-end">
              ${previewButton}
              <button class="btn-sm" type="button" data-cancel>キャンセル</button>
              <button class="btn-primary" type="submit">取込</button>
            </div>
          </form>
        `,
      });
      const modalForm = modal.panel.querySelector('form');
      const modalError = modal.panel.querySelector('[data-modal-error]');
      const modalPreviewButton = modal.panel.querySelector('[data-preview-midi]');
      const modalPreviewController = createPsgPreviewController({
        onStateChange: (playing) => {
          if (!modalPreviewButton) return;
          modalPreviewButton.textContent = playing ? '■ 停止' : '▶ 試聴';
          modalPreviewButton.classList.toggle('is-active', playing);
        },
        onError: (message) => { modalError.textContent = message; },
      });
      let busy = false;
      const payloadFromForm = () => {
        const typeValue = modalForm.elements.type.value;
        const bpmRaw = modalForm.elements.bpm.value;
        const payload = {
          sourcePath: picked.sourcePath,
          id: safeId(modalForm.elements.id.value, defaultId),
          name: String(modalForm.elements.name.value || defaultId).trim(),
          // MIDI: blank BPM means "use the MIDI tempo"; VGM keeps a default.
          bpm: bpmRaw === '' ? (isMidi ? '' : 150) : asNumber(bpmRaw, 150),
          type: typeValue === 'auto' ? '' : typeValue,
        };
        if (isMidi) {
          payload.midiOptions = {
            maxToneVoices: asNumber(modalForm.elements.maxToneVoices.value, MIDI_IMPORT_DEFAULTS.maxToneVoices),
            drumMode: modalForm.elements.drumMode.value,
            toneVolumeScale: asNumber(modalForm.elements.toneVolumeScale.value, MIDI_IMPORT_DEFAULTS.toneVolumeScale),
            drumVolumeScale: asNumber(modalForm.elements.drumVolumeScale.value, MIDI_IMPORT_DEFAULTS.drumVolumeScale),
            minVelocity: asNumber(modalForm.elements.minVelocity.value, MIDI_IMPORT_DEFAULTS.minVelocity),
            voicePriority: modalForm.elements.voicePriority.value,
            patternDetail: modalForm.elements.patternDetail.value,
          };
        }
        return payload;
      };
      const close = (value) => {
        modalPreviewController.close();
        modal.close();
        modal.destroy?.();
        resolve(value);
      };
      modal.panel.querySelectorAll('[data-cancel]').forEach((button) => {
        button.addEventListener('click', () => close(null), { once: true });
      });
      modalPreviewButton?.addEventListener('click', async () => {
        if (modalPreviewController.isPlaying) {
          modalPreviewController.stop();
          return;
        }
        modalError.textContent = '試聴用に変換中...';
        const result = await previewPceMidi(payloadFromForm());
        if (!result?.ok) {
          modalError.textContent = result?.error || 'MIDI preview を作成できませんでした';
          return;
        }
        const previewType = modalForm.elements.type.value === 'psg-sfx' ? 'psg-sfx' : 'psg-song';
        modalError.textContent = (result.conversion?.warnings || []).join(' / ');
        await modalPreviewController.play({
          id: 'midi_preview',
          type: previewType,
          options: result.preview?.options || {},
        }, { loop: previewType === 'psg-song' });
      });
      modalForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        modalPreviewController.stop();
        modalError.textContent = '取込中...';
        const payload = payloadFromForm();
        const result = isMidi ? await importPceMidi(payload) : await importPceVgm(payload);
        if (!result?.ok) {
          busy = false;
          modalError.textContent = result?.error || (isMidi ? 'MIDI を取り込めませんでした' : 'VGM を取り込めませんでした');
          return;
        }
        close({ asset: result.asset, warnings: result.conversion?.warnings || [] });
      });
      modal.open();
    });
  }

  async function runImport() {
    if (importBusy) return;
    importBusy = true;
    try {
      const picked = await pickImportFile();
      if (!picked) return;
      const outcome = await openImportModal(picked);
      if (!outcome) return;
      selectedId = outcome.asset?.id || '';
      await reload({ force: true });
      if (outcome.warnings?.length) {
        error.textContent = outcome.warnings.join(' / ');
      }
    } finally {
      importBusy = false;
    }
  }

  root.querySelector('[data-new]').addEventListener('click', () => {
    const id = `psg_${Date.now()}`;
    assets.push({ id, type: 'psg-sfx', name: 'PSG SFX', source: '', options: { bpm: 150, steps: 16, period: 512, pattern: [{ step: 0, note: 'C4', period: 512 }] } });
    selectedId = id;
    render();
  });
  root.querySelector('[data-import]').addEventListener('click', () => { void runImport(); });
  root.querySelector('[data-save]').addEventListener('click', save);
  previewToggleButton.addEventListener('click', () => { void toggleSelectedPreview(); });
  registerCapability('psg-music-editor', { reload });
  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  void reload();
  return {
    deactivate() {
      teardownAssetRefreshEvents();
      previewController.close();
    },
  };
}
