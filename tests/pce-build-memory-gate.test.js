'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

test('HuCARD ROM normalization pads 48 banks to a mapper-safe 512 KiB image', () => {
  const buildSystem = loadBuildSystem();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-hucard-rom-size-'));
  const romPath = path.join(dir, '384k.pce');
  const source = Buffer.alloc(48 * 8192, 0x5a);
  source[0] = 0x11;
  source[source.length - 1] = 0xa5;
  fs.writeFileSync(romPath, source);

  const result = buildSystem.normalizePceHuCardRomSize(romPath);
  const normalized = fs.readFileSync(romPath);

  assert.deepEqual(result, {
    inputSize: 48 * 8192,
    outputSize: 64 * 8192,
    paddingBytes: 16 * 8192,
    padded: true,
  });
  assert.equal(normalized.length, 512 * 1024);
  assert.equal(normalized[0], 0x11);
  assert.equal(normalized[source.length - 1], 0xa5);
  assert.ok(normalized.subarray(source.length).every((value) => value === 0xff));
});

test('HuCARD ROM normalization leaves an existing power-of-two image unchanged', () => {
  const buildSystem = loadBuildSystem();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-hucard-rom-size-'));
  const romPath = path.join(dir, '512k.pce');
  fs.writeFileSync(romPath, Buffer.alloc(512 * 1024, 0x3c));

  const result = buildSystem.normalizePceHuCardRomSize(romPath);

  assert.deepEqual(result, { inputSize: 512 * 1024, outputSize: 512 * 1024, paddingBytes: 0, padded: false });
  assert.equal(fs.statSync(romPath).size, 512 * 1024);
});

function bankOrigin(bank, address) {
  return 0x01000000 + (bank * 0x10000) + address;
}

function mapLine(vma, size, name, lma = vma) {
  return `${vma.toString(16)} ${lma.toString(16)} ${size.toString(16)} 1 ${name}`;
}

function validMapLines() {
  return [
    mapLine(bankOrigin(123, 0xc000), 0x2000, '.ram_bank123'),
    mapLine(bankOrigin(124, 0x8000), 0x0100, '.vn_logic_overlay'),
    mapLine(bankOrigin(128, 0x4000), 0x0100, '.text'),
    mapLine(bankOrigin(129, 0x6000), 0x0100, '.ram_bank129'),
    mapLine(bankOrigin(130, 0x8000), 0x0100, '.ram_bank130'),
    mapLine(bankOrigin(132, 0xc000), 0x0100, '.ram_bank132'),
    mapLine(0xd078, 0x0f60, '.ram_bank132_tail'),
    mapLine(bankOrigin(133, 0x8000), 0x0100, '.vn_overlay'),
    mapLine(bankOrigin(134, 0xc000), 0x2000, '.ram_bank134'),
    mapLine(bankOrigin(135, 0xc000), 0x2000, '.ram_bank135'),
    mapLine(0x01798000, 0x1fff, '.vn_visual_code'),
    mapLine(0x017a8000, 0x1fff, '.vn_cd_async_code'),
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
  assert.equal(report.usage[124], 256);
  assert.equal(report.usage[128], 256);
  assert.equal(report.usage[132], 8152);
  assert.equal(report.headroom[132], 3960);
  assert.equal(report.consoleUsed, 0x1200);
  assert.equal(report.consoleFree, 2026);
  assert.equal(report.zpEnd, 0x20e6);
  assert.match(buildSystem.formatPceCdVnLinkGate(report), /bank123 8192\/8192/);
  assert.match(buildSystem.formatPceCdVnLinkGate(report), /bank124 256\/8192/);
  assert.match(buildSystem.formatPceCdVnLinkGate(report), /bank132 8152\/8192 \(data gap 3960\)/);
  assert.equal(buildSystem.formatPceCdVnHeadroomWarning(report), '');
});

