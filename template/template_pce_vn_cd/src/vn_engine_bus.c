/* PHASE_A_SPLIT:BEGIN vn_engine_bus.c — the runtime's MPR/IRQ/BIOS choke
   point: guarded pce_cdb_* wrappers, CD-unit IRQ quiet/sync helpers, the
   CD-DA pause/deferred-resume bracket (prepare/resume/finish/cancel),
   cd_transfer_wait, MPR slot helpers (map_vn_data / vn_slot4_*), the VDC IRQ
   lock and the bank133 overlay dispatch (vn_overlay_dispatch(_locked) +
   vn_overlay_entry) plus the bank133/bank121 code loaders. Moved verbatim
   from pce_vn_runtime.c (Phase A module split). Re-opened #if guards replace
   the original file-spanning #if defined(__PCE_CD__). PHASE_A_SPLIT:END */
/* PHASE_A_SPLIT:BEGIN forward declarations added by the Phase A module split:
   vn_overlay_entry and the CD-DA resume path dispatch into overlay
   implementations that now live in later-included module files. */
#if defined(__PCE_CD__)
static void VN_OVERLAY_CODE draw_message_glyph_at(uint16_t glyph, uint8_t col, uint8_t row);
static uint8_t VN_OVERLAY_CODE draw_message_next_glyph(const pce_vn_message_t *message);
static uint8_t VN_OVERLAY_CODE draw_message_prefix_glyphs(const pce_vn_message_t *message);
static void VN_OVERLAY_CODE preload_message_glyph_masks(const pce_vn_message_t *message);
static void VN_OVERLAY_CODE map_message_wait_indicator_cell_impl(uint8_t blank);
static uint8_t VN_OVERLAY_CODE refresh_scene_sprite_patterns_impl(void);
static uint8_t VN_OVERLAY_CODE scene_pack_read_command_impl(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command);
static uint8_t VN_OVERLAY_CODE scene_pack_read_message_impl(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message);
static uint8_t VN_OVERLAY_CODE scene_pack_read_choice_impl(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice);
static uint8_t VN_OVERLAY_CODE scene_pack_read_choice_option_impl(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option);
static uint8_t VN_OVERLAY_CODE scene_pack_read_switch_impl(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch);
static uint8_t VN_OVERLAY_CODE scene_pack_read_switch_case_impl(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case);
static void VN_OVERLAY_CODE cdda_sector_from_remaining_impl(const pce_editor_cdda_asset_t *cdda);
static void VN_BANKED_CODE cdda_sector_from_remaining(const pce_editor_cdda_asset_t *cdda);
static void VN_OVERLAY_CODE set_variable_value_impl(signed int variable_index, signed int value);
static void VN_OVERLAY_CODE psg_apply_step_row_impl(uint16_t step_no);
static uint8_t VN_OVERLAY_CODE copy_adpcm_voice_impl(signed int voice_index);
#endif
/* PHASE_A_SPLIT:END */
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
/* Every System Card CD/ADPCM/CD-DA BIOS helper must run with the audio timer
   handed back to the BIOS: the BIOS reprograms the timer for its own CD
   pacing and relies on its internal TIQ handling, and entering e.g. CD_READ
   with our $20F5 TIMER dispatch bit still set parks the BIOS in its
   $E73x-$E82x IRQ dispatcher forever. Route every BIOS primitive through a
   release()-first wrapper so no call site can be missed; ownership is
   re-acquired at the next cd_transfer_wait() / quiet_cd_unit_irqs(). The
   wrappers are static inline so bank121/bank133 callers inline them and only
   the resident-callable vn_psg_timer_release() is shared. */
