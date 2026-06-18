const SCENE_FILE = 'assets/pce-vn-scenes.json';
const PCE_SCREEN_WIDTH = 256;
const PCE_SCREEN_HEIGHT = 224;
// ゲーム側 runtime のメッセージ領域に一致させる。
// 256x224 画面、メッセージ窓 208x64px を下部中央 (x=24,y=160) に配置。
// 1 文字 12×12px を 12px 横ピッチで 17 文字、16px 行ピッチで 4 行。
const MESSAGE_AREA = { x: 24, y: 160, cols: 17, rows: 4, cellW: 12, cellH: 16 };
const DEFAULT_CHARACTER_Y = 24;
const COLUMN_LAYOUT_KEY = 'pce-vn-editor.columnLayout.v1';
const DEFAULT_COLUMN_LAYOUT = { left: 320, right: 440 };
const MIN_LEFT_WIDTH = 240;
const MAX_LEFT_WIDTH = 520;
const MIN_CENTER_WIDTH = 340;
const MIN_RIGHT_WIDTH = 320;
const MAX_RIGHT_WIDTH = 720;
const ADPCM_END_PAD_SECONDS = 2 / 60;

// 入力チェックコマンドのボタン定義（runtime の PAD_* と同順・OR 条件用）。
const INPUT_BUTTONS = [
  { key: 'up', label: '↑' },
  { key: 'down', label: '↓' },
  { key: 'left', label: '←' },
  { key: 'right', label: '→' },
  { key: 'select', label: 'SEL' },
  { key: 'run', label: 'RUN' },
  { key: 'i', label: 'I' },
  { key: 'ii', label: 'II' },
];
const INPUT_BUTTON_KEYS = INPUT_BUTTONS.map((button) => button.key);

// PCE 表示可能色（3bit/ch）へスナップした "#rrggbb" を返す。空入力は '' のまま。
function snapHexToPce(value) {
  if (value == null) return '';
  let s = String(value).trim();
  if (!s) return '';
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '';
  const snap = (hex) => {
    const n = Math.max(0, Math.min(255, parseInt(hex, 16) || 0));
    const q = Math.max(0, Math.min(7, Math.round(n / 255 * 7)));
    return Math.round(q * 255 / 7);
  };
  const r = snap(s.slice(0, 2));
  const g = snap(s.slice(2, 4));
  const b = snap(s.slice(4, 6));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

const COMMAND_DEFINITIONS = [
  { type: 'background', label: 'BG', category: '表示', description: '背景画像と切替' },
  { type: 'sprite', label: 'Sprite', category: '表示', description: '立ち絵の表示/非表示' },
  { type: 'message', label: 'Message', category: 'テキスト', description: '話者、本文、送り設定' },
  { type: 'variable', label: 'Variable', category: '変数', description: '定義、代入、加算、減算、ランダム' },
  { type: 'choice', label: 'Choice', category: '分岐', description: '選択肢と変数への値設定' },
  { type: 'if', label: 'IF', category: '分岐', description: '変数条件でラベルへ分岐' },
  { type: 'switch', label: 'Switch', category: '分岐', description: '変数値で複数ラベルへ分岐' },
  { type: 'label', label: 'Label', category: '分岐', description: 'GOTO/分岐の移動先' },
  { type: 'goto', label: 'GOTO', category: '分岐', description: '指定ラベルへ移動' },
  { type: 'inputcheck', label: 'Input', category: '分岐', description: '入力でラベルへGOTO' },
  { type: 'jump', label: 'Jump', category: '分岐', description: '別シーンへ移動' },
  { type: 'preload', label: 'Preload', category: '分岐', description: '次シーンを先読み' },
  { type: 'wait', label: 'Wait', category: '制御', description: '指定フレーム待機' },
  { type: 'audio', label: 'Audio', category: '音声', description: 'CD-DA/ADPCM/PSG再生停止' },
  { type: 'effect', label: 'Effect', category: '演出', description: 'フェード/フラッシュ/揺れ' },
  { type: 'spritetext', label: 'SpriteText', category: '演出', description: '短い文字をスプライトで重ねる' },
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

function signedValue(value, fallback = 0) {
  return clamp(value, -32768, 32767, fallback);
}

function variableName(value, fallback = 'var_1') {
  return safeId(value, fallback).slice(0, 32);
}

function labelName(value, fallback = '') {
  return safeId(value, fallback).slice(0, 32);
}

function normalizeVariableOperation(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'define' || raw === 'def') return 'define';
  if (raw === 'add' || raw === 'inc' || raw === '+') return 'add';
  if (raw === 'sub' || raw === 'subtract' || raw === 'dec' || raw === '-') return 'sub';
  if (raw === 'random' || raw === 'rand') return 'random';
  return 'set';
}

function normalizeCompareOperator(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === '!=' || raw === '<>' || raw === 'ne') return 'ne';
  if (raw === '<' || raw === 'lt') return 'lt';
  if (raw === '<=' || raw === 'lte' || raw === 'le') return 'lte';
  if (raw === '>' || raw === 'gt') return 'gt';
  if (raw === '>=' || raw === 'gte' || raw === 'ge') return 'gte';
  return 'eq';
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

// ゲーム runtime の messageDisplayText と同じ表示文字列を作る。
function messageFullText(command = {}) {
  const speaker = String(command.speaker || '').trim();
  const text = String(command.text || '').trim();
  return speaker ? `${speaker}「${text}」` : text;
}

// グリフフォントは 16bit エスケープ符号化で 254 種を大きく超えられ（実用上限は
// VRAM 依存で約 1000 種）、超過時はビルドが VRAM オーバーフローのエラーで検知する
// ため、エディタ側の文字種カウント/フォント上限インジケータは廃止した。

// pce-vn-manager.js の scene pack バイナリ仕様を反映した定数。runtime は scene 入場時に
// 1 シーンを VN_SCENE_PACK_LIMIT バイトの active cache へ読み込むため、これを超えると
// ビルドが失敗する（シーン分割が必要）。下の見積りはエディタ上の早期警告で、最終的な
// 判定はビルド時の buildScenePack が行う。
const VN_SCENE_PACK_LIMIT = 4096;
const VN_PACK_HEADER_SIZE = 20;
const VN_PACK_COMMAND_SIZE = 19;
// 13 bytes: glyphOffset(2)+glyphCount(1)+voice(2)+speed(1)+advance(1)+autoWait(1)
//           +mouthAnim(2)+mouthSlot(1)+textColor(2). pce-vn-manager.js と一致させる。
const VN_PACK_MESSAGE_SIZE = 13;
const VN_PACK_CHOICE_SIZE = 6;
const VN_PACK_OPTION_SIZE = 7;
const VN_PACK_SWITCH_SIZE = 5;
const VN_PACK_SWITCH_CASE_SIZE = 4;
const VN_MAX_CHOICE_OPTIONS = 4;
const VN_MAX_SWITCH_CASES = 16;

// 1 シーンの scene pack バイト数を見積もる（buildScenePack と同じ加算規則）。
function estimateScenePackBytes(scene = {}) {
  const commands = Array.isArray(scene.commands) ? scene.commands : [];
  let messageCount = 0;
  let choiceCount = 0;
  let switchCount = 0;
  let dataBytes = 0;
  commands.forEach((command) => {
    if (command?.type === 'message') {
      messageCount += 1;
      // 表示文字列の各文字 (\r 除く、\n も 1 byte) + 終端マーカー 1 byte。
      const glyphs = [...messageFullText(command)].filter((ch) => ch !== '\r').length;
      dataBytes += glyphs + 1;
    } else if (command?.type === 'choice') {
      choiceCount += 1;
      const options = (command.choices || []).slice(0, VN_MAX_CHOICE_OPTIONS);
      options.forEach((option) => {
        dataBytes += String(option?.label || '').length + 1;
      });
      dataBytes += options.length * VN_PACK_OPTION_SIZE;
    } else if (command?.type === 'switch') {
      switchCount += 1;
      const cases = (command.cases || []).slice(0, VN_MAX_SWITCH_CASES);
      dataBytes += cases.length * VN_PACK_SWITCH_CASE_SIZE;
    }
  });
  return VN_PACK_HEADER_SIZE
    + (commands.length * VN_PACK_COMMAND_SIZE)
    + (messageCount * VN_PACK_MESSAGE_SIZE)
    + (choiceCount * VN_PACK_CHOICE_SIZE)
    + (switchCount * VN_PACK_SWITCH_SIZE)
    + dataBytes;
}

// runtime と同じ折り返し規則: \n で強制改行、18 文字で自動折り返し、最大 4 行。
function layoutMessageLines(text) {
  const lines = [''];
  let col = 0;
  for (const ch of String(text || '')) {
    if (ch === '\r') continue;
    if (lines.length > MESSAGE_AREA.rows) break;
    if (ch === '\n') {
      if (lines.length >= MESSAGE_AREA.rows) break;
      lines.push('');
      col = 0;
      continue;
    }
    lines[lines.length - 1] += ch;
    col += 1;
    if (col >= MESSAGE_AREA.cols) {
      if (lines.length >= MESSAGE_AREA.rows) break;
      lines.push('');
      col = 0;
    }
  }
  return lines.slice(0, MESSAGE_AREA.rows);
}

function assetPixelSize(asset = {}) {
  const options = asset?.options || {};
  const width = Number(options.width);
  const height = Number(options.height);
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
  };
}

function previewPathForAsset(asset = {}) {
  const generated = asset?.data?.generated || {};
  if (asset?.type === 'cdda-track' && generated.outputFile) return generated.outputFile;
  return asset?.source || '';
}

