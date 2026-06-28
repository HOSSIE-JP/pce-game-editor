#include <stdint.h>

#if defined(__PCE_CD__)
#define PCE_CONFIG_IMPLEMENTATION
#define VN_ENABLE_VISUAL_PAYLOAD_CACHE 0
#endif
#if defined(__PCE__)
#include <pce.h>
#endif
#if defined(__PCE_CD__)
#include <pce-cd.h>
PCE_RAM_BANK_AT(128, 2);
PCE_RAM_BANK_AT(129, 3);
PCE_RAM_BANK_AT(130, 4);
/* bank133 = transition/upload overlay, time-shared with bank130 in MPR slot 4
   (0x8000). Its code is NOT in the boot image (the IPL only loads banks 128-132);
   load_overlay_code() streams it from CD into bank133 RAM at boot. bank133 is
   never used by the System Card (unlike bank131/MPR5), so it is safe for code. */
PCE_RAM_BANK_AT(133, 4);
/* bank134/135 = active PSG song pattern buffer, time-shared with bank132 in MPR
   slot 6 (0xc000). Large PSG/VGM/MIDI song patterns do not sit in the resident
   banks; load_psg_pattern_cd() streams the currently-playing song's pattern from
   CD into these RAM banks at play time. Like bank133 they are outside the IPL
   auto-load range and never used by the System Card, so they are safe scratch
   banks. */
PCE_RAM_BANK_AT(134, 6);
PCE_RAM_BANK_AT(135, 6);
/* Visual payload cache helper code is streamed into bank121 after System Card
   boot. Payload pages are raw-mapped into slot 6 at runtime, so they do not need
   linker sections and are never part of the IPL-loaded program image. */
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
PCE_RAM_BANK_AT(121, 4);
#endif
PCE_CDB_USE_GRAPHICS_DRIVER(0);
#endif

#include "generated/assets.h"
#include "generated/vn.h"

#define PAD_I 0x01u
#define PAD_II 0x02u
#define PAD_SEL 0x04u
#define PAD_RUN 0x08u
#define PAD_UP 0x10u
#define PAD_RIGHT 0x20u
#define PAD_DOWN 0x40u
#define PAD_LEFT 0x80u

/* PSG MMIO registers (hardware addresses). */
#define PCE_PSG_SELECT (*(volatile uint8_t *)0x0800)
#define PCE_PSG_GLOBAL (*(volatile uint8_t *)0x0801)
#define PCE_PSG_FREQ_LO (*(volatile uint8_t *)0x0802)
#define PCE_PSG_FREQ_HI (*(volatile uint8_t *)0x0803)
#define PCE_PSG_CONTROL (*(volatile uint8_t *)0x0804)
#define PCE_PSG_BALANCE (*(volatile uint8_t *)0x0805)
#define PCE_PSG_WAVE (*(volatile uint8_t *)0x0806)
#define PCE_PSG_NOISE (*(volatile uint8_t *)0x0807)

#define PCE_VCE_ADDR_LO (*(volatile uint8_t *)0x0402)
#define PCE_VCE_ADDR_HI (*(volatile uint8_t *)0x0403)
#define PCE_VCE_DATA_LO (*(volatile uint8_t *)0x0404)
#define PCE_VCE_DATA_HI (*(volatile uint8_t *)0x0405)

#define VN_MAP_WIDTH 32u
#define VN_MAP_HEIGHT 32u
#define VN_BG_SCROLL_WIDTH 512u
#define VN_BG_SCROLL_HEIGHT 256u
#define VN_MAP_ROW_BYTES (VN_MAP_WIDTH * 2u)
#define VN_ADPCM_BASE_SAMPLE_RATE 32000u
#define VN_ADPCM_LEGACY_BASE_SAMPLE_RATE 32000u
#define VN_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE 16000u
#define VN_ADPCM_MAX_RATE_CODE 15u
#define VN_SATB_ADDR 0x7f00u
#define VN_SPRITE_PATTERN_END_BASE (VN_SATB_ADDR / 32u)
#ifndef PCE_VN_SPRITE_PATTERN_BASE
#define PCE_VN_SPRITE_PATTERN_BASE 704u
#endif
#define VN_SPRITE_HIDDEN_Y 0x00f0u
/* 256x224 layout: BG 224x136 (top, centered), message window 208x64 (bottom,
   centered). Window = 26x8 tiles at BAT (3,20). Glyphs are 12x12 composited at
   a 12px horizontal pitch (17 chars) and a 16px vertical pitch (4 rows), so the
   message text no longer aligns to the 8x8 tile grid: see the glyph compositor. */
#define VN_WINDOW_X 3u
#define VN_WINDOW_Y 20u
#define VN_WINDOW_W 26u
#define VN_WINDOW_H 8u
#define VN_TEXT_X 3u
#define VN_TEXT_Y 20u
#define VN_TEXT_COLS 17u
#define VN_TEXT_ROWS 4u
#define VN_WAIT_CURSOR_COL (VN_TEXT_COLS - 1u)
#define VN_WAIT_CURSOR_ROW (VN_TEXT_ROWS - 1u)
#define VN_WAIT_CURSOR_BLINK_FRAMES 30u
#define VN_GLYPH_W 12u
#define VN_GLYPH_H 12u
/* Vertical pad to center a 12px glyph inside the 16px (2-tile) line band. */
#define VN_GLYPH_Y_OFFSET 2u
#define VN_MSG_TILE_COLS 26u
#define VN_MSG_TILE_ROWS 8u
#define VN_MSG_TILE_COUNT (VN_MSG_TILE_COLS * VN_MSG_TILE_ROWS)
/* The 208-tile message strip the compositor owns starts at the (generated)
   font tile base. The BAT window cells normally point at this strip; during
   message-page clear/initial full-page updates they temporarily point at the
   dedicated blank tile so the visible screen is not globally blanked. */
#define VN_MSG_STRIP_TILE_BASE PCE_VN_FONT_TILE_BASE
/* One dedicated, always-zero tile for the BG/UI blank fill (the old blank tile
   aliased the font base, which is now dynamic strip data). */
#define PCE_VN_BLANK_TILE (PCE_VN_FONT_TILE_BASE + VN_MSG_TILE_COUNT)
/* 12x12 glyph masks live in VRAM (12 words/glyph) right after the blank tile.
   CD builds preload the active message's masks into a bounded RAM cache before
   starting ADPCM, so voiced typewriter frames do not pay a VRAM read per glyph.
   A full resident mask table still does not fit: bank128 is full, MPR5 corrupts
   the System Card BIOS, and a table in bank132 grows the loaded image and breaks
   the CD data sector layout. */
#define PCE_VN_FONT_MASK_VRAM_WORD (((uint16_t)PCE_VN_BLANK_TILE + 1u) * 16u)
#define VN_GLYPH_MASK_WORDS 12u
#define VN_MESSAGE_GLYPH_CACHE_COUNT 68u
#define VN_UI_PALETTE 15u
#define VN_UI_BLANK_TILE PCE_VN_BLANK_TILE
#define VN_CD_SECTOR_BYTES 2048u
/* VBlank is polled from IO_VDC_STATUS. The VDC VBlank bit must remain enabled
   so the status latch fires; the HuC6280 IRQ_VDC line is masked separately so
   the System Card VBlank handler cannot rewrite CR/BXR/BYR during VN frames. */
#define VN_VDC_CONTROL_BASE (VDC_CONTROL_IRQ_VBLANK | VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_VRAM_ADD_1)
#define VN_VDC_DISPLAY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE)
#define VN_VDC_BG_ONLY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG)
#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE
#define VN_VDC_MEMORY_CONTROL (VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_32_32)
#define VN_CDB_VDC_CONTROL_SHADOW_LO ((volatile uint8_t *)0x20f3)
#define VN_CDB_VDC_CONTROL_SHADOW_HI ((volatile uint8_t *)0x20f4)
#define VN_SPRITE_SLOT_COUNT 4u
#define VN_EXEC_CONTINUE 0u
#define VN_EXEC_WAIT 1u
#define VN_EXEC_RESTART 2u
#define VN_COMMAND_STEP_GUARD 1024u
#define VN_ADPCM_FRAME_RATE 60ul
#define VN_ADPCM_END_PAD_FRAMES 2ul
#define VN_BG_IMPLICIT_FADE_FRAMES 6u
#define VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES 20u
#define VN_VISUAL_VRAM_COPY_SLICE_BYTES 64u
#define VN_BG_UPLOAD_DISPLAY_DISABLE() display_disable()
#define VN_SPRITE_REFRESH_NONE 0u
#define VN_SPRITE_REFRESH_PATTERNS 1u
#define VN_SPRITE_REFRESH_FULL 2u
#define VN_VISUAL_CACHE_KIND_NONE 0u
#define VN_VISUAL_CACHE_KIND_BG_TILES 1u
#define VN_VISUAL_CACHE_KIND_BG_MAP 2u
#define VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS 3u
#define VN_VISUAL_CACHE_OP_REF_TO_VRAM 1u
#define VN_VISUAL_CACHE_OP_BG_MAP_TO_VRAM 2u
#define VN_VISUAL_CACHE_OP_PRELOAD_REF 3u
#define VN_VISUAL_CACHE_OP_INVALIDATE 4u
#define VN_VISUAL_CACHE_OP_VRAM_COPY 5u
#define VN_VISUAL_CACHE_OP_LOAD_BG 6u
#define VN_VISUAL_CACHE_OP_LOAD_SPRITE 7u
#define REQUEST_SPRITE_REFRESH_FULL() (pending_sprite_refresh = VN_SPRITE_REFRESH_FULL)
#define REQUEST_SPRITE_REFRESH_PATTERNS() do { \
    if (pending_sprite_refresh != VN_SPRITE_REFRESH_FULL) pending_sprite_refresh = VN_SPRITE_REFRESH_PATTERNS; \
} while (0)
#define VN_MESSAGE_MOUTH_SLOT(info) ((uint8_t)((info) & 0x03u))
#define VN_MESSAGE_INSTANT_GLYPH_COUNT(info) ((uint8_t)((info) >> 2u))
#define VN_SCENE_PACK_MAGIC_P 0x50u
#define VN_SCENE_PACK_MAGIC_V 0x56u
#define VN_SCENE_PACK_MAGIC_N 0x4eu
#define VN_SCENE_PACK_MAGIC_S 0x53u
#define VN_SCENE_PACK_OFFSET_VERSION 4u
#define VN_SCENE_PACK_OFFSET_COMMAND_COUNT 5u
#define VN_SCENE_PACK_OFFSET_MESSAGE_COUNT 6u
#define VN_SCENE_PACK_OFFSET_CHOICE_COUNT 7u
#define VN_SCENE_PACK_OFFSET_SWITCH_COUNT 8u
#define VN_SCENE_PACK_OFFSET_FLAGS 9u
#define VN_SCENE_PACK_OFFSET_COMMAND_TABLE 10u
#define VN_SCENE_PACK_OFFSET_MESSAGE_TABLE 12u
#define VN_SCENE_PACK_OFFSET_CHOICE_TABLE 14u
#define VN_SCENE_PACK_OFFSET_SWITCH_TABLE 16u
#if defined(__PCE_CD__)
#define VN_BANKED_CODE __attribute__((noinline, section(".ram_bank129")))
#define VN_BANKED_CODE_INLINE __attribute__((always_inline, section(".ram_bank129")))
#define VN_BANKED_CODE2 __attribute__((noinline, section(".ram_bank130")))
#define VN_BANKED_CODE2_INLINE __attribute__((always_inline, section(".ram_bank130")))
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
#define VN_VISUAL_CACHE_ENTRY_CODE __attribute__((used, retain, noinline, section(".vn_visual_code.entry")))
#define VN_VISUAL_CACHE_CODE __attribute__((used, retain, noinline, section(".vn_visual_code.impl")))
#else
#define VN_VISUAL_CACHE_ENTRY_CODE
#define VN_VISUAL_CACHE_CODE
#endif
#define VN_RESIDENT_CODE __attribute__((noinline, section(".text")))
/* Overlay code (Path B Phase B1). Linked in the SAME compilation as the rest of
   the runtime (so zp imaginary registers and resident symbols resolve), but
   placed in section .vn_overlay which the linker fragment (overlay_insert.ld)
   locates at CPU 0x8000 (MPR slot 4) with a benign LMA inside the loaded image.
   The bytes are objcopy'd out of main.elf into overlay.bin and streamed into
   physical bank133 at boot (load_overlay_code); bank133 time-shares slot 4 with
   bank130. Functions tagged VN_OVERLAY_CODE run with bank133 mapped into slot 4,
   so while they execute bank130 is NOT visible: they must call ONLY resident
   slot2/slot3 code (bank128/bank129), inlined helpers, console_ram, or the CD
   BIOS -- never another bank130 function. Callers wrap them with the
   call_overlay_* dispatchers (resident bank128) which map bank133, call, then
   restore bank130. */
#define VN_OVERLAY_CODE __attribute__((noinline, section(".vn_overlay")))
#define VN_MAP_BANK130_FOR_CODE() pce_ram_bank130_map()
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
#define VN_MAP_VISUAL_CACHE_CODE() pce_ram_bank121_map()
#else
#define VN_MAP_VISUAL_CACHE_CODE() ((void)0)
#endif
#else
#define VN_BANKED_CODE
#define VN_BANKED_CODE_INLINE
#define VN_BANKED_CODE2
#define VN_BANKED_CODE2_INLINE
#define VN_VISUAL_CACHE_ENTRY_CODE
#define VN_VISUAL_CACHE_CODE
#define VN_RESIDENT_CODE
#define VN_OVERLAY_CODE
#define VN_MAP_BANK130_FOR_CODE() ((void)0)
#define VN_MAP_VISUAL_CACHE_CODE() ((void)0)
#endif

#ifndef PCE_EDITOR_CD_COMPRESSION_NONE
#define PCE_EDITOR_CD_COMPRESSION_NONE 0u
#endif
#ifndef PCE_EDITOR_CD_COMPRESSION_RLE
#define PCE_EDITOR_CD_COMPRESSION_RLE 1u
#endif

static uint8_t current_scene = 0;
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
static uint8_t psg_frame = 0;
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
#define VN_VISUAL_CACHE_PAGE_COUNT 8u
#define VN_VISUAL_CACHE_PAGE_BYTES 8192u
#define VN_VISUAL_CACHE_FIRST_BANK 120u
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
static uint16_t vn_visual_cache_arg_dest __attribute__((section(".bss")));
static uint16_t vn_visual_cache_arg_asset __attribute__((section(".bss")));
static uint16_t vn_visual_cache_arg_length __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_kind __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_scope __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_slot __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_x __attribute__((section(".bss")));
static uint8_t vn_visual_cache_arg_y __attribute__((section(".bss")));
static const uint8_t *vn_visual_cache_arg_source __attribute__((section(".bss")));
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
static uint16_t adpcm_stream_index = 0;
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
    uint16_t cd_sector_count;
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
static void clear_spritetext_slots(void);
static void VN_BANKED_CODE refresh_scene_sprites(void);
static uint8_t VN_BANKED_CODE2 load_scene_pack_into_cache(uint8_t scene_index, vn_scene_pack_cache_t *cache);
static uint8_t VN_BANKED_CODE2 scene_pack_command_count(const vn_scene_pack_cache_t *cache);
#if defined(__PCE_CD__)
static void service_cdda_playback(void);
static void VN_BANKED_CODE2 service_adpcm_playback(void);
#endif
static void VN_BANKED_CODE2 tick_psg(void);
static void VN_RESIDENT_CODE service_psg_during_blocking_work(void);
static void VN_RESIDENT_CODE service_psg_during_blocking_frames(uint8_t frames);
static void VN_RESIDENT_CODE service_psg_during_visual_cache_work(void);
static void VN_RESIDENT_CODE service_psg_during_visual_cache_frames(uint8_t frames);
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_VISUAL_CACHE_CODE load_bg_cache_asset_impl(signed int bg_index, uint8_t tile_x, uint8_t tile_y);
static void VN_VISUAL_CACHE_CODE load_sprite_pattern_cache_asset_impl(signed int sprite_index, uint8_t slot_index);
static void load_overlay_code(void);
static void load_visual_cache_code(void);
#endif

static void map_vn_data(void)
{
#if defined(__PCE_CD__)
    pce_vn_font_tiles_map();
#endif
}

static void map_resident_data(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank128_map();
#endif
}

static void init_runtime_state(void)
{
    uint8_t i;
    current_scene = 0u;
    current_command = 0u;
    pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
    pending_display_enable = 0u;
    pending_scene_sprite_clear = 0u;
    current_bg_index = -1;
    current_bg_x = 0u;
    current_bg_y = 0u;
    preloaded_bg_valid = 0u;
    preloaded_bg_index = 0u;
    preloaded_bg_x = 0u;
    preloaded_bg_y = 0u;
    preloaded_scene_visual_valid = 0u;
    preloaded_scene_index = 0u;
    full_screen_bg_text_vram_dirty = 0u;
    loaded_adpcm_valid = 0u;
    loaded_adpcm_index = 0u;
#if defined(__PCE_CD__)
    cdda_active = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
    cdda_resume_pending = 0u;
    cdda_resume_defer_depth = 0u;
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    adpcm_stream_index = 0u;
    pad_edge_reset_pending = 0u;
    active_scene_pack.data = vn_active_scene_pack_data;
    active_scene_pack.size = 0u;
    active_scene_pack.scene_index = 0xffu;
    active_scene_pack.valid = 0u;
#else
    active_scene_pack.data = (uint8_t *)0;
    active_scene_pack.size = 0u;
    active_scene_pack.scene_index = 0xffu;
    active_scene_pack.valid = 0u;
#endif
    screen_shake_x = 0;
    screen_shake_y = 0;
    active_message_index = -1;
    active_choice_index = -1;
    choice_selected_index = 0u;
    wait_frames_remaining = 0u;
    message_glyph_pos = 0u;
    message_glyph_byte = 0u;
    message_frame_timer = 0u;
    message_col = 0u;
    message_row = 0u;
    message_complete = 1u;
    message_auto_wait = 0u;
    ui_text_color = PCE_VN_MESSAGE_COLOR_NONE;
    sync_input_active = 0u;
    sync_input_mask = 0u;
    sync_input_target = PCE_VN_NO_COMMAND;
    async_input_active = 0u;
    async_input_mask = 0u;
    async_input_target = PCE_VN_NO_COMMAND;
    current_scene_full_screen_bg = 0u;
    sprite_satb_layout_valid = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        loaded_sprite_pattern_valid[i] = 0u;
        loaded_sprite_pattern_index[i] = 0u;
        loaded_sprite_pattern_base[i] = 0u;
        loaded_sprite_pattern_units[i] = 0u;
        loaded_sprite_palette_bank[i] = 0u;
        sprite_satb_slot_start[i] = 0u;
        sprite_satb_slot_count[i] = 0u;
        sprite_slot_pattern_valid[i] = 0u;
        sprite_slot_pattern_base[i] = 0u;
        sprite_slot_palette_bank[i] = 0u;
    }
