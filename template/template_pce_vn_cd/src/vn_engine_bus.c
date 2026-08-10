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
static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_command_impl(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command);
static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_message_impl(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message);
static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_choice_impl(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice);
static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_choice_option_impl(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option);
static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_switch_impl(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch);
static uint8_t VN_LOGIC_OVERLAY_CODE scene_pack_read_switch_case_impl(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case);
static void VN_LOGIC_OVERLAY_CODE set_variable_value_impl(signed int variable_index, signed int value);
static uint8_t VN_LOGIC_OVERLAY_CODE execute_control_command_impl(const pce_vn_command_t *command);
static void VN_OVERLAY_CODE cdda_command_impl(signed int asset_index);
static uint8_t VN_LOGIC_OVERLAY_CODE update_active_message_mouth_impl(uint8_t restore);
static void VN_CD_ASYNC_CODE service_adpcm_playback_impl(void);
static const pce_editor_sprite_asset_t *VN_CD_ASYNC_CODE vn_get_sprite_asset_impl(uint16_t idx, uint8_t preferred_slot);
static uint8_t VN_CD_ASYNC_CODE plan_scene_sprite_layout_impl(void);
static uint8_t VN_CD_ASYNC_CODE refresh_scene_sprite_slot_upload_impl(uint8_t i, uint8_t satb_index);
#endif
/* PHASE_A_SPLIT:END */
#if defined(__PCE_CD__)
/* Central wrappers keep every CD/ADPCM/CD-DA BIOS primitive behind the same
   IRQ-mask boundary. The resident PSG user vector remains installed; helpers
   may enable external IRQ transiently and vn_system_card_irq_rearm() restores
   the user-vector-only idle contract afterwards. */
static inline uint8_t vn_cdb_cd_read_guarded(pce_sector_t sector, uint8_t address_type, uint16_t address, uint16_t length)
{
    return pce_cdb_cd_read(sector, address_type, address, length);
}
static inline uint8_t vn_cdb_adpcm_read_from_cd_guarded(pce_sector_t sector, uint8_t length, uint16_t address)
{
    return pce_cdb_adpcm_read_from_cd(sector, length, address);
}
static inline uint8_t vn_cdb_adpcm_read_from_ram_guarded(uint8_t source_type, uint16_t source, uint16_t dest, uint16_t length)
{
    return pce_cdb_adpcm_read_from_ram(source_type, source, dest, length);
}
static inline uint8_t vn_cdb_adpcm_play_guarded(uint16_t address, uint16_t length, uint8_t divider, uint8_t mode)
{
    return pce_cdb_adpcm_play(address, length, divider, mode);
}
static inline void vn_cdb_adpcm_stop_guarded(void)
{
    pce_cdb_adpcm_stop();
}
static inline void vn_cdb_adpcm_reset_guarded(void)
{
    pce_cdb_adpcm_reset();
}
static inline uint16_t vn_cdb_adpcm_status_guarded(void)
{
    return pce_cdb_adpcm_status();
}
static inline uint8_t vn_cdb_cdda_play_guarded(uint8_t start_type, pce_sector_t start, uint8_t end_type, pce_sector_t end, uint8_t mode)
{
    return pce_cdb_cdda_play(start_type, start, end_type, end, mode);
}
static inline uint8_t vn_cdb_cdda_pause_guarded(void)
{
    return pce_cdb_cdda_pause();
}
#define pce_cdb_cd_read(...) vn_cdb_cd_read_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_read_from_cd(...) vn_cdb_adpcm_read_from_cd_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_read_from_ram(...) vn_cdb_adpcm_read_from_ram_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_play(...) vn_cdb_adpcm_play_guarded(__VA_ARGS__)
#define pce_cdb_adpcm_stop() vn_cdb_adpcm_stop_guarded()
#define pce_cdb_adpcm_reset() vn_cdb_adpcm_reset_guarded()
#define pce_cdb_adpcm_status() vn_cdb_adpcm_status_guarded()
#define pce_cdb_cdda_play(...) vn_cdb_cdda_play_guarded(__VA_ARGS__)
#define pce_cdb_cdda_pause() vn_cdb_cdda_pause_guarded()
#endif

static void map_vn_data(void)
{
#if defined(__PCE_CD__)
    pce_vn_data_map();
#endif
}

static void map_resident_data(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank128_map();
#endif
}

/* Shared prefix for quiet_cd_unit_irqs()/vn_cd_irq1_quiet_handler(): drop the
   CD unit back to idle and restore the generic VDC user-vector mask. */
