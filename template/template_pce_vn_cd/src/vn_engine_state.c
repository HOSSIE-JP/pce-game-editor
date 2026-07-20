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
/* System Card PSG package state. BGM and SFX have independent load keys and
   active flags; BIOS PSG_DRIVE owns sequencing and all PSG register writes. */
static uint8_t psg_active = 0;
static uint8_t system_psg_bus_active[2] __attribute__((section(".bss")));
static uint16_t loaded_system_psg_package_key[2] __attribute__((section(".bss")));
static uint8_t system_psg_bgm_bank[8192] __attribute__((used, retain, section(".ram_bank134")));
static uint8_t system_psg_sfx_bank[8192] __attribute__((used, retain, section(".ram_bank135")));
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
#define VN_VISUAL_CACHE_PAGE_COUNT 16u
#define VN_VISUAL_CACHE_PAGE_BYTES 8192u
#define VN_VISUAL_CACHE_FIRST_BANK 104u
#define VN_VISUAL_CACHE_PAGE_ADDR ((uint8_t *)0xc000)
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
static uint8_t vn_cd_async_code_loaded = 0;
static uint8_t vn_cd_bus_state = VN_CD_BUS_IDLE;
static uint8_t vn_cd_async_status = VN_CD_ASYNC_STATUS_IDLE;
static uint8_t vn_cd_async_dest_kind = 0;
static uint8_t vn_cd_async_dest_bank = 0;
static uint8_t vn_cd_async_saved_mpr6 = 0;
static uint8_t vn_cd_async_sector_count = 0;
static uint8_t vn_cd_async_status_byte = 0xffu;
static uint8_t vn_cd_async_message_byte = 0xffu;
static pce_sector_t vn_cd_async_sector = {0};
static uint16_t vn_cd_async_dest_addr = 0u;
static uint16_t vn_cd_async_store_remaining = 0u;
static uint16_t vn_cd_async_wire_remaining = 0u;
static uint16_t vn_rng_state;
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
    uint16_t timer;
    uint8_t anim_frame_count;
    unsigned int anim_frame_delay;
    uint8_t anim_loop;
    uint8_t anim_first_cell;
    uint8_t anim_frame_width_cells;
    uint8_t anim_frame_height_cells;
    uint8_t anim_frame_stride_cells;
    const unsigned int *anim_frame_delays;
} vn_sprite_slot_t;
static vn_sprite_slot_t sprite_slots_storage[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
#define sprite_slots sprite_slots_storage
typedef struct
{
    uint16_t target_x;
    uint16_t target_y;
    uint16_t distance_x;
    uint16_t distance_y;
    uint16_t error_x;
    uint16_t error_y;
    uint16_t total_frames;
    uint16_t remaining_frames;
    int8_t direction_x;
    int8_t direction_y;
    uint8_t active;
} vn_sprite_move_t;
static vn_sprite_move_t sprite_moves[VN_SPRITE_SLOT_COUNT] __attribute__((section(".bss")));
static uint8_t sync_sprite_move_slot = 0xffu;
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
    uint16_t glyphs[VN_SPRITETEXT_MAX_GLYPHS];
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
#if defined(__PCE_CD__)
static uint16_t spritetext_glyph_cache_ids[
    (PCE_VN_FONT_SPRITE_GLYPH_CAPACITY > 0u) ? PCE_VN_FONT_SPRITE_GLYPH_CAPACITY : 1u
] __attribute__((section(".bss")));
static uint8_t spritetext_glyph_cache_count __attribute__((section(".bss")));
#endif
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
/* The active scene is a full bank123 NOLOAD reservation.  Runtime access uses
   the fixed $C000 window plus short MPR6 save/map/restore sections; keeping an
   actual retained symbol makes the linker map and the build gate prove that
   no initialized payload accidentally occupies this streaming bank. */
static uint8_t active_scene_pack_bank[8192] __attribute__((used, retain, section(".ram_bank123")));
#define VN_ACTIVE_SCENE_PACK_DATA ((uint8_t *)(uintptr_t)0xc000u)
/* A message/choice is detached from bank123 before typewriter or ADPCM work.
   v2 uses exactly one 16-bit Shift-JIS/control word per visible entry. */
static uint8_t vn_scene_text_buffer[VN_MESSAGE_GLYPH_CACHE_COUNT * 2u] __attribute__((section(".bss")));
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
    uint16_t base;
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
/* The 12px-pitch compositor keeps only the active 68-glyph BIOS mask cache in
   bank132; it never reads glyph pixels back from VRAM. */
#define VN_COMMAND_SCRATCH ((pce_vn_command_t *)(void *)vn_command_scratch_storage)
#define VN_MESSAGE_SCRATCH ((pce_vn_message_t *)(void *)vn_message_scratch_storage)
#define VN_CHOICE_SCRATCH ((vn_choice_ref_t *)(void *)vn_choice_scratch_storage)
#define VN_CHOICE_OPTION_SCRATCH ((pce_vn_choice_option_t *)(void *)vn_choice_option_scratch_storage)
#define VN_SWITCH_SCRATCH ((vn_switch_ref_t *)(void *)vn_switch_scratch_storage)
#define VN_SWITCH_CASE_SCRATCH ((pce_vn_switch_case_t *)(void *)vn_switch_case_scratch_storage)
static void advance_story(void);
static void VN_RESIDENT_CODE clear_spritetext_slots(void);
static void VN_BANKED_CODE refresh_scene_sprites(void);
static void VN_BANKED_CODE cancel_sprite_move(uint8_t slot);
static void VN_BANKED_CODE cancel_all_sprite_moves(void);
static uint8_t VN_BANKED_CODE2 start_sprite_move(const pce_vn_command_t *command);
static uint8_t VN_BANKED_CODE2 load_scene_pack_into_cache(uint8_t scene_index, vn_scene_pack_cache_t *cache);
static uint8_t scene_pack_command_count(const vn_scene_pack_cache_t *cache);
#if defined(__PCE_CD__)
static void VN_VISUAL_CACHE_CODE cdda_command_impl(signed int asset_index);
static void VN_BANKED_CODE2 service_adpcm_playback(void);
static void VN_BANKED_CODE stop_adpcm_voice(void);
static void VN_BANKED_CODE quiet_cd_unit_irqs(void);
#endif
static void VN_BANKED_CODE2 handle_audio_command(uint8_t flags, signed int asset_index, uint8_t arg);
static uint8_t VN_BANKED_CODE2 load_psg_cache_asset(signed int asset_index);
static uint8_t VN_BANKED_CODE vn_system_card_init_psg(void);
static void VN_RESIDENT_CODE vn_system_card_irq_rearm(void);
static void VN_RESIDENT_CODE service_adpcm_during_blocking_frames(uint8_t frames, uint8_t restore_visual_cache);
/* Main-thread service consumes the IRQ epoch only for ADPCM and cooperative
   work. PSG sequencing itself runs exclusively in the VSync IRQ. */
static void VN_RESIDENT_CODE engine_service(void);
static void VN_RESIDENT_CODE engine_service_blocking(uint16_t iterations);
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_VISUAL_CACHE_CODE cdda_command_impl(signed int asset_index);
static uint8_t VN_VISUAL_CACHE_CODE draw_spritetext_slots_impl(uint8_t satb_index);
static void VN_VISUAL_CACHE_CODE clear_runtime_cache_impl(uint8_t scope);
static void VN_VISUAL_CACHE_CODE tick_sprite_animations_impl(void);
static void VN_VISUAL_CACHE_CODE fade_current_screen_to_color_impl(uint16_t target, uint8_t frames);
static void VN_VISUAL_CACHE_CODE restore_current_screen_palette_impl(void);
static void VN_VISUAL_CACHE_CODE flash_screen_color_impl(uint16_t color, uint8_t frames);
static void load_overlay_code(void);
static void VN_BANKED_CODE load_visual_cache_code(void);
static void VN_BANKED_CODE load_cd_async_code(void);
static uint8_t VN_BANKED_CODE2 vn_cd_async_begin_data_read(pce_sector_t sector, uint8_t dest_kind, uint8_t dest_bank, uint16_t dest_addr, uint16_t byte_count);
static uint8_t VN_BANKED_CODE2 vn_cd_async_begin_scene_pack_read(pce_sector_t sector, uint16_t dest_addr, uint16_t byte_count);
static void VN_BANKED_CODE2 vn_cd_async_service_frame(void);
static uint8_t VN_BANKED_CODE2 vn_cd_async_done(void);
static uint8_t VN_BANKED_CODE2 vn_cd_async_succeeded(void);
static void VN_BANKED_CODE2 vn_cd_async_cancel(void);
#endif

static inline uint8_t vn_vdc_irq_lock(void);
static inline void vn_vdc_irq_unlock(uint8_t flags);
static void VN_RESIDENT_CODE pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length);
static inline void vn_map_io_page(void);
static void VN_BANKED_CODE vn_vdc_set_copy_word(void);

/* PHASE_A_SPLIT:BEGIN forward declarations added by the Phase A module split.
   The definitions live in later-included module files; no logic change. */
static void VN_BANKED_CODE vn_wait_next_vblank_raw(void);
static void VN_BANKED_CODE vn_wait_next_vblank_idle(void);
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
