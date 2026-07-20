/* PHASE_A_SPLIT:BEGIN vn_port_scene.c — scene pack loading/decoding (readers +
   resident wrappers), variables/RNG/compare/jump, BG upload helpers,
   handle_audio_command, show_scene, choice/switch handling, set_background,
   the command execution loop and advance_story. Moved verbatim from
   pce_vn_runtime.c (Phase A module split). PHASE_A_SPLIT:END */
static signed int command_value_arg(const pce_vn_command_t *command)
{
    if (!command) return 0;
    return (signed int)(int16_t)((uint16_t)command->arg0 | ((uint16_t)command->arg1 << 8));
}

static signed int signed_from_u16(uint16_t value)
{
    return (signed int)(int16_t)value;
}

static signed int clamp_variable_value(int32_t value)
{
    if (value < -32768L) return (signed int)-32768;
    if (value > 32767L) return (signed int)32767;
    return (signed int)value;
}

static signed int VN_BANKED_CODE2 variable_value(signed int variable_index)
{
    uint8_t index;
    uint16_t value;
    if (variable_index < 0 || (uint8_t)variable_index >= pce_vn_variable_count) return 0;
    if ((uint8_t)variable_index >= PCE_VN_VARIABLE_STORAGE_COUNT) return 0;
    index = (uint8_t)variable_index;
    value = (uint16_t)vn_variable_lo[index] | ((uint16_t)vn_variable_hi[index] << 8);
    return (signed int)(int16_t)value;
}

/* Overlay (pure bss write). Reached via the resident dispatcher below. */
static void VN_OVERLAY_CODE set_variable_value_impl(signed int variable_index, signed int value)
{
    uint8_t index;
    uint16_t raw;
    if (variable_index < 0 || (uint8_t)variable_index >= pce_vn_variable_count) return;
    if ((uint8_t)variable_index >= PCE_VN_VARIABLE_STORAGE_COUNT) return;
    index = (uint8_t)variable_index;
    raw = (uint16_t)(int16_t)value;
    vn_variable_lo[index] = (uint8_t)(raw & 0xffu);
    vn_variable_hi[index] = (uint8_t)(raw >> 8);
}

static void VN_BANKED_CODE set_variable_value(signed int variable_index, signed int value)
{
#if defined(__PCE_CD__)
    (void)vn_overlay_dispatch(VN_OVERLAY_OP_SET_VARIABLE, (uint16_t)variable_index, (uint16_t)value, 0u);
#else
    set_variable_value_impl(variable_index, value);
#endif
}

static uint16_t next_random_value(void)
{
    uint16_t x = vn_rng_state;
    x ^= (uint16_t)(x << 7);
    x ^= (uint16_t)(x >> 9);
    x ^= (uint16_t)(x << 8);
    if (!x) x = 0xace1u;
    vn_rng_state = x;
    return x;
}

static signed int random_range_value(signed int min, signed int max)
{
    int32_t diff;
    uint16_t span;
    if (min > max)
    {
        signed int tmp = min;
        min = max;
        max = tmp;
    }
    diff = (int32_t)max - (int32_t)min;
    span = diff >= 65535 ? 65535u : (uint16_t)(diff + 1);
    if (!span) return min;
    return clamp_variable_value((int32_t)min + (int32_t)(next_random_value() % span));
}

static uint8_t compare_values(signed int left, uint8_t operator_id, signed int right)
{
    if (operator_id == PCE_VN_COMPARE_NE) return (uint8_t)(left != right);
    if (operator_id == PCE_VN_COMPARE_LT) return (uint8_t)(left < right);
    if (operator_id == PCE_VN_COMPARE_LTE) return (uint8_t)(left <= right);
    if (operator_id == PCE_VN_COMPARE_GT) return (uint8_t)(left > right);
    if (operator_id == PCE_VN_COMPARE_GTE) return (uint8_t)(left >= right);
    return (uint8_t)(left == right);
}

static uint8_t VN_BANKED_CODE2 jump_to_command(uint16_t command_offset)
{
    if (command_offset == PCE_VN_NO_COMMAND) return 0u;
    if (!load_scene_pack_into_cache(current_scene, &active_scene_pack)) return 0u;
    if (command_offset >= scene_pack_command_count(&active_scene_pack)) return 0u;
#if defined(__PCE_CD__)
    cancel_runtime_cache_load();
#endif
    current_command = (uint8_t)command_offset;
    return 1u;
}

static uint8_t VN_OVERLAY_CODE scene_pack_has_range(const vn_scene_pack_cache_t *cache, uint16_t offset, uint16_t length)
{
    if (!cache || !cache->valid || !cache->base) return 0u;
    if (offset > cache->size) return 0u;
    return (uint8_t)(length <= (uint16_t)(cache->size - offset));
}

static uint8_t scene_pack_u8(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    uint8_t saved;
    uint8_t value;
    if (!cache || !cache->valid || !cache->base) return 0u;
    if (offset >= cache->size) return 0u;
    __asm__ volatile("tma #$40" : "=a"(saved));
    __asm__ volatile("lda #123\n\ttam #$40" ::: "a");
    value = ((const uint8_t *)(uintptr_t)cache->base)[offset];
    __asm__ volatile("tam #$40" : : "a"(saved));
    return value;
}

static uint8_t VN_OVERLAY_CODE scene_pack_copy(const vn_scene_pack_cache_t *cache,
    uint16_t offset, uint8_t *dest, uint16_t length)
{
    uint8_t saved;
    uint16_t i;
    if (!dest || !scene_pack_has_range(cache, offset, length)) return 0u;
    __asm__ volatile("tma #$40" : "=a"(saved));
    __asm__ volatile("lda #123\n\ttam #$40" ::: "a");
    for (i = 0u; i < length; i++) dest[i] = ((const uint8_t *)(uintptr_t)cache->base)[offset + i];
    __asm__ volatile("tam #$40" : : "a"(saved));
    return 1u;
}

