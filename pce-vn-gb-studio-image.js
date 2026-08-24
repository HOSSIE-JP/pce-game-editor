'use strict';

const zlib = require('node:zlib');
const { decodePngImage } = require('./pce-png-decoder');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DMG_COLORS = Object.freeze([[0xe0, 0xf8, 0xcf], [0x86, 0xc0, 0x6c], [0x30, 0x68, 0x50], [0x07, 0x18, 0x21]]);
let crcTable;

function crc32(buffer) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1); return value >>> 0; });
  let crc = 0xffffffff;
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii'); const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); name.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return chunk;
}

function encodeRgbaPng({ width, height, rgba }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || rgba.length !== width * height * 4) throw new Error('RGBA PNG入力が不正です');
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) { const row = y * (width * 4 + 1); Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, row + 1); }
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function encodeIndexedPng({ width, height, indices, palette, alphaTable = [] }) {
  if (indices.length !== width * height || !palette.length || palette.length > 256) throw new Error('Indexed PNG入力が不正です');
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((color, index) => { const rgb = Array.isArray(color) ? color : [color.r, color.g, color.b]; plte[index * 3] = rgb[0]; plte[index * 3 + 1] = rgb[1]; plte[index * 3 + 2] = rgb[2]; });
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(indices.buffer, indices.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1);
  const chunks = [PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('PLTE', plte)];
  if (alphaTable.length) chunks.push(pngChunk('tRNS', Buffer.from(alphaTable)));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))); return Buffer.concat(chunks);
}

function decodedToRgba(decoded) {
  if (decoded.format === 'rgba') return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.rgba) };
  const rgba = new Uint8Array(decoded.width * decoded.height * 4);
  for (let i = 0; i < decoded.indices.length; i += 1) { const color = decoded.palette[decoded.indices[i]] || { r: 0, g: 0, b: 0 }; rgba.set([color.r, color.g, color.b, decoded.alphaTable[decoded.indices[i]] ?? 255], i * 4); }
  return { width: decoded.width, height: decoded.height, rgba };
}

function readRgbaPng(buffer) { return decodedToRgba(decodePngImage(buffer)); }

function resizeCrop(image, width = 160, height = 144, options = {}) {
  const fit = options.fit === 'contain' ? 'contain' : 'cover'; const focusX = Math.max(0, Math.min(1, Number(options.focusX) || 0.5)); const focusY = Math.max(0, Math.min(1, Number(options.focusY) || 0.5));
  const scale = fit === 'contain' ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height);
  const scaledW = image.width * scale; const scaledH = image.height * scale; const offsetX = (width - scaledW) * focusX; const offsetY = (height - scaledH) * focusY;
  const rgba = new Uint8Array(width * height * 4); const matte = options.matte || [0, 0, 0, 255];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const sx = Math.floor((x - offsetX) / scale); const sy = Math.floor((y - offsetY) / scale); const dest = (y * width + x) * 4; if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) rgba.set(matte, dest); else rgba.set(image.rgba.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), dest); }
  return { width, height, rgba };
}

function prepareBackground(image, options = {}) {
  if (options.fullScreen) return resizeCrop(image, 160, 144, { ...options, fit: 'cover' });
  const art = resizeCrop(image, 160, 96, { ...options, fit: 'cover' }); const rgba = new Uint8Array(160 * 144 * 4); const fill = options.dialogueMatte || [224, 248, 207, 255];
  for (let y = 0; y < 96; y += 1) rgba.set(art.rgba.subarray(y * 160 * 4, (y + 1) * 160 * 4), y * 160 * 4);
  for (let y = 96; y < 144; y += 1) for (let x = 0; x < 160; x += 1) rgba.set(fill, (y * 160 + x) * 4);
  return { width: 160, height: 144, rgba };
}

function luminance(r, g, b) { return Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b))); }

