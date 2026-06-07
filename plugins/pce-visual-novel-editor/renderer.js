const SCENE_FILE = 'assets/pce-vn-scenes.json';
const PCE_SCREEN_WIDTH = 320;
const PCE_SCREEN_HEIGHT = 224;
const DEFAULT_CHARACTER_Y = 24;

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

function safeId(value, fallback) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return id || fallback;
}

function optionsFor(assets, current, label) {
  return [`<option value="">${esc(label)}</option>`]
    .concat(assets.map((asset) => `<option value="${esc(asset.id)}" ${asset.id === current ? 'selected' : ''}>${esc(asset.name || asset.id)}</option>`))
    .join('');
}

function spritePixelWidth(asset = {}) {
  const options = asset?.options || {};
  const width = Number(options.width);
  if (Number.isFinite(width) && width > 0) return Math.min(PCE_SCREEN_WIDTH, Math.round(width));
  const cellWidth = Number(options.cellWidth);
  const columns = Number(options.cellColumns);
  if (Number.isFinite(cellWidth) && cellWidth > 0 && Number.isFinite(columns) && columns > 0) {
    return Math.min(PCE_SCREEN_WIDTH, Math.round(cellWidth * columns));
  }
  return 64;
}

function defaultCharacterPlacement(asset) {
  return {
    x: Math.max(0, Math.floor((PCE_SCREEN_WIDTH - spritePixelWidth(asset)) / 2)),
    y: DEFAULT_CHARACTER_Y,
  };
}

function defaultDoc(assets = []) {
  const first = (type) => assets.find((asset) => asset.type === type)?.id || '';
  return {
    version: 1,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      backgroundAssetId: first('image'),
      characters: [],
      messages: [
        { speaker: '', text: '320がめんです', voiceAssetId: '', advanceMode: 'button' },
        { speaker: '', text: '18もじx4ぎょう', voiceAssetId: '', advanceMode: 'button' },
      ],
      bgmAssetId: first('cdda-track') || first('psg-song'),
      nextSceneId: '',
    }],
  };
}

function normalizeDoc(doc, assets) {
  const fallback = defaultDoc(assets);
  const scenes = Array.isArray(doc?.scenes) && doc.scenes.length ? doc.scenes : fallback.scenes;
  return {
    version: 1,
    startScene: String(doc?.startScene || scenes[0]?.id || 'opening'),
    scenes: scenes.map((scene, index) => ({
      id: safeId(scene?.id, index === 0 ? 'opening' : `scene_${index + 1}`),
      backgroundAssetId: String(scene?.backgroundAssetId || ''),
      characters: Array.isArray(scene?.characters) ? scene.characters.slice(0, 4) : [],
      messages: Array.isArray(scene?.messages) && scene.messages.length
        ? scene.messages
        : [{ speaker: '', text: 'メッセージを入力してください。', voiceAssetId: '', advanceMode: 'button' }],
      bgmAssetId: String(scene?.bgmAssetId || ''),
      nextSceneId: String(scene?.nextSceneId || ''),
    })),
  };
}