#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
    vn_visual_cache_clock = 0u;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        vn_visual_cache_valid[i] = 0u;
        vn_visual_cache_kind[i] = VN_VISUAL_CACHE_KIND_NONE;
        vn_visual_cache_asset[i] = 0u;
        vn_visual_cache_part[i] = 0u;
        vn_visual_cache_size[i] = 0u;
        vn_visual_cache_lru[i] = 0u;
    }
#endif
    map_vn_data();
    for (i = 0u; i < pce_vn_variable_count && i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        const uint16_t value = (uint16_t)(int16_t)pce_vn_variable_initial_values[i];
        vn_variable_lo[i] = (uint8_t)(value & 0xffu);
        vn_variable_hi[i] = (uint8_t)(value >> 8);
    }
    for (; i < PCE_VN_VARIABLE_STORAGE_COUNT; i++)
    {
        vn_variable_lo[i] = 0u;
        vn_variable_hi[i] = 0u;
    }
    clear_spritetext_slots();
}

static void VN_BANKED_CODE vn_wait_next_vblank(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    __asm__ volatile(
        "ldy #$80\n"
        "vn_wait_vblank_end_outer%=:\n"
        "ldx #$ff\n"
        "vn_wait_vblank_end_inner%=:\n"
        "lda $0000\n"
        "and #$20\n"
        "beq vn_wait_vblank_start%=\n"
        "dex\n"
        "bne vn_wait_vblank_end_inner%=\n"
        "dey\n"
        "bne vn_wait_vblank_end_outer%=\n"
        "vn_wait_vblank_start%=:\n"
        "ldy #$80\n"
        "vn_wait_vblank_start_outer%=:\n"
        "ldx #$ff\n"
        "vn_wait_vblank_start_inner%=:\n"
        "lda $0000\n"
        "and #$20\n"
        "bne vn_wait_vblank_done%=\n"
        "dex\n"
        "bne vn_wait_vblank_start_inner%=\n"
        "dey\n"
        "bne vn_wait_vblank_start_outer%=\n"
        "vn_wait_vblank_done%=:\n"
        :
        :
        : "a", "x", "y", "memory");
#endif
}

static void delay_frame(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank130_map();
    service_adpcm_playback();
    vn_wait_next_vblank();
    service_cdda_playback();
#else
    volatile uint16_t delay;
    for (delay = 0; delay < 6200u; delay++) {}
#endif
}

static inline uint8_t vn_vdc_irq_lock(void);
static inline void vn_vdc_irq_unlock(uint8_t flags);
static void VN_BANKED_CODE vn_vdc_set_copy_word(void);

static void set_vdc_control(uint16_t control)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
#endif
#if defined(__PCE_CD__)
    *VN_CDB_VDC_CONTROL_SHADOW_LO = (uint8_t)(control & 0xffu);
    *VN_CDB_VDC_CONTROL_SHADOW_HI = (uint8_t)(control >> 8);
#endif
#if defined(__PCE__) || defined(__PCE_CD__)
    pce_vdc_poke(VDC_REG_CONTROL, control);
    vn_vdc_irq_unlock(irq);
#else
    (void)control;
#endif
}

static void VN_BANKED_CODE2 display_disable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_BLANK_CONTROL);
#elif defined(__PCE__)
    pce_vdc_disable((uint8_t)(VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE));
#endif
}

static void VN_BANKED_CODE2 display_enable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
#endif
}

static void VN_BANKED_CODE2 sprite_layer_disable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_BG_ONLY_CONTROL);
#elif defined(__PCE__)
    set_vdc_control(VN_VDC_BG_ONLY_CONTROL);
#endif
}

static void VN_BANKED_CODE2 sprite_layer_enable(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    vn_wait_next_vblank();
#endif
#if defined(__PCE_CD__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#elif defined(__PCE__)
    set_vdc_control(VN_VDC_DISPLAY_CONTROL);
#endif
}

static uint16_t scroll_value_from_offset(signed char offset, uint16_t modulo)
{
    if (!offset) return 0u;
    if (offset > 0) return (uint16_t)(modulo - (uint8_t)offset);
    return (uint16_t)(-offset);
}

static void apply_screen_offset(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_vdc_poke(VDC_REG_BG_SCROLL_X, scroll_value_from_offset(screen_shake_x, VN_BG_SCROLL_WIDTH));
    pce_vdc_poke(VDC_REG_BG_SCROLL_Y, scroll_value_from_offset(screen_shake_y, VN_BG_SCROLL_HEIGHT));
    vn_vdc_irq_unlock(irq);
#endif
}

static void set_screen_offset(signed char x, signed char y)
{
    screen_shake_x = x;
    screen_shake_y = y;
    apply_screen_offset();
    REQUEST_SPRITE_REFRESH_FULL();
}

static void VN_BANKED_CODE restore_video_after_cdb_call(uint8_t restore_display)
{
#if defined(__PCE_CD__)
    uint8_t irq;
    vn_wait_next_vblank();
    irq = vn_vdc_irq_lock();
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    apply_screen_offset();
    set_vdc_control(restore_display ? VN_VDC_DISPLAY_CONTROL : VN_VDC_BLANK_CONTROL);
    pce_irq_disable(IRQ_VDC);
    vn_vdc_irq_unlock(irq);
#else
    (void)restore_display;
#endif
}

static void enable_display_if_pending(void)
{
    if (!pending_display_enable) return;
    display_enable();
    pending_display_enable = 0;
    delay_frame();
}

static uint8_t read_pad_raw(void)
{
#if defined(__PCE__)
    return pce_joypad_read();
#else
    return 0;
#endif
}

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

static void VN_BANKED_CODE2 set_variable_value(signed int variable_index, signed int value)
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
    current_command = (uint8_t)command_offset;
    return 1u;
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
    __asm__ volatile("php\n\tpla\n\tsei" : "=a"(flags));
    return flags;
}
static inline void vn_vdc_irq_unlock(uint8_t flags)
{
    __asm__ volatile("pha\n\tplp" : : "a"(flags));
}
#else
static inline uint8_t vn_vdc_irq_lock(void) { return 0u; }
static inline void vn_vdc_irq_unlock(uint8_t flags) { (void)flags; }
#endif

static void VN_BANKED_CODE vn_vdc_set_copy_word(void)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    /* Preserve CR low byte (display/BG/sprite/VBlank-status bits) and restore
       CR high byte: DRAM refresh on, VRAM increment = 1 word. */
    __asm__ volatile("st0 #$05\n\tst2 #$04" ::: "memory");
#endif
}

static void VN_RESIDENT_CODE pce_editor_vram_copy(uint16_t dest, const uint8_t *source, uint16_t length)
{
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    vn_vdc_set_copy_word();
    pce_vdc_copy_to_vram(dest, source, length);
    vn_vdc_irq_unlock(irq);
#elif defined(__PCE__)
    uint8_t irq = vn_vdc_irq_lock();
    vn_vdc_set_copy_word();
    pce_vdc_copy_to_vram(dest, source, length);
    vn_vdc_irq_unlock(irq);
#else
    (void)dest;
    (void)source;
    (void)length;
#endif
}

static void vce_write_color(uint16_t index, uint16_t color)
{
    PCE_VCE_ADDR_LO = (uint8_t)(index & 0xffu);
    PCE_VCE_ADDR_HI = (uint8_t)((index >> 8) & 0xffu);
    PCE_VCE_DATA_LO = (uint8_t)(color & 0xffu);
    PCE_VCE_DATA_HI = (uint8_t)((color >> 8) & 0xffu);
}

static const uint8_t *data_ref_ptr(const pce_editor_data_ref_t *ref)
{
    if (!ref) return 0;
    if (ref->chunk_count && ref->chunks)
    {
        pce_editor_map_asset_bank(ref->chunks[0].bank);
        return ref->chunks[0].data;
    }
    return ref->data;
}

#define SNAPSHOT_DATA_REF(dest, source) do { \
    (dest).data = (source).data; \
    __asm__ volatile("" ::: "memory"); \
    (dest).size = (source).size; \
    __asm__ volatile("" ::: "memory"); \
    (dest).chunks = (source).chunks; \
    __asm__ volatile("" ::: "memory"); \
    (dest).chunk_count = (source).chunk_count; \
    __asm__ volatile("" ::: "memory"); \
    (dest).cd = (source).cd; \
    __asm__ volatile("" ::: "memory"); \
} while (0)

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

static void cd_transfer_wait(void)
{
    volatile uint16_t wait;
    /* A resident PSG pattern (small SFX / short song in .rodata) never remaps MPR6
       during its sequencer tick, so its compensation ticks can be spread across the
       CD settle wait. This advances the sequencer smoothly in real time instead of
       firing all VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES ticks in one instant burst
       after the wait, which previously fast-forwarded a short one-shot SFX to its
       end (silencing it) whenever a sprite/BG load ran during playback. Total settle
       time and tick count are unchanged. */
    if (psg_active && !psg_pattern_banked)
    {
        uint8_t slice;
        for (slice = 0u; slice < VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES; slice++)
        {
            for (wait = 0u; wait < (65535u / VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES); wait++) {}
            service_psg_during_blocking_work();
        }
        return;
    }
    /* No PSG playing, or a CD-streamed pattern (bank134/135): keep the original
       settle wait + single post-wait compensation burst, so the per-tick bank remap
       of a streamed pattern can never race the CD DMA targeting bank132. */
    for (wait = 0u; wait < 65535u; wait++) {}
    service_psg_during_blocking_frames(VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES);
}

static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call(void);
static void VN_BANKED_CODE2 begin_cdda_deferred_resume(void);
static void VN_BANKED_CODE2 end_cdda_deferred_resume(void);
static void VN_BANKED_CODE prepare_cd_data_access(void);
static void VN_BANKED_CODE resume_cdda_after_cd_data_access(void);
static void VN_BANKED_CODE finish_cd_data_read_before_vram_copy(void);
static void VN_BANKED_CODE cancel_cdda_after_cd_data_conflict(void);


static void VN_BANKED_CODE sync_cd_external_irq_after_bios_call(void)
{
#if defined(__PCE_CD__)
    if (!adpcm_stream_active)
    {
        pce_cdb_irq_disable(PCE_CDB_MASK_IRQ_EXTERNAL);
    }
#endif
}

static void VN_BANKED_CODE cdda_sector_from_remaining(const pce_editor_cdda_asset_t *cdda)
{
    unsigned long start = 0ul;
    unsigned long elapsed_frames = 0ul;
    unsigned long sector_offset = 0ul;
    unsigned long value;
    if (cdda)
    {
        start = (unsigned long)cdda->start_sector.lo
            | ((unsigned long)cdda->start_sector.md << 8)
            | ((unsigned long)cdda->start_sector.hi << 16);
        if (cdda->play_frames && cdda_frames_remaining < cdda->play_frames)
        {
            elapsed_frames = (unsigned long)(cdda->play_frames - cdda_frames_remaining);
            sector_offset = (elapsed_frames * 75ul) / 60ul;
        }
    }
    value = start + sector_offset;
    cdda_resume_start.lo = (uint8_t)(value & 0xfful);
    cdda_resume_start.md = (uint8_t)((value >> 8) & 0xfful);
    cdda_resume_start.hi = (uint8_t)((value >> 16) & 0xfful);
}

static void VN_BANKED_CODE2 begin_cdda_deferred_resume(void)
{
    if (cdda_resume_defer_depth != 255u) cdda_resume_defer_depth++;
}

static void VN_BANKED_CODE2 end_cdda_deferred_resume(void)
{
    if (cdda_resume_defer_depth) cdda_resume_defer_depth--;
    if (!cdda_resume_defer_depth) resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
}

static void VN_BANKED_CODE prepare_cd_data_access(void)
{
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
#if defined(__PCE_CD__)
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
#endif
    if (!cdda_active) return;
    (void)pce_cdb_cdda_pause();
    cdda_active = 0u;
    cdda_resume_pending = 1u;
    restore_video_after_cdb_call(restore_display_after_pause);
}

static void VN_BANKED_CODE resume_cdda_after_cd_data_access(void)
{
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (!cdda_resume_pending) return;
    if (cdda_resume_defer_depth) return;
    if (!cdda_current || !cdda_track)
    {
        cancel_cdda_after_cd_data_conflict();
        return;
    }
    cdda_resume_end.lo = 0u;
    cdda_resume_end.md = 0u;
    cdda_resume_end.hi = 0u;
    cdda_sector_from_remaining(cdda_current);
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, cdda_resume_start, PCE_CDB_LOCATION_TYPE_UNTIL_END, cdda_resume_end, cdda_current->loop ? PCE_CDB_CDDA_PLAY_REPEAT : PCE_CDB_CDDA_PLAY_ONE_SHOT);
    cdda_active = 1u;
    cdda_resume_pending = 0u;
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_cdda);
}

static void VN_BANKED_CODE finish_cd_data_read_before_vram_copy(void)
{
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    map_vn_data();
}

static void VN_BANKED_CODE cancel_cdda_after_cd_data_conflict(void)
{
    cdda_active = 0u;
    cdda_resume_pending = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
}

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
    for (wait = 0u; wait < 65535u; wait++) {}
    service_psg_during_visual_cache_frames(VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES);
}

static void VN_VISUAL_CACHE_CODE vram_copy_sliced_from_vn_data_impl(uint16_t dest, const uint8_t *source, uint16_t length)
{
    uint16_t offset = 0u;
    uint16_t vram_dest = dest;
    while (length)
    {
        uint16_t chunk = length > VN_VISUAL_VRAM_COPY_SLICE_BYTES ? VN_VISUAL_VRAM_COPY_SLICE_BYTES : length;
        pce_editor_vram_copy(vram_dest, &source[offset], chunk);
        service_psg_during_visual_cache_work();
        map_vn_data();
        VN_MAP_VISUAL_CACHE_CODE();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        offset = (uint16_t)(offset + chunk);
        length = (uint16_t)(length - chunk);
    }
}

static void VN_VISUAL_CACHE_CODE visual_cache_page_to_vram_impl(uint16_t dest, uint8_t page, uint16_t page_offset, uint16_t length)
{
    uint16_t vram_dest = dest;
    while (length)
    {
        uint8_t *page_data = visual_cache_page_ptr_impl(page);
        uint16_t chunk = length > VN_VISUAL_VRAM_COPY_SLICE_BYTES ? VN_VISUAL_VRAM_COPY_SLICE_BYTES : length;
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
    if (visual_op == VN_VISUAL_CACHE_OP_VRAM_COPY)
    {
        vram_copy_sliced_from_vn_data_impl(vn_visual_cache_arg_dest, vn_visual_cache_arg_source, vn_visual_cache_arg_length);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_LOAD_BG)
    {
        load_bg_cache_asset_impl((signed int)(int16_t)vn_visual_cache_arg_asset, vn_visual_cache_arg_x, vn_visual_cache_arg_y);
        return 0u;
    }
    if (visual_op == VN_VISUAL_CACHE_OP_LOAD_SPRITE)
    {
        load_sprite_pattern_cache_asset_impl((signed int)(int16_t)vn_visual_cache_arg_asset, vn_visual_cache_arg_slot);
        return 0u;
    }
    return 0u;
}

typedef uint8_t (*vn_visual_cache_entry_fn_t)(uint8_t op);

static uint8_t VN_BANKED_CODE visual_cache_call(uint8_t op)
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
        uint16_t chunk = length > VN_VISUAL_VRAM_COPY_SLICE_BYTES ? VN_VISUAL_VRAM_COPY_SLICE_BYTES : length;
        pce_editor_vram_copy(vram_dest, &source[offset], chunk);
        service_psg_during_blocking_work();
        map_vn_data();
        VN_MAP_BANK130_FOR_CODE();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        offset = (uint16_t)(offset + chunk);
        length = (uint16_t)(length - chunk);
    }
}

static uint8_t VN_BANKED_CODE2 visual_cache_find(uint8_t kind, uint16_t asset_index, uint8_t part)
{
    uint8_t i;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        if (vn_visual_cache_valid[i]
            && vn_visual_cache_kind[i] == kind
            && vn_visual_cache_asset[i] == asset_index
            && vn_visual_cache_part[i] == part)
        {
            vn_visual_cache_clock++;
            if (!vn_visual_cache_clock) vn_visual_cache_clock = 1u;
            vn_visual_cache_lru[i] = vn_visual_cache_clock;
            return i;
        }
    }
    return 0xffu;
}

static uint8_t *VN_BANKED_CODE2 visual_cache_page_ptr(uint8_t page)
{
    uint8_t p = page;
    uint8_t bank;
    if (p >= VN_VISUAL_CACHE_PAGE_COUNT) p = (uint8_t)(VN_VISUAL_CACHE_PAGE_COUNT - 1u);
    bank = (uint8_t)(VN_VISUAL_CACHE_FIRST_BANK + p);
    __asm__ volatile("tam #(1 << 6)" : : "a"(bank) : "p");
    return VN_VISUAL_CACHE_PAGE_ADDR;
}

static void VN_BANKED_CODE2 visual_cache_page_to_vram(uint16_t dest, uint8_t page, uint16_t page_offset, uint16_t length)
{
    uint16_t vram_dest = dest;
    while (length)
    {
        uint16_t chunk = length > VN_VISUAL_VRAM_COPY_SLICE_BYTES ? VN_VISUAL_VRAM_COPY_SLICE_BYTES : length;
        uint8_t *page_data = visual_cache_page_ptr(page);
        pce_editor_vram_copy(vram_dest, &page_data[page_offset], chunk);
        service_psg_during_blocking_work();
        map_vn_data();
        VN_MAP_BANK130_FOR_CODE();
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        page_offset = (uint16_t)(page_offset + chunk);
        length = (uint16_t)(length - chunk);
    }
}

