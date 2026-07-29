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

static void VN_CD_ASYNC_CODE clear_sprites_impl(void)
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

/* The actual clear is self-contained RAM work, so keep it with the bank122
   upload helper.  The thin wrapper preserves whichever slot4 bank called it. */
static void VN_BANKED_CODE clear_sprites(void)
{
#if defined(__PCE_CD__)
    (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_CLEAR_SPRITES);
#else
    clear_sprites_impl();
#endif
}

static void VN_BANKED_CODE hide_sprite_shadow_range(uint8_t satb_index, uint8_t count)
{
#if defined(__PCE__)
    uint8_t i;
    for (i = 0u; i < count && (uint8_t)(satb_index + i) < 64u; i++)
    {
        vdc_sprite_t *entry = &sprite_shadow[(uint8_t)(satb_index + i)];
        entry->y = VN_SPRITE_HIDDEN_Y;
        entry->x = 0u;
        entry->pattern = 0u;
        entry->attr = 0u;
    }
#else
    (void)satb_index;
    (void)count;
#endif
}

static void VN_CD_ASYNC_CODE upload_sprite_table_impl(void)
{
#if defined(__PCE__)
    uint8_t irq;
    /* Full SATB upload (also runs when sprites are re-shown after a BG change). The
       set-table / VRAM blit / SATB-DMA pokes are the non-reentrant VDC sequence, so
       mask IRQs across them. On CD this runtime-support work lives in bank122 so
       it does not consume any of the three co-resident play-code banks. */
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
    /* Per-frame animation/movement updates rewrite complete SATB entries and
       arm SATB DMA. The frame tail performs the one VBlank wait after every
       active slot has been updated. */
    irq = vn_vdc_irq_lock();
    vn_vdc_set_copy_word();
    for (i = 0u; i < count; i++)
    {
        const uint8_t entry_index = (uint8_t)(satb_index + i);
        *IO_VDC_INDEX = VDC_REG_VRAM_WRITE_ADDR;
        *IO_VDC_DATA = (uint16_t)(VN_SATB_ADDR + ((uint16_t)entry_index * 4u));
        *IO_VDC_INDEX = VDC_REG_VRAM_DATA;
        *IO_VDC_DATA = sprite_shadow[entry_index].y;
        *IO_VDC_DATA = sprite_shadow[entry_index].x;
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
   return how many hardware sprite entries were written. Each 12x12 glyph is
   centered in one 16x16 hardware sprite and placed at the same 12px horizontal
   pitch / 16px line pitch as message text. Lit pixels read color index 15 of
   the reserved sprite palette bank, which we set to the slot's color here.
   Note: all spritetext shares one palette entry, so if two slots are visible at
   once the last color written wins.
   Placed in .ram_bank130 (VN_BANKED_CODE2) so -Oz does not fold it into
   refresh_scene_sprites (.ram_bank129) and it does not bloat the resident
   bank128; banks 128/129/130 are all mapped (MPR2/3/4) and inter-callable. */
#if defined(__PCE_CD__)
static uint8_t VN_VISUAL_CACHE_CODE ensure_spritetext_glyph(uint16_t glyph)
{
    uint8_t i;
    for (i = 0u; i < spritetext_glyph_cache_count; i++)
        if (spritetext_glyph_cache_ids[i] == glyph) return i;
    if (spritetext_glyph_cache_count >= PCE_VN_FONT_SPRITE_GLYPH_CAPACITY) return 0xffu;
    i = spritetext_glyph_cache_count;
    if (!vn_system_card_font12_sprite_upload(glyph,
            (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE + ((uint16_t)i << 1)))) return 0xffu;
    spritetext_glyph_cache_ids[i] = glyph;
    spritetext_glyph_cache_count++;
    return i;
}
#endif

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
            const uint16_t glyph = slot->glyphs[i];
            uint8_t pattern_index;
            vdc_sprite_t *entry;
            if (glyph == PCE_VN_GLYPH_NEWLINE)
            {
                x = base_x;
                y = (int16_t)(y + VN_SPRITETEXT_PITCH_Y);
                continue;
            }
#if defined(__PCE_CD__)
            pattern_index = ensure_spritetext_glyph(glyph);
            if (pattern_index == 0xffu) continue;
#else
            pattern_index = (uint8_t)glyph;
#endif
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->x = (uint16_t)x;
            entry->y = (uint16_t)y;
            entry->pattern = (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE + ((uint16_t)pattern_index << 1));
            entry->attr = attr;
            written++;
            x = (int16_t)(x + VN_SPRITETEXT_PITCH_X);
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
}

static void upload_sprite_table(void)
{
#if defined(__PCE_CD__)
    (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_UPLOAD_SPRITE_TABLE);
#else
    upload_sprite_table_impl();
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
    /* The overlay rebuilds cached SATB entries and arms DMA without waiting.
       The frame tail performs the single VBlank wait after all slot updates. */
    map_vn_data();
    return vn_overlay_dispatch(VN_OVERLAY_OP_REFRESH_SPRITE, 0u, 0u, 0u);
#else
    return refresh_scene_sprite_patterns_impl();
#endif
}

static uint8_t VN_CD_ASYNC_CODE plan_scene_sprite_layout_impl(void)
{
    uint8_t i;
    uint8_t safe_hide_mask = 0u;
    sprite_satb_layout_valid = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
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
        uint16_t slot_pattern_capacity;
        uint8_t palette_bank;
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
        if (i == 1u)
        {
            slot_pattern_base = PCE_VN_SPRITE_SLOT1_PATTERN_BASE;
            slot_pattern_capacity = PCE_VN_SPRITE_SLOT1_PATTERN_CAPACITY;
        }
        else if (i == 2u)
        {
            slot_pattern_base = PCE_VN_SPRITE_SLOT2_PATTERN_BASE;
            slot_pattern_capacity = PCE_VN_SPRITE_SLOT2_PATTERN_CAPACITY;
        }
        else if (i == 3u)
        {
            slot_pattern_base = PCE_VN_SPRITE_SLOT3_PATTERN_BASE;
            slot_pattern_capacity = PCE_VN_SPRITE_SLOT3_PATTERN_CAPACITY;
        }
        else
        {
            slot_pattern_base = PCE_VN_SPRITE_SLOT0_PATTERN_BASE;
            slot_pattern_capacity = PCE_VN_SPRITE_SLOT0_PATTERN_CAPACITY;
        }
        if (pattern_units > slot_pattern_capacity) continue;
        palette_bank = (uint8_t)(sprite->palette_bank + i);
        if (palette_bank >= PCE_VN_FONT_SPRITE_PALETTE_BANK) continue;
        sprite_slot_pattern_base[i] = slot_pattern_base;
        sprite_slot_palette_bank[i] = palette_bank;
        sprite_slot_pattern_valid[i] = 1u;
        if (sprite_satb_slot_count[i]
            && (!loaded_sprite_pattern_valid[i]
            || loaded_sprite_pattern_index[i] != (uint16_t)slot->sprite_index
            || loaded_sprite_pattern_base[i] != slot_pattern_base
            || loaded_sprite_pattern_units[i] != pattern_units
            || loaded_sprite_palette_bank[i] != palette_bank))
        {
            safe_hide_mask |= (uint8_t)(1u << i);
        }
    }
    return safe_hide_mask;
}

