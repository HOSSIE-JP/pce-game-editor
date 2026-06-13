#if defined(__PCE_CD__)
#define PCE_CONFIG_IMPLEMENTATION
#include <pce-cd.h>
#define PCE_EDITOR_BANKED_SECTION(name) __attribute__((section(name)))
#define PCE_EDITOR_RODATA_SECTION __attribute__((section(".rodata")))
#elif defined(__PCE__) && !defined(__CC65__) && !defined(PCE_EDITOR_TARGET_CD)
#define PCE_CONFIG_IMPLEMENTATION
#include <pce.h>
#define PCE_EDITOR_BANKED_SECTION(name) __attribute__((section(name)))
#define PCE_EDITOR_RODATA_SECTION __attribute__((section(".rodata")))
#else
#define PCE_EDITOR_BANKED_SECTION(name)
#define PCE_EDITOR_RODATA_SECTION
#endif

#include "assets.h"

static const unsigned char pce_editor_image_vn_classroom_bg_palette[] = {
  0x00, 0x00, 0x06, 0x01, 0x4e, 0x01, 0x8b, 0x00, 0x49, 0x00, 0x92, 0x00,
  0x41, 0x00, 0x8a, 0x00, 0x00, 0x00, 0x65, 0x01, 0xd3, 0x00, 0x23, 0x01,
  0x74, 0x01, 0x0d, 0x01, 0xbc, 0x01, 0x6c, 0x01
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_vn_classroom_bg_tiles_cd = { { 65u, 0u, 0u }, 9u };
#endif
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_vn_classroom_bg_map_cd = { { 74u, 0u, 0u }, 1u };
#endif

static const unsigned char pce_editor_image_rooftop_dusk_bg_palette[] = {
  0x00, 0x00, 0x52, 0x00, 0x4a, 0x00, 0x9b, 0x00, 0xab, 0x00, 0x3a, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_rooftop_dusk_bg_tiles_cd = { { 78u, 0u, 0u }, 9u };
#endif
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_rooftop_dusk_bg_map_cd = { { 87u, 0u, 0u }, 1u };
#endif

static const unsigned char pce_editor_sprite_akari_sprite_palette[] = {
  0x00, 0x00, 0x8a, 0x00, 0x41, 0x00, 0xfe, 0x01, 0x00, 0x00, 0x7c, 0x01,
  0x6e, 0x01, 0xb3, 0x00, 0xdc, 0x00, 0xa2, 0x00, 0x93, 0x00, 0x6d, 0x01,
  0xbd, 0x01, 0x33, 0x01, 0x00, 0x00, 0x00, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_sprite_akari_sprite_patterns_cd = { { 75u, 0u, 0u }, 2u };
#endif

static const unsigned char pce_editor_sprite_mika_sprite_palette[] = {
  0x00, 0x00, 0x0c, 0x01, 0xa9, 0x00, 0x82, 0x00, 0x0b, 0x01, 0xcb, 0x00,
  0x7c, 0x01, 0x59, 0x00, 0xc3, 0x00, 0x61, 0x00, 0x51, 0x00, 0xa1, 0x00,
  0xc2, 0x00, 0xfe, 0x01, 0xaa, 0x00, 0xf2, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_sprite_mika_sprite_patterns_cd = { { 88u, 0u, 0u }, 2u };
#endif

static const pce_editor_psg_step_t pce_editor_psg_vn_psg_chime_pattern[] = {
  { 0u, 0u, 512u, 12u },
  { 1u, 0u, 406u, 11u },
  { 2u, 0u, 342u, 10u },
  { 3u, 0u, 256u, 9u }
};

#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_adpcm_akari_voice_data_cd = { { 90u, 0u, 0u }, 2u };
#endif

const pce_editor_bg_asset_t pce_editor_bg_assets[] = {
  { { pce_editor_image_vn_classroom_bg_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 18432u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_vn_classroom_bg_tiles_cd }, { (const unsigned char *)0, 2048u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_vn_classroom_bg_map_cd }, 36u, 16u, 128u, 0u, 0u },
  { { pce_editor_image_rooftop_dusk_bg_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 18432u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_rooftop_dusk_bg_tiles_cd }, { (const unsigned char *)0, 2048u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_rooftop_dusk_bg_map_cd }, 36u, 16u, 128u, 0u, 0u }
};
const unsigned char pce_editor_bg_asset_count = 2;

const pce_editor_sprite_asset_t pce_editor_sprite_assets[] = {
  { { pce_editor_sprite_akari_sprite_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 4096u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_sprite_akari_sprite_patterns_cd }, 16u, 16u, 4u, 8u, 880u, 1u, 128u, 24u },
  { { pce_editor_sprite_mika_sprite_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 4096u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_sprite_mika_sprite_patterns_cd }, 16u, 16u, 4u, 8u, 880u, 1u, 128u, 24u }
};
const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[] = {
  { 16u, 16u, 4u, 8u, 880u, 1u },
  { 16u, 16u, 4u, 8u, 880u, 1u }
};
const unsigned char pce_editor_sprite_asset_count = 2;

const pce_editor_psg_asset_t pce_editor_psg_assets[] = {
  { 1u, 512u, 132u, 8u, pce_editor_psg_vn_psg_chime_pattern, 4u }
};
const unsigned char pce_editor_psg_asset_count = 1;

const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[] = {
  { (const unsigned char *)0, 2400u, 16000u, 0u, 14u, 0u, 0u, &pce_editor_adpcm_akari_voice_data_cd }
};
const unsigned char pce_editor_adpcm_asset_count = 1;

const pce_editor_cdda_asset_t pce_editor_cdda_assets[] = {
  { 2u, 1u, { 194u, 1u, 0u }, { 177u, 2u, 0u }, { 14u, 11u, 0u }, 190u }
};
const unsigned char pce_editor_cdda_asset_count = 1;

const char * const pce_editor_image_rows[] = {

};
const unsigned char pce_editor_image_row_count = 0;
const unsigned int pce_editor_tone_period = 512;

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
