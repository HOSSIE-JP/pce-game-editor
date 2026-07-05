/* PHASE_B:BEGIN vn_engine_time.c — single real-frame credit source, TIMER IRQ
   promoted to primary, blocked-window measured credit (time_blocked_poll),
   and the two service entry points (engine_service / engine_service_blocking)
   that replace the old 5-variant/6-function service topology. PHASE_B:END */
/* PHASE_C: psg_core is now state-driven (vn_psg_core.c: psg_advance/
   psg_commit/psg_mark_hw_dirty). engine_apply_credit() below calls
   psg_advance(frames) once (logical-state fast-forward, no MMIO) followed by
   a single psg_commit() (diff psg_logical vs psg_shadow, write only the
   channels that changed) instead of looping tick_psg() frames times through
   service_psg_ticks(). The old per-frame tick clamps
   (VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM / VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME)
   are gone: psg_advance() only touches logical state, so a multi-tick
   fast-forward cannot lose a note-off or corrupt hardware the way batching
   raw MMIO writes could. The credit cap (VN_VBLANK_CREDIT_MAX/_SERVICE_LIMIT)
   is the only remaining bound on staleness. */
#if defined(__PCE_CD__) && VN_TIME_SOURCE_TIMER
/* Cooperative TIMER ownership. vn_timer_owned gates the reload write so the
   once-per-frame re-own cannot reset the counter phase (a reload rewrite each
   VBlank would starve TIQ forever); the $20F5/IDR bits are re-asserted on
   every own() because quiet paths and the System Card clear them behind the
   flag's back. True ADPCM streaming leaves all CD IRQ timing to the BIOS.
   Callable ONLY from bus_bios_close() (engine_bus, after a BIOS helper
   returns) and engine_frame_end() (vn_main.c, once per frame) -- see the
   design doc engine_time §5.3 own/release protocol. */
/* bank128 (resident), not bank129: own()/release() are regular C calls (not
   IRQ-reached, unlike the ISR below), so they carry no residency constraint
   of their own; bank129/130 are both saturated after TIMER promotion, so this
   one small function is placed in the always-mapped resident bank to balance
   usage (design doc §8: exhaust VN_BANKED_CODE<->VN_BANKED_CODE2 and overlay
   retreat before resident growth -- both banks were already at capacity here,
   so a small, one-time resident addition is used instead of pushing either
   bank over 8192 bytes). */
static void VN_RESIDENT_CODE vn_psg_timer_own(void)
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

/* Resident (bank128), not bank129/130: bank128/129/130 are co-resident (MPR
   slot 2/3/4 simultaneously mapped), so the cross-bank call from
   vn_psg_timer_own() and the guarded pce_cdb_* wrappers (engine_bus, static
   inline) is transparent. Placed here to balance bank129/130 usage after
   TIMER promotion (own/release/ISR were previously dead code under
   VN_PSG_TIMER_IRQ_DRIVER=0); both banked banks were already at capacity, see
   the vn_psg_timer_own() comment for the same rationale. */
static void VN_RESIDENT_CODE vn_psg_timer_release(void)
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
#endif

/* PHASE_C: replaces the old service_psg_ticks() (which looped tick_psg()
   frames times, one MMIO write per changed step every tick). psg_advance()
   only touches psg_logical[] (no MMIO, no unconditional bank130/slot4 remap
   of its own -- it only reaches the overlay via psg_apply_step_row() when a
   step boundary is actually crossed), so this wrapper's slot4 save/restore
   exists solely to protect that occasional overlay dispatch; psg_commit()
   needs no slot4/MPR6 access at all and is called unconditionally after. */
