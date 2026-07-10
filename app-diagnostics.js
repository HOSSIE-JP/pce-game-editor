'use strict';

const MAX_DIAGNOSTICS = 200;
const entries = [];
const listeners = new Set();
let nextId = 1;

function diagnosticMessage(input = {}) {
  if (input.message) return String(input.message);
  if (input.error?.message) return String(input.error.message);
  if (input.error) return String(input.error);
  return 'Unknown application error';
}

function normalizeDiagnostic(input = {}) {
  const level = ['info', 'warn', 'error'].includes(input.level) ? input.level : 'warn';
  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details)
    ? { ...input.details }
    : {};
  return {
    id: nextId++,
    timestamp: new Date().toISOString(),
    source: String(input.source || 'app'),
    code: String(input.code || 'unexpected-error'),
    level,
    message: diagnosticMessage(input),
    details,
  };
}

function report(input = {}) {
  const diagnostic = normalizeDiagnostic(input);
  entries.push(diagnostic);
  if (entries.length > MAX_DIAGNOSTICS) entries.splice(0, entries.length - MAX_DIAGNOSTICS);
  listeners.forEach((listener) => {
    try {
      listener(diagnostic);
    } catch (_) {
      // A diagnostic listener must never break the operation being diagnosed.
    }
  });
  return diagnostic;
}

function list() {
  return entries.map((entry) => ({ ...entry, details: { ...entry.details } }));
}

function clear() {
  entries.length = 0;
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  MAX_DIAGNOSTICS,
  clear,
  list,
  normalizeDiagnostic,
  report,
  subscribe,
};
