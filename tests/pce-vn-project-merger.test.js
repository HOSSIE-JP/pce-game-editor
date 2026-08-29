'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const merger = require('../pce-vn-project-merger');
const plugin = require('../plugins/pce-vn-project-merger');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeFile(filePath, value = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function selectorCommands(storyId, variableName, assetId) {
  return [
    { type: 'inputcheck', mode: 'sync', buttons: ['right'], targetLabel: 'NEXT_SCR' },
    { type: 'inputcheck', mode: 'sync', buttons: ['left'], targetLabel: 'PREV_SCR' },
    { type: 'label', name: 'NEXT_SCR' },
    { type: 'jump', sceneId: storyId },
    { type: 'label', name: 'PREV_SCR' },
    { type: 'jump', sceneId: storyId },
    { type: 'audio', kind: 'psg', action: 'play', assetId, channel: 0 },
    { type: 'variable', variableName, operation: 'define', value: 0 },
    {
      type: 'choice',
      variableName,
      choices: [
        { label: '進む', value: 1, targetSceneId: storyId },
        { label: '戻る', value: 0, targetSceneId: '' },
      ],
    },
  ];
}

function createProject(root, name, options = {}) {
  const projectDir = path.join(root, name);
  const longAssetId = 'shared_asset_identifier_that_is_forty_chars_01';
  const longSceneId = 'shared_scene_identifier_that_is_forty_chars_01';
  const longVariable = 'shared_variable_name_is_long_01';
  const warningSource = 'assets/audio/warning.wav';
  const cddaSource = 'assets/audio/game.wav';
  const psgSource = 'assets/psg/shared.psg.json';
  const generatedOutput = 'assets/generated/shared/output.bin';
  const generatedPreview = 'assets/generated/shared/preview.json';
  const highQualitySource = 'assets/images-hd/shared.png';
  [
    [warningSource, Buffer.from([0, 1, 2])],
    [cddaSource, Buffer.from([3, 4, 5])],
    [psgSource, Buffer.from('{"version":2}')],
    [generatedOutput, Buffer.from([6, 7, 8])],
    [generatedPreview, Buffer.from('{}')],
    [highQualitySource, Buffer.from([9, 10, 11])],
    ['assets/fonts/test.ttf', Buffer.from('font')],
  ].forEach(([relative, bytes]) => writeFile(path.join(projectDir, relative), bytes));

  writeJson(path.join(projectDir, 'project.json'), {
    coreId: 'pc-engine',
    platform: 'pce',
    title: name,
    author: options.author || 'Fixture Author',
    serial: options.serial || 'FIXTURE0001',
    region: 'JUE',
    romName: name,
    toolchain: 'llvm-mos',
    targetMedia: options.targetMedia || 'cd',
    cd: {
      iplPath: '',
      systemCardPath: 'C:/system-card.pce',
      systemCardProfile: 'jp-v3',
      isoName: '',
      dataFiles: [],
      cddaTracks: [],
    },
    testPlay: { externalEmulator: { executablePath: 'C:/Geargrafx.exe', extraArgs: '' } },
    pluginRoles: { builder: 'pce-visual-novel-hucard-builder', testplay: 'pce-standard-emulator' },
    pluginSettings: { 'pce-visual-novel-builder': { template: 'visual-novel-cd' } },
  });
  writeJson(path.join(projectDir, 'assets', 'pce-font.json'), {
    version: 1,
    fontPath: 'assets/fonts/test.ttf',
    fonts: [{ file: 'assets/fonts/test.ttf', label: 'test.ttf' }],
    fontSize: 12,
  });
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'cdda_warning',
        type: 'cdda-warning',
        name: `${name}/warning`,
        source: warningSource,
        options: {},
      },
      {
        id: longAssetId,
        type: 'psg-song',
        name: `${name}/song`,
        source: options.inlinePsg ? '' : psgSource,
        options: {
          kind: 'song',
          bpm: 120,
          steps: 16,
          volume: 90,
          loop: true,
          pattern: [
            { step: 0, channel: 0, period: 428, volume: 16, wave: 0 },
            { step: 8, channel: 0, period: 428, volume: 0, wave: 0 },
          ],
        },
        data: {
          generated: { outputFile: generatedOutput, previewFile: generatedPreview },
          import: { highQualitySource },
        },
      },
      {
        id: 'shared_cdda',
        type: 'cdda-track',
        name: `${name}/cdda`,
        source: cddaSource,
        options: { track: options.track || 9, loop: false },
      },
    ],
  });
  writeJson(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), {
    version: 2,
    settings: {
      messageSpeedFrames: options.messageSpeedFrames ?? 10,
      messageAdvanceMode: 'button',
      messageAutoWaitFrames: 60,
    },
    startScene: 'menu',
    scenes: options.empty ? [] : [
      {
        id: 'menu',
        name: `${name}/menu`,
        nextSceneId: longSceneId,
        commands: selectorCommands(longSceneId, longVariable, longAssetId),
      },
      {
        id: longSceneId,
        name: `${name}/story`,
        nextSceneId: 'menu',
        commands: [
          { type: 'audio', kind: 'psg', action: 'play', assetId: longAssetId, channel: 0 },
          { type: 'variable', variableName: longVariable, operation: 'set', value: 1 },
          {
            type: 'choice',
            variableName: longVariable,
            choices: [
              { label: 'Menu', value: 0, targetSceneId: 'menu' },
              { label: 'Stay', value: 1, targetSceneId: longSceneId },
            ],
          },
          { type: 'jump', sceneId: 'menu' },
          { type: 'audio', kind: 'psg', action: 'play', bgmAssetId: longAssetId },
          { type: 'variable', variable: 'legacy_variable', operation: 'set', value: 1 },
          {
            type: 'choice',
            variable: 'legacy_variable',
            choices: [{ label: 'Legacy', value: 0, target: 'menu' }],
          },
          { type: 'jump', nextSceneId: 'menu' },
        ],
      },
    ],
  });
  return { projectDir, longAssetId, longSceneId, longVariable, psgSource };
}

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-merge-test-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function jumpAfter(scene, label) {
  const index = scene.commands.findIndex((command) => command.type === 'label' && command.name === label);
  return scene.commands[index + 1];
}

