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
const pce_vn_cd_data_ref_t PCE_VN_DATA_SECTION pce_vn_logic_overlay_data = { { 0u, 0u, 0u }, 0u, 0u };

void pce_vn_data_map(void)
{
#if defined(__PCE_CD__)
  pce_ram_bank132_map();
#endif
}

const pce_editor_meta_region_t PCE_VN_DATA_SECTION pce_vn_sprite_animation_meta = { { 124u, 0u, 0u }, 6u };
const unsigned int PCE_VN_DATA_SECTION pce_vn_sprite_animation_count = 6;

const signed int PCE_VN_DATA_SECTION pce_vn_variable_initial_values[] = {
  0,
  0,
  0,
  0,
  0
};
const unsigned char PCE_VN_DATA_SECTION pce_vn_variable_count = 5;

const pce_vn_scene_pack_t PCE_VN_DATA_SECTION pce_vn_scene_packs[] = {
  { { 80u, 0u, 0u }, 1u, 910u, 1 },
  { { 95u, 0u, 0u }, 1u, 1278u, 2 },
  { { 113u, 0u, 0u }, 1u, 995u, 3 },
  { { 123u, 0u, 0u }, 1u, 452u, -1 }
};

const pce_editor_meta_region_t PCE_VN_DATA_SECTION pce_vn_system_psg_meta = { { 125u, 0u, 0u }, 3u };
const unsigned int PCE_VN_DATA_SECTION pce_vn_system_psg_package_count = 3u;
const unsigned char PCE_VN_DATA_SECTION pce_vn_scene_count = 4;
const unsigned char PCE_VN_DATA_SECTION pce_vn_start_scene = 0u;