/* Overlay (bank133) functions: they are called only by the overlay scene-pack
   readers (and s16->u16), so they live in the overlay alongside them rather than
   inlining (which bloated the overlay) or sitting in bank130 (unreachable from the
   overlay). u8 stays resident because spritetext command scanning also uses it;
   has_range is overlay-only to keep bank128 below its fixed resident budget. */
static uint16_t VN_OVERLAY_CODE scene_pack_u16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    uint8_t bytes[2];
    if (!scene_pack_has_range(cache, offset, 2u)) return 0u;
    if (!scene_pack_copy(cache, offset, bytes, 2u)) return 0u;
    return (uint16_t)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8));
}

static signed int VN_OVERLAY_CODE scene_pack_s16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    return (signed int)(int16_t)scene_pack_u16(cache, offset);
}

static uint8_t scene_pack_is_valid(const vn_scene_pack_cache_t *cache)
{
    if (!cache || !cache->base || cache->size < PCE_VN_SCENE_PACK_HEADER_SIZE) return 0u;
    if (scene_pack_u8(cache, 0u) != VN_SCENE_PACK_MAGIC_P) return 0u;
    if (scene_pack_u8(cache, 1u) != VN_SCENE_PACK_MAGIC_V) return 0u;
    if (scene_pack_u8(cache, 2u) != VN_SCENE_PACK_MAGIC_N) return 0u;
    if (scene_pack_u8(cache, 3u) != VN_SCENE_PACK_MAGIC_S) return 0u;
    return (uint8_t)(scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_VERSION) == PCE_VN_SCENE_PACK_VERSION);
}

static uint8_t VN_BANKED_CODE2 load_scene_pack_into_cache(uint8_t scene_index, vn_scene_pack_cache_t *cache)
{
    if (!cache) return 0u;
    if (cache->valid && cache->scene_index == scene_index) return 1u;
    cache->valid = 0u;
#if defined(__PCE_CD__)
    {
        pce_vn_scene_pack_t pack;
        pce_sector_t sector = {0};
        map_vn_data();
        if (scene_index >= pce_vn_scene_count) return 0u;
        pack = pce_vn_scene_packs[scene_index];
        if (!pack.byte_size || pack.byte_size > PCE_VN_SCENE_PACK_CACHE_BYTES || !pack.sector_count) return 0u;
        sector.lo = pack.sector.lo;
        sector.md = pack.sector.md;
        sector.hi = pack.sector.hi;
        if (!vn_cd_async_begin_scene_pack_read(sector, cache->base, pack.byte_size))
        {
            return 0u;
        }
        while (vn_cd_async_status == VN_CD_ASYNC_STATUS_ACTIVE)
        {
            vn_wait_next_vblank_raw();
            engine_service();
            vn_cd_async_service_frame();
        }
        cache->size = pack.byte_size;
        cache->scene_index = scene_index;
        /* The bounded bank123 readers intentionally reject an invalid cache.
           Mark a completed transfer readable for the header probe, then revoke
           it immediately when magic/version validation fails. */
        cache->valid = (uint8_t)(vn_cd_async_status == VN_CD_ASYNC_STATUS_DONE);
        if (cache->valid && !scene_pack_is_valid(cache)) cache->valid = 0u;
        VN_MAP_BANK130_FOR_CODE();
        return cache->valid;
    }
#else
    (void)scene_index;
    return 0u;
#endif
}

/* Resident (bank128) so both bank130 callers and the bank133 overlay readers can
   reach it; it is also referenced before its definition (jump_to_command), so it
   cannot be always_inline. */
static uint8_t scene_pack_command_count(const vn_scene_pack_cache_t *cache)
{
    return scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_COMMAND_COUNT);
}

static uint8_t VN_BANKED_CODE2 scene_pack_full_screen_bg(const vn_scene_pack_cache_t *cache)
{
#if !PCE_VN_HAS_FULL_SCREEN_BG
    (void)cache;
    return 0u;
#else
    return (uint8_t)(scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_FLAGS) & PCE_VN_SCENE_FLAG_FULL_SCREEN_BG);
#endif
}

static uint8_t VN_OVERLAY_CODE scene_pack_read_command_impl(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command)
{
    uint16_t offset;
    if (!command) return 0u;
    if (command_index >= scene_pack_command_count(cache)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_COMMAND_TABLE)
        + ((uint16_t)command_index * PCE_VN_SCENE_PACK_COMMAND_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_COMMAND_SIZE)) return 0u;
    command->type = scene_pack_u8(cache, offset);
    command->asset_index = scene_pack_s16(cache, (uint16_t)(offset + 1u));
    command->slot = scene_pack_u8(cache, (uint16_t)(offset + 3u));
    command->flags = scene_pack_u8(cache, (uint16_t)(offset + 4u));
    command->arg0 = scene_pack_u8(cache, (uint16_t)(offset + 5u));
    command->arg1 = scene_pack_u8(cache, (uint16_t)(offset + 6u));
    command->x = scene_pack_u16(cache, (uint16_t)(offset + 7u));
    command->y = scene_pack_u16(cache, (uint16_t)(offset + 9u));
    command->message_index = scene_pack_s16(cache, (uint16_t)(offset + 11u));
    command->animation_index = scene_pack_s16(cache, (uint16_t)(offset + 13u));
    command->scene_index = scene_pack_s16(cache, (uint16_t)(offset + 15u));
    command->choice_index = scene_pack_s16(cache, (uint16_t)(offset + 17u));
    return 1u;
}

static uint8_t VN_OVERLAY_CODE scene_pack_read_message_impl(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!message) return 0u;
    if (message_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_MESSAGE_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_MESSAGE_TABLE)
        + ((uint16_t)message_index * PCE_VN_SCENE_PACK_MESSAGE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_MESSAGE_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    /* Each glyph entry (and the 0xffff terminator) is 16-bit. */
    if (!scene_pack_has_range(cache, glyph_offset, 2u)) return 0u;
    message->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    if (message->glyph_count > VN_MESSAGE_GLYPH_CACHE_COUNT) return 0u;
    if (!scene_pack_copy(cache, glyph_offset, vn_scene_text_buffer, (uint16_t)message->glyph_count * 2u)) return 0u;
    message->glyphs = vn_scene_text_buffer;
    message->voice_index = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    message->text_speed_frames = scene_pack_u8(cache, (uint16_t)(offset + 5u));
    message->advance_mode = scene_pack_u8(cache, (uint16_t)(offset + 6u));
    message->auto_wait_frames = scene_pack_u8(cache, (uint16_t)(offset + 7u));
    message->mouth_animation_index = scene_pack_s16(cache, (uint16_t)(offset + 8u));
    message->mouth_slot = scene_pack_u8(cache, (uint16_t)(offset + 10u));
    message->text_color = scene_pack_u16(cache, (uint16_t)(offset + 11u));
    return 1u;
}

