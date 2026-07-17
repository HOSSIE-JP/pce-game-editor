'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeWorkspaceTempDir(prefix) {
  const root = path.join(__dirname, '..', 'node_modules', '.pce-vn-test-tmp');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, prefix));
}

function loadVnManager(userData = makeTempDir('pce-vn-user-data-')) {
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-vn-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-vn-manager.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-vn-home-') },
  });
}

function loadPceBuildSystem(userData = makeTempDir('pce-vn-build-user-data-')) {
  delete require.cache[require.resolve('../pce-build-system')];
  delete require.cache[require.resolve('../pce-asset-manager')];
  delete require.cache[require.resolve('../pce-vn-manager')];
  delete require.cache[require.resolve('../pce-vn-hucard-manager')];
  delete require.cache[require.resolve('../pce-setup-manager')];
  return loadWithMockedElectron(path.join(__dirname, '..', 'pce-build-system.js'), {
    userData,
    paths: { userData, home: makeTempDir('pce-vn-build-home-') },
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function u16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function s16(buffer, offset) {
  return buffer.readInt16LE(offset);
}

function commandRecord(buffer, index) {
  const table = u16(buffer, 10);
  const offset = table + (index * 19);
  return {
    type: buffer[offset],
    assetIndex: s16(buffer, offset + 1),
    slot: buffer[offset + 3],
    flags: buffer[offset + 4],
    arg0: buffer[offset + 5],
    arg1: buffer[offset + 6],
    x: u16(buffer, offset + 7),
    y: u16(buffer, offset + 9),
    messageIndex: s16(buffer, offset + 11),
    animationIndex: s16(buffer, offset + 13),
    sceneIndex: s16(buffer, offset + 15),
    choiceIndex: s16(buffer, offset + 17),
  };
}

function messageRecord(buffer, index) {
  const table = u16(buffer, 12);
  const offset = table + (index * 13);
  const mouthSlotInfo = buffer[offset + 10];
  return {
    glyphOffset: u16(buffer, offset),
    glyphCount: buffer[offset + 2],
    voiceIndex: s16(buffer, offset + 3),
    textSpeedFrames: buffer[offset + 5],
    advanceMode: buffer[offset + 6],
    autoWaitFrames: buffer[offset + 7],
    mouthAnimationIndex: s16(buffer, offset + 8),
    mouthSlot: mouthSlotInfo & 0x03,
    instantGlyphCount: mouthSlotInfo >> 2,
    textColor: u16(buffer, offset + 11),
  };
}

function choiceRecord(buffer, index) {
  const table = u16(buffer, 14);
  const offset = table + (index * 6);
  return {
    optionOffset: u16(buffer, offset),
    optionCount: buffer[offset + 2],
    defaultIndex: buffer[offset + 3],
    variableIndex: s16(buffer, offset + 4),
  };
}

function choiceOptionRecord(buffer, choice, index) {
  const offset = choice.optionOffset + (index * 7);
  return {
    glyphOffset: u16(buffer, offset),
    glyphCount: buffer[offset + 2],
    value: s16(buffer, offset + 3),
    targetScene: s16(buffer, offset + 5),
  };
}

function switchRecord(buffer, index) {
  const table = u16(buffer, 16);
  const offset = table + (index * 5);
  return {
    caseOffset: u16(buffer, offset),
    caseCount: buffer[offset + 2],
    defaultCommand: u16(buffer, offset + 3),
  };
}

function switchCaseRecord(buffer, branch, index) {
  const offset = branch.caseOffset + (index * 4);
  return {
    value: s16(buffer, offset),
    command: u16(buffer, offset + 2),
  };
}

function readPack(projectDir, relativePath) {
  return fs.readFileSync(path.join(projectDir, relativePath));
}

// Phase A module split: pce_vn_runtime.c is an umbrella that #includes the
// vn_*.c / vn_*.h modules, so runtime content pins grep the concatenation of
// the umbrella plus every included module (in include order, mirroring the
// unity translation unit the compiler sees).
const TEMPLATE_VN_SRC_DIR = path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src');
function readRuntimeSource() {
  const umbrella = fs.readFileSync(path.join(TEMPLATE_VN_SRC_DIR, 'pce_vn_runtime.c'), 'utf-8');
  const parts = [umbrella];
  const includeRe = /^#include "(vn_[^"]+)"/gm;
  let match;
  while ((match = includeRe.exec(umbrella)) !== null) {
    parts.push(fs.readFileSync(path.join(TEMPLATE_VN_SRC_DIR, match[1]), 'utf-8'));
  }
  return parts.join('\n');
}

function writeElf32ProgramHeaders(filePath, headers) {
  const headerSize = 52;
  const phSize = 32;
  const buffer = Buffer.alloc(headerSize + (headers.length * phSize));
  buffer.writeUInt8(0x7f, 0);
  buffer.write('ELF', 1, 'ascii');
  buffer.writeUInt8(1, 4); // ELFCLASS32
  buffer.writeUInt8(1, 5); // little endian
  buffer.writeUInt8(1, 6);
  buffer.writeUInt16LE(2, 16);
  buffer.writeUInt16LE(0x6502, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeUInt32LE(headerSize, 28);
  buffer.writeUInt16LE(headerSize, 40);
  buffer.writeUInt16LE(phSize, 42);
  buffer.writeUInt16LE(headers.length, 44);
  headers.forEach((header, index) => {
    const offset = headerSize + (index * phSize);
    buffer.writeUInt32LE(header.type, offset);
    buffer.writeUInt32LE(header.offset || 0, offset + 4);
    buffer.writeUInt32LE(header.vaddr, offset + 8);
    buffer.writeUInt32LE(header.paddr, offset + 12);
    buffer.writeUInt32LE(header.filesz || 0, offset + 16);
    buffer.writeUInt32LE(header.memsz || header.filesz || 0, offset + 20);
    buffer.writeUInt32LE(header.flags || 0, offset + 24);
    buffer.writeUInt32LE(header.align || 1, offset + 28);
  });
  fs.writeFileSync(filePath, buffer);
}

function readElf32ProgramHeaders(filePath) {
  const buffer = fs.readFileSync(filePath);
  const phoff = buffer.readUInt32LE(28);
  const phentsize = buffer.readUInt16LE(42);
  const phnum = buffer.readUInt16LE(44);
  const headers = [];
  for (let i = 0; i < phnum; i++) {
    const offset = phoff + (i * phentsize);
    headers.push({
      type: buffer.readUInt32LE(offset),
      vaddr: buffer.readUInt32LE(offset + 8),
      paddr: buffer.readUInt32LE(offset + 12),
      filesz: buffer.readUInt32LE(offset + 16),
      memsz: buffer.readUInt32LE(offset + 20),
      flags: buffer.readUInt32LE(offset + 24),
    });
  }
  return headers;
}

test('PCE VN manager removes visual cache helper PT_LOAD from final ELF', () => {
  const projectDir = makeTempDir('pce-vn-elf-ph-');
  const elfPath = path.join(projectDir, 'main.elf');
  const vnManager = loadVnManager();
  writeElf32ProgramHeaders(elfPath, [
    { type: 1, vaddr: 0x1804000, paddr: 0x1804000, filesz: 4096, flags: 5 },
    { type: 1, vaddr: 0x1798000, paddr: 0x1798000, filesz: 5312, flags: 5 },
    { type: 1, vaddr: 0x8000, paddr: 0x184d078, filesz: 3964, flags: 5 },
  ]);

  const patched = vnManager.neutralizeElfLoadSegments(elfPath, 0x1798000, 8192);
  const headers = readElf32ProgramHeaders(elfPath);

  assert.equal(patched, 1);
  assert.deepEqual(headers[0], { type: 1, vaddr: 0x1804000, paddr: 0x1804000, filesz: 4096, memsz: 4096, flags: 5 });
  assert.deepEqual(headers[1], { type: 0, vaddr: 0x1798000, paddr: 0x1798000, filesz: 0, memsz: 0, flags: 0 });
  assert.deepEqual(headers[2], { type: 1, vaddr: 0x8000, paddr: 0x184d078, filesz: 3964, memsz: 3964, flags: 5 });
});

test('PCE VN manager normalizes scene references and emits CD build patch', () => {
  const projectDir = makeTempDir('pce-vn-project-');
  const vnManager = loadVnManager();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'voice'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'track'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'track', 'cdda.wav'), Buffer.from('RIFF'));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'bg', type: 'image', source: 'assets/images/bg.png' },
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: {
          width: 64,
          height: 32,
          cellWidth: 16,
          cellHeight: 16,
          animations: [
            { id: 'default', frameWidth: 32, frameHeight: 32, firstCell: 0, frameCount: 1, frameDelay: 8, frameStrideCells: 2 },
            { id: 'mouth', frameWidth: 32, frameHeight: 32, firstCell: 2, frameCount: 2, frameDelay: 4, frameStrideCells: 2 },
          ],
        },
      },
      { id: 'voice', type: 'adpcm', source: 'assets/adpcm/voice.wav', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } } },
      { id: 'track', type: 'cdda-track', source: 'assets/cdda/track.wav', options: { track: 2 }, data: { generated: { outputFile: 'assets/generated/track/cdda.wav' } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      name: 'Chapter 1 / Opening',
      commands: [
        { type: 'background', assetId: 'bg' },
        { type: 'sprite', assetId: 'hero', x: 500, y: -10 },
        { type: 'sprite', assetId: 'hero' },
        { type: 'audio', kind: 'cdda', action: 'play', assetId: 'track' },
        { type: 'message', text: 'こんにちは', voiceAssetId: 'voice', textSpeedFrames: 3, mouthAnimationId: 'mouth' },
      ],
      nextSceneId: 'missing',
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.settings, {
    messageSpeedFrames: vnManager.VN_DEFAULT_MESSAGE_SPEED_FRAMES,
    messageAdvanceMode: 'button',
    messageAutoWaitFrames: vnManager.VN_DEFAULT_MESSAGE_AUTO_WAIT_FRAMES,
  });
  assert.equal(normalized.scenes[0].name, 'Chapter 1/Opening');
  assert.equal(normalized.scenes[0].commands[0].type, 'background');
  assert.equal(normalized.scenes[0].commands[0].transition, 'fade');
  assert.equal(normalized.scenes[0].commands[0].fadeOutFrames, vnManager.VN_BG_DEFAULT_FADE_FRAMES);
  assert.equal(normalized.scenes[0].commands[0].fadeInFrames, vnManager.VN_BG_DEFAULT_FADE_FRAMES);
  assert.equal(normalized.scenes[0].commands[0].x, vnManager.VN_BG_DEFAULT_TILE_X);
  assert.equal(normalized.scenes[0].commands[0].y, vnManager.VN_BG_DEFAULT_TILE_Y);
  assert.equal(normalized.scenes[0].commands[1].type, 'sprite');
  assert.equal(normalized.scenes[0].commands[1].x, 319);
  assert.equal(normalized.scenes[0].commands[1].y, 0);
  assert.equal(normalized.scenes[0].commands[2].x, 96);
  assert.equal(normalized.scenes[0].commands[2].y, 24);
  assert.equal(normalized.scenes[0].commands[3].type, 'audio');
  assert.equal(normalized.scenes[0].commands[4].textSpeedFrames, undefined);
  assert.equal(normalized.scenes[0].commands[4].advanceMode, undefined);
  assert.equal(normalized.scenes[0].nextSceneId, '');
  const legacyOnly = vnManager.normalizeSceneDocument({
    version: 1,
    scenes: [{
      id: 'legacy',
      backgroundAssetId: 'bg',
      characters: [{ assetId: 'hero' }],
      messages: [{ text: 'legacy message', voiceAssetId: 'voice' }],
      bgmAssetId: 'track',
    }],
  }, {
    assets: [
      { id: 'bg', type: 'image' },
      { id: 'hero', type: 'sprite' },
      { id: 'voice', type: 'adpcm' },
      { id: 'track', type: 'cdda-track' },
    ],
  });
  assert.deepEqual(legacyOnly.scenes[0].commands, []);

  const prepared = vnManager.prepareVisualNovelBuild(projectDir, { cd: { dataFiles: [] } });
  assert.equal(prepared.configPatch.targetMedia, 'cd');
  assert.equal(prepared.configPatch.toolchain, 'llvm-mos');
  assert.equal(prepared.configPatch.cd.systemCardProfile, 'jp-v3');
  assert.deepEqual(prepared.configPatch.cd.dataFiles, [
    'assets/generated/vn/overlay.bin',
    'assets/generated/vn/visual_code.bin',
    'assets/generated/vn/cd_async_code.bin',
    'assets/generated/vn/scenes/000_opening.bin',
    'assets/generated/voice/adpcm.bin',
  ]);
  assert.deepEqual(prepared.configPatch.cd.cddaTracks, ['assets/generated/track/cdda.wav']);
  assert.equal(prepared.generated.sceneCount, 1);
  assert.equal(prepared.generated.commandCount, 6);
  assert.equal(prepared.generated.messageCount, 1);
  assert.deepEqual(prepared.generated.scenePackPaths, ['assets/generated/vn/scenes/000_opening.bin']);
  assert.equal(prepared.generated.spriteAnimationCount, 2);
  const header = fs.readFileSync(prepared.generated.headerPath, 'utf-8');
  const source = fs.readFileSync(prepared.generated.sourcePath, 'utf-8');
  const pack = readPack(projectDir, prepared.generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_FONT_TILE_BASE 540u/);
  assert.match(header, /void pce_vn_data_map\(void\);/);
  assert.doesNotMatch(header, /pce_vn_font_data|pce_vn_font_sprite_data/);
  assert.match(header, /PCE_VN_COMMAND_BACKGROUND 0u/);
  assert.doesNotMatch(header, /PCE_VN_COMMAND_PRELOAD/);
  assert.match(header, /PCE_VN_COMMAND_CHOICE 4u/);
  assert.match(header, /PCE_VN_SCENE_PACK_CACHE_BYTES 8192u/);
  assert.match(header, /PCE_VN_SCENE_PACK_VERSION 2u/);
  assert.match(header, /typedef struct \{\n  pce_vn_cd_sector_t sector;/);
  assert.match(header, /pce_vn_command_t/);
  assert.match(source, /PCE_RAM_BANK_AT\(132, 6\);/);
  assert.match(header, /typedef struct \{[\s\S]*?\} pce_vn_cd_data_ref_t;/);
  assert.doesNotMatch(header, /PCE_VN_GLYPH_ESCAPE|pce_vn_font_data|pce_vn_font_glyph_count/);
  assert.doesNotMatch(source, /pce_vn_font_data|pce_vn_font_glyph_count/);
  // Overlay code (bank133, time-shared into MPR slot 4) is streamed from CD. The
  // ref + load addr are always emitted; the blob's CD footprint is reserved at a
  // fixed size (4 sectors = full physical bank133) up front, so the ref always
  // points at a real sector.
  assert.match(header, /#define PCE_VN_OVERLAY_LOAD_ADDR 32768u/);
  assert.match(header, /extern const pce_vn_cd_data_ref_t pce_vn_overlay_data;/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_overlay_data = \{ \{ 64u, 0u, 0u \}, 4u, 8192u \};/);
  assert.match(header, /#define PCE_VN_VISUAL_CODE_LOAD_ADDR 32768u/);
  assert.match(header, /extern const pce_vn_cd_data_ref_t pce_vn_visual_code_data;/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_visual_code_data = \{ \{ 68u, 0u, 0u \}, 4u, 8192u \};/);
  assert.match(header, /#define PCE_VN_CD_ASYNC_CODE_LOAD_ADDR 32768u/);
  assert.match(header, /extern const pce_vn_cd_data_ref_t pce_vn_cd_async_code_data;/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_cd_async_code_data = \{ \{ 72u, 0u, 0u \}, 4u, 8192u \};/);
  // The reserved overlay blob exists on disk at exactly its reserved size, and
  // the linker fragment that places .vn_overlay / .vn_visual_code /
  // .vn_cd_async_code was written.
  assert.equal(fs.statSync(path.join(projectDir, 'assets', 'generated', 'vn', 'overlay.bin')).size, 8192);
  assert.equal(fs.statSync(path.join(projectDir, 'assets', 'generated', 'vn', 'visual_code.bin')).size, 8192);
  assert.equal(fs.statSync(path.join(projectDir, 'assets', 'generated', 'vn', 'cd_async_code.bin')).size, 8192);
  const overlayFragment = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'overlay_insert.ld'), 'utf-8');
  assert.match(overlayFragment, /\.vn_visual_code 0x1798000 : \{/);
  assert.match(overlayFragment, /\.vn_visual_code[\s\S]*>ram_bank121/);
  assert.match(overlayFragment, /\.vn_cd_async_code 0x17a8000 : \{/);
  assert.match(overlayFragment, /KEEP\(\*\(\.vn_cd_async_code\.entry \.vn_cd_async_code\.entry\.\*\)\)/);
  assert.match(overlayFragment, /\.vn_cd_async_code[\s\S]*>ram_bank122/);
  // The overlay now has its OWN load region (ram_bank133, link addr 0x1858000 whose
  // low 16 bits = CPU 0x8000 / MPR slot 4). It is removed from the ELF after
  // extraction (no resident->overlay relocation thanks to the .entry op-dispatch,
  // pinned first), so the full physical bank133 (8KB) is usable.
  assert.match(overlayFragment, /\.vn_overlay 0x1858000 : \{/);
  assert.match(overlayFragment, /KEEP\(\*\(\.vn_overlay\.entry \.vn_overlay\.entry\.\*\)\)/);
  assert.match(overlayFragment, /\.vn_overlay[\s\S]*>ram_bank133/);
  // The write-before-read fixed buffers (cd_transfer_scratch, glyph mask cache)
  // are parked NOLOAD in bank132's tail (CPU 0xd078) so the whole
  // [0xc000, 0xd078) region stays free for growing resident metadata.
  assert.match(overlayFragment, /\.ram_bank132_tail 0xd078 \(NOLOAD\) : \{[\s\S]*KEEP\(\*\(\.ram_bank132_tail \.ram_bank132_tail\.\*\)\)/);
  assert.doesNotMatch(overlayFragment, /\.vn_visual_cache112/);
  assert.doesNotMatch(overlayFragment, /\.vn_visual_cache119/);
  assert.match(overlayFragment, /INSERT AFTER \.ram_bank132;/);
  // The runtime declares bank133 for the message/sprite overlay and keeps the
  // experimental visual payload cache code/payload banks separate.
  const runtimeSrc = readRuntimeSource();
  assert.match(runtimeSrc, /PCE_RAM_BANK_AT\(133, 4\);/);
  assert.match(runtimeSrc, /#define VN_ENABLE_VISUAL_PAYLOAD_CACHE 1/);
  assert.match(runtimeSrc, /PCE_RAM_BANK_AT\(121, 4\);/);
  assert.match(runtimeSrc, /#define VN_VISUAL_CACHE_PAGE_COUNT 16u/);
  assert.match(runtimeSrc, /#define VN_VISUAL_CACHE_FIRST_BANK 104u/);
  assert.match(runtimeSrc, /static void load_overlay_code\(void\)/);
  assert.match(runtimeSrc, /#if VN_ENABLE_VISUAL_PAYLOAD_CACHE[\s\S]*static void VN_BANKED_CODE load_visual_cache_code\(void\)/);
  assert.match(runtimeSrc, /#define VN_OVERLAY_CODE __attribute__\(\(noinline, section\(".vn_overlay"\)\)\)/);
  assert.doesNotMatch(runtimeSrc, /cd_rle_ref_to_vram/);
  assert.match(runtimeSrc, /VN_OVERLAY_CODE refresh_scene_sprite_patterns_impl\(/);
  assert.match(runtimeSrc, /return vn_overlay_dispatch\(VN_OVERLAY_OP_REFRESH_SPRITE,/);
  assert.doesNotMatch(runtimeSrc, /vn_overlay_dispatch_locked\(VN_OVERLAY_OP_REFRESH_SPRITE,/);
  assert.match(runtimeSrc, /VN_OVERLAY_CODE draw_message_glyph_at\(/);
  assert.match(runtimeSrc, /VN_RESIDENT_CODE call_overlay_draw_message_glyph_at\(/);
  assert.doesNotMatch(runtimeSrc, /\(uint8_t\)slot->animation_index/);
  // The standalone Phase B0 overlay TU must no longer be synced into the project.
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_overlay.c')), false);
  // CD v2 obtains every text glyph from EX_GETFNT and emits no font payload.
  assert.doesNotMatch(source, /PCE_VN_FONT_SECTION|pce_vn_font_tiles/);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'font.bin')), false);
  assert.equal(prepared.generated.fontDataPath, '');
  assert.match(source, /#define PCE_VN_DATA_SECTION __attribute__\(\(section\("\.ram_bank132"\)\)\)/);
  assert.match(source, /pce_ram_bank132_map\(\);/);
  assert.match(source, /const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations\[\]/);
  assert.match(header, /extern const unsigned int pce_vn_sprite_animation_count;/);
  assert.match(source, /const unsigned int PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = 2;/);
  assert.match(source, /const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs\[\]/);
  assert.doesNotMatch(source, /pce_vn_commands\[\]|pce_vn_messages\[\]|pce_vn_scenes\[\]/);
  assert.equal(pack.subarray(0, 4).toString('ascii'), 'PVNS');
  assert.equal(pack[4], 2);
  assert.equal(pack[5], 6);
  assert.equal(pack[6], 1);
  assert.deepEqual(commandRecord(pack, 0), {
    type: vnManager.VN_COMMAND_CACHE,
    assetIndex: 0,
    slot: 0,
    flags: vnManager.VN_CACHE_ACTION_LOAD,
    arg0: vnManager.VN_CACHE_SCOPE_ADPCM,
    arg1: 0,
    x: 0,
    y: 0,
    messageIndex: -1,
    animationIndex: -1,
    sceneIndex: -1,
    choiceIndex: -1,
  });
  assert.equal(commandRecord(pack, 5).type, vnManager.VN_COMMAND_MESSAGE);
  const message = messageRecord(pack, 0);
  assert.equal(message.voiceIndex, 0);
  // The 3-byte placeholder voice is sub-frame, so the synced duration rounds to
  // zero frames and the global message speed is kept as the fallback.
  assert.equal(message.textSpeedFrames, vnManager.VN_DEFAULT_MESSAGE_SPEED_FRAMES);
  assert.equal(message.mouthAnimationIndex, 1);
  // CD v2 stores normalized Shift-JIS words and terminates with 0xffff.
  assert.equal(pack.readUInt16LE(message.glyphOffset + (message.glyphCount * 2)), 0xffff);
});

test('PCE VN manager normalizes startScene with scene IDs and emits that runtime index', () => {
  const projectDir = makeTempDir('pce-vn-start-scene-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'Start Scene',
    scenes: [{
      id: 'opening',
      commands: [],
    }, {
      id: 'Start Scene',
      commands: [],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.startScene, 'Start_Scene');
  assert.equal(normalized.scenes[1].id, 'Start_Scene');

  const generated = vnManager.generateVnSources(projectDir);
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.match(source, /const unsigned char PCE_VN_DATA_SECTION pce_vn_start_scene = 1u;/);
});

test('PCE VN manager bakes ADPCM message duration into text speed', () => {
  const projectDir = makeTempDir('pce-vn-voice-speed-');
  const vnManager = loadVnManager();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'voice'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin'), Buffer.alloc(16000, 0x22));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'voice',
      type: 'adpcm',
      source: 'assets/adpcm/voice.wav',
      options: { sampleRate: 16000, loop: false },
      data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', sampleRate: 16000 } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', text: 'ABCD', voiceAssetId: 'voice', textSpeedFrames: 0 }],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  const message = messageRecord(pack, 0);

  assert.equal(message.glyphCount, 4);
  assert.equal(message.voiceIndex, 0);
  // 16000 bytes @ 16000 Hz = 32000 samples = 120 frames of voice; spread over 4
  // glyphs that is round(120 / 4) = 30 frames/glyph, so the typewriter total
  // (120 frames) matches the voice length instead of overshooting it.
  assert.equal(message.textSpeedFrames, 30);
});

test('PCE VN manager renders speaker as an instant header and syncs ADPCM to body text', () => {
  const projectDir = makeTempDir('pce-vn-speaker-header-');
  const vnManager = loadVnManager();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'voice'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin'), Buffer.alloc(16000, 0x22));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'voice',
      type: 'adpcm',
      source: 'assets/adpcm/voice.wav',
      options: { sampleRate: 16000, loop: false },
      data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', sampleRate: 16000 } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', speaker: 'Akari', text: 'ABCD', voiceAssetId: 'voice' }],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  const message = messageRecord(pack, 0);

  // Stored stream is "Akari：\nABCD": 7 instant header entries + 4 body glyphs.
  // ADPCM speed ignores the speaker header and divides the 120-frame voice by
  // the 4 body glyphs.
  assert.equal(message.glyphCount, 11);
  assert.equal(message.instantGlyphCount, 7);
  assert.equal(message.textSpeedFrames, 30);
  assert.equal(pack[message.glyphOffset + (6 * 2)], 0xfe);
  assert.equal(pack[message.glyphOffset + (6 * 2) + 1], 0xff);
});

test('PCE VN manager applies global message settings to message records', () => {
  const projectDir = makeTempDir('pce-vn-system-settings-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    settings: {
      messageSpeedFrames: 47,
      messageAdvanceMode: 'auto',
      messageAutoWaitFrames: 90,
    },
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'message', text: 'A', textSpeedFrames: 0, advanceMode: 'button', autoWaitFrames: 1 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.deepEqual(normalized.settings, {
    messageSpeedFrames: 50,
    messageAdvanceMode: 'auto',
    messageAutoWaitFrames: 90,
  });
  assert.equal(normalized.scenes[0].commands[0].textSpeedFrames, undefined);
  assert.equal(normalized.scenes[0].commands[0].advanceMode, undefined);
  assert.equal(normalized.scenes[0].commands[0].autoWaitFrames, undefined);

  const generated = vnManager.generateVnSources(projectDir);
  const message = messageRecord(readPack(projectDir, generated.scenePackPaths[0]), 0);
  assert.equal(message.textSpeedFrames, 50);
  assert.equal(message.advanceMode, vnManager.VN_ADVANCE_AUTO);
  assert.equal(message.autoWaitFrames, 90);
});

test('PCE VN manager excludes newlines from the ADPCM-synced text speed', () => {
  const projectDir = makeTempDir('pce-vn-voice-newline-');
  const vnManager = loadVnManager();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'voice'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin'), Buffer.alloc(16000, 0x22));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'voice',
      type: 'adpcm',
      source: 'assets/adpcm/voice.wav',
      options: { sampleRate: 16000, loop: false },
      data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', sampleRate: 16000 } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', text: 'AB\nCD', voiceAssetId: 'voice', textSpeedFrames: 0 }],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const message = messageRecord(readPack(projectDir, generated.scenePackPaths[0]), 0);
  // 5 entries are stored (AB + newline + CD) but the newline is not spoken, so the
  // 120-frame voice is divided by the 4 drawable glyphs: round(120 / 4) = 30.
  // Counting the newline would wrongly give round(120 / 5) = 24.
  assert.equal(message.glyphCount, 5);
  assert.equal(message.textSpeedFrames, 30);

  // The runtime must reveal newlines without consuming a typewriter tick.
  const runtime = readRuntimeSource();
  assert.match(runtime, /newline costs no typewriter tick|costs no typewriter tick|not spoken[\s\S]*?continue;/);
});

test('PCE VN manager paces text against the ADPCM rate the hardware actually plays', () => {
  const projectDir = makeTempDir('pce-vn-voice-rate-');
  const vnManager = loadVnManager();
  fs.mkdirSync(path.join(projectDir, 'assets', 'generated', 'voice'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin'), Buffer.alloc(21000, 0x22));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'voice',
      type: 'adpcm',
      source: 'assets/adpcm/voice.wav',
      // 21000 Hz is not representable; the PCE ADPCM clock snaps it to 16000 Hz,
      // so the voice plays slower than nominal and the text must follow the real
      // (slower) rate, not 21000.
      options: { sampleRate: 21000, loop: false },
      data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', sampleRate: 21000 } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', text: 'AB', voiceAssetId: 'voice', textSpeedFrames: 0 }],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const message = messageRecord(readPack(projectDir, generated.scenePackPaths[0]), 0);
  // 21000 bytes -> 42000 samples; at the real 16000 Hz that is round(42000*60/16000)
  // = 158 frames, over 2 glyphs -> round(158 / 2) = 79. Using the nominal 21000 Hz
  // would wrongly give round(120 / 2) = 60.
  assert.equal(message.textSpeedFrames, 79);
});

test('PCE VN manager encodes message newlines as line-break glyphs', () => {
  const projectDir = makeTempDir('pce-vn-newline-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', text: 'あ\nい' }],
      nextSceneId: '',
    }],
  });

  const prepared = vnManager.prepareVisualNovelBuild(projectDir, { cd: { dataFiles: [] } });
  const header = fs.readFileSync(prepared.generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, prepared.generated.scenePackPaths[0]);
  const message = messageRecord(pack, 0);
  // CD scene v2 stores fixed little-endian 16-bit Shift-JIS/control words.
  assert.equal(message.glyphCount, 3);
  assert.equal(pack.readUInt16LE(message.glyphOffset + 2), 0xfffe);
  assert.equal(pack.readUInt16LE(message.glyphOffset + (message.glyphCount * 2)), 0xffff);
  assert.match(header, /PCE_VN_GLYPH_NEWLINE 0xfffeu/);
  assert.match(header, /PCE_VN_MESSAGE_WAIT_GLYPH \d+u/);

  const runtime = readRuntimeSource();
  assert.match(runtime, /glyph == PCE_VN_GLYPH_NEWLINE/);
  assert.match(runtime, /VN_WAIT_CURSOR_COL \(VN_TEXT_COLS - 1u\)/);
  assert.match(runtime, /VN_MESSAGE_ROW_COL_LIMIT\(message_row\)/);
  assert.match(runtime, /call_overlay_draw_message_glyph_at\(PCE_VN_MESSAGE_WAIT_GLYPH, VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW\)/);
  assert.match(runtime, /tick_message_wait_indicator\(\)/);
  const hideWaitStart = runtime.indexOf('static void VN_BANKED_CODE hide_message_wait_indicator(void)');
  const refreshWaitStart = runtime.indexOf('static void VN_BANKED_CODE refresh_message_wait_indicator(void)');
  assert.notEqual(hideWaitStart, -1);
  assert.notEqual(refreshWaitStart, -1);
  const hideWaitSource = runtime.slice(hideWaitStart, refreshWaitStart);
  assert.match(hideWaitSource, /if \(message_wait_indicator_state\)[\s\S]*message_frame_timer = 0u;[\s\S]*message_wait_indicator_state = 0u;/);
  assert.doesNotMatch(hideWaitSource, /message_wait_indicator_state = 0u;\s*message_frame_timer = 0u;/);
});

test('PCE VN manager escape-encodes glyph indices past 252', () => {
  const vnManager = loadVnManager();
  const enc = (index) => { const b = []; vnManager.pushGlyphIndexEntry(b, index); return b; };
  // 0..252 stay one byte; 253+ become 0xfd + 16-bit little-endian index.
  assert.deepEqual(enc(0), [0x00]);
  assert.deepEqual(enc(252), [0xfc]);
  assert.deepEqual(enc(253), [0xfd, 0xfd, 0x00]);
  assert.deepEqual(enc(300), [0xfd, 0x2c, 0x01]);
  assert.deepEqual(enc(999), [0xfd, 0xe7, 0x03]);

  // CD v2 has no glyph-index escape stream; HuCard retains that legacy encoding.
  const runtime = readRuntimeSource();
  assert.doesNotMatch(runtime, /b == PCE_VN_GLYPH_ESCAPE/);
  assert.match(runtime, /vn_glyph_decode\(const uint8_t \*glyphs, uint16_t pos\)[\s\S]*glyphs\[pos\][\s\S]*glyphs\[pos \+ 1u\] << 8/);
  assert.match(runtime, /vn_glyph_stride\(const uint8_t \*glyphs, uint16_t pos\)[\s\S]*return 2u;/);

  const hucardRuntime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_hucard', 'src', 'pce_vn_hucard_runtime.c'),
    'utf-8',
  );
  assert.match(hucardRuntime, /glyphs\[pos\] == PCE_VN_GLYPH_ESCAPE \? 3u : 1u/);
  assert.match(hucardRuntime, /const uint8_t b = glyphs\[pos\];[\s\S]*if \(b == PCE_VN_GLYPH_ESCAPE\)[\s\S]*return \(uint16_t\)\(\(uint16_t\)glyphs\[\(uint16_t\)\(pos \+ 1u\)\]/);
  assert.match(hucardRuntime, /data_ref_u16_at\(&pce_vn_font_data_ref/);
  assert.match(hucardRuntime, /data_ref_byte_at\(ref, offset\) \| \(\(uint16_t\)data_ref_byte_at\(ref, \(uint16_t\)\(offset \+ 1u\)\) << 8\)/);
  assert.match(hucardRuntime, /if \(offset < \(uint16_t\)\(base \+ chunk->size\)\)[\s\S]*pce_editor_map_asset_bank\(chunk->bank\);/);
  assert.match(hucardRuntime, /static uint8_t scene_pack_storage\[PCE_VN_SCENE_PACK_CACHE_BYTES\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t variable_values\[PCE_VN_VARIABLE_STORAGE_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static vdc_sprite_t sprite_shadow\[64\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static vn_sprite_slot_t sprite_slots\[VN_SPRITE_SLOT_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t sprite_slot_pattern_base\[VN_SPRITE_SLOT_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint8_t sprite_slot_palette_bank\[VN_SPRITE_SLOT_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint8_t sprite_slot_pattern_valid\[VN_SPRITE_SLOT_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t blank_bat_row\[VN_MAP_WIDTH\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t msg_bat_row\[VN_MSG_TILE_COLS\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint8_t msg_tile\[32\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static vn_scene_pack_cache_t active_scene_pack __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static pce_vn_message_t active_message_state __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t msg_gmask\[VN_GLYPH_MASK_WORDS\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t composer_prev_mask\[VN_GLYPH_MASK_WORDS\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static vn_psg_player_t psg_song __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(hucardRuntime, /static uint16_t VN_HUCARD_CODE_VIDEO bg_blank_tile_index\(const pce_editor_bg_asset_t \*bg\)[\s\S]*return VN_UI_BLANK_TILE;/);
  assert.match(hucardRuntime, /static void VN_HUCARD_CODE_VIDEO draw_sprite_slot\(uint8_t slot, uint8_t upload_patterns\)[\s\S]*vn_sprite_slot_t \*state;/);
  assert.match(hucardRuntime, /source_row = \(state->flags & PCE_VN_SPRITE_FLIP_Y\)/);
  assert.match(hucardRuntime, /source_cell >= total_cells/);
  assert.match(hucardRuntime, /active_scene_pack\.data = scene_pack_storage;/);
});

test('PCE VN font budget raises the glyph cap well past the old 254 limit', () => {
  const vnManager = loadVnManager();
  const tileBase = vnManager.DEFAULT_FONT_TILE_BASE;
  // 300 distinct glyphs (impossible under the old 254 cap) build with no drops.
  const wide = vnManager.computeFontBudget(300, tileBase);
  assert.equal(wide.usedGlyphCount, 300);
  assert.equal(wide.droppedGlyphCount, 0);
  assert.equal(wide.errors.length, 0);
  // The headline cap is far above 254 but still finite (VRAM-bound).
  assert.ok(vnManager.VN_MAX_GLYPH_COUNT > 254);
  // Beyond the headline cap, the extra glyphs are dropped with a warning.
  const dropped = vnManager.computeFontBudget(4000, tileBase);
  assert.equal(dropped.usedGlyphCount, vnManager.VN_MAX_GLYPH_COUNT);
  assert.equal(dropped.droppedGlyphCount, 4000 - vnManager.VN_MAX_GLYPH_COUNT);
  assert.ok(dropped.warnings.length > 0);
  // A high tileBase pushes even the capped mask region past the SATB: build error.
  const overflow = vnManager.computeFontBudget(vnManager.VN_MAX_GLYPH_COUNT, 1500);
  assert.ok(overflow.errors.length > 0, 'expected a VRAM-overflow build error');
});

test('PCE VN VRAM layout reserves BG/message/sprite exclusively and rejects overlap', () => {
  const vnManager = loadVnManager();
  const fontBudget = vnManager.computeFontBudget(64, vnManager.DEFAULT_FONT_TILE_BASE);
  const fontSpritePatternBase = Math.ceil((fontBudget.endTile * 16) / 32);
  // Clean layout: small BG below the message font, sprite at the default base.
  const clean = {
    assets: [
      { type: 'image', options: { tileBase: 64 }, data: { generated: { tileCount: 300 } } },
      { type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 40 } } },
    ],
  };
  assert.doesNotThrow(() => vnManager.validateVnVramLayout(clean, fontBudget, fontSpritePatternBase, 0));
  // Two BGs and two sprites within their own category share VRAM (one shown at a
  // time), so same-category overlap must NOT be an error.
  const sharedCategory = {
    assets: [
      { type: 'image', options: { tileBase: 64 }, data: { generated: { tileCount: 300 } } },
      { type: 'image', options: { tileBase: 64 }, data: { generated: { tileCount: 200 } } },
      { type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 40 } } },
      { type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 46 } } },
    ],
  };
  assert.doesNotThrow(() => vnManager.validateVnVramLayout(sharedCategory, fontBudget, fontSpritePatternBase, 0));
  const usage = vnManager.collectSceneVisualAssetUsage({
    scenes: [{
      commands: [
        { type: 'sprite', slot: 1, assetId: 'slot1', visible: true },
        { type: 'sprite', slot: 0, assetId: 'slot0', visible: true },
        { type: 'sprite', slot: 1, visible: false },
      ],
    }],
  });
  assert.deepEqual(usage.spriteSlotLayouts, [['slot1'], ['slot0', 'slot1'], ['slot0']]);
  const crossSceneUsage = vnManager.collectSceneVisualAssetUsage({
    startScene: 'opening',
    scenes: [
      {
        id: 'opening',
        nextSceneId: 'next',
        commands: [
          { type: 'sprite', slot: 0, assetId: 'slot0', visible: true },
        ],
      },
      {
        id: 'next',
        commands: [
          { type: 'sprite', slot: 1, assetId: 'slot1', visible: true },
        ],
      },
    ],
  });
  assert.deepEqual(crossSceneUsage.spriteSlotLayouts, [['slot0'], ['slot0', 'slot1'], ['slot1']]);
  const simultaneousSprites = {
    assets: [
      { id: 'slot0', type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 200 } } },
      { id: 'slot1', type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 200 } } },
    ],
  };
  assert.throws(() => vnManager.validateVnVramLayout(simultaneousSprites, fontBudget, fontSpritePatternBase, 0, {
    spriteAssetIds: new Set(['slot0', 'slot1']),
    spriteSlotLayouts: [['slot0', 'slot1']],
  }), /VRAM/);
  const duplicateSpriteSlots = {
    assets: [
      { id: 'hero', type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 160 } } },
    ],
  };
  const duplicateSlotRegions = vnManager.computeVnVramLayout(duplicateSpriteSlots, fontBudget, fontSpritePatternBase, 0, {
    spriteAssetIds: new Set(['hero']),
    spriteSlotLayouts: [['hero', 'hero', 'hero']],
  }).filter((region) => region.name === 'sprite patterns');
  assert.equal(duplicateSlotRegions.length, 1);
  assert.equal(duplicateSlotRegions[0].end - duplicateSlotRegions[0].start, 160 * 64);
  assert.doesNotThrow(() => vnManager.validateVnVramLayout(duplicateSpriteSlots, fontBudget, fontSpritePatternBase, 0, {
    spriteAssetIds: new Set(['hero']),
    spriteSlotLayouts: [['hero', 'hero', 'hero']],
  }));
  const packedSprites = {
    assets: [
      { id: 'bg', type: 'image', options: { tileBase: 64 }, data: { generated: { tileCount: 476 } } },
      { id: 'small', type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 40 } } },
      { id: 'big0', type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 120 } } },
      { id: 'big1', type: 'sprite', options: { tileBase: 704 }, data: { generated: { tileCount: 120 } } },
    ],
  };
  assert.equal(vnManager.computeVnSpritePatternBase(fontBudget, fontSpritePatternBase, 0), fontSpritePatternBase);
  assert.doesNotThrow(() => vnManager.validateVnVramLayout(packedSprites, fontBudget, fontSpritePatternBase, 0, {
    imageAssetIds: new Set(['bg']),
    spriteAssetIds: new Set(['small', 'big0', 'big1']),
    spriteSlotLayouts: [['small', 'big0', 'big1']],
  }));
  {
    const alignedLayout = vnManager.computeVnVramLayout({
      assets: [
        { id: 'small', type: 'sprite', options: { cellWidth: 16, cellHeight: 16 }, data: { generated: { tileCount: 1 } } },
        { id: 'tall', type: 'sprite', options: { cellWidth: 32, cellHeight: 64 }, data: { generated: { tileCount: 8 } } },
      ],
    }, { tileBase: 540, maskEndWord: 0 }, 705, 0, {
      spriteAssetIds: new Set(['small', 'tall']),
      spriteSlotLayouts: [['small', 'tall']],
    }).filter((region) => region.name === 'sprite patterns');
    assert.deepEqual(alignedLayout.map((region) => region.start), [706 * 32, 720 * 32]);
  }
  assert.doesNotThrow(() => vnManager.validateVnSpritePaletteLayout({
    assets: [
      { id: 'slot0', type: 'sprite', options: { paletteBank: 0 } },
      { id: 'slot1', type: 'sprite', options: { paletteBank: 0 } },
    ],
  }, 15, {
    spriteAssetIds: new Set(['slot0', 'slot1']),
    spriteSlotLayouts: [['slot0', 'slot1']],
  }));
  assert.doesNotThrow(() => vnManager.validateVnSpritePaletteLayout({
    assets: [
      { id: 'hero', type: 'sprite', options: { paletteBank: 14 } },
    ],
  }, 15, {
    spriteAssetIds: new Set(['hero']),
    spriteSlotLayouts: [['hero', 'hero', 'hero']],
  }));
  assert.throws(() => vnManager.validateVnSpritePaletteLayout({
    assets: [
      { id: 'slot0', type: 'sprite', options: { paletteBank: 14 } },
      { id: 'slot1', type: 'sprite', options: { paletteBank: 14 } },
    ],
  }, 15, {
    spriteAssetIds: new Set(['slot0', 'slot1']),
    spriteSlotLayouts: [['slot0', 'slot1']],
  }), /palette bank/);
  // An oversized BG runs into the message font region -> build error.
  const bgOverlap = {
    assets: [{ type: 'image', options: { tileBase: 64 }, data: { generated: { tileCount: 700 } } }],
  };
  assert.throws(() => vnManager.validateVnVramLayout(bgOverlap, fontBudget, fontSpritePatternBase, 0), /VRAM/);
  // A sprite whose patterns run into the SATB -> build error.
  const spriteOverlap = {
    assets: [{ type: 'sprite', options: { tileBase: 1010 }, data: { generated: { tileCount: 700 } } }],
  };
  assert.throws(() => vnManager.validateVnVramLayout(spriteOverlap, fontBudget, fontSpritePatternBase, 0), /VRAM/);
});

test('PCE VN manager default scene does not auto-play the first CD-DA asset', () => {
  const vnManager = loadVnManager();
  const doc = vnManager.defaultSceneDocument({
    assets: [
      { id: 'bg', type: 'image', source: 'assets/images/bg.png' },
      { id: 'track2', type: 'cdda-track', source: 'assets/cdda/track2.wav', options: { track: 2 } },
    ],
  });

  assert.equal(doc.scenes[0].commands[0].type, 'background');
  assert.equal(doc.scenes[0].commands[0].transition, 'fade');
  assert.equal(doc.scenes[0].commands[0].fadeOutFrames, vnManager.VN_BG_DEFAULT_FADE_FRAMES);
  assert.equal(doc.scenes[0].commands[0].fadeInFrames, vnManager.VN_BG_DEFAULT_FADE_FRAMES);
  assert.equal(doc.scenes[0].commands[0].x, vnManager.VN_BG_DEFAULT_TILE_X);
  assert.equal(doc.scenes[0].commands[0].y, vnManager.VN_BG_DEFAULT_TILE_Y);
  assert.equal(doc.scenes[0].commands.some((command) => command.type === 'audio'), false);
});

test('PCE VN manager forces BG commands to Fade speed presets', () => {
  const projectDir = makeTempDir('pce-vn-bg-fade-presets-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'bg_a', type: 'image', source: 'assets/images/bg-a.png' },
      { id: 'bg_b', type: 'image', source: 'assets/images/bg-b.png' },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'background', assetId: 'bg_a', transition: 'cut', fadeOutFrames: 0, fadeInFrames: 47 },
        { type: 'background', assetId: 'bg_b', transition: 'fade', fadeOutFrames: 16, fadeInFrames: 60 },
        { type: 'background', assetId: 'bg_a' },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.deepEqual(vnManager.VN_BG_FADE_FRAME_OPTIONS, [10, 20, 30, 40, 50, 60]);
  assert.deepEqual(normalized.scenes[0].commands.map((command) => ({
    transition: command.transition,
    fadeOutFrames: command.fadeOutFrames,
    fadeInFrames: command.fadeInFrames,
  })), [
    { transition: 'fade', fadeOutFrames: 10, fadeInFrames: 50 },
    { transition: 'fade', fadeOutFrames: 20, fadeInFrames: 60 },
    { transition: 'fade', fadeOutFrames: 30, fadeInFrames: 30 },
  ]);
});

test('PCE VN manager encodes full-screen BG scene mode and rejects UI commands', () => {
  const projectDir = makeTempDir('pce-vn-fullscreen-bg-');
  const vnManager = loadVnManager();
  const makeFile = (relativePath, size) => {
    const absPath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.alloc(size));
  };
  makeFile('assets/generated/full_bg/tiles.bin', 28672);
  makeFile('assets/generated/full_bg/map_vram.bin', 1792);
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'full_bg',
      type: 'image',
      options: { width: 256, height: 224, tileBase: 64 },
      data: { generated: {
        width: 256,
        height: 224,
        tileCount: 896,
        tilesFile: 'assets/generated/full_bg/tiles.bin',
        mapVramFile: 'assets/generated/full_bg/map_vram.bin',
      } },
    }, {
      id: 'unused_full_bg',
      type: 'image',
      options: { width: 256, height: 224, tileBase: 64 },
      data: { generated: {
        width: 256,
        height: 224,
        tileCount: 896,
        tilesFile: 'assets/generated/full_bg/tiles.bin',
        mapVramFile: 'assets/generated/full_bg/map_vram.bin',
      } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'gallery',
    scenes: [{
      id: 'gallery',
      fullScreenBg: true,
      commands: [
        { type: 'background', assetId: 'full_bg', x: 0, y: 0 },
        { type: 'wait', frames: 60 },
      ],
    }, {
      id: 'normal',
      commands: [
        { type: 'message', text: 'after full bg' },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].fullScreenBg, true);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_SCENE_FLAG_FULL_SCREEN_BG 1u/);
  assert.match(header, /PCE_VN_HAS_FULL_SCREEN_BG 1u/);
  assert.equal(pack[5], 2);
  assert.equal(pack[9], vnManager.VN_SCENE_FLAG_FULL_SCREEN_BG);
  assert.equal(commandRecord(pack, 0).x, 0);
  assert.equal(commandRecord(pack, 0).y, 0);

  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'normal',
    scenes: [{
      id: 'normal',
      commands: [
        { type: 'background', assetId: 'full_bg', x: 0, y: 0 },
        { type: 'message', text: 'regular use' },
      ],
    }],
  });
  assert.throws(
    () => vnManager.generateVnSources(projectDir),
    /VN VRAM 領域の排他予約/
  );

  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'gallery',
    scenes: [{
      id: 'gallery',
      fullScreenBg: true,
      commands: [
        { type: 'background', assetId: 'full_bg' },
        { type: 'message', text: 'hidden' },
      ],
    }],
  });
  assert.throws(
    () => vnManager.generateVnSources(projectDir),
    /fullScreenBg and cannot contain message commands/
  );
});

