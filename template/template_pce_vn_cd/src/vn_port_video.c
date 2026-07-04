/* PHASE_A_SPLIT:BEGIN vn_port_video.c — VDC control (set_vdc_control /
   display enable / sprite layer / screen offset / restore_video_after_cdb_
   call), the guarded VRAM copy helpers (pce_editor_vram_copy(_tia) /
   vn_vdc_set_copy_word), VCE palette upload + fade helpers, font/blank-tile
   upload and BAT map clear utilities. Moved verbatim from pce_vn_runtime.c
   (Phase A module split). PHASE_A_SPLIT:END */
static void set_vdc_control(uint16_t control)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
#endif
#if defined(__PCE_CD__)
    vdc_control_current = control;
    *VN_CDB_VDC_CONTROL_SHADOW_LO = (uint8_t)(control & 0xffu);
    *VN_CDB_VDC_CONTROL_SHADOW_HI = (uint8_t)(control >> 8);
#endif
#if defined(__PCE__) || defined(__PCE_CD__)
    pce_vdc_poke(VDC_REG_CONTROL, control);
    vn_vdc_irq_unlock(irq);
#else
    (void)control;
#endif
}

static void VN_BANKED_CODE2 display_disable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    engine_service();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_BLANK_CONTROL);
#elif defined(__PCE__)
    pce_vdc_disable((uint8_t)(VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE));
#endif
}

static void VN_BANKED_CODE2 display_enable(void)
{
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    vn_wait_next_vblank();
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
#endif
}

static void VN_BANKED_CODE2 sprite_layer_disable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    engine_service();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_BG_ONLY_CONTROL);
#elif defined(__PCE__)
    set_vdc_control(VN_VDC_BG_ONLY_CONTROL);
#endif
}

static void VN_BANKED_CODE2 sprite_layer_enable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    engine_service();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#endif
}

static uint16_t scroll_value_from_offset(signed char offset, uint16_t modulo)
{
    if (!offset) return 0u;
    if (offset > 0) return (uint16_t)(modulo - (uint8_t)offset);
    return (uint16_t)(-offset);
}

static void VN_BANKED_CODE2 apply_screen_offset(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_vdc_poke(VDC_REG_BG_SCROLL_X, scroll_value_from_offset(screen_shake_x, VN_BG_SCROLL_WIDTH));
    pce_vdc_poke(VDC_REG_BG_SCROLL_Y, scroll_value_from_offset(screen_shake_y, VN_BG_SCROLL_HEIGHT));
    vn_vdc_irq_unlock(irq);
#endif
}

static void VN_BANKED_CODE2 set_screen_offset(signed char x, signed char y)
{
    screen_shake_x = x;
    screen_shake_y = y;
    apply_screen_offset();
    REQUEST_SPRITE_REFRESH_FULL();
}

