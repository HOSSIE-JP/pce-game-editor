#include <stdint.h>

#if !defined(__PCE__)
#error "The PCE slideshow template requires llvm-mos-sdk and mos-pce-clang."
#endif

#include <pce.h>

#include "generated/assets.h"

#define SLIDE_HOLD_FRAMES 180u
#define FADE_STEP_FRAMES 2u
#define BAT_WIDTH_TILES 32u
#define BAT_HEIGHT_TILES 32u
#define BG_PALETTE_COLORS 16u
#define BG_TILE_BYTES 32u
#define SATB_FIRST_TILE 2032u
#define SLIDESHOW_VDC_CONTROL_BASE (VDC_CONTROL_IRQ_VBLANK | VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_VRAM_ADD_1)
#define SLIDESHOW_VDC_DISPLAY_CONTROL (SLIDESHOW_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG)
#define SLIDESHOW_PAD_NEXT_MASK (KEY_RIGHT | KEY_UP | KEY_DOWN | KEY_RUN | KEY_SELECT | KEY_1 | KEY_2)
#define SLIDESHOW_PSG_STEP_ACCUM_UNIT 3600u
#define SLIDESHOW_PSG_STEPS_PER_BEAT 4u

#define PCE_PSG_SELECT (*(volatile uint8_t *)0x0800)
#define PCE_PSG_GLOBAL (*(volatile uint8_t *)0x0801)
#define PCE_PSG_FREQ_LO (*(volatile uint8_t *)0x0802)
#define PCE_PSG_FREQ_HI (*(volatile uint8_t *)0x0803)
#define PCE_PSG_CONTROL (*(volatile uint8_t *)0x0804)
#define PCE_PSG_BALANCE (*(volatile uint8_t *)0x0805)
#define PCE_PSG_WAVE (*(volatile uint8_t *)0x0806)
#define PCE_PSG_NOISE (*(volatile uint8_t *)0x0807)

static uint8_t current_slide = 0;
static uint8_t blank_tile[BG_TILE_BYTES];
static uint16_t blank_bat_row[BAT_WIDTH_TILES];
static uint16_t vdc_control_shadow = SLIDESHOW_VDC_CONTROL_BASE;
static uint8_t last_pad = 0;
static uint8_t psg_active = 0;
static uint8_t psg_used_mask = 0;
static uint16_t psg_step = 0;
static uint16_t psg_step_accum = 0;
static const pce_editor_psg_asset_t *psg_current = (const pce_editor_psg_asset_t *)0;

static void tick_psg(void);

static void wait_vblank(void)
{
    while ((*IO_VDC_STATUS & VDC_FLAG_VBLANK) != 0u) {}
    while ((*IO_VDC_STATUS & VDC_FLAG_VBLANK) == 0u) {}
}

static void wait_frames(uint16_t frames)
{
    while (frames--)
    {
        wait_vblank();
        tick_psg();
    }
}

static uint16_t scale_vce_color(uint16_t color, uint8_t level)
{
    uint16_t c0 = color & 0x0007u;
    uint16_t c1 = (color >> 3) & 0x0007u;
    uint16_t c2 = (color >> 6) & 0x0007u;
    c0 = (uint16_t)((c0 * level) / 16u);
    c1 = (uint16_t)((c1 * level) / 16u);
    c2 = (uint16_t)((c2 * level) / 16u);
    return (uint16_t)(c0 | (c1 << 3) | (c2 << 6));
}

static void write_palette_color(uint8_t palette_bank, uint8_t color_index, uint16_t color)
{
    pce_vce_set_color((uint16_t)(((uint16_t)palette_bank * BG_PALETTE_COLORS) + color_index), color);
}

static void set_vdc_control(uint16_t control)
{
    vdc_control_shadow = control;
    pce_vdc_poke(VDC_REG_CONTROL, control);
}

static void set_vdc_copy_word(void)
{
    pce_vdc_poke(VDC_REG_CONTROL, vdc_control_shadow);
}

static void copy_to_vram(uint16_t dest, const void *source, uint16_t length)
{
    set_vdc_copy_word();
    pce_vdc_copy_to_vram(dest, source, length);
}

static void psg_load_basic_wave(uint8_t channel)
{
    uint8_t i;
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    PCE_PSG_CONTROL = 0u;
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
    for (i = 0u; i < 32u; i++)
    {
        PCE_PSG_WAVE = (uint8_t)((i < 16u) ? 31u : 0u);
    }
}

