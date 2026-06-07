'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED_TYPES = new Set([
  'PALETTE',
  'IMAGE',
  'BITMAP',
  'SPRITE',
  'XGM',
  'XGM2',
  'WAV',
  'MAP',
  'TILEMAP',
  'TILESET',
]);

function ensureDirSync(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function normalizeResPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function toAbsPathUnder(root, relPath) {
  const safeRel = normalizeResPath(relPath);
  const abs = path.resolve(root, safeRel);
  const rootAbs = path.resolve(root);
  const rel = path.relative(rootAbs, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('invalid path: outside resource directory');
  }
  return abs;
}

function tokenizeResArgs(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) break;

    const ch = text[i];
    if (ch === '"') {
      i += 1;
      let buf = '';
      while (i < text.length) {
        const c = text[i];
        if (c === '\\' && i + 1 < text.length) {
          buf += text[i + 1];
          i += 2;
          continue;
        }
        if (c === '"') {
          i += 1;
          break;
        }
        buf += c;
        i += 1;
      }
      tokens.push(buf);
      continue;
    }

    let buf = '';
    while (i < text.length && !/\s/.test(text[i])) {
      buf += text[i];
      i += 1;
    }
    if (buf) tokens.push(buf);
  }

  return tokens;
}

function quoteIfNeeded(value) {
  const s = String(value == null ? '' : value);
  if (!s) return '""';
  if (/\s/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function normalizeCommentText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/\s?/, '').replace(/^\s*#\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function parseEntryByType(type, tokens) {
  const name = tokens[1] || '';
  const args = tokens.slice(2);
  const sourcePath = args[0] || '';
  const isTmxInput = String(sourcePath).toLowerCase().endsWith('.tmx');

  const out = {
    type,
    name,
    sourcePath,
    args,
    extras: [],
  };

  switch (type) {
    case 'PALETTE':
      break;
    case 'BITMAP':
      out.compression = args[1] || 'NONE';
      break;
    case 'IMAGE':
      out.compression = args[1] || 'NONE';
      out.mapOpt = args[2] || 'ALL';
      out.mapBase = args[3] || '0';
      out.extras = args.slice(4);
      break;
    case 'SPRITE':
      out.width = args[1] || '2';
      out.height = args[2] || '2';
      out.compression = args[3] || 'NONE';
      out.time = args[4] || '0';
      out.collision = args[5] || 'NONE';
      out.optType = args[6] || 'BALANCED';
      out.optLevel = args[7] || 'FAST';
      out.optDuplicate = args[8] || 'FALSE';
      out.extras = args.slice(9);
      break;
    case 'XGM':
      out.timing = args[1] || 'AUTO';
      out.options = args.slice(2).join(' ');
      break;
    case 'XGM2':
      out.files = args.filter((v) => !String(v).startsWith('-'));
      out.options = args.filter((v) => String(v).startsWith('-')).join(' ');
      break;
    case 'WAV':
      out.driver = args[1] || 'DEFAULT';
      {
        const token2 = String(args[2] || '');
        const token3 = String(args[3] || '');
        const upper2 = token2.toUpperCase();
        const upper3 = token3.toUpperCase();
        const isBool2 = upper2 === 'TRUE' || upper2 === 'FALSE';
        const isBool3 = upper3 === 'TRUE' || upper3 === 'FALSE';

        if (isBool2) {
          out.outRate = '';
          out.far = isBool3 ? upper3 : upper2;
          out.extras = isBool3 ? args.slice(4) : args.slice(3);
          break;
        }

        out.outRate = token2;
        out.far = isBool3 ? upper3 : (token3 || 'TRUE');
        out.extras = args.slice(4);
      }
      break;
    case 'MAP':
      if (isTmxInput) {
        const parsed = parseTmxMapArgs(args);
        Object.assign(out, parsed);
      } else {
        out.tileset = args[1] || '';
        out.compression = args[2] || 'NONE';
        out.mapBase = args[3] || '0';
        out.ordering = args[4] || 'ROW';
        out.extras = args.slice(5);
      }
      break;
    case 'TILEMAP':
      if (isTmxInput) {
        const parsed = parseTmxMapArgs(args);
        Object.assign(out, parsed);
      } else {
        out.tileset = args[1] || '';
        out.compression = args[2] || 'NONE';
        out.mapOpt = args[3] || 'ALL';
        out.mapBase = args[4] || '0';
        out.ordering = args[5] || 'ROW';
        out.extras = args.slice(6);
      }
      break;
    case 'TILESET':
      out.compression = args[1] || 'NONE';
      out.opt = args[2] || 'ALL';
      out.ordering = args[3] || 'ROW';
      out.export = args[4] || 'FALSE';
      out.extras = args.slice(5);
      break;
    default:
      break;
  }

  return out;
}

function parseTmxMapArgs(args) {
  if (args.length > 6) {
    return {
      tileset: args.slice(1, args.length - 4).join(' '),
      compression: args[args.length - 4] || 'NONE',
      mapCompression: args[args.length - 3] || 'NONE',
      mapBase: args[args.length - 2] || '0',
      ordering: args[args.length - 1] || 'ROW',
      extras: [],
    };
  }
  return {
    tileset: args[1] || '',
    compression: args[2] || 'NONE',
    mapCompression: args[3] || 'NONE',
    mapBase: args[4] || '0',
    ordering: args[5] || 'ROW',
    extras: args.slice(6),
  };
}

function entryToResLine(entry) {
  const type = String(entry.type || '').toUpperCase();
  const name = quoteIfNeeded(entry.name || '');

  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`unsupported type: ${type}`);
  }

  const parts = [type, name];

  const source = quoteIfNeeded(normalizeResPath(entry.sourcePath || ''));

  switch (type) {
    case 'PALETTE':
      parts.push(source);
      break;
    case 'BITMAP':
      parts.push(source, entry.compression || 'NONE');
      break;
    case 'IMAGE':
      parts.push(source, entry.compression || 'NONE', entry.mapOpt || 'ALL', entry.mapBase || '0');
      break;
    case 'SPRITE':
      parts.push(
        source,
        spriteSizeToTileToken(entry.width || '2'),
        spriteSizeToTileToken(entry.height || '2'),
        entry.compression || 'NONE',
        entry.time || '0',
        entry.collision || 'NONE',
        entry.optType || 'BALANCED',
        entry.optLevel || 'FAST',
        entry.optDuplicate || 'FALSE'
      );
      break;
    case 'XGM': {
      parts.push(source, entry.timing || 'AUTO');
      const options = String(entry.options || '').trim();
      if (options) {
        parts.push(...tokenizeResArgs(options));
      }
      break;
    }
    case 'XGM2': {
      const files = Array.isArray(entry.files) && entry.files.length
        ? entry.files
        : [entry.sourcePath || ''];
      files.forEach((f) => parts.push(quoteIfNeeded(normalizeResPath(f))));
      const options = String(entry.options || '').trim();
      if (options) {
        parts.push(...tokenizeResArgs(options));
      }
      break;
    }
    case 'WAV':
      parts.push(source, entry.driver || 'DEFAULT');
      if (entry.outRate) parts.push(String(entry.outRate));
      if (entry.far) parts.push(String(entry.far));
      break;
    case 'MAP':
      if (String(entry.sourcePath || '').toLowerCase().endsWith('.tmx')) {
        parts.push(source, quoteIfNeeded(entry.tileset || ''), entry.compression || 'NONE', entry.mapCompression || 'NONE', entry.mapBase || '0');
      } else {
        parts.push(source, quoteIfNeeded(entry.tileset || ''), entry.compression || 'NONE', entry.mapBase || '0');
      }
      if (entry.ordering) parts.push(entry.ordering);
      break;
    case 'TILEMAP':
      if (String(entry.sourcePath || '').toLowerCase().endsWith('.tmx')) {
        parts.push(source, quoteIfNeeded(entry.tileset || ''), entry.compression || 'NONE', entry.mapCompression || 'NONE', entry.mapBase || '0');
      } else {
        parts.push(source, quoteIfNeeded(entry.tileset || ''), entry.compression || 'NONE', entry.mapOpt || 'ALL', entry.mapBase || '0');
      }
      if (entry.ordering) parts.push(entry.ordering);
      break;
    case 'TILESET':
      parts.push(source, entry.compression || 'NONE', entry.opt || 'ALL', entry.ordering || 'ROW', entry.export || 'FALSE');
      break;
    default:
      break;
  }

  if (Array.isArray(entry.extras) && entry.extras.length > 0) {
    entry.extras.filter(Boolean).forEach((v) => parts.push(String(v)));
  }

  return parts.join(' ').trim();
}

