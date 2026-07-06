/* PHASE_A_SPLIT:BEGIN vn_port_sprite.c — sprite/spritetext: SATB attr/pattern
   helpers, clear/upload of the sprite table, per-frame pattern word updates,
   show_character_sprite_frame(+slot), spritetext drawing, scene sprite
   layout/refresh, animation caching/ticking and screen shake. Moved verbatim
   from pce_vn_runtime.c (Phase A module split). PHASE_A_SPLIT:END */
static uint16_t sprite_attr_for_size(const pce_editor_sprite_draw_meta_t *draw_meta, uint8_t flags)
{
    uint16_t attr = (uint16_t)(VDC_SPRITE_FG | VDC_SPRITE_COLOR(draw_meta->palette_bank));
    if (draw_meta->cell_width >= 32u) attr |= VDC_SPRITE_WIDTH_32;
    if (draw_meta->cell_height >= 64u) attr |= VDC_SPRITE_HEIGHT_64;
    else if (draw_meta->cell_height >= 32u) attr |= VDC_SPRITE_HEIGHT_32;
    if (flags & PCE_VN_SPRITE_FLIP_X) attr |= VDC_SPRITE_FLIP_X;
    if (flags & PCE_VN_SPRITE_FLIP_Y) attr |= VDC_SPRITE_FLIP_Y;
    return attr;
}

static uint8_t sprite_pattern_slots_for_size(uint8_t cell_width, uint8_t cell_height)
{
    uint8_t pattern_cols = (uint8_t)((cell_width + 15u) / 16u);
    uint8_t pattern_rows = (uint8_t)((cell_height + 15u) / 16u);
    uint8_t row_pattern_slots;
    if (!pattern_cols) pattern_cols = 1u;
    if (!pattern_rows) pattern_rows = 1u;
    row_pattern_slots = pattern_cols;
    if (pattern_rows > 1u && row_pattern_slots < 2u) row_pattern_slots = 2u;
    return (uint8_t)(row_pattern_slots * pattern_rows);
}

static uint16_t sprite_pattern_alignment_for_size(uint8_t cell_width, uint8_t cell_height)
{
    uint16_t alignment = 2u;
    if (cell_width >= 32u && alignment < 4u) alignment = 4u;
    if (cell_height >= 64u) alignment = 16u;
    else if (cell_height >= 32u && alignment < 8u) alignment = 8u;
    return alignment;
}

static uint16_t align_sprite_pattern_base(uint16_t pattern_base, uint8_t cell_width, uint8_t cell_height)
{
    const uint16_t alignment = sprite_pattern_alignment_for_size(cell_width, cell_height);
    return (uint16_t)((pattern_base + alignment - 1u) & (uint16_t)~(alignment - 1u));
}

static void VN_BANKED_CODE2 clear_sprites(void)
{
#if defined(__PCE__)
    uint8_t i;
    for (i = 0u; i < 64u; i++)
    {
        /* A zeroed SAT entry is still a real sprite on PCE. Park unused entries
           below the 224-line display so transparent BG cells cannot reveal them. */
        sprite_shadow[i].y = VN_SPRITE_HIDDEN_Y;
        sprite_shadow[i].x = 0u;
        sprite_shadow[i].pattern = 0u;
        sprite_shadow[i].attr = 0u;
    }
#endif
}

static void VN_RESIDENT_CODE upload_sprite_table(void)
{
#if defined(__PCE__)
    uint8_t irq;
    /* Full SATB upload (also runs when sprites are re-shown after a BG change). The
       set-table / VRAM blit / SATB-DMA pokes are the non-reentrant VDC sequence, so
       mask IRQs across them. Resident so the guard is not duplicated into callers. */
#if defined(__PCE_CD__)
    if (!pending_display_enable)
    {
        vn_wait_next_vblank();
        engine_service();
    }
#else
    vn_wait_next_vblank();
#endif
    irq = vn_vdc_irq_lock();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_editor_vram_copy(VN_SATB_ADDR, (const uint8_t *)sprite_shadow, (uint16_t)(64u * sizeof(vdc_sprite_t)));
    pce_vdc_poke(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC);
    pce_vdc_poke(VDC_REG_SATB_START, VN_SATB_ADDR);
    vn_vdc_irq_unlock(irq);
#if defined(__PCE_CD__)
    engine_service();
#endif
#endif
}

