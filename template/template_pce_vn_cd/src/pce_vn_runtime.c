#include <stdint.h>

#if defined(__PCE_CD__)
#define PCE_CONFIG_IMPLEMENTATION
#endif
#if defined(__PCE__)
#include <pce.h>
#endif
#if defined(__PCE_CD__)
#include <pce-cd.h>
PCE_CDB_USE_GRAPHICS_DRIVER(1);
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
#define VN_SPRITE_SLOT_COUNT 4u
#define VN_EXEC_CONTINUE 0u
#define VN_EXEC_WAIT 1u
#define VN_EXEC_RESTART 2u

static uint8_t current_scene = 0;
static uint8_t current_command = 0;
static uint8_t pending_sprite_refresh = 0;
static uint8_t pending_display_enable = 0;
static uint8_t pending_scene_sprite_clear = 0;
static signed char current_bg_index;
static uint8_t preloaded_bg_valid = 0;
static uint8_t preloaded_bg_index = 0;
static uint8_t loaded_sprite_pattern_valid = 0;
static uint8_t loaded_sprite_pattern_index = 0;
static uint8_t loaded_adpcm_valid = 0;
static uint8_t loaded_adpcm_index = 0;
static signed char active_message_index;
static signed char active_choice_index;
static uint8_t choice_selected_index = 0;
static uint16_t wait_frames_remaining = 0;
static uint8_t message_glyph_pos = 0;
static uint8_t message_frame_timer = 0;
static uint8_t message_col = 0;
static uint8_t message_row = 0;
static uint8_t message_complete = 0;
static uint8_t message_auto_wait = 0;
typedef struct
{
    signed char sprite_index;
    signed char animation_index;
    uint16_t x;
    uint16_t y;
    uint8_t visible;
    uint8_t frame;
    uint8_t timer;
} vn_sprite_slot_t;
static vn_sprite_slot_t sprite_slots[VN_SPRITE_SLOT_COUNT];
#if defined(__PCE__)
static vdc_sprite_t sprite_shadow[64];
#endif
static void advance_story(void);

static void init_runtime_state(void)
{
    current_scene = 0u;
    current_command = 0u;
    pending_sprite_refresh = 0u;
    pending_display_enable = 0u;
    pending_scene_sprite_clear = 0u;
    current_bg_index = -1;
    preloaded_bg_valid = 0u;
    preloaded_bg_index = 0u;
    loaded_sprite_pattern_valid = 0u;
    loaded_sprite_pattern_index = 0u;
    loaded_adpcm_valid = 0u;
    loaded_adpcm_index = 0u;
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
}

static void delay_frame(void)
{
#if defined(__PCE_CD__)
    pce_cdb_wait_vblank();
#else
    volatile uint16_t delay;
    for (delay = 0; delay < 6200u; delay++) {}
#endif
}

static void display_disable(void)
{
#if defined(__PCE_CD__)
    pce_cdb_vdc_bg_sprite_disable();
    pce_vdc_poke(VDC_REG_CONTROL, VN_VDC_BLANK_CONTROL);
#elif defined(__PCE__)
    pce_vdc_disable((uint8_t)(VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE));
#endif
}

static void display_enable(void)
{
#if defined(__PCE_CD__)
    pce_cdb_vdc_bg_sprite_enable();
    pce_vdc_poke(VDC_REG_CONTROL, VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
#endif
}

static void sprite_layer_disable(void)
{
#if defined(__PCE__)
    pce_vdc_poke(VDC_REG_CONTROL, VN_VDC_BG_ONLY_CONTROL);
#endif
}

static void sprite_layer_enable(void)
{
#if defined(__PCE__)
    pce_vdc_poke(VDC_REG_CONTROL, VN_VDC_DISPLAY_CONTROL);
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

static void pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
#if defined(__PCE_CD__)
    pce_cdb_vdc_set_copy(PCE_CDB_VDC_COPY_1);
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

static uint8_t cd_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref)
{
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest;
    if (!ref || !ref->cd || !ref->cd->sector_count || !ref->size) return 0u;
    cd_sector_from_ref(&sector, &ref->cd->sector);
    remaining = (uint16_t)ref->size;
    vram_dest = dest;
    while (remaining)
    {
        uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_VRAM_BYTES, vram_dest, chunk);
        cd_transfer_wait();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    return 1u;
}
#endif

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
    pce_vn_font_tiles_map();
    pce_editor_vram_copy((uint16_t)(PCE_VN_FONT_TILE_BASE * 16u), pce_vn_font_tiles, (uint16_t)(pce_vn_font_glyph_count * 128u));
}

