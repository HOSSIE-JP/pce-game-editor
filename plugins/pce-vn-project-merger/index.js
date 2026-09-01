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

function mergeOptions(payload = {}) {
  const projects = (Array.isArray(payload.projects) ? payload.projects : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return {
    ...payload,
    root: String(payload.root || '').trim(),
    projects,
  };
}

async function discoverVnProjectMergeCandidates(payload = {}, context = {}) {
  try {
    const result = await appModule(context).discoverProjectMergeCandidates({
      root: String(payload.root || '').trim(),
    });
    const level = result.ok ? 'info' : 'error';
    context.logger?.[level]?.(
      result.ok
        ? `VN project候補探索: ${result.candidates?.length || 0} projects`
        : `VN project候補探索失敗: ${result.error || 'unknown error'}`,
    );
    return result;
  } catch (error) {
    context.logger?.error?.(`VN project候補探索失敗: ${error.message || error}`);
    return { ok: false, error: String(error.message || error), candidates: [] };
  }
}

function inspectVnProjectMerge(payload = {}, context = {}) {
  try {
    const currentProject = requireCurrentProject(context);
    if (payload.contextOnly === true) return { ok: true, currentProject };
    const result = appModule(context).inspectProjectMerge(mergeOptions(payload));
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
    const result = appModule(context).applyProjectMerge(mergeOptions(payload));
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
  discoverVnProjectMergeCandidates,
  inspectVnProjectMerge,
  applyVnProjectMerge,
};
