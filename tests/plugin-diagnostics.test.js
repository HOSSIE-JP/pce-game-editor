'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

test('plugin diagnostics render validation failures and trust warnings', async () => {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'renderer', 'plugin-diagnostics.mjs')).href;
  const diagnostics = await import(moduleUrl);
  const html = diagnostics.pluginDiagnosticHtml([{
    pluginId: 'broken', source: 'user', code: 'manifest-invalid', messages: ['id is required'], path: 'manifest.json',
  }], (value) => String(value));
  assert.match(html, /broken/);
  assert.match(html, /manifest-invalid/);
  assert.match(html, /id is required/);
  assert.match(diagnostics.pluginTrustPrompt({ id: 'custom', name: 'Custom' }, ['custom']), /main process code/);
});
