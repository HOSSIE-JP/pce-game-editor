#include <stdint.h>

#if defined(__PCE_CD__)
#define PCE_CONFIG_IMPLEMENTATION
#endif
#if defined(__PCE__)
#include <pce.h>
#endif
#if defined(__PCE_CD__)
#include <pce-cd.h>
PCE_RAM_BANK_AT(128, 2);
PCE_RAM_BANK_AT(129, 3);
PCE_RAM_BANK_AT(130, 4);
PCE_CDB_USE_GRAPHICS_DRIVER(0);
#endif

#include "generated/assets.h"
#include "generated/vn.h"

#define PAD_I 0x01u
#define PAD_II 0x02u
#define PAD_SEL 0x04u
#define PAD_RUN 0x08u
#define PAD_UP 0x10u
#define PAD_RIGHT 0x20u
#define PAD_DOWN 0x40u
#define PAD_LEFT 0x80u

#define PCE_VCE_ADDR_LO (*(volatile uint8_t *)0x0402)
#define PCE_VCE_ADDR_HI (*(volatile uint8_t *)0x0403)
#define PCE_VCE_DATA_LO (*(volatile uint8_t *)0x0404)
#define PCE_VCE_DATA_HI (*(volatile uint8_t *)0x0405)

#define VN_MAP_WIDTH 64u
#define VN_MAP_HEIGHT 32u
#define VN_BG_SCROLL_WIDTH 512u
#define VN_BG_SCROLL_HEIGHT 256u
#define VN_MAP_ROW_BYTES (VN_MAP_WIDTH * 2u)
#define VN_ADPCM_BASE_SAMPLE_RATE 32000u
#define VN_ADPCM_LEGACY_BASE_SAMPLE_RATE 32000u
#define VN_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE 16000u
#define VN_ADPCM_MAX_RATE_CODE 15u
#define VN_SATB_ADDR 0x7f00u
#define VN_WINDOW_X 2u
#define VN_WINDOW_Y 19u
#define VN_WINDOW_W 36u
#define VN_WINDOW_H 8u
#define VN_TEXT_X 2u
#define VN_TEXT_Y 19u
#define VN_TEXT_COLS 18u
#define VN_TEXT_ROWS 4u
#define VN_UI_PALETTE 15u
#define VN_UI_BLANK_TILE PCE_VN_FONT_TILE_BASE
#define VN_CD_SECTOR_BYTES 2048u
#define VN_VDC_CONTROL_BASE (VDC_CONTROL_IRQ_VBLANK | VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_VRAM_ADD_1)
#define VN_VDC_DISPLAY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE)
#define VN_VDC_BG_ONLY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG)
#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE
#define VN_VDC_MEMORY_CONTROL (VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_64_32)
#define VN_CDB_VDC_CONTROL_SHADOW_LO ((volatile uint8_t *)0x20f3)
#define VN_CDB_VDC_CONTROL_SHADOW_HI ((volatile uint8_t *)0x20f4)
#define VN_SPRITE_SLOT_COUNT 4u
#define VN_EXEC_CONTINUE 0u
#define VN_EXEC_WAIT 1u
#define VN_EXEC_RESTART 2u
#define VN_COMMAND_STEP_GUARD 1024u
#define VN_ADPCM_STREAM_MONITOR_FRAMES 4u
#define VN_SCENE_PACK_MAGIC_P 0x50u
#define VN_SCENE_PACK_MAGIC_V 0x56u
#define VN_SCENE_PACK_MAGIC_N 0x4eu
#define VN_SCENE_PACK_MAGIC_S 0x53u
#define VN_SCENE_PACK_OFFSET_VERSION 4u
#define VN_SCENE_PACK_OFFSET_COMMAND_COUNT 5u
#define VN_SCENE_PACK_OFFSET_MESSAGE_COUNT 6u
#define VN_SCENE_PACK_OFFSET_CHOICE_COUNT 7u
#define VN_SCENE_PACK_OFFSET_SWITCH_COUNT 8u
#define VN_SCENE_PACK_OFFSET_COMMAND_TABLE 10u
#define VN_SCENE_PACK_OFFSET_MESSAGE_TABLE 12u
#define VN_SCENE_PACK_OFFSET_CHOICE_TABLE 14u
#define VN_SCENE_PACK_OFFSET_SWITCH_TABLE 16u
#if defined(__PCE_CD__)
#define VN_BANKED_CODE __attribute__((noinline, section(".ram_bank129")))
#define VN_BANKED_CODE2 __attribute__((noinline, section(".ram_bank130")))
#else
#define VN_BANKED_CODE
#define VN_BANKED_CODE2
#endif

static uint8_t current_scene = 0;
static uint8_t current_command = 0;
static uint8_t pending_sprite_refresh = 0;
static uint8_t pending_display_enable = 0;
static uint8_t pending_scene_sprite_clear = 0;
static signed int current_bg_index;
static uint8_t current_bg_x;
static uint8_t current_bg_y;
static uint8_t preloaded_bg_valid = 0;
static uint8_t preloaded_bg_index = 0;
static uint8_t preloaded_bg_x = 0;
static uint8_t preloaded_bg_y = 0;
static uint8_t loaded_sprite_pattern_valid = 0;
static uint8_t loaded_sprite_pattern_index = 0;
static uint8_t loaded_adpcm_valid = 0;
static uint8_t loaded_adpcm_index = 0;
static signed char screen_shake_x = 0;
static signed char screen_shake_y = 0;
static signed int active_message_index;
static signed int active_choice_index;
static uint8_t choice_selected_index = 0;
static uint16_t wait_frames_remaining = 0;
static uint8_t message_glyph_pos = 0;
static uint8_t message_frame_timer = 0;
static uint8_t message_col = 0;
static uint8_t message_row = 0;
static uint8_t message_complete = 0;
static uint8_t message_auto_wait = 0;
static uint16_t vn_rng_state = 0xace1u;
static signed int vn_variables[PCE_VN_VARIABLE_STORAGE_COUNT];
typedef struct
{
    signed int sprite_index;
    signed int animation_index;
    uint16_t x;
    uint16_t y;
    uint8_t visible;
    uint8_t flags;
    uint8_t frame;
    uint8_t timer;
} vn_sprite_slot_t;
static vn_sprite_slot_t sprite_slots_storage[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
#define sprite_slots sprite_slots_storage
static pce_editor_sprite_draw_meta_t sprite_draw_meta;
#if defined(__PCE__)
static vdc_sprite_t sprite_shadow[64];
#endif
#if defined(__PCE_CD__)
static uint8_t cd_transfer_scratch[VN_CD_SECTOR_BYTES];
static uint8_t vn_active_scene_pack_data[PCE_VN_SCENE_PACK_CACHE_BYTES];
static uint8_t cdda_active = 0;
static uint8_t cdda_has_frame_limit = 0;
static uint8_t cdda_looping = 0;
static uint8_t cdda_track = 0;
static uint16_t cdda_frames_remaining = 0;
static const pce_editor_cdda_asset_t *cdda_current = (const pce_editor_cdda_asset_t *)0;
static uint8_t adpcm_stream_looping = 0;
static uint8_t adpcm_stream_index = 0;
static uint8_t adpcm_stream_monitor_frames = 0;
#endif
typedef struct
{
    const unsigned char *data;
    unsigned long data_size;
    unsigned int sample_rate;
    unsigned int adpcm_address;
    uint16_t cd_sector_count;
    pce_editor_cd_sector_t cd_sector;
    uint8_t divider;
    uint8_t loop;
    uint8_t stream;
    uint8_t has_cd;
} vn_adpcm_voice_t;
typedef struct
{
    uint8_t *data;
    uint16_t size;
    uint8_t scene_index;
    uint8_t valid;
} vn_scene_pack_cache_t;
typedef struct
{
    uint16_t options_offset;
    uint8_t option_count;
    uint8_t default_index;
    signed int variable_index;
} vn_choice_ref_t;
typedef struct
{
    uint16_t cases_offset;
    uint8_t case_count;
    uint16_t default_command;
} vn_switch_ref_t;
static vn_scene_pack_cache_t active_scene_pack;
static uint8_t vn_command_scratch_storage[sizeof(pce_vn_command_t)] __attribute__((section(".bss")));
static uint8_t vn_message_scratch_storage[sizeof(pce_vn_message_t)] __attribute__((section(".bss")));
static uint8_t vn_choice_scratch_storage[sizeof(vn_choice_ref_t)] __attribute__((section(".bss")));
static uint8_t vn_choice_option_scratch_storage[sizeof(pce_vn_choice_option_t)] __attribute__((section(".bss")));
static uint8_t vn_switch_scratch_storage[sizeof(vn_switch_ref_t)] __attribute__((section(".bss")));
static uint8_t vn_switch_case_scratch_storage[sizeof(pce_vn_switch_case_t)] __attribute__((section(".bss")));
static uint16_t draw_blank_top[2] __attribute__((section(".bss")));
static uint16_t draw_blank_bottom[2] __attribute__((section(".bss")));
static uint16_t draw_glyph_top[2] __attribute__((section(".bss")));
static uint16_t draw_glyph_bottom[2] __attribute__((section(".bss")));
#define VN_COMMAND_SCRATCH ((pce_vn_command_t *)(void *)vn_command_scratch_storage)
#define VN_MESSAGE_SCRATCH ((pce_vn_message_t *)(void *)vn_message_scratch_storage)
#define VN_CHOICE_SCRATCH ((vn_choice_ref_t *)(void *)vn_choice_scratch_storage)
#define VN_CHOICE_OPTION_SCRATCH ((pce_vn_choice_option_t *)(void *)vn_choice_option_scratch_storage)
#define VN_SWITCH_SCRATCH ((vn_switch_ref_t *)(void *)vn_switch_scratch_storage)
#define VN_SWITCH_CASE_SCRATCH ((pce_vn_switch_case_t *)(void *)vn_switch_case_scratch_storage)
static void advance_story(void);
static void VN_BANKED_CODE2 preload_scene_assets(signed int scene_index, uint8_t allow_visual_upload);
static uint8_t VN_BANKED_CODE load_scene_pack_into_cache(uint8_t scene_index, vn_scene_pack_cache_t *cache);
static uint8_t VN_BANKED_CODE scene_pack_command_count(const vn_scene_pack_cache_t *cache);
#if defined(__PCE_CD__)
static void service_cdda_playback(void);
static void VN_BANKED_CODE service_adpcm_streaming(void);
#endif

static void map_vn_data(void)
{
#if defined(__PCE_CD__)
    pce_vn_font_tiles_map();
#endif
}

static void map_resident_data(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank128_map();
#endif
}

static void init_runtime_state(void)
{
    uint8_t i;
    current_scene = 0u;
    current_command = 0u;
    pending_sprite_refresh = 0u;
    pending_display_enable = 0u;
    pending_scene_sprite_clear = 0u;
    current_bg_index = -1;
    current_bg_x = 0u;
    current_bg_y = 0u;
    preloaded_bg_valid = 0u;
    preloaded_bg_index = 0u;
    preloaded_bg_x = 0u;
    preloaded_bg_y = 0u;
    loaded_sprite_pattern_valid = 0u;
    loaded_sprite_pattern_index = 0u;
    loaded_adpcm_valid = 0u;
    loaded_adpcm_index = 0u;
#if defined(__PCE_CD__)
    cdda_active = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
    adpcm_stream_looping = 0u;
    adpcm_stream_index = 0u;
    adpcm_stream_monitor_frames = 0u;
    active_scene_pack.data = vn_active_scene_pack_data;
    active_scene_pack.size = 0u;
    active_scene_pack.scene_index = 0xffu;
    active_scene_pack.valid = 0u;
#else
    active_scene_pack.data = (uint8_t *)0;
    active_scene_pack.size = 0u;
    active_scene_pack.scene_index = 0xffu;
    active_scene_pack.valid = 0u;
#endif
    screen_shake_x = 0;
    screen_shake_y = 0;
    active_message_index = -1;
    active_choice_index = -1;
    choice_selected_index = 0u;
    wait_frames_remaining = 0u;
    message_glyph_pos = 0u;
    message_frame_timer = 0u;
    message_col = 0u;
    message_row = 0u;
    message_complete = 1u;
    message_auto_wait = 0u;
    map_vn_data();
    for (i = 0u; i < pce_vn_variable_count && i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        vn_variables[i] = pce_vn_variable_initial_values[i];
    }
    for (; i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        vn_variables[i] = 0;
    }
}

static void delay_frame(void)
{
#if defined(__PCE_CD__)
    pce_cdb_wait_vblank();
    service_cdda_playback();
    service_adpcm_streaming();
#else
    volatile uint16_t delay;
    for (delay = 0; delay < 6200u; delay++) {}
#endif
}

static void set_vdc_control(uint16_t control)
{
#if defined(__PCE_CD__)
    *VN_CDB_VDC_CONTROL_SHADOW_LO = (uint8_t)(control & 0xffu);
    *VN_CDB_VDC_CONTROL_SHADOW_HI = (uint8_t)(control >> 8);
#endif
    pce_vdc_poke(VDC_REG_CONTROL, control);
}

static void display_disable(void)
{
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_BLANK_CONTROL);
#elif defined(__PCE__)
    pce_vdc_disable((uint8_t)(VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE));
#endif
}

