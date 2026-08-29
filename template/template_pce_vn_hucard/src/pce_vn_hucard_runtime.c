#include <stdint.h>

#if !defined(__PCE__)
#error "The HuCARD VN template requires llvm-mos-sdk and mos-pce-clang."
#endif

#include <pce.h>

#include "pce_vn_hucard_banks.h"
#include "generated/assets.h"
#include "generated/vn.h"

#define VN_MAP_WIDTH 32u
#define VN_MAP_HEIGHT 32u
#define VN_VISIBLE_HEIGHT 28u
#define VN_BG_TILE_BYTES 32u
#define VN_BG_PALETTE_COLORS 16u
#define VN_TEXT_X 3u
#define VN_TEXT_Y 20u
#define VN_TEXT_COLS 17u
#define VN_TEXT_ROWS 4u
#define VN_WAIT_CURSOR_ROW 3u
#define VN_WAIT_CURSOR_COL 16u
#define VN_CHOICE_CURSOR_COL 0u
#define VN_CHOICE_TEXT_COL 2u
#define VN_GLYPH_W 12u
#define VN_GLYPH_H 12u
#define VN_GLYPH_Y_OFFSET 2u
#define VN_GLYPH_MASK_WORDS 12u
#define VN_MSG_GLYPH_MAX_TILES 4u
#define VN_MSG_CLEAR_TILES_PER_VBLANK 16u
#define VN_MSG_TILE_COLS 26u
#define VN_MSG_TILE_ROWS 8u
#define VN_MSG_TILE_COUNT (VN_MSG_TILE_COLS * VN_MSG_TILE_ROWS)
#define VN_MSG_STRIP_TILE_BASE PCE_VN_FONT_TILE_BASE
#define VN_UI_BLANK_TILE (PCE_VN_FONT_TILE_BASE + VN_MSG_TILE_COUNT)
#define VN_UI_PALETTE 15u
#define VN_WAIT_CURSOR_BLINK_FRAMES 24u
#define VN_MESSAGE_INDICATOR_HIDDEN 0u
#define VN_MESSAGE_INDICATOR_WAIT_VISIBLE 1u
#define VN_MESSAGE_INDICATOR_WAIT_BLANK 2u
#define VN_MESSAGE_INDICATOR_AUTO 3u
#define VN_SATB_ADDR 0x7f00u
#define VN_SPRITE_SLOT_COUNT 4u
#define VN_SPRITE_SATB_PER_SLOT 12u
#define VN_SPRITETEXT_SATB_BASE 48u
#define VN_SPRITETEXT_SLOT_COUNT 4u
#define VN_SPRITETEXT_MAX_GLYPHS 32u
#define VN_SPRITETEXT_PITCH_X VN_GLYPH_W
#define VN_SPRITETEXT_PITCH_Y 16u
/* Raw SATB Y includes the hardware +64 bias. Zero keeps unused entries above
   the visible scanlines so transparent sprites do not consume the line limit. */
#define VN_SPRITE_HIDDEN_Y 0u
#define VN_VRAM_SLICE_BYTES 512u
#define VN_PSG_STEP_ACCUM_UNIT 3600u
#define VN_PSG_PATTERN_ROW_BYTES 8u
#define VN_PSG_STEPS_PER_BEAT 4u
#define VN_PSG_VBLANK_FRAMES_PER_SERVICE 1u
#define VN_PSG_WAVE_SQUARE 45u
#define VN_PSG_WAVE_KIND_SQUARE 0u
#define VN_PSG_WAVE_KIND_SINE 1u
#define VN_PSG_WAVE_KIND_SAW 2u
#define VN_PSG_WAVE_KIND_TRIANGLE 3u
#define VN_SPRITE_PATTERN_END_BASE (VN_SATB_ADDR / 32u)
#define VN_VDC_CONTROL_BASE (VDC_CONTROL_IRQ_VBLANK | VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_VRAM_ADD_1)
#define VN_VDC_DISPLAY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE)
#define VN_VDC_MEMORY_CONTROL (VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_32_32)
#define VN_HUCARD_CODE_SCRIPT __attribute__((noinline, section(".rom_bank1")))
#define VN_HUCARD_CODE_VIDEO __attribute__((noinline, section(".rom_bank2")))
#define VN_HUCARD_CODE_TEXT __attribute__((noinline, section(".rom_bank3")))
#define VN_HUCARD_CODE_PSG __attribute__((noinline, section(".rom_bank4")))
#define VN_HUCARD_CODE_SPRITE_STATE __attribute__((noinline, section(".rom_bank4")))
#define VN_HUCARD_CODE_SUPPORT __attribute__((noinline, section(".rom_bank4")))

#define PAD_I KEY_1
#define PAD_II KEY_2
#define PAD_SELECT KEY_SELECT
#define PAD_RUN KEY_RUN
#define PAD_UP KEY_UP
#define PAD_RIGHT KEY_RIGHT
#define PAD_DOWN KEY_DOWN
#define PAD_LEFT KEY_LEFT

#define PCE_PSG_SELECT (*(volatile uint8_t *)0x0800)
#define PCE_PSG_GLOBAL (*(volatile uint8_t *)0x0801)
#define PCE_PSG_FREQ_LO (*(volatile uint8_t *)0x0802)
#define PCE_PSG_FREQ_HI (*(volatile uint8_t *)0x0803)
#define PCE_PSG_CONTROL (*(volatile uint8_t *)0x0804)
#define PCE_PSG_BALANCE (*(volatile uint8_t *)0x0805)
#define PCE_PSG_WAVE (*(volatile uint8_t *)0x0806)
#define PCE_PSG_NOISE (*(volatile uint8_t *)0x0807)

#define VN_SCENE_PACK_OFFSET_VERSION 4u
#define VN_SCENE_PACK_OFFSET_COMMAND_COUNT 5u
#define VN_SCENE_PACK_OFFSET_MESSAGE_COUNT 6u
#define VN_SCENE_PACK_OFFSET_CHOICE_COUNT 7u
#define VN_SCENE_PACK_OFFSET_SWITCH_COUNT 8u
#define VN_SCENE_PACK_OFFSET_FLAGS 9u
#define VN_SCENE_PACK_OFFSET_COMMAND_TABLE 10u
#define VN_SCENE_PACK_OFFSET_MESSAGE_TABLE 12u
#define VN_SCENE_PACK_OFFSET_CHOICE_TABLE 14u
#define VN_SCENE_PACK_OFFSET_SWITCH_TABLE 16u

typedef struct
{
    uint16_t options_offset;
    uint8_t option_count;
    uint8_t default_index;
    int16_t variable_index;
} vn_choice_ref_t;

typedef struct
{
    uint8_t glyphs[VN_SPRITETEXT_MAX_GLYPHS];
    uint8_t glyph_count;
    uint16_t x;
    uint16_t y;
    uint16_t color;
    uint8_t blink_frames;
    uint8_t blink_timer;
    uint8_t blink_on;
    uint8_t visible;
} vn_spritetext_slot_t;

typedef struct
{
    uint16_t cases_offset;
    uint8_t case_count;
    uint16_t default_command;
} vn_switch_ref_t;

typedef struct
{
    const pce_editor_data_ref_t *ref;
    uint16_t size;
    unsigned int scene_index;
    uint8_t valid;
} vn_scene_pack_cache_t;

typedef struct
{
    uint16_t period;
    uint8_t volume;
    uint8_t noise;
    uint8_t wave;
    uint8_t active;
} vn_psg_voice_t;

typedef struct
{
    const pce_vn_psg_asset_t *asset;
    uint8_t active;
    uint8_t base_channel;
    uint8_t used_mask;
    uint8_t loop;
    uint16_t step;
    uint16_t accum;
    uint16_t cursor;
    vn_psg_voice_t voices[6];
} vn_psg_player_t;

typedef struct
{
    int16_t asset_index;
    int16_t animation_index;
    uint16_t x;
    uint16_t y;
    uint8_t flags;
    uint8_t frame;
    uint16_t timer;
    uint8_t satb_count;
    uint8_t visible;
} vn_sprite_slot_t;

typedef struct
{
    uint16_t target_x;
    uint16_t target_y;
    uint16_t distance_x;
    uint16_t distance_y;
    uint16_t error_x;
    uint16_t error_y;
    uint16_t total_frames;
    uint16_t remaining_frames;
    int8_t direction_x;
    int8_t direction_y;
    uint8_t active;
} vn_sprite_move_t;

