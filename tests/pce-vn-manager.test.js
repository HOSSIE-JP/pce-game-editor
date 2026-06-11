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

function loadVnManager(userData = makeTempDir('pce-vn-user-data-')) {
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-vn-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-vn-manager.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-vn-home-') },
  });
}

function loadPceBuildSystem(userData = makeTempDir('pce-vn-build-user-data-')) {
  delete require.cache[require.resolve('../pce-build-system')];
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-vn-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-build-system.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-vn-build-home-') },
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

test('PCE VN manager normalizes scene references and emits CD build patch', () => {
  const projectDir = makeTempDir('pce-vn-project-');
  const vnManager = loadVnManager();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'voice'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'track'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'track', 'cdda.wav'), Buffer.from('RIFF'));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'bg', type: 'image', source: 'assets/images/bg.png' },
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: {
          width: 64,
          height: 32,
          cellWidth: 16,
          cellHeight: 16,
          animations: [
            { id: 'default', frameWidth: 32, frameHeight: 32, firstCell: 0, frameCount: 1, frameDelay: 8, frameStrideCells: 2 },
            { id: 'mouth', frameWidth: 32, frameHeight: 32, firstCell: 2, frameCount: 2, frameDelay: 4, frameStrideCells: 2 },
          ],
        },
      },
      { id: 'voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } } },
      { id: 'track', type: 'cdda-track', source: 'assets/cdda/track.wav', options: { track: 2 }, data: { generated: { outputFile: 'assets/generated/track/cdda.wav' } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 1,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      backgroundAssetId: 'bg',
      characters: [{ assetId: 'hero', x: 500, y: -10 }, { assetId: 'hero' }],
      messages: [{ text: 'こんにちは', voiceAssetId: 'voice', textSpeedFrames: 3, mouthAnimationId: 'mouth' }],
      bgmAssetId: 'track',
      nextSceneId: 'missing',
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.scenes[0].commands[0].type, 'background');
  assert.equal(normalized.scenes[0].commands[1].type, 'sprite');
  assert.equal(normalized.scenes[0].commands[1].x, 319);
  assert.equal(normalized.scenes[0].commands[1].y, 0);
  assert.equal(normalized.scenes[0].commands[2].x, 128);
  assert.equal(normalized.scenes[0].commands[2].y, 24);
  assert.equal(normalized.scenes[0].commands[3].type, 'audio');
  assert.equal(normalized.scenes[0].commands[4].textSpeedFrames, 3);
  assert.equal(normalized.scenes[0].nextSceneId, '');

  const prepared = vnManager.prepareVisualNovelBuild(projectDir, { cd: { dataFiles: [] } });
  assert.equal(prepared.configPatch.targetMedia, 'cd');
  assert.equal(prepared.configPatch.toolchain, 'llvm-mos');
  assert.deepEqual(prepared.configPatch.cd.dataFiles, ['assets/generated/voice/adpcm.bin']);
  assert.deepEqual(prepared.configPatch.cd.cddaTracks, ['assets/generated/track/cdda.wav']);
  assert.equal(prepared.generated.sceneCount, 1);
  assert.equal(prepared.generated.commandCount, 5);
  assert.equal(prepared.generated.spriteAnimationCount, 2);
  const header = fs.readFileSync(prepared.generated.headerPath, 'utf-8');
  const source = fs.readFileSync(prepared.generated.sourcePath, 'utf-8');
  assert.match(header, /PCE_VN_FONT_TILE_BASE 712u/);
  assert.match(header, /void pce_vn_font_tiles_map\(void\);/);
  assert.match(header, /PCE_VN_COMMAND_BACKGROUND 0u/);
  assert.match(header, /PCE_VN_COMMAND_PRELOAD 4u/);
  assert.match(header, /typedef struct \{\n  const pce_vn_choice_option_t \*options;/);
  assert.match(header, /pce_vn_command_t/);
  assert.match(source, /PCE_RAM_BANK_AT\(132, 6\);/);
  assert.match(source, /PCE_VN_FONT_SECTION pce_vn_font_tiles\[\]/);
  assert.match(source, /#define PCE_VN_DATA_SECTION __attribute__\(\(section\("\.ram_bank132"\)\)\)/);
  assert.match(source, /pce_ram_bank132_map\(\);/);
  assert.match(source, /const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations\[\]/);
  assert.match(source, /const pce_vn_choice_t PCE_VN_DATA_SECTION pce_vn_choices\[\]/);
  assert.match(source, /const pce_vn_command_t PCE_VN_DATA_SECTION pce_vn_commands\[\]/);
  assert.match(source, /\{ 2u, -1, 0u, 0u, 0u, 0u, 0u, 0u, 0, -1, -1, -1 \}/);
});

test('PCE VN manager default scene does not auto-play the first CD-DA asset', () => {
  const vnManager = loadVnManager();
  const doc = vnManager.defaultSceneDocument({
    assets: [
      { id: 'bg', type: 'image', source: 'assets/images/bg.png' },
      { id: 'track2', type: 'cdda-track', source: 'assets/cdda/track2.wav', options: { track: 2 } },
    ],
  });

  assert.equal(doc.scenes[0].commands[0].type, 'background');
  assert.equal(doc.scenes[0].commands.some((command) => command.type === 'audio'), false);
});

test('PCE VN manager normalizes future scene VM commands and keeps scene pack CD order', () => {
  const projectDir = makeTempDir('pce-vn-scene-vm-');
  const vnManager = loadVnManager();
  const makeFile = (relativePath, size) => {
    const absPath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.alloc(size));
  };
  makeFile('assets/generated/bg_a/tiles.bin', 18432);
  makeFile('assets/generated/bg_a/map_vram.bin', 2048);
  makeFile('assets/generated/hero/patterns.bin', 4096);
  makeFile('assets/generated/bg_b/tiles.bin', 18432);
  makeFile('assets/generated/bg_b/map_vram.bin', 2048);
  makeFile('assets/generated/rival/patterns.bin', 4096);
  makeFile('assets/generated/voice/adpcm.bin', 2400);
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'bg_a', type: 'image', data: { generated: { tilesFile: 'assets/generated/bg_a/tiles.bin', mapVramFile: 'assets/generated/bg_a/map_vram.bin' } } },
      { id: 'hero', type: 'sprite', data: { generated: { tilesFile: 'assets/generated/hero/patterns.bin' } } },
      { id: 'bg_b', type: 'image', data: { generated: { tilesFile: 'assets/generated/bg_b/tiles.bin', mapVramFile: 'assets/generated/bg_b/map_vram.bin' } } },
      { id: 'rival', type: 'sprite', data: { generated: { tilesFile: 'assets/generated/rival/patterns.bin' } } },
      { id: 'voice', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [
      {
        id: 'opening',
        commands: [
          { type: 'background', assetId: 'bg_a' },
          { type: 'sprite', assetId: 'hero', visible: true, flipX: true, flipY: true, durationFrames: 12 },
          { type: 'preload', sceneId: 'next' },
          { type: 'choice', defaultIndex: 1, choices: [{ label: '見る', targetSceneId: 'next' }, { label: '待つ', targetSceneId: 'opening' }] },
        ],
      },
      {
        id: 'next',
        commands: [
          { type: 'effect', effect: 'fadeOut', frames: 12 },
          { type: 'background', assetId: 'bg_b', transition: 'fade', fadeOutFrames: 8, fadeInFrames: 16, x: 2, y: 4 },
          { type: 'sprite', assetId: 'rival', visible: true },
          { type: 'effect', effect: 'shake', frames: 20, intensity: 6 },
          { type: 'message', text: '次です', voiceAssetId: 'voice' },
          { type: 'wait', frames: 45 },
          { type: 'jump', sceneId: 'opening' },
        ],
      },
    ],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[2].type, 'preload');
  assert.equal(normalized.scenes[0].commands[2].sceneId, 'next');
  assert.equal(normalized.scenes[0].commands[3].type, 'choice');
  assert.equal(normalized.scenes[0].commands[3].choices[0].targetSceneId, 'next');
  assert.equal(normalized.scenes[0].commands[1].flipX, true);
  assert.equal(normalized.scenes[0].commands[1].flipY, true);
  assert.equal(normalized.scenes[0].commands[1].durationFrames, 12);
  assert.equal(normalized.scenes[1].commands[0].type, 'effect');
  assert.equal(normalized.scenes[1].commands[1].x, 2);
  assert.equal(normalized.scenes[1].commands[1].y, 4);
  assert.equal(normalized.scenes[1].commands[3].effect, 'shake');
  assert.equal(normalized.scenes[1].commands[3].intensity, 6);
  assert.equal(normalized.scenes[1].commands[5].frames, 45);
  assert.equal(normalized.scenes[1].commands[6].sceneId, 'opening');
  assert.deepEqual(vnManager.collectCdDataFiles(projectDir), [
    'assets/generated/bg_a/tiles.bin',
    'assets/generated/bg_a/map_vram.bin',
    'assets/generated/hero/patterns.bin',
    'assets/generated/bg_b/tiles.bin',
    'assets/generated/bg_b/map_vram.bin',
    'assets/generated/rival/patterns.bin',
    'assets/generated/voice/adpcm.bin',
  ]);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.equal(generated.choiceCount, 1);
  assert.match(header, /PCE_VN_COMMAND_CHOICE 5u/);
  assert.match(header, /PCE_VN_SPRITE_FLIP_X 2u/);
  assert.match(header, /PCE_VN_SPRITE_FLIP_Y 4u/);
  assert.match(header, /PCE_VN_EFFECT_FADE_OUT 0u/);
  assert.match(header, /PCE_VN_EFFECT_SHAKE 3u/);
  assert.match(source, /pce_vn_choice_0_options/);
  assert.match(source, /\{ 0u, 1, 0u, 1u, 8u, 16u, 2u, 4u, -1, -1, -1, -1 \}/);
  assert.match(source, /\{ 1u, 0, 0u, 7u, 12u, 0u, 128u, 24u, -1, 0, -1, -1 \}/);
  assert.match(source, /\{ 4u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, 1, -1 \}/);
  assert.match(source, /\{ 5u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, -1, 0 \}/);
  assert.match(source, /\{ 8u, -1, 0u, 3u, 20u, 6u, 0u, 0u, -1, -1, -1, -1 \}/);
  assert.match(source, /\{ 7u, -1, 0u, 0u, 45u, 0u, 0u, 0u, -1, -1, -1, -1 \}/);
  assert.match(source, /\{ 6u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, 0, -1 \}/);
});

