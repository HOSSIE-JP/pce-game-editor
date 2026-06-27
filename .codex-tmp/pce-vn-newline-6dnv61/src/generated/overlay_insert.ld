SECTIONS {
  .vn_overlay 0x8000 : AT(0x184d200) {
    __vn_overlay_start = .;
    KEEP(*(.vn_overlay .vn_overlay.*))
    __vn_overlay_end = .;
  }
} INSERT AFTER .ram_bank132;
