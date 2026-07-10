'use strict';

const fs = require('fs');
const path = require('path');

const pceBuildSystem = require('./pce-build-system');
const pceSetupManager = require('./pce-setup-manager');
const pceAssetManager = require('./pce-asset-manager');
const { app } = require('electron');
const { filterCoresForApp, isCoreAllowed } = require('./game-editor-common');
const { migratePceProjectsIfNeeded } = require('./pce-project-migration');
const appDiagnostics = require('./app-diagnostics');

const CORE_IDS = Object.freeze({
  PC_ENGINE: 'pc-engine',
});

const PCE_CORE = Object.freeze({
  id: CORE_IDS.PC_ENGINE,
  pluginId: 'pc-engine-core',
  name: 'PC Engine',
  shortName: 'PCE',
  platform: 'pce',
  description: 'llvm-mos を標準に HuCard / Super CD-ROM2 を扱う PC Engine プロジェクト',
});

const CORES = Object.freeze([PCE_CORE]);

function normalizeCoreId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return CORE_IDS.PC_ENGINE;
  if (raw === 'pce' || raw === 'pcengine' || raw === 'pc-engine') return CORE_IDS.PC_ENGINE;
  return raw;
}

function detectCoreIdFromConfig(config = {}) {
  if (config && typeof config === 'object') {
    if (config.coreId) return normalizeCoreId(config.coreId);
    const platform = String(config.platform || '').trim().toLowerCase();
    if (platform === 'pce' || platform === 'pc-engine') return CORE_IDS.PC_ENGINE;
  }
  return '';
}

function readProjectConfig(projectDir) {
  try {
    const cfgPath = path.join(path.resolve(projectDir), 'project.json');
    if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) || {};
  } catch (err) {
    appDiagnostics.report({
      source: 'project',
      code: 'project-config-read-failed',
      level: 'error',
      error: err,
      details: { projectDir: path.resolve(projectDir || '.') },
    });
  }
  return {};
}

function getCoreIdForProjectDir(projectDir) {
  return detectCoreIdFromConfig(readProjectConfig(projectDir));
}

function getBuildSystemForCore() {
  return pceBuildSystem;
}

function getSetupManagerForCore() {
  return pceSetupManager;
}

function getActiveCoreId() {
  return CORE_IDS.PC_ENGINE;
}

function getActiveBuildSystem() {
  return pceBuildSystem;
}

function withCoreId(config = {}) {
  return { ...(config || {}), coreId: CORE_IDS.PC_ENGINE };
}

function getCore(coreId) {
  return normalizeCoreId(coreId) === CORE_IDS.PC_ENGINE ? { ...PCE_CORE } : null;
}

function listCores() {
  return filterCoresForApp(CORES).map((core) => ({ ...core }));
}

function maybeMigratePceProjects() {
  try {
    migratePceProjectsIfNeeded(app);
  } catch (err) {
    appDiagnostics.report({
      source: 'project',
      code: 'project-migration-failed',
      level: 'error',
      error: err,
    });
  }
}

function normalizeListedProject(project) {
  const projectDir = project?.projectDir || '';
  const coreId = project?.coreId || (projectDir ? getCoreIdForProjectDir(projectDir) : detectCoreIdFromConfig(project));
  return {
    ...project,
    coreId,
    coreName: coreId === CORE_IDS.PC_ENGINE ? PCE_CORE.name : '',
  };
}

function listProjects() {
  maybeMigratePceProjects();
  const pceList = isCoreAllowed(CORE_IDS.PC_ENGINE)
    ? pceBuildSystem.listProjects()
    : { projectsRootDir: pceBuildSystem.getProjectsRootDir(), projects: [], recentProjects: [], templates: [] };
  const currentProjectDir = path.resolve(getProjectDir());

  const projects = (pceList.projects || [])
    .map(normalizeListedProject)
    .filter((project) => project.coreId === CORE_IDS.PC_ENGINE)
    .map((project) => ({
      ...project,
      current: path.resolve(project.projectDir) === currentProjectDir,
    }))
    .sort((left, right) => String(left.projectName).localeCompare(String(right.projectName), 'ja'));

  const templates = (pceList.templates || [])
    .map(normalizeListedProject)
    .filter((template) => template.coreId === CORE_IDS.PC_ENGINE)
    .sort((left, right) => String(left.templateId || left.projectName).localeCompare(String(right.templateId || right.projectName), 'ja'));

  const recentProjects = (pceList.recentProjects || [])
    .map(normalizeListedProject)
    .filter((project) => project.coreId === CORE_IDS.PC_ENGINE);

  return {
    projectsRootDir: pceList.projectsRootDir,
    pceProjectsRootDir: pceList.projectsRootDir,
    currentProjectDir,
    projects,
    recentProjects,
    templates,
    cores: listCores(),
    activeCoreId: CORE_IDS.PC_ENGINE,
  };
}

