'use strict';

/**
 * build-system.js
 * SGDK を使ったメガドライブゲームのビルドシステム
 * Main process 専用モジュール
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const setupManager = require('./setup-manager');

const DEFAULT_PROJECT_NAME = 'new_project';
const LEGACY_SAMPLE_PROJECT_NAME = 'sample';
const TEMPLATE_PROJECT_PREFIX = 'template_';
const MAX_RECENT_PROJECTS = 10;
const EMPTY_PROJECT_SOURCE = `#include <genesis.h>

int main(bool hardReset)
{
    (void)hardReset;

    while (TRUE)
    {
        SYS_doVBlankProcess();
    }

    return 0;
}
`;

function getProjectsRootDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'projects');
  }
  return path.join(__dirname, 'projects');
}

function getTemplatesRootDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'template');
  }
  return path.join(__dirname, 'template');
}

function getLegacySampleProjectDir() {
  return path.join(__dirname, 'sample');
}

function getDefaultProjectDir() {
  return path.join(getProjectsRootDir(), DEFAULT_PROJECT_NAME);
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'editor-state.json');
}

function readEditorState() {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch (_err) {
    return {};
  }
}

function getProjectConfigPath(projectDir) {
  return path.join(path.resolve(projectDir), 'project.json');
}

function hasProjectConfig(projectDir) {
  return fs.existsSync(getProjectConfigPath(projectDir));
}

function isTemplateProjectName(projectName) {
  return String(projectName || '').startsWith(TEMPLATE_PROJECT_PREFIX);
}

function isBundledTemplateLikeProjectName(projectName) {
  const value = String(projectName || '');
  return value.startsWith(TEMPLATE_PROJECT_PREFIX) || value.startsWith('sample_');
}

function projectPathKey(projectDir) {
  return path.resolve(projectDir).toLowerCase();
}

function normalizeRecentProjectEntry(entry) {
  const rawDir = typeof entry === 'string' ? entry : entry?.projectDir;
  if (!rawDir) return null;
  const projectDir = path.resolve(String(rawDir));
  const projectName = String(entry?.projectName || path.basename(projectDir));
  const title = String(entry?.title || projectName);
  const lastOpenedAt = String(entry?.lastOpenedAt || entry?.openedAt || '');
  return { projectDir, projectName, title, lastOpenedAt };
}

function normalizeRecentProjects(entries = []) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const normalized = [];
  entries.forEach((entry) => {
    const item = normalizeRecentProjectEntry(entry);
    if (!item) return;
    const key = projectPathKey(item.projectDir);
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(item);
  });
  return normalized.slice(0, MAX_RECENT_PROJECTS);
}

function buildRecentProjectEntry(projectDir) {
  const resolved = path.resolve(projectDir);
  const cfg = loadProjectConfigFromDir(resolved);
  const projectName = path.basename(resolved);
  return {
    projectDir: resolved,
    projectName,
    title: cfg.title || cfg.romName || projectName,
    lastOpenedAt: new Date().toISOString(),
  };
}

function mergeRecentProject(state, projectDir) {
  const entry = buildRecentProjectEntry(projectDir);
  const key = projectPathKey(entry.projectDir);
  const rest = normalizeRecentProjects(state.recentProjects || [])
    .filter((item) => projectPathKey(item.projectDir) !== key);
  return [entry, ...rest].slice(0, MAX_RECENT_PROJECTS);
}

function getRecentProjects() {
  const state = readEditorState();
  const currentProjectDir = path.resolve(getProjectDir());
  const entries = normalizeRecentProjects(state.recentProjects || []);
  const existingEntries = entries.filter((entry) => fs.existsSync(entry.projectDir) && hasProjectConfig(entry.projectDir));
  if (existingEntries.length !== entries.length) {
    writeEditorState({
      ...state,
      recentProjects: existingEntries,
    });
  }
  return existingEntries.map((entry) => {
    const exists = fs.existsSync(entry.projectDir) && hasProjectConfig(entry.projectDir);
    const cfg = exists ? loadProjectConfigFromDir(entry.projectDir) : {};
    const projectName = path.basename(entry.projectDir);
    return {
      ...entry,
      projectName,
      title: cfg.title || cfg.romName || entry.title || projectName,
      exists,
      current: exists && path.resolve(entry.projectDir) === currentProjectDir,
    };
  });
}

function getProjectStartupState() {
  const state = readEditorState();
  const savedProjectDir = state.currentProjectDir ? path.resolve(state.currentProjectDir) : '';
  const hasSavedProject = Boolean(savedProjectDir);
  const savedProjectExists = hasSavedProject && fs.existsSync(savedProjectDir) && hasProjectConfig(savedProjectDir);
  return {
    hasSavedProject,
    savedProjectDir,
    savedProjectExists,
    requiresProjectSelection: !savedProjectExists,
    defaultProjectDir: getDefaultProjectDir(),
    projectsRootDir: ensureProjectsRootDir(),
    recentProjects: getRecentProjects(),
  };
}

function writeEditorState(nextState) {
  const statePath = getStatePath();
  ensureDirSync(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2), 'utf-8');
}

function getProjectDir() {
  const state = readEditorState();
  if (state.currentProjectDir && fs.existsSync(state.currentProjectDir) && hasProjectConfig(state.currentProjectDir)) {
    return path.resolve(state.currentProjectDir);
  }

  const defaultProjectDir = getDefaultProjectDir();
  if (fs.existsSync(defaultProjectDir) && hasProjectConfig(defaultProjectDir)) {
    return defaultProjectDir;
  }

  const legacySampleDir = getLegacySampleProjectDir();
  if (fs.existsSync(legacySampleDir) && hasProjectConfig(legacySampleDir)) {
    return legacySampleDir;
  }

  return defaultProjectDir;
}

function setProjectDir(projectDir) {
  const resolved = path.resolve(projectDir);
  const state = readEditorState();
  writeEditorState({
    ...state,
    currentProjectDir: resolved,
    recentProjects: mergeRecentProject(state, resolved),
  });
  return resolved;
}

function ensureDirSync(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function ensureProjectsRootDir() {
  const root = getProjectsRootDir();
  ensureDirSync(root);
  return root;
}

function toAsciiPrintable(value) {
  return String(value || '').replace(/[^\x20-\x7E]/g, ' ');
}

function fitFixed(value, length) {
  const s = toAsciiPrintable(value);
  if (s.length >= length) {
    return s.slice(0, length);
  }
  return s.padEnd(length, ' ');
}

function buildRomHeaderSource(config = {}) {
  const title = fitFixed(config.title || config.romName || 'MY GAME', 48);
  const serial = fitFixed(config.serial || 'GM 00000000-00', 14);
  const region = fitFixed(config.region || 'JUE', 16);
  const author = fitFixed(config.author || 'AUTHOR', 10);
  const copyright = fitFixed(`(C)${author}`, 16);
  const memo = fitFixed(`${title.slice(0, 32)} PROGRAM`, 40);

  return `#include "genesis.h"

__attribute__((externally_visible))
const ROMHeader rom_header = {
#if (ENABLE_BANK_SWITCH != 0)
    "SEGA SSF        ",
#elif (MODULE_MEGAWIFI != 0)
    "SEGA MEGAWIFI   ",
#else
    "SEGA MEGA DRIVE ",
#endif
    "${copyright}",
    "${title}",
    "${title}",
    "${serial}",
    0x000,
    "JD              ",
    0x00000000,
#if (ENABLE_BANK_SWITCH != 0)
    0x003FFFFF,
#else
    0x000FFFFF,
#endif
    0xE0FF0000,
    0xE0FFFFFF,
    "RA",
    0xF820,
    0x00200000,
    0x0020FFFF,
    "            ",
    "${memo}",
    "${region}"
};
`;
}

function getSampleSourcePath() {
  const currentRootSample = path.join(getTemplatesRootDir(), 'template_slideshow', 'src', 'main.c');
  if (fs.existsSync(currentRootSample)) {
    return currentRootSample;
  }
  return path.join(getLegacySampleProjectDir(), 'src', 'main.c');
}

function getSampleSourceCode() {
  const samplePath = getSampleSourcePath();
  if (fs.existsSync(samplePath)) {
    return fs.readFileSync(samplePath, 'utf-8');
  }
  return 'int main(void) { return 0; }\n';
}

function ensureProjectStructure(projectDir, config = {}, options = {}) {
  ensureDirSync(projectDir);
  ensureDirSync(path.join(projectDir, 'src'));
  ensureDirSync(path.join(projectDir, 'src', 'boot'));
  ensureDirSync(path.join(projectDir, 'res'));
  ensureDirSync(path.join(projectDir, 'out'));

  const srcPath = path.join(projectDir, 'src', 'main.c');
  const resPath = path.join(projectDir, 'res', 'resources.res');
  const romHeadPath = path.join(projectDir, 'src', 'boot', 'rom_head.c');

  if (options.overwriteSource || !fs.existsSync(srcPath)) {
    fs.writeFileSync(srcPath, options.sourceCode || getSampleSourceCode(), 'utf-8');
  }

  if (!fs.existsSync(resPath)) {
    fs.writeFileSync(resPath, '', 'utf-8');
  }

  if (options.overwriteRomHeader || !fs.existsSync(romHeadPath)) {
    fs.writeFileSync(romHeadPath, buildRomHeaderSource(config), 'utf-8');
  }

  const meta = {
    coreId: config.coreId || 'mega-drive',
    title: config.title || config.romName || 'MY GAME',
    author: config.author || 'AUTHOR',
    serial: config.serial || 'GM 00000000-00',
    region: config.region || 'JUE',
    generatedAt: new Date().toISOString(),
  };
  if (config.pluginRoles && typeof config.pluginRoles === 'object') {
    meta.pluginRoles = { ...config.pluginRoles };
  }
  if (config.pluginSettings && typeof config.pluginSettings === 'object') {
    meta.pluginSettings = { ...config.pluginSettings };
  }
  const cfgPath = path.join(projectDir, 'project.json');
  if (options.overwriteConfig || !fs.existsSync(cfgPath)) {
    let existing = {};
    if (fs.existsSync(cfgPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
      } catch (_) {
        existing = {};
      }
    }
    const merged = normalizeProjectConfigForSave(Object.assign({}, existing, meta));
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf-8');
  }

  return { projectDir, srcPath, resPath, romHeadPath, configPath: cfgPath };
}

function getProjectInfo() {
  const projectDir = getProjectDir();
  const config = loadProjectConfig();
  return {
    projectDir,
    projectName: path.basename(projectDir),
    title: config.title || config.romName || 'MY GAME',
    defaultProjectDir: getDefaultProjectDir(),
    projectsRootDir: ensureProjectsRootDir(),
  };
}

function listProjects() {
  const root = ensureProjectsRootDir();
  const currentProjectDir = path.resolve(getProjectDir());
  const projects = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !isBundledTemplateLikeProjectName(entry.name))
    .filter((entry) => hasProjectConfig(path.join(root, entry.name)))
    .map((entry) => {
      const projectDir = path.join(root, entry.name);
      const config = loadProjectConfigFromDir(projectDir);
      return {
        projectDir,
        projectName: entry.name,
        title: config.title || config.romName || entry.name,
        current: path.resolve(projectDir) === currentProjectDir,
      };
    })
    .sort((left, right) => left.projectName.localeCompare(right.projectName, 'ja'));

  return {
    projectsRootDir: root,
    currentProjectDir,
    projects,
    recentProjects: getRecentProjects(),
    templates: listProjectTemplates(),
  };
}

function listProjectTemplates() {
  const root = getTemplatesRootDir();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => isTemplateProjectName(entry.name))
    .filter((entry) => hasProjectConfig(path.join(root, entry.name)))
    .map((entry) => {
      const projectDir = path.join(root, entry.name);
      const config = loadProjectConfigFromDir(projectDir);
      const pluginRoles = (config.pluginRoles && typeof config.pluginRoles === 'object') ? config.pluginRoles : {};
      return {
        templateId: entry.name,
        projectDir,
        projectName: entry.name,
        title: config.title || config.romName || entry.name,
        builderPlugin: pluginRoles.builder || null,
      };
    })
    .sort((left, right) => left.projectName.localeCompare(right.projectName, 'ja'));
}

function createProject(projectDir, config = {}, sourceCode) {
  const resolved = path.resolve(projectDir);
  if (fs.existsSync(resolved)) {
    const children = fs.readdirSync(resolved);
    if (children.length > 0) {
      throw new Error(`project directory already exists and is not empty: ${resolved}`);
    }
  }

  const result = ensureProjectStructure(resolved, config, {
    sourceCode: sourceCode || EMPTY_PROJECT_SOURCE,
    overwriteSource: true,
    overwriteRomHeader: true,
    overwriteConfig: true,
  });
  setProjectDir(resolved);
  return result;
}

function normalizeProjectName(projectName) {
  const normalizedName = String(projectName || '').trim();
  if (!normalizedName) {
    throw new Error('project name is empty');
  }
  if (
    normalizedName === '.' ||
    normalizedName === '..' ||
    normalizedName.includes('..') ||
    /[\\/:*?"<>|]/.test(normalizedName)
  ) {
    throw new Error(`invalid project name: ${normalizedName}`);
  }
  return normalizedName;
}

function createProjectInRoot(projectName, config = {}, sourceCode) {
  return createProjectInParent(ensureProjectsRootDir(), projectName, config, sourceCode);
}

function resolveTemplateProjectDir(templateId) {
  const normalizedId = normalizeProjectName(templateId);
  if (!isTemplateProjectName(normalizedId)) {
    throw new Error(`invalid template project: ${normalizedId}`);
  }
  const templateDir = path.join(getTemplatesRootDir(), normalizedId);
  if (!fs.existsSync(templateDir) || !hasProjectConfig(templateDir)) {
    throw new Error(`template project not found: ${normalizedId}`);
  }
  return templateDir;
}

function copyTemplateProject(templateDir, targetDir) {
  ensureDirSync(targetDir);
  fs.readdirSync(templateDir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === 'out') return;
    const source = path.join(templateDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateProject(source, target);
      return;
    }
    if (entry.isFile()) {
      ensureDirSync(path.dirname(target));
      fs.copyFileSync(source, target);
    }
  });
}

function createProjectFromTemplate(projectDir, templateId, config = {}) {
  const resolved = path.resolve(projectDir);
  if (fs.existsSync(resolved)) {
    const children = fs.readdirSync(resolved);
    if (children.length > 0) {
      throw new Error(`project directory already exists and is not empty: ${resolved}`);
    }
  }

  const templateDir = resolveTemplateProjectDir(templateId);
  const templateConfig = loadProjectConfigFromDir(templateDir);
  const nextConfig = {
    ...templateConfig,
    ...(config || {}),
  };
  if (templateConfig.pluginRoles && typeof templateConfig.pluginRoles === 'object' && !config.pluginRoles) {
    nextConfig.pluginRoles = { ...templateConfig.pluginRoles };
  }

  copyTemplateProject(templateDir, resolved);
  const result = ensureProjectStructure(resolved, nextConfig, {
    overwriteSource: false,
    overwriteRomHeader: true,
    overwriteConfig: true,
  });
  setProjectDir(resolved);
  return result;
}

function createProjectInParent(parentDir, projectName, config = {}, sourceCode = null, options = {}) {
  const normalizedName = normalizeProjectName(projectName);
  const parent = parentDir ? path.resolve(parentDir) : ensureProjectsRootDir();
  ensureDirSync(parent);
  const projectDir = path.join(parent, normalizedName);
  const templateId = String(options?.templateId || '').trim();
  if (templateId) {
    return createProjectFromTemplate(projectDir, templateId, config);
  }
  return createProject(projectDir, config, sourceCode || EMPTY_PROJECT_SOURCE);
}

function openProject(projectDir) {
  const resolved = path.resolve(projectDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`project directory not found: ${resolved}`);
  }
  if (!hasProjectConfig(resolved)) {
    throw new Error(`project.json not found: ${resolved}`);
  }

  const cfg = loadProjectConfigFromDir(resolved);
  ensureProjectStructure(resolved, cfg, {
    overwriteSource: false,
    overwriteRomHeader: false,
    overwriteConfig: false,
  });
  setProjectDir(resolved);
  return getProjectInfo();
}

function openProjectByName(projectName) {
  const normalizedName = normalizeProjectName(projectName);
  return openProject(path.join(ensureProjectsRootDir(), normalizedName));
}

function getBuildRuntimeDir() {
  return path.join(app.getPath('home'), '.md-game-editor-runtime');
}

function ensurePathAlias(targetPath, aliasPath) {
  const resolvedTarget = path.resolve(targetPath);
  ensureDirSync(path.dirname(aliasPath));

  if (fs.existsSync(aliasPath)) {
    try {
      const resolvedAlias = fs.realpathSync(aliasPath);
      if (resolvedAlias === resolvedTarget) {
        return aliasPath;
      }
    } catch (_err) {
      // recreate below
    }
    fs.rmSync(aliasPath, { recursive: true, force: true });
  }

  fs.symlinkSync(
    resolvedTarget,
    aliasPath,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  return aliasPath;
}

function createBuildPaths(projectDir, sgdkPath) {
  const runtimeDir = getBuildRuntimeDir();
  ensureDirSync(runtimeDir);

  if (!/\s/.test(projectDir) && !/\s/.test(sgdkPath)) {
    return { projectDir, sgdkPath };
  }

  return {
    projectDir: ensurePathAlias(projectDir, path.join(runtimeDir, 'project')),
    sgdkPath: ensurePathAlias(sgdkPath, path.join(runtimeDir, 'sgdk')),
  };
}

function resolveMakeCommand(toolchainPath, isWin) {
  if (!toolchainPath) return 'make';

  // Detect if this is Marsdev or SGDK by checking for marsdev-specific binaries
  const isMarsdev = toolchainPath.includes('marsdev');

  let candidates;
  if (isMarsdev || !isWin) {
    // Marsdev or Unix-like: native binaries (no .exe)
    candidates = [
      path.join(toolchainPath, 'bin', 'make'),
      path.join(toolchainPath, 'make'),
    ];
  } else {
    // Windows SGDK: .exe binaries
    candidates = [
      path.join(toolchainPath, 'bin', 'make', 'make.exe'),
      path.join(toolchainPath, 'bin', 'make.exe'),
    ];
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'make';
}

function sameRealPath(a, b) {
  if (!a || !b) return false;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function getSupplementalToolPaths(toolchainPath, platform = process.platform) {
  if (platform === 'win32' || !toolchainPath) return [];
  const sgdkPath = setupManager.getSgdkPath();
  if (!sameRealPath(toolchainPath, sgdkPath)) return [];

  const marsdevPath = setupManager.getMarsdevPath();
  if (!marsdevPath) return [];

  const candidates = [
    path.join(marsdevPath, 'bin'),
    path.join(path.dirname(marsdevPath), 'bin'),
  ];

  return candidates.filter((candidate, index) => {
    if (!candidate || !fs.existsSync(candidate)) return false;
    return candidates.findIndex((item) => sameRealPath(item, candidate)) === index;
  });
}

function getMarsdevRuntimePathForBuild(toolchainPath, platform = process.platform) {
  if (platform === 'win32' || !toolchainPath) return null;
  const marsdevPath = setupManager.getMarsdevPath();
  if (!marsdevPath) return null;
  if (sameRealPath(toolchainPath, marsdevPath)) return marsdevPath;

  const marsdevBin = path.join(marsdevPath, 'bin');
  if (getSupplementalToolPaths(toolchainPath, platform).some((item) => sameRealPath(item, marsdevBin))) {
    return marsdevPath;
  }
  return null;
}

function shouldUseSgdkMarsdevNoLtoMakefile(toolchainPath, platform = process.platform) {
  if (platform === 'win32' || !toolchainPath) return false;
  const sgdkPath = setupManager.getSgdkPath();
  return sameRealPath(toolchainPath, sgdkPath)
    && !!getMarsdevRuntimePathForBuild(toolchainPath, platform);
}

function createSgdkMarsdevNoLtoMakefile(baseMakefilePath) {
  const source = fs.readFileSync(baseMakefilePath, 'utf-8')
    .replace(
      'include $(GDK)/common.mk',
      [
        'include $(GDK)/common.mk',
        '',
        'JAVA := java -Djava.awt.headless=true',
        'SIZEBND := $(JAVA) -jar $(BIN)/sizebnd.jar',
        'RESCOMP := $(JAVA) -jar $(BIN)/rescomp.jar',
      ].join('\n')
    )
    .replace(/ -fuse-linker-plugin/g, '')
    .replace(/ -flto=auto/g, '')
    .replace(/ -flto/g, '')
    .replace(/ -ffat-lto-objects/g, '')
    .replace(
      '$(CC) -m68000 -B$(BIN) -n -T $(GDK)/md.ld',
      '$(CC) -m68000 -B$(BIN) -fno-lto -n -T $(GDK)/md.ld'
    );
  const runtimeDir = getBuildRuntimeDir();
  ensureDirSync(runtimeDir);
  const outputPath = path.join(runtimeDir, 'sgdk-marsdev-nolto.makefile.gen');
  fs.writeFileSync(outputPath, source, 'utf-8');
  return outputPath;
}

function appendUniquePathParts(parts) {
  const result = [];
  parts.filter(Boolean).forEach((part) => {
    const duplicate = result.some((existing) => sameRealPath(existing, part));
    if (!duplicate) result.push(part);
  });
  return result;
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function sanitizeBuildLogLine(value) {
  return stripAnsi(value).replace(/\r/g, '');
}

function isBuildStderrErrorLine(line) {
  return /\berror:/i.test(line)
    || /\bfatal error\b/i.test(line)
    || /\binternal compiler error\b/i.test(line)
    || /\berror on line\b/i.test(line)
    || /^make(?:\[\d+\])?: \*\*\*/i.test(line)
    || /^collect2: error/i.test(line)
    || /^lto-wrapper: fatal error/i.test(line);
}

