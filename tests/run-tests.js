'use strict';

const path = require('node:path');
const { loadAppConfig } = require('../game-editor-common');

loadAppConfig(require('../app.config'));

[
  'editor-control-service.test.js',
  'export-html.test.js',
  'packaging-config.test.js',
  'plugin-manager.test.js',
  'pce-app-separation.test.js',
  'pce-asset-manager.test.js',
  'pce-cd-bundle.test.js',
  'pce-external-emulator.test.js',
  'pce-file-safety.test.js',
  'pce-ipl-extractor.test.js',
  'pce-setup-manager.test.js',
  'pce-standard-emulator.test.js',
  'pce-testplay-server.test.js',
  'pce-vn-manager.test.js',
].forEach((file) => require(path.join(__dirname, file)));
