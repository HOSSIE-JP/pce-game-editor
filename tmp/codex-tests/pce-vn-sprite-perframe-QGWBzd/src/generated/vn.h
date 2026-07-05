#ifndef PCE_EDITOR_GENERATED_VN_H
#define PCE_EDITOR_GENERATED_VN_H

#define PCE_VN_COMMAND_BACKGROUND 0u
#define PCE_VN_COMMAND_SPRITE 1u
#define PCE_VN_COMMAND_MESSAGE 2u
#define PCE_VN_COMMAND_AUDIO 3u
#define PCE_VN_COMMAND_CHOICE 4u
#define PCE_VN_COMMAND_JUMP 5u
#define PCE_VN_COMMAND_WAIT 6u
#define PCE_VN_COMMAND_EFFECT 7u
#define PCE_VN_COMMAND_VARIABLE 8u
#define PCE_VN_COMMAND_IF 9u
#define PCE_VN_COMMAND_SWITCH 10u
#define PCE_VN_COMMAND_LABEL 11u
#define PCE_VN_COMMAND_GOTO 12u
#define PCE_VN_COMMAND_INPUTCHECK 13u
#define PCE_VN_COMMAND_SPRITETEXT 14u
#define PCE_VN_COMMAND_CACHE 15u
#define PCE_VN_CACHE_ACTION_CLEAR 0u
#define PCE_VN_CACHE_ACTION_LOAD 1u
#define PCE_VN_CACHE_SCOPE_VISUAL 0u
#define PCE_VN_CACHE_SCOPE_BG 1u
#define PCE_VN_CACHE_SCOPE_SPRITE 2u
#define PCE_VN_CACHE_SCOPE_ADPCM 3u
#define PCE_VN_CACHE_SCOPE_ALL 4u
#define PCE_VN_BG_TRANSITION_CUT 0u
#define PCE_VN_BG_TRANSITION_FADE 1u
#define PCE_VN_SPRITE_VISIBLE 1u
#define PCE_VN_SPRITE_FLIP_X 2u
#define PCE_VN_SPRITE_FLIP_Y 4u
#define PCE_VN_AUDIO_KIND_ADPCM 0u
#define PCE_VN_AUDIO_KIND_CDDA 1u
#define PCE_VN_AUDIO_KIND_PSG 2u
#define PCE_VN_AUDIO_ACTION_PLAY 16u
#define PCE_VN_AUDIO_ACTION_STOP 32u
#define PCE_VN_INPUT_MODE_SYNC 0u
#define PCE_VN_INPUT_MODE_ASYNC 1u
#define PCE_VN_INPUT_MODE_CANCEL 2u
#define PCE_VN_MESSAGE_COLOR_NONE 65535u
#define PCE_VN_EFFECT_FADE_OUT 0u
#define PCE_VN_EFFECT_FADE_IN 1u
#define PCE_VN_EFFECT_BLANK 2u
#define PCE_VN_EFFECT_SHAKE 3u
#define PCE_VN_EFFECT_FLASH 4u
#define PCE_VN_ADVANCE_BUTTON 0u
#define PCE_VN_ADVANCE_AUTO 1u
#define PCE_VN_VAR_OP_DEFINE 0u
#define PCE_VN_VAR_OP_SET 1u
#define PCE_VN_VAR_OP_ADD 2u
#define PCE_VN_VAR_OP_SUB 3u
#define PCE_VN_VAR_OP_RANDOM 4u
#define PCE_VN_COMPARE_EQ 0u
#define PCE_VN_COMPARE_NE 1u
#define PCE_VN_COMPARE_LT 2u
#define PCE_VN_COMPARE_LTE 3u
#define PCE_VN_COMPARE_GT 4u
#define PCE_VN_COMPARE_GTE 5u
#define PCE_VN_NO_COMMAND 65535u
#define PCE_VN_SCENE_FLAG_FULL_SCREEN_BG 1u
#define PCE_VN_HAS_FULL_SCREEN_BG 0u
#define PCE_VN_HAS_SPRITE_ANIMATIONS 1u
#define PCE_VN_HAS_SPRITETEXT 0u
#define PCE_VN_VARIABLE_STORAGE_COUNT 1u
#define PCE_VN_SCENE_PACK_CACHE_BYTES 4096u
#define PCE_VN_SCENE_PACK_VERSION 1u
#define PCE_VN_SCENE_PACK_HEADER_SIZE 20u
#define PCE_VN_SCENE_PACK_COMMAND_SIZE 19u
#define PCE_VN_SCENE_PACK_MESSAGE_SIZE 13u
#define PCE_VN_SCENE_PACK_CHOICE_SIZE 6u
#define PCE_VN_SCENE_PACK_OPTION_SIZE 7u
#define PCE_VN_SCENE_PACK_SWITCH_SIZE 5u
#define PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE 4u