function isBuildStderrWarningLine(line) {
  return /\bwarning:/i.test(line)
    || /\bwarning\b/i.test(line)
    || /\bnote:/i.test(line);
}

function isBuildStderrDiagnosticContextLine(line) {
  return /^In file included from /.test(line)
    || /^\s+from\s/.test(line)
    || /^\s*\d+\s+\|/.test(line)
    || /^\s*\|/.test(line)
    || /^\s*(?:\^|~)+/.test(line);
}

function classifyBuildStderrLine(value, previousDiagnosticLevel = 'error') {
  const line = sanitizeBuildLogLine(value);
  if (/Error\s+\d+\s+\(ignored\)/i.test(line)) {
    return { level: 'info', diagnosticLevel: previousDiagnosticLevel };
  }
  if (isBuildStderrErrorLine(line)) {
    return { level: 'error', diagnosticLevel: 'error' };
  }
  if (isBuildStderrWarningLine(line)) {
    return { level: 'warn', diagnosticLevel: 'warn' };
  }
  if (isBuildStderrDiagnosticContextLine(line)) {
    const level = previousDiagnosticLevel === 'warn' ? 'warn' : 'info';
    return { level, diagnosticLevel: previousDiagnosticLevel };
  }
  return { level: 'error', diagnosticLevel: 'error' };
}

