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

function selectorCommands(storyId, variableName, assetId, options = {}) {
  const commands = [
    { type: 'spritetext', slot: 0, text: '← シナリオ選択 →', x: 70, y: 150, color: '#ffffff', blinkFrames: 60, visible: true },
    { type: 'spritetext', slot: 1, text: options.selectorTitle || '選択タイトル', x: 92, y: 172, color: options.selectorColor || '#ffffff', blinkFrames: 0, visible: true },
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
  if (options.counterConflict === 'slot') {
    commands.splice(2, 0, { type: 'spritetext', slot: 2, text: '既存副題', x: 80, y: 178, color: '#ffffff', visible: true });
  } else if (options.counterConflict === 'row') {
    commands.splice(2, 0, { type: 'spritetext', slot: 3, text: '既存副題', x: 80, y: 194, color: '#ffffff', visible: true });
  }
  return commands;
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
        commands: selectorCommands(longSceneId, longVariable, longAssetId, options),
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

async function withAsyncFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-merge-test-'));
  try {
    return await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function importRendererModule() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-project-merger', 'renderer.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
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
  const firstCounter = firstMenu.commands.find((command) => command.type === 'spritetext' && command.slot === 2);
  const secondCounter = secondMenu.commands.find((command) => command.type === 'spritetext' && command.slot === 2);
  assert.deepEqual(firstCounter, {
    type: 'spritetext', slot: 2, text: '(1/2)', x: 98, y: 194,
    color: '#ffffff', blinkFrames: 0, visible: true,
  });
  assert.deepEqual(secondCounter, {
    type: 'spritetext', slot: 2, text: '(2/2)', x: 98, y: 194,
    color: '#ffffff', blinkFrames: 0, visible: true,
  });
  assert.ok(firstMenu.commands.indexOf(firstCounter) < firstMenu.commands.findIndex((command) => command.type === 'inputcheck'));
  assert.equal(firstMenu.commands.filter((command) => command.type === 'spritetext' && command.slot === 2).length, 1);

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

test('project merger numbers three selectors in selected order and inherits the effective SpriteText color', () => withFixture((root) => {
  const first = createProject(root, '1_first');
  const second = createProject(root, '2_second', { selectorColor: '#ff8040' });
  const third = createProject(root, '3_third');
  const output = path.join(root, 'merged-three');
  const options = { projects: [third.projectDir, first.projectDir, second.projectDir], output };
  const inspection = merger.inspectProjectMerge(options);
  assert.equal(inspection.ok, true, JSON.stringify(inspection.errors));
  assert.deepEqual(inspection.inputs.map((entry) => path.basename(entry.canonicalPath)), ['3_third', '1_first', '2_second']);
  const applied = merger.applyProjectMerge({ ...options, signature: inspection.signature });
  assert.equal(applied.ok, true, applied.error);
  const sceneDoc = JSON.parse(fs.readFileSync(path.join(output, 'assets', 'pce-vn-scenes.json'), 'utf8'));
  const counters = ['m001_menu', 'm002_menu', 'm003_menu'].map((sceneId) => (
    sceneDoc.scenes.find((scene) => scene.id === sceneId).commands.find((command) => command.type === 'spritetext' && command.slot === 2)
  ));
  assert.deepEqual(counters.map((command) => command.text), ['(1/3)', '(2/3)', '(3/3)']);
  assert.deepEqual(counters.map((command) => command.x), [98, 98, 98]);
  assert.deepEqual(counters.map((command) => command.color), ['#ffffff', '#ffffff', '#ff8040']);

  const hundredScene = { commands: selectorCommands('story', 'value', 'song') };
  const hundredCounter = merger.injectScenarioCounter(hundredScene, 9, 100, 'hundred fixture');
  assert.equal(hundredCounter.text, '(10/100)');
  assert.equal(hundredCounter.x, 80);
}));

test('project merger rejects selector counter slot and row conflicts without mutating inputs', () => withFixture((root) => {
  const normal = createProject(root, 'normal');
  const slotConflict = createProject(root, 'slot-conflict', { counterConflict: 'slot' });
  const rowConflict = createProject(root, 'row-conflict', { counterConflict: 'row' });
  const slotScenePath = path.join(slotConflict.projectDir, 'assets', 'pce-vn-scenes.json');
  const slotBefore = fs.readFileSync(slotScenePath, 'utf8');
  const slotInspection = merger.inspectProjectMerge({
    projects: [slotConflict.projectDir, normal.projectDir],
    output: path.join(root, 'slot-output'),
  });
  assert.equal(slotInspection.ok, false);
  assert.equal(slotInspection.diagnostics[0].code, 'selector_counter_slot_conflict');
  const rowInspection = merger.inspectProjectMerge({
    projects: [rowConflict.projectDir, normal.projectDir],
    output: path.join(root, 'row-output'),
  });
  assert.equal(rowInspection.ok, false);
  assert.equal(rowInspection.diagnostics[0].code, 'selector_counter_row_conflict');
  assert.equal(fs.readFileSync(slotScenePath, 'utf8'), slotBefore);
}));

test('project discovery recursively reports eligible and disabled candidates in natural order', async () => withAsyncFixture(async (root) => {
  const projectRoot = path.join(root, 'projects');
  fs.mkdirSync(projectRoot, { recursive: true });
  const first = createProject(projectRoot, '1_first');
  const second = createProject(projectRoot, '2_second');
  createProject(projectRoot, '10_tenth');
  createProject(projectRoot, path.join('nested', '3_third'));
  createProject(projectRoot, '20_hucard', { targetMedia: 'hucard' });
  const merged = createProject(projectRoot, '30_merged');
  writeJson(path.join(merged.projectDir, merger.MERGE_MARKER_FILE), { version: 1, tool: 'pce-vn-project-merger' });
  createProject(projectRoot, '40_slot_conflict', { counterConflict: 'slot' });
  const broken = path.join(projectRoot, '50_broken');
  fs.mkdirSync(broken, { recursive: true });
  writeFile(path.join(broken, 'project.json'), '{broken');
  fs.mkdirSync(path.join(projectRoot, 'not-a-project'), { recursive: true });
  const outside = createProject(root, 'outside');
  try {
    fs.symlinkSync(outside.projectDir, path.join(projectRoot, 'linked-outside'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (_error) {
    // Some Windows environments disallow junction creation; containment is asserted below as well.
  }

  const discovery = await merger.discoverProjectMergeCandidates({ root: projectRoot });
  assert.equal(discovery.ok, true, discovery.error);
  const eligible = discovery.candidates.filter((candidate) => candidate.eligible).map((candidate) => candidate.relativePath);
  assert.deepEqual(eligible, ['1_first', '2_second', '10_tenth', 'nested/3_third'], JSON.stringify(discovery.candidates, null, 2));
  assert.equal(discovery.candidates.some((candidate) => candidate.relativePath === 'not-a-project'), false);
  assert.equal(discovery.candidates.some((candidate) => candidate.relativePath === 'linked-outside'), false);
  assert.ok(discovery.candidates.find((candidate) => candidate.relativePath === '20_hucard').reasons.some((reason) => reason.code === 'unsupported_media'));
  assert.ok(discovery.candidates.find((candidate) => candidate.relativePath === '30_merged').reasons.some((reason) => reason.code === 'merged_output'));
  assert.ok(discovery.candidates.find((candidate) => candidate.relativePath === '40_slot_conflict').reasons.some((reason) => reason.code === 'selector_counter_slot_conflict'));
  assert.ok(discovery.candidates.find((candidate) => candidate.relativePath === '50_broken').reasons.some((reason) => reason.code === 'project_config'));

  const outsideInspection = merger.inspectProjectMerge({
    root: projectRoot,
    projects: [first.projectDir, outside.projectDir],
    output: path.join(projectRoot, 'outside-output'),
  });
  assert.equal(outsideInspection.ok, false);
  assert.equal(outsideInspection.diagnostics[0].code, 'input_outside_root');
  const validInspection = merger.inspectProjectMerge({
    root: projectRoot,
    projects: [first.projectDir, second.projectDir],
    output: path.join(projectRoot, 'valid-output'),
  });
  assert.equal(validInspection.ok, true, validInspection.error);
  assert.equal(validInspection.root, fs.realpathSync(projectRoot));

  const context = { appModules: { 'pce-vn-project-merger.js': merger }, logger: { info() {}, error() {} } };
  const pluginDiscovery = await plugin.discoverVnProjectMergeCandidates({ root: projectRoot }, context);
  assert.deepEqual(
    pluginDiscovery.candidates.map((candidate) => [candidate.relativePath, candidate.eligible]),
    discovery.candidates.map((candidate) => [candidate.relativePath, candidate.eligible]),
  );
}));

test('project merger renderer helpers filter, bulk-select, and reorder without selecting disabled candidates', async () => {
  const renderer = await importRendererModule();
  const candidates = [
    { path: 'C:/root/2_second', relativePath: '2_second', title: 'Second', eligible: true },
    { path: 'C:/root/10_tenth', relativePath: '10_tenth', title: 'Tenth', eligible: true },
    { path: 'C:/root/20_bad', relativePath: '20_bad', title: 'Broken', eligible: false },
  ];
  assert.deepEqual(renderer.filterMergeCandidates(candidates, 'tenth').map((entry) => entry.path), ['C:/root/10_tenth']);
  assert.deepEqual(
    renderer.mergeVisibleSelection(['C:/root/10_tenth'], candidates, candidates, false),
    ['C:/root/2_second', 'C:/root/10_tenth'],
  );
  assert.deepEqual(
    renderer.mergeVisibleSelection(['C:/root/10_tenth'], candidates, candidates, true),
    ['C:/root/10_tenth', 'C:/root/2_second'],
  );
  assert.deepEqual(renderer.moveMergeSelection(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(renderer.moveMergeSelection(['a', 'b'], 0, -1), ['a', 'b']);
});

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
  const currentOnly = createProject(root, 'current-only');
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
    projectDir: currentOnly.projectDir,
    appModules: { 'pce-vn-project-merger.js': merger },
    logger: { info() {}, error() {} },
  };
  const pluginInspection = plugin.inspectVnProjectMerge({
    root,
    projects: [first.projectDir, second.projectDir],
    output: pluginOutput,
  }, context);
  const directInspection = merger.inspectProjectMerge({
    root,
    projects: [first.projectDir, second.projectDir],
    output: pluginOutput,
  });
  assert.equal(pluginInspection.signature, directInspection.signature);
  assert.deepEqual(pluginInspection.counts, directInspection.counts);
  assert.deepEqual(pluginInspection.inputs.map((entry) => path.basename(entry.canonicalPath)), ['first', 'second']);
  const pluginApplied = plugin.applyVnProjectMerge({
    root,
    projects: [first.projectDir, second.projectDir],
    output: pluginOutput,
    signature: pluginInspection.signature,
  }, context);
  assert.equal(pluginApplied.ok, true, pluginApplied.error);

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', PLUGIN_ID, 'manifest.json'), 'utf8'));
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', PLUGIN_ID, 'renderer.js'), 'utf8');
  assert.ok(manifest.hooks.includes('discoverVnProjectMergeCandidates'));
  assert.ok(manifest.hooks.includes('inspectVnProjectMerge'));
  assert.ok(manifest.hooks.includes('applyVnProjectMerge'));
  assert.ok(manifest.renderer.capabilities.includes('novel-toolbar-action'));
  assert.match(renderer, /label: 'プロジェクト結合'/);
  assert.match(renderer, /editor\.saveSnapshot\(snapshot\)/);
  assert.match(renderer, /includesCurrent/);
  assert.match(renderer, /scanToken/);
  assert.match(renderer, /表示中を全選択/);
  assert.match(renderer, /signature: state\.inspection\.signature/);
}));

const PLUGIN_ID = 'pce-vn-project-merger';