static void psg_set_voice(uint8_t channel, uint16_t period, uint8_t volume)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
    PCE_PSG_FREQ_LO = (uint8_t)(period & 0xffu);
    PCE_PSG_FREQ_HI = (uint8_t)((period >> 8) & 0x0fu);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static void psg_set_noise(uint8_t channel, uint8_t noise_freq, uint8_t volume)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_NOISE = volume ? (uint8_t)(0x80u | (noise_freq & 0x1fu)) : 0u;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static uint16_t psg_step_delta(const pce_editor_psg_asset_t *asset)
{
    uint16_t bpm = (asset && asset->bpm) ? asset->bpm : 150u;
    if (bpm < 30u) bpm = 30u;
    if (bpm > 300u) bpm = 300u;
    return (uint16_t)(bpm * SLIDESHOW_PSG_STEPS_PER_BEAT);
}

static void psg_apply_step_row(uint16_t step_no)
{
    uint16_t i;
    if (!psg_current || !psg_current->pattern) return;
    for (i = 0u; i < psg_current->pattern_count; i++)
    {
        const pce_editor_psg_step_t *step = &psg_current->pattern[i];
        if (step->step == step_no)
        {
            const uint8_t ch = step->channel > 5u ? 5u : step->channel;
            psg_used_mask = (uint8_t)(psg_used_mask | (uint8_t)(1u << ch));
            if (step->noise && ch >= 4u)
                psg_set_noise(ch, (uint8_t)(step->period & 0x1fu), step->volume);
            else
                psg_set_voice(ch, step->period, step->volume);
        }
    }
}

static void start_bgm(void)
{
    uint8_t i;
    for (i = 0u; i < pce_editor_psg_asset_count; i++)
    {
        const pce_editor_psg_asset_t *asset = &pce_editor_psg_assets[i];
        if (!asset->is_song || !asset->pattern || !asset->pattern_count) continue;
        PCE_PSG_GLOBAL = 0xffu;
        psg_current = asset;
        psg_step = 0u;
        psg_step_accum = 0u;
        psg_used_mask = 0u;
        for (i = 0u; i < 6u; i++)
        {
            psg_load_basic_wave(i);
        }
        psg_active = 1u;
        psg_apply_step_row(0u);
        return;
    }
}

static void tick_psg(void)
{
    uint16_t step_accum;
    if (!psg_active || !psg_current) return;
    step_accum = (uint16_t)(psg_step_accum + psg_step_delta(psg_current));
    if (step_accum < SLIDESHOW_PSG_STEP_ACCUM_UNIT)
    {
        psg_step_accum = step_accum;
        return;
    }
    psg_step_accum = (uint16_t)(step_accum - SLIDESHOW_PSG_STEP_ACCUM_UNIT);
    psg_step++;
    if (psg_step >= psg_current->steps) psg_step = 0u;
    psg_apply_step_row(psg_step);
}

static int8_t poll_slide_action(void)
{
    const uint8_t pad = pce_joypad_read();
    const uint8_t pressed = (uint8_t)(pad & (uint8_t)~last_pad);
    last_pad = pad;
    if (pressed & KEY_LEFT) return -1;
    if (pressed & SLIDESHOW_PAD_NEXT_MASK) return 1;
    return 0;
}

static int8_t wait_frames_for_action(uint16_t frames)
{
    int8_t action;
    while (frames--)
    {
        wait_vblank();
        tick_psg();
        action = poll_slide_action();
        if (action) return action;
    }
    return 0;
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

static void copy_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref)
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
            copy_to_vram((uint16_t)(dest + word_offset), chunk->data, (uint16_t)chunk->size);
            word_offset = (uint16_t)(word_offset + ((chunk->size + 1u) / 2u));
        }
        return;
    }
    if (ref->data)
    {
        copy_to_vram(dest, ref->data, (uint16_t)ref->size);
    }
}

static uint16_t blank_tile_index_for_bg(const pce_editor_bg_asset_t *bg)
{
    uint16_t tile_count;
    uint16_t tile_index;
    if (!bg) return 64u;
    tile_count = (uint16_t)((bg->tiles.size + (BG_TILE_BYTES - 1u)) / BG_TILE_BYTES);
    tile_index = (uint16_t)(bg->tile_base + tile_count);
    if (tile_index >= SATB_FIRST_TILE) tile_index = (uint16_t)(SATB_FIRST_TILE - 1u);
    return tile_index;
}

static void clear_screen_map(const pce_editor_bg_asset_t *bg)
{
    uint8_t row;
    uint8_t col;
    const uint16_t blank_tile_index = blank_tile_index_for_bg(bg);
    const uint16_t blank_word = (uint16_t)(((uint16_t)(bg ? bg->palette_bank : 0u) << 12) | blank_tile_index);
    for (col = 0; col < BAT_WIDTH_TILES; col++)
    {
        blank_bat_row[col] = blank_word;
    }
    copy_to_vram((uint16_t)(blank_tile_index * 16u), blank_tile, BG_TILE_BYTES);
    for (row = 0; row < BAT_HEIGHT_TILES; row++)
    {
        copy_to_vram((uint16_t)((uint16_t)row * BAT_WIDTH_TILES), blank_bat_row, (uint16_t)sizeof(blank_bat_row));
    }
}