static void VN_BANKED_CODE vn_cdb_quiet_idle(void)
{
#if defined(__PCE_CD__)
    vn_map_io_page();
    *IO_PCD_CONTROL = 0u;
    *IO_PCD_STATUS = VN_PCD_IRQ_STATUS_ALL;
    *VN_CDB_IRQ_PENDING_FLAGS = 0u;
    *VN_CDB_BIOS_IRQ_MASK = VN_CDB_BIOS_IRQ_MASK_USER;
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
   BIOS helper, then re-establishes the resident VDC user vector. */
static void VN_RESIDENT_CODE vn_cd_bios_irq_open(void)
{
#if defined(__PCE_CD__)
    vn_cd_bus_state = VN_CD_BUS_BIOS_HELPER;
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
    vn_system_card_irq_rearm();
#endif
}

/* Settle wait paired with one CD BIOS read/write. engine_service_blocking()
   records any VBlank edges visible during the wait and feeds that real credit
   to PSG/ADPCM. The BIOS helper itself can still consume time before this
   sampler runs, so add a tiny PSG-only estimate per chunk; it intentionally
   does not advance ADPCM/message timing. */
static void cd_transfer_wait(void)
{
    engine_service_blocking(VN_CD_TRANSFER_SETTLE_POLL_ITERATIONS);
}

static void VN_BANKED_CODE quiet_cd_unit_irqs(void);
static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call(void);
static void VN_BANKED_CODE mask_buffered_adpcm_completion_irq(void);
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
    if (vn_cd_bus_state == VN_CD_BUS_ASYNC_DATA) return;
    vn_cdb_quiet_idle();
    vn_system_card_irq_rearm();
#endif
}

static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call(void)
{
#if defined(__PCE_CD__)
    /* Restore the adapter-owned user IRQ contract after any BIOS helper. */
    vn_cd_bus_state = VN_CD_BUS_IDLE;
    pce_cdb_irq_disable(PCE_CDB_MASK_IRQ_EXTERNAL);
    quiet_cd_unit_irqs();
#endif
}

static void VN_BANKED_CODE mask_buffered_adpcm_completion_irq(void)
{
#if defined(__PCE_CD__)
    pce_cdb_irq_disable(PCE_CDB_MASK_IRQ_EXTERNAL);
    quiet_cd_unit_irqs();
#endif
}

#endif /* PHASE_A_SPLIT */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
static void VN_BANKED_CODE begin_cdda_deferred_resume(void)
{
#if VN_CDDA_RESUME_AFTER_DATA_READ
    if (cdda_resume_defer_depth != 255u) cdda_resume_defer_depth++;
#endif
}

static void VN_BANKED_CODE end_cdda_deferred_resume(void)
{
#if VN_CDDA_RESUME_AFTER_DATA_READ
    if (cdda_resume_defer_depth) cdda_resume_defer_depth--;
    if (!cdda_resume_defer_depth) resume_cdda_after_cd_data_access();
#endif
    VN_MAP_BANK130_FOR_CODE();
}

static void VN_RESIDENT_CODE prepare_cd_data_access(void)
{
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
#if defined(__PCE_CD__)
    vn_cd_bios_irq_open();
#endif
    if (!(cdda_state & VN_CDDA_STATE_ACTIVE)) return;
    (void)pce_cdb_cdda_pause();
#if VN_CDDA_RESUME_AFTER_DATA_READ
    cdda_state = (uint8_t)((cdda_state & (uint8_t)~VN_CDDA_STATE_ACTIVE) | VN_CDDA_STATE_RESUME_PENDING);
#else
    cdda_state = 0u;
#endif
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_pause);
}

static void VN_BANKED_CODE resume_cdda_after_cd_data_access(void)
{
#if VN_CDDA_RESUME_AFTER_DATA_READ
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (!(cdda_state & VN_CDDA_STATE_RESUME_PENDING)) return;
    if (cdda_resume_defer_depth) return;
    map_vn_data();
    vn_cd_bios_irq_open();
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, cdda_resume_start, PCE_CDB_LOCATION_TYPE_SECTOR, cdda_resume_end, VN_CDDA_PLAY_MODE());
    cdda_state = (uint8_t)((cdda_state | VN_CDDA_STATE_ACTIVE) & (uint8_t)~VN_CDDA_STATE_RESUME_PENDING);
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_cdda);
#endif
}

static void VN_BANKED_CODE finish_cd_data_read_before_vram_copy(void)
{
    sync_cd_external_irq_after_bios_call();
#if VN_CDDA_RESUME_AFTER_DATA_READ
    resume_cdda_after_cd_data_access();
#endif
    map_vn_data();
}