function spriteSizeToTileToken(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  const numeric = Number.parseInt(upper, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return '1';
  const tiles = upper.endsWith('P') ? Math.ceil(numeric / 8) : numeric;
  return String(Math.max(1, Math.min(31, tiles)));
}

function entryToResText(entry) {
  const comment = normalizeCommentText(entry.comment || '');
  const line = entryToResLine(entry);
  if (!comment) {
    return line;
  }
  const commentLines = comment.split('\n').map((lineText) => `// ${lineText}`);
  return `${commentLines.join('\n')}\n${line}`;
}

function parseResContent(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  let pendingCommentLines = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingCommentLines = [];
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      pendingCommentLines.push(normalizeCommentText(trimmed));
      return;
    }

    const tokens = tokenizeResArgs(trimmed);
    if (tokens.length < 3) {
      pendingCommentLines = [];
      return;
    }

    const type = String(tokens[0] || '').toUpperCase();
    if (!SUPPORTED_TYPES.has(type)) {
      pendingCommentLines = [];
      return;
    }

    const parsed = parseEntryByType(type, tokens);
    entries.push({
      id: `${idx + 1}:${parsed.type}:${parsed.name}`,
      lineNumber: idx + 1,
      raw: line,
      comment: pendingCommentLines.join('\n').trim(),
      ...parsed,
    });
    pendingCommentLines = [];
  });

  return { lines, entries };
}

