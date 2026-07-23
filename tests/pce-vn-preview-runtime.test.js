'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const rendererPath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'renderer.js');
const renderer = fs.readFileSync(rendererPath, 'utf-8');

function sourceBetween(startMarker, endMarker) {
  const start = renderer.indexOf(startMarker);
  const end = renderer.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return renderer.slice(start, end).trim();
}

function evaluateFunction(source, context = {}) {
  return vm.runInNewContext(`(${source}\n)`, context);
}

function createElement() {
  return {
    children: [],
    style: {},
    textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
  };
}

test('PCE VN preview serialized Sprite and SpriteText helpers are self-contained', () => {
  const renderSpriteTextSource = sourceBetween(
    'function renderSpriteTextCells(node, text)',
    'function psgPreviewNoiseHz(value)',
  );
  const spriteGeometrySource = sourceBetween(
    'function spriteFrameGeometry(source, animationId)',
    'function applySpriteFrame(node, url, geo, flipX, flipY)',
  );
  const applySpriteSource = sourceBetween(
    'function applySpriteFrame(node, url, geo, flipX, flipY)',
    'function computeVisualState(commands = [], uptoIndex = -1, fullScreenBg = false)',
  );

  assert.doesNotMatch(renderSpriteTextSource, /SPRITETEXT_CELL/);
  assert.doesNotMatch(spriteGeometrySource, /MAX_SPRITE_FRAME_DELAY/);
  assert.doesNotMatch(applySpriteSource, /MAX_SPRITE_FRAME_DELAY/);

  const document = { createElement };
  const renderSpriteTextCells = evaluateFunction(renderSpriteTextSource, { document });
  const textRoot = createElement();
  renderSpriteTextCells(textRoot, 'A\nB');
  assert.equal(textRoot.children.length, 2);
  assert.equal(textRoot.children[0].style.height, '16px');
  assert.equal(textRoot.children[0].children[0].style.width, '12px');
  assert.equal(textRoot.children[1].children[0].textContent, 'B');

  const spriteFrameGeometry = evaluateFunction(spriteGeometrySource);
  const geo = spriteFrameGeometry({
    width: 64,
    height: 32,
    cellWidth: 16,
    cellHeight: 16,
    animations: [{
      id: 'walk',
      frameWidth: 16,
      frameHeight: 16,
      frameCount: 2,
      frameDelay: 70000,
      frameDelays: [70000, 2],
    }],
  }, 'walk');
  assert.equal(geo.frameDelay, 0xffff);
  assert.deepEqual(Array.from(geo.frameDelays), [0xffff, 2]);

  let now = 0;
  const callbacks = [];
  const applySpriteFrame = evaluateFunction(applySpriteSource, {
    performance: { now: () => { now += 1000; return now; } },
    requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
  });
  const spriteNode = { style: {}, isConnected: true };
  applySpriteFrame(spriteNode, 'sprite.png', {
    sheetW: 32,
    sheetH: 16,
    frameW: 16,
    frameH: 16,
    frames: [{ x: 0, y: 0 }, { x: 16, y: 0 }],
    frameDelay: 1,
    frameDelays: [1, 1],
    loop: true,
  }, false, false);
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(callbacks.length, 1);
});

test('PCE VN preview keeps CD-DA and PSG BGM mutually exclusive', async () => {
  const audioModulePath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'preview-audio.mjs');
  const { pcePreviewBgmConflict } = await import(pathToFileURL(audioModulePath).href);

  assert.deepEqual(pcePreviewBgmConflict('psg', 'psg-song'), { kind: 'cdda', target: 'all' });
  assert.deepEqual(pcePreviewBgmConflict('cdda', 'cdda-track'), { kind: 'psg', target: 'bgm' });
  assert.equal(pcePreviewBgmConflict('psg', 'psg-sfx'), null);
  assert.equal(pcePreviewBgmConflict('adpcm', 'adpcm'), null);
});

test('PCE VN preview clamps reserved variable writes', () => {
  const variableRuntimeSource = sourceBetween(
    'function s16(value)',
    'const runtimeCache = data.runtimeCache || {};',
  );
  const context = {};
  vm.runInNewContext(`
    let vars = {};
    const variableNames = ['AUTO_ENABLE', 'MSG_SPEED', 'user_flag'];
    const variableInitialValues = { AUTO_ENABLE: 1, MSG_SPEED: 0, user_flag: -12 };
    ${variableRuntimeSource}
    const initial = initialVars();
    setVar('AUTO_ENABLE', 8);
    setVar('MSG_SPEED', -4);
    setVar('user_flag', 40000);
    result = JSON.stringify({ initial, vars });
  `, context);

  assert.deepEqual(JSON.parse(context.result), {
    initial: { AUTO_ENABLE: 1, MSG_SPEED: 0, user_flag: -12 },
    vars: { AUTO_ENABLE: 1, MSG_SPEED: 0, user_flag: -25536 },
  });
});