static void VN_BANKED_CODE cancel_cdda_after_cd_data_conflict(void)
{
    cdda_state = 0u;
}

#endif /* PHASE_A_SPLIT */
/* Shared resident (bank129) dispatcher for non-VDC bank133 work. No IRQ lock is
   needed, but exact MPR4 restoration is mandatory because CD-DA/runtime service
   can enter from another slot-4 overlay. */
static uint8_t VN_BANKED_CODE vn_overlay_dispatch(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
#if defined(__PCE_CD__)
    uint8_t r;
    const uint8_t slot4_bank = vn_slot4_current_bank();
    pce_ram_bank133_map();
    r = (uint8_t)VN_OVERLAY_CALL(op, a0, a1, a2);
    vn_slot4_map_bank(slot4_bank);
    return r;
#else
    (void)op; (void)a0; (void)a1; (void)a2;
    return 0u;
#endif
}

/* Same as vn_overlay_dispatch but with the IRQ lock held across the slot4 swap.
   It is used by overlay work that touches the non-reentrant VDC interface. Keep IRQs
   masked while those mappings/register sequences are transient, then restore the
   caller's slot4 bank rather than forcing bank130: this helper can be reached
   while bank121/133 code is on the stack through cooperative blocking-work
   service. Factoring the lock+swap here keeps each named dispatcher tiny instead
   of inlining the full sequence at every call site. */
static uint8_t VN_BANKED_CODE vn_overlay_dispatch_locked(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
#if defined(__PCE_CD__)
    uint8_t r;
    uint8_t slot4_bank = vn_slot4_current_bank();
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    r = (uint8_t)VN_OVERLAY_CALL(op, a0, a1, a2);
    vn_slot4_map_bank(slot4_bank);
    vn_vdc_irq_unlock(irq);
    return r;
#else
    (void)op; (void)a0; (void)a1; (void)a2;
    return 0u;
#endif
}

/* bank124 contains only state/decoder logic and is safe without a VDC IRQ lock.
   Both shared mappings are restored exactly: callers may be suspended in
   bank121/122/130/133, and MPR6 may hold bank123 or a PSG/cache data bank. */
static uint8_t VN_BANKED_CODE vn_logic_overlay_dispatch(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
#if defined(__PCE_CD__)
    uint8_t r;
    uint8_t restore_mpr6;
    const uint8_t slot4_bank = vn_slot4_current_bank();
    __asm__ volatile("tma #$40" : "=a"(restore_mpr6));
    map_vn_data();
    pce_ram_bank124_map();
    r = (uint8_t)VN_LOGIC_OVERLAY_CALL(op, a0, a1, a2);
    __asm__ volatile("tam #$40" : : "a"(restore_mpr6));
    vn_slot4_map_bank(slot4_bank);
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
    if (o == VN_OVERLAY_OP_CDDA_COMMAND) { cdda_command_impl((signed int)(int16_t)a0); return 0u; }
    if (o == VN_OVERLAY_OP_MAP_WAIT_CELL) { map_message_wait_indicator_cell_impl((uint8_t)a2); return 0u; }
    return 0u;
}

/* Single fixed-address bank124 entry. The sparse op values deliberately keep
   this as an if-chain inside the extracted section (no external jump table). */
static uint8_t VN_LOGIC_OVERLAY_ENTRY_CODE vn_logic_overlay_entry(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2)
{
    volatile uint8_t o = op;
    if (o == VN_LOGIC_OVERLAY_OP_READ_COMMAND) return scene_pack_read_command_impl(&active_scene_pack, a2, (pce_vn_command_t *)(uintptr_t)a0);
    if (o == VN_LOGIC_OVERLAY_OP_READ_MESSAGE) return scene_pack_read_message_impl(&active_scene_pack, a2, (pce_vn_message_t *)(uintptr_t)a0);
    if (o == VN_LOGIC_OVERLAY_OP_READ_CHOICE) return scene_pack_read_choice_impl(&active_scene_pack, a2, (vn_choice_ref_t *)(uintptr_t)a0);
    if (o == VN_LOGIC_OVERLAY_OP_READ_CHOICE_OPTION) return scene_pack_read_choice_option_impl(&active_scene_pack, (const vn_choice_ref_t *)(uintptr_t)a1, a2, (pce_vn_choice_option_t *)(uintptr_t)a0);
    if (o == VN_LOGIC_OVERLAY_OP_READ_SWITCH) return scene_pack_read_switch_impl(&active_scene_pack, a2, (vn_switch_ref_t *)(uintptr_t)a0);
    if (o == VN_LOGIC_OVERLAY_OP_READ_SWITCH_CASE) return scene_pack_read_switch_case_impl(&active_scene_pack, (const vn_switch_ref_t *)(uintptr_t)a1, a2, (pce_vn_switch_case_t *)(uintptr_t)a0);
    if (o == VN_LOGIC_OVERLAY_OP_CACHE_SPRITE_ANIM) return cache_sprite_animation_impl(a2, a0);
    if (o == VN_LOGIC_OVERLAY_OP_SET_VARIABLE) { set_variable_value_impl((signed int)(int16_t)a0, (signed int)(int16_t)a1); return 0u; }
    if (o == VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH) return update_active_message_mouth_impl(a2);
    if (o == VN_LOGIC_OVERLAY_OP_TICK_SPRITE_ANIMATIONS) { tick_sprite_animations_impl(); return 0u; }
    if (o == VN_LOGIC_OVERLAY_OP_EXECUTE_CONTROL) return execute_control_command_impl((const pce_vn_command_t *)(uintptr_t)a0);
    return 0u;
}
#endif

