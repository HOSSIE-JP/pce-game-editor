'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CD_PAYLOAD_PACK_FORMAT = 'pce-cd-payload-pack';
const CD_PAYLOAD_PACK_VERSION = 1;
const CD_SECTOR_BYTES = 2048;
const CD_PAYLOAD_MAX_BYTES = 65535;
const COPY_CHUNK_BYTES = 16 * 1024;

let tempSequence = 0;

function normalizeLogicalPath(value) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw.includes('\0')) {
    throw new Error('CD payload logicalPath is required');
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.'
    || path.posix.isAbsolute(normalized)
    || normalized === '..'
    || normalized.startsWith('../')) {
    throw new Error(`Invalid CD payload logicalPath: ${raw}`);
  }
  return normalized;
}

function tempPathFor(targetPath) {
  tempSequence += 1;
  return `${targetPath}.tmp-${process.pid}-${tempSequence}`;
}

function removeFileQuietly(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
}

function writeAll(fd, buffer, offset = 0, length = buffer.length) {
  let written = 0;
  while (written < length) {
    const count = fs.writeSync(fd, buffer, offset + written, length - written);
    if (count <= 0) {
      throw new Error('CD payload pack write made no progress');
    }
    written += count;
  }
}

function validateOutputPaths(packPath, indexPath) {
  if (!String(packPath || '').trim()) throw new Error('CD payload packPath is required');
  if (!String(indexPath || '').trim()) throw new Error('CD payload indexPath is required');
  const resolvedPack = path.resolve(packPath);
  const resolvedIndex = path.resolve(indexPath);
  const comparablePack = process.platform === 'win32' ? resolvedPack.toLowerCase() : resolvedPack;
  const comparableIndex = process.platform === 'win32' ? resolvedIndex.toLowerCase() : resolvedIndex;
  if (comparablePack === comparableIndex) {
    throw new Error('CD payload packPath and indexPath must be different files');
  }
  return { packPath: resolvedPack, indexPath: resolvedIndex };
}

function inspectEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('CD payload entries must be an array');
  }
  const logicalPaths = new Set();
  return entries.map((entry, index) => {
    const logicalPath = normalizeLogicalPath(entry?.logicalPath);
    if (logicalPaths.has(logicalPath)) {
      throw new Error(`Duplicate CD payload logicalPath: ${logicalPath}`);
    }
    logicalPaths.add(logicalPath);

    const sourceValue = String(entry?.sourcePath || '').trim();
    if (!sourceValue) {
      throw new Error(`CD payload sourcePath is required: ${logicalPath}`);
    }
    const sourcePath = path.resolve(sourceValue);
    const maxBytes = entry?.maxBytes === undefined
      ? CD_PAYLOAD_MAX_BYTES
      : Number(entry.maxBytes);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error(`Invalid CD payload maxBytes: ${logicalPath}`);
    }
    let stat;
    try {
      stat = fs.statSync(sourcePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`CD payload is missing: ${logicalPath} (${sourcePath})`);
      }
      throw new Error(`Cannot inspect CD payload ${logicalPath} (${sourcePath}): ${error?.message || error}`);
    }
    if (!stat.isFile()) {
      throw new Error(`CD payload is not a file: ${logicalPath} (${sourcePath})`);
    }
    if (stat.size > maxBytes) {
      throw new Error(
        `CD payload exceeds ${maxBytes} bytes: ${logicalPath} (${stat.size} bytes)`,
      );
    }
    return {
      inputIndex: index,
      logicalPath,
      sourcePath,
      byteSize: stat.size,
    };
  });
}

