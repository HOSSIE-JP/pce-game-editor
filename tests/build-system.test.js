'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function loadBuildSystem(userData, home = makeTempDir('md-editor-home-test-')) {
  delete require.cache[require.resolve('../setup-manager.js')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'build-system.js'), {
    userData,
    paths: { userData, home },
  });
}

function loadPackagedBuildSystem(userData, resourcesPath, home = makeTempDir('md-editor-home-test-')) {
  process.resourcesPath = resourcesPath;
  delete require.cache[require.resolve('../setup-manager.js')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'build-system.js'), {
    userData,
    paths: { userData, home },
    app: { isPackaged: true },
  });
}

test('createProject writes SGDK project files and persists the active project', () => {
  const userData = makeTempDir('md-editor-build-state-test-');
  const projectDir = path.join(makeTempDir('md-editor-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);

  const result = buildSystem.createProject(projectDir, {
    title: 'Long Title With Non ASCII かな and Extra Characters',
    author: 'ME',
    serial: 'GM TEST-01',
    region: 'J',
  }, 'int main(void) { return 0; }\n');

  assert.equal(result.projectDir, path.resolve(projectDir));
  assert.equal(fs.readFileSync(path.join(projectDir, 'src', 'main.c'), 'utf-8'), 'int main(void) { return 0; }\n');
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'resources.res')), true);

  const header = fs.readFileSync(path.join(projectDir, 'src', 'boot', 'rom_head.c'), 'utf-8');
  assert.match(header, /"Long Title With Non ASCII/);
  assert.doesNotMatch(header, /かな/);

  const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.title, 'Long Title With Non ASCII かな and Extra Characters');
  assert.equal(buildSystem.getProjectDir(), path.resolve(projectDir));
});

test('openProject preserves existing user source and project config', () => {
  const userData = makeTempDir('md-editor-open-state-test-');
  const projectDir = path.join(makeTempDir('md-editor-open-project-test-'), 'existing');
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), 'int preserved(void) { return 1; }\n', 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ title: 'Preserved' }, null, 2), 'utf-8');

  const buildSystem = loadBuildSystem(userData);
  const info = buildSystem.openProject(projectDir);

  assert.equal(info.projectDir, path.resolve(projectDir));
  assert.equal(info.title, 'Preserved');
  assert.equal(fs.readFileSync(path.join(projectDir, 'src', 'main.c'), 'utf-8'), 'int preserved(void) { return 1; }\n');
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'boot', 'rom_head.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'resources.res')), true);
});

