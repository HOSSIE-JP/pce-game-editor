'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const audioConverter = require('../pce-audio-converter');

const REPO_ROOT = path.resolve(__dirname, '..');
const SAMPLE_ROOT = path.join(REPO_ROOT, 'samples', 'pce-adpcm-diagnostic');
const ASSET_ROOT = path.join(SAMPLE_ROOT, 'assets');
const SOURCE_ROOT = path.join(ASSET_ROOT, 'source');
const GENERATED_ROOT = path.join(ASSET_ROOT, 'generated');
const OUT_ROOT = path.join(SAMPLE_ROOT, 'out');

const SAMPLE_RATE = 16000;
const DURATION_SECONDS = 1;
const TEST_FREQUENCY_HZ = 1000;
const TEST_AMPLITUDE = 12000;
const ADPCM_ADDRESS = 0;
const ADPCM_DIVIDER = audioConverter.sampleRateToAdpcmDivider(SAMPLE_RATE);
const CD_SECTOR_BYTES = 2048;
const CD_DATA_BASE_SECTOR = 64;
const DIAGNOSTIC_PROGRAM_SECTORS = 2;
const ADPCM_BYTE_LENGTH = Math.ceil((SAMPLE_RATE * DURATION_SECONDS) / 2);
const ADPCM_SECTOR_COUNT = Math.ceil(ADPCM_BYTE_LENGTH / CD_SECTOR_BYTES);
const LSN_SECTOR = CD_DATA_BASE_SECTOR;
const MSN_SECTOR = LSN_SECTOR + ADPCM_SECTOR_COUNT;

const FILES = Object.freeze({
  sourceWav: path.join(SOURCE_ROOT, 'sine_1khz_16000.wav'),
  lsnAdpcm: path.join(GENERATED_ROOT, 'sine_1khz_16000_lsn', 'adpcm.bin'),
  msnAdpcm: path.join(GENERATED_ROOT, 'sine_1khz_16000_msn', 'adpcm.bin'),
  lsnDecodedWav: path.join(GENERATED_ROOT, 'sine_1khz_16000_lsn', 'decoded.wav'),
  msnDecodedWav: path.join(GENERATED_ROOT, 'sine_1khz_16000_msn', 'decoded.wav'),
  manifest: path.join(GENERATED_ROOT, 'manifest.json'),
  configHeader: path.join(SAMPLE_ROOT, 'src', 'adpcm_diag_config.h'),
});

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function relativeToSample(absPath) {
  return path.relative(SAMPLE_ROOT, absPath).replace(/\\/g, '/');
}

function writeFile(absPath, bytes) {
  ensureDir(path.dirname(absPath));
  fs.writeFileSync(absPath, bytes);
}

function makeSineRendered() {
  const frameCount = SAMPLE_RATE * DURATION_SECONDS;
  const pcm = Buffer.alloc(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const phase = (Math.PI * 2 * TEST_FREQUENCY_HZ * frame) / SAMPLE_RATE;
    const value = Math.round(Math.sin(phase) * TEST_AMPLITUDE);
    pcm.writeInt16LE(value, frame * 2);
  }
  return {
    sampleRate: SAMPLE_RATE,
    channels: 1,
    frameCount,
    pcm,
  };
}