static void display_enable(void)
{
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
#endif
}

static void sprite_layer_disable(void)
{
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_BG_ONLY_CONTROL);
#elif defined(__PCE__)
    pce_vdc_poke(VDC_REG_CONTROL, VN_VDC_BG_ONLY_CONTROL);
#endif
}

static void sprite_layer_enable(void)
{
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    pce_vdc_poke(VDC_REG_CONTROL, VN_VDC_DISPLAY_CONTROL);
#endif
}

static uint16_t scroll_value_from_offset(signed char offset, uint16_t modulo)
{
    if (!offset) return 0u;
    if (offset > 0) return (uint16_t)(modulo - (uint8_t)offset);
    return (uint16_t)(-offset);
}

static void apply_screen_offset(void)
{
#if defined(__PCE__)
    pce_vdc_poke(VDC_REG_BG_SCROLL_X, scroll_value_from_offset(screen_shake_x, VN_BG_SCROLL_WIDTH));
    pce_vdc_poke(VDC_REG_BG_SCROLL_Y, scroll_value_from_offset(screen_shake_y, VN_BG_SCROLL_HEIGHT));
#endif
}

static void set_screen_offset(signed char x, signed char y)
{
    screen_shake_x = x;
    screen_shake_y = y;
    apply_screen_offset();
    pending_sprite_refresh = 1u;
}

static void VN_BANKED_CODE restore_video_after_cdb_call(uint8_t restore_display)
{
#if defined(__PCE_CD__)
    pce_vdc_set_resolution(320, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_64_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    pce_vdc_set_copy_word();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    apply_screen_offset();
    set_vdc_control(restore_display ? VN_VDC_DISPLAY_CONTROL : VN_VDC_BLANK_CONTROL);
#else
    (void)restore_display;
#endif
}

static void enable_display_if_pending(void)
{
    if (!pending_display_enable) return;
    display_enable();
    pending_display_enable = 0;
    delay_frame();
}

static uint8_t read_pad_raw(void)
{
#if defined(__PCE__)
    return pce_joypad_read();
#else
    return 0;
#endif
}

static signed int command_value_arg(const pce_vn_command_t *command)
{
    if (!command) return 0;
    return (signed int)(int16_t)((uint16_t)command->arg0 | ((uint16_t)command->arg1 << 8));
}

static signed int signed_from_u16(uint16_t value)
{
    return (signed int)(int16_t)value;
}

static signed int clamp_variable_value(int32_t value)
{
    if (value < -32768L) return (signed int)-32768;
    if (value > 32767L) return (signed int)32767;
    return (signed int)value;
}

static signed int variable_value(signed int variable_index)
{
    if (variable_index < 0 || (uint8_t)variable_index >= pce_vn_variable_count) return 0;
    if ((uint8_t)variable_index >= PCE_VN_VARIABLE_STORAGE_COUNT) return 0;
    return vn_variables[(uint8_t)variable_index];
}

static void set_variable_value(signed int variable_index, signed int value)
{
    if (variable_index < 0 || (uint8_t)variable_index >= pce_vn_variable_count) return;
    if ((uint8_t)variable_index >= PCE_VN_VARIABLE_STORAGE_COUNT) return;
    vn_variables[(uint8_t)variable_index] = value;
}

static uint16_t next_random_value(void)
{
    uint16_t x = vn_rng_state;
    x ^= (uint16_t)(x << 7);
    x ^= (uint16_t)(x >> 9);
    x ^= (uint16_t)(x << 8);
    if (!x) x = 0xace1u;
    vn_rng_state = x;
    return x;
}

static signed int random_range_value(signed int min, signed int max)
{
    int32_t diff;
    uint16_t span;
    if (min > max)
    {
        signed int tmp = min;
        min = max;
        max = tmp;
    }
    diff = (int32_t)max - (int32_t)min;
    span = diff >= 65535 ? 65535u : (uint16_t)(diff + 1);
    if (!span) return min;
    return clamp_variable_value((int32_t)min + (int32_t)(next_random_value() % span));
}

static uint8_t compare_values(signed int left, uint8_t operator_id, signed int right)
{
    if (operator_id == PCE_VN_COMPARE_NE) return (uint8_t)(left != right);
    if (operator_id == PCE_VN_COMPARE_LT) return (uint8_t)(left < right);
    if (operator_id == PCE_VN_COMPARE_LTE) return (uint8_t)(left <= right);
    if (operator_id == PCE_VN_COMPARE_GT) return (uint8_t)(left > right);
    if (operator_id == PCE_VN_COMPARE_GTE) return (uint8_t)(left >= right);
    return (uint8_t)(left == right);
}

static uint8_t jump_to_command(uint16_t command_offset)
{
    if (command_offset == PCE_VN_NO_COMMAND) return 0u;
    if (!load_scene_pack_into_cache(current_scene, &active_scene_pack)) return 0u;
    if (command_offset >= scene_pack_command_count(&active_scene_pack)) return 0u;
    current_command = (uint8_t)command_offset;
    return 1u;
}

static void pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
#if defined(__PCE_CD__)
    pce_vdc_set_copy_word();
    pce_vdc_copy_to_vram(dest, source, length);
#elif defined(__PCE__)
    pce_vdc_set_copy_word();
    pce_vdc_copy_to_vram(dest, source, length);
#else
    (void)dest;
    (void)source;
    (void)length;
#endif
}

static void vce_write_color(uint16_t index, uint16_t color)
{
    PCE_VCE_ADDR_LO = (uint8_t)(index & 0xffu);
    PCE_VCE_ADDR_HI = (uint8_t)((index >> 8) & 0xffu);
    PCE_VCE_DATA_LO = (uint8_t)(color & 0xffu);
    PCE_VCE_DATA_HI = (uint8_t)((color >> 8) & 0xffu);
}

static const uint8_t *data_ref_ptr(const pce_editor_data_ref_t *ref)
{
    if (!ref) return 0;
    if (ref->chunk_count && ref->chunks)
    {
        pce_editor_map_asset_bank(ref->chunks[0].bank);
        return ref->chunks[0].data;
    }
    return ref->data;
}

#if defined(__PCE_CD__)
static void cd_sector_from_ref(pce_sector_t *dest, const pce_editor_cd_sector_t *source)
{
    dest->lo = source ? source->lo : 0u;
    dest->md = source ? source->md : 0u;
    dest->hi = source ? source->hi : 0u;
}

static void cd_sector_from_uint(pce_sector_t *dest, unsigned long value)
{
    dest->lo = (uint8_t)(value & 0xfful);
    dest->md = (uint8_t)((value >> 8) & 0xfful);
    dest->hi = (uint8_t)((value >> 16) & 0xfful);
}

static void cd_sector_advance(pce_sector_t *sector)
{
    sector->lo++;
    if (sector->lo) return;
    sector->md++;
    if (sector->md) return;
    sector->hi++;
}

static void cd_transfer_wait(void)
{
    volatile uint16_t wait;
    for (wait = 0u; wait < 65535u; wait++) {}
}

static void prepare_cd_data_access(void)
{
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
    if (!cdda_active) return;
    (void)pce_cdb_cdda_pause();
    cdda_active = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
    restore_video_after_cdb_call(restore_display_after_pause);
}

static uint8_t cd_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref)
{
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest;
    if (!ref || !ref->cd || !ref->cd->sector_count || !ref->size) return 0u;
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, &ref->cd->sector);
    remaining = (uint16_t)ref->size;
    vram_dest = dest;
    while (remaining)
    {
        uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        pce_editor_vram_copy(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    return 1u;
}

static uint8_t cd_bg_map_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref, uint8_t width_tiles, uint8_t height_tiles)
{
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint8_t row = 0u;
    uint8_t copy_width_tiles = width_tiles;
    uint8_t copy_height_tiles = height_tiles;
    const uint8_t dest_col = (uint8_t)(dest % VN_MAP_WIDTH);
    const uint8_t dest_row = (uint8_t)(dest / VN_MAP_WIDTH);
    uint16_t row_bytes;
    if (!ref || !ref->cd || !ref->cd->sector_count || !ref->size || !width_tiles || !height_tiles) return 0u;
    if (dest_col >= VN_MAP_WIDTH || dest_row >= VN_MAP_HEIGHT) return 0u;
    if ((uint16_t)dest_col + copy_width_tiles > VN_MAP_WIDTH)
    {
        copy_width_tiles = (uint8_t)(VN_MAP_WIDTH - dest_col);
    }
    if ((uint16_t)dest_row + copy_height_tiles > VN_MAP_HEIGHT)
    {
        copy_height_tiles = (uint8_t)(VN_MAP_HEIGHT - dest_row);
    }
    if (!copy_width_tiles || !copy_height_tiles) return 0u;
    row_bytes = (uint16_t)(copy_width_tiles * 2u);
    if (ref->size < (uint16_t)(VN_MAP_ROW_BYTES * copy_height_tiles)) return 0u;
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, &ref->cd->sector);
    remaining = (uint16_t)ref->size;
    while (row < copy_height_tiles && remaining)
    {
        uint16_t local_offset = 0u;
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        while (row < copy_height_tiles && (uint16_t)(local_offset + VN_MAP_ROW_BYTES) <= chunk)
        {
            pce_editor_vram_copy((uint16_t)(dest + ((uint16_t)row * VN_MAP_WIDTH)), &cd_transfer_scratch[local_offset], row_bytes);
            local_offset = (uint16_t)(local_offset + VN_MAP_ROW_BYTES);
            row++;
        }
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    return (uint8_t)(row >= copy_height_tiles);
}
#endif

