import {
  createPsgPreviewController,
  psgPreviewStats,
} from './psg-preview.js';
import {
  SFX_PRESETS,
  SFX_PARAM_RANGES,
  defaultSfxParams,
  presetParams,
  synthesizeSfxPattern,
  randomizeSfxParams,
  mutateSfxParams,
  psgFreqFromPeriod,
  psgPeriodFromFreq,
} from './psg-sfx-synth.mjs';

const PITCH_RANGE = SFX_PARAM_RANGES.pitchHz;
const PITCH_SLIDER_MAX = 1000;

// Pitch is edited on a logarithmic Hz slider (0..PITCH_SLIDER_MAX) so low and
// high octaves get comparable travel, then stored as a 12-bit PSG period.
function pitchFreqToSlider(freq) {
  const clamped = Math.max(PITCH_RANGE.min, Math.min(PITCH_RANGE.max, freq || PITCH_RANGE.min));
  return Math.round((Math.log(clamped / PITCH_RANGE.min) / Math.log(PITCH_RANGE.max / PITCH_RANGE.min)) * PITCH_SLIDER_MAX);
}
function pitchSliderToFreq(value) {
  const t = Math.max(0, Math.min(1, Number(value) / PITCH_SLIDER_MAX));
  return PITCH_RANGE.min * Math.pow(PITCH_RANGE.max / PITCH_RANGE.min, t);
}

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
          <label class="form-group"><span class="form-label">Volume %</span><input class="form-input" name="volume" type="number" min="0" max="100" /></label>
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
  let designerParams = null;
  let designerAssetId = null;
  let designerPreviewTimer = null;
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

  function isDesignerAsset(asset) {
    // Imported MIDI/VGM patterns stay read-only; everything else is authored
    // with the SFX designer.
    if (!asset) return false;
    return !(asset.data && asset.data.import);
  }

  function loadDesignerParams(asset) {
    const stored = asset?.options?.sfx;
    return stored && typeof stored === 'object'
      ? { ...defaultSfxParams(), ...stored }
      : defaultSfxParams();
  }

  function ensureDesignerParams(asset) {
    if (designerAssetId !== asset.id || !designerParams) {
      designerAssetId = asset.id;
      designerParams = loadDesignerParams(asset);
    }
    return designerParams;
  }

  async function playDesignerPreview() {
    if (!designerParams) return;
    error.textContent = '';
    const options = { ...synthesizeSfxPattern(designerParams), volume: asNumber(form.elements.volume.value, 100) };
    await previewController.play({ id: 'sfx_designer_preview', type: 'psg-sfx', options }, { loop: false });
  }

  function scheduleDesignerPreview() {
    if (designerPreviewTimer) window.clearTimeout(designerPreviewTimer);
    designerPreviewTimer = window.setTimeout(() => {
      designerPreviewTimer = null;
      void playDesignerPreview();
    }, 160);
  }

  function pitchRow(labelText, key, period) {
    const freq = Math.round(psgFreqFromPeriod(period) || PITCH_RANGE.min);
    return `
      <label class="pce-sfx-row">
        <span class="pce-sfx-row-label">${esc(labelText)}</span>
        <input class="pce-sfx-slider" type="range" min="0" max="${PITCH_SLIDER_MAX}" value="${pitchFreqToSlider(freq)}" data-pitch="${esc(key)}" />
        <span class="pce-sfx-row-value" data-value-for="${esc(key)}">${freq}Hz</span>
      </label>`;
  }

  function noiseRow(labelText, key, value) {
    return `
      <label class="pce-sfx-row">
        <span class="pce-sfx-row-label">${esc(labelText)}</span>
        <input class="pce-sfx-slider" type="range" min="0" max="31" value="${esc(value)}" data-noise="${esc(key)}" />
        <span class="pce-sfx-row-value" data-value-for="${esc(key)}">${esc(value)}</span>
      </label>`;
  }

  function numberRow(labelText, key, value, min, max, suffix = '') {
    return `
      <label class="pce-sfx-row">
        <span class="pce-sfx-row-label">${esc(labelText)}</span>
        <input class="pce-sfx-slider" type="range" min="${min}" max="${max}" value="${esc(value)}" data-num="${esc(key)}" />
        <span class="pce-sfx-row-value" data-value-for="${esc(key)}">${esc(value)}${esc(suffix)}</span>
      </label>`;
  }

  function setDesignerValueLabel(container, key, text) {
    const el = container.querySelector(`[data-value-for="${key}"]`);
    if (el) el.textContent = text;
  }

  function updateDesignerMeta(container) {
    const meta = container.querySelector('[data-sfx-meta]');
    if (!meta || !designerParams) return;
    const synth = synthesizeSfxPattern(designerParams);
    meta.textContent = `${synth.pattern.length} events / ${synth.steps} steps · 常駐`;
  }

  function applyDesignerParams(next) {
    designerParams = { ...defaultSfxParams(), ...next };
    renderDesigner(gridEl);
    scheduleDesignerPreview();
  }

  function renderDesigner(container) {
    const p = designerParams;
    if (!p) return;
    const isNoise = p.wave === 'noise';
    const synth = synthesizeSfxPattern(p);
    const presets = SFX_PRESETS
      .map((preset) => `<button class="pce-sfx-preset" type="button" data-preset="${esc(preset.id)}">${esc(preset.label)}</button>`)
      .join('');
    container.innerHTML = `
      <div class="pce-sfx-designer">
        <div class="pce-sfx-presets">${presets}</div>
        <div class="pce-sfx-wave" role="group" aria-label="波形">
          <button class="pce-sfx-wave-btn${!isNoise ? ' is-active' : ''}" type="button" data-wave="tone">トーン</button>
          <button class="pce-sfx-wave-btn${isNoise ? ' is-active' : ''}" type="button" data-wave="noise">ノイズ</button>
        </div>
        <div class="pce-sfx-rows">
          ${isNoise
            ? noiseRow('開始ノイズ', 'startNoise', p.startNoise) + noiseRow('終了ノイズ', 'endNoise', p.endNoise)
            : pitchRow('開始ピッチ', 'startPeriod', p.startPeriod) + pitchRow('終了ピッチ', 'endPeriod', p.endPeriod)}
          ${numberRow('長さ', 'lengthSteps', p.lengthSteps, 1, 31)}
          ${numberRow('速さ', 'bpm', p.bpm, 60, 300)}
          ${numberRow('音量', 'volumeStart', p.volumeStart, 0, 31)}
          ${numberRow('終了音量', 'volumeEnd', p.volumeEnd, 0, 31)}
          <label class="pce-sfx-row">
            <span class="pce-sfx-row-label">減衰</span>
            <select class="pce-sfx-select" data-select="decayCurve">
              <option value="linear"${p.decayCurve !== 'exp' ? ' selected' : ''}>なめらか</option>
              <option value="exp"${p.decayCurve === 'exp' ? ' selected' : ''}>急</option>
            </select>
            <span class="pce-sfx-row-value"></span>
          </label>
          ${!isNoise ? numberRow('ビブラート', 'vibratoDepth', p.vibratoDepth, 0, 100, '%') : ''}
          ${!isNoise ? numberRow('ビブラート速さ', 'vibratoRate', p.vibratoRate, 0, 16) : ''}
        </div>
        <div class="pce-sfx-actions">
          <button class="btn-sm" type="button" data-randomize>🎲 ランダム</button>
          <button class="btn-sm" type="button" data-mutate>少し変える</button>
          <span class="pce-sfx-meta" data-sfx-meta>${esc(synth.pattern.length)} events / ${esc(synth.steps)} steps · 常駐</span>
        </div>
      </div>
    `;
    wireDesignerEvents(container);
  }

  function wireDesignerEvents(container) {
    container.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => applyDesignerParams(presetParams(button.dataset.preset)));
    });
    container.querySelectorAll('[data-wave]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!designerParams || designerParams.wave === button.dataset.wave) return;
        applyDesignerParams({ ...designerParams, wave: button.dataset.wave });
      });
    });
    container.querySelector('[data-randomize]')?.addEventListener('click', () => applyDesignerParams(randomizeSfxParams()));
    container.querySelector('[data-mutate]')?.addEventListener('click', () => applyDesignerParams(mutateSfxParams(designerParams)));
    container.querySelector('[data-select="decayCurve"]')?.addEventListener('change', (event) => {
      if (!designerParams) return;
      designerParams.decayCurve = event.target.value === 'exp' ? 'exp' : 'linear';
      updateDesignerMeta(container);
      scheduleDesignerPreview();
    });
    container.querySelectorAll('[data-pitch]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const freq = pitchSliderToFreq(slider.value);
        designerParams[slider.dataset.pitch] = psgPeriodFromFreq(freq);
        setDesignerValueLabel(container, slider.dataset.pitch, `${Math.round(freq)}Hz`);
        updateDesignerMeta(container);
        scheduleDesignerPreview();
      });
    });
    container.querySelectorAll('[data-noise]').forEach((slider) => {
      slider.addEventListener('input', () => {
        designerParams[slider.dataset.noise] = asNumber(slider.value, 0);
        setDesignerValueLabel(container, slider.dataset.noise, String(slider.value));
        updateDesignerMeta(container);
        scheduleDesignerPreview();
      });
    });
    container.querySelectorAll('[data-num]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.num;
        designerParams[key] = asNumber(slider.value, 0);
        setDesignerValueLabel(container, key, `${slider.value}${key === 'vibratoDepth' ? '%' : ''}`);
        updateDesignerMeta(container);
        scheduleDesignerPreview();
      });
    });
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
    form.elements.volume.value = asset.options?.volume ?? 100;
    if (isDesignerAsset(asset)) {
      ensureDesignerParams(asset);
      form.classList.add('is-designer');
      renderDesigner(gridEl);
      return;
    }
    form.classList.remove('is-designer');
    const stats = psgPreviewStats(asset);
    gridEl.innerHTML = `
      <div class="pce-tracker-summary" data-psg-pattern-summary>
        <strong>Pattern events</strong>
        <span>${esc(stats.entries)} events / ${esc(asset.options?.steps || 16)} steps / ${esc(stats.channels)} channels${stats.noiseCount ? ` / ${esc(stats.noiseCount)} noise` : ''}</span>
        <code>${esc((asset.options?.pattern || []).slice(0, 18).map((entry) => `s${entry.step ?? 0}:ch${entry.channel ?? 0}:p${entry.period ?? 0}:v${entry.volume ?? 0}${entry.noise ? ':n' : ''}`).join('  '))}</code>
      </div>
    `;
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
    const type = form.elements.type.value;
    const volume = asNumber(form.elements.volume.value, 100);
    let options;
    if (isDesignerAsset(asset)) {
      const params = ensureDesignerParams(asset);
      const synth = synthesizeSfxPattern(params);
      options = {
        ...(asset.options || {}),
        kind: type === 'psg-song' ? 'song' : 'sfx',
        bpm: synth.bpm,
        steps: synth.steps,
        period: synth.period,
        channels: synth.channels,
        volume,
        pattern: synth.pattern,
        sfx: params,
      };
    } else {
      options = {
        ...(asset.options || {}),
        kind: type === 'psg-song' ? 'song' : 'sfx',
        bpm: asNumber(form.elements.bpm.value, 150),
        steps: asNumber(form.elements.steps.value, 16),
        period: asset.options?.period || 512,
        volume,
        pattern: Array.isArray(asset.options?.pattern) ? asset.options.pattern.slice() : [],
      };
    }
    const result = await upsertPceAsset({
      ...asset,
      type,
      name: form.elements.name.value,
      options,
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
    if (isDesignerAsset(asset) && designerParams) {
      if (previewController.isPlaying) {
        previewController.stop();
        return;
      }
      await playDesignerPreview();
      return;
    }
    await previewController.toggle({
      ...asset,
      options: { ...(asset.options || {}), volume: asNumber(form.elements.volume.value, 100) },
    });
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
    const params = presetParams('jump');
    const synth = synthesizeSfxPattern(params);
    assets.push({
      id,
      type: 'psg-sfx',
      name: 'PSG SFX',
      source: '',
      options: {
        kind: 'sfx',
        bpm: synth.bpm,
        steps: synth.steps,
        period: synth.period,
        channels: synth.channels,
        pattern: synth.pattern,
        sfx: params,
      },
    });
    selectedId = id;
    designerAssetId = id;
    designerParams = params;
    render();
  });
  root.querySelector('[data-import]').addEventListener('click', () => { void runImport(); });
  root.querySelector('[data-save]').addEventListener('click', save);
  previewToggleButton.addEventListener('click', () => { void toggleSelectedPreview(); });
  form.elements.volume.addEventListener('input', () => {
    const asset = selected();
    if (asset && isDesignerAsset(asset) && designerParams) scheduleDesignerPreview();
  });
  registerCapability('psg-music-editor', { reload });
  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  void reload();
  return {
    deactivate() {
      teardownAssetRefreshEvents();
      if (designerPreviewTimer) window.clearTimeout(designerPreviewTimer);
      previewController.close();
    },
  };
}
