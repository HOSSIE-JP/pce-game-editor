/* PHASE_A_SPLIT:BEGIN vn_adpcm_core.c — buffered ADPCM voice
   playback: voice snapshot copy, ADPCM RAM load, System Card BIOS playback,
   explicit stop and the per-frame natural-completion service. Moved from
   pce_vn_runtime.c (Phase A module split). PHASE_A_SPLIT:END */
static unsigned int VN_CD_ASYNC_CODE adpcm_voice_buffer_size_impl(void)
{
#if defined(__PCE_CD__)
    unsigned int size = 0u;
    if (adpcm_voice_snapshot.data_size && adpcm_voice_snapshot.data_size <= 65535ul)
    {
        size = (unsigned int)adpcm_voice_snapshot.data_size;
    }
    return size;
#else
    return 0u;
#endif
}

static uint8_t VN_CD_ASYNC_CODE adpcm_voice_fits_buffer_impl(void)
{
#if defined(__PCE_CD__)
    const unsigned int size = adpcm_voice_buffer_size_impl();
    unsigned long end;
    if (!size) return 0u;
    if (size > VN_ADPCM_BUFFERED_SAFE_BYTES) return 0u;
    if (!adpcm_voice_snapshot.data_size || adpcm_voice_snapshot.data_size > 65535ul) return 0u;
    if ((unsigned long)adpcm_voice_snapshot.adpcm_address >= 65536ul) return 0u;
    end = (unsigned long)adpcm_voice_snapshot.adpcm_address + (unsigned long)size;
    return end <= 65536ul ? 1u : 0u;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE adpcm_voice_fits_buffer(void)
{
#if defined(__PCE_CD__)
    return vn_cd_async_call_bank122(VN_CD_ASYNC_OP_ADPCM_FITS_BUFFER);
#else
    return 0u;
#endif
}

/* This metadata snapshot lives in bank129. Keeping it out of the nearly-full
   bank133 overlay leaves room for the shared message-mouth transition helper,
   and bank130 callers can reach bank129 without swapping their executing bank. */
static uint8_t VN_BANKED_CODE copy_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    const pce_editor_adpcm_asset_t *voice;
    const unsigned char *voice_data;
    unsigned long voice_data_size;
    unsigned int voice_sample_rate;
    unsigned int voice_adpcm_address;
    unsigned int voice_play_frames;
    unsigned int voice_cd_byte_size = 0u;
    unsigned char voice_divider;
    unsigned char voice_loop;
    if (voice_index < 0) return 0u;
    map_resident_data();
    if ((unsigned int)voice_index >= pce_editor_adpcm_asset_count) return 0u;
    voice = vn_get_adpcm_asset((uint16_t)voice_index);
    voice_data = voice->data;
    voice_data_size = voice->data_size;
    voice_sample_rate = voice->sample_rate;
    voice_adpcm_address = voice->adpcm_address;
    voice_play_frames = voice->play_frames;
    voice_divider = voice->divider;
    voice_loop = voice->loop;
    adpcm_voice_snapshot.data = voice_data;
    adpcm_voice_snapshot.data_size = voice_data_size;
    adpcm_voice_snapshot.sample_rate = voice_sample_rate;
    adpcm_voice_snapshot.adpcm_address = voice_adpcm_address;
    adpcm_voice_snapshot.play_frames = voice_play_frames;
    adpcm_voice_snapshot.divider = voice_divider;
    adpcm_voice_snapshot.loop = voice_loop;
    map_vn_data();
    adpcm_voice_snapshot.has_cd = (uint8_t)(voice->cd && voice->cd->sector_count);
    if (adpcm_voice_snapshot.has_cd)
    {
        adpcm_voice_snapshot.cd_sector_count = voice->cd->sector_count;
        adpcm_voice_snapshot.cd_sector.lo = voice->cd->sector.lo;
        adpcm_voice_snapshot.cd_sector.md = voice->cd->sector.md;
        adpcm_voice_snapshot.cd_sector.hi = voice->cd->sector.hi;
        voice_cd_byte_size = voice->cd->byte_size;
    }
    else
    {
        adpcm_voice_snapshot.cd_sector_count = 0u;
        adpcm_voice_snapshot.cd_sector.lo = 0u;
        adpcm_voice_snapshot.cd_sector.md = 0u;
        adpcm_voice_snapshot.cd_sector.hi = 0u;
    }
    adpcm_voice_snapshot.cd_byte_size = voice_cd_byte_size;
    return 1u;
#else
    (void)voice_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE adpcm_playback_active(void)
{
#if defined(__PCE_CD__)
    return adpcm_play_active;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE wait_adpcm_transfer_ready(void)
{
#if defined(__PCE_CD__)
    uint16_t guard = 65535u;
    while (guard && (pce_cdb_adpcm_status() & ADPCM_BUSY))
    {
        guard--;
        /* PSG_DRIVE remains IRQ-owned during this direct ADPCM busy wait. */
    }
    return guard ? 1u : 0u;
#else
    return 0u;
#endif
}

static void VN_BANKED_CODE2 restore_display_after_adpcm(uint8_t restore_display)
{
#if defined(__PCE_CD__)
    restore_video_after_cdb_call(restore_display);
    VN_MAP_BANK130_FOR_CODE();
#else
    (void)restore_display;
#endif
}

static inline uint8_t VN_BANKED_CODE2_INLINE load_adpcm_voice_async_cd(void)
{
#if defined(__PCE_CD__)
    pce_sector_t sector = {0};
    uint16_t byte_count = (uint16_t)adpcm_voice_snapshot.data_size;
    cd_sector_from_ref(&sector, &adpcm_voice_snapshot.cd_sector);
    if (!byte_count) return 0u;
    if (!vn_cd_async_begin_data_read(sector, VN_CD_ASYNC_DEST_ADPCM_RAM, 0u, (uint16_t)adpcm_voice_snapshot.adpcm_address, byte_count)) return 0u;
    while (!vn_cd_async_done())
    {
        vn_wait_next_vblank_raw();
        engine_service();
        vn_cd_async_service_frame();
    }
    return vn_cd_async_succeeded();
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE adpcm_voice_bios_cd_load_fits(void)
{
#if defined(__PCE_CD__)
    const uint16_t sector_count = adpcm_voice_snapshot.cd_sector_count;
    const unsigned int adpcm_address = adpcm_voice_snapshot.adpcm_address;
    if (!sector_count || sector_count > 32u) return 0u;
    if (!adpcm_address) return 1u;
    return (uint8_t)(sector_count <= ((uint16_t)(0u - adpcm_address) >> 11));
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE load_adpcm_voice_bios_cd(uint8_t chunk_sectors)
{
#if defined(__PCE_CD__)
    pce_sector_t sector = {0};
    const uint16_t sector_count = adpcm_voice_snapshot.cd_sector_count;
    uint8_t remaining = sector_count > 255u ? 255u : (uint8_t)sector_count;
    uint8_t loaded = 0u;
    unsigned int adpcm_address = adpcm_voice_snapshot.adpcm_address;
    if (!remaining)
    {
        return 0u;
    }
    if (!chunk_sectors) chunk_sectors = remaining;
    vn_cd_bios_irq_open();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        return 0u;
    }
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, &adpcm_voice_snapshot.cd_sector);
    while (remaining)
    {
        uint8_t chunk = remaining > chunk_sectors ? chunk_sectors : remaining;
        uint8_t advance;
        loaded = (uint8_t)(!pce_cdb_adpcm_read_from_cd(sector, chunk, adpcm_address));
        if (!loaded) return 0u;
        cd_transfer_wait();
        if (!wait_adpcm_transfer_ready())
        {
            return 0u;
        }
        remaining = (uint8_t)(remaining - chunk);
        adpcm_address = (unsigned int)(adpcm_address + ((unsigned int)chunk << 11));
        advance = chunk;
        while (advance--) cd_sector_advance(&sector);
    }
    /* A preload has no immediate PLAY command to retire the BIOS transfer
       state. Reset the controller now; ADPCM RAM contents are preserved. */
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready()) return 0u;
    return loaded;
#else
    (void)chunk_sectors;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 load_adpcm_voice(signed int voice_index, uint8_t allow_stop_playback, uint8_t chunk_sectors)
{
#if defined(__PCE_CD__)
    uint8_t loaded = 0u;
    uint8_t same_loaded;
    uint8_t stopped_playback = 0u;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    (void)chunk_sectors;
    if (voice_index < 0) return 0u;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_fits_buffer()) return 0u;
    same_loaded = (uint8_t)(loaded_adpcm_valid && loaded_adpcm_index == (uint16_t)voice_index);
    if (adpcm_playback_active())
    {
        if (!allow_stop_playback) return same_loaded ? 1u : 0u;
        vn_cd_bios_irq_open();
        pce_cdb_adpcm_stop();
        (void)wait_adpcm_transfer_ready();
        adpcm_play_active = 0u;
        adpcm_play_frames_remaining = 0u;
        adpcm_play_looping = 0u;
        stopped_playback = 1u;
    }
    if (same_loaded)
    {
        if (stopped_playback)
        {
            sync_cd_external_irq_after_bios_call();
            restore_display_after_adpcm(restore_display);
        }
        return 1u;
    }
    if ((!adpcm_voice_snapshot.data && !adpcm_voice_snapshot.has_cd) || !adpcm_voice_snapshot.data_size) return 0u;
    loaded_adpcm_valid = 0u;
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    if (adpcm_voice_snapshot.has_cd)
    {
        if (!psg_active && adpcm_voice_bios_cd_load_fits())
        {
            loaded = load_adpcm_voice_bios_cd(0u);
        }
        else
        {
            loaded = load_adpcm_voice_async_cd();
        }
    }
    else
    {
        vn_cd_bios_irq_open();
        map_resident_data();
        loaded = (uint8_t)(!pce_cdb_adpcm_read_from_ram(PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)adpcm_voice_snapshot.data, adpcm_voice_snapshot.adpcm_address, (uint16_t)adpcm_voice_snapshot.data_size));
    }
    if (!loaded)
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    if (!adpcm_voice_snapshot.has_cd && !wait_adpcm_transfer_ready())
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    loaded_adpcm_valid = 1u;
    loaded_adpcm_index = (uint16_t)voice_index;
    resume_cdda_after_cd_data_access();
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    (void)allow_stop_playback;
    (void)chunk_sectors;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 play_adpcm_buffered_voice(signed int voice_index, uint8_t restore_display, uint8_t chunk_sectors)
{
#if defined(__PCE_CD__)
    uint8_t divider;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_fits_buffer()) return 0u;
    adpcm_play_looping = 0u;
    if (!load_adpcm_voice(voice_index, 1u, chunk_sectors))
    {
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    divider = VN_ADPCM_SNAPSHOT_DIVIDER();
    vn_cd_bios_irq_open();
    if (pce_cdb_adpcm_play(
            (uint16_t)adpcm_voice_snapshot.adpcm_address,
            (uint16_t)adpcm_voice_snapshot.data_size,
            divider,
            adpcm_voice_snapshot.loop ? PCE_CDB_ADPCM_REPEAT : PCE_CDB_ADPCM_ONE_SHOT))
    {
        loaded_adpcm_valid = 0u;
        map_resident_data();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    /*
     * The System Card starts the buffered sample with its real byte length.
     * One-shots still use generated frame metadata for runtime bookkeeping only;
     * natural completion never polls BIOS status or issues a second stop/reset.
     */
    adpcm_play_active = 1u;
    adpcm_play_frames_remaining = adpcm_voice_snapshot.loop ? 0u : VN_ADPCM_SNAPSHOT_PLAY_FRAMES();
    adpcm_play_looping = adpcm_voice_snapshot.loop ? 1u : 0u;
    /*
     * Buffered playback does not need the System Card external IRQ after the
     * play command has been accepted. Leaving it enabled lets the BIOS run
     * asynchronously during our own VDC updates; non-loop voices also do not need
     * the completion IRQ because the runtime counts frames itself.
    */
    sync_cd_external_irq_after_bios_call();
    pad_edge_reset_pending = 1u;
    restore_display_after_adpcm(restore_display);
    mask_buffered_adpcm_completion_irq();
    return 1u;
#else
    (void)voice_index;
    (void)restore_display;
    (void)chunk_sectors;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 play_adpcm_message_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (voice_index < 0) return 0u;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_fits_buffer()) return 0u;
    VN_MAP_BANK130_FOR_CODE();
    return play_adpcm_buffered_voice(voice_index, restore_display, VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS);
#else
    (void)voice_index;
    return 0u;
#endif
}

static void VN_BANKED_CODE play_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (!copy_adpcm_voice(voice_index)) return;
    VN_MAP_BANK130_FOR_CODE();
    (void)play_adpcm_buffered_voice(voice_index, restore_display, VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS);
#else
    (void)voice_index;
#endif
}

