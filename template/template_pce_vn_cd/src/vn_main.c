/* PHASE_A_SPLIT:BEGIN vn_main.c — runtime entry: init_runtime_state, the
   VBlank wait / frame delay primitives, joypad read, init_video and main().
   Moved verbatim from pce_vn_runtime.c (Phase A module split).
   PHASE_A_SPLIT:END */
static void init_runtime_state(void)
{
    uint16_t i;
    current_scene = PCE_VN_INVALID_SCENE;
    current_command = 0u;
    pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
    pending_display_enable = 0u;
    pending_scene_sprite_clear = 0u;
    current_bg_index = -1;
    current_bg_display_valid = 0u;
    current_bg_x = 0u;
    current_bg_y = 0u;
    current_bg_map_base = 0u;
    current_bg_width_tiles = 0u;
    current_bg_height_tiles = 0u;
    preloaded_bg_valid = 0u;
    preloaded_bg_index = 0u;
    preloaded_bg_x = 0u;
    preloaded_bg_y = 0u;
    preloaded_scene_visual_valid = 0u;
    preloaded_scene_index = PCE_VN_INVALID_SCENE;
    full_screen_bg_text_vram_dirty = 0u;
    loaded_adpcm_valid = 0u;
    loaded_adpcm_index = 0u;
#if defined(__PCE_CD__)
    cdda_state = 0u;
    sprite_animation_meta_ready = 0u;
    sprite_animation_meta_index = 0u;
#if VN_CDDA_RESUME_AFTER_DATA_READ
    cdda_resume_defer_depth = 0u;
#endif
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_play_looping = 0u;
    pad_edge_reset_pending = 0u;
    active_scene_pack.base = (uint16_t)(uintptr_t)VN_ACTIVE_SCENE_PACK_DATA;
    active_scene_pack.size = 0u;
    active_scene_pack.scene_index = PCE_VN_INVALID_SCENE;
    active_scene_pack.valid = 0u;
#else
    active_scene_pack.base = 0u;
    active_scene_pack.size = 0u;
    active_scene_pack.scene_index = PCE_VN_INVALID_SCENE;
    active_scene_pack.valid = 0u;
#endif
    screen_shake_x = 0;
    screen_shake_y = 0;
    active_message_index = -1;
    active_choice_index = -1;
    choice_selected_index = 0u;
    wait_frames_remaining = 0u;
    message_glyph_pos = 0u;
    message_glyph_byte = 0u;
    message_frame_timer = 0u;
    message_col = 0u;
    message_row = 0u;
    message_complete = 1u;
    message_auto_wait = 0u;
    message_voice_mode = VN_MESSAGE_VOICE_NONE;
    active_message_mouth_animation_index = -1;
    ui_text_color = PCE_VN_MESSAGE_COLOR_NONE;
    sync_input_active = 0u;
    sync_input_mask = 0u;
    sync_input_target = PCE_VN_NO_COMMAND;
    async_input_watcher_count = 0u;
    current_scene_full_screen_bg = 0u;
    sprite_satb_layout_valid = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        loaded_sprite_pattern_valid[i] = 0u;
        loaded_sprite_pattern_index[i] = 0u;
        loaded_sprite_pattern_base[i] = 0u;
        loaded_sprite_pattern_units[i] = 0u;
        loaded_sprite_palette_bank[i] = 0u;
        sprite_satb_slot_start[i] = 0u;
        sprite_satb_slot_count[i] = 0u;
        sprite_slot_pattern_valid[i] = 0u;
        sprite_slot_pattern_base[i] = 0u;
        sprite_slot_palette_bank[i] = 0u;
        sprite_slot_cell_map[i] = (const uint8_t *)0;
    }
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
    vn_visual_cache_clock = 0u;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        vn_visual_cache_valid[i] = 0u;
        vn_visual_cache_kind[i] = VN_VISUAL_CACHE_KIND_NONE;
        vn_visual_cache_asset[i] = 0u;
        vn_visual_cache_part[i] = 0u;
        vn_visual_cache_size[i] = 0u;
        vn_visual_cache_lru[i] = 0u;
    }
#endif
    map_vn_data();
    for (i = 0u; i < pce_vn_variable_count && i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        const uint16_t value = (uint16_t)(int16_t)pce_vn_variable_initial_values[i];
        vn_variable_lo[i] = (uint8_t)(value & 0xffu);
        vn_variable_hi[i] = (uint8_t)(value >> 8);
    }
    for (; i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        vn_variable_lo[i] = 0u;
        vn_variable_hi[i] = 0u;
    }
    vn_auto_enable = vn_variable_lo[PCE_VN_VARIABLE_AUTO_ENABLE_INDEX];
    vn_msg_speed = vn_variable_lo[PCE_VN_VARIABLE_MSG_SPEED_INDEX];
    VN_MAP_BANK130_FOR_CODE();
    /* bank122 has not been loaded yet; use the permanent bank129 helper. */
    initialize_sprite_move_state();
    clear_spritetext_slots();
}