test('PCE VN manager normalizes future scene VM commands and keeps scene pack CD order', () => {
  const projectDir = makeTempDir('pce-vn-scene-vm-');
  const vnManager = loadVnManager();
  const makeFile = (relativePath, size) => {
    const absPath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, Buffer.alloc(size));
  };
  makeFile('assets/generated/bg_a/tiles.bin', 18432);
  makeFile('assets/generated/bg_a/tiles.rle', 64);
  makeFile('assets/generated/bg_a/map_vram.bin', 2048);
  makeFile('assets/generated/bg_a/map_vram.rle', 16);
  makeFile('assets/generated/hero/patterns.bin', 4096);
  makeFile('assets/generated/hero/patterns.rle', 32);
  makeFile('assets/generated/bg_b/tiles.bin', 18432);
  makeFile('assets/generated/bg_b/tiles.rle', 64);
  makeFile('assets/generated/bg_b/map_vram.bin', 2048);
  makeFile('assets/generated/bg_b/map_vram.rle', 16);
  makeFile('assets/generated/rival/patterns.bin', 4096);
  makeFile('assets/generated/rival/patterns.rle', 32);
  makeFile('assets/generated/voice/adpcm.bin', 2400);
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'bg_a',
        type: 'image',
        data: { generated: {
          tilesFile: 'assets/generated/bg_a/tiles.bin',
          tilesCompressedFile: 'assets/generated/bg_a/tiles.rle',
          mapVramFile: 'assets/generated/bg_a/map_vram.bin',
          mapVramCompressedFile: 'assets/generated/bg_a/map_vram.rle',
          compression: {
            tiles: { codec: 'rle', file: 'assets/generated/bg_a/tiles.rle', rawBytes: 18432, byteLength: 64 },
            map: { codec: 'rle', file: 'assets/generated/bg_a/map_vram.rle', rawBytes: 2048, byteLength: 16 },
          },
        } },
      },
      {
        id: 'hero',
        type: 'sprite',
        data: { generated: {
          tilesFile: 'assets/generated/hero/patterns.bin',
          tilesCompressedFile: 'assets/generated/hero/patterns.rle',
          compression: {
            tiles: { codec: 'rle', file: 'assets/generated/hero/patterns.rle', rawBytes: 4096, byteLength: 32 },
          },
        } },
      },
      {
        id: 'bg_b',
        type: 'image',
        data: { generated: {
          tilesFile: 'assets/generated/bg_b/tiles.bin',
          tilesCompressedFile: 'assets/generated/bg_b/tiles.rle',
          mapVramFile: 'assets/generated/bg_b/map_vram.bin',
          mapVramCompressedFile: 'assets/generated/bg_b/map_vram.rle',
          compression: {
            tiles: { codec: 'rle', file: 'assets/generated/bg_b/tiles.rle', rawBytes: 18432, byteLength: 64 },
            map: { codec: 'rle', file: 'assets/generated/bg_b/map_vram.rle', rawBytes: 2048, byteLength: 16 },
          },
        } },
      },
      {
        id: 'rival',
        type: 'sprite',
        data: { generated: {
          tilesFile: 'assets/generated/rival/patterns.bin',
          tilesCompressedFile: 'assets/generated/rival/patterns.rle',
          compression: {
            tiles: { codec: 'rle', file: 'assets/generated/rival/patterns.rle', rawBytes: 4096, byteLength: 32 },
          },
        } },
      },
      { id: 'voice', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [
      {
        id: 'opening',
        commands: [
          { type: 'background', assetId: 'bg_a' },
          { type: 'sprite', assetId: 'hero', visible: true, flipX: true, flipY: true, durationFrames: 12 },
          { type: 'preload', sceneId: 'next' },
          { type: 'choice', defaultIndex: 1, choices: [{ label: '見る', targetSceneId: 'next' }, { label: '待つ', targetSceneId: 'opening' }] },
        ],
      },
      {
        id: 'next',
        commands: [
          { type: 'effect', effect: 'fadeOut', frames: 12, color: '#0000ff' },
          { type: 'background', assetId: 'bg_b', transition: 'fade', fadeOutFrames: 8, fadeInFrames: 16, x: 2, y: 4 },
          { type: 'sprite', assetId: 'rival', visible: true },
          { type: 'effect', effect: 'shake', frames: 20, intensity: 6 },
          { type: 'effect', effect: 'flash', frames: 5, color: '#00ff00' },
          { type: 'message', text: '次です', voiceAssetId: 'voice' },
          { type: 'wait', frames: 45 },
          { type: 'jump', sceneId: 'opening' },
        ],
      },
    ],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[2].type, 'choice');
  assert.equal(normalized.scenes[0].commands[2].choices[0].targetSceneId, 'next');
  assert.equal(normalized.scenes[0].commands[1].flipX, true);
  assert.equal(normalized.scenes[0].commands[1].flipY, true);
  assert.equal(normalized.scenes[0].commands[1].durationFrames, undefined);
  assert.equal(normalized.scenes[1].commands[0].type, 'effect');
  assert.equal(normalized.scenes[1].commands[1].x, 2);
  assert.equal(normalized.scenes[1].commands[1].y, 4);
  assert.equal(normalized.scenes[1].commands[1].transition, 'fade');
  assert.equal(normalized.scenes[1].commands[1].fadeOutFrames, 10);
  assert.equal(normalized.scenes[1].commands[1].fadeInFrames, 20);
  assert.equal(normalized.scenes[1].commands[3].effect, 'shake');
  assert.equal(normalized.scenes[1].commands[3].intensity, 6);
  assert.equal(normalized.scenes[1].commands[4].effect, 'flash');
  assert.equal(normalized.scenes[1].commands[4].color, '#00ff00');
  assert.equal(normalized.scenes[1].commands[6].frames, 45);
  assert.equal(normalized.scenes[1].commands[7].sceneId, 'opening');
  // collectCdDataFiles only lists overlay.bin when it exists on disk; this test
  // exercises the raw layout without a prepareVisualNovelBuild reservation, so the
  // overlay blob is absent here.
  // RLE removed: CD data files are the raw .bin buffers (the stale RLE metadata in
  // the asset doc above is ignored by the raw-only build).
  const expectedCdDataFiles = [
    'assets/generated/vn/scenes/000_opening.bin',
    'assets/generated/bg_a/tiles.bin',
    'assets/generated/bg_a/map_vram.bin',
    'assets/generated/hero/patterns.bin',
    'assets/generated/vn/scenes/001_next.bin',
    'assets/generated/bg_b/tiles.bin',
    'assets/generated/bg_b/map_vram.bin',
    'assets/generated/rival/patterns.bin',
    'assets/generated/voice/adpcm.bin',
  ];
  assert.deepEqual(vnManager.collectCdDataFiles(projectDir), expectedCdDataFiles);
  makeFile('assets/custom/extra.bin', 7);
  makeFile('assets/generated/orphan/patterns.rle', 3);
  makeFile('assets/generated/vn/scenes/999_old.bin', 4);
  const preparedWithStaleConfig = vnManager.prepareVisualNovelBuild(projectDir, {
    cd: {
      dataFiles: [
        'assets/generated/bg_a/tiles.bin',
        'assets/generated/bg_a/tiles.rle',
        'assets/generated/orphan/patterns.rle',
        'assets/generated/vn/scenes/999_old.bin',
        'assets/custom/extra.bin',
      ],
    },
  });
  // prepareVisualNovelBuild reserves the overlay blob, so its CD data file list
  // includes overlay.bin right after font.bin (unlike the raw collectCdDataFiles
  // call above, which ran before any reservation).
  assert.deepEqual(preparedWithStaleConfig.configPatch.cd.dataFiles, [
    'assets/generated/vn/overlay.bin',
    'assets/generated/vn/visual_code.bin',
    'assets/generated/vn/cd_async_code.bin',
    ...expectedCdDataFiles,
    'assets/custom/extra.bin',
  ]);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  const openingPack = readPack(projectDir, generated.scenePackPaths[0]);
  const nextPack = readPack(projectDir, generated.scenePackPaths[1]);
  assert.equal(generated.choiceCount, 1);
  assert.match(header, /PCE_VN_COMMAND_CHOICE 4u/);
  assert.match(header, /PCE_VN_SPRITE_FLIP_X 2u/);
  assert.match(header, /PCE_VN_SPRITE_FLIP_Y 4u/);
  assert.match(header, /PCE_VN_EFFECT_FADE_OUT 0u/);
  assert.match(header, /PCE_VN_EFFECT_SHAKE 3u/);
  assert.match(header, /PCE_VN_EFFECT_FLASH 4u/);
  // No resident font payload: overlay starts at sector 64, followed by the two
  // helper banks. opening@76; bg_a raw assets push next@89.
  assert.match(source, /\{ \{ 76u, 0u, 0u \}, 1u, \d+u, -1 \}/);
  assert.match(source, /\{ \{ 89u, 0u, 0u \}, 1u, \d+u, -1 \}/);
  assert.equal(openingPack[5], 3);
  assert.equal(openingPack[7], 1);
  assert.deepEqual(commandRecord(openingPack, 0), {
    type: 0,
    assetIndex: 0,
    slot: 0,
    flags: vnManager.VN_BG_TRANSITION_FADE,
    arg0: vnManager.VN_BG_DEFAULT_FADE_FRAMES,
    arg1: vnManager.VN_BG_DEFAULT_FADE_FRAMES,
    x: vnManager.VN_BG_DEFAULT_TILE_X,
    y: vnManager.VN_BG_DEFAULT_TILE_Y,
    messageIndex: -1,
    animationIndex: -1,
    sceneIndex: -1,
    choiceIndex: -1,
  });
  assert.equal(commandRecord(openingPack, 1).flags, 7);
  assert.equal(commandRecord(openingPack, 1).arg0, 0);
  assert.equal(commandRecord(openingPack, 2).choiceIndex, 0);
  const choice = choiceRecord(openingPack, 0);
  assert.equal(choice.optionCount, 2);
  assert.equal(choice.defaultIndex, 1);
  assert.equal(choiceOptionRecord(openingPack, choice, 0).targetScene, 1);
  assert.equal(choiceOptionRecord(openingPack, choice, 1).targetScene, 0);
  assert.equal(nextPack[5], 9);
  assert.equal(commandRecord(nextPack, 0).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(nextPack, 0).arg0, vnManager.VN_CACHE_SCOPE_ADPCM);
  assert.equal(commandRecord(nextPack, 1).type, vnManager.VN_COMMAND_EFFECT);
  assert.equal(commandRecord(nextPack, 1).flags, 0);
  assert.equal(commandRecord(nextPack, 1).x, vnManager.effectColorWord('#0000ff'));
  assert.equal(commandRecord(nextPack, 2).flags, vnManager.VN_BG_TRANSITION_FADE);
  assert.equal(commandRecord(nextPack, 2).arg0, 10);
  assert.equal(commandRecord(nextPack, 2).arg1, 20);
  assert.equal(commandRecord(nextPack, 4).flags, 3);
  assert.equal(commandRecord(nextPack, 4).arg0, 20);
  assert.equal(commandRecord(nextPack, 4).arg1, 6);
  assert.equal(commandRecord(nextPack, 5).flags, 4);
  assert.equal(commandRecord(nextPack, 5).arg0, 5);
  assert.equal(commandRecord(nextPack, 5).x, vnManager.effectColorWord('#00ff00'));
  assert.equal(commandRecord(nextPack, 6).type, vnManager.VN_COMMAND_MESSAGE);
  assert.equal(commandRecord(nextPack, 7).type, vnManager.VN_COMMAND_WAIT);
  assert.equal(commandRecord(nextPack, 7).arg0, 45);
  assert.equal(commandRecord(nextPack, 8).sceneIndex, 0);
});

