'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const diagnostics = require('../app-diagnostics');

test('application diagnostics normalize, retain, and publish user-visible failures', () => {
  diagnostics.clear();
  const received = [];
  const unsubscribe = diagnostics.subscribe((entry) => received.push(entry));
  const entry = diagnostics.report({
    source: 'plugin',
    code: 'manifest-invalid',
    level: 'error',
    error: new Error('broken manifest'),
    details: { pluginId: 'broken' },
  });
  unsubscribe();

  assert.equal(entry.message, 'broken manifest');
  assert.equal(entry.level, 'error');
  assert.deepEqual(entry.details, { pluginId: 'broken' });
  assert.equal(received.length, 1);
  assert.equal(diagnostics.list().length, 1);
});
