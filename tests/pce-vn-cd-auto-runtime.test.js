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

test('CD VN runtime clamps reserved variables and snapshots MSG_SPEED per message', () => {
  const state = readRuntimeFile('vn_engine_state.c');
  const scene = readRuntimeFile('vn_port_scene.c');
  const message = readRuntimeFile('vn_msg_core.c');
  const main = readRuntimeFile('vn_main.c');

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
    /set_variable_value\(signed int variable_index, signed int value\)[\s\S]*vn_overlay_dispatch/
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
  const selectOffset = main.indexOf('if (pressed & PAD_SEL)');
  const asyncOffset = main.indexOf('if (async_input_active && (pressed & async_input_mask))');

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
  assert.match(
    message,
    /refresh_message_wait_indicator[\s\S]*\|\| vn_auto_enable/
  );
  assert.doesNotMatch(message, /active_message_state\.advance_mode != PCE_VN_ADVANCE_BUTTON/);
});

test('CD VN one-shot natural completion remains free of BIOS status polling and reset', () => {
  const adpcm = readRuntimeFile('vn_adpcm_core.c');
  const serviceStart = adpcm.indexOf('static void VN_CD_ASYNC_CODE service_adpcm_playback_impl(void)');
  const service = adpcm.slice(serviceStart);

  assert.notEqual(serviceStart, -1);
  assert.doesNotMatch(service, /pce_cdb_adpcm_status\(/);
  assert.doesNotMatch(service, /pce_cdb_adpcm_reset\(/);
  assert.doesNotMatch(service, /stop_adpcm_voice\(/);
  assert.match(service, /adpcm_play_active = 0u;[\s\S]*stop_buffered_adpcm_playback_direct\(\);/);
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
  assert.match(config, /#define VN_OVERLAY_OP_MESSAGE_MOUTH 18u/);
  assert.match(config, /#define VN_CD_ASYNC_OP_ADPCM_PLAYBACK 72u/);
  assert.match(bus, /VN_OVERLAY_OP_MESSAGE_MOUTH\) \{ update_active_message_mouth_impl\(a2\); return 0u; \}/);
  assert.match(bus, /VN_CD_ASYNC_OP_ADPCM_PLAYBACK\)[\s\S]*service_adpcm_playback_impl\(\);[\s\S]*return 1u;/);
  assert.match(time, /vn_cd_async_call_bank122\(VN_CD_ASYNC_OP_ADPCM_PLAYBACK\)/);
  assert.match(
    bus,
    /vn_cd_async_call_bank122\(uint8_t op\)[\s\S]*slot4_bank = vn_slot4_current_bank\(\);[\s\S]*pce_ram_bank122_map\(\);[\s\S]*VN_CD_ASYNC_CALL\(op\);[\s\S]*vn_slot4_map_bank\(slot4_bank\);/,
  );
  assert.match(
    sprite,
    /update_active_message_mouth_impl\(uint8_t restore\)[\s\S]*slot_index = active_message_state\.mouth_slot[\s\S]*normal_animation_index \+ 1\) >= pce_vn_sprite_animation_count[\s\S]*pce_vn_sprite_animations\[normal_animation_index \+ 1\]\.sprite_index != \(unsigned int\)slot->sprite_index/,
  );
  assert.match(
    sprite,
    /if \(restore\)[\s\S]*slot->animation_index != normal_animation_index \+ 1[\s\S]*slot->animation_index = \(signed int\)\(normal_animation_index \+ \(restore \? 0 : 1\)\);[\s\S]*cache_sprite_animation_impl\(\(uint8_t\)slot_index\);[\s\S]*REQUEST_SPRITE_REFRESH_FULL\(\);/,
  );
  assert.match(sprite, /update_active_message_mouth\(uint8_t restore\)[\s\S]*vn_overlay_dispatch\(VN_OVERLAY_OP_MESSAGE_MOUTH, 0u, 0u, restore\)/);
  assert.match(message, /apply_message_text_color\(message->text_color\);[\s\S]*update_active_message_mouth\(0u\);/);
  assert.match(
    message,
    /refresh_message_wait_indicator\(void\)[\s\S]*active_message_index >= 0 && message_complete\) update_active_message_mouth\(1u\);/,
  );
  assert.match(
    adpcm,
    /static void VN_CD_ASYNC_CODE service_adpcm_playback_impl\(void\)[\s\S]*stop_buffered_adpcm_playback_direct\(\);[\s\S]*sync_cd_external_irq_after_bios_call\(\);[\s\S]*if \(message_voice_mode == VN_MESSAGE_VOICE_ONESHOT\)[\s\S]*vn_overlay_dispatch_locked\(VN_OVERLAY_OP_MESSAGE_MOUTH, 0u, 0u, 1u\);/,
  );
  assert.match(adpcm, /static uint8_t VN_BANKED_CODE copy_adpcm_voice\(signed int voice_index\)/);
  assert.match(scene, /advance_story\(void\)\s*\{\s*update_active_message_mouth\(1u\);/);
  assert.match(scene, /message->mouth_slot = scene_pack_s16\(cache, \(uint16_t\)\(offset \+ 8u\)\);/);
  assert.match(scene, /message->instant_glyph_count = scene_pack_u8\(cache, \(uint16_t\)\(offset \+ 10u\)\);/);
});