test('PCE VN manager emits cache commands without restoring preload', () => {
  const projectDir = makeTempDir('pce-vn-cache-clear-');
  const vnManager = loadVnManager();
  const makeFile = (relativePath, size) => {
    const filePath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(size, 0));
  };
  makeFile('assets/generated/bg_a/tiles.bin', 18432);
  makeFile('assets/generated/bg_a/map_vram.bin', 2048);
  makeFile('assets/generated/hero/patterns.bin', 4096);
  makeFile('assets/generated/voice/adpcm.bin', 2400);
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'bg_a',
        type: 'image',
        data: { generated: {
          tilesFile: 'assets/generated/bg_a/tiles.bin',
          mapVramFile: 'assets/generated/bg_a/map_vram.bin',
        } },
      },
      {
        id: 'hero',
        type: 'sprite',
        data: { generated: {
          tilesFile: 'assets/generated/hero/patterns.bin',
        } },
      },
      { id: 'voice', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin' } } },
      { id: 'theme', type: 'psg-song', options: {
        bpm: 150,
        steps: 16,
        pattern: [{ step: 0, channel: 0, period: 512, volume: 16 }],
      } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'cache', action: 'unknown', scope: 'unknown' },
        { type: 'cache', action: 'clear', scope: 'bg' },
        { type: 'cache', scope: 'sprite' },
        { type: 'cache', scope: 'adpcm' },
        { type: 'cache', scope: 'psg' },
        { type: 'cache', scope: 'all' },
        { type: 'cache', action: 'load', scope: 'bg', assetId: 'bg_a', x: 2, y: 3 },
        { type: 'cache', action: 'load', scope: 'sprite', assetId: 'hero', slot: 2 },
        { type: 'cache', action: 'load', scope: 'adpcm', assetId: 'voice' },
        { type: 'cache', action: 'load', scope: 'psg', assetId: 'theme' },
        { type: 'preload', sceneId: 'next' },
        { type: 'wait', frames: 1 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands.length, 11);
  assert.deepEqual(normalized.scenes[0].commands[0], { type: 'cache', action: 'clear', scope: 'visual' });
  assert.deepEqual(normalized.scenes[0].commands[1], { type: 'cache', action: 'clear', scope: 'bg' });
  assert.deepEqual(normalized.scenes[0].commands[2], { type: 'cache', action: 'clear', scope: 'sprite' });
  assert.deepEqual(normalized.scenes[0].commands[3], { type: 'cache', action: 'clear', scope: 'adpcm' });
  assert.deepEqual(normalized.scenes[0].commands[4], { type: 'cache', action: 'clear', scope: 'psg' });
  assert.deepEqual(normalized.scenes[0].commands[5], { type: 'cache', action: 'clear', scope: 'all' });
  assert.deepEqual(normalized.scenes[0].commands[6], { type: 'cache', action: 'load', scope: 'bg', assetId: 'bg_a', slot: 0, x: 2, y: 3 });
  assert.deepEqual(normalized.scenes[0].commands[7], { type: 'cache', action: 'load', scope: 'sprite', assetId: 'hero', slot: 2, x: 0, y: 0 });
  assert.deepEqual(normalized.scenes[0].commands[8], { type: 'cache', action: 'load', scope: 'adpcm', assetId: 'voice', slot: 0, x: 0, y: 0 });
  assert.deepEqual(normalized.scenes[0].commands[9], { type: 'cache', action: 'load', scope: 'psg', assetId: 'theme', channel: 0, slot: 0, x: 0, y: 0 });
  assert.equal(normalized.scenes[0].commands[10].type, 'wait');

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_COMMAND_CACHE 15u/);
  assert.match(header, /PCE_VN_CACHE_ACTION_CLEAR 0u/);
  assert.match(header, /PCE_VN_CACHE_ACTION_LOAD 1u/);
  assert.match(header, /PCE_VN_CACHE_SCOPE_VISUAL 0u/);
  assert.match(header, /PCE_VN_CACHE_SCOPE_BG 1u/);
  assert.match(header, /PCE_VN_CACHE_SCOPE_SPRITE 2u/);
  assert.match(header, /PCE_VN_CACHE_SCOPE_ADPCM 3u/);
  assert.match(header, /PCE_VN_CACHE_SCOPE_PSG 4u/);
  assert.match(header, /PCE_VN_CACHE_SCOPE_ALL 5u/);
  assert.doesNotMatch(header, /PCE_VN_COMMAND_PRELOAD/);
  assert.equal(generated.commandCount, 11);
  assert.equal(pack[5], 11);
  [
    vnManager.VN_CACHE_SCOPE_VISUAL,
    vnManager.VN_CACHE_SCOPE_BG,
    vnManager.VN_CACHE_SCOPE_SPRITE,
    vnManager.VN_CACHE_SCOPE_ADPCM,
    vnManager.VN_CACHE_SCOPE_PSG,
    vnManager.VN_CACHE_SCOPE_ALL,
  ].forEach((scope, index) => {
    assert.deepEqual(commandRecord(pack, index), {
      type: vnManager.VN_COMMAND_CACHE,
      assetIndex: -1,
      slot: 0,
      flags: vnManager.VN_CACHE_ACTION_CLEAR,
      arg0: scope,
      arg1: 0,
      x: 0,
      y: 0,
      messageIndex: -1,
      animationIndex: -1,
      sceneIndex: -1,
      choiceIndex: -1,
    });
  });
  assert.deepEqual(commandRecord(pack, 6), {
    type: vnManager.VN_COMMAND_CACHE,
    assetIndex: 0,
    slot: 0,
    flags: vnManager.VN_CACHE_ACTION_LOAD,
    arg0: vnManager.VN_CACHE_SCOPE_BG,
    arg1: 0,
    x: 2,
    y: 3,
    messageIndex: -1,
    animationIndex: -1,
    sceneIndex: -1,
    choiceIndex: -1,
  });
  assert.deepEqual(commandRecord(pack, 7), {
    type: vnManager.VN_COMMAND_CACHE,
    assetIndex: 0,
    slot: 2,
    flags: vnManager.VN_CACHE_ACTION_LOAD,
    arg0: vnManager.VN_CACHE_SCOPE_SPRITE,
    arg1: 0,
    x: 0,
    y: 0,
    messageIndex: -1,
    animationIndex: -1,
    sceneIndex: -1,
    choiceIndex: -1,
  });
  assert.deepEqual(commandRecord(pack, 8), {
    type: vnManager.VN_COMMAND_CACHE,
    assetIndex: 0,
    slot: 0,
    flags: vnManager.VN_CACHE_ACTION_LOAD,
    arg0: vnManager.VN_CACHE_SCOPE_ADPCM,
    arg1: 0,
    x: 0,
    y: 0,
    messageIndex: -1,
    animationIndex: -1,
    sceneIndex: -1,
    choiceIndex: -1,
  });
  assert.deepEqual(commandRecord(pack, 9), {
    type: vnManager.VN_COMMAND_CACHE,
    assetIndex: 0,
    slot: 0,
    flags: vnManager.VN_CACHE_ACTION_LOAD,
    arg0: vnManager.VN_CACHE_SCOPE_PSG,
    arg1: 0,
    x: 0,
    y: 0,
    messageIndex: -1,
    animationIndex: -1,
    sceneIndex: -1,
    choiceIndex: -1,
  });
  assert.equal(commandRecord(pack, 10).type, vnManager.VN_COMMAND_WAIT);
});

