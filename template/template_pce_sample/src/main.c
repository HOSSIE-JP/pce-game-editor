#include <stdint.h>

#if defined(__CC65__)
#include <conio.h>
#include <joystick.h>
#include <pce.h>
#elif defined(__PCE__)
#include <pce.h>
#endif

#include "generated/assets.h"

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

#define PCE_PSG_SELECT (*(volatile uint8_t *)0x0800)
#define PCE_PSG_GLOBAL (*(volatile uint8_t *)0x0801)
#define PCE_PSG_FREQ_LO (*(volatile uint8_t *)0x0802)
#define PCE_PSG_FREQ_HI (*(volatile uint8_t *)0x0803)
#define PCE_PSG_CONTROL (*(volatile uint8_t *)0x0804)
#define PCE_PSG_BALANCE (*(volatile uint8_t *)0x0805)
#define PCE_PSG_WAVE (*(volatile uint8_t *)0x0806)

#if defined(__CC65__)
#define PCE_VDC_CTRL (*(volatile uint8_t *)0x0200)
#define PCE_VDC_DATA_LO (*(volatile uint8_t *)0x0202)
#define PCE_VDC_DATA_HI (*(volatile uint8_t *)0x0203)
#define PCE_VDC_CR_BG_ENABLE 0x0080u
#define PCE_VDC_CR_DRAM_REFRESH 0x0400u
#define PCE_VDC_CR_VRAM_ADD_1 0x0000u

static uint8_t pce_pad_ready = 0;

static void pce_editor_vdc_write(uint8_t reg, uint16_t value)
{
    PCE_VDC_CTRL = reg;
    PCE_VDC_DATA_LO = (uint8_t)(value & 0xffu);
    PCE_VDC_DATA_HI = (uint8_t)((value >> 8) & 0xffu);
}

static void pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
    pce_editor_vdc_write(5, PCE_VDC_CR_BG_ENABLE | PCE_VDC_CR_DRAM_REFRESH | PCE_VDC_CR_VRAM_ADD_1);
    pce_editor_vdc_write(0, dest);
    PCE_VDC_CTRL = 2;
    while (length >= 2u)
    {
        PCE_VDC_DATA_LO = *source++;
        PCE_VDC_DATA_HI = *source++;
        length = (uint16_t)(length - 2u);
    }
    if (length)
    {
        PCE_VDC_DATA_LO = *source;
        PCE_VDC_DATA_HI = 0;
    }
}

static void pce_editor_init_video(void)
{
    bordercolor(0);
    bgcolor(0);
    cursor(0);
    clrscr();
}

static uint8_t read_pad_raw(void)
{
    if (!pce_pad_ready)
    {
        joy_install((void *)pce_stdjoy_joy);
        pce_pad_ready = 1;
    }
    return joy_read(JOY_1);
}
#elif defined(__PCE__)
static void pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
    pce_vdc_copy_to_vram(dest, source, length);
}

static void pce_editor_init_video(void)
{
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_set_copy_word();
    pce_vdc_bg_enable();
}

static uint8_t read_pad_raw(void)
{
    return pce_joypad_read();
}
#else
static void pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
    (void)dest;
    (void)source;
    (void)length;
}

static void pce_editor_init_video(void) {}
static uint8_t read_pad_raw(void) { return 0; }
#endif

static uint8_t current_slide = 0;
static uint8_t bgm_step = 0;
static uint8_t bgm_frame = 0;

static void sample_wait_delay(void)
{
    volatile uint16_t delay;
    for (delay = 0; delay < 6200u; delay++) {}
}

static uint16_t scale_vce_color(uint16_t color, uint8_t level)
{
    uint16_t r = color & 0x0007u;
    uint16_t g = (color >> 3) & 0x0007u;
    uint16_t b = (color >> 6) & 0x0007u;
    r = (uint16_t)((r * level) / 16u);
    g = (uint16_t)((g * level) / 16u);
    b = (uint16_t)((b * level) / 16u);
    return (uint16_t)(r | (g << 3) | (b << 6));
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
            pce_editor_vram_copy((uint16_t)(dest + word_offset), chunk->data, (uint16_t)chunk->size);
            word_offset = (uint16_t)(word_offset + ((chunk->size + 1u) / 2u));
        }
        return;
    }
    if (ref->data)
    {
        pce_editor_vram_copy(dest, ref->data, (uint16_t)ref->size);
    }
}

static void apply_bg_palette_level(const pce_editor_bg_asset_t *bg, uint8_t level)
{
    uint16_t i;
    uint16_t color_count;
    const uint8_t *palette;
    if (!bg || !bg->palette.size) return;
    palette = data_ref_ptr(&bg->palette);
    if (!palette) return;
    color_count = (uint16_t)(bg->palette.size / 2u);
    if (color_count > 16u) color_count = 16u;
    for (i = 0; i < color_count; i++)
    {
        const uint16_t raw = (uint16_t)(palette[(i * 2u)] | ((uint16_t)palette[(i * 2u) + 1u] << 8));
        vce_write_color((uint16_t)((bg->palette_bank * 16u) + i), scale_vce_color(raw, level));
    }
    for (; i < 16u; i++)
    {
        vce_write_color((uint16_t)((bg->palette_bank * 16u) + i), 0);
    }
}

