'use strict';

const path = require('node:path');

function appModule(context, fileName) {
  if (context?.appModules?.[fileName]) return context.appModules[fileName];
  const appPath = String(context.appPath || '').trim() || require('electron').app.getAppPath();
  return require(path.join(appPath, fileName));
}

function request(payload, context) {
  const projectDir = String(context.projectDir || '').trim(); if (!projectDir) throw new Error('projectDirが取得できません');
  const assets = payload.assets && typeof payload.assets === 'object' ? payload.assets : { version: 2, assets: Array.isArray(context.assets) ? context.assets : [] };
  return { projectDir, doc: payload.doc, assets, settings: payload.settings || {}, gbStudio: payload.gbStudio || payload.settings?.gbStudioExecutable };
}

function inspectVnGbStudioExport(payload = {}, context = {}) {
  try { const exporter = appModule(context, 'pce-vn-gb-studio-exporter.js'); return { ok: true, result: exporter.inspectGbStudioExport(request(payload, context)) }; }
  catch (error) { context.logger?.error?.(`GB Studio preflight失敗: ${error?.message || error}`); return { ok: false, error: String(error?.message || error) }; }
}

function exportVnGbStudioProject(payload = {}, context = {}) {
  try {
    const exporter = appModule(context, 'pce-vn-gb-studio-exporter.js'); const inspection = exporter.inspectGbStudioExport(request(payload, context));
    if (inspection.errors.length) return { ok: false, error: `preflight errorが${inspection.errors.length}件あります`, inspection };
    const result = exporter.generateGbStudioProject({ inspection, outputDir: payload.outputDir, mode: payload.mode || 'generate' }); context.logger?.info?.(`GB Studio project出力: ${result.outputDir}`); return { ok: true, result };
  } catch (error) { context.logger?.error?.(`GB Studio出力失敗: ${error?.message || error}`); return { ok: false, error: String(error?.message || error), code: error.code || '' }; }
}

function validateVnGbStudioProject(payload = {}, context = {}) {
  try { const exporter = appModule(context, 'pce-vn-gb-studio-exporter.js'); return { ok: true, result: exporter.validateGbStudioProject({ outputDir: payload.outputDir, requireBuild: Boolean(payload.requireBuild) }) }; }
  catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

module.exports = { exportVnGbStudioProject, inspectVnGbStudioExport, validateVnGbStudioProject };