static void apply_bg_palette_level(const pce_editor_bg_asset_t *bg, uint8_t level)
{
    uint8_t i;
    uint16_t color_count;
    const uint8_t *palette;
    if (!bg || !bg->palette.size) return;
    palette = data_ref_ptr(&bg->palette);
    if (!palette) return;
    color_count = (uint16_t)(bg->palette.size / 2u);
    if (color_count > BG_PALETTE_COLORS) color_count = BG_PALETTE_COLORS;
    for (i = 0; i < color_count; i++)
    {
        const uint16_t raw = (uint16_t)(palette[(uint16_t)i * 2u] | ((uint16_t)palette[((uint16_t)i * 2u) + 1u] << 8));
        write_palette_color(bg->palette_bank, i, scale_vce_color(raw, level));
    }
    for (; i < BG_PALETTE_COLORS; i++)
    {
        write_palette_color(bg->palette_bank, i, 0u);
    }
}

static void upload_bg_graphics(const pce_editor_bg_asset_t *bg)
{
    uint8_t row;
    uint16_t row_bytes;
    const uint8_t *map;
    if (!bg) return;
    clear_screen_map(bg);
    if (bg->tiles.size)
    {
        copy_data_ref_to_vram((uint16_t)(bg->tile_base * 16u), &bg->tiles);
    }
    if (bg->map.size)
    {
        map = data_ref_ptr(&bg->map);
        if (!map) return;
        row_bytes = (uint16_t)(bg->width_tiles * 2u);
        for (row = 0; row < bg->height_tiles; row++)
        {
            copy_to_vram(
                (uint16_t)(bg->map_base + ((uint16_t)row * BAT_WIDTH_TILES)),
                map + ((uint16_t)row * row_bytes),
                row_bytes
            );
        }
    }
}

static void fade_palette_to_level(const pce_editor_bg_asset_t *bg, uint8_t target_level)
{
    uint8_t level;
    if (!bg) return;
    if (target_level == 0u)
    {
        level = 16u;
        while (1)
        {
            apply_bg_palette_level(bg, level);
            wait_frames(FADE_STEP_FRAMES);
            if (level == 0u) break;
            level--;
        }
        return;
    }
    for (level = 0u; level <= 16u; level++)
    {
        apply_bg_palette_level(bg, level);
        wait_frames(FADE_STEP_FRAMES);
    }
}

static void show_slide(uint8_t slide, uint8_t fade_from_current)
{
    const pce_editor_bg_asset_t *bg;
    if (!pce_editor_bg_asset_count) return;
    if (slide >= pce_editor_bg_asset_count) slide = 0u;
    if (fade_from_current)
    {
        fade_palette_to_level(&pce_editor_bg_assets[current_slide], 0u);
    }
    current_slide = slide;
    bg = &pce_editor_bg_assets[current_slide];
    apply_bg_palette_level(bg, 0u);
    upload_bg_graphics(bg);
    fade_palette_to_level(bg, 16u);
}

static void init_video(void)
{
    pce_cpu_irq_disable();
    pce_irq_disable(IRQ_VDC);
    pce_vdc_set_resolution(256u, 224u, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    set_vdc_control(SLIDESHOW_VDC_CONTROL_BASE);
    clear_screen_map(0);
    set_vdc_control(SLIDESHOW_VDC_DISPLAY_CONTROL);
}

int main(void)
{
    int8_t action;

    init_video();
    last_pad = pce_joypad_read();
    start_bgm();
    show_slide(0u, 0u);

    while (1)
    {
        if (pce_editor_bg_asset_count <= 1u)
        {
            wait_frames(SLIDE_HOLD_FRAMES);
            continue;
        }
        action = wait_frames_for_action(SLIDE_HOLD_FRAMES);
        if (action < 0)
        {
            const uint8_t prev_slide = current_slide
                ? (uint8_t)(current_slide - 1u)
                : (uint8_t)(pce_editor_bg_asset_count - 1u);
            show_slide(prev_slide, 1u);
        }
        else
        {
            uint8_t next_slide = (uint8_t)(current_slide + 1u);
            if (next_slide >= pce_editor_bg_asset_count) next_slide = 0u;
            show_slide(next_slide, 1u);
        }
    }

    return 0;
}
