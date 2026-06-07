'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function importTilemapCore() {
  return import(pathToFileURL(path.join(__dirname, '..', 'plugins', 'tilemap-editor', 'tilemap-core.mjs')).href);
}

test('tilemap-editor writes Tiled-compatible TMX and TSX subset', async () => {
  const core = await importTilemapCore();
  const map = core.createBlankTilemap({
    name: 'stage_1',
    tilesetName: 'stage_tiles',
    width: 4,
    height: 3,
    tileWidth: 8,
    tileHeight: 8,
    layerName: 'Ground',
  });
  map.tilesetImage = 'stage_tiles.png';
  map.tilesetImageWidth = 32;
  map.tilesetImageHeight = 16;
  map.tilesetColumns = 4;
  map.tilesetTileCount = 8;
  map.layers[0].data = [
    1, 2, 0, 0,
    3, 4, 0, 0,
    0, 0, 5, 6,
  ];
  map.layers.push({
    name: 'Ground priority',
    visible: false,
    opacity: 1,
    priority: true,
    collision: false,
    data: [
      0, 0, 0, 0,
      1, 1, 0, 0,
      0, 0, 1, 1,
    ],
  });
  map.layers.push({
    name: 'Collision',
    visible: true,
    opacity: 1,
    priority: false,
    collision: true,
    data: [
      0, 1, 0, 0,
      2, 0, 0, 0,
      0, 0, 3, 4,
    ],
  });

  const tmx = core.buildTmx(map);
  const tsx = core.buildTsx(map);

  assert.match(tmx, /<map[^>]+orientation="orthogonal"[^>]+width="4"[^>]+height="3"[^>]+infinite="0"/);
  assert.match(tmx, /<tileset firstgid="1" source="\.\.\/tilesets\/stage_tiles\.tsx"\/>/);
  assert.match(tmx, /<layer id="1" name="Ground" width="4" height="3">/);
  assert.match(tmx, /<data encoding="csv">/);
  assert.match(tmx, /<layer id="2" name="Ground priority" width="4" height="3" visible="0"/);
  assert.match(tmx, /<layer id="3" name="Collision" width="4" height="3" visible="0"/);
  assert.match(tsx, /<tileset[^>]+name="stage_tiles"[^>]+tilewidth="8"[^>]+tileheight="8"[^>]+tilecount="8"[^>]+columns="4"/);
  assert.match(tsx, /<image source="stage_tiles\.png" width="32" height="16"\/>/);
});

test('tilemap-editor parses its generated TMX and TSX subset', async () => {
  const core = await importTilemapCore();
  const map = core.createBlankTilemap({ name: 'stage_2', tilesetName: 'stage_tiles', width: 2, height: 2 });
  map.layers[0].name = 'Main';
  map.layers[0].data = [1, 0, 2, 3];

  const parsed = core.parseTmx(core.buildTmx(map));
  const tsx = core.parseTsx(core.buildTsx({
    ...map,
    tilesetImage: 'stage_tiles.png',
    tilesetColumns: 2,
    tilesetTileCount: 4,
    tilesetImageWidth: 16,
    tilesetImageHeight: 16,
  }));

  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 2);
  assert.equal(parsed.tileWidth, 8);
  assert.equal(parsed.tilesetSource, '../tilesets/stage_tiles.tsx');
  assert.deepEqual(parsed.tilesets, [{ firstgid: 1, source: '../tilesets/stage_tiles.tsx', name: 'stage_tiles' }]);
  assert.equal(parsed.layers[0].name, 'Main');
  assert.deepEqual(parsed.layers[0].data, [1, 0, 2, 3]);
  assert.equal(tsx.tilesetName, 'stage_tiles');
  assert.equal(tsx.tilesetImage, 'stage_tiles.png');
  assert.equal(tsx.tilesetColumns, 2);
});