static void VN_BANKED_CODE restore_video_after_cdb_call(uint8_t restore_display)
{
#if defined(__PCE_CD__)
    uint8_t irq;
    if (restore_display)
    {
        vn_wait_next_vblank();
        engine_service();
    }
    irq = vn_vdc_irq_lock();
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    VN_MAP_BANK130_FOR_CODE();
    apply_screen_offset();
    if (adpcm_stream_active) adpcm_stream_irq_open = 1u;
    set_vdc_control(restore_display ? VN_VDC_DISPLAY_CONTROL : VN_VDC_BLANK_CONTROL);
    if (adpcm_stream_active) pce_irq_enable(IRQ_VDC);
    else pce_irq_disable(IRQ_VDC);
    vn_vdc_irq_unlock(irq);
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

static void VN_BANKED_CODE vn_vdc_set_copy_word(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    /* Preserve CR low byte (display/BG/sprite/VBlank-status bits) and restore
       CR high byte: DRAM refresh on, VRAM increment = 1 word. */
    __asm__ volatile("st0 #$05\n\tst2 #$04" ::: "memory");
#endif
}

static void VN_RESIDENT_CODE pce_editor_vram_copy_tia(const uint8_t *source, uint16_t length)
{
#if defined(__PCE_CD__)
    if (!length) return;
    /* HuC6280 TIA has immediate operands, so patch this RAM-resident opcode just
       before running it. Destination $0002/$0003 alternates across the VDC data
       port while the source pointer increments. */
    __asm__ volatile(
        "lda %0\n\t"
        "sta 1f+1\n\t"
        "lda %0+1\n\t"
        "sta 1f+2\n\t"
        "lda %1\n\t"
        "sta 1f+5\n\t"
        "lda %1+1\n\t"
        "sta 1f+6\n"
        "1:\n\t"
        ".byte $e3, $00, $00, $02, $00, $00, $00"
        :
        : "r"(source), "r"(length)
        : "a", "p", "memory");
#else
    (void)source;
    (void)length;
#endif
}

static void VN_RESIDENT_CODE pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    const uint16_t even_length = (uint16_t)(length & 0xfffeu);
    vn_vdc_set_copy_word();
    *IO_VDC_INDEX = VDC_REG_VRAM_WRITE_ADDR;
    *IO_VDC_DATA = dest;
    *IO_VDC_INDEX = VDC_REG_VRAM_DATA;
    pce_editor_vram_copy_tia(source, even_length);
    if (length & 1u)
    {
        *IO_VDC_DATA_LO = source[even_length];
        *IO_VDC_DATA_HI = 0u;
    }
    vn_vdc_irq_unlock(irq);
#elif defined(__PCE__)
    uint8_t irq = vn_vdc_irq_lock();
    vn_vdc_set_copy_word();
    pce_vdc_copy_to_vram(dest, source, length);
    vn_vdc_irq_unlock(irq);
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

#define SNAPSHOT_DATA_REF(dest, source) do { \
    (dest).data = (source).data; \
    __asm__ volatile("" ::: "memory"); \
    (dest).size = (source).size; \
    __asm__ volatile("" ::: "memory"); \
    (dest).chunks = (source).chunks; \
    __asm__ volatile("" ::: "memory"); \
    (dest).chunk_count = (source).chunk_count; \
    __asm__ volatile("" ::: "memory"); \
    (dest).cd = (source).cd; \
    __asm__ volatile("" ::: "memory"); \
} while (0)

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

static uint16_t VN_VISUAL_CACHE_CODE mix_vce_color(uint16_t from, uint16_t to, uint16_t step, uint8_t frames)
{
    uint16_t b;
    uint16_t r;
    uint16_t g;
    if (!frames) return (uint16_t)(to & 0x01ffu);
    b = (uint16_t)((((from & 0x0007u) * (frames - step)) + ((to & 0x0007u) * step)) / frames);
    r = (uint16_t)((((((from >> 3) & 0x0007u) * (frames - step)) + (((to >> 3) & 0x0007u) * step)) / frames) << 3);
    g = (uint16_t)((((((from >> 6) & 0x0007u) * (frames - step)) + (((to >> 6) & 0x0007u) * step)) / frames) << 6);
    return (uint16_t)(g | r | b);
}

static void fade_palette(const pce_editor_data_ref_t *palette, uint16_t base_index, uint8_t frames, uint8_t fade_in)
{
    uint16_t step;
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
        const uint8_t scale = fade_in ? (uint8_t)step : (uint8_t)(frames - step);
        for (i = 0u; i < color_count; i++)
        {
            const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
            vce_write_color((uint16_t)(base_index + i), scale_vce_color(raw, scale, frames));
        }
        delay_frame();
    }
}

static uint16_t ui_text_color_word(uint16_t color)
{
    return (color == PCE_VN_MESSAGE_COLOR_NONE) ? 0x01ffu : (uint16_t)(color & 0x01ffu);
}

static void write_ui_text_palette(uint16_t color)
{
    uint8_t i;
    const uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    for (i = 1u; i < 16u; i++)
    {
        vce_write_color((uint16_t)(base + i), (uint16_t)(color & 0x01ffu));
    }
}

static void VN_VISUAL_CACHE_CODE delay_frame_visual_cache_impl(void)
{
    vn_wait_next_vblank();
    engine_service();
}

