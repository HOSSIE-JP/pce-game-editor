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

static const unsigned char pce_editor_image_vn_classroom_bg_palette[] = {
  0x00, 0x00, 0x06, 0x01, 0x4e, 0x01, 0x49, 0x00, 0x8b, 0x00, 0x92, 0x00,
  0x41, 0x00, 0x8a, 0x00, 0x65, 0x01, 0x00, 0x00, 0x74, 0x01, 0x0d, 0x01,
  0xbc, 0x01, 0x01, 0x00, 0xd3, 0x00, 0xdb, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_vn_classroom_bg_tiles_cd PCE_EDITOR_CD_REF_SECTION = { { 70u, 0u, 0u }, 7u, 13269u, 1u };
#endif
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_vn_classroom_bg_map_cd PCE_EDITOR_CD_REF_SECTION = { { 77u, 0u, 0u }, 1u, 996u, 1u };
#endif

static const unsigned char pce_editor_image_rooftop_dusk_bg_palette[] = {
  0x00, 0x00, 0x52, 0x00, 0x4a, 0x00, 0x9b, 0x00, 0xab, 0x00, 0x3a, 0x01,
  0x93, 0x00, 0xa3, 0x00, 0xf2, 0x00, 0xb3, 0x00, 0xfa, 0x00, 0x53, 0x00,
  0xea, 0x00, 0x92, 0x00, 0x5a, 0x00, 0xaa, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_rooftop_dusk_bg_tiles_cd PCE_EDITOR_CD_REF_SECTION = { { 106u, 0u, 0u }, 5u, 10235u, 1u };
#endif
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_rooftop_dusk_bg_map_cd PCE_EDITOR_CD_REF_SECTION = { { 111u, 0u, 0u }, 1u, 996u, 1u };
#endif

static const unsigned char pce_editor_image_command_lab_bg_palette[] = {
  0x00, 0x00, 0x01, 0x00, 0x4a, 0x00, 0x52, 0x00, 0x8b, 0x00, 0xbc, 0x01,
  0x5e, 0x01, 0xcb, 0x00, 0x32, 0x01, 0xdb, 0x00, 0x5c, 0x01, 0xa2, 0x00,
  0xb6, 0x01, 0xfd, 0x01, 0x00, 0x00, 0x00, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_command_lab_bg_tiles_cd PCE_EDITOR_CD_REF_SECTION = { { 88u, 0u, 0u }, 5u, 10056u, 1u };
#endif
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_image_command_lab_bg_map_cd PCE_EDITOR_CD_REF_SECTION = { { 93u, 0u, 0u }, 1u, 996u, 1u };
#endif

static const unsigned char pce_editor_sprite_akari_sprite_palette[] = {
  0x00, 0x00, 0x8a, 0x00, 0x41, 0x00, 0xfe, 0x01, 0x00, 0x00, 0x7c, 0x01,
  0x6e, 0x01, 0xdc, 0x00, 0xb3, 0x00, 0x93, 0x00, 0xa2, 0x00, 0x6d, 0x01,
  0xbd, 0x01, 0x33, 0x01, 0x00, 0x00, 0x00, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_sprite_akari_sprite_patterns_cd PCE_EDITOR_CD_REF_SECTION = { { 78u, 0u, 0u }, 7u, 13032u, 1u };
#endif

static const unsigned char pce_editor_sprite_mika_sprite_palette[] = {
  0x00, 0x00, 0x0c, 0x01, 0xa9, 0x00, 0x82, 0x00, 0x0b, 0x01, 0xcb, 0x00,
  0x7c, 0x01, 0xc3, 0x00, 0x59, 0x00, 0x33, 0x01, 0x51, 0x00, 0x61, 0x00,
  0xa1, 0x00, 0xc2, 0x00, 0xfe, 0x01, 0xaa, 0x00
};
#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_sprite_mika_sprite_patterns_cd PCE_EDITOR_CD_REF_SECTION = { { 94u, 0u, 0u }, 6u, 11740u, 1u };
#endif

static const pce_editor_psg_step_t pce_editor_psg_vn_psg_chime_pattern[] = {
  { 0u, 0u, 512u, 12u, 0u, 0u },
  { 1u, 0u, 406u, 11u, 0u, 0u },
  { 2u, 0u, 342u, 10u, 0u, 0u },
  { 3u, 0u, 256u, 9u, 0u, 0u }
};

static const pce_editor_psg_step_t pce_editor_psg_vn_psg_confirm_pattern[] = {
  { 0u, 0u, 512u, 13u, 0u, 0u },
  { 1u, 0u, 406u, 12u, 0u, 0u },
  { 2u, 0u, 342u, 10u, 0u, 0u },
  { 3u, 1u, 256u, 8u, 0u, 0u },
  { 4u, 0u, 342u, 6u, 0u, 0u },
  { 5u, 1u, 512u, 4u, 0u, 0u }
};

#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_adpcm_akari_voice_data_cd PCE_EDITOR_CD_REF_SECTION = { { 85u, 0u, 0u }, 2u, 2400u, 0u };
#endif

#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_adpcm_mika_voice_data_cd PCE_EDITOR_CD_REF_SECTION = { { 102u, 0u, 0u }, 3u, 5280u, 0u };
#endif

#if defined(__PCE_CD__)
static const pce_editor_cd_data_ref_t pce_editor_adpcm_guide_voice_data_cd PCE_EDITOR_CD_REF_SECTION = { { 100u, 0u, 0u }, 2u, 3840u, 0u };
#endif

const pce_editor_bg_asset_t pce_editor_bg_assets[] = {
  { { pce_editor_image_vn_classroom_bg_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 15232u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_vn_classroom_bg_tiles_cd }, { (const unsigned char *)0, 1088u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_vn_classroom_bg_map_cd }, 28u, 17u, 64u, 0u, 0u },
  { { pce_editor_image_rooftop_dusk_bg_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 15232u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_rooftop_dusk_bg_tiles_cd }, { (const unsigned char *)0, 1088u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_rooftop_dusk_bg_map_cd }, 28u, 17u, 64u, 0u, 0u },
  { { pce_editor_image_command_lab_bg_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 15232u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_command_lab_bg_tiles_cd }, { (const unsigned char *)0, 1088u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_image_command_lab_bg_map_cd }, 28u, 17u, 64u, 0u, 0u }
};
const unsigned char pce_editor_bg_asset_count = 3;

const pce_editor_sprite_asset_t pce_editor_sprite_assets[] = {
  { { pce_editor_sprite_akari_sprite_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 16384u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_sprite_akari_sprite_patterns_cd }, 16u, 16u, 16u, 8u, 704u, 1u, 128u, 24u },
  { { pce_editor_sprite_mika_sprite_palette, 32u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 16384u, (const pce_editor_data_chunk_t *)0, 0u, &pce_editor_sprite_mika_sprite_patterns_cd }, 16u, 16u, 16u, 8u, 704u, 1u, 128u, 24u }
};
const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[] = {
  { 16u, 16u, 16u, 8u, 704u, 1u },
  { 16u, 16u, 16u, 8u, 704u, 1u }
};
const unsigned char pce_editor_sprite_asset_count = 2;

const pce_editor_psg_asset_t pce_editor_psg_assets[] = {
  { 1u, 512u, 132u, 8u, pce_editor_psg_vn_psg_chime_pattern, 4u, (const pce_editor_cd_data_ref_t *)0 },
  { 0u, 512u, 180u, 8u, pce_editor_psg_vn_psg_confirm_pattern, 6u, (const pce_editor_cd_data_ref_t *)0 }
};
const unsigned char pce_editor_psg_asset_count = 2;

const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[] = {
  { (const unsigned char *)0, 2400ul, 16000u, 0u, 14u, 0u, 0u, &pce_editor_adpcm_akari_voice_data_cd },
  { (const unsigned char *)0, 5280ul, 16000u, 0u, 14u, 0u, 0u, &pce_editor_adpcm_mika_voice_data_cd },
  { (const unsigned char *)0, 3840ul, 16000u, 0u, 14u, 0u, 0u, &pce_editor_adpcm_guide_voice_data_cd }
};
const unsigned char pce_editor_adpcm_asset_count = 3;

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