static void psg_load_wave(uint8_t channel, uint8_t timbre)
{
    uint8_t i;
    PCE_PSG_SELECT = channel;
    PCE_PSG_CONTROL = 0;
    for (i = 0; i < 32u; i++)
    {
        uint8_t sample;
        if (timbre == 1u)
        {
            sample = (i < 8u) ? 31u : ((i < 16u) ? 20u : ((i < 24u) ? 8u : 0u));
        }
        else if (timbre == 2u)
        {
            sample = (i & 1u) ? 31u : 2u;
        }
        else
        {
            sample = (i < 16u) ? 31u : 0u;
        }
        PCE_PSG_WAVE = sample;
    }
}

static void psg_set_channel(uint8_t channel, uint16_t period, uint8_t volume)
{
    PCE_PSG_SELECT = channel;
    PCE_PSG_FREQ_LO = (uint8_t)(period & 0xffu);
    PCE_PSG_FREQ_HI = (uint8_t)((period >> 8) & 0x0fu);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static void psg_init_bgm(void)
{
    PCE_PSG_GLOBAL = 0xffu;
    psg_load_wave(0, 0);
    psg_load_wave(1, 1);
    psg_load_wave(2, 2);
    psg_set_channel(0, pce_editor_tone_period, 0);
    psg_set_channel(1, (uint16_t)(pce_editor_tone_period * 2u), 0);
    psg_set_channel(2, 96u, 0);
}

static uint8_t frames_per_bgm_step(const pce_editor_psg_asset_t *song)
{
    uint16_t bpm = song && song->bpm ? song->bpm : 150u;
    uint16_t frames = (uint16_t)(3600u / (bpm * 4u));
    if (frames < 2u) frames = 2u;
    if (frames > 24u) frames = 24u;
    return (uint8_t)frames;
}

static void bgm_tick(void)
{
    uint16_t i;
    const pce_editor_psg_asset_t *song;
    if (!pce_editor_psg_asset_count) return;
    song = &pce_editor_psg_assets[0];
    if (!song->pattern || !song->pattern_count) return;
    if (bgm_frame == 0u)
    {
        for (i = 0; i < song->pattern_count; i++)
        {
            const pce_editor_psg_step_t *step = &song->pattern[i];
            if (step->step == bgm_step)
            {
                psg_set_channel(step->channel, step->period, step->volume);
            }
        }
    }
    bgm_frame++;
    if (bgm_frame >= frames_per_bgm_step(song))
    {
        bgm_frame = 0;
        bgm_step++;
        if (bgm_step >= song->steps) bgm_step = 0;
    }
}

static void wait_frame_with_music(void)
{
    sample_wait_delay();
    bgm_tick();
}

static void wait_frames_with_music(uint8_t frames)
{
    while (frames--)
    {
        wait_frame_with_music();
    }
}

static void upload_bg_graphics(const pce_editor_bg_asset_t *bg)
{
    uint8_t row;
    uint16_t row_bytes;
    const uint8_t *map;
    if (!bg) return;
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
            pce_editor_vram_copy(
                (uint16_t)(bg->map_base + ((uint16_t)row * 32u)),
                map + ((uint16_t)row * row_bytes),
                row_bytes
            );
        }
    }
}

static void show_slide(uint8_t slide, uint8_t fade_from_current)
{
    int8_t level;
    const pce_editor_bg_asset_t *bg;
    if (!pce_editor_bg_asset_count) return;
    if (slide >= pce_editor_bg_asset_count) slide = 0;
    if (fade_from_current)
    {
        const pce_editor_bg_asset_t *old_bg = &pce_editor_bg_assets[current_slide];
        for (level = 16; level >= 0; level--)
        {
            apply_bg_palette_level(old_bg, (uint8_t)level);
            wait_frames_with_music(2);
        }
    }
    current_slide = slide;
    bg = &pce_editor_bg_assets[current_slide];
    apply_bg_palette_level(bg, 0);
    upload_bg_graphics(bg);
    for (level = 0; level <= 16; level++)
    {
        apply_bg_palette_level(bg, (uint8_t)level);
        wait_frames_with_music(2);
    }
}

int main(void)
{
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;

    pce_editor_init_video();
    psg_init_bgm();
    show_slide(0, 0);
    last_pad = read_pad_raw();

    while (1)
    {
        if (!pce_editor_bg_asset_count)
        {
            wait_frame_with_music();
            continue;
        }
        pad = read_pad_raw();
        pressed = (uint8_t)(pad & (uint8_t)~last_pad);
        if (pressed & (PAD_RIGHT | PAD_DOWN))
        {
            uint8_t next = (uint8_t)(current_slide + 1u);
            if (next >= pce_editor_bg_asset_count) next = 0;
            show_slide(next, 1);
        }
        else if (pressed & (PAD_LEFT | PAD_UP))
        {
            uint8_t prev = current_slide ? (uint8_t)(current_slide - 1u) : (uint8_t)(pce_editor_bg_asset_count - 1u);
            show_slide(prev, 1);
        }
        last_pad = pad;
        wait_frame_with_music();
    }
    return 0;
}