#if defined(__PCE_CD__)
#define VN_PCD_SCSI_STATUS (*(volatile uint8_t *)0x1800)
#define VN_PCD_SCSI_DATA (*(volatile uint8_t *)0x1801)
#define VN_PCD_SCSI_PHASE_MASK 0xf8u
#define VN_PCD_SCSI_REQ 0x40u
#define VN_PCD_SCSI_BSY 0x80u
#define VN_PCD_SCSI_ACK 0x80u
#define VN_PCD_SCSI_PHASE_COMMAND 0xd0u
#define VN_PCD_SCSI_PHASE_DATA_IN 0xc8u
#define VN_PCD_SCSI_PHASE_STATUS 0xd8u
#define VN_PCD_SCSI_PHASE_MESSAGE_IN 0xf8u

static uint8_t VN_CD_ASYNC_CODE vn_cd_async_wait_req_phase(uint8_t phase, uint16_t polls)
{
    while (polls--)
    {
        const uint8_t status = VN_PCD_SCSI_STATUS;
        if ((status & VN_PCD_SCSI_REQ) && ((status & VN_PCD_SCSI_PHASE_MASK) == phase)) return 1u;
    }
    return 0u;
}

static void VN_CD_ASYNC_CODE vn_cd_async_ack_byte(void)
{
    *IO_PCD_CONTROL = (uint8_t)(*IO_PCD_CONTROL | VN_PCD_SCSI_ACK);
    while (VN_PCD_SCSI_STATUS & VN_PCD_SCSI_REQ) {}
    *IO_PCD_CONTROL = (uint8_t)(*IO_PCD_CONTROL & (uint8_t)~VN_PCD_SCSI_ACK);
}

static uint8_t VN_CD_ASYNC_CODE vn_cd_async_send_command_byte(uint8_t value)
{
    if (!vn_cd_async_wait_req_phase(VN_PCD_SCSI_PHASE_COMMAND, 0xffffu)) return 0u;
    VN_PCD_SCSI_DATA = value;
    vn_cd_async_ack_byte();
    return 1u;
}

static void VN_CD_ASYNC_CODE vn_cd_async_store_byte(uint8_t value)
{
    if (!vn_cd_async_store_remaining) return;
    if (vn_cd_async_dest_kind == VN_CD_ASYNC_DEST_ADPCM_RAM)
    {
        *IO_PCD_ADPCM_DATA = value;
        vn_cd_async_store_remaining--;
        return;
    }
    if (vn_cd_async_dest_kind == VN_CD_ASYNC_DEST_BANK132 ||
        vn_cd_async_dest_kind == VN_CD_ASYNC_DEST_PSG_BANK ||
        vn_cd_async_dest_kind == VN_CD_ASYNC_DEST_SCENE_PACK_CACHE)
    {
        __asm__ volatile("tam #$40" : : "a"(vn_cd_async_dest_bank));
        ((uint8_t *)(uintptr_t)vn_cd_async_dest_addr)[0] = value;
        vn_cd_async_dest_addr = (uint16_t)(vn_cd_async_dest_addr + 1u);
        vn_cd_async_store_remaining--;
        return;
    }
}

static void VN_CD_ASYNC_CODE vn_cd_async_prepare_adpcm_write(void)
{
    uint8_t guard = 8u;
    *IO_PCD_ADPCM_CONTROL = 0u;
    *IO_PCD_ADPCM_ADDR_LO = (uint8_t)(vn_cd_async_dest_addr & 0xffu);
    *IO_PCD_ADPCM_ADDR_HI = (uint8_t)(vn_cd_async_dest_addr >> 8);
    *IO_PCD_ADPCM_CONTROL = (uint8_t)(*IO_PCD_ADPCM_CONTROL | PCD_ADPCM_WRITE_LATCH);
    while (guard--) {}
    *IO_PCD_ADPCM_CONTROL = (uint8_t)(*IO_PCD_ADPCM_CONTROL & (uint8_t)~PCD_ADPCM_WRITE_LATCH);
}

