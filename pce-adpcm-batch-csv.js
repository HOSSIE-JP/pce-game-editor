'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const audioConverter = require('./pce-audio-converter');

const ADPCM_BATCH_HEADERS = Object.freeze([
  'source',
  'id',
  'name',
  'sampleRate',
  'loop',
  'splitPolicy',
]);
const ADPCM_BATCH_REQUIRED_HEADERS = Object.freeze(['source', 'id']);
const ADPCM_BATCH_SAMPLE_RATES = Object.freeze([4000, 4571, 5333, 6400, 8000, 10666, 16000, 32000]);
const ADPCM_BATCH_DEFAULT_SAMPLE_RATE = 8000;
const ADPCM_BATCH_MAX_BYTES = 32767;
const ADPCM_BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

function decodeUtf8Csv(buffer) {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return decoded.replace(/^\uFEFF/, '');
  } catch (_error) {
    throw new Error('CSV は UTF-8 または UTF-8 BOM で保存してください');
  }
}

function parseCsvRows(text = '') {
  const source = String(text || '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let lineNumber = 1;
  let rowLineNumber = 1;

  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((value) => String(value || '').trim() !== '')) {
      rows.push({ lineNumber: rowLineNumber, values: row });
    }
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
        if (char === '\n') lineNumber += 1;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new Error(`CSV ${lineNumber} 行目: 引用符の位置が不正です`);
      }
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      pushRow();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      lineNumber += 1;
      rowLineNumber = lineNumber;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error(`CSV ${rowLineNumber} 行目: 引用符が閉じられていません`);
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

function normalizeHeaders(values = []) {
  const canonicalByLower = new Map(ADPCM_BATCH_HEADERS.map((header) => [header.toLowerCase(), header]));
  const seen = new Set();
  const headers = values.map((value) => {
    const raw = String(value || '').trim();
    const canonical = canonicalByLower.get(raw.toLowerCase());
    if (!canonical) throw new Error(`CSV header "${raw || '(empty)'}" はサポートされていません`);
    if (seen.has(canonical)) throw new Error(`CSV header "${canonical}" が重複しています`);
    seen.add(canonical);
    return canonical;
  });
  for (const required of ADPCM_BATCH_REQUIRED_HEADERS) {
    if (!seen.has(required)) throw new Error(`CSV header "${required}" が必要です`);
  }
  return headers;
}

function parseLoop(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true' || normalized === '1') return true;
  throw new Error('loop は true / false / 1 / 0 のいずれかです');
}

function parseSampleRate(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return ADPCM_BATCH_DEFAULT_SAMPLE_RATE;
  const sampleRate = Number(normalized);
  if (!Number.isInteger(sampleRate) || !ADPCM_BATCH_SAMPLE_RATES.includes(sampleRate)) {
    throw new Error(`sampleRate は ${ADPCM_BATCH_SAMPLE_RATES.join(', ')} のいずれかです`);
  }
  return sampleRate;
}

function parseSplitPolicy(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'error') return 'error';
  throw new Error('splitPolicy は auto / error のいずれかです');
}

function addRowError(row, message) {
  const value = String(message || '').trim();
  if (value && !row.errors.includes(value)) row.errors.push(value);
  row.valid = false;
}

function inspectWavRow(row) {
  try {
    const wav = audioConverter.parseWav(fs.readFileSync(row.resolvedSourcePath));
    const frameCount = Math.max(1, Math.ceil(wav.durationSeconds * row.sampleRate));
    row.sourceSampleRate = wav.sampleRate;
    row.sourceChannels = wav.channels;
    row.durationSeconds = wav.durationSeconds;
    row.estimatedBytes = Math.ceil(frameCount / 2);
    row.estimatedPartCount = row.splitPolicy === 'auto'
      ? Math.max(1, Math.ceil(row.estimatedBytes / ADPCM_BATCH_MAX_BYTES))
      : 1;
    if (row.splitPolicy === 'error' && row.estimatedBytes > ADPCM_BATCH_MAX_BYTES) {
      addRowError(row, `推定 ${row.estimatedBytes} bytes が ADPCM 上限 ${ADPCM_BATCH_MAX_BYTES} bytes を超えます`);
    }
    if (row.splitPolicy === 'auto' && row.estimatedPartCount > 1) {
      row.warnings.push(`${row.estimatedPartCount} part に分割されます（自動連続再生はしません）`);
    }
  } catch (error) {
    addRowError(row, `WAV を読み込めません: ${error?.message || error}`);
  }
}

