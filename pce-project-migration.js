'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getCurrentAppConfig } = require('./game-editor-common');

const PCE_CORE_ID = 'pc-engine';
const LEGACY_SLIDESHOW_MAIN_SHA256 = '3b08c479a4ea18b782b22e4be7eb453defed9fd1d5b2b89d3085716328b66fb2';

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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveSlideshowTemplateMainPath(options = {}) {
  if (options.templateMainPath) return options.templateMainPath;
  const config = getCurrentAppConfig();
  const candidates = [
    config.templatesRoot ? path.join(config.templatesRoot, 'template_pce_sample', 'src', 'main.c') : '',
    config.appRoot ? path.join(config.appRoot, 'template', 'template_pce_sample', 'src', 'main.c') : '',
    path.join(__dirname, 'template', 'template_pce_sample', 'src', 'main.c'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function migrateLegacySlideshowProject(projectDir, options = {}) {
  const resolved = path.resolve(projectDir || '');
  const config = readJsonIfExists(path.join(resolved, 'project.json'));
  if (!isPceProjectConfig(config)) {
    return { projectDir: resolved, migrated: false, reason: 'not-pce-project' };
  }
  const mainPath = path.join(resolved, 'src', 'main.c');
  if (!fs.existsSync(mainPath)) {
    return { projectDir: resolved, migrated: false, reason: 'missing-main' };
  }
  const legacyHashes = new Set((options.legacyMainHashes || [LEGACY_SLIDESHOW_MAIN_SHA256]).map((hash) => String(hash || '').toLowerCase()));
  const currentHash = sha256File(mainPath);
  if (!legacyHashes.has(currentHash)) {
    return { projectDir: resolved, migrated: false, reason: 'main-modified-or-current' };
  }
  const templateMainPath = resolveSlideshowTemplateMainPath(options);
  if (!templateMainPath) {
    return { projectDir: resolved, migrated: false, reason: 'template-main-missing' };
  }
  fs.copyFileSync(templateMainPath, mainPath);
  return { projectDir: resolved, migrated: true, mainPath };
}

function migrateLegacySlideshowProjects(projectsRoot, options = {}) {
  const root = path.resolve(projectsRoot || '');
  if (!root || !fs.existsSync(root)) return [];
  return findPceProjectDirs(root)
    .map((projectDir) => migrateLegacySlideshowProject(projectDir, options))
    .filter((result) => result.migrated);
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
  const targetRoot = path.join(userData, config.projectsRootName || 'projects');
  fs.mkdirSync(targetRoot, { recursive: true });
  const legacySlideshowProjects = migrateLegacySlideshowProjects(targetRoot);
  if (fs.existsSync(markerPath)) {
    return { ok: true, skipped: true, reason: 'already-ran', copied: [], skippedProjects: [], legacySlideshowProjects };
  }

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

  legacySlideshowProjects.push(...migrateLegacySlideshowProjects(targetRoot));
  fs.writeFileSync(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), copied, skippedProjects }, null, 2), 'utf-8');
  return { ok: true, copied, skippedProjects, legacySlideshowProjects };
}

module.exports = {
  LEGACY_SLIDESHOW_MAIN_SHA256,
  findPceProjectDirs,
  isPceProjectConfig,
  migrateLegacySlideshowProject,
  migrateLegacySlideshowProjects,
  migratePceProjectsIfNeeded,
};
