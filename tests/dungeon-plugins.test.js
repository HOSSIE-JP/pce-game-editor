'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readIndexedPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 3);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width + 1);
    assert.equal(raw[rowStart], 0);
    pixels.set(raw.subarray(rowStart + 1, rowStart + 1 + width), y * width);
  }
  return { width, height, pixels };
}

function countNonTransparent(image, x0, y0, width, height) {
  let count = 0;
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      if (image.pixels[(y * image.width) + x] !== 0) count++;
    }
  }
  return count;
}

test('dungeon plugins declare MD editor and builder capabilities', () => {
  const userData = makeTempDir('md-editor-dungeon-plugin-list-');
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const editor = pluginManager.listPlugins().find((item) => item.id === 'dungeon-game-editor');
  const builder = pluginManager.listPlugins().find((item) => item.id === 'dungeon-game-builder');

  assert.ok(editor);
  assert.equal(editor.name, 'ダンジョンゲームエディター');
  assert.deepEqual(editor.supportedCores, ['mega-drive']);
  assert.equal(editor.hasRenderer, true);
  assert.equal(editor.renderer.page, 'dungeon-game-editor');
  assert.deepEqual(editor.renderer.capabilities, ['page', 'dungeon-game-editor']);
  assert.deepEqual(editor.mainApi.hooks, [
    'listDungeonFloors',
    'saveDungeonFloor',
    'deleteDungeonFloor',
    'moveDungeonFloor',
    'generateDungeonFloor',
    'exportDungeonData',
    'listDungeonSettings',
    'saveDungeonSettings',
  ]);

  assert.ok(builder);
  assert.equal(builder.name, 'ダンジョンゲームビルダー');
  assert.deepEqual(builder.supportedCores, ['mega-drive']);
  assert.deepEqual(builder.dependencies, ['dungeon-game-editor']);
  assert.equal(builder.roles.length, 1);
  assert.equal(builder.roles[0].id, 'builder');
});