static void VN_VISUAL_CACHE_CODE fade_current_screen_to_color_impl(uint16_t target, uint8_t frames)
{
    uint16_t step;
    uint8_t i;
    uint16_t color_count = 0u;
    uint16_t bg_base = 0u;
    const uint8_t *data = (const uint8_t *)0;
    const uint16_t ui_start = ui_text_color_word(ui_text_color);
    target = (uint16_t)(target & 0x01ffu);
    if (current_bg_index >= 0 && current_bg_palette_size)
    {
        data = current_bg_palette;
        color_count = (uint16_t)(current_bg_palette_size / 2u);
        if (color_count > 16u) color_count = 16u;
        bg_base = current_bg_palette_base;
    }
    for (step = 0u; step <= frames; step++)
    {
        if (data)
        {
            for (i = 0u; i < color_count; i++)
            {
                const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
                vce_write_color((uint16_t)(bg_base + i), mix_vce_color(raw, target, step, frames));
            }
        }
        write_ui_text_palette(mix_vce_color(ui_start, target, step, frames));
        vce_write_color(0u, mix_vce_color(0x0000u, target, step, frames));
        if (frames)
        {
            delay_frame_visual_cache_impl();
        }
    }
}

static void VN_VISUAL_CACHE_CODE restore_current_screen_palette_impl(void)
{
    if (current_bg_index >= 0 && current_bg_palette_size)
    {
        const pce_editor_data_ref_t ref = { current_bg_palette, current_bg_palette_size, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 };
        upload_palette(&ref, current_bg_palette_base, 0u);
    }
    write_ui_text_palette(ui_text_color_word(ui_text_color));
}

static void VN_VISUAL_CACHE_CODE flash_screen_color_impl(uint16_t color, uint8_t frames)
{
    uint8_t i;
    fade_current_screen_to_color_impl(color, 0u);
    if (!frames) frames = 1u;
    for (i = 0u; i < frames; i++)
    {
        delay_frame_visual_cache_impl();
    }
    restore_current_screen_palette_impl();
}

static void VN_BANKED_CODE2 fade_current_screen_to_color(uint16_t target, uint8_t frames)
{
    if (!vn_visual_cache_code_loaded) return;
    vn_visual_cache_arg_dest = target;
    vn_visual_cache_arg_x = frames;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_FADE_SCREEN);
}

static void VN_BANKED_CODE2 restore_current_screen_palette(void)
{
    if (!vn_visual_cache_code_loaded) return;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_RESTORE_SCREEN_PALETTE);
}

static void VN_BANKED_CODE2 flash_screen_color(uint16_t color, uint8_t frames)
{
    if (!vn_visual_cache_code_loaded) return;
    vn_visual_cache_arg_dest = color;
    vn_visual_cache_arg_x = frames;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_FLASH_SCREEN);
}

static void upload_ui_palette(void)
{
    uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    vce_write_color((uint16_t)(base + 0u), 0x0000u);
    write_ui_text_palette(0x01ffu);
}

/* Tint the UI text foreground (palette 15, slots 1-15) to a message's color, or
   restore the default white when the message has no override. Affects the body
   text and speaker label drawn with this palette. */
static void apply_message_text_color(uint16_t color)
{
    ui_text_color = color;
    write_ui_text_palette(ui_text_color_word(color));
}

