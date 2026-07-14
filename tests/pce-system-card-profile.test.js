'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JP_V3_SHA1,
  SYSTEM_CARD_PROFILE_JP_V3,
  SYSTEM_CARD_ROM_BYTES,
  inspectSystemCardBuffer,
  normalizeSystemCardRom,
} = require('../pce-system-card-profile');

test('System Card jp-v3 profile publishes the documented identity without BIOS bytes', () => {
  assert.equal(SYSTEM_CARD_PROFILE_JP_V3, 'jp-v3');
  assert.equal(SYSTEM_CARD_ROM_BYTES, 262144);
  assert.equal(JP_V3_SHA1, '79f5ff55dd10187c7fd7b8daab0b3ffbd1f56a2c');
});

test('System Card profile normalizer strips only a 512-byte copier header', () => {
  const raw = Buffer.alloc(SYSTEM_CARD_ROM_BYTES, 0x5a);
  const headered = Buffer.concat([Buffer.alloc(512, 0xa5), raw]);
  assert.deepEqual(normalizeSystemCardRom(headered), raw);
  assert.equal(normalizeSystemCardRom(Buffer.alloc(17)), null);
});

test('System Card profile rejects unknown content without storing a BIOS fixture', () => {
  const result = inspectSystemCardBuffer(Buffer.alloc(SYSTEM_CARD_ROM_BYTES));
  assert.equal(result.ok, false);
  assert.equal(result.profile, null);
  assert.match(result.error, /not the Japanese Super System Card 3\.0/);
});