test('PCE VN manager emits variable, branch, switch, label, and goto commands', () => {
  const projectDir = makeTempDir('pce-vn-control-vm-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'variable', variableName: 'score', operation: 'define', value: 2 },
        { type: 'choice', variableName: 'choice_result', choices: [{ label: '左', value: 7 }, { label: '右', value: 8 }] },
        { type: 'label', name: 'check' },
        { type: 'if', variableName: 'score', operator: 'gte', value: 2, targetLabel: 'has_score', elseLabel: 'no_score' },
        { type: 'label', name: 'has_score' },
        { type: 'variable', variableName: 'score', operation: 'add', value: 3 },
        { type: 'switch', variableName: 'score', cases: [{ value: 5, targetLabel: 'route_a' }, { value: 8, targetLabel: 'no_score' }], defaultLabel: 'no_score' },
        { type: 'label', name: 'route_a' },
        { type: 'goto', targetLabel: 'end' },
        { type: 'label', name: 'no_score' },
        { type: 'variable', variableName: 'roll', operation: 'random', min: 1, max: 6 },
        { type: 'label', name: 'end' },
        { type: 'wait', frames: 1 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[0].type, 'variable');
  assert.equal(normalized.scenes[0].commands[1].variableName, 'choice_result');
  assert.equal(normalized.scenes[0].commands[1].choices[0].value, 7);
  assert.equal(normalized.scenes[0].commands[3].targetLabel, 'has_score');
  assert.equal(normalized.scenes[0].commands[6].cases.length, 2);
  assert.equal(normalized.scenes[0].commands[8].targetLabel, 'end');

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.equal(generated.variableCount, 3);
  assert.equal(generated.choiceCount, 1);
  assert.equal(generated.switchCount, 1);
  assert.equal(generated.commandCount, 13);
  assert.match(header, /PCE_VN_COMMAND_VARIABLE 9u/);
  assert.match(header, /PCE_VN_COMMAND_IF 10u/);
  assert.match(header, /PCE_VN_COMMAND_SWITCH 11u/);
  assert.match(header, /PCE_VN_COMMAND_LABEL 12u/);
  assert.match(header, /PCE_VN_COMMAND_GOTO 13u/);
  assert.match(header, /PCE_VN_VARIABLE_STORAGE_COUNT 3u/);
  assert.match(header, /signed int voice_index;/);
  assert.match(header, /signed int mouth_animation_index;/);
  assert.match(header, /signed int target_scene;/);
  assert.match(header, /signed int variable_index;/);
  assert.match(header, /signed int asset_index;/);
  assert.match(header, /signed int message_index;/);
  assert.match(header, /signed int animation_index;/);
  assert.match(header, /signed int scene_index;/);
  assert.match(header, /signed int choice_index;/);
  assert.match(header, /signed int next_scene;/);
  assert.match(header, /typedef struct \{\n  signed int value;\n  unsigned int command;\n\} pce_vn_switch_case_t;/);
  assert.match(source, /const signed int PCE_VN_DATA_SECTION pce_vn_variable_initial_values\[\] = \{\n  2,\n  0,\n  0\n\};/);
  assert.match(source, /\{ pce_vn_choice_0_option_0_glyphs, 1u, 7, -1 \}/);
  assert.match(source, /\{ pce_vn_switch_0_cases, 2u, 9u \}/);
  assert.match(source, /\{ 9u, 0, 0u, 0u, 2u, 0u, 0u, 0u, -1, -1, -1, -1 \}/);
  assert.match(source, /\{ 10u, 0, 0u, 5u, 2u, 0u, 4u, 9u, -1, -1, -1, -1 \}/);
  assert.match(source, /\{ 11u, 0, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, -1, 0 \}/);
  assert.match(source, /\{ 13u, -1, 0u, 0u, 0u, 0u, 11u, 0u, -1, -1, -1, -1 \}/);
  assert.match(source, /\{ 9u, 2, 0u, 4u, 0u, 0u, 1u, 6u, -1, -1, -1, -1 \}/);
});

test('PCE VN manager keeps generated indexes valid past signed char range', () => {
  const projectDir = makeTempDir('pce-vn-wide-indexes-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: Array.from({ length: 130 }, (_, index) => ({
        type: 'choice',
        variableName: `choice_${index}`,
        choices: [{ label: 'A', value: index }],
      })),
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');

  assert.equal(generated.choiceCount, 130);
  assert.equal(generated.variableCount, 130);
  assert.match(header, /signed int choice_index;/);
  assert.match(header, /signed int variable_index;/);
  assert.match(source, /const unsigned char PCE_VN_DATA_SECTION pce_vn_choice_count = 130;/);
  assert.match(source, /const unsigned char PCE_VN_DATA_SECTION pce_vn_variable_count = 130;/);
  assert.match(source, /\{ 5u, -1, 0u, 0u, 0u, 0u, 0u, 0u, -1, -1, -1, 129 \}/);
  assert.match(source, /\{ pce_vn_choice_129_options, 1u, 0u, 129 \}/);
});

