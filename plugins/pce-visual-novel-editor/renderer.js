const SCENE_FILE = 'assets/pce-vn-scenes.json';
const PCE_SCREEN_WIDTH = 320;
const PCE_SCREEN_HEIGHT = 224;
const DEFAULT_CHARACTER_Y = 24;
const COLUMN_LAYOUT_KEY = 'pce-vn-editor.columnLayout.v1';
const DEFAULT_COLUMN_LAYOUT = { left: 320, right: 440 };
const MIN_LEFT_WIDTH = 240;
const MAX_LEFT_WIDTH = 520;
const MIN_CENTER_WIDTH = 340;
const MIN_RIGHT_WIDTH = 320;
const MAX_RIGHT_WIDTH = 720;

const COMMAND_DEFINITIONS = [
  { type: 'background', label: 'BG', category: '表示', description: '背景画像と切替' },
  { type: 'sprite', label: 'Sprite', category: '表示', description: '立ち絵の表示/非表示' },
  { type: 'message', label: 'Message', category: 'テキスト', description: '話者、本文、送り設定' },
  { type: 'choice', label: 'Choice', category: '分岐', description: '選択肢でシーン分岐' },
  { type: 'jump', label: 'Jump', category: '分岐', description: '別シーンへ移動' },
  { type: 'preload', label: 'Preload', category: '分岐', description: '次シーンを先読み' },
  { type: 'wait', label: 'Wait', category: '制御', description: '指定フレーム待機' },
  { type: 'audio', label: 'Audio', category: '音声', description: 'CD-DA/ADPCM再生停止' },
  { type: 'effect', label: 'Effect', category: '演出', description: 'フェード/揺れ' },
];
const COMMAND_CATEGORIES = [...new Set(COMMAND_DEFINITIONS.map((item) => item.category))];

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

function commandDefinition(type) {
  return COMMAND_DEFINITIONS.find((item) => item.type === type) || COMMAND_DEFINITIONS.find((item) => item.type === 'message');
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
    return { type: 'sprite', slot: 0, assetId, x: 128, y: DEFAULT_CHARACTER_Y, animationId: 'default', flipX: false, flipY: false, durationFrames: 0, visible: true };
  }
  if (type === 'audio') {
    return { type: 'audio', kind: 'cdda', action: 'play', assetId: first('cdda-track') };
  }
  if (type === 'effect') {
    return { type: 'effect', effect: 'shake', frames: 16, intensity: 4 };
  }
  if (type === 'preload') {
    return { type: 'preload', sceneId: '' };
  }
  if (type === 'choice') {
    return { type: 'choice', defaultIndex: 0, choices: [{ label: '進む', targetSceneId: '' }] };
  }
  if (type === 'jump') {
    return { type: 'jump', sceneId: '' };
  }
  if (type === 'wait') {
    return { type: 'wait', frames: 30 };
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
        { ...defaultCommand('message', assets), text: '320がめんです' },
        { ...defaultCommand('message', assets), text: '18もじx4ぎょう', voiceAssetId: '' },
      ],
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
      animationId: String(raw.animationId || 'default').trim().slice(0, 32) || 'default',
      flipX: Boolean(raw.flipX ?? raw.flippedX ?? raw.hflip),
      flipY: Boolean(raw.flipY ?? raw.flippedY ?? raw.vflip),
      durationFrames: clamp(raw.durationFrames ?? raw.moveFrames ?? raw.frames, 0, 255, 0),
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
  if (raw.type === 'preload') {
    return { type: 'preload', sceneId: safeId(raw.sceneId || raw.nextSceneId || raw.targetSceneId, '') };
  }
  if (raw.type === 'choice') {
    const choices = (Array.isArray(raw.choices) ? raw.choices : [])
      .map((choice, choiceIndex) => {
        const item = choice && typeof choice === 'object' ? choice : {};
        const label = String(item.label || item.text || `選択肢${choiceIndex + 1}`).trim().slice(0, 24);
        if (!label) return null;
        return { label, targetSceneId: safeId(item.targetSceneId || item.sceneId || item.nextSceneId || item.target, '') };
      })
      .filter(Boolean)
      .slice(0, 4);
    const normalizedChoices = choices.length ? choices : [{ label: '進む', targetSceneId: '' }];
    return {
      type: 'choice',
      choices: normalizedChoices,
      defaultIndex: clamp(raw.defaultIndex ?? raw.initialIndex, 0, normalizedChoices.length - 1, 0),
    };
  }
  if (raw.type === 'jump') {
    return { type: 'jump', sceneId: safeId(raw.sceneId || raw.targetSceneId || raw.nextSceneId, '') };
  }
  if (raw.type === 'wait') {
    return { type: 'wait', frames: clamp(raw.frames ?? raw.durationFrames, 0, 65535, 30) };
  }
  if (raw.type === 'effect') {
    const effect = (() => {
      const value = String(raw.effect || raw.kind || raw.name || '').trim();
      if (value === 'fadeIn' || value === 'fade-in' || value === 'in') return 'fadeIn';
      if (value === 'blank' || value === 'black') return 'blank';
      if (value === 'shake' || value === 'screenShake' || value === 'screen-shake') return 'shake';
      return 'fadeOut';
    })();
    return {
      type: 'effect',
      effect,
      frames: clamp(raw.frames ?? raw.durationFrames, 0, 255, 16),
      intensity: effect === 'shake' ? clamp(raw.intensity ?? raw.power ?? raw.amplitude, 1, 16, 4) : 0,
    };
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
      commands: (scene.commands || []).map((command) => {
        if (command.type === 'preload' || command.type === 'jump') {
          return { ...command, sceneId: command.sceneId && sceneIds.has(command.sceneId) ? command.sceneId : '' };
        }
        if (command.type === 'choice') {
          return {
            ...command,
            choices: (command.choices || []).map((choice) => ({
              ...choice,
              targetSceneId: choice.targetSceneId && sceneIds.has(choice.targetSceneId) ? choice.targetSceneId : '',
            })),
          };
        }
        return command;
      }),
    })),
  };
}

