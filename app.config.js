'use strict';

const path = require('path');

module.exports = {
  appRoot: __dirname,
  appId: 'jp.co.geroneko.pce.editor.desktop',
  productName: 'PCEGameEditor',
  displayName: 'PCE Game Editor',
  defaultCoreId: 'pc-engine',
  allowedCoreIds: ['pc-engine'],
  coreAliases: {
    pce: 'pc-engine',
    pcengine: 'pc-engine',
    'pc-engine-core': 'pc-engine',
  },
  pluginsRoot: path.join(__dirname, 'plugins'),
  templatesRoot: path.join(__dirname, 'template'),
  projectsRootName: 'projects',
  toolsRootName: 'tools',
  migration: {
    pceProjectSourceRoots: [
      path.resolve(__dirname, '..', 'md_emulator', 'pce-game-editor', 'data', 'projects'),
      path.resolve(__dirname, '..', 'md_emulator', 'md-game-editor', 'data', 'projects'),
      path.resolve(__dirname, '..', 'md-game-editor', 'data', 'projects'),
      path.resolve(__dirname, '..', 'md-game-editor', 'projects'),
    ],
  },
};