static void write_map_words(uint16_t map_addr, const uint16_t *words, uint16_t count)
{
#if defined(__PCE_CD__)
    uint16_t i;
    pce_cdb_vdc_set_copy(PCE_CDB_VDC_COPY_1);
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

static void draw_blank_cell(uint8_t x, uint8_t y)
{
    static uint16_t top[2];
    static uint16_t bottom[2];
    const uint16_t blank = ui_tile(VN_UI_BLANK_TILE);
    top[0] = blank;
    top[1] = blank;
    bottom[0] = blank;
    bottom[1] = blank;
    write_map_words((uint16_t)((y * VN_MAP_WIDTH) + x), top, 2u);
    write_map_words((uint16_t)(((y + 1u) * VN_MAP_WIDTH) + x), bottom, 2u);
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
    static uint16_t top[2];
    static uint16_t bottom[2];
    uint16_t tile = (uint16_t)(PCE_VN_FONT_TILE_BASE + ((uint16_t)glyph * 4u));
    top[0] = ui_tile(tile);
    top[1] = ui_tile((uint16_t)(tile + 1u));
    bottom[0] = ui_tile((uint16_t)(tile + 2u));
    bottom[1] = ui_tile((uint16_t)(tile + 3u));
    write_map_words((uint16_t)((y * VN_MAP_WIDTH) + x), top, 2u);
    write_map_words((uint16_t)(((y + 1u) * VN_MAP_WIDTH) + x), bottom, 2u);
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

static void upload_bg_graphics(const pce_editor_bg_asset_t *bg)
{
    uint8_t row;
    uint16_t row_bytes;
    const uint8_t *map;
    if (!bg) return;
    upload_palette(&bg->palette, (uint16_t)(bg->palette_bank * 16u), 0);
    copy_data_ref_to_vram((uint16_t)(bg->tile_base * 16u), &bg->tiles, 16u);
#if defined(__PCE_CD__)
    if (bg->map.cd && bg->map.size)
    {
        copy_data_ref_to_vram(bg->map_base, &bg->map, 16u);
        return;
    }
#endif
    map = data_ref_ptr(&bg->map);
    if (!map) return;
    row_bytes = (uint16_t)(bg->width_tiles * 2u);
    for (row = 0; row < bg->height_tiles; row++)
    {
        pce_editor_vram_copy(
            (uint16_t)(bg->map_base + ((uint16_t)row * VN_MAP_WIDTH)),
            map + ((uint16_t)row * row_bytes),
            row_bytes
        );
    }
}

static uint16_t sprite_attr_for_size(const pce_editor_sprite_asset_t *sprite)
{
    uint16_t attr = (uint16_t)(VDC_SPRITE_FG | VDC_SPRITE_COLOR(sprite->palette_bank));
    if (sprite->cell_width >= 32u) attr |= VDC_SPRITE_WIDTH_32;
    if (sprite->cell_height >= 64u) attr |= VDC_SPRITE_HEIGHT_64;
    else if (sprite->cell_height >= 32u) attr |= VDC_SPRITE_HEIGHT_32;
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
#if defined(__PCE_CD__)
#endif
#if defined(__PCE__)
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_editor_vram_copy(VN_SATB_ADDR, (const uint8_t *)sprite_shadow, (uint16_t)(64u * sizeof(vdc_sprite_t)));
    pce_vdc_poke(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC);
    pce_vdc_poke(VDC_REG_SATB_START, VN_SATB_ADDR);
#endif
}

static uint8_t sprite_patterns_per_cell(const pce_editor_sprite_asset_t *sprite)
{
    uint8_t pattern_cols = (uint8_t)((sprite->cell_width + 15u) / 16u);
    uint8_t pattern_rows = (uint8_t)((sprite->cell_height + 15u) / 16u);
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

static uint8_t show_character_sprite_frame(uint8_t satb_index, uint8_t sprite_index, const pce_editor_sprite_asset_t *sprite, const pce_vn_sprite_anim_t *animation, uint8_t frame, uint16_t x, uint16_t y)
{
    uint8_t row;
    uint8_t col;
    uint8_t frame_columns;
    uint8_t frame_rows;
    uint8_t written = 0u;
    uint8_t pattern_step;
    uint16_t first_cell;
    uint16_t total_cells;
    if (!sprite || !sprite->patterns.size) return 0u;
    upload_palette(&sprite->palette, (uint16_t)(256u + (sprite->palette_bank * 16u)), 1);
    (void)sprite_index;
    frame_columns = animation && animation->frame_width_cells ? animation->frame_width_cells : (sprite->cell_columns ? sprite->cell_columns : 1u);
    frame_rows = animation && animation->frame_height_cells ? animation->frame_height_cells : (sprite->cell_rows ? sprite->cell_rows : 1u);
    first_cell = animation
        ? (uint16_t)(animation->first_cell + ((uint16_t)frame * animation->frame_stride_cells))
        : 0u;
    total_cells = (uint16_t)((sprite->cell_columns ? sprite->cell_columns : 1u) * (sprite->cell_rows ? sprite->cell_rows : 1u));
    pattern_step = sprite_patterns_per_cell(sprite);
#if defined(__PCE__)
    for (row = 0u; row < frame_rows; row++)
    {
        for (col = 0u; col < frame_columns; col++)
        {
            vdc_sprite_t *entry;
            uint16_t source_cell = (uint16_t)(first_cell + ((uint16_t)row * sprite->cell_columns) + col);
            if (source_cell >= total_cells) continue;
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->y = (uint16_t)(y + ((uint16_t)row * sprite->cell_height) + 64u);
            entry->x = (uint16_t)(x + ((uint16_t)col * sprite->cell_width) + 32u);
            entry->pattern = (uint16_t)(sprite->pattern_base + (source_cell * pattern_step));
            entry->attr = sprite_attr_for_size(sprite);
            written++;
        }
    }
#else
    (void)x;
    (void)y;
    (void)satb_index;
#endif
    return written;
}

static void play_cdda_track(uint8_t track, uint8_t loop)
{
#if defined(__PCE_CD__)
    pce_sector_t start = {0};
    pce_sector_t end = {0};
    const uint8_t mode = loop ? PCE_CDB_CDDA_PLAY_REPEAT : PCE_CDB_CDDA_PLAY_ONE_SHOT;
    if (track < 2u) return;
    start.track = track;
    start.track_end = track;
    end.track = track;
    end.track_end = track;
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_TRACK, start, PCE_CDB_LOCATION_TYPE_UNTIL_END, end, mode);
#else
    (void)track;
    (void)loop;
#endif
}

static void stop_cdda_track(void)
{
#if defined(__PCE_CD__)
    (void)pce_cdb_cdda_pause();
#endif
}

static void play_adpcm_voice(signed char voice_index)
{
#if defined(__PCE_CD__)
    const pce_editor_adpcm_asset_t *voice;
    if (voice_index < 0 || (uint8_t)voice_index >= pce_editor_adpcm_asset_count) return;
    if (loaded_adpcm_valid && loaded_adpcm_index == (uint8_t)voice_index) return;
    voice = &pce_editor_adpcm_assets[(uint8_t)voice_index];
    if ((!voice->data && !voice->cd) || !voice->data_size) return;
    if (!loaded_adpcm_valid || loaded_adpcm_index != (uint8_t)voice_index)
    {
        pce_cdb_adpcm_reset();
        if (voice->cd && voice->cd->sector_count)
        {
            pce_sector_t sector = {0};
            const uint16_t sector_count = voice->cd->sector_count;
            const uint8_t read_count = sector_count > 255u ? 255u : (uint8_t)sector_count;
            cd_sector_from_ref(&sector, &voice->cd->sector);
            (void)pce_cdb_adpcm_read_from_cd(sector, read_count, voice->adpcm_address);
        }
        else
        {
            (void)pce_cdb_adpcm_read_from_ram(PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)voice->data, voice->adpcm_address, (uint16_t)voice->data_size);
        }
        loaded_adpcm_valid = 1u;
        loaded_adpcm_index = (uint8_t)voice_index;
    }
    (void)pce_cdb_adpcm_play(voice->adpcm_address, (uint16_t)voice->data_size, voice->divider, voice->loop ? PCE_CDB_ADPCM_REPEAT : PCE_CDB_ADPCM_ONE_SHOT);
#else
    (void)voice_index;
#endif
}

static void stop_adpcm_voice(void)
{
#if defined(__PCE_CD__)
    pce_cdb_adpcm_stop();
#endif
}

static void show_scene(uint8_t scene_index)
{
    uint8_t i;
    uint8_t keep_display_for_transition;
    if (!pce_vn_scene_count) return;
    if (scene_index >= pce_vn_scene_count) scene_index = pce_vn_start_scene;
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
        sprite_slots[i].frame = 0u;
        sprite_slots[i].timer = 0u;
    }
    pending_scene_sprite_clear = keep_display_for_transition ? 1u : 0u;
    pending_sprite_refresh = 1u;
}

