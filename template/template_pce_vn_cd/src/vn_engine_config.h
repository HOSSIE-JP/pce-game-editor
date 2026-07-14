/* PHASE_A_SPLIT:BEGIN vn_engine_config.h — compile-time configuration for the
   CD-ROM2 VN runtime: includes, PCE_RAM_BANK_AT declarations, PSG/VCE MMIO
   addresses, layout/timing #defines, code-section macros (VN_BANKED_CODE etc.)
   and the overlay op codes. Moved verbatim from pce_vn_runtime.c (Phase A
   module split); see the umbrella pce_vn_runtime.c for the include order.
   PHASE_A_SPLIT:END */
#include <stdint.h>

#if defined(__PCE_CD__)
#define PCE_CONFIG_IMPLEMENTATION
#define VN_ENABLE_VISUAL_PAYLOAD_CACHE 1
#endif
#if defined(__PCE__)
#include <pce.h>
#endif
#if defined(__PCE_CD__)
#include <pce-cd.h>
PCE_RAM_BANK_AT(128, 2);
PCE_RAM_BANK_AT(129, 3);
PCE_RAM_BANK_AT(130, 4);
/* bank123 = active scene pack. It is mapped into MPR6 only for bounded
   offset/count reads and never exposed as a long-lived raw pointer. */
PCE_RAM_BANK_AT(123, 6);
/* bank133 = transition/upload overlay, time-shared with bank130 in MPR slot 4
   (0x8000). Its code is NOT in the boot image (the IPL only loads banks 128-132);
   load_overlay_code() streams it from CD into bank133 RAM at boot. bank133 is
   never used by the System Card (unlike bank131/MPR5), so it is safe for code. */
PCE_RAM_BANK_AT(133, 4);
/* bank134/135 = System Card PSG driver data banks. PSG_BANK maps them into
   MPR4/MPR5: bank134 owns wave45, the two-entry index and active BGM package;
   bank135 owns the active SFX package. The app maps them through MPR6 only
   while preparing/loading data and always restores the previous mapping. */
PCE_RAM_BANK_AT(134, 6);
PCE_RAM_BANK_AT(135, 6);
/* Visual payload cache helper code is streamed into bank121 after System Card
   boot. Payload pages use low System Card RAM banks 104-119 and are raw-mapped
   into slot 6 at runtime, so they do not need linker sections and are never part
   of the IPL-loaded program image. */
#if VN_ENABLE_VISUAL_PAYLOAD_CACHE
PCE_RAM_BANK_AT(121, 4);
#endif
/* bank122 = experimental direct CD/SCSI helper code, time-shared with bank130,
   bank121, and bank133 in MPR slot 4. Keeping it separate prevents the async
   loader from consuming the already-tight visual helper and overlay banks. */
PCE_RAM_BANK_AT(122, 4);
PCE_CDB_USE_PSG_DRIVER(1);
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

#define PCE_VCE_ADDR_LO (*(volatile uint8_t *)0x0402)
#define PCE_VCE_ADDR_HI (*(volatile uint8_t *)0x0403)
#define PCE_VCE_DATA_LO (*(volatile uint8_t *)0x0404)
#define PCE_VCE_DATA_HI (*(volatile uint8_t *)0x0405)

#define VN_MAP_WIDTH 32u
#define VN_MAP_HEIGHT 32u
#define VN_BG_SCROLL_WIDTH 512u
#define VN_BG_SCROLL_HEIGHT 256u
#define VN_MAP_ROW_BYTES (VN_MAP_WIDTH * 2u)
#define VN_ADPCM_MAX_RATE_CODE 15u
#define VN_ADPCM_SNAPSHOT_DIVIDER() (adpcm_voice_snapshot.divider > VN_ADPCM_MAX_RATE_CODE ? VN_ADPCM_MAX_RATE_CODE : adpcm_voice_snapshot.divider)
#define VN_ADPCM_SNAPSHOT_PLAY_FRAMES() (adpcm_voice_snapshot.play_frames ? (uint16_t)adpcm_voice_snapshot.play_frames : 1u)
#define VN_ADPCM_BUFFERED_END_GUARD_FRAMES 4u
#define VN_ADPCM_BUFFERED_PLAY_FRAMES() (adpcm_voice_snapshot.play_frames > VN_ADPCM_BUFFERED_END_GUARD_FRAMES ? (uint16_t)(adpcm_voice_snapshot.play_frames - VN_ADPCM_BUFFERED_END_GUARD_FRAMES) : 1u)
#define VN_ADPCM_BUFFERED_SAFE_BYTES 32767u
#define VN_ADPCM_BUFFERED_HARDWARE_LENGTH 0xffffu
/* Compatibility knobs retained for call-site shape. CD-backed voices now use the
   direct SCSI async ADPCM_RAM destination, so these no longer size BIOS CD read
   commands; local RAM fallback still uses the ADPCM busy wait below. */
