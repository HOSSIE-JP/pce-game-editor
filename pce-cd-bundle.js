'use strict';

const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11),
    date: date.getDate() | ((date.getMonth() + 1) << 5) | ((year - 1980) << 9),
  };
}

function writeU16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function writeU32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function createStoredZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf-8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const crc = crc32(data);
    const stamp = dosTime(entry.mtime || new Date());
    const local = Buffer.concat([
      writeU32(0x04034b50),
      writeU16(20),
      writeU16(0),
      writeU16(0),
      writeU16(stamp.time),
      writeU16(stamp.date),
      writeU32(crc),
      writeU32(data.length),
      writeU32(data.length),
      writeU16(name.length),
      writeU16(0),
      name,
      data,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.concat([
      writeU32(0x02014b50),
      writeU16(20),
      writeU16(20),
      writeU16(0),
      writeU16(0),
      writeU16(stamp.time),
      writeU16(stamp.date),
      writeU32(crc),
      writeU32(data.length),
      writeU32(data.length),
      writeU16(name.length),
      writeU16(0),
      writeU16(0),
      writeU16(0),
      writeU16(0),
      writeU32(0),
      writeU32(offset),
      name,
    ]));
    offset += local.length;
  });
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    writeU32(0x06054b50),
    writeU16(0),
    writeU16(0),
    writeU16(entries.length),
    writeU16(entries.length),
    writeU32(central.length),
    writeU32(offset),
    writeU16(0),
  ]);
  return Buffer.concat([...localParts, central, end]);
}

function isPathInside(parentPath, childPath) {
  const rel = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseCueFileReferences(cuePath) {
  const cueDir = path.dirname(cuePath);
  const cue = fs.readFileSync(cuePath, 'utf-8');
  const files = [];
  const regex = /^\s*FILE\s+"([^"]+)"/gim;
  let match;
  while ((match = regex.exec(cue))) {
    const raw = match[1].replace(/\\/g, '/');
    const absPath = path.resolve(cueDir, raw);
    if (!isPathInside(cueDir, absPath)) {
      throw new Error(`CUE file reference escapes output directory: ${raw}`);
    }
    if (!fs.existsSync(absPath)) {
      throw new Error(`CUE referenced file is missing: ${raw}`);
    }
    files.push(absPath);
  }
  return Array.from(new Set(files));
}

function createCdTestPlayBundle(cuePath) {
  const resolvedCue = path.resolve(cuePath);
  const cueDir = path.dirname(resolvedCue);
  const outputPath = path.join(cueDir, `${path.basename(resolvedCue, path.extname(resolvedCue))}-testplay.zip`);
  const files = [resolvedCue, ...parseCueFileReferences(resolvedCue)];
  const entries = files.map((filePath) => ({
    name: path.basename(filePath),
    data: fs.readFileSync(filePath),
    mtime: fs.statSync(filePath).mtime,
  }));
  fs.writeFileSync(outputPath, createStoredZipBuffer(entries));
  return {
    zipPath: outputPath,
    files,
    entryName: path.basename(resolvedCue),
  };
}

module.exports = {
  createCdTestPlayBundle,
  createStoredZipBuffer,
  parseCueFileReferences,
};