function multiOtsuThresholds(histogram, classCount = 4) {
  const count = new Float64Array(257); const sum = new Float64Array(257);
  for (let i = 0; i < 256; i += 1) { count[i + 1] = count[i] + histogram[i]; sum[i + 1] = sum[i] + histogram[i] * i; }
  const score = (a, b) => { const weight = count[b + 1] - count[a]; if (!weight) return 0; const value = sum[b + 1] - sum[a]; return value * value / weight; };
  const dp = Array.from({ length: classCount + 1 }, () => new Float64Array(256).fill(-Infinity)); const prev = Array.from({ length: classCount + 1 }, () => new Int16Array(256).fill(-1));
  for (let end = 0; end < 256; end += 1) dp[1][end] = score(0, end);
  for (let classes = 2; classes <= classCount; classes += 1) for (let end = classes - 1; end < 256; end += 1) for (let split = classes - 2; split < end; split += 1) { const candidate = dp[classes - 1][split] + score(split + 1, end); if (candidate > dp[classes][end]) { dp[classes][end] = candidate; prev[classes][end] = split; } }
  const thresholds = []; let end = 255; for (let classes = classCount; classes > 1; classes -= 1) { end = prev[classes][end]; thresholds.unshift(end); } return thresholds;
}

function tileKey(indices, width, tx, ty) { let key = ''; for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) key += String.fromCharCode(indices[(ty * 8 + y) * width + tx * 8 + x] || 0); return key; }
function uniqueTileCount(indices, width, height) { const tiles = new Set(); for (let ty = 0; ty < Math.ceil(height / 8); ty += 1) for (let tx = 0; tx < Math.ceil(width / 8); tx += 1) tiles.add(tileKey(indices, width, tx, ty)); return tiles.size; }

function consolidateDmgTiles(indices, width, height, limit = 192) {
  const occurrences = new Map(); const placements = [];
  for (let ty = 0; ty < Math.ceil(height / 8); ty += 1) for (let tx = 0; tx < Math.ceil(width / 8); tx += 1) { const key = tileKey(indices, width, tx, ty); placements.push({ tx, ty, key }); occurrences.set(key, (occurrences.get(key) || 0) + 1); }
  if (occurrences.size <= limit) return { indices, before: occurrences.size, after: occurrences.size, replacedTiles: 0, changedPixels: 0 };
  const prototypes = [...occurrences].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([key]) => key); const prototypeSet = new Set(prototypes); const replacements = new Map();
  for (const key of occurrences.keys()) {
    if (prototypeSet.has(key)) continue;
    let best = prototypes[0]; let bestDistance = Infinity;
    for (const candidate of prototypes) { let error = 0; for (let i = 0; i < 64; i += 1) { const delta = key.charCodeAt(i) - candidate.charCodeAt(i); error += delta * delta; } if (error < bestDistance) { bestDistance = error; best = candidate; } }
    replacements.set(key, best);
  }
  const output = new Uint8Array(indices); let replacedTiles = 0; let changedPixels = 0;
  placements.forEach(({ tx, ty, key }) => { const replacement = replacements.get(key); if (!replacement) return; replacedTiles += 1; for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { const px = tx * 8 + x; const py = ty * 8 + y; if (px >= width || py >= height) continue; const at = py * width + px; const shade = replacement.charCodeAt(y * 8 + x); if (output[at] !== shade) changedPixels += 1; output[at] = shade; } });
  return { indices: output, before: occurrences.size, after: uniqueTileCount(output, width, height), replacedTiles, changedPixels };
}