static void VN_RESIDENT_CODE service_psg_advance(uint8_t frames, uint8_t restore_visual_cache)
{
#if defined(__PCE_CD__)
    uint8_t slot4_bank;
    if (!frames) return;
    if (!psg_active || !psg_current) return;
    /* Save/restore the caller's slot4 bank instead of forcing bank130 (or the
       visual cache) back in. This service is reached from bank130 code, from
       bank121 visual-cache impls AND from the bank133 overlay (e.g.
       refresh_scene_sprite_patterns_impl -> upload_sprite_pattern_words). An
       unconditional bank130 restore unmapped the overlay caller, so its return
       executed bank130 bytes at the overlay address and crashed into the I/O
       page whenever PSG/ADPCM was active during a sprite refresh. */
    slot4_bank = vn_slot4_current_bank();
    pce_ram_bank130_map();
    psg_advance(frames);
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

#if defined(__PCE_CD__)
/* Shared by both time sources: the fallback VBlank-edge sampler
   (time_vblank_edge_credit, VN_TIME_SOURCE_TIMER=0) and the BIOS-block-window
   sampler (time_blocked_poll, used regardless of time source) both record
   through here into the single vn_vblank_credit counter. */
static void VN_RESIDENT_CODE vn_record_vblank_frames(uint8_t frames)
{
    uint8_t room;
    if (!frames) return;
    room = (uint8_t)(VN_VBLANK_CREDIT_MAX - vn_vblank_credit);
    if (frames > room) vn_vblank_credit = VN_VBLANK_CREDIT_MAX;
    else vn_vblank_credit = (uint8_t)(vn_vblank_credit + frames);
}
#endif

#if defined(__PCE_CD__) && VN_TIME_SOURCE_TIMER
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
#if VN_TIME_SOURCE_TIMER
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
#if VN_TIME_SOURCE_TIMER
    if (owned) pce_irq_enable(IRQ_TIMER);
#endif
    return frames;
#else
    return 1u;
#endif
}

#if defined(__PCE_CD__) && !VN_TIME_SOURCE_TIMER
/* Fallback time source (VN_TIME_SOURCE_TIMER=0): cooperative VBlank edge
   sampler. Reads IO_VDC_STATUS directly (the runtime keeps IRQ_VDC masked so
   this poll never races the System Card's own VBlank handler) and records one
   credit per 0->1 edge. This is the pre-Phase-B behaviour, kept as the escape
   hatch called out in the design doc (engine_time §5.4) if the TIMER driver
   fails its Gate. */
static uint8_t VN_RESIDENT_CODE time_vblank_edge_credit(void)
{
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
}
#endif

/* BIOS block window measured credit (design doc engine_time §5.1 item 2).
   Called from inside the settle busy-wait that used to add a blind per-sector
   estimate instead. Counts observed VBlank 0->1 edges on IO_VDC_STATUS during
   the wait and records them as real credit -- while
   TIMER owns the tempo source this is a supplementary measurement for the
   window where the BIOS holds the timer (own() is not called mid-CD-
   sequence, see engine_time §5.3), not a second credit source: both paths
   feed the same vn_vblank_credit counter. */
static void VN_RESIDENT_CODE time_blocked_poll(uint16_t iterations)
{
#if defined(__PCE_CD__)
    uint8_t seen = 0u;
    uint16_t i;
    vn_map_io_page();
    for (i = 0u; i < iterations; i++)
    {
        const uint8_t in_vblank = (uint8_t)((*IO_VDC_STATUS & VDC_FLAG_VBLANK) ? 1u : 0u);
        if (!in_vblank)
        {
            seen = 0u;
        }
        else if (!seen)
        {
            seen = 1u;
            vn_record_vblank_frames(1u);
        }
    }
#else
    (void)iterations;
#endif
}

static void VN_OVERLAY_CODE engine_apply_psg_credit_impl(uint8_t frames, uint8_t blocking_work);
static void VN_RESIDENT_CODE engine_apply_psg_credit(uint8_t frames, uint8_t blocking_work);

/* PSG-only sparse tick for busy waits that must NOT feed ADPCM bookkeeping
   (wait_adpcm_transfer_ready's ADPCM reset/stop teardown spin -- that same
   wait runs while adpcm_play_active is being torn down, so it must not call
   service_adpcm_playback()). Factored into its own (bank128-resident) call so
   the bank130 call site stays a single JSR instead of inlining the poll +
   consume + tick sequence at every caller. */
static void VN_RESIDENT_CODE time_blocked_poll_psg_only(uint16_t iterations)
{
#if defined(__PCE_CD__)
    time_blocked_poll(iterations);
    engine_apply_psg_credit(vn_consume_vblank_credit(), 1u);
#else
    (void)iterations;
#endif
}

/* Thin resident entry to the overlay PSG credit helper. The diagnostic
   one-frame drip loop is cold blocking-work code, so keep its body out of
   bank128/129/130; ishi_no_ura with the switch enabled otherwise overflows
   bank129 by a few dozen bytes. */
