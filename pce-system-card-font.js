'use strict';

const iconv = require('iconv-lite');

const SYSTEM_CARD_NEWLINE = 0xfffe;
const SYSTEM_CARD_TEXT_END = 0xffff;

function fullwidthAsciiCharacter(char) {
  const cp = char.codePointAt(0);
  if (cp === 0x20) return '\u3000';
  if (cp >= 0x21 && cp <= 0x7e) return String.fromCodePoint(cp + 0xfee0);
  return char;
}

function normalizeSystemCardText(text) {
  return Array.from(String(text ?? ''), fullwidthAsciiCharacter).join('');
}

function sjisJisRow(lead, trail) {
  let row = lead < 0xa0 ? ((lead - 0x81) * 2) + 0x21 : ((lead - 0xc1) * 2) + 0x21;
  let cell;
  if (trail >= 0x9f) {
    row += 1;
    cell = trail - 0x7e;
  } else {
    cell = trail - (trail > 0x7e ? 0x20 : 0x1f);
  }
  return { row: row - 0x20, cell: cell - 0x20 };
}

function isJapaneseV3GlyphBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 2) return false;
  const lead = bytes[0];
  const trail = bytes[1];
  if (!(((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef))
      && ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc)))) return false;
  const { row, cell } = sjisJisRow(lead, trail);
  if (cell < 1 || cell > 94) return false;
  return (row >= 1 && row <= 8) || (row >= 16 && row <= 47);
}

function textLocation(location, characterIndex) {
  const base = location && typeof location === 'object'
    ? [location.sceneId && `scene "${location.sceneId}"`, Number.isInteger(location.commandIndex) && `command ${location.commandIndex}`, location.field]
        .filter(Boolean).join(', ')
    : String(location || 'text');
  return `${base || 'text'}, character ${characterIndex}`;
}

function encodeSystemCardText(text, location = 'text', options = {}) {
  const normalized = normalizeSystemCardText(text);
  const words = [];
  let characterIndex = 0;
  for (const char of normalized) {
    if (char === '\r') continue;
    if (char === '\n') {
      words.push(SYSTEM_CARD_NEWLINE);
      characterIndex += 1;
      continue;
    }
    const encoded = iconv.encode(char, 'shift_jis');
    const decoded = iconv.decode(encoded, 'shift_jis');
    if (decoded !== char || !isJapaneseV3GlyphBytes(encoded)) {
      const cp = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      throw new Error(`System Card jp-v3 font does not contain U+${cp} at ${textLocation(location, characterIndex)}`);
    }
    words.push((encoded[0] << 8) | encoded[1]);
    characterIndex += 1;
  }
  if (words.length > (options.maxCharacters ?? 255)) {
    throw new Error(`System Card text at ${textLocation(location, words.length)} exceeds ${options.maxCharacters ?? 255} characters`);
  }
  const out = Buffer.alloc(words.length * 2 + (options.terminate === false ? 0 : 2));
  words.forEach((word, index) => out.writeUInt16LE(word, index * 2));
  if (options.terminate !== false) out.writeUInt16LE(SYSTEM_CARD_TEXT_END, words.length * 2);
  return { normalized, words, buffer: out, length: words.length };
}

function convertSystemCardGlyph12ToMask24(source) {
  const input = Buffer.from(source || []);
  if (input.length !== 32) throw new Error('System Card 12x12 glyph source must be exactly 32 bytes');
  const out = Buffer.alloc(24);
  for (let row = 0; row < 12; row += 1) {
    out[row * 2] = input[row * 2];
    out[row * 2 + 1] = input[row * 2 + 1] & 0xf0;
  }
  return out;
}

function convertSystemCardGlyph16ToPce4bpp(source, color = 1) {
  const input = Buffer.from(source || []);
  if (input.length !== 32) throw new Error('System Card 16x16 glyph source must be exactly 32 bytes');
  const out = Buffer.alloc(128);
  const ink = Math.max(1, Math.min(15, Number(color) || 1));
  for (let y = 0; y < 16; y += 1) {
    const left = input[y * 2];
    const right = input[y * 2 + 1];
    for (let plane = 0; plane < 4; plane += 1) {
      if (!(ink & (1 << plane))) continue;
      const offset = (plane * 32) + (y * 2);
      /* PCE sprite patterns store the right 8 pixels before the left 8 pixels
         for each 16-pixel row, with one 32-byte block per bitplane. */
      out[offset] = right;
      out[offset + 1] = left;
    }
  }
  return out;
}

module.exports = {
  SYSTEM_CARD_NEWLINE,
  SYSTEM_CARD_TEXT_END,
  normalizeSystemCardText,
  isJapaneseV3GlyphBytes,
  encodeSystemCardText,
  convertSystemCardGlyph12ToMask24,
  convertSystemCardGlyph16ToPce4bpp,
};
