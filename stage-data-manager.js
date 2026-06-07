'use strict';

const fs = require('fs');
const path = require('path');

function getStagesDir(projectDir) {
  return path.join(projectDir, 'data', 'stages');
}

function ensureProjectDataDirs(projectDir) {
  fs.mkdirSync(getStagesDir(projectDir), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function listStages(projectDir) {
  const stagesDir = getStagesDir(projectDir);
  if (!fs.existsSync(stagesDir)) return [];

  return fs.readdirSync(stagesDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => readJson(path.join(stagesDir, name), null))
    .filter(Boolean)
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
}

function readGameSettings(projectDir) {
  return readJson(path.join(projectDir, 'data', 'game-settings.json'), {});
}

module.exports = {
  ensureProjectDataDirs,
  listStages,
  readGameSettings,
};