static void VN_BANKED_CODE vn_psg_timer_release(void);
static inline uint8_t vn_cdb_cd_read_guarded(pce_sector_t sector, uint8_t address_type, uint16_t address, uint16_t length)
{
    vn_psg_timer_release();
    return pce_cdb_cd_read(sector, address_type, address, length);
}
static inline uint8_t vn_cdb_adpcm_read_from_cd_guarded(pce_sector_t sector, uint8_t length, uint16_t address)
{
    vn_psg_timer_release();
    return pce_cdb_adpcm_read_from_cd(sector, length, address);
}
static inline uint8_t vn_cdb_adpcm_read_from_ram_guarded(uint8_t source_type, uint16_t source, uint16_t dest, uint16_t length)
{
    vn_psg_timer_release();
    return pce_cdb_adpcm_read_from_ram(source_type, source, dest, length);
}
static inline uint8_t vn_cdb_adpcm_play_guarded(uint16_t address, uint16_t length, uint8_t divider, uint8_t mode)
{
    vn_psg_timer_release();
    return pce_cdb_adpcm_play(address, length, divider, mode);
}
static inline void vn_cdb_adpcm_stop_guarded(void)
{
    vn_psg_timer_release();
    pce_cdb_adpcm_stop();
}
static inline void vn_cdb_adpcm_reset_guarded(void)
{
    vn_psg_timer_release();
    pce_cdb_adpcm_reset();
}
static inline uint8_t vn_cdb_adpcm_stream_guarded(pce_sector_t sector, pce_sector_t length, uint8_t divider)
{
    vn_psg_timer_release();
    return pce_cdb_adpcm_stream(sector, length, divider);
}
static inline uint16_t vn_cdb_adpcm_status_guarded(void)
{
    vn_psg_timer_release();
    return pce_cdb_adpcm_status();
}
static inline uint8_t vn_cdb_cdda_play_guarded(uint8_t start_type, pce_sector_t start, uint8_t end_type, pce_sector_t end, uint8_t mode)
{
    vn_psg_timer_release();
    return pce_cdb_cdda_play(start_type, start, end_type, end, mode);
}
static inline uint8_t vn_cdb_cdda_pause_guarded(void)
{
    vn_psg_timer_release();
    return pce_cdb_cdda_pause();
}
#define pce_cdb_cd_read(...) vn_cdb_cd_read_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_read_from_cd(...) vn_cdb_adpcm_read_from_cd_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_read_from_ram(...) vn_cdb_adpcm_read_from_ram_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_play(...) vn_cdb_adpcm_play_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_stop() vn_cdb_adpcm_stop_guarded()
#define pce_cdb_adpcm_reset() vn_cdb_adpcm_reset_guarded()
#define pce_cdb_adpcm_stream(...) vn_cdb_adpcm_stream_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_status() vn_cdb_adpcm_status_guarded()
#define pce_cdb_cdda_play(...) vn_cdb_cdda_play_guarded(__VA_ARGS__)
#define pce_cdb_cdda_pause() vn_cdb_cdda_pause_guarded()
#endif

static void map_vn_data(void)
{
#if defined(__PCE_CD__)
    pce_vn_font_tiles_map();
#endif
}

static void map_resident_data(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank128_map();
#endif
}

static void VN_BANKED_CODE vn_cd_irq1_quiet_handler(void)
{
#if defined(__PCE_CD__)
    vn_map_io_page();
    *IO_PCD_CONTROL = 0u;
    *IO_PCD_STATUS = VN_PCD_IRQ_STATUS_ALL;
    *VN_CDB_IRQ_PENDING_FLAGS = 0u;
#if VN_PSG_TIMER_IRQ_DRIVER
    /* Preserve the TIMER dispatch bit while the audio timer is owned: losing
       it here would leave TIQ deliverable with no acking handler. */
    *VN_CDB_BIOS_IRQ_MASK = (uint8_t)(vn_timer_owned ? (VN_CDB_BIOS_IRQ_MASK_IDLE | PCE_CDB_MASK_IRQ_TIMER) : VN_CDB_BIOS_IRQ_MASK_IDLE);
#else
    *VN_CDB_BIOS_IRQ_MASK = VN_CDB_BIOS_IRQ_MASK_IDLE;
#endif
    pce_irq_disable(IRQ_VDC);
    *IO_IRQ_ACK = IRQ_VDC;
#endif
}

/* The VDC's two-register interface ($0000 register-select latch + $0002 data) is
   NOT reentrant. A VRAM/SATB transfer first writes the auto-incrementing write
   address (MAWR) then streams data words; if anything pokes the VDC in the middle of
   that sequence the latch or the write address is clobbered and the rest of the
   transfer lands at the wrong VDC register / VRAM address. While ADPCM/CD plays the
   System Card external IRQ is enabled and can fire mid-transfer, so the per-frame
   lip-sync SATB rewrite can scribble pattern/attr words into the wrong VDC register
   and corrupt the sprites ("ADPCM playback breaks sprites"). vn_vdc_irq_lock/unlock
   bracket such a sequence so it runs with CPU IRQs masked. The I flag is saved and
   restored (php/plp) rather than an unconditional sei/cli pair, so we never re-enable
   IRQs in a context that had them disabled (e.g. boot, or a nested guard). The masked
   window is short; pending IRQs are latched and fire the instant the flag is
   restored, so CD/ADPCM servicing is deferred instead of dropped. pce_editor_vram_copy
   is also resident/noinline and guarded here because message window clears, raw BG
   blits, font uploads, and sprite pattern uploads all use the same MAWR + VRAM data
   sequence. */
