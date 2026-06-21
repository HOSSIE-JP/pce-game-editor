export const SPRITE_CELL_SIZES = ['16x16', '16x32', '16x64', '32x16', '32x32', '32x64'];

const CELL_SIZE_SET = new Set(SPRITE_CELL_SIZES);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

export function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function safeId(value, fallback = 'sprite_asset') {
  const id = String(value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return id || fallback;
}

export function sourceBasename(source = '') {
  return String(source || '').split(/[\\/]/).pop() || '';
}

export function extname(filePath = '') {
  const match = String(filePath).toLowerCase().match(/(\.[^.\\/]+)$/);
  return match ? match[1] : '';
}

export function compareText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'ja', { numeric: true, sensitivity: 'base' });
}

export function assetNameParts(asset = {}) {
  const label = String(asset.name || asset.id || '').trim();
  const parts = label.split('/').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [label || asset.id || ''];
}

export function assetDisplayName(asset = {}) {
  const parts = assetNameParts(asset);
  return parts[parts.length - 1] || asset.id || '';
}

export function assetGroupParts(asset = {}) {
  return assetNameParts(asset).slice(0, -1);
}

export function assetFullName(asset = {}) {
  return assetNameParts(asset).join('/');
}

export function generatedInfo(asset = {}) {
  return asset.data?.generated && typeof asset.data.generated === 'object' ? asset.data.generated : {};
}

export function normalizeCellSize(value = '16x16') {
  const raw = String(value || '').toLowerCase().replace(/\s+/g, '');
  return CELL_SIZE_SET.has(raw) ? raw : '16x16';
}

export function parseCellSize(value = '16x16') {
  return normalizeCellSize(value).split('x').map((part) => Number.parseInt(part, 10));
}

