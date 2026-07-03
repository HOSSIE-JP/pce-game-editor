/* PHASE_A_SPLIT:BEGIN vn_engine_time.c — real-frame credit bookkeeping
   (vn_record_vblank_frames / vn_consume_vblank_credit), the PSG synthetic
   credit, the experimental TIMER IRQ credit driver (own/release/ISR) and the
   cooperative service entry points (service_psg_* / service_adpcm_during_
   blocking_frames / init_psg_service). Moved verbatim from pce_vn_runtime.c
   (Phase A module split). PHASE_A_SPLIT:END */
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
/* Cooperative TIMER ownership. vn_timer_owned gates the reload write so the
   once-per-frame re-own cannot reset the counter phase (a reload rewrite each
   VBlank would starve TIQ forever); the $20F5/IDR bits are re-asserted on
   every own() because quiet paths and the System Card clear them behind the
   flag's back. True ADPCM streaming leaves all CD IRQ timing to the BIOS. */
static void VN_BANKED_CODE vn_psg_timer_own(void)
{
    if (adpcm_stream_active) return;
    if (!vn_timer_owned)
    {
        pce_timer_set(PCE_FREQ_TO_TIMER(VN_PSG_TIMER_HZ));
        pce_timer_enable();
        vn_timer_owned = 1u;
    }
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_TIMER);
    pce_irq_enable(IRQ_TIMER);
}

static void VN_BANKED_CODE vn_psg_timer_release(void)
{
    if (!vn_timer_owned) return;
    /* Order matters: mask TIQ delivery BEFORE clearing the $20F5 dispatch
       bit. A TIQ that fires while the bit is clear falls into the System
       Card's default path, which never acks it, and the CPU parks in the
       BIOS IRQ dispatcher forever. */
    pce_irq_disable(IRQ_TIMER);
    pce_timer_disable();
    pce_cdb_irq_disable(PCE_CDB_MASK_IRQ_TIMER);
    vn_timer_owned = 0u;
}

/* Estimated PSG-only credit for the blocking BIOS sector read the timer cannot
   see (~0.8 frame per 2048-byte sector at 1x). It is separate from
   vn_vblank_credit so ADPCM/message timing never consumes synthetic time. */
#define VN_ADD_ESTIMATED_FRAME() do {     if (vn_psg_synthetic_credit < VN_VBLANK_CREDIT_MAX) vn_psg_synthetic_credit++; } while (0)
#endif

static void VN_RESIDENT_CODE service_psg_ticks(uint8_t frames, uint8_t restore_visual_cache)
{
#if defined(__PCE_CD__)
    uint8_t slot4_bank;
    if (!frames) return;
    if (!psg_active || !psg_current) return;
    if (adpcm_play_active && frames > VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM) frames = VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM;
    else if (frames > VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME) frames = VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME;
    /* Save/restore the caller's slot4 bank instead of forcing bank130 (or the
       visual cache) back in. This service is reached from bank130 code, from
       bank121 visual-cache impls AND from the bank133 overlay (e.g.
       refresh_scene_sprite_patterns_impl -> upload_sprite_pattern_words). An
       unconditional bank130 restore unmapped the overlay caller, so its return
       executed bank130 bytes at the overlay address and crashed into the I/O
       page whenever PSG/ADPCM was active during a sprite refresh. */
    slot4_bank = vn_slot4_current_bank();
    pce_ram_bank130_map();
    while (frames--)
    {
        tick_psg();
    }
    /* Large PSG patterns are read from bank134/135 through MPR6. Most blocking
       CD/BG loaders resume by reading bank132 scratch or metadata, so leave that
       slot in the VN data state after the cooperative audio tick. */
    map_vn_data();
    vn_slot4_map_bank(slot4_bank);
    (void)restore_visual_cache;
#else
    (void)frames;
    (void)restore_visual_cache;
#endif
}

#if defined(__PCE_CD__) && !VN_PSG_TIMER_IRQ_DRIVER
static void VN_RESIDENT_CODE vn_record_vblank_frames(uint8_t frames)
{
    uint8_t room;
    if (!frames) return;
    room = (uint8_t)(VN_VBLANK_CREDIT_MAX - vn_vblank_credit);
    if (frames > room) vn_vblank_credit = VN_VBLANK_CREDIT_MAX;
    else vn_vblank_credit = (uint8_t)(vn_vblank_credit + frames);
}
#endif

