/* PHASE_A_SPLIT:BEGIN vn_msg_core.c — message/typewriter: the 12x12 glyph
   compositor and its RAM mask cache, glyph stream decode, message window BAT
   updates, wait indicator, start/finish/tick of the active message and choice
   option drawing. Moved verbatim from pce_vn_runtime.c (Phase A module
   split). PHASE_A_SPLIT:END */
/* PHASE_A_SPLIT:BEGIN forward declarations added by the Phase A module split.
   The scene-pack reader wrappers live in vn_port_scene.c (included later). */
static uint8_t VN_BANKED_CODE scene_pack_read_message(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message);
static uint8_t VN_BANKED_CODE scene_pack_read_choice(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice);
static uint8_t VN_BANKED_CODE scene_pack_read_choice_option(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option);
/* PHASE_A_SPLIT:END */
/* ---- 12x12 glyph compositor -------------------------------------------------
   Message text uses a 12px horizontal pitch that does not align to the 8x8 tile
   grid, so glyphs are composited at runtime. A strip tile may be shared by two
   adjacent glyphs (the previous glyph's right edge + the current glyph's left
   edge). Instead of reading the tile back from VRAM to accumulate, the compositor
   keeps the previous glyph's 12x12 mask in RAM and re-draws BOTH glyphs into the
   shared tile, so each tile is rebuilt from scratch and written once. This never
   reads VRAM back (the standard WASM core mishandles VRAM read-back) and never
   touches VDC memory/cycle control. Only the current glyph's mask is read from
   VRAM (1 read/char). */
static uint16_t composer_prev_mask[VN_GLYPH_MASK_ROWS] __attribute__((section(".bss"))); /* previous glyph's 12 mask rows */
static uint8_t composer_prev_col __attribute__((section(".bss")));   /* column of the previous visible glyph */
static uint8_t composer_prev_valid __attribute__((section(".bss"))); /* 1 if composer_prev_mask holds a left neighbor */
static uint8_t composer_row __attribute__((section(".bss")));        /* text row the previous glyph belongs to */
#if defined(__PCE_CD__)
static uint16_t message_glyph_cache_ids[VN_MESSAGE_GLYPH_CACHE_COUNT] __attribute__((section(".bss")));
/* ".ram_bank132_tail": NOLOAD overlay-window reuse (see cd_transfer_scratch). This
   write-before-read cache shares bank132's never-read overlay LMA tail so the
   resident metadata region stays free for growth. */
static uint16_t message_glyph_cache_masks[VN_MESSAGE_GLYPH_CACHE_COUNT][VN_GLYPH_MASK_ROWS] __attribute__((section(".ram_bank132_tail")));
static uint8_t message_glyph_cache_count __attribute__((section(".bss")));
static uint8_t message_glyph_cache_valid __attribute__((section(".bss")));
#endif

static void VN_BANKED_CODE2 restore_text_vram_after_full_screen_bg(void)
{
#if !PCE_VN_HAS_FULL_SCREEN_BG
    return;
#else
    if (!full_screen_bg_text_vram_dirty) return;
    upload_blank_tile();
#if defined(__PCE_CD__)
    message_glyph_cache_valid = 0u;
    spritetext_glyph_cache_count = 0u;
#endif
    full_screen_bg_text_vram_dirty = 0u;
#endif
}

/* Build a PCE 4bpp 8x8 tile (16 words) from an 8-scanline 1bpp mask. A lit pixel
   is color index 15 (all four bitplanes set), so every plane byte equals the row
   mask; bit 0x80 is the leftmost pixel. */
static void VN_OVERLAY_CODE encode_msg_tile(const uint8_t *mask8, uint8_t *out32)
{
    uint8_t sy;
    for (sy = 0u; sy < 8u; sy++)
    {
        const uint8_t m = mask8[sy];
        out32[(sy * 2u)] = m;            /* plane 0 */
        out32[(sy * 2u) + 1u] = m;       /* plane 1 */
        out32[16u + (sy * 2u)] = m;      /* plane 2 */
        out32[16u + (sy * 2u) + 1u] = m; /* plane 3 */
    }
}