static void VN_RESIDENT_CODE upload_sprite_pattern_words(uint8_t satb_index, uint8_t count)
{
#if defined(__PCE__)
    uint8_t i;
    uint8_t irq;
    /* Runs every frame during ADPCM lip-sync. The IO_VDC_INDEX/IO_VDC_DATA pokes
       below are the non-reentrant VDC sequence: mask IRQs for the whole rewrite so a
       CD/ADPCM external IRQ cannot land between the register-select and the data
       writes and corrupt the SATB. */
#if defined(__PCE_CD__)
    if (!pending_display_enable)
    {
        vn_wait_next_vblank();
        engine_service();
    }
#else
    vn_wait_next_vblank();
#endif
    irq = vn_vdc_irq_lock();
    vn_vdc_set_copy_word();
    for (i = 0u; i < count; i++)
    {
        const uint8_t entry_index = (uint8_t)(satb_index + i);
        *IO_VDC_INDEX = VDC_REG_VRAM_WRITE_ADDR;
        *IO_VDC_DATA = (uint16_t)(VN_SATB_ADDR + ((uint16_t)entry_index * 4u) + 2u);
        *IO_VDC_INDEX = VDC_REG_VRAM_DATA;
        *IO_VDC_DATA = sprite_shadow[entry_index].pattern;
        *IO_VDC_DATA = sprite_shadow[entry_index].attr;
    }
    *IO_VDC_INDEX = VDC_REG_VRAM_WRITE_ADDR;
    *IO_VDC_DATA = (uint16_t)(VN_SATB_ADDR + (63u * 4u) + 3u);
    *IO_VDC_INDEX = VDC_REG_DMA_CONTROL;
    *IO_VDC_DATA = VDC_DMA_SRC_INC;
    *IO_VDC_INDEX = VDC_REG_SATB_START;
    *IO_VDC_DATA = VN_SATB_ADDR;
    vn_vdc_irq_unlock(irq);
#if defined(__PCE_CD__)
    engine_service();
#endif
#else
    (void)satb_index;
    (void)count;
#endif
}

static uint16_t sprite_pattern_units_for_ref(const pce_editor_data_ref_t *patterns)
{
    if (!patterns || !patterns->size) return 0u;
    return (uint16_t)((patterns->size + 63u) / 64u);
}

static uint8_t sprite_pattern_ranges_overlap(uint16_t left_base, uint16_t left_units, uint16_t right_base, uint16_t right_units)
{
    const uint16_t left_end = (uint16_t)(left_base + left_units);
    const uint16_t right_end = (uint16_t)(right_base + right_units);
    return (uint8_t)(left_base < right_end && right_base < left_end);
}

static inline uint8_t VN_BANKED_CODE_INLINE ensure_sprite_patterns_loaded(uint8_t slot_index, uint16_t sprite_index, const pce_editor_data_ref_t *patterns, uint16_t pattern_base, uint16_t pattern_units)
{
    if (slot_index >= VN_SPRITE_SLOT_COUNT) return 0u;
    if (!patterns || !patterns->size) return 0u;
    if (loaded_sprite_pattern_valid[slot_index]
        && loaded_sprite_pattern_index[slot_index] == sprite_index
        && loaded_sprite_pattern_base[slot_index] == pattern_base
        && loaded_sprite_pattern_units[slot_index] == pattern_units)
    {
        return 0u;
    }
    copy_data_ref_to_vram((uint16_t)(pattern_base * 32u), patterns, 16u, VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS, sprite_index);
    loaded_sprite_pattern_valid[slot_index] = 1u;
    loaded_sprite_pattern_index[slot_index] = sprite_index;
    loaded_sprite_pattern_base[slot_index] = pattern_base;
    loaded_sprite_pattern_units[slot_index] = pattern_units;
    return 1u;
}

