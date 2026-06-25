/**
 * PCE Game Editor - renderer.js
 * エディタのフロントエンドロジック
 */

import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  allowedTypesForExtension as getAllowedAssetTypesForExtension,
  defaultSubDirForType,
  inferTypeFromExtension,
  normalizeSymbolName,
} from './asset-utils.mjs';
import {
  clearPluginRuntime as clearRuntimeState,
  createPluginRuntime,
  getRuntimeCapabilities,
  getRuntimeCapability,
  listRuntimeCapabilities,
  registerRuntimeCapability,
  waitForRuntimeCapability,
} from './plugin-runtime.mjs';
import {
  appendLogLine,
  formatLogEntryText,
  getVisibleLogEntries as filterVisibleLogEntries,
  isLogEntryVisible,
  renderLogEntries,
  renderLogSourceFilters as renderSharedLogSourceFilters,
} from './log-viewer-core.mjs';

const DEFAULT_EXTERNAL_EMULATOR_PATH = '/Applications/Geargrafx.app/Contents/MacOS/geargrafx';

// ------------------------------------------------------------------ state --
const state = {
  currentPage: 'assets',
  logOpen: false,
  logDetached: false,
  logOpenHeight: 220,
  building: false,
  lastRomPath: null,
  projectConfig: {
    coreId: 'pc-engine',
    title: 'MY GAME',
    author: 'AUTHOR',
    serial: 'GM 00000000-00',
    region: 'JUE',
    testPlay: {
      externalEmulator: {
        executablePath: DEFAULT_EXTERNAL_EMULATOR_PATH,
        extraArgs: '',
      },
    },
  },
  project: {
    dir: '',
    name: '',
    projectsRootDir: '',
    availableProjects: [],
    recentProjects: [],
    templates: [],
    cores: [],
    newProjectParentDir: '',
  },
  preview: {
    audio: null,
    audioEntryId: '',
    vgmEntryId: '',
    vgmDurationSec: 0,
    imageEntryId: '',
    spriteTimer: 0,
    spriteEntryId: '',
    spriteRow: 0,
    spriteFrame: 0,
    spriteImage: null,
    spritePlaying: false,
    imageZoom: 'fit',
    imageNaturalWidth: 0,
    imageNaturalHeight: 0,
    paramsOpen: true,
    previewOpen: true,
    panelOpen: true,
    panelWidth: 380,
  },
  rescomp: {
    resRoot: '',
    files: [],
    selectedFile: '',
    selectedEntryLine: null,
    searchText: '',
    pendingImageSource: null,
    pendingAssetPick: null,
  },
  code: {
    tree: [],
    selectedPath: 'src/main.c',
    selectedIsDirectory: false,
    selectedIsMedia: false,
    selectedEncoding: 'auto',
    activeEncoding: 'utf8',
    treeFilterText: '',
    treeFilterError: '',
    initialCollapseApplied: false,
    completions: [],
    completionIndex: 0,
    completionPrefix: '',
    findOpen: false,
    findText: '',
    replaceText: '',
    findMatches: [],
    findIndex: -1,
    cursorLine: 1,
    collapsedDirs: [],
    dirty: false,
  },
  logs: {
    entries: [],
    sourceVisibility: { build: true },
    levelFilter: 'all',
    searchText: '',
  },
  pluginFilters: {
    searchText: '',
    type: 'all',
    showAllCores: false,
  },
  pluginUi: {
    roleAccordionOpen: false,
  },
  startup: {
    selectedDefaultSidebarPage: false,
    projectSelectionRequired: false,
    projectSelected: false,
  },
};

const TYPE_OPTIONS = ['PALETTE', 'IMAGE', 'BITMAP', 'SPRITE', 'XGM', 'XGM2', 'WAV', 'MAP', 'TILEMAP', 'TILESET'];
const COMPRESSION_OPTIONS = ['AUTO', 'NONE', 'APLIB', 'LZ4W'];
const MAP_OPT_OPTIONS = ['NONE', 'ALL', 'DUPLICATE'];
const ORDERING_OPTIONS = ['ROW', 'COLUMN'];
const COLLISION_OPTIONS = ['NONE', 'CIRCLE', 'BOX'];
const SPRITE_OPT_TYPE_OPTIONS = ['BALANCED', 'SPRITE', 'TILE', 'NONE'];
const SPRITE_OPT_LEVEL_OPTIONS = ['FAST', 'MEDIUM', 'SLOW', 'MAX'];
const BOOLEAN_WORD_OPTIONS = ['TRUE', 'FALSE'];
const XGM_TIMING_OPTIONS = ['AUTO', 'NTSC', 'PAL'];
const WAV_DRIVER_OPTIONS = ['DEFAULT', 'PCM', 'DPCM2', 'PCM4', 'XGM', 'XGM2'];
const WAV_OUT_RATE_OPTIONS_BY_DRIVER = {
  PCM: ['8000', '11025', '13400', '16000', '22050', '32000'],
  XGM2: ['6650', '13300'],
};
const WAV_OUT_RATE_DEFAULT_BY_DRIVER = {
  PCM: '16000',
  XGM2: '13300',
};
const FORM_FIELDS_BY_TYPE = {
  PALETTE: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力ファイル', type: 'text' },
  ],
  IMAGE: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力画像', type: 'text' },
    { key: 'compression', label: '圧縮', type: 'select', options: COMPRESSION_OPTIONS },
    { key: 'mapOpt', label: 'map_opt', type: 'select', options: MAP_OPT_OPTIONS },
    { key: 'mapBase', label: 'map_base', type: 'text' },
  ],
  BITMAP: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力画像', type: 'text' },
    { key: 'compression', label: '圧縮', type: 'select', options: COMPRESSION_OPTIONS },
  ],
  SPRITE: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力画像', type: 'text' },
    { key: 'width', label: 'フレーム幅', type: 'text' },
    { key: 'height', label: 'フレーム高', type: 'text' },
    { key: 'compression', label: '圧縮', type: 'select', options: COMPRESSION_OPTIONS },
    { key: 'time', label: 'time', type: 'text' },
    { key: 'collision', label: 'collision', type: 'select', options: COLLISION_OPTIONS },
    { key: 'optType', label: 'opt_type', type: 'select', options: SPRITE_OPT_TYPE_OPTIONS },
    { key: 'optLevel', label: 'opt_level', type: 'select', options: SPRITE_OPT_LEVEL_OPTIONS },
    { key: 'optDuplicate', label: 'opt_duplicate', type: 'select', options: BOOLEAN_WORD_OPTIONS },
  ],
  XGM: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力音源', type: 'text' },
    { key: 'timing', label: 'timing', type: 'select', options: XGM_TIMING_OPTIONS },
    { key: 'options', label: 'options', type: 'text' },
  ],
  XGM2: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力音源(1つ目)', type: 'text' },
    { key: 'options', label: 'options', type: 'text' },
  ],
  WAV: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力wav', type: 'text' },
    { key: 'driver', label: 'driver', type: 'select', options: WAV_DRIVER_OPTIONS },
    { key: 'outRate', label: 'out_rate', type: 'select', options: [] },
    { key: 'far', label: 'far', type: 'select', options: BOOLEAN_WORD_OPTIONS },
  ],
  MAP: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力画像/TMX', type: 'text' },
    { key: 'tileset', label: 'tileset_id', type: 'text' },
    { key: 'compression', label: '圧縮', type: 'select', options: COMPRESSION_OPTIONS },
    { key: 'mapBase', label: 'map_base', type: 'text' },
    { key: 'ordering', label: 'ordering', type: 'select', options: ORDERING_OPTIONS },
  ],
  TILEMAP: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力画像/TMX', type: 'text' },
    { key: 'tileset', label: 'tileset_id', type: 'text' },
    { key: 'compression', label: '圧縮', type: 'select', options: COMPRESSION_OPTIONS },
    { key: 'mapOpt', label: 'map_opt', type: 'select', options: MAP_OPT_OPTIONS },
    { key: 'mapBase', label: 'map_base', type: 'text' },
    { key: 'ordering', label: 'ordering', type: 'select', options: ORDERING_OPTIONS },
  ],
  TILESET: [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力画像/TSX', type: 'text' },
    { key: 'compression', label: '圧縮', type: 'select', options: COMPRESSION_OPTIONS },
    { key: 'opt', label: 'opt', type: 'select', options: MAP_OPT_OPTIONS },
    { key: 'ordering', label: 'ordering', type: 'select', options: ORDERING_OPTIONS },
    { key: 'export', label: 'export', type: 'select', options: BOOLEAN_WORD_OPTIONS },
  ],
};

const DITHER_PATTERNS = {
  diagonal4: [
    [0.0, 0.5, 0.125, 0.625],
    [0.75, 0.25, 0.875, 0.375],
    [0.1875, 0.6875, 0.0625, 0.5625],
    [0.9375, 0.4375, 0.8125, 0.3125],
  ],
  diagonal2: [
    [0.0, 0.5],
    [0.75, 0.25],
  ],
  horizontal4: [
    [0.1, 0.3, 0.6, 0.9],
    [0.1, 0.3, 0.6, 0.9],
    [0.1, 0.3, 0.6, 0.9],
    [0.1, 0.3, 0.6, 0.9],
  ],
  horizontal2: [
    [0.2, 0.8],
    [0.2, 0.8],
  ],
  vertical4: [
    [0.1, 0.1, 0.1, 0.1],
    [0.3, 0.3, 0.3, 0.3],
    [0.6, 0.6, 0.6, 0.6],
    [0.9, 0.9, 0.9, 0.9],
  ],
  vertical2: [
    [0.25, 0.25],
    [0.75, 0.75],
  ],
};

const quantizeState = {
  active: false,
  originalCanvas: null,
  originalCtx: null,
  originalData: null,
  adjustedData: null,
  sourcePath: '',
  convertedDataUrl: '',
  referencePalette: null,
  referencePalettePath: '',
  referenceDataUrl: '',
  referenceImageWidth: 0,
  referenceImageHeight: 0,
  referencePaletteError: '',
  lastReferenceLogToken: '',
  referencePaletteLabel: '',
  onApply: null,
};

const audioConvertState = {
  active: false,
  pending: null,
  resolve: null,
  dataUrl: '',
  audioBuffer: null,
  originalAudioBuffer: null,
  durationSec: 0,
  sampleRate: 0,
  startSec: 0,
  endSec: 0,
  stopTimer: null,
  waveZoom: 1,
  waveScroll: 0,
  playheadSec: 0,
  playheadRAF: null,
  loopPlayback: false,
};

// -------------------------------------------------------------------- DOM --
const $ = (id) => document.getElementById(id);

const el = {
  btnSetup: $('btnSetup'),
  btnBuild: $('btnBuild'),
  btnTestPlay: $('btnTestPlay'),
  btnExport: $('btnExport'),
  btnNewProject: $('btnNewProject'),
  btnOpenProject: $('btnOpenProject'),
  projectName: $('projectName'),
  projectDirLabel: $('projectDirLabel'),
  buildLog: $('buildLog'),
  buildLogBar: $('buildLogBar'),
  buildLogBody: $('buildLogBody'),
  buildStatusBadge: $('buildStatusBadge'),
  buildRomSize: $('buildRomSize'),
  btnCopyLog: $('btnCopyLog'),
  btnPopoutLog: $('btnPopoutLog'),
  btnToggleLog: $('btnToggleLog'),
  btnClearLog: $('btnClearLog'),
  logLevelFilter: $('logLevelFilter'),
  logSearchInput: $('logSearchInput'),
  logSourceFilters: $('logSourceFilters'),
  buildLogHeader: $('buildLogHeader'),
  buildLogResizer: $('buildLogResizer'),
  sidebar: document.querySelector('.sidebar'),
  sidebarPluginTabs: $('sidebarPluginTabs'),
  mainLayout: document.querySelector('.main-layout'),
  pageAssets: $('page-assets'),
  pageCode: $('page-code'),
  codeArea: $('codeArea'),
  codeEditor: $('codeEditor'),
  codeFileName: $('codeFileName'),
  btnCodeFindToggle: $('btnCodeFindToggle'),
  codeFindPanel: $('codeFindPanel'),
  codeFindInput: $('codeFindInput'),
  codeReplaceInput: $('codeReplaceInput'),
  btnCodeFindPrev: $('btnCodeFindPrev'),
  btnCodeFindNext: $('btnCodeFindNext'),
  btnCodeReplaceOne: $('btnCodeReplaceOne'),
  btnCodeReplaceAll: $('btnCodeReplaceAll'),
  codeTree: $('codeTree'),
  codeStatus: $('codeStatus'),
  codeLineNumbers: $('codeLineNumbers'),
  codeHighlight: $('codeHighlight'),
  codeScroller: $('codeScroller'),
  codeMediaPreview: $('codeMediaPreview'),
  codeCompletionPanel: $('codeCompletionPanel'),
  codeTreeFilterInput: $('codeTreeFilterInput'),
  codeEncodingSelect: $('codeEncodingSelect'),
  codeEntryModal: $('codeEntryModal'),
  codeEntryModalTitle: $('codeEntryModalTitle'),
  codeEntryNameInput: $('codeEntryNameInput'),
  codeEntryNameError: $('codeEntryNameError'),
  btnCodeEntryModalClose: $('btnCodeEntryModalClose'),
  btnCodeEntryConfirm: $('btnCodeEntryConfirm'),
  btnCodeEntryCancel: $('btnCodeEntryCancel'),
  btnCodeNewFile: $('btnCodeNewFile'),
  btnCodeNewFolder: $('btnCodeNewFolder'),
  btnCodeDelete: $('btnCodeDelete'),
  btnCodeTreeExpandAll: $('btnCodeTreeExpandAll'),
  btnCodeTreeCollapseAll: $('btnCodeTreeCollapseAll'),
  btnSaveCode: $('btnSaveCode'),
  settingTitle: $('settingTitle'),
  settingAuthor: $('settingAuthor'),
  settingSerial: $('settingSerial'),
  settingTitleError: $('settingTitleError'),
  settingAuthorError: $('settingAuthorError'),
  settingSerialError: $('settingSerialError'),
  settingOutputPath: $('settingOutputPath'),
  externalEmulatorSettings: $('externalEmulatorSettings'),
  externalEmulatorPath: $('externalEmulatorPath'),
  externalEmulatorArgs: $('externalEmulatorArgs'),
  externalEmulatorHint: $('externalEmulatorHint'),
  currentProjectDir: $('currentProjectDir'),
  btnOpenProjectDir: $('btnOpenProjectDir'),
  btnSettingsProjectPicker: $('btnSettingsProjectPicker'),
  btnOpenOutputFolder: $('btnOpenOutputFolder'),
  btnDownloadRom: $('btnDownloadRom'),
  btnSaveSettings: $('btnSaveSettings'),
  settingsSavedMsg: $('settingsSavedMsg'),
  pluginList: $('pluginList'),
  btnReloadPlugins: $('btnReloadPlugins'),
  btnOpenPluginsFolder: $('btnOpenPluginsFolder'),
  pluginBuilderSelect: $('pluginBuilderSelect'),
  pluginEmulatorSelect: $('pluginEmulatorSelect'),
  pluginSearchInput: $('pluginSearchInput'),
  pluginTypeFilter: $('pluginTypeFilter'),
  pluginCoreFilterToggle: $('pluginCoreFilterToggle'),
  pluginRoleStatus: $('pluginRoleStatus'),
  btnPluginRoleAccordion: $('btnPluginRoleAccordion'),
  pluginRoleBody: $('pluginRoleBody'),

  aboutModal: $('aboutModal'),
  aboutBackdrop: $('aboutBackdrop'),
  btnAboutClose: $('btnAboutClose'),
  aboutTitle: $('aboutTitle'),
  aboutDescription: $('aboutDescription'),
  aboutAppVersion: $('aboutAppVersion'),
  aboutWasmBuildVersion: $('aboutWasmBuildVersion'),
  aboutWasmPackageVersion: $('aboutWasmPackageVersion'),
  aboutElectronVersion: $('aboutElectronVersion'),
  aboutChromeVersion: $('aboutChromeVersion'),
  aboutNodeVersion: $('aboutNodeVersion'),
  aboutPlatform: $('aboutPlatform'),
  aboutArch: $('aboutArch'),
  aboutAppPath: $('aboutAppPath'),
  btnOpenResDir: $('btnOpenResDir'),
  btnCreateResFile: $('btnCreateResFile'),
  btnAddAsset: $('btnAddAsset'),
  resFileModal: $('resFileModal'),
  btnResFileModalClose: $('btnResFileModalClose'),
  btnResFileCancel: $('btnResFileCancel'),
  btnResFileCreate: $('btnResFileCreate'),
  resFileNameInput: $('resFileNameInput'),
  assetModal: $('assetModal'),
  btnAssetModalClose: $('btnAssetModalClose'),
  btnAssetModalCancel: $('btnAssetModalCancel'),
  btnAssetModalCreate: $('btnAssetModalCreate'),
  assetSourcePathInput: $('assetSourcePathInput'),
  assetTypeInput: $('assetTypeInput'),
  assetResFileInput: $('assetResFileInput'),
  assetTargetSubdirInput: $('assetTargetSubdirInput'),
  assetTargetFileNameInput: $('assetTargetFileNameInput'),
  assetSymbolNameInput: $('assetSymbolNameInput'),
  projectModal: $('projectModal'),
  btnProjectModalClose: $('btnProjectModalClose'),
  btnProjectModalCancel: $('btnProjectModalCancel'),
  btnProjectModalCreate: $('btnProjectModalCreate'),
  projectSystemNameInput: $('projectSystemNameInput'),
  projectParentDirInput: $('projectParentDirInput'),
  btnProjectParentDirBrowse: $('btnProjectParentDirBrowse'),
  projectTemplateSelect: $('projectTemplateSelect'),
  projectTemplateHint: $('projectTemplateHint'),
  projectPickerModal: $('projectPickerModal'),
  btnProjectPickerClose: $('btnProjectPickerClose'),
  btnProjectPickerCancel: $('btnProjectPickerCancel'),
  btnProjectPickerOpenFolder: $('btnProjectPickerOpenFolder'),
  btnProjectPickerNew: $('btnProjectPickerNew'),
  projectPickerRoot: $('projectPickerRoot'),
  projectPickerList: $('projectPickerList'),
  exportModal: $('exportModal'),
  btnExportModalClose: $('btnExportModalClose'),
  btnExportModalCancel: $('btnExportModalCancel'),
  btnExportRom: $('btnExportRom'),
  btnExportHtml: $('btnExportHtml'),
  resFileSelect: $('resFileSelect'),
  assetSearchInput: $('assetSearchInput'),
  assetTableBody: $('assetTableBody'),
  assetTableHint: $('assetTableHint'),
  assetEditForm: $('assetEditForm'),
  assetNoSelectionHint: $('assetNoSelectionHint'),
  assetEditorPanel: $('assetEditorPanel'),
  assetEditorActions: $('assetEditorActions'),
  btnDeleteAssetEntry: $('btnDeleteAssetEntry'),
  btnTogglePreviewPanel: $('btnTogglePreviewPanel'),
  assetsLayout: $('assetsLayout'),
  assetPreviewResizer: $('assetPreviewResizer'),
  assetPreviewPanel: $('assetPreviewPanel'),
  btnAccordionParams: $('btnAccordionParams'),
  accordionParamsBody: $('accordionParamsBody'),
  btnAccordionPreview: $('btnAccordionPreview'),
  accordionPreviewBody: $('accordionPreviewBody'),
  inlineImagePreview: $('inlineImagePreview'),
  inlinePreviewInfo: $('inlinePreviewInfo'),
  inlineImageZoom: $('inlineImageZoom'),
  inlineImageFrame: $('inlineImageFrame'),
  inlinePreviewImage: $('inlinePreviewImage'),
  inlinePalette: $('inlinePalette'),
  inlineAudioPreview: $('inlineAudioPreview'),
  audioPreviewMeta: $('audioPreviewMeta'),
  audioPlayer: $('audioPlayer'),
  btnAudioPlay: $('btnAudioPlay'),
  audioPlayIcon: $('audioPlayIcon'),
  audioSeek: $('audioSeek'),
  audioTime: $('audioTime'),
  inlineNoPreview: $('inlineNoPreview'),
  assetCommentInput: $('assetCommentInput'),
  assetResizeTargetWidth: $('assetResizeTargetWidth'),
  assetResizeTargetHeight: $('assetResizeTargetHeight'),
  audioConvertModal: $('audioConvertModal'),
  audioConvertBackdrop: $('audioConvertBackdrop'),
  btnAudioConvertClose: $('btnAudioConvertClose'),
  btnAudioConvertCancel: $('btnAudioConvertCancel'),
  btnAudioConvertApply: $('btnAudioConvertApply'),
  btnAudioConvertSkip: $('btnAudioConvertSkip'),
  btnAudioConvertRewind: $('btnAudioConvertRewind'),
  btnAudioConvertPreview: $('btnAudioConvertPreview'),
  btnAudioConvertPause: $('btnAudioConvertPause'),
  btnAudioConvertStop: $('btnAudioConvertStop'),
  btnAudioConvertLoop: $('btnAudioConvertLoop'),
  audioConvertPlayheadLabel: $('audioConvertPlayheadLabel'),
  btnAudioConvertSetStart: $('btnAudioConvertSetStart'),
  btnAudioConvertSetEnd: $('btnAudioConvertSetEnd'),
  audioConvertLevelLabel: $('audioConvertLevelLabel'),
  audioConvertPlayer: $('audioConvertPlayer'),
  audioConvertSourceLabel: $('audioConvertSourceLabel'),
  audioConvertWaveCanvas: $('audioConvertWaveCanvas'),
  audioConvertZoomSlider: $('audioConvertZoomSlider'),
  audioConvertScrollSlider: $('audioConvertScrollSlider'),
  audioConvertZoomLabel: $('audioConvertZoomLabel'),
  btnAudioConvertZoomIn: $('btnAudioConvertZoomIn'),
  btnAudioConvertZoomOut: $('btnAudioConvertZoomOut'),
  btnAudioConvertZoomReset: $('btnAudioConvertZoomReset'),
  audioConvertStartLabel: $('audioConvertStartLabel'),
  audioConvertEndLabel: $('audioConvertEndLabel'),
  audioConvertDurationLabel: $('audioConvertDurationLabel'),
  audioConvertSampleRateLabel: $('audioConvertSampleRateLabel'),
  audioConvertStartSlider: $('audioConvertStartSlider'),
  audioConvertEndSlider: $('audioConvertEndSlider'),
  audioConvertStartInput: $('audioConvertStartInput'),
  audioConvertEndInput: $('audioConvertEndInput'),
  audioConvertNormalizeInput: $('audioConvertNormalizeInput'),
  audioConvertVolumeDbInput: $('audioConvertVolumeDbInput'),
  audioConvertFadeInInput: $('audioConvertFadeInInput'),
  audioConvertFadeOutInput: $('audioConvertFadeOutInput'),
  audioConvertMonoInput: $('audioConvertMonoInput'),
  audioConvertSampleRateInput: $('audioConvertSampleRateInput'),
  audioConvertHint: $('audioConvertHint'),
  btnAudioConvertNormalizeApply: $('btnAudioConvertNormalizeApply'),
  resizeModal: $('resizeModal'),
  btnResizeModalClose: $('btnResizeModalClose'),
  resizeMode: $('resizeMode'),
  resizeDimGroup: $('resizeDimGroup'),
  resizeWidth: $('resizeWidth'),
  resizeHeight: $('resizeHeight'),
  resizeValidationMessage: $('resizeValidationMessage'),
  resizeOriginalSize: $('resizeOriginalSize'),
  resizePreviewCanvas: $('resizePreviewCanvas'),
  btnResizeCancel: $('btnResizeCancel'),
  btnResizeSkip: $('btnResizeSkip'),
  btnResizeApply: $('btnResizeApply'),
  quantizeModal: $('quantizeModal'),
  quantizeBackdrop: $('quantizeBackdrop'),
  btnQuantizeClose: $('btnQuantizeClose'),
  btnQuantizeCancel: $('btnQuantizeCancel'),
  btnQuantizeApply: $('btnQuantizeApply'),
  quantizeTransparencyMode: $('quantizeTransparencyMode'),
  quantizeColorPickerRow: $('quantizeColorPickerRow'),
  quantizeTransparencyColor: $('quantizeTransparencyColor'),
  quantizeTransparencyColorValue: $('quantizeTransparencyColorValue'),
  quantizeTransparencyColorSwatch: $('quantizeTransparencyColorSwatch'),
  quantizeUseSharedCustomColor: $('quantizeUseSharedCustomColor'),
  quantizeSharedColorRow: $('quantizeSharedColorRow'),
  quantizeDitheringEnabled: $('quantizeDitheringEnabled'),
  quantizeDitherMode: $('quantizeDitherMode'),
  quantizeDitheringWeight: $('quantizeDitheringWeight'),
  quantizeWeightLabel: $('quantizeWeightLabel'),
  quantizePattern: $('quantizePattern'),
  quantizeBrightness: $('quantizeBrightness'),
  quantizeBrightnessLabel: $('quantizeBrightnessLabel'),
  quantizeSaturation: $('quantizeSaturation'),
  quantizeSaturationLabel: $('quantizeSaturationLabel'),
  quantizePaletteAsset: $('quantizePaletteAsset'),
  quantizePaletteHint: $('quantizePaletteHint'),
  quantizeReferencePreview: $('quantizeReferencePreview'),
  quantizeReferenceThumb: $('quantizeReferenceThumb'),
  quantizeReferenceSize: $('quantizeReferenceSize'),
  quantizeReferencePalette: $('quantizeReferencePalette'),
  quantizeBeforeCanvas: $('quantizeBeforeCanvas'),
  quantizeAfterCanvas: $('quantizeAfterCanvas'),
  quantizeResultPalette: $('quantizeResultPalette'),
  quantizeStats: $('quantizeStats'),
};

const TITLE_MAX = 48;
const AUTHOR_MAX = 16;
const SERIAL_MAX = 14;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;
const SERIAL_RE = /^[A-Z]{2}\s[0-9A-Z]{8}-[0-9A-Z]{2}$/;

// ============================================================ BUILD LOG ===

function ensureLogSourceVisible(source) {
  if (!Object.prototype.hasOwnProperty.call(state.logs.sourceVisibility, source)) {
    state.logs.sourceVisibility[source] = true;
  }
}

function isEntryVisible(entry) {
  return isLogEntryVisible(entry, state.logs);
}

function appendLog(source, text, level = 'info') {
  const safeSource = String(source || 'app');
  const isNewSource = !Object.prototype.hasOwnProperty.call(state.logs.sourceVisibility, safeSource);
  ensureLogSourceVisible(safeSource);
  const entry = {
    source: safeSource,
    text: String(text || ''),
    level: String(level || 'info'),
    timestamp: Date.now(),
  };
  state.logs.entries.push(entry);
  window.electronAPI.appendLogWindowEntry?.(entry).catch?.(() => {});

  if (state.logs.entries.length > 4000) {
    state.logs.entries.splice(0, state.logs.entries.length - 4000);
    syncLogWindowSnapshot();
    renderLogPanel();
    return;
  }

  if (isNewSource) {
    renderLogSourceFilters();
  }

  const container = el.buildLog;
  if (!container || !isEntryVisible(entry)) return;
  appendLogLine(container, entry);
}

function appendBuildLog(text, level = 'info') {
  appendLog('build', text, level);
}

function getVisibleLogEntries() {
  return filterVisibleLogEntries(state.logs.entries, state.logs);
}

function renderLogSourceFilters() {
  if (!el.logSourceFilters) return;
  renderSharedLogSourceFilters(el.logSourceFilters, state.logs.sourceVisibility, (source, checked) => {
    state.logs.sourceVisibility[source] = checked;
    scheduleLogPanelRender();
  });
}

function renderLogPanel() {
  const container = el.buildLog;
  if (!container) return;
  logPanelRenderScheduled = false;
  renderLogSourceFilters();
  renderLogEntries(container, state.logs.entries, state.logs);
}

function scheduleLogPanelRender() {
  if (logPanelRenderScheduled) return;
  logPanelRenderScheduled = true;
  requestAnimationFrame(renderLogPanel);
}

function clearBuildLog() {
  state.logs.entries = [];
  syncLogWindowSnapshot();
  renderLogPanel();
}

function updateRomOutputActions() {
  const hasRom = !!state.lastRomPath;
  if (el.btnExport) {
    el.btnExport.disabled = !hasRom;
    el.btnExport.title = hasRom ? '最後にビルドされた ROM をエクスポート' : '先に Build を実行してください';
  }
  if (el.btnDownloadRom) {
    el.btnDownloadRom.disabled = !hasRom;
    el.btnDownloadRom.style.display = hasRom ? 'inline-flex' : 'none';
  }
}

async function copyBuildLog() {
  const text = getVisibleLogEntries()
    .map(formatLogEntryText)
    .join('\n');
  if (!text.trim()) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    el.btnCopyLog.title = 'コピーしました';
    setTimeout(() => {
      if (el.btnCopyLog) {
        el.btnCopyLog.title = 'ログをコピー';
      }
    }, 1200);
  } catch (_err) {
    const range = document.createRange();
    range.selectNodeContents(el.buildLog);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('copy');
    selection.removeAllRanges();
  }
}

async function openLogPopout() {
  try {
    const result = await window.electronAPI.openLogWindow?.(getLogSnapshot());
    if (!result?.ok) {
      appendLog('app', `ログウィンドウを開けませんでした: ${result?.error || 'unknown'}`, 'warn');
      return;
    }
    setLogDetached(true);
  } catch (err) {
    appendLog('app', `ログウィンドウを開けませんでした: ${String(err?.message || err)}`, 'warn');
  }
}

function setBuildStatus(type, text) {
  if (!el.buildStatusBadge) return;
  el.buildStatusBadge.textContent = text;
  el.buildStatusBadge.className = 'build-status-badge ' + (type || '');
}

function setLogOpen(open) {
  state.logOpen = open;
  el.buildLogBar?.classList.toggle('open', open);
  el.mainLayout?.classList.toggle('log-open', open);
  if (el.buildLogResizer) {
    el.buildLogResizer.style.display = open && !state.logDetached ? 'block' : 'none';
  }
  const use = el.btnToggleLog?.querySelector('use');
  if (use) use.setAttribute('href', open ? '#icon-chevron-down' : '#icon-chevron-up');
}

function setLogDetached(detached) {
  state.logDetached = Boolean(detached);
  el.buildLogBar?.classList.toggle('detached', state.logDetached);
  el.mainLayout?.classList.toggle('log-detached', state.logDetached);
  if (el.buildLogResizer) {
    el.buildLogResizer.style.display = state.logOpen && !state.logDetached ? 'block' : 'none';
  }
}

function setLogOpenHeight(height, options = {}) {
  const minHeight = 140;
  const maxHeight = Math.max(minHeight, Math.floor(window.innerHeight * 0.75));
  const next = Math.max(minHeight, Math.min(maxHeight, Number(height) || state.logOpenHeight));
  state.logOpenHeight = next;
  document.documentElement.style.setProperty('--log-h-open', `${next}px`);
  if (options.persist !== false) {
    saveLogViewerState();
  }
}

// ============================================================= PLUGINS ===

const pluginState = {
  plugins: [],
  generating: {},
  /** 現在ビルダーとして使用中のプラグイン ID (null = コードエディタ使用) */
  activeBuilderPlugin: null,
  /** 現在 Test Play 用に使用中のエミュレータープラグイン ID */
  activeEmulatorPlugin: null,
  /** Plugin Runtime v2.5 role selections. */
  activeRoles: {},
  /** サイドバー内プラグインアイコン順 (plugin.id の配列) */
  sidebarOrder: [],
  draggingSidebarPluginId: null,
};

const pluginRuntime = createPluginRuntime();
const pceAssetState = {
  loaded: false,
  loading: null,
  file: '',
  assets: [],
};

const SIDEBAR_PLUGIN_ORDER_KEY_PREFIX = 'md-editor.sidebarPluginOrder.v1';
const LOG_VIEWER_STATE_KEY = 'md-editor.logViewerState.v1';
const ASSET_PREVIEW_WIDTH_KEY = 'md-editor.assetPreviewWidth.v1';
const ASSET_PREVIEW_MIN_WIDTH = 280;
const ASSET_PREVIEW_MAX_WIDTH = 760;
const PROJECT_PLUGIN_STATE_EXCLUDED_ROLES = ['builder', 'testplay'];
const EXTERNAL_EMULATOR_PLUGIN_ID = 'pce-external-emulator';
const SIDEBAR_PLUGIN_ID_ALIASES = new Map([
  ['pce-font-editor', 'novel-editor'],
  ['pce-visual-novel-editor', 'novel-editor'],
  ['pce-music-editor', 'sound-editor'],
  ['pce-cdda-manager', 'sound-editor'],
  ['pce-adpcm-manager', 'sound-editor'],
  ['pce-background-manager', 'image-editor'],
  ['pce-sprite-manager', 'image-editor'],
  ['pce-palette-editor', 'image-editor'],
]);
let sidebarPluginContextMenu = null;
let logPanelRenderScheduled = false;

function loadLogViewerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_VIEWER_STATE_KEY) || '{}');
    return {
      openHeight: Number(parsed.openHeight) || state.logOpenHeight,
    };
  } catch (_) {
    return { openHeight: state.logOpenHeight };
  }
}

function saveLogViewerState() {
  try {
    localStorage.setItem(LOG_VIEWER_STATE_KEY, JSON.stringify({
      openHeight: state.logOpenHeight,
    }));
  } catch (_) {}
}

function getLogSnapshot() {
  return {
    entries: state.logs.entries.slice(-4000),
  };
}

function syncLogWindowSnapshot() {
  window.electronAPI.syncLogWindow?.(getLogSnapshot()).catch?.(() => {});
}

function pluginSupportsType(plugin, type) {
  const kinds = Array.isArray(plugin?.pluginTypes) ? plugin.pluginTypes : [];
  if (kinds.includes(type)) return true;
  if (plugin?.pluginType === type) return true;
  return false;
}

function pluginSupportsRole(plugin, roleId) {
  const role = String(roleId || '').trim();
  if (!role) return false;
  const roles = Array.isArray(plugin?.roles) ? plugin.roles : [];
  return roles.some((entry) => entry?.id === role);
}

function getAvailableCoreIds() {
  return (Array.isArray(state.project.cores) ? state.project.cores : [])
    .map((core) => String(core?.id || core || '').trim())
    .filter(Boolean);
}

function normalizeProjectCoreId(coreId) {
  const normalized = String(coreId || '').trim();
  const available = getAvailableCoreIds();
  if (available.length === 0) return normalized || 'pc-engine';
  return available.includes(normalized) ? normalized : available[0];
}

function getActiveCoreId() {
  return normalizeProjectCoreId(state.projectConfig?.coreId);
}

function pluginSupportsActiveCore(plugin) {
  const coreId = getActiveCoreId();
  const cores = Array.isArray(plugin?.supportedCores) ? plugin.supportedCores : ['mega-drive'];
  return cores.includes('*') || cores.includes(coreId);
}

function isStaticPageAvailableForActiveCore(pageId) {
  if (pageId === 'assets') return getActiveCoreId() === 'mega-drive';
  return true;
}

function isLegacyRescompAvailable() {
  return isStaticPageAvailableForActiveCore('assets');
}

function getRoleDefinitions() {
  const byId = new Map();
  pluginState.plugins.forEach((plugin) => {
    (Array.isArray(plugin.roles) ? plugin.roles : []).forEach((role) => {
      const id = String(role?.id || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        label: String(role.label || id),
        exclusive: role.exclusive !== false,
        order: Number.isFinite(Number(role.order)) ? Number(role.order) : 100,
      });
    });
  });
  return Array.from(byId.values()).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id, 'ja');
  });
}

function getEnabledPluginsByRole(roleId) {
  return pluginState.plugins.filter((p) => p.enabled && pluginSupportsActiveCore(p) && pluginSupportsRole(p, roleId));
}

function getPluginsByRole(roleId) {
  return pluginState.plugins.filter((p) => pluginSupportsActiveCore(p) && pluginSupportsRole(p, roleId));
}

function isProjectPluginStateManaged(plugin) {
  return !PROJECT_PLUGIN_STATE_EXCLUDED_ROLES.some((roleId) => pluginSupportsRole(plugin, roleId));
}

function getActiveRolePlugin(roleId) {
  return pluginState.activeRoles?.[roleId] || null;
}

function getPluginsByType(type) {
  return pluginState.plugins.filter((p) => pluginSupportsActiveCore(p) && pluginSupportsType(p, type));
}

function getEnabledPluginsByType(type) {
  return pluginState.plugins.filter((p) => p.enabled && pluginSupportsActiveCore(p) && pluginSupportsType(p, type));
}

function getPluginById(id) {
  return pluginState.plugins.find((p) => p.id === id) || null;
}

function isPluginFeatureEnabled(id) {
  const plugin = getPluginById(id);
  return plugin ? Boolean(plugin.enabled) : true;
}

function pluginHasDeclaredCapability(plugin, capability) {
  const capabilities = Array.isArray(plugin?.renderer?.capabilities)
    ? plugin.renderer.capabilities
    : [];
  return capabilities.includes(capability);
}

function getPluginRendererPageId(plugin) {
  return String(plugin?.renderer?.page || plugin?.tab?.page || '').trim();
}

function getPluginPageDomId(plugin) {
  const pageId = getPluginRendererPageId(plugin);
  if (!pageId) return '';
  const staticSection = document.getElementById(`page-${pageId}`);
  if (staticSection && !staticSection.dataset.pluginPageOwner) {
    return pageId;
  }
  const safePluginId = String(plugin?.id || 'plugin')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
  return `plugin-${safePluginId}`;
}

function createPluginLogger(plugin) {
  const source = `plugin:${plugin.id}:renderer`;
  return {
    info: (message) => appendLog(source, String(message || ''), 'info'),
    warn: (message) => appendLog(source, String(message || ''), 'warn'),
    error: (message) => appendLog(source, String(message || ''), 'error'),
    debug: (message) => appendLog(source, String(message || ''), 'debug'),
    log: (message) => appendLog(source, String(message || ''), 'info'),
  };
}

function registerPluginCapability(plugin, name, implementation = {}) {
  registerRuntimeCapability(pluginRuntime, plugin, name, implementation);
}

function getPluginCapability(name) {
  return getRuntimeCapability(pluginRuntime, name, isPluginFeatureEnabled);
}

function getPluginCapabilities(name) {
  return getRuntimeCapabilities(pluginRuntime, name, isPluginFeatureEnabled);
}

function listPluginCapabilities() {
  return listRuntimeCapabilities(pluginRuntime, isPluginFeatureEnabled);
}

function emitPluginRuntimeEvent(eventName, detail = {}) {
  const type = String(eventName || '').trim();
  if (!type) return;
  pluginRuntime.eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
}

function clonePceAssetResult(extra = {}) {
  return {
    ok: true,
    file: pceAssetState.file,
    ...extra,
    assets: pceAssetState.assets.slice(),
  };
}

function updatePceAssetCache(result = {}) {
  if (!result?.ok || !Array.isArray(result.assets)) return result;
  pceAssetState.loaded = true;
  pceAssetState.loading = null;
  pceAssetState.file = result.file || pceAssetState.file || '';
  pceAssetState.assets = result.assets.slice();
  return result;
}

function resetPceAssetCache() {
  pceAssetState.loaded = false;
  pceAssetState.loading = null;
  pceAssetState.file = '';
  pceAssetState.assets = [];
}

async function listPceAssets(options = {}) {
  const force = Boolean(options.force);
  if (!force && pceAssetState.loaded) return clonePceAssetResult();
  if (!force && pceAssetState.loading) return pceAssetState.loading;
  const request = window.electronAPI.listAssets()
    .then((result) => updatePceAssetCache(result))
    .finally(() => {
      pceAssetState.loading = null;
    });
  pceAssetState.loading = request;
  return request;
}

function emitPceAssetsChanged(action, result = {}, detail = {}) {
  emitPluginRuntimeEvent('assets:pce:changed', {
    action,
    file: result.file || pceAssetState.file,
    assets: Array.isArray(result.assets) ? result.assets.slice() : pceAssetState.assets.slice(),
    ...detail,
  });
}

async function mutatePceAssets(action, request, detail = {}) {
  const result = await request;
  if (result?.ok) {
    updatePceAssetCache(result);
    emitPceAssetsChanged(action, result, detail);
  }
  return result;
}

function getPluginIdForPage(pageId) {
  const button = Array.from(document.querySelectorAll('.nav-btn[data-page]'))
    .find((btn) => btn.dataset.page === pageId);
  return button?.dataset?.pluginId || '';
}

function createPceAssetApi() {
  return {
    listPceAssets,
    upsertPceAsset: (asset) => mutatePceAssets(
      'upsert',
      window.electronAPI.upsertAsset(asset || {}),
      { assetId: asset?.id || '' },
    ),
    deletePceAsset: (id) => mutatePceAssets(
      'delete',
      window.electronAPI.deleteAsset(id),
      { assetId: String(id || '') },
    ),
    importPceImage: (payload) => mutatePceAssets(
      'import-image',
      window.electronAPI.importAssetImage(payload || {}),
      { assetId: payload?.id || '', kind: payload?.kind || payload?.type || 'background' },
    ),
    importPceAudio: (payload) => mutatePceAssets(
      'import-audio',
      window.electronAPI.importAssetAudio(payload || {}),
      { assetId: payload?.id || '', kind: payload?.kind || payload?.type || 'adpcm' },
    ),
    importPceVgm: (payload) => mutatePceAssets(
      'import-vgm',
      window.electronAPI.importAssetVgm(payload || {}),
      { assetId: payload?.id || '', kind: payload?.kind || payload?.type || 'psg' },
    ),
    importPceMidi: (payload) => mutatePceAssets(
      'import-midi',
      window.electronAPI.importAssetMidi(payload || {}),
      { assetId: payload?.id || '', kind: payload?.kind || payload?.type || 'psg' },
    ),
    previewPceMidi: (payload) => window.electronAPI.previewAssetMidi(payload || {}),
    reorderPceAssets: (ids) => mutatePceAssets(
      'reorder',
      window.electronAPI.reorderAssets(ids || []),
      { ids: Array.isArray(ids) ? ids.slice() : [] },
    ),
    previewPceAssetSource: (relativePath) => window.electronAPI.previewAssetSource(relativePath),
  };
}

function getAssetTypeInfo(file = {}) {
  const providers = getPluginCapabilities('asset-type-provider');
  for (const provider of providers) {
    if (typeof provider?.getTypeInfo !== 'function') continue;
    try {
      const info = provider.getTypeInfo(file);
      if (info && typeof info === 'object') return info;
    } catch (err) {
      appendLog('app', `asset-type-provider エラー: ${String(err?.message || err)}`, 'warn');
    }
  }
  const initialType = inferTypeFromExtension(file.ext);
  const isAudioInput = AUDIO_EXTS.includes(String(file.ext || '').toLowerCase());
  const fileName = String(file.fileName || '');
  return {
    initialType,
    allowedTypes: getAllowedAssetTypesForExtension(file.ext, TYPE_OPTIONS),
    defaultSubdir: defaultSubDirForType(initialType),
    defaultSymbol: normalizeSymbolName(fileName),
    suggestedFileName: initialType === 'WAV' && isAudioInput
      ? `${fileName.replace(/\.[^.]+$/, '')}.wav`
      : fileName,
    isImageInput: IMAGE_EXTS.includes(String(file.ext || '').toLowerCase()),
    isAudioInput,
  };
}

function waitForPluginCapability(name, timeoutMs = 3000) {
  return waitForRuntimeCapability(pluginRuntime, name, timeoutMs, getPluginCapability);
}

function getPluginDomId(plugin, suffix) {
  const safeId = String(plugin?.id || 'plugin')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
  return `plugin-${safeId}-${suffix}`;
}

function ensurePluginPageRoot(plugin) {
  const pageId = getPluginPageDomId(plugin);
  if (!pageId) return null;

  let section = document.getElementById(`page-${pageId}`);
  if (section) {
    if (section.dataset.pluginPageOwner === plugin.id) return section;
    if (!section.dataset.pluginPageOwner && getPluginRendererPageId(plugin) === pageId) return section;
  }

  section = document.createElement('section');
  section.className = 'editor-page';
  section.id = `page-${pageId}`;
  section.dataset.pluginPageOwner = plugin.id;
  section.dataset.pluginRendererPage = getPluginRendererPageId(plugin);
  const host = document.querySelector('.editor-area');
  host?.appendChild(section);
  return section;
}

function ensurePluginHostRoot(plugin) {
  let root = document.getElementById(getPluginDomId(plugin, 'runtime-root'));
  if (root) return root;

  root = document.createElement('div');
  root.id = getPluginDomId(plugin, 'runtime-root');
  root.className = 'plugin-runtime-root';
  root.dataset.pluginHostOwner = plugin.id;
  document.body.appendChild(root);
  pluginRuntime.hostRoots.push(root);
  return root;
}

function createPluginModal(plugin, options = {}) {
  const id = String(options.id || getPluginDomId(plugin, 'modal')).trim();
  if (!id) throw new Error('modal id is required');

  let modal = document.getElementById(id);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = id;
    modal.className = options.className || 'app-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.dataset.pluginModalOwner = plugin.id;

    const backdrop = document.createElement('div');
    backdrop.className = options.backdropClassName || 'app-backdrop';
    backdrop.dataset.modalClose = id;
    modal.appendChild(backdrop);

    const panel = document.createElement('section');
    panel.className = options.panelClassName || 'app-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (options.labelledBy) panel.setAttribute('aria-labelledby', String(options.labelledBy));
    if (options.html) panel.innerHTML = String(options.html);
    modal.appendChild(panel);

    ensurePluginHostRoot(plugin).appendChild(modal);
    backdrop.addEventListener('click', () => closeModal(modal));
  }

  return {
    modal,
    panel: modal.querySelector('[role="dialog"]') || modal,
    open: () => openModal(modal),
    close: () => closeModal(modal),
    destroy: () => modal.remove(),
  };
}

function mountPluginElement(plugin, element, target = 'host') {
  if (!(element instanceof Element)) {
    throw new Error('mountPluginElement expects a DOM Element');
  }
  const parent = target === 'page'
    ? ensurePluginPageRoot(plugin) || ensurePluginHostRoot(plugin)
    : ensurePluginHostRoot(plugin);
  element.dataset.pluginMountedBy = plugin.id;
  parent.appendChild(element);
  return element;
}

function createPluginHostApi(plugin, roots = {}) {
  const on = (eventName, handler) => {
    const type = String(eventName || '').trim();
    if (!type || typeof handler !== 'function') return () => {};
    const listener = (event) => handler(event.detail, event);
    pluginRuntime.eventTarget.addEventListener(type, listener);
    return () => pluginRuntime.eventTarget.removeEventListener(type, listener);
  };

  return {
    electronAPI: window.electronAPI,
    roots,
    openModal,
    closeModal,
    createModal: (options) => createPluginModal(plugin, options),
    mountElement: (element, target) => mountPluginElement(plugin, element, target),
    unmountElement: (element) => element?.remove?.(),
    capabilities: {
      get: getPluginCapability,
      all: getPluginCapabilities,
      list: listPluginCapabilities,
      require: waitForPluginCapability,
    },
    plugins: {
      invokeHook: (id, hook, payload) => window.electronAPI.invokePluginHook(id, hook, payload),
    },
    assets: {
      ...createPceAssetApi(),
      reloadResources: async (options = {}) => {
        if (isLegacyRescompAvailable()) {
          await loadResDefinitions({ keepSelection: options.keepSelection !== false });
        }
        await refreshProjectList();
        if (el.assetTableHint) {
          el.assetTableHint.textContent = isLegacyRescompAvailable()
            ? 'リソースを再読み込みしました'
            : 'PCE アセットはプラグイン側で管理しています';
        }
        return { ok: true };
      },
    },
    events: {
      emit: (eventName, detail) => {
        const type = String(eventName || '').trim();
        if (type) pluginRuntime.eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
      },
      on,
      off: (unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe();
      },
    },
    openResizeModal,
    openQuantizeModal,
    openAudioConvertModal,
    countUniqueColors,
    imageDataToIndexedPng,
  };
}

function clearPluginRuntime() {
  clearRuntimeState(pluginRuntime, (err) => {
    appendLog('app', `プラグイン renderer 停止失敗: ${String(err?.message || err)}`, 'warn');
  });
  document.querySelectorAll('.editor-page[data-plugin-page-owner]').forEach((page) => page.remove());
}

function showPluginRendererError(plugin, root, err) {
  if (!root) return;
  const message = String(err?.message || err || 'unknown error');
  root.innerHTML = `
    <div class="plugin-renderer-error">
      <h2>${escHtml(plugin?.name || plugin?.id || 'Plugin')} を読み込めませんでした</h2>
      <p>プラグイン renderer の初期化に失敗しました。詳細は Log を確認してください。</p>
      <pre>${escHtml(message)}</pre>
    </div>
  `;
}

async function activatePluginRenderers() {
  clearPluginRuntime();

  for (const plugin of pluginState.plugins) {
    if (!pluginSupportsActiveCore(plugin)) continue;
    if (!plugin.enabled || !plugin.hasRenderer || !plugin.rendererAssets?.scriptUrl) continue;

    const pageRoot = ensurePluginPageRoot(plugin);
    const hostRoot = ensurePluginHostRoot(plugin);
    const root = pageRoot || hostRoot;
    (plugin.rendererAssets.styleUrls || []).forEach((styleUrl) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = styleUrl;
      link.dataset.pluginStyle = plugin.id;
      document.head.appendChild(link);
      pluginRuntime.styleLinks.push(link);
    });

    const logger = createPluginLogger(plugin);
    try {
      const cacheKey = encodeURIComponent(`${plugin.id}-${plugin.version}-${Date.now()}`);
      const module = await import(`${plugin.rendererAssets.scriptUrl}?v=${cacheKey}`);
      if (typeof module.activatePlugin !== 'function') {
        logger.warn('activatePlugin が見つかりません');
        continue;
      }
      const activation = await module.activatePlugin({
        plugin,
        root,
        pageRoot,
        hostRoot,
        api: createPluginHostApi(plugin, { root, pageRoot, hostRoot }),
        logger,
        registerCapability: (name, implementation) => registerPluginCapability(plugin, name, implementation),
      });
      if (activation && typeof activation.deactivate === 'function') {
        pluginRuntime.activations.set(plugin.id, activation);
      }
    } catch (err) {
      logger.error(`renderer 読み込み失敗: ${String(err?.message || err)}`);
      showPluginRendererError(plugin, root, err);
    }
  }
}

function getFirstVisiblePageId() {
  const candidates = ['assets', 'code', 'plugins', 'settings'];
  return candidates.find((pageId) => {
    const sec = document.getElementById(`page-${pageId}`);
    return sec && !sec.hidden && isStaticPageAvailableForActiveCore(pageId);
  }) || 'plugins';
}

function resolvePluginPageId(plugin) {
  const pageId = getPluginPageDomId(plugin);
  if (pageId && document.getElementById(`page-${pageId}`)) {
    return pageId;
  }
  return null;
}

function resolvePluginIconId(iconName) {
  const suffix = String(iconName || '').trim().toLowerCase();
  const candidate = suffix ? `icon-${suffix}` : '';
  if (candidate && document.getElementById(candidate)) {
    return candidate;
  }
  return 'icon-puzzle';
}

function getSidebarPluginOrderStorageKey() {
  const scope = String(state.project?.dir || 'default').trim().toLowerCase();
  return `${SIDEBAR_PLUGIN_ORDER_KEY_PREFIX}:${scope}`;
}

function getProjectPluginSettings() {
  const settings = state.projectConfig?.pluginSettings;
  return settings && typeof settings === 'object' ? settings : {};
}

function getProjectPluginEnabledSettings() {
  const enabled = getProjectPluginSettings().enabled;
  return enabled && typeof enabled === 'object' ? enabled : {};
}

function getProjectPluginSidebarOrder() {
  const order = getProjectPluginSettings().sidebarOrder;
  return Array.isArray(order) ? order.filter((id) => typeof id === 'string' && id.trim()) : [];
}

function normalizeSidebarPluginId(id) {
  const value = String(id || '').trim();
  return SIDEBAR_PLUGIN_ID_ALIASES.get(value) || value;
}

function normalizeSidebarPluginIdList(ids = []) {
  const seen = new Set();
  const normalized = [];
  ids.forEach((id) => {
    const nextId = normalizeSidebarPluginId(id);
    if (!nextId || seen.has(nextId)) return;
    seen.add(nextId);
    normalized.push(nextId);
  });
  return normalized;
}

function getCurrentProjectPluginEnabledState() {
  const enabled = {};
  pluginState.plugins
    .filter((plugin) => isProjectPluginStateManaged(plugin))
    .forEach((plugin) => {
      enabled[plugin.id] = Boolean(plugin.enabled);
    });
  return enabled;
}

async function persistProjectPluginSettings(patch = {}) {
  const current = getProjectPluginSettings();
  const next = {
    ...current,
    ...patch,
  };
  if (patch.enabled && typeof patch.enabled === 'object') {
    next.enabled = { ...patch.enabled };
  }
  if (Array.isArray(patch.sidebarOrder)) {
    next.sidebarOrder = patch.sidebarOrder.slice();
  }

  const result = await window.electronAPI.saveProjectConfig({ pluginSettings: next });
  if (!result?.ok) {
    throw new Error(result?.error || 'unknown');
  }
  if (result?.ok && result.config) {
    state.projectConfig = result.config;
  }
  return result;
}

function loadSidebarPluginOrder() {
  try {
    const projectOrder = getProjectPluginSidebarOrder();
    if (projectOrder.length > 0) {
      pluginState.sidebarOrder = normalizeSidebarPluginIdList(projectOrder);
      return;
    }
    const raw = localStorage.getItem(getSidebarPluginOrderStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    pluginState.sidebarOrder = Array.isArray(parsed) ? normalizeSidebarPluginIdList(parsed.filter((v) => typeof v === 'string')) : [];
  } catch (_) {
    pluginState.sidebarOrder = [];
  }
}

function saveSidebarPluginOrder() {
  try {
    localStorage.setItem(getSidebarPluginOrderStorageKey(), JSON.stringify(pluginState.sidebarOrder));
  } catch (_) {}
  persistProjectPluginSettings({ sidebarOrder: pluginState.sidebarOrder }).catch((err) => {
    appendLog('app', `サイドパネル順序の保存に失敗: ${String(err?.message || err)}`, 'warn');
  });
}

function getSidebarEnabledTabPlugins() {
  return pluginState.plugins.filter((plugin) => pluginSupportsActiveCore(plugin) && plugin.enabled && plugin.tab && resolvePluginPageId(plugin));
}

function isSidebarTogglePlugin(plugin) {
  return Boolean(plugin?.tab && plugin?.hasRenderer && getPluginRendererPageId(plugin));
}

function pluginHasDependency(plugin, dependencyId) {
  const id = String(dependencyId || '').trim();
  if (!id) return false;
  return Array.isArray(plugin?.dependencies) && plugin.dependencies.includes(id);
}

function isDedicatedBuilderEditorPlugin(plugin) {
  if (!isSidebarTogglePlugin(plugin) || pluginSupportsRole(plugin, 'builder')) return false;
  return pluginState.plugins.some((candidate) => (
    candidate?.id
    && candidate.id !== plugin.id
    && pluginSupportsRole(candidate, 'builder')
    && pluginHasDependency(plugin, candidate.id)
    && pluginHasDependency(candidate, plugin.id)
  ));
}

function isSidebarContextMenuPlugin(plugin) {
  return isSidebarTogglePlugin(plugin) && !isDedicatedBuilderEditorPlugin(plugin);
}

function getSidebarTogglePlugins() {
  return pluginState.plugins
    .filter((plugin) => pluginSupportsActiveCore(plugin) && isSidebarTogglePlugin(plugin))
    .sort((a, b) => {
      const orderA = Number(a?.tab?.order ?? 1000);
      const orderB = Number(b?.tab?.order ?? 1000);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.tab?.label || a?.name || a?.id || '').localeCompare(String(b?.tab?.label || b?.name || b?.id || ''), 'ja');
    });
}

function getSidebarContextMenuPlugins() {
  return getSidebarTogglePlugins()
    .filter((plugin) => isSidebarContextMenuPlugin(plugin));
}

function normalizeSidebarPluginOrder() {
  const previous = pluginState.sidebarOrder.slice();
  const orderedIds = [];
  const seen = new Set();
  const validIds = new Set(getSidebarTogglePlugins().map((p) => p.id));

  pluginState.sidebarOrder.forEach((id) => {
    const normalizedId = normalizeSidebarPluginId(id);
    if (validIds.has(normalizedId) && !seen.has(normalizedId)) {
      seen.add(normalizedId);
      orderedIds.push(normalizedId);
    }
  });

  const missing = getSidebarTogglePlugins()
    .sort((a, b) => {
      const orderA = Number(a?.tab?.order ?? 1000);
      const orderB = Number(b?.tab?.order ?? 1000);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), 'ja');
    })
    .map((p) => p.id)
    .filter((id) => !seen.has(id));

  pluginState.sidebarOrder = [...orderedIds, ...missing];
  if (
    previous.length !== pluginState.sidebarOrder.length
    || previous.some((id, index) => id !== pluginState.sidebarOrder[index])
  ) {
    saveSidebarPluginOrder();
  }
}

function clearSidebarDnDClasses() {
  el.sidebarPluginTabs?.querySelectorAll('.nav-btn-plugin').forEach((btn) => {
    btn.classList.remove('dragging', 'drop-before', 'drop-after');
  });
}

function reorderSidebarPluginByDrop(sourceId, targetId, placeAfter) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const next = [...pluginState.sidebarOrder];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const [moved] = next.splice(sourceIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetId);
  const insertIndex = placeAfter ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  next.splice(Math.max(0, insertIndex), 0, moved);

  pluginState.sidebarOrder = next;
  saveSidebarPluginOrder();
  renderPluginSidebarTabs();
}

function bindPluginSidebarTabDnD() {
  if (!el.sidebarPluginTabs) return;
  const buttons = Array.from(el.sidebarPluginTabs.querySelectorAll('.nav-btn-plugin[data-plugin-id]'));
  buttons.forEach((btn) => {
    btn.addEventListener('dragstart', (event) => {
      const pluginId = btn.dataset.pluginId || '';
      if (!pluginId) return;
      pluginState.draggingSidebarPluginId = pluginId;
      btn.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', pluginId);
      }
    });

    btn.addEventListener('dragover', (event) => {
      const sourceId = pluginState.draggingSidebarPluginId;
      const targetId = btn.dataset.pluginId || '';
      if (!sourceId || !targetId || sourceId === targetId) return;

      event.preventDefault();
      const rect = btn.getBoundingClientRect();
      const placeAfter = (event.clientY - rect.top) >= rect.height / 2;
      btn.classList.toggle('drop-before', !placeAfter);
      btn.classList.toggle('drop-after', placeAfter);
    });

    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drop-before', 'drop-after');
    });

    btn.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourceId = pluginState.draggingSidebarPluginId;
      const targetId = btn.dataset.pluginId || '';
      const rect = btn.getBoundingClientRect();
      const placeAfter = (event.clientY - rect.top) >= rect.height / 2;
      reorderSidebarPluginByDrop(sourceId, targetId, placeAfter);
      clearSidebarDnDClasses();
    });

    btn.addEventListener('dragend', () => {
      pluginState.draggingSidebarPluginId = null;
      clearSidebarDnDClasses();
    });
  });
}

function ensureSidebarPluginContextMenu() {
  if (sidebarPluginContextMenu?.isConnected) return sidebarPluginContextMenu;
  const menu = document.createElement('div');
  menu.className = 'sidebar-plugin-context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.addEventListener('click', (event) => event.stopPropagation());
  document.body.appendChild(menu);
  sidebarPluginContextMenu = menu;
  return menu;
}

function closeSidebarPluginContextMenu() {
  if (sidebarPluginContextMenu) {
    sidebarPluginContextMenu.hidden = true;
  }
}

function positionSidebarPluginContextMenu(menu, clientX, clientY) {
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const left = clamp(clientX, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const top = clamp(clientY, 8, Math.max(8, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function renderSidebarPluginContextMenuContent() {
  const menu = ensureSidebarPluginContextMenu();
  const plugins = getSidebarContextMenuPlugins();
  if (plugins.length === 0) {
    menu.innerHTML = `
      <div class="sidebar-plugin-menu-title">サイドパネル</div>
      <p class="sidebar-plugin-menu-empty">表示可能なプラグインはありません</p>
    `;
    return menu;
  }

  menu.innerHTML = `
    <div class="sidebar-plugin-menu-title">サイドパネル</div>
    <div class="sidebar-plugin-menu-list">
      ${plugins.map((plugin) => {
        const label = String(plugin.tab?.label || plugin.name || plugin.id);
        const iconId = resolvePluginIconId(plugin.icon || plugin.tab?.icon);
        return `
          <label class="sidebar-plugin-menu-item" title="${escHtml(plugin.name || plugin.id)}">
            <input type="checkbox" data-sidebar-plugin-toggle="${escHtml(plugin.id)}" ${plugin.enabled ? 'checked' : ''} />
            <svg class="icon-sm"><use href="#${escHtml(iconId)}"></use></svg>
            <span>${escHtml(label)}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;

  menu.querySelectorAll('[data-sidebar-plugin-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      const plugin = getPluginById(input.dataset.sidebarPluginToggle || '');
      if (!plugin) return;
      input.disabled = true;
      await setPluginEnabledFromUi(plugin, Boolean(input.checked), input);
      if (sidebarPluginContextMenu && !sidebarPluginContextMenu.hidden) {
        renderSidebarPluginContextMenuContent();
      }
    });
  });
  return menu;
}

function openSidebarPluginContextMenu(event) {
  event.preventDefault();
  const menu = renderSidebarPluginContextMenuContent();
  positionSidebarPluginContextMenu(menu, event.clientX, event.clientY);
}

function renderPluginSidebarTabs() {
  if (!el.sidebarPluginTabs) return;

  normalizeSidebarPluginOrder();
  const sidebarOrderIndex = new Map(pluginState.sidebarOrder.map((id, index) => [id, index]));

  const tabs = pluginState.plugins
    .filter((plugin) => pluginSupportsActiveCore(plugin) && plugin.enabled && plugin.tab)
    .sort((a, b) => {
      const sidebarOrderA = sidebarOrderIndex.has(a.id) ? sidebarOrderIndex.get(a.id) : Number.POSITIVE_INFINITY;
      const sidebarOrderB = sidebarOrderIndex.has(b.id) ? sidebarOrderIndex.get(b.id) : Number.POSITIVE_INFINITY;
      if (sidebarOrderA !== sidebarOrderB) return sidebarOrderA - sidebarOrderB;

      const orderA = Number(a?.tab?.order ?? 1000);
      const orderB = Number(b?.tab?.order ?? 1000);
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || a?.id || '').localeCompare(String(b?.name || b?.id || ''), 'ja');
    })
    .map((plugin) => {
      const pageId = resolvePluginPageId(plugin);
      if (!pageId) return null;
      const label = String(plugin.tab?.label || plugin.name || plugin.id);
      const iconId = resolvePluginIconId(plugin.icon || plugin.tab?.icon);
      return `
        <button class="nav-btn nav-btn-plugin" data-page="${escHtml(pageId)}" data-plugin-id="${escHtml(plugin.id)}" draggable="true" title="${escHtml(label)} - ドラッグで並び替え">
          <svg class="icon"><use href="#${escHtml(iconId)}"></use></svg>
          <span class="nav-label">${escHtml(label)}</span>
        </button>
      `;
    })
    .filter(Boolean);

  el.sidebarPluginTabs.innerHTML = tabs.join('');
  bindPluginSidebarTabDnD();
}

function getFirstSidebarPluginPageId() {
  return el.sidebarPluginTabs
    ?.querySelector('.nav-btn-plugin[data-page]')
    ?.dataset
    ?.page || '';
}

function applyPluginPageAvailability() {
  const pageBindings = new Map();
  const pluginById = new Map(pluginState.plugins.map((plugin) => [plugin.id, plugin]));
  pluginState.plugins.forEach((plugin) => {
    if (!pluginSupportsActiveCore(plugin)) return;
    const pageId = getPluginPageDomId(plugin);
    if (!pageId) return;
    const entries = pageBindings.get(pageId) || [];
    entries.push(plugin);
    pageBindings.set(pageId, entries);
  });

  document.querySelectorAll('.editor-page[data-plugin-page-owner]').forEach((section) => {
    const ownerId = section.dataset.pluginPageOwner || '';
    const owner = pluginById.get(ownerId);
    const pageId = section.id.replace(/^page-/, '');
    section.hidden = !(
      owner
      && getPluginPageDomId(owner) === pageId
      && pluginSupportsActiveCore(owner)
      && owner.enabled
      && (owner.hasRenderer || owner.tab)
    );
  });

  pageBindings.forEach((plugins, pageId) => {
    const section = document.getElementById(`page-${pageId}`);
    if (!section) return;
    if (section.dataset.pluginPageOwner) return;
    section.hidden = !isStaticPageAvailableForActiveCore(pageId)
      || !plugins.some((plugin) => pluginSupportsActiveCore(plugin) && plugin.enabled && (plugin.hasRenderer || plugin.tab));
  });

  document.querySelectorAll('.editor-page:not([data-plugin-page-owner])').forEach((section) => {
    const pageId = section.id.replace(/^page-/, '');
    if (!isStaticPageAvailableForActiveCore(pageId)) section.hidden = true;
  });

  if (el.pageCode?.hidden) {
    closeCodeCompletion();
  }

  const currentSection = document.getElementById(`page-${state.currentPage}`);
  if (!currentSection || currentSection.hidden) {
    switchPage(getFirstVisiblePageId());
  }
}

function applyBuildAvailability() {
  const builderId = getActiveRolePlugin('builder') || pluginState.activeBuilderPlugin;
  const builderPlugin = builderId
    ? getPluginById(builderId)
    : null;
  const enabled = Boolean(
    builderPlugin
    && pluginSupportsActiveCore(builderPlugin)
    && builderPlugin.enabled
    && pluginSupportsRole(builderPlugin, 'builder'),
  );

  if (el.btnBuild) {
    el.btnBuild.disabled = !enabled;
    el.btnBuild.title = enabled
      ? ''
      : '有効な Build プラグインが未設定です。Plugins 画面で有効化してください。';
  }
}

function applyTestPlayAvailability() {
  const emulatorId = getActiveRolePlugin('testplay') || pluginState.activeEmulatorPlugin;
  const emulatorPlugin = emulatorId
    ? getPluginById(emulatorId)
    : null;
  const enabled = Boolean(
    emulatorPlugin
    && pluginSupportsActiveCore(emulatorPlugin)
    && emulatorPlugin.enabled
    && pluginSupportsRole(emulatorPlugin, 'testplay'),
  );

  if (el.btnTestPlay) {
    el.btnTestPlay.disabled = !enabled;
    el.btnTestPlay.title = enabled
      ? ''
      : '有効な Emulator プラグインが未設定です。Plugins 画面で有効化してください。';
  }
}

function setPluginRoleStatus(message, kind = '') {
  if (!el.pluginRoleStatus) return;
  el.pluginRoleStatus.textContent = message || '';
  el.pluginRoleStatus.className = `plugin-role-status ${kind}`.trim();
}

function setPluginRoleAccordionOpen(open) {
  const button = el.btnPluginRoleAccordion;
  const body = el.pluginRoleBody;
  const next = Boolean(open);

  state.pluginUi.roleAccordionOpen = next;

  if (button) button.setAttribute('aria-expanded', String(next));
  if (body) body.classList.toggle('is-collapsed', !next);
}

async function setActiveBuilderPlugin(id) {
  pluginState.activeBuilderPlugin = id || null;
  pluginState.activeRoles = { ...(pluginState.activeRoles || {}), builder: id || null };
  try {
    const result = await window.electronAPI.setPluginRole('builder', id || null);
    if (!result?.ok) throw new Error(result?.error || 'unknown');
  } catch (err) {
    setPluginRoleStatus(`✕ Build プラグイン保存失敗: ${err?.message || err}`, 'err');
  }
  await loadPlugins();
  updateBuildButtonLabel();
  applyBuildAvailability();
}

async function setActiveEmulatorPlugin(id) {
  pluginState.activeEmulatorPlugin = id || null;
  pluginState.activeRoles = { ...(pluginState.activeRoles || {}), testplay: id || null };
  try {
    const result = await window.electronAPI.setPluginRole('testplay', id || null);
    if (!result?.ok) throw new Error(result?.error || 'unknown');
    setPluginRoleStatus('✓ Emulator プラグイン設定を保存しました', 'ok');
  } catch (err) {
    setPluginRoleStatus(`✕ Emulator プラグイン保存失敗: ${err?.message || err}`, 'err');
  }
  await loadPlugins();
  applyTestPlayAvailability();
  updateExternalEmulatorSettingsAvailability();
}

function updateBuildButtonLabel() {
  if (!el.btnBuild) return;
  const id = getActiveRolePlugin('builder') || pluginState.activeBuilderPlugin;
  if (id) {
    const p = pluginState.plugins.find((x) => x.id === id);
    el.btnBuild.title = `ビルダー: ${p ? p.name : id}`;
    el.btnBuild.dataset.pluginBuilder = id;
  } else {
    el.btnBuild.title = '';
    delete el.btnBuild.dataset.pluginBuilder;
  }
}

async function restoreProjectPluginRoleState() {
  const roles = pluginState.activeRoles && typeof pluginState.activeRoles === 'object'
    ? pluginState.activeRoles
    : {};
  let changed = false;

  for (const [roleId, pluginId] of Object.entries(roles)) {
    if (!roleId || !pluginId) continue;
    try {
      const result = await window.electronAPI.setPluginRole(roleId, pluginId);
      if (result?.ok && Array.isArray(result.changedIds) && result.changedIds.length > 0) {
        changed = true;
      }
    } catch (_) {
      // プロジェクト設定の復元に失敗しても、既存の検証処理で未対応 role は解除する。
    }
  }

  if (changed) {
    try {
      pluginState.plugins = await window.electronAPI.listPlugins({ includeIncompatible: true });
    } catch (_) {
      pluginState.plugins = [];
    }
  }
}

async function restoreProjectPluginEnabledState(options = {}) {
  const enabledSettings = getProjectPluginEnabledSettings();
  const resetUnspecified = Boolean(options.resetUnspecified);
  const hasSetting = (pluginId) => Object.prototype.hasOwnProperty.call(enabledSettings, pluginId);
  const targets = pluginState.plugins
    .filter((plugin) => isProjectPluginStateManaged(plugin))
    .map((plugin) => {
      if (hasSetting(plugin.id)) return [plugin.id, Boolean(enabledSettings[plugin.id])];
      return resetUnspecified ? [plugin.id, true] : null;
    })
    .filter(Boolean);
  if (targets.length === 0) return;

  let changed = false;
  for (const [pluginId, enabled] of targets) {
    const plugin = getPluginById(pluginId);
    if (!plugin || !isProjectPluginStateManaged(plugin)) continue;
    if (Boolean(plugin.enabled) === Boolean(enabled)) continue;
    try {
      const result = await window.electronAPI.setPluginEnabled(pluginId, Boolean(enabled));
      if (result?.ok && Array.isArray(result.changedIds) && result.changedIds.length > 0) {
        changed = true;
      }
    } catch (_) {
      // プロジェクト別の復元に失敗しても、残りのプラグイン復元を継続する。
    }
  }

  if (changed) {
    try {
      pluginState.plugins = await window.electronAPI.listPlugins({ includeIncompatible: true });
    } catch (_) {
      pluginState.plugins = [];
    }
  }
}

async function loadPlugins(options = {}) {
  if (!el.pluginList) return;
  if (options.resetSidebarSelection) {
    state.startup.selectedDefaultSidebarPage = false;
  }
  el.pluginList.innerHTML = '<p class="hint-text">読み込み中...</p>';
  setPluginRoleStatus('');
  try {
    pluginState.plugins = await window.electronAPI.listPlugins({ includeIncompatible: true });
  } catch (_) {
    pluginState.plugins = [];
  }

  if (!options.skipProjectPluginStateRestore) {
    await restoreProjectPluginEnabledState({ resetUnspecified: options.resetProjectPluginState });
  }

  loadSidebarPluginOrder();

  try {
    const savedRoles = await window.electronAPI.getPluginRoles?.();
    pluginState.activeRoles = (savedRoles?.roles && typeof savedRoles.roles === 'object') ? savedRoles.roles : {};
  } catch (_) {
    pluginState.activeRoles = {};
  }

  pluginState.activeBuilderPlugin = pluginState.activeRoles.builder || null;
  pluginState.activeEmulatorPlugin = pluginState.activeRoles.testplay || null;

  await restoreProjectPluginRoleState();

  // 未設定 & スライドショープラグインが有効なら自動でデフォルトに設定
  if (!pluginState.activeBuilderPlugin) {
    const defaultBuild = pluginState.plugins.find(
      (p) => pluginSupportsActiveCore(p) && p.enabled && pluginSupportsType(p, 'build'),
    );
    if (defaultBuild) {
      pluginState.activeBuilderPlugin = defaultBuild.id;
      pluginState.activeRoles.builder = defaultBuild.id;
      try { await window.electronAPI.setPluginRole('builder', defaultBuild.id); } catch (_) {}
    }
  }

  // emulator 未設定時は標準エミュレーター（WASM）を既定にする
  if (!pluginState.activeEmulatorPlugin) {
    const defaultEmulator = pluginState.plugins.find(
      (p) => pluginSupportsActiveCore(p) && p.enabled && pluginSupportsType(p, 'emulator'),
    );
    if (defaultEmulator) {
      pluginState.activeEmulatorPlugin = defaultEmulator.id;
      pluginState.activeRoles.testplay = defaultEmulator.id;
      try { await window.electronAPI.setPluginRole('testplay', defaultEmulator.id); } catch (_) {}
    }
  }

  // 非対応プラグインが設定されていた場合は解除
  const buildIds = new Set(getPluginsByRole('builder').map((p) => p.id));
  const emulatorIds = new Set(getPluginsByRole('testplay').map((p) => p.id));

  if (pluginState.activeBuilderPlugin && !buildIds.has(pluginState.activeBuilderPlugin)) {
    pluginState.activeBuilderPlugin = null;
    pluginState.activeRoles.builder = null;
    try { await window.electronAPI.setPluginRole('builder', null); } catch (_) {}
  }
  if (pluginState.activeEmulatorPlugin && !emulatorIds.has(pluginState.activeEmulatorPlugin)) {
    pluginState.activeEmulatorPlugin = null;
    pluginState.activeRoles.testplay = null;
    try { await window.electronAPI.setPluginRole('testplay', null); } catch (_) {}
  }

  await activatePluginRenderers();
  updateBuildButtonLabel();
  renderPluginSidebarTabs();
  applyPluginPageAvailability();
  if (!state.startup.selectedDefaultSidebarPage) {
    switchPage(getFirstSidebarPluginPageId() || getFirstVisiblePageId());
    state.startup.selectedDefaultSidebarPage = true;
  } else {
    switchPage(state.currentPage);
  }
  renderPluginRoleSettings();
  renderPluginList();
  appendLog('app', `プラグインをスキャン: ${pluginState.plugins.length} 件`);
  applyBuildAvailability();
  applyTestPlayAvailability();
  updateExternalEmulatorSettingsAvailability();
}

function renderPluginRoleSettings() {
  setPluginRoleAccordionOpen(state.pluginUi.roleAccordionOpen);

  const body = el.pluginRoleBody;
  if (!body) return;

  const roleDefinitions = getRoleDefinitions().filter((role) => role.exclusive !== false);
  if (roleDefinitions.length === 0) {
    body.innerHTML = '<p class="hint-text">単一選択 role を宣言しているプラグインはありません。</p>';
    return;
  }

  body.innerHTML = roleDefinitions.map((role) => {
    const plugins = getPluginsByRole(role.id);
    const activeId = getActiveRolePlugin(role.id) || '';
    const options = [`<option value="">${role.id === 'builder' ? 'ビルドプラグインなし' : '選択してください'}</option>`];
    plugins.forEach((p) => {
      const suffix = p.enabled ? '' : '（無効: 選択時に有効化）';
      options.push(`<option value="${escHtml(p.id)}"${p.id === activeId ? ' selected' : ''}>${escHtml(`${p.name}${suffix}`)}</option>`);
    });
    const hint = role.id === 'builder'
      ? 'Build ボタン実行時のコード生成とビルドフックに使用します。'
      : role.id === 'testplay'
        ? 'Test Play ボタン実行時の起動フックに使用します。'
        : `${role.label} role を提供するプラグインを選択します。`;
    return `
      <div class="plugin-role-card">
        <h3>${escHtml(role.label)} プラグイン（単一選択）</h3>
        <div class="plugin-role-row">
          <select class="form-input plugin-role-select" data-role-id="${escHtml(role.id)}">${options.join('')}</select>
        </div>
        <p class="form-hint">${escHtml(hint)}</p>
      </div>
    `;
  }).join('');

  body.querySelectorAll('.plugin-role-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const roleId = select.dataset.roleId || '';
      const nextId = select.value || null;
      pluginState.activeRoles = { ...(pluginState.activeRoles || {}), [roleId]: nextId };
      if (roleId === 'builder') pluginState.activeBuilderPlugin = nextId;
      if (roleId === 'testplay') pluginState.activeEmulatorPlugin = nextId;
      try {
        const result = await window.electronAPI.setPluginRole(roleId, nextId);
        if (!result?.ok) throw new Error(result?.error || 'unknown');
        setPluginRoleStatus(`✓ ${roleId} プラグイン設定を保存しました`, 'ok');
        await loadPlugins();
      } catch (err) {
        setPluginRoleStatus(`✕ ${roleId} プラグイン保存失敗: ${err?.message || err}`, 'err');
      }
      updateBuildButtonLabel();
      applyBuildAvailability();
      applyTestPlayAvailability();
      updateExternalEmulatorSettingsAvailability();
    });
  });
}

async function setPluginEnabledFromUi(plugin, desired, control = null) {
  const syncResult = await window.electronAPI.setPluginEnabled(plugin.id, desired);
  if (!syncResult?.ok) {
    if (control && 'checked' in control) {
      control.checked = !desired;
    }
    appendLog('app', `プラグイン "${plugin.name}" の更新に失敗: ${syncResult?.error || 'unknown'}`, 'error');
    if (control) control.disabled = false;
    return syncResult;
  }

  appendLog('app', `プラグイン "${plugin.name}" を${desired ? '有効化' : '無効化'}しました`);
  const changedIds = Array.isArray(syncResult.changedIds) ? syncResult.changedIds : [];
  if (changedIds.length > 1) {
    appendLog('app', `依存関係を同期: ${changedIds.join(', ')}`);
  }
  const missingDeps = Array.isArray(syncResult.missingDependencies) ? syncResult.missingDependencies : [];
  if (missingDeps.length > 0) {
    appendLog('app', `不足している依存プラグイン: ${missingDeps.join(', ')}`, 'warn');
  }

  if (!desired && pluginState.activeBuilderPlugin === plugin.id) {
    await setActiveBuilderPlugin(null);
  }
  if (!desired && pluginState.activeEmulatorPlugin === plugin.id) {
    await setActiveEmulatorPlugin(null);
  }
  Object.entries(pluginState.activeRoles || {}).forEach(([roleId, activeId]) => {
    if (!desired && activeId === plugin.id) {
      pluginState.activeRoles[roleId] = null;
      try { window.electronAPI.setPluginRole(roleId, null); } catch (_) {}
    }
  });

  try {
    pluginState.plugins = await window.electronAPI.listPlugins({ includeIncompatible: true });
    await persistProjectPluginSettings({ enabled: getCurrentProjectPluginEnabledState() });
  } catch (err) {
    appendLog('app', `プロジェクト別プラグイン状態の保存に失敗: ${String(err?.message || err)}`, 'warn');
  }
  await loadPlugins({ skipProjectPluginStateRestore: true });
  return syncResult;
}

function renderPluginList() {
  if (!el.pluginList) return;
  const visiblePlugins = getFilteredPlugins();
  if (pluginState.plugins.length === 0) {
    el.pluginList.innerHTML = '<p class="hint-text">pce-game-editor/plugins/ フォルダにプラグインが見つかりません。</p>';
    return;
  }
  if (visiblePlugins.length === 0) {
    el.pluginList.innerHTML = '<p class="hint-text">現在の検索条件に一致するプラグインがありません。</p>';
    return;
  }

  el.pluginList.innerHTML = '';
  visiblePlugins.forEach((plugin) => {
    const compatible = pluginSupportsActiveCore(plugin);
    const isActiveBuilder = (getActiveRolePlugin('builder') || pluginState.activeBuilderPlugin) === plugin.id;
    const isActiveEmulator = (getActiveRolePlugin('testplay') || pluginState.activeEmulatorPlugin) === plugin.id;
    const card = document.createElement('div');
    card.className = `plugin-card${plugin.enabled && compatible ? '' : ' plugin-card-disabled'}${isActiveBuilder ? ' plugin-card-active-builder' : ''}`;
    card.dataset.id = plugin.id;

    const dependencies = Array.isArray(plugin.dependencies) ? plugin.dependencies : [];
    const depText = dependencies.length > 0 ? `依存: ${dependencies.join(', ')}` : '';
    const permissions = Array.isArray(plugin.permissions) ? plugin.permissions : [];
    const permText = permissions.length > 0 ? `権限: ${permissions.join(', ')}` : '';
    const roleText = (Array.isArray(plugin.roles) && plugin.roles.length > 0)
      ? `Role: ${plugin.roles.map((role) => role.label || role.id).join(', ')}`
      : '';
    const coreText = compatible
      ? ''
      : `Core: ${(plugin.supportedCores || ['mega-drive']).join(', ')} / 現在の ${getActiveCoreId()} では非対応`;

    card.innerHTML = `
      <div class="plugin-card-header">
        <div class="plugin-card-meta">
          <span class="plugin-card-name">${escHtml(plugin.name)}</span>
          <span class="plugin-card-version">v${escHtml(plugin.version)}</span>
          <span class="plugin-card-types">${escHtml((plugin.pluginTypes || []).join(', ') || 'unknown')}</span>
          <span class="plugin-card-types">${escHtml((plugin.supportedCores || ['mega-drive']).join(', '))}</span>
          ${isActiveBuilder ? '<span class="plugin-builder-badge">🔨 ビルダー</span>' : ''}
          ${isActiveEmulator ? '<span class="plugin-builder-badge">🕹 Emulator</span>' : ''}
        </div>
        <label class="plugin-toggle" title="${plugin.enabled ? '無効にする' : '有効にする'}">
          <input type="checkbox" class="plugin-toggle-input" data-plugin-id="${escHtml(plugin.id)}"
            ${plugin.enabled ? 'checked' : ''} ${compatible ? '' : 'disabled'} />
          <span class="plugin-toggle-slider"></span>
        </label>
      </div>
      ${plugin.description ? `<p class="plugin-card-desc">${escHtml(plugin.description)}</p>` : ''}
      ${depText ? `<p class="plugin-card-deps">${escHtml(depText)}</p>` : ''}
      ${coreText ? `<p class="plugin-card-deps plugin-card-deps-warning">${escHtml(coreText)}</p>` : ''}
      ${permText ? `<p class="plugin-card-deps">${escHtml(permText)}</p>` : ''}
      ${roleText ? `<p class="plugin-card-deps">${escHtml(roleText)}</p>` : ''}
      <div class="plugin-card-actions">
        <span class="plugin-generate-result" id="plugin-result-${escHtml(plugin.id)}"></span>
      </div>
    `;

    // トグル
    const toggle = card.querySelector('.plugin-toggle-input');
    toggle?.addEventListener('change', async () => {
      const desired = Boolean(toggle.checked);
      toggle.disabled = true;
      await setPluginEnabledFromUi(plugin, desired, toggle);
    });

    // 生成 & ビルドボタン
    const genBtn = card.querySelector('.plugin-generate-btn');
    genBtn?.addEventListener('click', async () => {
      await runPluginGenerateAndBuild(plugin.id);
    });

    // ビルダーに設定ボタン
    const setBuilderBtn = card.querySelector('.plugin-set-builder-btn');
    setBuilderBtn?.addEventListener('click', async () => {
      await setActiveBuilderPlugin(plugin.id);
    });

    // ビルダー解除ボタン
    const clearBuilderBtn = card.querySelector('.plugin-builder-clear-btn');
    clearBuilderBtn?.addEventListener('click', async () => {
      await setActiveBuilderPlugin(null);
    });

    el.pluginList.appendChild(card);
  });
}

/** プラグインで生成してすぐビルドまで実行する */
async function runPluginGenerateAndBuild(id) {
  pluginState.generating[id] = true;
  renderPluginList();
  const resultEl = document.getElementById(`plugin-result-${id}`);
  try {
    const genResult = await window.electronAPI.runPluginGenerator(id);
    if (!genResult.ok) {
      if (resultEl) {
        resultEl.className = 'plugin-generate-result plugin-result-err';
        resultEl.textContent = `✗ ${genResult.error || '生成失敗'}`;
      }
      return;
    }
    if (resultEl) {
      resultEl.className = 'plugin-generate-result plugin-result-ok';
      resultEl.textContent = '✓ main.c を生成しました — ビルド開始...';
    }
  } finally {
    pluginState.generating[id] = false;
    renderPluginList();
  }
  // Build を走らせる (プラグイン生成済みなので _generatedByPlugin フラグを立てる)
  await runBuild({ _generatedByPlugin: id });
}

// ============================================================= PAGE NAV ===

function switchPage(page) {
  const requested = String(page || getFirstVisiblePageId());
  const targetId = `page-${requested}`;
  const target = document.getElementById(targetId);
  const next = target && !target.hidden ? requested : getFirstVisiblePageId();

  state.currentPage = next;
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === next);
  });
  document.querySelectorAll('.editor-page').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `page-${next}`);
  });
  emitPluginRuntimeEvent('page:activated', {
    pageId: next,
    pluginId: getPluginIdForPage(next),
  });
  if (next === 'code') {
    void loadCodeTree(undefined, { refreshOnly: state.code.dirty });
  }
}

// ============================================================= CODE FS ===

function updateCodeStatus(message) {
  if (el.codeStatus) {
    el.codeStatus.textContent = message || '';
  }
}

function formatProjectPath(pathValue = '') {
  return pathValue ? `project/${pathValue}` : 'project';
}

function normalizeCodePath(pathValue = '') {
  return String(pathValue || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function getCodeDisplayPath(pathValue = state.code.selectedPath) {
  return formatProjectPath(pathValue || '');
}

function getCodeEntryParentPath(pathValue = state.code.selectedPath) {
  const current = normalizeCodePath(pathValue);
  if (!current || state.code.selectedIsDirectory) return current;
  const index = current.lastIndexOf('/');
  return index >= 0 ? current.slice(0, index) : '';
}

function getCodeBaseName(pathValue = state.code.selectedPath) {
  const current = normalizeCodePath(pathValue);
  const index = current.lastIndexOf('/');
  return index >= 0 ? current.slice(index + 1) : current;
}

function joinCodePath(parent, name) {
  const cleanParent = normalizeCodePath(parent);
  const cleanName = normalizeCodePath(name);
  return cleanParent ? `${cleanParent}/${cleanName}` : cleanName;
}

function buildCodeEntryPath(name) {
  const cleanName = normalizeCodePath(String(name || '').trim());
  if (!cleanName) return '';
  const parent = getCodeEntryParentPath();
  return parent ? `${parent}/${cleanName}` : cleanName;
}

function codePathExists(nodes, pathValue) {
  return Boolean(findCodeTreeNode(nodes, pathValue));
}

function setCodeDirectoryCollapsed(pathValue, collapsed) {
  const normalized = String(pathValue || '');
  const next = new Set(state.code.collapsedDirs || []);
  if (collapsed) next.add(normalized);
  else next.delete(normalized);
  state.code.collapsedDirs = Array.from(next);
}

function isCodeDirectoryCollapsed(pathValue) {
  return (state.code.collapsedDirs || []).includes(String(pathValue || ''));
}

function collectAllDirPaths(nodes, result = []) {
  if (!Array.isArray(nodes)) return result;
  for (const node of nodes) {
    if (node.type === 'directory') {
      result.push(String(node.path || ''));
      collectAllDirPaths(node.children, result);
    }
  }
  return result;
}

function expandAllCodeDirs() {
  state.code.collapsedDirs = [];
  renderCodeTree();
}

function collapseAllCodeDirs() {
  state.code.collapsedDirs = collectAllDirPaths(state.code.tree);
  renderCodeTree();
}

function findCodeTreeNode(nodes, pathValue) {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (node.path === pathValue) return node;
    const child = findCodeTreeNode(node.children, pathValue);
    if (child) return child;
  }
  return null;
}

function setCodeDirty(dirty) {
  state.code.dirty = Boolean(dirty);
  const fileName = state.code.selectedPath || 'src/main.c';
  if (el.codeFileName) {
    el.codeFileName.textContent = `${state.code.selectedIsDirectory ? '📁' : '📄'} ${getCodeDisplayPath(fileName)}${state.code.dirty && !state.code.selectedIsDirectory ? ' *' : ''}`;
  }
  if (el.btnSaveCode) {
    el.btnSaveCode.disabled = state.code.selectedIsDirectory || state.code.selectedIsMedia;
  }
}

// ------------------------------------------------ C syntax highlight ----

const C_KEYWORDS = new Set([
  'auto','break','case','char','const','continue','default','do','double','else','enum',
  'extern','float','for','goto','if','inline','int','long','register','restrict','return',
  'short','signed','sizeof','static','struct','switch','typedef','union','unsigned',
  'void','volatile','while','_Bool','_Complex','_Imaginary',
]);
const C_TYPES = new Set([
  'u8','u16','u32','u64','s8','s16','s32','s64','fix16','fix32','bool','BOOL',
  'TRUE','FALSE','NULL','size_t','uint8_t','uint16_t','uint32_t','uint64_t',
  'int8_t','int16_t','int32_t','int64_t','pce_sector_t','vdc_sprite_t',
  'pce_editor_bg_asset_t','pce_editor_sprite_asset_t','pce_editor_adpcm_asset_t',
  'pce_vn_command_t','pce_vn_scene_t','pce_vn_message_t',
]);
const PCE_CODE_SYMBOLS = [
  'pce_vdc_set_resolution', 'pce_vdc_bg_set_size', 'pce_vdc_set_copy_word',
  'pce_vdc_copy_to_vram', 'pce_vdc_poke', 'pce_vdc_bg_enable', 'pce_vdc_bg_disable',
  'pce_vdc_sprite_enable', 'pce_vdc_sprite_disable', 'pce_vdc_sprite_set_table_start',
  'pce_joypad_read', 'pce_ram_bank128_map', 'pce_ram_bank129_map', 'pce_ram_bank132_map',
  'pce_cdb_wait_vblank', 'pce_cdb_irq_enable', 'pce_cdb_cd_read', 'pce_cdb_cdda_play',
  'pce_cdb_cdda_pause', 'pce_cdb_adpcm_play', 'pce_cdb_adpcm_stop',
  'PCE_CDB_LOCATION_TYPE_TRACK', 'PCE_CDB_LOCATION_TYPE_SECTOR', 'PCE_CDB_LOCATION_TYPE_TIME',
  'PCE_CDB_CDDA_PLAY_ONE_SHOT', 'PCE_CDB_CDDA_PLAY_REPEAT',
  'VCE_COLORBURST_ON', 'VDC_BG_SIZE_32_32', 'VDC_BG_SIZE_64_32',
  'VDC_CONTROL_ENABLE_BG', 'VDC_CONTROL_ENABLE_SPRITE', 'VDC_CONTROL_DRAM_REFRESH',
  'PAD_I', 'PAD_II', 'PAD_SEL', 'PAD_RUN', 'PAD_UP', 'PAD_RIGHT', 'PAD_DOWN', 'PAD_LEFT',
];
const BASE_CODE_COMPLETION_ITEMS = [
  ...Array.from(C_KEYWORDS).map((label) => ({ label, kind: 'keyword' })),
  ...Array.from(C_TYPES).map((label) => ({ label, kind: 'type' })),
];
const PCE_CODE_COMPLETION_ITEMS = [
  ...BASE_CODE_COMPLETION_ITEMS,
  ...PCE_CODE_SYMBOLS.map((label) => ({ label, kind: 'pce' })),
].sort((a, b) => a.label.localeCompare(b.label));

function getCodeCompletionItems() {
  return getActiveCoreId() === 'pc-engine'
    ? PCE_CODE_COMPLETION_ITEMS
    : BASE_CODE_COMPLETION_ITEMS;
}

function _escHtmlCode(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _highlightCSegment(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // String literal "..."
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      result += `<span class="hl-string">${_escHtmlCode(text.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }
    // Char literal '.'
    if (ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== "'") { if (text[j] === '\\') j++; j++; }
      result += `<span class="hl-string">${_escHtmlCode(text.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }
    // Number
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < text.length && /[0-9a-fA-FxXuUlL._]/.test(text[j])) j++;
      result += `<span class="hl-number">${_escHtmlCode(text.slice(i, j))}</span>`;
      i = j; continue;
    }
    // Identifier / keyword / type / function call
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (C_KEYWORDS.has(word)) {
        result += `<span class="hl-keyword">${_escHtmlCode(word)}</span>`;
      } else if (C_TYPES.has(word)) {
        result += `<span class="hl-type">${_escHtmlCode(word)}</span>`;
      } else if (text[j] === '(') {
        result += `<span class="hl-func">${_escHtmlCode(word)}</span>`;
      } else {
        result += _escHtmlCode(word);
      }
      i = j; continue;
    }
    result += _escHtmlCode(ch);
    i++;
  }
  return result;
}

function _highlightCLine(line) {
  // Line comment //
  const lcIdx = line.indexOf('//');
  if (lcIdx >= 0) {
    // Make sure not inside a string before //
    const beforeComment = line.slice(0, lcIdx);
    const singleQuotes = (beforeComment.match(/(?<!\\)"/g) || []).length;
    if (singleQuotes % 2 === 0) {
      return _highlightCSegment(beforeComment) + `<span class="hl-comment">${_escHtmlCode(line.slice(lcIdx))}</span>`;
    }
  }
  return _highlightCSegment(line);
}

function highlightC(text) {
  const lines = text.split('\n');
  let inBlock = false;
  const highlighted = lines.map((line) => {
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) return `<span class="hl-comment">${_escHtmlCode(line)}</span>`;
      inBlock = false;
      return `<span class="hl-comment">${_escHtmlCode(line.slice(0, end + 2))}</span>` + _highlightCLine(line.slice(end + 2));
    }
    // Preprocessor directive
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
      // Inline block comment check
      return `<span class="hl-preproc">${_escHtmlCode(line)}</span>`;
    }
    // Block comment start
    const bcStart = line.indexOf('/*');
    if (bcStart >= 0) {
      const bcEnd = line.indexOf('*/', bcStart + 2);
      if (bcEnd < 0) {
        inBlock = true;
        return _highlightCLine(line.slice(0, bcStart)) + `<span class="hl-comment">${_escHtmlCode(line.slice(bcStart))}</span>`;
      }
      return _highlightCLine(line.slice(0, bcStart)) +
        `<span class="hl-comment">${_escHtmlCode(line.slice(bcStart, bcEnd + 2))}</span>` +
        _highlightCLine(line.slice(bcEnd + 2));
    }
    return _highlightCLine(line);
  });
  return highlighted.join('\n');
}

function getCodeFindRegExp() {
  const query = state.code.findText || '';
  if (!query) return null;
  try {
    return new RegExp(query, 'gi');
  } catch (_err) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'gi');
  }
}

function getLineForOffset(text, offset) {
  return text.slice(0, Math.max(0, Number(offset) || 0)).split('\n').length;
}

function getCodeLines(content) {
  return String(content ?? '').split('\n');
}

function refreshCodeFindMatches() {
  const editor = el.codeEditor;
  const text = editor?.value || '';
  const re = getCodeFindRegExp();
  state.code.findMatches = [];
  if (!re) {
    state.code.findIndex = -1;
    return;
  }
  let match;
  while ((match = re.exec(text))) {
    state.code.findMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      line: getLineForOffset(text, match.index),
    });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  if (state.code.findMatches.length === 0) {
    state.code.findIndex = -1;
  } else if (state.code.findIndex < 0 || state.code.findIndex >= state.code.findMatches.length) {
    state.code.findIndex = 0;
  }
}

function getCodeLineClass(lineNumber) {
  const classes = ['code-highlight-line'];
  if (lineNumber === state.code.cursorLine) classes.push('cursor-line');
  if (state.code.findMatches.some((match) => match.line === lineNumber)) classes.push('find-line');
  if (state.code.findIndex >= 0 && state.code.findMatches[state.code.findIndex]?.line === lineNumber) {
    classes.push('find-current-line');
  }
  return classes.join(' ');
}

function wrapHighlightedCodeLines(highlighted, sourceText) {
  const highlightedLines = highlighted.split('\n');
  const sourceLines = getCodeLines(sourceText);
  const count = Math.max(highlightedLines.length, sourceLines.length, 1);
  return Array.from({ length: count }, (_, index) => {
    const lineNumber = index + 1;
    const html = highlightedLines[index] ?? '';
    return `<span class="${getCodeLineClass(lineNumber)}">${html || ' '}</span>`;
  }).join('');
}

function updateCodeEditorMetrics(content) {
  const editor = el.codeEditor;
  const highlight = el.codeHighlight;
  const scroller = el.codeScroller;
  if (!editor || !highlight || !scroller) return;

  const lineCount = getCodeLines(content).length;
  const computed = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
  const contentHeight = Math.ceil(lineCount * lineHeight + paddingTop + paddingBottom + 2);
  const minHeight = Math.max(contentHeight, scroller.clientHeight || 0);
  editor.style.height = `${minHeight}px`;
  highlight.style.height = `${minHeight}px`;
  highlight.style.minHeight = `${minHeight}px`;
}

function updateCodeEditor(content) {
  const lnEl = el.codeLineNumbers;
  const hlEl = el.codeHighlight;
  refreshCodeFindMatches();
  if (lnEl) {
    const count = getCodeLines(content).length;
    lnEl.innerHTML = Array.from(
      { length: count },
      (_, i) => `<span class="code-line-number">${i + 1}</span>`
    ).join('');
  }
  if (hlEl) {
    hlEl.innerHTML = wrapHighlightedCodeLines(highlightC(content), content);
  }
  updateCodeEditorMetrics(content);
}

function setCodeTextEditorVisible(visible) {
  el.codeArea?.classList.toggle('media-mode', !visible);
  if (el.codeMediaPreview) el.codeMediaPreview.hidden = visible;
  if (el.codeEditor) el.codeEditor.disabled = !visible || state.code.selectedIsDirectory;
  if (el.btnSaveCode) el.btnSaveCode.disabled = !visible || state.code.selectedIsDirectory;
  if (el.codeEncodingSelect) el.codeEncodingSelect.disabled = !visible;
  if (!visible) closeCodeCompletion();
}

// sync line numbers scroll with the code scroller
function bindCodeScrollSync() {
  el.codeScroller?.addEventListener('scroll', () => {
    if (el.codeLineNumbers) {
      el.codeLineNumbers.scrollTop = el.codeScroller.scrollTop;
    }
  });
}

function syncCodeCursorLineClass(previousLine, nextLine) {
  const lines = el.codeHighlight?.querySelectorAll('.code-highlight-line');
  if (!lines?.length) return;
  if (previousLine > 0 && previousLine !== nextLine) {
    lines[previousLine - 1]?.classList.remove('cursor-line');
  }
  if (nextLine > 0) {
    lines[nextLine - 1]?.classList.add('cursor-line');
  }
}

function updateCodeCursorLine() {
  const editor = el.codeEditor;
  if (!editor) return;
  const nextLine = getLineForOffset(editor.value || '', editor.selectionStart || 0);
  if (nextLine === state.code.cursorLine) return;
  const previousLine = state.code.cursorLine;
  state.code.cursorLine = nextLine;
  syncCodeCursorLineClass(previousLine, nextLine);
}

function openCodeFindPanel() {
  state.code.findOpen = true;
  if (el.codeFindPanel) el.codeFindPanel.hidden = false;
  requestAnimationFrame(() => {
    el.codeFindInput?.focus();
    el.codeFindInput?.select();
  });
  updateCodeEditor(el.codeEditor?.value || '');
}

function closeCodeFindPanel() {
  state.code.findOpen = false;
  state.code.findText = '';
  state.code.replaceText = '';
  state.code.findMatches = [];
  state.code.findIndex = -1;
  if (el.codeFindPanel) el.codeFindPanel.hidden = true;
  if (el.codeFindInput) el.codeFindInput.value = '';
  if (el.codeReplaceInput) el.codeReplaceInput.value = '';
  updateCodeEditor(el.codeEditor?.value || '');
}

function selectCodeFindMatch(index) {
  const editor = el.codeEditor;
  if (!editor || !state.code.findMatches.length) return;
  const count = state.code.findMatches.length;
  state.code.findIndex = ((index % count) + count) % count;
  const match = state.code.findMatches[state.code.findIndex];
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  state.code.cursorLine = match.line;
  updateCodeEditor(editor.value || '');
  const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight) || 20;
  if (el.codeScroller) {
    el.codeScroller.scrollTop = Math.max(0, (match.line - 3) * lineHeight);
  }
}

function updateCodeFindQuery() {
  state.code.findText = el.codeFindInput?.value || '';
  state.code.replaceText = el.codeReplaceInput?.value || '';
  refreshCodeFindMatches();
  updateCodeEditor(el.codeEditor?.value || '');
}

function findCodeNext(direction = 1) {
  refreshCodeFindMatches();
  if (!state.code.findMatches.length) {
    updateCodeEditor(el.codeEditor?.value || '');
    return;
  }
  selectCodeFindMatch(state.code.findIndex + direction);
}

function replaceCurrentCodeMatch() {
  const editor = el.codeEditor;
  if (!editor || !state.code.findMatches.length || state.code.findIndex < 0) return;
  const match = state.code.findMatches[state.code.findIndex];
  const replacement = state.code.replaceText || '';
  editor.value = `${editor.value.slice(0, match.start)}${replacement}${editor.value.slice(match.end)}`;
  const cursor = match.start + replacement.length;
  editor.setSelectionRange(cursor, cursor);
  setCodeDirty(true);
  updateCodeFindQuery();
  findCodeNext(0);
}

function replaceAllCodeMatches() {
  const editor = el.codeEditor;
  const re = getCodeFindRegExp();
  if (!editor || !re || !state.code.findText) return;
  const next = editor.value.replace(re, state.code.replaceText || '');
  if (next === editor.value) return;
  editor.value = next;
  setCodeDirty(true);
  state.code.findIndex = 0;
  updateCodeFindQuery();
}

function globToRegExp(pattern) {
  const escaped = String(pattern || '').replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
}

function getCodeTreeFilter() {
  const raw = (state.code.treeFilterText || '').trim();
  if (!raw) return { matches: () => true, error: '' };
  try {
    return { matches: (node) => new RegExp(raw, 'i').test(`${node.path} ${node.name}`), error: '' };
  } catch (_regexErr) {
    try {
      const glob = globToRegExp(raw);
      return { matches: (node) => glob.test(node.path || node.name || ''), error: '' };
    } catch (err) {
      return { matches: () => false, error: String(err?.message || err) };
    }
  }
}

function filterCodeTreeNodes(nodes, filter) {
  if (!Array.isArray(nodes)) return [];
  return nodes.reduce((result, node) => {
    if (node.type === 'directory') {
      const children = filterCodeTreeNodes(node.children || [], filter);
      if (filter.matches(node) || children.length > 0) {
        result.push({ ...node, children });
      }
      return result;
    }
    if (filter.matches(node)) result.push(node);
    return result;
  }, []);
}

function renderCodeTreeNodes(nodes, level = 0) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    const message = state.code.treeFilterText
      ? (state.code.treeFilterError ? `フィルタ式が不正です: ${state.code.treeFilterError}` : '一致するファイルがありません。')
      : 'プロジェクト内にファイルがありません。';
    return level === 0 ? `<div class="code-tree-empty">${escHtml(message)}</div>` : '';
  }
  return `<ul class="code-tree-list">${nodes.map((node) => {
    const isActive = node.path === state.code.selectedPath;
    const renameButton = isActive ? `
      <button class="code-tree-action code-tree-rename" data-path="${escHtml(node.path)}" title="リネーム">
        <svg class="icon"><use href="#icon-edit"></use></svg>
      </button>
    ` : '';
    if (node.type === 'directory') {
      const collapsed = isCodeDirectoryCollapsed(node.path);
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      return `<li class="code-tree-item">
        <div class="code-tree-node${isActive ? ' active' : ''}" data-path="${escHtml(node.path)}" data-kind="directory">
          <span class="code-tree-toggle">${hasChildren ? (collapsed ? '▸' : '▾') : ''}</span>
          <span class="code-tree-icon">📁</span>
          <span class="code-tree-label">${escHtml(node.name)}</span>
          ${renameButton}
        </div>
        ${collapsed ? '' : `<div class="code-tree-children">${renderCodeTreeNodes(node.children || [], level + 1)}</div>`}
      </li>`;
    }
    return `<li class="code-tree-item"><div class="code-tree-node${isActive ? ' active' : ''}" data-path="${escHtml(node.path)}" data-kind="file"><span class="code-tree-toggle"></span><span class="code-tree-icon">📄</span><span class="code-tree-label">${escHtml(node.name)}</span>${renameButton}</div></li>`;
  }).join('')}</ul>`;
}

function bindCodeTreeEvents() {
  el.codeTree?.querySelectorAll('.code-tree-rename').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await renameSelectedCodeEntry();
    });
  });
  el.codeTree?.querySelectorAll('.code-tree-node').forEach((node) => {
    node.addEventListener('click', async () => {
      const nextPath = node.getAttribute('data-path') || '';
      const kind = node.getAttribute('data-kind') || 'file';
      if (kind === 'directory') {
        if (state.code.dirty && !state.code.selectedIsDirectory && state.code.selectedPath !== nextPath) {
          const ok = window.confirm(`${getCodeDisplayPath(state.code.selectedPath)} の未保存変更を破棄して切り替えますか？`);
          if (!ok) return;
        }
        state.code.selectedPath = nextPath;
        state.code.selectedIsDirectory = true;
        state.code.selectedIsMedia = false;
        const treeNode = findCodeTreeNode(state.code.tree, nextPath);
        if (treeNode?.children?.length) {
          setCodeDirectoryCollapsed(nextPath, !isCodeDirectoryCollapsed(nextPath));
        }
        setCodeTextEditorVisible(true);
        setCodeDirty(false);
        updateCodeStatus(`フォルダを選択中: ${getCodeDisplayPath(nextPath)}`);
        renderCodeTree();
        return;
      }
      await openCodeFile(nextPath);
    });
  });
}

function renderCodeTree() {
  if (!el.codeTree) return;
  const filter = getCodeTreeFilter();
  state.code.treeFilterError = filter.error || '';
  el.codeTreeFilterInput?.classList.toggle('invalid', Boolean(state.code.treeFilterError));
  el.codeTree.innerHTML = renderCodeTreeNodes(filterCodeTreeNodes(state.code.tree, filter));
  bindCodeTreeEvents();
  setCodeDirty(state.code.dirty);
}

async function openCodeFile(pathValue) {
  if (state.code.dirty && !state.code.selectedIsDirectory && state.code.selectedPath !== pathValue) {
    const ok = window.confirm(`${getCodeDisplayPath(state.code.selectedPath)} の未保存変更を破棄して切り替えますか？`);
    if (!ok) return;
  }
  const result = await window.electronAPI.readCodeFile({
    path: pathValue,
    encoding: state.code.selectedEncoding,
  });
  if (!result?.ok) {
    updateCodeStatus(`読み込み失敗: ${result?.error || 'unknown'}`);
    return;
  }
  state.code.selectedPath = pathValue;
  state.code.selectedIsDirectory = false;
  state.code.selectedIsMedia = Boolean(result.media);
  if (result.media) {
    setCodeTextEditorVisible(false);
    if (el.codeMediaPreview) {
      if (result.previewKind === 'image') {
        el.codeMediaPreview.innerHTML = `<img src="${escHtml(result.dataUrl || '')}" alt="${escHtml(getCodeDisplayPath(pathValue))}" />`;
      } else if (result.previewKind === 'audio') {
        el.codeMediaPreview.innerHTML = `
          <div class="code-media-card">
            <strong>${escHtml(getCodeDisplayPath(pathValue))}</strong>
            <audio controls src="${escHtml(result.dataUrl || '')}"></audio>
          </div>
        `;
      } else {
        el.codeMediaPreview.innerHTML = `
          <div class="code-media-card">
            <strong>${escHtml(getCodeDisplayPath(pathValue))}</strong>
            <span>${Number(result.size || 0).toLocaleString()} bytes</span>
          </div>
        `;
      }
    }
    if (el.codeEditor) {
      el.codeEditor.value = '';
      updateCodeEditor('');
    }
  } else {
    state.code.activeEncoding = result.encoding || 'utf8';
    setCodeTextEditorVisible(true);
    if (el.codeMediaPreview) el.codeMediaPreview.innerHTML = '';
    if (el.codeEditor) {
      el.codeEditor.value = result.content || '';
      updateCodeEditor(result.content || '');
    }
  }
  setCodeDirty(false);
  renderCodeTree();
  const suffix = result.media ? 'をプレビュー中' : `を読み込みました (${state.code.activeEncoding === 'shift_jis' ? 'SJIS' : 'UTF-8'})`;
  updateCodeStatus(`${getCodeDisplayPath(pathValue)} ${suffix}`);
}

async function loadCodeTree(openPath, options = {}) {
  const result = await window.electronAPI.listCodeTree({ path: '' });
  if (!result?.ok) {
    updateCodeStatus(`プロジェクトツリー取得失敗: ${result?.error || 'unknown'}`);
    return;
  }
  state.code.tree = Array.isArray(result.entries) ? result.entries : [];
  if (!state.code.initialCollapseApplied) {
    state.code.collapsedDirs = collectAllDirPaths(state.code.tree);
    state.code.initialCollapseApplied = true;
  }
  renderCodeTree();
  if (options.refreshOnly) return;
  if (openPath) {
    await openCodeFile(openPath);
    return;
  }
  if (!state.code.selectedIsDirectory && state.code.selectedPath) {
    if (codePathExists(state.code.tree, state.code.selectedPath)) {
      await openCodeFile(state.code.selectedPath);
      return;
    }
  }
  if (codePathExists(state.code.tree, 'src/main.c')) {
    await openCodeFile('src/main.c');
  }
}

async function saveCurrentCodeFile() {
  if (state.code.selectedIsDirectory) {
    updateCodeStatus('フォルダは保存できません。ファイルを選択してください。');
    return false;
  }
  if (state.code.selectedIsMedia) {
    updateCodeStatus('メディアファイルはエディタから保存できません。');
    return false;
  }
  const targetPath = state.code.selectedPath || 'src/main.c';
  const writeEncoding = state.code.selectedEncoding === 'auto'
    ? state.code.activeEncoding
    : state.code.selectedEncoding;
  const result = await window.electronAPI.writeCodeFile({
    path: targetPath,
    content: el.codeEditor?.value || '',
    encoding: writeEncoding,
  });
  if (!result?.ok) {
    updateCodeStatus(`保存失敗: ${result?.error || 'unknown'}`);
    return false;
  }
  state.code.activeEncoding = result.encoding || writeEncoding || 'utf8';
  setCodeDirty(false);
  updateCodeStatus(`✓ ${getCodeDisplayPath(targetPath)} を保存しました`);
  await loadCodeTree(targetPath);
  return true;
}

const codeNameDialogState = {
  resolve: null,
  mode: 'create',
  kind: 'file',
};

function closeCodeNameDialog(value = null) {
  closeModal(el.codeEntryModal);
  const resolve = codeNameDialogState.resolve;
  codeNameDialogState.resolve = null;
  if (resolve) resolve(value);
}

function submitCodeNameDialog() {
  const value = normalizeCodePath((el.codeEntryNameInput?.value || '').trim());
  if (!value) {
    if (el.codeEntryNameError) el.codeEntryNameError.textContent = '名前を入力してください。';
    return;
  }
  if (value.includes('/')) {
    if (el.codeEntryNameError) el.codeEntryNameError.textContent = '名前には / や \\ を含められません。';
    return;
  }
  closeCodeNameDialog(value);
}

function openCodeNameDialog({ mode, kind, initialName = '' }) {
  if (!el.codeEntryModal || !el.codeEntryNameInput) {
    return Promise.resolve(window.prompt(mode === 'rename' ? '新しい名前' : '名前', initialName) || null);
  }
  codeNameDialogState.mode = mode;
  codeNameDialogState.kind = kind;
  if (el.codeEntryModalTitle) {
    if (mode === 'rename') {
      el.codeEntryModalTitle.textContent = 'リネーム';
    } else {
      el.codeEntryModalTitle.textContent = kind === 'directory' ? '新規フォルダ' : '新規ファイル';
    }
  }
  if (el.codeEntryNameError) el.codeEntryNameError.textContent = '';
  el.codeEntryNameInput.value = initialName || '';
  openModal(el.codeEntryModal);
  requestAnimationFrame(() => {
    el.codeEntryNameInput?.focus();
    el.codeEntryNameInput?.select();
  });
  return new Promise((resolve) => {
    codeNameDialogState.resolve = resolve;
  });
}

async function promptCreateCodeEntry(kind) {
  const name = await openCodeNameDialog({ mode: 'create', kind });
  if (!name) return;
  await createCodeEntry(kind, name);
}

async function createCodeEntry(kind, name) {
  const targetPath = buildCodeEntryPath(name);
  const result = await window.electronAPI.createCodeEntry({
    path: targetPath,
    type: kind,
    content: kind === 'file' ? '' : undefined,
  });
  if (!result?.ok) {
    updateCodeStatus(`作成失敗: ${result?.error || 'unknown'}`);
    return;
  }
  if (kind === 'directory') {
    setCodeDirectoryCollapsed(targetPath, false);
  }
  updateCodeStatus(`✓ ${getCodeDisplayPath(targetPath)} を作成しました`);
  await loadCodeTree(kind === 'file' ? targetPath : state.code.selectedPath);
}

async function renameSelectedCodeEntry() {
  const fromPath = state.code.selectedPath;
  if (!fromPath) {
    updateCodeStatus('リネーム対象が選択されていません。');
    return;
  }
  const currentNode = findCodeTreeNode(state.code.tree, fromPath);
  if (!currentNode) {
    updateCodeStatus('リネーム対象が見つかりません。');
    return;
  }
  const name = await openCodeNameDialog({
    mode: 'rename',
    kind: currentNode.type || 'file',
    initialName: getCodeBaseName(fromPath),
  });
  if (!name || name === getCodeBaseName(fromPath)) return;
  const parent = normalizeCodePath(fromPath).split('/').slice(0, -1).join('/');
  const toPath = joinCodePath(parent, name);
  const result = await window.electronAPI.renameCodeEntry?.({ fromPath, toPath });
  if (!result?.ok) {
    updateCodeStatus(`リネーム失敗: ${result?.error || 'unknown'}`);
    return;
  }
  state.code.selectedPath = toPath;
  updateCodeStatus(`✓ ${getCodeDisplayPath(fromPath)} を ${getCodeDisplayPath(toPath)} に変更しました`);
  await loadCodeTree(currentNode.type === 'file' ? toPath : undefined);
}

async function deleteSelectedCodeEntry() {
  if (!state.code.selectedPath) {
    updateCodeStatus('削除対象が選択されていません。');
    return;
  }
  const ok = window.confirm(`${getCodeDisplayPath(state.code.selectedPath)} を削除します。元に戻せません。`);
  if (!ok) return;
  const result = await window.electronAPI.deleteCodeEntry({ path: state.code.selectedPath });
  if (!result?.ok) {
    updateCodeStatus(`削除失敗: ${result?.error || 'unknown'}`);
    return;
  }
  state.code.selectedPath = 'src/main.c';
  state.code.selectedIsDirectory = false;
  state.code.selectedIsMedia = false;
  if (el.codeEditor) el.codeEditor.value = '';
  setCodeTextEditorVisible(true);
  setCodeDirty(false);
  updateCodeStatus(`✓ ${getCodeDisplayPath(result.path || '')} を削除しました`);
  await loadCodeTree();
}

function getFilteredPlugins() {
  const search = (state.pluginFilters.searchText || '').trim().toLowerCase();
  const type = state.pluginFilters.type || 'all';
  return pluginState.plugins.filter((plugin) => {
    if (!state.pluginFilters.showAllCores && !pluginSupportsActiveCore(plugin)) return false;
    if (type !== 'all' && !pluginSupportsType(plugin, type)) return false;
    if (!search) return true;
    const hay = `${plugin.id} ${plugin.name} ${plugin.description} ${(plugin.pluginTypes || []).join(' ')}`.toLowerCase();
    return hay.includes(search);
  });
}

// ========================================================== SAMPLE CODE ===

const HELLO_WORLD_C = `/**
 * Hello World - PCE Game Editor サンプル
 * PC Engine / llvm-mos 向けの最小構成
 */
#include <stdint.h>

#if defined(__PCE__)
#include <pce.h>
#endif

int main(void)
{
#if defined(__PCE__)
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_set_copy_word();
    pce_vdc_bg_enable();
#endif

    /* メインループ */
    while (1)
    {
        volatile uint16_t wait;
        for (wait = 0u; wait < 6200u; wait++) {}
    }

    return 0;
}
`;

function loadSampleCode() {
  if (!el.codeEditor || !el.codeStatus) return;
  el.codeEditor.value = HELLO_WORLD_C;
  state.code.selectedPath = 'src/main.c';
  state.code.selectedIsDirectory = false;
  state.code.selectedIsMedia = false;
  setCodeTextEditorVisible(true);
  updateCodeEditor(HELLO_WORLD_C);
  setCodeDirty(true);
  updateCodeStatus('Hello World サンプルを読み込みました。保存後に Build できます。');
}

// ============================================================== SETTINGS ===

function updateProjectNameDisplay() {
  if (el.projectName) {
    const core = getActiveCoreId() === 'pc-engine' ? 'PCE' : 'MD';
    el.projectName.textContent = `${state.projectConfig.title || 'MY GAME'} · ${core}`;
  }
}

function setFieldError(inputEl, errorEl, message) {
  if (!inputEl || !errorEl) return;
  const hasError = !!message;
  inputEl.classList.toggle('invalid', hasError);
  errorEl.textContent = message || '';
}

function validateTitle(value) {
  if (!value) return 'タイトルを入力してください';
  if (value.length > TITLE_MAX) return `タイトルは ${TITLE_MAX} 文字以内です`;
  if (!PRINTABLE_ASCII_RE.test(value)) return 'タイトルは半角ASCII文字で入力してください';
  return '';
}

function validateAuthor(value) {
  if (!value) return '作者名を入力してください';
  if (value.length > AUTHOR_MAX) return `作者名は ${AUTHOR_MAX} 文字以内です`;
  if (!PRINTABLE_ASCII_RE.test(value)) return '作者名は半角ASCII文字で入力してください';
  return '';
}

function validateSerial(value) {
  if (!value) return 'シリアルナンバーを入力してください';
  if (value.length !== SERIAL_MAX) return `シリアルナンバーは ${SERIAL_MAX} 文字固定です`;
  if (!PRINTABLE_ASCII_RE.test(value)) return 'シリアルナンバーは半角ASCII文字で入力してください';
  if (!SERIAL_RE.test(value)) return '形式が不正です (例: GM 00000000-00)';
  return '';
}

function safeMdAuthor(value) {
  const text = String(value || '').trim();
  return validateAuthor(text) ? 'AUTHOR' : text;
}

function safeMdSerial(value) {
  const text = String(value || '').trim().toUpperCase();
  return validateSerial(text) ? 'GM 00000000-00' : text;
}

function getExternalEmulatorProjectSettings() {
  const testPlay = state.projectConfig?.testPlay;
  const external = testPlay && typeof testPlay === 'object' && testPlay.externalEmulator && typeof testPlay.externalEmulator === 'object'
    ? testPlay.externalEmulator
    : {};
  return {
    executablePath: String(external.executablePath || external.path || DEFAULT_EXTERNAL_EMULATOR_PATH).trim(),
    extraArgs: String(external.extraArgs || external.arguments || '').trim(),
  };
}

function collectExternalEmulatorSettings() {
  return {
    executablePath: el.externalEmulatorPath?.value.trim() || '',
    extraArgs: el.externalEmulatorArgs?.value.trim() || '',
  };
}

function populateExternalEmulatorSettings() {
  const external = getExternalEmulatorProjectSettings();
  if (el.externalEmulatorPath) el.externalEmulatorPath.value = external.executablePath;
  if (el.externalEmulatorArgs) el.externalEmulatorArgs.value = external.extraArgs;
  updateExternalEmulatorSettingsAvailability();
}

function updateExternalEmulatorSettingsAvailability() {
  const activeId = getActiveRolePlugin('testplay') || pluginState.activeEmulatorPlugin || '';
  const enabled = activeId === EXTERNAL_EMULATOR_PLUGIN_ID;
  el.externalEmulatorSettings?.classList.toggle('is-disabled', !enabled);
  if (el.externalEmulatorPath) el.externalEmulatorPath.disabled = !enabled;
  if (el.externalEmulatorArgs) el.externalEmulatorArgs.disabled = !enabled;
  if (el.externalEmulatorHint) {
    el.externalEmulatorHint.textContent = enabled
      ? '現在の Test Play は外部エミュレーターで起動します。'
      : 'Plugins 画面で Test Play プラグインを「外部エミュレーター」にすると有効になります。';
  }
}

function buildTestPlaySettingsPatch() {
  return {
    ...(state.projectConfig.testPlay && typeof state.projectConfig.testPlay === 'object' ? state.projectConfig.testPlay : {}),
    externalEmulator: collectExternalEmulatorSettings(),
  };
}

function collectAndValidateSettings({ showError = true } = {}) {
  if (getActiveCoreId() === 'pc-engine') {
    const title = el.settingTitle?.value.trim() || state.projectConfig.title || state.projectConfig.romName || 'pce_sample';
    if (showError) {
      setFieldError(el.settingTitle, el.settingTitleError, '');
      setFieldError(el.settingAuthor, el.settingAuthorError, '');
      setFieldError(el.settingSerial, el.settingSerialError, '');
    }
    return {
      valid: true,
      errors: {},
      config: {
        coreId: 'pc-engine',
        platform: 'pce',
        title,
        romName: state.projectConfig.romName || title,
        toolchain: 'llvm-mos',
        testPlay: buildTestPlaySettingsPatch(),
      },
    };
  }
  const title = el.settingTitle?.value.trim() || state.projectConfig.title || 'MY GAME';
  const author = el.settingAuthor?.value.trim() || state.projectConfig.author || 'AUTHOR';
  const serial = (el.settingSerial?.value.trim() || state.projectConfig.serial || 'GM 00000000-00').toUpperCase();

  const errors = {
    title: validateTitle(title),
    author: validateAuthor(author),
    serial: validateSerial(serial),
  };

  if (showError) {
    setFieldError(el.settingTitle, el.settingTitleError, errors.title);
    setFieldError(el.settingAuthor, el.settingAuthorError, errors.author);
    setFieldError(el.settingSerial, el.settingSerialError, errors.serial);
  }

  const valid = !errors.title && !errors.author && !errors.serial;
  return {
    valid,
    errors,
    config: {
      title: title || state.projectConfig.title,
      author: author || state.projectConfig.author,
      serial: serial || state.projectConfig.serial,
      region: 'JUE',
      testPlay: buildTestPlaySettingsPatch(),
    },
  };
}

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('open');
  modalEl.setAttribute('aria-hidden', 'false');
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('open');
  modalEl.setAttribute('aria-hidden', 'true');
}

function quitApp() {
  window.electronAPI.quitApp?.().catch?.(() => {});
}

function cancelRequiredProjectSelection() {
  if (!state.startup.projectSelectionRequired || state.startup.projectSelected) return false;
  quitApp();
  return true;
}

function getModalPanel(modalEl) {
  return modalEl?.querySelector('.app-panel') || null;
}

function resetModalPanelPosition(modalEl) {
  const panel = getModalPanel(modalEl);
  if (!panel) return;
  panel.style.transform = '';
}

function setCurrentProjectInfo(info) {
  state.project.dir = info?.projectDir || '';
  state.project.name = info?.projectName || '';
  state.project.projectsRootDir = info?.projectsRootDir || state.project.projectsRootDir || '';
  if (info?.coreId) {
    state.projectConfig.coreId = info.coreId;
  }
  if (el.projectDirLabel) {
    el.projectDirLabel.textContent = state.project.dir || 'no project';
    el.projectDirLabel.title = state.project.dir || '';
  }
  if (el.currentProjectDir) {
    el.currentProjectDir.value = state.project.dir || '';
  }
}

async function refreshProjectList() {
  const result = await window.electronAPI.listProjects();
  if (!result?.ok) {
    throw new Error(result?.error || 'project list failed');
  }
  state.project.projectsRootDir = result.projectsRootDir || '';
  state.project.availableProjects = Array.isArray(result.projects) ? result.projects : [];
  state.project.recentProjects = Array.isArray(result.recentProjects) ? result.recentProjects : [];
  state.project.templates = Array.isArray(result.templates) ? result.templates : [];
  state.project.cores = Array.isArray(result.cores) ? result.cores : state.project.cores;
  state.projectConfig.coreId = normalizeProjectCoreId(result.activeCoreId || state.projectConfig.coreId);
  if (!state.project.newProjectParentDir) {
    state.project.newProjectParentDir = state.project.projectsRootDir || '';
  }
  return result;
}

async function loadPluginCatalogForProjectCreation() {
  try {
    pluginState.plugins = await window.electronAPI.listPlugins({ includeIncompatible: true });
  } catch (_) {
    pluginState.plugins = [];
  }
}

function resetProjectScopedPluginUiState() {
  state.startup.selectedDefaultSidebarPage = false;
  state.currentPage = 'plugins';
  resetPceAssetCache();
  pluginState.plugins = [];
  pluginState.generating = {};
  pluginState.activeRoles = {};
  pluginState.activeBuilderPlugin = null;
  pluginState.activeEmulatorPlugin = null;
  pluginState.sidebarOrder = [];
  pluginState.draggingSidebarPluginId = null;

  state.code.tree = [];
  state.code.selectedPath = 'src/main.c';
  state.code.selectedIsDirectory = false;
  state.code.selectedIsMedia = false;
  state.code.initialCollapseApplied = false;
  state.code.collapsedDirs = [];
  setCodeDirty(false);
  closeCodeCompletion();
  closeSidebarPluginContextMenu();
  clearPluginRuntime();

  if (el.sidebarPluginTabs) el.sidebarPluginTabs.innerHTML = '';
  if (el.pluginList) el.pluginList.innerHTML = '<p class="hint-text">プロジェクトのプラグイン状態を読み込み中...</p>';
  if (el.pluginRoleBody) el.pluginRoleBody.innerHTML = '';
  if (el.btnBuild) el.btnBuild.disabled = true;
  if (el.btnTestPlay) el.btnTestPlay.disabled = true;
  switchPage('plugins');
}

async function reloadProjectAfterSwitch() {
  resetProjectScopedPluginUiState();
  await loadProjectConfig();
  await loadResDefinitions({ keepSelection: false });
  await loadPlugins({ resetProjectPluginState: true, resetSidebarSelection: true });
  await refreshProjectList();
}

function renderProjectPicker() {
  if (!el.projectPickerList) return;
  el.projectPickerList.innerHTML = '';
  if (el.projectPickerRoot) {
    el.projectPickerRoot.textContent = `既定のプロジェクトフォルダ: ${state.project.projectsRootDir || '-'}`;
    el.projectPickerRoot.title = state.project.projectsRootDir || '';
  }

  const openProjectFromItem = async (project) => {
    if (project?.exists === false && project?.projectDir) {
      if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = `プロジェクトが見つかりません: ${project.projectDir}`;
      return;
    }
    const result = await window.electronAPI.openExistingProject({
      projectDir: project.projectDir || '',
      projectName: project.projectName || '',
    });
    if (!result?.ok) {
      if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = `プロジェクトを開けませんでした: ${result?.error || 'unknown'}`;
      return;
    }
    state.startup.projectSelected = true;
    state.startup.projectSelectionRequired = false;
    appendLog('app', `プロジェクトを開きました: ${result.projectDir || project.projectDir || project.projectName}`);
    closeModal(el.projectPickerModal);
    await reloadProjectAfterSwitch();
    if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = `✓ プロジェクトを切り替えました: ${result.projectDir}`;
  };

  const appendSection = (title, hint, projects, emptyText) => {
    const section = document.createElement('section');
    section.className = 'project-picker-section';
    section.innerHTML = `
      <div class="project-picker-section-head">
        <h3>${escHtml(title)}</h3>
        ${hint ? `<span>${escHtml(hint)}</span>` : ''}
      </div>
    `;
    const list = document.createElement('div');
    list.className = 'project-picker-section-list';
    section.appendChild(list);

    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'project-picker-empty';
      empty.textContent = emptyText;
      list.appendChild(empty);
      el.projectPickerList.appendChild(section);
      return;
    }

    projects.forEach((project) => {
      const button = document.createElement('button');
      button.type = 'button';
      const exists = project.exists !== false;
      button.className = `project-picker-item${project.current ? ' current' : ''}${exists ? '' : ' missing'}`;
      button.disabled = !exists;
      button.innerHTML = `
        <span class="project-picker-main">
          <span class="project-picker-name">${escHtml(project.projectName || '')}</span>
          <span class="project-picker-title">${escHtml(project.title || '')}</span>
          <span class="project-picker-path">${escHtml(project.projectDir || '')}</span>
        </span>
        ${project.current ? '<span class="project-picker-badge">現在</span>' : ''}
        ${!exists ? '<span class="project-picker-badge warn">なし</span>' : ''}
      `;
      button.addEventListener('click', () => openProjectFromItem(project));
      list.appendChild(button);
    });
    el.projectPickerList.appendChild(section);
  };

  appendSection(
    '最近開いたプロジェクト',
    '任意パスを含みます',
    state.project.recentProjects || [],
    '最近開いたプロジェクトはありません。',
  );
  appendSection(
    'projects 配下',
    state.project.projectsRootDir || '',
    state.project.availableProjects || [],
    'projects 配下に通常プロジェクトがありません。',
  );
}

async function openProjectPicker() {
  try {
    await loadPluginCatalogForProjectCreation();
    await refreshProjectList();
    renderProjectPicker();
    openModal(el.projectPickerModal);
  } catch (err) {
    if (el.settingsSavedMsg) {
      el.settingsSavedMsg.textContent = `プロジェクト一覧取得失敗: ${err?.message || err}`;
    }
  }
}

async function openProjectFolderFromDialog() {
  const picked = await window.electronAPI.pickFile({
    title: 'プロジェクトフォルダを開く',
    properties: ['openDirectory'],
  });
  if (picked?.canceled) return;
  const projectDir = picked?.sourcePath || picked?.filePaths?.[0] || '';
  if (!projectDir) return;

  const result = await window.electronAPI.openExistingProject({ projectDir });
  if (!result?.ok) {
    const message = `プロジェクトを開けませんでした: ${result?.error || 'project.json が見つかりません'}`;
    appendLog('app', message, 'warn');
    if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = message;
    return;
  }

  state.startup.projectSelected = true;
  state.startup.projectSelectionRequired = false;
  appendLog('app', `プロジェクトを開きました: ${result.projectDir || projectDir}`);
  closeModal(el.projectPickerModal);
  await reloadProjectAfterSwitch();
  if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = `✓ プロジェクトを切り替えました: ${result.projectDir}`;
}

async function ensureStartupProjectSelection() {
  const result = await window.electronAPI.getProjectStartupState?.();
  const requiresSelection = !result?.ok || Boolean(result.requiresProjectSelection);
  state.startup.projectSelectionRequired = requiresSelection;
  state.startup.projectSelected = !requiresSelection;
  if (!requiresSelection) return false;

  if (result?.hasSavedProject && !result.savedProjectExists) {
    appendLog('app', `前回開いていたプロジェクトが見つかりません: ${result.savedProjectDir}`, 'warn');
  } else {
    appendLog('app', '初回起動のためプロジェクト選択が必要です。');
  }

  await openProjectPicker();
  return true;
}

async function openCurrentProjectDirectory() {
  if (!state.project.dir) {
    if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = '現在のプロジェクトフォルダがありません。';
    return;
  }
  const result = await window.electronAPI.openPathInExplorer(state.project.dir);
  if (!result?.ok) {
    const message = `フォルダを開けませんでした: ${result?.error || 'unknown'}`;
    appendLog('app', message, 'warn');
    if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = message;
  }
}

async function loadProjectConfig() {
  try {
    const projectInfo = await window.electronAPI.getCurrentProject();
    if (projectInfo?.ok) {
      setCurrentProjectInfo(projectInfo);
    }

    const cfg = await window.electronAPI.getProjectConfig();
    if (cfg) {
      const coreId = cfg.coreId || (cfg.platform === 'pce' ? 'pc-engine' : 'mega-drive');
      const normalized = {
        coreId,
        title: cfg.title || cfg.romName || state.projectConfig.title,
        author: coreId === 'pc-engine' ? (cfg.author || state.projectConfig.author) : safeMdAuthor(cfg.author || state.projectConfig.author),
        serial: coreId === 'pc-engine' ? (cfg.serial || state.projectConfig.serial) : safeMdSerial(cfg.serial || state.projectConfig.serial),
        region: cfg.region || 'JUE',
      };
      state.projectConfig = { ...state.projectConfig, ...cfg, ...normalized };
      if (el.settingTitle) el.settingTitle.value = state.projectConfig.title;
      if (el.settingAuthor) el.settingAuthor.value = state.projectConfig.author;
      if (el.settingSerial) el.settingSerial.value = state.projectConfig.serial;
      populateExternalEmulatorSettings();
      updateProjectNameDisplay();
      collectAndValidateSettings({ showError: true });
    }

    await loadCodeTree();

    const romPath = await window.electronAPI.getRomPath();
    if (romPath) {
      state.lastRomPath = romPath;
      if (el.settingOutputPath) el.settingOutputPath.value = romPath;
    } else {
      state.lastRomPath = null;
      if (el.settingOutputPath) el.settingOutputPath.value = '';
    }
    updateRomOutputActions();
  } catch (_err) {
    // no-op
  }
}

async function saveSettings() {
  const result = collectAndValidateSettings({ showError: true });
  if (!result.valid) {
    if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = '✕ 入力内容を修正してください';
    return;
  }
  try {
    await persistProjectSettings(result.config, { showMessage: true });
  } catch (err) {
    if (el.settingsSavedMsg) {
      el.settingsSavedMsg.textContent = `✕ 設定を保存できませんでした: ${String(err?.message || err)}`;
    }
  }
}

async function persistProjectSettings(config, { showMessage = false } = {}) {
  const result = await window.electronAPI.saveProjectConfig(config);
  if (!result?.ok) {
    throw new Error(result?.error || 'unknown');
  }
  state.projectConfig = result.config || config;
  if (el.settingSerial) el.settingSerial.value = state.projectConfig.serial;
  populateExternalEmulatorSettings();
  updateProjectNameDisplay();
  if (showMessage && el.settingsSavedMsg) {
    el.settingsSavedMsg.textContent = '✓ 設定を保存しました';
    setTimeout(() => { if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = ''; }, 2000);
  }
  return state.projectConfig;
}

// ============================================================== BUILD ===

/**
 * @param {object} [opts]
 * @param {string} [opts._generatedByPlugin] - このプラグイン ID が既に main.c を書き込み済み
 * @param {boolean} [opts.skipClean] - clean ターゲットを省略して差分ビルドする
 */
async function runBuild(opts = {}) {
  if (state.building) return { success: false, error: 'building' };
  if (el.btnBuild?.disabled) {
    setLogOpen(true);
    appendBuildLog('[WARN] 有効な Build プラグインがありません。Plugins 画面で有効化してください。', 'warn');
    setBuildStatus('error', 'Build プラグイン未設定');
    return { success: false, error: 'Build プラグイン未設定' };
  }

  // ---- アクティブビルダープラグインが設定されており、かつ呼び出し元がプラグイン生成後でない場合 ----
  const builderPluginId = getActiveRolePlugin('builder') || pluginState.activeBuilderPlugin;
  const builderPlugin = builderPluginId ? getPluginById(builderPluginId) : null;
  if (builderPluginId && builderPlugin?.hasGenerator && !opts._generatedByPlugin) {
    // プラグインで main.c を生成してから再度 runBuild を呼ぶ
    appendBuildLog(`[Plugin] ${builderPluginId}: コード生成中...`);
    const genResult = await window.electronAPI.runPluginGenerator(builderPluginId);
    if (!genResult.ok) {
      setLogOpen(true);
      setBuildStatus('error', 'プラグイン生成失敗');
      appendBuildLog(`[ERROR] プラグイン生成失敗: ${genResult.error}`, 'error');
      return { success: false, error: genResult.error || 'プラグイン生成失敗' };
    }
    appendBuildLog(`[Plugin] ${builderPluginId}: main.c を生成しました`);
    return runBuild({ ...opts, _generatedByPlugin: builderPluginId });
  }

  // ---- プラグイン生成済みでない通常ビルド: 現在のコードファイルを保存 ----
  if (!opts._generatedByPlugin) {
    if (state.code.selectedIsDirectory) {
      switchPage('code');
      updateCodeStatus('⚠ フォルダではなくファイルを選択してください。');
      setLogOpen(true);
      setBuildStatus('error', 'コードファイル未選択');
      return { success: false, error: 'コードファイル未選択' };
    }
    if (state.code.dirty) {
      const saved = await saveCurrentCodeFile();
      if (!saved) {
        setLogOpen(true);
        setBuildStatus('error', '保存失敗');
        return { success: false, error: '保存失敗' };
      }
    }
  }

  state.building = true;
  el.btnBuild?.classList.add('building');
  if (el.btnBuild) el.btnBuild.disabled = true;
  clearBuildLog();
  setLogOpen(true);
  setBuildStatus('building', 'ビルド中...');
  if (el.buildRomSize) el.buildRomSize.textContent = '';
  appendBuildLog(`=== ${getActiveCoreId() === 'pc-engine' ? 'PC Engine' : getActiveCoreId()} Build ===`);
  appendBuildLog(`プロジェクト: ${state.projectConfig.title}`);
  appendBuildLog('');

  try {
    const settingsResult = collectAndValidateSettings({ showError: true });
    if (!settingsResult.valid) {
      appendBuildLog('[ERROR] プロジェクト設定に不正な値があります。Settings を確認してください。', 'error');
      setBuildStatus('error', '設定エラー');
      return { success: false, error: '設定エラー' };
    }
    try {
      await persistProjectSettings(settingsResult.config);
    } catch (err) {
      appendBuildLog(`[ERROR] プロジェクト設定の保存に失敗: ${String(err?.message || err)}`, 'error');
      setBuildStatus('error', '設定保存失敗');
      return { success: false, error: '設定保存失敗' };
    }

    // 既存のプロジェクトツリーを尊重し、Build 前は構造整備のみを行う
    const genResult = await window.electronAPI.generateStructureOnly(state.projectConfig);
    if (!genResult.ok) {
      appendBuildLog(`[ERROR] プロジェクト生成失敗: ${genResult.error}`, 'error');
      setBuildStatus('error', 'プロジェクト生成失敗');
      return { success: false, error: genResult.error || 'プロジェクト生成失敗' };
    }
    appendBuildLog(`[INFO] プロジェクト生成: ${genResult.projectDir}`);

    const buildResult = await window.electronAPI.runBuild({
      skipClean: Boolean(opts.skipClean),
    });

    if (buildResult.success) {
      state.lastRomPath = buildResult.romPath;
      if (el.settingOutputPath) el.settingOutputPath.value = buildResult.romPath;
      updateRomOutputActions();
      const sizeKb = buildResult.romSize != null ? `${(buildResult.romSize / 1024).toFixed(1)} KB` : '';
      if (el.buildRomSize) el.buildRomSize.textContent = sizeKb ? `ROM: ${sizeKb}` : '';
      setBuildStatus('success', '✓ ビルド成功');
      appendBuildLog('');
      appendBuildLog(`=== ビルド成功 (${sizeKb}) ===`);
      return buildResult;
    } else {
      setBuildStatus('error', '✕ ビルド失敗');
      appendBuildLog('');
      appendBuildLog(`=== ビルド失敗: ${buildResult.error || ''} ===`, 'error');
      return buildResult;
    }
  } catch (err) {
    const msg = err.message || String(err);
    appendBuildLog(`[ERROR] ${msg}`, 'error');
    setBuildStatus('error', '✕ エラー');
    return { success: false, error: msg };
  } finally {
    state.building = false;
    el.btnBuild?.classList.remove('building');
    applyBuildAvailability();
  }
}

// ========================================================= TEST PLAY ===

async function openTestPlay() {
  if (el.btnTestPlay?.disabled) {
    appendLog('emulator', '有効な Emulator プラグインがありません。Plugins 画面で有効化してください。', 'warn');
    return;
  }
  appendLog('emulator', 'テストプレイ起動を開始します');
  appendLog('emulator', '最新のプロジェクト設定と生成物を反映するため、Test Play 前に差分ビルドします');
  const buildResult = await runBuild({ skipClean: true });
  if (!buildResult?.success) {
    appendLog('emulator', `テストプレイを中止しました: ${buildResult?.error || 'ビルド失敗'}`, 'warn');
    return;
  }
  const romPath = buildResult.romPath || state.lastRomPath || (await window.electronAPI.getRomPath());
  if (!romPath) {
    setLogOpen(true);
    appendLog('emulator', 'ROM が見つかりません。先に Build を実行してください。', 'warn');
    setBuildStatus('error', 'ROM なし');
    return;
  }
  try {
    const result = await window.electronAPI.openTestPlayWindow(romPath);
    if (!result?.opened) {
      appendLog('emulator', `テストプレイを開始できません: ${result?.error || 'unknown'}`, 'warn');
      return;
    }
    appendLog('emulator', `テストプレイを開始しました: ${romPath}`);
  } catch (err) {
    appendLog('emulator', `テストプレイ起動失敗: ${err.message}`, 'error');
  }
}

async function openExportModal() {
  const romPath = await window.electronAPI.getRomPath();
  state.lastRomPath = romPath || null;
  updateRomOutputActions();
  if (!state.lastRomPath) {
    appendLog('app', 'Export できる ROM がありません。先に Build を実行してください。', 'warn');
    return;
  }
  openModal(el.exportModal);
}

async function exportLastBuild(format) {
  const romPath = await window.electronAPI.getRomPath();
  state.lastRomPath = romPath || null;
  updateRomOutputActions();
  if (!state.lastRomPath) {
    appendLog('app', 'Export できる ROM がありません。先に Build を実行してください。', 'warn');
    return;
  }
  const isHtml = format === 'html';
  const label = isHtml ? 'HTML' : 'ROM';
  closeModal(el.exportModal);
  setLogOpen(true);
  appendLog('build', `${label} をエクスポートします: ${state.lastRomPath}`);
  const result = isHtml
    ? await window.electronAPI.exportHtml()
    : await window.electronAPI.exportRom();
  if (result?.ok) {
    appendLog('build', `${label} をエクスポートしました: ${result.path}`);
  } else if (!result?.canceled) {
    appendLog('build', `${label} Export 失敗: ${result?.error || 'unknown'}`, 'error');
  }
}

// ========================================================= ASSET UTILS ===

function toTypeBadge(type) {
  const cls = `type-${String(type).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  return `<span class="asset-type-pill ${cls}">${type}</span>`;
}

function escHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSelectedFile() {
  return state.rescomp.files.find((f) => f.file === state.rescomp.selectedFile) || null;
}

function getFilteredEntries() {
  const file = getSelectedFile();
  if (!file) return [];
  const q = state.rescomp.searchText.trim().toLowerCase();
  if (!q) return file.entries;
  return file.entries.filter((e) => {
    const hay = `${e.name} ${e.type} ${e.sourcePath}`.toLowerCase();
    return hay.includes(q);
  });
}

function getAllAssetEntries() {
  return (state.rescomp.files || []).flatMap((file) => file.entries || []);
}

function getPaletteReferenceCandidates(excludeSourcePath = '') {
  const exclude = String(excludeSourcePath || '').replace(/\\/g, '/');
  const seen = new Set();
  return getAllAssetEntries()
    .filter((entry) => {
      const type = String(entry?.type || '').toUpperCase();
      if (!['IMAGE', 'BITMAP', 'SPRITE', 'TILESET', 'TILEMAP', 'MAP'].includes(type)) return false;
      const sourcePath = String(entry?.sourcePath || '').replace(/\\/g, '/');
      const sourceAbsolutePath = String(entry?.sourceAbsolutePath || sourcePath).replace(/\\/g, '/');
      if (!sourcePath && !sourceAbsolutePath) return false;
      if (exclude && (sourcePath === exclude || sourceAbsolutePath === exclude)) return false;
      const extBase = sourceAbsolutePath || sourcePath;
      const ext = extBase.slice(extBase.lastIndexOf('.')).toLowerCase();
      if (!['.png', '.bmp'].includes(ext)) return false;
      const dedupeKey = sourceAbsolutePath || sourcePath;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    })
    .map((entry) => ({
      sourcePath: String(entry.sourceAbsolutePath || entry.sourcePath || ''),
      label: `${entry.name} (${entry.sourcePath})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}

function extractPaletteFromImageData(imageData, maxColors = 16) {
  const palette = [];
  const seen = new Set();
  const data = imageData?.data;
  if (!data) return [];

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const snapped = snapColorToMegaDrive({ r: data[i], g: data[i + 1], b: data[i + 2] });
    const key = `${snapped.r},${snapped.g},${snapped.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    palette.push(snapped);
    if (palette.length > maxColors) {
      return null;
    }
  }

  return palette;
}

function getCurrentSelectedEntry() {
  const file = getSelectedFile();
  if (!file || state.rescomp.selectedEntryLine == null) return null;
  return file.entries.find((e) => Number(e.lineNumber) === Number(state.rescomp.selectedEntryLine)) || null;
}

function allowedTypesForExtension(ext) {
  return getAllowedAssetTypesForExtension(ext, TYPE_OPTIONS);
}

function createDefaultEntry(type, sourcePath, fileName) {
  const base = {
    type,
    name: normalizeSymbolName(fileName),
    sourcePath,
  };

  if (type === 'IMAGE') {
    return { ...base, compression: 'NONE', mapOpt: 'ALL', mapBase: '0' };
  }
  if (type === 'BITMAP') {
    return { ...base, compression: 'NONE' };
  }
  if (type === 'SPRITE') {
    return {
      ...base,
      width: '2',
      height: '2',
      compression: 'NONE',
      time: '0',
      collision: 'NONE',
      optType: 'BALANCED',
      optLevel: 'FAST',
      optDuplicate: 'FALSE',
    };
  }
  if (type === 'XGM') {
    return { ...base, timing: 'AUTO', options: '' };
  }
  if (type === 'XGM2') {
    return { ...base, files: [sourcePath], options: '' };
  }
  if (type === 'WAV') {
    return { ...base, driver: 'DEFAULT', outRate: '', far: 'TRUE' };
  }
  if (type === 'MAP') {
    if (String(sourcePath || '').toLowerCase().endsWith('.tmx')) {
      return { ...base, tileset: 'Ground', compression: 'NONE', mapCompression: 'NONE', mapBase: '0', ordering: 'ROW' };
    }
    return { ...base, tileset: 'tileset_main', compression: 'NONE', mapBase: '0', ordering: 'ROW' };
  }
  if (type === 'TILEMAP') {
    if (String(sourcePath || '').toLowerCase().endsWith('.tmx')) {
      return { ...base, tileset: 'Ground', compression: 'NONE', mapCompression: 'NONE', mapBase: '0', ordering: 'ROW' };
    }
    return { ...base, tileset: 'tileset_main', compression: 'NONE', mapOpt: 'ALL', mapBase: '0', ordering: 'ROW' };
  }
  if (type === 'TILESET') {
    return { ...base, compression: 'NONE', opt: 'ALL', ordering: 'ROW', export: 'FALSE' };
  }
  return base;
}

function getEntryByLine(lineNumber) {
  const file = getSelectedFile();
  if (!file) return null;
  return file.entries.find((e) => Number(e.lineNumber) === Number(lineNumber)) || null;
}

function renderResFileSelect() {
  if (!el.resFileSelect) return;
  el.resFileSelect.innerHTML = '';

  state.rescomp.files.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.file;
    opt.textContent = `${f.file} (${f.entryCount})`;
    el.resFileSelect.appendChild(opt);
  });

  if (!state.rescomp.selectedFile && state.rescomp.files.length > 0) {
    state.rescomp.selectedFile = state.rescomp.files[0].file;
  }

  if (state.rescomp.selectedFile) {
    el.resFileSelect.value = state.rescomp.selectedFile;
  }

  if (el.btnDeleteAssetEntry) {
    el.btnDeleteAssetEntry.disabled = !state.rescomp.selectedFile;
  }
}

function renderEntryMeta(entry) {
  if (!entry) {
    if (el.infoLine) el.infoLine.textContent = '-';
    if (el.infoType) el.infoType.textContent = '-';
    if (el.infoName) el.infoName.textContent = '-';
    if (el.infoComment) el.infoComment.textContent = '-';
    if (el.infoSource) el.infoSource.textContent = '-';
    return;
  }

  if (el.infoLine) el.infoLine.textContent = String(entry.lineNumber || '-');
  if (el.infoType) el.infoType.textContent = String(entry.type || '-');
  if (el.infoName) el.infoName.textContent = String(entry.name || '-');
  if (el.infoComment) el.infoComment.textContent = String(entry.comment || '-');
  if (el.infoSource) el.infoSource.textContent = String(entry.sourcePath || '-');
}

function isImageEntry(entry) {
  return !!entry && IMAGE_EXTS.includes(pathExt(entry.sourcePath));
}

function isSpriteEntry(entry) {
  return !!entry && String(entry.type || '').toUpperCase() === 'SPRITE' && IMAGE_EXTS.includes(pathExt(entry.sourcePath));
}

function isAudioEntry(entry) {
  return !!entry && pathExt(entry.sourcePath) === '.wav';
}

function getVgmPreviewSourcePath(entry) {
  if (!entry) return '';
  if (pathExt(entry.sourcePath) === '.vgm') return entry.sourceAbsolutePath || entry.sourcePath || '';
  const files = Array.isArray(entry.files) ? entry.files : [];
  const firstFile = String(files[0] || '');
  if (pathExt(firstFile) !== '.vgm') return '';
  const resRoot = String(state.rescomp.resRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return resRoot ? `${resRoot}/${firstFile.replace(/^\/+/, '')}` : firstFile;
}

function getMusicMetaSourcePath(entry) {
  const vgmPath = getVgmPreviewSourcePath(entry);
  if (vgmPath) return vgmPath;
  if (!entry) return '';
  if (['.vgm', '.xgm'].includes(pathExt(entry.sourcePath))) return entry.sourceAbsolutePath || entry.sourcePath || '';
  const files = Array.isArray(entry.files) ? entry.files : [];
  const musicFile = files.find((file) => ['.vgm', '.xgm'].includes(pathExt(file)));
  if (!musicFile) return '';
  const resRoot = String(state.rescomp.resRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return resRoot ? `${resRoot}/${String(musicFile).replace(/^\/+/, '')}` : String(musicFile);
}

function isVgmPreviewEntry(entry) {
  if (!entry || !getVgmPreviewSourcePath(entry)) return false;
  const player = getPluginCapability('vgm-preview-player');
  return typeof player?.canPreview === 'function' ? player.canPreview(entry) : false;
}

function isBgmMetaEntry(entry) {
  if (!entry || !getMusicMetaSourcePath(entry)) return false;
  const type = String(entry.type || '').toUpperCase();
  return ['XGM', 'XGM2'].includes(type) || ['.vgm', '.xgm'].includes(pathExt(entry.sourcePath));
}

function pathExt(value) {
  const m = String(value || '').toLowerCase().match(/(\.[a-z0-9]+)$/i);
  return m ? m[1] : '';
}

function toFileUrl(absPath) {
  return `file:///${encodeURI(String(absPath || '').replace(/\\/g, '/'))}`;
}

function buildEntryTooltip(entry) {
  const parts = [];
  if (entry.comment) {
    parts.push(entry.comment);
  }
  if (entry.raw) {
    parts.push(entry.raw);
  }
  return parts.join('\n');
}

function stopAudioPreview() {
  if (state.preview.audio) {
    state.preview.audio.pause();
    state.preview.audio.currentTime = 0;
    state.preview.audio = null;
  }
  state.preview.audioEntryId = '';
  syncAudioPlayer(false);
}

function stopVgmPreview() {
  const player = getPluginCapability('vgm-preview-player');
  player?.stop?.();
  state.preview.vgmEntryId = '';
  state.preview.vgmDurationSec = 0;
  syncAudioPlayer(false);
}

function stopSpritePreview() {
  if (state.preview.spriteTimer) {
    window.clearTimeout(state.preview.spriteTimer);
  }
  state.preview.spriteTimer = 0;
  state.preview.spriteEntryId = '';
  state.preview.spriteImage = null;
  state.preview.spriteFrame = 0;
  state.preview.spritePlaying = false;
}

function extractDisplayPalette(imageData, maxSwatches) {
  const seen = new Map();
  const data = imageData.data;
  let hasTransparent = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) {
      hasTransparent = true;
      continue;
    }
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const sorted = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  const palette = sorted.slice(0, Math.max(0, maxSwatches - (hasTransparent ? 1 : 0))).map(([key]) => ({
    r: (key >> 16) & 0xff,
    g: (key >> 8) & 0xff,
    b: key & 0xff,
  }));
  return hasTransparent
    ? [{ r: 0, g: 0, b: 0, transparent: true }, ...palette]
    : palette;
}

function renderPaletteSwatches(container, colors) {
  if (!container) return;
  container.innerHTML = '';
  colors.forEach(({ r, g, b, transparent, empty }, index) => {
    const sw = document.createElement('div');
    sw.className = 'palette-swatch';
    if (transparent) sw.classList.add('is-transparent');
    if (empty) sw.classList.add('is-empty');
    const hex = `#${Number(r || 0).toString(16).padStart(2, '0')}${Number(g || 0).toString(16).padStart(2, '0')}${Number(b || 0).toString(16).padStart(2, '0')}`;
    sw.style.backgroundColor = transparent ? '' : hex;
    sw.title = transparent ? `${index}: ${hex} (transparent)` : `${index}: ${hex}`;
    container.appendChild(sw);
  });
}

function getCodeCompletionContext() {
  const editor = el.codeEditor;
  if (!editor || editor.disabled) return null;
  const cursor = editor.selectionStart || 0;
  const before = editor.value.slice(0, cursor);
  const match = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  return {
    cursor,
    prefix: match ? match[0] : '',
    start: match ? cursor - match[0].length : cursor,
  };
}

function closeCodeCompletion() {
  state.code.completions = [];
  state.code.completionIndex = 0;
  state.code.completionPrefix = '';
  if (el.codeCompletionPanel) {
    el.codeCompletionPanel.hidden = true;
    el.codeCompletionPanel.innerHTML = '';
  }
}

function renderCodeCompletionPanel() {
  const panel = el.codeCompletionPanel;
  if (!panel) return;
  if (!state.code.completions.length) {
    closeCodeCompletion();
    return;
  }
  panel.hidden = false;
  panel.innerHTML = state.code.completions.map((item, index) => `
    <div class="code-completion-item${index === state.code.completionIndex ? ' active' : ''}" data-index="${index}">
      <span>${escHtml(item.label)}</span>
      <span class="code-completion-kind">${escHtml(item.kind)}</span>
    </div>
  `).join('');
  panel.querySelectorAll('.code-completion-item').forEach((row) => {
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      state.code.completionIndex = Number(row.getAttribute('data-index')) || 0;
      applyCodeCompletion();
    });
  });
}

function updateCodeCompletion({ force = false } = {}) {
  const context = getCodeCompletionContext();
  if (!context) {
    closeCodeCompletion();
    return;
  }
  const prefix = context.prefix;
  if (!force && prefix.length < 2) {
    closeCodeCompletion();
    return;
  }
  const lower = prefix.toLowerCase();
  const completions = getCodeCompletionItems()
    .filter((item) => !prefix || item.label.toLowerCase().startsWith(lower))
    .slice(0, 24);
  state.code.completions = completions;
  state.code.completionIndex = 0;
  state.code.completionPrefix = prefix;
  renderCodeCompletionPanel();
}

function applyCodeCompletion() {
  const item = state.code.completions[state.code.completionIndex];
  const context = getCodeCompletionContext();
  if (!item || !context) return false;
  const editor = el.codeEditor;
  const next = `${editor.value.slice(0, context.start)}${item.label}${editor.value.slice(context.cursor)}`;
  editor.value = next;
  const nextCursor = context.start + item.label.length;
  editor.setSelectionRange(nextCursor, nextCursor);
  updateCodeEditor(editor.value);
  setCodeDirty(true);
  closeCodeCompletion();
  return true;
}

const IMAGE_PREVIEW_ZOOM_PRESETS = ['25', '50', '100', '200', '300', '400', '800'];

function applyInlineImageZoom() {
  if (!el.inlinePreviewImage) return;
  const zoom = String(state.preview.imageZoom || 'fit');
  const nw = Number(state.preview.imageNaturalWidth || 0);
  const nh = Number(state.preview.imageNaturalHeight || 0);

  if (zoom === 'fit' || !nw || !nh) {
    el.inlinePreviewImage.style.width = '';
    el.inlinePreviewImage.style.height = '';
    el.inlinePreviewImage.style.maxWidth = '100%';
    el.inlinePreviewImage.style.maxHeight = '100%';
    el.inlinePreviewImage.style.objectFit = 'contain';
    return;
  }

  const ratio = Math.max(0.01, Number(zoom) / 100);
  el.inlinePreviewImage.style.maxWidth = 'none';
  el.inlinePreviewImage.style.maxHeight = 'none';
  el.inlinePreviewImage.style.objectFit = 'fill';
  el.inlinePreviewImage.style.width = `${Math.round(nw * ratio)}px`;
  el.inlinePreviewImage.style.height = `${Math.round(nh * ratio)}px`;
}

function stepInlineImageZoom(step) {
  const list = ['fit', ...IMAGE_PREVIEW_ZOOM_PRESETS];
  const current = String(state.preview.imageZoom || 'fit');
  if (current === 'fit') {
    state.preview.imageZoom = step > 0 ? '100' : '50';
    if (el.inlineImageZoom) el.inlineImageZoom.value = state.preview.imageZoom;
    applyInlineImageZoom();
    return;
  }
  let idx = list.indexOf(current);
  if (idx < 0) idx = 0;
  const nextIdx = Math.max(0, Math.min(list.length - 1, idx + step));
  state.preview.imageZoom = list[nextIdx];
  if (el.inlineImageZoom) el.inlineImageZoom.value = state.preview.imageZoom;
  applyInlineImageZoom();
}

function parseWavHeader(dataUrl) {
  try {
    const b64 = dataUrl.split(',')[1];
    if (!b64 || b64.length < 60) return null;
    const dec = atob(b64.slice(0, 64));
    const u8 = new Uint8Array(dec.length);
    for (let i = 0; i < dec.length; i++) u8[i] = dec.charCodeAt(i);
    const view = new DataView(u8.buffer);
    const riff = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    const wave = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
    if (riff !== 'RIFF' || wave !== 'WAVE') return null;
    const numChannels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    const dataSize = view.getUint32(40, true);
    const durationSec = sampleRate > 0
      ? dataSize / (sampleRate * numChannels * (bitsPerSample / 8))
      : 0;
    const fileSizeBytes = Math.round(b64.replace(/=/g, '').length * 0.75);
    return { sampleRate, numChannels, bitsPerSample, durationSec, fileSizeBytes };
  } catch {
    return null;
  }
}

function formatDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '-';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHex(value) {
  if (value == null || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `0x${Math.max(0, n >>> 0).toString(16).toUpperCase()}`;
}

function formatPreviewEngineStatus(engine = {}) {
  const label = engine.label || (engine.highAccuracyAvailable ? 'Nuked-OPN2 WASM' : '簡易 Web Audio');
  const stateText = engine.highAccuracyAvailable
    ? '有効'
    : engine.state === 'loading'
      ? '確認中'
      : 'fallback';
  const detail = engine.message ? ` / ${engine.message}` : '';
  return `${label} (${stateText})${detail}`;
}

function renderBgmMetaRows(entry, meta = {}, warnings = [], { preview = false } = {}) {
  const format = String(meta.format || pathExt(getMusicMetaSourcePath(entry)).replace('.', '').toUpperCase() || 'BGM');
  const rows = [
    ['形式', preview ? `${format} / FM+PSG 近似プレビュー` : format],
    ['ファイル', entry.sourcePath || entry.files?.[0] || '-'],
    ['サイズ', formatFileSize(meta.fileSizeBytes)],
    ['再生時間', formatDuration(Number(meta.durationSec || 0))],
  ];
  if (format === 'VGM') {
    rows.push(
      ['VGM version', formatHex(meta.version)],
      ['Data offset', formatHex(meta.dataOffset)],
      ['YM2612 clock', meta.ym2612Clock ? `${meta.ym2612Clock} Hz` : '-'],
      ['SN76489 clock', meta.sn76489Clock ? `${meta.sn76489Clock} Hz` : '-'],
      ['Writes', `YM2612 ${meta.ym2612Writes || 0} / PSG ${meta.psgWrites || 0}`],
      ['Wait samples', String(meta.waitSamples || 0)],
    );
  } else if (format === 'XGM') {
    rows.push(
      ['XGM version', formatHex(meta.version)],
      ['Timing', `${meta.timing || '-'}${meta.frameRate ? ` / ${meta.frameRate} fps` : ''}`],
      ['Frames', String(meta.durationFrames || 0)],
      ['Samples', `${meta.sampleCount || 0} / block ${formatFileSize(meta.sampleBlockSize)}`],
      ['Music data', `${formatFileSize(meta.musicDataSize)} @ ${formatHex(meta.musicDataOffset)}`],
      ['Writes', `YM2612 ${meta.ym2612Writes || 0} / PSG ${meta.psgWrites || 0} / PCM ${meta.pcmCommands || 0}`],
      ['Flags', `GD3 ${meta.hasGd3 ? 'yes' : 'no'} / Multi ${meta.multiTrack ? 'yes' : 'no'}`],
    );
  }
  if (preview) {
    rows.push(['プレビューエンジン', formatPreviewEngineStatus(meta.previewEngine || {})]);
    const build = meta.previewEngine?.buildInfo;
    const source = meta.previewEngine?.source || build?.source || build?.nukedOpn2Source || '';
    const builtAt = build?.builtAt || build?.buildTime || build?.timestamp || '';
    if (source || builtAt) rows.push(['Engine build', [source, builtAt].filter(Boolean).join(' / ')]);
  }
  if (meta.headerHex) rows.push(['Header', meta.headerHex]);
  const allWarnings = [...(Array.isArray(warnings) ? warnings : []), ...(Array.isArray(meta.warnings) ? meta.warnings : [])];
  if (allWarnings.length) rows.push(['Warning', allWarnings.slice(0, 3).join(' / ')]);
  return rows.map(([label, value]) => (
    `<div class="audio-meta-row"><span class="audio-meta-label">${escHtml(label)}</span><span>${escHtml(value)}</span></div>`
  )).join('');
}

function parseSpritePreviewSizeToken(value, imageDimension = 0) {
  const raw = String(value || '').trim().toUpperCase();
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return 16;
  if (raw.endsWith('P')) return Math.max(8, Math.min(248, Math.round(numeric / 8) * 8));
  if (raw.endsWith('F')) {
    const frames = Math.max(1, numeric);
    return imageDimension > 0 ? Math.max(8, Math.floor(imageDimension / frames / 8) * 8) : frames * 8;
  }
  return Math.max(8, Math.min(248, numeric * 8));
}

function parseSpritePreviewTimeRows(value, rows, columns) {
  const rowCount = Math.max(1, Number(rows) || 1);
  const columnCount = Math.max(1, Number(columns) || 1);
  const text = String(value == null ? '' : value).trim();
  if (!text || !text.startsWith('[')) {
    const fill = normalizeSpritePreviewTime(text || '0');
    return Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => fill));
  }
  const matches = Array.from(text.matchAll(/\[([^\[\]]*)\]/g)).map((match) => match[1]);
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const rowText = matches[rowIndex];
    if (rowText == null) return Array.from({ length: columnCount }, () => '0');
    const values = rowText === '' ? ['0'] : rowText.split(',').map((cell) => normalizeSpritePreviewTime(cell));
    return values.slice(0, columnCount).length ? values.slice(0, columnCount) : ['0'];
  });
}

function normalizeSpritePreviewTime(value) {
  const n = Number.parseInt(String(value == null ? '' : value).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(n);
}

function ensureSpritePreviewCanvas() {
  if (!el.inlineImageFrame) return null;
  let canvas = el.inlineImageFrame.querySelector('[data-sprite-preview-canvas]');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.dataset.spritePreviewCanvas = 'true';
    canvas.className = 'sprite-animation-preview-canvas';
    el.inlineImageFrame.appendChild(canvas);
  }
  return canvas;
}

function getSpritePreviewScale(frameWidth, frameHeight) {
  const zoom = String(state.preview.imageZoom || 'fit');
  if (zoom !== 'fit') return Math.max(0.25, Number(zoom) / 100 || 1);
  const host = el.inlineImageFrame;
  const fitWidth = Math.max(1, (host?.clientWidth || 240) - 24);
  const fitHeight = Math.max(1, (host?.clientHeight || 180) - 24);
  return Math.max(1, Math.min(8, Math.floor(Math.min(fitWidth / frameWidth, fitHeight / frameHeight))));
}

async function syncSpriteInlinePreview(entry) {
  if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = true;
  if (el.inlineNoPreview) el.inlineNoPreview.hidden = true;
  if (el.inlineImagePreview) el.inlineImagePreview.hidden = false;
  if (el.inlinePreviewImage) {
    el.inlinePreviewImage.hidden = true;
    el.inlinePreviewImage.style.display = 'none';
    el.inlinePreviewImage.removeAttribute('src');
  }
  if (el.inlinePalette) el.inlinePalette.innerHTML = '';

  const canvas = ensureSpritePreviewCanvas();
  if (!canvas) return;
  canvas.hidden = false;

  const data = entry.sourceAbsolutePath
    ? await window.electronAPI.readFileAsDataUrl(entry.sourceAbsolutePath).catch(() => null)
    : null;
  if (!data?.ok || !data.dataUrl) {
    if (el.inlinePreviewInfo) el.inlinePreviewInfo.textContent = `SPRITE ${entry.name || ''}: 画像を読み込めません`;
    return;
  }

  const img = new Image();
  img.src = data.dataUrl;
  await img.decode();
  if (state.rescomp.selectedEntryLine !== entry.lineNumber) return;

  state.preview.spriteEntryId = entry.id || `${entry.lineNumber}:${entry.name}`;
  state.preview.spriteImage = img;
  state.preview.spriteFrame = 0;
  state.preview.spriteRow = 0;
  state.preview.spritePlaying = true;
  state.preview.imageNaturalWidth = img.naturalWidth;
  state.preview.imageNaturalHeight = img.naturalHeight;

  const frameWidth = parseSpritePreviewSizeToken(entry.width || '2', img.naturalWidth);
  const frameHeight = parseSpritePreviewSizeToken(entry.height || '2', img.naturalHeight);
  const columns = Math.max(1, Math.floor(img.naturalWidth / frameWidth));
  const rows = Math.max(1, Math.floor(img.naturalHeight / frameHeight));
  const timeRows = parseSpritePreviewTimeRows(entry.time || '0', rows, columns);

  renderSpritePreviewInfo(entry, frameWidth, frameHeight, rows, columns, timeRows);
  drawSpritePreviewFrame(canvas, img, frameWidth, frameHeight, 0, 0);
  scheduleSpritePreviewFrame({ entry, img, canvas, frameWidth, frameHeight, rows, columns, timeRows });
}

function renderSpritePreviewInfo(entry, frameWidth, frameHeight, rows, columns, timeRows) {
  if (!el.inlinePreviewInfo) return;
  const options = timeRows.map((row, index) => (
    `<option value="${index}" ${index === state.preview.spriteRow ? 'selected' : ''}>${index} (${row.length} frames)</option>`
  )).join('');
  el.inlinePreviewInfo.innerHTML = `
    <div class="sprite-preview-info-line">SPRITE ${escHtml(entry.name || '')}: ${frameWidth} × ${frameHeight}px / ${columns} cols × ${rows} rows</div>
    <div class="sprite-preview-controls">
      <label class="sprite-preview-row-control">Animation
        <select class="form-input form-input-mono" data-sprite-preview-row>${options}</select>
      </label>
      <button class="icon-btn sprite-preview-play-toggle" type="button" data-sprite-preview-toggle aria-label="停止" title="SPRITEアニメーションを停止">
        <svg class="icon"><use href="#icon-stop"></use></svg>
      </button>
    </div>
  `;
  const select = el.inlinePreviewInfo.querySelector('[data-sprite-preview-row]');
  select?.addEventListener('change', () => {
    state.preview.spriteRow = Number(select.value) || 0;
    state.preview.spriteFrame = 0;
    redrawCurrentSpritePreview();
  });
  const toggle = el.inlinePreviewInfo.querySelector('[data-sprite-preview-toggle]');
  toggle?.addEventListener('click', () => toggleSpritePreviewPlayback());
  syncSpritePreviewPlaybackButton();
}

function drawSpritePreviewFrame(canvas, img, frameWidth, frameHeight, row, frame) {
  const scale = getSpritePreviewScale(frameWidth, frameHeight);
  const width = Math.max(1, Math.round(frameWidth * scale));
  const height = Math.max(1, Math.round(frameHeight * scale));
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, frame * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, width, height);
}

function scheduleSpritePreviewFrame({ entry, img, canvas, frameWidth, frameHeight, rows, columns, timeRows }) {
  if (!state.preview.spriteEntryId) return;
  if (state.preview.spriteTimer) {
    window.clearTimeout(state.preview.spriteTimer);
    state.preview.spriteTimer = 0;
  }
  const row = Math.max(0, Math.min(rows - 1, Number(state.preview.spriteRow) || 0));
  const rowTimes = timeRows[row] && timeRows[row].length ? timeRows[row] : Array.from({ length: columns }, () => '0');
  const frameCount = Math.max(1, Math.min(columns, rowTimes.length));
  state.preview.spriteFrame = Math.max(0, Math.min(frameCount - 1, state.preview.spriteFrame));
  drawSpritePreviewFrame(canvas, img, frameWidth, frameHeight, row, state.preview.spriteFrame);
  syncSpritePreviewPlaybackButton();
  if (!state.preview.spritePlaying || frameCount <= 1) return;
  const frameTime = Math.max(1, Number.parseInt(rowTimes[state.preview.spriteFrame] || '0', 10) || 6);
  state.preview.spriteTimer = window.setTimeout(() => {
    if (state.rescomp.selectedEntryLine !== entry.lineNumber) return;
    state.preview.spriteFrame = (state.preview.spriteFrame + 1) % frameCount;
    scheduleSpritePreviewFrame({ entry, img, canvas, frameWidth, frameHeight, rows, columns, timeRows });
  }, frameTime * (1000 / 60));
}

function syncSpritePreviewPlaybackButton() {
  const toggle = el.inlinePreviewInfo?.querySelector?.('[data-sprite-preview-toggle]');
  if (!toggle) return;
  toggle.classList.toggle('active', !!state.preview.spritePlaying);
  const label = state.preview.spritePlaying ? '停止' : '再生';
  toggle.setAttribute('aria-label', label);
  toggle.title = state.preview.spritePlaying ? 'SPRITEアニメーションを停止' : 'SPRITEアニメーションを再生';
  toggle.querySelector('use')?.setAttribute('href', state.preview.spritePlaying ? '#icon-stop' : '#icon-play');
}

function toggleSpritePreviewPlayback() {
  const entry = getCurrentSelectedEntry();
  if (!isSpriteEntry(entry)) return;
  state.preview.spritePlaying = !state.preview.spritePlaying;
  if (!state.preview.spritePlaying && state.preview.spriteTimer) {
    window.clearTimeout(state.preview.spriteTimer);
    state.preview.spriteTimer = 0;
  }
  syncSpritePreviewPlaybackButton();
  redrawCurrentSpritePreview();
}

function redrawCurrentSpritePreview() {
  const entry = getCurrentSelectedEntry();
  const img = state.preview.spriteImage;
  const canvas = el.inlineImageFrame?.querySelector?.('[data-sprite-preview-canvas]');
  if (!isSpriteEntry(entry) || !img || !canvas || canvas.hidden) return;
  const frameWidth = parseSpritePreviewSizeToken(entry.width || '2', img.naturalWidth);
  const frameHeight = parseSpritePreviewSizeToken(entry.height || '2', img.naturalHeight);
  const columns = Math.max(1, Math.floor(img.naturalWidth / frameWidth));
  const rows = Math.max(1, Math.floor(img.naturalHeight / frameHeight));
  const timeRows = parseSpritePreviewTimeRows(entry.time || '0', rows, columns);
  scheduleSpritePreviewFrame({ entry, img, canvas, frameWidth, frameHeight, rows, columns, timeRows });
}

async function syncInlinePreview(entry) {
  stopVgmPreview();
  stopSpritePreview();
  if (!entry) {
    if (el.inlineImagePreview) el.inlineImagePreview.hidden = true;
    if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = true;
    if (el.audioPlayer) el.audioPlayer.hidden = false;
    if (el.inlineNoPreview) el.inlineNoPreview.hidden = false;
    return;
  }

  if (isVgmPreviewEntry(entry)) {
    if (el.inlineImagePreview) el.inlineImagePreview.hidden = true;
    if (el.inlineNoPreview) el.inlineNoPreview.hidden = true;
    if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = false;
    if (el.audioPlayer) el.audioPlayer.hidden = false;
    if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = '<span class="audio-meta-loading">VGM を読み込み中...</span>';
    syncAudioPlayer(false);

    const sourcePath = getVgmPreviewSourcePath(entry);
    const player = getPluginCapability('vgm-preview-player');
    if (!sourcePath || !player?.load) {
      if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = '<div class="audio-meta-row"><span>VGM preview provider が利用できません</span></div>';
      return;
    }
    window.electronAPI.readFileAsDataUrl(sourcePath).then((res) => {
      if (state.rescomp.selectedEntryLine !== entry.lineNumber) return;
      if (!res?.ok || !res.dataUrl) {
        if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(entry.sourcePath || sourcePath)} を読み込めません</span></div>`;
        return;
      }
      const loaded = player.load({ entry, dataUrl: res.dataUrl });
      if (!loaded?.ok) {
        if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(loaded?.error || 'VGM を解析できません')}</span></div>`;
        return;
      }
      state.preview.vgmEntryId = entry.id;
      state.preview.vgmDurationSec = Number(loaded.meta?.durationSec || 0);
      if (el.audioPreviewMeta) {
        el.audioPreviewMeta.innerHTML = renderBgmMetaRows(entry, loaded.meta, loaded.warnings, { preview: true });
      }
      player.loadHighAccuracyEngine?.().then((engineResult) => {
        if (state.rescomp.selectedEntryLine !== entry.lineNumber) return;
        const previewEngine = engineResult?.status || player.getEngineStatus?.() || loaded.previewEngine || loaded.meta?.previewEngine;
        const warnings = [
          ...(engineResult?.warning ? [engineResult.warning] : []),
          ...(loaded.warnings || []),
        ].filter((warning) => !(engineResult?.ok && String(warning).includes('高精度WASM')));
        if (el.audioPreviewMeta) {
          el.audioPreviewMeta.innerHTML = renderBgmMetaRows(entry, {
            ...loaded.meta,
            previewEngine,
          }, warnings, { preview: true });
        }
      }).catch((err) => {
        if (state.rescomp.selectedEntryLine !== entry.lineNumber) return;
        const previewEngine = {
          label: '簡易 Web Audio',
          state: 'fallback',
          highAccuracyAvailable: false,
          message: String(err?.message || err),
        };
        if (el.audioPreviewMeta) {
          el.audioPreviewMeta.innerHTML = renderBgmMetaRows(entry, {
            ...loaded.meta,
            previewEngine,
          }, [String(err?.message || err), ...(loaded.warnings || [])], { preview: true });
        }
      });
    }).catch((err) => {
      if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(String(err?.message || err))}</span></div>`;
    });
    return;
  }

  if (isBgmMetaEntry(entry)) {
    if (el.inlineImagePreview) el.inlineImagePreview.hidden = true;
    if (el.inlineNoPreview) el.inlineNoPreview.hidden = true;
    if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = false;
    if (el.audioPlayer) el.audioPlayer.hidden = true;
    if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = '<span class="audio-meta-loading">BGM メタ情報を読み込み中...</span>';
    syncAudioPlayer(false);

    const sourcePath = getMusicMetaSourcePath(entry);
    const player = getPluginCapability('vgm-preview-player');
    if (!sourcePath || !player?.parseXgm) {
      if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = '<div class="audio-meta-row"><span>BGM metadata provider が利用できません</span></div>';
      return;
    }
    window.electronAPI.readFileAsDataUrl(sourcePath).then((res) => {
      if (state.rescomp.selectedEntryLine !== entry.lineNumber) return;
      if (!res?.ok || !res.dataUrl) {
        if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(entry.sourcePath || sourcePath)} を読み込めません</span></div>`;
        return;
      }
      const ext = pathExt(sourcePath);
      const parsed = ext === '.xgm'
        ? player.parseXgm({ entry, dataUrl: res.dataUrl })
        : player.parseVgm?.({ entry, dataUrl: res.dataUrl });
      if (!parsed?.ok) {
        if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(parsed?.error || 'BGM メタ情報を解析できません')}</span></div>`;
        return;
      }
      if (el.audioPreviewMeta) {
        el.audioPreviewMeta.innerHTML = renderBgmMetaRows(entry, parsed.meta, parsed.warnings);
      }
    }).catch((err) => {
      if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(String(err?.message || err))}</span></div>`;
    });
    return;
  }

  if (isSpriteEntry(entry)) {
    await syncSpriteInlinePreview(entry);
    return;
  }

  if (isImageEntry(entry)) {
    if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = true;
    if (el.audioPlayer) el.audioPlayer.hidden = false;
    if (el.inlineNoPreview) el.inlineNoPreview.hidden = true;
    if (el.inlineImagePreview) el.inlineImagePreview.hidden = false;

    state.preview.imageEntryId = entry.id;
    state.preview.imageNaturalWidth = 0;
    state.preview.imageNaturalHeight = 0;
    if (el.inlinePalette) el.inlinePalette.innerHTML = '';
    if (el.inlinePreviewInfo) el.inlinePreviewInfo.textContent = '';

    const src = entry.sourceAbsolutePath ? toFileUrl(entry.sourceAbsolutePath) : '';
    if (el.inlinePreviewImage) {
      el.inlinePreviewImage.hidden = false;
      el.inlinePreviewImage.style.display = '';
      el.inlinePreviewImage.src = src;
      applyInlineImageZoom();
    }
    const spriteCanvas = el.inlineImageFrame?.querySelector?.('[data-sprite-preview-canvas]');
    if (spriteCanvas) spriteCanvas.hidden = true;

    if (src) {
      const img = new Image();
      img.onload = () => {
        state.preview.imageNaturalWidth = img.naturalWidth;
        state.preview.imageNaturalHeight = img.naturalHeight;
        if (el.inlinePreviewInfo) {
          el.inlinePreviewInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
        }
        applyInlineImageZoom();
        const cvs = document.createElement('canvas');
        cvs.width = img.naturalWidth;
        cvs.height = img.naturalHeight;
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const fallbackColors = extractDisplayPalette(imageData, 16);
        const paletteBuilder = getPluginCapability('asset-manager')?.buildPreviewPalette;
        if (typeof paletteBuilder === 'function' && entry.sourceAbsolutePath) {
          window.electronAPI.readFileAsDataUrl(entry.sourceAbsolutePath).then((res) => {
            const colors = res?.ok
              ? paletteBuilder({ dataUrl: res.dataUrl, fallbackColors, maxColors: 16 })
              : fallbackColors;
            renderPaletteSwatches(el.inlinePalette, colors);
          }).catch(() => renderPaletteSwatches(el.inlinePalette, fallbackColors));
        } else {
          renderPaletteSwatches(el.inlinePalette, fallbackColors);
        }
      };
      img.src = src;
      // fetch file size via dataUrl
      if (entry.sourceAbsolutePath) {
        window.electronAPI.readFileAsDataUrl(entry.sourceAbsolutePath).then((res) => {
          if (res?.ok && el.inlinePreviewInfo) {
            const bytes = Math.round(res.dataUrl.replace(/^data:[^,]+,/, '').replace(/=/g, '').length * 0.75);
            const sz = formatFileSize(bytes);
            const cur = el.inlinePreviewInfo.textContent;
            if (cur && sz !== '-') el.inlinePreviewInfo.textContent = `${cur}  |  ${sz}`;
          }
        }).catch(() => {});
      }
    }
    return;
  }

  if (isAudioEntry(entry)) {
    stopVgmPreview();
    if (el.inlineImagePreview) el.inlineImagePreview.hidden = true;
    if (el.inlineNoPreview) el.inlineNoPreview.hidden = true;
    if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = false;
    if (el.audioPlayer) el.audioPlayer.hidden = false;
    if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = '<span class="audio-meta-loading">読み込み中...</span>';
    syncAudioPlayer(false);

    if (entry.sourceAbsolutePath) {
      window.electronAPI.readFileAsDataUrl(entry.sourceAbsolutePath).then((res) => {
        if (!res?.ok || !el.audioPreviewMeta) return;
        const meta = parseWavHeader(res.dataUrl);
        if (!meta) {
          el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(entry.sourcePath || '')}</span></div>`;
          return;
        }
        const chStr = meta.numChannels === 1 ? 'モノラル' : meta.numChannels === 2 ? 'ステレオ' : `${meta.numChannels}ch`;
        el.audioPreviewMeta.innerHTML = `
          <div class="audio-meta-row"><span class="audio-meta-label">ファイル</span><span>${escHtml(entry.sourcePath || '')}</span></div>
          <div class="audio-meta-row"><span class="audio-meta-label">再生時間</span><span>${formatDuration(meta.durationSec)}</span></div>
          <div class="audio-meta-row"><span class="audio-meta-label">サンプルレート</span><span>${meta.sampleRate.toLocaleString()} Hz</span></div>
          <div class="audio-meta-row"><span class="audio-meta-label">形式</span><span>${chStr} / ${meta.bitsPerSample} bit</span></div>
          <div class="audio-meta-row"><span class="audio-meta-label">ファイルサイズ</span><span>${formatFileSize(meta.fileSizeBytes)}</span></div>
        `;
      }).catch(() => {
        if (el.audioPreviewMeta) el.audioPreviewMeta.innerHTML = `<div class="audio-meta-row"><span>${escHtml(entry.sourcePath || '')}</span></div>`;
      });
    }
    return;
  }

  // no preview available
  if (el.inlineImagePreview) el.inlineImagePreview.hidden = true;
  if (el.inlineAudioPreview) el.inlineAudioPreview.hidden = true;
  if (el.inlineNoPreview) el.inlineNoPreview.hidden = false;
}

function setAccordionOpen(section, open) {
  if (section === 'params') {
    state.preview.paramsOpen = open;
    if (el.btnAccordionParams) el.btnAccordionParams.setAttribute('aria-expanded', String(open));
    if (el.accordionParamsBody) el.accordionParamsBody.classList.toggle('is-collapsed', !open);
  } else {
    state.preview.previewOpen = open;
    if (el.btnAccordionPreview) el.btnAccordionPreview.setAttribute('aria-expanded', String(open));
    if (el.accordionPreviewBody) el.accordionPreviewBody.classList.toggle('is-collapsed', !open);
  }
}

function setPreviewPanelOpen(open) {
  state.preview.panelOpen = open;
  if (el.assetsLayout) el.assetsLayout.classList.toggle('preview-collapsed', !open);
  if (el.btnTogglePreviewPanel) {
    el.btnTogglePreviewPanel.setAttribute('aria-pressed', String(open));
    el.btnTogglePreviewPanel.title = open ? 'プレビューパネルを閉じる' : 'プレビューパネルを開く';
    const iconClose = el.btnTogglePreviewPanel.querySelector('.icon-panel-close');
    const iconOpen = el.btnTogglePreviewPanel.querySelector('.icon-panel-open');
    if (iconClose) iconClose.style.display = open ? '' : 'none';
    if (iconOpen) iconOpen.style.display = open ? 'none' : '';
  }
}

function loadAssetPreviewWidth() {
  try {
    const saved = Number(localStorage.getItem(ASSET_PREVIEW_WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) {
      state.preview.panelWidth = clamp(saved, ASSET_PREVIEW_MIN_WIDTH, ASSET_PREVIEW_MAX_WIDTH);
    }
  } catch (_) {}
  applyAssetPreviewWidth();
}

function applyAssetPreviewWidth() {
  if (!el.assetsLayout) return;
  el.assetsLayout.style.setProperty('--asset-preview-width', `${state.preview.panelWidth}px`);
}

function saveAssetPreviewWidth() {
  try {
    localStorage.setItem(ASSET_PREVIEW_WIDTH_KEY, String(Math.round(state.preview.panelWidth)));
  } catch (_) {}
}

function beginAssetPreviewResize(event) {
  if (!el.assetsLayout || !state.preview.panelOpen) return;
  event.preventDefault();
  el.assetPreviewResizer?.classList.add('is-dragging');
  const layoutRect = el.assetsLayout.getBoundingClientRect();
  const maxWidth = Math.min(ASSET_PREVIEW_MAX_WIDTH, Math.max(ASSET_PREVIEW_MIN_WIDTH, layoutRect.width - 320));

  const resize = (moveEvent) => {
    const nextWidth = clamp(layoutRect.right - moveEvent.clientX, ASSET_PREVIEW_MIN_WIDTH, maxWidth);
    state.preview.panelWidth = nextWidth;
    applyAssetPreviewWidth();
  };
  const finish = () => {
    el.assetPreviewResizer?.classList.remove('is-dragging');
    saveAssetPreviewWidth();
    window.removeEventListener('pointermove', resize);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
  };

  window.addEventListener('pointermove', resize);
  window.addEventListener('pointerup', finish, { once: true });
  window.addEventListener('pointercancel', finish, { once: true });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function syncAudioPlayer(isPlaying) {
  if (el.audioPlayIcon) {
    el.audioPlayIcon.querySelector('use')?.setAttribute('href', isPlaying ? '#icon-stop' : '#icon-play');
  }
  if (el.btnAudioPlay) {
    el.btnAudioPlay.title = isPlaying ? '停止' : '再生';
  }
  if (!isPlaying && el.audioSeek) {
    el.audioSeek.value = 0;
  }
  if (!isPlaying && el.audioTime) {
    el.audioTime.textContent = '0:00';
  }
}

function toggleAudioPreview(entry) {
  if (!isAudioEntry(entry) || !entry.sourceAbsolutePath) {
    return;
  }

  stopVgmPreview();
  if (state.preview.audioEntryId === entry.id && state.preview.audio) {
    stopAudioPreview();
    return;
  }

  stopAudioPreview();
  const audio = new Audio(toFileUrl(entry.sourceAbsolutePath));

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration || !el.audioSeek || !el.audioTime) return;
    el.audioSeek.value = (audio.currentTime / audio.duration) * 100;
    const m = Math.floor(audio.currentTime / 60);
    const s = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
    el.audioTime.textContent = `${m}:${s}`;
  });

  audio.addEventListener('ended', () => {
    stopAudioPreview();
  });

  state.preview.audio = audio;
  state.preview.audioEntryId = entry.id;
  audio.play().then(() => {
    syncAudioPlayer(true);
  }).catch(() => {
    stopAudioPreview();
  });
}

async function toggleVgmPreview(entry) {
  if (!isVgmPreviewEntry(entry)) return;
  const player = getPluginCapability('vgm-preview-player');
  if (!player?.play) return;

  if (state.preview.vgmEntryId === entry.id && player.isPlaying?.()) {
    stopVgmPreview();
    return;
  }

  stopAudioPreview();
  state.preview.vgmEntryId = entry.id;
  const result = await player.play({
    onTime: (currentSec) => {
      const duration = Math.max(0.01, Number(state.preview.vgmDurationSec || 0));
      if (el.audioSeek) el.audioSeek.value = (currentSec / duration) * 100;
      if (el.audioTime) {
        const m = Math.floor(currentSec / 60);
        const s = Math.floor(currentSec % 60).toString().padStart(2, '0');
        el.audioTime.textContent = `${m}:${s}`;
      }
    },
    onEnded: () => {
      stopVgmPreview();
    },
    onError: () => {
      stopVgmPreview();
    },
  });
  if (result?.ok) {
    state.preview.vgmDurationSec = Number(result.durationSec || state.preview.vgmDurationSec || 0);
    syncAudioPlayer(true);
    if (el.audioPreviewMeta && result.previewEngine) {
      const current = getCurrentSelectedEntry();
      if (current && current.id === entry.id) {
        const engineRow = `<div class="audio-meta-row audio-meta-engine"><span class="audio-meta-label">使用中エンジン</span><span>${escHtml(formatPreviewEngineStatus(result.previewEngine))}</span></div>`;
        if (!el.audioPreviewMeta.innerHTML.includes('使用中エンジン')) {
          el.audioPreviewMeta.innerHTML += engineRow;
        }
      }
    }
  } else {
    stopVgmPreview();
    if (el.audioPreviewMeta) {
      el.audioPreviewMeta.innerHTML += `<div class="audio-meta-row"><span class="audio-meta-label">Error</span><span>${escHtml(result?.error || 'VGM preview failed')}</span></div>`;
    }
  }
}

function renderAssetTable() {
  if (!el.assetTableBody) return;

  const rows = getFilteredEntries();
  el.assetTableBody.innerHTML = '';

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'asset-row-empty';
    tr.innerHTML = '<td colspan="6">一致する定義がありません</td>';
    el.assetTableBody.appendChild(tr);
    if (el.assetTableHint) el.assetTableHint.textContent = '定義を追加するか、検索条件を変更してください。';
    renderAssetEditor(null);
    return;
  }

  if (el.assetTableHint) {
    el.assetTableHint.textContent = `${rows.length} 件 / ${state.rescomp.selectedFile}`;
  }

  rows.forEach((entry) => {
    const tr = document.createElement('tr');
    tr.className = 'asset-row';
    tr.title = buildEntryTooltip(entry);
    tr.draggable = true;
    if (Number(state.rescomp.selectedEntryLine) === Number(entry.lineNumber)) {
      tr.classList.add('active');
    }

    const isPlaying = isAudioEntry(entry) && state.preview.audioEntryId === entry.id;

    tr.innerHTML = `
      <td class="asset-drag-cell"><span class="drag-handle">&#8942;&#8942;</span></td>
      <td>${toTypeBadge(escHtml(entry.type))}</td>
      <td>${escHtml(entry.name)}</td>
      <td class="asset-path-cell">${escHtml(entry.sourcePath || '')}</td>
      <td class="asset-comment-cell">${escHtml(entry.comment || '')}</td>
      <td class="asset-actions-cell">
        <button class="icon-btn-sm" data-delete-line="${entry.lineNumber}" title="定義削除">
          <svg class="icon-sm"><use href="#icon-trash"></use></svg>
        </button>
      </td>
    `;

    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button[data-delete-line]')) return;
      state.rescomp.selectedEntryLine = Number(entry.lineNumber);
      renderAssetTable();
      renderAssetEditor(entry);
    });

    const deleteBtn = tr.querySelector('button[data-delete-line]');
    deleteBtn?.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await deleteEntry(entry);
    });

    tr.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(entry.lineNumber));
      tr.classList.add('drag-source');
    });
    tr.addEventListener('dragend', () => {
      tr.classList.remove('drag-source');
      el.assetTableBody?.querySelectorAll('.drag-over').forEach((r) => r.classList.remove('drag-over'));
    });
    tr.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      el.assetTableBody?.querySelectorAll('.drag-over').forEach((r) => r.classList.remove('drag-over'));
      tr.classList.add('drag-over');
    });
    tr.addEventListener('dragleave', (ev) => {
      if (!tr.contains(ev.relatedTarget)) tr.classList.remove('drag-over');
    });
    tr.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      tr.classList.remove('drag-over');
      const fromLine = Number(ev.dataTransfer.getData('text/plain'));
      const toLine = Number(entry.lineNumber);
      if (fromLine !== toLine) await reorderEntry(fromLine, toLine);
    });

    el.assetTableBody.appendChild(tr);
  });

  const current = getEntryByLine(state.rescomp.selectedEntryLine) || rows[0];
  state.rescomp.selectedEntryLine = current ? Number(current.lineNumber) : null;
  renderAssetEditor(current);
}

function createFieldInput(field, value) {
  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    input.className = 'form-input form-input-mono';
    (field.options || []).forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    });
    input.value = value || field.options?.[0] || '';
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.className = field.key === 'sourcePath' ? 'form-input form-input-mono' : 'form-input';
    input.value = value || '';
  }
  input.dataset.field = field.key;
  return input;
}

function getAssetFieldLabel(entry, field) {
  if ((entry?.type === 'MAP' || entry?.type === 'TILEMAP')
    && field.key === 'tileset'
    && String(entry?.sourcePath || '').toLowerCase().endsWith('.tmx')) {
    return 'layer_id';
  }
  return field.label;
}

function getAssetFieldsForEntry(entry) {
  const type = String(entry?.type || '').toUpperCase();
  const isTmxInput = (type === 'MAP' || type === 'TILEMAP')
    && String(entry?.sourcePath || '').toLowerCase().endsWith('.tmx');
  if (isTmxInput) {
    return [
      { key: 'name', label: 'シンボル名', type: 'text' },
      { key: 'sourcePath', label: '入力TMX', type: 'text' },
      { key: 'tileset', label: 'layer_id', type: 'text' },
      { key: 'compression', label: 'tileset圧縮', type: 'select', options: COMPRESSION_OPTIONS },
      { key: 'mapCompression', label: 'map圧縮', type: 'select', options: COMPRESSION_OPTIONS },
      { key: 'mapBase', label: 'map_base', type: 'text' },
      { key: 'ordering', label: 'ordering', type: 'select', options: ORDERING_OPTIONS },
    ];
  }
  return FORM_FIELDS_BY_TYPE[type] || [
    { key: 'name', label: 'シンボル名', type: 'text' },
    { key: 'sourcePath', label: '入力ファイル', type: 'text' },
  ];
}

function isWavOutRateSupportedDriver(driver) {
  const normalized = String(driver || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(WAV_OUT_RATE_OPTIONS_BY_DRIVER, normalized);
}

function getWavOutRateOptions(driver) {
  const normalized = String(driver || '').toUpperCase();
  const list = WAV_OUT_RATE_OPTIONS_BY_DRIVER[normalized] || [];
  return ['', ...list];
}

function getWavDefaultOutRate(driver) {
  const normalized = String(driver || '').toUpperCase();
  return WAV_OUT_RATE_DEFAULT_BY_DRIVER[normalized] || '';
}

function setSelectOptions(select, options, value) {
  if (!select) return;
  select.innerHTML = '';
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = String(opt);
    o.textContent = opt === '' ? '(省略)' : String(opt);
    select.appendChild(o);
  });
  const desired = String(value || '');
  if (options.includes(desired)) {
    select.value = desired;
    return;
  }
  select.value = options[0] || '';
}

function bindWavOutRateDriverSync(container) {
  const driverInput = container?.querySelector('[data-field="driver"]');
  const outRateInput = container?.querySelector('[data-field="outRate"]');
  if (!(driverInput instanceof HTMLSelectElement) || !(outRateInput instanceof HTMLSelectElement)) {
    return;
  }

  const sync = () => {
    const driver = String(driverInput.value || '').toUpperCase();
    const supported = isWavOutRateSupportedDriver(driver);
    const options = getWavOutRateOptions(driver);
    const current = String(outRateInput.value || '');
    setSelectOptions(outRateInput, options, current);
    outRateInput.disabled = !supported;
    if (!supported) {
      outRateInput.value = '';
      return;
    }
    const defaultValue = getWavDefaultOutRate(driver);
    if (!outRateInput.value || !options.includes(outRateInput.value)) {
      outRateInput.value = defaultValue;
    }
  };

  driverInput.addEventListener('change', sync);
  driverInput.addEventListener('input', sync);
  sync();
}

let _autoSaveTimer = null;
function scheduleAutoSave() {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    _autoSaveTimer = null;
    saveCurrentEntry(true);
  }, 400);
}

function renderAssetEditor(entry) {
  if (!el.assetEditForm || !el.assetEditorPanel) return;

  if (!entry) {
    if (el.assetNoSelectionHint) el.assetNoSelectionHint.hidden = false;
    el.assetEditForm.innerHTML = '';
    syncInlinePreview(null);
    return;
  }

  if (el.assetNoSelectionHint) el.assetNoSelectionHint.hidden = true;

  // restore accordion state
  setAccordionOpen('params', state.preview.paramsOpen);
  setAccordionOpen('preview', state.preview.previewOpen);

  const fields = getAssetFieldsForEntry(entry);

  el.assetEditForm.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'asset-edit-grid';

  fields.forEach((field) => {
    const label = document.createElement('label');
    label.textContent = getAssetFieldLabel(entry, field);
    const input = createFieldInput(field, entry[field.key]);
    grid.appendChild(label);
    grid.appendChild(input);
  });

  const warning = document.createElement('div');
  warning.className = 'asset-warning';
  warning.textContent = entry.type === 'XGM2'
    ? 'XGM2 の複数ファイル対応は options で追記可能です。'
    : '';

  const commentLabel = document.createElement('label');
  commentLabel.textContent = 'コメント';
  const commentInput = document.createElement('textarea');
  commentInput.className = 'form-input form-input-mono';
  commentInput.rows = 4;
  commentInput.value = entry.comment || '';
  commentInput.dataset.field = 'comment';

  grid.appendChild(commentLabel);
  grid.appendChild(commentInput);

  el.assetEditForm.appendChild(grid);
  if (warning.textContent) {
    el.assetEditForm.appendChild(warning);
  }
  if (entry.type === 'WAV') {
    bindWavOutRateDriverSync(el.assetEditForm);
  }

  // auto-save on edit
  el.assetEditForm.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', scheduleAutoSave);
    input.addEventListener('change', scheduleAutoSave);
  });

  // update preview tab
  syncInlinePreview(entry);
}

function collectEditedEntry(entry) {
  const next = { ...entry };
  if (!el.assetEditForm) return next;

  el.assetEditForm.querySelectorAll('[data-field]').forEach((input) => {
    const key = input.dataset.field;
    next[key] = input.value;
  });

  next.type = String(entry.type || '').toUpperCase();
  if (next.type === 'XGM2') {
    next.files = [next.sourcePath || ''];
  }
  if (next.type === 'WAV') {
    const driver = String(next.driver || 'DEFAULT').toUpperCase();
    const options = getWavOutRateOptions(driver);
    if (!isWavOutRateSupportedDriver(driver)) {
      next.outRate = '';
    } else if (!options.includes(String(next.outRate || ''))) {
      next.outRate = getWavDefaultOutRate(driver);
    }
  }

  return next;
}

async function saveCurrentEntry(silent = false) {
  const entry = getEntryByLine(state.rescomp.selectedEntryLine);
  if (!entry) return;

  const edited = collectEditedEntry(entry);
  const payload = {
    file: state.rescomp.selectedFile,
    lineNumber: entry.lineNumber,
    entry: edited,
  };

  const result = await window.electronAPI.updateResEntry(payload);
  if (!result?.ok) {
    if (el.assetTableHint) {
      el.assetTableHint.textContent = `保存失敗: ${result?.error || 'unknown'}`;
    }
    return;
  }

  if (silent) {
    // update local entry in memory without re-rendering (avoids cursor loss during typing)
    const file = getSelectedFile();
    if (file) {
      const idx = file.entries.findIndex((e) => e.lineNumber === entry.lineNumber);
      if (idx >= 0) file.entries[idx] = { ...file.entries[idx], ...edited };
    }
    if (el.assetTableHint) el.assetTableHint.textContent = '自動保存しました';
    return;
  }

  await loadResDefinitions({ keepSelection: true });
  if (el.assetTableHint) {
    el.assetTableHint.textContent = '定義を保存しました';
  }
}

async function deleteEntry(entry) {
  const ok = window.confirm(`定義を削除しますか？\n${entry.type} ${entry.name}`);
  if (!ok) return;

  const result = await window.electronAPI.deleteResEntry({
    file: state.rescomp.selectedFile,
    lineNumber: entry.lineNumber,
  });

  if (!result?.ok) {
    if (el.assetTableHint) {
      el.assetTableHint.textContent = `削除失敗: ${result?.error || 'unknown'}`;
    }
    return;
  }

  state.rescomp.selectedEntryLine = null;
  await loadResDefinitions({ keepSelection: true });
}

async function deleteCurrentResFile() {
  const fileName = state.rescomp.selectedFile || el.resFileSelect?.value || '';
  if (!fileName) {
    if (el.assetTableHint) el.assetTableHint.textContent = '削除する .res ファイルがありません';
    return;
  }

  const selectedFile = getSelectedFile();
  const countText = selectedFile ? `${selectedFile.entryCount || 0} 件の定義を含む ` : '';
  const ok = window.confirm(`${countText}.res ファイルを削除しますか？\n${fileName}`);
  if (!ok) return;

  const result = await window.electronAPI.deleteResFile(fileName);
  if (!result?.ok) {
    if (el.assetTableHint) {
      el.assetTableHint.textContent = `.res ファイル削除失敗: ${result?.error || 'unknown'}`;
    }
    return;
  }

  state.rescomp.selectedFile = '';
  state.rescomp.selectedEntryLine = null;
  await loadResDefinitions({ keepSelection: false });
  if (el.assetTableHint) {
    el.assetTableHint.textContent = `.res ファイルを削除しました: ${fileName}`;
  }
}

async function reorderEntry(fromLine, toLine) {
  const file = getSelectedFile();
  if (!file) return;
  const entries = file.entries;
  const fromIdx = entries.findIndex((e) => Number(e.lineNumber) === fromLine);
  const toIdx = entries.findIndex((e) => Number(e.lineNumber) === toLine);
  if (fromIdx < 0 || toIdx < 0) return;

  const orderedLineNumbers = entries.map((e) => Number(e.lineNumber));
  const [removed] = orderedLineNumbers.splice(fromIdx, 1);
  orderedLineNumbers.splice(toIdx, 0, removed);

  const result = await window.electronAPI.reorderResEntries({
    file: state.rescomp.selectedFile,
    orderedLineNumbers,
  });
  if (!result?.ok) {
    if (el.assetTableHint) el.assetTableHint.textContent = `\u4e26\u3073\u66ff\u3048\u5931\u6557: ${result?.error || 'unknown'}`;
    return;
  }
  state.rescomp.selectedEntryLine = null;
  await loadResDefinitions({ keepSelection: false });
}

async function loadResDefinitions({ keepSelection = false } = {}) {
  if (getActiveCoreId() === 'pc-engine') {
    state.rescomp.resRoot = '';
    state.rescomp.files = [];
    state.rescomp.selectedFile = '';
    state.rescomp.selectedEntryLine = null;
    renderResFileSelect();
    renderAssetTable();
    return;
  }
  const prevFile = state.rescomp.selectedFile;
  const prevLine = state.rescomp.selectedEntryLine;

  const result = await window.electronAPI.listResDefinitions();
  if (!result?.ok) {
    if (el.assetTableHint) {
      el.assetTableHint.textContent = `読み込み失敗: ${result?.error || 'unknown'}`;
    }
    return;
  }

  state.rescomp.resRoot = result.resRoot || '';
  state.rescomp.files = result.files || [];

  if (keepSelection && prevFile && state.rescomp.files.some((f) => f.file === prevFile)) {
    state.rescomp.selectedFile = prevFile;
  } else if (!state.rescomp.selectedFile || !state.rescomp.files.some((f) => f.file === state.rescomp.selectedFile)) {
    state.rescomp.selectedFile = state.rescomp.files[0]?.file || '';
  }

  if (keepSelection && prevLine) {
    state.rescomp.selectedEntryLine = prevLine;
  } else {
    state.rescomp.selectedEntryLine = null;
  }

  renderResFileSelect();
  renderAssetTable();
}

function populateAssetTypeOptions(selectedType, ext, providedAllowed = null) {
  if (!el.assetTypeInput) return;
  const allowed = Array.isArray(providedAllowed) && providedAllowed.length > 0
    ? providedAllowed
    : allowedTypesForExtension(ext);
  el.assetTypeInput.innerHTML = '';
  TYPE_OPTIONS.filter((t) => allowed.includes(t)).forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    el.assetTypeInput.appendChild(opt);
  });
  el.assetTypeInput.value = allowed.includes(selectedType) ? selectedType : (allowed[0] || 'IMAGE');
}

function populateAssetResFileOptions() {
  if (!el.assetResFileInput) return;
  el.assetResFileInput.innerHTML = '';
  state.rescomp.files.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.file;
    opt.textContent = f.file;
    el.assetResFileInput.appendChild(opt);
  });
  el.assetResFileInput.value = state.rescomp.selectedFile || state.rescomp.files[0]?.file || 'resources.res';
}

function syncAssetModalForType() {
  const type = el.assetTypeInput?.value || 'IMAGE';
  const fileName = el.assetTargetFileNameInput?.value || '';
  if (el.assetTargetSubdirInput && !el.assetTargetSubdirInput.dataset.userEdited) {
    el.assetTargetSubdirInput.value = defaultSubDirForType(type);
  }
  if (el.assetSymbolNameInput && fileName && !el.assetSymbolNameInput.dataset.userEdited) {
    el.assetSymbolNameInput.value = normalizeSymbolName(fileName);
  }
  const showResize = ['IMAGE', 'BITMAP', 'SPRITE', 'MAP', 'TILEMAP', 'TILESET'].includes(type);
  const wRow = el.assetResizeTargetWidth?.closest('.form-group');
  const hRow = el.assetResizeTargetHeight?.closest('.form-group');
  if (wRow) wRow.style.display = showResize ? '' : 'none';
  if (hRow) hRow.style.display = showResize ? '' : 'none';
  if (!showResize) {
    if (el.assetResizeTargetWidth) el.assetResizeTargetWidth.value = '';
    if (el.assetResizeTargetHeight) el.assetResizeTargetHeight.value = '';
  }
}

function openResFileModal() {
  if (el.resFileNameInput) el.resFileNameInput.value = '';
  openModal(el.resFileModal);
}

async function submitResFileModal() {
  const fileName = el.resFileNameInput?.value.trim() || '';
  if (!fileName) {
    if (el.assetTableHint) el.assetTableHint.textContent = 'ファイル名を入力してください。';
    return;
  }
  const result = await window.electronAPI.createResFile(fileName);
  if (!result?.ok) {
    if (el.assetTableHint) el.assetTableHint.textContent = `作成失敗: ${result?.error || 'unknown'}`;
    return;
  }
  state.rescomp.selectedFile = fileName;
  await loadResDefinitions({ keepSelection: true });
  closeModal(el.resFileModal);
  if (el.assetTableHint) el.assetTableHint.textContent = `作成しました: ${fileName}`;
}

function snapChannelTo3Bit(value) {
  const level = Math.max(0, Math.min(7, Math.round((Number(value) / 255) * 7)));
  return level * 36;
}

function snapColorToMegaDrive(color) {
  return {
    r: snapChannelTo3Bit(color.r),
    g: snapChannelTo3Bit(color.g),
    b: snapChannelTo3Bit(color.b),
  };
}

function colorDistanceSq(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return (dr * dr * 0.30) + (dg * dg * 0.59) + (db * db * 0.11);
}

function countUniqueColors(imageData) {
  const seen = new Set();
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return seen.size;
}

function hexToRgb(hex) {
  const h = String(hex || '#000000').replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function rgbToHex(color) {
  const toHex2 = (v) => Math.max(0, Math.min(255, Number(v) || 0)).toString(16).padStart(2, '0');
  return `#${toHex2(color?.r)}${toHex2(color?.g)}${toHex2(color?.b)}`;
}

function getColorRange(colors, channel) {
  let min = Infinity;
  let max = -Infinity;
  colors.forEach((color) => {
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  });
  return max - min;
}

function weightedAverageColor(colors) {
  let total = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  colors.forEach((color) => {
    const weight = Math.max(1, colorImportance(color));
    total += weight;
    r += color.r * weight;
    g += color.g * weight;
    b += color.b * weight;
  });
  return snapColorToMegaDrive({
    r: total ? r / total : 0,
    g: total ? g / total : 0,
    b: total ? b / total : 0,
  });
}

function colorImportance(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const saturation = max <= 0 ? 0 : (max - min) / max;
  return color.count * (1 + saturation * 0.85 + Math.max(0, color.edge || 0) * 0.75);
}

function weightedMedianCutPalette(colors, maxColors) {
  if (colors.length <= maxColors) {
    return colors.map(({ r, g, b }) => ({ r, g, b }));
  }

  const boxes = [colors.slice()];
  while (boxes.length < maxColors) {
    boxes.sort((left, right) => {
      const leftScore = Math.max(getColorRange(left, 'r'), getColorRange(left, 'g'), getColorRange(left, 'b'))
        * left.reduce((sum, color) => sum + colorImportance(color), 0);
      const rightScore = Math.max(getColorRange(right, 'r'), getColorRange(right, 'g'), getColorRange(right, 'b'))
        * right.reduce((sum, color) => sum + colorImportance(color), 0);
      return rightScore - leftScore;
    });

    const box = boxes.shift();
    if (!box || box.length <= 1) {
      if (box) boxes.push(box);
      break;
    }

    const channel = ['r', 'g', 'b'].sort((a, b) => getColorRange(box, b) - getColorRange(box, a))[0];
    box.sort((left, right) => left[channel] - right[channel]);
    const total = box.reduce((sum, color) => sum + colorImportance(color), 0);
    let acc = 0;
    let split = 1;
    for (let i = 0; i < box.length - 1; i += 1) {
      acc += colorImportance(box[i]);
      if (acc >= total / 2) {
        split = i + 1;
        break;
      }
    }
    boxes.push(box.slice(0, split), box.slice(split));
  }

  return boxes.map(weightedAverageColor);
}

function refinePaletteKMeans(colors, initialPalette, maxColors, iterations = 14) {
  let palette = initialPalette.slice(0, maxColors).map((color) => snapColorToMegaDrive(color));
  const topColors = colors.slice().sort((a, b) => colorImportance(b) - colorImportance(a));

  while (palette.length < maxColors && topColors.length > 0) {
    const next = topColors.shift();
    const key = `${next.r},${next.g},${next.b}`;
    if (!palette.some((color) => `${color.r},${color.g},${color.b}` === key)) {
      palette.push({ r: next.r, g: next.g, b: next.b });
    }
  }
  if (palette.length === 0) palette = [{ r: 0, g: 0, b: 0 }];

  for (let iter = 0; iter < iterations; iter += 1) {
    const buckets = palette.map(() => ({ total: 0, r: 0, g: 0, b: 0 }));
    colors.forEach((color) => {
      const idx = nearestColorIndex(color, palette);
      const weight = colorImportance(color);
      buckets[idx].total += weight;
      buckets[idx].r += color.r * weight;
      buckets[idx].g += color.g * weight;
      buckets[idx].b += color.b * weight;
    });

    palette = palette.map((color, index) => {
      const bucket = buckets[index];
      if (!bucket.total) return color;
      return snapColorToMegaDrive({
        r: bucket.r / bucket.total,
        g: bucket.g / bucket.total,
        b: bucket.b / bucket.total,
      });
    });

    const seen = new Set();
    palette = palette.filter((color) => {
      const key = `${color.r},${color.g},${color.b}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    while (palette.length < maxColors && topColors.length > 0) {
      const next = topColors.shift();
      const key = `${next.r},${next.g},${next.b}`;
      if (!seen.has(key)) {
        seen.add(key);
        palette.push({ r: next.r, g: next.g, b: next.b });
      }
    }
  }

  while (palette.length < maxColors) {
    palette.push({ ...(palette[palette.length - 1] || { r: 0, g: 0, b: 0 }) });
  }
  return palette.slice(0, maxColors);
}

function popularDiversePalette(colors, maxColors) {
  const sorted = colors.slice().sort((a, b) => colorImportance(b) - colorImportance(a));
  const palette = [];
  sorted.forEach((color) => {
    if (palette.length >= maxColors) return;
    const duplicate = palette.some((entry) => `${entry.r},${entry.g},${entry.b}` === `${color.r},${color.g},${color.b}`);
    if (duplicate) return;
    const nearest = palette.length > 0
      ? Math.min(...palette.map((entry) => colorDistanceSq(color, entry)))
      : Infinity;
    if (palette.length < 4 || nearest > 900) {
      palette.push({ r: color.r, g: color.g, b: color.b });
    }
  });
  sorted.forEach((color) => {
    if (palette.length >= maxColors) return;
    if (!palette.some((entry) => `${entry.r},${entry.g},${entry.b}` === `${color.r},${color.g},${color.b}`)) {
      palette.push({ r: color.r, g: color.g, b: color.b });
    }
  });
  return palette;
}

function farthestPointPalette(colors, maxColors) {
  const sorted = colors.slice().sort((a, b) => colorImportance(b) - colorImportance(a));
  const palette = sorted.length ? [{ r: sorted[0].r, g: sorted[0].g, b: sorted[0].b }] : [];
  while (palette.length < maxColors && palette.length < sorted.length) {
    let best = null;
    let bestScore = -Infinity;
    sorted.forEach((color) => {
      if (palette.some((entry) => `${entry.r},${entry.g},${entry.b}` === `${color.r},${color.g},${color.b}`)) return;
      const nearest = Math.min(...palette.map((entry) => colorDistanceSq(color, entry)));
      const score = nearest * Math.sqrt(colorImportance(color));
      if (score > bestScore) {
        bestScore = score;
        best = color;
      }
    });
    if (!best) break;
    palette.push({ r: best.r, g: best.g, b: best.b });
  }
  return palette;
}

function paletteError(colors, palette) {
  return colors.reduce((sum, color) => {
    const idx = nearestColorIndex(color, palette);
    return sum + colorDistanceSq(color, palette[idx]) * colorImportance(color);
  }, 0);
}

function chooseOptimizedPalette(colors, maxColors) {
  const starts = [
    weightedMedianCutPalette(colors, maxColors),
    popularDiversePalette(colors, maxColors),
    farthestPointPalette(colors, maxColors),
  ];
  let best = null;
  let bestScore = Infinity;
  starts.forEach((start) => {
    const palette = refinePaletteKMeans(colors, start, maxColors, 18);
    const score = paletteError(colors, palette);
    if (score < bestScore) {
      bestScore = score;
      best = palette;
    }
  });
  return best || refinePaletteKMeans(colors, starts[0] || [], maxColors);
}

function buildPalette(imageData, maxColors, transparencyMode, customTransparent, reserveCustomColor) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  let transparentColor = { r: 0, g: 0, b: 0 };
  let transparentFound = false;
  const colorCounts = new Map();

  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const isSourceTransparent = a < 128;
    const isCustomTransparent = transparencyMode === 'custom'
      && !reserveCustomColor
      && colorDistanceSq({ r, g, b }, customTransparent) <= (16 * 16 * 3);
    const transparent = (transparencyMode === 'source' && isSourceTransparent) || isCustomTransparent;

    if (transparent) {
      if (!transparentFound) {
        transparentColor = snapColorToMegaDrive(transparencyMode === 'custom' ? customTransparent : { r, g, b });
        transparentFound = true;
      }
      continue;
    }

    const snapped = snapColorToMegaDrive({ r, g, b });
    const key = `${snapped.r},${snapped.g},${snapped.b}`;
    const current = colorCounts.get(key) || { ...snapped, count: 0, edge: 0 };
    const x = p % width;
    const y = Math.floor(p / width);
    let edge = 0;
    if (x + 1 < width) {
      const ri = i + 4;
      edge += Math.sqrt(colorDistanceSq({ r, g, b }, { r: data[ri], g: data[ri + 1], b: data[ri + 2] })) / 255;
    }
    if (y + 1 < height) {
      const di = i + width * 4;
      edge += Math.sqrt(colorDistanceSq({ r, g, b }, { r: data[di], g: data[di + 1], b: data[di + 2] })) / 255;
    }
    current.count += 1;
    current.edge += Math.min(2, edge);
    colorCounts.set(key, current);
  }

  const colors = Array.from(colorCounts.values());
  if (colors.length === 0) {
    return {
      palette: Array.from({ length: maxColors }, () => ({ r: 0, g: 0, b: 0 })),
      transparentColor,
      hasTransparent: transparencyMode !== 'none' && !reserveCustomColor,
    };
  }

  const palette = chooseOptimizedPalette(colors, maxColors);

  return {
    palette,
    transparentColor,
    hasTransparent: transparencyMode !== 'none' && !reserveCustomColor,
  };
}

function nearestColorIndex(color, palette) {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const score = colorDistanceSq(color, palette[i]);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function getPatternValue(patternName, x, y) {
  const p = DITHER_PATTERNS[patternName] || DITHER_PATTERNS.diagonal4;
  const h = p.length;
  const w = p[0].length;
  return p[y % h][x % w];
}

function mapImageToPalette(imageData, palette, options = {}) {
  const out = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = out.data;
  const indices = new Uint8Array(imageData.width * imageData.height);

  const ditherMode = options.ditherMode || 'none';
  const ditherWeight = Number(options.ditherWeight || 0);
  const ditherPattern = options.ditherPattern || 'diagonal4';
  const transparentColor = options.transparentColor || { r: 0, g: 0, b: 0 };
  const hasTransparent = Boolean(options.hasTransparent);
  const transparentPaletteIndex = Number.isFinite(Number(options.transparentPaletteIndex))
    ? Number(options.transparentPaletteIndex)
    : -1;
  const isTransparentPixel = typeof options.isTransparentPixel === 'function'
    ? options.isTransparentPixel
    : () => false;

  if (ditherMode === 'slow') {
    const work = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 1) work[i] = src[i];
    const distribute = (px, errR, errG, errB, factor) => {
      if (px < 0 || px >= indices.length) return;
      const i = px * 4;
      if (src[i + 3] < 128) return;
      work[i] += errR * factor * ditherWeight;
      work[i + 1] += errG * factor * ditherWeight;
      work[i + 2] += errB * factor * ditherWeight;
    };

    for (let y = 0; y < imageData.height; y += 1) {
      const reverse = (y % 2) === 1;
      const xStart = reverse ? imageData.width - 1 : 0;
      const xEnd = reverse ? -1 : imageData.width;
      const step = reverse ? -1 : 1;
      for (let x = xStart; x !== xEnd; x += step) {
        const px = y * imageData.width + x;
        const i = px * 4;
        const r = clampColorChannel(work[i]);
        const g = clampColorChannel(work[i + 1]);
        const b = clampColorChannel(work[i + 2]);
        const a = src[i + 3];

        if (hasTransparent && isTransparentPixel(r, g, b, a)) {
          dst[i] = transparentColor.r;
          dst[i + 1] = transparentColor.g;
          dst[i + 2] = transparentColor.b;
          dst[i + 3] = 0;
          indices[px] = transparentPaletteIndex;
          continue;
        }

        const idx = nearestColorIndex(snapColorToMegaDrive({ r, g, b }), palette);
        const c = palette[idx];
        dst[i] = c.r;
        dst[i + 1] = c.g;
        dst[i + 2] = c.b;
        dst[i + 3] = 255;
        indices[px] = idx;

        const errR = r - c.r;
        const errG = g - c.g;
        const errB = b - c.b;
        const east = y * imageData.width + (x + step);
        const southWest = (y + 1) * imageData.width + (x - step);
        const south = (y + 1) * imageData.width + x;
        const southEast = (y + 1) * imageData.width + (x + step);
        distribute(east, errR, errG, errB, 7 / 16);
        distribute(southWest, errR, errG, errB, 3 / 16);
        distribute(south, errR, errG, errB, 5 / 16);
        distribute(southEast, errR, errG, errB, 1 / 16);
      }
    }

    return { imageData: out, indices };
  }

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const px = y * imageData.width + x;
      const i = px * 4;
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      const a = src[i + 3];

      if (hasTransparent && isTransparentPixel(r, g, b, a)) {
        dst[i] = transparentColor.r;
        dst[i + 1] = transparentColor.g;
        dst[i + 2] = transparentColor.b;
        dst[i + 3] = 0;
        indices[px] = transparentPaletteIndex;
        continue;
      }

      let rr = r;
      let gg = g;
      let bb = b;
      if (ditherMode === 'fast') {
        const p = getPatternValue(ditherPattern, x, y);
        const shift = (p - 0.5) * ditherWeight * 96;
        rr = clampColorChannel(rr + shift);
        gg = clampColorChannel(gg + shift);
        bb = clampColorChannel(bb + shift);
      }

      const idx = nearestColorIndex(snapColorToMegaDrive({ r: rr, g: gg, b: bb }), palette);
      const c = palette[idx];
      dst[i] = c.r;
      dst[i + 1] = c.g;
      dst[i + 2] = c.b;
      dst[i + 3] = 255;
      indices[px] = idx;
    }
  }

  return { imageData: out, indices };
}

function quantizeToIndexed16(imageData, options) {
  const out = new ImageData(imageData.width, imageData.height);

  const transparencyMode = options.transparencyMode || 'none';
  const ditherMode = options.ditherMode || (options.ditherEnabled ? 'fast' : 'none');
  const ditherWeight = Number(options.ditherWeight || 0);
  const ditherPattern = options.ditherPattern || 'diagonal4';
  const customTransparent = hexToRgb(options.transparencyColor || '#ff00ff');
  const reserveCustomColor = Boolean(options.reserveCustomColor);
  const hasReferencePalette = Array.isArray(options.referencePalette) && options.referencePalette.length > 0;

  let fullPalette = [];
  let transparentColor = { r: 0, g: 0, b: 0 };
  let hasTransparent = false;

  if (hasReferencePalette) {
    fullPalette = options.referencePalette
      .slice(0, 16)
      .map((c) => snapColorToMegaDrive(c));
    while (fullPalette.length < 16) {
      fullPalette.push({ ...fullPalette[fullPalette.length - 1] || { r: 0, g: 0, b: 0 } });
    }
  } else {
    const effectivePaletteSize = (transparencyMode === 'none' && !reserveCustomColor) ? 16 : 15;
    const built = buildPalette(
      imageData,
      effectivePaletteSize,
      transparencyMode,
      customTransparent,
      reserveCustomColor
    );
    transparentColor = built.transparentColor;
    hasTransparent = built.hasTransparent;
    fullPalette = reserveCustomColor
      ? [{ ...snapColorToMegaDrive(customTransparent) }, ...built.palette]
      : (hasTransparent ? [{ ...transparentColor }, ...built.palette] : built.palette);
  }

  const mapped = mapImageToPalette(imageData, fullPalette, {
    ditherMode,
    ditherWeight,
    ditherPattern,
    transparentColor,
    hasTransparent: !hasReferencePalette && hasTransparent,
    transparentPaletteIndex: 0,
    isTransparentPixel: (r, g, b, a) => {
      const isSourceTransparent = a < 128;
      const isCustomTransparent = transparencyMode === 'custom'
        && !reserveCustomColor
        && colorDistanceSq({ r, g, b }, customTransparent) <= (16 * 16 * 3);
      return (transparencyMode === 'source' && isSourceTransparent) || isCustomTransparent;
    },
  });

  return {
    imageData: mapped.imageData || out,
    palette: fullPalette,
    indices: mapped.indices,
    transparentPaletteIndex: (!hasReferencePalette && hasTransparent) ? 0 : -1,
  };
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function applyQuantizeToneAdjustments(imageData, options = {}) {
  const brightness = Number(options.brightness || 0);
  const saturation = Number(options.saturation || 1);
  const out = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = out.data;

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const gray = (r * 0.299) + (g * 0.587) + (b * 0.114);
    dst[i] = clampColorChannel(gray + ((r - gray) * saturation) + brightness);
    dst[i + 1] = clampColorChannel(gray + ((g - gray) * saturation) + brightness);
    dst[i + 2] = clampColorChannel(gray + ((b - gray) * saturation) + brightness);
    dst[i + 3] = src[i + 3];
  }

  return out;
}

function drawImageDataToCanvas(canvas, imageData) {
  const ctx = canvas.getContext('2d');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  ctx.putImageData(imageData, 0, 0);
}

function readCanvasAsPngDataUrl(canvas) {
  return canvas.toDataURL('image/png');
}

// ── インデックス PNG エンコーダ ─────────────────────────────────────────
// canvas.toDataURL() は RGBA PNG しか生成できず RESCOMP がエラーになるため、
// RESCOMP が正しく読める indexed PNG (color type 3) を自前で生成する。

const PNG_CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function pngCrc32(buf, start, end) {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < end; i++) {
    crc = (PNG_CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngWriteU32BE(buf, off, v) {
  buf[off] = (v >>> 24) & 0xFF;
  buf[off + 1] = (v >>> 16) & 0xFF;
  buf[off + 2] = (v >>> 8) & 0xFF;
  buf[off + 3] = v & 0xFF;
}

function pngMakeChunk(typeStr, data) {
  const typeBytes = [typeStr.charCodeAt(0), typeStr.charCodeAt(1), typeStr.charCodeAt(2), typeStr.charCodeAt(3)];
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  pngWriteU32BE(chunk, 0, data.length);
  chunk[4] = typeBytes[0]; chunk[5] = typeBytes[1]; chunk[6] = typeBytes[2]; chunk[7] = typeBytes[3];
  chunk.set(data, 8);
  const crc = pngCrc32(chunk, 4, 8 + data.length);
  pngWriteU32BE(chunk, 8 + data.length, crc);
  return chunk;
}

async function pngZlibDeflate(data) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * インデックス PNG を生成して data URL で返す。
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} indices - 長さ width*height のパレットインデックス配列
 * @param {Array<{r,g,b}>} palette - パレット配列（最大256色）
 * @param {number} transparentIndex - 透明扱いにするパレットインデックス（-1=なし）
 * @returns {Promise<string>} data URL
 */
async function encodeIndexedPng(width, height, indices, palette, transparentIndex) {
  const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = new Uint8Array(13);
  pngWriteU32BE(ihdrData, 0, width);
  pngWriteU32BE(ihdrData, 4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 3; // color type: indexed
  // bytes 10,11,12 = 0 (compression, filter, interlace)
  const ihdr = pngMakeChunk('IHDR', ihdrData);

  // PLTE
  const plteData = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plteData[i * 3] = palette[i].r;
    plteData[i * 3 + 1] = palette[i].g;
    plteData[i * 3 + 2] = palette[i].b;
  }
  const plte = pngMakeChunk('PLTE', plteData);

  // tRNS: 指定インデックスのみ alpha=0 (他は 255)
  let trns = null;
  if (transparentIndex >= 0 && transparentIndex < palette.length) {
    const trnsData = new Uint8Array(transparentIndex + 1).fill(255);
    trnsData[transparentIndex] = 0;
    trns = pngMakeChunk('tRNS', trnsData);
  }

  // IDAT: filter byte(0=None) + index values per scanline
  const rawData = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (width + 1)] = 0; // filter None
    for (let x = 0; x < width; x++) {
      rawData[y * (width + 1) + 1 + x] = indices[y * width + x];
    }
  }
  const compressed = await pngZlibDeflate(rawData);
  const idat = pngMakeChunk('IDAT', compressed);
  const iend = pngMakeChunk('IEND', new Uint8Array(0));

  const parts = trns ? [PNG_SIG, ihdr, plte, trns, idat, iend] : [PNG_SIG, ihdr, plte, idat, iend];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(/** @type {string} */(reader.result));
    reader.readAsDataURL(new Blob([result], { type: 'image/png' }));
  });
}

/**
 * RGBA ImageData から palette を抽出し indexed PNG data URL を返す。
 * alpha<128 のピクセルはパレット index 0 (透明) に割り当てる。
 */
async function imageDataToIndexedPng(imageData) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const indices = new Uint8Array(w * h);
  const palette = [];
  const palMap = new Map();
  let hasTransparent = false;
  const transparentColor = { r: 0, g: 0, b: 0 };

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) { hasTransparent = true; }
  }

  // index 0 = transparent placeholder (placed first if transparent pixels exist)
  if (hasTransparent) {
    palette.push({ ...transparentColor });
    palMap.set('__transparent__', 0);
  }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2]; const a = data[i + 3];
    const pixIdx = i >> 2;
    if (a < 128) {
      indices[pixIdx] = 0; // transparent
    } else {
      const key = `${r},${g},${b}`;
      if (!palMap.has(key)) {
        if (palette.length < 256) { palMap.set(key, palette.length); palette.push({ r, g, b }); }
        else {
          // フォールバック: 最近傍
          let best = 0; let bestD = Infinity;
          for (let pi = 0; pi < palette.length; pi++) {
            const d = colorDistanceSq({ r, g, b }, palette[pi]);
            if (d < bestD) { bestD = d; best = pi; }
          }
          palMap.set(key, best);
        }
      }
      indices[pixIdx] = palMap.get(key);
    }
  }

  return encodeIndexedPng(w, h, indices, palette, hasTransparent ? 0 : -1);
}
// ── インデックス PNG エンコーダ ここまで ────────────────────────────────

function closeQuantizeModal() {
  quantizeState.active = false;
  quantizeState.onApply = null;
  quantizeState.adjustedData = null;
  quantizeState.sourcePath = '';
  quantizeState.referencePalette = null;
  quantizeState.referencePalettePath = '';
  quantizeState.referenceDataUrl = '';
  quantizeState.referenceImageWidth = 0;
  quantizeState.referenceImageHeight = 0;
  quantizeState.referencePaletteError = '';
  quantizeState.lastReferenceLogToken = '';
  quantizeState.referencePaletteLabel = '';
  if (el.quantizeResultPalette) {
    el.quantizeResultPalette.innerHTML = '';
  }
  if (el.quantizeModal) {
    el.quantizeModal.classList.remove('open');
    el.quantizeModal.setAttribute('aria-hidden', 'true');
  }
}

function syncQuantizeColorUI() {
  const color = (el.quantizeTransparencyColor?.value || '#ff00ff').toLowerCase();
  if (el.quantizeTransparencyColorValue) {
    el.quantizeTransparencyColorValue.textContent = color;
  }
  if (el.quantizeTransparencyColorSwatch) {
    el.quantizeTransparencyColorSwatch.style.background = color;
  }

  const isCustom = (el.quantizeTransparencyMode?.value || 'none') === 'custom';
  if (el.quantizeColorPickerRow) {
    el.quantizeColorPickerRow.style.display = isCustom ? 'flex' : 'none';
  }
  if (el.quantizeSharedColorRow) {
    el.quantizeSharedColorRow.classList.toggle('quantize-shared-disabled', !isCustom);
  }
  if (el.quantizeUseSharedCustomColor) {
    el.quantizeUseSharedCustomColor.disabled = !isCustom;
    if (!isCustom) {
      el.quantizeUseSharedCustomColor.checked = false;
    }
  }
}

function syncQuantizeDitheringUI() {
  const mode = el.quantizeDitherMode?.value || (el.quantizeDitheringEnabled?.checked ? 'fast' : 'none');
  const enabled = mode !== 'none';
  if (el.quantizeDitheringWeight) {
    el.quantizeDitheringWeight.disabled = !enabled;
    el.quantizeDitheringWeight.classList.toggle('quantize-control-disabled', !enabled);
  }
  if (el.quantizePattern) {
    el.quantizePattern.disabled = mode !== 'fast';
    el.quantizePattern.classList.toggle('quantize-control-disabled', mode !== 'fast');
  }
}

function getQuantizeToneOptions() {
  return {
    brightness: Number(el.quantizeBrightness?.value || 0),
    saturation: Number(el.quantizeSaturation?.value || 1),
  };
}

function syncQuantizeToneUI() {
  const tone = getQuantizeToneOptions();
  if (el.quantizeBrightnessLabel) {
    el.quantizeBrightnessLabel.textContent = tone.brightness > 0 ? `+${tone.brightness}` : String(tone.brightness);
  }
  if (el.quantizeSaturationLabel) {
    el.quantizeSaturationLabel.textContent = tone.saturation.toFixed(2);
  }
}

function syncQuantizePaletteUI() {
  const hasRef = Array.isArray(quantizeState.referencePalette) && quantizeState.referencePalette.length > 0;
  const hasPreview = hasRef && Boolean(quantizeState.referenceDataUrl);

  if (el.quantizeReferencePreview) {
    el.quantizeReferencePreview.hidden = !hasPreview;
  }
  if (hasPreview) {
    if (el.quantizeReferenceThumb) {
      el.quantizeReferenceThumb.src = quantizeState.referenceDataUrl;
    }
    if (el.quantizeReferenceSize) {
      el.quantizeReferenceSize.textContent = `${quantizeState.referenceImageWidth} x ${quantizeState.referenceImageHeight}`;
    }
    if (el.quantizeReferencePalette) {
      el.quantizeReferencePalette.innerHTML = quantizeState.referencePalette
        .map((color, index) => {
          const hex = rgbToHex(color);
          return `<span class="palette-swatch" title="${index}: ${hex}" style="background:${hex}"></span>`;
        })
        .join('');
    }
  } else {
    if (el.quantizeReferenceSize) el.quantizeReferenceSize.textContent = '';
    if (el.quantizeReferenceThumb) el.quantizeReferenceThumb.removeAttribute('src');
    if (el.quantizeReferencePalette) el.quantizeReferencePalette.innerHTML = '';
  }

  if (el.quantizePaletteHint) {
    if (hasRef) {
      el.quantizePaletteHint.textContent = `参照中: ${quantizeState.referencePaletteLabel} (${quantizeState.referencePalette.length}色)`;
      el.quantizePaletteHint.classList.remove('form-error');
    } else {
      el.quantizePaletteHint.textContent = '指定した画像アセットの16色パレットに揃えます。';
      el.quantizePaletteHint.classList.remove('form-error');
    }
  }
}

function renderQuantizeResultPalette(palette = [], transparentIndex = -1) {
  if (!el.quantizeResultPalette) return;
  el.quantizeResultPalette.innerHTML = '';
  const colors = palette.slice(0, 16);
  while (colors.length < 16) colors.push({ ...(colors[colors.length - 1] || { r: 0, g: 0, b: 0 }) });
  colors.forEach((color, index) => {
    const swatch = document.createElement('span');
    const isTransparent = index === transparentIndex;
    swatch.className = `palette-swatch${isTransparent ? ' is-transparent' : ''}`;
    const hex = rgbToHex(color);
    swatch.style.backgroundColor = isTransparent ? '' : hex;
    swatch.title = `${index}: ${hex}${isTransparent ? ' (transparent)' : ''}`;
    el.quantizeResultPalette.appendChild(swatch);
  });
}

async function loadQuantizeReferencePalette(sourcePath) {
  const refPath = String(sourcePath || '').trim();
  if (!refPath) {
    quantizeState.referencePalette = null;
    quantizeState.referencePalettePath = '';
    quantizeState.referenceDataUrl = '';
    quantizeState.referenceImageWidth = 0;
    quantizeState.referenceImageHeight = 0;
    quantizeState.referencePaletteError = '';
    quantizeState.referencePaletteLabel = '';
    syncQuantizePaletteUI();
    return;
  }

  if (quantizeState.referencePalettePath === refPath) {
    if (quantizeState.referencePalette) {
      syncQuantizePaletteUI();
      return;
    }
    if (quantizeState.referencePaletteError) {
      if (el.quantizePaletteHint) {
        el.quantizePaletteHint.textContent = quantizeState.referencePaletteError;
        el.quantizePaletteHint.classList.add('form-error');
      }
      return;
    }
  }

  const pushReferenceLog = (level, text, token) => {
    const nextToken = `${level}:${token || text}`;
    if (quantizeState.lastReferenceLogToken === nextToken) return;
    quantizeState.lastReferenceLogToken = nextToken;
    appendLog('converter', text, level);
  };

  const read = await window.electronAPI.readFileAsDataUrl(refPath);
  if (!read?.ok || !read?.dataUrl) {
    quantizeState.referencePalette = null;
    quantizeState.referencePalettePath = refPath;
    quantizeState.referenceDataUrl = '';
    quantizeState.referenceImageWidth = 0;
    quantizeState.referenceImageHeight = 0;
    quantizeState.referencePaletteError = `参照パレット読み込み失敗: ${read?.error || 'unknown'}`;
    quantizeState.referencePaletteLabel = '';
    if (el.quantizePaletteHint) {
      el.quantizePaletteHint.textContent = quantizeState.referencePaletteError;
      el.quantizePaletteHint.classList.add('form-error');
    }
    pushReferenceLog('warn', `参照パレット読み込み失敗: ${refPath} (${read?.error || 'unknown'})`, `read-fail:${refPath}:${read?.error || 'unknown'}`);
    return;
  }

  try {
    const img = new Image();
    img.src = read.dataUrl;
    await img.decode();

    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const refData = cx.getImageData(0, 0, img.width, img.height);
    const palette = extractPaletteFromImageData(refData, 16);

    if (!palette || palette.length === 0 || palette.length > 16) {
      const detail = palette === null
        ? '参照画像の色数が16色を超えています。'
        : '参照画像に有効色がありません。';
      quantizeState.referencePalette = null;
      quantizeState.referencePalettePath = refPath;
      quantizeState.referenceDataUrl = read.dataUrl;
      quantizeState.referenceImageWidth = img.width;
      quantizeState.referenceImageHeight = img.height;
      quantizeState.referencePaletteError = `参照パレット不正: ${detail}`;
      quantizeState.referencePaletteLabel = '';
      if (el.quantizePaletteHint) {
        el.quantizePaletteHint.textContent = quantizeState.referencePaletteError;
        el.quantizePaletteHint.classList.add('form-error');
      }
      pushReferenceLog('warn', `参照パレット不正: ${refPath} (${detail})`, `invalid:${refPath}:${detail}`);
      return;
    }

    quantizeState.referencePalette = palette;
    quantizeState.referencePalettePath = refPath;
    quantizeState.referenceDataUrl = read.dataUrl;
    quantizeState.referenceImageWidth = img.width;
    quantizeState.referenceImageHeight = img.height;
    quantizeState.referencePaletteError = '';
    quantizeState.referencePaletteLabel = refPath;
    syncQuantizePaletteUI();
    pushReferenceLog('info', `参照パレットを適用: ${refPath} (${palette.length}色)`, `ok:${refPath}:${palette.length}`);
  } catch (err) {
    quantizeState.referencePalette = null;
    quantizeState.referencePalettePath = refPath;
    quantizeState.referenceDataUrl = '';
    quantizeState.referenceImageWidth = 0;
    quantizeState.referenceImageHeight = 0;
    quantizeState.referencePaletteError = `参照パレット解析失敗: ${err?.message || err}`;
    quantizeState.referencePaletteLabel = '';
    if (el.quantizePaletteHint) {
      el.quantizePaletteHint.textContent = quantizeState.referencePaletteError;
      el.quantizePaletteHint.classList.add('form-error');
    }
    pushReferenceLog('warn', `参照パレット解析失敗: ${refPath} (${err?.message || err})`, `parse-fail:${refPath}:${err?.message || err}`);
  }
}

async function rerenderQuantizePreview() {
  if (!quantizeState.originalData || !el.quantizeAfterCanvas || !el.quantizeStats) return;

  syncQuantizeColorUI();
  syncQuantizeDitheringUI();
  syncQuantizeToneUI();

  const selectedRef = el.quantizePaletteAsset?.value || '';
  await loadQuantizeReferencePalette(selectedRef);
  const tone = getQuantizeToneOptions();
  const adjustedData = applyQuantizeToneAdjustments(quantizeState.originalData, tone);
  quantizeState.adjustedData = adjustedData;
  if (el.quantizeBeforeCanvas) {
    drawImageDataToCanvas(el.quantizeBeforeCanvas, adjustedData);
  }

  const options = {
    transparencyMode: el.quantizeTransparencyMode?.value || 'none',
    transparencyColor: el.quantizeTransparencyColor?.value || '#ff00ff',
    reserveCustomColor: Boolean(el.quantizeUseSharedCustomColor?.checked),
    ditherMode: el.quantizeDitherMode?.value || (el.quantizeDitheringEnabled?.checked ? 'fast' : 'none'),
    ditherWeight: Number(el.quantizeDitheringWeight?.value || 0),
    ditherPattern: el.quantizePattern?.value || 'diagonal4',
    referencePalette: quantizeState.referencePalette,
  };

  if (el.quantizeWeightLabel) {
    el.quantizeWeightLabel.textContent = options.ditherWeight.toFixed(2);
  }

  const converted = quantizeToIndexed16(adjustedData, options);
  drawImageDataToCanvas(el.quantizeAfterCanvas, converted.imageData);
  renderQuantizeResultPalette(converted.palette, converted.transparentPaletteIndex);
  // プレビュー表示用 (RGBA PNG) – 実際の保存は indexed PNG を使う
  quantizeState.convertedDataUrl = readCanvasAsPngDataUrl(el.quantizeAfterCanvas);
  // indexed PNG 生成用に最終変換結果を保存
  quantizeState._lastConvertResult = {
    indices: converted.indices,
    palette: converted.palette,
    transparentPaletteIndex: converted.transparentPaletteIndex,
    width: quantizeState.originalData.width,
    height: quantizeState.originalData.height,
  };

  const srcColors = countUniqueColors(adjustedData);
  const dstColors = countUniqueColors(converted.imageData);
  const refNote = options.referencePalette ? ' / mode: ref-palette' : '';
  const ditherNote = ` / dither: ${options.ditherMode}`;
  const toneNote = (tone.brightness !== 0 || tone.saturation !== 1)
    ? ` / brightness: ${tone.brightness > 0 ? '+' : ''}${tone.brightness} / saturation: ${tone.saturation.toFixed(2)}`
    : '';
  el.quantizeStats.textContent = `colors: ${srcColors} -> ${dstColors} / palette: ${converted.palette.length}${refNote}${ditherNote}${toneNote}`;
}

function populateQuantizePaletteAssetOptions(excludeSourcePath = '') {
  if (!el.quantizePaletteAsset) return;
  const candidates = getPaletteReferenceCandidates(excludeSourcePath);
  const options = ['<option value="">指定なし（自動パレット）</option>'];
  candidates.forEach((entry) => {
    options.push(`<option value="${escHtml(entry.sourcePath)}">${escHtml(entry.label)}</option>`);
  });
  el.quantizePaletteAsset.innerHTML = options.join('');
}

async function openQuantizeModal(sourceDataUrl, options = {}) {
  const img = new Image();
  img.src = sourceDataUrl;
  await img.decode();

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = img.width;
  tmpCanvas.height = img.height;
  const tmpCtx = tmpCanvas.getContext('2d', { willReadFrequently: true });
  tmpCtx.drawImage(img, 0, 0);
  const imageData = tmpCtx.getImageData(0, 0, img.width, img.height);

  quantizeState.originalCanvas = tmpCanvas;
  quantizeState.originalCtx = tmpCtx;
  quantizeState.originalData = imageData;
  quantizeState.sourcePath = String(options.sourcePath || '');
  quantizeState.referencePalette = null;
  quantizeState.referencePalettePath = '';
  quantizeState.referenceDataUrl = '';
  quantizeState.referenceImageWidth = 0;
  quantizeState.referenceImageHeight = 0;
  quantizeState.referencePaletteError = '';
  quantizeState.lastReferenceLogToken = '';
  quantizeState.referencePaletteLabel = '';

  populateQuantizePaletteAssetOptions(quantizeState.sourcePath);
  if (el.quantizePaletteAsset) {
    el.quantizePaletteAsset.value = '';
  }
  if (el.quantizeBrightness) {
    el.quantizeBrightness.value = '0';
  }
  if (el.quantizeSaturation) {
    el.quantizeSaturation.value = '1';
  }
  syncQuantizePaletteUI();
  syncQuantizeToneUI();

  if (el.quantizeBeforeCanvas) {
    drawImageDataToCanvas(el.quantizeBeforeCanvas, imageData);
  }

  if (el.quantizeModal) {
    el.quantizeModal.classList.add('open');
    el.quantizeModal.setAttribute('aria-hidden', 'false');
  }

  if (el.quantizeDitheringEnabled) {
    el.quantizeDitheringEnabled.checked = true;
  }
  if (el.quantizeDitherMode) {
    el.quantizeDitherMode.value = 'fast';
  }

  await rerenderQuantizePreview();

  return new Promise((resolve) => {
    quantizeState.onApply = async (ok) => {
      if (ok) {
        let finalDataUrl = quantizeState.convertedDataUrl || sourceDataUrl;
        // indexed PNG (パレットPNG) を生成して RESCOMP に渡す
        const cr = quantizeState._lastConvertResult;
        if (cr && cr.indices && cr.palette) {
          try {
            finalDataUrl = await encodeIndexedPng(
              cr.width, cr.height, cr.indices, cr.palette, cr.transparentPaletteIndex
            );
          } catch (e) {
            console.warn('indexed PNG エンコード失敗、RGBA PNG でフォールバック:', e);
          }
        }
        resolve({ ok: true, dataUrl: finalDataUrl });
      } else {
        resolve({ ok: false, dataUrl: '' });
      }
      closeQuantizeModal();
    };
  });
}

const resizeState = {
  onApply: null,
  originalImg: null,
  sourceDataUrl: '',
  canSkip: false,
  requestedTargetSize: null,
  cropRect: null,
  renderMap: null,
  drag: null,
};

function normalizePositiveInt(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.round(n));
}

function closeResizeModal() {
  resizeState.onApply = null;
  resizeState.originalImg = null;
  resizeState.sourceDataUrl = '';
  resizeState.requestedTargetSize = null;
  resizeState.cropRect = null;
  resizeState.renderMap = null;
  resizeState.drag = null;
  closeModal(el.resizeModal);
}

function getResizeTargetSize() {
  const fallbackW = resizeState.originalImg?.naturalWidth || 1;
  const fallbackH = resizeState.originalImg?.naturalHeight || 1;
  const w = normalizePositiveInt(el.resizeWidth?.value, fallbackW);
  const h = normalizePositiveInt(el.resizeHeight?.value, fallbackH);
  return { w, h };
}

function updateResizeValidation() {
  const { w, h } = getResizeTargetSize();
  let message = '';
  if (w <= 0 || h <= 0) {
    message = '幅/高さは 1 以上で指定してください。';
  }
  const req = resizeState.requestedTargetSize;
  if (req && Number.isFinite(req.width) && Number.isFinite(req.height) && (w !== req.width || h !== req.height)) {
    message = `このコンバーターは ${req.width} x ${req.height} を要求しています。`;
  }
  if (el.resizeValidationMessage) {
    el.resizeValidationMessage.textContent = message;
  }
  if (el.btnResizeApply) {
    el.btnResizeApply.disabled = message.length > 0;
  }
  return message.length === 0;
}

function ensureCropRect() {
  const img = resizeState.originalImg;
  if (!img) return;
  const { w, h } = getResizeTargetSize();
  if (w <= 0 || h <= 0) {
    resizeState.cropRect = null;
    return;
  }

  const aspect = w / h;
  const maxW = img.naturalWidth;
  const maxH = img.naturalHeight;
  let rectW = maxW;
  let rectH = Math.round(rectW / aspect);
  if (rectH > maxH) {
    rectH = maxH;
    rectW = Math.round(rectH * aspect);
  }
  rectW = Math.max(1, Math.min(maxW, rectW));
  rectH = Math.max(1, Math.min(maxH, rectH));

  if (!resizeState.cropRect) {
    resizeState.cropRect = {
      x: Math.floor((maxW - rectW) / 2),
      y: Math.floor((maxH - rectH) / 2),
      w: rectW,
      h: rectH,
    };
  } else {
    // アスペクト比が変わった（target w/h を変更した）か、サイズが画像を超える場合だけリセット
    const cur = resizeState.cropRect;
    const curAspect = cur.w / cur.h;
    const aspectChanged = Math.abs(curAspect - aspect) > 0.005;
    const oversized = cur.w > maxW || cur.h > maxH;
    if (aspectChanged || oversized) {
      cur.w = rectW;
      cur.h = rectH;
    }
    cur.x = Math.max(0, Math.min(maxW - cur.w, cur.x));
    cur.y = Math.max(0, Math.min(maxH - cur.h, cur.y));
  }
}

function clampCropRectIntoImage() {
  const img = resizeState.originalImg;
  const rect = resizeState.cropRect;
  if (!img || !rect) return;
  rect.x = Math.max(0, Math.min(img.naturalWidth - rect.w, rect.x));
  rect.y = Math.max(0, Math.min(img.naturalHeight - rect.h, rect.y));
}

function renderResizePreview() {
  const img = resizeState.originalImg;
  if (!img || !el.resizePreviewCanvas) return;

  const cvs = el.resizePreviewCanvas;
  const mode = el.resizeMode?.value || 'resize';
  const pad = 12;
  const maxW = Math.max(240, Math.min(640, (el.resizePreviewCanvas.parentElement?.clientWidth || 640) - pad * 2));
  const maxH = 420;
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const drawW = Math.max(1, Math.round(img.naturalWidth * scale));
  const drawH = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvasW = drawW + pad * 2;
  const canvasH = drawH + pad * 2;
  const offsetX = Math.floor((canvasW - drawW) / 2);
  const offsetY = Math.floor((canvasH - drawH) / 2);

  cvs.width = canvasW;
  cvs.height = canvasH;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = '#0a0e16';
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  resizeState.renderMap = { scale, offsetX, offsetY, drawW, drawH };

  if (mode === 'clip') {
    ensureCropRect();
    const rect = resizeState.cropRect;
    if (rect) {
      const rx = offsetX + Math.round(rect.x * scale);
      const ry = offsetY + Math.round(rect.y * scale);
      const rw = Math.max(1, Math.round(rect.w * scale));
      const rh = Math.max(1, Math.round(rect.h * scale));

      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(offsetX, offsetY, drawW, drawH);
      ctx.clearRect(rx, ry, rw, rh);
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, rx, ry, rw, rh);

      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);

      const hs = 5;
      const handles = [
        { x: rx, y: ry },
        { x: rx + rw, y: ry },
        { x: rx + rw, y: ry + rh },
        { x: rx, y: ry + rh },
      ];
      ctx.fillStyle = '#58a6ff';
      handles.forEach((p) => {
        ctx.fillRect(Math.round(p.x - hs), Math.round(p.y - hs), hs * 2, hs * 2);
      });
    }
  }
}

function getCropCanvasRect() {
  const img = resizeState.originalImg;
  const map = resizeState.renderMap;
  const rect = resizeState.cropRect;
  if (!img || !map || !rect) return null;
  return {
    x: map.offsetX + Math.round(rect.x * map.scale),
    y: map.offsetY + Math.round(rect.y * map.scale),
    w: Math.max(1, Math.round(rect.w * map.scale)),
    h: Math.max(1, Math.round(rect.h * map.scale)),
  };
}

function detectCropDragMode(canvasX, canvasY) {
  const rect = getCropCanvasRect();
  if (!rect) return 'none';
  const hs = 14;
  const points = [
    { mode: 'resize-nw', x: rect.x, y: rect.y },
    { mode: 'resize-ne', x: rect.x + rect.w, y: rect.y },
    { mode: 'resize-se', x: rect.x + rect.w, y: rect.y + rect.h },
    { mode: 'resize-sw', x: rect.x, y: rect.y + rect.h },
  ];
  const hit = points.find((p) => Math.abs(canvasX - p.x) <= hs && Math.abs(canvasY - p.y) <= hs);
  if (hit) return hit.mode;
  if (canvasX >= rect.x && canvasX <= rect.x + rect.w && canvasY >= rect.y && canvasY <= rect.y + rect.h) {
    return 'move';
  }
  return 'none';
}

function resizeCropRectWithAspect(mode, pointerImgX, pointerImgY) {
  const img = resizeState.originalImg;
  const startRect = resizeState.drag?.startRect;
  if (!img || !startRect) return;

  const { w: targetW, h: targetH } = getResizeTargetSize();
  const aspect = Math.max(0.01, targetW / targetH);
  const minW = Math.min(img.naturalWidth, 8);
  const minH = Math.min(img.naturalHeight, 8);

  let ax;
  let ay;
  let fromLeft;
  let fromTop;
  if (mode === 'resize-nw') {
    ax = startRect.x + startRect.w;
    ay = startRect.y + startRect.h;
    fromLeft = true;
    fromTop = true;
  } else if (mode === 'resize-ne') {
    ax = startRect.x;
    ay = startRect.y + startRect.h;
    fromLeft = false;
    fromTop = true;
  } else if (mode === 'resize-se') {
    ax = startRect.x;
    ay = startRect.y;
    fromLeft = false;
    fromTop = false;
  } else {
    ax = startRect.x + startRect.w;
    ay = startRect.y;
    fromLeft = true;
    fromTop = false;
  }

  let rawW = fromLeft ? (ax - pointerImgX) : (pointerImgX - ax);
  let rawH = fromTop ? (ay - pointerImgY) : (pointerImgY - ay);
  rawW = Math.max(minW, rawW);
  rawH = Math.max(minH, rawH);

  let nextW = rawW;
  let nextH = rawH;
  if ((rawW / rawH) > aspect) {
    nextH = rawW / aspect;
  } else {
    nextW = rawH * aspect;
  }

  let x = fromLeft ? (ax - nextW) : ax;
  let y = fromTop ? (ay - nextH) : ay;
  let w = nextW;
  let h = nextH;

  if (x < 0) {
    w += x;
    x = 0;
    h = w / aspect;
    if (fromTop) y = ay - h;
  }
  if (y < 0) {
    h += y;
    y = 0;
    w = h * aspect;
    if (fromLeft) x = ax - w;
  }
  if (x + w > img.naturalWidth) {
    w = img.naturalWidth - x;
    h = w / aspect;
    if (fromTop) y = ay - h;
  }
  if (y + h > img.naturalHeight) {
    h = img.naturalHeight - y;
    w = h * aspect;
    if (fromLeft) x = ax - w;
  }

  resizeState.cropRect = {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    w: Math.max(minW, Math.round(w)),
    h: Math.max(minH, Math.round(h)),
  };
  clampCropRectIntoImage();
}

function moveCropRectFromCanvasPoint(clientX, clientY) {
  const img = resizeState.originalImg;
  const map = resizeState.renderMap;
  const rect = resizeState.cropRect;
  if (!img || !map || !rect || !el.resizePreviewCanvas) return;

  const b = el.resizePreviewCanvas.getBoundingClientRect();
  const scaleX = b.width ? el.resizePreviewCanvas.width / b.width : 1;
  const scaleY = b.height ? el.resizePreviewCanvas.height / b.height : 1;
  const canvasX = (clientX - b.left) * scaleX;
  const canvasY = (clientY - b.top) * scaleY;
  const pointerImgX = (canvasX - map.offsetX) / map.scale;
  const pointerImgY = (canvasY - map.offsetY) / map.scale;

  if (resizeState.drag?.mode === 'move') {
    const sx = resizeState.drag.startPointerX;
    const sy = resizeState.drag.startPointerY;
    const sr = resizeState.drag.startRect;
    const dx = pointerImgX - sx;
    const dy = pointerImgY - sy;
    rect.x = Math.round(sr.x + dx);
    rect.y = Math.round(sr.y + dy);
    clampCropRectIntoImage();
  } else if (String(resizeState.drag?.mode || '').startsWith('resize-')) {
    resizeCropRectWithAspect(resizeState.drag.mode, pointerImgX, pointerImgY);
  }
  clampCropRectIntoImage();
  renderResizePreview();
}

function beginResizeCropDrag(event) {
  if ((el.resizeMode?.value || 'resize') !== 'clip') return;
  if (!resizeState.cropRect) return;
  if (!el.resizePreviewCanvas || !resizeState.renderMap) return;
  const b = el.resizePreviewCanvas.getBoundingClientRect();
  const scaleX = b.width ? el.resizePreviewCanvas.width / b.width : 1;
  const scaleY = b.height ? el.resizePreviewCanvas.height / b.height : 1;
  const canvasX = (event.clientX - b.left) * scaleX;
  const canvasY = (event.clientY - b.top) * scaleY;
  const mode = detectCropDragMode(canvasX, canvasY);
  if (mode === 'none') return;
  const pointerImgX = (canvasX - resizeState.renderMap.offsetX) / resizeState.renderMap.scale;
  const pointerImgY = (canvasY - resizeState.renderMap.offsetY) / resizeState.renderMap.scale;
  resizeState.drag = {
    active: true,
    mode,
    startPointerX: pointerImgX,
    startPointerY: pointerImgY,
    startRect: { ...resizeState.cropRect },
  };
  // ポインターキャプチャでキャンバス外ドラッグも確実に追跡する
  event.target.setPointerCapture(event.pointerId);
  moveCropRectFromCanvasPoint(event.clientX, event.clientY);
  event.preventDefault();
}

function updateResizeCropDrag(event) {
  if (!resizeState.drag?.active) return;
  moveCropRectFromCanvasPoint(event.clientX, event.clientY);
}

function endResizeCropDrag() {
  if (!resizeState.drag?.active) return;
  resizeState.drag = null;
  if (el.resizePreviewCanvas) el.resizePreviewCanvas.style.cursor = 'crosshair';
}

function applyResizeTransform() {
  const img = resizeState.originalImg;
  if (!img) return '';
  const { w, h } = getResizeTargetSize();
  if (w <= 0 || h <= 0) return '';

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  const mode = el.resizeMode?.value || 'resize';

  if (mode === 'clip') {
    ensureCropRect();
    const rect = resizeState.cropRect || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return out.toDataURL('image/png');
}

async function openResizeModal(dataUrl, imgWidth, imgHeight, options = {}) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const requestedTargetSize = options?.targetSize || null;
  const requestedWidth = Number(requestedTargetSize?.width);
  const requestedHeight = Number(requestedTargetSize?.height);

  resizeState.originalImg = img;
  resizeState.sourceDataUrl = dataUrl;
  resizeState.requestedTargetSize = (
    Number.isFinite(requestedWidth)
    && Number.isFinite(requestedHeight)
    && requestedWidth > 0
    && requestedHeight > 0
  ) ? {
    width: normalizePositiveInt(requestedWidth),
    height: normalizePositiveInt(requestedHeight),
  } : null;
  resizeState.canSkip = true;
  resizeState.cropRect = null;
  resizeState.drag = null;

  if (el.resizeOriginalSize) {
    el.resizeOriginalSize.textContent = `${imgWidth} × ${imgHeight} px`;
  }

  const initialW = resizeState.requestedTargetSize?.width || normalizePositiveInt(imgWidth);
  const initialH = resizeState.requestedTargetSize?.height || normalizePositiveInt(imgHeight);
  if (el.resizeWidth) el.resizeWidth.value = initialW;
  if (el.resizeHeight) el.resizeHeight.value = initialH;
  if (el.resizeMode) el.resizeMode.value = 'resize';
  if (el.btnResizeSkip) {
    el.btnResizeSkip.disabled = !resizeState.canSkip;
    el.btnResizeSkip.title = '';
  }

  updateResizeValidation();
  openModal(el.resizeModal);
  renderResizePreview();

  return new Promise((resolve) => {
    resizeState.onApply = (mode) => {
      if (mode === 'apply') {
        const resultDataUrl = applyResizeTransform();
        closeResizeModal();
        resolve({ ok: true, dataUrl: resultDataUrl || dataUrl, skipped: false });
      } else if (mode === 'skip' && resizeState.canSkip) {
        closeResizeModal();
        resolve({ ok: true, dataUrl, skipped: true });
      } else {
        closeResizeModal();
        resolve({ ok: false, dataUrl: '', skipped: false });
      }
    };
  });
}

async function maybeConvertImageToIndexed16(sourcePath, options = {}) {
  const pipeline = getPluginCapability('image-import-pipeline');
  if (pipeline?.convertToIndexed16) {
    return pipeline.convertToIndexed16({
      sourcePath,
      targetSize: options.targetSize || null,
    });
  }

  const resizeCapability = getPluginCapability('image-resize');
  if (!resizeCapability?.openResizeModal) {
    return {
      canceled: true,
      convertedDataUrl: '',
      originalDataUrl: '',
      warning: '画像リサイズコンバータープラグインが無効または未インストールです',
    };
  }

  const read = await window.electronAPI.readFileAsDataUrl(sourcePath);
  if (!read?.ok || !read.dataUrl) {
    return { canceled: true, convertedDataUrl: '', originalDataUrl: '', warning: read?.error || '' };
  }

  const img = new Image();
  img.src = read.dataUrl;
  await img.decode();

  let warning = '';
  let workingDataUrl = read.dataUrl;
  const resizeResult = await resizeCapability.openResizeModal(read.dataUrl, img.naturalWidth, img.naturalHeight, {
    targetSize: options.targetSize || null,
  });
  if (!resizeResult.ok) {
    return { canceled: true, convertedDataUrl: '', originalDataUrl: read.dataUrl, warning: 'リサイズ/クリッピングをキャンセルしました' };
  }
  if (resizeResult.dataUrl && resizeResult.dataUrl !== read.dataUrl) {
    workingDataUrl = resizeResult.dataUrl;
    warning = 'リサイズ/クリッピングを適用しました';
  }

  const workImg = new Image();
  workImg.src = workingDataUrl;
  await workImg.decode();

  const canvas = document.createElement('canvas');
  canvas.width = workImg.width;
  canvas.height = workImg.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(workImg, 0, 0);
  const imageData = ctx.getImageData(0, 0, workImg.width, workImg.height);
  const quantizeCapability = getPluginCapability('image-quantize');
  const countColors = quantizeCapability?.countUniqueColors || countUniqueColors;
  const unique = countColors(imageData);

  if (unique <= 16) {
    // canvas を経由した場合 (リサイズ/クリッピング後) は RGBA PNG になっているため
    // indexed PNG に変換して RESCOMP に渡す
    let savedDataUrl = '';
    if (workingDataUrl !== read.dataUrl) {
      try {
        const encodeIndexed = quantizeCapability?.imageDataToIndexedPng || imageDataToIndexedPng;
        savedDataUrl = await encodeIndexed(imageData);
      } catch (e) {
        console.warn('indexed PNG 変換失敗、RGBA PNG にフォールバック:', e);
        savedDataUrl = workingDataUrl;
      }
    }
    return {
      canceled: false,
      convertedDataUrl: savedDataUrl,
      targetExtension: '.png',
      originalDataUrl: read.dataUrl,
      warning,
    };
  }

  if (!quantizeCapability?.openQuantizeModal) {
    return {
      canceled: true,
      convertedDataUrl: '',
      originalDataUrl: read.dataUrl,
      warning: '画像減色コンバータープラグインが無効または未インストールです',
    };
  }

  const quantized = await quantizeCapability.openQuantizeModal(workingDataUrl, {
    sourcePath,
  });
  if (!quantized.ok) {
    return {
      canceled: true,
      convertedDataUrl: '',
      originalDataUrl: read.dataUrl,
      warning: '減色変換をキャンセルしました',
    };
  }

  return {
    canceled: false,
    convertedDataUrl: quantized.dataUrl,
    targetExtension: '.png',
    originalDataUrl: read.dataUrl,
    warning: `${warning ? `${warning} / ` : ''}減色変換を適用: ${unique} colors -> 16 colors`,
  };
}

async function openAssetModal() {
  if (!state.rescomp.selectedFile) {
    await loadResDefinitions({ keepSelection: true });
  }
  if (!state.rescomp.selectedFile) {
    if (el.assetTableHint) el.assetTableHint.textContent = '.res ファイルを先に作成してください。';
    return;
  }

  const picked = await window.electronAPI.pickAssetSource();
  if (!picked || picked.canceled) return;

  state.rescomp.pendingAssetPick = picked;
  const typeInfo = getAssetTypeInfo(picked);
  const initialType = typeInfo.initialType || inferTypeFromExtension(picked.ext);
  if (el.assetSourcePathInput) el.assetSourcePathInput.value = picked.sourcePath;
  if (el.assetTargetFileNameInput) {
    el.assetTargetFileNameInput.value = typeInfo.suggestedFileName || picked.fileName;
  }
  if (el.assetTargetSubdirInput) {
    el.assetTargetSubdirInput.value = typeInfo.defaultSubdir || defaultSubDirForType(initialType);
    delete el.assetTargetSubdirInput.dataset.userEdited;
  }
  if (el.assetSymbolNameInput) {
    el.assetSymbolNameInput.value = typeInfo.defaultSymbol || normalizeSymbolName(picked.fileName);
    delete el.assetSymbolNameInput.dataset.userEdited;
  }
  if (el.assetCommentInput) {
    el.assetCommentInput.value = '';
  }
  if (el.assetResizeTargetWidth) el.assetResizeTargetWidth.value = '';
  if (el.assetResizeTargetHeight) el.assetResizeTargetHeight.value = '';
  populateAssetTypeOptions(initialType, picked.ext, typeInfo.allowedTypes);
  populateAssetResFileOptions();
  syncAssetModalForType();
  openModal(el.assetModal);
}

function formatSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '0.00';
  return n.toFixed(2);
}

function syncPlayheadLabel() {
  if (el.audioConvertPlayheadLabel) {
    el.audioConvertPlayheadLabel.textContent = `${formatSeconds(audioConvertState.playheadSec)}s`;
  }
}

function syncAudioConvertLoopButton() {
  if (!el.btnAudioConvertLoop) return;
  el.btnAudioConvertLoop.classList.toggle('is-active', !!audioConvertState.loopPlayback);
}

function computeAudioPeakDb(buffer) {
  if (!buffer || typeof buffer.numberOfChannels !== 'number') return null;
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak <= 0) return -Infinity;
  return 20 * Math.log10(peak);
}

function formatDb(db) {
  if (db === -Infinity) return '-inf dB';
  if (!Number.isFinite(db)) return '-';
  return `${db.toFixed(1)} dB`;
}

function updateAudioConvertLevelLabel() {
  if (!el.audioConvertLevelLabel) return;
  const current = computeAudioPeakDb(audioConvertState.audioBuffer);
  const base = computeAudioPeakDb(audioConvertState.originalAudioBuffer);
  if (!Number.isFinite(current) && current !== -Infinity) {
    el.audioConvertLevelLabel.textContent = '-';
    return;
  }
  if (base == null || audioConvertState.originalAudioBuffer === audioConvertState.audioBuffer) {
    el.audioConvertLevelLabel.textContent = `Peak ${formatDb(current)}`;
    return;
  }
  const delta = Number.isFinite(current) && Number.isFinite(base)
    ? ` (${current >= base ? '+' : ''}${(current - base).toFixed(1)} dB)`
    : '';
  el.audioConvertLevelLabel.textContent = `Peak ${formatDb(base)} -> ${formatDb(current)}${delta}`;
}

function getAudioConvertViewport() {
  const duration = Math.max(0.001, audioConvertState.durationSec);
  const zoom = audioConvertState.waveZoom;
  const scroll = audioConvertState.waveScroll;
  const visFrac = 1 / zoom;
  const startFrac = scroll * (1 - visFrac);
  const endFrac = startFrac + visFrac;
  return { duration, visFrac, startFrac, endFrac };
}

function seekAudioConvertPlayhead(sec) {
  const duration = Math.max(0, audioConvertState.durationSec);
  const targetSec = clamp(Number(sec) || 0, 0, duration);
  audioConvertState.playheadSec = targetSec;
  if (el.audioConvertPlayer) {
    try {
      el.audioConvertPlayer.currentTime = targetSec;
    } catch (_) {}
  }
  ensurePlayheadVisible();
  syncPlayheadLabel();
  renderAudioConvertWaveform();
}

function ensurePlayheadVisible() {
  if (audioConvertState.waveZoom <= 1.001 || audioConvertState.durationSec <= 0) return;
  const { duration, visFrac, startFrac } = getAudioConvertViewport();
  const endFrac = startFrac + visFrac;
  const ratio = clamp(audioConvertState.playheadSec / duration, 0, 1);
  const margin = visFrac * 0.12;
  let changed = false;

  if (ratio < startFrac + margin) {
    const targetStart = clamp(ratio - margin, 0, Math.max(0, 1 - visFrac));
    const denom = Math.max(0.000001, 1 - visFrac);
    audioConvertState.waveScroll = clamp(targetStart / denom, 0, 1);
    changed = true;
  } else if (ratio > endFrac - margin) {
    const targetStart = clamp(ratio + margin - visFrac, 0, Math.max(0, 1 - visFrac));
    const denom = Math.max(0.000001, 1 - visFrac);
    audioConvertState.waveScroll = clamp(targetStart / denom, 0, 1);
    changed = true;
  }

  if (changed) {
    syncAudioConvertZoomUI();
  }
}

function stopAudioConvertPreview() {
  if (audioConvertState.stopTimer) {
    clearInterval(audioConvertState.stopTimer);
    audioConvertState.stopTimer = null;
  }
  if (audioConvertState.playheadRAF) {
    cancelAnimationFrame(audioConvertState.playheadRAF);
    audioConvertState.playheadRAF = null;
  }
  if (el.audioConvertPlayer) {
    try { el.audioConvertPlayer.pause(); } catch (_) {}
  }
  audioConvertState.playheadSec = audioConvertState.startSec;
  ensurePlayheadVisible();
  syncPlayheadLabel();
  renderAudioConvertWaveform();
}

function pauseAudioConvertPreview() {
  if (audioConvertState.stopTimer) {
    clearInterval(audioConvertState.stopTimer);
    audioConvertState.stopTimer = null;
  }
  if (audioConvertState.playheadRAF) {
    cancelAnimationFrame(audioConvertState.playheadRAF);
    audioConvertState.playheadRAF = null;
  }
  if (el.audioConvertPlayer) {
    audioConvertState.playheadSec = el.audioConvertPlayer.currentTime;
    try { el.audioConvertPlayer.pause(); } catch (_) {}
  }
  ensurePlayheadVisible();
  syncPlayheadLabel();
  renderAudioConvertWaveform();
}

function startAudioConvertPlayheadLoop() {
  if (audioConvertState.playheadRAF) {
    cancelAnimationFrame(audioConvertState.playheadRAF);
    audioConvertState.playheadRAF = null;
  }
  function tick() {
    if (!el.audioConvertPlayer || el.audioConvertPlayer.paused) {
      audioConvertState.playheadRAF = null;
      return;
    }
    audioConvertState.playheadSec = el.audioConvertPlayer.currentTime;
    if (audioConvertState.playheadSec >= audioConvertState.endSec) {
      if (audioConvertState.loopPlayback) {
        audioConvertState.playheadSec = audioConvertState.startSec;
        try {
          el.audioConvertPlayer.currentTime = audioConvertState.startSec;
        } catch (_) {}
      } else {
        stopAudioConvertPreview();
        return;
      }
    }
    ensurePlayheadVisible();
    syncPlayheadLabel();
    renderAudioConvertWaveform();
    audioConvertState.playheadRAF = requestAnimationFrame(tick);
  }
  audioConvertState.playheadRAF = requestAnimationFrame(tick);
}

function syncAudioConvertLabels() {
  if (el.audioConvertStartLabel) el.audioConvertStartLabel.textContent = `${formatSeconds(audioConvertState.startSec)}s`;
  if (el.audioConvertEndLabel) el.audioConvertEndLabel.textContent = `${formatSeconds(audioConvertState.endSec)}s`;
  if (el.audioConvertDurationLabel) el.audioConvertDurationLabel.textContent = `${formatSeconds(audioConvertState.durationSec)}s`;
  if (el.audioConvertSampleRateLabel) {
    el.audioConvertSampleRateLabel.textContent = audioConvertState.sampleRate > 0
      ? `${Math.round(audioConvertState.sampleRate)}Hz`
      : '-';
  }
}

function syncAudioConvertZoomUI() {
  const zoom = audioConvertState.waveZoom;
  const scroll = audioConvertState.waveScroll;
  if (el.audioConvertZoomSlider) el.audioConvertZoomSlider.value = String(zoom);
  if (el.audioConvertZoomLabel) el.audioConvertZoomLabel.textContent = `×${zoom.toFixed(1)}`;
  const hasScroll = zoom > 1.001;
  if (el.audioConvertScrollSlider) {
    el.audioConvertScrollSlider.disabled = !hasScroll;
    el.audioConvertScrollSlider.value = String(Math.round(scroll * 1000));
  }
}

function setAudioConvertZoom(zoom, anchorRatio) {
  const clamped = clamp(zoom, 1, 32);
  const prevZoom = audioConvertState.waveZoom;
  const prevScroll = audioConvertState.waveScroll;
  audioConvertState.waveZoom = clamped;
  if (clamped <= 1) {
    audioConvertState.waveScroll = 0;
  } else if (anchorRatio != null) {
    // zoom around anchorRatio (0..1 in audio time)
    const visibleFrac = 1 / prevZoom;
    const anchorAbs = prevScroll * (1 - visibleFrac) + anchorRatio * visibleFrac;
    const newVisFrac = 1 / clamped;
    const newScroll = (anchorAbs - anchorRatio * newVisFrac) / (1 - newVisFrac);
    audioConvertState.waveScroll = clamp(newScroll, 0, 1);
  }
  syncAudioConvertZoomUI();
  renderAudioConvertWaveform();
}

function renderAudioConvertWaveform() {
  const canvas = el.audioConvertWaveCanvas;
  const buffer = audioConvertState.audioBuffer;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0e16';
  ctx.fillRect(0, 0, w, h);

  if (!buffer) return;
  const data = buffer.getChannelData(0);
  const totalSamples = data.length;
  const mid = h / 2;

  const { duration, visFrac, startFrac, endFrac } = getAudioConvertViewport();
  const i0Total = Math.floor(startFrac * totalSamples);
  const i1Total = Math.min(totalSamples, Math.ceil(endFrac * totalSamples));
  const visibleSamples = Math.max(1, i1Total - i0Total);
  const step = Math.max(1, visibleSamples / w);

  const toCanvasX = (r) => Math.floor(((r - startFrac) / visFrac) * w);

  // Draw original waveform in the background for before/after comparison.
  if (audioConvertState.originalAudioBuffer && audioConvertState.originalAudioBuffer !== buffer) {
    const originalData = audioConvertState.originalAudioBuffer.getChannelData(0);
    const originalTotal = originalData.length;
    const o0 = Math.floor(startFrac * originalTotal);
    const o1 = Math.min(originalTotal, Math.ceil(endFrac * originalTotal));
    const oVisible = Math.max(1, o1 - o0);
    const oStep = Math.max(1, oVisible / w);
    ctx.strokeStyle = 'rgba(150, 150, 150, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const si = Math.floor(o0 + x * oStep);
      const ei = Math.min(originalTotal, Math.floor(o0 + (x + 1) * oStep));
      let min = 1;
      let max = -1;
      for (let i = si; i < ei; i++) {
        const v = originalData[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = mid + (min * mid * 0.92);
      const y2 = mid + (max * mid * 0.92);
      ctx.moveTo(x + 0.5, y1);
      ctx.lineTo(x + 0.5, y2);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(106, 181, 255, 0.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const si = Math.floor(i0Total + x * step);
    const ei = Math.min(totalSamples, Math.floor(i0Total + (x + 1) * step));
    let min = 1;
    let max = -1;
    for (let i = si; i < ei; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = mid + (min * mid * 0.92);
    const y2 = mid + (max * mid * 0.92);
    ctx.moveTo(x + 0.5, y1);
    ctx.lineTo(x + 0.5, y2);
  }
  ctx.stroke();

  // Draw trim markers in visible coordinate space
  const startRatio = audioConvertState.startSec / duration;
  const endRatio = audioConvertState.endSec / duration;
  const sx = toCanvasX(startRatio);
  const ex = toCanvasX(endRatio);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  if (sx > 0) ctx.fillRect(0, 0, Math.max(0, sx), h);
  if (ex < w) ctx.fillRect(Math.max(0, ex), 0, Math.max(0, w - ex), h);

  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (sx >= 0 && sx <= w) { ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, h); }
  if (ex >= 0 && ex <= w) { ctx.moveTo(ex + 0.5, 0); ctx.lineTo(ex + 0.5, h); }
  ctx.stroke();

  // Draw playhead indicator
  if (audioConvertState.durationSec > 0) {
    const phRatio = audioConvertState.playheadSec / duration;
    const px = toCanvasX(phRatio);
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px + 0.5, 10);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.setLineDash([]);

  // Draw time axis ticks at reasonable intervals
  const visibleDurationSec = duration * visFrac;
  const rawInterval = visibleDurationSec / 8;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;
  const niceStep = normalized < 1.5 ? magnitude : normalized < 3.5 ? 2 * magnitude : normalized < 7 ? 5 * magnitude : 10 * magnitude;
  const firstTick = Math.ceil((startFrac * duration) / niceStep) * niceStep;
  ctx.fillStyle = 'rgba(180, 200, 220, 0.55)';
  ctx.font = '10px monospace';
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(120, 150, 180, 0.3)';
  for (let t = firstTick; t <= endFrac * duration + niceStep * 0.01; t += niceStep) {
    const r = t / duration;
    const tx = toCanvasX(r);
    if (tx < 0 || tx > w) continue;
    ctx.beginPath();
    ctx.moveTo(tx + 0.5, h - 18);
    ctx.lineTo(tx + 0.5, h);
    ctx.stroke();
    const label = t < 60 ? `${t.toFixed(t < 1 ? 2 : 1)}s` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    ctx.fillText(label, tx + 2, h - 4);
  }
}

function syncAudioConvertInputsFromState() {
  const duration = Math.max(0, audioConvertState.durationSec);
  const toSlider = (v) => Math.round((duration <= 0 ? 0 : (v / duration)) * 1000);

  if (el.audioConvertStartInput) el.audioConvertStartInput.value = formatSeconds(audioConvertState.startSec);
  if (el.audioConvertEndInput) el.audioConvertEndInput.value = formatSeconds(audioConvertState.endSec);
  if (el.audioConvertStartSlider) el.audioConvertStartSlider.value = String(clamp(toSlider(audioConvertState.startSec), 0, 1000));
  if (el.audioConvertEndSlider) el.audioConvertEndSlider.value = String(clamp(toSlider(audioConvertState.endSec), 0, 1000));
  syncAudioConvertLabels();
  updateAudioConvertLevelLabel();
  renderAudioConvertWaveform();
}

function setAudioConvertRange(startSec, endSec) {
  const duration = Math.max(0, audioConvertState.durationSec);
  const minGap = duration > 0.02 ? 0.01 : 0;
  let s = clamp(Number(startSec) || 0, 0, duration);
  let e = clamp(Number(endSec) || duration, 0, duration);
  if (e < s + minGap) {
    if (e >= duration) s = clamp(e - minGap, 0, duration);
    else e = clamp(s + minGap, 0, duration);
  }
  audioConvertState.startSec = s;
  audioConvertState.endSec = e;
  syncAudioConvertInputsFromState();
}

function audioArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function writeAudioWavDataUrl(channels, sampleRate) {
  const channelCount = Math.max(1, Math.min(2, channels.length || 1));
  const frameCount = Math.max(1, channels[0]?.length || 1);
  const dataSize = frameCount * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  function writeAscii(text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
    offset += text.length;
  }

  writeAscii('RIFF');
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeAscii('WAVE');
  writeAscii('fmt ');
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channelCount, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * channelCount * 2, true); offset += 4;
  view.setUint16(offset, channelCount * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeAscii('data');
  view.setUint32(offset, dataSize, true); offset += 4;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let ch = 0; ch < channelCount; ch += 1) {
      const value = Math.max(-1, Math.min(1, channels[ch]?.[frame] ?? channels[0]?.[frame] ?? 0));
      const pcm = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }

  return `data:audio/wav;base64,${audioArrayBufferToBase64(buffer)}`;
}

function readAudioConvertOptions(options = {}) {
  const sampleRate = Number(options.sampleRate ?? el.audioConvertSampleRateInput?.value ?? 0);
  return {
    trimStartSec: options.trimStartSec,
    trimEndSec: options.trimEndSec,
    normalize: Boolean(options.normalize ?? (String(el.audioConvertNormalizeInput?.value || 'FALSE').toUpperCase() === 'TRUE')),
    volumeDb: Number(options.volumeDb ?? el.audioConvertVolumeDbInput?.value ?? 0) || 0,
    fadeInSec: Math.max(0, Number(options.fadeInSec ?? el.audioConvertFadeInInput?.value ?? 0) || 0),
    fadeOutSec: Math.max(0, Number(options.fadeOutSec ?? el.audioConvertFadeOutInput?.value ?? 0) || 0),
    mono: Boolean(options.mono ?? (String(el.audioConvertMonoInput?.value || 'FALSE').toUpperCase() === 'TRUE')),
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : null,
  };
}

function sampleAudioBuffer(buffer, channelIndex, position, startFrame, endFrame) {
  const channelCount = Math.max(1, buffer.numberOfChannels || 1);
  const ch = Math.max(0, Math.min(channelCount - 1, channelIndex));
  const data = buffer.getChannelData(ch);
  const p = Math.max(startFrame, Math.min(endFrame - 1, position));
  const i0 = Math.max(startFrame, Math.min(endFrame - 1, Math.floor(p)));
  const i1 = Math.max(startFrame, Math.min(endFrame - 1, i0 + 1));
  const t = p - i0;
  return (data[i0] * (1 - t)) + (data[i1] * t);
}

function mixAudioBufferSample(buffer, position, startFrame, endFrame) {
  const channelCount = Math.max(1, buffer.numberOfChannels || 1);
  let sum = 0;
  for (let ch = 0; ch < channelCount; ch += 1) {
    sum += sampleAudioBuffer(buffer, ch, position, startFrame, endFrame);
  }
  return sum / channelCount;
}

function computeSelectedAudioPeak(buffer, startFrame, endFrame, mono) {
  let peak = 0;
  const channelCount = Math.max(1, buffer.numberOfChannels || 1);
  const step = Math.max(1, Math.floor((endFrame - startFrame) / 96000));
  for (let frame = startFrame; frame < endFrame; frame += step) {
    if (mono) {
      peak = Math.max(peak, Math.abs(mixAudioBufferSample(buffer, frame, startFrame, endFrame)));
    } else {
      for (let ch = 0; ch < Math.min(2, channelCount); ch += 1) {
        peak = Math.max(peak, Math.abs(sampleAudioBuffer(buffer, ch, frame, startFrame, endFrame)));
      }
    }
  }
  return peak;
}

function processAudioBufferToWavDataUrl(buffer, options = {}) {
  if (!buffer) throw new Error('音声が読み込まれていません');
  const parsed = readAudioConvertOptions(options);
  const sourceRate = Math.max(1, Math.round(buffer.sampleRate || 44100));
  const duration = Math.max(0, Number(buffer.duration) || 0);
  const startSec = Math.max(0, Number(parsed.trimStartSec ?? 0) || 0);
  const endSec = Math.max(startSec + 0.001, Number(parsed.trimEndSec ?? duration) || duration);
  const clampedStartSec = clamp(startSec, 0, duration);
  const clampedEndSec = clamp(endSec, clampedStartSec + 0.001, duration || clampedStartSec + 0.001);
  const startFrame = Math.max(0, Math.min(buffer.length - 1, Math.floor(clampedStartSec * sourceRate)));
  const endFrame = Math.max(startFrame + 1, Math.min(buffer.length, Math.ceil(clampedEndSec * sourceRate)));
  const outRate = Math.max(4000, Math.min(96000, parsed.sampleRate || sourceRate));
  const outChannelCount = parsed.mono ? 1 : Math.max(1, Math.min(2, buffer.numberOfChannels || 1));
  const outDuration = (endFrame - startFrame) / sourceRate;
  const outFrames = Math.max(1, Math.ceil(outDuration * outRate));
  const output = Array.from({ length: outChannelCount }, () => new Float32Array(outFrames));
  const peak = computeSelectedAudioPeak(buffer, startFrame, endFrame, parsed.mono);
  const normalizeGain = parsed.normalize && peak > 0 ? Math.min(32, 0.98 / peak) : 1;
  const volumeGain = Math.pow(10, parsed.volumeDb / 20);
  const fadeInFrames = Math.max(0, Math.min(outFrames, Math.round(parsed.fadeInSec * outRate)));
  const fadeOutFrames = Math.max(0, Math.min(outFrames, Math.round(parsed.fadeOutSec * outRate)));

  for (let frame = 0; frame < outFrames; frame += 1) {
    const srcPos = startFrame + ((frame / outRate) * sourceRate);
    const fadeInGain = fadeInFrames > 0 ? Math.min(1, frame / fadeInFrames) : 1;
    const fadeOutGain = fadeOutFrames > 0 ? Math.min(1, (outFrames - frame - 1) / fadeOutFrames) : 1;
    const gain = normalizeGain * volumeGain * Math.max(0, Math.min(fadeInGain, fadeOutGain));
    if (parsed.mono) {
      output[0][frame] = Math.max(-1, Math.min(1, mixAudioBufferSample(buffer, srcPos, startFrame, endFrame) * gain));
    } else {
      for (let ch = 0; ch < outChannelCount; ch += 1) {
        output[ch][frame] = Math.max(-1, Math.min(1, sampleAudioBuffer(buffer, ch, srcPos, startFrame, endFrame) * gain));
      }
    }
  }

  return {
    ok: true,
    dataUrl: writeAudioWavDataUrl(output, outRate),
    sampleRate: outRate,
    channels: outChannelCount,
    durationSeconds: outFrames / outRate,
    processing: {
      trimStartSec: clampedStartSec,
      trimEndSec: clampedEndSec,
      normalize: parsed.normalize,
      volumeDb: parsed.volumeDb,
      fadeInSec: parsed.fadeInSec,
      fadeOutSec: parsed.fadeOutSec,
      mono: parsed.mono,
      sampleRate: outRate,
      channels: outChannelCount,
    },
  };
}

async function decodeAudioDataUrl(dataUrl) {
  const resp = await fetch(dataUrl);
  const buf = await resp.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(buf.slice(0));
  } finally {
    await ctx.close();
  }
}

function settleAudioConvertModal(result) {
  const resolve = audioConvertState.resolve;
  audioConvertState.resolve = null;
  if (resolve) resolve(result);
}

function shouldReturnAudioConvertResult(pending = audioConvertState.pending) {
  return Boolean(pending?.returnResult || pending?.mode === 'pce-asset' || pending?.target === 'pce-asset');
}

function closeAudioConvertModal(clearPending = true, result = null) {
  stopAudioConvertPreview();
  closeModal(el.audioConvertModal);
  audioConvertState.active = false;
  audioConvertState.audioBuffer = null;
  audioConvertState.originalAudioBuffer = null;
  audioConvertState.dataUrl = '';
  audioConvertState.durationSec = 0;
  audioConvertState.sampleRate = 0;
  audioConvertState.startSec = 0;
  audioConvertState.endSec = 0;
  if (clearPending) {
    settleAudioConvertModal(result || { ok: false, canceled: true });
    audioConvertState.pending = null;
    state.rescomp.pendingAssetPick = null;
  }
}

async function finalizeAssetRegistration({
  normalizedType,
  copyResult,
  targetFileName,
  symbol,
  comment,
  warning,
  resFile,
}) {
  const defaultEntry = createDefaultEntry(normalizedType, copyResult.relativePath, targetFileName);
  defaultEntry.name = normalizeSymbolName(symbol || defaultEntry.name);
  defaultEntry.comment = comment || '';

  const addResult = await window.electronAPI.addResEntry({
    file: resFile || state.rescomp.selectedFile,
    entry: defaultEntry,
  });

  if (!addResult?.ok) {
    if (el.assetTableHint) el.assetTableHint.textContent = `定義追加失敗: ${addResult?.error || 'unknown'}`;
    return false;
  }

  state.rescomp.selectedFile = resFile || state.rescomp.selectedFile;
  await loadResDefinitions({ keepSelection: true });

  const file = getSelectedFile();
  const matched = file?.entries.find((e) => e.name === defaultEntry.name && e.type === normalizedType && e.sourcePath === defaultEntry.sourcePath);
  if (matched) {
    state.rescomp.selectedEntryLine = matched.lineNumber;
    renderAssetTable();
  }

  if (el.assetTableHint) {
    const msg = copyResult?.warning || warning || `追加しました: ${defaultEntry.type} ${defaultEntry.name}`;
    el.assetTableHint.textContent = msg;
  }
  return true;
}

async function openAudioConvertModal(pending) {
  return new Promise(async (resolve) => {
    const picked = pending?.picked || {
      sourcePath: pending?.sourcePath || pending?.path || '',
      fileName: pending?.fileName || String(pending?.sourcePath || '').split(/[\\/]/).pop() || 'audio.wav',
      ext: String(pending?.ext || pending?.sourcePath || '').toLowerCase().match(/(\.[^.\\/]+)$/)?.[1] || '',
    };
    const kind = String(pending?.kind || pending?.assetKind || '').trim();
    const defaults = pending?.defaults || {};
    const defaultSampleRate = defaults.sampleRate || (kind === 'cdda-track' ? 44100 : kind === 'adpcm' ? 16000 : 22050);
    const defaultMono = defaults.mono ?? (kind !== 'cdda-track');

    audioConvertState.pending = { ...pending, picked };
    audioConvertState.resolve = resolve;
    audioConvertState.active = true;
    openModal(el.audioConvertModal);

    if (el.audioConvertSourceLabel) {
      el.audioConvertSourceLabel.textContent = `${picked.fileName || '-'} -> ${pending?.targetFileName || picked.fileName || 'audio.wav'}`;
    }
    if (el.audioConvertNormalizeInput) el.audioConvertNormalizeInput.value = defaults.normalize ? 'TRUE' : 'FALSE';
    if (el.audioConvertMonoInput) el.audioConvertMonoInput.value = defaultMono ? 'TRUE' : 'FALSE';
    if (el.audioConvertVolumeDbInput) el.audioConvertVolumeDbInput.value = defaults.volumeDb ?? '';
    if (el.audioConvertFadeInInput) el.audioConvertFadeInInput.value = defaults.fadeInSec ?? '';
    if (el.audioConvertFadeOutInput) el.audioConvertFadeOutInput.value = defaults.fadeOutSec ?? '';
    if (el.audioConvertSampleRateInput) el.audioConvertSampleRateInput.value = defaultSampleRate ? String(defaultSampleRate) : '';
    if (el.audioConvertHint) el.audioConvertHint.textContent = '音声を解析中...';
    if (el.btnAudioConvertApply) el.btnAudioConvertApply.textContent = pending?.returnResult || pending?.mode === 'pce-asset' ? '変換して戻る' : '変換して追加';
    audioConvertState.waveZoom = 1;
    audioConvertState.waveScroll = 0;
    audioConvertState.playheadSec = 0;
    audioConvertState.loopPlayback = false;
    syncAudioConvertZoomUI();
    syncPlayheadLabel();
    syncAudioConvertLoopButton();

    const isSourceWav = (picked.ext || '').toLowerCase() === '.wav';
    if (el.btnAudioConvertSkip) {
      el.btnAudioConvertSkip.style.display = isSourceWav ? '' : 'none';
    }

    const read = await window.electronAPI.readFileAsDataUrl(picked.sourcePath);
    if (!read?.ok || !read?.dataUrl) {
      if (el.audioConvertHint) el.audioConvertHint.textContent = `音声読み込み失敗: ${read?.error || 'unknown'}`;
      return;
    }

    audioConvertState.dataUrl = read.dataUrl;
    if (el.audioConvertPlayer) {
      el.audioConvertPlayer.src = read.dataUrl;
    }

    try {
      const decoded = await decodeAudioDataUrl(read.dataUrl);
      audioConvertState.audioBuffer = decoded;
      audioConvertState.originalAudioBuffer = decoded;
      audioConvertState.durationSec = Number(decoded.duration) || 0;
      audioConvertState.sampleRate = Number(decoded.sampleRate) || 0;
      audioConvertState.startSec = 0;
      audioConvertState.endSec = audioConvertState.durationSec;
      audioConvertState.playheadSec = 0;
      syncAudioConvertInputsFromState();
      if (el.audioConvertHint) el.audioConvertHint.textContent = '範囲を指定してプレビューできます。';
    } catch (err) {
      if (el.audioConvertHint) el.audioConvertHint.textContent = `音声解析失敗: ${String(err?.message || err)}`;
    }
  });
}

async function applyAudioConvertNormalizePreview() {
  const pending = audioConvertState.pending;
  if (!pending) return;

  const normalize = String(el.audioConvertNormalizeInput?.value || 'FALSE').toUpperCase() === 'TRUE';
  const volumeDb = Number(el.audioConvertVolumeDbInput?.value || 0) || 0;
  const fadeInSec = Math.max(0, Number(el.audioConvertFadeInInput?.value || 0) || 0);
  const fadeOutSec = Math.max(0, Number(el.audioConvertFadeOutInput?.value || 0) || 0);
  if (!normalize && volumeDb === 0 && fadeInSec === 0 && fadeOutSec === 0) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = '正規化/ボリューム/フェードの指定がないため適用不要です。';
    return;
  }

  if (el.audioConvertHint) el.audioConvertHint.textContent = '正規化/ボリューム調整を適用中...';
  if (el.btnAudioConvertNormalizeApply) el.btnAudioConvertNormalizeApply.disabled = true;

  try {
    const result = processAudioBufferToWavDataUrl(audioConvertState.originalAudioBuffer, {
      trimStartSec: 0,
      trimEndSec: audioConvertState.originalAudioBuffer?.duration || audioConvertState.durationSec,
      normalize,
      volumeDb,
      fadeInSec,
      fadeOutSec,
      mono: false,
      sampleRate: null,
    });

    if (!result?.ok || !result?.dataUrl) {
      if (el.audioConvertHint) el.audioConvertHint.textContent = `適用失敗: ${result?.error || 'unknown'}`;
      return;
    }

    stopAudioConvertPreview();
    audioConvertState.dataUrl = result.dataUrl;
    if (el.audioConvertPlayer) el.audioConvertPlayer.src = result.dataUrl;

    const decoded = await decodeAudioDataUrl(result.dataUrl);
    audioConvertState.audioBuffer = decoded;
    audioConvertState.durationSec = Number(decoded.duration) || 0;
    audioConvertState.sampleRate = Number(decoded.sampleRate) || 0;
    audioConvertState.playheadSec = clamp(audioConvertState.playheadSec, 0, audioConvertState.durationSec);
    audioConvertState.startSec = clamp(audioConvertState.startSec, 0, audioConvertState.durationSec);
    audioConvertState.endSec = clamp(audioConvertState.endSec, audioConvertState.startSec, audioConvertState.durationSec);
    syncAudioConvertInputsFromState();

    if (el.audioConvertHint) el.audioConvertHint.textContent = '正規化/ボリューム適用済み（灰:元波形 / 青:適用後）';
  } catch (err) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = `適用失敗: ${String(err?.message || err)}`;
  } finally {
    if (el.btnAudioConvertNormalizeApply) el.btnAudioConvertNormalizeApply.disabled = false;
  }
}

async function skipAudioConvertModal() {
  const pending = audioConvertState.pending;
  if (!pending) {
    closeAudioConvertModal(true);
    return;
  }

  if (el.audioConvertHint) el.audioConvertHint.textContent = 'ファイルをコピー中...';

  if (shouldReturnAudioConvertResult(pending)) {
    const result = {
      ok: true,
      skipped: true,
      dataUrl: audioConvertState.dataUrl,
      originalFileName: pending.picked?.fileName || '',
      sourceFileName: pending.targetFileName || pending.picked?.fileName || 'audio.wav',
      sampleRate: audioConvertState.sampleRate,
      channels: audioConvertState.audioBuffer?.numberOfChannels || 0,
      durationSeconds: audioConvertState.durationSec,
      processing: { skipped: true },
    };
    closeAudioConvertModal(true, result);
    return;
  }

  const copyResult = await window.electronAPI.writeAssetFile({
    sourcePath: pending.picked.sourcePath,
    targetSubdir: pending.targetSubdir,
    targetFileName: pending.targetFileName,
  });

  if (!copyResult?.ok) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = `コピー失敗: ${copyResult?.error || 'unknown'}`;
    return;
  }

  const added = await finalizeAssetRegistration({
    normalizedType: 'WAV',
    copyResult,
    targetFileName: pending.targetFileName,
    symbol: pending.symbol,
    comment: pending.comment,
    warning: '',
    resFile: pending.resFile,
  });
  if (!added) return;

  closeAudioConvertModal(true);
}

async function applyAudioConvertModal() {
  const pending = audioConvertState.pending;
  if (!pending) {
    closeAudioConvertModal(true);
    return;
  }

  const startSec = Number(el.audioConvertStartInput?.value || audioConvertState.startSec || 0);
  const endSec = Number(el.audioConvertEndInput?.value || audioConvertState.endSec || 0);
  if (Number.isFinite(startSec) && startSec < 0) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = '開始位置は 0 以上にしてください。';
    return;
  }
  if (Number.isFinite(endSec) && endSec <= 0) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = '終了位置は 0 より大きくしてください。';
    return;
  }
  if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec <= startSec) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = '終了位置は開始位置より後にしてください。';
    return;
  }

  const sampleRate = Number(el.audioConvertSampleRateInput?.value || 0);
  const payload = {
    sourcePath: pending.picked.sourcePath,
    targetSubdir: pending.targetSubdir,
    targetFileName: pending.targetFileName,
    options: {
      trimStartSec: Number.isFinite(startSec) ? startSec : null,
      trimEndSec: Number.isFinite(endSec) ? endSec : null,
      normalize: String(el.audioConvertNormalizeInput?.value || 'FALSE').toUpperCase() === 'TRUE',
      volumeDb: Number(el.audioConvertVolumeDbInput?.value || 0) || 0,
      mono: String(el.audioConvertMonoInput?.value || 'FALSE').toUpperCase() === 'TRUE',
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null,
    },
  };

  if (el.audioConvertHint) el.audioConvertHint.textContent = '音声を変換しています...';
  let processed;
  try {
    processed = processAudioBufferToWavDataUrl(audioConvertState.originalAudioBuffer, payload.options);
  } catch (err) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = `変換失敗: ${String(err?.message || err)}`;
    return;
  }

  if (shouldReturnAudioConvertResult(pending)) {
    closeAudioConvertModal(true, {
      ok: true,
      dataUrl: processed.dataUrl,
      originalFileName: pending.picked?.fileName || '',
      sourceFileName: pending.targetFileName || `${String(pending.picked?.fileName || 'audio').replace(/\.[^.]+$/, '')}.wav`,
      sampleRate: processed.sampleRate,
      channels: processed.channels,
      durationSeconds: processed.durationSeconds,
      processing: processed.processing,
    });
    return;
  }

  const copyResult = await window.electronAPI.writeAssetFile({
    sourcePath: pending.picked.sourcePath,
    targetSubdir: pending.targetSubdir,
    targetFileName: pending.targetFileName,
    dataUrl: processed.dataUrl,
  });
  if (!copyResult?.ok) {
    if (el.audioConvertHint) el.audioConvertHint.textContent = `変換失敗: ${copyResult?.error || 'unknown'}`;
    return;
  }

  const added = await finalizeAssetRegistration({
    normalizedType: 'WAV',
    copyResult,
    targetFileName: pending.targetFileName,
    symbol: pending.symbol,
    comment: pending.comment,
    warning: '',
    resFile: pending.resFile,
  });
  if (!added) return;

  closeAudioConvertModal(true, { ok: true, copyResult });
}

async function tryHandleAssetImport(payload) {
  const handlers = getPluginCapabilities('asset-import-handler');
  for (const handler of handlers) {
    if (typeof handler?.handleImport !== 'function') continue;
    try {
      const canHandle = typeof handler.canHandle === 'function'
        ? handler.canHandle(payload)
        : true;
      if (!canHandle) continue;
      const result = await handler.handleImport(payload);
      if (result?.handled) return result;
    } catch (err) {
      appendLog('app', `asset-import-handler エラー: ${String(err?.message || err)}`, 'warn');
      return { handled: false, error: String(err?.message || err) };
    }
  }
  return { handled: false };
}

async function submitAssetModal() {
  const picked = state.rescomp.pendingAssetPick;
  if (!picked) {
    closeModal(el.assetModal);
    return;
  }

  const normalizedType = String(el.assetTypeInput?.value || '').trim().toUpperCase();
  if (!TYPE_OPTIONS.includes(normalizedType)) {
    if (el.assetTableHint) el.assetTableHint.textContent = `未対応タイプ: ${normalizedType}`;
    return;
  }

  const targetSubdir = el.assetTargetSubdirInput?.value.trim() || defaultSubDirForType(normalizedType);
  const inputFileName = el.assetTargetFileNameInput?.value.trim() || picked.fileName;
  if (!inputFileName) return;
  let targetFileName = (normalizedType === 'WAV' && AUDIO_EXTS.includes((picked.ext || '').toLowerCase()))
    ? (String(inputFileName).toLowerCase().endsWith('.wav') ? inputFileName : `${inputFileName.replace(/\.[^.]+$/, '')}.wav`)
    : inputFileName;

  const symbol = el.assetSymbolNameInput?.value.trim() || normalizeSymbolName(targetFileName);
  const comment = el.assetCommentInput?.value.trim() || '';
  const resFile = el.assetResFileInput?.value || state.rescomp.selectedFile;

  let convertedDataUrl = '';
  let warning = '';
  const rawTargetW = String(el.assetResizeTargetWidth?.value || '').trim();
  const rawTargetH = String(el.assetResizeTargetHeight?.value || '').trim();
  const resizeEnabled = ['IMAGE', 'BITMAP', 'SPRITE', 'MAP', 'TILEMAP', 'TILESET'].includes(normalizedType);
  if (resizeEnabled && ((rawTargetW && !rawTargetH) || (!rawTargetW && rawTargetH))) {
    if (el.assetTableHint) {
      el.assetTableHint.textContent = '画像サイズ指定は幅と高さを両方入力してください。';
    }
    return;
  }
  const targetWidth = Number(el.assetResizeTargetWidth?.value || 0);
  const targetHeight = Number(el.assetResizeTargetHeight?.value || 0);
  const hasTargetSize = Number.isFinite(targetWidth)
    && Number.isFinite(targetHeight)
    && targetWidth > 0
    && targetHeight > 0;
  const sourceExt = (picked.ext || '').toLowerCase();
  const isImageAsset = IMAGE_EXTS.includes(sourceExt);
  const isAudioInput = AUDIO_EXTS.includes(sourceExt);
  const supportsResize = normalizedType !== 'PALETTE';
  if (isImageAsset && ['PALETTE', 'IMAGE', 'BITMAP', 'SPRITE', 'MAP', 'TILEMAP', 'TILESET'].includes(normalizedType)) {
    const converted = await maybeConvertImageToIndexed16(picked.sourcePath, {
      targetSize: (hasTargetSize && supportsResize) ? { width: Math.round(targetWidth), height: Math.round(targetHeight) } : null,
    });
    if (converted.canceled) {
      closeModal(el.assetModal);
      if (el.assetTableHint) {
        el.assetTableHint.textContent = converted.warning || '画像登録をキャンセルしました';
      }
      return;
    }
    convertedDataUrl = converted.convertedDataUrl || '';
    if (converted.targetExtension) {
      targetFileName = `${targetFileName.replace(/\.[^.]+$/, '')}${converted.targetExtension}`;
    }
    warning = converted.warning || '';
  }

  if (normalizedType === 'WAV' && isAudioInput) {
    const audioCapability = getPluginCapability('audio-convert-ui');
    if (!audioCapability?.openAudioConvertModal) {
      if (el.assetTableHint) {
        el.assetTableHint.textContent = '音声変換コンバータープラグインが無効または未インストールです';
      }
      return;
    }
    closeModal(el.assetModal);
    await audioCapability.openAudioConvertModal({
      picked,
      targetSubdir,
      targetFileName,
      symbol,
      comment,
      resFile,
    });
    return;
  }

  const handled = await tryHandleAssetImport({
    picked,
    normalizedType,
    targetSubdir,
    targetFileName,
    symbol,
    comment,
    resFile,
  });
  if (handled?.handled) {
    state.rescomp.pendingAssetPick = null;
    closeModal(el.assetModal);
    if (el.assetTableHint && handled.message) {
      el.assetTableHint.textContent = handled.message;
    }
    return;
  }
  if (handled?.error) {
    if (el.assetTableHint) el.assetTableHint.textContent = handled.error;
    return;
  }

  const copyResult = await window.electronAPI.writeAssetFile({
    sourcePath: picked.sourcePath,
    targetSubdir,
    targetFileName,
    dataUrl: convertedDataUrl || '',
  });

  if (!copyResult?.ok) {
    if (el.assetTableHint) el.assetTableHint.textContent = `コピー失敗: ${copyResult?.error || 'unknown'}`;
    return;
  }

  const added = await finalizeAssetRegistration({
    normalizedType,
    copyResult,
    targetFileName,
    symbol,
    comment,
    warning,
    resFile,
  });
  if (!added) return;

  state.rescomp.pendingAssetPick = null;
  closeModal(el.assetModal);
}

function openProjectModal() {
  state.project.newProjectParentDir = state.project.newProjectParentDir || state.project.projectsRootDir || '';
  if (el.projectParentDirInput) {
    el.projectParentDirInput.value = state.project.newProjectParentDir || '';
    el.projectParentDirInput.title = state.project.newProjectParentDir || '';
  }
  if (el.projectSystemNameInput) el.projectSystemNameInput.value = 'my_pce_game';
  populateProjectTemplateSelect();
  openModal(el.projectModal);
}

function getProjectTemplateMediaLabel(template) {
  const media = String(template?.targetMedia || '').trim().toLowerCase();
  if (media === 'cd') return 'SUPER CD-ROM2';
  if (media === 'hucard') return 'HuCard';
  return '';
}

function getBuilderPluginDisplayName(builderId) {
  const id = String(builderId || '').trim();
  if (!id) return '';
  const plugin = getPluginById(id);
  return plugin ? String(plugin.name || plugin.id) : id;
}

function populateProjectTemplateSelect() {
  if (!el.projectTemplateSelect) return;
  const selectedCore = 'pc-engine';
  const templates = Array.isArray(state.project.templates) ? state.project.templates : [];
  const options = ['<option value="">空のプロジェクト</option>'];
  templates.filter((template) => !template.coreId || template.coreId === selectedCore).forEach((template) => {
    const media = getProjectTemplateMediaLabel(template);
    const builder = template.builderPlugin ? ` / ${getBuilderPluginDisplayName(template.builderPlugin)}` : '';
    const label = `${template.title || template.projectName}${media ? ` (${media})` : ''}${builder}`;
    options.push(`<option value="${escHtml(template.templateId)}">${escHtml(label)}</option>`);
  });
  el.projectTemplateSelect.innerHTML = options.join('');
  updateProjectTemplateHint();
}

function updateProjectTemplateHint() {
  if (!el.projectTemplateHint) return;
  const templateId = String(el.projectTemplateSelect?.value || '').trim();
  if (!templateId) {
    el.projectTemplateHint.textContent = 'テンプレート未選択の場合は空のプロジェクトを作成します。';
    return;
  }
  const template = (state.project.templates || []).find((item) => item.templateId === templateId);
  if (!template) {
    el.projectTemplateHint.textContent = '選択したテンプレート情報を取得できません。';
    return;
  }
  const builder = template.builderPlugin ? ` / ビルダー: ${getBuilderPluginDisplayName(template.builderPlugin)}` : '';
  const media = getProjectTemplateMediaLabel(template);
  el.projectTemplateHint.textContent = `コピー元: ${template.projectDir}${media ? ` / 種別: ${media}` : ''}${builder}`;
}

async function chooseProjectParentDirectory() {
  const picked = await window.electronAPI.pickFile({
    title: '新規プロジェクトの作成場所を選択',
    properties: ['openDirectory'],
  });
  if (picked?.canceled) return;
  const parentDir = picked?.sourcePath || picked?.filePaths?.[0] || '';
  if (!parentDir) return;
  state.project.newProjectParentDir = parentDir;
  if (el.projectParentDirInput) {
    el.projectParentDirInput.value = parentDir;
    el.projectParentDirInput.title = parentDir;
  }
}

async function submitProjectModal() {
  const projectName = el.projectSystemNameInput?.value.trim();
  if (!projectName) {
    if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = 'プロジェクトフォルダ名を入力してください。';
    return;
  }
  const coreId = 'pc-engine';
  const projectTitle = projectName;
  const payload = {
    projectName,
    parentDir: el.projectParentDirInput?.value.trim() || state.project.projectsRootDir || '',
    templateId: String(el.projectTemplateSelect?.value || '').trim(),
    config: {
      coreId,
      platform: 'pce',
      title: projectTitle,
      romName: projectTitle,
      toolchain: 'llvm-mos',
    },
  };
  const result = await window.electronAPI.createNewProject(payload);
  if (!result?.ok) {
    if (!result?.canceled && el.settingsSavedMsg) {
      el.settingsSavedMsg.textContent = `プロジェクト作成失敗: ${result?.error || 'unknown'}`;
    }
    return;
  }
  state.startup.projectSelected = true;
  state.startup.projectSelectionRequired = false;
  closeModal(el.projectModal);
  await reloadProjectAfterSwitch();
  if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = `✓ プロジェクトを作成しました: ${result.projectDir}`;
}

// ====================================================== ABOUT DIALOG ===

function closeAboutDialog() {
  if (!el.aboutModal) {
    return;
  }
  el.aboutModal.classList.remove('open');
  el.aboutModal.setAttribute('aria-hidden', 'true');
}

async function openAboutDialog() {
  if (!el.aboutModal) {
    return;
  }
  el.aboutModal.classList.add('open');
  el.aboutModal.setAttribute('aria-hidden', 'false');

  try {
    const info = await window.electronAPI.getAppInfo();
    if (!info) {
      return;
    }
    const wasm = info.embeddedWasm || {};
    if (el.aboutTitle) el.aboutTitle.textContent = info.appName || 'PCE Game Editor';
    if (el.aboutDescription) el.aboutDescription.textContent = info.appDescription || 'Embedded emulator information';
    if (el.aboutAppVersion) el.aboutAppVersion.textContent = info.appVersion || 'unknown';
    if (el.aboutWasmBuildVersion) el.aboutWasmBuildVersion.textContent = wasm.buildVersion || 'unknown';
    if (el.aboutWasmPackageVersion) el.aboutWasmPackageVersion.textContent = wasm.packageVersion || 'unknown';
    if (el.aboutElectronVersion) el.aboutElectronVersion.textContent = info.electronVersion || 'unknown';
    if (el.aboutChromeVersion) el.aboutChromeVersion.textContent = info.chromeVersion || 'unknown';
    if (el.aboutNodeVersion) el.aboutNodeVersion.textContent = info.nodeVersion || 'unknown';
    if (el.aboutPlatform) el.aboutPlatform.textContent = info.platform || 'unknown';
    if (el.aboutArch) el.aboutArch.textContent = info.arch || 'unknown';
    if (el.aboutAppPath) el.aboutAppPath.textContent = info.appPath || 'unknown';
  } catch (_err) {
    if (el.aboutWasmBuildVersion) {
      el.aboutWasmBuildVersion.textContent = 'failed to load';
    }
  }
}

// ====================================================== EVENT BINDING ===

function bindEvents() {
  el.sidebar?.addEventListener('click', (event) => {
    closeSidebarPluginContextMenu();
    if (pluginState.draggingSidebarPluginId) return;
    const btn = event.target.closest('.nav-btn');
    if (!btn) return;
    if (btn.disabled) return;
    const page = btn.dataset.page || '';
    if (!page) return;
    switchPage(page);
    if (page === 'plugins') loadPlugins();
  });
  el.sidebar?.addEventListener('contextmenu', openSidebarPluginContextMenu);
  document.addEventListener('click', (event) => {
    if (sidebarPluginContextMenu && !sidebarPluginContextMenu.hidden && !sidebarPluginContextMenu.contains(event.target)) {
      closeSidebarPluginContextMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebarPluginContextMenu();
  });
  window.addEventListener('resize', closeSidebarPluginContextMenu);

  el.btnOpenPluginsFolder?.addEventListener('click', async () => {
    const result = await window.electronAPI.openPluginsFolder();
    if (result?.ok) {
      appendLog('app', `プラグインフォルダを開きました: ${result.path || ''}`);
    } else {
      appendLog('app', `プラグインフォルダを開けませんでした: ${result?.error || 'unknown'}`, 'warn');
    }
  });

  el.btnReloadPlugins?.addEventListener('click', () => {
    appendLog('app', 'プラグインを再スキャンしています...');
    loadPlugins();
  });

  el.pluginSearchInput?.addEventListener('input', () => {
    state.pluginFilters.searchText = el.pluginSearchInput.value || '';
    renderPluginList();
  });
  el.pluginTypeFilter?.addEventListener('change', () => {
    state.pluginFilters.type = el.pluginTypeFilter.value || 'all';
    renderPluginList();
  });
  el.pluginCoreFilterToggle?.addEventListener('change', () => {
    state.pluginFilters.showAllCores = Boolean(el.pluginCoreFilterToggle.checked);
    renderPluginRoleSettings();
    renderPluginList();
  });

  el.btnSetup?.addEventListener('click', () => {
    window.electronAPI.openSetupWindow();
  });
  el.btnBuild?.addEventListener('click', runBuild);
  el.btnTestPlay?.addEventListener('click', openTestPlay);
  el.btnExport?.addEventListener('click', openExportModal);
  el.btnExportModalClose?.addEventListener('click', () => closeModal(el.exportModal));
  el.btnExportModalCancel?.addEventListener('click', () => closeModal(el.exportModal));
  el.btnExportRom?.addEventListener('click', () => exportLastBuild('rom'));
  el.btnExportHtml?.addEventListener('click', () => exportLastBuild('html'));
  el.btnNewProject?.addEventListener('click', openProjectPicker);
  el.btnOpenProject?.addEventListener('click', openProjectPicker);
  el.projectName?.addEventListener('click', openProjectPicker);
  el.projectDirLabel?.addEventListener('click', openCurrentProjectDirectory);
  $('btnOpenSetup')?.addEventListener('click', () => {
    window.electronAPI.openSetupWindow();
  });

  el.btnCodeNewFile?.addEventListener('click', () => {
    void promptCreateCodeEntry('file');
  });
  el.btnCodeNewFolder?.addEventListener('click', () => {
    void promptCreateCodeEntry('directory');
  });
  el.btnCodeDelete?.addEventListener('click', async () => {
    await deleteSelectedCodeEntry();
  });
  el.btnCodeTreeExpandAll?.addEventListener('click', () => {
    expandAllCodeDirs();
  });
  el.btnCodeTreeCollapseAll?.addEventListener('click', () => {
    collapseAllCodeDirs();
  });
  el.codeTreeFilterInput?.addEventListener('input', () => {
    state.code.treeFilterText = el.codeTreeFilterInput.value || '';
    renderCodeTree();
  });
  el.btnCodeEntryConfirm?.addEventListener('click', submitCodeNameDialog);
  el.btnCodeEntryCancel?.addEventListener('click', () => closeCodeNameDialog(null));
  el.btnCodeEntryModalClose?.addEventListener('click', () => closeCodeNameDialog(null));
  el.codeEntryModal?.querySelector('.app-backdrop')?.addEventListener('click', () => closeCodeNameDialog(null));
  el.codeEntryNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitCodeNameDialog();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCodeNameDialog(null);
    }
  });
  el.btnPluginRoleAccordion?.addEventListener('click', () => {
    setPluginRoleAccordionOpen(!state.pluginUi.roleAccordionOpen);
  });
  el.btnSaveCode?.addEventListener('click', async () => {
    await saveCurrentCodeFile();
  });
  el.btnCodeFindToggle?.addEventListener('click', () => {
    if (state.code.findOpen) closeCodeFindPanel();
    else openCodeFindPanel();
  });
  el.codeFindInput?.addEventListener('input', updateCodeFindQuery);
  el.codeReplaceInput?.addEventListener('input', updateCodeFindQuery);
  el.codeFindInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      findCodeNext(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCodeFindPanel();
    }
  });
  el.codeReplaceInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceCurrentCodeMatch();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCodeFindPanel();
    }
  });
  el.btnCodeFindPrev?.addEventListener('click', () => findCodeNext(-1));
  el.btnCodeFindNext?.addEventListener('click', () => findCodeNext(1));
  el.btnCodeReplaceOne?.addEventListener('click', replaceCurrentCodeMatch);
  el.btnCodeReplaceAll?.addEventListener('click', replaceAllCodeMatches);
  el.codeEncodingSelect?.addEventListener('change', async () => {
    const nextEncoding = el.codeEncodingSelect.value || 'auto';
    if (state.code.dirty && !state.code.selectedIsDirectory && !state.code.selectedIsMedia) {
      const ok = window.confirm(`${getCodeDisplayPath(state.code.selectedPath)} の未保存変更を破棄して文字コードを切り替えますか？`);
      if (!ok) {
        el.codeEncodingSelect.value = state.code.selectedEncoding;
        return;
      }
      setCodeDirty(false);
    }
    state.code.selectedEncoding = nextEncoding;
    if (!state.code.selectedIsDirectory && !state.code.selectedIsMedia && state.code.selectedPath) {
      await openCodeFile(state.code.selectedPath);
    }
  });
  el.codeEditor?.addEventListener('input', () => {
    if (!state.code.selectedIsDirectory) {
      setCodeDirty(true);
      updateCodeEditor(el.codeEditor.value);
      updateCodeCompletion();
      updateCodeCursorLine();
    }
  });
  el.codeEditor?.addEventListener('click', updateCodeCursorLine);
  el.codeEditor?.addEventListener('keyup', updateCodeCursorLine);
  el.codeEditor?.addEventListener('select', updateCodeCursorLine);
  el.codeEditor?.addEventListener('keydown', (event) => {
    if (!el.codeCompletionPanel?.hidden && state.code.completions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.code.completionIndex = (state.code.completionIndex + 1) % state.code.completions.length;
        renderCodeCompletionPanel();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.code.completionIndex = (state.code.completionIndex - 1 + state.code.completions.length) % state.code.completions.length;
        renderCodeCompletionPanel();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applyCodeCompletion();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCodeCompletion();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault();
      updateCodeCompletion({ force: true });
    }
  });

  el.btnSaveSettings?.addEventListener('click', saveSettings);
  el.settingTitle?.addEventListener('input', () => {
    state.projectConfig.title = el.settingTitle.value;
    updateProjectNameDisplay();
    collectAndValidateSettings({ showError: true });
  });
  el.settingAuthor?.addEventListener('input', () => collectAndValidateSettings({ showError: true }));
  el.settingSerial?.addEventListener('input', () => {
    el.settingSerial.value = el.settingSerial.value.toUpperCase();
    collectAndValidateSettings({ showError: true });
  });
  [el.externalEmulatorPath, el.externalEmulatorArgs].forEach((input) => {
    input?.addEventListener('input', () => {
      state.projectConfig.testPlay = buildTestPlaySettingsPatch();
    });
  });

  el.btnOpenOutputFolder?.addEventListener('click', async () => {
    if (!state.lastRomPath) {
      if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = 'ROM 出力先がまだありません。先にビルドしてください。';
      return;
    }
    const result = await window.electronAPI.openPathInExplorer(state.lastRomPath, { parentOnly: true });
    if (!result?.ok && el.settingsSavedMsg) {
      el.settingsSavedMsg.textContent = `フォルダを開けませんでした: ${result?.error || 'unknown'}`;
    }
  });

  el.btnDownloadRom?.addEventListener('click', async () => {
    if (!state.lastRomPath) return;
    const result = await window.electronAPI.saveRomAs(state.lastRomPath);
    if (result?.ok) {
      if (el.settingsSavedMsg) {
        el.settingsSavedMsg.textContent = `✓ 保存しました: ${result.path}`;
        setTimeout(() => { if (el.settingsSavedMsg) el.settingsSavedMsg.textContent = ''; }, 2500);
      }
    } else if (!result?.canceled && el.settingsSavedMsg) {
      el.settingsSavedMsg.textContent = `保存に失敗: ${result?.error || 'unknown'}`;
    }
  });

  el.btnOpenProjectDir?.addEventListener('click', openCurrentProjectDirectory);
  el.btnSettingsProjectPicker?.addEventListener('click', openProjectPicker);

  el.btnOpenResDir?.addEventListener('click', async () => {
    const r = await window.electronAPI.openResDirectory();
    if (!r?.ok && el.assetTableHint) {
      el.assetTableHint.textContent = `res ディレクトリを開けません: ${r?.error || 'unknown'}`;
    }
  });

  el.btnCreateResFile?.addEventListener('click', openResFileModal);
  el.btnAddAsset?.addEventListener('click', openAssetModal);

  el.btnResFileModalClose?.addEventListener('click', () => closeModal(el.resFileModal));
  el.btnResFileCancel?.addEventListener('click', () => closeModal(el.resFileModal));
  el.btnResFileCreate?.addEventListener('click', submitResFileModal);

  el.btnAssetModalClose?.addEventListener('click', () => closeModal(el.assetModal));
  el.btnAssetModalCancel?.addEventListener('click', () => closeModal(el.assetModal));
  el.btnAssetModalCreate?.addEventListener('click', submitAssetModal);

  el.btnAudioConvertClose?.addEventListener('click', () => closeAudioConvertModal(true));
  el.btnAudioConvertCancel?.addEventListener('click', () => closeAudioConvertModal(true));
  el.audioConvertBackdrop?.addEventListener('click', () => closeAudioConvertModal(true));
  el.btnAudioConvertApply?.addEventListener('click', applyAudioConvertModal);
  el.btnAudioConvertSkip?.addEventListener('click', skipAudioConvertModal);
  el.btnAudioConvertNormalizeApply?.addEventListener('click', applyAudioConvertNormalizePreview);
  el.btnAudioConvertStop?.addEventListener('click', stopAudioConvertPreview);
  el.btnAudioConvertPause?.addEventListener('click', pauseAudioConvertPreview);
  el.btnAudioConvertRewind?.addEventListener('click', () => {
    seekAudioConvertPlayhead(audioConvertState.startSec);
  });
  el.btnAudioConvertLoop?.addEventListener('click', () => {
    audioConvertState.loopPlayback = !audioConvertState.loopPlayback;
    syncAudioConvertLoopButton();
  });
  el.btnAudioConvertSetStart?.addEventListener('click', () => {
    if (!audioConvertState.durationSec) return;
    setAudioConvertRange(audioConvertState.playheadSec, audioConvertState.endSec);
  });
  el.btnAudioConvertSetEnd?.addEventListener('click', () => {
    if (!audioConvertState.durationSec) return;
    setAudioConvertRange(audioConvertState.startSec, audioConvertState.playheadSec);
  });

  el.btnAudioConvertZoomIn?.addEventListener('click', () => {
    setAudioConvertZoom(audioConvertState.waveZoom * 2, 0.5);
  });
  el.btnAudioConvertZoomOut?.addEventListener('click', () => {
    setAudioConvertZoom(audioConvertState.waveZoom / 2, 0.5);
  });
  el.btnAudioConvertZoomReset?.addEventListener('click', () => {
    audioConvertState.waveZoom = 1;
    audioConvertState.waveScroll = 0;
    syncAudioConvertZoomUI();
    renderAudioConvertWaveform();
  });
  el.audioConvertZoomSlider?.addEventListener('input', () => {
    const z = Number(el.audioConvertZoomSlider?.value || 1);
    setAudioConvertZoom(z, 0.5);
  });
  el.audioConvertScrollSlider?.addEventListener('input', () => {
    audioConvertState.waveScroll = clamp(Number(el.audioConvertScrollSlider?.value || 0) / 1000, 0, 1);
    renderAudioConvertWaveform();
  });
  el.audioConvertWaveCanvas?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = el.audioConvertWaveCanvas.getBoundingClientRect();
    const mouseFrac = (e.clientX - rect.left) / rect.width;
    const zoom = audioConvertState.waveZoom;
    const visFrac = 1 / zoom;
    const startFrac = audioConvertState.waveScroll * (1 - visFrac);
    const anchorRatio = startFrac + mouseFrac * visFrac;
    const factor = e.deltaY < 0 ? 1.5 : 1 / 1.5;
    setAudioConvertZoom(zoom * factor, anchorRatio);
  }, { passive: false });

  el.audioConvertWaveCanvas?.addEventListener('click', (e) => {
    if (!audioConvertState.durationSec || !el.audioConvertWaveCanvas) return;
    const rect = el.audioConvertWaveCanvas.getBoundingClientRect();
    const xRatio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const { duration, visFrac, startFrac } = getAudioConvertViewport();
    const ratio = startFrac + xRatio * visFrac;
    const sec = clamp(ratio * duration, 0, duration);
    seekAudioConvertPlayhead(sec);
  });

  el.btnAudioConvertPreview?.addEventListener('click', async () => {
    if (!audioConvertState.dataUrl || !el.audioConvertPlayer) return;
    // 再生中なら先頭から再開、一時停止中ならそこから再開
    const isPlaying = !el.audioConvertPlayer.paused;
    if (isPlaying) {
      stopAudioConvertPreview();
      return;
    }
    const resumeFrom = audioConvertState.playheadSec;
    const startFrom = (resumeFrom >= audioConvertState.endSec || resumeFrom < audioConvertState.startSec)
      ? audioConvertState.startSec
      : resumeFrom;
    try {
      el.audioConvertPlayer.currentTime = startFrom;
      await el.audioConvertPlayer.play();
      startAudioConvertPlayheadLoop();
    } catch (_err) {
      if (el.audioConvertHint) el.audioConvertHint.textContent = 'プレビュー再生に失敗しました。';
    }
  });

  el.audioConvertStartSlider?.addEventListener('input', () => {
    const duration = Math.max(0, audioConvertState.durationSec);
    const startSec = (Number(el.audioConvertStartSlider?.value || 0) / 1000) * duration;
    setAudioConvertRange(startSec, audioConvertState.endSec);
  });
  el.audioConvertEndSlider?.addEventListener('input', () => {
    const duration = Math.max(0, audioConvertState.durationSec);
    const endSec = (Number(el.audioConvertEndSlider?.value || 1000) / 1000) * duration;
    setAudioConvertRange(audioConvertState.startSec, endSec);
  });
  el.audioConvertStartInput?.addEventListener('change', () => {
    const n = Number(el.audioConvertStartInput?.value || 0);
    if (Number.isFinite(n)) setAudioConvertRange(n, audioConvertState.endSec);
  });
  el.audioConvertEndInput?.addEventListener('change', () => {
    const n = Number(el.audioConvertEndInput?.value || 0);
    if (Number.isFinite(n)) setAudioConvertRange(audioConvertState.startSec, n);
  });

  el.btnAccordionParams?.addEventListener('click', () => {
    setAccordionOpen('params', !state.preview.paramsOpen);
  });

  el.btnAccordionPreview?.addEventListener('click', () => {
    setAccordionOpen('preview', !state.preview.previewOpen);
  });

  el.btnTogglePreviewPanel?.addEventListener('click', () => {
    const nextOpen = !state.preview.panelOpen;
    if (!nextOpen) {
      stopAudioPreview();
      stopVgmPreview();
    }
    setPreviewPanelOpen(nextOpen);
  });

  el.btnAudioPlay?.addEventListener('click', () => {
    const entry = getCurrentSelectedEntry();
    if (entry && isVgmPreviewEntry(entry)) {
      toggleVgmPreview(entry);
    } else if (entry && isAudioEntry(entry)) {
      if (state.preview.audio && state.preview.audioEntryId === entry.id) {
        stopAudioPreview();
      } else {
        toggleAudioPreview(entry);
      }
    }
  });

  el.audioSeek?.addEventListener('input', () => {
    if (state.preview.audio && state.preview.audio.duration) {
      state.preview.audio.currentTime = (parseFloat(el.audioSeek.value) / 100) * state.preview.audio.duration;
    } else if (state.preview.vgmEntryId) {
      el.audioSeek.value = 0;
    }
  });

  el.inlineImageZoom?.addEventListener('change', () => {
    state.preview.imageZoom = el.inlineImageZoom.value || 'fit';
    applyInlineImageZoom();
    redrawCurrentSpritePreview();
  });
  el.inlineImageFrame?.addEventListener('wheel', (event) => {
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    stepInlineImageZoom(step);
    redrawCurrentSpritePreview();
  }, { passive: false });

  el.assetTypeInput?.addEventListener('change', syncAssetModalForType);
  el.assetTargetSubdirInput?.addEventListener('input', () => {
    el.assetTargetSubdirInput.dataset.userEdited = '1';
  });
  el.assetTargetFileNameInput?.addEventListener('input', () => {
    if (el.assetSymbolNameInput) {
      delete el.assetSymbolNameInput.dataset.userEdited;
    }
    syncAssetModalForType();
  });
  el.assetSymbolNameInput?.addEventListener('input', () => {
    el.assetSymbolNameInput.dataset.userEdited = '1';
  });

  el.btnProjectModalClose?.addEventListener('click', () => {
    if (cancelRequiredProjectSelection()) return;
    closeModal(el.projectModal);
  });
  el.btnProjectModalCancel?.addEventListener('click', () => {
    if (cancelRequiredProjectSelection()) return;
    closeModal(el.projectModal);
  });
  el.btnProjectParentDirBrowse?.addEventListener('click', chooseProjectParentDirectory);
  el.projectTemplateSelect?.addEventListener('change', updateProjectTemplateHint);
  el.btnProjectModalCreate?.addEventListener('click', submitProjectModal);
  el.btnProjectPickerOpenFolder?.addEventListener('click', openProjectFolderFromDialog);
  el.btnProjectPickerNew?.addEventListener('click', () => {
    closeModal(el.projectPickerModal);
    openProjectModal();
  });
  el.btnProjectPickerClose?.addEventListener('click', () => {
    if (cancelRequiredProjectSelection()) return;
    closeModal(el.projectPickerModal);
  });
  el.btnProjectPickerCancel?.addEventListener('click', () => {
    if (cancelRequiredProjectSelection()) return;
    closeModal(el.projectPickerModal);
  });

  document.querySelectorAll('[data-modal-close]').forEach((node) => {
    node.addEventListener('click', () => {
      const modalId = node.getAttribute('data-modal-close');
      if ((modalId === 'projectModal' || modalId === 'projectPickerModal') && cancelRequiredProjectSelection()) return;
      closeModal($(modalId));
    });
  });

  el.resFileSelect?.addEventListener('change', () => {
    state.rescomp.selectedFile = el.resFileSelect.value;
    state.rescomp.selectedEntryLine = null;
    renderAssetTable();
  });

  el.assetSearchInput?.addEventListener('input', () => {
    state.rescomp.searchText = el.assetSearchInput.value || '';
    renderAssetTable();
  });

  el.btnDeleteAssetEntry?.addEventListener('click', deleteCurrentResFile);
  el.assetPreviewResizer?.addEventListener('pointerdown', beginAssetPreviewResize);

  el.resizeMode?.addEventListener('change', () => {
    const mode = el.resizeMode.value;
    if (el.resizePreviewCanvas) {
      el.resizePreviewCanvas.style.cursor = mode === 'clip' ? 'crosshair' : 'default';
    }
    ensureCropRect();
    renderResizePreview();
  });
  [el.resizeWidth, el.resizeHeight].forEach((inp) => {
    inp?.addEventListener('input', () => {
      updateResizeValidation();
      ensureCropRect();
      renderResizePreview();
    });
  });
  el.resizePreviewCanvas?.addEventListener('pointerdown', beginResizeCropDrag);
  el.resizePreviewCanvas?.addEventListener('pointermove', (e) => {
    // ドラッグ中はカーソルを window の pointermove ハンドラに任せる
    if (resizeState.drag?.active) return;
    if ((el.resizeMode?.value || 'resize') !== 'clip' || !resizeState.renderMap || !resizeState.cropRect) return;
    const b = el.resizePreviewCanvas.getBoundingClientRect();
    const scaleX = b.width ? el.resizePreviewCanvas.width / b.width : 1;
    const scaleY = b.height ? el.resizePreviewCanvas.height / b.height : 1;
    const canvasX = (e.clientX - b.left) * scaleX;
    const canvasY = (e.clientY - b.top) * scaleY;
    const mode = detectCropDragMode(canvasX, canvasY);
    const cursorMap = {
      'resize-nw': 'nwse-resize',
      'resize-ne': 'nesw-resize',
      'resize-se': 'nwse-resize',
      'resize-sw': 'nesw-resize',
      'move': 'move',
      'none': 'crosshair',
    };
    el.resizePreviewCanvas.style.cursor = cursorMap[mode] || 'crosshair';
  });
  window.addEventListener('pointermove', updateResizeCropDrag);
  window.addEventListener('pointerup', endResizeCropDrag);
  window.addEventListener('pointercancel', endResizeCropDrag);
  el.btnResizeApply?.addEventListener('click', () => {
    if (resizeState.onApply) resizeState.onApply('apply');
    else closeResizeModal();
  });
  el.btnResizeSkip?.addEventListener('click', () => {
    if (resizeState.onApply) resizeState.onApply('skip');
  });
  el.btnResizeCancel?.addEventListener('click', () => {
    if (resizeState.onApply) resizeState.onApply('cancel');
    else closeResizeModal();
  });
  el.btnResizeModalClose?.addEventListener('click', () => {
    if (resizeState.onApply) resizeState.onApply('cancel');
    else closeResizeModal();
  });

  el.btnQuantizeClose?.addEventListener('click', () => {
    if (quantizeState.onApply) quantizeState.onApply(false);
    else closeQuantizeModal();
  });
  el.btnQuantizeCancel?.addEventListener('click', () => {
    if (quantizeState.onApply) quantizeState.onApply(false);
    else closeQuantizeModal();
  });
  el.quantizeBackdrop?.addEventListener('click', () => {
    if (quantizeState.onApply) quantizeState.onApply(false);
    else closeQuantizeModal();
  });
  el.btnQuantizeApply?.addEventListener('click', () => {
    if (quantizeState.onApply) quantizeState.onApply(true);
    else closeQuantizeModal();
  });

  [
    el.quantizeTransparencyMode,
    el.quantizeTransparencyColor,
    el.quantizeUseSharedCustomColor,
    el.quantizeDitheringEnabled,
    el.quantizeDitherMode,
    el.quantizeDitheringWeight,
    el.quantizePattern,
    el.quantizeBrightness,
    el.quantizeSaturation,
    el.quantizePaletteAsset,
  ].forEach((control) => {
    control?.addEventListener('input', () => { void rerenderQuantizePreview(); });
    control?.addEventListener('change', () => { void rerenderQuantizePreview(); });
  });

  if (el.btnAboutClose) el.btnAboutClose.addEventListener('click', closeAboutDialog);
  if (el.aboutBackdrop) el.aboutBackdrop.addEventListener('click', closeAboutDialog);

  el.buildLogHeader?.addEventListener('click', () => setLogOpen(!state.logOpen));
  el.btnCopyLog?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await copyBuildLog();
  });
  el.btnPopoutLog?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await openLogPopout();
  });
  el.btnClearLog?.addEventListener('click', (e) => { e.stopPropagation(); clearBuildLog(); });
  el.btnToggleLog?.addEventListener('click', (e) => { e.stopPropagation(); setLogOpen(!state.logOpen); });
  el.logLevelFilter?.addEventListener('change', () => {
    state.logs.levelFilter = el.logLevelFilter.value || 'all';
    scheduleLogPanelRender();
  });
  el.logSearchInput?.addEventListener('input', () => {
    state.logs.searchText = el.logSearchInput.value || '';
    scheduleLogPanelRender();
  });

  if (el.buildLogResizer) {
    let dragStartY = 0;
    let dragStartHeight = 0;
    const onMouseMove = (event) => {
      const delta = dragStartY - event.clientY;
      setLogOpenHeight(dragStartHeight + delta, { persist: false });
    };
    const onMouseUp = () => {
      el.buildLogResizer.classList.remove('dragging');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      saveLogViewerState();
    };

    el.buildLogResizer.addEventListener('mousedown', (event) => {
      if (!state.logOpen) return;
      event.preventDefault();
      dragStartY = event.clientY;
      dragStartHeight = state.logOpenHeight;
      el.buildLogResizer.classList.add('dragging');
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  window.electronAPI.onBuildLog((payload) => {
    appendLog('build', payload.text || '', payload.level);
  });

  window.electronAPI.onPluginLog?.((payload) => {
    appendLog(payload?.source || payload?.pluginId || 'plugin', payload?.text || '', payload?.level || 'info');
  });
  window.electronAPI.onLogWindowClosed?.(() => {
    setLogDetached(false);
  });

  window.electronAPI.onBuildEnd((payload) => {
    if (payload.success) {
      state.lastRomPath = payload.romPath;
      if (payload.romPath && el.settingOutputPath) el.settingOutputPath.value = payload.romPath;
      updateRomOutputActions();
      const sizeKb = payload.romSize != null ? `${(payload.romSize / 1024).toFixed(1)} KB` : '';
      if (el.buildRomSize) el.buildRomSize.textContent = sizeKb ? `ROM: ${sizeKb}` : '';
      setBuildStatus('success', '✓ ビルド成功');
    } else {
      setBuildStatus('error', '✕ ビルド失敗');
    }
  });

  window.electronAPI.onMenuOpenSetup?.(() => {
    switchPage('settings');
    window.electronAPI.openSetupWindow();
  });

  window.electronAPI.onMenuOpenProjects?.(() => {
    openProjectPicker();
  });

  window.electronAPI.onMenuOpenAbout?.(() => {
    openAboutDialog();
  });

  window.addEventListener('keydown', (e) => {
    const activeTag = (document.activeElement?.tagName || '').toUpperCase();
    const typingInInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (state.code.findOpen && state.currentPage === 'code') {
        e.preventDefault();
        closeCodeFindPanel();
        return;
      }
      if (el.aboutModal?.classList.contains('open')) {
        e.preventDefault();
        closeAboutDialog();
        return;
      }
      if (el.quantizeModal?.classList.contains('open')) {
        e.preventDefault();
        if (quantizeState.onApply) quantizeState.onApply(false);
        return;
      }
      if (el.assetModal?.classList.contains('open')) {
        e.preventDefault();
        closeModal(el.assetModal);
        return;
      }
      if (el.projectPickerModal?.classList.contains('open')) {
        e.preventDefault();
        if (cancelRequiredProjectSelection()) return;
        closeModal(el.projectPickerModal);
        return;
      }
      if (el.resFileModal?.classList.contains('open')) {
        e.preventDefault();
        closeModal(el.resFileModal);
        return;
      }
      if (el.codeEntryModal?.classList.contains('open')) {
        e.preventDefault();
        closeCodeNameDialog(null);
        return;
      }
      if (el.projectModal?.classList.contains('open')) {
        e.preventDefault();
        if (cancelRequiredProjectSelection()) return;
        closeModal(el.projectModal);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !typingInInput) {
      e.preventDefault();
      runBuild();
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && state.currentPage === 'code') {
      e.preventDefault();
      if (state.code.findOpen) closeCodeFindPanel();
      else openCodeFindPanel();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.currentPage === 'code') {
      e.preventDefault();
      void saveCurrentCodeFile();
    }
  });
}

// ============================================================ BOOTSTRAP ===

async function bootstrap() {
  const savedLogState = loadLogViewerState();
  setLogOpenHeight(savedLogState.openHeight);
  setLogOpen(false);
  if (el.logLevelFilter) el.logLevelFilter.value = state.logs.levelFilter;
  if (el.codeEncodingSelect) el.codeEncodingSelect.value = state.code.selectedEncoding;
  bindEvents();
  bindCodeScrollSync();
  loadAssetPreviewWidth();
  setPreviewPanelOpen(true);
  setAccordionOpen('params', true);
  setAccordionOpen('preview', true);
  const waitingForProject = await ensureStartupProjectSelection();
  if (waitingForProject) {
    renderLogPanel();
    return;
  }
  await loadProjectConfig();
  await refreshProjectList();
  if (isLegacyRescompAvailable()) {
    await loadResDefinitions({ keepSelection: false });
  }
  await loadPlugins();
  renderLogPanel();

  if (!el.codeEditor?.value) {
    loadSampleCode();
  }
}

bootstrap();
