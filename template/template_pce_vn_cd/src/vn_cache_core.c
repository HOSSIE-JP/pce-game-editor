/* PHASE_A_SPLIT:BEGIN vn_cache_core.c — the visual payload cache (bank121
   code + bank104-119 pages), CD->VRAM data movers (cd_data_ref_to_vram /
   cd_bg_map_ref_to_vram / copy_data_ref_to_vram), the CD on-demand asset
   metadata accessors (vn_read_meta_sector / vn_get_bg/sprite/adpcm_asset) and
   the runtime cache load/clear commands. Moved verbatim from pce_vn_runtime.c
   (Phase A module split). PHASE_A_SPLIT:END */
/* PHASE_A_SPLIT:BEGIN forward declarations added by the Phase A module split.
   load_runtime_cache dispatches into PSG/ADPCM loaders that now live in
   later-included module files; clear_runtime_cache touches their cache keys. */
static uint8_t VN_BANKED_CODE2 load_psg_cache_asset(signed int asset_index);
static uint8_t VN_BANKED_CODE2 load_adpcm_voice(signed int voice_index, uint8_t allow_stop_playback, uint8_t allow_stream_asset, uint8_t chunk_sectors);
static uint8_t VN_RESIDENT_CODE adpcm_playback_active(void);
static uint16_t loaded_psg_pattern_key;
#if defined(__PCE_CD__)
static uint8_t message_glyph_cache_valid __attribute__((section(".bss")));
#endif
/* PHASE_A_SPLIT:END */
#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_VISUAL_CACHE_CODE visual_cache_map_page_bank_impl(uint8_t page)
{
    uint8_t bank = (uint8_t)(VN_VISUAL_CACHE_FIRST_BANK + page);
    __asm__ volatile("tam #(1 << 6)" : : "a"(bank) : "p");
}

static uint8_t *VN_VISUAL_CACHE_CODE visual_cache_page_ptr_impl(uint8_t page)
{
    uint8_t p = page;
    if (p >= VN_VISUAL_CACHE_PAGE_COUNT) p = (uint8_t)(VN_VISUAL_CACHE_PAGE_COUNT - 1u);
    visual_cache_map_page_bank_impl(p);
    return VN_VISUAL_CACHE_PAGE_ADDR;
}

static void VN_VISUAL_CACHE_CODE visual_cache_copy_scratch_to_page_impl(uint8_t page, uint16_t page_offset, uint16_t length)
{
    uint16_t copied = 0u;
    while (copied < length)
    {
        uint8_t i;
        uint8_t *page_data;
        uint16_t chunk = (uint16_t)(length - copied);
        if (chunk > VN_VISUAL_CACHE_COPY_CHUNK) chunk = VN_VISUAL_CACHE_COPY_CHUNK;
        map_vn_data();
        for (i = 0u; i < chunk; i++)
        {
            vn_visual_cache_copy_buffer[i] = cd_transfer_scratch[(uint16_t)(copied + i)];
        }
        page_data = visual_cache_page_ptr_impl(page);
        for (i = 0u; i < chunk; i++)
        {
            page_data[(uint16_t)(page_offset + copied + i)] = vn_visual_cache_copy_buffer[i];
        }
        copied = (uint16_t)(copied + chunk);
    }
    VN_MAP_VISUAL_CACHE_CODE();
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_next_lru_impl(void)
{
    uint8_t i;
    vn_visual_cache_clock++;
    if (vn_visual_cache_clock) return vn_visual_cache_clock;
    vn_visual_cache_clock = 1u;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        if (vn_visual_cache_valid[i]) vn_visual_cache_lru[i] = 1u;
    }
    return vn_visual_cache_clock;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_find_impl(uint8_t kind, uint16_t asset_index, uint8_t part)
{
    uint8_t i;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        if (vn_visual_cache_valid[i]
            && vn_visual_cache_kind[i] == kind
            && vn_visual_cache_asset[i] == asset_index
            && vn_visual_cache_part[i] == part)
        {
            vn_visual_cache_lru[i] = visual_cache_next_lru_impl();
            return i;
        }
    }
    return 0xffu;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_alloc_impl(uint8_t kind, uint16_t asset_index, uint8_t part)
{
    uint8_t i;
    uint8_t victim = 0u;
    uint8_t oldest = 0xffu;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        if (!vn_visual_cache_valid[i])
        {
            victim = i;
            break;
        }
        if (vn_visual_cache_lru[i] < oldest)
        {
            oldest = vn_visual_cache_lru[i];
            victim = i;
        }
    }
    vn_visual_cache_valid[victim] = 1u;
    vn_visual_cache_kind[victim] = kind;
    vn_visual_cache_asset[victim] = asset_index;
    vn_visual_cache_part[victim] = part;
    vn_visual_cache_size[victim] = 0u;
    vn_visual_cache_lru[victim] = visual_cache_next_lru_impl();
    return victim;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_ref_to_vram_impl(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref);

static void VN_VISUAL_CACHE_CODE visual_cache_invalidate_impl(uint8_t scope)
{
    uint8_t i;
    volatile uint8_t cache_scope = scope;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        uint8_t clear_entry = 0u;
        uint8_t kind;
        if (!vn_visual_cache_valid[i]) continue;
        kind = vn_visual_cache_kind[i];
        if (cache_scope == PCE_VN_CACHE_SCOPE_VISUAL)
        {
            clear_entry = 1u;
        }
        else if (cache_scope == PCE_VN_CACHE_SCOPE_ALL)
        {
            clear_entry = 1u;
        }
        else if (cache_scope == PCE_VN_CACHE_SCOPE_BG)
        {
            if (kind == VN_VISUAL_CACHE_KIND_BG_TILES) clear_entry = 1u;
            else if (kind == VN_VISUAL_CACHE_KIND_BG_MAP) clear_entry = 1u;
        }
        else if (cache_scope == PCE_VN_CACHE_SCOPE_SPRITE)
        {
            if (kind == VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS) clear_entry = 1u;
        }
        if (clear_entry)
        {
            vn_visual_cache_valid[i] = 0u;
            vn_visual_cache_kind[i] = VN_VISUAL_CACHE_KIND_NONE;
            vn_visual_cache_size[i] = 0u;
        }
    }
}

