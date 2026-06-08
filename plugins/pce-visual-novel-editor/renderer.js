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

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, asNumber(value, fallback)));
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

function animationOptions(asset, current, label = 'default') {
  const animations = Array.isArray(asset?.options?.animations) && asset.options.animations.length
    ? asset.options.animations
    : [{ id: 'default', name: 'Default' }];
  return animations.map((animation) => {
    const id = animation.id || 'default';
    return `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>${esc(animation.name || id)}</option>`;
  }).join('') || `<option value="default">${esc(label)}</option>`;
}

function defaultCommand(type, assets = []) {
  const first = (assetType) => assets.find((asset) => asset.type === assetType)?.id || '';
  if (type === 'background') {
    return { type: 'background', assetId: first('image'), transition: 'fade', fadeOutFrames: 8, fadeInFrames: 16 };
  }
  if (type === 'sprite') {
    const assetId = first('sprite');
    return { type: 'sprite', slot: 0, assetId, x: 128, y: DEFAULT_CHARACTER_Y, animationId: 'default', visible: true };
  }
  if (type === 'audio') {
    return { type: 'audio', kind: 'cdda', action: 'play', assetId: first('cdda-track') };
  }
  return {
    type: 'message',
    speaker: '',
    text: 'メッセージを入力してください。',
    voiceAssetId: first('adpcm'),
    textSpeedFrames: 2,
    advanceMode: 'button',
    autoWaitFrames: 60,
    mouthSlot: 0,
    mouthAnimationId: '',
  };
}

function defaultDoc(assets = []) {
  return {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        defaultCommand('background', assets),
        defaultCommand('sprite', assets),
        { ...defaultCommand('audio', assets), assetId: assets.find((asset) => asset.type === 'cdda-track')?.id || '' },
        { ...defaultCommand('message', assets), text: '320がめんです' },
        { ...defaultCommand('message', assets), text: '18もじx4ぎょう', voiceAssetId: '' },
      ].filter((command) => command.type !== 'audio' || command.assetId),
      nextSceneId: '',
    }],
  };
}

function normalizeCommand(command = {}, assets = [], index = 0) {
  const byId = (id) => assets.find((asset) => asset.id === id) || null;
  const raw = command && typeof command === 'object' ? command : {};
  if (raw.type === 'background') {
    const asset = byId(raw.assetId);
    return {
      type: 'background',
      assetId: asset?.type === 'image' ? asset.id : assets.find((entry) => entry.type === 'image')?.id || '',
      transition: raw.transition === 'fade' ? 'fade' : 'cut',
      fadeOutFrames: clamp(raw.fadeOutFrames, 0, 60, 0),
      fadeInFrames: clamp(raw.fadeInFrames, 0, 60, raw.transition === 'fade' ? 16 : 0),
    };
  }
  if (raw.type === 'sprite') {
    const asset = byId(raw.assetId);
    const defaults = defaultCharacterPlacement(asset);
    return {
      type: 'sprite',
      slot: clamp(raw.slot, 0, 3, index),
      assetId: asset?.type === 'sprite' ? asset.id : assets.find((entry) => entry.type === 'sprite')?.id || '',
      x: clamp(raw.x, 0, 319, defaults.x),
      y: clamp(raw.y, 0, 223, defaults.y),
      animationId: String(raw.animationId || 'default').trim() || 'default',
      visible: raw.visible !== false,
    };
  }
  if (raw.type === 'audio') {
    const kind = raw.kind === 'adpcm' ? 'adpcm' : 'cdda';
    const action = raw.action === 'stop' ? 'stop' : 'play';
    const asset = byId(raw.assetId);
    const valid = kind === 'adpcm' ? asset?.type === 'adpcm' : asset?.type === 'cdda-track';
    return { type: 'audio', kind, action, assetId: action === 'play' && valid ? asset.id : '' };
  }
  return {
    type: 'message',
    speaker: String(raw.speaker || '').trim().slice(0, 16),
    text: String(raw.text || (index === 0 ? 'メッセージを入力してください。' : '')).trim().slice(0, 96),
    voiceAssetId: byId(raw.voiceAssetId)?.type === 'adpcm' ? raw.voiceAssetId : '',
    textSpeedFrames: clamp(raw.textSpeedFrames ?? raw.speed, 0, 30, 2),
    advanceMode: raw.advanceMode === 'auto' ? 'auto' : 'button',
    autoWaitFrames: clamp(raw.autoWaitFrames, 0, 255, 60),
    mouthSlot: clamp(raw.mouthSlot, 0, 3, 0),
    mouthAnimationId: String(raw.mouthAnimationId || '').trim().slice(0, 32),
  };
}