static uint8_t scene_pack_has_range(const vn_scene_pack_cache_t *cache, uint16_t offset, uint16_t length)
{
    if (!cache || !cache->valid || !cache->data) return 0u;
    if (offset > cache->size) return 0u;
    return (uint8_t)(length <= (uint16_t)(cache->size - offset));
}

static uint8_t scene_pack_u8(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    if (!scene_pack_has_range(cache, offset, 1u)) return 0u;
    return cache->data[offset];
}

static uint16_t VN_BANKED_CODE scene_pack_u16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    if (!scene_pack_has_range(cache, offset, 2u)) return 0u;
    return (uint16_t)((uint16_t)cache->data[offset] | ((uint16_t)cache->data[(uint16_t)(offset + 1u)] << 8));
}

static signed int VN_BANKED_CODE scene_pack_s16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    return (signed int)(int16_t)scene_pack_u16(cache, offset);
}

static uint8_t scene_pack_is_valid(const vn_scene_pack_cache_t *cache)
{
    if (!cache || !cache->data || cache->size < PCE_VN_SCENE_PACK_HEADER_SIZE) return 0u;
    if (cache->data[0] != VN_SCENE_PACK_MAGIC_P) return 0u;
    if (cache->data[1] != VN_SCENE_PACK_MAGIC_V) return 0u;
    if (cache->data[2] != VN_SCENE_PACK_MAGIC_N) return 0u;
    if (cache->data[3] != VN_SCENE_PACK_MAGIC_S) return 0u;
    return (uint8_t)(cache->data[VN_SCENE_PACK_OFFSET_VERSION] == PCE_VN_SCENE_PACK_VERSION);
}

static uint8_t VN_BANKED_CODE load_scene_pack_into_cache(uint8_t scene_index, vn_scene_pack_cache_t *cache)
{
    if (!cache) return 0u;
    if (cache->valid && cache->scene_index == scene_index) return 1u;
    cache->valid = 0u;
#if defined(__PCE_CD__)
    {
        pce_vn_scene_pack_t pack;
        pce_sector_t sector = {0};
        uint16_t remaining;
        uint16_t offset = 0u;
        map_vn_data();
        if (scene_index >= pce_vn_scene_count) return 0u;
        pack = pce_vn_scene_packs[scene_index];
        if (!pack.byte_size || pack.byte_size > PCE_VN_SCENE_PACK_CACHE_BYTES || !pack.sector_count) return 0u;
        prepare_cd_data_access();
        sector.lo = pack.sector.lo;
        sector.md = pack.sector.md;
        sector.hi = pack.sector.hi;
        remaining = pack.byte_size;
        while (remaining)
        {
            const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
            (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)&cache->data[offset], chunk);
            cd_transfer_wait();
            remaining = (uint16_t)(remaining - chunk);
            offset = (uint16_t)(offset + chunk);
            cd_sector_advance(&sector);
        }
        cache->size = pack.byte_size;
        cache->scene_index = scene_index;
        cache->valid = scene_pack_is_valid(cache);
        return cache->valid;
    }
#else
    (void)scene_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE scene_pack_command_count(const vn_scene_pack_cache_t *cache)
{
    return scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_COMMAND_COUNT);
}

static uint8_t VN_BANKED_CODE scene_pack_read_command(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command)
{
    uint16_t offset;
    if (!command) return 0u;
    if (command_index >= scene_pack_command_count(cache)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_COMMAND_TABLE)
        + ((uint16_t)command_index * PCE_VN_SCENE_PACK_COMMAND_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_COMMAND_SIZE)) return 0u;
    command->type = scene_pack_u8(cache, offset);
    command->asset_index = scene_pack_s16(cache, (uint16_t)(offset + 1u));
    command->slot = scene_pack_u8(cache, (uint16_t)(offset + 3u));
    command->flags = scene_pack_u8(cache, (uint16_t)(offset + 4u));
    command->arg0 = scene_pack_u8(cache, (uint16_t)(offset + 5u));
    command->arg1 = scene_pack_u8(cache, (uint16_t)(offset + 6u));
    command->x = scene_pack_u16(cache, (uint16_t)(offset + 7u));
    command->y = scene_pack_u16(cache, (uint16_t)(offset + 9u));
    command->message_index = scene_pack_s16(cache, (uint16_t)(offset + 11u));
    command->animation_index = scene_pack_s16(cache, (uint16_t)(offset + 13u));
    command->scene_index = scene_pack_s16(cache, (uint16_t)(offset + 15u));
    command->choice_index = scene_pack_s16(cache, (uint16_t)(offset + 17u));
    return 1u;
}

static uint8_t VN_BANKED_CODE scene_pack_read_message(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!message) return 0u;
    if (message_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_MESSAGE_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_MESSAGE_TABLE)
        + ((uint16_t)message_index * PCE_VN_SCENE_PACK_MESSAGE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_MESSAGE_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    if (!scene_pack_has_range(cache, glyph_offset, 1u)) return 0u;
    message->glyphs = &cache->data[glyph_offset];
    message->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    message->voice_index = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    message->text_speed_frames = scene_pack_u8(cache, (uint16_t)(offset + 5u));
    message->advance_mode = scene_pack_u8(cache, (uint16_t)(offset + 6u));
    message->auto_wait_frames = scene_pack_u8(cache, (uint16_t)(offset + 7u));
    message->mouth_animation_index = scene_pack_s16(cache, (uint16_t)(offset + 8u));
    message->mouth_slot = scene_pack_u8(cache, (uint16_t)(offset + 10u));
    return 1u;
}

static uint8_t VN_BANKED_CODE2 scene_pack_read_choice(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice)
{
    uint16_t offset;
    if (!choice) return 0u;
    if (choice_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_CHOICE_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_CHOICE_TABLE)
        + ((uint16_t)choice_index * PCE_VN_SCENE_PACK_CHOICE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_CHOICE_SIZE)) return 0u;
    choice->options_offset = scene_pack_u16(cache, offset);
    choice->option_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    choice->default_index = scene_pack_u8(cache, (uint16_t)(offset + 3u));
    choice->variable_index = scene_pack_s16(cache, (uint16_t)(offset + 4u));
    return 1u;
}

static uint8_t VN_BANKED_CODE2 scene_pack_read_choice_option(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!choice || !option || option_index >= choice->option_count) return 0u;
    offset = (uint16_t)(choice->options_offset + ((uint16_t)option_index * PCE_VN_SCENE_PACK_OPTION_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_OPTION_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    if (!scene_pack_has_range(cache, glyph_offset, 1u)) return 0u;
    option->glyphs = &cache->data[glyph_offset];
    option->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    option->value = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    option->target_scene = scene_pack_s16(cache, (uint16_t)(offset + 5u));
    return 1u;
}

static uint8_t VN_BANKED_CODE2 scene_pack_read_switch(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch)
{
    uint16_t offset;
    if (!branch) return 0u;
    if (switch_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_SWITCH_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_SWITCH_TABLE)
        + ((uint16_t)switch_index * PCE_VN_SCENE_PACK_SWITCH_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_SIZE)) return 0u;
    branch->cases_offset = scene_pack_u16(cache, offset);
    branch->case_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    branch->default_command = scene_pack_u16(cache, (uint16_t)(offset + 3u));
    return 1u;
}

static uint8_t VN_BANKED_CODE2 scene_pack_read_switch_case(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case)
{
    uint16_t offset;
    if (!branch || !branch_case || case_index >= branch->case_count) return 0u;
    offset = (uint16_t)(branch->cases_offset + ((uint16_t)case_index * PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE)) return 0u;
    branch_case->value = scene_pack_s16(cache, offset);
    branch_case->command = scene_pack_u16(cache, (uint16_t)(offset + 2u));
    return 1u;
}

static void copy_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref, uint16_t word_stride)
{
    uint8_t i;
    uint16_t word_offset = 0;
    if (!ref || !ref->size) return;
#if defined(__PCE_CD__)
    if (cd_data_ref_to_vram(dest, ref)) return;
#endif
    if (ref->chunk_count && ref->chunks)
    {
        for (i = 0; i < ref->chunk_count; i++)
        {
            const pce_editor_data_chunk_t *chunk = &ref->chunks[i];
            if (!chunk->data || !chunk->size) continue;
            pce_editor_map_asset_bank(chunk->bank);
            pce_editor_vram_copy((uint16_t)(dest + word_offset), chunk->data, (uint16_t)chunk->size);
            word_offset = (uint16_t)(word_offset + ((chunk->size + 1u) / 2u));
        }
        return;
    }
    if (ref->data)
    {
        pce_editor_vram_copy(dest, ref->data, (uint16_t)ref->size);
        (void)word_stride;
    }
}

static void upload_palette(const pce_editor_data_ref_t *palette, uint16_t base_index, uint8_t fallback_dark)
{
    uint16_t i;
    uint16_t color_count;
    const uint8_t *data;
    if (!palette || !palette->size) return;
    data = data_ref_ptr(palette);
    if (!data) return;
    color_count = (uint16_t)(palette->size / 2u);
    if (color_count > 16u) color_count = 16u;
    for (i = 0; i < color_count; i++)
    {
        const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
        vce_write_color((uint16_t)(base_index + i), raw);
    }
    for (; i < 16u; i++)
    {
        vce_write_color((uint16_t)(base_index + i), fallback_dark ? 0x0000u : 0x01ffu);
    }
}

static uint16_t scale_vce_color(uint16_t raw, uint8_t step, uint8_t frames)
{
    uint16_t b;
    uint16_t r;
    uint16_t g;
    if (!frames) return raw;
    b = (uint16_t)(((raw & 0x0007u) * step) / frames);
    r = (uint16_t)((((raw >> 3) & 0x0007u) * step) / frames);
    g = (uint16_t)((((raw >> 6) & 0x0007u) * step) / frames);
    return (uint16_t)((g << 6) | (r << 3) | b);
}

static void fade_palette(const pce_editor_data_ref_t *palette, uint16_t base_index, uint8_t frames, uint8_t fade_in)
{
    uint8_t step;
    uint8_t i;
    uint16_t color_count;
    const uint8_t *data;
    if (!frames || !palette || !palette->size) return;
    data = data_ref_ptr(palette);
    if (!data) return;
    color_count = (uint16_t)(palette->size / 2u);
    if (color_count > 16u) color_count = 16u;
    for (step = 0u; step <= frames; step++)
    {
        const uint8_t scale = fade_in ? step : (uint8_t)(frames - step);
        for (i = 0u; i < color_count; i++)
        {
            const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
            vce_write_color((uint16_t)(base_index + i), scale_vce_color(raw, scale, frames));
        }
        delay_frame();
    }
}

