export function normalizePluginDiagnostics(value) {
  return (Array.isArray(value) ? value : []).map((entry) => ({
    pluginId: String(entry?.pluginId || 'unknown'),
    source: entry?.source === 'user' ? 'user' : 'builtin',
    code: String(entry?.code || 'plugin-invalid'),
    level: entry?.level === 'warn' ? 'warn' : 'error',
    path: String(entry?.path || ''),
    messages: (Array.isArray(entry?.messages) ? entry.messages : [entry?.message])
      .map((message) => String(message || '').trim())
      .filter(Boolean),
  }));
}

export function pluginTrustPrompt(plugin, pluginIds = []) {
  const ids = Array.from(new Set((pluginIds.length ? pluginIds : [plugin?.id]).filter(Boolean)));
  return [
    `ユーザープラグイン「${plugin?.name || plugin?.id || ids[0]}」を信頼しますか？`,
    '',
    'このプラグインの renderer と main process code は、アプリと同じ権限で実行されます。',
    `対象: ${ids.join(', ')}`,
    '内容と入手元を確認したプラグインだけを信頼してください。',
  ].join('\n');
}

export function pluginDiagnosticHtml(diagnostics, escapeHtml) {
  const esc = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
  const normalized = normalizePluginDiagnostics(diagnostics);
  if (normalized.length === 0) return '';
  return `
    <section class="plugin-diagnostics" role="status">
      <h3>プラグイン診断 (${normalized.length})</h3>
      ${normalized.map((entry) => `
        <div class="plugin-diagnostic plugin-diagnostic-${esc(entry.level)}">
          <strong>${esc(entry.pluginId)}</strong>
          <span>${esc(entry.source === 'user' ? 'ユーザー' : '組み込み')} / ${esc(entry.code)}</span>
          <p>${esc(entry.messages.join(' / ') || '不明な検証エラー')}</p>
          ${entry.path ? `<code>${esc(entry.path)}</code>` : ''}
        </div>
      `).join('')}
    </section>
  `;
}