static vn_scene_pack_cache_t active_scene_pack __attribute__((section(".bss")));
static uint16_t variable_values[PCE_VN_VARIABLE_STORAGE_COUNT] __attribute__((section(".bss")));
static vdc_sprite_t sprite_shadow[64] __attribute__((section(".bss")));
static vn_sprite_slot_t sprite_slots[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static vn_sprite_move_t sprite_moves[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sync_sprite_move_slot = 0xffu;
static uint16_t sprite_slot_pattern_base[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_slot_palette_bank[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_slot_pattern_valid[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_animation_refresh_mask __attribute__((section(".bss")));
static uint16_t blank_bat_row[VN_MAP_WIDTH] __attribute__((section(".bss")));
/* Keep pointer-addressed scratch outside .zp.bss. llvm-mos can use direct-page
 * addresses for tiny objects, but memcpy/TIA/generic pointer writes need real
 * CPU RAM addresses at $2000+. */
static uint16_t msg_bat_row[VN_MSG_TILE_COLS] __attribute__((section(".bss")));
static uint8_t msg_tile[32] __attribute__((section(".bss")));
static uint8_t msg_tile_batch[VN_MSG_GLYPH_MAX_TILES][32] __attribute__((section(".bss")));
static uint16_t msg_tile_batch_addr[VN_MSG_GLYPH_MAX_TILES] __attribute__((section(".bss")));
static uint8_t msg_mask8[8] __attribute__((section(".bss")));
static uint16_t msg_gmask[VN_GLYPH_MASK_WORDS] __attribute__((section(".bss")));
static uint16_t composer_prev_mask[VN_GLYPH_MASK_WORDS] __attribute__((section(".bss")));
static uint8_t msg_tile_batch_count;
static uint8_t composer_prev_col;
static uint8_t composer_prev_valid;
static uint8_t composer_row;
static unsigned int current_scene;
static uint16_t current_command;
#if PCE_VN_HAS_FULL_SCREEN_BG
static uint8_t current_scene_full_screen_bg __attribute__((section(".bss")));
static uint8_t full_screen_bg_text_vram_dirty __attribute__((section(".bss")));
#endif
static int16_t current_bg_index = -1;
static uint8_t current_bg_palette_bank;
static uint8_t current_bg_x __attribute__((section(".bss")));
static uint8_t current_bg_y __attribute__((section(".bss")));
static uint8_t current_bg_display_valid __attribute__((section(".bss")));
static uint8_t last_pad;
static int16_t active_message_index = -1;
static pce_vn_message_t active_message_state __attribute__((section(".bss")));
static int16_t active_message_mouth_animation_index __attribute__((section(".bss")));
static uint8_t message_glyph_pos;
static uint16_t message_glyph_byte;
static uint8_t message_frame_timer;
static uint8_t message_col;
static uint8_t message_row;
static uint8_t message_complete = 1u;
static uint8_t message_auto_wait;
static uint8_t message_wait_indicator_state;
static uint8_t message_text_speed;
static int16_t active_choice_index = -1;
static uint8_t choice_selected_index;
static uint8_t choice_cursor_pattern_row __attribute__((section(".bss")));
static uint16_t wait_frames_remaining;
static uint8_t sync_input_mask;
static uint16_t sync_input_target = PCE_VN_NO_COMMAND;
#define VN_ASYNC_INPUT_WATCHER_CAPACITY 7u
static uint8_t async_input_watcher_count;
static uint8_t async_input_masks[VN_ASYNC_INPUT_WATCHER_CAPACITY] __attribute__((section(".bss")));
static uint16_t async_input_targets[VN_ASYNC_INPUT_WATCHER_CAPACITY] __attribute__((section(".bss")));
static vn_spritetext_slot_t spritetext_slots[VN_SPRITETEXT_SLOT_COUNT] __attribute__((section(".bss")));
static uint16_t vdc_control_shadow = VN_VDC_CONTROL_BASE;
static vn_psg_player_t psg_song __attribute__((section(".bss")));
static vn_psg_player_t psg_sfx __attribute__((section(".bss")));
static vn_psg_voice_t psg_hardware_voices[6] __attribute__((section(".bss")));

static void VN_HUCARD_CODE_PSG psg_advance(uint8_t frames);
static void VN_HUCARD_CODE_SCRIPT advance_story(void);
static void VN_HUCARD_CODE_SCRIPT show_scene(unsigned int scene_index);
static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_u8(const vn_scene_pack_cache_t *cache, uint16_t offset);
static void VN_HUCARD_CODE_TEXT clear_spritetext_slots(void);
static void VN_HUCARD_CODE_TEXT redraw_spritetext_slots(void);
#if PCE_VN_HAS_FULL_SCREEN_BG
static void VN_HUCARD_CODE_VIDEO restore_text_vram_after_full_screen_bg(void);
#endif

static void wait_vblank(void)
{
    /* VDC status polling is pure wait work. Run it at the HuC6280 low CPU
       speed so emulators do not dispatch high-speed I/O reads for almost the
       entire frame, then restore high speed before returning. */
    __asm__ volatile(
        "csl\n"
        "ldy #$80\n"
        "vn_hu_wait_vblank_end_outer%=:\n"
        "ldx #$ff\n"
        "vn_hu_wait_vblank_end_inner%=:\n"
        "lda $0000\n"
        "and #$20\n"
        "beq vn_hu_wait_vblank_start%=\n"
        "dex\n"
        "bne vn_hu_wait_vblank_end_inner%=\n"
        "dey\n"
        "bne vn_hu_wait_vblank_end_outer%=\n"
        "vn_hu_wait_vblank_start%=:\n"
        "ldy #$80\n"
        "vn_hu_wait_vblank_start_outer%=:\n"
        "ldx #$ff\n"
        "vn_hu_wait_vblank_start_inner%=:\n"
        "lda $0000\n"
        "and #$20\n"
        "bne vn_hu_wait_vblank_done%=\n"
        "dex\n"
        "bne vn_hu_wait_vblank_start_inner%=\n"
        "dey\n"
        "bne vn_hu_wait_vblank_start_outer%=\n"
        "vn_hu_wait_vblank_done%=:\n"
        "csh\n"
        :
        :
        : "a", "x", "y", "memory");
}

static void set_vdc_control(uint16_t control)
{
    vdc_control_shadow = control;
    pce_vdc_poke(VDC_REG_CONTROL, control);
}

static void VN_HUCARD_CODE_VIDEO display_disable(void)
{
    set_vdc_control(VN_VDC_CONTROL_BASE);
}

static void VN_HUCARD_CODE_VIDEO display_enable(void)
{
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
}

static void vn_vdc_set_copy_word(void)
{
    pce_vdc_poke(VDC_REG_CONTROL, vdc_control_shadow);
}

static void vn_vram_copy(uint16_t dest, const void *source, uint16_t byte_count)
{
    vn_vdc_set_copy_word();
    pce_vdc_copy_to_vram(dest, source, byte_count);
}

static void service_psg(void)
{
    psg_advance(VN_PSG_VBLANK_FRAMES_PER_SERVICE);
}

static void service_psg_during_blocking_work(void)
{
    wait_vblank();
    service_psg();
}

static uint16_t VN_HUCARD_CODE_SUPPORT scale_vce_color(uint16_t color, uint8_t level)
{
    uint16_t r = color & 0x0007u;
    uint16_t g = (color >> 3) & 0x0007u;
    uint16_t b = (color >> 6) & 0x0007u;
    r = (uint16_t)((r * level) / 16u);
    g = (uint16_t)((g * level) / 16u);
    b = (uint16_t)((b * level) / 16u);
    return (uint16_t)(r | (g << 3) | (b << 6));
}

static uint16_t VN_HUCARD_CODE_TEXT ui_text_color_word(uint16_t color)
{
    return color == PCE_VN_MESSAGE_COLOR_NONE ? 0x01ffu : color;
}

static void VN_HUCARD_CODE_TEXT write_ui_text_palette(uint16_t color)
{
    uint8_t i;
    const uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    pce_vce_set_color(base, 0x0000u);
    for (i = 1u; i < 16u; i++)
    {
        pce_vce_set_color((uint16_t)(base + i), color);
    }
}

static uint16_t data_ref_size(const pce_editor_data_ref_t *ref)
{
    return ref ? ref->size : 0u;
}

static uint8_t data_ref_byte_at(const pce_editor_data_ref_t *ref, uint16_t offset)
{
    uint8_t i;
    uint16_t base = 0u;
    if (!ref || offset >= ref->size) return 0u;
    if (ref->chunk_count && ref->chunks)
    {
        for (i = 0u; i < ref->chunk_count; i++)
        {
            const pce_editor_data_chunk_t *chunk = &ref->chunks[i];
            if (offset < (uint16_t)(base + chunk->size))
            {
                pce_editor_map_asset_bank(chunk->bank);
                return chunk->data[(uint16_t)(offset - base)];
            }
            base = (uint16_t)(base + chunk->size);
        }
        return 0u;
    }
    return ref->data ? ref->data[offset] : 0u;
}

static uint16_t data_ref_u16_at(const pce_editor_data_ref_t *ref, uint16_t offset)
{
    return (uint16_t)(data_ref_byte_at(ref, offset) | ((uint16_t)data_ref_byte_at(ref, (uint16_t)(offset + 1u)) << 8));
}

static void data_ref_copy_to_ram(const pce_editor_data_ref_t *ref, uint16_t offset, uint8_t *dest, uint16_t byte_count)
{
    uint16_t i;
    for (i = 0u; i < byte_count; i++)
    {
        dest[i] = data_ref_byte_at(ref, (uint16_t)(offset + i));
    }
}

static void VN_HUCARD_CODE_VIDEO copy_data_ref_to_vram_guarded(uint16_t dest, const pce_editor_data_ref_t *ref)
{
    uint8_t i;
    uint16_t word_offset = 0u;
    if (!ref || !ref->size) return;
    if (ref->chunk_count && ref->chunks)
    {
        for (i = 0u; i < ref->chunk_count; i++)
        {
            const pce_editor_data_chunk_t *chunk = &ref->chunks[i];
            uint16_t copied = 0u;
            if (!chunk->data || !chunk->size) continue;
            while (copied < chunk->size)
            {
                uint16_t slice = (uint16_t)(chunk->size - copied);
                if (slice > VN_VRAM_SLICE_BYTES) slice = VN_VRAM_SLICE_BYTES;
                service_psg_during_blocking_work();
                pce_editor_map_asset_bank(chunk->bank);
                vn_vram_copy((uint16_t)(dest + word_offset), chunk->data + copied, slice);
                copied = (uint16_t)(copied + slice);
                word_offset = (uint16_t)(word_offset + ((slice + 1u) / 2u));
            }
        }
        return;
    }
    if (ref->data)
    {
        uint16_t copied = 0u;
        while (copied < ref->size)
        {
            uint16_t slice = (uint16_t)(ref->size - copied);
            if (slice > VN_VRAM_SLICE_BYTES) slice = VN_VRAM_SLICE_BYTES;
            service_psg_during_blocking_work();
            vn_vram_copy((uint16_t)(dest + word_offset), ref->data + copied, slice);
            copied = (uint16_t)(copied + slice);
            word_offset = (uint16_t)(word_offset + ((slice + 1u) / 2u));
        }
    }
}

static void VN_HUCARD_CODE_VIDEO upload_palette(const pce_editor_data_ref_t *palette, uint16_t base, uint8_t level)
{
    uint8_t i;
    uint16_t color_count;
    if (!palette) return;
    color_count = (uint16_t)(data_ref_size(palette) / 2u);
    if (color_count > VN_BG_PALETTE_COLORS) color_count = VN_BG_PALETTE_COLORS;
    for (i = 0u; i < color_count; i++)
    {
        const uint16_t raw = data_ref_u16_at(palette, (uint16_t)(i * 2u));
        pce_vce_set_color((uint16_t)(base + i), scale_vce_color(raw, level));
    }
    for (; i < VN_BG_PALETTE_COLORS; i++)
    {
        pce_vce_set_color((uint16_t)(base + i), 0u);
    }
}

static void VN_HUCARD_CODE_VIDEO fade_palette(const pce_editor_data_ref_t *palette, uint16_t base, uint8_t frames, uint8_t fade_in)
{
    uint8_t step;
    if (!frames)
    {
        upload_palette(palette, base, fade_in ? 16u : 0u);
        return;
    }
    for (step = 0u; step <= frames; step++)
    {
        const uint8_t level = fade_in
            ? (uint8_t)(((uint16_t)step * 16u) / frames)
            : (uint8_t)(16u - (((uint16_t)step * 16u) / frames));
        upload_palette(palette, base, level);
        service_psg_during_blocking_work();
    }
}

static uint16_t VN_HUCARD_CODE_VIDEO bg_blank_tile_index(const pce_editor_bg_asset_t *bg)
{
    (void)bg;
    return VN_UI_BLANK_TILE;
}

static void VN_HUCARD_CODE_VIDEO clear_screen_map_with_tile(uint16_t blank_word)
{
    uint8_t row;
    uint8_t col;
    for (col = 0u; col < VN_MAP_WIDTH; col++)
    {
        blank_bat_row[col] = blank_word;
    }
    for (row = 0u; row < VN_MAP_HEIGHT; row++)
    {
        if ((row & 3u) == 0u) service_psg_during_blocking_work();
        vn_vram_copy((uint16_t)((uint16_t)row * VN_MAP_WIDTH), blank_bat_row, (uint16_t)sizeof(blank_bat_row));
    }
}

static void VN_HUCARD_CODE_VIDEO clear_screen_map(const pce_editor_bg_asset_t *bg)
{
    uint8_t blank_tile[VN_BG_TILE_BYTES];
    uint8_t i;
    const uint16_t tile = bg_blank_tile_index(bg);
    const uint16_t word = (uint16_t)(((uint16_t)(bg ? bg->palette_bank : 0u) << 12) | tile);
    for (i = 0u; i < VN_BG_TILE_BYTES; i++) blank_tile[i] = 0u;
    service_psg_during_blocking_work();
    vn_vram_copy((uint16_t)(tile * 16u), blank_tile, VN_BG_TILE_BYTES);
    clear_screen_map_with_tile(word);
}

static void VN_HUCARD_CODE_VIDEO upload_bg_graphics(const pce_editor_bg_asset_t *bg, uint8_t tile_x, uint8_t tile_y, uint8_t palette_level)
{
    uint8_t row;
    uint8_t map_row[64];
    uint16_t row_bytes;
    uint16_t source_width;
    if (!bg) return;
    clear_screen_map(bg);
    upload_palette(&bg->palette, (uint16_t)(bg->palette_bank * 16u), palette_level);
    copy_data_ref_to_vram_guarded((uint16_t)(bg->tile_base * 16u), &bg->tiles);
    row_bytes = (uint16_t)(bg->width_tiles * 2u);
    if (row_bytes > sizeof(map_row)) row_bytes = sizeof(map_row);
    source_width = (uint16_t)(row_bytes / 2u);
    for (row = 0u; row < bg->height_tiles; row++)
    {
        if ((uint16_t)tile_y + row >= VN_VISIBLE_HEIGHT) break;
        if ((row & 3u) == 0u) service_psg_during_blocking_work();
        data_ref_copy_to_ram(&bg->map, (uint16_t)((uint16_t)row * (uint16_t)(bg->width_tiles * 2u)), map_row, row_bytes);
        vn_vram_copy((uint16_t)(((uint16_t)(tile_y + row) * VN_MAP_WIDTH) + tile_x), map_row, (uint16_t)(source_width * 2u));
    }
}

static uint8_t VN_HUCARD_CODE_VIDEO background_display_matches(int16_t bg_index, uint16_t tile_x, uint16_t tile_y)
{
    const uint8_t next_x = tile_x < VN_MAP_WIDTH ? (uint8_t)tile_x : 0u;
    const uint8_t next_y = tile_y < VN_VISIBLE_HEIGHT ? (uint8_t)tile_y : 0u;
    if (bg_index < 0 || (uint16_t)bg_index >= pce_editor_bg_asset_count) return 0u;
    if (!current_bg_display_valid
        || current_bg_index != bg_index
        || current_bg_x != next_x
        || current_bg_y != next_y)
    {
        return 0u;
    }
#if PCE_VN_HAS_FULL_SCREEN_BG
    /* A Full BG consumes the message blank tile.  Its dirty state is part of
       the displayed BG state, so a normal/full scene-mode change reuploads. */
    if (current_scene_full_screen_bg)
    {
        if (!full_screen_bg_text_vram_dirty) return 0u;
    }
    else if (full_screen_bg_text_vram_dirty)
    {
        return 0u;
    }
#endif
    return 1u;
}

static void VN_HUCARD_CODE_VIDEO set_background(int16_t bg_index, uint8_t transition, uint8_t fade_out_frames, uint8_t fade_in_frames, uint16_t tile_x, uint16_t tile_y)
{
    const pce_editor_bg_asset_t *bg;
    const uint8_t fade_transition = (uint8_t)(transition == PCE_VN_BG_TRANSITION_FADE);
    const uint8_t bg_fade_out_frames = fade_out_frames == 1u ? 0u : fade_out_frames;
    const uint8_t bg_fade_in_frames = fade_in_frames == 1u ? 0u : fade_in_frames;
    const uint8_t next_x = tile_x < VN_MAP_WIDTH ? (uint8_t)tile_x : 0u;
    const uint8_t next_y = tile_y < VN_VISIBLE_HEIGHT ? (uint8_t)tile_y : 0u;
    if (bg_index < 0 || (uint16_t)bg_index >= pce_editor_bg_asset_count) return;
    if (background_display_matches(bg_index, tile_x, tile_y)) return;
    bg = &pce_editor_bg_assets[bg_index];
    if (current_bg_index >= 0 && fade_transition && bg_fade_out_frames)
    {
        const pce_editor_bg_asset_t *old_bg = &pce_editor_bg_assets[current_bg_index];
        fade_palette(&old_bg->palette, (uint16_t)(current_bg_palette_bank * 16u), bg_fade_out_frames, 0u);
    }
    if (fade_transition) display_disable();
#if PCE_VN_HAS_FULL_SCREEN_BG
    restore_text_vram_after_full_screen_bg();
#endif
    current_bg_index = bg_index;
    current_bg_palette_bank = bg->palette_bank;
    upload_bg_graphics(bg,
        next_x,
        next_y,
        fade_transition && bg_fade_in_frames ? 0u : 16u);
    current_bg_x = next_x;
    current_bg_y = next_y;
    current_bg_display_valid = 1u;
#if PCE_VN_HAS_FULL_SCREEN_BG
    if (current_scene_full_screen_bg) full_screen_bg_text_vram_dirty = 1u;
#endif
    if (fade_transition)
    {
        display_enable();
        if (bg_fade_in_frames)
        {
            fade_palette(&bg->palette, (uint16_t)(bg->palette_bank * 16u), bg_fade_in_frames, 1u);
        }
    }
}

static uint16_t VN_HUCARD_CODE_TEXT ui_tile(uint16_t tile)
{
    return (uint16_t)(((uint16_t)VN_UI_PALETTE << 12) | tile);
}

static void VN_HUCARD_CODE_TEXT map_message_window_cells_now(uint8_t blank)
{
    uint8_t tr;
    uint8_t tc;
    /* Map the whole window BAT inside a single VBlank. A per-row wait_vblank
       spread this 8-row strip over 8 frames, which read as a top-to-bottom wipe
       when the message window is shown or hidden. All VN_MSG_TILE_ROWS *
       VN_MSG_TILE_COLS (=208) BAT words fit comfortably in one VBlank, so write
       them in one pass for an instant show/clear (matches the CD runtime, which
       never waits per row). */
    for (tr = 0u; tr < VN_MSG_TILE_ROWS; tr++)
    {
        const uint16_t row_tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE + ((uint16_t)tr * VN_MSG_TILE_COLS));
        for (tc = 0u; tc < VN_MSG_TILE_COLS; tc++)
        {
            msg_bat_row[tc] = ui_tile(blank ? VN_UI_BLANK_TILE : (uint16_t)(row_tile + tc));
        }
        vn_vram_copy((uint16_t)(((VN_TEXT_Y + tr) * VN_MAP_WIDTH) + VN_TEXT_X), msg_bat_row, (uint16_t)(VN_MSG_TILE_COLS * 2u));
    }
}

static void VN_HUCARD_CODE_TEXT map_message_window_cells(uint8_t blank)
{
    wait_vblank();
    map_message_window_cells_now(blank);
    service_psg();
}

/* Keep the arrow glyph in the strip row where the choice was first drawn and
   move only its 2x2 BAT cells. Choice text starts at logical column 2, so these
   cells never share a tile with the first option glyph. */
static void VN_HUCARD_CODE_TEXT map_choice_cursor_cells_now(uint8_t row, uint8_t visible)
{
    uint8_t sub;
    const uint8_t tc0 = (uint8_t)(((uint16_t)VN_CHOICE_CURSOR_COL * VN_GLYPH_W) >> 3);
    const uint8_t source_row = choice_cursor_pattern_row < VN_TEXT_ROWS ? choice_cursor_pattern_row : 0u;
    if (row >= VN_TEXT_ROWS) return;
    for (sub = 0u; sub < 2u; sub++)
    {
        const uint16_t strip_tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
            + ((uint16_t)(((source_row * 2u) + sub) * VN_MSG_TILE_COLS)) + tc0);
        msg_bat_row[0] = ui_tile(visible ? strip_tile : VN_UI_BLANK_TILE);
        msg_bat_row[1] = ui_tile(visible ? (uint16_t)(strip_tile + 1u) : VN_UI_BLANK_TILE);
        vn_vram_copy((uint16_t)(((VN_TEXT_Y + (row * 2u) + sub) * VN_MAP_WIDTH) + VN_TEXT_X + tc0),
            msg_bat_row, 4u);
    }
}

static void VN_HUCARD_CODE_TEXT clear_window_tile_pixels(void)
{
    uint16_t tile;
    uint8_t i;
    for (i = 0u; i < 32u; i++) msg_tile[i] = 0u;
    for (tile = 0u; tile < VN_MSG_TILE_COUNT; tile++)
    {
        if ((tile & (VN_MSG_CLEAR_TILES_PER_VBLANK - 1u)) == 0u) service_psg_during_blocking_work();
        vn_vram_copy((uint16_t)((VN_MSG_STRIP_TILE_BASE + tile) * 16u), msg_tile, 32u);
    }
    composer_prev_valid = 0u;
    composer_row = 0xffu;
}

static void VN_HUCARD_CODE_VIDEO upload_blank_tile(void)
{
    uint8_t i;
    for (i = 0u; i < 32u; i++) msg_tile[i] = 0u;
    service_psg_during_blocking_work();
    vn_vram_copy((uint16_t)(VN_UI_BLANK_TILE * 16u), msg_tile, 32u);
}

#if PCE_VN_HAS_FULL_SCREEN_BG
static void VN_HUCARD_CODE_VIDEO restore_text_vram_after_full_screen_bg(void)
{
    if (!full_screen_bg_text_vram_dirty || current_scene_full_screen_bg) return;
    /* A 256x224 BG occupies every normal BG tile slot and overwrites the
       message strip's shared blank pattern. Restore that pattern before a
       normal BG clear or message-window BAT update can reference it. */
    upload_blank_tile();
    full_screen_bg_text_vram_dirty = 0u;
}
#endif

static uint16_t VN_HUCARD_CODE_TEXT vn_glyph_decode(uint16_t glyph_offset, uint16_t pos)
{
    const uint8_t b = scene_pack_u8(&active_scene_pack, (uint16_t)(glyph_offset + pos));
    if (b == PCE_VN_GLYPH_ESCAPE)
    {
        return (uint16_t)(
            (uint16_t)scene_pack_u8(&active_scene_pack, (uint16_t)(glyph_offset + pos + 1u))
            | ((uint16_t)scene_pack_u8(&active_scene_pack, (uint16_t)(glyph_offset + pos + 2u)) << 8));
    }
    if (b == 0xfeu) return PCE_VN_GLYPH_NEWLINE;
    if (b == 0xffu) return PCE_VN_GLYPH_END;
    return b;
}

static uint16_t VN_HUCARD_CODE_TEXT vn_glyph_stride(uint16_t glyph_offset, uint16_t pos)
{
    return scene_pack_u8(&active_scene_pack, (uint16_t)(glyph_offset + pos)) == PCE_VN_GLYPH_ESCAPE ? 3u : 1u;
}

static void VN_HUCARD_CODE_TEXT load_glyph_mask(uint16_t glyph, uint16_t *mask)
{
    uint8_t row;
    const uint16_t offset = (uint16_t)(glyph * (VN_GLYPH_MASK_WORDS * 2u));
    for (row = 0u; row < VN_GLYPH_MASK_WORDS; row++)
    {
        mask[row] = data_ref_u16_at(&pce_vn_font_data_ref, (uint16_t)(offset + ((uint16_t)row * 2u)));
    }
}

static void VN_HUCARD_CODE_TEXT encode_msg_tile(const uint8_t *mask8, uint8_t *out32)
{
    uint8_t sy;
    for (sy = 0u; sy < 8u; sy++)
    {
        const uint8_t m = mask8[sy];
        out32[(uint16_t)sy * 2u] = m;
        out32[((uint16_t)sy * 2u) + 1u] = m;
        out32[16u + ((uint16_t)sy * 2u)] = m;
        out32[16u + ((uint16_t)sy * 2u) + 1u] = m;
    }
}

static void VN_HUCARD_CODE_TEXT reset_msg_tile_batch(void)
{
    msg_tile_batch_count = 0u;
}

static void VN_HUCARD_CODE_TEXT queue_msg_tile(uint16_t tile, const uint8_t *tile_data)
{
    uint8_t i;
    uint8_t *dest;
    if (msg_tile_batch_count >= VN_MSG_GLYPH_MAX_TILES) return;
    msg_tile_batch_addr[msg_tile_batch_count] = (uint16_t)(tile * 16u);
    dest = msg_tile_batch[msg_tile_batch_count];
    for (i = 0u; i < 32u; i++) dest[i] = tile_data[i];
    msg_tile_batch_count++;
}

static void VN_HUCARD_CODE_TEXT flush_msg_tile_batch_now(void)
{
    uint8_t i;
    if (!msg_tile_batch_count) return;
    for (i = 0u; i < msg_tile_batch_count; i++)
    {
        vn_vram_copy(msg_tile_batch_addr[i], msg_tile_batch[i], 32u);
    }
    msg_tile_batch_count = 0u;
}

static void VN_HUCARD_CODE_TEXT flush_msg_tile_batch(void)
{
    if (!msg_tile_batch_count) return;
    wait_vblank();
    flush_msg_tile_batch_now();
    /* This flush spends one whole VBlank (the wait_vblank above). PSG tempo is
       driven by "one service per elapsed frame", so account for that frame here
       or the BGM drags by one tick on every glyph reveal during typewriter. */
    service_psg();
}

static void VN_HUCARD_CODE_TEXT add_glyph_tile(const uint16_t *gmask, uint16_t gpx0, uint8_t tile_x0, uint8_t sub, uint8_t *mask8)
{
    const uint16_t gpx1 = (uint16_t)(gpx0 + VN_GLYPH_W);
    const uint16_t tile_x1 = (uint16_t)(tile_x0 + 8u);
    uint8_t px_start = 0u;
    uint8_t px_end = 8u;
    uint8_t sy;
    if (gpx1 <= tile_x0 || gpx0 >= tile_x1) return;
    if (gpx0 > tile_x0) px_start = (uint8_t)(gpx0 - tile_x0);
    if (gpx1 < tile_x1) px_end = (uint8_t)(gpx1 - tile_x0);
    for (sy = 0u; sy < 8u; sy++)
    {
        const uint8_t band_y = (uint8_t)((sub * 8u) + sy);
        uint8_t gy;
        uint16_t mrow;
        uint8_t px;
        if (band_y < VN_GLYPH_Y_OFFSET) continue;
        gy = (uint8_t)(band_y - VN_GLYPH_Y_OFFSET);
        if (gy >= VN_GLYPH_H) continue;
        mrow = gmask[gy];
        for (px = px_start; px < px_end; px++)
        {
            const uint8_t gx = (uint8_t)(((uint16_t)tile_x0 + px) - gpx0);
            if (mrow & (uint16_t)(0x8000u >> gx))
            {
                mask8[sy] |= (uint8_t)(0x80u >> px);
            }
        }
    }
}

static void VN_HUCARD_CODE_TEXT draw_message_glyph_at_impl(uint16_t glyph, uint8_t col, uint8_t row, uint8_t wait_for_vblank, uint8_t isolated)
{
    const uint16_t px0 = (uint16_t)col * VN_GLYPH_W;
    const uint8_t tc0 = (uint8_t)(px0 >> 3);
    const uint8_t tc1 = (uint8_t)((px0 + VN_GLYPH_W - 1u) >> 3);
    const uint16_t prev_px0 = (uint16_t)composer_prev_col * VN_GLYPH_W;
    uint8_t use_prev;
    uint8_t tc;
    uint8_t k;
    if (glyph == 0u || glyph == PCE_VN_GLYPH_NEWLINE || glyph == PCE_VN_GLYPH_END)
    {
        if (!isolated) composer_prev_valid = 0u;
        return;
    }
    if (!isolated && (row != composer_row || col <= composer_prev_col)) composer_prev_valid = 0u;
    use_prev = isolated ? 0u : composer_prev_valid;
    load_glyph_mask(glyph, msg_gmask);
    reset_msg_tile_batch();
    for (tc = tc0; tc <= tc1 && tc < VN_MSG_TILE_COLS; tc++)
    {
        const uint8_t tile_x0 = (uint8_t)(tc * 8u);
        uint8_t sub;
        for (sub = 0u; sub < 2u; sub++)
        {
            const uint16_t tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE + ((uint16_t)((row * 2u) + sub) * VN_MSG_TILE_COLS) + tc);
            for (k = 0u; k < 8u; k++) msg_mask8[k] = 0u;
            add_glyph_tile(msg_gmask, px0, tile_x0, sub, msg_mask8);
            if (use_prev) add_glyph_tile(composer_prev_mask, prev_px0, tile_x0, sub, msg_mask8);
            encode_msg_tile(msg_mask8, msg_tile);
            queue_msg_tile(tile, msg_tile);
        }
    }
    if (wait_for_vblank) flush_msg_tile_batch();
    else flush_msg_tile_batch_now();
    if (!isolated)
    {
        for (k = 0u; k < VN_GLYPH_MASK_WORDS; k++) composer_prev_mask[k] = msg_gmask[k];
        composer_prev_col = col;
        composer_prev_valid = 1u;
        composer_row = row;
    }
}

static void VN_HUCARD_CODE_TEXT draw_message_glyph_at(uint16_t glyph, uint8_t col, uint8_t row)
{
    draw_message_glyph_at_impl(glyph, col, row, 1u, 0u);
}

static void VN_HUCARD_CODE_TEXT draw_message_glyph_at_now(uint16_t glyph, uint8_t col, uint8_t row)
{
    draw_message_glyph_at_impl(glyph, col, row, 0u, 0u);
}

static void VN_HUCARD_CODE_TEXT draw_message_indicator_glyph_at(uint16_t glyph, uint8_t col, uint8_t row)
{
    draw_message_glyph_at_impl(glyph, col, row, 1u, 1u);
}

static void VN_HUCARD_CODE_TEXT clear_message_glyph_area(uint8_t col, uint8_t row)
{
    const uint16_t px0 = (uint16_t)col * VN_GLYPH_W;
    const uint8_t tc0 = (uint8_t)(px0 >> 3);
    const uint8_t tc1 = (uint8_t)((px0 + VN_GLYPH_W - 1u) >> 3);
    uint8_t tc;
    uint8_t sub;
    uint8_t k;
    /* The reserved wait/AUTO cursor starts on a tile boundary and never shares
       a tile with message text. Clearing it while typewriter text is still
       revealing must therefore preserve the stream's saved left neighbour. */
    if (col != VN_WAIT_CURSOR_COL || row != VN_WAIT_CURSOR_ROW)
    {
        composer_prev_valid = 0u;
        composer_row = 0xffu;
    }
    for (k = 0u; k < 32u; k++) msg_tile[k] = 0u;
    reset_msg_tile_batch();
    for (tc = tc0; tc <= tc1 && tc < VN_MSG_TILE_COLS; tc++)
    {
        for (sub = 0u; sub < 2u; sub++)
        {
            const uint16_t tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE + ((uint16_t)((row * 2u) + sub) * VN_MSG_TILE_COLS) + tc);
            queue_msg_tile(tile, msg_tile);
        }
    }
    flush_msg_tile_batch();
}

static uint8_t VN_HUCARD_CODE_TEXT draw_message_next_entry_impl(const pce_vn_message_t *message, uint8_t wait_for_vblank)
{
    uint16_t glyph;
    if (!message || !message->glyph_count) return 1u;
    if (message_glyph_pos >= message->glyph_count) return 1u;
    glyph = vn_glyph_decode(message->glyph_offset, message_glyph_byte);
    message_glyph_byte = (uint16_t)(message_glyph_byte + vn_glyph_stride(message->glyph_offset, message_glyph_byte));
    message_glyph_pos++;
    if (glyph == PCE_VN_GLYPH_END) return 1u;
    if (glyph == PCE_VN_GLYPH_NEWLINE)
    {
        message_col = 0u;
        message_row++;
        composer_prev_valid = 0u;
        return message_row >= VN_TEXT_ROWS ? 1u : 0u;
    }
    if (wait_for_vblank) draw_message_glyph_at(glyph, message_col, message_row);
    else draw_message_glyph_at_now(glyph, message_col, message_row);
    message_col++;
    if (message_col >= (message_row == VN_WAIT_CURSOR_ROW ? VN_WAIT_CURSOR_COL : VN_TEXT_COLS))
    {
        message_col = 0u;
        message_row++;
        composer_prev_valid = 0u;
        if (message_row >= VN_TEXT_ROWS) return 1u;
    }
    return message_glyph_pos >= message->glyph_count ? 1u : 0u;
}

static uint8_t VN_HUCARD_CODE_TEXT draw_message_next_entry(const pce_vn_message_t *message)
{
    return draw_message_next_entry_impl(message, 1u);
}

static uint8_t VN_HUCARD_CODE_TEXT draw_message_next_entry_now(const pce_vn_message_t *message)
{
    return draw_message_next_entry_impl(message, 0u);
}

static uint8_t VN_HUCARD_CODE_TEXT draw_message_prefix_glyphs(const pce_vn_message_t *message)
{
    uint8_t instant_glyph_count;
    uint8_t i;
    if (!message || !message->glyph_count) return 1u;
    instant_glyph_count = message->instant_glyph_count;
    for (i = 0u; i < instant_glyph_count; i++)
    {
        if (draw_message_next_entry(message)) return 1u;
    }
    return message_glyph_pos >= message->glyph_count ? 1u : 0u;
}

static void VN_HUCARD_CODE_TEXT draw_message_text(const pce_vn_message_t *message)
{
    while (!draw_message_next_entry(message)) {}
    message_complete = 1u;
}

static void VN_HUCARD_CODE_TEXT blank_message_wait_indicator(void)
{
    clear_message_glyph_area(VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW);
}

static void VN_HUCARD_CODE_TEXT show_message_wait_indicator(void)
{
    message_wait_indicator_state = VN_MESSAGE_INDICATOR_WAIT_VISIBLE;
    message_frame_timer = 0u;
    draw_message_indicator_glyph_at(PCE_VN_MESSAGE_WAIT_GLYPH, VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW);
}

static void VN_HUCARD_CODE_TEXT show_message_auto_indicator(void)
{
    message_wait_indicator_state = VN_MESSAGE_INDICATOR_AUTO;
    draw_message_indicator_glyph_at(PCE_VN_MESSAGE_AUTO_GLYPH, VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW);
}

static void VN_HUCARD_CODE_TEXT hide_message_wait_indicator(void)
{
    if (message_wait_indicator_state)
    {
        blank_message_wait_indicator();
    }
    if (message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO)
        message_frame_timer = 0u;
    message_wait_indicator_state = VN_MESSAGE_INDICATOR_HIDDEN;
}

static void VN_HUCARD_CODE_TEXT reset_message_wait_indicator_state(void)
{
    message_wait_indicator_state = 0u;
    message_frame_timer = 0u;
}

static void VN_HUCARD_CODE_SPRITE_STATE restore_active_message_mouth(void)
{
    const int16_t normal_animation_index = active_message_mouth_animation_index;
    const int16_t mouth_slot = active_message_state.mouth_slot;
    vn_sprite_slot_t *state;
    if (normal_animation_index < 0) return;
    active_message_mouth_animation_index = -1;
    if (mouth_slot < 0 || mouth_slot >= VN_SPRITE_SLOT_COUNT) return;
    state = &sprite_slots[(uint8_t)mouth_slot];
    if (state->animation_index != normal_animation_index + 1) return;
    state->animation_index = normal_animation_index;
    state->frame = 0u;
    state->timer = 0u;
    sprite_animation_refresh_mask |= (uint8_t)(1u << (uint8_t)mouth_slot);
}

static void VN_HUCARD_CODE_TEXT refresh_message_wait_indicator(void)
{
    if (active_message_index >= 0 && message_complete) restore_active_message_mouth();
    if (active_message_index < 0)
    {
        hide_message_wait_indicator();
        return;
    }
    if (variable_values[PCE_VN_VARIABLE_AUTO_ENABLE_INDEX] != 0u)
    {
        if (message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO)
        {
            hide_message_wait_indicator();
            show_message_auto_indicator();
        }
        return;
    }
    if (message_wait_indicator_state == VN_MESSAGE_INDICATOR_AUTO)
        hide_message_wait_indicator();
    if (!message_complete) return;
    if (!message_wait_indicator_state) show_message_wait_indicator();
}

static void VN_HUCARD_CODE_TEXT tick_message_wait_indicator(void)
{
    if (active_message_index < 0)
    {
        hide_message_wait_indicator();
        return;
    }
    if (variable_values[PCE_VN_VARIABLE_AUTO_ENABLE_INDEX] != 0u)
    {
        if (message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO)
        {
            hide_message_wait_indicator();
            show_message_auto_indicator();
        }
        return;
    }
    if (message_wait_indicator_state == VN_MESSAGE_INDICATOR_AUTO)
        hide_message_wait_indicator();
    if (!message_complete) return;
    if (!message_wait_indicator_state)
    {
        show_message_wait_indicator();
        return;
    }
    message_frame_timer++;
    if (message_frame_timer < VN_WAIT_CURSOR_BLINK_FRAMES) return;
    message_frame_timer = 0u;
    if (message_wait_indicator_state == VN_MESSAGE_INDICATOR_WAIT_BLANK)
    {
        show_message_wait_indicator();
    }
    else
    {
        message_wait_indicator_state = VN_MESSAGE_INDICATOR_WAIT_BLANK;
        blank_message_wait_indicator();
    }
}

static uint8_t VN_HUCARD_CODE_TEXT begin_message_window_vram_update(void)
{
    map_message_window_cells(1u);
    return 1u;
}

static void VN_HUCARD_CODE_TEXT end_message_window_vram_update(uint8_t restore_display)
{
    if (!restore_display) return;
    map_message_window_cells(0u);
}

static void VN_HUCARD_CODE_TEXT hide_message_window_map(void)
{
    map_message_window_cells(1u);
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_has_range(const vn_scene_pack_cache_t *cache, uint16_t offset, uint16_t length)
{
    return (uint8_t)(cache && cache->ref && offset <= cache->size && length <= (uint16_t)(cache->size - offset));
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_u8(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    if (!scene_pack_has_range(cache, offset, 1u)) return 0u;
    return data_ref_byte_at(cache->ref, offset);
}

static uint16_t VN_HUCARD_CODE_SCRIPT scene_pack_u16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    if (!scene_pack_has_range(cache, offset, 2u)) return 0u;
    return data_ref_u16_at(cache->ref, offset);
}

static int16_t VN_HUCARD_CODE_SCRIPT scene_pack_s16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    return (int16_t)scene_pack_u16(cache, offset);
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_is_valid(const vn_scene_pack_cache_t *cache)
{
    if (!cache || !cache->ref || cache->size < PCE_VN_SCENE_PACK_HEADER_SIZE) return 0u;
    if (scene_pack_u8(cache, 0u) != 'P'
        || scene_pack_u8(cache, 1u) != 'V'
        || scene_pack_u8(cache, 2u) != 'N'
        || scene_pack_u8(cache, 3u) != 'S') return 0u;
    return (uint8_t)(scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_VERSION) == PCE_VN_SCENE_PACK_VERSION);
}

static uint8_t VN_HUCARD_CODE_SCRIPT load_scene_pack_into_cache(unsigned int scene_index, vn_scene_pack_cache_t *cache)
{
    const pce_vn_scene_pack_t *pack;
    if (!cache || scene_index >= pce_vn_scene_count) return 0u;
    pack = &pce_vn_scene_packs[scene_index];
    if (!pack->data || !pack->byte_size || pack->byte_size > PCE_VN_SCENE_PACK_MAX_BYTES) return 0u;
    cache->ref = pack->data;
    cache->size = pack->byte_size;
    cache->scene_index = scene_index;
    cache->valid = scene_pack_is_valid(cache);
    return cache->valid;
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_command_count(const vn_scene_pack_cache_t *cache)
{
    return scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_COMMAND_COUNT);
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_read_command(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command)
{
    uint16_t offset;
    if (!command || command_index >= scene_pack_command_count(cache)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_COMMAND_TABLE) + ((uint16_t)command_index * PCE_VN_SCENE_PACK_COMMAND_SIZE));
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

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_read_message(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!message || message_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_MESSAGE_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_MESSAGE_TABLE) + ((uint16_t)message_index * PCE_VN_SCENE_PACK_MESSAGE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_MESSAGE_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    if (!scene_pack_has_range(cache, glyph_offset, 1u)) return 0u;
    message->glyph_offset = glyph_offset;
    message->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    message->voice_index = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    message->text_speed_frames = scene_pack_u8(cache, (uint16_t)(offset + 5u));
    message->advance_mode = scene_pack_u8(cache, (uint16_t)(offset + 6u));
    message->auto_wait_frames = scene_pack_u8(cache, (uint16_t)(offset + 7u));
    message->mouth_slot = scene_pack_s16(cache, (uint16_t)(offset + 8u));
    message->instant_glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 10u));
    message->text_color = scene_pack_u16(cache, (uint16_t)(offset + 11u));
    return 1u;
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_read_choice(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice)
{
    uint16_t offset;
    if (!choice || choice_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_CHOICE_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_CHOICE_TABLE) + ((uint16_t)choice_index * PCE_VN_SCENE_PACK_CHOICE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_CHOICE_SIZE)) return 0u;
    choice->options_offset = scene_pack_u16(cache, offset);
    choice->option_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    choice->default_index = scene_pack_u8(cache, (uint16_t)(offset + 3u));
    choice->variable_index = scene_pack_s16(cache, (uint16_t)(offset + 4u));
    return 1u;
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_read_choice_option(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!choice || !option || option_index >= choice->option_count) return 0u;
    offset = (uint16_t)(choice->options_offset + ((uint16_t)option_index * PCE_VN_SCENE_PACK_OPTION_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_OPTION_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    if (!scene_pack_has_range(cache, glyph_offset, 1u)) return 0u;
    option->glyph_offset = glyph_offset;
    option->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    option->value = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    option->target_scene = scene_pack_s16(cache, (uint16_t)(offset + 5u));
    return 1u;
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_read_switch(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch)
{
    uint16_t offset;
    if (!branch || switch_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_SWITCH_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_SWITCH_TABLE) + ((uint16_t)switch_index * PCE_VN_SCENE_PACK_SWITCH_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_SIZE)) return 0u;
    branch->cases_offset = scene_pack_u16(cache, offset);
    branch->case_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    branch->default_command = scene_pack_u16(cache, (uint16_t)(offset + 3u));
    return 1u;
}

static uint8_t VN_HUCARD_CODE_SCRIPT scene_pack_read_switch_case(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case)
{
    uint16_t offset;
    if (!branch || !branch_case || case_index >= branch->case_count) return 0u;
    offset = (uint16_t)(branch->cases_offset + ((uint16_t)case_index * PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE)) return 0u;
    branch_case->value = scene_pack_s16(cache, offset);
    branch_case->command = scene_pack_u16(cache, (uint16_t)(offset + 2u));
    return 1u;
}

static uint16_t VN_HUCARD_CODE_PSG psg_player_step_delta(const vn_psg_player_t *player)
{
    uint16_t bpm = player && player->asset && player->asset->bpm ? player->asset->bpm : 150u;
    if (bpm < 30u) bpm = 30u;
    if (bpm > 300u) bpm = 300u;
    return (uint16_t)(bpm * VN_PSG_STEPS_PER_BEAT);
}

static uint8_t VN_HUCARD_CODE_PSG psg_wave_kind(uint8_t wave)
{
    switch (wave)
    {
        case 1u: case 8u: case 13u:
            return VN_PSG_WAVE_KIND_SINE;
        case 2u: case 5u: case 11u: case 30u: case 35u: case 43u:
            return VN_PSG_WAVE_KIND_SAW;
        case 6u: case 20u: case 22u: case 24u: case 25u: case 31u:
            return VN_PSG_WAVE_KIND_TRIANGLE;
        default:
            return VN_PSG_WAVE_KIND_SQUARE;
    }
}

static uint8_t VN_HUCARD_CODE_PSG psg_wave_sample(uint8_t kind, uint8_t index)
{
    if (kind == VN_PSG_WAVE_KIND_SAW) return (uint8_t)(index & 0x1fu);
    if (kind == VN_PSG_WAVE_KIND_TRIANGLE)
    {
        return index < 16u ? (uint8_t)(index << 1u) : (uint8_t)((31u - index) << 1u);
    }
    if (kind == VN_PSG_WAVE_KIND_SINE)
    {
        const uint8_t phase = (uint8_t)(index & 0x0fu);
        const uint8_t magnitude = (uint8_t)(((uint16_t)phase * (uint16_t)(16u - phase)) >> 2u);
        if (index < 16u) return magnitude >= 15u ? 31u : (uint8_t)(16u + magnitude);
        return magnitude >= 15u ? 0u : (uint8_t)(15u - magnitude);
    }
    return (uint8_t)((index < 16u) ? 31u : 0u);
}

static void VN_HUCARD_CODE_PSG psg_load_wave(uint8_t channel, uint8_t wave)
{
    uint8_t i;
    const uint8_t kind = psg_wave_kind(wave > VN_PSG_WAVE_SQUARE ? VN_PSG_WAVE_SQUARE : wave);
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    PCE_PSG_CONTROL = 0u;
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
    for (i = 0u; i < 32u; i++)
    {
        PCE_PSG_WAVE = psg_wave_sample(kind, i);
    }
}

static void VN_HUCARD_CODE_PSG psg_stop_channel(uint8_t channel)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    PCE_PSG_CONTROL = 0u;
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
}

static void VN_HUCARD_CODE_PSG psg_set_tone(uint8_t channel, uint16_t period, uint8_t volume)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
    PCE_PSG_FREQ_LO = (uint8_t)(period & 0xffu);
    PCE_PSG_FREQ_HI = (uint8_t)((period >> 8) & 0x0fu);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static void VN_HUCARD_CODE_PSG psg_set_noise(uint8_t channel, uint8_t noise, uint8_t volume)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_NOISE = volume ? (uint8_t)(0x80u | (noise & 0x1fu)) : 0u;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static uint8_t VN_HUCARD_CODE_PSG psg_voice_matches(const vn_psg_voice_t *left, const vn_psg_voice_t *right)
{
    return (uint8_t)(left && right
        && left->active == right->active
        && left->period == right->period
        && left->volume == right->volume
        && left->noise == right->noise
        && left->wave == right->wave);
}

static void VN_HUCARD_CODE_PSG psg_render_channels(void)
{
    uint8_t channel;
    for (channel = 0u; channel < 6u; channel++)
    {
        const vn_psg_voice_t *voice = (const vn_psg_voice_t *)0;
        vn_psg_voice_t *hardware = &psg_hardware_voices[channel];
        if (psg_sfx.active && psg_sfx.voices[channel].active) voice = &psg_sfx.voices[channel];
        else if (psg_song.active && psg_song.voices[channel].active) voice = &psg_song.voices[channel];

        if (!voice)
        {
            if (hardware->active) psg_stop_channel(channel);
            hardware->active = 0u;
            hardware->volume = 0u;
            hardware->noise = 0u;
            continue;
        }
        if (psg_voice_matches(hardware, voice)) continue;
        if (voice->noise && channel >= 4u)
        {
            psg_set_noise(channel, (uint8_t)(voice->period & 0x1fu), voice->volume);
        }
        else
        {
            if (!hardware->active || hardware->noise || hardware->wave != voice->wave)
            {
                psg_load_wave(channel, voice->wave);
            }
            psg_set_tone(channel, voice->period, voice->volume);
        }
        *hardware = *voice;
    }
}

static void VN_HUCARD_CODE_PSG psg_clear_player_voices(vn_psg_player_t *player)
{
    uint8_t channel;
    if (!player) return;
    player->used_mask = 0u;
    for (channel = 0u; channel < 6u; channel++)
    {
        player->voices[channel].active = 0u;
        player->voices[channel].volume = 0u;
    }
}

static void VN_HUCARD_CODE_PSG psg_stop_player(vn_psg_player_t *player)
{
    if (!player) return;
    player->active = 0u;
    player->asset = (const pce_vn_psg_asset_t *)0;
    player->cursor = 0u;
    psg_clear_player_voices(player);
    psg_render_channels();
}

static void VN_HUCARD_CODE_PSG psg_init(void)
{
    uint8_t channel;
    PCE_PSG_GLOBAL = 0xffu;
    for (channel = 0u; channel < 6u; channel++)
    {
        psg_stop_channel(channel);
        psg_hardware_voices[channel].active = 0u;
        psg_hardware_voices[channel].wave = 0xffu;
    }
}

static void VN_HUCARD_CODE_PSG psg_apply_step_row(vn_psg_player_t *player, uint16_t step_no)
{
    uint16_t i;
    const pce_vn_psg_asset_t *asset;
    if (!player || !player->active || !player->asset) return;
    asset = player->asset;
    if (step_no == 0u && player->cursor >= asset->pattern_count) player->cursor = 0u;
    for (i = player->cursor; i < asset->pattern_count; i++)
    {
        const uint16_t base = (uint16_t)(i * VN_PSG_PATTERN_ROW_BYTES);
        const uint16_t step = data_ref_u16_at(asset->pattern, base);
        if (step < step_no)
        {
            player->cursor = (uint16_t)(i + 1u);
            continue;
        }
        if (step > step_no) break;
        if (step == step_no)
        {
            uint8_t channel = data_ref_byte_at(asset->pattern, (uint16_t)(base + 2u));
            const uint16_t period = data_ref_u16_at(asset->pattern, (uint16_t)(base + 3u));
            const uint8_t volume = data_ref_byte_at(asset->pattern, (uint16_t)(base + 5u));
            const uint8_t noise = data_ref_byte_at(asset->pattern, (uint16_t)(base + 6u));
            const uint8_t wave = data_ref_byte_at(asset->pattern, (uint16_t)(base + 7u));
            vn_psg_voice_t *voice;
            channel = (uint8_t)(player->base_channel + channel);
            if (channel > 5u) channel = 5u;
            voice = &player->voices[channel];
            voice->period = period;
            voice->volume = volume;
            voice->noise = noise;
            voice->wave = wave > VN_PSG_WAVE_SQUARE ? VN_PSG_WAVE_SQUARE : wave;
            voice->active = volume ? 1u : 0u;
            if (voice->active) player->used_mask |= (uint8_t)(1u << channel);
            else player->used_mask &= (uint8_t)~(uint8_t)(1u << channel);
            player->cursor = (uint16_t)(i + 1u);
        }
    }
    psg_render_channels();
}

static void VN_HUCARD_CODE_PSG psg_start_asset(int16_t asset_index, uint8_t base_channel)
{
    vn_psg_player_t *player;
    if (asset_index < 0 || (uint16_t)asset_index >= pce_vn_psg_asset_count) return;
    PCE_PSG_GLOBAL = 0xffu;
    if (pce_vn_psg_assets[asset_index].is_song)
    {
        psg_stop_player(&psg_song);
        player = &psg_song;
        player->loop = 1u;
    }
    else
    {
        psg_stop_player(&psg_sfx);
        player = &psg_sfx;
        player->loop = 0u;
    }
    player->asset = &pce_vn_psg_assets[asset_index];
    player->active = 1u;
    player->base_channel = base_channel > 5u ? 5u : base_channel;
    player->used_mask = 0u;
    player->step = 0u;
    player->accum = 0u;
    player->cursor = 0u;
    psg_clear_player_voices(player);
    psg_apply_step_row(player, 0u);
}

static void VN_HUCARD_CODE_PSG psg_advance_player(vn_psg_player_t *player)
{
    uint16_t next_accum;
    if (!player || !player->active || !player->asset) return;
    next_accum = (uint16_t)(player->accum + psg_player_step_delta(player));
    if (next_accum < VN_PSG_STEP_ACCUM_UNIT)
    {
        player->accum = next_accum;
        return;
    }
    player->accum = (uint16_t)(next_accum - VN_PSG_STEP_ACCUM_UNIT);
    player->step++;
    if (player->step >= player->asset->steps)
    {
        if (player->loop)
        {
            player->step = 0u;
            player->cursor = 0u;
            psg_clear_player_voices(player);
        }
        else
        {
            psg_stop_player(player);
            return;
        }
    }
    psg_apply_step_row(player, player->step);
}

static void VN_HUCARD_CODE_PSG psg_advance(uint8_t frames)
{
    while (frames--)
    {
        psg_advance_player(&psg_song);
        psg_advance_player(&psg_sfx);
    }
}

static uint16_t VN_HUCARD_CODE_SPRITE_STATE sprite_attr_for_size(const pce_editor_sprite_draw_meta_t *draw_meta, uint8_t flags, uint8_t palette_bank)
{
    uint16_t attr = (uint16_t)(VDC_SPRITE_FG | VDC_SPRITE_COLOR(palette_bank));
    if (draw_meta->cell_width >= 32u) attr |= VDC_SPRITE_WIDTH_32;
    if (draw_meta->cell_height >= 64u) attr |= VDC_SPRITE_HEIGHT_64;
    else if (draw_meta->cell_height >= 32u) attr |= VDC_SPRITE_HEIGHT_32;
    if (flags & PCE_VN_SPRITE_FLIP_X) attr |= VDC_SPRITE_FLIP_X;
    if (flags & PCE_VN_SPRITE_FLIP_Y) attr |= VDC_SPRITE_FLIP_Y;
    return attr;
}

static uint8_t VN_HUCARD_CODE_SPRITE_STATE sprite_pattern_slots_for_size(uint8_t cell_width, uint8_t cell_height)
{
    uint8_t pattern_cols = (uint8_t)((cell_width + 15u) / 16u);
    uint8_t pattern_rows = (uint8_t)((cell_height + 15u) / 16u);
    uint8_t row_pattern_slots;
    if (!pattern_cols) pattern_cols = 1u;
    if (!pattern_rows) pattern_rows = 1u;
    row_pattern_slots = pattern_cols;
    if (pattern_rows > 1u && row_pattern_slots < 2u) row_pattern_slots = 2u;
    return (uint8_t)(row_pattern_slots * pattern_rows);
}

static uint16_t VN_HUCARD_CODE_SPRITE_STATE sprite_pattern_units_for_ref(const pce_editor_data_ref_t *patterns)
{
    if (!patterns || !patterns->size) return 0u;
    return (uint16_t)((patterns->size + 63u) / 64u);
}

static void VN_HUCARD_CODE_VIDEO clear_sprites(void)
{
    uint8_t i;
    for (i = 0u; i < 64u; i++)
    {
        sprite_shadow[i].y = VN_SPRITE_HIDDEN_Y;
        sprite_shadow[i].x = 0u;
        sprite_shadow[i].pattern = 0u;
        sprite_shadow[i].attr = 0u;
    }
}

static void VN_HUCARD_CODE_SPRITE_STATE clear_character_sprite_shadow(void)
{
    uint8_t i;
    for (i = 0u; i < VN_SPRITETEXT_SATB_BASE; i++)
    {
        sprite_shadow[i].y = VN_SPRITE_HIDDEN_Y;
        sprite_shadow[i].x = 0u;
        sprite_shadow[i].pattern = 0u;
        sprite_shadow[i].attr = 0u;
    }
}

static void VN_HUCARD_CODE_SPRITE_STATE clear_sprite_slot_shadow(uint8_t slot)
{
    uint8_t i;
    uint8_t base;
    if (slot >= VN_SPRITE_SLOT_COUNT) return;
    base = (uint8_t)(slot * VN_SPRITE_SATB_PER_SLOT);
    for (i = 0u; i < VN_SPRITE_SATB_PER_SLOT; i++)
    {
        sprite_shadow[(uint8_t)(base + i)].y = VN_SPRITE_HIDDEN_Y;
        sprite_shadow[(uint8_t)(base + i)].x = 0u;
        sprite_shadow[(uint8_t)(base + i)].pattern = 0u;
        sprite_shadow[(uint8_t)(base + i)].attr = 0u;
    }
}

static void VN_HUCARD_CODE_VIDEO upload_sprite_table_now(void)
{
    vn_vram_copy(VN_SATB_ADDR, (const uint8_t *)sprite_shadow, (uint16_t)(64u * sizeof(vdc_sprite_t)));
    pce_vdc_poke(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC);
    pce_vdc_poke(VDC_REG_SATB_START, VN_SATB_ADDR);
}

static void VN_HUCARD_CODE_VIDEO upload_sprite_table(void)
{
    wait_vblank();
    upload_sprite_table_now();
    /* Consumes one VBlank (wait_vblank above); service PSG for that frame so the
       BGM does not drag one tick per sprite-animation update (mouth flap). */
    service_psg();
}

/* SpriteText uses the SATB tail. Each slot owns an independent blink timer;
   rebuild the tail when one or more slots toggle so static slots stay visible. */
static uint8_t VN_HUCARD_CODE_SPRITE_STATE tick_spritetext(void)
{
    uint8_t slot_index;
    uint8_t changed = 0u;
    for (slot_index = 0u; slot_index < VN_SPRITETEXT_SLOT_COUNT; slot_index++)
    {
        vn_spritetext_slot_t *slot = &spritetext_slots[slot_index];
        if (!slot->visible || !slot->glyph_count || !slot->blink_frames) continue;
        slot->blink_timer++;
        if (slot->blink_timer < slot->blink_frames) continue;
        slot->blink_timer = 0u;
        slot->blink_on = (uint8_t)(slot->blink_on ? 0u : 1u);
        changed = 1u;
    }
    if (changed) redraw_spritetext_slots();
    return changed;
}

static void VN_HUCARD_CODE_SPRITE_STATE hide_sprite_slot(uint8_t slot)
{
    if (slot >= VN_SPRITE_SLOT_COUNT) return;
    clear_sprite_slot_shadow(slot);
    sprite_slots[slot].visible = 0u;
    sprite_slots[slot].satb_count = 0u;
    sprite_slot_pattern_valid[slot] = 0u;
}

static void VN_HUCARD_CODE_SPRITE_STATE plan_sprite_layout(void)
{
    uint8_t slot;
    for (slot = 0u; slot < VN_SPRITE_SLOT_COUNT; slot++)
    {
        const vn_sprite_slot_t *state = &sprite_slots[slot];
        const pce_editor_sprite_asset_t *sprite;
        uint16_t pattern_units;
        uint16_t pattern_base;
        uint16_t pattern_capacity;
        uint8_t palette_bank;
        sprite_slot_pattern_base[slot] = 0u;
        sprite_slot_palette_bank[slot] = 0u;
        sprite_slot_pattern_valid[slot] = 0u;
        if (!state->visible || state->asset_index < 0 || (uint16_t)state->asset_index >= pce_editor_sprite_asset_count) continue;
        sprite = &pce_editor_sprite_assets[state->asset_index];
        pattern_units = sprite_pattern_units_for_ref(&sprite->patterns);
        if (!pattern_units) continue;
        if (slot == 1u)
        {
            pattern_base = PCE_VN_SPRITE_SLOT1_PATTERN_BASE;
            pattern_capacity = PCE_VN_SPRITE_SLOT1_PATTERN_CAPACITY;
        }
        else if (slot == 2u)
        {
            pattern_base = PCE_VN_SPRITE_SLOT2_PATTERN_BASE;
            pattern_capacity = PCE_VN_SPRITE_SLOT2_PATTERN_CAPACITY;
        }
        else if (slot == 3u)
        {
            pattern_base = PCE_VN_SPRITE_SLOT3_PATTERN_BASE;
            pattern_capacity = PCE_VN_SPRITE_SLOT3_PATTERN_CAPACITY;
        }
        else
        {
            pattern_base = PCE_VN_SPRITE_SLOT0_PATTERN_BASE;
            pattern_capacity = PCE_VN_SPRITE_SLOT0_PATTERN_CAPACITY;
        }
        if (pattern_units > pattern_capacity) continue;
        palette_bank = (uint8_t)(sprite->palette_bank + slot);
        if (palette_bank >= PCE_VN_FONT_SPRITE_PALETTE_BANK) continue;
        sprite_slot_pattern_base[slot] = pattern_base;
        sprite_slot_palette_bank[slot] = palette_bank;
        sprite_slot_pattern_valid[slot] = 1u;
    }
}

static void VN_HUCARD_CODE_VIDEO draw_sprite_slot(uint8_t slot, uint8_t upload_patterns)
{
    vn_sprite_slot_t *state;
    const pce_editor_sprite_asset_t *sprite;
    const pce_editor_sprite_draw_meta_t *draw_meta;
    uint8_t row;
    uint8_t col;
    uint8_t written = 0u;
    uint8_t cell_columns;
    uint8_t cell_rows;
    uint8_t frame_columns;
    uint8_t frame_rows;
    uint16_t first_cell = 0u;
    uint16_t attr;
    uint16_t pattern_base;
    uint8_t palette_bank;
    uint8_t pattern_step;
    uint8_t use_animation_frame;
    uint16_t total_cells;
    const pce_vn_sprite_anim_t *animation = (const pce_vn_sprite_anim_t *)0;
    if (slot >= VN_SPRITE_SLOT_COUNT) return;
    state = &sprite_slots[slot];
    clear_sprite_slot_shadow(slot);
    if (!state->visible || state->asset_index < 0 || (uint16_t)state->asset_index >= pce_editor_sprite_asset_count) return;
    if (!sprite_slot_pattern_valid[slot]) return;
    sprite = &pce_editor_sprite_assets[state->asset_index];
    draw_meta = &pce_editor_sprite_draw_meta[state->asset_index];
    pattern_base = sprite_slot_pattern_base[slot];
    palette_bank = sprite_slot_palette_bank[slot];
    if (state->animation_index >= 0 && (uint16_t)state->animation_index < pce_vn_sprite_animation_count)
    {
        animation = &pce_vn_sprite_animations[state->animation_index];
    }
    if (upload_patterns)
    {
        upload_palette(&sprite->palette, (uint16_t)(256u + ((uint16_t)palette_bank * 16u)), 16u);
        copy_data_ref_to_vram_guarded((uint16_t)(pattern_base * 32u), &sprite->patterns);
    }
    cell_columns = draw_meta->cell_columns ? draw_meta->cell_columns : 1u;
    cell_rows = draw_meta->cell_rows ? draw_meta->cell_rows : 1u;
    total_cells = (uint16_t)(cell_columns * cell_rows);
    use_animation_frame = (uint8_t)(
        animation &&
        animation->frame_count >= 1u &&
        animation->frame_width_cells &&
        animation->frame_height_cells &&
        animation->frame_width_cells <= cell_columns &&
        animation->frame_height_cells <= cell_rows &&
        animation->frame_stride_cells &&
        animation->first_cell < total_cells
    );
    frame_columns = use_animation_frame ? animation->frame_width_cells : cell_columns;
    frame_rows = use_animation_frame ? animation->frame_height_cells : cell_rows;
    first_cell = use_animation_frame
        ? (uint16_t)(animation->first_cell + ((uint16_t)state->frame * animation->frame_stride_cells))
        : 0u;
    attr = sprite_attr_for_size(draw_meta, state->flags, palette_bank);
    pattern_step = (uint8_t)(sprite_pattern_slots_for_size(draw_meta->cell_width, draw_meta->cell_height) * 2u);
    for (row = 0u; row < frame_rows; row++)
    {
        for (col = 0u; col < frame_columns; col++)
        {
            const uint8_t source_row = (state->flags & PCE_VN_SPRITE_FLIP_Y) ? (uint8_t)(frame_rows - 1u - row) : row;
            const uint8_t source_col = (state->flags & PCE_VN_SPRITE_FLIP_X) ? (uint8_t)(frame_columns - 1u - col) : col;
            uint16_t source_cell;
            uint16_t mapped_cell;
            vdc_sprite_t *entry;
            if (written >= VN_SPRITE_SATB_PER_SLOT)
            {
                state->satb_count = written;
                return;
            }
            source_cell = (uint16_t)(first_cell + ((uint16_t)source_row * cell_columns) + source_col);
            if (source_cell >= total_cells) continue;
            mapped_cell = sprite->cell_map ? sprite->cell_map[source_cell] : source_cell;
            entry = &sprite_shadow[(uint8_t)((slot * VN_SPRITE_SATB_PER_SLOT) + written)];
            entry->y = (uint16_t)(state->y + ((uint16_t)row * draw_meta->cell_height) + 64u);
            entry->x = (uint16_t)(state->x + ((uint16_t)col * draw_meta->cell_width) + 32u);
            entry->pattern = (uint16_t)(pattern_base + (mapped_cell * pattern_step));
            entry->attr = attr;
            written++;
        }
    }
    state->satb_count = written;
}

static void VN_HUCARD_CODE_VIDEO refresh_scene_sprites(uint8_t upload_pattern_mask)
{
    uint8_t slot;
    plan_sprite_layout();
    clear_character_sprite_shadow();
    for (slot = 0u; slot < VN_SPRITE_SLOT_COUNT; slot++)
    {
        draw_sprite_slot(slot, (uint8_t)(upload_pattern_mask & (uint8_t)(1u << slot)));
    }
    upload_sprite_table();
}

static void VN_HUCARD_CODE_SPRITE_STATE cancel_sprite_move(uint8_t slot)
{
    if (slot >= VN_SPRITE_SLOT_COUNT) return;
    sprite_moves[slot].active = 0u;
    sprite_moves[slot].remaining_frames = 0u;
    if (sync_sprite_move_slot == slot) sync_sprite_move_slot = 0xffu;
}

static void VN_HUCARD_CODE_SPRITE_STATE cancel_all_sprite_moves(void)
{
    uint8_t slot;
    for (slot = 0u; slot < VN_SPRITE_SLOT_COUNT; slot++)
    {
        sprite_moves[slot].active = 0u;
        sprite_moves[slot].remaining_frames = 0u;
    }
    sync_sprite_move_slot = 0xffu;
}

static uint8_t VN_HUCARD_CODE_SPRITE_STATE start_sprite_move(const pce_vn_command_t *command)
{
    vn_sprite_slot_t *state;
    vn_sprite_move_t *move;
    uint8_t slot;
    uint16_t frames;
    int16_t delta_x;
    int16_t delta_y;
    uint16_t distance_x;
    uint16_t distance_y;
    if (!command) return 0u;
    slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
    state = &sprite_slots[slot];
    cancel_sprite_move(slot);
    if (!state->visible || state->asset_index < 0) return 0u;
    frames = (uint16_t)command->arg0 | ((uint16_t)command->arg1 << 8);
    if (!frames) frames = 1u;
    if (command->animation_index >= 0
        && command->asset_index == state->asset_index
        && (uint16_t)command->animation_index < pce_vn_sprite_animation_count
        && pce_vn_sprite_animations[command->animation_index].sprite_index == (uint16_t)state->asset_index)
    {
        state->animation_index = command->animation_index;
        state->frame = 0u;
        state->timer = 0u;
    }
    move = &sprite_moves[slot];
    delta_x = (int16_t)((int16_t)command->x - (int16_t)state->x);
    delta_y = (int16_t)((int16_t)command->y - (int16_t)state->y);
    distance_x = (uint16_t)(delta_x < 0 ? -delta_x : delta_x);
    distance_y = (uint16_t)(delta_y < 0 ? -delta_y : delta_y);
    move->target_x = command->x;
    move->target_y = command->y;
    move->distance_x = distance_x;
    move->distance_y = distance_y;
    move->direction_x = delta_x < 0 ? -1 : (delta_x > 0 ? 1 : 0);
    move->direction_y = delta_y < 0 ? -1 : (delta_y > 0 ? 1 : 0);
    move->error_x = 0u;
    move->error_y = 0u;
    move->total_frames = frames;
    move->remaining_frames = frames;
    move->active = 1u;
    if (!(command->flags & PCE_VN_SPRITE_MOVE_ASYNC)) sync_sprite_move_slot = slot;
    return (uint8_t)!(command->flags & PCE_VN_SPRITE_MOVE_ASYNC);
}

static uint8_t VN_HUCARD_CODE_SPRITE_STATE sprite_command_matches_display(const pce_vn_command_t *command)
{
    const vn_sprite_slot_t *state;
    uint8_t slot;
    if (!command) return 0u;
    if (!(command->flags & PCE_VN_SPRITE_VISIBLE) || command->asset_index < 0) return 0u;
    slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
    if (sprite_moves[slot].active || sync_sprite_move_slot == slot) return 0u;
    state = &sprite_slots[slot];
    if (!state->visible
        || state->asset_index != command->asset_index
        || state->animation_index != command->animation_index
        || state->x != command->x
        || state->y != command->y
        || state->flags != command->flags)
    {
        return 0u;
    }
    if (!state->satb_count || !sprite_slot_pattern_valid[slot]) return 0u;
    return 1u;
}

static void VN_HUCARD_CODE_SPRITE_STATE set_sprite(const pce_vn_command_t *command)
{
    uint8_t slot;
    uint8_t upload_pattern_mask;
    vn_sprite_slot_t *state;
    if (!command) return;
    slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
    state = &sprite_slots[slot];
    if (sprite_command_matches_display(command)) return;
    cancel_sprite_move(slot);
    if (!(command->flags & PCE_VN_SPRITE_VISIBLE) || command->asset_index < 0)
    {
        hide_sprite_slot(slot);
        refresh_scene_sprites(0u);
        return;
    }
    upload_pattern_mask = (uint8_t)((!state->visible || state->asset_index != command->asset_index)
        ? (uint8_t)(1u << slot) : 0u);
    if (state->visible && state->satb_count && state->asset_index != command->asset_index)
    {
        clear_sprite_slot_shadow(slot);
        upload_sprite_table();
    }
    state->asset_index = command->asset_index;
    state->animation_index = command->animation_index;
    state->x = command->x;
    state->y = command->y;
    state->flags = command->flags;
    state->frame = 0u;
    state->timer = 0u;
    state->visible = 1u;
    refresh_scene_sprites(upload_pattern_mask);
}

static void VN_HUCARD_CODE_SPRITE_STATE start_active_message_mouth(void)
{
    const int16_t mouth_slot = active_message_state.mouth_slot;
    vn_sprite_slot_t *state;
    int16_t normal_animation_index;
    uint16_t mouth_animation_index;
    active_message_mouth_animation_index = -1;
    if (mouth_slot < 0 || mouth_slot >= VN_SPRITE_SLOT_COUNT) return;
    state = &sprite_slots[(uint8_t)mouth_slot];
    normal_animation_index = state->animation_index;
    if (!state->visible || state->asset_index < 0 || normal_animation_index < 0) return;
    mouth_animation_index = (uint16_t)(normal_animation_index + 1);
    if (mouth_animation_index >= pce_vn_sprite_animation_count
        || pce_vn_sprite_animations[mouth_animation_index].sprite_index != (uint16_t)state->asset_index)
    {
        return;
    }
    active_message_mouth_animation_index = normal_animation_index;
    state->animation_index = (int16_t)mouth_animation_index;
    state->frame = 0u;
    state->timer = 0u;
    sprite_animation_refresh_mask |= (uint8_t)(1u << (uint8_t)mouth_slot);
}

static void VN_HUCARD_CODE_SPRITE_STATE tick_sprites(void)
{
    uint8_t slot;
    uint8_t dirty = tick_spritetext();
    for (slot = 0u; slot < VN_SPRITE_SLOT_COUNT; slot++)
    {
        vn_sprite_slot_t *state = &sprite_slots[slot];
        const pce_vn_sprite_anim_t *anim;
        unsigned int delay;
        uint8_t slot_dirty = 0u;
        if (sprite_animation_refresh_mask & (uint8_t)(1u << slot)) slot_dirty = 1u;
        if (state->visible && state->animation_index >= 0 && (uint16_t)state->animation_index < pce_vn_sprite_animation_count)
        {
            anim = &pce_vn_sprite_animations[state->animation_index];
            delay = anim->frame_delays ? anim->frame_delays[state->frame] : anim->frame_delay;
            if (!delay) delay = 1u;
            state->timer++;
            if (state->timer >= delay)
            {
                state->timer = 0u;
                state->frame++;
                if (state->frame >= anim->frame_count)
                {
                    state->frame = anim->loop ? 0u : (uint8_t)(anim->frame_count - 1u);
                }
                slot_dirty = 1u;
            }
        }
        if (sprite_moves[slot].active)
        {
            vn_sprite_move_t *move = &sprite_moves[slot];
            uint16_t amount;
            uint16_t room;
            if (move->remaining_frames <= 1u)
            {
                state->x = move->target_x;
                state->y = move->target_y;
                move->remaining_frames = 0u;
                move->active = 0u;
            }
            else
            {
                amount = move->distance_x;
                while (amount)
                {
                    room = (uint16_t)(move->total_frames - move->error_x);
                    if (amount < room)
                    {
                        move->error_x = (uint16_t)(move->error_x + amount);
                        amount = 0u;
                    }
                    else
                    {
                        amount = (uint16_t)(amount - room);
                        move->error_x = 0u;
                        state->x = (uint16_t)((int16_t)state->x + move->direction_x);
                    }
                }
                amount = move->distance_y;
                while (amount)
                {
                    room = (uint16_t)(move->total_frames - move->error_y);
                    if (amount < room)
                    {
                        move->error_y = (uint16_t)(move->error_y + amount);
                        amount = 0u;
                    }
                    else
                    {
                        amount = (uint16_t)(amount - room);
                        move->error_y = 0u;
                        state->y = (uint16_t)((int16_t)state->y + move->direction_y);
                    }
                }
                move->remaining_frames--;
            }
            slot_dirty = 1u;
        }
        if (slot_dirty)
        {
            draw_sprite_slot(slot, 0u);
            dirty = 1u;
        }
    }
    sprite_animation_refresh_mask = 0u;
    if (dirty) upload_sprite_table_now();
}

static void VN_HUCARD_CODE_TEXT upload_font_sprite_patterns(void)
{
#if PCE_VN_HAS_SPRITETEXT
    copy_data_ref_to_vram_guarded((uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE * 32u), &pce_vn_font_sprite_data_ref);
#endif
}

static void VN_HUCARD_CODE_TEXT set_spritetext_color(uint16_t color)
{
    pce_vce_set_color((uint16_t)(256u + (PCE_VN_FONT_SPRITE_PALETTE_BANK * 16u) + 15u), ui_text_color_word(color));
}

static void VN_HUCARD_CODE_TEXT clear_spritetext_slots(void)
{
    uint8_t slot_index;
    uint8_t satb_index;
    for (slot_index = 0u; slot_index < VN_SPRITETEXT_SLOT_COUNT; slot_index++)
    {
        spritetext_slots[slot_index].glyph_count = 0u;
        spritetext_slots[slot_index].blink_frames = 0u;
        spritetext_slots[slot_index].blink_timer = 0u;
        spritetext_slots[slot_index].blink_on = 1u;
        spritetext_slots[slot_index].visible = 0u;
    }
    for (satb_index = VN_SPRITETEXT_SATB_BASE; satb_index < 64u; satb_index++)
    {
        sprite_shadow[satb_index].y = VN_SPRITE_HIDDEN_Y;
        sprite_shadow[satb_index].attr = 0u;
    }
}

static void VN_HUCARD_CODE_TEXT redraw_spritetext_slots(void)
{
    uint8_t slot_index;
    uint8_t written = 0u;
    for (slot_index = VN_SPRITETEXT_SATB_BASE; slot_index < 64u; slot_index++)
    {
        sprite_shadow[slot_index].y = VN_SPRITE_HIDDEN_Y;
        sprite_shadow[slot_index].attr = 0u;
    }
    for (slot_index = 0u; slot_index < VN_SPRITETEXT_SLOT_COUNT; slot_index++)
    {
        const vn_spritetext_slot_t *slot = &spritetext_slots[slot_index];
        uint8_t col = 0u;
        uint8_t row = 0u;
        uint8_t glyph_index;
        if (!slot->visible || !slot->glyph_count || (slot->blink_frames && !slot->blink_on)) continue;
        set_spritetext_color(slot->color);
        for (glyph_index = 0u; glyph_index < slot->glyph_count; glyph_index++)
        {
            const uint8_t glyph = slot->glyphs[glyph_index];
            vdc_sprite_t *entry;
            if (glyph == 0xfeu)
            {
                col = 0u;
                row++;
                continue;
            }
            if ((uint8_t)(VN_SPRITETEXT_SATB_BASE + written) >= 64u) return;
            entry = &sprite_shadow[(uint8_t)(VN_SPRITETEXT_SATB_BASE + written)];
            entry->y = (uint16_t)(slot->y + ((uint16_t)row * VN_SPRITETEXT_PITCH_Y) + 64u);
            entry->x = (uint16_t)(slot->x + ((uint16_t)col * VN_SPRITETEXT_PITCH_X) + 32u);
            entry->pattern = (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE + ((uint16_t)glyph * 2u));
            entry->attr = (uint16_t)(VDC_SPRITE_FG | VDC_SPRITE_COLOR(PCE_VN_FONT_SPRITE_PALETTE_BANK));
            col++;
            written++;
        }
    }
}

static void VN_HUCARD_CODE_TEXT draw_spritetext(const pce_vn_command_t *command)
{
#if PCE_VN_HAS_SPRITETEXT
    vn_spritetext_slot_t *slot;
    uint8_t slot_index;
    uint8_t i;
    if (!command) return;
    slot_index = command->slot < VN_SPRITETEXT_SLOT_COUNT ? command->slot : 0u;
    slot = &spritetext_slots[slot_index];
    if ((command->flags & PCE_VN_SPRITE_VISIBLE) && command->asset_index >= 0 && command->arg1)
    {
        uint8_t count = command->arg1;
        const uint16_t offset = (uint16_t)command->asset_index;
        if (count > VN_SPRITETEXT_MAX_GLYPHS) count = VN_SPRITETEXT_MAX_GLYPHS;
        for (i = 0u; i < count; i++)
        {
            slot->glyphs[i] = scene_pack_u8(&active_scene_pack, (uint16_t)(offset + i));
        }
        slot->glyph_count = count;
        slot->x = command->x;
        slot->y = command->y;
        slot->color = (uint16_t)command->message_index;
        slot->blink_frames = command->arg0;
        slot->blink_timer = 0u;
        slot->blink_on = 1u;
        slot->visible = 1u;
    }
    else
    {
        slot->glyph_count = 0u;
        slot->blink_frames = 0u;
        slot->blink_timer = 0u;
        slot->blink_on = 1u;
        slot->visible = 0u;
    }
    redraw_spritetext_slots();
    upload_sprite_table();
#else
    (void)command;
#endif
}

static void VN_HUCARD_CODE_SCRIPT set_variable_value(int16_t index, int16_t value)
{
    if (index < 0 || (uint16_t)index >= PCE_VN_VARIABLE_STORAGE_COUNT) return;
    if (index == PCE_VN_VARIABLE_AUTO_ENABLE_INDEX)
    {
        if (value < 0) value = 0;
        else if (value > 1) value = 1;
    }
    else if (index == PCE_VN_VARIABLE_MSG_SPEED_INDEX)
    {
        if (value < 0) value = 0;
        else if (value > 6) value = 6;
    }
    variable_values[index] = (uint16_t)value;
}

static int16_t VN_HUCARD_CODE_SCRIPT get_variable_value(int16_t index)
{
    if (index < 0 || (uint16_t)index >= PCE_VN_VARIABLE_STORAGE_COUNT) return 0;
    return (int16_t)variable_values[index];
}

static int16_t VN_HUCARD_CODE_SCRIPT command_s16_value(const pce_vn_command_t *command)
{
    return (int16_t)((uint16_t)command->arg0 | ((uint16_t)command->arg1 << 8));
}

static void VN_HUCARD_CODE_SCRIPT apply_variable_command(const pce_vn_command_t *command)
{
    int16_t value;
    if (!command || command->asset_index < 0) return;
    value = command_s16_value(command);
    if (command->flags == PCE_VN_VAR_OP_ADD)
        value = (int16_t)(get_variable_value(command->asset_index) + value);
    else if (command->flags == PCE_VN_VAR_OP_SUB)
        value = (int16_t)(get_variable_value(command->asset_index) - value);
    else if (command->flags == PCE_VN_VAR_OP_RANDOM)
    {
        const int16_t minv = (int16_t)command->x;
        const int16_t maxv = (int16_t)command->y;
        const uint16_t range = maxv > minv ? (uint16_t)(maxv - minv + 1) : 1u;
        value = (int16_t)(minv + ((uint16_t)(pce_joypad_read() + current_command + current_scene) % range));
    }
    set_variable_value(command->asset_index, value);
}

static uint8_t VN_HUCARD_CODE_SCRIPT compare_values(int16_t left, int16_t right, uint8_t op)
{
    if (op == PCE_VN_COMPARE_NE) return (uint8_t)(left != right);
    if (op == PCE_VN_COMPARE_LT) return (uint8_t)(left < right);
    if (op == PCE_VN_COMPARE_LTE) return (uint8_t)(left <= right);
    if (op == PCE_VN_COMPARE_GT) return (uint8_t)(left > right);
    if (op == PCE_VN_COMPARE_GTE) return (uint8_t)(left >= right);
    return (uint8_t)(left == right);
}

static void VN_HUCARD_CODE_SCRIPT handle_audio_command(const pce_vn_command_t *command)
{
    const uint8_t kind = (uint8_t)(command->flags & 0x0fu);
    const uint8_t action = (uint8_t)(command->flags & 0xf0u);
    if (kind != PCE_VN_AUDIO_KIND_PSG) return;
    if (action == PCE_VN_AUDIO_ACTION_STOP)
    {
        if (command->arg0 == PCE_VN_PSG_STOP_BGM) psg_stop_player(&psg_song);
        else if (command->arg0 == PCE_VN_PSG_STOP_SFX) psg_stop_player(&psg_sfx);
        else
        {
            psg_stop_player(&psg_song);
            psg_stop_player(&psg_sfx);
        }
        return;
    }
    psg_start_asset(command->asset_index, command->slot);
}

static void VN_HUCARD_CODE_SCRIPT apply_effect(const pce_vn_command_t *command)
{
    uint8_t i;
    if (!command) return;
    if (command->flags == PCE_VN_EFFECT_BLANK)
    {
        cancel_all_sprite_moves();
        clear_screen_map(0);
        current_bg_display_valid = 0u;
        return;
    }
    if (command->flags == PCE_VN_EFFECT_FLASH)
    {
        pce_vce_set_color(0u, command->x);
        for (i = 0u; i < command->arg0; i++)
        {
            wait_vblank();
            service_psg();
        }
        pce_vce_set_color(0u, 0u);
        return;
    }
    for (i = 0u; i < command->arg0; i++)
    {
        wait_vblank();
        service_psg();
    }
}

static void VN_HUCARD_CODE_TEXT start_message(uint8_t message_index)
{
    pce_vn_message_t message;
    uint8_t restore_window_display;
    uint8_t instant_glyph_count;
    int16_t message_speed_level;
    if (!scene_pack_read_message(&active_scene_pack, message_index, &message)) return;
    active_message_state = message;
    active_message_index = message_index;
    active_choice_index = -1;
    wait_frames_remaining = 0u;
    message_glyph_pos = 0u;
    message_glyph_byte = 0u;
    message_frame_timer = 0u;
    message_col = 0u;
    message_row = 0u;
    message_complete = 0u;
    message_auto_wait = message.auto_wait_frames;
    message_wait_indicator_state = 0u;
    message_text_speed = message.text_speed_frames;
    message_speed_level = get_variable_value(PCE_VN_VARIABLE_MSG_SPEED_INDEX);
    if (message_speed_level > 0)
    {
        message_text_speed = (uint8_t)((message_speed_level - 1) * 10);
    }
#if PCE_VN_HAS_FULL_SCREEN_BG
    restore_text_vram_after_full_screen_bg();
#endif
    instant_glyph_count = message.instant_glyph_count;
    start_active_message_mouth();
    write_ui_text_palette(ui_text_color_word(message.text_color));
    restore_window_display = begin_message_window_vram_update();
    clear_window_tile_pixels();
    if (instant_glyph_count)
    {
        message_complete = draw_message_prefix_glyphs(&active_message_state);
    }
    if (!message_complete && !message_text_speed)
    {
        draw_message_text(&active_message_state);
    }
    else if (!message_complete)
    {
        message_complete = draw_message_next_entry(&active_message_state);
    }
    end_message_window_vram_update(restore_window_display);
    refresh_message_wait_indicator();
}

static void VN_HUCARD_CODE_TEXT finish_active_message(void)
{
    if (active_message_index < 0) return;
    if (message_wait_indicator_state != VN_MESSAGE_INDICATOR_AUTO)
        hide_message_wait_indicator();
    while (!message_complete)
    {
        message_complete = draw_message_next_entry(&active_message_state);
    }
    refresh_message_wait_indicator();
}

static void VN_HUCARD_CODE_TEXT tick_active_message(void)
{
    if (active_message_index < 0 || message_complete) return;
    if (!message_text_speed)
    {
        finish_active_message();
        return;
    }
    message_frame_timer++;
    if (message_frame_timer < message_text_speed) return;
    message_frame_timer = 0u;
    /* main() has already entered this frame's VBlank. Reuse it for the small
       glyph upload instead of waiting for a second VBlank and halving the
       typewriter/game-loop update rate. */
    message_complete = draw_message_next_entry_now(&active_message_state);
    if (message_complete) refresh_message_wait_indicator();
}

static void VN_HUCARD_CODE_TEXT draw_choice_options(void)
{
    uint8_t row;
    uint8_t restore_window_display;
    vn_choice_ref_t choice;
    if (active_choice_index < 0) return;
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, &choice)) return;
#if PCE_VN_HAS_FULL_SCREEN_BG
    restore_text_vram_after_full_screen_bg();