static uint8_t VN_OVERLAY_CODE scene_pack_read_choice_impl(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice)
{
    uint16_t offset;
    if (!choice) return 0u;
    if (choice_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_CHOICE_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_CHOICE_TABLE)
        + ((uint16_t)choice_index * PCE_VN_SCENE_PACK_CHOICE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_CHOICE_SIZE)) return 0u;
    choice->options_offset = scene_pack_u16(cache, offset);
    choice->option_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    choice->default_index = scene_pack_u8(cache, (uint16_t)(offset + 3u));
    choice->variable_index = scene_pack_s16(cache, (uint16_t)(offset + 4u));
    return 1u;
}

static uint8_t VN_OVERLAY_CODE scene_pack_read_choice_option_impl(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!choice || !option || option_index >= choice->option_count) return 0u;
    offset = (uint16_t)(choice->options_offset + ((uint16_t)option_index * PCE_VN_SCENE_PACK_OPTION_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_OPTION_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    /* Each glyph entry (and the 0xffff terminator) is 16-bit. */
    if (!scene_pack_has_range(cache, glyph_offset, 2u)) return 0u;
    option->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    if (option->glyph_count > VN_MESSAGE_GLYPH_CACHE_COUNT) return 0u;
    if (!scene_pack_copy(cache, glyph_offset, vn_scene_text_buffer, (uint16_t)option->glyph_count * 2u)) return 0u;
    option->glyphs = vn_scene_text_buffer;
    option->value = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    option->target_scene = scene_pack_s16(cache, (uint16_t)(offset + 5u));
    return 1u;
}

static uint8_t VN_OVERLAY_CODE scene_pack_read_switch_impl(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch)
{
    uint16_t offset;
    if (!branch) return 0u;
    if (switch_index >= scene_pack_u8(cache, VN_SCENE_PACK_OFFSET_SWITCH_COUNT)) return 0u;
    offset = (uint16_t)(scene_pack_u16(cache, VN_SCENE_PACK_OFFSET_SWITCH_TABLE)
        + ((uint16_t)switch_index * PCE_VN_SCENE_PACK_SWITCH_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_SIZE)) return 0u;
    branch->cases_offset = scene_pack_u16(cache, offset);
    branch->case_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    branch->default_command = scene_pack_u16(cache, (uint16_t)(offset + 3u));
    return 1u;
}

static uint8_t VN_OVERLAY_CODE scene_pack_read_switch_case_impl(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case)
{
    uint16_t offset;
    if (!branch || !branch_case || case_index >= branch->case_count) return 0u;
    offset = (uint16_t)(branch->cases_offset + ((uint16_t)case_index * PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE)) return 0u;
    branch_case->value = scene_pack_s16(cache, offset);
    branch_case->command = scene_pack_u16(cache, (uint16_t)(offset + 2u));
    return 1u;
}

/* Resident wrappers keep the original reader names/signatures so call sites are
   unchanged. On CD the cache arg is ignored (the overlay reads active_scene_pack). */
static uint8_t VN_BANKED_CODE scene_pack_read_command(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command)
{
#if defined(__PCE_CD__)
    (void)cache;
    return vn_overlay_dispatch(VN_OVERLAY_OP_READ_COMMAND, (uint16_t)(uintptr_t)command, 0u, command_index);
#else
    return scene_pack_read_command_impl(cache, command_index, command);
#endif
}

static uint8_t VN_BANKED_CODE scene_pack_read_message(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message)
{
#if defined(__PCE_CD__)
    (void)cache;
    return vn_overlay_dispatch(VN_OVERLAY_OP_READ_MESSAGE, (uint16_t)(uintptr_t)message, 0u, message_index);
#else
    return scene_pack_read_message_impl(cache, message_index, message);
#endif
}

static uint8_t VN_BANKED_CODE scene_pack_read_choice(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice)
{
#if defined(__PCE_CD__)
    (void)cache;
    return vn_overlay_dispatch(VN_OVERLAY_OP_READ_CHOICE, (uint16_t)(uintptr_t)choice, 0u, choice_index);
#else
    return scene_pack_read_choice_impl(cache, choice_index, choice);
#endif
}

static uint8_t VN_BANKED_CODE scene_pack_read_choice_option(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option)
{
#if defined(__PCE_CD__)
    (void)cache;
    return vn_overlay_dispatch(VN_OVERLAY_OP_READ_CHOICE_OPTION, (uint16_t)(uintptr_t)option, (uint16_t)(uintptr_t)choice, option_index);
#else
    return scene_pack_read_choice_option_impl(cache, choice, option_index, option);
#endif
}

static uint8_t VN_BANKED_CODE scene_pack_read_switch(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch)
{
#if defined(__PCE_CD__)
    (void)cache;
    return vn_overlay_dispatch(VN_OVERLAY_OP_READ_SWITCH, (uint16_t)(uintptr_t)branch, 0u, switch_index);
#else
    return scene_pack_read_switch_impl(cache, switch_index, branch);
#endif
}

static uint8_t VN_BANKED_CODE scene_pack_read_switch_case(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case)
{
#if defined(__PCE_CD__)
    (void)cache;
    return vn_overlay_dispatch(VN_OVERLAY_OP_READ_SWITCH_CASE, (uint16_t)(uintptr_t)branch_case, (uint16_t)(uintptr_t)branch, case_index);
#else
    return scene_pack_read_switch_case_impl(cache, branch, case_index, branch_case);
#endif
}

static uint16_t bg_map_dest_from_tile(const pce_editor_bg_asset_t *bg, uint16_t tile_x, uint16_t tile_y)
{
    uint8_t x = tile_x < VN_MAP_WIDTH ? (uint8_t)tile_x : 0u;
    uint8_t y = tile_y < VN_MAP_HEIGHT ? (uint8_t)tile_y : 0u;
    return (uint16_t)(bg->map_base + ((uint16_t)y * VN_MAP_WIDTH) + x);
}

static void clear_bg_map_region(const pce_editor_bg_asset_t *bg, uint16_t tile_x, uint16_t tile_y)
{
    if (!bg) return;
    clear_map_rect_at_dest(bg_map_dest_from_tile(bg, tile_x, tile_y), bg->width_tiles, bg->height_tiles);
}

static void clear_current_bg_map_region(void)
{
    uint8_t x;
    uint8_t y;
    if (current_bg_index < 0) return;
    if (!current_bg_width_tiles || !current_bg_height_tiles) return;
    x = current_bg_x < VN_MAP_WIDTH ? current_bg_x : 0u;
    y = current_bg_y < VN_MAP_HEIGHT ? current_bg_y : 0u;
    clear_map_rect_at_dest(
        (uint16_t)(current_bg_map_base + ((uint16_t)y * VN_MAP_WIDTH) + x),
        current_bg_width_tiles,
        current_bg_height_tiles
    );
}

static void VN_BANKED_CODE clear_bg_map_side_margins(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles)
{
    uint8_t x;
    uint8_t y;
    uint8_t visible_width;
    uint8_t visible_height;
    if (!width_tiles || !height_tiles) return;
    x = (uint8_t)(map_dest % VN_MAP_WIDTH);
    y = (uint8_t)(map_dest / VN_MAP_WIDTH);
    if (y >= VN_MAP_HEIGHT) return;
    visible_width = width_tiles;
    visible_height = height_tiles;
    if ((uint16_t)x + visible_width > VN_MAP_WIDTH) visible_width = (uint8_t)(VN_MAP_WIDTH - x);
    if ((uint16_t)y + visible_height > VN_MAP_HEIGHT) visible_height = (uint8_t)(VN_MAP_HEIGHT - y);
    if (!visible_height) return;
    if (x)
    {
        clear_map_rect_at_dest((uint16_t)(map_dest - x), x, visible_height);
    }
    if ((uint16_t)x + visible_width < VN_MAP_WIDTH)
    {
        clear_map_rect_at_dest((uint16_t)(map_dest + visible_width),
            (uint8_t)(VN_MAP_WIDTH - (x + visible_width)), visible_height);
    }
}

static void upload_bg_graphics(const pce_editor_bg_asset_t *bg, uint16_t map_dest, uint16_t bg_index)
{
    uint8_t row;
    uint16_t row_bytes;
    const uint8_t *map;
    if (!bg) return;
    upload_palette(&bg->palette, (uint16_t)(bg->palette_bank * 16u), 0);
    copy_data_ref_to_vram((uint16_t)(bg->tile_base * 16u), &bg->tiles, 16u, VN_VISUAL_CACHE_KIND_BG_TILES, bg_index);
    map_resident_data();
#if defined(__PCE_CD__)
    if (bg->map.cd && bg->map.size)
    {
        VN_MAP_BANK130_FOR_CODE();
        if (cd_bg_map_ref_to_vram(map_dest, &bg->map, bg->width_tiles, bg->height_tiles, bg_index))
        {
            clear_bg_map_side_margins(map_dest, bg->width_tiles, bg->height_tiles);
            return;
        }
    }
#endif
    map = data_ref_ptr(&bg->map);
    if (!map) return;
    row_bytes = (uint16_t)(bg->width_tiles * 2u);
    for (row = 0; row < bg->height_tiles; row++)
    {
        pce_editor_vram_copy(
            (uint16_t)(map_dest + ((uint16_t)row * VN_MAP_WIDTH)),
            map + ((uint16_t)row * row_bytes),
            row_bytes
        );
        engine_service();
    }
    clear_bg_map_side_margins(map_dest, bg->width_tiles, bg->height_tiles);
}

static void VN_BANKED_CODE2 handle_audio_command(uint8_t flags, signed int asset_index, uint8_t arg)
{
    const uint8_t kind = (uint8_t)(flags & 0x0fu);
    const uint8_t action = (uint8_t)(flags & 0xf0u);
#if defined(__PCE_CD__)
    if (kind == PCE_VN_AUDIO_KIND_ADPCM)
    {
        if (action == PCE_VN_AUDIO_ACTION_STOP) stop_adpcm_voice();
        else play_adpcm_voice(asset_index);
    }
    else if (kind == PCE_VN_AUDIO_KIND_PSG)
    {
        if (action == PCE_VN_AUDIO_ACTION_STOP) stop_psg_target(arg);
        else play_psg_asset(asset_index, arg);
    }
    else
    {
        if (action == PCE_VN_AUDIO_ACTION_STOP) cdda_audio_command(-1);
        else if (asset_index >= 0) cdda_audio_command(asset_index);
    }
#else
    if (kind == PCE_VN_AUDIO_KIND_PSG)
    {
        if (action == PCE_VN_AUDIO_ACTION_STOP) stop_psg();
        else play_psg_asset(asset_index, arg);
    }
    else
    {
        (void)action;
        (void)asset_index;
        (void)arg;
    }
#endif
}

static void show_scene(uint8_t scene_index)
{
#if PCE_VN_HAS_FULL_SCREEN_BG
    uint8_t i;
    uint8_t previous_full_screen_bg;
#endif
    uint8_t keep_display_for_transition;
    uint8_t use_preloaded_scene_visual;
#if defined(__PCE_CD__)
    cancel_runtime_cache_load();
#endif
    VN_MAP_BANK130_FOR_CODE();
    cancel_all_sprite_moves();
    map_vn_data();
    if (!pce_vn_scene_count) return;
    if (scene_index >= pce_vn_scene_count) scene_index = runtime_start_scene;
    if (scene_index >= pce_vn_scene_count) scene_index = 0u;
    begin_cdda_deferred_resume();
    if (!load_scene_pack_into_cache(scene_index, &active_scene_pack))
    {
        end_cdda_deferred_resume();
        return;
    }
#if PCE_VN_HAS_FULL_SCREEN_BG
    previous_full_screen_bg = current_scene_full_screen_bg;
    current_scene_full_screen_bg = scene_pack_full_screen_bg(&active_scene_pack);
    keep_display_for_transition = (uint8_t)(current_bg_index >= 0
        && !pending_display_enable
        && !(previous_full_screen_bg && !current_scene_full_screen_bg));
#else
    keep_display_for_transition = (uint8_t)(current_bg_index >= 0 && !pending_display_enable);
#endif
    use_preloaded_scene_visual = (uint8_t)(pending_display_enable
        && preloaded_scene_visual_valid
        && preloaded_scene_index == scene_index);
    if (!keep_display_for_transition)
    {
        if (!pending_display_enable) display_disable();
        pending_display_enable = 1u;
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (previous_full_screen_bg && !current_scene_full_screen_bg)
        {
            restore_text_vram_after_full_screen_bg();
        }
#endif
        if (!use_preloaded_scene_visual)
        {
            clear_screen_map();
            preloaded_bg_valid = 0u;
            preloaded_scene_visual_valid = 0u;
        }
    }
    current_scene = scene_index;
    current_command = 0;
    active_message_index = -1;
    active_choice_index = -1;
    wait_frames_remaining = 0u;
    message_complete = 1u;
    /* Input-check watchers and their target labels are scene-local. */
    sync_input_active = 0u;
    sync_input_mask = 0u;
    sync_input_target = PCE_VN_NO_COMMAND;
    async_input_active = 0u;
    async_input_mask = 0u;
    async_input_target = PCE_VN_NO_COMMAND;
#if PCE_VN_HAS_FULL_SCREEN_BG
    if (current_scene_full_screen_bg)
    {
        for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
        {
            sprite_slots[i].sprite_index = -1;
            sprite_slots[i].animation_index = -1;
            sprite_slots[i].visible = 0u;
            sprite_slots[i].flags = 0u;
            sprite_slots[i].frame = 0u;
            sprite_slots[i].timer = 0u;
            sprite_slots[i].anim_frame_count = 0u;
            sprite_slots[i].anim_frame_delay = 0u;
            sprite_slots[i].anim_loop = 0u;
            sprite_slots[i].anim_first_cell = 0u;
            sprite_slots[i].anim_frame_width_cells = 0u;
            sprite_slots[i].anim_frame_height_cells = 0u;
            sprite_slots[i].anim_frame_stride_cells = 0u;
            sprite_slots[i].anim_frame_delays = (const unsigned int *)0;
        }
    }
#endif
    VN_MAP_BANK130_FOR_CODE();
    clear_spritetext_slots();
#if PCE_VN_HAS_FULL_SCREEN_BG
    pending_scene_sprite_clear = current_scene_full_screen_bg ? 1u : 0u;
#else
    pending_scene_sprite_clear = 0u;
#endif
    VN_MAP_BANK130_FOR_CODE();
    REQUEST_SPRITE_REFRESH_FULL();
    /* Assets load on demand as run_commands_until_wait() processes each command
       (set_background / sprite show read CD data; play_adpcm_voice first fills
       ADPCM RAM, then starts buffered playback). The old scene-entry preload pass
       was a redundant pre-scan and is gone; set_background still self-caches the
       current BG to skip re-uploads. */
    preloaded_scene_visual_valid = 0u;
    end_cdda_deferred_resume();
}

static void start_choice(uint8_t choice_index)
{
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    VN_MAP_BANK130_FOR_CODE();
    if (!scene_pack_read_choice(&active_scene_pack, choice_index, choice)) return;
    if (!choice->option_count) return;
    active_message_index = -1;
    message_complete = 1u;
    wait_frames_remaining = 0u;
    active_choice_index = choice_index;
    choice_selected_index = choice->default_index < choice->option_count ? choice->default_index : 0u;
    VN_MAP_BANK130_FOR_CODE();
    draw_choice_options();
}

static uint8_t handle_choice_input(uint8_t pressed)
{
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    if (active_choice_index < 0) return 0u;
    VN_MAP_BANK130_FOR_CODE();
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, choice)) return 0u;
    if (!choice->option_count) return 0u;
    if (pressed & PAD_UP)
    {
        if (choice_selected_index) choice_selected_index--;
        else choice_selected_index = (uint8_t)(choice->option_count - 1u);
        VN_MAP_BANK130_FOR_CODE();
        draw_choice_options();
        return 1u;
    }
    if (pressed & PAD_DOWN)
    {
        choice_selected_index++;
        if (choice_selected_index >= choice->option_count) choice_selected_index = 0u;
        VN_MAP_BANK130_FOR_CODE();
        draw_choice_options();
        return 1u;
    }
    if (pressed & (PAD_I | PAD_II | PAD_RUN))
    {
        pce_vn_choice_option_t *option = VN_CHOICE_OPTION_SCRATCH;
        uint8_t restore_window_display;
        VN_MAP_BANK130_FOR_CODE();
        if (!scene_pack_read_choice_option(&active_scene_pack, choice, choice_selected_index, option)) return 0u;
        active_choice_index = -1;
        VN_MAP_BANK130_FOR_CODE();
        restore_window_display = begin_message_window_vram_update();
        clear_window_tile_pixels();
        end_message_window_vram_update(restore_window_display);
        if (!restore_window_display && !pending_display_enable)
        {
            delay_frame();
        }
        if (choice->variable_index >= 0)
        {
            set_variable_value(choice->variable_index, option->value);
        }
        if (option->target_scene >= 0) show_scene((uint8_t)option->target_scene);
        advance_story();
        return 1u;
    }
    return 0u;
}