static void VN_RESIDENT_CODE engine_apply_psg_credit(uint8_t frames, uint8_t blocking_work)
{
#if defined(__PCE_CD__)
    if (!psg_active) return;
    (void)vn_overlay_dispatch_locked(VN_OVERLAY_OP_APPLY_PSG_CREDIT, frames, blocking_work, 0u);
#else
    engine_apply_psg_credit_impl(frames, blocking_work);
#endif
}

/* Apply PSG credit separately from ADPCM so diagnostic builds can change only
   PSG catch-up policy during blocking work. The default path is unchanged:
   advance all credited frames logically, then commit once. */
static void VN_OVERLAY_CODE engine_apply_psg_credit_impl(uint8_t frames, uint8_t blocking_work)
{
#if defined(__PCE_CD__)
    if (!frames) return;
    if (!psg_current) return;
#if VN_PSG_COMMIT_EACH_CREDIT_DURING_BLOCKING
    if (blocking_work)
    {
        while (frames--)
        {
            service_psg_advance(1u, 0u);
            psg_commit();
        }
        return;
    }
#else
    (void)blocking_work;
#endif
    service_psg_advance(frames, 0u);
    psg_commit();
#else
    (void)frames;
    (void)blocking_work;
    service_psg_advance(1u, 0u);
    psg_commit();
#endif
}

/* Shared tail for engine_service()/engine_service_blocking(): advance ADPCM
   countdown then psg_core (state-driven, see vn_psg_core.c) by the given real
   credit. Factored out so the two entry points do not each inline their own
   copy of this dispatch. PHASE_C: psg_core is now psg_advance() (logical
   state only, called `frames` times worth of ticks) + a single psg_commit()
   (diff psg_logical vs psg_shadow, write only the changed registers) instead
   of the old service_psg_ticks() MMIO-per-tick loop. */
static void VN_RESIDENT_CODE engine_apply_credit(uint8_t frames)
{
#if defined(__PCE_CD__)
    service_adpcm_during_blocking_frames(frames, 0u);
    engine_apply_psg_credit(frames, 0u);
#else
    (void)frames;
    service_adpcm_during_blocking_frames(1u, 0u);
    engine_apply_psg_credit(1u, 0u);
#endif
}

/* Normal per-frame heartbeat (design doc engine_time §5.2). Called once per
   main-loop iteration right after vn_wait_next_vblank(). Consumes whatever
   real credit is outstanding and advances psg_core / ADPCM countdown by that
   amount. Message pacing is not touched here yet -- it stays on the current
   main-loop-driven timer until Phase E. */
static void VN_RESIDENT_CODE engine_service(void)
{
#if defined(__PCE_CD__)
#if VN_TIME_SOURCE_TIMER
    /* The TIQ handler is the only credit source while TIMER owns the tempo:
       an explicit vn_record_vblank_frames() call here would double-count a
       frame the ISR already recorded. */
    engine_apply_credit(vn_consume_vblank_credit());
#else
    engine_apply_credit(time_vblank_edge_credit());
#endif
#else
    engine_apply_credit(1u);
#endif
}

/* Called from inside blocking CD/ADPCM/BG work (the old cd_transfer_wait()
   call sites and the visual-cache CD loop). iterations is the busy-wait loop
   bound the caller was already spinning on; time_blocked_poll() folds the
   measured VBlank edges from that span into vn_vblank_credit, then this
   behaves exactly like engine_service() with the (now updated) real credit. */
static void VN_RESIDENT_CODE engine_service_blocking(uint16_t iterations)
{
#if defined(__PCE_CD__)
    time_blocked_poll(iterations);
    {
        const uint8_t frames = vn_consume_vblank_credit();
        service_adpcm_during_blocking_frames(frames, 0u);
        engine_apply_psg_credit(frames, 1u);
    }
#else
    (void)iterations;
    engine_apply_credit(1u);
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

static void VN_BANKED_CODE2 init_psg_service(void)
{
#if defined(__PCE_CD__)
    psg_vblank_seen = 0u;
    vn_vblank_credit = 0u;
#if VN_TIME_SOURCE_TIMER
    /* Install the credit-only TIQ hook and take first ownership of the audio
       timer. Ownership is released before every CD/ADPCM/CD-DA BIOS helper
       (vn_cd_bios_irq_open) because the System Card reprograms the timer for
       its own CD pacing, and re-acquired by bus_bios_close()/engine_frame_end
       once per frame / after each helper. */
    pce_cdb_irq_set(PCE_CDB_ID_IRQ_TIMER, vn_psg_timer_irq_handler);
    vn_psg_timer_own();
#endif
#endif
}