test('PCE VN manager injects internal ADPCM preload before voiced messages', () => {
  const projectDir = makeTempDir('pce-vn-auto-adpcm-preload-');
  const vnManager = loadVnManager();
  const voiceFile = path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin');
  fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
  fs.writeFileSync(voiceFile, Buffer.alloc(256, 0));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'voice', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', byteLength: 256 } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'message', text: 'A', voiceAssetId: 'voice' },
        { type: 'cache', action: 'load', scope: 'adpcm', assetId: 'voice' },
        { type: 'message', text: 'B', voiceAssetId: 'voice' },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands.length, 3);
  const generated = vnManager.generateVnSources(projectDir);
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(generated.commandCount, 4);
  assert.equal(pack[5], 4);
  assert.equal(commandRecord(pack, 0).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 0).arg0, vnManager.VN_CACHE_SCOPE_ADPCM);
  assert.equal(commandRecord(pack, 1).type, vnManager.VN_COMMAND_MESSAGE);
  assert.equal(commandRecord(pack, 2).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 3).type, vnManager.VN_COMMAND_MESSAGE);
});

test('PCE VN manager hoists the first internal ADPCM preload to the scene head when safe', () => {
  const projectDir = makeTempDir('pce-vn-hoist-adpcm-preload-');
  const vnManager = loadVnManager();
  const voiceFile = path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin');
  fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
  fs.writeFileSync(voiceFile, Buffer.alloc(256, 0));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'voice', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', byteLength: 256 } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    variables: [{ name: 'seen', initialValue: 0 }],
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'variable', variableName: 'seen', operation: 'set', value: 1 },
        { type: 'message', text: 'A', voiceAssetId: 'voice' },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(generated.commandCount, 3);
  assert.equal(commandRecord(pack, 0).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 0).arg0, vnManager.VN_CACHE_SCOPE_ADPCM);
  assert.equal(commandRecord(pack, 1).type, vnManager.VN_COMMAND_VARIABLE);
  assert.equal(commandRecord(pack, 2).type, vnManager.VN_COMMAND_MESSAGE);
});

test('PCE VN manager reloads later message voices after a hoisted ADPCM preload', () => {
  const projectDir = makeTempDir('pce-vn-multi-adpcm-preload-');
  const vnManager = loadVnManager();
  const voiceAFile = path.join(projectDir, 'assets', 'generated', 'voice_a', 'adpcm.bin');
  const voiceBFile = path.join(projectDir, 'assets', 'generated', 'voice_b', 'adpcm.bin');
  fs.mkdirSync(path.dirname(voiceAFile), { recursive: true });
  fs.mkdirSync(path.dirname(voiceBFile), { recursive: true });
  fs.writeFileSync(voiceAFile, Buffer.alloc(256, 0));
  fs.writeFileSync(voiceBFile, Buffer.alloc(512, 0));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'voice_a', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice_a/adpcm.bin', byteLength: 256 } } },
      { id: 'voice_b', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice_b/adpcm.bin', byteLength: 512 } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'message', text: 'A', voiceAssetId: 'voice_a' },
        { type: 'message', text: 'B', voiceAssetId: 'voice_b' },
        { type: 'message', text: 'C', voiceAssetId: 'voice_a' },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(generated.commandCount, 6);
  assert.equal(commandRecord(pack, 0).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 0).assetIndex, 0);
  assert.equal(commandRecord(pack, 1).type, vnManager.VN_COMMAND_MESSAGE);
  assert.equal(commandRecord(pack, 2).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 2).assetIndex, 1);
  assert.equal(commandRecord(pack, 3).type, vnManager.VN_COMMAND_MESSAGE);
  assert.equal(commandRecord(pack, 4).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 4).assetIndex, 0);
  assert.equal(commandRecord(pack, 5).type, vnManager.VN_COMMAND_MESSAGE);
});

test('PCE VN manager accepts fitting buffered message voices but rejects oversized voices', () => {
  const projectDir = makeTempDir('pce-vn-buffered-voice-reject-');
  const vnManager = loadVnManager();
  const voiceFile = path.join(projectDir, 'assets', 'generated', 'voice', 'adpcm.bin');
  fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
  fs.writeFileSync(voiceFile, Buffer.alloc(1024, 0));
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'voice', type: 'adpcm', data: { generated: { outputFile: 'assets/generated/voice/adpcm.bin', byteLength: 1024 } } },
      { id: 'large_voice', type: 'adpcm', data: { generated: { byteLength: 40000 } } },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', text: 'A', voiceAssetId: 'voice' }],
    }],
  });
  const generated = vnManager.generateVnSources(projectDir);
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(generated.commandCount, 2);
  assert.equal(commandRecord(pack, 0).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 1).type, vnManager.VN_COMMAND_MESSAGE);

  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [{ type: 'message', text: 'B', voiceAssetId: 'large_voice' }],
    }],
  });
  assert.throws(
    () => vnManager.generateVnSources(projectDir),
    /exceeding buffered ADPCM limit/
  );
});

test('PCE VN manager emits variable, branch, switch, label, and goto commands', () => {
  const projectDir = makeTempDir('pce-vn-control-vm-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'variable', variableName: 'score', operation: 'define', value: 2 },
        { type: 'choice', variableName: 'choice_result', choices: [{ label: '左', value: 7 }, { label: '右', value: 8 }] },
        { type: 'label', name: 'check' },
        { type: 'if', variableName: 'score', operator: 'gte', value: 2, targetLabel: 'has_score', elseLabel: 'no_score' },
        { type: 'label', name: 'has_score' },
        { type: 'variable', variableName: 'score', operation: 'add', value: 3 },
        { type: 'switch', variableName: 'score', cases: [{ value: 5, targetLabel: 'route_a' }, { value: 8, targetLabel: 'no_score' }], defaultLabel: 'no_score' },
        { type: 'label', name: 'route_a' },
        { type: 'goto', targetLabel: 'end' },
        { type: 'label', name: 'no_score' },
        { type: 'variable', variableName: 'roll', operation: 'random', min: 1, max: 6 },
        { type: 'label', name: 'end' },
        { type: 'wait', frames: 1 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[0].type, 'variable');
  assert.equal(normalized.scenes[0].commands[1].variableName, 'choice_result');
  assert.equal(normalized.scenes[0].commands[1].choices[0].value, 7);
  assert.equal(normalized.scenes[0].commands[3].targetLabel, 'has_score');
  assert.equal(normalized.scenes[0].commands[6].cases.length, 2);
  assert.equal(normalized.scenes[0].commands[8].targetLabel, 'end');

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(generated.variableCount, 3);
  assert.equal(generated.choiceCount, 1);
  assert.equal(generated.switchCount, 1);
  assert.equal(generated.commandCount, 13);
  assert.match(header, /PCE_VN_COMMAND_VARIABLE 8u/);
  assert.match(header, /PCE_VN_COMMAND_IF 9u/);
  assert.match(header, /PCE_VN_COMMAND_SWITCH 10u/);
  assert.match(header, /PCE_VN_COMMAND_LABEL 11u/);
  assert.match(header, /PCE_VN_COMMAND_GOTO 12u/);
  assert.match(header, /PCE_VN_VARIABLE_STORAGE_COUNT 3u/);
  assert.match(header, /signed int voice_index;/);
  assert.match(header, /signed int mouth_animation_index;/);
  assert.match(header, /signed int target_scene;/);
  assert.match(header, /signed int variable_index;/);
  assert.match(header, /signed int asset_index;/);
  assert.match(header, /signed int message_index;/);
  assert.match(header, /signed int animation_index;/);
  assert.match(header, /signed int scene_index;/);
  assert.match(header, /signed int choice_index;/);
  assert.match(header, /signed int next_scene;/);
  assert.match(header, /typedef struct \{\n  signed int value;\n  unsigned int command;\n\} pce_vn_switch_case_t;/);
  assert.match(header, /unsigned int options_offset;/);
  assert.match(header, /unsigned int cases_offset;/);
  assert.match(source, /const signed int PCE_VN_DATA_SECTION pce_vn_variable_initial_values\[\] = \{\n  2,\n  0,\n  0\n\};/);
  assert.equal(pack[5], 13);
  assert.equal(pack[7], 1);
  assert.equal(pack[8], 1);
  assert.equal(commandRecord(pack, 0).type, vnManager.VN_COMMAND_VARIABLE);
  assert.equal(commandRecord(pack, 0).assetIndex, 0);
  assert.equal(commandRecord(pack, 0).arg0, 2);
  assert.equal(commandRecord(pack, 3).type, vnManager.VN_COMMAND_IF);
  assert.equal(commandRecord(pack, 3).flags, 5);
  assert.equal(commandRecord(pack, 3).x, 4);
  assert.equal(commandRecord(pack, 3).y, 9);
  const choice = choiceRecord(pack, 0);
  assert.equal(choice.variableIndex, 1);
  assert.equal(choiceOptionRecord(pack, choice, 0).value, 7);
  const branch = switchRecord(pack, 0);
  assert.equal(branch.caseCount, 2);
  assert.equal(branch.defaultCommand, 9);
  assert.deepEqual(switchCaseRecord(pack, branch, 0), { value: 5, command: 7 });
  assert.deepEqual(switchCaseRecord(pack, branch, 1), { value: 8, command: 9 });
  assert.equal(commandRecord(pack, 8).type, vnManager.VN_COMMAND_GOTO);
  assert.equal(commandRecord(pack, 8).x, 11);
  assert.equal(commandRecord(pack, 10).type, vnManager.VN_COMMAND_VARIABLE);
  assert.equal(commandRecord(pack, 10).assetIndex, 2);
  assert.equal(commandRecord(pack, 10).flags, 4);
  assert.equal(commandRecord(pack, 10).x, 1);
  assert.equal(commandRecord(pack, 10).y, 6);
});

test('PCE VN manager compiles PSG audio to System Card main/sub packages', () => {
  const projectDir = makeTempDir('pce-vn-psg-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'chime', name: 'chime', type: 'psg-sfx', options: {} },
      { id: 'theme', name: 'theme', type: 'psg-song', options: {} },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'theme', channel: 3 },
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'chime', channel: 4 },
        { type: 'audio', kind: 'psg', action: 'stop', target: 'bgm' },
        { type: 'audio', kind: 'psg', action: 'stop' },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[0].channel, 3);
  assert.equal(normalized.scenes[0].commands[2].target, 'bgm');
  assert.equal(normalized.scenes[0].commands[3].target, 'all');

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_SYSTEM_CARD_PROFILE_JP_V3 1/);
  assert.match(header, /pce_vn_system_psg_package_t/);
  assert.doesNotMatch(header, /pce_vn_psg_asset_t|pce_editor_psg_step_t/);
  assert.match(source, /pce_vn_system_psg_package_count = 2u/);

  const bgm = commandRecord(pack, 0);
  const sfx = commandRecord(pack, 1);
  assert.equal(bgm.flags, vnManager.VN_AUDIO_KIND_PSG | 0x10);
  assert.equal(bgm.assetIndex, 0);
  assert.equal(bgm.slot, 0);
  assert.equal(sfx.assetIndex, 1);
  assert.equal(sfx.slot, 0);
  assert.equal(commandRecord(pack, 2).arg0, vnManager.VN_PSG_STOP_BGM);
  assert.equal(commandRecord(pack, 3).arg0, vnManager.VN_PSG_STOP_ALL);

  const packageFiles = vnManager.collectCdDataFiles(projectDir)
    .filter((entry) => entry.includes('/system-card-psg/'));
  assert.equal(packageFiles.length, 2);
  packageFiles.forEach((entry) => assert.ok(fs.statSync(path.join(projectDir, entry)).size > 0));

  const runtime = readRuntimeSource().replace(/\r\n/g, '\n');
  assert.match(runtime, /PCE_CDB_USE_PSG_DRIVER\(1\);/);
  assert.match(runtime, /PCE_CDB_USE_GRAPHICS_DRIVER\(0\);/);
  assert.match(runtime, /vn_system_card_psg_bios_call\(1u, 0u, 0u\)[\s\S]*vn_system_card_psg_bios_call\(2u, 2u, 0u\)[\s\S]*vn_system_card_psg_bios_call\(3u, 134u, 135u\)[\s\S]*vn_system_card_psg_bios_call\(5u, 0x00u, 0x80u\)[\s\S]*vn_system_card_psg_bios_call\(4u, 0x20u, 0x80u\)[\s\S]*vn_system_card_psg_bios_call\(0u, 1u, 0u\)/);
  assert.match(runtime, /vn_system_card_vsync_irq\(void\)[\s\S]*jsr \$e0e1[\s\S]*inc vn_frame_epoch/);
  assert.match(runtime, /vn_system_psg_load_package[\s\S]*VN_CD_ASYNC_DEST_PSG_BANK[\s\S]*package\.data\.byte_size/);
  assert.match(runtime, /loaded_system_psg_package_key\[2\]/);
  assert.match(runtime, /stop_psg_target\(uint8_t target\)/);
  assert.doesNotMatch(runtime, /vn_psg_timer_irq_handler|vn_vblank_credit|psg_frames_per_step/);
});

test('PCE HuCARD VN generation keeps scene-pack commands and strips CD audio output', () => {
  const projectDir = makeTempDir('pce-vn-hucard-gen-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      { id: 'voice', type: 'adpcm' },
      { id: 'track', type: 'cdda-track', options: { track: 2 } },
      {
        id: 'theme',
        type: 'psg-song',
        options: {
          period: 384,
          bpm: 120,
          steps: 4,
          pattern: [
            { step: 0, channel: 0, period: 384, volume: 20, wave: 9 },
            { step: 2, channel: 4, period: 8, volume: 12, noise: 1 },
          ],
        },
      },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    settings: { messageSpeedFrames: 50 },
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'variable', operation: 'define', variableName: 'route', value: 0 },
        { type: 'audio', kind: 'psg', action: 'play', assetId: 'theme', channel: 2 },
        { type: 'audio', kind: 'adpcm', action: 'play', assetId: 'voice' },
        { type: 'audio', kind: 'cdda', action: 'play', assetId: 'track' },
        { type: 'message', speaker: 'PCE', text: 'AB', voiceAssetId: 'voice', textSpeedFrames: 0 },
        { type: 'inputcheck', mode: 'async', buttons: ['run'], targetLabel: 'skip' },
        { type: 'spritetext', text: 'GO', x: 32, y: 24, visible: true },
        { type: 'cache', action: 'load', scope: 'adpcm', assetId: 'voice' },
        { type: 'label', name: 'skip' },
        { type: 'choice', variableName: 'route', choices: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir, { targetMedia: 'hucard' });
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);

  assert.equal(generated.targetMedia, 'hucard');
  assert.deepEqual(generated.visualAssetIds, []);
  assert.deepEqual(generated.psgAssetIds, ['theme']);
  assert.ok(generated.extraDataFiles.some((entry) => entry.symbol === 'pce_vn_font_data_ref'));
  assert.ok(generated.extraDataFiles.some((entry) => entry.symbol === 'pce_vn_scene_pack_ref_0'));
  assert.ok(generated.extraDataFiles.some((entry) => entry.symbol === 'pce_vn_font_sprite_data_ref'));
  assert.ok(generated.extraDataFiles.some((entry) => entry.symbol === 'pce_vn_psg_pattern_ref_0'));
  assert.ok(generated.extraDataFiles.every((entry) => entry.forceBanked === true));
  assert.equal(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'psg', 'theme.bin')), true);
  const psgPattern = fs.readFileSync(path.join(projectDir, 'assets', 'generated', 'vn', 'psg', 'theme.bin'));
  assert.equal(psgPattern.length, 16);
  assert.equal(psgPattern[7], 9);
  assert.equal(psgPattern[15], 45);

  assert.match(header, /#include "assets\.h"/);
  assert.match(header, /const pce_editor_data_ref_t \*data;/);
  assert.match(header, /typedef struct \{[\s\S]*const pce_editor_data_ref_t \*pattern;[\s\S]*\} pce_vn_psg_asset_t;/);
  assert.doesNotMatch(header, /pce_vn_cd_data_ref_t/);
  assert.doesNotMatch(source, /PCE_VN_DATA_SECTION|pce_vn_font_tiles\[\]|pce_vn_cd_data_ref_t/);
  assert.match(source, /const pce_vn_scene_pack_t pce_vn_scene_packs\[\] = \{\r?\n  \{ &pce_vn_scene_pack_ref_0,/);
  assert.match(source, /const pce_vn_psg_asset_t pce_vn_psg_assets\[\] = \{\r?\n  \{ 1u, 384u, 120u, 4u, &pce_vn_psg_pattern_ref_0, 2u \}/);

  const psg = commandRecord(pack, 1);
  assert.equal(psg.type, vnManager.VN_COMMAND_AUDIO);
  assert.equal(psg.assetIndex, 0);
  assert.equal(psg.slot, 2);
  assert.equal(psg.flags, vnManager.VN_AUDIO_KIND_PSG | 0x10);
  assert.equal(commandRecord(pack, 2).assetIndex, -1);
  assert.equal(commandRecord(pack, 3).assetIndex, -1);
  const message = messageRecord(pack, 0);
  assert.equal(message.voiceIndex, -1);
  assert.equal(message.textSpeedFrames, 50);
  assert.equal(message.mouthSlot, 0);
  assert.equal(message.instantGlyphCount, 5);
  assert.equal(message.glyphCount, 7);
  assert.equal(commandRecord(pack, 5).type, vnManager.VN_COMMAND_INPUTCHECK);
  assert.equal(commandRecord(pack, 6).type, vnManager.VN_COMMAND_SPRITETEXT);
  assert.equal(commandRecord(pack, 7).type, vnManager.VN_COMMAND_CACHE);
  assert.equal(commandRecord(pack, 7).assetIndex, -1);
  assert.equal(commandRecord(pack, 9).type, vnManager.VN_COMMAND_CHOICE);
});

test('PCE VN manager encodes the input check command with button mask and modes', () => {
  const projectDir = makeTempDir('pce-vn-input-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'inputcheck', mode: 'sync', buttons: ['i', 'right'], targetLabel: 'go' },
        { type: 'inputcheck', mode: 'async', buttons: ['ii'], targetLabel: 'go' },
        { type: 'inputcheck', mode: 'cancel' },
        { type: 'label', name: 'go' },
        { type: 'wait', frames: 1 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.deepEqual(normalized.scenes[0].commands[0].buttons, ['right', 'i']);
  assert.equal(normalized.scenes[0].commands[2].mode, 'cancel');
  assert.deepEqual(normalized.scenes[0].commands[2].buttons, []);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_COMMAND_INPUTCHECK 13u/);
  assert.match(header, /PCE_VN_INPUT_MODE_SYNC 0u/);
  assert.match(header, /PCE_VN_INPUT_MODE_ASYNC 1u/);
  assert.match(header, /PCE_VN_INPUT_MODE_CANCEL 2u/);
  const labelIndex = 3; // 'go' label is the 4th command
  const sync = commandRecord(pack, 0);
  assert.equal(sync.type, vnManager.VN_COMMAND_INPUTCHECK);
  assert.equal(sync.flags, vnManager.VN_INPUT_MODE_SYNC);
  assert.equal(sync.arg0, vnManager.inputButtonsMask(['i', 'right']));
  assert.equal(sync.x, labelIndex);
  const asyncCmd = commandRecord(pack, 1);
  assert.equal(asyncCmd.flags, vnManager.VN_INPUT_MODE_ASYNC);
  const cancel = commandRecord(pack, 2);
  assert.equal(cancel.flags, vnManager.VN_INPUT_MODE_CANCEL);
  assert.equal(cancel.x, 0xffff); // no target for cancel

  const runtime = readRuntimeSource();
  assert.match(runtime, /command->type == PCE_VN_COMMAND_INPUTCHECK/);
  assert.match(runtime, /sync_input_active = 1u;/);
  assert.match(runtime, /async_input_active = 1u;/);
});

test('PCE VN manager encodes spritetext overlays for on-demand BIOS glyphs', () => {
  const projectDir = makeTempDir('pce-vn-spritetext-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'spritetext', slot: 0, text: 'PRESS RUN', x: 96, y: 180, color: '#ffff00', blinkFrames: 30, visible: true },
        { type: 'spritetext', slot: 0, visible: false },
        { type: 'wait', frames: 1 },
      ],
      nextSceneId: '',
    }],
  });

  // Two unique scenes share one sprite font; only spritetext chars are encoded.
  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[0].type, 'spritetext');
  assert.deepEqual(vnManager.collectSpriteTextGlyphsRaw(normalized), ['P', 'R', 'E', 'S', ' ', 'U', 'N']);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.match(header, /PCE_VN_COMMAND_SPRITETEXT 14u/);
  const spritePatternBaseMatch = header.match(/#define PCE_VN_FONT_SPRITE_PATTERN_BASE (\d+)u/);
  assert.ok(spritePatternBaseMatch);
  assert.equal(Number(spritePatternBaseMatch[1]) % 2, 0, '16x16 SpriteText patterns must start on an even pattern unit');
  assert.match(header, /#define PCE_VN_FONT_SPRITE_PALETTE_BANK 15u/);
  assert.doesNotMatch(source, /pce_vn_font_sprite/);
  assert.equal(generated.fontSpriteGlyphCount, 0);
  assert.equal(generated.fontSpriteByteSize, 0);
  assert.equal(fs.existsSync(path.join(projectDir, vnManager.VN_FONT_SPRITE_DATA_FILE)), false);

  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  const show = commandRecord(pack, 0);
  assert.equal(show.type, vnManager.VN_COMMAND_SPRITETEXT);
  assert.equal(show.slot, 0);
  assert.equal(show.flags, vnManager.VN_SPRITE_VISIBLE);
  assert.equal(show.arg0, 30); // blinkFrames
  assert.equal(show.arg1, 9); // glyph count incl. space
  assert.equal(show.x, 96);
  assert.equal(show.y, 180);
  assert.equal(show.messageIndex, 0x1f8); // #ffff00 -> 9-bit GRB
  // Glyph stream is fixed-width Shift-JIS after ASCII-to-fullwidth normalization.
  const encoded = require('../pce-system-card-font').encodeSystemCardText('PRESS RUN');
  assert.deepEqual(pack.subarray(show.assetIndex, show.assetIndex + 18), encoded.buffer.subarray(0, 18));

  const hide = commandRecord(pack, 1);
  assert.equal(hide.type, vnManager.VN_COMMAND_SPRITETEXT);
  assert.equal(hide.flags, 0); // visible:false clears the slot
  assert.equal(hide.arg1, 0);

  const runtime = readRuntimeSource();
  assert.match(runtime, /command->type == PCE_VN_COMMAND_SPRITETEXT/);
  assert.match(runtime, /draw_spritetext_slots\(uint8_t satb_index\)/);
  assert.match(runtime, /vn_system_card_font12_sprite_upload\(glyph,[\s\S]*PCE_VN_FONT_SPRITE_PATTERN_BASE[\s\S]*i << 1/);
  assert.match(runtime, /vn_system_card_get_font\(sjis, 1u, vn_system_card_font_scratch\)/);
  assert.match(runtime, /#define VN_SPRITETEXT_PITCH_X VN_GLYPH_W/);
  assert.match(runtime, /x = \(int16_t\)\(x \+ VN_SPRITETEXT_PITCH_X\)/);
  assert.match(runtime, /spritetext_glyph_cache_ids\[64\]/);
  assert.match(runtime, /static void tick_spritetext\(void\)/);

  const hucardRuntime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_hucard', 'src', 'pce_vn_hucard_runtime.c'),
    'utf-8',
  );
  assert.match(hucardRuntime, /#define VN_SPRITETEXT_PITCH_X VN_GLYPH_W/);
  assert.match(hucardRuntime, /col \* VN_SPRITETEXT_PITCH_X/);

  const editorRenderer = fs.readFileSync(
    path.join(__dirname, '..', 'plugins', 'pce-visual-novel-editor', 'renderer.js'),
    'utf-8',
  );
  assert.equal((editorRenderer.match(/12px\/16px monospace/g) || []).length, 2);
  assert.equal((editorRenderer.match(/renderSpriteTextCells\(node, st\.text\)/g) || []).length, 2);
  assert.match(editorRenderer, /SPRITETEXT_CELL = \{ width: 12, height: 16 \}/);
  assert.doesNotMatch(editorRenderer, /16px\/16px monospace/);
});

test('PCE VN manager omits the sprite font when no scene uses spritetext', () => {
  const projectDir = makeTempDir('pce-vn-no-spritetext-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', text: 'hi' }], nextSceneId: '' }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  assert.equal(generated.fontSpriteGlyphCount, 0);
  assert.equal(fs.existsSync(path.join(projectDir, vnManager.VN_FONT_SPRITE_DATA_FILE)), false);
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  assert.doesNotMatch(source, /pce_vn_font_sprite/);
});