test('project merger namespaces every reference, copies registered files, and connects selectors in a ring', () => withFixture((root) => {
  const first = createProject(root, 'first', { track: 7 });
  const second = createProject(root, 'second', {
    track: 12,
    serial: 'FIXTURE0002',
    messageSpeedFrames: 20,
    inlinePsg: true,
  });
  const output = path.join(root, 'merged');
  const options = { projects: [first.projectDir, second.projectDir], output, title: 'Merged Horror' };

  const inspection = merger.inspectProjectMerge(options);
  assert.equal(inspection.ok, true, JSON.stringify(inspection.errors));
  assert.equal(inspection.counts.scenes, 4);
  assert.equal(inspection.counts.assets, 5);
  assert.deepEqual(inspection.counts.assetTypes, {
    'cdda-warning': 1,
    'psg-song': 2,
    'cdda-track': 2,
  });
  assert.ok(inspection.warnings.some((entry) => entry.code === 'settings_difference'));
  assert.equal(inspection.buildInspection.limits.scenes, 0x7fff);

  const result = merger.applyProjectMerge({ ...options, signature: inspection.signature });
  assert.equal(result.ok, true, result.error);
  const sceneDoc = JSON.parse(fs.readFileSync(path.join(output, 'assets', 'pce-vn-scenes.json'), 'utf8'));
  const assetDoc = JSON.parse(fs.readFileSync(path.join(output, 'assets', 'pce-assets.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(output, 'project.json'), 'utf8'));
  const marker = JSON.parse(fs.readFileSync(path.join(output, merger.MERGE_MARKER_FILE), 'utf8'));

  const firstMenu = sceneDoc.scenes.find((scene) => scene.id === 'm001_menu');
  const secondMenu = sceneDoc.scenes.find((scene) => scene.id === 'm002_menu');
  assert.equal(jumpAfter(firstMenu, 'NEXT_SCR').sceneId, 'm002_menu');
  assert.equal(jumpAfter(firstMenu, 'PREV_SCR').sceneId, 'm002_menu');
  assert.equal(jumpAfter(secondMenu, 'NEXT_SCR').sceneId, 'm001_menu');
  assert.equal(jumpAfter(secondMenu, 'PREV_SCR').sceneId, 'm001_menu');
  assert.equal(sceneDoc.startScene, 'm001_menu');

  const firstMaps = marker.inputs[0];
  const mappedLongScene = firstMaps.sceneMap[first.longSceneId];
  const mappedLongAsset = firstMaps.assetMap[first.longAssetId];
  const mappedLongVariable = firstMaps.variableMap[first.longVariable];
  assert.ok(mappedLongScene.length <= merger.SCENE_ID_LIMIT);
  assert.ok(mappedLongAsset.length <= merger.ASSET_ID_LIMIT);
  assert.ok(mappedLongVariable.length <= merger.VARIABLE_NAME_LIMIT);
  const firstStory = sceneDoc.scenes.find((scene) => scene.id === mappedLongScene);
  assert.equal(firstStory.nextSceneId, 'm001_menu');
  assert.equal(firstStory.commands[0].assetId, mappedLongAsset);
  assert.equal(firstStory.commands[1].variableName, mappedLongVariable);
  assert.equal(firstStory.commands[2].choices[0].targetSceneId, 'm001_menu');
  assert.equal(firstStory.commands[2].choices[1].targetSceneId, mappedLongScene);
  assert.equal(firstStory.commands[3].sceneId, 'm001_menu');
  assert.equal(firstStory.commands[4].bgmAssetId, mappedLongAsset);
  assert.equal(firstStory.commands[5].variable, 'm001_legacy_variable');
  assert.equal(firstStory.commands[6].variable, 'm001_legacy_variable');
  assert.equal(firstStory.commands[6].choices[0].target, 'm001_menu');
  assert.equal(firstStory.commands[7].nextSceneId, 'm001_menu');

  assert.equal(assetDoc.assets.filter((asset) => asset.type === 'cdda-warning').length, 1);
  assert.deepEqual(
    assetDoc.assets.filter((asset) => asset.type === 'cdda-track').map((asset) => asset.options.track),
    [3, 4],
  );
  const mergedSong = assetDoc.assets.find((asset) => asset.id === mappedLongAsset);
  assert.match(mergedSong.source, /^assets\/merged\/m001_\//);
  assert.match(mergedSong.data.generated.outputFile, /^assets\/merged\/m001_\//);
  assert.match(mergedSong.data.import.highQualitySource, /^assets\/merged\/m001_\//);
  [mergedSong.source, mergedSong.data.generated.outputFile, mergedSong.data.import.highQualitySource]
    .forEach((relative) => assert.equal(fs.existsSync(path.join(output, relative)), true));

  assert.equal(config.title, 'Merged Horror');
  assert.equal(config.romName, 'Merged Horror');
  assert.equal(config.author, 'Fixture Author');
  assert.equal(config.serial, 'FIXTURE0001');
  assert.equal(config.targetMedia, 'cd');
  assert.equal(config.toolchain, 'llvm-mos');
  assert.equal(config.pluginRoles.builder, 'pce-visual-novel-builder');
  assert.equal(config.cd.systemCardPath, 'C:/system-card.pce');
  assert.equal(config.testPlay.externalEmulator.executablePath, 'C:/Geargrafx.exe');
  assert.equal(fs.existsSync(path.join(output, 'assets', 'fonts', 'test.ttf')), true);
  assert.equal(fs.existsSync(path.join(output, 'source')), false);
  assert.equal(fs.existsSync(path.join(output, 'out')), false);
}));

test('project merger rejects stale signatures, unsafe output relationships, empty inputs, and non-owned replacement', () => withFixture((root) => {
  const first = createProject(root, 'first');
  const second = createProject(root, 'second');
  const output = path.join(root, 'merged');
  const options = { projects: [first.projectDir, second.projectDir], output };
  const inspection = merger.inspectProjectMerge(options);
  assert.equal(inspection.ok, true);
  fs.appendFileSync(path.join(first.projectDir, first.psgSource), '\n');
  const stale = merger.applyProjectMerge({ ...options, signature: inspection.signature });
  assert.equal(stale.ok, false);
  assert.equal(stale.diagnostics[0].code, 'signature_mismatch');

  const contained = merger.inspectProjectMerge({
    projects: [first.projectDir, second.projectDir],
    output: path.join(first.projectDir, 'merged'),
  });
  assert.equal(contained.ok, false);
  assert.match(contained.error, /contain each other/);

  const empty = createProject(root, 'empty', { empty: true });
  const emptyInspection = merger.inspectProjectMerge({ projects: [first.projectDir, empty.projectDir], output });
  assert.equal(emptyInspection.ok, false);
  assert.match(emptyInspection.error, /empty/);

  const collision = createProject(root, 'collision');
  writeFile(path.join(collision.projectDir, 'collision.psg.json'), '{"version":2}');
  writeFile(path.join(collision.projectDir, 'assets', 'collision.psg.json'), '{"version":2}');
  const collisionAssetPath = path.join(collision.projectDir, 'assets', 'pce-assets.json');
  const collisionAssets = JSON.parse(fs.readFileSync(collisionAssetPath, 'utf8'));
  collisionAssets.assets.push(
    { id: 'collision_a', type: 'psg-song', source: 'collision.psg.json', options: { pattern: [] } },
    { id: 'collision_b', type: 'psg-song', source: 'assets/collision.psg.json', options: { pattern: [] } },
  );
  writeJson(collisionAssetPath, collisionAssets);
  const collisionInspection = merger.inspectProjectMerge({
    projects: [first.projectDir, collision.projectDir],
    output: path.join(root, 'collision-output'),
  });
  assert.equal(collisionInspection.ok, false);
  assert.match(collisionInspection.error, /copy destination collision/);

  const foreign = path.join(root, 'foreign');
  fs.mkdirSync(foreign);
  writeFile(path.join(foreign, 'keep.txt'), 'owned by user');
  const replaceForeign = merger.inspectProjectMerge({
    projects: [first.projectDir, second.projectDir],
    output: foreign,
    replace: true,
  });
  assert.equal(replaceForeign.ok, false);
  assert.match(replaceForeign.error, /allowed only/);
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'owned by user');
}));

test('owned merge outputs require --replace and can be replaced atomically', () => withFixture((root) => {
  const first = createProject(root, 'first');
  const second = createProject(root, 'second');
  const output = path.join(root, 'merged');
  const options = { projects: [first.projectDir, second.projectDir], output };
  const inspection = merger.inspectProjectMerge(options);
  assert.equal(merger.applyProjectMerge({ ...options, signature: inspection.signature }).ok, true);
  assert.equal(merger.inspectProjectMerge(options).ok, false);
  const replacement = merger.inspectProjectMerge({ ...options, replace: true, title: 'Replacement' });
  assert.equal(replacement.ok, true, replacement.error);
  const applied = merger.applyProjectMerge({
    ...options,
    replace: true,
    title: 'Replacement',
    signature: replacement.signature,
  });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'project.json'), 'utf8')).title, 'Replacement');
}));

test('CLI dry-run/apply and plugin inspect/apply use the common merger result', () => withFixture((root) => {
  const first = createProject(root, 'first');
  const second = createProject(root, 'second');
  const dryOutput = path.join(root, 'cli-dry');
  const cli = path.join(__dirname, '..', 'scripts', 'pce-vn-project-merge.js');
  const dry = spawnSync(process.execPath, [
    cli, '--output', dryOutput, '--dry-run', first.projectDir, second.projectDir,
  ], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  const dryResult = JSON.parse(dry.stdout);
  assert.equal(dryResult.ok, true);
  assert.equal(dryResult.counts.scenes, 4);
  assert.equal(fs.existsSync(dryOutput), false);

  const pluginOutput = path.join(root, 'plugin-output');
  const context = {
    projectDir: first.projectDir,
    appModules: { 'pce-vn-project-merger.js': merger },
    logger: { info() {}, error() {} },
  };
  const pluginInspection = plugin.inspectVnProjectMerge({
    projects: [first.projectDir, second.projectDir],
    output: pluginOutput,
  }, context);
  const directInspection = merger.inspectProjectMerge({
    projects: [first.projectDir, second.projectDir],
    output: pluginOutput,
  });
  assert.equal(pluginInspection.signature, directInspection.signature);
  assert.deepEqual(pluginInspection.counts, directInspection.counts);
  const pluginApplied = plugin.applyVnProjectMerge({
    projects: [first.projectDir, second.projectDir],
    output: pluginOutput,
    signature: pluginInspection.signature,
  }, context);
  assert.equal(pluginApplied.ok, true, pluginApplied.error);

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', PLUGIN_ID, 'manifest.json'), 'utf8'));
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', PLUGIN_ID, 'renderer.js'), 'utf8');
  assert.ok(manifest.hooks.includes('inspectVnProjectMerge'));
  assert.ok(manifest.hooks.includes('applyVnProjectMerge'));
  assert.ok(manifest.renderer.capabilities.includes('novel-toolbar-action'));
  assert.match(renderer, /label: 'プロジェクト結合'/);
  assert.match(renderer, /editor\.saveSnapshot\(snapshot\)/);
  assert.match(renderer, /signature: state\.inspection\.signature/);
}));

const PLUGIN_ID = 'pce-vn-project-merger';