static void refresh_scene_sprites(void)
{
    uint8_t i;
    uint8_t satb_index = 0u;
    const uint8_t display_active = (uint8_t)!pending_display_enable;
    uint8_t requires_pattern_upload = 0u;
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
        const pce_vn_sprite_anim_t *animation = 0;
        if (!slot->visible || slot->sprite_index < 0) continue;
        if ((uint8_t)slot->sprite_index >= pce_editor_sprite_asset_count) continue;
        if (slot->animation_index >= 0 && (uint8_t)slot->animation_index < pce_vn_sprite_animation_count)
        {
            animation = &pce_vn_sprite_animations[(uint8_t)slot->animation_index];
        }
        (void)ensure_sprite_patterns_loaded((uint8_t)slot->sprite_index, &pce_editor_sprite_assets[(uint8_t)slot->sprite_index]);
        satb_index = (uint8_t)(satb_index + show_character_sprite_frame(satb_index, (uint8_t)slot->sprite_index, &pce_editor_sprite_assets[(uint8_t)slot->sprite_index], animation, slot->frame, slot->x, slot->y));
    }
    upload_sprite_table();
    if (display_active && requires_pattern_upload)
    {
        sprite_layer_enable();
        delay_frame();
    }
    pending_sprite_refresh = 0;
}

