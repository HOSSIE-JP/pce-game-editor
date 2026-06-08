const IMAGE_EXTS = ['.png', '.bmp'];
const AUDIO_EXTS = ['.wav'];
const SPRITE_CELL_SIZES = ['16x16', '16x32', '16x64', '32x16', '32x32', '32x64'];
const PCE_PSG_CLOCK = 3579545;

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

function safeId(value, fallback = 'asset') {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return id || fallback;
}

function imageKind(asset = {}) {
  return asset.type === 'sprite' || asset.options?.kind === 'sprite' ? 'sprite' : 'background';
}

function isImageAsset(asset = {}) {
  return asset.type === 'image' || asset.type === 'sprite';
}

function isAudioAsset(asset = {}) {
  return asset.type === 'adpcm' || asset.type === 'cdda-track';
}

function isPsgAsset(asset = {}) {
  return asset.type === 'psg-song' || asset.type === 'psg-sfx' || asset.type === 'psg-sequence';
}

function psgPeriod(asset = {}) {
  const pattern = Array.isArray(asset.options?.pattern)
    ? asset.options.pattern
    : Array.isArray(asset.data?.pattern) ? asset.data.pattern : [];
  const firstPeriod = pattern.find((step) => Number.isFinite(Number(step?.period)))?.period;
  return Math.max(1, asNumber(firstPeriod ?? asset.options?.period, 512));
}

function psgFrequency(period) {
  return Math.max(40, Math.min(5000, PCE_PSG_CLOCK / (32 * Math.max(1, asNumber(period, 512)))));
}

function psgPattern(asset = {}) {
  const pattern = Array.isArray(asset.options?.pattern)
    ? asset.options.pattern
    : Array.isArray(asset.data?.pattern) ? asset.data.pattern : [];
  if (pattern.length) return pattern;
  return [{ period: psgPeriod(asset), volume: asset.options?.volume ?? 12, length: 1 }];
}

function generatedInfo(asset = {}) {
  return asset.data?.generated || {};
}

function dataUrlToPng(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('画像をPNGへ変換できませんでした'));
    image.src = dataUrl;
  });
}

function snapChannelToPce(value) {
  const n = Math.max(0, Math.min(255, Number(value) || 0));
  return Math.round(n / 36) * 36;
}

function countUniquePceColors(imageData) {
  const data = imageData?.data;
  if (!data) return 0;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    seen.add(`${snapChannelToPce(data[i])},${snapChannelToPce(data[i + 1])},${snapChannelToPce(data[i + 2])}`);
  }
  return seen.size;
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = dataUrl;
  });
}

