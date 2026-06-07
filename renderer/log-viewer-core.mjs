export function normalizeLogLevel(level) {
  const value = String(level || 'info').toLowerCase();
  return ['debug', 'info', 'warn', 'error'].includes(value) ? value : 'info';
}

export function logLevelRank(level) {
  switch (normalizeLogLevel(level)) {
    case 'debug': return 10;
    case 'info': return 20;
    case 'warn': return 30;
    case 'error': return 40;
    default: return 20;
  }
}

export function escLogHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sourceClassName(source) {
  return String(source || 'app').replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export function formatLogTime(timestamp) {
  const t = new Date(Number(timestamp) || Date.now());
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function isLogEntryVisible(entry, filters = {}) {
  if (!entry) return false;
  const source = String(entry.source || 'app');
  const sourceVisibility = filters.sourceVisibility || {};
  if (!sourceVisibility[source]) return false;

  const minLevel = filters.levelFilter || 'all';
  const levelLimit = minLevel === 'all' ? -Infinity : logLevelRank(minLevel);
  if (levelLimit !== -Infinity && logLevelRank(entry.level) < levelLimit) return false;

  const search = String(filters.searchText || '').trim().toLowerCase();
  if (search) {
    const hay = `${source} ${normalizeLogLevel(entry.level)} ${entry.text || ''}`.toLowerCase();
    if (!hay.includes(search)) return false;
  }

  return true;
}

export function createLogLineElement(entry, doc = globalThis.document) {
  if (!doc) throw new Error('document is required');

  const source = String(entry?.source || 'app');
  const level = normalizeLogLevel(entry?.level);
  const line = doc.createElement('div');
  line.className = `log-line log-level-${level}`;
  line.innerHTML = `
    <span class="log-time">${formatLogTime(entry?.timestamp)}</span>
    <span class="log-src log-src-${sourceClassName(source)}">${escLogHtml(source)}</span>
    <span class="log-text">${escLogHtml(entry?.text || '')}</span>
  `;
  return line;
}

export function appendLogLine(container, entry) {
  if (!container) return null;
  const line = createLogLineElement(entry, container.ownerDocument);
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  return line;
}

export function getVisibleLogEntries(entries, filters = {}) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => isLogEntryVisible(entry, filters));
}

export function renderLogEntries(container, entries, filters = {}) {
  if (!container) return;
  container.innerHTML = '';
  getVisibleLogEntries(entries, filters).forEach((entry) => {
    container.appendChild(createLogLineElement(entry, container.ownerDocument));
  });
  container.scrollTop = container.scrollHeight;
}

export function renderLogSourceFilters(container, sourceVisibility = {}, onChange = () => {}) {
  if (!container) return;
  const sources = Object.keys(sourceVisibility).sort((a, b) => a.localeCompare(b, 'ja'));
  container.innerHTML = '';
  sources.forEach((source) => {
    const chip = container.ownerDocument.createElement('label');
    chip.className = 'log-source-chip';
    chip.innerHTML = `
      <input type="checkbox" ${sourceVisibility[source] ? 'checked' : ''} />
      <span>${escLogHtml(source)}</span>
    `;
    chip.querySelector('input')?.addEventListener('change', (event) => {
      onChange(source, Boolean(event.target.checked));
    });
    container.appendChild(chip);
  });
}

export function formatLogEntryText(entry) {
  return `${formatLogTime(entry?.timestamp)} [${entry?.source || 'app'}] ${entry?.text || ''}`;
}
