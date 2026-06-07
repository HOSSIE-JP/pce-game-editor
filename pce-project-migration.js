'use strict';

const fs = require('fs');
const path = require('path');
const { getCurrentAppConfig } = require('game-editor-common');

const PCE_CORE_ID = 'pc-engine';

function normalizePceCoreId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'pce' || raw === 'pcengine' || raw === 'pc-engine-core') return PCE_CORE_ID;
  return raw;
}

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {}
  return null;
}

function isPceProjectConfig(config) {
  if (!config || typeof config !== 'object') return false;
  return normalizePceCoreId(config.coreId || config.platform) === PCE_CORE_ID;
}

function copyDirNonDestructive(src, dest) {
  if (fs.existsSync(dest)) return false;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyDirNonDestructive(path.join(src, name), path.join(dest, name));
    }
    return true;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function findPceProjectDirs(sourceRoot) {
  const resolved = path.resolve(sourceRoot || '');
  if (!resolved || !fs.existsSync(resolved)) return [];
  const directConfig = readJsonIfExists(path.join(resolved, 'project.json'));
  if (isPceProjectConfig(directConfig)) return [resolved];
  return fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(resolved, entry.name))
    .filter((candidate) => isPceProjectConfig(readJsonIfExists(path.join(candidate, 'project.json'))));
}

function migratePceProjectsIfNeeded(electronApp) {
  const config = getCurrentAppConfig();
  if (!Array.isArray(config.allowedCoreIds) || !config.allowedCoreIds.includes(PCE_CORE_ID)) {
    return { ok: true, skipped: true, reason: 'pc-engine-disabled', copied: [], skippedProjects: [] };
  }

  const userData = electronApp.getPath('userData');
  const markerPath = path.join(userData, '.pce-project-migration.json');
  if (fs.existsSync(markerPath)) {
    return { ok: true, skipped: true, reason: 'already-ran', copied: [], skippedProjects: [] };
  }

  const targetRoot = path.join(userData, config.projectsRootName || 'projects');
  fs.mkdirSync(targetRoot, { recursive: true });
  const copied = [];
  const skippedProjects = [];
  const sourceRoots = Array.isArray(config.migration?.pceProjectSourceRoots)
    ? config.migration.pceProjectSourceRoots
    : [];

  for (const sourceRoot of sourceRoots) {
    for (const projectDir of findPceProjectDirs(sourceRoot)) {
      const dest = path.join(targetRoot, path.basename(projectDir));
      if (fs.existsSync(dest)) {
        skippedProjects.push({ source: projectDir, target: dest, reason: 'exists' });
        continue;
      }
      copyDirNonDestructive(projectDir, dest);
      copied.push({ source: projectDir, target: dest });
    }
  }

  fs.writeFileSync(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), copied, skippedProjects }, null, 2), 'utf-8');
  return { ok: true, copied, skippedProjects };
}

module.exports = {
  findPceProjectDirs,
  isPceProjectConfig,
  migratePceProjectsIfNeeded,
};
