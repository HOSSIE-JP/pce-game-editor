#ifndef PCE_VN_HUCARD_BANKS_H
#define PCE_VN_HUCARD_BANKS_H

#define PCE_VN_HUCARD_CODE_BANK_SCRIPT 1u
#define PCE_VN_HUCARD_CODE_BANK_VIDEO 2u
#define PCE_VN_HUCARD_CODE_BANK_TEXT 3u
#define PCE_VN_HUCARD_CODE_BANK_PSG 4u
#define PCE_VN_HUCARD_DATA_BANK_FIRST 5u

#if defined(__PCE__) && !defined(__CC65__)
PCE_ROM_BANK_AT(1, 2);
PCE_ROM_BANK_AT(2, 3);
PCE_ROM_BANK_AT(3, 4);
PCE_ROM_BANK_AT(4, 5);

static inline void pce_vn_hucard_map_runtime_banks(void)
{
    pce_rom_bank1_map();
    pce_rom_bank2_map();
    pce_rom_bank3_map();
    pce_rom_bank4_map();
}
#else
static inline void pce_vn_hucard_map_runtime_banks(void)
{
}
#endif

#endif