static uint8_t VN_CD_ASYNC_CODE refresh_scene_sprite_slot_upload_impl(uint8_t i, uint8_t satb_index)
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

static uint8_t VN_BANKED_CODE plan_scene_sprite_layout(void)
{
#if defined(__PCE_CD__)
    return vn_cd_async_call_bank122(VN_CD_ASYNC_OP_PLAN_SPRITE_LAYOUT);
#else
    return plan_scene_sprite_layout_impl();
#endif
}

static uint8_t VN_BANKED_CODE refresh_scene_sprite_slot_upload(uint8_t i, uint8_t satb_index)
{
#if defined(__PCE_CD__)
    vn_visual_cache_arg_slot = i;
    vn_visual_cache_arg_x = satb_index;
    return vn_cd_async_call_bank122(VN_CD_ASYNC_OP_REFRESH_SPRITE_SLOT);
#else
    return refresh_scene_sprite_slot_upload_impl(i, satb_index);
#endif
}

static void VN_BANKED_CODE refresh_scene_sprites(void)
{
    uint8_t i;
    uint8_t satb_index = 0u;
    const uint8_t display_active = (uint8_t)!pending_display_enable;
    uint8_t safe_hide_mask;
    if (pending_sprite_refresh == VN_SPRITE_REFRESH_PATTERNS && refresh_scene_sprite_patterns())
    {
        pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
        return;
    }
    safe_hide_mask = plan_scene_sprite_layout();
    if (display_active && safe_hide_mask)
    {
        for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
        {
            if (safe_hide_mask & (uint8_t)(1u << i))
                hide_sprite_shadow_range(sprite_satb_slot_start[i], sprite_satb_slot_count[i]);
        }
        upload_sprite_table();
        delay_frame();
    }
    clear_sprites();
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        sprite_satb_slot_start[i] = 0u;
        sprite_satb_slot_count[i] = 0u;
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
        if (safe_hide_mask)
        {
            delay_frame();
        }
    }
    pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
}

