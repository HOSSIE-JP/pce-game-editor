'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempUserData() {
  const root = path.join(__dirname, '..', 'node_modules', '.plugin-test-tmp');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'md-editor-plugin-test-'));
}

function writePlugin(userData, id, manifest, files = {}) {
  const pluginDir = path.join(userData, 'plugins', id);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', types: ['build'], ...manifest }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'index.js'), "'use strict';\nmodule.exports = {};\n", 'utf-8');
  Object.entries(files).forEach(([relativePath, content]) => {
    const abs = path.join(pluginDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  });
}

test('listPlugins reads user plugins and normalizes manifest fields', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', {
    name: 'Alpha Plugin',
    types: ['editor', 'asset'],
    hooks: ['getTab', 'onActivate'],
    dependencies: ['beta', 'beta', 'gamma'],
    icon: 'Music',
    permissions: ['project.read', 'project.read', 'res.write'],
    roles: [{ id: 'custom-role', label: 'Custom Role', exclusive: true, order: 50 }],
    tab: { label: 'Alpha' },
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const alpha = pluginManager.listPlugins().find((plugin) => plugin.id === 'alpha');

  assert.equal(alpha.name, 'Alpha Plugin');
  assert.deepEqual(alpha.pluginTypes, ['editor', 'asset']);
  assert.equal(alpha.pluginType, 'editor');
  assert.deepEqual(alpha.hooks, ['getTab', 'onActivate']);
  assert.deepEqual(alpha.dependencies, ['beta', 'gamma']);
  assert.equal(alpha.icon, 'music');
  assert.deepEqual(alpha.permissions, ['project.read', 'res.write']);
  assert.deepEqual(alpha.roles, [{ id: 'custom-role', label: 'Custom Role', exclusive: true, order: 50 }]);
  assert.equal(alpha.enabled, true);
  assert.equal(alpha.isUserPlugin, true);
});

test('listPlugins exposes core compatibility metadata and defaults legacy plugins to Mega Drive', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'legacy-md', { types: ['editor'] });
  writePlugin(userData, 'shared', { types: ['editor'], supportedCores: ['*'] });
  writePlugin(userData, 'pce-only', { types: ['asset'], supportedCores: ['pc-engine'] });
  writePlugin(userData, 'pc-engine-core', {
    types: ['core'],
    core: { id: 'pc-engine', label: 'PC Engine', platform: 'pce' },
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const allForPce = pluginManager.listPlugins({ coreId: 'pc-engine', includeIncompatible: true });
  const filteredForPce = pluginManager.listPlugins({ coreId: 'pc-engine', includeIncompatible: false });

  assert.deepEqual(allForPce.find((plugin) => plugin.id === 'legacy-md').supportedCores, ['mega-drive']);
  assert.equal(allForPce.find((plugin) => plugin.id === 'legacy-md').compatibleWithActiveCore, false);
  assert.deepEqual(allForPce.find((plugin) => plugin.id === 'shared').supportedCores, ['*']);
  assert.equal(allForPce.find((plugin) => plugin.id === 'pc-engine-core').core.id, 'pc-engine');
  assert.equal(filteredForPce.some((plugin) => plugin.id === 'legacy-md'), false);
  assert.equal(filteredForPce.some((plugin) => plugin.id === 'pce-only'), true);
});

test('role selection rejects plugins incompatible with the active core', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'md-builder', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  });
  writePlugin(userData, 'pce-builder', {
    supportedCores: ['pc-engine'],
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const rejected = pluginManager.setExclusiveRoleSelection('builder', 'md-builder', { coreId: 'pc-engine' });
  const accepted = pluginManager.setExclusiveRoleSelection('builder', 'pce-builder', { coreId: 'pc-engine' });

  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /not compatible/);
  assert.equal(accepted.ok, true);
});

test('listPlugins uses only declared v2.5 roles', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'builder', { types: ['build'] });
  writePlugin(userData, 'emulator', {
    types: ['emulator'],
    hooks: ['onTestPlay'],
    roles: [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 20 }],
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const builder = pluginManager.listPlugins().find((plugin) => plugin.id === 'builder');
  const emulator = pluginManager.listPlugins().find((plugin) => plugin.id === 'emulator');

  assert.deepEqual(builder.roles, []);
  assert.equal(emulator.roles[0].id, 'testplay');
});

