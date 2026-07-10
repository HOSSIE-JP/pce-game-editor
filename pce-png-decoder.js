'use strict';

const zlib = require('zlib');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterPngScanlines(input, height, rowBytes, bytesPerPixel) {
  const output = Buffer.alloc(rowBytes * height);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    if (src >= input.length) throw new Error('PNG data is truncated');
    const filter = input[src++];
    const rowOffset = y * rowBytes;
    const prevOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      if (src >= input.length) throw new Error('PNG data is truncated');
      const raw = input[src++];
      const left = x >= bytesPerPixel ? output[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[prevOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? output[prevOffset + x - bytesPerPixel] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
      else throw new Error(`unsupported PNG filter: ${filter}`);
      output[rowOffset + x] = value & 0xff;
    }
  }
  return output;
}

function unpackPngSample(row, x, bitDepth) {
  if (bitDepth === 8) return row[x] || 0;
  const bitOffset = x * bitDepth;
  const byte = row[Math.floor(bitOffset / 8)] || 0;
  const shift = 8 - bitDepth - (bitOffset % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function decodePngImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG image is required');
  }
  let offset = 8; let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
  let palette = []; let alphaTable = [];
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8; const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error('PNG chunk is truncated');
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0) throw new Error('unsupported PNG compression/filter method');
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i + 2 < data.length; i += 3) palette.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    } else if (type === 'tRNS') alphaTable = Array.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  if (!width || !height || idat.length === 0) throw new Error('invalid PNG image');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type: ${colorType}`);
  if (![1, 2, 4, 8].includes(bitDepth) || (colorType !== 3 && bitDepth !== 8)) {
    throw new Error(`unsupported PNG bit depth: ${bitDepth}`);
  }
  const bitsPerPixel = bitDepth * channels;
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const rows = unfilterPngScanlines(zlib.inflateSync(Buffer.concat(idat)), height, rowBytes, Math.max(1, Math.ceil(bitsPerPixel / 8)));
  if (colorType === 3) {
    if (palette.length === 0) throw new Error('indexed PNG is missing PLTE');
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let x = 0; x < width; x += 1) indices[(y * width) + x] = unpackPngSample(row, x, bitDepth);
    }
    return { format: 'indexed', width, height, indices, palette, alphaTable };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = rows.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < width; x += 1) {
      const dest = ((y * width) + x) * 4;
      if (colorType === 0) {
        rgba.set([row[x], row[x], row[x], 255], dest);
      } else if (colorType === 2) {
        const src = x * 3; rgba.set([row[src], row[src + 1], row[src + 2], 255], dest);
      } else if (colorType === 4) {
        const src = x * 2; rgba.set([row[src], row[src], row[src], row[src + 1]], dest);
      } else {
        const src = x * 4; rgba.set(row.subarray(src, src + 4), dest);
      }
    }
  }
  return { format: 'rgba', width, height, rgba };
}

module.exports = { decodePngImage, parsePngSize };
