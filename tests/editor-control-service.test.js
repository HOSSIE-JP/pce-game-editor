'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const {
  createEditorControlService,
  createEditorControlServer,
} = require('../editor-control-service');

function makeService() {
  const calls = [];
  const service = createEditorControlService({
    editor_status: async () => ({ ready: true }),
    asset_list: async () => ({ files: [] }),
    code_write: async (args) => {
      calls.push(['code_write', args]);
      return { path: args.path };
    },
  });
  return { service, calls };
}

async function requestJson(url, options = {}) {
  const result = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await result.text();
  return {
    status: result.status,
    data: text ? JSON.parse(text) : null,
  };
}

test('editor control lists tools and requires confirm for mutating commands', async () => {
  const { service, calls } = makeService();
  const tools = service.listTools();

  assert.ok(tools.some((tool) => tool.name === 'editor_status' && !tool.mutates));
  assert.ok(tools.some((tool) => tool.name === 'code_write' && tool.mutates));
  assert.ok(tools.some((tool) => tool.name === 'asset_write_file' && tool.mutates));

  const rejected = await service.callTool('code_write', { path: 'src/main.c', content: 'x' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(calls, []);

  const dryRun = await service.callTool('code_write', { path: 'src/main.c' }, { dryRun: true });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.result.dryRun, true);

  const written = await service.callTool('code_write', { path: 'src/main.c', content: 'x' }, { confirm: true });
  assert.equal(written.ok, true);
  assert.deepEqual(calls, [['code_write', { path: 'src/main.c', content: 'x' }]]);
});

test('editor control REST server enforces token and localhost origin', async () => {
  const { service } = makeService();
  const server = createEditorControlServer(service, { token: 'test-token' });
  const status = await server.start({ port: 0 });
  const baseUrl = status.baseUrl;

  try {
    const unauthorized = await requestJson(`${baseUrl}/v1/tools`);
    assert.equal(unauthorized.status, 401);

    const rejectedOrigin = await requestJson(`${baseUrl}/v1/tools`, {
      headers: {
        Authorization: 'Bearer test-token',
        Origin: 'https://example.com',
      },
    });
    assert.equal(rejectedOrigin.status, 403);

    const tools = await requestJson(`${baseUrl}/v1/tools`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(tools.status, 200);
    assert.ok(tools.data.result.tools.some((tool) => tool.name === 'asset_list'));

    const call = await requestJson(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: { name: 'asset_list', arguments: {} },
    });
    assert.equal(call.status, 200);
    assert.deepEqual(call.data.result, { files: [] });

    const logs = await requestJson(`${baseUrl}/v1/logs`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    assert.equal(logs.status, 200);
    const toolLog = logs.data.result.logs.find((entry) => entry.kind === 'tool' && entry.tool === 'asset_list');
    assert.equal(toolLog.protocol, 'rest');
    assert.equal(typeof toolLog.durationMs, 'number');
    assert.deepEqual(toolLog.arguments, {});
    assert.deepEqual(toolLog.result, { files: { type: 'array', length: 0 } });
  } finally {
    await server.stop();
  }
});

test('editor control operation logs redact large write payloads', async () => {
  const { service } = makeService();
  const server = createEditorControlServer(service, { token: 'test-token' });
  const status = await server.start({ port: 0 });
  const baseUrl = status.baseUrl;
  const payload = 'a'.repeat(240);

  try {
    const call = await requestJson(`${baseUrl}/v1/tools/call`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: {
        name: 'asset_write_file',
        dryRun: true,
        arguments: {
          targetPath: 'gfx/demo.png',
          dataBase64: payload,
        },
      },
    });
    assert.equal(call.status, 200);

    const logs = await requestJson(`${baseUrl}/v1/logs`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const writeLog = logs.data.result.logs.find((entry) => entry.kind === 'tool' && entry.tool === 'asset_write_file');
    assert.equal(writeLog.arguments.targetPath, 'gfx/demo.png');
    assert.deepEqual(writeLog.arguments.dataBase64, { redacted: true, length: payload.length });
    assert.notEqual(JSON.stringify(writeLog), payload);
  } finally {
    await server.stop();
  }
});

test('editor control MCP HTTP calls are captured in operation logs', async () => {
  const { service } = makeService();
  const server = createEditorControlServer(service, { token: 'mcp-token' });
  const status = await server.start({ port: 0 });
  const baseUrl = status.baseUrl;

  try {
    const call = await requestJson(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mcp-token',
        'Content-Type': 'application/json',
      },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'asset_list', arguments: {} },
      },
    });
    assert.equal(call.status, 200);
    assert.equal(call.data.result.structuredContent.files.length, 0);

    const logs = await requestJson(`${baseUrl}/v1/logs`, {
      headers: { Authorization: 'Bearer mcp-token' },
    });
    const toolLog = logs.data.result.logs.find((entry) => entry.kind === 'tool' && entry.tool === 'asset_list');
    assert.equal(toolLog.protocol, 'mcp-http');
  } finally {
    await server.stop();
  }
});

test('editor control MCP sidecar writes only JSON-RPC messages to stdout', async () => {
  const { service } = makeService();
  const server = createEditorControlServer(service, { token: 'sidecar-token' });
  const status = await server.start({ port: 0 });
  const sidecarPath = path.join(__dirname, '..', 'scripts', 'md-game-editor-mcp.js');
  const child = spawn(process.execPath, [sidecarPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MD_EDITOR_CONTROL_URL: status.baseUrl,
      MD_EDITOR_CONTROL_TOKEN: 'sidecar-token',
    },
  });

  const stdoutLines = [];
  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk) => {
    chunk.split(/\r?\n/).filter(Boolean).forEach((line) => stdoutLines.push(line));
  });

  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

    while (stdoutLines.length < 2) {
      await once(child.stdout, 'data');
    }

    const messages = stdoutLines.map((line) => JSON.parse(line));
    assert.equal(messages[0].id, 1);
    assert.equal(messages[0].result.serverInfo.name, 'md-game-editor-mcp');
    assert.equal(messages[1].id, 2);
    assert.ok(messages[1].result.tools.some((tool) => tool.name === 'editor_status'));
  } finally {
    child.kill();
    await server.stop();
  }
});
