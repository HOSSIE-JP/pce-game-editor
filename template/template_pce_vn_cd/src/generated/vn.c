#if defined(__PCE_CD__)
#include <pce-cd.h>
PCE_RAM_BANK_AT(132, 6);
#define PCE_VN_DATA_SECTION __attribute__((section(".ram_bank132")))
#else
#define PCE_VN_DATA_SECTION
#endif

#include "vn.h"

const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_overlay_data = { { 64u, 0u, 0u }, 4u, 8192u };
const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_visual_code_data = { { 68u, 0u, 0u }, 4u, 8192u };
const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_cd_async_code_data = { { 72u, 0u, 0u }, 4u, 8192u };

void pce_vn_data_map(void)
{
#if defined(__PCE_CD__)
  pce_ram_bank132_map();
#endif
}

const pce_vn_sprite_anim_t PCE_VN_DATA_SECTION pce_vn_sprite_animations[] = {
  { 0u, 0u, 1u, 8u, 4u, 8u, 4u, 1u, (const unsigned char *)0 },
  { 0u, 0u, 2u, 14u, 4u, 8u, 4u, 1u, (const unsigned char *)0 },
  { 0u, 8u, 2u, 4u, 4u, 8u, 4u, 1u, (const unsigned char *)0 },
  { 1u, 0u, 1u, 8u, 4u, 8u, 4u, 1u, (const unsigned char *)0 },
  { 1u, 0u, 2u, 14u, 4u, 8u, 4u, 1u, (const unsigned char *)0 },
  { 1u, 8u, 2u, 4u, 4u, 8u, 4u, 1u, (const unsigned char *)0 }
};
const unsigned int PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = 6;

const signed int PCE_VN_DATA_SECTION pce_vn_variable_initial_values[] = {
  0,
  0,
  0
};
const unsigned char PCE_VN_DATA_SECTION pce_vn_variable_count = 3;

const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs[] = {
  { { 80u, 0u, 0u }, 1u, 937u, 1 },
  { { 95u, 0u, 0u }, 1u, 1278u, 2 },
  { { 113u, 0u, 0u }, 1u, 995u, 3 },
  { { 123u, 0u, 0u }, 1u, 475u, -1 }
};

const pce_vn_system_psg_package_t PCE_VN_DATA_SECTION pce_vn_system_psg_packages[] = {
  { { { 124u, 0u, 0u }, 1u, 41u }, 0u, 0u },
  { { { 125u, 0u, 0u }, 1u, 67u }, 1u, 1u },
  { { { 126u, 0u, 0u }, 1u, 67u }, 1u, 2u }
};
const unsigned int PCE_VN_DATA_SECTION pce_vn_system_psg_package_count = 3u;
const unsigned char PCE_VN_DATA_SECTION pce_vn_scene_count = 4;
const unsigned char PCE_VN_DATA_SECTION pce_vn_start_scene = 0u;
