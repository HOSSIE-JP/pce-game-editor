#ifndef PCE_EDITOR_GENERATED_VN_H
#define PCE_EDITOR_GENERATED_VN_H

typedef struct {
  unsigned char sprite_index;
  unsigned int x;
  unsigned int y;
} pce_vn_character_t;

typedef struct {
  const unsigned char *glyphs;
  unsigned char glyph_count;
  signed char voice_index;
} pce_vn_message_t;

typedef struct {
  unsigned char bg_index;
  const pce_vn_character_t *characters;
  unsigned char character_count;
  unsigned char message_start;
  unsigned char message_count;
  unsigned char cdda_track;
  signed char next_scene;
} pce_vn_scene_t;

#define PCE_VN_FONT_TILE_BASE 712u
#define PCE_VN_GLYPH_END 0xffu

extern const unsigned char pce_vn_font_tiles[];
extern const unsigned char pce_vn_font_glyph_count;
extern const pce_vn_message_t pce_vn_messages[];
extern const unsigned char pce_vn_message_count;
extern const pce_vn_scene_t pce_vn_scenes[];
extern const unsigned char pce_vn_scene_count;
extern const unsigned char pce_vn_start_scene;

#endif