static void VN_BANKED_CODE stop_adpcm_voice(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    vn_cd_bios_irq_open();
    pce_cdb_adpcm_stop();
    (void)wait_adpcm_transfer_ready();
    pce_cdb_adpcm_reset();
    (void)wait_adpcm_transfer_ready();
    loaded_adpcm_valid = 0u;
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_play_looping = 0u;
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
#endif
}

/* The frame service runs from the roomy bank122 code blob. It can call bank129
   directly; the bank124 logic dispatcher restores bank122 exactly before this
   function resumes, then vn_cd_async_call_bank122 restores caller slot4/MPR6. */
static void VN_CD_ASYNC_CODE service_adpcm_playback_impl(void)
{
#if defined(__PCE_CD__)
    if (!adpcm_play_active) return;
    if (!adpcm_play_frames_remaining) return;
    adpcm_play_frames_remaining--;
    if (adpcm_play_frames_remaining) return;
    /*
     * Do not poll ADPCM status or call stop/reset at natural one-shot
     * completion. The hardware has already stopped at the real sample length;
     * this service only releases runtime/message state.
     */
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_play_looping = 0u;
    sync_cd_external_irq_after_bios_call();
    /* A general Audio ADPCM one-shot may finish while an unrelated message is
       revealing. Only the active message's own one-shot voice owns the mouth
       restore; text completion handles messages without a voice. */
    if (message_voice_mode == VN_MESSAGE_VOICE_ONESHOT)
    {
        update_active_message_mouth(1u);
    }
#endif
}

