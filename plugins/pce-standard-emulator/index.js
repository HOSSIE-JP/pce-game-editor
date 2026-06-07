'use strict';

async function onTestPlay(payload, context = {}) {
  if (!context.testPlay || typeof context.testPlay.openWasmWindow !== 'function') {
    return { ok: false, error: 'Test Play host API is unavailable' };
  }
  const result = await context.testPlay.openWasmWindow({
    romPath: payload?.romPath || null,
    pluginId: 'pce-standard-emulator',
  });
  if (result?.error) {
    return { ok: false, handled: false, ...result };
  }
  return { ok: true, handled: true, result };
}

module.exports = { onTestPlay };
