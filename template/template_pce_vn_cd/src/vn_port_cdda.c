/* PHASE_A_SPLIT:BEGIN vn_port_cdda.c — CD-DA domain: lightweight CD-DA
   metadata read and play/stop helpers. The pause/deferred-resume bracket lives
   in vn_engine_bus.c. PHASE_A_SPLIT:END */

static void VN_VISUAL_CACHE_CODE cdda_command_impl(signed int asset_index)
{
#if defined(__PCE_CD__)
    const uint8_t *p;
    pce_sector_t start = {0};
    pce_sector_t end = {0};
    uint8_t track;
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (asset_index < 0)
    {
        if (!(cdda_state & VN_CDDA_STATE_ACTIVE)) return;
        vn_cd_bios_irq_open();
        (void)pce_cdb_cdda_pause();
        cdda_state = 0u;
        sync_cd_external_irq_after_bios_call();
        restore_video_after_cdb_call(restore_display_after_cdda);
        return;
    }
    {
    uint16_t idx = (uint16_t)asset_index;
    if (idx >= pce_editor_cdda_asset_count) return;
    vn_read_meta_sector(&pce_editor_cdda_meta.sector, (uint8_t)(idx / VN_META_CDDA_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_CDDA_PER_SECTOR) * PCE_EDITOR_META_CDDA_SLOT)];
    track = p[PCE_EDITOR_META_CDDA_TRACK];
    if (track < 2u) return;
    start.lo = p[PCE_EDITOR_META_CDDA_START_SECTOR];
    start.md = p[PCE_EDITOR_META_CDDA_START_SECTOR + 1u];
    start.hi = p[PCE_EDITOR_META_CDDA_START_SECTOR + 2u];
#if VN_CDDA_RESUME_AFTER_DATA_READ
    map_vn_data();
    cdda_resume_start = start;
#endif
    if (p[PCE_EDITOR_META_CDDA_LOOP]) cdda_state |= VN_CDDA_STATE_REPEAT;
    else cdda_state &= (uint8_t)~VN_CDDA_STATE_REPEAT;
    vn_cd_bios_irq_open();
    if (cdda_state & VN_CDDA_STATE_ACTIVE)
    {
        (void)pce_cdb_cdda_pause();
        cdda_state &= (uint8_t)~VN_CDDA_STATE_ACTIVE;
    }
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, start, PCE_CDB_LOCATION_TYPE_UNTIL_END, end, VN_CDDA_PLAY_MODE());
    cdda_state = (uint8_t)((cdda_state | VN_CDDA_STATE_ACTIVE) & (uint8_t)~VN_CDDA_STATE_RESUME_PENDING);
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_cdda);
    }
#else
    (void)asset_index;
#endif
}

static void VN_BANKED_CODE cdda_audio_command(signed int asset_index)
{
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
    vn_visual_cache_arg_asset = (uint16_t)(int16_t)asset_index;
    if (!vn_visual_cache_code_loaded) load_visual_cache_code();
    if (!vn_visual_cache_code_loaded) return;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_CDDA_COMMAND);
#elif defined(__PCE_CD__)
    cdda_command_impl(asset_index);
#else
    (void)asset_index;
#endif
}