static uint8_t VN_OVERLAY_CODE show_character_sprite_frame(uint8_t satb_index, const pce_editor_sprite_draw_meta_t *draw_meta, const uint8_t *cell_map, const vn_sprite_slot_t *slot)
{
    uint8_t row;
    uint8_t col;
    uint8_t cell_columns;
    uint8_t cell_rows;
    uint8_t frame_columns;
    uint8_t frame_rows;
    uint8_t written = 0u;
    uint8_t pattern_step;
    uint8_t cell_width;
    uint8_t cell_height;
    uint8_t use_animation_frame;
    uint16_t first_cell;
    uint16_t pattern_base;
    uint16_t total_cells;
    uint16_t attr;
    int16_t x;
    int16_t y;
    uint8_t flags;
    if (!slot) return 0u;
    x = (int16_t)((int16_t)slot->x + screen_shake_x);
    y = (int16_t)((int16_t)slot->y + screen_shake_y);
    flags = slot->flags;
    cell_width = draw_meta->cell_width;
    cell_height = draw_meta->cell_height;
    cell_columns = draw_meta->cell_columns ? draw_meta->cell_columns : 1u;
    cell_rows = draw_meta->cell_rows ? draw_meta->cell_rows : 1u;
    pattern_base = draw_meta->pattern_base;
    attr = sprite_attr_for_size(draw_meta, flags);
    total_cells = (uint16_t)(cell_columns * cell_rows);
    use_animation_frame = (uint8_t)(
        slot->animation_index >= 0 &&
        slot->anim_frame_count >= 1u &&
        slot->anim_frame_width_cells &&
        slot->anim_frame_height_cells &&
        slot->anim_frame_width_cells <= cell_columns &&
        slot->anim_frame_height_cells <= cell_rows &&
        slot->anim_frame_stride_cells &&
        slot->anim_first_cell < total_cells
    );
    frame_columns = use_animation_frame && slot->anim_frame_width_cells ? slot->anim_frame_width_cells : cell_columns;
    frame_rows = use_animation_frame && slot->anim_frame_height_cells ? slot->anim_frame_height_cells : cell_rows;
    first_cell = use_animation_frame
        ? (uint16_t)(slot->anim_first_cell + ((uint16_t)slot->frame * slot->anim_frame_stride_cells))
        : 0u;
    pattern_step = (uint8_t)(sprite_pattern_slots_for_size(cell_width, cell_height) * 2u);
#if defined(__PCE__)
    for (row = 0u; row < frame_rows; row++)
    {
        for (col = 0u; col < frame_columns; col++)
        {
            vdc_sprite_t *entry;
            uint16_t mapped_cell;
            const uint8_t source_row = (flags & PCE_VN_SPRITE_FLIP_Y) ? (uint8_t)(frame_rows - 1u - row) : row;
            const uint8_t source_col = (flags & PCE_VN_SPRITE_FLIP_X) ? (uint8_t)(frame_columns - 1u - col) : col;
            uint16_t source_cell = (uint16_t)(first_cell + ((uint16_t)source_row * cell_columns) + source_col);
            if (source_cell >= total_cells) continue;
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            /* Sprite sheets are deduplicated at build time: cell_map translates a
               positional sheet cell to its unique VRAM pattern slot. Sheets built
               before dedup (cell_map == NULL) keep the 1:1 positional layout. */
            mapped_cell = cell_map ? cell_map[source_cell] : source_cell;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->y = (uint16_t)(y + ((uint16_t)row * cell_height) + 64u);
            entry->x = (uint16_t)(x + ((uint16_t)col * cell_width) + 32u);
            entry->pattern = (uint16_t)(pattern_base + (mapped_cell * pattern_step));
            entry->attr = attr;
            written++;
        }
    }
#else
    (void)x;
    (void)y;
    (void)satb_index;
#endif
    return written;
}

/* Draw one sprite slot's frame through the bank133 overlay. The caller has
   already populated sprite_slot_draw_meta[i] / sprite_slot_cell_map[i] /
   sprite_satb_slot_start[i]; the overlay rebuilds the remaining args from the
   slot, so only the slot index crosses the bank swap. */
static uint8_t VN_BANKED_CODE call_overlay_show_sprite_slot(uint8_t i)
{
#if defined(__PCE_CD__)
    map_vn_data();
    return vn_overlay_dispatch_locked(VN_OVERLAY_OP_SHOW_SPRITE_SLOT, 0u, i, 0u);
#else
    return show_character_sprite_frame_slot(i);
#endif
}

