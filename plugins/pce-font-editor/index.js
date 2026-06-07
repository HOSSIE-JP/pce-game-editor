'use strict';

const vnManager = require('../../pce-vn-manager');

function requireProjectDir(context = {}) {
  const projectDir = String(context.projectDir || '').trim();
  if (!projectDir) throw new Error('projectDir が取得できません');
  return projectDir;
}

function readFontSettings(_payload = {}, context = {}) {
  const projectDir = requireProjectDir(context);
  return {
    ok: true,
    settings: vnManager.readFontConfig(projectDir),
    settingsFile: vnManager.VN_FONT_FILE,
  };
}

function saveFontSettings(payload = {}, context = {}) {
  const projectDir = requireProjectDir(context);
  const settings = vnManager.writeFontConfig(projectDir, payload.config || payload);
  return {
    ok: true,
    settings,
    settingsFile: vnManager.VN_FONT_FILE,
  };
}

function previewFont(payload = {}, context = {}) {
  const projectDir = requireProjectDir(context);
  const preview = vnManager.previewFontText(projectDir, payload);
  return {
    ok: true,
    ...preview,
  };
}

function generateFont(payload = {}, context = {}) {
  const projectDir = requireProjectDir(context);
  if (payload.config) vnManager.writeFontConfig(projectDir, payload.config);
  const generated = vnManager.generateVnSources(projectDir, {
    fontConfig: payload.config || undefined,
  });
  return {
    ok: true,
    generated,
  };
}

module.exports = {
  readFontSettings,
  saveFontSettings,
  previewFont,
  generateFont,
};