static uint8_t VN_BANKED_CODE visual_cache_ref_to_vram(uint16_t dest, uint8_t kind, uint16_t asset_index, const pce_editor_data_ref_t *ref)
{
    uint8_t part = 0u;
    uint16_t vram_dest = dest;
    unsigned long remaining;
    if (!ref || !ref->size) return 0u;
    remaining = (unsigned long)ref->size;
    while (remaining)
    {
        uint16_t chunk = remaining > VN_VISUAL_CACHE_PAGE_BYTES ? VN_VISUAL_CACHE_PAGE_BYTES : (uint16_t)remaining;
        const uint8_t slot = visual_cache_find(kind, asset_index, part);
        if (slot == 0xffu || vn_visual_cache_size[slot] < chunk) return 0u;
        visual_cache_page_to_vram(vram_dest, slot, 0u, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining -= (unsigned long)chunk;
        part++;
    }
    map_vn_data();
    VN_MAP_BANK130_FOR_CODE();
    return 1u;
}

#define visual_cache_bg_map_to_vram(dest, asset_index, ref, width_tiles, height_tiles) (0u)

static void VN_BANKED_CODE2 visual_cache_invalidate(uint8_t scope)
{
    uint8_t i;
    for (i = 0u; i < VN_VISUAL_CACHE_PAGE_COUNT; i++)
    {
        uint8_t clear_entry = 0u;
        uint8_t kind;
        if (!vn_visual_cache_valid[i]) continue;
        kind = vn_visual_cache_kind[i];
        if (scope == PCE_VN_CACHE_SCOPE_VISUAL || scope == PCE_VN_CACHE_SCOPE_ALL)
        {
            clear_entry = 1u;
        }
        else if (scope == PCE_VN_CACHE_SCOPE_BG)
        {
            if (kind == VN_VISUAL_CACHE_KIND_BG_TILES || kind == VN_VISUAL_CACHE_KIND_BG_MAP) clear_entry = 1u;
        }
        else if (scope == PCE_VN_CACHE_SCOPE_SPRITE)
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
#else
static void VN_BANKED_CODE vram_copy_sliced_from_vn_data(uint16_t dest, const uint8_t *source, uint16_t length)
{
    uint16_t offset = 0u;
    uint16_t vram_dest = dest;
    while (length)
    {
        uint16_t chunk = length > VN_VISUAL_VRAM_COPY_SLICE_BYTES ? VN_VISUAL_VRAM_COPY_SLICE_BYTES : length;
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

static uint8_t scene_pack_has_range(const vn_scene_pack_cache_t *cache, uint16_t offset, uint16_t length)
{
    if (!cache || !cache->valid || !cache->data) return 0u;
    if (offset > cache->size) return 0u;
    return (uint8_t)(length <= (uint16_t)(cache->size - offset));
}

static uint8_t scene_pack_u8(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    if (!scene_pack_has_range(cache, offset, 1u)) return 0u;
    return cache->data[offset];
}

static uint16_t VN_BANKED_CODE2 scene_pack_u16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    if (!scene_pack_has_range(cache, offset, 2u)) return 0u;
    return (uint16_t)((uint16_t)cache->data[offset] | ((uint16_t)cache->data[(uint16_t)(offset + 1u)] << 8));
}

static signed int VN_BANKED_CODE2 scene_pack_s16(const vn_scene_pack_cache_t *cache, uint16_t offset)
{
    return (signed int)(int16_t)scene_pack_u16(cache, offset);
}

static uint8_t scene_pack_is_valid(const vn_scene_pack_cache_t *cache)
{
    if (!cache || !cache->data || cache->size < PCE_VN_SCENE_PACK_HEADER_SIZE) return 0u;
    if (cache->data[0] != VN_SCENE_PACK_MAGIC_P) return 0u;
    if (cache->data[1] != VN_SCENE_PACK_MAGIC_V) return 0u;
    if (cache->data[2] != VN_SCENE_PACK_MAGIC_N) return 0u;
    if (cache->data[3] != VN_SCENE_PACK_MAGIC_S) return 0u;
    return (uint8_t)(cache->data[VN_SCENE_PACK_OFFSET_VERSION] == PCE_VN_SCENE_PACK_VERSION);
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
        uint16_t remaining;
        uint16_t offset = 0u;
        map_vn_data();
        if (scene_index >= pce_vn_scene_count) return 0u;
        pack = pce_vn_scene_packs[scene_index];
        if (!pack.byte_size || pack.byte_size > PCE_VN_SCENE_PACK_CACHE_BYTES || !pack.sector_count) return 0u;
        prepare_cd_data_access();
        sector.lo = pack.sector.lo;
        sector.md = pack.sector.md;
        sector.hi = pack.sector.hi;
        remaining = pack.byte_size;
        while (remaining)
        {
            const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
            (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)&cache->data[offset], chunk);
            cd_transfer_wait();
            remaining = (uint16_t)(remaining - chunk);
            offset = (uint16_t)(offset + chunk);
            cd_sector_advance(&sector);
        }
        cache->size = pack.byte_size;
        cache->scene_index = scene_index;
        cache->valid = scene_pack_is_valid(cache);
        sync_cd_external_irq_after_bios_call();
        resume_cdda_after_cd_data_access();
        VN_MAP_BANK130_FOR_CODE();
        return cache->valid;
    }
#else
    (void)scene_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 scene_pack_command_count(const vn_scene_pack_cache_t *cache)
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

static uint8_t VN_BANKED_CODE2 scene_pack_read_command(const vn_scene_pack_cache_t *cache, uint8_t command_index, pce_vn_command_t *command)
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

static uint8_t VN_BANKED_CODE2 scene_pack_read_message(const vn_scene_pack_cache_t *cache, uint8_t message_index, pce_vn_message_t *message)
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
    message->glyphs = &cache->data[glyph_offset];
    message->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    message->voice_index = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    message->text_speed_frames = scene_pack_u8(cache, (uint16_t)(offset + 5u));
    message->advance_mode = scene_pack_u8(cache, (uint16_t)(offset + 6u));
    message->auto_wait_frames = scene_pack_u8(cache, (uint16_t)(offset + 7u));
    message->mouth_animation_index = scene_pack_s16(cache, (uint16_t)(offset + 8u));
    message->mouth_slot = scene_pack_u8(cache, (uint16_t)(offset + 10u));
    message->text_color = scene_pack_u16(cache, (uint16_t)(offset + 11u));
    return 1u;
}

static uint8_t VN_BANKED_CODE2 scene_pack_read_choice(const vn_scene_pack_cache_t *cache, uint8_t choice_index, vn_choice_ref_t *choice)
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

static uint8_t VN_BANKED_CODE2 scene_pack_read_choice_option(const vn_scene_pack_cache_t *cache, const vn_choice_ref_t *choice, uint8_t option_index, pce_vn_choice_option_t *option)
{
    uint16_t offset;
    uint16_t glyph_offset;
    if (!choice || !option || option_index >= choice->option_count) return 0u;
    offset = (uint16_t)(choice->options_offset + ((uint16_t)option_index * PCE_VN_SCENE_PACK_OPTION_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_OPTION_SIZE)) return 0u;
    glyph_offset = scene_pack_u16(cache, offset);
    /* Each glyph entry (and the 0xffff terminator) is 16-bit. */
    if (!scene_pack_has_range(cache, glyph_offset, 2u)) return 0u;
    option->glyphs = &cache->data[glyph_offset];
    option->glyph_count = scene_pack_u8(cache, (uint16_t)(offset + 2u));
    option->value = scene_pack_s16(cache, (uint16_t)(offset + 3u));
    option->target_scene = scene_pack_s16(cache, (uint16_t)(offset + 5u));
    return 1u;
}

static uint8_t VN_BANKED_CODE2 scene_pack_read_switch(const vn_scene_pack_cache_t *cache, uint8_t switch_index, vn_switch_ref_t *branch)
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

static uint8_t VN_BANKED_CODE2 scene_pack_read_switch_case(const vn_scene_pack_cache_t *cache, const vn_switch_ref_t *branch, uint8_t case_index, pce_vn_switch_case_t *branch_case)
{
    uint16_t offset;
    if (!branch || !branch_case || case_index >= branch->case_count) return 0u;
    offset = (uint16_t)(branch->cases_offset + ((uint16_t)case_index * PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE));
    if (!scene_pack_has_range(cache, offset, PCE_VN_SCENE_PACK_SWITCH_CASE_SIZE)) return 0u;
    branch_case->value = scene_pack_s16(cache, offset);
    branch_case->command = scene_pack_u16(cache, (uint16_t)(offset + 2u));
    return 1u;
}

static void copy_data_ref_to_vram(uint16_t dest, const pce_editor_data_ref_t *ref, uint16_t word_stride, uint8_t cache_kind, uint16_t cache_asset_index)
{
    uint8_t i;
    uint16_t word_offset = 0;
    if (!ref || !ref->size) return;
#if defined(__PCE_CD__)
    if (cache_kind != VN_VISUAL_CACHE_KIND_NONE
        && visual_cache_ref_to_vram(dest, cache_kind, cache_asset_index, ref))
    {
        return;
    }
    if (cd_data_ref_to_vram(dest, ref)) return;
#endif
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

   Gated on PCE_EDITOR_ASSET_META_ON_CD: the generator only sets it for projects
   whose resident descriptors would exceed the RAM budget. Small projects keep the
   resident arrays and the #else macros below resolve to a direct array index, so
   these accessor functions are never referenced and DCE drops them entirely. */
#if defined(__PCE_CD__) && PCE_EDITOR_ASSET_META_ON_CD
#define VN_META_BG_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_BG_SLOT)
#define VN_META_SPRITE_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_SPRITE_SLOT)
#define VN_META_ADPCM_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_ADPCM_SLOT)
#define VN_META_PSG_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_PSG_SLOT)
#define VN_META_CDDA_PER_SECTOR (VN_CD_SECTOR_BYTES / PCE_EDITOR_META_CDDA_SLOT)
/* Max positional cells per sprite sheet whose cell_map we cache (1 byte/cell).
   The per-slot buffers live in console_ram (bank132's tail is taken by the overlay
   LMA, so they cannot go there). Keep this in sync with the generator's cap
   (pce-asset-manager.js); VN_SPRITE_SLOT_COUNT * this many bytes is console_ram. */
#define VN_META_CELL_MAP_MAX 384u

/* These asserts pin the appendix offsets past the struct image and the cd-ref
   byte layout, so any descriptor-struct change fails the build instead of
   silently mis-decoding. */
_Static_assert(sizeof(pce_editor_bg_asset_t) <= PCE_EDITOR_META_BG_PALETTE, "bg struct image overlaps palette appendix");
_Static_assert(sizeof(pce_editor_sprite_asset_t) <= PCE_EDITOR_META_SPR_PALETTE, "sprite struct image overlaps palette appendix");
_Static_assert(sizeof(pce_editor_cd_data_ref_t) == 8, "cd ref must be 8 bytes");
_Static_assert(PCE_EDITOR_META_ADPCM_DATA_SIZE == 2, "adpcm data_size offset must follow data pointer");
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

static pce_editor_bg_asset_t g_bg_cache[2];
static uint8_t g_bg_palette[2][32];
static pce_editor_cd_data_ref_t g_bg_tiles_cd[2];
static pce_editor_cd_data_ref_t g_bg_map_cd[2];
static uint16_t g_bg_cache_key[2];
static uint8_t g_bg_cache_lru = 0u;

/* 2-slot cache: set_background needs current+next BG live at once during a
   crossfade, so distinct indices must occupy distinct slots. */
static const pce_editor_bg_asset_t *VN_RESIDENT_CODE vn_get_bg_asset(uint16_t idx)
{
    uint8_t slot;
    uint16_t key;
    const uint8_t *p;
    pce_editor_bg_asset_t *rec;
    key = (uint16_t)(idx + 1u);
    if (g_bg_cache_key[0] == key) { g_bg_cache_lru = 0u; return &g_bg_cache[0]; }
    if (g_bg_cache_key[1] == key) { g_bg_cache_lru = 1u; return &g_bg_cache[1]; }
    slot = (uint8_t)(g_bg_cache_lru ^ 1u);
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
    g_bg_cache_lru = slot;
    return rec;
}

static pce_editor_sprite_asset_t g_spr_cache[VN_SPRITE_SLOT_COUNT];
static uint8_t g_spr_palette[VN_SPRITE_SLOT_COUNT][32];
static pce_editor_cd_data_ref_t g_spr_patterns_cd[VN_SPRITE_SLOT_COUNT];
/* cell_map caches live in console_ram (always mapped); show_character_sprite_frame
   reads them without any MPR juggling. */
static uint8_t g_spr_cell_map[VN_SPRITE_SLOT_COUNT][VN_META_CELL_MAP_MAX];
static uint16_t g_spr_cache_key[VN_SPRITE_SLOT_COUNT];
static uint8_t g_spr_cache_next = 0u;

static const pce_editor_sprite_asset_t *VN_RESIDENT_CODE vn_get_sprite_asset(uint16_t idx)
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
    slot = g_spr_cache_next;
    g_spr_cache_next = (uint8_t)((g_spr_cache_next + 1u) % VN_SPRITE_SLOT_COUNT);
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

static pce_editor_psg_asset_t g_psg_cache;
static pce_editor_cd_data_ref_t g_psg_pattern_cd;
static uint16_t g_psg_cache_key;

static const pce_editor_psg_asset_t *VN_RESIDENT_CODE vn_get_psg_asset(uint16_t idx)
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

static pce_editor_cdda_asset_t g_cdda_cache;
static uint16_t g_cdda_cache_key;

static const pce_editor_cdda_asset_t *VN_RESIDENT_CODE vn_get_cdda_asset(uint16_t idx)
{
    const uint8_t *p;
    const uint16_t key = (uint16_t)(idx + 1u);
    if (g_cdda_cache_key == key) return &g_cdda_cache;
    vn_read_meta_sector(&pce_editor_cdda_meta.sector, (uint8_t)(idx / VN_META_CDDA_PER_SECTOR));
    p = &cd_transfer_scratch[(uint16_t)((uint16_t)(idx % VN_META_CDDA_PER_SECTOR) * PCE_EDITOR_META_CDDA_SLOT)];
    g_cdda_cache.track = p[PCE_EDITOR_META_CDDA_TRACK];
    g_cdda_cache.loop = p[PCE_EDITOR_META_CDDA_LOOP];
    g_cdda_cache.start_sector.lo = p[PCE_EDITOR_META_CDDA_START_SECTOR];
    g_cdda_cache.start_sector.md = p[PCE_EDITOR_META_CDDA_START_SECTOR + 1u];
    g_cdda_cache.start_sector.hi = p[PCE_EDITOR_META_CDDA_START_SECTOR + 2u];
    g_cdda_cache.end_sector.lo = p[PCE_EDITOR_META_CDDA_END_SECTOR];
    g_cdda_cache.end_sector.md = p[PCE_EDITOR_META_CDDA_END_SECTOR + 1u];
    g_cdda_cache.end_sector.hi = p[PCE_EDITOR_META_CDDA_END_SECTOR + 2u];
    g_cdda_cache.end_time.frame = p[PCE_EDITOR_META_CDDA_END_TIME];
    g_cdda_cache.end_time.second = p[PCE_EDITOR_META_CDDA_END_TIME + 1u];
    g_cdda_cache.end_time.minute = p[PCE_EDITOR_META_CDDA_END_TIME + 2u];
    g_cdda_cache.play_frames = (unsigned int)p[PCE_EDITOR_META_CDDA_PLAY_FRAMES]
        | ((unsigned int)p[PCE_EDITOR_META_CDDA_PLAY_FRAMES + 1u] << 8);
    g_cdda_cache_key = key;
    return &g_cdda_cache;
}
#else
#define vn_get_bg_asset(idx) (&pce_editor_bg_assets[(idx)])
#define vn_get_sprite_asset(idx) (&pce_editor_sprite_assets[(idx)])
#define vn_get_adpcm_asset(idx) (&pce_editor_adpcm_assets[(idx)])
#define vn_get_psg_asset(idx) (&pce_editor_psg_assets[(idx)])
#define vn_get_cdda_asset(idx) (&pce_editor_cdda_assets[(idx)])
#endif

static void upload_palette(const pce_editor_data_ref_t *palette, uint16_t base_index, uint8_t fallback_dark)
{
    uint16_t i;
    uint16_t color_count;
    const uint8_t *data;
    if (!palette || !palette->size) return;
    data = data_ref_ptr(palette);
    if (!data) return;
    color_count = (uint16_t)(palette->size / 2u);
    if (color_count > 16u) color_count = 16u;
    for (i = 0; i < color_count; i++)
    {
        const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
        vce_write_color((uint16_t)(base_index + i), raw);
    }
    for (; i < 16u; i++)
    {
        vce_write_color((uint16_t)(base_index + i), fallback_dark ? 0x0000u : 0x01ffu);
    }
}

static uint16_t scale_vce_color(uint16_t raw, uint8_t step, uint8_t frames)
{
    uint16_t b;
    uint16_t r;
    uint16_t g;
    if (!frames) return raw;
    b = (uint16_t)(((raw & 0x0007u) * step) / frames);
    r = (uint16_t)((((raw >> 3) & 0x0007u) * step) / frames);
    g = (uint16_t)((((raw >> 6) & 0x0007u) * step) / frames);
    return (uint16_t)((g << 6) | (r << 3) | b);
}

static uint16_t VN_BANKED_CODE2 mix_vce_color(uint16_t from, uint16_t to, uint16_t step, uint8_t frames)
{
    uint16_t b;
    uint16_t r;
    uint16_t g;
    if (!frames) return (uint16_t)(to & 0x01ffu);
    b = (uint16_t)((((from & 0x0007u) * (frames - step)) + ((to & 0x0007u) * step)) / frames);
    r = (uint16_t)((((((from >> 3) & 0x0007u) * (frames - step)) + (((to >> 3) & 0x0007u) * step)) / frames) << 3);
    g = (uint16_t)((((((from >> 6) & 0x0007u) * (frames - step)) + (((to >> 6) & 0x0007u) * step)) / frames) << 6);
    return (uint16_t)(g | r | b);
}

static void fade_palette(const pce_editor_data_ref_t *palette, uint16_t base_index, uint8_t frames, uint8_t fade_in)
{
    uint16_t step;
    uint8_t i;
    uint16_t color_count;
    const uint8_t *data;
    if (!frames || !palette || !palette->size) return;
    data = data_ref_ptr(palette);
    if (!data) return;
    color_count = (uint16_t)(palette->size / 2u);
    if (color_count > 16u) color_count = 16u;
    for (step = 0u; step <= frames; step++)
    {
        const uint8_t scale = fade_in ? (uint8_t)step : (uint8_t)(frames - step);
        for (i = 0u; i < color_count; i++)
        {
            const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
            vce_write_color((uint16_t)(base_index + i), scale_vce_color(raw, scale, frames));
        }
        delay_frame();
        service_psg_during_blocking_work();
    }
}

static uint16_t ui_text_color_word(uint16_t color)
{
    return (color == PCE_VN_MESSAGE_COLOR_NONE) ? 0x01ffu : (uint16_t)(color & 0x01ffu);
}

static void write_ui_text_palette(uint16_t color)
{
    uint8_t i;
    const uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    for (i = 1u; i < 16u; i++)
    {
        vce_write_color((uint16_t)(base + i), (uint16_t)(color & 0x01ffu));
    }
}

static void VN_BANKED_CODE2 fade_current_screen_to_color(uint16_t target, uint8_t frames)
{
    uint16_t step;
    uint8_t i;
    uint16_t color_count = 0u;
    uint16_t bg_base = 0u;
    const uint8_t *data = (const uint8_t *)0;
    const uint16_t ui_start = ui_text_color_word(ui_text_color);
    target = (uint16_t)(target & 0x01ffu);
    if (current_bg_index >= 0 && current_bg_palette_size)
    {
        data = current_bg_palette;
        color_count = (uint16_t)(current_bg_palette_size / 2u);
        if (color_count > 16u) color_count = 16u;
        bg_base = current_bg_palette_base;
    }
    for (step = 0u; step <= frames; step++)
    {
        if (data)
        {
            for (i = 0u; i < color_count; i++)
            {
                const uint16_t raw = (uint16_t)(data[i * 2u] | ((uint16_t)data[(i * 2u) + 1u] << 8));
                vce_write_color((uint16_t)(bg_base + i), mix_vce_color(raw, target, step, frames));
            }
        }
        write_ui_text_palette(mix_vce_color(ui_start, target, step, frames));
        vce_write_color(0u, mix_vce_color(0x0000u, target, step, frames));
        if (frames) delay_frame();
    }
}

static void VN_BANKED_CODE2 restore_current_screen_palette(void)
{
    if (current_bg_index >= 0 && current_bg_palette_size)
    {
        const pce_editor_data_ref_t ref = { current_bg_palette, current_bg_palette_size, (const pce_editor_data_chunk_t *)0, 0u, (const pce_editor_cd_data_ref_t *)0 };
        upload_palette(&ref, current_bg_palette_base, 0u);
    }
    write_ui_text_palette(ui_text_color_word(ui_text_color));
}

static void VN_BANKED_CODE2 flash_screen_color(uint16_t color, uint8_t frames)
{
    uint8_t i;
    fade_current_screen_to_color(color, 0u);
    if (!frames) frames = 1u;
    for (i = 0u; i < frames; i++)
    {
        delay_frame();
    }
    restore_current_screen_palette();
}

static void upload_ui_palette(void)
{
    uint16_t base = (uint16_t)(VN_UI_PALETTE * 16u);
    vce_write_color((uint16_t)(base + 0u), 0x0000u);
    write_ui_text_palette(0x01ffu);
}

/* Tint the UI text foreground (palette 15, slots 1-15) to a message's color, or
   restore the default white when the message has no override. Affects the body
   text and speaker label drawn with this palette. */
static void apply_message_text_color(uint16_t color)
{
    ui_text_color = color;
    write_ui_text_palette(ui_text_color_word(color));
}

static void upload_font_tiles(void)
{
#if defined(__PCE_CD__)
    /* 12x12 glyph masks (12 words/glyph) are streamed from the CD font.bin into the
       VRAM mask region at boot; the compositor reads each glyph's mask back from
       VRAM when revealing message text. Only the small pce_vn_font_data ref
       (sector/size) lives in ram_bank132. */
    pce_vn_cd_data_ref_t font;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest = (uint16_t)PCE_VN_FONT_MASK_VRAM_WORD;
    map_vn_data();
    font = pce_vn_font_data;
    map_resident_data();
    if (!font.byte_size || !font.sector_count) return;
    prepare_cd_data_access();
    sector.lo = font.sector.lo;
    sector.md = font.sector.md;
    sector.hi = font.sector.hi;
    remaining = font.byte_size;
    /* cd_transfer_scratch is in bank132; ensure MPR6 points at it for the loop. */
    map_vn_data();
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        pce_editor_vram_copy(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
#elif defined(__PCE__)
    pce_editor_vram_copy((uint16_t)PCE_VN_FONT_MASK_VRAM_WORD, pce_vn_font_tiles, (uint16_t)(pce_vn_font_glyph_count * (VN_GLYPH_MASK_WORDS * 2u)));
#endif
}

/* Stream the sprite-format glyph font (used by spritetext overlays) into VRAM
   once at boot. Each glyph is one 16x16 sprite pattern (128 bytes); the pattern
   number for glyph g is PCE_VN_FONT_SPRITE_PATTERN_BASE + g*2.
   In .ram_bank130 to keep the resident bank128 within budget (mirrors the
   banked CD->VRAM helpers); called once from init_video at boot. */
static void VN_BANKED_CODE2 upload_font_sprite_patterns(void)
{
#if !PCE_VN_HAS_SPRITETEXT
    return;
#else
#if defined(__PCE_CD__)
    pce_vn_cd_data_ref_t font;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t vram_dest = (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE * 32u);
    map_vn_data();
    font = pce_vn_font_sprite_data;
    map_resident_data();
    if (!font.byte_size || !font.sector_count) return;
    prepare_cd_data_access();
    sector.lo = font.sector.lo;
    sector.md = font.sector.md;
    sector.hi = font.sector.hi;
    remaining = font.byte_size;
    map_vn_data();
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)cd_transfer_scratch, chunk);
        cd_transfer_wait();
        pce_editor_vram_copy(vram_dest, cd_transfer_scratch, chunk);
        vram_dest = (uint16_t)(vram_dest + ((chunk + 1u) / 2u));
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
#elif defined(__PCE__)
    if (pce_vn_font_sprite_glyph_count)
    {
        pce_editor_vram_copy((uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE * 32u), pce_vn_font_sprite_tiles, (uint16_t)(pce_vn_font_sprite_glyph_count * 128u));
    }
#endif
#endif
}

static void write_map_words(uint16_t map_addr, const uint16_t *words, uint16_t count)
{
    pce_editor_vram_copy(map_addr, (const uint8_t *)words, (uint16_t)(count * 2u));
}

static uint16_t ui_tile(uint16_t tile)
{
    return (uint16_t)((VN_UI_PALETTE << 12) | tile);
}

/* Zero the dedicated blank tile once at boot; the BG/UI blank fill points at it.
   enc must be in section .bss (see the msg_* / clear_line scratch note). */
static uint8_t blank_tile_enc[32] __attribute__((section(".bss")));
static void upload_blank_tile(void)
{
    uint8_t i;
    for (i = 0u; i < 32u; i++) blank_tile_enc[i] = 0u;
    pce_editor_vram_copy((uint16_t)(PCE_VN_BLANK_TILE * 16u), blank_tile_enc, 32u);
}

/* Screen/rect clear line buffers. Like the compositor scratch, these MUST be
   file-scope statics in section .bss: without the section attribute they were
   placed in a region that read back as garbage in this banked build, so
   clear_screen_map / clear_map_rect_at_dest wrote garbage tile refs into the
   margins (everything outside the BG and message window). */
static uint16_t clear_line[VN_MAP_WIDTH] __attribute__((section(".bss")));
static void clear_screen_map(void)
{
    uint8_t row;
    uint8_t col;
    for (col = 0; col < VN_MAP_WIDTH; col++)
    {
        clear_line[col] = ui_tile(VN_UI_BLANK_TILE);
    }
    for (row = 0; row < VN_MAP_HEIGHT; row++)
    {
        write_map_words((uint16_t)(row * VN_MAP_WIDTH), clear_line, VN_MAP_WIDTH);
    }
}

static void clear_map_rect_at_dest(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles)
{
    uint8_t row;
    uint8_t col;
    uint8_t x;
    uint8_t y;
    uint8_t copy_width;
    uint8_t copy_height;
    if (!width_tiles || !height_tiles) return;
    x = (uint8_t)(map_dest % VN_MAP_WIDTH);
    y = (uint8_t)(map_dest / VN_MAP_WIDTH);
    if (y >= VN_MAP_HEIGHT) return;
    copy_width = width_tiles;
    copy_height = height_tiles;
    if ((uint16_t)x + copy_width > VN_MAP_WIDTH) copy_width = (uint8_t)(VN_MAP_WIDTH - x);
    if ((uint16_t)y + copy_height > VN_MAP_HEIGHT) copy_height = (uint8_t)(VN_MAP_HEIGHT - y);
    if (!copy_width || !copy_height) return;
    for (col = 0; col < copy_width; col++)
    {
        clear_line[col] = ui_tile(VN_UI_BLANK_TILE);
    }
    for (row = 0; row < copy_height; row++)
    {
        write_map_words((uint16_t)(map_dest + ((uint16_t)row * VN_MAP_WIDTH)), clear_line, copy_width);
    }
}

/* ---- 12x12 glyph compositor -------------------------------------------------
   Message text uses a 12px horizontal pitch that does not align to the 8x8 tile
   grid, so glyphs are composited at runtime. A strip tile may be shared by two
   adjacent glyphs (the previous glyph's right edge + the current glyph's left
   edge). Instead of reading the tile back from VRAM to accumulate, the compositor
   keeps the previous glyph's 12x12 mask in RAM and re-draws BOTH glyphs into the
   shared tile, so each tile is rebuilt from scratch and written once. This never
   reads VRAM back (the standard WASM core mishandles VRAM read-back) and never
   touches VDC memory/cycle control. Only the current glyph's mask is read from
   VRAM (1 read/char). */
static uint16_t composer_prev_mask[VN_GLYPH_MASK_WORDS] __attribute__((section(".bss"))); /* previous glyph's 12 mask rows */
static uint8_t composer_prev_col __attribute__((section(".bss")));   /* column of the previous visible glyph */
static uint8_t composer_prev_valid __attribute__((section(".bss"))); /* 1 if composer_prev_mask holds a left neighbor */
static uint8_t composer_row __attribute__((section(".bss")));        /* text row the previous glyph belongs to */
#if defined(__PCE_CD__)
static uint16_t message_glyph_cache_ids[VN_MESSAGE_GLYPH_CACHE_COUNT] __attribute__((section(".bss")));
/* ".ram_bank132_tail": NOLOAD overlay-window reuse (see cd_transfer_scratch). This
   write-before-read cache shares bank132's never-read overlay LMA tail so the
   resident metadata region stays free for growth. */
static uint16_t message_glyph_cache_masks[VN_MESSAGE_GLYPH_CACHE_COUNT][VN_GLYPH_MASK_WORDS] __attribute__((section(".ram_bank132_tail")));
static uint8_t message_glyph_cache_count __attribute__((section(".bss")));
static uint8_t message_glyph_cache_valid __attribute__((section(".bss")));
#endif

static void VN_BANKED_CODE2 restore_text_vram_after_full_screen_bg(void)
{
#if !PCE_VN_HAS_FULL_SCREEN_BG
    return;
#else
    if (!full_screen_bg_text_vram_dirty) return;
    upload_font_tiles();
    upload_font_sprite_patterns();
    upload_blank_tile();
#if defined(__PCE_CD__)
    message_glyph_cache_valid = 0u;
#endif
    full_screen_bg_text_vram_dirty = 0u;
#endif
}

/* Build a PCE 4bpp 8x8 tile (16 words) from an 8-scanline 1bpp mask. A lit pixel
   is color index 15 (all four bitplanes set), so every plane byte equals the row
   mask; bit 0x80 is the leftmost pixel. */
static void VN_OVERLAY_CODE encode_msg_tile(const uint8_t *mask8, uint8_t *out32)
{
    uint8_t sy;
    for (sy = 0u; sy < 8u; sy++)
    {
        const uint8_t m = mask8[sy];
        out32[(sy * 2u)] = m;            /* plane 0 */
        out32[(sy * 2u) + 1u] = m;       /* plane 1 */
        out32[16u + (sy * 2u)] = m;      /* plane 2 */
        out32[16u + (sy * 2u) + 1u] = m; /* plane 3 */
    }
}

/* OR a 12x12 glyph's pixels for one 8x8 tile (column tile_x0..+7, sub-band 0/1)
   into mask8. gpx0 is the glyph's left pixel; pixels outside the tile are ignored. */
static void VN_OVERLAY_CODE add_glyph_tile(const uint16_t *gmask, uint16_t gpx0,
    uint8_t tile_x0, uint8_t sub, uint8_t *mask8)
{
    const uint16_t gpx1 = (uint16_t)(gpx0 + VN_GLYPH_W);
    const uint16_t tile_x1 = (uint16_t)(tile_x0 + 8u);
    uint8_t px_start = 0u;
    uint8_t px_end = 8u;
    uint8_t sy;
    if (gpx1 <= tile_x0 || gpx0 >= tile_x1) return;
    if (gpx0 > tile_x0) px_start = (uint8_t)(gpx0 - tile_x0);
    if (gpx1 < tile_x1) px_end = (uint8_t)(gpx1 - tile_x0);
    for (sy = 0u; sy < 8u; sy++)
    {
        const uint8_t band_y = (uint8_t)((sub * 8u) + sy);
        uint8_t gy;
        uint16_t mrow;
        uint8_t px;
        if (band_y < VN_GLYPH_Y_OFFSET) continue;
        gy = (uint8_t)(band_y - VN_GLYPH_Y_OFFSET);
        if (gy >= VN_GLYPH_H) continue;
        mrow = gmask[gy];
        for (px = px_start; px < px_end; px++)
        {
            const uint8_t gx = (uint8_t)(((uint16_t)tile_x0 + px) - gpx0);
            if (mrow & (uint16_t)(0x8000u >> gx))
            {
                mask8[sy] |= (uint8_t)(0x80u >> px);
            }
        }
    }
}

/* Compositor scratch buffers. These are file-scope statics, NOT function-local
   arrays: on llvm-mos large stack arrays inside the banked (VN_BANKED_CODE2)
   message code were read back as zero, corrupting the BAT/strip writes. The VN is
   single-threaded and these functions never re-enter, so sharing statics is safe.
   (clear_screen_map uses the same static-buffer pattern.) */
static uint16_t msg_bat_row[VN_MSG_TILE_COLS] __attribute__((section(".bss")));
static uint8_t msg_enc[32] __attribute__((section(".bss")));
static uint8_t msg_mask8[8] __attribute__((section(".bss")));
static uint16_t msg_gmask[VN_GLYPH_MASK_WORDS] __attribute__((section(".bss")));

static void VN_BANKED_CODE2 map_message_window_cells(uint8_t blank)
{
    uint8_t tr;
    uint8_t tc;
    for (tr = 0u; tr < VN_MSG_TILE_ROWS; tr++)
    {
        const uint16_t row_tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
            + ((uint16_t)tr * VN_MSG_TILE_COLS));
        for (tc = 0u; tc < VN_MSG_TILE_COLS; tc++)
        {
            msg_bat_row[tc] = ui_tile(blank ? PCE_VN_BLANK_TILE : (uint16_t)(row_tile + tc));
        }
        write_map_words((uint16_t)(((VN_TEXT_Y + tr) * VN_MAP_WIDTH) + VN_TEXT_X),
            msg_bat_row, VN_MSG_TILE_COLS);
    }
}

static void VN_BANKED_CODE2 clear_window_tile_pixels(void)
{
    uint8_t tr;
    uint8_t tc;
    for (tc = 0u; tc < 32u; tc++) msg_enc[tc] = 0u;
    for (tr = 0u; tr < VN_MSG_TILE_COUNT; tr++)
    {
        pce_editor_vram_copy((uint16_t)((VN_MSG_STRIP_TILE_BASE + tr) * 16u), msg_enc, 32u);
    }
    composer_prev_valid = 0u;
    composer_row = 0xffu;
}

static void VN_BANKED_CODE map_message_wait_indicator_cell(uint8_t blank)
{
    uint8_t sub;
    const uint8_t tc0 = (uint8_t)(((uint16_t)VN_WAIT_CURSOR_COL * VN_GLYPH_W) >> 3);
    for (sub = 0u; sub < 2u; sub++)
    {
        const uint16_t strip_tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
            + ((uint16_t)(((VN_WAIT_CURSOR_ROW * 2u) + sub) * VN_MSG_TILE_COLS)) + tc0);
        msg_bat_row[0] = ui_tile(blank ? PCE_VN_BLANK_TILE : strip_tile);
        msg_bat_row[1] = ui_tile(blank ? PCE_VN_BLANK_TILE : (uint16_t)(strip_tile + 1u));
        write_map_words((uint16_t)(((VN_TEXT_Y + (VN_WAIT_CURSOR_ROW * 2u) + sub) * VN_MAP_WIDTH) + VN_TEXT_X + tc0),
            msg_bat_row, 2u);
    }
}

