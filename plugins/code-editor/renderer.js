export function activatePlugin({ plugin, root, logger, registerCapability }) {
  if (root) {
    root.dataset.pluginOwner = plugin.id;
  }

  registerCapability('code-editor', {
    pluginId: plugin.id,
    root,
  });

  logger.debug('code-editor renderer activated');
  return {
    deactivate() {
      if (root?.dataset.pluginOwner === plugin.id) {
        delete root.dataset.pluginOwner;
      }
    },
  };
}