test('tilemap-editor preserves collision layers and generates collision C helpers', async () => {
  const core = await importTilemapCore();
  const map = core.createBlankTilemap({ name: 'stage_collision', width: 3, height: 2 });
  map.layers.push({
    name: 'Collision',
    visible: true,
    opacity: 1,
    priority: false,
    collision: true,
    data: [0, 1, 2, 3, 4, 0],
  });

  const parsed = core.parseTmx(core.buildTmx(map));
  const collisionMaps = core.extractCollisionMaps(parsed, 'stage_collision');
  const header = core.buildCollisionHeader(collisionMaps);
  const source = core.buildCollisionSource(collisionMaps);

  assert.equal(parsed.layers[1].name, 'Collision');
  assert.equal(parsed.layers[1].collision, true);
  assert.equal(parsed.layers[1].visible, true);
  assert.deepEqual(parsed.layers[1].data, [0, 1, 2, 3, 4, 0]);
  assert.deepEqual(core.repeatedBrushGid({ x: 1, y: 0, w: 2, h: 2 }, 8, 17, 2, 1), 26);
  assert.match(header, /extern const TilemapCollisionMap tilemap_collision_stage_collision;/);
  assert.match(source, /static const u8 tilemap_collision_stage_collision_data\[\] = \{\s*0, 1, 2, 3, 4, 0\s*\};/);
  assert.match(source, /u8 tilemap_collision_at\(const TilemapCollisionMap\* map, s16 tileX, s16 tileY\)/);
});

test('tilemap-editor preserves multiple TMX tileset references', async () => {
  const core = await importTilemapCore();
  const map = core.createBlankTilemap({ name: 'stage_multi', tilesetName: 'stage_a', width: 2, height: 2 });
  map.tilesets = [
    { firstgid: 1, source: '../tilesets/stage_a.tsx' },
    { firstgid: 17, source: '../tilesets/stage_b.tsx' },
  ];
  map.layers[0].data = [1, 17, 18, 0];

  const tmx = core.buildTmx(map);
  const parsed = core.parseTmx(tmx);

  assert.match(tmx, /<tileset firstgid="1" source="\.\.\/tilesets\/stage_a\.tsx"\/>/);
  assert.match(tmx, /<tileset firstgid="17" source="\.\.\/tilesets\/stage_b\.tsx"\/>/);
  assert.deepEqual(parsed.tilesets.map((tileset) => [tileset.firstgid, tileset.source]), [
    [1, '../tilesets/stage_a.tsx'],
    [17, '../tilesets/stage_b.tsx'],
  ]);
  assert.deepEqual(parsed.layers[0].data, [1, 17, 18, 0]);
});

