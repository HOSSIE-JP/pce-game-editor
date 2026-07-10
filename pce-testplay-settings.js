'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const TESTPLAY_ACTIONS = Object.freeze(['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'C', 'START']);
const TESTPLAY_VRAM_LAYOUTS = Object.freeze(['256x512', '512x256', '128x1024', '1024x128']);
const DEFAULT_TESTPLAY_SETTINGS = Object.freeze({
  keyboard: Object.freeze({
    UP: 'ArrowUp',
    DOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    A: 'KeyA',
    B: 'KeyZ',
    C: 'KeyX',
    START: 'Enter',
  }),
  gamepad: Object.freeze({
    UP: 'button:12',
    DOWN: 'button:13',
    LEFT: 'button:14',
    RIGHT: 'button:15',
    A: 'button:2',
    B: 'button:0',
    C: 'button:1',
    START: 'button:9',
  }),
  gamepadDeadzone: 0.5,
  debug: Object.freeze({
    autoRefresh: true,
    vramTileLayout: '256x512',
  }),
});

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'tools', 'settings.json');
}

function cloneDefaults() {
  return {
    keyboard: { ...DEFAULT_TESTPLAY_SETTINGS.keyboard },
    gamepad: { ...DEFAULT_TESTPLAY_SETTINGS.gamepad },
    gamepadDeadzone: DEFAULT_TESTPLAY_SETTINGS.gamepadDeadzone,
    debug: { ...DEFAULT_TESTPLAY_SETTINGS.debug },
  };
}

function normalizeBindingMap(candidate, fallback) {
  const result = { ...fallback };
  if (!candidate || typeof candidate !== 'object') return result;
  TESTPLAY_ACTIONS.forEach((action) => {
    const value = candidate[action];
    if (typeof value === 'string' && value.trim()) result[action] = value.trim();
  });
  return result;
}

function normalizeTestPlaySettings(candidate = {}) {
  const normalized = cloneDefaults();
  if (!candidate || typeof candidate !== 'object') return normalized;
  normalized.keyboard = normalizeBindingMap(candidate.keyboard, DEFAULT_TESTPLAY_SETTINGS.keyboard);
  normalized.gamepad = normalizeBindingMap(candidate.gamepad, DEFAULT_TESTPLAY_SETTINGS.gamepad);
  if (typeof candidate.gamepadDeadzone === 'number' && Number.isFinite(candidate.gamepadDeadzone)) {
    normalized.gamepadDeadzone = Math.min(0.95, Math.max(0.05, candidate.gamepadDeadzone));
  }
  if (candidate.debug && typeof candidate.debug === 'object') {
    if (typeof candidate.debug.autoRefresh === 'boolean') normalized.debug.autoRefresh = candidate.debug.autoRefresh;
    if (TESTPLAY_VRAM_LAYOUTS.includes(candidate.debug.vramTileLayout)) {
      normalized.debug.vramTileLayout = candidate.debug.vramTileLayout;
    }
  }
  return normalized;
}

function loadSettingsDocument() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')) || {};
  } catch (_) {
    return {};
  }
}

function saveSettingsDocument(document) {
  const settingsPath = getSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(document, null, 2), 'utf-8');
}

function getDefaultTestPlaySettings() {
  return cloneDefaults();
}

function getTestPlaySettings() {
  return normalizeTestPlaySettings(loadSettingsDocument().testPlay);
}

function saveTestPlaySettings(next = {}) {
  const current = getTestPlaySettings();
  const normalized = normalizeTestPlaySettings({
    keyboard: { ...current.keyboard, ...(next.keyboard && typeof next.keyboard === 'object' ? next.keyboard : {}) },
    gamepad: { ...current.gamepad, ...(next.gamepad && typeof next.gamepad === 'object' ? next.gamepad : {}) },
    gamepadDeadzone: Object.prototype.hasOwnProperty.call(next, 'gamepadDeadzone')
      ? next.gamepadDeadzone
      : current.gamepadDeadzone,
    debug: { ...current.debug, ...(next.debug && typeof next.debug === 'object' ? next.debug : {}) },
  });
  const document = loadSettingsDocument();
  saveSettingsDocument({ ...document, testPlay: normalized });
  return normalized;
}

module.exports = {
  DEFAULT_TESTPLAY_SETTINGS,
  getDefaultTestPlaySettings,
  getSettingsPath,
  getTestPlaySettings,
  normalizeTestPlaySettings,
  saveTestPlaySettings,
};