static void VN_BANKED_CODE vn_wait_next_vblank_raw(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    const uint16_t start = vn_frame_epoch;
    while (vn_frame_epoch == start) {}
#endif
}

static void VN_BANKED_CODE vn_wait_next_vblank_idle(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
#if defined(__PCE_CD__)
    quiet_cd_unit_irqs();
#endif
    vn_wait_next_vblank_raw();
#endif
}

static void VN_BANKED_CODE vn_wait_next_vblank(void)
{
    vn_wait_next_vblank_idle();
}

static void VN_BANKED_CODE delay_frame(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank130_map();
    vn_wait_next_vblank();
    engine_service();
#else
    volatile uint16_t delay;
    for (delay = 0; delay < 6200u; delay++) {}
#endif
}

/* Pad polling only runs from main after MPR4 has been restored to bank130.
   Keep this leaf out of bank128 so large CD metadata catalogs retain the
   resident safety margin without weakening the link-map gate. */
static uint8_t VN_BANKED_CODE2 read_pad_raw(void)
{
#if defined(__PCE__)
    vn_map_io_page();
    /* llvm-mos returns the hardware's active-low pad byte.  Normalize it so
       edge detection and the public PAD_* masks represent pressed buttons. */
    return (uint8_t)~pce_joypad_read();
#else
    return 0;
#endif
}

#if defined(__PCE_CD__)
static uint8_t VN_RESIDENT_CODE vn_system_card_diagnostic_char(uint8_t index)
{
    if (index == 0u) return 'S';
    if (index == 1u) return 'C';
    if (index == 2u) return '3';
    if (index == 4u) return 'E';
    if (index == 5u || index == 6u) return 'R';
    return ' ';
}

static uint8_t VN_RESIDENT_CODE vn_system_card_diagnostic_row(uint8_t ch, uint8_t row)
{
    if (ch == 'S')
    {
        if (row == 0u || row == 3u || row == 6u) return 0x1eu;
        return row < 3u ? 0x10u : 0x01u;
    }
    if (ch == 'C') return (row == 0u || row == 6u) ? 0x1eu : 0x10u;
    if (ch == '3') return (row == 0u || row == 3u || row == 6u) ? 0x1eu : 0x01u;
    if (ch == 'E') return (row == 0u || row == 3u || row == 6u) ? 0x1fu : 0x10u;
    if (ch == 'R')
    {
        if (row == 0u || row == 3u) return 0x1eu;
        if (row == 1u || row == 2u) return 0x11u;
        if (row == 4u) return 0x14u;
        if (row == 5u) return 0x12u;
        return 0x11u;
    }
    return 0u;
}

/* This tiny fixed ASCII renderer is deliberately not a general font fallback.
   It exists only to make an unsupported System Card/font probe diagnosable. */
static void VN_RESIDENT_CODE __attribute__((noreturn)) vn_system_card_show_failure(void)
{
    uint8_t diagnostic_tile[32];
    uint16_t diagnostic_map[7];
    uint8_t glyph;
    uint8_t row;
    for (glyph = 0u; glyph < 7u; glyph++)
    {
        const uint16_t tile = (uint16_t)(PCE_VN_BLANK_TILE + 1u + glyph);
        const uint8_t ch = vn_system_card_diagnostic_char(glyph);
        for (row = 0u; row < 8u; row++)
        {
            const uint8_t mask = row < 7u ? (uint8_t)(vn_system_card_diagnostic_row(ch, row) << 1) : 0u;
            diagnostic_tile[row * 2u] = mask;
            diagnostic_tile[(row * 2u) + 1u] = mask;
            diagnostic_tile[16u + (row * 2u)] = mask;
            diagnostic_tile[17u + (row * 2u)] = mask;
        }
        pce_editor_vram_copy((uint16_t)(tile * 16u), diagnostic_tile, 32u);
        diagnostic_map[glyph] = ui_tile(tile);
    }
    write_map_words((uint16_t)((14u * VN_MAP_WIDTH) + 12u), diagnostic_map, 7u);
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
    pce_irq_disable(IRQ_VDC);
    for (;;) __asm__ volatile("nop");
}
#endif

static void init_video(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank129_map();
    pce_ram_bank130_map();
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    set_vdc_control(VN_VDC_BLANK_CONTROL);
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    (void)init_psg_service();
#elif defined(__PCE__)
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_irq_disable(IRQ_VDC);
#endif
    upload_ui_palette();
    upload_blank_tile();
    clear_screen_map();
#if defined(__PCE_CD__)
    if (!vn_system_card_probe_ok) vn_system_card_show_failure();
#endif
    set_screen_offset(0, 0);
#if defined(__PCE_CD__)
    /* Stream the transition/upload overlay into bank133 at boot. It is invoked
       later by mapping bank133 into slot 4, running an entry, and restoring
       bank130 (see the overlay jump table / set_background wrapping in a later
       phase). The CD->bank133->slot4 load/map/execute path is verified in
       Geargrafx (overlay ran from slot 4 with MPR4=bank133). */
    load_overlay_code();
    load_logic_overlay_code();
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
    load_visual_cache_code();
#endif
    load_cd_async_code();
#endif
}