#define VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS 8u
#define VN_ADPCM_PRELOAD_READ_CHUNK_SECTORS 8u
#define VN_PCD_IRQ_STATUS_ADPCM_END 0x08u
#define VN_SATB_ADDR 0x7f00u
#define VN_SPRITE_PATTERN_END_BASE (VN_SATB_ADDR / 32u)
/* Max positional cells per sprite sheet whose cell_map we cache (1 byte/cell).
   Keep this in sync with the generator cap in pce-asset-manager.js. */
#define VN_META_CELL_MAP_MAX 256u
#ifndef PCE_VN_SPRITE_PATTERN_BASE
#define PCE_VN_SPRITE_PATTERN_BASE 704u
#endif
#define VN_SPRITE_HIDDEN_Y 0x00f0u
/* 256x224 layout: BG 224x136 (top, centered), message window 208x64 (1 tile
   above bottom, centered). Window = 26x8 tiles at BAT (3,19). Glyphs are 12x12 composited at
   a 12px horizontal pitch (17 chars) and a 16px vertical pitch (4 rows), so the
   message text no longer aligns to the 8x8 tile grid: see the glyph compositor. */
#define VN_WINDOW_X 3u
#define VN_WINDOW_Y 19u
#define VN_WINDOW_W 26u
#define VN_WINDOW_H 8u
#define VN_TEXT_X 3u
#define VN_TEXT_Y 19u
#define VN_TEXT_COLS 17u
#define VN_TEXT_ROWS 4u
#define VN_WAIT_CURSOR_COL (VN_TEXT_COLS - 1u)
#define VN_WAIT_CURSOR_ROW (VN_TEXT_ROWS - 1u)
#define VN_WAIT_CURSOR_BLINK_FRAMES 30u
#define VN_GLYPH_W 12u
#define VN_GLYPH_H 12u
/* Vertical pad to center a 12px glyph inside the 16px (2-tile) line band. */
#define VN_GLYPH_Y_OFFSET 2u
/* SpriteText keeps one 16x16 hardware sprite per glyph, but uses the same
   visible 12x12 glyph and 12px horizontal pitch as message text. */
#define VN_SPRITETEXT_GLYPH_X_OFFSET 2u
#define VN_SPRITETEXT_PITCH_X VN_GLYPH_W
#define VN_SPRITETEXT_PITCH_Y 16u
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
/* EX_GETFNT 12x12 output is converted into 12 row masks and cached in RAM. */
#define VN_GLYPH_MASK_ROWS 12u
#define VN_MESSAGE_GLYPH_CACHE_COUNT 68u
#define VN_UI_PALETTE 15u
#define VN_UI_BLANK_TILE PCE_VN_BLANK_TILE
#define VN_CD_SECTOR_BYTES 2048u
/* The resident user-vector IRQ acknowledges VBlank and runs PSG_DRIVE.  The
   System Card full graphics handler stays disabled, so R5/R7/R8 remain owned
   by the VN runtime. */
