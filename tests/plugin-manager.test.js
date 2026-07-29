'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadAppConfig } = require('../game-editor-common');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

loadAppConfig({
  appRoot: path.join(__dirname, '..'),
  defaultCoreId: 'pc-engine',
  allowedCoreIds: ['pc-engine'],
  pluginsRoot: path.join(__dirname, '..', 'plugins'),
});

function makeTempUserData() {
  const root = path.join(__dirname, '..', 'node_modules', '.plugin-test-tmp');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'pce-editor-plugin-test-'));
}

function writePlugin(userData, id, manifest, files = {}) {
  const pluginDir = path.join(userData, 'plugins', id);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', types: ['build'], supportedCores: ['pc-engine'], ...manifest }, null, 2),
    'utf-8',
  );
  fs.writeFileSync(path.join(pluginDir, 'index.js'), "'use strict';\nmodule.exports = {};\n", 'utf-8');
  Object.entries(files).forEach(([relativePath, content]) => {
    const abs = path.join(pluginDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  });
  const statePath = path.join(userData, 'plugins-state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf-8')) : {};
  state[id] = { ...(state[id] || {}), trusted: true, enabled: true };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
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
  writePlugin(userData, 'hidden-internal', {
    hidden: true,
    types: ['editor'],
    tab: { label: 'Hidden' },
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const plugins = pluginManager.listPlugins();
  const alpha = plugins.find((plugin) => plugin.id === 'alpha');

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
  assert.equal(plugins.some((plugin) => plugin.id === 'hidden-internal'), false);
});

test('listPlugins requires an explicit PCE or shared core declaration', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'missing-core', { types: ['editor'], supportedCores: null });
  writePlugin(userData, 'wrong-core', { types: ['editor'], supportedCores: ['mega-drive'] });
  writePlugin(userData, 'shared', { types: ['editor'], supportedCores: ['*'] });
  writePlugin(userData, 'pce-only', { types: ['asset'], supportedCores: ['pc-engine'] });
  writePlugin(userData, 'pc-engine-core', {
    types: ['core'],
    core: { id: 'pc-engine', label: 'PC Engine', platform: 'pce' },
  });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const allForPce = pluginManager.listPlugins({ coreId: 'pc-engine', includeIncompatible: true });
  const filteredForPce = pluginManager.listPlugins({ coreId: 'pc-engine', includeIncompatible: false });

  assert.equal(allForPce.some((plugin) => plugin.id === 'missing-core'), false);
  assert.equal(allForPce.some((plugin) => plugin.id === 'wrong-core'), false);
  assert.deepEqual(allForPce.find((plugin) => plugin.id === 'shared').supportedCores, ['*']);
  assert.equal(allForPce.find((plugin) => plugin.id === 'pc-engine-core').core.id, 'pc-engine');
  assert.equal(filteredForPce.some((plugin) => plugin.id === 'pce-only'), true);
});

test('manifest validation rejects ids that do not match their directory', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'wrong-directory', { id: 'different-id' });

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  assert.equal(pluginManager.listPlugins().some((plugin) => plugin.id === 'wrong-directory'), false);
  assert.match(pluginManager.validateManifest({
    id: 'different-id', name: 'Wrong', version: '1.0.0', types: ['editor'], supportedCores: ['pc-engine'],
  }, 'wrong-directory').join('\n'), /id must match/);
  assert.ok(pluginManager.listPluginDiagnostics().some((entry) => (
    entry.pluginId === 'wrong-directory' && entry.code === 'manifest-invalid'
  )));
});

test('user plugins require explicit trust before renderer or main code can run', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'untrusted', {
    types: ['editor'],
    renderer: { entry: 'renderer.js' },
  }, { 'renderer.js': 'export function activate() {}\n' });
  const statePath = path.join(userData, 'plugins-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ untrusted: { enabled: true, trusted: false } }, null, 2), 'utf-8');

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const before = pluginManager.listPlugins().find((plugin) => plugin.id === 'untrusted');
  assert.equal(before.trusted, false);
  assert.equal(before.enabled, false);
  assert.equal(pluginManager.getRendererAssets('untrusted').requiresTrust, true);
  assert.equal(pluginManager.setEnabledWithDependencies('untrusted', true).requiresTrust, true);

  assert.deepEqual(pluginManager.setUserPluginTrusted('untrusted', true), {
    ok: true, id: 'untrusted', trusted: true,
  });
  assert.equal(pluginManager.setEnabledWithDependencies('untrusted', true).ok, true);
  assert.equal(pluginManager.getRendererAssets('untrusted').ok, true);
});

