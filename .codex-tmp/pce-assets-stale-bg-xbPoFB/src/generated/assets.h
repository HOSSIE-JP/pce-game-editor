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
  unsigned char frame;
  unsigned char second;
  unsigned char minute;
} pce_editor_cd_time_t;

typedef struct {
  pce_editor_cd_sector_t sector;
  unsigned int sector_count;
  unsigned int byte_size;
  unsigned char compression;
} pce_editor_cd_data_ref_t;

#define PCE_EDITOR_CD_COMPRESSION_NONE 0u
#define PCE_EDITOR_CD_COMPRESSION_RLE 1u

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
  const unsigned char *cell_map;
} pce_editor_sprite_asset_t;

typedef struct {
  unsigned char cell_width;
  unsigned char cell_height;
  unsigned char cell_columns;
  unsigned char cell_rows;
  unsigned int pattern_base;
  unsigned char palette_bank;
} pce_editor_sprite_draw_meta_t;

typedef struct __attribute__((packed)) {
  unsigned int step;
  unsigned char channel;
  unsigned int period;
  unsigned char volume;
  unsigned char noise;
  unsigned char reserved;
} pce_editor_psg_step_t;

typedef struct {
  unsigned char is_song;
  unsigned int period;
  unsigned int bpm;
  unsigned int steps;
  const pce_editor_psg_step_t *pattern;
  unsigned int pattern_count;
  const pce_editor_cd_data_ref_t *pattern_cd;
} pce_editor_psg_asset_t;

typedef struct {
  const unsigned char *data;
  unsigned long data_size;
  unsigned int sample_rate;
  unsigned int adpcm_address;
  unsigned char divider;
  unsigned char loop;
  unsigned char stream;
  const pce_editor_cd_data_ref_t *cd;
} pce_editor_adpcm_asset_t;

typedef struct {
  unsigned char track;
  unsigned char loop;
  pce_editor_cd_sector_t start_sector;
  pce_editor_cd_sector_t end_sector;
  pce_editor_cd_time_t end_time;
  unsigned int play_frames;
} pce_editor_cdda_asset_t;

/* CD on-demand metadata directory (see docs/pce-asset-meta-cd-ondemand.md). On
   CD builds the per-asset BG/sprite/ADPCM descriptors live in a CD data file as
   fixed-size, sector-aligned record slots; only this constant directory stays
   resident. Record N is at sector (region.sector + N / records_per_sector) and
   byte offset (N % records_per_sector) * slot. */
typedef struct {
  pce_editor_cd_sector_t sector;
  unsigned char count;
} pce_editor_meta_region_t;
/* BG/sprite records are packed images of the in-memory descriptor struct
   (pointer fields zeroed) followed by appendices holding palettes, CD refs,
   and sprite cell maps. ADPCM records keep the same fixed offsets but are
   decoded field-by-field so the CD metadata path does not depend on copying
   zeroed pointer slots back into a resident struct image. _Static_assert in
   the runtime locks this against struct drift. */
#define PCE_EDITOR_META_BG_SLOT 128u
#define PCE_EDITOR_META_BG_PALETTE 34u
#define PCE_EDITOR_META_BG_TILES_CD 66u
#define PCE_EDITOR_META_BG_MAP_CD 74u
#define PCE_EDITOR_META_SPRITE_SLOT 512u
#define PCE_EDITOR_META_SPR_PALETTE 29u
#define PCE_EDITOR_META_SPR_PATTERNS_CD 61u
#define PCE_EDITOR_META_SPR_CELL_MAP_LEN 69u
#define PCE_EDITOR_META_SPR_CELL_MAP 71u
#define PCE_EDITOR_META_ADPCM_SLOT 32u
#define PCE_EDITOR_META_ADPCM_DATA_SIZE 2u
#define PCE_EDITOR_META_ADPCM_SAMPLE_RATE 6u
#define PCE_EDITOR_META_ADPCM_ADDRESS 8u
#define PCE_EDITOR_META_ADPCM_DIVIDER 10u
#define PCE_EDITOR_META_ADPCM_LOOP 11u
#define PCE_EDITOR_META_ADPCM_STREAM 12u
#define PCE_EDITOR_META_ADPCM_CD 15u
/* 1 = descriptors stream from CD via pce_editor_*_meta (large projects);
   0 = descriptors resident in pce_editor_*_assets[] (small projects / HuCard).
   The runtime selects its accessor path on this; the unused path is DCE-dropped. */
#define PCE_EDITOR_ASSET_META_ON_CD 0
extern const pce_editor_meta_region_t pce_editor_bg_meta;
extern const pce_editor_meta_region_t pce_editor_sprite_meta;
extern const pce_editor_meta_region_t pce_editor_adpcm_meta;

extern const pce_editor_bg_asset_t pce_editor_bg_assets[];
extern const unsigned char pce_editor_bg_asset_count;
extern const pce_editor_sprite_asset_t pce_editor_sprite_assets[];
extern const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[];
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