function audioDurationSeconds(asset = {}) {
  const generated = asset?.data?.generated || {};
  if (asset?.type === 'adpcm') {
    const byteLength = Number(generated.byteLength) || 0;
    const sampleRate = Number(asset?.options?.sampleRate || generated.sampleRate) || 16000;
    if (byteLength > 0 && sampleRate > 0) return (byteLength * 2 / sampleRate) + ADPCM_END_PAD_SECONDS;
  }
  const duration = Number(generated.durationSeconds);
  if (asset?.type === 'adpcm' && Number.isFinite(duration) && duration > 0) {
    return duration + ADPCM_END_PAD_SECONDS;
  }
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

// スプライト asset の options から、プレビュー描画に必要な最小メタ情報を取り出す。
// 別ウィンドウ preview の data.meta にもこの形で埋め込む。
function spriteAnimationMeta(asset = {}) {
  const options = asset?.options || {};
  return {
    cellWidth: Number(options.cellWidth) || 0,
    cellHeight: Number(options.cellHeight) || 0,
    animations: Array.isArray(options.animations) ? options.animations : [],
  };
}

// スプライトシート画像から、指定アニメーションの各フレーム切り出し矩形を計算する。
// runtime の show_character_sprite_frame と同じ firstCell / frameStrideCells 規則で、
// 1 フレームはシート上の連続した frameW×frameH 矩形になる（行ストライド = シート幅）。
// アニメ情報が無い asset では null を返し、呼び出し側はシート全体表示にフォールバックする。
function spriteFrameGeometry(source, animationId) {
  const src = source || {};
  const sheetW = Number(src.width) || 0;
  const sheetH = Number(src.height) || 0;
  const cellW = Number(src.cellWidth) || 0;
  const cellH = Number(src.cellHeight) || 0;
  const animations = Array.isArray(src.animations) ? src.animations : [];
  if (!sheetW || !sheetH || !cellW || !cellH || !animations.length) return null;
  const wanted = animationId || 'default';
  const anim = animations.find((a) => a && (a.id || 'default') === wanted)
    || animations.find((a) => a && (a.id || 'default') === 'default')
    || animations[0];
  if (!anim) return null;
  const cols = Math.max(1, Math.floor(sheetW / cellW));
  const frameW = Math.min(sheetW, Math.max(cellW, Number(anim.frameWidth) || sheetW));
  const frameH = Math.min(sheetH, Math.max(cellH, Number(anim.frameHeight) || sheetH));
  const frameCount = Math.max(1, Math.min(64, Number(anim.frameCount) || 1));
  const stride = Math.max(1, Number(anim.frameStrideCells) || 1);
  const firstCell = Math.max(0, Number(anim.firstCell) || 0);
  const frameDelay = Math.max(1, Math.min(60, Number(anim.frameDelay) || 8));
  const loop = anim.loop !== false;
  const frames = [];
  for (let f = 0; f < frameCount; f += 1) {
    const cell = firstCell + (f * stride);
    const cx = (cell % cols) * cellW;
    const cy = Math.floor(cell / cols) * cellH;
    if (f > 0 && (cy + frameH) > sheetH) break;
    frames.push({ x: cx, y: cy });
  }
  if (!frames.length) frames.push({ x: 0, y: 0 });
  return { sheetW, sheetH, frameW, frameH, frames, frameDelay, loop };
}

// 切り出し矩形を背景画像として div に適用し、複数フレームなら requestAnimationFrame で
// runtime と同じ 60fps frameDelay 間隔で巡回させる。DOM から外れたら自動停止する。
function applySpriteFrame(node, url, geo, flipX, flipY) {
  node.style.backgroundImage = 'url("' + url + '")';
  node.style.backgroundRepeat = 'no-repeat';
  node.style.backgroundSize = geo.sheetW + 'px ' + geo.sheetH + 'px';
  node.style.width = geo.frameW + 'px';
  node.style.height = geo.frameH + 'px';
  node.style.imageRendering = 'pixelated';
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  if (sx !== 1 || sy !== 1) {
    node.style.transformOrigin = 'center center';
    node.style.transform = 'scale(' + sx + ',' + sy + ')';
  }
  const setFrame = (i) => {
    node.style.backgroundPosition = '-' + geo.frames[i].x + 'px -' + geo.frames[i].y + 'px';
  };
  setFrame(0);
  if (geo.frames.length <= 1) return;
  const frameMs = geo.frameDelay * (1000 / 60);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let idx = 0;
  let prev = now();
  let acc = 0;
  const step = () => {
    if (!node.isConnected) return;
    const t = now();
    acc += t - prev;
    prev = t;
    while (acc >= frameMs) {
      acc -= frameMs;
      idx += 1;
      if (idx >= geo.frames.length) idx = geo.loop ? 0 : geo.frames.length - 1;
    }
    setFrame(idx);
    if (geo.loop || idx < geo.frames.length - 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function computeVisualState(commands = [], uptoIndex = -1, fullScreenBg = false) {
  const state = { background: null, sprites: {}, spriteTexts: {} };
  const last = Math.min(uptoIndex, commands.length - 1);
  for (let i = 0; i <= last; i += 1) {
    const command = commands[i];
    if (!command) continue;
    if (command.type === 'background') {
      state.background = { assetId: command.assetId, x: command.x, y: command.y };
    } else if (command.type === 'sprite' && !fullScreenBg) {
      if (command.visible === false) {
        delete state.sprites[command.slot];
      } else {
        state.sprites[command.slot] = {
          slot: command.slot,
          assetId: command.assetId,
          x: command.x,
          y: command.y,
          flipX: command.flipX,
          flipY: command.flipY,
          animationId: command.animationId,
        };
      }
    } else if (command.type === 'spritetext' && !fullScreenBg) {
      if (command.visible === false) {
        delete state.spriteTexts[command.slot];
      } else {
        state.spriteTexts[command.slot] = {
          slot: command.slot,
          text: command.text,
          x: command.x,
          y: command.y,
          color: command.color,
        };
      }
    } else if (command.type === 'effect' && command.effect === 'blank') {
      state.background = null;
      state.sprites = {};
      state.spriteTexts = {};
    }
  }
  return state;
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
    return { type: 'background', assetId: first('image'), transition: 'fade', fadeOutFrames: 8, fadeInFrames: 16, x: 0, y: 0 };
  }
  if (type === 'sprite') {
    const assetId = first('sprite');
    return { type: 'sprite', slot: 0, assetId, x: 128, y: DEFAULT_CHARACTER_Y, animationId: 'default', flipX: false, flipY: false, durationFrames: 0, visible: true };
  }
  if (type === 'audio') {
    return { type: 'audio', kind: 'cdda', action: 'play', assetId: first('cdda-track'), channel: 0 };
  }
  if (type === 'inputcheck') {
    return { type: 'inputcheck', buttons: ['i'], mode: 'sync', targetLabel: '' };
  }
  if (type === 'effect') {
    return { type: 'effect', effect: 'shake', frames: 16, intensity: 4, color: '' };
  }
  if (type === 'spritetext') {
    return { type: 'spritetext', slot: 0, text: 'PRESS RUN BUTTON', x: 64, y: 184, color: '#ffffff', blinkFrames: 30, visible: true };
  }
  if (type === 'variable') {
    return { type: 'variable', variableName: 'flag_1', operation: 'set', value: 0, min: 0, max: 9 };
  }
  if (type === 'preload') {
    return { type: 'preload', sceneId: '' };
  }
  if (type === 'choice') {
    return { type: 'choice', variableName: 'choice_1', defaultIndex: 0, choices: [{ label: '進む', value: 0, targetSceneId: '' }] };
  }
  if (type === 'if') {
    return { type: 'if', variableName: 'flag_1', operator: 'eq', value: 1, targetLabel: '', elseLabel: '' };
  }
  if (type === 'switch') {
    return { type: 'switch', variableName: 'choice_1', cases: [{ value: 0, targetLabel: '' }, { value: 1, targetLabel: '' }], defaultLabel: '' };
  }
  if (type === 'label') {
    return { type: 'label', name: 'label_1' };
  }
  if (type === 'goto') {
    return { type: 'goto', targetLabel: '' };
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
    textColor: '',
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
      fullScreenBg: false,
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
      x: clamp(raw.x ?? raw.tileX ?? raw.mapX, 0, 63, 0),
      y: clamp(raw.y ?? raw.tileY ?? raw.mapY, 0, 31, 0),
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
    const kind = raw.kind === 'adpcm' ? 'adpcm' : (raw.kind === 'psg' ? 'psg' : 'cdda');
    const action = raw.action === 'stop' ? 'stop' : 'play';
    const asset = byId(raw.assetId);
    const valid = kind === 'adpcm'
      ? asset?.type === 'adpcm'
      : (kind === 'psg'
        ? (asset?.type === 'psg-song' || asset?.type === 'psg-sfx')
        : asset?.type === 'cdda-track');
    return {
      type: 'audio',
      kind,
      action,
      assetId: action === 'play' && valid ? asset.id : '',
      channel: clamp(raw.channel, 0, 5, 0),
    };
  }
  if (raw.type === 'inputcheck') {
    const mode = raw.mode === 'async' ? 'async' : (raw.mode === 'cancel' ? 'cancel' : 'sync');
    const seen = new Set((Array.isArray(raw.buttons) ? raw.buttons : [])
      .map((b) => String(b || '').trim().toLowerCase())
      .filter((b) => INPUT_BUTTON_KEYS.includes(b)));
    const buttons = INPUT_BUTTON_KEYS.filter((key) => seen.has(key));
    return {
      type: 'inputcheck',
      buttons: mode === 'cancel' ? [] : (buttons.length ? buttons : ['i']),
      mode,
      targetLabel: mode === 'cancel' ? '' : labelName(raw.targetLabel || raw.label || raw.target || '', ''),
    };
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
        return {
          label,
          value: signedValue(item.value ?? item.resultValue ?? choiceIndex, choiceIndex),
          targetSceneId: safeId(item.targetSceneId || item.sceneId || item.nextSceneId || item.target, ''),
        };
      })
      .filter(Boolean)
      .slice(0, 4);
    const normalizedChoices = choices.length ? choices : [{ label: '進む', value: 0, targetSceneId: '' }];
    return {
      type: 'choice',
      variableName: String(raw.variableName || raw.variable || raw.resultVariable || '').trim()
        ? variableName(raw.variableName || raw.variable || raw.resultVariable)
        : '',
      choices: normalizedChoices,
      defaultIndex: clamp(raw.defaultIndex ?? raw.initialIndex, 0, normalizedChoices.length - 1, 0),
    };
  }
  if (raw.type === 'variable' || raw.type === 'var') {
    let min = signedValue(raw.min ?? raw.minimum ?? 0, 0);
    let max = signedValue(raw.max ?? raw.maximum ?? 9, 9);
    if (min > max) [min, max] = [max, min];
    return {
      type: 'variable',
      variableName: variableName(raw.variableName || raw.variable || raw.name),
      operation: normalizeVariableOperation(raw.operation || raw.op || raw.action || (raw.define ? 'define' : 'set')),
      value: signedValue(raw.value ?? raw.initialValue ?? raw.amount, 0),
      min,
      max,
    };
  }
  if (raw.type === 'if') {
    return {
      type: 'if',
      variableName: variableName(raw.variableName || raw.variable || raw.name),
      operator: normalizeCompareOperator(raw.operator || raw.compare || raw.condition),
      value: signedValue(raw.value ?? raw.compareValue ?? 0, 0),
      targetLabel: labelName(raw.targetLabel || raw.thenLabel || raw.trueLabel || raw.label || raw.target, ''),
      elseLabel: labelName(raw.elseLabel || raw.falseLabel || '', ''),
    };
  }
  if (raw.type === 'switch') {
    const cases = (Array.isArray(raw.cases) ? raw.cases : [])
      .map((entry, caseIndex) => {
        const item = entry && typeof entry === 'object' ? entry : {};
        return {
          value: signedValue(item.value ?? caseIndex, caseIndex),
          targetLabel: labelName(item.targetLabel || item.label || item.target || '', ''),
        };
      })
      .slice(0, 16);
    return {
      type: 'switch',
      variableName: variableName(raw.variableName || raw.variable || raw.name),
      cases: cases.length ? cases : [{ value: 0, targetLabel: '' }],
      defaultLabel: labelName(raw.defaultLabel || raw.elseLabel || raw.default || '', ''),
    };
  }
  if (raw.type === 'label') {
    return { type: 'label', name: labelName(raw.name || raw.label || raw.id, `label_${index + 1}`) };
  }
  if (raw.type === 'goto') {
    return { type: 'goto', targetLabel: labelName(raw.targetLabel || raw.label || raw.target || '', '') };
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
      if (value === 'flash') return 'flash';
      return 'fadeOut';
    })();
    const defaultColor = effect === 'flash' ? '#ffffff' : (effect === 'fadeOut' ? '#000000' : '');
    return {
      type: 'effect',
      effect,
      frames: clamp(raw.frames ?? raw.durationFrames, 0, 255, 16),
      intensity: effect === 'shake' ? clamp(raw.intensity ?? raw.power ?? raw.amplitude, 1, 16, 4) : 0,
      color: snapHexToPce(raw.color) || defaultColor,
    };
  }
  if (raw.type === 'spritetext') {
    return {
      type: 'spritetext',
      slot: clamp(raw.slot, 0, 3, 0),
      text: String(raw.text == null ? '' : raw.text).replace(/\r/g, '').slice(0, 64),
      x: clamp(raw.x, 0, 319, 0),
      y: clamp(raw.y, 0, 223, 0),
      color: snapHexToPce(raw.color) || '#ffffff',
      blinkFrames: clamp(raw.blinkFrames ?? raw.blink, 0, 255, 0),
      visible: raw.visible !== false,
    };
  }
  // 本文は未指定(null/undefined)のときだけ既定文言を補完。空文字はクリア意図として保持。
  const messageText = (raw.text == null ? (index === 0 ? 'メッセージを入力してください。' : '') : String(raw.text)).trim().slice(0, 96);
  return {
    type: 'message',
    speaker: String(raw.speaker || '').trim().slice(0, 16),
    text: messageText,
    textColor: snapHexToPce(raw.textColor),
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
      fullScreenBg: scene?.fullScreenBg === true
        || scene?.fullscreenBg === true
        || scene?.fullScreenBackground === true
        || ['fullscreenbg', 'full-screen-bg', 'fullscreen', 'full'].includes(String(scene?.layout || scene?.displayMode || '').trim().toLowerCase()),
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
      commands: (() => {
        const labels = new Set((scene.commands || [])
          .filter((command) => command.type === 'label' && command.name)
          .map((command) => command.name));
        return (scene.commands || []).map((command) => {
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
        if (command.type === 'goto') {
          return { ...command, targetLabel: command.targetLabel && labels.has(command.targetLabel) ? command.targetLabel : '' };
        }
        if (command.type === 'if') {
          return {
            ...command,
            targetLabel: command.targetLabel && labels.has(command.targetLabel) ? command.targetLabel : '',
            elseLabel: command.elseLabel && labels.has(command.elseLabel) ? command.elseLabel : '',
          };
        }
        if (command.type === 'switch') {
          return {
            ...command,
            cases: (command.cases || []).map((branch) => ({
              ...branch,
              targetLabel: branch.targetLabel && labels.has(branch.targetLabel) ? branch.targetLabel : '',
            })),
            defaultLabel: command.defaultLabel && labels.has(command.defaultLabel) ? command.defaultLabel : '',
          };
        }
        return command;
        });
      })(),
    })),
  };
}