test('PCE VN manager expands default sprite animation to the whole sprite sheet', () => {
  const projectDir = makeTempDir('pce-vn-sprite-default-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: {
          width: 64,
          height: 128,
          cellWidth: 16,
          cellHeight: 16,
        },
        data: {
          generated: {
            width: 64,
            height: 128,
            cellColumns: 4,
            cellRows: 8,
          },
        },
      },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'sprite', assetId: 'hero', x: 128, y: 24, visible: true },
        { type: 'message', text: 'A', textSpeedFrames: 0, advance: 'manual' },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.match(source, /\{ 0u, 0u, 1u, 8u, 4u, 8u, 32u, 1u \}/);
});

test('PCE VN runtime keeps VDC DRAM refresh enabled while toggling display layers', () => {
  const wrapperPaths = [
    path.join(__dirname, '..', 'plugins', 'pce-sample-builder', 'template-vn', 'src', 'main.c'),
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'main.c'),
  ];
  for (const wrapperPath of wrapperPaths) {
    assert.equal(fs.readFileSync(wrapperPath, 'utf-8').trim(), '#include "pce_vn_runtime.c"');
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'), 'utf-8');
  const setBackgroundMatch = source.match(/static void set_background[\s\S]*?\n}\n\nstatic uint8_t execute_command/);
  const preloadSceneMatch = source.match(/static void preload_scene_assets[\s\S]*?\n}\n\nstatic void draw_choice_options/);
  assert.ok(setBackgroundMatch);
  assert.ok(preloadSceneMatch);
  const setBackgroundSource = setBackgroundMatch[0];
  const preloadSceneSource = preloadSceneMatch[0];
  assert.match(source, /#define VN_VDC_CONTROL_BASE \(VDC_CONTROL_IRQ_VBLANK \| VDC_CONTROL_DRAM_REFRESH \| VDC_CONTROL_VRAM_ADD_1\)/);
  assert.match(source, /#define VN_VDC_DISPLAY_CONTROL \(VN_VDC_CONTROL_BASE \| VDC_CONTROL_ENABLE_BG \| VDC_CONTROL_ENABLE_SPRITE\)/);
  assert.match(source, /#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE/);
  assert.match(source, /#define VN_UI_BLANK_TILE PCE_VN_FONT_TILE_BASE/);
  assert.doesNotMatch(source, /static const uint8_t vn_ui_black_tile\[32\]/);
  assert.doesNotMatch(source, /vce_write_color\(\(uint16_t\)\(base \+ 1u\), 0x0000u\);/);
  assert.match(source, /for \(i = 1u; i < 16u; i\+\+\)/);
  assert.doesNotMatch(source, /static void upload_ui_tiles\(void\)/);
  assert.match(source, /map_vn_data\(\);\n    pce_editor_vram_copy/);
  assert.match(source, /upload_ui_palette\(\);\n    upload_font_tiles\(\);\n    clear_screen_map\(\);/);
  assert.doesNotMatch(source, /vce_write_color\(0u, 0x0000u\);/);
  assert.match(source, /static void draw_blank_cell\(uint8_t x, uint8_t y\)/);
  assert.match(source, /static void clear_window_cells\(void\)/);
  assert.match(source, /draw_blank_cell\(\(uint8_t\)\(VN_TEXT_X \+ \(col \* 2u\)\), \(uint8_t\)\(VN_TEXT_Y \+ \(row \* 2u\)\)\);/);
  assert.match(source, /clear_window_cells\(\);/);
  assert.doesNotMatch(source, /fill_window_rect/);
  assert.match(source, /static uint8_t draw_message_next_glyph/);
  assert.match(source, /play_adpcm_voice\(message\.voice_index\);/);
  assert.match(source, /draw_message_text\(&message\);/);
  assert.match(source, /static void fade_palette/);
  assert.match(source, /static uint8_t pending_scene_sprite_clear = 0;/);
  assert.match(source, /static uint8_t loaded_sprite_pattern_valid = 0;/);
  assert.match(source, /static uint8_t loaded_sprite_pattern_index = 0;/);
  assert.match(source, /static uint8_t loaded_adpcm_valid = 0;/);
  assert.match(source, /static void init_runtime_state\(void\)/);
  assert.match(source, /current_bg_index = -1;/);
  assert.match(source, /preloaded_bg_valid = 0u;/);
  assert.match(source, /loaded_sprite_pattern_valid = 0u;/);
  assert.match(source, /active_message_index = -1;/);
  assert.match(source, /active_choice_index = -1;/);
  assert.match(source, /#define VN_VDC_BG_ONLY_CONTROL \(VN_VDC_CONTROL_BASE \| VDC_CONTROL_ENABLE_BG\)/);
  assert.match(source, /PCE_RAM_BANK_AT\(128, 2\);/);
  assert.match(source, /PCE_RAM_BANK_AT\(129, 3\);/);
  assert.match(source, /#define VN_BANKED_CODE __attribute__\(\(noinline, section\("\.ram_bank129"\)\)\)/);
  assert.match(source, /#define VN_VDC_MEMORY_CONTROL \(VDC_CYCLE_4_SLOTS \| VDC_BG_SIZE_64_32\)/);
  assert.match(source, /static void map_resident_data\(void\)/);
  assert.match(source, /pce_ram_bank128_map\(\);/);
  assert.match(source, /static void sprite_layer_disable\(void\)/);
  assert.match(source, /pce_cdb_vdc_sprite_disable\(\);\n    pce_vdc_poke\(VDC_REG_CONTROL, VN_VDC_BG_ONLY_CONTROL\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_CONTROL, VN_VDC_BG_ONLY_CONTROL\);/);
  assert.match(source, /static void sprite_layer_enable\(void\)/);
  assert.match(source, /pce_cdb_vdc_sprite_enable\(\);\n    pce_vdc_poke\(VDC_REG_CONTROL, VN_VDC_DISPLAY_CONTROL\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_CONTROL, VN_VDC_DISPLAY_CONTROL\);/);
  assert.match(source, /keep_display_for_transition = \(uint8_t\)\(current_bg_index >= 0 && !pending_display_enable\);/);
  assert.match(source, /static void clear_map_rect_at_dest\(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles\)/);
  assert.match(source, /static void clear_bg_map_region\(const pce_editor_bg_asset_t \*bg, uint16_t tile_x, uint16_t tile_y\)/);
  assert.match(setBackgroundSource, /fade_palette\(&pce_editor_bg_assets\[\(uint8_t\)current_bg_index\]\.palette[\s\S]*fade_out_frames, 0u\);/);
  assert.match(setBackgroundSource, /const uint8_t restore_display_after_bg_load = \(uint8_t\)!pending_display_enable;/);
  assert.match(setBackgroundSource, /clear_bg_map_region\(&pce_editor_bg_assets\[\(uint8_t\)current_bg_index\], current_bg_x, current_bg_y\);/);
  assert.match(setBackgroundSource, /clear_bg_map_region\(next_bg, next_x, next_y\);/);
  assert.match(setBackgroundSource, /upload_bg_graphics\(next_bg, bg_map_dest_from_tile\(next_bg, next_x, next_y\)\);\n        if \(restore_display_after_bg_load\) display_enable\(\);/);
  assert.doesNotMatch(setBackgroundSource, /display_disable\(\);/);
  assert.doesNotMatch(setBackgroundSource, /preload_scene_assets/);
  assert.match(source, /if \(pending_scene_sprite_clear\)\n    \{\n        clear_sprites\(\);\n        upload_sprite_table\(\);/);
  assert.match(source, /bg_ready = \(uint8_t\)\(preloaded_bg_valid\n        && preloaded_bg_index == \(uint8_t\)bg_index\n        && preloaded_bg_x == next_x\n        && preloaded_bg_y == next_y\);/);
  assert.match(source, /static void VN_BANKED_CODE refresh_scene_sprites\(void\)/);
  assert.match(source, /const uint8_t display_active = \(uint8_t\)!pending_display_enable;/);
  assert.match(source, /uint8_t requires_pattern_upload = 0u;/);
  assert.match(source, /map_vn_data\(\);\n    map_resident_data\(\);/);
  assert.match(source, /if \(!loaded_sprite_pattern_valid \|\| loaded_sprite_pattern_index != \(uint8_t\)slot->sprite_index\)\n        \{\n            requires_pattern_upload = 1u;/);
  assert.match(source, /if \(display_active && requires_pattern_upload\)\n    \{\n        sprite_layer_disable\(\);\n        upload_sprite_table\(\);\n        delay_frame\(\);/);
  assert.match(source, /draw_meta = &pce_editor_sprite_draw_meta\[sprite_index\];/);
  assert.match(source, /sprite_draw_meta\.cell_width = draw_meta->cell_width;/);
  assert.match(source, /if \(animation_value\.sprite_index == sprite_index\)\n            \{\n                animation = &animation_value;/);
  assert.match(source, /animation->frame_count > 1u/);
  assert.match(source, /animation->frame_width_cells <= cell_columns/);
  assert.match(source, /frame_columns = use_animation_frame && animation->frame_width_cells \? animation->frame_width_cells : cell_columns;/);
  assert.match(source, /upload_sprite_table\(\);\n    if \(display_active\)\n    \{\n        sprite_layer_enable\(\);\n        if \(requires_pattern_upload\) delay_frame\(\);/);
  assert.match(source, /#define VN_CD_SECTOR_BYTES 2048u/);
  assert.match(source, /#define VN_MAP_ROW_BYTES \(VN_MAP_WIDTH \* 2u\)/);
  assert.match(source, /static uint8_t cd_transfer_scratch\[VN_CD_SECTOR_BYTES\];/);
  assert.match(source, /static uint8_t cdda_active = 0;/);
  assert.match(source, /static void preload_scene_assets\(signed int scene_index, uint8_t allow_visual_upload\);/);
  assert.match(source, /static uint8_t adpcm_stream_looping = 0;/);
  assert.match(source, /static uint8_t adpcm_stream_monitor_frames = 0;/);
  assert.match(source, /#define VN_ADPCM_STREAM_MONITOR_FRAMES 4u/);
  assert.match(source, /static void VN_BANKED_CODE service_adpcm_streaming\(void\);/);
  assert.match(source, /static void cd_sector_from_ref\(pce_sector_t \*dest, const pce_editor_cd_sector_t \*source\)/);
  assert.match(source, /dest->hi = source \? source->hi : 0u;/);
  assert.match(source, /static void cd_sector_from_uint\(pce_sector_t \*dest, unsigned long value\)/);
  assert.match(source, /static void cd_sector_advance\(pce_sector_t \*sector\)/);
  assert.match(source, /static void cd_transfer_wait\(void\)/);
  assert.match(source, /for \(wait = 0u; wait < 65535u; wait\+\+\) \{\}/);
  assert.match(source, /static void prepare_cd_data_access\(void\)/);
  assert.match(source, /if \(!cdda_active\) return;/);
  assert.match(source, /cdda_active = 0u;/);
  assert.match(source, /pce_cdb_cd_read\(sector, PCE_CDB_VRAM_BYTES, vram_dest, chunk\);/);
  assert.match(source, /prepare_cd_data_access\(\);[\s\S]*pce_cdb_cd_read\(sector, PCE_CDB_VRAM_BYTES, vram_dest, chunk\);/);
  assert.match(source, /!ref->cd->sector_count \|\| !ref->size/);
  assert.match(source, /cd_transfer_wait\(\);/);
  assert.doesNotMatch(source, /pce_cdb_cd_busy\(\)/);
  assert.doesNotMatch(source, /pce_editor_vram_copy\(vram_dest,/);
  assert.match(source, /cd_sector_advance\(&sector\);/);
  assert.match(source, /static uint8_t cd_bg_map_ref_to_vram\(uint16_t dest, const pce_editor_data_ref_t \*ref, uint8_t width_tiles, uint8_t height_tiles\)/);
  assert.match(source, /const uint8_t dest_col = \(uint8_t\)\(dest % VN_MAP_WIDTH\);/);
  assert.match(source, /row_bytes = \(uint16_t\)\(copy_width_tiles \* 2u\);/);
  assert.match(source, /pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);/);
  assert.match(source, /prepare_cd_data_access\(\);[\s\S]*pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);/);
  assert.match(source, /pce_editor_vram_copy\(\(uint16_t\)\(dest \+ \(\(uint16_t\)row \* VN_MAP_WIDTH\)\), &cd_transfer_scratch\[local_offset\], row_bytes\);/);
  assert.match(source, /static uint16_t bg_map_dest_from_tile\(const pce_editor_bg_asset_t \*bg, uint16_t tile_x, uint16_t tile_y\)/);
  assert.match(source, /copy_data_ref_to_vram\(\(uint16_t\)\(bg->tile_base \* 16u\), &bg->tiles, 16u\);\n    map_resident_data\(\);/);
  assert.match(source, /if \(bg->map\.cd && bg->map\.size\)\n    \{\n        if \(cd_bg_map_ref_to_vram\(map_dest, &bg->map, bg->width_tiles, bg->height_tiles\)\) return;\n    \}/);
  assert.doesNotMatch(source, /copy_data_ref_to_vram\(bg->map_base, &bg->map, 16u\);/);
  assert.match(source, /cd_sector_from_ref\(&sector, &ref->cd->sector\);/);
  assert.match(source, /voice->cd && voice->cd->sector_count/);
  assert.match(source, /typedef struct\s*\{[\s\S]*unsigned long data_size;[\s\S]*pce_editor_cd_sector_t cd_sector;[\s\S]*uint8_t has_cd;[\s\S]*\} vn_adpcm_voice_t;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE adpcm_play_divider\(unsigned int sample_rate, uint8_t divider\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE adpcm_voice_fits_buffer\(const vn_adpcm_voice_t \*voice\)/);
  assert.match(source, /if \(voice->data_size > 65535ul\) return 0u;/);
  assert.match(source, /limit = 65536ul - \(unsigned long\)voice->adpcm_address;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE copy_adpcm_voice\(signed int voice_index, vn_adpcm_voice_t \*dest\)/);
  assert.match(source, /map_resident_data\(\);\n    if \(\(uint8_t\)voice_index >= pce_editor_adpcm_asset_count\) return 0u;/);
  assert.match(source, /dest->data_size = voice->data_size;/);
  assert.match(source, /dest->cd_sector\.lo = voice->cd->sector\.lo;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE adpcm_playback_active\(void\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE wait_adpcm_transfer_ready\(void\)/);
  assert.match(source, /while \(guard && \(pce_cdb_adpcm_status\(\) & ADPCM_BUSY\)\)/);
  assert.match(source, /return guard \? 1u : 0u;/);
  assert.match(source, /static void VN_BANKED_CODE restore_display_after_adpcm\(uint8_t restore_display\)/);
  assert.match(source, /if \(restore_display\) display_enable\(\);/);
  assert.match(source, /static uint8_t VN_BANKED_CODE load_adpcm_voice\(signed int voice_index, uint8_t allow_stop_playback, uint8_t allow_stream_asset\)/);
  assert.match(source, /const uint8_t restore_display = \(uint8_t\)!pending_display_enable;/);
  assert.match(source, /if \(voice\.stream && !allow_stream_asset\) return 0u;/);
  assert.match(source, /if \(!allow_stop_playback\) return 0u;/);
  assert.match(source, /pce_cdb_adpcm_stop\(\);\n        \(void\)wait_adpcm_transfer_ready\(\);/);
  assert.match(source, /loaded_adpcm_valid = 0u;\n    pce_cdb_adpcm_reset\(\);\n    if \(!wait_adpcm_transfer_ready\(\)\)\n    \{\n        map_resident_data\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;\n    \}/);
  assert.match(source, /const uint16_t sector_count = voice\.cd_sector_count;/);
  assert.match(source, /const uint8_t read_count = sector_count > 255u \? 255u : \(uint8_t\)sector_count;/);
  assert.match(source, /uint8_t loaded = 0u;/);
  assert.match(source, /prepare_cd_data_access\(\);\s+cd_sector_from_ref\(&sector, &voice\.cd_sector\);\s+loaded = \(uint8_t\)\(!pce_cdb_adpcm_read_from_cd\(sector, read_count, voice\.adpcm_address\)\);/);
  assert.match(source, /if \(!loaded\)\n    \{\n        map_resident_data\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;\n    \}/);
  assert.match(source, /if \(!wait_adpcm_transfer_ready\(\)\)[\s\S]*map_resident_data\(\);[\s\S]*loaded_adpcm_valid = 1u;/);
  assert.match(source, /loaded_adpcm_valid = 1u;/);
  assert.match(source, /loaded_adpcm_index = \(uint8_t\)voice_index;\n    restore_display_after_adpcm\(restore_display\);\n    return 1u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE stream_adpcm_voice\(signed int voice_index\)/);
  assert.match(source, /cd_sector_from_uint\(&length, \(unsigned long\)voice\.cd_sector_count\);/);
  assert.match(source, /divider = adpcm_play_divider\(voice\.sample_rate, voice\.divider\);/);
  assert.match(source, /if \(pce_cdb_adpcm_stream\(sector, length, divider\)\)\n    \{\n        map_resident_data\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;\n    \}/);
  assert.match(source, /adpcm_stream_looping = voice\.loop \? 1u : 0u;/);
  assert.match(source, /adpcm_stream_index = \(uint8_t\)voice_index;\n    adpcm_stream_monitor_frames = adpcm_voice_fits_buffer\(&voice\) \? VN_ADPCM_STREAM_MONITOR_FRAMES : 0u;\n    restore_display_after_adpcm\(restore_display\);\n    return 1u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE play_adpcm_buffered_voice\(signed int voice_index, uint8_t restore_display\)/);
  assert.match(source, /if \(!adpcm_voice_fits_buffer\(&voice\)\) return 0u;/);
  assert.match(source, /adpcm_stream_looping = 0u;\n    adpcm_stream_monitor_frames = 0u;\n    if \(!load_adpcm_voice\(voice_index, 1u, 1u\)\)/);
  assert.match(source, /if \(adpcm_voice_fits_buffer\(&voice\)\)\n        \{\n            \(void\)play_adpcm_buffered_voice\(voice_index, restore_display\);\n            restore_display_after_adpcm\(restore_display\);\n            return;\n        \}/);
  assert.match(source, /\(void\)stream_adpcm_voice\(voice_index\);\n        restore_display_after_adpcm\(restore_display\);\n        return;/);
  assert.match(source, /divider = adpcm_play_divider\(voice\.sample_rate, voice\.divider\);/);
  assert.match(source, /if \(pce_cdb_adpcm_play\(voice\.adpcm_address, \(uint16_t\)voice\.data_size, divider,/);
  assert.match(source, /loaded_adpcm_valid = 0u;\n        map_resident_data\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;/);
  assert.match(source, /map_resident_data\(\);\n    restore_display_after_adpcm\(restore_display\);/);
  assert.match(source, /static void VN_BANKED_CODE service_adpcm_streaming\(void\)[\s\S]*if \(!adpcm_stream_looping && !adpcm_stream_monitor_frames\) return;[\s\S]*\(void\)play_adpcm_buffered_voice\(\(signed int\)adpcm_stream_index, \(uint8_t\)!pending_display_enable\);[\s\S]*\(void\)stream_adpcm_voice\(\(signed int\)adpcm_stream_index\);/);
  assert.match(source, /static void preload_adpcm_voice\(signed int voice_index\)[\s\S]*\(void\)load_adpcm_voice\(voice_index, 0u, 0u\);/);
  assert.doesNotMatch(source, /divider = adpcm_play_divider\(voice\);/);
  assert.match(source, /return \(uint8_t\)\(pattern_cols \* pattern_rows \* 2u\);/);
  assert.match(source, /static uint8_t ensure_sprite_patterns_loaded\(uint8_t sprite_index, const pce_editor_sprite_asset_t \*sprite\)/);
  assert.match(source, /if \(loaded_sprite_pattern_valid && loaded_sprite_pattern_index == sprite_index\) return 0u;/);
  assert.match(source, /copy_data_ref_to_vram\(\(uint16_t\)\(sprite->pattern_base \* 32u\), &sprite->patterns, 16u\);/);
  assert.match(source, /static void preload_scene_assets\(signed int scene_index, uint8_t allow_visual_upload\)/);
  assert.match(preloadSceneSource, /if \(!allow_visual_upload \|\| !pending_display_enable\) continue;[\s\S]*PCE_VN_COMMAND_SPRITE[\s\S]*if \(!allow_visual_upload \|\| !pending_display_enable\) continue;/);
  assert.match(source, /preloaded_bg_x == \(uint8_t\)command\.x[\s\S]*preloaded_bg_y == \(uint8_t\)command\.y/);
  assert.match(source, /upload_bg_graphics\([\s\S]*&pce_editor_bg_assets\[\(uint8_t\)command\.asset_index\],[\s\S]*bg_map_dest_from_tile\(&pce_editor_bg_assets\[\(uint8_t\)command\.asset_index\], command\.x, command\.y\)/);
  assert.match(source, /ensure_sprite_patterns_loaded\(\(uint8_t\)command\.asset_index, &pce_editor_sprite_assets\[\(uint8_t\)command\.asset_index\]\);/);
  assert.match(source, /static signed int vn_variables\[PCE_VN_VARIABLE_STORAGE_COUNT\];/);
  assert.match(source, /pce_vn_variable_initial_values\[i\]/);
  assert.match(source, /static signed int command_value_arg\(const pce_vn_command_t \*command\)/);
  assert.match(source, /static signed int random_range_value\(signed int min, signed int max\)/);
  assert.match(source, /static uint8_t compare_values\(signed int left, uint8_t operator_id, signed int right\)/);
  assert.match(source, /static uint8_t jump_to_command\(uint16_t command_offset\)/);
  assert.match(source, /static void draw_choice_options\(void\)/);
  assert.match(source, /PCE_VN_CHOICE_CURSOR_GLYPH/);
  assert.match(source, /static uint8_t handle_choice_input\(uint8_t pressed\)/);
  assert.match(source, /set_variable_value\(choice\.variable_index, option\.value\);/);
  assert.match(source, /pce_cdb_cdda_pause\(\)/);
  assert.match(source, /pce_cdb_adpcm_stop\(\)/);
  assert.match(source, /static uint8_t execute_command\(const pce_vn_command_t \*command\)/);
  const audioCommandMatch = source.match(/else if \(command->type == PCE_VN_COMMAND_AUDIO\)[\s\S]*?\n    \}\n    else if \(command->type == PCE_VN_COMMAND_MESSAGE\)/);
  assert.ok(audioCommandMatch);
  assert.match(audioCommandMatch[0], /else play_adpcm_voice\(command->asset_index\);/);
  assert.doesNotMatch(audioCommandMatch[0], /VN_EXEC_WAIT|VN_EXEC_RESTART|return/);
  assert.match(source, /static uint8_t VN_BANKED_CODE run_commands_until_wait\(void\)/);
  assert.match(source, /PCE_VN_COMMAND_PRELOAD/);
  assert.match(source, /preload_scene_assets\(command->scene_index, pending_display_enable\);/);
  assert.match(source, /PCE_VN_COMMAND_CHOICE/);
  assert.match(source, /PCE_VN_COMMAND_VARIABLE/);
  assert.match(source, /PCE_VN_COMMAND_IF/);
  assert.match(source, /PCE_VN_COMMAND_SWITCH/);
  assert.match(source, /PCE_VN_COMMAND_LABEL/);
  assert.match(source, /PCE_VN_COMMAND_GOTO/);
  assert.match(source, /PCE_VN_COMMAND_JUMP/);
  assert.match(source, /PCE_VN_COMMAND_WAIT/);
  assert.match(source, /PCE_VN_COMMAND_EFFECT/);
  assert.match(source, /#define VN_COMMAND_STEP_GUARD 1024u/);
  assert.match(source, /wait_frames_remaining = 1u;\n                return 1u;/);
  assert.match(source, /show_character_sprite_frame/);
  assert.match(source, /sprite_slots\[slot\]\.flags = command->flags;/);
  assert.match(source, /animate_sprite_slot\(slot, command->x, command->y, command->arg0\);/);
  assert.match(source, /for \(step = 0u; step < frames; step\+\+\)/);
  assert.match(source, /PCE_VN_EFFECT_SHAKE/);
  assert.match(source, /shake_screen\(command->arg0, command->arg1\);/);
  assert.match(source, /if \(!pending_display_enable\) delay_frame\(\);/);
  assert.match(source, /display_enable\(\);\n        pending_display_enable = 0u;\n        delay_frame\(\);/);
  assert.doesNotMatch(source, /current_message/);
  assert.doesNotMatch(source, /pending_cdda_track/);
  assert.doesNotMatch(source, /show_current_message\(\);\n    for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);\n    if \(pending_sprite_refresh\)/);
  assert.doesNotMatch(source, /if \(pending_sprite_refresh\)\n            \{\n                for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);/);
  assert.match(source, /\*PCE_CDB_SPR_INDEX = i;/);
  assert.match(source, /\*PCE_CDB_SPR_Y = sprite_shadow\[i\]\.y;/);
  assert.match(source, /\*PCE_CDB_SPR_X = sprite_shadow\[i\]\.x;/);
  assert.match(source, /\*PCE_CDB_SPR_PATTERN = sprite_shadow\[i\]\.pattern;/);
  assert.match(source, /\*PCE_CDB_SPR_ATTR = sprite_shadow\[i\]\.attr;/);
  assert.match(source, /pce_cdb_vdc_sprite_table_put\(\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_SATB_START, VN_SATB_ADDR\);/);
  assert.doesNotMatch(source, /PCE_CDB_SPRITE\[i\] = sprite_shadow\[i\];/);
  assert.match(source, /pce_sector_t start = \{0\};/);
  assert.match(source, /pce_sector_t end = \{0\};/);
  assert.match(source, /static void play_cdda_track\(const pce_editor_cdda_asset_t \*cdda\)/);
  assert.match(source, /const uint8_t mode = PCE_CDB_CDDA_PLAY_REPEAT;/);
  assert.match(source, /const uint8_t restore_display_after_cdda = \(uint8_t\)!pending_display_enable;/);
  assert.match(source, /static void service_cdda_playback\(void\);/);
  assert.match(source, /pce_cdb_wait_vblank\(\);\n    service_cdda_playback\(\);/);
  assert.match(source, /uint8_t end_type = PCE_CDB_LOCATION_TYPE_UNTIL_END;/);
  assert.match(source, /static uint8_t cdda_has_frame_limit = 0;/);
  assert.match(source, /static uint8_t cdda_looping = 0;/);
  assert.match(source, /static uint8_t cdda_track = 0;/);
  assert.match(source, /static uint16_t cdda_frames_remaining = 0;/);
  assert.match(source, /static const pce_editor_cdda_asset_t \*cdda_current = \(const pce_editor_cdda_asset_t \*\)0;/);
  assert.match(source, /if \(cdda_active\)\n    \{\n        \(void\)pce_cdb_cdda_pause\(\);\n        cdda_active = 0u;\n    \}/);
  assert.match(source, /start\.lo = cdda->start_sector\.lo;\n    start\.md = cdda->start_sector\.md;\n    start\.hi = cdda->start_sector\.hi;/);
  assert.match(source, /cdda_has_frame_limit = cdda->play_frames \? 1u : 0u;/);
  assert.match(source, /cdda_frames_remaining = cdda->play_frames;/);
  assert.match(source, /\(void\)pce_cdb_cdda_play\(PCE_CDB_LOCATION_TYPE_SECTOR, start, end_type, end, mode\);\n    cdda_active = 1u;/);
  assert.match(source, /static void service_cdda_playback\(void\)/);
  assert.match(source, /if \(!cdda_active \|\| !cdda_has_frame_limit \|\| !cdda_current\) return;/);
  assert.match(source, /if \(cdda_frames_remaining\) cdda_frames_remaining--;/);
  assert.match(source, /if \(cdda_frames_remaining\) return;/);
  assert.match(source, /if \(cdda_looping\)\n        \{\n            cdda_active = 0u;\n            play_cdda_track\(cdda_current\);/);
  assert.match(source, /if \(restore_display_after_cdda\) display_enable\(\);/);
  assert.doesNotMatch(source, /pce_cdb_cdda_read_subcode_q/);
  assert.doesNotMatch(source, /pce_cdb_cd_scan\(\)/);
  assert.doesNotMatch(source, /PCE_CDB_LOCATION_TYPE_TRACK, end/);
  assert.match(source, /play_cdda_track\(cdda\);/);
  assert.match(source, /pce_ram_bank129_map\(\);\n    pce_cdb_irq_enable\(\(uint8_t\)\(PCE_CDB_MASK_IRQ_EXTERNAL \| PCE_CDB_MASK_VBLANK\)\);/);
  assert.match(source, /pending_sprite_refresh = 1u;\n    preload_scene_assets\(\(signed int\)scene_index, 1u\);/);
  assert.match(source, /init_runtime_state\(\);\n    init_video\(\);\n    map_vn_data\(\);\n    start_scene = pce_vn_start_scene;\n    show_scene\(start_scene\);\n    advance_story\(\);/);
  assert.doesNotMatch(source, /show_scene\(start_scene\);\n    preload_scene_assets\(\(signed int\)start_scene\);/);
  assert.doesNotMatch(source, /preload_scene_assets\(\(signed int\)current_scene/);
  assert.doesNotMatch(source, /PCE_CDB_CDDA_PLAY_NOT_BUSY/);
});

test('PCE build system regenerates visual novel sources from saved scenes', async () => {
  const projectDir = path.join(makeTempDir('pce-vn-build-project-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), projectDir, { recursive: true });
  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
  sceneDoc.scenes[0].commands = [
    { type: 'message', text: 'A', textSpeedFrames: 0, advance: 'manual' },
  ];
  sceneDoc.scenes[0].nextSceneId = '';
  sceneDoc.scenes = [sceneDoc.scenes[0]];
  writeJson(scenePath, sceneDoc);

  const buildSystem = loadPceBuildSystem();
  buildSystem.openProject(projectDir);
  const result = await buildSystem.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.commandInfo.targetMedia, 'cd');
  assert.ok(result.commandInfo.mkcdArgs.some((arg) => /pce_cd_data_padding\.bin$/.test(arg)));
  assert.equal(result.generated.visualNovel.messageCount, 1);
  const source = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'vn.c'), 'utf-8');
  assert.match(source, /const unsigned char PCE_VN_DATA_SECTION pce_vn_message_count = 1;/);
});
