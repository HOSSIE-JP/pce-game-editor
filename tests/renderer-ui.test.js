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
  const audioManifest = readPluginManifest('pce-audio-converter');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'renderer.js'), 'utf-8');
  const audioRenderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-audio-converter', 'renderer.js'), 'utf-8');
  const html = readRendererFile('index.html');
  const css = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-asset-manager', 'style.css'), 'utf-8');

  assert.equal(manifest.tab.page, 'pce-assets');
  assert.equal(manifest.renderer.page, 'pce-assets');
  assert.ok(manifest.dependencies.includes('pce-audio-converter'));
  assert.ok(manifest.renderer.capabilities.includes('asset-import-handler'));
  assert.ok(audioManifest.renderer.capabilities.includes('audio-convert-ui'));
  assert.match(audioRenderer, /openAudioConvertModal:\s*api\.openAudioConvertModal/);
  assert.match(renderer, /assets-layout/);
  assert.match(renderer, /asset-table/);
  assert.match(renderer, /asset-preview-panel/);
  assert.match(renderer, /accordion-section/);
  assert.match(renderer, /image-preview-frame/);
  assert.match(renderer, /pce-assets-sound-preview/);
  assert.match(renderer, /playPsgPreview/);
  assert.match(renderer, /data-action="preview-play"/);
  assert.match(renderer, /isPsgAsset\(asset\)[\s\S]*Sound[\s\S]*Period \/ Hz[\s\S]*Steps/);
  assert.match(renderer, /palette-swatch/);
  assert.match(renderer, /id="pceAssetEditorPanel"/);
  assert.match(renderer, /data-action="import-bg"[\s\S]*title="BGを追加"/);
  assert.match(renderer, /data-action="import-sprite"[\s\S]*title="スプライトを追加"/);
  assert.match(renderer, /data-action="import-adpcm"[\s\S]*title="ADPCMを追加"/);
  assert.match(renderer, /data-action="import-cdda"[\s\S]*title="CD-DAを追加"/);
  assert.match(renderer, /data-role="animation-editor"/);
  assert.match(renderer, /data-animation-add/);
  assert.doesNotMatch(renderer, /data-row-delete="[^"]*"[\s\S]*>Del<\/button>/);
  assert.doesNotMatch(renderer, /id="assetEditorPanel"/);
  assert.match(renderer, /api\.createModal/);
  assert.match(renderer, /picked\?\.sourcePath/);
  assert.match(renderer, /importAssetImage/);
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
  assert.match(html, /id="projectParentDirInput"/);
  assert.match(html, /id="btnProjectParentDirBrowse"/);
  assert.match(html, /id="projectTemplateSelect"/);
  assert.match(renderer, /coreId:\s*'pc-engine'/);
  assert.match(renderer, /function normalizeProjectCoreId\(coreId\)/);
  assert.match(renderer, /state\.projectConfig\.coreId = normalizeProjectCoreId\(result\.activeCoreId \|\| state\.projectConfig\.coreId\)/);
  assert.match(renderer, /const NEW_PROJECT_DEFAULT_CONFIG = \{[\s\S]*title:\s*'MY NEW GAME'[\s\S]*author:\s*'YOUR NAME'[\s\S]*serial:\s*'GM 00000000-00'/);
  assert.match(renderer, /el\.projectTitleInput\.value = NEW_PROJECT_DEFAULT_CONFIG\.title/);
  assert.match(renderer, /el\.projectAuthorInput\.value = NEW_PROJECT_DEFAULT_CONFIG\.author/);
  assert.match(renderer, /el\.projectSerialInput\.value = NEW_PROJECT_DEFAULT_CONFIG\.serial/);
  assert.doesNotMatch(renderer, /el\.projectTitleInput\.value = state\.projectConfig\.title/);
  assert.doesNotMatch(renderer, /el\.projectAuthorInput\.value = state\.projectConfig\.author/);
  assert.doesNotMatch(renderer, /el\.projectSerialInput\.value = state\.projectConfig\.serial/);
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
