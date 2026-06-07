'use strict';

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const appDir = path.resolve(__dirname, '..');

function runNodeScript(scriptName) {
  const result = spawnSync(process.execPath, [path.join(appDir, 'scripts', scriptName)], {
    cwd: appDir,
    stdio: 'inherit',
    windowsHide: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function resolveElectronCommand() {
  const electron = require('electron');
  if (typeof electron === 'string') return electron;
  if (typeof electron?.default === 'string') return electron.default;
  return 'electron';
}

runNodeScript('inject-build-meta.js');

const child = spawn(resolveElectronCommand(), ['.'], {
  cwd: appDir,
  stdio: 'inherit',
  windowsHide: false,
});

let stopping = false;

function stopChild(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;

  try {
    child.kill(signal);
  } catch (_) {
  }

  const forceTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch (_) {
    }
  }, 3000);
  forceTimer.unref?.();
}

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code !== null) {
    process.exit(code);
  }
  process.exit(signal ? 0 : 1);
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
  process.once(signal, () => stopChild(signal));
});