#if defined(__PCE__) || defined(__PCE_CD__)
/* No "memory" clobber: the VDC accesses these guards bracket are all volatile, and a
   volatile asm is ordered with respect to volatile memory accesses, so sei stays
   before / cli stays after the transfer without it. A memory clobber would also fence
   every non-volatile access (harmless to correctness here) and, once inlined into the
   near-full bank129/bank130 upload code, deoptimises it enough to overflow the bank. */
static inline uint8_t vn_vdc_irq_lock(void)
{
    uint8_t flags;
    __asm__ volatile(
        "php\n\t"
        "pla\n\t"
        "sei\n\t"
        "tax\n\t"
        "lda #$ff\n\t"
        "tam #$01\n\t"
        "txa"
        : "=a"(flags)
        :
        : "x");
    return flags;
}
static inline void vn_vdc_irq_unlock(uint8_t flags)
{
    __asm__ volatile("pha\n\tplp" : : "a"(flags));
}
static inline void vn_map_io_page(void)
{
    __asm__ volatile("lda #$ff\n\ttam #$01" ::: "a");
}
/* Slot4 (MPR4, CPU 0x8000-0x9FFF) is time-shared between bank130 code, the
   bank133 overlay and the bank121 visual cache. Cooperative audio services can
   be reached from any of those contexts, so they must restore the exact bank
   that was mapped on entry -- an unconditional bank130 restore unmaps an
   overlay/visual-cache caller and its RTS lands in the wrong bank's bytes. */
static inline uint8_t vn_slot4_current_bank(void)
{
    uint8_t bank;
    __asm__ volatile("tma #$10" : "=a"(bank));
    return bank;
}
static inline void vn_slot4_map_bank(uint8_t bank)
{
    __asm__ volatile("tam #$10" : : "a"(bank));
}
#else
static inline uint8_t vn_vdc_irq_lock(void) { return 0u; }
static inline void vn_vdc_irq_unlock(uint8_t flags) { (void)flags; }
static inline void vn_map_io_page(void) {}
static inline uint8_t vn_slot4_current_bank(void) { return 0u; }
static inline void vn_slot4_map_bank(uint8_t bank) { (void)bank; }
#endif

#if defined(__PCE_CD__)
static void cd_sector_from_ref(pce_sector_t *dest, const pce_editor_cd_sector_t *source)
{
    dest->lo = source ? source->lo : 0u;
    dest->md = source ? source->md : 0u;
    dest->hi = source ? source->hi : 0u;
}

static void cd_sector_from_uint(pce_sector_t *dest, unsigned long value)
{
    dest->lo = (uint8_t)(value & 0xfful);
    dest->md = (uint8_t)((value >> 8) & 0xfful);
    dest->hi = (uint8_t)((value >> 16) & 0xfful);
}

static void cd_sector_advance(pce_sector_t *sector)
{
    sector->lo++;
    if (sector->lo) return;
    sector->md++;
    if (sector->md) return;
    sector->hi++;
}

static void cd_sector_end_from_count(pce_sector_t *dest, const pce_sector_t *start, unsigned int count)
{
    dest->lo = start->lo;
    dest->md = start->md;
    dest->hi = start->hi;
    while (count--) cd_sector_advance(dest);
}

#endif /* PHASE_A_SPLIT */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
/* Opens the System Card external-IRQ window right before a CD/ADPCM/CD-DA
   BIOS helper. With the TIMER driver this also hands the timer hardware back
   to the BIOS (which reprograms it for its own CD pacing/timeouts). */
static void VN_BANKED_CODE vn_cd_bios_irq_open(void)
{
#if defined(__PCE_CD__)
#if VN_PSG_TIMER_IRQ_DRIVER
    vn_psg_timer_release();
#endif
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
#endif
}

