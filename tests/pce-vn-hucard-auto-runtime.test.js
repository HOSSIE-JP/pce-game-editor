'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtimePath = path.join(
  __dirname,
  '..',
  'template',
  'template_pce_vn_hucard',
  'src',
  'pce_vn_hucard_runtime.c',
);
const runtime = fs.readFileSync(runtimePath, 'utf-8').replace(/\r\n/g, '\n');

function sliceBetween(startMarker, endMarker) {
  const start = runtime.indexOf(startMarker);
  const end = runtime.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return runtime.slice(start, end);
}

test('HuCARD VN clamps the AUTO_ENABLE and MSG_SPEED reserved variables centrally', () => {
  const setter = sliceBetween(
    'static void VN_HUCARD_CODE_SCRIPT set_variable_value',
    'static int16_t VN_HUCARD_CODE_SCRIPT get_variable_value',
  );
  assert.match(setter, /index == PCE_VN_VARIABLE_AUTO_ENABLE_INDEX/);
  assert.match(setter, /if \(value < 0\) value = 0;[\s\S]*else if \(value > 1\) value = 1;/);
  assert.match(setter, /index == PCE_VN_VARIABLE_MSG_SPEED_INDEX/);
  assert.match(setter, /if \(value < 0\) value = 0;[\s\S]*else if \(value > 6\) value = 6;/);

  const init = sliceBetween(
    'static void VN_HUCARD_CODE_SCRIPT init_variables',
    'static void VN_HUCARD_CODE_SCRIPT init_scene_cache',
  );
  assert.match(init, /uint16_t i;/);
  assert.match(init, /set_variable_value\(\(int16_t\)i, pce_vn_variable_initial_values\[i\]\);/);
});

test('HuCARD VN snapshots MSG_SPEED at message start and keeps zero as the compiled speed', () => {
  const startMessage = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT start_message',
    'static void VN_HUCARD_CODE_TEXT finish_active_message',
  );
  assert.match(startMessage, /message_text_speed = message\.text_speed_frames;/);
  assert.match(
    startMessage,
    /message_speed_level = get_variable_value\(PCE_VN_VARIABLE_MSG_SPEED_INDEX\);/,
  );
  assert.match(
    startMessage,
    /if \(message_speed_level > 0\)[\s\S]*message_text_speed = \(uint8_t\)\(\(message_speed_level - 1\) \* 10\);/,
  );
});

test('HuCARD VN consumes SELECT for AUTO and preserves manual message advance', () => {
  const mainLoop = runtime.slice(runtime.indexOf('int main(void)'));
  const select = mainLoop.indexOf('if (pressed & PAD_SELECT)');
  const asyncInput = mainLoop.indexOf('if (async_input_mask && (pressed & async_input_mask))');
  assert.ok(select >= 0 && select < asyncInput);
  assert.match(
    mainLoop,
    /set_variable_value\(PCE_VN_VARIABLE_AUTO_ENABLE_INDEX, auto_enable\);[\s\S]*pressed = \(uint8_t\)\(pressed & \(uint8_t\)~PAD_SELECT\);/,
  );
  assert.match(
    mainLoop,
    /if \(auto_enable\)[\s\S]*message_auto_wait = active_message_state\.auto_wait_frames;[\s\S]*hide_message_wait_indicator\(\);[\s\S]*else[\s\S]*refresh_message_wait_indicator\(\);/,
  );

  const activeMessage = sliceBetween(
    '        if (active_message_index >= 0)\n        {\n            if (!message_ticked',
    '        if (wait_frames_remaining)',
  );
  const manualAdvance = activeMessage.indexOf('if (pressed & (PAD_I | PAD_II | PAD_RUN))');
  const autoAdvance = activeMessage.indexOf('get_variable_value(PCE_VN_VARIABLE_AUTO_ENABLE_INDEX)');
  assert.ok(manualAdvance >= 0 && manualAdvance < autoAdvance);
  assert.doesNotMatch(activeMessage, /active_message_state\.advance_mode/);
  assert.doesNotMatch(activeMessage, /psg_song|psg_sfx|service_psg/);
});

test('HuCARD VN wait cursor follows the live AUTO_ENABLE value', () => {
  const refresh = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT refresh_message_wait_indicator',
    'static void VN_HUCARD_CODE_TEXT tick_message_wait_indicator',
  );
  const tick = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT tick_message_wait_indicator',
    'static uint8_t VN_HUCARD_CODE_TEXT begin_message_window_vram_update',
  );
  assert.match(refresh, /variable_values\[PCE_VN_VARIABLE_AUTO_ENABLE_INDEX\] != 0u/);
  assert.match(tick, /variable_values\[PCE_VN_VARIABLE_AUTO_ENABLE_INDEX\] != 0u/);
  assert.doesNotMatch(refresh, /advance_mode/);
  assert.doesNotMatch(tick, /advance_mode/);
});
