SECTIONS {
  .vn_visual_code 0x1798000 : {
    __vn_visual_code_start = .;
    KEEP(*(.vn_visual_code.entry .vn_visual_code.entry.*))
    KEEP(*(.vn_visual_code.impl .vn_visual_code.impl.*))
    __vn_visual_code_end = .;
  } >ram_bank121
  .vn_overlay 0x8000 : AT(0x184d078) {
    __vn_overlay_start = .;
    KEEP(*(.vn_overlay .vn_overlay.*))
    __vn_overlay_end = .;
  }
  .ram_bank132_tail 0xd078 (NOLOAD) : {
    KEEP(*(.ram_bank132_tail .ram_bank132_tail.*))
  }
} INSERT AFTER .ram_bank132;
