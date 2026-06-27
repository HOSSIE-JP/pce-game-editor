'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function readRendererFile(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf-8');
}

function readPluginManifest(pluginId) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', pluginId, 'manifest.json'), 'utf-8'));
}

test('settings page keeps project and export settings in two columns', () => {
  const html = readRendererFile('index.html');
  const css = readRendererFile('style.css');

  assert.match(html, /settings-form project-settings-grid/);
  assert.match(html, /<section class="settings-column">[\s\S]*現在のプロジェクト/);
  assert.match(html, /<section class="settings-column export-settings-column">[\s\S]*エクスポート設定[\s\S]*settingOutputPath/);
  assert.match(css, /\.project-settings-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(320px,\s*1fr\)\s*minmax\(280px,\s*0\.82fr\)/);
});

test('settings page exposes external emulator settings gated by Test Play role', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="externalEmulatorSettings"[\s\S]*外部エミュレーター/);
  assert.match(html, /id="externalEmulatorPath"/);
  assert.match(html, /id="externalEmulatorArgs"/);
  assert.match(renderer, /const EXTERNAL_EMULATOR_PLUGIN_ID = 'pce-external-emulator'/);
  assert.match(renderer, /const DEFAULT_EXTERNAL_EMULATOR_PATH = '\/Applications\/Geargrafx\.app\/Contents\/MacOS\/geargrafx'/);
  assert.match(renderer, /function updateExternalEmulatorSettingsAvailability\(\)/);
  assert.match(renderer, /activeId === EXTERNAL_EMULATOR_PLUGIN_ID/);
  assert.match(renderer, /testPlay:\s*buildTestPlaySettingsPatch\(\)/);
  assert.match(renderer, /updateExternalEmulatorSettingsAvailability\(\)/);
});

test('header project chips are actionable buttons wired to project actions', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /<button class="project-name" id="projectName" type="button"/);
  assert.match(html, /<button class="project-path-chip" id="projectDirLabel" type="button"/);
  assert.match(renderer, /el\.projectName\?\.addEventListener\('click',\s*openProjectPicker\)/);
  assert.match(renderer, /el\.projectDirLabel\?\.addEventListener\('click',\s*openCurrentProjectDirectory\)/);
  assert.match(renderer, /window\.electronAPI\.openPathInExplorer\(state\.project\.dir\)/);
});

test('header build controls include setup and export flow', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');
  const css = readRendererFile('style.css');

  assert.match(html, /id="btnSetup"[\s\S]*SetUp[\s\S]*id="btnBuild"[\s\S]*Build[\s\S]*id="btnTestPlay"[\s\S]*Test Play[\s\S]*id="btnExport"[\s\S]*Export/);
  assert.match(html, /id="exportModal"/);
  assert.match(html, /id="btnExportRom"/);
  assert.match(html, /id="btnExportHtml"/);
  assert.match(renderer, /btnSetup:\s*\$\('btnSetup'\)/);
  assert.match(renderer, /btnExport:\s*\$\('btnExport'\)/);
  assert.match(renderer, /el\.btnSetup\?\.addEventListener\('click'[\s\S]*openSetupWindow\(\)/);
  assert.match(renderer, /el\.btnExport\?\.addEventListener\('click',\s*openExportModal\)/);
  assert.match(renderer, /function updateRomOutputActions\(\)[\s\S]*el\.btnExport\.disabled = !hasRom/);
  assert.match(renderer, /async function openExportModal\(\)[\s\S]*window\.electronAPI\.getRomPath\(\)/);
  assert.match(renderer, /async function exportLastBuild\(format\)/);
  assert.match(renderer, /window\.electronAPI\.exportRom\(\)/);
  assert.match(renderer, /window\.electronAPI\.exportHtml\(\)/);
  assert.match(renderer, /const result = isHtml\s*\? await window\.electronAPI\.exportHtml\(\)\s*: await window\.electronAPI\.exportRom\(\)/);
  assert.match(css, /\.action-btn\.export-btn/);
  assert.match(css, /\.export-choice-grid/);
});

test('setup page exposes optional Nuked-OPN2 user download flow', () => {
  const html = readRendererFile('setup.html');

  assert.match(html, /id="emsdkCard"/);
  assert.match(html, /id="btnDownloadEmsdk"/);
  assert.match(html, /downloadEmsdk\(\)/);
  assert.match(html, /id="nukedOpn2Card"/);
  assert.match(html, /id="btnDownloadNukedOpn2"/);
  assert.match(html, /id="btnBuildNukedOpn2"/);
  assert.match(html, /Nuked-OPN2/);
  assert.match(html, /LGPL-2\.1-or-later/);
  assert.match(html, /downloadNukedOpn2\(\)/);
  assert.match(html, /buildNukedOpn2Wasm\(\)/);
  assert.match(html, /audioEngines\.nukedOpn2/);
  assert.match(html, /audioEngines\.nukedOpn2Wasm/);
});

test('setup page exposes PCE-CD IPL extraction flow', () => {
  const html = readRendererFile('setup.html');

  assert.match(html, /id="pceCdImagePath"/);
  assert.match(html, /id="btnPickPceCdImage"/);
  assert.match(html, /id="btnExtractPceCdIpl"/);
  assert.match(html, /id="pceCdOwnSourceConfirm"/);
  assert.match(html, /ISO\/CUE\/BIN/);
  assert.match(html, /selectPceCdImage\(\)/);
  assert.match(html, /extractPceCdIpl\(\{ sourcePath, confirmOwnedSource \}\)/);
});

test('plugin role accordion starts collapsed by default', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="btnPluginRoleAccordion" type="button" aria-expanded="false"/);
  assert.match(html, /class="accordion-body is-collapsed" id="pluginRoleBody"/);
  assert.match(renderer, /roleAccordionOpen:\s*false/);
});

