'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');
const {
  loadAppConfig,
  normalizeAppConfig,
} = require('game-editor-common');
const { migratePceProjectsIfNeeded } = require('../pce-project-migration');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadCoreManager(userData, home = makeTempDir('pce-editor-core-home-')) {
  loadAppConfig(require('../app.config'));
  delete require.cache[require.resolve('../core-manager')];
  delete require.cache[require.resolve('../build-system')];
  delete require.cache[require.resolve('../pce-build-system')];
  delete require.cache[require.resolve('../setup-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'core-manager.js'), {
    userData,
    paths: { userData, home },
  });
}

test('PCE app config is PC Engine only and uses a separate app id', () => {
  const config = normalizeAppConfig(require('../app.config'));
  assert.equal(config.appId, 'jp.co.geroneko.pce.editor.desktop');
  assert.deepEqual(config.allowedCoreIds, ['pc-engine']);
  assert.equal(config.defaultCoreId, 'pc-engine');
});

test('PCE plugin tree contains PCE-only and shared plugins only', () => {
  const pluginsRoot = path.join(__dirname, '..', 'plugins');
  const hasPluginManifest = (id) => fs.existsSync(path.join(pluginsRoot, id, 'manifest.json'));
  assert.equal(hasPluginManifest('pc-engine-core'), true);
  assert.equal(hasPluginManifest('pce-asset-manager'), true);
  assert.equal(hasPluginManifest('code-editor'), true);
  assert.equal(hasPluginManifest('mega-drive-core'), false);
  assert.equal(hasPluginManifest('standard-emulator'), false);
});

test('PCE core manager exposes only PC Engine and creates PCE projects', async () => {
  const userData = makeTempDir('pce-editor-core-state-');
  const coreManager = loadCoreManager(userData);
  assert.deepEqual(coreManager.listCores().map((core) => core.id), ['pc-engine']);
  const listed = coreManager.listProjects();
  const templates = Object.fromEntries(listed.templates.map((template) => [template.templateId, template]));
  assert.deepEqual(Object.keys(templates).sort(), ['template_pce_sample', 'template_pce_vn_cd']);
  assert.equal(templates.template_pce_sample.coreId, 'pc-engine');
  assert.equal(templates.template_pce_sample.targetMedia, 'hucard');
  assert.equal(templates.template_pce_vn_cd.coreId, 'pc-engine');
  assert.equal(templates.template_pce_vn_cd.targetMedia, 'cd');

  const created = coreManager.createProjectInParent('', 'demo_pce', {
    coreId: 'pc-engine',
    title: 'Demo PCE',
  }, null, { templateId: 'template_pce_sample' });
  const config = JSON.parse(fs.readFileSync(path.join(created.projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.coreId, 'pc-engine');
  assert.equal(config.platform, 'pce');
  assert.equal(config.pluginRoles.builder, 'pce-sample-builder');

  const result = await coreManager.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });
  assert.equal(result.success, true);
  assert.equal(path.extname(result.commandInfo.romPath), '.pce');
});

test('PCE migration copies only PCE projects and never overwrites existing folders', () => {
  const sourceRoot = makeTempDir('pce-migration-source-');
  const userData = makeTempDir('pce-migration-user-');
  const pceProject = path.join(sourceRoot, 'old_pce');
  const mdProject = path.join(sourceRoot, 'old_md');
  fs.mkdirSync(pceProject, { recursive: true });
  fs.mkdirSync(mdProject, { recursive: true });
  fs.writeFileSync(path.join(pceProject, 'project.json'), JSON.stringify({ coreId: 'pc-engine', title: 'PCE' }), 'utf-8');
  fs.writeFileSync(path.join(mdProject, 'project.json'), JSON.stringify({ coreId: 'mega-drive', title: 'MD' }), 'utf-8');

  loadAppConfig({
    appRoot: path.join(__dirname, '..'),
    defaultCoreId: 'pc-engine',
    allowedCoreIds: ['pc-engine'],
    projectsRootName: 'projects',
    migration: { pceProjectSourceRoots: [sourceRoot] },
  });
  const fakeApp = { getPath: () => userData };
  const first = migratePceProjectsIfNeeded(fakeApp);
  const second = migratePceProjectsIfNeeded(fakeApp);

  assert.equal(first.ok, true);
  assert.equal(first.copied.length, 1);
  assert.equal(fs.existsSync(path.join(userData, 'projects', 'old_pce', 'project.json')), true);
  assert.equal(fs.existsSync(path.join(userData, 'projects', 'old_md')), false);
  assert.equal(second.skipped, true);
});