/* Draw a 12x12 glyph at logical column `col` of text `row`. The up-to-two affected
   tile columns (x two tile rows) are each rebuilt from the current glyph plus the
   previous glyph (which may share the left tile), then written once — no VRAM
   read-back. glyph 0 / newline / end add no pixels and break the neighbor chain. */
/* Decode the BG message/choice glyph entry at byte offset `pos`. Encoding (see
   pce-vn-manager.js): a single byte 0x00..0xfc is a direct glyph index; 0xfd is an
   escape prefix followed by a 16-bit little-endian index (used for indices >= 253);
   0xfe is newline and 0xff is end. The newline and end bytes decode to the 16-bit
   sentinels PCE_VN_GLYPH_NEWLINE / _END so that escaped indices (bounded well below
   0xfffe) can never collide with them. Callers advance their own cursor by
   vn_glyph_stride() — kept by-value (no pointer mutation) for the HuC6280 backend. */
static uint16_t VN_RESIDENT_CODE vn_glyph_decode(const uint8_t *glyphs, uint16_t pos)
{
    const uint8_t b = glyphs[pos];
    if (b == PCE_VN_GLYPH_ESCAPE)
        return (uint16_t)((uint16_t)glyphs[pos + 1u] | ((uint16_t)glyphs[pos + 2u] << 8));
    if (b == 0xfeu) return PCE_VN_GLYPH_NEWLINE;
    if (b == 0xffu) return PCE_VN_GLYPH_END;
    return (uint16_t)b;
}