#endif
    write_ui_text_palette(ui_text_color_word(PCE_VN_MESSAGE_COLOR_NONE));
    choice_cursor_pattern_row = choice_selected_index;
    restore_window_display = begin_message_window_vram_update();
    clear_window_tile_pixels();
    for (row = 0u; row < choice.option_count && row < VN_TEXT_ROWS; row++)
    {
        uint8_t col;
        uint16_t pos = 0u;
        pce_vn_choice_option_t option;
        if (!scene_pack_read_choice_option(&active_scene_pack, &choice, row, &option)) continue;
        draw_message_glyph_at(row == choice_selected_index ? PCE_VN_CHOICE_CURSOR_GLYPH : 0u, VN_CHOICE_CURSOR_COL, row);
        for (col = 0u; col < option.glyph_count && (uint8_t)(col + VN_CHOICE_TEXT_COL) < VN_TEXT_COLS; col++)
        {
            const uint16_t glyph = vn_glyph_decode(option.glyph_offset, pos);
            pos = (uint16_t)(pos + vn_glyph_stride(option.glyph_offset, pos));
            if (glyph == PCE_VN_GLYPH_END) break;
            draw_message_glyph_at(glyph, (uint8_t)(col + VN_CHOICE_TEXT_COL), row);
        }
        composer_prev_valid = 0u;
    }
    end_message_window_vram_update(restore_window_display);
}

