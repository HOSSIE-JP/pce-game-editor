'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

function readRendererFile(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf-8');
}

function readPluginManifest(pluginId) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', pluginId, 'manifest.json'), 'utf-8'));
}

test('monospace form inputs keep underscore glyphs visible', () => {
  const css = readRendererFile('style.css');

  assert.match(css, /\.form-input-mono\s*\{[\s\S]*font-family:\s*Consolas,\s*"Courier New",\s*monospace;[\s\S]*line-height:\s*1\.5;/);
});

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
  const projectSettings = readRendererFile('project-settings.mjs');

  assert.match(html, /id="externalEmulatorSettings"[\s\S]*外部エミュレーター/);
  assert.match(html, /id="externalEmulatorPath"/);
  assert.match(html, /id="externalEmulatorArgs"/);
  assert.match(renderer, /const EXTERNAL_EMULATOR_PLUGIN_ID = 'pce-external-emulator'/);
  assert.match(projectSettings, /DEFAULT_EXTERNAL_EMULATOR_PATH = '\/Applications\/Geargrafx\.app\/Contents\/MacOS\/geargrafx'/);
  assert.match(renderer, /function updateExternalEmulatorSettingsAvailability\(\)/);
  assert.match(renderer, /activeId === EXTERNAL_EMULATOR_PLUGIN_ID/);
  assert.match(renderer, /config:\s*buildPceProjectSettings\(state\.projectConfig/);
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
  assert.match(html, /HuCard プロジェクトの最後の Build 出力だけを保存できます。CD-ROM2 プロジェクトは Export の対象外です/);
  assert.match(html, /HuCard ROM/);
  assert.match(html, /HuCard の \.pce ファイルとして保存/);
  assert.match(html, /itch\.io HTML5 ZIP/);
  assert.match(html, /HuCard ROM と EmulatorJS を同梱した itch\.io アップロード用 ZIP として保存/);
  assert.match(renderer, /btnSetup:\s*\$\('btnSetup'\)/);
  assert.match(renderer, /btnExport:\s*\$\('btnExport'\)/);
  assert.match(renderer, /el\.btnSetup\?\.addEventListener\('click'[\s\S]*openSetupWindow\(\)/);
  assert.match(renderer, /el\.btnExport\?\.addEventListener\('click',\s*openExportModal\)/);
  assert.match(renderer, /CD-ROM2 プロジェクトは Export の対象外です/);
  assert.match(renderer, /function updateRomOutputActions\(\)[\s\S]*const isHuCard = \/\\\.pce\$\/i\.test/);
  assert.match(renderer, /el\.btnExport\.disabled = !isHuCard/);
  assert.match(renderer, /async function openExportModal\(\)[\s\S]*state\.lastRomPath \|\| \(await window\.electronAPI\.getRomPath\(\)\)/);
  assert.match(renderer, /async function exportLastBuild\(format\)[\s\S]*state\.lastRomPath \|\| \(await window\.electronAPI\.getRomPath\(\)\)/);
  assert.match(renderer, /window\.electronAPI\.exportRom\(\)/);
  assert.match(renderer, /window\.electronAPI\.exportHtml\(\)/);
  assert.match(renderer, /const result = isHtml\s*\? await window\.electronAPI\.exportHtml\(\)\s*: await window\.electronAPI\.exportRom\(\)/);
  assert.match(css, /\.action-btn\.export-btn/);
  assert.match(css, /\.export-choice-grid/);
});

test('setup page exposes only the PCE toolchain and EmulatorJS flow', () => {
  const html = readRendererFile('setup.html');

  assert.match(html, /PC Engine 環境セットアップ/);
  assert.match(html, /llvm-mos-sdk/);
  assert.match(html, /EmulatorJS/);
  assert.match(html, /window\.electronSetup\.downloadTool/);
  assert.doesNotMatch(html, /SGDK|Marsdev|Nuked-OPN2|Emscripten/);
});

test('setup page exposes PCE-CD IPL extraction flow', () => {
  const html = readRendererFile('setup.html');

  assert.match(html, /id="cdImagePath"/);
  assert.match(html, /id="pickCdImage"/);
  assert.match(html, /id="extractIpl"/);
  assert.match(html, /id="ownedSource"/);
  assert.match(html, /data-action="apply"/);
  assert.match(html, /ISO\/CUE\/BIN/);
  assert.match(html, /selectPceCdImage\(\)/);
  assert.match(html, /extractPceCdIpl\(\{ sourcePath, confirmOwnedSource \}\)/);
});

test('About exposes the app license and packaged third-party notices', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="aboutAppAuthor"/);
  assert.match(html, /id="btnAppLicense"[\s\S]*MIT Licenseを開く/);
  assert.match(html, /id="btnThirdPartyNotices"[\s\S]*第三者ライセンスを開く/);
  assert.match(html, /id="aboutLicenseStatus"/);
  assert.match(renderer, /info\.appLicensePath/);
  assert.match(renderer, /info\.appAuthor/);
  assert.match(renderer, /openPathInExplorer\(licensePath\)/);
  assert.match(renderer, /info\.thirdPartyNoticesPath/);
  assert.match(renderer, /openPathInExplorer\(noticePath\)/);
});

test('plugin role accordion starts expanded by default', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');

  assert.match(html, /id="btnPluginRoleAccordion" type="button" aria-expanded="true"/);
  assert.match(html, /class="accordion-body" id="pluginRoleBody"/);
  assert.doesNotMatch(html, /class="accordion-body is-collapsed" id="pluginRoleBody"/);
  assert.match(renderer, /roleAccordionOpen:\s*true/);
});

test('project settings describe display-name-based PCE and CUE output paths', () => {
  const html = readRendererFile('index.html');

  assert.match(html, /出力メディアパス/);
  assert.match(html, /プロジェクト表示名をファイル名にして/);
  assert.match(html, /out\/&lt;表示名&gt;\.pce/);
  assert.match(html, /CD-ROM2 は <code>\.cue<\/code>/);
  assert.doesNotMatch(html, /out\/rom\.bin/);
});

