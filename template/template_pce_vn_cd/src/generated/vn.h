#ifndef PCE_EDITOR_GENERATED_VN_H
#define PCE_EDITOR_GENERATED_VN_H

#define PCE_VN_COMMAND_BACKGROUND 0u
#define PCE_VN_COMMAND_SPRITE 1u
#define PCE_VN_COMMAND_MESSAGE 2u
#define PCE_VN_COMMAND_AUDIO 3u
#define PCE_VN_COMMAND_PRELOAD 4u
#define PCE_VN_COMMAND_CHOICE 5u
#define PCE_VN_COMMAND_JUMP 6u
#define PCE_VN_COMMAND_WAIT 7u
#define PCE_VN_COMMAND_EFFECT 8u
#define PCE_VN_BG_TRANSITION_CUT 0u
#define PCE_VN_BG_TRANSITION_FADE 1u
#define PCE_VN_SPRITE_VISIBLE 1u
#define PCE_VN_SPRITE_FLIP_X 2u
#define PCE_VN_SPRITE_FLIP_Y 4u
#define PCE_VN_AUDIO_KIND_ADPCM 0u
#define PCE_VN_AUDIO_KIND_CDDA 1u
#define PCE_VN_AUDIO_ACTION_PLAY 16u
#define PCE_VN_AUDIO_ACTION_STOP 32u
#define PCE_VN_EFFECT_FADE_OUT 0u
#define PCE_VN_EFFECT_FADE_IN 1u
#define PCE_VN_EFFECT_BLANK 2u
#define PCE_VN_EFFECT_SHAKE 3u
#define PCE_VN_ADVANCE_BUTTON 0u
#define PCE_VN_ADVANCE_AUTO 1u

typedef struct {
  unsigned char sprite_index;
  unsigned char first_cell;
  unsigned char frame_count;
  unsigned char frame_delay;
  unsigned char frame_width_cells;
  unsigned char frame_height_cells;
  unsigned char frame_stride_cells;
  unsigned char loop;
} pce_vn_sprite_anim_t;

typedef struct {
  const unsigned char *glyphs;
  unsigned char glyph_count;
  signed char voice_index;
  unsigned char text_speed_frames;
  unsigned char advance_mode;
  unsigned char auto_wait_frames;
  signed char mouth_animation_index;
  unsigned char mouth_slot;
} pce_vn_message_t;

typedef struct {
  const unsigned char *glyphs;
  unsigned char glyph_count;
  signed char target_scene;
} pce_vn_choice_option_t;

typedef struct {
  const pce_vn_choice_option_t *options;
  unsigned char option_count;
  unsigned char default_index;
} pce_vn_choice_t;

typedef struct {
  unsigned char type;
  signed char asset_index;
  unsigned char slot;
  unsigned char flags;
  unsigned char arg0;
  unsigned char arg1;
  unsigned int x;
  unsigned int y;
  signed char message_index;
  signed char animation_index;
  signed char scene_index;
  signed char choice_index;
} pce_vn_command_t;

typedef struct {
  unsigned char command_start;
  unsigned char command_count;
  signed char next_scene;
} pce_vn_scene_t;

#define PCE_VN_FONT_TILE_BASE 712u
#define PCE_VN_CHOICE_CURSOR_GLYPH 1u
#define PCE_VN_GLYPH_END 0xffu

extern const unsigned char pce_vn_font_tiles[];
extern const unsigned char pce_vn_font_glyph_count;
void pce_vn_font_tiles_map(void);
extern const pce_vn_sprite_anim_t pce_vn_sprite_animations[];
extern const unsigned char pce_vn_sprite_animation_count;
extern const pce_vn_message_t pce_vn_messages[];
extern const unsigned char pce_vn_message_count;
extern const pce_vn_choice_t pce_vn_choices[];
extern const unsigned char pce_vn_choice_count;
extern const pce_vn_command_t pce_vn_commands[];
extern const unsigned char pce_vn_command_count;
extern const pce_vn_scene_t pce_vn_scenes[];
extern const unsigned char pce_vn_scene_count;
extern const unsigned char pce_vn_start_scene;

#endif