static void VN_HUCARD_CODE_TEXT update_choice_cursor(uint8_t old_index, uint8_t new_index)
{
    if (active_choice_index < 0 || old_index == new_index) return;
    /* main() has already entered this frame's VBlank. Updating only BAT cells
       keeps every composited option glyph untouched and changes both rows in
       the same frame. handle_choice_input already bounded both indices against
       the active choice; the BAT helper also rejects rows outside the window,
       so do not re-enter the scene-pack decoder from this text-bank helper. */
    map_choice_cursor_cells_now(old_index, 0u);
    map_choice_cursor_cells_now(new_index, 1u);
}

static void VN_HUCARD_CODE_TEXT start_choice(uint8_t choice_index)
{
    vn_choice_ref_t choice;
    if (!scene_pack_read_choice(&active_scene_pack, choice_index, &choice)) return;
    if (!choice.option_count) return;
    active_message_index = -1;
    message_complete = 1u;
    wait_frames_remaining = 0u;
    active_choice_index = choice_index;
    choice_selected_index = choice.default_index < choice.option_count ? choice.default_index : 0u;
    draw_choice_options();
}

static uint8_t VN_HUCARD_CODE_TEXT handle_choice_input(uint8_t pressed)
{
    vn_choice_ref_t choice;
    if (active_choice_index < 0) return 0u;
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, &choice)) return 0u;
    if (pressed & PAD_UP)
    {
        const uint8_t old_index = choice_selected_index;
        if (choice_selected_index) choice_selected_index--;
        else choice_selected_index = (uint8_t)(choice.option_count - 1u);
        update_choice_cursor(old_index, choice_selected_index);
        return 1u;
    }
    if (pressed & PAD_DOWN)
    {
        const uint8_t old_index = choice_selected_index;
        choice_selected_index++;
        if (choice_selected_index >= choice.option_count) choice_selected_index = 0u;
        update_choice_cursor(old_index, choice_selected_index);
        return 1u;
    }
    if (pressed & (PAD_I | PAD_II | PAD_RUN))
    {
        pce_vn_choice_option_t option;
        if (!scene_pack_read_choice_option(&active_scene_pack, &choice, choice_selected_index, &option)) return 0u;
        active_choice_index = -1;
        hide_message_window_map();
        if (choice.variable_index >= 0) set_variable_value(choice.variable_index, option.value);
        if (option.target_scene >= 0) show_scene((unsigned int)option.target_scene);
        advance_story();
        return 1u;
    }
    return 0u;
}