/* Append the visible spritetext overlays to the SATB starting at satb_index and
   return how many hardware sprite entries were written. Each glyph is one 16x16
   sprite using the boot-loaded sprite font; lit pixels read color index 15 of
   the reserved sprite palette bank, which we set to the slot's color here.
   Note: all spritetext shares one palette entry, so if two slots are visible at
   once the last color written wins.
   Placed in .ram_bank130 (VN_BANKED_CODE2) so -Oz does not fold it into
   refresh_scene_sprites (.ram_bank129) and it does not bloat the resident
   bank128; banks 128/129/130 are all mapped (MPR2/3/4) and inter-callable. */
static uint8_t VN_VISUAL_CACHE_CODE draw_spritetext_slots_impl(uint8_t satb_index)
{
#if !PCE_VN_HAS_SPRITETEXT
    (void)satb_index;
    return 0u;
#else
    uint8_t written = 0u;
#if defined(__PCE__)
    uint8_t s;
    const uint16_t attr = (uint16_t)(VDC_SPRITE_FG | VDC_SPRITE_COLOR(PCE_VN_FONT_SPRITE_PALETTE_BANK));
    for (s = 0u; s < VN_SPRITETEXT_SLOT_COUNT; s++)
    {
        const vn_spritetext_slot_t *slot = &spritetext_slots[s];
        int16_t base_x;
        int16_t x;
        int16_t y;
        uint8_t i;
        if (!slot->visible || !slot->glyph_count) continue;
        if (slot->blink_frames && !slot->blink_on) continue;
        vce_write_color((uint16_t)(256u + (PCE_VN_FONT_SPRITE_PALETTE_BANK * 16u) + 15u), slot->color);
        base_x = (int16_t)((int16_t)slot->x + 32 + screen_shake_x);
        x = base_x;
        y = (int16_t)((int16_t)slot->y + 64 + screen_shake_y);
        for (i = 0u; i < slot->glyph_count; i++)
        {
            const uint8_t glyph = slot->glyphs[i];
            vdc_sprite_t *entry;
            if (glyph == VN_SPRITETEXT_GLYPH_NEWLINE)
            {
                x = base_x;
                y = (int16_t)(y + 16);
                continue;
            }
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->x = (uint16_t)x;
            entry->y = (uint16_t)y;
            entry->pattern = (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE + ((uint16_t)glyph << 1));
            entry->attr = attr;
            written++;
            x = (int16_t)(x + 16);
        }
    }
#else
    (void)satb_index;
#endif
    return written;
#endif
}

static uint8_t VN_RESIDENT_CODE draw_spritetext_slots(uint8_t satb_index)
{
#if !PCE_VN_HAS_SPRITETEXT
    (void)satb_index;
    return 0u;
#else
    uint8_t written;
    load_visual_cache_code();
    vn_visual_cache_arg_slot = satb_index;
    written = visual_cache_call(VN_VISUAL_CACHE_OP_DRAW_SPRITETEXT);
    return written;
#endif
}

static uint8_t VN_OVERLAY_CODE refresh_scene_sprite_patterns_impl(void)
{
#if !PCE_VN_HAS_SPRITE_ANIMATIONS
    return 1u;
#else
#if defined(__PCE__)
    uint8_t i;
    if (!sprite_satb_layout_valid) return 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = &sprite_slots[i];
        uint8_t satb_index;
        uint8_t expected_count;
        uint8_t written;
        expected_count = sprite_satb_slot_count[i];
        if (!expected_count) continue;
        if (!sprite_slot_pattern_valid[i]) return 0u;
        if (!slot->visible || slot->sprite_index < 0) return 0u;
        if (slot->animation_index < 0 || slot->anim_frame_count <= 1u) continue;
        satb_index = sprite_satb_slot_start[i];
        written = show_character_sprite_frame(
            satb_index,
            &sprite_slot_draw_meta[i],
            sprite_slot_cell_map[i],
            slot
        );
        if (written != expected_count) return 0u;
        upload_sprite_pattern_words(satb_index, expected_count);
    }
    return 1u;
#else
    return 1u;
#endif
#endif
}

/* Overlay-side rebuild of the sprite-frame draw from slot state so the resident
   dispatcher only passes a slot index. Keep animation fields on vn_sprite_slot_t:
   local animation struct copies have proven unsafe under llvm-mos lowering. */
