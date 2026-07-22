/* Super System Card 3.0 adapter.
   This is the only module that calls PSG_BIOS/PSG_DRIVE directly or touches
   the BIOS pseudo-registers. The public Hu7 entry points remain in the
   user-supplied System Card; no BIOS or driver bytes are linked into the game. */

#if defined(__PCE_CD__)
#define VN_SC_PSG_BIOS_ADDR 0xe0d8u
#define VN_SC_PSG_DRIVE_ADDR 0xe0e1u
#define VN_SC_REG_AL (*(volatile uint8_t *)0x20f8)
#define VN_SC_REG_AH (*(volatile uint8_t *)0x20f9)
#define VN_SC_REG_BL (*(volatile uint8_t *)0x20fa)
#define VN_SC_REG_BH (*(volatile uint8_t *)0x20fb)
#define VN_SC_REG_DH (*(volatile uint8_t *)0x20ff)
#define VN_SC_IRQ_USER_MASK PCE_CDB_MASK_IRQ_VDC
#define VN_SC_IRQ_FORBIDDEN_MASK ((uint8_t)(PCE_CDB_MASK_VBLANK | PCE_CDB_MASK_VBLANK_NO_BIOS))
#define VN_SC_PSG_BUS_BGM 0u
#define VN_SC_PSG_BUS_SFX 1u

volatile uint16_t vn_frame_epoch __attribute__((section(".bss")));
static volatile uint8_t vn_system_card_bios_result __attribute__((section(".bss")));
static uint8_t vn_system_card_probe_ok __attribute__((section(".bss")));
static uint8_t vn_system_card_font_scratch[32] __attribute__((section(".bss")));
static uint8_t vn_system_card_sprite_pattern[128] __attribute__((section(".bss")));

/* IRQ lock + MPR0 contract shared by every main-thread PSG_BIOS call. The
   wrapper stores all pseudo-register inputs while I=1, maps the hardware page
   required by the BIOS, captures ACC, and restores the caller's MPR0/flags. */
static uint8_t VN_RESIDENT_CODE vn_system_card_psg_bios_call(uint8_t function, uint8_t al, uint8_t ah)
{
    __asm__ volatile("php\n\tsei" ::: "memory");
    VN_SC_REG_DH = function;
    VN_SC_REG_AL = al;
    VN_SC_REG_AH = ah;
    __asm__ volatile(
        "tma #$01\n\t"
        "pha\n\t"
        "lda #$ff\n\t"
        "tam #$01\n\t"
        "jsr $e0d8\n\t"
        "sta vn_system_card_bios_result\n\t"
        "pla\n\t"
        "tam #$01\n\t"
        "plp"
        ::: "a", "x", "y", "p", "memory");
    return vn_system_card_bios_result;
}

/* System Card IRQ1 dispatch reaches this vector with JMP, so it owns the full
   save/restore sequence and returns with RTI. Reading VDC status acknowledges
   the source. PSG_DRIVE runs exactly once only when VD is set. The driver
   saves/restores MPR4/5/6 by contract; this handler additionally preserves
   A/X/Y and MPR0 around the call. */
static void VN_RESIDENT_CODE __attribute__((naked)) vn_system_card_vsync_irq(void)
{
    __asm__ volatile(
        "pha\n\t"
        "phx\n\t"
        "phy\n\t"
        "tma #$01\n\t"
        "pha\n\t"
        "lda #$ff\n\t"
        "tam #$01\n\t"
        "lda $0000\n\t"
        "and #$20\n\t"
        "beq 1f\n\t"
        "jsr $e0e1\n\t"
        "inc vn_frame_epoch\n\t"
        "bne 1f\n\t"
        "inc vn_frame_epoch+1\n"
        "1:\n\t"
        "pla\n\t"
        "tam #$01\n\t"
        "ply\n\t"
        "plx\n\t"
        "pla\n\t"
        "rti"
        ::: "a", "x", "y", "p", "memory");
}

static void VN_RESIDENT_CODE vn_system_card_irq_rearm(void)
{
    uint8_t mask;
    __asm__ volatile("php\n\tsei" ::: "memory");
    mask = *VN_CDB_BIOS_IRQ_MASK;
    mask = (uint8_t)((mask & PCE_CDB_MASK_IRQ_EXTERNAL) | VN_SC_IRQ_USER_MASK);
    mask = (uint8_t)(mask & (uint8_t)~VN_SC_IRQ_FORBIDDEN_MASK);
    *VN_CDB_BIOS_IRQ_MASK = mask;
    pce_irq_enable(IRQ_VDC);
    __asm__ volatile("plp" ::: "p", "memory");
}