static void VN_HUCARD_CODE_SCRIPT register_async_input_watcher(uint8_t mask, uint16_t target)
{
    uint8_t read_index;
    uint8_t write_index = 0u;
    if (!mask) return;

    for (read_index = 0u; read_index < async_input_watcher_count; read_index++)
    {
        const uint8_t remaining_mask =
            (uint8_t)(async_input_masks[read_index] & (uint8_t)~mask);
        if (!remaining_mask) continue;
        async_input_masks[write_index] = remaining_mask;
        async_input_targets[write_index] = async_input_targets[read_index];
        write_index++;
    }
    if (write_index < VN_ASYNC_INPUT_WATCHER_CAPACITY)
    {
        async_input_masks[write_index] = mask;
        async_input_targets[write_index] = target;
        write_index++;
    }
    async_input_watcher_count = write_index;
}

static uint8_t VN_HUCARD_CODE_SCRIPT find_async_input_watcher(uint8_t pressed)
{
    uint8_t index;
    for (index = 0u; index < async_input_watcher_count; index++)
    {
        if (pressed & async_input_masks[index]) return index;
    }
    return 0xffu;
}

static void VN_HUCARD_CODE_SCRIPT show_scene(unsigned int scene_index)
{
    cancel_all_sprite_moves();
    if (scene_index >= pce_vn_scene_count) scene_index = 0u;
    if (!load_scene_pack_into_cache(scene_index, &active_scene_pack)) return;
    clear_spritetext_slots();
    upload_sprite_table();
#if PCE_VN_HAS_FULL_SCREEN_BG
    current_scene_full_screen_bg = (uint8_t)(
        scene_pack_u8(&active_scene_pack, VN_SCENE_PACK_OFFSET_FLAGS)
        & PCE_VN_SCENE_FLAG_FULL_SCREEN_BG);
#endif
    current_scene = scene_index;
    current_command = 0u;
    active_message_index = -1;
    active_choice_index = -1;
    wait_frames_remaining = 0u;
    sync_input_mask = 0u;
    sync_input_target = PCE_VN_NO_COMMAND;
    async_input_watcher_count = 0u;
}

