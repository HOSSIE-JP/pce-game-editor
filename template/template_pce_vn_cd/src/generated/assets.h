#ifndef PCE_EDITOR_GENERATED_ASSETS_H
#define PCE_EDITOR_GENERATED_ASSETS_H

typedef struct {
  unsigned char bank;
  const unsigned char *data;
  unsigned int size;
} pce_editor_data_chunk_t;

typedef struct {
  unsigned char lo;
  unsigned char md;
  unsigned char hi;
} pce_editor_cd_sector_t;

typedef struct {
  pce_editor_cd_sector_t sector;
  unsigned int sector_count;
} pce_editor_cd_data_ref_t;

typedef struct {
  const unsigned char *data;
  unsigned int size;
  const pce_editor_data_chunk_t *chunks;
  unsigned char chunk_count;
  const pce_editor_cd_data_ref_t *cd;
} pce_editor_data_ref_t;

typedef struct {
  pce_editor_data_ref_t palette;
  pce_editor_data_ref_t tiles;
  pce_editor_data_ref_t map;
  unsigned char width_tiles;
  unsigned char height_tiles;
  unsigned int tile_base;
  unsigned int map_base;
  unsigned char palette_bank;
} pce_editor_bg_asset_t;

typedef struct {
  pce_editor_data_ref_t palette;
  pce_editor_data_ref_t patterns;
  unsigned char cell_width;
  unsigned char cell_height;
  unsigned char cell_columns;
  unsigned char cell_rows;
  unsigned int pattern_base;
  unsigned char palette_bank;
  unsigned char x;
  unsigned char y;
} pce_editor_sprite_asset_t;

typedef struct {
  unsigned char step;
  unsigned char channel;
  unsigned int period;
  unsigned char volume;
} pce_editor_psg_step_t;

typedef struct {
  const char *id;
  unsigned char is_song;
  unsigned int period;
  unsigned int bpm;
  unsigned int steps;
  const pce_editor_psg_step_t *pattern;
  unsigned int pattern_count;
} pce_editor_psg_asset_t;

typedef struct {
  const char *id;
  const unsigned char *data;
  unsigned int data_size;
  unsigned int sample_rate;
  unsigned int adpcm_address;
  unsigned char divider;
  unsigned char loop;
  const pce_editor_cd_data_ref_t *cd;
} pce_editor_adpcm_asset_t;

typedef struct {
  const char *id;
  unsigned char track;
  unsigned char loop;
} pce_editor_cdda_asset_t;

extern const pce_editor_bg_asset_t pce_editor_bg_assets[];
extern const unsigned char pce_editor_bg_asset_count;
extern const pce_editor_sprite_asset_t pce_editor_sprite_assets[];
extern const unsigned char pce_editor_sprite_asset_count;
extern const pce_editor_psg_asset_t pce_editor_psg_assets[];
extern const unsigned char pce_editor_psg_asset_count;
extern const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[];
extern const unsigned char pce_editor_adpcm_asset_count;
extern const pce_editor_cdda_asset_t pce_editor_cdda_assets[];
extern const unsigned char pce_editor_cdda_asset_count;
extern const char * const pce_editor_image_rows[];
extern const unsigned char pce_editor_image_row_count;
extern const unsigned int pce_editor_tone_period;
void pce_editor_map_asset_bank(unsigned char bank);

#endif