async function imageDataFromDataUrl(dataUrl) {
  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  return {
    image,
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
  };
}

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.innerHTML = `
    <div class="pce-assets-layout assets-layout" data-plugin-root="${esc(plugin.id)}">
      <section class="asset-list-panel">
        <div class="asset-list-header">
          <div>
            <h2>PCE Assets</h2>
            <p class="pce-assets-subtitle">BG / Sprite / Palette / PSG / ADPCM / CD-DA を PC Engine 向けに管理します</p>
          </div>
          <div class="asset-list-header-actions">
            <button class="icon-btn" data-action="import-bg" type="button" title="BGを追加" aria-label="BGを追加">BG+</button>
            <button class="icon-btn" data-action="import-sprite" type="button" title="スプライトを追加" aria-label="スプライトを追加">SPR+</button>
            <button class="icon-btn" data-action="import-adpcm" type="button" title="ADPCMを追加" aria-label="ADPCMを追加">AD+</button>
            <button class="icon-btn" data-action="import-cdda" type="button" title="CD-DAを追加" aria-label="CD-DAを追加">CD+</button>
            <button class="icon-btn" data-action="new-psg" type="button" title="PSG SFX を追加" aria-label="PSG SFX を追加">♪+</button>
            <button class="icon-btn" data-action="new-palette" type="button" title="Palette を追加" aria-label="Palette を追加">▦</button>
            <button class="icon-btn" data-action="refresh" type="button" title="更新" aria-label="更新">↻</button>
          </div>
        </div>

        <div class="assets-toolbar">
          <label class="assets-toolbar-item assets-search-item">
            検索
            <input class="form-input" data-role="search" placeholder="name / id / source" />
          </label>
          <label class="assets-toolbar-item">
            種別
            <select class="form-select" data-role="type-filter">
              <option value="all">すべて</option>
              <option value="image">BG image</option>
              <option value="sprite">Sprite sheet</option>
              <option value="palette">Palette</option>
              <option value="psg-song">PSG song</option>
              <option value="psg-sfx">PSG SFX</option>
              <option value="adpcm">ADPCM</option>
              <option value="cdda-track">CD-DA</option>
            </select>
          </label>
        </div>

        <div class="asset-table-wrap">
          <table class="asset-table">
            <thead>
              <tr>
                <th class="asset-drag-th"></th>
                <th>Type</th>
                <th>Name</th>
                <th>Source</th>
                <th>Tiles</th>
                <th>Warn</th>
                <th class="asset-actions-cell"></th>
              </tr>
            </thead>
            <tbody data-role="asset-rows">
              <tr class="asset-row-empty"><td colspan="7">読み込み中...</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="asset-preview-resizer" role="separator" aria-orientation="vertical" data-role="resizer"></div>

      <aside class="asset-preview-panel">
        <div id="pceAssetEditorPanel" class="pce-assets-editor">
          <section class="accordion-section">
            <button class="accordion-header" type="button" aria-expanded="true" data-accordion="settings">
              <span class="accordion-title">設定</span><span class="accordion-chevron">⌃</span>
            </button>
            <div class="accordion-body" data-accordion-body="settings">
              <form class="asset-edit-form pce-assets-form" data-role="detail-form">
                <div class="asset-no-selection-hint" data-role="no-selection">アセットを選択してください</div>
                <div class="asset-edit-grid" data-role="detail-fields" hidden>
                  <label class="form-label">ID</label>
                  <input class="form-input form-input-mono" data-field="id" />
                  <label class="form-label">Type</label>
                  <select class="form-select" data-field="type">
                    <option value="image">BG image</option>
                    <option value="sprite">Sprite sheet</option>
                    <option value="palette">Palette</option>
                    <option value="psg-song">PSG song</option>
                    <option value="psg-sfx">PSG SFX</option>
                    <option value="adpcm">ADPCM</option>
                    <option value="cdda-track">CD-DA track</option>
                    <option value="tileset">Tileset</option>
                    <option value="tilemap">Tilemap</option>
                  </select>
                  <label class="form-label">Name</label>
                  <input class="form-input" data-field="name" />
                  <label class="form-label">Source</label>
                  <input class="form-input form-input-mono" data-field="source" />
                  <label class="form-label">Palette bank</label>
                  <input class="form-input" data-field="paletteBank" type="number" min="0" max="15" />
                  <label class="form-label">Tile base</label>
                  <input class="form-input" data-field="tileBase" type="number" min="0" max="2047" />
                  <label class="form-label">Map base</label>
                  <input class="form-input" data-field="mapBase" type="number" min="0" max="2047" />
                  <label class="form-label">X / Y</label>
                  <div class="pce-assets-inline-fields">
                    <input class="form-input" data-field="x" type="number" min="0" max="255" />
                    <input class="form-input" data-field="y" type="number" min="0" max="255" />
                  </div>
                  <label class="form-label">Width / Height</label>
                  <div class="pce-assets-inline-fields">
                    <input class="form-input" data-field="width" type="number" min="0" max="1024" />
                    <input class="form-input" data-field="height" type="number" min="0" max="1024" />
                  </div>
                  <label class="form-label">Cell</label>
                  <select class="form-select" data-field="cellSize">
                    ${SPRITE_CELL_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
                  </select>
                  <label class="form-label">Transparent</label>
                  <input class="form-input" data-field="transparentIndex" type="number" min="0" max="15" />
                  <label class="form-label">PSG period</label>
                  <input class="form-input" data-field="period" type="number" min="1" max="4095" />
                  <label class="form-label">BPM / Steps</label>
                  <div class="pce-assets-inline-fields">
                    <input class="form-input" data-field="bpm" type="number" min="30" max="300" />
                    <input class="form-input" data-field="steps" type="number" min="1" max="256" />
                  </div>
                  <label class="form-label">Sample rate</label>
                  <input class="form-input" data-field="sampleRate" type="number" min="4000" max="44100" />
                  <label class="form-label">Track</label>
                  <input class="form-input" data-field="track" type="number" min="2" max="99" />
                  <label class="form-label">Loop</label>
                  <label class="pce-assets-check">
                    <input data-field="loop" type="checkbox" />
                    <span>繰り返し再生</span>
                  </label>
                </div>
                <div class="pce-assets-animation-editor" data-role="animation-editor" hidden></div>
                <div class="form-actions-inline">
                  <button class="btn-primary" data-action="save" type="submit" disabled>保存</button>
                  <button class="icon-btn" data-action="delete" type="button" title="削除" aria-label="削除" disabled>✕</button>
                </div>
                <div class="form-error" data-role="form-error"></div>
              </form>
            </div>
          </section>

          <section class="accordion-section">
            <button class="accordion-header" type="button" aria-expanded="true" data-accordion="preview">
              <span class="accordion-title">プレビュー</span><span class="accordion-chevron">⌃</span>
            </button>
            <div class="accordion-body" data-accordion-body="preview">
              <div class="image-preview-frame pce-assets-preview-frame">
                <img data-role="source-preview" alt="PCE asset preview" hidden />
                <audio data-role="audio-preview" controls hidden></audio>
                <div class="pce-assets-sound-preview" data-role="sound-preview" hidden>
                  <div class="pce-assets-sound-meter" aria-hidden="true"><span data-role="sound-meter-bar"></span></div>
                  <div class="pce-assets-preview-actions">
                    <button class="icon-btn" data-action="preview-play" type="button" title="再生" aria-label="再生">▶</button>
                    <button class="icon-btn" data-action="preview-stop" type="button" title="停止" aria-label="停止">■</button>
                  </div>
                  <div class="pce-assets-preview-caption" data-role="sound-caption"></div>
                </div>
                <div class="inline-no-preview" data-role="no-preview">プレビューできる画像がありません</div>
              </div>
              <div class="inline-preview-info" data-role="preview-info"></div>
            </div>
          </section>

          <section class="accordion-section">
            <button class="accordion-header" type="button" aria-expanded="true" data-accordion="generated">
              <span class="accordion-title">PCE 変換結果</span><span class="accordion-chevron">⌃</span>
            </button>
            <div class="accordion-body" data-accordion-body="generated">
              <div class="pce-assets-stats" data-role="generated-stats"></div>
              <div class="image-preview-palette" data-role="palette"></div>
              <div class="pce-assets-generated-files" data-role="generated-files"></div>
            </div>
          </section>

          <section class="accordion-section">
            <button class="accordion-header" type="button" aria-expanded="true" data-accordion="diagnostics">
              <span class="accordion-title">警告 / 診断</span><span class="accordion-chevron">⌃</span>
            </button>
            <div class="accordion-body" data-accordion-body="diagnostics">
              <div data-role="diagnostics"></div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  `;

  const rowsEl = root.querySelector('[data-role="asset-rows"]');
  const searchEl = root.querySelector('[data-role="search"]');
  const typeFilterEl = root.querySelector('[data-role="type-filter"]');
  const formEl = root.querySelector('[data-role="detail-form"]');
  const detailFieldsEl = root.querySelector('[data-role="detail-fields"]');
  const noSelectionEl = root.querySelector('[data-role="no-selection"]');
  const formErrorEl = root.querySelector('[data-role="form-error"]');
  const previewImgEl = root.querySelector('[data-role="source-preview"]');
  const audioPreviewEl = root.querySelector('[data-role="audio-preview"]');
  const soundPreviewEl = root.querySelector('[data-role="sound-preview"]');
  const soundMeterBarEl = root.querySelector('[data-role="sound-meter-bar"]');
  const soundCaptionEl = root.querySelector('[data-role="sound-caption"]');
  const noPreviewEl = root.querySelector('[data-role="no-preview"]');
  const previewInfoEl = root.querySelector('[data-role="preview-info"]');
  const generatedStatsEl = root.querySelector('[data-role="generated-stats"]');
  const generatedFilesEl = root.querySelector('[data-role="generated-files"]');
  const paletteEl = root.querySelector('[data-role="palette"]');
  const diagnosticsEl = root.querySelector('[data-role="diagnostics"]');
  const animationEditorEl = root.querySelector('[data-role="animation-editor"]');
  const saveButton = root.querySelector('[data-action="save"]');
  const deleteButton = root.querySelector('[data-action="delete"]');
  const fields = {
    id: root.querySelector('[data-field="id"]'),
    type: root.querySelector('[data-field="type"]'),
    name: root.querySelector('[data-field="name"]'),
    source: root.querySelector('[data-field="source"]'),
    paletteBank: root.querySelector('[data-field="paletteBank"]'),
    tileBase: root.querySelector('[data-field="tileBase"]'),
    mapBase: root.querySelector('[data-field="mapBase"]'),
    x: root.querySelector('[data-field="x"]'),
    y: root.querySelector('[data-field="y"]'),
    width: root.querySelector('[data-field="width"]'),
    height: root.querySelector('[data-field="height"]'),
    cellSize: root.querySelector('[data-field="cellSize"]'),
    transparentIndex: root.querySelector('[data-field="transparentIndex"]'),
    period: root.querySelector('[data-field="period"]'),
    bpm: root.querySelector('[data-field="bpm"]'),
    steps: root.querySelector('[data-field="steps"]'),
    sampleRate: root.querySelector('[data-field="sampleRate"]'),
    track: root.querySelector('[data-field="track"]'),
    loop: root.querySelector('[data-field="loop"]'),
  };

  let assets = [];
  let selectedId = '';
  let draggedId = '';
  let psgAudioContext = null;
  let psgPreviewNodes = [];
  let psgPreviewToken = 0;

  function selectedAsset() {
    return assets.find((asset) => asset.id === selectedId) || null;
  }

  function stopPsgPreview() {
    psgPreviewToken += 1;
    psgPreviewNodes.forEach((node) => {
      try {
        if (typeof node.stop === 'function') node.stop(0);
      } catch (_err) {
        // Oscillator may already have completed its scheduled one-shot.
      }
      try {
        node.disconnect?.();
      } catch (_err) {
        // Best-effort cleanup only.
      }
    });
    psgPreviewNodes = [];
    if (soundMeterBarEl) soundMeterBarEl.style.width = '0%';
  }

  function playPsgPreview(asset = selectedAsset()) {
    if (!isPsgAsset(asset)) return;
    stopPsgPreview();
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      previewInfoEl.textContent = 'この環境では PSG プレビューを再生できません';
      return;
    }
    psgAudioContext ||= new AudioContextCtor();
    void psgAudioContext.resume?.();
    const gain = psgAudioContext.createGain();
    gain.gain.setValueAtTime(0.0001, psgAudioContext.currentTime);
    gain.connect(psgAudioContext.destination);
    psgPreviewNodes.push(gain);

    const bpm = Math.max(30, asNumber(asset.options?.bpm, 150));
    const baseStepSeconds = Math.max(0.04, Math.min(0.32, 60 / bpm / 2));
    const steps = psgPattern(asset).slice(0, asset.type === 'psg-song' ? 32 : 8);
    const previewToken = psgPreviewToken;
    let time = psgAudioContext.currentTime + 0.03;
    steps.forEach((step) => {
      const osc = psgAudioContext.createOscillator();
      const period = Math.max(1, asNumber(step.period, psgPeriod(asset)));
      const volume = Math.max(0.02, Math.min(0.18, asNumber(step.volume, 12) / 15 * 0.18));
      const duration = baseStepSeconds * Math.max(1, asNumber(step.length, 1));
      osc.type = 'square';
      osc.frequency.setValueAtTime(psgFrequency(period), time);
      gain.gain.setValueAtTime(volume, time);
      gain.gain.setValueAtTime(0.0001, time + Math.max(0.02, duration - 0.01));
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + duration);
      psgPreviewNodes.push(osc);
      time += duration;
    });
    if (soundMeterBarEl) soundMeterBarEl.style.width = '100%';
    window.setTimeout(() => {
      if (previewToken === psgPreviewToken) stopPsgPreview();
    }, Math.max(120, (time - psgAudioContext.currentTime) * 1000 + 80));
  }

  function typeLabel(asset = {}) {
    if (asset.type === 'image') return 'BG';
    if (asset.type === 'sprite') return 'SPR';
    if (asset.type === 'palette') return 'PAL';
    if (asset.type === 'psg-song') return 'SONG';
    if (asset.type === 'psg-sfx' || asset.type === 'psg-sequence') return 'SFX';
    if (asset.type === 'adpcm') return 'ADPCM';
    if (asset.type === 'cdda-track') return 'CDDA';
    return String(asset.type || '').toUpperCase();
  }

  function filteredAssets() {
    const query = searchEl.value.trim().toLowerCase();
    const filter = typeFilterEl.value;
    return assets.filter((asset) => {
      if (filter !== 'all' && asset.type !== filter) return false;
      if (!query) return true;
      return [asset.id, asset.name, asset.source, asset.type].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }

  function renderRows() {
    const visible = filteredAssets();
    if (!visible.length) {
      rowsEl.innerHTML = '<tr class="asset-row-empty"><td colspan="7">アセットがありません</td></tr>';
      return;
    }
    rowsEl.innerHTML = visible.map((asset) => {
      const generated = generatedInfo(asset);
      const warnings = [...(generated.warnings || []), asset.pathError].filter(Boolean);
      const tileText = isImageAsset(asset)
        ? `${generated.tileCount || 0} / ${generated.paletteCount || 0} pal`
        : isPsgAsset(asset) ? `${asset.options?.period || 512} period`
          : isAudioAsset(asset) ? `${generated.sampleRate || asset.options?.sampleRate || 0} Hz`
            : asset.type === 'palette' ? `${asset.options?.colors?.length || generated.paletteColors?.length || 0} colors`
              : '-';
      return `
        <tr class="asset-row ${asset.id === selectedId ? 'active' : ''}" data-id="${esc(asset.id)}" draggable="true">
          <td class="asset-drag-cell"><span class="drag-handle" title="並び替え">&#8942;&#8942;</span></td>
          <td><span class="asset-type-pill type-${esc(asset.type)}">${esc(typeLabel(asset))}</span></td>
          <td><strong>${esc(asset.name || asset.id)}</strong><div class="pce-assets-muted">${esc(asset.id)}</div></td>
          <td class="asset-path-cell">${esc(asset.source || '(generated)')}</td>
          <td>${esc(tileText)}</td>
          <td>${warnings.length ? `<span class="asset-warning">${warnings.length}</span>` : '<span class="pce-assets-muted">0</span>'}</td>
          <td class="asset-actions-cell"><button class="icon-btn-xs" type="button" data-row-delete="${esc(asset.id)}" title="削除" aria-label="削除">✕</button></td>
        </tr>
      `;
    }).join('');
    rowsEl.querySelectorAll('.asset-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-row-delete]')) return;
        selectAsset(row.dataset.id);
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
        await moveAsset(draggedId, row.dataset.id);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('drag-source');
        rowsEl.querySelectorAll('.drag-over').forEach((entry) => entry.classList.remove('drag-over'));
        draggedId = '';
      });
    });
    rowsEl.querySelectorAll('[data-row-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteAsset(button.dataset.rowDelete));
    });
  }

  function setFieldVisibility(asset) {
    const isImage = isImageAsset(asset);
    const isSprite = imageKind(asset) === 'sprite';
    const isPsg = isPsgAsset(asset);
    const isAudio = isAudioAsset(asset);
    const isCdda = asset?.type === 'cdda-track';
    const isPalette = asset?.type === 'palette';
    function setVisible(key, show) {
      const input = fields[key];
      if (!input) return;
      const row = input.parentElement?.classList.contains('pce-assets-inline-fields') || input.parentElement?.classList.contains('pce-assets-check')
        ? input.parentElement
        : input;
      const labelEl = row.previousElementSibling;
      row.hidden = !show;
      if (labelEl) labelEl.hidden = !show;
    }
    const visibility = {
      paletteBank: isImage || isPalette,
      tileBase: isImage,
      mapBase: isImage && !isSprite,
      x: isImage,
      y: isImage,
      width: isImage,
      height: isImage,
      cellSize: isImage && isSprite,
      transparentIndex: isImage,
      period: isPsg,
      bpm: isPsg,
      steps: isPsg,
      sampleRate: isAudio && !isCdda,
      track: isCdda,
      loop: isAudio || asset?.type === 'psg-song',
    };
    Object.entries(visibility).forEach(([key, show]) => setVisible(key, show));
    if (animationEditorEl) animationEditorEl.hidden = !isSprite;
  }

  function spriteAnimationDefaults(asset = {}) {
    const options = asset.options || {};
    const generated = asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
    const positiveNumber = (value, fallback = 0) => {
      const parsed = asNumber(value, fallback);
      return parsed > 0 ? parsed : fallback;
    };
    const cellWidth = Math.max(16, positiveNumber(options.cellWidth ?? generated.cellWidth, 16));
    const cellHeight = Math.max(16, positiveNumber(options.cellHeight ?? generated.cellHeight, 16));
    const generatedColumns = Math.max(0, positiveNumber(generated.cellColumns ?? generated.columns, 0));
    const generatedRows = Math.max(0, positiveNumber(generated.cellRows ?? generated.rows, 0));
    const generatedWidth = Math.max(0, positiveNumber(generated.width, generatedColumns ? generatedColumns * cellWidth : 0));
    const generatedHeight = Math.max(0, positiveNumber(generated.height, generatedRows ? generatedRows * cellHeight : 0));
    const width = Math.max(cellWidth, positiveNumber(options.width, generatedWidth || cellWidth));
    const height = Math.max(cellHeight, positiveNumber(options.height, generatedHeight || cellHeight));
    return {
      id: 'default',
      name: 'Default',
      frameWidth: width,
      frameHeight: height,
      firstCell: 0,
      frameCount: 1,
      frameDelay: 8,
      frameStrideCells: Math.max(1, Math.ceil(width / cellWidth) * Math.ceil(height / cellHeight)),
      loop: true,
    };
  }

  function animationRowHtml(animation = {}, index = 0) {
    const item = { ...spriteAnimationDefaults(selectedAsset() || {}), ...animation };
    return `
      <section class="pce-assets-animation-row" data-animation-row>
        <div class="pce-assets-animation-head">
          <strong>Animation ${index + 1}</strong>
          <button class="icon-btn-xs" type="button" data-animation-delete title="アニメーション削除" aria-label="アニメーション削除">✕</button>
        </div>
        <label class="form-group"><span class="form-label">ID</span><input class="form-input form-input-mono" data-animation-field="id" value="${esc(item.id)}" /></label>
        <label class="form-group"><span class="form-label">Name</span><input class="form-input" data-animation-field="name" value="${esc(item.name)}" /></label>
        <div class="pce-assets-inline-fields">
          <label class="form-group"><span class="form-label">Frame W</span><input class="form-input" data-animation-field="frameWidth" type="number" min="16" max="256" value="${esc(item.frameWidth)}" /></label>
          <label class="form-group"><span class="form-label">Frame H</span><input class="form-input" data-animation-field="frameHeight" type="number" min="16" max="256" value="${esc(item.frameHeight)}" /></label>
        </div>
        <div class="pce-assets-inline-fields">
          <label class="form-group"><span class="form-label">First cell</span><input class="form-input" data-animation-field="firstCell" type="number" min="0" max="255" value="${esc(item.firstCell)}" /></label>
          <label class="form-group"><span class="form-label">Frames</span><input class="form-input" data-animation-field="frameCount" type="number" min="1" max="64" value="${esc(item.frameCount)}" /></label>
        </div>
        <div class="pce-assets-inline-fields">
          <label class="form-group"><span class="form-label">Delay</span><input class="form-input" data-animation-field="frameDelay" type="number" min="1" max="60" value="${esc(item.frameDelay)}" /></label>
          <label class="form-group"><span class="form-label">Stride</span><input class="form-input" data-animation-field="frameStrideCells" type="number" min="1" max="255" value="${esc(item.frameStrideCells)}" /></label>
        </div>
        <label class="pce-assets-check">
          <input data-animation-field="loop" type="checkbox" ${item.loop !== false ? 'checked' : ''} />
          <span>Loop</span>
        </label>
      </section>
    `;
  }

  function collectAnimationRows() {
    if (!animationEditorEl || animationEditorEl.hidden) return [];
    return Array.from(animationEditorEl.querySelectorAll('[data-animation-row]')).map((row, index) => {
      const value = (name) => row.querySelector(`[data-animation-field="${name}"]`);
      const id = safeId(value('id')?.value, index === 0 ? 'default' : `anim_${index + 1}`);
      return {
        id,
        name: String(value('name')?.value || id).trim(),
        frameWidth: asNumber(value('frameWidth')?.value, 16),
        frameHeight: asNumber(value('frameHeight')?.value, 16),
        firstCell: asNumber(value('firstCell')?.value, 0),
        frameCount: asNumber(value('frameCount')?.value, 1),
        frameDelay: asNumber(value('frameDelay')?.value, 8),
        frameStrideCells: asNumber(value('frameStrideCells')?.value, 1),
        loop: Boolean(value('loop')?.checked),
      };
    });
  }

  function renderAnimationEditor(asset) {
    if (!animationEditorEl) return;
    const isSprite = asset?.type === 'sprite' || asset?.options?.kind === 'sprite';
    animationEditorEl.hidden = !isSprite;
    if (!isSprite) {
      animationEditorEl.innerHTML = '';
      return;
    }
    const animations = Array.isArray(asset.options?.animations) && asset.options.animations.length
      ? asset.options.animations
      : [spriteAnimationDefaults(asset)];
    animationEditorEl.innerHTML = `
      <div class="pce-assets-animation-title">
        <span>Sprite animations</span>
        <button class="btn-sm" type="button" data-animation-add>追加</button>
      </div>
      ${animations.map(animationRowHtml).join('')}
    `;
  }

  function fillForm(asset) {
    const options = asset?.options || {};
    noSelectionEl.hidden = Boolean(asset);
    detailFieldsEl.hidden = !asset;
    saveButton.disabled = !asset;
    deleteButton.disabled = !asset;
    formErrorEl.textContent = '';
    if (!asset) {
      stopPsgPreview();
      previewImgEl.hidden = true;
      audioPreviewEl.hidden = true;
      soundPreviewEl.hidden = true;
      noPreviewEl.hidden = false;
      previewInfoEl.textContent = '';
      soundCaptionEl.textContent = '';
      generatedStatsEl.innerHTML = '';
      generatedFilesEl.innerHTML = '';
      paletteEl.innerHTML = '';
      paletteEl.hidden = false;
      diagnosticsEl.innerHTML = '<p class="asset-no-selection-hint">診断対象がありません</p>';
      renderAnimationEditor(null);
      return;
    }
    fields.id.value = asset.id || '';
    fields.type.value = asset.type || 'image';
    fields.name.value = asset.name || '';
    fields.source.value = asset.source || '';
    fields.paletteBank.value = options.paletteBank ?? 0;
    fields.tileBase.value = options.tileBase ?? (asset.type === 'sprite' ? 384 : 32);
    fields.mapBase.value = options.mapBase ?? 0;
    fields.x.value = options.x ?? 0;
    fields.y.value = options.y ?? 0;
    fields.width.value = options.width ?? 0;
    fields.height.value = options.height ?? 0;
    fields.cellSize.value = `${options.cellWidth || 16}x${options.cellHeight || 16}`;
    fields.transparentIndex.value = options.transparentIndex ?? 0;
    fields.period.value = options.period ?? 512;
    fields.bpm.value = options.bpm ?? 150;
    fields.steps.value = options.steps ?? 32;
    fields.sampleRate.value = options.sampleRate ?? 16000;
    fields.track.value = options.track ?? 2;
    fields.loop.checked = Boolean(options.loop);
    setFieldVisibility(asset);
    renderAnimationEditor(asset);
    renderGenerated(asset);
    void loadPreview(asset);
  }

  function collectFormAsset() {
    const current = selectedAsset() || {};
    const type = fields.type.value;
    const [cellWidth, cellHeight] = String(fields.cellSize.value || '16x16').split('x').map((value) => asNumber(value, 16));
    const options = type === 'psg-song' || type === 'psg-sfx' || type === 'psg-sequence'
      ? {
          ...(current.options || {}),
          kind: type === 'psg-song' ? 'song' : 'sfx',
          period: asNumber(fields.period.value, 512),
          bpm: asNumber(fields.bpm.value, 150),
          steps: asNumber(fields.steps.value, 32),
          loop: type === 'psg-song' && fields.loop.checked,
        }
      : type === 'adpcm'
        ? {
            ...(current.options || {}),
            sampleRate: asNumber(fields.sampleRate.value, 16000),
            loop: fields.loop.checked,
          }
        : type === 'cdda-track'
          ? {
              ...(current.options || {}),
              track: asNumber(fields.track.value, 2),
              loop: fields.loop.checked,
            }
          : type === 'palette'
            ? {
                ...(current.options || {}),
                target: current.options?.target || 'bg',
                paletteBank: asNumber(fields.paletteBank.value, 0),
              }
      : {
          ...(current.options || {}),
          kind: type === 'sprite' ? 'sprite' : 'background',
          paletteBank: asNumber(fields.paletteBank.value, 0),
          tileBase: asNumber(fields.tileBase.value, type === 'sprite' ? 384 : 32),
          mapBase: asNumber(fields.mapBase.value, 0),
          x: asNumber(fields.x.value, 0),
          y: asNumber(fields.y.value, 0),
          width: asNumber(fields.width.value, 0),
          height: asNumber(fields.height.value, 0),
          cellWidth,
          cellHeight,
          transparentIndex: asNumber(fields.transparentIndex.value, 0),
          animations: type === 'sprite' ? collectAnimationRows() : [],
        };
    return {
      ...current,
      id: fields.id.value.trim(),
      type,
      name: fields.name.value.trim() || fields.id.value.trim(),
      source: fields.source.value.trim(),
      options,
      data: current.data || {},
    };
  }

  async function loadPreview(asset) {
    stopPsgPreview();
    previewImgEl.hidden = true;
    audioPreviewEl.hidden = true;
    soundPreviewEl.hidden = true;
    noPreviewEl.hidden = false;
    previewInfoEl.textContent = '';
    soundCaptionEl.textContent = '';
    if (audioPreviewEl.src) {
      audioPreviewEl.pause();
      audioPreviewEl.removeAttribute('src');
    }
    if (isPsgAsset(asset)) {
      const period = psgPeriod(asset);
      const frequency = psgFrequency(period);
      soundPreviewEl.hidden = false;
      noPreviewEl.hidden = true;
      soundCaptionEl.textContent = `${typeLabel(asset)} / period ${period} / ${Math.round(frequency)} Hz`;
      previewInfoEl.textContent = asset.type === 'psg-song'
        ? 'PSG 矩形波シーケンスをプレビューします'
        : 'PSG SFX をワンショット再生します';
      return;
    }
    if (!asset?.source) return;
    const ext = extname(asset.source);
    if (!IMAGE_EXTS.includes(ext) && !AUDIO_EXTS.includes(ext)) return;
    const result = await api.electronAPI.previewAssetSource(asset.source);
    if (!result?.ok || !result.dataUrl) {
      previewInfoEl.textContent = result?.error || 'プレビューを取得できませんでした';
      return;
    }
    if (AUDIO_EXTS.includes(ext)) {
      audioPreviewEl.src = result.dataUrl;
      audioPreviewEl.hidden = false;
    } else {
      previewImgEl.src = result.dataUrl;
      previewImgEl.hidden = false;
    }
    noPreviewEl.hidden = true;
    previewInfoEl.textContent = `${result.mime || ''} / ${Math.round((result.size || 0) / 1024)} KB`;
  }

  function renderGenerated(asset) {
    const generated = generatedInfo(asset);
    const warnings = [...(generated.warnings || []), asset.pathError].filter(Boolean);
    let files = [];
    let waveform = '';

    paletteEl.hidden = true;
    paletteEl.innerHTML = '';

    if (isImageAsset(asset)) {
      generatedStatsEl.innerHTML = `
        <div class="pce-assets-stat"><span>${asset.type === 'sprite' ? 'Pattern' : 'Tile'}</span><strong>${esc(generated.tileCount || 0)}</strong></div>
        <div class="pce-assets-stat"><span>Palette</span><strong>${esc(generated.paletteCount || 0)}</strong></div>
        <div class="pce-assets-stat"><span>VRAM bytes</span><strong>${esc(generated.vramBytes || 0)}</strong></div>
      `;
      files = [
        ['palette', generated.paletteFile],
        [asset.type === 'sprite' ? 'patterns' : 'tiles', generated.tilesFile],
        ['map', asset.type === 'sprite' ? '' : generated.mapFile],
        ['preview', generated.previewFile],
      ].filter((entry) => entry[1]);
      const colors = generated.paletteColors?.length ? generated.paletteColors : [];
      paletteEl.hidden = false;
      paletteEl.innerHTML = colors.length
        ? colors.slice(0, 64).map((color, index) => `<span class="palette-swatch ${index % 16 === 0 ? 'is-transparent' : ''}" style="background:${esc(color)}" title="${index}: ${esc(color)}"></span>`).join('')
        : Array.from({ length: 16 }, (_unused, index) => `<span class="palette-swatch is-empty ${index === 0 ? 'is-transparent' : ''}" title="${index}"></span>`).join('');
    } else if (asset.type === 'palette') {
      const colors = asset.options?.colors || generated.paletteColors || [];
      generatedStatsEl.innerHTML = `
        <div class="pce-assets-stat"><span>Target</span><strong>${esc(asset.options?.target || 'bg')}</strong></div>
        <div class="pce-assets-stat"><span>Palette bank</span><strong>${esc(asset.options?.paletteBank ?? 0)}</strong></div>
        <div class="pce-assets-stat"><span>Colors</span><strong>${esc(colors.length)}</strong></div>
      `;
      files = generated.paletteFile ? [['palette', generated.paletteFile]] : [];
      paletteEl.hidden = false;
      paletteEl.innerHTML = colors.length
        ? colors.slice(0, 64).map((color, index) => `<span class="palette-swatch ${index % 16 === 0 ? 'is-transparent' : ''}" style="background:${esc(color)}" title="${index}: ${esc(color)}"></span>`).join('')
        : Array.from({ length: 16 }, (_unused, index) => `<span class="palette-swatch is-empty ${index === 0 ? 'is-transparent' : ''}" title="${index}"></span>`).join('');
    } else if (isPsgAsset(asset)) {
      const period = psgPeriod(asset);
      const pattern = psgPattern(asset);
      generatedStatsEl.innerHTML = `
        <div class="pce-assets-stat"><span>Sound</span><strong>${esc(typeLabel(asset))}</strong></div>
        <div class="pce-assets-stat"><span>Period / Hz</span><strong>${esc(`${period} / ${Math.round(psgFrequency(period))}`)}</strong></div>
        <div class="pce-assets-stat"><span>Steps</span><strong>${esc(asset.options?.steps || pattern.length || 0)}</strong></div>
      `;
      files = asset.source ? [['source', asset.source]] : [];
      const rows = pattern.slice(0, 16).map((step, index) => {
        const stepPeriod = Math.max(1, asNumber(step.period, period));
        return `<div><span>${index + 1}</span><code>period ${esc(stepPeriod)}</code><strong>${esc(Math.round(psgFrequency(stepPeriod)))} Hz</strong></div>`;
      }).join('');
      diagnosticsEl.innerHTML = `
        <div class="pce-assets-sequence">${rows}</div>
        ${warnings.length ? warnings.map((warning) => `<div class="asset-warning">${esc(warning)}</div>`).join('') : '<p class="pce-assets-muted">警告はありません</p>'}
      `;
    } else if (isAudioAsset(asset)) {
      generatedStatsEl.innerHTML = `
        <div class="pce-assets-stat"><span>Sample rate</span><strong>${esc(generated.sampleRate || asset.options?.sampleRate || 0)}</strong></div>
        <div class="pce-assets-stat"><span>Seconds</span><strong>${esc(Number(generated.durationSeconds || 0).toFixed(2))}</strong></div>
        <div class="pce-assets-stat"><span>Bytes</span><strong>${esc(generated.byteLength || 0)}</strong></div>
      `;
      files = [
        ['audio', generated.outputFile],
        ['source', asset.source],
      ].filter((entry) => entry[1]);
      waveform = Array.isArray(generated.waveform) && generated.waveform.length
        ? `<div class="pce-assets-waveform">${generated.waveform.slice(0, 64).map((value) => `<span style="height:${Math.max(2, Math.round(Number(value) * 30))}px"></span>`).join('')}</div>`
        : '';
    } else {
      generatedStatsEl.innerHTML = `
        <div class="pce-assets-stat"><span>Type</span><strong>${esc(asset.type || '-')}</strong></div>
        <div class="pce-assets-stat"><span>Source</span><strong>${esc(asset.source ? 'あり' : 'なし')}</strong></div>
        <div class="pce-assets-stat"><span>Status</span><strong>-</strong></div>
      `;
    }
    generatedFilesEl.innerHTML = files.length
      ? files.map(([label, file]) => `<div><span>${esc(label)}</span><code>${esc(file)}</code></div>`).join('')
      : '<p class="asset-no-selection-hint">まだ変換結果がありません</p>';
    if (!isPsgAsset(asset)) {
      diagnosticsEl.innerHTML = warnings.length
        ? `${waveform}${warnings.map((warning) => `<div class="asset-warning">${esc(warning)}</div>`).join('')}`
        : waveform || '<p class="pce-assets-muted">警告はありません</p>';
    }
  }

  function selectAsset(id) {
    selectedId = id || '';
    fillForm(selectedAsset());
    renderRows();
  }

  async function reload() {
    const result = await api.electronAPI.listAssets();
    if (!result?.ok) {
      rowsEl.innerHTML = `<tr class="asset-row-empty"><td colspan="7">${esc(result?.error || 'PCE assets を読み込めません')}</td></tr>`;
      return;
    }
    assets = result.assets || [];
    if (selectedId && !assets.some((asset) => asset.id === selectedId)) selectedId = '';
    renderRows();
    fillForm(selectedAsset());
  }

  async function saveSelected(event) {
    event.preventDefault();
    try {
      const asset = collectFormAsset();
      const result = await api.electronAPI.upsertAsset(asset);
      if (!result?.ok) throw new Error(result?.error || '保存に失敗しました');
      selectedId = asset.id;
      logger.info(`PCE asset saved: ${asset.id}`);
      await reload();
    } catch (err) {
      formErrorEl.textContent = err.message || String(err);
    }
  }

  function askDelete(assetId) {
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `${plugin.id}-delete-modal-${Date.now()}`,
        panelClassName: 'app-panel app-panel-sm',
        html: `
          <div class="page-header modal-header">
            <h2>アセット削除</h2>
            <button class="icon-btn" type="button" data-decision="cancel">✕</button>
          </div>
          <div class="settings-form compact-form pce-assets-modal">
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
    if (!assetId) return;
    if (!(await askDelete(assetId))) return;
    const result = await api.electronAPI.deleteAsset(assetId);
    if (!result?.ok) {
      formErrorEl.textContent = result?.error || '削除に失敗しました';
      return;
    }
    if (selectedId === assetId) selectedId = '';
    await reload();
  }

  async function moveAsset(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const ids = assets.map((asset) => asset.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const result = await api.electronAPI.reorderAssets(ids);
    if (!result?.ok) {
      formErrorEl.textContent = result?.error || '並び替えに失敗しました';
      return;
    }
    assets = result.assets || assets;
    renderRows();
  }

  async function convertImageToIndexed16(options = {}) {
    const sourcePath = String(options.sourcePath || '').trim();
    let sourceDataUrl = String(options.sourceDataUrl || '').trim();
    const sourceExt = extname(sourcePath);
    if (!sourceDataUrl) {
      const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
      if (!read?.ok || !read.dataUrl) {
        return { canceled: true, warning: read?.error || '画像を読み込めません' };
      }
      sourceDataUrl = read.dataUrl;
    }

    const resizeCapability = api.capabilities.get('image-resize');
    if (!resizeCapability?.openResizeModal) {
      return {
        canceled: true,
        warning: '画像リサイズコンバータープラグインが無効または未インストールです',
      };
    }

    const sourceImage = await loadImageFromDataUrl(sourceDataUrl);
    let workingDataUrl = sourceDataUrl;
    const notes = [];
    const resizeResult = await resizeCapability.openResizeModal(
      sourceDataUrl,
      sourceImage.naturalWidth || sourceImage.width,
      sourceImage.naturalHeight || sourceImage.height,
      { targetSize: options.targetSize || null },
    );
    if (!resizeResult?.ok) {
      return { canceled: true, warning: 'リサイズ/クリッピングをキャンセルしました' };
    }
    if (resizeResult.dataUrl && resizeResult.dataUrl !== sourceDataUrl) {
      workingDataUrl = resizeResult.dataUrl;
      notes.push('リサイズ/クリッピングを適用しました');
    }

    const { image, imageData } = await imageDataFromDataUrl(workingDataUrl);
    const quantizeCapability = api.capabilities.get('image-quantize');
    const countColors = quantizeCapability?.countUniqueColors || countUniquePceColors;
    const uniqueColors = countColors(imageData);
    if (uniqueColors > 16) {
      if (!quantizeCapability?.openQuantizeModal) {
        return {
          canceled: true,
          warning: '画像減色コンバータープラグインが無効または未インストールです',
        };
      }
      const quantized = await quantizeCapability.openQuantizeModal(workingDataUrl, { sourcePath });
      if (!quantized?.ok || !quantized.dataUrl) {
        return { canceled: true, warning: '減色変換をキャンセルしました' };
      }
      workingDataUrl = quantized.dataUrl;
      notes.push(`減色変換を適用しました (${uniqueColors} colors -> 16 colors)`);
    }

    const finalImage = await loadImageFromDataUrl(workingDataUrl);
    return {
      canceled: false,
      convertedDataUrl: workingDataUrl !== sourceDataUrl || sourceExt === '.bmp' ? workingDataUrl : '',
      targetExtension: '.png',
      width: finalImage.naturalWidth || finalImage.width || image.naturalWidth || image.width || 0,
      height: finalImage.naturalHeight || finalImage.height || image.naturalHeight || image.height || 0,
      warning: notes.join(' / '),
    };
  }

  async function openImportWizard(defaultKind = 'background', importFile = null) {
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `${plugin.id}-import-modal-${Date.now()}`,
        panelClassName: 'app-panel pce-assets-import-panel',
        html: `
          <div class="page-header modal-header">
            <h2>PCE 画像取り込み</h2>
            <button class="icon-btn" type="button" data-import-cancel>✕</button>
          </div>
          <form class="settings-form compact-form pce-assets-import-form">
            <div class="pce-assets-import-grid">
              <label class="form-group">
                <span class="form-label">種別</span>
                <select class="form-select" name="kind">
                  <option value="background" ${defaultKind !== 'sprite' ? 'selected' : ''}>BG image</option>
                  <option value="sprite" ${defaultKind === 'sprite' ? 'selected' : ''}>Sprite sheet</option>
                </select>
              </label>
              <label class="form-group">
                <span class="form-label">ID</span>
                <input class="form-input form-input-mono" name="id" />
              </label>
              <label class="form-group">
                <span class="form-label">Name</span>
                <input class="form-input" name="name" />
              </label>
              <label class="form-group">
                <span class="form-label">Palette bank</span>
                <input class="form-input" name="paletteBank" type="number" min="0" max="15" value="0" />
              </label>
              <label class="form-group">
                <span class="form-label">Tile base</span>
                <input class="form-input" name="tileBase" type="number" min="0" max="2047" value="${defaultKind === 'sprite' ? '384' : '32'}" />
              </label>
              <label class="form-group">
                <span class="form-label">Map base</span>
                <input class="form-input" name="mapBase" type="number" min="0" max="2047" value="0" />
              </label>
              <label class="form-group">
                <span class="form-label">Cell size</span>
                <select class="form-select" name="cellSize">
                  ${SPRITE_CELL_SIZES.map((size) => `<option value="${size}">${size}</option>`).join('')}
                </select>
              </label>
              <label class="form-group">
                <span class="form-label">Output width</span>
                <input class="form-input" name="outputWidth" type="number" min="8" max="320" step="8" value="${defaultKind === 'sprite' ? '64' : '288'}" />
              </label>
              <label class="form-group">
                <span class="form-label">Output height</span>
                <input class="form-input" name="outputHeight" type="number" min="8" max="224" step="8" value="${defaultKind === 'sprite' ? '128' : '128'}" />
              </label>
              <label class="form-group">
                <span class="form-label">Transparent index</span>
                <input class="form-input" name="transparentIndex" type="number" min="0" max="15" value="0" />
              </label>
            </div>
            <div class="pce-assets-import-source">
              <button class="btn-sm" type="button" data-pick-image>画像を選択</button>
              <code data-source-label>未選択</code>
            </div>
            <div class="image-preview-frame pce-assets-import-preview">
              <img data-import-preview alt="Import preview" hidden />
              <div class="inline-no-preview" data-import-no-preview>PNG / BMP を選択してください</div>
            </div>
            <div class="form-hint" data-import-hint>リサイズ/クリッピング後に16色へ減色し、最後にPCE BG/Sprite形式へ変換します。</div>
            <div class="form-error" data-import-error></div>
            <div class="form-actions-inline modal-actions-end">
              <button class="btn-sm" type="button" data-import-cancel>キャンセル</button>
              <button class="btn-primary" type="submit">変換して保存</button>
            </div>
          </form>
        `,
      });
      const form = modal.panel.querySelector('form');
      const sourceLabel = modal.panel.querySelector('[data-source-label]');
      const preview = modal.panel.querySelector('[data-import-preview]');
      const noPreview = modal.panel.querySelector('[data-import-no-preview]');
      const error = modal.panel.querySelector('[data-import-error]');
      const kindSelect = form.elements.kind;
      const tileBaseInput = form.elements.tileBase;
      const mapBaseInput = form.elements.mapBase;
      const cellSizeSelect = form.elements.cellSize;
      const outputWidthInput = form.elements.outputWidth;
      const outputHeightInput = form.elements.outputHeight;
      let sourcePath = importFile?.sourcePath || '';
      let sourceFileName = importFile?.fileName || '';
      let sourceDataUrl = '';

      function syncKind() {
        const isSprite = kindSelect.value === 'sprite';
        cellSizeSelect.disabled = !isSprite;
        mapBaseInput.disabled = isSprite;
        if (!tileBaseInput.dataset.touched) tileBaseInput.value = isSprite ? '384' : '32';
        if (!outputWidthInput.dataset.touched) outputWidthInput.value = isSprite ? '64' : '288';
        if (!outputHeightInput.dataset.touched) outputHeightInput.value = '128';
      }

      async function setSource(filePath) {
        sourcePath = filePath || '';
        sourceFileName = sourcePath.split(/[\\/]/).pop() || '';
        form.elements.id.value = sourceFileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
        form.elements.name.value = sourceFileName.replace(/\.[^.]+$/, '');
        sourceLabel.textContent = sourcePath || '未選択';
        sourceDataUrl = '';
        preview.hidden = true;
        noPreview.hidden = false;
        if (!sourcePath) return;
        const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
        if (!read?.ok) {
          error.textContent = read?.error || '画像を読み込めません';
          return;
        }
        sourceDataUrl = read.dataUrl;
        preview.src = sourceDataUrl;
        preview.hidden = false;
        noPreview.hidden = true;
      }

      modal.panel.querySelector('[data-pick-image]').addEventListener('click', async () => {
        error.textContent = '';
        const picked = await api.electronAPI.pickFile({
          properties: ['openFile'],
          filters: [{ name: 'PNG / BMP', extensions: ['png', 'bmp'] }],
        });
        const filePath = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
        if (picked?.canceled || !filePath) return;
        await setSource(filePath);
      });
      tileBaseInput.addEventListener('input', () => { tileBaseInput.dataset.touched = '1'; });
      outputWidthInput.addEventListener('input', () => { outputWidthInput.dataset.touched = '1'; });
      outputHeightInput.addEventListener('input', () => { outputHeightInput.dataset.touched = '1'; });
      kindSelect.addEventListener('change', syncKind);
      modal.panel.querySelectorAll('[data-import-cancel]').forEach((button) => {
        button.addEventListener('click', () => {
          modal.close();
          modal.destroy?.();
          resolve(null);
        }, { once: true });
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        if (!sourcePath) {
          error.textContent = '画像を選択してください';
          return;
        }
        try {
          const [cellWidth, cellHeight] = String(form.elements.cellSize.value || '16x16').split('x').map((value) => asNumber(value, 16));
          const outputWidth = asNumber(form.elements.outputWidth.value, form.elements.kind.value === 'sprite' ? 64 : 288);
          const outputHeight = asNumber(form.elements.outputHeight.value, 128);
          if (outputWidth <= 0 || outputHeight <= 0) {
            throw new Error('Output width / height を正の値で指定してください');
          }
          const converted = await convertImageToIndexed16({
            sourcePath,
            sourceDataUrl,
            targetSize: { width: outputWidth, height: outputHeight },
          });
          if (converted?.canceled) {
            error.textContent = converted.warning || '画像取り込みをキャンセルしました';
            return;
          }
          const finalWidth = asNumber(converted.width, outputWidth);
          const finalHeight = asNumber(converted.height, outputHeight);
          if (form.elements.kind.value === 'sprite' && (finalWidth % 16 !== 0 || finalHeight % 16 !== 0)) {
            throw new Error('Sprite sheet の出力サイズは16px単位にしてください');
          }
          if (form.elements.kind.value !== 'sprite' && (finalWidth % 8 !== 0 || finalHeight % 8 !== 0)) {
            throw new Error('BG image の出力サイズは8px単位にしてください');
          }
          const result = await api.electronAPI.importAssetImage({
            sourcePath,
            sourceFileName,
            convertedDataUrl: converted.convertedDataUrl || '',
            kind: form.elements.kind.value,
            id: form.elements.id.value,
            name: form.elements.name.value,
            paletteBank: asNumber(form.elements.paletteBank.value, 0),
            tileBase: asNumber(form.elements.tileBase.value, form.elements.kind.value === 'sprite' ? 384 : 32),
            mapBase: asNumber(form.elements.mapBase.value, 0),
            cellWidth,
            cellHeight,
            transparentIndex: asNumber(form.elements.transparentIndex.value, 0),
            width: finalWidth,
            height: finalHeight,
          });
          if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
          logger.info(`PCE image imported: ${result.asset?.id || form.elements.id.value}${converted.warning ? ` (${converted.warning})` : ''}`);
          modal.close();
          modal.destroy?.();
          resolve(result.asset || null);
        } catch (err) {
          error.textContent = err.message || String(err);
        }
      });
      syncKind();
      if (sourcePath) void setSource(sourcePath);
      modal.open();
    }).then(async (asset) => {
      if (asset) {
        selectedId = asset.id;
        await reload();
      }
      return asset;
    });
  }

  async function openAudioImportWizard(defaultKind = 'adpcm', importFile = null) {
    return new Promise((resolve) => {
      const modal = api.createModal({
        id: `${plugin.id}-audio-import-modal-${Date.now()}`,
        panelClassName: 'app-panel pce-assets-import-panel',
        html: `
          <div class="page-header modal-header">
            <h2>PCE 音声取り込み</h2>
            <button class="icon-btn" type="button" data-import-cancel>✕</button>
          </div>
          <form class="settings-form compact-form pce-assets-import-form">
            <div class="pce-assets-import-grid">
              <label class="form-group">
                <span class="form-label">種別</span>
                <select class="form-select" name="kind">
                  <option value="adpcm" ${defaultKind !== 'cdda-track' ? 'selected' : ''}>ADPCM sample</option>
                  <option value="cdda-track" ${defaultKind === 'cdda-track' ? 'selected' : ''}>CD-DA track</option>
                </select>
              </label>
              <label class="form-group">
                <span class="form-label">ID</span>
                <input class="form-input form-input-mono" name="id" />
              </label>
              <label class="form-group">
                <span class="form-label">Name</span>
                <input class="form-input" name="name" />
              </label>
              <label class="form-group" data-adpcm-only>
                <span class="form-label">ADPCM sample rate</span>
                <input class="form-input" name="sampleRate" type="number" min="4000" max="32000" value="16000" />
              </label>
              <label class="form-group" data-cdda-only>
                <span class="form-label">CD-DA track</span>
                <input class="form-input" name="track" type="number" min="2" max="99" value="2" />
              </label>
              <label class="form-group">
                <span class="form-label">Loop</span>
                <label class="pce-assets-check"><input name="loop" type="checkbox" /><span>loop</span></label>
              </label>
            </div>
            <div class="pce-assets-import-source">
              <button class="btn-sm" type="button" data-pick-audio>WAVを選択</button>
              <code data-source-label>未選択</code>
            </div>
            <audio controls data-audio-preview hidden></audio>
            <div class="form-hint" data-import-hint>ADPCM は OKI/MSM5205 系4bit、CD-DA は 44.1kHz/16bit/stereo WAV に正規化します。</div>
            <div class="form-error" data-import-error></div>
            <div class="form-actions-inline modal-actions-end">
              <button class="btn-sm" type="button" data-import-cancel>キャンセル</button>
              <button class="btn-primary" type="submit">変換して保存</button>
            </div>
          </form>
        `,
      });
      const form = modal.panel.querySelector('form');
      const sourceLabel = modal.panel.querySelector('[data-source-label]');
      const preview = modal.panel.querySelector('[data-audio-preview]');
      const error = modal.panel.querySelector('[data-import-error]');
      const kindSelect = form.elements.kind;
      let sourcePath = importFile?.sourcePath || '';
      let sourceFileName = importFile?.fileName || '';

      function syncKind() {
        const isCdda = kindSelect.value === 'cdda-track';
        modal.panel.querySelectorAll('[data-cdda-only]').forEach((el) => { el.hidden = !isCdda; });
        modal.panel.querySelectorAll('[data-adpcm-only]').forEach((el) => { el.hidden = isCdda; });
      }

      async function setSource(filePath) {
        sourcePath = filePath || '';
        sourceFileName = sourcePath.split(/[\\/]/).pop() || '';
        form.elements.id.value = sourceFileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
        form.elements.name.value = sourceFileName.replace(/\.[^.]+$/, '');
        sourceLabel.textContent = sourcePath || '未選択';
        preview.hidden = true;
        if (!sourcePath) return;
        const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
        if (!read?.ok) {
          error.textContent = read?.error || '音声を読み込めません';
          return;
        }
        preview.src = read.dataUrl;
        preview.hidden = false;
      }

      modal.panel.querySelector('[data-pick-audio]').addEventListener('click', async () => {
        error.textContent = '';
        const picked = await api.electronAPI.pickFile({
          properties: ['openFile'],
          filters: [{ name: 'WAV', extensions: ['wav'] }],
        });
        const filePath = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
        if (picked?.canceled || !filePath) return;
        await setSource(filePath);
      });
      kindSelect.addEventListener('change', syncKind);
      modal.panel.querySelectorAll('[data-import-cancel]').forEach((button) => {
        button.addEventListener('click', () => {
          modal.close();
          modal.destroy?.();
          resolve(null);
        }, { once: true });
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        if (!sourcePath) {
          error.textContent = 'WAVを選択してください';
          return;
        }
        try {
          const result = await api.electronAPI.importAssetAudio({
            sourcePath,
            sourceFileName,
            kind: form.elements.kind.value,
            id: form.elements.id.value,
            name: form.elements.name.value,
            sampleRate: asNumber(form.elements.sampleRate?.value, 16000),
            track: asNumber(form.elements.track?.value, 2),
            loop: Boolean(form.elements.loop?.checked),
          });
          if (!result?.ok) throw new Error(result?.error || '取り込みに失敗しました');
          logger.info(`PCE audio imported: ${result.asset?.id || form.elements.id.value}`);
          modal.close();
          modal.destroy?.();
          resolve(result.asset || null);
        } catch (err) {
          error.textContent = err.message || String(err);
        }
      });
      syncKind();
      if (sourcePath) void setSource(sourcePath);
      modal.open();
    }).then(async (asset) => {
      if (asset) {
        selectedId = asset.id;
        await reload();
      }
      return asset;
    });
  }

  root.querySelectorAll('[data-accordion]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.accordion;
      const body = root.querySelector(`[data-accordion-body="${key}"]`);
      const expanded = button.getAttribute('aria-expanded') !== 'false';
      button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      body?.classList.toggle('is-collapsed', expanded);
    });
  });

  searchEl.addEventListener('input', renderRows);
  typeFilterEl.addEventListener('change', renderRows);
  fields.type.addEventListener('change', () => {
    const draftAsset = collectFormAsset();
    setFieldVisibility(draftAsset);
    renderGenerated(draftAsset);
    void loadPreview(draftAsset);
  });
  formEl.addEventListener('submit', saveSelected);
  deleteButton.addEventListener('click', () => deleteAsset());
  root.querySelector('[data-action="preview-play"]').addEventListener('click', () => playPsgPreview());
  root.querySelector('[data-action="preview-stop"]').addEventListener('click', stopPsgPreview);
  root.querySelector('[data-action="refresh"]').addEventListener('click', reload);
  animationEditorEl?.addEventListener('click', (event) => {
    const add = event.target?.closest?.('[data-animation-add]');
    if (add) {
      const rows = collectAnimationRows();
      rows.push({
        ...spriteAnimationDefaults(selectedAsset() || collectFormAsset()),
        id: `anim_${rows.length + 1}`,
        name: `Animation ${rows.length + 1}`,
      });
      const draft = { ...collectFormAsset(), options: { ...collectFormAsset().options, animations: rows } };
      renderAnimationEditor(draft);
      return;
    }
    const del = event.target?.closest?.('[data-animation-delete]');
    if (del) {
      del.closest('[data-animation-row]')?.remove();
    }
  });
  root.querySelector('[data-action="import-bg"]').addEventListener('click', () => openImportWizard('background'));
  root.querySelector('[data-action="import-sprite"]').addEventListener('click', () => openImportWizard('sprite'));
  root.querySelector('[data-action="import-adpcm"]').addEventListener('click', () => openAudioImportWizard('adpcm'));
  root.querySelector('[data-action="import-cdda"]').addEventListener('click', () => openAudioImportWizard('cdda-track'));
  root.querySelector('[data-action="new-psg"]').addEventListener('click', () => {
    const id = `beep_${Date.now()}`;
    assets.push({
      id,
      type: 'psg-sfx',
      name: 'Beep',
      source: 'assets/sound/beep.json',
      options: { period: 512, bpm: 150, steps: 16, loop: false },
      data: {},
    });
    selectedId = id;
    renderRows();
    fillForm(selectedAsset());
  });
  root.querySelector('[data-action="new-palette"]').addEventListener('click', () => {
    const id = `palette_${Date.now()}`;
    assets.push({
      id,
      type: 'palette',
      name: 'Palette',
      source: '',
      options: {
        target: 'bg',
        paletteBank: 0,
        colors: ['#000000', '#ffffff', '#777777', '#ffcc33'],
      },
      data: {},
    });
    selectedId = id;
    renderRows();
    fillForm(selectedAsset());
  });

  registerCapability('asset-manager', { pluginId: plugin.id, reload, openImportWizard });
  registerCapability('asset-import-handler', {
    pluginId: plugin.id,
    convertImageToIndexed16,
    openImportWizard,
    async handleImport(file = {}) {
      const ext = String(file.ext || extname(file.sourcePath || file.path || '')).toLowerCase();
      if (IMAGE_EXTS.includes(ext)) {
        return openImportWizard(file.kind === 'sprite' ? 'sprite' : 'background', {
          sourcePath: file.sourcePath || file.path,
          fileName: file.fileName || '',
        });
      }
      if (AUDIO_EXTS.includes(ext)) {
        return openAudioImportWizard(file.kind === 'cdda-track' ? 'cdda-track' : 'adpcm', {
          sourcePath: file.sourcePath || file.path,
          fileName: file.fileName || '',
        });
      }
      return null;
    },
  });
  registerCapability('audio-import-handler', {
    pluginId: plugin.id,
    async handleImport(file = {}) {
      const ext = String(file.ext || extname(file.sourcePath || file.path || '')).toLowerCase();
      if (!AUDIO_EXTS.includes(ext)) return null;
      return openAudioImportWizard(file.kind === 'cdda-track' ? 'cdda-track' : 'adpcm', {
        sourcePath: file.sourcePath || file.path,
        fileName: file.fileName || '',
      });
    },
  });
  registerCapability('asset-type-provider', {
    priority: 10,
    getTypeInfo(file = {}) {
      const ext = String(file.ext || '').toLowerCase();
      if (IMAGE_EXTS.includes(ext)) {
        return {
          initialType: 'image',
          allowedTypes: ['image', 'sprite'],
          defaultSubdir: 'assets/images',
          isImageInput: true,
        };
      }
      if (ext === '.wav') {
        return { initialType: 'adpcm', allowedTypes: ['adpcm', 'cdda-track'], defaultSubdir: 'assets/adpcm' };
      }
      if (['.vgm', '.json'].includes(ext)) {
        return { initialType: 'psg-sfx', allowedTypes: ['psg-song', 'psg-sfx'], defaultSubdir: 'assets/sound' };
      }
      return null;
    },
  });

  void reload();
  return { deactivate: stopPsgPreview };
}
