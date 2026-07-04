/* PHASE_A_SPLIT:BEGIN vn_psg_core.c — the PSG sequencer: wave load, step
   application, stop_psg, the CD pattern streaming into bank134/135,
   play_psg_asset, load_psg_cache_asset and the PSG metadata accessor. Moved
   verbatim from pce_vn_runtime.c (Phase A module split). PHASE_A_SPLIT:END */
/* PHASE_C:BEGIN state-driven rewrite (design doc §4). psg_apply_step_entry now
   stores into psg_logical[] instead of writing PSG MMIO directly (still
   reached via the bank133 overlay for CD-streamed patterns, since the pattern
   walk still needs MPR6). psg_commit() is the new, separate diff-and-write
   step: it never touches the pattern bank, so it is callable from any
   context. tick_psg()/service_psg_ticks() (edge-driven, one MMIO write per
   changed step every tick) are replaced by psg_advance(n) (logical only) +
   psg_commit() (logical -> HW diff), called once per credit from
   engine_apply_credit(). See vn_engine_state.c for psg_logical/psg_dirty_mask
   and the RAM-budget note (a packed logical array + single dirty mask,
   computed at apply time, standing in for the design sketch's literal
   psg_shadow[] value array -- console_ram did not have room for both arrays
   even packed; see the final report). PHASE_C:END */
/* PHASE_C fix: g_psg_cache MUST stay out of the llvm-mos zero page. The runtime
   keeps MPR0 = I/O ($FF), so the C zero page is not at hardware page 0; taking
   the address of a .zp object yields a page-0 pointer (high byte 0x00) that the
   absolute/indirect load then reads at CPU 0x00xx (I/O) instead of the object's
   real MPR1 address 0x20xx. g_psg_cache's address is returned by
   vn_get_psg_asset() and stored in psg_current, then dereferenced as a far
   pointer (->bpm/->steps/->pattern_count). When the Phase C state (psg_logical)
   grew the zp allocation g_psg_cache got pulled into .zp, which silenced the PSG
   (psg_current read 0x00A0 instead of 0x20A0, so its fields were garbage).
   Pinning to .bss matches the existing pattern used for active_message_state /
   loaded_sprite_pattern_* etc.
   g_psg_pattern_cd's address is stored in g_psg_cache.pattern_cd, but that
   pointer is only ever null-tested (a zp 0x00xx address is still non-null), so
   it does NOT need pinning; g_psg_pattern_load_cd is only accessed by name
   (address never taken). Leaving those two in zp keeps the console_ram budget
   from overflowing. */
static pce_editor_psg_asset_t g_psg_cache __attribute__((section(".bss")));
static pce_editor_cd_data_ref_t g_psg_pattern_cd;
static pce_editor_cd_data_ref_t g_psg_pattern_load_cd;
static uint16_t g_psg_cache_key;
static uint16_t loaded_psg_pattern_key = 0u;

static const pce_editor_psg_asset_t *VN_BANKED_CODE vn_get_psg_asset(uint16_t idx)
{
    const uint8_t *p;
    const uint16_t key = (uint16_t)(idx + 1u);
    if (g_psg_cache_key == key) return &g_psg_cache;
    vn_read_meta_sector(&pce_editor_psg_meta.sector, (uint8_t)(idx / VN_META_PSG_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_PSG_PER_SECTOR) * PCE_EDITOR_META_PSG_SLOT)];
    g_psg_cache.is_song = p[PCE_EDITOR_META_PSG_IS_SONG];
    g_psg_cache.period = (unsigned int)p[PCE_EDITOR_META_PSG_PERIOD]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_PERIOD + 1u] << 8);
    g_psg_cache.bpm = (unsigned int)p[PCE_EDITOR_META_PSG_BPM]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_BPM + 1u] << 8);
    g_psg_cache.steps = (unsigned int)p[PCE_EDITOR_META_PSG_STEPS]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_STEPS + 1u] << 8);
    g_psg_cache.pattern_count = (unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_COUNT]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_COUNT + 1u] << 8);
    g_psg_cache.pattern = (const pce_editor_psg_step_t *)0;
    g_psg_pattern_cd.sector.lo = p[PCE_EDITOR_META_PSG_PATTERN_CD];
    g_psg_pattern_cd.sector.md = p[PCE_EDITOR_META_PSG_PATTERN_CD + 1u];
    g_psg_pattern_cd.sector.hi = p[PCE_EDITOR_META_PSG_PATTERN_CD + 2u];
    g_psg_pattern_cd.sector_count = (unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 3u]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 4u] << 8);
    g_psg_pattern_cd.byte_size = (unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 5u]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 6u] << 8);
    g_psg_pattern_cd.compression = p[PCE_EDITOR_META_PSG_PATTERN_CD + 7u];
    g_psg_cache.pattern_cd = g_psg_pattern_cd.sector_count ? &g_psg_pattern_cd : (const pce_editor_cd_data_ref_t *)0;
    g_psg_cache_key = key;
    return &g_psg_cache;
}

