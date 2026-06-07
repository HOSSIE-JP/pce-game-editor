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

export function activatePlugin({ plugin, root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-sprite-editor-shell">
      <aside class="pce-plugin-list">
        <div class="pce-plugin-header">
          <h2>Sprite Sheets</h2>
          <button class="btn-sm" type="button" data-refresh>更新</button>
        </div>
        <div data-list class="pce-plugin-items"></div>
      </aside>
      <main class="pce-plugin-main">
        <div class="pce-plugin-preview">
          <img data-preview alt="sprite preview" hidden />
          <div data-empty class="asset-no-selection-hint">スプライトを選択してください</div>
        </div>
        <form class="settings-form compact-form pce-plugin-form" data-form>
          <label class="form-group"><span class="form-label">Name</span><input class="form-input" name="name" /></label>
          <label class="form-group"><span class="form-label">Cell</span><select class="form-select" name="cell"><option>16x16</option><option>16x32</option><option>16x64</option><option>32x16</option><option>32x32</option><option>32x64</option></select></label>
          <div class="pce-form-grid">
            <label class="form-group"><span class="form-label">X</span><input class="form-input" name="x" type="number" min="0" max="255" /></label>
            <label class="form-group"><span class="form-label">Y</span><input class="form-input" name="y" type="number" min="0" max="255" /></label>
            <label class="form-group"><span class="form-label">Pattern base</span><input class="form-input" name="tileBase" type="number" min="0" max="2047" /></label>
            <label class="form-group"><span class="form-label">Palette bank</span><input class="form-input" name="paletteBank" type="number" min="0" max="15" /></label>
          </div>
          <div class="form-actions-inline">
            <button class="btn-primary" type="submit">保存</button>
          </div>
          <div class="form-error" data-error></div>
        </form>
      </main>
    </div>
  `;
  const listEl = root.querySelector('[data-list]');
  const form = root.querySelector('[data-form]');
  const preview = root.querySelector('[data-preview]');
  const empty = root.querySelector('[data-empty]');
  const error = root.querySelector('[data-error]');
  let sprites = [];
  let selectedId = '';

  function selected() {
    return sprites.find((asset) => asset.id === selectedId) || null;
  }

  async function showPreview(asset) {
    preview.hidden = true;
    empty.hidden = false;
    if (!asset?.source) return;
    const result = await api.electronAPI.previewAssetSource(asset.source);
    if (result?.ok && result.dataUrl) {
      preview.src = result.dataUrl;
      preview.hidden = false;
      empty.hidden = true;
    }
  }

  function fill(asset) {
    const options = asset?.options || {};
    form.hidden = !asset;
    if (!asset) return;
    form.elements.name.value = asset.name || asset.id;
    form.elements.cell.value = `${options.cellWidth || 16}x${options.cellHeight || 16}`;
    form.elements.x.value = options.x ?? 144;
    form.elements.y.value = options.y ?? 104;
    form.elements.tileBase.value = options.tileBase ?? 384;
    form.elements.paletteBank.value = options.paletteBank ?? 0;
    void showPreview(asset);
  }

  function render() {
    listEl.innerHTML = sprites.length
      ? sprites.map((asset) => `<button class="${asset.id === selectedId ? 'active' : ''}" type="button" data-id="${esc(asset.id)}"><strong>${esc(asset.name || asset.id)}</strong><span>${esc(asset.source || '')}</span></button>`).join('')
      : '<p class="asset-no-selection-hint">sprite アセットがありません</p>';
    listEl.querySelectorAll('[data-id]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedId = button.dataset.id;
        render();
        fill(selected());
      });
    });
  }

  async function reload() {
    const result = await api.electronAPI.listAssets();
    sprites = (result?.assets || []).filter((asset) => asset.type === 'sprite');
    if (!sprites.some((asset) => asset.id === selectedId)) selectedId = sprites[0]?.id || '';
    render();
    fill(selected());
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const asset = selected();
    if (!asset) return;
    const [cellWidth, cellHeight] = String(form.elements.cell.value || '16x16').split('x').map((value) => asNumber(value, 16));
    const result = await api.electronAPI.upsertAsset({
      ...asset,
      name: form.elements.name.value,
      options: {
        ...(asset.options || {}),
        kind: 'sprite',
        cellWidth,
        cellHeight,
        x: asNumber(form.elements.x.value, 144),
        y: asNumber(form.elements.y.value, 104),
        tileBase: asNumber(form.elements.tileBase.value, 384),
        paletteBank: asNumber(form.elements.paletteBank.value, 0),
      },
    });
    if (!result?.ok) {
      error.textContent = result?.error || '保存できませんでした';
      return;
    }
    await reload();
  });

  root.querySelector('[data-refresh]').addEventListener('click', reload);
  registerCapability('sprite-editor', { reload });
  void reload();
  return { deactivate() {} };
}
