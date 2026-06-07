export function activatePlugin({ api, registerCapability }) {
  registerCapability('pce-audio-converter', {
    id: 'pce-audio-converter',
    label: 'PCE WAV to ADPCM/CD-DA',
    canConvert(file = {}) {
      const ext = String(file.ext || file.sourcePath || file.path || '').toLowerCase();
      return ext.endsWith('.wav');
    },
    async convert(file = {}) {
      const handler = api.capabilities.get('audio-import-handler') || api.capabilities.get('asset-import-handler');
      if (!handler?.handleImport) return null;
      return handler.handleImport(file);
    },
  });
  registerCapability('audio-convert-ui', {
    id: 'pce-audio-converter',
    priority: 20,
  });
  return { deactivate() {} };
}
