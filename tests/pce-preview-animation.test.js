'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function importModalHtml(source) {
  const start = source.indexOf('function openImportSettingsModal');
  assert.notEqual(start, -1);
  const end = source.indexOf("const form = modal.panel.querySelector('form');", start);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

function importSubmitBlock(source) {
  const start = source.indexOf("form.addEventListener('submit'", source.indexOf('function openImportSettingsModal'));
  assert.notEqual(start, -1);
  const end = source.indexOf('modal.open();', start);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test('PCE VN preview plays sprite frameDelays per frame', () => {
  const renderer = fs.readFileSync(path.join(root, 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.match(renderer, /const rawFrameDelays = Array\.isArray\(anim\.frameDelays\) \? anim\.frameDelays : \[\];/);
  assert.match(renderer, /return \{ sheetW, sheetH, frameW, frameH, frames, frameDelay, frameDelays, loop \};/);
  assert.match(renderer, /while \(acc >= frameMsAt\(idx\)\)/);
  assert.doesNotMatch(renderer, /const frameMs = geo\.frameDelay \* \(1000 \/ 60\);/);
});

test('PCE image sprite preview keeps per-frame delays', () => {
  const renderer = fs.readFileSync(path.join(root, 'plugins', 'pce-image-converter', 'image-asset-manager-page.js'), 'utf-8');

  assert.match(renderer, /frameDelays:\s*Array\.from\(\{ length: frameCount \}/);
  assert.match(renderer, /Array\.isArray\(animation\.frameDelays\)/);
  assert.match(renderer, /animation\.frameDelays\[clampInt\(spritePreviewState\.frameIndex/);
});

test('PCE image import uses simplified BG and sprite defaults', () => {
  const renderer = fs.readFileSync(path.join(root, 'plugins', 'pce-image-converter', 'image-asset-manager-page.js'), 'utf-8');
  const modal = importModalHtml(renderer);
  const submit = importSubmitBlock(renderer);

  assert.match(renderer, /const defaultWidth = kind === 'sprite' \? 64 : 224;/);
  assert.match(renderer, /const defaultHeight = kind === 'sprite' \? 128 : 136;/);
  [
    'Palette bank',
    'Tile base',
    '<span class="form-label">X</span>',
    '<span class="form-label">Y</span>',
    'Transparent index',
    'Animation pattern',
    'Frame W',
    'Frame H',
    'Frames',
    'Speed',
  ].forEach((label) => assert.doesNotMatch(modal, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.match(modal, /<span class="form-label">Cell size<\/span>/);
  assert.match(submit, /paletteBank:\s*kind === 'sprite' \? DEFAULT_SPRITE_PALETTE_BANK : 0/);
  assert.match(submit, /tileBase:\s*kind === 'sprite' \? DEFAULT_SPRITE_TILE_BASE : PCE_BG_AUTO_TILE_BASE/);
  assert.match(submit, /x:\s*kind === 'sprite' \? DEFAULT_SPRITE_X : 0/);
  assert.match(submit, /y:\s*kind === 'sprite' \? DEFAULT_SPRITE_Y : 0/);
  assert.match(submit, /transparentIndex:\s*kind === 'sprite' \? DEFAULT_SPRITE_TRANSPARENT_INDEX : 0/);
  assert.match(submit, /frameWidth:\s*animFrameWidth/);
  assert.match(submit, /frameHeight:\s*animFrameHeight/);
  assert.match(submit, /frameCount:\s*DEFAULT_IMPORT_FRAME_COUNT/);
  assert.match(submit, /frameDelay:\s*DEFAULT_IMPORT_FRAME_DELAY/);
});

test('PCE sprite editor import modal keeps animation fields in the editor', () => {
  const spritePage = fs.readFileSync(path.join(root, 'plugins', 'pce-sprite-manager', 'sprite-editor-page.js'), 'utf-8');
  const modal = importModalHtml(spritePage);
  const submit = importSubmitBlock(spritePage);

  [
    'Palette bank',
    'Tile base',
    '<span class="form-label">X</span>',
    '<span class="form-label">Y</span>',
    'Transparent index',
    'Frame W',
    'Frame H',
    'Frames',
    'Speed',
  ].forEach((label) => assert.doesNotMatch(modal, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.match(modal, /<span class="form-label">Cell size<\/span>/);
  assert.match(modal, /<span class="form-label">Output width<\/span>/);
  assert.match(modal, /<span class="form-label">Output height<\/span>/);
  assert.match(submit, /paletteBank:\s*DEFAULT_SPRITE_PALETTE_BANK/);
  assert.match(submit, /tileBase:\s*DEFAULT_TILE_BASE/);
  assert.match(submit, /x:\s*DEFAULT_SPRITE_X/);
  assert.match(submit, /y:\s*DEFAULT_SPRITE_Y/);
  assert.match(submit, /transparentIndex:\s*DEFAULT_SPRITE_TRANSPARENT_INDEX/);
  assert.match(submit, /const frameWidth = DEFAULT_IMPORT_FRAME_WIDTH;/);
  assert.match(submit, /const frameHeight = DEFAULT_IMPORT_FRAME_HEIGHT;/);
  assert.match(submit, /frameWidth,/);
  assert.match(submit, /frameHeight,/);
  assert.match(submit, /frameCount:\s*DEFAULT_IMPORT_FRAME_COUNT/);
  assert.match(submit, /frameDelay:\s*DEFAULT_IMPORT_FRAME_DELAY/);
});
