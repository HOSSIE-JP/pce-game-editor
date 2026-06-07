#!/usr/bin/env node
'use strict';

const readline = require('node:readline');

const DEFAULT_URL = 'http://127.0.0.1:17777';
const PROTOCOL_VERSION = '2025-06-18';
const baseUrl = String(process.env.MD_EDITOR_CONTROL_URL || DEFAULT_URL).replace(/\/+$/, '');
const token = process.env.MD_EDITOR_CONTROL_TOKEN || process.env.MD_GAME_EDITOR_TOKEN || '';

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message) {
  process.stderr.write(`[md-game-editor-mcp] ${message}\n`);
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message: String(message || code) } };
}

async function request(path, options = {}) {
  if (!token) {
    throw new Error('MD_EDITOR_CONTROL_TOKEN is required');
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const result = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await result.text();
  const data = text ? JSON.parse(text) : {};
  if (!result.ok || data.ok === false) {
    throw new Error(data?.error?.message || data?.error || `HTTP ${result.status}`);
  }
  return data.result === undefined ? data : data.result;
}

async function handle(message) {
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null;
  switch (message.method) {
    case 'initialize':
      return response(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'md-game-editor-mcp', version: '1.0.0' },
      });
    case 'notifications/initialized':
      return null;
    case 'tools/list': {
      const data = await request('/v1/tools');
      return response(id, { tools: data.tools || [] });
    }
    case 'tools/call': {
      const params = message.params || {};
      const args = params.arguments || {};
      const result = await request('/v1/tools/call', {
        method: 'POST',
        body: {
          name: params.name,
          arguments: args,
          dryRun: Boolean(args.dryRun),
          confirm: args.confirm === true,
        },
      });
      return response(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    }
    case 'resources/list': {
      const data = await request('/v1/resources');
      return response(id, { resources: data.resources || [] });
    }
    case 'resources/read': {
      const uri = message.params?.uri;
      const result = await request('/v1/resources/read', {
        method: 'POST',
        body: { uri },
      });
      return response(id, {
        contents: [{
          uri,
          mimeType: typeof result?.content === 'string' ? 'text/plain' : 'application/json',
          text: typeof result?.content === 'string' ? result.content : JSON.stringify(result, null, 2),
        }],
      });
    }
    case 'prompts/list': {
      const data = await request('/v1/prompts');
      return response(id, { prompts: data.prompts || [] });
    }
    case 'prompts/get': {
      const name = message.params?.name;
      const prompts = await request('/v1/prompts');
      const prompt = (prompts.prompts || []).find((item) => item.name === name);
      if (!prompt) return errorResponse(id, -32602, 'unknown prompt');
      return response(id, {
        description: prompt.description,
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `${prompt.description}\nUse the MD Game Editor tools exposed by this MCP server. Validate project changes with build_run when possible.`,
          },
        }],
      });
    }
    default:
      return errorResponse(id, -32601, `method not found: ${message.method}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    writeMessage(errorResponse(null, -32700, err.message));
    return;
  }

  try {
    const result = await handle(message);
    if (result) writeMessage(result);
  } catch (err) {
    log(err?.message || err);
    writeMessage(errorResponse(message.id ?? null, -32000, err?.message || err));
  }
});