static void upload_ui_palette(void)
{
    uint8_t i;
    uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    vce_write_color((uint16_t)(base + 0u), 0x0000u);
    for (i = 1u; i < 16u; i++)
    {
        vce_write_color((uint16_t)(base + i), 0x01ffu);
    }
}

static void upload_font_tiles(void)
{
    map_vn_data();
    pce_editor_vram_copy((uint16_t)(PCE_VN_FONT_TILE_BASE * 16u), pce_vn_font_tiles, (uint16_t)(pce_vn_font_glyph_count * 128u));
}

static void write_map_words(uint16_t map_addr, const uint16_t *words, uint16_t count)
{
#if defined(__PCE_CD__)
    uint16_t i;
    pce_vdc_set_copy_word();
    pce_vdc_poke(VDC_REG_VRAM_WRITE_ADDR, map_addr);
    for (i = 0; i < count; i++)
    {
        pce_vdc_poke(VDC_REG_VRAM_DATA, words[i]);
    }
#elif defined(__PCE__)
    uint16_t i;
    pce_vdc_set_copy_word();
    pce_vdc_poke(VDC_REG_VRAM_WRITE_ADDR, map_addr);
    for (i = 0; i < count; i++)
    {
        pce_vdc_poke(VDC_REG_VRAM_DATA, words[i]);
    }
#else
    pce_editor_vram_copy(map_addr, (const uint8_t *)words, (uint16_t)(count * 2u));
#endif
}

static uint16_t ui_tile(uint16_t tile)
{
    return (uint16_t)((VN_UI_PALETTE << 12) | tile);
}

static void clear_screen_map(void)
{
    uint8_t row;
    uint8_t col;
    static uint16_t line[VN_MAP_WIDTH];
    for (col = 0; col < VN_MAP_WIDTH; col++)
    {
        line[col] = ui_tile(VN_UI_BLANK_TILE);
    }
    for (row = 0; row < VN_MAP_HEIGHT; row++)
    {
        write_map_words((uint16_t)(row * VN_MAP_WIDTH), line, VN_MAP_WIDTH);
    }
}

static void clear_map_rect_at_dest(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles)
{
    uint8_t row;
    uint8_t col;
    uint8_t x;
    uint8_t y;
    uint8_t copy_width;
    uint8_t copy_height;
    static uint16_t line[VN_MAP_WIDTH];
    if (!width_tiles || !height_tiles) return;
    x = (uint8_t)(map_dest % VN_MAP_WIDTH);
    y = (uint8_t)(map_dest / VN_MAP_WIDTH);
    if (y >= VN_MAP_HEIGHT) return;
    copy_width = width_tiles;
    copy_height = height_tiles;
    if ((uint16_t)x + copy_width > VN_MAP_WIDTH) copy_width = (uint8_t)(VN_MAP_WIDTH - x);
    if ((uint16_t)y + copy_height > VN_MAP_HEIGHT) copy_height = (uint8_t)(VN_MAP_HEIGHT - y);
    if (!copy_width || !copy_height) return;
    for (col = 0; col < copy_width; col++)
    {
        line[col] = ui_tile(VN_UI_BLANK_TILE);
    }
    for (row = 0; row < copy_height; row++)
    {
        write_map_words((uint16_t)(map_dest + ((uint16_t)row * VN_MAP_WIDTH)), line, copy_width);
    }
}

static void draw_blank_cell(uint8_t x, uint8_t y)
{
    const uint16_t blank = ui_tile(VN_UI_BLANK_TILE);
    draw_blank_top[0] = blank;
    draw_blank_top[1] = blank;
    draw_blank_bottom[0] = blank;
    draw_blank_bottom[1] = blank;
    write_map_words((uint16_t)((y * VN_MAP_WIDTH) + x), draw_blank_top, 2u);
    write_map_words((uint16_t)(((y + 1u) * VN_MAP_WIDTH) + x), draw_blank_bottom, 2u);
}

static void clear_window_cells(void)
{
    uint8_t row;
    uint8_t col;
    for (row = 0; row < VN_TEXT_ROWS; row++)
    {
        for (col = 0; col < VN_TEXT_COLS; col++)
        {
            draw_blank_cell((uint8_t)(VN_TEXT_X + (col * 2u)), (uint8_t)(VN_TEXT_Y + (row * 2u)));
        }
    }
}

static void draw_glyph(uint8_t glyph, uint8_t x, uint8_t y)
{
    uint16_t tile = (uint16_t)(PCE_VN_FONT_TILE_BASE + ((uint16_t)glyph * 4u));
    draw_glyph_top[0] = ui_tile(tile);
    draw_glyph_top[1] = ui_tile((uint16_t)(tile + 1u));
    draw_glyph_bottom[0] = ui_tile((uint16_t)(tile + 2u));
    draw_glyph_bottom[1] = ui_tile((uint16_t)(tile + 3u));
    write_map_words((uint16_t)((y * VN_MAP_WIDTH) + x), draw_glyph_top, 2u);
    write_map_words((uint16_t)(((y + 1u) * VN_MAP_WIDTH) + x), draw_glyph_bottom, 2u);
}

static void draw_message_glyph_at(uint8_t glyph, uint8_t col, uint8_t row)
{
    const uint8_t x = (uint8_t)(VN_TEXT_X + (col * 2u));
    const uint8_t y = (uint8_t)(VN_TEXT_Y + (row * 2u));
    if (glyph == 0u) draw_blank_cell(x, y);
    else draw_glyph(glyph, x, y);
}

static uint8_t draw_message_next_glyph(const pce_vn_message_t *message)
{
    uint8_t glyph;
    if (!message || !message->glyphs || message_glyph_pos >= message->glyph_count) return 1u;
    glyph = message->glyphs[message_glyph_pos++];
    if (glyph == PCE_VN_GLYPH_END) return 1u;
    draw_message_glyph_at(glyph, message_col, message_row);
    message_col++;
    if (message_col >= VN_TEXT_COLS)
    {
        message_col = 0u;
        message_row++;
        if (message_row >= VN_TEXT_ROWS) return 1u;
    }
    return message_glyph_pos >= message->glyph_count ? 1u : 0u;
}

static void draw_message_text(const pce_vn_message_t *message)
{
    uint8_t i;
    uint8_t col = 0;
    uint8_t row = 0;
    if (!message || !message->glyphs) return;
    for (i = 0; i < message->glyph_count; i++)
    {
        const uint8_t glyph = message->glyphs[i];
        if (glyph == PCE_VN_GLYPH_END) break;
        draw_message_glyph_at(glyph, col, row);
        col++;
        if (col >= VN_TEXT_COLS)
        {
            col = 0;
            row++;
            if (row >= VN_TEXT_ROWS) break;
        }
    }
}

static uint16_t bg_map_dest_from_tile(const pce_editor_bg_asset_t *bg, uint16_t tile_x, uint16_t tile_y)
{
    uint8_t x = tile_x < VN_MAP_WIDTH ? (uint8_t)tile_x : 0u;
    uint8_t y = tile_y < VN_MAP_HEIGHT ? (uint8_t)tile_y : 0u;
    return (uint16_t)(bg->map_base + ((uint16_t)y * VN_MAP_WIDTH) + x);
}

static void clear_bg_map_region(const pce_editor_bg_asset_t *bg, uint16_t tile_x, uint16_t tile_y)
{
    if (!bg) return;
    clear_map_rect_at_dest(bg_map_dest_from_tile(bg, tile_x, tile_y), bg->width_tiles, bg->height_tiles);
}

static void upload_bg_graphics(const pce_editor_bg_asset_t *bg, uint16_t map_dest)
{
    uint8_t row;
    uint16_t row_bytes;
    const uint8_t *map;
    if (!bg) return;
    upload_palette(&bg->palette, (uint16_t)(bg->palette_bank * 16u), 0);
    copy_data_ref_to_vram((uint16_t)(bg->tile_base * 16u), &bg->tiles, 16u);
    map_resident_data();
#if defined(__PCE_CD__)
    if (bg->map.cd && bg->map.size)
    {
        if (cd_bg_map_ref_to_vram(map_dest, &bg->map, bg->width_tiles, bg->height_tiles)) return;
    }
#endif
    map = data_ref_ptr(&bg->map);
    if (!map) return;
    row_bytes = (uint16_t)(bg->width_tiles * 2u);
    for (row = 0; row < bg->height_tiles; row++)
    {
        pce_editor_vram_copy(
            (uint16_t)(map_dest + ((uint16_t)row * VN_MAP_WIDTH)),
            map + ((uint16_t)row * row_bytes),
            row_bytes
        );
    }
}

static uint16_t sprite_attr_for_size(uint8_t flags)
{
    uint16_t attr = (uint16_t)(VDC_SPRITE_FG | VDC_SPRITE_COLOR(sprite_draw_meta.palette_bank));
    if (sprite_draw_meta.cell_width >= 32u) attr |= VDC_SPRITE_WIDTH_32;
    if (sprite_draw_meta.cell_height >= 64u) attr |= VDC_SPRITE_HEIGHT_64;
    else if (sprite_draw_meta.cell_height >= 32u) attr |= VDC_SPRITE_HEIGHT_32;
    if (flags & PCE_VN_SPRITE_FLIP_X) attr |= VDC_SPRITE_FLIP_X;
    if (flags & PCE_VN_SPRITE_FLIP_Y) attr |= VDC_SPRITE_FLIP_Y;
    return attr;
}

static void clear_sprites(void)
{
#if defined(__PCE__)
    uint8_t i;
    for (i = 0u; i < 64u; i++)
    {
        sprite_shadow[i].y = 0u;
        sprite_shadow[i].x = 0u;
        sprite_shadow[i].pattern = 0u;
        sprite_shadow[i].attr = 0u;
    }
#endif
}

static void upload_sprite_table(void)
{
#if defined(__PCE__)
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_editor_vram_copy(VN_SATB_ADDR, (const uint8_t *)sprite_shadow, (uint16_t)(64u * sizeof(vdc_sprite_t)));
    pce_vdc_poke(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC);
    pce_vdc_poke(VDC_REG_SATB_START, VN_SATB_ADDR);
#endif
}

static uint8_t sprite_patterns_per_cell(void)
{
    uint8_t pattern_cols = (uint8_t)((sprite_draw_meta.cell_width + 15u) / 16u);
    uint8_t pattern_rows = (uint8_t)((sprite_draw_meta.cell_height + 15u) / 16u);
    if (!pattern_cols) pattern_cols = 1u;
    if (!pattern_rows) pattern_rows = 1u;
    return (uint8_t)(pattern_cols * pattern_rows * 2u);
}

static uint8_t ensure_sprite_patterns_loaded(uint8_t sprite_index, const pce_editor_sprite_asset_t *sprite)
{
    if (!sprite || !sprite->patterns.size) return 0u;
    if (loaded_sprite_pattern_valid && loaded_sprite_pattern_index == sprite_index) return 0u;
    copy_data_ref_to_vram((uint16_t)(sprite->pattern_base * 32u), &sprite->patterns, 16u);
    loaded_sprite_pattern_valid = 1u;
    loaded_sprite_pattern_index = sprite_index;
    return 1u;
}