static uint8_t VN_OVERLAY_CODE show_character_sprite_frame_slot(uint8_t i)
{
    vn_sprite_slot_t *slot = &sprite_slots[i];
    return show_character_sprite_frame(
        sprite_satb_slot_start[i],
        &sprite_slot_draw_meta[i],
        sprite_slot_cell_map[i],
        slot);
}

static uint8_t VN_BANKED_CODE refresh_scene_sprite_patterns(void)
{
#if defined(__PCE_CD__)
    /* The animation fast path only rewrites cached SATB pattern/attr words.
       vn_overlay_dispatch_locked blocks external IRQs while slot4 is mapped to the
       bank133 overlay, then restores bank130 before re-enabling IRQs. */
    map_vn_data();
    return vn_overlay_dispatch_locked(VN_OVERLAY_OP_REFRESH_SPRITE, 0u, 0u, 0u);
#else
    return refresh_scene_sprite_patterns_impl();
#endif
}

static uint8_t VN_BANKED_CODE plan_scene_sprite_layout(void)
{
    uint8_t i;
    uint8_t requires_safe_hide = 0u;
    uint16_t next_pattern_base = PCE_VN_SPRITE_PATTERN_BASE;
    uint8_t next_palette_bank = 0u;
    uint8_t next_palette_bank_valid = 0u;
    uint8_t sprite_pattern_capacity_exhausted = 0u;
    uint8_t sprite_palette_capacity_exhausted = 0u;
    sprite_satb_layout_valid = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        sprite_satb_slot_start[i] = 0u;
        sprite_satb_slot_count[i] = 0u;
        sprite_slot_pattern_valid[i] = 0u;
        sprite_slot_pattern_base[i] = 0u;
        sprite_slot_palette_bank[i] = 0u;
    }
    map_vn_data();
    map_resident_data();
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        const vn_sprite_slot_t *slot = &sprite_slots[i];
        const pce_editor_sprite_asset_t *sprite;
        uint16_t pattern_units;
        uint16_t slot_pattern_base;
        uint8_t j;
        uint8_t palette_bank;
        if (sprite_pattern_capacity_exhausted || sprite_palette_capacity_exhausted)
        {
            continue;
        }
        if (!slot->visible || slot->sprite_index < 0)
        {
            continue;
        }
        if ((unsigned int)slot->sprite_index >= pce_editor_sprite_asset_count)
        {
            continue;
        }
        sprite = vn_get_sprite_asset((uint16_t)slot->sprite_index, i);
        pattern_units = sprite_pattern_units_for_ref(&sprite->patterns);
        if (!pattern_units)
        {
            continue;
        }
        for (j = 0u; j < i; j++)
        {
            const vn_sprite_slot_t *previous_slot = &sprite_slots[j];
            if (!sprite_slot_pattern_valid[j]) continue;
            if (!previous_slot->visible || previous_slot->sprite_index != slot->sprite_index) continue;
            sprite_slot_pattern_base[i] = sprite_slot_pattern_base[j];
            sprite_slot_palette_bank[i] = sprite_slot_palette_bank[j];
            sprite_slot_pattern_valid[i] = 1u;
            break;
        }
        if (sprite_slot_pattern_valid[i])
        {
            continue;
        }
        if (!next_palette_bank_valid)
        {
            next_palette_bank = sprite->palette_bank;
            next_palette_bank_valid = 1u;
        }
        slot_pattern_base = align_sprite_pattern_base(next_pattern_base, sprite->cell_width, sprite->cell_height);
        if (((unsigned int)slot_pattern_base + (unsigned int)pattern_units) > (unsigned int)VN_SPRITE_PATTERN_END_BASE)
        {
            sprite_pattern_capacity_exhausted = 1u;
            continue;
        }
        next_pattern_base = (uint16_t)(slot_pattern_base + pattern_units);
        if (next_palette_bank >= PCE_VN_FONT_SPRITE_PALETTE_BANK)
        {
            sprite_palette_capacity_exhausted = 1u;
            continue;
        }
        palette_bank = next_palette_bank;
        sprite_slot_pattern_base[i] = slot_pattern_base;
        sprite_slot_palette_bank[i] = palette_bank;
        sprite_slot_pattern_valid[i] = 1u;
        if (!loaded_sprite_pattern_valid[i]
            || loaded_sprite_pattern_index[i] != (uint16_t)slot->sprite_index
            || loaded_sprite_pattern_base[i] != slot_pattern_base
            || loaded_sprite_pattern_units[i] != pattern_units)
        {
            for (j = 0u; j < VN_SPRITE_SLOT_COUNT; j++)
            {
                if (!loaded_sprite_pattern_valid[j]) continue;
                if (i == j
                    && loaded_sprite_pattern_index[j] == (uint16_t)slot->sprite_index
                    && loaded_sprite_pattern_base[j] == slot_pattern_base
                    && loaded_sprite_pattern_units[j] == pattern_units)
                {
                    continue;
                }
                if (sprite_pattern_ranges_overlap(slot_pattern_base, pattern_units, loaded_sprite_pattern_base[j], loaded_sprite_pattern_units[j]))
                {
                    requires_safe_hide = 1u;
                    break;
                }
            }
        }
        for (j = 0u; j < VN_SPRITE_SLOT_COUNT; j++)
        {
            if (!loaded_sprite_pattern_valid[j]) continue;
            if (loaded_sprite_palette_bank[j] != palette_bank) continue;
            if (i == j && loaded_sprite_pattern_index[j] == (uint16_t)slot->sprite_index) continue;
            requires_safe_hide = 1u;
            break;
        }
        next_palette_bank = (uint8_t)(next_palette_bank + 1u);
    }
    return requires_safe_hide;
}

