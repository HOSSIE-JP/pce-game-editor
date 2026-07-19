'use strict';

const { buildIrodoriBatchBundle } = require('./pce-vn-irodori-batch');

async function exportIrodoriBatchZip({
  doc = {},
  assetIds = [],
  defaultPath = 'pce-vn_irodori_voice_batches.zip',
  owner,
  showSaveDialog,
  createStoredZipBuffer,
  writeFileSync,
} = {}) {
  let bundle;
  try {
    bundle = buildIrodoriBatchBundle({ doc, assetIds });
  } catch (err) {
    return {
      ok: false,
      canceled: false,
      path: '',
      speakerCount: 0,
      messageCount: 0,
      jobCount: 0,
      error: String(err?.message || err),
    };
  }

  const counts = {
    speakerCount: bundle.speakerCount,
    messageCount: bundle.messageCount,
    jobCount: bundle.jobCount,
  };
  try {
    const result = await showSaveDialog(owner, {
      title: 'Irodori-TTS 音声バッチをエクスポート',
      defaultPath,
      filters: [
        { name: 'Irodori-TTS voice batch', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result?.canceled || !result?.filePath) {
      return { ok: false, canceled: true, path: '', ...counts, error: '' };
    }
    const zipBuffer = createStoredZipBuffer(bundle.entries);
    writeFileSync(result.filePath, zipBuffer);
    return { ok: true, canceled: false, path: result.filePath, ...counts, error: '' };
  } catch (err) {
    return {
      ok: false,
      canceled: false,
      path: '',
      ...counts,
      error: String(err?.message || err),
    };
  }
}

module.exports = {
  exportIrodoriBatchZip,
};
