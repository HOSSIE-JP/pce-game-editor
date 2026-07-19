import {
  createPsgPreviewController,
  psgPreviewStats,
} from '../pce-music-editor/psg-preview.js';
import { psgNoiseHzFromValue } from '../pce-music-editor/psg-sfx-synth.mjs';

const SCENE_FILE = 'assets/pce-vn-scenes.json';
const PCE_SCREEN_WIDTH = 256;
const PCE_SCREEN_HEIGHT = 224;
// ゲーム側 runtime のメッセージ領域に一致させる。
// 256x224 画面、メッセージ窓 208x64px を下部中央から1タイル上 (x=24,y=152) に配置。
// 1 文字 12×12px を 12px 横ピッチで 17 文字、16px 行ピッチで 4 行。
const MESSAGE_AREA = { x: 24, y: 152, cols: 17, rows: 4, cellW: 12, cellH: 16 };
const SPRITETEXT_CELL = { width: 12, height: 16 };
const MESSAGE_WAIT_GLYPH = '▼';
const DEFAULT_CHARACTER_Y = 24;
const DEFAULT_BG_TILE_X = 2;
const DEFAULT_BG_TILE_Y = 1;
const COLUMN_LAYOUT_KEY = 'pce-vn-editor.columnLayout.v1';
const SCENE_GROUP_COLLAPSE_KEY = 'pce-vn-editor.sceneGroupCollapse.v1';
const COMMAND_LIBRARY_COLLAPSED_KEY = 'pce-vn-editor.commandLibraryCollapsed.v1';
const DEFAULT_COLUMN_LAYOUT = { left: 320, right: 440 };
const MIN_LEFT_WIDTH = 240;
const MAX_LEFT_WIDTH = 520;
const MIN_CENTER_WIDTH = 340;
const MIN_RIGHT_WIDTH = 320;
const MAX_RIGHT_WIDTH = 720;
const ADPCM_END_PAD_SECONDS = 2 / 60;
const BG_FADE_SPEEDS = [
  { value: 10, label: '速度1(速い)：10' },
  { value: 20, label: '速度2：20' },
  { value: 30, label: '速度3：30' },
  { value: 40, label: '速度4：40' },
  { value: 50, label: '速度5：50' },
  { value: 60, label: '速度6(遅い)：60' },
];
const DEFAULT_BG_FADE_FRAMES = 30;
const MESSAGE_SPEEDS = [
  { value: 0, label: '速度1(速い)：0' },
  { value: 10, label: '速度2：10' },
  { value: 20, label: '速度3：20' },
  { value: 30, label: '速度4：30' },
  { value: 40, label: '速度5：40' },
  { value: 50, label: '速度6(遅い)：50' },
];
const DEFAULT_MESSAGE_SPEED_FRAMES = 10;
const DEFAULT_MESSAGE_AUTO_WAIT_FRAMES = 60;
const VN_SYSTEM_SETTINGS_EVENT = 'pce-vn-system-settings:changed';

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
const CACHE_SCOPE_OPTIONS = [
  { value: 'visual', label: 'Visual (BG + Sprite)' },
  { value: 'bg', label: 'BG' },
  { value: 'sprite', label: 'Sprite' },
  { value: 'adpcm', label: 'ADPCM' },
  { value: 'psg', label: 'PSG' },
  { value: 'all', label: 'All' },
];
const CACHE_ACTION_OPTIONS = [
  { value: 'clear', label: 'Clear' },
  { value: 'load', label: 'Load' },
];

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

// Preview SpriteText with the runtime's fixed-width cells. A plain CSS
// monospace run would still render ASCII at about half the width of Japanese
// glyphs, while both CD and HuCARD runtimes advance every glyph by 12 pixels.
function renderSpriteTextCells(node, text) {
  node.replaceChildren();
  let row = document.createElement('span');
  row.style.display = 'block';
  row.style.height = `${SPRITETEXT_CELL.height}px`;
  node.appendChild(row);
  for (const glyph of String(text || '')) {
    if (glyph === '\r') continue;
    if (glyph === '\n') {
      row = document.createElement('span');
      row.style.display = 'block';
      row.style.height = `${SPRITETEXT_CELL.height}px`;
      node.appendChild(row);
      continue;
    }
    const cell = document.createElement('span');
    cell.style.display = 'inline-block';
    cell.style.width = `${SPRITETEXT_CELL.width}px`;
    cell.style.height = `${SPRITETEXT_CELL.height}px`;
    cell.style.overflow = 'hidden';
    cell.style.textAlign = 'center';
    cell.style.verticalAlign = 'top';
    cell.textContent = glyph;
    row.appendChild(cell);
  }
}

// 編集専用のコメント色は PCE 表示色へスナップせず、自由な "#rrggbb" を許容する。
function normalizeFreeHex(value) {
  if (value == null) return '';
  let s = String(value).trim();
  if (!s) return '';
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '';
  return `#${s.toLowerCase()}`;
}

// 背景色に対して読みやすい文字色（黒/白）を相対輝度から選ぶ。
function readableTextColor(hex) {
  const norm = normalizeFreeHex(hex);
  if (!norm) return '#ffffff';
  const n = parseInt(norm.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

const COMMAND_DEFINITIONS = [
  { type: 'background', label: 'BG', category: '表示', description: '背景画像と切替' },
  { type: 'sprite', label: 'Sprite', category: '表示', description: '立ち絵の表示/非表示' },
  { type: 'spritemove', label: 'Sprite Move', category: '表示', description: '立ち絵を指定フレームで滑らかに移動' },
  { type: 'message', label: 'Message', category: 'テキスト', description: '話者、本文、送り設定' },
  { type: 'variable', label: 'Variable', category: '変数', description: '定義、代入、加算、減算、ランダム' },
  { type: 'choice', label: 'Choice', category: '分岐', description: '選択肢と変数への値設定' },
  { type: 'if', label: 'IF', category: '分岐', description: '変数条件でラベルへ分岐' },
  { type: 'switch', label: 'Switch', category: '分岐', description: '変数値で複数ラベルへ分岐' },
  { type: 'label', label: 'Label', category: '分岐', description: 'GOTO/分岐の移動先' },
  { type: 'goto', label: 'GOTO', category: '分岐', description: '指定ラベルへ移動' },
  { type: 'inputcheck', label: 'Input', category: '分岐', description: '入力でラベルへGOTO' },
  { type: 'jump', label: 'Jump', category: '分岐', description: '別シーンへ移動' },
  { type: 'wait', label: 'Wait', category: '制御', description: '指定フレーム待機' },
  { type: 'cache', label: 'Cache', category: '制御', description: 'runtime cache control' },
  { type: 'audio', label: 'Audio', category: '音声', description: 'CD-DA/ADPCM/PSG再生停止' },
  { type: 'effect', label: 'Effect', category: '演出', description: 'フェード/フラッシュ/揺れ' },
  { type: 'spritetext', label: 'SpriteText', category: '演出', description: '短い文字をスプライトで重ねる' },
  { type: 'comment', label: 'Comment', category: 'メモ', description: 'エディタ専用メモ（ビルド・実行には含まれない）' },
];
const COMMAND_CATEGORIES = [...new Set(COMMAND_DEFINITIONS.map((item) => item.category))];

// コマンド分類ごとの固定色。スクリプト一覧の行とコマンドパレットを分類色で
// 塗り分けて視覚的に見やすくする（エディタ表示専用・ビルドには影響しない）。
// 文字色は readableTextColor で自動的に読みやすい黒/白を選ぶ前提のパステル。
const CATEGORY_COLORS = {
  '表示': '#7dd3fc',
  'テキスト': '#86efac',
  '変数': '#d8b4fe',
  '分岐': '#fdba74',
  '制御': '#94a3b8',
  '音声': '#f9a8d4',
  '演出': '#fca5a5',
  'メモ': '#fde68a',
};
const DEFAULT_CATEGORY_COLOR = '#94a3b8';

function categoryColor(category) {
  return CATEGORY_COLORS[category] || DEFAULT_CATEGORY_COLOR;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function normalizeCacheScope(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return CACHE_SCOPE_OPTIONS.some((option) => option.value === raw) ? raw : 'visual';
}

function normalizeCacheAction(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'load' ? 'load' : 'clear';
}

function cacheActionOptions(current = '') {
  const selected = normalizeCacheAction(current);
  return CACHE_ACTION_OPTIONS.map((option) => (
    `<option value="${esc(option.value)}" ${option.value === selected ? 'selected' : ''}>${esc(option.label)}</option>`
  )).join('');
}

function cacheScopeLabel(scope = '') {
  const normalized = normalizeCacheScope(scope);
  return CACHE_SCOPE_OPTIONS.find((option) => option.value === normalized)?.label || 'Visual (BG + Sprite)';
}

function cacheScopeOptions(current = '') {
  const selected = normalizeCacheScope(current);
  return CACHE_SCOPE_OPTIONS.map((option) => (
    `<option value="${esc(option.value)}" ${option.value === selected ? 'selected' : ''}>${esc(option.label)}</option>`
  )).join('');
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, asNumber(value, fallback)));
}

function normalizeBgFadeFrames(value, fallback = DEFAULT_BG_FADE_FRAMES) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = asNumber(value, fallback);
  let best = BG_FADE_SPEEDS[0].value;
  let bestDistance = Math.abs(parsed - best);
  for (const speed of BG_FADE_SPEEDS.slice(1)) {
    const distance = Math.abs(parsed - speed.value);
    if (distance < bestDistance) {
      best = speed.value;
      bestDistance = distance;
    }
  }
  return best;
}

function bgFadeOptions(current) {
  const selected = normalizeBgFadeFrames(current);
  return BG_FADE_SPEEDS.map((speed) => (
    `<option value="${speed.value}" ${speed.value === selected ? 'selected' : ''}>${esc(speed.label)}</option>`
  )).join('');
}

