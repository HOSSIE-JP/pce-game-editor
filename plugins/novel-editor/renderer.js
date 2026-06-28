import { activatePlugin as activateVnEditor } from '../pce-visual-novel-editor/renderer.js';
import { activatePlugin as activateSystemSettings } from '../pce-vn-system-settings/renderer.js';
import { activatePlugin as activateFontEditor } from '../pce-font-editor/renderer.js';

const NOVEL_TABS = [
  { id: 'vn', label: 'スクリプト', pluginId: 'novel-editor', activate: activateVnEditor },
  { id: 'system', label: 'システム設定', pluginId: 'novel-editor', activate: activateSystemSettings },
  { id: 'font', label: 'フォント', pluginId: 'novel-editor', activate: activateFontEditor },
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
    <div class="tool-tab-shell novel-editor-shell">
      <div class="tool-tab-bar" role="tablist" aria-label="Novel tools">
        ${NOVEL_TABS.map((tab, index) => `
          <button
            class="tool-tab-button${index === 0 ? ' active' : ''}"
            type="button"
            role="tab"
            aria-selected="${index === 0 ? 'true' : 'false'}"
            aria-controls="novel-tab-${esc(tab.id)}"
            data-novel-tab="${esc(tab.id)}"
          >${esc(tab.label)}</button>
        `).join('')}
      </div>
      <div class="tool-tab-body">
        ${NOVEL_TABS.map((tab, index) => `
          <section
            id="novel-tab-${esc(tab.id)}"
            class="tool-tab-panel"
            role="tabpanel"
            data-novel-panel="${esc(tab.id)}"
            ${index === 0 ? '' : 'hidden'}
          ></section>
        `).join('')}
      </div>
    </div>
  `;

  const activations = [];
  const setActiveTab = (activeId) => {
    root.querySelectorAll('[data-novel-tab]').forEach((button) => {
      const active = button.dataset.novelTab === activeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-novel-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.novelPanel !== activeId;
    });
  };

  root.querySelectorAll('[data-novel-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.novelTab || 'vn'));
  });

  for (const tab of NOVEL_TABS) {
    const panel = root.querySelector(`[data-novel-panel="${tab.id}"]`);
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

  registerCapability('novel-editor', { setActiveTab });
  return {
    deactivate() {
      activations.forEach((activation) => {
        try { activation.deactivate(); } catch (err) { logger?.warn?.(String(err?.message || err)); }
      });
    },
  };
}
