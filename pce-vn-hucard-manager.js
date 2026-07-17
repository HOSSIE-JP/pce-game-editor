'use strict';

const fs = require('fs');
const path = require('path');
const vnManager = require('./pce-vn-manager');

const PCE_VISUAL_NOVEL_HUCARD_BUILDER_ID = 'pce-visual-novel-hucard-builder';
const HUCARD_VN_RUNTIME_ROM_BANKS = Object.freeze([
  Object.freeze({ bank: 1, offset: 2, role: 'script' }),
  Object.freeze({ bank: 2, offset: 3, role: 'video' }),
  Object.freeze({ bank: 3, offset: 4, role: 'text' }),
  Object.freeze({ bank: 4, offset: 5, role: 'psg/sprite-state' }),
]);
const HUCARD_VN_DATA_ROM_BANK_START = 5;
const HUCARD_VN_DATA_ROM_BANK_MAX = 127;
const HUCARD_VN_DATA_ROM_BANK_OFFSET = 6;

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function templateRuntimeDir() {
  return path.join(__dirname, 'template', 'template_pce_vn_hucard', 'src');
}

function copyIfChanged(sourcePath, targetPath) {
  const next = fs.readFileSync(sourcePath);
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null;
  if (current && current.length === next.length && current.equals(next)) return false;
  ensureDirSync(path.dirname(targetPath));
  fs.writeFileSync(targetPath, next);
  return true;
}

function syncHuCardVisualNovelRuntime(projectDir, logger = null) {
  const sourceDir = templateRuntimeDir();
  const targets = [
    ['main.c', path.join(projectDir, 'src', 'main.c')],
    ['pce_vn_hucard_banks.h', path.join(projectDir, 'src', 'pce_vn_hucard_banks.h')],
    ['pce_vn_hucard_runtime.c', path.join(projectDir, 'src', 'pce_vn_hucard_runtime.c')],
  ];
  const changed = targets
    .map(([fileName, targetPath]) => copyIfChanged(path.join(sourceDir, fileName), targetPath))
    .some(Boolean);
  if (changed) {
    logger?.info?.('HuCARD visual novel runtime files were synchronized from the template.');
  }
  return { changed };
}

function huCardConfigPatch(config = {}) {
  return {
    toolchain: 'llvm-mos',
    targetMedia: 'hucard',
    cd: {
      ...(config.cd || {}),
      dataFiles: [],
      cddaTracks: [],
    },
    pluginSettings: {
      ...(config.pluginSettings || {}),
      [PCE_VISUAL_NOVEL_HUCARD_BUILDER_ID]: {
        ...(config.pluginSettings?.[PCE_VISUAL_NOVEL_HUCARD_BUILDER_ID] || {}),
        template: 'visual-novel-hucard',
      },
    },
  };
}

function prepareHuCardVisualNovelBuild(projectDir, config = {}, logger = null, options = {}) {
  const runtimeSync = syncHuCardVisualNovelRuntime(projectDir, logger);
  vnManager.ensureSceneFile(projectDir);
  const signatureConfig = {
    ...config,
    targetMedia: 'hucard',
  };
  const configPatch = huCardConfigPatch(config);
  if (options.incremental && !runtimeSync.changed) {
    const cached = vnManager.readVnBuildStamp(projectDir);
    if (cached?.generated && vnManager.vnGeneratedOutputsReady(projectDir, cached.generated)) {
      const signature = vnManager.vnBuildSignature(projectDir, signatureConfig, [], []);
      if (signature === cached.signature) {
        logger?.info?.(`VN generation skipped: inputs unchanged (${cached.generated.sceneCount || 0} scene(s), ${cached.generated.messageCount || 0} message(s), ${cached.generated.glyphCount || 0} glyph(s))`);
        return {
          ok: true,
          generated: {
            ...cached.generated,
            incrementalSkipped: true,
          },
          stampInfo: {
            dataFiles: [],
            cddaTracks: [],
          },
          configPatch,
        };
      }
    }
  }
  const generated = vnManager.generateVnSources(projectDir, {
    ...(options.generateOptions || {}),
    targetMedia: 'hucard',
  });
  return {
    ok: true,
    generated,
    stampInfo: {
      dataFiles: [],
      cddaTracks: [],
    },
    configPatch,
  };
}

module.exports = {
  HUCARD_VN_DATA_ROM_BANK_MAX,
  HUCARD_VN_DATA_ROM_BANK_OFFSET,
  HUCARD_VN_DATA_ROM_BANK_START,
  HUCARD_VN_RUNTIME_ROM_BANKS,
  PCE_VISUAL_NOVEL_HUCARD_BUILDER_ID,
  prepareHuCardVisualNovelBuild,
  syncHuCardVisualNovelRuntime,
};
