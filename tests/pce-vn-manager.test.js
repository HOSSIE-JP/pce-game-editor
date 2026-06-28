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
    version: 1,
    startScene: 'opening',
    scenes: [{
      id: 'opening',
      name: 'Chapter 1 / Opening',
      backgroundAssetId: 'bg',
      characters: [{ assetId: 'hero', x: 500, y: -10 }, { assetId: 'hero' }],
      messages: [{ text: 'こんにちは', voiceAssetId: 'voice', textSpeedFrames: 3, mouthAnimationId: 'mouth' }],
      bgmAssetId: 'track',
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
  assert.equal(normalized.scenes[0].commands[1].type, 'sprite');
  assert.equal(normalized.scenes[0].commands[1].x, 319);
  assert.equal(normalized.scenes[0].commands[1].y, 0);
  assert.equal(normalized.scenes[0].commands[2].x, 96);
  assert.equal(normalized.scenes[0].commands[2].y, 24);
  assert.equal(normalized.scenes[0].commands[3].type, 'audio');
  assert.equal(normalized.scenes[0].commands[4].textSpeedFrames, undefined);
  assert.equal(normalized.scenes[0].commands[4].advanceMode, undefined);
  assert.equal(normalized.scenes[0].nextSceneId, '');

  const prepared = vnManager.prepareVisualNovelBuild(projectDir, { cd: { dataFiles: [] } });
  assert.equal(prepared.configPatch.targetMedia, 'cd');
  assert.equal(prepared.configPatch.toolchain, 'llvm-mos');
  assert.deepEqual(prepared.configPatch.cd.dataFiles, [
    'assets/generated/vn/font.bin',
    'assets/generated/vn/overlay.bin',
    'assets/generated/vn/visual_code.bin',
    'assets/generated/vn/scenes/000_opening.bin',
    'assets/generated/voice/adpcm.bin',
  ]);
  assert.deepEqual(prepared.configPatch.cd.cddaTracks, ['assets/generated/track/cdda.wav']);
  assert.equal(prepared.generated.sceneCount, 1);
  assert.equal(prepared.generated.commandCount, 5);
  assert.equal(prepared.generated.messageCount, 1);
  assert.deepEqual(prepared.generated.scenePackPaths, ['assets/generated/vn/scenes/000_opening.bin']);
  assert.equal(prepared.generated.spriteAnimationCount, 2);
  const header = fs.readFileSync(prepared.generated.headerPath, 'utf-8');
  const source = fs.readFileSync(prepared.generated.sourcePath, 'utf-8');
  const pack = readPack(projectDir, prepared.generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_FONT_TILE_BASE 540u/);
  assert.match(header, /void pce_vn_font_tiles_map\(void\);/);
  assert.match(header, /PCE_VN_COMMAND_BACKGROUND 0u/);
  assert.doesNotMatch(header, /PCE_VN_COMMAND_PRELOAD/);
  assert.match(header, /PCE_VN_COMMAND_CHOICE 4u/);
  assert.match(header, /PCE_VN_SCENE_PACK_CACHE_BYTES 4096u/);
  assert.match(header, /typedef struct \{\n  pce_vn_cd_sector_t sector;/);
  assert.match(header, /pce_vn_command_t/);
  assert.match(source, /PCE_RAM_BANK_AT\(132, 6\);/);
  // CD build streams font tiles from a data file: only the small ref is in RAM.
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_font_data = \{/);
  assert.match(header, /typedef struct \{[\s\S]*?\} pce_vn_cd_data_ref_t;/);
  assert.match(header, /extern const pce_vn_cd_data_ref_t pce_vn_font_data;/);
  assert.match(header, /extern const unsigned int pce_vn_font_glyph_count;/);
  assert.match(source, /const unsigned int PCE_VN_DATA_SECTION pce_vn_font_glyph_count = \d+u;/);
  // Overlay code (bank133, time-shared into MPR slot 4) is streamed from CD. The
  // ref + load addr are always emitted; the blob's CD footprint is reserved at a
  // fixed size (2 sectors) up front, so the ref always points at a real sector.
  assert.match(header, /#define PCE_VN_OVERLAY_LOAD_ADDR 32768u/);
  assert.match(header, /extern const pce_vn_cd_data_ref_t pce_vn_overlay_data;/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_overlay_data = \{ \{ 65u, 0u, 0u \}, 2u, 4096u \};/);
  assert.match(header, /#define PCE_VN_VISUAL_CODE_LOAD_ADDR 32768u/);
  assert.match(header, /extern const pce_vn_cd_data_ref_t pce_vn_visual_code_data;/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_visual_code_data = \{ \{ 67u, 0u, 0u \}, 4u, 8192u \};/);
  // The reserved overlay blob exists on disk at exactly its reserved size, and
  // the linker fragment that places .vn_overlay / .vn_visual_code was written.
  assert.equal(fs.statSync(path.join(projectDir, 'assets', 'generated', 'vn', 'overlay.bin')).size, 4096);
  assert.equal(fs.statSync(path.join(projectDir, 'assets', 'generated', 'vn', 'visual_code.bin')).size, 8192);
  const overlayFragment = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'overlay_insert.ld'), 'utf-8');
  assert.match(overlayFragment, /\.vn_visual_code 0x1798000 : \{/);
  assert.match(overlayFragment, /\.vn_visual_code[\s\S]*>ram_bank121/);
  // Overlay LMA parks in bank132's tail after leaving a small resident-data
  // cushion. PSG song patterns stream from CD into bank134 rather than living in
  // bank132, so the LMA remains a benign copy that runtime never reads.
  assert.match(overlayFragment, /\.vn_overlay 0x8000 : AT\(0x184d078\)/);
  // The write-before-read fixed buffers (cd_transfer_scratch, glyph mask cache)
  // are parked NOLOAD over the overlay's never-read RAM window (CPU 0xd078) so the
  // whole [0xc000, 0xd078) region stays free for growing resident metadata.
  assert.match(overlayFragment, /\.ram_bank132_tail 0xd078 \(NOLOAD\) : \{[\s\S]*KEEP\(\*\(\.ram_bank132_tail \.ram_bank132_tail\.\*\)\)/);
  assert.doesNotMatch(overlayFragment, /\.vn_visual_cache112/);
  assert.doesNotMatch(overlayFragment, /\.vn_visual_cache119/);
  assert.match(overlayFragment, /INSERT AFTER \.ram_bank132;/);
  // The runtime declares bank133 for the message/sprite overlay and keeps the
  // experimental visual payload cache code/payload banks separate.
  const runtimeSrc = fs.readFileSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'), 'utf-8');
  assert.match(runtimeSrc, /PCE_RAM_BANK_AT\(133, 4\);/);
  assert.match(runtimeSrc, /#define VN_ENABLE_VISUAL_PAYLOAD_CACHE 1/);
  assert.match(runtimeSrc, /PCE_RAM_BANK_AT\(121, 4\);/);
  assert.match(runtimeSrc, /#define VN_VISUAL_CACHE_FIRST_BANK 112u/);
  assert.match(runtimeSrc, /static void load_overlay_code\(void\)/);
  assert.match(runtimeSrc, /#if VN_ENABLE_VISUAL_PAYLOAD_CACHE[\s\S]*static void load_visual_cache_code\(void\)/);
  assert.match(runtimeSrc, /#define VN_OVERLAY_CODE __attribute__\(\(noinline, section\(".vn_overlay"\)\)\)/);
  assert.doesNotMatch(runtimeSrc, /cd_rle_ref_to_vram/);
  assert.match(runtimeSrc, /VN_OVERLAY_CODE refresh_scene_sprite_patterns_impl\(/);
  assert.match(runtimeSrc, /VN_OVERLAY_CODE draw_message_glyph_at\(/);
  assert.match(runtimeSrc, /VN_RESIDENT_CODE call_overlay_draw_message_glyph_at\(/);
  assert.doesNotMatch(runtimeSrc, /\(uint8_t\)slot->animation_index/);
  // The standalone Phase B0 overlay TU must no longer be synced into the project.
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_overlay.c')), false);
  // The embedded byte array only survives in the non-CD (#else) fallback path.
  assert.match(source, /PCE_VN_FONT_SECTION pce_vn_font_tiles\[\]/);
  assert.equal(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'font.bin')), true);
  assert.equal(prepared.generated.fontDataPath, 'assets/generated/vn/font.bin');
  assert.match(source, /#define PCE_VN_DATA_SECTION __attribute__\(\(section\("\.ram_bank132"\)\)\)/);
  assert.match(source, /pce_ram_bank132_map\(\);/);
  assert.match(source, /const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations\[\]/);
  assert.match(header, /extern const unsigned int pce_vn_sprite_animation_count;/);
  assert.match(source, /const unsigned int PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = 2;/);
  assert.match(source, /const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs\[\]/);
  assert.doesNotMatch(source, /pce_vn_commands\[\]|pce_vn_messages\[\]|pce_vn_scenes\[\]/);
  assert.equal(pack.subarray(0, 4).toString('ascii'), 'PVNS');
  assert.equal(pack[4], 1);
  assert.equal(pack[5], 5);
  assert.equal(pack[6], 1);
  assert.equal(commandRecord(pack, 4).type, vnManager.VN_COMMAND_MESSAGE);
  const message = messageRecord(pack, 0);
  assert.equal(message.voiceIndex, 0);
  // The 3-byte placeholder voice is sub-frame, so the synced duration rounds to
  // zero frames and the global message speed is kept as the fallback.
  assert.equal(message.textSpeedFrames, vnManager.VN_DEFAULT_MESSAGE_SPEED_FRAMES);
  assert.equal(message.mouthAnimationIndex, 1);
  // ASCII glyphs are written as single bytes; the stream terminates with 0xff.
  assert.equal(pack[message.glyphOffset + message.glyphCount], 0xff);
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
  assert.equal(pack[message.glyphOffset + 6], 0xfe);
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
  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
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
  // glyphs: あ, newline marker, い (GLYPH_END is excluded from glyph_count). With
  // few glyphs each entry is a single byte; 0xfe marks the newline, 0xff ends the
  // stream. The runtime decodes 0xfe/0xff to PCE_VN_GLYPH_NEWLINE/_END (16-bit).
  assert.equal(message.glyphCount, 3);
  assert.equal(pack[message.glyphOffset + 1], 0xfe);
  assert.equal(pack[message.glyphOffset + message.glyphCount], 0xff);
  assert.match(header, /PCE_VN_GLYPH_NEWLINE 0xfffeu/);
  assert.match(header, /PCE_VN_MESSAGE_WAIT_GLYPH \d+u/);

  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
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

  // The runtime decoder understands the escape prefix and maps the newline/end
  // stream bytes back to the 16-bit sentinels (so escaped indices never collide).
  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
  assert.match(runtime, /b == PCE_VN_GLYPH_ESCAPE/);
  assert.match(runtime, /return PCE_VN_GLYPH_NEWLINE;/);
  assert.match(runtime, /return PCE_VN_GLYPH_END;/);
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
    'assets/generated/vn/font.bin',
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
    'assets/generated/vn/font.bin',
    'assets/generated/vn/overlay.bin',
    'assets/generated/vn/visual_code.bin',
    ...expectedCdDataFiles.slice(1),
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
  // Font data holds sector 64; overlay reserves sectors 65-66 and visual helper
  // code reserves sectors 67-70. Scene packs follow after those and their raw
  // assets. opening@71, then bg_a tiles (18432B=9 sectors) + map (1) + hero
  // patterns (2) push next@84.
  assert.match(source, /\{ \{ 71u, 0u, 0u \}, 1u, \d+u, -1 \}/);
  assert.match(source, /\{ \{ 84u, 0u, 0u \}, 1u, \d+u, -1 \}/);
  assert.equal(openingPack[5], 3);
  assert.equal(openingPack[7], 1);
  assert.deepEqual(commandRecord(openingPack, 0), {
    type: 0,
    assetIndex: 0,
    slot: 0,
    flags: vnManager.VN_BG_TRANSITION_FADE,
    arg0: vnManager.VN_BG_DEFAULT_FADE_FRAMES,
    arg1: vnManager.VN_BG_DEFAULT_FADE_FRAMES,
    x: 0,
    y: 0,
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
  assert.equal(nextPack[5], 8);
  assert.equal(commandRecord(nextPack, 0).type, vnManager.VN_COMMAND_EFFECT);
  assert.equal(commandRecord(nextPack, 0).flags, 0);
  assert.equal(commandRecord(nextPack, 0).x, vnManager.effectColorWord('#0000ff'));
  assert.equal(commandRecord(nextPack, 1).flags, vnManager.VN_BG_TRANSITION_FADE);
  assert.equal(commandRecord(nextPack, 1).arg0, 10);
  assert.equal(commandRecord(nextPack, 1).arg1, 20);
  assert.equal(commandRecord(nextPack, 3).flags, 3);
  assert.equal(commandRecord(nextPack, 3).arg0, 20);
  assert.equal(commandRecord(nextPack, 3).arg1, 6);
  assert.equal(commandRecord(nextPack, 4).flags, 4);
  assert.equal(commandRecord(nextPack, 4).arg0, 5);
  assert.equal(commandRecord(nextPack, 4).x, vnManager.effectColorWord('#00ff00'));
  assert.equal(commandRecord(nextPack, 6).type, vnManager.VN_COMMAND_WAIT);
  assert.equal(commandRecord(nextPack, 6).arg0, 45);
  assert.equal(commandRecord(nextPack, 7).sceneIndex, 0);
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
        { type: 'cache', scope: 'all' },
        { type: 'cache', action: 'load', scope: 'bg', assetId: 'bg_a', x: 2, y: 3 },
        { type: 'cache', action: 'load', scope: 'sprite', assetId: 'hero', slot: 2 },
        { type: 'cache', action: 'load', scope: 'adpcm', assetId: 'voice' },
        { type: 'preload', sceneId: 'next' },
        { type: 'wait', frames: 1 },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands.length, 9);
  assert.deepEqual(normalized.scenes[0].commands[0], { type: 'cache', action: 'clear', scope: 'visual' });
  assert.deepEqual(normalized.scenes[0].commands[1], { type: 'cache', action: 'clear', scope: 'bg' });
  assert.deepEqual(normalized.scenes[0].commands[2], { type: 'cache', action: 'clear', scope: 'sprite' });
  assert.deepEqual(normalized.scenes[0].commands[3], { type: 'cache', action: 'clear', scope: 'adpcm' });
  assert.deepEqual(normalized.scenes[0].commands[4], { type: 'cache', action: 'clear', scope: 'all' });
  assert.deepEqual(normalized.scenes[0].commands[5], { type: 'cache', action: 'load', scope: 'bg', assetId: 'bg_a', slot: 0, x: 2, y: 3 });
  assert.deepEqual(normalized.scenes[0].commands[6], { type: 'cache', action: 'load', scope: 'sprite', assetId: 'hero', slot: 2, x: 0, y: 0 });
  assert.deepEqual(normalized.scenes[0].commands[7], { type: 'cache', action: 'load', scope: 'adpcm', assetId: 'voice', slot: 0, x: 0, y: 0 });
  assert.equal(normalized.scenes[0].commands[8].type, 'wait');

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
  assert.match(header, /PCE_VN_CACHE_SCOPE_ALL 4u/);
  assert.doesNotMatch(header, /PCE_VN_COMMAND_PRELOAD/);
  assert.equal(generated.commandCount, 9);
  assert.equal(pack[5], 9);
  [
    vnManager.VN_CACHE_SCOPE_VISUAL,
    vnManager.VN_CACHE_SCOPE_BG,
    vnManager.VN_CACHE_SCOPE_SPRITE,
    vnManager.VN_CACHE_SCOPE_ADPCM,
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
  assert.deepEqual(commandRecord(pack, 5), {
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
  assert.deepEqual(commandRecord(pack, 6), {
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
  assert.deepEqual(commandRecord(pack, 7), {
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
  assert.equal(commandRecord(pack, 8).type, vnManager.VN_COMMAND_WAIT);
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

test('PCE VN manager encodes PSG audio playback with a base channel', () => {
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
        { type: 'audio', kind: 'psg', action: 'stop' },
      ],
    }],
  });

  const normalized = vnManager.readSceneDocument(projectDir);
  assert.equal(normalized.scenes[0].commands[0].kind, 'psg');
  assert.equal(normalized.scenes[0].commands[0].channel, 3);

  const generated = vnManager.generateVnSources(projectDir);
  const header = fs.readFileSync(generated.headerPath, 'utf-8');
  const pack = readPack(projectDir, generated.scenePackPaths[0]);
  assert.match(header, /PCE_VN_AUDIO_KIND_PSG 2u/);
  const play = commandRecord(pack, 0);
  assert.equal(play.type, vnManager.VN_COMMAND_AUDIO);
  // flags = kind(2) | action play(0x10); slot carries the base channel.
  assert.equal(play.flags, vnManager.VN_AUDIO_KIND_PSG | 0x10);
  assert.equal(play.slot, 3);
  assert.deepEqual(generated.assetIds, ['theme']);
  assert.equal(play.assetIndex, 0); // unused PSG assets are not emitted into VN runtime metadata
  const stop = commandRecord(pack, 1);
  assert.equal(stop.flags, vnManager.VN_AUDIO_KIND_PSG | 0x20);
  assert.equal(stop.assetIndex, -1);

  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
  assert.match(runtime, /kind == PCE_VN_AUDIO_KIND_PSG/);
  assert.match(runtime, /play_psg_asset\(command->asset_index, command->slot\)/);
  assert.match(runtime, /psg_load_basic_wave\(ch\)/);
  assert.match(runtime, /PCE_PSG_CONTROL = 0u;[\s\S]*PCE_PSG_WAVE =/);
  assert.doesNotMatch(runtime, /PCE_PSG_CONTROL = 0x40u; \/\* enable write to the waveform buffer \*\//);
  assert.match(runtime, /PCE_RAM_BANK_AT\(135, 6\);/);
  assert.match(runtime, /#define VN_PSG_PATTERN_BUFFER_BYTES \(VN_PSG_PATTERN_BANK_BYTES \* 2u\)/);
  assert.match(runtime, /psg_pattern_ram_bank135_reserved\[VN_PSG_PATTERN_BANK_BYTES\][\s\S]*section\("\.ram_bank135"\)/);
  assert.match(runtime, /pce_ram_bank135_map\(\);[\s\S]*\(const pce_editor_psg_step_t \*\)psg_pattern_ram/);
  assert.match(runtime, /#define VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES 20u/);
  assert.match(runtime, /#define VN_VISUAL_VRAM_COPY_SLICE_BYTES 64u/);
  assert.match(runtime, /#define VN_VISUAL_VRAM_COPY_FAST_SLICE_BYTES VN_CD_SECTOR_BYTES/);
  assert.match(runtime, /#define VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES\(\) \(\(psg_active && psg_current\) \? VN_VISUAL_VRAM_COPY_SLICE_BYTES : VN_VISUAL_VRAM_COPY_FAST_SLICE_BYTES\)/);
  assert.match(runtime, /static void VN_RESIDENT_CODE service_psg_during_blocking_work\(void\);/);
  assert.match(runtime, /static void VN_RESIDENT_CODE service_psg_during_blocking_frames\(uint8_t frames\);/);
  assert.match(runtime, /cd_transfer_wait\(void\)[\s\S]*service_psg_during_blocking_frames\(VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES\);/);
  // Resident SFX spread their PSG compensation ticks across the CD settle wait so
  // a sprite/BG load during playback no longer fast-forwards them into silence.
  assert.match(runtime, /if \(psg_active && !psg_pattern_banked\)[\s\S]*for \(wait = 0u; wait < \(65535u \/ VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES\); wait\+\+\) \{\}[\s\S]*service_psg_during_blocking_work\(\);/);
  assert.match(runtime, /cd_transfer_wait\(\);\r?\n        finish_cd_data_read_before_vram_copy\(\);\r?\n        vram_copy_sliced_from_vn_data\(vram_dest, cd_transfer_scratch, chunk\);/);
  assert.match(runtime, /vram_copy_sliced_from_vn_data_impl\(uint16_t dest, const uint8_t \*source, uint16_t length\)[\s\S]*const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES\(\);[\s\S]*pce_editor_vram_copy\(vram_dest, &source\[offset\], chunk\);[\s\S]*service_psg_during_visual_cache_work\(\);/);
  assert.match(runtime, /cd_transfer_wait\(\);\r?\n        finish_cd_data_read_before_vram_copy\(\);/);
  assert.match(runtime, /if \(dest_col == 0u && copy_width_tiles == VN_MAP_WIDTH\)[\s\S]*contiguous_bytes[\s\S]*vram_copy_sliced_from_vn_data\(\(uint16_t\)\(dest \+ \(\(uint16_t\)row \* VN_MAP_WIDTH\)\), &cd_transfer_scratch\[local_offset\], contiguous_bytes\);/);
  assert.match(runtime, /pce_editor_vram_copy\(\(uint16_t\)\(dest \+ \(\(uint16_t\)row \* VN_MAP_WIDTH\)\), &cd_transfer_scratch\[local_offset\], row_bytes\);\r?\n            service_psg_during_blocking_work\(\);/);
  assert.match(runtime, /fade_palette[\s\S]*delay_frame\(\);\r?\n        service_psg_during_blocking_work\(\);/);
  assert.match(runtime, /tick_psg\(\);[\s\S]*map_vn_data\(\);[\s\S]*VN_MAP_BANK130_FOR_CODE\(\);/);
  assert.match(runtime, /while \(frames--\)[\s\S]*service_psg_during_blocking_work\(\);/);
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

  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
  assert.match(runtime, /command->type == PCE_VN_COMMAND_INPUTCHECK/);
  assert.match(runtime, /sync_input_active = 1u;/);
  assert.match(runtime, /async_input_active = 1u;/);
});

test('PCE VN manager encodes spritetext overlays with a sprite-format font', () => {
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
  assert.match(header, /#define PCE_VN_FONT_SPRITE_PATTERN_BASE \d+u/);
  assert.match(header, /#define PCE_VN_FONT_SPRITE_PALETTE_BANK 15u/);
  assert.match(source, /pce_vn_font_sprite_glyph_count = 7u;/);
  assert.equal(generated.fontSpriteGlyphCount, 7);
  assert.equal(generated.fontSpriteByteSize, 7 * 128);
  // The sprite-format font file exists and is exactly one 128-byte pattern/glyph.
  const fontSprite = fs.readFileSync(path.join(projectDir, vnManager.VN_FONT_SPRITE_DATA_FILE));
  assert.equal(fontSprite.length, 7 * 128);

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
  // Glyph stream is stored inline at assetIndex: "PRESS RUN" -> indices.
  assert.deepEqual([...pack.subarray(show.assetIndex, show.assetIndex + 9)], [0, 1, 2, 3, 3, 4, 1, 5, 6]);

  const hide = commandRecord(pack, 1);
  assert.equal(hide.type, vnManager.VN_COMMAND_SPRITETEXT);
  assert.equal(hide.flags, 0); // visible:false clears the slot
  assert.equal(hide.arg1, 0);

  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
  assert.match(runtime, /command->type == PCE_VN_COMMAND_SPRITETEXT/);
  assert.match(runtime, /draw_spritetext_slots\(uint8_t satb_index\)/);
  assert.match(runtime, /upload_font_sprite_patterns\(void\)/);
  assert.match(runtime, /static void tick_spritetext\(void\)/);
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
  assert.match(source, /pce_vn_font_sprite_glyph_count = 0u;/);
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

  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
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
    /scene pack "opening" is \d+ bytes; split the scene to stay within 4096 bytes/
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
  // animation record points at.
  assert.match(source, /pce_vn_sprite_anim_delays_0\[\] = \{ 10u, 20u, 30u, 40u \}/);
  assert.match(source, /pce_vn_sprite_anim_delays_1\[\] = \{ 6u, 6u, 6u, 6u \}/);

  const runtime = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  );
  // The animation tick must index the per-frame table by the current frame.
  assert.match(runtime, /animation\.frame_delays\[slot->frame\]/);
});

test('PCE VN runtime keeps VDC DRAM refresh enabled while toggling display layers', () => {
  const wrapperPaths = [
    path.join(__dirname, '..', 'plugins', 'pce-sample-builder', 'template-vn', 'src', 'main.c'),
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'main.c'),
  ];
  for (const wrapperPath of wrapperPaths) {
    assert.equal(fs.readFileSync(wrapperPath, 'utf-8').trim(), '#include "pce_vn_runtime.c"');
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'), 'utf-8').replace(/\r\n/g, '\n');
  const showSceneMatch = source.match(/static void show_scene[\s\S]*?\}\s*\/\* Append the visible spritetext overlays/);
  const setBackgroundMatch = source.match(/static void set_background[\s\S]*?\}\s*static uint8_t VN_BANKED_CODE2 execute_control_command/);
  const executeCommandMatch = source.match(/static uint8_t VN_BANKED_CODE execute_command[\s\S]*?\}\s*static uint8_t VN_BANKED_CODE run_commands_until_wait/);
  assert.ok(showSceneMatch);
  assert.ok(setBackgroundMatch);
  assert.ok(executeCommandMatch);
  const showSceneSource = showSceneMatch[0];
  const setBackgroundSource = setBackgroundMatch[0];
  const executeCommandSource = executeCommandMatch[0];
  // The scene-entry preload pass was removed; assets stream on demand per command.
  // (Function definitions are gone; the removal note in a comment is fine.)
  assert.doesNotMatch(source, /VN_BANKED_CODE2 preload_scene_assets\(|VN_BANKED_CODE2 preload_scan_boundary\(|void preload_adpcm_voice\(/);
  assert.match(source, /#define VN_VDC_CONTROL_BASE \(VDC_CONTROL_IRQ_VBLANK \| VDC_CONTROL_DRAM_REFRESH \| VDC_CONTROL_VRAM_ADD_1\)/);
  assert.match(source, /#define VN_VDC_DISPLAY_CONTROL \(VN_VDC_CONTROL_BASE \| VDC_CONTROL_ENABLE_BG \| VDC_CONTROL_ENABLE_SPRITE\)/);
  assert.match(source, /#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE/);
  assert.match(source, /#define VN_UI_BLANK_TILE PCE_VN_BLANK_TILE/);
  assert.doesNotMatch(source, /static const uint8_t vn_ui_black_tile\[32\]/);
  assert.doesNotMatch(source, /vce_write_color\(\(uint16_t\)\(base \+ 1u\), 0x0000u\);/);
  assert.match(source, /for \(i = 1u; i < 16u; i\+\+\)/);
  assert.doesNotMatch(source, /static void upload_ui_tiles\(void\)/);
  // The 12px compositor keeps no full resident font table (RAM banks cannot hold
  // one); CD builds cache only the active message masks before ADPCM starts.
  assert.doesNotMatch(source, /PCE_RAM_BANK_AT\(131,/);
  assert.doesNotMatch(source, /static uint8_t msg_row_mask/);
  assert.match(source, /#define PCE_VN_FONT_MASK_VRAM_WORD/);
  // Shared strip tiles are rebuilt from the previous + current glyph (no VRAM
  // read-back to accumulate); active-message masks are served from RAM.
  assert.doesNotMatch(source, /read_msg_tile_mask/);
  assert.match(source, /static void VN_OVERLAY_CODE add_glyph_tile\(/);
  assert.match(source, /if \(gpx1 <= tile_x0 \|\| gpx0 >= tile_x1\) return;/);
  assert.doesNotMatch(source, /for \(gx = 0u; gx < VN_GLYPH_W; gx\+\+\)/);
  assert.match(source, /static uint16_t composer_prev_mask\[VN_GLYPH_MASK_WORDS\]/);
  assert.match(source, /#define VN_MESSAGE_GLYPH_CACHE_COUNT 68u/);
  assert.match(source, /static uint16_t message_glyph_cache_masks\[VN_MESSAGE_GLYPH_CACHE_COUNT\]\[VN_GLYPH_MASK_WORDS\] __attribute__\(\(section\("\.ram_bank132_tail"\)\)\);/);
  assert.match(source, /static pce_vn_message_t active_message_state __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /static void VN_BANKED_CODE vn_wait_next_vblank\(void\)[\s\S]*ldy #\$80\\n"[\s\S]*lda \$0000\\n"[\s\S]*and #\$20\\n"[\s\S]*bne vn_wait_vblank_done%=/);
  assert.doesNotMatch(source, /volatile uint16_t guard;/);
  // All shared VRAM copy paths are resident/noinline and IRQ-guarded; this covers
  // message window clears and raw BG/map/font/sprite pattern blits, not only glyph draw.
  assert.match(source, /static void VN_RESIDENT_CODE pce_editor_vram_copy\(uint16_t dest, const uint8_t \*source, uint16_t length\)/);
  assert.match(source, /static void VN_BANKED_CODE vn_vdc_set_copy_word\(void\)[\s\S]*st0 #\$05\\n\\tst2 #\$04/);
  assert.match(source, /static void VN_RESIDENT_CODE pce_editor_vram_copy_tia\(const uint8_t \*source, uint16_t length\)[\s\S]*\.byte \$e3, \$00, \$00, \$02, \$00, \$00, \$00/);
  assert.match(source, /static void VN_RESIDENT_CODE pce_editor_vram_copy[\s\S]*uint8_t irq = vn_vdc_irq_lock\(\);[\s\S]*const uint16_t even_length = \(uint16_t\)\(length & 0xfffeu\);[\s\S]*vn_vdc_set_copy_word\(\);[\s\S]*\*IO_VDC_INDEX = VDC_REG_VRAM_WRITE_ADDR;[\s\S]*\*IO_VDC_INDEX = VDC_REG_VRAM_DATA;[\s\S]*pce_editor_vram_copy_tia\(source, even_length\);[\s\S]*\*IO_VDC_DATA_LO = source\[even_length\];[\s\S]*\*IO_VDC_DATA_HI = 0u;[\s\S]*vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /#elif defined\(__PCE__\)[\s\S]*pce_vdc_copy_to_vram\(dest, source, length\);/);
  assert.match(source, /static void write_map_words\(uint16_t map_addr, const uint16_t \*words, uint16_t count\)\n\{\n    pce_editor_vram_copy\(map_addr, \(const uint8_t \*\)words, \(uint16_t\)\(count \* 2u\)\);\n\}/);
  assert.doesNotMatch(source, /static void write_map_words[\s\S]*pce_vdc_poke\(VDC_REG_VRAM_WRITE_ADDR, map_addr\);[\s\S]*pce_vdc_poke\(VDC_REG_VRAM_DATA, words\[i\]\);/);
  // Compositor scratch must be static (section .bss), not stack arrays: large stack
  // arrays in banked code were read back as zero, corrupting the BAT/strip writes.
  assert.match(source, /static uint16_t msg_bat_row\[VN_MSG_TILE_COLS\] __attribute__\(\(section\("\.bss"\)\)\);/);
  // Screen/rect clear + blank-tile buffers must also be section .bss, else they
  // wrote garbage tile refs into the margins (worse across scene transitions).
  assert.match(source, /static uint16_t clear_line\[VN_MAP_WIDTH\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /static uint8_t blank_tile_enc\[32\] __attribute__\(\(section\("\.bss"\)\)\);/);
  // upload_font_tiles streams the glyph masks from CD into VRAM at boot.
  assert.match(source, /pce_vn_cd_data_ref_t font;/);
  assert.match(source, /font = pce_vn_font_data;\n    map_resident_data\(\);/);
  assert.match(source, /\(void\)pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);\n        cd_transfer_wait\(\);\n        pce_editor_vram_copy\(vram_dest, cd_transfer_scratch, chunk\);/);
  assert.match(source, /upload_ui_palette\(\);\n    upload_font_tiles\(\);\n    upload_font_sprite_patterns\(\);\n    upload_blank_tile\(\);\n    clear_screen_map\(\);/);
  assert.match(source, /static uint8_t sprite_pattern_slots_for_size\(uint8_t cell_width, uint8_t cell_height\)/);
  assert.match(source, /if \(pattern_rows > 1u && row_pattern_slots < 2u\) row_pattern_slots = 2u;/);
  assert.match(source, /static uint16_t sprite_pattern_alignment_for_size\(uint8_t cell_width, uint8_t cell_height\)/);
  assert.match(source, /if \(cell_height >= 64u\) alignment = 16u;/);
  assert.match(source, /slot_pattern_base = align_sprite_pattern_base\(next_pattern_base, sprite->cell_width, sprite->cell_height\);/);
  assert.match(source, /next_pattern_base = \(uint16_t\)\(slot_pattern_base \+ pattern_units\);/);
  assert.match(source, /pattern_step = \(uint8_t\)\(sprite_pattern_slots_for_size\(cell_width, cell_height\) \* 2u\);/);
  assert.doesNotMatch(source, /vce_write_color\(0u, 0x0000u\);/);
  assert.match(source, /static void VN_OVERLAY_CODE encode_msg_tile\(const uint8_t \*mask8, uint8_t \*out32\)/);
  assert.match(source, /static void VN_BANKED_CODE2 map_message_window_cells\(uint8_t blank\)/);
  assert.match(source, /msg_bat_row\[tc\] = ui_tile\(blank \? PCE_VN_BLANK_TILE : \(uint16_t\)\(row_tile \+ tc\)\);/);
  assert.match(source, /static void VN_BANKED_CODE2 clear_window_tile_pixels\(void\)/);
  assert.doesNotMatch(source, /static void VN_BANKED_CODE2 clear_window_cells\(void\)/);
  // The 12x12 compositor preloads message masks before voice playback and falls
  // back to VRAM reads only for uncached glyphs.
  assert.match(source, /instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT\(message->mouth_slot\);/);
  assert.match(source, /if \(instant_glyph_count\)/);
  assert.match(source, /message_complete = draw_message_prefix_glyphs_locked\(message\);[\s\S]*?play_adpcm_voice\(message->voice_index\);/);
  assert.match(source, /gmask = cached_message_glyph_mask\(glyph\);\n    if \(!gmask\)/);
  assert.match(source, /pce_vdc_copy_from_vram\(msg_gmask,/);
  assert.match(source, /const uint16_t px0 = \(uint16_t\)col \* VN_GLYPH_W;/);
  assert.match(source, /clear_window_tile_pixels\(\);/);
  assert.doesNotMatch(source, /fill_window_rect/);
  // draw_message_next_glyph / draw_message_text live in the bank133 overlay; the
  // resident wrappers mask IRQs across bank133 map, overlay VDC work, and bank130 restore.
  assert.match(source, /static uint8_t VN_OVERLAY_CODE draw_message_next_glyph/);
  assert.match(source, /static uint8_t VN_OVERLAY_CODE draw_message_prefix_glyphs/);
  assert.match(source, /uint8_t irq = vn_vdc_irq_lock\(\);\n    pce_ram_bank133_map\(\);\n    complete = draw_message_next_glyph\(message\);\n    pce_ram_bank130_map\(\);\n    vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /uint8_t irq = vn_vdc_irq_lock\(\);\n    pce_ram_bank133_map\(\);\n    complete = draw_message_prefix_glyphs\(message\);\n    pce_ram_bank130_map\(\);\n    vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /uint8_t irq = vn_vdc_irq_lock\(\);\n    pce_ram_bank133_map\(\);\n    draw_message_text\(message\);\n    pce_ram_bank130_map\(\);\n    vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /uint8_t irq = vn_vdc_irq_lock\(\);\n    pce_ram_bank133_map\(\);\n    preload_message_glyph_masks\(message\);\n    pce_ram_bank130_map\(\);\n    vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /uint8_t irq = vn_vdc_irq_lock\(\);\n    pce_ram_bank133_map\(\);\n    draw_message_glyph_at\(glyph, col, row\);\n    pce_ram_bank130_map\(\);\n    vn_vdc_irq_unlock\(irq\);/);
  // The runtime applies the editor-baked text_speed; it does not recompute the
  // ADPCM-synced speed at runtime.
  assert.match(source, /message_text_speed = message->text_speed_frames;\n        restore_window_display = begin_message_window_vram_update\(\);\n        clear_window_tile_pixels\(\);/);
  assert.match(source, /if \(!message_complete && !message_text_speed\)/);
  assert.match(source, /end_message_window_vram_update\(restore_window_display\);\n        if \(!restore_window_display && !pending_display_enable\) delay_frame\(\);/);
  const beginMessageWindowStart = source.indexOf('static uint8_t VN_BANKED_CODE2 begin_message_window_vram_update(void)');
  const endMessageWindowStart = source.indexOf('static void VN_BANKED_CODE2 end_message_window_vram_update(uint8_t restore_display)');
  const startMessageStart = source.indexOf('static void start_message(uint8_t message_index)');
  assert.notEqual(beginMessageWindowStart, -1);
  assert.notEqual(endMessageWindowStart, -1);
  assert.notEqual(startMessageStart, -1);
  const beginMessageWindowSource = source.slice(beginMessageWindowStart, endMessageWindowStart);
  const endMessageWindowSource = source.slice(endMessageWindowStart, startMessageStart);
  assert.match(beginMessageWindowSource, /map_message_window_cells\(0u\);[\s\S]*vn_wait_next_vblank\(\);[\s\S]*map_message_window_cells\(1u\);[\s\S]*return 1u;/);
  assert.doesNotMatch(beginMessageWindowSource, /display_disable\(\)|pending_display_enable = 1u;/);
  assert.match(endMessageWindowSource, /vn_wait_next_vblank\(\);[\s\S]*map_message_window_cells\(0u\);[\s\S]*delay_frame\(\);/);
  assert.doesNotMatch(endMessageWindowSource, /display_enable\(\)|pending_display_enable = 0u;/);
  const finishActiveMessageStart = source.indexOf('static void finish_active_message(void)');
  const tickActiveMessageStart = source.indexOf('static void tick_active_message(void)');
  assert.notEqual(finishActiveMessageStart, -1);
  assert.notEqual(tickActiveMessageStart, -1);
  const finishActiveMessageSource = source.slice(finishActiveMessageStart, tickActiveMessageStart);
  assert.match(finishActiveMessageSource, /while \(!message_complete\)[\s\S]*message_complete = draw_message_next_glyph_locked\(&active_message_state\);/);
  assert.doesNotMatch(finishActiveMessageSource, /begin_message_window_vram_update|end_message_window_vram_update|draw_message_text_locked/);
  assert.match(source, /active_message_state = \*message;\n        message = &active_message_state;/);
  const tickActiveMessageMatch = source.match(/static void tick_active_message\(void\)[\s\S]*?\n\}/);
  assert.ok(tickActiveMessageMatch);
  assert.doesNotMatch(tickActiveMessageMatch[0], /scene_pack_read_message/);
  assert.doesNotMatch(source, /message_voice_text_speed/);
  assert.doesNotMatch(source, /adpcm_play_frames_remaining \/ message->glyph_count/);
  assert.match(source, /draw_message_text\(message\);/);
  assert.match(source, /static void fade_palette/);
  assert.match(source, /static uint8_t pending_scene_sprite_clear = 0;/);
  assert.match(source, /static uint8_t preloaded_scene_visual_valid = 0;/);
  assert.match(source, /static uint8_t preloaded_scene_index = 0;/);
  assert.match(source, /static uint8_t loaded_sprite_pattern_valid\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint16_t loaded_sprite_pattern_index\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint16_t loaded_sprite_pattern_base\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint16_t loaded_sprite_pattern_units\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint8_t loaded_sprite_palette_bank\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint8_t loaded_adpcm_valid = 0;/);
  assert.match(source, /static void init_runtime_state\(void\)/);
  assert.match(source, /current_bg_index = -1;/);
  assert.match(source, /static uint8_t current_scene_full_screen_bg = 0;/);
  assert.match(source, /static uint8_t full_screen_bg_text_vram_dirty = 0;/);
  assert.match(source, /current_scene_full_screen_bg = 0u;/);
  assert.match(source, /full_screen_bg_text_vram_dirty = 0u;/);
  assert.match(source, /#define VN_SCENE_PACK_OFFSET_FLAGS 9u/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 scene_pack_full_screen_bg/);
  assert.match(source, /static void VN_BANKED_CODE2 restore_text_vram_after_full_screen_bg\(void\)[\s\S]*upload_font_tiles\(\);[\s\S]*upload_font_sprite_patterns\(\);[\s\S]*upload_blank_tile\(\);[\s\S]*message_glyph_cache_valid = 0u;[\s\S]*full_screen_bg_text_vram_dirty = 0u;/);
  assert.match(showSceneSource, /current_scene_full_screen_bg = scene_pack_full_screen_bg\(&active_scene_pack\);/);
  assert.match(showSceneSource, /previous_full_screen_bg = current_scene_full_screen_bg;[\s\S]*current_scene_full_screen_bg = scene_pack_full_screen_bg\(&active_scene_pack\);/);
  assert.match(showSceneSource, /&& !\(previous_full_screen_bg && !current_scene_full_screen_bg\)/);
  assert.match(showSceneSource, /display_disable\(\);[\s\S]*if \(previous_full_screen_bg && !current_scene_full_screen_bg\)[\s\S]*restore_text_vram_after_full_screen_bg\(\);[\s\S]*clear_screen_map\(\);/);
  assert.match(setBackgroundSource, /if \(current_scene_full_screen_bg\)[\s\S]*full_screen_bg_text_vram_dirty = 1u;[\s\S]*for \(i = 0u; i < VN_SPRITE_SLOT_COUNT; i\+\+\)[\s\S]*loaded_sprite_pattern_valid\[i\] = 0u;/);
  assert.match(executeCommandSource, /PCE_VN_COMMAND_SPRITE[\s\S]*if \(current_scene_full_screen_bg\) return VN_EXEC_CONTINUE;/);
  assert.match(executeCommandSource, /PCE_VN_COMMAND_MESSAGE[\s\S]*if \(current_scene_full_screen_bg\) return VN_EXEC_CONTINUE;[\s\S]*restore_text_vram_after_full_screen_bg\(\);/);
  assert.match(source, /PCE_VN_COMMAND_CHOICE[\s\S]*restore_text_vram_after_full_screen_bg\(\);[\s\S]*start_choice/);
  assert.match(executeCommandSource, /PCE_VN_COMMAND_SPRITETEXT[\s\S]*if \(current_scene_full_screen_bg\) return VN_EXEC_CONTINUE;[\s\S]*restore_text_vram_after_full_screen_bg\(\);/);
  assert.match(source, /preloaded_bg_valid = 0u;/);
  assert.match(source, /preloaded_scene_visual_valid = 0u;/);
  assert.match(source, /preloaded_scene_index = 0u;/);
  assert.match(source, /loaded_sprite_pattern_valid\[i\] = 0u;/);
  assert.match(source, /active_message_index = -1;/);
  assert.match(source, /active_choice_index = -1;/);
  assert.match(source, /#define VN_VDC_BG_ONLY_CONTROL \(VN_VDC_CONTROL_BASE \| VDC_CONTROL_ENABLE_BG\)/);
  assert.match(source, /#define VN_CDB_VDC_CONTROL_SHADOW_LO \(\(volatile uint8_t \*\)0x20f3\)/);
  assert.match(source, /#define VN_CDB_VDC_CONTROL_SHADOW_HI \(\(volatile uint8_t \*\)0x20f4\)/);
  assert.match(source, /PCE_RAM_BANK_AT\(128, 2\);/);
  assert.match(source, /PCE_RAM_BANK_AT\(129, 3\);/);
  assert.match(source, /PCE_RAM_BANK_AT\(130, 4\);/);
  assert.match(source, /PCE_CDB_USE_GRAPHICS_DRIVER\(0\);/);
  assert.match(source, /#define VN_BANKED_CODE __attribute__\(\(noinline, section\("\.ram_bank129"\)\)\)/);
  assert.match(source, /#define VN_BANKED_CODE2 __attribute__\(\(noinline, section\("\.ram_bank130"\)\)\)/);
  assert.match(source, /#define VN_VDC_MEMORY_CONTROL \(VDC_CYCLE_4_SLOTS \| VDC_BG_SIZE_32_32\)/);
  assert.match(source, /static void map_resident_data\(void\)/);
  assert.match(source, /pce_ram_bank128_map\(\);/);
  assert.match(source, /static void set_vdc_control\(uint16_t control\)/);
  assert.match(source, /static void set_vdc_control\(uint16_t control\)[\s\S]*uint8_t irq = vn_vdc_irq_lock\(\);[\s\S]*pce_vdc_poke\(VDC_REG_CONTROL, control\);[\s\S]*vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /\*VN_CDB_VDC_CONTROL_SHADOW_LO = \(uint8_t\)\(control & 0xffu\);/);
  assert.match(source, /\*VN_CDB_VDC_CONTROL_SHADOW_HI = \(uint8_t\)\(control >> 8\);/);
  assert.match(source, /static void apply_screen_offset\(void\)[\s\S]*uint8_t irq = vn_vdc_irq_lock\(\);[\s\S]*pce_vdc_poke\(VDC_REG_BG_SCROLL_X, scroll_value_from_offset\(screen_shake_x, VN_BG_SCROLL_WIDTH\)\);[\s\S]*pce_vdc_poke\(VDC_REG_BG_SCROLL_Y, scroll_value_from_offset\(screen_shake_y, VN_BG_SCROLL_HEIGHT\)\);[\s\S]*vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /static void VN_BANKED_CODE restore_video_after_cdb_call\(uint8_t restore_display\)/);
  assert.match(source, /static void VN_BANKED_CODE restore_video_after_cdb_call\(uint8_t restore_display\)[\s\S]*uint8_t irq;[\s\S]*vn_wait_next_vblank\(\);[\s\S]*irq = vn_vdc_irq_lock\(\);[\s\S]*set_vdc_control\(restore_display \? VN_VDC_DISPLAY_CONTROL : VN_VDC_BLANK_CONTROL\);[\s\S]*pce_irq_disable\(IRQ_VDC\);[\s\S]*vn_vdc_irq_unlock\(irq\);/);
  assert.match(source, /pce_vdc_set_resolution\(256, 224, VCE_COLORBURST_ON\);[\s\S]*pce_vdc_bg_set_size\(VDC_BG_SIZE_32_32\);[\s\S]*pce_vdc_poke\(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL\);/);
  assert.match(source, /pce_vdc_sprite_set_table_start\(VN_SATB_ADDR\);[\s\S]*apply_screen_offset\(\);[\s\S]*set_vdc_control\(restore_display \? VN_VDC_DISPLAY_CONTROL : VN_VDC_BLANK_CONTROL\);/);
  assert.match(source, /static uint8_t VN_BANKED_CODE refresh_scene_sprite_patterns\(void\)[\s\S]*pce_ram_bank133_map\(\);[\s\S]*result = refresh_scene_sprite_patterns_impl\(\);[\s\S]*pce_ram_bank130_map\(\);/);
  assert.match(source, /static void VN_BANKED_CODE2 display_disable\(void\)[\s\S]*vn_wait_next_vblank\(\);[\s\S]*set_vdc_control\(VN_VDC_BLANK_CONTROL\);/);
  assert.match(source, /static void VN_BANKED_CODE2 display_enable\(void\)[\s\S]*vn_wait_next_vblank\(\);[\s\S]*set_vdc_control\(VN_VDC_DISPLAY_CONTROL\);/);
  assert.match(source, /static void VN_BANKED_CODE2 sprite_layer_disable\(void\)/);
  assert.match(source, /static void VN_BANKED_CODE2 sprite_layer_disable\(void\)[\s\S]*vn_wait_next_vblank\(\);[\s\S]*set_vdc_control\(VN_VDC_BG_ONLY_CONTROL\);/);
  assert.match(source, /static void VN_BANKED_CODE2 sprite_layer_enable\(void\)/);
  assert.match(source, /static void VN_BANKED_CODE2 sprite_layer_enable\(void\)[\s\S]*vn_wait_next_vblank\(\);[\s\S]*set_vdc_control\(VN_VDC_DISPLAY_CONTROL\);/);
  assert.doesNotMatch(source, /pce_cdb_vdc_/);
  assert.match(showSceneSource, /keep_display_for_transition = \(uint8_t\)\(current_bg_index >= 0[\s\S]*&& !pending_display_enable[\s\S]*&& !\(previous_full_screen_bg && !current_scene_full_screen_bg\)\);/);
  assert.match(showSceneSource, /use_preloaded_scene_visual = \(uint8_t\)\(pending_display_enable[\s\S]*preloaded_scene_visual_valid[\s\S]*preloaded_scene_index == scene_index\);/);
  assert.match(showSceneSource, /begin_cdda_deferred_resume\(\);[\s\S]*if \(!load_scene_pack_into_cache\(scene_index, &active_scene_pack\)\)[\s\S]*end_cdda_deferred_resume\(\);[\s\S]*return;/);
  assert.match(showSceneSource, /if \(!use_preloaded_scene_visual\)[\s\S]*clear_screen_map\(\);[\s\S]*preloaded_bg_valid = 0u;[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(showSceneSource, /REQUEST_SPRITE_REFRESH_FULL\(\);[\s\S]*preloaded_scene_visual_valid = 0u;[\s\S]*end_cdda_deferred_resume\(\);/);
  assert.doesNotMatch(showSceneSource, /preload_scene_assets/);
  assert.match(source, /static void clear_map_rect_at_dest\(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles\)/);
  assert.match(source, /static void clear_bg_map_region\(const pce_editor_bg_asset_t \*bg, uint16_t tile_x, uint16_t tile_y\)/);
  assert.match(source, /static void clear_bg_map_side_margins\(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles\)/);
  // Step 2: fades read the resident BG palette snapshot, not a (possibly CD-streamed) descriptor.
  assert.match(setBackgroundSource, /const pce_editor_data_ref_t ref = \{ current_bg_palette, current_bg_palette_size,[\s\S]*fade_palette\(&ref, current_bg_palette_base, bg_fade_out_frames, 0u\);/);
  assert.match(setBackgroundSource, /const uint8_t restore_display_after_bg_load = \(uint8_t\)!pending_display_enable;/);
  assert.match(setBackgroundSource, /clear_bg_map_region\(vn_get_bg_asset\(\(uint16_t\)current_bg_index\), current_bg_x, current_bg_y\);/);
  assert.match(setBackgroundSource, /clear_bg_map_region\(next_bg, next_x, next_y\);/);
  assert.match(setBackgroundSource, /upload_bg_graphics\(next_bg, bg_map_dest_from_tile\(next_bg, next_x, next_y\), \(uint16_t\)bg_index\);[\s\S]*if \(current_scene_full_screen_bg\)[\s\S]*if \(restore_display_after_bg_load\) display_enable\(\);/);
  assert.match(setBackgroundSource, /else if \(pending_display_enable\)\n    \{\n        display_enable\(\);\n        pending_display_enable = 0u;\n        delay_frame\(\);\n    \}/);
  assert.doesNotMatch(setBackgroundSource, /display_disable\(\);/);
  assert.doesNotMatch(setBackgroundSource, /preload_scene_assets/);
  assert.match(source, /if \(pending_scene_sprite_clear\)\n    \{\n        clear_sprites\(\);\n        upload_sprite_table\(\);/);
  assert.match(source, /bg_ready = \(uint8_t\)\(preloaded_bg_valid\n        && preloaded_bg_index == \(uint16_t\)bg_index\n        && preloaded_bg_x == next_x\n        && preloaded_bg_y == next_y\);/);
  assert.match(source, /static void VN_BANKED_CODE refresh_scene_sprites\(void\)/);
  assert.match(source, /#define VN_SPRITE_REFRESH_PATTERNS 1u/);
  assert.match(source, /if \(changed\) REQUEST_SPRITE_REFRESH_PATTERNS\(\);/);
  assert.match(source, /if \(!adpcm_playback_active\(\)\)\n        \{\n            tick_sprite_animations\(\);/);
  assert.match(source, /pending_sprite_refresh == VN_SPRITE_REFRESH_PATTERNS && refresh_scene_sprite_patterns\(\)/);
  {
    const fastRefreshMatch = source.match(/static uint8_t VN_OVERLAY_CODE refresh_scene_sprite_patterns_impl[\s\S]*?static uint8_t VN_BANKED_CODE refresh_scene_sprite_patterns/);
    assert.ok(fastRefreshMatch);
    assert.match(fastRefreshMatch[0], /upload_sprite_pattern_words\(satb_index, expected_count\)/);
    assert.doesNotMatch(fastRefreshMatch[0], /upload_palette|ensure_sprite_patterns_loaded|clear_sprites\(\)|upload_sprite_table\(\)/);
  }
  assert.match(source, /const uint8_t display_active = \(uint8_t\)!pending_display_enable;/);
  assert.match(source, /uint8_t requires_safe_hide = 0u;/);
  assert.match(source, /map_vn_data\(\);\n    map_resident_data\(\);/);
  assert.match(source, /static uint8_t sprite_slot_pattern_valid\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint16_t sprite_slot_pattern_base\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /static uint8_t sprite_slot_palette_bank\[VN_SPRITE_SLOT_COUNT\]/);
  assert.match(source, /#define VN_SPRITE_PATTERN_END_BASE \(VN_SATB_ADDR \/ 32u\)/);
  assert.match(source, /pattern_units = sprite_pattern_units_for_ref\(&sprite->patterns\);/);
  assert.match(source, /PCE_VN_SPRITE_PATTERN_BASE/);
  assert.match(source, /sprite_slot_pattern_base\[i\] = slot_pattern_base;[\s\S]*sprite_slot_palette_bank\[i\] = palette_bank;[\s\S]*sprite_slot_pattern_valid\[i\] = 1u;/);
  assert.match(source, /sprite_pattern_ranges_overlap\(slot_pattern_base, pattern_units, loaded_sprite_pattern_base\[j\], loaded_sprite_pattern_units\[j\]\)[\s\S]*requires_safe_hide = 1u;/);
  assert.match(source, /loaded_sprite_palette_bank\[j\] != palette_bank[\s\S]*requires_safe_hide = 1u;/);
  assert.match(source, /pce_editor_sprite_draw_meta_t draw_meta;/);
  assert.match(source, /draw_meta\.pattern_base = sprite_slot_pattern_base\[i\];/);
  assert.match(source, /draw_meta\.palette_bank = sprite_slot_palette_bank\[i\];/);
  assert.match(source, /if \(display_active && requires_safe_hide\)\n    \{\n        sprite_layer_disable\(\);\n        upload_sprite_table\(\);\n        delay_frame\(\);/);
  // Step 2: sprite draw fields come from the (resident or CD-streamed) asset descriptor
  // via vn_get_sprite_asset, not the separate pce_editor_sprite_draw_meta table.
  assert.match(source, /sprite = vn_get_sprite_asset\(sprite_index\);/);
  assert.match(source, /#define SNAPSHOT_DATA_REF\(dest, source\)/);
  assert.match(source, /SNAPSHOT_DATA_REF\(sprite_palette, sprite->palette\);/);
  assert.match(source, /SNAPSHOT_DATA_REF\(sprite_patterns, sprite->patterns\);/);
  assert.match(source, /draw_meta\.cell_width = sprite->cell_width;/);
  assert.match(source, /sprite_slot_draw_meta\[i\] = draw_meta;/);
  assert.match(source, /sprite_slot_cell_map\[i\] = sprite_cell_map;/);
  assert.doesNotMatch(source, /draw_meta = &pce_editor_sprite_draw_meta\[sprite_index\];/);
  assert.match(source, /static uint8_t VN_OVERLAY_CODE show_character_sprite_frame/);
  assert.match(source, /static uint8_t VN_BANKED_CODE call_overlay_show_character_sprite_frame/);
  assert.match(source, /call_overlay_show_character_sprite_frame\([\s\S]*?&draw_meta,\n                sprite_cell_map,/);
  assert.match(source, /show_character_sprite_frame\(\n            satb_index,\n            &sprite_slot_draw_meta\[i\],\n            sprite_slot_cell_map\[i\],/);
  assert.match(source, /animation_value\.first_cell = slot->anim_first_cell;/);
  assert.match(source, /animation->frame_count >= 1u/);
  assert.match(source, /animation->frame_width_cells <= cell_columns/);
  assert.match(source, /frame_columns = use_animation_frame && animation->frame_width_cells \? animation->frame_width_cells : cell_columns;/);
  assert.match(source, /upload_sprite_table\(\);[\s\S]*if \(!sprite_slot_pattern_valid\[i\]\) loaded_sprite_pattern_valid\[i\] = 0u;[\s\S]*if \(display_active && requires_safe_hide\)\n    \{\n        sprite_layer_enable\(\);\n        delay_frame\(\);/);
  assert.match(source, /#define VN_CD_SECTOR_BYTES 2048u/);
  assert.match(source, /#define VN_MAP_ROW_BYTES \(VN_MAP_WIDTH \* 2u\)/);
  // cd_transfer_scratch lives in bank132 (MPR6), not console_ram, to relieve the
  // scarce work RAM. The CD->VRAM helpers map MPR6 before touching it. It sits in
  // ".ram_bank132_tail" (NOLOAD) so it reuses the overlay's never-read LMA window
  // and leaves the [0xc000, VN_OVERLAY_LMA) region for growing resident metadata.
  assert.match(source, /static uint8_t cd_transfer_scratch\[VN_CD_SECTOR_BYTES\] __attribute__\(\(section\("\.ram_bank132_tail"\)\)\);/);
  assert.match(source, /map_vn_data\(\);\n    while \(remaining\)\n    \{[\s\S]*?cd_transfer_scratch/);
  assert.match(source, /static uint8_t vn_active_scene_pack_data\[PCE_VN_SCENE_PACK_CACHE_BYTES\];/);
  assert.match(source, /static vn_sprite_slot_t sprite_slots_storage\[VN_SPRITE_SLOT_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /#define sprite_slots sprite_slots_storage/);
  assert.match(source, /typedef struct\s*\{[\s\S]*uint8_t \*data;[\s\S]*uint16_t size;[\s\S]*uint8_t scene_index;[\s\S]*uint8_t valid;[\s\S]*\} vn_scene_pack_cache_t;/);
  assert.match(source, /static vn_scene_pack_cache_t active_scene_pack;/);
  assert.match(source, /static uint8_t vn_command_scratch_storage\[sizeof\(pce_vn_command_t\)\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /#define VN_COMMAND_SCRATCH \(\(pce_vn_command_t \*\)\(void \*\)vn_command_scratch_storage\)/);
  assert.match(source, /#define VN_MESSAGE_SCRATCH \(\(pce_vn_message_t \*\)\(void \*\)vn_message_scratch_storage\)/);
  assert.doesNotMatch(source, /pce_vn_command_t command;/);
  assert.doesNotMatch(source, /pce_vn_message_t message;/);
  assert.doesNotMatch(source, /vn_preload_scene_pack_data/);
  assert.doesNotMatch(source, /preload_scene_pack/);
  assert.match(source, /#define VN_SCENE_PACK_MAGIC_P 0x50u/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 load_scene_pack_into_cache\(uint8_t scene_index, vn_scene_pack_cache_t \*cache\)/);
  assert.match(source, /pce_vn_scene_pack_t pack;/);
  assert.match(source, /pack = pce_vn_scene_packs\[scene_index\];/);
  assert.match(source, /pack\.byte_size > PCE_VN_SCENE_PACK_CACHE_BYTES/);
  assert.match(source, /pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)&cache->data\[offset\], chunk\);/);
  // scene_pack_read_command / scene_pack_read_message are in bank130 to relieve
  // the bank129 interpreter (audio + sprite content was overflowing bank129).
  assert.match(source, /static uint8_t VN_BANKED_CODE2 scene_pack_read_command\(const vn_scene_pack_cache_t \*cache, uint8_t command_index, pce_vn_command_t \*command\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 scene_pack_read_message\(const vn_scene_pack_cache_t \*cache, uint8_t message_index, pce_vn_message_t \*message\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 scene_pack_read_choice\(const vn_scene_pack_cache_t \*cache, uint8_t choice_index, vn_choice_ref_t \*choice\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 scene_pack_read_switch\(const vn_scene_pack_cache_t \*cache, uint8_t switch_index, vn_switch_ref_t \*branch\)/);
  assert.doesNotMatch(source, /pce_vn_commands\[/);
  assert.doesNotMatch(source, /pce_vn_messages\[/);
  assert.doesNotMatch(source, /pce_vn_scenes\[/);
  assert.match(source, /static uint8_t cdda_active = 0;/);
  assert.match(source, /static pce_sector_t cdda_resume_start __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /static pce_sector_t cdda_resume_end __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /static uint8_t cdda_resume_defer_depth = 0;/);
  assert.match(source, /static uint8_t adpcm_play_active = 0;/);
  assert.match(source, /static uint16_t adpcm_play_frames_remaining = 0;/);
  assert.match(source, /static uint8_t adpcm_stream_active = 0;/);
  assert.match(source, /static uint8_t adpcm_stream_looping = 0;/);
  assert.doesNotMatch(source, /adpcm_stream_buffered_fallback|adpcm_stream_monitor_frames/);
  assert.match(source, /#define VN_ADPCM_FRAME_RATE 60ul/);
  assert.match(source, /#define VN_ADPCM_END_PAD_FRAMES 2ul/);
  assert.match(source, /static void VN_BANKED_CODE2 service_adpcm_playback\(void\);/);
  assert.match(source, /static void cd_sector_from_ref\(pce_sector_t \*dest, const pce_editor_cd_sector_t \*source\)/);
  assert.match(source, /dest->hi = source \? source->hi : 0u;/);
  assert.match(source, /static void cd_sector_from_uint\(pce_sector_t \*dest, unsigned long value\)/);
  assert.match(source, /static void cd_sector_advance\(pce_sector_t \*sector\)/);
  assert.match(source, /static void cd_transfer_wait\(void\)/);
  assert.match(source, /for \(wait = 0u; wait < 65535u; wait\+\+\) \{\}/);
  assert.match(source, /static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call\(void\)/);
  assert.match(source, /if \(!adpcm_stream_active\)[\s\S]*pce_cdb_irq_disable\(PCE_CDB_MASK_IRQ_EXTERNAL\);/);
  assert.match(source, /static void VN_BANKED_CODE2 begin_cdda_deferred_resume\(void\)/);
  assert.match(source, /static void VN_BANKED_CODE2 end_cdda_deferred_resume\(void\)/);
  assert.match(source, /static void VN_BANKED_CODE prepare_cd_data_access\(void\)/);
  assert.match(source, /pce_cdb_irq_enable\(PCE_CDB_MASK_IRQ_EXTERNAL\);\n#endif\n    if \(!cdda_active\) return;/);
  assert.match(source, /if \(!cdda_active\) return;/);
  assert.match(source, /cdda_active = 0u;/);
  assert.match(source, /cdda_resume_pending = 1u;/);
  assert.match(source, /static void VN_BANKED_CODE resume_cdda_after_cd_data_access\(void\)/);
  assert.match(source, /static void VN_BANKED_CODE finish_cd_data_read_before_vram_copy\(void\)/);
  assert.match(source, /finish_cd_data_read_before_vram_copy\(void\)\r?\n\{\r?\n    sync_cd_external_irq_after_bios_call\(\);\r?\n    resume_cdda_after_cd_data_access\(\);\r?\n    map_vn_data\(\);\r?\n\}/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 load_psg_pattern_cd\(const pce_editor_psg_asset_t \*asset\)/);
  assert.doesNotMatch(source, /static uint8_t VN_BANKED_CODE load_psg_pattern_cd\(const pce_editor_psg_asset_t \*asset\)/);
  assert.match(source, /if \(cdda_resume_defer_depth\) return;/);
  assert.match(source, /static void VN_BANKED_CODE cdda_sector_from_remaining\(const pce_editor_cdda_asset_t \*cdda\)/);
  assert.match(source, /cdda_resume_start\.lo = \(uint8_t\)\(value & 0xfful\);/);
  assert.match(source, /cdda_sector_from_remaining\(cdda_current\);[\s\S]*pce_cdb_cdda_play\(PCE_CDB_LOCATION_TYPE_SECTOR, cdda_resume_start, PCE_CDB_LOCATION_TYPE_UNTIL_END, cdda_resume_end, cdda_current->loop \? PCE_CDB_CDDA_PLAY_REPEAT : PCE_CDB_CDDA_PLAY_ONE_SHOT\);[\s\S]*cdda_active = 1u;/);
  assert.doesNotMatch(source, /cdda_sector_from_remaining\(&start/);
  assert.match(source, /static void VN_BANKED_CODE cancel_cdda_after_cd_data_conflict\(void\)/);
  assert.doesNotMatch(source, /PCE_CDB_VRAM_BYTES/);
  assert.match(source, /pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);/);
  assert.match(source, /prepare_cd_data_access\(\);[\s\S]*pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);[\s\S]*vram_copy_sliced_from_vn_data\(vram_dest, cd_transfer_scratch, chunk\);[\s\S]*resume_cdda_after_cd_data_access\(\);/);
  assert.match(source, /\(void\)pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);\r?\n        cd_transfer_wait\(\);\r?\n        finish_cd_data_read_before_vram_copy\(\);\r?\n        vram_copy_sliced_from_vn_data\(vram_dest, cd_transfer_scratch, chunk\);/);
  assert.match(source, /!ref->cd->sector_count \|\| !ref->size/);
  // RLE removed: no cd_rle decoder, no overlay dispatch, no compression branch.
  assert.doesNotMatch(source, /cd_rle_ref_to_vram/);
  assert.doesNotMatch(source, /call_overlay_cd_rle/);
  assert.doesNotMatch(source, /PCE_EDITOR_CD_COMPRESSION_RLE\) return/);
  assert.match(source, /cd_transfer_wait\(\);/);
  assert.match(source, /cd_sector_advance\(&sector\);\n    \}\n    sync_cd_external_irq_after_bios_call\(\);\n    resume_cdda_after_cd_data_access\(\);\n    return 1u;/);
  assert.doesNotMatch(source, /pce_cdb_cd_busy\(\)/);
  assert.match(source, /cd_sector_advance\(&sector\);/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 cd_bg_map_ref_to_vram\(uint16_t dest, const pce_editor_data_ref_t \*ref, uint8_t width_tiles, uint8_t height_tiles, uint16_t asset_index\)/);
  assert.match(source, /const uint8_t dest_col = \(uint8_t\)\(dest % VN_MAP_WIDTH\);/);
  assert.match(source, /row_bytes = \(uint16_t\)\(copy_width_tiles \* 2u\);/);
  assert.match(source, /pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);/);
  assert.match(source, /prepare_cd_data_access\(\);[\s\S]*pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);/);
  assert.match(source, /\(void\)pce_cdb_cd_read\(sector, PCE_CDB_ADDRESS_BYTES, \(uint16_t\)\(uintptr_t\)cd_transfer_scratch, chunk\);\r?\n        cd_transfer_wait\(\);\r?\n        finish_cd_data_read_before_vram_copy\(\);/);
  assert.match(source, /if \(dest_col == 0u && copy_width_tiles == VN_MAP_WIDTH\)[\s\S]*rows_in_chunk[\s\S]*contiguous_bytes[\s\S]*vram_copy_sliced_from_vn_data\(\(uint16_t\)\(dest \+ \(\(uint16_t\)row \* VN_MAP_WIDTH\)\), &cd_transfer_scratch\[local_offset\], contiguous_bytes\);/);
  assert.match(source, /while \(row < copy_height_tiles && \(uint16_t\)\(local_offset \+ VN_MAP_ROW_BYTES\) <= chunk\)/);
  assert.match(source, /pce_editor_vram_copy\(\(uint16_t\)\(dest \+ \(\(uint16_t\)row \* VN_MAP_WIDTH\)\), &cd_transfer_scratch\[local_offset\], row_bytes\);/);
  assert.doesNotMatch(source, /cd_rle_bg_map_ref_to_vram/);
  assert.match(source, /static uint16_t bg_map_dest_from_tile\(const pce_editor_bg_asset_t \*bg, uint16_t tile_x, uint16_t tile_y\)/);
  assert.match(source, /copy_data_ref_to_vram\(\(uint16_t\)\(bg->tile_base \* 16u\), &bg->tiles, 16u, VN_VISUAL_CACHE_KIND_BG_TILES, bg_index\);\n    map_resident_data\(\);/);
  assert.match(source, /if \(cd_bg_map_ref_to_vram\(map_dest, &bg->map, bg->width_tiles, bg->height_tiles, bg_index\)\)\n        \{\n            clear_bg_map_side_margins\(map_dest, bg->width_tiles, bg->height_tiles\);\n            return;\n        \}/);
  assert.match(source, /clear_bg_map_side_margins\(map_dest, bg->width_tiles, bg->height_tiles\);/);
  assert.doesNotMatch(source, /copy_data_ref_to_vram\(bg->map_base, &bg->map, 16u\);/);
  assert.match(source, /cd_sector_from_ref\(&sector, &ref->cd->sector\);/);
  assert.match(source, /voice->cd && voice->cd->sector_count/);
  assert.match(source, /typedef struct\s*\{[\s\S]*unsigned long data_size;[\s\S]*pce_editor_cd_sector_t cd_sector;[\s\S]*uint8_t has_cd;[\s\S]*\} vn_adpcm_voice_t;/);
  assert.match(source, /#define VN_ADPCM_BASE_SAMPLE_RATE 32000u/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 adpcm_rate_code\(unsigned int sample_rate\)/);
  assert.match(source, /actual = adpcm_code_sample_rate\(code\);/);
  assert.match(source, /if \(divider < 8u\) return computed;/);
  assert.match(source, /adpcm_legacy_divider\(sample_rate, VN_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE adpcm_play_divider\(unsigned int sample_rate, uint8_t divider\)/);
  assert.doesNotMatch(source, /static uint8_t VN_BANKED_CODE adpcm_rate_divider/);
  assert.match(source, /static vn_adpcm_voice_t adpcm_voice_snapshot;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 adpcm_voice_fits_buffer\(void\)/);
  assert.match(source, /if \(adpcm_voice_snapshot\.data_size > 65535ul\) return 0u;/);
  assert.match(source, /limit = 65536ul - \(unsigned long\)adpcm_voice_snapshot\.adpcm_address;/);
  assert.match(source, /static uint16_t VN_BANKED_CODE adpcm_voice_frame_count\(void\)/);
  assert.match(source, /frames = \(\(adpcm_voice_snapshot\.data_size \* 2ul \* VN_ADPCM_FRAME_RATE\) \+ rate - 1ul\) \/ rate;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE copy_adpcm_voice\(signed int voice_index\)/);
  assert.match(source, /map_resident_data\(\);\n    if \(\(unsigned int\)voice_index >= pce_editor_adpcm_asset_count\) return 0u;/);
  assert.match(source, /voice_data_size = voice->data_size;/);
  assert.match(source, /adpcm_voice_snapshot\.data_size = voice_data_size;/);
  assert.match(source, /adpcm_voice_snapshot\.cd_sector\.lo = voice->cd->sector\.lo;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 adpcm_playback_active\(void\)/);
  assert.match(source, /return adpcm_play_active;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE wait_adpcm_transfer_ready\(void\)/);
  assert.match(source, /while \(guard && \(pce_cdb_adpcm_status\(\) & ADPCM_BUSY\)\)/);
  assert.match(source, /return guard \? 1u : 0u;/);
  assert.match(source, /static void VN_BANKED_CODE2 restore_display_after_adpcm\(uint8_t restore_display\)/);
  assert.match(source, /restore_video_after_cdb_call\(restore_display\);/);
  assert.match(source, /static uint8_t VN_BANKED_CODE load_adpcm_voice\(signed int voice_index, uint8_t allow_stop_playback, uint8_t allow_stream_asset\)/);
  assert.match(source, /const uint8_t restore_display = \(uint8_t\)!pending_display_enable;/);
  assert.match(source, /if \(adpcm_voice_snapshot\.stream && !allow_stream_asset\) return 0u;/);
  assert.match(source, /same_loaded = \(uint8_t\)\(loaded_adpcm_valid && loaded_adpcm_index == \(uint16_t\)voice_index\);/);
  assert.match(source, /if \(!allow_stop_playback\) return same_loaded \? 1u : 0u;/);
  assert.match(source, /if \(!allow_stop_playback\) return same_loaded \? 1u : 0u;\n        pce_cdb_irq_enable\(PCE_CDB_MASK_IRQ_EXTERNAL\);/);
  assert.match(source, /pce_cdb_adpcm_stop\(\);\n        \(void\)wait_adpcm_transfer_ready\(\);/);
  assert.match(source, /loaded_adpcm_valid = 0u;\n    adpcm_play_active = 0u;\n    adpcm_play_frames_remaining = 0u;\n    pce_cdb_irq_enable\(PCE_CDB_MASK_IRQ_EXTERNAL\);\n    pce_cdb_adpcm_reset\(\);\n    if \(!wait_adpcm_transfer_ready\(\)\)\n    \{\n        map_resident_data\(\);\n        sync_cd_external_irq_after_bios_call\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;\n    \}/);
  assert.match(source, /const uint16_t sector_count = adpcm_voice_snapshot\.cd_sector_count;/);
  assert.match(source, /const uint8_t read_count = sector_count > 255u \? 255u : \(uint8_t\)sector_count;/);
  assert.match(source, /uint8_t loaded = 0u;/);
  assert.match(source, /prepare_cd_data_access\(\);\s+cd_sector_from_ref\(&sector, &adpcm_voice_snapshot\.cd_sector\);\s+loaded = \(uint8_t\)\(!pce_cdb_adpcm_read_from_cd\(sector, read_count, adpcm_voice_snapshot\.adpcm_address\)\);/);
  assert.match(source, /if \(!loaded\)\n    \{\n        map_resident_data\(\);\n        resume_cdda_after_cd_data_access\(\);\n        sync_cd_external_irq_after_bios_call\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;\n    \}/);
  assert.match(source, /if \(!wait_adpcm_transfer_ready\(\)\)[\s\S]*map_resident_data\(\);[\s\S]*resume_cdda_after_cd_data_access\(\);[\s\S]*loaded_adpcm_valid = 1u;/);
  assert.match(source, /loaded_adpcm_valid = 1u;/);
  assert.match(source, /loaded_adpcm_index = \(uint16_t\)voice_index;\n    resume_cdda_after_cd_data_access\(\);\n    sync_cd_external_irq_after_bios_call\(\);\n    restore_display_after_adpcm\(restore_display\);\n    return 1u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE stream_adpcm_voice\(signed int voice_index\)/);
  assert.match(source, /cd_sector_from_uint\(&length, \(unsigned long\)adpcm_voice_snapshot\.cd_sector_count\);/);
  assert.match(source, /divider = adpcm_play_divider\(adpcm_voice_snapshot\.sample_rate, adpcm_voice_snapshot\.divider\);/);
  assert.match(source, /if \(pce_cdb_adpcm_stream\(sector, length, divider\)\)\n    \{\n        map_resident_data\(\);\n        resume_cdda_after_cd_data_access\(\);\n        sync_cd_external_irq_after_bios_call\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;\n    \}/);
  assert.match(source, /adpcm_stream_active = 1u;/);
  assert.match(source, /adpcm_stream_looping = adpcm_voice_snapshot\.loop \? 1u : 0u;/);
  assert.match(source, /adpcm_play_active = 1u;\n    adpcm_play_frames_remaining = adpcm_voice_frame_count\(\);\n    adpcm_stream_active = 1u;/);
  assert.match(source, /adpcm_stream_index = \(uint16_t\)voice_index;\n    pad_edge_reset_pending = 1u;\n    sync_cd_external_irq_after_bios_call\(\);\n    restore_display_after_adpcm\(restore_display\);\n    return 1u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE play_adpcm_buffered_voice\(signed int voice_index, uint8_t restore_display\)/);
  assert.match(source, /if \(!adpcm_voice_fits_buffer\(\)\) return 0u;/);
  assert.match(source, /adpcm_stream_active = 0u;\n    adpcm_stream_looping = 0u;\n    if \(!load_adpcm_voice\(voice_index, 1u, 1u\)\)/);
  // stream:true voices that fit ADPCM RAM use the hardened buffered path; true
  // pce_cdb_adpcm_stream() is reserved for assets too large to buffer. (Forcing
  // true streaming for short voices caused mid-playback noise, a different
  // voice from the next CD sectors, and a CD/CPU hang.)
  assert.match(source, /if \(adpcm_voice_snapshot\.stream\)\n    \{[\s\S]*?if \(adpcm_voice_fits_buffer\(\)\)\n        \{\n            \(void\)play_adpcm_buffered_voice\(voice_index, restore_display\);\n            return;\n        \}/);
  assert.match(source, /if \(adpcm_voice_snapshot\.has_cd && adpcm_voice_snapshot\.cd_sector_count\)\n        \{\n            \(void\)stream_adpcm_voice\(voice_index\);\n            return;\n        \}\n        return;\n    \}/);
  // The buffer-fit check must come BEFORE the streaming branch, so a fitting
  // stream asset never reaches pce_cdb_adpcm_stream().
  assert.doesNotMatch(source, /if \(adpcm_voice_snapshot\.stream\)\n    \{\n        if \(adpcm_voice_snapshot\.has_cd && adpcm_voice_snapshot\.cd_sector_count\)\n        \{\n            \(void\)stream_adpcm_voice/);
  assert.match(source, /divider = adpcm_play_divider\(adpcm_voice_snapshot\.sample_rate, adpcm_voice_snapshot\.divider\);/);
  assert.match(source, /if \(pce_cdb_adpcm_play\(adpcm_voice_snapshot\.adpcm_address, \(uint16_t\)adpcm_voice_snapshot\.data_size, divider,/);
  assert.match(source, /loaded_adpcm_valid = 0u;\n        map_resident_data\(\);\n        sync_cd_external_irq_after_bios_call\(\);\n        restore_display_after_adpcm\(restore_display\);\n        return 0u;/);
  assert.match(source, /Buffered one-shot playback does not need BIOS status polling/);
  assert.match(source, /map_resident_data\(\);\n    \/\*[\s\S]*?EmulatorJS mednafen_pce core unable to deliver joypad edges afterward\.[\s\S]*?\*\/\n    adpcm_play_active = 1u;\n    adpcm_play_frames_remaining = adpcm_voice_snapshot\.loop \? 0u : adpcm_voice_frame_count\(\);\n    adpcm_stream_active = 0u;\n    adpcm_stream_looping = 0u;\n    adpcm_stream_index = \(uint16_t\)voice_index;[\s\S]*?Buffered playback does not need the System Card external IRQ[\s\S]*?sync_cd_external_irq_after_bios_call\(\);[\s\S]*?pad_edge_reset_pending = 1u;\n    restore_display_after_adpcm\(restore_display\);/);
  assert.match(source, /static void VN_BANKED_CODE stop_adpcm_voice\(void\)[\s\S]*const uint8_t restore_display = \(uint8_t\)!pending_display_enable;[\s\S]*pce_cdb_irq_enable\(PCE_CDB_MASK_IRQ_EXTERNAL\);[\s\S]*pce_cdb_adpcm_stop\(\);[\s\S]*pce_cdb_adpcm_reset\(\);[\s\S]*sync_cd_external_irq_after_bios_call\(\);[\s\S]*restore_display_after_adpcm\(restore_display\);/);
  const adpcmServiceMatch = source.match(/static void VN_BANKED_CODE2 service_adpcm_playback\(void\)\n\{[\s\S]*?\n}\n\nstatic void show_scene/);
  assert.ok(adpcmServiceMatch);
  assert.match(adpcmServiceMatch[0], /if \(!adpcm_play_active\) return;/);
  assert.match(adpcmServiceMatch[0], /adpcm_play_frames_remaining--;/);
  assert.match(adpcmServiceMatch[0], /if \(adpcm_stream_active && adpcm_stream_looping\)[\s\S]*\(void\)stream_adpcm_voice\(\(signed int\)adpcm_stream_index\);/);
  assert.match(adpcmServiceMatch[0], /Natural one-shot\/stream completion is not closed with ADPCM status/);
  assert.doesNotMatch(adpcmServiceMatch[0], /pce_cdb_adpcm_status\(\)/);
  assert.doesNotMatch(adpcmServiceMatch[0], /pce_cdb_adpcm_stop\(\);/);
  assert.doesNotMatch(adpcmServiceMatch[0], /pce_cdb_adpcm_reset\(\);/);
  assert.doesNotMatch(adpcmServiceMatch[0], /loaded_adpcm_valid = 0u;/);
  assert.match(adpcmServiceMatch[0], /adpcm_play_active = 0u;/);
  assert.match(adpcmServiceMatch[0], /sync_cd_external_irq_after_bios_call\(\);/);
  // preload_adpcm_voice removed; the message/audio handlers load the voice on demand.
  assert.doesNotMatch(source, /divider = adpcm_play_divider\(voice\);/);
  assert.match(source, /static uint8_t sprite_pattern_slots_for_size\(uint8_t cell_width, uint8_t cell_height\)/);
  assert.match(source, /if \(pattern_rows > 1u && row_pattern_slots < 2u\) row_pattern_slots = 2u;/);
  assert.match(source, /static uint16_t sprite_pattern_alignment_for_size\(uint8_t cell_width, uint8_t cell_height\)/);
  assert.match(source, /slot_pattern_base = align_sprite_pattern_base\(next_pattern_base, sprite->cell_width, sprite->cell_height\);/);
  assert.match(source, /pattern_step = \(uint8_t\)\(sprite_pattern_slots_for_size\(cell_width, cell_height\) \* 2u\);/);
  assert.doesNotMatch(source, /static uint8_t sprite_patterns_per_cell\(void\)/);
  assert.match(source, /static uint16_t sprite_pattern_units_for_ref\(const pce_editor_data_ref_t \*patterns\)/);
  assert.match(source, /return \(uint16_t\)\(\(patterns->size \+ 63u\) \/ 64u\);/);
  assert.match(source, /static inline uint8_t VN_BANKED_CODE_INLINE ensure_sprite_patterns_loaded\(uint8_t slot_index, uint16_t sprite_index, const pce_editor_data_ref_t \*patterns, uint16_t pattern_base, uint16_t pattern_units\)/);
  assert.match(source, /loaded_sprite_pattern_valid\[slot_index\][\s\S]*loaded_sprite_pattern_index\[slot_index\] == sprite_index[\s\S]*loaded_sprite_pattern_base\[slot_index\] == pattern_base[\s\S]*loaded_sprite_pattern_units\[slot_index\] == pattern_units/);
  assert.match(source, /copy_data_ref_to_vram\(\(uint16_t\)\(pattern_base \* 32u\), patterns, 16u, VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS, sprite_index\);/);
  assert.match(source, /static uint16_t g_bg_cache_key\[2\];/);
  assert.match(source, /static uint16_t g_spr_cache_key\[VN_SPRITE_SLOT_COUNT\];/);
  assert.match(source, /static uint16_t g_adpcm_cache_key;/);
  assert.match(source, /key = \(uint16_t\)\(idx \+ 1u\);/);
  assert.match(source, /const uint16_t key = \(uint16_t\)\(idx \+ 1u\);/);
  assert.match(source, /g_adpcm_cache\.data_size = \(unsigned long\)p\[PCE_EDITOR_META_ADPCM_DATA_SIZE\]/);
  assert.match(source, /g_adpcm_cache\.sample_rate = \(unsigned int\)p\[PCE_EDITOR_META_ADPCM_SAMPLE_RATE\]/);
  assert.match(source, /g_adpcm_cache\.adpcm_address = \(unsigned int\)p\[PCE_EDITOR_META_ADPCM_ADDRESS\]/);
  assert.match(source, /g_adpcm_cache\.divider = p\[PCE_EDITOR_META_ADPCM_DIVIDER\];/);
  assert.match(source, /g_adpcm_cache\.stream = p\[PCE_EDITOR_META_ADPCM_STREAM\];/);
  assert.match(source, /g_adpcm_cd\.sector\.lo = p\[PCE_EDITOR_META_ADPCM_CD\];/);
  assert.match(source, /g_adpcm_cd\.sector_count = \(unsigned int\)p\[PCE_EDITOR_META_ADPCM_CD \+ 3u\]/);
  assert.match(source, /g_adpcm_cd\.byte_size = \(unsigned int\)p\[PCE_EDITOR_META_ADPCM_CD \+ 5u\]/);
  assert.match(source, /g_adpcm_cd\.compression = p\[PCE_EDITOR_META_ADPCM_CD \+ 7u\];/);
  assert.doesNotMatch(source, /__builtin_memcpy\(&g_adpcm_cache, p, sizeof\(g_adpcm_cache\)\)/);
  assert.doesNotMatch(source, /__builtin_memcpy\(&g_adpcm_cd, p \+ PCE_EDITOR_META_ADPCM_CD/);
  assert.match(source, /unsigned long voice_data_size;/);
  assert.match(source, /voice_data_size = voice->data_size;/);
  assert.match(source, /voice_sample_rate = voice->sample_rate;/);
  assert.match(source, /adpcm_voice_snapshot\.data_size = voice_data_size;/);
  assert.match(source, /adpcm_voice_snapshot\.sample_rate = voice_sample_rate;/);
  assert.doesNotMatch(source, /g_(?:bg|spr|adpcm)_cache_idx[\s\S]*?-1/);
  // preload_scan_boundary / preload_scene_assets were removed (on-demand loading).
  assert.match(source, /static uint8_t vn_variable_lo\[PCE_VN_VARIABLE_STORAGE_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /static uint8_t vn_variable_hi\[PCE_VN_VARIABLE_STORAGE_COUNT\] __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(source, /const uint16_t value = \(uint16_t\)\(int16_t\)pce_vn_variable_initial_values\[i\];[\s\S]*vn_variable_lo\[i\] = \(uint8_t\)\(value & 0xffu\);[\s\S]*vn_variable_hi\[i\] = \(uint8_t\)\(value >> 8\);/);
  assert.match(source, /static signed int VN_BANKED_CODE2 variable_value\(signed int variable_index\)[\s\S]*value = \(uint16_t\)vn_variable_lo\[index\] \| \(\(uint16_t\)vn_variable_hi\[index\] << 8\);/);
  assert.match(source, /static void VN_BANKED_CODE2 set_variable_value\(signed int variable_index, signed int value\)[\s\S]*vn_variable_lo\[index\] = \(uint8_t\)\(raw & 0xffu\);[\s\S]*vn_variable_hi\[index\] = \(uint8_t\)\(raw >> 8\);/);
  assert.doesNotMatch(source, /static signed int vn_variables\[PCE_VN_VARIABLE_STORAGE_COUNT\];/);
  assert.match(source, /static signed int command_value_arg\(const pce_vn_command_t \*command\)/);
  assert.match(source, /static uint16_t ui_text_color;\n/);
  assert.match(source, /static uint16_t sync_input_target;\n/);
  assert.match(source, /static uint16_t async_input_target;\n/);
  assert.match(source, /ui_text_color = PCE_VN_MESSAGE_COLOR_NONE;[\s\S]*sync_input_target = PCE_VN_NO_COMMAND;[\s\S]*async_input_target = PCE_VN_NO_COMMAND;/);
  assert.match(source, /static signed int random_range_value\(signed int min, signed int max\)/);
  assert.match(source, /static uint8_t compare_values\(signed int left, uint8_t operator_id, signed int right\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 jump_to_command\(uint16_t command_offset\)/);
  assert.match(source, /if \(!load_scene_pack_into_cache\(current_scene, &active_scene_pack\)\) return 0u;/);
  assert.match(source, /if \(command_offset >= scene_pack_command_count\(&active_scene_pack\)\) return 0u;/);
  assert.match(source, /static void VN_BANKED_CODE2 draw_choice_options\(void\)/);
  assert.match(source, /vn_choice_ref_t \*choice = VN_CHOICE_SCRATCH;/);
  assert.match(source, /scene_pack_read_choice\(&active_scene_pack, \(uint8_t\)active_choice_index, choice\)/);
  assert.match(source, /scene_pack_read_choice_option\(&active_scene_pack, choice, row, option\)/);
  assert.match(source, /PCE_VN_CHOICE_CURSOR_GLYPH/);
  assert.match(source, /static uint8_t handle_choice_input\(uint8_t pressed\)/);
  assert.match(source, /set_variable_value\(choice->variable_index, option->value\);/);
  assert.match(source, /pce_cdb_cdda_pause\(\)/);
  assert.match(source, /pce_cdb_adpcm_stop\(\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 execute_control_command\(const pce_vn_command_t \*command\)/);
  assert.match(source, /return execute_control_command\(command\);/);
  const audioCommandMatch = executeCommandSource.match(/else if \(command->type == PCE_VN_COMMAND_AUDIO\)[\s\S]*?\n    \}\n    else if \(command->type == PCE_VN_COMMAND_MESSAGE\)/);
  assert.ok(audioCommandMatch);
  assert.match(audioCommandMatch[0], /else play_adpcm_voice\(command->asset_index\);/);
  assert.doesNotMatch(audioCommandMatch[0], /VN_EXEC_WAIT|VN_EXEC_RESTART|return/);
  assert.match(source, /static uint8_t VN_BANKED_CODE run_commands_until_wait\(void\)/);
  assert.match(source, /command_count = scene_pack_command_count\(&active_scene_pack\);/);
  assert.match(source, /scene_pack_read_command\(&active_scene_pack, current_command, command\)/);
  assert.match(source, /static signed int current_scene_next_scene\(void\)/);
  assert.match(source, /pack = pce_vn_scene_packs\[current_scene\];/);
  assert.doesNotMatch(source, /PCE_VN_COMMAND_PRELOAD/);
  assert.doesNotMatch(executeCommandSource, /PCE_VN_COMMAND_PRELOAD/);
  assert.match(source, /PCE_VN_COMMAND_CHOICE/);
  assert.match(source, /PCE_VN_COMMAND_VARIABLE/);
  assert.match(source, /PCE_VN_COMMAND_IF/);
  assert.match(source, /PCE_VN_COMMAND_SWITCH/);
  assert.match(source, /PCE_VN_COMMAND_LABEL/);
  assert.match(source, /PCE_VN_COMMAND_GOTO/);
  assert.match(source, /PCE_VN_COMMAND_JUMP/);
  assert.match(source, /PCE_VN_COMMAND_WAIT/);
  assert.match(source, /PCE_VN_COMMAND_EFFECT/);
  assert.match(source, /#define VN_COMMAND_STEP_GUARD 1024u/);
  assert.match(source, /wait_frames_remaining = 1u;\n                return 1u;/);
  assert.match(source, /show_character_sprite_frame/);
  assert.match(source, /sprite_slots\[slot\]\.flags = command->flags;/);
  assert.match(source, /sprite_slots\[slot\]\.x = command->x;/);
  assert.match(source, /sprite_slots\[slot\]\.y = command->y;/);
  assert.doesNotMatch(source, /animate_sprite_slot/);
  assert.doesNotMatch(source, /for \(step = 0u; step < frames; step\+\+\)/);
  assert.match(source, /PCE_VN_EFFECT_SHAKE/);
  assert.match(source, /shake_screen\(command->arg0, command->arg1\);/);
  assert.match(source, /PCE_VN_EFFECT_FLASH/);
  assert.match(source, /flash_screen_color\(command->x, command->arg0\);/);
  assert.match(source, /fade_current_screen_to_color\(command->x, command->arg0\);/);
  assert.match(executeCommandSource, /PCE_VN_EFFECT_BLANK[\s\S]*clear_screen_map\(\);[\s\S]*preloaded_bg_valid = 0u;[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(source, /if \(!restore_window_display && !pending_display_enable\) delay_frame\(\);/);
  assert.match(source, /display_enable\(\);\n        pending_display_enable = 0u;\n        delay_frame\(\);/);
  assert.doesNotMatch(source, /current_message/);
  assert.doesNotMatch(source, /pending_cdda_track/);
  assert.doesNotMatch(source, /show_current_message\(\);\n    for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);\n    if \(pending_sprite_refresh\)/);
  assert.doesNotMatch(source, /if \(pending_sprite_refresh\)\n            \{\n                for \(i = 0; i < 4u; i\+\+\) delay_frame\(\);/);
  assert.doesNotMatch(source, /PCE_CDB_SPR_/);
  assert.doesNotMatch(source, /pce_cdb_vdc_sprite_table_put\(\);/);
  assert.match(source, /#define VN_SPRITE_HIDDEN_Y 0x00f0u/);
  assert.match(source, /sprite_shadow\[i\]\.y = VN_SPRITE_HIDDEN_Y;/);
  assert.match(source, /pce_vdc_sprite_set_table_start\(VN_SATB_ADDR\);/);
  assert.match(source, /static void VN_RESIDENT_CODE upload_sprite_table[\s\S]*vn_wait_next_vblank\(\);[\s\S]*irq = vn_vdc_irq_lock\(\);[\s\S]*pce_editor_vram_copy\(VN_SATB_ADDR, \(const uint8_t \*\)sprite_shadow, \(uint16_t\)\(64u \* sizeof\(vdc_sprite_t\)\)\);[\s\S]*pce_vdc_poke\(VDC_REG_SATB_START, VN_SATB_ADDR\);/);
  assert.match(source, /static void VN_RESIDENT_CODE upload_sprite_pattern_words[\s\S]*vn_wait_next_vblank\(\);[\s\S]*irq = vn_vdc_irq_lock\(\);[\s\S]*vn_vdc_set_copy_word\(\);[\s\S]*\*IO_VDC_DATA = sprite_shadow\[entry_index\]\.pattern;/);
  assert.doesNotMatch(source, /pce_vdc_set_copy_word\(\);/);
  assert.match(source, /\*IO_VDC_DATA = sprite_shadow\[entry_index\]\.pattern;\n        \*IO_VDC_DATA = sprite_shadow\[entry_index\]\.attr;/);
  assert.match(source, /\*IO_VDC_DATA = \(uint16_t\)\(VN_SATB_ADDR \+ \(63u \* 4u\) \+ 3u\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC\);/);
  assert.match(source, /pce_vdc_poke\(VDC_REG_SATB_START, VN_SATB_ADDR\);/);
  assert.doesNotMatch(source, /PCE_CDB_SPRITE\[i\] = sprite_shadow\[i\];/);
  assert.match(source, /pce_sector_t start = \{0\};/);
  assert.match(source, /pce_sector_t end = \{0\};/);
  assert.match(source, /static void play_cdda_track\(const pce_editor_cdda_asset_t \*cdda\)/);
  assert.match(source, /const uint8_t mode = loop \? PCE_CDB_CDDA_PLAY_REPEAT : PCE_CDB_CDDA_PLAY_ONE_SHOT;/);
  assert.match(source, /const uint8_t restore_display_after_cdda = \(uint8_t\)!pending_display_enable;/);
  assert.match(source, /static void service_cdda_playback\(void\);/);
  assert.match(source, /service_adpcm_playback\(\);\n    vn_wait_next_vblank\(\);\n    service_cdda_playback\(\);/);
  assert.doesNotMatch(source, /pce_cdb_wait_vblank\(\);/);
  assert.match(source, /uint8_t end_type = PCE_CDB_LOCATION_TYPE_UNTIL_END;/);
  assert.match(source, /static uint8_t cdda_has_frame_limit = 0;/);
  assert.match(source, /static uint8_t cdda_looping = 0;/);
  assert.match(source, /static uint8_t cdda_track = 0;/);
  assert.match(source, /static uint16_t cdda_frames_remaining = 0;/);
  assert.match(source, /static const pce_editor_cdda_asset_t \*cdda_current = \(const pce_editor_cdda_asset_t \*\)0;/);
  assert.match(source, /static uint8_t pad_edge_reset_pending = 0;/);
  assert.match(source, /if \(cdda_active\)\n    \{\n        \(void\)pce_cdb_cdda_pause\(\);\n        cdda_active = 0u;\n    \}/);
  assert.match(source, /start\.lo = cdda->start_sector\.lo;\n    start\.md = cdda->start_sector\.md;\n    start\.hi = cdda->start_sector\.hi;/);
  assert.match(source, /cdda_has_frame_limit = cdda->play_frames \? 1u : 0u;/);
  assert.match(source, /cdda_frames_remaining = cdda->play_frames;/);
  assert.match(source, /\(void\)pce_cdb_cdda_play\(PCE_CDB_LOCATION_TYPE_SECTOR, start, end_type, end, mode\);\n    cdda_active = 1u;/);
  assert.match(source, /adpcm_play_frames_remaining = adpcm_voice_snapshot\.loop \? 0u : adpcm_voice_frame_count\(\);[\s\S]*pad_edge_reset_pending = 1u;/);
  assert.match(source, /adpcm_play_frames_remaining = adpcm_voice_frame_count\(\);[\s\S]*adpcm_stream_index = \(uint16_t\)voice_index;\n    pad_edge_reset_pending = 1u;/);
  assert.match(source, /last_pad = read_pad_raw\(\);\n#if defined\(__PCE_CD__\)\n    if \(pad_edge_reset_pending\)[\s\S]*pad_edge_reset_pending = 0u;/);
  assert.match(source, /pad = read_pad_raw\(\);\n#if defined\(__PCE_CD__\)\n        if \(pad_edge_reset_pending\)\n        \{\n            last_pad = pad;\n            pad_edge_reset_pending = 0u;\n        \}/);
  assert.doesNotMatch(source, /last_pad = 0u;/);
  assert.match(source, /static void service_cdda_playback\(void\)/);
  assert.match(source, /if \(!cdda_active \|\| !cdda_has_frame_limit \|\| !cdda_current\) return;/);
  assert.match(source, /if \(cdda_frames_remaining\) cdda_frames_remaining--;/);
  assert.match(source, /if \(cdda_frames_remaining\) return;/);
  assert.match(source, /if \(cdda_looping\)\n        \{\n            cdda_frames_remaining = cdda_current->play_frames;/);
  assert.doesNotMatch(source, /play_cdda_track\(cdda_current\);/);
  assert.match(source, /restore_video_after_cdb_call\(restore_display_after_cdda\);/);
  assert.match(source, /prepare_cd_data_access\(\);[\s\S]*pce_cdb_adpcm_stream\(sector, length, divider\)[\s\S]*cancel_cdda_after_cd_data_conflict\(\);/);
  assert.doesNotMatch(source, /pce_cdb_cdda_read_subcode_q/);
  assert.doesNotMatch(source, /pce_cdb_cd_scan\(\)/);
  assert.doesNotMatch(source, /PCE_CDB_LOCATION_TYPE_TRACK, end/);
  assert.match(source, /play_cdda_track\(cdda\);/);
  assert.match(source, /pce_ram_bank129_map\(\);\n    pce_ram_bank130_map\(\);\n    pce_vdc_set_resolution\(256, 224, VCE_COLORBURST_ON\);/);
  assert.match(source, /set_vdc_control\(VN_VDC_BLANK_CONTROL\);\n    pce_vdc_sprite_set_table_start\(VN_SATB_ADDR\);\n    pce_irq_disable\(IRQ_VDC\);\n    pce_cdb_irq_disable\(\(uint8_t\)\(PCE_CDB_MASK_IRQ_EXTERNAL \| PCE_CDB_MASK_VBLANK \| PCE_CDB_MASK_VBLANK_NO_BIOS\)\);/);
  assert.match(source, /begin_cdda_deferred_resume\(\);[\s\S]*if \(!load_scene_pack_into_cache\(scene_index, &active_scene_pack\)\)[\s\S]*end_cdda_deferred_resume\(\);[\s\S]*return;/);
  assert.match(source, /REQUEST_SPRITE_REFRESH_FULL\(\);\n    \/\* Assets load on demand[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(source, /init_runtime_state\(\);\n    init_video\(\);\n    map_vn_data\(\);\n    start_scene = pce_vn_start_scene;\n    show_scene\(start_scene\);\n    advance_story\(\);/);
  assert.doesNotMatch(source, /show_scene\(start_scene\);\n    preload_scene_assets\(\(signed int\)start_scene\);/);
  assert.doesNotMatch(source, /preload_scene_assets\(\(signed int\)current_scene/);
  assert.doesNotMatch(source, /PCE_CDB_CDDA_PLAY_NOT_BUSY/);
});

test('PCE VN runtime cache clear only invalidates non-destructive cache flags', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'),
    'utf-8',
  ).replace(/\r\n/g, '\n');
  const helperStart = source.indexOf('static void VN_VISUAL_CACHE_CODE load_bg_cache_asset_impl(signed int bg_index, uint8_t tile_x, uint8_t tile_y)\n{');
  const bgWrapperStart = source.indexOf('static void VN_BANKED_CODE load_bg_cache_asset(signed int bg_index, uint8_t tile_x, uint8_t tile_y)', helperStart);
  const spriteWrapperStart = source.indexOf('static void VN_BANKED_CODE load_sprite_pattern_cache_asset(signed int sprite_index, uint8_t slot_index)', bgWrapperStart);
  const clearHelperStart = source.indexOf('static void VN_BANKED_CODE clear_runtime_cache(uint8_t scope)');
  const executeStart = source.indexOf('static uint8_t VN_BANKED_CODE execute_command', helperStart);
  const executeEnd = source.indexOf('static uint8_t VN_BANKED_CODE run_commands_until_wait', executeStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(bgWrapperStart, -1);
  assert.notEqual(spriteWrapperStart, -1);
  assert.notEqual(clearHelperStart, -1);
  assert.notEqual(executeStart, -1);
  assert.notEqual(executeEnd, -1);
  const helperSource = source.slice(helperStart, executeStart);
  const bgWrapperSource = source.slice(bgWrapperStart, spriteWrapperStart);
  const spriteWrapperSource = source.slice(spriteWrapperStart, clearHelperStart);
  const clearHelperSource = source.slice(clearHelperStart, executeStart);
  const executeCommandSource = source.slice(executeStart, executeEnd);

  assert.match(source, /#define VN_ENABLE_VISUAL_PAYLOAD_CACHE 1/);
  assert.match(source, /#if VN_ENABLE_VISUAL_PAYLOAD_CACHE[\s\S]*PCE_RAM_BANK_AT\(121, 4\);[\s\S]*#define VN_VISUAL_CACHE_FIRST_BANK 112u/);
  assert.match(source, /#define VN_MAP_VISUAL_CACHE_CODE\(\) pce_ram_bank121_map\(\)/);
  assert.match(source, /#define VN_VISUAL_VRAM_COPY_SLICE_BYTES 64u/);
  assert.match(source, /#define VN_VISUAL_VRAM_COPY_FAST_SLICE_BYTES VN_CD_SECTOR_BYTES/);
  assert.match(source, /static void VN_BANKED_CODE vram_copy_sliced_from_vn_data\(uint16_t dest, const uint8_t \*source, uint16_t length\)[\s\S]*const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES\(\);[\s\S]*pce_editor_vram_copy\(vram_dest, &source\[offset\], chunk\);[\s\S]*service_psg_during_blocking_work\(\);[\s\S]*map_vn_data\(\);[\s\S]*VN_MAP_BANK130_FOR_CODE\(\);/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE visual_cache_ref_to_vram_impl\(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t \*ref\)[\s\S]*visual_cache_find_impl\(kind, asset_index, part\)[\s\S]*visual_cache_page_to_vram_impl\(vram_dest, slot, page_offset, chunk\)[\s\S]*return 1u;/);
  assert.match(source, /static uint8_t VN_VISUAL_CACHE_CODE visual_cache_bg_map_to_vram_impl\(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t \*ref, uint8_t width_tiles, uint8_t height_tiles\)[\s\S]*visual_cache_copy_span_to_vram_impl[\s\S]*VN_VISUAL_CACHE_KIND_BG_MAP[\s\S]*return 1u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE visual_cache_ref_to_vram\(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t \*ref\)[\s\S]*if \(!vn_visual_cache_code_loaded\) return 0u;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_REF_TO_VRAM\)/);
  assert.match(source, /static uint8_t VN_BANKED_CODE2 visual_cache_bg_map_to_vram\(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t \*ref, uint8_t width_tiles, uint8_t height_tiles\)[\s\S]*if \(!vn_visual_cache_code_loaded\) return 0u;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_BG_MAP_TO_VRAM\)/);
  assert.match(source, /static void VN_BANKED_CODE2 visual_cache_invalidate\(uint8_t scope\)[\s\S]*if \(!vn_visual_cache_code_loaded\) return;[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_INVALIDATE\)/);
  assert.doesNotMatch(source, /#define visual_cache_bg_map_to_vram\(dest, asset_index, ref, width_tiles, height_tiles\) \(0u\)/);
  assert.match(helperSource, /load_bg_cache_asset_impl[\s\S]*SNAPSHOT_DATA_REF\(bg_tiles, bg->tiles\);[\s\S]*SNAPSHOT_DATA_REF\(bg_map, bg->map\);[\s\S]*VN_VISUAL_CACHE_KIND_BG_TILES[\s\S]*VN_VISUAL_CACHE_KIND_BG_MAP[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.doesNotMatch(helperSource, /upload_bg_graphics|ensure_sprite_patterns_loaded/);
  assert.doesNotMatch(helperSource, /preloaded_bg_valid = 1u/);
  assert.match(bgWrapperSource, /load_visual_cache_code\(\);[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_LOAD_BG\);/);
  assert.match(spriteWrapperSource, /load_visual_cache_code\(\);[\s\S]*visual_cache_call\(VN_VISUAL_CACHE_OP_LOAD_SPRITE\);/);
  assert.doesNotMatch(bgWrapperSource, /load_overlay_code\(\)|upload_bg_graphics|ensure_sprite_patterns_loaded/);
  assert.doesNotMatch(spriteWrapperSource, /load_overlay_code\(\)|upload_bg_graphics|ensure_sprite_patterns_loaded|sprite_slots\[/);
  assert.match(source, /static void VN_BANKED_CODE2 load_runtime_cache\(uint8_t scope, signed int asset_index, uint8_t slot, uint8_t x, uint8_t y\)/);
  assert.match(source, /static inline uint8_t VN_BANKED_CODE_INLINE ensure_sprite_patterns_loaded/);
  assert.match(helperSource, /load_sprite_pattern_cache_asset_impl[\s\S]*visual_cache_preload_ref_impl\(VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(source, /static uint8_t VN_BANKED_CODE cd_data_ref_to_vram[\s\S]*vram_copy_sliced_from_vn_data\(vram_dest, cd_transfer_scratch, chunk\);/);
  assert.match(source, /static void copy_data_ref_to_vram[\s\S]*visual_cache_ref_to_vram\(dest, cache_kind, cache_asset_index, ref\)[\s\S]*if \(cd_data_ref_to_vram\(dest, ref\)\) return;/);
  assert.match(source, /upload_bg_graphics\(next_bg, bg_map_dest_from_tile\(next_bg, next_x, next_y\), \(uint16_t\)bg_index\);/);
  assert.match(source, /copy_data_ref_to_vram\(\(uint16_t\)\(bg->tile_base \* 16u\), &bg->tiles, 16u, VN_VISUAL_CACHE_KIND_BG_TILES, bg_index\);/);
  assert.match(source, /cd_bg_map_ref_to_vram\(map_dest, &bg->map, bg->width_tiles, bg->height_tiles, bg_index\)/);
  assert.match(source, /static uint8_t vn_visual_cache_code_loaded = 0;/);
  assert.match(source, /static void load_visual_cache_code\(void\)[\s\S]*if \(vn_visual_cache_code_loaded\) return;[\s\S]*pce_ram_bank121_map\(\);[\s\S]*pce_cdb_cd_read[\s\S]*vn_visual_cache_code_loaded = 1u;/);
  assert.match(helperSource, /load_adpcm_cache_asset[\s\S]*if \(adpcm_playback_active\(\)\) return;[\s\S]*load_adpcm_voice\(voice_index, 1u, 0u\);/);
  assert.match(helperSource, /load_runtime_cache[\s\S]*scope == PCE_VN_CACHE_SCOPE_BG[\s\S]*load_bg_cache_asset\(asset_index, x, y\);[\s\S]*scope == PCE_VN_CACHE_SCOPE_SPRITE[\s\S]*load_sprite_pattern_cache_asset\(asset_index, slot\);[\s\S]*scope == PCE_VN_CACHE_SCOPE_ADPCM[\s\S]*load_adpcm_cache_asset\(asset_index\);/);
  assert.match(clearHelperSource, /if \(scope > PCE_VN_CACHE_SCOPE_ALL\) scope = PCE_VN_CACHE_SCOPE_VISUAL;/);
  assert.match(clearHelperSource, /scope == PCE_VN_CACHE_SCOPE_VISUAL[\s\S]*scope == PCE_VN_CACHE_SCOPE_BG[\s\S]*preloaded_bg_valid = 0u;[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(clearHelperSource, /scope == PCE_VN_CACHE_SCOPE_SPRITE[\s\S]*for \(i = 0u; i < VN_SPRITE_SLOT_COUNT; i\+\+\)[\s\S]*loaded_sprite_pattern_valid\[i\] = 0u;[\s\S]*preloaded_scene_visual_valid = 0u;/);
  assert.match(clearHelperSource, /visual_cache_invalidate\(scope\);/);
  assert.match(clearHelperSource, /scope == PCE_VN_CACHE_SCOPE_ADPCM[\s\S]*loaded_adpcm_valid = 0u;/);
  assert.match(clearHelperSource, /scope == PCE_VN_CACHE_SCOPE_ALL[\s\S]*message_glyph_cache_valid = 0u;/);
  assert.doesNotMatch(clearHelperSource, /pce_cdb_adpcm_stop|pce_cdb_adpcm_reset|stop_adpcm_voice|display_disable|clear_screen_map|clear_sprites|sprite_slots\[|pce_editor_vram_copy|upload_sprite_table/);
  assert.match(executeCommandSource, /command->type == PCE_VN_COMMAND_CACHE[\s\S]*command->flags == PCE_VN_CACHE_ACTION_CLEAR[\s\S]*clear_runtime_cache\(command->arg0\);/);
  assert.match(executeCommandSource, /command->flags == PCE_VN_CACHE_ACTION_LOAD[\s\S]*VN_MAP_BANK130_FOR_CODE\(\);[\s\S]*load_runtime_cache\(command->arg0, command->asset_index, command->slot, command->x, command->y\);/);
  assert.doesNotMatch(executeCommandSource, /PCE_VN_COMMAND_PRELOAD/);
});

test('PCE build system regenerates visual novel sources from saved scenes', async () => {
  const projectDir = path.join(makeTempDir('pce-vn-build-project-'), 'project');
  fs.cpSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd'), projectDir, { recursive: true });
  const runtimePath = path.join(projectDir, 'src', 'pce_vn_runtime.c');
  const currentRuntime = fs.readFileSync(runtimePath, 'utf-8');
  const changedRuntime = currentRuntime.replace('adpcm_stream_active = 1u;', 'adpcm_stream_active = 0u;');
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
  assert.equal(result.commandInfo.targetMedia, 'cd');
  assert.ok(result.commandInfo.mkcdArgs.some((arg) => /pce_cd_data_padding\.bin$/.test(arg)));
  assert.equal(result.generated.visualNovel.messageCount, 1);
  assert.deepEqual(result.generated.visualNovel.scenePackPaths, ['assets/generated/vn/scenes/000_opening.bin']);
  const source = fs.readFileSync(path.join(projectDir, 'src', 'generated', 'vn.c'), 'utf-8');
  assert.match(source, /const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs\[\]/);
  // Font data occupies CD sector 64; overlay reserves sectors 65-66, visual
  // helper code reserves sectors 67-70, and the scene pack follows at sector 71.
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_font_data = \{ \{ 64u, 0u, 0u \}, \d+u, \d+u \};/);
  assert.match(source, /const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_visual_code_data = \{ \{ 67u, 0u, 0u \}, 4u, 8192u \};/);
  assert.match(source, /\{ \{ 71u, 0u, 0u \}, 1u, \d+u, -1 \}/);
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'font.bin')));
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'visual_code.bin')));
  assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'generated', 'vn', 'scenes', '000_opening.bin')));
  const syncedRuntime = fs.readFileSync(runtimePath, 'utf-8');
  assert.match(syncedRuntime, /adpcm_stream_active = 1u;/);
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

test('PCE sample builder start hook leaves VN generation to the build system', () => {
  const projectDir = makeTempDir('pce-sample-builder-hook-');
  writeJson(path.join(projectDir, 'project.json'), {
    targetMedia: 'cd',
    toolchain: 'llvm-mos',
    pluginSettings: { 'pce-sample-builder': { sample: 'visual-novel-cd' } },
  });
  writeJson(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), {
    version: 2,
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', text: 'A' }] }],
  });
  delete require.cache[require.resolve('../plugins/pce-sample-builder')];
  const builder = require('../plugins/pce-sample-builder');
  const logs = [];

  const result = builder.onBuildStart({ projectDir }, {
    projectDir,
    logger: { info: (line) => logs.push(line) },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(logs, [`PCE build start: ${projectDir}`]);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'pce_vn_runtime.c')), false);
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
