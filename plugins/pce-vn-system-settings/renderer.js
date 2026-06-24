const SCENE_FILE = 'assets/pce-vn-scenes.json';
const SYSTEM_SETTINGS_EVENT = 'pce-vn-system-settings:changed';
const MESSAGE_SPEEDS = [
  { value: 0, label: '速度1(速い)：0' },
  { value: 10, label: '速度2：10' },
  { value: 20, label: '速度3：20' },
  { value: 30, label: '速度4：30' },
  { value: 40, label: '速度5：40' },
  { value: 50, label: '速度6(遅い)：50' },
];
const DEFAULT_SETTINGS = {
  messageSpeedFrames: 10,
  messageAdvanceMode: 'button',
  messageAutoWaitFrames: 60,
};

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
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, asNumber(value, fallback)));
}

function nearestOption(value, fallback = DEFAULT_SETTINGS.messageSpeedFrames) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = asNumber(value, fallback);
  let best = MESSAGE_SPEEDS[0].value;
  let bestDistance = Math.abs(parsed - best);
  for (const speed of MESSAGE_SPEEDS.slice(1)) {
    const distance = Math.abs(parsed - speed.value);
    if (distance < bestDistance) {
      best = speed.value;
      bestDistance = distance;
    }
  }
  return best;
}

function normalizeSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  return {
    messageSpeedFrames: nearestOption(raw.messageSpeedFrames ?? raw.textSpeedFrames ?? raw.speed),
    messageAdvanceMode: String(raw.messageAdvanceMode ?? raw.advanceMode ?? raw.advance ?? DEFAULT_SETTINGS.messageAdvanceMode).trim().toLowerCase() === 'auto'
      ? 'auto'
      : 'button',
    messageAutoWaitFrames: clamp(raw.messageAutoWaitFrames ?? raw.autoWaitFrames ?? raw.autoWait, 0, 255, DEFAULT_SETTINGS.messageAutoWaitFrames),
  };
}

function speedOptions(current) {
  const selected = nearestOption(current);
  return MESSAGE_SPEEDS.map((speed) => (
    `<option value="${speed.value}" ${speed.value === selected ? 'selected' : ''}>${esc(speed.label)}</option>`
  )).join('');
}

function defaultDoc() {
  return {
    version: 2,
    settings: normalizeSettings(),
    startScene: 'opening',
    scenes: [],
  };
}

function normalizeDoc(doc = {}) {
  const raw = doc && typeof doc === 'object' ? doc : {};
  return {
    ...raw,
    version: 2,
    settings: normalizeSettings(raw.settings || raw.systemSettings || raw.system),
    startScene: raw.startScene || 'opening',
    scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
  };
}

export async function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-vn-system">
      <header class="pce-vn-system-head">
        <div>
          <h2>システム設定</h2>
          <p>ノベルエンジン全体の挙動を設定します</p>
        </div>
        <div class="pce-vn-system-actions">
          <button class="btn-sm" type="button" data-action="reload">再読み込み</button>
          <button class="btn-sm primary" type="button" data-action="save">保存</button>
        </div>
      </header>
      <form class="pce-vn-system-form" data-role="system-form">
        <section class="pce-vn-system-section">
          <h3>メッセージ</h3>
          <div class="pce-vn-system-grid">
            <label class="form-group">
              <span class="form-label">メッセージ速度</span>
              <select class="form-select" name="messageSpeedFrames"></select>
            </label>
            <label class="form-group">
              <span class="form-label">Advance</span>
              <select class="form-select" name="messageAdvanceMode">
                <option value="button">button</option>
                <option value="auto">auto</option>
              </select>
            </label>
            <label class="form-group">
              <span class="form-label">Auto wait</span>
              <input class="form-input" name="messageAutoWaitFrames" type="number" min="0" max="255" />
            </label>
          </div>
        </section>
      </form>
      <div class="form-error" data-role="system-status"></div>
    </div>
  `;

  const form = root.querySelector('[data-role="system-form"]');
  const statusEl = root.querySelector('[data-role="system-status"]');
  let doc = defaultDoc();

  function render() {
    const settings = normalizeSettings(doc.settings);
    form.elements.messageSpeedFrames.innerHTML = speedOptions(settings.messageSpeedFrames);
    form.elements.messageAdvanceMode.value = settings.messageAdvanceMode;
    form.elements.messageAutoWaitFrames.value = settings.messageAutoWaitFrames;
    form.elements.messageAutoWaitFrames.disabled = settings.messageAdvanceMode !== 'auto';
  }

  function settingsFromForm() {
    return normalizeSettings({
      messageSpeedFrames: form.elements.messageSpeedFrames.value,
      messageAdvanceMode: form.elements.messageAdvanceMode.value,
      messageAutoWaitFrames: form.elements.messageAutoWaitFrames.value,
    });
  }

  async function readDoc() {
    const read = await api.electronAPI.readCodeFile({ path: SCENE_FILE });
    if (read?.ok && read.content) {
      try {
        return normalizeDoc(JSON.parse(read.content));
      } catch (_) {
        return defaultDoc();
      }
    }
    return defaultDoc();
  }

  async function load() {
    statusEl.textContent = '';
    doc = await readDoc();
    render();
  }

  async function save() {
    try {
      const latest = await readDoc();
      const settings = settingsFromForm();
      doc = normalizeDoc({ ...latest, settings });
      await api.electronAPI.writeCodeFile({ path: SCENE_FILE, content: JSON.stringify(doc, null, 2), encoding: 'utf8' });
      window.dispatchEvent(new CustomEvent(SYSTEM_SETTINGS_EVENT, { detail: { settings } }));
      statusEl.textContent = '保存しました';
      render();
    } catch (err) {
      statusEl.textContent = `保存失敗: ${err?.message || err}`;
    }
  }

  form.addEventListener('input', () => {
    doc.settings = settingsFromForm();
    render();
  });
  form.addEventListener('change', () => {
    doc.settings = settingsFromForm();
    render();
  });
  root.querySelector('[data-action="reload"]').addEventListener('click', () => { void load(); });
  root.querySelector('[data-action="save"]').addEventListener('click', () => { void save(); });

  registerCapability('vn-system-settings', { reload: load, save });
  await load();
  return {};
}