static void cd_transfer_wait(void)
{
    volatile uint16_t wait;
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
    /* Do NOT re-own the timer here: the System Card CD state machine is still
       settling between chunk reads, and reprogramming the timer mid-sequence
       hangs the next CD_READ in the BIOS IRQ dispatcher. Credit the blocked
       span (read + settle) with a bounded estimate instead; ownership returns
       at the next quiet_cd_unit_irqs() once the whole sequence is done. */
    uint8_t est;
    for (est = 0u; est < VN_CD_CHUNK_ESTIMATED_FRAMES; est++) VN_ADD_ESTIMATED_FRAME();
#endif
    /* This wait is normally paired with one 2048-byte CD sector. Its compensation
       tick is PSG-only: ADPCM playback length follows real VBlank credit, not
       this synthetic CD settle time. */
    if (psg_active && !psg_pattern_banked)
    {
        uint8_t slice;
        for (slice = 0u; slice < VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES; slice++)
        {
            for (wait = 0u; wait < (65535u / VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES); wait++) {}
            service_psg_compensation_ticks(1u, 0u);
        }
        return;
    }
    /* No PSG playing, or a CD-streamed pattern (bank134/135): keep a single
       post-wait PSG compensation so the bank134/135 MPR6 remap cannot overlap the
       CD DMA target bank132. */
    for (wait = 0u; wait < 65535u; wait++) {}
    service_psg_compensation_ticks(VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES, 0u);
}

static void VN_BANKED_CODE quiet_cd_unit_irqs(void);
static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call(void);
static void VN_RESIDENT_CODE mask_buffered_adpcm_completion_irq(void);
static void VN_BANKED_CODE start_buffered_adpcm_playback_direct(unsigned int address, uint16_t length, uint8_t divider);
static void VN_RESIDENT_CODE stop_buffered_adpcm_playback_direct(void);
static void VN_BANKED_CODE begin_cdda_deferred_resume(void);
static void VN_BANKED_CODE end_cdda_deferred_resume(void);
static void VN_RESIDENT_CODE prepare_cd_data_access(void);
static void VN_BANKED_CODE resume_cdda_after_cd_data_access(void);
static void VN_BANKED_CODE finish_cd_data_read_before_vram_copy(void);
static void VN_BANKED_CODE cancel_cdda_after_cd_data_conflict(void);


#endif /* PHASE_A_SPLIT */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
static void VN_BANKED_CODE quiet_cd_unit_irqs(void)
{
#if defined(__PCE_CD__)
    vn_map_io_page();
    *IO_PCD_CONTROL = 0u;
    *IO_PCD_STATUS = VN_PCD_IRQ_STATUS_ALL;
    *VN_CDB_IRQ_PENDING_FLAGS = 0u;
#if VN_PSG_TIMER_IRQ_DRIVER
    /* Single write, TIMER dispatch bit preserved while owned: a clear-then-
       re-enable pair would open a window where a TIQ lands on the System
       Card's default (non-acking) path and hangs the CPU. */
    *VN_CDB_BIOS_IRQ_MASK = (uint8_t)(vn_timer_owned ? (VN_CDB_BIOS_IRQ_MASK_IDLE | PCE_CDB_MASK_IRQ_TIMER) : VN_CDB_BIOS_IRQ_MASK_IDLE);
#else
    *VN_CDB_BIOS_IRQ_MASK = VN_CDB_BIOS_IRQ_MASK_IDLE;
#endif
    pce_irq_disable(IRQ_VDC);
#if VN_PSG_TIMER_IRQ_DRIVER
    /* Runs once per frame (vn_wait_next_vblank) and after every BIOS helper:
       re-acquire the audio timer whenever the CD unit is quiet. */
    vn_psg_timer_own();
#endif
#endif
}

static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call(void)
{
#if defined(__PCE_CD__)
    if (!adpcm_stream_active)
    {
        pce_cdb_irq_set(PCE_CDB_ID_IRQ_VDC, vn_cd_irq1_quiet_handler);
#if VN_PSG_TIMER_IRQ_DRIVER
        /* The QUIET disable clears the $20F5 TIMER dispatch bit; mask TIQ
           first (release) so no unackable TIQ can land in the window. The
           trailing quiet_cd_unit_irqs() re-owns the timer. */
        vn_psg_timer_release();
#endif
        pce_cdb_irq_disable(VN_CDB_IRQ_MASK_RUNTIME_QUIET);
        quiet_cd_unit_irqs();
        if (adpcm_stream_irq_open)
        {
            adpcm_stream_irq_open = 0u;
            set_vdc_control(vdc_control_current);
        }
    }
    else
    {
        adpcm_stream_irq_open = 1u;
        pce_irq_enable(IRQ_VDC);
    }
#endif
}