/* CD metadata access must stay outside bank124. This resident helper reads one
   sector into bank132 and publishes only the immediately-consumed record key;
   vn_logic_overlay_dispatch maps bank132 while the logic code decodes/caches it. */
static uint8_t VN_BANKED_CODE prepare_sprite_animation_meta(uint16_t animation_index)
{
#if defined(__PCE_CD__) && PCE_VN_HAS_SPRITE_ANIMATIONS
    uint8_t restore_mpr6;
    sprite_animation_meta_ready = 0u;
    sprite_animation_meta_index = animation_index;
    __asm__ volatile("tma #$40" : "=a"(restore_mpr6));
    map_vn_data();
    if (animation_index < pce_vn_sprite_animation_count)
    {
        vn_read_meta_sector(
            &pce_vn_sprite_animation_meta.sector,
            (uint16_t)(animation_index / VN_SPRITE_ANIM_META_PER_SECTOR));
        sprite_animation_meta_ready = 1u;
    }
    __asm__ volatile("tam #$40" : : "a"(restore_mpr6));
    return sprite_animation_meta_ready;
#elif defined(__PCE_CD__)
    sprite_animation_meta_ready = 0u;
    sprite_animation_meta_index = animation_index;
    return 0u;
#else
    (void)animation_index;
    return 1u;
#endif
}

#if defined(__PCE_CD__) && PCE_VN_HAS_SPRITE_ANIMATIONS
static uint8_t VN_LOGIC_OVERLAY_CODE prepared_sprite_animation_matches(uint8_t slot_index, uint16_t animation_index)
{
    const uint8_t *animation;
    unsigned int animation_sprite_index;
    vn_sprite_slot_t *slot;
    if (slot_index >= VN_SPRITE_SLOT_COUNT) return 0u;
    slot = sprite_slot_ref(slot_index);
    if (slot->sprite_index < 0) return 0u;
    if (!sprite_animation_meta_ready || sprite_animation_meta_index != animation_index) return 0u;
    animation = &cd_transfer_scratch[
        (uint16_t)((animation_index % VN_SPRITE_ANIM_META_PER_SECTOR)
        * VN_SPRITE_ANIM_META_SLOT_BYTES)];
    animation_sprite_index = (unsigned int)animation[0]
        | ((unsigned int)animation[1] << 8);
    if (animation_sprite_index != (unsigned int)slot->sprite_index) return 0u;
    if (!animation[3] || animation[3] > VN_SPRITE_ANIM_MAX_FRAMES) return 0u;
    return 1u;
}
#endif

