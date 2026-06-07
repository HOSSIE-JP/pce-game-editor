const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

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

function noteToPeriod(note = 'C4') {
  const base = { C: 1024, D: 912, E: 812, F: 768, G: 684, A: 608, B: 542 };
  const name = String(note).slice(0, 1).toUpperCase();
  const octave = asNumber(String(note).slice(1), 4);
  const shift = Math.max(-2, Math.min(3, 4 - octave));
  return Math.max(32, Math.min(4095, Math.round((base[name] || 1024) * (2 ** shift))));
}

export function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-music-editor-shell">
      <aside class="pce-plugin-list">
        <div class="pce-plugin-header"><h2>PSG</h2><button class="btn-sm" type="button" data-new>新規</button></div>
        <div data-list class="pce-plugin-items"></div>
      </aside>
      <main class="pce-plugin-main">
        <section class="pce-tracker-panel">
          <div class="pce-tracker-toolbar">
            <button class="btn-sm" type="button" data-play>再生</button>
            <button class="btn-sm" type="button" data-stop>停止</button>
            <button class="btn-primary" type="button" data-save>保存</button>
          </div>
          <div class="pce-tracker-grid" data-grid></div>
        </section>
        <form class="settings-form compact-form pce-plugin-form" data-form>
          <label class="form-group"><span class="form-label">Name</span><input class="form-input" name="name" /></label>
          <label class="form-group"><span class="form-label">Type</span><select class="form-select" name="type"><option value="psg-sfx">SFX</option><option value="psg-song">Song</option></select></label>
          <div class="pce-form-grid">
            <label class="form-group"><span class="form-label">BPM</span><input class="form-input" name="bpm" type="number" min="30" max="300" /></label>
            <label class="form-group"><span class="form-label">Steps</span><input class="form-input" name="steps" type="number" min="1" max="64" /></label>
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
  let assets = [];
  let selectedId = '';
  let audioContext = null;

  function selected() {
    return assets.find((asset) => asset.id === selectedId) || null;
  }

  function renderList() {
    listEl.innerHTML = assets.length
      ? assets.map((asset) => `<button class="${asset.id === selectedId ? 'active' : ''}" type="button" data-id="${esc(asset.id)}"><strong>${esc(asset.name || asset.id)}</strong><span>${esc(asset.type)}</span></button>`).join('')
      : '<p class="asset-no-selection-hint">PSG アセットがありません</p>';
    listEl.querySelectorAll('[data-id]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedId = button.dataset.id;
        render();
      });
    });
  }

  function pattern(asset) {
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
    gridEl.innerHTML = pattern(asset).map((entry, index) => `
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

  async function reload() {
    const result = await api.electronAPI.listAssets();
    assets = (result?.assets || []).filter((asset) => asset.type === 'psg-song' || asset.type === 'psg-sfx');
    if (!assets.some((asset) => asset.id === selectedId)) selectedId = assets[0]?.id || '';
    render();
  }

  async function save() {
    const asset = selected();
    if (!asset) return;
    const nextPattern = Array.from(gridEl.querySelectorAll('[data-step]')).map((select, index) => ({
      step: index,
      note: select.value,
      period: select.value ? noteToPeriod(select.value) : 0,
    }));
    const result = await api.electronAPI.upsertAsset({
      ...asset,
      type: form.elements.type.value,
      name: form.elements.name.value,
      options: {
        ...(asset.options || {}),
        kind: form.elements.type.value === 'psg-song' ? 'song' : 'sfx',
        bpm: asNumber(form.elements.bpm.value, 150),
        steps: asNumber(form.elements.steps.value, 16),
        period: nextPattern.find((entry) => entry.period)?.period || 512,
        pattern: nextPattern,
      },
    });
    if (!result?.ok) {
      error.textContent = result?.error || '保存できませんでした';
      return;
    }
    await reload();
  }

  function play() {
    const asset = selected();
    const first = pattern(asset).find((entry) => entry.period);
    if (!first) return;
    audioContext = audioContext || new AudioContext();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = Math.max(80, Math.min(2000, 3579545 / (32 * first.period)));
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.18);
  }

  root.querySelector('[data-new]').addEventListener('click', () => {
    const id = `psg_${Date.now()}`;
    assets.push({ id, type: 'psg-sfx', name: 'PSG SFX', source: '', options: { bpm: 150, steps: 16, period: 512, pattern: [{ step: 0, note: 'C4', period: 512 }] } });
    selectedId = id;
    render();
  });
  root.querySelector('[data-save]').addEventListener('click', save);
  root.querySelector('[data-play]').addEventListener('click', play);
  root.querySelector('[data-stop]').addEventListener('click', () => {});
  registerCapability('psg-music-editor', { reload });
  void reload();
  return { deactivate() {} };
}
