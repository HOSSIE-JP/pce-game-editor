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
  assert.match(mainLoop, /last_pad = \(uint8_t\)~pce_joypad_read\(\);/);
  assert.match(mainLoop, /pad = \(uint8_t\)~pce_joypad_read\(\);/);
  assert.match(
    mainLoop,
    /set_variable_value\(PCE_VN_VARIABLE_AUTO_ENABLE_INDEX, auto_enable\);[\s\S]*pressed = \(uint8_t\)\(pressed & \(uint8_t\)~PAD_SELECT\);/,
  );
  assert.match(
    mainLoop,
    /if \(active_message_index >= 0\)[\s\S]*if \(auto_enable && message_complete\)[\s\S]*message_auto_wait = active_message_state\.auto_wait_frames;[\s\S]*refresh_message_wait_indicator\(\);/,
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

test('HuCARD VN message indicator follows the live AUTO_ENABLE value', () => {
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
  assert.match(refresh, /message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO[\s\S]*show_message_auto_indicator\(\);/);
  assert.match(tick, /message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO[\s\S]*show_message_auto_indicator\(\);/);
  assert.match(runtime, /show_message_auto_indicator\(void\)[\s\S]*PCE_VN_MESSAGE_AUTO_GLYPH/);
  assert.match(runtime, /draw_message_glyph_at_impl\([^\n]+uint8_t isolated\)/);
  assert.match(runtime, /use_prev = isolated \? 0u : composer_prev_valid/);
  assert.match(runtime, /draw_message_indicator_glyph_at\([^\n]+\)[\s\S]*draw_message_glyph_at_impl\(glyph, col, row, 1u, 1u\)/);
  assert.match(runtime, /show_message_auto_indicator\(void\)[\s\S]*draw_message_indicator_glyph_at\(PCE_VN_MESSAGE_AUTO_GLYPH/);
  const clearGlyph = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT clear_message_glyph_area',
    'static uint8_t VN_HUCARD_CODE_TEXT draw_message_next_entry_impl',
  );
  assert.match(
    clearGlyph,
    /if \(col != VN_WAIT_CURSOR_COL \|\| row != VN_WAIT_CURSOR_ROW\)[\s\S]*composer_prev_valid = 0u/,
  );
  const glyphWidth = Number(runtime.match(/#define VN_GLYPH_W (\d+)u/)[1]);
  const waitCursorCol = Number(runtime.match(/#define VN_WAIT_CURSOR_COL (\d+)u/)[1]);
  const lastTextPixel = ((waitCursorCol - 1) * glyphWidth) + glyphWidth - 1;
  const waitCursorPixel = waitCursorCol * glyphWidth;
  assert.equal(waitCursorPixel % 8, 0);
  assert.equal(lastTextPixel >> 3, (waitCursorPixel >> 3) - 1);
  assert.doesNotMatch(runtime, /composer_prev_masks|composer_prev_cols|composer_prev_valid_rows/);
  assert.doesNotMatch(refresh, /advance_mode/);
  assert.doesNotMatch(tick, /advance_mode/);
});

test('HuCARD VN restores the blank tile after Full BG before an Input-driven scene transition', () => {
  const restore = sliceBetween(
    'static void VN_HUCARD_CODE_VIDEO restore_text_vram_after_full_screen_bg(void)\n{',
    'static uint16_t VN_HUCARD_CODE_TEXT vn_glyph_decode',
  );
  assert.match(
    restore,
    /if \(!full_screen_bg_text_vram_dirty \|\| current_scene_full_screen_bg\) return;/,
  );
  assert.match(
    restore,
    /upload_blank_tile\(\);[\s\S]*full_screen_bg_text_vram_dirty = 0u;/,
  );

  const setBackground = sliceBetween(
    'static void VN_HUCARD_CODE_VIDEO set_background',
    'static uint16_t VN_HUCARD_CODE_TEXT ui_tile',
  );
  const fadeOut = setBackground.indexOf('fade_palette(&old_bg->palette');
  const restoreBeforeUpload = setBackground.indexOf('restore_text_vram_after_full_screen_bg();');
  const upload = setBackground.indexOf('upload_bg_graphics(bg');
  assert.ok(fadeOut >= 0 && restoreBeforeUpload > fadeOut);
  assert.ok(upload > restoreBeforeUpload);
  assert.match(
    setBackground,
    /if \(current_scene_full_screen_bg\) full_screen_bg_text_vram_dirty = 1u;/,
  );

  const showScene = sliceBetween(
    'static void VN_HUCARD_CODE_SCRIPT show_scene(uint8_t scene_index)\n{',
    'static void VN_HUCARD_CODE_SCRIPT advance_story(void)\n{',
  );
  assert.match(
    showScene,
    /scene_pack_u8\(&active_scene_pack, VN_SCENE_PACK_OFFSET_FLAGS\)[\s\S]*PCE_VN_SCENE_FLAG_FULL_SCREEN_BG/,
  );

  const startMessage = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT start_message',
    'static void VN_HUCARD_CODE_TEXT finish_active_message',
  );
  assert.ok(
    startMessage.indexOf('restore_text_vram_after_full_screen_bg();')
      < startMessage.indexOf('begin_message_window_vram_update();'),
  );

  const drawChoice = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT draw_choice_options',
    'static void VN_HUCARD_CODE_TEXT update_choice_cursor',
  );
  assert.ok(
    drawChoice.indexOf('restore_text_vram_after_full_screen_bg();')
      < drawChoice.indexOf('begin_message_window_vram_update();'),
  );

  const mainLoop = runtime.slice(runtime.indexOf('int main(void)'));
  assert.match(
    mainLoop,
    /if \(async_input_mask && \(pressed & async_input_mask\)\)[\s\S]*if \(!current_scene_full_screen_bg\) hide_message_window_map\(\);[\s\S]*advance_story\(\);/,
  );
  assert.match(
    mainLoop,
    /if \(sync_input_mask\)[\s\S]*sync_input_mask = 0u;[\s\S]*if \(target != PCE_VN_NO_COMMAND\) current_command = target;[\s\S]*advance_story\(\);/,
  );
});

test('HuCARD VN skips only display-equivalent BG and Sprite commands', () => {
  const bgMatcher = sliceBetween(
    'static uint8_t VN_HUCARD_CODE_VIDEO background_display_matches',
    'static void VN_HUCARD_CODE_VIDEO set_background',
  );
  const setBackground = sliceBetween(
    'static void VN_HUCARD_CODE_VIDEO set_background',
    'static uint16_t VN_HUCARD_CODE_TEXT ui_tile',
  );
  const spriteMatcher = sliceBetween(
    'static uint8_t VN_HUCARD_CODE_SPRITE_STATE sprite_command_matches_display',
    'static void VN_HUCARD_CODE_SPRITE_STATE set_sprite',
  );
  const setSprite = sliceBetween(
    'static void VN_HUCARD_CODE_SPRITE_STATE set_sprite',
    'static void VN_HUCARD_CODE_SPRITE_STATE start_active_message_mouth',
  );
  const effect = sliceBetween(
    'static void VN_HUCARD_CODE_SCRIPT apply_effect',
    'static void VN_HUCARD_CODE_TEXT start_message',
  );

  assert.match(runtime, /static uint8_t current_bg_x __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(runtime, /static uint8_t current_bg_y __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(runtime, /static uint8_t current_bg_display_valid __attribute__\(\(section\("\.bss"\)\)\);/);
  assert.match(
    bgMatcher,
    /!current_bg_display_valid[\s\S]*current_bg_index != bg_index[\s\S]*current_bg_x != next_x[\s\S]*current_bg_y != next_y/,
  );
  assert.match(
    bgMatcher,
    /if \(current_scene_full_screen_bg\)[\s\S]*!full_screen_bg_text_vram_dirty[\s\S]*else if \(full_screen_bg_text_vram_dirty\)/,
  );

  const bgNoOp = setBackground.indexOf('if (background_display_matches(bg_index, tile_x, tile_y)) return;');
  const fade = setBackground.indexOf('fade_palette(&old_bg->palette');
  const upload = setBackground.indexOf('upload_bg_graphics(bg');
  assert.ok(bgNoOp >= 0 && bgNoOp < fade && bgNoOp < upload);
  assert.match(setBackground, /const uint8_t bg_fade_out_frames = fade_out_frames == 1u \? 0u : fade_out_frames;/);
  assert.match(setBackground, /const uint8_t bg_fade_in_frames = fade_in_frames == 1u \? 0u : fade_in_frames;/);
  assert.match(setBackground, /if \(fade_transition\) display_disable\(\);/);
  assert.match(setBackground, /fade_transition && bg_fade_in_frames \? 0u : 16u/);
  assert.match(
    setBackground,
    /display_enable\(\);[\s\S]*if \(bg_fade_in_frames\)[\s\S]*fade_palette\(&bg->palette, \(uint16_t\)\(bg->palette_bank \* 16u\), bg_fade_in_frames, 1u\);/,
  );
  assert.match(
    setBackground,
    /upload_bg_graphics\(bg,[\s\S]*next_x,[\s\S]*next_y,[\s\S]*current_bg_x = next_x;[\s\S]*current_bg_y = next_y;[\s\S]*current_bg_display_valid = 1u;/,
  );
  assert.match(
    effect,
    /if \(command->flags == PCE_VN_EFFECT_BLANK\)[\s\S]*clear_screen_map\(0\);[\s\S]*current_bg_display_valid = 0u;/,
  );

  assert.match(
    spriteMatcher,
    /state->asset_index != command->asset_index[\s\S]*state->animation_index != command->animation_index[\s\S]*state->x != command->x[\s\S]*state->y != command->y[\s\S]*state->flags != command->flags/,
  );
  assert.match(spriteMatcher, /sprite_moves\[slot\]\.active \|\| sync_sprite_move_slot == slot/);
  assert.match(spriteMatcher, /!state->satb_count \|\| !sprite_slot_pattern_valid\[slot\]/);
  assert.doesNotMatch(spriteMatcher, /state->frame|state->timer/);
  const spriteNoOp = setSprite.indexOf('if (sprite_command_matches_display(command)) return;');
  const cancelMove = setSprite.indexOf('cancel_sprite_move(slot);');
  const refresh = setSprite.indexOf('refresh_scene_sprites(upload_pattern_mask);');
  assert.ok(spriteNoOp >= 0 && spriteNoOp < cancelMove && spriteNoOp < refresh);
});

test('HuCARD VN message mouth uses the next ROW and restores it before input wait or interruption', () => {
  const startMessage = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT start_message',
    'static void VN_HUCARD_CODE_TEXT finish_active_message',
  );
  const refresh = sliceBetween(
    'static void VN_HUCARD_CODE_TEXT refresh_message_wait_indicator',
    'static void VN_HUCARD_CODE_TEXT tick_message_wait_indicator',
  );
  const beginMouth = sliceBetween(
    'static void VN_HUCARD_CODE_SPRITE_STATE start_active_message_mouth',
    'static void VN_HUCARD_CODE_SPRITE_STATE tick_sprites',
  );
  const restoreMouth = sliceBetween(
    'static void VN_HUCARD_CODE_SPRITE_STATE restore_active_message_mouth',
    'static void VN_HUCARD_CODE_TEXT refresh_message_wait_indicator',
  );
  const tickSprites = sliceBetween(
    'static void VN_HUCARD_CODE_SPRITE_STATE tick_sprites',
    'static void VN_HUCARD_CODE_TEXT upload_font_sprite_patterns',
  );
  const advance = runtime.slice(runtime.lastIndexOf('static void VN_HUCARD_CODE_SCRIPT advance_story(void)'));

  assert.match(startMessage, /instant_glyph_count = message\.instant_glyph_count;[\s\S]*start_active_message_mouth\(\);/);
  assert.match(
    beginMouth,
    /normal_animation_index \+ 1[\s\S]*mouth_animation_index >= pce_vn_sprite_animation_count[\s\S]*pce_vn_sprite_animations\[mouth_animation_index\]\.sprite_index != \(uint16_t\)state->asset_index/,
  );
  assert.match(
    restoreMouth,
    /state->animation_index != normal_animation_index \+ 1[\s\S]*state->animation_index = normal_animation_index;[\s\S]*sprite_animation_refresh_mask/,
  );
  assert.match(refresh, /active_message_index >= 0 && message_complete\) restore_active_message_mouth\(\);/);
  assert.match(tickSprites, /sprite_animation_refresh_mask[\s\S]*draw_sprite_slot\(slot, 0u\);[\s\S]*sprite_animation_refresh_mask = 0u;/);
  assert.match(advance, /advance_story\(void\)\s*\{\s*pce_vn_command_t command;\s*restore_active_message_mouth\(\);/);
  assert.match(runtime, /message->mouth_slot = scene_pack_s16\(cache, \(uint16_t\)\(offset \+ 8u\)\);/);
  assert.match(runtime, /message->instant_glyph_count = scene_pack_u8\(cache, \(uint16_t\)\(offset \+ 10u\)\);/);
});