/* OR a 12x12 glyph's pixels for one 8x8 tile (column tile_x0..+7, sub-band 0/1)
   into mask8. gpx0 is the glyph's left pixel; pixels outside the tile are ignored. */
static void VN_OVERLAY_CODE add_glyph_tile(const uint16_t *gmask, uint16_t gpx0,
    uint8_t tile_x0, uint8_t sub, uint8_t *mask8)
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

/* Compositor scratch buffers. These are file-scope statics, NOT function-local
   arrays: on llvm-mos large stack arrays inside the banked (VN_BANKED_CODE2)
   message code were read back as zero, corrupting the BAT/strip writes. The VN is
   single-threaded and these functions never re-enter, so sharing statics is safe.
   (clear_screen_map uses the same static-buffer pattern.) */
static uint16_t msg_bat_row[VN_MSG_TILE_COLS] __attribute__((section(".bss")));
static uint8_t msg_enc[32] __attribute__((section(".bss")));
static uint8_t msg_mask8[8] __attribute__((section(".bss")));
static uint16_t msg_gmask[VN_GLYPH_MASK_ROWS] __attribute__((section(".bss")));

static void VN_BANKED_CODE2 map_message_window_cells(uint8_t blank)
{
    uint8_t tr;
    uint8_t tc;
    for (tr = 0u; tr < VN_MSG_TILE_ROWS; tr++)
    {
        uint8_t *row = (uint8_t *)(void *)msg_bat_row;
        uint16_t tile;
#if defined(__PCE_CD__)
        uint8_t irq = vn_vdc_irq_lock();
#endif
        const uint16_t row_tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
            + ((uint16_t)tr * VN_MSG_TILE_COLS));
        tile = blank ? PCE_VN_BLANK_TILE : row_tile;
        for (tc = VN_MSG_TILE_COLS; tc; tc--)
        {
            uint16_t word = ui_tile(tile);
            row[0] = (uint8_t)(word & 0xffu);
            row[1] = (uint8_t)(word >> 8);
            row += 2u;
            if (!blank) tile++;
        }
        write_map_words((uint16_t)(((VN_TEXT_Y + tr) * VN_MAP_WIDTH) + VN_TEXT_X),
            msg_bat_row, VN_MSG_TILE_COLS);
#if defined(__PCE_CD__)
        vn_vdc_irq_unlock(irq);
#endif
        engine_service();
    }
}

static void VN_BANKED_CODE2 clear_window_tile_pixels(void)
{
    uint8_t tr;
    uint8_t tc;
    for (tc = 0u; tc < 32u; tc++) msg_enc[tc] = 0u;
    for (tr = 0u; tr < VN_MSG_TILE_COUNT; tr++)
    {
        pce_editor_vram_copy((uint16_t)((VN_MSG_STRIP_TILE_BASE + tr) * 16u), msg_enc, 32u);
        if ((tr & 0x0fu) == 0x0fu) engine_service();
    }
    composer_prev_valid = 0u;
    composer_row = 0xffu;
}

/* Overlay: writes 2 BAT cells for the wait-cursor strip via the resident VDC blit
   helper (write_map_words -> pce_editor_vram_copy, bank128). VDC を触るので
   dispatcher は locked。 */