function walkResFiles(rootDir) {
  const result = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const dir = stack.pop();
    const children = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
    for (const child of children) {
      const abs = path.join(dir, child.name);
      if (child.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (child.isFile() && child.name.toLowerCase().endsWith('.res')) {
        result.push(abs);
      }
    }
  }

  return result.sort((a, b) => a.localeCompare(b));
}

function listResDefinitions(projectDir) {
  const resRoot = path.join(projectDir, 'res');
  ensureDirSync(resRoot);

  const files = walkResFiles(resRoot).map((abs) => {
    const rel = normalizeResPath(path.relative(resRoot, abs));
    const content = fs.readFileSync(abs, 'utf-8');
    const parsed = parseResContent(content);
    const entries = parsed.entries.map((entry) => ({
      ...entry,
      sourceAbsolutePath: entry.sourcePath ? toAbsPathUnder(resRoot, entry.sourcePath) : '',
      resFileAbsolutePath: abs,
    }));
    return {
      file: rel,
      entryCount: entries.length,
      entries,
    };
  });

  if (files.length === 0) {
    const defaultFile = path.join(resRoot, 'resources.res');
    fs.writeFileSync(defaultFile, '', 'utf-8');
    files.push({ file: 'resources.res', entryCount: 0, entries: [] });
  }

  return {
    resRoot,
    files,
  };
}

function createResFile(projectDir, relPath) {
  const resRoot = path.join(projectDir, 'res');
  ensureDirSync(resRoot);

  const safeRel = normalizeResPath(relPath || '').replace(/^res\//, '');
  if (!safeRel.toLowerCase().endsWith('.res')) {
    throw new Error('res file must end with .res');
  }

  const abs = toAbsPathUnder(resRoot, safeRel);
  ensureDirSync(path.dirname(abs));
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, '', 'utf-8');
  }

  return { file: safeRel };
}

function deleteResFile(projectDir, relPath) {
  const resRoot = path.join(projectDir, 'res');
  ensureDirSync(resRoot);

  const safeRel = normalizeResPath(relPath || '').replace(/^res\//, '');
  if (!safeRel.toLowerCase().endsWith('.res')) {
    throw new Error('res file must end with .res');
  }

  const abs = toAbsPathUnder(resRoot, safeRel);
  if (!fs.existsSync(abs)) {
    throw new Error(`res file not found: ${safeRel}`);
  }
  if (!fs.statSync(abs).isFile()) {
    throw new Error(`not a file: ${safeRel}`);
  }

  fs.unlinkSync(abs);
  return { file: safeRel };
}

function addResEntry(projectDir, relFilePath, entry) {
  const resRoot = path.join(projectDir, 'res');
  const targetRel = normalizeResPath(relFilePath || 'resources.res');
  const abs = toAbsPathUnder(resRoot, targetRel);
  ensureDirSync(path.dirname(abs));
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, '', 'utf-8');
  }

  const line = entryToResText(entry);
  const content = fs.readFileSync(abs, 'utf-8');
  const next = content && !content.endsWith('\n') ? `${content}\n${line}\n` : `${content}${line}\n`;
  fs.writeFileSync(abs, next, 'utf-8');

  return { ok: true };
}