function inspectAdpcmBatchCsv(csvPath, existingAssets = []) {
  const absoluteCsvPath = path.resolve(String(csvPath || ''));
  if (!csvPath || !fs.existsSync(absoluteCsvPath) || !fs.statSync(absoluteCsvPath).isFile()) {
    throw new Error('ADPCM batch CSV が見つかりません');
  }
  if (path.extname(absoluteCsvPath).toLowerCase() !== '.csv') {
    throw new Error('ADPCM batch list は .csv ファイルを指定してください');
  }

  const parsedRows = parseCsvRows(decodeUtf8Csv(fs.readFileSync(absoluteCsvPath)));
  if (parsedRows.length === 0) throw new Error('CSV が空です');
  const headers = normalizeHeaders(parsedRows[0].values);
  const csvDir = path.dirname(absoluteCsvPath);
  const rows = parsedRows.slice(1).map((record, rowIndex) => {
    const values = {};
    headers.forEach((header, index) => {
      values[header] = String(record.values[index] ?? '').trim();
    });
    const row = {
      rowIndex,
      lineNumber: record.lineNumber,
      source: values.source || '',
      resolvedSourcePath: '',
      id: values.id || '',
      name: values.name || '',
      sampleRate: ADPCM_BATCH_DEFAULT_SAMPLE_RATE,
      loop: false,
      splitPolicy: 'auto',
      sourceSampleRate: 0,
      sourceChannels: 0,
      durationSeconds: 0,
      estimatedBytes: 0,
      estimatedPartCount: 0,
      outputIds: [],
      overwriteIds: [],
      warnings: [],
      errors: [],
      valid: true,
    };
    if (record.values.length > headers.length) {
      addRowError(row, '列数がheaderより多くなっています');
    }
    if (!row.source) {
      addRowError(row, 'source は必須です');
    } else {
      row.resolvedSourcePath = path.isAbsolute(row.source) ? path.resolve(row.source) : path.resolve(csvDir, row.source);
      if (path.extname(row.resolvedSourcePath).toLowerCase() !== '.wav') {
        addRowError(row, 'source は PCM WAV (.wav) を指定してください');
      } else if (!fs.existsSync(row.resolvedSourcePath) || !fs.statSync(row.resolvedSourcePath).isFile()) {
        addRowError(row, `source が見つかりません: ${row.source}`);
      }
    }
    if (!ADPCM_BATCH_ID_PATTERN.test(row.id)) {
      addRowError(row, 'id は英数字・_・-だけで1～48文字にしてください');
    }
    if (!row.name) row.name = path.basename(row.source || row.id, path.extname(row.source || '')) || row.id;
    try { row.sampleRate = parseSampleRate(values.sampleRate); } catch (error) { addRowError(row, error.message); }
    try { row.loop = parseLoop(values.loop); } catch (error) { addRowError(row, error.message); }
    try { row.splitPolicy = parseSplitPolicy(values.splitPolicy); } catch (error) { addRowError(row, error.message); }
    if (row.resolvedSourcePath && fs.existsSync(row.resolvedSourcePath)) inspectWavRow(row);
    if (row.id && row.estimatedPartCount > 0) {
      row.outputIds = row.estimatedPartCount > 1
        ? Array.from({ length: row.estimatedPartCount }, (_unused, index) => `${row.id}_part${String(index + 1).padStart(2, '0')}`)
        : [row.id];
      if (row.outputIds.some((outputId) => outputId.length > 48)) {
        addRowError(row, '自動分割後のasset idが48文字を超えるため、idを短くしてください');
      }
    }
    return row;
  });

  const baseIdRows = new Map();
  const outputIdRows = new Map();
  for (const row of rows) {
    if (ADPCM_BATCH_ID_PATTERN.test(row.id)) {
      if (!baseIdRows.has(row.id)) baseIdRows.set(row.id, []);
      baseIdRows.get(row.id).push(row);
    }
    for (const outputId of row.outputIds) {
      if (!outputIdRows.has(outputId)) outputIdRows.set(outputId, []);
      outputIdRows.get(outputId).push(row);
    }
  }
  for (const [id, matchingRows] of baseIdRows) {
    if (matchingRows.length > 1) matchingRows.forEach((row) => addRowError(row, `CSV 内で id "${id}" が重複しています`));
  }
  for (const [id, matchingRows] of outputIdRows) {
    if (matchingRows.length > 1) matchingRows.forEach((row) => addRowError(row, `分割後の asset id "${id}" がCSV内で衝突します`));
  }

  const existing = Array.isArray(existingAssets) ? existingAssets : [];
  for (const row of rows) {
    const related = existing.filter((asset) => (
      asset?.id === row.id
      || row.outputIds.includes(asset?.id)
      || String(asset?.data?.import?.groupId || '') === row.id
    ));
    const protectedAssets = related.filter((asset) => asset.type !== 'adpcm');
    if (protectedAssets.length > 0) {
      addRowError(row, `非ADPCM asset id と衝突します: ${protectedAssets.map((asset) => asset.id).join(', ')}`);
    }
    row.overwriteIds = related.filter((asset) => asset.type === 'adpcm').map((asset) => asset.id);
    if (row.overwriteIds.length > 0) row.warnings.push(`既存ADPCMを置換: ${row.overwriteIds.join(', ')}`);
  }

  const projectedAdpcmIds = new Set(existing.filter((asset) => asset.type === 'adpcm').map((asset) => asset.id));
  for (const row of rows.filter((entry) => entry.valid)) {
    for (const asset of existing) {
      if (asset.type === 'adpcm' && (asset.id === row.id || String(asset.data?.import?.groupId || '') === row.id)) {
        projectedAdpcmIds.delete(asset.id);
      }
    }
    row.overwriteIds.forEach((id) => projectedAdpcmIds.delete(id));
    row.outputIds.forEach((id) => projectedAdpcmIds.add(id));
  }
  const warnings = [];
  if (projectedAdpcmIds.size > 512) {
    warnings.push(`ADPCM asset は取込後 ${projectedAdpcmIds.size} 件です。CD VN の標準保証上限は参照される512件です`);
  }

  const validRows = rows.filter((row) => row.valid).length;
  return {
    csvPath: absoluteCsvPath,
    csvFileName: path.basename(absoluteCsvPath),
    headers,
    rows,
    warnings,
    summary: {
      totalRows: rows.length,
      validRows,
      invalidRows: rows.length - validRows,
      estimatedAssetCount: rows.filter((row) => row.valid).reduce((total, row) => total + row.outputIds.length, 0),
      projectedAdpcmCount: projectedAdpcmIds.size,
    },
  };
}

module.exports = {
  ADPCM_BATCH_DEFAULT_SAMPLE_RATE,
  ADPCM_BATCH_HEADERS,
  ADPCM_BATCH_ID_PATTERN,
  ADPCM_BATCH_MAX_BYTES,
  ADPCM_BATCH_SAMPLE_RATES,
  decodeUtf8Csv,
  inspectAdpcmBatchCsv,
  normalizeHeaders,
  parseCsvRows,
  parseLoop,
  parseSampleRate,
  parseSplitPolicy,
};