#define VN_VDC_CONTROL_BASE (VDC_CONTROL_IRQ_VBLANK | VDC_CONTROL_DRAM_REFRESH | VDC_CONTROL_VRAM_ADD_1)
#define VN_VDC_DISPLAY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG | VDC_CONTROL_ENABLE_SPRITE)
#define VN_VDC_BG_ONLY_CONTROL (VN_VDC_CONTROL_BASE | VDC_CONTROL_ENABLE_BG)
#define VN_VDC_BLANK_CONTROL VN_VDC_CONTROL_BASE
#define VN_VDC_MEMORY_CONTROL (VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_32_32)
#define VN_CDB_IRQ_PENDING_FLAGS ((volatile uint8_t *)0x20f2)
#define VN_CDB_VDC_CONTROL_SHADOW_LO ((volatile uint8_t *)0x20f3)
#define VN_CDB_VDC_CONTROL_SHADOW_HI ((volatile uint8_t *)0x20f4)
#define VN_CDB_BIOS_IRQ_MASK ((volatile uint8_t *)0x20f5)
#define VN_SPRITE_SLOT_COUNT 4u
#define VN_EXEC_CONTINUE 0u
#define VN_EXEC_WAIT 1u
#define VN_EXEC_RESTART 2u
#define VN_COMMAND_STEP_GUARD 1024u
#define VN_BG_IMPLICIT_FADE_FRAMES 6u
/* Post-BIOS settle sampler bound for one CD transfer chunk. The CD BIOS helper
   already waits for the command/data phase; this loop is only a short
   cooperative settle window. 65535 made every sector add a large artificial
   pause, which dominated boot/BG/sprite/ADPCM loads. */
#ifndef VN_CD_TRANSFER_SETTLE_POLL_ITERATIONS
#define VN_CD_TRANSFER_SETTLE_POLL_ITERATIONS 4096u
#endif
/* CD data reads whose destination is a mapped RAM bank can be grouped. VRAM
   uploads still use the 1-sector scratch buffer. */
#ifndef VN_CD_RAM_READ_CHUNK_SECTORS
#define VN_CD_RAM_READ_CHUNK_SECTORS 2u
#endif
#define VN_CD_RAM_READ_CHUNK_BYTES ((uint16_t)(VN_CD_SECTOR_BYTES * VN_CD_RAM_READ_CHUNK_SECTORS))
#ifndef VN_VISUAL_CACHE_CD_READ_CHUNK_SECTORS
#define VN_VISUAL_CACHE_CD_READ_CHUNK_SECTORS 4u
#endif
#define VN_VISUAL_CACHE_CD_READ_CHUNK_BYTES ((uint16_t)(VN_CD_SECTOR_BYTES * VN_VISUAL_CACHE_CD_READ_CHUNK_SECTORS))
#define VN_CD_CHUNK_SECTOR_COUNT(bytes) ((uint8_t)(((uint16_t)(bytes) + 2047u) >> 11))
#define VN_CD_BUS_IDLE 0u
#define VN_CD_BUS_BIOS_HELPER 1u
#define VN_CD_BUS_ASYNC_DATA 2u
#define VN_CD_ASYNC_DEST_BANK132 1u
#define VN_CD_ASYNC_DEST_SCENE_PACK_CACHE 2u
#define VN_CD_ASYNC_DEST_ADPCM_RAM 3u
#define VN_CD_ASYNC_DEST_PSG_BANK 4u
#define VN_CD_ASYNC_STATUS_IDLE 0u
#define VN_CD_ASYNC_STATUS_ACTIVE 1u
#define VN_CD_ASYNC_STATUS_DONE 2u
#define VN_CD_ASYNC_STATUS_ERROR 3u
#define VN_CD_ASYNC_OP_BEGIN 1u
#define VN_CD_ASYNC_OP_SERVICE 2u
#define VN_CD_ASYNC_OP_CANCEL 3u
#ifndef VN_CD_ASYNC_BYTES_PER_FRAME
#define VN_CD_ASYNC_BYTES_PER_FRAME 256u
#endif
#ifndef VN_CD_ASYNC_ADPCM_BYTES_PER_FRAME
#define VN_CD_ASYNC_ADPCM_BYTES_PER_FRAME 1024u
#endif
#ifndef VN_CD_ASYNC_MAX_BYTES
#define VN_CD_ASYNC_MAX_BYTES VN_ADPCM_BUFFERED_SAFE_BYTES
#endif
#define VN_CD_ASYNC_MAX_SECTORS VN_CD_CHUNK_SECTOR_COUNT(VN_CD_ASYNC_MAX_BYTES)
#define VN_VISUAL_VRAM_COPY_SLICE_BYTES 16u
#define VN_VISUAL_VRAM_COPY_FAST_SLICE_BYTES VN_CD_SECTOR_BYTES
#define VN_VISUAL_VRAM_COPY_ACTIVE_SLICE_BYTES() (psg_active ? VN_VISUAL_VRAM_COPY_SLICE_BYTES : VN_VISUAL_VRAM_COPY_FAST_SLICE_BYTES)
#define VN_VISUAL_CODE_RESERVED_SECTORS 4u
#define VN_CD_ASYNC_CODE_RESERVED_SECTORS 4u
/* Idle $20F5 owns only the generic VDC user vector. SYNC/VBLANK/full-handler
   bits remain clear; external IRQ is enabled transiently by CD/ADPCM helpers. */