function copyEntryToPack(entry, packFd, copyBuffer) {
  let sourceFd = -1;
  const hash = crypto.createHash('sha256');
  try {
    sourceFd = fs.openSync(entry.sourcePath, 'r');
    const openedStat = fs.fstatSync(sourceFd);
    if (!openedStat.isFile() || openedStat.size !== entry.byteSize) {
      throw new Error(
        `CD payload changed before packing: ${entry.logicalPath} `
        + `(expected ${entry.byteSize} bytes, found ${openedStat.size} bytes)`,
      );
    }

    let remaining = entry.byteSize;
    while (remaining > 0) {
      const requested = Math.min(copyBuffer.length, remaining);
      const bytesRead = fs.readSync(sourceFd, copyBuffer, 0, requested, null);
      if (bytesRead <= 0) {
        throw new Error(
          `CD payload changed while packing: ${entry.logicalPath} `
          + `(expected ${entry.byteSize} bytes)`,
        );
      }
      const chunk = copyBuffer.subarray(0, bytesRead);
      hash.update(chunk);
      writeAll(packFd, chunk);
      remaining -= bytesRead;
    }

    const trailingByte = Buffer.allocUnsafe(1);
    if (fs.readSync(sourceFd, trailingByte, 0, 1, null) !== 0) {
      throw new Error(
        `CD payload changed while packing: ${entry.logicalPath} `
        + `(grew beyond ${entry.byteSize} bytes)`,
      );
    }
  } finally {
    if (sourceFd >= 0) fs.closeSync(sourceFd);
  }
  return hash.digest('hex');
}