static uint8_t VN_LOGIC_OVERLAY_CODE cache_sprite_animation_impl(uint8_t slot_index, uint16_t animation_index)
{
    vn_sprite_slot_t *slot;
#if defined(__PCE_CD__) && PCE_VN_HAS_SPRITE_ANIMATIONS
    const uint8_t *animation;
    uint8_t animation_first_cell;
    uint8_t animation_frame_count;
    unsigned int animation_frame_delay;
    uint8_t animation_frame_width_cells;
    uint8_t animation_frame_height_cells;
    uint8_t animation_frame_stride_cells;
    uint8_t animation_loop;
    uint8_t i;
#endif
    if (slot_index >= VN_SPRITE_SLOT_COUNT) return 0u;
    slot = &sprite_slots[slot_index];
    slot->anim_frame_count = 0u;
    slot->anim_frame_delay = 0u;
    slot->anim_loop = 0u;
    slot->anim_first_cell = 0u;
    slot->anim_frame_width_cells = 0u;
    slot->anim_frame_height_cells = 0u;
    slot->anim_frame_stride_cells = 0u;
    slot->anim_frame_delays = (const unsigned int *)0;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    if (slot->sprite_index < 0 || slot->animation_index < 0) return 0u;
    if (animation_index != (uint16_t)slot->animation_index) return 0u;
#if defined(__PCE_CD__)
    if (!prepared_sprite_animation_matches(slot_index, animation_index)) return 0u;
    animation = &cd_transfer_scratch[
        (uint16_t)((animation_index % VN_SPRITE_ANIM_META_PER_SECTOR)
        * VN_SPRITE_ANIM_META_SLOT_BYTES)];
#else
    return 0u;
#endif
#if defined(__PCE_CD__)
    animation_first_cell = animation[2];
    animation_frame_count = animation[3];
    animation_frame_delay = (unsigned int)animation[4]
        | ((unsigned int)animation[5] << 8);
    animation_frame_width_cells = animation[6];
    animation_frame_height_cells = animation[7];
    animation_frame_stride_cells = animation[8];
    animation_loop = animation[9];
    slot->anim_frame_count = animation_frame_count;
    slot->anim_frame_delay = animation_frame_delay;
    slot->anim_loop = animation_loop;
    slot->anim_first_cell = animation_first_cell;
    slot->anim_frame_width_cells = animation_frame_width_cells;
    slot->anim_frame_height_cells = animation_frame_height_cells;
    slot->anim_frame_stride_cells = animation_frame_stride_cells;
    if (animation[10])
    {
        for (i = 0u; i < animation_frame_count && i < VN_SPRITE_ANIM_MAX_FRAMES; i++)
        {
            uint16_t offset = (uint16_t)(VN_SPRITE_ANIM_META_DELAYS_OFFSET + ((uint16_t)i * 2u));
            sprite_animation_delay_cache[slot_index][i] = (unsigned int)animation[offset]
                | ((unsigned int)animation[(uint16_t)(offset + 1u)] << 8);
        }
        slot->anim_frame_delays = sprite_animation_delay_cache[slot_index];
    }
#endif
#endif
    return slot->anim_frame_count ? 1u : 0u;
}

/* The state transition is pure bank124 logic. The resident wrapper below has
   already fetched the target record; this code never performs a CD/BIOS call. */
static uint8_t VN_LOGIC_OVERLAY_CODE update_active_message_mouth_impl(uint8_t restore)
{
    const signed int slot_index = active_message_state.mouth_slot;
    signed int normal_animation_index;
    vn_sprite_slot_t *slot;
    if (restore)
    {
        normal_animation_index = active_message_mouth_animation_index;
        active_message_mouth_animation_index = -1;
        if (normal_animation_index < 0) return 0u;
    }
    else
    {
        active_message_mouth_animation_index = -1;
        normal_animation_index = -1;
    }
    if (slot_index < 0 || slot_index >= VN_SPRITE_SLOT_COUNT) return 0u;
    slot = sprite_slot_ref((uint8_t)slot_index);
    if (restore)
    {
        if (slot->animation_index != normal_animation_index + 1) return 0u;
    }
    else
    {
        normal_animation_index = slot->animation_index;
        if (!slot->visible || slot->sprite_index < 0 || normal_animation_index < 0) return 0u;
        if ((unsigned int)(normal_animation_index + 1) >= pce_vn_sprite_animation_count) return 0u;
    }
#if defined(__PCE_CD__) && PCE_VN_HAS_SPRITE_ANIMATIONS
    if (!prepared_sprite_animation_matches(
        (uint8_t)slot_index,
        (uint16_t)(normal_animation_index + (restore ? 0 : 1)))) return 0u;
#endif
    slot->animation_index = (signed int)(normal_animation_index + (restore ? 0 : 1));
    slot->frame = 0u;
    slot->timer = 0u;
    if (!cache_sprite_animation_impl((uint8_t)slot_index, (uint16_t)slot->animation_index))
    {
        return 0u;
    }
    if (!restore) active_message_mouth_animation_index = normal_animation_index;
    REQUEST_SPRITE_REFRESH_FULL();
    return 1u;
}

/* Resident wrappers perform the only animation-meta CD read, then bank124
   applies the prepared bank132 record and detaches per-frame delays into BSS. */
