/* PHASE_A_SPLIT:BEGIN vn_port_cdda.c — CD-DA domain: lightweight CD-DA
   metadata read and play/stop helpers. The pause/deferred-resume bracket lives
   in vn_engine_bus.c. PHASE_A_SPLIT:END */

static void VN_OVERLAY_CODE cdda_command_impl(signed int asset_index)
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
    vn_read_meta_sector(&pce_editor_cdda_meta.sector, (uint16_t)(idx / VN_META_CDDA_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_CDDA_PER_SECTOR) * PCE_EDITOR_META_CDDA_SLOT)];
    track = p[PCE_EDITOR_META_CDDA_TRACK];
    if (track < 2u) return;
    start.lo = p[PCE_EDITOR_META_CDDA_START_SECTOR];
    start.md = p[PCE_EDITOR_META_CDDA_START_SECTOR + 1u];
    start.hi = p[PCE_EDITOR_META_CDDA_START_SECTOR + 2u];
    end.lo = p[PCE_EDITOR_META_CDDA_END_SECTOR];
    end.md = p[PCE_EDITOR_META_CDDA_END_SECTOR + 1u];
    end.hi = p[PCE_EDITOR_META_CDDA_END_SECTOR + 2u];
#if VN_CDDA_RESUME_AFTER_DATA_READ
    map_vn_data();
    cdda_resume_start = start;
    cdda_resume_end = end;
#endif
    if (p[PCE_EDITOR_META_CDDA_LOOP]) cdda_state |= VN_CDDA_STATE_REPEAT;
    else cdda_state &= (uint8_t)~VN_CDDA_STATE_REPEAT;
    vn_cd_bios_irq_open();
    if (cdda_state & VN_CDDA_STATE_ACTIVE)
    {
        (void)pce_cdb_cdda_pause();
        cdda_state &= (uint8_t)~VN_CDDA_STATE_ACTIVE;
    }
    /* The generated end is the next track's first sector (or lead-out), so BIOS
       repeat is constrained to this asset instead of running to disc end. */
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, start, PCE_CDB_LOCATION_TYPE_SECTOR, end, VN_CDDA_PLAY_MODE());
    cdda_state = (uint8_t)((cdda_state | VN_CDDA_STATE_ACTIVE) & (uint8_t)~VN_CDDA_STATE_RESUME_PENDING);
    sync_cd_external_irq_after_bios_call();
    /* CD-DA play leaves VDC/VCE state intact.  A full resolution restore here
       would rewrite VCE and R9-R14 in the visible scan and shear one frame. */
    }
#else
    (void)asset_index;
#endif
}

static void VN_BANKED_CODE cdda_audio_command(signed int asset_index)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch(VN_OVERLAY_OP_CDDA_COMMAND, (uint16_t)(int16_t)asset_index, 0u, 0u);
#else
    (void)asset_index;
#endif
}