static void set_background(signed int bg_index, uint8_t transition, uint8_t fade_out_frames, uint8_t fade_in_frames, uint16_t tile_x, uint16_t tile_y)
{
    const pce_editor_bg_asset_t *next_bg;
    const uint8_t fade_transition = (uint8_t)(transition == PCE_VN_BG_TRANSITION_FADE);
    const uint8_t implicit_fade = (uint8_t)(transition == PCE_VN_BG_TRANSITION_CUT
        && current_bg_index >= 0
        && !pending_display_enable);
    const uint8_t bg_fade_out_frames = fade_transition ? fade_out_frames
        : (implicit_fade ? VN_BG_IMPLICIT_FADE_FRAMES : 0u);
    const uint8_t bg_fade_in_frames = fade_transition ? fade_in_frames
        : (implicit_fade ? VN_BG_IMPLICIT_FADE_FRAMES : 0u);
    const uint8_t next_x = tile_x < VN_MAP_WIDTH ? (uint8_t)tile_x : 0u;
    const uint8_t next_y = tile_y < VN_MAP_HEIGHT ? (uint8_t)tile_y : 0u;
    const uint8_t bg_position_changed = (uint8_t)(current_bg_x != next_x || current_bg_y != next_y);
    const uint8_t restore_display_after_bg_load = (uint8_t)!pending_display_enable;
    uint8_t bg_ready;
    uint8_t i;
    if (bg_index < 0 || (unsigned int)bg_index >= pce_editor_bg_asset_count) return;
    next_bg = vn_get_bg_asset((uint16_t)bg_index);
#if defined(__PCE_CD__)
    pce_vn_data_map();
#endif
    if (bg_fade_out_frames && current_bg_index >= 0 && !pending_display_enable && current_bg_palette_size)
    {
        /* Fade the OLD bg out using its resident palette snapshot (no descriptor refetch). */
        const pce_editor_data_ref_t ref = { current_bg_palette, current_bg_palette_size, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 };
        fade_palette(&ref, current_bg_palette_base, bg_fade_out_frames, 0u);
    }
    if ((fade_transition || implicit_fade) && !pending_display_enable)
    {
        VN_BG_UPLOAD_DISPLAY_DISABLE();
        pending_display_enable = 1u;
    }
    if (pending_scene_sprite_clear)
    {
        clear_sprites();
        upload_sprite_table();
        pending_scene_sprite_clear = 0u;
    }
    bg_ready = (uint8_t)(preloaded_bg_valid
        && preloaded_bg_index == (uint16_t)bg_index
        && preloaded_bg_x == next_x
        && preloaded_bg_y == next_y);
    if (!bg_ready)
    {
        if (current_bg_index >= 0 && (bg_index != current_bg_index || bg_position_changed))
        {
            clear_current_bg_map_region();
        }
        clear_bg_map_region(next_bg, next_x, next_y);
        upload_bg_graphics(next_bg, bg_map_dest_from_tile(next_bg, next_x, next_y), (uint16_t)bg_index);
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (current_scene_full_screen_bg)
        {
            full_screen_bg_text_vram_dirty = 1u;
            for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
            {
                loaded_sprite_pattern_valid[i] = 0u;
            }
        }
#endif
        if (restore_display_after_bg_load) display_enable();
        preloaded_bg_valid = 1u;
        preloaded_bg_index = (uint16_t)bg_index;
        preloaded_bg_x = next_x;
        preloaded_bg_y = next_y;
    }
    current_bg_index = bg_index;
    current_bg_x = next_x;
    current_bg_y = next_y;
    current_bg_map_base = next_bg->map_base;
    current_bg_width_tiles = next_bg->width_tiles;
    current_bg_height_tiles = next_bg->height_tiles;
    /* Snapshot the new BG palette for the bank130 fade helpers (see decl). */
    current_bg_palette_size = next_bg->palette.size > 32u ? 32u : (uint8_t)next_bg->palette.size;
    current_bg_palette_base = (uint8_t)(next_bg->palette_bank * 16u);
    if (next_bg->palette.data && current_bg_palette_size)
    {
        __builtin_memcpy(current_bg_palette, next_bg->palette.data, current_bg_palette_size);
    }
    if ((fade_transition || implicit_fade) && pending_display_enable)
    {
        display_enable();
        pending_display_enable = 0u;
        delay_frame();
    }
    else if (pending_display_enable)
    {
        display_enable();
        pending_display_enable = 0u;
        delay_frame();
    }
    if (bg_fade_in_frames)
    {
        fade_palette(&next_bg->palette, (uint16_t)(next_bg->palette_bank * 16u), bg_fade_in_frames, 1u);
    }
    if (pending_sprite_refresh)
    {
        refresh_scene_sprites();
    }
}