static uint8_t VN_CD_ASYNC_CODE vn_cd_async_begin_impl(void)
{
    uint8_t count;
    if (vn_cd_async_dest_kind == VN_CD_ASYNC_DEST_ADPCM_RAM) vn_cd_async_prepare_adpcm_write();
    VN_PCD_SCSI_DATA = 0x81u;
    if (!(VN_PCD_SCSI_STATUS & VN_PCD_SCSI_BSY)) VN_PCD_SCSI_STATUS = 0x81u;
    count = vn_cd_async_sector_count;
    if (!vn_cd_async_send_command_byte(0x08u)) return 0u;
    if (!vn_cd_async_send_command_byte((uint8_t)(vn_cd_async_sector.hi & 0x1fu))) return 0u;
    if (!vn_cd_async_send_command_byte(vn_cd_async_sector.md)) return 0u;
    if (!vn_cd_async_send_command_byte(vn_cd_async_sector.lo)) return 0u;
    if (!vn_cd_async_send_command_byte(count)) return 0u;
    if (!vn_cd_async_send_command_byte(0x00u)) return 0u;
    vn_cd_async_status = VN_CD_ASYNC_STATUS_ACTIVE;
    return 1u;
}

static uint8_t VN_CD_ASYNC_CODE vn_cd_async_service_impl(void)
{
    uint16_t budget = vn_cd_async_dest_kind == VN_CD_ASYNC_DEST_ADPCM_RAM ? VN_CD_ASYNC_ADPCM_BYTES_PER_FRAME : VN_CD_ASYNC_BYTES_PER_FRAME;
    if (vn_cd_async_status != VN_CD_ASYNC_STATUS_ACTIVE) return vn_cd_async_status;
    while (budget && vn_cd_async_wire_remaining)
    {
        uint8_t value;
        if (!vn_cd_async_wait_req_phase(VN_PCD_SCSI_PHASE_DATA_IN, 256u)) return vn_cd_async_status;
        value = VN_PCD_SCSI_DATA;
        vn_cd_async_store_byte(value);
        vn_cd_async_ack_byte();
        vn_cd_async_wire_remaining--;
        budget--;
    }
    if (vn_cd_async_wire_remaining) return vn_cd_async_status;
    if (!vn_cd_async_wait_req_phase(VN_PCD_SCSI_PHASE_STATUS, 256u)) return vn_cd_async_status;
    vn_cd_async_status_byte = VN_PCD_SCSI_DATA;
    vn_cd_async_ack_byte();
    if (!vn_cd_async_wait_req_phase(VN_PCD_SCSI_PHASE_MESSAGE_IN, 256u)) return vn_cd_async_status;
    vn_cd_async_message_byte = VN_PCD_SCSI_DATA;
    vn_cd_async_ack_byte();
    if (vn_cd_async_status_byte || vn_cd_async_message_byte)
    {
        vn_cd_async_status = VN_CD_ASYNC_STATUS_ERROR;
        return vn_cd_async_status;
    }
    vn_cd_async_status = VN_CD_ASYNC_STATUS_DONE;
    return vn_cd_async_status;
}

/* This is intentionally pure: bank122 temporarily replaces bank130 in slot4,
   so the duplicate-display predicate may only inspect resident state. */
static uint8_t VN_CD_ASYNC_CODE command_matches_display_impl(const pce_vn_command_t *command)
{
    if (!command) return 0u;
    if (command->type == PCE_VN_COMMAND_BACKGROUND)
    {
        const uint8_t next_x = command->x < VN_MAP_WIDTH ? (uint8_t)command->x : 0u;
        const uint8_t next_y = command->y < VN_MAP_HEIGHT ? (uint8_t)command->y : 0u;
        if (pending_display_enable) return 0u;
        if (current_bg_index != command->asset_index || current_bg_x != next_x || current_bg_y != next_y) return 0u;
        if (!current_bg_display_valid) return 0u;
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (current_scene_full_screen_bg)
        {
            if (!full_screen_bg_text_vram_dirty) return 0u;
        }
        else if (full_screen_bg_text_vram_dirty)
        {
            return 0u;
        }
#endif
        return 1u;
    }
    if (command->type == PCE_VN_COMMAND_SPRITE)
    {
        const vn_sprite_slot_t *state;
        uint8_t slot;
        if (!(command->flags & PCE_VN_SPRITE_VISIBLE) || command->asset_index < 0) return 0u;
        if (pending_display_enable || pending_sprite_refresh || pending_scene_sprite_clear) return 0u;
        slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
        if (sprite_moves[slot].active || sync_sprite_move_slot == slot) return 0u;
        state = &sprite_slots[slot];
        if (!state->visible
            || state->sprite_index != command->asset_index
            || state->animation_index != command->animation_index
            || state->x != command->x
            || state->y != command->y
            || state->flags != command->flags)
        {
            return 0u;
        }
        if (!sprite_satb_layout_valid || !sprite_satb_slot_count[slot]) return 0u;
        return 1u;
    }
    return 0u;
}

