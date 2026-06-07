function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function defaultColors() {
  return ['#000000', '#ffffff', '#777777', '#ffcc33', '#3399ff', '#ff6699', '#33cc88', '#cc66ff', '#222222', '#555555', '#888888', '#bbbbbb', '#dd3333', '#33dd33', '#3333dd', '#eeeeee'];
}

export function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-palette-editor-shell">
      <aside class="pce-plugin-list">
        <div class="pce-plugin-header"><h2>Palettes</h2><button class="btn-sm" type="button" data-new>新規</button></div>
        <div data-list class="pce-plugin-items"></div>
      </aside>
      <main class="pce-palette-main">
        <form class="settings-form compact-form pce-palette-form" data-form hidden>
          <label class="form-group"><span class="form-label">Name</span><input class="form-input" name="name" /></label>
          <div class="pce-form-grid">
            <label class="form-group"><span class="form-label">Target</span><select class="form-select" name="target"><option value="bg">BG</option><option value="sprite">Sprite</option></select></label>
            <label class="form-group"><span class="form-label">Bank</span><input class="form-input" name="bank" type="number" min="0" max="15" /></label>
          </div>
          <div class="pce-palette-grid" data-colors></div>
          <div class="form-actions-inline"><button class="btn-primary" type="submit">保存</button></div>
          <div class="form-error" data-error></div>
        </form>
        <section class="pce-palette-derived">
          <h2>画像から検出済みのパレット</h2>
          <div data-derived></div>
        </section>
      </main>
    </div>
  `;
  const listEl = root.querySelector('[data-list]');
  const form = root.querySelector('[data-form]');
  const colorEl = root.querySelector('[data-colors]');
  const derivedEl = root.querySelector('[data-derived]');
  const error = root.querySelector('[data-error]');
  let assets = [];
  let selectedId = '';

  function paletteAssets() {
    return assets.filter((asset) => asset.type === 'palette');
  }

  function selected() {
    return paletteAssets().find((asset) => asset.id === selectedId) || null;
  }

  function renderList() {
    const palettes = paletteAssets();
    listEl.innerHTML = palettes.length
      ? palettes.map((asset) => `<button class="${asset.id === selectedId ? 'active' : ''}" type="button" data-id="${esc(asset.id)}"><strong>${esc(asset.name || asset.id)}</strong><span>${esc(asset.options?.target || 'bg')} bank ${esc(asset.options?.paletteBank ?? 0)}</span></button>`).join('')
      : '<p class="asset-no-selection-hint">palette アセットがありません</p>';
    listEl.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', () => {
      selectedId = button.dataset.id;
      render();
    }));
  }

  function renderDerived() {
    const derived = assets.filter((asset) => asset.data?.generated?.paletteColors?.length);
    derivedEl.innerHTML = derived.length
      ? derived.map((asset) => `<div class="pce-derived-row"><strong>${esc(asset.name || asset.id)}</strong><div>${asset.data.generated.paletteColors.slice(0, 16).map((color) => `<span style="background:${esc(color)}" title="${esc(color)}"></span>`).join('')}</div></div>`).join('')
      : '<p class="asset-no-selection-hint">変換済み画像のパレットがありません</p>';
  }

  function fill(asset) {
    form.hidden = !asset;
    if (!asset) return;
    const options = asset.options || {};
    form.elements.name.value = asset.name || asset.id;
    form.elements.target.value = options.target === 'sprite' ? 'sprite' : 'bg';
    form.elements.bank.value = options.paletteBank ?? 0;
    const colors = (options.colors?.length ? options.colors : defaultColors()).slice(0, 16);
    colorEl.innerHTML = colors.map((color, index) => `<label><span>${index}</span><input type="color" data-color="${index}" value="${esc(color)}" /></label>`).join('');
  }

  function render() {
    renderList();
    renderDerived();
    fill(selected());
  }

  async function reload() {
    const result = await api.electronAPI.listAssets();
    assets = result?.assets || [];
    if (!paletteAssets().some((asset) => asset.id === selectedId)) selectedId = paletteAssets()[0]?.id || '';
    render();
  }

  root.querySelector('[data-new]').addEventListener('click', () => {
    const id = `palette_${Date.now()}`;
    assets.push({ id, type: 'palette', name: 'Palette', source: '', options: { target: 'bg', paletteBank: 0, colors: defaultColors() } });
    selectedId = id;
    render();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const asset = selected();
    if (!asset) return;
    const colors = Array.from(colorEl.querySelectorAll('[data-color]')).map((input) => input.value);
    const result = await api.electronAPI.upsertAsset({
      ...asset,
      name: form.elements.name.value,
      options: {
        ...(asset.options || {}),
        target: form.elements.target.value,
        paletteBank: Number(form.elements.bank.value) || 0,
        colors,
      },
    });
    if (!result?.ok) {
      error.textContent = result?.error || '保存できませんでした';
      return;
    }
    await reload();
  });
  registerCapability('palette-editor', { reload });
  void reload();
  return { deactivate() {} };
}