static uint8_t VN_BANKED_CODE refresh_scene_sprite_slot_upload(uint8_t i, uint8_t satb_index)
{
    vn_sprite_slot_t *slot;
    pce_editor_sprite_draw_meta_t draw_meta;
    pce_editor_data_ref_t sprite_palette;
    pce_editor_data_ref_t sprite_patterns;
    const pce_editor_sprite_asset_t *sprite;
    const uint8_t *sprite_cell_map;
    uint16_t sprite_index;
    uint8_t written;
    if (i >= VN_SPRITE_SLOT_COUNT) return satb_index;
    if (!sprite_slot_pattern_valid[i]) return satb_index;
    slot = &sprite_slots[i];
    if (!slot->visible || slot->sprite_index < 0) return satb_index;
    map_resident_data();
    if ((unsigned int)slot->sprite_index >= pce_editor_sprite_asset_count) return satb_index;
    sprite_index = (uint16_t)slot->sprite_index;
    sprite = vn_get_sprite_asset(sprite_index, i);
    SNAPSHOT_DATA_REF(sprite_palette, sprite->palette);
    SNAPSHOT_DATA_REF(sprite_patterns, sprite->patterns);
    sprite_cell_map = sprite->cell_map;
    draw_meta.cell_width = sprite->cell_width;
    draw_meta.cell_height = sprite->cell_height;
    draw_meta.cell_columns = sprite->cell_columns;
    draw_meta.cell_rows = sprite->cell_rows;
    draw_meta.pattern_base = sprite_slot_pattern_base[i];
    draw_meta.palette_bank = sprite_slot_palette_bank[i];
    sprite_slot_draw_meta[i] = draw_meta;
    sprite_slot_cell_map[i] = sprite_cell_map;
    /* Pin metadata snapshots before upload helpers remap MPR slots. */
    __asm__ volatile("" ::: "memory");
    upload_palette(&sprite_palette, (uint16_t)(256u + (draw_meta.palette_bank * 16u)), 1);
    loaded_sprite_palette_bank[i] = draw_meta.palette_bank;
    (void)ensure_sprite_patterns_loaded(i, sprite_index, &sprite_patterns, draw_meta.pattern_base, sprite_pattern_units_for_ref(&sprite_patterns));
    sprite_satb_slot_start[i] = satb_index;
    /* draw_meta / cell_map were snapshotted into sprite_slot_draw_meta[i] /
       sprite_slot_cell_map[i]; the overlay rebuilds the rest from the slot. */
    written = call_overlay_show_sprite_slot(i);
    sprite_satb_slot_count[i] = written;
    return (uint8_t)(satb_index + written);
}