/* --- PSG sequencer ---------------------------------------------------------
 * Plays a generated PSG asset (psg-song loops, psg-sfx is one-shot) by walking
 * its step pattern one tracker-step at a time. The command's base channel is
 * added to each step's channel so the same asset can be routed to different
 * PSG voices; the resulting channel is clamped to the 6 available (0-5). */

static void VN_BANKED_CODE2 psg_load_basic_wave(uint8_t channel)
{
    uint8_t i;
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    /* Wave RAM is writable while the channel is stopped. 0x40 is DDA/direct
       mode on the HuC6280, so using it here leaves the tone waveform
       uninitialized and makes imported PSG sound like noise. */
    PCE_PSG_CONTROL = 0u;
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
    for (i = 0u; i < 32u; i++)
    {
        /* Simple square-ish timbre; the editor only stores tone/volume per step. */
        PCE_PSG_WAVE = (uint8_t)((i < 16u) ? 31u : 0u);
    }
}

/* PHASE_C bank-balance: moved from bank130 to bank129 (VN_BANKED_CODE) to make
   room for psg_advance in bank130 -- see the bank-balance note on psg_commit.
   Purely a placement change; only caller is stop_psg()'s immediate-silence
   path (unchanged behavior). */
static void VN_BANKED_CODE psg_set_voice(uint8_t channel, uint16_t period, uint8_t volume)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    /* Channels 4/5 share their control register with noise mode; clear R7 so a
       tone voice never inherits a previous noise enable. */
    if (channel >= 4u) PCE_PSG_NOISE = 0u;
    PCE_PSG_FREQ_LO = (uint8_t)(period & 0xffu);
    PCE_PSG_FREQ_HI = (uint8_t)((period >> 8) & 0x0fu);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static uint16_t VN_BANKED_CODE2 psg_step_delta(const pce_editor_psg_asset_t *asset)
{
    uint16_t bpm = (asset && asset->bpm) ? asset->bpm : 150u;
    if (bpm < 30u) bpm = 30u;
    if (bpm > 300u) bpm = 300u;
    return (uint16_t)(bpm * VN_PSG_STEPS_PER_BEAT);
}

/* PHASE_C: applies one pattern entry to psg_logical[] only -- no PSG MMIO.
   Reached from the pattern walk (psg_apply_step_span), which still runs from
   the bank133 overlay for CD-streamed patterns because it needs MPR6 mapped
   to bank134/135. Storing into psg_logical here (instead of writing
   registers) is what lets psg_advance() fast-forward multiple ticks without
   losing an intermediate note-off: psg_logical always holds the *last*
   entry applied for the channel, and psg_commit() (resident, no overlay)
   is what turns that into the minimal set of register writes later. */
static void VN_OVERLAY_CODE psg_apply_step_entry(const pce_editor_psg_step_t *step)
{
    uint16_t resolved = (uint16_t)psg_base_channel + (uint16_t)step->channel;
    uint8_t ch;
    uint8_t new_hi_noise;
    uint8_t bit;
    if (resolved > 5u) resolved = 5u;
    ch = (uint8_t)resolved;
    bit = (uint8_t)(1u << ch);
    psg_used_mask = (uint8_t)(psg_used_mask | bit);
    /* RAM-budget packing (see vn_engine_state.c note): period_hi_noise packs
       period bits 8-11 in the low nibble and the noise flag in bit7. */
    new_hi_noise = (uint8_t)(((step->period >> 8) & 0x0fu)
        | ((step->noise && ch >= 4u) ? 0x80u : 0u));
    /* Dirty-mask diff computed HERE (apply time), not in psg_commit(): this
       is the RAM-budget substitute for a separate psg_shadow[] value array
       (see the note in vn_engine_state.c). psg_logical[ch] always holds
       whatever psg_commit() last saw, so comparing the incoming step against
       the CURRENT psg_logical[ch] is equivalent to diffing against a value
       shadow -- only the timing of the comparison moved from commit-time to
       apply-time. The observable contract (psg_commit only rewrites channels
       whose logical state actually changed since the last commit) is
       unchanged. */
    if (psg_logical[ch].period_lo != (uint8_t)(step->period & 0xffu)
        || psg_logical[ch].period_hi_noise != new_hi_noise
        || psg_logical[ch].volume != step->volume)
    {
        psg_dirty_mask = (uint8_t)(psg_dirty_mask | bit);
    }
    psg_logical[ch].period_lo = (uint8_t)(step->period & 0xffu);
    psg_logical[ch].period_hi_noise = new_hi_noise;
    psg_logical[ch].volume = step->volume;
}

