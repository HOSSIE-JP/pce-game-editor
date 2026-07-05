/* PHASE_A_SPLIT:BEGIN vn_engine_state.c — global runtime state (scene/message/
   sprite/PSG/ADPCM/CD-DA/cache variables), shared typedefs, scratch storage and
   the shared forward-declaration blocks. Moved verbatim from pce_vn_runtime.c
   (Phase A module split). PHASE_A_SPLIT:END */
static uint8_t current_scene = 0;
static uint8_t runtime_start_scene = 0;
static uint8_t current_command = 0;
static uint8_t pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
static uint8_t pending_display_enable = 0;
static uint8_t pending_scene_sprite_clear = 0;
static signed int current_bg_index;
/* Resident snapshot of the current BG palette so the palette-fade helpers don't
   re-fetch the CD-streamed descriptor. set_background refreshes it on each BG. */
static uint8_t current_bg_palette[32];
static uint8_t current_bg_palette_size;
static uint8_t current_bg_palette_base;
static uint8_t current_bg_x;
static uint8_t current_bg_y;
static uint16_t current_bg_map_base;
static uint8_t current_bg_width_tiles;
static uint8_t current_bg_height_tiles;
static uint8_t preloaded_bg_valid = 0;
static uint16_t preloaded_bg_index = 0;
static uint8_t preloaded_bg_x = 0;
static uint8_t preloaded_bg_y = 0;
static uint8_t preloaded_scene_visual_valid = 0;
static uint8_t preloaded_scene_index = 0;
static uint8_t loaded_sprite_pattern_valid[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint16_t loaded_sprite_pattern_index[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint16_t loaded_sprite_pattern_base[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint16_t loaded_sprite_pattern_units[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t loaded_sprite_palette_bank[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t full_screen_bg_text_vram_dirty = 0;
static uint8_t loaded_adpcm_valid = 0;
static uint16_t loaded_adpcm_index = 0;
static signed char screen_shake_x = 0;
static signed char screen_shake_y = 0;
static signed int active_message_index;
static signed int active_choice_index;
static uint8_t choice_selected_index = 0;
static uint16_t wait_frames_remaining = 0;
static uint8_t message_glyph_pos = 0;   /* entry index into the current message (0..glyph_count) */
static uint16_t message_glyph_byte = 0;  /* byte cursor into the variable-length glyph stream */
static uint8_t message_frame_timer = 0;
static uint8_t message_col = 0;
static uint8_t message_row = 0;
static uint8_t message_complete = 0;
static uint8_t message_auto_wait = 0;
static uint8_t message_wait_indicator_state = 0;
/* Effective per-character reveal frames for the active message (after ADPCM sync). */
static uint8_t message_text_speed = 0;
static pce_vn_message_t active_message_state __attribute__((section(".bss")));
static uint16_t ui_text_color;
static uint8_t current_scene_full_screen_bg = 0;
/* Input-check command state (single watcher). */
static uint8_t sync_input_active = 0;
static uint8_t sync_input_mask = 0;
static uint16_t sync_input_target;
static uint8_t async_input_active = 0;
static uint8_t async_input_mask = 0;
static uint16_t async_input_target;
/* PSG sequencer state. */
static uint8_t psg_active = 0;
static uint8_t psg_is_song = 0;
static uint8_t psg_base_channel = 0;
static uint8_t psg_used_mask = 0;
static uint16_t psg_step = 0;
static uint16_t psg_step_accum = 0;
static uint16_t psg_pattern_cursor = 0;
static uint8_t psg_vblank_seen = 0;
/* PHASE_C: psg_core state-driven sequencer (design doc §4). psg_advance(n)
   applies pattern entries to psg_logical[] only (no PSG MMIO); psg_commit()
   writes only the channels that changed. Must be console RAM (always
   mapped), NOT bank132_tail/134/135: psg_commit() is called while MPR6 may be
   mapped to the PSG pattern bank, so it cannot itself depend on any
   MPR6-backed storage.
   RAM BUDGET DEVIATION FROM THE DESIGN SKETCH (see final report --
   docs/pce-vn-engine-redesign.md §9 item 3 / refactor-instructions-engine-core.md
   §6 item 2, fallback (a)): the design sketch stores a *value* shadow
   (psg_shadow[6], mirroring "last written HW value") alongside psg_logical[6]
   so psg_commit() can diff old-vs-new per register. A literal 6-channel dual
   array costs 36-49 bytes even packed; console_ram measured only ~22 bytes
   free before this change, so the literal sketch does not fit.
   Implemented instead: psg_logical[6] (packed 3 bytes/channel: period_lo,
   period_hi(4b)+noise(1b), volume) + a 1-byte psg_dirty_mask, no separate
   shadow array (19 bytes total, fits the ~22-byte budget). psg_used_mask
   (existing) tracks "channel this pattern reaches"; psg_dirty_mask tracks
   "channel whose logical value differs from what was last committed to HW".
   psg_apply_step_entry (vn_psg_core.c, overlay) sets a dirty bit only when
   the incoming step actually changes psg_logical[ch] (comparing against the
   value already there, which always holds "what commit() last saw" until the
   next apply) -- so the *observable* contract is identical to a value-shadow
   diff (psg_commit() still writes only channels whose logical state changed
   since the previous commit), just computed incrementally at apply time
   instead of in bulk at commit time. psg_commit() still never reads the
   pattern bank and is callable from any context; psg_mark_hw_dirty() still
   just forces a full resync (OR the dirty mask with psg_used_mask). See
   vn_psg_core.c psg_commit()/psg_apply_step_entry() for the implementation
   and the final report for the full rationale and RAM measurements. */
typedef struct
{
    uint8_t period_lo;  /* period bits 0-7. */
    uint8_t period_hi_noise; /* bit0-3 = period bits 8-11; bit7 = noise flag. */
    uint8_t volume;     /* 0 = silent; 1..31 = level (gate on). */
} vn_psg_channel_state_t;
/* PHASE_C fix: pinned to .bss (not the llvm-mos zero page). psg_commit() takes
   &psg_logical[ch]; with MPR0 = I/O the runtime's zp is not at hardware page 0,
   so a page-0 address of a .zp array element does not reach the object. Keeping
   it in .bss (regular MPR1 RAM, always mapped) is both correct for the
   address-of and satisfies the design requirement that commit be callable while
   MPR6 is mapped to bank134/135 (zp/MPR1 RAM is unaffected by MPR6). See the
   g_psg_cache note in vn_psg_core.c for the full failure mode. */
static vn_psg_channel_state_t psg_logical[6] __attribute__((section(".bss")));
/* PHASE_C: single dirty bitmask (no separate psg_shadow_valid). A channel bit
   is set when its psg_logical[] value differs from what was last committed to
   HW (psg_apply_step_entry), OR when psg_mark_hw_dirty() forces a full resync
   after a BIOS helper (it ORs in psg_used_mask). Dropping the separate
   shadow_valid byte both saves 1 byte of the razor-thin console_ram budget
   and avoids a value-init global: psg_dirty_mask lives in .zp.bss (zeroed at
   boot) so its 0 init is correct, whereas a `= 1` shadow_valid would need
   .zp.data init that the current CD link places in bss (zeroed) -- i.e. it
   was silently starting at 0 anyway. */
static uint8_t psg_dirty_mask = 0;   /* bit set => channel needs a HW write on next commit. */
/* Single real audio frame credit (engine_time design doc §5.1/§5.2). Recorded
   by the TIMER ISR (primary, VN_TIME_SOURCE_TIMER=1) or by cooperative
   VBlank-edge polling (fallback, =0), and by time_blocked_poll() for BIOS
   block windows. It is the only credit source: there is no separate
   synthetic/PSG-only counter any more. */
volatile uint8_t vn_vblank_credit = 0;
#if defined(__PCE_CD__) && VN_TIME_SOURCE_TIMER
/* 1 while the runtime owns the HuC6280 timer (see vn_psg_timer_own). Also
   read by the IRQ1 quiet handler to preserve the $20F5 TIMER dispatch bit. */
static uint8_t vn_timer_owned = 0;
#endif
static const pce_editor_psg_asset_t *psg_current = (const pce_editor_psg_asset_t *)0;
/* Resolved pattern for the active song: either the resident .rodata array
   (small patterns) or the bank134 CD-streamed buffer (large patterns). */
static const pce_editor_psg_step_t *psg_active_pattern = (const pce_editor_psg_step_t *)0;
static uint8_t psg_pattern_banked = 0; /* 1 when psg_active_pattern lives in bank134 (MPR6). */
#if defined(__PCE_CD__)
/* Runtime buffer for streamed PSG patterns. Each generated record is 8 bytes,
   so 1024 records fit exactly in one 8KB RAM bank and 2048 records fit across
   bank134+bank135 without crossing a bank boundary. */
#define VN_PSG_PATTERN_BANK_BYTES 8192u
#define VN_PSG_PATTERN_ENTRY_BYTES 8u
#define VN_PSG_PATTERN_BANK_ENTRIES (VN_PSG_PATTERN_BANK_BYTES / VN_PSG_PATTERN_ENTRY_BYTES)
#define VN_PSG_PATTERN_BUFFER_BYTES (VN_PSG_PATTERN_BANK_BYTES * 2u)
static uint8_t psg_pattern_ram[VN_PSG_PATTERN_BANK_BYTES] __attribute__((section(".ram_bank134")));
static uint8_t psg_pattern_ram_bank135_reserved[VN_PSG_PATTERN_BANK_BYTES] __attribute__((used, retain, section(".ram_bank135")));
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
#define VN_VISUAL_CACHE_PAGE_COUNT 16u
#define VN_VISUAL_CACHE_PAGE_BYTES 8192u
#define VN_VISUAL_CACHE_FIRST_BANK 104u
#define VN_VISUAL_CACHE_PAGE_ADDR ((uint8_t *)0xc000)
#define VN_VISUAL_CACHE_COPY_CHUNK 128u
static uint8_t vn_visual_cache_copy_buffer[VN_VISUAL_CACHE_COPY_CHUNK] __attribute__((section(".bss")));
static uint8_t vn_visual_cache_valid[VN_VISUAL_CACHE_PAGE_COUNT] __attribute__((section(".bss")));
static uint8_t vn_visual_cache_kind[VN_VISUAL_CACHE_PAGE_COUNT] __attribute__((section(".bss")));
static uint16_t vn_visual_cache_asset[VN_VISUAL_CACHE_PAGE_COUNT] __attribute__((section(".bss")));
static uint8_t vn_visual_cache_part[VN_VISUAL_CACHE_PAGE_COUNT] __attribute__((section(".bss")));
static uint16_t vn_visual_cache_size[VN_VISUAL_CACHE_PAGE_COUNT] __attribute__((section(".bss")));
static uint8_t vn_visual_cache_lru[VN_VISUAL_CACHE_PAGE_COUNT] __attribute__((section(".bss")));
static uint8_t vn_visual_cache_clock = 0;
static uint8_t vn_visual_cache_code_loaded = 0;
static uint16_t vn_visual_cache_arg_dest __attribute__((section(".bss")));
static uint16_t vn_visual_cache_arg_asset __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_kind __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_scope __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_slot __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_x __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_y __attribute__((section(".bss")));
static int16_t vn_visual_cache_arg_sprite_x __attribute__((section(".bss")));
static const pce_editor_data_ref_t *vn_visual_cache_arg_ref __attribute__((section(".bss")));
#endif
#endif
static uint16_t vn_rng_state = 0xace1u;
static uint8_t vn_variable_lo[PCE_VN_VARIABLE_STORAGE_COUNT] __attribute__((section(".bss")));
static uint8_t vn_variable_hi[PCE_VN_VARIABLE_STORAGE_COUNT] __attribute__((section(".bss")));
typedef struct
{
    signed int sprite_index;
    signed int animation_index;
    uint16_t x;
    uint16_t y;
    uint8_t visible;
    uint8_t flags;
    uint8_t frame;
    uint8_t timer;
    uint8_t anim_frame_count;
    uint8_t anim_frame_delay;
    uint8_t anim_loop;
    uint8_t anim_first_cell;
    uint8_t anim_frame_width_cells;
    uint8_t anim_frame_height_cells;
    uint8_t anim_frame_stride_cells;
    const uint8_t *anim_frame_delays;
} vn_sprite_slot_t;
static vn_sprite_slot_t sprite_slots_storage[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
#define sprite_slots sprite_slots_storage
static uint8_t sprite_satb_slot_start[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_satb_slot_count[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_slot_pattern_valid[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint16_t sprite_slot_pattern_base[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_slot_palette_bank[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static pce_editor_sprite_draw_meta_t sprite_slot_draw_meta[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static const uint8_t *sprite_slot_cell_map[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sprite_satb_layout_valid = 0;

static vn_sprite_slot_t *VN_RESIDENT_CODE sprite_slot_ref(uint8_t i)
{
    if (i == 1u) return &sprite_slots[1];
    if (i == 2u) return &sprite_slots[2];
    if (i == 3u) return &sprite_slots[3];
    return &sprite_slots[0];
}

/* spritetext overlay slots: short strings drawn with hardware sprites on top of
   the BG/UI (e.g. a blinking "PRESS RUN BUTTON"). They share the 64-entry SATB
   with the character sprite slots, so keep the strings short. */
#define VN_SPRITETEXT_SLOT_COUNT 4u
#define VN_SPRITETEXT_MAX_GLYPHS 32u
#define VN_SPRITETEXT_GLYPH_NEWLINE 0xfeu
typedef struct
{
    uint8_t glyphs[VN_SPRITETEXT_MAX_GLYPHS];
    uint8_t glyph_count;
    uint16_t x;
    uint16_t y;
    uint16_t color;
    uint8_t blink_frames;
    uint8_t blink_timer;
    uint8_t blink_on;
    uint8_t visible;
} vn_spritetext_slot_t;
static vn_spritetext_slot_t spritetext_slots[VN_SPRITETEXT_SLOT_COUNT] __attribute__((section(".bss")));
#if defined(__PCE__)
static vdc_sprite_t sprite_shadow[64];
#endif
#if defined(__PCE_CD__)
/* Moved out of the scarce console_ram work RAM into the VN data bank (MPR6).
   CD->VRAM transfer helpers and the active message glyph cache map MPR6 to
   bank132 (map_vn_data) before reading or writing these buffers.
   Section ".ram_bank132_tail" (not ".ram_bank132"): overlay_insert.ld places it
   NOLOAD over the overlay's benign LMA window in bank132's tail. That window
   holds a copy of the overlay that is loaded at boot but NEVER READ (the real
   overlay runs from CD-streamed bank133), and these buffers are write-before-read,
   so they safely reuse that otherwise-wasted ~4 KB. This frees the entire
   [0xc000, VN_OVERLAY_LMA) region for the GROWING resident metadata (cd_data_refs,
   cell_maps, scene-pack directory) so large CD-streamed projects scale. */
static uint8_t cd_transfer_scratch[VN_CD_SECTOR_BYTES] __attribute__((section(".ram_bank132_tail")));
static uint8_t vn_active_scene_pack_data[PCE_VN_SCENE_PACK_CACHE_BYTES];
static uint8_t cdda_state = 0;
#if VN_CDDA_RESUME_AFTER_DATA_READ
static pce_sector_t cdda_resume_start __attribute__((section(".ram_bank132_tail")));
static uint8_t cdda_resume_defer_depth = 0;
#endif
static uint8_t adpcm_play_active = 0;
static uint16_t adpcm_play_frames_remaining = 0;
static uint8_t adpcm_play_looping = 0;
static uint16_t vdc_control_current = VN_VDC_BLANK_CONTROL;
/* EmulatorJS mednafen_pce can lose the next joypad edge after ADPCM BIOS calls.
   Re-baseline to the current pad state; do not synthesize a fresh edge from a
   button that was already held while ADPCM playback started. */
static uint8_t pad_edge_reset_pending = 0;
#endif
typedef struct
{
    const unsigned char *data;
    unsigned long data_size;
    unsigned int sample_rate;
    unsigned int adpcm_address;
    unsigned int play_frames;
    uint16_t cd_sector_count;
    unsigned int cd_byte_size;
    pce_editor_cd_sector_t cd_sector;
    uint8_t divider;
    uint8_t loop;
    uint8_t has_cd;
} vn_adpcm_voice_t;
#if defined(__PCE_CD__)
static vn_adpcm_voice_t adpcm_voice_snapshot;
#endif
typedef struct
{
    uint8_t *data;
    uint16_t size;
    uint8_t scene_index;
    uint8_t valid;
} vn_scene_pack_cache_t;
typedef struct
{
    uint16_t options_offset;
    uint8_t option_count;
    uint8_t default_index;
    signed int variable_index;
} vn_choice_ref_t;
typedef struct
{
    uint16_t cases_offset;
    uint8_t case_count;
    uint16_t default_command;
} vn_switch_ref_t;
static vn_scene_pack_cache_t active_scene_pack;
static uint8_t vn_command_scratch_storage[sizeof(pce_vn_command_t)] __attribute__((section(".bss")));
static uint8_t vn_message_scratch_storage[sizeof(pce_vn_message_t)] __attribute__((section(".bss")));
static uint8_t vn_choice_scratch_storage[sizeof(vn_choice_ref_t)] __attribute__((section(".bss")));
static uint8_t vn_choice_option_scratch_storage[sizeof(pce_vn_choice_option_t)] __attribute__((section(".bss")));
static uint8_t vn_switch_scratch_storage[sizeof(vn_switch_ref_t)] __attribute__((section(".bss")));
static uint8_t vn_switch_case_scratch_storage[sizeof(pce_vn_switch_case_t)] __attribute__((section(".bss")));
/* The 12px-pitch glyph compositor keeps no resident pixel buffer (RAM banks cannot
   hold one — see PCE_VN_FONT_MASK_VRAM_WORD): glyph masks live in VRAM and it
   read-modify-writes the strip tiles directly in VRAM, using only small stack
   scratch. See draw_message_glyph_at. */
#define VN_COMMAND_SCRATCH ((pce_vn_command_t *)(void *)vn_command_scratch_storage)
#define VN_MESSAGE_SCRATCH ((pce_vn_message_t *)(void *)vn_message_scratch_storage)
#define VN_CHOICE_SCRATCH ((vn_choice_ref_t *)(void *)vn_choice_scratch_storage)
#define VN_CHOICE_OPTION_SCRATCH ((pce_vn_choice_option_t *)(void *)vn_choice_option_scratch_storage)
#define VN_SWITCH_SCRATCH ((vn_switch_ref_t *)(void *)vn_switch_scratch_storage)
#define VN_SWITCH_CASE_SCRATCH ((pce_vn_switch_case_t *)(void *)vn_switch_case_scratch_storage)
static void advance_story(void);
static void VN_RESIDENT_CODE clear_spritetext_slots(void);
static void VN_BANKED_CODE refresh_scene_sprites(void);
static uint8_t VN_BANKED_CODE2 load_scene_pack_into_cache(uint8_t scene_index, vn_scene_pack_cache_t *cache);
static uint8_t scene_pack_command_count(const vn_scene_pack_cache_t *cache);
#if defined(__PCE_CD__)
static void VN_VISUAL_CACHE_CODE cdda_command_impl(signed int asset_index);
static void VN_BANKED_CODE2 service_adpcm_playback(void);
static void VN_BANKED_CODE stop_adpcm_voice(void);
static void VN_BANKED_CODE quiet_cd_unit_irqs(void);
#endif
static void VN_BANKED_CODE2 handle_audio_command(uint8_t flags, signed int asset_index, uint8_t slot);
/* PHASE_C: psg_core state-driven sequencer (design doc §4). psg_advance(n)
   reads the pattern (bank134/135 via the overlay, or resident .rodata) and
   updates psg_logical[] only -- no PSG MMIO, so it is safe to call from any
   blocking context (it also maintains psg_dirty_mask, the RAM-budget
   substitute for a value shadow -- see the note above psg_logical).
   psg_commit() writes only the channels marked dirty; it never touches the
   pattern bank, so it is safe to call with MPR6 mapped to anything.
   psg_mark_hw_dirty() ORs psg_used_mask into psg_dirty_mask so the next
   commit() re-writes every active channel (called by engine_bus after every
   BIOS helper closes, which may have clobbered the PSG SELECT latch). */
static void VN_BANKED_CODE2 psg_advance(uint8_t n);
static void VN_RESIDENT_CODE psg_commit(void);
static void VN_RESIDENT_CODE psg_mark_hw_dirty(void);
static void VN_RESIDENT_CODE service_adpcm_during_blocking_frames(uint8_t frames, uint8_t restore_visual_cache);
/* engine_time (design doc §5.2): the two service entry points that replaced
   the old 5-variant/6-function service topology
   (service_psg_ticks/_compensation_ticks/_during_blocking_work/_during_
   blocking_frames/_during_visual_cache_work/_during_visual_cache_frames).
   engine_service() is the normal per-frame heartbeat; engine_service_blocking()
   is called from inside blocking CD/ADPCM/BG work and folds a measured
   VBlank-edge span (time_blocked_poll) into the same real credit counter. */
static void VN_RESIDENT_CODE engine_service(void);
static void VN_RESIDENT_CODE engine_service_blocking(uint16_t iterations);
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static uint8_t VN_VISUAL_CACHE_CODE load_psg_pattern_cd_impl(void);
static void VN_VISUAL_CACHE_CODE cdda_command_impl(signed int asset_index);
static uint8_t VN_VISUAL_CACHE_CODE draw_spritetext_slots_impl(uint8_t satb_index);
static void VN_VISUAL_CACHE_CODE clear_runtime_cache_impl(uint8_t scope);
static void VN_VISUAL_CACHE_CODE tick_sprite_animations_impl(void);
static void VN_VISUAL_CACHE_CODE fade_current_screen_to_color_impl(uint16_t target, uint8_t frames);
static void VN_VISUAL_CACHE_CODE restore_current_screen_palette_impl(void);
static void VN_VISUAL_CACHE_CODE flash_screen_color_impl(uint16_t color, uint8_t frames);
static void load_overlay_code(void);
static void VN_BANKED_CODE load_visual_cache_code(void);
#endif

static inline uint8_t vn_vdc_irq_lock(void);
static inline void vn_vdc_irq_unlock(uint8_t flags);
static inline void vn_map_io_page(void);
static void VN_BANKED_CODE vn_vdc_set_copy_word(void);

/* PHASE_A_SPLIT:BEGIN forward declarations added by the Phase A module split.
   The definitions live in later-included module files; no logic change. */
static void VN_BANKED_CODE vn_wait_next_vblank(void);
static void VN_BANKED_CODE delay_frame(void);
static inline uint8_t vn_slot4_current_bank(void);
static inline void vn_slot4_map_bank(uint8_t bank);
static void map_vn_data(void);
static void set_vdc_control(uint16_t control);
static void VN_BANKED_CODE restore_video_after_cdb_call(uint8_t restore_display);
#if defined(__PCE_CD__)
static void VN_BANKED_CODE vram_copy_sliced_from_vn_data(uint16_t dest, const uint8_t *source, uint16_t length);
#endif
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static uint8_t VN_RESIDENT_CODE visual_cache_call(uint8_t op);
#endif
/* PHASE_A_SPLIT:END */