test('log viewer height persists and popout control is wired', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');
  const popoutHtml = readRendererFile('log-viewer.html');
  const popoutRenderer = readRendererFile('log-viewer.js');

  assert.match(html, /id="btnPopoutLog"/);
  assert.match(renderer, /LOG_VIEWER_STATE_KEY\s*=\s*['"]md-editor\.logViewerState\.v1['"]/);
  assert.match(renderer, /localStorage\.setItem\(LOG_VIEWER_STATE_KEY/);
  assert.match(renderer, /loadLogViewerState\(\)/);
  assert.match(renderer, /logDetached:\s*false/);
  assert.match(renderer, /function setLogDetached\(detached\)/);
  assert.match(renderer, /onLogWindowClosed\?\.\(\(\)\s*=>\s*\{\s*setLogDetached\(false\)/);
  assert.match(renderer, /openLogWindow\?\.\(getLogSnapshot\(\)\)/);
  assert.match(renderer, /setLogDetached\(true\)/);
  assert.match(renderer, /appendLogWindowEntry\?\.\(entry\)/);
  assert.match(renderer, /from '\.\/log-viewer-core\.mjs'/);
  assert.match(popoutHtml, /<script type="module" src="\.\/log-viewer\.js"><\/script>/);
  assert.match(popoutHtml, /id="logLevelFilter"/);
  assert.match(popoutHtml, /id="logSearchInput"/);
  assert.match(popoutHtml, /id="logSourceFilters"/);
  assert.match(popoutRenderer, /from '\.\/log-viewer-core\.mjs'/);
});

test('asset manager res file delete and preview resize are wired', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');
  const css = readRendererFile('style.css');

  assert.match(html, /id="btnDeleteAssetEntry"[\s\S]*title="選択中の \.res ファイルを削除"/);
  assert.match(html, /id="assetPreviewResizer"[\s\S]*role="separator"/);
  assert.match(renderer, /deleteResFile\(fileName\)/);
  assert.match(renderer, /el\.btnDeleteAssetEntry\?\.addEventListener\('click',\s*deleteCurrentResFile\)/);
  assert.match(renderer, /ASSET_PREVIEW_WIDTH_KEY\s*=\s*['"]md-editor\.assetPreviewWidth\.v1['"]/);
  assert.match(renderer, /assetPreviewResizer:\s*\$\('assetPreviewResizer'\)/);
  assert.match(renderer, /function beginAssetPreviewResize\(event\)/);
  assert.match(renderer, /addEventListener\('pointerdown',\s*beginAssetPreviewResize\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*5px\s*var\(--asset-preview-width\)/);
  assert.match(css, /\.asset-preview-resizer/);
});

test('PCE asset manager uses MD-style panes and plugin-owned PCE IPC workflow', () => {
  const manifest = readPluginManifest('pce-asset-manager');
  const imageManifest = readPluginManifest('pce-image-converter');
  const audioManifest = readPluginManifest('pce-audio-converter');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'renderer.js'), 'utf-8');
  const imageRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-image-converter', 'renderer.js'), 'utf-8');
  const audioRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-audio-converter', 'renderer.js'), 'utf-8');
  const html = readRendererFile('index.html');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'style.css'), 'utf-8');

  assert.equal(manifest.tab.page, 'pce-assets');
  assert.equal(manifest.renderer.page, 'pce-assets');
  assert.ok(manifest.dependencies.includes('pce-audio-converter'));
  assert.ok(manifest.renderer.capabilities.includes('asset-import-handler'));
  assert.ok(imageManifest.dependencies.includes('image-resize-converter'));
  assert.ok(imageManifest.dependencies.includes('image-quantize-converter'));
  assert.equal(imageManifest.dependencies.includes('pce-asset-manager'), false);
  assert.ok(imageManifest.renderer.capabilities.includes('image-import-pipeline'));
  assert.ok(audioManifest.renderer.capabilities.includes('audio-convert-ui'));
  assert.match(imageRenderer, /const IMAGE_EXTS = \['\.png', '\.bmp', '\.webp'\]/);
  assert.match(imageRenderer, /sourceExt === '\.webp'/);
  assert.match(imageRenderer, /dataUrlToPng\(workingDataUrl\)/);
  assert.match(imageRenderer, /priority:\s*30/);
  assert.match(audioRenderer, /openAudioConvertModal:\s*api\.openAudioConvertModal/);
  assert.match(renderer, /assets-layout/);
  assert.match(renderer, /asset-table/);
  assert.match(renderer, /asset-preview-panel/);
  assert.match(renderer, /accordion-section/);
  assert.match(renderer, /image-preview-frame/);
  assert.match(renderer, /pce-assets-sound-preview/);
  assert.match(renderer, /playPsgPreview/);
  assert.match(renderer, /data-action="preview-toggle"/);
  assert.match(renderer, /createPsgPreviewController/);
  assert.match(renderer, /isPsgAsset\(asset\)[\s\S]*Sound[\s\S]*Period \/ Hz[\s\S]*Steps/);
  assert.match(renderer, /palette-swatch/);
  assert.match(renderer, /id="pceAssetEditorPanel"/);
  assert.match(renderer, /data-action="import-bg"[\s\S]*title="BGを追加"/);
  assert.match(renderer, /data-action="import-sprite"[\s\S]*title="スプライトを追加"/);
  assert.match(renderer, /data-action="import-adpcm"[\s\S]*title="ADPCMを追加"/);
  assert.match(renderer, /data-action="import-cdda"[\s\S]*title="CD-DAを追加"/);
  assert.match(renderer, /data-field="stream"/);
  assert.match(renderer, /const stream = kind === 'adpcm' && Boolean\(form\.elements\.stream\?\.checked\)/);
  assert.match(renderer, /stream,/);
  assert.match(renderer, /splitPolicy:\s*kind === 'adpcm' && !stream \? 'auto' : ''/);
  assert.doesNotMatch(renderer, /data-action="refresh"/);
  assert.match(renderer, /data-role="animation-editor"/);
  assert.match(renderer, /data-animation-add/);
  assert.doesNotMatch(renderer, /data-row-delete="[^"]*"[\s\S]*>Del<\/button>/);
  assert.doesNotMatch(renderer, /id="assetEditorPanel"/);
  assert.match(renderer, /api\.createModal/);
  assert.match(renderer, /picked\?\.sourcePath/);
  assert.match(renderer, /importAssetImage/);
  assert.match(renderer, /async function pickImageInputFile\(\)/);
  assert.match(renderer, /const initialFile = importFile\?\.sourcePath[\s\S]*await pickImageInputFile\(\)/);
  assert.match(renderer, /assets = result\.assets/);
  assert.match(renderer, /renderRows\(\);\s*fillForm\(selectedAsset\(\)\)/);
  assert.match(renderer, /const IMAGE_EXTS = \['\.png', '\.bmp', '\.webp'\]/);
  assert.match(renderer, /PNG \/ BMP \/ WebP/);
  assert.match(renderer, /extensions:\s*\['png', 'bmp', 'webp'\]/);
  assert.match(renderer, /const PCE_BG_AUTO_TILE_BASE = 128/);
  assert.match(renderer, /const PCE_BG_AUTO_MAP_BASE = 0/);
  assert.match(renderer, /tileBase:\s*type === 'sprite' \? asNumber\(fields\.tileBase\.value, 384\) : PCE_BG_AUTO_TILE_BASE/);
  assert.match(renderer, /mapBase:\s*PCE_BG_AUTO_MAP_BASE/);
  assert.match(renderer, /sourceExt === '\.webp'/);
  assert.match(renderer, /dataUrlToPng\(workingDataUrl\)/);
  assert.match(renderer, /assets:pce:changed/);
  assert.match(renderer, /page:activated/);
  assert.match(renderer, /async function pickAudioInputFile\(\)/);
  assert.match(renderer, /const initialFile = importFile\?\.sourcePath[\s\S]*await pickAudioInputFile\(\)/);
  assert.match(renderer, /audio-convert-ui/);
  assert.match(renderer, /openAudioConvertModal/);
  assert.match(renderer, /WAV \/ MP3/);
  assert.match(renderer, /previewAssetSource/);
  assert.match(renderer, /reorderAssets/);
  assert.match(renderer, /asset-import-handler/);
  assert.match(renderer, /openImportWizard\('sprite'\)/);
  assert.match(renderer, /asset\.type === 'sprite'/);
  assert.doesNotMatch(renderer, /mini-btn|class="input"|class="select"|pane-header|confirm\(/);
  assert.doesNotMatch(renderer, /window\.electronAPI|listResDefinitions|addResEntry|writeAssetFile|state\.rescomp/);
  assert.match(renderer, /role="separator" aria-orientation="vertical"/);
  assert.match(html, /id="audioConvertFadeInInput"/);
  assert.match(html, /id="audioConvertFadeOutInput"/);
  assert.match(html, /id="audioConvertVolumeDbInput"/);
  assert.match(html, /id="audioConvertNormalizeInput"/);
  assert.match(html, /id="audioConvertStartSlider"[\s\S]*id="audioConvertEndSlider"/);
  assert.match(html, /id="btnAudioConvertPreview"/);
  assert.match(css, /\.pce-assets-layout/);
  assert.match(css, /\.pce-assets-animation-editor/);
  assert.doesNotMatch(css, /\.asset-table\s*\{|\.form-input\s*\{/);
});

test('Image plugin integrates BG, Sprites, and Palette tools behind one tabbed page', () => {
  const manifest = readPluginManifest('image-editor');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'image-editor', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'image-editor', 'style.css'), 'utf-8');

  assert.equal(manifest.name, 'イメージ');
  assert.equal(manifest.tab.label, 'Image');
  assert.equal(manifest.tab.page, 'image-editor');
  assert.equal(manifest.renderer.page, 'image-editor');
  assert.ok(manifest.dependencies.includes('pce-image-converter'));
  assert.ok(manifest.renderer.capabilities.includes('image-editor'));
  assert.ok(manifest.renderer.capabilities.includes('background-manager'));
  assert.ok(manifest.renderer.capabilities.includes('sprite-manager'));
  assert.ok(manifest.renderer.capabilities.includes('palette-editor'));
  assert.match(renderer, /activateBackgroundManager/);
  assert.match(renderer, /activateSpriteManager/);
  assert.match(renderer, /activatePaletteEditor/);
  assert.match(renderer, /label:\s*'BG'/);
  assert.match(renderer, /label:\s*'Sprites'/);
  assert.match(renderer, /label:\s*'Palette'/);
  assert.match(renderer, /data-image-tab/);
  assert.match(renderer, /data-image-panel/);
  assert.match(css, /pce-background-manager\/style\.css/);
  assert.match(css, /pce-sprite-manager\/style\.css/);
  assert.match(css, /pce-palette-editor\/style\.css/);
  assert.match(css, /\.tool-tab-button/);
});

test('Image manager modules expose file-first image import, asset list editing, and palette editing', () => {
  const bgManifest = readPluginManifest('pce-background-manager');
  const spriteManifest = readPluginManifest('pce-sprite-manager');
  const paletteManifest = readPluginManifest('pce-palette-editor');
  const bgRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-background-manager', 'renderer.js'), 'utf-8');
  const spriteRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-sprite-manager', 'renderer.js'), 'utf-8');
  const spritePage = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-sprite-manager', 'sprite-editor-page.js'), 'utf-8');
  const spriteUtils = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-sprite-manager', 'sprite-editor-utils.mjs'), 'utf-8');
  const paletteRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-palette-editor', 'renderer.js'), 'utf-8');
  const commonRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-image-converter', 'image-asset-manager-page.js'), 'utf-8');
  const bgCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-background-manager', 'style.css'), 'utf-8');
  const spriteCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-sprite-manager', 'style.css'), 'utf-8');
  const paletteCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-palette-editor', 'style.css'), 'utf-8');
  const appCss = readRendererFile('style.css');

  assert.equal(bgManifest.hidden, true);
  assert.equal(bgManifest.tab, undefined);
  assert.equal(bgManifest.renderer, undefined);
  assert.ok(bgManifest.dependencies.includes('pce-image-converter'));
  assert.equal(spriteManifest.hidden, true);
  assert.equal(spriteManifest.tab, undefined);
  assert.equal(spriteManifest.renderer, undefined);
  assert.ok(spriteManifest.dependencies.includes('pce-image-converter'));
  assert.equal(paletteManifest.hidden, true);
  assert.equal(paletteManifest.tab, undefined);
  assert.equal(paletteManifest.renderer, undefined);
  assert.match(bgRenderer, /createImageAssetManagerPlugin/);
  assert.match(bgRenderer, /kind:\s*'background'/);
  assert.match(spriteRenderer, /activatePceSpriteEditor/);
  assert.doesNotMatch(spriteRenderer, /createImageAssetManagerPlugin/);
  assert.match(spritePage, /Frame Preview/);
  assert.match(spritePage, /Sprite Sheet/);
  assert.match(spritePage, /ANIMATION ROWS/);
  assert.match(spritePage, /Properties/);
  assert.match(spritePage, /アドバンス/);
  assert.match(spritePage, /min="10" max="500" step="1" value="400" data-role="frame-scale"/);
  assert.match(spritePage, /min="10" max="500" step="1" value="400" data-role="sheet-scale"/);
  assert.match(spritePage, /data-role="show-grid" checked[\s\S]*<span>Grid<\/span>/);
  assert.match(spritePage, /data-role="loop-playback" checked[\s\S]*<span>Loop<\/span>/);
  assert.match(spritePage, /data-role="preview-canvas"/);
  assert.match(spritePage, /data-role="sheet-canvas"/);
  assert.match(spritePage, /data-column-resizer="left"/);
  assert.match(spritePage, /data-column-resizer="right"/);
  assert.match(spritePage, /data-row-resizer/);
  assert.match(spritePage, /function setupStagePanning/);
  assert.match(spritePage, /event\.button !== 1/);
  assert.match(spritePage, /function renderAnimationRows/);
  assert.match(spritePage, /function saveRowFrameCount/);
  assert.match(spritePage, /function applyRowDefaultTime/);
  assert.match(spritePage, /function drawFrameGrid/);
  assert.match(spritePage, /function zoomFromWheel\(input, stage, event, redraw\)/);
  assert.match(spritePage, /buildAnimationsFromEditorState/);
  assert.match(spritePage, /importSpriteAsset/);
  assert.match(spritePage, /convertToIndexed16/);
  assert.match(spritePage, /importPceImage/);
  assert.match(spritePage, /Sprite sheet の出力サイズは16px単位/);
  assert.match(spritePage, /assets:pce:changed/);
  assert.match(spritePage, /page:activated/);
  assert.match(spritePage, /registerCapability\('sprite-manager'/);
  assert.doesNotMatch(spritePage, /data-action="delete-selected"/);
  assert.doesNotMatch(spritePage, /data-action="first-frame"/);
  assert.doesNotMatch(spritePage, /data-action="last-frame"/);
  assert.doesNotMatch(spritePage, /opt_type/);
  assert.doesNotMatch(spritePage, /opt_level/);
  assert.doesNotMatch(spritePage, /opt_duplicate/);
  assert.match(spriteUtils, /export function computeFrameGrid/);
  assert.match(spriteUtils, /export function buildAnimationsFromEditorState/);
  assert.match(spriteUtils, /const firstCell = row \* frameHeightCells \* sheetCellColumns/);
  assert.match(paletteRenderer, /registerCapability\('palette-editor'/);
  assert.match(paletteRenderer, /deletePceAsset/);
  assert.match(paletteRenderer, /function askDelete\(assetId\)/);
  assert.match(paletteRenderer, /function renderGroupedList\(list, itemRenderer\)/);
  assert.match(paletteRenderer, /assetDisplayName\(asset\)/);
  assert.match(paletteRenderer, /<code>\$\{esc\(asset\.id\)\}<\/code>/);
  assert.match(commonRenderer, /async function pickImageFile\(\)/);
  assert.match(commonRenderer, /filters:\s*\[\{ name: 'PNG \/ BMP \/ WebP'/);
  assert.match(commonRenderer, /const PCE_BG_AUTO_TILE_BASE = 128/);
  assert.match(commonRenderer, /const PCE_BG_AUTO_MAP_BASE = 0/);
  assert.match(commonRenderer, /kind === 'sprite' \? DEFAULT_SPRITE_TILE_BASE : PCE_BG_AUTO_TILE_BASE/);
  assert.match(commonRenderer, /tileBase:\s*kind === 'sprite' \? clampInt\(formEl\.elements\.tileBase\.value, 0, 2047, defaultTileBase\) : PCE_BG_AUTO_TILE_BASE/);
  assert.match(commonRenderer, /mapBase:\s*PCE_BG_AUTO_MAP_BASE/);
  assert.match(commonRenderer, /name="tileBase" type="hidden" value="\$\{PCE_BG_AUTO_TILE_BASE\}"/);
  assert.match(commonRenderer, /openImportSettingsModal/);
  assert.match(commonRenderer, /getImagePipeline/);
  assert.match(commonRenderer, /convertToIndexed16/);
  assert.match(commonRenderer, /importAssetImage/);
  assert.match(commonRenderer, /listPceAssets/);
  assert.match(commonRenderer, /assets:pce:changed/);
  assert.match(commonRenderer, /page:activated/);
  assert.doesNotMatch(commonRenderer, /data-row-preview/);
  assert.doesNotMatch(commonRenderer, /data-action="preview"/);
  assert.doesNotMatch(commonRenderer, /<th>Pal<\/th>/);
  assert.match(commonRenderer, /data-sort-key="name"/);
  assert.match(commonRenderer, /data-sort-key="id"/);
  assert.match(commonRenderer, /function sortedManagedAssets\(\)/);
  assert.match(commonRenderer, /function renderGroupedRows\(list, colSpan, rowRenderer\)/);
  assert.match(commonRenderer, /assetDisplayName\(asset\)/);
  assert.match(commonRenderer, /pce-image-manager-id-cell/);
  assert.match(commonRenderer, /colspan="6"/);
  assert.match(commonRenderer, /data-role="pane-resizer"/);
  assert.match(commonRenderer, /function setupPaneResizer\(\)/);
  assert.match(commonRenderer, /function setupInteractivePreview\(\)/);
  assert.match(commonRenderer, /addEventListener\('wheel',\s*zoomPreview,\s*\{\s*passive:\s*false\s*\}\)/);
  assert.match(commonRenderer, /event\.button !== 1/);
  assert.match(commonRenderer, /localStorage\?\.setItem\(storageKey/);
  assert.match(commonRenderer, /assets = result\.assets \|\| assets/);
  assert.match(commonRenderer, /renderRows\(\);\s*fillForm\(selectedAsset\(\), \{ preview: true \}\)/);
  assert.match(commonRenderer, /previewAssetSource/);
  assert.match(commonRenderer, /data-role="sprite-preview"/);
  assert.match(commonRenderer, /data-role="animation-editor"/);
  assert.match(commonRenderer, /data-animation-field="frameDelay"/);
  assert.match(commonRenderer, /data-animation-field="loop"/);
  assert.match(commonRenderer, /function drawSpritePreviewFrame\(\)/);
  assert.match(commonRenderer, /function toggleSpritePlayback\(\)/);
  assert.match(commonRenderer, /animations:\s*collectAnimationRows\(\)/);
  assert.match(commonRenderer, /options:\s*kind === 'sprite' \? \{ animations: details\.animations \|\| \[\] \} : \{\}/);
  assert.match(commonRenderer, /upsertAsset/);
  assert.match(commonRenderer, /deleteAsset/);
  assert.match(commonRenderer, /registerCapability\(capabilityName/);
  assert.match(commonRenderer, /kind === 'sprite'[\s\S]*Sprite sheet の出力サイズは16px単位/);
  assert.match(commonRenderer, /BG image の出力サイズは8px単位/);
  assert.match(bgCss, /\.pce-image-manager-layout/);
  assert.match(bgCss, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*6px\s*minmax\(300px,\s*430px\)/);
  assert.match(bgCss, /\.pce-image-manager-resizer/);
  assert.match(bgCss, /\.pce-image-manager-sort/);
  assert.match(bgCss, /\.pce-image-manager-id-cell/);
  assert.match(bgCss, /\.pce-image-manager-group-row/);
  assert.match(bgCss, /\.pce-image-manager-table/);
  assert.match(bgCss, /\.pce-image-manager-preview\s*\{[\s\S]*aspect-ratio:\s*1 \/ 1/);
  assert.match(bgCss, /\.pce-image-manager-preview\.is-zoomed/);
  assert.match(spriteCss, /\.pce-image-manager-layout/);
  assert.match(spriteCss, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*6px\s*minmax\(300px,\s*430px\)/);
  assert.match(spriteCss, /\.pce-image-manager-resizer/);
  assert.match(spriteCss, /\.pce-image-manager-sort/);
  assert.match(spriteCss, /\.pce-image-manager-id-cell/);
  assert.match(spriteCss, /\.pce-image-manager-group-row/);
  assert.match(spriteCss, /\.pce-image-manager-table/);
  assert.match(spriteCss, /\.pce-image-manager-preview\s*\{[\s\S]*aspect-ratio:\s*1 \/ 1/);
  assert.match(spriteCss, /\.pce-image-manager-preview\.is-zoomed/);
  assert.match(spriteCss, /\.pce-image-manager-animation-editor/);
  assert.match(spriteCss, /\.pce-image-manager-sprite-preview/);
  assert.match(spriteCss, /\.pce-sprite-editor-root/);
  assert.match(spriteCss, /grid-template-columns:\s*var\(--sprite-left-width\)\s*6px\s*minmax\(320px,\s*1fr\)\s*6px\s*var\(--sprite-right-width\)/);
  assert.match(spriteCss, /\.pce-sprite-editor-column-resizer/);
  assert.match(spriteCss, /\.pce-sprite-editor-preview-stage canvas/);
  assert.match(spriteCss, /\.pce-sprite-editor-sheet-stage canvas/);
  assert.match(spriteCss, /\.pce-sprite-editor-check-toggle/);
  assert.match(spriteCss, /\.pce-sprite-editor-properties \.form-actions-inline/);
  assert.match(spriteCss, /\.pce-sprite-editor-animation-rows/);
  assert.match(paletteCss, /\.pce-palette-editor-shell \.pce-plugin-group/);
  assert.match(appCss, /\.inline-no-preview\[hidden\]\s*\{[\s\S]*display:\s*none !important/);
});

test('PCE visual novel editor does not auto-insert CD-DA playback into new scenes', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.match(renderer, /function defaultDoc\(assets = \[\]\)/);
  assert.doesNotMatch(renderer, /\{\s*\.\.\.defaultCommand\('audio', assets\)/);
  assert.match(renderer, /return \{ type: 'audio', kind: 'cdda', action: 'play', assetId: first\('cdda-track'\), channel: 0 \};/);
});

test('PCE visual novel editor keeps scene deletion in the scene list', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.doesNotMatch(renderer, /data-action="delete-scene"/);
  assert.match(renderer, /data-scene-delete="\$\{esc\(item\.id\)\}"/);
  assert.match(renderer, /function deleteScene\(sceneId = selectedId\)/);
});

test('PCE visual novel preview message skip completes the typewriter page', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const previewRuntimeStart = renderer.indexOf('function previewRuntime()');
  const buildPreviewHtmlStart = renderer.indexOf('function buildPreviewHtml(payload)');
  const showMessageStart = renderer.indexOf('function showMessage(c)');
  const showChoiceStart = renderer.indexOf('function showChoice(c)');
  assert.notEqual(previewRuntimeStart, -1);
  assert.notEqual(buildPreviewHtmlStart, -1);
  assert.notEqual(showMessageStart, -1);
  assert.notEqual(showChoiceStart, -1);
  const previewRuntimeSource = renderer.slice(previewRuntimeStart, buildPreviewHtmlStart);
  const showMessageSource = renderer.slice(showMessageStart, showChoiceStart);

  assert.match(previewRuntimeSource, /const messageWaitGlyph = String\(data\.messageWaitGlyph \|\| '▼'\)/);
  assert.match(previewRuntimeSource, /cursor\.textContent = messageWaitGlyph;/);
  assert.match(showMessageSource, /function complete\(\) \{\n\s+if \(done\) return;\n\s+done = true;\n\s+shownBody = parts\.body\.length;/);
  assert.match(showMessageSource, /if \(typeTimer\) \{ clearInterval\(typeTimer\); typeTimer = null; \}/);
  assert.match(showMessageSource, /paintMsg\(full, color, messageAdvanceMode === 'button'\);/);
  assert.match(showMessageSource, /function revealNextBodyGlyph\(\) \{\n\s+if \(done\) return;/);
  assert.match(showMessageSource, /pending = function \(\) \{ if \(!done\) complete\(\); else \{ if \(c\.voiceAssetId\) stopAudio\('adpcm'\); next\(\); \} \};/);
});

test('PCE visual novel editor exposes resizable panes, command palette, detail editor, and drag ordering', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'style.css'), 'utf-8');

  assert.match(renderer, /data-column-resizer="left"/);
  assert.match(renderer, /data-column-resizer="right"/);
  assert.match(renderer, /function resizeColumns\(event\)/);
  assert.match(renderer, /addEventListener\('pointerdown', resizeColumns\)/);
  assert.match(renderer, /data-role="command-search"/);
  assert.match(renderer, /data-palette-command="\$\{item\.type\}"/);
  assert.match(renderer, /data-palette-add="\$\{item\.type\}"/);
  assert.match(renderer, /data-role="command-preview"/);
  assert.match(renderer, /data-role="command-detail"/);
  assert.match(renderer, /data-script-mode="gui"/);
  assert.match(renderer, /data-script-mode="json"/);
  assert.match(renderer, /data-role="script-json"/);
  assert.match(renderer, /function applyScriptJsonToDoc\(options = \{\}\)/);
  assert.match(renderer, /JSON\.parse\(scriptJsonInput\.value \|\| '\{\}'\)/);
  assert.match(renderer, /doc = normalizeDoc\(parsed, assets\)/);
  assert.match(renderer, /function setEditorMode\(mode\)/);
  assert.match(renderer, /if \(editorMode === 'json'\) \{[\s\S]*applyScriptJsonToDoc\(\{ refreshText: true \}\)/);
  assert.match(renderer, /data-scene-delete="\$\{esc\(item\.id\)\}"/);
  assert.match(renderer, /function deleteScene\(sceneId = selectedId\)/);
  assert.match(renderer, /data-role="scene-name"/);
  assert.match(renderer, /class="pce-vn-edit-sticky"/);
  assert.match(renderer, /function normalizeSceneName\(value\)/);
  assert.match(renderer, /function scenePathParts\(item = \{\}\)/);
  assert.match(renderer, /function sceneDirectoryParts\(item = \{\}\)/);
  assert.match(renderer, /const SCENE_GROUP_COLLAPSE_KEY = 'pce-vn-editor\.sceneGroupCollapse\.v1'/);
  assert.match(renderer, /const COMMAND_LIBRARY_COLLAPSED_KEY = 'pce-vn-editor\.commandLibraryCollapsed\.v1'/);
  assert.match(renderer, /function sceneHasCollapsedAncestor\(dirs = \[\], collapsedDirs = new Set\(\), maxDepth = dirs\.length\)/);
  assert.match(renderer, /function buildSceneListRows\(scenes = \[\], collapsedDirs = new Set\(\)\)/);
  assert.match(renderer, /buildSceneListRows\(doc\.scenes, collapsedSceneGroups\)/);
  assert.match(renderer, /data-scene-group="\$\{esc\(row\.path\)\}"/);
  assert.match(renderer, /data-scene-group-toggle="\$\{esc\(row\.path\)\}"/);
  assert.match(renderer, /aria-expanded="\$\{expanded\}"/);
  assert.match(renderer, /saveCollapsedSceneGroups\(collapsedSceneGroups\)/);
  assert.match(renderer, /pce-vn-scene-group-mark/);
  assert.match(renderer, /data-action="toggle-commands"/);
  assert.match(renderer, /data-role="command-library-toggle"/);
  assert.match(renderer, /const commandLibraryHeader = root\.querySelector\('\[data-role="command-library-toggle"\]'\)/);
  assert.match(renderer, /commandLibraryHeader\?\.addEventListener\('click'/);
  assert.match(renderer, /function applyCommandLibraryState\(\{ persist = false \} = \{\}\)/);
  assert.match(renderer, /classList\.toggle\('is-command-library-collapsed', commandLibraryCollapsed\)/);
  assert.match(renderer, /data-scene-row="\$\{esc\(item\.id\)\}" draggable="true"/);
  assert.match(renderer, /application\/x-pce-vn-scene-id/);
  assert.match(renderer, /function moveScene\(sceneId, rawToIndex\)/);
  assert.match(renderer, /function previewPathForAsset\(asset = \{\}\)/);
  assert.match(renderer, /asset\?\.type === 'cdda-track' && generated\.outputFile/);
  assert.match(renderer, /const ADPCM_END_PAD_SECONDS = 2 \/ 60;/);
  assert.match(renderer, /const BG_FADE_SPEEDS = \[/);
  assert.match(renderer, /const DEFAULT_BG_FADE_FRAMES = 30;/);
  assert.match(renderer, /速度1\(速い\)：10/);
  assert.match(renderer, /速度6\(遅い\)：60/);
  assert.match(renderer, /function bgFadeOptions\(current\)/);
  assert.match(renderer, /name="fadeOutFrames">\$\{bgFadeOptions\(command\.fadeOutFrames\)\}<\/select>/);
  assert.match(renderer, /name="fadeInFrames">\$\{bgFadeOptions\(command\.fadeInFrames\)\}<\/select>/);
  assert.doesNotMatch(renderer, /name="transition"/);
  assert.doesNotMatch(renderer, /<option value="cut"/);
  assert.doesNotMatch(renderer, /name="textSpeedFrames"/);
  assert.doesNotMatch(renderer, /name="advanceMode"/);
  assert.doesNotMatch(renderer, /name="autoWaitFrames"/);
  assert.doesNotMatch(renderer, /name="durationFrames"/);
  assert.doesNotMatch(renderer, /<span class="form-label">Move<\/span>/);
  assert.match(renderer, /function mouthAnimationOptions\(command = \{\}\)/);
  assert.match(renderer, /<span class="form-label">Mouth animation<\/span><select class="form-select" name="mouthAnimationId">\$\{mouthAnimationOptions\(command\)\}<\/select>/);
  assert.match(renderer, /function audioDurationSeconds\(asset = \{\}\)/);
  assert.match(renderer, /byteLength \* 2 \/ sampleRate\) \+ ADPCM_END_PAD_SECONDS/);
  assert.match(renderer, /<span class="form-label">X tile<\/span><input class="form-input" name="x" type="number" min="0" max="63"/);
  assert.match(renderer, /<span class="form-label">Y tile<\/span><input class="form-input" name="y" type="number" min="0" max="31"/);
  assert.match(renderer, /function selectedCommandFromDetail\(existing\)/);
  assert.match(renderer, /async function renderCommandPreview\(\)/);
  assert.match(renderer, /document\.createElement\('audio'\)/);
  assert.match(renderer, /const previewPath = previewPathForAsset\(asset\);[\s\S]*previewPceAssetSource\(previewPath\)/);
  assert.match(renderer, /createPsgPreviewController/);
  assert.match(renderer, /meta\[id\]\.psgOptions = asset\.options \|\| \{\}/);
  assert.match(renderer, /command\.kind === 'psg'[\s\S]*data-psg-command-preview/);
  assert.match(renderer, /function playPsgPreview\(assetId, loop\)/);
  assert.match(renderer, /const kind = c\.kind === 'adpcm' \? 'adpcm' : \(c\.kind === 'psg' \? 'psg' : 'cdda'\)/);
  assert.match(renderer, /document\.createElement\('img'\)/);
  assert.match(renderer, /draggable="true"[\s\S]*data-command-index/);
  assert.match(renderer, /application\/x-pce-vn-command-index/);
  assert.match(renderer, /application\/x-pce-vn-new-command/);
  assert.match(renderer, /function moveCommand\(fromIndex, rawToIndex\)/);
  assert.doesNotMatch(renderer, /type === 'preload'/);
  assert.match(renderer, /type: 'cache', label: 'Cache'/);
  assert.match(renderer, /return \{ type: 'cache', action: 'clear', scope: 'visual', assetId: '', slot: 0, x: 0, y: 0 \};/);
  assert.match(renderer, /function normalizeCacheAction\(value = ''\)/);
  assert.match(renderer, /if \(raw\.type === 'cache'\) \{[\s\S]*action === 'load'[\s\S]*type: 'cache'[\s\S]*action: 'load'[\s\S]*assetId: valid \? asset\.id : ''[\s\S]*action: 'clear'[\s\S]*scope: rawScope/);
  assert.match(renderer, /name="action">\$\{cacheActionOptions\(command\.action\)\}<\/select>/);
  assert.match(renderer, /name="scope">\$\{cacheScopeOptions\(command\.scope\)\}<\/select>/);
  assert.match(renderer, /name="assetId">\$\{optionsFor\(byType\(assetTypes\), command\.assetId, 'なし'\)\}<\/select>/);
  assert.match(renderer, /if \(t === 'cache'\) \{ pc \+= 1; continue; \}/);
  assert.match(renderer, /Load \$\{label\} visual cache \(disabled\)/);
  assert.match(renderer, /Load \$\{label\} ADPCM cache/);
  assert.match(renderer, /Clear \$\{cacheScopeLabel\(command\.scope\)\} cache/);
  assert.match(renderer, /type === 'choice'/);
  assert.match(renderer, /type === 'variable'/);
  assert.match(renderer, /type === 'if'/);
  assert.match(renderer, /type === 'switch'/);
  assert.match(renderer, /type === 'label'/);
  assert.match(renderer, /type === 'goto'/);
  assert.match(renderer, /type === 'jump'/);
  assert.match(renderer, /type === 'wait'/);
  assert.match(renderer, /function playAudio\(kind, assetId, loop\)[\s\S]*new Audio\(data\.urls\[assetId\]\)/);
  assert.match(renderer, /function applyBackground\(c\)/);
  assert.match(renderer, /if \(t === 'background'\) \{ pc \+= 1; applyBackground\(c\); return; \}/);
  assert.match(renderer, /<aside id="pv-debug"><h2>Variables<\/h2><div id="pv-vars"><\/div><\/aside>/);
  assert.match(renderer, /id="pv-debug-vars" type="checkbox" checked/);
  assert.match(renderer, /function setVarDebugVisible\(visible\)/);
  assert.match(renderer, /setVarDebugVisible\(!debugToggle \|\| debugToggle\.checked\)/);
  assert.match(renderer, /function updateVarDebug\(\)/);
  assert.match(renderer, /if \(c\.voiceAssetId\) playAudio\('adpcm', c\.voiceAssetId, false\);/);
  assert.match(renderer, /const voiceSeconds = Number\(voiceMeta\.durationSeconds\) \|\| 0;/);
  assert.match(renderer, /retryAudioPlayback\(\);[\s\S]*if \(e\.target\.closest\('#pv-bar'\)\) return;/);
  assert.match(renderer, /durationSeconds: audioDurationSeconds\(asset\)/);
  assert.match(renderer, /data-switch-add/);
  assert.match(renderer, /data-choice-field="value"/);
  assert.match(renderer, /function labelOptions\(current, label = 'なし'\)/);
  assert.doesNotMatch(renderer, /data-add-command/);
  assert.doesNotMatch(renderer, /data-role="scene-form"|data-role="meta"|class="pce-vn-stage"|pce-vn-meta/);
  assert.doesNotMatch(renderer, /data-command-up|data-command-down|pce-vn-command-head/);
  assert.match(renderer, /<label class="form-group"><span class="form-label">Type<\/span><select class="form-select" name="type"/);
  assert.match(css, /grid-template-columns:\s*var\(--pce-vn-left-width\)\s*5px\s*minmax\(340px,\s*1fr\)\s*5px\s*var\(--pce-vn-right-width\)/);
  assert.match(css, /\.pce-vn-column-resizer/);
  assert.match(css, /\.pce-vn-shell\.is-json-mode/);
  assert.match(css, /\.pce-vn-shell\.is-json-mode \.pce-vn-list/);
  assert.match(css, /\.pce-vn-shell\.is-json-mode \[data-column-resizer="left"\]/);
  assert.match(css, /\.pce-vn-shell\.is-json-mode \.pce-vn-commands/);
  assert.match(css, /\.pce-vn-view-switch/);
  assert.match(css, /\.pce-vn-edit-sticky\s*\{[\s\S]*position:\s*sticky/);
  assert.match(css, /\.pce-vn-edit\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.pce-vn-commands\s*\{[\s\S]*overflow:\s*auto/);
  assert.match(css, /\.pce-vn-script-json textarea/);
  assert.match(css, /\.pce-vn-scene-row/);
  assert.match(css, /\.pce-vn-scene-group/);
  assert.match(css, /\.pce-vn-scene-group\[data-depth="0"\]/);
  assert.match(css, /\.pce-vn-list\.is-command-library-collapsed/);
  assert.match(css, /\.pce-vn-command-library\.is-collapsed \.pce-vn-command-body/);
  assert.match(css, /\.pce-vn-command-toggle-region/);
  assert.match(css, /\.pce-vn-scene-group-chevron/);
  assert.match(css, /\.pce-vn-items \.pce-vn-scene-group-mark/);
  assert.match(css, /\.pce-vn-scene-row\.is-drop-before::before/);
  assert.match(css, /\.pce-vn-scene-row\.is-drop-after::after/);
  assert.match(css, /\.pce-vn-scene-name-field/);
  assert.match(css, /\.pce-vn-scene-delete/);
  assert.match(css, /\.pce-vn-command-palette/);
  assert.match(css, /\.pce-vn-command-preview/);
  assert.match(css, /\.pce-vn-media-preview/);
  assert.match(css, /\.pce-vn-audio-preview audio/);
  assert.match(css, /\.pce-vn-detail-form/);
  assert.match(css, /\.pce-vn-switch-row/);
  assert.match(css, /\.pce-vn-command-dropzone\s*\{[\s\S]*min-height:\s*4px/);
  assert.match(css, /\.pce-vn-command-dropzone\.is-drop-target/);
});

test('Novel plugin integrates VN and Font tools behind one tabbed page', () => {
  const manifest = readPluginManifest('novel-editor');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'novel-editor', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'novel-editor', 'style.css'), 'utf-8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'novel-editor', 'index.js'), 'utf-8');

  assert.equal(manifest.name, 'ノベル');
  assert.equal(manifest.tab.label, 'Novel');
  assert.equal(manifest.tab.page, 'novel-editor');
  assert.equal(manifest.renderer.page, 'novel-editor');
  assert.ok(manifest.hooks.includes('readFontSettings'));
  assert.ok(manifest.mainApi.hooks.includes('generateFont'));
  assert.ok(manifest.renderer.capabilities.includes('novel-editor'));
  assert.ok(manifest.renderer.capabilities.includes('visual-novel-editor'));
  assert.ok(manifest.renderer.capabilities.includes('vn-system-settings'));
  assert.ok(manifest.renderer.capabilities.includes('font-editor'));
  assert.match(renderer, /activateVnEditor/);
  assert.match(renderer, /activateSystemSettings/);
  assert.match(renderer, /activateFontEditor/);
  assert.match(renderer, /label:\s*'スクリプト'/);
  assert.match(renderer, /label:\s*'システム設定'/);
  assert.match(renderer, /label:\s*'Font'/);
  assert.match(renderer, /data-novel-tab/);
  assert.match(renderer, /pluginId:\s*'novel-editor'/);
  assert.match(css, /pce-visual-novel-editor\/style\.css/);
  assert.match(css, /pce-vn-system-settings\/style\.css/);
  assert.match(css, /pce-font-editor\/style\.css/);
  assert.match(index, /readFontSettings/);
  assert.match(index, /generateVnSources/);
});

test('Sound plugin integrates ADPCM, CD-DA, and PSG tools behind one tabbed page', () => {
  const manifest = readPluginManifest('sound-editor');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'sound-editor', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'sound-editor', 'style.css'), 'utf-8');
  const musicRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'renderer.js'), 'utf-8');
  const psgPreview = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'psg-preview.js'), 'utf-8');
  const musicCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'style.css'), 'utf-8');

  assert.equal(manifest.name, 'サウンド');
  assert.equal(manifest.tab.label, 'Sound');
  assert.equal(manifest.tab.page, 'sound-editor');
  assert.equal(manifest.renderer.page, 'sound-editor');
  assert.ok(manifest.dependencies.includes('pce-audio-converter'));
  assert.ok(manifest.renderer.capabilities.includes('sound-editor'));
  assert.ok(manifest.renderer.capabilities.includes('adpcm-manager'));
  assert.ok(manifest.renderer.capabilities.includes('cdda-manager'));
  assert.ok(manifest.renderer.capabilities.includes('psg-music-editor'));
  assert.match(renderer, /activateAdpcmManager/);
  assert.match(renderer, /activateCddaManager/);
  assert.match(renderer, /activatePsgEditor/);
  assert.match(renderer, /label:\s*'ADPCM'/);
  assert.match(renderer, /label:\s*'CD-DA'/);
  assert.match(renderer, /label:\s*'PSG'/);
  assert.match(renderer, /data-sound-tab/);
  assert.match(renderer, /data-sound-panel/);
  assert.match(css, /pce-adpcm-manager\/style\.css/);
  assert.match(css, /pce-cdda-manager\/style\.css/);
  assert.match(css, /pce-music-editor\/style\.css/);
  assert.match(css, /\.tool-tab-button/);
  assert.match(musicRenderer, /function renderGroupedList\(list, itemRenderer\)/);
  assert.match(musicRenderer, /assetDisplayName\(asset\)/);
  assert.match(musicRenderer, /<code>\$\{esc\(asset\.id\)\}<\/code>/);
  assert.match(musicCss, /\.pce-music-editor-shell \.pce-plugin-group/);
  // PSG can register an existing VGM/VGZ/MIDI file in addition to creating a new asset.
  assert.match(musicRenderer, /data-import/);
  assert.match(musicRenderer, /importPceVgm/);
  assert.match(musicRenderer, /importPceMidi/);
  assert.match(musicRenderer, /previewPceMidi/);
  assert.match(musicRenderer, /'vgm', 'vgz', 'mid', 'midi'/);
  assert.match(musicRenderer, /maxToneVoices/);
  assert.match(musicRenderer, /drumMode/);
  assert.match(musicRenderer, /toneVolumeScale/);
  assert.match(musicRenderer, /drumVolumeScale/);
  assert.match(musicRenderer, /minVelocity/);
  assert.match(musicRenderer, /voicePriority/);
  assert.match(musicRenderer, /patternDetail/);
  assert.match(musicRenderer, /data-preview-toggle/);
  assert.match(musicRenderer, /data-delete-id/);
  assert.match(musicRenderer, /data-preview-midi/);
  assert.match(musicRenderer, /createPsgPreviewController/);
  assert.match(psgPreview, /export function expandPsgPreviewStates/);
  assert.match(psgPreview, /function scheduleStep\(\)/);
  assert.match(musicCss, /\.pce-music-midi-controls/);
  assert.match(musicCss, /\.pce-music-list-delete/);
  assert.match(musicCss, /\.pce-tracker-summary/);
});

test('CD-DA manager module exposes track-only import, edit, preview, and reorder UI', () => {
  const manifest = readPluginManifest('pce-cdda-manager');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-cdda-manager', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-cdda-manager', 'style.css'), 'utf-8');

  assert.equal(manifest.hidden, true);
  assert.equal(manifest.tab, undefined);
  assert.equal(manifest.renderer, undefined);
  assert.ok(manifest.dependencies.includes('pce-audio-converter'));
  assert.match(renderer, /CD-DA Tracks/);
  assert.match(renderer, /async function pickAudioFile\(\)/);
  assert.match(renderer, /filters:\s*\[\{ name: 'WAV \/ MP3'/);
  assert.match(renderer, /openImportSettingsModal/);
  assert.match(renderer, /openAudioConvertModal/);
  assert.match(renderer, /kind:\s*'cdda-track'/);
  assert.match(renderer, /importAssetAudio/);
  assert.match(renderer, /previewAssetSource/);
  assert.match(renderer, /data-row-play/);
  assert.match(renderer, /data-row-delete/);
  assert.match(renderer, /draggable="\$\{dragEnabled \? 'true' : 'false'\}"/);
  assert.match(renderer, /data-sort-key="track"/);
  assert.match(renderer, /data-sort-key="id"/);
  assert.match(renderer, /function sortedCddaAssets\(\)/);
  assert.match(renderer, /function canDragReorder\(\)/);
  assert.match(renderer, /function renderGroupedRows\(list, colSpan, rowRenderer\)/);
  assert.match(renderer, /pce-cdda-id-cell/);
  assert.match(renderer, /data-role="pane-resizer"/);
  assert.match(renderer, /function setupPaneResizer\(\)/);
  assert.match(renderer, /localStorage\?\.setItem\(storageKey/);
  assert.match(renderer, /function saveTrackOrder/);
  assert.match(renderer, /track:\s*nextTrack/);
  assert.match(renderer, /index \+ 2/);
  assert.match(renderer, /registerCapability\('cdda-manager'/);
  assert.match(css, /\.pce-cdda-layout/);
  assert.match(css, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*6px\s*minmax\(300px,\s*390px\)/);
  assert.match(css, /\.pce-cdda-resizer/);
  assert.match(css, /\.pce-cdda-sort/);
  assert.match(css, /\.pce-cdda-id-cell/);
  assert.match(css, /\.pce-cdda-group-row/);
  assert.match(css, /\.pce-cdda-row-actions\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.pce-cdda-row-actions \.icon-btn-xs\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(css, /\.pce-cdda-table/);
  assert.match(css, /\.pce-cdda-stats/);
});

test('ADPCM manager module exposes sample-only import, property edit, preview, and delete UI', () => {
  const manifest = readPluginManifest('pce-adpcm-manager');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-adpcm-manager', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-adpcm-manager', 'style.css'), 'utf-8');

  assert.equal(manifest.hidden, true);
  assert.equal(manifest.tab, undefined);
  assert.equal(manifest.renderer, undefined);
  assert.ok(manifest.dependencies.includes('pce-audio-converter'));
  assert.match(renderer, /ADPCM Samples/);
  assert.match(renderer, /async function pickAudioFile\(\)/);
  assert.match(renderer, /filters:\s*\[\{ name: 'WAV \/ MP3'/);
  assert.match(renderer, /openImportSettingsModal/);
  assert.match(renderer, /sampleRateToDivider/);
  assert.match(renderer, /name="adpcmAddress"/);
  assert.match(renderer, /name="divider"/);
  assert.match(renderer, /name="stream"/);
  assert.match(renderer, /name="splitPolicy"/);
  assert.match(renderer, /openAudioConvertModal/);
  assert.match(renderer, /kind:\s*'adpcm'/);
  assert.match(renderer, /importAssetAudio/);
  assert.match(renderer, /stream:\s*details\.stream/);
  assert.match(renderer, /splitPolicy:\s*details\.stream \? '' : \(details\.splitPolicy \? 'auto' : ''\)/);
  assert.match(renderer, /previewAssetSource/);
  assert.match(renderer, /data-row-play/);
  assert.match(renderer, /data-row-delete/);
  assert.match(renderer, /data-sort-key="name"/);
  assert.match(renderer, /data-sort-key="id"/);
  assert.match(renderer, /function sortedAdpcmAssets\(\)/);
  assert.match(renderer, /function renderGroupedRows\(list, colSpan, rowRenderer\)/);
  assert.match(renderer, /assetDisplayName\(asset\)/);
  assert.match(renderer, /pce-adpcm-id-cell/);
  assert.match(renderer, /data-role="pane-resizer"/);
  assert.match(renderer, /function setupPaneResizer\(\)/);
  assert.match(renderer, /localStorage\?\.setItem\(storageKey/);
  assert.match(renderer, /registerCapability\('adpcm-manager'/);
  assert.match(css, /\.pce-adpcm-layout/);
  assert.match(css, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*6px\s*minmax\(320px,\s*420px\)/);
  assert.match(css, /\.pce-adpcm-resizer/);
  assert.match(css, /\.pce-adpcm-sort/);
  assert.match(css, /\.pce-adpcm-id-cell/);
  assert.match(css, /\.pce-adpcm-group-row/);
  assert.match(css, /\.pce-adpcm-row-actions\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.pce-adpcm-row-actions \.icon-btn-xs\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(css, /\.pce-adpcm-table/);
  assert.match(css, /\.pce-adpcm-waveform/);
});

test('code editor exposes advanced tree, preview, encoding, rename, and completion controls', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');
  const css = readRendererFile('style.css');

  assert.doesNotMatch(html, /id="btnOpenSrcFolder"/);
  assert.doesNotMatch(html, /id="btnCodeReload"/);
  assert.match(html, /id="codeTreeFilterInput"/);
  assert.match(html, /placeholder="検索語 \/ 正規表現 \/ glob"/);
  assert.doesNotMatch(html, /placeholder="\*\.c"/);
  assert.match(html, /id="codeEntryModal"/);
  assert.match(html, /id="codeMediaPreview"/);
  assert.match(html, /id="codeEncodingSelect"[\s\S]*value="auto"[\s\S]*value="shift_jis"/);
  assert.match(html, /id="codeCompletionPanel"/);
  assert.match(html, /id="btnCodeFindToggle"/);
  assert.match(html, /id="btnSaveCode"[\s\S]*id="btnCodeDelete"/);
  assert.match(html, /id="codeFindPanel"/);
  assert.match(html, /id="codeFindInput"/);
  assert.match(html, /id="codeReplaceInput"/);
  assert.match(html, /id="btnCodeReplaceAll"/);
  assert.match(html, /id="codeEditor"[\s\S]*wrap="off"/);
  assert.doesNotMatch(html, /id="btnCopyCode"/);
  assert.doesNotMatch(html, /id="codeNewEntryRow"/);

  assert.match(renderer, /promptCreateCodeEntry\('file'\)/);
  assert.match(renderer, /next === 'code'[\s\S]*loadCodeTree\(undefined, \{ refreshOnly: state\.code\.dirty \}\)/);
  assert.doesNotMatch(renderer, /btnOpenSrcFolder/);
  assert.doesNotMatch(renderer, /btnCodeReload/);
  assert.match(renderer, /function renameSelectedCodeEntry\(\)/);
  assert.match(renderer, /renameCodeEntry\?\.\(\{ fromPath, toPath \}\)/);
  assert.match(renderer, /state\.code\.collapsedDirs = collectAllDirPaths\(state\.code\.tree\)/);
  assert.match(renderer, /function getCodeTreeFilter\(\)/);
  assert.match(renderer, /globToRegExp/);
  assert.match(renderer, /result\.previewKind === 'image'/);
  assert.match(renderer, /state\.code\.selectedEncoding/);
  assert.match(renderer, /CODE_COMPLETION_ITEMS/);
  assert.match(renderer, /applyCodeCompletion\(\)/);
  assert.match(renderer, /function updateCodeCursorLine\(\)/);
  assert.match(renderer, /function replaceCurrentCodeMatch\(\)/);
  assert.match(renderer, /function getCodeLines\(content\)/);
  assert.match(renderer, /function wrapHighlightedCodeLines\(highlighted, sourceText\)/);
  assert.match(renderer, /\.join\(''\)/);
  assert.match(renderer, /function updateCodeEditorMetrics\(content\)/);
  assert.match(renderer, /editor\.style\.height = `\$\{minHeight\}px`/);
  assert.match(renderer, /if \(state\.code\.findOpen\) closeCodeFindPanel\(\)/);
  assert.match(css, /\.code-media-preview/);
  assert.match(css, /\.code-completion-panel/);
  assert.match(css, /\.code-tree-filter-input/);
  assert.match(css, /\.code-find-panel/);
  assert.match(css, /\.code-line-number/);
  assert.match(css, /\.code-highlight-line\.cursor-line/);
  assert.match(css, /\.code-highlight-line\.find-line/);
});

test('startup selects the first sidebar plugin and project creation exposes template choice', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="btnProjectPickerOpenFolder"/);
  assert.match(html, /id="btnProjectPickerNew"/);
  assert.match(html, /最近開いたプロジェクト|projectPickerList/);
  assert.match(html, /プロジェクト表示名/);
  assert.doesNotMatch(html, /id="settingAuthor"/);
  assert.doesNotMatch(html, /id="settingSerial"/);
  assert.doesNotMatch(html, /PC Engine ROM ヘッダ/);
  assert.match(html, /id="projectParentDirInput"/);
  assert.match(html, /id="btnProjectParentDirBrowse"/);
  assert.match(html, /id="projectSystemNameInput"[^>]+placeholder="my_pce_game"/);
  assert.match(html, /id="projectTemplateSelect"/);
  assert.doesNotMatch(html, /id="projectCoreSelect"/);
  assert.doesNotMatch(html, /id="projectTitleInput"/);
  assert.doesNotMatch(html, /id="projectAuthorInput"/);
  assert.doesNotMatch(html, /id="projectSerialInput"/);
  assert.match(renderer, /coreId:\s*'pc-engine'/);
  assert.match(renderer, /function normalizeProjectCoreId\(coreId\)/);
  assert.match(renderer, /state\.projectConfig\.coreId = normalizeProjectCoreId\(result\.activeCoreId \|\| state\.projectConfig\.coreId\)/);
  assert.doesNotMatch(renderer, /NEW_PROJECT_DEFAULT_CONFIG/);
  assert.doesNotMatch(renderer, /projectCoreSelect/);
  assert.doesNotMatch(renderer, /projectTitleInput/);
  assert.doesNotMatch(renderer, /projectAuthorInput/);
  assert.doesNotMatch(renderer, /projectSerialInput/);
  assert.match(renderer, /if \(el\.projectSystemNameInput\) el\.projectSystemNameInput\.value = 'my_pce_game'/);
  assert.match(renderer, /const coreId = 'pc-engine'/);
  assert.match(renderer, /const projectTitle = projectName/);
  assert.match(renderer, /platform:\s*'pce'/);
  assert.match(renderer, /romName:\s*projectTitle/);
  assert.match(renderer, /function getFirstSidebarPluginPageId\(\)/);
  assert.match(renderer, /selectedDefaultSidebarPage:\s*false/);
  assert.match(renderer, /switchPage\(getFirstSidebarPluginPageId\(\)\s*\|\|\s*getFirstVisiblePageId\(\)\)/);
  assert.match(renderer, /function resetProjectScopedPluginUiState\(\)/);
  assert.match(renderer, /function isStaticPageAvailableForActiveCore\(pageId\)/);
  assert.match(renderer, /pageId === 'assets'[\s\S]*getActiveCoreId\(\) === 'mega-drive'/);
  assert.doesNotMatch(renderer, /renderResFileList\(\)/);
  assert.match(renderer, /if \(getActiveCoreId\(\) === 'pc-engine'\)[\s\S]*renderResFileSelect\(\)/);
  assert.match(renderer, /async function reloadProjectAfterSwitch\(\)/);
  assert.match(renderer, /resetProjectScopedPluginUiState\(\)/);
  assert.match(renderer, /loadPlugins\(\{\s*resetProjectPluginState:\s*true,\s*resetSidebarSelection:\s*true\s*\}\)/);
  assert.match(renderer, /state\.startup\.selectedDefaultSidebarPage = false/);
  assert.match(renderer, /function populateProjectTemplateSelect\(\)/);
  assert.match(renderer, /SUPER CD-ROM2/);
  assert.match(renderer, /function openProjectFolderFromDialog\(\)/);
  assert.match(renderer, /空のプロジェクト/);
  assert.match(renderer, /parentDir:\s*el\.projectParentDirInput\?\.value\.trim\(\)/);
  assert.match(renderer, /templateId:\s*String\(el\.projectTemplateSelect\?\.value \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(renderer, /payload\.config\.pluginRoles\s*=\s*\{\s*builder:/);
  assert.match(renderer, /openExistingProject\(\{\s*projectDir/s);
  assert.equal((renderer.match(/await reloadProjectAfterSwitch\(\)/g) || []).length, 3);
});

test('sidebar plugin icons prefer manifest icon over tab icon', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="icon-sprite"/);
  assert.match(html, /id="icon-grid"/);
  assert.match(html, /id="icon-music"/);
  assert.match(renderer, /resolvePluginIconId\(plugin\.icon \|\| plugin\.tab\?\.icon\)/);
});

test('default sidebar order prioritizes game editors then core tools', () => {
  const html = readRendererFile('index.html');
  const block = readPluginManifest('block-stage-editor');
  const assets = readPluginManifest('asset-manager');
  const bgm = readPluginManifest('md-bgm-composer');
  const code = readPluginManifest('code-editor');
  const sprites = readPluginManifest('sprite-editor');

  assert.equal(block.tab.order, 5);
  assert.equal(assets.tab.order, 10);
  assert.equal(bgm.tab.order, 20);
  assert.equal(code.tab.order, 30);
  assert.equal(sprites.tab.order, 40);
  assert.ok(block.tab.order < assets.tab.order);
  assert.ok(assets.tab.order < bgm.tab.order);
  assert.ok(bgm.tab.order < code.tab.order);
  assert.ok(html.indexOf('id="sidebarPluginTabs"') < html.indexOf('data-page="plugins"'));
  assert.ok(html.indexOf('data-page="plugins"') < html.indexOf('data-page="settings"'));
});

test('sidebar context menu toggles installed tab plugins', () => {
  const renderer = readRendererFile('renderer.js');
  const css = readRendererFile('style.css');

  assert.match(renderer, /function isSidebarTogglePlugin\(plugin\)/);
  assert.match(renderer, /plugin\?\.tab && plugin\?\.hasRenderer && getPluginRendererPageId\(plugin\)/);
  assert.match(renderer, /function getSidebarTogglePlugins\(\)/);
  assert.match(renderer, /\.filter\(\(plugin\) => pluginSupportsActiveCore\(plugin\) && isSidebarTogglePlugin\(plugin\)\)/);
  assert.match(renderer, /function isDedicatedBuilderEditorPlugin\(plugin\)/);
  assert.match(renderer, /pluginSupportsRole\(candidate,\s*'builder'\)/);
  assert.match(renderer, /pluginHasDependency\(plugin,\s*candidate\.id\)/);
  assert.match(renderer, /pluginHasDependency\(candidate,\s*plugin\.id\)/);
  assert.match(renderer, /function getSidebarContextMenuPlugins\(\)/);
  assert.match(renderer, /const plugins = getSidebarContextMenuPlugins\(\)/);
  assert.match(renderer, /function openSidebarPluginContextMenu\(event\)/);
  assert.match(renderer, /el\.sidebar\?\.addEventListener\('contextmenu',\s*openSidebarPluginContextMenu\)/);
  assert.match(renderer, /data-sidebar-plugin-toggle/);
  assert.match(renderer, /await setPluginEnabledFromUi\(plugin,\s*Boolean\(input\.checked\),\s*input\)/);
  assert.match(renderer, /async function setPluginEnabledFromUi\(plugin,\s*desired,\s*control = null\)/);
  assert.match(renderer, /window\.electronAPI\.setPluginEnabled\(plugin\.id,\s*desired\)/);
  assert.match(css, /\.sidebar-plugin-context-menu/);
  assert.match(css, /\.sidebar-plugin-menu-item/);
});

test('plugin page availability keeps multiple editor plugin pages independent', () => {
  const renderer = readRendererFile('renderer.js');
  const css = readRendererFile('style.css');

  assert.match(renderer, /function getPluginPageDomId\(plugin\)/);
  assert.match(renderer, /return `plugin-\$\{safePluginId\}`/);
  assert.match(renderer, /section\.dataset\.pluginRendererPage = getPluginRendererPageId\(plugin\)/);
  assert.match(renderer, /const pageId = getPluginPageDomId\(plugin\)/);
  assert.match(renderer, /const pageBindings = new Map\(\)/);
  assert.match(renderer, /const pluginById = new Map\(pluginState\.plugins\.map/);
  assert.ok(renderer.includes("document.querySelectorAll('.editor-page[data-plugin-page-owner]')"));
  assert.match(renderer, /section\.dataset\.pluginPageOwner/);
  assert.match(renderer, /getPluginPageDomId\(owner\) === pageId/);
  assert.match(renderer, /section\.hidden = !isStaticPageAvailableForActiveCore\(pageId\)[\s\S]*plugins\.some\(\(plugin\) => pluginSupportsActiveCore\(plugin\) && plugin\.enabled && \(plugin\.hasRenderer \|\| plugin\.tab\)\)/);
  assert.match(renderer, /document\.querySelectorAll\('\.editor-page:not\(\[data-plugin-page-owner\]\)'\)/);
  assert.doesNotMatch(renderer, /pageBindings\.set\(pageId,\s*plugin\)/);
  assert.match(renderer, /function showPluginRendererError\(plugin,\s*root,\s*err\)/);
  assert.match(renderer, /showPluginRendererError\(plugin,\s*root,\s*err\)/);
  assert.match(css, /\.editor-page:not\(\.active\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(css, /\.plugin-renderer-error/);
});

test('startup requires project selection and quits when canceled', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /async function ensureStartupProjectSelection\(\)/);
  assert.match(renderer, /window\.electronAPI\.getProjectStartupState\?\.\(\)/);
  assert.match(renderer, /state\.startup\.projectSelectionRequired = requiresSelection/);
  assert.match(renderer, /const waitingForProject = await ensureStartupProjectSelection\(\)/);
  assert.match(renderer, /if \(waitingForProject\) \{[\s\S]*return;/);
  assert.match(renderer, /function cancelRequiredProjectSelection\(\)/);
  assert.match(renderer, /window\.electronAPI\.quitApp\?\.\(\)/);
  assert.match(renderer, /if \(cancelRequiredProjectSelection\(\)\) return;[\s\S]*closeModal\(el\.projectPickerModal\)/);
  assert.match(renderer, /if \(cancelRequiredProjectSelection\(\)\) return;[\s\S]*closeModal\(el\.projectModal\)/);
});

test('plugin role selectors list installed role plugins regardless of enabled state', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /const plugins = getPluginsByRole\(role\.id\)/);
  assert.match(renderer, /const buildIds = new Set\(getPluginsByRole\('builder'\)\.map\(\(p\) => p\.id\)\)/);
  assert.match(renderer, /const suffix = p\.enabled \? '' : '（無効: 選択時に有効化）'/);
  assert.doesNotMatch(renderer, /const plugins = getEnabledPluginsByRole\(role\.id\)/);
});

test('project settings save through IPC before build structure generation', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /async function persistProjectSettings\(config,\s*\{\s*showMessage\s*=\s*false\s*\}\s*=\s*\{\}\)/);
  assert.match(renderer, /window\.electronAPI\.saveProjectConfig\(config\)/);
  assert.match(renderer, /await persistProjectSettings\(result\.config,\s*\{\s*showMessage:\s*true\s*\}\)/);
  assert.match(renderer, /await persistProjectSettings\(settingsResult\.config\)/);
  assert.match(renderer, /generateStructureOnly\(state\.projectConfig\)/);
});

test('test play rebuilds before opening so ROM header matches project settings', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /async function openTestPlay\(\)/);
  assert.match(renderer, /Test Play 前に差分ビルドします/);
  assert.match(renderer, /const buildResult = await runBuild\(\{\s*skipClean:\s*true\s*\}\)/);
  assert.match(renderer, /window\.electronAPI\.runBuild\(\{\s*skipClean:\s*Boolean\(opts\.skipClean\),\s*\}\)/);
  assert.match(renderer, /return runBuild\(\{\s*\.\.\.opts,\s*_generatedByPlugin:\s*builderPluginId\s*\}\)/);
  assert.match(renderer, /if \(!buildResult\?\.success\)/);
  assert.match(renderer, /const romPath = buildResult\.romPath \|\| state\.lastRomPath/);
});

test('api testplay window exposes default-on sound toggle', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'standard-api-emulator', 'api-testplay.html'),
    'utf-8',
  );

  assert.match(html, /id="btnAudio" class="icon-btn is-active"/);
  assert.match(html, /let audioEnabled = true/);
  assert.match(html, /api\/v1\/audio\/samples\?frames=/);
  assert.match(html, /function fetchAndPlayAudio\(\)/);
  assert.match(html, /await fetchAndPlayAudio\(\)/);
});

test('api testplay toolbar uses icon buttons for primary controls', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'standard-api-emulator', 'api-testplay.html'),
    'utf-8',
  );

  ['btnPlay', 'btnReset', 'btnStep', 'btnAudio', 'btnInfo', 'btnDebug', 'btnStopApi'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}" class="icon-btn`));
  });
  assert.match(html, /<symbol id="icon-pause"/);
  assert.match(html, /<symbol id="icon-volume-off"/);
  assert.match(html, /function setButtonIcon\(button,\s*symbolId\)/);
});

test('api testplay opens a bundled debug viewer with the active API port', () => {
  const pluginDir = path.join(__dirname, '..', 'plugins', 'standard-api-emulator');
  const html = fs.readFileSync(path.join(pluginDir, 'api-testplay.html'), 'utf-8');
  const debugHtml = fs.readFileSync(path.join(pluginDir, 'api-debug.html'), 'utf-8');

  assert.match(html, /id="btnDebug"/);
  assert.match(html, /new URL\('api-debug\.html',\s*window\.location\.href\)/);
  assert.match(html, /debugUrl\.searchParams\.set\('port',\s*String\(port\)\)/);
  assert.match(html, /window\.open\(debugUrl\.href,\s*'md-api-debug'/);
  assert.match(debugHtml, /API Debug Viewer/);
  assert.match(debugHtml, /const initialPort = Number\(params\.get\('port'\)\) \|\| 8080/);
});

test('copy-pkg targets the standard emulator plugin instead of app root pkg', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'copy-pkg.js'), 'utf-8');

  assert.match(script, /standardEmulatorRoot = path\.join\(appRoot,\s*'plugins',\s*'standard-emulator'\)/);
  assert.match(script, /const toPkg = path\.join\(standardEmulatorRoot,\s*'pkg'\)/);
  assert.match(script, /const toWrapper = path\.join\(standardEmulatorRoot,\s*'md-emulator\.js'\)/);
  assert.match(script, /const toPlayer = path\.join\(standardEmulatorRoot,\s*'wasm-player\.js'\)/);
  assert.doesNotMatch(script, /const toPkg = path\.join\(appRoot,\s*'pkg'\)/);
});

test('exclusive role selection reloads plugin state after saving', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /const result = await window\.electronAPI\.setPluginRole\(roleId,\s*nextId\)/);
  assert.match(renderer, /if \(!result\?\.ok\) throw new Error\(result\?\.error \|\| 'unknown'\)/);
  assert.match(renderer, /setPluginRoleStatus\(`✓ \$\{roleId\} プラグイン設定を保存しました`, 'ok'\);[\s\S]*await loadPlugins\(\)/);
});

test('project plugin roles restore plugin enabled state on plugin load', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /async function restoreProjectPluginRoleState\(\)/);
  assert.match(renderer, /for \(const \[roleId,\s*pluginId\] of Object\.entries\(roles\)\)/);
  assert.match(renderer, /window\.electronAPI\.setPluginRole\(roleId,\s*pluginId\)/);
  assert.match(renderer, /pluginState\.plugins = await window\.electronAPI\.listPlugins\(\{\s*includeIncompatible:\s*true\s*\}\)/);
  assert.match(renderer, /await restoreProjectPluginRoleState\(\)/);
});

test('project plugin settings persist non-role enabled state and sidebar order', () => {
  const renderer = readRendererFile('renderer.js');

  assert.match(renderer, /const PROJECT_PLUGIN_STATE_EXCLUDED_ROLES = \['builder', 'testplay'\]/);
  assert.match(renderer, /function isProjectPluginStateManaged\(plugin\)/);
  assert.match(renderer, /!PROJECT_PLUGIN_STATE_EXCLUDED_ROLES\.some\(\(roleId\) => pluginSupportsRole\(plugin,\s*roleId\)\)/);
  assert.match(renderer, /function getProjectPluginEnabledSettings\(\)/);
  assert.match(renderer, /function getCurrentProjectPluginEnabledState\(\)/);
  assert.match(renderer, /\.filter\(\(plugin\) => isProjectPluginStateManaged\(plugin\)\)/);
  assert.match(renderer, /async function restoreProjectPluginEnabledState\(options = \{\}\)/);
  assert.match(renderer, /const resetUnspecified = Boolean\(options\.resetUnspecified\)/);
  assert.match(renderer, /return resetUnspecified \? \[plugin\.id,\s*true\] : null/);
  assert.match(renderer, /window\.electronAPI\.setPluginEnabled\(pluginId,\s*Boolean\(enabled\)\)/);
  assert.match(renderer, /await restoreProjectPluginEnabledState\(\{\s*resetUnspecified:\s*options\.resetProjectPluginState\s*\}\)/);
  assert.match(renderer, /await persistProjectPluginSettings\(\{ enabled: getCurrentProjectPluginEnabledState\(\) \}\)/);
  assert.match(renderer, /persistProjectPluginSettings\(\{ sidebarOrder: pluginState\.sidebarOrder \}\)/);
  assert.match(renderer, /const projectOrder = getProjectPluginSidebarOrder\(\)/);
  assert.match(renderer, /const SIDEBAR_PLUGIN_ID_ALIASES = new Map/);
  assert.match(renderer, /\['pce-font-editor', 'novel-editor'\]/);
  assert.match(renderer, /\['pce-music-editor', 'sound-editor'\]/);
  assert.match(renderer, /\['pce-background-manager', 'image-editor'\]/);
  assert.match(renderer, /\['pce-sprite-manager', 'image-editor'\]/);
  assert.match(renderer, /\['pce-palette-editor', 'image-editor'\]/);
  assert.match(renderer, /function normalizeSidebarPluginIdList\(ids = \[\]\)/);
  assert.match(renderer, /const validIds = new Set\(getSidebarTogglePlugins\(\)\.map\(\(p\) => p\.id\)\)/);
  assert.match(renderer, /state\.projectConfig = \{ \.\.\.state\.projectConfig, \.\.\.cfg, \.\.\.normalized \}/);
  assert.match(renderer, /loadPlugins\(options = \{\}\)/);
  assert.match(renderer, /skipProjectPluginStateRestore/);
});

test('quantize dialog is larger and exposes tone controls', () => {
  const html = readRendererFile('index.html');
  const css = readRendererFile('style.css');
  const renderer = readRendererFile('renderer.js');

  assert.match(css, /\.quantize-panel\s*\{[\s\S]*width:\s*min\(1480px,\s*98vw\)/);
  assert.match(css, /\.quantize-panel\s*\{[\s\S]*height:\s*min\(940px,\s*96vh\)/);
  assert.match(css, /\.quantize-preview-panel canvas\s*\{[\s\S]*min-height:\s*520px/);
  assert.match(html, /id="quantizeBrightness"/);
  assert.match(html, /id="quantizeSaturation"/);
  assert.match(renderer, /function applyQuantizeToneAdjustments\(imageData,\s*options\s*=\s*\{\}\)/);
  assert.match(renderer, /const adjustedData = applyQuantizeToneAdjustments\(quantizeState\.originalData,\s*tone\)/);
  assert.match(renderer, /quantizeToIndexed16\(adjustedData,\s*options\)/);
});

test('quantize converter targets SGDK palette parameters with fast and slow dithering', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="quantizeDitherMode"/);
  assert.match(html, /<option value="fast" selected>Fast<\/option>/);
  assert.match(html, /<option value="slow">Slow<\/option>/);
  assert.match(renderer, /return level \* 36/);
  assert.match(renderer, /function colorImportance\(color\)/);
  assert.match(renderer, /function weightedMedianCutPalette\(colors,\s*maxColors\)/);
  assert.match(renderer, /function refinePaletteKMeans\(colors,\s*initialPalette,\s*maxColors/);
  assert.match(renderer, /function popularDiversePalette\(colors,\s*maxColors\)/);
  assert.match(renderer, /function farthestPointPalette\(colors,\s*maxColors\)/);
  assert.match(renderer, /function chooseOptimizedPalette\(colors,\s*maxColors\)/);
  assert.match(renderer, /const palette = chooseOptimizedPalette\(colors,\s*maxColors\)/);
  assert.match(renderer, /function mapImageToPalette\(imageData,\s*palette,\s*options\s*=\s*\{\}\)/);
  assert.match(renderer, /ditherMode === 'slow'/);
  assert.match(renderer, /7 \/ 16/);
  assert.match(renderer, /const ditherNote = ` \/ dither: \$\{options\.ditherMode\}`/);
});

test('quantize converter previews the resulting palette', () => {
  const html = readRendererFile('index.html');
  const css = readRendererFile('style.css');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="quantizeResultPalette"/);
  assert.match(css, /\.quantize-result-palette\s*\{[\s\S]*grid-template-columns:\s*repeat\(16,/);
  assert.match(renderer, /function renderQuantizeResultPalette\(palette\s*=\s*\[\],\s*transparentIndex\s*=\s*-1\)/);
  assert.match(renderer, /renderQuantizeResultPalette\(converted\.palette,\s*converted\.transparentPaletteIndex\)/);
  assert.match(renderer, /el\.quantizeResultPalette\.innerHTML = ''/);
});
