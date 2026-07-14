'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadBuildSystem() {
  const electronPath = require.resolve('electron');
  const previous = require.cache[electronPath];
  require.cache[electronPath] = { exports: { app: { getPath: () => os.tmpdir() } } };
  const modulePath = require.resolve('../pce-build-system');
  delete require.cache[modulePath];
  const result = require('../pce-build-system');
  if (previous) require.cache[electronPath] = previous;
  else delete require.cache[electronPath];
  return result;
}

function bankOrigin(bank, address) {
  return 0x01000000 + (bank * 0x10000) + address;
}

function mapLine(vma, size, name, lma = vma) {
  return `${vma.toString(16)} ${lma.toString(16)} ${size.toString(16)} 1 ${name}`;
}

function validMapLines() {
  return [
    mapLine(bankOrigin(123, 0xc000), 0x2000, '.ram_bank123'),
    mapLine(bankOrigin(128, 0x4000), 0x0100, '.text'),
    mapLine(bankOrigin(129, 0x6000), 0x0100, '.ram_bank129'),
    mapLine(bankOrigin(130, 0x8000), 0x0100, '.ram_bank130'),
    mapLine(bankOrigin(132, 0xc000), 0x0100, '.ram_bank132'),
    mapLine(bankOrigin(133, 0x8000), 0x0100, '.vn_overlay'),
    mapLine(bankOrigin(134, 0xc000), 0x2000, '.ram_bank134'),
    mapLine(bankOrigin(135, 0xc000), 0x2000, '.ram_bank135'),
    mapLine(0x01818000, 0x1fff, '.vn_visual_code'),
    mapLine(0x01828000, 0x1fff, '.vn_cd_async_code'),
    mapLine(0x2616, 0x1200, '.bss'),
    mapLine(0x2020, 0x00c6, '.zp.bss'),
  ];
}

function minimalElf(sectionTypes = {}) {
  const names = ['', '.shstrtab', '.ram_bank123', '.ram_bank134', '.ram_bank135'];
  const offsets = [];
  const strings = [0];
  names.slice(1).forEach((name) => {
    offsets.push(strings.length);
    strings.push(...Buffer.from(name, 'ascii'), 0);
  });
  const sectionCount = names.length;
  const sectionOffset = 52;
  const entrySize = 40;
  const stringOffset = sectionOffset + (sectionCount * entrySize);
  const data = Buffer.alloc(stringOffset + strings.length);
  data[0] = 0x7f;
  data.write('ELF', 1, 'ascii');
  data[4] = 1;
  data[5] = 1;
  data.writeUInt32LE(sectionOffset, 0x20);
  data.writeUInt16LE(entrySize, 0x2e);
  data.writeUInt16LE(sectionCount, 0x30);
  data.writeUInt16LE(1, 0x32);
  const writeSection = (index, nameOffset, type, address, offset, size) => {
    const base = sectionOffset + (index * entrySize);
    data.writeUInt32LE(nameOffset, base);
    data.writeUInt32LE(type, base + 4);
    data.writeUInt32LE(address >>> 0, base + 12);
    data.writeUInt32LE(offset >>> 0, base + 16);
    data.writeUInt32LE(size >>> 0, base + 20);
  };
  writeSection(1, offsets[0], 3, 0, stringOffset, strings.length);
  writeSection(2, offsets[1], sectionTypes['.ram_bank123'] ?? 8, bankOrigin(123, 0xc000), 0, 0x2000);
  writeSection(3, offsets[2], sectionTypes['.ram_bank134'] ?? 8, bankOrigin(134, 0xc000), 0, 0x2000);
  writeSection(4, offsets[3], sectionTypes['.ram_bank135'] ?? 8, bankOrigin(135, 0xc000), 0, 0x2000);
  Buffer.from(strings).copy(data, stringOffset);
  return data;
}

function writeGateInputs(dir, lines = validMapLines(), elf = minimalElf()) {
  const mapPath = path.join(dir, 'game.map');
  const elfPath = path.join(dir, 'game.elf');
  fs.writeFileSync(mapPath, `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(elfPath, elf);
  return { mapPath, elfPath };
}

test('PCE-CD VN link gate accepts exact scene/console/ZP boundaries and NOLOAD banks', () => {
  const buildSystem = loadBuildSystem();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-link-gate-'));
  const { mapPath, elfPath } = writeGateInputs(dir);
  const report = buildSystem.validatePceCdVnLinkMap(mapPath, elfPath);
  assert.equal(report.usage[123], 8192);
  assert.equal(report.usage[128], 256);
  assert.equal(report.consoleUsed, 0x1200);
  assert.equal(report.consoleFree, 2026);
  assert.equal(report.zpEnd, 0x20e6);
  assert.match(buildSystem.formatPceCdVnLinkGate(report), /bank123 8192\/8192/);
});

test('PCE-CD VN link gate rejects bank overflow, missing reservations, and loadable reserved banks', () => {
  const buildSystem = loadBuildSystem();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-link-gate-bank-'));
  let inputs = writeGateInputs(dir, validMapLines().map((line) => (
    line.endsWith(' .text') ? mapLine(bankOrigin(128, 0x4000), 0x2000, '.text') : line
  )));
  assert.throws(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath), /bank128 usage 8192\/8192 must be below/);

  inputs = writeGateInputs(dir, validMapLines().map((line) => (
    line.endsWith(' .ram_bank123') ? mapLine(bankOrigin(123, 0xc000), 0x1fff, '.ram_bank123') : line
  )));
  assert.throws(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath), /bank123 reservation 8191\/8192 must equal/);

  inputs = writeGateInputs(dir, validMapLines(), minimalElf({ '.ram_bank134': 1 }));
  assert.throws(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath), /.ram_bank134 must be an ELF SHT_NOBITS\/NOLOAD/);
});

test('PCE-CD VN link gate rejects console margin, ZP end, and overlay helper size', () => {
  const buildSystem = loadBuildSystem();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-link-gate-ram-'));
  const mutate = (name, size) => validMapLines().map((line) => (
    line.endsWith(` ${name}`) ? mapLine(parseInt(line.split(' ')[0], 16), size, name) : line
  ));

  let inputs = writeGateInputs(dir, mutate('.bss', 0x1201));
  assert.throws(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath), /app console RAM 4609 exceeds 4608.*margin 2025 is below 2026/);

  inputs = writeGateInputs(dir, mutate('.zp.bss', 0x00c7));
  assert.throws(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath), /ZP end \$20e7 exceeds \$20e6/);

  inputs = writeGateInputs(dir, mutate('.vn_visual_code', 0x2000));
  assert.throws(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath), /.vn_visual_code 8192\/8192 must be below/);
});
