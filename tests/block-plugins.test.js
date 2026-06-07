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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requiredBlockAssets() {
  return [
    { type: 'WAV', name: 'se_required', sourcePath: 'sfx/required.wav' },
    { type: 'SPRITE', name: 'spr_ball', sourcePath: 'sprite/ball.png', width: '1', height: '1' },
    { type: 'SPRITE', name: 'spr_paddle', sourcePath: 'sprite/paddle.png', width: '4', height: '1' },
    { type: 'SPRITE', name: 'spr_powerup_multi_ball', sourcePath: 'sprite/powerup_multi.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_powerup_strong', sourcePath: 'sprite/powerup_strong.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_powerup_speed_up', sourcePath: 'sprite/powerup_speed.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_powerup_barrier', sourcePath: 'sprite/powerup_barrier.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_block_white', sourcePath: 'sprite/block_white.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_block_yellow', sourcePath: 'sprite/block_yellow.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_block_green', sourcePath: 'sprite/block_green.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_block_blue', sourcePath: 'sprite/block_blue.png', width: '2', height: '1' },
    { type: 'SPRITE', name: 'spr_block_gray', sourcePath: 'sprite/block_gray.png', width: '2', height: '1' },
  ];
}

function requiredBlockSettings() {
  return {
    se_bindings: {
      ball_hit_paddle: 'se_required',
      ball_hit_wall: 'se_required',
      block_break: 'se_required',
      block_hit: 'se_required',
    },
    sprite_bindings: {
      ball: 'spr_ball',
      paddle: 'spr_paddle',
      powerup_multi_ball: 'spr_powerup_multi_ball',
      powerup_strong: 'spr_powerup_strong',
      powerup_speed_up: 'spr_powerup_speed_up',
      powerup_barrier: 'spr_powerup_barrier',
      block_white: 'spr_block_white',
      block_yellow: 'spr_block_yellow',
      block_green: 'spr_block_green',
      block_blue: 'spr_block_blue',
      block_gray: 'spr_block_gray',
    },
  };
}

test('block-stage-editor exposes a v2 renderer module', () => {
  const userData = makeTempDir('md-editor-block-stage-plugin-test-');
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const plugin = pluginManager.listPlugins().find((item) => item.id === 'block-stage-editor');

  assert.ok(plugin);
  assert.equal(plugin.name, 'ブロック崩しステージエディタ');
  assert.equal(plugin.hasRenderer, true);
  assert.equal(plugin.renderer.page, 'block-stage-editor');
  assert.deepEqual(plugin.renderer.capabilities, ['page', 'block-stage-editor']);
  assert.deepEqual(plugin.mainApi.hooks, [
    'listStages',
    'saveStage',
    'deleteStage',
    'moveStage',
    'exportStageData',
    'listBlockSettings',
    'saveBlockSettings',
  ]);
  assert.equal(new URL(plugin.rendererAssets.scriptUrl).protocol, 'file:');
});

test('block-stage-editor refreshes referenced asset definitions on page activation', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'block-stage-editor', 'renderer.js'), 'utf8');

  assert.match(rendererSource, /async function refresh\(\)[\s\S]*?await refreshResourcesFromResFile\(\);/);
  assert.match(rendererSource, /function observePageActivation\(\)/);
  assert.match(rendererSource, /new MutationObserver/);
  assert.match(rendererSource, /active && !state\.wasActive[\s\S]*?refreshVisibleAssetDefinitions\(\)/);
  assert.match(rendererSource, /function refreshVisibleAssetDefinitions\(\)/);
  assert.match(rendererSource, /refreshVisibleAssetDefinitions[\s\S]*?await refreshResourcesFromResFile\(\);/);
  assert.match(rendererSource, /refreshVisibleAssetDefinitions[\s\S]*?renderAssetSettings\(\);/);
  assert.match(rendererSource, /refreshVisibleAssetDefinitions[\s\S]*?updateStageThumbs\(\);/);
  assert.match(rendererSource, /observePageActivation\(\);\s*void refresh\(\);/);
});

