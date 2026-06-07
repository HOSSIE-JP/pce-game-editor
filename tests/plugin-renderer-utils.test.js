'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

async function importPluginModule(...segments) {
  return import(pathToFileURL(path.join(__dirname, '..', 'plugins', ...segments)).href);
}

async function importPluginSourceAsModule(...segments) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', ...segments), 'utf-8');
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url);
}

test('asset-manager utility functions keep asset defaults stable', async () => {
  const utils = await importPluginModule('asset-manager', 'asset-utils.mjs');

  assert.equal(utils.inferTypeFromExtension('.png'), 'IMAGE');
  assert.equal(utils.inferTypeFromExtension('.mp3'), 'WAV');
  assert.equal(utils.inferTypeFromExtension('.mid'), 'XGM2');
  assert.equal(utils.inferTypeFromExtension('.midi'), 'XGM2');
  assert.equal(utils.inferTypeFromExtension('.tmx'), 'MAP');
  assert.deepEqual(utils.allowedTypesForExtension('.mid'), ['XGM2', 'XGM']);
  assert.deepEqual(utils.allowedTypesForExtension('.vgm'), ['XGM', 'XGM2']);
  assert.equal(utils.defaultSubDirForType('SPRITE'), 'sprite');
  assert.equal(utils.defaultSubDirForType('XGM2'), 'music');
  assert.equal(utils.normalizeSymbolName('123 Title Screen.png'), 'title_screen');
});

