'use strict';

const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const DEFAULT_PORT = 17777;
const MAX_BODY_BYTES = 1024 * 1024;
const MCP_PROTOCOL_VERSION = '2025-06-18';

const PROMPTS = [
  {
    name: 'create_game_from_assets',
    description: 'Create or update an MD Game Editor project from available assets, then generate and build it.',
    arguments: [
      { name: 'projectGoal', description: 'Short game concept and success criteria.', required: true },
    ],
  },
  {
    name: 'fix_build_error',
    description: 'Inspect project state and build output, then propose or apply a focused fix.',
    arguments: [
      { name: 'error', description: 'Build error text or symptom to investigate.', required: true },
    ],
  },
  {
    name: 'add_asset_and_rebuild',
    description: 'Add an asset to resources, update generated code if needed, and rebuild.',
    arguments: [
      { name: 'assetPath', description: 'Source asset path or data URL payload context.', required: true },
    ],
  },
];

const RESOURCE_TEMPLATES = [
  { uri: 'md-editor://project/current', name: 'Current project', mimeType: 'application/json' },
  { uri: 'md-editor://project/config', name: 'Project config', mimeType: 'application/json' },
  { uri: 'md-editor://project/resources', name: 'Project resources', mimeType: 'application/json' },
  { uriTemplate: 'md-editor://project/source/{path}', name: 'Project source file', mimeType: 'text/plain' },
];

function objectSchema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: true };
}

const COMMANDS = [
  { name: 'editor_status', description: 'Return app, project, server, and capability status.', inputSchema: objectSchema() },
  { name: 'project_list', description: 'List projects known to MD Game Editor.', inputSchema: objectSchema() },
  { name: 'project_open', description: 'Open an existing project by project name or absolute projectDir.', mutates: true, inputSchema: objectSchema({ projectName: { type: 'string' }, projectDir: { type: 'string' } }) },
  { name: 'project_create', description: 'Create a project under a parent directory, optionally from a bundled template project.', mutates: true, inputSchema: objectSchema({ projectName: { type: 'string' }, parentDir: { type: 'string' }, templateId: { type: 'string' }, config: { type: 'object' }, sourceCode: { type: 'string' } }, ['projectName']) },
  { name: 'project_config_get', description: 'Read project.json for the current project.', inputSchema: objectSchema() },
  { name: 'project_config_update', description: 'Patch project.json for the current project.', mutates: true, inputSchema: objectSchema({ patch: { type: 'object' } }, ['patch']) },
  { name: 'asset_list', description: 'List ResComp resource definitions for the current project.', inputSchema: objectSchema() },
  { name: 'asset_add', description: 'Add an entry to a .res file.', mutates: true, inputSchema: objectSchema({ file: { type: 'string' }, entry: { type: 'object' } }, ['entry']) },
  { name: 'asset_write_file', description: 'Write or copy a binary asset under the current project res directory.', mutates: true, inputSchema: objectSchema({ targetPath: { type: 'string' }, dataBase64: { type: 'string' }, dataUrl: { type: 'string' }, sourcePath: { type: 'string' } }, ['targetPath']) },
  { name: 'asset_update', description: 'Update an entry in a .res file by line number.', mutates: true, inputSchema: objectSchema({ file: { type: 'string' }, lineNumber: { type: 'number' }, entry: { type: 'object' } }, ['lineNumber', 'entry']) },
  { name: 'asset_delete', description: 'Delete an entry in a .res file by line number.', mutates: true, destructive: true, inputSchema: objectSchema({ file: { type: 'string' }, lineNumber: { type: 'number' } }, ['lineNumber']) },
  { name: 'code_tree', description: 'List files under the current project root.', inputSchema: objectSchema({ path: { type: 'string' } }) },
  { name: 'code_read', description: 'Read a UTF-8 file under the current project root.', inputSchema: objectSchema({ path: { type: 'string' } }, ['path']) },
  { name: 'code_write', description: 'Write a UTF-8 file under the current project root.', mutates: true, inputSchema: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']) },
  { name: 'plugin_list', description: 'List installed MD Game Editor plugins.', inputSchema: objectSchema() },
  { name: 'plugin_set_role', description: 'Set a project plugin role such as builder or testplay.', mutates: true, inputSchema: objectSchema({ roleId: { type: 'string' }, id: { type: 'string' } }, ['roleId']) },
  { name: 'plugin_run_generator', description: 'Run a build plugin generator and write src/main.c.', mutates: true, inputSchema: objectSchema({ id: { type: 'string' } }, ['id']) },
  { name: 'build_run', description: 'Run the current project build pipeline.', mutates: true, inputSchema: objectSchema() },
  { name: 'testplay_open', description: 'Open Test Play for the current project ROM.', mutates: true, inputSchema: objectSchema() },
  { name: 'export_rom', description: 'Export the current ROM through the editor export flow.', mutates: true, inputSchema: objectSchema() },
  { name: 'export_html', description: 'Export the current ROM as a standalone HTML player.', mutates: true, inputSchema: objectSchema() },
];

function createToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function publicCommand(command) {
  return {
    name: command.name,
    description: command.description,
    inputSchema: command.inputSchema || objectSchema(),
    mutates: Boolean(command.mutates),
    destructive: Boolean(command.destructive),
  };
}

function ok(result) {
  return { ok: true, result };
}

function fail(code, message, details) {
  return { ok: false, error: { code, message: String(message || code), details } };
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function summarizeValue(value, depth = 0) {
  if (typeof value === 'string') {
    if (value.length > 160) return { type: 'string', length: value.length, preview: value.slice(0, 80) };
    return value;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      items: depth >= 1 ? undefined : value.slice(0, 5).map((item) => summarizeValue(item, depth + 1)),
    };
  }
  if (depth >= 2) return { type: 'object', keys: Object.keys(value).slice(0, 12) };
  const out = {};
  Object.entries(value).slice(0, 20).forEach(([key, item]) => {
    if (/^(dataBase64|dataUrl|content|sourceCode)$/i.test(key)) {
      out[key] = typeof item === 'string'
        ? { redacted: true, length: item.length }
        : { redacted: true };
      return;
    }
    out[key] = summarizeValue(item, depth + 1);
  });
  return out;
}

function summarizeToolResult(result) {
  if (!result || result.ok === false) return result?.error || result;
  const value = result.result;
  if (!isPlainObject(value)) return summarizeValue(value);
  const keys = [
    'dryRun',
    'name',
    'projectName',
    'projectDir',
    'path',
    'relativePath',
    'srcPath',
    'romPath',
    'romSize',
    'success',
    'skipped',
    'built',
    'exportPath',
  ];
  const summary = {};
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) summary[key] = summarizeValue(value[key]);
  });
  Object.entries(value).forEach(([key, item]) => {
    if (Object.prototype.hasOwnProperty.call(summary, key)) return;
    if (Array.isArray(item)) summary[key] = { type: 'array', length: item.length };
    else if (isPlainObject(item)) summary[key] = { type: 'object', keys: Object.keys(item).slice(0, 12) };
    else if (typeof item !== 'undefined') summary[key] = summarizeValue(item);
  });
  return summary;
}

