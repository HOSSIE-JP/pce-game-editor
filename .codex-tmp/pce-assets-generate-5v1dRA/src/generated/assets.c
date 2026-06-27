#if defined(__PCE_CD__)
#define PCE_CONFIG_IMPLEMENTATION
#include <pce-cd.h>
#define PCE_EDITOR_BANKED_SECTION(name) __attribute__((section(name)))
#define PCE_EDITOR_CD_REF_SECTION __attribute__((section(".ram_bank132")))
#define PCE_EDITOR_RODATA_SECTION __attribute__((section(".rodata")))
#elif defined(__PCE__) && !defined(__CC65__) && !defined(PCE_EDITOR_TARGET_CD)
#define PCE_CONFIG_IMPLEMENTATION
#include <pce.h>
#define PCE_EDITOR_BANKED_SECTION(name) __attribute__((section(name)))
#define PCE_EDITOR_RODATA_SECTION __attribute__((section(".rodata")))
#define PCE_EDITOR_CD_REF_SECTION PCE_EDITOR_RODATA_SECTION
#else
#define PCE_EDITOR_BANKED_SECTION(name)
#define PCE_EDITOR_CD_REF_SECTION
#define PCE_EDITOR_RODATA_SECTION
#endif

#include "assets.h"

static const pce_editor_psg_step_t pce_editor_psg_beep_pattern[] PCE_EDITOR_RODATA_SECTION = {
  { 0u, 0u, 512u, 20u, 0u, 0u },
  { 2u, 1u, 1024u, 12u, 0u, 0u },
  { 3u, 4u, 5u, 16u, 1u, 0u }
};

static const unsigned char pce_editor_image_bg_palette[] PCE_EDITOR_RODATA_SECTION = {
  0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07,
  0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07,
  0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07, 0x07
};
static const unsigned char pce_editor_image_bg_tiles[] PCE_EDITOR_RODATA_SECTION = {
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
  0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
  0x11, 0x11, 0x11, 0x11
};
static const unsigned char pce_editor_image_bg_map[] PCE_EDITOR_RODATA_SECTION = {
  0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22
};

static const unsigned char pce_editor_sprite_spr_palette[] PCE_EDITOR_RODATA_SECTION = {
  0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
  0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
  0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03
};
static const unsigned char pce_editor_sprite_spr_patterns[] PCE_EDITOR_RODATA_SECTION = {
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
  0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44
};

static const unsigned char pce_editor_adpcm_voice_data[] PCE_EDITOR_RODATA_SECTION = {
  0x01, 0x02, 0x03, 0x04
};

const pce_editor_bg_asset_t pce_editor_bg_assets[] PCE_EDITOR_RODATA_SECTION = {
  { { pce_editor_image_bg_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { pce_editor_image_bg_tiles, 64u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { pce_editor_image_bg_map, 8u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, 2u, 2u, 64u, 0u, 0u }
};
const unsigned char pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const pce_editor_sprite_asset_t pce_editor_sprite_assets[] PCE_EDITOR_RODATA_SECTION = {
  { { pce_editor_sprite_spr_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { pce_editor_sprite_spr_patterns, 128u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, 16u, 16u, 1u, 1u, 384u, 0u, 144u, 104u, (const unsigned char *)0 }
};
const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[] PCE_EDITOR_RODATA_SECTION = {
  { 16u, 16u, 1u, 1u, 384u, 0u }
};
const unsigned char pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[] PCE_EDITOR_RODATA_SECTION = {
  { pce_editor_adpcm_voice_data, 4ul, 16000u, 0u, 14u, 0u, 0u, (const pce_editor_cd_data_ref_t *)0 }
};
const unsigned char pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const pce_editor_psg_asset_t pce_editor_psg_assets[] PCE_EDITOR_RODATA_SECTION = {
  { 0u, 512u, 150u, 16u, pce_editor_psg_beep_pattern, 3u, (const pce_editor_cd_data_ref_t *)0 }
};
const unsigned char pce_editor_psg_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const pce_editor_cdda_asset_t pce_editor_cdda_assets[] PCE_EDITOR_RODATA_SECTION = {
  { 2u, 0u, { 0u, 0u, 0u }, { 0u, 0u, 0u }, { 0u, 2u, 0u }, 0u }
};
const unsigned char pce_editor_cdda_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const char * const pce_editor_image_rows[] PCE_EDITOR_RODATA_SECTION = {
  "IMAGE FILE MISSING"
};
const unsigned char pce_editor_image_row_count PCE_EDITOR_RODATA_SECTION = 1;
const unsigned int pce_editor_tone_period PCE_EDITOR_RODATA_SECTION = 512;

void pce_editor_map_asset_bank(unsigned char bank)
{
#if defined(__PCE__) && !defined(__CC65__)
  switch (bank) {
    default: break;
  }
#else
  (void)bank;
#endif
}
unsigned char pce_editor_cc65_bss_anchor;
