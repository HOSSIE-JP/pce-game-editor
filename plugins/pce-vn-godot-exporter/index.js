'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requireProjectDir(context = {}) {
  const projectDir = String(context.projectDir || '').trim();
  if (!projectDir) throw new Error('projectDir が取得できません');
  return projectDir;
}

function sanitizeExportFileName(value, fallback = 'pce-vn') {
  const base = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80);
  return base || fallback;
}

function readProjectName(projectDir, logger) {
  try {
    const project = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf-8'));
    return project?.title || project?.romName || project?.name || 'pce-vn';
  } catch (error) {
    logger?.warn?.(`Godot出力用のproject名を読み込めません: ${error?.message || error}`);
    return 'pce-vn';
  }
}

function appModule(context, fileName) {
  if (context?.appModules?.[fileName]) return context.appModules[fileName];
  const appPath = String(context.appPath || '').trim()
    || require('electron').app.getAppPath();
  return require(path.join(appPath, fileName));
}

function defaultDialogServices(context = {}) {
  if (typeof context.showSaveDialog === 'function') {
    return {
      owner: context.owner,
      showSaveDialog: context.showSaveDialog,
    };
  }
  const { BrowserWindow, dialog } = require('electron');
  const owner = BrowserWindow.getFocusedWindow?.()
    || BrowserWindow.getAllWindows?.().find((window) => window && !window.isDestroyed?.());
  return {
    owner,
    showSaveDialog: (dialogOwner, options) => dialog.showSaveDialog(dialogOwner, options),
  };
}

async function exportVnGodotPackage(payload = {}, context = {}) {
  const projectDir = requireProjectDir(context);
  const { exportGodotPackageZip } = appModule(context, 'pce-vn-godot-package.js');
  const cdBundle = appModule(context, 'pce-cd-bundle.js');
  const dialogServices = defaultDialogServices(context);
  const projectName = readProjectName(projectDir, context.logger);

  return exportGodotPackageZip({
    projectDir,
    sceneDoc: payload?.doc || {},
    defaultPath: `${sanitizeExportFileName(projectName)}.pcevn.zip`,
    owner: dialogServices.owner,
    showSaveDialog: dialogServices.showSaveDialog,
    createStoredZipBuffer: context.createStoredZipBuffer
      || ((entries) => cdBundle.createStoredZipBuffer(entries)),
    writeFileSync: context.writeFileSync
      || ((filePath, data) => fs.writeFileSync(filePath, data)),
  });
}

module.exports = {
  exportVnGodotPackage,
  sanitizeExportFileName,
};
