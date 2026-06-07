'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IPL_SIZE = 2048;
const RAW_MODE1_SECTOR_SIZE = 2352;

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseCueTime(value) {
  const match = /^(\d+):(\d+):(\d+)$/.exec(String(value || '').trim());
  if (!match) throw new Error(`invalid cue index time: ${value}`);
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frames = Number(match[3]);
  if (seconds > 59 || frames > 74) throw new Error(`invalid cue index time: ${value}`);
  return ((minutes * 60) + seconds) * 75 + frames;
}

function parseCueFileToken(line) {
  const quoted = /^\s*FILE\s+"([^"]+)"\s+\S+/i.exec(line);
  if (quoted) return quoted[1];
  const bare = /^\s*FILE\s+(\S+)\s+\S+/i.exec(line);
  return bare ? bare[1] : null;
}

function resolveCueFile(cuePath, fileRef) {
  const raw = String(fileRef || '').trim();
  if (!raw) throw new Error('cue FILE reference is empty');
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw new Error(`cue FILE must be relative: ${raw}`);
  }
  const cueDir = path.dirname(path.resolve(cuePath));
  const normalized = raw.replace(/\\/g, path.sep);
  const resolved = path.resolve(cueDir, normalized);
  const rel = path.relative(cueDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`cue FILE escapes cue directory: ${raw}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`cue FILE not found: ${raw}`);
  }
  return resolved;
}

function parseCue(cuePath) {
  const resolvedCue = path.resolve(cuePath);
  const text = fs.readFileSync(resolvedCue, 'utf-8');
  const tracks = [];
  let currentFile = null;
  let currentTrack = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const fileRef = parseCueFileToken(line);
    if (fileRef) {
      currentFile = resolveCueFile(resolvedCue, fileRef);
      currentTrack = null;
      continue;
    }

    const trackMatch = /^\s*TRACK\s+(\d+)\s+(\S+)/i.exec(line);
    if (trackMatch) {
      currentTrack = {
        number: Number(trackMatch[1]),
        mode: trackMatch[2].toUpperCase(),
        filePath: currentFile,
        index01: null,
      };
      tracks.push(currentTrack);
      continue;
    }

    const indexMatch = /^\s*INDEX\s+01\s+(\d+:\d+:\d+)/i.exec(line);
    if (indexMatch && currentTrack) {
      currentTrack.index01 = parseCueTime(indexMatch[1]);
    }
  }

  const dataTrack = tracks.find((track) => /^MODE1\/(2048|2352)$/i.test(track.mode));
  if (!dataTrack) throw new Error('cue does not contain a MODE1/2048 or MODE1/2352 data track');
  if (!dataTrack.filePath) throw new Error(`cue data track ${dataTrack.number} does not have a FILE reference`);
  return dataTrack;
}

function isRawMode1Sector(buffer, offset = 0) {
  if (buffer.length < offset + RAW_MODE1_SECTOR_SIZE) return false;
  if (buffer[offset] !== 0x00 || buffer[offset + 11] !== 0x00 || buffer[offset + 15] !== 0x01) return false;
  for (let i = 1; i <= 10; i++) {
    if (buffer[offset + i] !== 0xff) return false;
  }
  return true;
}

function readBytesAt(filePath, offset, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function modeToSector(mode) {
  const normalized = String(mode || '').trim().toUpperCase();
  if (normalized === 'MODE1/2048') return { mode: normalized, sectorSize: 2048, dataOffset: 0 };
  if (normalized === 'MODE1/2352') return { mode: normalized, sectorSize: RAW_MODE1_SECTOR_SIZE, dataOffset: 16 };
  throw new Error(`unsupported PCE-CD data track mode: ${mode}`);
}

function extractSectorPayload(filePath, sectorIndex, mode) {
  const { mode: normalizedMode, sectorSize, dataOffset } = modeToSector(mode);
  const sourceSize = fs.statSync(filePath).size;
  const sourceOffset = sectorIndex * sectorSize + dataOffset;
  if (sourceSize < sourceOffset + IPL_SIZE) {
    throw new Error(`disc image is too small for IPL extraction: ${path.basename(filePath)}`);
  }
  if (normalizedMode === 'MODE1/2352') {
    const rawSector = readBytesAt(filePath, sectorIndex * sectorSize, RAW_MODE1_SECTOR_SIZE);
    if (!isRawMode1Sector(rawSector)) {
      throw new Error('MODE1/2352 sector does not contain a valid raw Mode 1 header');
    }
  }
  return {
    buffer: Buffer.from(readBytesAt(filePath, sourceOffset, IPL_SIZE)),
    sourceSize,
    sourceOffset,
    sectorSize,
  };
}

function directImageMode(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.iso') return 'MODE1/2048';
  const firstSector = readBytesAt(inputPath, 0, RAW_MODE1_SECTOR_SIZE);
  return isRawMode1Sector(firstSector) ? 'MODE1/2352' : 'MODE1/2048';
}

function extractIplBuffer(inputPath) {
  const resolvedInput = path.resolve(String(inputPath || ''));
  if (!resolvedInput || !fs.existsSync(resolvedInput)) {
    throw new Error(`disc image not found: ${inputPath || ''}`);
  }
  const ext = path.extname(resolvedInput).toLowerCase();
  if (ext === '.cue') {
    const track = parseCue(resolvedInput);
    const sectorIndex = track.index01 || 0;
    const extracted = extractSectorPayload(track.filePath, sectorIndex, track.mode);
    return {
      ...extracted,
      inputFormat: 'cue',
      sourceFileName: path.basename(track.filePath),
      cueFileName: path.basename(resolvedInput),
      trackNumber: track.number,
      trackMode: track.mode,
      sectorIndex,
    };
  }

  if (!['.iso', '.bin', '.img'].includes(ext)) {
    throw new Error('unsupported PCE-CD image format. Use ISO, BIN, IMG, or CUE.');
  }
  const mode = directImageMode(resolvedInput);
  const extracted = extractSectorPayload(resolvedInput, 0, mode);
  return {
    ...extracted,
    inputFormat: ext.replace(/^\./, ''),
    sourceFileName: path.basename(resolvedInput),
    cueFileName: null,
    trackNumber: 1,
    trackMode: mode,
    sectorIndex: 0,
  };
}

function extractIplToDirectory(inputPath, outputDir) {
  const result = extractIplBuffer(inputPath);
  ensureDirSync(outputDir);
  const outputPath = path.join(outputDir, 'ipl.bin');
  const metadataPath = path.join(outputDir, 'ipl.metadata.json');
  const metadata = {
    version: 1,
    type: 'pce-cd-ipl',
    sourceFileName: result.sourceFileName,
    cueFileName: result.cueFileName,
    inputFormat: result.inputFormat,
    trackNumber: result.trackNumber,
    trackMode: result.trackMode,
    sectorIndex: result.sectorIndex,
    sectorSize: result.sectorSize,
    sourceOffset: result.sourceOffset,
    byteLength: result.buffer.length,
    sha256: sha256(result.buffer),
    extractedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outputPath, result.buffer);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  return {
    ok: true,
    outputPath,
    metadataPath,
    metadata,
  };
}

module.exports = {
  IPL_SIZE,
  RAW_MODE1_SECTOR_SIZE,
  extractIplBuffer,
  extractIplToDirectory,
  isRawMode1Sector,
  parseCue,
  parseCueTime,
};
