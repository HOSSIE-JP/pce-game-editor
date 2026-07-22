'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('PCE VN preview maps keyboard keys to controller buttons', async () => {
  const modulePath = path.join(root, 'plugins', 'pce-visual-novel-editor', 'preview-input.mjs');
  const { pcePreviewButtonForKeyboardEvent } = await import(pathToFileURL(modulePath).href);
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
  assert.match(preview, /let asyncInputWatcher = null;/);
  assert.match(preview, /if \(t === 'inputcheck'\)/);
  assert.match(preview, /c\.mode === 'cancel'[\s\S]*asyncInputWatcher = null;/);
  assert.match(preview, /c\.mode === 'async'[\s\S]*asyncInputWatcher = inputWatcher\(c\);[\s\S]*pc \+= 1;/);
  assert.match(preview, /syncInputWatcher = inputWatcher\(c\);[\s\S]*return;/);
  assert.match(preview, /inputWatcherMatches\(asyncInputWatcher, button\)[\s\S]*inputWatcherMatches\(syncInputWatcher, button\)/);
  assert.match(preview, /controllerButton && !e\.repeat && handleInputButton\(controllerButton\)/);
  assert.match(preview, /function setScene\(id\)[\s\S]*syncInputWatcher = null;[\s\S]*asyncInputWatcher = null;/);
});