static void VN_BANKED_CODE refresh_scene_sprites(void)
{
    uint8_t i;
    uint8_t satb_index = 0u;
    const uint8_t display_active = (uint8_t)!pending_display_enable;
    uint8_t requires_safe_hide;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    if (pending_sprite_refresh == VN_SPRITE_REFRESH_PATTERNS && refresh_scene_sprite_patterns())
    {
        pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
        return;
    }
#endif
    requires_safe_hide = plan_scene_sprite_layout();
    clear_sprites();
    if (display_active && requires_safe_hide)
    {
        sprite_layer_disable();
        upload_sprite_table();
        delay_frame();
    }
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        satb_index = refresh_scene_sprite_slot_upload(i, satb_index);
    }
    VN_MAP_BANK130_FOR_CODE();
    satb_index = (uint8_t)(satb_index + draw_spritetext_slots(satb_index));
    sprite_satb_layout_valid = 1u;
    upload_sprite_table();
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        if (!sprite_slot_pattern_valid[i]) loaded_sprite_pattern_valid[i] = 0u;
    }
    if (display_active)
    {
        sprite_layer_enable();
        if (requires_safe_hide)
        {
            delay_frame();
        }
    }
    pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
}

static void VN_OVERLAY_CODE cache_sprite_animation_impl(uint8_t slot_index)
{
    vn_sprite_slot_t *slot;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    const pce_vn_sprite_anim_t *animation;
    unsigned int animation_sprite_index;
    uint8_t animation_first_cell;
    uint8_t animation_frame_count;
    uint8_t animation_frame_delay;
    uint8_t animation_frame_width_cells;
    uint8_t animation_frame_height_cells;
    uint8_t animation_frame_stride_cells;
    uint8_t animation_loop;
    const uint8_t *animation_frame_delays;
#endif
    if (slot_index >= VN_SPRITE_SLOT_COUNT) return;
    slot = &sprite_slots[slot_index];
    slot->anim_frame_count = 0u;
    slot->anim_frame_delay = 0u;
    slot->anim_loop = 0u;
    slot->anim_first_cell = 0u;
    slot->anim_frame_width_cells = 0u;
    slot->anim_frame_height_cells = 0u;
    slot->anim_frame_stride_cells = 0u;
    slot->anim_frame_delays = (const uint8_t *)0;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    if (slot->sprite_index < 0 || slot->animation_index < 0) return;
    map_vn_data();
    if ((unsigned int)slot->animation_index >= pce_vn_sprite_animation_count) return;
    animation = &pce_vn_sprite_animations[(unsigned int)slot->animation_index];
    animation_sprite_index = animation->sprite_index;
    animation_first_cell = animation->first_cell;
    animation_frame_count = animation->frame_count;
    animation_frame_delay = animation->frame_delay;
    animation_frame_width_cells = animation->frame_width_cells;
    animation_frame_height_cells = animation->frame_height_cells;
    animation_frame_stride_cells = animation->frame_stride_cells;
    animation_loop = animation->loop;
    animation_frame_delays = animation->frame_delays;
    if (animation_sprite_index != (unsigned int)slot->sprite_index) return;
    slot->anim_frame_count = animation_frame_count;
    slot->anim_frame_delay = animation_frame_delay;
    slot->anim_loop = animation_loop;
    slot->anim_first_cell = animation_first_cell;
    slot->anim_frame_width_cells = animation_frame_width_cells;
    slot->anim_frame_height_cells = animation_frame_height_cells;
    slot->anim_frame_stride_cells = animation_frame_stride_cells;
    slot->anim_frame_delays = animation_frame_delays;
#endif
}

/* Resident wrapper: the overlay impl only reads bank132 (map_vn_data, slot6) and
   writes the always-mapped sprite slot, so it dispatches like the scene-pack
   readers (no IRQ lock). */
static void VN_BANKED_CODE cache_sprite_animation(uint8_t slot_index)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch(VN_OVERLAY_OP_CACHE_SPRITE_ANIM, 0u, 0u, slot_index);
#else
    cache_sprite_animation_impl(slot_index);
#endif
}