/* Bytes consumed by the glyph entry at `pos` (3 for an escape entry, else 1). */
static uint16_t VN_RESIDENT_CODE vn_glyph_stride(const uint8_t *glyphs, uint16_t pos)
{
    return (glyphs[pos] == PCE_VN_GLYPH_ESCAPE) ? 3u : 1u;
}

#if defined(__PCE_CD__)
static uint8_t VN_BANKED_CODE message_glyph_cache_find(uint16_t glyph)
{
    uint8_t i;
    if (!message_glyph_cache_valid) return VN_MESSAGE_GLYPH_CACHE_COUNT;
    for (i = 0u; i < message_glyph_cache_count; i++)
    {
        if (message_glyph_cache_ids[i] == glyph) return i;
    }
    return VN_MESSAGE_GLYPH_CACHE_COUNT;
}

static const uint16_t *VN_OVERLAY_CODE cached_message_glyph_mask(uint16_t glyph)
{
    const uint8_t index = message_glyph_cache_find(glyph);
    if (index >= VN_MESSAGE_GLYPH_CACHE_COUNT) return (const uint16_t *)0;
    map_vn_data();
    return message_glyph_cache_masks[index];
}

static void VN_OVERLAY_CODE preload_message_glyph_masks(const pce_vn_message_t *message)
{
    uint16_t pos = 0u;
    uint8_t i;
    map_vn_data();
    message_glyph_cache_count = 0u;
    message_glyph_cache_valid = 1u;
    if (!message || !message->glyphs) return;
    for (i = 0u; i < message->glyph_count; i++)
    {
        const uint16_t glyph = vn_glyph_decode(message->glyphs, pos);
        pos = (uint16_t)(pos + vn_glyph_stride(message->glyphs, pos));
        if (glyph == PCE_VN_GLYPH_END) break;
        if (glyph == PCE_VN_GLYPH_NEWLINE || glyph == 0u) continue;
        if (message_glyph_cache_find(glyph) < VN_MESSAGE_GLYPH_CACHE_COUNT) continue;
        if (message_glyph_cache_count >= VN_MESSAGE_GLYPH_CACHE_COUNT) continue;
        message_glyph_cache_ids[message_glyph_cache_count] = glyph;
        pce_vdc_copy_from_vram(message_glyph_cache_masks[message_glyph_cache_count],
            (uint16_t)(PCE_VN_FONT_MASK_VRAM_WORD + ((uint16_t)glyph * VN_GLYPH_MASK_WORDS)),
            (uint16_t)(VN_GLYPH_MASK_WORDS * 2u));
        message_glyph_cache_count++;
    }
}
#else
static const uint16_t *VN_OVERLAY_CODE cached_message_glyph_mask(uint16_t glyph)
{
    (void)glyph;
    return (const uint16_t *)0;
}

static void VN_OVERLAY_CODE preload_message_glyph_masks(const pce_vn_message_t *message)
{
    (void)message;
}
#endif

static void VN_OVERLAY_CODE draw_message_glyph_at(uint16_t glyph, uint8_t col, uint8_t row)
{
    const uint16_t px0 = (uint16_t)col * VN_GLYPH_W;
    const uint8_t tc0 = (uint8_t)(px0 >> 3);
    const uint8_t tc1 = (uint8_t)((px0 + VN_GLYPH_W - 1u) >> 3);
    const uint16_t prev_px0 = (uint16_t)composer_prev_col * VN_GLYPH_W;
    const uint16_t *gmask;
    uint8_t use_prev;
    uint8_t tc;
    uint8_t k;
    map_vn_data();
    if (glyph == 0u || glyph == PCE_VN_GLYPH_NEWLINE || glyph == PCE_VN_GLYPH_END)
    {
        composer_prev_valid = 0u; /* a blank/newline breaks the shared-tile chain */
        return;
    }
    if (row != composer_row) composer_prev_valid = 0u; /* new row: no left neighbor */
    use_prev = composer_prev_valid;
    gmask = cached_message_glyph_mask(glyph);
    if (!gmask)
    {
        pce_vdc_copy_from_vram(msg_gmask,
            (uint16_t)(PCE_VN_FONT_MASK_VRAM_WORD + ((uint16_t)glyph * VN_GLYPH_MASK_WORDS)),
            (uint16_t)(VN_GLYPH_MASK_WORDS * 2u));
        gmask = msg_gmask;
    }
    for (tc = tc0; tc <= tc1 && tc < VN_MSG_TILE_COLS; tc++)
    {
        const uint8_t tile_x0 = (uint8_t)(tc * 8u);
        uint8_t sub;
        for (sub = 0u; sub < 2u; sub++)
        {
            const uint16_t tile = (uint16_t)(VN_MSG_STRIP_TILE_BASE
                + ((uint16_t)((row * 2u) + sub) * VN_MSG_TILE_COLS) + tc);
            for (k = 0u; k < 8u; k++) msg_mask8[k] = 0u;
            add_glyph_tile(gmask, px0, tile_x0, sub, msg_mask8);
            if (use_prev) add_glyph_tile(composer_prev_mask, prev_px0, tile_x0, sub, msg_mask8);
            encode_msg_tile(msg_mask8, msg_enc);
            pce_editor_vram_copy((uint16_t)(tile * 16u), msg_enc, 32u);
        }
    }
    for (k = 0u; k < VN_GLYPH_MASK_WORDS; k++) composer_prev_mask[k] = gmask[k];
    composer_prev_col = col;
    composer_prev_valid = 1u;
    composer_row = row;
}

#define VN_MESSAGE_ENTRY_COMPLETE 0u
#define VN_MESSAGE_ENTRY_NEWLINE 1u
#define VN_MESSAGE_ENTRY_DRAWABLE 2u
#define VN_MESSAGE_ROW_COL_LIMIT(row) ((row) == VN_WAIT_CURSOR_ROW ? VN_WAIT_CURSOR_COL : VN_TEXT_COLS)

static uint8_t VN_OVERLAY_CODE draw_message_next_entry(const pce_vn_message_t *message)
{
    uint16_t glyph;
    map_vn_data();
    if (!message || !message->glyphs) return VN_MESSAGE_ENTRY_COMPLETE;
    if (message_glyph_pos >= message->glyph_count) return VN_MESSAGE_ENTRY_COMPLETE;
    glyph = vn_glyph_decode(message->glyphs, message_glyph_byte);
    message_glyph_byte = (uint16_t)(message_glyph_byte + vn_glyph_stride(message->glyphs, message_glyph_byte));
    message_glyph_pos++;
    if (glyph == PCE_VN_GLYPH_END) return VN_MESSAGE_ENTRY_COMPLETE;
    if (glyph == PCE_VN_GLYPH_NEWLINE)
    {
        message_col = 0u;
        message_row++;
        if (message_row >= VN_TEXT_ROWS) return VN_MESSAGE_ENTRY_COMPLETE;
        return VN_MESSAGE_ENTRY_NEWLINE;
    }
    draw_message_glyph_at(glyph, message_col, message_row);
    message_col++;
    if (message_col >= VN_MESSAGE_ROW_COL_LIMIT(message_row))
    {
        message_col = 0u;
        message_row++;
        if (message_row >= VN_TEXT_ROWS) return VN_MESSAGE_ENTRY_COMPLETE;
    }
    return VN_MESSAGE_ENTRY_DRAWABLE;
}

static uint8_t VN_OVERLAY_CODE draw_message_prefix_glyphs(const pce_vn_message_t *message)
{
    uint8_t instant_glyph_count;
    uint8_t i;
    if (!message || !message->glyphs) return 1u;
    instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT(message->mouth_slot);
    for (i = 0u; i < instant_glyph_count; i++)
    {
        if (draw_message_next_entry(message) == VN_MESSAGE_ENTRY_COMPLETE) return 1u;
    }
    return message_glyph_pos >= message->glyph_count ? 1u : 0u;
}

static uint8_t VN_OVERLAY_CODE draw_message_next_glyph(const pce_vn_message_t *message)
{
    uint8_t status;
    /* Reveal exactly one drawable glyph per call. Newlines are not spoken, so they
       are processed inline (advance the row) WITHOUT consuming a typewriter tick;
       otherwise every line break would push the remaining text one reveal-interval
       behind the ADPCM voice and the drift would accumulate down the message. */
    for (;;)
    {
        status = draw_message_next_entry(message);
        if (status == VN_MESSAGE_ENTRY_COMPLETE) return 1u;
        if (status == VN_MESSAGE_ENTRY_DRAWABLE) return message_glyph_pos >= message->glyph_count ? 1u : 0u;
    }
}

static void VN_OVERLAY_CODE draw_message_text(const pce_vn_message_t *message)
{
    uint8_t i;
    uint8_t col = 0;
    uint8_t row = 0;
    uint16_t pos = 0u;
    map_vn_data();
    if (!message || !message->glyphs) return;
    for (i = 0; i < message->glyph_count; i++)
    {
        const uint16_t glyph = vn_glyph_decode(message->glyphs, pos);
        pos = (uint16_t)(pos + vn_glyph_stride(message->glyphs, pos));
        if (glyph == PCE_VN_GLYPH_END) break;
        if (glyph == PCE_VN_GLYPH_NEWLINE)
        {
            col = 0;
            row++;
            if (row >= VN_TEXT_ROWS) break;
            continue;
        }
        draw_message_glyph_at(glyph, col, row);
        col++;
        if (col >= VN_MESSAGE_ROW_COL_LIMIT(row))
        {
            col = 0;
            row++;
            if (row >= VN_TEXT_ROWS) break;
        }
    }
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

static void clear_bg_map_side_margins(uint16_t map_dest, uint8_t width_tiles, uint8_t height_tiles)
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
    }
    clear_bg_map_side_margins(map_dest, bg->width_tiles, bg->height_tiles);
}

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

static void clear_sprites(void)
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
    vn_wait_next_vblank();
    irq = vn_vdc_irq_lock();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_editor_vram_copy(VN_SATB_ADDR, (const uint8_t *)sprite_shadow, (uint16_t)(64u * sizeof(vdc_sprite_t)));
    pce_vdc_poke(VDC_REG_DMA_CONTROL, VDC_DMA_SRC_INC);
    pce_vdc_poke(VDC_REG_SATB_START, VN_SATB_ADDR);
    vn_vdc_irq_unlock(irq);
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
    vn_wait_next_vblank();
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

static uint8_t VN_OVERLAY_CODE show_character_sprite_frame(uint8_t satb_index, const pce_editor_sprite_draw_meta_t *draw_meta, const uint8_t *cell_map, const pce_vn_sprite_anim_t *animation, uint8_t frame, int16_t x, int16_t y, uint8_t flags)
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
    cell_width = draw_meta->cell_width;
    cell_height = draw_meta->cell_height;
    cell_columns = draw_meta->cell_columns ? draw_meta->cell_columns : 1u;
    cell_rows = draw_meta->cell_rows ? draw_meta->cell_rows : 1u;
    pattern_base = draw_meta->pattern_base;
    attr = sprite_attr_for_size(draw_meta, flags);
    total_cells = (uint16_t)(cell_columns * cell_rows);
    use_animation_frame = (uint8_t)(
        animation &&
        animation->frame_count >= 1u &&
        animation->frame_width_cells &&
        animation->frame_height_cells &&
        animation->frame_width_cells <= cell_columns &&
        animation->frame_height_cells <= cell_rows &&
        animation->frame_stride_cells &&
        animation->first_cell < total_cells
    );
    frame_columns = use_animation_frame && animation->frame_width_cells ? animation->frame_width_cells : cell_columns;
    frame_rows = use_animation_frame && animation->frame_height_cells ? animation->frame_height_cells : cell_rows;
    first_cell = use_animation_frame
        ? (uint16_t)(animation->first_cell + ((uint16_t)frame * animation->frame_stride_cells))
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
    (void)flags;
#endif
    return written;
}

static uint8_t VN_BANKED_CODE call_overlay_show_character_sprite_frame(uint8_t satb_index, const pce_editor_sprite_draw_meta_t *draw_meta, const uint8_t *cell_map, const pce_vn_sprite_anim_t *animation, uint8_t frame, int16_t x, int16_t y, uint8_t flags)
{
#if defined(__PCE_CD__)
    uint8_t written;
    map_vn_data();
    pce_ram_bank133_map();
    written = show_character_sprite_frame(satb_index, draw_meta, cell_map, animation, frame, x, y, flags);
    pce_ram_bank130_map();
    return written;
#else
    return show_character_sprite_frame(satb_index, draw_meta, cell_map, animation, frame, x, y, flags);
#endif
}

static void play_cdda_track(const pce_editor_cdda_asset_t *cdda)
{
#if defined(__PCE_CD__)
    pce_sector_t start = {0};
    pce_sector_t end = {0};
    uint8_t end_type = PCE_CDB_LOCATION_TYPE_UNTIL_END;
    uint8_t track;
    uint8_t loop;
    const uint8_t restore_display_after_cdda = (uint8_t)!pending_display_enable;
    if (!cdda) return;
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
    track = cdda->track;
    loop = cdda->loop;
    const uint8_t mode = loop ? PCE_CDB_CDDA_PLAY_REPEAT : PCE_CDB_CDDA_PLAY_ONE_SHOT;
    if (track < 2u)
    {
        sync_cd_external_irq_after_bios_call();
        return;
    }
    if (cdda_active)
    {
        (void)pce_cdb_cdda_pause();
        cdda_active = 0u;
    }
    start.lo = cdda->start_sector.lo;
    start.md = cdda->start_sector.md;
    start.hi = cdda->start_sector.hi;
    cdda_has_frame_limit = cdda->play_frames ? 1u : 0u;
    cdda_frames_remaining = cdda->play_frames;
    cdda_looping = loop ? 1u : 0u;
    cdda_track = track;
    cdda_current = cdda;
    (void)pce_cdb_cdda_play(PCE_CDB_LOCATION_TYPE_SECTOR, start, end_type, end, mode);
    cdda_active = 1u;
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_cdda);
#else
    (void)cdda;
#endif
}

static void service_cdda_playback(void)
{
#if defined(__PCE_CD__)
    if (!cdda_active || !cdda_has_frame_limit || !cdda_current) return;
    if (cdda_frames_remaining) cdda_frames_remaining--;
    if (cdda_frames_remaining) return;
    {
        if (cdda_looping)
        {
            cdda_frames_remaining = cdda_current->play_frames;
        }
        else
        {
            const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
            pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
            (void)pce_cdb_cdda_pause();
            cdda_active = 0u;
            cdda_has_frame_limit = 0u;
            cdda_looping = 0u;
            cdda_track = 0u;
            cdda_frames_remaining = 0u;
            cdda_current = (const pce_editor_cdda_asset_t *)0;
            sync_cd_external_irq_after_bios_call();
            restore_video_after_cdb_call(restore_display_after_pause);
        }
    }
#endif
}

static void stop_cdda_track(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display_after_pause = (uint8_t)!pending_display_enable;
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
    (void)pce_cdb_cdda_pause();
    cdda_active = 0u;
    cdda_has_frame_limit = 0u;
    cdda_looping = 0u;
    cdda_track = 0u;
    cdda_frames_remaining = 0u;
    cdda_current = (const pce_editor_cdda_asset_t *)0;
    sync_cd_external_irq_after_bios_call();
    restore_video_after_cdb_call(restore_display_after_pause);
#endif
}

static unsigned int VN_BANKED_CODE2 adpcm_code_sample_rate(uint8_t code)
{
    uint8_t value;
    value = code > VN_ADPCM_MAX_RATE_CODE ? VN_ADPCM_MAX_RATE_CODE : code;
    return VN_ADPCM_BASE_SAMPLE_RATE / (16u - (unsigned int)value);
}

static uint8_t VN_BANKED_CODE2 adpcm_rate_code(unsigned int sample_rate)
{
    unsigned int rate;
    unsigned int actual;
    unsigned int diff;
    unsigned int best_diff;
    uint8_t code;
    uint8_t best;
    rate = sample_rate ? sample_rate : 16000u;
    best = 0u;
    best_diff = 65535u;
    for (code = 0u; code <= VN_ADPCM_MAX_RATE_CODE; code += 1u)
    {
        actual = adpcm_code_sample_rate(code);
        diff = actual > rate ? actual - rate : rate - actual;
        if (diff < best_diff)
        {
            best = code;
            best_diff = diff;
            if (!diff) break;
        }
    }
    return best;
}

static uint8_t VN_BANKED_CODE2 adpcm_legacy_divider(unsigned int sample_rate, unsigned int base_rate)
{
    unsigned int rate;
    unsigned int computed;
    rate = sample_rate ? sample_rate : 16000u;
    computed = (base_rate + (rate / 2u)) / rate;
    if (!computed) return 0u;
    computed -= 1u;
    if (computed > 255u) return 255u;
    return (uint8_t)computed;
}

static uint8_t VN_BANKED_CODE adpcm_play_divider(unsigned int sample_rate, uint8_t divider)
{
    uint8_t computed;
#if defined(__PCE_CD__)
    pce_ram_bank130_map();
#endif
    if (!sample_rate) return divider > VN_ADPCM_MAX_RATE_CODE ? VN_ADPCM_MAX_RATE_CODE : divider;
    computed = adpcm_rate_code(sample_rate);
    if (divider > VN_ADPCM_MAX_RATE_CODE) return computed;
    if (divider < 8u) return computed;
    VN_MAP_BANK130_FOR_CODE();
    if (divider == adpcm_legacy_divider(sample_rate, VN_ADPCM_LEGACY_BASE_SAMPLE_RATE)) return computed;
    VN_MAP_BANK130_FOR_CODE();
    if (divider == adpcm_legacy_divider(sample_rate, VN_ADPCM_SLOW_LEGACY_BASE_SAMPLE_RATE)) return computed;
    return divider;
}