static void VN_BANKED_CODE cache_sprite_animation(uint8_t slot_index)
{
#if defined(__PCE_CD__)
    signed int animation_index = -1;
    if (slot_index < VN_SPRITE_SLOT_COUNT)
        animation_index = sprite_slot_ref(slot_index)->animation_index;
    if (animation_index >= 0)
        (void)prepare_sprite_animation_meta((uint16_t)animation_index);
    else
        sprite_animation_meta_ready = 0u;
    (void)vn_logic_overlay_dispatch(
        VN_LOGIC_OVERLAY_OP_CACHE_SPRITE_ANIM,
        (uint16_t)animation_index,
        0u,
        slot_index);
    sprite_animation_meta_ready = 0u;
#else
    const signed int animation_index = slot_index < VN_SPRITE_SLOT_COUNT
        ? sprite_slot_ref(slot_index)->animation_index
        : -1;
    (void)cache_sprite_animation_impl(slot_index, (uint16_t)animation_index);
#endif
}

static void VN_BANKED_CODE update_active_message_mouth(uint8_t restore)
{
#if defined(__PCE_CD__)
    signed int target_animation_index = -1;
    const signed int slot_index = active_message_state.mouth_slot;
    if (restore)
    {
        target_animation_index = active_message_mouth_animation_index;
    }
    else if (slot_index >= 0 && slot_index < VN_SPRITE_SLOT_COUNT)
    {
        const vn_sprite_slot_t *slot = sprite_slot_ref((uint8_t)slot_index);
        if (slot->animation_index >= 0)
            target_animation_index = slot->animation_index + 1;
    }
    if (target_animation_index >= 0)
        (void)prepare_sprite_animation_meta((uint16_t)target_animation_index);
    else
        sprite_animation_meta_ready = 0u;
    (void)vn_logic_overlay_dispatch(VN_LOGIC_OVERLAY_OP_MESSAGE_MOUTH, 0u, 0u, restore);
    sprite_animation_meta_ready = 0u;
#else
    (void)update_active_message_mouth_impl(restore);
#endif
}

/* Boot runs before the bank122 runtime-support overlay is loaded. Keep this
   small nonzero sentinel initialization in permanent bank129 rather than
   dispatching through cancel_all_sprite_moves(). sprite_moves is static BSS
   and is therefore already zeroed before main(). */
static void VN_BANKED_CODE initialize_sprite_move_state(void)
{
    sync_sprite_move_slot = 0xffu;
}

static void VN_CD_ASYNC_CODE cancel_sprite_move_impl(uint8_t slot)
{
    sprite_moves[slot].active = 0u;
    if (sync_sprite_move_slot == slot) sync_sprite_move_slot = 0xffu;
}

static void VN_BANKED_CODE cancel_sprite_move(uint8_t slot)
{
#if defined(__PCE_CD__)
    vn_visual_cache_arg_slot = slot;
    (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_CANCEL_SPRITE_MOVE);
#else
    cancel_sprite_move_impl(slot);
#endif
}

static void VN_CD_ASYNC_CODE cancel_all_sprite_moves_impl(void)
{
    uint8_t slot;
    for (slot = 0u; slot < VN_SPRITE_SLOT_COUNT; slot++)
    {
        sprite_moves[slot].active = 0u;
    }
    sync_sprite_move_slot = 0xffu;
}

static void VN_BANKED_CODE cancel_all_sprite_moves(void)
{
#if defined(__PCE_CD__)
    (void)vn_cd_async_call_bank122(VN_CD_ASYNC_OP_CANCEL_ALL_SPRITE_MOVES);
#else
    cancel_all_sprite_moves_impl();
#endif
}

static uint8_t VN_BANKED_CODE2 start_sprite_move(const pce_vn_command_t *command)
{
    vn_sprite_slot_t *slot_state;
    vn_sprite_move_t *move;
    uint8_t slot;
    uint16_t frames;
    int16_t delta_x;
    int16_t delta_y;
    uint16_t distance_x;
    uint16_t distance_y;
    slot = command->slot;
    slot_state = &sprite_slots[slot];
    cancel_sprite_move(slot);
    if (!slot_state->visible || slot_state->sprite_index < 0) return 0u;
    frames = (uint16_t)command->arg0 | ((uint16_t)command->arg1 << 8);
    if (command->animation_index >= 0 && command->asset_index == slot_state->sprite_index)
    {
        slot_state->animation_index = command->animation_index;
        slot_state->frame = 0u;
        slot_state->timer = 0u;
        cache_sprite_animation(slot);
    }
    move = &sprite_moves[slot];
    delta_x = (int16_t)((int16_t)command->x - (int16_t)slot_state->x);
    delta_y = (int16_t)((int16_t)command->y - (int16_t)slot_state->y);
    distance_x = (uint16_t)(delta_x < 0 ? -delta_x : delta_x);
    distance_y = (uint16_t)(delta_y < 0 ? -delta_y : delta_y);
    move->target_x = command->x;
    move->target_y = command->y;
    move->distance_x = distance_x;
    move->distance_y = distance_y;
    move->direction_x = delta_x < 0 ? -1 : (delta_x > 0 ? 1 : 0);
    move->direction_y = delta_y < 0 ? -1 : (delta_y > 0 ? 1 : 0);
    move->error_x = 0u;
    move->error_y = 0u;
    move->total_frames = frames;
    move->remaining_frames = frames;
    move->active = 1u;
    if (!(command->flags & PCE_VN_SPRITE_MOVE_ASYNC)) sync_sprite_move_slot = slot;
    return (uint8_t)!(command->flags & PCE_VN_SPRITE_MOVE_ASYNC);
}

