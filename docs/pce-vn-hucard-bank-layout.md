# HuCARD VN bank layout

HuCARD VN は CD-ROM2 VN runtime/template とは独立した HuCARD 専用 runtime です。通常の `.text/.rodata` を `rom_bank0` に積み続けると、llvm-mos PCE linker の固定 8KB 窓と `.early_start` / `.vector` 予約領域に衝突するため、HuCARD VN では code bank と data bank を固定的に分離します。

## 固定 ROM bank 配置

| Bank | CPU window | 用途 |
| --- | --- | --- |
| `rom_bank0` | `0xe000-0xffff` | 起動、main loop、VBlank/VDC state、data ref helper、小さい dispatch/metadata |
| `rom_bank1` | slot2 (`0x4000-0x5fff`) | scene pack reader、command dispatch、variables/branch/effect command |
| `rom_bank2` | slot3 (`0x6000-0x7fff`) | BG/VRAM copy、palette/fade、sprite/SATB worker |
| `rom_bank3` | slot4 (`0x8000-0x9fff`) | message compositor、choice、glyph decode、spritetext |
| `rom_bank4` | slot5 (`0xa000-0xbfff`) | PSG song/SFX sequencer、小型 support helper |
| `rom_bank5..127` | slot6 (`0xc000-0xdfff`) | image/sprite payload、VN font mask、scene pack、spritetext font、PSG pattern data |

`pce_vn_hucard_banks.h` が banks 1..4 を `PCE_ROM_BANK_AT()` で宣言し、runtime 起動直後に slot2..5 へ常駐 map します。asset/VN data は slot6 だけを使うため、visual data を読んでも runtime code bank は外れません。

`assets.c` では runtime code banks だけ full `PCE_ROM_BANK_AT()` を使います。data banks は `PCE_EDITOR_ROM_DATA_BANK_AT()` の map-only declaration で、不要な `pce_rom_bankN_call()` trampoline を bank0 `.text` に増やしません。

## PSG timing

HuCARD VN の PSG BGM/SFX は HuC6280 TIMER IRQ ではなく、runtime の `wait_vblank()` を通過した安全地点を時間源にします。main loop、palette fade、BG map clear、message window、sprite/SATB 更新などの cooperative service point が VBlank を待った直後に `psg_advance(1)` を呼び、PSG register を main thread だけで更新します。

TIMER IRQ は HuCARD 側では使いません。過去の TIMER credit 実験では main thread の VBlank service と独立した credit が積まれ、通常時の高速再生や不安定な catch-up を起こしやすかったためです。`IRQ_VDC` は引き続き mask し、VDC の VBlank status latch は polling 用として使います。割り込み内で PSG を直接鳴らす実装も、VDC/SATB/ROM bank 操作と再入して表示破壊を起こしやすいため採用しません。

## VN data の扱い

HuCARD VN の `extraDataFiles` は、8KB 未満でも必ず banked `pce_editor_data_ref_t` として出力します。対象は以下です。

- `assets/generated/vn/font.bin` message font mask
- `assets/generated/vn/scenes/*.bin` scene pack
- `assets/generated/vn/font_sprite.bin` spritetext font
- `assets/generated/vn/psg/*.bin` PSG pattern

これらは image/sprite payload と同じ ROM-bank allocator を共有し、banks 5..127 を消費します。容量超過は build error です。

## グリフと scene pack 制約

Message font は 12x12 1bpp mask で、1 glyph = 24 bytes です。1000 glyph でも約 24000 bytes の data bank 消費になり、bank0 `.rodata` は増えません。8KB chunk 境界をまたぐ glyph mask は `data_ref_byte_at()` が byte 単位で bank を map し直して読みます。

Glyph stream は CD-ROM2 VN と同じ binary layout です。glyph index 0..252 は 1 byte、253 以上は `0xfd` + 16-bit little-endian で escape encode します。`0xfe` は newline、`0xff` は end marker です。

Scene pack は現行 runtime cache の 4096 bytes 上限を維持します。glyph index 253 以上が多い scene は glyph stream が増えやすいため、4096 bytes を超えた場合は scene を分割してください。build は scene 名と byte size を含む error で停止します。

Spritetext font は message font と別枠です。最大 254 glyph、1 command 最大 32 glyph、sprite pattern VRAM の制約を維持し、message font と同じ bank0 常駐 data にはしません。

## Build / Test Play

HuCARD VN build は `.pce` と `.map` を出力します。build log には HuCARD VN bank usage として bank0 payload、runtime code banks、data banks の使用量を出します。`rom_bank0` は linker の `.early_start` / `.vector` 予約で map 上は末尾まで埋まりますが、確認対象は `.text/.rodata/.data/.zp.data` の payload と banks 1..4 / 5..127 の各 8KB 超過です。

Test Play は通常の HuCARD ROM と同じく `.pce` を標準エミュレーターまたは外部エミュレーターへ渡します。ADPCM、CD-DA、`message.voiceAssetId`、ADPCM cache command は silent no-op です。