static void upload_font_tiles(void)
{
#if defined(__PCE_CD__)
    /* 12x12 glyph masks (12 words/glyph) are streamed from the CD font.bin into the
       VRAM mask region at boot; the compositor reads each glyph's mask back from
       VRAM when revealing message text. Only the small pce_vn_font_data ref
       (sector/size) lives in ram_bank132. */
    pce_vn_cd_data_ref_t font;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest = (uint16_t)PCE_VN_FONT_MASK_VRAM_WORD;
    map_vn_data();
    font = pce_vn_font_data;
    map_resident_data();
    if (!font.byte_size || !font.sector_count) return;
    prepare_cd_data_access();
    sector.lo = font.sector.lo;
    sector.md = font.sector.md;
    sector.hi = font.sector.hi;
    remaining = font.byte_size;
    /* cd_transfer_scratch is in bank132; ensure MPR6 points at it for the loop. */
    map_vn_data();
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        vram_copy_sliced_from_vn_data(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
#elif defined(__PCE__)
    pce_editor_vram_copy((uint16_t)PCE_VN_FONT_MASK_VRAM_WORD, pce_vn_font_tiles, (uint16_t)(pce_vn_font_glyph_count * (VN_GLYPH_MASK_WORDS * 2u)));
#endif
}

/* Stream the sprite-format glyph font (used by spritetext overlays) into VRAM
   once at boot. Each glyph is one 16x16 sprite pattern (128 bytes); the pattern
   number for glyph g is PCE_VN_FONT_SPRITE_PATTERN_BASE + g*2.
   In .ram_bank130 to keep the resident bank128 within budget (mirrors the
   banked CD->VRAM helpers); called once from init_video at boot. */
static void VN_BANKED_CODE2 upload_font_sprite_patterns(void)
{
#if !PCE_VN_HAS_SPRITETEXT
    return;
#else
#if defined(__PCE_CD__)
    pce_vn_cd_data_ref_t font;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest = (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE * 32u);
    map_vn_data();
    font = pce_vn_font_sprite_data;
    map_resident_data();
    if (!font.byte_size || !font.sector_count) return;
    prepare_cd_data_access();
    sector.lo = font.sector.lo;
    sector.md = font.sector.md;
    sector.hi = font.sector.hi;
    remaining = font.byte_size;
    map_vn_data();
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        vram_copy_sliced_from_vn_data(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
#elif defined(__PCE__)
    if (pce_vn_font_sprite_glyph_count)
    {
        pce_editor_vram_copy((uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE * 32u), pce_vn_font_sprite_tiles, (uint16_t)(pce_vn_font_sprite_glyph_count * 128u));
    }
#endif
#endif
}

static void write_map_words(uint16_t map_addr, const uint16_t *words, uint16_t count)
{
    pce_editor_vram_copy(map_addr, (const uint8_t *)words, (uint16_t)(count * 2u));
}

static uint16_t ui_tile(uint16_t tile)
{
    return (uint16_t)((VN_UI_PALETTE << 12) | tile);
}

/* Zero the dedicated blank tile once at boot; the BG/UI blank fill points at it.
   enc must be in section .bss (see the msg_* / clear_line scratch note). */
static uint8_t blank_tile_enc[32] __attribute__((section(".bss")));
static void upload_blank_tile(void)
{
    uint8_t i;
    for (i = 0u; i < 32u; i++) blank_tile_enc[i] = 0u;
    pce_editor_vram_copy((uint16_t)(PCE_VN_BLANK_TILE * 16u), blank_tile_enc, 32u);
}

/* Screen/rect clear line buffers. Like the compositor scratch, these MUST be
   file-scope statics in section .bss: without the section attribute they were
   placed in a region that read back as garbage in this banked build, so
   clear_screen_map / clear_map_rect_at_dest wrote garbage tile refs into the
   margins (everything outside the BG and message window). */
static uint16_t clear_line[VN_MAP_WIDTH] __attribute__((section(".bss")));
static void clear_screen_map(void)
{
    uint8_t row;
    uint8_t col;
    for (col = 0; col < VN_MAP_WIDTH; col++)
    {
        clear_line[col] = ui_tile(VN_UI_BLANK_TILE);
    }
    for (row = 0; row < VN_MAP_HEIGHT; row++)
    {
        write_map_words((uint16_t)(row * VN_MAP_WIDTH), clear_line, VN_MAP_WIDTH);
        engine_service();
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
        clear_line[col] = ui_tile(VN_UI_BLANK_TILE);
    }
    for (row = 0; row < copy_height; row++)
    {
        write_map_words((uint16_t)(map_dest + ((uint16_t)row * VN_MAP_WIDTH)), clear_line, copy_width);
        engine_service();
    }
}

