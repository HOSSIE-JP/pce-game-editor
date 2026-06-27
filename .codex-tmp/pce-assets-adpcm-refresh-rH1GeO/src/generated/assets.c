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

static const unsigned char pce_editor_adpcm_voice_data[] PCE_EDITOR_RODATA_SECTION = {
  0xf7, 0xf7, 0xf6, 0xc3, 0x7e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e,
  0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e,
  0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e, 0x6e
};

const pce_editor_bg_asset_t pce_editor_bg_assets[] PCE_EDITOR_RODATA_SECTION = {
  { { (const unsigned char *)0, 0u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 0u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 0u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, 0u, 0u, 0u, 0u, 0u }
};
const unsigned char pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = 0;

const pce_editor_sprite_asset_t pce_editor_sprite_assets[] PCE_EDITOR_RODATA_SECTION = {
  { { (const unsigned char *)0, 0u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, { (const unsigned char *)0, 0u, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }, 0u, 0u, 0u, 0u, 0u, 0u }
};
const pce_editor_sprite_draw_meta_t pce_editor_sprite_draw_meta[] PCE_EDITOR_RODATA_SECTION = {
  { 16u, 16u, 1u, 1u, 384u, 0u }
};
const unsigned char pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = 0;

const pce_editor_adpcm_asset_t pce_editor_adpcm_assets[] PCE_EDITOR_RODATA_SECTION = {
  { pce_editor_adpcm_voice_data, 32ul, 8000u, 0u, 12u, 0u, 0u, (const pce_editor_cd_data_ref_t *)0 }
};
const unsigned char pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const pce_editor_psg_asset_t pce_editor_psg_assets[] PCE_EDITOR_RODATA_SECTION = {
  { 0u, 512u, 150u, 0u, (const pce_editor_psg_step_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }
};
const unsigned char pce_editor_psg_asset_count PCE_EDITOR_RODATA_SECTION = 0;

const pce_editor_cdda_asset_t pce_editor_cdda_assets[] PCE_EDITOR_RODATA_SECTION = {
  { 0u, 0u, { 0u, 0u, 0u }, { 0u, 0u, 0u }, { 0u, 0u, 0u }, 0u }
};
const unsigned char pce_editor_cdda_asset_count PCE_EDITOR_RODATA_SECTION = 0;

const char * const pce_editor_image_rows[] PCE_EDITOR_RODATA_SECTION = {
  "NO IMAGE ASSET"
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
