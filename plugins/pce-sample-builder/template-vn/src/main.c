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
#define VN_VDC_CONTROL_BASE (VDC_CONTROL_IRQ_VBLANK | VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_VRAM_ADD_1)
#define VN_VDC_DISPLAY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE)
#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE

static uint8_t current_scene = 0;
static uint8_t current_message = 0;
static uint8_t pending_sprite_refresh = 0;
static uint8_t pending_cdda_track = 0;
static uint8_t pending_display_enable = 0;
#if defined(__PCE__)
static vdc_sprite_t sprite_shadow[64];
#endif
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

static void copy_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref, uint16_t word_stride)
{
    uint8_t i;
    uint16_t word_offset = 0;
    if (!ref || !ref->size) return;
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

static void upload_ui_palette(void)
{
    uint8_t i;
    uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    vce_write_color((uint16_t)(base + 0u), 0x0000u);
    vce_write_color((uint16_t)(base + 1u), 0x0000u);
    for (i = 2u; i < 16u; i++)
    {
        vce_write_color((uint16_t)(base + i), 0x01ffu);
    }
}

static void upload_font_tiles(void)
{
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
        if (glyph == 0u)
        {
            draw_blank_cell((uint8_t)(VN_TEXT_X + (col * 2u)), (uint8_t)(VN_TEXT_Y + (row * 2u)));
            col++;
        }
        else
        {
            draw_glyph(glyph, (uint8_t)(VN_TEXT_X + (col * 2u)), (uint8_t)(VN_TEXT_Y + (row * 2u)));
            col++;
        }
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

static uint8_t show_character_sprite(uint8_t satb_index, const pce_editor_sprite_asset_t *sprite, uint16_t x, uint16_t y)
{
    uint8_t row;
    uint8_t col;
    uint8_t columns;
    uint8_t rows;
    uint8_t written = 0u;
    uint8_t pattern_step;
    if (!sprite || !sprite->patterns.size) return 0u;
    upload_palette(&sprite->palette, (uint16_t)(256u + (sprite->palette_bank * 16u)), 1);
    copy_data_ref_to_vram((uint16_t)(sprite->pattern_base * 32u), &sprite->patterns, 16u);
    columns = sprite->cell_columns ? sprite->cell_columns : 1u;
    rows = sprite->cell_rows ? sprite->cell_rows : 1u;
    pattern_step = sprite_patterns_per_cell(sprite);
#if defined(__PCE__)
    for (row = 0u; row < rows; row++)
    {
        for (col = 0u; col < columns; col++)
        {
            vdc_sprite_t *entry;
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->y = (uint16_t)(y + ((uint16_t)row * sprite->cell_height) + 64u);
            entry->x = (uint16_t)(x + ((uint16_t)col * sprite->cell_width) + 32u);
            entry->pattern = (uint16_t)(sprite->pattern_base + ((uint16_t)written * pattern_step));
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

static void play_cdda_track(uint8_t track)
{
#if defined(__PCE_CD__)
    pce_sector_t start = {0};
    pce_sector_t end = {0};
    if (track < 2u) return;
    start.track = track;
    start.track_end = track;
    end.track = track;
    end.track_end = track;
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_TRACK, start, PCE_CDB_LOCATION_TYPE_UNTIL_END, end, PCE_CDB_CDDA_PLAY_REPEAT);
#else
    (void)track;
#endif
}

static void play_adpcm_voice(signed char voice_index)
{
#if defined(__PCE_CD__)
    const pce_editor_adpcm_asset_t *voice;
    if (voice_index < 0 || (uint8_t)voice_index >= pce_editor_adpcm_asset_count) return;
    voice = &pce_editor_adpcm_assets[(uint8_t)voice_index];
    if (!voice->data || !voice->data_size) return;
    pce_cdb_adpcm_reset();
    (void)pce_cdb_adpcm_read_from_ram(PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)voice->data, voice->adpcm_address, (uint16_t)voice->data_size);
    (void)pce_cdb_adpcm_play(voice->adpcm_address, (uint16_t)voice->data_size, voice->divider, voice->loop ? PCE_CDB_ADPCM_REPEAT : PCE_CDB_ADPCM_ONE_SHOT);
#else
    (void)voice_index;
#endif
}

static void show_scene(uint8_t scene_index)
{
    const pce_vn_scene_t *scene;
    if (!pce_vn_scene_count) return;
    if (scene_index >= pce_vn_scene_count) scene_index = pce_vn_start_scene;
    display_disable();
    pending_display_enable = 1;
    current_scene = scene_index;
    current_message = 0;
    scene = &pce_vn_scenes[current_scene];
    clear_screen_map();
    if (scene->bg_index < pce_editor_bg_asset_count)
    {
        upload_bg_graphics(&pce_editor_bg_assets[scene->bg_index]);
    }
    pending_sprite_refresh = 1;
    pending_cdda_track = scene->cdda_track;
}

static void refresh_scene_sprites(void)
{
    uint8_t i;
    uint8_t satb_index = 0u;
    const pce_vn_scene_t *scene = &pce_vn_scenes[current_scene];
    clear_sprites();
    for (i = 0; i < scene->character_count; i++)
    {
        const pce_vn_character_t *character = &scene->characters[i];
        if (character->sprite_index < pce_editor_sprite_asset_count)
        {
            satb_index = (uint8_t)(satb_index + show_character_sprite(satb_index, &pce_editor_sprite_assets[character->sprite_index], character->x, character->y));
        }
    }
    upload_sprite_table();
    if (!pending_display_enable) delay_frame();
    pending_sprite_refresh = 0;
}

static void show_current_message(void)
{
    const pce_vn_scene_t *scene = &pce_vn_scenes[current_scene];
    uint8_t message_index;
    if (current_message >= scene->message_count) current_message = 0;
    message_index = (uint8_t)(scene->message_start + current_message);
    clear_window_cells();
    if (message_index < pce_vn_message_count)
    {
        const pce_vn_message_t *message = &pce_vn_messages[message_index];
        play_adpcm_voice(message->voice_index);
        clear_window_cells();
        draw_message_text(message);
        if (!pending_display_enable) delay_frame();
    }
}

static void init_video(void)
{
#if defined(__PCE_CD__)
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
    uint8_t i;
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;

    init_video();
    show_scene(pce_vn_start_scene);
    show_current_message();
    if (pending_sprite_refresh) refresh_scene_sprites();
    enable_display_if_pending();
    for (i = 0; i < 4u; i++) delay_frame();
    for (i = 0; i < 30u; i++) delay_frame();
    if (pending_cdda_track >= 2u)
    {
        play_cdda_track(pending_cdda_track);
        pending_cdda_track = 0;
    }
    last_pad = read_pad_raw();

    while (1)
    {
        pad = read_pad_raw();
        pressed = (uint8_t)(pad & (uint8_t)~last_pad);
        if (pressed & (PAD_I | PAD_II | PAD_RUN | PAD_RIGHT | PAD_DOWN))
        {
            const pce_vn_scene_t *scene = &pce_vn_scenes[current_scene];
            current_message++;
            if (current_message >= scene->message_count)
            {
                if (scene->next_scene >= 0)
                {
                    show_scene((uint8_t)scene->next_scene);
                }
                else
                {
                    current_message = 0;
                }
            }
            show_current_message();
            if (pending_sprite_refresh)
            {
                refresh_scene_sprites();
            }
            enable_display_if_pending();
            if (pending_cdda_track >= 2u)
            {
                for (i = 0; i < 8u; i++) delay_frame();
                play_cdda_track(pending_cdda_track);
                pending_cdda_track = 0;
            }
        }
        last_pad = pad;
        delay_frame();
    }
    return 0;
}