static uint8_t show_character_sprite_frame(uint8_t satb_index, uint8_t sprite_index, const pce_editor_sprite_asset_t *sprite, const pce_vn_sprite_anim_t *animation, uint8_t frame, int16_t x, int16_t y, uint8_t flags)
{
    uint8_t row;
    uint8_t col;
    uint8_t cell_columns;
    uint8_t cell_rows;
    uint8_t frame_columns;
    uint8_t frame_rows;
    uint8_t written = 0u;
    uint8_t pattern_step;
    uint8_t use_animation_frame;
    uint16_t first_cell;
    uint16_t total_cells;
    (void)sprite_index;
    if (!sprite || !sprite->patterns.size) return 0u;
    cell_columns = sprite_draw_meta.cell_columns ? sprite_draw_meta.cell_columns : 1u;
    cell_rows = sprite_draw_meta.cell_rows ? sprite_draw_meta.cell_rows : 1u;
    total_cells = (uint16_t)(cell_columns * cell_rows);
    use_animation_frame = (uint8_t)(
        animation &&
        animation->frame_count > 1u &&
        animation->frame_width_cells &&
        animation->frame_height_cells &&
        animation->frame_width_cells <= cell_columns &&
        animation->frame_height_cells <= cell_rows &&
        animation->frame_stride_cells &&
        animation->first_cell < total_cells
    );
    frame_columns = use_animation_frame && animation->frame_width_cells ? animation->frame_width_cells : cell_columns;
    frame_rows = use_animation_frame && animation->frame_height_cells ? animation->frame_height_cells : cell_rows;
    first_cell = use_animation_frame
        ? (uint16_t)(animation->first_cell + ((uint16_t)frame * animation->frame_stride_cells))
        : 0u;
    pattern_step = sprite_patterns_per_cell();
#if defined(__PCE__)
    for (row = 0u; row < frame_rows; row++)
    {
        for (col = 0u; col < frame_columns; col++)
        {
            vdc_sprite_t *entry;
            const uint8_t source_row = (flags & PCE_VN_SPRITE_FLIP_Y) ? (uint8_t)(frame_rows - 1u - row) : row;
            const uint8_t source_col = (flags & PCE_VN_SPRITE_FLIP_X) ? (uint8_t)(frame_columns - 1u - col) : col;
            uint16_t source_cell = (uint16_t)(first_cell + ((uint16_t)source_row * cell_columns) + source_col);
            if (source_cell >= total_cells) continue;
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->y = (uint16_t)(y + ((uint16_t)row * sprite_draw_meta.cell_height) + 64u);
            entry->x = (uint16_t)(x + ((uint16_t)col * sprite_draw_meta.cell_width) + 32u);
            entry->pattern = (uint16_t)(sprite_draw_meta.pattern_base + (source_cell * pattern_step));
            entry->attr = sprite_attr_for_size(flags);
            written++;
        }
    }
#else
    (void)x;
    (void)y;
    (void)satb_index;
    (void)flags;
#endif
    return written;
}

static void play_cdda_track(const pce_editor_cdda_asset_t *cdda)
{
#if defined(__PCE_CD__)
    pce_sector_t start = {0};
    pce_sector_t end = {0};
    uint8_t end_type = PCE_CDB_LOCATION_TYPE_UNTIL_END;
    uint8_t track;
    uint8_t loop;
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (!cdda) return;
    track = cdda->track;
    loop = cdda->loop;
    const uint8_t mode = PCE_CDB_CDDA_PLAY_REPEAT;
    if (track < 2u) return;
    if (cdda_active)
    {
        (void)pce_cdb_cdda_pause();
        cdda_active = 0u;
    }
    start.lo = cdda->start_sector.lo;
    start.md = cdda->start_sector.md;
    start.hi = cdda->start_sector.hi;
    cdda_has_frame_limit = cdda->play_frames ? 1u : 0u;
    cdda_frames_remaining = cdda->play_frames;
    cdda_looping = loop ? 1u : 0u;
    cdda_track = track;
    cdda_current = cdda;
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, start, end_type, end, mode);
    cdda_active = 1u;
    restore_video_after_cdb_call(restore_display_after_cdda);
#else
    (void)cdda;
#endif
}

static void service_cdda_playback(void)
{
#if defined(__PCE_CD__)
    if (!cdda_active || !cdda_has_frame_limit || !cdda_current) return;
    if (cdda_frames_remaining) cdda_frames_remaining--;
    if (cdda_frames_remaining) return;
    {
        if (cdda_looping)
        {
            cdda_active = 0u;
            play_cdda_track(cdda_current);
        }
        else
        {
            const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
            (void)pce_cdb_cdda_pause();
            cdda_active = 0u;
            cdda_has_frame_limit = 0u;
            cdda_looping = 0u;
            cdda_track = 0u;
            cdda_frames_remaining = 0u;
            cdda_current = (const pce_editor_cdda_asset_t *)0;
            restore_video_after_cdb_call(restore_display_after_pause);
        }
    }
#endif
}

static void stop_cdda_track(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
    (void)pce_cdb_cdda_pause();
    cdda_active = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
    restore_video_after_cdb_call(restore_display_after_pause);
#endif
}

static unsigned int VN_BANKED_CODE adpcm_code_sample_rate(uint8_t code)
{
    uint8_t value;
    value = code > VN_ADPCM_MAX_RATE_CODE ? VN_ADPCM_MAX_RATE_CODE : code;
    return VN_ADPCM_BASE_SAMPLE_RATE / (16u - (unsigned int)value);
}

static uint8_t VN_BANKED_CODE adpcm_rate_code(unsigned int sample_rate)
{
    unsigned int rate;
    unsigned int actual;
    unsigned int diff;
    unsigned int best_diff;
    uint8_t code;
    uint8_t best;
    rate = sample_rate ? sample_rate : 16000u;
    best = 0u;
    best_diff = 65535u;
    for (code = 0u; code <= VN_ADPCM_MAX_RATE_CODE; code += 1u)
    {
        actual = adpcm_code_sample_rate(code);
        diff = actual > rate ? actual - rate : rate - actual;
        if (diff < best_diff)
        {
            best = code;
            best_diff = diff;
            if (!diff) break;
        }
    }
    return best;
}

static uint8_t VN_BANKED_CODE adpcm_legacy_divider(unsigned int sample_rate, unsigned int base_rate)
{
    unsigned int rate;
    unsigned int computed;
    rate = sample_rate ? sample_rate : 16000u;
    computed = (base_rate + (rate / 2u)) / rate;
    if (!computed) return 0u;
    computed -= 1u;
    if (computed > 255u) return 255u;
    return (uint8_t)computed;
}

static uint8_t VN_BANKED_CODE adpcm_play_divider(unsigned int sample_rate, uint8_t divider)
{
    uint8_t computed;
    if (!sample_rate) return divider > VN_ADPCM_MAX_RATE_CODE ? VN_ADPCM_MAX_RATE_CODE : divider;
    computed = adpcm_rate_code(sample_rate);
    if (divider > VN_ADPCM_MAX_RATE_CODE) return computed;
    if (divider < 8u) return computed;
    if (divider == adpcm_legacy_divider(sample_rate, VN_ADPCM_LEGACY_BASE_SAMPLE_RATE)) return computed;
    if (divider == adpcm_legacy_divider(sample_rate, VN_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE)) return computed;
    return divider;
}