static uint8_t VN_CD_ASYNC_ENTRY_CODE vn_cd_async_entry(uint8_t op)
{
    if (op == VN_CD_ASYNC_OP_BEGIN) return vn_cd_async_begin_impl();
    if (op == VN_CD_ASYNC_OP_SERVICE) return vn_cd_async_service_impl();
    if (op == VN_CD_ASYNC_OP_CANCEL)
    {
        vn_cd_async_status = VN_CD_ASYNC_STATUS_ERROR;
        return vn_cd_async_status;
    }
    if (op == VN_CD_ASYNC_OP_UPLOAD_PALETTE)
    {
        upload_palette_impl(vn_visual_cache_arg_ref, vn_visual_cache_arg_dest, vn_visual_cache_arg_x);
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_FADE_PALETTE)
    {
        fade_palette_impl(vn_visual_cache_arg_ref, vn_visual_cache_arg_dest,
            vn_visual_cache_arg_x, vn_visual_cache_arg_y);
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_CLEAR_MAP_RECT)
    {
        clear_map_rect_at_dest_impl(vn_visual_cache_arg_dest,
            vn_visual_cache_arg_x, vn_visual_cache_arg_y);
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_ADPCM_FITS_BUFFER)
    {
        return adpcm_voice_fits_buffer_impl();
    }
    if (op == VN_CD_ASYNC_OP_UPLOAD_SPRITE_TABLE)
    {
        upload_sprite_table_impl();
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_MAP_CHOICE_CURSOR)
    {
        map_choice_cursor_cells_impl(vn_visual_cache_arg_x, 0u);
        map_choice_cursor_cells_impl(vn_visual_cache_arg_y, 1u);
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_CLEAR_BG_MARGINS)
    {
        clear_bg_map_side_margins_impl(vn_visual_cache_arg_dest,
            vn_visual_cache_arg_x, vn_visual_cache_arg_y);
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_ADPCM_PLAYBACK)
    {
        service_adpcm_playback_impl();
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_MATCH_DISPLAY_COMMAND)
    {
        return command_matches_display_impl((const pce_vn_command_t *)(uintptr_t)vn_visual_cache_arg_asset);
    }
    if (op == VN_CD_ASYNC_OP_CLEAR_SPRITES)
    {
        clear_sprites_impl();
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_CANCEL_SPRITE_MOVE)
    {
        cancel_sprite_move_impl(vn_visual_cache_arg_slot);
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_CANCEL_ALL_SPRITE_MOVES)
    {
        cancel_all_sprite_moves_impl();
        return 1u;
    }
    if (op == VN_CD_ASYNC_OP_GET_SPRITE_ASSET)
    {
        vn_sprite_asset_result = vn_get_sprite_asset_impl(
            vn_visual_cache_arg_asset, vn_visual_cache_arg_slot);
        return vn_sprite_asset_result ? 1u : 0u;
    }
    if (op == VN_CD_ASYNC_OP_PLAN_SPRITE_LAYOUT)
    {
        return plan_scene_sprite_layout_impl();
    }
    if (op == VN_CD_ASYNC_OP_REFRESH_SPRITE_SLOT)
    {
        return refresh_scene_sprite_slot_upload_impl(
            vn_visual_cache_arg_slot, vn_visual_cache_arg_x);
    }
    return vn_cd_async_status;
}