static void tick_sprite_animations(void)
{
    uint8_t i;
    uint8_t changed = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = &sprite_slots[i];
        const pce_vn_sprite_anim_t *animation;
        if (!slot->visible || slot->animation_index < 0) continue;
        if ((uint8_t)slot->animation_index >= pce_vn_sprite_animation_count) continue;
        animation = &pce_vn_sprite_animations[(uint8_t)slot->animation_index];
        if (animation->frame_count <= 1u) continue;
        slot->timer++;
        if (slot->timer < animation->frame_delay) continue;
        slot->timer = 0u;
        if (slot->frame + 1u < animation->frame_count)
        {
            slot->frame++;
        }
        else if (animation->loop)
        {
            slot->frame = 0u;
        }
        changed = 1u;
    }
    if (changed) pending_sprite_refresh = 1u;
}

static void start_message(uint8_t message_index)
{
    const pce_vn_message_t *message;
    clear_window_cells();
    if (message_index < pce_vn_message_count)
    {
        message = &pce_vn_messages[message_index];
        active_message_index = (signed char)message_index;
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
    if (active_message_index < 0) return;
    if ((uint8_t)active_message_index >= pce_vn_message_count) return;
    draw_message_text(&pce_vn_messages[(uint8_t)active_message_index]);
    message_complete = 1u;
}

static void tick_active_message(void)
{
    const pce_vn_message_t *message;
    if (active_message_index < 0 || message_complete) return;
    if ((uint8_t)active_message_index >= pce_vn_message_count) return;
    message = &pce_vn_messages[(uint8_t)active_message_index];
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

static void preload_adpcm_voice(signed char voice_index)
{
#if defined(__PCE_CD__)
    const pce_editor_adpcm_asset_t *voice;
    if (voice_index < 0 || (uint8_t)voice_index >= pce_editor_adpcm_asset_count) return;
    voice = &pce_editor_adpcm_assets[(uint8_t)voice_index];
    if ((!voice->data && !voice->cd) || !voice->data_size) return;
    pce_cdb_adpcm_reset();
    if (voice->cd && voice->cd->sector_count)
    {
        pce_sector_t sector = {0};
        const uint16_t sector_count = voice->cd->sector_count;
        const uint8_t read_count = sector_count > 255u ? 255u : (uint8_t)sector_count;
        cd_sector_from_ref(&sector, &voice->cd->sector);
        (void)pce_cdb_adpcm_read_from_cd(sector, read_count, voice->adpcm_address);
    }
    else
    {
        (void)pce_cdb_adpcm_read_from_ram(PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)voice->data, voice->adpcm_address, (uint16_t)voice->data_size);
    }
    loaded_adpcm_valid = 1u;
    loaded_adpcm_index = (uint8_t)voice_index;
#else
    (void)voice_index;
#endif
}

static void preload_scene_assets(signed char scene_index)
{
    const pce_vn_scene_t *scene;
    uint8_t i;
    if (scene_index < 0 || (uint8_t)scene_index >= pce_vn_scene_count) return;
    scene = &pce_vn_scenes[(uint8_t)scene_index];
    for (i = 0u; i < scene->command_count; i++)
    {
        const uint8_t command_index = (uint8_t)(scene->command_start + i);
        const pce_vn_command_t *command;
        if (command_index >= pce_vn_command_count) continue;
        command = &pce_vn_commands[command_index];
        if (command->type == PCE_VN_COMMAND_BACKGROUND)
        {
            if (command->asset_index < 0 || (uint8_t)command->asset_index >= pce_editor_bg_asset_count) continue;
            if (preloaded_bg_valid && preloaded_bg_index == (uint8_t)command->asset_index) continue;
            if (!pending_display_enable)
            {
                display_disable();
                pending_display_enable = 1u;
            }
            if (pending_scene_sprite_clear) hide_sprites_for_asset_load();
            clear_screen_map();
            upload_bg_graphics(&pce_editor_bg_assets[(uint8_t)command->asset_index]);
            preloaded_bg_valid = 1u;
            preloaded_bg_index = (uint8_t)command->asset_index;
        }
        else if (command->type == PCE_VN_COMMAND_SPRITE)
        {
            if (!(command->flags & PCE_VN_SPRITE_VISIBLE)) continue;
            if (command->asset_index < 0 || (uint8_t)command->asset_index >= pce_editor_sprite_asset_count) continue;
            if (loaded_sprite_pattern_valid && loaded_sprite_pattern_index == (uint8_t)command->asset_index) continue;
            hide_sprites_for_asset_load();
            (void)ensure_sprite_patterns_loaded((uint8_t)command->asset_index, &pce_editor_sprite_assets[(uint8_t)command->asset_index]);
        }
        else if (command->type == PCE_VN_COMMAND_MESSAGE)
        {
            if (command->message_index >= 0 && (uint8_t)command->message_index < pce_vn_message_count)
            {
                preload_adpcm_voice(pce_vn_messages[(uint8_t)command->message_index].voice_index);
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
    const pce_vn_choice_t *choice;
    if (active_choice_index < 0 || (uint8_t)active_choice_index >= pce_vn_choice_count) return;
    choice = &pce_vn_choices[(uint8_t)active_choice_index];
    clear_window_cells();
    for (row = 0u; row < choice->option_count && row < VN_TEXT_ROWS; row++)
    {
        uint8_t col;
        const pce_vn_choice_option_t *option = &choice->options[row];
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
    const pce_vn_choice_t *choice;
    if (choice_index >= pce_vn_choice_count) return;
    choice = &pce_vn_choices[choice_index];
    if (!choice->option_count) return;
    active_message_index = -1;
    message_complete = 1u;
    wait_frames_remaining = 0u;
    active_choice_index = (signed char)choice_index;
    choice_selected_index = choice->default_index < choice->option_count ? choice->default_index : 0u;
    draw_choice_options();
}

static uint8_t handle_choice_input(uint8_t pressed)
{
    const pce_vn_choice_t *choice;
    if (active_choice_index < 0 || (uint8_t)active_choice_index >= pce_vn_choice_count) return 0u;
    choice = &pce_vn_choices[(uint8_t)active_choice_index];
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
        const signed char target = choice->options[choice_selected_index].target_scene;
        active_choice_index = -1;
        clear_window_cells();
        if (target >= 0) show_scene((uint8_t)target);
        advance_story();
        return 1u;
    }
    return 0u;
}

static void set_background(signed char bg_index, uint8_t transition, uint8_t fade_out_frames, uint8_t fade_in_frames)
{
    const pce_editor_bg_asset_t *next_bg;
    const uint8_t fade_transition = (uint8_t)(transition == PCE_VN_BG_TRANSITION_FADE);
    uint8_t bg_ready;
    if (bg_index < 0 || (uint8_t)bg_index >= pce_editor_bg_asset_count) return;
    next_bg = &pce_editor_bg_assets[(uint8_t)bg_index];
    if (fade_transition && current_bg_index >= 0 && !pending_display_enable)
    {
        fade_palette(&pce_editor_bg_assets[(uint8_t)current_bg_index].palette, (uint16_t)(pce_editor_bg_assets[(uint8_t)current_bg_index].palette_bank * 16u), fade_out_frames, 0u);
        display_disable();
        pending_display_enable = 1u;
    }
    else if (!pending_display_enable && current_bg_index >= 0 && bg_index != current_bg_index)
    {
        display_disable();
        pending_display_enable = 1u;
    }
    preload_scene_assets((signed char)current_scene);
    if (pending_scene_sprite_clear)
    {
        clear_sprites();
        upload_sprite_table();
        pending_scene_sprite_clear = 0u;
    }
    bg_ready = (uint8_t)(preloaded_bg_valid && preloaded_bg_index == (uint8_t)bg_index);
    if (!bg_ready)
    {
        clear_screen_map();
        upload_bg_graphics(next_bg);
        preloaded_bg_valid = 1u;
        preloaded_bg_index = (uint8_t)bg_index;
    }
    current_bg_index = bg_index;
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
        set_background(command->asset_index, command->flags, command->arg0, command->arg1);
    }
    else if (command->type == PCE_VN_COMMAND_SPRITE)
    {
        slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
        sprite_slots[slot].sprite_index = command->asset_index;
        sprite_slots[slot].animation_index = command->animation_index;
        sprite_slots[slot].x = command->x;
        sprite_slots[slot].y = command->y;
        sprite_slots[slot].visible = (uint8_t)((command->flags & PCE_VN_SPRITE_VISIBLE) && command->asset_index >= 0);
        sprite_slots[slot].frame = 0u;
        sprite_slots[slot].timer = 0u;
        pending_sprite_refresh = 1u;
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
                play_cdda_track(cdda->track, cdda->loop);
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
        preload_scene_assets(command->scene_index);
    }
    else if (command->type == PCE_VN_COMMAND_CHOICE)
    {
        if (command->choice_index >= 0)
        {
            start_choice((uint8_t)command->choice_index);
            return active_choice_index >= 0 ? VN_EXEC_WAIT : VN_EXEC_CONTINUE;
        }
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
    }
    return VN_EXEC_CONTINUE;
}

static uint8_t run_commands_until_wait(void)
{
    active_message_index = -1;
    message_complete = 1u;
    active_choice_index = -1;
    for (;;)
    {
        const pce_vn_scene_t *scene = &pce_vn_scenes[current_scene];
        uint8_t restart = 0u;
        while (current_command < scene->command_count)
        {
            const uint8_t command_index = (uint8_t)(scene->command_start + current_command);
            current_command++;
            if (command_index < pce_vn_command_count)
            {
                const uint8_t result = execute_command(&pce_vn_commands[command_index]);
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

static void advance_story(void)
{
    if (!run_commands_until_wait())
    {
        const pce_vn_scene_t *scene = &pce_vn_scenes[current_scene];
        if (scene->next_scene >= 0) show_scene((uint8_t)scene->next_scene);
        else current_command = 0u;
        run_commands_until_wait();
    }
    if (pending_sprite_refresh) refresh_scene_sprites();
    enable_display_if_pending();
}

static void init_video(void)
{
#if defined(__PCE_CD__)
    pce_cdb_irq_enable((uint8_t)(PCE_CDB_MASK_IRQ_EXTERNAL | PCE_CDB_MASK_VBLANK));
    (void)pce_cdb_vdc_set_resolution(PCE_CDB_VDC_CLOCK_7MHZ, 40u, 28u);
    pce_cdb_vdc_bg_set_size(PCE_CDB_VDC_BG_SIZE_64_32);
    pce_cdb_vdc_set_copy(PCE_CDB_VDC_COPY_1);
    pce_cdb_vdc_bg_sprite_disable();
    pce_cdb_vdc_sprite_table_set_vram_addr(VN_SATB_ADDR);
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
#elif defined(__PCE__)
    pce_vdc_set_resolution(320, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_64_32);
    pce_vdc_set_copy_word();
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
#endif
    upload_ui_palette();
    upload_font_tiles();
    clear_screen_map();
}

int main(void)
{
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;

    init_runtime_state();
    init_video();
    show_scene(pce_vn_start_scene);
    preload_scene_assets((signed char)pce_vn_start_scene);
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
            const pce_vn_message_t *message = &pce_vn_messages[(uint8_t)active_message_index];
            if (message->advance_mode == PCE_VN_ADVANCE_AUTO)
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
