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
  const assetApi = api.assets || {};

  const listPceAssets = (options = {}) => assetApi.listPceAssets
    ? assetApi.listPceAssets(options)
    : api.electronAPI.listAssets();
  const upsertPceAsset = (asset) => assetApi.upsertPceAsset
    ? assetApi.upsertPceAsset(asset)
    : api.electronAPI.upsertAsset(asset);

  function paletteAssets() {
    return assets
      .filter((asset) => asset.type === 'palette')
      .sort((left, right) => compareText(assetFullName(left), assetFullName(right)) || compareText(left.id, right.id));
  }

  function selected() {
    return paletteAssets().find((asset) => asset.id === selectedId) || null;
  }

  function renderList() {
    const palettes = paletteAssets();
    listEl.innerHTML = palettes.length
      ? renderGroupedList(palettes, (asset) => `<button class="${asset.id === selectedId ? 'active' : ''}" type="button" data-id="${esc(asset.id)}"><strong>${esc(assetDisplayName(asset))}</strong><code>${esc(asset.id)}</code><span>${esc(asset.options?.target || 'bg')} bank ${esc(asset.options?.paletteBank ?? 0)}</span></button>`)
      : '<p class="asset-no-selection-hint">palette アセットがありません</p>';
    listEl.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', () => {
      selectedId = button.dataset.id;
      render();
    }));
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

  async function reload(options = {}) {
    const result = await listPceAssets({ force: Boolean(options.force) });
    assets = result?.assets || [];
    if (!paletteAssets().some((asset) => asset.id === selectedId)) selectedId = paletteAssets()[0]?.id || '';
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
    const result = await upsertPceAsset({
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
    await reload({ force: true });
  });
  registerCapability('palette-editor', { reload });
  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  void reload();
  return {
    deactivate() {
      teardownAssetRefreshEvents();
    },
  };
}
