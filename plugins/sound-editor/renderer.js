import { activatePlugin as activateAdpcmManager } from '../pce-adpcm-manager/renderer.js';
import { activatePlugin as activateCddaManager } from '../pce-cdda-manager/renderer.js';
import { activatePlugin as activatePsgEditor } from '../pce-music-editor/renderer.js';

const SOUND_TABS = [
  { id: 'adpcm', label: 'ADPCM', pluginId: 'pce-adpcm-manager', activate: activateAdpcmManager },
  { id: 'cdda', label: 'CD-DA', pluginId: 'pce-cdda-manager', activate: activateCddaManager },
  { id: 'psg', label: 'PSG', pluginId: 'pce-music-editor', activate: activatePsgEditor },
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
    <div class="tool-tab-shell sound-editor-shell">
      <div class="tool-tab-bar" role="tablist" aria-label="Sound tools">
        ${SOUND_TABS.map((tab, index) => `
          <button
            class="tool-tab-button${index === 0 ? ' active' : ''}"
            type="button"
            role="tab"
            aria-selected="${index === 0 ? 'true' : 'false'}"
            aria-controls="sound-tab-${esc(tab.id)}"
            data-sound-tab="${esc(tab.id)}"
          >${esc(tab.label)}</button>
        `).join('')}
      </div>
      <div class="tool-tab-body">
        ${SOUND_TABS.map((tab, index) => `
          <section
            id="sound-tab-${esc(tab.id)}"
            class="tool-tab-panel"
            role="tabpanel"
            data-sound-panel="${esc(tab.id)}"
            ${index === 0 ? '' : 'hidden'}
          ></section>
        `).join('')}
      </div>
    </div>
  `;

  const activations = [];
  const setActiveTab = (activeId) => {
    root.querySelectorAll('[data-sound-tab]').forEach((button) => {
      const active = button.dataset.soundTab === activeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-sound-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.soundPanel !== activeId;
    });
  };

  root.querySelectorAll('[data-sound-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.soundTab || 'adpcm'));
  });

  for (const tab of SOUND_TABS) {
    const panel = root.querySelector(`[data-sound-panel="${tab.id}"]`);
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

  registerCapability('sound-editor', { setActiveTab });
  return {
    deactivate() {
      activations.forEach((activation) => {
        try { activation.deactivate(); } catch (err) { logger?.warn?.(String(err?.message || err)); }
      });
    },
  };
}
