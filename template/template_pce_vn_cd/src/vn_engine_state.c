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
/* Real audio frame credit. It is recorded from VBlank polling and explicit
   frame wait sites, and is the only credit source allowed to advance ADPCM
   bookkeeping or message timing. */
volatile uint8_t vn_vblank_credit = 0;
/* PSG-only compensation credit for blocking CD settle spans that the main
   thread cannot observe. Synthetic CD estimates must never shorten ADPCM
   playback or move message timing. */
static uint8_t vn_psg_synthetic_credit = 0;
#if defined(__PCE_CD__) && VN_PSG_TIMER_IRQ_DRIVER
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
static uint8_t cdda_active = 0;
static uint8_t cdda_has_frame_limit = 0;
static uint8_t cdda_looping = 0;
static uint8_t cdda_track = 0;
static uint16_t cdda_frames_remaining = 0;
static const pce_editor_cdda_asset_t *cdda_current = (const pce_editor_cdda_asset_t *)0;
static pce_sector_t cdda_resume_start __attribute__((section(".bss")));
static pce_sector_t cdda_resume_end __attribute__((section(".bss")));
static uint8_t cdda_resume_pending = 0;
static uint8_t cdda_resume_defer_depth = 0;
static uint8_t adpcm_play_active = 0;
static uint16_t adpcm_play_frames_remaining = 0;
static uint8_t adpcm_stream_active = 0;
static uint8_t adpcm_stream_looping = 0;
static uint8_t adpcm_stream_irq_open = 0;
static uint16_t adpcm_stream_index = 0;
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
    uint8_t stream;
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
static void VN_BANKED_CODE service_cdda_playback(void);
static void VN_VISUAL_CACHE_CODE service_cdda_playback_impl(void);
static void VN_BANKED_CODE2 service_adpcm_playback(void);
static void VN_BANKED_CODE stop_adpcm_voice(void);
static void VN_BANKED_CODE quiet_cd_unit_irqs(void);
#endif
static void VN_BANKED_CODE2 handle_audio_command(uint8_t flags, signed int asset_index, uint8_t slot);
static void VN_BANKED_CODE2 tick_psg(void);
static void VN_RESIDENT_CODE service_psg_ticks(uint8_t frames, uint8_t restore_visual_cache);
static void VN_RESIDENT_CODE service_psg_during_blocking_work(void);
static void VN_RESIDENT_CODE service_psg_during_blocking_frames(uint8_t frames);
static void VN_RESIDENT_CODE service_psg_during_visual_cache_work(void);
static void VN_RESIDENT_CODE service_psg_during_visual_cache_frames(uint8_t frames);
static void VN_RESIDENT_CODE service_psg_compensation_ticks(uint8_t frames, uint8_t restore_visual_cache);
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static uint8_t VN_VISUAL_CACHE_CODE load_psg_pattern_cd_impl(void);
static void VN_VISUAL_CACHE_CODE service_cdda_playback_impl(void);
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