#if defined(__PCE_CD__)
static void VN_LOGIC_OVERLAY_CODE tick_sprite_animations_impl(void)
#else
static void tick_sprite_animations(void)
#endif
{
    uint8_t i;
    uint8_t changed = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = sprite_slot_ref(i);
#if PCE_VN_HAS_SPRITE_ANIMATIONS
        unsigned int frame_delay;
        if (slot->visible && slot->anim_frame_count > 1u)
        {
            frame_delay = (slot->anim_frame_delays && slot->frame < slot->anim_frame_count)
                ? slot->anim_frame_delays[slot->frame]
                : slot->anim_frame_delay;
            if (!frame_delay) frame_delay = slot->anim_frame_delay;
            slot->timer++;
            if (slot->timer >= frame_delay)
            {
                slot->timer = 0u;
                if (slot->frame + 1u < slot->anim_frame_count) slot->frame++;
                else if (slot->anim_loop) slot->frame = 0u;
                changed = 1u;
            }
        }
#endif
        if (sprite_moves[i].active)
        {
            vn_sprite_move_t *move = &sprite_moves[i];
            uint16_t amount;
            uint16_t room;
            if (move->remaining_frames <= 1u)
            {
                slot->x = move->target_x;
                slot->y = move->target_y;
                move->remaining_frames = 0u;
                move->active = 0u;
            }
            else
            {
                amount = move->distance_x;
                while (amount)
                {
                    room = (uint16_t)(move->total_frames - move->error_x);
                    if (amount < room)
                    {
                        move->error_x = (uint16_t)(move->error_x + amount);
                        amount = 0u;
                    }
                    else
                    {
                        amount = (uint16_t)(amount - room);
                        move->error_x = 0u;
                        slot->x = (uint16_t)((int16_t)slot->x + move->direction_x);
                    }
                }
                amount = move->distance_y;
                while (amount)
                {
                    room = (uint16_t)(move->total_frames - move->error_y);
                    if (amount < room)
                    {
                        move->error_y = (uint16_t)(move->error_y + amount);
                        amount = 0u;
                    }
                    else
                    {
                        amount = (uint16_t)(amount - room);
                        move->error_y = 0u;
                        slot->y = (uint16_t)((int16_t)slot->y + move->direction_y);
                    }
                }
                move->remaining_frames--;
            }
            changed = 1u;
        }
    }
    if (changed) REQUEST_SPRITE_REFRESH_PATTERNS();
}

#if defined(__PCE_CD__)
static void VN_RESIDENT_CODE tick_sprite_animations(void)
{
    (void)vn_logic_overlay_dispatch(VN_LOGIC_OVERLAY_OP_TICK_SPRITE_ANIMATIONS, 0u, 0u, 0u);
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
    /* The shadow/SATB contents were cleared above.  A later identical Sprite
       command must rebuild them instead of treating its logical state as live. */
    sprite_satb_layout_valid = 0u;
    pending_scene_sprite_clear = 0u;
    if (!pending_display_enable)
    {
        sprite_layer_disable();
        delay_frame();
    }
#if defined(__PCE_CD__)
    spritetext_glyph_cache_count = 0u;
#endif
}

/* preload_scene_assets/preload_scan_boundary/preload_adpcm_voice removed: the
   scene-entry pre-scan duplicated the on-demand loads that run_commands_until_wait
   already performs per command (set_background, ensure_sprite_patterns_loaded,
   play_adpcm_voice). Dropping it reclaims its bank130 footprint. */

