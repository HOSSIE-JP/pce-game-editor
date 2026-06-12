#include <stdint.h>

#define PCE_CONFIG_IMPLEMENTATION
#include <pce.h>
#include <pce-cd.h>
PCE_CDB_USE_GRAPHICS_DRIVER(1);

#include "adpcm_diag_config.h"

#define PAD_I 0x01u
#define PAD_II 0x02u
#define PAD_SELECT 0x04u
#define PAD_RUN 0x08u

#define DIAG_DISPLAY_CONTROL (VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_HSYNC_OUTPUT | VDC_CONTROL_VSYNC_OUTPUT | VDC_CONTROL_ENABLE_BG)
#define DIAG_MEMORY_CONTROL (VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_64_32)

static pce_sector_t sector_from_ulong(unsigned long value)
{
    pce_sector_t sector = {0};
    sector.lo = (uint8_t)(value & 0xffu);
    sector.md = (uint8_t)((value >> 8) & 0xffu);
    sector.hi = (uint8_t)((value >> 16) & 0xffu);
    return sector;
}

static void set_status_color(uint16_t color)
{
    pce_vce_set_color(0u, color);
}

static uint8_t wait_adpcm_ready(void)
{
    uint16_t frames = 600u;
    while (frames)
    {
        if (!(pce_cdb_adpcm_status() & ADPCM_BUSY)) return 1u;
        pce_cdb_wait_vblank();
        frames--;
    }
    return 0u;
}

static void stop_adpcm(void)
{
    pce_cdb_adpcm_stop();
    (void)wait_adpcm_ready();
    set_status_color(VCE_COLOR(0, 0, 2));
}

static void show_error(void)
{
    set_status_color(VCE_COLOR(7, 7, 0));
}

static uint8_t read_adpcm_data(unsigned long sector_value)
{
    const pce_sector_t sector = sector_from_ulong(sector_value);
    pce_cdb_adpcm_stop();
    (void)wait_adpcm_ready();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_ready()) return 0u;
    if (pce_cdb_adpcm_read_from_cd(sector, (uint8_t)PCE_ADPCM_DIAG_SECTOR_COUNT, PCE_ADPCM_DIAG_ADDRESS)) return 0u;
    return wait_adpcm_ready();
}

static void play_buffered(unsigned long sector_value, uint16_t color)
{
    if (!read_adpcm_data(sector_value))
    {
        show_error();
        return;
    }
    if (pce_cdb_adpcm_play(PCE_ADPCM_DIAG_ADDRESS, PCE_ADPCM_DIAG_BYTE_LENGTH, PCE_ADPCM_DIAG_DIVIDER, PCE_CDB_ADPCM_ONE_SHOT))
    {
        show_error();
        return;
    }
    set_status_color(color);
}

static void play_stream(unsigned long sector_value)
{
    const pce_sector_t sector = sector_from_ulong(sector_value);
    const pce_sector_t length = sector_from_ulong(PCE_ADPCM_DIAG_SECTOR_COUNT);
    pce_cdb_adpcm_stop();
    (void)wait_adpcm_ready();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_ready())
    {
        show_error();
        return;
    }
    if (pce_cdb_adpcm_stream(sector, length, PCE_ADPCM_DIAG_DIVIDER))
    {
        show_error();
        return;
    }
    set_status_color(VCE_COLOR(0, 7, 7));
}

static void init_video(void)
{
    pce_cdb_irq_enable((uint8_t)(PCE_CDB_MASK_IRQ_EXTERNAL | PCE_CDB_MASK_VBLANK));
    (void)pce_cdb_vdc_set_resolution(PCE_CDB_VDC_CLOCK_7MHZ, 40u, 28u);
    pce_cdb_vdc_bg_set_size(PCE_CDB_VDC_BG_SIZE_64_32);
    pce_vdc_poke(VDC_REG_MEMORY, DIAG_MEMORY_CONTROL);
    pce_vdc_poke(VDC_REG_CONTROL, DIAG_DISPLAY_CONTROL);
    pce_cdb_vdc_bg_enable();
    set_status_color(VCE_COLOR(0, 0, 2));
}

int main(void)
{
    uint8_t previous = 0u;
    uint8_t auto_played = 0u;
    uint8_t auto_delay = 45u;
    init_video();

    for (;;)
    {
        const uint8_t pad = pce_joypad_read();
        const uint8_t pressed = (uint8_t)(pad & (uint8_t)~previous);
        if (pressed & PAD_I)
        {
            auto_played = 1u;
            play_buffered(PCE_ADPCM_DIAG_MSN_SECTOR, VCE_COLOR(0, 7, 0));
        }
        else if (pressed & PAD_II)
        {
            auto_played = 1u;
            play_buffered(PCE_ADPCM_DIAG_LSN_SECTOR, VCE_COLOR(7, 0, 0));
        }
        else if (pressed & PAD_RUN)
        {
            auto_played = 1u;
            play_stream(PCE_ADPCM_DIAG_MSN_SECTOR);
        }
        else if (pressed & PAD_SELECT)
        {
            auto_played = 1u;
            stop_adpcm();
        }
        else if (!auto_played)
        {
            if (auto_delay) auto_delay--;
            else
            {
                auto_played = 1u;
                play_buffered(PCE_ADPCM_DIAG_MSN_SECTOR, VCE_COLOR(0, 7, 0));
            }
        }
        previous = pad;
        pce_cdb_wait_vblank();
    }
}
