import { createImageAssetManagerPlugin } from '../pce-image-converter/image-asset-manager-page.js';

export const activatePlugin = createImageAssetManagerPlugin({
  kind: 'background',
  title: 'Background Assets',
  summaryLabel: 'backgrounds',
  importTitle: '背景追加',
  capabilityName: 'background-manager',
});