test('block-stage-editor exposes stage reorder controls', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'block-stage-editor', 'renderer.js'), 'utf8');

  assert.match(rendererSource, /data-action="move-up"/);
  assert.match(rendererSource, /data-action="move-down"/);
  assert.match(rendererSource, /api\.plugins\.invokeHook\(plugin\.id, 'moveStage'/);
  assert.match(rendererSource, /updateMoveStageButtons/);
});

test('block-stage-editor allows up to 99 initial lives in settings UI', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'block-stage-editor', 'renderer.js'), 'utf8');

  assert.match(rendererSource, /data-setting="initial_lives"[^>]+max="99"/);
});

test('block-game-builder declares builder role and stage-editor dependency', () => {
  const userData = makeTempDir('md-editor-block-builder-plugin-test-');
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const plugin = pluginManager.listPlugins().find((item) => item.id === 'block-game-builder');

  assert.ok(plugin);
  assert.equal(plugin.name, 'ブロック崩しゲームビルダー');
  assert.deepEqual(plugin.dependencies, ['block-stage-editor']);
  assert.equal(plugin.roles.length, 1);
  assert.equal(plugin.roles[0].id, 'builder');
});

test('block-game-builder generator syncs the template and returns main source', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-builder-project-'), 'demo');
  fs.mkdirSync(projectDir, { recursive: true });

  const stagePlugin = require('../plugins/block-stage-editor');
  const assets = requiredBlockAssets();
  stagePlugin.saveBlockSettings({ settings: requiredBlockSettings() }, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  const blockBuilder = require('../plugins/block-game-builder');
  const blockBuilderManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'block-game-builder', 'manifest.json'), 'utf-8'));
  const result = blockBuilder.generateSource(assets, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  assert.equal(result.ok, true);
  assert.match(result.sourceCode, new RegExp(`Generated by block-game-builder v${escapeRegExp(blockBuilderManifest.version)}`));
  assert.match(result.sourceCode, /int main\(bool hard[_]?reset\)/i);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'block.c')), true);
  assert.equal(
    fs.readFileSync(path.join(projectDir, 'src', 'block.c'), 'utf-8'),
    fs.readFileSync(path.join(__dirname, '..', 'plugins', 'block-game-builder', 'template', 'src', 'block.c'), 'utf-8'),
  );
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'score.c')), true);
  {
    const mainSource = result.sourceCode;
    const playerSource = fs.readFileSync(path.join(projectDir, 'src', 'player.c'), 'utf-8');
    const uiSource = fs.readFileSync(path.join(projectDir, 'src', 'ui.c'), 'utf-8');
    const powerupSource = fs.readFileSync(path.join(projectDir, 'src', 'powerup.c'), 'utf-8');
    assert.doesNotMatch(mainSource, /VDP_updateSprites\(SPR_TOTAL, DMA\)/);
    assert.match(mainSource, /VDP_updateSprites\(SPR_TOTAL, DMA_QUEUE\)/);
    assert.match(playerSource, /#define PADDLE_FAST_BUTTONS \(BUTTON_A \| BUTTON_B \| BUTTON_C\)/);
    assert.match(playerSource, /\(joy1 & PADDLE_FAST_BUTTONS\) \? \(PADDLE_SPEED \* 2\) : PADDLE_SPEED/);
    assert.match(playerSource, /\(joy2 & PADDLE_FAST_BUTTONS\) \? \(PADDLE_SPEED \* 2\) : PADDLE_SPEED/);
    assert.doesNotMatch(uiSource, /VDP_updateSprites\(SPR_(?:TOTAL|TEXT_PANEL_COUNT), DMA\)/);
    assert.match(powerupSource, /barrier_draw_state != \(u8\)barrier_visible/);
  }
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'boot', 'sega.s')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'boot', 'rom_head.c')), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'game.h')), true);
  {
    const gameHeader = fs.readFileSync(path.join(projectDir, 'inc', 'game.h'), 'utf-8');
    assert.match(gameHeader, /#define PAL_SPRITES\s+PAL1/);
    assert.match(gameHeader, /#define PAL_BLOCKS\s+PAL2/);
    assert.match(gameHeader, /#define PAL_BG\s+PAL3/);
  }
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'stages.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'game_resources.h')), true);

  const stagesHeader = fs.readFileSync(path.join(projectDir, 'inc', 'stages.h'), 'utf-8');
  assert.match(stagesHeader, /#define STAGE_COUNT 1/);
  assert.match(stagesHeader, /Generated by block-stage-exporter/);
});

test('block-game-builder build start lets SGDK own the boot object', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-builder-build-start-'), 'demo');
  const romHeadPath = path.join(projectDir, 'src', 'boot', 'rom_head.c');
  fs.mkdirSync(path.dirname(romHeadPath), { recursive: true });
  fs.writeFileSync(romHeadPath, '/* project settings generated ROM header */\n"USER HEADER";\n', 'utf-8');

  const stagePlugin = require('../plugins/block-stage-editor');
  const assets = requiredBlockAssets();
  stagePlugin.saveBlockSettings({ settings: requiredBlockSettings() }, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  const blockBuilder = require('../plugins/block-game-builder');
  const result = blockBuilder.onBuildStart({ projectDir }, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(romHeadPath, 'utf-8'), '/* project settings generated ROM header */\n"USER HEADER";\n');
  assert.match(result.makeVariables.SRC_C, /src\/main\.c/);
  assert.match(result.makeVariables.SRC_C, /src\/score\.c/);
  assert.equal(Object.hasOwn(result.makeVariables, 'SRC_S'), false);
});

test('block-game-builder reports missing required block assets before build', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-builder-validation-'), 'demo');
  fs.mkdirSync(projectDir, { recursive: true });

  const blockBuilder = require('../plugins/block-game-builder');
  const result = blockBuilder.generateSource([], {
    projectDir,
    assets: [],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /必須効果音が未設定です/);
  assert.match(result.error, /必須スプライトが未設定です/);
});

test('block-game-builder rejects duplicate resource symbols before rescomp', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-builder-duplicate-symbol-'), 'demo');
  fs.mkdirSync(projectDir, { recursive: true });
  const stagePlugin = require('../plugins/block-stage-editor');
  const assets = [
    ...requiredBlockAssets(),
    { type: 'WAV', name: 'se_required', sourcePath: 'sfx/required-copy.wav' },
  ];
  stagePlugin.saveBlockSettings({ settings: requiredBlockSettings() }, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  const blockBuilder = require('../plugins/block-game-builder');
  const result = blockBuilder.generateSource(assets, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /重複したアセット名/);
  assert.match(result.error, /se_required/);
});

test('block-game-builder rejects sprite bindings with mismatched dimensions', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-builder-size-validation-'), 'demo');
  fs.mkdirSync(projectDir, { recursive: true });
  const stagePlugin = require('../plugins/block-stage-editor');
  const assets = requiredBlockAssets().map((asset) => (
    asset.name === 'spr_paddle' ? { ...asset, width: '1', height: '1' } : asset
  ));
  stagePlugin.saveBlockSettings({ settings: requiredBlockSettings() }, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  const blockBuilder = require('../plugins/block-game-builder');
  const result = blockBuilder.generateSource(assets, {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /paddle/);
  assert.match(result.error, /32x8/);
  assert.match(result.error, /8x8/);
});

test('block-stage-editor hooks create stages with incremented names and export headers', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-stage-project-'), 'demo');
  const plugin = require('../plugins/block-stage-editor');
  const context = {
    projectDir,
    assets: [
      { type: 'IMAGE', name: 'image001', sourcePath: 'gfx/image001.png', sourceAbsolutePath: path.join(projectDir, 'res', 'gfx', 'image001.png') },
      { type: 'WAV', name: 'se_block_hit', sourcePath: 'sfx/block-hit.wav', sourceAbsolutePath: path.join(projectDir, 'res', 'sfx', 'block-hit.wav') },
      { type: 'WAV', name: 'bgm', sourcePath: 'bgm/bgm.wav', sourceAbsolutePath: path.join(projectDir, 'res', 'bgm', 'bgm.wav') },
      { type: 'WAV', name: 'bgm_stage2', sourcePath: 'bgm/bgm-stage2.wav', sourceAbsolutePath: path.join(projectDir, 'res', 'bgm', 'bgm-stage2.wav') },
    ],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const first = plugin.saveStage({ create: true, stage: {} }, context);
  const second = plugin.saveStage({ create: true, stage: {} }, context);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.stage.name, 'Stage 1');
  assert.equal(second.stage.name, 'Stage 2');

  const savedFirst = plugin.saveStage({ stage: { ...first.stage, bgm_symbol: 'bgm' } }, context);
  assert.equal(savedFirst.ok, true);

  const updated = {
    ...second.stage,
    background_image_symbol: 'image001',
    clear_image_symbol: 'image001',
    bgm_symbol: 'bgm_stage2',
    blocks: Array.from({ length: 24 }, (_, row) => Array.from({ length: 15 }, (_, col) => (row === 3 && col === 4 ? 2 : 0))),
    power_ups: { '3,4': 'multi_ball' },
  };
  const saved = plugin.saveStage({ stage: updated }, context);
  assert.equal(saved.ok, true);

  const listed = plugin.listStages({}, context);
  assert.equal(listed.ok, true);
  assert.equal(listed.stages.length, 2);
  assert.equal(listed.resources.images[0].name, 'image001');
  assert.deepEqual(listed.resources.bgms.map((entry) => entry.name), ['bgm', 'bgm_stage2']);

  const stagesHeader = fs.readFileSync(path.join(projectDir, 'inc', 'stages.h'), 'utf-8');
  assert.match(stagesHeader, /#define STAGE_COUNT 2/);
  assert.match(stagesHeader, /POWERUP_MULTI_BALL/);
  assert.match(stagesHeader, /\{ stage_2_blocks, stage_2_powerups, bgm_stage2, sizeof\(bgm_stage2\), FALSE, &image001, &image001 \}/);

  const gameResources = fs.readFileSync(path.join(projectDir, 'inc', 'game_resources.h'), 'utf-8');
  assert.doesNotMatch(gameResources, /RES_IMG_STAGE_BACKGROUND/);
  assert.match(gameResources, /#define RES_BGM_0 bgm/);
  assert.match(gameResources, /#define RES_BGM_1 bgm_stage2/);
  assert.doesNotMatch(gameResources, /RES_BGM_\d+ se_block_hit/);
  assert.match(gameResources, /#define BGM_IS_PCM 1/);
});

test('block-stage-editor saves game-wide asset bindings and parameters', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-settings-'), 'demo');
  const plugin = require('../plugins/block-stage-editor');
  const context = {
    projectDir,
    assets: [
      { type: 'SPRITE', name: 'spr_ball', sourcePath: 'sprite/ball.png' },
      { type: 'WAV', name: 'se_block_break', sourcePath: 'sfx/block.wav' },
      { type: 'WAV', name: 'se_bonus_count', sourcePath: 'sfx/bonus.wav' },
      { type: 'IMAGE', name: 'img_title_screen', sourcePath: 'gfx/title.png' },
      { type: 'IMAGE', name: 'img_game_clear', sourcePath: 'gfx/game-clear.png' },
      { type: 'WAV', name: 'bgm_title', sourcePath: 'bgm/title.wav' },
      { type: 'WAV', name: 'bgm_clear', sourcePath: 'bgm/clear.wav' },
      { type: 'TILESET', name: 'font_system', sourcePath: 'font/system.png' },
      { type: 'PALETTE', name: 'font_system_palette', sourcePath: 'font/system.png' },
    ],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const saved = plugin.saveBlockSettings({
    settings: {
      se_bindings: { block_break: 'se_block_break', bonus_count: 'se_bonus_count' },
      sprite_bindings: { ball: 'spr_ball' },
      image_usage_bindings: { title_screen: 'img_title_screen', game_clear_screen: 'img_game_clear' },
      game_settings: {
        ball_speed: 5,
        paddle_speed: 4,
        initial_lives: 99,
        bgm_volume: 35,
        system_font_symbol: 'font_system',
        screen_wait_seconds: {
          title_screen: 7,
          game_clear_screen: 3,
        },
        screen_bgm_symbols: {
          title_screen: 'bgm_title',
          game_clear_screen: 'bgm_clear',
        },
      },
    },
  }, context);

  assert.equal(saved.ok, true);
  assert.equal(saved.settings.game_settings.ball_speed, 5);

  const listed = plugin.listBlockSettings({}, context);
  assert.equal(listed.ok, true);
  assert.equal(listed.settings.se_bindings.block_break, 'se_block_break');
  assert.equal(listed.settings.sprite_bindings.ball, 'spr_ball');
  assert.equal(listed.settings.image_usage_bindings.title_screen, 'img_title_screen');
  assert.equal(listed.settings.image_usage_bindings.game_clear_screen, 'img_game_clear');
  assert.equal(listed.settings.game_settings.system_font_symbol, 'font_system');
  assert.equal(listed.settings.game_settings.screen_wait_seconds.title_screen, 7);
  assert.equal(listed.settings.game_settings.screen_wait_seconds.game_clear_screen, 3);
  assert.equal(listed.settings.game_settings.screen_bgm_symbols.title_screen, 'bgm_title');
  assert.equal(listed.settings.game_settings.screen_bgm_symbols.game_clear_screen, 'bgm_clear');
  assert.equal(listed.resources.tilesets[0].name, 'font_system');

  const gameResources = fs.readFileSync(path.join(projectDir, 'inc', 'game_resources.h'), 'utf-8');
  assert.match(gameResources, /#define RES_SPR_BALL spr_ball/);
  assert.match(gameResources, /#define RES_SE_BLOCK_BREAK se_block_break/);
  assert.match(gameResources, /#define RES_SE_BONUS_COUNT se_bonus_count/);
  assert.match(gameResources, /#define RES_IMG_TITLE_SCREEN img_title_screen/);
  assert.match(gameResources, /#define RES_IMG_GAME_CLEAR_SCREEN img_game_clear/);
  assert.match(gameResources, /#define RES_SYSTEM_FONT font_system/);
  assert.match(gameResources, /#define RES_SYSTEM_FONT_PALETTE font_system_palette/);
  assert.match(gameResources, /#define BALL_BASE_SPEED FIX16\(5\)/);
  assert.match(gameResources, /#define PADDLE_SPEED FIX16\(4\)/);
  assert.match(gameResources, /#define INITIAL_LIVES 99/);
  assert.match(gameResources, /#define BGM_VOLUME 35/);
  assert.match(gameResources, /#define RES_BGM_TITLE_SCREEN bgm_title/);
  assert.match(gameResources, /#define RES_BGM_TITLE_SCREEN_HALF_RATE FALSE/);
  assert.match(gameResources, /#define RES_BGM_GAME_CLEAR_SCREEN bgm_clear/);
  assert.match(gameResources, /#define RES_BGM_GAME_CLEAR_SCREEN_HALF_RATE FALSE/);
  assert.match(gameResources, /#define SCREEN_WAIT_TITLE_SCREEN_SECONDS 7/);
  assert.match(gameResources, /#define SCREEN_WAIT_GAME_CLEAR_SCREEN_SECONDS 3/);
});

test('block-stage-editor exports PCM BGM half-rate per selected WAV rate', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-stage-bgm-rate-'), 'demo');
  const plugin = require('../plugins/block-stage-editor');
  const context = {
    projectDir,
    assets: [
      { type: 'WAV', name: 'bgm_half', sourcePath: 'bgm/half.wav', outRate: '6650' },
      { type: 'WAV', name: 'bgm_full', sourcePath: 'bgm/full.wav', outRate: '13300' },
    ],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const first = plugin.saveStage({ create: true, stage: { bgm_symbol: 'bgm_half' } }, context);
  const second = plugin.saveStage({ create: true, stage: { bgm_symbol: 'bgm_full' } }, context);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const stagesHeader = fs.readFileSync(path.join(projectDir, 'inc', 'stages.h'), 'utf-8');
  assert.match(stagesHeader, /\{ stage_1_blocks, stage_1_powerups, bgm_half, sizeof\(bgm_half\), TRUE, NULL, NULL \}/);
  assert.match(stagesHeader, /\{ stage_2_blocks, stage_2_powerups, bgm_full, sizeof\(bgm_full\), FALSE, NULL, NULL \}/);
});

test('block-game-builder rejects mixed PCM and XGM2 BGM selections', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-builder-mixed-bgm-'), 'demo');
  fs.mkdirSync(projectDir, { recursive: true });
  const stagePlugin = require('../plugins/block-stage-editor');
  const assets = [
    ...requiredBlockAssets(),
    { type: 'WAV', name: 'bgm_pcm', sourcePath: 'bgm/pcm.wav', outRate: '6650' },
    { type: 'XGM2', name: 'bgm_music', sourcePath: 'bgm/music.vgm' },
  ];
  const context = {
    projectDir,
    assets,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  stagePlugin.saveBlockSettings({ settings: requiredBlockSettings() }, context);
  stagePlugin.saveStage({ create: true, stage: { bgm_symbol: 'bgm_pcm' } }, context);
  stagePlugin.saveStage({ create: true, stage: { bgm_symbol: 'bgm_music' } }, context);

  const blockBuilder = require('../plugins/block-game-builder');
  const result = blockBuilder.generateSource(assets, context);

  assert.equal(result.ok, false);
  assert.match(result.error, /BGM に WAV\(PCM\) と XGM\/XGM2 が混在/);
});

test('block-stage-editor delete hook removes a stage and compacts order', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-stage-delete-'), 'demo');
  const plugin = require('../plugins/block-stage-editor');
  const context = {
    projectDir,
    assets: [],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const first = plugin.saveStage({ create: true, stage: {} }, context);
  const second = plugin.saveStage({ create: true, stage: {} }, context);
  const deleted = plugin.deleteStage({ id: first.stage.id }, context);
  const listed = plugin.listStages({}, context);

  assert.equal(deleted.ok, true);
  assert.equal(listed.stages.length, 1);
  assert.equal(listed.stages[0].id, second.stage.id);
  assert.equal(listed.stages[0].order, 1);
});

test('block-stage-editor move hook reorders stages and regenerates headers', () => {
  const projectDir = path.join(makeTempDir('md-editor-block-stage-move-'), 'demo');
  const plugin = require('../plugins/block-stage-editor');
  const context = {
    projectDir,
    assets: [],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const first = plugin.saveStage({ create: true, stage: { name: 'First' } }, context);
  const second = plugin.saveStage({ create: true, stage: { name: 'Second' } }, context);
  const third = plugin.saveStage({ create: true, stage: { name: 'Third' } }, context);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);

  const moved = plugin.moveStage({ id: third.stage.id, direction: 'up' }, context);
  assert.equal(moved.ok, true);
  assert.equal(moved.moved, true);
  assert.equal(moved.stage.order, 2);

  const listed = plugin.listStages({}, context);
  assert.deepEqual(listed.stages.map((stage) => stage.name), ['First', 'Third', 'Second']);
  assert.deepEqual(listed.stages.map((stage) => stage.order), [1, 2, 3]);

  const stagesHeader = fs.readFileSync(path.join(projectDir, 'inc', 'stages.h'), 'utf-8');
  assert.match(stagesHeader, /Stage 2: Third/);
  assert.match(stagesHeader, /Stage 3: Second/);
});