static void VN_OVERLAY_CODE map_message_wait_indicator_cell_impl(uint8_t blank)
{
    uint8_t sub;
    const uint8_t tc0 = (uint8_t)(((uint16_t)VN_WAIT_CURSOR_COL * VN_GLYPH_W) >> 3);
    for (sub = 0u; sub < 2u; sub++)
    {
        const uint16_t strip_tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
            + ((uint16_t)(((VN_WAIT_CURSOR_ROW * 2u) + sub) * VN_MSG_TILE_COLS)) + tc0);
        msg_bat_row[0] = ui_tile(blank ? PCE_VN_BLANK_TILE : strip_tile);
        msg_bat_row[1] = ui_tile(blank ? PCE_VN_BLANK_TILE : (uint16_t)(strip_tile + 1u));
        write_map_words((uint16_t)(((VN_TEXT_Y + (VN_WAIT_CURSOR_ROW * 2u) + sub) * VN_MAP_WIDTH) + VN_TEXT_X + tc0),
            msg_bat_row, 2u);
    }
}

static void VN_BANKED_CODE map_message_wait_indicator_cell(uint8_t blank)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch_locked(VN_OVERLAY_OP_MAP_WAIT_CELL, 0u, 0u, blank);
#else
    map_message_wait_indicator_cell_impl(blank);
#endif
}

/* Draw a 12x12 glyph at logical column `col` of text `row`. The up-to-two affected
   tile columns (x two tile rows) are each rebuilt from the current glyph plus the
   previous glyph (which may share the left tile), then written once — no VRAM
   read-back. glyph 0 / newline / end add no pixels and break the neighbor chain. */
/* Scene pack v2 stores one little-endian 16-bit Shift-JIS/control word per
   entry. The numeric word keeps the Shift-JIS lead byte in bits 15..8. */
static uint16_t VN_BANKED_CODE vn_glyph_decode(const uint8_t *glyphs, uint16_t pos)
{
    return (uint16_t)((uint16_t)glyphs[pos] | ((uint16_t)glyphs[pos + 1u] << 8));
}

static uint16_t VN_BANKED_CODE vn_glyph_stride(const uint8_t *glyphs, uint16_t pos)
{
    (void)glyphs;
    (void)pos;
    return 2u;
}

#if defined(__PCE_CD__)
/* Overlay-internal: only the overlay glyph compositor (cached_message_glyph_mask /
   preload_message_glyph_masks) looks up the cache, and it reads only resident .bss,
   so it lives in the overlay with them instead of costing a bank129 slot. */
static uint8_t VN_OVERLAY_CODE message_glyph_cache_find(uint16_t glyph)
{
    uint8_t i;
    if (!message_glyph_cache_valid) return VN_MESSAGE_GLYPH_CACHE_COUNT;
    for (i = 0u; i < message_glyph_cache_count; i++)
    {
        if (message_glyph_cache_ids[i] == glyph) return i;
    }
    return VN_MESSAGE_GLYPH_CACHE_COUNT;
}

static const uint16_t *VN_OVERLAY_CODE cached_message_glyph_mask(uint16_t glyph)
{
    const uint8_t index = message_glyph_cache_find(glyph);
    if (index >= VN_MESSAGE_GLYPH_CACHE_COUNT) return (const uint16_t *)0;
    map_vn_data();
    return message_glyph_cache_masks[index];
}

static void VN_OVERLAY_CODE preload_message_glyph_masks(const pce_vn_message_t *message)
{
    uint16_t pos = 0u;
    uint8_t i;
    map_vn_data();
    message_glyph_cache_count = 0u;
    message_glyph_cache_valid = 1u;
    if (!message || !message->glyphs) return;
    for (i = 0u; i < message->glyph_count; i++)
    {
        const uint16_t glyph = vn_glyph_decode(message->glyphs, pos);
        pos = (uint16_t)(pos + vn_glyph_stride(message->glyphs, pos));
        if (glyph == PCE_VN_GLYPH_END) break;
        if (glyph == PCE_VN_GLYPH_NEWLINE || glyph == 0u) continue;
        if (message_glyph_cache_find(glyph) < VN_MESSAGE_GLYPH_CACHE_COUNT) continue;
        if (message_glyph_cache_count >= VN_MESSAGE_GLYPH_CACHE_COUNT) continue;
        message_glyph_cache_ids[message_glyph_cache_count] = glyph;
        if (vn_system_card_font12_mask(glyph, message_glyph_cache_masks[message_glyph_cache_count]))
            message_glyph_cache_count++;
    }
}
#else
static const uint16_t *VN_OVERLAY_CODE cached_message_glyph_mask(uint16_t glyph)
{
    (void)glyph;
    return (const uint16_t *)0;
}