static uint8_t VN_BANKED_CODE adpcm_voice_fits_buffer(const vn_adpcm_voice_t *voice)
{
#if defined(__PCE_CD__)
    unsigned long limit;
    if (!voice || !voice->data_size) return 0u;
    if (voice->data_size > 65535ul) return 0u;
    if ((unsigned long)voice->adpcm_address >= 65536ul) return 0u;
    limit = 65536ul - (unsigned long)voice->adpcm_address;
    if (limit > 65535ul) limit = 65535ul;
    return voice->data_size <= limit ? 1u : 0u;
#else
    (void)voice;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE copy_adpcm_voice(signed int voice_index, vn_adpcm_voice_t *dest)
{
#if defined(__PCE_CD__)
    const pce_editor_adpcm_asset_t *voice;
    if (!dest) return 0u;
    if (voice_index < 0) return 0u;
    map_resident_data();
    if ((uint8_t)voice_index >= pce_editor_adpcm_asset_count) return 0u;
    voice = &pce_editor_adpcm_assets[(uint8_t)voice_index];
    dest->data = voice->data;
    dest->data_size = voice->data_size;
    dest->sample_rate = voice->sample_rate;
    dest->adpcm_address = voice->adpcm_address;
    dest->divider = voice->divider;
    dest->loop = voice->loop;
    dest->stream = voice->stream;
    dest->has_cd = (uint8_t)(voice->cd && voice->cd->sector_count);
    if (dest->has_cd)
    {
        dest->cd_sector_count = voice->cd->sector_count;
        dest->cd_sector.lo = voice->cd->sector.lo;
        dest->cd_sector.md = voice->cd->sector.md;
        dest->cd_sector.hi = voice->cd->sector.hi;
    }
    else
    {
        dest->cd_sector_count = 0u;
        dest->cd_sector.lo = 0u;
        dest->cd_sector.md = 0u;
        dest->cd_sector.hi = 0u;
    }
    return 1u;
#else
    (void)voice_index;
    (void)dest;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE adpcm_playback_active(void)
{
#if defined(__PCE_CD__)
    return (pce_cdb_adpcm_status() & ADPCM_STOPPED) ? 0u : 1u;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE wait_adpcm_transfer_ready(void)
{
#if defined(__PCE_CD__)
    uint16_t guard = 65535u;
    while (guard && (pce_cdb_adpcm_status() & ADPCM_BUSY))
    {
        guard--;
    }
    return guard ? 1u : 0u;
#else
    return 0u;
#endif
}

static void VN_BANKED_CODE restore_display_after_adpcm(uint8_t restore_display)
{
#if defined(__PCE_CD__)
    restore_video_after_cdb_call(restore_display);
#else
    (void)restore_display;
#endif
}

static uint8_t VN_BANKED_CODE load_adpcm_voice(signed int voice_index, uint8_t allow_stop_playback, uint8_t allow_stream_asset)
{
#if defined(__PCE_CD__)
    vn_adpcm_voice_t voice;
    uint8_t loaded = 0u;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (voice_index < 0) return 0u;
    if (loaded_adpcm_valid && loaded_adpcm_index == (uint8_t)voice_index) return 1u;
    if (!copy_adpcm_voice(voice_index, &voice)) return 0u;
    if (voice.stream && !allow_stream_asset) return 0u;
    if (adpcm_playback_active())
    {
        if (!allow_stop_playback) return 0u;
        pce_cdb_adpcm_stop();
        (void)wait_adpcm_transfer_ready();
    }
    if ((!voice.data && !voice.has_cd) || !voice.data_size) return 0u;
    loaded_adpcm_valid = 0u;
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    if (voice.has_cd)
    {
        pce_sector_t sector = {0};
        const uint16_t sector_count = voice.cd_sector_count;
        const uint8_t read_count = sector_count > 255u ? 255u : (uint8_t)sector_count;
        prepare_cd_data_access();
        cd_sector_from_ref(&sector, &voice.cd_sector);
        loaded = (uint8_t)(!pce_cdb_adpcm_read_from_cd(sector, read_count, voice.adpcm_address));
    }
    else
    {
        map_resident_data();
        loaded = (uint8_t)(!pce_cdb_adpcm_read_from_ram(PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)voice.data, voice.adpcm_address, (uint16_t)voice.data_size));
    }
    if (!loaded)
    {
        map_resident_data();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    loaded_adpcm_valid = 1u;
    loaded_adpcm_index = (uint8_t)voice_index;
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    (void)allow_stop_playback;
    (void)allow_stream_asset;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE stream_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    vn_adpcm_voice_t voice;
    pce_sector_t sector = {0};
    pce_sector_t length = {0};
    uint8_t divider;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (!copy_adpcm_voice(voice_index, &voice)) return 0u;
    if (!voice.stream || !voice.has_cd || !voice.cd_sector_count || !voice.data_size) return 0u;
    if (adpcm_playback_active())
    {
        pce_cdb_adpcm_stop();
        (void)wait_adpcm_transfer_ready();
    }
    loaded_adpcm_valid = 0u;
    prepare_cd_data_access();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    cd_sector_from_ref(&sector, &voice.cd_sector);
    cd_sector_from_uint(&length, (unsigned long)voice.cd_sector_count);
    divider = adpcm_play_divider(voice.sample_rate, voice.divider);
    if (pce_cdb_adpcm_stream(sector, length, divider))
    {
        map_resident_data();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    adpcm_stream_looping = voice.loop ? 1u : 0u;
    adpcm_stream_index = (uint8_t)voice_index;
    adpcm_stream_monitor_frames = adpcm_voice_fits_buffer(&voice) ? VN_ADPCM_STREAM_MONITOR_FRAMES : 0u;
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE play_adpcm_buffered_voice(signed int voice_index, uint8_t restore_display)
{
#if defined(__PCE_CD__)
    vn_adpcm_voice_t voice;
    uint8_t divider;
    if (!copy_adpcm_voice(voice_index, &voice)) return 0u;
    if (!adpcm_voice_fits_buffer(&voice)) return 0u;
    adpcm_stream_looping = 0u;
    adpcm_stream_monitor_frames = 0u;
    if (!load_adpcm_voice(voice_index, 1u, 1u))
    {
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    divider = adpcm_play_divider(voice.sample_rate, voice.divider);
    if (pce_cdb_adpcm_play(voice.adpcm_address, (uint16_t)voice.data_size, divider, voice.loop ? PCE_CDB_ADPCM_REPEAT : PCE_CDB_ADPCM_ONE_SHOT))
    {
        loaded_adpcm_valid = 0u;
        map_resident_data();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    (void)restore_display;
    return 0u;
#endif
}

static void VN_BANKED_CODE play_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    vn_adpcm_voice_t voice;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (!copy_adpcm_voice(voice_index, &voice)) return;
    if (voice.stream)
    {
        if (adpcm_voice_fits_buffer(&voice))
        {
            (void)play_adpcm_buffered_voice(voice_index, restore_display);
            restore_display_after_adpcm(restore_display);
            return;
        }
        (void)stream_adpcm_voice(voice_index);
        restore_display_after_adpcm(restore_display);
        return;
    }
    (void)play_adpcm_buffered_voice(voice_index, restore_display);
#else
    (void)voice_index;
#endif
}

static void VN_BANKED_CODE stop_adpcm_voice(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    pce_cdb_adpcm_stop();
    loaded_adpcm_valid = 0u;
    adpcm_stream_looping = 0u;
    adpcm_stream_monitor_frames = 0u;
    restore_display_after_adpcm(restore_display);
#endif
}

static void VN_BANKED_CODE service_adpcm_streaming(void)
{
#if defined(__PCE_CD__)
    uint16_t status;
    if (!adpcm_stream_looping && !adpcm_stream_monitor_frames) return;
    status = pce_cdb_adpcm_status();
    if (adpcm_stream_monitor_frames)
    {
        adpcm_stream_monitor_frames--;
        if (!adpcm_stream_monitor_frames && (status & ADPCM_STOPPED))
        {
            (void)play_adpcm_buffered_voice((signed int)adpcm_stream_index, (uint8_t)!pending_display_enable);
            return;
        }
    }
    if (!adpcm_stream_looping) return;
    if (!(status & ADPCM_STOPPED)) return;
    (void)stream_adpcm_voice((signed int)adpcm_stream_index);
#endif
}

static void show_scene(uint8_t scene_index)
{
    uint8_t i;
    uint8_t keep_display_for_transition;
    map_vn_data();
    if (!pce_vn_scene_count) return;
    if (scene_index >= pce_vn_scene_count) scene_index = pce_vn_start_scene;
    if (!load_scene_pack_into_cache(scene_index, &active_scene_pack)) return;
    keep_display_for_transition = (uint8_t)(current_bg_index >= 0 && !pending_display_enable);
    if (!keep_display_for_transition)
    {
        display_disable();
        pending_display_enable = 1u;
        clear_screen_map();
    }
    current_scene = scene_index;
    current_command = 0;
    active_message_index = -1;
    active_choice_index = -1;
    wait_frames_remaining = 0u;
    message_complete = 1u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        sprite_slots[i].sprite_index = -1;
        sprite_slots[i].animation_index = -1;
        sprite_slots[i].visible = 0u;
        sprite_slots[i].flags = 0u;
        sprite_slots[i].frame = 0u;
        sprite_slots[i].timer = 0u;
    }
    pending_scene_sprite_clear = keep_display_for_transition ? 1u : 0u;
    pending_sprite_refresh = 1u;
    preload_scene_assets((signed int)scene_index, 1u);
}

static void VN_BANKED_CODE refresh_scene_sprites(void)
{
    uint8_t i;
    uint8_t satb_index = 0u;
    const uint8_t display_active = (uint8_t)!pending_display_enable;
    uint8_t requires_pattern_upload = 0u;
    map_vn_data();
    map_resident_data();
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        const vn_sprite_slot_t *slot = &sprite_slots[i];
        if (!slot->visible || slot->sprite_index < 0) continue;
        if ((uint8_t)slot->sprite_index >= pce_editor_sprite_asset_count) continue;
        if (!loaded_sprite_pattern_valid || loaded_sprite_pattern_index != (uint8_t)slot->sprite_index)
        {
            requires_pattern_upload = 1u;
            break;
        }
    }
    clear_sprites();
    if (display_active && requires_pattern_upload)
    {
        sprite_layer_disable();
        upload_sprite_table();
        delay_frame();
    }
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = &sprite_slots[i];
        pce_vn_sprite_anim_t animation_value;
        const pce_vn_sprite_anim_t *animation = 0;
        const pce_editor_sprite_asset_t *sprite;
        const pce_editor_sprite_draw_meta_t *draw_meta;
        uint8_t sprite_index;
        if (!slot->visible || slot->sprite_index < 0) continue;
        map_resident_data();
        if ((uint8_t)slot->sprite_index >= pce_editor_sprite_asset_count) continue;
        sprite_index = (uint8_t)slot->sprite_index;
        sprite = &pce_editor_sprite_assets[sprite_index];
        draw_meta = &pce_editor_sprite_draw_meta[sprite_index];
        sprite_draw_meta.cell_width = draw_meta->cell_width;
        sprite_draw_meta.cell_height = draw_meta->cell_height;
        sprite_draw_meta.cell_columns = draw_meta->cell_columns;
        sprite_draw_meta.cell_rows = draw_meta->cell_rows;
        sprite_draw_meta.pattern_base = draw_meta->pattern_base;
        sprite_draw_meta.palette_bank = draw_meta->palette_bank;
        map_vn_data();
        if (slot->animation_index >= 0 && (uint8_t)slot->animation_index < pce_vn_sprite_animation_count)
        {
            const pce_vn_sprite_anim_t *source_animation = &pce_vn_sprite_animations[(uint8_t)slot->animation_index];
            animation_value.sprite_index = source_animation->sprite_index;
            animation_value.first_cell = source_animation->first_cell;
            animation_value.frame_count = source_animation->frame_count;
            animation_value.frame_delay = source_animation->frame_delay;
            animation_value.frame_width_cells = source_animation->frame_width_cells;
            animation_value.frame_height_cells = source_animation->frame_height_cells;
            animation_value.frame_stride_cells = source_animation->frame_stride_cells;
            animation_value.loop = source_animation->loop;
            if (animation_value.sprite_index == sprite_index)
            {
                animation = &animation_value;
            }
        }
        upload_palette(&sprite->palette, (uint16_t)(256u + (sprite_draw_meta.palette_bank * 16u)), 1);
        (void)ensure_sprite_patterns_loaded(sprite_index, sprite);
        satb_index = (uint8_t)(satb_index + show_character_sprite_frame(
            satb_index,
            sprite_index,
            sprite,
            animation,
            slot->frame,
            (int16_t)((int16_t)slot->x + screen_shake_x),
            (int16_t)((int16_t)slot->y + screen_shake_y),
            slot->flags
        ));
    }
    upload_sprite_table();
    if (display_active)
    {
        sprite_layer_enable();
        if (requires_pattern_upload) delay_frame();
    }
    pending_sprite_refresh = 0;
}

static void tick_sprite_animations(void)
{
    uint8_t i;
    uint8_t changed = 0u;
    map_vn_data();
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = &sprite_slots[i];
        pce_vn_sprite_anim_t animation;
        if (!slot->visible || slot->animation_index < 0) continue;
        if ((uint8_t)slot->animation_index >= pce_vn_sprite_animation_count) continue;
        animation = pce_vn_sprite_animations[(uint8_t)slot->animation_index];
        if (animation.frame_count <= 1u) continue;
        slot->timer++;
        if (slot->timer < animation.frame_delay) continue;
        slot->timer = 0u;
        if (slot->frame + 1u < animation.frame_count)
        {
            slot->frame++;
        }
        else if (animation.loop)
        {
            slot->frame = 0u;
        }
        changed = 1u;
    }
    if (changed) pending_sprite_refresh = 1u;
}

static void animate_sprite_slot(uint8_t slot, uint16_t target_x, uint16_t target_y, uint8_t frames)
{
    uint8_t step;
    uint16_t x;
    uint16_t y;
    if (slot >= VN_SPRITE_SLOT_COUNT) return;
    if (!frames) return;
    x = sprite_slots[slot].x;
    y = sprite_slots[slot].y;
    for (step = 0u; step < frames; step++)
    {
        if (x < target_x) x++;
        else if (x > target_x) x--;
        if (y < target_y) y++;
        else if (y > target_y) y--;
        sprite_slots[slot].x = x;
        sprite_slots[slot].y = y;
        tick_sprite_animations();
        refresh_scene_sprites();
        delay_frame();
    }
    sprite_slots[slot].x = target_x;
    sprite_slots[slot].y = target_y;
    pending_sprite_refresh = 1u;
}

static signed char shake_offset_for_frame(uint8_t frame, uint8_t intensity)
{
    switch (frame & 3u)
    {
        case 0u: return (signed char)intensity;
        case 1u: return (signed char)(-((signed char)intensity));
        case 2u: return (signed char)(intensity >> 1u);
        default: return (signed char)(-((signed char)(intensity >> 1u)));
    }
}

static void shake_screen(uint8_t frames, uint8_t intensity)
{
    uint8_t i;
    if (!frames) return;
    if (!intensity) intensity = 2u;
    for (i = 0u; i < frames; i++)
    {
        set_screen_offset(shake_offset_for_frame(i, intensity), shake_offset_for_frame((uint8_t)(i + 1u), intensity));
        tick_sprite_animations();
        refresh_scene_sprites();
        delay_frame();
    }
    set_screen_offset(0, 0);
    refresh_scene_sprites();
}

static void start_message(uint8_t message_index)
{
    pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
    clear_window_cells();
    if (scene_pack_read_message(&active_scene_pack, message_index, message))
    {
        active_message_index = message_index;
        active_choice_index = -1;
        wait_frames_remaining = 0u;
        message_glyph_pos = 0u;
        message_frame_timer = 0u;
        message_col = 0u;
        message_row = 0u;
        message_complete = 0u;
        message_auto_wait = message->auto_wait_frames;
        if (message->mouth_animation_index >= 0 && message->mouth_slot < VN_SPRITE_SLOT_COUNT)
        {
            sprite_slots[message->mouth_slot].animation_index = message->mouth_animation_index;
            sprite_slots[message->mouth_slot].frame = 0u;
            sprite_slots[message->mouth_slot].timer = 0u;
            pending_sprite_refresh = 1u;
        }
        if (!message->text_speed_frames)
        {
            draw_message_text(message);
            message_complete = 1u;
        }
        else
        {
            message_complete = draw_message_next_glyph(message);
        }
        play_adpcm_voice(message->voice_index);
        if (!pending_display_enable) delay_frame();
    }
}

static void finish_active_message(void)
{
    pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
    if (active_message_index < 0) return;
    if (!scene_pack_read_message(&active_scene_pack, (uint8_t)active_message_index, message)) return;
    draw_message_text(message);
    message_complete = 1u;
}

static void tick_active_message(void)
{
    pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
    if (active_message_index < 0 || message_complete) return;
    if (!scene_pack_read_message(&active_scene_pack, (uint8_t)active_message_index, message)) return;
    if (!message->text_speed_frames)
    {
        finish_active_message();
        return;
    }
    message_frame_timer++;
    if (message_frame_timer < message->text_speed_frames) return;
    message_frame_timer = 0u;
    message_complete = draw_message_next_glyph(message);
}

static void hide_sprites_for_asset_load(void)
{
    clear_sprites();
    upload_sprite_table();
    pending_scene_sprite_clear = 0u;
    if (!pending_display_enable)
    {
        sprite_layer_disable();
        delay_frame();
    }
}

static void preload_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    (void)load_adpcm_voice(voice_index, 0u, 0u);
#else
    (void)voice_index;
#endif
}

static void VN_BANKED_CODE2 preload_scene_assets(signed int scene_index, uint8_t allow_visual_upload)
{
    uint8_t command_count;
    uint8_t i;
    map_vn_data();
    if (scene_index < 0 || (uint8_t)scene_index >= pce_vn_scene_count) return;
    if ((uint8_t)scene_index != current_scene) return;
    if (!load_scene_pack_into_cache((uint8_t)scene_index, &active_scene_pack)) return;
    command_count = scene_pack_command_count(&active_scene_pack);
    for (i = 0u; i < command_count; i++)
    {
        pce_vn_command_t *command = VN_COMMAND_SCRATCH;
        if (!scene_pack_read_command(&active_scene_pack, i, command)) continue;
        if (command->type == PCE_VN_COMMAND_BACKGROUND)
        {
            if (!allow_visual_upload || !pending_display_enable) continue;
            if (command->asset_index < 0 || (uint8_t)command->asset_index >= pce_editor_bg_asset_count) continue;
            if (preloaded_bg_valid
                && preloaded_bg_index == (uint8_t)command->asset_index
                && preloaded_bg_x == (uint8_t)command->x
                && preloaded_bg_y == (uint8_t)command->y) continue;
            if (pending_scene_sprite_clear) hide_sprites_for_asset_load();
            clear_bg_map_region(
                &pce_editor_bg_assets[(uint8_t)command->asset_index],
                command->x,
                command->y
            );
            upload_bg_graphics(
                &pce_editor_bg_assets[(uint8_t)command->asset_index],
                bg_map_dest_from_tile(&pce_editor_bg_assets[(uint8_t)command->asset_index], command->x, command->y)
            );
            preloaded_bg_valid = 1u;
            preloaded_bg_index = (uint8_t)command->asset_index;
            preloaded_bg_x = (uint8_t)command->x;
            preloaded_bg_y = (uint8_t)command->y;
        }
        else if (command->type == PCE_VN_COMMAND_SPRITE)
        {
            if (!allow_visual_upload || !pending_display_enable) continue;
            if (!(command->flags & PCE_VN_SPRITE_VISIBLE)) continue;
            if (command->asset_index < 0 || (uint8_t)command->asset_index >= pce_editor_sprite_asset_count) continue;
            if (loaded_sprite_pattern_valid && loaded_sprite_pattern_index == (uint8_t)command->asset_index) continue;
            hide_sprites_for_asset_load();
            (void)ensure_sprite_patterns_loaded((uint8_t)command->asset_index, &pce_editor_sprite_assets[(uint8_t)command->asset_index]);
        }
        else if (command->type == PCE_VN_COMMAND_MESSAGE)
        {
            if (command->message_index >= 0)
            {
                pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
                if (!scene_pack_read_message(&active_scene_pack, (uint8_t)command->message_index, message)) continue;
                preload_adpcm_voice(message->voice_index);
            }
        }
        else if (command->type == PCE_VN_COMMAND_AUDIO)
        {
            const uint8_t kind = (uint8_t)(command->flags & 0x0fu);
            const uint8_t action = (uint8_t)(command->flags & 0xf0u);
            if (kind == PCE_VN_AUDIO_KIND_ADPCM && action == PCE_VN_AUDIO_ACTION_PLAY)
            {
                preload_adpcm_voice(command->asset_index);
            }
        }
    }
}

static void draw_choice_options(void)
{
    uint8_t row;
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    if (active_choice_index < 0) return;
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, choice)) return;
    clear_window_cells();
    for (row = 0u; row < choice->option_count && row < VN_TEXT_ROWS; row++)
    {
        uint8_t col;
        pce_vn_choice_option_t *option = VN_CHOICE_OPTION_SCRATCH;
        if (!scene_pack_read_choice_option(&active_scene_pack, choice, row, option)) continue;
        draw_message_glyph_at(row == choice_selected_index ? PCE_VN_CHOICE_CURSOR_GLYPH : 0u, 0u, row);
        for (col = 0u; col < option->glyph_count && col + 1u < VN_TEXT_COLS; col++)
        {
            const uint8_t glyph = option->glyphs[col];
            if (glyph == PCE_VN_GLYPH_END) break;
            draw_message_glyph_at(glyph, (uint8_t)(col + 1u), row);
        }
    }
}

