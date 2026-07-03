/* PHASE_A_SPLIT:BEGIN vn_psg_core.c — the (still edge-driven) PSG sequencer:
   wave load, step application (psg_apply_step_entry/span/row(_impl)),
   stop_psg, the CD pattern streaming into bank134/135, play_psg_asset,
   load_psg_cache_asset, tick_psg and the PSG metadata accessor. Moved
   verbatim from pce_vn_runtime.c (Phase A module split); the state-driven
   rewrite is Phase C. PHASE_A_SPLIT:END */
static pce_editor_psg_asset_t g_psg_cache;
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

static void VN_BANKED_CODE2 psg_set_voice(uint8_t channel, uint16_t period, uint8_t volume)
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

static void VN_OVERLAY_CODE psg_apply_step_entry(const pce_editor_psg_step_t *step)
{
    uint16_t resolved = (uint16_t)psg_base_channel + (uint16_t)step->channel;
    uint8_t ch;
    if (resolved > 5u) resolved = 5u;
    ch = (uint8_t)resolved;
    psg_used_mask = (uint8_t)(psg_used_mask | (uint8_t)(1u << ch));
    if (step->noise && ch >= 4u)
    {
        PCE_PSG_SELECT = (uint8_t)(ch & 0x07u);
        PCE_PSG_BALANCE = 0xffu;
        PCE_PSG_NOISE = step->volume ? (uint8_t)(0x80u | (step->period & 0x1fu)) : 0u;
        PCE_PSG_CONTROL = step->volume ? (uint8_t)(0x80u | (step->volume & 0x1fu)) : 0u;
    }
    else
    {
        PCE_PSG_SELECT = (uint8_t)(ch & 0x07u);
        if (ch >= 4u) PCE_PSG_NOISE = 0u;
        PCE_PSG_FREQ_LO = (uint8_t)(step->period & 0xffu);
        PCE_PSG_FREQ_HI = (uint8_t)((step->period >> 8) & 0x0fu);
        PCE_PSG_BALANCE = 0xffu;
        PCE_PSG_CONTROL = step->volume ? (uint8_t)(0x80u | (step->volume & 0x1fu)) : 0u;
    }
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

static void VN_BANKED_CODE2 stop_psg(void)
{
    uint8_t ch;
    for (ch = 0u; ch < 6u; ch++)
    {
        if (psg_used_mask & (uint8_t)(1u << ch))
        {
            psg_set_voice(ch, 0u, 0u);
        }
    }
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
    psg_apply_step_row(0u);
    psg_vblank_seen = 0u;
    vn_vblank_credit = 0u;
    vn_psg_synthetic_credit = 0u;
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

static void VN_BANKED_CODE2 tick_psg(void)
{
    uint16_t step_accum;
    if (!psg_active || !psg_current) return;
    step_accum = (uint16_t)(psg_step_accum + psg_step_delta(psg_current));
    if (step_accum < VN_PSG_STEP_ACCUM_UNIT)
    {
        psg_step_accum = step_accum;
        return;
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
            return;
        }
    }
    psg_apply_step_row(psg_step);
}