static void VN_OVERLAY_CODE preload_message_glyph_masks(const pce_vn_message_t *message)
{
    (void)message;
}
#endif

static void VN_OVERLAY_CODE draw_message_glyph_at(uint16_t glyph, uint8_t col, uint8_t row)
{
    const uint16_t px0 = (uint16_t)col * VN_GLYPH_W;
    const uint8_t tc0 = (uint8_t)(px0 >> 3);
    const uint8_t tc1 = (uint8_t)((px0 + VN_GLYPH_W - 1u) >> 3);
    const uint16_t prev_px0 = (uint16_t)composer_prev_col * VN_GLYPH_W;
    const uint16_t *gmask;
    uint8_t use_prev;
    uint8_t tc;
    uint8_t k;
    map_vn_data();
    if (glyph == 0u || glyph == PCE_VN_GLYPH_NEWLINE || glyph == PCE_VN_GLYPH_END)
    {
        composer_prev_valid = 0u; /* a blank/newline breaks the shared-tile chain */
        return;
    }
    if (row != composer_row) composer_prev_valid = 0u; /* new row: no left neighbor */
    use_prev = composer_prev_valid;
    gmask = cached_message_glyph_mask(glyph);
    if (!gmask)
    {
        if (!vn_system_card_font12_mask(glyph, msg_gmask))
        {
            composer_prev_valid = 0u;
            return;
        }
        gmask = msg_gmask;
    }
    for (tc = tc0; tc <= tc1 && tc < VN_MSG_TILE_COLS; tc++)
    {
        const uint8_t tile_x0 = (uint8_t)(tc * 8u);
        uint8_t sub;
        for (sub = 0u; sub < 2u; sub++)
        {
            const uint16_t tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
                + ((uint16_t)((row * 2u) + sub) * VN_MSG_TILE_COLS) + tc);
            for (k = 0u; k < 8u; k++) msg_mask8[k] = 0u;
            add_glyph_tile(gmask, px0, tile_x0, sub, msg_mask8);
            if (use_prev) add_glyph_tile(composer_prev_mask, prev_px0, tile_x0, sub, msg_mask8);
            encode_msg_tile(msg_mask8, msg_enc);
            pce_editor_vram_copy((uint16_t)(tile * 16u), msg_enc, 32u);
        }
    }
    for (k = 0u; k < VN_GLYPH_MASK_ROWS; k++) composer_prev_mask[k] = gmask[k];
    composer_prev_col = col;
    composer_prev_valid = 1u;
    composer_row = row;
}

#define VN_MESSAGE_ENTRY_COMPLETE 0u
#define VN_MESSAGE_ENTRY_NEWLINE 1u
#define VN_MESSAGE_ENTRY_DRAWABLE 2u
#define VN_MESSAGE_ROW_COL_LIMIT(row) ((row) == VN_WAIT_CURSOR_ROW ? VN_WAIT_CURSOR_COL : VN_TEXT_COLS)