static void VN_HUCARD_CODE_SCRIPT advance_story(void)
{
    pce_vn_command_t command;
    restore_active_message_mouth();
    while (current_command < scene_pack_command_count(&active_scene_pack))
    {
        if (!scene_pack_read_command(&active_scene_pack, (uint8_t)current_command, &command)) return;
        current_command++;
        if (command.type == PCE_VN_COMMAND_BACKGROUND)
        {
            set_background(command.asset_index, command.flags, command.arg0, command.arg1, command.x, command.y);
        }
        else if (command.type == PCE_VN_COMMAND_SPRITE)
        {
            set_sprite(&command);
        }
        else if (command.type == PCE_VN_COMMAND_SPRITE_MOVE)
        {
            if (start_sprite_move(&command)) return;
        }
        else if (command.type == PCE_VN_COMMAND_MESSAGE)
        {
            if (command.message_index >= 0) start_message((uint8_t)command.message_index);
            return;
        }
        else if (command.type == PCE_VN_COMMAND_AUDIO)
        {
            handle_audio_command(&command);
        }
        else if (command.type == PCE_VN_COMMAND_CHOICE)
        {
            if (command.choice_index >= 0) start_choice((uint8_t)command.choice_index);
            return;
        }
        else if (command.type == PCE_VN_COMMAND_JUMP)
        {
            if (command.scene_index >= 0) show_scene((unsigned int)command.scene_index);
            return;
        }
        else if (command.type == PCE_VN_COMMAND_WAIT)
        {
            wait_frames_remaining = (uint16_t)command.arg0 | ((uint16_t)command.arg1 << 8);
            return;
        }
        else if (command.type == PCE_VN_COMMAND_EFFECT)
        {
            apply_effect(&command);
        }
        else if (command.type == PCE_VN_COMMAND_VARIABLE)
        {
            apply_variable_command(&command);
        }
        else if (command.type == PCE_VN_COMMAND_IF)
        {
            const int16_t left = get_variable_value(command.asset_index);
            const int16_t right = command_s16_value(&command);
            const uint16_t target = compare_values(left, right, command.flags) ? command.x : command.y;
            if (target != PCE_VN_NO_COMMAND) current_command = target;
        }
        else if (command.type == PCE_VN_COMMAND_SWITCH)
        {
            vn_switch_ref_t branch;
            uint8_t i;
            uint16_t target = PCE_VN_NO_COMMAND;
            if (command.choice_index >= 0 && scene_pack_read_switch(&active_scene_pack, (uint8_t)command.choice_index, &branch))
            {
                for (i = 0u; i < branch.case_count; i++)
                {
                    pce_vn_switch_case_t branch_case;
                    if (scene_pack_read_switch_case(&active_scene_pack, &branch, i, &branch_case)
                        && branch_case.value == get_variable_value(command.asset_index))
                    {
                        target = branch_case.command;
                        break;
                    }
                }
                if (target == PCE_VN_NO_COMMAND) target = branch.default_command;
                if (target != PCE_VN_NO_COMMAND) current_command = target;
            }
        }
        else if (command.type == PCE_VN_COMMAND_GOTO)
        {
            if (command.x != PCE_VN_NO_COMMAND) current_command = command.x;
        }
        else if (command.type == PCE_VN_COMMAND_INPUTCHECK)
        {
            if (command.flags == PCE_VN_INPUT_MODE_CANCEL)
            {
                async_input_watcher_count = 0u;
            }
            else if (command.flags == PCE_VN_INPUT_MODE_ASYNC)
            {
                register_async_input_watcher(command.arg0, command.x);
            }
            else
            {
                sync_input_mask = command.arg0;
                sync_input_target = command.x;
                return;
            }
        }
        else if (command.type == PCE_VN_COMMAND_SPRITETEXT)
        {
            draw_spritetext(&command);
        }
        else if (command.type == PCE_VN_COMMAND_CACHE)
        {
            /* HuCARD VN has no CD/ADPCM cache path. */
        }
    }
    if (current_scene < pce_vn_scene_count)
    {
        const pce_vn_scene_pack_t *pack = &pce_vn_scene_packs[current_scene];
        if (pack->next_scene >= 0) show_scene((unsigned int)pack->next_scene);
    }
}