static uint8_t VN_BANKED_CODE2 adpcm_voice_fits_buffer(void)
{
#if defined(__PCE_CD__)
    unsigned long limit;
    if (!adpcm_voice_snapshot.data_size) return 0u;
    if (adpcm_voice_snapshot.data_size > 65535ul) return 0u;
    if ((unsigned long)adpcm_voice_snapshot.adpcm_address >= 65536ul) return 0u;
    limit = 65536ul - (unsigned long)adpcm_voice_snapshot.adpcm_address;
    if (limit > 65535ul) limit = 65535ul;
    return adpcm_voice_snapshot.data_size <= limit ? 1u : 0u;
#else
    return 0u;
#endif
}

static uint16_t VN_BANKED_CODE adpcm_voice_frame_count(void)
{
#if defined(__PCE_CD__)
    uint8_t divider;
    unsigned long rate;
    unsigned long frames;
    pce_ram_bank130_map();
    divider = adpcm_play_divider(adpcm_voice_snapshot.sample_rate, adpcm_voice_snapshot.divider);
    VN_MAP_BANK130_FOR_CODE();
    rate = (unsigned long)adpcm_code_sample_rate(divider);
    if (!rate) rate = 16000ul;
    frames = ((adpcm_voice_snapshot.data_size * 2ul * VN_ADPCM_FRAME_RATE) + rate - 1ul) / rate;
    frames += VN_ADPCM_END_PAD_FRAMES;
    if (!frames) frames = 1ul;
    if (frames > 65535ul) frames = 65535ul;
    return (uint16_t)frames;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE copy_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    const pce_editor_adpcm_asset_t *voice;
    const unsigned char *voice_data;
    unsigned long voice_data_size;
    unsigned int voice_sample_rate;
    unsigned int voice_adpcm_address;
    unsigned char voice_divider;
    unsigned char voice_loop;
    unsigned char voice_stream;
    if (voice_index < 0) return 0u;
    map_resident_data();
    if ((unsigned int)voice_index >= pce_editor_adpcm_asset_count) return 0u;
    voice = vn_get_adpcm_asset((uint16_t)voice_index);
    voice_data = voice->data;
    voice_data_size = voice->data_size;
    voice_sample_rate = voice->sample_rate;
    voice_adpcm_address = voice->adpcm_address;
    voice_divider = voice->divider;
    voice_loop = voice->loop;
    voice_stream = voice->stream;
    adpcm_voice_snapshot.data = voice_data;
    adpcm_voice_snapshot.data_size = voice_data_size;
    adpcm_voice_snapshot.sample_rate = voice_sample_rate;
    adpcm_voice_snapshot.adpcm_address = voice_adpcm_address;
    adpcm_voice_snapshot.divider = voice_divider;
    adpcm_voice_snapshot.loop = voice_loop;
    adpcm_voice_snapshot.stream = voice_stream;
    map_vn_data();
    adpcm_voice_snapshot.has_cd = (uint8_t)(voice->cd && voice->cd->sector_count);
    if (adpcm_voice_snapshot.has_cd)
    {
        adpcm_voice_snapshot.cd_sector_count = voice->cd->sector_count;
        adpcm_voice_snapshot.cd_sector.lo = voice->cd->sector.lo;
        adpcm_voice_snapshot.cd_sector.md = voice->cd->sector.md;
        adpcm_voice_snapshot.cd_sector.hi = voice->cd->sector.hi;
    }
    else
    {
        adpcm_voice_snapshot.cd_sector_count = 0u;
        adpcm_voice_snapshot.cd_sector.lo = 0u;
        adpcm_voice_snapshot.cd_sector.md = 0u;
        adpcm_voice_snapshot.cd_sector.hi = 0u;
    }
    return 1u;
#else
    (void)voice_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE2 adpcm_playback_active(void)
{
#if defined(__PCE_CD__)
    return adpcm_play_active;
#else
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE wait_adpcm_transfer_ready(void)
{
#if defined(__PCE_CD__)
    uint16_t guard = 65535u;
    while (guard && (pce_cdb_adpcm_status() & ADPCM_BUSY))
    {
        guard--;
    }
    return guard ? 1u : 0u;
#else
    return 0u;
#endif
}

static void VN_BANKED_CODE2 restore_display_after_adpcm(uint8_t restore_display)
{
#if defined(__PCE_CD__)
    restore_video_after_cdb_call(restore_display);
    VN_MAP_BANK130_FOR_CODE();
#else
    (void)restore_display;
#endif
}

static uint8_t VN_BANKED_CODE load_adpcm_voice(signed int voice_index, uint8_t allow_stop_playback, uint8_t allow_stream_asset)
{
#if defined(__PCE_CD__)
    uint8_t loaded = 0u;
    uint8_t same_loaded;
    uint8_t stopped_playback = 0u;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (voice_index < 0) return 0u;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (adpcm_voice_snapshot.stream && !allow_stream_asset) return 0u;
    same_loaded = (uint8_t)(loaded_adpcm_valid && loaded_adpcm_index == (uint16_t)voice_index);
    if (adpcm_playback_active())
    {
        if (!allow_stop_playback) return same_loaded ? 1u : 0u;
        pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
        pce_cdb_adpcm_stop();
        (void)wait_adpcm_transfer_ready();
        adpcm_play_active = 0u;
        adpcm_play_frames_remaining = 0u;
        adpcm_stream_active = 0u;
        adpcm_stream_looping = 0u;
        stopped_playback = 1u;
    }
    if (same_loaded)
    {
        if (stopped_playback)
        {
            sync_cd_external_irq_after_bios_call();
            restore_display_after_adpcm(restore_display);
        }
        return 1u;
    }
    if ((!adpcm_voice_snapshot.data && !adpcm_voice_snapshot.has_cd) || !adpcm_voice_snapshot.data_size) return 0u;
    loaded_adpcm_valid = 0u;
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    if (adpcm_voice_snapshot.has_cd)
    {
        pce_sector_t sector = {0};
        const uint16_t sector_count = adpcm_voice_snapshot.cd_sector_count;
        const uint8_t read_count = sector_count > 255u ? 255u : (uint8_t)sector_count;
        prepare_cd_data_access();
        cd_sector_from_ref(&sector, &adpcm_voice_snapshot.cd_sector);
        loaded = (uint8_t)(!pce_cdb_adpcm_read_from_cd(sector, read_count, adpcm_voice_snapshot.adpcm_address));
    }
    else
    {
        map_resident_data();
        loaded = (uint8_t)(!pce_cdb_adpcm_read_from_ram(PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)adpcm_voice_snapshot.data, adpcm_voice_snapshot.adpcm_address, (uint16_t)adpcm_voice_snapshot.data_size));
    }
    if (!loaded)
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    loaded_adpcm_valid = 1u;
    loaded_adpcm_index = (uint16_t)voice_index;
    resume_cdda_after_cd_data_access();
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    (void)allow_stop_playback;
    (void)allow_stream_asset;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE stream_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    pce_sector_t sector = {0};
    pce_sector_t length = {0};
    uint8_t divider;
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_snapshot.stream || !adpcm_voice_snapshot.has_cd || !adpcm_voice_snapshot.cd_sector_count || !adpcm_voice_snapshot.data_size) return 0u;
    if (adpcm_playback_active())
    {
        pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
        pce_cdb_adpcm_stop();
        (void)wait_adpcm_transfer_ready();
        adpcm_play_active = 0u;
        adpcm_play_frames_remaining = 0u;
    }
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    loaded_adpcm_valid = 0u;
    prepare_cd_data_access();
    pce_cdb_adpcm_reset();
    if (!wait_adpcm_transfer_ready())
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    cd_sector_from_ref(&sector, &adpcm_voice_snapshot.cd_sector);
    cd_sector_from_uint(&length, (unsigned long)adpcm_voice_snapshot.cd_sector_count);
    divider = adpcm_play_divider(adpcm_voice_snapshot.sample_rate, adpcm_voice_snapshot.divider);
    if (pce_cdb_adpcm_stream(sector, length, divider))
    {
        map_resident_data();
        resume_cdda_after_cd_data_access();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    cancel_cdda_after_cd_data_conflict();
    adpcm_play_active = 1u;
    adpcm_play_frames_remaining = adpcm_voice_frame_count();
    adpcm_stream_active = 1u;
    adpcm_stream_looping = adpcm_voice_snapshot.loop ? 1u : 0u;
    adpcm_stream_index = (uint16_t)voice_index;
    pad_edge_reset_pending = 1u;
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    return 0u;
#endif
}

static uint8_t VN_BANKED_CODE play_adpcm_buffered_voice(signed int voice_index, uint8_t restore_display)
{
#if defined(__PCE_CD__)
    uint8_t divider;
    if (!copy_adpcm_voice(voice_index)) return 0u;
    if (!adpcm_voice_fits_buffer()) return 0u;
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    if (!load_adpcm_voice(voice_index, 1u, 1u))
    {
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    divider = adpcm_play_divider(adpcm_voice_snapshot.sample_rate, adpcm_voice_snapshot.divider);
    if (pce_cdb_adpcm_play(adpcm_voice_snapshot.adpcm_address, (uint16_t)adpcm_voice_snapshot.data_size, divider, adpcm_voice_snapshot.loop ? PCE_CDB_ADPCM_REPEAT : PCE_CDB_ADPCM_ONE_SHOT))
    {
        loaded_adpcm_valid = 0u;
        map_resident_data();
        sync_cd_external_irq_after_bios_call();
        restore_display_after_adpcm(restore_display);
        return 0u;
    }
    map_resident_data();
    /*
     * Buffered one-shot playback does not need BIOS status polling.
     * Polling ADPCM status through the end of short voices can leave the
     * EmulatorJS mednafen_pce core unable to deliver joypad edges afterward.
     */
    adpcm_play_active = 1u;
    adpcm_play_frames_remaining = adpcm_voice_snapshot.loop ? 0u : adpcm_voice_frame_count();
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    adpcm_stream_index = (uint16_t)voice_index;
    /*
     * Buffered playback does not need the System Card external IRQ after the
     * play command has been accepted. Leaving it enabled lets the BIOS run
     * asynchronously during our own VDC updates; non-loop voices also do not need
     * the completion IRQ because the runtime counts frames itself.
     */
    sync_cd_external_irq_after_bios_call();
    pad_edge_reset_pending = 1u;
    restore_display_after_adpcm(restore_display);
    return 1u;
#else
    (void)voice_index;
    (void)restore_display;
    return 0u;
#endif
}

static void VN_BANKED_CODE play_adpcm_voice(signed int voice_index)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    if (!copy_adpcm_voice(voice_index)) return;
    if (adpcm_voice_snapshot.stream)
    {
        /* A stream:true asset is streamed from CD ONLY when it is too large to fit
           the ADPCM RAM buffer. True CD streaming (pce_cdb_adpcm_stream / AD_STRM)
           relies on the asynchronous BIOS external IRQ to keep feeding the ADPCM
           ring buffer from CD, which conflicts with this runtime owning VBlank/VDC
           directly via status polling and no VBlank IRQ. The resulting buffer underruns
           produce noise, the drive reads on into the next asset's sectors (a
           "different voice" starting mid-playback), and the CD engine eventually
           hangs. Voices that fit the buffer use the hardened buffered path, which
           loads once and plays from ADPCM RAM with no ongoing CD IRQ. */
        if (adpcm_voice_fits_buffer())
        {
            (void)play_adpcm_buffered_voice(voice_index, restore_display);
            return;
        }
        if (adpcm_voice_snapshot.has_cd && adpcm_voice_snapshot.cd_sector_count)
        {
            (void)stream_adpcm_voice(voice_index);
            return;
        }
        return;
    }
    (void)play_adpcm_buffered_voice(voice_index, restore_display);
#else
    (void)voice_index;
#endif
}

static void VN_BANKED_CODE stop_adpcm_voice(void)
{
#if defined(__PCE_CD__)
    const uint8_t restore_display = (uint8_t)!pending_display_enable;
    pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL);
    pce_cdb_adpcm_stop();
    (void)wait_adpcm_transfer_ready();
    pce_cdb_adpcm_reset();
    (void)wait_adpcm_transfer_ready();
    loaded_adpcm_valid = 0u;
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    sync_cd_external_irq_after_bios_call();
    restore_display_after_adpcm(restore_display);
#endif
}

static void VN_BANKED_CODE2 service_adpcm_playback(void)
{
#if defined(__PCE_CD__)
    if (!adpcm_play_active) return;
    if (!adpcm_play_frames_remaining) return;
    adpcm_play_frames_remaining--;
    if (adpcm_play_frames_remaining) return;
    if (adpcm_stream_active && adpcm_stream_looping)
    {
        (void)stream_adpcm_voice((signed int)adpcm_stream_index);
        return;
    }
    /*
     * Natural one-shot/stream completion is not closed with ADPCM status,
     * stop, or reset. The EmulatorJS mednafen_pce core can stop delivering
     * joypad edges after those natural-completion probes. Explicit AUDIO stop
     * still uses stop_adpcm_voice(), which performs the full hardware stop/reset
     * sequence.
     */
    adpcm_play_active = 0u;
    adpcm_play_frames_remaining = 0u;
    adpcm_stream_active = 0u;
    adpcm_stream_looping = 0u;
    sync_cd_external_irq_after_bios_call();
#endif
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

/* PC Engine noise generator lives on channels 4/5 only (PSG R7). The step's
   period field carries the 5-bit noise frequency for noise entries. */
static void VN_BANKED_CODE2 psg_set_noise(uint8_t channel, uint8_t noise_freq, uint8_t volume)
{
    PCE_PSG_SELECT = (uint8_t)(channel & 0x07u);
    PCE_PSG_BALANCE = 0xffu;
    PCE_PSG_NOISE = volume ? (uint8_t)(0x80u | (noise_freq & 0x1fu)) : 0u;
    PCE_PSG_CONTROL = volume ? (uint8_t)(0x80u | (volume & 0x1fu)) : 0u;
}

static uint8_t VN_BANKED_CODE2 psg_frames_per_step(const pce_editor_psg_asset_t *asset)
{
    uint16_t bpm = (asset && asset->bpm) ? asset->bpm : 150u;
    uint16_t frames = (uint16_t)(3600u / (bpm * 4u));
    if (frames < 2u) frames = 2u;
    if (frames > 24u) frames = 24u;
    return (uint8_t)frames;
}

static uint8_t VN_BANKED_CODE2 psg_resolve_channel(uint8_t base, uint8_t step_channel)
{
    uint16_t ch = (uint16_t)base + (uint16_t)step_channel;
    if (ch > 5u) ch = 5u;
    return (uint8_t)ch;
}

static void VN_BANKED_CODE2 psg_apply_step_entry(const pce_editor_psg_step_t *step, uint16_t step_no)
{
    if (step->step == step_no)
    {
        const uint8_t ch = psg_resolve_channel(psg_base_channel, step->channel);
        psg_used_mask = (uint8_t)(psg_used_mask | (uint8_t)(1u << ch));
        if (step->noise && ch >= 4u)
            psg_set_noise(ch, (uint8_t)(step->period & 0x1fu), step->volume);
        else
            psg_set_voice(ch, step->period, step->volume);
    }
}

static void VN_BANKED_CODE2 psg_apply_step_row(uint16_t step_no)
{
    uint16_t i;
    const pce_editor_psg_step_t *pattern = psg_active_pattern;
    if (!psg_current || !pattern) return;
#if defined(__PCE_CD__)
    /* CD-streamed patterns live in bank134/bank135; map MPR6 to the bank that
       owns the current half before reading. Small resident patterns are in
       .rodata and need no mapping. */
    if (psg_pattern_banked)
    {
        uint16_t first_count = psg_current->pattern_count;
        if (first_count > VN_PSG_PATTERN_BANK_ENTRIES) first_count = VN_PSG_PATTERN_BANK_ENTRIES;
        pce_ram_bank134_map();
        pattern = (const pce_editor_psg_step_t *)psg_pattern_ram;
        for (i = 0u; i < first_count; i++)
        {
            psg_apply_step_entry(&pattern[i], step_no);
        }
        if (psg_current->pattern_count > VN_PSG_PATTERN_BANK_ENTRIES)
        {
            const uint16_t second_count = (uint16_t)(psg_current->pattern_count - VN_PSG_PATTERN_BANK_ENTRIES);
            pce_ram_bank135_map();
            pattern = (const pce_editor_psg_step_t *)psg_pattern_ram;
            for (i = 0u; i < second_count; i++)
            {
                psg_apply_step_entry(&pattern[i], step_no);
            }
        }
        return;
    }
#endif
    for (i = 0u; i < psg_current->pattern_count; i++)
    {
        const pce_editor_psg_step_t *step = &pattern[i];
        psg_apply_step_entry(step, step_no);
    }
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
    psg_frame = 0u;
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
static uint8_t VN_BANKED_CODE2 load_psg_pattern_cd(const pce_editor_psg_asset_t *asset)
{
    pce_editor_cd_data_ref_t ref;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t offset = 0u;
    uint16_t bank_remaining;
    if (!asset->pattern_cd) return 0u;
    map_vn_data();              /* MPR6 = bank132: read the CD ref descriptor. */
    ref = *asset->pattern_cd;
    if (!ref.byte_size || ref.byte_size > VN_PSG_PATTERN_BUFFER_BYTES || !ref.sector_count) return 0u;
    prepare_cd_data_access();
    sector.lo = ref.sector.lo;
    sector.md = ref.sector.md;
    sector.hi = ref.sector.hi;
    remaining = ref.byte_size;
    pce_ram_bank134_map();      /* MPR6 = bank134: first CD read destination. */
    bank_remaining = remaining > VN_PSG_PATTERN_BANK_BYTES ? VN_PSG_PATTERN_BANK_BYTES : remaining;
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
    if (remaining)
    {
        offset = 0u;
        pce_ram_bank135_map();  /* MPR6 = bank135: overflow pattern entries. */
        while (remaining)
        {
            const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
            (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, (uint16_t)(uintptr_t)&psg_pattern_ram[offset], chunk);
            cd_transfer_wait();
            remaining = (uint16_t)(remaining - chunk);
            offset = (uint16_t)(offset + chunk);
            cd_sector_advance(&sector);
        }
    }
    sync_cd_external_irq_after_bios_call();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
    return 1u;
}
#endif

static void VN_BANKED_CODE2 play_psg_asset(signed int asset_index, uint8_t base_channel)
{
    uint8_t ch;
    if (asset_index < 0 || (unsigned int)asset_index >= pce_editor_psg_asset_count) return;
    stop_psg();
    psg_current = vn_get_psg_asset((uint16_t)asset_index);
    psg_base_channel = base_channel > 5u ? 5u : base_channel;
    psg_is_song = psg_current->is_song ? 1u : 0u;
    psg_step = 0u;
    psg_frame = 0u;
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
        if (!load_psg_pattern_cd(psg_current))
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
}

static void VN_BANKED_CODE2 tick_psg(void)
{
    uint8_t frames_per_step;
    if (!psg_active || !psg_current) return;
    psg_frame++;
    frames_per_step = psg_frames_per_step(psg_current);
    if (psg_frame < frames_per_step) return;
    psg_frame = 0u;
    psg_step++;
    if (psg_step >= psg_current->steps)
    {
        if (psg_is_song)
        {
            psg_step = 0u;
        }
        else
        {
            stop_psg();
            return;
        }
    }
    psg_apply_step_row(psg_step);
}

static void VN_RESIDENT_CODE service_psg_during_blocking_work(void)
{
#if defined(__PCE_CD__)
    if (!psg_active || !psg_current) return;
    pce_ram_bank130_map();
    tick_psg();
    /* Large PSG patterns are read from bank134/135 through MPR6. Most blocking
       CD/BG loaders resume by reading bank132 scratch or metadata, so leave that
       slot in the VN data state after the cooperative audio tick. */
    map_vn_data();
    VN_MAP_BANK130_FOR_CODE();
#endif
}

static void VN_RESIDENT_CODE service_psg_during_blocking_frames(uint8_t frames)
{
    while (frames--)
    {
        service_psg_during_blocking_work();
    }
}

static void VN_RESIDENT_CODE service_psg_during_visual_cache_work(void)
{
#if defined(__PCE_CD__)
    if (!psg_active || !psg_current) return;
    pce_ram_bank130_map();
    tick_psg();
    map_vn_data();
    VN_MAP_VISUAL_CACHE_CODE();
#endif
}

static void VN_RESIDENT_CODE service_psg_during_visual_cache_frames(uint8_t frames)
{
    while (frames--)
    {
        service_psg_during_visual_cache_work();
    }
}

static void show_scene(uint8_t scene_index)
{
#if PCE_VN_HAS_FULL_SCREEN_BG
    uint8_t i;
    uint8_t previous_full_screen_bg;
#endif
    uint8_t keep_display_for_transition;
    uint8_t use_preloaded_scene_visual;
    map_vn_data();
    if (!pce_vn_scene_count) return;
    if (scene_index >= pce_vn_scene_count) scene_index = pce_vn_start_scene;
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
        display_disable();
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
            sprite_slots[i].anim_frame_delays = (const uint8_t *)0;
        }
    }
#endif
    clear_spritetext_slots();
#if PCE_VN_HAS_FULL_SCREEN_BG
    pending_scene_sprite_clear = current_scene_full_screen_bg ? 1u : 0u;
#else
    pending_scene_sprite_clear = 0u;
#endif
    VN_MAP_BANK130_FOR_CODE();
    REQUEST_SPRITE_REFRESH_FULL();
    /* Assets load on demand as run_commands_until_wait() processes each command
       (set_background / sprite show / play_adpcm_voice all stream from CD at the
       command). The old scene-entry preload pass was a redundant pre-scan and is
       gone; set_background still self-caches the current BG to skip re-uploads. */
    preloaded_scene_visual_valid = 0u;
    end_cdda_deferred_resume();
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
static uint8_t VN_BANKED_CODE2 draw_spritetext_slots(uint8_t satb_index)
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
        uint8_t col = 0u;
        uint8_t row = 0u;
        uint8_t i;
        if (!slot->visible || !slot->glyph_count) continue;
        if (slot->blink_frames && !slot->blink_on) continue;
        vce_write_color((uint16_t)(256u + (PCE_VN_FONT_SPRITE_PALETTE_BANK * 16u) + 15u), slot->color);
        for (i = 0u; i < slot->glyph_count; i++)
        {
            const uint8_t glyph = slot->glyphs[i];
            vdc_sprite_t *entry;
            if (glyph == VN_SPRITETEXT_GLYPH_NEWLINE)
            {
                col = 0u;
                row++;
                continue;
            }
            if ((uint8_t)(satb_index + written) >= 64u) return written;
            entry = &sprite_shadow[(uint8_t)(satb_index + written)];
            entry->x = (uint16_t)((int16_t)slot->x + ((uint16_t)col * 16u) + 32 + screen_shake_x);
            entry->y = (uint16_t)((int16_t)slot->y + ((uint16_t)row * 16u) + 64 + screen_shake_y);
            entry->pattern = (uint16_t)(PCE_VN_FONT_SPRITE_PATTERN_BASE + ((uint16_t)glyph * 2u));
            entry->attr = attr;
            written++;
            col++;
        }
    }