static const vn_slot4_blob_descriptor_t vn_overlay_blob = {
    &pce_vn_overlay_data,
    (uint16_t)PCE_VN_OVERLAY_LOAD_ADDR,
    133u,
    VN_OVERLAY_RESERVED_SECTORS,
    (uint8_t *)0
};
static const vn_slot4_blob_descriptor_t vn_logic_overlay_blob = {
    &pce_vn_logic_overlay_data,
    (uint16_t)PCE_VN_LOGIC_OVERLAY_LOAD_ADDR,
    124u,
    VN_LOGIC_OVERLAY_RESERVED_SECTORS,
    (uint8_t *)0
};
static const vn_slot4_blob_descriptor_t vn_visual_cache_blob = {
    &pce_vn_visual_code_data,
    (uint16_t)PCE_VN_VISUAL_CODE_LOAD_ADDR,
    121u,
    VN_VISUAL_CODE_RESERVED_SECTORS,
    &vn_visual_cache_code_loaded
};
static const vn_slot4_blob_descriptor_t vn_cd_async_blob = {
    &pce_vn_cd_async_code_data,
    (uint16_t)PCE_VN_CD_ASYNC_CODE_LOAD_ADDR,
    122u,
    VN_CD_ASYNC_CODE_RESERVED_SECTORS,
    &vn_cd_async_code_loaded
};

/* Generic executable-blob loader for every bank that time-shares MPR4.
   Generated metadata is snapshotted while bank132 is visible, and both MPR4
   and MPR6 are restored exactly so this remains safe for future overlay
   callers as well as the current boot path. */
static uint8_t VN_BANKED_CODE vn_load_slot4_blob(const vn_slot4_blob_descriptor_t *descriptor)
{
    pce_vn_cd_data_ref_t ref;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t dest;
    uint8_t restore_mpr6;
    uint8_t slot4_bank;
    if (!descriptor || !descriptor->source_ref || !descriptor->reserved_sectors
        || descriptor->reserved_sectors > 4u) return 0u;
    if (descriptor->loaded_flag && *descriptor->loaded_flag) return 1u;
    slot4_bank = vn_slot4_current_bank();
    __asm__ volatile("tma #$40" : "=a"(restore_mpr6));
    map_vn_data();
    ref = *descriptor->source_ref;
    remaining = (uint16_t)(descriptor->reserved_sectors * VN_CD_SECTOR_BYTES);
    dest = descriptor->load_addr;
    if (ref.byte_size < remaining || ref.sector_count < descriptor->reserved_sectors)
    {
        __asm__ volatile("tam #$40" : : "a"(restore_mpr6));
        vn_slot4_map_bank(slot4_bank);
        return 0u;
    }
    prepare_cd_data_access();
    sector.lo = ref.sector.lo;
    sector.md = ref.sector.md;
    sector.hi = ref.sector.hi;
    vn_slot4_map_bank(descriptor->target_bank);
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_RAM_READ_CHUNK_BYTES ? VN_CD_RAM_READ_CHUNK_BYTES : remaining;
        uint8_t sectors = VN_CD_CHUNK_SECTOR_COUNT(chunk);
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, dest, chunk);
        cd_transfer_wait();
        dest = (uint16_t)(dest + chunk);
        remaining = (uint16_t)(remaining - chunk);
        while (sectors--) cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    __asm__ volatile("tam #$40" : : "a"(restore_mpr6));
    vn_slot4_map_bank(slot4_bank);
    if (descriptor->loaded_flag) *descriptor->loaded_flag = 1u;
    return 1u;
}

static void load_overlay_code(void)
{
    (void)vn_load_slot4_blob(&vn_overlay_blob);
}

static void VN_BANKED_CODE load_logic_overlay_code(void)
{
    (void)vn_load_slot4_blob(&vn_logic_overlay_blob);
}

static void VN_BANKED_CODE load_cd_async_code(void)
{
    (void)vn_load_slot4_blob(&vn_cd_async_blob);
}

static uint8_t VN_BANKED_CODE vn_cd_async_call_bank122(uint8_t op)
{
    uint8_t result;
    uint8_t restore_mpr6;
    const uint8_t slot4_bank = vn_slot4_current_bank();
    if (op <= VN_CD_ASYNC_OP_CANCEL)
    {
        restore_mpr6 = vn_cd_async_saved_mpr6;
    }
    else
    {
        __asm__ volatile("tma #$40" : "=a"(restore_mpr6));
    }
    pce_ram_bank122_map();
    result = VN_CD_ASYNC_CALL(op);
    __asm__ volatile("tam #$40" : : "a"(restore_mpr6));
    vn_slot4_map_bank(slot4_bank);
    return result;
}