static void VN_VISUAL_CACHE_CODE cd_transfer_wait_visual_cache_impl(void)
{
    volatile uint16_t wait;
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
    uint8_t est;
    for (est = 0u; est < VN_CD_CHUNK_ESTIMATED_FRAMES; est++) VN_ADD_ESTIMATED_FRAME();
#endif
    if (psg_active && !psg_pattern_banked)
    {
        uint8_t slice;
        for (slice = 0u; slice < VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES; slice++)
        {
            for (wait = 0u; wait < (65535u / VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES); wait++) {}
            service_psg_compensation_ticks(1u, 1u);
        }
        return;
    }
    for (wait = 0u; wait < 65535u; wait++) {}
    service_psg_compensation_ticks(VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES, 1u);
}

static void VN_VISUAL_CACHE_CODE vram_copy_sliced_from_visual_code_impl(uint16_t dest, const uint8_t *source, uint16_t length)
{
    uint16_t offset = 0u;
    uint16_t vram_dest = dest;
    while (length)
    {
        const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES();
        uint16_t chunk = length > slice_bytes ? slice_bytes : length;
        pce_editor_vram_copy(vram_dest, &source[offset], chunk);
        service_psg_during_visual_cache_work();
        map_vn_data();
        VN_MAP_VISUAL_CACHE_CODE();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        offset = (uint16_t)(offset + chunk);
        length = (uint16_t)(length - chunk);
    }
}

