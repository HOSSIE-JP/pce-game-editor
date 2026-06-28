SECTIONS {
  .vn_overlay 0x8000 : AT(0x184d078) {
    __vn_overlay_start = .;
    KEEP(*(.vn_overlay .vn_overlay.*))
    __vn_overlay_end = .;
  }
  .ram_bank132_tail 0xd078 (NOLOAD) : {
    KEEP(*(.ram_bank132_tail .ram_bank132_tail.*))
  }
} INSERT AFTER .ram_bank132;
