import {
  appendLogLine,
  isLogEntryVisible,
  renderLogEntries,
  renderLogSourceFilters,
} from './log-viewer-core.mjs';

const el = {
  log: document.getElementById('log'),
  count: document.getElementById('count'),
  logLevelFilter: document.getElementById('logLevelFilter'),
  logSearchInput: document.getElementById('logSearchInput'),
  logSourceFilters: document.getElementById('logSourceFilters'),
};

const state = {
  entries: [],
  sourceVisibility: { build: true },
  levelFilter: 'all',
  searchText: '',
};

function ensureLogSourceVisible(source) {
  const key = String(source || 'app');
  if (!Object.prototype.hasOwnProperty.call(state.sourceVisibility, key)) {
    state.sourceVisibility[key] = true;
  }
}

function syncSourceFilters() {
  renderLogSourceFilters(el.logSourceFilters, state.sourceVisibility, (source, checked) => {
    state.sourceVisibility[source] = checked;
    render();
  });
}

function updateCount() {
  if (el.count) el.count.textContent = `${state.entries.length} lines`;
}

function render() {
  syncSourceFilters();
  renderLogEntries(el.log, state.entries, state);
  updateCount();
}

el.logLevelFilter?.addEventListener('change', () => {
  state.levelFilter = el.logLevelFilter.value || 'all';
  render();
});

el.logSearchInput?.addEventListener('input', () => {
  state.searchText = el.logSearchInput.value || '';
  render();
});

window.logViewerAPI.onSnapshot((payload) => {
  state.entries = Array.isArray(payload?.entries) ? payload.entries : [];
  state.entries.forEach((entry) => ensureLogSourceVisible(entry?.source));
  render();
});

window.logViewerAPI.onEntry((entry) => {
  const next = entry || {};
  const source = String(next.source || 'app');
  const isNewSource = !Object.prototype.hasOwnProperty.call(state.sourceVisibility, source);
  ensureLogSourceVisible(source);
  state.entries.push(next);
  if (state.entries.length > 4000) state.entries.splice(0, state.entries.length - 4000);
  if (isNewSource) syncSourceFilters();

  if (isLogEntryVisible(next, state)) {
    appendLogLine(el.log, next);
  }
  updateCount();
});