static void VN_HUCARD_CODE_SCRIPT init_variables(void)
{
    uint16_t i;
    for (i = 0u; i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        set_variable_value((int16_t)i, pce_vn_variable_initial_values[i]);
    }
}

static void VN_HUCARD_CODE_SCRIPT init_scene_cache(void)
{
    active_scene_pack.ref = (const pce_editor_data_ref_t *)0;
    active_scene_pack.size = 0u;
    current_scene = PCE_VN_INVALID_SCENE;
    active_scene_pack.scene_index = PCE_VN_INVALID_SCENE;
    active_scene_pack.valid = 0u;
}

static void VN_HUCARD_CODE_VIDEO init_video(void)
{
    pce_cpu_irq_disable();
    pce_irq_disable(IRQ_VDC);
    pce_vdc_set_resolution(256u, 224u, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    /* BXR/BYR have scanline side effects even when the written value is
       unchanged. Initialize them once while display is disabled; VRAM/SATB
       transfers only change the VDC address register and never need to
       "restore" scroll during message rendering. */
    pce_vdc_poke(VDC_REG_BG_SCROLL_X, 0u);
    pce_vdc_poke(VDC_REG_BG_SCROLL_Y, 0u);
    set_vdc_control(VN_VDC_CONTROL_BASE);
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    clear_sprites();
    clear_screen_map(0);
    upload_blank_tile();
    map_message_window_cells(0u);
    clear_window_tile_pixels();
    write_ui_text_palette(0x01ffu);
    upload_font_sprite_patterns();
    upload_sprite_table();
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
}

int main(void)
{
    pce_vn_hucard_map_runtime_banks();
    psg_init();
    init_scene_cache();
    init_variables();
    active_message_mouth_animation_index = -1;
    sprite_animation_refresh_mask = 0u;
    init_video();
    /* llvm-mos returns the hardware's active-low pad byte.  Keep the runtime
       edge state active-high so PAD_* means "currently pressed". */
    last_pad = (uint8_t)~pce_joypad_read();
    show_scene(pce_vn_start_scene);
    advance_story();
    tick_sprites();

    while (1)
    {
        uint8_t pad;
        uint8_t pressed;
        uint8_t async_input_index;
        uint8_t message_ticked = 0u;
        wait_vblank();
        if (active_message_index >= 0)
        {
            if (!message_complete)
            {
                tick_active_message();
                message_ticked = 1u;
            }
            else
            {
                tick_message_wait_indicator();
            }
        }
        pad = (uint8_t)~pce_joypad_read();
        pressed = (uint8_t)(pad & (uint8_t)~last_pad);
        last_pad = pad;
        if (pressed & PAD_SELECT)
        {
            const uint8_t auto_enable =
                (uint8_t)(get_variable_value(PCE_VN_VARIABLE_AUTO_ENABLE_INDEX) == 0);
            set_variable_value(PCE_VN_VARIABLE_AUTO_ENABLE_INDEX, auto_enable);
            pressed = (uint8_t)(pressed & (uint8_t)~PAD_SELECT);
            if (active_message_index >= 0)
            {
                if (auto_enable && message_complete)
                    message_auto_wait = active_message_state.auto_wait_frames;
                refresh_message_wait_indicator();
            }
        }
        async_input_index = find_async_input_watcher(pressed);
        if (async_input_index < async_input_watcher_count)
        {
            const uint16_t target = async_input_targets[async_input_index];
            async_input_watcher_count = 0u;
            sync_input_mask = 0u;
            sync_input_target = PCE_VN_NO_COMMAND;
            if (target != PCE_VN_NO_COMMAND) current_command = target;
            reset_message_wait_indicator_state();
            active_message_index = -1;
            active_choice_index = -1;
            wait_frames_remaining = 0u;
#if PCE_VN_HAS_FULL_SCREEN_BG
            if (!current_scene_full_screen_bg) hide_message_window_map();
#else
            hide_message_window_map();
#endif
            cancel_all_sprite_moves();
            advance_story();
            goto frame_end;
        }
        if (sync_sprite_move_slot < VN_SPRITE_SLOT_COUNT)
        {
            if (!sprite_moves[sync_sprite_move_slot].active)
            {
                sync_sprite_move_slot = 0xffu;
                advance_story();
            }
            goto frame_end;
        }
        if (active_choice_index >= 0)
        {
            handle_choice_input(pressed);
            goto frame_end;
        }
        if (sync_input_mask)
        {
            if (pressed & sync_input_mask)
            {
                const uint16_t target = sync_input_target;
                sync_input_mask = 0u;
                sync_input_target = PCE_VN_NO_COMMAND;
                async_input_watcher_count = 0u;
                if (target != PCE_VN_NO_COMMAND) current_command = target;
                advance_story();
            }
            goto frame_end;
        }
        if (active_message_index >= 0)
        {
            if (!message_ticked && !message_complete) tick_active_message();
            if (pressed & (PAD_I | PAD_II | PAD_RUN))
            {
                if (!message_complete) finish_active_message();
                else
                {
                    reset_message_wait_indicator_state();
                    active_message_index = -1;
                    hide_message_window_map();
                    advance_story();
                }
            }
            else if (message_complete
                && get_variable_value(PCE_VN_VARIABLE_AUTO_ENABLE_INDEX) != 0)
            {
                if (message_auto_wait) message_auto_wait--;
                else
                {
                    reset_message_wait_indicator_state();
                    active_message_index = -1;
                    hide_message_window_map();
                    advance_story();
                }
            }
            goto frame_end;
        }
        if (wait_frames_remaining)
        {
            wait_frames_remaining--;
            if (!wait_frames_remaining) advance_story();
            goto frame_end;
        }
        advance_story();
frame_end:
        tick_sprites();
        service_psg();
    }

    return 0;
}
