SECTIONS {
  .vn_visual_code 0x1798000 : {
    __vn_visual_code_start = .;
    KEEP(*(.vn_visual_code.entry .vn_visual_code.entry.*))
    KEEP(*(.vn_visual_code.impl .vn_visual_code.impl.*))
    __vn_visual_code_end = .;
  } >ram_bank121
  .vn_cd_async_code 0x17a8000 : {
    __vn_cd_async_code_start = .;
    KEEP(*(.vn_cd_async_code.entry .vn_cd_async_code.entry.*))
    KEEP(*(.vn_cd_async_code.impl .vn_cd_async_code.impl.*))
    __vn_cd_async_code_end = .;
  } >ram_bank122
  .vn_logic_overlay 0x17c8000 : {
    __vn_logic_overlay_start = .;
    KEEP(*(.vn_logic_overlay.entry .vn_logic_overlay.entry.*))
    KEEP(*(.vn_logic_overlay.impl .vn_logic_overlay.impl.*))
    KEEP(*(.vn_logic_overlay .vn_logic_overlay.*))
    __vn_logic_overlay_end = .;
  } >ram_bank124
  .vn_overlay 0x1858000 : {
    __vn_overlay_start = .;
    KEEP(*(.vn_overlay.entry .vn_overlay.entry.*))
    KEEP(*(.vn_overlay .vn_overlay.*))
    __vn_overlay_end = .;
  } >ram_bank133
  .ram_bank132_tail 0xd078 (NOLOAD) : {
    KEEP(*(.ram_bank132_tail .ram_bank132_tail.*))
  }
} INSERT AFTER .ram_bank132;