function makeManifest() {
  return {
    purpose: 'PCE CD-ROM2 ADPCM playback diagnostic sample',
    codec: audioConverter.PCE_ADPCM_CODEC,
    encoderVersion: audioConverter.PCE_ADPCM_ENCODER_VERSION,
    sampleRate: SAMPLE_RATE,
    divider: ADPCM_DIVIDER,
    durationSeconds: DURATION_SECONDS,
    adpcmAddress: ADPCM_ADDRESS,
    byteLength: ADPCM_BYTE_LENGTH,
    sectorBytes: CD_SECTOR_BYTES,
    sectorCount: ADPCM_SECTOR_COUNT,
    dataBaseSector: CD_DATA_BASE_SECTOR,
    files: {
      sourceWav: relativeToSample(FILES.sourceWav),
      lowNibbleFirstAdpcm: relativeToSample(FILES.lsnAdpcm),
      highNibbleFirstAdpcm: relativeToSample(FILES.msnAdpcm),
      lowNibbleFirstDecodedWav: relativeToSample(FILES.lsnDecodedWav),
      highNibbleFirstDecodedWav: relativeToSample(FILES.msnDecodedWav),
    },
    cdLayout: [
      {
        id: 'sine_1khz_16000_lsn',
        codec: audioConverter.PCE_ADPCM_CODEC,
        encoderVersion: audioConverter.PCE_ADPCM_ENCODER_VERSION,
        nibbleOrder: 'lsn-first',
        sector: LSN_SECTOR,
        sectorCount: ADPCM_SECTOR_COUNT,
        byteLength: ADPCM_BYTE_LENGTH,
      },
      {
        id: 'sine_1khz_16000_msn',
        codec: audioConverter.PCE_ADPCM_CODEC,
        encoderVersion: audioConverter.PCE_ADPCM_ENCODER_VERSION,
        nibbleOrder: 'msn-first',
        sector: MSN_SECTOR,
        sectorCount: ADPCM_SECTOR_COUNT,
        byteLength: ADPCM_BYTE_LENGTH,
      },
    ],
    romControls: {
      I: 'buffered playback, high-nibble-first data',
      II: 'buffered playback, low-nibble-first data',
      RUN: 'CD streaming playback, high-nibble-first data',
      SELECT: 'stop ADPCM playback',
    },
  };
}

function makeConfigHeader() {
  return `#ifndef PCE_ADPCM_DIAG_CONFIG_H
#define PCE_ADPCM_DIAG_CONFIG_H

#define PCE_ADPCM_DIAG_SAMPLE_RATE ${SAMPLE_RATE}u
#define PCE_ADPCM_DIAG_DIVIDER ${ADPCM_DIVIDER}u
#define PCE_ADPCM_DIAG_ADDRESS ${ADPCM_ADDRESS}u
#define PCE_ADPCM_DIAG_BYTE_LENGTH ${ADPCM_BYTE_LENGTH}u
#define PCE_ADPCM_DIAG_SECTOR_COUNT ${ADPCM_SECTOR_COUNT}u
#define PCE_ADPCM_DIAG_LSN_SECTOR ${LSN_SECTOR}ul
#define PCE_ADPCM_DIAG_MSN_SECTOR ${MSN_SECTOR}ul

#endif
`;
}

function generateSamples() {
  const rendered = makeSineRendered();
  const sourceWav = audioConverter.writeWavPcm16(rendered);
  const lsnAdpcm = audioConverter.encodeOkiAdpcm(rendered, 0, rendered.frameCount, { nibbleOrder: 'lsn-first' });
  const msnAdpcm = audioConverter.encodeOkiAdpcm(rendered, 0, rendered.frameCount, { nibbleOrder: 'msn-first' });
  const lsnDecoded = audioConverter.decodeOkiAdpcm(lsnAdpcm, { sampleRate: SAMPLE_RATE, nibbleOrder: 'lsn-first' });
  const msnDecoded = audioConverter.decodeOkiAdpcm(msnAdpcm, { sampleRate: SAMPLE_RATE, nibbleOrder: 'msn-first' });

  writeFile(FILES.sourceWav, sourceWav);
  writeFile(FILES.lsnAdpcm, lsnAdpcm);
  writeFile(FILES.msnAdpcm, msnAdpcm);
  writeFile(FILES.lsnDecodedWav, audioConverter.writeWavPcm16(lsnDecoded));
  writeFile(FILES.msnDecodedWav, audioConverter.writeWavPcm16(msnDecoded));
  writeFile(FILES.manifest, `${JSON.stringify(makeManifest(), null, 2)}\n`);
  writeFile(FILES.configHeader, makeConfigHeader());

  return makeManifest();
}