int main(void)
{
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;
    uint8_t async_input_index;
#if defined(__PCE_CD__)
    pce_sector_t absolute_disc_base = {0};

    /* pce-mkcd's IPL leaves the BIOS CD base at Track 2 so legacy reads can
       use data-track-relative sectors. Generated VN references use absolute
       disc LBAs, so clear both BIOS bases before the first overlay/data read. */
    pce_cdb_cd_base(
        absolute_disc_base,
        (uint8_t)(PCE_CDB_LOCATION_TYPE_SECTOR | PCE_CDB_BASE_SET_BOTH));
#endif

    init_runtime_state();
    init_video();
    map_vn_data();
    runtime_start_scene = pce_vn_start_scene;
    if (runtime_start_scene >= pce_vn_scene_count) runtime_start_scene = 0u;
    show_scene(runtime_start_scene);
    advance_story();
    VN_MAP_BANK130_FOR_CODE();
    last_pad = read_pad_raw();
#if defined(__PCE_CD__)
    if (pad_edge_reset_pending)
    {
        pad_edge_reset_pending = 0u;
    }
#endif

    while (1)
    {
        VN_MAP_BANK130_FOR_CODE();
        pad = read_pad_raw();
#if defined(__PCE_CD__)
        if (pad_edge_reset_pending)
        {
            last_pad = pad;
            pad_edge_reset_pending = 0u;
        }
#endif
        pressed = (uint8_t)(pad & (uint8_t)~last_pad);
        if (pressed & PAD_SEL)
        {
            const uint8_t auto_enabled = vn_auto_enable;
            set_variable_value((signed int)PCE_VN_VARIABLE_AUTO_ENABLE_INDEX, auto_enabled ? 0 : 1);
            pressed = (uint8_t)(pressed & (uint8_t)~PAD_SEL);
            if (!auto_enabled && active_message_index >= 0 && message_complete)
            {
                message_auto_wait = active_message_state.auto_wait_frames;
            }
            refresh_message_wait_indicator();
        }
        async_input_index = find_async_input_watcher(pressed);
        if (async_input_index < async_input_watcher_count)
        {
            /* One route resolves the whole pending input group. */
            const uint16_t target = async_input_targets[async_input_index];
            async_input_watcher_count = 0u;
            sync_input_active = 0u;
            sync_input_mask = 0u;
            sync_input_target = PCE_VN_NO_COMMAND;
            VN_MAP_BANK130_FOR_CODE();
            cancel_all_sprite_moves();
            (void)jump_to_command(target);
            advance_story();
        }
        else if (sync_sprite_move_slot < VN_SPRITE_SLOT_COUNT)
        {
            if (!sprite_moves[sync_sprite_move_slot].active)
            {
                sync_sprite_move_slot = 0xffu;
                advance_story();
            }
        }
        else if (active_choice_index >= 0)
        {
            (void)handle_choice_input(pressed);
        }
        else if (sync_input_active)
        {
            /* Synchronous wait: block until one of the requested buttons is hit. */
            if (pressed & sync_input_mask)
            {
                const uint16_t target = sync_input_target;
                sync_input_active = 0u;
                sync_input_mask = 0u;
                sync_input_target = PCE_VN_NO_COMMAND;
                async_input_watcher_count = 0u;
                VN_MAP_BANK130_FOR_CODE();
                (void)jump_to_command(target);
                advance_story();
            }
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
                /* First press: skip the typewriter wait and reveal the whole
                   page; the voice keeps playing until the next page advance. */
                finish_active_message();
            }
            else
            {
                /* Advancing off a finished message page: if its voice is still
                   playing (e.g. the reveal was skipped), end it now. */
                if (active_message_index >= 0 && adpcm_playback_active()) stop_adpcm_voice();
                if (active_message_index >= 0) hide_message_wait_indicator();
                advance_story();
            }
        }
        tick_active_message();
        tick_message_wait_indicator();
        if (active_message_index >= 0 && message_complete)
        {
            if (vn_auto_enable)
            {
                if (message_voice_mode == VN_MESSAGE_VOICE_ONESHOT)
                {
                    if (!adpcm_playback_active())
                    {
                        hide_message_wait_indicator();
                        advance_story();
                    }
                }
                else if (message_auto_wait)
                {
                    message_auto_wait--;
                }
                else
                {
                    if (message_voice_mode == VN_MESSAGE_VOICE_LOOP && adpcm_playback_active())
                    {
                        stop_adpcm_voice();
                    }
                    hide_message_wait_indicator();
                    advance_story();
                }
            }
        }
        /* Animation and movement tick after all script advancement so a move
           started by input or auto-advance takes its first DDA step before this
           frame's VBlank. PSG remains IRQ-driven throughout the SATB update. */
        tick_sprite_animations();
        tick_spritetext();
        if (pending_sprite_refresh) refresh_scene_sprites();
        last_pad = pad;
        delay_frame();
    }
    return 0;
}