static uint8_t VN_BANKED_CODE2 vn_cd_async_begin_data_read(pce_sector_t sector, uint8_t dest_kind, uint8_t dest_bank, uint16_t dest_addr, uint16_t byte_count)
{
    uint8_t sectors;
    if (!byte_count || byte_count > VN_CD_ASYNC_MAX_BYTES) return 0u;
    if (vn_cd_async_status == VN_CD_ASYNC_STATUS_ACTIVE) return 0u;
    if (dest_kind != VN_CD_ASYNC_DEST_BANK132 && dest_kind != VN_CD_ASYNC_DEST_SCENE_PACK_CACHE &&
        dest_kind != VN_CD_ASYNC_DEST_ADPCM_RAM && dest_kind != VN_CD_ASYNC_DEST_PSG_BANK) return 0u;
    if (!vn_cd_async_code_loaded) load_cd_async_code();
    if (!vn_cd_async_code_loaded) return 0u;
    sectors = VN_CD_CHUNK_SECTOR_COUNT(byte_count);
    if (!sectors || sectors > VN_CD_ASYNC_MAX_SECTORS) return 0u;
    vn_cd_async_sector = sector;
    vn_cd_async_dest_kind = dest_kind;
    vn_cd_async_dest_bank = dest_bank;
    __asm__ volatile("tma #$40" : "=a"(vn_cd_async_saved_mpr6));
    vn_cd_async_dest_addr = dest_addr;
    vn_cd_async_sector_count = sectors;
    vn_cd_async_store_remaining = byte_count;
    vn_cd_async_wire_remaining = (uint16_t)((uint16_t)sectors << 11);
    vn_cd_async_status_byte = 0xffu;
    vn_cd_async_message_byte = 0xffu;
    prepare_cd_data_access();
    sync_cd_external_irq_after_bios_call();
    vn_cd_bus_state = VN_CD_BUS_ASYNC_DATA;
    if (!vn_cd_async_call_bank122(VN_CD_ASYNC_OP_BEGIN))
    {
        vn_cd_async_status = VN_CD_ASYNC_STATUS_ERROR;
        vn_cd_bus_state = VN_CD_BUS_IDLE;
        resume_cdda_after_cd_data_access();
        return 0u;
    }
    return 1u;
}

static uint8_t VN_BANKED_CODE2 vn_cd_async_begin_scene_pack_read(pce_sector_t sector, uint16_t dest_addr, uint16_t byte_count)
{
    uint8_t sectors;
    if (!vn_cd_async_code_loaded) load_cd_async_code();
    sectors = VN_CD_CHUNK_SECTOR_COUNT(byte_count);
    vn_cd_async_sector = sector;
    vn_cd_async_dest_kind = VN_CD_ASYNC_DEST_SCENE_PACK_CACHE;
    vn_cd_async_dest_bank = 123u;
    __asm__ volatile("tma #$40" : "=a"(vn_cd_async_saved_mpr6));
    vn_cd_async_dest_addr = dest_addr;
    vn_cd_async_sector_count = sectors;
    vn_cd_async_store_remaining = byte_count;
    vn_cd_async_wire_remaining = (uint16_t)((uint16_t)sectors << 11);
    prepare_cd_data_access();
    sync_cd_external_irq_after_bios_call();
    vn_cd_bus_state = VN_CD_BUS_ASYNC_DATA;
    if (!vn_cd_async_call_bank122(VN_CD_ASYNC_OP_BEGIN))
    {
        vn_cd_async_status = VN_CD_ASYNC_STATUS_ERROR;
        vn_cd_bus_state = VN_CD_BUS_IDLE;
        resume_cdda_after_cd_data_access();
        return 0u;
    }
    return 1u;
}

static void VN_BANKED_CODE2 vn_cd_async_service_frame(void)
{
    if (vn_cd_async_status != VN_CD_ASYNC_STATUS_ACTIVE) return;
    (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_SERVICE);
    if (vn_cd_async_status == VN_CD_ASYNC_STATUS_DONE || vn_cd_async_status == VN_CD_ASYNC_STATUS_ERROR)
    {
        vn_cd_bus_state = VN_CD_BUS_IDLE;
        resume_cdda_after_cd_data_access();
    }
}

static uint8_t VN_BANKED_CODE2 vn_cd_async_done(void)
{
    return (uint8_t)(vn_cd_async_status == VN_CD_ASYNC_STATUS_DONE || vn_cd_async_status == VN_CD_ASYNC_STATUS_ERROR);
}

static uint8_t VN_BANKED_CODE2 vn_cd_async_succeeded(void)
{
    return (uint8_t)(vn_cd_async_status == VN_CD_ASYNC_STATUS_DONE);
}

static void VN_BANKED_CODE2 vn_cd_async_cancel(void)
{
    if (vn_cd_async_status == VN_CD_ASYNC_STATUS_ACTIVE)
    {
        (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_CANCEL);
    }
    vn_cd_async_status = VN_CD_ASYNC_STATUS_ERROR;
    vn_cd_bus_state = VN_CD_BUS_IDLE;
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
}

#endif /* PHASE_A_SPLIT */
