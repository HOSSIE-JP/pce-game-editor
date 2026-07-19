'use strict';

function registerPceAssetIpc({ ipcMain, assetManager, getProjectDir }) {
  const projectDir = () => getProjectDir();
  const handle = (channel, operation) => {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const result = await operation(payload, event);
        return { ok: true, ...(result || {}) };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    });
  };

  handle('assets:list', () => assetManager.listAssets(projectDir()));
  handle('assets:upsert', (asset) => assetManager.upsertAsset(projectDir(), asset || {}));
  handle('assets:delete', (payload) => assetManager.deleteAsset(projectDir(), payload?.id || payload));
  handle('assets:importImage', (payload) => assetManager.importImage(projectDir(), payload || {}));
  handle('assets:importAudio', (payload) => assetManager.importAudio(projectDir(), payload || {}));
  handle('assets:inspectAdpcmBatch', (payload) => assetManager.inspectAdpcmBatch(projectDir(), payload || {}));
  handle('assets:importAdpcmBatch', (payload, event) => assetManager.importAdpcmBatch(projectDir(), payload || {}, {
    onProgress(progress) {
      if (!event?.sender?.isDestroyed?.()) event?.sender?.send?.('assets:adpcmBatchProgress', progress);
    },
  }));
  handle('assets:cancelAdpcmBatch', (payload) => assetManager.cancelAdpcmBatch(projectDir(), payload || {}));
  handle('assets:importVgm', (payload) => assetManager.importVgm(projectDir(), payload || {}));
  handle('assets:importMidi', (payload) => assetManager.importMidi(projectDir(), payload || {}));
  handle('assets:previewMidi', (payload) => assetManager.previewMidi(projectDir(), payload || {}));
  handle('assets:previewSource', (payload) => assetManager.previewSource(projectDir(), payload?.relativePath || payload));
  handle('assets:reorder', (payload) => assetManager.reorderAssets(projectDir(), payload?.ids || payload));
}

module.exports = { registerPceAssetIpc };