// 別ウィンドウのプレビュー再生エンジン。activatePlugin のスコープを参照しないよう
// toString() でそのまま埋め込むため、window.__PCE_VN_PREVIEW__ だけを入力にする。
function previewRuntime() {
  const data = window.__PCE_VN_PREVIEW__ || { doc: { scenes: [] }, urls: {}, meta: {} };
  const SCREEN_W = (data.screen && data.screen.w) || 256;
  const SCREEN_H = (data.screen && data.screen.h) || 224;
  const MSG = data.message || { x: 24, y: 160, cols: 17, rows: 4, cellW: 12, cellH: 16 };
  const scenesById = {};
  (data.doc.scenes || []).forEach((s) => { scenesById[s.id] = s; });

  const style = document.createElement('style');
  style.textContent = [
    'html,body{margin:0;height:100%;background:#05070a;color:#e8eef5;font-family:system-ui,-apple-system,sans-serif;overflow:hidden;}',
    '#pv-root{position:fixed;inset:0;display:flex;flex-direction:column;}',
    '#pv-stage-wrap{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;}',
    '#pv-stage{position:relative;width:' + SCREEN_W + 'px;height:' + SCREEN_H + 'px;background:#000;transform-origin:center center;overflow:hidden;box-shadow:0 0 0 1px #000,0 10px 36px rgba(0,0,0,.6);}',
    '#pv-stage img{position:absolute;image-rendering:pixelated;transform-origin:top left;}',
    '#pv-msg{position:absolute;left:' + MSG.x + 'px;top:' + MSG.y + 'px;width:' + (MSG.cols * MSG.cellW) + 'px;height:' + (MSG.rows * MSG.cellH) + 'px;display:flex;flex-direction:column;}',
    '.pv-row{height:' + MSG.cellH + 'px;display:flex;}',
    '.pv-cell{width:' + MSG.cellW + 'px;height:' + MSG.cellH + 'px;line-height:' + MSG.cellH + 'px;font-size:11px;text-align:center;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9);overflow:hidden;}',
    '#pv-msg.pv-hidden,#pv-choice.pv-hidden{display:none;}',
    '#pv-effect{position:absolute;inset:0;z-index:20;pointer-events:none;opacity:0;background:#fff;}',
    '#pv-choice{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;gap:6px;min-width:140px;}',
    '#pv-choice button{font:inherit;font-size:12px;padding:6px 14px;border-radius:4px;border:1px solid rgba(120,160,210,.6);background:rgba(8,14,24,.92);color:#e8eef5;cursor:pointer;}',
    '#pv-choice button.pv-active,#pv-choice button:hover{border-color:#8fd0ff;background:rgba(40,80,130,.7);}',
    '#pv-bar{height:34px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#0b1118;border-top:1px solid #1d2733;font-size:11px;color:#9fb0c0;flex:none;}',
    '#pv-bar button{font:inherit;font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid #2a3a4a;background:#13202c;color:#cfe0ee;cursor:pointer;}',
    '#pv-hint{margin-left:auto;color:#6b7a88;}',
    '.pv-shake{animation:pv-shake .4s linear;}',
    '@keyframes pv-shake{0%,100%{transform:none}20%{transform:translateX(-5px)}60%{transform:translateX(5px)}80%{transform:translateX(-3px)}}',
  ].join('\n');
  document.head.appendChild(style);
  document.title = 'VN プレビュー';

  const root = document.createElement('div');
  root.id = 'pv-root';
  root.innerHTML =
    '<div id="pv-stage-wrap"><div id="pv-stage">'
    + '<div id="pv-msg" class="pv-hidden"></div>'
    + '<div id="pv-choice" class="pv-hidden"></div>'
    + '<div id="pv-effect"></div>'
    + '</div></div>'
    + '<div id="pv-bar"><button id="pv-restart">最初から</button><span id="pv-scene"></span>'
    + '<span id="pv-hint">クリック / Enter で進む ・ Esc で閉じる</span></div>';
  document.body.appendChild(root);

  const stage = root.querySelector('#pv-stage');
  const stageWrap = root.querySelector('#pv-stage-wrap');
  const msgBox = root.querySelector('#pv-msg');
  const choiceBox = root.querySelector('#pv-choice');
  const effectLayer = root.querySelector('#pv-effect');
  const sceneLabel = root.querySelector('#pv-scene');

  function fit() {
    const sc = Math.max(1, Math.min(stageWrap.clientWidth / SCREEN_W, stageWrap.clientHeight / SCREEN_H));
    stage.style.transform = 'scale(' + sc + ')';
  }
  window.addEventListener('resize', fit);

  let sceneId = null;
  let scene = null;
  let pc = 0;
  let vars = {};
  let state = { background: null, sprites: {}, spriteTexts: {} };
  let typeTimer = null;
  let waitTimer = null;
  let autoTimer = null;
  let pending = null;
  let choiceState = null;
  const audio = { cdda: null, adpcm: null };
  const blockedAudio = { cdda: false, adpcm: false };

  function s16(value) {
    let v = Number(value) | 0;
    v = ((v + 32768) & 0xffff) - 32768;
    return v;
  }
  function getVar(name) { return vars[name] || 0; }
  function clearTimers() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }
  function updateAudioHint() {
    const blocked = Object.keys(blockedAudio).filter((kind) => blockedAudio[kind]);
    if (blocked.length) {
      root.querySelector('#pv-hint').textContent = '音声開始待ち: クリック / Enter で再試行';
      return;
    }
    root.querySelector('#pv-hint').textContent = 'クリック / Enter で進む ・ Esc で閉じる';
  }
  function tryPlayAudio(kind) {
    const a = audio[kind];
    if (!a) return;
    if (a.ended) return;
    const result = a.play();
    if (result && typeof result.then === 'function') {
      result.then(() => {
        blockedAudio[kind] = false;
        updateAudioHint();
      }).catch(() => {
        if (audio[kind] === a) {
          blockedAudio[kind] = true;
          updateAudioHint();
        }
      });
    }
  }
  function retryAudioPlayback() {
    tryPlayAudio('cdda');
    tryPlayAudio('adpcm');
  }
  function stopAudio(kind) {
    const a = audio[kind];
    if (a) a.pause();
    audio[kind] = null;
    blockedAudio[kind] = false;
    updateAudioHint();
  }
  function playAudio(kind, assetId, loop) {
    if (!assetId || !data.urls[assetId]) return;
    stopAudio(kind);
    const a = new Audio(data.urls[assetId]);
    a.loop = Boolean(loop);
    a.addEventListener('ended', () => {
      if (audio[kind] === a) {
        audio[kind] = null;
        blockedAudio[kind] = false;
        updateAudioHint();
      }
    });
    audio[kind] = a;
    tryPlayAudio(kind);
  }
  function hideMsg() { msgBox.classList.add('pv-hidden'); }
  function hideChoice() { choiceBox.classList.add('pv-hidden'); choiceBox.innerHTML = ''; choiceState = null; }

  function makeImg(layer, kind) {
    const meta = data.meta[layer.assetId] || {};
    if (kind === 'sprite') {
      const geo = spriteFrameGeometry(meta, layer.animationId);
      if (geo) {
        const node = document.createElement('div');
        node.className = 'pv-layer';
        node.style.position = 'absolute';
        node.style.left = (layer.x || 0) + 'px';
        node.style.top = (layer.y || 0) + 'px';
        applySpriteFrame(node, data.urls[layer.assetId], geo, layer.flipX, layer.flipY);
        return node;
      }
    }
    const img = document.createElement('img');
    img.className = 'pv-layer';
    img.src = data.urls[layer.assetId];
    const x = kind === 'background' ? (layer.x || 0) * 8 : (layer.x || 0);
    const y = kind === 'background' ? (layer.y || 0) * 8 : (layer.y || 0);
    img.style.left = x + 'px';
    img.style.top = y + 'px';
    if (meta.width) img.style.width = meta.width + 'px';
    if (meta.height) img.style.height = meta.height + 'px';
    const sx = layer.flipX ? -1 : 1;
    const sy = layer.flipY ? -1 : 1;
    if (sx !== 1 || sy !== 1) {
      const tx = sx === -1 && meta.width ? meta.width : 0;
      const ty = sy === -1 && meta.height ? meta.height : 0;
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sx + ',' + sy + ')';
    }
    return img;
  }

  function renderStage() {
    Array.prototype.slice.call(stage.querySelectorAll('.pv-layer')).forEach((n) => n.remove());
    if (state.background && state.background.assetId && data.urls[state.background.assetId]) {
      stage.insertBefore(makeImg(state.background, 'background'), msgBox);
    }
    Object.keys(state.sprites).map(Number).sort((a, b) => a - b).forEach((slot) => {
      const s = state.sprites[slot];
      if (s && s.assetId && data.urls[s.assetId]) stage.insertBefore(makeImg(s, 'sprite'), msgBox);
    });
    Object.keys(state.spriteTexts || {}).map(Number).sort((a, b) => a - b).forEach((slot) => {
      const st = state.spriteTexts[slot];
      if (!st) return;
      const node = document.createElement('div');
      node.className = 'pv-layer';
      node.style.position = 'absolute';
      node.style.left = (st.x || 0) + 'px';
      node.style.top = (st.y || 0) + 'px';
      node.style.color = st.color || '#ffffff';
      node.style.font = '16px/16px monospace';
      node.style.whiteSpace = 'pre';
      node.textContent = st.text || '';
      stage.insertBefore(node, msgBox);
    });
    sceneLabel.textContent = 'Scene: ' + (scene ? scene.id : '-');
  }

  function labelIndex(name) {
    if (!name || !scene) return -1;
    return (scene.commands || []).findIndex((c) => c.type === 'label' && c.name === name);
  }
  function jumpLabel(name) {
    const i = labelIndex(name);
    pc = i >= 0 ? i : pc + 1;
  }
  function setScene(id) {
    scene = scenesById[id] || null;
    sceneId = id;
    pc = 0;
    if (scene?.fullScreenBg) {
      state.sprites = {};
      state.spriteTexts = {};
      hideMsg();
      hideChoice();
    }
  }

  function applyVar(c) {
    const n = c.variableName;
    if (!n) return;
    if (c.operation === 'define' || c.operation === 'set') vars[n] = s16(c.value);
    else if (c.operation === 'add') vars[n] = s16(getVar(n) + Number(c.value || 0));
    else if (c.operation === 'sub') vars[n] = s16(getVar(n) - Number(c.value || 0));
    else if (c.operation === 'random') {
      const lo = Math.min(c.min, c.max);
      const hi = Math.max(c.min, c.max);
      vars[n] = s16(lo + Math.floor(Math.random() * (hi - lo + 1)));
    }
  }
  function compare(a, op, b) {
    a = a | 0; b = b | 0;
    if (op === 'ne') return a !== b;
    if (op === 'lt') return a < b;
    if (op === 'lte') return a <= b;
    if (op === 'gt') return a > b;
    if (op === 'gte') return a >= b;
    return a === b;
  }
  function handleAudio(c) {
    const kind = c.kind === 'adpcm' ? 'adpcm' : 'cdda';
    if (c.action === 'stop') { stopAudio(kind); return; }
    playAudio(kind, c.assetId, kind === 'cdda');
  }
  function applyEffect(c) {
    const frames = Math.max(0, Number(c.frames || 0));
    const seconds = Math.max(0.01, frames / 60);
    const color = c.color || (c.effect === 'flash' ? '#ffffff' : '#000000');
    if (c.effect === 'blank') {
      state.background = null;
      state.sprites = {};
      state.spriteTexts = {};
      effectLayer.style.opacity = '0';
      renderStage();
    }
    else if (c.effect === 'flash') {
      effectLayer.style.transition = 'none';
      effectLayer.style.background = color;
      effectLayer.style.opacity = '1';
      void effectLayer.offsetWidth;
      effectLayer.style.transition = `opacity ${seconds}s linear`;
      effectLayer.style.opacity = '0';
    }
    else if (c.effect === 'fadeOut') {
      effectLayer.style.transition = `opacity ${seconds}s linear`;
      effectLayer.style.background = color;
      effectLayer.style.opacity = '1';
    }
    else if (c.effect === 'fadeIn') {
      stage.style.transition = `opacity ${seconds}s linear`;
      stage.style.opacity = '1';
      effectLayer.style.transition = `opacity ${seconds}s linear`;
      effectLayer.style.opacity = '0';
    }
    else if (c.effect === 'shake') { stage.classList.remove('pv-shake'); void stage.offsetWidth; stage.classList.add('pv-shake'); }
  }

  // runtime と同じ折り返し規則（\n 強制改行・18 文字折り返し・最大 4 行）
  function layoutLines(text) {
    const lines = [''];
    let col = 0;
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '\r') continue;
      if (lines.length > MSG.rows) break;
      if (ch === '\n') {
        if (lines.length >= MSG.rows) break;
        lines.push('');
        col = 0;
        continue;
      }
      lines[lines.length - 1] += ch;
      col += 1;
      if (col >= MSG.cols) {
        if (lines.length >= MSG.rows) break;
        lines.push('');
        col = 0;
      }
    }
    return lines.slice(0, MSG.rows);
  }
  function paintMsg(text) {
    const lines = layoutLines(text);
    msgBox.innerHTML = '';
    for (let r = 0; r < MSG.rows; r += 1) {
      const row = document.createElement('div');
      row.className = 'pv-row';
      const line = lines[r] || '';
      for (let c = 0; c < line.length; c += 1) {
        const cell = document.createElement('span');
        cell.className = 'pv-cell';
        cell.textContent = line[c];
        row.appendChild(cell);
      }
      msgBox.appendChild(row);
    }
  }

  function messageText(c) {
    const speaker = String(c.speaker || '').trim();
    const text = String(c.text || '').trim();
    return speaker ? speaker + '「' + text + '」' : text;
  }

  function showEnd() {
    hideChoice();
    msgBox.classList.remove('pv-hidden');
    paintMsg('― END ―');
    pending = null;
  }

  function showMessage(c) {
    hideChoice();
    msgBox.classList.remove('pv-hidden');
    const full = messageText(c);
    let shown = 0;
    let done = false;
    paintMsg('');
    if (c.voiceAssetId) playAudio('adpcm', c.voiceAssetId, false);
    function next() { clearTimers(); pending = null; run(); }
    function complete() {
      done = true;
      paintMsg(full);
      if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
      if (c.advanceMode === 'auto') autoTimer = setTimeout(next, Math.max(0, c.autoWaitFrames || 0) * 1000 / 60);
    }
    pending = function () { if (!done) complete(); else { if (c.voiceAssetId) stopAudio('adpcm'); next(); } };
    const voiceMeta = c.voiceAssetId ? (data.meta[c.voiceAssetId] || {}) : {};
    const voiceSeconds = Number(voiceMeta.durationSeconds) || 0;
    const voiceFrames = voiceSeconds > 0 && !voiceMeta.loop ? Math.max(1, Math.ceil(voiceSeconds * 60)) : 0;
    const voiceSpeed = voiceFrames && full.length ? Math.max(1, Math.ceil(voiceFrames / full.length)) * 1000 / 60 : 0;
    const speed = voiceSpeed || (Math.max(0, c.textSpeedFrames || 0) * 1000 / 60);
    if (speed <= 0 || !full) complete();
    else {
      typeTimer = setInterval(() => {
        shown += 1;
        paintMsg(full.slice(0, shown));
        if (shown >= full.length) complete();
      }, speed);
    }
  }

  function showChoice(c) {
    hideMsg();
    pending = null;
    choiceBox.classList.remove('pv-hidden');
    choiceBox.innerHTML = '';
    const choices = c.choices || [];
    let sel = Math.min(Math.max(0, c.defaultIndex || 0), Math.max(0, choices.length - 1));
    const btns = choices.map((ch, idx) => {
      const b = document.createElement('button');
      b.textContent = ch.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); pick(idx); });
      choiceBox.appendChild(b);
      return b;
    });
    function hl() { btns.forEach((b, i) => b.classList.toggle('pv-active', i === sel)); }
    hl();
    choiceState = {
      move(d) { if (!choices.length) return; sel = (sel + d + choices.length) % choices.length; hl(); },
      confirm() { pick(sel); },
    };
    function pick(idx) {
      const ch = choices[idx] || choices[0];
      choiceState = null;
      hideChoice();
      if (!ch) { pc += 1; run(); return; }
      if (c.variableName) vars[c.variableName] = s16(ch.value);
      pc += 1;
      if (ch.targetSceneId && scenesById[ch.targetSceneId]) setScene(ch.targetSceneId);
      run();
    }
  }

  function run() {
    let guard = 0;
    while (true) {
      guard += 1;
      if (guard > 20000) { showEnd(); return; }
      if (!scene) { showEnd(); return; }
      if (pc >= scene.commands.length) {
        if (scene.nextSceneId && scenesById[scene.nextSceneId]) { setScene(scene.nextSceneId); continue; }
        showEnd();
        return;
      }
      const c = scene.commands[pc];
      const t = c.type;
      if (t === 'background') { state.background = { assetId: c.assetId, x: c.x, y: c.y }; renderStage(); pc += 1; continue; }
      if (t === 'sprite') {
        if (scene.fullScreenBg) { pc += 1; continue; }
        if (c.visible === false) delete state.sprites[c.slot];
        else state.sprites[c.slot] = { slot: c.slot, assetId: c.assetId, x: c.x, y: c.y, flipX: c.flipX, flipY: c.flipY, animationId: c.animationId };
        renderStage();
        pc += 1;
        continue;
      }
      if (t === 'spritetext') {
        if (scene.fullScreenBg) { pc += 1; continue; }
        if (c.visible === false) delete state.spriteTexts[c.slot];
        else state.spriteTexts[c.slot] = { slot: c.slot, text: c.text, x: c.x, y: c.y, color: c.color };
        renderStage();
        pc += 1;
        continue;
      }
      if (t === 'audio') { handleAudio(c); pc += 1; continue; }
      if (t === 'variable') { applyVar(c); pc += 1; continue; }
      if (t === 'effect') { applyEffect(c); pc += 1; continue; }
      if (t === 'preload' || t === 'label') { pc += 1; continue; }
      if (t === 'goto') { jumpLabel(c.targetLabel); continue; }
      if (t === 'if') {
        const ok = compare(getVar(c.variableName), c.operator, c.value);
        const lbl = ok ? c.targetLabel : c.elseLabel;
        if (lbl) { jumpLabel(lbl); continue; }
        pc += 1;
        continue;
      }
      if (t === 'switch') {
        const v = getVar(c.variableName);
        const hit = (c.cases || []).find((b) => b.value === v);
        const lbl = hit ? hit.targetLabel : c.defaultLabel;
        if (lbl) { jumpLabel(lbl); continue; }
        pc += 1;
        continue;
      }
      if (t === 'jump') {
        if (c.sceneId && scenesById[c.sceneId]) { setScene(c.sceneId); continue; }
        pc += 1;
        continue;
      }
      if (t === 'wait') { pc += 1; waitTimer = setTimeout(() => { waitTimer = null; run(); }, Math.max(0, c.frames || 0) * 1000 / 60); return; }
      if (t === 'message') { pc += 1; if (scene.fullScreenBg) continue; showMessage(c); return; }
      if (t === 'choice') { if (scene.fullScreenBg) { pc += 1; continue; } showChoice(c); return; }
      pc += 1;
    }
  }

  function start() {
    clearTimers();
    stopAudio('cdda');
    stopAudio('adpcm');
    stage.style.opacity = '1';
    effectLayer.style.opacity = '0';
    sceneId = scenesById[data.startScene] ? data.startScene : (data.doc.startScene || (data.doc.scenes[0] && data.doc.scenes[0].id));
    scene = scenesById[sceneId] || null;
    pc = 0;
    vars = {};
    state = { background: null, sprites: {}, spriteTexts: {} };
    pending = null;
    choiceState = null;
    renderStage();
    hideMsg();
    hideChoice();
    run();
  }

  document.addEventListener('click', (e) => {
    retryAudioPlayback();
    if (e.target.closest('#pv-bar')) return;
    if (e.target.closest('#pv-choice')) return;
    if (choiceState) return;
    if (typeof pending === 'function') pending();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { window.close(); return; }
    if (e.key === 'Enter' || e.key === ' ') retryAudioPlayback();
    if (choiceState) {
      if (e.key === 'ArrowUp') { e.preventDefault(); choiceState.move(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); choiceState.move(1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choiceState.confirm(); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (typeof pending === 'function') pending(); }
  });
  root.querySelector('#pv-restart').addEventListener('click', (e) => { e.stopPropagation(); start(); });

  fit();
  start();
}

function buildPreviewHtml(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8" /><title>VN プレビュー</title></head><body>'
    + '<scr' + 'ipt>window.__PCE_VN_PREVIEW__=' + json + ';</scr' + 'ipt>'
    + '<scr' + 'ipt>' + spriteFrameGeometry.toString() + '\n' + applySpriteFrame.toString() + '</scr' + 'ipt>'
    + '<scr' + 'ipt>(' + previewRuntime.toString() + ')();</scr' + 'ipt>'
    + '</body></html>';
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
            <label class="pce-vn-scene-toggle">
              <input type="checkbox" data-role="scene-fullscreen-bg" />
              <span>Full BG</span>
            </label>
            <button class="btn-sm" type="button" data-action="preview" title="シーンをプレビュー再生">▶ プレビュー</button>
            <button class="icon-btn danger" type="button" data-action="delete-scene" title="シーン削除" aria-label="シーン削除">×</button>
            <button class="btn-primary" type="button" data-action="save">保存</button>
          </div>
        </div>
        <div class="pce-vn-scene-budget" data-role="scene-budget" data-level="ok">
          <div class="pce-vn-scene-budget-head">
            <span data-role="scene-budget-label">Scene メモリ</span>
            <span data-role="scene-budget-value"></span>
          </div>
          <div class="pce-vn-scene-budget-bar"><span data-role="scene-budget-fill"></span></div>
          <div class="pce-vn-scene-budget-note" data-role="scene-budget-note" style="display:none"></div>
        </div>
        <div class="pce-vn-commands" data-role="commands"></div>
        <div class="form-error" data-role="error"></div>
      </section>
      <div class="pce-vn-column-resizer" data-column-resizer="right" role="separator" aria-orientation="vertical" aria-label="右列幅"></div>
      <aside class="pce-vn-preview">
        <div class="pce-vn-command-preview" data-role="command-preview"></div>
        <form class="pce-vn-detail-form" data-role="command-detail"></form>
      </aside>
    </div>
  `;

  const shell = root.querySelector('.pce-vn-shell');
  const sceneList = root.querySelector('[data-role="scene-list"]');
  const commandsEl = root.querySelector('[data-role="commands"]');
  const detailForm = root.querySelector('[data-role="command-detail"]');
  const commandPreviewEl = root.querySelector('[data-role="command-preview"]');
  const commandSearchInput = root.querySelector('[data-role="command-search"]');
  const commandPaletteEl = root.querySelector('[data-role="command-palette"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const sceneBudgetEl = root.querySelector('[data-role="scene-budget"]');
  const sceneFullScreenBgInput = root.querySelector('[data-role="scene-fullscreen-bg"]');
  let assets = [];
  let doc = defaultDoc();
  let selectedId = 'opening';
  let selectedCommandIndex = 0;
  let commandSearch = '';
  let columnLayout = loadColumnLayout();
  let pointerDrag = null;
  let suppressCommandClick = false;
  let previewToken = 0;
  let commandClipboard = null;
  let messagePreviewTimer = null;
  let previewAudioEl = null;
  const assetDataUrlCache = new Map();
  const assetApi = api.assets || {};

  function stopMessagePreview() {
    if (messagePreviewTimer) { clearInterval(messagePreviewTimer); messagePreviewTimer = null; }
    if (previewAudioEl) { try { previewAudioEl.pause(); } catch (_) {} previewAudioEl = null; }
  }

  const listPceAssets = (options = {}) => assetApi.listPceAssets
    ? assetApi.listPceAssets(options)
    : api.electronAPI.listAssets();
  const previewPceAssetSource = (relativePath) => assetApi.previewPceAssetSource
    ? assetApi.previewPceAssetSource(relativePath)
    : api.electronAPI.previewAssetSource(relativePath);

  const byType = (types) => assets.filter((asset) => types.includes(asset.type));
  const scene = () => doc.scenes.find((item) => item.id === selectedId) || doc.scenes[0] || null;
  const assetById = (id) => assets.find((asset) => asset.id === id) || null;

  async function resolveAssetDataUrl(asset) {
    const previewPath = previewPathForAsset(asset);
    if (!asset?.id || !previewPath) return '';
    if (assetDataUrlCache.has(asset.id)) return assetDataUrlCache.get(asset.id);
    const result = await previewPceAssetSource(previewPath);
    const url = result?.dataUrl || '';
    assetDataUrlCache.set(asset.id, url);
    return url;
  }

  function makeStageImg(layer, kind, url, active) {
    if (kind === 'sprite') {
      const asset = assetById(layer.assetId);
      const geo = asset && spriteFrameGeometry({ ...assetPixelSize(asset), ...spriteAnimationMeta(asset) }, layer.animationId);
      if (geo) {
        const node = document.createElement('div');
        node.className = 'pce-vn-stage-sprite';
        node.style.position = 'absolute';
        node.style.left = `${layer.x || 0}px`;
        node.style.top = `${layer.y || 0}px`;
        applySpriteFrame(node, url, geo, layer.flipX, layer.flipY);
        if (active) node.classList.add('is-active');
        return node;
      }
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = assetById(layer.assetId)?.name || layer.assetId || '';
    const size = assetPixelSize(assetById(layer.assetId));
    const x = kind === 'background' ? (layer.x || 0) * 8 : (layer.x || 0);
    const y = kind === 'background' ? (layer.y || 0) * 8 : (layer.y || 0);
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
    if (size.width) img.style.width = `${size.width}px`;
    if (size.height) img.style.height = `${size.height}px`;
    const sx = layer.flipX ? -1 : 1;
    const sy = layer.flipY ? -1 : 1;
    if (sx !== 1 || sy !== 1) {
      const tx = sx === -1 && size.width ? size.width : 0;
      const ty = sy === -1 && size.height ? size.height : 0;
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
    }
    if (active) img.classList.add('is-active');
    return img;
  }

  function buildStageNode(state, urls, command) {
    const block = document.createElement('div');
    block.className = 'pce-vn-stage-block';
    const head = document.createElement('div');
    head.className = 'pce-vn-stage-head';
    const title = document.createElement('strong');
    title.textContent = previewTitle(command);
    const caption = document.createElement('span');
    if (command.type === 'background') caption.textContent = `tile ${command.x},${command.y} (px ${command.x * 8},${command.y * 8})`;
    else caption.textContent = `slot ${command.slot} @ ${command.x},${command.y}`;
    head.append(title, caption);
    const wrap = document.createElement('div');
    wrap.className = 'pce-vn-stage-wrap';
    const stage = document.createElement('div');
    stage.className = 'pce-vn-stage';
    appendStageLayers(stage, state, urls, command);
    wrap.appendChild(stage);
    block.append(head, wrap);
    return block;
  }

  function appendStageLayers(stage, state, urls, command) {
    if (state.background?.assetId && urls[state.background.assetId]) {
      stage.appendChild(makeStageImg(state.background, 'background', urls[state.background.assetId], command?.type === 'background'));
    }
    Object.values(state.sprites)
      .sort((a, b) => a.slot - b.slot)
      .forEach((s) => {
        if (s.assetId && urls[s.assetId]) {
          stage.appendChild(makeStageImg(s, 'sprite', urls[s.assetId], command?.type === 'sprite' && s.slot === command.slot));
        }
      });
    Object.values(state.spriteTexts || {})
      .sort((a, b) => a.slot - b.slot)
      .forEach((st) => {
        // Approximate the hardware-sprite overlay with positioned text. The real
        // glyphs use the generated sprite font; this is for placement feedback.
        const node = document.createElement('div');
        node.className = 'pce-vn-stage-spritetext';
        node.style.position = 'absolute';
        node.style.left = `${st.x || 0}px`;
        node.style.top = `${st.y || 0}px`;
        node.style.color = st.color || '#ffffff';
        node.style.font = '16px/16px monospace';
        node.style.whiteSpace = 'pre';
        node.style.letterSpacing = '0';
        node.textContent = st.text || '';
        if (command?.type === 'spritetext' && st.slot === command.slot) node.classList.add('is-active');
        stage.appendChild(node);
      });
  }

  function buildMessageStageNode(state, urls, command) {
    const block = document.createElement('div');
    block.className = 'pce-vn-stage-block';
    const head = document.createElement('div');
    head.className = 'pce-vn-stage-head';
    const title = document.createElement('strong');
    title.textContent = previewTitle(command);
    const controls = document.createElement('div');
    controls.className = 'pce-vn-stage-controls';
    const info = document.createElement('span');
    info.textContent = command.voiceAssetId
      ? `ADPCM同期 ・ ${command.voiceAssetId}`
      : `speed ${command.textSpeedFrames}f/字`;
    const play = document.createElement('button');
    play.className = 'btn-sm';
    play.type = 'button';
    play.dataset.role = 'message-play';
    play.textContent = '▶ 再生';
    controls.append(info, play);
    head.append(title, controls);
    const wrap = document.createElement('div');
    wrap.className = 'pce-vn-stage-wrap';
    const stage = document.createElement('div');
    stage.className = 'pce-vn-stage';
    appendStageLayers(stage, state, urls, command);
    const overlay = document.createElement('div');
    overlay.className = 'pce-vn-stage-message';
    overlay.dataset.role = 'message-overlay';
    overlay.style.left = `${MESSAGE_AREA.x}px`;
    overlay.style.top = `${MESSAGE_AREA.y}px`;
    overlay.style.width = `${MESSAGE_AREA.cols * MESSAGE_AREA.cellW}px`;
    overlay.style.height = `${MESSAGE_AREA.rows * MESSAGE_AREA.cellH}px`;
    if (command.textColor) overlay.style.color = command.textColor;
    stage.appendChild(overlay);
    wrap.appendChild(stage);
    block.append(head, wrap);
    return block;
  }

  function paintMessageOverlay(overlay, text) {
    const lines = layoutMessageLines(text);
    overlay.innerHTML = '';
    for (let r = 0; r < MESSAGE_AREA.rows; r += 1) {
      const row = document.createElement('div');
      row.className = 'pce-vn-msg-row';
      const line = lines[r] || '';
      for (let c = 0; c < line.length; c += 1) {
        const cell = document.createElement('span');
        cell.className = 'pce-vn-msg-cell';
        cell.textContent = line[c];
        row.appendChild(cell);
      }
      overlay.appendChild(row);
    }
  }

  function startMessagePreview(node, command, token) {
    const overlay = node.querySelector('[data-role="message-overlay"]');
    const playBtn = node.querySelector('[data-role="message-play"]');
    if (!overlay) return;
    const full = messageFullText(command);
    paintMessageOverlay(overlay, full);
    const play = () => {
      if (token !== previewToken) return;
      stopMessagePreview();
      // ADPCM 選択時は再生長に同期した 1 文字あたりの間隔を使う（runtime と同じ考え方）。
      const adpcmSeconds = command.voiceAssetId
        ? audioDurationSeconds(assetById(command.voiceAssetId))
        : 0;
      const speed = (adpcmSeconds > 0 && full.length)
        ? Math.max(1, (adpcmSeconds * 1000) / full.length)
        : Math.max(0, command.textSpeedFrames || 0) * 1000 / 60;
      if (speed <= 0 || !full) {
        paintMessageOverlay(overlay, full);
      } else {
        let shown = 0;
        paintMessageOverlay(overlay, '');
        messagePreviewTimer = setInterval(() => {
          if (token !== previewToken) { stopMessagePreview(); return; }
          shown += 1;
          paintMessageOverlay(overlay, full.slice(0, shown));
          if (shown >= full.length) { clearInterval(messagePreviewTimer); messagePreviewTimer = null; }
        }, speed);
      }
      const voice = command.voiceAssetId ? assetById(command.voiceAssetId) : null;
      if (voice?.source) {
        void resolveAssetDataUrl(voice).then((url) => {
          if (token !== previewToken || !url) return;
          const audio = new Audio(url);
          previewAudioEl = audio;
          audio.play().catch(() => {});
        });
      }
    };
    if (playBtn) playBtn.addEventListener('click', play);
  }

  function fitStageNodes() {
    const panel = commandPreviewEl.parentElement;
    const panelH = panel ? panel.clientHeight : 0;
    commandPreviewEl.querySelectorAll('.pce-vn-stage-wrap').forEach((wrap) => {
      const stage = wrap.querySelector('.pce-vn-stage');
      if (!stage) return;
      const avail = wrap.clientWidth || commandPreviewEl.clientWidth || PCE_SCREEN_WIDTH;
      // stage が幅いっぱいだと縦がパネル可視領域を超えて見切れるため、高さでも頭打ちにする。
      const head = wrap.previousElementSibling;
      const headH = head ? head.offsetHeight : 0;
      const maxStageH = Math.max(160, (panelH || 360) - headH - 16);
      const scale = Math.max(0.1, Math.min(avail / PCE_SCREEN_WIDTH, maxStageH / PCE_SCREEN_HEIGHT));
      const stageW = PCE_SCREEN_WIDTH * scale;
      stage.style.transform = `scale(${scale})`;
      stage.style.left = `${Math.max(0, (avail - stageW) / 2)}px`;
      wrap.style.height = `${PCE_SCREEN_HEIGHT * scale}px`;
    });
  }

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
      fitStageNodes();
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

  function labelOptions(current, label = 'なし') {
    const labels = (scene()?.commands || [])
      .filter((command) => command.type === 'label' && command.name)
      .map((command) => ({ id: command.name, name: command.name }));
    return optionsFor(labels, current, label);
  }

  function detailColorValue(colorName, hexName, fallback = '') {
    const hex = snapHexToPce(detailForm.elements[hexName]?.value);
    if (hex) return hex;
    return snapHexToPce(detailForm.elements[colorName]?.value) || fallback;
  }

  function syncDetailColorInputs(target) {
    const name = target?.name || '';
    const pairs = [
      ['textColor', 'textColorHex'],
      ['color', 'colorHex'],
    ];
    const pair = pairs.find(([colorName, hexName]) => name === colorName || name === hexName);
    if (!pair) return;
    const [colorName, hexName] = pair;
    const colorInput = detailForm.elements[colorName];
    const hexInput = detailForm.elements[hexName];
    if (!colorInput || !hexInput) return;
    if (name === colorName) {
      const snapped = snapHexToPce(colorInput.value);
      if (snapped) {
        colorInput.value = snapped;
        hexInput.value = snapped;
      }
      return;
    }
    const snapped = snapHexToPce(hexInput.value);
    if (snapped) colorInput.value = snapped;
  }

  function commandSummary(command) {
    if (!command) return '';
    if (command.type === 'background') {
      const label = assetById(command.assetId)?.name || command.assetId || '背景なし';
      return (command.x || command.y) ? `${label} @ ${command.x},${command.y}` : label;
    }
    if (command.type === 'sprite') {
      const name = assetById(command.assetId)?.name || command.assetId || 'spriteなし';
      return `${name} slot ${command.slot} (${command.x}, ${command.y})`;
    }
    if (command.type === 'message') return `${command.speaker ? `${command.speaker}: ` : ''}${command.text || '本文なし'}`;
    if (command.type === 'audio') return `${command.kind}:${command.action}${command.assetId ? ` ${command.assetId}` : ''}${command.kind === 'psg' && command.action === 'play' ? ` ch${command.channel || 0}` : ''}`;
    if (command.type === 'effect') {
      const color = command.effect === 'fadeOut' || command.effect === 'flash' ? ` ${command.color || ''}` : '';
      return command.effect === 'shake' ? `shake ${command.frames}f / ${command.intensity}` : `${command.effect} ${command.frames}f${color}`;
    }
    if (command.type === 'spritetext') {
      if (command.visible === false) return `slot ${command.slot} 消去`;
      return `"${command.text || ''}" slot ${command.slot} (${command.x}, ${command.y})${command.blinkFrames ? ` blink ${command.blinkFrames}f` : ''}`;
    }
    if (command.type === 'variable') return command.operation === 'random'
      ? `${command.variableName} = random(${command.min}..${command.max})`
      : `${command.variableName} ${command.operation} ${command.value}`;
    if (command.type === 'preload') return command.sceneId ? `scene ${command.sceneId}` : 'scene未指定';
    if (command.type === 'choice') return `${command.variableName ? `${command.variableName} <= ` : ''}${(command.choices || []).map((choice) => choice.label).join(' / ') || '選択肢なし'}`;
    if (command.type === 'if') return `${command.variableName} ${command.operator} ${command.value} -> ${command.targetLabel || '未指定'}`;
    if (command.type === 'switch') return `${command.variableName} / ${(command.cases || []).length} branches`;
    if (command.type === 'label') return command.name || 'label未指定';
    if (command.type === 'goto') return command.targetLabel ? `label ${command.targetLabel}` : 'label未指定';
    if (command.type === 'inputcheck') {
      if (command.mode === 'cancel') return '入力待ち終了';
      const buttons = (command.buttons || []).map((key) => (INPUT_BUTTONS.find((b) => b.key === key)?.label || key)).join('+') || 'なし';
      return `${command.mode === 'async' ? 'async' : 'sync'} ${buttons} -> ${command.targetLabel || '未指定'}`;
    }
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
        x: detailForm.elements.x.value,
        y: detailForm.elements.y.value,
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
        channel: detailForm.elements.channel?.value ?? 0,
      }, assets);
    }
    if (type === 'inputcheck') {
      const mode = detailForm.elements.mode?.value || 'sync';
      const buttons = Array.from(detailForm.querySelectorAll('[data-input-button]'))
        .filter((input) => input.checked)
        .map((input) => input.dataset.inputButton);
      return normalizeCommand({
        type,
        mode,
        buttons,
        targetLabel: detailForm.elements.targetLabel?.value || '',
      }, assets);
    }
    if (type === 'effect') {
      const effect = detailForm.elements.effect.value;
      const wasColorEffect = existing.effect === 'fadeOut' || existing.effect === 'flash';
      const keepFormColor = wasColorEffect || existing.effect === effect;
      return normalizeCommand({
        type,
        effect,
        frames: detailForm.elements.frames.value,
        intensity: detailForm.elements.intensity.value,
        color: keepFormColor ? detailColorValue('color', 'colorHex') : '',
      }, assets);
    }
    if (type === 'variable') {
      return normalizeCommand({
        type,
        variableName: detailForm.elements.variableName.value,
        operation: detailForm.elements.operation.value,
        value: detailForm.elements.value.value,
        min: detailForm.elements.min.value,
        max: detailForm.elements.max.value,
      }, assets);
    }
    if (type === 'if') {
      return normalizeCommand({
        type,
        variableName: detailForm.elements.variableName.value,
        operator: detailForm.elements.operator.value,
        value: detailForm.elements.value.value,
        targetLabel: detailForm.elements.targetLabel.value,
        elseLabel: detailForm.elements.elseLabel.value,
      }, assets);
    }
    if (type === 'switch') {
      const cases = Array.from(detailForm.querySelectorAll('[data-switch-row]')).map((row) => ({
        value: row.querySelector('[data-switch-field="value"]')?.value || '',
        targetLabel: row.querySelector('[data-switch-field="targetLabel"]')?.value || '',
      }));
      return normalizeCommand({
        type,
        variableName: detailForm.elements.variableName.value,
        defaultLabel: detailForm.elements.defaultLabel.value,
        cases,
      }, assets);
    }
    if (type === 'label') {
      return normalizeCommand({ type, name: detailForm.elements.name.value }, assets);
    }
    if (type === 'goto') {
      return normalizeCommand({ type, targetLabel: detailForm.elements.targetLabel.value }, assets);
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
        value: row.querySelector('[data-choice-field="value"]')?.value || '',
        targetSceneId: row.querySelector('[data-choice-field="targetSceneId"]')?.value || '',
      }));
      return normalizeCommand({
        type,
        variableName: detailForm.elements.variableName.value,
        defaultIndex: detailForm.elements.defaultIndex.value,
        choices,
      }, assets);
    }
    if (type === 'spritetext') {
      const stColorHex = detailColorValue('color', 'colorHex', '#ffffff');
      return normalizeCommand({
        type,
        slot: detailForm.elements.slot.value,
        text: detailForm.elements.text.value,
        x: detailForm.elements.x.value,
        y: detailForm.elements.y.value,
        color: stColorHex,
        blinkFrames: detailForm.elements.blinkFrames.value,
        visible: detailForm.elements.visible.checked,
      }, assets);
    }
    const colorEnabled = detailForm.elements.textColorEnabled?.checked;
    const colorHex = detailColorValue('textColor', 'textColorHex');
    return normalizeCommand({
      type,
      speaker: detailForm.elements.speaker.value,
      text: detailForm.elements.text.value,
      textColor: colorEnabled ? colorHex : '',
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
    if (updatePreview) void renderCommandPreview();
    updateSceneBudget();
  }

  function commitCurrentUiToDoc() {
    updateSelectedCommandFromDetail({ rerenderCommands: false, updatePreview: false });
  }

  function renderSceneList() {
    sceneList.innerHTML = doc.scenes.map((item) => {
      const firstMessage = item.commands.find((command) => command.type === 'message');
      const canDelete = doc.scenes.length > 1;
      const bytes = estimateScenePackBytes(item);
      const level = bytes > VN_SCENE_PACK_LIMIT ? 'error' : (bytes / VN_SCENE_PACK_LIMIT >= 0.85 ? 'warn' : 'ok');
      const badge = level === 'ok'
        ? ''
        : `<span class="pce-vn-scene-budget-badge" data-level="${level}" title="scene pack ${bytes} / ${VN_SCENE_PACK_LIMIT} byte">${level === 'error' ? '⚠ 超過' : `${Math.round((bytes / VN_SCENE_PACK_LIMIT) * 100)}%`}</span>`;
      return `
        <div class="pce-vn-scene-row ${item.id === selectedId ? 'active' : ''}" data-scene-row="${esc(item.id)}">
          <button type="button" data-scene-id="${esc(item.id)}" class="pce-vn-scene-select">
            <strong>${esc(item.id)}${item.fullScreenBg ? '<span class="pce-vn-mode-badge">Full BG</span>' : ''}${badge}</strong>
            <span>${esc(firstMessage?.text || `${item.commands.length} commands`)}</span>
          </button>
          <button
            class="icon-btn-xs danger pce-vn-scene-delete"
            type="button"
            data-scene-delete="${esc(item.id)}"
            title="シーン削除"
            aria-label="${esc(item.id)} を削除"
            ${canDelete ? '' : 'disabled'}
          >×</button>
        </div>
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
    sceneList.querySelectorAll('[data-scene-delete]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteScene(button.dataset.sceneDelete || selectedId);
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
          <label class="form-group"><span class="form-label">X tile</span><input class="form-input" name="x" type="number" min="0" max="63" value="${esc(command.x)}" /></label>
          <label class="form-group"><span class="form-label">Y tile</span><input class="form-input" name="y" type="number" min="0" max="31" value="${esc(command.y)}" /></label>
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
      const audioAssets = command.kind === 'adpcm'
        ? byType(['adpcm'])
        : (command.kind === 'psg' ? byType(['psg-song', 'psg-sfx']) : byType(['cdda-track']));
      const channelField = command.kind === 'psg'
        ? `<label class="form-group"><span class="form-label">基準ch</span><input class="form-input" name="channel" type="number" min="0" max="5" value="${esc(command.channel || 0)}" /></label>`
        : '';
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Kind</span><select class="form-select" name="kind"><option value="cdda" ${command.kind !== 'adpcm' && command.kind !== 'psg' ? 'selected' : ''}>CD-DA</option><option value="adpcm" ${command.kind === 'adpcm' ? 'selected' : ''}>ADPCM</option><option value="psg" ${command.kind === 'psg' ? 'selected' : ''}>PSG</option></select></label>
          <label class="form-group"><span class="form-label">Action</span><select class="form-select" name="action"><option value="play" ${command.action !== 'stop' ? 'selected' : ''}>play</option><option value="stop" ${command.action === 'stop' ? 'selected' : ''}>stop</option></select></label>
        </div>
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Asset</span><select class="form-select" name="assetId">${optionsFor(audioAssets, command.assetId, 'なし')}</select></label>
          ${channelField}
        </div>
      `;
    }
    if (command.type === 'effect') {
      const effectColor = command.color || (command.effect === 'fadeOut' ? '#000000' : '#ffffff');
      return `
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Effect</span><select class="form-select" name="effect"><option value="fadeOut" ${command.effect === 'fadeOut' ? 'selected' : ''}>fade out</option><option value="fadeIn" ${command.effect === 'fadeIn' ? 'selected' : ''}>fade in</option><option value="blank" ${command.effect === 'blank' ? 'selected' : ''}>blank</option><option value="shake" ${command.effect === 'shake' ? 'selected' : ''}>shake</option><option value="flash" ${command.effect === 'flash' ? 'selected' : ''}>flash</option></select></label>
          <label class="form-group"><span class="form-label">Frames</span><input class="form-input" name="frames" type="number" min="0" max="255" value="${esc(command.frames)}" /></label>
          <label class="form-group"><span class="form-label">Power</span><input class="form-input" name="intensity" type="number" min="1" max="16" value="${esc(command.intensity || 4)}" /></label>
        </div>
        <label class="form-group"><span class="form-label">色</span>
          <span class="pce-vn-color-row">
            <input type="color" name="color" value="${esc(effectColor)}" />
            <input class="form-input form-input-mono" name="colorHex" value="${esc(command.color || '')}" placeholder="#rrggbb" />
          </span>
        </label>
      `;
    }
    if (command.type === 'variable') {
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Variable</span><input class="form-input form-input-mono" name="variableName" value="${esc(command.variableName || '')}" /></label>
          <label class="form-group"><span class="form-label">Operation</span><select class="form-select" name="operation"><option value="define" ${command.operation === 'define' ? 'selected' : ''}>define</option><option value="set" ${command.operation === 'set' ? 'selected' : ''}>set</option><option value="add" ${command.operation === 'add' ? 'selected' : ''}>add</option><option value="sub" ${command.operation === 'sub' ? 'selected' : ''}>sub</option><option value="random" ${command.operation === 'random' ? 'selected' : ''}>random</option></select></label>
        </div>
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Value</span><input class="form-input" name="value" type="number" min="-32768" max="32767" value="${esc(command.value)}" /></label>
          <label class="form-group"><span class="form-label">Random min</span><input class="form-input" name="min" type="number" min="-32768" max="32767" value="${esc(command.min)}" /></label>
          <label class="form-group"><span class="form-label">Random max</span><input class="form-input" name="max" type="number" min="-32768" max="32767" value="${esc(command.max)}" /></label>
        </div>
      `;
    }
    if (command.type === 'if') {
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Variable</span><input class="form-input form-input-mono" name="variableName" value="${esc(command.variableName || '')}" /></label>
          <label class="form-group"><span class="form-label">Operator</span><select class="form-select" name="operator"><option value="eq" ${command.operator === 'eq' ? 'selected' : ''}>==</option><option value="ne" ${command.operator === 'ne' ? 'selected' : ''}>!=</option><option value="lt" ${command.operator === 'lt' ? 'selected' : ''}>&lt;</option><option value="lte" ${command.operator === 'lte' ? 'selected' : ''}>&lt;=</option><option value="gt" ${command.operator === 'gt' ? 'selected' : ''}>&gt;</option><option value="gte" ${command.operator === 'gte' ? 'selected' : ''}>&gt;=</option></select></label>
        </div>
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Value</span><input class="form-input" name="value" type="number" min="-32768" max="32767" value="${esc(command.value)}" /></label>
          <label class="form-group"><span class="form-label">True label</span><select class="form-select" name="targetLabel">${labelOptions(command.targetLabel, 'なし')}</select></label>
          <label class="form-group"><span class="form-label">False label</span><select class="form-select" name="elseLabel">${labelOptions(command.elseLabel, '続行')}</select></label>
        </div>
      `;
    }
    if (command.type === 'switch') {
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Variable</span><input class="form-input form-input-mono" name="variableName" value="${esc(command.variableName || '')}" /></label>
          <label class="form-group"><span class="form-label">Default</span><select class="form-select" name="defaultLabel">${labelOptions(command.defaultLabel, '続行')}</select></label>
        </div>
        <div class="pce-vn-switch-list" data-role="switch-list">
          ${(command.cases || []).map((branch, index) => `
            <div class="pce-vn-switch-row" data-switch-row>
              <label class="form-group"><span class="form-label">Value ${index + 1}</span><input class="form-input" data-switch-field="value" type="number" min="-32768" max="32767" value="${esc(branch.value)}" /></label>
              <label class="form-group"><span class="form-label">Label</span><select class="form-select" data-switch-field="targetLabel">${labelOptions(branch.targetLabel, 'なし')}</select></label>
              <button class="icon-btn danger" type="button" data-switch-remove="${index}" title="分岐削除" aria-label="分岐削除">×</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-sm" type="button" data-switch-add>分岐追加</button>
      `;
    }
    if (command.type === 'label') {
      return `
        <label class="form-group"><span class="form-label">Label</span><input class="form-input form-input-mono" name="name" value="${esc(command.name || '')}" /></label>
      `;
    }
    if (command.type === 'goto') {
      return `
        <label class="form-group"><span class="form-label">Label</span><select class="form-select" name="targetLabel">${labelOptions(command.targetLabel, 'なし')}</select></label>
      `;
    }
    if (command.type === 'inputcheck') {
      const selected = new Set(Array.isArray(command.buttons) ? command.buttons : []);
      const mode = command.mode || 'sync';
      const toggles = INPUT_BUTTONS.map((button) => `
        <label class="pce-vn-input-toggle ${selected.has(button.key) ? 'active' : ''}">
          <input type="checkbox" data-input-button="${button.key}" ${selected.has(button.key) ? 'checked' : ''} ${mode === 'cancel' ? 'disabled' : ''} />
          <span>${esc(button.label)}</span>
        </label>
      `).join('');
      const targetField = mode === 'cancel'
        ? ''
        : `<label class="form-group"><span class="form-label">移動先ラベル</span><select class="form-select" name="targetLabel">${labelOptions(command.targetLabel, 'なし')}</select></label>`;
      const buttonGroup = mode === 'cancel'
        ? ''
        : `<div class="form-group"><span class="form-label">ボタン (OR条件)</span><div class="pce-vn-input-toggles" data-role="input-toggles">${toggles}</div></div>`;
      return `
        <label class="form-group"><span class="form-label">Mode</span><select class="form-select" name="mode"><option value="sync" ${mode === 'sync' ? 'selected' : ''}>sync (同期待機)</option><option value="async" ${mode === 'async' ? 'selected' : ''}>async (待機開始/次へ)</option><option value="cancel" ${mode === 'cancel' ? 'selected' : ''}>cancel (待機終了)</option></select></label>
        ${buttonGroup}
        ${targetField}
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
        <label class="form-group"><span class="form-label">Result variable</span><input class="form-input form-input-mono" name="variableName" value="${esc(command.variableName || '')}" /></label>
        <label class="form-group"><span class="form-label">Default</span><input class="form-input" name="defaultIndex" type="number" min="0" max="${Math.max(0, (command.choices || []).length - 1)}" value="${esc(command.defaultIndex || 0)}" /></label>
        <div class="pce-vn-choice-list" data-role="choice-list">
          ${(command.choices || []).map((choice, index) => `
            <div class="pce-vn-choice-row" data-choice-row>
              <label class="form-group"><span class="form-label">Label ${index + 1}</span><input class="form-input" data-choice-field="label" value="${esc(choice.label || '')}" /></label>
              <label class="form-group"><span class="form-label">Value</span><input class="form-input" data-choice-field="value" type="number" min="-32768" max="32767" value="${esc(choice.value ?? index)}" /></label>
              <label class="form-group"><span class="form-label">Target</span><select class="form-select" data-choice-field="targetSceneId">${sceneOptions(choice.targetSceneId, 'なし')}</select></label>
              <button class="icon-btn danger" type="button" data-choice-remove="${index}" title="選択肢削除" aria-label="選択肢削除">×</button>
            </div>
          `).join('')}
        </div>
        <button class="btn-sm" type="button" data-choice-add>選択肢追加</button>
      `;
    }
    if (command.type === 'spritetext') {
      const stColor = command.color || '#ffffff';
      return `
        <label class="form-group"><span class="form-label">文字 (最大32グリフ)</span><input class="form-input form-input-mono" name="text" value="${esc(command.text || '')}" placeholder="PRESS RUN BUTTON" /></label>
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Slot</span><input class="form-input" name="slot" type="number" min="0" max="3" value="${esc(command.slot)}" /></label>
          <label class="form-group"><span class="form-label">X</span><input class="form-input" name="x" type="number" min="0" max="319" value="${esc(command.x)}" /></label>
          <label class="form-group"><span class="form-label">Y</span><input class="form-input" name="y" type="number" min="0" max="223" value="${esc(command.y)}" /></label>
          <label class="form-group"><span class="form-label">Blink</span><input class="form-input" name="blinkFrames" type="number" min="0" max="255" value="${esc(command.blinkFrames || 0)}" /></label>
        </div>
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">文字色</span>
            <span class="pce-vn-color-row">
              <input type="color" name="color" value="${esc(stColor)}" />
              <input class="form-input form-input-mono" name="colorHex" value="${esc(command.color || '')}" placeholder="#rrggbb" />
            </span>
          </label>
          <label class="pce-vn-check"><input name="visible" type="checkbox" ${command.visible !== false ? 'checked' : ''} /><span>visible</span></label>
        </div>
        <small class="pce-vn-hint">ハードウェアスプライトで描画。立ち絵と同じ SATB(64)/16-per-line を共有するので短く。同時表示は1色（後勝ち）。</small>
      `;
    }
    const hasColor = Boolean(command.textColor);
    const colorValue = command.textColor || '#ffffff';
    const speedHint = command.voiceAssetId
      ? '<small class="pce-vn-hint">ADPCM選択時は再生長に同期（Speedは無視）</small>'
      : '';
    return `
      <div class="pce-vn-grid">
        <label class="form-group"><span class="form-label">話者</span><input class="form-input" name="speaker" value="${esc(command.speaker || '')}" /></label>
        <label class="form-group"><span class="form-label">ADPCM</span><select class="form-select" name="voiceAssetId">${optionsFor(byType(['adpcm']), command.voiceAssetId, 'なし')}</select></label>
      </div>
      <label class="form-group"><span class="form-label">本文</span><textarea class="form-input" name="text" rows="3" placeholder="空欄でメッセージをクリア">${esc(command.text || '')}</textarea></label>
      <div class="pce-vn-grid">
        <label class="form-group"><span class="form-label">文字色</span>
          <span class="pce-vn-color-row">
            <label class="pce-vn-check"><input name="textColorEnabled" type="checkbox" ${hasColor ? 'checked' : ''} /><span>指定</span></label>
            <input type="color" name="textColor" value="${esc(colorValue)}" ${hasColor ? '' : 'disabled'} />
            <input class="form-input form-input-mono" name="textColorHex" value="${esc(command.textColor || '')}" placeholder="#rrggbb" ${hasColor ? '' : 'disabled'} />
          </span>
        </label>
      </div>
      <div class="pce-vn-grid tight">
        <label class="form-group"><span class="form-label">Speed</span><input class="form-input" name="textSpeedFrames" type="number" min="0" max="30" value="${esc(command.textSpeedFrames)}" ${command.voiceAssetId ? 'disabled' : ''} />${speedHint}</label>
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
          <div class="pce-vn-command-actions">
            <button class="icon-btn" type="button" data-command-paste-before="${index}" title="前にペースト" aria-label="前にペースト" ${commandClipboard ? '' : 'disabled'}>⤒</button>
            <button class="icon-btn" type="button" data-command-paste-after="${index}" title="後にペースト" aria-label="後にペースト" ${commandClipboard ? '' : 'disabled'}>⤓</button>
            <button class="icon-btn" type="button" data-command-copy="${index}" title="コピー" aria-label="コピー">⧉</button>
            <button class="icon-btn danger" type="button" data-command-remove="${index}" title="削除" aria-label="削除">×</button>
          </div>
        </section>
        <div class="pce-vn-command-dropzone" data-drop-index="${index + 1}"></div>
      `;
    }));
    commandsEl.innerHTML = pieces.join('');
  }

  function previewTitle(command) {
    const definition = commandDefinition(command?.type);
    return command ? `#${selectedCommandIndex + 1} ${definition.label}` : 'Preview';
  }

  function renderCommandPreviewText(command) {
    const title = previewTitle(command);
    const body = document.createElement('div');
    body.className = 'pce-vn-preview-text';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const text = document.createElement('p');
    if (!command) text.textContent = 'コマンドを選択してください';
    else if (command.type === 'message') text.textContent = `${command.speaker ? `${command.speaker}: ` : ''}${command.text || '本文なし'}`;
    else if (command.type === 'choice') text.textContent = (command.choices || []).map((choice) => `・${choice.label}`).join('\n') || '選択肢なし';
    else if (command.type === 'variable') text.textContent = command.operation === 'random'
      ? `${command.variableName} = random(${command.min}..${command.max})`
      : `${command.variableName} ${command.operation} ${command.value}`;
    else if (command.type === 'if') text.textContent = `${command.variableName} ${command.operator} ${command.value}\ntrue -> ${command.targetLabel || 'continue'}\nfalse -> ${command.elseLabel || 'continue'}`;
    else if (command.type === 'switch') text.textContent = `${command.variableName}\n${(command.cases || []).map((branch) => `${branch.value} -> ${branch.targetLabel || 'continue'}`).join('\n')}${command.defaultLabel ? `\ndefault -> ${command.defaultLabel}` : ''}`;
    else if (command.type === 'label') text.textContent = command.name || 'label未指定';
    else if (command.type === 'goto') text.textContent = command.targetLabel ? `goto ${command.targetLabel}` : 'label未指定';
    else if (command.type === 'jump' || command.type === 'preload') text.textContent = command.sceneId ? `Scene: ${command.sceneId}` : 'Scene未指定';
    else if (command.type === 'wait') text.textContent = `${command.frames} frames`;
    else if (command.type === 'effect') {
      const color = command.effect === 'fadeOut' || command.effect === 'flash' ? ` / ${command.color || '#000000'}` : '';
      text.textContent = command.effect === 'shake'
        ? `shake / ${command.frames} frames / power ${command.intensity}`
        : `${command.effect} / ${command.frames} frames${color}`;
    }
    else text.textContent = commandSummary(command);
    body.append(strong, text);
    commandPreviewEl.replaceChildren(body);
  }

  function renderCommandPreviewLoading(command, asset, kind) {
    commandPreviewEl.innerHTML = `
      <div class="pce-vn-preview-loading">
        <strong>${esc(previewTitle(command))}</strong>
        <span>${esc(asset?.name || asset?.id || `${kind}なし`)}</span>
      </div>
    `;
  }

  async function renderCommandPreview() {
    const current = scene();
    if (!current) return;
    const command = ensureSelectedCommand(current);
    const token = ++previewToken;
    stopMessagePreview();
    if (!command) {
      renderCommandPreviewText(null);
      return;
    }
    if (command.type === 'message') {
      const state = computeVisualState(current.commands, selectedCommandIndex, current.fullScreenBg);
      const ids = new Set();
      if (state.background?.assetId) ids.add(state.background.assetId);
      Object.values(state.sprites).forEach((s) => { if (s.assetId) ids.add(s.assetId); });
      const urls = {};
      await Promise.all([...ids].map(async (id) => { urls[id] = await resolveAssetDataUrl(assetById(id)); }));
      if (token !== previewToken) return;
      const node = buildMessageStageNode(state, urls, command);
      commandPreviewEl.replaceChildren(node);
      fitStageNodes();
      startMessagePreview(node, command, token);
      return;
    }
    if (command.type === 'background' || command.type === 'sprite' || command.type === 'spritetext') {
      const loadingLabel = command.type === 'background' ? '背景' : (command.type === 'spritetext' ? 'SpriteText' : 'Sprite');
      renderCommandPreviewLoading(command, command.type === 'spritetext' ? null : assetById(command.assetId), loadingLabel);
      const state = computeVisualState(current.commands, selectedCommandIndex, current.fullScreenBg);
      const ids = new Set();
      if (state.background?.assetId) ids.add(state.background.assetId);
      Object.values(state.sprites).forEach((s) => { if (s.assetId) ids.add(s.assetId); });
      const urls = {};
      await Promise.all([...ids].map(async (id) => { urls[id] = await resolveAssetDataUrl(assetById(id)); }));
      if (token !== previewToken) return;
      commandPreviewEl.replaceChildren(buildStageNode(state, urls, command));
      fitStageNodes();
      return;
    }
    if (command.type === 'audio') {
      const asset = command.action === 'play' ? assetById(command.assetId) : null;
      renderCommandPreviewLoading(command, asset, '音声');
      const previewPath = previewPathForAsset(asset);
      if (!previewPath) return;
      const result = await previewPceAssetSource(previewPath);
      if (token !== previewToken) return;
      commandPreviewEl.innerHTML = '';
      if (!result?.dataUrl) {
        renderCommandPreviewText(command);
        return;
      }
      const frame = document.createElement('div');
      frame.className = 'pce-vn-audio-preview';
      const label = document.createElement('strong');
      label.textContent = asset.name || asset.id;
      const info = document.createElement('span');
      info.textContent = `${command.kind.toUpperCase()} / ${command.action}`;
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = result.dataUrl;
      frame.append(label, info, audio);
      commandPreviewEl.replaceChildren(frame);
      return;
    }
    renderCommandPreviewText(command);
  }

  function renderForm() {
    const current = scene();
    if (!current) return;
    ensureSelectedCommand(current);
    root.querySelector('[data-role="scene-title"]').textContent = current.id;
    if (sceneFullScreenBgInput) sceneFullScreenBgInput.checked = Boolean(current.fullScreenBg);
    renderCommands(current);
    renderCommandDetail(current);
    void renderCommandPreview();
  }

  function updateSceneBudget() {
    if (!sceneBudgetEl) return;
    const current = scene();
    const bytes = current ? estimateScenePackBytes(current) : 0;
    const ratio = bytes / VN_SCENE_PACK_LIMIT;
    const percent = Math.round(ratio * 100);
    const level = bytes > VN_SCENE_PACK_LIMIT ? 'error' : (ratio >= 0.85 ? 'warn' : 'ok');
    sceneBudgetEl.dataset.level = level;
    sceneBudgetEl.querySelector('[data-role="scene-budget-value"]').textContent =
      `${bytes} / ${VN_SCENE_PACK_LIMIT} byte (${percent}%)`;
    const fill = sceneBudgetEl.querySelector('[data-role="scene-budget-fill"]');
    fill.style.width = `${Math.min(100, percent)}%`;
    const note = sceneBudgetEl.querySelector('[data-role="scene-budget-note"]');
    if (level === 'error') {
      note.textContent = `このシーンは scene pack 上限 ${VN_SCENE_PACK_LIMIT} byte を ${bytes - VN_SCENE_PACK_LIMIT} byte 超過しています。`
        + 'このままではビルドが失敗します。Jump で別シーンに分割してください。';
      note.style.display = '';
    } else if (level === 'warn') {
      note.textContent = `残り ${VN_SCENE_PACK_LIMIT - bytes} byte。上限に近づいています。長くなる場合はシーン分割を検討してください。`;
      note.style.display = '';
    } else {
      note.style.display = 'none';
      note.textContent = '';
    }
  }

  function render() {
    renderSceneList();
    renderCommandPalette();
    renderForm();
    updateSceneBudget();
  }

  async function load(options = {}) {
    errorEl.textContent = '';
    assetDataUrlCache.clear();
    const assetResult = await listPceAssets({ force: Boolean(options.force) });
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
        if (isPluginPageActive()) void load({ force: true });
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

  function cloneCommand(command) {
    return normalizeCommand(JSON.parse(JSON.stringify(command)), assets);
  }

  function copyCommand(index) {
    const current = scene();
    if (!current) return;
    commitCurrentUiToDoc();
    const command = current.commands[index];
    if (!command) return;
    commandClipboard = cloneCommand(command);
    renderCommands(current);
    errorEl.textContent = `${commandDefinition(command.type).label} をコピーしました`;
  }

  function pasteCommand(index, where) {
    if (!commandClipboard) return;
    commitCurrentUiToDoc();
    const current = scene();
    if (!current) return;
    const at = clamp(where === 'after' ? index + 1 : index, 0, current.commands.length, current.commands.length);
    current.commands.splice(at, 0, cloneCommand(commandClipboard));
    selectedCommandIndex = at;
    render();
  }

  async function openScenePreview() {
    try {
      commitCurrentUiToDoc();
      const snapshot = normalizeDoc(doc, assets);
      const referenced = new Set();
      snapshot.scenes.forEach((item) => (item.commands || []).forEach((command) => {
        if ((command.type === 'background' || command.type === 'sprite') && command.assetId) referenced.add(command.assetId);
        if (command.type === 'audio' && command.action === 'play' && command.assetId) referenced.add(command.assetId);
        if (command.type === 'message' && command.voiceAssetId) referenced.add(command.voiceAssetId);
      }));
      const urls = {};
      const meta = {};
      await Promise.all([...referenced].map(async (id) => {
        const asset = assetById(id);
        if (!asset) return;
        const url = await resolveAssetDataUrl(asset);
        if (!url) return;
        urls[id] = url;
        const size = assetPixelSize(asset);
        meta[id] = {
          type: asset.type,
          name: asset.name || asset.id,
          width: size.width,
          height: size.height,
          durationSeconds: audioDurationSeconds(asset),
          loop: Boolean(asset.options?.loop),
        };
        if (asset.type === 'sprite') {
          const anim = spriteAnimationMeta(asset);
          meta[id].cellWidth = anim.cellWidth;
          meta[id].cellHeight = anim.cellHeight;
          meta[id].animations = anim.animations;
        }
      }));
      const payload = {
        doc: snapshot,
        startScene: selectedId,
        urls,
        meta,
        screen: { w: PCE_SCREEN_WIDTH, h: PCE_SCREEN_HEIGHT },
        message: MESSAGE_AREA,
      };
      const win = window.open('', `pce-vn-preview-${selectedId}`, 'width=720,height=560');
      if (!win) {
        errorEl.textContent = 'プレビューウィンドウを開けませんでした（ポップアップ設定をご確認ください）';
        return;
      }
      win.document.open();
      win.document.write(buildPreviewHtml(payload));
      win.document.close();
      win.focus();
    } catch (err) {
      errorEl.textContent = `プレビュー失敗: ${err?.message || err}`;
    }
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
    const copy = event.target?.closest?.('[data-command-copy]');
    if (copy) {
      copyCommand(Number(copy.dataset.commandCopy));
      return;
    }
    const pasteBefore = event.target?.closest?.('[data-command-paste-before]');
    if (pasteBefore) {
      pasteCommand(Number(pasteBefore.dataset.commandPasteBefore), 'before');
      return;
    }
    const pasteAfter = event.target?.closest?.('[data-command-paste-after]');
    if (pasteAfter) {
      pasteCommand(Number(pasteAfter.dataset.commandPasteAfter), 'after');
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
    void renderCommandPreview();
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
    syncDetailColorInputs(event.target);
    updateSelectedCommandFromDetail({ rerenderCommands: true, updatePreview: true });
  });

  detailForm.addEventListener('change', (event) => {
    const name = event.target?.name || '';
    syncDetailColorInputs(event.target);
    const isInputToggle = Boolean(event.target?.dataset?.inputButton);
    const rerenderDetail = isInputToggle
      || ['type', 'kind', 'assetId', 'mode', 'effect', 'voiceAssetId', 'textColorEnabled', 'textColor', 'textColorHex', 'color', 'colorHex'].includes(name);
    updateSelectedCommandFromDetail({ rerenderDetail, rerenderCommands: true, updatePreview: true });
  });

  detailForm.addEventListener('click', (event) => {
    const add = event.target?.closest?.('[data-choice-add]');
    const remove = event.target?.closest?.('[data-choice-remove]');
    const switchAdd = event.target?.closest?.('[data-switch-add]');
    const switchRemove = event.target?.closest?.('[data-switch-remove]');
    if (!add && !remove && !switchAdd && !switchRemove) return;
    updateSelectedCommandFromDetail({ rerenderCommands: false, updatePreview: false });
    const current = scene();
    const command = ensureSelectedCommand(current);
    if (!command) return;
    if (command.type === 'choice') {
      if (add && command.choices.length < 4) command.choices.push({ label: `選択肢${command.choices.length + 1}`, value: command.choices.length, targetSceneId: '' });
      if (remove) command.choices.splice(Number(remove.dataset.choiceRemove), 1);
      if (!command.choices.length) command.choices.push({ label: '進む', value: 0, targetSceneId: '' });
      command.defaultIndex = clamp(command.defaultIndex, 0, command.choices.length - 1, 0);
    } else if (command.type === 'switch') {
      if (switchAdd) command.cases.push({ value: command.cases.length, targetLabel: '' });
      if (switchRemove) command.cases.splice(Number(switchRemove.dataset.switchRemove), 1);
      if (!command.cases.length) command.cases.push({ value: 0, targetLabel: '' });
    }
    renderCommands(current);
    renderCommandDetail(current);
    void renderCommandPreview();
  });

  root.querySelector('[data-action="reload"]').addEventListener('click', () => { void load({ force: true }); });
  root.querySelector('[data-action="save"]').addEventListener('click', save);
  root.querySelector('[data-action="preview"]').addEventListener('click', () => { void openScenePreview(); });
  sceneFullScreenBgInput?.addEventListener('change', () => {
    commitCurrentUiToDoc();
    const current = scene();
    if (!current) return;
    current.fullScreenBg = Boolean(sceneFullScreenBgInput.checked);
    renderSceneList();
    renderCommands(current);
    void renderCommandPreview();
  });
  root.querySelector('[data-action="add-scene"]').addEventListener('click', () => {
    commitCurrentUiToDoc();
    const id = safeId(`scene_${doc.scenes.length + 1}`, 'scene');
    doc.scenes.push({ id, fullScreenBg: false, commands: [defaultCommand('message', assets)], nextSceneId: '' });
    selectedId = id;
    selectedCommandIndex = 0;
    render();
  });

  function deleteScene(sceneId = selectedId) {
    if (doc.scenes.length <= 1) return;
    const targetId = String(sceneId || selectedId);
    const targetIndex = doc.scenes.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    commitCurrentUiToDoc();
    const deletingSelected = targetId === selectedId;
    doc.scenes = doc.scenes.filter((item) => item.id !== targetId);
    if (deletingSelected) {
      selectedId = doc.scenes[Math.min(targetIndex, doc.scenes.length - 1)]?.id || 'opening';
      selectedCommandIndex = 0;
    }
    if (doc.startScene === targetId || !doc.scenes.some((item) => item.id === doc.startScene)) {
      doc.startScene = selectedId || doc.scenes[0]?.id || 'opening';
    }
    render();
  }

  root.querySelector('[data-action="delete-scene"]').addEventListener('click', () => {
    deleteScene(selectedId);
  });

  const handleWindowResize = () => fitStageNodes();
  window.addEventListener('resize', handleWindowResize);

  registerCapability('visual-novel-editor', { reload: load, save });
  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  void load();
  return {
    deactivate() {
      teardownAssetRefreshEvents();
      window.removeEventListener('resize', handleWindowResize);
      stopMessagePreview();
    },
  };
}