static uint8_t VN_OVERLAY_CODE draw_message_next_entry(const pce_vn_message_t *message)
{
    uint16_t glyph;
    map_vn_data();
    if (!message || !message->glyphs) return VN_MESSAGE_ENTRY_COMPLETE;
    if (message_glyph_pos >= message->glyph_count) return VN_MESSAGE_ENTRY_COMPLETE;
    glyph = vn_glyph_decode(message->glyphs, message_glyph_byte);
    message_glyph_byte = (uint16_t)(message_glyph_byte + vn_glyph_stride(message->glyphs, message_glyph_byte));
    message_glyph_pos++;
    if (glyph == PCE_VN_GLYPH_END) return VN_MESSAGE_ENTRY_COMPLETE;
    if (glyph == PCE_VN_GLYPH_NEWLINE)
    {
        message_col = 0u;
        message_row++;
        if (message_row >= VN_TEXT_ROWS) return VN_MESSAGE_ENTRY_COMPLETE;
        return VN_MESSAGE_ENTRY_NEWLINE;
    }
    draw_message_glyph_at(glyph, message_col, message_row);
    message_col++;
    if (message_col >= VN_MESSAGE_ROW_COL_LIMIT(message_row))
    {
        message_col = 0u;
        message_row++;
        if (message_row >= VN_TEXT_ROWS) return VN_MESSAGE_ENTRY_COMPLETE;
    }
    return VN_MESSAGE_ENTRY_DRAWABLE;
}

static uint8_t VN_OVERLAY_CODE draw_message_prefix_glyphs(const pce_vn_message_t *message)
{
    uint8_t instant_glyph_count;
    uint8_t i;
    if (!message || !message->glyphs) return 1u;
    instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT(message->mouth_slot);
    for (i = 0u; i < instant_glyph_count; i++)
    {
        if (draw_message_next_entry(message) == VN_MESSAGE_ENTRY_COMPLETE) return 1u;
    }
    return message_glyph_pos >= message->glyph_count ? 1u : 0u;
}

static uint8_t VN_OVERLAY_CODE draw_message_next_glyph(const pce_vn_message_t *message)
{
    uint8_t status;
    /* Reveal exactly one drawable glyph per call. Newlines are not spoken, so they
       are processed inline (advance the row) WITHOUT consuming a typewriter tick;
       otherwise every line break would push the remaining text one reveal-interval
       behind the ADPCM voice and the drift would accumulate down the message. */
    for (;;)
    {
        status = draw_message_next_entry(message);
        if (status == VN_MESSAGE_ENTRY_COMPLETE) return 1u;
        if (status == VN_MESSAGE_ENTRY_DRAWABLE) return message_glyph_pos >= message->glyph_count ? 1u : 0u;
    }
}

/* The glyph compositor (draw_message_glyph_at, bank133 overlay) does a VDC mask read
   plus a composited-tile VDC write per glyph -- the same non-reentrant VDC sequence as the
   sprite SATB rewrite. It runs while a voiced ADPCM plays (external IRQ enabled), so an
   IRQ landing mid-write clobbers the MAWR and sprays glyph tile data outside the message
   window (UI-frame / BG noise at message-draw timing). Mask IRQs around the whole
   bank133 swap + message draw + bank130 restore sequence: an IRQ must never observe
   slot4 while bank133 is mapped. These wrappers are resident (bank128); no CD read
   happens inside, so deferring CD/ADPCM IRQs by that span is safe. */
static uint8_t VN_RESIDENT_CODE draw_message_next_glyph_locked(const pce_vn_message_t *message)
{
#if defined(__PCE_CD__)
    return vn_overlay_dispatch_locked(VN_OVERLAY_OP_NEXT_GLYPH, (uint16_t)(uintptr_t)message, 0u, 0u);
#else
    uint8_t complete;
    uint8_t irq = vn_vdc_irq_lock();
    complete = draw_message_next_glyph(message);
    vn_vdc_irq_unlock(irq);
    return complete;
#endif
}

static uint8_t VN_RESIDENT_CODE draw_message_prefix_glyphs_locked(const pce_vn_message_t *message)
{
#if defined(__PCE_CD__)
    return vn_overlay_dispatch_locked(VN_OVERLAY_OP_PREFIX_GLYPHS, (uint16_t)(uintptr_t)message, 0u, 0u);
#else
    uint8_t complete;
    uint8_t irq = vn_vdc_irq_lock();
    complete = draw_message_prefix_glyphs(message);
    vn_vdc_irq_unlock(irq);
    return complete;
#endif
}

