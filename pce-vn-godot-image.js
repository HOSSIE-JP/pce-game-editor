'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { encodeIndexedPng } = require('./pce-vn-gb-studio-image');
const { isPathInside, normalizeRelativePath } = require('./pce-file-safety');

function positiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label}が不正です: ${value}`);
  }
  return number;
}

function readGeneratedFile(projectDir, relativePath, label) {
  const cleaned = normalizeRelativePath(String(relativePath || '').trim());
  const absolute = cleaned ? path.resolve(projectDir, cleaned) : '';
  if (
    !cleaned
    || cleaned.split('/').includes('..')
    || !isPathInside(projectDir, absolute)
    || !fs.existsSync(absolute)
    || !fs.statSync(absolute).isFile()
  ) {
    throw new Error(`PCE版${label}が見つかりません: ${relativePath || '(未生成)'}`);
  }
  return fs.readFileSync(absolute);
}

function decodePcePalette(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) {
    throw new Error('PCE版palette.binが不正です');
  }
  return Array.from({ length: 16 }, (_unused, index) => {
    const word = buffer.readUInt16LE(index * 2);
    const blue = word & 7;
    const red = (word >> 3) & 7;
    const green = (word >> 6) & 7;
    return [red, green, blue].map((component) => Math.round(component * 255 / 7));
  });
}

function decodeBackgroundIndices(tiles, width, height) {
  const imageWidth = positiveInt(width, 'PCE版BG幅');
  const imageHeight = positiveInt(height, 'PCE版BG高さ');
  if (imageWidth % 8 || imageHeight % 8) {
    throw new Error(`PCE版BGサイズは8px単位である必要があります: ${imageWidth}x${imageHeight}`);
  }
  const tileColumns = imageWidth / 8;
  const tileRows = imageHeight / 8;
  const requiredBytes = tileColumns * tileRows * 32;
  if (!Buffer.isBuffer(tiles) || tiles.length < requiredBytes) {
    throw new Error(`PCE版tiles.binが不足しています: ${tiles?.length || 0}/${requiredBytes} bytes`);
  }
  const indices = new Uint8Array(imageWidth * imageHeight);
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const tileBase = ((tileY * tileColumns) + tileX) * 32;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          let color = 0;
          for (let plane = 0; plane < 4; plane += 1) {
            const planeOffset = plane < 2 ? (y * 2) + plane : 16 + (y * 2) + (plane - 2);
            if (tiles[tileBase + planeOffset] & (0x80 >> x)) color |= 1 << plane;
          }
          indices[((tileY * 8 + y) * imageWidth) + tileX * 8 + x] = color;
        }
      }
    }
  }
  return indices;
}

function spritePatternColor(patterns, patternBase, x, y) {
  let color = 0;
  const byteInRow = x < 8 ? 1 : 0;
  const mask = 0x80 >> (x & 7);
  for (let plane = 0; plane < 4; plane += 1) {
    const offset = patternBase + (plane * 32) + (y * 2) + byteInRow;
    if (patterns[offset] & mask) color |= 1 << plane;
  }
  return color;
}

function decodeSpriteIndices(patterns, cellMap, width, height, cellWidth, cellHeight) {
  const imageWidth = positiveInt(width, 'PCE版Sprite幅');
  const imageHeight = positiveInt(height, 'PCE版Sprite高さ');
  const displayCellWidth = positiveInt(cellWidth, 'PCE版Sprite cell幅');
  const displayCellHeight = positiveInt(cellHeight, 'PCE版Sprite cell高さ');
  if (
    imageWidth % displayCellWidth
    || imageHeight % displayCellHeight
    || displayCellWidth % 16
    || displayCellHeight % 16
  ) {
    throw new Error(`PCE版Spriteサイズ/cellが不正です: ${imageWidth}x${imageHeight} / ${displayCellWidth}x${displayCellHeight}`);
  }
  const cellColumns = imageWidth / displayCellWidth;
  const cellRows = imageHeight / displayCellHeight;
  const expectedCells = cellColumns * cellRows;
  if (!Buffer.isBuffer(cellMap) || cellMap.length !== expectedCells) {
    throw new Error(`PCE版cellmap.binが不正です: ${cellMap?.length || 0}/${expectedCells} bytes`);
  }
  const patternColumns = displayCellWidth / 16;
  const patternRows = displayCellHeight / 16;
  const rowPatternSlots = patternRows > 1 ? Math.max(patternColumns, 2) : patternColumns;
  const blockBytes = rowPatternSlots * patternRows * 128;
  if (!Buffer.isBuffer(patterns) || !patterns.length || patterns.length % blockBytes) {
    throw new Error(`PCE版patterns.binが不正です: ${patterns?.length || 0} bytes`);
  }
  const uniqueBlocks = patterns.length / blockBytes;
  const indices = new Uint8Array(imageWidth * imageHeight);
  for (let cellIndex = 0; cellIndex < expectedCells; cellIndex += 1) {
    const blockIndex = cellMap[cellIndex];
    if (blockIndex >= uniqueBlocks) {
      throw new Error(`PCE版cellmap.binが存在しないpattern blockを参照しています: ${blockIndex}/${uniqueBlocks}`);
    }
    const cellX = (cellIndex % cellColumns) * displayCellWidth;
    const cellY = Math.floor(cellIndex / cellColumns) * displayCellHeight;
    const blockBase = blockIndex * blockBytes;
    for (let patternY = 0; patternY < patternRows; patternY += 1) {
      for (let patternX = 0; patternX < patternColumns; patternX += 1) {
        const patternBase = blockBase + ((patternY * rowPatternSlots) + patternX) * 128;
        for (let y = 0; y < 16; y += 1) {
          for (let x = 0; x < 16; x += 1) {
            const destinationX = cellX + patternX * 16 + x;
            const destinationY = cellY + patternY * 16 + y;
            indices[(destinationY * imageWidth) + destinationX] = spritePatternColor(patterns, patternBase, x, y);
          }
        }
      }
    }
  }
  return indices;
}

function buildPceVisualPng(projectDir, asset = {}) {
  const generated = asset?.data?.generated || {};
  const options = asset?.options || {};
  const width = positiveInt(options.width, `${asset.id || 'asset'} width`);
  const height = positiveInt(options.height, `${asset.id || 'asset'} height`);
  const palette = decodePcePalette(readGeneratedFile(projectDir, generated.paletteFile, `${asset.id} palette`));
  let indices;
  let alphaTable = [];
  if (asset.type === 'sprite') {
    const patterns = readGeneratedFile(projectDir, generated.tilesFile, `${asset.id} patterns`);
    const cellMap = readGeneratedFile(projectDir, generated.cellMapFile, `${asset.id} cell map`);
    indices = decodeSpriteIndices(
      patterns,
      cellMap,
      width,
      height,
      options.cellWidth || 16,
      options.cellHeight || 16,
    );
    alphaTable = Array.from({ length: 16 }, () => 255);
    alphaTable[Math.max(0, Math.min(15, Number(options.transparentIndex) || 0))] = 0;
  } else if (asset.type === 'image') {
    indices = decodeBackgroundIndices(
      readGeneratedFile(projectDir, generated.tilesFile, `${asset.id} tiles`),
      width,
      height,
    );
  } else {
    throw new Error(`PCE版PNGを生成できないasset typeです: ${asset.type}`);
  }
  return {
    data: encodeIndexedPng({ width, height, indices, palette, alphaTable }),
    width,
    height,
  };
}

module.exports = {
  buildPceVisualPng,
  decodeBackgroundIndices,
  decodePcePalette,
  decodeSpriteIndices,
};