function getProjectStartupState() {
  maybeMigratePceProjects();
  const state = pceBuildSystem.getProjectStartupState();
  const savedCoreId = state.savedProjectExists ? getCoreIdForProjectDir(state.savedProjectDir) : CORE_IDS.PC_ENGINE;
  const savedProjectAllowed = !state.savedProjectExists || savedCoreId === CORE_IDS.PC_ENGINE;
  return {
    ...state,
    savedProjectExists: Boolean(state.savedProjectExists && savedProjectAllowed),
    savedProjectDir: savedProjectAllowed ? state.savedProjectDir : '',
    cores: listCores(),
    activeCoreId: CORE_IDS.PC_ENGINE,
  };
}

function getProjectDir() {
  return pceBuildSystem.getProjectDir();
}

function setProjectDir(projectDir) {
  return pceBuildSystem.setProjectDir(projectDir);
}

function getProjectInfo() {
  return { ...pceBuildSystem.getProjectInfo(), coreId: CORE_IDS.PC_ENGINE, core: { ...PCE_CORE } };
}

function openProject(projectDir) {
  return { ...pceBuildSystem.openProject(projectDir), coreId: CORE_IDS.PC_ENGINE, core: { ...PCE_CORE } };
}

function openProjectByName(projectName) {
  const normalized = String(projectName || '').trim();
  return openProject(path.join(pceBuildSystem.getProjectsRootDir(), normalized));
}

function createProject(projectDir, config = {}) {
  return pceBuildSystem.createProjectFromTemplate(projectDir, 'template_pce_sample', withCoreId(config));
}

function createProjectInRoot(projectName, config = {}, sourceCode = null, options = {}) {
  return createProjectInParent(pceBuildSystem.getProjectsRootDir(), projectName, config, sourceCode, options);
}

function createProjectInParent(parentDir, projectName, config = {}, sourceCode = null, options = {}) {
  const parent = parentDir ? path.resolve(parentDir) : pceBuildSystem.getProjectsRootDir();
  const normalizedName = pceBuildSystem.normalizeProjectName(projectName);
  const templateId = String(options?.templateId || 'template_pce_sample').trim() || 'template_pce_sample';
  return pceBuildSystem.createProjectFromTemplate(path.join(parent, normalizedName), templateId, withCoreId(config));
}

function createProjectFromTemplate(projectDir, templateId, config = {}) {
  return pceBuildSystem.createProjectFromTemplate(projectDir, templateId || 'template_pce_sample', withCoreId(config));
}

function loadProjectConfig() {
  return withCoreId(pceBuildSystem.loadProjectConfig());
}

function loadProjectConfigFromDir(projectDir) {
  return withCoreId(pceBuildSystem.loadProjectConfigFromDir(projectDir));
}

function saveProjectConfig(patch = {}) {
  return withCoreId(pceBuildSystem.saveProjectConfig(withCoreId(patch)));
}

function generateProject(sourceCode, config = {}) {
  return createProject(pceBuildSystem.getDefaultProjectDir(), config, sourceCode);
}

function generateProjectStructureOnly(config = {}) {
  return pceBuildSystem.ensureProjectStructure(getProjectDir(), withCoreId({ ...loadProjectConfig(), ...config }));
}

function loadCurrentSource() {
  return pceBuildSystem.loadCurrentSource();
}

function getLastRomPath() {
  return pceBuildSystem.getLastRomPath();
}

function getSampleSourceCode() {
  const samplePath = path.join(pceBuildSystem.getTemplatesRootDir(), 'template_pce_sample', 'src', 'main.c');
  return fs.existsSync(samplePath) ? fs.readFileSync(samplePath, 'utf-8') : '';
}

function getPluginRoles() {
  return pceBuildSystem.getPluginRoles();
}

function getPluginRole(roleId) {
  return pceBuildSystem.getPluginRole(roleId);
}

function setPluginRole(roleId, id) {
  return pceBuildSystem.setPluginRole(roleId, id);
}

function buildProject(...args) {
  return pceBuildSystem.buildProject(...args);
}

function collectProjectAssets(projectDir = getProjectDir()) {
  return pceAssetManager.listAssets(projectDir).assets;
}

module.exports = {
  CORE_IDS,
  collectProjectAssets,
  createProject,
  createProjectFromTemplate,
  createProjectInParent,
  createProjectInRoot,
  detectCoreIdFromConfig,
  generateProject,
  generateProjectStructureOnly,
  getActiveBuildSystem,
  getActiveCoreId,
  getBuildSystemForCore,
  getCore,
  getCoreIdForProjectDir,
  getDefaultProjectDir: (...args) => pceBuildSystem.getDefaultProjectDir(...args),
  getLastRomPath,
  getPceSetupManager: () => pceSetupManager,
  getPluginRole,
  getPluginRoles,
  getProjectDir,
  getProjectInfo,
  getProjectsRootDir: (...args) => pceBuildSystem.getProjectsRootDir(...args),
  getProjectStartupState,
  getSampleSourceCode,
  getSetupManagerForCore,
  getTemplatesRootDir: (...args) => pceBuildSystem.getTemplatesRootDir(...args),
  listCores,
  listProjects,
  loadCurrentSource,
  loadProjectConfig,
  loadProjectConfigFromDir,
  normalizeCoreId,
  openProject,
  openProjectByName,
  saveProjectConfig,
  setPluginRole,
  setProjectDir,
  buildProject,
};
