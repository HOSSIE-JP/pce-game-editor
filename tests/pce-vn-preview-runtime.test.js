'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Blob } = require('node:buffer');
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
  const nextSpriteRowSource = sourceBetween(
    'function nextSpriteAnimationRowId(source, animationId)',
    'function defaultCharacterPlacement(asset)',
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
  const nextSpriteAnimationRowId = evaluateFunction(nextSpriteRowSource);
  const rows = { animations: [{ id: 'default' }, { id: 'mouth' }, { id: 'blink' }] };
  assert.equal(nextSpriteAnimationRowId(rows, 'default'), 'mouth');
  assert.equal(nextSpriteAnimationRowId(rows, 'mouth'), 'blink');
  assert.equal(nextSpriteAnimationRowId(rows, 'blink'), '');

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

test('PCE VN playback preview identifies only commands that need binary asset data', async () => {
  const assetIdSource = sourceBetween(
    'function pcePreviewAssetIdForCommand(command = {})',
    'function pcePreviewDataUrlToBlob(dataUrl = \'\')',
  );
  const dataUrlSource = sourceBetween(
    'function pcePreviewDataUrlToBlob(dataUrl = \'\')',
    '// 編集専用のコメント色',
  );
  const assetIdForCommand = evaluateFunction(assetIdSource);
  const dataUrlToBlob = evaluateFunction(dataUrlSource, {
    Blob,
    Uint8Array,
    atob: (value) => Buffer.from(value, 'base64').toString('latin1'),
  });

  assert.equal(assetIdForCommand({ type: 'background', assetId: 'bg' }), 'bg');
  assert.equal(assetIdForCommand({ type: 'sprite', assetId: 'actor', visible: true }), 'actor');
  assert.equal(assetIdForCommand({ type: 'sprite', assetId: 'actor', visible: false }), '');
  assert.equal(assetIdForCommand({ type: 'audio', action: 'play', kind: 'adpcm', assetId: 'voice' }), 'voice');
  assert.equal(assetIdForCommand({ type: 'audio', action: 'play', kind: 'psg', assetId: 'bgm' }), '');
  assert.equal(assetIdForCommand({ type: 'message', voiceAssetId: 'line' }), 'line');
  assert.equal(assetIdForCommand({ type: 'cache', action: 'load', assetId: 'cached' }), '');

  const blob = dataUrlToBlob('data:text/plain;base64,cHJldmlldw==');
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'text/plain');
  assert.equal(await blob.text(), 'preview');
});