#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_VISUAL_CACHE_CODE tick_sprite_animations_impl(void)
#else
static void tick_sprite_animations(void)
#endif
{
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    uint8_t i;
    uint8_t changed = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = sprite_slot_ref(i);
        uint8_t frame_delay;
        if (!slot->visible || slot->anim_frame_count <= 1u) continue;
        /* Per-frame display time: each frame holds for its own delay (frame_delays
           lives in resident rodata and is cached on the slot when the animation
           changes, so ADPCM frames do not reread the bank132 animation table.
           This replaces the old animation.frame_delays[slot->frame] hot read. */
        frame_delay = (slot->anim_frame_delays && slot->frame < slot->anim_frame_count)
            ? slot->anim_frame_delays[slot->frame]
            : slot->anim_frame_delay;
        if (!frame_delay) frame_delay = slot->anim_frame_delay;
        slot->timer++;
        if (slot->timer < frame_delay) continue;
        slot->timer = 0u;
        if (slot->frame + 1u < slot->anim_frame_count)
        {
            slot->frame++;
        }
        else if (slot->anim_loop)
        {
            slot->frame = 0u;
        }
        changed = 1u;
    }
    if (changed) REQUEST_SPRITE_REFRESH_PATTERNS();
#endif
}

#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_RESIDENT_CODE tick_sprite_animations(void)
{
    if (!vn_visual_cache_code_loaded) return;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_TICK_SPRITE_ANIMATIONS);
}
#endif

/* Advance blink timers for spritetext overlays and request a sprite refresh on
   each on/off toggle. Static (blink_frames == 0) overlays are left untouched. */
static void tick_spritetext(void)
{
#if PCE_VN_HAS_SPRITETEXT
    uint8_t i;
    uint8_t changed = 0u;
    for (i = 0u; i < VN_SPRITETEXT_SLOT_COUNT; i++)
    {
        vn_spritetext_slot_t *slot = &spritetext_slots[i];
        if (!slot->visible || !slot->blink_frames) continue;
        slot->blink_timer++;
        if (slot->blink_timer < slot->blink_frames) continue;
        slot->blink_timer = 0u;
        slot->blink_on = (uint8_t)(slot->blink_on ? 0u : 1u);
        changed = 1u;
    }
    if (changed) REQUEST_SPRITE_REFRESH_FULL();
#endif
}

static void VN_RESIDENT_CODE clear_spritetext_slots(void)
{
#if PCE_VN_HAS_SPRITETEXT
    uint8_t i;
    for (i = 0u; i < VN_SPRITETEXT_SLOT_COUNT; i++)
    {
        spritetext_slots[i].visible = 0u;
        spritetext_slots[i].glyph_count = 0u;
        spritetext_slots[i].blink_frames = 0u;
        spritetext_slots[i].blink_timer = 0u;
        spritetext_slots[i].blink_on = 1u;
    }
#endif
}

static signed char VN_BANKED_CODE2 shake_offset_for_frame(uint8_t frame, uint8_t intensity)
{
    uint8_t phase = (uint8_t)(frame & 3u);
    signed char value = (signed char)intensity;
    if (phase == 0u) return value;
    if (phase == 1u) return (signed char)(-value);
    value = (signed char)(intensity >> 1u);
    if (phase == 2u) return value;
    return (signed char)(-value);
}

static void shake_screen(uint8_t frames, uint8_t intensity)
{
    uint8_t i;
    if (!frames) return;
    if (!intensity) intensity = 2u;
    for (i = 0u; i < frames; i++)
    {
        set_screen_offset(shake_offset_for_frame(i, intensity), shake_offset_for_frame((uint8_t)(i + 1u), intensity));
        tick_sprite_animations();
        refresh_scene_sprites();
        delay_frame();
    }
    set_screen_offset(0, 0);
    refresh_scene_sprites();
}

static void VN_BANKED_CODE2 hide_sprites_for_asset_load(void)
{
    clear_sprites();
    upload_sprite_table();
    pending_scene_sprite_clear = 0u;
    if (!pending_display_enable)
    {
        sprite_layer_disable();
        delay_frame();
    }
}

/* preload_scene_assets/preload_scan_boundary/preload_adpcm_voice removed: the
   scene-entry pre-scan duplicated the on-demand loads that run_commands_until_wait
   already performs per command (set_background, ensure_sprite_patterns_loaded,
   play_adpcm_voice). Dropping it reclaims its bank130 footprint. */

