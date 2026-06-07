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

function clamp(value, min, max, fallback) {
  return Math.max(min, Math.min(max, asNumber(value, fallback)));
}

function drawGlyph(ctx, bitmap, px, py, scale = 1) {
  if (!Array.isArray(bitmap)) return;
  ctx.fillStyle = '#ffffff';
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (bitmap[(y * 16) + x]) ctx.fillRect(px + (x * scale), py + (y * scale), scale, scale);
    }
  }
}

export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.innerHTML = `
    <div class="pce-font-shell">
      <aside class="pce-font-settings">
        <div class="pce-font-header">
          <h2>PCE Font</h2>
          <p>16x16 / 18文字x4行の VN メッセージ用ビットマップフォントを作成します。</p>
        </div>
        <form class="settings-form compact-form pce-font-form" data-role="form">
          <label class="form-group">
            <span class="form-label">Font file</span>
            <div class="pce-font-path-row">
              <input class="form-input form-input-mono" name="fontPath" placeholder="未指定ならシステムフォントを自動使用" />
              <button class="btn-sm" type="button" data-action="pick-font">選択</button>
            </div>
          </label>
          <div class="pce-font-grid">
            <label class="form-group"><span class="form-label">Font size</span><input class="form-input" name="fontSize" type="number" min="8" max="32" /></label>
            <label class="form-group"><span class="form-label">Threshold</span><input class="form-input" name="threshold" type="number" min="1" max="254" /></label>
            <label class="form-group"><span class="form-label">X offset</span><input class="form-input" name="xOffset" type="number" min="-8" max="8" /></label>
            <label class="form-group"><span class="form-label">Y offset</span><input class="form-input" name="yOffset" type="number" min="-8" max="8" /></label>
            <label class="form-group"><span class="form-label">Tile base</span><input class="form-input" name="tileBase" type="number" min="0" max="2047" /></label>
          </div>
          <label class="form-group">
            <span class="form-label">Preview text</span>
            <textarea class="form-input pce-font-text" name="previewText" rows="5"></textarea>
          </label>
          <div class="form-actions-inline">
            <button class="btn-sm" type="button" data-action="reload">再読み込み</button>
            <button class="btn-sm" type="button" data-action="preview">プレビュー</button>
            <button class="btn-primary" type="submit">保存</button>
            <button class="btn-primary" type="button" data-action="generate">保存してVNへ反映</button>
          </div>
          <div class="form-error" data-role="error"></div>
        </form>
      </aside>
      <main class="pce-font-preview">
        <section class="pce-font-panel">
          <div class="pce-font-panel-title">
            <h2>ゲーム内表示イメージ</h2>
            <span>18文字 x 4行 / 16x16</span>
          </div>
          <div class="pce-font-screen">
            <canvas width="288" height="64" data-role="text-canvas"></canvas>
          </div>
          <dl class="pce-font-meta" data-role="meta"></dl>
        </section>
        <section class="pce-font-panel">
          <div class="pce-font-panel-title">
            <h2>生成グリフ</h2>
            <span>現在の preview text から抽出</span>
          </div>
          <div class="pce-font-atlas-wrap">
            <canvas width="512" height="128" data-role="atlas-canvas"></canvas>
          </div>
          <p class="pce-font-hint">読みにくい場合は Font size を 14-16、Threshold を 24-48、Y offset を -1 から 1 の範囲で調整してください。</p>
        </section>
      </main>
    </div>
  `;

  const form = root.querySelector('[data-role="form"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const textCanvas = root.querySelector('[data-role="text-canvas"]');
  const atlasCanvas = root.querySelector('[data-role="atlas-canvas"]');
  const metaEl = root.querySelector('[data-role="meta"]');

  let settings = {
    fontPath: '',
    fontSize: 15,
    threshold: 32,
    xOffset: 0,
    yOffset: 0,
    tileBase: 712,
    previewText: '320がめんのテストです\n18もじx4ぎょうです\nくろいよはくをのこします',
  };

  function collectSettings() {
    return {
      version: 1,
      fontPath: form.elements.fontPath.value.trim(),
      fontSize: clamp(form.elements.fontSize.value, 8, 32, 15),
      threshold: clamp(form.elements.threshold.value, 1, 254, 32),
      xOffset: clamp(form.elements.xOffset.value, -8, 8, 0),
      yOffset: clamp(form.elements.yOffset.value, -8, 8, 0),
      tileBase: clamp(form.elements.tileBase.value, 0, 2047, 712),
      previewText: form.elements.previewText.value,
    };
  }

  function fillForm(nextSettings) {
    settings = { ...settings, ...(nextSettings || {}) };
    form.elements.fontPath.value = settings.fontPath || '';
    form.elements.fontSize.value = settings.fontSize ?? 15;
    form.elements.threshold.value = settings.threshold ?? 32;
    form.elements.xOffset.value = settings.xOffset ?? 0;
    form.elements.yOffset.value = settings.yOffset ?? 0;
    form.elements.tileBase.value = settings.tileBase ?? 712;
    form.elements.previewText.value = settings.previewText || '';
  }

  function drawPreview(result) {
    const glyphMap = new Map((result.glyphs || []).map((entry) => [entry.glyph, entry.bitmap]));
    const ctx = textCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, textCanvas.width, textCanvas.height);

    let col = 0;
    let row = 0;
    for (const char of String(result.text || '')) {
      if (char === '\r') continue;
      if (char === '\n') {
        col = 0;
        row += 1;
        if (row >= 4) break;
        continue;
      }
      if (col >= 18) {
        col = 0;
        row += 1;
      }
      if (row >= 4) break;
      drawGlyph(ctx, glyphMap.get(char) || glyphMap.get(' '), col * 16, row * 16, 1);
      col += 1;
    }

    const atlasCtx = atlasCanvas.getContext('2d');
    atlasCtx.imageSmoothingEnabled = false;
    atlasCtx.fillStyle = '#050b10';
    atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    const glyphs = result.glyphs || [];
    const rows = Math.max(1, Math.ceil(glyphs.length / 16));
    atlasCanvas.height = Math.max(128, rows * 32);
    atlasCtx.fillStyle = '#050b10';
    atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    glyphs.forEach((entry, index) => {
      const x = (index % 16) * 32;
      const y = Math.floor(index / 16) * 32;
      atlasCtx.strokeStyle = '#24465c';
      atlasCtx.strokeRect(x + 0.5, y + 0.5, 31, 31);
      drawGlyph(atlasCtx, entry.bitmap, x + 8, y + 8, 1);
    });

    metaEl.innerHTML = `
      <dt>renderer</dt><dd>${esc(result.renderer || '-')}</dd>
      <dt>font</dt><dd>${esc(result.fontPath || 'auto / fallback')}</dd>
      <dt>glyphs</dt><dd>${esc(glyphs.length)}</dd>
      <dt>tile base</dt><dd>${esc(result.config?.tileBase ?? settings.tileBase ?? 712)}</dd>
    `;
  }

  async function invoke(hook, payload = {}) {
    return api.electronAPI.invokePluginHook(plugin.id, hook, payload);
  }

  async function reload() {
    errorEl.textContent = '';
    const result = await invoke('readFontSettings');
    if (!result?.ok) {
      errorEl.textContent = result?.error || 'フォント設定を読み込めません';
      return;
    }
    fillForm(result.settings);
    await preview();
  }

  async function save() {
    const result = await invoke('saveFontSettings', { config: collectSettings() });
    if (!result?.ok) throw new Error(result?.error || '保存に失敗しました');
    fillForm(result.settings);
    logger.info('PCE font settings saved');
  }

  async function preview() {
    errorEl.textContent = '';
    const config = collectSettings();
    const result = await invoke('previewFont', {
      config,
      text: config.previewText,
    });
    if (!result?.ok) {
      errorEl.textContent = result?.error || 'プレビュー生成に失敗しました';
      return;
    }
    drawPreview(result);
  }

  root.querySelector('[data-action="pick-font"]').addEventListener('click', async () => {
    errorEl.textContent = '';
    const picked = await api.electronAPI.pickFile({
      properties: ['openFile'],
      filters: [{ name: 'Font files', extensions: ['ttf', 'otf', 'ttc'] }],
    });
    const filePath = picked?.sourcePath || picked?.filePath || picked?.filePaths?.[0] || '';
    if (picked?.canceled || !filePath) return;
    form.elements.fontPath.value = filePath;
    await preview();
  });

  root.querySelector('[data-action="reload"]').addEventListener('click', reload);
  root.querySelector('[data-action="preview"]').addEventListener('click', preview);
  form.addEventListener('input', () => {
    window.clearTimeout(form._previewTimer);
    form._previewTimer = window.setTimeout(preview, 120);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await save();
      await preview();
      errorEl.textContent = '保存しました';
    } catch (err) {
      errorEl.textContent = err.message || String(err);
    }
  });
  root.querySelector('[data-action="generate"]').addEventListener('click', async () => {
    try {
      await save();
      const result = await invoke('generateFont', { config: collectSettings() });
      if (!result?.ok) throw new Error(result?.error || 'VNフォント生成に失敗しました');
      await preview();
      errorEl.textContent = `VNフォントへ反映しました (${result.generated?.glyphCount || 0} glyphs)`;
    } catch (err) {
      errorEl.textContent = err.message || String(err);
    }
  });

  registerCapability('font-editor', { reload, preview, save });
  void reload();
  return { deactivate() {} };
}
