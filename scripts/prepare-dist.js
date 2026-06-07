'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const appRoot = path.resolve(__dirname, '..');

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function injectBuildMeta() {
  runOrThrow(process.execPath, [path.join(appRoot, 'scripts', 'inject-build-meta.js')], {
    cwd: appRoot,
  });
}

function main() {
  console.log('=== Prepare PCE Game Editor Distribution Assets ===');
  injectBuildMeta();
  console.log('=== Prepare completed ===');
}

main();
