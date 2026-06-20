'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pluginDir = path.join(__dirname, '..', 'plugins', 'pce-external-emulator');
const defaultGeargrafxPath = process.platform === 'darwin'
  ? '/Applications/Geargrafx.app/Contents/MacOS/geargrafx'
  : '';

test('PCE external emulator exposes a Test Play role plugin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf-8'));

  assert.equal(manifest.id, 'pce-external-emulator');
  assert.deepEqual(manifest.supportedCores, ['pc-engine']);
  assert.deepEqual(manifest.roles, [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 21 }]);
  assert.deepEqual(manifest.hooks, ['onTestPlay']);
});

test('PCE external emulator parses extra args and appends ROM when no placeholder exists', () => {
  const plugin = require(path.join(pluginDir, 'index.js'));

  assert.deepEqual(
    plugin.splitCommandLineArgs('--fullscreen "--scale 2" --flag=value'),
    ['--fullscreen', '--scale 2', '--flag=value'],
  );
  assert.deepEqual(
    plugin.buildLaunchArgs('--fullscreen', '/tmp/game.cue'),
    ['--fullscreen', '/tmp/game.cue'],
  );
  assert.deepEqual(
    plugin.buildLaunchArgs('--load={rom} --name "%ROM%"', '/tmp/game.cue'),
    ['--load=/tmp/game.cue', '--name', '/tmp/game.cue'],
  );
});

test('PCE external emulator launches using project settings and generated ROM path', async () => {
  const plugin = require(path.join(pluginDir, 'index.js'));
  let launchOptions = null;

  const result = await plugin.onTestPlay({ romPath: '/tmp/out/game.cue' }, {
    testPlay: {
      getProjectConfig: async () => ({
        testPlay: {
          externalEmulator: {
            executablePath: '/Applications/Geargrafx.app',
            extraArgs: '--fullscreen',
          },
        },
      }),
      launchExternalEmulator: async (options) => {
        launchOptions = options;
        return { ok: true, launched: true };
      },
    },
  });

  assert.deepEqual(launchOptions, {
    executablePath: '/Applications/Geargrafx.app',
    args: ['--fullscreen', '/tmp/out/game.cue'],
    romPath: '/tmp/out/game.cue',
  });
  assert.equal(result.ok, true);
  assert.equal(result.handled, true);
});

test('PCE Test Play launcher honors direct handled hook results', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8').replace(/\r\n/g, '\n');

  assert.match(mainSource, /const handledByHook = Boolean\(hookResult\.ok && \(/);
  assert.match(mainSource, /hookResult\.handled \|\| \(hookResult\.result && hookResult\.result\.handled\)/);
  assert.match(mainSource, /if \(handledByHook\) \{\n    return \{ opened: true, reused: false, handledByPlugin: emulatorPluginId \};\n  \}/);
});

test('PCE external emulator opens macOS app bundles by bundle path', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');

  assert.match(mainSource, /function resolveMacAppBundleExecutable\(appPath\)/);
  assert.match(mainSource, /Contents', 'Info\.plist'/);
  assert.match(mainSource, /Contents', 'MacOS'/);
  assert.match(mainSource, /return \{ command: appExecutable, args \};/);
  assert.match(mainSource, /if \(isMacAppBundle\) return \{ command: 'open', args: \[executablePath, '--args', \.\.\.args\] \};/);
  assert.doesNotMatch(mainSource, /\['-a', executablePath, '--args', \.\.\.args\]/);
});

test('PCE external emulator defaults to Geargrafx on macOS when path is unset', async () => {
  const plugin = require(path.join(pluginDir, 'index.js'));
  let launchOptions = null;

  const result = await plugin.onTestPlay({ romPath: '/tmp/out/game.cue' }, {
    testPlay: {
      getProjectConfig: async () => ({ testPlay: { externalEmulator: {} } }),
      launchExternalEmulator: async (options) => {
        launchOptions = options;
        return { ok: true, launched: true };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(launchOptions.executablePath, defaultGeargrafxPath);
});

test('PCE project config preserves external emulator settings', () => {
  const { normalizeProjectConfig } = require(path.join(__dirname, '..', 'pce-build-system'));

  const config = normalizeProjectConfig({
    coreId: 'pc-engine',
    testPlay: {
      externalEmulator: {
        executablePath: '/Applications/Geargrafx.app/Contents/MacOS/geargrafx',
        extraArgs: '--fullscreen {rom}',
      },
    },
  });

  assert.deepEqual(config.testPlay.externalEmulator, {
    executablePath: '/Applications/Geargrafx.app/Contents/MacOS/geargrafx',
    extraArgs: '--fullscreen {rom}',
  });
});

test('PCE project config defaults external emulator path to Geargrafx on macOS', () => {
  const { normalizeProjectConfig } = require(path.join(__dirname, '..', 'pce-build-system'));

  const config = normalizeProjectConfig({ coreId: 'pc-engine' });

  assert.equal(config.testPlay.externalEmulator.executablePath, defaultGeargrafxPath);
});
