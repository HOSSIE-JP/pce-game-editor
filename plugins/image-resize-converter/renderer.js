export function activatePlugin({ api, logger, registerCapability }) {
  registerCapability('image-resize', {
    openResizeModal: api.openResizeModal,
  });

  logger.debug('image-resize renderer activated');
}