static uint8_t VN_BANKED_CODE2 execute_control_command(const pce_vn_command_t *command)
{
    if (!command) return VN_EXEC_CONTINUE;
    if (command->type == PCE_VN_COMMAND_CHOICE)
    {
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (current_scene_full_screen_bg) return VN_EXEC_CONTINUE;
        restore_text_vram_after_full_screen_bg();
#endif
        if (command->choice_index >= 0)
        {
            start_choice((uint8_t)command->choice_index);
            return active_choice_index >= 0 ? VN_EXEC_WAIT : VN_EXEC_CONTINUE;
        }
    }
    else if (command->type == PCE_VN_COMMAND_VARIABLE)
    {
        const signed int value = command_value_arg(command);
        const signed int current = variable_value(command->asset_index);
        if (command->flags == PCE_VN_VAR_OP_ADD)
        {
            set_variable_value(command->asset_index, clamp_variable_value((int32_t)current + (int32_t)value));
        }
        else if (command->flags == PCE_VN_VAR_OP_SUB)
        {
            set_variable_value(command->asset_index, clamp_variable_value((int32_t)current - (int32_t)value));
        }
        else if (command->flags == PCE_VN_VAR_OP_RANDOM)
        {
            set_variable_value(command->asset_index, random_range_value(signed_from_u16(command->x), signed_from_u16(command->y)));
        }
        else
        {
            set_variable_value(command->asset_index, value);
        }
    }
    else if (command->type == PCE_VN_COMMAND_IF)
    {
        const signed int left = variable_value(command->asset_index);
        const signed int right = command_value_arg(command);
        const uint16_t target = compare_values(left, command->flags, right) ? command->x : command->y;
        (void)jump_to_command(target);
    }
    else if (command->type == PCE_VN_COMMAND_SWITCH)
    {
        vn_switch_ref_t *branch = VN_SWITCH_SCRATCH;
        uint8_t i;
        uint16_t target = PCE_VN_NO_COMMAND;
        const signed int value = variable_value(command->asset_index);
        if (command->choice_index >= 0 && scene_pack_read_switch(&active_scene_pack, (uint8_t)command->choice_index, branch))
        {
            for (i = 0u; i < branch->case_count; i++)
            {
                pce_vn_switch_case_t *branch_case = VN_SWITCH_CASE_SCRATCH;
                if (!scene_pack_read_switch_case(&active_scene_pack, branch, i, branch_case)) continue;
                if (branch_case->value == value)
                {
                    target = branch_case->command;
                    break;
                }
            }
            if (target == PCE_VN_NO_COMMAND) target = branch->default_command;
            (void)jump_to_command(target);
        }
    }
    else if (command->type == PCE_VN_COMMAND_GOTO)
    {
        (void)jump_to_command(command->x);
    }
    else if (command->type == PCE_VN_COMMAND_LABEL)
    {
        return VN_EXEC_CONTINUE;
    }
    else if (command->type == PCE_VN_COMMAND_INPUTCHECK)
    {
        const uint8_t mode = (uint8_t)command->flags;
        const uint8_t mask = command->arg0;
        if (mode == PCE_VN_INPUT_MODE_CANCEL)
        {
            async_input_active = 0u;
            async_input_mask = 0u;
            async_input_target = PCE_VN_NO_COMMAND;
        }
        else if (mode == PCE_VN_INPUT_MODE_ASYNC)
        {
            /* Arm the watcher and keep running the script. */
            async_input_active = 1u;
            async_input_mask = mask;
            async_input_target = command->x;
        }
        else
        {
            /* Synchronous: block here until one of the buttons is pressed. */
            sync_input_active = 1u;
            sync_input_mask = mask;
            sync_input_target = command->x;
            return VN_EXEC_WAIT;
        }
    }
    return VN_EXEC_CONTINUE;
}

