'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('PCE VN preview maps keyboard keys to controller buttons', async () => {
  const modulePath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'preview-input.mjs');
  const {
    pcePreviewButtonForKeyboardEvent,
    pcePreviewInputMatch,
    pcePreviewRegisterAsyncInputWatcher,
  } = await import(pathToFileURL(modulePath).href);
  const cases = [
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['Space', 'run'],
    ['Enter', 'run'],
    ['NumpadEnter', 'run'],
    ['KeyS', 'run'],
    ['ShiftLeft', 'select'],
    ['ShiftRight', 'select'],
    ['KeyA', 'select'],
    ['KeyZ', 'i'],
    ['KeyX', 'ii'],
  ];

  cases.forEach(([code, button]) => {
    assert.equal(pcePreviewButtonForKeyboardEvent({ code }), button, code);
  });
  assert.equal(pcePreviewButtonForKeyboardEvent({ code: 'KeyQ' }), '');

  const sync = { buttons: ['left'], targetLabel: 'sync-hit' };
  let asyncWatchers = [];
  asyncWatchers = pcePreviewRegisterAsyncInputWatcher(asyncWatchers, {
    buttons: ['run', 'i'],
    targetLabel: 'async-hit-1',
  });
  asyncWatchers = pcePreviewRegisterAsyncInputWatcher(asyncWatchers, {
    buttons: ['right'],
    targetLabel: 'async-hit-2',
  });
  assert.deepEqual(pcePreviewInputMatch(sync, asyncWatchers, 'left'), {
    mode: 'sync',
    targetLabel: 'sync-hit',
  });
  assert.deepEqual(pcePreviewInputMatch(sync, asyncWatchers, 'run'), {
    mode: 'async',
    targetLabel: 'async-hit-1',
  });
  assert.deepEqual(pcePreviewInputMatch(sync, asyncWatchers, 'i'), {
    mode: 'async',
    targetLabel: 'async-hit-1',
  });
  assert.deepEqual(pcePreviewInputMatch(sync, asyncWatchers, 'right'), {
    mode: 'async',
    targetLabel: 'async-hit-2',
  });
  assert.equal(pcePreviewInputMatch(sync, asyncWatchers, 'ii'), null);
  assert.equal(pcePreviewInputMatch(null, null, 'i'), null);

  asyncWatchers = pcePreviewRegisterAsyncInputWatcher(asyncWatchers, {
    buttons: ['i'],
    targetLabel: 'async-i-override',
  });
  assert.deepEqual(asyncWatchers, [
    { buttons: ['run'], targetLabel: 'async-hit-1' },
    { buttons: ['right'], targetLabel: 'async-hit-2' },
    { buttons: ['i'], targetLabel: 'async-i-override' },
  ]);
  assert.deepEqual(pcePreviewInputMatch(sync, asyncWatchers, 'i'), {
    mode: 'async',
    targetLabel: 'async-i-override',
  });
});

test('PCE VN preview executes sync, async, and cancel Input commands', () => {
  const renderer = fs.readFileSync(
    path.join(root, 'plugins', 'pce-visual-novel-editor', 'renderer.js'),
    'utf-8',
  );
  const previewStart = renderer.indexOf('function previewRuntime()');
  const previewEnd = renderer.indexOf('function buildPreviewHtml(payload)');
  assert.notEqual(previewStart, -1);
  assert.notEqual(previewEnd, -1);
  const preview = renderer.slice(previewStart, previewEnd);

  assert.match(preview, /let syncInputWatcher = null;/);
  assert.match(preview, /let asyncInputWatchers = \[\];/);
  assert.match(preview, /if \(t === 'inputcheck'\)/);
  assert.match(preview, /c\.mode === 'cancel'[\s\S]*asyncInputWatchers = \[\];/);
  assert.match(preview, /c\.mode === 'async'[\s\S]*pcePreviewRegisterAsyncInputWatcher\(asyncInputWatchers, inputWatcher\(c\)\)[\s\S]*pc \+= 1;/);
  assert.match(preview, /syncInputWatcher = inputWatcher\(c\);[\s\S]*return;/);
  assert.match(preview, /pcePreviewInputMatch\(syncInputWatcher, asyncInputWatchers, button\)/);
  assert.match(preview, /if \(!match\) return false;[\s\S]*syncInputWatcher = null;[\s\S]*asyncInputWatchers = \[\];[\s\S]*match\.mode === 'async'/);
  assert.match(preview, /controllerButton && !e\.repeat && handleInputButton\(controllerButton\)/);
  assert.match(preview, /function setScene\(id\)[\s\S]*syncInputWatcher = null;[\s\S]*asyncInputWatchers = \[\];/);
  assert.match(renderer, /pcePreviewRegisterAsyncInputWatcher\.toString\(\)/);
  assert.match(renderer, /pcePreviewInputMatch\.toString\(\)/);
});
