export { countUniqueColors, snapColorToMegaDrive, snapColorToPce, quantizeToIndexed16 } from './quantize-utils.mjs';

export function activatePlugin({ api, logger, registerCapability }) {
  registerCapability('image-quantize', {
    openQuantizeModal: api.openQuantizeModal,
    countUniqueColors: api.countUniqueColors,
    imageDataToIndexedPng: api.imageDataToIndexedPng,
  });

  logger.debug('image-quantize renderer activated');
}
