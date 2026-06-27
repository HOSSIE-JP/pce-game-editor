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

const pce_editor_meta_region_t pce_editor_bg_meta PCE_EDITOR_RODATA_SECTION = { { 70u, 0u, 0u }, 1u };
const pce_editor_meta_region_t pce_editor_sprite_meta PCE_EDITOR_RODATA_SECTION = { { 71u, 0u, 0u }, 1u };
const pce_editor_meta_region_t pce_editor_adpcm_meta PCE_EDITOR_RODATA_SECTION = { { 72u, 0u, 0u }, 1u };

const unsigned char pce_editor_bg_asset_count PCE_EDITOR_RODATA_SECTION = 1;
const unsigned char pce_editor_sprite_asset_count PCE_EDITOR_RODATA_SECTION = 1;
const unsigned char pce_editor_adpcm_asset_count PCE_EDITOR_RODATA_SECTION = 1;

const pce_editor_psg_asset_t pce_editor_psg_assets[] PCE_EDITOR_RODATA_SECTION = {
  { 0u, 512u, 150u, 0u, (const pce_editor_psg_step_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 }
};
const unsigned char pce_editor_psg_asset_count PCE_EDITOR_RODATA_SECTION = 0;

const pce_editor_cdda_asset_t pce_editor_cdda_assets[] PCE_EDITOR_RODATA_SECTION = {
  { 3u, 0u, { 13u, 2u, 0u }, { 162u, 2u, 0u }, { 74u, 10u, 0u }, 118u },
  { 2u, 1u, { 194u, 1u, 0u }, { 12u, 2u, 0u }, { 74u, 8u, 0u }, 58u }
};
const unsigned char pce_editor_cdda_asset_count PCE_EDITOR_RODATA_SECTION = 2;

const char * const pce_editor_image_rows[] PCE_EDITOR_RODATA_SECTION = {

};
const unsigned char pce_editor_image_row_count PCE_EDITOR_RODATA_SECTION = 0;
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