static void start_choice(uint8_t choice_index)
{
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    if (!scene_pack_read_choice(&active_scene_pack, choice_index, choice)) return;
    if (!choice->option_count) return;
    active_message_index = -1;
    message_complete = 1u;
    wait_frames_remaining = 0u;
    active_choice_index = choice_index;
    choice_selected_index = choice->default_index < choice->option_count ? choice->default_index : 0u;
    draw_choice_options();
}

static uint8_t handle_choice_input(uint8_t pressed)
{
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    if (active_choice_index < 0) return 0u;
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, choice)) return 0u;
    if (!choice->option_count) return 0u;
    if (pressed & PAD_UP)
    {
        if (choice_selected_index) choice_selected_index--;
        else choice_selected_index = (uint8_t)(choice->option_count - 1u);
        draw_choice_options();
        return 1u;
    }
    if (pressed & PAD_DOWN)
    {
        choice_selected_index++;
        if (choice_selected_index >= choice->option_count) choice_selected_index = 0u;
        draw_choice_options();
        return 1u;
    }
    if (pressed & (PAD_I | PAD_II | PAD_RUN))
    {
        pce_vn_choice_option_t *option = VN_CHOICE_OPTION_SCRATCH;
        if (!scene_pack_read_choice_option(&active_scene_pack, choice, choice_selected_index, option)) return 0u;
        active_choice_index = -1;
        clear_window_cells();
        if (choice->variable_index >= 0)
        {
            set_variable_value(choice->variable_index, option->value);
        }
        if (option->target_scene >= 0) show_scene((uint8_t)option->target_scene);
        advance_story();
        return 1u;
    }
    return 0u;
}

static void set_background(signed int bg_index, uint8_t transition, uint8_t fade_out_frames, uint8_t fade_in_frames, uint16_t tile_x, uint16_t tile_y)
{
    const pce_editor_bg_asset_t *next_bg;
    const uint8_t fade_transition = (uint8_t)(transition == PCE_VN_BG_TRANSITION_FADE);
    const uint8_t next_x = tile_x < VN_MAP_WIDTH ? (uint8_t)tile_x : 0u;
    const uint8_t next_y = tile_y < VN_MAP_HEIGHT ? (uint8_t)tile_y : 0u;
    const uint8_t bg_position_changed = (uint8_t)(current_bg_x != next_x || current_bg_y != next_y);
    const uint8_t restore_display_after_bg_load = (uint8_t)!pending_display_enable;
    uint8_t bg_ready;
    if (bg_index < 0 || (uint8_t)bg_index >= pce_editor_bg_asset_count) return;
    next_bg = &pce_editor_bg_assets[(uint8_t)bg_index];
    if (fade_transition && current_bg_index >= 0 && !pending_display_enable)
    {
        fade_palette(&pce_editor_bg_assets[(uint8_t)current_bg_index].palette, (uint16_t)(pce_editor_bg_assets[(uint8_t)current_bg_index].palette_bank * 16u), fade_out_frames, 0u);
    }
    if (pending_scene_sprite_clear)
    {
        clear_sprites();
        upload_sprite_table();
        pending_scene_sprite_clear = 0u;
    }
    bg_ready = (uint8_t)(preloaded_bg_valid
        && preloaded_bg_index == (uint8_t)bg_index
        && preloaded_bg_x == next_x
        && preloaded_bg_y == next_y);
    if (!bg_ready)
    {
        if (current_bg_index >= 0 && (bg_index != current_bg_index || bg_position_changed))
        {
            clear_bg_map_region(&pce_editor_bg_assets[(uint8_t)current_bg_index], current_bg_x, current_bg_y);
        }
        clear_bg_map_region(next_bg, next_x, next_y);
        upload_bg_graphics(next_bg, bg_map_dest_from_tile(next_bg, next_x, next_y));
        if (restore_display_after_bg_load) display_enable();
        preloaded_bg_valid = 1u;
        preloaded_bg_index = (uint8_t)bg_index;
        preloaded_bg_x = next_x;
        preloaded_bg_y = next_y;
    }
    current_bg_index = bg_index;
    current_bg_x = next_x;
    current_bg_y = next_y;
    if (transition == PCE_VN_BG_TRANSITION_FADE && pending_display_enable)
    {
        display_enable();
        pending_display_enable = 0u;
        delay_frame();
    }
    if (fade_transition)
    {
        fade_palette(&next_bg->palette, (uint16_t)(next_bg->palette_bank * 16u), fade_in_frames, 1u);
    }
}