function quantizeDmg(image, options = {}) {
  const maskHeight = Math.max(1, Math.min(image.height, options.analysisHeight || (options.fullScreen ? image.height : 96))); const histogram = new Uint32Array(256);
  for (let y = 0; y < maskHeight; y += 1) for (let x = 0; x < image.width; x += 1) { const at = (y * image.width + x) * 4; histogram[luminance(image.rgba[at], image.rgba[at + 1], image.rgba[at + 2])] += 1; }
  const thresholds = multiOtsuThresholds(histogram, 4); const rgba = new Uint8Array(image.width * image.height * 4); const indices = new Uint8Array(image.width * image.height); const shadeCounts = [0, 0, 0, 0];
  for (let i = 0; i < indices.length; i += 1) { const at = i * 4; const lum = luminance(image.rgba[at], image.rgba[at + 1], image.rgba[at + 2]); let ascending = 0; while (ascending < thresholds.length && lum > thresholds[ascending]) ascending += 1; const shade = 3 - ascending; indices[i] = shade; shadeCounts[shade] += 1; rgba.set([...DMG_COLORS[shade], 255], at); }
  const consolidated = consolidateDmgTiles(indices, image.width, image.height, Number(options.tileLimit) || 192); const finalIndices = consolidated.indices;
  if (consolidated.replacedTiles) for (let i = 0; i < finalIndices.length; i += 1) rgba.set([...DMG_COLORS[finalIndices[i]], 255], i * 4);
  const finalShadeCounts = [0, 0, 0, 0]; finalIndices.forEach((shade) => { finalShadeCounts[shade] += 1; });
  const floor = Math.max(16, Math.floor(image.width * maskHeight * 0.001)); return { image: { width: image.width, height: image.height, rgba }, indices: finalIndices, audit: { thresholds, shadeCounts: finalShadeCounts, meaningfulShadeFloor: floor, meaningfulShades: finalShadeCounts.filter((n) => n >= floor).length, uniqueTiles: consolidated.after, tileLimit: Number(options.tileLimit) || 192, tileConsolidation: { before: consolidated.before, replacedTiles: consolidated.replacedTiles, changedPixels: consolidated.changedPixels } } };
}

function snap5(value) { return Math.round(Math.round(value * 31 / 255) * 255 / 31); }
function colorKey(color) { return `${color[0]},${color[1]},${color[2]}`; }
function distance(a, b) { const dr = a[0] - b[0]; const dg = a[1] - b[1]; const db = a[2] - b[2]; return dr * dr * 2 + dg * dg * 4 + db * db; }

function histogramEntries(colors) { const counts = new Map(); colors.forEach((color) => { const key = colorKey(color); const old = counts.get(key); counts.set(key, old ? { color: old.color, count: old.count + 1 } : { color, count: 1 }); }); return [...counts.values()].sort((a, b) => b.count - a.count || colorKey(a.color).localeCompare(colorKey(b.color))); }

function medianCut(entries, limit = 4) {
  if (!entries.length) return [[0, 0, 0]]; let boxes = [{ entries }];
  while (boxes.length < limit) { let selected = -1; let selectedRange = -1; boxes.forEach((box, index) => { if (box.entries.length < 2) return; const ranges = [0, 1, 2].map((channel) => Math.max(...box.entries.map((e) => e.color[channel])) - Math.min(...box.entries.map((e) => e.color[channel]))); const weighted = Math.max(...ranges) * box.entries.reduce((total, entry) => total + entry.count, 0); if (weighted > selectedRange) { selectedRange = weighted; selected = index; } }); if (selected < 0) break; const box = boxes.splice(selected, 1)[0]; const ranges = [0, 1, 2].map((channel) => Math.max(...box.entries.map((e) => e.color[channel])) - Math.min(...box.entries.map((e) => e.color[channel]))); const channel = ranges.indexOf(Math.max(...ranges)); box.entries.sort((a, b) => a.color[channel] - b.color[channel] || colorKey(a.color).localeCompare(colorKey(b.color))); const total = box.entries.reduce((sum, entry) => sum + entry.count, 0); let running = 0; let split = 1; for (; split < box.entries.length; split += 1) { running += box.entries[split - 1].count; if (running >= total / 2) break; } boxes.push({ entries: box.entries.slice(0, split) }, { entries: box.entries.slice(split) }); }
  return boxes.map((box) => { const total = box.entries.reduce((sum, entry) => sum + entry.count, 0) || 1; return [0, 1, 2].map((channel) => snap5(box.entries.reduce((sum, entry) => sum + entry.color[channel] * entry.count, 0) / total)); });
}

function paletteError(colors, palette) { return colors.reduce((sum, color) => sum + Math.min(...palette.map((candidate) => distance(color, candidate))), 0); }