static uint8_t VN_VISUAL_CACHE_CODE cd_data_ref_to_vram_visual_impl(uint16_t dest, const pce_editor_data_ref_t *ref)
{
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest;
    map_vn_data();
    VN_MAP_VISUAL_CACHE_CODE();
    if (!ref || !ref->cd || !ref->cd->sector_count || !ref->size) return 0u;
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, &ref->cd->sector);
    remaining = (uint16_t)ref->size;
    vram_dest = dest;
    map_vn_data();
    VN_MAP_VISUAL_CACHE_CODE();
    while (remaining)
    {
        uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        prepare_cd_data_access();
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait_visual_cache_impl();
        finish_cd_data_read_before_vram_copy();
        VN_MAP_VISUAL_CACHE_CODE();
        vram_copy_sliced_from_visual_code_impl(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    VN_MAP_VISUAL_CACHE_CODE();
    return 1u;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_copy_ref_to_vram_impl(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    if (kind != VN_VISUAL_CACHE_KIND_NONE
        && visual_cache_ref_to_vram_impl(dest, kind, asset_index, ref))
    {
        return 1u;
    }
    return cd_data_ref_to_vram_visual_impl(dest, ref);
}

static void VN_VISUAL_CACHE_CODE visual_cache_page_to_vram_impl(uint16_t dest, uint8_t page, uint16_t page_offset, uint16_t length)
{
    uint16_t vram_dest = dest;
    while (length)
    {
        uint8_t *page_data = visual_cache_page_ptr_impl(page);
        const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES();
        uint16_t chunk = length > slice_bytes ? slice_bytes : length;
        pce_editor_vram_copy(vram_dest, &page_data[page_offset], chunk);
        service_psg_during_visual_cache_work();
        page_offset = (uint16_t)(page_offset + chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        length = (uint16_t)(length - chunk);
    }
    map_vn_data();
    VN_MAP_VISUAL_CACHE_CODE();
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_has_ref_impl(uint8_t kind, uint16_t asset_index, uint16_t size)
{
    uint8_t part = 0u;
    unsigned long offset = 0ul;
    if (!size) return 0u;
    while (offset < (unsigned long)size)
    {
        const uint16_t remaining = (uint16_t)((unsigned long)size - offset);
        const uint16_t expected = remaining > VN_VISUAL_CACHE_PAGE_BYTES ? VN_VISUAL_CACHE_PAGE_BYTES : remaining;
        uint8_t slot = visual_cache_find_impl(kind, asset_index, part);
        if (slot == 0xffu || vn_visual_cache_size[slot] < expected) return 0u;
        offset += (unsigned long)VN_VISUAL_CACHE_PAGE_BYTES;
        part++;
    }
    return 1u;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_ref_to_vram_impl(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    unsigned long offset = 0ul;
    uint16_t remaining;
    uint16_t vram_dest = dest;
    if (!ref || !ref->size) return 0u;
    if (!visual_cache_has_ref_impl(kind, asset_index, (uint16_t)ref->size)) return 0u;
    remaining = (uint16_t)ref->size;
    while (remaining)
    {
        const uint8_t part = (uint8_t)(offset / VN_VISUAL_CACHE_PAGE_BYTES);
        const uint16_t page_offset = (uint16_t)(offset & (VN_VISUAL_CACHE_PAGE_BYTES - 1u));
        const uint8_t slot = visual_cache_find_impl(kind, asset_index, part);
        uint16_t chunk = (uint16_t)(VN_VISUAL_CACHE_PAGE_BYTES - page_offset);
        if (chunk > remaining) chunk = remaining;
        visual_cache_page_to_vram_impl(vram_dest, slot, page_offset, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        offset += (unsigned long)chunk;
        remaining = (uint16_t)(remaining - chunk);
    }
    return 1u;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_copy_span_to_vram_impl(uint16_t dest, uint8_t kind, uint16_t asset_index, unsigned long source_offset, uint16_t length)
{
    uint16_t remaining = length;
    uint16_t vram_dest = dest;
    while (remaining)
    {
        const uint8_t part = (uint8_t)(source_offset / VN_VISUAL_CACHE_PAGE_BYTES);
        const uint16_t page_offset = (uint16_t)(source_offset & (VN_VISUAL_CACHE_PAGE_BYTES - 1u));
        const uint8_t slot = visual_cache_find_impl(kind, asset_index, part);
        uint16_t chunk = (uint16_t)(VN_VISUAL_CACHE_PAGE_BYTES - page_offset);
        if (slot == 0xffu) return 0u;
        if (chunk > remaining) chunk = remaining;
        if ((uint16_t)(page_offset + chunk) > vn_visual_cache_size[slot]) return 0u;
        visual_cache_page_to_vram_impl(vram_dest, slot, page_offset, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        source_offset += (unsigned long)chunk;
        remaining = (uint16_t)(remaining - chunk);
    }
    return 1u;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_bg_map_to_vram_impl(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t *ref, uint8_t width_tiles, uint8_t height_tiles)
{
    uint8_t row;
    const uint16_t row_bytes = (uint16_t)(width_tiles * 2u);
    if (!ref) return 0u;
    if (!visual_cache_has_ref_impl(VN_VISUAL_CACHE_KIND_BG_MAP, asset_index, (uint16_t)ref->size)) return 0u;
    for (row = 0u; row < height_tiles; row++)
    {
        const unsigned long source_offset = (unsigned long)row * (unsigned long)VN_MAP_ROW_BYTES;
        if (!visual_cache_copy_span_to_vram_impl(
            (uint16_t)(dest + ((uint16_t)row * VN_MAP_WIDTH)),
            VN_VISUAL_CACHE_KIND_BG_MAP,
            asset_index,
            source_offset,
            row_bytes))
        {
            return 0u;
        }
    }
    return 1u;
}

static uint8_t VN_VISUAL_CACHE_CODE visual_cache_load_cd_part_impl(uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref, uint8_t part)
{
    pce_editor_cd_data_ref_t cd_ref;
    pce_sector_t sector = {0};
    uint8_t slot;
    uint16_t remaining;
    uint16_t page_offset = 0u;
    unsigned long byte_offset;
    unsigned long available;
    if (!ref || !ref->size) return 0u;
    map_vn_data();
    if (!ref->cd || !ref->cd->sector_count || !ref->cd->byte_size) return 0u;
    if (ref->cd->compression != PCE_EDITOR_CD_COMPRESSION_NONE) return 0u;
    if (visual_cache_find_impl(kind, asset_index, part) != 0xffu) return 1u;
    cd_ref = *ref->cd;
    byte_offset = (unsigned long)part * (unsigned long)VN_VISUAL_CACHE_PAGE_BYTES;
    if (byte_offset >= (unsigned long)ref->size) return 0u;
    available = (unsigned long)ref->size - byte_offset;
    remaining = available > VN_VISUAL_CACHE_PAGE_BYTES ? VN_VISUAL_CACHE_PAGE_BYTES : (uint16_t)available;
    cd_sector_from_ref(&sector, &cd_ref.sector);
    {
        uint8_t sector_skip = (uint8_t)(part * 4u);
        while (sector_skip--) cd_sector_advance(&sector);
    }
    slot = visual_cache_alloc_impl(kind, asset_index, part);
    while (remaining)
    {
        uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        prepare_cd_data_access();
        map_vn_data();
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait_visual_cache_impl();
        visual_cache_copy_scratch_to_page_impl(slot, page_offset, chunk);
        page_offset = (uint16_t)(page_offset + chunk);
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    vn_visual_cache_size[slot] = page_offset;
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    map_vn_data();
    VN_MAP_VISUAL_CACHE_CODE();
    return 1u;
}

static void VN_VISUAL_CACHE_CODE visual_cache_preload_ref_impl(uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    uint8_t part = 0u;
    unsigned long offset = 0ul;
    if (!ref || !ref->size || !ref->cd) return;
    while (offset < (unsigned long)ref->size)
    {
        if (!visual_cache_load_cd_part_impl(kind, asset_index, ref, part)) return;
        offset += (unsigned long)VN_VISUAL_CACHE_PAGE_BYTES;
        part++;
    }
}

static uint8_t VN_VISUAL_CACHE_ENTRY_CODE visual_cache_entry(uint8_t op)
{
    volatile uint8_t visual_op = op;
    if (visual_op == VN_VISUAL_CACHE_OP_REF_TO_VRAM)
    {
        return visual_cache_ref_to_vram_impl(vn_visual_cache_arg_dest, vn_visual_cache_arg_kind, vn_visual_cache_arg_asset, vn_visual_cache_arg_ref);
    }
    if (visual_op == VN_VISUAL_CACHE_OP_BG_MAP_TO_VRAM)
    {
        return visual_cache_bg_map_to_vram_impl(vn_visual_cache_arg_dest, vn_visual_cache_arg_asset, vn_visual_cache_arg_ref, vn_visual_cache_arg_x, vn_visual_cache_arg_y);
    }
    if (visual_op == VN_VISUAL_CACHE_OP_PRELOAD_REF)
    {
        visual_cache_preload_ref_impl(vn_visual_cache_arg_kind, vn_visual_cache_arg_asset, vn_visual_cache_arg_ref);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_INVALIDATE)
    {
        visual_cache_invalidate_impl(vn_visual_cache_arg_scope);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_COPY_REF_TO_VRAM)
    {
        return visual_cache_copy_ref_to_vram_impl(vn_visual_cache_arg_dest, vn_visual_cache_arg_kind, vn_visual_cache_arg_asset, vn_visual_cache_arg_ref);
    }
    if (visual_op == VN_VISUAL_CACHE_OP_LOAD_PSG_PATTERN)
    {
        return load_psg_pattern_cd_impl();
    }
    if (visual_op == VN_VISUAL_CACHE_OP_DRAW_SPRITETEXT)
    {
        return draw_spritetext_slots_impl(vn_visual_cache_arg_slot);
    }
    if (visual_op == VN_VISUAL_CACHE_OP_CLEAR_RUNTIME_CACHE)
    {
        clear_runtime_cache_impl(vn_visual_cache_arg_scope);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_TICK_SPRITE_ANIMATIONS)
    {
        tick_sprite_animations_impl();
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_FADE_SCREEN)
    {
        fade_current_screen_to_color_impl(vn_visual_cache_arg_dest, vn_visual_cache_arg_x);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_RESTORE_SCREEN_PALETTE)
    {
        restore_current_screen_palette_impl();
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_FLASH_SCREEN)
    {
        flash_screen_color_impl(vn_visual_cache_arg_dest, vn_visual_cache_arg_x);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_SERVICE_CDDA)
    {
        service_cdda_playback_impl();
        return 0u;
    }
    return 0u;
}

typedef uint8_t (*vn_visual_cache_entry_fn_t)(uint8_t op);

static uint8_t VN_RESIDENT_CODE visual_cache_call(uint8_t op)
{
    uint8_t result;
    VN_MAP_VISUAL_CACHE_CODE();
    result = ((vn_visual_cache_entry_fn_t)PCE_VN_VISUAL_CODE_LOAD_ADDR)(op);
    VN_MAP_BANK130_FOR_CODE();
    return result;
}

static void VN_BANKED_CODE vram_copy_sliced_from_vn_data(uint16_t dest, const uint8_t *source, uint16_t length)
{
    uint16_t offset = 0u;
    uint16_t vram_dest = dest;
    while (length)
    {
        const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES();
        uint16_t chunk = length > slice_bytes ? slice_bytes : length;
        pce_editor_vram_copy(vram_dest, &source[offset], chunk);
        service_psg_during_blocking_work();
        map_vn_data();
        VN_MAP_BANK130_FOR_CODE();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        offset = (uint16_t)(offset + chunk);
        length = (uint16_t)(length - chunk);
    }
}

static uint8_t VN_RESIDENT_CODE visual_cache_bg_map_to_vram(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t *ref, uint8_t width_tiles, uint8_t height_tiles)
{
    if (!vn_visual_cache_code_loaded) return 0u;
    vn_visual_cache_arg_dest = dest;
    vn_visual_cache_arg_asset = asset_index;
    vn_visual_cache_arg_ref = ref;
    vn_visual_cache_arg_x = width_tiles;
    vn_visual_cache_arg_y = height_tiles;
    return visual_cache_call(VN_VISUAL_CACHE_OP_BG_MAP_TO_VRAM);
}

static void VN_BANKED_CODE visual_cache_preload_ref(uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    vn_visual_cache_arg_kind = kind;
    vn_visual_cache_arg_asset = asset_index;
    vn_visual_cache_arg_ref = ref;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_PRELOAD_REF);
}

static void VN_BANKED_CODE2 visual_cache_invalidate(uint8_t scope)
{
    if (!vn_visual_cache_code_loaded) return;
    vn_visual_cache_arg_scope = scope;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_INVALIDATE);
}
#else
static void VN_BANKED_CODE vram_copy_sliced_from_vn_data(uint16_t dest, const uint8_t *source, uint16_t length)
{
    uint16_t offset = 0u;
    uint16_t vram_dest = dest;
    while (length)
    {
        const uint16_t slice_bytes = VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES();
        uint16_t chunk = length > slice_bytes ? slice_bytes : length;
        pce_editor_vram_copy(vram_dest, &source[offset], chunk);
        service_psg_during_blocking_work();
        map_vn_data();
        VN_MAP_BANK130_FOR_CODE();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        offset = (uint16_t)(offset + chunk);
        length = (uint16_t)(length - chunk);
    }
}

static uint8_t VN_BANKED_CODE visual_cache_ref_to_vram(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    (void)dest;
    (void)kind;
    (void)asset_index;
    (void)ref;
    return 0u;
}

static uint8_t VN_BANKED_CODE visual_cache_bg_map_to_vram(uint16_t dest, uint16_t asset_index, const pce_editor_data_ref_t *ref, uint8_t width_tiles, uint8_t height_tiles)
{
    (void)dest;
    (void)asset_index;
    (void)ref;
    (void)width_tiles;
    (void)height_tiles;
    return 0u;
}

static void VN_BANKED_CODE visual_cache_preload_ref(uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    (void)kind;
    (void)asset_index;
    (void)ref;
}

static void VN_BANKED_CODE visual_cache_invalidate(uint8_t scope)
{
    (void)scope;
}
#endif


static uint8_t VN_BANKED_CODE cd_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref)
{
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest;
    map_vn_data();
    if (!ref || !ref->cd || !ref->cd->sector_count || !ref->size) return 0u;
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, &ref->cd->sector);
    remaining = (uint16_t)ref->size;
    vram_dest = dest;
    /* cd_transfer_scratch lives in bank132; MPR6 must point at it for the CD
       read target and the VRAM copy source. ref was already read above. */
    map_vn_data();
    while (remaining)
    {
        uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        prepare_cd_data_access();
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        finish_cd_data_read_before_vram_copy();
        vram_copy_sliced_from_vn_data(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    return 1u;
}

static uint8_t VN_BANKED_CODE2 cd_bg_map_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref, uint8_t width_tiles, uint8_t height_tiles, uint16_t asset_index)
{
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint8_t row = 0u;
    uint8_t copy_width_tiles = width_tiles;
    uint8_t copy_height_tiles = height_tiles;
    const uint8_t dest_col = (uint8_t)(dest % VN_MAP_WIDTH);
    const uint8_t dest_row = (uint8_t)(dest / VN_MAP_WIDTH);
    uint16_t row_bytes;
    map_vn_data();
    if (!ref || !ref->cd || !ref->cd->sector_count || !ref->size || !width_tiles || !height_tiles) return 0u;
    if (dest_col >= VN_MAP_WIDTH || dest_row >= VN_MAP_HEIGHT) return 0u;
    if ((uint16_t)dest_col + copy_width_tiles > VN_MAP_WIDTH)
    {
        copy_width_tiles = (uint8_t)(VN_MAP_WIDTH - dest_col);
    }
    if ((uint16_t)dest_row + copy_height_tiles > VN_MAP_HEIGHT)
    {
        copy_height_tiles = (uint8_t)(VN_MAP_HEIGHT - dest_row);
    }
    if (!copy_width_tiles || !copy_height_tiles) return 0u;
    row_bytes = (uint16_t)(copy_width_tiles * 2u);
    if (ref->size < (uint16_t)(VN_MAP_ROW_BYTES * copy_height_tiles)) return 0u;
    if (visual_cache_bg_map_to_vram(dest, asset_index, ref, copy_width_tiles, copy_height_tiles)) return 1u;
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, &ref->cd->sector);
    remaining = (uint16_t)ref->size;
    /* cd_transfer_scratch is in bank132; map MPR6 to it (ref already read). */
    map_vn_data();
    while (row < copy_height_tiles && remaining)
    {
        uint16_t local_offset = 0u;
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        prepare_cd_data_access();
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        finish_cd_data_read_before_vram_copy();
        if (dest_col == 0u && copy_width_tiles == VN_MAP_WIDTH)
        {
            uint8_t rows_in_chunk = 0u;
            while ((uint8_t)(row + rows_in_chunk) < copy_height_tiles
                   && (uint16_t)(local_offset + ((uint16_t)(rows_in_chunk + 1u) * VN_MAP_ROW_BYTES)) <= chunk)
            {
                rows_in_chunk++;
            }
            if (rows_in_chunk)
            {
                const uint16_t contiguous_bytes = (uint16_t)((uint16_t)rows_in_chunk * VN_MAP_ROW_BYTES);
                vram_copy_sliced_from_vn_data((uint16_t)(dest + ((uint16_t)row * VN_MAP_WIDTH)), &cd_transfer_scratch[local_offset], contiguous_bytes);
                local_offset = (uint16_t)(local_offset + contiguous_bytes);
                row = (uint8_t)(row + rows_in_chunk);
            }
        }
        while (row < copy_height_tiles && (uint16_t)(local_offset + VN_MAP_ROW_BYTES) <= chunk)
        {
            pce_editor_vram_copy((uint16_t)(dest + ((uint16_t)row * VN_MAP_WIDTH)), &cd_transfer_scratch[local_offset], row_bytes);
            service_psg_during_blocking_work();
            local_offset = (uint16_t)(local_offset + VN_MAP_ROW_BYTES);
            row++;
        }
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    return (uint8_t)(row >= copy_height_tiles);
}
#endif

static void VN_RESIDENT_CODE copy_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref, uint16_t word_stride, uint8_t cache_kind, uint16_t cache_asset_index)
{
#if !defined(__PCE_CD__)
    uint8_t i;
    uint16_t word_offset = 0;
#endif
    if (!ref || !ref->size) return;
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
    (void)word_stride;
    if (!vn_visual_cache_code_loaded) load_visual_cache_code();
    if (!vn_visual_cache_code_loaded) return;
    vn_visual_cache_arg_dest = dest;
    vn_visual_cache_arg_kind = cache_kind;
    vn_visual_cache_arg_asset = cache_asset_index;
    vn_visual_cache_arg_ref = ref;
    if (visual_cache_call(VN_VISUAL_CACHE_OP_COPY_REF_TO_VRAM)) return;
    return;
#elif defined(__PCE_CD__)
    (void)word_stride;
    if (cache_kind != VN_VISUAL_CACHE_KIND_NONE
        && visual_cache_ref_to_vram(dest, cache_kind, cache_asset_index, ref))
    {
        return;
    }
    if (cd_data_ref_to_vram(dest, ref)) return;
    return;
#else
    if (ref->chunk_count && ref->chunks)
    {
        for (i = 0; i < ref->chunk_count; i++)
        {
            const pce_editor_data_chunk_t *chunk = &ref->chunks[i];
            if (!chunk->data || !chunk->size) continue;
            pce_editor_map_asset_bank(chunk->bank);
            pce_editor_vram_copy((uint16_t)(dest + word_offset), chunk->data, (uint16_t)chunk->size);
            word_offset = (uint16_t)(word_offset + ((chunk->size + 1u) / 2u));
        }
        return;
    }
    if (ref->data)
    {
        pce_editor_vram_copy(dest, ref->data, (uint16_t)ref->size);
        (void)word_stride;
    }
#endif
}

/* === CD on-demand asset metadata ==========================================
   On CD builds the per-asset BG/sprite/ADPCM descriptors are NOT resident: the
   generator serializes them into a CD data file (asset_meta.bin) as fixed-size,
   sector-aligned record slots and keeps only a constant directory resident
   (pce_editor_*_meta). Each record is a packed image of the descriptor struct
   (pointer fields zeroed) plus an appendix (palette + cd refs), so decoding is a
   memcpy of the struct image plus a few appendix copies and pointer fix-ups — tiny
   code. The accessors stream a record's sector into cd_transfer_scratch, decode it
   into a small console_ram cache (cell_map goes to bank132) and return a pointer
   with the same struct shape the rest of the runtime already expects. Cache hits
   avoid re-reading the CD, so per-frame sprite refresh never touches the drive once
   warm. These accessors are plain resident code (the freed per-asset rodata makes
   room) — no overlay. See docs/pce-asset-meta-cd-ondemand.md.

   CD-ROM2 VN always uses the catalog metadata path; non-VN/HuCard templates are
   generated from different runtime templates and keep their resident arrays. */
#define VN_META_BG_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_BG_SLOT)
#define VN_META_SPRITE_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_SPRITE_SLOT)
#define VN_META_ADPCM_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_ADPCM_SLOT)
#define VN_META_PSG_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_PSG_SLOT)
#define VN_META_CDDA_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_CDDA_SLOT)
#define VN_BG_META_CACHE_SLOTS 8u
/* These asserts pin the appendix offsets past the struct image and the cd-ref
   byte layout, so any descriptor-struct change fails the build instead of
   silently mis-decoding. */
_Static_assert(sizeof(pce_editor_bg_asset_t) <= PCE_EDITOR_META_BG_PALETTE, "bg struct image overlaps palette appendix");
_Static_assert(sizeof(pce_editor_sprite_asset_t) <= PCE_EDITOR_META_SPR_PALETTE, "sprite struct image overlaps palette appendix");
_Static_assert(sizeof(pce_editor_cd_data_ref_t) == 8, "cd ref must be 8 bytes");
_Static_assert(PCE_EDITOR_META_ADPCM_DATA_SIZE == 2, "adpcm data_size offset must follow data pointer");
_Static_assert(PCE_EDITOR_META_ADPCM_PLAY_FRAMES + 2 <= PCE_EDITOR_META_ADPCM_CD, "adpcm play_frames must not overlap cd ref");
_Static_assert(PCE_EDITOR_META_BG_SLOT >= PCE_EDITOR_META_BG_MAP_CD + 8, "bg record overruns its slot");
_Static_assert(PCE_EDITOR_META_SPRITE_SLOT >= PCE_EDITOR_META_SPR_CELL_MAP + VN_META_CELL_MAP_MAX, "sprite record (incl inline cell_map) overruns its slot");
_Static_assert(PCE_EDITOR_META_ADPCM_SLOT >= PCE_EDITOR_META_ADPCM_CD + 8, "adpcm record overruns its slot");
_Static_assert(PCE_EDITOR_META_PSG_SLOT >= PCE_EDITOR_META_PSG_PATTERN_CD + 8, "psg record overruns its slot");
_Static_assert(PCE_EDITOR_META_CDDA_SLOT >= PCE_EDITOR_META_CDDA_PLAY_FRAMES + 2, "cdda record overruns its slot");

/* Read the meta sector holding record (region base + sector_off) into
   cd_transfer_scratch (bank132); leaves MPR6=bank132 so callers decode directly. */
/* Untagged → bank128, alongside the freed asset rodata and the CD helpers it
   inlines (map_vn_data/prepare_cd_data_access/cd_sector_*). Tagging it into a
   banked code bank (129/130) duplicated those inlined helpers there and ballooned
   the bank; 128/129/130 are co-resident so callers in any of them reach it with a
   transparent cross-bank call. VN_RESIDENT_CODE keeps it out-of-line in bank128 so
   the banked (129/130) sprite/adpcm callers don't inline a copy of it and balloon. */
static void VN_RESIDENT_CODE vn_read_meta_sector(const pce_editor_cd_sector_t *region_sector, uint8_t sector_off)
{
    pce_sector_t sector = {0};
    map_vn_data();
    prepare_cd_data_access();
    cd_sector_from_ref(&sector, region_sector);
    while (sector_off--) cd_sector_advance(&sector);
    map_vn_data();
    (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, VN_CD_SECTOR_BYTES);
    cd_transfer_wait();
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    map_vn_data();
}

static pce_editor_bg_asset_t g_bg_cache[VN_BG_META_CACHE_SLOTS];
static uint8_t g_bg_palette[VN_BG_META_CACHE_SLOTS][32] __attribute__((section(".ram_bank132_tail")));
static pce_editor_cd_data_ref_t g_bg_tiles_cd[VN_BG_META_CACHE_SLOTS];
static pce_editor_cd_data_ref_t g_bg_map_cd[VN_BG_META_CACHE_SLOTS];
static uint16_t g_bg_cache_key[VN_BG_META_CACHE_SLOTS] __attribute__((section(".bss")));

/* 8-slot direct-mapped cache: cache load bg warms both descriptor and payload;
   keep several warmed descriptors alive so later background commands avoid
   asset_meta reads without adding an LRU counter to bank128. */
static const pce_editor_bg_asset_t *VN_RESIDENT_CODE vn_get_bg_asset(uint16_t idx)
{
    uint8_t slot;
    uint16_t key;
    const uint8_t *p;
    pce_editor_bg_asset_t *rec;
    key = (uint16_t)(idx + 1u);
    slot = (uint8_t)(idx & (VN_BG_META_CACHE_SLOTS - 1u));
    if (g_bg_cache_key[slot] == key) return &g_bg_cache[slot];
    rec = &g_bg_cache[slot];
    vn_read_meta_sector(&pce_editor_bg_meta.sector, (uint8_t)(idx / VN_META_BG_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_BG_PER_SECTOR) * PCE_EDITOR_META_BG_SLOT)];
    __builtin_memcpy(rec, p, sizeof(*rec));
    __builtin_memcpy(g_bg_palette[slot], p + PCE_EDITOR_META_BG_PALETTE, 32);
    __builtin_memcpy(&g_bg_tiles_cd[slot], p + PCE_EDITOR_META_BG_TILES_CD, sizeof(pce_editor_cd_data_ref_t));
    __builtin_memcpy(&g_bg_map_cd[slot], p + PCE_EDITOR_META_BG_MAP_CD, sizeof(pce_editor_cd_data_ref_t));
    rec->palette.data = g_bg_palette[slot];
    rec->tiles.cd = &g_bg_tiles_cd[slot];
    rec->map.cd = &g_bg_map_cd[slot];
    g_bg_cache_key[slot] = key;
    return rec;
}

static pce_editor_sprite_asset_t g_spr_cache[VN_SPRITE_SLOT_COUNT];
static uint8_t g_spr_palette[VN_SPRITE_SLOT_COUNT][32];
static pce_editor_cd_data_ref_t g_spr_patterns_cd[VN_SPRITE_SLOT_COUNT];
/* cell_map caches live in console_ram (always mapped); show_character_sprite_frame
   reads them without any MPR juggling. */
static uint8_t g_spr_cell_map[VN_SPRITE_SLOT_COUNT][VN_META_CELL_MAP_MAX];
static uint16_t g_spr_cache_key[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t g_spr_cache_next __attribute__((section(".bss"))) = 0u;

static const pce_editor_sprite_asset_t *VN_RESIDENT_CODE vn_get_sprite_asset(uint16_t idx, uint8_t preferred_slot)
{
    uint8_t slot;
    uint16_t key;
    const uint8_t *p;
    pce_editor_sprite_asset_t *rec;
    uint16_t cell_map_len;
    key = (uint16_t)(idx + 1u);
    for (slot = 0u; slot < VN_SPRITE_SLOT_COUNT; slot++)
    {
        if (g_spr_cache_key[slot] == key) return &g_spr_cache[slot];
    }
    if (preferred_slot < VN_SPRITE_SLOT_COUNT)
    {
        slot = preferred_slot;
        g_spr_cache_next = (uint8_t)((slot + 1u) % VN_SPRITE_SLOT_COUNT);
    }
    else
    {
        slot = g_spr_cache_next;
        g_spr_cache_next = (uint8_t)((g_spr_cache_next + 1u) % VN_SPRITE_SLOT_COUNT);
    }
    rec = &g_spr_cache[slot];
    vn_read_meta_sector(&pce_editor_sprite_meta.sector, (uint8_t)(idx / VN_META_SPRITE_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_SPRITE_PER_SECTOR) * PCE_EDITOR_META_SPRITE_SLOT)];
    __builtin_memcpy(rec, p, sizeof(*rec));
    __builtin_memcpy(g_spr_palette[slot], p + PCE_EDITOR_META_SPR_PALETTE, 32);
    __builtin_memcpy(&g_spr_patterns_cd[slot], p + PCE_EDITOR_META_SPR_PATTERNS_CD, sizeof(pce_editor_cd_data_ref_t));
    __builtin_memcpy(&cell_map_len, p + PCE_EDITOR_META_SPR_CELL_MAP_LEN, 2);
    rec->palette.data = g_spr_palette[slot];
    rec->patterns.cd = &g_spr_patterns_cd[slot];
    /* cell_map is stored INLINE in the record (already in cd_transfer_scratch from
       the meta-sector read), so just copy it out — no second CD read / no loop. */
    if (cell_map_len)
    {
        if (cell_map_len > VN_META_CELL_MAP_MAX) cell_map_len = VN_META_CELL_MAP_MAX;
        __builtin_memcpy(g_spr_cell_map[slot], p + PCE_EDITOR_META_SPR_CELL_MAP, cell_map_len);
        rec->cell_map = g_spr_cell_map[slot];
    }
    else
    {
        rec->cell_map = 0;
    }
    g_spr_cache_key[slot] = key;
    return rec;
}

static pce_editor_adpcm_asset_t g_adpcm_cache;
static pce_editor_cd_data_ref_t g_adpcm_cd;
static uint16_t g_adpcm_cache_key;

static const pce_editor_adpcm_asset_t *VN_RESIDENT_CODE vn_get_adpcm_asset(uint16_t idx)
{
    const uint8_t *p;
    const uint16_t key = (uint16_t)(idx + 1u);
    if (g_adpcm_cache_key == key) return &g_adpcm_cache;
    vn_read_meta_sector(&pce_editor_adpcm_meta.sector, (uint8_t)(idx / VN_META_ADPCM_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_ADPCM_PER_SECTOR) * PCE_EDITOR_META_ADPCM_SLOT)];
    g_adpcm_cache.data = 0;
    g_adpcm_cache.data_size = (unsigned long)p[PCE_EDITOR_META_ADPCM_DATA_SIZE]
        | ((unsigned long)p[PCE_EDITOR_META_ADPCM_DATA_SIZE + 1u] << 8)
        | ((unsigned long)p[PCE_EDITOR_META_ADPCM_DATA_SIZE + 2u] << 16)
        | ((unsigned long)p[PCE_EDITOR_META_ADPCM_DATA_SIZE + 3u] << 24);
    g_adpcm_cache.sample_rate = (unsigned int)p[PCE_EDITOR_META_ADPCM_SAMPLE_RATE]
        | ((unsigned int)p[PCE_EDITOR_META_ADPCM_SAMPLE_RATE + 1u] << 8);
    g_adpcm_cache.adpcm_address = (unsigned int)p[PCE_EDITOR_META_ADPCM_ADDRESS]
        | ((unsigned int)p[PCE_EDITOR_META_ADPCM_ADDRESS + 1u] << 8);
    g_adpcm_cache.divider = p[PCE_EDITOR_META_ADPCM_DIVIDER];
    g_adpcm_cache.loop = p[PCE_EDITOR_META_ADPCM_LOOP];
    g_adpcm_cache.stream = p[PCE_EDITOR_META_ADPCM_STREAM];
    g_adpcm_cache.play_frames = (unsigned int)p[PCE_EDITOR_META_ADPCM_PLAY_FRAMES]
        | ((unsigned int)p[PCE_EDITOR_META_ADPCM_PLAY_FRAMES + 1u] << 8);
    g_adpcm_cd.sector.lo = p[PCE_EDITOR_META_ADPCM_CD];
    g_adpcm_cd.sector.md = p[PCE_EDITOR_META_ADPCM_CD + 1u];
    g_adpcm_cd.sector.hi = p[PCE_EDITOR_META_ADPCM_CD + 2u];
    g_adpcm_cd.sector_count = (unsigned int)p[PCE_EDITOR_META_ADPCM_CD + 3u]
        | ((unsigned int)p[PCE_EDITOR_META_ADPCM_CD + 4u] << 8);
    g_adpcm_cd.byte_size = (unsigned int)p[PCE_EDITOR_META_ADPCM_CD + 5u]
        | ((unsigned int)p[PCE_EDITOR_META_ADPCM_CD + 6u] << 8);
    g_adpcm_cd.compression = p[PCE_EDITOR_META_ADPCM_CD + 7u];
    g_adpcm_cache.cd = &g_adpcm_cd;
    g_adpcm_cache_key = key;
    return &g_adpcm_cache;
}

#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_BANKED_CODE2 load_bg_cache_asset(signed int bg_index, uint8_t tile_x, uint8_t tile_y)
{
    const pce_editor_bg_asset_t *bg;
    pce_editor_data_ref_t bg_tiles;
    pce_editor_data_ref_t bg_map;
    if (bg_index < 0) return;
    if ((unsigned int)bg_index >= pce_editor_bg_asset_count) return;
    (void)tile_x;
    (void)tile_y;
    map_resident_data();
    bg = vn_get_bg_asset((uint16_t)bg_index);
    SNAPSHOT_DATA_REF(bg_tiles, bg->tiles);
    SNAPSHOT_DATA_REF(bg_map, bg->map);
    load_visual_cache_code();
    visual_cache_preload_ref(VN_VISUAL_CACHE_KIND_BG_TILES, (uint16_t)bg_index, &bg_tiles);
    visual_cache_preload_ref(VN_VISUAL_CACHE_KIND_BG_MAP, (uint16_t)bg_index, &bg_map);
    preloaded_scene_visual_valid = 0u;
}

static void VN_BANKED_CODE load_sprite_pattern_cache_asset(signed int sprite_index, uint8_t slot_index)
{
    const pce_editor_sprite_asset_t *sprite;
    if (sprite_index < 0 || (unsigned int)sprite_index >= pce_editor_sprite_asset_count) return;
    map_resident_data();
    sprite = vn_get_sprite_asset((uint16_t)sprite_index, slot_index);
    load_visual_cache_code();
    visual_cache_preload_ref(VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS, (uint16_t)sprite_index, &sprite->patterns);
}
#else
static void VN_BANKED_CODE load_bg_cache_asset(signed int bg_index, uint8_t tile_x, uint8_t tile_y)
{
    (void)bg_index;
    (void)tile_x;
    (void)tile_y;
    preloaded_bg_valid = 0u;
    preloaded_scene_visual_valid = 0u;
}

static void VN_BANKED_CODE load_sprite_pattern_cache_asset(signed int sprite_index, uint8_t slot_index)
{
    (void)sprite_index;
    (void)slot_index;
    preloaded_scene_visual_valid = 0u;
}
#endif

static void VN_BANKED_CODE2 load_adpcm_cache_asset(signed int voice_index)
{
#if defined(__PCE_CD__)
    if (voice_index < 0) return;
    if ((unsigned int)voice_index >= pce_editor_adpcm_asset_count) return;
    if (loaded_adpcm_valid && loaded_adpcm_index == (uint16_t)voice_index) return;
    if (adpcm_playback_active()) return;
    (void)load_adpcm_voice(voice_index, 1u, 0u, VN_ADPCM_PRELOAD_READ_CHUNK_SECTORS);
#else
    (void)voice_index;
#endif
}

static void VN_BANKED_CODE2 load_runtime_cache(uint8_t scope, signed int asset_index, uint8_t slot, uint8_t x, uint8_t y)
{
    if (scope == PCE_VN_CACHE_SCOPE_BG)
    {
        load_bg_cache_asset(asset_index, x, y);
    }
    else if (scope == PCE_VN_CACHE_SCOPE_SPRITE)
    {
        load_sprite_pattern_cache_asset(asset_index, slot);
    }
    else if (scope == PCE_VN_CACHE_SCOPE_ADPCM)
    {
        load_adpcm_cache_asset(asset_index);
    }
    else if (scope == PCE_VN_CACHE_SCOPE_PSG)
    {
        (void)load_psg_cache_asset(asset_index);
    }
}

#define VN_CACHE_SCOPE_BIT(scope) ((uint8_t)(1u << (scope)))
#define VN_CACHE_CLEAR_BG_MASK (VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_VISUAL) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_BG) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ALL))
#define VN_CACHE_CLEAR_SPRITE_MASK (VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_VISUAL) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_SPRITE) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ALL))
#define VN_CACHE_CLEAR_VISUAL_PAYLOAD_MASK (VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_VISUAL) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_BG) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_SPRITE) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ALL))
#define VN_CACHE_CLEAR_ADPCM_MASK (VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ADPCM) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ALL))
#define VN_CACHE_CLEAR_PSG_MASK (VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_PSG) | VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ALL))
#define VN_CACHE_CLEAR_GLYPH_MASK VN_CACHE_SCOPE_BIT(PCE_VN_CACHE_SCOPE_ALL)

static void VN_VISUAL_CACHE_CODE clear_runtime_cache_impl(uint8_t scope)
{
    uint8_t i;
    uint8_t scope_bit;
    if (scope > PCE_VN_CACHE_SCOPE_ALL) scope = PCE_VN_CACHE_SCOPE_VISUAL;
    scope_bit = VN_CACHE_SCOPE_BIT(scope);
    if (scope_bit & VN_CACHE_CLEAR_BG_MASK)
    {
        preloaded_bg_valid = 0u;
        preloaded_scene_visual_valid = 0u;
        for (i = 0u; i < VN_BG_META_CACHE_SLOTS; i++)
        {
            g_bg_cache_key[i] = 0u;
        }
    }
    if (scope_bit & VN_CACHE_CLEAR_SPRITE_MASK)
    {
        for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
        {
            loaded_sprite_pattern_valid[i] = 0u;
            g_spr_cache_key[i] = 0u;
        }
        g_spr_cache_next = 0u;
        preloaded_scene_visual_valid = 0u;
    }
#if defined(__PCE_CD__)
    if (scope_bit & VN_CACHE_CLEAR_VISUAL_PAYLOAD_MASK)
    {
        visual_cache_invalidate_impl(scope);
    }
#endif
    if (scope_bit & VN_CACHE_CLEAR_ADPCM_MASK)
    {
        loaded_adpcm_valid = 0u;
    }
    if (scope_bit & VN_CACHE_CLEAR_PSG_MASK)
    {
        loaded_psg_pattern_key = 0u;
    }
    if (scope_bit & VN_CACHE_CLEAR_GLYPH_MASK)
    {
#if defined(__PCE_CD__)
        message_glyph_cache_valid = 0u;
#endif
    }
}

static void VN_BANKED_CODE2 clear_runtime_cache(uint8_t scope)
{
    uint8_t i;
    uint8_t scope_bit;
    if (scope > PCE_VN_CACHE_SCOPE_ALL) scope = PCE_VN_CACHE_SCOPE_VISUAL;
    scope_bit = VN_CACHE_SCOPE_BIT(scope);
    if (scope_bit & VN_CACHE_CLEAR_BG_MASK)
    {
        preloaded_bg_valid = 0u;
        preloaded_scene_visual_valid = 0u;
        for (i = 0u; i < VN_BG_META_CACHE_SLOTS; i++)
        {
            g_bg_cache_key[i] = 0u;
        }
    }
    if (scope_bit & VN_CACHE_CLEAR_SPRITE_MASK)
    {
        for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
        {
            loaded_sprite_pattern_valid[i] = 0u;
            g_spr_cache_key[i] = 0u;
        }
        g_spr_cache_next = 0u;
        preloaded_scene_visual_valid = 0u;
    }
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
    if (scope_bit & VN_CACHE_CLEAR_VISUAL_PAYLOAD_MASK)
    {
        visual_cache_invalidate(scope);
        VN_MAP_BANK130_FOR_CODE();
    }
#endif
    if (scope_bit & VN_CACHE_CLEAR_ADPCM_MASK)
    {
        loaded_adpcm_valid = 0u;
    }
    if (scope_bit & VN_CACHE_CLEAR_PSG_MASK)
    {
        loaded_psg_pattern_key = 0u;
    }
    if (scope_bit & VN_CACHE_CLEAR_GLYPH_MASK)
    {
#if defined(__PCE_CD__)
        message_glyph_cache_valid = 0u;
#endif
    }
}

#undef VN_CACHE_SCOPE_BIT
#undef VN_CACHE_CLEAR_BG_MASK
#undef VN_CACHE_CLEAR_SPRITE_MASK
#undef VN_CACHE_CLEAR_VISUAL_PAYLOAD_MASK
#undef VN_CACHE_CLEAR_ADPCM_MASK
#undef VN_CACHE_CLEAR_PSG_MASK
#undef VN_CACHE_CLEAR_GLYPH_MASK

#if defined(__PCE_CD__) /* PHASE_A_SPLIT: re-opened (was inside the file-spanning conditional) */
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_BANKED_CODE load_visual_cache_code(void)
{
    pce_sector_t sector = {0};
    uint8_t remaining;
    uint16_t dest = (uint16_t)PCE_VN_VISUAL_CODE_LOAD_ADDR;
    if (vn_visual_cache_code_loaded) return;
    map_vn_data();
    sector.lo = pce_vn_visual_code_data.sector.lo;
    sector.md = pce_vn_visual_code_data.sector.md;
    sector.hi = pce_vn_visual_code_data.sector.hi;
    prepare_cd_data_access();
    remaining = VN_VISUAL_CODE_RESERVED_SECTORS;
    while (remaining)
    {
        pce_ram_bank121_map();
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, dest, VN_CD_SECTOR_BYTES);
        cd_transfer_wait();
        dest = (uint16_t)(dest + VN_CD_SECTOR_BYTES);
        remaining--;
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    pce_ram_bank130_map();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
    vn_visual_cache_code_loaded = 1u;
}
#endif
#endif