test('PCE VN playback preview defers referenced asset data instead of embedding every Data URL', () => {
  const openPreviewSource = sourceBetween(
    'async function openScenePreview()',
    'function removeCommand(index)',
  );
  const previewRuntimeSource = sourceBetween(
    'function previewRuntime()',
    'function buildPreviewHtml(payload)',
  );

  assert.match(openPreviewSource, /referenced\.forEach\(\(id\) => \{/);
  assert.match(openPreviewSource, /urls: \{\}/);
  assert.match(openPreviewSource, /createPreviewAssetSession\(win, referenced\)/);
  assert.match(openPreviewSource, /payload\.assetSessionId = previewSessionId/);
  assert.doesNotMatch(openPreviewSource, /Promise\.all\(\[\.\.\.referenced\]/);
  assert.doesNotMatch(openPreviewSource, /resolveAssetDataUrl\(/);
  assert.match(previewRuntimeSource, /function requestPreviewAssetUrl\(assetId\)/);
  assert.match(previewRuntimeSource, /pcePreviewAssetIdForCommand\(c\)/);
  assert.match(previewRuntimeSource, /waitForPreviewAsset\(requiredAssetId\)/);
  assert.match(previewRuntimeSource, /URL\.createObjectURL\(message\.blob\)/);
  assert.match(previewRuntimeSource, /action: 'release'/);
});

test('PCE VN preview keeps CD-DA and PSG BGM mutually exclusive', async () => {
  const audioModulePath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'preview-audio.mjs');
  const { pcePreviewBgmConflict } = await import(pathToFileURL(audioModulePath).href);

  assert.deepEqual(pcePreviewBgmConflict('psg', 'psg-song'), { kind: 'cdda', target: 'all' });
  assert.deepEqual(pcePreviewBgmConflict('cdda', 'cdda-track'), { kind: 'psg', target: 'bgm' });
  assert.equal(pcePreviewBgmConflict('psg', 'psg-sfx'), null);
  assert.equal(pcePreviewBgmConflict('adpcm', 'adpcm'), null);
});

test('PCE VN preview keeps PSG BGM alive while PSG SFX starts and stops', async () => {
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = {};
    }

    createOscillator() {
      return {
        frequency: { setValueAtTime() {} },
        connect(target) { return target; },
        start() {},
        stop() {},
        disconnect() {},
      };
    }

    createGain() {
      return {
        gain: {
          cancelScheduledValues() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect(target) { return target; },
      };
    }
  }

  const psgRuntimeSource = sourceBetween(
    'const PSG_CLOCK = 3579545;',
    'function rememberVariable(name, initialValue, isDefinition)',
  );
  const context = {
    data: {
      meta: {
        song: { type: 'psg-song', psgOptions: { steps: 1, bpm: 150, pattern: [{ step: 0, channel: 0, period: 512, volume: 16 }] } },
        sfx: { type: 'psg-sfx', psgOptions: { steps: 1, bpm: 150, pattern: [{ step: 0, channel: 1, period: 384, volume: 16 }] } },
      },
    },
    messageAdvanceMode: 'button',
    pcePreviewBgmConflict: (kind, assetType) => (kind === 'psg' && assetType === 'psg-song' ? { kind: 'cdda', target: 'all' } : null),
    psgPreviewNoiseHz: () => 1,
    stopAudio() {},
    setTimeout: () => ({}),
    clearTimeout() {},
    window: { AudioContext: FakeAudioContext },
  };
  vm.runInNewContext(`${psgRuntimeSource}
    globalThis.psgPreviewTest = {
      play: playPsgPreview,
      stop: stopPsgPreview,
      states: () => psgStates,
    };`, context);

  await context.psgPreviewTest.play('song', true);
  const bgmState = context.psgPreviewTest.states().bgm;
  assert.ok(bgmState);
  assert.equal(context.psgPreviewTest.states().sfx, null);

  await context.psgPreviewTest.play('sfx', false);
  assert.equal(context.psgPreviewTest.states().bgm, bgmState);
  assert.ok(context.psgPreviewTest.states().sfx);

  assert.equal(context.psgPreviewTest.stop('sfx'), true);
  assert.equal(context.psgPreviewTest.states().bgm, bgmState);
  assert.equal(context.psgPreviewTest.states().sfx, null);
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

test('PCE VN previews show a steady AUTO indicator instead of the blinking wait cursor', () => {
  const previewRuntimeSource = sourceBetween(
    'function previewRuntime()',
    'function buildPreviewHtml(payload)',
  );
  const messageOverlaySource = sourceBetween(
    'function paintMessageOverlay(overlay, text',
    'function fitStageNodes()',
  );

  assert.match(renderer, /const MESSAGE_AUTO_GLYPH = '◆';/);
  assert.match(renderer, /messageAutoGlyph: MESSAGE_AUTO_GLYPH/);
  assert.match(previewRuntimeSource, /const messageAutoGlyph = String\(data\.messageAutoGlyph \|\| '◆'\)/);
  assert.match(previewRuntimeSource, /indicatorBlinks \? 'pv-wait-cursor' : 'pv-auto-indicator'/);
  assert.match(previewRuntimeSource, /autoEnabled \? messageAutoGlyph : messageWaitGlyph, !autoEnabled/);
  assert.match(previewRuntimeSource, /getVar\('AUTO_ENABLE'\) === 1 \? messageAutoGlyph : ''/);
  assert.match(messageOverlaySource, /autoPreview \? MESSAGE_AUTO_GLYPH : MESSAGE_WAIT_GLYPH/);
  assert.match(messageOverlaySource, /indicatorBlinks \? 'pce-vn-msg-wait-cursor' : 'pce-vn-msg-auto-indicator'/);
});

test('PCE VN playback preview skips display-equivalent BG and Sprite commands', () => {
  const previewRuntimeSource = sourceBetween(
    'function previewRuntime()',
    'function buildPreviewHtml(payload)',
  );

  assert.match(previewRuntimeSource, /const bgFadeFrameOptions = \[1, 20, 30, 40, 50, 60\];/);
  assert.match(
    previewRuntimeSource,
    /function bgFadeFrames\(value\)[\s\S]*const normalized = bgFadeFrameOptions\.reduce[\s\S]*return normalized === 1 \? 0 : normalized;/,
  );

  assert.match(
    previewRuntimeSource,
    /function backgroundCommandMatchesDisplay\(c\)[\s\S]*current\.assetId === c\.assetId[\s\S]*current\.fullScreen === Boolean\(scene && scene\.fullScreenBg\)/,
  );
  assert.match(previewRuntimeSource, /let displaySuppressed = false;/);
  assert.match(
    previewRuntimeSource,
    /function backgroundCommandMatchesDisplay\(c\) \{\s*if \(displaySuppressed\) return false;/,
  );
  assert.match(
    previewRuntimeSource,
    /function spriteCommandMatchesDisplay\(c\)[\s\S]*spriteMoveTimers\.has\(slot\)[\s\S]*current\.flipX[\s\S]*current\.flipY[\s\S]*current\.animationId/,
  );
  assert.match(
    previewRuntimeSource,
    /function spriteCommandMatchesDisplay\(c\) \{\s*if \(displaySuppressed\) return false;/,
  );
  assert.match(
    previewRuntimeSource,
    /function applyBackground\(c\)[\s\S]*const revealSuppressedDisplay = displaySuppressed;[\s\S]*if \(revealSuppressedDisplay\) \{[\s\S]*displaySuppressed = false;[\s\S]*effectLayer\.style\.opacity = '0';/,
  );
  assert.match(
    previewRuntimeSource,
    /if \(c\.effect === 'fadeOut'\) \{\s*displaySuppressed = true;[\s\S]*else if \(c\.effect === 'fadeIn'\) \{\s*displaySuppressed = false;/,
  );
  assert.match(
    previewRuntimeSource,
    /if \(t === 'background'\) \{[\s\S]*pc \+= 1;[\s\S]*if \(backgroundCommandMatchesDisplay\(c\)\) continue;[\s\S]*recordVisualDisplay\(c\.assetId, 'bg', 'BG'\);[\s\S]*applyBackground\(c\);/,
  );
  assert.match(
    previewRuntimeSource,
    /if \(t === 'sprite'\) \{[\s\S]*if \(spriteCommandMatchesDisplay\(c\)\) \{ pc \+= 1; continue; \}[\s\S]*cancelSpriteMove\(c\.slot\);[\s\S]*renderStage\(\);/,
  );
});

test('PCE VN preview clears SpriteText on every scene transition', () => {
  const previewRuntimeSource = sourceBetween(
    'function previewRuntime()',
    'function buildPreviewHtml(payload)',
  );
  const setSceneStart = previewRuntimeSource.indexOf('function setScene(id)');
  const setSceneEnd = previewRuntimeSource.indexOf('function applyVar(c)', setSceneStart);
  assert.notEqual(setSceneStart, -1);
  assert.notEqual(setSceneEnd, -1);
  const setSceneSource = previewRuntimeSource.slice(setSceneStart, setSceneEnd).trim();

  let renderCalls = 0;
  const context = {
    cancelAllSpriteMoves() {},
    hideMsg() {},
    hideChoice() {},
    renderStage() { renderCalls += 1; },
    updateCacheDebug() {},
    scenesById: { next: { id: 'next', fullScreenBg: false } },
  };
  vm.runInNewContext(`
    let syncInputWatcher = { stale: true };
    let asyncInputWatchers = ['stale'];
    let scene = { id: 'old' };
    let sceneId = 'old';
    let pc = 9;
    let state = {
      background: null,
      sprites: { 1: { slot: 1, assetId: 'actor' } },
      spriteTexts: { 0: { slot: 0, text: 'OLD SCENE' } },
    };
    ${setSceneSource}
    globalThis.invokeSetScene = setScene;
    globalThis.readSetSceneState = () => ({ scene, sceneId, pc, state, syncInputWatcher, asyncInputWatchers });
  `, context);

  context.invokeSetScene('next');
  const after = context.readSetSceneState();
  assert.equal(after.sceneId, 'next');
  assert.equal(after.pc, 0);
  assert.deepEqual(Object.keys(after.state.spriteTexts), []);
  assert.equal(JSON.stringify(after.state.sprites), JSON.stringify({ 1: { slot: 1, assetId: 'actor' } }));
  assert.deepEqual(after.syncInputWatcher, null);
  assert.deepEqual(Array.from(after.asyncInputWatchers), []);
  assert.equal(renderCalls, 1);
});

test('PCE VN preview HTML injects every standalone runtime dependency', async () => {
  const renderSpriteTextSource = sourceBetween(
    'function renderSpriteTextCells(node, text)',
    'function psgPreviewNoiseHz(value)',
  );
  const psgNoiseSource = sourceBetween(
    'function psgPreviewNoiseHz(value)',
    'function pcePreviewAssetIdForCommand(command = {})',
  );
  const spriteGeometrySource = sourceBetween(
    'function spriteFrameGeometry(source, animationId)',
    'function applySpriteFrame(node, url, geo, flipX, flipY)',
  );
  const applySpriteSource = sourceBetween(
    'function applySpriteFrame(node, url, geo, flipX, flipY)',
    'function computeVisualState(commands = [], uptoIndex = -1, fullScreenBg = false)',
  );
  const nextSpriteRowSource = sourceBetween(
    'function nextSpriteAnimationRowId(source, animationId)',
    'function defaultCharacterPlacement(asset)',
  );
  const previewAssetIdSource = sourceBetween(
    'function pcePreviewAssetIdForCommand(command = {})',
    'function pcePreviewDataUrlToBlob(dataUrl = \'\')',
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
    pcePreviewRegisterAsyncInputWatcher,
  } = await import(pathToFileURL(inputModulePath).href);
  const { pcePreviewBgmConflict } = await import(pathToFileURL(audioModulePath).href);

  const renderSpriteTextCells = evaluateFunction(renderSpriteTextSource);
  const psgPreviewNoiseHz = evaluateFunction(psgNoiseSource);
  const spriteFrameGeometry = evaluateFunction(spriteGeometrySource);
  const applySpriteFrame = evaluateFunction(applySpriteSource);
  const nextSpriteAnimationRowId = evaluateFunction(nextSpriteRowSource);
  const pcePreviewAssetIdForCommand = evaluateFunction(previewAssetIdSource);
  const previewRuntime = evaluateFunction(previewRuntimeSource);
  const buildPreviewHtml = evaluateFunction(buildPreviewHtmlSource, {
    PREVIEW_KEYBOARD_BUTTON_BY_CODE,
    pcePreviewButtonForKeyboardEvent,
    pcePreviewInputMatch,
    pcePreviewRegisterAsyncInputWatcher,
    pcePreviewBgmConflict,
    pcePreviewAssetIdForCommand,
    renderSpriteTextCells,
    psgPreviewNoiseHz,
    spriteFrameGeometry,
    nextSpriteAnimationRowId,
    applySpriteFrame,
    previewRuntime,
  });

  const html = buildPreviewHtml({ doc: { scenes: [] }, urls: {}, meta: {} });
  assert.match(html, /function pcePreviewRegisterAsyncInputWatcher/);
  assert.match(html, /function pcePreviewInputMatch/);
  assert.match(html, /function pcePreviewBgmConflict/);
  assert.match(html, /function pcePreviewAssetIdForCommand/);
  assert.match(html, /function renderSpriteTextCells/);
  assert.match(html, /function psgPreviewNoiseHz/);
  assert.match(html, /function spriteFrameGeometry/);
  assert.match(html, /function nextSpriteAnimationRowId/);
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
  assert.equal(
    vm.runInContext("pcePreviewRegisterAsyncInputWatcher([], { buttons: ['run'], targetLabel: 'async-hit' })[0].targetLabel", popupContext),
    'async-hit',
  );
  assert.equal(vm.runInContext("pcePreviewInputMatch({ buttons: ['i'], targetLabel: 'hit' }, null, 'i').targetLabel", popupContext), 'hit');
  assert.equal(vm.runInContext("pcePreviewBgmConflict('psg', 'psg-song').kind", popupContext), 'cdda');
  assert.ok(vm.runInContext('psgPreviewNoiseHz(31)', popupContext) > vm.runInContext('psgPreviewNoiseHz(0)', popupContext));

  assert.match(previewRuntimeSource, /psgPreviewNoiseHz\(cell\.period & 0x1f\)/);
  assert.doesNotMatch(previewRuntimeSource, /psgNoiseHzFromValue/);
  assert.match(previewRuntimeSource, /const bus = meta\.type === 'psg-song' \? 'bgm' : 'sfx';/);
  assert.match(previewRuntimeSource, /pcePreviewBgmConflict\('psg', meta\.type\)/);
  assert.match(previewRuntimeSource, /pcePreviewBgmConflict\(kind, data\.meta\[assetId\]\?\.type\)/);
  assert.match(previewRuntimeSource, /function stopPsgPreview\(target = 'all'\)/);
  assert.match(previewRuntimeSource, /const psgStates = \{ bgm: null, sfx: null \};/);
});
