'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { encodeIndexedPng, DMG_COLORS } = require('./pce-vn-gb-studio-image');
const { renderGlyphBitmaps } = require('./pce-vn-manager');

const SAFE_CODES = Object.freeze(Array.from({ length: 224 }, (_, index) => index + 32).filter((code) => code !== 0x25 && code !== 0x5c));
const DEFAULT_FONT = 'builtin:misaki-gothic-8x8';

function parseBdf(text) {
  const glyphs = new Map(); let current = null; let inBitmap = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('STARTCHAR ')) { current = { encoding: -1, width: 8, height: 8, x: 0, y: 0, rows: [] }; inBitmap = false; }
    else if (!current) continue;
    else if (line.startsWith('ENCODING ')) current.encoding = Number(line.slice(9).trim());
    else if (line.startsWith('BBX ')) { const values = line.slice(4).trim().split(/\s+/).map(Number); [current.width, current.height, current.x, current.y] = values; }
    else if (line === 'BITMAP') inBitmap = true;
    else if (line === 'ENDCHAR') {
      if (current.encoding >= 0) {
        const bitmap = new Array(64).fill(0); const rowOffset = Math.max(0, 8 - current.height - Math.max(-1, current.y));
        current.rows.slice(0, current.height).forEach((hex, row) => { const bytes = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex'); for (let x = 0; x < Math.min(8, current.width); x += 1) { const bit = (bytes[Math.floor(x / 8)] || 0) & (0x80 >> (x % 8)); const dx = x + Math.max(0, current.x); const dy = row + rowOffset; if (bit && dx >= 0 && dx < 8 && dy >= 0 && dy < 8) bitmap[dy * 8 + dx] = 1; } });
        glyphs.set(String.fromCodePoint(current.encoding), bitmap);
      }
      current = null; inBitmap = false;
    } else if (inBitmap && /^[0-9a-f]+$/i.test(line)) current.rows.push(line);
  }
  return glyphs;
}

function builtinBdfText() {
  const encoded = require('./pce-vn-gb-studio-misaki');
  return zlib.gunzipSync(Buffer.from(encoded.gzipBase64, 'base64')).toString('utf-8');
}

function bitmap12To8(bitmap) {
  if (!Array.isArray(bitmap) || bitmap.length !== 144) return null;
  const result = new Array(64).fill(0);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) result[y * 8 + x] = bitmap[(y + 2) * 12 + x + 2] ? 1 : 0;
  return result;
}

function uniqueVisibleGlyphs(units) {
  const seen = new Set(); const glyphs = [];
  for (const unit of units) for (const glyph of Array.from(String(unit.text || '').normalize('NFC'))) {
    if (glyph === '\n' || glyph === '\r' || glyph === '\t' || seen.has(glyph)) continue;
    seen.add(glyph); glyphs.push(glyph);
  }
  return glyphs;
}

function loadGlyphBitmaps(glyphs, fontSpec = DEFAULT_FONT, projectDir = '') {
  const spec = String(fontSpec || DEFAULT_FONT);
  if (spec === DEFAULT_FONT || spec === 'builtin:misaki') {
    const source = parseBdf(builtinBdfText()); return { renderer: 'bdf', fontPath: DEFAULT_FONT, bitmaps: new Map(glyphs.map((glyph) => [glyph, source.get(glyph)])) };
  }
  const fontPath = path.isAbsolute(spec) ? path.resolve(spec) : path.resolve(projectDir, spec); const extension = path.extname(fontPath).toLowerCase();
  if (!fs.existsSync(fontPath) || !fs.statSync(fontPath).isFile()) throw new Error(`フォントが見つかりません: ${fontPath}`);
  if (extension === '.bdf') { const source = parseBdf(fs.readFileSync(fontPath, 'utf-8')); return { renderer: 'bdf', fontPath, bitmaps: new Map(glyphs.map((glyph) => [glyph, source.get(glyph)])) }; }
  if (!['.ttf', '.otf', '.ttc'].includes(extension)) throw new Error(`未対応フォント形式です: ${extension || '(拡張子なし)'}`);
  const rendered = renderGlyphBitmaps(glyphs, { fontPath, fontSize: 12, threshold: 80, xOffset: 0, yOffset: 0 }, projectDir);
  if (!rendered || rendered.bitmaps.length !== glyphs.length) throw new Error(`TTF/OTFフォントを描画できません: ${fontPath}`);
  return { renderer: rendered.renderer, fontPath: rendered.fontPath || fontPath, bitmaps: new Map(glyphs.map((glyph, index) => [glyph, bitmap12To8(rendered.bitmaps[index])])) };
}

function unitGlyphs(unit) { return new Set(Array.from(String(unit.text || '').normalize('NFC')).filter((glyph) => !['\n', '\r', '\t'].includes(glyph))); }