test('project plugin selection is stored in project config', () => {
  const userData = makeTempDir('md-editor-plugin-config-test-');
  const projectDir = path.join(makeTempDir('md-editor-plugin-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);

  buildSystem.createProject(projectDir, { title: 'Demo' }, 'int main(void) { return 0; }\n');
  buildSystem.setPluginRole('builder', 'standard-builder');
  buildSystem.setPluginRole('testplay', 'standard-emulator');

  assert.equal(buildSystem.getPluginRole('builder'), 'standard-builder');
  assert.equal(buildSystem.getPluginRole('testplay'), 'standard-emulator');

  const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.deepEqual(config.pluginRoles, {
    builder: 'standard-builder',
    testplay: 'standard-emulator',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'builderPlugin'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'emulatorPlugin'), false);
});

test('createProject can persist an initial builder role', () => {
  const userData = makeTempDir('md-editor-create-builder-role-test-');
  const projectDir = path.join(makeTempDir('md-editor-create-builder-role-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);

  buildSystem.createProject(projectDir, {
    title: 'Demo',
    pluginRoles: { builder: 'slideshow' },
  }, 'int main(void) { return 0; }\n');

  const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.deepEqual(config.pluginRoles, { builder: 'slideshow' });
});

test('default project placeholder stays under the projects root', () => {
  const userData = makeTempDir('md-editor-default-project-test-');
  const buildSystem = loadBuildSystem(userData);

  assert.equal(path.basename(buildSystem.getDefaultProjectDir()), 'new_project');
});

test('project startup state requires selection on first run or missing saved project', () => {
  const userData = makeTempDir('md-editor-startup-project-test-');
  const buildSystem = loadBuildSystem(userData);

  let startup = buildSystem.getProjectStartupState();
  assert.equal(startup.hasSavedProject, false);
  assert.equal(startup.savedProjectExists, false);
  assert.equal(startup.requiresProjectSelection, true);

  const missingProject = path.join(makeTempDir('md-editor-missing-project-root-'), 'deleted');
  buildSystem.setProjectDir(missingProject);
  startup = buildSystem.getProjectStartupState();
  assert.equal(startup.hasSavedProject, true);
  assert.equal(startup.savedProjectDir, path.resolve(missingProject));
  assert.equal(startup.savedProjectExists, false);
  assert.equal(startup.requiresProjectSelection, true);

  const existingProject = path.join(makeTempDir('md-editor-existing-project-root-'), 'demo');
  fs.mkdirSync(existingProject, { recursive: true });
  buildSystem.setProjectDir(existingProject);
  startup = buildSystem.getProjectStartupState();
  assert.equal(startup.savedProjectExists, false);
  assert.equal(startup.requiresProjectSelection, true);

  fs.writeFileSync(path.join(existingProject, 'project.json'), JSON.stringify({ title: 'Existing' }, null, 2), 'utf-8');
  buildSystem.setProjectDir(existingProject);
  startup = buildSystem.getProjectStartupState();
  assert.equal(startup.savedProjectExists, true);
  assert.equal(startup.requiresProjectSelection, false);
});

test('project list separates bundled templates from normal projects', () => {
  const userData = makeTempDir('md-editor-template-list-state-test-');
  const buildSystem = loadPackagedBuildSystem(userData, makeTempDir('md-editor-template-list-resources-test-'));
  const projectsRoot = buildSystem.getProjectsRootDir();
  const templateRoot = buildSystem.getTemplatesRootDir();

  fs.mkdirSync(path.join(templateRoot, 'template_block_game'), { recursive: true });
  fs.writeFileSync(path.join(templateRoot, 'template_block_game', 'project.json'), JSON.stringify({
    title: 'Block Template',
    pluginRoles: { builder: 'block-game-builder' },
  }, null, 2), 'utf-8');
  fs.mkdirSync(path.join(projectsRoot, 'real_game'), { recursive: true });
  fs.writeFileSync(path.join(projectsRoot, 'real_game', 'project.json'), JSON.stringify({ title: 'Real Game' }, null, 2), 'utf-8');
  fs.mkdirSync(path.join(projectsRoot, 'sample_legacy'), { recursive: true });
  fs.writeFileSync(path.join(projectsRoot, 'sample_legacy', 'project.json'), JSON.stringify({ title: 'Legacy Template' }, null, 2), 'utf-8');
  fs.mkdirSync(path.join(projectsRoot, 'scratch_folder'), { recursive: true });

  const result = buildSystem.listProjects();
  assert.deepEqual(result.projects.map((project) => project.projectName), ['real_game']);
  assert.deepEqual(result.templates.map((template) => template.templateId), ['template_block_game']);
  assert.equal(result.templates[0].builderPlugin, 'block-game-builder');
});

test('openProject accepts arbitrary project folders but rejects folders without project.json', () => {
  const userData = makeTempDir('md-editor-open-any-state-test-');
  const buildSystem = loadBuildSystem(userData);
  const parent = makeTempDir('md-editor-open-any-parent-test-');
  const projectDir = path.join(parent, 'outside_project');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ title: 'Outside' }, null, 2), 'utf-8');

  const info = buildSystem.openProject(projectDir);
  assert.equal(info.projectDir, path.resolve(projectDir));
  assert.equal(info.title, 'Outside');
  assert.equal(buildSystem.getProjectDir(), path.resolve(projectDir));

  const invalidDir = path.join(parent, 'plain_folder');
  fs.mkdirSync(invalidDir, { recursive: true });
  assert.throws(() => buildSystem.openProject(invalidDir), /project\.json not found/);
  assert.equal(fs.existsSync(path.join(invalidDir, 'src')), false);
  assert.equal(fs.existsSync(path.join(invalidDir, 'res')), false);
});

test('createProjectInParent copies template projects without out artifacts', () => {
  const userData = makeTempDir('md-editor-template-create-state-test-');
  const buildSystem = loadPackagedBuildSystem(userData, makeTempDir('md-editor-template-create-resources-test-'));
  const root = buildSystem.getTemplatesRootDir();
  const templateDir = path.join(root, 'template_slideshow');
  fs.mkdirSync(path.join(templateDir, 'src', 'boot'), { recursive: true });
  fs.mkdirSync(path.join(templateDir, 'res'), { recursive: true });
  fs.mkdirSync(path.join(templateDir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(templateDir, 'src', 'main.c'), 'int template_main(void) { return 2; }\n', 'utf-8');
  fs.writeFileSync(path.join(templateDir, 'out', 'rom.bin'), 'do not copy', 'utf-8');
  fs.writeFileSync(path.join(templateDir, 'project.json'), JSON.stringify({
    title: 'Template Title',
    author: 'TPL',
    serial: 'GM TPL-00',
    region: 'JUE',
    pluginRoles: { builder: 'slideshow' },
  }, null, 2), 'utf-8');

  const parent = makeTempDir('md-editor-template-target-parent-test-');
  const created = buildSystem.createProjectInParent(parent, 'new_slides', {
    title: 'New Slides',
    author: 'ME',
    serial: 'GM NEW-01',
    region: 'U',
  }, null, { templateId: 'template_slideshow' });

  assert.equal(created.projectDir, path.join(parent, 'new_slides'));
  assert.equal(fs.readFileSync(path.join(created.projectDir, 'src', 'main.c'), 'utf-8'), 'int template_main(void) { return 2; }\n');
  assert.equal(fs.existsSync(path.join(created.projectDir, 'out', 'rom.bin')), false);

  const config = JSON.parse(fs.readFileSync(path.join(created.projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.title, 'New Slides');
  assert.equal(config.author, 'ME');
  assert.deepEqual(config.pluginRoles, { builder: 'slideshow' });

  const header = fs.readFileSync(path.join(created.projectDir, 'src', 'boot', 'rom_head.c'), 'utf-8');
  assert.match(header, /"New Slides\s+"/);
  assert.match(header, /"GM NEW-01\s+"/);
});

test('recent projects are deduplicated and capped', () => {
  const userData = makeTempDir('md-editor-recent-state-test-');
  const buildSystem = loadBuildSystem(userData);
  const parent = makeTempDir('md-editor-recent-parent-test-');

  for (let i = 0; i < 12; i += 1) {
    const projectDir = path.join(parent, `game_${i}`);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ title: `Game ${i}` }, null, 2), 'utf-8');
    buildSystem.openProject(projectDir);
  }
  buildSystem.openProject(path.join(parent, 'game_5'));

  const recent = buildSystem.getRecentProjects();
  assert.equal(recent.length, 10);
  assert.equal(recent[0].projectName, 'game_5');
  assert.equal(new Set(recent.map((project) => project.projectDir)).size, recent.length);
});

test('missing recent projects are pruned from editor state', () => {
  const userData = makeTempDir('md-editor-recent-prune-state-test-');
  const buildSystem = loadBuildSystem(userData);
  const parent = makeTempDir('md-editor-recent-prune-parent-test-');
  const projectDir = path.join(parent, 'kept_game');
  const missingDir = path.join(parent, 'missing_game');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({ title: 'Kept' }, null, 2), 'utf-8');

  buildSystem.openProject(projectDir);
  buildSystem.setProjectDir(missingDir);
  buildSystem.openProject(projectDir);

  const statePath = path.join(userData, 'editor-state.json');
  const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  raw.recentProjects.unshift({
    projectDir: missingDir,
    projectName: 'missing_game',
    title: 'Missing',
    lastOpenedAt: new Date().toISOString(),
  });
  fs.writeFileSync(statePath, JSON.stringify(raw, null, 2), 'utf-8');

  const recent = buildSystem.getRecentProjects();
  assert.equal(recent.some((project) => project.projectDir === path.resolve(missingDir)), false);
  const pruned = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  assert.equal(pruned.recentProjects.some((project) => project.projectDir === path.resolve(missingDir)), false);
});