test('listPlugins marks hasGenerator only when generateSource is exported or declared', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'hook-only-builder', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
    hooks: ['onBuildStart'],
  });
  writePlugin(userData, 'source-builder', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  }, {
    'index.js': "'use strict';\nfunction generateSource() { return { ok: true, sourceCode: '' }; }\nmodule.exports = { generateSource };\n",
  });
  writePlugin(userData, 'manifest-builder', {
    generator: true,
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const plugins = new Map(pluginManager.listPlugins().map((plugin) => [plugin.id, plugin]));

  assert.equal(plugins.get('hook-only-builder').hasGenerator, false);
  assert.equal(plugins.get('source-builder').hasGenerator, true);
  assert.equal(plugins.get('manifest-builder').hasGenerator, true);
  assert.equal(plugins.get('pce-sample-builder').hasGenerator, false);
});

test('built-in PCE asset editor suite is scoped to the PC Engine core', () => {
  const userData = makeTempUserData();
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const pcePlugins = new Map(pluginManager.listPlugins({ coreId: 'pc-engine' }).map((plugin) => [plugin.id, plugin]));

  ['pce-asset-manager', 'pce-sprite-editor', 'pce-music-editor', 'pce-palette-editor', 'pce-image-converter', 'pce-audio-converter'].forEach((id) => {
    assert.equal(pcePlugins.has(id), true, `${id} should be available for PC Engine`);
    assert.deepEqual(pcePlugins.get(id).supportedCores, ['pc-engine']);
  });
  assert.equal(pcePlugins.get('pce-asset-manager').renderer.capabilities.includes('audio-import-handler'), true);
  assert.equal(pcePlugins.get('pce-music-editor').tab.page, 'pce-music-editor');
});

test('setEnabledWithDependencies enables dependencies and reports missing ones', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', { dependencies: ['beta', 'missing-plugin'] });
  writePlugin(userData, 'beta', {});

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  pluginManager.setEnabled('alpha', false);
  pluginManager.setEnabled('beta', false);

  const result = pluginManager.setEnabledWithDependencies('alpha', true);
  const state = JSON.parse(fs.readFileSync(path.join(userData, 'plugins-state.json'), 'utf-8'));

  assert.equal(result.ok, true);
  assert.deepEqual(new Set(result.changedIds), new Set(['alpha', 'beta']));
  assert.deepEqual(result.missingDependencies, ['missing-plugin']);
  assert.equal(state.alpha.enabled, true);
  assert.equal(state.beta.enabled, true);
});

test('setEnabledWithDependencies disables peers for exclusive roles', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'builder-a', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  });
  writePlugin(userData, 'builder-b', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const result = pluginManager.setEnabledWithDependencies('builder-b', true);
  const state = JSON.parse(fs.readFileSync(path.join(userData, 'plugins-state.json'), 'utf-8'));

  assert.equal(result.ok, true);
  assert.equal(state['builder-a'].enabled, false);
  assert.equal(pluginManager.listPlugins().find((plugin) => plugin.id === 'builder-b').enabled, true);
  assert.equal(result.changed.find((entry) => entry.id === 'builder-a').reason, 'exclusive-role:builder');
});

test('setEnabledWithDependencies disables dependents of exclusive role peers', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'builder-a', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
    dependencies: ['stage-editor'],
  });
  writePlugin(userData, 'stage-editor', {
    dependencies: ['builder-a'],
  });
  writePlugin(userData, 'builder-b', {
    roles: [{ id: 'builder', label: 'Build', exclusive: true, order: 10 }],
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const result = pluginManager.setEnabledWithDependencies('builder-b', true);
  const state = JSON.parse(fs.readFileSync(path.join(userData, 'plugins-state.json'), 'utf-8'));

  assert.equal(result.ok, true);
  assert.equal(state['builder-a'].enabled, false);
  assert.equal(state['stage-editor'].enabled, false);
  assert.equal(state['builder-b']?.enabled ?? true, true);
  assert.equal(result.changed.find((entry) => entry.id === 'builder-a').reason, 'exclusive-role:builder');
  assert.equal(result.changed.find((entry) => entry.id === 'stage-editor').reason, 'depends-on:builder-a');
});

test('setExclusiveRoleSelection enables the selected plugin and disables role peers', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'emu-a', {
    types: ['emulator'],
    roles: [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 20 }],
  });
  writePlugin(userData, 'emu-b', {
    types: ['emulator'],
    roles: [{ id: 'testplay', label: 'Test Play', exclusive: true, order: 20 }],
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  pluginManager.setEnabled('emu-b', false);

  const result = pluginManager.setExclusiveRoleSelection('testplay', 'emu-b');
  const state = JSON.parse(fs.readFileSync(path.join(userData, 'plugins-state.json'), 'utf-8'));

  assert.equal(result.ok, true);
  assert.equal(state['emu-a'].enabled, false);
  assert.equal(state['emu-b'].enabled, true);
  assert.equal(result.changed.find((entry) => entry.id === 'emu-a').reason, 'exclusive-role:testplay');
});