#else
    (void)satb_index;
#endif
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
        pce_vn_sprite_anim_t animation_value;
        uint8_t satb_index;
        uint8_t expected_count;
        uint8_t written;
        expected_count = sprite_satb_slot_count[i];
        if (!expected_count) continue;
        if (!sprite_slot_pattern_valid[i]) return 0u;
        if (!slot->visible || slot->sprite_index < 0) return 0u;
        if (slot->animation_index < 0 || slot->anim_frame_count <= 1u) continue;
        animation_value.sprite_index = (unsigned int)slot->sprite_index;
        animation_value.first_cell = slot->anim_first_cell;
        animation_value.frame_count = slot->anim_frame_count;
        animation_value.frame_delay = slot->anim_frame_delay;
        animation_value.frame_width_cells = slot->anim_frame_width_cells;
        animation_value.frame_height_cells = slot->anim_frame_height_cells;
        animation_value.frame_stride_cells = slot->anim_frame_stride_cells;
        animation_value.loop = slot->anim_loop;
        animation_value.frame_delays = slot->anim_frame_delays;
        satb_index = sprite_satb_slot_start[i];
        written = show_character_sprite_frame(
            satb_index,
            &sprite_slot_draw_meta[i],
            sprite_slot_cell_map[i],
            &animation_value,
            slot->frame,
            (int16_t)((int16_t)slot->x + screen_shake_x),
            (int16_t)((int16_t)slot->y + screen_shake_y),
            slot->flags
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

static uint8_t VN_BANKED_CODE refresh_scene_sprite_patterns(void)
{
#if defined(__PCE_CD__)
    uint8_t result;
    map_vn_data();
    pce_ram_bank133_map();
    result = refresh_scene_sprite_patterns_impl();
    pce_ram_bank130_map();
    return result;
#else
    return refresh_scene_sprite_patterns_impl();
#endif
}

static void VN_BANKED_CODE refresh_scene_sprites(void)
{
    uint8_t i;
    uint8_t satb_index = 0u;
    const uint8_t display_active = (uint8_t)!pending_display_enable;
    uint8_t requires_safe_hide = 0u;
    uint16_t next_pattern_base = PCE_VN_SPRITE_PATTERN_BASE;
    uint8_t next_palette_bank = 0u;
    uint8_t next_palette_bank_valid = 0u;
    uint8_t sprite_pattern_capacity_exhausted = 0u;
    uint8_t sprite_palette_capacity_exhausted = 0u;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    if (pending_sprite_refresh == VN_SPRITE_REFRESH_PATTERNS && refresh_scene_sprite_patterns())
    {
        pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
        return;
    }
#endif
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
        sprite = vn_get_sprite_asset((uint16_t)slot->sprite_index);
        pattern_units = sprite_pattern_units_for_ref(&sprite->patterns);
        if (!pattern_units)
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
    clear_sprites();
    if (display_active && requires_safe_hide)
    {
        sprite_layer_disable();
        upload_sprite_table();
        delay_frame();
    }
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = &sprite_slots[i];
        pce_editor_sprite_draw_meta_t draw_meta;
        pce_editor_data_ref_t sprite_palette;
        pce_editor_data_ref_t sprite_patterns;
        const pce_vn_sprite_anim_t *animation = 0;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
        pce_vn_sprite_anim_t animation_value;
#endif
        const pce_editor_sprite_asset_t *sprite;
        const uint8_t *sprite_cell_map;
        uint16_t sprite_index;
        if (!sprite_slot_pattern_valid[i]) continue;
        if (!slot->visible || slot->sprite_index < 0) continue;
        map_resident_data();
        if ((unsigned int)slot->sprite_index >= pce_editor_sprite_asset_count) continue;
        sprite_index = (uint16_t)slot->sprite_index;
        sprite = vn_get_sprite_asset(sprite_index);
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
#if PCE_VN_HAS_SPRITE_ANIMATIONS
        if (slot->animation_index >= 0 && slot->anim_frame_count)
        {
            animation_value.sprite_index = (unsigned int)sprite_index;
            animation_value.first_cell = slot->anim_first_cell;
            animation_value.frame_count = slot->anim_frame_count;
            animation_value.frame_delay = slot->anim_frame_delay;
            animation_value.frame_width_cells = slot->anim_frame_width_cells;
            animation_value.frame_height_cells = slot->anim_frame_height_cells;
            animation_value.frame_stride_cells = slot->anim_frame_stride_cells;
            animation_value.loop = slot->anim_loop;
            animation_value.frame_delays = slot->anim_frame_delays;
            animation = &animation_value;
        }
#endif
        /* pce_vn_sprite_animations and sprite asset metadata live in banked
           CD RAM (bank132 / resident). The copies above must complete while those
           banks are still mapped: upload_palette / ensure_sprite_patterns_loaded
           remap MPR slots, and at -Oz the compiler would otherwise sink these
           const-data loads past those calls and read them from the wrong bank.
           That made the sprite draw as the whole sheet (use_animation_frame read
           garbage) with a mis-addressed pattern base. This barrier pins the
           snapshot before the remaps. */
        __asm__ volatile("" ::: "memory");
        upload_palette(&sprite_palette, (uint16_t)(256u + (draw_meta.palette_bank * 16u)), 1);
        loaded_sprite_palette_bank[i] = draw_meta.palette_bank;
        (void)ensure_sprite_patterns_loaded(i, sprite_index, &sprite_patterns, draw_meta.pattern_base, sprite_pattern_units_for_ref(&sprite_patterns));
        {
            uint8_t written;
            sprite_satb_slot_start[i] = satb_index;
            written = call_overlay_show_character_sprite_frame(
                satb_index,
                &draw_meta,
                sprite_cell_map,
                animation,
                slot->frame,
                (int16_t)((int16_t)slot->x + screen_shake_x),
                (int16_t)((int16_t)slot->y + screen_shake_y),
                slot->flags
            );
            sprite_satb_slot_count[i] = written;
            satb_index = (uint8_t)(satb_index + written);
        }
    }
    VN_MAP_BANK130_FOR_CODE();
    satb_index = (uint8_t)(satb_index + draw_spritetext_slots(satb_index));
    sprite_satb_layout_valid = 1u;
    upload_sprite_table();
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        if (!sprite_slot_pattern_valid[i]) loaded_sprite_pattern_valid[i] = 0u;
    }
    if (display_active && requires_safe_hide)
    {
        sprite_layer_enable();
        delay_frame();
    }
    pending_sprite_refresh = VN_SPRITE_REFRESH_NONE;
}

static void VN_BANKED_CODE2 cache_sprite_animation(uint8_t slot_index)
{
    vn_sprite_slot_t *slot;
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    pce_vn_sprite_anim_t animation;
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
    animation = pce_vn_sprite_animations[(unsigned int)slot->animation_index];
    if (animation.sprite_index != (unsigned int)slot->sprite_index) return;
    slot->anim_frame_count = animation.frame_count;
    slot->anim_frame_delay = animation.frame_delay;
    slot->anim_loop = animation.loop;
    slot->anim_first_cell = animation.first_cell;
    slot->anim_frame_width_cells = animation.frame_width_cells;
    slot->anim_frame_height_cells = animation.frame_height_cells;
    slot->anim_frame_stride_cells = animation.frame_stride_cells;
    slot->anim_frame_delays = animation.frame_delays;
#endif
}