test('pluginRoles are the only plugin role storage', () => {
  const userData = makeTempDir('md-editor-plugin-roles-test-');
  const projectDir = path.join(makeTempDir('md-editor-plugin-roles-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);

  buildSystem.createProject(projectDir, { title: 'Demo' }, 'int main(void) { return 0; }\n');
  buildSystem.saveProjectConfig({ pluginRoles: { builder: 'role-builder' } });

  assert.equal(buildSystem.getPluginRole('builder'), 'role-builder');
  assert.equal(buildSystem.getPluginRole('testplay'), null);

  buildSystem.setPluginRole('testplay', 'role-emulator');
  const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.pluginRoles.testplay, 'role-emulator');
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'emulatorPlugin'), false);
});

test('project config preserves non-role plugin settings', () => {
  const userData = makeTempDir('md-editor-plugin-settings-test-');
  const projectDir = path.join(makeTempDir('md-editor-plugin-settings-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);

  buildSystem.createProject(projectDir, {
    title: 'Demo',
    pluginSettings: {
      enabled: { 'asset-manager': true, 'ai-control': false },
      sidebarOrder: ['asset-manager', 'md-bgm-composer', 'code-editor'],
    },
  }, 'int main(void) { return 0; }\n');

  let config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.deepEqual(config.pluginSettings.enabled, { 'asset-manager': true, 'ai-control': false });
  assert.deepEqual(config.pluginSettings.sidebarOrder, ['asset-manager', 'md-bgm-composer', 'code-editor']);

  buildSystem.saveProjectConfig({
    pluginSettings: {
      enabled: { 'asset-manager': false },
      sidebarOrder: ['code-editor', 'asset-manager'],
    },
  });

  config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.deepEqual(config.pluginSettings.enabled, { 'asset-manager': false });
  assert.deepEqual(config.pluginSettings.sidebarOrder, ['code-editor', 'asset-manager']);
});

test('saveProjectConfig persists project settings and rewrites the ROM header', () => {
  const userData = makeTempDir('md-editor-save-config-header-test-');
  const projectDir = path.join(makeTempDir('md-editor-save-config-header-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);

  buildSystem.createProject(projectDir, {
    title: 'Before Title',
    author: 'OLD',
    serial: 'GM OLD-01',
    region: 'U',
  }, 'int main(void) { return 0; }\n');

  const saved = buildSystem.saveProjectConfig({
    title: 'Saved Header',
    author: 'NEWAUTHOR',
    serial: 'GM SAVE-02',
    region: 'JUE',
  });

  assert.equal(saved.title, 'Saved Header');
  const config = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.title, 'Saved Header');
  assert.equal(config.serial, 'GM SAVE-02');

  const header = fs.readFileSync(path.join(projectDir, 'src', 'boot', 'rom_head.c'), 'utf-8');
  assert.match(header, /"Saved Header\s+"/);
  assert.match(header, /"GM SAVE-02\s+"/);
  assert.match(header, /"JUE\s+"/);
  assert.doesNotMatch(header, /Before Title/);
  assert.doesNotMatch(header, /GM OLD-01/);
});

test('buildProject fails fast when the toolchain path is missing', async () => {
  const userData = makeTempDir('md-editor-build-run-test-');
  const projectDir = path.join(makeTempDir('md-editor-build-run-project-test-'), 'demo');
  const buildSystem = loadBuildSystem(userData);
  const logs = [];

  buildSystem.createProject(projectDir, { title: 'Demo' }, 'int main(void) { return 0; }\n');
  const result = await buildSystem.buildProject(path.join(projectDir, 'missing-sgdk'), null, (message, level) => {
    logs.push({ message, level });
  });

  assert.equal(result.success, false);
  assert.match(result.error, /missing-sgdk/);
  assert.equal(logs.at(-1).level, 'error');
});

test('build log sanitization strips GCC ANSI color escapes', () => {
  const buildSystem = loadBuildSystem(makeTempDir('md-editor-build-sanitize-test-'));

  const clean = buildSystem.sanitizeBuildLogLine('\u001b[01m\u001b[Ksrc/main.c:7:\u001b[m\u001b[K error');
  assert.equal(clean, 'src/main.c:7: error');
});

test('stderr diagnostics classify compiler warnings without marking them as build errors', () => {
  const buildSystem = loadBuildSystem(makeTempDir('md-editor-build-stderr-classify-test-'));

  let classified = buildSystem.classifyBuildStderrLine('src/main.c:7: warning: unused variable', 'error');
  assert.deepEqual(classified, { level: 'warn', diagnosticLevel: 'warn' });

  classified = buildSystem.classifyBuildStderrLine('    7 | static int unused;', classified.diagnosticLevel);
  assert.deepEqual(classified, { level: 'warn', diagnosticLevel: 'warn' });

  classified = buildSystem.classifyBuildStderrLine('make[1]: [out/foo.o] Error 127 (ignored)', classified.diagnosticLevel);
  assert.deepEqual(classified, { level: 'info', diagnosticLevel: 'warn' });

  classified = buildSystem.classifyBuildStderrLine('src/main.c:8: error: expected ; before }', classified.diagnosticLevel);
  assert.deepEqual(classified, { level: 'error', diagnosticLevel: 'error' });
});

test('SGDK builds on Unix receive Marsdev native tools on PATH', () => {
  const userData = makeTempDir('md-editor-build-sgdk-marsdev-path-test-');
  const sgdkPath = path.join(userData, 'tools', 'sgdk', 'SGDK-2.11');
  const marsdevPath = path.join(userData, 'tools', 'marsdev', 'mars', 'm68k-elf');
  fs.mkdirSync(path.join(sgdkPath, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(marsdevPath, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(sgdkPath, 'makelib.gen'), '', 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'makelib.gen'), '', 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'bin', 'm68k-elf-gcc'), '', 'utf-8');

  const buildSystem = loadBuildSystem(userData);
  const supplemental = buildSystem.getSupplementalToolPaths(sgdkPath, 'darwin');

  assert.deepEqual(supplemental, [path.join(marsdevPath, 'bin')]);
  assert.equal(buildSystem.getMarsdevRuntimePathForBuild(sgdkPath, 'darwin'), marsdevPath);
  assert.equal(buildSystem.getMarsdevRuntimePathForBuild(marsdevPath, 'darwin'), marsdevPath);
  assert.deepEqual(buildSystem.getSupplementalToolPaths(marsdevPath, 'darwin'), []);
  assert.deepEqual(buildSystem.getSupplementalToolPaths(sgdkPath, 'win32'), []);
  assert.equal(buildSystem.getMarsdevRuntimePathForBuild(sgdkPath, 'win32'), null);
});

test('SGDK plus Marsdev build rules disable incompatible LTO', () => {
  const userData = makeTempDir('md-editor-build-nolto-makefile-test-');
  const sgdkPath = path.join(userData, 'tools', 'sgdk', 'SGDK-2.11');
  const marsdevPath = path.join(userData, 'tools', 'marsdev', 'mars', 'm68k-elf');
  const makefilePath = path.join(sgdkPath, 'makefile.gen');
  fs.mkdirSync(sgdkPath, { recursive: true });
  fs.mkdirSync(path.join(marsdevPath, 'bin'), { recursive: true });
  fs.writeFileSync(makefilePath, [
    'include $(GDK)/common.mk',
    'release: FLAGS= $(DEFAULT_FLAGS) -O3 -fuse-linker-plugin -flto -flto=auto -ffat-lto-objects',
    '$(OUT)/rom.out: $(OUT)/sega.o $(OUT)/cmd_ $(LIBMD)',
    '\t$(CC) -m68000 -B$(BIN) -n -T $(GDK)/md.ld -nostdlib $(OUT)/sega.o @$(OUT)/cmd_ $(LIBMD) $(LIBGCC) -o $(OUT)/rom.out -Wl,--gc-sections -flto -flto=auto -ffat-lto-objects',
    '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'makelib.gen'), '', 'utf-8');
  fs.writeFileSync(path.join(marsdevPath, 'bin', 'm68k-elf-gcc'), '', 'utf-8');

  const buildSystem = loadBuildSystem(userData);
  const outputPath = buildSystem.createSgdkMarsdevNoLtoMakefile(makefilePath);
  const output = fs.readFileSync(outputPath, 'utf-8');

  assert.equal(buildSystem.shouldUseSgdkMarsdevNoLtoMakefile(sgdkPath, 'darwin'), true);
  assert.equal(buildSystem.shouldUseSgdkMarsdevNoLtoMakefile(sgdkPath, 'win32'), false);
  assert.equal(buildSystem.shouldUseSgdkMarsdevNoLtoMakefile(marsdevPath, 'darwin'), false);
  assert.doesNotMatch(output, /-flto/);
  assert.doesNotMatch(output, /-ffat-lto-objects/);
  assert.doesNotMatch(output, /-fuse-linker-plugin/);
  assert.match(output, /JAVA := java -Djava\.awt\.headless=true/);
  assert.match(output, /\$\(CC\) -m68000 -B\$\(BIN\) -fno-lto -n -T \$\(GDK\)\/md\.ld/);
});

test('make variables are normalized for command-line overrides', () => {
  const buildSystem = loadBuildSystem(makeTempDir('md-editor-build-vars-test-'));

  assert.deepEqual(buildSystem.normalizeMakeVariables({
    SRC_C: 'src/main.c',
    'BAD-NAME': 'ignored',
    MULTILINE: 'a\nb',
    EMPTY_OK: '',
  }), ['SRC_C=src/main.c', 'EMPTY_OK=']);
});

test('build env and make targets are normalized for plugin build options', () => {
  const buildSystem = loadBuildSystem(makeTempDir('md-editor-build-options-test-'));

  assert.deepEqual(buildSystem.normalizeBuildEnv({
    SGDK_TRACE: '1',
    'BAD-NAME': 'ignored',
    PATH: 'ignored',
    NODE_OPTIONS: '--require bad',
    MULTILINE: 'a\nb',
    EMPTY_OK: '',
  }), { SGDK_TRACE: '1', EMPTY_OK: '' });

  assert.deepEqual(buildSystem.normalizeMakeTargets(['release', 'tools-only', '../bad', 'release']), ['release', 'tools-only']);
  assert.deepEqual(buildSystem.normalizeMakeTargets([]), ['release']);
});