test('plugin diagnostics report missing dependencies without hiding the plugin', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'needs-helper', { dependencies: ['missing-helper'] });
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const plugin = pluginManager.listPlugins().find((entry) => entry.id === 'needs-helper');
  assert.deepEqual(plugin.missingDependencies, ['missing-helper']);
  assert.ok(pluginManager.listPluginDiagnostics().some((entry) => entry.code === 'dependency-missing'));
});

test('listPlugins uses only declared manifest roles', () => {
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
  assert.equal(plugins.get('pce-slideshow-builder').hasGenerator, false);
  assert.equal(plugins.get('pce-visual-novel-builder').hasGenerator, false);
  assert.equal(plugins.get('pce-visual-novel-hucard-builder').hasGenerator, false);
});

test('built-in PCE asset editor suite is scoped to the PC Engine core', () => {
  const userData = makeTempUserData();
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const pcePlugins = new Map(pluginManager.listPlugins({ coreId: 'pc-engine' }).map((plugin) => [plugin.id, plugin]));

  ['novel-editor', 'pce-asset-manager', 'image-editor', 'sound-editor', 'pce-image-converter', 'pce-audio-converter', 'pce-kitahe-pm-converter'].forEach((id) => {
    assert.equal(pcePlugins.has(id), true, `${id} should be available for PC Engine`);
    assert.deepEqual(pcePlugins.get(id).supportedCores, ['pc-engine']);
  });
  ['pce-slideshow-builder', 'pce-visual-novel-builder', 'pce-visual-novel-hucard-builder'].forEach((id) => {
    assert.equal(pcePlugins.has(id), true, `${id} should be available for PC Engine`);
    assert.ok(pcePlugins.get(id).roles.some((role) => role.id === 'builder'));
  });
  ['pce-font-editor', 'pce-visual-novel-editor', 'pce-vn-system-settings', 'pce-music-editor', 'pce-cdda-manager', 'pce-adpcm-manager', 'pce-background-manager', 'pce-sprite-manager', 'pce-palette-editor'].forEach((id) => {
    assert.equal(pcePlugins.has(id), false, `${id} should be hidden behind an integrated plugin`);
  });
  assert.equal(
    pluginManager.listPluginDiagnostics().some((entry) => entry.pluginId === 'pce-vn-system-settings'),
    false,
    'the integrated system settings module should have a valid hidden manifest',
  );
  assert.equal(pcePlugins.get('pce-asset-manager').renderer.capabilities.includes('audio-import-handler'), true);
  assert.equal(pcePlugins.get('image-editor').tab.page, 'image-editor');
  assert.equal(pcePlugins.get('image-editor').tab.label, 'Image');
  assert.equal(pcePlugins.get('sound-editor').tab.page, 'sound-editor');
  assert.equal(pcePlugins.get('sound-editor').tab.label, 'Sound');
  assert.equal(pcePlugins.get('novel-editor').tab.page, 'novel-editor');
  assert.equal(pcePlugins.get('novel-editor').tab.label, 'Novel');
  const kitaheConverter = pcePlugins.get('pce-kitahe-pm-converter');
  assert.deepEqual(kitaheConverter.pluginTypes, ['converter']);
  assert.deepEqual(kitaheConverter.hooks, ['inspectKitahePmSource', 'applyKitahePmConversion']);
  assert.deepEqual(kitaheConverter.mainApi.capabilities, ['kitahe-pm-script-converter']);
  assert.deepEqual(kitaheConverter.renderer.capabilities, ['kitahe-pm-script-converter']);
  assert.equal(kitaheConverter.hasRenderer, true);
});

test('setEnabledWithDependencies rejects missing dependencies without changing state', () => {
  const userData = makeTempUserData();
  writePlugin(userData, 'alpha', { dependencies: ['beta', 'missing-plugin'] });
  writePlugin(userData, 'beta', {});

  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  pluginManager.setEnabled('alpha', false);
  pluginManager.setEnabled('beta', false);

  const result = pluginManager.setEnabledWithDependencies('alpha', true);
  const state = JSON.parse(fs.readFileSync(path.join(userData, 'plugins-state.json'), 'utf-8'));

  assert.equal(result.ok, false);
  assert.deepEqual(result.changedIds, []);
  assert.deepEqual(result.missingDependencies, ['missing-plugin']);
  assert.equal(state.alpha.enabled, false);
  assert.equal(state.beta.enabled, false);
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
