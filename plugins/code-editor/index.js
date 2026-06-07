'use strict';

const manifest = require('./manifest.json');

function getTab() {
  return {
    id: manifest.id,
    label: manifest.tab?.label || manifest.name,
    icon: manifest.tab?.icon || 'code',
    mountType: 'builtin-code-editor',
  };
}

function onActivate(_payload, context = {}) {
  context?.logger?.info('code-editor activated');
  return { ok: true };
}

function onDeactivate(_payload, context = {}) {
  context?.logger?.info('code-editor deactivated');
  return { ok: true };
}

module.exports = {
  manifest,
  getTab,
  onActivate,
  onDeactivate,
};