/* EX_GETFNT ($E060): AX=Shift-JIS, BX=32-byte destination, DH=0/1 for
   16x16/12x12. Preserve every MPR the BIOS font window may use. */
static uint8_t VN_RESIDENT_CODE vn_system_card_get_font(uint16_t sjis, uint8_t mode, uint8_t *dest)
{
    const uint16_t address = (uint16_t)(uintptr_t)dest;
    uint8_t result;
    __asm__ volatile("php\n\tsei" ::: "memory");
    VN_SC_REG_AL = (uint8_t)(sjis & 0xffu);
    VN_SC_REG_AH = (uint8_t)(sjis >> 8);
    VN_SC_REG_BL = (uint8_t)(address & 0xffu);
    VN_SC_REG_BH = (uint8_t)(address >> 8);
    VN_SC_REG_DH = mode;
    __asm__ volatile(
        "tma #$01\n\tpha\n\t"
        "tma #$10\n\tpha\n\t"
        "tma #$20\n\tpha\n\t"
        "tma #$40\n\tpha\n\t"
        "lda #$ff\n\ttam #$01\n\t"
        "jsr $e060\n\t"
        "sta vn_system_card_bios_result\n\t"
        "pla\n\ttam #$40\n\t"
        "pla\n\ttam #$20\n\t"
        "pla\n\ttam #$10\n\t"
        "pla\n\ttam #$01\n\t"
        "plp"
        ::: "a", "x", "y", "p", "memory");
    result = vn_system_card_bios_result;
    /* EX_GETFNT may touch the same BIOS IRQ/VDC shadow state even when it
       rejects a code. Re-establish the user vector before exposing either
       success or failure to the caller. */
    vn_system_card_irq_rearm();
    return result;
}

static uint8_t VN_RESIDENT_CODE vn_system_card_font12_mask(uint16_t sjis, uint16_t *mask)
{
    uint8_t row;
    if (!mask || vn_system_card_get_font(sjis, 1u, vn_system_card_font_scratch)) return 0u;
    for (row = 0u; row < 12u; row++)
    {
        mask[row] = (uint16_t)((((uint16_t)vn_system_card_font_scratch[row * 2u]) << 8)
            | vn_system_card_font_scratch[(row * 2u) + 1u]) & 0xfff0u;
    }
    return 1u;
}

/* Convert the BIOS 12x12 glyph into a 16x16 hardware sprite pattern. The
   visible glyph is centered with two transparent pixels on every side, so
   SpriteText can place adjacent hardware sprites at the message text's 12px
   horizontal pitch without changing the one-glyph/one-SATB-entry contract. */
static uint8_t VN_RESIDENT_CODE vn_system_card_font12_sprite_upload(uint16_t sjis, uint16_t pattern_base)
{
    uint8_t plane;
    uint8_t row;
    uint8_t irq;
    if (vn_system_card_get_font(sjis, 1u, vn_system_card_font_scratch)) return 0u;
    irq = vn_vdc_irq_lock();
    for (row = 0u; row < 16u; row++)
    {
        uint16_t bits = 0u;
        if (row >= VN_GLYPH_Y_OFFSET && row < (uint8_t)(VN_GLYPH_Y_OFFSET + VN_GLYPH_H))
        {
            const uint8_t source = (uint8_t)((row - VN_GLYPH_Y_OFFSET) * 2u);
            bits = (uint16_t)(((((uint16_t)vn_system_card_font_scratch[source]) << 8)
                | vn_system_card_font_scratch[source + 1u]) & 0xfff0u);
            bits = (uint16_t)(bits >> VN_SPRITETEXT_GLYPH_X_OFFSET);
        }
        for (plane = 0u; plane < 4u; plane++)
        {
            const uint8_t dest = (uint8_t)((plane * 32u) + (row * 2u));
            /* Hardware sprite layout is four 32-byte plane blocks. Within a
               row the right 8 pixels precede the left 8 pixels. */
            vn_system_card_sprite_pattern[dest] = (uint8_t)bits;
            vn_system_card_sprite_pattern[dest + 1u] = (uint8_t)(bits >> 8);
        }
    }
    pce_editor_vram_copy((uint16_t)(pattern_base * 32u), vn_system_card_sprite_pattern, 128u);
    vn_vdc_irq_unlock(irq);
    return 1u;
}