test('log viewer height persists and popout control is wired', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');
  const popoutHtml = readRendererFile('log-viewer.html');
  const popoutRenderer = readRendererFile('log-viewer.js');

  assert.match(html, /id="btnPopoutLog"/);
  assert.match(renderer, /LOG_VIEWER_STATE_KEY\s*=\s*['"]pce-editor\.logViewerState\.v1['"]/);
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

test('static ResComp asset UI is absent while PCE conversion modals remain', () => {
  const html = readRendererFile('index.html');
  const renderer = readRendererFile('renderer.js');
  const css = readRendererFile('style.css');

  assert.doesNotMatch(html, /page-assets|resFileModal|assetModal|Rescomp/);
  assert.doesNotMatch(renderer, /state\.rescomp|loadResDefinitions|writeAssetFile|listResDefinitions/);
  assert.match(html, /id="audioConvertModal"/);
  assert.match(html, /id="resizeModal"/);
  assert.match(html, /id="quantizeModal"/);
  assert.match(renderer, /function openAudioConvertModal/);
  assert.match(renderer, /function openResizeModal/);
  assert.match(renderer, /function openQuantizeModal/);
});

test('quantize palette references use current PCE BG and sprite assets', async () => {
  const renderer = readRendererFile('renderer.js');
  const modulePath = pathToFileURL(path.join(__dirname, '..', 'renderer', 'palette-reference.mjs')).href;
  const { getPaletteReferenceCandidates } = await import(modulePath);
  const assets = [
    { id: 'title', name: 'Title BG', type: 'image', source: 'assets/images/title.png', exists: true },
    { id: 'hero', name: 'Hero', type: 'sprite', source: 'assets/sprites/hero.bmp', exists: true },
    { id: 'voice', name: 'Voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', exists: true },
    { id: 'missing', name: 'Missing', type: 'image', source: 'assets/images/missing.png', exists: false },
    { id: 'webp', name: 'WebP', type: 'image', source: 'assets/images/source.webp', exists: true },
    { id: 'duplicate', name: 'Duplicate', type: 'image', source: 'assets/images/title.png', exists: true },
  ];

  const candidates = getPaletteReferenceCandidates(assets, {
    projectDir: 'C:\\projects\\game',
    excludeSourcePath: 'c:\\PROJECTS\\GAME\\assets\\sprites\\hero.bmp',
  });

  assert.deepEqual(candidates, [{
    sourcePath: 'C:/projects/game/assets/images/title.png',
    label: 'Title BG (assets/images/title.png)',
  }]);
  assert.match(renderer, /import \{ getPaletteReferenceCandidates \} from '\.\/palette-reference\.mjs'/);
  assert.match(renderer, /getPaletteReferenceCandidates\(pceAssetState\.assets,\s*\{[\s\S]*excludeSourcePath,[\s\S]*projectDir: state\.project\.dir/);
});

test('PCE asset manager uses plugin-owned panes and PCE IPC workflow', () => {
  const manifest = readPluginManifest('pce-asset-manager');
  const imageManifest = readPluginManifest('pce-image-converter');
  const audioManifest = readPluginManifest('pce-audio-converter');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'renderer.js'), 'utf-8');
  const batchImporter = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-adpcm-manager', 'adpcm-batch-import.js'), 'utf-8');
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
  assert.match(renderer, /data-action="import-adpcm-batch"[\s\S]*title="CSVからADPCMを一括取込"/);
  assert.match(renderer, /data-role="batch-importer-actions"/);
  assert.match(renderer, /api\.capabilities\.all\('asset-batch-importer'\)/);
  assert.match(renderer, /Number\(right\.priority \|\| 0\) - Number\(left\.priority \|\| 0\)/);
  assert.match(renderer, /supportedMedia\.includes\(projectTargetMedia\)/);
  assert.match(renderer, /provider\.open\(\{[\s\S]*targetMedia: projectTargetMedia,[\s\S]*assets: assets\.slice\(\)/);
  assert.match(renderer, /createAdpcmBatchImporter/);
  assert.match(renderer, /importAdpcmBatchCsv/);
  assert.match(renderer, /data-action="import-cdda"[\s\S]*title="CD-DAを追加"/);
  assert.match(renderer, /PCE_ADPCM_DEFAULT_SAMPLE_RATE\s*=\s*8000/);
  assert.match(renderer, /PCE_ADPCM_SAMPLE_RATES\s*=\s*Object\.freeze\(\[4000, 4571, 5333, 6400, 8000, 10666, 16000, 32000\]\)/);
  assert.match(renderer, /fields\.sampleRate\.value = supportedAdpcmSampleRate\(options\.sampleRate \?\? PCE_ADPCM_DEFAULT_SAMPLE_RATE\)/);
  assert.match(renderer, /<select class="form-select" data-field="sampleRate">\$\{adpcmSampleRateOptions\(\)\}<\/select>/);
  assert.match(renderer, /<select class="form-select" name="sampleRate">\$\{adpcmSampleRateOptions\(\)\}<\/select>/);
  assert.doesNotMatch(renderer, /data-field="stream"/);
  assert.doesNotMatch(renderer, /name="stream"/);
  assert.doesNotMatch(renderer, /form\.elements\.stream/);
  assert.doesNotMatch(renderer, /stream:\s*Boolean/);
  assert.match(renderer, /splitPolicy:\s*kind === 'adpcm' \? 'auto' : ''/);
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
  assert.match(renderer, /data-sort-key="name">Name[\s\S]*data-sort-key="type">Type[\s\S]*<th>Source<\/th>/);
  assert.match(renderer, /data-tree-depth="\$\{depth\}"/);
  assert.match(renderer, /class="asset-tree-name-cell" style="padding-left:\$\{treeIndent\}px"/);
  assert.match(renderer, /<td class="asset-drag-cell"><span[\s\S]*<td class="asset-tree-name-cell"[\s\S]*<td><span class="asset-type-pill[\s\S]*<td class="asset-path-cell"/);
  assert.match(renderer, /<td class="asset-drag-cell"><\/td>\s*<td colspan="6" class="asset-group-cell"/);
  assert.match(renderer, /async function pickAudioInputFile\(\)/);
  assert.match(renderer, /const initialFile = importFile\?\.sourcePath[\s\S]*await pickAudioInputFile\(\)/);
  assert.match(renderer, /audio-convert-ui/);
  assert.match(renderer, /openAudioConvertModal/);
  assert.match(renderer, /WAV \/ MP3/);
  assert.match(renderer, /previewAssetSource/);
  assert.match(renderer, /reorderAssets/);
  assert.match(renderer, /asset-import-handler/);
  assert.match(batchImporter, /inspectPceAdpcmBatch/);
  assert.match(batchImporter, /importPceAdpcmBatch/);
  assert.match(batchImporter, /cancelPceAdpcmBatch/);
  assert.match(batchImporter, /onAssetAdpcmBatchProgress/);
  assert.match(batchImporter, /sourceRoot: inspection\.sourceRoot \|\| ''/);
  assert.match(batchImporter, /properties: \['openDirectory'\]/);
  assert.match(batchImporter, /WAVルート（任意）/);
  assert.match(batchImporter, /有効な行/);
  assert.match(batchImporter, /残りをキャンセル/);
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
  assert.match(spritePage, /data-row-resizer="preview"/);
  assert.match(spritePage, /data-row-resizer="animation"/);
  assert.match(spritePage, /--sprite-animation-height:\$\{layout\.animation\}px/);
  assert.match(spritePage, /layout\.animation = clampInt\(startHeight - deltaY/);
  assert.match(spritePage, /function setupRowResizers\(\)/);
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
  assert.match(commonRenderer, /function buildAssetGroupTree\(list = \[\]\)/);
  assert.match(commonRenderer, /const collapsedGroups = new Set\(\)/);
  assert.match(commonRenderer, /data-group-path="\$\{esc\(child\.path\)\}"/);
  assert.match(commonRenderer, /pce-image-manager-group-toggle/);
  assert.match(commonRenderer, /collapsedGroups\.has\(path\)\s*\?\s*collapsedGroups\.delete\(path\)\s*:\s*collapsedGroups\.add\(path\)|collapsedGroups\.delete\(path\)/);
  assert.match(commonRenderer, /assetDisplayName\(asset\)/);
  assert.match(commonRenderer, /pce-image-manager-id-cell/);
  assert.match(commonRenderer, /renderGroupedRows\(list, 6,/);
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
  assert.match(bgCss, /\.pce-image-manager-group-toggle/);
  assert.match(bgCss, /\.pce-image-manager-group-row\s*\{[\s\S]*cursor:\s*pointer/);
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
  assert.match(spriteCss, /grid-template-rows:\s*var\(--sprite-preview-height\)\s*6px\s*minmax\(180px,\s*1fr\)\s*6px\s*var\(--sprite-animation-height\)/);
  assert.match(spriteCss, /\.pce-sprite-editor-column-resizer/);
  assert.match(spriteCss, /\.pce-sprite-editor-row-resizer/);
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

test('PCE visual novel editor exposes independent System Card PSG stop targets', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.match(renderer, /command\.kind === 'psg' && command\.action === 'stop'/);
  assert.match(renderer, /<span class="form-label">停止対象<\/span>/);
  assert.match(renderer, /<option value="all"/);
  assert.match(renderer, /<option value="bgm"/);
  assert.match(renderer, /<option value="sfx"/);
  assert.match(renderer, /target: detailForm\.elements\.target\?\.value \|\| 'all'/);
  assert.match(renderer, /kind === 'psg' && action === 'stop'[\s\S]*target: raw\.target === 'bgm' \|\| raw\.target === 'sfx' \? raw\.target : 'all'/);
});

test('PCE visual novel editor exposes synchronous and concurrent sprite movement', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.match(renderer, /type: 'spritemove', label: 'Sprite Move'/);
  assert.match(renderer, /return \{ type: 'spritemove', slot: 0, x: 128, y: DEFAULT_CHARACTER_Y, frames: 30, async: false/);
  assert.match(renderer, /<span class="form-label">Target X<\/span>/);
  assert.match(renderer, /name="frames" type="number" min="1" max="65535"/);
  assert.match(renderer, /name="async" type="checkbox"/);
  assert.match(renderer, /function spriteMoveAnimationOptions\(command = \{\}\)/);
  assert.match(renderer, /const spriteMoveTimers = new Map\(\)/);
  assert.match(renderer, /function startSpriteMove\(c, onComplete\)/);
  assert.match(renderer, /if \(c\.async\)[\s\S]*startSpriteMove\(c, null\)/);
  assert.match(renderer, /startSpriteMove\(c, run\)/);
  assert.match(renderer, /cancelAllSpriteMoves\(\)/);
});

test('PCE visual novel editor previews hardware sprites and SpriteText in Full BG scenes', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const visualStateStart = renderer.indexOf('function computeVisualState(');
  const previewRuntimeStart = renderer.indexOf('function previewRuntime()');
  const visualStateSource = renderer.slice(visualStateStart, previewRuntimeStart);
  assert.match(visualStateSource, /command\.type === 'sprite'\) \{/);
  assert.match(visualStateSource, /command\.type === 'spritemove'\) \{/);
  assert.match(visualStateSource, /command\.type === 'spritetext'\) \{/);
  assert.doesNotMatch(visualStateSource, /command\.type === 'spritetext' && !fullScreenBg/);

  const spriteRunStart = renderer.indexOf("      if (t === 'sprite') {", previewRuntimeStart);
  const spriteTextRunStart = renderer.indexOf("      if (t === 'spritetext') {", spriteRunStart);
  const spriteRunSource = renderer.slice(spriteRunStart, spriteTextRunStart);
  assert.doesNotMatch(spriteRunSource, /scene\.fullScreenBg/);
  assert.match(spriteRunSource, /if \(!state\.sprites\[c\.slot\]\) \{ pc \+= 1; continue; \}/);
  const spriteTextRunEnd = renderer.indexOf("      if (t === 'audio') {", spriteTextRunStart);
  assert.doesNotMatch(renderer.slice(spriteTextRunStart, spriteTextRunEnd), /scene\.fullScreenBg/);
});

test('PCE visual novel editor estimates the target-specific scene pack contract', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.match(renderer, /const VN_CD_SCENE_PACK_LIMIT = 8192;/);
  assert.match(renderer, /const VN_HUCARD_SCENE_PACK_LIMIT = 8192;/);
  assert.match(renderer, /readCodeFile\(\{ path: 'project\.json' \}\)/);
  assert.match(renderer, /vnScenePackLimit = hucard \? VN_HUCARD_SCENE_PACK_LIMIT : VN_CD_SCENE_PACK_LIMIT/);
  assert.match(renderer, /\(glyphs \+ 1\) \* \(vnScenePackUsesShiftJis \? 2 : 1\)/);
});

test('PCE visual novel editor keeps scene deletion in the scene list', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.doesNotMatch(renderer, /data-action="delete-scene"/);
  assert.match(renderer, /data-scene-delete="\$\{esc\(item\.id\)\}"/);
  assert.match(renderer, /function deleteScene\(sceneId = selectedId\)/);
});

test('PCE visual novel editor preserves underscores while typing a scene ID', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');

  assert.match(renderer, /data-role="scene-id"[\s\S]*maxlength="32"/);
  assert.doesNotMatch(renderer, /sceneIdInput\?\.addEventListener\('input'/);
  assert.doesNotMatch(renderer, /\.value\s*=\s*safeId\(/);
  assert.match(renderer, /sceneIdInput\?\.addEventListener\('change',[\s\S]*renameSceneId\(sceneIdInput\.value\)/);
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
  assert.match(previewRuntimeSource, /const messageAutoGlyph = String\(data\.messageAutoGlyph \|\| '◆'\)/);
  assert.match(previewRuntimeSource, /cursor\.textContent = indicatorGlyph;/);
  assert.match(showMessageSource, /function complete\(\) \{\r?\n\s+if \(done\) return;\r?\n\s+done = true;\r?\n\s+shownBody = parts\.body\.length;/);
  assert.match(showMessageSource, /if \(typeTimer\) \{ clearInterval\(typeTimer\); typeTimer = null; \}/);
  assert.match(showMessageSource, /const autoEnabled = getVar\('AUTO_ENABLE'\) === 1;/);
  assert.match(showMessageSource, /paintMsg\(full, color, autoEnabled \? messageAutoGlyph : messageWaitGlyph, !autoEnabled\);/);
  assert.match(showMessageSource, /function revealNextBodyGlyph\(\) \{\r?\n\s+if \(done\) return;/);
  assert.match(showMessageSource, /pending = function \(\) \{ if \(!done\) complete\(\); else next\(Boolean\(c\.voiceAssetId\)\); \};/);
});

test('PCE visual novel preview exposes reserved AUTO and message-speed variables', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const systemSettings = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-system-settings', 'renderer.js'), 'utf-8');

  assert.match(renderer, /const variableInitialValues = \{\s*AUTO_ENABLE: messageAdvanceMode === 'auto' \? 1 : 0,\s*MSG_SPEED: 0,/);
  assert.match(renderer, /const variableNames = \['AUTO_ENABLE', 'MSG_SPEED'\];/);
  assert.match(renderer, /if \(name === 'AUTO_ENABLE'\) return Math\.max\(0, Math\.min\(1, normalized\)\);/);
  assert.match(renderer, /if \(name === 'MSG_SPEED'\) return Math\.max\(0, Math\.min\(6, normalized\)\);/);
  assert.match(renderer, /if \(isDefinition && !reserved\) variableInitialValues\[key\] = s16\(initialValue\);/);
  assert.match(renderer, /if \(c\.operation === 'define' \|\| c\.operation === 'set'\) setVar\(n, c\.value\);/);
  assert.match(renderer, /setVar\(c\.variableName, ch\.value\);/);
  assert.match(renderer, /const speedLevel = getVar\('MSG_SPEED'\);/);
  assert.match(renderer, /messageSpeedFrameOptions\[speedLevel - 1\]/);
  assert.match(renderer, /if \(controllerButton === 'select'\) \{[\s\S]*if \(!e\.repeat\) toggleAutoEnable\(\);[\s\S]*return;/);
  assert.doesNotMatch(renderer.slice(renderer.indexOf('const INPUT_BUTTONS = ['), renderer.indexOf('const INPUT_BUTTON_KEYS')), /key: 'select'/);
  assert.match(renderer, /list="pce-vn-reserved-variable-names"/);
  assert.match(renderer, /予約変数（大文字・完全一致）: AUTO_ENABLE は0\.\.1、MSG_SPEED は0\.\.6/);
  assert.match(renderer, /a\.addEventListener\('ended', \(\) => \{\s*if \(audio\[kind\] !== a\) return;/);
  assert.match(renderer, /a\.addEventListener\('error', \(\) => \{\s*if \(audio\[kind\] !== a\) return;/);
  assert.match(systemSettings, /メッセージ速度（MSG_SPEED=0時）/);
  assert.match(systemSettings, /Advance（AUTO_ENABLE初期値）/);
  assert.doesNotMatch(systemSettings, /messageAutoWaitFrames\.disabled/);
});

test('PCE visual novel editor exposes resizable panes, command palette, detail editor, and drag ordering', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'style.css'), 'utf-8');

  assert.match(renderer, /data-column-resizer="left"/);
  assert.match(renderer, /data-column-resizer="right"/);
  assert.match(renderer, /function resizeColumns\(event\)/);
  assert.match(renderer, /addEventListener\('pointerdown', resizeColumns\)/);
  assert.match(renderer, /data-role="command-search"/);
  assert.match(renderer, /data-role="command-list-search"/);
  assert.match(renderer, /placeholder="シーン内コマンド検索"/);
  assert.match(renderer, /const commandListSearchInput = root\.querySelector\('\[data-role="command-list-search"\]'\)/);
  assert.match(renderer, /let commandListSearch = '';/);
  assert.match(renderer, /function addAssetSearchText\(parts, assetId\)/);
  assert.match(renderer, /function commandListSearchText\(command\)/);
  assert.match(renderer, /function commandMatchesListSearch\(command\)/);
  assert.match(renderer, /command\.type,[\s\S]*definition\.label,[\s\S]*definition\.category,[\s\S]*definition\.description,[\s\S]*commandSummary\(command\)/);
  assert.match(renderer, /addAssetSearchText\(parts, command\.assetId\)/);
  assert.match(renderer, /parts\.push\(command\.speaker \|\| '', command\.text \|\| ''\)/);
  assert.match(renderer, /commandListSearchInput\?\.addEventListener\('input'[\s\S]*commandListSearch = commandListSearchInput\.value;[\s\S]*renderCommands\(scene\(\)\)/);
  assert.match(renderer, /\.filter\(\(\{ command \}\) => commandMatchesListSearch\(command\)\)/);
  assert.match(renderer, /data-palette-command="\$\{item\.type\}"/);
  assert.match(renderer, /data-palette-add="\$\{item\.type\}"/);
  assert.match(renderer, /data-role="command-preview"/);
  assert.match(renderer, /data-role="command-detail"/);
  // Cache command shows an image preview of the targeted BG/sprite asset.
  assert.match(renderer, /command\.type === 'cache'/);
  assert.match(renderer, /pce-vn-cache-preview/);
  // Editor-only comment command with a fixed (non-configurable) highlight color.
  assert.match(renderer, /type: 'comment', label: 'Comment'/);
  assert.match(renderer, /\{ type: 'comment', text: '' \}/);
  assert.doesNotMatch(renderer, /name="commentColorHex"/);
  // Command list rows and palette are color-coded by command category.
  assert.match(renderer, /const CATEGORY_COLORS = \{/);
  assert.match(renderer, /function categoryColor\(category\)/);
  assert.match(renderer, /function readableTextColor/);
  assert.match(renderer, /categoryColor\(definition\.category\)/);
  assert.match(renderer, /--row-fg:/);
  assert.match(renderer, /--cat-color:/);
  assert.match(css, /--row-fg/);
  assert.match(css, /--cat-color/);
  assert.match(css, /\.pce-vn-shell\.is-json-mode \.pce-vn-command-list-search/);
  assert.match(css, /\.pce-vn-command-list-search\s*\{[\s\S]*flex:\s*1 1 260px/);
  assert.match(css, /\.pce-vn-stage\s*\{[\s\S]*width:\s*256px;[\s\S]*height:\s*224px/);
  assert.match(css, /\.pce-vn-cache-preview/);
  assert.match(renderer, /data-script-mode="gui"/);
  assert.match(renderer, /data-script-mode="json"/);
  assert.match(renderer, /data-role="script-json"/);
  assert.match(renderer, /function applyScriptJsonToDoc\(options = \{\}\)/);
  assert.match(renderer, /JSON\.parse\(scriptJsonInput\.value \|\| '\{\}'\)/);
  assert.match(renderer, /doc = normalizeDoc\(parsed, assets\)/);
  assert.doesNotMatch(renderer, /function legacyCommands/);
  assert.doesNotMatch(renderer, /backgroundAssetId\) commands\.push/);
  assert.match(renderer, /function setEditorMode\(mode\)/);
  assert.match(renderer, /if \(editorMode === 'json'\) \{[\s\S]*applyScriptJsonToDoc\(\{ refreshText: true \}\)/);
  assert.match(renderer, /data-scene-delete="\$\{esc\(item\.id\)\}"/);
  assert.match(renderer, /function deleteScene\(sceneId = selectedId\)/);
  assert.match(renderer, /data-role="scene-name"/);
  assert.match(renderer, /data-role="scene-id"/);
  // Start scene is chosen via a per-scene ★ toggle in the list, not a dropdown.
  assert.doesNotMatch(renderer, /data-role="scene-start"/);
  assert.match(renderer, /data-scene-start-toggle="\$\{esc\(item\.id\)\}"/);
  assert.match(renderer, /function uniqueSceneId\(value, existingIds = \[\], fallback = 'scene'\)/);
  assert.match(renderer, /const startScene = safeId\(doc\?\.startScene, ''\);/);
  assert.match(renderer, /startScene: sceneIds\.has\(startScene\) \? startScene : deduped\[0\]\?\.id \|\| 'opening'/);
  assert.match(renderer, /function renameSceneId\(rawId\)/);
  assert.match(renderer, /function updateSceneReferences\(oldId, newId\)/);
  assert.match(renderer, /command\.type === 'jump' && command\.sceneId === oldId/);
  assert.match(renderer, /choice\.targetSceneId === oldId/);
  assert.match(renderer, /doc\.startScene = id;/);
  assert.doesNotMatch(renderer, /<span class="pce-vn-mode-badge">Start<\/span>/);
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
  assert.match(renderer, /function previewPathCandidatesForAsset\(asset = \{\}\)/);
  assert.match(renderer, /function previewSourceFromGeneratedMetadata\(asset = \{\}\)/);
  assert.match(renderer, /const generatedSource = await previewSourceFromGeneratedMetadata\(asset\)/);
  assert.match(renderer, /assetDataUrlCache\.set\(asset\.id, url\)/);
  assert.match(renderer, /assetDataUrlCache\.delete\(asset\.id\)/);
  assert.match(renderer, /asset\?\.type === 'cdda-track'[\s\S]*push\(generated\.outputFile\)/);
  assert.match(renderer, /const ADPCM_END_PAD_SECONDS = 2 \/ 60;/);
  assert.match(renderer, /const BG_FADE_SPEEDS = \[/);
  assert.match(renderer, /const DEFAULT_BG_FADE_FRAMES = 30;/);
  assert.match(renderer, /速度1\(即時\)：1/);
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
  assert.doesNotMatch(renderer, /function mouthAnimationOptions\(command = \{\}\)|name="mouthAnimationId"|Mouth animation/);
  assert.match(renderer, /<span class="form-label">Mouth slot<\/span><select class="form-select" name="mouthSlot"><option value="" \$\{command\.mouthSlot == null \? 'selected' : ''\}>なし（ナレーション）<\/option>/);
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
  assert.match(renderer, /meta\[id\]\.psgPatternBytes = psgPatternPreviewBytes\(asset\)/);
  assert.match(renderer, /const kind = c\.kind === 'adpcm' \? 'adpcm' : \(c\.kind === 'psg' \? 'psg' : 'cdda'\)/);
  assert.match(renderer, /document\.createElement\('img'\)/);
  assert.match(renderer, /draggable="true"[\s\S]*data-command-index/);
  assert.match(renderer, /application\/x-pce-vn-command-index/);
  assert.match(renderer, /application\/x-pce-vn-new-command/);
  assert.match(renderer, /function moveCommand\(fromIndex, rawToIndex\)/);
  assert.doesNotMatch(renderer, /type === 'preload'/);
  assert.match(renderer, /type: 'cache', label: 'Cache'/);
  assert.match(renderer, /\{ value: 'psg', label: 'PSG' \}/);
  assert.match(renderer, /return \{ type: 'cache', action: 'clear', scope: 'visual', assetId: '', slot: 0, x: 0, y: 0 \};/);
  assert.match(renderer, /function normalizeCacheAction\(value = ''\)/);
  assert.match(renderer, /scope === 'psg' && \(asset\?\.type === 'psg-song' \|\| asset\?\.type === 'psg-sfx'\)/);
  assert.match(renderer, /if \(raw\.type === 'cache'\) \{[\s\S]*action === 'load'[\s\S]*type: 'cache'[\s\S]*action: 'load'[\s\S]*assetId: valid \? asset\.id : ''[\s\S]*action: 'clear'[\s\S]*scope: rawScope/);
  assert.match(renderer, /name="action">\$\{cacheActionOptions\(command\.action\)\}<\/select>/);
  assert.match(renderer, /name="scope">\$\{cacheScopeOptions\(command\.scope\)\}<\/select>/);
  assert.match(renderer, /name="assetId">\$\{optionsFor\(byType\(assetTypes\), command\.assetId, 'なし'\)\}<\/select>/);
  assert.match(renderer, /scope === 'psg' \? \['psg-song', 'psg-sfx'\] : \['image'\]/);
  assert.match(renderer, /if \(t === 'cache'\) \{ handleCacheCommand\(c\); pc \+= 1; continue; \}/);
  assert.match(renderer, /const VN_VISUAL_CACHE_PAGE_BYTES = 8192;/);
  assert.match(renderer, /const VN_VISUAL_CACHE_PAGE_COUNT = 16;/);
  assert.match(renderer, /function visualCachePayloadInfo\(asset = \{\}\)/);
  assert.match(renderer, /meta\[id\]\.visualCacheParts = visualCache\.parts;/);
  assert.match(renderer, /scenePackBytesById: Object\.fromEntries\(snapshot\.scenes\.map/);
  assert.match(renderer, /function handleCacheCommand\(c\)/);
  assert.match(renderer, /function loadPsgCacheAsset\(assetId, labelPrefix\)/);
  assert.match(renderer, /function updateCacheDebug\(\)/);
  assert.match(renderer, /meterRow\('PSG pattern', psgUsed, 16 \* 1024/);
  assert.match(renderer, /recordVisualDisplay\(c\.assetId, 'bg', 'BG'\)/);
  assert.match(renderer, /recordVisualDisplay\(c\.assetId, 'sprite', 'Sprite'\)/);
  assert.match(renderer, /Load \$\{label\} visual RAM cache/);
  assert.match(renderer, /Load \$\{label\} ADPCM cache/);
  assert.match(renderer, /Load \$\{label\} PSG cache/);
  assert.match(renderer, /Clear \$\{cacheScopeLabel\(command\.scope\)\} cache/);
  assert.match(renderer, /type === 'choice'/);
  assert.match(renderer, /type === 'variable'/);
  assert.match(renderer, /type === 'if'/);
  assert.match(renderer, /type === 'switch'/);
  assert.match(renderer, /type === 'label'/);
  assert.match(renderer, /type === 'goto'/);
  assert.match(renderer, /type === 'jump'/);
  assert.match(renderer, /type === 'wait'/);
  assert.match(renderer, /function playAudio\(kind, assetId, loop, onEnded, onError\)[\s\S]*new Audio\(data\.urls\[assetId\]\)/);
  assert.match(renderer, /function applyBackground\(c\)/);
  assert.match(renderer, /function backgroundCommandMatchesDisplay\(c\)/);
  assert.match(renderer, /function spriteCommandMatchesDisplay\(c\)/);
  assert.match(renderer, /if \(t === 'background'\) \{[\s\S]*if \(backgroundCommandMatchesDisplay\(c\)\) continue;[\s\S]*recordVisualDisplay\(c\.assetId, 'bg', 'BG'\);[\s\S]*applyBackground\(c\);/);
  assert.match(renderer, /if \(t === 'sprite'\) \{[\s\S]*if \(spriteCommandMatchesDisplay\(c\)\) \{ pc \+= 1; continue; \}[\s\S]*renderStage\(\);/);
  assert.match(renderer, /<aside id="pv-debug" class="pv-hidden"><section><h2>Variables<\/h2><div id="pv-vars"><\/div><\/section><section><h2>Cache<\/h2><div id="pv-cache"><\/div><\/section><\/aside>/);
  assert.match(renderer, /id="pv-debug-vars" type="checkbox" \/>/);
  assert.match(renderer, /id="pv-fast-forward" type="checkbox" \/>/);
  assert.match(renderer, /const cacheBox = root\.querySelector\('#pv-cache'\)/);
  assert.match(renderer, /function setVarDebugVisible\(visible\)/);
  assert.match(renderer, /setVarDebugVisible\(Boolean\(debugToggle\?\.checked\)\)/);
  assert.match(renderer, /let messageFastForward = false;/);
  assert.match(renderer, /function setMessageFastForward\(enabled\)/);
  assert.match(renderer, /voiceStarted = Boolean\(playAudio\('adpcm', c\.voiceAssetId, voiceLoop,/);
  assert.match(renderer, /const speedLevel = getVar\('MSG_SPEED'\);/);
  assert.match(renderer, /const speed = messageFastForward \? 0 : speedFrames \* 1000 \/ 60;/);
  assert.match(renderer, /if \(messageFastForward \|\| speed <= 0 \|\| !parts\.body\) complete\(\);/);
  assert.match(renderer, /function updateVarDebug\(\)/);
  assert.match(renderer, /if \(c\.voiceAssetId\) \{[\s\S]*recordAdpcmUse\(c\.voiceAssetId, 'Message voice'\);[\s\S]*voiceStarted = Boolean\(playAudio\('adpcm', c\.voiceAssetId, voiceLoop,/);
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
  assert.match(css, /\.pce-vn-scene-id-field/);
  assert.match(css, /\.pce-vn-scene-start-toggle/);
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

test('PCE visual novel JSON editor uses only the textarea scrollbar', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'style.css'), 'utf-8');

  assert.match(css, /\.pce-vn-script-json\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?\}/);
  assert.match(css, /\.pce-vn-script-json textarea\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?resize:\s*none;[\s\S]*?overflow:\s*auto;[\s\S]*?\}/);
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
  assert.ok(manifest.hooks.includes('importFontFile'));
  assert.ok(manifest.hooks.includes('deleteFontFile'));
  assert.ok(manifest.mainApi.hooks.includes('importFontFile'));
  assert.ok(manifest.mainApi.hooks.includes('deleteFontFile'));
  assert.ok(manifest.renderer.capabilities.includes('novel-editor'));
  assert.ok(manifest.renderer.capabilities.includes('visual-novel-editor'));
  assert.ok(manifest.renderer.capabilities.includes('vn-system-settings'));
  assert.ok(manifest.renderer.capabilities.includes('font-editor'));
  assert.match(renderer, /activateVnEditor/);
  assert.match(renderer, /activateSystemSettings/);
  assert.match(renderer, /activateFontEditor/);
  assert.match(renderer, /label:\s*'スクリプト'/);
  assert.match(renderer, /label:\s*'システム設定'/);
  assert.match(renderer, /label:\s*'フォント'/);
  assert.match(renderer, /data-novel-tab/);
  assert.match(renderer, /pluginId:\s*'novel-editor'/);
  assert.match(css, /pce-visual-novel-editor\/style\.css/);
  assert.match(css, /pce-vn-system-settings\/style\.css/);
  assert.match(css, /pce-font-editor\/style\.css/);
  assert.match(index, /readFontSettings/);
  assert.match(index, /generateVnSources/);
  assert.match(index, /importFontFile/);
  assert.match(index, /deleteFontFile/);

  const vnRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const vnCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'style.css'), 'utf-8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  assert.match(vnRenderer, /data-action="export-irodori"/);
  assert.match(vnRenderer, /data-action="apply-irodori"/);
  assert.match(vnRenderer, /export function activatePlugin\(\{ root, api, logger, registerCapability \}\)/);
  assert.match(vnRenderer, /async function exportIrodoriBatch\(\)/);
  assert.match(vnRenderer, /data-role="plugin-actions-before-preview"/);
  assert.match(vnRenderer, /data-role="plugin-actions-after-preview"/);
  assert.match(vnRenderer, /api\.capabilities\.all\('novel-toolbar-action'\)/);
  assert.match(vnRenderer, /data-novel-toolbar-action/);
  assert.match(vnRenderer, /supportedMedia\.length && !supportedMedia\.includes\(targetMedia\)/);
  assert.match(vnRenderer, /const result = await provider\.run\(\{/);
  assert.match(vnRenderer, /getSnapshot: \(options\) => normalizedSceneSnapshot\(options\)/);
  assert.match(vnRenderer, /saveSnapshot: \(snapshot\) => persistSceneSnapshot\(snapshot\)/);
  assert.match(vnRenderer, /applyDocument: \(nextDoc, options\) => applyPluginSceneDocument\(nextDoc, options\)/);
  assert.match(vnRenderer, /detail\?\.capability === 'novel-toolbar-action'/);
  assert.match(vnRenderer, /offPluginToolbarCapabilityRegistered\(\)/);
  assert.match(vnCss, /\.pce-vn-plugin-actions\s*\{[\s\S]*display:\s*contents/);
  assert.doesNotMatch(vnRenderer, /import-kitahe-pm|export-godot|kitahe-pm-script-converter|vn-godot-exporter/);
  assert.doesNotMatch(vnRenderer, /api\.electronAPI\.exportVnGodotPackage/);
  assert.match(vnRenderer, /normalizeDoc\(doc, assets\)/);
  assert.match(vnRenderer, /exportVnIrodoriBatch\(\{[\s\S]*doc: snapshot,[\s\S]*assetIds:/);
  assert.match(vnRenderer, /logger\?\.info\?\./);
  assert.match(vnRenderer, /logger\?\.error\?\./);
  assert.match(vnRenderer, /音声バッチ出力をキャンセルしました/);
  assert.match(vnRenderer, /音声バッチZIPは出力しましたが、シーンを保存できませんでした/);
  assert.match(vnRenderer, /async function applyIrodoriVoiceBatch\(\)/);
  assert.match(vnRenderer, /inspectVnIrodoriVoiceAssignments\(\{/);
  assert.match(vnRenderer, /currentInspection\.inspectionSignature !== inspection\.inspectionSignature/);
  assert.match(vnRenderer, /command\.voiceAssetId = assignment\.id/);
  assert.match(vnRenderer, /有効な \$\{Number\(summary\.assignableRows\) \|\| 0\} 行を反映/);
  assert.match(main, /ipcMain\.handle\('vn:exportIrodoriBatch'/);
  assert.doesNotMatch(main, /vn:exportGodotPackage/);
  assert.match(main, /ipcMain\.handle\('vn:inspectIrodoriVoiceAssignments'/);

  const fontRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-font-editor', 'renderer.js'), 'utf-8');
  // Font editor manages a project font library (add / select / delete) instead
  // of a single external path.
  assert.match(fontRenderer, /data-role="font-list"/);
  assert.match(fontRenderer, /importFontFile/);
  assert.match(fontRenderer, /deleteFontFile/);
  assert.match(fontRenderer, /data-font-pick/);
  assert.match(fontRenderer, /data-font-delete/);
  const fontCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-font-editor', 'style.css'), 'utf-8');
  assert.match(fontCss, /\.pce-font-list/);
});

test('Novel toolbar actions follow enabled runtime capability providers', async () => {
  const runtimeModule = await import(`${pathToFileURL(path.join(__dirname, '..', 'renderer', 'plugin-runtime.mjs')).href}?novel-toolbar=${Date.now()}`);
  const runtime = runtimeModule.createPluginRuntime();
  const enabled = new Set(['pce-kitahe-pm-converter', 'pce-vn-godot-exporter']);
  runtimeModule.registerRuntimeCapability(runtime, { id: 'pce-kitahe-pm-converter' }, 'novel-toolbar-action', { label: '北へ。PM取込' });
  runtimeModule.registerRuntimeCapability(runtime, { id: 'pce-vn-godot-exporter' }, 'novel-toolbar-action', { label: 'Godot出力' });
  const available = () => runtimeModule.getRuntimeCapabilities(runtime, 'novel-toolbar-action', (pluginId) => enabled.has(pluginId));

  assert.deepEqual(available().map((provider) => provider.label), ['北へ。PM取込', 'Godot出力']);
  enabled.delete('pce-kitahe-pm-converter');
  assert.deepEqual(available().map((provider) => provider.label), ['Godot出力']);
  enabled.delete('pce-vn-godot-exporter');
  assert.deepEqual(available(), []);
});

test('Godot export is supplied by an optional plugin capability', () => {
  const manifest = readPluginManifest('pce-vn-godot-exporter');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-godot-exporter', 'renderer.js'), 'utf-8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-godot-exporter', 'index.js'), 'utf-8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf-8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');

  assert.equal(manifest.name, 'NVプロジェクトのGodotエクスポート');
  assert.deepEqual(manifest.hooks, ['exportVnGodotPackage']);
  assert.deepEqual(manifest.mainApi.hooks, ['exportVnGodotPackage']);
  assert.deepEqual(manifest.renderer.capabilities, ['vn-godot-exporter', 'novel-toolbar-action']);
  assert.match(renderer, /registerCapability\(CAPABILITY_NAME, \{/);
  assert.match(renderer, /registerCapability\('novel-toolbar-action', \{/);
  assert.match(renderer, /label: 'Godot出力'/);
  assert.match(renderer, /placement: 'after-preview'/);
  assert.match(renderer, /const snapshot = await editor\.getSnapshot\(\)/);
  assert.match(renderer, /await editor\.saveSnapshot\(snapshot\)/);
  assert.match(renderer, /api\.plugins\.invokeHook\(plugin\.id, 'exportVnGodotPackage'/);
  assert.ok(renderer.indexOf('const result = await exportPackage({ doc: snapshot })') < renderer.indexOf('await editor.saveSnapshot(snapshot)'));
  assert.match(index, /async function exportVnGodotPackage/);
  assert.match(index, /exportGodotPackageZip\(\{/);
  assert.doesNotMatch(preload, /exportVnGodotPackage|vn:exportGodotPackage/);
  assert.doesNotMatch(main, /handleExportVnGodotPackage|vn:exportGodotPackage/);
});

test('Godot toolbar action exports the current snapshot before saving and preserves cancel', async () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'pce-vn-godot-exporter', 'renderer.js'),
    'utf-8',
  );
  const rendererModule = await import(
    `data:text/javascript;base64,${Buffer.from(rendererSource).toString('base64')}#godot-action-${Date.now()}`,
  );
  const capabilities = new Map();
  const calls = [];
  let hookResult = {
    ok: true,
    path: 'C:/exports/sample.pcevn.zip',
    sceneCount: 2,
    commandCount: 3,
    assetCount: 4,
  };
  const snapshot = { version: 1, scenes: [{ id: 'opening', commands: [] }] };
  rendererModule.activatePlugin({
    plugin: { id: 'pce-vn-godot-exporter' },
    api: {
      plugins: {
        async invokeHook(pluginId, hook, payload) {
          calls.push('export');
          assert.equal(pluginId, 'pce-vn-godot-exporter');
          assert.equal(hook, 'exportVnGodotPackage');
          assert.equal(payload.doc, snapshot);
          return hookResult;
        },
      },
    },
    logger: { info() {}, error() {} },
    registerCapability(name, implementation) {
      capabilities.set(name, implementation);
    },
  });
  const action = capabilities.get('novel-toolbar-action');
  const editor = {
    async getSnapshot() {
      calls.push('snapshot');
      return snapshot;
    },
    async saveSnapshot(value) {
      calls.push('save');
      assert.equal(value, snapshot);
    },
  };

  const exported = await action.run(editor);
  assert.equal(exported.ok, true);
  assert.deepEqual(calls, ['snapshot', 'export', 'save']);

  calls.length = 0;
  hookResult = { ok: false, canceled: true };
  const canceled = await action.run(editor);
  assert.deepEqual(canceled, { ok: true, canceled: true });
  assert.deepEqual(calls, ['snapshot', 'export']);
});

test('Novel editor opens the plugin-owned Kitahe PhotoMemories conversion workflow', () => {
  const vnRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const converterRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-kitahe-pm-converter', 'renderer.js'), 'utf-8');
  const packageImporter = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-kitahe-pm-converter', 'asset-package-importer.js'), 'utf-8');
  const converterCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-kitahe-pm-converter', 'style.css'), 'utf-8');
  const converterManifest = readPluginManifest('pce-kitahe-pm-converter');

  assert.doesNotMatch(vnRenderer, /北へ。PM取込|kitahe-pm|openImportModal/);
  assert.match(converterRenderer, /registerCapability\(CAPABILITY_NAME, \{ openImportModal \}\)/);
  assert.match(converterRenderer, /registerCapability\('novel-toolbar-action', \{/);
  assert.match(converterRenderer, /label: '北へ。PM取込'/);
  assert.match(converterRenderer, /placement: 'before-preview'/);
  assert.match(converterRenderer, /supportedTargetMedia: \['cd'\]/);
  assert.match(converterRenderer, /editor\.targetMedia !== 'cd'/);
  assert.match(converterRenderer, /const snapshot = await editor\.getSnapshot\(\{ refreshAssets: true \}\)/);
  assert.match(converterRenderer, /await editor\.saveSnapshot\(snapshot\)/);
  assert.match(converterRenderer, /const result = await openImportModal\(\{/);
  assert.match(converterRenderer, /editor\.applyDocument\(result\.doc, \{/);
  const actionStart = converterRenderer.indexOf('const runNovelToolbarAction = async');
  const actionEnd = converterRenderer.indexOf("registerCapability(CAPABILITY_NAME", actionStart);
  const actionSource = converterRenderer.slice(actionStart, actionEnd);
  assert.ok(actionSource.indexOf('await editor.saveSnapshot(snapshot)') < actionSource.indexOf('await openImportModal({'));
  const inspectStart = converterRenderer.indexOf('const inspectSelected = async');
  const inspectEnd = converterRenderer.indexOf('const resetAssetMappings = async', inspectStart);
  const inspectSource = converterRenderer.slice(inspectStart, inspectEnd);
  const pickRootStart = converterRenderer.indexOf('const pickRoot = async');
  const pickRootEnd = converterRenderer.indexOf('const inspectSelected = async', pickRootStart);
  const pickRootSource = converterRenderer.slice(pickRootStart, pickRootEnd);
  const scriptChangeStart = converterRenderer.indexOf("const scriptIndex = target.getAttribute('data-script-index')");
  const scriptChangeEnd = converterRenderer.indexOf("if (target.dataset.kitaheField === 'entry')", scriptChangeStart);
  const scriptChangeSource = converterRenderer.slice(scriptChangeStart, scriptChangeEnd);
  const resetStart = converterRenderer.indexOf('const resetAssetMappings = async');
  const resetEnd = converterRenderer.indexOf('const showPreview = async', resetStart);
  const resetSource = converterRenderer.slice(resetStart, resetEnd);
  assert.match(converterRenderer, /api\.createModal\(/);
  assert.match(converterRenderer, /properties: \['openDirectory'\]/);
  assert.match(converterRenderer, /invoke\('inspectKitahePmSource'/);
  assert.match(converterRenderer, /invoke\('applyKitahePmConversion'/);
  assert.match(converterRenderer, /selectedScripts: Array\.from\(state\.selectedScripts\)/);
  assert.ok(pickRootStart >= 0 && pickRootEnd > pickRootStart);
  assert.match(
    pickRootSource,
    /state\.scripts = asArray\(inspection\?\.scripts\);[\s\S]*const discoveredScriptValues = state\.scripts\.map\(scriptValue\)\.filter\(Boolean\);[\s\S]*state\.selectedScripts = new Set\(discoveredScriptValues\);[\s\S]*state\.entryScript = discoveredScriptValues\[0\] \|\| '';/,
  );
  assert.match(converterRenderer, /const DEFAULT_PROTAGONIST_NAME = 'ハドソン'/);
  assert.match(converterRenderer, /protagonistName: DEFAULT_PROTAGONIST_NAME/);
  assert.match(converterRenderer, /protagonistNameTouched \? \{ protagonistName: state\.protagonistName \} : \{\}/);
  assert.match(converterRenderer, /inspection\?\.protagonistName \?\? state\.protagonistName/);
  assert.match(converterRenderer, /speakers: \{\}/);
  assert.match(converterRenderer, /assets: compactAssetMappings\(state\)/);
  assert.ok(inspectStart >= 0 && inspectEnd > inspectStart);
  assert.match(inspectSource, /const savedAssets = savedMapping\?\.assets && typeof savedMapping\.assets === 'object'/);
  assert.ok(inspectSource.indexOf('const savedAssets =') < inspectSource.indexOf('savedAssets[requirement.key]'));
  assert.match(converterRenderer, /すべてのメッセージをナレーションとして変換し、COLOR値は本文色へ反映/);
  assert.match(converterRenderer, /\(ICG X \+ 元crop X\) × BG幅 \/ 640 \+ BG表示X \/ Y 17/);
  assert.match(converterRenderer, /mapped\.display === 'sprite'[\s\S]*mapped\.slot[\s\S]*else \{[\s\S]*mapped\.x = asInteger\(current\.x, 2\)/);
  assert.doesNotMatch(converterRenderer, /speakerMappings: Object\.create\(null\)|compactSpeakerMappings/);
  assert.match(converterRenderer, /assetMappings: Object\.create\(null\)/);
  assert.match(converterRenderer, /const MAPPING_PAGE_SIZE = 40/);
  assert.match(converterRenderer, /const DIAGNOSTIC_PAGE_SIZE = 200/);
  assert.match(converterRenderer, /requirements\.slice\(start, start \+ MAPPING_PAGE_SIZE\)/);
  assert.match(converterRenderer, /rows\.slice\(start, start \+ DIAGNOSTIC_PAGE_SIZE\)/);
  assert.match(converterRenderer, /action === 'mapping-page-next'/);
  assert.match(converterRenderer, /action === 'diagnostic-page-next'/);
  assert.match(converterRenderer, /diagnosticOverviewHtml\(diagnostics\)/);
  assert.match(converterRenderer, /適用を止めるエラーはありません/);
  assert.match(converterRenderer, /action\.startsWith\('diagnostic-filter-'\)/);
  assert.match(converterRenderer, /state\.diagnosticFilter = diagnosticCounts\(state\.inspection\.diagnostics\)\.error \? 'error' : 'all'/);
  assert.match(converterRenderer, /const showPreview = async \(\) =>/);
  assert.match(converterRenderer, /previewConversion: true/);
  assert.match(converterRenderer, /mapping,\s*previewConversion: true/);
  assert.match(converterRenderer, /state\.inspection = \{[\s\S]*\.\.\.previousInspection,[\s\S]*\.\.\.preview,[\s\S]*signature: previewSignature/);
  assert.match(converterRenderer, /state\.previewMode = state\.mode/);
  assert.match(converterRenderer, /state\.previewSetStartScene = state\.mode === 'replace' \? true : state\.setStartScene/);
  assert.match(converterRenderer, /const invalidateMappedPreview = \(message = '適用方法を変更したため再プレビューしてください'\) =>/);
  assert.match(converterRenderer, /state\.previewMode !== state\.mode[\s\S]*state\.previewSetStartScene !== requestedSetStartScene/);
  assert.match(converterRenderer, /target\.dataset\.kitaheField === 'set-start'[\s\S]*invalidateMappedPreview\(\)/);
  assert.match(converterRenderer, /target\.name === 'kitahe-mode'[\s\S]*invalidateMappedPreview\(\)/);
  assert.match(converterRenderer, /data-map-x="\$\{index\}" type="number" min="0" max="31"/);
  assert.match(converterRenderer, /data-map-y="\$\{index\}" type="number" min="0" max="31"/);
  assert.match(converterRenderer, /modePreviewsHtml\(state\.inspection\?\.modePreviews\)/);
  assert.match(converterRenderer, /sceneBudgetsHtml\(state\.inspection\?\.sceneBudgets\)/);
  assert.match(converterRenderer, /budget\.scenePackLimit \?\? budget\.packByteLimit/);
  assert.match(converterRenderer, /summaryRows\(state\.inspection\?\.totals\)/);
  assert.match(converterRenderer, /signature: state\.inspection\?\.signature/);
  assert.match(converterRenderer, /mode: state\.mode/);
  assert.match(converterRenderer, /confirmWarnings: counts\.warning > 0 && state\.warningConfirmed/);
  assert.match(converterRenderer, /value="replace"/);
  assert.match(converterRenderer, /value="append"/);
  assert.match(converterRenderer, /data-kitahe-field="set-start"/);
  assert.match(converterRenderer, /maxlength="16"/);
  assert.doesNotMatch(converterRenderer, /data-speaker-mode|data-speaker-name|option value="narration"/);
  assert.match(converterRenderer, /data-map-enabled="\$\{index\}"[\s\S]*\$\{mapped \? 'checked' : ''\}/);
  assert.match(converterRenderer, /current\.action = target\.checked \? 'map' : 'omit'/);
  assert.match(converterRenderer, /action: suggestedAssetId \? 'map' : 'omit'/);
  assert.match(converterRenderer, /suggestedAssetType[\s\S]*=== 'sprite'/);
  assert.match(converterRenderer, /data-kitahe-action="reset-asset-mappings"/);
  assert.match(converterRenderer, /action === 'reset-asset-mappings'\) void resetAssetMappings\(\)/);
  assert.ok(resetStart >= 0 && resetEnd > resetStart);
  assert.match(resetSource, /api\.assets\.listPceAssets\(\{ force: true \}\)/);
  assert.match(resetSource, /invoke\('inspectKitahePmSource', inspectPayload\(\)\)/);
  assert.match(resetSource, /state\.assetMappings = Object\.create\(null\)/);
  assert.match(resetSource, /state\.assetMappings\[requirement\.key\] = defaultAssetMapping\(requirement\)/);
  assert.match(resetSource, /invalidateMappedPreview\(''\)/);
  assert.match(resetSource, /renderModal\(modal, state, \{ preserveBodyScroll: true \}\)/);
  assert.doesNotMatch(resetSource, /state\.speakerMappings\s*=/);
  assert.doesNotMatch(converterRenderer, /data-map-action|登録済みアセットへ対応<\/option>|明示的に省略<\/option>/);
  assert.match(converterRenderer, /preserveBodyScroll[\s\S]*previousBody\.scrollTop[\s\S]*nextBody\.scrollTop = bodyScroll\.top/);
  assert.match(converterRenderer, /renderModal\(modal, state, \{ preserveBodyScroll: true \}\)/);
  assert.match(
    converterRenderer,
    /preserveScriptListScroll[\s\S]*previousScriptList\.scrollTop[\s\S]*nextScriptList\.scrollTop = scriptListScroll\.top/,
  );
  assert.ok(scriptChangeStart >= 0 && scriptChangeEnd > scriptChangeStart);
  assert.match(
    scriptChangeSource,
    /renderModal\(modal, state, \{[\s\S]*preserveBodyScroll: true,[\s\S]*preserveScriptListScroll: true,[\s\S]*\}\);/,
  );
  assert.match(converterRenderer, /requirement\.kind === 'psg'\) return \['psg-song'\]/);
  assert.doesNotMatch(converterRenderer, /window\.prompt|window\.alert|window\.confirm/);
  assert.match(converterCss, /\.pce-kitahe-import-panel/);
  assert.match(converterCss, /\.pce-kitahe-map-card\.is-omitted/);
  assert.match(converterCss, /\.pce-kitahe-map-toggle input/);
  assert.match(converterCss, /\.pce-kitahe-paging/);
  assert.match(converterCss, /\.pce-kitahe-error-summary/);
  assert.match(converterCss, /\.pce-kitahe-warning-groups/);
  assert.match(converterCss, /\.pce-kitahe-diagnostic-filters/);
  assert.match(converterCss, /\.pce-kitahe-diagnostic\[data-level="error"\]/);
  assert.match(converterCss, /\.pce-kitahe-preview-modes/);
  assert.match(converterCss, /\.pce-kitahe-budget-table/);
  assert.ok(converterManifest.hooks.includes('inspectKitahePmAssetPackage'));
  assert.ok(converterManifest.renderer.capabilities.includes('kitahe-pm-asset-importer'));
  assert.ok(converterManifest.renderer.capabilities.includes('asset-batch-importer'));
  assert.match(converterRenderer, /registerCapability\('kitahe-pm-asset-importer'/);
  assert.match(converterRenderer, /registerCapability\('asset-batch-importer'/);
  assert.match(converterRenderer, /label: '北へ。PM素材'/);
  assert.match(converterRenderer, /supportedTargetMedia: \['cd'\]/);
  assert.match(packageImporter, /invoke\('inspectKitahePmAssetPackage'/);
  assert.match(packageImporter, /if \(!inspected\?\.ok\)/);
  assert.match(packageImporter, /inspected\?\.error \|\| 'manifest検査に失敗しました'/);
  assert.match(packageImporter, /inspectionSignature \|\| ''/);
  assert.match(packageImporter, /assetCatalogSignature: expectedCatalogSignature/);
  assert.match(packageImporter, /replacePolicy: 'owned-source-key'/);
  assert.match(packageImporter, /kitahePm: provenance\(row, inspection\)/);
  assert.match(packageImporter, /imageTransformFromDetails/);
  assert.match(packageImporter, /sourceCrop: details\.sourceCrop/);
  assert.match(packageImporter, /api\.assets\.importPceImage/);
  assert.match(packageImporter, /api\.assets\.importPceAudio/);
  assert.match(packageImporter, /api\.assets\.importPceMidi/);
  assert.match(packageImporter, /targetType === 'sprite' \? 'sprite' : 'background'/);
  assert.match(packageImporter, /rejectOversize: true/);
  assert.match(packageImporter, /warningCount\(state\.inspection\) && !state\.warningConfirmed/);
  assert.match(packageImporter, /Number\(inspection\?\.summary\?\.errorCount\)/);
  assert.match(packageImporter, /Number\(inspection\?\.summary\?\.warningCount\)/);
  assert.match(packageImporter, /Math\.max\(rowErrors, diagnostics\)/);
  assert.match(packageImporter, /Math\.max\(rowWarnings, diagnostics\)/);
  assert.doesNotMatch(packageImporter, /rowErrors \+ diagnostics|rowWarnings \+ diagnostics/);
  assert.match(packageImporter, /const previewWarnings = asArray\(preview\.warnings\)/);
  assert.match(packageImporter, /preview\.encodedAdpcmBytes \?\? preview\.estimatedAdpcmBytes/);
  assert.match(packageImporter, /INFO: \$\{esc\(diagnosticText\(entry\)\)\}/);
  assert.match(converterCss, /\.pce-kitahe-package-preview-notes/);
  assert.match(packageImporter, /const bpm = preview\.bpm \?\? midiPreview\.bpm/);
  assert.match(packageImporter, /preview\.steps \?\? preview\.stepCount/);
  assert.match(packageImporter, /preview\.patternCount \?\? midiPreview\.patternCount/);
  assert.match(packageImporter, /preview\.stats \|\| preview\.conversion\?\.stats/);
  assert.match(packageImporter, /previousScrollTop[\s\S]*nextList\.scrollTop = previousScrollTop/);
  assert.match(packageImporter, /state\.cancelRequested[\s\S]*break/);
  assert.doesNotMatch(packageImporter, /image-import-pipeline|openResizeModal/);
  assert.match(converterCss, /\.pce-kitahe-package-thumb[\s\S]*object-fit: contain/);
});

test('Kitahe PM import renders only the active Mapping and diagnostic pages', () => {
  const rendererPath = path.join(__dirname, '..', 'plugins', 'pce-kitahe-pm-converter', 'renderer.js');
  const rendererSource = fs.readFileSync(rendererPath, 'utf-8')
    .replace(/^import \{ createKitahePmAssetPackageImporter \} from '.\/asset-package-importer\.js';\r?\n/,
      'const createKitahePmAssetPackageImporter = () => ({});\n')
    .replace('export function activatePlugin', 'function activatePlugin')
    + '\nglobalThis.__kitahePaging = { assetMappingRows, diagnosticRows, diagnosticOverviewHtml };\n';
  const context = {};
  vm.runInNewContext(rendererSource, context, { filename: rendererPath });

  const assets = Array.from({ length: 532 }, (_, index) => ({
    id: `voice_${index}`,
    name: `Voice ${index}`,
    type: 'adpcm',
  }));
  const assetRequirements = Array.from({ length: 2270 }, (_, index) => ({
    key: `voice_requirement_${index}`,
    label: `Voice requirement ${index}`,
    acceptableAssetTypes: ['adpcm'],
  }));
  const mappingState = {
    inspection: { assetRequirements },
    assetMappings: Object.create(null),
    assets,
    mappingPage: 0,
  };
  const mappingHtml = context.__kitahePaging.assetMappingRows(mappingState);
  assert.equal((mappingHtml.match(/data-map-card=/g) || []).length, 40);
  assert.equal((mappingHtml.match(/<option /g) || []).length, 40 * (assets.length + 1));
  assert.doesNotMatch(mappingHtml, /data-map-card="40"/);

  const diagnostics = Array.from({ length: 11258 }, (_, index) => ({
    level: index % 2 ? 'warning' : 'error',
    message: `Diagnostic ${index}`,
  }));
  const diagnosticHtml = context.__kitahePaging.diagnosticRows(diagnostics, { diagnosticPage: 0 });
  assert.equal((diagnosticHtml.match(/class="pce-kitahe-diagnostic"/g) || []).length, 200);
  assert.doesNotMatch(diagnosticHtml, /Diagnostic 200<\/p>/);
  const errorOnlyHtml = context.__kitahePaging.diagnosticRows(diagnostics, {
    diagnosticPage: 0,
    diagnosticFilter: 'error',
  });
  assert.equal((errorOnlyHtml.match(/class="pce-kitahe-diagnostic"/g) || []).length, 200);
  assert.doesNotMatch(errorOnlyHtml, /Diagnostic 1<\/p>/);
  const overviewHtml = context.__kitahePaging.diagnosticOverviewHtml([
    { severity: 'error', code: 'scene-pack-limit', message: 'Scene too large' },
    { severity: 'warning', code: 'command-omitted', message: 'Skipped A' },
    { severity: 'warning', code: 'command-omitted', message: 'Skipped B' },
  ]);
  assert.match(overviewHtml, /適用を止めるエラー 1件/);
  assert.match(overviewHtml, /command-omitted/);
  assert.match(overviewHtml, /<strong>2<\/strong>/);
});

test('Sound plugin integrates ADPCM, CD-DA, and PSG tools behind one tabbed page', () => {
  const manifest = readPluginManifest('sound-editor');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'sound-editor', 'renderer.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'sound-editor', 'style.css'), 'utf-8');
  const musicRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'renderer.js'), 'utf-8');
  const psgPreview = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'psg-preview.js'), 'utf-8');
  const musicCss = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-music-editor', 'style.css'), 'utf-8');
  const hostRenderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf-8');

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
  assert.match(musicRenderer, /function psgImportFormat\(asset = \{\}\)/);
  assert.match(musicRenderer, /return 'PSG JSON'/);
  assert.match(musicRenderer, /function psgAssetOriginTag\(asset = \{\}\)/);
  assert.match(musicRenderer, /label: 'エディタSFX'/);
  assert.match(musicRenderer, /data-kind="\$\{esc\(originTag\.kind\)\}"/);
  assert.match(musicRenderer, /<code>\$\{esc\(asset\.id\)\}<\/code>/);
  assert.match(musicRenderer, /pce-music-origin-tag/);
  assert.match(musicCss, /\.pce-music-editor-shell \.pce-plugin-group/);
  assert.match(musicCss, /\.pce-music-origin-tag\[data-kind="import"\]/);
  assert.match(musicCss, /\.pce-music-origin-tag\[data-kind="designer"\]/);
  // PSG can register import-ready PSG JSON as well as VGM/VGZ/MIDI sources.
  assert.match(musicRenderer, /data-import/);
  assert.match(musicRenderer, /inspectPcePsgJson/);
  assert.match(musicRenderer, /importPcePsgJson/);
  assert.match(musicRenderer, /importPceVgm/);
  assert.match(musicRenderer, /importPceMidi/);
  assert.match(musicRenderer, /previewPceMidi/);
  assert.match(musicRenderer, /'json', 'vgm', 'vgz', 'mid', 'midi'/);
  assert.match(musicRenderer, /format = ext === 'json'/);
  assert.match(musicRenderer, /data-replace-row/);
  assert.match(musicRenderer, /同じIDのPSG assetを置換する/);
  assert.match(musicRenderer, /summary\.sections/);
  assert.match(hostRenderer, /inspectPcePsgJson/);
  assert.match(hostRenderer, /importPcePsgJson/);
  assert.match(hostRenderer, /import-psg-json/);
  assert.match(musicRenderer, /maxToneVoices/);
  assert.match(musicRenderer, /drumMode/);
  assert.match(musicRenderer, /toneVolumeScale/);
  assert.match(musicRenderer, /drumVolumeScale/);
  assert.match(musicRenderer, /drumVolumeScale:\s*100/);
  assert.match(musicRenderer, /minVelocity/);
  assert.match(musicRenderer, /voicePriority/);
  assert.match(musicRenderer, /patternDetail/);
  assert.match(musicRenderer, /timbreMode/);
  assert.match(musicRenderer, /programWaveMap/);
  assert.match(musicRenderer, /GM family → BIOS wave/);
  assert.match(musicRenderer, /data-preview-toggle/);
  assert.match(musicRenderer, /data-delete-id/);
  assert.match(musicRenderer, /data-preview-midi/);
  assert.match(musicRenderer, /createPsgPreviewController/);
  assert.match(psgPreview, /export function expandPsgPreviewStates/);
  assert.match(psgPreview, /function scheduleStep\(\)/);
  assert.match(psgPreview, /cell\.wave/);
  assert.match(musicCss, /\.pce-music-midi-controls/);
  assert.match(musicCss, /\.pce-music-midi-wave-map/);
  assert.match(musicCss, /\.pce-music-list-delete/);
  assert.match(musicCss, /\.pce-tracker-summary/);
});

test('CD-DA manager exposes fixed warning/data tracks and Track 3 game-audio management', () => {
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
  assert.match(renderer, /const CDDA_WARNING_TYPE = 'cdda-warning'/);
  assert.match(renderer, /const CDDA_WARNING_ID = 'cdda_warning'/);
  assert.match(renderer, /Track 01 · Warning Audio/);
  assert.match(renderer, /Game Data/);
  assert.match(renderer, /PREGAP 00:03:00/);
  assert.match(renderer, /Track 3から再採番/);
  assert.match(renderer, /async function importWarningAudio\(\)/);
  assert.match(renderer, /kind: CDDA_WARNING_TYPE/);
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
  assert.match(renderer, /let draftAsset = null;/);
  assert.match(renderer, /function updateDraftFromForm\(\)/);
  assert.match(renderer, /\['id', 'name', 'track', 'loop'\]\.forEach/);
  assert.match(renderer, /data-role="pane-resizer"/);
  assert.match(renderer, /function setupPaneResizer\(\)/);
  assert.match(renderer, /localStorage\?\.setItem\(storageKey/);
  assert.match(renderer, /function saveTrackOrder/);
  assert.match(renderer, /track:\s*nextTrack/);
  assert.match(renderer, /index \+ FIRST_GAME_TRACK/);
  assert.match(renderer, /registerCapability\('cdda-manager'/);
  assert.match(css, /\.pce-cdda-layout/);
  assert.match(css, /\.pce-cdda-warning-slot/);
  assert.match(css, /\.pce-cdda-row\.is-invalid/);
  assert.match(css, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*6px\s*minmax\(300px,\s*390px\)/);
  assert.match(css, /\.pce-cdda-resizer/);
  assert.match(css, /\.pce-cdda-sort/);
  assert.match(css, /\.pce-cdda-id-cell/);
  assert.match(css, /\.pce-cdda-group-row/);
  assert.match(css, /\.pce-cdda-row-actions\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.pce-cdda-row-actions \.icon-btn-xs\s*\{[\s\S]*display:\s*inline-flex/);
  assert.match(css, /\.pce-cdda-table/);
  assert.match(css, /\.pce-cdda-stats/);
  assert.match(css, /\.pce-cdda-status\[data-kind="warn"\]/);
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
  assert.match(renderer, /data-action="batch-import"/);
  assert.match(renderer, /CSV一括/);
  assert.match(renderer, /createAdpcmBatchImporter/);
  assert.match(renderer, /importAdpcmBatchCsv/);
  assert.match(renderer, /ADPCM_DEFAULT_SAMPLE_RATE\s*=\s*8000/);
  assert.match(renderer, /ADPCM_SAMPLE_RATES\s*=\s*Object\.freeze\(\[4000, 4571, 5333, 6400, 8000, 10666, 16000, 32000\]\)/);
  assert.match(renderer, /<select class="form-select" name="sampleRate">\$\{adpcmSampleRateOptions\(\)\}<\/select>/);
  assert.match(renderer, /formEl\.elements\.sampleRate\.value = supportedAdpcmSampleRate/);
  assert.match(renderer, /async function pickAudioFile\(\)/);
  assert.match(renderer, /filters:\s*\[\{ name: 'WAV \/ MP3'/);
  assert.match(renderer, /openImportSettingsModal/);
  assert.doesNotMatch(renderer, /sampleRateToDivider/);
  assert.doesNotMatch(renderer, /name="adpcmAddress"/);
  assert.doesNotMatch(renderer, /name="divider"/);
  assert.doesNotMatch(renderer, /data-action="auto-divider"/);
  assert.doesNotMatch(renderer, /data-import-auto-divider/);
  assert.doesNotMatch(renderer, /name="stream"/);
  assert.match(renderer, /name="splitPolicy"/);
  assert.match(renderer, /openAudioConvertModal/);
  assert.match(renderer, /kind:\s*'adpcm'/);
  assert.match(renderer, /importAssetAudio/);
  assert.doesNotMatch(renderer, /stream:\s*details\.stream/);
  assert.match(renderer, /splitPolicy:\s*details\.splitPolicy \? 'auto' : ''/);
  assert.match(renderer, /let draftAsset = null;/);
  assert.match(renderer, /function updateDraftFromForm\(\)/);
  assert.match(renderer, /delete options\.adpcmAddress;/);
  assert.match(renderer, /delete options\.divider;/);
  assert.match(renderer, /delete options\.stream;/);
  assert.match(renderer, /delete options\.streaming;/);
  assert.match(renderer, /\['id', 'name', 'loop'\]\.forEach/);
  assert.match(renderer, /previewAssetSource/);
  assert.match(renderer, /data-row-play/);
  assert.match(renderer, /data-row-delete/);
  assert.match(renderer, /data-sort-key="name"/);
  assert.match(renderer, /data-sort-key="id"/);
  assert.match(renderer, /function sortedAdpcmAssets\(\)/);
  assert.match(renderer, /function renderGroupedRows\(list, colSpan, rowRenderer\)/);
  assert.match(renderer, /rowRenderer\(asset, group\.length\)/);
  assert.match(renderer, /data-tree-depth="\$\{depth\}"/);
  assert.match(renderer, /pce-adpcm-name-cell" style="--asset-tree-indent:\$\{depth \* 14\}px"/);
  assert.match(renderer, /assetDisplayName\(displayAsset\)/);
  assert.match(renderer, /pce-adpcm-id-cell/);
  assert.match(renderer, /data-role="pane-resizer"/);
  assert.match(renderer, /function setupPaneResizer\(\)/);
  assert.match(renderer, /localStorage\?\.setItem\(storageKey/);
  assert.match(renderer, /registerCapability\('adpcm-manager'/);
  assert.match(css, /\.pce-adpcm-layout/);
  assert.match(css, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*6px\s*minmax\(320px,\s*420px\)/);
  assert.match(css, /\.pce-adpcm-resizer/);
  assert.doesNotMatch(css, /\.pce-adpcm-field-action/);
  assert.match(css, /\.pce-adpcm-sort/);
  assert.match(css, /\.pce-adpcm-id-cell/);
  assert.match(css, /\.pce-adpcm-group-row/);
  assert.match(css, /\.pce-adpcm-table td\.pce-adpcm-name-cell\s*\{[\s\S]*padding-left:\s*calc\(10px \+ var\(--asset-tree-indent,\s*0px\)\)/);
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
  assert.doesNotMatch(html, /id="page-assets"/);
  assert.doesNotMatch(renderer, /renderResFileList\(\)/);
  assert.doesNotMatch(renderer, /renderResFileSelect\(\)|loadResDefinitions\(/);
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

test('default sidebar order prioritizes PCE editors then core tools', () => {
  const html = readRendererFile('index.html');
  const novel = readPluginManifest('novel-editor');
  const assets = readPluginManifest('pce-asset-manager');
  const image = readPluginManifest('image-editor');
  const sound = readPluginManifest('sound-editor');
  const code = readPluginManifest('code-editor');

  assert.equal(novel.tab.order, 8);
  assert.equal(assets.tab.order, 10);
  assert.equal(image.tab.order, 12);
  assert.equal(sound.tab.order, 13);
  assert.equal(code.tab.order, 30);
  assert.ok(novel.tab.order < assets.tab.order);
  assert.ok(assets.tab.order < image.tab.order);
  assert.ok(image.tab.order < sound.tab.order);
  assert.ok(sound.tab.order < code.tab.order);
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

test('build saves the current visual novel editor state before running a builder plugin', () => {
  const renderer = readRendererFile('renderer.js');
  const vnRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'), 'utf-8');
  const buildBody = renderer.slice(
    renderer.indexOf('async function runBuild(opts = {})'),
    renderer.indexOf('// ========================================================= TEST PLAY ===')
  );

  assert.match(renderer, /async function saveVisualNovelBeforeBuild\(\)/);
  assert.match(renderer, /getPluginCapability\('visual-novel-editor'\)/);
  assert.match(buildBody, /builderPluginId === 'pce-visual-novel-builder'[\s\S]*builderPluginId === 'pce-visual-novel-hucard-builder'/);
  assert.match(buildBody, /if \(usesVisualNovelBuilder && !opts\._visualNovelSaved\)/);
  assert.match(buildBody, /await saveVisualNovelBeforeBuild\(\)/);
  assert.ok(buildBody.indexOf('await saveVisualNovelBeforeBuild()') < buildBody.indexOf('runPluginGenerator(builderPluginId)'));
  assert.match(buildBody, /opts = \{ \.\.\.opts, _visualNovelSaved: true \}/);
  assert.match(vnRenderer, /const saved = await api\.electronAPI\.writeCodeFile\(\{/);
  assert.match(vnRenderer, /if \(!applyScriptJsonToDoc\(\{ refreshText: true \}\)\) \{[\s\S]*return \{ ok: false, error:/);
  assert.match(vnRenderer, /if \(!saved\?\.ok\) throw new Error/);
  assert.match(vnRenderer, /return \{ ok: true \}/);
  assert.match(vnRenderer, /return \{ ok: false, error \}/);
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

test('quantize converter targets PCE 16-color palette with fast and slow dithering', () => {
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
