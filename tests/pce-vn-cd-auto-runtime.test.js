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
  const serviceStart = adpcm.indexOf('static void VN_BANKED_CODE2 service_adpcm_playback(void)');
  const service = adpcm.slice(serviceStart);

  assert.notEqual(serviceStart, -1);
  assert.doesNotMatch(service, /pce_cdb_adpcm_status\(/);
  assert.doesNotMatch(service, /pce_cdb_adpcm_reset\(/);
  assert.doesNotMatch(service, /stop_adpcm_voice\(/);
  assert.match(service, /adpcm_play_active = 0u;[\s\S]*stop_buffered_adpcm_playback_direct\(\);/);
});