test('PCE VN manager normalizes message text color and clears empty bodies', () => {
  const projectDir = makeTempDir('pce-vn-color-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'message', text: 'あか', textColor: '#ff0000' },
        { type: 'message', text: '' },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  // First message keeps a PCE-snapped red; second message stays empty (cleared).
  assert.equal(normalized.scenes[0].commands[0].textColor, '#ff0000');
  assert.equal(normalized.scenes[0].commands[1].text, '');
  assert.equal(normalized.scenes[0].commands[1].textColor, '');

  // 9-bit PCE word for pure red is G(0)<<6 | R(7)<<3 | B(0) = 0x38.
  assert.equal(vnManager.messageColorWord('#ff0000'), 0x38);
  assert.equal(vnManager.normalizeMessageColor('#123456'), '#002449');
  assert.equal(vnManager.messageColorWord(''), vnManager.VN_MESSAGE_COLOR_NONE);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_SCENE_PACK_MESSAGE_SIZE 13u/);
  assert.doesNotMatch(header, /instant_glyph_count/);
  assert.match(header, /unsigned int text_color;/);
  assert.equal(messageRecord(pack, 0).textColor, 0x38);
  assert.equal(messageRecord(pack, 1).textColor, vnManager.VN_MESSAGE_COLOR_NONE);

  const runtime = readRuntimeSource();
  assert.match(runtime, /apply_message_text_color\(message->text_color\)/);
  assert.match(runtime, /#define VN_MESSAGE_INSTANT_GLYPH_COUNT\(info\) \(\(uint8_t\)\(\(info\) >> 2u\)\)/);
  assert.match(runtime, /message->mouth_slot = scene_pack_u8\(cache, \(uint16_t\)\(offset \+ 10u\)\)/);
  assert.match(runtime, /message->text_color = scene_pack_u16/);
});

test('PCE VN manager allows script totals past 255 when each scene pack fits', () => {
  const projectDir = makeTempDir('pce-vn-wide-script-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: Array.from({ length: 3 }, (_, sceneIndex) => ({
      id: sceneIndex === 0 ? 'opening' : `part_${sceneIndex}`,
      commands: Array.from({ length: 100 }, (_, index) => ({
        type: 'message',
        text: `A${sceneIndex}_${index}`,
        textSpeedFrames: 0,
      })),
      nextSceneId: sceneIndex < 2 ? `part_${sceneIndex + 1}` : '',
    })),
  });

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');

  assert.equal(generated.messageCount, 300);
  assert.equal(generated.commandCount, 300);
  assert.equal(generated.sceneCount, 3);
  assert.equal(generated.scenePackPaths.length, 3);
  assert.ok(generated.scenePackBytes.every((size) => size <= vnManager.VN_SCENE_PACK_CACHE_BYTES));
  assert.match(header, /signed int message_index;/);
  assert.match(source, /const unsigned char PCE_VN_DATA_SECTION pce_vn_scene_count = 3;/);
  assert.doesNotMatch(source, /pce_vn_message_count|pce_vn_command_count/);
  generated.scenePackPaths.forEach((packPath) => {
    const pack = readPack(projectDir, packPath);
    assert.equal(pack[5], 100);
    assert.equal(pack[6], 100);
  });
});

test('PCE VN manager rejects one scene pack over the runtime cache size', () => {
  const projectDir = makeTempDir('pce-vn-pack-overflow-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: Array.from({ length: 140 }, (_, index) => ({
        type: 'message',
        text: `LONG_MESSAGE_${index}`,
        textSpeedFrames: 0,
      })),
    }],
  });

  assert.throws(
    () => vnManager.generateVnSources(projectDir),
    /scene pack "opening" is \d+ bytes; split the scene to stay within 8192 bytes/
  );
});

test('PCE VN manager expands default sprite animation to the whole sprite sheet', () => {
  const projectDir = makeTempDir('pce-vn-sprite-default-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: {
          width: 64,
          height: 128,
          cellWidth: 16,
          cellHeight: 16,
        },
        data: {
          generated: {
            width: 64,
            height: 128,
            cellColumns: 4,
            cellRows: 8,
          },
        },
      },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'sprite', assetId: 'hero', x: 128, y: 24, visible: true },
        { type: 'message', text: 'A', textSpeedFrames: 0, advance: 'manual' },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(generated.spriteAnimationCount, 0);
  assert.equal(commandRecord(pack, 0).animationIndex, -1);
  assert.match(header, /PCE_VN_HAS_FULL_SCREEN_BG 0u/);
  assert.match(header, /PCE_VN_HAS_SPRITE_ANIMATIONS 0u/);
  assert.match(source, /const unsigned int PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = 0;/);
  assert.doesNotMatch(source, /pce_vn_sprite_anim_delays_0/);
});

test('PCE VN manager emits per-frame sprite delays and the runtime honors them', () => {
  const projectDir = makeTempDir('pce-vn-sprite-perframe-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'hero',
        type: 'sprite',
        source: 'assets/sprites/hero.png',
        options: {
          width: 64,
          height: 32,
          cellWidth: 16,
          cellHeight: 16,
          // Per-row time matrix saved by the sprite editor: row 0 has distinct
          // per-frame times, row 1 is uniform.
          spriteEditor: { time: '[[10,20,30,40][6,6,6,6]]' },
          animations: [
            { id: 'default', frameWidth: 64, frameHeight: 16, firstCell: 0, frameCount: 4, frameDelay: 8, frameStrideCells: 1 },
            { id: 'row_1', frameWidth: 64, frameHeight: 16, firstCell: 4, frameCount: 4, frameDelay: 6, frameStrideCells: 1 },
          ],
        },
      },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'sprite', assetId: 'hero', x: 16, y: 24, animationId: 'default', visible: true },
        { type: 'message', text: 'A', textSpeedFrames: 0 },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const source = fs.readFileSync(generated.sourcePath, 'utf-8');
  // Per-frame times are migrated from spriteEditor.time into a resident table the
  // animation record points at. Uniform rows use frame_delay directly and do not
  // spend resident rodata on a redundant table.
  assert.match(source, /pce_vn_sprite_anim_delays_0\[\] = \{ 10u, 20u, 30u, 40u \}/);
  assert.doesNotMatch(source, /pce_vn_sprite_anim_delays_1/);
  assert.match(source, /\{ \d+u, 4u, 4u, 6u, 4u, 1u, 1u, 1u, \(const unsigned char \*\)0 \}/);

  const runtime = readRuntimeSource();
  // The animation tick must index the per-frame table by the current frame.
  assert.match(runtime, /slot->anim_frame_delays\[slot->frame\]/);
});

test('PCE VN runtime owns only the System Card user VSync vector', () => {
  const wrapperPaths = [
    path.join(__dirname, '..', 'plugins', 'pce-visual-novel-builder', 'template-vn', 'src', 'main.c'),
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'main.c'),
  ];
  for (const wrapperPath of wrapperPaths) {
    assert.equal(fs.readFileSync(wrapperPath, 'utf-8').trim(), '#include "pce_vn_runtime.c"');
  }

  const source = readRuntimeSource().replace(/\r\n/g, '\n');
  assert.match(source, /#define VN_VDC_CONTROL_BASE \(VDC_CONTROL_IRQ_VBLANK \| VDC_CONTROL_DRAM_REFRESH \| VDC_CONTROL_VRAM_ADD_1\)/);
  assert.match(source, /#define VN_SC_IRQ_FORBIDDEN_MASK \(\(uint8_t\)\(PCE_CDB_MASK_VBLANK \| PCE_CDB_MASK_VBLANK_NO_BIOS\)\)/);
  assert.match(source, /mask = \(uint8_t\)\(\(mask & PCE_CDB_MASK_IRQ_EXTERNAL\) \| VN_SC_IRQ_USER_MASK\);[\s\S]*mask = \(uint8_t\)\(mask & \(uint8_t\)~VN_SC_IRQ_FORBIDDEN_MASK\);/);
  assert.match(source, /pce_cdb_irq_set\(PCE_CDB_ID_IRQ_VDC, vn_system_card_vsync_irq\);/);
  assert.match(source, /vn_system_card_vsync_irq\(void\)[\s\S]*lda \$0000[\s\S]*and #\$20[\s\S]*jsr \$e0e1[\s\S]*inc vn_frame_epoch[\s\S]*rti/);
  assert.match(source, /vn_wait_next_vblank_raw\(void\)[\s\S]*const uint16_t start = vn_frame_epoch;[\s\S]*while \(vn_frame_epoch == start\)/);
  const wait = source.match(/static void VN_BANKED_CODE vn_wait_next_vblank_raw\(void\)[\s\S]*?\n\}/);
  assert.ok(wait);
  assert.doesNotMatch(wait[0], /IO_VDC_STATUS|lda \$0000/);
  assert.doesNotMatch(source, /vn_psg_timer_irq_handler|vn_vblank_credit|pce_timer_set|pce_timer_enable/);

  assert.match(source, /PCE_RAM_BANK_AT\(123, 6\);/);
  assert.match(source, /active_scene_pack_bank\[8192\][\s\S]*section\("\.ram_bank123"\)/);
  assert.match(source, /scene_pack_u8[\s\S]*tma #\$40[\s\S]*lda #123[\s\S]*tam #\$40[\s\S]*cache->base[\s\S]*tam #\$40/);
  assert.match(source, /cache->valid = \(uint8_t\)\(vn_cd_async_status == VN_CD_ASYNC_STATUS_DONE\);[\s\S]*if \(cache->valid && !scene_pack_is_valid\(cache\)\) cache->valid = 0u;/);
  assert.doesNotMatch(source, /cache->valid = \(uint8_t\)\(vn_cd_async_status == VN_CD_ASYNC_STATUS_DONE && scene_pack_is_valid\(cache\)\)/);
  assert.match(source, /vn_scene_text_buffer\[VN_MESSAGE_GLYPH_CACHE_COUNT \* 2u\]/);

  assert.match(source, /jsr \$e060/);
  assert.match(source, /vn_system_card_font12_mask/);
  assert.match(source, /vn_system_card_font12_sprite_upload/);
  assert.match(source, /message_glyph_cache_masks\[VN_MESSAGE_GLYPH_CACHE_COUNT\]\[VN_GLYPH_MASK_ROWS\]/);
  assert.doesNotMatch(source, /PCE_VN_FONT_MASK_VRAM_WORD|upload_font_tiles\(|upload_font_sprite_patterns\(/);
  assert.match(source, /vn_system_card_show_failure/);
  assert.match(source, /if \(!vn_system_card_probe_ok\) vn_system_card_show_failure\(\);/);
  const videoRestoreStart = source.indexOf('static void VN_BANKED_CODE restore_video_after_cdb_call(uint8_t restore_display)\n{');
  assert.notEqual(videoRestoreStart, -1);
  const videoRestoreEnd = source.indexOf('\n}', videoRestoreStart);
  const videoRestore = source.slice(videoRestoreStart, videoRestoreEnd + 2);
  assert.match(videoRestore, /vn_system_card_irq_rearm\(\)/);
  assert.doesNotMatch(videoRestore, /pce_irq_disable\(IRQ_VDC\)/);

  assert.match(source, /VN_CD_ASYNC_DEST_ADPCM_RAM/);
  assert.match(source, /pad_edge_reset_pending = 1u/);
  assert.doesNotMatch(source, /while \(pce_cdb_adpcm_status\(\)\)/);
  assert.doesNotMatch(source, /service_adpcm_playback[\s\S]{0,500}pce_cdb_adpcm_stop\(\)/);
});

test('PCE VN manager emits synchronous and asynchronous sprite movement in the fixed command record', () => {
  const projectDir = makeTempDir('pce-vn-sprite-move-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'hero',
      type: 'sprite',
      source: 'assets/sprites/hero.png',
      options: {
        width: 64,
        height: 32,
        cellWidth: 16,
        cellHeight: 16,
        animations: [
          { id: 'default', frameWidth: 16, frameHeight: 16, firstCell: 0, frameCount: 2, frameDelay: 8, frameStrideCells: 1 },
          { id: 'walk', frameWidth: 16, frameHeight: 16, firstCell: 4, frameCount: 2, frameDelay: 6, frameStrideCells: 1 },
        ],
      },
      data: { generated: { width: 64, height: 32, cellColumns: 4, cellRows: 2 } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'sprite', slot: 2, assetId: 'hero', x: 16, y: 24, animationId: 'default', visible: true },
        { type: 'spritemove', slot: 2, x: 300, y: 7, frames: 513, async: true, animationAssetId: 'hero', animationId: 'walk' },
        { type: 'spritemove', slot: 2, x: 10, y: 200, frames: 30 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.deepEqual(normalized.scenes[0].commands[1], {
    type: 'spritemove',
    slot: 2,
    x: 300,
    y: 7,
    frames: 513,
    async: true,
    animationAssetId: 'hero',
    animationId: 'walk',
  });
  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  const asyncMove = commandRecord(pack, 1);
  const syncMove = commandRecord(pack, 2);
  assert.equal(pack[5], 3);
  assert.equal(asyncMove.type, vnManager.VN_COMMAND_SPRITE_MOVE);
  assert.equal(asyncMove.assetIndex, 0);
  assert.equal(asyncMove.slot, 2);
  assert.equal(asyncMove.flags, vnManager.VN_SPRITE_MOVE_ASYNC);
  assert.equal(asyncMove.arg0, 1);
  assert.equal(asyncMove.arg1, 2);
  assert.equal(asyncMove.x, 300);
  assert.equal(asyncMove.y, 7);
  assert.equal(asyncMove.animationIndex, 1);
  assert.equal(syncMove.type, vnManager.VN_COMMAND_SPRITE_MOVE);
  assert.equal(syncMove.flags, 0);
  assert.equal(syncMove.arg0, 30);
  assert.equal(syncMove.arg1, 0);
  assert.equal(syncMove.assetIndex, -1);
  assert.equal(syncMove.animationIndex, -1);
  assert.match(header, /PCE_VN_COMMAND_SPRITE_MOVE 16u/);
  assert.match(header, /PCE_VN_SPRITE_MOVE_ASYNC 1u/);
  assert.match(header, /PCE_VN_SCENE_PACK_COMMAND_SIZE 19u/);

  const cdState = fs.readFileSync(path.join(TEMPLATE_VN_SRC_DIR, 'vn_engine_state.c'), 'utf-8');
  const cdSprite = fs.readFileSync(path.join(TEMPLATE_VN_SRC_DIR, 'vn_port_sprite.c'), 'utf-8');
  const cdScene = fs.readFileSync(path.join(TEMPLATE_VN_SRC_DIR, 'vn_port_scene.c'), 'utf-8');
  const huCard = fs.readFileSync(path.join(__dirname, '..', 'template', 'template_pce_vn_hucard', 'src', 'pce_vn_hucard_runtime.c'), 'utf-8');
  assert.match(cdState, /vn_sprite_move_t sprite_moves\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(cdSprite, /start_sprite_move[\s\S]*move->distance_x = distance_x[\s\S]*remaining_frames--/);
  assert.doesNotMatch(cdSprite, /distance_[xy] [\/%] frames/);
  assert.match(cdSprite, /sprite_shadow\[entry_index\]\.y[\s\S]*sprite_shadow\[entry_index\]\.x/);
  assert.match(cdScene, /command->type == PCE_VN_COMMAND_SPRITE_MOVE/);
  assert.match(huCard, /command\.type == PCE_VN_COMMAND_SPRITE_MOVE/);
  assert.match(huCard, /upload_sprite_table_now\(\)/);
});

test('PCE VN manager rejects sprite movement in full-screen BG scenes and reports invalid animation locations', () => {
  const projectDir = makeTempDir('pce-vn-sprite-move-invalid-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [{
      id: 'hero',
      type: 'sprite',
      options: { width: 16, height: 16, cellWidth: 16, cellHeight: 16 },
      data: { generated: { width: 16, height: 16, cellColumns: 1, cellRows: 1 } },
    }],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{ id: 'opening', fullScreenBg: true, commands: [{ type: 'spritemove', slot: 0, x: 10, y: 20, frames: 1 }] }],
  });
  assert.throws(() => vnManager.generateVnSources(projectDir), /fullScreenBg and cannot move sprites/);

  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'sprite', slot: 0, assetId: 'hero', x: 0, y: 0, visible: true },
        { type: 'spritemove', slot: 0, x: 10, y: 20, frames: 1, animationAssetId: 'hero', animationId: 'missing' },
      ],
    }],
  });
  assert.throws(
    () => vnManager.generateVnSources(projectDir),
    /scene "opening" command 2: spritemove animation "missing" is not defined/
  );

  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'sprite', slot: 0, assetId: 'hero', x: 0, y: 0, visible: true },
        { type: 'spritemove', slot: 0, x: 10, y: 20, frames: 1, animationAssetId: 'missing-sprite', animationId: 'default' },
      ],
    }],
  });
  assert.throws(
    () => vnManager.generateVnSources(projectDir),
    /scene "opening" command 2: spritemove animation "default" is not defined for sprite "missing-sprite"/
  );
});