export function positiveNumber(value, fallback = 0) {
  const parsed = asNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function spriteSheetMetrics(asset = {}, image = null) {
  const options = asset.options || {};
  const generated = generatedInfo(asset);
  const [fallbackCellWidth, fallbackCellHeight] = parseCellSize(`${options.cellWidth || generated.cellWidth || 16}x${options.cellHeight || generated.cellHeight || 16}`);
  const cellWidth = fallbackCellWidth;
  const cellHeight = fallbackCellHeight;
  const generatedColumns = positiveNumber(generated.cellColumns ?? generated.columns, 0);
  const generatedRows = positiveNumber(generated.cellRows ?? generated.rows, 0);
  const imageWidth = positiveNumber(image?.naturalWidth || image?.width, 0);
  const imageHeight = positiveNumber(image?.naturalHeight || image?.height, 0);
  const generatedWidth = positiveNumber(generated.width, generatedColumns ? generatedColumns * cellWidth : 0);
  const generatedHeight = positiveNumber(generated.height, generatedRows ? generatedRows * cellHeight : 0);
  const width = Math.max(cellWidth, positiveNumber(options.width, imageWidth || generatedWidth || cellWidth));
  const height = Math.max(cellHeight, positiveNumber(options.height, imageHeight || generatedHeight || cellHeight));
  const columns = Math.max(1, Math.floor(width / cellWidth));
  const rows = Math.max(1, Math.floor(height / cellHeight));
  return {
    cellWidth,
    cellHeight,
    width,
    height,
    columns,
    rows,
    totalCells: Math.max(1, columns * rows),
  };
}

export function snapToCell(value, cellSize, fallback = cellSize, max = 256) {
  const numeric = clampInt(value, cellSize, max, fallback);
  return Math.max(cellSize, Math.min(max, Math.ceil(numeric / cellSize) * cellSize));
}

export function computeFrameGrid(imageWidth, imageHeight, frameWidth, frameHeight, cellWidth = 16, cellHeight = 16) {
  const width = snapToCell(frameWidth, cellWidth, cellWidth);
  const height = snapToCell(frameHeight, cellHeight, cellHeight);
  const sheetWidth = Math.max(width, positiveNumber(imageWidth, width));
  const sheetHeight = Math.max(height, positiveNumber(imageHeight, height));
  const columns = Math.max(1, Math.floor(sheetWidth / width));
  const rows = Math.max(1, Math.floor(sheetHeight / height));
  const frames = [];
  for (let row = 0; row < rows; row += 1) {
    for (let frame = 0; frame < columns; frame += 1) {
      frames.push({ row, frame, x: frame * width, y: row * height, width, height });
    }
  }
  return { width, height, columns, rows, frames };
}

export function parseSpriteTime(value, rows = 1, columns = 1) {
  const rowCount = normalizeCount(rows, 1);
  const columnCount = normalizeCount(columns, 1);
  const sourceRows = parseSpriteTimeRows(value, rowCount, columnCount);
  const matrix = createTimeMatrix(rowCount, columnCount, '0');
  sourceRows.forEach((row, rowIndex) => {
    row.slice(0, columnCount).forEach((cell, columnIndex) => {
      matrix[rowIndex][columnIndex] = normalizeTimeCell(cell);
    });
  });
  return matrix;
}

export function serializeSpriteTime(matrix) {
  const rows = Array.isArray(matrix) && matrix.length ? matrix : [['0']];
  return `[${rows.map((row) => `[${(Array.isArray(row) ? row : []).map((cell) => normalizeTimeCell(cell)).join(',')}]`).join('')}]`;
}

export function updateSpriteTimeCell(value, rows, columns, rowIndex, frameIndex, nextTime) {
  const matrix = parseSpriteTimeRows(value, rows, columns);
  const safeRow = clampIndex(rowIndex, matrix.length);
  const safeFrame = clampIndex(frameIndex, matrix[safeRow]?.length || 1);
  matrix[safeRow][safeFrame] = normalizeTimeCell(nextTime);
  return serializeSpriteTime(matrix);
}

export function deriveRowFrameCounts(value, rows = 1, columns = 1) {
  const columnCount = normalizeCount(columns, 1);
  return parseSpriteTimeRows(value, rows, columnCount)
    .map((row) => Math.max(1, Math.min(columnCount, row.length || columnCount)));
}

export function resizeSpriteTimeRow(value, rows, columns, rowIndex, frameCount, fillTime) {
  const columnCount = normalizeCount(columns, 1);
  const matrix = parseSpriteTimeRows(value, rows, columnCount);
  const safeRow = clampIndex(rowIndex, matrix.length);
  const safeCount = Math.max(0, Math.min(columnCount, Math.floor(Number(frameCount) || 0)));
  const fill = normalizeTimeCell(fillTime);
  const row = matrix[safeRow].slice(0, safeCount);
  while (row.length < safeCount) row.push(fill);
  matrix[safeRow] = row;
  return serializeSpriteTime(matrix);
}

export function applyDefaultTimeToRow(value, rows, columns, rowIndex, frameCount, fillTime) {
  const columnCount = normalizeCount(columns, 1);
  const matrix = parseSpriteTimeRows(value, rows, columnCount);
  const safeRow = clampIndex(rowIndex, matrix.length);
  const safeCount = Math.max(0, Math.min(columnCount, Math.floor(Number(frameCount) || 0)));
  const fill = normalizeTimeCell(fillTime);
  matrix[safeRow] = Array.from({ length: safeCount }, () => fill);
  return serializeSpriteTime(matrix);
}

export function getActiveFrameCountForRow(value, rows, columns, rowIndex) {
  const counts = deriveRowFrameCounts(value, rows, columns);
  return counts[clampIndex(rowIndex, counts.length)] || 1;
}

export function timeMatrixFromAnimations(asset = {}, grid = null, frameWidth = 16, frameHeight = 16) {
  const metrics = spriteSheetMetrics(asset);
  const resolvedGrid = grid || computeFrameGrid(metrics.width, metrics.height, frameWidth, frameHeight, metrics.cellWidth, metrics.cellHeight);
  const matrix = createTimeMatrix(resolvedGrid.rows, resolvedGrid.columns, '0');
  const counts = Array.from({ length: resolvedGrid.rows }, () => 0);
  const animations = Array.isArray(asset.options?.animations) ? asset.options.animations : [];
  animations.forEach((animation, index) => {
    const raw = animation && typeof animation === 'object' ? animation : {};
    const row = animationRowIndex(raw, index, metrics, resolvedGrid);
    if (row < 0 || row >= resolvedGrid.rows) return;
    const frameCount = clampInt(raw.frameCount, 1, resolvedGrid.columns, 1);
    const delay = String(clampInt(raw.frameDelay, 1, 60, 8));
    const frameDelays = Array.isArray(raw.frameDelays) ? raw.frameDelays : [];
    counts[row] = Math.max(counts[row] || 0, frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      matrix[row][frame] = String(clampInt(frameDelays[frame], 1, 60, Number(delay) || 8));
    }
  });
  return {
    time: serializeSpriteTime(matrix.map((row, rowIndex) => row.slice(0, Math.max(1, counts[rowIndex] || 1)))),
    rowFrameCounts: counts.map((count) => Math.max(1, count || 1)),
    rowDefaultTimes: matrix.map((row, rowIndex) => firstUsableTime(row.slice(0, Math.max(1, counts[rowIndex] || 1)), '4')),
  };
}

export function editorStateFromAsset(asset = {}, image = null) {
  const metrics = spriteSheetMetrics(asset, image);
  const metadata = asset.options?.spriteEditor && typeof asset.options.spriteEditor === 'object'
    ? asset.options.spriteEditor
    : {};
  const firstAnimation = Array.isArray(asset.options?.animations) ? asset.options.animations[0] : null;
  const frameWidth = snapToCell(
    metadata.frameWidth ?? firstAnimation?.frameWidth ?? metrics.width,
    metrics.cellWidth,
    firstAnimation?.frameWidth ?? metrics.width,
  );
  const frameHeight = snapToCell(
    metadata.frameHeight ?? firstAnimation?.frameHeight ?? metrics.height,
    metrics.cellHeight,
    firstAnimation?.frameHeight ?? metrics.height,
  );
  const grid = computeFrameGrid(metrics.width, metrics.height, frameWidth, frameHeight, metrics.cellWidth, metrics.cellHeight);
  const animationState = metadata.time
    ? {
        time: serializeSpriteTime(parseSpriteTime(metadata.time, grid.rows, grid.columns)),
        rowFrameCounts: normalizeRowCounts(metadata.rowFrameCounts, grid.rows, grid.columns, deriveRowFrameCounts(metadata.time, grid.rows, grid.columns)),
        rowDefaultTimes: normalizeDefaultTimes(metadata.rowDefaultTimes, grid.rows, '4'),
      }
    : timeMatrixFromAnimations(asset, grid, frameWidth, frameHeight);
  return {
    frameWidth,
    frameHeight,
    time: animationState.time,
    rowFrameCounts: normalizeRowCounts(animationState.rowFrameCounts, grid.rows, grid.columns),
    rowDefaultTimes: normalizeDefaultTimes(animationState.rowDefaultTimes, grid.rows, '4'),
    compression: normalizeCompressionOption(metadata.compression || asset.options?.compression, 'AUTO'),
    collision: normalizeOption(metadata.collision, ['NONE', 'CIRCLE', 'BOX'], 'NONE'),
    optType: normalizeOption(metadata.optType, ['BALANCED', 'SPRITE', 'TILE', 'NONE'], 'BALANCED'),
    optLevel: normalizeOption(metadata.optLevel, ['FAST', 'MEDIUM', 'SLOW', 'MAX'], 'FAST'),
    optDuplicate: normalizeOption(metadata.optDuplicate, ['FALSE', 'TRUE'], 'FALSE'),
    comment: String(metadata.comment || ''),
  };
}

export function buildAnimationsFromEditorState({
  asset = {},
  image = null,
  frameWidth,
  frameHeight,
  time,
  rowFrameCounts,
  rowDefaultTimes,
} = {}) {
  const metrics = spriteSheetMetrics(asset, image);
  const safeFrameWidth = snapToCell(frameWidth, metrics.cellWidth, metrics.width);
  const safeFrameHeight = snapToCell(frameHeight, metrics.cellHeight, metrics.height);
  const grid = computeFrameGrid(metrics.width, metrics.height, safeFrameWidth, safeFrameHeight, metrics.cellWidth, metrics.cellHeight);
  const matrix = parseSpriteTime(time, grid.rows, grid.columns);
  const counts = normalizeRowCounts(rowFrameCounts, grid.rows, grid.columns, deriveRowFrameCounts(time, grid.rows, grid.columns));
  const defaults = normalizeDefaultTimes(rowDefaultTimes, grid.rows, '4');
  const sheetCellColumns = Math.max(1, Math.floor(metrics.width / metrics.cellWidth));
  const frameWidthCells = Math.max(1, Math.ceil(safeFrameWidth / metrics.cellWidth));
  const frameHeightCells = Math.max(1, Math.ceil(safeFrameHeight / metrics.cellHeight));
  const animations = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const frameCount = clampInt(counts[row], 0, grid.columns, row === 0 ? 1 : 0);
    if (frameCount <= 0) continue;
    const rowTimes = (matrix[row] || []).slice(0, frameCount);
    const frameDelay = clampInt(firstUsableTime(rowTimes, defaults[row] || '4'), 1, 60, 4);
    // Per-frame display times: one entry per frame, falling back to the row's
    // representative delay when a cell is empty/zero. This is what lets each
    // frame run for its own duration instead of a single uniform delay.
    const frameDelays = Array.from({ length: frameCount }, (_, frameIndex) => {
      const value = clampInt(rowTimes[frameIndex], 1, 60, 0);
      return value > 0 ? value : frameDelay;
    });
    const firstCell = row * frameHeightCells * sheetCellColumns;
    if (firstCell >= metrics.totalCells) continue;
    animations.push({
      id: row === 0 ? 'default' : `row_${row}`,
      name: `ROW ${row}`,
      frameWidth: safeFrameWidth,
      frameHeight: safeFrameHeight,
      firstCell,
      frameCount,
      frameDelay,
      frameDelays,
      frameStrideCells: frameWidthCells,
      loop: true,
    });
  }
  return animations.length ? animations : [{
    id: 'default',
    name: 'ROW 0',
    frameWidth: safeFrameWidth,
    frameHeight: safeFrameHeight,
    firstCell: 0,
    frameCount: 1,
    frameDelay: 4,
    frameDelays: [4],
    frameStrideCells: frameWidthCells,
    loop: true,
  }];
}