static void VN_BANKED_CODE2 psg_reset_pattern_cursors(void)
{
    psg_pattern_cursor = 0u;
    psg_vblank_seen = 0u;
}

static uint16_t VN_OVERLAY_CODE psg_apply_step_span(const pce_editor_psg_step_t *pattern,
    uint16_t count, uint16_t cursor, uint16_t step_no)
{
    while (cursor < count && pattern[cursor].step == step_no)
    {
        psg_apply_step_entry(&pattern[cursor]);
        cursor++;
    }
    return cursor;
}

static void VN_OVERLAY_CODE psg_apply_step_row_impl(uint16_t step_no)
{
    const pce_editor_psg_step_t *pattern = psg_active_pattern;
    if (!psg_current || !pattern) return;
#if defined(__PCE_CD__)
    /* CD-streamed patterns live in bank134/bank135; map MPR6 to the bank that
       owns the current half before reading. Small resident patterns are in
       .rodata and need no mapping. */
    if (psg_pattern_banked)
    {
        uint16_t cursor = psg_pattern_cursor;
        uint16_t first_count = psg_current->pattern_count;
        if (first_count > VN_PSG_PATTERN_BANK_ENTRIES) first_count = VN_PSG_PATTERN_BANK_ENTRIES;
        if (cursor < first_count)
        {
            pce_ram_bank134_map();
            pattern = (const pce_editor_psg_step_t *)psg_pattern_ram;
            cursor = psg_apply_step_span(pattern, first_count, cursor, step_no);
        }
        if (cursor >= first_count && psg_current->pattern_count > VN_PSG_PATTERN_BANK_ENTRIES)
        {
            const uint16_t second_count = (uint16_t)(psg_current->pattern_count - VN_PSG_PATTERN_BANK_ENTRIES);
            uint16_t second_cursor = (uint16_t)(cursor - first_count);
            pce_ram_bank135_map();
            pattern = (const pce_editor_psg_step_t *)psg_pattern_ram;
            second_cursor = psg_apply_step_span(pattern, second_count, second_cursor, step_no);
            cursor = (uint16_t)(first_count + second_cursor);
        }
        psg_pattern_cursor = cursor;
        map_vn_data();
        return;
    }
#endif
    psg_pattern_cursor = psg_apply_step_span(pattern, psg_current->pattern_count, psg_pattern_cursor, step_no);
}

static void VN_BANKED_CODE psg_apply_step_row(uint16_t step_no)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch_locked(VN_OVERLAY_OP_APPLY_PSG_STEP, step_no, 0u, 0u);
#else
    psg_apply_step_row_impl(step_no);
#endif
}

/* PHASE_C: silence every channel psg_used_mask records as used, then clear
   the sequencer state. This still uses psg_set_voice() (direct MMIO) rather
   than routing through psg_logical+psg_commit(), because stop_psg() must
   guarantee the channels go silent immediately even if psg_used_mask
   under-reports (e.g. a channel the pattern touched before a mid-song stop);
   psg_logical/psg_dirty_mask are cleared afterwards so a subsequent
   psg_commit() (e.g. from a delayed engine_apply_credit call already in
   flight) does not re-apply stale state and re-trigger a note. */
static void VN_BANKED_CODE2 stop_psg(void)
{
    uint8_t ch;
    for (ch = 0u; ch < 6u; ch++)
    {
        if (psg_used_mask & (uint8_t)(1u << ch))
        {
            psg_set_voice(ch, 0u, 0u);
        }
        psg_logical[ch].period_lo = 0u;
        psg_logical[ch].period_hi_noise = 0u;
        psg_logical[ch].volume = 0u;
    }
    psg_dirty_mask = 0u; /* HW already silenced above; nothing pending to commit. */
    psg_active = 0u;
    psg_is_song = 0u;
    psg_used_mask = 0u;
    psg_step = 0u;
    psg_step_accum = 0u;
    psg_reset_pattern_cursors();
    psg_current = (const pce_editor_psg_asset_t *)0;
    psg_active_pattern = (const pce_editor_psg_step_t *)0;
    psg_pattern_banked = 0u;
}