function pcmMetrics(sourcePcm, decodedPcm) {
  const count = Math.min(Math.floor(sourcePcm.length / 2), Math.floor(decodedPcm.length / 2));
  let sourceSquares = 0;
  let decodedSquares = 0;
  let errorSquares = 0;
  let absError = 0;
  let dot = 0;
  for (let index = 0; index < count; index += 1) {
    const source = sourcePcm.readInt16LE(index * 2);
    const decoded = decodedPcm.readInt16LE(index * 2);
    const error = source - decoded;
    sourceSquares += source * source;
    decodedSquares += decoded * decoded;
    errorSquares += error * error;
    absError += Math.abs(error);
    dot += source * decoded;
  }
  const sourceRms = Math.sqrt(sourceSquares / Math.max(1, count));
  const decodedRms = Math.sqrt(decodedSquares / Math.max(1, count));
  const errorRms = Math.sqrt(errorSquares / Math.max(1, count));
  const correlationDenominator = Math.sqrt(sourceSquares * decodedSquares);
  const snrDb = errorRms ? 20 * Math.log10(sourceRms / errorRms) : 99;
  return {
    samples: count,
    sourceRms: roundMetric(sourceRms),
    decodedRms: roundMetric(decodedRms),
    errorRms: roundMetric(errorRms),
    meanAbsError: roundMetric(absError / Math.max(1, count)),
    snrDb: roundMetric(snrDb),
    correlation: roundMetric(correlationDenominator ? dot / correlationDenominator : 0, 6),
  };
}