test('audio-converter declares renderer-invokable main hook capability', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'audio-converter', 'manifest.json'),
    'utf-8',
  ));
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'audio-converter', 'renderer.js'),
    'utf-8',
  );

  assert.deepEqual(manifest.mainApi.hooks, ['convertAudio']);
  assert.deepEqual(manifest.mainApi.capabilities, ['audio-convert']);
  assert.match(rendererSource, /invokeHook\(plugin\.id,\s*['"]convertAudio['"]/);
  assert.match(rendererSource, /readTempFileAsDataUrl/);
  assert.doesNotMatch(rendererSource, /previewConvertAudio/);
  assert.doesNotMatch(rendererSource, /convertAndWriteAudioAsset/);
  assert.doesNotMatch(rendererSource, /pluginId:\s*['"]audio-converter['"]/);
});

test('asset-manager declares v2.5 asset provider capabilities', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'asset-manager', 'manifest.json'),
    'utf-8',
  ));
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'asset-manager', 'renderer.js'),
    'utf-8',
  );
  const appRendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf-8');

  assert.ok(manifest.dependencies.includes('midi-converter'));
  assert.ok(manifest.renderer.capabilities.includes('asset-type-provider'));
  assert.ok(manifest.renderer.capabilities.includes('asset-import-handler'));
  assert.ok(manifest.renderer.capabilities.includes('image-import-pipeline'));
  assert.match(rendererSource, /registerCapability\(['"]asset-type-provider['"]/);
  assert.match(rendererSource, /registerCapability\(['"]image-import-pipeline['"]/);
  assert.match(rendererSource, /paletteSlots\s*=\s*unique\s*\+\s*\(hasTransparent\s*\?\s*1\s*:\s*0\)/);
  assert.match(rendererSource, /originalIndexed\s*=\s*extractIndexedSourcePalette\(read\.dataUrl\)/);
  assert.match(rendererSource, /originalIndexed\.format === 'bmp'/);
  assert.match(rendererSource, /extractIndexedBmpPalette\(dataUrl\)/);
  assert.match(rendererSource, /encodeBmpSourceAsIndexedPng\(originalIndexed\)/);
  assert.match(rendererSource, /targetExtension:\s*['"]\.png['"]/);
  assert.match(rendererSource, /targetMatchesSource\s*=/);
  assert.match(rendererSource, /convertedDataUrl:\s*bmpDataUrl/);
  assert.match(rendererSource, /resizeResult\.skipped/);
  assert.match(rendererSource, /extractIndexedPngPalette\(workingDataUrl\)/);
  assert.match(rendererSource, /encodeImageDataWithIndexedPalette\(imageData,\s*preserveIndexed\)/);
  assert.match(rendererSource, /ensureIndexedTransparentIndexUsed\(savedDataUrl,\s*extractIndexedPngPalette\(savedDataUrl\)\)/);
  assert.match(rendererSource, /indices\[indices\.length - 1\]\s*=\s*0/);
  assert.match(rendererSource, /savedDataUrl\s*=\s*workingDataUrl/);
  assert.match(rendererSource, /convertedDataUrl:\s*savedDataUrl/);
  assert.match(rendererSource, /setupAutoReloadOnOpen\(\{ root,\s*api,\s*logger \}\)/);
  assert.match(rendererSource, /new MutationObserver\(reloadIfOpened\)/);
  assert.match(rendererSource, /reloadResources\?\.\(\{ keepSelection:\s*true \}\)/);
  assert.doesNotMatch(rendererSource, /data-asset-manager-reload|mountReloadButton/);
  assert.match(rendererSource, /buildPreviewPaletteFromDataUrl/);
  assert.match(rendererSource, /MIDI_EXTS/);
  assert.match(appRendererSource, /tryHandleAssetImport/);
  assert.match(appRendererSource, /asset-import-handler/);
  assert.match(appRendererSource, /handleImport/);
  assert.match(appRendererSource, /vgm-preview-player/);
  assert.match(appRendererSource, /isVgmPreviewEntry/);
  assert.match(appRendererSource, /isBgmMetaEntry/);
  assert.match(appRendererSource, /getMusicMetaSourcePath/);
  assert.match(appRendererSource, /renderBgmMetaRows/);
  assert.match(appRendererSource, /formatPreviewEngineStatus/);
  assert.match(appRendererSource, /プレビューエンジン/);
  assert.match(appRendererSource, /loadHighAccuracyEngine/);
  assert.match(appRendererSource, /getEngineStatus/);
  assert.match(appRendererSource, /使用中エンジン/);
  assert.match(appRendererSource, /parseXgm/);
  assert.match(appRendererSource, /toggleVgmPreview/);
  assert.doesNotMatch(appRendererSource, /midi-converter/);
});

test('PCE asset manager declares plugin-owned import workflow without MD rescomp coupling', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'manifest.json'),
    'utf-8',
  ));
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'renderer.js'),
    'utf-8',
  );

  assert.deepEqual(manifest.supportedCores, ['pc-engine']);
  assert.ok(manifest.renderer.capabilities.includes('asset-type-provider'));
  assert.ok(manifest.renderer.capabilities.includes('asset-import-handler'));
  assert.ok(manifest.permissions.includes('asset.import'));
  assert.match(rendererSource, /registerCapability\(['"]asset-type-provider['"]/);
  assert.match(rendererSource, /registerCapability\(['"]asset-import-handler['"]/);
  assert.match(rendererSource, /importAssetImage/);
  assert.match(rendererSource, /previewAssetSource/);
  assert.match(rendererSource, /dataUrlToPng/);
  assert.match(rendererSource, /allowedTypes:\s*\['image',\s*'sprite'\]/);
  assert.doesNotMatch(rendererSource, /listResDefinitions|addResEntry|writeAssetFile|deleteResEntry|state\.rescomp/);
});

test('PCE asset manager renderer remains importable as an ES module', async () => {
  const module = await importPluginSourceAsModule('pce-asset-manager', 'renderer.js');

  assert.equal(typeof module.activatePlugin, 'function');
});

function makePngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  return chunk;
}

function makeIndexedPngDataUrl({ palette, transparentIndex }) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = Buffer.from(palette.flatMap((color) => [color.r, color.g, color.b]));
  const trns = Buffer.alloc(transparentIndex + 1, 255);
  trns[transparentIndex] = 0;
  const bytes = Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('PLTE', plte),
    makePngChunk('tRNS', trns),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

test('asset-manager preview palette exposes exactly 16 slots including transparency', async () => {
  const renderer = await importPluginModule('asset-manager', 'renderer.js');
  const dataUrl = makeIndexedPngDataUrl({
    transparentIndex: 2,
    palette: [
      { r: 0, g: 0, b: 0 },
      { r: 252, g: 0, b: 0 },
      { r: 0, g: 252, b: 0 },
    ],
  });

  const palette = renderer.buildPreviewPaletteFromDataUrl(dataUrl, [], { maxColors: 16 });
  assert.equal(palette.length, 16);
  assert.equal(palette[2].transparent, true);
  assert.equal(palette[2].g, 252);
  assert.equal(palette[15].empty, true);
});

test('asset preview renderer uses asset-manager palette helper and 16 swatches', () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'renderer.js'),
    'utf-8',
  );

  assert.match(rendererSource, /assets:\s*\{/);
  assert.match(rendererSource, /reloadResources:\s*async/);
  assert.match(rendererSource, /getPluginCapability\(['"]asset-manager['"]\)\?\.buildPreviewPalette/);
  assert.match(rendererSource, /extractDisplayPalette\(imageData,\s*16\)/);
  assert.match(rendererSource, /renderPaletteSwatches\(el\.inlinePalette,\s*colors\)/);
});

test('asset preview animates SPRITE entries with row-aware timing', () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'renderer.js'),
    'utf-8',
  );
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'renderer', 'style.css'),
    'utf-8',
  );

  assert.match(rendererSource, /function syncSpriteInlinePreview\(entry\)/);
  assert.match(rendererSource, /parseSpritePreviewTimeRows\(entry\.time \|\| '0'/);
  assert.match(rendererSource, /data-sprite-preview-row/);
  assert.match(rendererSource, /\$\{index\} \(\$\{row\.length\} frames\)/);
  assert.doesNotMatch(rendererSource, /ROW \$\{index\}/);
  assert.match(rendererSource, /data-sprite-preview-toggle/);
  assert.match(rendererSource, /href="#icon-stop"/);
  assert.match(rendererSource, /#icon-play/);
  assert.match(rendererSource, /function toggleSpritePreviewPlayback\(\)/);
  assert.match(rendererSource, /scheduleSpritePreviewFrame/);
  assert.match(rendererSource, /isSpriteEntry\(entry\)[\s\S]*await syncSpriteInlinePreview\(entry\)/);
  assert.match(css, /\.image-preview-frame img\[hidden\],[\s\S]*\.image-preview-frame canvas\[hidden\]\s*\{[\s\S]*display:\s*none !important/);
  assert.match(css, /\.sprite-animation-preview-canvas\s*\{[\s\S]*image-rendering:\s*pixelated/);
});

test('image-quantize utility functions snap and index colors', async () => {
  const utils = await importPluginModule('image-quantize-converter', 'quantize-utils.mjs');
  const imageData = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      255, 0, 0, 0,
    ]),
  };

  assert.deepEqual(utils.snapColorToMegaDrive({ r: 255, g: 17, b: 90 }), { r: 252, g: 0, b: 108 });
  assert.equal(utils.countUniqueColors(imageData), 2);

  const quantized = utils.quantizeToIndexed16(imageData, { reserveTransparent: true });
  assert.equal(quantized.transparentIndex, 0);
  assert.equal(quantized.indices.length, 3);
  assert.equal(quantized.indices[2], 0);
  assert.ok(quantized.palette.length <= 16);
});

test('sprite-editor utility functions parse size, frame grid, and frame times', async () => {
  const utils = await importPluginModule('sprite-editor', 'sprite-utils.mjs');

  assert.equal(utils.parseSpriteSizeToken('4', 128).pixels, 32);
  assert.equal(utils.parseSpriteSizeToken('32p', 128).pixels, 32);
  assert.equal(utils.parseSpriteSizeToken('4f', 128).pixels, 32);
  assert.equal(utils.formatSpritePixelToken(31), '32p');
  assert.equal(utils.formatSpriteTileToken(48), '6');
  assert.equal(utils.snapSpritePixels(500), 248);
  assert.equal(utils.parseSpriteSizeToken('40p', 128).pixels, 40);
  assert.equal(utils.parseSpriteSizeToken('256p', 512).pixels, 248);

  const grid = utils.computeFrameGrid(96, 32, '32p', '16p');
  assert.equal(grid.columns, 3);
  assert.equal(grid.rows, 2);
  assert.deepEqual(grid.frames[4], { row: 1, frame: 1, x: 32, y: 16, width: 32, height: 16 });

  assert.deepEqual(utils.parseSpriteTime('3', 2, 3), [['3', '3', '3'], ['3', '3', '3']]);
  assert.deepEqual(utils.parseSpriteTime('[[3,4,5][6,,8]]', 2, 3), [['3', '4', '5'], ['6', '', '8']]);
  assert.equal(utils.updateSpriteTimeCell('3', 2, 3, 1, 2, 9), '[[3,3,3][3,3,9]]');
  assert.deepEqual(utils.deriveRowFrameCounts('1', 2, 4), [4, 4]);
  assert.deepEqual(utils.deriveRowFrameCounts('[[1,1][1,1,1,1]]', 2, 4), [2, 4]);
  assert.equal(utils.getActiveFrameCountForRow('[[1,1][1,1,1,1]]', 2, 4, 0), 2);
  assert.equal(utils.resizeSpriteTimeRow('[[1,1][1,1,1,1]]', 2, 4, 0, 3, 7), '[[1,1,7][1,1,1,1]]');
  assert.equal(utils.resizeSpriteTimeRow('[[1,1,7][1,1,1,1]]', 2, 4, 1, 2, 7), '[[1,1,7][1,1]]');
});

test('sprite-editor declares plugin-local page and uses v2.5 capabilities', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'sprite-editor', 'manifest.json'),
    'utf-8',
  ));
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'sprite-editor', 'renderer.js'),
    'utf-8',
  );
  const styleSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'sprite-editor', 'style.css'),
    'utf-8',
  );

  assert.deepEqual(manifest.types, ['editor', 'asset']);
  assert.equal(manifest.tab.page, 'sprite-editor');
  assert.ok(manifest.dependencies.includes('asset-manager'));
  assert.ok(manifest.renderer.capabilities.includes('sprite-editor'));
  assert.match(rendererSource, /registerCapability\(['"]sprite-editor['"]/);
  assert.match(rendererSource, /listResDefinitions\(\)/);
  assert.match(rendererSource, /image-import-pipeline/);
  assert.match(rendererSource, /data-role="splitter"/);
  assert.match(rendererSource, /data-role="left-column-resizer"/);
  assert.match(rendererSource, /data-role="right-column-resizer"/);
  assert.match(rendererSource, /function resizeColumns\(event\)/);
  assert.match(rendererSource, /addEventListener\(['"]wheel['"]/);
  assert.match(rendererSource, /min="0\.25" max="12" step="0\.25"/);
  assert.match(rendererSource, /selectFrameFromSheet/);
  assert.match(rendererSource, /data-role="row-list"/);
  assert.match(rendererSource, /class="sprite-editor-row-header"[\s\S]*<span>ROW<\/span>[\s\S]*<span>有効<\/span>[\s\S]*<span>既定 time<\/span>/);
  assert.doesNotMatch(rendererSource, /<label class="sprite-editor-inline-field">有効[\s\S]*data-row-frame-count/);
  assert.match(rendererSource, /resizeSpriteTimeRow/);
  assert.match(rendererSource, /function applyRowDefaultTime\(input,\s*options = \{\}\)/);
  assert.match(rendererSource, /ui\.time\.value = nextTime/);
  assert.match(rendererSource, /await saveProperties\(\{ silent: true \}\)/);
  assert.match(rendererSource, /function drawFrameTimeLabels\(ctx,\s*scale,\s*counts = getRowFrameCounts\(\)\)/);
  assert.match(rendererSource, /ctx\.fillText\(label,\s*x \+ padX,\s*y \+ padY\)/);
  assert.match(rendererSource, /if \(time <= 0\) \{\s*stopPlayback\(\);\s*return;\s*\}/);
  assert.match(rendererSource, /getActiveFrameCountForRow/);
  const sheetClickFn = rendererSource.slice(
    rendererSource.indexOf('function selectFrameFromSheet'),
    rendererSource.indexOf('function startPlayback'),
  );
  assert.doesNotMatch(sheetClickFn, /startPlayback\(\)/);
  assert.doesNotMatch(rendererSource, /range-pick|rangePick|handleSheetRangePick/);
  assert.match(rendererSource, /drawCollisionOverlay/);
  assert.match(rendererSource, /targetWidth: snapUpTo8/);
  assert.match(rendererSource, /targetSize = \{\s*width: request\.targetWidth,\s*height: request\.targetHeight,/);
  assert.match(rendererSource, /writeAssetFile/);
  assert.match(rendererSource, /addResEntry/);
  assert.match(rendererSource, /updateResEntry/);
  assert.match(rendererSource, /deleteResEntry/);
  assert.match(rendererSource, /function confirmCanReplaceCurrentSprite\(\)/);
  assert.match(rendererSource, /confirmUnsavedSpriteSwitch/);
  assert.match(rendererSource, /data-sprite-action="save"[\s\S]*#icon-save[\s\S]*data-sprite-action="delete"[\s\S]*#icon-trash/);
  assert.doesNotMatch(rendererSource, /data-role="refresh"/);
  assert.match(styleSource, /height:\s*calc\(100% \+ 40px\)/);
  assert.match(styleSource, /\.sprite-editor-column-resizer/);
  assert.match(styleSource, /grid-template-columns:\s*var\(--sprite-left-width\)\s*3px\s*minmax\(420px,\s*1fr\)\s*3px\s*var\(--sprite-right-width\)/);
  assert.doesNotMatch(styleSource, /\.sprite-editor-column-resizer::before/);
  assert.match(styleSource, /--sprite-left-width/);
  assert.match(styleSource, /--sprite-right-width/);
  assert.match(styleSource, /grid-template-rows:\s*minmax\(0,\s*0\.9fr\)\s*6px\s*minmax\(0,\s*1\.1fr\)/);
  assert.match(styleSource, /\.sprite-editor-animation-rows\s*\{[\s\S]*max-height:\s*min\(220px,\s*38%\)/);
  assert.match(styleSource, /\.sprite-editor-row-header,\s*[\s\S]*\.sprite-editor-row-config\s*\{/);
  assert.match(styleSource, /\.sprite-editor-row-config\s*\{[\s\S]*min-height:\s*32px;/);
  assert.match(styleSource, /\.sprite-editor-props\s*\{[\s\S]*padding:\s*0;/);
  assert.match(styleSource, /\.sprite-editor-form-grid\s*\{[\s\S]*padding:\s*10px;/);
  assert.doesNotMatch(rendererSource, /window\.prompt|window\.alert|window\.confirm/);
});

test('ai-control declares plugin-local page and control capability', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'ai-control', 'manifest.json'),
    'utf-8',
  ));
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'ai-control', 'renderer.js'),
    'utf-8',
  );

  assert.deepEqual(manifest.types, ['editor', 'tool']);
  assert.equal(manifest.renderer.entry, 'renderer.js');
  assert.equal(manifest.renderer.script, undefined);
  assert.equal(manifest.renderer.page, 'ai-control');
  assert.deepEqual(manifest.renderer.capabilities, ['page', 'ai-control']);
  assert.match(rendererSource, /registerCapability\('ai-control'/);
  assert.match(rendererSource, /startAiControlServer/);
  assert.match(rendererSource, /data-ai-control-sidebar-status/);
  assert.match(rendererSource, /dataset\.aiControlRunning/);
});