export function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-vn-shell">
      <aside class="pce-vn-list">
        <div class="pce-vn-header">
          <h2>Scenes</h2>
          <div class="pce-vn-actions">
            <button class="icon-btn" type="button" data-action="add-scene" title="シーン追加" aria-label="シーン追加">＋</button>
            <button class="icon-btn" type="button" data-action="reload" title="再読み込み" aria-label="再読み込み">↻</button>
          </div>
        </div>
        <div class="pce-vn-items" data-role="scene-list"></div>
      </aside>
      <main class="pce-vn-main">
        <section class="pce-vn-edit">
          <div class="pce-vn-edit-title">
            <h2 data-role="scene-title">Scene</h2>
            <div class="pce-vn-actions">
              <button class="icon-btn" type="button" data-action="add-message" title="メッセージ追加" aria-label="メッセージ追加">＋</button>
              <button class="icon-btn danger" type="button" data-action="delete-scene" title="シーン削除" aria-label="シーン削除">×</button>
              <button class="btn-primary" type="button" data-action="save">保存</button>
            </div>
          </div>
          <form class="pce-vn-form" data-role="scene-form">
            <label class="form-group"><span class="form-label">Scene ID</span><input class="form-input" name="id" /></label>
            <div class="pce-vn-grid">
              <label class="form-group"><span class="form-label">背景</span><select class="form-select" name="backgroundAssetId"></select></label>
              <label class="form-group"><span class="form-label">BGM</span><select class="form-select" name="bgmAssetId"></select></label>
            </div>
            <div class="pce-vn-grid">
              <label class="form-group"><span class="form-label">立ち絵</span><select class="form-select" name="characterAssetId"></select></label>
              <label class="form-group"><span class="form-label">次シーン</span><select class="form-select" name="nextSceneId"></select></label>
            </div>
            <div class="pce-vn-grid tight">
              <label class="form-group"><span class="form-label">立ち絵 X</span><input class="form-input" name="characterX" type="number" min="0" max="319" /></label>
              <label class="form-group"><span class="form-label">立ち絵 Y</span><input class="form-input" name="characterY" type="number" min="0" max="223" /></label>
            </div>
          </form>
          <div class="pce-vn-messages" data-role="messages"></div>
          <div class="form-error" data-role="error"></div>
        </section>
        <aside class="pce-vn-preview">
          <div class="pce-vn-stage">
            <img data-role="bg-preview" alt="background preview" hidden />
            <img data-role="character-preview" alt="character preview" hidden />
            <div class="pce-vn-message-preview" data-role="message-preview"></div>
          </div>
          <dl class="pce-vn-meta" data-role="meta"></dl>
        </aside>
      </main>
    </div>
  `;

  const sceneList = root.querySelector('[data-role="scene-list"]');
  const form = root.querySelector('[data-role="scene-form"]');
  const messagesEl = root.querySelector('[data-role="messages"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const bgPreview = root.querySelector('[data-role="bg-preview"]');
  const characterPreview = root.querySelector('[data-role="character-preview"]');
  const messagePreview = root.querySelector('[data-role="message-preview"]');
  const metaEl = root.querySelector('[data-role="meta"]');
  let assets = [];
  let doc = defaultDoc();
  let selectedId = 'opening';

  const byType = (types) => assets.filter((asset) => types.includes(asset.type));
  const scene = () => doc.scenes.find((item) => item.id === selectedId) || doc.scenes[0] || null;
  const assetById = (id) => assets.find((asset) => asset.id === id) || null;

  function selectedSceneFromForm() {
    const current = scene() || {};
    const characterAssetId = form.elements.characterAssetId.value;
    const defaults = defaultCharacterPlacement(assetById(characterAssetId));
    return {
      ...current,
      id: safeId(form.elements.id.value, current.id || 'scene'),
      backgroundAssetId: form.elements.backgroundAssetId.value,
      bgmAssetId: form.elements.bgmAssetId.value,
      nextSceneId: form.elements.nextSceneId.value,
      characters: characterAssetId ? [{
        assetId: characterAssetId,
        x: Math.max(0, Math.min(319, asNumber(form.elements.characterX.value, defaults.x))),
        y: Math.max(0, Math.min(223, asNumber(form.elements.characterY.value, defaults.y))),
        pose: 'default',
      }] : [],
      messages: Array.from(messagesEl.querySelectorAll('[data-message]')).map((row) => ({
        speaker: row.querySelector('[name="speaker"]').value.trim(),
        text: row.querySelector('[name="text"]').value.trim(),
        voiceAssetId: row.querySelector('[name="voiceAssetId"]').value,
        advanceMode: row.querySelector('[name="advanceMode"]').value,
      })).filter((message) => message.text),
    };
  }

  function commitFormToDoc() {
    const current = scene();
    if (!current) return;
    const index = doc.scenes.indexOf(current);
    const next = selectedSceneFromForm();
    const oldId = current.id;
    doc.scenes[index] = next;
    if (doc.startScene === oldId) doc.startScene = next.id;
    doc.scenes = doc.scenes.map((item) => ({
      ...item,
      nextSceneId: item.nextSceneId === oldId ? next.id : item.nextSceneId,
    }));
    selectedId = next.id;
  }

  function renderSceneList() {
    sceneList.innerHTML = doc.scenes.map((item) => `
      <button type="button" data-scene-id="${esc(item.id)}" class="${item.id === selectedId ? 'active' : ''}">
        <strong>${esc(item.id)}</strong>
        <span>${esc((item.messages || [])[0]?.text || 'no message')}</span>
      </button>
    `).join('');
    sceneList.querySelectorAll('[data-scene-id]').forEach((button) => {
      button.addEventListener('click', () => {
        commitFormToDoc();
        selectedId = button.dataset.sceneId;
        render();
      });
    });
  }

  function renderMessages(current) {
    const voices = byType(['adpcm']);
    messagesEl.innerHTML = (current.messages || []).map((message, index) => `
      <section class="pce-vn-message-row" data-message>
        <div class="pce-vn-message-head">
          <strong>#${index + 1}</strong>
          <button class="icon-btn" type="button" data-remove-message="${index}" title="メッセージ削除" aria-label="メッセージ削除">×</button>
        </div>
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">話者</span><input class="form-input" name="speaker" value="${esc(message.speaker || '')}" /></label>
          <label class="form-group"><span class="form-label">ADPCM</span><select class="form-select" name="voiceAssetId">${optionsFor(voices, message.voiceAssetId, 'なし')}</select></label>
        </div>
        <label class="form-group"><span class="form-label">本文</span><textarea class="form-input" name="text" rows="2">${esc(message.text || '')}</textarea></label>
        <select class="form-select" name="advanceMode"><option value="button" ${message.advanceMode !== 'auto' ? 'selected' : ''}>button</option><option value="auto" ${message.advanceMode === 'auto' ? 'selected' : ''}>auto</option></select>
      </section>
    `).join('');
    messagesEl.querySelectorAll('[data-remove-message]').forEach((button) => {
      button.addEventListener('click', () => {
        const currentScene = selectedSceneFromForm();
        currentScene.messages.splice(Number(button.dataset.removeMessage), 1);
        if (!currentScene.messages.length) currentScene.messages.push({ speaker: '', text: 'メッセージを入力してください。', voiceAssetId: '', advanceMode: 'button' });
        const index = doc.scenes.findIndex((item) => item.id === selectedId);
        doc.scenes[index] = currentScene;
        render();
      });
    });
    messagesEl.querySelectorAll('input, textarea, select').forEach((input) => {
      input.addEventListener('input', renderPreview);
      input.addEventListener('change', renderPreview);
    });
  }

  async function setPreviewImage(img, asset) {
    img.hidden = true;
    img.removeAttribute('src');
    if (!asset?.source) return;
    const result = await api.electronAPI.previewAssetSource(asset.source);
    if (result?.dataUrl) {
      img.src = result.dataUrl;
      img.hidden = false;
    }
  }

  async function renderPreview() {
    const current = selectedSceneFromForm();
    const background = assetById(current.backgroundAssetId);
    const character = assetById(current.characters[0]?.assetId);
    await setPreviewImage(bgPreview, background);
    await setPreviewImage(characterPreview, character);
    const characterDef = current.characters[0] || defaultCharacterPlacement(character);
    characterPreview.style.left = `${(characterDef.x / PCE_SCREEN_WIDTH) * 100}%`;
    characterPreview.style.top = `${(characterDef.y / PCE_SCREEN_HEIGHT) * 100}%`;
    messagePreview.textContent = current.messages[0]
      ? `${current.messages[0].speaker ? `${current.messages[0].speaker}: ` : ''}${current.messages[0].text}`
      : '';
    metaEl.innerHTML = `
      <dt>target</dt><dd>SUPER CD-ROM2 / llvm-mos</dd>
      <dt>background</dt><dd>${esc(background?.name || current.backgroundAssetId || '-')}</dd>
      <dt>character</dt><dd>${esc(character?.name || current.characters[0]?.assetId || '-')}</dd>
      <dt>messages</dt><dd>${current.messages.length}</dd>
    `;
  }

  function renderForm() {
    const current = scene();
    if (!current) return;
    root.querySelector('[data-role="scene-title"]').textContent = current.id;
    const character = current.characters[0] || {};
    const defaults = defaultCharacterPlacement(assetById(character.assetId));
    form.elements.id.value = current.id;
    form.elements.backgroundAssetId.innerHTML = optionsFor(byType(['image']), current.backgroundAssetId, '背景なし');
    form.elements.characterAssetId.innerHTML = optionsFor(byType(['sprite']), character.assetId, '立ち絵なし');
    form.elements.bgmAssetId.innerHTML = optionsFor(byType(['cdda-track', 'psg-song']), current.bgmAssetId, 'BGMなし');
    form.elements.nextSceneId.innerHTML = optionsFor(doc.scenes.filter((item) => item.id !== current.id).map((item) => ({ id: item.id, name: item.id })), current.nextSceneId, '終端');
    form.elements.characterX.value = character.x ?? defaults.x;
    form.elements.characterY.value = character.y ?? defaults.y;
    renderMessages(current);
    form.querySelectorAll('input, select').forEach((input) => {
      input.addEventListener('input', renderPreview);
      input.addEventListener('change', renderPreview);
    });
    void renderPreview();
  }

  function render() {
    renderSceneList();
    renderForm();
  }

  async function load() {
    errorEl.textContent = '';
    const assetResult = await api.electronAPI.listAssets();
    assets = Array.isArray(assetResult?.assets) ? assetResult.assets : [];
    const read = await api.electronAPI.readCodeFile({ path: SCENE_FILE });
    if (read?.ok && read.content) {
      try {
        doc = normalizeDoc(JSON.parse(read.content), assets);
      } catch (_) {
        doc = defaultDoc(assets);
      }
    } else {
      doc = defaultDoc(assets);
      await api.electronAPI.writeCodeFile({ path: SCENE_FILE, content: JSON.stringify(doc, null, 2), encoding: 'utf8' });
    }
    if (!doc.scenes.some((item) => item.id === selectedId)) selectedId = doc.startScene || doc.scenes[0]?.id || 'opening';
    render();
  }

  async function save() {
    try {
      commitFormToDoc();
      doc = normalizeDoc(doc, assets);
      await api.electronAPI.writeCodeFile({ path: SCENE_FILE, content: JSON.stringify(doc, null, 2), encoding: 'utf8' });
      errorEl.textContent = '保存しました';
      render();
    } catch (err) {
      errorEl.textContent = `保存失敗: ${err?.message || err}`;
    }
  }

  root.querySelector('[data-action="reload"]').addEventListener('click', load);
  root.querySelector('[data-action="save"]').addEventListener('click', save);
  root.querySelector('[data-action="add-scene"]').addEventListener('click', () => {
    commitFormToDoc();
    const id = safeId(`scene_${doc.scenes.length + 1}`, 'scene');
    doc.scenes.push({ ...defaultDoc(assets).scenes[0], id, nextSceneId: '' });
    selectedId = id;
    render();
  });
  root.querySelector('[data-action="delete-scene"]').addEventListener('click', () => {
    if (doc.scenes.length <= 1) return;
    doc.scenes = doc.scenes.filter((item) => item.id !== selectedId);
    selectedId = doc.scenes[0]?.id || 'opening';
    doc.startScene = selectedId;
    render();
  });
  root.querySelector('[data-action="add-message"]').addEventListener('click', () => {
    const current = selectedSceneFromForm();
    current.messages.push({ speaker: 'アカリ', text: '新しいメッセージです。', voiceAssetId: '', advanceMode: 'button' });
    const index = doc.scenes.findIndex((item) => item.id === selectedId);
    doc.scenes[index] = current;
    render();
  });

  registerCapability('visual-novel-editor', { reload: load, save });
  void load();
  return { deactivate() {} };
}