/* PHASE_C: write only the PSG registers for channels marked dirty since the
   last commit (design doc §4.2/§4.3, RAM-budget variant -- see the note on
   psg_logical/psg_dirty_mask in vn_engine_state.c). psg_dirty_mask is set at
   apply time by psg_apply_step_entry(); psg_mark_hw_dirty() ORs in every
   psg_used_mask channel for a full resync, because a BIOS helper may have
   clobbered the PSG SELECT latch or other shared state. Never
   reads the pattern bank (bank134/135) or maps MPR6, so it is safe to call
   from any context, including immediately after a BIOS helper returns while
   MPR6 is still mapped to CD scratch/metadata. Placed in bank128
   (VN_RESIDENT_CODE): bank129/bank130 had no combined spare room for this
   new function after psg_advance replaced tick_psg() (see the bank-balance
   note in the final report); bank128+bank129+bank130+bank133 combined have
   enough total headroom even though no single one of them does. The whole
   point of this split is that committing no longer needs the bank133 overlay
   at all -- placement among the co-resident banks is just a byte-budget
   balancing choice (128/129/130 are simultaneously mapped, so the call is
   transparent regardless of which one holds it), not a functional
   requirement. */
static void VN_RESIDENT_CODE psg_commit(void)
{
    uint8_t ch;
    uint8_t dirty = psg_dirty_mask;
    if (!dirty) return;
    for (ch = 0u; ch < 6u; ch++)
    {
        const uint8_t bit = (uint8_t)(1u << ch);
        vn_psg_channel_state_t *want;
        uint8_t gate;
        uint8_t noise;
        if (!(dirty & bit)) continue;
        want = &psg_logical[ch];
        /* Shared ON/OFF gate bit: 0x80 when the channel should sound, 0 when
           silent. Used both for CONTROL's volume field and NOISE's period
           field (they gate the same way, only the low bits differ). */
        gate = want->volume ? 0x80u : 0u;
        noise = (uint8_t)(want->period_hi_noise & 0x80u);
        PCE_PSG_SELECT = (uint8_t)(ch & 0x07u);
        PCE_PSG_BALANCE = 0xffu;
        if (noise)
        {
            PCE_PSG_NOISE = (uint8_t)(gate | (want->period_lo & 0x1fu));
        }
        else
        {
            if (ch >= 4u) PCE_PSG_NOISE = 0u;
            PCE_PSG_FREQ_LO = want->period_lo;
            PCE_PSG_FREQ_HI = (uint8_t)(want->period_hi_noise & 0x0fu);
        }
        PCE_PSG_CONTROL = (uint8_t)(gate | (want->volume & 0x1fu));
    }
    psg_dirty_mask = 0u;
}

/* PHASE_C: force every active channel to be re-written on the next
   psg_commit(). Called by engine_bus after EVERY BIOS helper returns
   (sync_cd_external_irq_after_bios_call, the common BIOS-helper-close point),
   because the BIOS may have touched the PSG SELECT latch or other shared
   state. ORing psg_used_mask into psg_dirty_mask makes the next commit a full
   resync of the sounding channels without needing a separate valid flag. */
static void VN_RESIDENT_CODE psg_mark_hw_dirty(void)
{
    psg_dirty_mask = (uint8_t)(psg_dirty_mask | psg_used_mask);
}

#if defined(__PCE_CD__)
/* Stream the active song's step pattern from CD into bank134/bank135 RAM. Each
   bank is mapped into slot 6 (0xc000) as the read destination. Mirrors
   load_scene_pack_into_cache's CD-read loop (CD-DA pause/resume + external IRQ
   handling via prepare/resume); the pattern's CD ref lives in bank132, so MPR6
   maps bank132 to read it, then bank134 to receive the bytes. */