function roundMetric(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function analyzeAdpcm(sourceWavPath, adpcmPath, sampleRate = SAMPLE_RATE) {
  const sourceWav = audioConverter.parseWav(fs.readFileSync(sourceWavPath));
  const rendered = audioConverter.renderPcm16(sourceWav, { sampleRate, channels: 1 });
  const adpcm = fs.readFileSync(adpcmPath);
  return {
    source: path.resolve(sourceWavPath),
    adpcm: path.resolve(adpcmPath),
    sampleRate,
    byteLength: adpcm.length,
    variants: [
      { codec: 'oki-msm5205', nibbleOrder: 'lsn-first', decode: audioConverter.decodeOkiAdpcm },
      { codec: 'oki-msm5205', nibbleOrder: 'msn-first', decode: audioConverter.decodeOkiAdpcm },
      { codec: audioConverter.PCE_ADPCM_EXPERIMENTAL_CODEC || 'pce-cd-adpcm-experimental', nibbleOrder: 'lsn-first', decode: audioConverter.decodePceAdpcm },
      { codec: audioConverter.PCE_ADPCM_EXPERIMENTAL_CODEC || 'pce-cd-adpcm-experimental', nibbleOrder: 'msn-first', decode: audioConverter.decodePceAdpcm },
    ].map((variant) => {
      const decoded = variant.decode(adpcm, { sampleRate, nibbleOrder: variant.nibbleOrder });
      return {
        codec: variant.codec,
        nibbleOrder: variant.nibbleOrder,
        ...pcmMetrics(rendered.pcm, decoded.pcm),
      };
    }),
  };
}

function printAnalysis(analysis) {
  console.log(`source: ${analysis.source}`);
  console.log(`adpcm : ${analysis.adpcm}`);
  console.log(`rate  : ${analysis.sampleRate} Hz, ${analysis.byteLength} bytes`);
  analysis.variants.forEach((variant) => {
    console.log(`${variant.codec} ${variant.nibbleOrder}: rmsError=${variant.errorRms}, snr=${variant.snrDb}dB, correlation=${variant.correlation}`);
  });
}

function toolPath(...parts) {
  return path.join(REPO_ROOT, 'data', 'tools', ...parts);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed with exit code ${result.status}`);
  }
}

function buildSampleIso() {
  generateSamples();
  ensureDir(OUT_ROOT);

  const clang = toolPath('llvm-mos-sdk', 'llvm-mos', 'bin', 'mos-pce-cd-clang');
  const mkcd = toolPath('llvm-mos-sdk', 'llvm-mos', 'bin', 'pce-mkcd');
  const ipl = process.env.PCE_CD_IPL_PATH || toolPath('pce-cd', 'ipl', 'ipl.bin');
  if (!fs.existsSync(clang)) throw new Error(`mos-pce-cd-clang not found: ${clang}`);
  if (!fs.existsSync(mkcd)) throw new Error(`pce-mkcd not found: ${mkcd}`);
  if (!fs.existsSync(ipl)) {
    throw new Error(`IPL not found. Set PCE_CD_IPL_PATH or place the user-owned IPL at ${ipl}`);
  }

  const elfPath = path.join(OUT_ROOT, 'pce-adpcm-diagnostic.elf');
  const isoPath = path.join(OUT_ROOT, 'pce-adpcm-diagnostic.iso');
  const cuePath = path.join(OUT_ROOT, 'pce-adpcm-diagnostic.cue');
  const paddingPath = path.join(OUT_ROOT, 'pce_cd_data_padding.bin');

  runChecked(clang, ['-Os', '-DPCE_EDITOR_TARGET_CD=1', '-o', elfPath, path.join(SAMPLE_ROOT, 'src', 'main.c')], { cwd: SAMPLE_ROOT });

  const paddingSectors = CD_DATA_BASE_SECTOR - 1 - DIAGNOSTIC_PROGRAM_SECTORS;
  if (paddingSectors < 0) {
    throw new Error(`diagnostic program occupies ${DIAGNOSTIC_PROGRAM_SECTORS} sectors; data base sector ${CD_DATA_BASE_SECTOR} is too early`);
  }
  writeFile(paddingPath, Buffer.alloc(paddingSectors * CD_SECTOR_BYTES));

  runChecked(mkcd, ['--ipl', ipl, isoPath, elfPath, paddingPath, FILES.lsnAdpcm, FILES.msnAdpcm], { cwd: SAMPLE_ROOT });
  writeFile(cuePath, `FILE "${path.basename(isoPath)}" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n`);
  return { elfPath, isoPath, cuePath };
}

function parseSampleRate(value) {
  const parsed = Math.trunc(Number(value) || SAMPLE_RATE);
  return Math.max(audioConverter.PCE_ADPCM_MIN_SAMPLE_RATE, Math.min(audioConverter.PCE_ADPCM_MAX_SAMPLE_RATE, parsed));
}

function main(argv) {
  const args = argv.slice(2);
  const command = args[0] || 'generate';
  const json = args.includes('--json');
  if (command === 'generate') {
    const manifest = generateSamples();
    if (json) console.log(JSON.stringify(manifest, null, 2));
    else console.log(`generated ${relativeToSample(FILES.manifest)}`);
    return;
  }
  if (command === 'analyze') {
    if (!fs.existsSync(FILES.sourceWav) || !fs.existsSync(FILES.lsnAdpcm)) generateSamples();
    const source = args[1] && args[1] !== '--json' ? args[1] : FILES.sourceWav;
    const adpcm = args[2] && args[2] !== '--json' ? args[2] : FILES.lsnAdpcm;
    const rate = parseSampleRate(args[3]);
    const analysis = analyzeAdpcm(source, adpcm, rate);
    if (json) console.log(JSON.stringify(analysis, null, 2));
    else printAnalysis(analysis);
    return;
  }
  if (command === 'verify') {
    generateSamples();
    const lsn = analyzeAdpcm(FILES.sourceWav, FILES.lsnAdpcm, SAMPLE_RATE);
    const msn = analyzeAdpcm(FILES.sourceWav, FILES.msnAdpcm, SAMPLE_RATE);
    const result = { lsn, msn };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      printAnalysis(lsn);
      printAnalysis(msn);
    }
    return;
  }
  if (command === 'build') {
    const built = buildSampleIso();
    if (json) console.log(JSON.stringify(built, null, 2));
    else console.log(`built ${built.isoPath}`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  ADPCM_BYTE_LENGTH,
  ADPCM_DIVIDER,
  ADPCM_SECTOR_COUNT,
  CD_DATA_BASE_SECTOR,
  FILES,
  LSN_SECTOR,
  MSN_SECTOR,
  SAMPLE_RATE,
  analyzeAdpcm,
  buildSampleIso,
  generateSamples,
};