static void VN_RESIDENT_CODE call_overlay_preload_message_glyph_masks(const pce_vn_message_t *message)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch_locked(VN_OVERLAY_OP_PRELOAD_MASKS, (uint16_t)(uintptr_t)message, 0u, 0u);
#else
    preload_message_glyph_masks(message);
#endif
}

static void VN_RESIDENT_CODE call_overlay_draw_message_glyph_at(uint16_t glyph, uint8_t col, uint8_t row)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch_locked(VN_OVERLAY_OP_DRAW_GLYPH, glyph, col, row);
#else
    draw_message_glyph_at(glyph, col, row);
#endif
}

static void VN_BANKED_CODE show_message_wait_indicator(void)
{
    message_wait_indicator_state = 1u;
    message_frame_timer = 0u;
    map_message_wait_indicator_cell(0u);
    call_overlay_draw_message_glyph_at(PCE_VN_MESSAGE_WAIT_GLYPH, VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW);
}

static void VN_BANKED_CODE hide_message_wait_indicator(void)
{
    if (message_wait_indicator_state)
    {
        map_message_wait_indicator_cell(1u);
        message_frame_timer = 0u;
    }
    message_wait_indicator_state = 0u;
}

static void VN_BANKED_CODE refresh_message_wait_indicator(void)
{
    if (active_message_index < 0
        || !message_complete
        || active_message_state.advance_mode != PCE_VN_ADVANCE_BUTTON)
    {
        hide_message_wait_indicator();
        return;
    }
    if (!message_wait_indicator_state) show_message_wait_indicator();
}

static void VN_BANKED_CODE tick_message_wait_indicator(void)
{
    if (active_message_index < 0
        || !message_complete
        || active_message_state.advance_mode != PCE_VN_ADVANCE_BUTTON)
    {
        hide_message_wait_indicator();
        return;
    }
    if (!message_wait_indicator_state)
    {
        show_message_wait_indicator();
        return;
    }
    message_frame_timer++;
    if (message_frame_timer < VN_WAIT_CURSOR_BLINK_FRAMES) return;
    message_frame_timer = 0u;
    if (message_wait_indicator_state == 2u)
    {
        show_message_wait_indicator();
    }
    else
    {
        message_wait_indicator_state = 2u;
        map_message_wait_indicator_cell(1u);
    }
}

static uint8_t VN_BANKED_CODE2 begin_message_window_vram_update(void)
{
#if defined(__PCE_CD__)
    if (pending_display_enable)
    {
        map_message_window_cells(0u);
        return 0u;
    }
    vn_wait_next_vblank();
    engine_service();
    map_message_window_cells(1u);
    return 1u;
#elif defined(__PCE__)
    map_message_window_cells(0u);
    return 0u;
#else
    return 0u;
#endif
}

static void VN_BANKED_CODE2 end_message_window_vram_update(uint8_t restore_display)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    if (!restore_display) return;
    vn_wait_next_vblank();
    engine_service();
    map_message_window_cells(0u);
    delay_frame();
#else
    (void)restore_display;
#endif
}

static void VN_BANKED_CODE2 draw_message_remaining_with_psg_service(const pce_vn_message_t *message)
{
    uint8_t glyph_service_count = 0u;
    VN_MAP_BANK130_FOR_CODE();
    while (!message_complete)
    {
        message_complete = draw_message_next_glyph_locked(message);
        glyph_service_count++;
        if ((glyph_service_count & 3u) == 0u) engine_service();
    }
    if (glyph_service_count) engine_service();
}

