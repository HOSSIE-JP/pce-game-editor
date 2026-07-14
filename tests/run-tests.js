'use strict';

const path = require('node:path');
const { loadAppConfig } = require('../game-editor-common');

loadAppConfig(require('../app.config'));

[
  'app-diagnostics.test.js',
  'editor-control-service.test.js',
  'export-html.test.js',
  'main-window-state.test.js',
  'packaging-config.test.js',
  'plugin-manager.test.js',
  'plugin-ipc.test.js',
  'plugin-diagnostics.test.js',
  'project-settings.test.js',
  'preload.test.js',
  'renderer-ui.test.js',
  'pce-app-separation.test.js',
  'pce-asset-manager.test.js',
  'pce-asset-store.test.js',
  'pce-asset-ipc.test.js',
  'pce-cd-bundle.test.js',
  'pce-external-emulator.test.js',
  'pce-file-safety.test.js',
  'pce-ipl-extractor.test.js',
  'pce-setup-manager.test.js',
  'pce-standard-emulator.test.js',
  'pce-preview-animation.test.js',
  'pce-sprite-editor-utils.test.js',
  'pce-testplay-server.test.js',
  'pce-testplay-settings.test.js',
  'pce-vgm-import.test.js',
  'pce-midi-import.test.js',
  'pce-psg-sfx.test.js',
  'pce-system-card-psg.test.js',
  'pce-system-card-font.test.js',
  'pce-system-card-profile.test.js',
  'pce-build-memory-gate.test.js',
  'pce-vn-manager.test.js',
  'pce-vn-cd-data-files.test.js',
  'pce-vn-cd-catalog.test.js',
  'pce-vn-scene-pack.test.js',
].forEach((file) => require(path.join(__dirname, file)));