#define VN_CDB_BIOS_IRQ_MASK_USER ((uint8_t)PCE_CDB_MASK_IRQ_VDC)
#define VN_PCD_IRQ_STATUS_ALL 0x0fu

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
#define VN_VISUAL_CACHE_OP_COPY_REF_TO_VRAM 5u
#define VN_VISUAL_CACHE_OP_DRAW_SPRITETEXT 6u
#define VN_VISUAL_CACHE_OP_CLEAR_RUNTIME_CACHE 7u
#define VN_VISUAL_CACHE_OP_TICK_SPRITE_ANIMATIONS 8u
#define VN_VISUAL_CACHE_OP_LOAD_SPRITE_PATTERN_CACHE 9u
#define VN_VISUAL_CACHE_OP_FADE_SCREEN 10u
#define VN_VISUAL_CACHE_OP_RESTORE_SCREEN_PALETTE 11u
#define VN_VISUAL_CACHE_OP_FLASH_SCREEN 12u
#define VN_VISUAL_CACHE_OP_CDDA_COMMAND 13u
#define VN_CDDA_STATE_ACTIVE 0x01u
#define VN_CDDA_STATE_RESUME_PENDING 0x02u
#define VN_CDDA_STATE_REPEAT 0x04u
#define VN_CDDA_PLAY_MODE() ((cdda_state & VN_CDDA_STATE_REPEAT) ? PCE_CDB_CDDA_PLAY_REPEAT : PCE_CDB_CDDA_PLAY_ONE_SHOT)
#ifndef VN_CDDA_RESUME_AFTER_DATA_READ
#define VN_CDDA_RESUME_AFTER_DATA_READ 0
#endif
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
#define VN_CD_ASYNC_ENTRY_CODE __attribute__((used, retain, noinline, section(".vn_cd_async_code.entry")))
#define VN_CD_ASYNC_CODE __attribute__((used, retain, noinline, section(".vn_cd_async_code.impl")))
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
/* The single fixed-address overlay entry. Pinned first in .vn_overlay by the
   linker fragment so it sits at PCE_VN_OVERLAY_LOAD_ADDR (CPU 0x8000). Resident
   dispatchers reach the overlay ONLY through this entry via an indirect call to
   the literal 0x8000 (no symbol -> no resident->overlay relocation), which lets
   the build drop .vn_overlay from the ELF entirely and load the full 8KB bank133
   from CD (mirrors VN_VISUAL_CACHE_ENTRY_CODE). */
#define VN_OVERLAY_ENTRY_CODE __attribute__((used, retain, noinline, section(".vn_overlay.entry")))
#define VN_MAP_BANK130_FOR_CODE() pce_ram_bank130_map()
#define VN_MAP_CD_ASYNC_CODE() pce_ram_bank122_map()
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
#define VN_CD_ASYNC_ENTRY_CODE
#define VN_CD_ASYNC_CODE
#define VN_RESIDENT_CODE
#define VN_OVERLAY_CODE
#define VN_OVERLAY_ENTRY_CODE
#define VN_MAP_BANK130_FOR_CODE() ((void)0)
#define VN_MAP_CD_ASYNC_CODE() ((void)0)
#define VN_MAP_VISUAL_CACHE_CODE() ((void)0)
#endif

