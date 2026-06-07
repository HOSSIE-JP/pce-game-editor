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
      { id: 'hero', type: 'sprite', source: 'assets/sprites/hero.png' },
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
      messages: [{ text: 'こんにちは', voiceAssetId: 'voice' }],
      bgmAssetId: 'track',
      nextSceneId: 'missing',
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].characters[0].x, 319);
  assert.equal(normalized.scenes[0].characters[0].y, 0);
  assert.equal(normalized.scenes[0].characters[1].x, 128);
  assert.equal(normalized.scenes[0].characters[1].y, 24);
  assert.equal(normalized.scenes[0].nextSceneId, '');

  const prepared = vnManager.prepareVisualNovelBuild(projectDir, { cd: { dataFiles: [] } });
  assert.equal(prepared.configPatch.targetMedia, 'cd');
  assert.equal(prepared.configPatch.toolchain, 'llvm-mos');
  assert.deepEqual(prepared.configPatch.cd.dataFiles, ['assets/generated/voice/adpcm.bin']);
  assert.deepEqual(prepared.configPatch.cd.cddaTracks, ['assets/generated/track/cdda.wav']);
  assert.equal(prepared.generated.sceneCount, 1);
  assert.match(fs.readFileSync(prepared.generated.headerPath, 'utf-8'), /PCE_VN_FONT_TILE_BASE 712u/);
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
    assert.match(source, /vce_write_color\(\(uint16_t\)\(base \+ 1u\), 0x0000u\);/);
    assert.match(source, /for \(i = 2u; i < 16u; i\+\+\)/);
    assert.doesNotMatch(source, /static void upload_ui_tiles\(void\)/);
    assert.match(source, /upload_ui_palette\(\);\n    upload_font_tiles\(\);\n    clear_screen_map\(\);/);
    assert.doesNotMatch(source, /vce_write_color\(0u, 0x0000u\);/);
    assert.match(source, /static void draw_blank_cell\(uint8_t x, uint8_t y\)/);
    assert.match(source, /static void clear_window_cells\(void\)/);
    assert.match(source, /draw_blank_cell\(\(uint8_t\)\(VN_TEXT_X \+ \(col \* 2u\)\), \(uint8_t\)\(VN_TEXT_Y \+ \(row \* 2u\)\)\);/);
    assert.match(source, /clear_window_cells\(\);/);
    assert.doesNotMatch(source, /fill_window_rect/);
    assert.match(source, /play_adpcm_voice\(message->voice_index\);\n        clear_window_cells\(\);\n        draw_message_text\(message\);/);
    assert.match(source, /if \(!pending_display_enable\) delay_frame\(\);/);
    assert.match(source, /display_enable\(\);\n    pending_display_enable = 0;\n    delay_frame\(\);/);
    assert.doesNotMatch(source, /show_current_message\(\);\n    for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);\n    if \(pending_sprite_refresh\)/);
    assert.doesNotMatch(source, /if \(pending_sprite_refresh\)\n            \{\n                for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);/);
    assert.match(source, /pce_editor_vram_copy\(VN_SATB_ADDR, \(const uint8_t \*\)sprite_shadow, \(uint16_t\)\(64u \* sizeof\(vdc_sprite_t\)\)\);/);
    assert.match(source, /pce_vdc_poke\(VDC_REG_SATB_START, VN_SATB_ADDR\);/);
    assert.doesNotMatch(source, /pce_cdb_vdc_sprite_table_put\(\);/);
    assert.match(source, /pce_sector_t start = \{0\};/);
    assert.match(source, /pce_sector_t end = \{0\};/);
  }
});
