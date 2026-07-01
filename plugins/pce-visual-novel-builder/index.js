'use strict';

function onBuildStart(payload, context = {}) {
  const projectDir = payload.projectDir || context.projectDir;
  context.logger?.info?.(`PCE CD-ROM2 visual novel build start: ${projectDir || '(unknown)'}`);
  return { ok: true };
}

function onBuildLog(payload) {
  return { ok: true, payload };
}

function onBuildEnd(payload, context = {}) {
  context.logger?.info?.(`PCE CD-ROM2 visual novel media generated: ${payload.romPath || '(unknown)'}`);
  return { ok: true };
}

function onBuildError(payload, context = {}) {
  context.logger?.error?.(`PCE CD-ROM2 visual novel build failed: ${payload.error || 'unknown error'}`);
  return { ok: true };
}

module.exports = { onBuildStart, onBuildLog, onBuildEnd, onBuildError };