function animationRowIndex(animation, index, metrics, grid) {
  const idMatch = String(animation.id || '').match(/(?:row_?|ROW\s*)(\d+)/i);
  if (idMatch) return clampInt(idMatch[1], 0, Math.max(0, grid.rows - 1), 0);
  if (index === 0) return 0;
  const frameHeightCells = Math.max(1, Math.ceil((animation.frameHeight || grid.height) / metrics.cellHeight));
  const sheetCellColumns = Math.max(1, Math.floor(metrics.width / metrics.cellWidth));
  const row = Math.floor((Number(animation.firstCell) || 0) / Math.max(1, frameHeightCells * sheetCellColumns));
  return clampInt(row, 0, Math.max(0, grid.rows - 1), 0);
}

function parseSpriteTimeRows(value, rows = 1, columns = 1) {
  const rowCount = normalizeCount(rows, 1);
  const columnCount = normalizeCount(columns, 1);
  const text = String(value == null ? '' : value).trim();
  if (!text || !text.startsWith('[')) {
    const fill = normalizeTimeCell(text || '0');
    return createTimeMatrix(rowCount, columnCount, fill);
  }
  const matches = Array.from(text.matchAll(/\[([^\[\]]*)\]/g)).map((match) => match[1]);
  const rowsText = matches.length > 0 ? matches : [text.replace(/^\[+|\]+$/g, '')];
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const rowText = rowsText[rowIndex];
    if (rowText == null) return createTimeRow(columnCount, '0');
    const values = rowText === '' ? [] : rowText.split(',').map((cell) => normalizeTimeCell(cell));
    return values.slice(0, columnCount);
  });
}