function nearestOption(value, options = [], fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = asNumber(value, fallback);
  if (!options.length) return fallback;
  let best = options[0];
  let bestDistance = Math.abs(parsed - best);
  for (const option of options.slice(1)) {
    const distance = Math.abs(parsed - option);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best;
}

function normalizeMessageSpeedFrames(value, fallback = DEFAULT_MESSAGE_SPEED_FRAMES) {
  return nearestOption(value, MESSAGE_SPEEDS.map((speed) => speed.value), fallback);
}

function normalizeSystemSettings(settings = {}) {
  const raw = settings && typeof settings === 'object' ? settings : {};
  return {
    messageSpeedFrames: normalizeMessageSpeedFrames(raw.messageSpeedFrames ?? raw.textSpeedFrames ?? raw.speed),
    messageAdvanceMode: String(raw.messageAdvanceMode ?? raw.advanceMode ?? raw.advance ?? 'button').trim().toLowerCase() === 'auto' ? 'auto' : 'button',
    messageAutoWaitFrames: clamp(raw.messageAutoWaitFrames ?? raw.autoWaitFrames ?? raw.autoWait, 0, 255, DEFAULT_MESSAGE_AUTO_WAIT_FRAMES),
  };
}

function safeId(value, fallback) {
  const id = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return id || fallback;
}

function uniqueSceneId(value, existingIds = [], fallback = 'scene') {
  const used = new Set(existingIds.filter(Boolean).map((id) => String(id)));
  const base = safeId(value, fallback).slice(0, 32) || fallback;
  if (!used.has(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 24)}_${Date.now().toString(36).slice(-7)}`;
}

function normalizeSceneName(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .slice(0, 96);
}

function cleanSceneNameInput(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 96);
}

function sceneDisplayName(item = {}) {
  const name = String(item.name || '').trim();
  return name || item.id || 'scene';
}

function scenePathParts(item = {}) {
  const source = String(item.name || '').trim();
  if (!source) return [String(item.id || 'scene')];
  const parts = source.split('/').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [String(item.id || 'scene')];
}

function sceneDirectoryParts(item = {}) {
  const parts = scenePathParts(item);
  return String(item.name || '').trim() && parts.length > 1 ? parts.slice(0, -1) : [];
}

function sceneLeafName(item = {}) {
  const parts = scenePathParts(item);
  return parts[parts.length - 1] || sceneDisplayName(item);
}

function sceneOptionLabel(item = {}) {
  const name = sceneDisplayName(item);
  return name === item.id ? item.id : `${name} (${item.id})`;
}

function sceneGroupPath(dirs = [], index = 0) {
  return dirs.slice(0, index + 1).join('/');
}

function sceneHasCollapsedAncestor(dirs = [], collapsedDirs = new Set(), maxDepth = dirs.length) {
  const limit = Math.min(maxDepth, dirs.length);
  for (let index = 0; index < limit; index += 1) {
    if (collapsedDirs.has(sceneGroupPath(dirs, index))) return true;
  }
  return false;
}

function buildSceneListRows(scenes = [], collapsedDirs = new Set()) {
  const rows = [];
  let activeDirs = [];
  scenes.forEach((item) => {
    const dirs = sceneDirectoryParts(item);
    let common = 0;
    while (common < dirs.length && dirs[common] === activeDirs[common]) common += 1;
    for (let index = common; index < dirs.length; index += 1) {
      if (sceneHasCollapsedAncestor(dirs, collapsedDirs, index)) continue;
      const path = sceneGroupPath(dirs, index);
      rows.push({ type: 'group', name: dirs[index], path, depth: index, collapsed: collapsedDirs.has(path) });
    }
    if (!sceneHasCollapsedAncestor(dirs, collapsedDirs)) rows.push({ type: 'scene', item, depth: dirs.length });
    activeDirs = dirs;
  });
  return rows;
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

function isCommandSkipped(command = {}) {
  return command?.skip === true || command?.skipped === true || command?.debugSkip === true;
}

function applyCommandDebugFlags(rawCommand = {}, normalizedCommand = null) {
  if (!normalizedCommand) return null;
  return isCommandSkipped(rawCommand) ? { ...normalizedCommand, skip: true } : normalizedCommand;
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
function messageParts(command = {}) {
  const speaker = String(command.speaker || '').trim();
  const text = String(command.text || '').trim();
  const prefix = speaker ? `${speaker}：\n` : '';
  return {
    prefix,
    body: text,
    full: `${prefix}${text}`,
  };
}

function messageFullText(command = {}) {
  return messageParts(command).full;
}

function messageDrawableLength(text = '') {
  return [...String(text || '')].filter((ch) => ch !== '\r' && ch !== '\n').length;
}

// pce-vn-manager.js の scene pack バイナリ仕様を反映した定数。CD scene pack v2は
// bank123の8192-byte cache、HuCard scene pack v1は4096-byte cacheへ読み込む。
// project.jsonをloadしたあとvnScenePackLimit/vnScenePackUsesShiftJisを切り替える。
// これを超えると
// ビルドが失敗する（シーン分割が必要）。下の見積りはエディタ上の早期警告で、最終的な
// 判定はビルド時の buildScenePack が行う。
const VN_CD_SCENE_PACK_LIMIT = 8192;
const VN_HUCARD_SCENE_PACK_LIMIT = 4096;
let vnScenePackLimit = VN_CD_SCENE_PACK_LIMIT;
let vnScenePackUsesShiftJis = true;
const VN_PACK_HEADER_SIZE = 20;
const VN_PACK_COMMAND_SIZE = 19;
// 13 bytes: glyphOffset(2)+glyphCount(1)+voice(2)+speed(1)+advance(1)+autoWait(1)
//           +mouthAnim(2)+mouthSlot/instantPrefix(1)+textColor(2). pce-vn-manager.js と一致させる。
const VN_PACK_MESSAGE_SIZE = 13;
const VN_PACK_CHOICE_SIZE = 6;
const VN_PACK_OPTION_SIZE = 7;
const VN_PACK_SWITCH_SIZE = 5;
const VN_PACK_SWITCH_CASE_SIZE = 4;
const VN_MAX_CHOICE_OPTIONS = 4;
const VN_MAX_SWITCH_CASES = 16;
const VN_VISUAL_CACHE_PAGE_BYTES = 8192;
const VN_VISUAL_CACHE_PAGE_COUNT = 16;
const VN_VISUAL_CACHE_TOTAL_BYTES = VN_VISUAL_CACHE_PAGE_BYTES * VN_VISUAL_CACHE_PAGE_COUNT;
const VN_ADPCM_RAM_BYTES = 65536;

// 1 シーンの scene pack バイト数を見積もる（buildScenePack と同じ加算規則）。
function estimateScenePackBytes(scene = {}) {
  // コメントとデバッグ用スキップはビルドに含まれないため byte 計算から除外する。
  const commands = (Array.isArray(scene.commands) ? scene.commands : [])
    .filter((command) => command?.type !== 'comment' && !isCommandSkipped(command));
  let messageCount = 0;
  let choiceCount = 0;
  let switchCount = 0;
  let dataBytes = 0;
  commands.forEach((command) => {
    if (command?.type === 'message') {
      messageCount += 1;
      // CD v2は各文字/改行/終端が16-bit、HuCard v1はglyph index stream。
      const glyphs = [...messageFullText(command)].filter((ch) => ch !== '\r').length;
      dataBytes += (glyphs + 1) * (vnScenePackUsesShiftJis ? 2 : 1);
    } else if (command?.type === 'choice') {
      choiceCount += 1;
      const options = (command.choices || []).slice(0, VN_MAX_CHOICE_OPTIONS);
      options.forEach((option) => {
        const glyphs = [...String(option?.label || '').replace(/[\r\n]/g, '')].length;
        dataBytes += (glyphs + 1) * (vnScenePackUsesShiftJis ? 2 : 1);
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
  const rowLimit = () => (lines.length === MESSAGE_AREA.rows ? MESSAGE_AREA.cols - 1 : MESSAGE_AREA.cols);
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
    if (col >= rowLimit()) {
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
  return previewPathCandidatesForAsset(asset)[0] || '';
}

function previewPathCandidatesForAsset(asset = {}) {
  const generated = asset?.data?.generated || {};
  const candidates = [];
  const push = (value) => {
    const path = String(value || '').trim();
    if (path && !candidates.includes(path)) candidates.push(path);
  };
  if (asset?.type === 'cdda-track') {
    push(generated.outputFile);
    push(asset.source);
  } else {
    push(asset.source);
    push(generated.outputFile);
  }
  return candidates;
}

function audioDurationSeconds(asset = {}) {
  const generated = asset?.data?.generated || {};
  if (asset?.type === 'adpcm') {
    const byteLength = Number(generated.byteLength) || 0;
    const sampleRate = Number(asset?.options?.sampleRate || generated.sampleRate) || 8000;
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

function positiveBytes(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function visualCachePayloadInfo(asset = {}) {
  const generated = asset?.data?.generated || {};
  const size = assetPixelSize(asset);
  const parts = [];
  const addParts = (kind, label, byteCount) => {
    let remaining = positiveBytes(byteCount);
    let part = 0;
    while (remaining > 0) {
      const bytes = Math.min(VN_VISUAL_CACHE_PAGE_BYTES, remaining);
      parts.push({ kind, label, part, bytes });
      remaining -= bytes;
      part += 1;
    }
  };

  if (asset?.type === 'image') {
    const tileBytes = (positiveBytes(generated.tileCount) * 32)
      || Math.max(0, Math.ceil((size.width || PCE_SCREEN_WIDTH) / 8) * Math.ceil((size.height || PCE_SCREEN_HEIGHT) / 8) * 32);
    const mapBytes = Math.max(0, positiveBytes(generated.vramBytes) - tileBytes)
      || (generated.mapVramFile ? 32 * Math.ceil((size.height || PCE_SCREEN_HEIGHT) / 8) * 2 : 0);
    addParts('bgTiles', 'BG tiles', tileBytes);
    addParts('bgMap', 'BG map', mapBytes);
  } else if (asset?.type === 'sprite') {
    const patternBytes = positiveBytes(generated.vramBytes)
      || (positiveBytes(generated.tileCount) * 128);
    addParts('spritePatterns', 'Sprite patterns', patternBytes);
  }

  return {
    bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
    pages: parts.length,
    parts,
  };
}

function adpcmRamPayloadBytes(asset = {}) {
  const generated = asset?.data?.generated || {};
  return positiveBytes(generated.byteLength || generated.dataSize || generated.size);
}

function psgPatternPreviewBytes(asset = {}) {
  const stats = psgPreviewStats(asset);
  return Math.max(0, Number(stats.entries) || 0) * 8;
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
  const rawFrameDelays = Array.isArray(anim.frameDelays) ? anim.frameDelays : [];
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
  const frameDelays = frames.map((_, frameIndex) => {
    const value = Number(rawFrameDelays[frameIndex]);
    return Math.max(1, Math.min(60, Number.isFinite(value) && value > 0 ? value : frameDelay));
  });
  return { sheetW, sheetH, frameW, frameH, frames, frameDelay, frameDelays, loop };
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
  const frameDelayAt = (i) => {
    const value = Array.isArray(geo.frameDelays) ? Number(geo.frameDelays[i]) : 0;
    return Math.max(1, Math.min(60, Number.isFinite(value) && value > 0 ? value : geo.frameDelay || 8));
  };
  const frameMsAt = (i) => frameDelayAt(i) * (1000 / 60);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let idx = 0;
  let prev = now();
  let acc = 0;
  const step = () => {
    if (!node.isConnected) return;
    const t = now();
    acc += t - prev;
    prev = t;
    while (acc >= frameMsAt(idx)) {
      acc -= frameMsAt(idx);
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
    if (!command || isCommandSkipped(command)) continue;
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
    } else if (command.type === 'spritemove' && !fullScreenBg) {
      const sprite = state.sprites[command.slot];
      if (sprite) {
        sprite.x = command.x;
        sprite.y = command.y;
        if (command.animationId && (!command.animationAssetId || command.animationAssetId === sprite.assetId)) {
          sprite.animationId = command.animationId;
        }
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
          blinkFrames: command.blinkFrames || 0,
          blinkTimer: 0,
          blinkOn: true,
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
    return { type: 'background', assetId: first('image'), transition: 'fade', fadeOutFrames: DEFAULT_BG_FADE_FRAMES, fadeInFrames: DEFAULT_BG_FADE_FRAMES, x: DEFAULT_BG_TILE_X, y: DEFAULT_BG_TILE_Y };
  }
  if (type === 'sprite') {
    const assetId = first('sprite');
    return { type: 'sprite', slot: 0, assetId, x: 128, y: DEFAULT_CHARACTER_Y, animationId: 'default', flipX: false, flipY: false, visible: true };
  }
  if (type === 'spritemove') {
    return { type: 'spritemove', slot: 0, x: 128, y: DEFAULT_CHARACTER_Y, frames: 30, async: false, animationAssetId: '', animationId: '' };
  }
  if (type === 'audio') {
    return { type: 'audio', kind: 'cdda', action: 'play', assetId: first('cdda-track'), channel: 0 };
  }
  if (type === 'inputcheck') {
    return { type: 'inputcheck', buttons: ['i'], mode: 'sync', targetLabel: '' };
  }
  if (type === 'cache') {
    return { type: 'cache', action: 'clear', scope: 'visual', assetId: '', slot: 0, x: 0, y: 0 };
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
  if (type === 'comment') {
    return { type: 'comment', text: '' };
  }
  return {
    type: 'message',
    speaker: '',
    text: 'メッセージを入力してください。',
    textColor: '',
    voiceAssetId: first('adpcm'),
    mouthSlot: 0,
    mouthAnimationId: '',
  };
}

function defaultDoc(assets = []) {
  return {
    version: 2,
    settings: normalizeSystemSettings(),
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
  if (raw.type && !COMMAND_DEFINITIONS.some((definition) => definition.type === raw.type)) return null;
  if (raw.type === 'background') {
    const asset = byId(raw.assetId);
    return {
      type: 'background',
      assetId: asset?.type === 'image' ? asset.id : assets.find((entry) => entry.type === 'image')?.id || '',
      transition: 'fade',
      fadeOutFrames: normalizeBgFadeFrames(raw.fadeOutFrames),
      fadeInFrames: normalizeBgFadeFrames(raw.fadeInFrames),
      x: clamp(raw.x ?? raw.tileX ?? raw.mapX, 0, 63, DEFAULT_BG_TILE_X),
      y: clamp(raw.y ?? raw.tileY ?? raw.mapY, 0, 31, DEFAULT_BG_TILE_Y),
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
      visible: raw.visible !== false,
    };
  }
  if (raw.type === 'spritemove') {
    const animationId = String(raw.animationId || '').trim().slice(0, 32);
    const animationAssetId = String(raw.animationAssetId || raw.assetId || '').trim();
    return {
      type: 'spritemove',
      slot: clamp(raw.slot, 0, 3, 0),
      x: clamp(raw.x, 0, 319, 0),
      y: clamp(raw.y, 0, 223, 0),
      frames: clamp(raw.frames ?? raw.durationFrames, 1, 65535, 30),
      async: raw.async === true || raw.mode === 'async',
      animationAssetId: animationId ? animationAssetId : '',
      animationId,
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
      ...(kind === 'psg' && action === 'stop'
        ? { target: raw.target === 'bgm' || raw.target === 'sfx' ? raw.target : 'all' }
        : {}),
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
  if (raw.type === 'cache') {
    const action = normalizeCacheAction(raw.action);
    const rawScope = normalizeCacheScope(raw.scope);
    if (action === 'load') {
      const asset = byId(raw.assetId);
      let scope = rawScope;
      if (scope === 'visual') {
        if (asset?.type === 'image') scope = 'bg';
        else if (asset?.type === 'sprite') scope = 'sprite';
        else if (asset?.type === 'psg-song' || asset?.type === 'psg-sfx') scope = 'psg';
      }
      const valid = (scope === 'bg' && asset?.type === 'image')
        || (scope === 'sprite' && asset?.type === 'sprite')
        || (scope === 'adpcm' && asset?.type === 'adpcm')
        || (scope === 'psg' && (asset?.type === 'psg-song' || asset?.type === 'psg-sfx'));
      return {
        type: 'cache',
        action: 'load',
        scope,
        assetId: valid ? asset.id : '',
        slot: clamp(raw.slot, 0, 3, 0),
        x: clamp(raw.x ?? raw.tileX ?? raw.mapX, 0, 63, 0),
        y: clamp(raw.y ?? raw.tileY ?? raw.mapY, 0, 31, 0),
      };
    }
    return {
      type: 'cache',
      action: 'clear',
      scope: rawScope,
    };
  }
  if (raw.type === 'comment') {
    return {
      type: 'comment',
      text: String(raw.text == null ? '' : raw.text).slice(0, 200),
      color: normalizeFreeHex(raw.color) || '',
    };
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
    mouthSlot: clamp(raw.mouthSlot, 0, 3, 0),
    mouthAnimationId: String(raw.mouthAnimationId || '').trim().slice(0, 32),
  };
}

function normalizeDoc(doc, assets) {
  const fallback = defaultDoc(assets);
  const rawScenes = Array.isArray(doc?.scenes) && doc.scenes.length ? doc.scenes : fallback.scenes;
  const scenes = rawScenes.map((scene, index) => {
    const commands = Array.isArray(scene?.commands)
      ? scene.commands
        .map((command, commandIndex) => applyCommandDebugFlags(command, normalizeCommand(command, assets, commandIndex)))
        .filter(Boolean)
      : [];
    const name = normalizeSceneName(scene?.name ?? scene?.title ?? scene?.label ?? '');
    return {
      id: safeId(scene?.id, index === 0 ? 'opening' : `scene_${index + 1}`),
      ...(name ? { name } : {}),
      fullScreenBg: scene?.fullScreenBg === true
        || scene?.fullscreenBg === true
        || scene?.fullScreenBackground === true
        || ['fullscreenbg', 'full-screen-bg', 'fullscreen', 'full'].includes(String(scene?.layout || scene?.displayMode || '').trim().toLowerCase()),
      commands,
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
  const startScene = safeId(doc?.startScene, '');
  return {
    version: 2,
    settings: normalizeSystemSettings(doc?.settings || doc?.systemSettings || doc?.system),
    startScene: sceneIds.has(startScene) ? startScene : deduped[0]?.id || 'opening',
    scenes: deduped.map((scene) => ({
      ...scene,
      nextSceneId: scene.nextSceneId && sceneIds.has(scene.nextSceneId) ? scene.nextSceneId : '',
      commands: (() => {
        const labels = new Set((scene.commands || [])
          .filter((command) => command.type === 'label' && command.name)
          .map((command) => command.name));
        return (scene.commands || []).map((command) => {
        if (command.type === 'jump') {
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
  const settings = data.doc.settings || {};
  const messageWaitGlyph = String(data.messageWaitGlyph || '▼').slice(0, 1) || '▼';
  const messageSpeedFrameOptions = [0, 10, 20, 30, 40, 50];
  const rawMessageSpeedFrames = Number(settings.messageSpeedFrames);
  const messageSpeedFrames = Number.isFinite(rawMessageSpeedFrames)
    ? messageSpeedFrameOptions.reduce((best, option) => (
      Math.abs(option - rawMessageSpeedFrames) < Math.abs(best - rawMessageSpeedFrames) ? option : best
    ), 10)
    : 10;
  const messageAdvanceMode = settings.messageAdvanceMode === 'auto' ? 'auto' : 'button';
  const rawMessageAutoWaitFrames = Number(settings.messageAutoWaitFrames);
  const messageAutoWaitFrames = Number.isFinite(rawMessageAutoWaitFrames) ? Math.max(0, Math.min(255, rawMessageAutoWaitFrames | 0)) : 60;
  const SCREEN_W = (data.screen && data.screen.w) || 256;
  const SCREEN_H = (data.screen && data.screen.h) || 224;
  const MSG = data.message || { x: 24, y: 152, cols: 17, rows: 4, cellW: 12, cellH: 16 };
  const bgFadeFrameOptions = [10, 20, 30, 40, 50, 60];
  const scenesById = {};
  (data.doc.scenes || []).forEach((s) => { scenesById[s.id] = s; });
  function isSkippedCommand(command) {
    return command && (command.skip === true || command.skipped === true || command.debugSkip === true);
  }

  const style = document.createElement('style');
  style.textContent = [
    'html,body{margin:0;height:100%;background:#05070a;color:#e8eef5;font-family:system-ui,-apple-system,sans-serif;overflow:hidden;}',
    '#pv-root{position:fixed;inset:0;display:flex;flex-direction:column;}',
    '#pv-stage-wrap{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;position:relative;}',
    '#pv-stage{position:relative;width:' + SCREEN_W + 'px;height:' + SCREEN_H + 'px;background:#000;transform-origin:center center;overflow:hidden;box-shadow:0 0 0 1px #000,0 10px 36px rgba(0,0,0,.6);}',
    '#pv-stage img{position:absolute;image-rendering:pixelated;transform-origin:top left;}',
    '#pv-msg{position:absolute;left:' + MSG.x + 'px;top:' + MSG.y + 'px;width:' + (MSG.cols * MSG.cellW) + 'px;height:' + (MSG.rows * MSG.cellH) + 'px;display:flex;flex-direction:column;}',
    '.pv-row{height:' + MSG.cellH + 'px;display:flex;}',
    '.pv-cell{width:' + MSG.cellW + 'px;height:' + MSG.cellH + 'px;line-height:' + MSG.cellH + 'px;font-size:11px;text-align:center;color:inherit;text-shadow:0 1px 2px rgba(0,0,0,.9);overflow:hidden;}',
    '.pv-wait-cursor{animation:pv-wait-cursor 1s steps(1,end) infinite;}',
    '#pv-msg.pv-hidden,#pv-choice.pv-hidden{display:none;}',
    '#pv-effect{position:absolute;inset:0;z-index:20;pointer-events:none;opacity:0;background:#fff;}',
    '#pv-choice{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;gap:6px;min-width:140px;}',
    '#pv-choice button{font:inherit;font-size:12px;padding:6px 14px;border-radius:4px;border:1px solid rgba(120,160,210,.6);background:rgba(8,14,24,.92);color:#e8eef5;cursor:pointer;}',
    '#pv-choice button.pv-active,#pv-choice button:hover{border-color:#8fd0ff;background:rgba(40,80,130,.7);}',
    '#pv-bar{height:34px;display:flex;align-items:center;gap:12px;padding:0 12px;background:#0b1118;border-top:1px solid #1d2733;font-size:11px;color:#9fb0c0;flex:none;}',
    '#pv-bar button{font:inherit;font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid #2a3a4a;background:#13202c;color:#cfe0ee;cursor:pointer;}',
    '#pv-hint{margin-left:auto;color:#6b7a88;}',
    '#pv-debug{position:absolute;right:12px;top:12px;width:220px;max-height:calc(100% - 24px);overflow:auto;background:rgba(5,10,18,.86);border:1px solid rgba(125,160,205,.35);border-radius:6px;color:#cfe0ee;font-size:11px;line-height:1.35;box-shadow:0 8px 24px rgba(0,0,0,.35);}',
    '#pv-debug.pv-hidden{display:none;}',
    '#pv-debug section+section{border-top:1px solid rgba(125,160,205,.22);}',
    '#pv-debug h2{margin:0;padding:7px 9px;border-bottom:1px solid rgba(125,160,205,.22);font-size:11px;color:#f3f8ff;}',
    '#pv-vars{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;padding:7px 9px;}',
    '.pv-var-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fb0c0;}',
    '.pv-var-value{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffffff;text-align:right;}',
    '.pv-var-empty{grid-column:1 / -1;color:#6b7a88;}',
    '#pv-cache{display:grid;gap:7px;padding:7px 9px;}',
    '.pv-cache-row{display:grid;gap:3px;}',
    '.pv-cache-line{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;}',
    '.pv-cache-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fb0c0;}',
    '.pv-cache-value{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;text-align:right;white-space:nowrap;}',
    '.pv-cache-meter{height:5px;overflow:hidden;border-radius:999px;background:rgba(125,160,205,.18);}',
    '.pv-cache-fill{height:100%;width:0;background:#55d68b;}',
    '.pv-cache-fill.pv-warn{background:#f6c453;}',
    '.pv-cache-fill.pv-danger{background:#f26b6b;}',
    '.pv-cache-detail{color:#6f8193;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.pv-cache-event{color:#cfe0ee;border-top:1px solid rgba(125,160,205,.16);padding-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#pv-debug-toggle{display:inline-flex;align-items:center;gap:5px;color:#cfe0ee;cursor:pointer;user-select:none;}',
    '#pv-debug-toggle input{margin:0;}',
    '.pv-shake{animation:pv-shake .4s linear;}',
    '.pv-hidden-layer{display:none;}',
    '@keyframes pv-wait-cursor{0%,49.999%{opacity:1}50%,100%{opacity:0}}',
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
    + '</div><aside id="pv-debug" class="pv-hidden"><section><h2>Variables</h2><div id="pv-vars"></div></section><section><h2>Cache</h2><div id="pv-cache"></div></section></aside></div>'
    + '<div id="pv-bar"><button id="pv-restart">最初から</button><span id="pv-scene"></span>'
    + '<label id="pv-fast-forward-toggle" title="メッセージを即時表示してページ送り"><input id="pv-fast-forward" type="checkbox" /><span>早送り</span></label>'
    + '<label id="pv-debug-toggle" title="Preview debug"><input id="pv-debug-vars" type="checkbox" /><span>Debug</span></label>'
    + '<span id="pv-hint">クリック / Enter で進む ・ Esc で閉じる</span></div>';
  document.body.appendChild(root);

  const stage = root.querySelector('#pv-stage');
  const stageWrap = root.querySelector('#pv-stage-wrap');
  const msgBox = root.querySelector('#pv-msg');
  const choiceBox = root.querySelector('#pv-choice');
  const effectLayer = root.querySelector('#pv-effect');
  const sceneLabel = root.querySelector('#pv-scene');
  const debugBox = root.querySelector('#pv-debug');
  const debugToggle = root.querySelector('#pv-debug-vars');
  const varsBox = root.querySelector('#pv-vars');
  const cacheBox = root.querySelector('#pv-cache');

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
  let messageFastForward = false;
  let activeMessageFastForward = null;
  const spriteMoveTimers = new Map();
  let spriteTextBlinkRaf = 0;
  let spriteTextBlinkPrev = 0;
  let spriteTextBlinkAcc = 0;
  let pending = null;
  let choiceState = null;
  const audio = { cdda: null, adpcm: null };
  const blockedAudio = { cdda: false, adpcm: false };
  const PSG_CLOCK = 3579545;
  const PSG_CHANNEL_COUNT = 6;
  let psgAudioContext = null;
  let psgState = null;
  const variableInitialValues = {};
  const variableNames = [];

  function psgClampInt(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
  }
  function psgFramesPerStep(bpm) {
    const value = psgClampInt(bpm, 30, 300, 150);
    return 3600 / (value * 4);
  }
  function psgFrequencyFromPeriod(period) {
    const raw = Number(period);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.max(40, Math.min(8000, PSG_CLOCK / (32 * raw)));
  }
  function psgNoteToPeriod(note) {
    const base = { C: 1024, D: 912, E: 812, F: 768, G: 684, A: 608, B: 542 };
    const name = String(note || 'C4').slice(0, 1).toUpperCase();
    const octave = Number(String(note || 'C4').slice(1)) || 4;
    const shift = Math.max(-2, Math.min(3, 4 - octave));
    return Math.max(32, Math.min(4095, Math.round((base[name] || 1024) * (2 ** shift))));
  }
  function normalizePsgPattern(assetId) {
    const meta = data.meta[assetId] || {};
    const options = meta.psgOptions || {};
    const rawPattern = Array.isArray(options.pattern) ? options.pattern : [];
    if (!rawPattern.length) {
      const period = psgClampInt(options.period, 1, 4095, 512);
      return period ? [{ step: 0, channel: 0, period, volume: 16, noise: 0 }] : [];
    }
    return rawPattern.map((entry, index) => {
      const raw = entry && typeof entry === 'object' ? entry : {};
      const hasNote = typeof raw.note === 'string' && raw.note.trim();
      const fallbackPeriod = hasNote ? psgNoteToPeriod(raw.note) : 0;
      const period = raw.period == null ? fallbackPeriod : psgClampInt(raw.period, 0, 4095, fallbackPeriod);
      const volumeFallback = period > 0 ? 16 : 0;
      return {
        step: psgClampInt(raw.step == null ? index : raw.step, 0, 4095, index),
        channel: psgClampInt(raw.channel, 0, PSG_CHANNEL_COUNT - 1, 0),
        period,
        volume: psgClampInt(raw.volume, 0, 31, volumeFallback),
        noise: psgClampInt(raw.noise, 0, 1, 0),
      };
    });
  }
  function expandPsgRows(assetId) {
    const meta = data.meta[assetId] || {};
    const options = meta.psgOptions || {};
    const steps = psgClampInt(options.steps, 1, 4096, 16);
    const byStep = Array.from({ length: steps }, () => []);
    normalizePsgPattern(assetId).forEach((entry) => {
      if (entry.step >= 0 && entry.step < steps) byStep[entry.step].push(entry);
    });
    const state = Array.from({ length: PSG_CHANNEL_COUNT }, () => ({ period: 0, volume: 0, noise: 0 }));
    return byStep.map((entries) => {
      entries.forEach((entry) => {
        state[entry.channel] = { period: entry.period, volume: entry.volume, noise: entry.noise };
      });
      return state.map((cell) => ({ ...cell }));
    });
  }
  function rememberPsgNode(node) {
    if (!psgState || !node) return;
    psgState.nodes.push(node);
    node.onended = () => {
      if (!psgState) return;
      psgState.nodes = psgState.nodes.filter((entry) => entry !== node);
    };
  }
  function schedulePsgEnvelope(gain, start, duration, level) {
    const end = start + Math.max(0.02, duration);
    gain.gain.cancelScheduledValues(start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.006);
    gain.gain.setValueAtTime(level, Math.max(start + 0.008, end - 0.018));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  function schedulePsgTone(cell, start, duration) {
    const frequency = psgFrequencyFromPeriod(cell.period);
    if (!frequency || !psgAudioContext) return;
    const osc = psgAudioContext.createOscillator();
    const gain = psgAudioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(frequency, start);
    schedulePsgEnvelope(gain, start, duration, Math.min(0.12, (cell.volume / 31) * 0.1));
    osc.connect(gain).connect(psgAudioContext.destination);
    osc.start(start);
    osc.stop(start + duration);
    rememberPsgNode(osc);
  }
  function schedulePsgNoise(cell, start, duration) {
    if (!psgAudioContext) return;
    const playDuration = Math.min(duration, 0.12);
    const sampleRate = psgAudioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * playDuration));
    const buffer = psgAudioContext.createBuffer(1, length, sampleRate);
    const samples = buffer.getChannelData(0);
    const noiseHz = psgNoiseHzFromValue(cell.period & 0x1f);
    const holdSamples = Math.max(1, Math.round(sampleRate / noiseHz));
    let lfsr = 0x7fff;
    let out = 1;
    let counter = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (counter <= 0) {
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        out = (lfsr & 1) ? 1 : -1;
        counter = holdSamples;
      }
      counter -= 1;
      samples[i] = out;
    }
    const source = psgAudioContext.createBufferSource();
    const gain = psgAudioContext.createGain();
    source.buffer = buffer;
    schedulePsgEnvelope(gain, start, playDuration, Math.min(0.08, (cell.volume / 31) * 0.07));
    source.connect(gain).connect(psgAudioContext.destination);
    source.start(start);
    source.stop(start + playDuration);
    rememberPsgNode(source);
  }
  function schedulePsgStep() {
    const stateRef = psgState;
    if (!stateRef || !psgAudioContext) return;
    if (stateRef.step >= stateRef.rows.length) {
      if (!stateRef.loop) { stopPsgPreview(); return; }
      stateRef.step = 0;
    }
    const row = stateRef.rows[stateRef.step] || [];
    const start = psgAudioContext.currentTime + 0.012;
    row.forEach((cell, channel) => {
      if (!cell || cell.volume <= 0 || cell.period <= 0) return;
      if (cell.noise && channel >= 4) schedulePsgNoise(cell, start, stateRef.stepSeconds);
      else schedulePsgTone(cell, start, stateRef.stepSeconds * 0.96);
    });
    stateRef.step += 1;
    const timer = setTimeout(() => {
      if (psgState) psgState.timers = psgState.timers.filter((entry) => entry !== timer);
      schedulePsgStep();
    }, Math.max(20, stateRef.stepSeconds * 1000));
    stateRef.timers.push(timer);
  }
  function stopPsgPreview() {
    const stateRef = psgState;
    psgState = null;
    if (!stateRef) return;
    stateRef.timers.forEach((timer) => clearTimeout(timer));
    stateRef.nodes.forEach((node) => {
      try { node.stop?.(); } catch (_) {}
      try { node.disconnect?.(); } catch (_) {}
    });
  }
  async function playPsgPreview(assetId, loop) {
    if (!assetId || !data.meta[assetId]) return;
    stopPsgPreview();
    const rows = expandPsgRows(assetId);
    if (!rows.some((row) => row.some((cell) => cell.volume > 0 && cell.period > 0))) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    psgAudioContext = psgAudioContext || new AudioCtor();
    if (psgAudioContext.state === 'suspended') await psgAudioContext.resume();
    const meta = data.meta[assetId] || {};
    const options = meta.psgOptions || {};
    psgState = {
      rows,
      step: 0,
      loop: loop != null ? Boolean(loop) : meta.type === 'psg-song',
      stepSeconds: psgFramesPerStep(options.bpm || 150) / 60,
      timers: [],
      nodes: [],
    };
    schedulePsgStep();
  }

  function rememberVariable(name, initialValue, isDefinition) {
    const key = String(name || '').trim();
    if (!key) return;
    if (!Object.prototype.hasOwnProperty.call(variableInitialValues, key)) {
      variableNames.push(key);
      variableInitialValues[key] = 0;
    }
    if (isDefinition) variableInitialValues[key] = s16(initialValue);
  }

  (data.doc.scenes || []).forEach((item) => {
    (item.commands || []).forEach((command) => {
      if (isSkippedCommand(command)) return;
      if (command.type === 'variable') rememberVariable(command.variableName, command.value, command.operation === 'define');
      else if (command.type === 'choice') rememberVariable(command.variableName, 0, false);
      else if (command.type === 'if' || command.type === 'switch') rememberVariable(command.variableName, 0, false);
    });
  });

  function s16(value) {
    let v = Number(value) | 0;
    v = ((v + 32768) & 0xffff) - 32768;
    return v;
  }
  function getVar(name) { return vars[name] || 0; }
  function initialVars() {
    const result = {};
    variableNames.forEach((name) => { result[name] = s16(variableInitialValues[name]); });
    return result;
  }
  const runtimeCache = data.runtimeCache || {};
  const visualCachePageBytes = Math.max(1, Number(runtimeCache.visualPageBytes) || 8192);
  const visualCachePageCount = Math.max(0, Number(runtimeCache.visualPageCount) || 0);
  const visualCacheTotalBytes = visualCachePageBytes * visualCachePageCount;
  const adpcmRamBytes = Math.max(0, Number(runtimeCache.adpcmRamBytes) || 65536);
  const scenePackLimitBytes = Math.max(1, Number(runtimeCache.scenePackLimitBytes) || 4096);
  let cacheState = null;

  function resetPreviewCacheState() {
    cacheState = {
      visualEntries: [],
      visualClock: 0,
      visualEvictions: 0,
      adpcm: null,
      psg: null,
      glyphInvalidated: false,
      lastEvent: 'Cache simulator ready',
    };
  }
  function htmlEsc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }
  function formatPreviewBytes(value) {
    const bytes = Math.max(0, Math.round(Number(value) || 0));
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1) + ' KB';
    return bytes + ' B';
  }
  function pctClass(used, total) {
    if (!total) return '';
    const pct = used / total;
    if (pct >= 0.95) return ' pv-danger';
    if (pct >= 0.8) return ' pv-warn';
    return '';
  }
  function cacheScopeName(scope) {
    if (scope === 'bg') return 'BG';
    if (scope === 'sprite') return 'Sprite';
    if (scope === 'adpcm') return 'ADPCM';
    if (scope === 'psg') return 'PSG';
    if (scope === 'all') return 'All';
    return 'Visual';
  }
  function normalizedCacheScope(scope) {
    return ['visual', 'bg', 'sprite', 'adpcm', 'psg', 'all'].includes(scope) ? scope : 'visual';
  }
  function cacheEntryMatchesScope(entry, scope) {
    const kind = entry && entry.kind;
    if (scope === 'visual' || scope === 'all') return kind === 'bgTiles' || kind === 'bgMap' || kind === 'spritePatterns';
    if (scope === 'bg') return kind === 'bgTiles' || kind === 'bgMap';
    if (scope === 'sprite') return kind === 'spritePatterns';
    return false;
  }
  function visualPartsForAsset(assetId, scope) {
    const normalizedScope = normalizedCacheScope(scope);
    const meta = data.meta[assetId] || {};
    const parts = Array.isArray(meta.visualCacheParts) ? meta.visualCacheParts : [];
    return parts
      .map((part) => ({
        kind: String(part.kind || ''),
        label: String(part.label || part.kind || 'payload'),
        part: Math.max(0, Number(part.part) || 0),
        bytes: Math.max(0, Number(part.bytes) || 0),
        assetId,
      }))
      .filter((part) => part.bytes > 0 && cacheEntryMatchesScope(part, normalizedScope));
  }
  function cacheAssetLabel(assetId) {
    const meta = data.meta[assetId] || {};
    return meta.name || assetId || '-';
  }
  function visualCacheKey(part) {
    return [part.kind, part.assetId, part.part].join(':');
  }
  function touchVisualEntry(entry) {
    if (!cacheState || !entry) return;
    cacheState.visualClock += 1;
    entry.lru = cacheState.visualClock;
  }
  function findVisualEntry(part) {
    const key = visualCacheKey(part);
    return cacheState.visualEntries.find((entry) => entry.key === key) || null;
  }
  function loadVisualCacheAsset(assetId, scope) {
    const parts = visualPartsForAsset(assetId, scope);
    const label = cacheAssetLabel(assetId);
    if (!parts.length) {
      cacheState.lastEvent = 'Load ' + cacheScopeName(scope) + ' ' + label + ': no payload metadata';
      updateCacheDebug();
      return;
    }
    let hits = 0;
    let loaded = 0;
    let evicted = 0;
    parts.forEach((part) => {
      const existing = findVisualEntry(part);
      if (existing) {
        hits += 1;
        touchVisualEntry(existing);
        return;
      }
      if (visualCachePageCount <= 0) return;
      if (cacheState.visualEntries.length >= visualCachePageCount) {
        let victimIndex = 0;
        for (let i = 1; i < cacheState.visualEntries.length; i += 1) {
          if ((cacheState.visualEntries[i].lru || 0) < (cacheState.visualEntries[victimIndex].lru || 0)) victimIndex = i;
        }
        cacheState.visualEntries.splice(victimIndex, 1);
        cacheState.visualEvictions += 1;
        evicted += 1;
      }
      const entry = {
        key: visualCacheKey(part),
        kind: part.kind,
        assetId: part.assetId,
        part: part.part,
        bytes: part.bytes,
        label: label + ' ' + part.label + ' #' + part.part,
        lru: 0,
      };
      cacheState.visualEntries.push(entry);
      touchVisualEntry(entry);
      loaded += 1;
    });
    cacheState.lastEvent = 'Load ' + cacheScopeName(scope) + ' ' + label
      + ': ' + loaded + ' page(s), ' + hits + ' hit' + (evicted ? ', ' + evicted + ' evict' : '');
    updateCacheDebug();
  }
  function visualCacheHasAsset(assetId, scope) {
    const parts = visualPartsForAsset(assetId, scope);
    if (!parts.length) return { known: false, hit: false, missing: 0, total: 0 };
    let missing = 0;
    parts.forEach((part) => {
      const entry = findVisualEntry(part);
      if (entry) touchVisualEntry(entry);
      else missing += 1;
    });
    return { known: true, hit: missing === 0, missing, total: parts.length };
  }
  function recordVisualDisplay(assetId, scope, labelPrefix) {
    if (!assetId) return;
    const label = cacheAssetLabel(assetId);
    const result = visualCacheHasAsset(assetId, scope);
    if (!result.known) {
      cacheState.lastEvent = labelPrefix + ' ' + label + ': no cache payload metadata';
    } else if (result.hit) {
      cacheState.lastEvent = labelPrefix + ' ' + label + ': RAM cache hit';
    } else {
      cacheState.lastEvent = labelPrefix + ' ' + label + ': CD fallback (' + result.missing + '/' + result.total + ' page(s) missing)';
    }
    updateCacheDebug();
  }
  function loadAdpcmCacheAsset(assetId, labelPrefix) {
    const meta = data.meta[assetId] || {};
    const bytes = Math.max(0, Number(meta.adpcmBytes) || 0);
    const label = cacheAssetLabel(assetId);
    if (!bytes) {
      cacheState.lastEvent = labelPrefix + ' ADPCM ' + label + ': no payload metadata';
      updateCacheDebug();
      return;
    }
    cacheState.adpcm = { assetId, bytes, label };
    cacheState.lastEvent = labelPrefix + ' ADPCM ' + label + ': ' + formatPreviewBytes(bytes);
    updateCacheDebug();
  }
  function psgPatternPreviewStats(assetId) {
    const meta = data.meta[assetId] || {};
    const entries = normalizePsgPattern(assetId).length;
    const bytes = Math.max(0, Number(meta.psgPatternBytes) || (entries * 8));
    return { entries, bytes };
  }
  function loadPsgCacheAsset(assetId, labelPrefix) {
    const meta = data.meta[assetId] || {};
    const label = cacheAssetLabel(assetId);
    if (meta.type !== 'psg-song' && meta.type !== 'psg-sfx') {
      cacheState.lastEvent = labelPrefix + ' PSG ' + label + ': no pattern metadata';
      updateCacheDebug();
      return;
    }
    const stats = psgPatternPreviewStats(assetId);
    cacheState.psg = { assetId, bytes: stats.bytes, label, entries: stats.entries };
    cacheState.lastEvent = labelPrefix + ' PSG ' + label + ': '
      + stats.entries + ' event(s), ' + formatPreviewBytes(stats.bytes);
    updateCacheDebug();
  }
  function recordAdpcmUse(assetId, labelPrefix) {
    if (!assetId) return;
    const label = cacheAssetLabel(assetId);
    if (cacheState.adpcm && cacheState.adpcm.assetId === assetId) {
      cacheState.lastEvent = labelPrefix + ' ' + label + ': ADPCM RAM hit';
      updateCacheDebug();
      return;
    }
    const meta = data.meta[assetId] || {};
    const bytes = Math.max(0, Number(meta.adpcmBytes) || 0);
    if (!bytes) {
      cacheState.lastEvent = labelPrefix + ' ' + label + ': no ADPCM payload metadata';
      updateCacheDebug();
      return;
    }
    cacheState.adpcm = { assetId, bytes, label };
    cacheState.lastEvent = labelPrefix + ' ' + label + ': CD load (' + formatPreviewBytes(bytes) + ')';
    updateCacheDebug();
  }
  function clearPreviewRuntimeCache(scope) {
    const normalizedScope = normalizedCacheScope(scope);
    if (normalizedScope === 'visual' || normalizedScope === 'bg' || normalizedScope === 'sprite' || normalizedScope === 'all') {
      cacheState.visualEntries = cacheState.visualEntries.filter((entry) => !cacheEntryMatchesScope(entry, normalizedScope));
    }
    if (normalizedScope === 'adpcm' || normalizedScope === 'all') cacheState.adpcm = null;
    if (normalizedScope === 'psg' || normalizedScope === 'all') cacheState.psg = null;
    if (normalizedScope === 'all') cacheState.glyphInvalidated = true;
    cacheState.lastEvent = 'Clear ' + cacheScopeName(normalizedScope) + ' cache';
    updateCacheDebug();
  }
  function handleCacheCommand(c) {
    const action = c.action === 'load' ? 'load' : 'clear';
    const scope = normalizedCacheScope(c.scope);
    if (action === 'clear') {
      clearPreviewRuntimeCache(scope);
      return;
    }
    if (scope === 'bg' || scope === 'sprite' || scope === 'visual') {
      loadVisualCacheAsset(c.assetId, scope);
    } else if (scope === 'adpcm') {
      loadAdpcmCacheAsset(c.assetId, 'Load');
    } else if (scope === 'psg') {
      loadPsgCacheAsset(c.assetId, 'Load');
    } else {
      cacheState.lastEvent = 'Load ' + cacheScopeName(scope) + ': no preview action';
      updateCacheDebug();
    }
  }
  function meterRow(label, used, total, detail, basisUsed) {
    const safeTotal = Math.max(1, Number(total) || 1);
    const meterUsed = Math.max(0, Number(basisUsed == null ? used : basisUsed) || 0);
    const width = Math.max(0, Math.min(100, (meterUsed / safeTotal) * 100));
    return '<div class="pv-cache-row">'
      + '<div class="pv-cache-line"><span class="pv-cache-label">' + htmlEsc(label) + '</span><span class="pv-cache-value">'
      + htmlEsc(formatPreviewBytes(used)) + ' / ' + htmlEsc(formatPreviewBytes(total)) + '</span></div>'
      + '<div class="pv-cache-meter"><div class="pv-cache-fill' + pctClass(meterUsed, safeTotal) + '" style="width:' + width.toFixed(1) + '%"></div></div>'
      + '<div class="pv-cache-detail">' + htmlEsc(detail) + '</div>'
      + '</div>';
  }
  function updateCacheDebug() {
    if (!cacheBox || !cacheState) return;
    const visualPages = cacheState.visualEntries.length;
    const visualDataBytes = cacheState.visualEntries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0);
    const visualPageBytesUsed = visualPages * visualCachePageBytes;
    const visualFreeBytes = Math.max(0, visualCacheTotalBytes - visualPageBytesUsed);
    const adpcmUsed = cacheState.adpcm ? cacheState.adpcm.bytes : 0;
    const psgUsed = cacheState.psg ? cacheState.psg.bytes : 0;
    const psgDetail = cacheState.psg
      ? cacheState.psg.label + ', ' + cacheState.psg.entries + ' event(s)'
      : 'empty';
    const sceneBytesMap = data.scenePackBytesById || {};
    const scenePackUsed = Math.max(0, Number(sceneBytesMap[scene?.id]) || 0);
    const rows = [
      meterRow('Visual RAM', visualDataBytes, visualCacheTotalBytes,
        visualPages + '/' + visualCachePageCount + ' page(s), free ' + formatPreviewBytes(visualFreeBytes) + ', evict ' + cacheState.visualEvictions,
        visualPageBytesUsed),
      meterRow('ADPCM RAM', adpcmUsed, adpcmRamBytes,
        'free ' + formatPreviewBytes(Math.max(0, adpcmRamBytes - adpcmUsed)) + (cacheState.adpcm ? ', ' + cacheState.adpcm.label : ''),
        adpcmUsed),
      meterRow('PSG pattern', psgUsed, 16 * 1024,
        psgDetail,
        psgUsed),
      meterRow('Scene pack', scenePackUsed, scenePackLimitBytes,
        'free ' + formatPreviewBytes(Math.max(0, scenePackLimitBytes - scenePackUsed)),
        scenePackUsed),
    ];
    if (cacheState.glyphInvalidated) rows.push('<div class="pv-cache-detail">Message glyph cache invalidated</div>');
    rows.push('<div class="pv-cache-event" title="' + htmlEsc(cacheState.lastEvent) + '">' + htmlEsc(cacheState.lastEvent) + '</div>');
    cacheBox.innerHTML = rows.join('');
  }
  function updateVarDebug() {
    if (!varsBox) return;
    if (!variableNames.length) {
      varsBox.innerHTML = '<span class="pv-var-empty">未定義</span>';
      return;
    }
    varsBox.innerHTML = variableNames.map((name) => (
      '<span class="pv-var-name" title="' + name.replace(/"/g, '&quot;') + '">' + name + '</span>'
      + '<span class="pv-var-value">' + String(getVar(name)) + '</span>'
    )).join('');
  }
  function setVarDebugVisible(visible) {
    if (debugBox) debugBox.classList.toggle('pv-hidden', !visible);
  }
  function setMessageFastForward(enabled) {
    messageFastForward = Boolean(enabled);
    if (messageFastForward && typeof activeMessageFastForward === 'function') activeMessageFastForward();
    updateAudioHint();
  }
  function bgFadeFrames(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 30;
    return bgFadeFrameOptions.reduce((best, option) => (
      Math.abs(option - parsed) < Math.abs(best - parsed) ? option : best
    ), 30);
  }
  function frameMs(frames) {
    return Math.max(0, Number(frames) || 0) * 1000 / 60;
  }
  function clearTimers() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }
  function cancelSpriteMove(slot) {
    const move = spriteMoveTimers.get(slot);
    if (!move) return;
    clearInterval(move.timer);
    spriteMoveTimers.delete(slot);
  }
  function cancelAllSpriteMoves() {
    [...spriteMoveTimers.keys()].forEach(cancelSpriteMove);
  }
  function startSpriteMove(c, onComplete) {
    const slot = Math.max(0, Math.min(3, Number(c.slot) || 0));
    const sprite = state.sprites[slot];
    if (!sprite) return false;
    cancelSpriteMove(slot);
    if (c.animationId && (!c.animationAssetId || c.animationAssetId === sprite.assetId)) {
      sprite.animationId = c.animationId;
    }
    const startX = Number(sprite.x) || 0;
    const startY = Number(sprite.y) || 0;
    const targetX = Math.max(0, Math.min(319, Number(c.x) || 0));
    const targetY = Math.max(0, Math.min(223, Number(c.y) || 0));
    const frames = Math.max(1, Math.min(65535, Number(c.frames) || 30));
    let frame = 0;
    const move = { timer: null };
    move.timer = setInterval(() => {
      if (spriteMoveTimers.get(slot) !== move) return;
      frame += 1;
      sprite.x = frame >= frames ? targetX : startX + Math.trunc(((targetX - startX) * frame) / frames);
      sprite.y = frame >= frames ? targetY : startY + Math.trunc(((targetY - startY) * frame) / frames);
      renderStage();
      if (frame < frames) return;
      clearInterval(move.timer);
      spriteMoveTimers.delete(slot);
      if (typeof onComplete === 'function') onComplete();
    }, 1000 / 60);
    spriteMoveTimers.set(slot, move);
    renderStage();
    return true;
  }
  function updateAudioHint() {
    const blocked = Object.keys(blockedAudio).filter((kind) => blockedAudio[kind]);
    let hint = '';
    if (blocked.length) {
      hint = '音声開始待ち: クリック / Enter で再試行';
    } else {
      hint = 'クリック / Enter で進む ・ Esc で閉じる';
    }
    root.querySelector('#pv-hint').textContent = messageFastForward ? hint + ' ・ 早送り中' : hint;
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
    if (kind === 'psg') {
      stopPsgPreview();
      updateAudioHint();
      return;
    }
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
        node.className = 'pv-layer pv-sprite-layer';
        node.style.position = 'absolute';
        node.style.left = (layer.x || 0) + 'px';
        node.style.top = (layer.y || 0) + 'px';
        applySpriteFrame(node, data.urls[layer.assetId], geo, layer.flipX, layer.flipY);
        return node;
      }
    }
    const img = document.createElement('img');
    img.className = kind === 'background' ? 'pv-layer pv-bg-layer' : 'pv-layer pv-sprite-layer';
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
    Object.keys(state.spriteTexts || {}).map(Number).sort((a, b) => b - a).forEach((slot) => {
      const st = state.spriteTexts[slot];
      if (!st) return;
      const node = document.createElement('div');
      node.className = 'pv-layer';
      if (st.blinkFrames && st.blinkOn === false) node.classList.add('pv-hidden-layer');
      node.style.position = 'absolute';
      node.style.left = (st.x || 0) + 'px';
      node.style.top = (st.y || 0) + 'px';
      node.style.color = st.color || '#ffffff';
      node.style.font = '12px/16px monospace';
      renderSpriteTextCells(node, st.text);
      stage.insertBefore(node, msgBox);
    });
    Object.keys(state.sprites).map(Number).sort((a, b) => b - a).forEach((slot) => {
      const s = state.sprites[slot];
      if (s && s.assetId && data.urls[s.assetId]) stage.insertBefore(makeImg(s, 'sprite'), msgBox);
    });
    sceneLabel.textContent = 'Scene: ' + (scene ? scene.id : '-');
    scheduleSpriteTextBlink();
  }

  function hasBlinkingSpriteText() {
    return Object.values(state.spriteTexts || {}).some((st) => st && st.blinkFrames > 0);
  }
  function scheduleSpriteTextBlink() {
    if (spriteTextBlinkRaf || !hasBlinkingSpriteText()) return;
    spriteTextBlinkPrev = performance.now ? performance.now() : Date.now();
    spriteTextBlinkAcc = 0;
    spriteTextBlinkRaf = requestAnimationFrame(tickSpriteTextBlink);
  }
  function tickSpriteTextBlink(nowValue) {
    spriteTextBlinkRaf = 0;
    if (!hasBlinkingSpriteText()) return;
    const now = Number.isFinite(nowValue) ? nowValue : (performance.now ? performance.now() : Date.now());
    spriteTextBlinkAcc += now - spriteTextBlinkPrev;
    spriteTextBlinkPrev = now;
    let changed = false;
    while (spriteTextBlinkAcc >= (1000 / 60)) {
      spriteTextBlinkAcc -= (1000 / 60);
      Object.values(state.spriteTexts || {}).forEach((st) => {
        if (!st || !st.blinkFrames) return;
        st.blinkTimer = (st.blinkTimer || 0) + 1;
        if (st.blinkTimer < st.blinkFrames) return;
        st.blinkTimer = 0;
        st.blinkOn = !st.blinkOn;
        changed = true;
      });
    }
    if (changed) renderStage();
    if (!spriteTextBlinkRaf && hasBlinkingSpriteText()) spriteTextBlinkRaf = requestAnimationFrame(tickSpriteTextBlink);
  }

  function labelIndex(name) {
    if (!name || !scene) return -1;
    return (scene.commands || []).findIndex((c) => !isSkippedCommand(c) && c.type === 'label' && c.name === name);
  }
  function jumpLabel(name) {
    const i = labelIndex(name);
    pc = i >= 0 ? i : pc + 1;
  }
  function setScene(id) {
    cancelAllSpriteMoves();
    scene = scenesById[id] || null;
    sceneId = id;
    pc = 0;
    if (scene?.fullScreenBg) {
      state.sprites = {};
      state.spriteTexts = {};
      hideMsg();
      hideChoice();
    }
    updateCacheDebug();
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
    updateVarDebug();
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
    const kind = c.kind === 'adpcm' ? 'adpcm' : (c.kind === 'psg' ? 'psg' : 'cdda');
    if (c.action === 'stop') { stopAudio(kind); return; }
    if (kind === 'psg') {
      const meta = data.meta[c.assetId] || {};
      void playPsgPreview(c.assetId, meta.type === 'psg-song' || meta.psgOptions?.loop === true).catch(() => {});
      return;
    }
    if (kind === 'adpcm') recordAdpcmUse(c.assetId, 'Audio');
    playAudio(kind, c.assetId, kind === 'cdda');
  }
  function scheduleRunAfter(ms) {
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    waitTimer = setTimeout(() => {
      waitTimer = null;
      run();
    }, Math.max(0, ms));
  }
  function applyBackground(c) {
    const nextBg = { assetId: c.assetId, x: c.x, y: c.y };
    const fadeOut = bgFadeFrames(c.fadeOutFrames);
    const fadeIn = bgFadeFrames(c.fadeInFrames);
    const currentBg = stage.querySelector('.pv-bg-layer');
    const continueWithNext = () => {
      state.background = nextBg;
      renderStage();
      const nextNode = stage.querySelector('.pv-bg-layer');
      const fadeInMs = frameMs(fadeIn);
      if (!nextNode || !fadeInMs) {
        run();
        return;
      }
      nextNode.style.transition = 'none';
      nextNode.style.opacity = '0';
      void nextNode.offsetWidth;
      nextNode.style.transition = 'opacity ' + fadeInMs + 'ms linear';
      nextNode.style.opacity = '1';
      scheduleRunAfter(fadeInMs);
    };
    const fadeOutMs = currentBg ? frameMs(fadeOut) : 0;
    if (!fadeOutMs) {
      continueWithNext();
      return;
    }
    currentBg.style.transition = 'opacity ' + fadeOutMs + 'ms linear';
    currentBg.style.opacity = '0';
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    waitTimer = setTimeout(() => {
      waitTimer = null;
      continueWithNext();
    }, fadeOutMs);
  }
  function applyEffect(c) {
    const frames = Math.max(0, Number(c.frames || 0));
    const seconds = Math.max(0.01, frames / 60);
    const color = c.color || (c.effect === 'flash' ? '#ffffff' : '#000000');
    if (c.effect === 'blank') {
      cancelAllSpriteMoves();
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
    const rowLimit = () => (lines.length === MSG.rows ? MSG.cols - 1 : MSG.cols);
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
      if (col >= rowLimit()) {
        if (lines.length >= MSG.rows) break;
        lines.push('');
        col = 0;
      }
    }
    return lines.slice(0, MSG.rows);
  }
  function messageColor(c) {
    const color = String((c && c.textColor) || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#fff';
  }
  function paintMsg(text, color, waitCursor = false) {
    const lines = layoutLines(text);
    msgBox.style.color = color || '#fff';
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
      if (waitCursor && r === MSG.rows - 1) {
        while (row.children.length < MSG.cols - 1) {
          const spacer = document.createElement('span');
          spacer.className = 'pv-cell';
          row.appendChild(spacer);
        }
        const cursor = document.createElement('span');
        cursor.className = 'pv-cell pv-wait-cursor';
        cursor.textContent = messageWaitGlyph;
        row.appendChild(cursor);
      }
      msgBox.appendChild(row);
    }
  }

  function messageParts(c) {
    const speaker = String(c.speaker || '').trim();
    const text = String(c.text || '').trim();
    const prefix = speaker ? speaker + '：\n' : '';
    return { prefix, body: text, full: prefix + text };
  }

  function messageDrawableLength(text) {
    return Array.from(String(text || '')).filter((ch) => ch !== '\r' && ch !== '\n').length;
  }

  function showEnd() {
    hideChoice();
    msgBox.classList.remove('pv-hidden');
    paintMsg('― END ―', '#fff');
    activeMessageFastForward = null;
    pending = null;
  }

  function showMessage(c) {
    hideChoice();
    msgBox.classList.remove('pv-hidden');
    const parts = messageParts(c);
    const full = parts.full;
    const color = messageColor(c);
    let shownBody = 0;
    let done = false;
    paintMsg(parts.prefix, color);
    if (c.voiceAssetId) {
      recordAdpcmUse(c.voiceAssetId, 'Message voice');
      if (!messageFastForward) playAudio('adpcm', c.voiceAssetId, false);
    }
    function next() {
      clearTimers();
      if (messageFastForward && c.voiceAssetId) stopAudio('adpcm');
      activeMessageFastForward = null;
      pending = null;
      run();
    }
    function complete() {
      if (done) return;
      done = true;
      shownBody = parts.body.length;
      if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      paintMsg(full, color, messageAdvanceMode === 'button');
      if (messageAdvanceMode === 'auto') autoTimer = setTimeout(next, messageFastForward ? 0 : messageAutoWaitFrames * 1000 / 60);
    }
    activeMessageFastForward = () => {
      complete();
      if (c.voiceAssetId) stopAudio('adpcm');
    };
    pending = function () { if (!done) complete(); else { if (c.voiceAssetId) stopAudio('adpcm'); next(); } };
    const voiceMeta = c.voiceAssetId ? (data.meta[c.voiceAssetId] || {}) : {};
    const voiceSeconds = Number(voiceMeta.durationSeconds) || 0;
    const voiceFrames = voiceSeconds > 0 && !voiceMeta.loop ? Math.max(1, Math.ceil(voiceSeconds * 60)) : 0;
    const bodyDrawable = messageDrawableLength(parts.body);
    const voiceSpeed = voiceFrames && bodyDrawable ? Math.max(1, Math.ceil(voiceFrames / bodyDrawable)) * 1000 / 60 : 0;
    const speed = messageFastForward ? 0 : (voiceSpeed || (messageSpeedFrames * 1000 / 60));
    function revealNextBodyGlyph() {
      if (done) return;
      while (shownBody < parts.body.length) {
        const ch = parts.body[shownBody];
        shownBody += 1;
        if (ch !== '\r' && ch !== '\n') break;
      }
      paintMsg(parts.prefix + parts.body.slice(0, shownBody), color);
      if (shownBody >= parts.body.length) complete();
    }
    if (messageFastForward || speed <= 0 || !parts.body) complete();
    else {
      revealNextBodyGlyph();
      if (!done) typeTimer = setInterval(revealNextBodyGlyph, speed);
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
      if (c.variableName) {
        vars[c.variableName] = s16(ch.value);
        updateVarDebug();
      }
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
      if (isSkippedCommand(c)) {
        pc += 1;
        continue;
      }
      const t = c.type;
      if (t === 'background') { pc += 1; recordVisualDisplay(c.assetId, 'bg', 'BG'); applyBackground(c); return; }
      if (t === 'sprite') {
        if (scene.fullScreenBg) { pc += 1; continue; }
        cancelSpriteMove(c.slot);
        if (c.visible === false) delete state.sprites[c.slot];
        else {
          recordVisualDisplay(c.assetId, 'sprite', 'Sprite');
          state.sprites[c.slot] = { slot: c.slot, assetId: c.assetId, x: c.x, y: c.y, flipX: c.flipX, flipY: c.flipY, animationId: c.animationId };
        }
        renderStage();
        pc += 1;
        continue;
      }
      if (t === 'spritemove') {
        if (scene.fullScreenBg || !state.sprites[c.slot]) { pc += 1; continue; }
        pc += 1;
        if (c.async) {
          startSpriteMove(c, null);
          continue;
        }
        if (!startSpriteMove(c, run)) continue;
        return;
      }
      if (t === 'spritetext') {
        if (scene.fullScreenBg) { pc += 1; continue; }
        if (c.visible === false) delete state.spriteTexts[c.slot];
        else state.spriteTexts[c.slot] = { slot: c.slot, text: c.text, x: c.x, y: c.y, color: c.color, blinkFrames: c.blinkFrames || 0, blinkTimer: 0, blinkOn: true };
        renderStage();
        pc += 1;
        continue;
      }
      if (t === 'audio') { handleAudio(c); pc += 1; continue; }
      if (t === 'variable') { applyVar(c); pc += 1; continue; }
      if (t === 'effect') { applyEffect(c); pc += 1; continue; }
      if (t === 'cache') { handleCacheCommand(c); pc += 1; continue; }
      if (t === 'label') { pc += 1; continue; }
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
    cancelAllSpriteMoves();
    stopAudio('cdda');
    stopAudio('adpcm');
    stopAudio('psg');
    stage.style.opacity = '1';
    effectLayer.style.opacity = '0';
    sceneId = scenesById[data.startScene] ? data.startScene : (data.doc.startScene || (data.doc.scenes[0] && data.doc.scenes[0].id));
    scene = scenesById[sceneId] || null;
    pc = 0;
    vars = initialVars();
    resetPreviewCacheState();
    state = { background: null, sprites: {}, spriteTexts: {} };
    activeMessageFastForward = null;
    pending = null;
    choiceState = null;
    renderStage();
    updateVarDebug();
    updateCacheDebug();
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
  root.querySelector('#pv-fast-forward')?.addEventListener('change', (e) => { setMessageFastForward(e.currentTarget.checked); });
  debugToggle?.addEventListener('change', (e) => { setVarDebugVisible(e.currentTarget.checked); });
  window.addEventListener('beforeunload', () => {
    cancelAllSpriteMoves();
    stopAudio('cdda');
    stopAudio('adpcm');
    stopAudio('psg');
    if (psgAudioContext && typeof psgAudioContext.close === 'function') void psgAudioContext.close().catch(() => {});
  });
  setVarDebugVisible(Boolean(debugToggle?.checked));

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

export function activatePlugin({ root, api, logger, registerCapability }) {
  root.innerHTML = `
    <div class="pce-vn-shell">
      <aside class="pce-vn-list">
        <section class="pce-vn-sidebar-section pce-vn-scene-library" data-role="scene-library">
          <div class="pce-vn-header">
            <h2>Scenes</h2>
            <div class="pce-vn-actions">
              <button class="icon-btn" type="button" data-action="add-scene" title="シーン追加" aria-label="シーン追加">＋</button>
              <button class="icon-btn" type="button" data-action="reload" title="再読み込み" aria-label="再読み込み">↻</button>
            </div>
          </div>
          <div class="pce-vn-items" data-role="scene-list"></div>
        </section>
        <section class="pce-vn-sidebar-section pce-vn-command-library" data-role="command-library">
          <div class="pce-vn-header pce-vn-command-toggle-region" data-role="command-library-toggle" title="Toggle Commands">
            <h2>Commands</h2>
            <button class="icon-btn pce-vn-section-toggle" type="button" data-action="toggle-commands" title="Toggle Commands" aria-label="Toggle Commands" aria-expanded="true">
              <span data-role="command-library-chevron" aria-hidden="true">▾</span>
            </button>
          </div>
          <div class="pce-vn-command-body" data-role="command-library-body">
            <div class="pce-vn-command-search">
              <input class="form-input" data-role="command-search" placeholder="コマンド検索" aria-label="コマンド検索" />
            </div>
            <div class="pce-vn-command-palette" data-role="command-palette"></div>
          </div>
        </section>
      </aside>
      <div class="pce-vn-column-resizer" data-column-resizer="left" role="separator" aria-orientation="vertical" aria-label="左列幅"></div>
      <section class="pce-vn-edit">
        <div class="pce-vn-edit-sticky">
        <div class="pce-vn-edit-title">
          <div class="pce-vn-scene-title-block">
            <h2 data-role="scene-title">Scene</h2>
            <div class="pce-vn-scene-name-row">
              <label class="pce-vn-scene-name-field">
                <span>Name</span>
                <input class="form-input" data-role="scene-name" placeholder="opening" />
              </label>
              <label class="pce-vn-scene-name-field pce-vn-scene-id-field">
                <span>ID</span>
                <input class="form-input form-input-mono" data-role="scene-id" placeholder="opening" />
              </label>
              <div class="pce-vn-view-switch" role="group" aria-label="スクリプト編集モード">
                <button class="btn-sm active" type="button" data-script-mode="gui">GUI</button>
                <button class="btn-sm" type="button" data-script-mode="json">JSON</button>
              </div>
              <div class="pce-vn-command-list-search">
                <input class="form-input" data-role="command-list-search" placeholder="シーン内コマンド検索" aria-label="シーン内コマンド検索" />
              </div>
            </div>
          </div>
          <div class="pce-vn-actions">
            <label class="pce-vn-scene-toggle">
              <input type="checkbox" data-role="scene-fullscreen-bg" />
              <span>Full BG</span>
            </label>
            <button class="btn-sm" type="button" data-action="preview" title="シーンをプレビュー再生">▶ プレビュー</button>
            <button class="btn-sm" type="button" data-action="export-irodori" title="全シーンのMessageをIrodori-TTS用の話者別CSVへ出力">音声バッチ出力</button>
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
        </div>
        <div class="pce-vn-commands" data-role="commands"></div>
        <div class="pce-vn-script-json" data-role="script-json-pane" hidden>
          <textarea
            class="form-input form-input-mono"
            data-role="script-json"
            spellcheck="false"
            aria-label="VN scene JSON"
          ></textarea>
        </div>
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
  const listEl = root.querySelector('.pce-vn-list');
  const sceneList = root.querySelector('[data-role="scene-list"]');
  const commandsEl = root.querySelector('[data-role="commands"]');
  const detailForm = root.querySelector('[data-role="command-detail"]');
  const commandPreviewEl = root.querySelector('[data-role="command-preview"]');
  const commandSearchInput = root.querySelector('[data-role="command-search"]');
  const commandListSearchInput = root.querySelector('[data-role="command-list-search"]');
  const commandPaletteEl = root.querySelector('[data-role="command-palette"]');
  const commandLibrarySection = root.querySelector('[data-role="command-library"]');
  const commandLibraryHeader = root.querySelector('[data-role="command-library-toggle"]');
  const commandLibraryToggle = root.querySelector('[data-action="toggle-commands"]');
  const commandLibraryChevron = root.querySelector('[data-role="command-library-chevron"]');
  const errorEl = root.querySelector('[data-role="error"]');
  const sceneBudgetEl = root.querySelector('[data-role="scene-budget"]');
  const sceneFullScreenBgInput = root.querySelector('[data-role="scene-fullscreen-bg"]');
  const sceneNameInput = root.querySelector('[data-role="scene-name"]');
  const sceneIdInput = root.querySelector('[data-role="scene-id"]');
  const scriptJsonPane = root.querySelector('[data-role="script-json-pane"]');
  const scriptJsonInput = root.querySelector('[data-role="script-json"]');
  let assets = [];
  let doc = defaultDoc();
  let selectedId = 'opening';
  let selectedCommandIndex = 0;
  let editorMode = 'gui';
  let commandSearch = '';
  let commandListSearch = '';
  let columnLayout = loadColumnLayout();
  let collapsedSceneGroups = loadCollapsedSceneGroups();
  let commandLibraryCollapsed = loadCommandLibraryCollapsed();
  let pointerDrag = null;
  let sceneDragId = '';
  let suppressCommandClick = false;
  let previewToken = 0;
  let commandClipboard = null;
  let messagePreviewTimer = null;
  let previewAudioEl = null;
  const assetDataUrlCache = new Map();
  const assetApi = api.assets || {};
  const commandPsgPreviewController = createPsgPreviewController({
    onStateChange: (playing) => {
      const button = commandPreviewEl?.querySelector?.('[data-psg-command-preview]');
      if (!button) return;
      button.textContent = playing ? '■' : '▶';
      button.title = playing ? 'PSG preview 停止' : 'PSG preview 再生';
      button.setAttribute('aria-label', button.title);
      button.classList.toggle('is-active', playing);
    },
    onError: (message) => { errorEl.textContent = message; },
  });

  function stopMessagePreview() {
    if (messagePreviewTimer) { clearInterval(messagePreviewTimer); messagePreviewTimer = null; }
    if (previewAudioEl) { try { previewAudioEl.pause(); } catch (_) {} previewAudioEl = null; }
    commandPsgPreviewController.stop();
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
  const systemSettings = () => normalizeSystemSettings(doc.settings);

  function spriteAssetIdForSlotAt(slot, commandIndex = selectedCommandIndex) {
    const current = scene();
    const targetSlot = clamp(slot, 0, 3, 0);
    let assetId = '';
    (current?.commands || []).slice(0, Math.max(0, commandIndex)).forEach((command) => {
      if (isCommandSkipped(command)) return;
      if (command.type !== 'sprite' || clamp(command.slot, 0, 3, 0) !== targetSlot) return;
      assetId = command.visible === false ? '' : (command.assetId || '');
    });
    return assetId;
  }

  function spriteAnimationRows(asset = {}) {
    const rows = Array.isArray(asset?.options?.animations) ? asset.options.animations : [];
    const normalized = rows
      .map((row, index) => {
        const id = String(row?.id || row?.name || (index === 0 ? 'default' : `row_${index + 1}`)).trim().slice(0, 32);
        if (!id) return null;
        return { id, label: row?.name ? `${row.name} (${id})` : id };
      })
      .filter(Boolean);
    return normalized.length ? normalized : [{ id: 'default', label: 'default' }];
  }

  function mouthAnimationOptions(command = {}) {
    const spriteId = spriteAssetIdForSlotAt(command.mouthSlot);
    const current = String(command.mouthAnimationId || '').trim();
    const options = [`<option value="">なし</option>`];
    if (!spriteId) {
      if (current) {
        options.push(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
      }
      return options.join('');
    }
    const rows = spriteAnimationRows(assetById(spriteId));
    rows.forEach((row) => {
      options.push(`<option value="${esc(row.id)}" ${row.id === current ? 'selected' : ''}>${esc(row.label)}</option>`);
    });
    if (current && !rows.some((row) => row.id === current)) {
      options.push(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
    }
    return options.join('');
  }

  function spriteMoveAnimationOptions(command = {}) {
    const spriteId = command.animationAssetId || spriteAssetIdForSlotAt(command.slot);
    const current = String(command.animationId || '').trim();
    const options = ['<option value="">変更しない</option>'];
    if (!spriteId) {
      if (current) options.push(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
      return options.join('');
    }
    const rows = spriteAnimationRows(assetById(spriteId));
    rows.forEach((row) => {
      options.push(`<option value="${esc(row.id)}" ${row.id === current ? 'selected' : ''}>${esc(row.label)}</option>`);
    });
    if (current && !rows.some((row) => row.id === current)) {
      options.push(`<option value="${esc(current)}" selected>${esc(current)}</option>`);
    }
    return options.join('');
  }

  function decodeDataUrlText(dataUrl = '') {
    const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
    if (!match) return '';
    const payload = match[3] || '';
    try {
      if (match[2]) {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
      }
      return decodeURIComponent(payload);
    } catch (_) {
      return '';
    }
  }

  async function previewSourceFromGeneratedMetadata(asset = {}) {
    const previewFile = String(asset?.data?.generated?.previewFile || '').trim();
    if (!previewFile) return '';
    try {
      const result = await previewPceAssetSource(previewFile);
      if (!result?.dataUrl) return '';
      const parsed = JSON.parse(decodeDataUrlText(result.dataUrl) || '{}');
      return String(parsed?.source || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function resolveAssetDataUrl(asset) {
    if (!asset?.id) return '';
    if (assetDataUrlCache.has(asset.id)) return assetDataUrlCache.get(asset.id);
    const candidates = previewPathCandidatesForAsset(asset);
    const tryPreviewPath = async (previewPath) => {
      try {
        const result = await previewPceAssetSource(previewPath);
        const url = result?.dataUrl || '';
        if (url) {
          assetDataUrlCache.set(asset.id, url);
          return url;
        }
      } catch (_) {
        // Try another known path. Missing files should not poison the preview
        // cache; assets may be regenerated or reimported in the same session.
      }
      return '';
    };
    for (const previewPath of candidates) {
      const url = await tryPreviewPath(previewPath);
      if (url) return url;
    }
    const generatedSource = await previewSourceFromGeneratedMetadata(asset);
    if (generatedSource && !candidates.includes(generatedSource)) {
      const url = await tryPreviewPath(generatedSource);
      if (url) return url;
    }
    assetDataUrlCache.delete(asset.id);
    return '';
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
    Object.values(state.spriteTexts || {})
      .sort((a, b) => b.slot - a.slot)
      .forEach((st) => {
        // Approximate the hardware-sprite overlay with positioned text. The real
        // glyphs use the generated sprite font; this is for placement feedback.
        const node = document.createElement('div');
        node.className = 'pce-vn-stage-spritetext';
        if (st.blinkFrames) node.classList.add('is-blinking');
        node.style.position = 'absolute';
        node.style.left = `${st.x || 0}px`;
        node.style.top = `${st.y || 0}px`;
        node.style.color = st.color || '#ffffff';
        if (st.blinkFrames) node.style.animationDuration = `${Math.max(1, Number(st.blinkFrames) || 1) / 30}s`;
        node.style.font = '12px/16px monospace';
        node.style.letterSpacing = '0';
        renderSpriteTextCells(node, st.text);
        if (command?.type === 'spritetext' && st.slot === command.slot) node.classList.add('is-active');
        stage.appendChild(node);
      });
    Object.values(state.sprites)
      .sort((a, b) => b.slot - a.slot)
      .forEach((s) => {
        if (s.assetId && urls[s.assetId]) {
          stage.appendChild(makeStageImg(s, 'sprite', urls[s.assetId], (command?.type === 'sprite' || command?.type === 'spritemove') && s.slot === command.slot));
        }
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
    const settings = systemSettings();
    info.textContent = command.voiceAssetId
      ? `ADPCM同期 ・ ${command.voiceAssetId}`
      : `speed ${settings.messageSpeedFrames}f/字`;
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

  function paintMessageOverlay(overlay, text, waitCursor = false) {
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
      if (waitCursor && r === MESSAGE_AREA.rows - 1) {
        while (row.children.length < MESSAGE_AREA.cols - 1) {
          const spacer = document.createElement('span');
          spacer.className = 'pce-vn-msg-cell';
          row.appendChild(spacer);
        }
        const cursor = document.createElement('span');
        cursor.className = 'pce-vn-msg-cell pce-vn-msg-wait-cursor';
        cursor.textContent = MESSAGE_WAIT_GLYPH;
        row.appendChild(cursor);
      }
      overlay.appendChild(row);
    }
  }

  function startMessagePreview(node, command, token) {
    const overlay = node.querySelector('[data-role="message-overlay"]');
    const playBtn = node.querySelector('[data-role="message-play"]');
    if (!overlay) return;
    const parts = messageParts(command);
    const full = parts.full;
    paintMessageOverlay(overlay, full, true);
    const play = () => {
      if (token !== previewToken) return;
      stopMessagePreview();
      // ADPCM 選択時は再生長に同期した 1 文字あたりの間隔を使う（runtime と同じ考え方）。
      const adpcmSeconds = command.voiceAssetId
        ? audioDurationSeconds(assetById(command.voiceAssetId))
        : 0;
      const bodyDrawable = messageDrawableLength(parts.body);
      const speed = (adpcmSeconds > 0 && bodyDrawable)
        ? Math.max(1, (adpcmSeconds * 1000) / bodyDrawable)
        : systemSettings().messageSpeedFrames * 1000 / 60;
      if (speed <= 0 || !parts.body) {
        paintMessageOverlay(overlay, full, true);
      } else {
        let shownBody = 0;
        const revealNextBodyGlyph = () => {
          if (token !== previewToken) { stopMessagePreview(); return; }
          while (shownBody < parts.body.length) {
            const ch = parts.body[shownBody];
            shownBody += 1;
            if (ch !== '\r' && ch !== '\n') break;
          }
          paintMessageOverlay(overlay, parts.prefix + parts.body.slice(0, shownBody));
          if (shownBody >= parts.body.length) {
            if (messagePreviewTimer) {
              clearInterval(messagePreviewTimer);
              messagePreviewTimer = null;
            }
            paintMessageOverlay(overlay, full, true);
          }
        };
        paintMessageOverlay(overlay, parts.prefix);
        revealNextBodyGlyph();
        if (shownBody < parts.body.length) messagePreviewTimer = setInterval(revealNextBodyGlyph, speed);
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

  function loadCollapsedSceneGroups() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCENE_GROUP_COLLAPSE_KEY) || '[]');
      if (Array.isArray(parsed)) return new Set(parsed.filter(Boolean).map((item) => String(item)));
    } catch (_) {}
    return new Set();
  }

  function saveCollapsedSceneGroups(collapsedGroups = collapsedSceneGroups) {
    try {
      localStorage.setItem(SCENE_GROUP_COLLAPSE_KEY, JSON.stringify([...collapsedGroups].sort()));
    } catch (_) {}
  }

  function loadCommandLibraryCollapsed() {
    try {
      return localStorage.getItem(COMMAND_LIBRARY_COLLAPSED_KEY) === '1';
    } catch (_) {}
    return false;
  }

  function saveCommandLibraryCollapsed() {
    try {
      localStorage.setItem(COMMAND_LIBRARY_COLLAPSED_KEY, commandLibraryCollapsed ? '1' : '0');
    } catch (_) {}
  }

  function applyColumnLayout() {
    shell.style.setProperty('--pce-vn-left-width', `${columnLayout.left}px`);
    shell.style.setProperty('--pce-vn-right-width', `${columnLayout.right}px`);
  }

  function applyCommandLibraryState({ persist = false } = {}) {
    listEl?.classList.toggle('is-command-library-collapsed', commandLibraryCollapsed);
    commandLibrarySection?.classList.toggle('is-collapsed', commandLibraryCollapsed);
    commandLibraryToggle?.setAttribute('aria-expanded', String(!commandLibraryCollapsed));
    if (commandLibraryChevron) commandLibraryChevron.textContent = commandLibraryCollapsed ? '▸' : '▾';
    if (persist) saveCommandLibraryCollapsed();
  }

  applyCommandLibraryState();

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
    return optionsFor(doc.scenes.map((item) => ({ id: item.id, name: sceneOptionLabel(item) })), current, label);
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
    const groups = [
      { color: 'textColor', hex: 'textColorHex', normalize: snapHexToPce },
      { color: 'color', hex: 'colorHex', normalize: snapHexToPce },
    ];
    const group = groups.find((entry) => name === entry.color || name === entry.hex);
    if (!group) return;
    const colorInput = detailForm.elements[group.color];
    const hexInput = detailForm.elements[group.hex];
    if (!colorInput || !hexInput) return;
    if (name === group.color) {
      const normalized = group.normalize(colorInput.value);
      if (normalized) {
        colorInput.value = normalized;
        hexInput.value = normalized;
      }
      return;
    }
    const normalized = group.normalize(hexInput.value);
    if (normalized) colorInput.value = normalized;
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
    if (command.type === 'spritemove') {
      const animation = command.animationId ? ` / ${command.animationId}` : '';
      return `slot ${command.slot} -> (${command.x}, ${command.y}) ${command.frames}f ${command.async ? 'async' : 'sync'}${animation}`;
    }
    if (command.type === 'message') return `${command.speaker ? `${command.speaker}: ` : ''}${command.text || '本文なし'}`;
    if (command.type === 'audio') return `${command.kind}:${command.action}${command.assetId ? ` ${command.assetId}` : ''}${command.kind === 'psg' && command.action === 'play' ? ` ch${command.channel || 0}` : ''}${command.kind === 'psg' && command.action === 'stop' ? ` ${command.target || 'all'}` : ''}`;
    if (command.type === 'cache') {
      if (command.action === 'load') {
        const label = assetById(command.assetId)?.name || command.assetId || cacheScopeLabel(command.scope);
        if (command.scope === 'adpcm') return `Load ${label} ADPCM cache`;
        if (command.scope === 'psg') return `Load ${label} PSG cache`;
        return `Load ${label} visual RAM cache`;
      }
      return `Clear ${cacheScopeLabel(command.scope)} cache`;
    }
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
    if (command.type === 'comment') return command.text || '(コメント)';
    return command.type;
  }

  function addAssetSearchText(parts, assetId) {
    const id = String(assetId || '').trim();
    if (!id) return;
    const asset = assetById(id);
    parts.push(id);
    if (asset?.name) parts.push(asset.name);
    if (asset?.source) parts.push(asset.source);
  }

  function commandListSearchText(command) {
    if (!command) return '';
    const definition = commandDefinition(command.type);
    const parts = [
      command.type,
      definition.label,
      definition.category,
      definition.description,
      commandSummary(command),
    ];
    if (command.type === 'background' || command.type === 'sprite') {
      addAssetSearchText(parts, command.assetId);
      if (command.animationId) parts.push(command.animationId);
    } else if (command.type === 'spritemove') {
      addAssetSearchText(parts, command.animationAssetId);
      if (command.animationId) parts.push(command.animationId);
    } else if (command.type === 'message') {
      parts.push(command.speaker || '', command.text || '');
      addAssetSearchText(parts, command.voiceAssetId);
      if (command.mouthAnimationId) parts.push(command.mouthAnimationId);
    } else if (command.type === 'audio' || command.type === 'cache') {
      addAssetSearchText(parts, command.assetId);
    } else if (command.type === 'choice') {
      (command.choices || []).forEach((choice) => parts.push(choice.label || '', choice.targetSceneId || ''));
    } else if (command.type === 'spritetext' || command.type === 'comment') {
      parts.push(command.text || '');
    } else if (command.type === 'label') {
      parts.push(command.name || '');
    } else if (command.type === 'goto') {
      parts.push(command.targetLabel || '');
    } else if (command.type === 'jump') {
      parts.push(command.sceneId || '');
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function commandMatchesListSearch(command) {
    const query = commandListSearch.trim().toLowerCase();
    if (!query) return true;
    return commandListSearchText(command).includes(query);
  }

  function selectedCommandFromDetail(existing) {
    if (!detailForm.elements.type) return existing;
    const type = detailForm.elements.type.value;
    if (type !== existing.type) return defaultCommand(type, assets);
    if (type === 'background') {
      return normalizeCommand({
        type,
        assetId: detailForm.elements.assetId.value,
        transition: 'fade',
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
        visible: detailForm.elements.visible.checked,
      }, assets);
    }
    if (type === 'spritemove') {
      return normalizeCommand({
        type,
        slot: detailForm.elements.slot.value,
        x: detailForm.elements.x.value,
        y: detailForm.elements.y.value,
        frames: detailForm.elements.frames.value,
        async: detailForm.elements.async.checked,
        animationAssetId: detailForm.elements.animationAssetId.value,
        animationId: detailForm.elements.animationId.value,
      }, assets);
    }
    if (type === 'audio') {
      return normalizeCommand({
        type,
        kind: detailForm.elements.kind.value,
        action: detailForm.elements.action.value,
        assetId: detailForm.elements.assetId.value,
        channel: detailForm.elements.channel?.value ?? 0,
        target: detailForm.elements.target?.value || 'all',
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
    if (type === 'cache') {
      return normalizeCommand({
        type,
        action: detailForm.elements.action?.value || 'clear',
        scope: detailForm.elements.scope?.value || 'visual',
        assetId: detailForm.elements.assetId?.value || '',
        slot: detailForm.elements.slot?.value ?? 0,
        x: detailForm.elements.x?.value ?? 0,
        y: detailForm.elements.y?.value ?? 0,
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
    if (type === 'jump') {
      return normalizeCommand({ type, sceneId: detailForm.elements.sceneId.value }, assets);
    }
    if (type === 'wait') {
      return normalizeCommand({ type, frames: detailForm.elements.frames.value }, assets);
    }
    if (type === 'comment') {
      return normalizeCommand({
        type,
        text: detailForm.elements.text?.value || '',
      }, assets);
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
    const nextCommand = selectedCommandFromDetail(existing);
    current.commands[selectedCommandIndex] = isCommandSkipped(existing) ? { ...nextCommand, skip: true } : nextCommand;
    if (rerenderCommands) renderCommands(current);
    if (rerenderDetail) renderCommandDetail(current);
    if (updatePreview) void renderCommandPreview();
    updateSceneBudget();
  }

  function commitCurrentUiToDoc() {
    if (editorMode === 'json') return;
    updateSelectedCommandFromDetail({ rerenderCommands: false, updatePreview: false });
  }

  function sceneDocumentText(value = doc) {
    return JSON.stringify(value, null, 2);
  }

  function jsonParseErrorMessage(error) {
    const message = String(error?.message || error || 'JSON parse error');
    const match = message.match(/position\s+(\d+)/i);
    if (!match || !scriptJsonInput) return message;
    const position = Number(match[1]);
    if (!Number.isFinite(position)) return message;
    const before = scriptJsonInput.value.slice(0, Math.max(0, position));
    const lines = before.split('\n');
    return `${message} (line ${lines.length}, column ${lines[lines.length - 1].length + 1})`;
  }

  function refreshScriptModeControls() {
    shell.classList.toggle('is-json-mode', editorMode === 'json');
    root.querySelectorAll('[data-script-mode]').forEach((button) => {
      const active = button.dataset.scriptMode === editorMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (scriptJsonPane) scriptJsonPane.hidden = editorMode !== 'json';
    if (commandsEl) commandsEl.hidden = editorMode === 'json';
    if (detailForm) detailForm.hidden = editorMode === 'json';
    if (commandPreviewEl) commandPreviewEl.hidden = editorMode === 'json';
    if (sceneBudgetEl) sceneBudgetEl.hidden = editorMode === 'json';
    if (sceneFullScreenBgInput) sceneFullScreenBgInput.disabled = editorMode === 'json';
    if (sceneNameInput) sceneNameInput.disabled = editorMode === 'json';
    if (sceneIdInput) sceneIdInput.disabled = editorMode === 'json';
  }

  function updateScriptJsonFromDoc() {
    if (scriptJsonInput) scriptJsonInput.value = sceneDocumentText(doc);
  }

  function applyScriptJsonToDoc(options = {}) {
    if (!scriptJsonInput) return true;
    try {
      const parsed = JSON.parse(scriptJsonInput.value || '{}');
      doc = normalizeDoc(parsed, assets);
      if (!doc.scenes.some((item) => item.id === selectedId)) {
        selectedId = doc.startScene || doc.scenes[0]?.id || 'opening';
        selectedCommandIndex = 0;
      }
      if (options.refreshText !== false) updateScriptJsonFromDoc();
      if (options.message) errorEl.textContent = options.message;
      return true;
    } catch (err) {
      errorEl.textContent = `JSONエラー: ${jsonParseErrorMessage(err)}`;
      return false;
    }
  }

  function setEditorMode(mode) {
    const nextMode = mode === 'json' ? 'json' : 'gui';
    if (nextMode === editorMode) return;
    errorEl.textContent = '';
    if (editorMode === 'gui') {
      commitCurrentUiToDoc();
      doc = normalizeDoc(doc, assets);
      updateScriptJsonFromDoc();
    } else if (!applyScriptJsonToDoc({ refreshText: true })) {
      return;
    }
    editorMode = nextMode;
    render();
  }

  function ensureStartScene() {
    if (!doc.scenes.length) return;
    if (!doc.scenes.some((item) => item.id === doc.startScene)) {
      doc.startScene = doc.scenes[0]?.id || 'opening';
    }
  }

  function updateSceneReferences(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    doc.scenes.forEach((item) => {
      if (item.nextSceneId === oldId) item.nextSceneId = newId;
      (item.commands || []).forEach((command) => {
        if (command.type === 'jump' && command.sceneId === oldId) command.sceneId = newId;
        if (command.type === 'choice') {
          (command.choices || []).forEach((choice) => {
            if (choice.targetSceneId === oldId) choice.targetSceneId = newId;
          });
        }
      });
    });
    if (doc.startScene === oldId) doc.startScene = newId;
  }

  function renameSceneId(rawId) {
    const current = scene();
    if (!current) return;
    const oldId = current.id;
    const existingIds = doc.scenes.filter((item) => item !== current).map((item) => item.id);
    const nextId = uniqueSceneId(rawId || oldId, existingIds, oldId || 'scene');
    if (nextId === oldId) {
      if (sceneIdInput) sceneIdInput.value = oldId;
      return;
    }
    current.id = nextId;
    selectedId = nextId;
    updateSceneReferences(oldId, nextId);
    errorEl.textContent = nextId === safeId(rawId, oldId).slice(0, 32)
      ? ''
      : `Scene ID adjusted to ${nextId}`;
    render();
  }

  function renderSceneList() {
    ensureStartScene();
    sceneList.innerHTML = buildSceneListRows(doc.scenes, collapsedSceneGroups).map((row) => {
      if (row.type === 'group') {
        const depth = Math.min(4, Math.max(0, row.depth || 0));
        const expanded = !row.collapsed;
        return `
          <button class="pce-vn-scene-group ${expanded ? '' : 'is-collapsed'}" type="button" data-scene-group="${esc(row.path)}" data-scene-group-toggle="${esc(row.path)}" data-depth="${depth}" style="--scene-depth:${depth}" title="${esc(row.path)}" aria-expanded="${expanded}">
            <span class="pce-vn-scene-group-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
            <span class="pce-vn-scene-group-mark" aria-hidden="true"></span>
            <span>${esc(row.name)}</span>
          </button>
        `;
      }
      const item = row.item;
      const firstMessage = item.commands.find((command) => command.type === 'message');
      const canDelete = doc.scenes.length > 1;
      const bytes = estimateScenePackBytes(item);
      const level = bytes > vnScenePackLimit ? 'error' : (bytes / vnScenePackLimit >= 0.85 ? 'warn' : 'ok');
      const depth = Math.min(4, Math.max(0, row.depth || 0));
      const idMeta = String(item.name || '').trim() ? `<small>ID ${esc(item.id)}</small>` : '';
      const badge = level === 'ok'
        ? ''
        : `<span class="pce-vn-scene-budget-badge" data-level="${level}" title="scene pack ${bytes} / ${vnScenePackLimit} byte">${level === 'error' ? '⚠ 超過' : `${Math.round((bytes / vnScenePackLimit) * 100)}%`}</span>`;
      return `
        <div class="pce-vn-scene-row ${item.id === selectedId ? 'active' : ''}" data-scene-row="${esc(item.id)}" draggable="true" style="--scene-depth:${depth}">
          <button type="button" data-scene-id="${esc(item.id)}" class="pce-vn-scene-select">
            <span class="pce-vn-drag-handle" aria-hidden="true">::</span>
            <span class="pce-vn-scene-label">
              <strong>${esc(sceneLeafName(item))}${item.fullScreenBg ? '<span class="pce-vn-mode-badge">Full BG</span>' : ''}${badge}</strong>
              ${idMeta}
              <span>${esc(firstMessage?.text || `${item.commands.length} commands`)}</span>
            </span>
          </button>
          <button
            class="icon-btn-xs pce-vn-scene-start-toggle${item.id === doc.startScene ? ' active' : ''}"
            type="button"
            data-scene-start-toggle="${esc(item.id)}"
            title="${item.id === doc.startScene ? '開始シーン' : '開始シーンに設定'}"
            aria-label="${item.id === doc.startScene ? `${esc(item.id)} は開始シーン` : `${esc(item.id)} を開始シーンに設定`}"
            aria-pressed="${item.id === doc.startScene ? 'true' : 'false'}"
          >${item.id === doc.startScene ? '★' : '☆'}</button>
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
        if (editorMode === 'json' && !applyScriptJsonToDoc({ refreshText: false })) return;
        commitCurrentUiToDoc();
        selectedId = button.dataset.sceneId;
        selectedCommandIndex = 0;
        render();
      });
    });
    sceneList.querySelectorAll('[data-scene-start-toggle]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = button.dataset.sceneStartToggle;
        if (!id) return;
        if (editorMode === 'json' && !applyScriptJsonToDoc({ refreshText: false })) return;
        if (!doc.scenes.some((item) => item.id === id) || doc.startScene === id) return;
        doc.startScene = id;
        if (editorMode === 'json') updateScriptJsonFromDoc();
        renderSceneList();
      });
    });
    sceneList.querySelectorAll('[data-scene-delete]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteScene(button.dataset.sceneDelete || selectedId);
      });
    });
    sceneList.querySelectorAll('[data-scene-group-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const path = button.dataset.sceneGroupToggle || '';
        if (!path) return;
        if (collapsedSceneGroups.has(path)) collapsedSceneGroups.delete(path);
        else collapsedSceneGroups.add(path);
        saveCollapsedSceneGroups(collapsedSceneGroups);
        renderSceneList();
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
      const color = categoryColor(category);
      return `
        <section class="pce-vn-palette-category" style="--cat-color:${esc(color)}">
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
        </div>
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">X tile</span><input class="form-input" name="x" type="number" min="0" max="63" value="${esc(command.x)}" /></label>
          <label class="form-group"><span class="form-label">Y tile</span><input class="form-input" name="y" type="number" min="0" max="31" value="${esc(command.y)}" /></label>
          <label class="form-group"><span class="form-label">Fade out</span><select class="form-select" name="fadeOutFrames">${bgFadeOptions(command.fadeOutFrames)}</select></label>
          <label class="form-group"><span class="form-label">Fade in</span><select class="form-select" name="fadeInFrames">${bgFadeOptions(command.fadeInFrames)}</select></label>
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
          <label class="pce-vn-check"><input name="flipX" type="checkbox" ${command.flipX ? 'checked' : ''} /><span>flip X</span></label>
          <label class="pce-vn-check"><input name="flipY" type="checkbox" ${command.flipY ? 'checked' : ''} /><span>flip Y</span></label>
          <label class="pce-vn-check"><input name="visible" type="checkbox" ${command.visible !== false ? 'checked' : ''} /><span>visible</span></label>
        </div>
      `;
    }
    if (command.type === 'spritemove') {
      const inferredSpriteId = spriteAssetIdForSlotAt(command.slot);
      const spriteOptions = optionsFor(byType(['sprite']), command.animationAssetId, inferredSpriteId ? `slotの表示中sprite (${assetById(inferredSpriteId)?.name || inferredSpriteId})` : 'slotの表示中sprite');
      return `
        <div class="pce-vn-grid tight">
          <label class="form-group"><span class="form-label">Slot</span><input class="form-input" name="slot" type="number" min="0" max="3" value="${esc(command.slot)}" /></label>
          <label class="form-group"><span class="form-label">Target X</span><input class="form-input" name="x" type="number" min="0" max="319" value="${esc(command.x)}" /></label>
          <label class="form-group"><span class="form-label">Target Y</span><input class="form-input" name="y" type="number" min="0" max="223" value="${esc(command.y)}" /></label>
          <label class="form-group"><span class="form-label">Frames</span><input class="form-input" name="frames" type="number" min="1" max="65535" value="${esc(command.frames)}" /></label>
          <label class="pce-vn-check"><input name="async" type="checkbox" ${command.async ? 'checked' : ''} /><span>async（同時移動）</span></label>
        </div>
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Animation sprite</span><select class="form-select" name="animationAssetId">${spriteOptions}</select></label>
          <label class="form-group"><span class="form-label">Animation</span><select class="form-select" name="animationId">${spriteMoveAnimationOptions(command)}</select></label>
        </div>
        <small class="pce-vn-hint">同期が既定です。asyncなら最大4 slotを同時移動できます。同じslotへの新しい移動・Sprite表示・scene切替は先行移動を中止します。</small>
      `;
    }
    if (command.type === 'audio') {
      const audioAssets = command.kind === 'adpcm'
        ? byType(['adpcm'])
        : (command.kind === 'psg' ? byType(['psg-song', 'psg-sfx']) : byType(['cdda-track']));
      const channelField = command.kind === 'psg' && command.action !== 'stop'
        ? `<label class="form-group"><span class="form-label">基準ch</span><input class="form-input" name="channel" type="number" min="0" max="5" value="${esc(command.channel || 0)}" /></label>`
        : '';
      const targetField = command.kind === 'psg' && command.action === 'stop'
        ? `<label class="form-group"><span class="form-label">停止対象</span><select class="form-select" name="target"><option value="all" ${command.target !== 'bgm' && command.target !== 'sfx' ? 'selected' : ''}>all</option><option value="bgm" ${command.target === 'bgm' ? 'selected' : ''}>BGM</option><option value="sfx" ${command.target === 'sfx' ? 'selected' : ''}>SFX</option></select></label>`
        : '';
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Kind</span><select class="form-select" name="kind"><option value="cdda" ${command.kind !== 'adpcm' && command.kind !== 'psg' ? 'selected' : ''}>CD-DA</option><option value="adpcm" ${command.kind === 'adpcm' ? 'selected' : ''}>ADPCM</option><option value="psg" ${command.kind === 'psg' ? 'selected' : ''}>PSG</option></select></label>
          <label class="form-group"><span class="form-label">Action</span><select class="form-select" name="action"><option value="play" ${command.action !== 'stop' ? 'selected' : ''}>play</option><option value="stop" ${command.action === 'stop' ? 'selected' : ''}>stop</option></select></label>
        </div>
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Asset</span><select class="form-select" name="assetId">${optionsFor(audioAssets, command.assetId, 'なし')}</select></label>
          ${channelField}
          ${targetField}
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
    if (command.type === 'jump') {
      return `
        <label class="form-group"><span class="form-label">Scene</span><select class="form-select" name="sceneId">${sceneOptions(command.sceneId, 'なし')}</select></label>
      `;
    }
    if (command.type === 'wait') {
      return `
        <label class="form-group"><span class="form-label">Frames</span><input class="form-input" name="frames" type="number" min="0" max="65535" value="${esc(command.frames)}" /></label>
      `;
    }
    if (command.type === 'comment') {
      return `
        <label class="form-group"><span class="form-label">コメント</span><textarea class="form-input" name="text" rows="3" placeholder="エディタ用メモ（ビルド・実行には含まれません）">${esc(command.text || '')}</textarea></label>
        <small class="pce-vn-hint">コメントはエディタ表示専用です。スクリプト一覧では「メモ」分類の固定色で表示され、ビルドやプレビュー実行には含まれません。</small>
      `;
    }
    if (command.type === 'cache') {
      const action = normalizeCacheAction(command.action);
      const scope = normalizeCacheScope(command.scope);
      const assetTypes = scope === 'sprite'
        ? ['sprite']
        : (scope === 'adpcm'
          ? ['adpcm']
          : (scope === 'psg' ? ['psg-song', 'psg-sfx'] : ['image']));
      const loadFields = action === 'load'
        ? `
          <label class="form-group"><span class="form-label">Asset</span><select class="form-select" name="assetId">${optionsFor(byType(assetTypes), command.assetId, 'なし')}</select></label>
          ${scope === 'sprite' ? `<label class="form-group"><span class="form-label">Slot</span><input class="form-input" name="slot" type="number" min="0" max="3" value="${esc(command.slot || 0)}" /></label>` : ''}
          ${scope === 'bg' || scope === 'visual' ? `
            <div class="pce-vn-grid tight">
              <label class="form-group"><span class="form-label">Tile X</span><input class="form-input" name="x" type="number" min="0" max="63" value="${esc(command.x || 0)}" /></label>
              <label class="form-group"><span class="form-label">Tile Y</span><input class="form-input" name="y" type="number" min="0" max="31" value="${esc(command.y || 0)}" /></label>
            </div>
          ` : ''}
        `
        : '';
      return `
        <div class="pce-vn-grid">
          <label class="form-group"><span class="form-label">Action</span><select class="form-select" name="action">${cacheActionOptions(command.action)}</select></label>
          <label class="form-group"><span class="form-label">Scope</span><select class="form-select" name="scope">${cacheScopeOptions(command.scope)}</select></label>
        </div>
        ${loadFields}
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
        <label class="form-group"><span class="form-label">Mouth slot</span><select class="form-select" name="mouthSlot">${[0, 1, 2, 3].map((slot) => `<option value="${slot}" ${slot === command.mouthSlot ? 'selected' : ''}>slot ${slot}</option>`).join('')}</select></label>
        <label class="form-group"><span class="form-label">Mouth animation</span><select class="form-select" name="mouthAnimationId">${mouthAnimationOptions(command)}</select></label>
      </div>
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
    const rows = current.commands
      .map((command, index) => ({ command, index }))
      .filter(({ command }) => commandMatchesListSearch(command));
    const pieces = [];
    if (!rows.length) {
      pieces.push('<p class="pce-vn-empty">該当コマンドがありません</p>');
      commandsEl.innerHTML = pieces.join('');
      return;
    }
    pieces.push(`<div class="pce-vn-command-dropzone" data-drop-index="${rows[0].index}"></div>`);
    pieces.push(...rows.map(({ command, index }) => {
      const definition = commandDefinition(command.type);
      const skipped = isCommandSkipped(command);
      const rowBg = skipped ? '#3f444d' : categoryColor(definition.category);
      const rowFg = skipped ? '#c5ccd5' : readableTextColor(rowBg);
      const rowStyle = ` style="background:${esc(rowBg)};--row-fg:${esc(rowFg)}"`;
      return `
        <section class="pce-vn-command-row${index === selectedCommandIndex ? ' active' : ''}${skipped ? ' is-skipped' : ''}" data-command data-command-index="${index}" draggable="true"${rowStyle}>
          <label class="pce-vn-command-skip" title="スキップして生成・プレビューから除外">
            <input type="checkbox" data-command-skip="${index}" aria-label="#${index + 1} をスキップ" ${skipped ? 'checked' : ''} />
          </label>
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
    else if (command.type === 'jump') text.textContent = command.sceneId ? `Scene: ${command.sceneId}` : 'Scene未指定';
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
    if (command.type === 'background' || command.type === 'sprite' || command.type === 'spritemove' || command.type === 'spritetext') {
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
      if (command.kind === 'psg') {
        if (!asset || command.action !== 'play') {
          renderCommandPreviewText(command);
          return;
        }
        const stats = psgPreviewStats(asset);
        const frame = document.createElement('div');
        frame.className = 'pce-vn-audio-preview';
        const label = document.createElement('strong');
        label.textContent = asset.name || asset.id;
        const info = document.createElement('span');
        info.textContent = `${asset.type === 'psg-song' ? 'PSG SONG' : 'PSG SFX'} / ${stats.entries} events / ch${command.channel || 0}`;
        const button = document.createElement('button');
        button.className = 'icon-btn';
        button.type = 'button';
        button.setAttribute('data-psg-command-preview', '1');
        button.title = 'PSG preview 再生';
        button.setAttribute('aria-label', button.title);
        button.textContent = '▶';
        button.addEventListener('click', () => {
          errorEl.textContent = '';
          void commandPsgPreviewController.toggle(asset, { loop: asset.type === 'psg-song' });
        });
        frame.append(label, info, button);
        commandPreviewEl.replaceChildren(frame);
        return;
      }
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
    if (command.type === 'cache') {
      const asset = assetById(command.assetId);
      const isImageAsset = asset && (asset.type === 'image' || asset.type === 'sprite');
      if (isImageAsset) {
        renderCommandPreviewLoading(command, asset, '画像');
        const url = await resolveAssetDataUrl(asset);
        if (token !== previewToken) return;
        if (url) {
          const frame = document.createElement('div');
          frame.className = 'pce-vn-cache-preview';
          const label = document.createElement('strong');
          label.textContent = previewTitle(command);
          const sub = document.createElement('span');
          sub.textContent = `${asset.name || asset.id} (${asset.type === 'sprite' ? 'Sprite' : 'BG'})`;
          const img = document.createElement('img');
          img.src = url;
          img.alt = asset.name || asset.id;
          frame.append(label, sub, img);
          commandPreviewEl.replaceChildren(frame);
          return;
        }
      }
      renderCommandPreviewText(command);
      return;
    }
    renderCommandPreviewText(command);
  }

  function renderForm() {
    const current = scene();
    if (!current) return;
    ensureSelectedCommand(current);
    refreshScriptModeControls();
    root.querySelector('[data-role="scene-title"]').textContent = sceneDisplayName(current);
    if (sceneNameInput) {
      sceneNameInput.value = current.name || '';
      sceneNameInput.placeholder = current.id || 'scene';
    }
    if (sceneIdInput) {
      sceneIdInput.value = current.id || '';
      sceneIdInput.placeholder = current.id || 'scene';
    }
    if (sceneFullScreenBgInput) sceneFullScreenBgInput.checked = Boolean(current.fullScreenBg);
    if (editorMode === 'json') {
      updateScriptJsonFromDoc();
      stopMessagePreview();
      return;
    }
    renderCommands(current);
    renderCommandDetail(current);
    void renderCommandPreview();
  }

  function updateSceneBudget() {
    if (!sceneBudgetEl) return;
    const current = scene();
    const bytes = current ? estimateScenePackBytes(current) : 0;
    const ratio = bytes / vnScenePackLimit;
    const percent = Math.round(ratio * 100);
    const level = bytes > vnScenePackLimit ? 'error' : (ratio >= 0.85 ? 'warn' : 'ok');
    sceneBudgetEl.dataset.level = level;
    sceneBudgetEl.querySelector('[data-role="scene-budget-value"]').textContent =
      `${bytes} / ${vnScenePackLimit} byte (${percent}%)`;
    const fill = sceneBudgetEl.querySelector('[data-role="scene-budget-fill"]');
    fill.style.width = `${Math.min(100, percent)}%`;
    const note = sceneBudgetEl.querySelector('[data-role="scene-budget-note"]');
    if (level === 'error') {
      note.textContent = `このシーンは scene pack 上限 ${vnScenePackLimit} byte を ${bytes - vnScenePackLimit} byte 超過しています。`
        + 'このままではビルドが失敗します。Jump で別シーンに分割してください。';
      note.style.display = '';
    } else if (level === 'warn') {
      note.textContent = `残り ${vnScenePackLimit - bytes} byte。上限に近づいています。長くなる場合はシーン分割を検討してください。`;
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
    const projectRead = await api.electronAPI.readCodeFile({ path: 'project.json' });
    try {
      const project = projectRead?.ok && projectRead.content ? JSON.parse(projectRead.content) : {};
      const hucard = String(project.targetMedia || '').toLowerCase() === 'hucard'
        || project?.pluginRoles?.builder === 'pce-visual-novel-hucard-builder';
      vnScenePackLimit = hucard ? VN_HUCARD_SCENE_PACK_LIMIT : VN_CD_SCENE_PACK_LIMIT;
      vnScenePackUsesShiftJis = !hucard;
    } catch (_) {
      vnScenePackLimit = VN_CD_SCENE_PACK_LIMIT;
      vnScenePackUsesShiftJis = true;
    }
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

  function setupSystemSettingsEvents() {
    const onChanged = (event) => {
      doc.settings = normalizeSystemSettings(event.detail?.settings);
      void renderCommandPreview();
    };
    window.addEventListener(VN_SYSTEM_SETTINGS_EVENT, onChanged);
    return () => window.removeEventListener(VN_SYSTEM_SETTINGS_EVENT, onChanged);
  }

  async function save() {
    try {
      if (editorMode === 'json') {
        if (!applyScriptJsonToDoc({ refreshText: true })) return;
      } else {
        commitCurrentUiToDoc();
        doc = normalizeDoc(doc, assets);
      }
      await api.electronAPI.writeCodeFile({ path: SCENE_FILE, content: JSON.stringify(doc, null, 2), encoding: 'utf8' });
      errorEl.textContent = '保存しました';
      render();
    } catch (err) {
      errorEl.textContent = `保存失敗: ${err?.message || err}`;
    }
  }

  async function exportIrodoriBatch() {
    const exportButton = root.querySelector('[data-action="export-irodori"]');
    try {
      errorEl.textContent = '';
      if (editorMode === 'json') {
        if (!applyScriptJsonToDoc({ refreshText: true })) {
          logger?.error?.(`音声バッチ出力失敗: ${errorEl.textContent || 'JSONを検証できませんでした。'}`);
          return;
        }
      } else {
        commitCurrentUiToDoc();
      }
      const snapshot = normalizeDoc(doc, assets);
      exportButton.disabled = true;
      const result = await api.electronAPI.exportVnIrodoriBatch({
        doc: snapshot,
        assetIds: assets.map((asset) => asset?.id).filter(Boolean),
      });
      if (result?.canceled) {
        logger?.info?.('音声バッチ出力をキャンセルしました。');
        return;
      }
      if (!result?.ok) {
        const message = `音声バッチ出力失敗: ${result?.error || '音声バッチを出力できませんでした。'}`;
        errorEl.textContent = message;
        logger?.error?.(message);
        return;
      }
      const message = `音声バッチを出力しました: ${result.path} `
        + `(話者 ${result.speakerCount} / Message ${result.messageCount} / ジョブ ${result.jobCount})`;
      errorEl.textContent = message;
      logger?.info?.(message);
    } catch (err) {
      const message = `音声バッチ出力失敗: ${err?.message || err}`;
      errorEl.textContent = message;
      logger?.error?.(message);
    } finally {
      exportButton.disabled = false;
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
    const raw = JSON.parse(JSON.stringify(command));
    return applyCommandDebugFlags(raw, normalizeCommand(raw, assets));
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
      if (editorMode === 'json' && !applyScriptJsonToDoc({ refreshText: true })) return;
      commitCurrentUiToDoc();
      const snapshot = normalizeDoc(doc, assets);
      const referenced = new Set();
      snapshot.scenes.forEach((item) => (item.commands || []).forEach((command) => {
        if (isCommandSkipped(command)) return;
        if ((command.type === 'background' || command.type === 'sprite') && command.assetId) referenced.add(command.assetId);
        if (command.type === 'audio' && command.action === 'play' && command.assetId) referenced.add(command.assetId);
        if (command.type === 'message' && command.voiceAssetId) referenced.add(command.voiceAssetId);
        if (command.type === 'cache' && command.action === 'load' && command.assetId) referenced.add(command.assetId);
      }));
      const urls = {};
      const meta = {};
      await Promise.all([...referenced].map(async (id) => {
        const asset = assetById(id);
        if (!asset) return;
        const isPsg = asset.type === 'psg-song' || asset.type === 'psg-sfx';
        if (!isPsg) {
          const url = await resolveAssetDataUrl(asset);
          if (!url) return;
          urls[id] = url;
        }
        const size = assetPixelSize(asset);
        meta[id] = {
          type: asset.type,
          name: asset.name || asset.id,
          width: size.width,
          height: size.height,
          durationSeconds: audioDurationSeconds(asset),
          adpcmBytes: adpcmRamPayloadBytes(asset),
          loop: Boolean(asset.options?.loop),
        };
        const visualCache = visualCachePayloadInfo(asset);
        meta[id].visualCacheBytes = visualCache.bytes;
        meta[id].visualCachePages = visualCache.pages;
        meta[id].visualCacheParts = visualCache.parts;
        if (asset.type === 'sprite') {
          const anim = spriteAnimationMeta(asset);
          meta[id].cellWidth = anim.cellWidth;
          meta[id].cellHeight = anim.cellHeight;
          meta[id].animations = anim.animations;
        } else if (isPsg) {
          meta[id].psgOptions = asset.options || {};
          meta[id].psgPatternBytes = psgPatternPreviewBytes(asset);
        }
      }));
      const payload = {
        doc: snapshot,
        startScene: selectedId,
        urls,
        meta,
        runtimeCache: {
          visualPageBytes: VN_VISUAL_CACHE_PAGE_BYTES,
          visualPageCount: VN_VISUAL_CACHE_PAGE_COUNT,
          visualTotalBytes: VN_VISUAL_CACHE_TOTAL_BYTES,
          adpcmRamBytes: VN_ADPCM_RAM_BYTES,
          scenePackLimitBytes: vnScenePackLimit,
        },
        scenePackBytesById: Object.fromEntries(snapshot.scenes.map((item) => [item.id, estimateScenePackBytes(item)])),
        screen: { w: PCE_SCREEN_WIDTH, h: PCE_SCREEN_HEIGHT },
        message: MESSAGE_AREA,
        messageWaitGlyph: MESSAGE_WAIT_GLYPH,
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

  function moveScene(sceneId, rawToIndex) {
    if (editorMode === 'json' && !applyScriptJsonToDoc({ refreshText: false })) return;
    commitCurrentUiToDoc();
    const fromIndex = doc.scenes.findIndex((item) => item.id === sceneId);
    if (fromIndex < 0) return;
    let toIndex = clamp(rawToIndex, 0, doc.scenes.length, doc.scenes.length);
    const [item] = doc.scenes.splice(fromIndex, 1);
    if (fromIndex < toIndex) toIndex -= 1;
    doc.scenes.splice(toIndex, 0, item);
    selectedId = item.id;
    render();
  }

  function clearSceneDropState(options = {}) {
    sceneList.querySelectorAll('.is-drop-before, .is-drop-after').forEach((item) => {
      item.classList.remove('is-drop-before', 'is-drop-after');
    });
    if (options.includeDragging) {
      sceneList.querySelectorAll('.is-dragging').forEach((item) => item.classList.remove('is-dragging'));
    }
  }

  function resolveSceneDropIndexFromElement(element, clientY) {
    const row = element?.closest?.('[data-scene-row]');
    if (!row) return null;
    const rowIndex = doc.scenes.findIndex((item) => item.id === row.dataset.sceneRow);
    if (rowIndex < 0) return null;
    const rect = row.getBoundingClientRect();
    return clientY > rect.top + rect.height / 2 ? rowIndex + 1 : rowIndex;
  }

  function resolveSceneDropIndex(event) {
    const directIndex = resolveSceneDropIndexFromElement(event.target, event.clientY);
    if (directIndex != null) return directIndex;
    const pointIndex = resolveSceneDropIndexFromElement(document.elementFromPoint(event.clientX, event.clientY), event.clientY);
    return pointIndex == null ? doc.scenes.length : pointIndex;
  }

  function showSceneDropTarget(index) {
    clearSceneDropState();
    const normalizedIndex = clamp(index, 0, doc.scenes.length, doc.scenes.length);
    const targetId = doc.scenes[normalizedIndex]?.id || doc.scenes[doc.scenes.length - 1]?.id || '';
    const target = Array.from(sceneList.querySelectorAll('[data-scene-row]'))
      .find((row) => row.dataset.sceneRow === targetId);
    target?.classList.add(normalizedIndex >= doc.scenes.length ? 'is-drop-after' : 'is-drop-before');
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

  sceneList.addEventListener('dragstart', (event) => {
    const row = event.target?.closest?.('[data-scene-row]');
    if (!row || event.target?.closest?.('[data-scene-delete]')) return;
    commitCurrentUiToDoc();
    sceneDragId = row.dataset.sceneRow || '';
    if (!sceneDragId) return;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-pce-vn-scene-id', sceneDragId);
      event.dataTransfer.setData('text/plain', sceneDragId);
    }
    row.classList.add('is-dragging');
  });

  sceneList.addEventListener('dragend', () => {
    sceneDragId = '';
    clearSceneDropState({ includeDragging: true });
  });

  sceneList.addEventListener('dragover', (event) => {
    const transferTypes = Array.from(event.dataTransfer?.types || []);
    if (!sceneDragId && !transferTypes.includes('application/x-pce-vn-scene-id')) return;
    const index = resolveSceneDropIndex(event);
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    showSceneDropTarget(index);
  });

  sceneList.addEventListener('dragleave', (event) => {
    if (!sceneList.contains(event.relatedTarget)) clearSceneDropState();
  });

  sceneList.addEventListener('drop', (event) => {
    const sceneId = event.dataTransfer?.getData('application/x-pce-vn-scene-id') || sceneDragId;
    if (!sceneId) return;
    const index = resolveSceneDropIndex(event);
    event.preventDefault();
    clearSceneDropState({ includeDragging: true });
    sceneDragId = '';
    moveScene(sceneId, index);
  });

  sceneNameInput?.addEventListener('input', () => {
    const current = scene();
    if (!current) return;
    current.name = cleanSceneNameInput(sceneNameInput.value);
    root.querySelector('[data-role="scene-title"]').textContent = sceneDisplayName(current);
    renderSceneList();
  });

  sceneNameInput?.addEventListener('change', () => {
    const current = scene();
    if (!current) return;
    const name = normalizeSceneName(sceneNameInput.value);
    if (name) current.name = name;
    else delete current.name;
    sceneNameInput.value = current.name || '';
    root.querySelector('[data-role="scene-title"]').textContent = sceneDisplayName(current);
    renderSceneList();
  });

  sceneIdInput?.addEventListener('input', () => {
    sceneIdInput.value = safeId(sceneIdInput.value, '');
  });

  sceneIdInput?.addEventListener('change', () => {
    commitCurrentUiToDoc();
    renameSceneId(sceneIdInput.value);
  });

  commandLibraryHeader?.addEventListener('click', () => {
    commandLibraryCollapsed = !commandLibraryCollapsed;
    applyCommandLibraryState({ persist: true });
  });

  commandSearchInput?.addEventListener('input', () => {
    commandSearch = commandSearchInput.value;
    renderCommandPalette();
  });

  commandListSearchInput?.addEventListener('input', () => {
    commandListSearch = commandListSearchInput.value;
    renderCommands(scene());
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

  commandsEl.addEventListener('change', (event) => {
    const skipToggle = event.target?.closest?.('[data-command-skip]');
    if (!skipToggle) return;
    const current = scene();
    const index = Number(skipToggle.dataset.commandSkip);
    if (!current || !current.commands[index]) return;
    current.commands[index].skip = Boolean(skipToggle.checked);
    if (!current.commands[index].skip) delete current.commands[index].skip;
    renderCommands(current);
    updateSceneBudget();
    void renderCommandPreview();
  });

  commandsEl.addEventListener('click', (event) => {
    if (suppressCommandClick) {
      suppressCommandClick = false;
      event.preventDefault();
      return;
    }
    if (event.target?.closest?.('[data-command-skip]')) return;
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
    if (event.target?.closest?.('[data-command-skip]')) {
      event.preventDefault();
      return;
    }
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
    if (!row || event.target?.closest?.('[data-command-remove], [data-command-skip]')) return;
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
      || ['type', 'kind', 'action', 'scope', 'assetId', 'animationAssetId', 'slot', 'mode', 'effect', 'voiceAssetId', 'mouthSlot', 'textColorEnabled', 'textColor', 'textColorHex', 'color', 'colorHex'].includes(name);
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
  root.querySelector('[data-action="export-irodori"]').addEventListener('click', () => { void exportIrodoriBatch(); });
  root.querySelectorAll('[data-script-mode]').forEach((button) => {
    button.addEventListener('click', () => setEditorMode(button.dataset.scriptMode));
  });
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
    if (editorMode === 'json' && !applyScriptJsonToDoc({ refreshText: false })) return;
    commitCurrentUiToDoc();
    const id = uniqueSceneId(`scene_${doc.scenes.length + 1}`, doc.scenes.map((item) => item.id), 'scene');
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
    if (editorMode === 'json' && !applyScriptJsonToDoc({ refreshText: false })) return;
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

  const handleWindowResize = () => fitStageNodes();
  window.addEventListener('resize', handleWindowResize);

  registerCapability('visual-novel-editor', { reload: load, save });
  const teardownAssetRefreshEvents = setupAssetRefreshEvents();
  const teardownSystemSettingsEvents = setupSystemSettingsEvents();
  void load();
  return {
    deactivate() {
      teardownAssetRefreshEvents();
      teardownSystemSettingsEvents();
      window.removeEventListener('resize', handleWindowResize);
      stopMessagePreview();
      commandPsgPreviewController.close();
    },
  };
}