test('setEnabledWithDependencies disables dependent plugins', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', { dependencies: ['beta'] });
  writePlugin(userData, 'beta', {});

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const result = pluginManager.setEnabledWithDependencies('beta', false);
  const state = JSON.parse(fs.readFileSync(path.join(userData, 'plugins-state.json'), 'utf-8'));

  assert.equal(result.ok, true);
  assert.deepEqual(new Set(result.changedIds), new Set(['alpha', 'beta']));
  assert.equal(state.alpha.enabled, false);
  assert.equal(state.beta.enabled, false);
});

test('listPlugins exposes safe renderer module metadata', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', {
    types: ['editor'],
    tab: { label: 'Alpha', page: 'alpha' },
    renderer: {
      entry: 'renderer.js',
      styles: ['style.css'],
      page: 'alpha',
      capabilities: ['page', 'alpha-tool', 'alpha-tool'],
    },
  }, {
    'renderer.js': 'export function activatePlugin() {}\n',
    'style.css': '.alpha {}\n',
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const alpha = pluginManager.listPlugins().find((plugin) => plugin.id === 'alpha');
  const assets = pluginManager.getRendererAssets('alpha');

  assert.equal(alpha.hasRenderer, true);
  assert.equal(new URL(alpha.rendererAssets.scriptUrl).protocol, 'file:');
  assert.deepEqual(alpha.renderer.capabilities, ['page', 'alpha-tool']);
  assert.equal(assets.ok, true);
  assert.equal(assets.renderer.page, 'alpha');
});

test('listPlugins rejects renderer files outside the plugin directory', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', {
    renderer: {
      entry: '../outside.js',
      styles: ['style.css'],
      capabilities: ['page'],
    },
  }, {
    'style.css': '.alpha {}\n',
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const alpha = pluginManager.listPlugins().find((plugin) => plugin.id === 'alpha');

  assert.equal(alpha.hasRenderer, false);
  assert.equal(alpha.rendererAssets, null);
  assert.match(alpha.renderer.error, /outside plugin directory/);
});

test('user plugins override builtin renderer assets for the same id', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'asset-manager', {
    types: ['editor', 'asset'],
    tab: { label: 'User Assets', page: 'assets' },
    renderer: {
      entry: 'user-renderer.js',
      styles: ['user-style.css'],
      page: 'assets',
      capabilities: ['page', 'asset-manager'],
    },
  }, {
    'user-renderer.js': 'export function activatePlugin() {}\n',
    'user-style.css': '.user-assets {}\n',
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const assetManager = pluginManager.listPlugins().find((plugin) => plugin.id === 'asset-manager');

  assert.equal(assetManager.isUserPlugin, true);
  assert.equal(assetManager.hasRenderer, true);
  assert.match(new URL(assetManager.rendererAssets.scriptUrl).pathname, /user-renderer\.js$/);
  assert.equal(assetManager.name, 'asset-manager');
  assert.deepEqual(assetManager.permissions, []);
});

test('renderer hook invocation requires manifest mainApi permission', async () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', {
    hooks: ['convertAudio', 'privateHook'],
    mainApi: { hooks: ['convertAudio'], capabilities: ['audio-convert'] },
  }, {
    'index.js': `
'use strict';
module.exports = {
  convertAudio(payload, context) {
    return { ok: true, outputPath: payload.sourcePath, projectDir: context.projectDir };
  },
  privateHook() {
    return { ok: true };
  },
};
`,
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const alpha = pluginManager.listPlugins().find((plugin) => plugin.id === 'alpha');

  assert.deepEqual(alpha.mainApi, { hooks: ['convertAudio'], capabilities: ['audio-convert'] });
  assert.equal(pluginManager.canInvokeRendererHook(alpha, 'convertAudio'), true);
  assert.equal(pluginManager.canInvokeRendererHook(alpha, 'privateHook'), false);

  const allowed = await pluginManager.invokeRendererHook('alpha', 'convertAudio', { sourcePath: 'in.wav' }, { projectDir: 'project' });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.outputPath, 'in.wav');
  assert.equal(allowed.projectDir, 'project');

  const denied = await pluginManager.invokeRendererHook('alpha', 'privateHook', {}, {});
  assert.equal(denied.ok, false);
  assert.match(denied.error, /not allowed/);
});

test('renderer hook invocation rejects disabled plugins', async () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', {
    hooks: ['convertAudio'],
    mainApi: { hooks: ['convertAudio'] },
  }, {
    'index.js': "'use strict';\nmodule.exports = { convertAudio() { return { ok: true }; } };\n",
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  pluginManager.setEnabled('alpha', false);

  const result = await pluginManager.invokeRendererHook('alpha', 'convertAudio', {}, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /not allowed/);
});
