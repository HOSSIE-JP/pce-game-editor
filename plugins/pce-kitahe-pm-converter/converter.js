'use strict';

const crypto = require('node:crypto');
const { encodeSystemCardText } = require('../../pce-system-card-font');

const MAX_CALL_STACK = 16;
const MAX_EXPANDED_STATES = 4096;
const MAX_SCENES = require('../../pce-vn-manager').VN_MAX_SCENE_COUNT;
const MAX_COMMANDS_PER_SCENE = 255;
const MAX_VARIABLES = 253;
const MAX_BLOCK_SOURCE_INSTRUCTIONS = 120;
// Imported basic blocks are packed below the runtime's hard 255-command / 8192-byte
// limits. The headroom covers conservative ADPCM preload estimation and keeps the
// final VN manager build inspection authoritative.
const PACKED_SCENE_COMMAND_TARGET = 220;
const PACKED_SCENE_BYTE_TARGET = 7000;
const MAX_SCENE_PACK_BYTES = 8192;
const VN_SCENE_PACK_HEADER_BYTES = 20;
const VN_SCENE_PACK_COMMAND_BYTES = 19;
const VN_SCENE_PACK_MESSAGE_BYTES = 13;
const VN_SCENE_PACK_CHOICE_BYTES = 6;
const VN_SCENE_PACK_CHOICE_OPTION_BYTES = 7;
const VN_SCENE_PACK_SWITCH_BYTES = 5;
const VN_SCENE_PACK_SWITCH_CASE_BYTES = 4;
const MESSAGE_COLUMNS = 17;
const MESSAGE_ROWS = 4;
const MESSAGE_PAGE_GLYPHS = MESSAGE_COLUMNS * MESSAGE_ROWS - 1;
const KITAHE_SOURCE_SCREEN_WIDTH = 640;
const PCE_IMPORTED_BG_WIDTH = 224;
const PCE_IMPORTED_BG_TILE_SIZE = 8;
const PCE_IMPORTED_DEFAULT_BG_X_TILES = 2;
const PCE_IMPORTED_SPRITE_Y = 17;
const PCE_IMPORTED_BG_FADE_FRAMES = 30;
const UNSUPPORTED_FONT_PLACEHOLDER = '□';
const DEFAULT_PROTAGONIST_NAME = 'ハドソン';
const PROTAGONIST_NAME_TOKENS = Object.freeze([
  '【主人公】',
  '\\主人公',
  '＼主人公',
  '￥主人公',
  '主人公',
].sort((left, right) => Array.from(right).length - Array.from(left).length));
const PROTAGONIST_NAME_TOKEN_SET = new Set(PROTAGONIST_NAME_TOKENS);

const BUTTON_NAMES = new Set([
  'ABTN', 'BBTN', 'XBTN', 'YBTN', 'START', 'STARTBTN',
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'LBTN', 'RBTN',
]);

const KNOWN_COMMANDS = new Set([
  'LABEL', 'GOTO', 'GOT', 'INCLUDE', 'CALL', 'RETURN', 'END', 'RMODE',
  'DEFINE', 'IF', 'RANDOM', 'NAME', 'ENAME',
  'WINDOW', 'MSG', 'CLEAR', 'CLEARW', 'COLOR', 'MODE', 'SETWAIT', 'MENU',
  'MCOLOR', 'PRF', 'SHADOW', 'SETPOLY', 'WFADE', 'SETWZ', 'SETWXY',
  'WMOVE', 'SETALPHA',
  'CGDIR', 'LCG', 'LINKCG', 'LINK', 'CCG', 'ICG', 'DCG', 'UNLOADCG',
  'UNLOAD', 'UNL', 'CLEARCG', 'CLS', 'SETBC', 'CPCM', 'XCOMP', 'DECOMP',
  'DECOM', 'FADE', 'SCREEN', 'SCG', 'MCG', 'RCG', 'RCGX', 'RCGY', 'WCG',
  'CFADE', 'SETEL', 'SCCLEAR', 'SCCOLOR', 'SCROLL',
  'PCMDIR', 'LPCM', 'PLAYP', 'STOPP', 'PCMVOL',
  'MIDIDIR', 'IMIDI', 'PLAYM', 'STOPM', 'MIDIVOL',
  'PLAYGD', 'STOPGD', 'STOPG', 'GDVOL',
  'WAIT', 'XWAIT', 'WAITBTN', 'KEY', 'ONG', 'ONRMG', 'ONMG', 'ONC',
  'ONTG', 'INKEY',
  'BUFFER', 'RECORD', 'PUSHREC', 'POPREC', 'SAVE', 'LOAD', 'DLOAD',
  'DXLOAD', 'DSAVE', 'VMSC', 'VMSF', 'VMSM', 'ISMOUNT', 'ISFILE',
  'LICON', 'SICON', 'INITVIEW', 'BROWSE', 'OPTION', 'VIEW', 'VIEWC',
  'VIEWS', 'VIEWX', 'SETS', 'CLEARV', 'READREC', 'WRITEREC',
]);

const APPROXIMATE_VISUAL_COMMANDS = new Set([
  'SCG', 'MCG', 'RCG', 'RCGX', 'RCGY', 'WCG', 'CFADE', 'WFADE',
  'WMOVE', 'SETWXY', 'SETALPHA', 'SCROLL',
]);

const OMITTED_COMMANDS = new Set([
  'INCLUDE', 'ENAME', 'WINDOW', 'MODE', 'SETWAIT', 'MCOLOR', 'PRF', 'SHADOW',
  'SETPOLY', 'SETWZ', 'DCG', 'UNLOADCG', 'UNLOAD', 'UNL', 'CLEARCG',
  'CLS', 'SETBC', 'CPCM', 'XCOMP', 'DECOMP', 'DECOM', 'SETEL',
  'SCCLEAR', 'SCCOLOR', 'PCMVOL', 'MIDIDIR', 'IMIDI', 'MIDIVOL', 'GDVOL', 'XWAIT',
  'KEY', 'INKEY', 'BUFFER', 'RECORD', 'PUSHREC', 'POPREC', 'SAVE',
  'LOAD', 'DLOAD', 'DXLOAD', 'DSAVE', 'VMSC', 'VMSF', 'VMSM',
  'ISMOUNT', 'ISFILE', 'LICON', 'SICON', 'INITVIEW', 'BROWSE',
  'OPTION', 'VIEW', 'VIEWC', 'VIEWS', 'VIEWX', 'SETS', 'CLEARV',
  'READREC', 'WRITEREC', 'RMODE',
]);

function isSupportedSpriteVisibilityInstruction(instruction) {
  if (!instruction) return false;
  if (instruction.op === 'CLEARCG'
    || instruction.op === 'UNLOADCG'
    || instruction.op === 'UNLOAD'
    || instruction.op === 'UNL') return true;
  return instruction.op === 'DCG'
    && String(instruction.args[1] || '').trim().toUpperCase() === 'OFF';
}

const FLOW_BOUNDARY_COMMANDS = new Set([
  'LABEL', 'GOTO', 'GOT', 'CALL', 'RETURN', 'END', 'IF',
  'MENU', 'ONRMG', 'ONMG', 'ONG', 'ONC', 'WAITBTN',
]);

function isBranchingTimerInstruction(instruction) {
  return instruction?.op === 'ONTG'
    && instruction.args.length >= 2
    && Boolean(String(instruction.args[1] || '').trim());
}

function isFlowBoundaryInstruction(instruction) {
  return FLOW_BOUNDARY_COMMANDS.has(instruction?.op)
    || isBranchingTimerInstruction(instruction);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function normalizeRelativeScriptPath(value = '') {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return '';
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return '';
  return parts.join('/');
}

function cleanToken(value = '') {
  let text = String(value ?? '').trim();
  if (text.startsWith('"')) text = text.slice(1);
  if (text.endsWith('"')) text = text.slice(0, -1);
  return text.trim();
}

function normalizeSourcePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/(^|\/)\.\//g, '$1');
}

function appendExtension(value, extension) {
  const text = normalizeSourcePath(cleanToken(value));
  if (!text) return '';
  return text.toLowerCase().endsWith(extension.toLowerCase()) ? text : `${text}${extension}`;
}

function joinSourcePath(directory, file) {
  const dir = normalizeSourcePath(directory);
  const leaf = normalizeSourcePath(file);
  return normalizeSourcePath([dir, leaf].filter(Boolean).join('/'));
}

function safeIdentifier(value = '', fallback = 'item', maxLength = 48) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
  return normalized || fallback;
}

function normalizeVariableName(value = '', fallback = 'var_1') {
  return safeIdentifier(value, fallback, 32);
}

function isVariableIdentifier(value = '') {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || '').trim());
}

function normalizeLabel(value = '') {
  return safeIdentifier(value, '', 32);
}

function diagnostic(severity, code, message, instruction = null, extra = {}) {
  return {
    severity,
    code,
    message,
    ...(instruction ? { script: instruction.script, line: instruction.line } : {}),
    ...extra,
  };
}