function legacyCommands(scene = {}, assets = []) {
  const commands = [];
  if (scene.backgroundAssetId) commands.push(normalizeCommand({ type: 'background', assetId: scene.backgroundAssetId }, assets));
  (Array.isArray(scene.characters) ? scene.characters : []).forEach((character, index) => {
    commands.push(normalizeCommand({ type: 'sprite', slot: index, ...character, animationId: character.animationId || character.pose }, assets, index));
  });
  if (scene.bgmAssetId) commands.push(normalizeCommand({ type: 'audio', kind: 'cdda', action: 'play', assetId: scene.bgmAssetId }, assets));
  (Array.isArray(scene.messages) ? scene.messages : []).forEach((message, index) => commands.push(normalizeCommand({ type: 'message', ...message }, assets, index)));
  return commands.filter(Boolean);
}

function normalizeDoc(doc, assets) {
  const fallback = defaultDoc(assets);
  const rawScenes = Array.isArray(doc?.scenes) && doc.scenes.length ? doc.scenes : fallback.scenes;
  const scenes = rawScenes.map((scene, index) => {
    const commands = Array.isArray(scene?.commands) && scene.commands.length
      ? scene.commands.map((command, commandIndex) => normalizeCommand(command, assets, commandIndex)).filter(Boolean)
      : legacyCommands(scene, assets);
    return {
      id: safeId(scene?.id, index === 0 ? 'opening' : `scene_${index + 1}`),
      commands: commands.length ? commands : fallback.scenes[0].commands,
      nextSceneId: safeId(scene?.nextSceneId, ''),
    };
  });
  const ids = new Set();
  const deduped = scenes.map((scene, index) => {
    let id = scene.id;
    if (ids.has(id)) id = `${id}_${index + 1}`;
    ids.add(id);
    return { ...scene, id };
  });
  const sceneIds = new Set(deduped.map((scene) => scene.id));
  return {
    version: 2,
    startScene: sceneIds.has(doc?.startScene) ? doc.startScene : deduped[0]?.id || 'opening',
    scenes: deduped.map((scene) => ({
      ...scene,
      nextSceneId: scene.nextSceneId && sceneIds.has(scene.nextSceneId) ? scene.nextSceneId : '',
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
              <button class="btn-sm" type="button" data-add-command="background">BG</button>
              <button class="btn-sm" type="button" data-add-command="sprite">Sprite</button>
              <button class="btn-sm" type="button" data-add-command="message">Message</button>
              <button class="btn-sm" type="button" data-add-command="audio">Audio</button>
              <button class="icon-btn danger" type="button" data-action="delete-scene" title="シーン削除" aria-label="シーン削除">×</button>
              <button class="btn-primary" type="button" data-action="save">保存</button>
            </div>
          </div>
          <form class="pce-vn-form" data-role="scene-form">
            <label class="form-group"><span class="form-label">Scene ID</span><input class="form-input" name="id" /></label>
            <label class="form-group"><span class="form-label">次シーン</span><select class="form-select" name="nextSceneId"></select></label>
          </form>
          <div class="pce-vn-commands" data-role="commands"></div>
          <div class="form-error" data-role="error"></div>
        </section>
        <aside class="pce-vn-preview">
          <div class="pce-vn-stage">
            <img data-role="bg-preview" alt="background preview" hidden />
            <div class="pce-vn-sprite-layer" data-role="sprite-layer"></div>
            <div class="pce-vn-message-preview" data-role="message-preview"></div>
          </div>
          <dl class="pce-vn-meta" data-role="meta"></dl>
        </aside>
      </main>
    </div>
  `;

  const sceneList = root.querySelector('[data-role="scene-list"]');
  const form = root.querySelector('[data-role="scene-form"]');
  const commandsEl = root.querySelector('[data-role="commands"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const bgPreview = root.querySelector('[data-role="bg-preview"]');
  const spriteLayer = root.querySelector('[data-role="sprite-layer"]');
  const messagePreview = root.querySelector('[data-role="message-preview"]');
  const metaEl = root.querySelector('[data-role="meta"]');
  let assets = [];
  let doc = defaultDoc();
  let selectedId = 'opening';

  const byType = (types) => assets.filter((asset) => types.includes(asset.type));
  const scene = () => doc.scenes.find((item) => item.id === selectedId) || doc.scenes[0] || null;
  const assetById = (id) => assets.find((asset) => asset.id === id) || null;

  function commandFromRow(row) {
    const type = row.querySelector('[name="type"]').value;
    if (type === 'background') {
      return normalizeCommand({
        type,
        assetId: row.querySelector('[name="assetId"]').value,
        transition: row.querySelector('[name="transition"]').value,
        fadeOutFrames: row.querySelector('[name="fadeOutFrames"]').value,
        fadeInFrames: row.querySelector('[name="fadeInFrames"]').value,
      }, assets);
    }
    if (type === 'sprite') {
      return normalizeCommand({
        type,
        slot: row.querySelector('[name="slot"]').value,
        assetId: row.querySelector('[name="assetId"]').value,
        x: row.querySelector('[name="x"]').value,
        y: row.querySelector('[name="y"]').value,
        animationId: row.querySelector('[name="animationId"]').value,
        visible: row.querySelector('[name="visible"]').checked,
      }, assets);
    }
    if (type === 'audio') {
      return normalizeCommand({
        type,
        kind: row.querySelector('[name="kind"]').value,
        action: row.querySelector('[name="action"]').value,
        assetId: row.querySelector('[name="assetId"]').value,
      }, assets);
    }
    return normalizeCommand({
      type,
      speaker: row.querySelector('[name="speaker"]').value,
      text: row.querySelector('[name="text"]').value,
      voiceAssetId: row.querySelector('[name="voiceAssetId"]').value,
      textSpeedFrames: row.querySelector('[name="textSpeedFrames"]').value,
      advanceMode: row.querySelector('[name="advanceMode"]').value,
      autoWaitFrames: row.querySelector('[name="autoWaitFrames"]').value,
      mouthSlot: row.querySelector('[name="mouthSlot"]').value,
      mouthAnimationId: row.querySelector('[name="mouthAnimationId"]').value,
    }, assets);
  }

  function selectedSceneFromForm() {
    const current = scene() || {};
    return {
      ...current,
      id: safeId(form.elements.id.value, current.id || 'scene'),
      nextSceneId: form.elements.nextSceneId.value,
      commands: Array.from(commandsEl.querySelectorAll('[data-command]')).map(commandFromRow).filter(Boolean),
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
    sceneList.innerHTML = doc.scenes.map((item) => {
      const firstMessage = item.commands.find((command) => command.type === 'message');
      return `
        <button type="button" data-scene-id="${esc(item.id)}" class="${item.id === selectedId ? 'active' : ''}">
          <strong>${esc(item.id)}</strong>
          <span>${esc(firstMessage?.text || `${item.commands.length} commands`)}</span>
        </button>
      `;
    }).join('');
    sceneList.querySelectorAll('[data-scene-id]').forEach((button) => {
      button.addEventListener('click', () => {
        commitFormToDoc();
        selectedId = button.dataset.sceneId;
        render();
      });
    });
  }

  function typeOptions(current) {
    return ['background', 'sprite', 'message', 'audio']
      .map((type) => `<option value="${type}" ${type === current ? 'selected' : ''}>${type}</option>`)
      .join('');
  }

  function commandFields(command) {
    if (command.type === 'background') {
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">背景</span><select class="form-select" name="assetId">${optionsFor(byType(['image']), command.assetId, 'なし')}</select></label>
          <label class="form-group"><span class="form-label">切替</span><select class="form-select" name="transition"><option value="cut" ${command.transition !== 'fade' ? 'selected' : ''}>cut</option><option value="fade" ${command.transition === 'fade' ? 'selected' : ''}>fade</option></select></label>
        </div>
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Fade out</span><input class="form-input" name="fadeOutFrames" type="number" min="0" max="60" value="${esc(command.fadeOutFrames)}" /></label>
          <label class="form-group"><span class="form-label">Fade in</span><input class="form-input" name="fadeInFrames" type="number" min="0" max="60" value="${esc(command.fadeInFrames)}" /></label>
        </div>
      `;
    }
    if (command.type === 'sprite') {
      const sprite = assetById(command.assetId);
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Sprite</span><select class="form-select" name="assetId">${optionsFor(byType(['sprite']), command.assetId, 'なし')}</select></label>
          <label class="form-group"><span class="form-label">Animation</span><select class="form-select" name="animationId">${animationOptions(sprite, command.animationId)}</select></label>
        </div>
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Slot</span><input class="form-input" name="slot" type="number" min="0" max="3" value="${esc(command.slot)}" /></label>
          <label class="form-group"><span class="form-label">X</span><input class="form-input" name="x" type="number" min="0" max="319" value="${esc(command.x)}" /></label>
          <label class="form-group"><span class="form-label">Y</span><input class="form-input" name="y" type="number" min="0" max="223" value="${esc(command.y)}" /></label>
          <label class="pce-vn-check"><input name="visible" type="checkbox" ${command.visible !== false ? 'checked' : ''} /><span>visible</span></label>
        </div>
      `;
    }
    if (command.type === 'audio') {
      const audioAssets = command.kind === 'adpcm' ? byType(['adpcm']) : byType(['cdda-track']);
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Kind</span><select class="form-select" name="kind"><option value="cdda" ${command.kind !== 'adpcm' ? 'selected' : ''}>CD-DA</option><option value="adpcm" ${command.kind === 'adpcm' ? 'selected' : ''}>ADPCM</option></select></label>
          <label class="form-group"><span class="form-label">Action</span><select class="form-select" name="action"><option value="play" ${command.action !== 'stop' ? 'selected' : ''}>play</option><option value="stop" ${command.action === 'stop' ? 'selected' : ''}>stop</option></select></label>
        </div>
        <label class="form-group"><span class="form-label">Asset</span><select class="form-select" name="assetId">${optionsFor(audioAssets, command.assetId, 'なし')}</select></label>
      `;
    }
    return `
      <div class="pce-vn-grid">
        <label class="form-group"><span class="form-label">話者</span><input class="form-input" name="speaker" value="${esc(command.speaker || '')}" /></label>
        <label class="form-group"><span class="form-label">ADPCM</span><select class="form-select" name="voiceAssetId">${optionsFor(byType(['adpcm']), command.voiceAssetId, 'なし')}</select></label>
      </div>
      <label class="form-group"><span class="form-label">本文</span><textarea class="form-input" name="text" rows="2">${esc(command.text || '')}</textarea></label>
      <div class="pce-vn-grid tight">
        <label class="form-group"><span class="form-label">Speed</span><input class="form-input" name="textSpeedFrames" type="number" min="0" max="30" value="${esc(command.textSpeedFrames)}" /></label>
        <label class="form-group"><span class="form-label">Advance</span><select class="form-select" name="advanceMode"><option value="button" ${command.advanceMode !== 'auto' ? 'selected' : ''}>button</option><option value="auto" ${command.advanceMode === 'auto' ? 'selected' : ''}>auto</option></select></label>
        <label class="form-group"><span class="form-label">Wait</span><input class="form-input" name="autoWaitFrames" type="number" min="0" max="255" value="${esc(command.autoWaitFrames)}" /></label>
        <label class="form-group"><span class="form-label">Mouth slot</span><input class="form-input" name="mouthSlot" type="number" min="0" max="3" value="${esc(command.mouthSlot)}" /></label>
      </div>
      <label class="form-group"><span class="form-label">Mouth animation</span><input class="form-input form-input-mono" name="mouthAnimationId" value="${esc(command.mouthAnimationId || '')}" /></label>
    `;
  }

  function renderCommands(current) {
    commandsEl.innerHTML = current.commands.map((command, index) => `
      <section class="pce-vn-command-row" data-command>
        <div class="pce-vn-command-head">
          <strong>#${index + 1}</strong>
          <select class="form-select" name="type">${typeOptions(command.type)}</select>
          <div class="pce-vn-actions">
            <button class="icon-btn" type="button" data-command-up="${index}" title="上へ" aria-label="上へ">↑</button>
            <button class="icon-btn" type="button" data-command-down="${index}" title="下へ" aria-label="下へ">↓</button>
            <button class="icon-btn danger" type="button" data-command-remove="${index}" title="削除" aria-label="削除">×</button>
          </div>
        </div>
        ${commandFields(command)}
      </section>
    `).join('');
    commandsEl.querySelectorAll('input, textarea, select').forEach((input) => {
      input.addEventListener('input', renderPreview);
      input.addEventListener('change', (event) => {
        if (event.target.name === 'type') {
          const rows = Array.from(commandsEl.querySelectorAll('[data-command]'));
          const rowIndex = rows.indexOf(event.target.closest('[data-command]'));
          const base = scene() || {};
          const currentScene = {
            ...base,
            id: safeId(form.elements.id.value, base.id || 'scene'),
            nextSceneId: form.elements.nextSceneId.value,
            commands: Array.isArray(base.commands) ? base.commands.slice() : [],
          };
          if (rowIndex >= 0) currentScene.commands[rowIndex] = defaultCommand(event.target.value, assets);
          const sceneIndex = doc.scenes.findIndex((item) => item.id === selectedId);
          doc.scenes[sceneIndex] = currentScene;
          render();
        } else if (event.target.name === 'kind' || event.target.name === 'assetId') {
          commitFormToDoc();
          render();
        } else {
          renderPreview();
        }
      });
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
    const slots = new Map();
    let background = null;
    let message = null;
    let audio = '';
    current.commands.forEach((command) => {
      if (command.type === 'background') background = assetById(command.assetId);
      if (command.type === 'sprite') {
        if (command.visible) slots.set(command.slot, { command, asset: assetById(command.assetId) });
        else slots.delete(command.slot);
      }
      if (command.type === 'message') message = command;
      if (command.type === 'audio') audio = `${command.kind}:${command.action}${command.assetId ? ` ${command.assetId}` : ''}`;
    });
    await setPreviewImage(bgPreview, background);
    spriteLayer.innerHTML = '';
    for (const { command, asset } of slots.values()) {
      if (!asset?.source) continue;
      const img = document.createElement('img');
      img.alt = asset.name || asset.id;
      img.style.left = `${(command.x / PCE_SCREEN_WIDTH) * 100}%`;
      img.style.top = `${(command.y / PCE_SCREEN_HEIGHT) * 100}%`;
      spriteLayer.appendChild(img);
      const result = await api.electronAPI.previewAssetSource(asset.source);
      if (result?.dataUrl) img.src = result.dataUrl;
    }
    messagePreview.textContent = message
      ? `${message.speaker ? `${message.speaker}: ` : ''}${message.text}`
      : '';
    metaEl.innerHTML = `
      <dt>target</dt><dd>SUPER CD-ROM2 / llvm-mos</dd>
      <dt>background</dt><dd>${esc(background?.name || background?.id || '-')}</dd>
      <dt>sprites</dt><dd>${esc(String(slots.size))}</dd>
      <dt>commands</dt><dd>${esc(String(current.commands.length))}</dd>
      <dt>audio</dt><dd>${esc(audio || '-')}</dd>
    `;
  }

  function renderForm() {
    const current = scene();
    if (!current) return;
    root.querySelector('[data-role="scene-title"]').textContent = current.id;
    form.elements.id.value = current.id;
    form.elements.nextSceneId.innerHTML = optionsFor(doc.scenes.filter((item) => item.id !== current.id).map((item) => ({ id: item.id, name: item.id })), current.nextSceneId, '終端');
    renderCommands(current);
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
    doc.scenes.push({ id, commands: [defaultCommand('message', assets)], nextSceneId: '' });
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
  root.querySelectorAll('[data-add-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = selectedSceneFromForm();
      current.commands.push(defaultCommand(button.dataset.addCommand, assets));
      const index = doc.scenes.findIndex((item) => item.id === selectedId);
      doc.scenes[index] = current;
      render();
    });
  });
  commandsEl.addEventListener('click', (event) => {
    const remove = event.target?.closest?.('[data-command-remove]');
    const up = event.target?.closest?.('[data-command-up]');
    const down = event.target?.closest?.('[data-command-down]');
    if (!remove && !up && !down) return;
    const current = selectedSceneFromForm();
    const index = Number((remove || up || down).dataset.commandRemove ?? (remove || up || down).dataset.commandUp ?? (remove || up || down).dataset.commandDown);
    if (remove) current.commands.splice(index, 1);
    if (up && index > 0) current.commands.splice(index - 1, 0, current.commands.splice(index, 1)[0]);
    if (down && index + 1 < current.commands.length) current.commands.splice(index + 1, 0, current.commands.splice(index, 1)[0]);
    if (!current.commands.length) current.commands.push(defaultCommand('message', assets));
    const sceneIndex = doc.scenes.findIndex((item) => item.id === selectedId);
    doc.scenes[sceneIndex] = current;
    render();
  });

  registerCapability('visual-novel-editor', { reload: load, save });
  void load();
  return { deactivate() {} };
}
