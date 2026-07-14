'use strict';

const fs = require('fs');
const crypto = require('crypto');

const SYSTEM_CARD_PROFILE_JP_V3 = 'jp-v3';
const SYSTEM_CARD_ROM_BYTES = 0x40000;
const COPIER_HEADER_BYTES = 512;
const JP_V3_SHA1 = '79f5ff55dd10187c7fd7b8daab0b3ffbd1f56a2c';

function normalizeSystemCardRom(buffer) {
  const bytes = Buffer.from(buffer || []);
  if (bytes.length === SYSTEM_CARD_ROM_BYTES) return bytes;
  if (bytes.length === SYSTEM_CARD_ROM_BYTES + COPIER_HEADER_BYTES) {
    return bytes.subarray(COPIER_HEADER_BYTES);
  }
  return null;
}

function inspectSystemCardBuffer(buffer) {
  const rom = normalizeSystemCardRom(buffer);
  if (!rom) {
    return {
      ok: false,
      profile: null,
      error: `System Card ROM must be ${SYSTEM_CARD_ROM_BYTES} bytes (or ${SYSTEM_CARD_ROM_BYTES + COPIER_HEADER_BYTES} bytes with a copier header)`,
    };
  }
  const sha1 = crypto.createHash('sha1').update(rom).digest('hex');
  if (sha1 !== JP_V3_SHA1) {
    return {
      ok: false,
      profile: null,
      sha1,
      error: `System Card ROM is not the Japanese Super System Card 3.0 required by profile ${SYSTEM_CARD_PROFILE_JP_V3} (SHA-1 ${sha1})`,
    };
  }
  return {
    ok: true,
    profile: SYSTEM_CARD_PROFILE_JP_V3,
    version: '3.0',
    region: 'jp',
    sha1,
    copierHeaderBytes: Buffer.byteLength(buffer || []) - SYSTEM_CARD_ROM_BYTES,
  };
}

function inspectSystemCardFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, profile: null, error: `System Card ROM not found: ${filePath || '(not configured)'}` };
  }
  try {
    return { ...inspectSystemCardBuffer(fs.readFileSync(filePath)), path: filePath };
  } catch (error) {
    return { ok: false, profile: null, path: filePath, error: error.message || String(error) };
  }
}

module.exports = {
  COPIER_HEADER_BYTES,
  JP_V3_SHA1,
  SYSTEM_CARD_PROFILE_JP_V3,
  SYSTEM_CARD_ROM_BYTES,
  inspectSystemCardBuffer,
  inspectSystemCardFile,
  normalizeSystemCardRom,
};
