/* PHASE_A_SPLIT:BEGIN vn_adpcm_core.c — buffered/streamed ADPCM voice
   playback: the direct ADPCM latch/start/stop helpers, voice snapshot copy,
   load/stream/play/stop and the per-frame service. Moved verbatim from
   pce_vn_runtime.c (Phase A module split). PHASE_A_SPLIT:END */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
static void VN_BANKED_CODE adpcm_latch_word_direct(uint16_t value, uint8_t latch)
{
#if defined(__PCE_CD__)
    *IO_PCD_ADPCM_ADDR_LO = (uint8_t)(value & 0xffu);
    *IO_PCD_ADPCM_ADDR_HI = (uint8_t)(value >> 8);
    *IO_PCD_ADPCM_CONTROL = (uint8_t)(*IO_PCD_ADPCM_CONTROL | latch);
    if (latch == PCD_ADPCM_READ_LATCH)
    {
        uint8_t guard = 5u;
        (void)*IO_PCD_ADPCM_DATA;
        while (guard--) {}
    }
    *IO_PCD_ADPCM_CONTROL = (uint8_t)(*IO_PCD_ADPCM_CONTROL & (uint8_t)~latch);
#else
    (void)value;
    (void)latch;
#endif
}

static void VN_BANKED_CODE start_buffered_adpcm_playback_direct(unsigned int address, uint16_t length, uint8_t divider)
{
#if defined(__PCE_CD__)
    uint8_t irq;
    irq = vn_vdc_irq_lock();
    quiet_cd_unit_irqs();
    *IO_PCD_ADPCM_CONTROL = 0u;
    adpcm_latch_word_direct((uint16_t)address, PCD_ADPCM_READ_LATCH);
    if (!length) length = 1u;
    adpcm_latch_word_direct(length, PCD_ADPCM_LENGTH_LATCH);
    *IO_PCD_ADPCM_DIVIDER = divider;
    /* Use a long hardware counter and let the VN frame counter stop/restart the
       voice before the hardware half/end latches. Latching the real sample length
       makes the ADPCM half IRQ fire during ordinary playback; even with CD IRQs
       masked, Geargrafx shows the System Card IRQ path can then steal VBlank and
       corrupt PSG/display state. */
    *IO_PCD_ADPCM_CONTROL = (uint8_t)(PCD_ADPCM_PLAY | PCD_ADPCM_REPEAT);
    vn_vdc_irq_unlock(irq);
#else
    (void)address;
    (void)length;
    (void)divider;
#endif
}

static void VN_RESIDENT_CODE stop_buffered_adpcm_playback_direct(void)
{
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    *IO_PCD_ADPCM_CONTROL = 0u;
    quiet_cd_unit_irqs();
    vn_vdc_irq_unlock(irq);
#endif
}