static uint8_t execute_command(const pce_vn_command_t *command)
{
    uint8_t slot;
    if (!command) return VN_EXEC_CONTINUE;
    if (command->type == PCE_VN_COMMAND_BACKGROUND)
    {
        set_background(command->asset_index, command->flags, command->arg0, command->arg1, command->x, command->y);
    }
    else if (command->type == PCE_VN_COMMAND_SPRITE)
    {
        uint8_t was_visible;
        uint16_t start_x;
        uint16_t start_y;
        slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
        was_visible = (uint8_t)(sprite_slots[slot].visible && sprite_slots[slot].sprite_index >= 0);
        start_x = sprite_slots[slot].x;
        start_y = sprite_slots[slot].y;
        sprite_slots[slot].sprite_index = command->asset_index;
        sprite_slots[slot].animation_index = command->animation_index;
        sprite_slots[slot].visible = (uint8_t)((command->flags & PCE_VN_SPRITE_VISIBLE) && command->asset_index >= 0);
        sprite_slots[slot].flags = command->flags;
        sprite_slots[slot].frame = 0u;
        sprite_slots[slot].timer = 0u;
        if (sprite_slots[slot].visible && was_visible && command->arg0)
        {
            sprite_slots[slot].x = start_x;
            sprite_slots[slot].y = start_y;
            animate_sprite_slot(slot, command->x, command->y, command->arg0);
        }
        else
        {
            sprite_slots[slot].x = command->x;
            sprite_slots[slot].y = command->y;
            pending_sprite_refresh = 1u;
        }
    }
    else if (command->type == PCE_VN_COMMAND_AUDIO)
    {
        const uint8_t kind = (uint8_t)(command->flags & 0x0fu);
        const uint8_t action = (uint8_t)(command->flags & 0xf0u);
        if (kind == PCE_VN_AUDIO_KIND_ADPCM)
        {
            if (action == PCE_VN_AUDIO_ACTION_STOP) stop_adpcm_voice();
            else play_adpcm_voice(command->asset_index);
        }
        else
        {
            if (action == PCE_VN_AUDIO_ACTION_STOP) stop_cdda_track();
            else if (command->asset_index >= 0 && (uint8_t)command->asset_index < pce_editor_cdda_asset_count)
            {
                const pce_editor_cdda_asset_t *cdda = &pce_editor_cdda_assets[(uint8_t)command->asset_index];
                play_cdda_track(cdda);
            }
        }
    }
    else if (command->type == PCE_VN_COMMAND_MESSAGE)
    {
        if (command->message_index >= 0)
        {
            start_message((uint8_t)command->message_index);
            return VN_EXEC_WAIT;
        }
    }
    else if (command->type == PCE_VN_COMMAND_PRELOAD)
    {
        preload_scene_assets(command->scene_index, pending_display_enable);
    }
    else if (command->type == PCE_VN_COMMAND_CHOICE)
    {
        if (command->choice_index >= 0)
        {
            start_choice((uint8_t)command->choice_index);
            return active_choice_index >= 0 ? VN_EXEC_WAIT : VN_EXEC_CONTINUE;
        }
    }
    else if (command->type == PCE_VN_COMMAND_VARIABLE)
    {
        const signed int value = command_value_arg(command);
        const signed int current = variable_value(command->asset_index);
        if (command->flags == PCE_VN_VAR_OP_ADD)
        {
            set_variable_value(command->asset_index, clamp_variable_value((int32_t)current + (int32_t)value));
        }
        else if (command->flags == PCE_VN_VAR_OP_SUB)
        {
            set_variable_value(command->asset_index, clamp_variable_value((int32_t)current - (int32_t)value));
        }
        else if (command->flags == PCE_VN_VAR_OP_RANDOM)
        {
            set_variable_value(command->asset_index, random_range_value(signed_from_u16(command->x), signed_from_u16(command->y)));
        }
        else
        {
            set_variable_value(command->asset_index, value);
        }
    }
    else if (command->type == PCE_VN_COMMAND_IF)
    {
        const signed int left = variable_value(command->asset_index);
        const signed int right = command_value_arg(command);
        const uint16_t target = compare_values(left, command->flags, right) ? command->x : command->y;
        (void)jump_to_command(target);
    }
    else if (command->type == PCE_VN_COMMAND_SWITCH)
    {
        vn_switch_ref_t *branch = VN_SWITCH_SCRATCH;
        uint8_t i;
        uint16_t target = PCE_VN_NO_COMMAND;
        const signed int value = variable_value(command->asset_index);
        if (command->choice_index >= 0 && scene_pack_read_switch(&active_scene_pack, (uint8_t)command->choice_index, branch))
        {
            for (i = 0u; i < branch->case_count; i++)
            {
                pce_vn_switch_case_t *branch_case = VN_SWITCH_CASE_SCRATCH;
                if (!scene_pack_read_switch_case(&active_scene_pack, branch, i, branch_case)) continue;
                if (branch_case->value == value)
                {
                    target = branch_case->command;
                    break;
                }
            }
            if (target == PCE_VN_NO_COMMAND) target = branch->default_command;
            (void)jump_to_command(target);
        }
    }
    else if (command->type == PCE_VN_COMMAND_GOTO)
    {
        (void)jump_to_command(command->x);
    }
    else if (command->type == PCE_VN_COMMAND_LABEL)
    {
        return VN_EXEC_CONTINUE;
    }
    else if (command->type == PCE_VN_COMMAND_JUMP)
    {
        if (command->scene_index >= 0)
        {
            show_scene((uint8_t)command->scene_index);
            return VN_EXEC_RESTART;
        }
    }
    else if (command->type == PCE_VN_COMMAND_WAIT)
    {
        wait_frames_remaining = (uint16_t)(((uint16_t)command->arg1 << 8) | command->arg0);
        return wait_frames_remaining ? VN_EXEC_WAIT : VN_EXEC_CONTINUE;
    }
    else if (command->type == PCE_VN_COMMAND_EFFECT)
    {
        if (command->flags == PCE_VN_EFFECT_FADE_OUT)
        {
            if (current_bg_index >= 0 && !pending_display_enable)
            {
                fade_palette(&pce_editor_bg_assets[(uint8_t)current_bg_index].palette, (uint16_t)(pce_editor_bg_assets[(uint8_t)current_bg_index].palette_bank * 16u), command->arg0, 0u);
            }
            display_disable();
            pending_display_enable = 1u;
            hide_sprites_for_asset_load();
        }
        else if (command->flags == PCE_VN_EFFECT_FADE_IN)
        {
            enable_display_if_pending();
            if (current_bg_index >= 0)
            {
                fade_palette(&pce_editor_bg_assets[(uint8_t)current_bg_index].palette, (uint16_t)(pce_editor_bg_assets[(uint8_t)current_bg_index].palette_bank * 16u), command->arg0, 1u);
            }
        }
        else if (command->flags == PCE_VN_EFFECT_BLANK)
        {
            display_disable();
            pending_display_enable = 1u;
            hide_sprites_for_asset_load();
            clear_screen_map();
        }
        else if (command->flags == PCE_VN_EFFECT_SHAKE)
        {
            shake_screen(command->arg0, command->arg1);
        }
    }
    return VN_EXEC_CONTINUE;
}

static uint8_t VN_BANKED_CODE run_commands_until_wait(void)
{
    uint16_t guard = VN_COMMAND_STEP_GUARD;
    uint8_t command_count;
    active_message_index = -1;
    message_complete = 1u;
    active_choice_index = -1;
    for (;;)
    {
        uint8_t restart = 0u;
        if (!load_scene_pack_into_cache(current_scene, &active_scene_pack)) return 0u;
        command_count = scene_pack_command_count(&active_scene_pack);
        while (current_command < command_count)
        {
            if (!guard)
            {
                wait_frames_remaining = 1u;
                return 1u;
            }
            guard--;
            {
                uint8_t result;
                pce_vn_command_t *command = VN_COMMAND_SCRATCH;
                if (!scene_pack_read_command(&active_scene_pack, current_command, command))
                {
                    current_command++;
                    continue;
                }
                current_command++;
                result = execute_command(command);
                if (result == VN_EXEC_WAIT) return 1u;
                if (result == VN_EXEC_RESTART)
                {
                    restart = 1u;
                    break;
                }
            }
        }
        if (!restart) return 0u;
    }
}

static signed int current_scene_next_scene(void)
{
    pce_vn_scene_pack_t pack;
    map_vn_data();
    if (current_scene >= pce_vn_scene_count) return -1;
    pack = pce_vn_scene_packs[current_scene];
    return pack.next_scene;
}

static void advance_story(void)
{
    if (!run_commands_until_wait())
    {
        const signed int next_scene = current_scene_next_scene();
        if (next_scene >= 0) show_scene((uint8_t)next_scene);
        else current_command = 0u;
        run_commands_until_wait();
    }
    if (pending_sprite_refresh) refresh_scene_sprites();
    enable_display_if_pending();
}

static void init_video(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank129_map();
    pce_ram_bank130_map();
    pce_vdc_set_resolution(320, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_64_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    pce_vdc_set_copy_word();
    set_vdc_control(VN_VDC_BLANK_CONTROL);
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_cdb_irq_enable((uint8_t)(PCE_CDB_MASK_IRQ_EXTERNAL | PCE_CDB_MASK_VBLANK_NO_BIOS));
#elif defined(__PCE__)
    pce_vdc_set_resolution(320, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_64_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    pce_vdc_set_copy_word();
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
#endif
    upload_ui_palette();
    upload_font_tiles();
    clear_screen_map();
    set_screen_offset(0, 0);
}

int main(void)
{
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;
    uint8_t start_scene;

    init_runtime_state();
    init_video();
    map_vn_data();
    start_scene = pce_vn_start_scene;
    show_scene(start_scene);
    advance_story();
    last_pad = read_pad_raw();

    while (1)
    {
        pad = read_pad_raw();
        pressed = (uint8_t)(pad & (uint8_t)~last_pad);
        if (active_choice_index >= 0)
        {
            (void)handle_choice_input(pressed);
        }
        else if (wait_frames_remaining)
        {
            wait_frames_remaining--;
            if (!wait_frames_remaining) advance_story();
        }
        else if (pressed & (PAD_I | PAD_II | PAD_RUN | PAD_RIGHT | PAD_DOWN))
        {
            if (active_message_index >= 0 && !message_complete)
            {
                finish_active_message();
            }
            else
            {
                advance_story();
            }
        }
        tick_active_message();
        if (active_message_index >= 0 && message_complete)
        {
            pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
            if (scene_pack_read_message(&active_scene_pack, (uint8_t)active_message_index, message)
                && message->advance_mode == PCE_VN_ADVANCE_AUTO)
            {
                if (message_auto_wait) message_auto_wait--;
                else advance_story();
            }
        }
        tick_sprite_animations();
        if (pending_sprite_refresh) refresh_scene_sprites();
        last_pad = pad;
        delay_frame();
    }
    return 0;
}