function writeIndexTemp(indexTempPath, index) {
  const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8');
  const fd = fs.openSync(indexTempPath, 'wx');
  try {
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function filesEqual(leftPath, rightPath, expectedSize) {
  let leftFd = -1;
  let rightFd = -1;
  const leftBuffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  const rightBuffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let remaining = expectedSize;
  try {
    leftFd = fs.openSync(leftPath, 'r');
    rightFd = fs.openSync(rightPath, 'r');
    while (remaining > 0) {
      const requested = Math.min(COPY_CHUNK_BYTES, remaining);
      const leftRead = fs.readSync(leftFd, leftBuffer, 0, requested, null);
      const rightRead = fs.readSync(rightFd, rightBuffer, 0, requested, null);
      if (leftRead !== requested || rightRead !== requested
        || !leftBuffer.subarray(0, requested).equals(rightBuffer.subarray(0, requested))) {
        return false;
      }
      remaining -= requested;
    }
    return fs.readSync(leftFd, leftBuffer, 0, 1, null) === 0
      && fs.readSync(rightFd, rightBuffer, 0, 1, null) === 0;
  } finally {
    if (leftFd >= 0) fs.closeSync(leftFd);
    if (rightFd >= 0) fs.closeSync(rightFd);
  }
}

function existingOutputsMatch(outputs, index, generatedPackPath) {
  try {
    const existing = JSON.parse(fs.readFileSync(outputs.indexPath, 'utf8'));
    const packStat = fs.statSync(outputs.packPath);
    return packStat.isFile()
      && packStat.size === index.byteSize
      && JSON.stringify(existing) === JSON.stringify(index)
      && filesEqual(outputs.packPath, generatedPackPath, index.byteSize);
  } catch (_) {
    return false;
  }
}

/**
 * Packs files in input order into a sector-aligned binary and writes its index.
 *
 * Each entry is `{ logicalPath, sourcePath }`. Source files are copied in small
 * chunks so the complete payload catalog is never assembled in memory.
 */
function writeCdPayloadPack({ entries, packPath, indexPath } = {}) {
  const outputs = validateOutputPaths(packPath, indexPath);
  const inspectedEntries = inspectEntries(entries);
  fs.mkdirSync(path.dirname(outputs.packPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputs.indexPath), { recursive: true });

  const packTempPath = tempPathFor(outputs.packPath);
  const indexTempPath = tempPathFor(outputs.indexPath);
  const copyBuffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  const zeroSector = Buffer.alloc(CD_SECTOR_BYTES);
  const indexEntries = [];
  let packFd = -1;
  let byteOffset = 0;

  try {
    packFd = fs.openSync(packTempPath, 'wx');
    for (const entry of inspectedEntries) {
      const sectorOffset = byteOffset / CD_SECTOR_BYTES;
      const hash = copyEntryToPack(entry, packFd, copyBuffer);
      const sectorCount = Math.max(1, Math.ceil(entry.byteSize / CD_SECTOR_BYTES));
      const paddedByteSize = sectorCount * CD_SECTOR_BYTES;
      const padding = paddedByteSize - entry.byteSize;
      if (padding > 0) writeAll(packFd, zeroSector, 0, padding);
      byteOffset += paddedByteSize;
      indexEntries.push({
        logicalPath: entry.logicalPath,
        sectorOffset,
        byteSize: entry.byteSize,
        sectorCount,
        hash,
      });
    }
    fs.fsyncSync(packFd);
    fs.closeSync(packFd);
    packFd = -1;

    const index = {
      format: CD_PAYLOAD_PACK_FORMAT,
      version: CD_PAYLOAD_PACK_VERSION,
      sectorBytes: CD_SECTOR_BYTES,
      byteSize: byteOffset,
      sectorCount: byteOffset / CD_SECTOR_BYTES,
      entries: indexEntries,
    };
    writeIndexTemp(indexTempPath, index);

    if (existingOutputsMatch(outputs, index, packTempPath)) {
      removeFileQuietly(packTempPath);
      removeFileQuietly(indexTempPath);
      return index;
    }
    fs.renameSync(packTempPath, outputs.packPath);
    fs.renameSync(indexTempPath, outputs.indexPath);
    return index;
  } catch (error) {
    if (packFd >= 0) {
      try { fs.closeSync(packFd); } catch (_) {}
    }
    removeFileQuietly(packTempPath);
    removeFileQuietly(indexTempPath);
    throw error;
  }
}

function readCdPayloadPackIndex({ packPath, indexPath } = {}) {
  const outputs = validateOutputPaths(packPath, indexPath);
  let index;
  try {
    index = JSON.parse(fs.readFileSync(outputs.indexPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read CD payload pack index ${outputs.indexPath}: ${error?.message || error}`);
  }
  if (index?.format !== CD_PAYLOAD_PACK_FORMAT
    || index?.version !== CD_PAYLOAD_PACK_VERSION
    || index?.sectorBytes !== CD_SECTOR_BYTES
    || !Array.isArray(index?.entries)) {
    throw new Error(`Invalid CD payload pack index: ${outputs.indexPath}`);
  }
  let packSize;
  try {
    packSize = fs.statSync(outputs.packPath).size;
  } catch (error) {
    throw new Error(`Cannot inspect CD payload pack ${outputs.packPath}: ${error?.message || error}`);
  }
  if (packSize !== index.byteSize
    || packSize % CD_SECTOR_BYTES !== 0
    || index.sectorCount !== packSize / CD_SECTOR_BYTES) {
    throw new Error(
      `CD payload pack/index size mismatch: ${outputs.packPath} is ${packSize} bytes, `
      + `index declares ${index.byteSize} bytes`,
    );
  }
  const logicalPaths = new Set();
  index.entries = index.entries.map((entry) => {
    const logicalPath = normalizeLogicalPath(entry?.logicalPath);
    const sectorOffset = Number(entry?.sectorOffset);
    const byteSize = Number(entry?.byteSize);
    const sectorCount = Number(entry?.sectorCount);
    if (logicalPaths.has(logicalPath)) {
      throw new Error(`Duplicate CD payload logicalPath in index: ${logicalPath}`);
    }
    logicalPaths.add(logicalPath);
    if (!Number.isSafeInteger(sectorOffset) || sectorOffset < 0
      || !Number.isSafeInteger(byteSize) || byteSize < 0
      || !Number.isSafeInteger(sectorCount) || sectorCount < 1
      || sectorCount !== Math.max(1, Math.ceil(byteSize / CD_SECTOR_BYTES))
      || sectorOffset + sectorCount > index.sectorCount) {
      throw new Error(`Invalid CD payload index entry: ${logicalPath}`);
    }
    return {
      logicalPath,
      sectorOffset,
      byteSize,
      sectorCount,
      hash: String(entry?.hash || ''),
    };
  });
  return index;
}

module.exports = {
  CD_PAYLOAD_MAX_BYTES,
  CD_PAYLOAD_PACK_FORMAT,
  CD_PAYLOAD_PACK_VERSION,
  CD_SECTOR_BYTES,
  normalizeLogicalPath,
  readCdPayloadPackIndex,
  writeCdPayloadPack,
};