function quantizeGbc(image, options = {}) {
  const maxPalettes = Math.max(1, Math.min(7, Number(options.maxPalettes) || 7)); const tileRows = Math.ceil(image.height / 8); const tileColumns = Math.ceil(image.width / 8); const tiles = [];
  for (let ty = 0; ty < tileRows; ty += 1) for (let tx = 0; tx < tileColumns; tx += 1) { const colors = []; for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { const px = Math.min(image.width - 1, tx * 8 + x); const py = Math.min(image.height - 1, ty * 8 + y); const at = (py * image.width + px) * 4; colors.push([snap5(image.rgba[at]), snap5(image.rgba[at + 1]), snap5(image.rgba[at + 2])]); } tiles.push({ tx, ty, colors, local: medianCut(histogramEntries(colors), 4), paletteIndex: 0 }); }
  const palettes = [tiles[0]?.local || [[0, 0, 0]]];
  while (palettes.length < maxPalettes) { let best = null; tiles.forEach((tile) => { const error = Math.min(...palettes.map((palette) => paletteError(tile.colors, palette))); if (!best || error > best.error) best = { tile, error }; }); if (!best || best.error <= 0) break; const key = JSON.stringify(best.tile.local); if (palettes.some((palette) => JSON.stringify(palette) === key)) break; palettes.push(best.tile.local); }
  for (let iteration = 0; iteration < 6; iteration += 1) { tiles.forEach((tile) => { let bestIndex = 0; let bestError = Infinity; palettes.forEach((palette, index) => { const error = paletteError(tile.colors, palette); if (error < bestError) { bestError = error; bestIndex = index; } }); tile.paletteIndex = bestIndex; }); palettes.forEach((palette, index) => { const colors = tiles.filter((tile) => tile.paletteIndex === index).flatMap((tile) => tile.colors); if (colors.length) palettes[index] = medianCut(histogramEntries(colors), 4); }); }
  const rgba = new Uint8Array(image.width * image.height * 4); const indices = new Uint8Array(image.width * image.height); let squaredError = 0;
  tiles.forEach((tile) => { const palette = palettes[tile.paletteIndex]; for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { const px = tile.tx * 8 + x; const py = tile.ty * 8 + y; if (px >= image.width || py >= image.height) continue; const at = (py * image.width + px) * 4; const source = [image.rgba[at], image.rgba[at + 1], image.rgba[at + 2]]; let best = 0; let bestDistance = Infinity; palette.forEach((color, index) => { const error = distance(source, color); if (error < bestDistance) { bestDistance = error; best = index; } }); const dest = py * image.width + px; indices[dest] = tile.paletteIndex * 4 + best; rgba.set([...palette[best], 255], dest * 4); squaredError += bestDistance; } });
  return { image: { width: image.width, height: image.height, rgba }, indices, palettes, tilePaletteIndices: tiles.map((tile) => tile.paletteIndex), audit: { palettes: palettes.length, paletteLimit: 7, maxColorsPerTile: Math.max(...palettes.map((palette) => palette.length)), rmse: Math.sqrt(squaredError / Math.max(1, image.width * image.height * 7)), uniqueTiles: uniqueTileCount(indices, image.width, image.height) } };
}

function makeContactSheet(entries, options = {}) { const columns = Math.max(1, Number(options.columns) || 4); const cellWidth = Math.max(160, ...entries.map((entry) => entry.image.width)); const cellHeight = Math.max(144, ...entries.map((entry) => entry.image.height)); const rows = Math.max(1, Math.ceil(entries.length / columns)); const width = cellWidth * columns; const height = cellHeight * rows; const rgba = new Uint8Array(width * height * 4); rgba.fill(255); entries.forEach((entry, index) => { const ox = (index % columns) * cellWidth; const oy = Math.floor(index / columns) * cellHeight; for (let y = 0; y < entry.image.height; y += 1) rgba.set(entry.image.rgba.subarray(y * entry.image.width * 4, (y + 1) * entry.image.width * 4), ((oy + y) * width + ox) * 4); }); return { width, height, rgba }; }

module.exports = { DMG_COLORS, consolidateDmgTiles, encodeIndexedPng, encodeRgbaPng, makeContactSheet, multiOtsuThresholds, prepareBackground, quantizeDmg, quantizeGbc, readRgbaPng, resizeCrop, uniqueTileCount };
