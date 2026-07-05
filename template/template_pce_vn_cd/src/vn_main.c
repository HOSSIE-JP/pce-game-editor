/* PHASE_A_SPLIT:BEGIN vn_main.c — runtime entry: init_runtime_state, the
   VBlank wait / frame delay primitives, joypad read, init_video and main().
   Moved verbatim from pce_vn_runtime.c (Phase A module split).
   PHASE_A_SPLIT:END */
static void init_runtime_state(void)
{
    uint8_t i;
    current_scene = 0u;
    current_command = 0u;
    pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
    pending_display_enable = 0u;
    pending_scene_sprite_clear = 0u;
    current_bg_index = -1;
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
    preloaded_scene_index = 0u;
    full_screen_bg_text_vram_dirty = 0u;
    loaded_adpcm_valid = 0u;
    loaded_adpcm_index = 0u;
#if defined(__PCE_CD__)
    cdda_state = 0u;
#if VN_CDDA_RESUME_AFTER_DATA_READ
    cdda_resume_defer_depth = 0u;
#endif
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_play_looping = 0u;
    pad_edge_reset_pending = 0u;
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
    message_glyph_byte = 0u;
    message_frame_timer = 0u;
    message_col = 0u;
    message_row = 0u;
    message_complete = 1u;
    message_auto_wait = 0u;
    ui_text_color = PCE_VN_MESSAGE_COLOR_NONE;
    sync_input_active = 0u;
    sync_input_mask = 0u;
    sync_input_target = PCE_VN_NO_COMMAND;
    async_input_active = 0u;
    async_input_mask = 0u;
    async_input_target = PCE_VN_NO_COMMAND;
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
    VN_MAP_BANK130_FOR_CODE();
    clear_spritetext_slots();
}

static void VN_BANKED_CODE vn_wait_next_vblank(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
#if defined(__PCE_CD__)
    quiet_cd_unit_irqs();
#endif
    __asm__ volatile(
        "lda #$ff\n"
        "tam #$01\n"
        "ldy #$80\n"
        "vn_wait_vblank_end_outer%=:\n"
        "ldx #$ff\n"
        "vn_wait_vblank_end_inner%=:\n"
        "lda $0000\n"
        "and #$20\n"
        "beq vn_wait_vblank_start%=\n"
        "dex\n"
        "bne vn_wait_vblank_end_inner%=\n"
        "dey\n"
        "bne vn_wait_vblank_end_outer%=\n"
        "vn_wait_vblank_start%=:\n"
        "ldy #$80\n"
        "vn_wait_vblank_start_outer%=:\n"
        "ldx #$ff\n"
        "vn_wait_vblank_start_inner%=:\n"
        "lda $0000\n"
        "and #$20\n"
        "bne vn_wait_vblank_done%=\n"
        "dex\n"
        "bne vn_wait_vblank_start_inner%=\n"
        "dey\n"
        "bne vn_wait_vblank_start_outer%=\n"
        "vn_wait_vblank_done%=:\n"
        :
        :
        : "a", "x", "y", "memory");
#endif
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

static uint8_t read_pad_raw(void)
{
#if defined(__PCE__)
    vn_map_io_page();
    return pce_joypad_read();
#else
    return 0;
#endif
}

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
    pce_cdb_irq_set(PCE_CDB_ID_IRQ_VDC, vn_cd_irq1_quiet_handler);
    pce_irq_disable(IRQ_VDC);
    pce_cdb_irq_disable(VN_CDB_IRQ_MASK_RUNTIME_QUIET);
    quiet_cd_unit_irqs();
    init_psg_service();
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
    upload_font_tiles();
    upload_font_sprite_patterns();
    upload_blank_tile();
    clear_screen_map();
    set_screen_offset(0, 0);
#if defined(__PCE_CD__)
    /* Stream the transition/upload overlay into bank133 at boot. It is invoked
       later by mapping bank133 into slot 4, running an entry, and restoring
       bank130 (see the overlay jump table / set_background wrapping in a later
       phase). The CD->bank133->slot4 load/map/execute path is verified in
       Geargrafx (overlay ran from slot 4 with MPR4=bank133). */
    load_overlay_code();
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
    load_visual_cache_code();
#endif
#endif
}

int main(void)
{
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;

    init_runtime_state();
    init_video();
    map_vn_data();
    runtime_start_scene = pce_vn_start_scene;
    if (runtime_start_scene >= pce_vn_scene_count) runtime_start_scene = 0u;
    show_scene(runtime_start_scene);
    advance_story();
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
        if (async_input_active && (pressed & async_input_mask))
        {
            /* Background watcher matched: jump to its label and resume there. */
            const uint16_t target = async_input_target;
            async_input_active = 0u;
            async_input_mask = 0u;
            async_input_target = PCE_VN_NO_COMMAND;
            VN_MAP_BANK130_FOR_CODE();
            (void)jump_to_command(target);
            advance_story();
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
        /* Do not restore the old ADPCM gate:
        if (!adpcm_playback_active())
        {
            tick_sprite_animations();
        } */
        tick_sprite_animations();
        tick_spritetext();
        if (pending_sprite_refresh) refresh_scene_sprites();
        tick_active_message();
        tick_message_wait_indicator();
        if (active_message_index >= 0 && message_complete)
        {
            if (active_message_state.advance_mode == PCE_VN_ADVANCE_AUTO)
            {
                if (message_auto_wait) message_auto_wait--;
                else
                {
                    hide_message_wait_indicator();
                    advance_story();
                }
            }
        }
        last_pad = pad;
        delay_frame();
    }
    return 0;
}