function updateResEntry(projectDir, relFilePath, lineNumber, entry) {
  const resRoot = path.join(projectDir, 'res');
  const targetRel = normalizeResPath(relFilePath || 'resources.res');
  const abs = toAbsPathUnder(resRoot, targetRel);
  if (!fs.existsSync(abs)) {
    throw new Error(`res file not found: ${targetRel}`);
  }

  const content = fs.readFileSync(abs, 'utf-8');
  const lines = content.split(/\r?\n/);
  const lineIndex = Number(lineNumber) - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error('invalid line number');
  }

  const startIndex = lineIndex;
  let commentStart = startIndex;
  while (commentStart - 1 >= 0) {
    const prev = lines[commentStart - 1].trim();
    if (prev.startsWith('//') || prev.startsWith('#')) {
      commentStart -= 1;
      continue;
    }
    break;
  }

  const replacement = entryToResText(entry).split('\n');
  lines.splice(commentStart, startIndex - commentStart + 1, ...replacement);
  fs.writeFileSync(abs, lines.join('\n'), 'utf-8');
  return { ok: true };
}

function deleteResEntry(projectDir, relFilePath, lineNumber) {
  const resRoot = path.join(projectDir, 'res');
  const targetRel = normalizeResPath(relFilePath || 'resources.res');
  const abs = toAbsPathUnder(resRoot, targetRel);
  if (!fs.existsSync(abs)) {
    throw new Error(`res file not found: ${targetRel}`);
  }

  const content = fs.readFileSync(abs, 'utf-8');
  const lines = content.split(/\r?\n/);
  const lineIndex = Number(lineNumber) - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error('invalid line number');
  }

  let deleteStart = lineIndex;
  while (deleteStart - 1 >= 0) {
    const prev = lines[deleteStart - 1].trim();
    if (prev.startsWith('//') || prev.startsWith('#')) {
      deleteStart -= 1;
      continue;
    }
    break;
  }

  lines.splice(deleteStart, lineIndex - deleteStart + 1);
  fs.writeFileSync(abs, lines.join('\n'), 'utf-8');
  return { ok: true };
}

function reorderResEntries(projectDir, relFilePath, orderedLineNumbers) {
  const resRoot = path.join(projectDir, 'res');
  const targetRel = normalizeResPath(relFilePath || 'resources.res');
  const abs = toAbsPathUnder(resRoot, targetRel);
  if (!fs.existsSync(abs)) {
    throw new Error(`res file not found: ${targetRel}`);
  }

  const content = fs.readFileSync(abs, 'utf-8');
  const { entries } = parseResContent(content);
  const entryMap = new Map(entries.map((e) => [Number(e.lineNumber), e]));
  const ordered = Array.isArray(orderedLineNumbers)
    ? orderedLineNumbers.map((ln) => entryMap.get(Number(ln))).filter(Boolean)
    : entries;

  const newContent = ordered.map((e) => entryToResText(e)).join('\n') + (ordered.length > 0 ? '\n' : '');
  fs.writeFileSync(abs, newContent, 'utf-8');
  return { ok: true };
}

function writeAssetIntoRes(projectDir, payload) {
  const resRoot = path.join(projectDir, 'res');
  ensureDirSync(resRoot);

  const sourcePath = payload.sourcePath ? path.resolve(payload.sourcePath) : null;
  const subDir = normalizeResPath(payload.targetSubdir || 'assets');
  const fileName = String(payload.targetFileName || '').trim();
  if (!fileName) {
    throw new Error('target file name is required');
  }

  const destRel = normalizeResPath(path.join(subDir, fileName));
  const destAbs = toAbsPathUnder(resRoot, destRel);
  ensureDirSync(path.dirname(destAbs));

  if (payload.dataUrl && payload.dataUrl.startsWith('data:')) {
    const base64Index = payload.dataUrl.indexOf('base64,');
    if (base64Index < 0) {
      throw new Error('invalid data URL');
    }
    const base64 = payload.dataUrl.slice(base64Index + 7);
    fs.writeFileSync(destAbs, Buffer.from(base64, 'base64'));
  } else if (sourcePath && fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destAbs);
  } else {
    throw new Error('source file is not available');
  }

  return {
    ok: true,
    relativePath: destRel,
    absolutePath: destAbs,
  };
}

module.exports = {
  SUPPORTED_TYPES,
  listResDefinitions,
  createResFile,
  deleteResFile,
  addResEntry,
  updateResEntry,
  deleteResEntry,
  reorderResEntries,
  writeAssetIntoRes,
  normalizeResPath,
  parseResContent,
  entryToResLine,
};