function replaceUnsupportedSystemCardCharacters(value, instruction, field, diagnostics) {
  let output = '';
  let characterIndex = 0;
  for (const character of String(value ?? '')) {
    if (character === '\r') {
      output += character;
      continue;
    }
    try {
      encodeSystemCardText(character, field, {
        terminate: false,
        maxCharacters: 1,
      });
      output += character;
    } catch {
      const codePoint = `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
      const choiceMatch = /^choice\[(\d+)\]$/u.exec(field);
      const fieldLabel = field === 'message'
        ? '本文'
        : (field === 'speaker' ? '話者名' : (choiceMatch ? `選択肢${Number(choiceMatch[1]) + 1}` : field));
      output += UNSUPPORTED_FONT_PLACEHOLDER;
      diagnostics.push(diagnostic(
        'warning',
        'font-character-replaced',
        `System Card jp-v3非対応文字 ${codePoint}「${character}」を${fieldLabel}の文字位置${characterIndex}で「${UNSUPPORTED_FONT_PLACEHOLDER}」へ置換しました。`,
        instruction,
        {
          field,
          characterIndex,
          codePoint,
          originalCharacter: character,
          replacement: UNSUPPORTED_FONT_PLACEHOLDER,
        },
      ));
    }
    characterIndex += 1;
  }
  return output;
}

function diagnosticKey(entry) {
  return [
    entry.severity,
    entry.code,
    entry.script || '',
    entry.line || 0,
    entry.message,
  ].join('|');
}

function dedupeDiagnostics(entries = []) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = diagnosticKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitArguments(value = '') {
  const result = [];
  let current = '';
  let quoted = false;
  for (const character of String(value || '')) {
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === ',' && !quoted) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  result.push(current.trim());
  return { args: result, unclosedQuote: quoted };
}

function parseCondition(value = '') {
  const match = String(value || '').match(/^\s*(.+?)\s*(==|!=|<>|<=|>=|<|>)\s*(.+?)\s*$/i);
  if (!match) return null;
  let rightAndAction = match[3].trim();
  let right = '';
  let action = '';
  const then = rightAndAction.match(/^(.*?)\s+THEN\s+(.+?)\s*$/i);
  if (then) {
    right = then[1].trim();
    action = then[2].trim();
  } else {
    const directGoto = rightAndAction.match(/^(.*?)\s+(GOT(?:O)?\s+.+?)\s*$/i);
    if (!directGoto) return null;
    right = directGoto[1].trim();
    action = directGoto[2].trim();
  }
  if (!right || !action) return null;
  return {
    left: cleanToken(match[1]),
    operator: match[2],
    right: cleanToken(right),
    then: action,
  };
}

function parseAssignment(value = '') {
  const match = String(value || '').match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) return null;
  const rhs = cleanToken(match[2]);
  const arithmetic = rhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*(-?(?:0x[0-9a-f]+|\d+))$/i);
  return {
    name: match[1],
    value: rhs,
    arithmetic: arithmetic
      ? { source: arithmetic[1], operator: arithmetic[2], amount: arithmetic[3] }
      : null,
  };
}

function parseInstruction(rawLine, script, lineNumber) {
  const raw = String(rawLine || '').replace(/\r$/, '');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const assignment = parseAssignment(trimmed);
  if (assignment) {
    const quoteCount = Array.from(trimmed).filter((character) => character === '"').length;
    return {
      op: 'ASSIGN',
      args: [assignment.name, assignment.value],
      assignment,
      unclosedQuote: (quoteCount % 2) !== 0,
      raw,
      script,
      line: lineNumber,
    };
  }

  const firstSpace = trimmed.search(/\s/);
  const op = (firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace)).toUpperCase();
  const remainder = firstSpace < 0 ? '' : trimmed.slice(firstSpace + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(op)) {
    return {
      op: 'UNKNOWN',
      args: [],
      raw,
      script,
      line: lineNumber,
    };
  }

  if (op === 'IF') {
    return {
      op,
      args: [],
      condition: parseCondition(remainder),
      raw,
      script,
      line: lineNumber,
    };
  }

  const split = splitArguments(remainder);
  return {
    op,
    args: split.args.map(cleanToken),
    unclosedQuote: split.unclosedQuote,
    raw,
    script,
    line: lineNumber,
  };
}

function decodeScrBuffer(buffer, sourceName = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  try {
    return {
      text: new TextDecoder('shift_jis', { fatal: true }).decode(bytes),
      diagnostics: [],
    };
  } catch (error) {
    return {
      text: new TextDecoder('shift_jis').decode(bytes),
      diagnostics: [
        diagnostic(
          'error',
          'invalid-cp932',
          `CP932として解釈できないバイト列があります: ${sourceName || 'SCR'}`,
        ),
      ],
    };
  }
}

function parseScrBuffer(relativePath, buffer) {
  const script = normalizeRelativeScriptPath(relativePath);
  const decoded = decodeScrBuffer(buffer, script);
  const diagnostics = [...decoded.diagnostics];
  const instructions = decoded.text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line, index) => parseInstruction(line, script, index + 1))
    .filter(Boolean);

  instructions.forEach((instruction) => {
    if (instruction.unclosedQuote) {
      diagnostics.push(diagnostic(
        'warning',
        'unclosed-quote',
        '閉じ引用符のない文字列を行末までの値として扱いました。',
        instruction,
      ));
    }
    if (instruction.op === 'UNKNOWN') {
      diagnostics.push(diagnostic(
        'warning',
        'unknown-line',
        'コマンドとして判定できない行を省略します。',
        instruction,
      ));
    } else if (!KNOWN_COMMANDS.has(instruction.op) && instruction.op !== 'ASSIGN') {
      diagnostics.push(diagnostic(
        'warning',
        'unknown-command',
        `未解析コマンド ${instruction.op} を省略します。`,
        instruction,
      ));
    }
    if (instruction.op === 'IF' && !instruction.condition) {
      diagnostics.push(diagnostic(
        'error',
        'invalid-if',
        'IFの条件式を解析できません。',
        instruction,
      ));
    }
    if (instruction.op === 'DEFINE' && !isVariableIdentifier(instruction.args[0])) {
      diagnostics.push(diagnostic(
        'error',
        'invalid-variable-name',
        'DEFINEには有効なvariable名が必要です。',
        instruction,
      ));
    }
  });

  const labels = new Map();
  instructions.forEach((instruction, index) => {
    if (instruction.op !== 'LABEL') return;
    const label = String(instruction.args[0] || '').trim().toUpperCase();
    if (!label) {
      diagnostics.push(diagnostic('error', 'empty-label', 'LABEL名が空です。', instruction));
      return;
    }
    if (labels.has(label)) {
      diagnostics.push(diagnostic(
        'error',
        'duplicate-label',
        `LABEL ${instruction.args[0]} が同じSCR内で重複しています。`,
        instruction,
      ));
      return;
    }
    labels.set(label, index);
  });

  return {
    path: script,
    hash: sha256(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])),
    byteLength: Buffer.byteLength(buffer || []),
    instructions,
    labels,
    diagnostics,
  };
}

function numericValue(value, constants = new Map()) {
  const token = cleanToken(value);
  if (/^-?0x[0-9a-f]+$/i.test(token)) {
    const sign = token.startsWith('-') ? -1 : 1;
    return sign * parseInt(token.replace(/^-/, ''), 16);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
  const known = constants.get(token.toUpperCase());
  return typeof known === 'number' && Number.isFinite(known) ? known : null;
}

function scalarValue(value, constants = new Map()) {
  const number = numericValue(value, constants);
  if (number !== null) return number;
  const token = cleanToken(value);
  if (constants.has(token.toUpperCase())) return constants.get(token.toUpperCase());
  return token;
}

function runtimeAssignmentSpec(assignment, runtimeVariables, constants = new Map()) {
  if (!assignment) return null;
  const name = String(assignment.name || '').trim().toUpperCase();
  if (!name) return null;
  if (assignment.arithmetic) {
    const sourceName = String(assignment.arithmetic.source || '').trim().toUpperCase();
    const amount = numericValue(assignment.arithmetic.amount, constants);
    if (amount === null) return null;
    if (sourceName === name) {
      const delta = assignment.arithmetic.operator === '+' ? amount : -amount;
      return {
        operation: delta >= 0 ? 'add' : 'sub',
        value: Math.round(Math.abs(delta)),
      };
    }
    if (runtimeVariables.has(sourceName)) return null;
    const source = numericValue(assignment.arithmetic.source, constants);
    if (source === null) return null;
    return {
      operation: 'set',
      value: Math.round(assignment.arithmetic.operator === '+' ? source + amount : source - amount),
    };
  }
  const sourceName = String(assignment.value || '').trim().toUpperCase();
  if (runtimeVariables.has(sourceName)) return null;
  const value = numericValue(assignment.value, constants);
  if (value === null) return null;
  return { operation: 'set', value: Math.round(value) };
}

function isSignedInt16(value) {
  return Number.isInteger(value) && value >= -32768 && value <= 32767;
}

function resolveSlot(value, constants = new Map()) {
  const scalar = scalarValue(value, constants);
  return String(scalar ?? '').trim().toUpperCase();
}

function buildProgramLookup(programs) {
  const exact = new Map();
  const basename = new Map();
  programs.forEach((program, index) => {
    exact.set(program.path.toUpperCase(), index);
    const name = program.path.split('/').pop().toUpperCase();
    if (!basename.has(name)) basename.set(name, []);
    basename.get(name).push(index);
  });
  return { exact, basename };
}

function resolveProgramIndex(requested, programs, lookup) {
  const normalized = normalizeRelativeScriptPath(appendExtension(requested, '.SCR'));
  if (!normalized) return -1;
  if (lookup.exact.has(normalized.toUpperCase())) return lookup.exact.get(normalized.toUpperCase());
  if (normalized.includes('/')) return -1;
  const byName = lookup.basename.get(normalized.split('/').pop().toUpperCase()) || [];
  if (byName.length === 1) return byName[0];
  return byName.length > 1 ? -2 : -1;
}

function stateKey(fileIndex, pc, stack) {
  const frames = stack.map((frame) => `${frame.fileIndex}:${frame.pc}:${frame.targetFileIndex}:${frame.targetPc}`);
  return `${fileIndex}:${pc}|${frames.join('>')}`;
}

function findPhotoTimeoutTarget(program, pc) {
  const instruction = program.instructions[pc];
  if (!instruction || (instruction.op !== 'GOTO' && instruction.op !== 'GOT')) return '';
  const requested = String(instruction.args[0] || '').trim().toUpperCase();
  const selfIndex = program.labels.get(requested);
  if (selfIndex == null || selfIndex > pc) return '';
  const min = Math.max(0, selfIndex - 8);
  for (let index = pc - 1; index >= min; index -= 1) {
    const candidate = program.instructions[index];
    if (candidate.op === 'ONTG' && candidate.args.length >= 2) {
      return String(candidate.args[1] || '').trim();
    }
  }
  return '';
}

function buildReachability(programs, entryScript) {
  const diagnostics = programs.flatMap((program) => program.diagnostics);
  if (!programs.length) {
    return {
      diagnostics: [...diagnostics, diagnostic('error', 'no-scripts', '変換対象SCRが選択されていません。')],
      nodes: new Map(),
      order: [],
      reachableLocations: new Set(),
      entryKey: '',
      rootKeys: [],
    };
  }

  const lookup = buildProgramLookup(programs);
  let entryFileIndex = resolveProgramIndex(entryScript || programs[0].path, programs, lookup);
  if (entryFileIndex === -2) {
    diagnostics.push(diagnostic(
      'error',
      'ambiguous-entry-script',
      `entry SCR ${entryScript} は選択対象内でbasenameが重複しています。relative pathで指定してください。`,
    ));
    entryFileIndex = 0;
  }
  if (entryFileIndex < 0) {
    diagnostics.push(diagnostic('error', 'missing-entry-script', `entry SCR ${entryScript} が選択対象にありません。`));
    entryFileIndex = 0;
  }

  const nodes = new Map();
  const order = [];
  const reachableLocations = new Set();
  const queued = [];
  let queuedCursor = 0;
  const hasQueuedState = () => queuedCursor < queued.length;
  const sourceInstructionCount = programs.reduce((sum, program) => sum + program.instructions.length, 0);
  const maxExpandedStates = sourceInstructionCount + (MAX_EXPANDED_STATES * programs.length);
  const queueState = (fileIndex, pc, stack, edgeKind = 'next') => {
    const program = programs[fileIndex];
    if (!program || pc < 0 || pc >= program.instructions.length) return null;
    const key = stateKey(fileIndex, pc, stack);
    if (!nodes.has(key)) {
      if (nodes.size >= maxExpandedStates) {
        diagnostics.push(diagnostic(
          'error',
          'expanded-state-limit',
          `CALL/分岐の展開状態が安全上限 ${maxExpandedStates}（元命令 ${sourceInstructionCount} + 選択SCRごとの追加 ${MAX_EXPANDED_STATES}）を超えました。`,
          program.instructions[pc],
        ));
        return null;
      }
      nodes.set(key, {
        key,
        fileIndex,
        pc,
        stack,
        instruction: program.instructions[pc],
        edges: [],
        discoveryIndex: nodes.size,
      });
      order.push(key);
      queued.push(key);
    }
    return { key, kind: edgeKind };
  };

  const rootFileIndexes = [
    entryFileIndex,
    ...programs.map((_program, fileIndex) => fileIndex).filter((fileIndex) => fileIndex !== entryFileIndex),
  ];
  const rootKeys = [];
  const rootKeySet = new Set();
  const recordRoot = (root) => {
    if (root && !rootKeySet.has(root.key)) {
      rootKeySet.add(root.key);
      rootKeys.push(root.key);
    }
    return root;
  };
  let rootFileCursor = 0;
  const entry = recordRoot(queueState(rootFileIndexes[rootFileCursor], 0, []));
  rootFileCursor += 1;
  const entryKey = entry?.key || '';
  const queueNextSelectedRoot = () => {
    while (!hasQueuedState() && rootFileCursor < rootFileIndexes.length) {
      const fileIndex = rootFileIndexes[rootFileCursor];
      rootFileCursor += 1;
      recordRoot(queueState(fileIndex, 0, []));
    }
  };

  function labelTarget(program, requested, instruction) {
    const label = String(requested || '').trim().toUpperCase();
    if (program.labels.has(label)) return program.labels.get(label);
    if (label === 'TOP') return 0;
    if (!program.labels.has(label)) {
      diagnostics.push(diagnostic(
        'error',
        'unresolved-label',
        `LABEL ${requested || '(空)'} が ${program.path} に見つかりません。`,
        instruction,
      ));
      return -1;
    }
    return -1;
  }

  function branchTarget(node, label, fileArg, kind) {
    let fileIndex = node.fileIndex;
    if (fileArg) {
      fileIndex = resolveProgramIndex(fileArg, programs, lookup);
      if (fileIndex === -2) {
        diagnostics.push(diagnostic(
          'error',
          'ambiguous-external-script',
          `外部SCR ${fileArg} は選択対象内でbasenameが重複しているため遷移先を決定できません。`,
          node.instruction,
        ));
        return null;
      }
      if (fileIndex < 0) {
        diagnostics.push(diagnostic(
          'warning',
          'unselected-external-script',
          `選択されていないSCR ${fileArg} への遷移を終端として扱います。`,
          node.instruction,
        ));
        return null;
      }
    }
    const pc = labelTarget(programs[fileIndex], label, node.instruction);
    if (pc < 0) return null;
    return queueState(fileIndex, pc, node.stack, kind);
  }

  while (hasQueuedState() || rootFileCursor < rootFileIndexes.length) {
    if (!hasQueuedState()) queueNextSelectedRoot();
    const key = queued[queuedCursor];
    queuedCursor += 1;
    if (!key) continue;
    const node = nodes.get(key);
    if (!node) continue;
    const { instruction } = node;
    const program = programs[node.fileIndex];
    reachableLocations.add(`${node.fileIndex}:${node.pc}`);

    const next = (kind = 'next') => queueState(node.fileIndex, node.pc + 1, node.stack, kind);
    const add = (edge) => {
      if (edge && !node.edges.some((candidate) => (
        candidate.key === edge.key
        && candidate.kind === edge.kind
        && candidate.value === edge.value
      ))) {
        node.edges.push(edge);
      }
    };

    if (instruction.op === 'END') continue;

    if (instruction.op === 'GOTO' || instruction.op === 'GOT') {
      const timeoutTarget = !instruction.args[1] ? findPhotoTimeoutTarget(program, node.pc) : '';
      if (timeoutTarget) {
        add(branchTarget(node, timeoutTarget, '', 'timeout'));
        diagnostics.push(diagnostic(
          'warning',
          'photo-timeout-approximation',
          `撮影入力待ちの自己ループを除去し、timeout側 LABEL ${timeoutTarget} へ固定しました。`,
          instruction,
        ));
      } else {
        add(branchTarget(node, instruction.args[0], instruction.args[1], 'goto'));
      }
      continue;
    }

    if (instruction.op === 'CALL') {
      const targetPc = labelTarget(program, instruction.args[0], instruction);
      if (targetPc < 0) continue;
      if (node.stack.length >= MAX_CALL_STACK) {
        diagnostics.push(diagnostic(
          'error',
          'call-stack-limit',
          `CALL stackが上限 ${MAX_CALL_STACK} を超えます。`,
          instruction,
        ));
        continue;
      }
      const recursive = node.stack.some((frame) => (
        frame.targetFileIndex === node.fileIndex && frame.targetPc === targetPc
      ));
      if (recursive || targetPc === node.pc) {
        diagnostics.push(diagnostic('error', 'recursive-call', '再帰CALLは変換できません。', instruction));
        continue;
      }
      const stack = [...node.stack, {
        fileIndex: node.fileIndex,
        pc: node.pc + 1,
        targetFileIndex: node.fileIndex,
        targetPc,
      }];
      add(queueState(node.fileIndex, targetPc, stack, 'call'));
      continue;
    }

    if (instruction.op === 'RETURN') {
      if (!node.stack.length) {
        diagnostics.push(diagnostic(
          'error',
          'return-without-call',
          'CALL元のないRETURNは変換できません。',
          instruction,
        ));
        continue;
      }
      const frame = node.stack[node.stack.length - 1];
      add(queueState(frame.fileIndex, frame.pc, node.stack.slice(0, -1), 'return'));
      continue;
    }

    if (instruction.op === 'IF' && instruction.condition) {
      const thenGoto = instruction.condition.then.match(/^GOT(?:O)?\s+([^,\s]+)(?:\s*,\s*(.+))?$/i);
      if (thenGoto) {
        add(branchTarget(node, thenGoto[1], thenGoto[2], 'if-true'));
        add(next('if-false'));
      } else {
        add(next('next'));
      }
      continue;
    }

    if (instruction.op === 'ONRMG' || instruction.op === 'ONMG') {
      instruction.args.slice(4).forEach((label, value) => {
        if (!label || label.toUpperCase() === 'NULL') return;
        const edge = branchTarget(node, label, '', 'choice');
        if (edge) edge.value = value;
        add(edge);
      });
      if (!node.edges.length) {
        diagnostics.push(diagnostic('error', 'empty-menu-branch', 'MENUの分岐先を解決できません。', instruction));
      }
      continue;
    }

    if (instruction.op === 'ONG') {
      const source = String(instruction.args[0] || '').trim().toUpperCase();
      if (!BUTTON_NAMES.has(source) && instruction.args.length > 1) {
        instruction.args.slice(1).forEach((label, value) => {
          if (!label || label.toUpperCase() === 'NULL') return;
          const edge = branchTarget(node, label, '', 'input-choice');
          if (edge) edge.value = value;
          add(edge);
        });
        if (!node.edges.length) add(next());
        continue;
      }
    }

    if (instruction.op === 'ONC') {
      instruction.args.slice(1).forEach((label, value) => {
        if (!label || label.toUpperCase() === 'NULL') return;
        const edge = branchTarget(node, label, '', 'switch');
        if (edge) edge.value = value;
        add(edge);
      });
      if (!node.edges.length) add(next());
      continue;
    }

    if (isBranchingTimerInstruction(instruction)) {
      add(branchTarget(node, instruction.args[1], '', 'timeout'));
      diagnostics.push(diagnostic(
        'warning',
        'timer-timeout-approximation',
        `ONTGをtimeout側 LABEL ${instruction.args[1]} へ固定しました。`,
        instruction,
      ));
      continue;
    }

    add(next());
  }

  programs.forEach((program) => {
    if (!program.instructions.length) {
      diagnostics.push(diagnostic(
        'warning',
        'empty-selected-script',
        `選択SCR ${program.path} に変換可能な命令がありません。`,
      ));
    }
  });

  return {
    diagnostics: dedupeDiagnostics(diagnostics),
    nodes,
    order,
    reachableLocations,
    entryKey,
    rootKeys,
  };
}

function requirementKey(kind, source) {
  return `${kind}-${sha256(`${kind}\0${stableJson(source)}`).slice(0, 16)}`;
}

function assetSourceIdentity(kind, source, details = {}) {
  if (kind === 'image') {
    const rawParts = Array.isArray(source)
      ? source
      : (Array.isArray(details.parts) ? details.parts : [source]);
    const rawCrops = Array.isArray(details.crops) ? details.crops : [];
    return {
      parts: rawParts.map((part) => normalizeSourcePath(cleanToken(part))),
      crops: rawCrops.map((crop) => ({
        width: crop?.width != null && crop.width !== '' && Number.isFinite(Number(crop.width)) ? Number(crop.width) : null,
        height: crop?.height != null && crop.height !== '' && Number.isFinite(Number(crop.height)) ? Number(crop.height) : null,
      })),
    };
  }
  if (kind === 'p04') {
    const playbackRate = Number(details.playbackRate);
    return {
      source: normalizeSourcePath(cleanToken(source)),
      usage: String(details.usage || '').trim().toLowerCase(),
      loop: details.loop === true,
      playbackRate: Number.isFinite(playbackRate) && playbackRate > 0
        ? Math.round(playbackRate)
        : 32000,
    };
  }
  if (kind === 'midi') return normalizeSourcePath(cleanToken(source));
  return source;
}

function assetSourceKey(kind, source, details = {}) {
  return requirementKey(kind, assetSourceIdentity(kind, source, details));
}

function assetMatchStem(value = '') {
  return normalizeSourcePath(cleanToken(value)).replace(/\.[^./]+$/u, '');
}

function assetMatchKey(value = '') {
  return assetMatchStem(value).toLocaleLowerCase('en-US');
}

function assetMatchName(requirement = {}) {
  const detailParts = Array.isArray(requirement?.details?.parts)
    ? requirement.details.parts
    : [];
  const sourceParts = detailParts.length
    ? detailParts
    : String(requirement?.source || '').split(/\s+\+\s+/u);
  const stems = sourceParts.map(assetMatchStem).filter(Boolean);
  if (!stems.length) return '';
  if (stems.length === 1) return stems[0];

  const folded = stems.map((value) => value.toLocaleLowerCase('en-US'));
  let prefixLength = folded[0].length;
  for (let index = 1; index < folded.length && prefixLength > 0; index += 1) {
    prefixLength = Math.min(prefixLength, folded[index].length);
    let cursor = 0;
    while (cursor < prefixLength && folded[0][cursor] === folded[index][cursor]) cursor += 1;
    prefixLength = cursor;
  }
  const directoryLength = stems[0].lastIndexOf('/') + 1;
  const common = stems[0].slice(0, prefixLength).replace(/[\s._-]+$/u, '');
  return common.length > directoryLength ? common : '';
}

function addRequirement(requirements, kind, source, occurrence, details = {}) {
  const key = assetSourceKey(kind, source, details);
  if (!requirements.has(key)) {
    requirements.set(key, {
      key,
      kind,
      source: typeof source === 'string' ? source : source.join(' + '),
      occurrences: [],
      details,
    });
  }
  const requirement = requirements.get(key);
  if (!requirement.occurrences.some((item) => item.script === occurrence.script && item.line === occurrence.line)) {
    requirement.occurrences.push(occurrence);
  }
  return requirement;
}

function replaceNames(text, replacements, protagonistName) {
  let result = String(text || '');
  const protagonist = String(protagonistName ?? '').trim();
  Array.from(replacements.entries())
    .filter(([key]) => key && !(protagonist && PROTAGONIST_NAME_TOKEN_SET.has(key)))
    .sort((left, right) => right[0].length - left[0].length)
    .forEach(([key, value]) => {
      result = result.split(key).join(value);
    });
  if (protagonist) {
    PROTAGONIST_NAME_TOKENS.forEach((key) => {
      result = result.split(key).join(protagonist);
    });
  }
  return result;
}

function normalizeMessageText(value = '') {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[ \t]*\n+[ \t]*/g, '');
}

function paginateMessage(text) {
  const glyphs = Array.from(normalizeMessageText(text));
  const pages = [];
  for (let offset = 0; offset < glyphs.length; offset += MESSAGE_PAGE_GLYPHS) {
    pages.push(glyphs.slice(offset, offset + MESSAGE_PAGE_GLYPHS).join(''));
  }
  return pages.length ? pages : [''];
}

function scriptTextColor(value, constants = new Map()) {
  const resolved = numericValue(value, constants);
  if (resolved === null || resolved < 0 || resolved > 0xffff) return '';
  const word = Math.round(resolved);
  const component = (shift) => ((word >> shift) & 0x0f) * 17;
  return `#${[component(8), component(4), component(0)]
    .map((entry) => entry.toString(16).padStart(2, '0'))
    .join('')}`;
}

function importedBackgroundLayout(assetMapping, assetById) {
  const asset = assetById.get(String(assetMapping?.assetId || ''));
  const rawWidth = asset?.options?.width ?? asset?.data?.generated?.width;
  const width = Number(rawWidth);
  const xTiles = Number.isFinite(Number(assetMapping?.x))
    ? Math.round(Number(assetMapping.x))
    : PCE_IMPORTED_DEFAULT_BG_X_TILES;
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : PCE_IMPORTED_BG_WIDTH,
    offsetX: xTiles * PCE_IMPORTED_BG_TILE_SIZE,
  };
}

function defaultImportedBackgroundLayout() {
  return {
    width: PCE_IMPORTED_BG_WIDTH,
    offsetX: PCE_IMPORTED_DEFAULT_BG_X_TILES * PCE_IMPORTED_BG_TILE_SIZE,
  };
}

function importedSpriteLayout(assetMapping, assetById) {
  const asset = assetById.get(String(assetMapping?.assetId || ''));
  const transform = asset?.data?.import?.kitahePm?.imageTransform;
  const sourceCropX = Number(transform?.sourceCrop?.x);
  const rawWidth = asset?.options?.width
    ?? asset?.data?.generated?.width
    ?? transform?.outputSize?.width;
  const width = Number(rawWidth);
  return {
    sourceCropX: Number.isFinite(sourceCropX) && sourceCropX >= 0 ? Math.round(sourceCropX) : 0,
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
  };
}

function importedSpriteX(
  value,
  constants,
  instruction,
  diagnostics,
  backgroundLayout = null,
  spriteLayout = null,
) {
  const sourceX = cleanToken(value) ? numericValue(value, constants) : 0;
  if (sourceX === null) {
    diagnostics.push(diagnostic(
      'error',
      'invalid-sprite-source-x',
      'ICGのSprite X座標を数値・16進・静的定数として解決できません。',
      instruction,
    ));
    return 0;
  }
  const layout = backgroundLayout || defaultImportedBackgroundLayout();
  const sprite = spriteLayout || { sourceCropX: 0, width: 0 };
  const scaled = Math.round(
    (sourceX + sprite.sourceCropX) * layout.width / KITAHE_SOURCE_SCREEN_WIDTH,
  );
  const translated = layout.offsetX + scaled;
  const minX = Math.max(0, Math.min(319, layout.offsetX));
  const bgRight = layout.offsetX + layout.width - Math.max(1, sprite.width);
  const maxX = Math.max(minX, Math.min(319, bgRight));
  const clamped = Math.max(minX, Math.min(maxX, translated));
  if (clamped !== translated) {
    diagnostics.push(diagnostic(
      'warning',
      'sprite-x-clamped',
      `ICGのSprite X座標 ${sourceX} と元crop X ${sprite.sourceCropX}pxをBG幅${layout.width}px・表示X${layout.offsetX}pxでPCE座標 ${translated} へ変換後、Sprite幅${sprite.width || '不明'}pxを含むBG内 ${clamped} へ補正します。`,
      instruction,
    ));
  }
  return clamped;
}

function isAlphaFadeInstruction(instruction) {
  return instruction?.op === 'FADE'
    && instruction.args.length >= 5
    && instruction.args.length < 9;
}

function classifyP04Source(source = '') {
  const normalized = String(source || '').toUpperCase();
  return /(^|\/)(VOICE|[^/]*ADP(?:16|32)?)(\/|$)/.test(normalized) ? 'voice' : 'sfx';
}

function resolvePlaypPlaybackRate(value, constants = new Map()) {
  const token = cleanToken(value);
  if (!token) return 32000;
  const resolved = numericValue(token, constants);
  return resolved !== null && resolved > 0 ? Math.round(resolved) : null;
}

function expectedAssetTypes(requirement, mappingEntry = {}) {
  if (requirement.kind === 'image') {
    return mappingEntry.display === 'sprite' ? ['sprite'] : ['image'];
  }
  if (requirement.kind === 'p04') return ['adpcm'];
  if (requirement.kind === 'midi') return ['psg-song'];
  if (requirement.kind === 'cdda') return ['cdda-track'];
  return [];
}

function collectRuntimeVariables(programs) {
  const variables = new Set();
  programs.forEach((program) => {
    program.instructions.forEach((instruction) => {
      if (instruction.op === 'IF' && instruction.condition) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(instruction.condition.left)) {
          variables.add(instruction.condition.left.toUpperCase());
        }
      }
      if (instruction.op === 'WAITBTN' || instruction.op === 'ONC') {
        const name = String(instruction.args[0] || '');
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) variables.add(name.toUpperCase());
      }
      if (instruction.op === 'ONG') {
        const name = String(instruction.args[0] || '').toUpperCase();
        if (name && !BUTTON_NAMES.has(name)) variables.add(name);
      }
      if (instruction.op === 'ONRMG' || instruction.op === 'ONMG') {
        variables.add(`KITAHE_CHOICE_${instruction.line}`);
      }
    });
  });
  return variables;
}

const AMBIGUOUS_STATE = '__KITAHE_AMBIGUOUS__';

function cloneAbstractState(state) {
  return {
    constants: { ...state.constants },
    cgDirectory: state.cgDirectory,
    cgDirectories: { ...state.cgDirectories },
    cgSlots: { ...state.cgSlots },
    cgLinks: { ...state.cgLinks },
    pcmDirectory: state.pcmDirectory,
    p04Slots: { ...state.p04Slots },
    messageTokens: state.messageTokens === null ? null : [...state.messageTokens],
    colorToken: state.colorToken,
    nameEntries: { ...state.nameEntries },
    pendingVoice: state.pendingVoice,
    pendingMenu: state.pendingMenu,
    pendingWaitBtn: state.pendingWaitBtn,
  };
}

function hasPhotoTimeoutAfter(node, reachability) {
  let current = node;
  const visited = new Set([node.key]);
  for (let steps = 0; steps < 32; steps += 1) {
    if (current.edges.length !== 1 || current.edges[0].kind !== 'next') return false;
    current = reachability.nodes.get(current.edges[0].key);
    if (!current || visited.has(current.key)) return false;
    visited.add(current.key);
    if (isBranchingTimerInstruction(current.instruction)) return true;
    const op = current.instruction.op;
    if (op === 'KEY') continue;
    if (op === 'ONG') {
      const source = String(current.instruction.args[0] || '').trim().toUpperCase();
      if (BUTTON_NAMES.has(source)) continue;
    }
    return false;
  }
  return false;
}

function hasPhotoButtonPair(node, reachability) {
  const target = String(node.instruction.args[1] || '').trim().toUpperCase();
  if (!target) return false;
  const stackKey = stableJson(node.stack);
  const nearby = Array.from(reachability.nodes.values()).filter((candidate) => (
    candidate.fileIndex === node.fileIndex
    && stableJson(candidate.stack) === stackKey
    && candidate.pc >= node.pc - 4
    && candidate.pc <= node.pc + 10
  ));
  const handlers = nearby.filter((candidate) => {
    if (candidate.instruction.op !== 'ONG') return false;
    const button = String(candidate.instruction.args[0] || '').trim().toUpperCase();
    const candidateTarget = String(candidate.instruction.args[1] || '').trim().toUpperCase();
    return BUTTON_NAMES.has(button) && candidateTarget === target;
  });
  const buttons = new Set(handlers.map((candidate) => (
    String(candidate.instruction.args[0] || '').trim().toUpperCase()
  )));
  if (buttons.size < 2) return false;
  const enabledButtons = new Set(nearby.filter((candidate) => (
    candidate.instruction.op === 'KEY'
    && (!String(candidate.instruction.args[1] || '').trim()
      || String(candidate.instruction.args[1] || '').trim().toUpperCase() === 'ON')
  )).map((candidate) => String(candidate.instruction.args[0] || '').trim().toUpperCase()));
  return Array.from(buttons).every((button) => enabledButtons.has(button));
}

function isRecognizedPhotoHandler(node, reachability) {
  return hasPhotoTimeoutAfter(node, reachability) || hasPhotoButtonPair(node, reachability);
}

function emptyAbstractState() {
  return {
    constants: {},
    cgDirectory: '',
    cgDirectories: {},
    cgSlots: {},
    cgLinks: {},
    pcmDirectory: '',
    p04Slots: {},
    messageTokens: [],
    colorToken: '',
    nameEntries: {},
    pendingVoice: '',
    pendingMenu: '',
    pendingWaitBtn: '',
  };
}

function mergeAbstractScalar(left, right) {
  return left === right ? left : AMBIGUOUS_STATE;
}

function mergeAbstractMap(left, right) {
  const merged = {};
  new Set([...Object.keys(left), ...Object.keys(right)]).forEach((key) => {
    const leftValue = Object.prototype.hasOwnProperty.call(left, key) ? left[key] : '';
    const rightValue = Object.prototype.hasOwnProperty.call(right, key) ? right[key] : '';
    merged[key] = mergeAbstractScalar(leftValue, rightValue);
  });
  return merged;
}

function mergeAbstractState(left, right) {
  const leftMessages = left.messageTokens === null ? null : [...left.messageTokens];
  const rightMessages = right.messageTokens === null ? null : [...right.messageTokens];
  const messagesEqual = leftMessages !== null
    && rightMessages !== null
    && stableJson(leftMessages) === stableJson(rightMessages);
  return {
    constants: mergeAbstractMap(left.constants, right.constants),
    cgDirectory: mergeAbstractScalar(left.cgDirectory, right.cgDirectory),
    cgDirectories: mergeAbstractMap(left.cgDirectories, right.cgDirectories),
    cgSlots: mergeAbstractMap(left.cgSlots, right.cgSlots),
    cgLinks: mergeAbstractMap(left.cgLinks, right.cgLinks),
    pcmDirectory: mergeAbstractScalar(left.pcmDirectory, right.pcmDirectory),
    p04Slots: mergeAbstractMap(left.p04Slots, right.p04Slots),
    messageTokens: messagesEqual ? leftMessages : null,
    colorToken: mergeAbstractScalar(left.colorToken, right.colorToken),
    nameEntries: mergeAbstractMap(left.nameEntries, right.nameEntries),
    pendingVoice: mergeAbstractScalar(left.pendingVoice, right.pendingVoice),
    pendingMenu: mergeAbstractScalar(left.pendingMenu, right.pendingMenu),
    pendingWaitBtn: mergeAbstractScalar(left.pendingWaitBtn, right.pendingWaitBtn),
  };
}

function abstractStateEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function abstractSlot(value = '') {
  return String(value || '').trim().toUpperCase();
}

function abstractScalarValue(value, constants) {
  const token = cleanToken(value);
  if (/^-?0x[0-9a-f]+$/i.test(token)) {
    const sign = token.startsWith('-') ? -1 : 1;
    return sign * parseInt(token.replace(/^-/, ''), 16);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
  const key = token.toUpperCase();
  return Object.prototype.hasOwnProperty.call(constants, key) ? constants[key] : token;
}

function ambiguousConstantArguments(instruction, constants, runtimeVariables = new Set()) {
  let values = [];
  if (instruction.op === 'IF' && instruction.condition) {
    values = [normalizeRuntimeCondition(instruction.condition, runtimeVariables).right];
  } else if (['CGDIR', 'LPCM', 'PLAYM', 'PLAYGD'].includes(instruction.op)) {
    values = [instruction.args[0]];
  } else if (instruction.op === 'LCG') {
    values = [instruction.args[0], instruction.args[2], instruction.args[3]];
  } else if (['LINKCG', 'LINK', 'CCG'].includes(instruction.op)) {
    values = instruction.args.slice(0, 2);
  } else if (instruction.op === 'ICG') {
    values = [instruction.args[0], ...instruction.args.slice(1)];
  } else if (instruction.op === 'PLAYP') {
    values = [instruction.args[0], instruction.args[1], instruction.args[3]];
  } else if (instruction.op === 'STOPP') {
    values = [instruction.args[0]];
  } else if (instruction.op === 'WAIT') {
    values = instruction.args.slice(1);
  } else if (instruction.op === 'SCREEN') {
    values = [instruction.args[0], instruction.args[6], ...instruction.args.slice(7, 10)];
  }
  return values.filter((value) => {
    const key = cleanToken(value).toUpperCase();
    return key && constants[key] === AMBIGUOUS_STATE;
  });
}

function abstractStateDiagnostics(reachability, runtimeVariables = new Set()) {
  const rootKeys = Array.from(new Set(
    (Array.isArray(reachability.rootKeys) && reachability.rootKeys.length
      ? reachability.rootKeys
      : [reachability.entryKey]).filter(Boolean),
  ));
  if (!rootKeys.length) return [];
  const diagnostics = [];
  const diagnosed = new Set();
  const inputStates = new Map();
  const queued = [];
  let queuedCursor = 0;
  const hasQueuedState = () => queuedCursor < queued.length;
  let rootCursor = 0;
  const queueNextRoot = () => {
    while (!hasQueuedState() && rootCursor < rootKeys.length) {
      const rootKey = rootKeys[rootCursor];
      rootCursor += 1;
      if (!reachability.nodes.has(rootKey) || inputStates.has(rootKey)) continue;
      inputStates.set(rootKey, emptyAbstractState());
      queued.push(rootKey);
    }
  };
  queueNextRoot();

  const report = (code, message, instruction) => {
    const key = `${code}:${instruction.script}:${instruction.line}`;
    if (diagnosed.has(key)) return;
    diagnosed.add(key);
    diagnostics.push(diagnostic('error', code, message, instruction));
  };

  while (hasQueuedState() || rootCursor < rootKeys.length) {
    if (!hasQueuedState()) queueNextRoot();
    const key = queued[queuedCursor];
    queuedCursor += 1;
    if (!key) continue;
    const node = reachability.nodes.get(key);
    const input = inputStates.get(key);
    if (!node || !input) continue;
    const state = cloneAbstractState(input);
    const instruction = node.instruction;
    const location = `${instruction.script}:${instruction.line}`;
    const slot = abstractSlot(instruction.args[0]);
    const ambiguousArguments = ambiguousConstantArguments(
      instruction,
      state.constants,
      runtimeVariables,
    );
    if (ambiguousArguments.length) {
      report(
        'ambiguous-constant-state',
        `命令 ${instruction.op} が参照する定数 ${ambiguousArguments.join(', ')} は合流経路で値が一致しません。`,
        instruction,
      );
    }

    if (instruction.op === 'ICG') {
      if (state.cgSlots[slot] === AMBIGUOUS_STATE || state.cgLinks[slot] === AMBIGUOUS_STATE) {
        report(
          'ambiguous-cg-state',
          `ICG slot ${instruction.args[0]} へ合流する経路でLCG/LINKCG状態が一致しません。`,
          instruction,
        );
      }
    } else if (instruction.op === 'PLAYP') {
      if (state.p04Slots[slot] === AMBIGUOUS_STATE) {
        report(
          'ambiguous-p04-state',
          `PLAYP slot ${instruction.args[0]} へ合流する経路でLPCM状態が一致しません。`,
          instruction,
        );
      }
    } else if (instruction.op === 'WAIT' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      if (state.messageTokens === null
        || state.colorToken === AMBIGUOUS_STATE
        || state.pendingVoice === AMBIGUOUS_STATE
        || Object.values(state.nameEntries).includes(AMBIGUOUS_STATE)) {
        report(
          'ambiguous-message-state',
          'WAIT WIN_MSGへ合流する経路でMSG/COLOR/NAME/voice状態が一致しません。',
          instruction,
        );
      }
    } else if (instruction.op === 'ONRMG' || instruction.op === 'ONMG') {
      if (state.pendingMenu === AMBIGUOUS_STATE) {
        report(
          'ambiguous-menu-state',
          'ONRMG/ONMGへ合流する経路でMENU選択肢または順序が一致しません。',
          instruction,
        );
      }
    } else if (instruction.op === 'ONG') {
      const source = abstractSlot(instruction.args[0]);
      if (!BUTTON_NAMES.has(source)
        && (state.pendingWaitBtn === AMBIGUOUS_STATE
          || (state.pendingWaitBtn && state.pendingWaitBtn !== source))) {
        report(
          'ambiguous-waitbtn-state',
          'ONGへ合流する経路でWAITBTN variable状態が一致しません。',
          instruction,
        );
      }
    }

    if (state.pendingVoice && isFlowBoundaryInstruction(instruction)) {
      state.pendingVoice = '';
    }
    if (state.pendingMenu
      && instruction.op !== 'ONRMG'
      && instruction.op !== 'ONMG'
      && isFlowBoundaryInstruction(instruction)) {
      state.pendingMenu = '';
    }
    if (state.pendingWaitBtn && instruction.op !== 'ONG' && isFlowBoundaryInstruction(instruction)) {
      state.pendingWaitBtn = '';
    }

    if (instruction.op === 'DEFINE') {
      const name = abstractSlot(instruction.args[0]);
      if (name && !Object.prototype.hasOwnProperty.call(state.constants, name)) state.constants[name] = 0;
    } else if (instruction.op === 'ASSIGN') {
      const assignment = instruction.assignment || parseAssignment(instruction.raw);
      const name = abstractSlot(assignment?.name);
      if (name && assignment) {
        if (assignment.arithmetic) {
          const source = abstractScalarValue(assignment.arithmetic.source, state.constants);
          const amount = abstractScalarValue(assignment.arithmetic.amount, state.constants);
          state.constants[name] = source === AMBIGUOUS_STATE || amount === AMBIGUOUS_STATE
            || typeof source !== 'number' || typeof amount !== 'number'
            ? AMBIGUOUS_STATE
            : (assignment.arithmetic.operator === '+' ? source + amount : source - amount);
        } else {
          state.constants[name] = abstractScalarValue(assignment.value, state.constants);
        }
      }
    } else if (instruction.op === 'CGDIR') {
      if (instruction.args.length > 1 && instruction.args[1]) {
        const value = `dir:${cleanToken(instruction.args[1])}`;
        state.cgDirectories[slot] = value;
        state.cgDirectory = value;
      } else {
        state.cgDirectory = state.cgDirectories[slot] || AMBIGUOUS_STATE;
      }
    } else if (instruction.op === 'LCG') {
      const relation = state.cgLinks[slot];
      if (relation && relation !== AMBIGUOUS_STATE) {
        relation.split('\0').forEach((linkedSlot) => { delete state.cgLinks[linkedSlot]; });
      } else {
        delete state.cgLinks[slot];
      }
      state.cgSlots[slot] = state.cgDirectory === AMBIGUOUS_STATE
        ? AMBIGUOUS_STATE
        : `${state.cgDirectory}|${cleanToken(instruction.args[1])}|${instruction.args[2] || ''}|${instruction.args[3] || ''}`;
    } else if (instruction.op === 'LINKCG' || instruction.op === 'LINK') {
      const rightSlot = abstractSlot(instruction.args[1]);
      const relation = `${slot}\0${rightSlot}`;
      state.cgLinks[slot] = relation;
      state.cgLinks[rightSlot] = relation;
    } else if (instruction.op === 'CCG') {
      const destination = abstractSlot(instruction.args[1]);
      delete state.cgSlots[destination];
      delete state.cgLinks[destination];
      if (state.cgSlots[slot]) state.cgSlots[destination] = state.cgSlots[slot];
      if (state.cgLinks[slot]) state.cgLinks[destination] = state.cgLinks[slot];
    } else if (instruction.op === 'CLEARCG') {
      state.cgSlots = {};
      state.cgLinks = {};
    } else if (instruction.op === 'PCMDIR') {
      state.pcmDirectory = `pcm:${cleanToken(instruction.args[0])}`;
    } else if (instruction.op === 'LPCM') {
      state.p04Slots[slot] = state.pcmDirectory === AMBIGUOUS_STATE
        ? AMBIGUOUS_STATE
        : `${state.pcmDirectory}|${cleanToken(instruction.args[1])}`;
    } else if (instruction.op === 'PLAYP') {
      const source = state.p04Slots[slot] || '';
      const loop = String(instruction.args[2] || '').trim().toUpperCase() === 'ON';
      state.pendingVoice = !loop && classifyP04Source(source) === 'voice' ? source : '';
    } else if (instruction.op === 'CPCM') {
      const slots = instruction.args.filter((entry) => String(entry || '').trim())
        .map((entry) => abstractSlot(entry));
      if (slots.length) slots.forEach((entry) => { delete state.p04Slots[entry]; });
      else state.p04Slots = {};
      state.pendingVoice = '';
    } else if (instruction.op === 'NAME') {
      state.nameEntries[cleanToken(instruction.args[1])] = cleanToken(instruction.args[2]);
    } else if (instruction.op === 'COLOR'
      && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      state.colorToken = cleanToken(instruction.args[1]);
    } else if (instruction.op === 'MSG'
      && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      if (state.messageTokens !== null) {
        state.messageTokens.push(location);
        if (state.messageTokens.length > 256) {
          report(
            'ambiguous-message-state',
            'WAIT WIN_MSG前のMSG展開が256件を超えるため、loopまたは非収束message bufferとして変換できません。',
            instruction,
          );
          state.messageTokens = null;
        }
      }
    } else if ((instruction.op === 'CLEAR' || instruction.op === 'CLEARW')
      && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      state.messageTokens = [];
    } else if (instruction.op === 'WAIT'
      && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      state.messageTokens = [];
      state.pendingVoice = '';
    } else if (instruction.op === 'WAITBTN') {
      const variable = abstractSlot(instruction.args[0]);
      if (variable) state.constants[variable] = AMBIGUOUS_STATE;
      state.pendingWaitBtn = variable;
    } else if (instruction.op === 'MENU') {
      state.pendingMenu = stableJson({
        id: String(instruction.args[0] || ''),
        choices: instruction.args.slice(3).map((entry) => cleanToken(entry)),
      });
    } else if (instruction.op === 'ONRMG' || instruction.op === 'ONMG') {
      state.pendingMenu = '';
    } else if (instruction.op === 'ONG') {
      const source = abstractSlot(instruction.args[0]);
      if (!BUTTON_NAMES.has(source)) state.pendingWaitBtn = '';
    }

    node.edges.forEach((edge) => {
      const outgoingState = cloneAbstractState(state);
      if (instruction.op === 'ONG' && edge.kind === 'input-choice') {
        const variable = abstractSlot(instruction.args[0]);
        if (variable && Number.isInteger(edge.value)) outgoingState.constants[variable] = edge.value + 1;
      }
      const existing = inputStates.get(edge.key);
      if (!existing) {
        inputStates.set(edge.key, outgoingState);
        queued.push(edge.key);
        return;
      }
      const merged = mergeAbstractState(existing, outgoingState);
      if (!abstractStateEqual(existing, merged)) {
        inputStates.set(edge.key, merged);
        queued.push(edge.key);
      }
    });
  }
  return diagnostics;
}

function analyzeInstructionFacts(programs, reachability, options = {}) {
  const requirements = new Map();
  const colorTokens = new Map();
  const facts = new Map();
  const diagnostics = [...reachability.diagnostics, ...abstractStateDiagnostics(reachability)];
  const constants = new Map();
  const replacements = new Map();
  const runtimeVariables = collectRuntimeVariables(programs);

  const isReachable = (fileIndex, pc) => reachability.reachableLocations.has(`${fileIndex}:${pc}`);
  const occurrence = (instruction) => ({ script: instruction.script, line: instruction.line });

  programs.forEach((program, fileIndex) => {
    let currentCgDirectory = '';
    const cgDirectories = new Map();
    const cgSlots = new Map();
    const cgLinks = new Map();
    let currentPcmDirectory = '';
    const p04Slots = new Map();
    let currentColorToken = '';
    let messageBuffer = '';
    let pendingVoiceKey = '';
    let pendingVoiceInstruction = null;
    let pendingMenu = null;
    let pendingWaitBtn = null;

    function imageRecordForSlot(slot) {
      const key = resolveSlot(slot, constants);
      const linked = cgLinks.get(key);
      if (linked) {
        const left = cgSlots.get(linked.left);
        const right = cgSlots.get(linked.right);
        if (!left || !right) return null;
        return {
          parts: [left.source, right.source],
          crops: [left.crop, right.crop],
          orderedSlots: [linked.left, linked.right],
        };
      }
      const single = cgSlots.get(key);
      if (!single) return null;
      return {
        parts: [single.source],
        crops: [single.crop],
        orderedSlots: [key],
      };
    }

    function unlinkCgSlot(slot) {
      const relation = cgLinks.get(slot);
      if (!relation) return;
      cgLinks.delete(relation.left);
      cgLinks.delete(relation.right);
    }

    program.instructions.forEach((instruction, pc) => {
      const reachable = isReachable(fileIndex, pc);
      const factKey = `${fileIndex}:${pc}`;
      const instructionFact = {};
      facts.set(factKey, instructionFact);
      // Physical line order is not execution order. Instructions skipped by a
      // branch must not mutate the state consumed by later reachable commands.
      if (!reachable) return;

      // Voice attachment is intentionally conservative: only an uninterrupted
      // straight-line PLAYP -> MSG/WAIT sequence may consume a voice. Labels,
      // calls and any branch are basic-block boundaries, so carrying the pending
      // voice across them could attach audio from a different path.
      if (pendingVoiceKey && [
        'LABEL', 'GOTO', 'GOT', 'CALL', 'RETURN', 'END', 'IF',
        'MENU', 'ONRMG', 'ONMG', 'ONG', 'ONC', 'ONTG', 'WAITBTN',
      ].includes(instruction.op)) {
        pendingVoiceKey = '';
        pendingVoiceInstruction = null;
      }
      if (pendingWaitBtn && instruction.op !== 'ONG' && [
        'LABEL', 'GOTO', 'GOT', 'CALL', 'RETURN', 'END', 'IF',
        'MENU', 'ONRMG', 'ONMG', 'ONC', 'ONTG', 'WAITBTN',
      ].includes(instruction.op)) {
        pendingWaitBtn = null;
      }

      if (instruction.op === 'DEFINE') {
        const name = String(instruction.args[0] || '').trim().toUpperCase();
        if (name && !constants.has(name)) constants.set(name, 0);
      } else if (instruction.op === 'ASSIGN') {
        const name = String(instruction.assignment?.name || instruction.args[0] || '').trim().toUpperCase();
        const assignment = instruction.assignment || parseAssignment(instruction.raw);
        if (name && assignment) {
          if (assignment.arithmetic) {
            const source = numericValue(assignment.arithmetic.source, constants);
            const amount = numericValue(assignment.arithmetic.amount, constants);
            if (source !== null && amount !== null) {
              constants.set(name, assignment.arithmetic.operator === '+' ? source + amount : source - amount);
            } else {
              constants.delete(name);
            }
          } else {
            constants.set(name, scalarValue(assignment.value, constants));
          }
        }
      } else if (instruction.op === 'NAME') {
        const source = cleanToken(instruction.args[1]);
        const fallback = cleanToken(instruction.args[2]);
        if (source) replacements.set(source, fallback);
      } else if (instruction.op === 'CGDIR') {
        const directoryKey = resolveSlot(instruction.args[0], constants);
        if (instruction.args.length > 1 && instruction.args[1]) {
          const directory = normalizeSourcePath(instruction.args[1]);
          cgDirectories.set(directoryKey, directory);
          currentCgDirectory = directory;
        } else if (cgDirectories.has(directoryKey)) {
          currentCgDirectory = cgDirectories.get(directoryKey);
        }
      } else if (instruction.op === 'LCG') {
        const slot = resolveSlot(instruction.args[0], constants);
        const source = joinSourcePath(currentCgDirectory, appendExtension(instruction.args[1], '.PVR'));
        unlinkCgSlot(slot);
        cgSlots.set(slot, {
          source,
          crop: {
            width: numericValue(instruction.args[2], constants),
            height: numericValue(instruction.args[3], constants),
          },
        });
      } else if (instruction.op === 'LINKCG' || instruction.op === 'LINK') {
        const left = resolveSlot(instruction.args[0], constants);
        const right = resolveSlot(instruction.args[1], constants);
        unlinkCgSlot(left);
        unlinkCgSlot(right);
        const link = { left, right };
        cgLinks.set(left, link);
        cgLinks.set(right, link);
      } else if (instruction.op === 'CCG') {
        const sourceSlot = resolveSlot(instruction.args[0], constants);
        const destinationSlot = resolveSlot(instruction.args[1], constants);
        unlinkCgSlot(destinationSlot);
        cgSlots.delete(destinationSlot);
        const sourceRecord = cgSlots.get(sourceSlot);
        if (sourceRecord) cgSlots.set(destinationSlot, { ...sourceRecord, crop: { ...sourceRecord.crop } });
        const sourceLink = cgLinks.get(sourceSlot);
        if (sourceLink) {
          const otherSlot = sourceLink.left === sourceSlot ? sourceLink.right : sourceLink.left;
          const copiedOther = `${destinationSlot}__LINK`;
          if (cgSlots.has(otherSlot)) {
            cgSlots.set(copiedOther, {
              ...cgSlots.get(otherSlot),
              crop: { ...cgSlots.get(otherSlot).crop },
            });
            const destinationLink = sourceLink.left === sourceSlot
              ? { left: destinationSlot, right: copiedOther }
              : { left: copiedOther, right: destinationSlot };
            cgLinks.set(destinationSlot, destinationLink);
            cgLinks.set(copiedOther, destinationLink);
          }
        }
      } else if (instruction.op === 'ICG') {
        const image = imageRecordForSlot(instruction.args[0]);
        if (image) {
          instructionFact.image = image;
          if (reachable) {
            const requirement = addRequirement(
              requirements,
              'image',
              image.parts,
              occurrence(instruction),
              {
                parts: image.parts,
                crops: image.crops,
                orderedSlots: image.orderedSlots,
                split: image.parts.length > 1,
              },
            );
            instructionFact.requirementKey = requirement.key;
          }
        } else if (reachable) {
          diagnostics.push(diagnostic(
            'error',
            'unresolved-cg-slot',
            `ICG slot ${instruction.args[0] || '(空)'} のLCG/LINKCG状態を解決できません。`,
            instruction,
          ));
        }
      } else if (instruction.op === 'PCMDIR') {
        currentPcmDirectory = normalizeSourcePath(instruction.args[0]);
      } else if (instruction.op === 'LPCM') {
        const slot = resolveSlot(instruction.args[0], constants);
        p04Slots.set(slot, joinSourcePath(currentPcmDirectory, appendExtension(instruction.args[1], '.P04')));
      } else if (instruction.op === 'PLAYP') {
        const slot = resolveSlot(instruction.args[0], constants);
        const source = p04Slots.get(slot);
        const loop = String(instruction.args[2] || '').trim().toUpperCase() === 'ON';
        const usage = source ? classifyP04Source(source) : 'sfx';
        const rawPlaybackRate = cleanToken(instruction.args[1]);
        const resolvedPlaybackRate = resolvePlaypPlaybackRate(instruction.args[1], constants);
        const playbackRate = resolvedPlaybackRate ?? 32000;
        if (reachable && rawPlaybackRate && resolvedPlaybackRate === null) {
          diagnostics.push(diagnostic(
            'error',
            'invalid-playp-rate',
            'PLAYP rateを正の数値・16進・静的定数として解決できません。',
            instruction,
          ));
        }
        if (source) {
          instructionFact.p04Source = source;
          instructionFact.loop = loop;
          instructionFact.usage = usage;
          instructionFact.playbackRate = playbackRate;
          if (reachable && resolvedPlaybackRate !== null) {
            const requirement = addRequirement(
              requirements,
              'p04',
              source,
              occurrence(instruction),
              {
                usage,
                loop,
                playbackRate,
                channel: String(instruction.args[3] || '0'),
              },
            );
            instructionFact.requirementKey = requirement.key;
            if (!loop && usage === 'voice') {
              pendingVoiceKey = requirement.key;
              pendingVoiceInstruction = instruction;
            }
          }
        } else if (reachable) {
          diagnostics.push(diagnostic(
            'error',
            'unresolved-p04-slot',
            `PLAYP slot ${instruction.args[0] || '(空)'} のLPCMを解決できません。`,
            instruction,
          ));
        }
      } else if (instruction.op === 'PLAYM') {
        const track = Math.round(numericValue(instruction.args[0], constants) ?? -1);
        if (track >= 0) {
          const source = `MIDI/PM_bank00_track${String(track).padStart(2, '0')}.mid`;
          if (reachable) {
            const requirement = addRequirement(
              requirements,
              'midi',
              source,
              occurrence(instruction),
              { track, usage: 'bgm' },
            );
            instructionFact.requirementKey = requirement.key;
          }
        } else if (reachable) {
          diagnostics.push(diagnostic('error', 'invalid-midi-track', 'PLAYMのtrack番号を解決できません。', instruction));
        }
      } else if (instruction.op === 'PLAYGD') {
        const gdTrack = Math.round(numericValue(instruction.args[0], constants) ?? -1);
        if (gdTrack >= 0) {
          const source = `gd-rom/track${String(gdTrack + 3).padStart(2, '0')}.raw`;
          if (reachable) {
            const requirement = addRequirement(
              requirements,
              'cdda',
              source,
              occurrence(instruction),
              { scriptTrack: gdTrack, physicalTrack: gdTrack + 3, usage: 'bgm' },
            );
            instructionFact.requirementKey = requirement.key;
          }
        } else if (reachable) {
          diagnostics.push(diagnostic('error', 'invalid-gd-track', 'PLAYGDのtrack番号を解決できません。', instruction));
        }
      }

      if (instruction.op === 'COLOR' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
        currentColorToken = String(instruction.args[1] || '').trim() || '(default)';
        if (reachable) {
          if (!colorTokens.has(currentColorToken)) {
            colorTokens.set(currentColorToken, { token: currentColorToken, occurrences: [] });
          }
          colorTokens.get(currentColorToken).occurrences.push(occurrence(instruction));
        }
      }

      if (instruction.op === 'MSG' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
        messageBuffer += instruction.args.slice(1).join(',');
      } else if ((instruction.op === 'CLEAR' || instruction.op === 'CLEARW')
        && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
        messageBuffer = '';
      } else if (instruction.op === 'WAIT' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
        const text = replaceNames(normalizeMessageText(messageBuffer), replacements, options.protagonistName);
        instructionFact.message = {
          text,
          colorToken: currentColorToken,
          voiceRequirementKey: pendingVoiceKey,
          voiceInstruction: pendingVoiceInstruction,
        };
        messageBuffer = '';
        pendingVoiceKey = '';
        pendingVoiceInstruction = null;
      }

      if (instruction.op === 'MENU') {
        pendingMenu = {
          instruction,
          id: String(instruction.args[0] || ''),
          choices: instruction.args.slice(3)
            .map((choice) => cleanToken(choice))
            .filter(Boolean)
            .map((choice) => replaceNames(choice, replacements, options.protagonistName)),
        };
      } else if ((instruction.op === 'ONRMG' || instruction.op === 'ONMG') && pendingMenu) {
        instructionFact.menu = pendingMenu;
        pendingMenu = null;
      }

      if (instruction.op === 'WAITBTN' && reachable) {
        pendingWaitBtn = {
          variable: String(instruction.args[0] || '').trim().toUpperCase(),
          instruction,
        };
        instructionFact.waitBtn = pendingWaitBtn;
      } else if (instruction.op === 'ONG' && reachable) {
        const source = String(instruction.args[0] || '').trim().toUpperCase();
        if (!BUTTON_NAMES.has(source) && instruction.args.length > 1) {
          if (pendingWaitBtn?.variable === source) {
            instructionFact.waitBtn = pendingWaitBtn;
          } else {
            diagnostics.push(diagnostic(
              'error',
              'unsupported-input-cycle',
              'ONG variable分岐の直前の同じbasic blockに、同じvariableのWAITBTNがありません。',
              instruction,
            ));
          }
          const validBranches = instruction.args.slice(1)
            .filter((label) => label && label.toUpperCase() !== 'NULL');
          if (validBranches.length > 4) {
            diagnostics.push(diagnostic(
              'error',
              'unsupported-input-cycle',
              'WAITBTN/ONGの有効分岐が4件を超えるためChoiceへ保持できません。',
              instruction,
            ));
          }
          pendingWaitBtn = null;
        }
      }

      if (APPROXIMATE_VISUAL_COMMANDS.has(instruction.op)) {
        diagnostics.push(diagnostic(
          'warning',
          'visual-effect-omitted',
          `${instruction.op} の演出はPCE VNで省略します。`,
          instruction,
        ));
      } else if (instruction.op === 'FADE') {
        diagnostics.push(diagnostic(
          'warning',
          'fade-omitted',
          'BG・キャラクターを対象とするCG alpha FADEは省略し、BG切替はPCE VNのfadeに任せます。',
          instruction,
        ));
      } else if (OMITTED_COMMANDS.has(instruction.op)
        && !isSupportedSpriteVisibilityInstruction(instruction)) {
        diagnostics.push(diagnostic(
          'warning',
          'command-omitted',
          `${instruction.op} は初版変換で省略します。`,
          instruction,
        ));
      }
    });
  });

  return {
    requirements,
    colorTokens,
    facts,
    diagnostics: dedupeDiagnostics(diagnostics),
    runtimeVariables,
    constants,
  };
}

function cloneFactState(state) {
  return {
    constants: new Map(state.constants),
    replacements: new Map(state.replacements),
    currentCgDirectory: state.currentCgDirectory,
    cgDirectories: new Map(state.cgDirectories),
    cgSlots: new Map(Array.from(state.cgSlots, ([key, value]) => [
      key,
      { ...value, crop: { ...(value.crop || {}) } },
    ])),
    cgLinks: new Map(Array.from(state.cgLinks, ([key, value]) => [key, { ...value }])),
    cgPlacements: new Map(Array.from(state.cgPlacements, ([key, value]) => [key, { ...value }])),
    cgRequirementKeys: new Map(state.cgRequirementKeys || []),
    currentPcmDirectory: state.currentPcmDirectory,
    p04Slots: new Map(state.p04Slots),
    currentColorToken: state.currentColorToken,
    messageBuffer: state.messageBuffer,
    pendingVoiceKey: state.pendingVoiceKey,
    pendingVoiceInstruction: state.pendingVoiceInstruction,
    pendingMenu: state.pendingMenu
      ? { ...state.pendingMenu, choices: [...state.pendingMenu.choices] }
      : null,
    pendingWaitBtn: state.pendingWaitBtn ? { ...state.pendingWaitBtn } : null,
  };
}

function emptyFactState() {
  return {
    constants: new Map(),
    replacements: new Map(),
    currentCgDirectory: '',
    cgDirectories: new Map(),
    cgSlots: new Map(),
    cgLinks: new Map(),
    cgPlacements: new Map(),
    cgRequirementKeys: new Map(),
    currentPcmDirectory: '',
    p04Slots: new Map(),
    currentColorToken: '',
    messageBuffer: '',
    pendingVoiceKey: '',
    pendingVoiceInstruction: null,
    pendingMenu: null,
    pendingWaitBtn: null,
  };
}

function directNumericAssignmentValue(assignment) {
  if (!assignment || assignment.arithmetic) return null;
  const token = cleanToken(assignment.value);
  if (/^-?0x[0-9a-f]+$/i.test(token)) {
    const sign = token.startsWith('-') ? -1 : 1;
    return sign * parseInt(token.replace(/^-/, ''), 16);
  }
  return /^-?\d+(?:\.\d+)?$/.test(token) ? Number(token) : null;
}

function collectStaticNumericSymbols(reachability) {
  const records = new Map();
  const dynamic = new Set();
  const visited = new Set();
  const recordAssignment = (instruction, assignment) => {
    const name = String(assignment?.name || '').trim().toUpperCase();
    if (!name) return;
    const value = directNumericAssignmentValue(assignment);
    if (value === null) {
      dynamic.add(name);
      return;
    }
    if (!records.has(name)) records.set(name, new Map());
    const byScript = records.get(name);
    if (!byScript.has(instruction.script)) byScript.set(instruction.script, new Set());
    byScript.get(instruction.script).add(value);
  };

  reachability.order.forEach((key) => {
    const instruction = reachability.nodes.get(key)?.instruction;
    if (!instruction) return;
    const location = `${instruction.script}:${instruction.line}`;
    if (visited.has(location)) return;
    visited.add(location);
    if (instruction.op === 'ASSIGN') {
      recordAssignment(instruction, instruction.assignment || parseAssignment(instruction.raw));
    }
    if (instruction.op === 'IF' && instruction.condition) {
      const conditionalAssignment = parseAssignment(instruction.condition.then);
      if (conditionalAssignment) dynamic.add(conditionalAssignment.name.toUpperCase());
    }
    if (instruction.op === 'WAITBTN' || instruction.op === 'RANDOM') {
      const name = String(instruction.args[0] || '').trim().toUpperCase();
      if (name) dynamic.add(name);
    }
  });

  return new Set(Array.from(records).filter(([name, byScript]) => (
    !dynamic.has(name)
    && Array.from(byScript.values()).every((values) => values.size === 1)
  )).map(([name]) => name));
}

function invertComparisonOperator(operator) {
  if (operator === '<') return '>';
  if (operator === '<=') return '>=';
  if (operator === '>') return '<';
  if (operator === '>=') return '<=';
  return operator;
}

function normalizeRuntimeCondition(condition, runtimeVariables = new Set()) {
  if (!condition) return condition;
  const left = String(condition.left || '').trim().toUpperCase();
  const right = String(condition.right || '').trim().toUpperCase();
  if (!runtimeVariables.has(left) && runtimeVariables.has(right)) {
    return {
      ...condition,
      left: condition.right,
      operator: invertComparisonOperator(condition.operator),
      right: condition.left,
    };
  }
  return condition;
}

function collectReachableRuntimeVariables(reachability) {
  const variables = new Set();
  const staticNumericSymbols = collectStaticNumericSymbols(reachability);
  reachability.order.forEach((key) => {
    const instruction = reachability.nodes.get(key)?.instruction;
    if (!instruction) return;
    if (instruction.op === 'IF' && instruction.condition) {
      const left = String(instruction.condition.left || '').trim().toUpperCase();
      const right = String(instruction.condition.right || '').trim().toUpperCase();
      const leftIdentifier = isVariableIdentifier(left);
      const rightIdentifier = isVariableIdentifier(right);
      if ((!leftIdentifier || staticNumericSymbols.has(left))
        && rightIdentifier
        && !staticNumericSymbols.has(right)) {
        variables.add(right);
      } else if (leftIdentifier) {
        variables.add(left);
      }
    }
    const thenAssignment = instruction.op === 'IF' && instruction.condition
      ? parseAssignment(instruction.condition.then)
      : null;
    if (thenAssignment) variables.add(thenAssignment.name.toUpperCase());
    if (instruction.op === 'WAITBTN' || instruction.op === 'ONC') {
      const name = String(instruction.args[0] || '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) variables.add(name.toUpperCase());
    }
    if (instruction.op === 'ONG') {
      const name = String(instruction.args[0] || '').toUpperCase();
      if (name && !BUTTON_NAMES.has(name)) variables.add(name);
    }
    if (instruction.op === 'ONRMG' || instruction.op === 'ONMG') {
      variables.add(`KITAHE_CHOICE_${instruction.line}`);
    }
  });
  return variables;
}

function runtimeVariableDefinitionDiagnostics(reachability, runtimeVariables) {
  const defined = new Set();
  reachability.order.forEach((key) => {
    const instruction = reachability.nodes.get(key)?.instruction;
    if (!instruction) return;
    if (instruction.op === 'DEFINE' || instruction.op === 'ASSIGN') {
      const name = String(
        instruction.assignment?.name || instruction.args[0] || '',
      ).trim().toUpperCase();
      if (name) defined.add(name);
    } else if (instruction.op === 'WAITBTN') {
      const name = String(instruction.args[0] || '').trim().toUpperCase();
      if (name) defined.add(name);
    }
  });
  const diagnostics = [];
  const reported = new Set();
  reachability.order.forEach((key) => {
    const instruction = reachability.nodes.get(key)?.instruction;
    if (!instruction) return;
    let name = '';
    if (instruction.op === 'IF') {
      const condition = normalizeRuntimeCondition(instruction.condition, runtimeVariables);
      name = String(condition?.left || '').trim().toUpperCase();
    }
    else if (instruction.op === 'ONC') name = String(instruction.args[0] || '').trim().toUpperCase();
    else if (instruction.op === 'ONG') {
      const candidate = String(instruction.args[0] || '').trim().toUpperCase();
      if (!BUTTON_NAMES.has(candidate)) name = candidate;
    }
    if (!name || !runtimeVariables.has(name) || defined.has(name) || reported.has(name)) return;
    reported.add(name);
    diagnostics.push(diagnostic(
      'error',
      'undefined-runtime-variable',
      `分岐variable ${name} に変換可能なDEFINE/ASSIGN/WAITBTN producerがありません。`,
      instruction,
    ));
  });
  return diagnostics;
}

function analyzeInstructionFactsCfg(programs, reachability, options = {}) {
  const requirements = new Map();
  const colorTokens = new Map();
  const facts = new Map();
  const runtimeVariables = collectReachableRuntimeVariables(reachability);
  const diagnostics = [
    ...reachability.diagnostics,
    ...abstractStateDiagnostics(reachability, runtimeVariables),
    ...runtimeVariableDefinitionDiagnostics(reachability, runtimeVariables),
  ];
  const resolvedConstants = new Map();
  const inputStates = new Map();
  const queued = [];
  let queuedCursor = 0;
  const hasQueuedState = () => queuedCursor < queued.length;
  const processed = new Set();
  const rootKeys = Array.from(new Set(
    (Array.isArray(reachability.rootKeys) && reachability.rootKeys.length
      ? reachability.rootKeys
      : [reachability.entryKey]).filter(Boolean),
  ));
  let rootCursor = 0;
  const queueNextRoot = () => {
    while (!hasQueuedState() && rootCursor < rootKeys.length) {
      const rootKey = rootKeys[rootCursor];
      rootCursor += 1;
      if (!reachability.nodes.has(rootKey) || inputStates.has(rootKey) || processed.has(rootKey)) continue;
      inputStates.set(rootKey, emptyFactState());
      queued.push(rootKey);
    }
  };
  queueNextRoot();

  const occurrence = (instruction) => ({ script: instruction.script, line: instruction.line });

  while (hasQueuedState() || rootCursor < rootKeys.length) {
    if (!hasQueuedState()) queueNextRoot();
    const nodeKey = queued[queuedCursor];
    queuedCursor += 1;
    if (!nodeKey) continue;
    if (processed.has(nodeKey)) continue;
    processed.add(nodeKey);
    const node = reachability.nodes.get(nodeKey);
    const input = inputStates.get(nodeKey);
    if (!node || !input) continue;
    const state = cloneFactState(input);
    const instruction = node.instruction;
    const instructionFact = {
      constants: new Map(state.constants),
      activeCg: new Map(
        Array.from(state.cgRequirementKeys || [], ([slot, requirementKey]) => {
          const placement = state.cgPlacements.get(slot);
          return [slot, {
            requirementKey,
            placement: placement ? { ...placement } : null,
          }];
        }).filter(([, value]) => value.placement?.visible),
      ),
    };
    facts.set(nodeKey, instructionFact);
    // Keep a location fallback for callers/tests that do not have the expanded
    // CALL-state key. Conversion itself always reads the node-keyed fact.
    const locationKey = `${node.fileIndex}:${node.pc}`;
    if (!facts.has(locationKey)) facts.set(locationKey, instructionFact);

    const imageRecordForSlot = (rawSlot) => {
      const slot = resolveSlot(rawSlot, state.constants);
      const linked = state.cgLinks.get(slot);
      if (linked) {
        const left = state.cgSlots.get(linked.left);
        const right = state.cgSlots.get(linked.right);
        if (!left || !right) return null;
        return {
          parts: [left.source, right.source],
          crops: [left.crop, right.crop],
          orderedSlots: [linked.left, linked.right],
        };
      }
      const single = state.cgSlots.get(slot);
      return single ? {
        parts: [single.source],
        crops: [single.crop],
        orderedSlots: [slot],
      } : null;
    };
    const unlinkCgSlot = (slot) => {
      const relation = state.cgLinks.get(slot);
      if (!relation) return;
      state.cgLinks.delete(relation.left);
      state.cgLinks.delete(relation.right);
    };
    const resolveUnloadSlots = (rawStart, rawCount) => {
      const start = resolveSlot(rawStart, state.constants);
      if (!start) return [];
      const countValue = rawCount && cleanToken(rawCount)
        ? numericValue(rawCount, state.constants)
        : 1;
      const count = countValue === null ? 1 : Math.max(1, Math.round(countValue));
      const linked = state.cgLinks.get(start);
      if (count > 1 && linked) return [linked.left, linked.right];
      return Array.from({ length: count }, (_, index) => (
        numericValue(start, state.constants) !== null
          ? String(Math.round(numericValue(start, state.constants) + index))
          : (index ? `${start}_${index}` : start)
      ));
    };
    const clearCgVisibility = (slots) => {
      slots.forEach((slot) => {
        state.cgRequirementKeys.delete(slot);
        state.cgPlacements.delete(slot);
      });
    };

    if (state.pendingVoiceKey && isFlowBoundaryInstruction(instruction)) {
      state.pendingVoiceKey = '';
      state.pendingVoiceInstruction = null;
    }
    if (state.pendingWaitBtn && instruction.op !== 'ONG' && isFlowBoundaryInstruction(instruction)) {
      diagnostics.push(diagnostic(
        'error',
        'unsupported-input-cycle',
        'WAITBTNに対応する同じbasic block内のONG variable分岐がありません。',
        state.pendingWaitBtn.instruction,
      ));
      state.pendingWaitBtn = null;
    }
    if (state.pendingMenu
      && instruction.op !== 'ONRMG'
      && instruction.op !== 'ONMG'
      && isFlowBoundaryInstruction(instruction)) {
      diagnostics.push(diagnostic(
        'error',
        'incomplete-menu-cycle',
        'MENUに対応する同じbasic block内のONRMG/ONMG分岐がありません。',
        state.pendingMenu.instruction,
      ));
      state.pendingMenu = null;
    }

    if (instruction.op === 'DEFINE') {
      const name = String(instruction.args[0] || '').trim().toUpperCase();
      if (name && !state.constants.has(name)) state.constants.set(name, 0);
      if (name) resolvedConstants.set(name, state.constants.get(name));
    } else if (instruction.op === 'ASSIGN') {
      const name = String(instruction.assignment?.name || instruction.args[0] || '').trim().toUpperCase();
      const assignment = instruction.assignment || parseAssignment(instruction.raw);
      if (name && assignment) {
        if (runtimeVariables.has(name)) {
          const spec = runtimeAssignmentSpec(assignment, runtimeVariables, state.constants);
          if (!spec) {
            diagnostics.push(diagnostic(
              'error',
              'unsupported-assignment',
              `${name} への代入は数値・16進・静的定数、または同じvariableへの加減算だけ変換できます。`,
              instruction,
            ));
          } else if (!isSignedInt16(spec.value)) {
            diagnostics.push(diagnostic(
              'error',
              'variable-value-range',
              `${name} の代入operand ${spec.value} はsigned int16範囲外です。`,
              instruction,
            ));
          }
          if (assignment.arithmetic
            && String(assignment.arithmetic.source || '').trim().toUpperCase() === name) {
            const current = numericValue(name, state.constants);
            const amount = numericValue(assignment.arithmetic.amount, state.constants);
            if (current !== null && amount !== null) {
              const result = assignment.arithmetic.operator === '+' ? current + amount : current - amount;
              if (!isSignedInt16(Math.round(result))) {
                diagnostics.push(diagnostic(
                  'error',
                  'variable-value-range',
                  `${name} の静的に解決できる演算結果 ${result} はsigned int16範囲外です。`,
                  instruction,
                ));
              }
            }
          }
        }
        if (assignment.arithmetic) {
          const source = numericValue(assignment.arithmetic.source, state.constants);
          const amount = numericValue(assignment.arithmetic.amount, state.constants);
          if (source !== null && amount !== null) {
            state.constants.set(name, assignment.arithmetic.operator === '+' ? source + amount : source - amount);
          } else {
            state.constants.delete(name);
          }
        } else {
          state.constants.set(name, scalarValue(assignment.value, state.constants));
        }
        if (state.constants.has(name)) resolvedConstants.set(name, state.constants.get(name));
      }
    } else if (instruction.op === 'NAME') {
      const source = cleanToken(instruction.args[1]);
      if (source) state.replacements.set(source, cleanToken(instruction.args[2]));
    } else if (instruction.op === 'CGDIR') {
      const directoryKey = resolveSlot(instruction.args[0], state.constants);
      if (instruction.args.length > 1 && instruction.args[1]) {
        const directory = normalizeSourcePath(instruction.args[1]);
        state.cgDirectories.set(directoryKey, directory);
        state.currentCgDirectory = directory;
      } else if (state.cgDirectories.has(directoryKey)) {
        state.currentCgDirectory = state.cgDirectories.get(directoryKey);
      }
    } else if (instruction.op === 'LCG') {
      const slotNumber = numericValue(instruction.args[0], state.constants);
      const slot = resolveSlot(instruction.args[0], state.constants);
      const sourceName = cleanToken(scalarValue(instruction.args[1], state.constants));
      const width = numericValue(instruction.args[2], state.constants);
      const height = numericValue(instruction.args[3], state.constants);
      if (slotNumber === null) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-lcg-slot',
          'LCG slotを数値・16進・静的定数として解決できません。',
          instruction,
        ));
      }
      if (!sourceName) {
        diagnostics.push(diagnostic('error', 'missing-lcg-source', 'LCGの画像名が空です。', instruction));
      }
      if (width === null || height === null || width <= 0 || height <= 0) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-lcg-crop',
          'LCG width/heightは正の数値・16進・静的定数で指定してください。',
          instruction,
        ));
      }
      unlinkCgSlot(slot);
      state.cgSlots.set(slot, {
        source: joinSourcePath(state.currentCgDirectory, appendExtension(sourceName, '.PVR')),
        crop: {
          width,
          height,
        },
      });
    } else if (instruction.op === 'LINKCG' || instruction.op === 'LINK') {
      const left = resolveSlot(instruction.args[0], state.constants);
      const right = resolveSlot(instruction.args[1], state.constants);
      unlinkCgSlot(left);
      unlinkCgSlot(right);
      const link = { left, right };
      state.cgLinks.set(left, link);
      state.cgLinks.set(right, link);
    } else if (instruction.op === 'CCG') {
      const sourceSlot = resolveSlot(instruction.args[0], state.constants);
      const destinationSlot = resolveSlot(instruction.args[1], state.constants);
      unlinkCgSlot(destinationSlot);
      state.cgSlots.delete(destinationSlot);
      state.cgRequirementKeys.delete(destinationSlot);
      state.cgPlacements.delete(destinationSlot);
      const sourceRecord = state.cgSlots.get(sourceSlot);
      if (sourceRecord) state.cgSlots.set(destinationSlot, { ...sourceRecord, crop: { ...sourceRecord.crop } });
      const sourceLink = state.cgLinks.get(sourceSlot);
      if (sourceLink) {
        const otherSlot = sourceLink.left === sourceSlot ? sourceLink.right : sourceLink.left;
        const copiedOther = `${destinationSlot}__LINK`;
        if (state.cgSlots.has(otherSlot)) {
          state.cgSlots.set(copiedOther, {
            ...state.cgSlots.get(otherSlot),
            crop: { ...state.cgSlots.get(otherSlot).crop },
          });
          const link = sourceLink.left === sourceSlot
            ? { left: destinationSlot, right: copiedOther }
            : { left: copiedOther, right: destinationSlot };
          state.cgLinks.set(destinationSlot, link);
          state.cgLinks.set(copiedOther, link);
        }
      }
    } else if (instruction.op === 'DCG') {
      if (String(instruction.args[1] || '').trim().toUpperCase() === 'OFF') {
        const slots = [resolveSlot(instruction.args[0], state.constants)].filter(Boolean);
        instructionFact.cgRemovalSlots = slots;
        clearCgVisibility(slots);
      }
    } else if (instruction.op === 'UNLOADCG' || instruction.op === 'UNLOAD' || instruction.op === 'UNL') {
      const slots = resolveUnloadSlots(instruction.args[0], instruction.args[1]);
      instructionFact.cgRemovalSlots = slots;
      clearCgVisibility(slots);
      // UNLOAD/DCG describe display lifetime in the source scripts. The same
      // LCG slot is routinely shown again without another LCG, so retain its
      // source metadata while clearing only the active PCE sprite placement.
    } else if (instruction.op === 'CLEARCG') {
      state.cgSlots.clear();
      state.cgLinks.clear();
      state.cgPlacements.clear();
      state.cgRequirementKeys.clear();
    } else if (instruction.op === 'ICG') {
      const image = imageRecordForSlot(instruction.args[0]);
      const slot = resolveSlot(instruction.args[0], state.constants);
      if (image) {
        const initialOpacity = numericValue(instruction.args[4], state.constants);
        state.cgPlacements.set(slot, {
          x: numericValue(instruction.args[1], state.constants)
            ?? (cleanToken(instruction.args[1]) || '0'),
          y: numericValue(instruction.args[2], state.constants)
            ?? (cleanToken(instruction.args[2]) || '0'),
          visible: initialOpacity === null || initialOpacity > 0,
        });
        instructionFact.cgSlot = slot;
        instructionFact.image = image;
        const requirement = addRequirement(
          requirements,
          'image',
          image.parts,
          occurrence(instruction),
          { parts: image.parts, crops: image.crops, orderedSlots: image.orderedSlots, split: image.parts.length > 1 },
        );
        instructionFact.requirementKey = requirement.key;
        state.cgRequirementKeys.set(slot, requirement.key);
      } else {
        diagnostics.push(diagnostic(
          'error',
          'unresolved-cg-slot',
          `ICG slot ${instruction.args[0] || '(空)'} のLCG/LINKCG状態を解決できません。`,
          instruction,
        ));
      }
    } else if (instruction.op === 'FADE') {
      const slot = resolveSlot(instruction.args[0], state.constants);
      const alpha = isAlphaFadeInstruction(instruction);
      const image = imageRecordForSlot(instruction.args[0]);
      const placement = state.cgPlacements.get(slot);
      instructionFact.fade = {
        isAlpha: alpha,
        slot,
        fromOpacity: alpha ? numericValue(instruction.args[3], state.constants) : null,
        toOpacity: alpha ? numericValue(instruction.args[4], state.constants) : null,
        placement: placement ? { ...placement } : null,
      };
      if (alpha && image && placement) {
        const requirement = addRequirement(
          requirements,
          'image',
          image.parts,
          occurrence(instruction),
          { parts: image.parts, crops: image.crops, orderedSlots: image.orderedSlots, split: image.parts.length > 1 },
        );
        instructionFact.fade.requirementKey = requirement.key;
      }
      if (alpha && placement && Number.isFinite(instructionFact.fade.toOpacity)) {
        state.cgPlacements.set(slot, {
          ...placement,
          visible: instructionFact.fade.toOpacity > 0,
        });
      }
    } else if (instruction.op === 'PCMDIR') {
      state.currentPcmDirectory = normalizeSourcePath(instruction.args[0]);
    } else if (instruction.op === 'LPCM') {
      const slotNumber = numericValue(instruction.args[0], state.constants);
      const sourceName = cleanToken(scalarValue(instruction.args[1], state.constants));
      if (slotNumber === null) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-lpcm-slot',
          'LPCM slotを数値・16進・静的定数として解決できません。',
          instruction,
        ));
      }
      if (!sourceName) {
        diagnostics.push(diagnostic('error', 'missing-lpcm-source', 'LPCMのP04名が空です。', instruction));
      }
      state.p04Slots.set(
        resolveSlot(instruction.args[0], state.constants),
        joinSourcePath(state.currentPcmDirectory, appendExtension(sourceName, '.P04')),
      );
    } else if (instruction.op === 'PLAYP') {
      const source = state.p04Slots.get(resolveSlot(instruction.args[0], state.constants));
      const loop = String(instruction.args[2] || '').trim().toUpperCase() === 'ON';
      const usage = source ? classifyP04Source(source) : 'sfx';
      const rawPlaybackRate = cleanToken(instruction.args[1]);
      const resolvedPlaybackRate = resolvePlaypPlaybackRate(instruction.args[1], state.constants);
      const playbackRate = resolvedPlaybackRate ?? 32000;
      if (rawPlaybackRate && resolvedPlaybackRate === null) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-playp-rate',
          'PLAYP rateを正の数値・16進・静的定数として解決できません。',
          instruction,
        ));
      }
      if (source && resolvedPlaybackRate !== null) {
        const requirement = addRequirement(
          requirements,
          'p04',
          source,
          occurrence(instruction),
          { usage, loop, playbackRate, channel: String(instruction.args[3] || '0') },
        );
        Object.assign(instructionFact, {
          p04Source: source,
          loop,
          usage,
          playbackRate,
          requirementKey: requirement.key,
        });
        if (!loop && usage === 'voice') {
          state.pendingVoiceKey = requirement.key;
          state.pendingVoiceInstruction = instruction;
        }
      } else if (!source) {
        diagnostics.push(diagnostic(
          'error',
          'unresolved-p04-slot',
          `PLAYP slot ${instruction.args[0] || '(空)'} のLPCMを解決できません。`,
          instruction,
        ));
      }
    } else if (instruction.op === 'STOPP' || instruction.op === 'STOPG' || instruction.op === 'CPCM') {
      state.pendingVoiceKey = '';
      state.pendingVoiceInstruction = null;
      if (instruction.op === 'CPCM') {
        const slots = instruction.args.filter((entry) => String(entry || '').trim())
          .map((entry) => resolveSlot(entry, state.constants));
        if (slots.length) slots.forEach((entry) => state.p04Slots.delete(entry));
        else state.p04Slots.clear();
      }
    } else if (instruction.op === 'PLAYM') {
      const track = Math.round(numericValue(instruction.args[0], state.constants) ?? -1);
      if (track >= 0) {
        const requirement = addRequirement(
          requirements,
          'midi',
          `MIDI/PM_bank00_track${String(track).padStart(2, '0')}.mid`,
          occurrence(instruction),
          { track, usage: 'bgm' },
        );
        instructionFact.requirementKey = requirement.key;
      } else {
        diagnostics.push(diagnostic('error', 'invalid-midi-track', 'PLAYMのtrack番号を解決できません。', instruction));
      }
    } else if (instruction.op === 'PLAYGD') {
      const gdTrack = Math.round(numericValue(instruction.args[0], state.constants) ?? -1);
      if (gdTrack >= 0) {
        const requirement = addRequirement(
          requirements,
          'cdda',
          `gd-rom/track${String(gdTrack + 3).padStart(2, '0')}.raw`,
          occurrence(instruction),
          { scriptTrack: gdTrack, physicalTrack: gdTrack + 3, usage: 'bgm' },
        );
        instructionFact.requirementKey = requirement.key;
      } else {
        diagnostics.push(diagnostic('error', 'invalid-gd-track', 'PLAYGDのtrack番号を解決できません。', instruction));
      }
    }

    if (instruction.op === 'COLOR' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      state.currentColorToken = String(instruction.args[1] || '').trim() || '(default)';
      if (!colorTokens.has(state.currentColorToken)) {
        colorTokens.set(state.currentColorToken, { token: state.currentColorToken, occurrences: [] });
      }
      colorTokens.get(state.currentColorToken).occurrences.push(occurrence(instruction));
    }
    if (instruction.op === 'MSG' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      state.messageBuffer += instruction.args.slice(1).join(',');
    } else if ((instruction.op === 'CLEAR' || instruction.op === 'CLEARW')
      && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      state.messageBuffer = '';
      state.pendingVoiceKey = '';
      state.pendingVoiceInstruction = null;
    } else if (instruction.op === 'WAIT' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
      instructionFact.message = {
        text: replaceNames(normalizeMessageText(state.messageBuffer), state.replacements, options.protagonistName),
        colorToken: state.currentColorToken,
        voiceRequirementKey: state.pendingVoiceKey,
        voiceInstruction: state.pendingVoiceInstruction,
      };
      state.messageBuffer = '';
      state.pendingVoiceKey = '';
      state.pendingVoiceInstruction = null;
    }

    if (instruction.op === 'MENU') {
      const choices = instruction.args.slice(3)
        .map((choice) => cleanToken(choice))
        .filter(Boolean)
        .map((choice) => replaceNames(choice, state.replacements, options.protagonistName));
      state.pendingMenu = {
        instruction,
        id: String(instruction.args[0] || ''),
        choices,
      };
      if (choices.some((choice) => Array.from(choice).length > 24)) {
        diagnostics.push(diagnostic(
          'warning',
          'choice-label-truncated',
          'MENU選択肢の24文字を超える部分をPCE Choice表示で切り詰めます。',
          instruction,
        ));
      }
    } else if ((instruction.op === 'ONRMG' || instruction.op === 'ONMG') && state.pendingMenu) {
      instructionFact.menu = state.pendingMenu;
      state.pendingMenu = null;
    }
    if (instruction.op === 'WAITBTN') {
      const variable = String(instruction.args[0] || '').trim().toUpperCase();
      if (!isVariableIdentifier(variable)) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-variable-name',
          'WAITBTNには有効なvariable名が必要です。',
          instruction,
        ));
      }
      state.pendingWaitBtn = {
        variable,
        instruction,
      };
      if (variable) state.constants.delete(variable);
      instructionFact.waitBtn = state.pendingWaitBtn;
    } else if (instruction.op === 'ONG') {
      const source = String(instruction.args[0] || '').trim().toUpperCase();
      if (!BUTTON_NAMES.has(source) && instruction.args.length > 1) {
        if (!isVariableIdentifier(source)) {
          diagnostics.push(diagnostic(
            'error',
            'invalid-variable-name',
            'variable分岐ONGには有効なvariable名が必要です。',
            instruction,
          ));
        }
        if (state.pendingWaitBtn?.variable === source) {
          instructionFact.waitBtn = state.pendingWaitBtn;
        } else {
          diagnostics.push(diagnostic(
            'error',
            'unsupported-input-cycle',
            'ONG variable分岐の直前の同じbasic blockに、同じvariableのWAITBTNがありません。',
            instruction,
          ));
        }
        const validBranchCount = instruction.args.slice(1)
          .filter((label) => label && label.toUpperCase() !== 'NULL').length;
        if (validBranchCount < 1 || validBranchCount > 4) {
          diagnostics.push(diagnostic(
            'error',
            'unsupported-input-cycle',
            'WAITBTN/ONGは1〜4件の有効分岐が必要です。',
            instruction,
          ));
        }
        state.pendingWaitBtn = null;
      } else if (BUTTON_NAMES.has(source)) {
        if (state.pendingWaitBtn) {
          diagnostics.push(diagnostic(
            'error',
            'unsupported-input-cycle',
            'WAITBTNの後にbutton handler ONGがあり、variable分岐として対応付けられません。',
            state.pendingWaitBtn.instruction,
          ));
          state.pendingWaitBtn = null;
        }
        if (!isRecognizedPhotoHandler(node, reachability)) {
          diagnostics.push(diagnostic(
            'error',
            'unsupported-input-cycle',
            `単独の ${instruction.op} ${source} handlerは通常入力cycleとして判定できないため変換できません。`,
            instruction,
          ));
        } else {
          diagnostics.push(diagnostic(
            'warning',
            'photo-input-approximation',
            `${instruction.op} ${source} の撮影handlerを省略し、非撮影側の直線経路へ固定します。`,
            instruction,
          ));
        }
      }
    }

    if (instruction.op === 'ONC' && !isVariableIdentifier(instruction.args[0])) {
      diagnostics.push(diagnostic(
        'error',
        'invalid-variable-name',
        'ONCには有効なvariable名が必要です。',
        instruction,
      ));
    }

    if (['MSG', 'COLOR', 'CLEAR', 'CLEARW'].includes(instruction.op)
      && String(instruction.args[0] || '').toUpperCase() !== 'WIN_MSG') {
      diagnostics.push(diagnostic(
        'warning',
        'auxiliary-window-omitted',
        `${instruction.op} ${instruction.args[0] || '(空)'} はWIN_MSG以外のwindow操作として省略します。`,
        instruction,
      ));
    } else if (instruction.op === 'RANDOM') {
      diagnostics.push(diagnostic(
        'error',
        'unsupported-random',
        'RANDOMによる非決定的なvariable更新は初版変換で保持できません。',
        instruction,
      ));
    } else if (instruction.op === 'INKEY'
      && runtimeVariables.has(String(instruction.args[0] || '').trim().toUpperCase())) {
      diagnostics.push(diagnostic(
        'error',
        'unsupported-input-producer',
        '分岐variableへ値を供給するINKEYを省略すると分岐を保持できません。',
        instruction,
      ));
    } else if (instruction.op === 'ONTG' && !isBranchingTimerInstruction(instruction)) {
      diagnostics.push(diagnostic(
        'warning',
        'timer-reset-omitted',
        '分岐先のないONTG timer resetを省略します。',
        instruction,
      ));
    } else if (instruction.op === 'WAIT'
      && String(instruction.args[0] || '').toUpperCase() !== 'WIN_MSG') {
      if (instruction.args.length >= 3 && String(instruction.args[1] || '') !== '4') {
        const frames = numericValue(instruction.args[2], state.constants);
        if (frames === null) {
          diagnostics.push(diagnostic(
            'error',
            'unsupported-wait',
            'WAITのframe数を数値・16進・静的定数として解決できません。',
            instruction,
          ));
        } else if (frames < 0 || frames > 65535) {
          diagnostics.push(diagnostic(
            'error',
            'wait-range',
            'WAITのframe数は0〜65535で指定してください。',
            instruction,
          ));
        }
      } else {
        diagnostics.push(diagnostic(
          'warning',
          'wait-omitted',
          'PCE VNのframe waitへ変換できないWAITを省略します。',
          instruction,
        ));
      }
    } else if (APPROXIMATE_VISUAL_COMMANDS.has(instruction.op)) {
      diagnostics.push(diagnostic('warning', 'visual-effect-omitted', `${instruction.op} の演出はPCE VNで省略します。`, instruction));
    } else if (instruction.op === 'FADE') {
      const fade = instructionFact.fade;
      const hasKnownAlphaTarget = Boolean(
        fade?.isAlpha
        && fade.requirementKey
        && fade.placement
        && Number.isFinite(fade.toOpacity)
        && fade.toOpacity >= 0
        && fade.toOpacity <= 1
      );
      if (!hasKnownAlphaTarget) {
        diagnostics.push(diagnostic(
          'warning',
          'fade-omitted',
          'BG・キャラクターを対象とするCG alpha FADEは省略し、BG切替はPCE VNのfadeに任せます。',
          instruction,
        ));
      }
    } else if (instruction.op === 'SCREEN') {
      diagnostics.push(diagnostic('warning', 'screen-approximated', 'SCREENをPCE VNのfade/flash/blankへ簡略化します。', instruction));
    } else if (OMITTED_COMMANDS.has(instruction.op)
      && !isSupportedSpriteVisibilityInstruction(instruction)) {
      diagnostics.push(diagnostic('warning', 'command-omitted', `${instruction.op} は初版変換で省略します。`, instruction));
    }

    if (!node.edges.length) {
      if (state.pendingWaitBtn) {
        diagnostics.push(diagnostic(
          'error',
          'unsupported-input-cycle',
          'WAITBTNに対応するONG variable分岐へ到達せず終端しました。',
          state.pendingWaitBtn.instruction,
        ));
        state.pendingWaitBtn = null;
      }
      if (state.pendingMenu) {
        diagnostics.push(diagnostic(
          'error',
          'incomplete-menu-cycle',
          'MENUに対応するONRMG/ONMG分岐へ到達せず終端しました。',
          state.pendingMenu.instruction,
        ));
        state.pendingMenu = null;
      }
    }

    node.edges.forEach((edge) => {
      const outgoingState = cloneFactState(state);
      if (instruction.op === 'ONG' && edge.kind === 'input-choice') {
        const variable = String(instruction.args[0] || '').trim().toUpperCase();
        if (variable && Number.isInteger(edge.value)) outgoingState.constants.set(variable, edge.value + 1);
      }
      if (!inputStates.has(edge.key)) {
        inputStates.set(edge.key, outgoingState);
        queued.push(edge.key);
      }
    });
  }

  return {
    requirements,
    colorTokens,
    facts,
    diagnostics: dedupeDiagnostics(diagnostics),
    runtimeVariables,
    constants: resolvedConstants,
  };
}

function inspectScripts({
  files = [],
  entryScript = '',
  protagonistName = DEFAULT_PROTAGONIST_NAME,
} = {}) {
  const programs = files.map((file) => parseScrBuffer(file.path, file.buffer));
  const reachability = buildReachability(programs, entryScript || files[0]?.path || '');
  const analysis = analyzeInstructionFactsCfg(programs, reachability, { protagonistName });
  const structuralBlocks = buildBasicBlocks({ programs, reachability }, 'khpm_inspect');
  const rootBlockIndexes = new Set(
    (reachability.rootKeys?.length ? reachability.rootKeys : [reachability.entryKey])
      .map((key) => structuralBlocks.blockByNode.get(key))
      .filter((index) => Number.isInteger(index)),
  );
  // Every selected SCR root must remain independently addressable. Basic blocks
  // inside one SCR can be packed later, so their raw count is not a scene count.
  const minimumSceneCount = rootBlockIndexes.size || (structuralBlocks.blocks.length ? 1 : 0);
  const basicBlockCount = structuralBlocks.blocks.length;
  const diagnostics = dedupeDiagnostics([
    ...analysis.diagnostics,
    ...validateRuntimeVariableNames(analysis),
    ...(minimumSceneCount > MAX_SCENES ? [sceneCountLimitDiagnostic(minimumSceneCount)] : []),
  ]);
  return {
    programs,
    reachability,
    facts: analysis.facts,
    requirements: Array.from(analysis.requirements.values()),
    colorTokens: Array.from(analysis.colorTokens.values()),
    diagnostics,
    runtimeVariables: analysis.runtimeVariables,
    constants: analysis.constants,
    entryScript: normalizeRelativeScriptPath(entryScript || files[0]?.path || ''),
    basicBlockCount,
    minimumSceneCount,
    // Retained for callers of the v1 inspection shape. It is now the guaranteed
    // lower bound, not the pre-packing basic-block count.
    estimatedSceneCount: minimumSceneCount,
    canApply: !diagnostics.some((entry) => entry.severity === 'error'),
  };
}

function publicInspection(analysis) {
  const reachableInstructionCount = analysis.reachability.reachableLocations.size;
  const reachableInstructions = [];
  const seenInstructions = new Set();
  analysis.reachability.order.forEach((key) => {
    const instruction = analysis.reachability.nodes.get(key)?.instruction;
    if (!instruction) return;
    const location = `${instruction.script}:${instruction.line}`;
    if (seenInstructions.has(location)) return;
    seenInstructions.add(location);
    reachableInstructions.push({
      script: instruction.script,
      line: instruction.line,
      op: instruction.op,
    });
  });
  return {
    entryCandidates: analysis.programs.map((program) => program.path),
    selectedScripts: analysis.programs.map((program) => program.path),
    colorTokens: analysis.colorTokens.map((entry) => ({
      ...entry,
      count: entry.occurrences.length,
    })),
    assetRequirements: analysis.requirements,
    reachableInstructions,
    diagnostics: analysis.diagnostics,
    summary: {
      selectedScriptCount: analysis.programs.length,
      reachableInstructionCount,
      basicBlockCount: analysis.basicBlockCount,
      minimumSceneCount: analysis.minimumSceneCount,
      colorTokenCount: analysis.colorTokens.length,
      assetRequirementCount: analysis.requirements.length,
      warningCount: analysis.diagnostics.filter((entry) => entry.severity === 'warning').length,
      errorCount: analysis.diagnostics.filter((entry) => entry.severity === 'error').length,
    },
    canApply: analysis.canApply,
  };
}

function isControlInstruction(instruction) {
  if (!instruction) return false;
  if (['GOTO', 'GOT', 'END', 'ONRMG', 'ONMG', 'ONC'].includes(instruction.op)) return true;
  if (isBranchingTimerInstruction(instruction)) return true;
  if (instruction.op === 'ONG') {
    const source = String(instruction.args[0] || '').trim().toUpperCase();
    return !BUTTON_NAMES.has(source);
  }
  return instruction.op === 'IF'
    && Boolean(instruction.condition?.then?.match(/^GOT(?:O)?\s+/i));
}

function sceneCountLimitDiagnostic(sceneCount) {
  return diagnostic(
    'error',
    'scene-count-limit',
    `変換scene数 ${sceneCount} がPCE VN runtime上限 ${MAX_SCENES} を超えます。選択SCRを分けてください。`,
  );
}

function buildBasicBlocks(analysis, namespace) {
  const {
    nodes, order, entryKey, rootKeys = [],
  } = analysis.reachability;
  const indegree = new Map(order.map((key) => [key, 0]));
  order.forEach((key) => {
    const node = nodes.get(key);
    node.edges.forEach((edge) => indegree.set(edge.key, (indegree.get(edge.key) || 0) + 1));
  });

  const leaders = new Set();
  (rootKeys.length ? rootKeys : [entryKey]).filter(Boolean).forEach((key) => leaders.add(key));
  order.forEach((key) => {
    const node = nodes.get(key);
    if ((indegree.get(key) || 0) !== 1 || node.instruction.op === 'LABEL') leaders.add(key);
    if (node.edges.length !== 1 || isControlInstruction(node.instruction)) {
      node.edges.forEach((edge) => leaders.add(edge.key));
    }
  });

  const assigned = new Map();
  const blocks = [];
  const starts = [
    ...order.filter((key) => leaders.has(key)),
    ...order.filter((key) => !leaders.has(key)),
  ];

  starts.forEach((startKey) => {
    if (assigned.has(startKey)) return;
    const block = { index: blocks.length, nodes: [] };
    let key = startKey;
    while (key && !assigned.has(key)) {
      const node = nodes.get(key);
      if (!node) break;
      assigned.set(key, block.index);
      block.nodes.push(node);
      if (block.nodes.length >= MAX_BLOCK_SOURCE_INSTRUCTIONS) break;
      if (isControlInstruction(node.instruction) || node.edges.length !== 1) break;
      const nextKey = node.edges[0].key;
      if (leaders.has(nextKey) || (indegree.get(nextKey) || 0) !== 1) break;
      key = nextKey;
    }
    const first = block.nodes[0];
    const program = analysis.programs[first.fileIndex];
    const labelInstruction = block.nodes.find((node) => node.instruction.op === 'LABEL');
    const label = labelInstruction?.instruction?.args?.[0]
      || `${program.path.split('/').pop().replace(/\.scr$/i, '')}_${first.instruction.line}`;
    const idSuffix = `_${block.index + 1}`;
    const idPrefix = safeIdentifier(
      `${namespace}_${label}`,
      'khpm_scene',
      72 - idSuffix.length,
    );
    block.id = `${idPrefix}${idSuffix}`;
    block.source = {
      script: program.path,
      startLine: Math.min(...block.nodes.map((node) => node.instruction.line)),
      endLine: Math.max(...block.nodes.map((node) => node.instruction.line)),
    };
    blocks.push(block);
  });

  return {
    blocks,
    blockByNode: assigned,
    entryBlockIndex: assigned.get(entryKey) ?? 0,
  };
}

function packedTextBytes(value = '') {
  const glyphCount = Array.from(String(value || '')).filter((character) => character !== '\r').length;
  return (glyphCount + 1) * 2;
}

function estimatePackedSceneCost(commands = [], { includeHeader = true } = {}) {
  let commandCount = 0;
  let byteCount = includeHeader ? VN_SCENE_PACK_HEADER_BYTES : 0;
  commands.forEach((command) => {
    if (!command || command.type === 'comment' || command.skip === true
      || command.skipped === true || command.debugSkip === true) return;
    commandCount += 1;
    byteCount += VN_SCENE_PACK_COMMAND_BYTES;
    if (command.type === 'message') {
      byteCount += VN_SCENE_PACK_MESSAGE_BYTES;
      const fullText = command.speaker
        ? String(command.speaker) + '\n' + String(command.text || '')
        : String(command.text || '');
      byteCount += packedTextBytes(fullText);
      // CD builds can insert one internal CACHE command before a voiced message.
      if (command.voiceAssetId) {
        commandCount += 1;
        byteCount += VN_SCENE_PACK_COMMAND_BYTES;
      }
    } else if (command.type === 'choice') {
      const choices = (command.choices || []).slice(0, 4);
      byteCount += VN_SCENE_PACK_CHOICE_BYTES;
      choices.forEach((choice) => {
        byteCount += VN_SCENE_PACK_CHOICE_OPTION_BYTES;
        byteCount += packedTextBytes(String(choice?.label || '').replace(/[\r\n]/g, ''));
      });
    } else if (command.type === 'switch') {
      const cases = (command.cases || []).slice(0, 16);
      byteCount += VN_SCENE_PACK_SWITCH_BYTES
        + (cases.length * VN_SCENE_PACK_SWITCH_CASE_BYTES);
    }
  });
  return { commands: commandCount, bytes: byteCount };
}

function estimatePackedFragmentCost(fragment) {
  const cost = estimatePackedSceneCost(fragment.commands, { includeHeader: false });
  // Every raw block gets an addressable entry label. A non-control successor is
  // made explicit because packed block order is based on source location. A
  // terminal block jumps to the packed scene's common end label instead.
  const flowCommandCount = fragment.nextBlockId || fragment.needsTerminalFlow ? 1 : 0;
  cost.commands += 1 + flowCommandCount;
  cost.bytes += VN_SCENE_PACK_COMMAND_BYTES * (1 + flowCommandCount);
  fragment.commands.forEach((command) => {
    if (command?.type !== 'choice') return;
    const choices = (command.choices || []).slice(0, 4);
    const targetIds = new Set(choices.map((choice) => choice?.targetSceneId).filter(Boolean));
    // Choice falls through into a local Switch. Assume every distinct target
    // needs a bridge label plus Jump; local targets will use fewer commands.
    const addedCommands = 2 + (targetIds.size * 2);
    cost.commands += addedCommands;
    cost.bytes += (addedCommands * VN_SCENE_PACK_COMMAND_BYTES)
      + VN_SCENE_PACK_SWITCH_BYTES
      + (choices.filter((choice) => choice?.targetSceneId).length
        * VN_SCENE_PACK_SWITCH_CASE_BYTES);
  });
  return cost;
}

function fragmentTargetBlockIds(fragment) {
  const targetIds = [];
  if (fragment.nextBlockId) targetIds.push(fragment.nextBlockId);
  fragment.commands.forEach((command) => {
    if (command?.type === 'jump' && command.sceneId) targetIds.push(command.sceneId);
    if (command?.type === 'choice') {
      (command.choices || []).forEach((choice) => {
        if (choice?.targetSceneId) targetIds.push(choice.targetSceneId);
      });
    }
  });
  return targetIds;
}

function blockEntryLabel(block) {
  return normalizeLabel('b' + (block.index + 1) + '_entry');
}

function packedGroupEndLabel(group) {
  const firstBlock = group.fragments[0]?.block;
  return normalizeLabel('pack_b' + ((firstBlock?.index ?? group.index ?? 0) + 1) + '_end');
}

function packBlockFragments(fragments, rootBlockIds = []) {
  const roots = new Set(rootBlockIds);
  const byScript = new Map();
  fragments.forEach((fragment) => {
    const script = String(fragment.block.source?.script || '');
    if (!byScript.has(script)) byScript.set(script, []);
    fragment.cost = estimatePackedFragmentCost(fragment);
    byScript.get(script).push(fragment);
  });
  byScript.forEach((entries) => entries.sort((left, right) => (
    compareImportedSceneEntries(left, right)
  )));

  let groups = [];
  let groupByBlockId = new Map();
  const maxIterations = Math.max(1, fragments.length + 1);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    groups = [];
    groupByBlockId = new Map();
    [...byScript.entries()]
      .sort(([left], [right]) => left.toUpperCase().localeCompare(right.toUpperCase(), 'en'))
      .forEach(([script, entries]) => {
        let group = null;
        entries.forEach((fragment) => {
          const forceBoundary = Boolean(group?.fragments.length && roots.has(fragment.block.id));
          const exceedsTarget = Boolean(group?.fragments.length && (
            group.estimatedCommands + fragment.cost.commands > PACKED_SCENE_COMMAND_TARGET
            || group.estimatedBytes + fragment.cost.bytes > PACKED_SCENE_BYTE_TARGET
          ));
          if (!group || forceBoundary || exceedsTarget) {
            group = {
              script,
              fragments: [],
              // Every packed scene ends at one explicit label so terminal
              // fragments cannot fall through into another raw block.
              estimatedCommands: 1,
              estimatedBytes: VN_SCENE_PACK_HEADER_BYTES + VN_SCENE_PACK_COMMAND_BYTES,
            };
            groups.push(group);
          }
          group.fragments.push(fragment);
          group.estimatedCommands += fragment.cost.commands;
          group.estimatedBytes += fragment.cost.bytes;
          groupByBlockId.set(fragment.block.id, group);
        });
      });

    let changed = false;
    fragments.forEach((fragment) => {
      const sourceGroup = groupByBlockId.get(fragment.block.id);
      fragmentTargetBlockIds(fragment).forEach((targetId) => {
        const targetGroup = groupByBlockId.get(targetId);
        if (!sourceGroup || !targetGroup || sourceGroup === targetGroup) return;
        if (targetGroup.fragments[0]?.block.id === targetId || roots.has(targetId)) return;
        roots.add(targetId);
        changed = true;
      });
    });
    if (!changed) break;
  }

  groups.forEach((group, index) => {
    group.index = index;
    group.id = group.fragments[0]?.block.id || 'khpm_scene_' + (index + 1);
  });
  return { groups, groupByBlockId, rootBlockIds: roots };
}

function sourceForFragmentCommand(fragment, commandIndex) {
  const source = fragment.commandSources.find((entry) => entry.commandIndex === commandIndex);
  if (source) return { script: source.script, line: source.line };
  return {
    script: fragment.block.source.script,
    line: fragment.block.source.startLine,
  };
}

function rewritePackedFlow(targetBlockId, sourceGroup, packed) {
  const targetGroup = packed.groupByBlockId.get(targetBlockId);
  const targetFragment = targetGroup?.fragments.find((entry) => entry.block.id === targetBlockId);
  if (!targetGroup || !targetFragment) return null;
  if (targetGroup === sourceGroup) {
    return { type: 'goto', targetLabel: blockEntryLabel(targetFragment.block) };
  }
  return { type: 'jump', sceneId: targetGroup.id };
}

function appendPackedChoice({
  command,
  commandIndex,
  fragment,
  group,
  packed,
  append,
  source,
}) {
  const choices = (command.choices || []).slice(0, 4);
  append({
    ...command,
    choices: choices.map((choice) => ({ ...choice, targetSceneId: '' })),
  }, source);

  const prefix = 'b' + (fragment.block.index + 1) + '_choice_' + (commandIndex + 1);
  const endLabel = normalizeLabel(prefix + '_end');
  const bridges = new Map();
  const cases = [];
  choices.forEach((choice) => {
    const targetBlockId = choice?.targetSceneId;
    if (!targetBlockId) return;
    const targetGroup = packed.groupByBlockId.get(targetBlockId);
    let targetLabel = '';
    if (targetGroup === group) {
      const targetFragment = targetGroup?.fragments.find((entry) => entry.block.id === targetBlockId);
      if (targetFragment) targetLabel = blockEntryLabel(targetFragment.block);
    } else if (targetGroup) {
      if (!bridges.has(targetBlockId)) {
        bridges.set(targetBlockId, normalizeLabel(prefix + '_bridge_' + (bridges.size + 1)));
      }
      targetLabel = bridges.get(targetBlockId);
    }
    if (targetLabel) cases.push({ value: choice.value, targetLabel });
  });
  append({
    type: 'switch',
    variableName: command.variableName,
    cases,
    defaultLabel: endLabel,
  }, source);
  bridges.forEach((label, targetBlockId) => {
    append({ type: 'label', name: label }, source);
    const flow = rewritePackedFlow(targetBlockId, group, packed);
    if (flow) append(flow, source);
  });
  append({ type: 'label', name: endLabel }, source);
}

function buildPackedSceneEntry(group, packed) {
  const commands = [];
  const commandSources = [];
  const endLabel = packedGroupEndLabel(group);
  const append = (command, source) => {
    if (!command) return;
    const commandIndex = commands.length;
    commands.push(command);
    commandSources.push({ commandIndex, ...source });
  };

  group.fragments.forEach((fragment) => {
    const blockSource = {
      script: fragment.block.source.script,
      line: fragment.block.source.startLine,
    };
    append({ type: 'label', name: blockEntryLabel(fragment.block) }, blockSource);
    fragment.commands.forEach((command, commandIndex) => {
      const source = sourceForFragmentCommand(fragment, commandIndex);
      if (command?.type === 'jump' && command.sceneId) {
        append(rewritePackedFlow(command.sceneId, group, packed), source);
      } else if (command?.type === 'choice') {
        appendPackedChoice({
          command,
          commandIndex,
          fragment,
          group,
          packed,
          append,
          source,
        });
      } else {
        append(command, source);
      }
    });
    if (fragment.nextBlockId) {
      const lastNode = fragment.block.nodes[fragment.block.nodes.length - 1];
      append(rewritePackedFlow(fragment.nextBlockId, group, packed), {
        script: fragment.block.source.script,
        line: lastNode?.instruction?.line || fragment.block.source.endLine,
      });
    } else if (fragment.needsTerminalFlow) {
      const lastNode = fragment.block.nodes[fragment.block.nodes.length - 1];
      append({ type: 'goto', targetLabel: endLabel }, {
        script: fragment.block.source.script,
        line: lastNode?.instruction?.line || fragment.block.source.endLine,
      });
    }
  });
  const lastFragment = group.fragments[group.fragments.length - 1];
  append({ type: 'label', name: endLabel }, {
    script: lastFragment.block.source.script,
    line: lastFragment.block.source.endLine,
  });

  const source = {
    script: group.script,
    startLine: Math.min(...group.fragments.map((fragment) => fragment.block.source.startLine)),
    endLine: Math.max(...group.fragments.map((fragment) => fragment.block.source.endLine)),
  };
  const block = {
    id: group.id,
    index: group.index,
    source,
    commandSources,
  };
  return {
    block,
    scene: {
      id: group.id,
      name: '北へ。PM/' + source.script + '/' + source.startLine,
      fullScreenBg: false,
      commands,
      nextSceneId: '',
    },
  };
}

function compareImportedSceneEntries(left, right) {
  const leftSource = left.block.source || {};
  const rightSource = right.block.source || {};
  const scriptCompare = String(leftSource.script || '').toUpperCase()
    .localeCompare(String(rightSource.script || '').toUpperCase(), 'en');
  if (scriptCompare !== 0) return scriptCompare;
  const startLineCompare = Number(leftSource.startLine || 0) - Number(rightSource.startLine || 0);
  if (startLineCompare !== 0) return startLineCompare;
  const endLineCompare = Number(leftSource.endLine || 0) - Number(rightSource.endLine || 0);
  if (endLineCompare !== 0) return endLineCompare;
  return left.block.index - right.block.index;
}

function mappingCollections(mapping = {}) {
  const assets = mapping.assets && typeof mapping.assets === 'object'
    ? mapping.assets
    : (mapping.assetMappings && typeof mapping.assetMappings === 'object' ? mapping.assetMappings : {});
  return { assets };
}
function normalizeAssetMapping(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const action = raw.action === 'omit' || raw.omit === true ? 'omit' : 'map';
  const display = raw.display === 'sprite' || raw.kind === 'sprite' || raw.type === 'sprite'
    ? 'sprite'
    : 'background';
  return {
    action,
    assetId: String(raw.assetId || raw.id || '').trim(),
    display,
    x: Number.isFinite(Number(raw.x ?? raw.tileX)) ? Math.round(Number(raw.x ?? raw.tileX)) : 0,
    y: Number.isFinite(Number(raw.y ?? raw.tileY)) ? Math.round(Number(raw.y ?? raw.tileY)) : 0,
    slot: Number.isFinite(Number(raw.slot)) ? Math.round(Number(raw.slot)) : 0,
    animationId: String(raw.animationId || 'default').trim() || 'default',
  };
}

function spriteAnimationIds(asset) {
  const raw = asset?.options?.animations ?? asset?.animations;
  if (Array.isArray(raw)) {
    return new Set(raw.map((entry) => String(entry?.id || '').trim()).filter(Boolean));
  }
  if (raw && typeof raw === 'object') {
    return new Set(Object.entries(raw).flatMap(([key, value]) => [
      String(key || '').trim(),
      String(value?.id || '').trim(),
    ]).filter(Boolean));
  }
  return new Set(['default']);
}

function validateMappings(analysis, mapping, assetCatalog = []) {
  const diagnostics = [];
  const normalized = {
    speakers: Object.create(null),
    assets: Object.create(null),
  };
  const collections = mappingCollections(mapping);
  const assetById = new Map((assetCatalog || []).map((asset) => [String(asset.id || ''), asset]));


  analysis.requirements.forEach((requirement) => {
    if (!Object.prototype.hasOwnProperty.call(collections.assets, requirement.key)) {
      diagnostics.push(diagnostic(
        'error',
        'missing-asset-mapping',
        `${requirement.source} のasset対応または明示的な省略が未指定です。`,
        requirement.occurrences[0],
      ));
      return;
    }
    const rawAssetMapping = collections.assets[requirement.key];
    const assetMapping = normalizeAssetMapping(rawAssetMapping);
    normalized.assets[requirement.key] = assetMapping;
    if (assetMapping.action === 'omit') {
      diagnostics.push(diagnostic(
        'warning',
        'asset-explicitly-omitted',
        `${requirement.source} はmapping設定により省略されます。`,
        requirement.occurrences[0],
      ));
      return;
    }
    if (!assetMapping.assetId || !assetById.has(assetMapping.assetId)) {
      diagnostics.push(diagnostic(
        'error',
        'missing-mapped-asset',
        `${requirement.source} の対応先asset ${assetMapping.assetId || '(空)'} がcatalogにありません。`,
        requirement.occurrences[0],
      ));
      return;
    }
    const asset = assetById.get(assetMapping.assetId);
    const expected = expectedAssetTypes(requirement, assetMapping);
    if (!expected.includes(String(asset.type || ''))) {
      diagnostics.push(diagnostic(
        'error',
        'mapped-asset-type-mismatch',
        `${requirement.source} は ${expected.join('/')} assetが必要ですが、${asset.id} は ${asset.type} です。`,
        requirement.occurrences[0],
      ));
    }
    if (requirement.kind === 'p04' && String(asset.type || '') === 'adpcm') {
      const requestedLoop = requirement.details?.loop === true;
      const assetLoop = asset.options?.loop === true;
      if (requestedLoop && !assetLoop) {
        diagnostics.push(diagnostic(
          'warning',
          'p04-loop-approximation',
          `${requirement.source} のloop PLAYPをnon-loop ADPCM asset ${asset.id} のone-shot再生へ近似します。`,
          requirement.occurrences[0],
        ));
      } else if (!requestedLoop && assetLoop) {
        diagnostics.push(diagnostic(
          'error',
          'mapped-adpcm-loop-mismatch',
          `${requirement.source} はnon-loopですが、対応先ADPCM asset ${asset.id} はloop設定です。`,
          requirement.occurrences[0],
        ));
      }
    }
    if (requirement.kind === 'image' && assetMapping.display === 'sprite') {
      const rawSlot = rawAssetMapping?.slot ?? 0;
      if (!Number.isFinite(Number(rawSlot))
        || !Number.isInteger(Number(rawSlot))
        || assetMapping.slot < 0
        || assetMapping.slot > 3) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-sprite-slot',
          `${requirement.source} のSprite slotは0〜3で指定してください。`,
          requirement.occurrences[0],
        ));
      }
      const animations = spriteAnimationIds(asset);
      if (!animations.has(assetMapping.animationId)) {
        diagnostics.push(diagnostic(
          'error',
          'missing-sprite-animation',
          `${requirement.source} のanimation ${assetMapping.animationId} がsprite asset ${asset.id} にありません。`,
          requirement.occurrences[0],
        ));
      }
    }
    if (requirement.kind === 'image' && assetMapping.display === 'background') {
      const rawX = rawAssetMapping?.x ?? rawAssetMapping?.tileX ?? 0;
      const rawY = rawAssetMapping?.y ?? rawAssetMapping?.tileY ?? 0;
      const x = Number(rawX);
      const y = Number(rawY);
      if (!Number.isFinite(x) || !Number.isInteger(x)
        || !Number.isFinite(y) || !Number.isInteger(y)
        || x < 0 || x > 31 || y < 0 || y > 31) {
        diagnostics.push(diagnostic(
          'error',
          'invalid-image-position',
          `${requirement.source} のBG tile座標は0〜31の整数で指定してください。`,
          requirement.occurrences[0],
        ));
      }
    }
  });

  return { diagnostics, normalized };
}

function validateRuntimeVariableNames(analysis) {
  const diagnostics = [];
  const byNormalizedName = new Map();
  Array.from(analysis.runtimeVariables || []).sort().forEach((rawName) => {
    const normalized = normalizeVariableName(rawName);
    const previous = byNormalizedName.get(normalized);
    if (previous && previous !== rawName) {
      diagnostics.push(diagnostic(
        'error',
        'variable-name-collision',
        `SCR variable ${previous} と ${rawName} はPCE名 ${normalized} に正規化すると衝突します。`,
      ));
    } else {
      byNormalizedName.set(normalized, rawName);
    }
  });
  return diagnostics;
}

function compareOperator(value = '') {
  if (value === '!=' || value === '<>') return 'ne';
  if (value === '<') return 'lt';
  if (value === '<=') return 'lte';
  if (value === '>') return 'gt';
  if (value === '>=') return 'gte';
  return 'eq';
}

function branchCommands(prefix, edges, blockByNode, blocks) {
  const commands = [];
  edges.forEach((edge, index) => {
    const targetBlock = blocks[blockByNode.get(edge.key)];
    const label = normalizeLabel(`${prefix}_${index + 1}`);
    commands.push({ type: 'label', name: label });
    if (targetBlock) commands.push({ type: 'jump', sceneId: targetBlock.id });
  });
  return commands;
}

function assignmentCommand(assignment, runtimeVariables, constants) {
  if (!assignment) return null;
  const name = String(assignment.name || '').toUpperCase();
  if (!runtimeVariables.has(name)) return null;
  const spec = runtimeAssignmentSpec(assignment, runtimeVariables, constants);
  if (!spec) return null;
  return {
    type: 'variable',
    variableName: normalizeVariableName(name),
    operation: spec.operation,
    value: spec.value,
    min: -32768,
    max: 32767,
  };
}

function compileScreenEffect(instruction, constants) {
  const state = String(instruction.args[0] || '').trim().toUpperCase();
  if (state === 'OFF') return { type: 'effect', effect: 'blank', frames: 0, intensity: 0, color: '#000000' };
  if (state === 'ON') return { type: 'effect', effect: 'fadeIn', frames: 0, intensity: 0, color: '' };
  const frames = Math.max(0, Math.min(255, Math.round(numericValue(instruction.args[0], constants) ?? 16)));
  const toAlpha = numericValue(instruction.args[6], constants);
  const toRgb = instruction.args.slice(7, 10).map((entry) => numericValue(entry, constants));
  if (toRgb.length === 3 && toRgb.every((entry) => entry !== null && entry >= 0.75)) {
    return { type: 'effect', effect: 'flash', frames, intensity: 0, color: '#ffffff' };
  }
  return {
    type: 'effect',
    effect: toAlpha !== null && toAlpha <= 0 ? 'fadeIn' : 'fadeOut',
    frames,
    intensity: 0,
    color: '#000000',
  };
}

function compileSpriteVisibilityCommand(
  assetMapping,
  fade,
  instruction,
  constants,
  diagnostics,
  backgroundLayout,
  assetById,
) {
  const sourceX = fade.placement?.x ?? 0;
  return {
    type: 'sprite',
    slot: assetMapping.slot,
    assetId: assetMapping.assetId,
    x: importedSpriteX(
      sourceX,
      constants,
      instruction,
      diagnostics,
      backgroundLayout,
      importedSpriteLayout(assetMapping, assetById),
    ),
    y: PCE_IMPORTED_SPRITE_Y,
    animationId: assetMapping.animationId,
    flipX: false,
    flipY: false,
    visible: fade.toOpacity > 0,
  };
}

function mappedSpriteSlots(normalizedMapping) {
  const slots = new Set();
  Object.values(normalizedMapping?.assets || {}).forEach((assetMapping) => {
    if (assetMapping?.action !== 'map' || assetMapping.display !== 'sprite') return;
    const slot = Number(assetMapping.slot);
    if (Number.isInteger(slot) && slot >= 0 && slot <= 3) slots.add(slot);
  });
  return slots;
}

function sourceSlotsForUnload(instruction, constants) {
  const start = resolveSlot(instruction.args[0], constants);
  if (!start) return new Set();
  const countValue = instruction.args[1] && cleanToken(instruction.args[1])
    ? numericValue(instruction.args[1], constants)
    : 1;
  const count = countValue === null ? 1 : Math.max(1, Math.round(countValue));
  const startNumber = numericValue(start, constants);
  if (startNumber === null) return new Set([start]);
  return new Set(Array.from({ length: count }, (_, index) => String(Math.round(startNumber + index))));
}

const EMPTY_SPRITE_OWNER = '';

function emptySpriteOwnershipState() {
  return Array.from({ length: 4 }, () => new Set([EMPTY_SPRITE_OWNER]));
}

function cloneSpriteOwnershipState(state) {
  return state.map((owners) => new Set(owners));
}

function mergeSpriteOwnershipState(left, right) {
  let changed = false;
  const merged = left.map((owners, slot) => {
    const result = new Set(owners);
    right[slot].forEach((owner) => {
      if (!result.has(owner)) {
        result.add(owner);
        changed = true;
      }
    });
    return result;
  });
  return { changed, state: merged };
}

function spriteOwnerToken(sourceSlot, requirementKey) {
  return String(sourceSlot || '') + '\u0000' + String(requirementKey || '');
}

function spriteOwnerSourceSlot(owner) {
  const separator = String(owner || '').indexOf('\u0000');
  return separator >= 0 ? owner.slice(0, separator) : String(owner || '');
}

function mappedSpriteSlot(normalizedMapping, requirementKey) {
  const assetMapping = normalizedMapping?.assets?.[requirementKey];
  if (assetMapping?.action !== 'map' || assetMapping.display !== 'sprite') return null;
  const slot = Number(assetMapping.slot);
  return Number.isInteger(slot) && slot >= 0 && slot <= 3 ? slot : null;
}

function removeSourceSpriteOwners(state, sourceSlots) {
  if (!sourceSlots.size) return;
  state.forEach((owners, slot) => {
    let removed = false;
    const next = new Set();
    owners.forEach((owner) => {
      if (owner && sourceSlots.has(spriteOwnerSourceSlot(owner))) {
        removed = true;
      } else {
        next.add(owner);
      }
    });
    if (removed || !next.size) next.add(EMPTY_SPRITE_OWNER);
    state[slot] = next;
  });
}

function showSourceSpriteOwner(state, pceSlot, sourceSlot, requirementKey) {
  if (pceSlot === null || !sourceSlot) return;
  removeSourceSpriteOwners(state, new Set([sourceSlot]));
  state[pceSlot] = new Set([spriteOwnerToken(sourceSlot, requirementKey)]);
}

function factForReachabilityNode(analysis, node) {
  return analysis.facts.get(node.key)
    || analysis.facts.get(String(node.fileIndex) + ':' + String(node.pc))
    || {};
}

function analyzeSpriteSlotOwnership(analysis, normalizedMapping) {
  if (!mappedSpriteSlots(normalizedMapping).size) return new Map();
  const inputStates = new Map();
  const beforeByNode = new Map();
  const queue = [];
  let queueCursor = 0;
  const queued = new Set();
  const enqueue = (key, incoming) => {
    if (!key || !analysis.reachability.nodes.has(key)) return;
    const existing = inputStates.get(key);
    if (!existing) {
      inputStates.set(key, cloneSpriteOwnershipState(incoming));
      if (!queued.has(key)) {
        queue.push(key);
        queued.add(key);
      }
      return;
    }
    const merged = mergeSpriteOwnershipState(existing, incoming);
    if (!merged.changed) return;
    inputStates.set(key, merged.state);
    if (!queued.has(key)) {
      queue.push(key);
      queued.add(key);
    }
  };
  const rootKeys = Array.from(new Set(
    (analysis.reachability.rootKeys?.length
      ? analysis.reachability.rootKeys
      : [analysis.reachability.entryKey]).filter(Boolean),
  ));
  rootKeys.forEach((key) => enqueue(key, emptySpriteOwnershipState()));

  while (queueCursor < queue.length) {
    const key = queue[queueCursor];
    queueCursor += 1;
    queued.delete(key);
    const node = analysis.reachability.nodes.get(key);
    const input = inputStates.get(key);
    if (!node || !input) continue;
    beforeByNode.set(key, cloneSpriteOwnershipState(input));
    const state = cloneSpriteOwnershipState(input);
    const instruction = node.instruction;
    const fact = factForReachabilityNode(analysis, node);
    const constants = fact.constants instanceof Map ? fact.constants : analysis.constants;

    if (instruction.op === 'CLEARCG') {
      for (let slot = 0; slot < state.length; slot += 1) {
        state[slot] = new Set([EMPTY_SPRITE_OWNER]);
      }
    } else if (instruction.op === 'ICG') {
      const sourceSlot = String(fact.cgSlot || resolveSlot(instruction.args[0], constants));
      const initialOpacity = numericValue(instruction.args[4], constants);
      if (initialOpacity !== null && initialOpacity <= 0) {
        removeSourceSpriteOwners(state, new Set([sourceSlot]));
      } else {
        showSourceSpriteOwner(
          state,
          mappedSpriteSlot(normalizedMapping, fact.requirementKey),
          sourceSlot,
          fact.requirementKey,
        );
      }
    } else if (instruction.op === 'FADE' && fact.fade?.isAlpha
      && Number.isFinite(fact.fade.toOpacity)) {
      const sourceSlot = String(fact.fade.slot || '');
      if (fact.fade.toOpacity > 0) {
        showSourceSpriteOwner(
          state,
          mappedSpriteSlot(normalizedMapping, fact.fade.requirementKey),
          sourceSlot,
          fact.fade.requirementKey,
        );
      } else {
        removeSourceSpriteOwners(state, new Set([sourceSlot]));
      }
    } else if ((instruction.op === 'DCG'
      && String(instruction.args[1] || '').trim().toUpperCase() === 'OFF')
      || instruction.op === 'UNLOADCG'
      || instruction.op === 'UNLOAD'
      || instruction.op === 'UNL') {
      const sourceSlots = Array.isArray(fact.cgRemovalSlots)
        ? new Set(fact.cgRemovalSlots.map(String))
        : (instruction.op === 'DCG'
          ? new Set([resolveSlot(instruction.args[0], constants)])
          : sourceSlotsForUnload(instruction, constants));
      removeSourceSpriteOwners(state, sourceSlots);
    }

    node.edges.forEach((edge) => enqueue(edge.key, state));
  }
  return beforeByNode;
}

function spriteSlotsOwnedOnlyBy(spriteOwnership, sourceSlots) {
  if (!Array.isArray(spriteOwnership) || !sourceSlots.size) return [];
  const result = [];
  spriteOwnership.forEach((owners, slot) => {
    const visibleOwners = [...owners].filter(Boolean);
    if (!visibleOwners.length) return;
    const hasTarget = visibleOwners.some((owner) => sourceSlots.has(spriteOwnerSourceSlot(owner)));
    const hasOther = visibleOwners.some((owner) => !sourceSlots.has(spriteOwnerSourceSlot(owner)));
    if (hasTarget && !hasOther) result.push(slot);
  });
  return result;
}

function spriteHideCommand(slot) {
  return {
    type: 'sprite',
    slot,
    assetId: '',
    x: 0,
    y: PCE_IMPORTED_SPRITE_Y,
    animationId: '',
    flipX: false,
    flipY: false,
    visible: false,
  };
}

function sourceSpriteRelocationHideCommands(spriteOwnership, sourceSlot, destinationSlot) {
  return spriteSlotsOwnedOnlyBy(
    spriteOwnership,
    new Set([String(sourceSlot || '')]),
  ).filter((slot) => slot !== Number(destinationSlot)).map(spriteHideCommand);
}

function compileExplicitSpriteHideCommands({
  instruction,
  fact,
  constants,
  normalizedMapping,
  spriteOwnership,
  clearAll = false,
} = {}) {
  if (clearAll) {
    return [...mappedSpriteSlots(normalizedMapping)]
      .sort((left, right) => left - right)
      .map(spriteHideCommand);
  }
  const targetSourceSlots = Array.isArray(fact?.cgRemovalSlots)
    ? new Set(fact.cgRemovalSlots.map(String))
    : (instruction.op === 'DCG'
      ? new Set([resolveSlot(instruction.args[0], constants)])
      : sourceSlotsForUnload(instruction, constants));
  return spriteSlotsOwnedOnlyBy(spriteOwnership, targetSourceSlots).map(spriteHideCommand);
}

function convertScripts(analysis, {
  mapping = {},
  assetCatalog = [],
  namespace = 'khpm',
} = {}) {
  const diagnostics = [...analysis.diagnostics];
  diagnostics.push(...validateRuntimeVariableNames(analysis));
  const mappingValidation = validateMappings(analysis, mapping, assetCatalog);
  diagnostics.push(...mappingValidation.diagnostics);
  if (diagnostics.some((entry) => entry.severity === 'error')) {
    return { ok: false, diagnostics: dedupeDiagnostics(diagnostics), scenes: [], sourceMap: [] };
  }

  const normalizedMapping = mappingValidation.normalized;
  const assetById = new Map((assetCatalog || []).map((asset) => [String(asset?.id || ''), asset]));
  const spriteOwnershipByNode = analyzeSpriteSlotOwnership(analysis, normalizedMapping);
  let activeBackgroundLayout = defaultImportedBackgroundLayout();
  const grouped = buildBasicBlocks(analysis, safeIdentifier(namespace, 'khpm', 24));
  const { blocks, blockByNode, entryBlockIndex } = grouped;

  const voiceInstructions = new Set();
  analysis.facts.forEach((fact) => {
    const voiceInstruction = fact.message?.voiceInstruction;
    if (voiceInstruction) voiceInstructions.add(`${voiceInstruction.script}:${voiceInstruction.line}`);
  });

  const fragments = [];
  blocks.forEach((block) => {
    const commands = [];
    const commandSources = [];
    const localPrefix = `b${block.index + 1}`;

    block.nodes.forEach((node, nodeOffset) => {
      const instruction = node.instruction;
      const commandStart = commands.length;
      const fact = analysis.facts.get(node.key)
        || analysis.facts.get(`${node.fileIndex}:${node.pc}`)
        || {};
      const nodeConstants = fact.constants instanceof Map ? fact.constants : analysis.constants;
      const spriteOwnership = spriteOwnershipByNode.get(node.key)
        || emptySpriteOwnershipState();
      const edgeBlocks = node.edges
        .map((edge) => ({ edge, block: blocks[blockByNode.get(edge.key)] }))
        .filter((entry) => entry.block);

      if (instruction.op === 'DEFINE') {
        const name = String(instruction.args[0] || '').toUpperCase();
        if (analysis.runtimeVariables.has(name)) {
          commands.push({
            type: 'variable',
            variableName: normalizeVariableName(name),
            operation: 'define',
            value: 0,
            min: -32768,
            max: 32767,
          });
        }
      } else if (instruction.op === 'ASSIGN') {
        const command = assignmentCommand(
          instruction.assignment || parseAssignment(instruction.raw),
          analysis.runtimeVariables,
          nodeConstants,
        );
        if (command) commands.push(command);
      } else if (instruction.op === 'WAIT' && String(instruction.args[0] || '').toUpperCase() === 'WIN_MSG') {
        if (fact.message?.text) {
          const messageText = replaceUnsupportedSystemCardCharacters(
            fact.message.text,
            instruction,
            'message',
            diagnostics,
          );
          const textColor = scriptTextColor(fact.message.colorToken, nodeConstants);
          if (fact.message.colorToken && !textColor) {
            diagnostics.push(diagnostic(
              'warning',
              'unresolved-message-color',
              `COLOR ${fact.message.colorToken} を16-bit ARGB値として解決できないため既定色を使用します。`,
              instruction,
            ));
          }
          const pages = paginateMessage(messageText);
          const voiceMapping = fact.message.voiceRequirementKey
            ? normalizedMapping.assets[fact.message.voiceRequirementKey]
            : null;
          pages.forEach((text, pageIndex) => {
            commands.push({
              type: 'message',
              speaker: '',
              text,
              textColor,
              voiceAssetId: pageIndex === 0 && voiceMapping?.action === 'map'
                ? voiceMapping.assetId
                : '',
              mouthSlot: null,
            });
          });
        }
      } else if (instruction.op === 'ICG') {
        const assetMapping = normalizedMapping.assets[fact.requirementKey];
        if (assetMapping?.action === 'map') {
          if (assetMapping.display === 'sprite') {
            const initialOpacity = numericValue(instruction.args[4], nodeConstants);
            if (initialOpacity !== null && initialOpacity <= 0) {
              const sourceSlot = String(fact.cgSlot || resolveSlot(instruction.args[0], nodeConstants));
              commands.push(...spriteSlotsOwnedOnlyBy(
                spriteOwnership,
                new Set([sourceSlot]),
              ).map(spriteHideCommand));
            } else {
              const sourceSlot = String(fact.cgSlot || resolveSlot(instruction.args[0], nodeConstants));
              commands.push(...sourceSpriteRelocationHideCommands(
                spriteOwnership,
                sourceSlot,
                assetMapping.slot,
              ));
              commands.push({
                type: 'sprite',
                slot: assetMapping.slot,
                assetId: assetMapping.assetId,
                x: importedSpriteX(
                  instruction.args[1],
                  nodeConstants,
                  instruction,
                  diagnostics,
                  activeBackgroundLayout,
                  importedSpriteLayout(assetMapping, assetById),
                ),
                y: PCE_IMPORTED_SPRITE_Y,
                animationId: assetMapping.animationId,
                flipX: false,
                flipY: false,
                visible: true,
              });
            }
          } else {
            activeBackgroundLayout = importedBackgroundLayout(assetMapping, assetById);
            commands.push({
              type: 'background',
              assetId: assetMapping.assetId,
              transition: 'fade',
              fadeOutFrames: PCE_IMPORTED_BG_FADE_FRAMES,
              fadeInFrames: PCE_IMPORTED_BG_FADE_FRAMES,
              x: assetMapping.x,
              y: assetMapping.y,
            });
          }
        }
      } else if (instruction.op === 'FADE') {
        const fade = fact.fade;
        const assetMapping = fade?.requirementKey
          ? normalizedMapping.assets[fade.requirementKey]
          : null;
        const canToggleSprite = Boolean(
          fade?.isAlpha
          && fade.placement
          && Number.isFinite(fade.toOpacity)
          && fade.toOpacity >= 0
          && fade.toOpacity <= 1
          && assetMapping?.action === 'map'
          && assetMapping.display === 'sprite'
        );
        if (canToggleSprite) {
          let generatedSpriteVisibility = false;
          if (fade.toOpacity > 0) {
            commands.push(...sourceSpriteRelocationHideCommands(
              spriteOwnership,
              fade.slot,
              assetMapping.slot,
            ));
            commands.push(compileSpriteVisibilityCommand(
              assetMapping,
              fade,
              instruction,
              nodeConstants,
              diagnostics,
              activeBackgroundLayout,
              assetById,
            ));
            generatedSpriteVisibility = true;
          } else {
            const hideCommands = spriteSlotsOwnedOnlyBy(
              spriteOwnership,
              new Set([String(fade.slot || '')]),
            ).map(spriteHideCommand);
            commands.push(...hideCommands);
            generatedSpriteVisibility = hideCommands.length > 0;
          }
          if (generatedSpriteVisibility) {
            diagnostics.push(diagnostic(
              'warning',
              'sprite-fade-approximation',
              `CG slot ${fade.slot} のalpha FADE(${fade.fromOpacity ?? '(unknown)'}→${fade.toOpacity})をSprite Visible ${fade.toOpacity > 0 ? 'ON' : 'OFF'}へ近似します。`,
              instruction,
            ));
          }
        } else if (fade?.isAlpha && fade.requirementKey
          && assetMapping?.action === 'map'
          && assetMapping.display === 'background') {
          diagnostics.push(diagnostic(
            'warning',
            'fade-omitted',
            'BGを対象とするalpha FADEは省略し、BG commandのpalette fadeに任せます。',
            instruction,
          ));
        }
      } else if (instruction.op === 'CLEARCG') {
        commands.push(...compileExplicitSpriteHideCommands({
          instruction,
          fact,
          constants: nodeConstants,
          normalizedMapping,
          spriteOwnership,
          clearAll: true,
        }));
      } else if (instruction.op === 'DCG'
        && String(instruction.args[1] || '').trim().toUpperCase() === 'OFF') {
        commands.push(...compileExplicitSpriteHideCommands({
          instruction,
          fact,
          constants: nodeConstants,
          normalizedMapping,
          spriteOwnership,
        }));
      } else if (instruction.op === 'UNLOADCG' || instruction.op === 'UNLOAD' || instruction.op === 'UNL') {
        commands.push(...compileExplicitSpriteHideCommands({
          instruction,
          fact,
          constants: nodeConstants,
          normalizedMapping,
          spriteOwnership,
        }));
      } else if (instruction.op === 'PLAYP') {
        const voiceLocation = `${instruction.script}:${instruction.line}`;
        const assetMapping = normalizedMapping.assets[fact.requirementKey];
        if (!voiceInstructions.has(voiceLocation) && assetMapping?.action === 'map') {
          commands.push({
            type: 'audio',
            kind: 'adpcm',
            action: 'play',
            assetId: assetMapping.assetId,
            channel: Math.max(0, Math.min(5, Math.round(numericValue(instruction.args[3], nodeConstants) ?? 0))),
          });
        }
      } else if (instruction.op === 'STOPP') {
        commands.push({
          type: 'audio',
          kind: 'adpcm',
            action: 'stop',
            assetId: '',
            channel: Math.max(0, Math.min(5, Math.round(numericValue(instruction.args[0], nodeConstants) ?? 0))),
        });
      } else if (instruction.op === 'PLAYM') {
        const assetMapping = normalizedMapping.assets[fact.requirementKey];
        if (assetMapping?.action === 'map') {
          commands.push({ type: 'audio', kind: 'psg', action: 'play', assetId: assetMapping.assetId, channel: 0 });
        }
      } else if (instruction.op === 'STOPM') {
        commands.push({ type: 'audio', kind: 'psg', action: 'stop', assetId: '', channel: 0, target: 'bgm' });
      } else if (instruction.op === 'PLAYGD') {
        const assetMapping = normalizedMapping.assets[fact.requirementKey];
        if (assetMapping?.action === 'map') {
          commands.push({ type: 'audio', kind: 'cdda', action: 'play', assetId: assetMapping.assetId, channel: 0 });
        }
      } else if (instruction.op === 'STOPGD') {
        commands.push({ type: 'audio', kind: 'cdda', action: 'stop', assetId: '', channel: 0 });
      } else if (instruction.op === 'STOPG') {
        commands.push(
          { type: 'audio', kind: 'adpcm', action: 'stop', assetId: '', channel: 0 },
          { type: 'audio', kind: 'psg', action: 'stop', assetId: '', channel: 0, target: 'all' },
          { type: 'audio', kind: 'cdda', action: 'stop', assetId: '', channel: 0 },
        );
      } else if (instruction.op === 'SCREEN') {
        commands.push(compileScreenEffect(instruction, nodeConstants));
      } else if (instruction.op === 'WAIT' && instruction.args.length >= 3
        && String(instruction.args[1] || '') !== '4') {
        const frames = numericValue(instruction.args[2], nodeConstants);
        if (frames !== null && frames > 0) {
          commands.push({ type: 'wait', frames: Math.max(0, Math.min(65535, Math.round(frames))) });
        }
      } else if (instruction.op === 'IF' && instruction.condition) {
        const condition = normalizeRuntimeCondition(
          instruction.condition,
          analysis.runtimeVariables,
        );
        const value = numericValue(condition.right, nodeConstants);
        const variableName = normalizeVariableName(condition.left);
        if (value === null || !isVariableIdentifier(condition.left)) {
          diagnostics.push(diagnostic(
            'error',
            'unsupported-if-value',
            'IFは左辺variableと右辺の数値・16進・静的定数だけ変換できます。',
            instruction,
          ));
        } else if (!isSignedInt16(Math.round(value))) {
          diagnostics.push(diagnostic(
            'error',
            'variable-value-range',
            `IF比較値 ${value} はsigned int16範囲外です。`,
            instruction,
          ));
        } else if (/^GOT(?:O)?\s+/i.test(condition.then)) {
          const trueLabel = normalizeLabel(`${localPrefix}_if_${nodeOffset + 1}_true`);
          const falseLabel = normalizeLabel(`${localPrefix}_if_${nodeOffset + 1}_false`);
          const endLabel = normalizeLabel(`${localPrefix}_if_${nodeOffset + 1}_end`);
          const trueBlock = edgeBlocks.find((entry) => entry.edge.kind === 'if-true')?.block;
          const falseBlock = edgeBlocks.find((entry) => entry.edge.kind === 'if-false')?.block;
          commands.push({
            type: 'if',
            variableName,
            operator: compareOperator(condition.operator),
            value: Math.round(value),
            targetLabel: trueBlock ? trueLabel : endLabel,
            elseLabel: falseBlock ? falseLabel : endLabel,
          });
          if (trueBlock) commands.push(
            { type: 'label', name: trueLabel },
            { type: 'jump', sceneId: trueBlock.id },
          );
          if (falseBlock) commands.push(
            { type: 'label', name: falseLabel },
            { type: 'jump', sceneId: falseBlock.id },
          );
          commands.push({ type: 'label', name: endLabel });
        } else {
          const assignment = parseAssignment(condition.then);
          const variableCommand = assignmentCommand(assignment, analysis.runtimeVariables, nodeConstants);
          if (!variableCommand) {
            diagnostics.push(diagnostic(
              'error',
              'unsupported-if-action',
              'IF THENは静的な代入またはGOTOだけ変換できます。',
              instruction,
            ));
          } else if (!isSignedInt16(variableCommand.value)) {
            diagnostics.push(diagnostic(
              'error',
              'variable-value-range',
              `IF THEN代入operand ${variableCommand.value} はsigned int16範囲外です。`,
              instruction,
            ));
          } else {
            const trueLabel = normalizeLabel(`${localPrefix}_if_${nodeOffset + 1}_true`);
            const endLabel = normalizeLabel(`${localPrefix}_if_${nodeOffset + 1}_end`);
            commands.push({
              type: 'if',
              variableName,
              operator: compareOperator(condition.operator),
              value: Math.round(value),
              targetLabel: trueLabel,
              elseLabel: endLabel,
            });
            commands.push({ type: 'label', name: trueLabel }, variableCommand, { type: 'label', name: endLabel });
          }
        }
      } else if (instruction.op === 'ONRMG' || instruction.op === 'ONMG') {
        const labels = instruction.args.slice(4);
        const menuChoices = fact.menu?.choices || [];
        if (!menuChoices.length || labels.length !== menuChoices.length || labels.length > 4
          || labels.some((label) => !label || label.toUpperCase() === 'NULL')) {
          diagnostics.push(diagnostic(
            'error',
            'invalid-menu-shape',
            'MENU/ONRMGは1〜4件で、選択肢数と分岐先数が一致し、NULL分岐を含まない必要があります。',
            instruction,
          ));
        } else {
          const blockByChoice = new Map(edgeBlocks.map((entry) => [entry.edge.value, entry.block]));
          commands.push({
            type: 'choice',
            variableName: normalizeVariableName(`kitahe_choice_${instruction.line}`),
            choices: menuChoices.map((label, index) => {
              const visibleLabel = Array.from(label).slice(0, 24).join('');
              return {
                label: replaceUnsupportedSystemCardCharacters(
                  visibleLabel,
                  fact.menu?.instruction || instruction,
                  `choice[${index}]`,
                  diagnostics,
                ),
                value: index,
                targetSceneId: blockByChoice.get(index)?.id || '',
              };
            }),
            defaultIndex: 0,
          });
        }
      } else if (instruction.op === 'ONG') {
        const source = String(instruction.args[0] || '').toUpperCase();
        if (!BUTTON_NAMES.has(source) && instruction.args.length > 1) {
          const branches = instruction.args.slice(1)
            .map((label, index) => ({ label, index }))
            .filter((entry) => entry.label && entry.label.toUpperCase() !== 'NULL');
          if (!fact.waitBtn || fact.waitBtn.variable !== source) {
            diagnostics.push(diagnostic(
              'error',
              'unsupported-input-cycle',
              '対応するWAITBTNを確認できないONG variable分岐は変換できません。',
              instruction,
            ));
          } else if (branches.length < 1 || branches.length > 4) {
            diagnostics.push(diagnostic(
              'error',
              'unsupported-input-cycle',
              'WAITBTN/ONGは1〜4件の有効分岐が必要です。',
              instruction,
            ));
          } else {
            const inputLabels = ['決定', '戻る', '上', '下', '左', '右', 'L', 'R'];
            const blockByInput = new Map(edgeBlocks.map((entry) => [entry.edge.value, entry.block]));
            commands.push({
              type: 'choice',
              variableName: normalizeVariableName(source),
              choices: branches.map((entry) => ({
                label: inputLabels[entry.index] || `入力${entry.index + 1}`,
                value: entry.index + 1,
                targetSceneId: blockByInput.get(entry.index)?.id || '',
              })),
              defaultIndex: 0,
            });
            diagnostics.push(diagnostic(
              'warning',
              'waitbtn-choice-approximation',
              'WAITBTN/ONG入力表をPCE Choiceへ近似しました。',
              instruction,
            ));
          }
        }
      } else if (instruction.op === 'ONC') {
        const branches = instruction.args.slice(1)
          .map((label, value) => ({ label, value }))
          .filter((entry) => entry.label && entry.label.toUpperCase() !== 'NULL');
        if (instruction.args.length - 1 > 16) {
          diagnostics.push(diagnostic('error', 'switch-case-limit', 'ONCの分岐が16件を超えます。', instruction));
        } else {
          const blockByValue = new Map(edgeBlocks.map((entry) => [entry.edge.value, entry.block]));
          const labels = branches.map((branch) => ({
            ...branch,
            name: normalizeLabel(`${localPrefix}_onc_${nodeOffset + 1}_${branch.value + 1}`),
          }));
          const defaultLabel = normalizeLabel(`${localPrefix}_onc_${nodeOffset + 1}_default`);
          commands.push({
            type: 'switch',
            variableName: normalizeVariableName(instruction.args[0]),
            cases: labels.map((entry) => ({ value: entry.value, targetLabel: entry.name })),
            defaultLabel,
          });
          labels.forEach((entry) => {
            commands.push({ type: 'label', name: entry.name });
            const targetBlock = blockByValue.get(entry.value);
            if (targetBlock) commands.push({ type: 'jump', sceneId: targetBlock.id });
          });
          commands.push({ type: 'label', name: defaultLabel });
        }
      } else if (instruction.op === 'GOTO'
        || instruction.op === 'GOT'
        || isBranchingTimerInstruction(instruction)) {
        if (edgeBlocks[0]) commands.push({ type: 'jump', sceneId: edgeBlocks[0].block.id });
      }
      for (let commandIndex = commandStart; commandIndex < commands.length; commandIndex += 1) {
        commandSources.push({
          commandIndex,
          script: instruction.script,
          line: instruction.line,
        });
      }
    });

    const lastNode = block.nodes[block.nodes.length - 1];
    let nextBlockId = '';
    if (lastNode && !isControlInstruction(lastNode.instruction) && lastNode.edges.length === 1) {
      const nextBlockIndex = blockByNode.get(lastNode.edges[0].key);
      if (nextBlockIndex != null && nextBlockIndex !== block.index) nextBlockId = blocks[nextBlockIndex].id;
    }

    fragments.push({
      block,
      commands,
      commandSources,
      nextBlockId,
      needsTerminalFlow: !nextBlockId && commands[commands.length - 1]?.type !== 'jump',
    });
  });

  const rootBlockIds = [
    ...new Set(
      (analysis.reachability.rootKeys?.length
        ? analysis.reachability.rootKeys
        : [analysis.reachability.entryKey])
        .map((key) => blocks[blockByNode.get(key)]?.id)
        .filter(Boolean),
    ),
  ];
  const packed = packBlockFragments(fragments, rootBlockIds);
  const sceneEntries = packed.groups.map((group) => buildPackedSceneEntry(group, packed));
  sceneEntries.sort(compareImportedSceneEntries);
  const scenes = sceneEntries.map((entry) => entry.scene);
  if (scenes.length > MAX_SCENES) diagnostics.push(sceneCountLimitDiagnostic(scenes.length));
  sceneEntries.forEach(({ block, scene }) => {
    const cost = estimatePackedSceneCost(scene.commands);
    const firstInstruction = packed.groupByBlockId.get(block.id)
      ?.fragments[0]?.block.nodes[0]?.instruction;
    if (cost.commands > MAX_COMMANDS_PER_SCENE) {
      diagnostics.push(diagnostic(
        'error',
        'command-count-limit',
        `scene ${scene.id} のbuild時command見積り ${cost.commands} が上限 ${MAX_COMMANDS_PER_SCENE} を超えます。`,
        firstInstruction,
      ));
    }
    if (cost.bytes > MAX_SCENE_PACK_BYTES) {
      diagnostics.push(diagnostic(
        'error',
        'scene-pack-byte-limit',
        `scene ${scene.id} のpack見積り ${cost.bytes} bytesが上限 ${MAX_SCENE_PACK_BYTES} bytesを超えます。`,
        firstInstruction,
      ));
    }
  });

  const variableNames = new Set();
  scenes.forEach((scene) => {
    scene.commands.forEach((command) => {
      if (command.variableName) variableNames.add(command.variableName);
    });
  });
  if (variableNames.size > MAX_VARIABLES) {
    diagnostics.push(diagnostic(
      'error',
      'variable-count-limit',
      `変換variable数 ${variableNames.size} が上限 ${MAX_VARIABLES} を超えます。`,
    ));
  }

  const sourceMap = sceneEntries.flatMap(({ block }) => (block.commandSources || []).map((entry) => ({
    sceneId: block.id,
    ...entry,
  })));
  const sourceRanges = sceneEntries.map(({ block }) => ({ sceneId: block.id, ...block.source }));
  const finalDiagnostics = dedupeDiagnostics(diagnostics);
  return {
    ok: !finalDiagnostics.some((entry) => entry.severity === 'error'),
    scenes,
    entrySceneId: packed.groupByBlockId.get(blocks[entryBlockIndex]?.id)?.id || scenes[0]?.id || '',
    sourceMap,
    sourceRanges,
    diagnostics: finalDiagnostics,
    normalizedMapping,
    totals: {
      scenes: scenes.length,
      basicBlocks: blocks.length,
      commands: scenes.reduce((sum, scene) => sum + scene.commands.length, 0),
      messages: scenes.reduce(
        (sum, scene) => sum + scene.commands.filter((command) => command.type === 'message').length,
        0,
      ),
      variables: variableNames.size,
    },
  };
}

function conversionSignature({
  files = [],
  selectedScripts = [],
  entryScript = '',
  protagonistName = DEFAULT_PROTAGONIST_NAME,
  targetMedia = '',
  document = {},
  assetCatalog = [],
  mapping = null,
  sidecar = null,
  diskSceneSnapshot = null,
  conversionOptions = null,
} = {}) {
  return sha256(stableJson({
    sources: files.map((file) => ({
      path: normalizeRelativeScriptPath(file.path),
      hash: file.hash || sha256(file.buffer || ''),
    })).sort((left, right) => left.path.localeCompare(right.path)),
    selectedScripts: selectedScripts.map(normalizeRelativeScriptPath).sort((left, right) => left.localeCompare(right)),
    entryScript: normalizeRelativeScriptPath(entryScript),
    protagonistName: String(protagonistName ?? ''),
    targetMedia: String(targetMedia || ''),
    document,
    assets: [...(assetCatalog || [])].sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || ''))),
    mapping,
    sidecar,
    diskSceneSnapshot,
    conversionOptions,
  }));
}

module.exports = {
  DEFAULT_PROTAGONIST_NAME,
  MAX_CALL_STACK,
  MAX_EXPANDED_STATES,
  MAX_SCENES,
  MAX_COMMANDS_PER_SCENE,
  PACKED_SCENE_COMMAND_TARGET,
  PACKED_SCENE_BYTE_TARGET,
  MAX_VARIABLES,
  MESSAGE_COLUMNS,
  MESSAGE_ROWS,
  decodeScrBuffer,
  parseScrBuffer,
  inspectScripts,
  publicInspection,
  convertScripts,
  conversionSignature,
  normalizeRelativeScriptPath,
  safeIdentifier,
  stableJson,
  sha256,
  assetSourceIdentity,
  assetSourceKey,
  resolvePlaypPlaybackRate,
  assetMatchKey,
  assetMatchName,
  paginateMessage,
  validateMappings,
};