test('dungeon-game-editor generates bounded thin-wall floors and exports SGDK data', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-editor-'), 'demo');
  const plugin = require('../plugins/dungeon-game-editor');
  const context = { projectDir, logger: logger() };

  const generated = plugin.generateDungeonFloor({ width: 20, height: 18, name: 'Labyrinth' }, context);
  assert.equal(generated.ok, true);
  assert.equal(generated.floor.width, 20);
  assert.equal(generated.floor.height, 18);
  assert.equal(generated.floor.cells.length, 18);
  assert.equal(generated.floor.cells[0].length, 20);
  assert.equal(generated.floor.cells[generated.floor.start.y][generated.floor.start.x].stairs, 'up');

  const cells = generated.floor.cells.flat();
  assert.ok(cells.some((cell) => cell.doors !== 0));
  assert.ok(cells.some((cell) => cell.event === 'chest'));
  assert.ok(cells.some((cell) => cell.stairs === 'down'));
  assert.ok(cells.some((cell) => cell.walls !== 15));

  const listed = plugin.listDungeonFloors({}, context);
  assert.equal(listed.ok, true);
  assert.equal(listed.maxSize, 20);
  assert.equal(listed.floors.length, 1);

  const exported = plugin.exportDungeonData({}, context);
  assert.equal(exported.ok, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_data.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_data.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_patterns.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_patterns.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_tileset.png')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_map.png')), true);

  const header = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_data.h'), 'utf-8');
  assert.match(header, /#define DUNGEON_FLOOR_COUNT 1/);
  const source = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_data.c'), 'utf-8');
  assert.match(source, /const DungeonFloorData dungeon_floors/);
  assert.match(source, /dungeon_floor_1_edges/);
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'dungeon-service.js'), 'utf-8');
  const patternHeader = fs.readFileSync(path.join(projectDir, 'inc', 'dungeon_patterns.h'), 'utf-8');
  const patternSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_patterns.c'), 'utf-8');
  const resources = fs.readFileSync(path.join(projectDir, 'res', 'resources.res'), 'utf-8');
  const tilesetPng = fs.readFileSync(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_tileset.png'));
  const plteOffset = tilesetPng.indexOf(Buffer.from('PLTE'));
  const patternMap = readIndexedPng(path.join(projectDir, 'res', 'dungeon', 'generated', 'dungeon_view_map.png'));
  const frontPattern = (4 * 5);
  const frontX = (frontPattern % 8) * 200;
  const frontY = Math.floor(frontPattern / 8) * 128;
  const deadEndPattern = (7 * 5);
  const deadEndX = (deadEndPattern % 8) * 200;
  const deadEndY = Math.floor(deadEndPattern / 8) * 128;
  assert.match(patternHeader, /#define DUN_WALL_VIEW_COUNT 64/);
  assert.match(patternHeader, /#define DUN_WALL_PHASE_COUNT 5/);
  assert.match(patternHeader, /#define DUN_VIEW_PATTERN_COLUMNS 8/);
  assert.match(patternHeader, /#define DUN_ANIMATION_STEP_VBLANKS 4/);
  assert.match(patternHeader, /extern const u16 dungeon_view_pattern_count/);
  assert.doesNotMatch(patternHeader, /extern const u32 dungeon_pattern_tiles/);
  assert.match(patternSource, /const u16 dungeon_view_pattern_count/);
  assert.doesNotMatch(patternSource, /const u32 dungeon_pattern_tiles/);
  assert.doesNotMatch(patternSource, /const u16 dungeon_view_maps/);
  assert.match(serviceSource, /PATTERN_TRANSPARENT_COLOR/);
  assert.match(serviceSource, /buildPatternPalette/);
  assert.match(serviceSource, /renderPatternPixels/);
  assert.match(serviceSource, /rasterPatternTriangle/);
  assert.match(serviceSource, /VIEW_CAMERA_BACKSTEP/);
  assert.ok(plteOffset > 0);
  assert.deepEqual(Array.from(tilesetPng.subarray(plteOffset + 4, plteOffset + 7)), [255, 0, 255]);
  assert.ok(countNonTransparent(patternMap, frontX + 0, frontY + 30, 48, 68) > 40);
  assert.ok(countNonTransparent(patternMap, frontX + 152, frontY + 30, 48, 68) > 40);
  assert.ok(countNonTransparent(patternMap, deadEndX + 0, deadEndY + 30, 48, 68) > 80);
  assert.ok(countNonTransparent(patternMap, deadEndX + 152, deadEndY + 30, 48, 68) > 80);
  assert.ok(countNonTransparent(patternMap, deadEndX + 72, deadEndY + 36, 56, 56) > 300);
  assert.match(resources, /PALETTE dungeon_view_palette "dungeon\/generated\/dungeon_view_tileset\.png"/);
  assert.match(resources, /TILESET dungeon_view_tileset "dungeon\/generated\/dungeon_view_tileset\.png" NONE ALL/);
  assert.match(resources, /TILEMAP dungeon_view_tilemap "dungeon\/generated\/dungeon_view_map\.png" dungeon_view_tileset NONE ALL 0/);
  const tileCount = Number(patternHeader.match(/#define DUN_PATTERN_TILE_COUNT (\d+)/)?.[1] || 0);
  assert.ok(tileCount > 12);
});

test('dungeon-game-builder syncs engine, writes generated main, and build variables', () => {
  const projectDir = path.join(makeTempDir('md-editor-dungeon-builder-'), 'demo');
  const builder = require('../plugins/dungeon-game-builder');
  const manifest = require('../plugins/dungeon-game-builder/manifest.json');
  const context = { projectDir, assets: [], logger: logger() };

  const generated = builder.generateSource([], context);
  assert.equal(generated.ok, true);
  assert.match(generated.sourceCode, new RegExp(`Generated by dungeon-game-builder v${escapeRegExp(manifest.version)}`));
  assert.match(generated.sourceCode, /int main\(bool hardReset\)/);
  assert.match(generated.sourceCode, /hasWallAt/);
  assert.match(generated.sourceCode, /DUN_USE_TEXT_HUD 1/);
  assert.match(generated.sourceCode, /pressedAction/);
  assert.match(generated.sourceCode, /actionUsesWallAnimation/);
  assert.match(generated.sourceCode, /turnTargetDir/);
  assert.match(generated.sourceCode, /DUN_ACTION_TURN_L/);
  assert.match(generated.sourceCode, /canMove\(floor, player_x, player_y, player_dir\)/);
  assert.doesNotMatch(generated.sourceCode, /KDebug_Alert/);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_view.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_data.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'boot', 'sega.s')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_game.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_view.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'dungeon_patterns.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'dungeon_patterns.c')), true);

  const viewSource = fs.readFileSync(path.join(projectDir, 'src', 'dungeon_view.c'), 'utf-8');
  assert.match(viewSource, /DUN_VIEW_TILE_W/);
  assert.match(viewSource, /#include "resources\.h"/);
  assert.match(viewSource, /DUN_TILE_CACHE_SIZE/);
  assert.match(viewSource, /VDP_loadTileData/);
  assert.match(viewSource, /VDP_setTileMapXY/);
  assert.match(viewSource, /dungeon_view_tilemap\.tilemap/);
  assert.match(viewSource, /hasWallOrDoorAt/);
  assert.match(viewSource, /animationPhase/);
  assert.match(viewSource, /DBG F:%u X:%02u Y:%02u DIR:%c\(%u\)/);
  assert.doesNotMatch(viewSource, /VDP_loadTileSet\(&dungeon_view_tileset/);
  assert.doesNotMatch(viewSource, /VDP_setTileMapEx/);
  assert.doesNotMatch(viewSource, /VDP_loadTileData\(dungeon_pattern_tiles/);
  assert.doesNotMatch(viewSource, /MAP_create/);
  assert.doesNotMatch(viewSource, /dungeon_view_maps/);
  assert.doesNotMatch(viewSource, /loadDungeonTiles/);

  const buildStart = builder.onBuildStart({ projectDir }, context);
  assert.equal(buildStart.ok, true);
  assert.match(buildStart.makeVariables.SRC_C, /src\/main\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/dungeon_view\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/dungeon_data\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/dungeon_patterns\.c/);
  assert.equal(Object.hasOwn(buildStart.makeVariables, 'SRC_S'), false);
});

test('dungeon-game-editor renderer provides map tools, 3D preview, and activation refresh', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'renderer.js'), 'utf-8');
  const styleSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'dungeon-game-editor', 'style.css'), 'utf-8');

  assert.match(rendererSource, /3Dプレビュー/);
  assert.match(rendererSource, /data-tool="?\$\{tool\.id\}/);
  assert.match(rendererSource, /generateDungeonFloor/);
  assert.match(rendererSource, /drawPreviewGeometry/);
  assert.match(rendererSource, /VIEW_PROJECT_X/);
  assert.match(rendererSource, /const VIEW_PROJECT_X = VIEW_PROJECT_Y/);
  assert.match(rendererSource, /const VIEW_EYE_Z = 0\.42/);
  assert.match(rendererSource, /VIEW_CAMERA_BACKSTEP/);
  assert.match(rendererSource, /VIEW_DEPTH_EPSILON/);
  assert.match(rendererSource, /WALL_SEGMENT_OVERLAP/);
  assert.match(rendererSource, /PREVIEW_TRANSPARENT_KEY/);
  assert.match(rendererSource, /drawPreviewWallModel/);
  assert.match(rendererSource, /drawWallRuns/);
  assert.match(rendererSource, /drawWallRun3D/);
  assert.match(rendererSource, /edgeKindAtGrid/);
  assert.match(rendererSource, /clipCameraPolygon/);
  assert.match(rendererSource, /rasterTriangle/);
  assert.match(rendererSource, /previewCameraPose/);
  assert.match(rendererSource, /zBuffer = new Float32Array\(VIEW_W \* VIEW_H\)/);
  assert.match(rendererSource, /renderPreviewMinimap/);
  assert.match(rendererSource, /drawPreviewMinimap/);
  assert.match(rendererSource, /readFileAsDataUrl/);
  assert.match(rendererSource, /cropAtlasTexture/);
  assert.match(rendererSource, /exportDungeonData/);
  assert.match(rendererSource, /SGDKアセット生成/);
  assert.match(rendererSource, /requestAnimationFrame/);
  assert.match(rendererSource, /MutationObserver/);
  assert.match(rendererSource, /registerCapability\('dungeon-game-editor'/);
  assert.match(rendererSource, /ArrowUp/);
  assert.match(rendererSource, /wall_texture/);
  assert.match(styleSource, /\.dge-view/);
  assert.match(styleSource, /\.dge-minimap/);
  assert.match(styleSource, /\.dge-panel\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(styleSource, /\.dge-shell\s*\{[\s\S]*min-width:\s*840px/);
  assert.match(styleSource, /image-rendering:\s*pixelated/);
});

test('dungeon template starts with valid settings and plugin roles', () => {
  const templateDir = path.join(__dirname, '..', 'template', 'template_dungeon_game');
  const config = JSON.parse(fs.readFileSync(path.join(templateDir, 'project.json'), 'utf-8'));
  assert.equal(config.coreId, 'mega-drive');
  assert.equal(config.title, 'DUNGEON TEST');
  assert.equal(config.author, 'HOSSIE');
  assert.equal(config.serial, 'GM 00000000-02');
  assert.deepEqual(config.pluginRoles, {
    builder: 'dungeon-game-builder',
    testplay: 'standard-emulator',
  });
  assert.equal(fs.existsSync(path.join(templateDir, 'data', 'dungeon', 'floors', 'floor_001_template.json')), true);
  assert.equal(fs.existsSync(path.join(templateDir, 'res', 'dungeon', 'textures', 'dungeon_texture_atlas.png')), true);
});
