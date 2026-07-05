/* PHASE_A_SPLIT:BEGIN vn_port_cdda.c — CD-DA domain: resume-sector math
   (cdda_sector_from_remaining(_impl)), the CD-DA metadata accessor and
   play/service/stop for CD-DA tracks. The pause/deferred-resume bracket
   lives in vn_engine_bus.c. Moved verbatim from pce_vn_runtime.c (Phase A
   module split). PHASE_A_SPLIT:END */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
static void VN_OVERLAY_CODE cdda_sector_from_remaining_impl(const pce_editor_cdda_asset_t *cdda)
{
    unsigned long start = 0ul;
    unsigned int elapsed_frames = 0u;
    unsigned long sector_offset = 0ul;
    unsigned long value;
    if (cdda)
    {
        start = (unsigned long)cdda->start_sector.lo
            | ((unsigned long)cdda->start_sector.md << 8)
            | ((unsigned long)cdda->start_sector.hi << 16);
        if (cdda->play_frames && cdda_frames_remaining < cdda->play_frames)
        {
            elapsed_frames = (unsigned int)(cdda->play_frames - cdda_frames_remaining);
            sector_offset = (unsigned long)elapsed_frames + ((unsigned long)elapsed_frames >> 2);
        }
    }
    value = start + sector_offset;
    cdda_resume_start.lo = (uint8_t)(value & 0xfful);
    cdda_resume_start.md = (uint8_t)((value >> 8) & 0xfful);
    cdda_resume_start.hi = (uint8_t)((value >> 16) & 0xfful);
}

/* Resident wrapper: pure arithmetic on always-mapped globals (cdda points to a
   resident snapshot), so it dispatches to the overlay like the scene-pack readers. */
static void VN_BANKED_CODE cdda_sector_from_remaining(const pce_editor_cdda_asset_t *cdda)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch(VN_OVERLAY_OP_CDDA_SECTOR, (uint16_t)(uintptr_t)cdda, 0u, 0u);
#else
    cdda_sector_from_remaining_impl(cdda);
#endif
}

#endif /* PHASE_A_SPLIT */
static pce_editor_cdda_asset_t g_cdda_cache;
static uint16_t g_cdda_cache_key;

static const pce_editor_cdda_asset_t *VN_BANKED_CODE2 vn_get_cdda_asset(uint16_t idx)
{
    const uint8_t *p;
    const uint16_t key = (uint16_t)(idx + 1u);
    if (g_cdda_cache_key == key) return &g_cdda_cache;
    vn_read_meta_sector(&pce_editor_cdda_meta.sector, (uint8_t)(idx / VN_META_CDDA_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_CDDA_PER_SECTOR) * PCE_EDITOR_META_CDDA_SLOT)];
    g_cdda_cache.track = p[PCE_EDITOR_META_CDDA_TRACK];
    g_cdda_cache.loop = p[PCE_EDITOR_META_CDDA_LOOP];
    g_cdda_cache.start_sector.lo = p[PCE_EDITOR_META_CDDA_START_SECTOR];
    g_cdda_cache.start_sector.md = p[PCE_EDITOR_META_CDDA_START_SECTOR + 1u];
    g_cdda_cache.start_sector.hi = p[PCE_EDITOR_META_CDDA_START_SECTOR + 2u];
    g_cdda_cache.end_sector.lo = p[PCE_EDITOR_META_CDDA_END_SECTOR];
    g_cdda_cache.end_sector.md = p[PCE_EDITOR_META_CDDA_END_SECTOR + 1u];
    g_cdda_cache.end_sector.hi = p[PCE_EDITOR_META_CDDA_END_SECTOR + 2u];
    g_cdda_cache.end_time.frame = p[PCE_EDITOR_META_CDDA_END_TIME];
    g_cdda_cache.end_time.second = p[PCE_EDITOR_META_CDDA_END_TIME + 1u];
    g_cdda_cache.end_time.minute = p[PCE_EDITOR_META_CDDA_END_TIME + 2u];
    g_cdda_cache.play_frames = (unsigned int)p[PCE_EDITOR_META_CDDA_PLAY_FRAMES]
        | ((unsigned int)p[PCE_EDITOR_META_CDDA_PLAY_FRAMES + 1u] << 8);
    g_cdda_cache_key = key;
    return &g_cdda_cache;
}
static void VN_BANKED_CODE2 play_cdda_track(const pce_editor_cdda_asset_t *cdda)
{
#if defined(__PCE_CD__)
    pce_sector_t start = {0};
    pce_sector_t end = {0};
    uint8_t end_type = PCE_CDB_LOCATION_TYPE_UNTIL_END;
    uint8_t track;
    uint8_t loop;
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (!cdda) return;
    vn_cd_bios_irq_open();
    track = cdda->track;
    loop = cdda->loop;
    const uint8_t mode = PCE_CDB_CDDA_PLAY_ONE_SHOT;
    if (track < 2u)
    {
        sync_cd_external_irq_after_bios_call();
        return;
    }
    if (cdda_active)
    {
        (void)pce_cdb_cdda_pause();
        cdda_active = 0u;
    }
    start.lo = cdda->start_sector.lo;
    start.md = cdda->start_sector.md;
    start.hi = cdda->start_sector.hi;
    cdda_has_frame_limit = cdda->play_frames ? 1u : 0u;
    cdda_frames_remaining = cdda->play_frames;
    cdda_looping = loop ? 1u : 0u;
    cdda_track = track;
    cdda_current = cdda;
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, start, end_type, end, mode);
    cdda_active = 1u;
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_cdda);
#else
    (void)cdda;
#endif
}

static void VN_VISUAL_CACHE_CODE service_cdda_playback_impl(void)
{
#if defined(__PCE_CD__)
    if (!cdda_active || !cdda_has_frame_limit || !cdda_current) return;
    if (cdda_frames_remaining) cdda_frames_remaining--;
    if (cdda_frames_remaining) return;
    {
        if (cdda_looping)
        {
            pce_sector_t start = {0};
            pce_sector_t end = {0};
            const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
            start.lo = cdda_current->start_sector.lo;
            start.md = cdda_current->start_sector.md;
            start.hi = cdda_current->start_sector.hi;
            cdda_frames_remaining = cdda_current->play_frames;
            vn_cd_bios_irq_open();
            (void)pce_cdb_cdda_pause();
            (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, start, PCE_CDB_LOCATION_TYPE_UNTIL_END, end, PCE_CDB_CDDA_PLAY_ONE_SHOT);
            cdda_active = 1u;
            sync_cd_external_irq_after_bios_call();
            restore_video_after_cdb_call(restore_display_after_cdda);
        }
        else
        {
            const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
            vn_cd_bios_irq_open();
            (void)pce_cdb_cdda_pause();
            cdda_active = 0u;
            cdda_has_frame_limit = 0u;
            cdda_looping = 0u;
            cdda_track = 0u;
            cdda_frames_remaining = 0u;
            cdda_current = (const pce_editor_cdda_asset_t *)0;
            sync_cd_external_irq_after_bios_call();
            restore_video_after_cdb_call(restore_display_after_pause);
        }
    }
#endif
}

static void VN_BANKED_CODE service_cdda_playback(void)
{
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
    if (!vn_visual_cache_code_loaded) load_visual_cache_code();
    if (!vn_visual_cache_code_loaded) return;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_SERVICE_CDDA);
#elif defined(__PCE_CD__)
    service_cdda_playback_impl();
#endif
}

static void VN_BANKED_CODE2 stop_cdda_track(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
    vn_cd_bios_irq_open();
    (void)pce_cdb_cdda_pause();
    cdda_active = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_pause);
#endif
}

