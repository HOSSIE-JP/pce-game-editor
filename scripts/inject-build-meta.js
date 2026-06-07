'use strict';

/**
 * inject-build-meta.js
 *
 * ビルド番号（タイムスタンプ）を pce-game-editor/build-meta.json に書き出す。
 * `npm start` および `prepare:dist` から呼び出される。
 *
 * 生成フォーマット: YYYYMMDD.HHmmss (例: 20260427.143022)
 */

const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const outPath = path.join(appRoot, 'build-meta.json');

function zeroPad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function formatBuildNumber(date) {
  const y = date.getUTCFullYear();
  const mo = zeroPad(date.getUTCMonth() + 1);
  const d = zeroPad(date.getUTCDate());
  const h = zeroPad(date.getUTCHours());
  const mi = zeroPad(date.getUTCMinutes());
  const s = zeroPad(date.getUTCSeconds());
  return `${y}${mo}${d}.${h}${mi}${s}`;
}

const now = new Date();
const buildNumber = formatBuildNumber(now);
const meta = {
  buildNumber,
  buildAt: now.toISOString(),
};

fs.writeFileSync(outPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
console.log(`Build meta injected: ${buildNumber} (${meta.buildAt})`);