static uint8_t VN_BANKED_CODE execute_command(const pce_vn_command_t *command)
{
    uint8_t slot;
    if (!command) return VN_EXEC_CONTINUE;
#if defined(__PCE_CD__)
    if (adpcm_playback_active()
        && (command->type == PCE_VN_COMMAND_BACKGROUND
            || command->type == PCE_VN_COMMAND_SPRITE
            || command->type == PCE_VN_COMMAND_CACHE
            || command->type == PCE_VN_COMMAND_MESSAGE
            || command->type == PCE_VN_COMMAND_JUMP
            || (command->type == PCE_VN_COMMAND_AUDIO && (command->flags & 0xf0u) == PCE_VN_AUDIO_ACTION_PLAY)))
    {
        stop_adpcm_voice();
    }
#endif
    if (command->type == PCE_VN_COMMAND_BACKGROUND)
    {
        set_background(command->asset_index, command->flags, command->arg0, command->arg1, command->x, command->y);
    }
    else if (command->type == PCE_VN_COMMAND_SPRITE)
    {
        slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
        VN_MAP_BANK130_FOR_CODE();
        cancel_sprite_move(slot);
        sprite_slots[slot].sprite_index = command->asset_index;
        sprite_slots[slot].animation_index = command->animation_index;
        sprite_slots[slot].visible = (uint8_t)((command->flags & PCE_VN_SPRITE_VISIBLE) && command->asset_index >= 0);
        sprite_slots[slot].flags = command->flags;
        sprite_slots[slot].frame = 0u;
        sprite_slots[slot].timer = 0u;
        cache_sprite_animation(slot);
        sprite_slots[slot].x = command->x;
        sprite_slots[slot].y = command->y;
        REQUEST_SPRITE_REFRESH_FULL();
        if (pending_sprite_refresh && !pending_display_enable) refresh_scene_sprites();
    }
    else if (command->type == PCE_VN_COMMAND_SPRITE_MOVE)
    {
        VN_MAP_BANK130_FOR_CODE();
        return start_sprite_move(command) ? VN_EXEC_WAIT : VN_EXEC_CONTINUE;
    }
    else if (command->type == PCE_VN_COMMAND_AUDIO)
    {
        VN_MAP_BANK130_FOR_CODE();
        handle_audio_command(command->flags, command->asset_index, command->arg0);
    }
    else if (command->type == PCE_VN_COMMAND_CACHE)
    {
        if (command->flags == PCE_VN_CACHE_ACTION_CLEAR)
        {
            clear_runtime_cache(command->arg0);
        }
        else if (command->flags == PCE_VN_CACHE_ACTION_LOAD)
        {
            VN_MAP_BANK130_FOR_CODE();
            begin_runtime_cache_load(command->arg0, command->asset_index, command->slot, command->x, command->y);
            wait_frames_remaining = 1u;
            return VN_EXEC_WAIT;
        }
    }
    else if (command->type == PCE_VN_COMMAND_MESSAGE)
    {
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (current_scene_full_screen_bg) return VN_EXEC_CONTINUE;
        restore_text_vram_after_full_screen_bg();
#endif
        if (command->message_index >= 0)
        {
            start_message((uint8_t)command->message_index);
            return VN_EXEC_WAIT;
        }
    }
    else if (command->type == PCE_VN_COMMAND_CHOICE
        || (command->type >= PCE_VN_COMMAND_VARIABLE && command->type <= PCE_VN_COMMAND_INPUTCHECK))
    {
        VN_MAP_BANK130_FOR_CODE();
        return execute_control_command(command);
    }
    else if (command->type == PCE_VN_COMMAND_JUMP)
    {
        if (command->scene_index >= 0)
        {
            show_scene((uint8_t)command->scene_index);
            return VN_EXEC_RESTART;
        }
    }
    else if (command->type == PCE_VN_COMMAND_WAIT)
    {
        wait_frames_remaining = (uint16_t)(((uint16_t)command->arg1 << 8) | command->arg0);
        return wait_frames_remaining ? VN_EXEC_WAIT : VN_EXEC_CONTINUE;
    }
    else if (command->type == PCE_VN_COMMAND_EFFECT)
    {
        if (command->flags == PCE_VN_EFFECT_FADE_OUT)
        {
            if (!pending_display_enable)
            {
                VN_MAP_BANK130_FOR_CODE();
                fade_current_screen_to_color(command->x, command->arg0);
            }
            if (!pending_display_enable) display_disable();
            pending_display_enable = 1u;
            VN_MAP_BANK130_FOR_CODE();
            hide_sprites_for_asset_load();
        }
        else if (command->flags == PCE_VN_EFFECT_FADE_IN)
        {
            enable_display_if_pending();
            if (current_bg_index >= 0 && current_bg_palette_size)
            {
                const pce_editor_data_ref_t ref = { current_bg_palette, current_bg_palette_size, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 };
                fade_palette(&ref, current_bg_palette_base, command->arg0, 1u);
            }
        }
        else if (command->flags == PCE_VN_EFFECT_BLANK)
        {
            if (!pending_display_enable) display_disable();
            pending_display_enable = 1u;
            VN_MAP_BANK130_FOR_CODE();
            cancel_all_sprite_moves();
            hide_sprites_for_asset_load();
#if PCE_VN_HAS_FULL_SCREEN_BG
            restore_text_vram_after_full_screen_bg();
#endif
            clear_screen_map();
            preloaded_bg_valid = 0u;
            preloaded_scene_visual_valid = 0u;
        }
        else if (command->flags == PCE_VN_EFFECT_SHAKE)
        {
            VN_MAP_BANK130_FOR_CODE();
            shake_screen(command->arg0, command->arg1);
        }
        else if (command->flags == PCE_VN_EFFECT_FLASH)
        {
            VN_MAP_BANK130_FOR_CODE();
            flash_screen_color(command->x, command->arg0);
        }
    }
#if PCE_VN_HAS_SPRITETEXT
    else if (command->type == PCE_VN_COMMAND_SPRITETEXT)
    {
        slot = command->slot < VN_SPRITETEXT_SLOT_COUNT ? command->slot : 0u;
        if (command->flags & PCE_VN_SPRITE_VISIBLE)
        {
            uint8_t count = command->arg1;
            uint8_t i;
            const uint16_t glyph_offset = (uint16_t)command->asset_index;
            if (count > VN_SPRITETEXT_MAX_GLYPHS) count = VN_SPRITETEXT_MAX_GLYPHS;
            /* scene_pack_u8 range-checks internally and returns 0 when out of
               bounds, so a truncated pack just yields blank glyphs. */
            for (i = 0u; i < count; i++)
            {
                const uint16_t byte_offset = (uint16_t)(glyph_offset + ((uint16_t)i * 2u));
                spritetext_slots[slot].glyphs[i] = (uint16_t)scene_pack_u8(&active_scene_pack, byte_offset)
                    | ((uint16_t)scene_pack_u8(&active_scene_pack, (uint16_t)(byte_offset + 1u)) << 8);
            }
            spritetext_slots[slot].glyph_count = count;
            spritetext_slots[slot].x = command->x;
            spritetext_slots[slot].y = command->y;
            spritetext_slots[slot].color = (uint16_t)command->message_index;
            spritetext_slots[slot].blink_frames = command->arg0;
            spritetext_slots[slot].blink_timer = 0u;
            spritetext_slots[slot].blink_on = 1u;
            spritetext_slots[slot].visible = 1u;
        }
        else
        {
            spritetext_slots[slot].visible = 0u;
            spritetext_slots[slot].glyph_count = 0u;
        }
        REQUEST_SPRITE_REFRESH_FULL();
    }
#endif
    return VN_EXEC_CONTINUE;
}