function packAtomicUnits(units) {
  const pages = []; const assignments = new Map();
  units.forEach((unit) => {
    const glyphSet = unitGlyphs(unit);
    if (glyphSet.size > SAFE_CODES.length) { const error = new Error(`1表示単位の文字種が${SAFE_CODES.length}字を超えています: ${unit.id}`); error.code = 'GBVN_FONT_ATOMIC_UNIT_OVERFLOW'; throw error; }
    let chosen = -1; let bestAdded = Infinity;
    pages.forEach((page, index) => { const added = [...glyphSet].filter((glyph) => !page.glyphSet.has(glyph)).length; if (page.glyphSet.size + added <= SAFE_CODES.length && added < bestAdded) { chosen = index; bestAdded = added; } });
    if (chosen < 0) { chosen = pages.length; pages.push({ glyphSet: new Set(), units: [] }); }
    glyphSet.forEach((glyph) => pages[chosen].glyphSet.add(glyph)); pages[chosen].units.push(unit.id); assignments.set(unit.id, chosen);
  });
  return { pages, assignments };
}

function buildAtlas(glyphs, bitmaps) {
  const indices = new Uint8Array(128 * 112); indices.fill(3); const mapping = {};
  glyphs.forEach((glyph, index) => {
    const code = SAFE_CODES[index]; const tile = code - 32; const ox = (tile % 16) * 8; const oy = Math.floor(tile / 16) * 8; const bitmap = bitmaps.get(glyph);
    if (!bitmap) return;
    mapping[glyph] = code;
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) if (bitmap[y * 8 + x]) indices[(oy + y) * 128 + ox + x] = 0;
  });
  return { mapping, png: encodeIndexedPng({ width: 128, height: 112, indices, palette: [DMG_COLORS[3], DMG_COLORS[2], DMG_COLORS[1], DMG_COLORS[0]] }) };
}

function createFontPages(units, options = {}) {
  const normalizedUnits = units.map((unit, index) => ({ id: String(unit.id || `unit-${index}`), text: String(unit.text || '').normalize('NFC') }));
  const glyphs = uniqueVisibleGlyphs(normalizedUnits); const rendered = loadGlyphBitmaps(glyphs, options.font || DEFAULT_FONT, options.projectDir || '');
  const missing = glyphs.filter((glyph) => !rendered.bitmaps.get(glyph));
  if (missing.length) { const error = new Error(`フォントに字形がありません: ${missing.slice(0, 24).join(' ')}${missing.length > 24 ? ` ほか${missing.length - 24}字` : ''}`); error.code = 'GBVN_FONT_GLYPH_MISSING'; error.glyphs = missing; throw error; }
  const packed = packAtomicUnits(normalizedUnits);
  const pages = packed.pages.map((page, index) => { const pageGlyphs = glyphs.filter((glyph) => page.glyphSet.has(glyph)); const atlas = buildAtlas(pageGlyphs, rendered.bitmaps); return { index, id: `font-page-${String(index + 1).padStart(2, '0')}`, glyphs: pageGlyphs, units: page.units, mapping: atlas.mapping, png: atlas.png }; });
  return { font: options.font || DEFAULT_FONT, renderer: rendered.renderer, fontPath: rendered.fontPath, glyphCount: glyphs.length, pages, assignments: Object.fromEntries(packed.assignments) };
}

function wrapText(text, columns = 18) {
  const result = [];
  for (const sourceLine of String(text || '').normalize('NFC').split(/\r?\n/)) {
    const chars = Array.from(sourceLine); if (!chars.length) { result.push(''); continue; }
    while (chars.length) { let line = chars.splice(0, columns); while (chars.length && /^[、。！？!?）」』】]/u.test(chars[0]) && line.length > 1) chars.unshift(line.pop()); result.push(line.join('')); }
  }
  return result;
}

function paginateDialogue(message, options = {}) {
  const columns = Number(options.columns) || 18; const rows = Number(options.rows) || 4; const speaker = String(message.speaker || '').trim(); const bodyRows = wrapText(message.text || '', columns); const bodyCapacity = Math.max(1, rows - (speaker ? 1 : 0)); const pages = [];
  for (let offset = 0; offset < Math.max(1, bodyRows.length); offset += bodyCapacity) { const body = bodyRows.slice(offset, offset + bodyCapacity); pages.push({ text: speaker ? `【${speaker}】\n${body.join('\n')}` : body.join('\n'), textY: speaker ? 0 : 1, speaker }); }
  return pages;
}

module.exports = { DEFAULT_FONT, SAFE_CODES, createFontPages, loadGlyphBitmaps, packAtomicUnits, paginateDialogue, parseBdf, wrapText };
