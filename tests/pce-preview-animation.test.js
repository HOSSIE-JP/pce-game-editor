'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

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
