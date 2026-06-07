'use strict';

const fs = require('fs');
const path = require('path');
const vnManager = require('../../pce-vn-manager');

function readJson(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {}
  return {};
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function copyIfChanged(sourcePath, targetPath) {
  const source = fs.readFileSync(sourcePath);
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null;
  if (current && Buffer.compare(source, current) === 0) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function shouldUseVisualNovelRuntime(projectDir, config = {}) {
  const settings = config.pluginSettings?.['pce-sample-builder'] || {};
  return settings.sample === 'visual-novel-cd'
    || config.targetMedia === 'cd'
    || fs.existsSync(path.join(projectDir, vnManager.VN_SCENE_FILE));
}

function syncVisualNovelRuntime(projectDir, logger) {
  const runtimeSource = path.join(__dirname, 'template-vn', 'src', 'main.c');
  const runtimeTarget = path.join(projectDir, 'src', 'main.c');
  const changed = copyIfChanged(runtimeSource, runtimeTarget);
  if (changed) logger?.info?.('PCE visual novel runtime を src/main.c に同期しました');
}

function mergeProjectConfig(projectDir, patch = {}) {
  const configPath = path.join(projectDir, 'project.json');
  const current = readJson(configPath);
  const next = {
    ...current,
    ...patch,
    cd: {
      ...(current.cd || {}),
      ...(patch.cd || {}),
    },
    pluginSettings: {
      ...(current.pluginSettings || {}),
      ...(patch.pluginSettings || {}),
    },
  };
  writeJson(configPath, next);
  return next;
}

function onBuildStart(payload, context = {}) {
  const projectDir = payload.projectDir || context.projectDir;
  context.logger?.info?.(`PCE build start: ${payload.projectDir}`);
  if (projectDir) {
    const config = readJson(path.join(projectDir, 'project.json'));
    if (shouldUseVisualNovelRuntime(projectDir, config)) {
      syncVisualNovelRuntime(projectDir, context.logger);
      const prepared = vnManager.prepareVisualNovelBuild(projectDir, config);
      mergeProjectConfig(projectDir, prepared.configPatch);
      context.logger?.info?.(
        `VN scenes generated: ${prepared.generated.sceneCount} scene(s), ${prepared.generated.messageCount} message(s), ${prepared.generated.glyphCount} glyph(s)`,
      );
    }
  }
  return { ok: true };
}

function onBuildLog(payload) {
  return { ok: true, payload };
}

function onBuildEnd(payload, context = {}) {
  context.logger?.info?.(`PCE ROM generated: ${payload.romPath || '(unknown)'}`);
  return { ok: true };
}

function onBuildError(payload, context = {}) {
  context.logger?.error?.(`PCE build failed: ${payload.error || 'unknown error'}`);
  return { ok: true };
}

module.exports = { onBuildStart, onBuildLog, onBuildEnd, onBuildError };
