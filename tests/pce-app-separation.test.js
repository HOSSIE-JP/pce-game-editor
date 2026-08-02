'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');
const { addCdWarningAudio } = require('./helpers/cdda-warning');
const {
  loadAppConfig,
  normalizeAppConfig,
} = require('../game-editor-common');
const {
  migrateLegacySlideshowProject,
  migratePceProjectsIfNeeded,
} = require('../pce-project-migration');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadCoreManager(userData, home = makeTempDir('pce-editor-core-home-')) {
  loadAppConfig(require('../app.config'));
  delete require.cache[require.resolve('../core-manager')];
  delete require.cache[require.resolve('../pce-build-system')];
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

test('PCE renderer avoids Mega Drive code-editor defaults', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'style.css'), 'utf-8');

  assert.match(renderer, /PCE Game Editor - renderer\.js/);
  assert.match(css, /PCE Game Editor - Dark IDE Theme/);
  assert.match(renderer, /Hello World - PCE Game Editor サンプル/);
  assert.match(renderer, /pce_vdc_set_resolution/);
  assert.match(renderer, /PCE_CODE_SYMBOLS/);
  assert.match(renderer, /getActiveCoreId\(\) === 'pc-engine'[\s\S]*PCE_CODE_COMPLETION_ITEMS/);
  assert.doesNotMatch(renderer, /HELLO, MEGA WORLD/);
  assert.doesNotMatch(renderer, /VDP_drawText/);
  assert.doesNotMatch(renderer, /SYS_doVBlankProcess/);
  assert.doesNotMatch(renderer, /SGDK を使った最小限/);
});

test('PCE core manager exposes only PC Engine and creates PCE projects', async () => {
  const userData = makeTempDir('pce-editor-core-state-');
  const coreManager = loadCoreManager(userData);
  assert.deepEqual(coreManager.listCores().map((core) => core.id), ['pc-engine']);
  const listed = coreManager.listProjects();
  const templates = Object.fromEntries(listed.templates.map((template) => [template.templateId, template]));
  assert.deepEqual(Object.keys(templates).sort(), ['template_pce_sample', 'template_pce_vn_cd', 'template_pce_vn_hucard']);
  assert.equal(templates.template_pce_sample.coreId, 'pc-engine');
  assert.equal(templates.template_pce_sample.targetMedia, 'hucard');
  assert.equal(templates.template_pce_sample.builderPlugin, 'pce-slideshow-builder');
  assert.equal(templates.template_pce_vn_cd.coreId, 'pc-engine');
  assert.equal(templates.template_pce_vn_cd.targetMedia, 'cd');
  assert.equal(templates.template_pce_vn_cd.builderPlugin, 'pce-visual-novel-builder');
  assert.equal(templates.template_pce_vn_hucard.coreId, 'pc-engine');
  assert.equal(templates.template_pce_vn_hucard.targetMedia, 'hucard');
  assert.equal(templates.template_pce_vn_hucard.builderPlugin, 'pce-visual-novel-hucard-builder');

  const created = coreManager.createProjectInParent('', 'demo_pce', {
    coreId: 'pc-engine',
    title: 'Demo PCE',
  }, null, { templateId: 'template_pce_sample' });
  const config = JSON.parse(fs.readFileSync(path.join(created.projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.coreId, 'pc-engine');
  assert.equal(config.platform, 'pce');
  assert.equal(config.pluginRoles.builder, 'pce-slideshow-builder');
  assert.deepEqual(config.pluginSettings.enabled, {
    'novel-editor': false,
    'sound-editor': false,
  });

  const result = await coreManager.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });
  assert.equal(result.success, true);
  assert.equal(path.extname(result.commandInfo.romPath), '.pce');
});

test('all current PCE templates support create, save, dry build, and Test Play handoff', async () => {
  const userData = makeTempDir('pce-editor-template-smoke-');
  const coreManager = loadCoreManager(userData);
  const standardEmulator = require('../plugins/pce-standard-emulator');
  const cases = [
    ['template_pce_sample', 'smoke_slideshow', 'hucard', '.pce'],
    ['template_pce_vn_cd', 'smoke_vn_cd', 'cd', '.cue'],
    ['template_pce_vn_hucard', 'smoke_vn_hucard', 'hucard', '.pce'],
  ];

  for (const [templateId, projectName, targetMedia, extension] of cases) {
    const created = coreManager.createProjectInParent('', projectName, {
      coreId: 'pc-engine',
      title: `${projectName} initial`,
    }, null, { templateId });
    const saved = coreManager.saveProjectConfig({ title: `${projectName} saved` });
    assert.equal(saved.title, `${projectName} saved`);
    assert.equal(saved.coreId, 'pc-engine');
    assert.equal(saved.targetMedia, targetMedia);
    assert.equal(saved.pluginRoles.testplay, 'pce-standard-emulator');

    if (targetMedia === 'cd') {
      const missingWarning = await coreManager.buildProject(() => {}, {
        dryRun: true,
        allowMissingToolchain: true,
      });
      assert.equal(missingWarning.success, false);
      assert.match(missingWarning.error, /requires Track 1 warning audio/);
      addCdWarningAudio(created.projectDir);
    }

    const result = await coreManager.buildProject(() => {}, {
      dryRun: true,
      allowMissingToolchain: true,
    });
    assert.equal(result.success, true, `${templateId} dry build failed`);
    assert.equal(result.commandInfo.targetMedia, targetMedia);
    assert.equal(path.extname(result.commandInfo.romPath), extension);
    assert.equal(fs.existsSync(path.join(created.projectDir, 'project.json')), true);

    let opened = null;
    const handoff = await standardEmulator.onTestPlay({ romPath: result.commandInfo.romPath }, {
      testPlay: {
        openWasmWindow: async (payload) => { opened = payload; return { opened: true }; },
      },
    });
    assert.equal(handoff.ok, true);
    assert.equal(handoff.handled, true);
    assert.equal(opened.pluginId, 'pce-standard-emulator');
    assert.equal(opened.romPath, result.commandInfo.romPath);
  }
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

test('PCE legacy slideshow migration only replaces an exact old main.c match', () => {
  const projectDir = makeTempDir('pce-legacy-slideshow-');
  const templateDir = makeTempDir('pce-legacy-slideshow-template-');
  const legacySource = 'old slideshow source\n';
  const replacementSource = 'new llvm-mos slideshow source\n';
  const legacyHash = crypto.createHash('sha256').update(legacySource).digest('hex');
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(templateDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    coreId: 'pc-engine',
    targetMedia: 'hucard',
    pluginRoles: { builder: 'pce-slideshow-builder' },
  }), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), legacySource, 'utf-8');
  fs.writeFileSync(path.join(templateDir, 'src', 'main.c'), replacementSource, 'utf-8');

  const migrated = migrateLegacySlideshowProject(projectDir, {
    legacyMainHashes: [legacyHash],
    templateMainPath: path.join(templateDir, 'src', 'main.c'),
  });
  assert.equal(migrated.migrated, true);
  assert.equal(fs.readFileSync(path.join(projectDir, 'src', 'main.c'), 'utf-8'), replacementSource);

  fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), 'user edited source\n', 'utf-8');
  const skipped = migrateLegacySlideshowProject(projectDir, {
    legacyMainHashes: [legacyHash],
    templateMainPath: path.join(templateDir, 'src', 'main.c'),
  });
  assert.equal(skipped.migrated, false);
  assert.equal(skipped.reason, 'main-modified-or-current');
  assert.equal(fs.readFileSync(path.join(projectDir, 'src', 'main.c'), 'utf-8'), 'user edited source\n');
});