/* Overlay op-dispatch (Path B, full-8KB unlock). All resident->overlay calls go
   through vn_overlay_entry(op, a0, a1, a2): scalar/pointer args ride the normal
   calling convention (zp imaginary regs + hardware stack, both in always-mapped
   MPR0/MPR1), so no extra console_ram globals are needed. Pointers are passed as
   16-bit (HuC6280 addresses are 16-bit); the entry casts them back. */
#define VN_OVERLAY_OP_DRAW_GLYPH 1u
#define VN_OVERLAY_OP_NEXT_GLYPH 2u
#define VN_OVERLAY_OP_PREFIX_GLYPHS 3u
#define VN_OVERLAY_OP_PRELOAD_MASKS 5u
#define VN_OVERLAY_OP_SHOW_SPRITE_SLOT 6u
#define VN_OVERLAY_OP_REFRESH_SPRITE 7u
/* Pure scene-pack decoders offloaded to the overlay. a0 = output struct pointer
   (16-bit), a1 = aux pointer (choice/switch ref, 16-bit), a2 = element index. */
#define VN_OVERLAY_OP_READ_COMMAND 8u
#define VN_OVERLAY_OP_READ_MESSAGE 9u
#define VN_OVERLAY_OP_READ_CHOICE 10u
#define VN_OVERLAY_OP_READ_CHOICE_OPTION 11u
#define VN_OVERLAY_OP_READ_SWITCH 12u
#define VN_OVERLAY_OP_READ_SWITCH_CASE 13u
/* a2 = sprite slot index. */
#define VN_OVERLAY_OP_CACHE_SPRITE_ANIM 14u
/* a0 = cdda asset pointer (always-mapped snapshot). */
#define VN_OVERLAY_OP_CDDA_SECTOR 15u
/* a2 = blank flag. VDC を触る(BAT 書き込み)ので locked dispatch。 */
#define VN_OVERLAY_OP_MAP_WAIT_CELL 16u
/* a0 = variable index, a1 = value（共に 16bit signed を uint16 で運ぶ）。純粋(bss 書き込み)。 */
#define VN_OVERLAY_OP_SET_VARIABLE 17u
/* a0 = ADPCM asset index. Snapshot copy only; no bank130 calls. */
#define VN_OVERLAY_OP_COPY_ADPCM_VOICE 18u
#if defined(__PCE_CD__)
typedef uint8_t (*vn_overlay_entry_fn_t)(uint8_t, uint16_t, uint16_t, uint8_t);
#define VN_OVERLAY_CALL(op, a0, a1, a2) \
    (((vn_overlay_entry_fn_t)PCE_VN_OVERLAY_LOAD_ADDR)((uint8_t)(op), (uint16_t)(a0), (uint16_t)(a1), (uint8_t)(a2)))
typedef uint8_t (*vn_cd_async_entry_fn_t)(uint8_t);
#define VN_CD_ASYNC_CALL(op) (((vn_cd_async_entry_fn_t)PCE_VN_CD_ASYNC_CODE_LOAD_ADDR)((uint8_t)(op)))
#endif
/* Defined after the slot arrays/sprite frame fn; forward-declared so the non-CD
   dispatcher (which calls it directly) compiles before the definition. */
static uint8_t VN_OVERLAY_CODE show_character_sprite_frame_slot(uint8_t i);
static void VN_OVERLAY_CODE cache_sprite_animation_impl(uint8_t slot_index);
/* Forward decl: the CD-DA resume helper's dispatcher precedes vn_overlay_dispatch's
   definition (the resume path lives early in the file). */
static uint8_t VN_BANKED_CODE vn_overlay_dispatch(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2);
static uint8_t VN_BANKED_CODE vn_overlay_dispatch_locked(uint8_t op, uint16_t a0, uint16_t a1, uint8_t a2);

#ifndef PCE_EDITOR_CD_COMPRESSION_NONE
#define PCE_EDITOR_CD_COMPRESSION_NONE 0u
#endif
#ifndef PCE_EDITOR_CD_COMPRESSION_RLE
#define PCE_EDITOR_CD_COMPRESSION_RLE 1u
#endif

