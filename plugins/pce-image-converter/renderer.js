export function activatePlugin({ api, registerCapability }) {
  registerCapability('pce-image-converter', {
    id: 'pce-image-converter',
    label: 'PCE BG/Sprite Internal',
    canConvert(file = {}) {
      const ext = String(file.ext || file.sourcePath || file.path || '').toLowerCase();
      return ext.endsWith('.png') || ext.endsWith('.bmp');
    },
    async convert(file = {}) {
      const handler = api.capabilities.get('asset-import-handler');
      if (!handler?.handleImport) return null;
      return handler.handleImport(file);
    },
  });
  registerCapability('image-import-pipeline', {
    id: 'pce-image-converter',
    priority: 20,
    async convertToIndexed16(options = {}) {
      const handler = api.capabilities.get('asset-import-handler');
      if (!handler?.convertImageToIndexed16) return null;
      return handler.convertImageToIndexed16(options);
    },
  });
  return { deactivate() {} };
}
