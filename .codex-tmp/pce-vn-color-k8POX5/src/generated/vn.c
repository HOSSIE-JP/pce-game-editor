#if defined(__PCE_CD__)
#include <pce-cd.h>
PCE_RAM_BANK_AT(132, 6);
#define PCE_VN_FONT_SECTION __attribute__((section(".ram_bank132")))
#define PCE_VN_DATA_SECTION __attribute__((section(".ram_bank132")))
#else
#define PCE_VN_FONT_SECTION
#define PCE_VN_DATA_SECTION
#endif

#include "vn.h"

#if defined(__PCE_CD__)
const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_font_data = { { 64u, 0u, 0u }, 1u, 96u };
const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_overlay_data = { { 0u, 0u, 0u }, 0u, 0u };
#else
const unsigned char PCE_VN_FONT_SECTION pce_vn_font_tiles[] = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x10, 0x00, 0x1c, 0x00, 0x0f, 0x80, 0x03, 0x80, 0x03, 0x00, 0x0f, 0x00, 0x1c,
  0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x08, 0xc0, 0x7f,
  0x00, 0x08, 0xc0, 0x1f, 0xe0, 0x3d, 0x20, 0x6b, 0x60, 0x4e, 0xe0, 0x7d, 0xc0, 0x7f,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0xc0, 0x18, 0x40, 0x7f, 0x60, 0x13, 0x20, 0x11,
  0x30, 0x31, 0x00, 0x31, 0x00, 0x23, 0x00, 0x63, 0x00, 0x4e, 0x00, 0x00
};
#endif
const unsigned int PCE_VN_DATA_SECTION pce_vn_font_glyph_count = 4u;

void pce_vn_font_tiles_map(void)
{
#if defined(__PCE_CD__)
  pce_ram_bank132_map();
#endif
}

#if defined(__PCE_CD__)
const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_font_sprite_data = { { 0u, 0u, 0u }, 0u, 0u };
#else
const unsigned char PCE_VN_FONT_SECTION pce_vn_font_sprite_tiles[] = { 0u };
#endif
const unsigned char PCE_VN_DATA_SECTION pce_vn_font_sprite_glyph_count = 0u;

const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations[] = {
  { 0u, 0u, 1u, 8u, 1u, 1u, 1u, 1u, (const unsigned char *)0 }
};
const unsigned char PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = 0;

const signed int PCE_VN_DATA_SECTION pce_vn_variable_initial_values[] = {
  0
};
const unsigned char PCE_VN_DATA_SECTION pce_vn_variable_count = 0;

const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs[] = {
  { { 65u, 0u, 0u }, 1u, 88u, -1 }
};
const unsigned char PCE_VN_DATA_SECTION pce_vn_scene_count = 1;
const unsigned char PCE_VN_DATA_SECTION pce_vn_start_scene = 0u;