test('tilemap-editor normalizes res-root TSX paths for TMX files under maps', async () => {
  const core = await importTilemapCore();
  const map = core.createBlankTilemap({ name: 'stage_paths', tilesetName: 'stage_a', width: 1, height: 1 });
  map.tilesets = [
    { firstgid: 1, source: 'tilesets/stage_a.tsx' },
    { firstgid: 17, source: 'res/tilesets/stage_b.tsx' },
  ];

  const tmx = core.buildTmx(map);

  assert.match(tmx, /<tileset firstgid="1" source="\.\.\/tilesets\/stage_a\.tsx"\/>/);
  assert.match(tmx, /<tileset firstgid="17" source="\.\.\/tilesets\/stage_b\.tsx"\/>/);
  assert.doesNotMatch(tmx, /source="tilesets\//);
});

test('tilemap-editor can save a map after unresolved tileset refs are pruned', async () => {
  const core = await importTilemapCore();
  const map = core.createBlankTilemap({ name: 'stage_pruned', width: 1, height: 1 });
  map.tilesets = [];
  map.tilesetSource = '';
  map.tilesetName = '';

  const tmx = core.buildTmx(map);

  assert.doesNotMatch(tmx, /<tileset /);
  assert.match(tmx, /<layer id="1" name="Ground" width="1" height="1">/);
});

test('tilemap-editor renderer exposes resource-driven layout and wheel zoom', () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'tilemap-editor');
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf-8'));
  const rendererSource = fs.readFileSync(path.join(pluginDir, 'renderer.js'), 'utf-8');
  const styleSource = fs.readFileSync(path.join(pluginDir, 'style.css'), 'utf-8');

  assert.deepEqual(manifest.types, ['editor', 'asset']);
  assert.equal(manifest.renderer.entry, 'renderer.js');
  assert.ok(manifest.renderer.capabilities.includes('tilemap-editor'));
  assert.match(rendererSource, /registerCapability\(['"]tilemap-editor['"]/);
  assert.match(rendererSource, /buildTmx/);
  assert.match(rendererSource, /buildTsx/);
  assert.match(rendererSource, /addEventListener\(['"]wheel['"],\s*\(event\)\s*=>\s*handleWheelZoom\(event\)/);
  assert.match(rendererSource, /addEventListener\(['"]wheel['"],\s*\(event\)\s*=>\s*handlePaletteWheelZoom\(event\)/);
  assert.match(rendererSource, /function wheelZoomValue\(current, deltaY\)/);
  assert.doesNotMatch(rendererSource, /Math\.round\(oldZoom \* factor \* 4\)/);
  assert.match(rendererSource, /data-ui="assetTree"/);
  assert.match(rendererSource, /data-ui="tilesetTree"/);
  assert.match(rendererSource, /data-ui="paletteTopResizer"/);
  assert.match(rendererSource, /data-ui="rightPanelResizer"/);
  assert.match(rendererSource, /data-ui="leftColumnResizer"/);
  assert.match(rendererSource, /data-ui="rightColumnResizer"/);
  assert.match(rendererSource, /function resizeColumns\(event\)/);
  assert.match(rendererSource, /data-ui="inactiveOpacity"/);
  assert.match(rendererSource, /state\.inactiveLayerOpacity/);
  assert.match(rendererSource, /<span class="tilemap-accordion-title">Layers<\/span>[\s\S]*レイヤ透明度[\s\S]*data-ui="inactiveOpacity"/);
  assert.doesNotMatch(rendererSource, /data-ui="collisionToggle"/);
  assert.doesNotMatch(rendererSource, /showCollision/);
  assert.match(rendererSource, /data-toggle-right-section="tiles"/);
  assert.match(rendererSource, /data-toggle-right-section="palette"/);
  assert.match(rendererSource, /data-toggle-right-section="layers"/);
  assert.match(rendererSource, /class="tilemap-accordion-header"[\s\S]*<svg class="icon tilemap-accordion-chevron"/);
  assert.match(rendererSource, /function syncRightAccordion\(\)/);
  assert.match(rendererSource, /data-action="add-collision-layer"/);
  assert.match(rendererSource, /data-ui="collisionPalette"/);
  assert.match(rendererSource, /toolButton\('select', '矩形範囲選択', 'icon-selection'\)/);
  assert.match(rendererSource, /function beginSelection\(cell\)/);
  assert.match(rendererSource, /function commitSelectionMove\(drag\)/);
  assert.match(rendererSource, /function clearSelection\(\)/);
  assert.match(rendererSource, /function addCollisionLayer\(\)/);
  assert.match(rendererSource, /function ensureCollisionLayerSelected\(\)/);
  assert.match(rendererSource, /function fillPatternRect\(layer, startCell, endCell\)/);
  assert.match(rendererSource, /repeatedBrushGid\(state\.selectedBrush, columns, firstgid, x - minX, y - minY\)/);
  assert.match(rendererSource, /function writeCollisionSourceFiles\(\)/);
  assert.match(rendererSource, /buildCollisionHeader\(maps\)/);
  assert.match(rendererSource, /buildCollisionSource\(maps\)/);
  assert.match(rendererSource, /function drawCollisionLayer\(ctx, layer, scale, selectedLayer\)/);
  assert.match(rendererSource, /Priority Preview/);
  assert.match(rendererSource, /function resizeRightPanels\(nextHeight\)/);
  assert.match(rendererSource, /function resizeTilesetBrowser\(nextHeight\)/);
  assert.match(rendererSource, /function scheduleInitialRightPanelHeights\(\)/);
  assert.match(rendererSource, /function defaultRightPanelHeight\(\)/);
  assert.match(rendererSource, /rightPanelResizeManual/);
  assert.match(rendererSource, /function hasSelectedMap\(\)/);
  assert.match(rendererSource, /function messageModal\(\{ title, message \}\)/);
  assert.match(rendererSource, /function requestMapAddInfo\(\{ resFiles, defaultFile, defaultSymbol \}\)/);
  assert.match(rendererSource, /TILESET が必要です/);
  assert.match(rendererSource, /先に右列の \+ から TILESET を登録してください。/);
  assert.match(rendererSource, /types: MAP_TYPES/);
  assert.match(rendererSource, /function renderMapResourceTree\(/);
  assert.match(rendererSource, /function groupMapEntries\(entries\)/);
  assert.match(rendererSource, /function mapResourceGroupHtml\(file, group, selectedKey, itemAttr\)/);
  assert.match(rendererSource, /tilemap-resource-children/);
  assert.match(rendererSource, /MAP \/ TILEMAP 定義がありません/);
  assert.match(rendererSource, /uniqueSymbol\('map001', MAP_TYPES\)/);
  assert.match(rendererSource, /MAP\/TILEMAP を追加/);
  assert.match(rendererSource, /<option value="TILEMAP">TILEMAP<\/option>/);
  assert.match(rendererSource, /function syncMapLayerResources\(item, activeLayerName = ''\)/);
  assert.match(rendererSource, /function ensureStableTilesetIndexingForMap\(\)/);
  assert.match(rendererSource, /opt: 'NONE'/);
  assert.doesNotMatch(rendererSource, /opt: 'ALL'/);
  assert.match(rendererSource, /function getRescompLayers\(\)/);
  assert.match(rendererSource, /return state\.map\.layers\.filter\(\(layer\) => layer\?\.name\)/);
  assert.match(rendererSource, /function layerResourceSymbol\(parentName, layerName\)/);
  assert.match(rendererSource, /deleteResEntry\(\{ file: fileName, lineNumber: entry\.lineNumber \}\)/);
  assert.match(rendererSource, /MAP layer 定義を同期しました: \$\{sync\.updated\} 更新 \/ \$\{sync\.added\} 追加 \/ \$\{sync\.removed\} 削除/);
  assert.match(rendererSource, /Generated by tilemap-editor/);
  assert.match(rendererSource, /if \(!hasSelectedMap\(\)\) \{\s*setStatus\('左列で編集する MAP\/TILEMAP 定義を選択してください。'\);/);
  assert.doesNotMatch(rendererSource, /state\.selectedMapKey = firstKeyForTypes\(MAP_TYPES\)/);
  assert.match(rendererSource, /function confirmCanReplaceCurrentMap\(\)/);
  assert.match(rendererSource, /confirmUnsavedMapSwitch/);
  assert.match(rendererSource, /data-tilemap-action="save"[\s\S]*#icon-save[\s\S]*data-tilemap-action="delete"[\s\S]*#icon-trash/);
  assert.doesNotMatch(rendererSource, /data-action="refresh"/);
  assert.doesNotMatch(rendererSource, /data-action="tileset-refresh"/);
  assert.doesNotMatch(rendererSource, /data-action="register"/);
  assert.doesNotMatch(rendererSource, /types: EDITOR_TYPES,\s*\n\s*expanded: state\.expandedAssets/);
  assert.match(rendererSource, /data-ui="layerList"/);
  assert.match(rendererSource, /if \(event\.target\.closest\('\[data-layer-name\]'\)\) return;/);
  assert.match(rendererSource, /data-ui="paletteZoom"/);
  assert.match(rendererSource, /data-ui="tilesetWrap"/);
  assert.doesNotMatch(rendererSource, /data-ui="tileWidth"/);
  assert.doesNotMatch(rendererSource, /data-ui="tileHeight"/);
  assert.match(rendererSource, /data-action="tileset-add"/);
  assert.match(rendererSource, /追加先 \.res/);
  assert.match(rendererSource, /convertToIndexed16\(\{ sourcePath, targetSize \}/);
  assert.match(rendererSource, /type: 'PALETTE'/);
  assert.match(rendererSource, /name: paletteName/);
  assert.match(rendererSource, /sourcePath: copy\.relativePath/);
  assert.match(rendererSource, /ensurePaletteForTileset/);
  assert.match(rendererSource, /sourcePath: imageRel/);
  assert.match(rendererSource, /type="number" min="8" step="8" data-ui="mapWidth"/);
  assert.match(rendererSource, /type="number" min="8" step="8" data-ui="mapHeight"/);
  assert.doesNotMatch(rendererSource, /<span>Tile W<\/span>/);
  assert.doesNotMatch(rendererSource, /<span>Tile H<\/span>/);
  assert.match(rendererSource, /function toolIcon/);
  assert.match(rendererSource, /project\?\.projectDir \|\| project\?\.dir/);
  assert.match(rendererSource, /drawMapPreview/);
  assert.match(rendererSource, /loadTilesetPreviewImage/);
  assert.match(rendererSource, /TILESET 参照を削除しました/);
  assert.match(rendererSource, /loadMapTilesets\(item\.entry\.sourcePath, \{ pruneMissing: true \}\)/);
  assert.match(rendererSource, /state\.map\.tilesets = kept/);
  assert.match(rendererSource, /if \(!kept\.length\) state\.map\.tilesetName = ''/);
  assert.match(rendererSource, /data-palette-key/);
  assert.match(rendererSource, /function renderTilesetPalettePreview\(target, entry\)/);
  assert.match(rendererSource, /function sampleImagePaletteColors\(img, limit = 16\)/);
  assert.match(rendererSource, /rgba\(0,0,0,0\)/);
  assert.doesNotMatch(rendererSource, /fillStyle = colorForTile\(gid\)/);
  assert.doesNotMatch(rendererSource, /tileset\?\.image \|\| state\.tilesetImage/);
  assert.match(rendererSource, /makePaletteZeroTransparentImage\(img, read\.dataUrl\)/);
  assert.match(rendererSource, /function pngPaletteZeroColor\(dataUrl\)/);
  assert.match(rendererSource, /type === 'PLTE'/);
  assert.match(rendererSource, /imageData\.data\[index \+ 3\] = 0/);
  assert.match(rendererSource, /data-layer-visible/);
  assert.doesNotMatch(rendererSource, /data-action="add-tileset"/);
  assert.doesNotMatch(rendererSource, /data-action="import-tileset"/);
  assert.doesNotMatch(rendererSource, />Tileset 画像を読み込み</);
  assert.match(styleSource, /\.tilemap-resource-tree/);
  assert.match(styleSource, /\.tilemap-layer-list/);
  assert.match(styleSource, /\.tilemap-panel-resizer/);
  assert.match(styleSource, /\.tilemap-column-resizer/);
  assert.match(styleSource, /--tilemap-left-width/);
  assert.match(styleSource, /--tilemap-right-width/);
  assert.match(styleSource, /\.tilemap-resource-actions/);
  assert.match(styleSource, /\.tilemap-resource-icon/);
  assert.match(styleSource, /\.tilemap-resource-palette/);
  assert.match(styleSource, /\.tilemap-resource-palette-swatch\.transparent/);
  assert.match(styleSource, /\.tilemap-resource-parent/);
  assert.match(styleSource, /\.tilemap-resource-child/);
  assert.match(styleSource, /\.tilemap-collision-palette/);
  assert.match(styleSource, /\.tilemap-layer-item\.collision/);
  assert.match(styleSource, /background: #0d1e35/);
  assert.match(styleSource, /--tilemap-browser-height/);
  assert.match(styleSource, /--tilemap-palette-height/);
  assert.match(styleSource, /height:\s*calc\(100% \+ 40px\)/);
  assert.match(styleSource, /calc\(\(100% - 6px\) \/ 3\)/);
  assert.match(styleSource, /\.tilemap-warnings\[hidden\]/);
  assert.doesNotMatch(styleSource, /\.tilemap-editor-page\s*\{[^}]*display\s*:/);
});
