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

function loadCoreManager(userData, home = makeTempDir('md-editor-core-home-')) {
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

test('core manager infers legacy MD and PCE project cores', () => {
  const userData = makeTempDir('md-editor-core-state-');
  const coreManager = loadCoreManager(userData);
  const parent = makeTempDir('md-editor-core-projects-');
  const mdProject = path.join(parent, 'md');
  const pceProject = path.join(parent, 'pce');
  fs.mkdirSync(mdProject, { recursive: true });
  fs.mkdirSync(pceProject, { recursive: true });
  fs.writeFileSync(path.join(mdProject, 'project.json'), JSON.stringify({ title: 'MD' }), 'utf-8');
  fs.writeFileSync(path.join(pceProject, 'project.json'), JSON.stringify({ platform: 'pce', title: 'PCE' }), 'utf-8');

  assert.equal(coreManager.getCoreIdForProjectDir(mdProject), 'mega-drive');
  assert.equal(coreManager.getCoreIdForProjectDir(pceProject), 'pc-engine');
});

test('core manager creates PC Engine projects from the PCE template', async () => {
  const userData = makeTempDir('md-editor-core-pce-state-');
  const coreManager = loadCoreManager(userData);
  const created = coreManager.createProjectInParent('', 'demo_pce', {
    coreId: 'pc-engine',
    title: 'Demo PCE',
  }, null, { templateId: 'template_pce_sample' });

  const config = JSON.parse(fs.readFileSync(path.join(created.projectDir, 'project.json'), 'utf-8'));
  assert.equal(config.coreId, 'pc-engine');
  assert.equal(config.platform, 'pce');
  assert.equal(config.pluginRoles.builder, 'pce-sample-builder');
  assert.equal(fs.existsSync(path.join(created.projectDir, 'assets', 'pce-assets.json')), true);

  const result = await coreManager.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });
  assert.equal(result.success, true);
  assert.equal(result.commandInfo.toolchain, 'llvm-mos');
  assert.equal(path.extname(result.commandInfo.romPath), '.pce');
});

test('core manager keeps banked PCE slideshow assets on llvm-mos', async () => {
  const userData = makeTempDir('md-editor-core-pce-banked-state-');
  const coreManager = loadCoreManager(userData);
  coreManager.createProjectInParent('', 'demo_pce_banked', {
    coreId: 'pc-engine',
    title: 'Demo PCE Banked',
    toolchain: 'llvm-mos',
  }, null, { templateId: 'template_pce_sample' });

  const result = await coreManager.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });
  assert.equal(result.success, true);
  assert.equal(result.generated.requiresLlvmMos, true);
  assert.equal(result.commandInfo.toolchain, 'llvm-mos');
});

test('core manager constructs experimental PCE-CD build commands through llvm-mos', async () => {
  const userData = makeTempDir('md-editor-core-pce-cd-state-');
  const coreManager = loadCoreManager(userData);
  coreManager.createProjectInParent('', 'demo_pce_cd', {
    coreId: 'pc-engine',
    title: 'Demo PCE CD',
    targetMedia: 'cd',
  }, null, { templateId: 'template_pce_sample' });
  const projectDir = coreManager.getProjectDir();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'track'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'track', 'cdda.wav'), Buffer.from('RIFF____WAVE'));
  const assetDoc = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'pce-assets.json'), 'utf-8'));
  assetDoc.assets.push({
    id: 'track',
    type: 'cdda-track',
    name: 'Track',
    source: 'assets/cdda/track.wav',
    options: { track: 2 },
    data: { generated: { outputFile: 'assets/generated/track/cdda.wav' } },
  });
  fs.writeFileSync(path.join(projectDir, 'assets', 'pce-assets.json'), JSON.stringify(assetDoc, null, 2), 'utf-8');

  const result = await coreManager.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
    config: { targetMedia: 'cd', toolchain: 'llvm-mos' },
  });

  assert.equal(result.success, true);
  assert.equal(result.commandInfo.toolchain, 'llvm-mos');
  assert.equal(result.commandInfo.targetMedia, 'cd');
  assert.match(result.commandInfo.command, /mos-pce-cd-clang$/);
  assert.match(result.commandInfo.mkcdCommand, /pce-mkcd$/);
  assert.equal(result.commandInfo.cddaTracks.length, 1);
  assert.equal(result.commandInfo.cddaTracks[0].track, 2);
  assert.equal(path.extname(result.commandInfo.elfPath), '.elf');
  assert.equal(path.extname(result.commandInfo.romPath), '.cue');
});