test('PCE VN preview HTML injects every standalone runtime dependency', async () => {
  const renderSpriteTextSource = sourceBetween(
    'function renderSpriteTextCells(node, text)',
    'function psgPreviewNoiseHz(value)',
  );
  const psgNoiseSource = sourceBetween(
    'function psgPreviewNoiseHz(value)',
    '// 編集専用のコメント色',
  );
  const spriteGeometrySource = sourceBetween(
    'function spriteFrameGeometry(source, animationId)',
    'function applySpriteFrame(node, url, geo, flipX, flipY)',
  );
  const applySpriteSource = sourceBetween(
    'function applySpriteFrame(node, url, geo, flipX, flipY)',
    'function computeVisualState(commands = [], uptoIndex = -1, fullScreenBg = false)',
  );
  const previewRuntimeSource = sourceBetween(
    'function previewRuntime()',
    'function buildPreviewHtml(payload)',
  );
  const buildPreviewHtmlSource = sourceBetween(
    'function buildPreviewHtml(payload)',
    'export function activatePlugin',
  );
  const inputModulePath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'preview-input.mjs');
  const audioModulePath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'preview-audio.mjs');
  const {
    PREVIEW_KEYBOARD_BUTTON_BY_CODE,
    pcePreviewButtonForKeyboardEvent,
    pcePreviewInputMatch,
  } = await import(pathToFileURL(inputModulePath).href);
  const { pcePreviewBgmConflict } = await import(pathToFileURL(audioModulePath).href);

  const renderSpriteTextCells = evaluateFunction(renderSpriteTextSource);
  const psgPreviewNoiseHz = evaluateFunction(psgNoiseSource);
  const spriteFrameGeometry = evaluateFunction(spriteGeometrySource);
  const applySpriteFrame = evaluateFunction(applySpriteSource);
  const previewRuntime = evaluateFunction(previewRuntimeSource);
  const buildPreviewHtml = evaluateFunction(buildPreviewHtmlSource, {
    PREVIEW_KEYBOARD_BUTTON_BY_CODE,
    pcePreviewButtonForKeyboardEvent,
    pcePreviewInputMatch,
    pcePreviewBgmConflict,
    renderSpriteTextCells,
    psgPreviewNoiseHz,
    spriteFrameGeometry,
    applySpriteFrame,
    previewRuntime,
  });

  const html = buildPreviewHtml({ doc: { scenes: [] }, urls: {}, meta: {} });
  assert.match(html, /function pcePreviewInputMatch/);
  assert.match(html, /function pcePreviewBgmConflict/);
  assert.match(html, /function renderSpriteTextCells/);
  assert.match(html, /function psgPreviewNoiseHz/);
  assert.match(html, /function spriteFrameGeometry/);
  assert.match(html, /function applySpriteFrame/);

  const helperScripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1]);
  assert.equal(helperScripts.length, 4);
  const popupContext = vm.createContext({
    document: { createElement },
    window: {},
  });
  vm.runInContext(helperScripts[1], popupContext);
  vm.runInContext(helperScripts[2], popupContext);
  assert.equal(vm.runInContext("pcePreviewButtonForKeyboardEvent({ code: 'KeyZ' })", popupContext), 'i');
  assert.equal(vm.runInContext("pcePreviewInputMatch({ buttons: ['i'], targetLabel: 'hit' }, null, 'i').targetLabel", popupContext), 'hit');
  assert.equal(vm.runInContext("pcePreviewBgmConflict('psg', 'psg-song').kind", popupContext), 'cdda');
  assert.ok(vm.runInContext('psgPreviewNoiseHz(31)', popupContext) > vm.runInContext('psgPreviewNoiseHz(0)', popupContext));

  assert.match(previewRuntimeSource, /psgPreviewNoiseHz\(cell\.period & 0x1f\)/);
  assert.doesNotMatch(previewRuntimeSource, /psgNoiseHzFromValue/);
  assert.match(previewRuntimeSource, /const bus = meta\.type === 'psg-song' \? 'bgm' : 'sfx';/);
  assert.match(previewRuntimeSource, /pcePreviewBgmConflict\('psg', meta\.type\)/);
  assert.match(previewRuntimeSource, /pcePreviewBgmConflict\(kind, data\.meta\[assetId\]\?\.type\)/);
  assert.match(previewRuntimeSource, /function stopPsgPreview\(target = 'all'\)/);
  assert.match(previewRuntimeSource, /normalizedTarget !== 'all' && stateRef\.bus !== normalizedTarget/);
});