static uint8_t VN_VISUAL_CACHE_CODE load_psg_pattern_cd_impl(void)
{
    pce_editor_cd_data_ref_t ref;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint8_t bank = 0u;
    map_vn_data();              /* MPR6 = bank132: read the CD ref descriptor. */
    ref.sector.lo = g_psg_pattern_load_cd.sector.lo;
    ref.sector.md = g_psg_pattern_load_cd.sector.md;
    ref.sector.hi = g_psg_pattern_load_cd.sector.hi;
    ref.sector_count = g_psg_pattern_load_cd.sector_count;
    ref.byte_size = g_psg_pattern_load_cd.byte_size;
    if (!ref.byte_size || ref.byte_size > VN_PSG_PATTERN_BUFFER_BYTES || !ref.sector_count) return 0u;
    prepare_cd_data_access();
    sector.lo = ref.sector.lo;
    sector.md = ref.sector.md;
    sector.hi = ref.sector.hi;
    remaining = ref.byte_size;
    while (remaining && bank < 2u)
    {
        uint16_t offset = 0u;
        uint16_t bank_remaining = remaining > VN_PSG_PATTERN_BANK_BYTES ? VN_PSG_PATTERN_BANK_BYTES : remaining;
        if (bank == 0u)
        {
            pce_ram_bank134_map();      /* MPR6 = bank134: first CD read destination. */
        }
        else
        {
            pce_ram_bank135_map();      /* MPR6 = bank135: overflow pattern entries. */
        }
        while (bank_remaining)
        {
            const uint16_t chunk = bank_remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : bank_remaining;
            (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)&psg_pattern_ram[offset], chunk);
            cd_transfer_wait();
            remaining = (uint16_t)(remaining - chunk);
            bank_remaining = (uint16_t)(bank_remaining - chunk);
            offset = (uint16_t)(offset + chunk);
            cd_sector_advance(&sector);
        }
        bank++;
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    return 1u;
}

static uint8_t VN_BANKED_CODE load_prepared_psg_pattern_cd(void)
{
    uint8_t result;
    if (!g_psg_pattern_load_cd.sector_count) return 0u;
    load_visual_cache_code();
    result = visual_cache_call(VN_VISUAL_CACHE_OP_LOAD_PSG_PATTERN);
    map_vn_data();
    return result;
}

static uint8_t VN_BANKED_CODE prepare_psg_pattern_load_ref(uint16_t idx)
{
    const uint8_t *p;
    vn_read_meta_sector(&pce_editor_psg_meta.sector, (uint8_t)(idx / VN_META_PSG_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_PSG_PER_SECTOR) * PCE_EDITOR_META_PSG_SLOT)];
    g_psg_pattern_load_cd.sector.lo = p[PCE_EDITOR_META_PSG_PATTERN_CD];
    g_psg_pattern_load_cd.sector.md = p[PCE_EDITOR_META_PSG_PATTERN_CD + 1u];
    g_psg_pattern_load_cd.sector.hi = p[PCE_EDITOR_META_PSG_PATTERN_CD + 2u];
    g_psg_pattern_load_cd.sector_count = (unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 3u]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 4u] << 8);
    g_psg_pattern_load_cd.byte_size = (unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 5u]
        | ((unsigned int)p[PCE_EDITOR_META_PSG_PATTERN_CD + 6u] << 8);
    return g_psg_pattern_load_cd.sector_count ? 1u : 0u;
}
#endif

