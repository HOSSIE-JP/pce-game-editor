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
  assert.match(header, /pce_vn_command_t/);
  assert.match(source, /PCE_RAM_BANK_AT\(132, 6\);/);
  assert.match(source, /PCE_VN_FONT_SECTION pce_vn_font_tiles\[\]/);
  assert.match(source, /pce_ram_bank132_map\(\);/);
  assert.match(source, /const pce_vn_sprite_anim_t pce_vn_sprite_animations\[\]/);
  assert.match(source, /const pce_vn_command_t pce_vn_commands\[\]/);
  assert.match(source, /\{ 2u, -1, 0u, 0u, 0u, 0u, 0u, 0u, 0, -1 \}/);
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
  const runtimePaths = [
    path.join(__dirname, '..', 'plugins', 'pce-sample-builder', 'template-vn', 'src', 'main.c'),
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'main.c'),
  ];

  for (const runtimePath of runtimePaths) {
    const source = fs.readFileSync(runtimePath, 'utf-8');
    assert.match(source, /#define VN_VDC_CONTROL_BASE \(VDC_CONTROL_IRQ_VBLANK \| VDC_CONTROL_DRAM_REFRESH \| VDC_CONTROL_VRAM_ADD_1\)/);
    assert.match(source, /#define VN_VDC_DISPLAY_CONTROL \(VN_VDC_CONTROL_BASE \| VDC_CONTROL_ENABLE_BG \| VDC_CONTROL_ENABLE_SPRITE\)/);
    assert.match(source, /#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE/);
    assert.match(source, /#define VN_UI_BLANK_TILE PCE_VN_FONT_TILE_BASE/);
    assert.doesNotMatch(source, /static const uint8_t vn_ui_black_tile\[32\]/);
    assert.doesNotMatch(source, /vce_write_color\(\(uint16_t\)\(base \+ 1u\), 0x0000u\);/);
    assert.match(source, /for \(i = 1u; i < 16u; i\+\+\)/);
    assert.doesNotMatch(source, /static void upload_ui_tiles\(void\)/);
    assert.match(source, /pce_vn_font_tiles_map\(\);\n    pce_editor_vram_copy/);
    assert.match(source, /upload_ui_palette\(\);\n    upload_font_tiles\(\);\n    clear_screen_map\(\);/);
    assert.doesNotMatch(source, /vce_write_color\(0u, 0x0000u\);/);
    assert.match(source, /static void draw_blank_cell\(uint8_t x, uint8_t y\)/);
    assert.match(source, /static void clear_window_cells\(void\)/);
    assert.match(source, /draw_blank_cell\(\(uint8_t\)\(VN_TEXT_X \+ \(col \* 2u\)\), \(uint8_t\)\(VN_TEXT_Y \+ \(row \* 2u\)\)\);/);
    assert.match(source, /clear_window_cells\(\);/);
    assert.doesNotMatch(source, /fill_window_rect/);
    assert.match(source, /static uint8_t draw_message_next_glyph/);
    assert.match(source, /play_adpcm_voice\(message->voice_index\);/);
    assert.match(source, /draw_message_text\(message\);/);
    assert.match(source, /static void fade_palette/);
    assert.match(source, /pce_cdb_cdda_pause\(\)/);
    assert.match(source, /pce_cdb_adpcm_stop\(\)/);
    assert.match(source, /static void execute_command\(const pce_vn_command_t \*command\)/);
    assert.match(source, /show_character_sprite_frame/);
    assert.match(source, /if \(!pending_display_enable\) delay_frame\(\);/);
    assert.match(source, /display_enable\(\);\n    pending_display_enable = 0;\n    delay_frame\(\);/);
    assert.doesNotMatch(source, /current_message/);
    assert.doesNotMatch(source, /pending_cdda_track/);
    assert.doesNotMatch(source, /show_current_message\(\);\n    for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);\n    if \(pending_sprite_refresh\)/);
    assert.doesNotMatch(source, /if \(pending_sprite_refresh\)\n            \{\n                for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);/);
    assert.match(source, /pce_editor_vram_copy\(VN_SATB_ADDR, \(const uint8_t \*\)sprite_shadow, \(uint16_t\)\(64u \* sizeof\(vdc_sprite_t\)\)\);/);
    assert.match(source, /pce_vdc_poke\(VDC_REG_SATB_START, VN_SATB_ADDR\);/);
    assert.doesNotMatch(source, /pce_cdb_vdc_sprite_table_put\(\);/);
    assert.match(source, /pce_sector_t start = \{0\};/);
    assert.match(source, /pce_sector_t end = \{0\};/);
    assert.match(source, /PCE_CDB_CDDA_PLAY_ONE_SHOT/);
    assert.doesNotMatch(source, /PCE_CDB_CDDA_PLAY_NOT_BUSY/);
    assert.doesNotMatch(source, /PCE_CDB_CDDA_PLAY_REPEAT/);
  }
});

test('PCE build system regenerates visual novel sources from saved scenes', async () => {
  const projectDir = path.join(makeTempDir('pce-vn-build-project-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), projectDir, { recursive: true });
  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
  sceneDoc.scenes[0].commands = [
    { type: 'message', text: 'A', textSpeedFrames: 0, advance: 'manual' },
  ];
  writeJson(scenePath, sceneDoc);

  const buildSystem = loadPceBuildSystem();
  buildSystem.openProject(projectDir);
  const result = await buildSystem.buildProject(() => {}, {
    dryRun: true,
    allowMissingToolchain: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.commandInfo.targetMedia, 'cd');
  assert.equal(result.generated.visualNovel.messageCount, 1);
  const source = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'vn.c'), 'utf-8');
  assert.match(source, /const unsigned char pce_vn_message_count = 1;/);
});