test('PCE VN runtime cache clear only invalidates non-destructive cache flags', () => {
  const source = readRuntimeSource().replace(/\r\n/g, '\n');
  const helperStart = source.indexOf('static void VN_BANKED_CODE2 load_bg_cache_asset(signed int bg_index, uint8_t tile_x, uint8_t tile_y)\n{');
  const bgWrapperStart = helperStart;
  const spriteWrapperStart = source.indexOf('static void VN_BANKED_CODE load_sprite_pattern_cache_asset(signed int sprite_index, uint8_t slot_index)', bgWrapperStart);
  const clearImplStart = source.indexOf('static void VN_VISUAL_CACHE_CODE clear_runtime_cache_impl(uint8_t scope)\n{', helperStart);
  const clearHelperStart = source.indexOf('static void VN_BANKED_CODE2 clear_runtime_cache(uint8_t scope)', clearImplStart);
  const executeStart = source.indexOf('static uint8_t VN_BANKED_CODE execute_command', helperStart);
  const executeEnd = source.indexOf('static uint8_t VN_BANKED_CODE run_commands_until_wait', executeStart);
  // Phase A module split: execute_command moved to vn_port_scene.c, so the
  // cache helper slices end at the cache module's #undef block instead of
  // spanning the psg/adpcm/sprite modules that now sit in between.
  const cacheEnd = source.indexOf('#undef VN_CACHE_SCOPE_BIT', clearHelperStart);
  assert.notEqual(cacheEnd, -1);
  assert.notEqual(helperStart, -1);
  assert.notEqual(bgWrapperStart, -1);
  assert.notEqual(spriteWrapperStart, -1);
  assert.notEqual(clearImplStart, -1);
  assert.notEqual(clearHelperStart, -1);
  assert.notEqual(executeStart, -1);
  assert.notEqual(executeEnd, -1);
  const helperSource = source.slice(helperStart, cacheEnd);
  const bgWrapperSource = source.slice(bgWrapperStart, spriteWrapperStart);
  const spriteWrapperSource = source.slice(spriteWrapperStart, clearHelperStart);
  const clearImplSource = source.slice(clearImplStart, clearHelperStart);
  const clearHelperSource = source.slice(clearHelperStart, cacheEnd);
  const executeCommandSource = source.slice(executeStart, executeEnd);

  assert.match(source, /#define VN_ENABLE_VISUAL_PAYLOAD_CACHE 1/);
  assert.match(source, /#if VN_ENABLE_VISUAL_PAYLOAD_CACHE[\s\S]*PCE_RAM_BANK_AT\(121, 4\);[\s\S]*#define VN_VISUAL_CACHE_PAGE_COUNT 16u[\s\S]*#define VN_VISUAL_CACHE_FIRST_BANK 104u/);
  assert.match(source, /#define VN_VISUAL_CACHE_CD_READ_CHUNK_SECTORS 4u/);
  assert.match(source, /#define VN_VISUAL_CACHE_CD_READ_CHUNK_BYTES \(\(uint16_t\)\(VN_CD_SECTOR_BYTES \* VN_VISUAL_CACHE_CD_READ_CHUNK_SECTORS\)\)/);
  assert.doesNotMatch(source, /vn_visual_cache_copy_buffer|VN_VISUAL_CACHE_COPY_CHUNK|visual_cache_copy_scratch_to_page_impl/);
  assert.match(source, /#define VN_MAP_VISUAL_CACHE_CODE\(\) pce_ram_bank121_map\(\)/);
  assert.match(source, /#define VN_VISUAL_VRAM_COPY_SLICE_BYTES 16u/);
  assert.match(source, /#define VN_VISUAL_VRAM_COPY_FAST_SLICE_BYTES VN_CD_SECTOR_BYTES/);
  assert.match(source, /static void VN_BANKED_CODE vram_copy_sliced_from_vn_data\(uint16_t dest, const uint8_t \*source, uint16_t length\)[\s\S]*const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES\(\);[\s\S]*pce_editor_vram_copy\(vram_dest, &source\[offset\], chunk\);[\s\S]*engine_service\(\);[\s\S]*map_vn_data\(\);[\s\S]*VN_MAP_BANK130_FOR_CODE\(\);/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE visual_cache_ref_to_vram_impl\(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t \*ref\)[\s\S]*visual_cache_find_impl\(kind, asset_index, part\)[\s\S]*visual_cache_page_to_vram_impl\(vram_dest, slot, page_offset, chunk\)[\s\S]*return 1u;/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE visual_cache_bg_map_to_vram_impl\(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t \*ref, uint8_t width_tiles, uint8_t height_tiles\)[\s\S]*if \(width_tiles == VN_MAP_WIDTH\) return cd_data_ref_to_vram_visual_impl\(dest, ref\);[\s\S]*visual_cache_copy_span_to_vram_impl[\s\S]*VN_VISUAL_CACHE_KIND_BG_MAP[\s\S]*return 1u;/);
  assert.match(source, /static uint8_t VN_RESIDENT_CODE visual_cache_bg_map_to_vram\(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t \*ref, uint8_t width_tiles, uint8_t height_tiles\)[\s\S]*if \(!vn_visual_cache_code_loaded\) return 0u;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_BG_MAP_TO_VRAM\)/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_PRELOAD_REF 3u/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_COPY_REF_TO_VRAM 5u/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_TICK_SPRITE_ANIMATIONS 8u/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_LOAD_SPRITE_PATTERN_CACHE 9u/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_FADE_SCREEN 10u/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_RESTORE_SCREEN_PALETTE 11u/);
  assert.match(source, /#define VN_VISUAL_CACHE_OP_FLASH_SCREEN 12u/);
  assert.match(source, /static void VN_VISUAL_CACHE_CODE fade_current_screen_to_color_impl\(uint16_t target, uint8_t frames\)/);
  assert.match(source, /static void VN_VISUAL_CACHE_CODE flash_screen_color_impl\(uint16_t color, uint8_t frames\)/);
  assert.match(source, /static void VN_BANKED_CODE2 fade_current_screen_to_color\(uint16_t target, uint8_t frames\)[\s\S]*vn_visual_cache_arg_dest = target;[\s\S]*vn_visual_cache_arg_x = frames;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_FADE_SCREEN\);/);
  assert.match(source, /static void VN_BANKED_CODE2 flash_screen_color\(uint16_t color, uint8_t frames\)[\s\S]*vn_visual_cache_arg_dest = color;[\s\S]*vn_visual_cache_arg_x = frames;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_FLASH_SCREEN\);/);
  assert.doesNotMatch(source, /static void VN_BANKED_CODE2 fade_current_screen_to_color\(uint16_t target, uint8_t frames\)[\s\S]*mix_vce_color/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE visual_cache_copy_ref_to_vram_impl\(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t \*ref\)[\s\S]*visual_cache_ref_to_vram_impl\(dest, kind, asset_index, ref\)[\s\S]*return cd_data_ref_to_vram_visual_impl\(dest, ref\);/);
  assert.match(source, /static void VN_RESIDENT_CODE copy_data_ref_to_vram\(uint16_t dest, const pce_editor_data_ref_t \*ref, uint16_t word_stride, uint8_t cache_kind, uint16_t cache_asset_index\)[\s\S]*if \(!vn_visual_cache_code_loaded\) load_visual_cache_code\(\);[\s\S]*if \(!vn_visual_cache_code_loaded\) return;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_COPY_REF_TO_VRAM\)/);
  assert.match(source, /static void VN_BANKED_CODE visual_cache_preload_ref\(uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t \*ref\)[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_PRELOAD_REF\);/);
  assert.match(source, /static void VN_BANKED_CODE2 visual_cache_invalidate\(uint8_t scope\)[\s\S]*if \(!vn_visual_cache_code_loaded\) return;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_INVALIDATE\)/);
  assert.match(source, /visual_cache_preload_ref_impl\(vn_visual_cache_arg_kind, vn_visual_cache_arg_asset, vn_visual_cache_arg_ref\);\n        return 0u;/);
  assert.doesNotMatch(source, /#define visual_cache_bg_map_to_vram\(dest, asset_index, ref, width_tiles, height_tiles\) \(0u\)/);
  assert.doesNotMatch(source, /VN_VISUAL_CACHE_OP_GET_BG_ASSET|VN_VISUAL_CACHE_OP_GET_SPRITE_ASSET|VN_VISUAL_CACHE_OP_LOAD_BG\b|VN_VISUAL_CACHE_OP_LOAD_SPRITE\b/);
  assert.doesNotMatch(source, /VN_VISUAL_CACHE_CODE load_bg_cache_asset_impl/);
  assert.doesNotMatch(source, /load_sprite_pattern_cache_asset_impl|visual_cache_call\(VN_VISUAL_CACHE_OP_LOAD_SPRITE_PATTERN_CACHE\)/);
  assert.match(source, /static const pce_editor_bg_asset_t \*VN_RESIDENT_CODE vn_get_bg_asset\(uint16_t idx\)/);
  assert.match(source, /static const pce_editor_sprite_asset_t \*VN_RESIDENT_CODE vn_get_sprite_asset\(uint16_t idx, uint8_t preferred_slot\)/);
  assert.match(source, /static void VN_RESIDENT_CODE clear_spritetext_slots\(void\)/);
  assert.match(source, /static signed char VN_BANKED_CODE2 shake_offset_for_frame\(uint8_t frame, uint8_t intensity\)/);
  assert.doesNotMatch(source, /VN_VISUAL_CACHE_CODE vn_get_bg_asset|VN_VISUAL_CACHE_CODE vn_get_sprite_asset/);
  assert.doesNotMatch(source, /static void VN_BANKED_CODE2 clear_spritetext_slots\(void\)/);
  assert.match(bgWrapperSource, /bg = vn_get_bg_asset\(\(uint16_t\)bg_index\);[\s\S]*SNAPSHOT_DATA_REF\(bg_tiles, bg->tiles\);[\s\S]*SNAPSHOT_DATA_REF\(bg_map, bg->map\);[\s\S]*load_visual_cache_code\(\);[\s\S]*visual_cache_preload_ref\(VN_VISUAL_CACHE_KIND_BG_TILES[\s\S]*visual_cache_preload_ref\(VN_VISUAL_CACHE_KIND_BG_MAP[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.doesNotMatch(helperSource, /upload_bg_graphics|ensure_sprite_patterns_loaded/);
  assert.doesNotMatch(helperSource, /preloaded_bg_valid = 1u/);
  assert.match(spriteWrapperSource, /if \(sprite_index < 0 \|\| \(unsigned int\)sprite_index >= pce_editor_sprite_asset_count\) return;[\s\S]*map_resident_data\(\);[\s\S]*sprite = vn_get_sprite_asset\(\(uint16_t\)sprite_index, slot_index\);[\s\S]*load_visual_cache_code\(\);[\s\S]*visual_cache_preload_ref\(VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS, \(uint16_t\)sprite_index, &sprite->patterns\);/);
  assert.doesNotMatch(bgWrapperSource, /load_overlay_code\(\)|upload_bg_graphics|ensure_sprite_patterns_loaded/);
  assert.doesNotMatch(spriteWrapperSource, /load_overlay_code\(\)|upload_bg_graphics|ensure_sprite_patterns_loaded|sprite_slots\[/);
  assert.match(source, /static void VN_BANKED_CODE2 load_runtime_cache\(uint8_t scope, signed int asset_index, uint8_t slot, uint8_t x, uint8_t y\)/);
  assert.match(source, /static void VN_BANKED_CODE2 begin_runtime_cache_load\(uint8_t scope, signed int asset_index, uint8_t slot, uint8_t x, uint8_t y\)[\s\S]*runtime_cache_load_scope = scope;[\s\S]*runtime_cache_load_step = 0u;[\s\S]*runtime_cache_load_pending = 1u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 service_runtime_cache_load\(void\)[\s\S]*if \(!runtime_cache_load_pending\) return 0u;[\s\S]*scope == PCE_VN_CACHE_SCOPE_BG[\s\S]*runtime_cache_load_step == 0u[\s\S]*visual_cache_preload_ref\(VN_VISUAL_CACHE_KIND_BG_TILES[\s\S]*runtime_cache_load_step = 1u;[\s\S]*visual_cache_preload_ref\(VN_VISUAL_CACHE_KIND_BG_MAP[\s\S]*runtime_cache_load_pending = 0u;/);
  assert.match(source, /static inline uint8_t VN_BANKED_CODE_INLINE ensure_sprite_patterns_loaded/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE cd_data_ref_to_vram_visual_impl[\s\S]*scratch_page = visual_cache_borrow_scratch_page_impl\(\);[\s\S]*chunk = visual_cache_cd_read_chunk_impl\(remaining\);[\s\S]*pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)page_data, chunk\);[\s\S]*visual_cache_page_to_vram_impl\(vram_dest, scratch_page, 0u, chunk\);[\s\S]*sectors = VN_CD_CHUNK_SECTOR_COUNT\(chunk\);/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE visual_cache_load_cd_part_impl[\s\S]*chunk = visual_cache_cd_read_chunk_impl\(remaining\);[\s\S]*pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)&page_data\[page_offset\], chunk\);[\s\S]*sectors = VN_CD_CHUNK_SECTOR_COUNT\(chunk\);/);
  assert.match(source, /static uint8_t VN_BANKED_CODE cd_data_ref_to_vram[\s\S]*vram_copy_sliced_from_vn_data\(vram_dest, cd_transfer_scratch, chunk\);/);
  assert.match(source, /upload_bg_graphics\(next_bg, bg_map_dest_from_tile\(next_bg, next_x, next_y\), \(uint16_t\)bg_index\);/);
  assert.match(source, /copy_data_ref_to_vram\(\(uint16_t\)\(bg->tile_base \* 16u\), &bg->tiles, 16u, VN_VISUAL_CACHE_KIND_BG_TILES, bg_index\);/);
  assert.match(source, /cd_bg_map_ref_to_vram\(map_dest, &bg->map, bg->width_tiles, bg->height_tiles, bg_index\)/);
  assert.match(source, /static uint8_t vn_visual_cache_code_loaded = 0;/);
  assert.match(source, /static void VN_BANKED_CODE load_visual_cache_code\(void\)[\s\S]*if \(vn_visual_cache_code_loaded\) return;[\s\S]*pce_ram_bank121_map\(\);[\s\S]*pce_cdb_cd_read[\s\S]*vn_visual_cache_code_loaded = 1u;/);
  assert.match(source, /load_overlay_code\(\);\n#if VN_ENABLE_VISUAL_PAYLOAD_CACHE\n    load_visual_cache_code\(\);\n#endif/);
  assert.match(helperSource, /load_adpcm_cache_asset[\s\S]*if \(adpcm_playback_active\(\)\) return;[\s\S]*load_adpcm_voice\(voice_index, 1u, VN_ADPCM_PRELOAD_READ_CHUNK_SECTORS\);/);
  assert.match(helperSource, /load_runtime_cache[\s\S]*scope == PCE_VN_CACHE_SCOPE_BG[\s\S]*load_bg_cache_asset\(asset_index, x, y\);[\s\S]*scope == PCE_VN_CACHE_SCOPE_SPRITE[\s\S]*load_sprite_pattern_cache_asset\(asset_index, slot\);[\s\S]*scope == PCE_VN_CACHE_SCOPE_ADPCM[\s\S]*load_adpcm_cache_asset\(asset_index\);[\s\S]*scope == PCE_VN_CACHE_SCOPE_PSG[\s\S]*load_psg_cache_asset\(asset_index\);/);
  assert.match(source, /vn_system_psg_load_package\(uint16_t index, uint8_t play_after\)[\s\S]*loaded_system_psg_package_key\[bus\][\s\S]*vn_system_psg_stop_bus\(bus\)[\s\S]*VN_CD_ASYNC_DEST_PSG_BANK[\s\S]*package\.data\.byte_size/);
  assert.match(source, /load_psg_cache_asset\(signed int asset_index\)[\s\S]*vn_system_psg_load_package\(\(uint16_t\)asset_index, 0u\)/);
  assert.match(clearImplSource, /if \(scope > PCE_VN_CACHE_SCOPE_ALL\) scope = PCE_VN_CACHE_SCOPE_VISUAL;/);
  assert.match(source, /#define VN_CACHE_CLEAR_BG_MASK \(VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_VISUAL\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_BG\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_ALL\)\)/);
  assert.match(source, /#define VN_CACHE_CLEAR_SPRITE_MASK \(VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_VISUAL\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_SPRITE\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_ALL\)\)/);
  assert.match(source, /#define VN_CACHE_CLEAR_VISUAL_PAYLOAD_MASK \(VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_VISUAL\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_BG\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_SPRITE\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_ALL\)\)/);
  assert.match(source, /#define VN_CACHE_CLEAR_ADPCM_MASK \(VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_ADPCM\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_ALL\)\)/);
  assert.match(source, /#define VN_CACHE_CLEAR_PSG_MASK \(VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_PSG\) \| VN_CACHE_SCOPE_BIT\(PCE_VN_CACHE_SCOPE_ALL\)\)/);
  assert.match(clearImplSource, /scope_bit = VN_CACHE_SCOPE_BIT\(scope\);/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_BG_MASK\)[\s\S]*preloaded_bg_valid = 0u;[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_BG_MASK\)[\s\S]*for \(i = 0u; i < VN_BG_META_CACHE_SLOTS; i\+\+\)[\s\S]*g_bg_cache_key\[i\] = 0u;/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_SPRITE_MASK\)[\s\S]*for \(i = 0u; i < VN_SPRITE_SLOT_COUNT; i\+\+\)[\s\S]*loaded_sprite_pattern_valid\[i\] = 0u;[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_SPRITE_MASK\)[\s\S]*g_spr_cache_key\[i\] = 0u;[\s\S]*g_spr_cache_next = 0u;/);
  assert.match(clearImplSource, /visual_cache_invalidate_impl\(scope\);/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_ADPCM_MASK\)[\s\S]*loaded_adpcm_valid = 0u;/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_PSG_MASK\)[\s\S]*loaded_system_psg_package_key\[0\] = 0u;[\s\S]*loaded_system_psg_package_key\[1\] = 0u;/);
  assert.match(clearImplSource, /if \(scope_bit & VN_CACHE_CLEAR_GLYPH_MASK\)[\s\S]*message_glyph_cache_valid = 0u;/);
  assert.match(clearHelperSource, /scope_bit = VN_CACHE_SCOPE_BIT\(scope\);[\s\S]*if \(scope_bit & VN_CACHE_CLEAR_BG_MASK\)[\s\S]*preloaded_bg_valid = 0u;[\s\S]*for \(i = 0u; i < VN_BG_META_CACHE_SLOTS; i\+\+\)[\s\S]*g_bg_cache_key\[i\] = 0u;[\s\S]*if \(scope_bit & VN_CACHE_CLEAR_SPRITE_MASK\)[\s\S]*loaded_sprite_pattern_valid\[i\] = 0u;[\s\S]*visual_cache_invalidate\(scope\);[\s\S]*VN_MAP_BANK130_FOR_CODE\(\);/);
  assert.match(clearHelperSource, /if \(scope_bit & VN_CACHE_CLEAR_PSG_MASK\)[\s\S]*loaded_system_psg_package_key\[0\] = 0u;[\s\S]*loaded_system_psg_package_key\[1\] = 0u;/);
  assert.doesNotMatch(clearHelperSource, /load_visual_cache_code\(\)|VN_VISUAL_CACHE_OP_CLEAR_RUNTIME_CACHE|pce_cdb_cd_read/);
  assert.doesNotMatch(clearImplSource + clearHelperSource, /pce_cdb_adpcm_stop|pce_cdb_adpcm_reset|stop_adpcm_voice|display_disable|clear_screen_map|clear_sprites|sprite_slots\[|pce_editor_vram_copy|upload_sprite_table/);
  assert.match(executeCommandSource, /command->type == PCE_VN_COMMAND_CACHE[\s\S]*command->flags == PCE_VN_CACHE_ACTION_CLEAR[\s\S]*clear_runtime_cache\(command->arg0\);/);
  assert.match(executeCommandSource, /command->flags == PCE_VN_CACHE_ACTION_LOAD[\s\S]*VN_MAP_BANK130_FOR_CODE\(\);[\s\S]*begin_runtime_cache_load\(command->arg0, command->asset_index, command->slot, command->x, command->y\);[\s\S]*wait_frames_remaining = 1u;[\s\S]*return VN_EXEC_WAIT;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE run_commands_until_wait\(void\)[\s\S]*if \(service_runtime_cache_load\(\)\)[\s\S]*wait_frames_remaining = 1u;[\s\S]*return 1u;/);
  assert.doesNotMatch(executeCommandSource, /PCE_VN_COMMAND_PRELOAD/);
});

test('PCE build system regenerates visual novel sources from saved scenes', async () => {
  const projectDir = path.join(makeTempDir('pce-vn-build-project-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), projectDir, { recursive: true });
  const configPath = path.join(projectDir, 'project.json');
  const staleConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  staleConfig.cd.systemCardProfile = '';
  writeJson(configPath, staleConfig);
  // Phase A module split: the ADPCM logic lives in vn_adpcm_core.c, so tamper
  // that module to prove syncVisualNovelRuntime restores split runtime files.
  const runtimePath = path.join(projectDir, 'src', 'vn_adpcm_core.c');
  const currentRuntime = fs.readFileSync(runtimePath, 'utf-8');
  const changedRuntime = currentRuntime.replace('adpcm_play_looping = 0u;', 'adpcm_play_looping = 1u;');
  assert.notEqual(changedRuntime, currentRuntime);
  fs.writeFileSync(runtimePath, changedRuntime, 'utf-8');
  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
  sceneDoc.scenes[0].commands = [
    { type: 'message', text: 'A', textSpeedFrames: 0, advance: 'manual' },
  ];
  sceneDoc.scenes[0].nextSceneId = '';
  sceneDoc.scenes = [sceneDoc.scenes[0]];
  writeJson(scenePath, sceneDoc);

  const buildSystem = loadPceBuildSystem();
  buildSystem.openProject(projectDir);
  const logs = [];
  const result = await buildSystem.buildProject((line) => logs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
  });

  assert.equal(result.success, true);
  assert.equal(buildSystem.loadProjectConfigFromDir(projectDir).cd.systemCardProfile, 'jp-v3');
  assert.equal(result.commandInfo.targetMedia, 'cd');
  assert.ok(result.commandInfo.mkcdArgs.some((arg) => /pce_cd_data_padding\.bin$/.test(arg)));
  assert.equal(result.generated.visualNovel.messageCount, 1);
  assert.deepEqual(result.generated.visualNovel.scenePackPaths, ['assets/generated/vn/scenes/000_opening.bin']);
  const source = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'vn.c'), 'utf-8');
  assert.match(source, /const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs\[\]/);
  // BIOS fonts have no CD payload. overlay@64, visual helper@68, async@72,
  // and the scene pack follows at sector 76.
  assert.doesNotMatch(source, /pce_vn_font_data|pce_vn_font_sprite_data/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_visual_code_data = \{ \{ 68u, 0u, 0u \}, 4u, 8192u \};/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_cd_async_code_data = \{ \{ 72u, 0u, 0u \}, 4u, 8192u \};/);
  assert.match(source, /\{ \{ 76u, 0u, 0u \}, 1u, \d+u, -1 \}/);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'font.bin')), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'font_sprite.bin')), false);
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'visual_code.bin')));
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'cd_async_code.bin')));
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'scenes', '000_opening.bin')));
  const syncedRuntime = fs.readFileSync(runtimePath, 'utf-8');
  assert.match(syncedRuntime, /adpcm_play_looping = 0u;/);
  assert.ok(logs.some((line) => /VN timing: generate pass 1 done in /.test(line)));
  assert.ok(logs.some((line) => /VN timing: merge CD data files done in .*\(\d+ data file\(s\), \d+ configured CD-DA track\(s\)\)/.test(line)));
  assert.ok(logs.some((line) => /VN timing: generate pass 2 done in /.test(line)));
  assert.ok(logs.some((line) => /Build timing: VN generation done in .*\(1 scene\(s\), 1 message\(s\),/.test(line)));
  assert.ok(logs.some((line) => /Build timing: asset source generation done in .*\(\d+ asset\(s\), asset catalog: (resident|cd)/.test(line)));
  assert.ok(logs.some((line) => /PCE-CD data files: \d+ file\(s\), CD-DA tracks: \d+/.test(line)));

  const incrementalLogs = [];
  const incremental = await buildSystem.buildProject((line) => incrementalLogs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
    skipClean: true,
  });

  assert.equal(incremental.success, true);
  assert.equal(incremental.generated.visualNovel.incrementalSkipped, true);
  assert.ok(incrementalLogs.some((line) => /VN generation skipped: inputs unchanged/.test(line)));
  assert.ok(incrementalLogs.some((line) => /Build timing: VN generation done in .*up-to-date, 1 scene\(s\), 1 message\(s\),/.test(line)));
  assert.equal(incrementalLogs.some((line) => /VN timing: generate pass 1 done in /.test(line)), false);

  sceneDoc.scenes[0].commands.push({ type: 'message', text: 'B' });
  writeJson(scenePath, sceneDoc);
  const changedLogs = [];
  const changed = await buildSystem.buildProject((line) => changedLogs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
    skipClean: true,
  });

  assert.equal(changed.success, true);
  assert.equal(changed.generated.visualNovel.incrementalSkipped, undefined);
  assert.equal(changed.generated.visualNovel.messageCount, 2);
  assert.ok(changedLogs.some((line) => /VN timing: incremental cache check done in .*\(changed\)/.test(line)));
  assert.ok(changedLogs.some((line) => /VN timing: generate pass 1 done in /.test(line)));
});