static void VN_RESIDENT_CODE vn_system_card_prepare_psg_banks(void)
{
    uint8_t saved_mpr6;
    uint8_t i;
    volatile uint8_t *bank = (volatile uint8_t *)0xc000;
    __asm__ volatile("tma #$40" : "=a"(saved_mpr6));
    pce_ram_bank134_map();
    for (i = 0u; i < 32u; i++) bank[i] = i < 16u ? 31u : 0u;
    /* Track index at $8020 after the driver maps bank134 into MPR4:
       sound 0 -> BGM header $8024, sound 1 -> SFX header $A000. */
    bank[32] = 0x24u;
    bank[33] = 0x80u;
    bank[34] = 0x00u;
    bank[35] = 0xa0u;
    __asm__ volatile("tam #$40" : : "a"(saved_mpr6));
}

static uint8_t VN_RESIDENT_CODE vn_system_card_init_psg(void)
{
    uint8_t i;
    uint8_t nonzero = 0u;
    uint16_t version = pce_cdb_version();
    vn_system_card_probe_ok = (uint8_t)(version == 0x0300u);
    if (!vn_system_card_probe_ok) return 0u;
    vn_system_card_prepare_psg_banks();
    (void)vn_system_card_psg_bios_call(1u, 0u, 0u);             /* PSG_OFF */
    (void)vn_system_card_psg_bios_call(2u, 2u, 0u);             /* PSG_INIT main+sub, 1/60 */
    (void)vn_system_card_psg_bios_call(3u, 134u, 135u);         /* PSG_BANK */
    (void)vn_system_card_psg_bios_call(5u, 0x00u, 0x80u);       /* PSG_WAVE $8000 */
    (void)vn_system_card_psg_bios_call(4u, 0x20u, 0x80u);       /* PSG_TRACK $8020 */
    pce_cdb_irq_set(PCE_CDB_ID_IRQ_VDC, vn_system_card_vsync_irq);
    vn_system_card_irq_rearm();
    (void)vn_system_card_psg_bios_call(0u, 1u, 0u);             /* PSG_ON IRQ mode */
    vn_system_card_irq_rearm();
    if (vn_system_card_get_font(0x93fau, 1u, vn_system_card_font_scratch))
    {
        (void)vn_system_card_psg_bios_call(1u, 0u, 0u);
        vn_system_card_probe_ok = 0u;
        return 0u;
    }
    for (i = 0u; i < 24u; i++) nonzero = (uint8_t)(nonzero | vn_system_card_font_scratch[i]);
    if (!nonzero)
    {
        (void)vn_system_card_psg_bios_call(1u, 0u, 0u);
        vn_system_card_probe_ok = 0u;
        return 0u;
    }
    return 1u;
}

static void VN_BANKED_CODE vn_system_card_psg_play_bus(uint8_t bus)
{
    (void)vn_system_card_psg_bios_call(11u, bus ? 1u : 0u, 0u);
    vn_system_card_irq_rearm();
}

static uint8_t VN_BANKED_CODE vn_system_card_psg_status_bus(uint8_t bus)
{
    const uint8_t status = vn_system_card_psg_bios_call(bus ? 13u : 12u, 0u, 0u);
    vn_system_card_irq_rearm();
    /* Bits 0..5 are the per-channel play state.  An unused sub track returns
       $80, which is not a playing channel and must not stall a package load. */
    return (status & 0x3fu) ? 1u : 0u;
}

static void VN_BANKED_CODE vn_system_card_psg_stop_bus(uint8_t bus)
{
    /* PSG_MSTOP/PSG_SSTOP take a six-channel mask, not a sound number.
       Bit6 selects stop (rather than continue); stop every channel in the bus. */
    (void)vn_system_card_psg_bios_call(bus ? 15u : 14u, 0x7fu, 0u);
    vn_system_card_irq_rearm();
}

static void VN_BANKED_CODE vn_system_card_psg_stop_all(void)
{
    (void)vn_system_card_psg_bios_call(16u, 0u, 0u);
    vn_system_card_irq_rearm();
}
#endif