#endif /* PHASE_A_SPLIT */
static unsigned int VN_BANKED_CODE adpcm_voice_buffer_size(void)
{
#if defined(__PCE_CD__)
    unsigned int size = adpcm_voice_snapshot.cd_byte_size;
    if (!size && adpcm_voice_snapshot.data_size && adpcm_voice_snapshot.data_size <= 65535ul)
    {
        size = (unsigned int)adpcm_voice_snapshot.data_size;
    }
    return size;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE adpcm_voice_fits_buffer(void)
{
#if defined(__PCE_CD__)
    const unsigned int size = adpcm_voice_buffer_size();
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

static uint8_t VN_OVERLAY_CODE copy_adpcm_voice_impl(signed int voice_index)
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
    unsigned char voice_stream;
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
    voice_stream = voice->stream;
    adpcm_voice_snapshot.data = voice_data;
    adpcm_voice_snapshot.data_size = voice_data_size;
    adpcm_voice_snapshot.sample_rate = voice_sample_rate;
    adpcm_voice_snapshot.adpcm_address = voice_adpcm_address;
    adpcm_voice_snapshot.play_frames = voice_play_frames;
    adpcm_voice_snapshot.divider = voice_divider;
    adpcm_voice_snapshot.loop = voice_loop;
    adpcm_voice_snapshot.stream = voice_stream;
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

static uint8_t VN_BANKED_CODE copy_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    return vn_overlay_dispatch(VN_OVERLAY_OP_COPY_ADPCM_VOICE, (uint16_t)(int16_t)voice_index, 0u, 0u);
#else
    (void)voice_index;
    return 0u;
#endif
}

static uint8_t VN_RESIDENT_CODE adpcm_playback_active(void)
{
#if defined(__PCE_CD__)
    return adpcm_play_active;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 wait_adpcm_transfer_ready(void)
{
#if defined(__PCE_CD__)
    uint16_t guard = 65535u;
    uint8_t poll_sub = 0u;
    while (guard && (pce_cdb_adpcm_status() & ADPCM_BUSY))
    {
        guard--;
        /* ADPCM reset/read busy waits can hold the timer in System Card
           ownership with no cd_transfer_wait() calls. Fold a measured slice
           of this span into real credit and tick PSG sparsely here, but do
           not feed service_adpcm_playback(): this same wait is used by
           stop/reset paths while ADPCM bookkeeping is intentionally being
           torn down. An 8-bit sub-counter (rather than masking the 16-bit
           guard) keeps this poll-rate check a single decrement+branch. */
        poll_sub--;
        if (!poll_sub)
        {
            time_blocked_poll_psg_only(1u);
        }
    }
    return guard ? 1u : 0u;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 wait_adpcm_cd_transfer_ready(uint8_t sectors)
{
#if defined(__PCE_CD__)
    if (!sectors) sectors = 1u;
    while (sectors--)
    {
        cd_transfer_wait();
    }
    return wait_adpcm_transfer_ready();
#else
    (void)sectors;
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

static uint8_t VN_BANKED_CODE2 load_adpcm_voice(signed int voice_index, uint8_t allow_stop_playback, uint8_t allow_stream_asset, uint8_t chunk_sectors)
{
#if defined(__PCE_CD__)
    uint8_t loaded = 0u;
    uint8_t same_loaded;
    uint8_t stopped_playback = 0u;
    uint8_t cd_read_count = 0u;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (voice_index < 0) return 0u;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (adpcm_voice_snapshot.stream && !allow_stream_asset && !adpcm_voice_fits_buffer()) return 0u;
    same_loaded = (uint8_t)(loaded_adpcm_valid && loaded_adpcm_index == (uint16_t)voice_index);
    if (adpcm_playback_active())
    {
        if (!allow_stop_playback) return same_loaded ? 1u : 0u;
        if (adpcm_stream_active)
        {
            vn_cd_bios_irq_open();
            pce_cdb_adpcm_stop();
            (void)wait_adpcm_transfer_ready();
        }
        else
        {
            stop_buffered_adpcm_playback_direct();
        }
        adpcm_play_active = 0u;
        adpcm_play_frames_remaining = 0u;
        adpcm_stream_active = 0u;
        adpcm_stream_looping = 0u;
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
    vn_cd_bios_irq_open();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    if (adpcm_voice_snapshot.has_cd)
    {
        pce_sector_t sector = {0};
        const uint16_t sector_count = adpcm_voice_snapshot.cd_sector_count;
        const uint8_t read_count = sector_count > 255u ? 255u : (uint8_t)sector_count;
        uint8_t remaining = read_count;
        unsigned int adpcm_address = adpcm_voice_snapshot.adpcm_address;
        prepare_cd_data_access();
        cd_sector_from_ref(&sector, &adpcm_voice_snapshot.cd_sector);
        if (chunk_sectors)
        {
            loaded = 1u;
            while (remaining)
            {
                uint8_t chunk = remaining;
                if (chunk > chunk_sectors) chunk = chunk_sectors;
                loaded = (uint8_t)(!pce_cdb_adpcm_read_from_cd(sector, chunk, adpcm_address));
                if (!loaded) break;
                if (!wait_adpcm_cd_transfer_ready(chunk))
                {
                    loaded = 0u;
                    break;
                }
                remaining = (uint8_t)(remaining - chunk);
                adpcm_address = (unsigned int)(adpcm_address + ((unsigned int)chunk << 11));
                while (chunk--) cd_sector_advance(&sector);
            }
        }
        else
        {
            cd_read_count = read_count;
            loaded = (uint8_t)(!pce_cdb_adpcm_read_from_cd(sector, read_count, adpcm_voice_snapshot.adpcm_address));
        }
    }
    else
    {
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
    if (adpcm_voice_snapshot.has_cd)
    {
        if (!chunk_sectors && !wait_adpcm_cd_transfer_ready(cd_read_count))
        {
            map_resident_data();
            resume_cdda_after_cd_data_access();
            sync_cd_external_irq_after_bios_call();
            restore_display_after_adpcm(restore_display);
            return 0u;
        }
    }
    else if (!wait_adpcm_transfer_ready())
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
    (void)allow_stream_asset;
    (void)chunk_sectors;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 stream_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    pce_sector_t sector = {0};
    pce_sector_t length = {0};
    uint8_t divider;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_snapshot.stream || !adpcm_voice_snapshot.has_cd || !adpcm_voice_snapshot.cd_sector_count || !adpcm_voice_snapshot.data_size) return 0u;
    if (adpcm_playback_active())
    {
        if (adpcm_stream_active)
        {
            vn_cd_bios_irq_open();
            pce_cdb_adpcm_stop();
            (void)wait_adpcm_transfer_ready();
        }
        else
        {
            stop_buffered_adpcm_playback_direct();
        }
        adpcm_play_active = 0u;
        adpcm_play_frames_remaining = 0u;
    }
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    loaded_adpcm_valid = 0u;
    prepare_cd_data_access();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    cd_sector_from_ref(&sector, &adpcm_voice_snapshot.cd_sector);
    cd_sector_end_from_count(&length, &sector, adpcm_voice_snapshot.cd_sector_count);
    divider = VN_ADPCM_SNAPSHOT_DIVIDER();
    adpcm_stream_active = 1u;
    adpcm_stream_irq_open = 1u;
    set_vdc_control(vdc_control_current);
    vn_map_io_page();
    (void)*IO_VDC_STATUS;
    pce_irq_enable(IRQ_VDC);
    if (pce_cdb_adpcm_stream(sector, length, divider))
    {
        adpcm_stream_active = 0u;
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    cancel_cdda_after_cd_data_conflict();
    adpcm_play_active = 1u;
    adpcm_play_frames_remaining = VN_ADPCM_SNAPSHOT_PLAY_FRAMES();
    adpcm_stream_active = 1u;
    adpcm_stream_looping = adpcm_voice_snapshot.loop ? 1u : 0u;
    adpcm_stream_index = (uint16_t)voice_index;
    pad_edge_reset_pending = 1u;
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 play_adpcm_buffered_voice(signed int voice_index, uint8_t restore_display, uint8_t allow_stream_asset, uint8_t chunk_sectors)
{
#if defined(__PCE_CD__)
    uint8_t divider;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_fits_buffer()) return 0u;
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    if (!load_adpcm_voice(voice_index, 1u, allow_stream_asset, chunk_sectors))
    {
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    divider = VN_ADPCM_SNAPSHOT_DIVIDER();
    start_buffered_adpcm_playback_direct(adpcm_voice_snapshot.adpcm_address, VN_ADPCM_BUFFERED_HARDWARE_LENGTH, divider);
    map_resident_data();
    /*
     * Buffered playback does not need BIOS status polling. The direct start
     * helper gives ADPCM a long repeat counter, and the VN frame counter clears
     * or restarts PLAY at the intended end before the hardware half/end IRQs.
     */
    adpcm_play_active = 1u;
    adpcm_play_frames_remaining = VN_ADPCM_BUFFERED_PLAY_FRAMES();
    adpcm_stream_active = 0u;
    adpcm_stream_looping = adpcm_voice_snapshot.loop ? 1u : 0u;
    adpcm_stream_index = (uint16_t)voice_index;
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
    (void)allow_stream_asset;
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
    return play_adpcm_buffered_voice(voice_index, restore_display, 0u, VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS);
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
    if (adpcm_voice_snapshot.stream)
    {
        /* A stream:true asset is streamed from CD ONLY when it is too large to fit
           the ADPCM RAM buffer. True CD streaming (pce_cdb_adpcm_stream / AD_STRM)
           relies on the asynchronous BIOS external IRQ to keep feeding the ADPCM
           ring buffer from CD, which conflicts with this runtime owning VBlank/VDC
           directly via status polling and no VBlank IRQ. The resulting buffer underruns
           produce noise, the drive reads on into the next asset's sectors (a
           "different voice" starting mid-playback), and the CD engine eventually
           hangs. Voices that fit the buffer use the hardened buffered path, which
           loads once and plays from ADPCM RAM with no ongoing CD IRQ. */
        if (adpcm_voice_fits_buffer())
        {
            (void)play_adpcm_buffered_voice(voice_index, restore_display, 1u, VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS);
            return;
        }
        /*
         * True CD ADPCM streaming leaves the System Card external IRQ open for
         * the whole voice. Starting that path while the VN display is live, or
         * while the cooperative PSG sequencer is playing, lets the BIOS IRQ path
         * rewrite VDC R5 (blanking BG/sprites) and starves PSG ticks. Long
         * voiced-message assets must be split/lowered until they fit the buffered
         * ADPCM RAM path instead of risking display/audio corruption.
         */
        if (!pending_display_enable || psg_active)
        {
            if (adpcm_playback_active()) stop_adpcm_voice();
            return;
        }
        if (adpcm_voice_snapshot.has_cd && adpcm_voice_snapshot.cd_sector_count)
        {
            (void)stream_adpcm_voice(voice_index);
            return;
        }
        return;
    }
    (void)play_adpcm_buffered_voice(voice_index, restore_display, 1u, VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS);
#else
    (void)voice_index;
#endif
}

static void VN_BANKED_CODE stop_adpcm_voice(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (adpcm_stream_active)
    {
        vn_cd_bios_irq_open();
        pce_cdb_adpcm_stop();
        (void)wait_adpcm_transfer_ready();
        pce_cdb_adpcm_reset();
        (void)wait_adpcm_transfer_ready();
    }
    else
    {
        stop_buffered_adpcm_playback_direct();
    }
    loaded_adpcm_valid = 0u;
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
#endif
}

static void VN_BANKED_CODE2 service_adpcm_playback(void)
{
#if defined(__PCE_CD__)
    if (!adpcm_play_active) return;
    if (!adpcm_play_frames_remaining) return;
    if (!adpcm_stream_active)
    {
        vn_map_io_page();
        if (*IO_PCD_STATUS & VN_PCD_IRQ_STATUS_ADPCM_END)
        {
            adpcm_play_frames_remaining = 1u;
        }
    }
    adpcm_play_frames_remaining--;
    if (adpcm_play_frames_remaining) return;
    if (adpcm_stream_active && adpcm_stream_looping)
    {
        (void)stream_adpcm_voice((signed int)adpcm_stream_index);
        return;
    }
    if (!adpcm_stream_active && adpcm_stream_looping)
    {
        start_buffered_adpcm_playback_direct(adpcm_voice_snapshot.adpcm_address, VN_ADPCM_BUFFERED_HARDWARE_LENGTH, VN_ADPCM_SNAPSHOT_DIVIDER());
        adpcm_play_frames_remaining = VN_ADPCM_BUFFERED_PLAY_FRAMES();
        sync_cd_external_irq_after_bios_call();
        mask_buffered_adpcm_completion_irq();
        return;
    }
    /*
     * Do not poll ADPCM status or call the BIOS stop/reset path at natural
     * message completion. Buffered direct playback uses a long hardware repeat
     * counter, so its runtime end is a direct PLAY clear before ADPCM half/end
     * IRQs; true streams either loop above or close the runtime bookkeeping here.
     */
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    if (!adpcm_stream_active)
    {
        stop_buffered_adpcm_playback_direct();
    }
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    sync_cd_external_irq_after_bios_call();
#endif
}