function asErrorResult(err) {
  if (err && err.code && err.message) return fail(err.code, err.message, err.details);
  return fail('INTERNAL_ERROR', err?.message || err);
}

function createEditorControlService(handlers = {}) {
  const commands = new Map(COMMANDS.map((command) => [command.name, command]));

  async function callHandler(name, args, context) {
    const handler = handlers[name];
    if (typeof handler !== 'function') {
      return fail('NOT_IMPLEMENTED', `tool is not implemented: ${name}`);
    }
    const value = await handler(args || {}, context || {});
    if (value && value.ok === false) {
      return fail(value.code || 'COMMAND_FAILED', value.error || value.message || 'command failed', value);
    }
    return ok(value);
  }

  async function callTool(name, args = {}, options = {}) {
    const command = commands.get(String(name || ''));
    if (!command) return fail('UNKNOWN_TOOL', `unknown tool: ${name}`);
    const dryRun = Boolean(options.dryRun);
    if (command.mutates && !dryRun && options.confirm !== true) {
      return fail('CONFIRM_REQUIRED', `${command.name} changes project state; pass confirm: true or dryRun: true`);
    }
    if (dryRun) {
      return ok({
        dryRun: true,
        name: command.name,
        mutates: Boolean(command.mutates),
        acceptedArguments: args || {},
      });
    }
    try {
      return await callHandler(command.name, args || {}, options);
    } catch (err) {
      return asErrorResult(err);
    }
  }

  async function readResource(uri) {
    const target = String(uri || '');
    if (target === 'md-editor://project/current') return callTool('editor_status');
    if (target === 'md-editor://project/config') return callTool('project_config_get');
    if (target === 'md-editor://project/resources') return callTool('asset_list');
    if (target.startsWith('md-editor://project/source/')) {
      const filePath = decodeURIComponent(target.slice('md-editor://project/source/'.length));
      return callTool('code_read', { path: filePath });
    }
    return fail('UNKNOWN_RESOURCE', `unknown resource: ${uri}`);
  }

  function getPrompt(name, args = {}) {
    const prompt = PROMPTS.find((item) => item.name === name);
    if (!prompt) return null;
    const extra = args && Object.keys(args).length ? `\nArguments:\n${JSON.stringify(args, null, 2)}` : '';
    return {
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${prompt.description}\nUse the exposed MD Game Editor tools and resources. Keep changes focused, validate with build_run when changing project files, and report any remaining risk.${extra}`,
          },
        },
      ],
    };
  }

  return {
    listTools: () => COMMANDS.map(publicCommand),
    listResources: () => RESOURCE_TEMPLATES.slice(),
    listPrompts: () => PROMPTS.slice(),
    getPrompt,
    callTool,
    readResource,
  };
}

function parseBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : String(req.headers['x-md-editor-token'] || '');
}

function isLocalOrigin(origin) {
  if (!origin) return true;
  if (origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function createEditorControlServer(service, options = {}) {
  const token = options.token || createToken();
  const logs = [];
  let server = null;
  let port = null;

  function log(level, message, details) {
    const entry = {
      at: new Date().toISOString(),
      level: level || 'info',
      message: String(message || ''),
      details,
    };
    logs.push(entry);
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    if (typeof options.onLog === 'function') options.onLog(entry);
  }

  function logEntry(entry) {
    const next = {
      at: new Date().toISOString(),
      level: entry.level || 'info',
      ...entry,
    };
    logs.push(next);
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    if (typeof options.onLog === 'function') options.onLog(next);
  }

  async function callToolWithLog(protocol, name, args, callOptions = {}) {
    const started = Date.now();
    const result = await service.callTool(name, args || {}, callOptions);
    const durationMs = Date.now() - started;
    logEntry({
      kind: 'tool',
      protocol,
      tool: String(name || ''),
      level: result.ok ? 'info' : 'warn',
      message: `${protocol} ${name || '(unknown)'} ${result.ok ? 'ok' : 'failed'} (${durationMs}ms)`,
      arguments: summarizeValue(args || {}),
      dryRun: Boolean(callOptions.dryRun),
      confirm: callOptions.confirm === true,
      durationMs,
      result: summarizeToolResult(result),
    });
    return result;
  }

  function status() {
    return {
      running: Boolean(server),
      host: '127.0.0.1',
      port,
      baseUrl: port ? `http://127.0.0.1:${port}` : null,
      mcpEndpoint: port ? `http://127.0.0.1:${port}/mcp` : null,
      toolCount: service.listTools().length,
      logs: logs.slice(-50),
    };
  }

  function authorize(req, res) {
    if (!isLocalOrigin(req.headers.origin)) {
      sendJson(res, 403, fail('ORIGIN_REJECTED', 'only localhost origins are allowed'));
      return false;
    }
    if (parseBearerToken(req) !== token) {
      sendJson(res, 401, fail('UNAUTHORIZED', 'valid bearer token is required'));
      return false;
    }
    return true;
  }

  async function handleRest(req, res, pathname) {
    if (!authorize(req, res)) return;
    if (req.method === 'GET' && pathname === '/v1/status') {
      sendJson(res, 200, ok(status()));
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/tools') {
      sendJson(res, 200, ok({ tools: service.listTools() }));
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/resources') {
      sendJson(res, 200, ok({ resources: service.listResources() }));
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/prompts') {
      sendJson(res, 200, ok({ prompts: service.listPrompts() }));
      return;
    }
    if (req.method === 'GET' && pathname === '/v1/logs') {
      sendJson(res, 200, ok({ logs: logs.slice(-200) }));
      return;
    }
    if (req.method === 'POST' && pathname === '/v1/tools/call') {
      const body = await readJsonBody(req);
      const result = await callToolWithLog('rest', body.name, body.arguments || {}, {
        dryRun: body.dryRun,
        confirm: body.confirm,
        source: 'rest',
      });
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === 'POST' && pathname === '/v1/resources/read') {
      const body = await readJsonBody(req);
      const result = await service.readResource(body.uri);
      sendJson(res, result.ok ? 200 : 404, result);
      return;
    }
    sendJson(res, 404, fail('NOT_FOUND', `unknown endpoint: ${pathname}`));
  }

  function mcpResult(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  function mcpError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message: String(message || code) } };
  }

  async function handleMcpMessage(message) {
    const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null;
    try {
      switch (message.method) {
        case 'initialize':
          return mcpResult(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: { name: 'md-game-editor-control', version: '1.0.0' },
          });
        case 'notifications/initialized':
          return null;
        case 'tools/list':
          return mcpResult(id, { tools: service.listTools() });
        case 'tools/call': {
          const params = message.params || {};
          const args = params.arguments || {};
          const result = await callToolWithLog('mcp-http', params.name, args, {
            dryRun: args.dryRun,
            confirm: args.confirm,
            source: 'mcp-http',
          });
          if (!result.ok) return mcpError(id, -32000, result.error.message);
          return mcpResult(id, {
            content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
            structuredContent: result.result,
          });
        }
        case 'resources/list':
          return mcpResult(id, { resources: service.listResources() });
        case 'resources/read': {
          const uri = message.params?.uri;
          const result = await service.readResource(uri);
          if (!result.ok) return mcpError(id, -32000, result.error.message);
          return mcpResult(id, {
            contents: [{
              uri,
              mimeType: uri === 'md-editor://project/source' ? 'text/plain' : 'application/json',
              text: typeof result.result?.content === 'string'
                ? result.result.content
                : JSON.stringify(result.result, null, 2),
            }],
          });
        }
        case 'prompts/list':
          return mcpResult(id, { prompts: service.listPrompts() });
        case 'prompts/get': {
          const prompt = service.getPrompt(message.params?.name, message.params?.arguments || {});
          return prompt ? mcpResult(id, prompt) : mcpError(id, -32602, 'unknown prompt');
        }
        default:
          return mcpError(id, -32601, `method not found: ${message.method}`);
      }
    } catch (err) {
      return mcpError(id, -32603, err?.message || err);
    }
  }

  async function handleMcp(req, res) {
    if (!authorize(req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, fail('METHOD_NOT_ALLOWED', 'MCP endpoint accepts POST in this implementation'));
      return;
    }
    const message = await readJsonBody(req);
    const result = await handleMcpMessage(message);
    if (!result) {
      res.writeHead(202, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    sendJson(res, 200, result, { 'Mcp-Protocol-Version': MCP_PROTOCOL_VERSION });
  }

  async function requestListener(req, res) {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.pathname === '/mcp') {
        await handleMcp(req, res);
        return;
      }
      await handleRest(req, res, parsed.pathname);
    } catch (err) {
      log('error', 'request failed', err?.message || err);
      if (!res.headersSent) sendJson(res, 500, fail('INTERNAL_ERROR', err?.message || err));
    }
  }

  function listen(targetPort) {
    return new Promise((resolve, reject) => {
      const next = http.createServer(requestListener);
      next.on('error', reject);
      next.listen(targetPort, '127.0.0.1', () => {
        server = next;
        port = next.address().port;
        log('info', `AI Control listening on 127.0.0.1:${port}`);
        resolve(status());
      });
    });
  }

  async function start(startOptions = {}) {
    if (server) return { ...status(), alreadyRunning: true, token };
    const requested = Number(startOptions.port ?? options.port ?? DEFAULT_PORT);
    try {
      const nextStatus = await listen(requested);
      return { ...nextStatus, token, alreadyRunning: false };
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        const nextStatus = await listen(0);
        return { ...nextStatus, token, alreadyRunning: false, fallbackUsed: true, requestedPort: requested };
      }
      throw err;
    }
  }

  async function stop() {
    if (!server) return { stopped: false, ...status() };
    const current = server;
    return new Promise((resolve) => {
      current.close(() => {
        server = null;
        port = null;
        log('info', 'AI Control stopped');
        resolve({ stopped: true, ...status() });
      });
    });
  }

  return {
    start,
    stop,
    status: () => ({ ...status(), token: server ? token : null }),
    token,
    getLogs: () => logs.slice(),
  };
}

module.exports = {
  DEFAULT_PORT,
  MCP_PROTOCOL_VERSION,
  createEditorControlService,
  createEditorControlServer,
  createToken,
};
