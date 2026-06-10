import { createImageAssetManagerPlugin } from '../pce-image-converter/image-asset-manager-page.js';

export const activatePlugin = createImageAssetManagerPlugin({
  kind: 'sprite',
  title: 'Sprite Assets',
  summaryLabel: 'sheets',
  importTitle: 'スプライト追加',
  capabilityName: 'sprite-manager',
});
