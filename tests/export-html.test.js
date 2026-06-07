'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readMain() {
  return fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
}

test('exported HTML defaults to project title filename', () => {
  const main = readMain();

  assert.match(main, /function sanitizeExportFileName\(value,\s*fallback = 'rom'\)/);
  assert.match(main, /const projectName = cfg\?\.title \|\| cfg\?\.romName \|\| cfg\?\.name \|\| buildSystem\.getProjectInfo\(\)\?\.projectName/);
  assert.match(main, /suggested = `\$\{sanitizeExportFileName\(projectName,\s*'rom'\)\}\.html`/);
});

test('export handlers use the last built ROM without triggering a build', () => {
  const main = readMain();

  const romHandler = main.match(/async function handleExportRom\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const htmlHandler = main.match(/async function handleExportHtml\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(romHandler, /buildSystem\.getLastRomPath\(\)/);
  assert.match(htmlHandler, /buildSystem\.getLastRomPath\(\)/);
  assert.doesNotMatch(romHandler, /runBuildFull\(/);
  assert.doesNotMatch(htmlHandler, /runBuildFull\(/);
  assert.match(romHandler, /エクスポートできるビルド済み ROM がありません/);
  assert.match(htmlHandler, /エクスポートできるビルド済み ROM がありません/);
});

test('exported HTML includes mobile controls and collapsed ROM information', () => {
  const main = readMain();

  assert.match(main, /<div class="virtual-gamepad" aria-label="Virtual gamepad">/);
  assert.match(main, /<div class="analog-stick" data-stick="direction" role="application"/);
  assert.match(main, /<span class="stick-thumb" aria-hidden="true"><\/span>/);
  assert.match(main, /data-btn="a"/);
  assert.match(main, /data-btn="start"/);
  assert.match(main, /<div class="screen-rotator">\s*<canvas id="screen"/);
  assert.match(main, /<button id="fsFullscreen"[\s\S]*<\/button>\s*<\/div>\s*<\/div>/);
  assert.match(main, /\.screen-stage:fullscreen \.screen-rotator/);
  assert.match(main, /\.screen-stage:fullscreen \.virtual-gamepad/);
  assert.match(main, /<button id="fsFullscreen" class="fs-stage-btn fs-fullscreen-btn"/);
  assert.match(main, /<button id="downloadRom" title="ROM をダウンロード">Download ROM<\/button>[\s\S]*<button id="helpBtn" title="ヘルプを表示">Help<\/button>[\s\S]*<button id="fullscreen"/);
  assert.doesNotMatch(main, /id="fsRotate"/);
  assert.doesNotMatch(main, /id="rotateScreen"/);
  assert.match(main, /<details class="rom-panel">\s*<summary>ROM Information<\/summary>/);
  assert.doesNotMatch(main, /<section class="rom-panel">[\s\S]*<h2>ROM Information<\/h2>/);
});