static void tick_sprite_animations(void)
{
#if PCE_VN_HAS_SPRITE_ANIMATIONS
    uint8_t i;
    uint8_t changed = 0u;
    for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
    {
        vn_sprite_slot_t *slot = &sprite_slots[i];
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

static void clear_spritetext_slots(void)
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

static signed char shake_offset_for_frame(uint8_t frame, uint8_t intensity)
{
    switch (frame & 3u)
    {
        case 0u: return (signed char)intensity;
        case 1u: return (signed char)(-((signed char)intensity));
        case 2u: return (signed char)(intensity >> 1u);
        default: return (signed char)(-((signed char)(intensity >> 1u)));
    }
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

/* The glyph compositor (draw_message_glyph_at, bank133 overlay) does a VDC mask read
   plus a composited-tile VDC write per glyph -- the same non-reentrant VDC sequence as the
   sprite SATB rewrite. It runs while a voiced ADPCM plays (external IRQ enabled), so an
   IRQ landing mid-write clobbers the MAWR and sprays glyph tile data outside the message
   window (UI-frame / BG noise at message-draw timing). Mask IRQs around the whole
   bank133 swap + message draw + bank130 restore sequence: an IRQ must never observe
   slot4 while bank133 is mapped. These wrappers are resident (bank128); no CD read
   happens inside, so deferring CD/ADPCM IRQs by that span is safe. */
static uint8_t VN_RESIDENT_CODE draw_message_next_glyph_locked(const pce_vn_message_t *message)
{
    uint8_t complete;
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    complete = draw_message_next_glyph(message);
    pce_ram_bank130_map();
    vn_vdc_irq_unlock(irq);
#else
    uint8_t irq = vn_vdc_irq_lock();
    complete = draw_message_next_glyph(message);
    vn_vdc_irq_unlock(irq);
#endif
    return complete;
}

static uint8_t VN_RESIDENT_CODE draw_message_prefix_glyphs_locked(const pce_vn_message_t *message)
{
    uint8_t complete;
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    complete = draw_message_prefix_glyphs(message);
    pce_ram_bank130_map();
    vn_vdc_irq_unlock(irq);
#else
    uint8_t irq = vn_vdc_irq_lock();
    complete = draw_message_prefix_glyphs(message);
    vn_vdc_irq_unlock(irq);
#endif
    return complete;
}

static void VN_RESIDENT_CODE draw_message_text_locked(const pce_vn_message_t *message)
{
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    draw_message_text(message);
    pce_ram_bank130_map();
    vn_vdc_irq_unlock(irq);
#else
    uint8_t irq = vn_vdc_irq_lock();
    draw_message_text(message);
    vn_vdc_irq_unlock(irq);
#endif
}

static void VN_RESIDENT_CODE call_overlay_preload_message_glyph_masks(const pce_vn_message_t *message)
{
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    preload_message_glyph_masks(message);
    pce_ram_bank130_map();
    vn_vdc_irq_unlock(irq);
#else
    preload_message_glyph_masks(message);
#endif
}

static void VN_RESIDENT_CODE call_overlay_draw_message_glyph_at(uint16_t glyph, uint8_t col, uint8_t row)
{
#if defined(__PCE_CD__)
    uint8_t irq = vn_vdc_irq_lock();
    pce_ram_bank133_map();
    draw_message_glyph_at(glyph, col, row);
    pce_ram_bank130_map();
    vn_vdc_irq_unlock(irq);
#else
    draw_message_glyph_at(glyph, col, row);
#endif
}

static void VN_BANKED_CODE show_message_wait_indicator(void)
{
    message_wait_indicator_state = 1u;
    message_frame_timer = 0u;
    map_message_wait_indicator_cell(0u);
    call_overlay_draw_message_glyph_at(PCE_VN_MESSAGE_WAIT_GLYPH, VN_WAIT_CURSOR_COL, VN_WAIT_CURSOR_ROW);
}

static void VN_BANKED_CODE hide_message_wait_indicator(void)
{
    if (message_wait_indicator_state)
    {
        map_message_wait_indicator_cell(1u);
        message_frame_timer = 0u;
    }
    message_wait_indicator_state = 0u;
}

static void VN_BANKED_CODE refresh_message_wait_indicator(void)
{
    if (active_message_index < 0
        || !message_complete
        || active_message_state.advance_mode != PCE_VN_ADVANCE_BUTTON)
    {
        hide_message_wait_indicator();
        return;
    }
    if (!message_wait_indicator_state) show_message_wait_indicator();
}

static void VN_BANKED_CODE tick_message_wait_indicator(void)
{
    if (active_message_index < 0
        || !message_complete
        || active_message_state.advance_mode != PCE_VN_ADVANCE_BUTTON)
    {
        hide_message_wait_indicator();
        return;
    }
    if (!message_wait_indicator_state)
    {
        show_message_wait_indicator();
        return;
    }
    message_frame_timer++;
    if (message_frame_timer < VN_WAIT_CURSOR_BLINK_FRAMES) return;
    message_frame_timer = 0u;
    if (message_wait_indicator_state == 2u)
    {
        show_message_wait_indicator();
    }
    else
    {
        message_wait_indicator_state = 2u;
        map_message_wait_indicator_cell(1u);
    }
}

static uint8_t VN_BANKED_CODE2 begin_message_window_vram_update(void)
{
#if defined(__PCE_CD__)
    if (pending_display_enable)
    {
        map_message_window_cells(0u);
        return 0u;
    }
    vn_wait_next_vblank();
    map_message_window_cells(1u);
    return 1u;
#elif defined(__PCE__)
    map_message_window_cells(0u);
    return 0u;
#else
    return 0u;
#endif
}

static void VN_BANKED_CODE2 end_message_window_vram_update(uint8_t restore_display)
{
#if defined(__PCE__) || defined(__PCE_CD__)
    if (!restore_display) return;
    vn_wait_next_vblank();
    map_message_window_cells(0u);
    delay_frame();
#else
    (void)restore_display;
#endif
}

static void start_message(uint8_t message_index)
{
    pce_vn_message_t *message = VN_MESSAGE_SCRATCH;
    uint8_t restore_window_display = 0u;
    uint8_t mouth_slot = 0u;
    uint8_t instant_glyph_count = 0u;
    VN_MAP_BANK130_FOR_CODE();
    if (scene_pack_read_message(&active_scene_pack, message_index, message))
    {
        active_message_state = *message;
        message = &active_message_state;
        mouth_slot = VN_MESSAGE_MOUTH_SLOT(message->mouth_slot);
        instant_glyph_count = VN_MESSAGE_INSTANT_GLYPH_COUNT(message->mouth_slot);
        active_message_index = message_index;
        active_choice_index = -1;
        wait_frames_remaining = 0u;
        message_glyph_pos = 0u;
        message_glyph_byte = 0u;
        message_frame_timer = 0u;
        message_col = 0u;
        message_row = 0u;
        message_complete = 0u;
        message_auto_wait = message->auto_wait_frames;
        message_wait_indicator_state = 0u;
        apply_message_text_color(message->text_color);
        if (message->mouth_animation_index >= 0 && mouth_slot < VN_SPRITE_SLOT_COUNT)
        {
            sprite_slots[mouth_slot].animation_index = message->mouth_animation_index;
            sprite_slots[mouth_slot].frame = 0u;
            sprite_slots[mouth_slot].timer = 0u;
            cache_sprite_animation(mouth_slot);
            REQUEST_SPRITE_REFRESH_FULL();
        }
        message_text_speed = message->text_speed_frames;
        restore_window_display = begin_message_window_vram_update();
        clear_window_tile_pixels();
        call_overlay_preload_message_glyph_masks(message);
        if (instant_glyph_count)
        {
            VN_MAP_BANK130_FOR_CODE();
            message_complete = draw_message_prefix_glyphs_locked(message);
        }
        play_adpcm_voice(message->voice_index);
        VN_MAP_BANK130_FOR_CODE();
        if (!message_complete && !message_text_speed)
        {
            VN_MAP_BANK130_FOR_CODE();
            if (instant_glyph_count)
            {
                while (!message_complete)
                {
                    message_complete = draw_message_next_glyph_locked(message);
                }
            }
            else
            {
                draw_message_text_locked(message);
                message_complete = 1u;
            }
        }
        else if (!message_complete)
        {
            VN_MAP_BANK130_FOR_CODE();
            message_complete = draw_message_next_glyph_locked(message);
        }
        end_message_window_vram_update(restore_window_display);
        refresh_message_wait_indicator();
        if (!restore_window_display && !pending_display_enable) delay_frame();
    }
}

static void finish_active_message(void)
{
    if (active_message_index < 0) return;
    VN_MAP_BANK130_FOR_CODE();
    while (!message_complete)
    {
        message_complete = draw_message_next_glyph_locked(&active_message_state);
    }
    refresh_message_wait_indicator();
}

static void tick_active_message(void)
{
    if (active_message_index < 0 || message_complete) return;
    if (!message_text_speed)
    {
        finish_active_message();
        return;
    }
    message_frame_timer++;
    if (message_frame_timer < message_text_speed) return;
    message_frame_timer = 0u;
    VN_MAP_BANK130_FOR_CODE();
    message_complete = draw_message_next_glyph_locked(&active_message_state);
    if (message_complete) refresh_message_wait_indicator();
}

static void hide_sprites_for_asset_load(void)
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

static void VN_BANKED_CODE2 draw_choice_options(void)
{
    uint8_t row;
    uint8_t restore_window_display;
    vn_choice_ref_t *choice = VN_CHOICE_SCRATCH;
    if (active_choice_index < 0) return;
    if (!scene_pack_read_choice(&active_scene_pack, (uint8_t)active_choice_index, choice)) return;
    /* Choices always use the default UI text color, not a prior message's tint. */
    apply_message_text_color(PCE_VN_MESSAGE_COLOR_NONE);
    restore_window_display = begin_message_window_vram_update();
    clear_window_tile_pixels();
    for (row = 0u; row < choice->option_count && row < VN_TEXT_ROWS; row++)
    {
        uint8_t col;
        uint16_t pos = 0u;
        pce_vn_choice_option_t *option = VN_CHOICE_OPTION_SCRATCH;
        if (!scene_pack_read_choice_option(&active_scene_pack, choice, row, option)) continue;
        call_overlay_draw_message_glyph_at(row == choice_selected_index ? PCE_VN_CHOICE_CURSOR_GLYPH : 0u, 0u, row);
        for (col = 0u; col < option->glyph_count && col + 1u < VN_TEXT_COLS; col++)
        {
            const uint16_t glyph = vn_glyph_decode(option->glyphs, pos);
            pos = (uint16_t)(pos + vn_glyph_stride(option->glyphs, pos));
            if (glyph == PCE_VN_GLYPH_END) break;
            call_overlay_draw_message_glyph_at(glyph, (uint8_t)(col + 1u), row);
        }
    }
    end_message_window_vram_update(restore_window_display);
    if (!restore_window_display && !pending_display_enable) delay_frame();
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
        if (!restore_window_display && !pending_display_enable) delay_frame();
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
            clear_bg_map_region(vn_get_bg_asset((uint16_t)current_bg_index), current_bg_x, current_bg_y);
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

#if defined(__PCE_CD__) && VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void VN_VISUAL_CACHE_CODE load_bg_cache_asset_impl(signed int bg_index, uint8_t tile_x, uint8_t tile_y)
{
    const pce_editor_bg_asset_t *bg;
    pce_editor_data_ref_t bg_tiles;
    if (bg_index < 0) return;
    if ((unsigned int)bg_index >= pce_editor_bg_asset_count) return;
    (void)tile_x;
    (void)tile_y;
    map_resident_data();
    bg = vn_get_bg_asset((uint16_t)bg_index);
    SNAPSHOT_DATA_REF(bg_tiles, bg->tiles);
    visual_cache_preload_ref_impl(VN_VISUAL_CACHE_KIND_BG_TILES, (uint16_t)bg_index, &bg_tiles);
    preloaded_scene_visual_valid = 0u;
}

static void VN_VISUAL_CACHE_CODE load_sprite_pattern_cache_asset_impl(signed int sprite_index, uint8_t slot_index)
{
    const pce_editor_sprite_asset_t *sprite;
    pce_editor_data_ref_t sprite_patterns;
    if (sprite_index < 0) return;
    if ((unsigned int)sprite_index >= pce_editor_sprite_asset_count) return;
    (void)slot_index;
    map_resident_data();
    sprite = vn_get_sprite_asset((uint16_t)sprite_index);
    SNAPSHOT_DATA_REF(sprite_patterns, sprite->patterns);
    visual_cache_preload_ref_impl(VN_VISUAL_CACHE_KIND_SPRITE_PATTERNS, (uint16_t)sprite_index, &sprite_patterns);
}

static void VN_BANKED_CODE load_bg_cache_asset(signed int bg_index, uint8_t tile_x, uint8_t tile_y)
{
    if (bg_index < 0) return;
    load_visual_cache_code();
    vn_visual_cache_arg_asset = (uint16_t)bg_index;
    vn_visual_cache_arg_x = tile_x;
    vn_visual_cache_arg_y = tile_y;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_LOAD_BG);
    load_overlay_code();
}

static void VN_BANKED_CODE load_sprite_pattern_cache_asset(signed int sprite_index, uint8_t slot_index)
{
    if (sprite_index < 0) return;
    load_visual_cache_code();
    vn_visual_cache_arg_asset = (uint16_t)sprite_index;
    vn_visual_cache_arg_slot = slot_index;
    (void)visual_cache_call(VN_VISUAL_CACHE_OP_LOAD_SPRITE);
    load_overlay_code();
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
    (void)load_adpcm_voice(voice_index, 1u, 0u);
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
}

static void VN_BANKED_CODE clear_runtime_cache(uint8_t scope)
{
    uint8_t i;
    if (scope > PCE_VN_CACHE_SCOPE_ALL) scope = PCE_VN_CACHE_SCOPE_VISUAL;
    if (scope == PCE_VN_CACHE_SCOPE_VISUAL
        || scope == PCE_VN_CACHE_SCOPE_BG
        || scope == PCE_VN_CACHE_SCOPE_ALL)
    {
        preloaded_bg_valid = 0u;
        preloaded_scene_visual_valid = 0u;
    }
    if (scope == PCE_VN_CACHE_SCOPE_VISUAL
        || scope == PCE_VN_CACHE_SCOPE_SPRITE
        || scope == PCE_VN_CACHE_SCOPE_ALL)
    {
        for (i = 0u; i < VN_SPRITE_SLOT_COUNT; i++)
        {
            loaded_sprite_pattern_valid[i] = 0u;
        }
        preloaded_scene_visual_valid = 0u;
    }
#if defined(__PCE_CD__)
    if (scope == PCE_VN_CACHE_SCOPE_VISUAL
        || scope == PCE_VN_CACHE_SCOPE_BG
        || scope == PCE_VN_CACHE_SCOPE_SPRITE
        || scope == PCE_VN_CACHE_SCOPE_ALL)
    {
        visual_cache_invalidate(scope);
    }
#endif
    if (scope == PCE_VN_CACHE_SCOPE_ADPCM
        || scope == PCE_VN_CACHE_SCOPE_ALL)
    {
        loaded_adpcm_valid = 0u;
    }
    if (scope == PCE_VN_CACHE_SCOPE_ALL)
    {
#if defined(__PCE_CD__)
        message_glyph_cache_valid = 0u;
#endif
    }
}

static uint8_t VN_BANKED_CODE execute_command(const pce_vn_command_t *command)
{
    uint8_t slot;
    if (!command) return VN_EXEC_CONTINUE;
    if (command->type == PCE_VN_COMMAND_BACKGROUND)
    {
        set_background(command->asset_index, command->flags, command->arg0, command->arg1, command->x, command->y);
    }
    else if (command->type == PCE_VN_COMMAND_SPRITE)
    {
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (current_scene_full_screen_bg) return VN_EXEC_CONTINUE;
#endif
        slot = command->slot < VN_SPRITE_SLOT_COUNT ? command->slot : 0u;
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
        if (pending_sprite_refresh) refresh_scene_sprites();
    }
    else if (command->type == PCE_VN_COMMAND_AUDIO)
    {
        const uint8_t kind = (uint8_t)(command->flags & 0x0fu);
        const uint8_t action = (uint8_t)(command->flags & 0xf0u);
        if (kind == PCE_VN_AUDIO_KIND_ADPCM)
        {
            if (action == PCE_VN_AUDIO_ACTION_STOP) stop_adpcm_voice();
            else play_adpcm_voice(command->asset_index);
        }
        else if (kind == PCE_VN_AUDIO_KIND_PSG)
        {
            if (action == PCE_VN_AUDIO_ACTION_STOP)
            {
                VN_MAP_BANK130_FOR_CODE();
                stop_psg();
            }
            else
            {
                VN_MAP_BANK130_FOR_CODE();
                play_psg_asset(command->asset_index, command->slot);
            }
        }
        else
        {
            if (action == PCE_VN_AUDIO_ACTION_STOP) stop_cdda_track();
            else if (command->asset_index >= 0 && (unsigned int)command->asset_index < pce_editor_cdda_asset_count)
            {
                const pce_editor_cdda_asset_t *cdda = vn_get_cdda_asset((uint16_t)command->asset_index);
                play_cdda_track(cdda);
            }
        }
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
            load_runtime_cache(command->arg0, command->asset_index, command->slot, command->x, command->y);
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
            display_disable();
            pending_display_enable = 1u;
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
            display_disable();
            pending_display_enable = 1u;
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
#if PCE_VN_HAS_FULL_SCREEN_BG
        if (current_scene_full_screen_bg) return VN_EXEC_CONTINUE;
        restore_text_vram_after_full_screen_bg();
#endif
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
                spritetext_slots[slot].glyphs[i] = scene_pack_u8(&active_scene_pack, (uint16_t)(glyph_offset + i));
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

#if defined(__PCE_CD__)
/* Stream the overlay code blob (pce_vn_overlay_data) from CD into bank133 RAM.
   bank133 is mapped into slot 4 (0x8000) as the read destination, then bank130
   (play code) is restored. Mirrors upload_font_tiles' CD-read loop but writes the
   bytes straight into the slot-4 window instead of via cd_transfer_scratch+VRAM. */
static void load_overlay_code(void)
{
    pce_vn_cd_data_ref_t ovl;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t dest = (uint16_t)PCE_VN_OVERLAY_LOAD_ADDR;
    map_vn_data();
    ovl = pce_vn_overlay_data;
    map_resident_data();
    if (!ovl.byte_size || !ovl.sector_count) return;
    prepare_cd_data_access();
    sector.lo = ovl.sector.lo;
    sector.md = ovl.sector.md;
    sector.hi = ovl.sector.hi;
    remaining = ovl.byte_size;
    pce_ram_bank133_map();
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, dest, chunk);
        cd_transfer_wait();
        dest = (uint16_t)(dest + chunk);
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    pce_ram_bank130_map();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
}

#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
static void load_visual_cache_code(void)
{
    pce_vn_cd_data_ref_t code;
    pce_sector_t sector = {0};
    uint16_t remaining;
    uint16_t dest = (uint16_t)PCE_VN_VISUAL_CODE_LOAD_ADDR;
    map_vn_data();
    code = pce_vn_visual_code_data;
    map_resident_data();
    if (!code.byte_size || !code.sector_count) return;
    prepare_cd_data_access();
    sector.lo = code.sector.lo;
    sector.md = code.sector.md;
    sector.hi = code.sector.hi;
    remaining = code.byte_size;
    while (remaining)
    {
        const uint16_t chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining;
        pce_ram_bank133_map();
        (void)pce_cdb_cd_read(sector, PCE_CDB_ADDRESS_BYTES, dest, chunk);
        cd_transfer_wait();
        dest = (uint16_t)(dest + chunk);
        remaining = (uint16_t)(remaining - chunk);
        cd_sector_advance(&sector);
    }
    sync_cd_external_irq_after_bios_call();
    pce_ram_bank130_map();
    resume_cdda_after_cd_data_access();
    VN_MAP_BANK130_FOR_CODE();
}
#endif
#endif

static void init_video(void)
{
#if defined(__PCE_CD__)
    pce_ram_bank129_map();
    pce_ram_bank130_map();
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    set_vdc_control(VN_VDC_BLANK_CONTROL);
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_irq_disable(IRQ_VDC);
    pce_cdb_irq_disable((uint8_t)(PCE_CDB_MASK_IRQ_EXTERNAL | PCE_CDB_MASK_VBLANK | PCE_CDB_MASK_VBLANK_NO_BIOS));
#elif defined(__PCE__)
    pce_vdc_set_resolution(256, 224, VCE_COLORBURST_ON);
    pce_vdc_bg_set_size(VDC_BG_SIZE_32_32);
    pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL);
    vn_vdc_set_copy_word();
    pce_vdc_bg_enable();
    pce_vdc_sprite_enable();
    pce_vdc_sprite_set_table_start(VN_SATB_ADDR);
    pce_irq_disable(IRQ_VDC);
#endif
    upload_ui_palette();
    upload_font_tiles();
    upload_font_sprite_patterns();
    upload_blank_tile();
    clear_screen_map();
    set_screen_offset(0, 0);
#if defined(__PCE_CD__)
    /* Stream the transition/upload overlay into bank133 at boot. It is invoked
       later by mapping bank133 into slot 4, running an entry, and restoring
       bank130 (see the overlay jump table / set_background wrapping in a later
       phase). The CD->bank133->slot4 load/map/execute path is verified in
       Geargrafx (overlay ran from slot 4 with MPR4=bank133). */
    load_overlay_code();
#endif
}

int main(void)
{
    uint8_t pad;
    uint8_t last_pad;
    uint8_t pressed;
    uint8_t start_scene;

    init_runtime_state();
    init_video();
    map_vn_data();
    start_scene = pce_vn_start_scene;
    show_scene(start_scene);
    advance_story();
    last_pad = read_pad_raw();
#if defined(__PCE_CD__)
    if (pad_edge_reset_pending)
    {
        pad_edge_reset_pending = 0u;
    }
#endif

    while (1)
    {
        pad = read_pad_raw();
#if defined(__PCE_CD__)
        if (pad_edge_reset_pending)
        {
            last_pad = pad;
            pad_edge_reset_pending = 0u;
        }
#endif
        pressed = (uint8_t)(pad & (uint8_t)~last_pad);
        if (async_input_active && (pressed & async_input_mask))
        {
            /* Background watcher matched: jump to its label and resume there. */
            const uint16_t target = async_input_target;
            async_input_active = 0u;
            async_input_mask = 0u;
            async_input_target = PCE_VN_NO_COMMAND;
            VN_MAP_BANK130_FOR_CODE();
            (void)jump_to_command(target);
            advance_story();
        }
        else if (active_choice_index >= 0)
        {
            (void)handle_choice_input(pressed);
        }
        else if (sync_input_active)
        {
            /* Synchronous wait: block until one of the requested buttons is hit. */
            if (pressed & sync_input_mask)
            {
                const uint16_t target = sync_input_target;
                sync_input_active = 0u;
                sync_input_mask = 0u;
                sync_input_target = PCE_VN_NO_COMMAND;
                VN_MAP_BANK130_FOR_CODE();
                (void)jump_to_command(target);
                advance_story();
            }
        }
        else if (wait_frames_remaining)
        {
            wait_frames_remaining--;
            if (!wait_frames_remaining) advance_story();
        }
        else if (pressed & (PAD_I | PAD_II | PAD_RUN | PAD_RIGHT | PAD_DOWN))
        {
            if (active_message_index >= 0 && !message_complete)
            {
                /* First press: skip the typewriter wait and reveal the whole
                   page; the voice keeps playing until the next page advance. */
                finish_active_message();
            }
            else
            {
                /* Advancing off a finished message page: if its voice is still
                   playing (e.g. the reveal was skipped), end it now. */
                if (active_message_index >= 0 && adpcm_playback_active()) stop_adpcm_voice();
                if (active_message_index >= 0) hide_message_wait_indicator();
                advance_story();
            }
        }
        VN_MAP_BANK130_FOR_CODE();
        tick_psg();
        /* Do not restore the old ADPCM gate:
        if (!adpcm_playback_active())
        {
            tick_sprite_animations();
        } */
        tick_sprite_animations();
        tick_spritetext();
        if (pending_sprite_refresh) refresh_scene_sprites();
        tick_active_message();
        tick_message_wait_indicator();
        if (active_message_index >= 0 && message_complete)
        {
            if (active_message_state.advance_mode == PCE_VN_ADVANCE_AUTO)
            {
                if (message_auto_wait) message_auto_wait--;
                else
                {
                    hide_message_wait_indicator();
                    advance_story();
                }
            }
        }
        last_pad = pad;
        delay_frame();
    }
    return 0;
}
