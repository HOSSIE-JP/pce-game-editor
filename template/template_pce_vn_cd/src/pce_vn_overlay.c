/* PCE VN overlay translation unit (Path B).
 *
 * Compiled and linked SEPARATELY from the main program, located at CPU address
 * 0x8000 (MPR slot 4), and objcopy'd to a raw binary (assets/generated/vn/
 * overlay.bin). The binary is placed on the CD and streamed into physical RAM
 * bank133 at boot; the runtime maps bank133 into slot 4 and calls into it.
 *
 * Why a separate blob (not a .ram_bank133 section in the main link): the IPL only
 * auto-loads banks 128-132 into RAM at boot, so a bank133 section links as NOBITS
 * (no bytes in the image) and its code must be carried as CD data and loaded at
 * runtime. bank133 (unlike bank131/MPR5) is never used by the System Card, so
 * overlay code there is not hijacked (verified in Geargrafx).
 *
 * Phase B0: a single entry at the overlay base (0x8000) that proves the
 * load/map/execute path. Distinctive instructions (a2 5a = ldx #$5a) make the
 * loaded bytes recognizable in Geargrafx (read bank133 RAM; breakpoint on exec).
 * No resident symbol dependencies yet (B1 adds a jump table + symbol resolution).
 */
#include <stdint.h>

__attribute__((noinline, used, section(".ovl_entry")))
void vn_overlay_entry(void)
{
    __asm__ volatile("ldx #$5a");
}