static uint8_t VN_BANKED_CODE run_commands_until_wait(void)
{
    uint16_t guard = VN_COMMAND_STEP_GUARD;
    uint8_t command_count;
    active_message_index = -1;
    message_complete = 1u;
    message_wait_indicator_state = 0u;
    active_choice_index = -1;
#if defined(__PCE_CD__)
    if (service_runtime_cache_load())
    {
        wait_frames_remaining = 1u;
        return 1u;
    }
#endif
    for (;;)
    {
        uint8_t restart = 0u;
        if (!load_scene_pack_into_cache(current_scene, &active_scene_pack)) return 0u;
        command_count = scene_pack_command_count(&active_scene_pack);
        while (current_command < command_count)
        {
            if (!guard)
            {
                wait_frames_remaining = 1u;
                return 1u;
            }
            guard--;
            {
                uint8_t result;
                pce_vn_command_t *command = VN_COMMAND_SCRATCH;
                VN_MAP_BANK130_FOR_CODE();
                if (!scene_pack_read_command(&active_scene_pack, current_command, command))
                {
                    current_command++;
                    continue;
                }
                current_command++;
                result = execute_command(command);
                if (result == VN_EXEC_WAIT) return 1u;
                if (result == VN_EXEC_RESTART)
                {
                    restart = 1u;
                    break;
                }
            }
        }
        if (!restart) return 0u;
    }
}

static signed int current_scene_next_scene(void)
{
    pce_vn_scene_pack_t pack;
    map_vn_data();
    if (current_scene >= pce_vn_scene_count) return -1;
    pack = pce_vn_scene_packs[current_scene];
    return pack.next_scene;
}

static void advance_story(void)
{
#if defined(__PCE_CD__)
    if (active_message_index >= 0 && adpcm_playback_active()) stop_adpcm_voice();
#endif
    if (!run_commands_until_wait())
    {
        const signed int next_scene = current_scene_next_scene();
        if (next_scene >= 0) show_scene((uint8_t)next_scene);
        else current_command = 0u;
        run_commands_until_wait();
    }
    if (pending_sprite_refresh) refresh_scene_sprites();
    enable_display_if_pending();
}