function normalizeRowCounts(value, rows, columns, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from({ length: normalizeCount(rows, 1) }, (_, index) => clampInt(source[index], 0, columns, index === 0 ? 1 : 0));
}

function normalizeDefaultTimes(value, rows, fallback = '4') {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: normalizeCount(rows, 1) }, (_, index) => normalizeTimeCell(source[index] ?? (fallback || '4')) || '4');
}

function firstUsableTime(row, fallback = '4') {
  const found = (Array.isArray(row) ? row : []).find((cell) => {
    const parsed = Number.parseInt(cell, 10);
    return Number.isFinite(parsed) && parsed > 0;
  });
  return found || fallback || '4';
}

function createTimeMatrix(rows, columns, fill) {
  return Array.from({ length: rows }, () => createTimeRow(columns, fill));
}

function createTimeRow(columns, fill) {
  return Array.from({ length: columns }, () => normalizeTimeCell(fill));
}

function normalizeTimeCell(value) {
  const text = String(value == null ? '' : value).trim();
  if (text === '') return '';
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(n);
}

function normalizeCount(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function clampIndex(value, length) {
  const max = Math.max(0, Number(length) - 1);
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

function normalizeOption(value, allowed, fallback) {
  const text = String(value || '').trim().toUpperCase();
  return allowed.includes(text) ? text : fallback;
}

function normalizeCompressionOption(value, fallback = 'AUTO') {
  const text = String(value || '').trim().toUpperCase();
  if (text === 'NONE') return 'NONE';
  if (['AUTO', 'BEST', 'FAST', 'APLIB', 'LZ4W', 'RLE'].includes(text)) return 'AUTO';
  return fallback;
}