typedef struct {
  unsigned int sprite_index;
  unsigned char first_cell;
  unsigned char frame_count;
  unsigned char frame_delay;
  unsigned char frame_width_cells;
  unsigned char frame_height_cells;
  unsigned char frame_stride_cells;
  unsigned char loop;
  const unsigned char *frame_delays;
} pce_vn_sprite_anim_t;

typedef struct {
  const unsigned char *glyphs;
  unsigned char glyph_count;
  signed int voice_index;
  unsigned char text_speed_frames;
  unsigned char advance_mode;
  unsigned char auto_wait_frames;
  signed int mouth_animation_index;
  unsigned char mouth_slot;
  unsigned int text_color;
} pce_vn_message_t;

typedef struct {
  const unsigned char *glyphs;
  unsigned char glyph_count;
  signed int value;
  signed int target_scene;
} pce_vn_choice_option_t;

typedef struct {
  unsigned int options_offset;
  unsigned char option_count;
  unsigned char default_index;
  signed int variable_index;
} pce_vn_choice_t;

typedef struct {
  signed int value;
  unsigned int command;
} pce_vn_switch_case_t;

typedef struct {
  unsigned int cases_offset;
  unsigned char case_count;
  unsigned int default_command;
} pce_vn_switch_t;

typedef struct {
  unsigned char type;
  signed int asset_index;
  unsigned char slot;
  unsigned char flags;
  unsigned char arg0;
  unsigned char arg1;
  unsigned int x;
  unsigned int y;
  signed int message_index;
  signed int animation_index;
  signed int scene_index;
  signed int choice_index;
} pce_vn_command_t;

typedef struct {
  unsigned char lo;
  unsigned char md;
  unsigned char hi;
} pce_vn_cd_sector_t;

typedef struct {
  pce_vn_cd_sector_t sector;
  unsigned int sector_count;
  unsigned int byte_size;
} pce_vn_cd_data_ref_t;

typedef struct {
  pce_vn_cd_sector_t sector;
  unsigned int sector_count;
  unsigned int byte_size;
  signed int next_scene;
} pce_vn_scene_pack_t;

#define PCE_VN_FONT_TILE_BASE 540u
#define PCE_VN_CHOICE_CURSOR_GLYPH 1u
#define PCE_VN_MESSAGE_WAIT_GLYPH 2u
#define PCE_VN_GLYPH_END 0xffffu
#define PCE_VN_GLYPH_NEWLINE 0xfffeu
#define PCE_VN_GLYPH_ESCAPE 0xfdu
#define PCE_VN_FONT_SPRITE_PATTERN_BASE 376u
#define PCE_VN_FONT_SPRITE_PALETTE_BANK 15u
#define PCE_VN_SPRITE_PATTERN_BASE 376u

#if defined(__PCE_CD__)
extern const pce_vn_cd_data_ref_t pce_vn_font_data;
#define PCE_VN_OVERLAY_LOAD_ADDR 32768u
extern const pce_vn_cd_data_ref_t pce_vn_overlay_data;
#define PCE_VN_VISUAL_CODE_LOAD_ADDR 32768u
extern const pce_vn_cd_data_ref_t pce_vn_visual_code_data;
#else
extern const unsigned char pce_vn_font_tiles[];
#endif
extern const unsigned int pce_vn_font_glyph_count;
void pce_vn_font_tiles_map(void);
#if defined(__PCE_CD__)
extern const pce_vn_cd_data_ref_t pce_vn_font_sprite_data;
#else
extern const unsigned char pce_vn_font_sprite_tiles[];
#endif
extern const unsigned char pce_vn_font_sprite_glyph_count;
extern const pce_vn_sprite_anim_t pce_vn_sprite_animations[];
extern const unsigned int pce_vn_sprite_animation_count;
extern const signed int pce_vn_variable_initial_values[];
extern const unsigned char pce_vn_variable_count;
extern const pce_vn_scene_pack_t pce_vn_scene_packs[];
extern const unsigned char pce_vn_scene_count;
extern const unsigned char pce_vn_start_scene;

#endif
