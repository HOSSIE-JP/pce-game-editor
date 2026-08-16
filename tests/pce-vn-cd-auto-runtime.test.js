const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CD_RUNTIME_DIR = path.join(
  __dirname,
  '..',
  'template',
  'template_pce_vn_cd',
  'src'
);

function readRuntimeFile(name) {
  return fs.readFileSync(path.join(CD_RUNTIME_DIR, name), 'utf8').replace(/\r\n/g, '\n');
}

function readRuntimeFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`runtime function marker not found: ${marker}`);
  const bodyStart = source.indexOf('{', start);
  if (bodyStart < 0) throw new Error(`runtime function body not found: ${marker}`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`runtime function body was not closed: ${marker}`);
}

test('CD VN runtime preserves 16-bit metadata sector offsets and restores bank132 mapping', () => {
  const cache = readRuntimeFile('vn_cache_core.c');
  const cdda = readRuntimeFile('vn_port_cdda.c');
  const readerStart = cache.indexOf('static void VN_RESIDENT_CODE vn_read_meta_sector');
  const readerEnd = cache.indexOf('static pce_editor_bg_asset_t g_bg_cache', readerStart);

  assert.ok(readerStart >= 0 && readerEnd > readerStart);
  const reader = cache.slice(readerStart, readerEnd);

  assert.match(
    reader,
    /vn_read_meta_sector\(const pce_editor_cd_sector_t \*region_sector, uint16_t sector_off\)/,
  );
  assert.match(
    reader,
    /cd_sector_from_ref\(&sector, region_sector\);[\s\S]*while \(sector_off != 0u\)[\s\S]*cd_sector_advance\(&sector\);[\s\S]*sector_off--;[\s\S]*pce_cdb_cd_read\(/,
  );
  assert.match(
    reader,
    /pce_cdb_cd_read\([\s\S]*cd_transfer_wait\(\);[\s\S]*sync_cd_external_irq_after_bios_call\(\);[\s\S]*resume_cdda_after_cd_data_access\(\);[\s\S]*map_vn_data\(\);\s*\}/,
  );
  assert.match(
    cache,
    /vn_read_meta_sector\(&pce_editor_bg_meta\.sector, \(uint16_t\)\(idx \/ VN_META_BG_PER_SECTOR\)\)/,
  );
  assert.match(
    cache,
    /vn_read_meta_sector\(&pce_editor_sprite_meta\.sector, \(uint16_t\)\(idx \/ VN_META_SPRITE_PER_SECTOR\)\)/,
  );
  assert.match(
    cache,
    /vn_read_meta_sector\(&pce_editor_adpcm_meta\.sector, \(uint16_t\)\(idx \/ VN_META_ADPCM_PER_SECTOR\)\)/,
  );
  assert.match(
    cdda,
    /vn_read_meta_sector\(&pce_editor_cdda_meta\.sector, \(uint16_t\)\(idx \/ VN_META_CDDA_PER_SECTOR\)\)/,
  );
  assert.doesNotMatch(cache, /vn_read_meta_sector\([^\n]*uint8_t sector_off/);
  assert.doesNotMatch(cache, /vn_read_meta_sector\([^\n]*\(uint8_t\)\(idx \/ VN_META_/);
  assert.doesNotMatch(cdda, /vn_read_meta_sector\([^\n]*\(uint8_t\)\(idx \/ VN_META_/);
});

test('CD VN runtime streams fixed System Card PSG metadata records instead of resident arrays', () => {
  const psg = readRuntimeFile('vn_psg_core.c');
  const header = readRuntimeFile(path.join('generated', 'vn.h'));
  const snapshot = readRuntimeFunction(
    psg,
    'static uint8_t VN_BANKED_CODE2 vn_system_psg_package_snapshot',
  );

  assert.match(psg, /#define VN_SYSTEM_PSG_META_SLOT_BYTES 16u/);
  assert.match(psg, /#define VN_SYSTEM_PSG_META_PER_SECTOR 128u/);
  assert.match(
    snapshot,
    /vn_read_meta_sector\([\s\S]*&pce_vn_system_psg_meta\.sector,[\s\S]*\(uint16_t\)\(index \/ VN_SYSTEM_PSG_META_PER_SECTOR\)/,
  );
  assert.match(
    snapshot,
    /record = &cd_transfer_scratch\[[\s\S]*index % VN_SYSTEM_PSG_META_PER_SECTOR[\s\S]*VN_SYSTEM_PSG_META_SLOT_BYTES/,
  );
  assert.match(snapshot, /package->data\.sector\.lo = record\[VN_SYSTEM_PSG_META_SECTOR\]/);
  assert.match(snapshot, /package->data\.sector\.md = record\[VN_SYSTEM_PSG_META_SECTOR \+ 1u\]/);
  assert.match(snapshot, /package->data\.sector\.hi = record\[VN_SYSTEM_PSG_META_SECTOR \+ 2u\]/);
  assert.match(snapshot, /VN_SYSTEM_PSG_META_SECTOR_COUNT \+ 1u\] << 8/);
  assert.match(snapshot, /VN_SYSTEM_PSG_META_BYTE_SIZE \+ 1u\] << 8/);
  assert.match(snapshot, /package->bus = record\[VN_SYSTEM_PSG_META_BUS\]/);
  assert.match(snapshot, /package->channel = record\[VN_SYSTEM_PSG_META_CHANNEL\]/);
  assert.doesNotMatch(psg, /pce_vn_system_psg_packages\s*\[/);
  assert.match(header, /extern const pce_editor_meta_region_t pce_vn_system_psg_meta;/);
  assert.doesNotMatch(header, /extern const pce_vn_system_psg_package_t pce_vn_system_psg_packages\[\];/);
});

test('CD VN scene cache readers keep the singleton cache as direct-page symbols', () => {
  const scene = readRuntimeFile('vn_port_scene.c');
  const markers = [
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_has_range',
    'static uint8_t scene_pack_u8',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_copy',
    'static uint8_t scene_pack_is_valid',
  ];

  for (const marker of markers) {
    const body = readRuntimeFunction(scene, marker);
    const cdStart = body.indexOf('#if defined(__PCE_CD__)');
    const cdEnd = body.indexOf('#else', cdStart);
    const cdBranch = body.slice(cdStart, cdEnd);
    assert.ok(cdStart >= 0 && cdEnd > cdStart, `${marker} must have an explicit CD branch`);
    assert.match(cdBranch, /active_scene_pack\.(?:valid|base|size)/);
    assert.doesNotMatch(cdBranch, /cache->/);
  }

  const load = readRuntimeFunction(
    scene,
    'static uint8_t VN_BANKED_CODE2 load_scene_pack_into_cache',
  );
  const loadCdStart = load.indexOf('#if defined(__PCE_CD__)');
  const loadCdEnd = load.indexOf('#else', loadCdStart);
  const loadCdBranch = load.slice(loadCdStart, loadCdEnd);
  assert.match(loadCdBranch, /\(void\)cache;/);
  assert.match(loadCdBranch, /active_scene_pack\.valid/);
  assert.match(loadCdBranch, /active_scene_pack\.base/);
  assert.match(loadCdBranch, /active_scene_pack\.size/);
  assert.match(loadCdBranch, /active_scene_pack\.scene_index/);
  assert.doesNotMatch(loadCdBranch, /cache->/);
  assert.match(
    scene,
    /llvm-mos direct-page addresses[\s\S]*are not valid when materialized as a generic 16-bit pointer/,
  );
});

test('CD VN runtime clamps reserved variables and snapshots MSG_SPEED per message', () => {
  const state = readRuntimeFile('vn_engine_state.c');
  const scene = readRuntimeFile('vn_port_scene.c');
  const message = readRuntimeFile('vn_msg_core.c');
  const main = readRuntimeFile('vn_main.c');
  const startMessage = readRuntimeFunction(message, 'static void start_message');
  const voiceStartOffset = startMessage.indexOf('if (play_adpcm_message_voice(message->voice_index))');
  const windowPrepOffset = startMessage.indexOf('restore_window_display = begin_message_window_vram_update()');

  assert.ok(voiceStartOffset >= 0);
  assert.ok(windowPrepOffset > voiceStartOffset);

  assert.match(state, /#define VN_MESSAGE_VOICE_NONE 0u/);
  assert.match(state, /#define VN_MESSAGE_VOICE_ONESHOT 1u/);
  assert.match(state, /#define VN_MESSAGE_VOICE_LOOP 2u/);
  assert.match(
    scene,
    /set_variable_value_impl[\s\S]*variable_index == \(signed int\)PCE_VN_VARIABLE_AUTO_ENABLE_INDEX[\s\S]*value < 0[\s\S]*value > 1[\s\S]*vn_auto_enable = \(uint8_t\)value/
  );
  assert.match(
    scene,
    /variable_index == \(signed int\)PCE_VN_VARIABLE_MSG_SPEED_INDEX[\s\S]*value < 0[\s\S]*value > 6[\s\S]*vn_msg_speed = \(uint8_t\)value/
  );
  assert.match(
    scene,
    /set_variable_value\(signed int variable_index, signed int value\)[\s\S]*vn_logic_overlay_dispatch/
  );
  assert.match(
    message,
    /vn_msg_speed >= 1u && vn_msg_speed <= 6u[\s\S]*vn_msg_speed - 1u\) \* 10u[\s\S]*message->text_speed_frames/
  );
  assert.match(
    message,
    /if \(play_adpcm_message_voice\(message->voice_index\)\)[\s\S]*adpcm_play_looping[\s\S]*VN_MESSAGE_VOICE_LOOP[\s\S]*VN_MESSAGE_VOICE_ONESHOT/
  );
  assert.match(
    main,
    /init_runtime_state\(void\)[\s\S]*uint16_t i;[\s\S]*i < pce_vn_variable_count && i < PCE_VN_VARIABLE_STORAGE_COUNT/
  );
});

test('CD VN runtime consumes SELECT before input watchers and applies dynamic AUTO timing', () => {
  const main = readRuntimeFile('vn_main.c');
  const message = readRuntimeFile('vn_msg_core.c');
  const header = readRuntimeFile(path.join('generated', 'vn.h'));
  const selectOffset = main.indexOf('if (pressed & PAD_SEL)');
  const asyncOffset = main.indexOf('async_input_index = find_async_input_watcher(pressed);');

  assert.ok(selectOffset >= 0 && selectOffset < asyncOffset);
  assert.match(
    main,
    /static uint8_t VN_BANKED_CODE2 read_pad_raw\(void\)[\s\S]*return \(uint8_t\)~pce_joypad_read\(\);/
  );
  assert.match(
    main,
    /advance_story\(\);\s+VN_MAP_BANK130_FOR_CODE\(\);\s+last_pad = read_pad_raw\(\);/
  );
  assert.match(
    main,
    /set_variable_value\(\(signed int\)PCE_VN_VARIABLE_AUTO_ENABLE_INDEX, auto_enabled \? 0 : 1\);[\s\S]*pressed = \(uint8_t\)\(pressed & \(uint8_t\)~PAD_SEL\);/
  );
  assert.match(
    main,
    /if \(!auto_enabled && active_message_index >= 0 && message_complete\)[\s\S]*message_auto_wait = active_message_state\.auto_wait_frames;/
  );
  assert.match(
    main,
    /message_voice_mode == VN_MESSAGE_VOICE_ONESHOT[\s\S]*!adpcm_playback_active\(\)[\s\S]*advance_story\(\)/
  );
  assert.match(
    main,
    /message_voice_mode == VN_MESSAGE_VOICE_LOOP && adpcm_playback_active\(\)[\s\S]*stop_adpcm_voice\(\);[\s\S]*advance_story\(\)/
  );
  assert.doesNotMatch(main, /active_message_state\.advance_mode == PCE_VN_ADVANCE_AUTO/);
  assert.match(header, /#define PCE_VN_MESSAGE_AUTO_GLYPH 33183u/);
  assert.match(
    message,
    /show_message_auto_indicator\(void\)[\s\S]*PCE_VN_MESSAGE_AUTO_GLYPH/
  );
  assert.match(
    message,
    /if \(vn_auto_enable\)[\s\S]*message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO[\s\S]*show_message_auto_indicator\(\);/
  );
  assert.match(message, /use_prev = \(uint8_t\)\(composer_prev_valid && row == composer_row && col > composer_prev_col\)/);
  assert.match(message, /if \(col == VN_WAIT_CURSOR_COL\) return;[\s\S]*composer_prev_mask/);
  assert.match(
    message,
    /show_message_auto_indicator\(void\)[\s\S]*PCE_VN_MESSAGE_AUTO_GLYPH, VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW/
  );
  assert.doesNotMatch(message, /active_message_state\.advance_mode != PCE_VN_ADVANCE_BUTTON/);
});

test('CD VN runtime keeps multiple async Input routes beside one sync wait', () => {
  const state = readRuntimeFile('vn_engine_state.c');
  const scene = readRuntimeFile('vn_port_scene.c');
  const main = readRuntimeFile('vn_main.c');

  assert.match(state, /#define VN_ASYNC_INPUT_WATCHER_CAPACITY 7u/);
  assert.match(state, /async_input_masks\[VN_ASYNC_INPUT_WATCHER_CAPACITY\]/);
  assert.match(state, /async_input_targets\[VN_ASYNC_INPUT_WATCHER_CAPACITY\]/);
  assert.match(
    scene,
    /command_type == PCE_VN_COMMAND_INPUTCHECK[\s\S]*remaining_mask[\s\S]*async_input_masks\[write_index\] = mask;[\s\S]*async_input_targets\[write_index\] = command->x;/,
  );
  assert.match(
    scene,
    /mode == PCE_VN_INPUT_MODE_CANCEL[\s\S]*async_input_watcher_count = 0u;[\s\S]*mode == PCE_VN_INPUT_MODE_ASYNC[\s\S]*remaining_mask/,
  );
  assert.match(scene, /static uint8_t VN_BANKED_CODE find_async_input_watcher\(uint8_t pressed\)/);
  assert.match(
    main,
    /async_input_index = find_async_input_watcher\(pressed\);[\s\S]*target = async_input_targets\[async_input_index\];[\s\S]*async_input_watcher_count = 0u;[\s\S]*sync_input_active = 0u;/,
  );
  assert.match(
    main,
    /else if \(sync_input_active\)[\s\S]*sync_input_target = PCE_VN_NO_COMMAND;[\s\S]*async_input_watcher_count = 0u;/,
  );
});

test('CD VN one-shot natural completion remains free of BIOS status polling and reset', () => {
  const adpcm = readRuntimeFile('vn_adpcm_core.c');
  const serviceStart = adpcm.indexOf('static void VN_CD_ASYNC_CODE service_adpcm_playback_impl(void)');
  const service = readRuntimeFunction(
    adpcm,
    'static void VN_CD_ASYNC_CODE service_adpcm_playback_impl(void)',
  );

  assert.notEqual(serviceStart, -1);
  assert.doesNotMatch(service, /pce_cdb_adpcm_status\(/);
  assert.doesNotMatch(service, /pce_cdb_adpcm_stop\(/);
  assert.doesNotMatch(service, /pce_cdb_adpcm_reset\(/);
  assert.doesNotMatch(service, /stop_adpcm_voice\(/);
  assert.match(service, /adpcm_play_active = 0u;[\s\S]*adpcm_play_frames_remaining = 0u;/);
});

test('CD VN buffered ADPCM playback uses BIOS with the real sample length and mode', () => {
  const adpcm = readRuntimeFile('vn_adpcm_core.c');
  const config = readRuntimeFile('vn_engine_config.h');
  const play = readRuntimeFunction(
    adpcm,
    'static uint8_t VN_BANKED_CODE2 play_adpcm_buffered_voice',
  );

  assert.match(play, /vn_cd_bios_irq_open\(\);[\s\S]*pce_cdb_adpcm_play\(/);
  assert.match(play, /\(uint16_t\)adpcm_voice_snapshot\.adpcm_address/);
  assert.match(play, /\(uint16_t\)adpcm_voice_snapshot\.data_size/);
  assert.match(play, /adpcm_voice_snapshot\.loop \? PCE_CDB_ADPCM_REPEAT : PCE_CDB_ADPCM_ONE_SHOT/);
  assert.match(play, /adpcm_voice_snapshot\.loop \? 0u : VN_ADPCM_SNAPSHOT_PLAY_FRAMES\(\)/);
  assert.doesNotMatch(adpcm, /start_buffered_adpcm_playback_direct|stop_buffered_adpcm_playback_direct/);
  assert.doesNotMatch(config, /VN_ADPCM_BUFFERED_HARDWARE_LENGTH|VN_ADPCM_BUFFERED_END_GUARD_FRAMES/);
});

test('CD VN executes ADPCM Audio immediately and never replays it from a later wait', () => {
  const adpcm = readRuntimeFile('vn_adpcm_core.c');
  const config = readRuntimeFile('vn_engine_config.h');
  const state = readRuntimeFile('vn_engine_state.c');
  const main = readRuntimeFile('vn_main.c');
  const message = readRuntimeFile('vn_msg_core.c');
  const scene = readRuntimeFile('vn_port_scene.c');
  const biosFit = readRuntimeFunction(adpcm, 'static uint8_t VN_BANKED_CODE adpcm_voice_bios_cd_load_fits');
  const biosLoad = readRuntimeFunction(
    adpcm,
    'static uint8_t VN_BANKED_CODE load_adpcm_voice_bios_cd',
  );
  const load = readRuntimeFunction(
    adpcm,
    'static uint8_t VN_BANKED_CODE2 load_adpcm_voice',
  );
  const audio = readRuntimeFunction(
    scene,
    'static void VN_BANKED_CODE2 handle_audio_command',
  );
  const execute = readRuntimeFunction(
    scene,
    'static uint8_t VN_BANKED_CODE execute_command',
  );
  const run = readRuntimeFunction(
    scene,
    'static uint8_t VN_BANKED_CODE run_commands_until_wait',
  );
  const startMessage = readRuntimeFunction(message, 'static void start_message');
  const messageVoiceOffset = startMessage.indexOf('if (play_adpcm_message_voice(message->voice_index))');
  const windowPrepOffset = startMessage.indexOf('restore_window_display = begin_message_window_vram_update()');

  assert.match(
    biosFit,
    /if \(!sector_count \|\| sector_count > 32u\) return 0u;[\s\S]*if \(!adpcm_address\) return 1u;[\s\S]*sector_count <= \(\(uint16_t\)\(0u - adpcm_address\) >> 11\)/,
  );
  assert.match(
    biosLoad,
    /if \(!chunk_sectors\) chunk_sectors = remaining;[\s\S]*pce_cdb_adpcm_reset\(\);[\s\S]*pce_cdb_adpcm_read_from_cd\(sector, chunk, adpcm_address\)[\s\S]*cd_transfer_wait\(\);[\s\S]*wait_adpcm_transfer_ready\(\)/,
  );
  assert.match(
    biosLoad,
    /A preload has no immediate PLAY command[\s\S]*ADPCM RAM contents are preserved[\s\S]*pce_cdb_adpcm_reset\(\);[\s\S]*wait_adpcm_transfer_ready\(\)/,
  );
  assert.match(
    load,
    /if \(!psg_active && adpcm_voice_bios_cd_load_fits\(\)\)[\s\S]*load_adpcm_voice_bios_cd\(0u\)[\s\S]*else[\s\S]*load_adpcm_voice_async_cd\(\)/,
  );
  assert.match(
    audio,
    /kind == PCE_VN_AUDIO_KIND_ADPCM[\s\S]*action == PCE_VN_AUDIO_ACTION_STOP\) stop_adpcm_voice\(\);[\s\S]*else play_adpcm_voice\(asset_index\);/,
  );
  assert.doesNotMatch(audio, /options|load_adpcm_cache_asset/);
  assert.doesNotMatch(
    state + main + message + scene,
    /VN_AUDIO_DEFER_UNTIL_WAIT|pending_adpcm_play_index|start_pending_adpcm_voice|message_adpcm_started/,
  );
  assert.match(config, /#define VN_EXEC_CACHE_WAIT 3u/);
  assert.match(execute, /PCE_VN_CACHE_ACTION_LOAD[\s\S]*return VN_EXEC_CACHE_WAIT;/);
  assert.match(
    run,
    /result == VN_EXEC_CACHE_WAIT\) return 1u;[\s\S]*result == VN_EXEC_WAIT[\s\S]*return 1u;/,
  );
  assert.ok(messageVoiceOffset >= 0);
  assert.ok(windowPrepOffset > messageVoiceOffset);
  assert.doesNotMatch(startMessage.slice(messageVoiceOffset, windowPrepOffset), /delay_frame\(\)/);
});

test('CD VN skips only physically current duplicate BG and Sprite commands', () => {
  const config = readRuntimeFile('vn_engine_config.h');
  const state = readRuntimeFile('vn_engine_state.c');
  const bus = readRuntimeFile('vn_engine_bus.c');
  const scene = readRuntimeFile('vn_port_scene.c');
  const sprite = readRuntimeFile('vn_port_sprite.c');
  const message = readRuntimeFile('vn_msg_core.c');
  const asyncMatcherStart = bus.indexOf('static uint8_t VN_CD_ASYNC_CODE command_matches_display_impl');
  const asyncEntryStart = bus.indexOf('static uint8_t VN_CD_ASYNC_ENTRY_CODE vn_cd_async_entry', asyncMatcherStart);
  const setBackgroundStart = scene.indexOf('static void set_background');
  const residentMatcherStart = scene.indexOf('static uint8_t VN_BANKED_CODE2 command_matches_display', setBackgroundStart);
  const sameBackgroundStart = scene.indexOf('static void VN_BANKED_CODE2 finish_same_background_transition', residentMatcherStart);
  const controlStart = scene.indexOf('static uint8_t VN_BANKED_CODE2 execute_control_command', sameBackgroundStart);
  const executeStart = scene.indexOf('static uint8_t VN_BANKED_CODE execute_command', controlStart);
  const clearSpritesImplStart = sprite.indexOf('static void VN_CD_ASYNC_CODE clear_sprites_impl(void)');
  const clearSpritesStart = sprite.indexOf('static void VN_BANKED_CODE clear_sprites(void)', clearSpritesImplStart);
  const hideSpritesStart = sprite.indexOf('static void VN_BANKED_CODE2 hide_sprites_for_asset_load(void)');

  assert.ok(asyncMatcherStart >= 0 && asyncEntryStart > asyncMatcherStart);
  assert.ok(setBackgroundStart >= 0 && residentMatcherStart > setBackgroundStart);
  assert.ok(sameBackgroundStart > residentMatcherStart && controlStart > sameBackgroundStart);
  assert.ok(executeStart > controlStart && clearSpritesImplStart >= 0 && clearSpritesStart > clearSpritesImplStart && hideSpritesStart >= 0);

  const asyncMatcher = bus.slice(asyncMatcherStart, asyncEntryStart);
  const asyncEntry = bus.slice(asyncEntryStart);
  const setBackground = scene.slice(setBackgroundStart, residentMatcherStart);
  const residentMatcher = scene.slice(residentMatcherStart, controlStart);
  const sameBackground = scene.slice(sameBackgroundStart, controlStart);
  const clearSprites = sprite.slice(clearSpritesStart, hideSpritesStart);
  const execute = scene.slice(executeStart);
  const hideSprites = sprite.slice(hideSpritesStart);

  assert.match(config, /#define VN_CD_ASYNC_OP_MATCH_DISPLAY_COMMAND 80u/);
  assert.match(config, /#define VN_CD_ASYNC_OP_CLEAR_SPRITES 88u/);
  assert.match(config, /#define VN_CD_ASYNC_OP_CANCEL_SPRITE_MOVE 96u/);
  assert.match(config, /#define VN_CD_ASYNC_OP_CANCEL_ALL_SPRITE_MOVES 104u/);
  assert.match(
    state,
    /static volatile uint8_t full_screen_bg_text_vram_dirty = 0;/,
    'the Full BG dirty clear must remain an observable cross-bank store',
  );
  assert.match(
    residentMatcher,
    /vn_visual_cache_arg_asset = \(uint16_t\)\(uintptr_t\)command;[\s\S]*vn_cd_async_call_bank122\(VN_CD_ASYNC_OP_MATCH_DISPLAY_COMMAND\)/,
  );
  assert.match(
    asyncEntry,
    /VN_CD_ASYNC_OP_MATCH_DISPLAY_COMMAND[\s\S]*command_matches_display_impl\(\(const pce_vn_command_t \*\)\(uintptr_t\)vn_visual_cache_arg_asset\)/,
  );
  assert.match(asyncEntry, /VN_CD_ASYNC_OP_CLEAR_SPRITES[\s\S]*clear_sprites_impl\(\);/);
  assert.match(asyncEntry, /VN_CD_ASYNC_OP_CANCEL_SPRITE_MOVE[\s\S]*cancel_sprite_move_impl\(vn_visual_cache_arg_slot\);/);
  assert.match(asyncEntry, /VN_CD_ASYNC_OP_CANCEL_ALL_SPRITE_MOVES[\s\S]*cancel_all_sprite_moves_impl\(\);/);
  assert.match(clearSprites, /vn_cd_async_call_bank122\(VN_CD_ASYNC_OP_CLEAR_SPRITES\)/);
  assert.match(
    asyncMatcher,
    /current_bg_index != command->asset_index \|\| current_bg_x != next_x \|\| current_bg_y != next_y/,
  );
  assert.match(asyncMatcher, /if \(!current_bg_display_valid\) return 0u;/);
  assert.match(asyncMatcher, /if \(pending_display_enable\) return 0u;/);
  assert.match(
    asyncMatcher,
    /if \(current_scene_full_screen_bg\)[\s\S]*!full_screen_bg_text_vram_dirty[\s\S]*else if \(full_screen_bg_text_vram_dirty\)/,
  );

  const bgFade = setBackground.indexOf('fade_palette(&ref, current_bg_palette_base, bg_fade_out_frames, 0u);');
  const bgUpload = setBackground.indexOf('upload_bg_graphics(next_bg');
  assert.ok(bgFade >= 0 && bgUpload >= 0);
  assert.match(
    setBackground,
    /const uint8_t bg_fade_out_frames = fade_transition \? \(fade_out_frames == 1u \? 0u : fade_out_frames\)/,
  );
  assert.match(
    setBackground,
    /const uint8_t bg_fade_in_frames = fade_transition \? \(fade_in_frames == 1u \? 0u : fade_in_frames\)/,
  );
  assert.match(
    setBackground,
    /if \(\(fade_transition \|\| implicit_fade\) && !pending_display_enable\)[\s\S]*VN_BG_UPLOAD_DISPLAY_DISABLE\(\);/,
  );

  assert.match(
    asyncMatcher,
    /state->sprite_index != command->asset_index[\s\S]*state->animation_index != command->animation_index[\s\S]*state->x != command->x[\s\S]*state->y != command->y[\s\S]*state->flags != command->flags/,
  );
  assert.match(
    asyncMatcher,
    /sprite_moves\[slot\]\.active \|\| sync_sprite_move_slot == slot/,
  );
  assert.match(asyncMatcher, /!sprite_satb_layout_valid \|\| !sprite_satb_slot_count\[slot\]/);
  assert.doesNotMatch(asyncMatcher, /state->frame|state->timer/);

  const duplicateVisual = execute.indexOf('(command->type == PCE_VN_COMMAND_BACKGROUND || command->type == PCE_VN_COMMAND_SPRITE)');
  const voiceStop = execute.indexOf('stop_adpcm_voice();');
  assert.ok(duplicateVisual >= 0 && voiceStop > duplicateVisual);
  const duplicateBgBranch = execute.slice(duplicateVisual, voiceStop);
  assert.match(duplicateBgBranch, /if \(command->type == PCE_VN_COMMAND_BACKGROUND\)[\s\S]*finish_same_background_transition\(\);[\s\S]*return VN_EXEC_CONTINUE;/);
  assert.doesNotMatch(duplicateBgBranch, /set_background\(|fade_palette\(|upload_bg_graphics\(/);
  assert.match(
    sameBackground,
    /if \(pending_scene_sprite_clear\)[\s\S]*clear_sprites\(\);[\s\S]*upload_sprite_table\(\);[\s\S]*sprite_satb_layout_valid = 0u;[\s\S]*REQUEST_SPRITE_REFRESH_FULL\(\);[\s\S]*if \(pending_sprite_refresh\)[\s\S]*refresh_scene_sprites\(\);/,
  );
  assert.match(
    setBackground,
    /if \(pending_scene_sprite_clear\)[\s\S]*clear_sprites\(\);[\s\S]*upload_sprite_table\(\);[\s\S]*sprite_satb_layout_valid = 0u;[\s\S]*REQUEST_SPRITE_REFRESH_FULL\(\)/,
  );
  assert.match(
    setBackground,
    /if \(current_scene_full_screen_bg\)[\s\S]*sprite_satb_layout_valid = 0u;[\s\S]*REQUEST_SPRITE_REFRESH_FULL\(\);[\s\S]*loaded_sprite_pattern_valid\[i\] = 0u/,
  );
  assert.match(
    hideSprites,
    /clear_sprites\(\);[\s\S]*upload_sprite_table\(\);[\s\S]*sprite_satb_layout_valid = 0u;/,
  );
  assert.match(
    message,
    /if \(clear_visible_full_bg\)[\s\S]*clear_screen_map\(\);[\s\S]*preloaded_bg_valid = 0u;[\s\S]*current_bg_display_valid = 0u;/,
  );
});

test('CD VN boot initializes sprite moves without calling the unloaded bank122 overlay', () => {
  const main = readRuntimeFile('vn_main.c');
  const sprite = readRuntimeFile('vn_port_sprite.c');
  const initStart = main.indexOf('static void init_runtime_state(void)');
  const nextFunction = main.indexOf('static void VN_BANKED_CODE vn_wait_next_vblank_raw(void)', initStart);
  const init = main.slice(initStart, nextFunction);
  const bootResetStart = sprite.indexOf('static void VN_BANKED_CODE initialize_sprite_move_state(void)');
  const nextSpriteFunction = sprite.indexOf('static void VN_CD_ASYNC_CODE cancel_sprite_move_impl', bootResetStart);
  const bootReset = sprite.slice(bootResetStart, nextSpriteFunction);

  assert.ok(initStart >= 0 && nextFunction > initStart && bootResetStart >= 0 && nextSpriteFunction > bootResetStart);
  assert.match(init, /initialize_sprite_move_state\(\);/);
  assert.doesNotMatch(init, /cancel_all_sprite_moves\(\);/);
  assert.match(sprite, /sprite_moves is static BSS[\s\S]*initialize_sprite_move_state\(void\)/);
  assert.match(bootReset, /sync_sprite_move_slot = 0xffu;/);
  assert.doesNotMatch(bootReset, /cancel_all_sprite_moves\(\);/);
});

test('CD VN loads pure logic into bank124 and restores exact MPR4/MPR6 mappings', () => {
  const config = readRuntimeFile('vn_engine_config.h');
  const bus = readRuntimeFile('vn_engine_bus.c');
  const cache = readRuntimeFile('vn_cache_core.c');
  const scene = readRuntimeFile('vn_port_scene.c');
  const sprite = readRuntimeFile('vn_port_sprite.c');
  const main = readRuntimeFile('vn_main.c');
  const adpcm = readRuntimeFile('vn_adpcm_core.c');
  const time = readRuntimeFile('vn_engine_time.c');
  const dispatchStart = bus.indexOf('static uint8_t VN_BANKED_CODE vn_logic_overlay_dispatch');
  const legacyEntryStart = bus.indexOf('static uint8_t VN_OVERLAY_ENTRY_CODE vn_overlay_entry');
  const logicEntryStart = bus.indexOf('static uint8_t VN_LOGIC_OVERLAY_ENTRY_CODE vn_logic_overlay_entry');
  const logicEntryEnd = bus.indexOf('#endif', logicEntryStart);
  const commonLoader = readRuntimeFunction(
    bus,
    'static uint8_t VN_BANKED_CODE vn_load_slot4_blob',
  );
  const loaderStart = bus.indexOf('static void VN_BANKED_CODE load_logic_overlay_code');
  const loaderEnd = bus.indexOf('static void VN_BANKED_CODE load_cd_async_code', loaderStart);
  const prepareStart = sprite.indexOf('static uint8_t VN_BANKED_CODE prepare_sprite_animation_meta');
  const logicAnimationStart = sprite.indexOf('static uint8_t VN_LOGIC_OVERLAY_CODE prepared_sprite_animation_matches');
  const logicAnimationEnd = sprite.indexOf('/* Resident wrappers perform', logicAnimationStart);
  const cacheWrapperStart = sprite.indexOf('static void VN_BANKED_CODE cache_sprite_animation', logicAnimationEnd);
  const mouthWrapperStart = sprite.indexOf('static void VN_BANKED_CODE update_active_message_mouth', cacheWrapperStart);
  const mouthWrapperEnd = sprite.indexOf('/* Boot runs before', mouthWrapperStart);
  const tickImplStart = sprite.indexOf('static void VN_LOGIC_OVERLAY_CODE tick_sprite_animations_impl');
  const tickWrapperEnd = sprite.indexOf('/* Advance blink timers', tickImplStart);

  assert.ok(dispatchStart >= 0 && legacyEntryStart > dispatchStart);
  assert.ok(logicEntryStart > legacyEntryStart && logicEntryEnd > logicEntryStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  assert.ok(prepareStart >= 0 && logicAnimationStart > prepareStart && logicAnimationEnd > logicAnimationStart);
  assert.ok(cacheWrapperStart > logicAnimationEnd && mouthWrapperStart > cacheWrapperStart && mouthWrapperEnd > mouthWrapperStart);
  assert.ok(tickImplStart >= 0 && tickWrapperEnd > tickImplStart);

  const dispatcher = bus.slice(dispatchStart, legacyEntryStart);
  const legacyEntry = bus.slice(legacyEntryStart, logicEntryStart);
  const logicEntry = bus.slice(logicEntryStart, logicEntryEnd);
  const loader = bus.slice(loaderStart, loaderEnd);
  const decoders = [
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_has_range',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_copy',
    'static uint16_t VN_LOGIC_OVERLAY_CODE scene_pack_u16',
    'static signed int VN_LOGIC_OVERLAY_CODE scene_pack_s16',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_command_impl',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_message_impl',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_choice_impl',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_choice_option_impl',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_switch_impl',
    'static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_switch_case_impl',
  ].map((marker) => readRuntimeFunction(scene, marker)).join('\n');
  const variableLogic = readRuntimeFunction(
    scene,
    'static void VN_LOGIC_OVERLAY_CODE set_variable_value_impl',
  );
  const prepare = sprite.slice(prepareStart, logicAnimationStart);
  const animationLogic = sprite.slice(logicAnimationStart, logicAnimationEnd);
  const cacheWrapper = sprite.slice(cacheWrapperStart, mouthWrapperStart);
  const mouthWrapper = sprite.slice(mouthWrapperStart, mouthWrapperEnd);
  const tickLogic = sprite.slice(tickImplStart, tickWrapperEnd);

  assert.match(config, /PCE_RAM_BANK_AT\(124,\s*4\);/);
  assert.match(config, /#define VN_LOGIC_OVERLAY_RESERVED_SECTORS 4u/);
  assert.match(config, /section\("\.vn_logic_overlay\.entry"\)/);
  assert.match(config, /section\("\.vn_logic_overlay\.impl"\)/);
  assert.match(config, /PCE_VN_LOGIC_OVERLAY_LOAD_ADDR/);
  assert.match(config, /typedef struct \{[\s\S]*source_ref;[\s\S]*load_addr;[\s\S]*target_bank;[\s\S]*reserved_sectors;[\s\S]*loaded_flag;[\s\S]*\} vn_slot4_blob_descriptor_t;/);
  assert.match(
    dispatcher,
    /slot4_bank = vn_slot4_current_bank\(\);[\s\S]*"tma #\$40"[\s\S]*map_vn_data\(\);[\s\S]*pce_ram_bank124_map\(\);[\s\S]*VN_LOGIC_OVERLAY_CALL\(op, a0, a1, a2\);[\s\S]*"tam #\$40"[\s\S]*vn_slot4_map_bank\(slot4_bank\);/,
  );
  assert.match(
    commonLoader,
    /slot4_bank = vn_slot4_current_bank\(\);[\s\S]*"tma #\$40"[\s\S]*map_vn_data\(\);[\s\S]*ref = \*descriptor->source_ref;[\s\S]*vn_slot4_map_bank\(descriptor->target_bank\);[\s\S]*pce_cdb_cd_read\([\s\S]*"tam #\$40"[\s\S]*vn_slot4_map_bank\(slot4_bank\);/,
  );
  assert.match(bus, /vn_logic_overlay_blob = \{[\s\S]*&pce_vn_logic_overlay_data,[\s\S]*124u,[\s\S]*VN_LOGIC_OVERLAY_RESERVED_SECTORS/);
  assert.match(bus, /vn_overlay_blob = \{[\s\S]*&pce_vn_overlay_data,[\s\S]*133u,[\s\S]*VN_OVERLAY_RESERVED_SECTORS/);
  assert.match(bus, /vn_cd_async_blob = \{[\s\S]*&pce_vn_cd_async_code_data,[\s\S]*122u,[\s\S]*&vn_cd_async_code_loaded/);
  assert.match(bus, /load_logic_overlay_code\(void\)[\s\S]*vn_load_slot4_blob\(&vn_logic_overlay_blob\)/);
  assert.match(bus, /load_cd_async_code\(void\)[\s\S]*vn_load_slot4_blob\(&vn_cd_async_blob\)/);
  assert.match(cache, /load_visual_cache_code\(void\)[\s\S]*vn_load_slot4_blob\(&vn_visual_cache_blob\)/);
  assert.match(main, /load_overlay_code\(\);[\s\S]*load_logic_overlay_code\(\);[\s\S]*load_visual_cache_code\(\);[\s\S]*load_cd_async_code\(\);/);
  assert.match(logicEntry, /VN_LOGIC_OVERLAY_OP_READ_COMMAND[\s\S]*VN_LOGIC_OVERLAY_OP_READ_SWITCH_CASE/);
  assert.match(logicEntry, /VN_LOGIC_OVERLAY_OP_CACHE_SPRITE_ANIM[\s\S]*VN_LOGIC_OVERLAY_OP_SET_VARIABLE[\s\S]*VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH[\s\S]*VN_LOGIC_OVERLAY_OP_TICK_SPRITE_ANIMATIONS/);
  assert.doesNotMatch(legacyEntry, /VN_LOGIC_OVERLAY_OP_/);
  assert.match(decoders, /VN_LOGIC_OVERLAY_CODE scene_pack_read_command_impl/);
  assert.match(decoders, /VN_LOGIC_OVERLAY_CODE scene_pack_read_switch_case_impl/);
  assert.match(scene, /set_variable_value\(signed int variable_index, signed int value\)[\s\S]*vn_logic_overlay_dispatch\(VN_LOGIC_OVERLAY_OP_SET_VARIABLE/);

  assert.match(prepare, /"tma #\$40"[\s\S]*vn_read_meta_sector\([\s\S]*"tam #\$40"/);
  assert.match(cacheWrapper, /prepare_sprite_animation_meta\([\s\S]*vn_logic_overlay_dispatch\([\s\S]*VN_LOGIC_OVERLAY_OP_CACHE_SPRITE_ANIM/);
  assert.match(mouthWrapper, /prepare_sprite_animation_meta\([\s\S]*vn_logic_overlay_dispatch\(VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH/);
  assert.doesNotMatch(animationLogic, /vn_read_meta_sector|pce_cdb_|vn_cd_async_call_bank122|visual_cache_call|vn_overlay_dispatch|VN_MAP_BANK130_FOR_CODE|pce_ram_bank(?:121|122|133)_map/);
  assert.doesNotMatch(`${decoders}\n${variableLogic}`, /pce_cdb_|vn_cd_async_call_bank122|visual_cache_call|vn_overlay_dispatch|VN_MAP_BANK130_FOR_CODE|pce_ram_bank(?:121|122|133)_map/);
  assert.match(tickLogic, /VN_LOGIC_OVERLAY_CODE tick_sprite_animations_impl[\s\S]*vn_logic_overlay_dispatch\(VN_LOGIC_OVERLAY_OP_TICK_SPRITE_ANIMATIONS/);
  assert.doesNotMatch(cache, /VN_VISUAL_CACHE_OP_TICK_SPRITE_ANIMATIONS/);

  /* Natural voice completion runs inside bank122. It reaches the resident
     prepare+logic wrapper, whose dispatcher restores bank122 instead of forcing
     bank130 before the suspended service function returns. */
  assert.match(time, /vn_cd_async_call_bank122\(VN_CD_ASYNC_OP_ADPCM_PLAYBACK\)/);
  assert.match(adpcm, /static void VN_CD_ASYNC_CODE service_adpcm_playback_impl\(void\)[\s\S]*update_active_message_mouth\(1u\);/);
  assert.match(mouthWrapper, /vn_logic_overlay_dispatch\(VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH/);

  /* Every slot4 dispatcher now restores the exact caller mapping. */
  assert.match(bus, /vn_overlay_dispatch\(uint8_t op[\s\S]*slot4_bank = vn_slot4_current_bank\(\);[\s\S]*pce_ram_bank133_map\(\);[\s\S]*VN_OVERLAY_CALL\(op, a0, a1, a2\);[\s\S]*vn_slot4_map_bank\(slot4_bank\);/);
  assert.match(cache, /visual_cache_call\(uint8_t op\)[\s\S]*slot4_bank = vn_slot4_current_bank\(\);[\s\S]*VN_MAP_VISUAL_CACHE_CODE\(\);[\s\S]*PCE_VN_VISUAL_CODE_LOAD_ADDR[\s\S]*vn_slot4_map_bank\(slot4_bank\);/);
});

test('CD VN message mouth uses the next ROW and restores it on text, voice, or story completion', () => {
  const config = readRuntimeFile('vn_engine_config.h');
  const state = readRuntimeFile('vn_engine_state.c');
  const bus = readRuntimeFile('vn_engine_bus.c');
  const time = readRuntimeFile('vn_engine_time.c');
  const main = readRuntimeFile('vn_main.c');
  const sprite = readRuntimeFile('vn_port_sprite.c');
  const message = readRuntimeFile('vn_msg_core.c');
  const adpcm = readRuntimeFile('vn_adpcm_core.c');
  const scene = readRuntimeFile('vn_port_scene.c');

  assert.match(state, /static signed int active_message_mouth_animation_index/);
  assert.match(main, /active_message_mouth_animation_index = -1;/);
  assert.match(config, /#define VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH 72u/);
  assert.match(config, /#define VN_CD_ASYNC_OP_ADPCM_PLAYBACK 72u/);
  assert.match(bus, /VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH\) return update_active_message_mouth_impl\(a2\);/);
  assert.match(bus, /VN_CD_ASYNC_OP_ADPCM_PLAYBACK\)[\s\S]*service_adpcm_playback_impl\(\);[\s\S]*return 1u;/);
  assert.match(time, /vn_cd_async_call_bank122\(VN_CD_ASYNC_OP_ADPCM_PLAYBACK\)/);
  assert.match(
    bus,
    /vn_cd_async_call_bank122\(uint8_t op\)[\s\S]*slot4_bank = vn_slot4_current_bank\(\);[\s\S]*pce_ram_bank122_map\(\);[\s\S]*VN_CD_ASYNC_CALL\(op\);[\s\S]*vn_slot4_map_bank\(slot4_bank\);/,
  );
  assert.match(
    sprite,
    /update_active_message_mouth_impl\(uint8_t restore\)[\s\S]*slot_index = active_message_state\.mouth_slot[\s\S]*normal_animation_index \+ 1\) >= pce_vn_sprite_animation_count[\s\S]*prepared_sprite_animation_matches\([\s\S]*cache_sprite_animation_impl\(\(uint8_t\)slot_index, \(uint16_t\)slot->animation_index\)/,
  );
  assert.match(
    sprite,
    /if \(restore\)[\s\S]*slot->animation_index != normal_animation_index \+ 1[\s\S]*slot->animation_index = \(signed int\)\(normal_animation_index \+ \(restore \? 0 : 1\)\);[\s\S]*if \(!restore\) active_message_mouth_animation_index = normal_animation_index;[\s\S]*REQUEST_SPRITE_REFRESH_FULL\(\);/,
  );
  assert.doesNotMatch(sprite, /pce_vn_sprite_animations\[/);
  assert.match(sprite, /update_active_message_mouth\(uint8_t restore\)[\s\S]*prepare_sprite_animation_meta\([\s\S]*vn_logic_overlay_dispatch\(VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH, 0u, 0u, restore\)/);
  assert.match(message, /apply_message_text_color\(message->text_color\);[\s\S]*update_active_message_mouth\(0u\);/);
  assert.match(
    message,
    /refresh_message_wait_indicator\(void\)[\s\S]*active_message_index >= 0 && message_complete\) update_active_message_mouth\(1u\);/,
  );
  assert.match(
    adpcm,
    /static void VN_CD_ASYNC_CODE service_adpcm_playback_impl\(void\)[\s\S]*adpcm_play_active = 0u;[\s\S]*sync_cd_external_irq_after_bios_call\(\);[\s\S]*if \(message_voice_mode == VN_MESSAGE_VOICE_ONESHOT\)[\s\S]*update_active_message_mouth\(1u\);/,
  );
  assert.match(adpcm, /static uint8_t VN_BANKED_CODE copy_adpcm_voice\(signed int voice_index\)/);
  assert.match(
    scene,
    /advance_story\(void\)\s*\{\s*uint8_t remaining_scene_transitions = 0xffu;\s*update_active_message_mouth\(1u\);/,
  );
  assert.match(scene, /message->mouth_slot = scene_pack_s16\(cache, \(uint16_t\)\(offset \+ 8u\)\);/);
  assert.match(scene, /message->instant_glyph_count = scene_pack_u8\(cache, \(uint16_t\)\(offset \+ 10u\)\);/);
});

test('CD VN runtime drains consecutive no-wait nextScene transitions without another input', () => {
  const scene = readRuntimeFile('vn_port_scene.c');
  const advance = readRuntimeFunction(scene, 'static void advance_story');

  assert.equal((advance.match(/run_commands_until_wait\(\)/g) || []).length, 1);
  assert.match(advance, /uint8_t remaining_scene_transitions = 0xffu;/);
  assert.match(
    advance,
    /for \(;;\)[\s\S]*if \(run_commands_until_wait\(\)\) break;[\s\S]*next_scene = current_scene_next_scene\(\);[\s\S]*if \(next_scene < 0\)[\s\S]*if \(!remaining_scene_transitions\)[\s\S]*show_scene\(target_scene\);/,
  );
  assert.match(
    advance,
    /if \(current_scene != target_scene\)[\s\S]*wait_frames_remaining = 1u;[\s\S]*break;/,
  );
});