test('PCE build system dry-runs HuCARD VN without CD compile or mkcd inputs', async () => {
  const projectDir = path.join(makeWorkspaceTempDir('pce-vn-hucard-build-project-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_hucard'), projectDir, { recursive: true });
  const configPath = path.join(projectDir, 'project.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  writeJson(configPath, {
    ...config,
    targetMedia: 'cd',
    cd: {
      dataFiles: ['assets/generated/vn/font.bin'],
      cddaTracks: ['assets/generated/opening/cdda.wav'],
    },
  });
  fs.writeFileSync(path.join(projectDir, 'src', 'pce_vn_hucard_runtime.c'), 'stale runtime\n', 'utf-8');
  const buildSystem = loadPceBuildSystem();
  buildSystem.openProject(projectDir);
  const logs = [];

  const result = await buildSystem.buildProject((line) => logs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.commandInfo.targetMedia, 'hucard');
  assert.equal(path.extname(result.commandInfo.romPath), '.pce');
  assert.equal(path.extname(result.commandInfo.mapPath), '.map');
  assert.equal(result.commandInfo.mkcdArgs, undefined);
  assert.equal(result.commandInfo.args.includes('-DPCE_EDITOR_TARGET_CD=1'), false);
  assert.ok(result.commandInfo.args.some((arg) => /-Wl,-Map=.*\.map$/.test(arg)));
  assert.equal(result.commandInfo.args.some((arg) => /overlay_insert\.ld$/.test(arg)), false);
  assert.deepEqual(
    buildSystem.collectSourceFiles(projectDir, result.generated.visualNovel ? buildSystem.loadProjectConfigFromDir(projectDir) : {}).map((file) => path.relative(projectDir, file).replace(/\\/g, '/')),
    ['src/main.c', 'src/generated/assets.c', 'src/generated/vn.c'],
  );
  assert.equal(result.generated.visualNovel.targetMedia, 'hucard');
  assert.equal(result.generated.visualNovel.hucardPsgAssetCount, 0);
  assert.equal(result.generated.extraDataCount, result.generated.visualNovel.extraDataFiles.length);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_hucard_runtime.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_hucard_banks.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_runtime.c')), false);
  const runtime = fs.readFileSync(path.join(projectDir, 'src', 'pce_vn_hucard_runtime.c'), 'utf-8');
  const bankHeader = fs.readFileSync(path.join(projectDir, 'src', 'pce_vn_hucard_banks.h'), 'utf-8');
  const generatedAssets = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'assets.c'), 'utf-8');
  assert.doesNotMatch(runtime, /pce-cd\.h|pce_cdb_/);
  assert.match(runtime, /#include "pce_vn_hucard_banks\.h"/);
  assert.match(runtime, /VN_HUCARD_CODE_SCRIPT __attribute__\(\(noinline, section\("\.rom_bank1"\)\)\)/);
  assert.match(runtime, /VN_HUCARD_CODE_PSG __attribute__\(\(noinline, section\("\.rom_bank4"\)\)\)/);
  assert.match(runtime, /VN_HUCARD_CODE_SPRITE_STATE __attribute__\(\(noinline, section\("\.rom_bank4"\)\)\)/);
  assert.match(runtime, /VN_HUCARD_CODE_SUPPORT __attribute__\(\(noinline, section\("\.rom_bank4"\)\)\)/);
  assert.match(runtime, /static uint16_t VN_HUCARD_CODE_SUPPORT scale_vce_color\(uint16_t color, uint8_t level\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_SPRITE_STATE plan_sprite_layout\(void\)/);
  assert.match(runtime, /static uint8_t VN_HUCARD_CODE_SPRITE_STATE start_sprite_move\(const pce_vn_command_t \*command\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_SPRITE_STATE tick_sprites\(void\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_VIDEO draw_sprite_slot\(uint8_t slot, uint8_t upload_patterns\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_VIDEO upload_sprite_table_now\(void\)/);
  assert.match(runtime, /pce_vn_hucard_map_runtime_banks\(\);/);
  assert.match(bankHeader, /PCE_ROM_BANK_AT\(1, 2\);/);
  assert.match(bankHeader, /PCE_ROM_BANK_AT\(4, 5\);/);
  assert.match(generatedAssets, /PCE_ROM_BANK_AT\(1, 2\);/);
  assert.match(generatedAssets, /PCE_ROM_BANK_AT\(4, 5\);/);
  assert.match(generatedAssets, /PCE_EDITOR_ROM_DATA_BANK_AT\(5, 6\);/);
  assert.doesNotMatch(generatedAssets, /PCE_ROM_BANK_AT\(5, 6\);/);
  assert.doesNotMatch(generatedAssets, /PCE_RAM_BANK_AT\(130/);
  assert.doesNotMatch(generatedAssets, /pce_ram_bank130_map/);
  assert.match(generatedAssets, /const pce_editor_data_ref_t pce_vn_font_data_ref PCE_EDITOR_RODATA_SECTION = \{ \(const unsigned char \*\)0,/);
  assert.match(runtime, /VDC_CONTROL_ENABLE_SPRITE/);
  assert.doesNotMatch(runtime, /VDC_CONTROL_ENABLE_SPRITES/);
  assert.match(runtime, /VN_VDC_MEMORY_CONTROL \(VDC_CYCLE_4_SLOTS \| VDC_BG_SIZE_32_32\)/);
  assert.match(runtime, /pce_vdc_poke\(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL\);/);
  assert.match(runtime, /pce_vdc_sprite_set_table_start\(VN_SATB_ADDR\);/);
  assert.doesNotMatch(runtime, /bg_scroll_[xy]_shadow|restore_bg_scroll/);
  assert.equal((runtime.match(/pce_vdc_poke\(VDC_REG_BG_SCROLL_X, 0u\);/g) || []).length, 1);
  assert.equal((runtime.match(/pce_vdc_poke\(VDC_REG_BG_SCROLL_Y, 0u\);/g) || []).length, 1);
  assert.match(runtime, /static void vn_vram_copy\(uint16_t dest, const void \*source, uint16_t byte_count\)[\s\S]*pce_vdc_copy_to_vram\(dest, source, byte_count\);/);
  assert.doesNotMatch(runtime, /static void vn_vram_copy\(uint16_t dest, const void \*source, uint16_t byte_count\)[\s\S]*pce_vdc_copy_to_vram\(dest, source, byte_count\);\r?\n    restore_bg_scroll\(\);/);
  assert.match(runtime, /#define VN_PSG_VBLANK_FRAMES_PER_SERVICE 1u/);
  assert.match(runtime, /static uint8_t VN_HUCARD_CODE_PSG psg_wave_kind\(uint8_t wave\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_PSG psg_load_wave\(uint8_t channel, uint8_t wave\)/);
  assert.match(runtime, /const uint8_t wave = data_ref_byte_at\(asset->pattern, \(uint16_t\)\(base \+ 7u\)\);/);
  assert.match(runtime, /if \(psg_sfx\.active && psg_sfx\.voices\[channel\]\.active\) voice = &psg_sfx\.voices\[channel\];[\s\S]*else if \(psg_song\.active && psg_song\.voices\[channel\]\.active\) voice = &psg_song\.voices\[channel\];/);
  assert.match(runtime, /if \(command->arg0 == PCE_VN_PSG_STOP_BGM\) psg_stop_player\(&psg_song\);[\s\S]*else if \(command->arg0 == PCE_VN_PSG_STOP_SFX\) psg_stop_player\(&psg_sfx\);/);
  assert.match(runtime, /pce_vn_hucard_map_runtime_banks\(\);\s*psg_init\(\);/);
  assert.doesNotMatch(runtime, /advance_story\(\);\s*tick_sprites\(\);\s*service_psg\(\);\s*\n\s*while \(1\)/);
  assert.match(runtime, /static void service_psg\(void\)[\s\S]*psg_advance\(VN_PSG_VBLANK_FRAMES_PER_SERVICE\);/);
  assert.doesNotMatch(runtime, /VN_PSG_TIMER_HZ|VN_VBLANK_CREDIT_MAX|VN_VBLANK_CREDIT_SERVICE_LIMIT|vn_vblank_credit|vn_hucard_psg_timer_irq_hook|\.irq_timer|vn_consume_vblank_credit|pce_timer_set|pce_timer_enable|pce_irq_enable\(IRQ_TIMER\)|pce_cpu_irq_enable\(\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_VIDEO fade_palette\(const pce_editor_data_ref_t \*palette, uint16_t base, uint8_t frames, uint8_t fade_in\)[\s\S]*upload_palette\(palette, base, level\);[\s\S]*service_psg_during_blocking_work\(\);/);
  assert.match(runtime, /static void service_psg_during_blocking_work\(void\)[\s\S]*wait_vblank\(\);[\s\S]*service_psg\(\);/);
  // Blocking glyph uploads wait and service PSG once. The per-frame typewriter
  // path reuses main()'s current VBlank and must neither wait nor service again.
  const hucardFlushNowStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT flush_msg_tile_batch_now(void)');
  const hucardFlushStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT flush_msg_tile_batch(void)');
  const hucardFlushEnd = runtime.indexOf('static void VN_HUCARD_CODE_TEXT add_glyph_tile', hucardFlushStart);
  assert.notEqual(hucardFlushNowStart, -1);
  assert.notEqual(hucardFlushStart, -1);
  assert.notEqual(hucardFlushEnd, -1);
  const hucardFlushNowSource = runtime.slice(hucardFlushNowStart, hucardFlushStart);
  const hucardFlushSource = runtime.slice(hucardFlushStart, hucardFlushEnd);
  assert.match(hucardFlushNowSource, /vn_vram_copy\(msg_tile_batch_addr\[i\], msg_tile_batch\[i\], 32u\);/);
  assert.doesNotMatch(hucardFlushNowSource, /wait_vblank\(\)|service_psg\(\)/);
  assert.match(hucardFlushSource, /wait_vblank\(\);[\s\S]*flush_msg_tile_batch_now\(\);[\s\S]*service_psg\(\);/);
  // Full upload_sprite_table spends a VBlank and pairs it with PSG service. The
  // per-frame movement/animation path uses upload_sprite_table_now after the
  // main loop's existing VBlank, so it must not add a second timing tick.
  const hucardUploadSatbStart = runtime.indexOf('static void VN_HUCARD_CODE_VIDEO upload_sprite_table(void)');
  const hucardUploadSatbEnd = runtime.indexOf('static void VN_HUCARD_CODE_SPRITE_STATE hide_sprite_slot', hucardUploadSatbStart);
  assert.notEqual(hucardUploadSatbStart, -1);
  assert.notEqual(hucardUploadSatbEnd, -1);
  const hucardUploadSatbSource = runtime.slice(hucardUploadSatbStart, hucardUploadSatbEnd);
  assert.match(hucardUploadSatbSource, /wait_vblank\(\);[\s\S]*upload_sprite_table_now\(\);[\s\S]*service_psg\(\);/);
  assert.match(runtime, /static void VN_HUCARD_CODE_VIDEO upload_sprite_table_now\(void\)[\s\S]*pce_vdc_poke\(VDC_REG_SATB_START, VN_SATB_ADDR\);/);
  assert.match(runtime, /pce_vdc_poke\(VDC_REG_BG_SCROLL_X, 0u\);[\s\S]*pce_vdc_poke\(VDC_REG_BG_SCROLL_Y, 0u\);[\s\S]*clear_sprites\(\);/);
  assert.match(runtime, /"csl\\n"[\s\S]*vn_hu_wait_vblank_start_outer[\s\S]*"csh\\n"/);
  assert.match(runtime, /copy_data_ref_to_vram_guarded/);
  assert.match(runtime, /service_psg_during_blocking_work/);
  assert.match(runtime, /#define VN_WAIT_CURSOR_BLINK_FRAMES 24u/);
  assert.match(runtime, /#define VN_CHOICE_TEXT_COL 2u/);
  assert.match(runtime, /static void VN_HUCARD_CODE_TEXT tick_message_wait_indicator\(void\)/);
  assert.match(runtime, /static uint8_t VN_HUCARD_CODE_TEXT begin_message_window_vram_update\(void\)/);
  // map_message_window_cells must map the whole window BAT within a single
  // VBlank. A per-row wait_vblank spreads the 8-row strip over 8 frames and
  // shows up as a top-to-bottom wipe when the window is shown/hidden.
  const hucardMapWinNowStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT map_message_window_cells_now(uint8_t blank)');
  const hucardMapWinStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT map_message_window_cells(uint8_t blank)');
  const hucardMapWinEnd = runtime.indexOf('static void VN_HUCARD_CODE_TEXT clear_window_tile_pixels', hucardMapWinStart);
  assert.notEqual(hucardMapWinNowStart, -1);
  assert.notEqual(hucardMapWinStart, -1);
  assert.notEqual(hucardMapWinEnd, -1);
  const hucardMapWinNowSource = runtime.slice(hucardMapWinNowStart, hucardMapWinStart);
  const hucardMapWinSource = runtime.slice(hucardMapWinStart, hucardMapWinEnd);
  assert.doesNotMatch(hucardMapWinNowSource, /wait_vblank\(\)|service_psg\(\)/);
  assert.match(hucardMapWinNowSource, /for \(tr = 0u; tr < VN_MSG_TILE_ROWS; tr\+\+\)[\s\S]*vn_vram_copy\(\(uint16_t\)\(\(\(VN_TEXT_Y \+ tr\) \* VN_MAP_WIDTH\) \+ VN_TEXT_X\), msg_bat_row, \(uint16_t\)\(VN_MSG_TILE_COLS \* 2u\)\);/);
  assert.match(hucardMapWinSource, /wait_vblank\(\);[\s\S]*map_message_window_cells_now\(blank\);[\s\S]*service_psg\(\);/);
  assert.match(runtime, /#define VN_MSG_CLEAR_TILES_PER_VBLANK 16u/);
  assert.match(runtime, /static void VN_HUCARD_CODE_TEXT clear_window_tile_pixels\(void\)[\s\S]*if \(\(tile & \(VN_MSG_CLEAR_TILES_PER_VBLANK - 1u\)\) == 0u\) service_psg_during_blocking_work\(\);[\s\S]*vn_vram_copy\(\(uint16_t\)\(\(VN_MSG_STRIP_TILE_BASE \+ tile\) \* 16u\), msg_tile, 32u\);/);
  assert.match(runtime, /static void VN_HUCARD_CODE_TEXT hide_message_window_map\(void\)\s*\{\s*map_message_window_cells\(1u\);\s*\}/);
  assert.match(runtime, /static uint8_t VN_HUCARD_CODE_TEXT begin_message_window_vram_update\(void\)\s*\{\s*map_message_window_cells\(1u\);\s*return 1u;\s*\}/);
  assert.match(runtime, /static void VN_HUCARD_CODE_TEXT end_message_window_vram_update\(uint8_t restore_display\)\s*\{\s*if \(!restore_display\) return;\s*map_message_window_cells\(0u\);\s*\}/);
  assert.doesNotMatch(runtime, /static void VN_HUCARD_CODE_PSG tick_psg\(void\)/);
  assert.match(runtime, /static void VN_HUCARD_CODE_TEXT update_choice_cursor\(uint8_t old_index, uint8_t new_index\)/);
  assert.match(runtime, /tick_message_wait_indicator\(\);/);
  assert.match(runtime, /#define VN_MESSAGE_INSTANT_GLYPH_COUNT\(info\) \(\(uint8_t\)\(\(info\) >> 2u\)\)/);
  assert.match(runtime, /message->mouth_slot = scene_pack_u8\(cache, \(uint16_t\)\(offset \+ 10u\)\);/);
  assert.match(runtime, /static uint8_t VN_HUCARD_CODE_TEXT draw_message_prefix_glyphs\(const pce_vn_message_t \*message\)[\s\S]*instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT\(message->mouth_slot\);[\s\S]*if \(draw_message_next_entry\(message\)\) return 1u;/);
  assert.match(runtime, /instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT\(message\.mouth_slot\);[\s\S]*if \(instant_glyph_count\)[\s\S]*message_complete = draw_message_prefix_glyphs\(&active_message_state\);[\s\S]*if \(!message_complete && !message_text_speed\)/);
  const hucardSetBgStart = runtime.indexOf('static void VN_HUCARD_CODE_VIDEO set_background');
  const hucardSetBgEnd = runtime.indexOf('static uint16_t VN_HUCARD_CODE_TEXT ui_tile', hucardSetBgStart);
  assert.notEqual(hucardSetBgStart, -1);
  assert.notEqual(hucardSetBgEnd, -1);
  const hucardSetBgSource = runtime.slice(hucardSetBgStart, hucardSetBgEnd);
  assert.match(hucardSetBgSource, /if \(fade_transition\) display_disable\(\);/);
  assert.match(hucardSetBgSource, /fade_transition \? 0u : 16u/);
  assert.match(hucardSetBgSource, /display_enable\(\);[\s\S]*fade_palette\(&bg->palette, \(uint16_t\)\(bg->palette_bank \* 16u\), fade_in_frames, 1u\);/);
  const hucardFinishMessageStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT finish_active_message(void)');
  const hucardTickMessageStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT tick_active_message(void)', hucardFinishMessageStart);
  assert.notEqual(hucardFinishMessageStart, -1);
  assert.notEqual(hucardTickMessageStart, -1);
  const hucardFinishMessageSource = runtime.slice(hucardFinishMessageStart, hucardTickMessageStart);
  assert.match(hucardFinishMessageSource, /while \(!message_complete\)[\s\S]*message_complete = draw_message_next_entry\(&active_message_state\);/);
  assert.doesNotMatch(hucardFinishMessageSource, /begin_message_window_vram_update|end_message_window_vram_update|clear_window_tile_pixels|map_message_window_cells/);
  const hucardCopyStart = runtime.indexOf('static void VN_HUCARD_CODE_VIDEO copy_data_ref_to_vram_guarded');
  const hucardCopyEnd = runtime.indexOf('static void VN_HUCARD_CODE_VIDEO upload_palette', hucardCopyStart);
  assert.notEqual(hucardCopyStart, -1);
  assert.notEqual(hucardCopyEnd, -1);
  const hucardCopySource = runtime.slice(hucardCopyStart, hucardCopyEnd);
  assert.match(hucardCopySource, /while \(copied < chunk->size\)[\s\S]*pce_editor_map_asset_bank\(chunk->bank\);[\s\S]*vn_vram_copy/);
  assert.doesNotMatch(hucardCopySource, /pce_editor_map_asset_bank\(chunk->bank\);\s*while \(copied < chunk->size\)/);
  const hucardGlyphStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT draw_message_glyph_at_impl');
  const hucardGlyphEnd = runtime.indexOf('static void VN_HUCARD_CODE_TEXT clear_message_glyph_area', hucardGlyphStart);
  assert.notEqual(hucardGlyphStart, -1);
  assert.notEqual(hucardGlyphEnd, -1);
  const hucardGlyphSource = runtime.slice(hucardGlyphStart, hucardGlyphEnd);
  assert.match(hucardGlyphSource, /reset_msg_tile_batch\(\);[\s\S]*queue_msg_tile\(tile, msg_tile\);[\s\S]*if \(wait_for_vblank\) flush_msg_tile_batch\(\);[\s\S]*else flush_msg_tile_batch_now\(\);/);
  const hucardTickMessageEnd = runtime.indexOf('static void VN_HUCARD_CODE_TEXT draw_choice_options', hucardTickMessageStart);
  const hucardTickMessageSource = runtime.slice(hucardTickMessageStart, hucardTickMessageEnd);
  assert.match(hucardTickMessageSource, /draw_message_next_entry_now\(&active_message_state\);/);
  assert.doesNotMatch(hucardTickMessageSource, /wait_vblank\(\)|service_psg\(\)/);
  const hucardUpdateChoiceStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT update_choice_cursor');
  const hucardUpdateChoiceEnd = runtime.indexOf('static void VN_HUCARD_CODE_TEXT start_choice', hucardUpdateChoiceStart);
  assert.doesNotMatch(runtime.slice(hucardUpdateChoiceStart, hucardUpdateChoiceEnd), /service_psg\(\);/);
  const hucardChoiceDrawStart = runtime.indexOf('static void VN_HUCARD_CODE_TEXT draw_choice_options');
  const hucardChoiceDrawEnd = runtime.indexOf('static void VN_HUCARD_CODE_TEXT draw_choice_cursor_row', hucardChoiceDrawStart);
  assert.notEqual(hucardChoiceDrawStart, -1);
  assert.notEqual(hucardChoiceDrawEnd, -1);
  const hucardChoiceDrawSource = runtime.slice(hucardChoiceDrawStart, hucardChoiceDrawEnd);
  assert.match(hucardChoiceDrawSource, /col \+ VN_CHOICE_TEXT_COL/);
  assert.match(hucardChoiceDrawSource, /draw_message_glyph_at\(glyph, \(uint8_t\)\(col \+ VN_CHOICE_TEXT_COL\), row\);/);
  const hucardChoiceInputStart = runtime.indexOf('static uint8_t VN_HUCARD_CODE_TEXT handle_choice_input');
  const hucardChoiceInputEnd = runtime.indexOf('static void VN_HUCARD_CODE_SCRIPT show_scene', hucardChoiceInputStart);
  assert.notEqual(hucardChoiceInputStart, -1);
  assert.notEqual(hucardChoiceInputEnd, -1);
  const hucardChoiceInputSource = runtime.slice(hucardChoiceInputStart, hucardChoiceInputEnd);
  assert.match(hucardChoiceInputSource, /update_choice_cursor\(old_index, choice_selected_index\);/);
  assert.match(hucardChoiceInputSource, /hide_message_window_map\(\);/);
  assert.doesNotMatch(hucardChoiceInputSource, /draw_choice_options\(\);/);
  assert.ok(logs.some((line) => /HuCARD visual novel runtime files were synchronized/.test(line)));

  const incrementalLogs = [];
  const incremental = await buildSystem.buildProject((line) => incrementalLogs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
    skipClean: true,
  });
  assert.equal(incremental.success, true);
  assert.equal(incremental.generated.visualNovel.incrementalSkipped, true);
  assert.ok(incrementalLogs.some((line) => /VN generation skipped: inputs unchanged/.test(line)));
  assert.equal(incrementalLogs.some((line) => /HuCARD visual novel runtime files were synchronized/.test(line)), false);
});

test('PCE build system skips HuCARD VN compile when Test Play inputs are unchanged', async () => {
  const projectDir = path.join(makeWorkspaceTempDir('pce-vn-hucard-output-cache-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_hucard'), projectDir, { recursive: true });
  const buildSystem = loadPceBuildSystem();
  buildSystem.openProject(projectDir);

  const firstLogs = [];
  const first = await buildSystem.buildProject((line) => firstLogs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
  });
  assert.equal(first.success, true);
  assert.equal(first.commandInfo.targetMedia, 'hucard');
  fs.mkdirSync(path.dirname(first.commandInfo.romPath), { recursive: true });
  fs.writeFileSync(first.commandInfo.romPath, Buffer.from([0x48, 0x75]));
  buildSystem.writeBuildOutputStamp(projectDir, buildSystem.loadProjectConfigFromDir(projectDir), first.commandInfo);

  const skippedLogs = [];
  const skipped = await buildSystem.buildProject((line) => skippedLogs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
    skipClean: true,
  });
  assert.equal(skipped.success, true);
  assert.equal(skipped.buildSkipped, true);
  assert.equal(skipped.generated.visualNovel.incrementalSkipped, true);
  assert.ok(skippedLogs.some((line) => /Build skipped: inputs unchanged/.test(line)));
  assert.equal(skippedLogs.some((line) => /Build timing: compile ROM start/.test(line)), false);

  const scenePath = path.join(projectDir, 'assets', 'pce-vn-scenes.json');
  const sceneDoc = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
  sceneDoc.scenes[0].commands.push({ type: 'message', text: 'changed' });
  writeJson(scenePath, sceneDoc);

  const changedLogs = [];
  const changed = await buildSystem.buildProject((line) => changedLogs.push(line), {
    dryRun: true,
    allowMissingToolchain: true,
    skipClean: true,
  });
  assert.equal(changed.success, true);
  assert.equal(changed.buildSkipped, undefined);
  assert.equal(changed.generated.visualNovel.incrementalSkipped, undefined);
  assert.equal(changedLogs.some((line) => /Build skipped: inputs unchanged/.test(line)), false);
});

test('PCE visual novel builder start hook leaves VN generation to the build system', () => {
  const projectDir = makeTempDir('pce-vn-builder-hook-');
  writeJson(path.join(projectDir, 'project.json'), {
    targetMedia: 'cd',
    toolchain: 'llvm-mos',
    pluginRoles: { builder: 'pce-visual-novel-builder' },
    pluginSettings: { 'pce-visual-novel-builder': { template: 'visual-novel-cd' } },
  });
  writeJson(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), {
    version: 2,
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', text: 'A' }] }],
  });
  delete require.cache[require.resolve('../plugins/pce-visual-novel-builder')];
  const builder = require('../plugins/pce-visual-novel-builder');
  const logs = [];

  const result = builder.onBuildStart({ projectDir }, {
    projectDir,
    logger: { info: (line) => logs.push(line) },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(logs, [`PCE CD-ROM2 visual novel build start: ${projectDir}`]);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_runtime.c')), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'generated', 'vn.c')), false);
});

test('PCE HuCARD visual novel builder hook leaves VN generation to the build system', () => {
  const projectDir = makeTempDir('pce-vn-hucard-builder-hook-');
  writeJson(path.join(projectDir, 'project.json'), {
    targetMedia: 'hucard',
    toolchain: 'llvm-mos',
    pluginRoles: { builder: 'pce-visual-novel-hucard-builder' },
    pluginSettings: { 'pce-visual-novel-hucard-builder': { template: 'visual-novel-hucard' } },
  });
  writeJson(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), {
    version: 2,
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', text: 'A' }] }],
  });
  delete require.cache[require.resolve('../plugins/pce-visual-novel-hucard-builder')];
  const builder = require('../plugins/pce-visual-novel-hucard-builder');
  const logs = [];

  const result = builder.onBuildStart({ projectDir }, {
    projectDir,
    logger: { info: (line) => logs.push(line) },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(logs, [`PCE HuCARD visual novel build start: ${projectDir}`]);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_hucard_runtime.c')), false);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'generated', 'vn.c')), false);
});

test('PCE build system derives CD data padding from the measured program size', () => {
  const buildSystem = loadPceBuildSystem();
  // pce-mkcd -v reports the ELF program placement; the first data file must land
  // on PCE_CD_DATA_BASE_SECTOR regardless of how many sectors the program takes.
  const verbose = [
    'Adding 386 sectors of padding required by CD-ROM specification.',
    'Writing "sector_0" (__cd_sector_0) to ISO @ sector 0, size 1',
    'Writing "out/TST.elf" (__cd_out_tst_elf) to ISO @ sector 1, size 18',
    'Finished writing ISO, size 450',
  ].join('\n');
  const firstData18 = buildSystem.parseMkcdFirstDataSector(verbose, 'TST.elf');
  assert.equal(firstData18, 19);
  // A 18-sector program needs 45 padding sectors to reach sector 64 (was 43 when
  // the resident font tiles still made the program 20 sectors long).
  assert.equal(buildSystem.PCE_CD_DATA_BASE_SECTOR - firstData18, 45);
  const firstData20 = buildSystem.parseMkcdFirstDataSector(
    'Writing "out/TST.elf" (__cd_out_tst_elf) to ISO @ sector 1, size 20', 'TST.elf');
  assert.equal(buildSystem.PCE_CD_DATA_BASE_SECTOR - firstData20, 43);
  // Unparseable output falls back to null so the build keeps the provisional pad.
  assert.equal(buildSystem.parseMkcdFirstDataSector('no useful output', 'TST.elf'), null);
});

test('PCE build system expands llvm-mos Windows clang wrappers to clang --config', {
  skip: process.platform !== 'win32' ? 'Windows llvm-mos wrapper expansion only' : false,
}, () => {
  const buildSystem = loadPceBuildSystem();
  const projectDir = makeTempDir('pce-wrapper-expand-project-');
  const binDir = path.join(projectDir, 'toolchain', 'bin');
  const iplPath = path.join(projectDir, 'ipl.bin');
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), 'int main(void) { return 0; }\n');
  fs.writeFileSync(iplPath, Buffer.alloc(0));
  fs.writeFileSync(path.join(binDir, 'clang.exe'), Buffer.alloc(0));
  fs.writeFileSync(path.join(binDir, 'mos-pce-cd-clang.bat'), '@echo off\r\n');
  fs.writeFileSync(path.join(binDir, 'mos-pce-cd.cfg'), '# cfg\n');
  fs.writeFileSync(path.join(binDir, 'mos-pce-clang.bat'), '@echo off\r\n');
  fs.writeFileSync(path.join(binDir, 'mos-pce.cfg'), '# cfg\n');

  const cdInfo = buildSystem.buildCommandForProject(
    projectDir,
    {
      title: 'Wrapper Test',
      romName: 'wrapper-test',
      targetMedia: 'cd',
      toolchain: 'llvm-mos',
      cd: { iplPath },
    },
    path.join(binDir, 'mos-pce-cd-clang.bat'),
  );

  assert.equal(path.basename(cdInfo.command).toLowerCase(), 'clang.exe');
  assert.equal(cdInfo.args[0], '--config');
  assert.equal(path.basename(cdInfo.args[1]).toLowerCase(), 'mos-pce-cd.cfg');
  assert.ok(cdInfo.args.includes('-Oz'));
  assert.ok(cdInfo.args.includes('-DPCE_EDITOR_TARGET_CD=1'));
  assert.ok(cdInfo.args.some((arg) => /main\.c$/i.test(arg)));

  const huCardInfo = buildSystem.buildCommandForProject(
    projectDir,
    {
      title: 'Wrapper Test',
      romName: 'wrapper-test',
      targetMedia: 'hucard',
      toolchain: 'llvm-mos',
    },
    path.join(binDir, 'mos-pce-clang.bat'),
  );

  assert.equal(path.basename(huCardInfo.command).toLowerCase(), 'clang.exe');
  assert.equal(huCardInfo.args[0], '--config');
  assert.equal(path.basename(huCardInfo.args[1]).toLowerCase(), 'mos-pce.cfg');
  assert.ok(huCardInfo.args.includes('-Os'));
});

test('PCE build system reports blocked llvm-mos LLD before compile', () => {
  const buildSystem = loadPceBuildSystem();
  const projectDir = makeWorkspaceTempDir('pce-lld-preflight-project-');
  const binDir = path.join(projectDir, 'toolchain', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const clangPath = path.join(binDir, process.platform === 'win32' ? 'clang.exe' : 'clang');
  const linkerPath = path.join(binDir, process.platform === 'win32' ? 'ld.lld.exe' : 'ld.lld');
  fs.writeFileSync(clangPath, Buffer.alloc(0));
  fs.writeFileSync(linkerPath, Buffer.alloc(0));

  const commandInfo = { toolchain: 'llvm-mos', command: clangPath };
  assert.equal(buildSystem.findLlvmMosLinkerPath(commandInfo), linkerPath);
  const message = buildSystem.formatLlvmMosLinkerPreflightFailure(linkerPath, {
    error: Object.assign(new Error(`spawnSync ${linkerPath} UNKNOWN`), { code: 'UNKNOWN' }),
    status: null,
  });
  assert.match(message, /llvm-mos linker/);
  assert.match(message, /ld\.lld/);
  if (process.platform === 'win32') {
    assert.match(message, /Windows Application Control/);
  }
});

test('PCE HuCard slideshow build ignores stale VN files and restores the slideshow main', () => {
  const buildSystem = loadPceBuildSystem();
  const projectDir = makeTempDir('pce-slideshow-stale-vn-project-');
  const generatedDir = path.join(projectDir, 'src', 'generated');
  const mainPath = path.join(projectDir, 'src', 'main.c');
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.writeFileSync(mainPath, '#include "pce_vn_runtime.c"\r\n', 'utf-8');
  fs.writeFileSync(path.join(generatedDir, 'assets.c'), 'const unsigned char asset_stub = 0;\n', 'utf-8');
  fs.writeFileSync(path.join(generatedDir, 'vn.c'), 'const unsigned char stale_vn_stub = 0;\n', 'utf-8');
  writeJson(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), {
    scenes: [{ id: 'scene_001', commands: [] }],
  });
  const config = {
    title: 'Slide Stale VN',
    romName: 'slide-stale-vn',
    targetMedia: 'hucard',
    toolchain: 'llvm-mos',
    pluginRoles: { builder: 'pce-slideshow-builder' },
    pluginSettings: {
      'pce-slideshow-builder': { template: 'slideshow-hucard' },
    },
  };

  assert.equal(buildSystem.repairHuCardSlideshowMainIfNeeded(projectDir, config), true);
  const restoredMain = fs.readFileSync(mainPath, 'utf-8');
  assert.match(restoredMain, /SLIDE_HOLD_FRAMES/);
  assert.doesNotMatch(restoredMain, /pce_vn_runtime/);

  const sources = buildSystem.collectSourceFiles(projectDir, config);
  assert.ok(sources.some((filePath) => path.basename(filePath) === 'main.c'));
  assert.ok(sources.some((filePath) => path.basename(filePath) === 'assets.c'));
  assert.ok(!sources.some((filePath) => path.basename(filePath) === 'vn.c'));

  const commandInfo = buildSystem.buildCommandForProject(projectDir, config, 'mos-pce-clang');
  assert.equal(commandInfo.targetMedia, 'hucard');
  assert.ok(commandInfo.args.some((arg) => path.basename(arg) === 'main.c'));
  assert.ok(!commandInfo.args.some((arg) => path.basename(arg) === 'vn.c'));
  assert.ok(!commandInfo.args.includes('-DPCE_EDITOR_TARGET_CD=1'));
});

test('PCE VN font library imports fonts into the project and resolves project-relative paths', () => {
  const vnManager = loadVnManager();
  const projectDir = makeTempDir('pce-vn-font-project-');
  // Source font lives in a folder with non-ASCII characters + a space, the kind
  // of path that broke ffmpeg's fontfile argument on Windows and forced the
  // silent fallback to the OS font.
  const sourceDir = path.join(makeTempDir('pce-vn-font-src-'), 'フォント 素材');
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourceFont = path.join(sourceDir, 'My フォント.ttf');
  fs.writeFileSync(sourceFont, Buffer.from('FONT-CONTENT-A'));

  const imported = vnManager.importFontFile(projectDir, sourceFont);
  const rel = imported.imported.file;
  assert.match(rel, /^assets\/fonts\/[a-zA-Z0-9_-]+\.ttf$/); // ASCII-safe copy
  assert.equal(imported.config.fontPath, rel); // newly imported font becomes active
  assert.equal(imported.config.fonts.length, 1);
  assert.equal(imported.config.fonts[0].label, 'My フォント.ttf'); // original name kept as label
  assert.equal(fs.existsSync(path.join(projectDir, rel)), true);

  // Config persists and re-reads with the project-relative reference.
  const reread = vnManager.readFontConfig(projectDir);
  assert.equal(reread.fontPath, rel);

  // fontCandidates resolves the relative reference to the in-project copy first.
  const candidates = vnManager.fontCandidates(reread, projectDir);
  assert.equal(candidates[0], path.join(projectDir, rel));

  // Re-importing identical bytes reuses the existing copy instead of duplicating.
  const again = vnManager.importFontFile(projectDir, sourceFont);
  assert.equal(again.config.fonts.length, 1);

  // A different font adds a second library entry and becomes active.
  const sourceFont2 = path.join(sourceDir, 'Other.ttf');
  fs.writeFileSync(sourceFont2, Buffer.from('FONT-CONTENT-B'));
  const imported2 = vnManager.importFontFile(projectDir, sourceFont2);
  assert.equal(imported2.config.fonts.length, 2);
  assert.equal(imported2.config.fontPath, imported2.imported.file);

  // Deleting the active font removes the copy and falls back to the OS font.
  const removed = vnManager.deleteFontFile(projectDir, imported2.imported.file);
  assert.equal(fs.existsSync(path.join(projectDir, imported2.imported.file)), false);
  assert.equal(removed.config.fonts.length, 1);
  assert.equal(removed.config.fontPath, '');

  // Unsupported extensions and path traversal are rejected.
  const txt = path.join(sourceDir, 'note.txt');
  fs.writeFileSync(txt, 'x');
  assert.throws(() => vnManager.importFontFile(projectDir, txt), /対応していない/);
  assert.throws(() => vnManager.deleteFontFile(projectDir, '../../escape.ttf'), /プロジェクト内/);
});

test('PCE VN font config without a selection uses OS fonts only', () => {
  const vnManager = loadVnManager();
  const projectDir = makeTempDir('pce-vn-font-os-');
  const config = vnManager.normalizeFontConfig({ fontPath: '', fonts: [] });
  assert.equal(config.fontPath, '');
  // No user font is prepended; candidates come from the OS font search only.
  const candidates = vnManager.fontCandidates(config, projectDir);
  assert.equal(candidates.includes(path.join(projectDir, 'assets', 'fonts')), false);
});

test('PCE VN font preview uses Windows OS fonts without ffmpeg or Python', { skip: process.platform !== 'win32' }, () => {
  const vnManager = loadVnManager();
  const projectDir = makeTempDir('pce-vn-font-win-');
  const preview = vnManager.previewFontText(projectDir, {
    config: {
      fontPath: '',
      fonts: [],
      fontSize: 11,
      threshold: 32,
      xOffset: 0,
      yOffset: 0,
      tileBase: 540,
      previewText: '私立',
    },
    text: '私立',
  });
  assert.notEqual(preview.renderer, 'fallback');
  assert.ok(preview.glyphs.some((entry) => entry.glyph !== ' ' && entry.bitmap.some(Boolean)));
});

test('PCE VN comment commands persist in the scene document but are excluded from the compiled pack', () => {
  const projectDir = makeTempDir('pce-vn-comment-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), { version: 2, assets: [] });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'label', name: 'top' },
        { type: 'comment', text: 'エディタ用メモ', color: '#abcdef' },
        { type: 'message', text: 'hi' },
        { type: 'goto', targetLabel: 'top' },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);

  // Comment persists in the saved (normalized) scene document.
  const doc = vnManager.readSceneDocument(projectDir);
  const comment = doc.scenes[0].commands.find((c) => c.type === 'comment');
  assert.ok(comment, 'comment command should be preserved in the scene document');
  assert.equal(comment.text, 'エディタ用メモ');
  assert.equal(comment.color, '#abcdef'); // editor-only color kept verbatim (no PCE snap)

  // The compiled pack drops the comment: 3 records (label, message, goto). The
  // goto target resolves to the label's compiled program counter (0), proving
  // PC / label indices stay consistent after the comment is filtered out.
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(pack[5], 3);
  assert.equal(generated.commandCount, 3);
  assert.equal(commandRecord(pack, 2).type, vnManager.VN_COMMAND_GOTO);
  assert.equal(commandRecord(pack, 2).x, 0);
});

test('PCE VN skipped commands persist but are excluded from generation inputs', () => {
  const projectDir = makeTempDir('pce-vn-skip-command-');
  const vnManager = loadVnManager();
  writeJson(path.join(projectDir, 'assets', 'pce-assets.json'), {
    version: 2,
    assets: [
      {
        id: 'voice_skip',
        type: 'adpcm',
        source: 'assets/adpcm/voice_skip.wav',
        data: { generated: { outputFile: 'assets/generated/voice_skip/adpcm.bin' } },
        options: { sampleRate: 16000 },
      },
    ],
  });
  writeJson(path.join(projectDir, vnManager.VN_SCENE_FILE), {
    version: 2,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      commands: [
        { type: 'message', text: '除外される', voiceAssetId: 'voice_skip', skip: true },
        { type: 'message', text: 'hi' },
      ],
    }],
  });

  const generated = vnManager.generateVnSources(projectDir);
  const doc = vnManager.readSceneDocument(projectDir);

  assert.equal(doc.scenes[0].commands[0].skip, true);
  assert.equal(generated.commandCount, 1);
  assert.equal(generated.messageCount, 1);
  assert.deepEqual(Array.from(vnManager.collectSceneRuntimeAssetIds(doc)), []);
  assert.equal(vnManager.collectGlyphsRaw(doc).includes('除'), false);

  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.equal(pack[5], 1);
  assert.equal(pack[6], 1);
});
