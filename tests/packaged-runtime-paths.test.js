'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

const sourceRoot = path.resolve(__dirname, '..');

function withPackagedLayout(run) {
  const fixtureParent = path.join(sourceRoot, 'node_modules', '.packaged-layout-test-tmp');
  fs.mkdirSync(fixtureParent, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(fixtureParent, 'runtime-'));
  const resources = path.join(fixture, 'resources');
  // Keep application modules separate from extraResources, as app.asar is in a
  // real package. A directory lets this regression run in the ordinary Node suite.
  const appPath = path.join(resources, 'app');
  fs.mkdirSync(appPath, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot)) {
    if (entry.endsWith('.js')) fs.copyFileSync(path.join(sourceRoot, entry), path.join(appPath, entry));
  }
  for (const id of ['novel-editor', 'pce-font-editor', 'pce-kitahe-pm-converter']) {
    fs.cpSync(path.join(sourceRoot, 'plugins', id), path.join(resources, 'plugins', id), { recursive: true });
  }
  for (const id of ['template_pce_vn_cd', 'template_pce_vn_hucard']) {
    fs.cpSync(path.join(sourceRoot, 'template', id, 'src'), path.join(resources, 'template', id, 'src'), { recursive: true });
  }
  const previousResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources });
  const appOverrides = { app: { isPackaged: true }, appPath, userData: path.join(fixture, 'user-data') };
  try {
    run({ fixture, resources, appPath, load: (file) => loadWithMockedElectron(file, appOverrides) });
  } finally {
    if (previousResources) Object.defineProperty(process, 'resourcesPath', previousResources);
    else delete process.resourcesPath;
    for (const name of Object.keys(require.cache)) {
      if (name.startsWith(`${fixture}${path.sep}`)) delete require.cache[name];
    }
    assert.equal(path.dirname(path.resolve(fixture)), fixtureParent);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function createMergeProject(parent, name) {
  const project = path.join(parent, name);
  writeJson(path.join(project, 'project.json'), {
    title: name, coreId: 'pc-engine', targetMedia: 'cd', toolchain: 'llvm-mos',
    pluginRoles: { builder: 'pce-visual-novel-builder' },
  });
  fs.writeFileSync(path.join(project, 'warning.wav'), Buffer.from([0, 1]));
  writeJson(path.join(project, 'assets', 'pce-assets.json'), {
    version: 2, assets: [{ id: 'cdda_warning', type: 'cdda-warning', source: 'warning.wav', options: {} }],
  });
  writeJson(path.join(project, 'assets', 'pce-vn-scenes.json'), {
    version: 2, startScene: 'menu', scenes: [
      { id: 'menu', commands: [
        { type: 'label', name: 'NEXT_SCR' }, { type: 'jump', sceneId: 'story' },
        { type: 'label', name: 'PREV_SCR' }, { type: 'jump', sceneId: 'story' },
      ] },
      { id: 'story', commands: [{ type: 'jump', sceneId: 'menu' }] },
    ],
  });
  return project;
}

test('packaged built-in font and Kitahe plugins load application modules from app.getAppPath', () => {
  withPackagedLayout(({ fixture, resources, load }) => {
    const projectDir = path.join(fixture, 'project');
    fs.mkdirSync(projectDir);
    for (const id of ['novel-editor', 'pce-font-editor']) {
      const plugin = load(path.join(resources, 'plugins', id, 'index.js'));
      assert.equal(plugin.readFontSettings({}, { projectDir }).ok, true);
    }
    const plugin = load(path.join(resources, 'plugins', 'pce-kitahe-pm-converter', 'index.js'));
    assert.equal(typeof plugin.inspectKitahePmSource, 'function');
    assert.equal(typeof plugin.inspectKitahePmAssetPackage, 'function');
  });
});

test('packaged CD and HuCARD runtime sync and build signatures use extraResources templates', () => {
  withPackagedLayout(({ fixture, resources, appPath, load }) => {
    const vn = load(path.join(appPath, 'pce-vn-manager.js'));
    const hu = load(path.join(appPath, 'pce-vn-hucard-manager.js'));
    for (const [media, template, sync, file] of [
      ['cd', 'template_pce_vn_cd', vn.syncVisualNovelRuntime, 'vn_cache_core.c'],
      ['hucard', 'template_pce_vn_hucard', hu.syncHuCardVisualNovelRuntime, 'pce_vn_hucard_runtime.c'],
    ]) {
      const project = path.join(fixture, media);
      const templateFile = path.join(resources, 'template', template, 'src', file);
      assert.equal(sync(project).changed, true);
      assert.deepEqual(fs.readFileSync(path.join(project, 'src', file)), fs.readFileSync(templateFile));
      const before = vn.vnBuildSignature(project, { targetMedia: media });
      fs.appendFileSync(templateFile, '\n/* packaged template signature check */\n');
      assert.notEqual(vn.vnBuildSignature(project, { targetMedia: media }), before);
    }
  });
});

test('packaged project merging copies the extraResources CD template', () => {
  withPackagedLayout(({ fixture, resources, appPath, load }) => {
    const merger = load(path.join(appPath, 'pce-vn-project-merger.js'));
    const options = {
      projects: [createMergeProject(fixture, 'first'), createMergeProject(fixture, 'second')],
      output: path.join(fixture, 'merged'), title: 'Packaged merge',
    };
    const inspection = merger.inspectProjectMerge(options);
    assert.equal(inspection.ok, true, JSON.stringify(inspection.errors));
    const result = merger.applyProjectMerge({ ...options, signature: inspection.signature });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(
      fs.readFileSync(path.join(options.output, 'src', 'pce_vn_runtime.c')),
      fs.readFileSync(path.join(resources, 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c')),
    );
  });
});