static void VN_BANKED_CODE2 play_psg_asset(signed int asset_index, uint8_t base_channel)
{
    uint8_t ch;
    uint16_t target_index;
#if defined(__PCE_CD__)
    uint16_t target_key;
    uint8_t target_is_banked = 0u;
#endif
    if (asset_index < 0 || (unsigned int)asset_index >= pce_editor_psg_asset_count) return;
    target_index = (uint16_t)asset_index;
#if defined(__PCE_CD__)
    target_key = (uint16_t)(target_index + 1u);
    target_is_banked = (loaded_psg_pattern_key == target_key) ? 1u : prepare_psg_pattern_load_ref(target_index);
    if (target_is_banked)
    {
        if (loaded_psg_pattern_key != target_key)
        {
            if (psg_active && psg_pattern_banked)
            {
                stop_psg();
            }
            loaded_psg_pattern_key = 0u;
            if (!load_prepared_psg_pattern_cd())
            {
                return;
            }
            loaded_psg_pattern_key = target_key;
        }
        stop_psg();
        psg_current = vn_get_psg_asset(target_index);
    }
    else
#endif
    {
        stop_psg();
        psg_current = vn_get_psg_asset(target_index);
    }
    psg_base_channel = base_channel > 5u ? 5u : base_channel;
    psg_is_song = psg_current->is_song ? 1u : 0u;
    psg_step = 0u;
    psg_step_accum = 0u;
    psg_reset_pattern_cursors();
    psg_used_mask = 0u;
    if (!psg_current->pattern_count)
    {
        psg_current = (const pce_editor_psg_asset_t *)0;
        return;
    }
    /* Resolve the pattern source: large songs stream from CD into bank134, small
       SFX use their resident .rodata array directly. */
#if defined(__PCE_CD__)
    if (psg_current->pattern_cd)
    {
        if (loaded_psg_pattern_key != target_key)
        {
            psg_current = (const pce_editor_psg_asset_t *)0;
            return;
        }
        psg_active_pattern = (const pce_editor_psg_step_t *)psg_pattern_ram;
        psg_pattern_banked = 1u;
    }
    else
#endif
    {
        if (!psg_current->pattern)
        {
            psg_current = (const pce_editor_psg_asset_t *)0;
            return;
        }
        psg_active_pattern = psg_current->pattern;
        psg_pattern_banked = 0u;
    }
    PCE_PSG_GLOBAL = 0xffu;
    /* Pre-load a waveform into every channel the pattern may reach. */
    for (ch = psg_base_channel; ch <= 5u; ch++)
    {
        psg_load_basic_wave(ch);
    }
    psg_active = 1u;
    /* PHASE_C: psg_apply_step_row() only updates psg_logical[] now (see
       psg_apply_step_entry, which marks channels dirty against the
       freshly-silenced psg_logical[] left by stop_psg() above); psg_commit()
       is what actually starts the sound by writing the dirty channels. */
    psg_apply_step_row(0u);
    psg_commit();
    psg_vblank_seen = 0u;
    vn_vblank_credit = 0u;
}

static uint8_t VN_BANKED_CODE2 load_psg_cache_asset(signed int asset_index)
{
#if defined(__PCE_CD__)
    uint16_t target_index;
    uint16_t target_key;
    if (asset_index < 0) return 0u;
    if ((unsigned int)asset_index >= pce_editor_psg_asset_count) return 0u;
    target_index = (uint16_t)asset_index;
    target_key = (uint16_t)(target_index + 1u);
    if (loaded_psg_pattern_key == target_key) return 1u;
    if (psg_active && psg_pattern_banked) return 0u;
    if (!prepare_psg_pattern_load_ref(target_index)) return 1u;
    loaded_psg_pattern_key = 0u;
    if (!load_prepared_psg_pattern_cd())
    {
        return 0u;
    }
    loaded_psg_pattern_key = target_key;
    return 1u;
#else
    (void)asset_index;
    return 0u;
#endif
}

/* PHASE_C: advance the logical sequencer state by n ticks (design doc §4.2).
   Reads the pattern (bank134/135 via the overlay, or resident .rodata) but
   touches NO PSG MMIO -- psg_apply_step_row()/psg_apply_step_entry() only
   store into psg_logical[]. Safe to call from any blocking context: it never
   maps MPR4/slot4 for hardware access itself (only the overlay dispatch
   inside psg_apply_step_row temporarily swaps slot4/MPR6, and that is
   skipped entirely for ticks that do not cross a step boundary -- design doc
   §4.3 / task instructions: "1 credit で step 境界を跨がないフレームでは
   overlay dispatch を呼ばない").
   Loop wrap (psg_step >= psg_current->steps, song loops) resets cursor/step
   only; psg_logical is left untouched so the loop restart does not
   re-silence every channel (the real HW doesn't cut out at a loop point --
   see design doc §4.3, this must not regress back to a full stop_psg()-style
   reset here). */
static void VN_BANKED_CODE2 psg_advance(uint8_t n)
{
    uint16_t step_accum;
    while (n--)
    {
        if (!psg_active || !psg_current) return;
        step_accum = (uint16_t)(psg_step_accum + psg_step_delta(psg_current));
        if (step_accum < VN_PSG_STEP_ACCUM_UNIT)
        {
            psg_step_accum = step_accum;
            continue;
        }
        psg_step_accum = (uint16_t)(step_accum - VN_PSG_STEP_ACCUM_UNIT);
        psg_step++;
        if (psg_step >= psg_current->steps)
        {
            if (psg_is_song)
            {
                psg_step = 0u;
                psg_reset_pattern_cursors();
            }
            else
            {
                stop_psg();
                continue;
            }
        }
        psg_apply_step_row(psg_step);
    }
}

