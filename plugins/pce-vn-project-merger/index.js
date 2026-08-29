'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requireCurrentProject(context = {}) {
  const value = String(context.projectDir || '').trim();
  if (!value) throw new Error('現在のproject directoryを取得できません');
  const canonical = fs.realpathSync(value);
  if (!fs.statSync(canonical).isDirectory()) throw new Error('現在のproject directoryが存在しません');
  return canonical;
}

function appModule(context = {}) {
  if (context.appModules?.['pce-vn-project-merger.js']) return context.appModules['pce-vn-project-merger.js'];
  const appPath = String(context.appPath || '').trim() || require('electron').app.getAppPath();
  return require(path.join(appPath, 'pce-vn-project-merger.js'));
}

function mergeOptions(payload = {}, context = {}) {
  const currentProject = requireCurrentProject(context);
  const requested = Array.isArray(payload.projects) ? payload.projects : [];
  const additional = requested
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .filter((entry) => {
      try {
        return fs.realpathSync(entry) !== currentProject;
      } catch (_error) {
        return true;
      }
    });
  return {
    ...payload,
    projects: [currentProject, ...additional],
  };
}

function inspectVnProjectMerge(payload = {}, context = {}) {
  try {
    const currentProject = requireCurrentProject(context);
    if (payload.contextOnly === true) return { ok: true, currentProject };
    const result = appModule(context).inspectProjectMerge(mergeOptions(payload, context));
    const level = result.ok ? 'info' : 'error';
    context.logger?.[level]?.(
      result.ok
        ? `VN project結合検査: ${result.counts?.scenes || 0} scenes / ${result.counts?.assets || 0} assets`
        : `VN project結合検査失敗: ${result.error || result.errors?.[0]?.message || 'unknown error'}`,
    );
    return result;
  } catch (error) {
    context.logger?.error?.(`VN project結合検査失敗: ${error.message || error}`);
    return { ok: false, error: String(error.message || error) };
  }
}

function applyVnProjectMerge(payload = {}, context = {}) {
  try {
    const result = appModule(context).applyProjectMerge(mergeOptions(payload, context));
    const level = result.ok ? 'info' : 'error';
    context.logger?.[level]?.(
      result.ok
        ? `VN project結合完了: ${result.outputDir}`
        : `VN project結合失敗: ${result.error || result.diagnostics?.[0]?.message || 'unknown error'}`,
    );
    return result;
  } catch (error) {
    context.logger?.error?.(`VN project結合失敗: ${error.message || error}`);
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = {
  inspectVnProjectMerge,
  applyVnProjectMerge,
};