static void start_message(uint8_t message_index)
{
    pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
    uint8_t restore_window_display = 0u;
    uint8_t mouth_slot = 0u;
    uint8_t instant_glyph_count = 0u;
    VN_MAP_BANK130_FOR_CODE();
    if (scene_pack_read_message(&active_scene_pack, message_index, message))
    {
        active_message_state = *message;
        message = &active_message_state;
        mouth_slot = VN_MESSAGE_MOUTH_SLOT(message->mouth_slot);
        instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT(message->mouth_slot);
        active_message_index = message_index;
        active_choice_index = -1;
        wait_frames_remaining = 0u;
        message_glyph_pos = 0u;
        message_glyph_byte = 0u;
        message_frame_timer = 0u;
        message_col = 0u;
        message_row = 0u;
        message_complete = 0u;
        message_auto_wait = message->auto_wait_frames;
        message_wait_indicator_state = 0u;
        apply_message_text_color(message->text_color);
        if (message->mouth_animation_index >= 0 && mouth_slot < VN_SPRITE_SLOT_COUNT)
        {
            sprite_slots[mouth_slot].animation_index = message->mouth_animation_index;
            sprite_slots[mouth_slot].frame = 0u;
            sprite_slots[mouth_slot].timer = 0u;
            cache_sprite_animation(mouth_slot);
            REQUEST_SPRITE_REFRESH_FULL();
        }
        message_text_speed = message->text_speed_frames;
        restore_window_display = begin_message_window_vram_update();
        clear_window_tile_pixels();
        call_overlay_preload_message_glyph_masks(message);
        engine_service();
        (void)play_adpcm_message_voice(message->voice_index);
        if (instant_glyph_count)
        {
            VN_MAP_BANK130_FOR_CODE();
            message_complete = draw_message_prefix_glyphs_locked(message);
            engine_service();
        }
        VN_MAP_BANK130_FOR_CODE();
        if (!message_complete && !message_text_speed)
        {
            draw_message_remaining_with_psg_service(message);
        }
        else if (!message_complete)
        {
            VN_MAP_BANK130_FOR_CODE();
            message_complete = draw_message_next_glyph_locked(message);
            engine_service();
        }
        end_message_window_vram_update(restore_window_display);
        refresh_message_wait_indicator();
        if (!restore_window_display && !pending_display_enable)
        {
            delay_frame();
        }
    }
}

static void finish_active_message(void)
{
    if (active_message_index < 0) return;
    draw_message_remaining_with_psg_service(&active_message_state);
    refresh_message_wait_indicator();
}

static void tick_active_message(void)
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
    VN_MAP_BANK130_FOR_CODE();
    message_complete = draw_message_next_glyph_locked(&active_message_state);
    if (message_complete) refresh_message_wait_indicator();
}

static void VN_BANKED_CODE2 draw_choice_options(void)
{
    uint8_t row;
    uint8_t restore_window_display;
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    if (active_choice_index < 0) return;
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, choice)) return;
    /* Choices always use the default UI text color, not a prior message's tint. */
    apply_message_text_color(PCE_VN_MESSAGE_COLOR_NONE);
    restore_window_display = begin_message_window_vram_update();
    clear_window_tile_pixels();
    for (row = 0u; row < choice->option_count && row < VN_TEXT_ROWS; row++)
    {
        uint8_t col;
        uint16_t pos = 0u;
        pce_vn_choice_option_t *option = VN_CHOICE_OPTION_SCRATCH;
        if (!scene_pack_read_choice_option(&active_scene_pack, choice, row, option)) continue;
        call_overlay_draw_message_glyph_at(row == choice_selected_index ? PCE_VN_CHOICE_CURSOR_GLYPH : 0u, 0u, row);
        for (col = 0u; col < option->glyph_count && col + 1u < VN_TEXT_COLS; col++)
        {
            const uint16_t glyph = vn_glyph_decode(option->glyphs, pos);
            pos = (uint16_t)(pos + vn_glyph_stride(option->glyphs, pos));
            if (glyph == PCE_VN_GLYPH_END) break;
            call_overlay_draw_message_glyph_at(glyph, (uint8_t)(col + 1u), row);
        }
        engine_service();
    }
    end_message_window_vram_update(restore_window_display);
    if (!restore_window_display && !pending_display_enable)
    {
        delay_frame();
    }
}

