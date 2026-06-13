import { activatePlugin as activateBackgroundManager } from '../pce-background-manager/renderer.js';
import { activatePlugin as activateSpriteManager } from '../pce-sprite-manager/renderer.js';
import { activatePlugin as activatePaletteEditor } from '../pce-palette-editor/renderer.js';

const IMAGE_TABS = [
  { id: 'bg', label: 'BG', pluginId: 'pce-background-manager', activate: activateBackgroundManager },
  { id: 'sprites', label: 'Sprites', pluginId: 'pce-sprite-manager', activate: activateSpriteManager },
  { id: 'palette', label: 'Palette', pluginId: 'pce-palette-editor', activate: activatePaletteEditor },
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export async function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  root.innerHTML = `
    <div class="tool-tab-shell image-editor-shell">
      <div class="tool-tab-bar" role="tablist" aria-label="Image tools">
        ${IMAGE_TABS.map((tab, index) => `
          <button
            class="tool-tab-button${index === 0 ? ' active' : ''}"
            type="button"
            role="tab"
            aria-selected="${index === 0 ? 'true' : 'false'}"
            aria-controls="image-tab-${esc(tab.id)}"
            data-image-tab="${esc(tab.id)}"
          >${esc(tab.label)}</button>
        `).join('')}
      </div>
      <div class="tool-tab-body">
        ${IMAGE_TABS.map((tab, index) => `
          <section
            id="image-tab-${esc(tab.id)}"
            class="tool-tab-panel"
            role="tabpanel"
            data-image-panel="${esc(tab.id)}"
            ${index === 0 ? '' : 'hidden'}
          ></section>
        `).join('')}
      </div>
    </div>
  `;

  const activations = [];
  const setActiveTab = (activeId) => {
    root.querySelectorAll('[data-image-tab]').forEach((button) => {
      const active = button.dataset.imageTab === activeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-image-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.imagePanel !== activeId;
    });
  };

  root.querySelectorAll('[data-image-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.imageTab || 'bg'));
  });

  for (const tab of IMAGE_TABS) {
    const panel = root.querySelector(`[data-image-panel="${tab.id}"]`);
    if (!panel) continue;
    const activation = await tab.activate({
      plugin: { ...plugin, id: tab.pluginId },
      root: panel,
      pageRoot: panel,
      hostRoot: panel,
      api,
      logger,
      registerCapability,
    });
    if (activation && typeof activation.deactivate === 'function') activations.push(activation);
  }

  registerCapability('image-editor', { setActiveTab });
  return {
    deactivate() {
      activations.forEach((activation) => {
        try { activation.deactivate(); } catch (err) { logger?.warn?.(String(err?.message || err)); }
      });
    },
  };
}
