'use strict';

const fs = require('node:fs');
const path = require('node:path');

function makeCdWarningWav(sectors = 1) {
  const dataSize = Math.max(1, sectors) * 2352;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(44100 * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function addCdWarningAudio(projectDir, sectors = 1) {
  const source = 'assets/cdda/cdda_warning.wav';
  const outputFile = 'assets/generated/cdda_warning/cdda.wav';
  const wav = makeCdWarningWav(sectors);
  fs.mkdirSync(path.join(projectDir, path.dirname(source)), { recursive: true });
  fs.mkdirSync(path.join(projectDir, path.dirname(outputFile)), { recursive: true });
  fs.writeFileSync(path.join(projectDir, source), wav);
  fs.writeFileSync(path.join(projectDir, outputFile), wav);
  const assetPath = path.join(projectDir, 'assets', 'pce-assets.json');
  const doc = fs.existsSync(assetPath)
    ? JSON.parse(fs.readFileSync(assetPath, 'utf-8'))
    : { version: 2, assets: [] };
  doc.assets = (doc.assets || []).filter((asset) => asset.type !== 'cdda-warning');
  doc.assets.unshift({
    id: 'cdda_warning',
    type: 'cdda-warning',
    name: 'Warning Audio',
    source,
    data: {
      generated: {
        outputFile,
        sampleRate: 44100,
        channels: 2,
        durationSeconds: Math.max(1, sectors) / 75,
        byteLength: wav.length,
      },
    },
  });
  fs.writeFileSync(assetPath, JSON.stringify(doc, null, 2), 'utf-8');
  return { source, outputFile };
}

module.exports = { addCdWarningAudio, makeCdWarningWav };