static void VN_RESIDENT_CODE mask_buffered_adpcm_completion_irq(void)
{
#if defined(__PCE_CD__)
#if VN_PSG_TIMER_IRQ_DRIVER
    vn_psg_timer_release();
#endif
    pce_cdb_irq_disable(VN_CDB_IRQ_MASK_RUNTIME_QUIET);
    quiet_cd_unit_irqs();
#endif
}

#endif /* PHASE_A_SPLIT */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
static void VN_BANKED_CODE begin_cdda_deferred_resume(void)
{
    if (cdda_resume_defer_depth != 255u) cdda_resume_defer_depth++;
}

static void VN_BANKED_CODE end_cdda_deferred_resume(void)
{
    if (cdda_resume_defer_depth) cdda_resume_defer_depth--;
    if (!cdda_resume_defer_depth) resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
}

static void VN_RESIDENT_CODE prepare_cd_data_access(void)
{
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
#if defined(__PCE_CD__)
    vn_cd_bios_irq_open();
#endif
    if (!cdda_active) return;
    (void)pce_cdb_cdda_pause();
    cdda_active = 0u;
    cdda_resume_pending = 1u;
    restore_video_after_cdb_call(restore_display_after_pause);
}

static void VN_BANKED_CODE resume_cdda_after_cd_data_access(void)
{
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (!cdda_resume_pending) return;
    if (cdda_resume_defer_depth) return;
    if (!cdda_current || !cdda_track)
    {
        cancel_cdda_after_cd_data_conflict();
        return;
    }
    cdda_resume_end.lo = 0u;
    cdda_resume_end.md = 0u;
    cdda_resume_end.hi = 0u;
    cdda_sector_from_remaining(cdda_current);
    vn_cd_bios_irq_open();
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, cdda_resume_start, PCE_CDB_LOCATION_TYPE_UNTIL_END, cdda_resume_end, PCE_CDB_CDDA_PLAY_ONE_SHOT);
    cdda_active = 1u;
    cdda_resume_pending = 0u;
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_cdda);
}

static void VN_BANKED_CODE finish_cd_data_read_before_vram_copy(void)
{
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    map_vn_data();
}

static void VN_BANKED_CODE cancel_cdda_after_cd_data_conflict(void)
{
    cdda_active = 0u;
    cdda_resume_pending = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
}

#endif /* PHASE_A_SPLIT */
/* Shared resident (bank129) dispatcher to the bank133 overlay scene-pack decoders.
   Pure reads touch no VDC, PSG, or MPR6 banked pattern data, so (like
   visual_cache_call) no IRQ lock is needed around the slot4 swap; the System Card
   IRQ handlers run from MPR7, not slot4. */
static uint8_t VN_BANKED_CODE vn_overlay_dispatch(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
#if defined(__PCE_CD__)
    uint8_t r;
    pce_ram_bank133_map();
    r = (uint8_t)VN_OVERLAY_CALL(op, a0, a1, a2);
    pce_ram_bank130_map();
    return r;
#else
    (void)op; (void)a0; (void)a1; (void)a2;
    return 0u;
#endif
}

/* Same as vn_overlay_dispatch but with the IRQ lock held across the slot4 swap.
   This is shared by overlay work that touches the non-reentrant VDC interface and
   by PSG step application, which temporarily maps MPR6 to bank134/135. True ADPCM
   streaming leaves the System Card external IRQ enabled; letting it fire while
   those mappings/register sequences are transient can corrupt the restored video
   state. Factoring the lock+swap here keeps each named dispatcher tiny instead of
   inlining the full sequence at every call site. */
static uint8_t VN_BANKED_CODE vn_overlay_dispatch_locked(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
#if defined(__PCE_CD__)
    uint8_t r;
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    r = (uint8_t)VN_OVERLAY_CALL(op, a0, a1, a2);
    pce_ram_bank130_map();
    vn_vdc_irq_unlock(irq);
    return r;
#else
    (void)op; (void)a0; (void)a1; (void)a2;
    return 0u;
#endif
}