#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
/* TIQ handler, reached through the System Card TIMER soft vector installed by
   pce_cdb_irq_set(PCE_CDB_ID_IRQ_TIMER, ...). Credit-only by contract: acks
   the timer IRQ and bumps vn_vblank_credit (bounded), nothing else. It MUST
   NOT touch PSG registers, MPR2-7, the VDC, or call banked helpers -- the
   earlier IRQ-driven PSG attempt corrupted sprites/BG because its handler did
   real work while main-thread VDC/bank sequences were in flight. A/X/Y and
   MPR0 are saved around the C credit bump so no main-thread state leaks. */
static void VN_BANKED_CODE vn_psg_timer_irq_handler(void)
{
    /* The System Card dispatches the TIMER soft vector with JMP, not JSR:
       the hook saves registers itself and returns with RTI. An RTS return
       here unbalances the stack and crashes into wild execution. */
    __asm__ volatile(
        "pha\n\t"
        "phx\n\t"
        "phy\n\t"
        "tma #$01\n\t"
        "pha\n\t"
        "lda #$ff\n\t"
        "tam #$01\n\t"
        "sta $1403" ::: "memory");
    if (vn_vblank_credit < VN_VBLANK_CREDIT_MAX) vn_vblank_credit++;
    __asm__ volatile(
        "pla\n\t"
        "tam #$01\n\t"
        "ply\n\t"
        "plx\n\t"
        "pla\n\t"
        "rti" ::: "memory");
}
#endif

static uint8_t VN_RESIDENT_CODE vn_consume_vblank_credit(void)
{
#if defined(__PCE_CD__)
    uint8_t frames;
#if VN_PSG_TIMER_IRQ_DRIVER
    /* Mask TIQ across the read-modify-write so an ISR increment cannot land
       between the load and the store. CPU-level SEI is not used here because
       callers may already hold vn_vdc_irq_lock(). Only while owned: during
       BIOS-call windows the timer belongs to the System Card and the ISR
       cannot fire, so the plain RMW is already atomic. */
    const uint8_t owned = vn_timer_owned;
    if (owned) pce_irq_disable(IRQ_TIMER);
#endif
    frames = vn_vblank_credit;
    if (frames > VN_VBLANK_CREDIT_SERVICE_LIMIT) frames = VN_VBLANK_CREDIT_SERVICE_LIMIT;
    vn_vblank_credit = (uint8_t)(vn_vblank_credit - frames);
#if VN_PSG_TIMER_IRQ_DRIVER
    if (owned) pce_irq_enable(IRQ_TIMER);
#endif
    return frames;
#else
    return 1u;
#endif
}

static uint8_t VN_RESIDENT_CODE psg_vblank_elapsed(void)
{
#if defined(__PCE_CD__)
#if VN_PSG_TIMER_IRQ_DRIVER
    /* Timer credits already measure elapsed frames; no VDC status read here,
       so the VBlank latch is left for vn_wait_next_vblank() alone. */
    return vn_consume_vblank_credit();
#else
    vn_map_io_page();
    const uint8_t in_vblank = (uint8_t)((*IO_VDC_STATUS & VDC_FLAG_VBLANK) ? 1u : 0u);
    if (!in_vblank)
    {
        psg_vblank_seen = 0u;
    }
    else if (!psg_vblank_seen)
    {
        psg_vblank_seen = 1u;
        vn_record_vblank_frames(1u);
    }
    return vn_consume_vblank_credit();
#endif
#else
    return 1u;
#endif
}

#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
static uint8_t VN_RESIDENT_CODE vn_consume_psg_synthetic_credit(void)
{
    uint8_t frames = vn_psg_synthetic_credit;
    const uint8_t limit = adpcm_play_active ? VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM : VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME;
    if (frames > limit) frames = limit;
    vn_psg_synthetic_credit = (uint8_t)(vn_psg_synthetic_credit - frames);
    return frames;
}
#endif

