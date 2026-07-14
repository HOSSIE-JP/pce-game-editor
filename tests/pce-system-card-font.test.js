'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSystemCardText,
  encodeSystemCardText,
  convertSystemCardGlyph12ToMask24,
  convertSystemCardGlyph16ToPce4bpp,
} = require('../pce-system-card-font');

test('System Card text normalizes printable ASCII and encodes fixed Shift-JIS words', () => {
  assert.equal(normalizeSystemCardText('A 1!'), 'Ａ　１！');
  const encoded = encodeSystemCardText('A\n日', { sceneId: 'opening', commandIndex: 2, field: 'message' });
  assert.equal(encoded.length, 3);
  assert.equal(encoded.buffer.length, 8);
  assert.equal(encoded.words[1], 0xfffe);
});

test('System Card text rejects JIS level 2, halfwidth kana and emoji with a location', () => {
  for (const text of ['熙', 'ｶ', '😀']) {
    assert.throws(
      () => encodeSystemCardText(text, { sceneId: 's0', commandIndex: 7, field: 'text' }),
      /scene "s0", command 7, text, character 0/,
    );
  }
});

test('System Card 12x12 conversion masks the unused four columns', () => {
  const source = Buffer.alloc(32, 0xff);
  const mask = convertSystemCardGlyph12ToMask24(source);
  assert.equal(mask.length, 24);
  for (let row = 0; row < 12; row += 1) assert.equal(mask[row * 2 + 1], 0xf0);
});

test('System Card 16x16 conversion emits PCE hardware sprite plane order', () => {
  const source = Buffer.alloc(32);
  source[0] = 0x80;
  source[31] = 0x01;
  const pattern = convertSystemCardGlyph16ToPce4bpp(source, 3);
  assert.equal(pattern.length, 128);
  assert.equal(pattern[1], 0x80);
  assert.equal(pattern[33], 0x80);
  assert.equal(pattern[30], 0x01);
  assert.equal(pattern[62], 0x01);
  assert.equal(pattern.subarray(64).every((byte) => byte === 0), true);
});