#if defined(__PCE_CD__)
/* Single fixed-address overlay entry. Reached only via VN_OVERLAY_CALL (indirect
   call to the literal PCE_VN_OVERLAY_LOAD_ADDR), so the build carries no
   resident->overlay relocation and can drop .vn_overlay from the ELF. Args ride
   the normal calling convention; message-record pointers are passed as 16-bit. */
static uint8_t VN_OVERLAY_ENTRY_CODE vn_overlay_entry(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
    volatile uint8_t o = op;
    if (o == VN_OVERLAY_OP_DRAW_GLYPH) { draw_message_glyph_at(a0, (uint8_t)a1, a2); return 0u; }
    if (o == VN_OVERLAY_OP_NEXT_GLYPH) return draw_message_next_glyph((const pce_vn_message_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_PREFIX_GLYPHS) return draw_message_prefix_glyphs((const pce_vn_message_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_PRELOAD_MASKS) { preload_message_glyph_masks((const pce_vn_message_t *)(uintptr_t)a0); return 0u; }
    if (o == VN_OVERLAY_OP_SHOW_SPRITE_SLOT) return show_character_sprite_frame_slot((uint8_t)a1);
    if (o == VN_OVERLAY_OP_REFRESH_SPRITE) return refresh_scene_sprite_patterns_impl();
    if (o == VN_OVERLAY_OP_READ_COMMAND) return scene_pack_read_command_impl(&active_scene_pack, a2, (pce_vn_command_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_READ_MESSAGE) return scene_pack_read_message_impl(&active_scene_pack, a2, (pce_vn_message_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_READ_CHOICE) return scene_pack_read_choice_impl(&active_scene_pack, a2, (vn_choice_ref_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_READ_CHOICE_OPTION) return scene_pack_read_choice_option_impl(&active_scene_pack, (const vn_choice_ref_t *)(uintptr_t)a1, a2, (pce_vn_choice_option_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_READ_SWITCH) return scene_pack_read_switch_impl(&active_scene_pack, a2, (vn_switch_ref_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_READ_SWITCH_CASE) return scene_pack_read_switch_case_impl(&active_scene_pack, (const vn_switch_ref_t *)(uintptr_t)a1, a2, (pce_vn_switch_case_t *)(uintptr_t)a0);
    if (o == VN_OVERLAY_OP_CACHE_SPRITE_ANIM) { cache_sprite_animation_impl(a2); return 0u; }
    if (o == VN_OVERLAY_OP_CDDA_SECTOR) { cdda_sector_from_remaining_impl((const pce_editor_cdda_asset_t *)(uintptr_t)a0); return 0u; }
    if (o == VN_OVERLAY_OP_MAP_WAIT_CELL) { map_message_wait_indicator_cell_impl((uint8_t)a2); return 0u; }
    if (o == VN_OVERLAY_OP_SET_VARIABLE) { set_variable_value_impl((signed int)(int16_t)a0, (signed int)(int16_t)a1); return 0u; }
    if (o == VN_OVERLAY_OP_APPLY_PSG_STEP) { psg_apply_step_row_impl(a0); return 0u; }
    if (o == VN_OVERLAY_OP_COPY_ADPCM_VOICE) return copy_adpcm_voice_impl((signed int)(int16_t)a0);
    return 0u;
}
#endif

#if defined(__PCE_CD__)
/* Stream the overlay code blob (pce_vn_overlay_data) from CD into bank133 RAM.
   bank133 is mapped into slot 4 (0x8000) as the read destination, then bank130
   (play code) is restored. Mirrors upload_font_tiles' CD-read loop but writes the
   bytes straight into the slot-4 window instead of via cd_transfer_scratch+VRAM. */
static void load_overlay_code(void)
{
    pce_vn_cd_data_ref_t ovl;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t dest = (uint16_t)PCE_VN_OVERLAY_LOAD_ADDR;
    map_vn_data();
    ovl = pce_vn_overlay_data;
    map_resident_data();
    if (!ovl.byte_size || !ovl.sector_count) return;
    prepare_cd_data_access();
    sector.lo = ovl.sector.lo;
    sector.md = ovl.sector.md;
    sector.hi = ovl.sector.hi;
    remaining = ovl.byte_size;
    pce_ram_bank133_map();
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, dest, chunk);
        cd_transfer_wait();
        dest = (uint16_t)(dest + chunk);
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    pce_ram_bank130_map();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
}

#endif /* PHASE_A_SPLIT */