static void VN_RESIDENT_CODE service_psg_compensation_ticks(uint8_t frames, uint8_t restore_visual_cache)
{
#if defined(__PCE_CD__)
#if VN_PSG_TIMER_IRQ_DRIVER
    /* TIMER fallback uses synthetic CD estimates for PSG only. Do not call
       the combined blocking audio service here: that would consume real-frame
       credit and advance ADPCM/message timing from a blind CD estimate. */
    (void)frames;
    frames = vn_consume_psg_synthetic_credit();
#endif
    if (!psg_active || !psg_current) return;
    service_psg_ticks(frames, restore_visual_cache);
#else
    service_psg_ticks(frames, restore_visual_cache);
#endif
}

static void VN_RESIDENT_CODE service_adpcm_during_blocking_frames(uint8_t frames, uint8_t restore_visual_cache)
{
#if defined(__PCE_CD__)
    uint8_t slot4_bank;
    if (!frames) return;
    if (!adpcm_play_active) return;
    /* Same slot4 save/restore contract as service_psg_ticks: callers may be
       executing from the bank133 overlay or the bank121 visual cache. */
    slot4_bank = vn_slot4_current_bank();
    pce_ram_bank130_map();
    while (frames--)
    {
        service_adpcm_playback();
    }
    vn_slot4_map_bank(slot4_bank);
    (void)restore_visual_cache;
#else
    (void)frames;
    (void)restore_visual_cache;
#endif
}

static void VN_RESIDENT_CODE service_psg_during_blocking_work(void)
{
#if defined(__PCE_CD__)
    const uint8_t frames = psg_vblank_elapsed();
    service_adpcm_during_blocking_frames(frames, 0u);
    if (!psg_active || !psg_current) return;
    service_psg_ticks(frames, 0u);
#else
    service_psg_ticks(1u, 0u);
#endif
}

static void VN_RESIDENT_CODE service_psg_during_blocking_frames(uint8_t frames)
{
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
    /* The TIQ handler is the only credit source: explicitly reported frames
       would double-count time the timer has already recorded. */
    (void)frames;
    frames = vn_consume_vblank_credit();
#elif defined(__PCE_CD__)
    vn_record_vblank_frames(frames);
    frames = vn_consume_vblank_credit();
#endif
    service_adpcm_during_blocking_frames(frames, 0u);
    if (!psg_active || !psg_current) return;
    service_psg_ticks(frames, 0u);
}

static void VN_RESIDENT_CODE service_psg_during_visual_cache_work(void)
{
#if defined(__PCE_CD__)
    const uint8_t frames = psg_vblank_elapsed();
    service_adpcm_during_blocking_frames(frames, 1u);
    if (!psg_active || !psg_current) return;
    service_psg_ticks(frames, 1u);
#else
    service_psg_ticks(1u, 1u);
#endif
}

static void VN_RESIDENT_CODE service_psg_during_visual_cache_frames(uint8_t frames)
{
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
    (void)frames;
    frames = vn_consume_vblank_credit();
#elif defined(__PCE_CD__)
    vn_record_vblank_frames(frames);
    frames = vn_consume_vblank_credit();
#endif
    service_adpcm_during_blocking_frames(frames, 1u);
    if (!psg_active || !psg_current) return;
    service_psg_ticks(frames, 1u);
}

static void VN_BANKED_CODE2 init_psg_service(void)
{
#if defined(__PCE_CD__)
    psg_vblank_seen = 0u;
    vn_vblank_credit = 0u;
    vn_psg_synthetic_credit = 0u;
#if VN_PSG_TIMER_IRQ_DRIVER
    /* Install the credit-only TIQ hook and take first ownership of the audio
       timer. Ownership is released before every CD/ADPCM/CD-DA BIOS helper
       (vn_cd_bios_irq_open) because the System Card reprograms the timer for
       its own CD pacing, and re-acquired by quiet_cd_unit_irqs() once per
       frame / after each helper. */
    pce_cdb_irq_set(PCE_CDB_ID_IRQ_TIMER, vn_psg_timer_irq_handler);
    vn_psg_timer_own();
#endif
#endif
}