function normalizeMakeVariables(makeVariables = {}) {
  const result = [];
  Object.entries(makeVariables || {}).forEach(([key, value]) => {
    const name = String(key || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    if (value == null) return;
    const text = String(value);
    if (/[\r\n]/.test(text)) return;
    result.push(`${name}=${text}`);
  });
  return result;
}

function normalizeBuildEnv(env = {}) {
  const result = {};
  const blockedNames = new Set(['PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']);
  Object.entries(env || {}).forEach(([key, value]) => {
    const name = String(key || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    if (blockedNames.has(name.toUpperCase())) return;
    if (value == null) return;
    const text = String(value);
    if (/[\r\n]/.test(text)) return;
    result[name] = text;
  });
  return result;
}

function normalizeMakeTargets(makeTargets) {
  if (!Array.isArray(makeTargets) || makeTargets.length === 0) {
    return ['release'];
  }
  const targets = makeTargets
    .map((target) => String(target || '').trim())
    .filter((target) => /^[A-Za-z0-9_-]+$/.test(target));
  return targets.length > 0 ? Array.from(new Set(targets)) : ['release'];
}

// -------------------------------------------------------------- generation --

/**
 * SGDK プロジェクトのファイル構成を生成する
 * @param {string} sourceCode - main.c のソースコード
 * @param {object} config     - { title, author, serial, region }
 */
function generateProject(sourceCode, config = {}) {
  const projectDir = getProjectDir();
  const result = ensureProjectStructure(projectDir, config, {
    sourceCode,
    overwriteSource: true,
    overwriteRomHeader: true,
    overwriteConfig: true,
  });
  return { projectDir, srcPath: result.srcPath };
}

/**
 * src/main.c を上書きせずプロジェクト構造 (Makefile, rom_header.s 等) だけ整備する。
 * プラグイン生成済みソースをそのままビルドするときに使う。
 * @param {object} config - { title, author, serial, region }
 */
function generateProjectStructureOnly(config = {}) {
  const projectDir = getProjectDir();
  const result = ensureProjectStructure(projectDir, config, {
    overwriteSource: false,
    overwriteRomHeader: true,
    overwriteConfig: true,
  });
  return { projectDir, srcPath: result.srcPath };
}

// ------------------------------------------------------------------- build --

/**
 * SGDK ビルドを実行する
 * @param {string} sgdkPath     - SGDK のルートディレクトリ
 * @param {string} javaPath     - java 実行ファイルのパス（または 'java'）
 * @param {function} onLog      - (line: string, level: 'info'|'warn'|'error') => void
 * @param {{ makeVariables?: Record<string,string>, env?: Record<string,string>, makeTargets?: string[], skipClean?: boolean }} options
 * @returns {Promise<{success, romPath, romSize, error}>}
 */
function buildProject(sgdkPath, javaPath, onLog, options = {}) {
  return new Promise((resolve) => {
    const projectDir = getProjectDir();
    const log = (msg, level = 'info') => onLog && onLog(msg, level);

    // If no sgdkPath provided, auto-detect the active toolchain
    let toolchainPath = sgdkPath;
    if (!toolchainPath) {
      toolchainPath = setupManager.getToolchainDir();
    }

    if (!toolchainPath || !fs.existsSync(toolchainPath)) {
      const msg = `ツールチェーンが見つかりません: ${toolchainPath || '(未設定)'}. SGDK または Marsdev をセットアップしてください。`;
      log(msg, 'error');
      resolve({ success: false, error: msg });
      return;
    }

    let buildPaths = { projectDir, sgdkPath: toolchainPath };
    try {
      buildPaths = createBuildPaths(projectDir, toolchainPath);
    } catch (err) {
      log(`ビルド用エイリアスの作成に失敗したため元のパスを使用します: ${err.message}`, 'error');
    }

    // macOS + Marsdev: dyld エラーを避けるため、実行前に gettext 参照の整合性を確認・補正する。
    if (process.platform === 'darwin') {
      const marsdevRuntimePath = getMarsdevRuntimePathForBuild(buildPaths.sgdkPath, process.platform);
      if (marsdevRuntimePath) {
        const fix = setupManager.fixMarsdevMacosGettext(marsdevRuntimePath);
        if (!fix.ok) {
          const msg = `Marsdev 実行前チェックに失敗: ${fix.error}`;
          log(msg, 'error');
          resolve({ success: false, error: msg });
          return;
        }
        if (fix.patched > 0) {
          log(`Marsdev の macOS ライブラリ参照を自動修正しました (${fix.patched} files)`);
        }
      }
    }

    let makefileGen = path.join(buildPaths.sgdkPath, 'makefile.gen');
    if (!fs.existsSync(makefileGen)) {
      const msg = `makefile.gen が見つかりません: ${makefileGen}`;
      log(msg, 'error');
      resolve({ success: false, error: msg });
      return;
    }
    if (shouldUseSgdkMarsdevNoLtoMakefile(buildPaths.sgdkPath, process.platform)) {
      makefileGen = createSgdkMarsdevNoLtoMakefile(makefileGen);
      log('SGDK 2.11 と Marsdev GCC の LTO 互換性回避のため、LTO 無効のビルドルールを使用します');
    }

    const outDir = path.join(projectDir, 'out');
    ensureDirSync(outDir);

    const isWin = process.platform === 'win32';
    let command, args, spawnEnv;

    // ツールチェーン内のバイナリをPATHに追加
    spawnEnv = { ...process.env };
    const pathParts = appendUniquePathParts([
      path.join(buildPaths.sgdkPath, 'bin'),
      ...getSupplementalToolPaths(buildPaths.sgdkPath, process.platform),
      spawnEnv.PATH || '',
    ]);
    if (isWin) {
      pathParts.splice(1, 0, path.join(buildPaths.sgdkPath, 'bin', 'gcc', 'bin'));
    }
    spawnEnv.PATH = pathParts.filter(Boolean).join(path.delimiter);

    // 環境変数に java パスを追加
    if (javaPath && javaPath !== 'java') {
      spawnEnv.JAVA_HOME = path.dirname(path.dirname(javaPath));
      spawnEnv.PATH = `${path.dirname(javaPath)}${path.delimiter}${spawnEnv.PATH}`;
    }
    spawnEnv = { ...spawnEnv, ...normalizeBuildEnv(options.env) };

    if (isWin) {
      command = resolveMakeCommand(buildPaths.sgdkPath, true);
      // `makefile.gen` runs many tools through sh, so GDK must use POSIX-style separators on Windows.
      const sgdkPosix = buildPaths.sgdkPath.replace(/\\/g, '/');
      const sgdkWin = buildPaths.sgdkPath.replace(/\//g, '\\');
      args = ['-f', makefileGen.replace(/\//g, '\\'), `GDK=${sgdkPosix}`, `GDK_WIN=${sgdkWin}`];
    } else {
      command = resolveMakeCommand(buildPaths.sgdkPath, false);
      args = ['-f', makefileGen, `GDK=${buildPaths.sgdkPath}`];
    }

    log(`プロジェクトDir: ${projectDir}`);
    if (buildPaths.projectDir !== projectDir || buildPaths.sgdkPath !== toolchainPath) {
      log(`ビルド用エイリアスを使用: project=${buildPaths.projectDir}, gdk=${buildPaths.sgdkPath}`);
    }

    const makeVariableArgs = normalizeMakeVariables(options.makeVariables);
    const makeTargets = normalizeMakeTargets(options.makeTargets);
    const cleanTargets = options.skipClean ? [] : ['clean'];
    const targetsToRun = [...cleanTargets, ...makeTargets];

    function runMakeTarget(target, onExit) {
      const targetArgs = [...args, ...makeVariableArgs, target];
      log(`${target.toUpperCase()} を開始: ${command} ${targetArgs.join(' ')}`);
      let stderrDiagnosticLevel = 'error';

      const proc = spawn(command, targetArgs, {
        cwd: buildPaths.projectDir,
        env: spawnEnv,
        windowsHide: true,
      });

      proc.stdout.on('data', (data) => {
        data.toString().split('\n').forEach((line) => {
          const cleanLine = sanitizeBuildLogLine(line);
          if (cleanLine.trim()) log(cleanLine, 'info');
        });
      });

      proc.stderr.on('data', (data) => {
        data.toString().split('\n').forEach((line) => {
          const cleanLine = sanitizeBuildLogLine(line);
          if (!cleanLine.trim()) return;
          const classified = classifyBuildStderrLine(cleanLine, stderrDiagnosticLevel);
          stderrDiagnosticLevel = classified.diagnosticLevel;
          log(cleanLine, classified.level);
        });
      });

      proc.on('error', (err) => {
        const msg = `${target.toUpperCase()} プロセスの起動に失敗: ${err.message}`;
        log(msg, 'error');
        resolve({ success: false, error: msg });
      });

      proc.on('exit', (code) => {
        onExit(code);
      });
    }

    function finishBuild(exitCode) {
      if (exitCode === 0) {
        const romCandidates = [
          path.join(outDir, 'rom.bin'),
          path.join(buildPaths.projectDir, 'out', 'rom.bin'),
        ];
        const romPath = romCandidates.find((p) => fs.existsSync(p));
        let romSize = null;
        if (romPath) {
          romSize = fs.statSync(romPath).size;
          log(`ビルド成功! ROM: ${romPath} (${(romSize / 1024).toFixed(1)} KB)`);
          resolve({ success: true, romPath, romSize });
        } else {
          const msg = 'ビルドは成功しましたが rom.bin が見つかりません';
          log(msg, 'error');
          resolve({ success: false, error: msg });
        }
      } else {
        const msg = `ビルド失敗 (exit code: ${exitCode})`;
        log(msg, 'error');
        resolve({ success: false, error: msg });
      }
    }

    function runTargets(index = 0) {
      const target = targetsToRun[index];
      if (!target) {
        finishBuild(0);
        return;
      }
      runMakeTarget(target, (code) => {
        if (code !== 0) {
          const msg = `${target.toUpperCase()} 失敗 (exit code: ${code})`;
          log(msg, 'error');
          resolve({ success: false, error: msg });
          return;
        }
        if (index === targetsToRun.length - 1) {
          finishBuild(code);
          return;
        }
        runTargets(index + 1);
      });
    }

    runTargets();
  });
}

// ---------------------------------------------------------- source loading --

function loadCurrentSource() {
  const srcPath = path.join(getProjectDir(), 'src', 'main.c');
  if (fs.existsSync(srcPath)) {
    return fs.readFileSync(srcPath, 'utf-8');
  }
  return null;
}

function getLastRomPath() {
  const romPath = path.join(getProjectDir(), 'out', 'rom.bin');
  return fs.existsSync(romPath) ? romPath : null;
}

function loadProjectConfigFromDir(projectDir) {
  const cfgPath = path.join(projectDir, 'project.json');
  if (fs.existsSync(cfgPath)) {
    try { return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); }
    catch { return {}; }
  }
  return {};
}

function loadProjectConfig() {
  return loadProjectConfigFromDir(getProjectDir());
}

function writeProjectRomHeader(projectDir, config = {}) {
  const resolved = path.resolve(projectDir);
  ensureDirSync(path.join(resolved, 'src', 'boot'));
  const romHeadPath = path.join(resolved, 'src', 'boot', 'rom_head.c');
  fs.writeFileSync(romHeadPath, buildRomHeaderSource(config), 'utf-8');
  return romHeadPath;
}

function normalizeProjectConfigForSave(config = {}) {
  const next = { ...(config || {}) };
  delete next.builderPlugin;
  delete next.emulatorPlugin;
  return next;
}

function saveProjectConfig(patch) {
  const projectDir = getProjectDir();
  ensureDirSync(projectDir);
  const cfgPath = path.join(projectDir, 'project.json');
  const current = loadProjectConfig();
  const merged = normalizeProjectConfigForSave(Object.assign({}, current, patch));
  fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf-8');
  writeProjectRomHeader(projectDir, merged);
  return merged;
}

function getPluginRoles() {
  const cfg = loadProjectConfig();
  return (cfg.pluginRoles && typeof cfg.pluginRoles === 'object') ? cfg.pluginRoles : {};
}

function getPluginRole(roleId) {
  const role = String(roleId || '').trim();
  if (!role) return null;
  const cfg = loadProjectConfig();
  const pluginRoles = (cfg.pluginRoles && typeof cfg.pluginRoles === 'object') ? cfg.pluginRoles : {};
  return pluginRoles[role] || null;
}

function setPluginRole(roleId, id) {
  const role = String(roleId || '').trim();
  if (!role) return loadProjectConfig();
  const cfg = loadProjectConfig();
  const nextRoles = {
    ...((cfg.pluginRoles && typeof cfg.pluginRoles === 'object') ? cfg.pluginRoles : {}),
    [role]: id || null,
  };
  return saveProjectConfig({ pluginRoles: nextRoles });
}

module.exports = {
  getDefaultProjectDir,
  getTemplatesRootDir,
  getProjectStartupState,
  getProjectDir,
  setProjectDir,
  getProjectInfo,
  getProjectsRootDir,
  listProjects,
  listProjectTemplates,
  getRecentProjects,
  createProject,
  createProjectInRoot,
  createProjectInParent,
  createProjectFromTemplate,
  openProject,
  openProjectByName,
  generateProject,
  generateProjectStructureOnly,
  buildProject,
  loadCurrentSource,
  getLastRomPath,
  loadProjectConfig,
  saveProjectConfig,
  writeProjectRomHeader,
  normalizeProjectConfigForSave,
  getPluginRoles,
  getPluginRole,
  setPluginRole,
  getSampleSourceCode,
  stripAnsi,
  sanitizeBuildLogLine,
  classifyBuildStderrLine,
  getSupplementalToolPaths,
  getMarsdevRuntimePathForBuild,
  shouldUseSgdkMarsdevNoLtoMakefile,
  createSgdkMarsdevNoLtoMakefile,
  normalizeMakeVariables,
  normalizeBuildEnv,
  normalizeMakeTargets,
};