test('PCE-CD VN link gate warns before resident banks overflow', () => {
  const buildSystem = loadBuildSystem();
  const warning = buildSystem.formatPceCdVnHeadroomWarning({
    usage: { 124: 8182, 128: 8151, 129: 7971, 130: 8173, 132: 8152, 133: 7499 },
  });
  assert.match(warning, /256-byte warning threshold/);
  assert.match(warning, /bank124 free 10 bytes/);
  assert.match(warning, /bank128 free 41 bytes/);
  assert.match(warning, /bank129 free 221 bytes/);
  assert.match(warning, /bank130 free 19 bytes/);
  assert.match(warning, /bank132 free 40 bytes/);
  assert.doesNotMatch(warning, /bank133/);
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

test('PCE-CD VN link gate reserves 1024 bytes in every co-resident runtime bank and logic overlay', () => {
  const buildSystem = loadBuildSystem();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-link-gate-resident-headroom-'));
  let inputs = writeGateInputs(dir, validMapLines().map((line) => (
    line.endsWith(' .ram_bank129')
      ? mapLine(bankOrigin(129, 0x6000), 0x1c00, '.ram_bank129')
      : line
  )));
  assert.doesNotThrow(() => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath));

  inputs = writeGateInputs(dir, validMapLines().map((line) => (
    line.endsWith(' .ram_bank129')
      ? mapLine(bankOrigin(129, 0x6000), 0x1c01, '.ram_bank129')
      : line
  )));
  assert.equal(buildSystem.PCE_CD_VN_RESIDENT_BANK_MIN_FREE_BYTES, 1024);
  assert.equal(buildSystem.PCE_CD_VN_LOGIC_OVERLAY_MIN_FREE_BYTES, 1024);
  assert.throws(
    () => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath),
    /bank129 used 7169\/8192, free 1023 bytes, required 1024 bytes free/
  );

  inputs = writeGateInputs(dir, validMapLines().map((line) => (
    line.endsWith(' .vn_logic_overlay')
      ? mapLine(bankOrigin(124, 0x8000), 0x1c01, '.vn_logic_overlay')
      : line
  )));
  assert.throws(
    () => buildSystem.validatePceCdVnLinkMap(inputs.mapPath, inputs.elfPath),
    /bank124 \(.vn_logic_overlay\) used 7169\/8192, free 1023 bytes, required 1024 bytes free/
  );
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

const llvmMosBin = path.join(__dirname, '..', 'data', 'tools', 'llvm-mos-sdk', 'llvm-mos', 'bin');
const llvmMosClang = path.join(llvmMosBin, process.platform === 'win32' ? 'clang.exe' : 'clang');
const llvmMosPceCdCfg = path.join(llvmMosBin, 'mos-pce-cd.cfg');
const llvmMosObjcopy = path.join(llvmMosBin, process.platform === 'win32' ? 'llvm-objcopy.exe' : 'llvm-objcopy');

test('PCE-CD VN maximal rendering runtime with a large asset catalog links with reserved resident headroom', {
  skip: fs.existsSync(llvmMosClang) && fs.existsSync(llvmMosPceCdCfg) && fs.existsSync(llvmMosObjcopy)
    ? false
    : 'local llvm-mos PCE-CD toolchain is not installed',
}, () => {
  const buildSystem = loadBuildSystem();
  const sourceDir = path.join(__dirname, '..', 'template', 'template_pce_vn_cd');
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-max-runtime-link-'));
  fs.cpSync(sourceDir, projectDir, { recursive: true });

  const generatedHeaderPath = path.join(projectDir, 'src', 'generated', 'vn.h');
  const generatedHeader = fs.readFileSync(generatedHeaderPath, 'utf8')
    .replace('#define PCE_VN_HAS_FULL_SCREEN_BG 0u', '#define PCE_VN_HAS_FULL_SCREEN_BG 1u')
    .replace(/#define PCE_VN_VARIABLE_STORAGE_COUNT \d+u/, '#define PCE_VN_VARIABLE_STORAGE_COUNT 16u')
    .replace('#define PCE_VN_SPRITE_SLOT0_PATTERN_BASE 396u', '#define PCE_VN_SPRITE_SLOT0_PATTERN_BASE 384u')
    .replace('#define PCE_VN_SPRITE_SLOT0_PATTERN_CAPACITY 86u', '#define PCE_VN_SPRITE_SLOT0_PATTERN_CAPACITY 160u')
    .replace('#define PCE_VN_SPRITE_SLOT1_PATTERN_BASE 482u', '#define PCE_VN_SPRITE_SLOT1_PATTERN_BASE 544u')
    .replace('#define PCE_VN_SPRITE_SLOT1_PATTERN_CAPACITY 0u', '#define PCE_VN_SPRITE_SLOT1_PATTERN_CAPACITY 176u')
    .replace('#define PCE_VN_SPRITE_SLOT2_PATTERN_BASE 482u', '#define PCE_VN_SPRITE_SLOT2_PATTERN_BASE 720u')
    .replace('#define PCE_VN_SPRITE_SLOT2_PATTERN_CAPACITY 0u', '#define PCE_VN_SPRITE_SLOT2_PATTERN_CAPACITY 208u')
    .replace('#define PCE_VN_SPRITE_SLOT3_PATTERN_BASE 482u', '#define PCE_VN_SPRITE_SLOT3_PATTERN_BASE 928u');
  assert.match(generatedHeader, /#define PCE_VN_HAS_FULL_SCREEN_BG 1u/);
  assert.match(generatedHeader, /#define PCE_VN_HAS_SPRITE_ANIMATIONS 1u/);
  assert.match(generatedHeader, /#define PCE_VN_HAS_SPRITETEXT 1u/);
  assert.match(generatedHeader, /#define PCE_VN_SPRITE_SLOT2_PATTERN_CAPACITY 208u/);
  fs.writeFileSync(generatedHeaderPath, generatedHeader, 'utf8');

  const generatedAssetsPath = path.join(projectDir, 'src', 'generated', 'assets.c');
  const generatedAssets = fs.readFileSync(generatedAssetsPath, 'utf8')
    .replace(
      'const pce_editor_meta_region_t pce_editor_bg_meta PCE_EDITOR_RODATA_SECTION = { { 76u, 0u, 0u }, 3u };',
      'const pce_editor_meta_region_t pce_editor_bg_meta PCE_EDITOR_RODATA_SECTION = { { 76u, 0u, 0u }, 13u };'
    )
    .replace(
      'const pce_editor_meta_region_t pce_editor_sprite_meta PCE_EDITOR_RODATA_SECTION = { { 77u, 0u, 0u }, 2u };',
      'const pce_editor_meta_region_t pce_editor_sprite_meta PCE_EDITOR_RODATA_SECTION = { { 77u, 0u, 0u }, 18u };'
    )
    .replace(
      'const pce_editor_meta_region_t pce_editor_adpcm_meta PCE_EDITOR_RODATA_SECTION = { { 78u, 0u, 0u }, 3u };',
      'const pce_editor_meta_region_t pce_editor_adpcm_meta PCE_EDITOR_RODATA_SECTION = { { 82u, 0u, 0u }, 275u };'
    )
    .replace('const unsigned int pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = 3;', 'const unsigned int pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = 13;')
    .replace('const unsigned int pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = 2;', 'const unsigned int pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = 18;')
    .replace('const unsigned int pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = 3;', 'const unsigned int pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = 275;');
  assert.match(generatedAssets, /pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = 275;/);
  fs.writeFileSync(generatedAssetsPath, generatedAssets, 'utf8');

  const outDir = path.join(projectDir, 'out');
  const elfPath = path.join(outDir, 'max-runtime.elf');
  const mapPath = path.join(outDir, 'max-runtime.map');
  fs.mkdirSync(outDir, { recursive: true });
  const result = spawnSync(llvmMosClang, [
    '--config', llvmMosPceCdCfg,
    '-Oz',
    '-DPCE_EDITOR_TARGET_CD=1',
    `-Wl,-Map=${mapPath}`,
    `-Wl,-T,${path.join(projectDir, 'src', 'generated', 'overlay_insert.ld')}`,
    '-o', elfPath,
    path.join(projectDir, 'src', 'main.c'),
    path.join(projectDir, 'src', 'generated', 'assets.c'),
    path.join(projectDir, 'src', 'generated', 'vn.c'),
  ], { cwd: projectDir, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);

  const report = buildSystem.validatePceCdVnLinkMap(mapPath, elfPath);
  [124, 128, 129, 130].forEach((bank) => {
    const required = bank === 124
      ? buildSystem.PCE_CD_VN_LOGIC_OVERLAY_MIN_FREE_BYTES
      : buildSystem.PCE_CD_VN_RESIDENT_BANK_MIN_FREE_BYTES;
    assert.ok(
      0x2000 - report.usage[bank] >= required,
      `bank${bank} has only ${0x2000 - report.usage[bank]} free bytes`
    );
  });

  const strippedElfPath = path.join(outDir, 'max-runtime-stripped.elf');
  const stripResult = spawnSync(llvmMosObjcopy, [
    '--remove-section', '.rela.vn_logic_overlay', '--remove-section', '.vn_logic_overlay',
    '--remove-section', '.rela.vn_overlay', '--remove-section', '.vn_overlay',
    '--remove-section', '.rela.vn_visual_code', '--remove-section', '.vn_visual_code',
    '--remove-section', '.rela.vn_cd_async_code', '--remove-section', '.vn_cd_async_code',
    elfPath, strippedElfPath,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(stripResult.status, 0, `${stripResult.stdout || ''}\n${stripResult.stderr || ''}`);
  assert.ok(fs.statSync(strippedElfPath).size > 0);
});