export function activatePlugin({ root, api, registerCapability }) {
  root.innerHTML = `
    <div class="pce-vn-shell">
      <aside class="pce-vn-list">
        <section class="pce-vn-sidebar-section">
          <div class="pce-vn-header">
            <h2>Scenes</h2>
            <div class="pce-vn-actions">
              <button class="icon-btn" type="button" data-action="add-scene" title="シーン追加" aria-label="シーン追加">＋</button>
              <button class="icon-btn" type="button" data-action="reload" title="再読み込み" aria-label="再読み込み">↻</button>
            </div>
          </div>
          <div class="pce-vn-items" data-role="scene-list"></div>
        </section>
        <section class="pce-vn-sidebar-section pce-vn-command-library">
          <div class="pce-vn-header">
            <h2>Commands</h2>
          </div>
          <div class="pce-vn-command-search">
            <input class="form-input" data-role="command-search" placeholder="コマンド検索" aria-label="コマンド検索" />
          </div>
          <div class="pce-vn-command-palette" data-role="command-palette"></div>
        </section>
      </aside>
      <div class="pce-vn-column-resizer" data-column-resizer="left" role="separator" aria-orientation="vertical" aria-label="左列幅"></div>
      <section class="pce-vn-edit">
        <div class="pce-vn-edit-title">
          <h2 data-role="scene-title">Scene</h2>
          <div class="pce-vn-actions">
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
      <div class="pce-vn-column-resizer" data-column-resizer="right" role="separator" aria-orientation="vertical" aria-label="右列幅"></div>
      <aside class="pce-vn-preview">
        <div class="pce-vn-stage">
          <img data-role="bg-preview" alt="background preview" hidden />
          <div class="pce-vn-sprite-layer" data-role="sprite-layer"></div>
          <div class="pce-vn-message-preview" data-role="message-preview"></div>
        </div>
        <form class="pce-vn-detail-form" data-role="command-detail"></form>
        <dl class="pce-vn-meta" data-role="meta"></dl>
      </aside>
    </div>
  `;

  const shell = root.querySelector('.pce-vn-shell');
  const sceneList = root.querySelector('[data-role="scene-list"]');
  const form = root.querySelector('[data-role="scene-form"]');
  const commandsEl = root.querySelector('[data-role="commands"]');
  const detailForm = root.querySelector('[data-role="command-detail"]');
  const commandSearchInput = root.querySelector('[data-role="command-search"]');
  const commandPaletteEl = root.querySelector('[data-role="command-palette"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const bgPreview = root.querySelector('[data-role="bg-preview"]');
  const spriteLayer = root.querySelector('[data-role="sprite-layer"]');
  const messagePreview = root.querySelector('[data-role="message-preview"]');
  const metaEl = root.querySelector('[data-role="meta"]');
  let assets = [];
  let doc = defaultDoc();
  let selectedId = 'opening';
  let selectedCommandIndex = 0;
  let commandSearch = '';
  let columnLayout = loadColumnLayout();
  let pointerDrag = null;
  let suppressCommandClick = false;

  const byType = (types) => assets.filter((asset) => types.includes(asset.type));
  const scene = () => doc.scenes.find((item) => item.id === selectedId) || doc.scenes[0] || null;
  const assetById = (id) => assets.find((asset) => asset.id === id) || null;

  applyColumnLayout();

  function loadColumnLayout() {
    try {
      const parsed = JSON.parse(localStorage.getItem(COLUMN_LAYOUT_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        return {
          left: clamp(parsed.left, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH, DEFAULT_COLUMN_LAYOUT.left),
          right: clamp(parsed.right, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH, DEFAULT_COLUMN_LAYOUT.right),
        };
      }
    } catch (_) {}
    return { ...DEFAULT_COLUMN_LAYOUT };
  }

  function saveColumnLayout() {
    try {
      localStorage.setItem(COLUMN_LAYOUT_KEY, JSON.stringify(columnLayout));
    } catch (_) {}
  }

  function applyColumnLayout() {
    shell.style.setProperty('--pce-vn-left-width', `${columnLayout.left}px`);
    shell.style.setProperty('--pce-vn-right-width', `${columnLayout.right}px`);
  }

  function resizeColumns(event) {
    const side = event.currentTarget?.dataset?.columnResizer;
    if (!side) return;
    event.preventDefault();
    const resizer = event.currentTarget;
    const shellRect = shell.getBoundingClientRect();
    const maxLeft = Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, shellRect.width - columnLayout.right - MIN_CENTER_WIDTH - 10));
    const maxRight = Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, shellRect.width - columnLayout.left - MIN_CENTER_WIDTH - 10));
    resizer.classList.add('is-dragging');

    const move = (moveEvent) => {
      if (side === 'left') {
        columnLayout.left = clamp(moveEvent.clientX - shellRect.left, MIN_LEFT_WIDTH, maxLeft, columnLayout.left);
      } else {
        columnLayout.right = clamp(shellRect.right - moveEvent.clientX, MIN_RIGHT_WIDTH, maxRight, columnLayout.right);
      }
      applyColumnLayout();
    };
    const finish = () => {
      resizer.classList.remove('is-dragging');
      saveColumnLayout();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }

  function ensureSelectedCommand(current = scene()) {
    if (!current) return null;
    if (!Array.isArray(current.commands)) current.commands = [];
    if (!current.commands.length) current.commands.push(defaultCommand('message', assets));
    selectedCommandIndex = clamp(selectedCommandIndex, 0, current.commands.length - 1, 0);
    return current.commands[selectedCommandIndex] || null;
  }

  function typeOptions(current) {
    return COMMAND_DEFINITIONS
      .map((item) => `<option value="${item.type}" ${item.type === current ? 'selected' : ''}>${esc(item.label)}</option>`)
      .join('');
  }

  function sceneOptions(current, label = 'なし') {
    return optionsFor(doc.scenes.map((item) => ({ id: item.id, name: item.id })), current, label);
  }

  function commandSummary(command) {
    if (!command) return '';
    if (command.type === 'background') return assetById(command.assetId)?.name || command.assetId || '背景なし';
    if (command.type === 'sprite') {
      const name = assetById(command.assetId)?.name || command.assetId || 'spriteなし';
      return `${name} slot ${command.slot} (${command.x}, ${command.y})`;
    }
    if (command.type === 'message') return `${command.speaker ? `${command.speaker}: ` : ''}${command.text || '本文なし'}`;
    if (command.type === 'audio') return `${command.kind}:${command.action}${command.assetId ? ` ${command.assetId}` : ''}`;
    if (command.type === 'effect') return command.effect === 'shake' ? `shake ${command.frames}f / ${command.intensity}` : `${command.effect} ${command.frames}f`;
    if (command.type === 'preload') return command.sceneId ? `scene ${command.sceneId}` : 'scene未指定';
    if (command.type === 'choice') return (command.choices || []).map((choice) => choice.label).join(' / ') || '選択肢なし';
    if (command.type === 'jump') return command.sceneId ? `scene ${command.sceneId}` : 'scene未指定';
    if (command.type === 'wait') return `${command.frames} frames`;
    return command.type;
  }

  function selectedCommandFromDetail(existing) {
    if (!detailForm.elements.type) return existing;
    const type = detailForm.elements.type.value;
    if (type !== existing.type) return defaultCommand(type, assets);
    if (type === 'background') {
      return normalizeCommand({
        type,
        assetId: detailForm.elements.assetId.value,
        transition: detailForm.elements.transition.value,
        fadeOutFrames: detailForm.elements.fadeOutFrames.value,
        fadeInFrames: detailForm.elements.fadeInFrames.value,
      }, assets);
    }
    if (type === 'sprite') {
      return normalizeCommand({
        type,
        slot: detailForm.elements.slot.value,
        assetId: detailForm.elements.assetId.value,
        x: detailForm.elements.x.value,
        y: detailForm.elements.y.value,
        animationId: detailForm.elements.animationId.value,
        flipX: detailForm.elements.flipX.checked,
        flipY: detailForm.elements.flipY.checked,
        durationFrames: detailForm.elements.durationFrames.value,
        visible: detailForm.elements.visible.checked,
      }, assets);
    }
    if (type === 'audio') {
      return normalizeCommand({
        type,
        kind: detailForm.elements.kind.value,
        action: detailForm.elements.action.value,
        assetId: detailForm.elements.assetId.value,
      }, assets);
    }
    if (type === 'effect') {
      return normalizeCommand({
        type,
        effect: detailForm.elements.effect.value,
        frames: detailForm.elements.frames.value,
        intensity: detailForm.elements.intensity.value,
      }, assets);
    }
    if (type === 'preload' || type === 'jump') {
      return normalizeCommand({ type, sceneId: detailForm.elements.sceneId.value }, assets);
    }
    if (type === 'wait') {
      return normalizeCommand({ type, frames: detailForm.elements.frames.value }, assets);
    }
    if (type === 'choice') {
      const choices = Array.from(detailForm.querySelectorAll('[data-choice-row]')).map((row) => ({
        label: row.querySelector('[data-choice-field="label"]')?.value || '',
        targetSceneId: row.querySelector('[data-choice-field="targetSceneId"]')?.value || '',
      }));
      return normalizeCommand({ type, defaultIndex: detailForm.elements.defaultIndex.value, choices }, assets);
    }
    return normalizeCommand({
      type,
      speaker: detailForm.elements.speaker.value,
      text: detailForm.elements.text.value,
      voiceAssetId: detailForm.elements.voiceAssetId.value,
      textSpeedFrames: detailForm.elements.textSpeedFrames.value,
      advanceMode: detailForm.elements.advanceMode.value,
      autoWaitFrames: detailForm.elements.autoWaitFrames.value,
      mouthSlot: detailForm.elements.mouthSlot.value,
      mouthAnimationId: detailForm.elements.mouthAnimationId.value,
    }, assets);
  }

  function updateSelectedCommandFromDetail(options = {}) {
    const {
      rerenderDetail = false,
      rerenderCommands = true,
      updatePreview = true,
    } = options;
    const current = scene();
    const existing = ensureSelectedCommand(current);
    if (!current || !existing || !detailForm.elements.type) return;
    current.commands[selectedCommandIndex] = selectedCommandFromDetail(existing);
    if (rerenderCommands) renderCommands(current);
    if (rerenderDetail) renderCommandDetail(current);
    if (updatePreview) void renderPreview();
  }

  function commitCurrentUiToDoc() {
    updateSelectedCommandFromDetail({ rerenderCommands: false, updatePreview: false });
    commitSceneMetaToDoc();
  }

  function commitSceneMetaToDoc() {
    const current = scene();
    if (!current) return;
    const index = doc.scenes.indexOf(current);
    const next = {
      ...current,
      id: safeId(form.elements.id.value, current.id || 'scene'),
      nextSceneId: form.elements.nextSceneId.value,
    };
    const oldId = current.id;
    doc.scenes[index] = next;
    if (doc.startScene === oldId) doc.startScene = next.id;
    doc.scenes = doc.scenes.map((item) => ({
      ...item,
      nextSceneId: item.nextSceneId === oldId ? next.id : item.nextSceneId,
      commands: (item.commands || []).map((command) => {
        if ((command.type === 'preload' || command.type === 'jump') && command.sceneId === oldId) {
          return { ...command, sceneId: next.id };
        }
        if (command.type === 'choice') {
          return {
            ...command,
            choices: (command.choices || []).map((choice) => ({
              ...choice,
              targetSceneId: choice.targetSceneId === oldId ? next.id : choice.targetSceneId,
            })),
          };
        }
        return command;
      }),
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
        commitCurrentUiToDoc();
        selectedId = button.dataset.sceneId;
        selectedCommandIndex = 0;
        render();
      });
    });
  }

  function renderCommandPalette() {
    const query = commandSearch.trim().toLowerCase();
    const matches = COMMAND_DEFINITIONS.filter((item) => {
      if (!query) return true;
      return `${item.type} ${item.label} ${item.category} ${item.description}`.toLowerCase().includes(query);
    });
    if (!matches.length) {
      commandPaletteEl.innerHTML = '<p class="pce-vn-empty">該当コマンドがありません</p>';
      return;
    }
    commandPaletteEl.innerHTML = COMMAND_CATEGORIES.map((category) => {
      const items = matches.filter((item) => item.category === category);
      if (!items.length) return '';
      return `
        <section class="pce-vn-palette-category">
          <h3>${esc(category)}</h3>
          ${items.map((item) => `
            <div class="pce-vn-palette-command" draggable="true" data-palette-command="${item.type}">
              <span>
                <strong>${esc(item.label)}</strong>
                <small>${esc(item.description)}</small>
              </span>
              <button class="icon-btn" type="button" data-palette-add="${item.type}" title="${esc(item.label)}を追加" aria-label="${esc(item.label)}を追加">＋</button>
            </div>
          `).join('')}
        </section>
      `;
    }).join('');
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
          <label class="form-group"><span class="form-label">Move</span><input class="form-input" name="durationFrames" type="number" min="0" max="255" value="${esc(command.durationFrames || 0)}" /></label>
          <label class="pce-vn-check"><input name="flipX" type="checkbox" ${command.flipX ? 'checked' : ''} /><span>flip X</span></label>
          <label class="pce-vn-check"><input name="flipY" type="checkbox" ${command.flipY ? 'checked' : ''} /><span>flip Y</span></label>
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
    if (command.type === 'effect') {
      return `
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Effect</span><select class="form-select" name="effect"><option value="fadeOut" ${command.effect === 'fadeOut' ? 'selected' : ''}>fade out</option><option value="fadeIn" ${command.effect === 'fadeIn' ? 'selected' : ''}>fade in</option><option value="blank" ${command.effect === 'blank' ? 'selected' : ''}>blank</option><option value="shake" ${command.effect === 'shake' ? 'selected' : ''}>shake</option></select></label>
          <label class="form-group"><span class="form-label">Frames</span><input class="form-input" name="frames" type="number" min="0" max="255" value="${esc(command.frames)}" /></label>
          <label class="form-group"><span class="form-label">Power</span><input class="form-input" name="intensity" type="number" min="1" max="16" value="${esc(command.intensity || 4)}" /></label>
        </div>
      `;
    }
    if (command.type === 'preload' || command.type === 'jump') {
      return `
        <label class="form-group"><span class="form-label">Scene</span><select class="form-select" name="sceneId">${sceneOptions(command.sceneId, 'なし')}</select></label>
      `;
    }
    if (command.type === 'wait') {
      return `
        <label class="form-group"><span class="form-label">Frames</span><input class="form-input" name="frames" type="number" min="0" max="65535" value="${esc(command.frames)}" /></label>
      `;
    }
    if (command.type === 'choice') {
      return `
        <label class="form-group"><span class="form-label">Default</span><input class="form-input" name="defaultIndex" type="number" min="0" max="${Math.max(0, (command.choices || []).length - 1)}" value="${esc(command.defaultIndex || 0)}" /></label>
        <div class="pce-vn-choice-list" data-role="choice-list">
          ${(command.choices || []).map((choice, index) => `
            <div class="pce-vn-choice-row" data-choice-row>
              <label class="form-group"><span class="form-label">Label ${index + 1}</span><input class="form-input" data-choice-field="label" value="${esc(choice.label || '')}" /></label>
              <label class="form-group"><span class="form-label">Target</span><select class="form-select" data-choice-field="targetSceneId">${sceneOptions(choice.targetSceneId, 'なし')}</select></label>
              <button class="icon-btn danger" type="button" data-choice-remove="${index}" title="選択肢削除" aria-label="選択肢削除">×</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-sm" type="button" data-choice-add>選択肢追加</button>
      `;
    }
    return `
      <div class="pce-vn-grid">
        <label class="form-group"><span class="form-label">話者</span><input class="form-input" name="speaker" value="${esc(command.speaker || '')}" /></label>
        <label class="form-group"><span class="form-label">ADPCM</span><select class="form-select" name="voiceAssetId">${optionsFor(byType(['adpcm']), command.voiceAssetId, 'なし')}</select></label>
      </div>
      <label class="form-group"><span class="form-label">本文</span><textarea class="form-input" name="text" rows="3">${esc(command.text || '')}</textarea></label>
      <div class="pce-vn-grid tight">
        <label class="form-group"><span class="form-label">Speed</span><input class="form-input" name="textSpeedFrames" type="number" min="0" max="30" value="${esc(command.textSpeedFrames)}" /></label>
        <label class="form-group"><span class="form-label">Advance</span><select class="form-select" name="advanceMode"><option value="button" ${command.advanceMode !== 'auto' ? 'selected' : ''}>button</option><option value="auto" ${command.advanceMode === 'auto' ? 'selected' : ''}>auto</option></select></label>
        <label class="form-group"><span class="form-label">Wait</span><input class="form-input" name="autoWaitFrames" type="number" min="0" max="255" value="${esc(command.autoWaitFrames)}" /></label>
        <label class="form-group"><span class="form-label">Mouth slot</span><input class="form-input" name="mouthSlot" type="number" min="0" max="3" value="${esc(command.mouthSlot)}" /></label>
      </div>
      <label class="form-group"><span class="form-label">Mouth animation</span><input class="form-input form-input-mono" name="mouthAnimationId" value="${esc(command.mouthAnimationId || '')}" /></label>
    `;
  }

  function renderCommandDetail(current) {
    const command = ensureSelectedCommand(current);
    if (!command) {
      detailForm.innerHTML = '<p class="pce-vn-empty">コマンドを選択してください</p>';
      return;
    }
    const definition = commandDefinition(command.type);
    detailForm.innerHTML = `
      <div class="pce-vn-detail-head">
        <span>#${selectedCommandIndex + 1}</span>
        <strong>${esc(definition.label)}</strong>
      </div>
      <label class="form-group"><span class="form-label">Type</span><select class="form-select" name="type">${typeOptions(command.type)}</select></label>
      ${commandFields(command)}
    `;
  }

  function renderCommands(current) {
    ensureSelectedCommand(current);
    const pieces = ['<div class="pce-vn-command-dropzone" data-drop-index="0"></div>'];
    pieces.push(...current.commands.map((command, index) => {
      const definition = commandDefinition(command.type);
      return `
        <section class="pce-vn-command-row ${index === selectedCommandIndex ? 'active' : ''}" data-command data-command-index="${index}" draggable="true">
          <button class="pce-vn-command-select" type="button" data-command-select="${index}">
            <span class="pce-vn-drag-handle" aria-hidden="true">::</span>
            <span class="pce-vn-command-index">#${index + 1}</span>
            <span class="pce-vn-command-text">
              <strong>${esc(definition.label)}</strong>
              <small>${esc(commandSummary(command))}</small>
            </span>
          </button>
          <button class="icon-btn danger" type="button" data-command-remove="${index}" title="削除" aria-label="削除">×</button>
        </section>
        <div class="pce-vn-command-dropzone" data-drop-index="${index + 1}"></div>
      `;
    }));
    commandsEl.innerHTML = pieces.join('');
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
    const current = scene();
    if (!current) return;
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
      img.style.transform = `scale(${command.flipX ? -1 : 1}, ${command.flipY ? -1 : 1})`;
      spriteLayer.appendChild(img);
      const result = await api.electronAPI.previewAssetSource(asset.source);
      if (result?.dataUrl) img.src = result.dataUrl;
    }
    messagePreview.textContent = message
      ? `${message.speaker ? `${message.speaker}: ` : ''}${message.text}`
      : '';
    const selected = ensureSelectedCommand(current);
    metaEl.innerHTML = `
      <dt>target</dt><dd>SUPER CD-ROM2 / llvm-mos</dd>
      <dt>background</dt><dd>${esc(background?.name || background?.id || '-')}</dd>
      <dt>sprites</dt><dd>${esc(String(slots.size))}</dd>
      <dt>commands</dt><dd>${esc(String(current.commands.length))}</dd>
      <dt>selected</dt><dd>${esc(selected ? `#${selectedCommandIndex + 1} ${commandDefinition(selected.type).label}` : '-')}</dd>
      <dt>audio</dt><dd>${esc(audio || '-')}</dd>
    `;
  }

  function renderForm() {
    const current = scene();
    if (!current) return;
    ensureSelectedCommand(current);
    root.querySelector('[data-role="scene-title"]').textContent = current.id;
    form.elements.id.value = current.id;
    form.elements.nextSceneId.innerHTML = optionsFor(
      doc.scenes.filter((item) => item.id !== current.id).map((item) => ({ id: item.id, name: item.id })),
      current.nextSceneId,
      '終端',
    );
    renderCommands(current);
    renderCommandDetail(current);
    void renderPreview();
  }

  function render() {
    renderSceneList();
    renderCommandPalette();
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
    selectedCommandIndex = 0;
    render();
  }

  async function save() {
    try {
      commitCurrentUiToDoc();
      doc = normalizeDoc(doc, assets);
      await api.electronAPI.writeCodeFile({ path: SCENE_FILE, content: JSON.stringify(doc, null, 2), encoding: 'utf8' });
      errorEl.textContent = '保存しました';
      render();
    } catch (err) {
      errorEl.textContent = `保存失敗: ${err?.message || err}`;
    }
  }

  function insertCommand(type, rawIndex) {
    commitCurrentUiToDoc();
    const current = scene();
    if (!current) return;
    const index = clamp(rawIndex, 0, current.commands.length, current.commands.length);
    current.commands.splice(index, 0, defaultCommand(type, assets));
    selectedCommandIndex = index;
    render();
  }

  function removeCommand(index) {
    const current = scene();
    if (!current) return;
    current.commands.splice(index, 1);
    if (!current.commands.length) current.commands.push(defaultCommand('message', assets));
    selectedCommandIndex = clamp(Math.min(index, current.commands.length - 1), 0, current.commands.length - 1, 0);
    render();
  }

  function moveCommand(fromIndex, rawToIndex) {
    commitCurrentUiToDoc();
    const current = scene();
    if (!current || fromIndex < 0 || fromIndex >= current.commands.length) return;
    let toIndex = clamp(rawToIndex, 0, current.commands.length, current.commands.length);
    const [command] = current.commands.splice(fromIndex, 1);
    if (fromIndex < toIndex) toIndex -= 1;
    current.commands.splice(toIndex, 0, command);
    selectedCommandIndex = toIndex;
    render();
  }

  function clearDropState() {
    commandsEl.querySelectorAll('.is-drop-target').forEach((item) => item.classList.remove('is-drop-target'));
  }

  function resolveDropIndexFromElement(element, clientY) {
    const zone = element?.closest?.('[data-drop-index]');
    if (zone) return Number(zone.dataset.dropIndex);
    const row = element?.closest?.('[data-command-index]');
    if (!row) return null;
    const rowIndex = Number(row.dataset.commandIndex);
    const rect = row.getBoundingClientRect();
    return clientY > rect.top + rect.height / 2 ? rowIndex + 1 : rowIndex;
  }

  function resolveDropIndex(event) {
    const directIndex = resolveDropIndexFromElement(event.target, event.clientY);
    if (directIndex != null) return directIndex;
    return resolveDropIndexFromElement(document.elementFromPoint(event.clientX, event.clientY), event.clientY);
  }

  function showDropTarget(index) {
    clearDropState();
    commandsEl.querySelector(`[data-drop-index="${index}"]`)?.classList.add('is-drop-target');
  }

  root.querySelectorAll('[data-column-resizer]').forEach((resizer) => {
    resizer.addEventListener('pointerdown', resizeColumns);
  });

  commandSearchInput.addEventListener('input', () => {
    commandSearch = commandSearchInput.value;
    renderCommandPalette();
  });

  commandPaletteEl.addEventListener('click', (event) => {
    const add = event.target?.closest?.('[data-palette-add]');
    if (!add) return;
    const current = scene();
    const insertIndex = current?.commands?.length ? selectedCommandIndex + 1 : 0;
    insertCommand(add.dataset.paletteAdd, insertIndex);
  });

  commandPaletteEl.addEventListener('dragstart', (event) => {
    const item = event.target?.closest?.('[data-palette-command]');
    if (!item) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-pce-vn-new-command', item.dataset.paletteCommand);
    event.dataTransfer.setData('text/plain', item.dataset.paletteCommand);
  });

  commandsEl.addEventListener('click', (event) => {
    if (suppressCommandClick) {
      suppressCommandClick = false;
      event.preventDefault();
      return;
    }
    const remove = event.target?.closest?.('[data-command-remove]');
    if (remove) {
      removeCommand(Number(remove.dataset.commandRemove));
      return;
    }
    const select = event.target?.closest?.('[data-command-select]');
    if (!select) return;
    updateSelectedCommandFromDetail({ rerenderCommands: false, updatePreview: false });
    selectedCommandIndex = Number(select.dataset.commandSelect);
    const current = scene();
    renderCommands(current);
    renderCommandDetail(current);
    void renderPreview();
  });

  commandsEl.addEventListener('dragstart', (event) => {
    const row = event.target?.closest?.('[data-command-index]');
    if (!row) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-pce-vn-command-index', row.dataset.commandIndex);
    event.dataTransfer.setData('text/plain', row.dataset.commandIndex);
    row.classList.add('is-dragging');
  });

  commandsEl.addEventListener('dragend', (event) => {
    event.target?.closest?.('[data-command-index]')?.classList.remove('is-dragging');
    clearDropState();
  });

  commandsEl.addEventListener('dragover', (event) => {
    const index = resolveDropIndex(event);
    if (index == null) return;
    event.preventDefault();
    const transferTypes = Array.from(event.dataTransfer.types || []);
    event.dataTransfer.dropEffect = transferTypes.includes('application/x-pce-vn-new-command') ? 'copy' : 'move';
    showDropTarget(index);
  });

  commandsEl.addEventListener('dragleave', (event) => {
    if (!commandsEl.contains(event.relatedTarget)) clearDropState();
  });

  commandsEl.addEventListener('drop', (event) => {
    const index = resolveDropIndex(event);
    if (index == null) return;
    event.preventDefault();
    clearDropState();
    const newType = event.dataTransfer.getData('application/x-pce-vn-new-command');
    if (newType) {
      insertCommand(newType, index);
      return;
    }
    const fromText = event.dataTransfer.getData('application/x-pce-vn-command-index');
    if (fromText !== '') moveCommand(Number(fromText), index);
  });

  commandsEl.addEventListener('pointerdown', (event) => {
    const row = event.target?.closest?.('[data-command-index]');
    if (!row || event.target?.closest?.('[data-command-remove]')) return;
    pointerDrag = {
      row,
      index: Number(row.dataset.commandIndex),
      startX: event.clientX,
      startY: event.clientY,
      lastIndex: Number(row.dataset.commandIndex),
      active: false,
    };
  });

  commandsEl.addEventListener('pointermove', (event) => {
    if (!pointerDrag) return;
    const distance = Math.abs(event.clientX - pointerDrag.startX) + Math.abs(event.clientY - pointerDrag.startY);
    if (!pointerDrag.active && distance < 8) return;
    pointerDrag.active = true;
    event.preventDefault();
    pointerDrag.row.classList.add('is-dragging');
    const index = resolveDropIndexFromElement(document.elementFromPoint(event.clientX, event.clientY), event.clientY);
    if (index != null) {
      pointerDrag.lastIndex = index;
      showDropTarget(index);
    }
  });

  const finishPointerDrag = () => {
    if (!pointerDrag) return;
    const drag = pointerDrag;
    pointerDrag = null;
    drag.row.classList.remove('is-dragging');
    clearDropState();
    if (drag.active) {
      suppressCommandClick = true;
      moveCommand(drag.index, drag.lastIndex);
    }
  };

  commandsEl.addEventListener('pointerup', finishPointerDrag);
  commandsEl.addEventListener('pointercancel', finishPointerDrag);

  detailForm.addEventListener('input', (event) => {
    if (event.target?.name === 'type') return;
    updateSelectedCommandFromDetail({ rerenderCommands: true, updatePreview: true });
  });

  detailForm.addEventListener('change', (event) => {
    const name = event.target?.name || '';
    const rerenderDetail = name === 'type' || name === 'kind' || name === 'assetId';
    updateSelectedCommandFromDetail({ rerenderDetail, rerenderCommands: true, updatePreview: true });
  });

  detailForm.addEventListener('click', (event) => {
    const add = event.target?.closest?.('[data-choice-add]');
    const remove = event.target?.closest?.('[data-choice-remove]');
    if (!add && !remove) return;
    updateSelectedCommandFromDetail({ rerenderCommands: false, updatePreview: false });
    const current = scene();
    const command = ensureSelectedCommand(current);
    if (!command || command.type !== 'choice') return;
    if (add && command.choices.length < 4) command.choices.push({ label: `選択肢${command.choices.length + 1}`, targetSceneId: '' });
    if (remove) command.choices.splice(Number(remove.dataset.choiceRemove), 1);
    if (!command.choices.length) command.choices.push({ label: '進む', targetSceneId: '' });
    command.defaultIndex = clamp(command.defaultIndex, 0, command.choices.length - 1, 0);
    renderCommands(current);
    renderCommandDetail(current);
    void renderPreview();
  });

  form.addEventListener('input', () => {
    root.querySelector('[data-role="scene-title"]').textContent = safeId(form.elements.id.value, scene()?.id || 'scene');
  });

  root.querySelector('[data-action="reload"]').addEventListener('click', load);
  root.querySelector('[data-action="save"]').addEventListener('click', save);
  root.querySelector('[data-action="add-scene"]').addEventListener('click', () => {
    commitCurrentUiToDoc();
    const id = safeId(`scene_${doc.scenes.length + 1}`, 'scene');
    doc.scenes.push({ id, commands: [defaultCommand('message', assets)], nextSceneId: '' });
    selectedId = id;
    selectedCommandIndex = 0;
    render();
  });
  root.querySelector('[data-action="delete-scene"]').addEventListener('click', () => {
    if (doc.scenes.length <= 1) return;
    doc.scenes = doc.scenes.filter((item) => item.id !== selectedId);
    selectedId = doc.scenes[0]?.id || 'opening';
    doc.startScene = selectedId;
    selectedCommandIndex = 0;
    render();
  });

  registerCapability('visual-novel-editor', { reload: load, save });
  void load();
  return { deactivate() {} };
}
