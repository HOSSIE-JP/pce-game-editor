# HuCARD VN bank layout

HuCARD VN は CD-ROM2 VN runtime/template とは独立した HuCARD 専用 runtime です。通常の `.text/.rodata` を `rom_bank0` に積み続けると、llvm-mos PCE linker の固定 8KB 窓と `.early_start` / `.vector` 予約領域に衝突するため、HuCARD VN では code bank と data bank を固定的に分離します。

## 固定 ROM bank 配置

| Bank | CPU window | 用途 |
| --- | --- | --- |
| `rom_bank0` | `0xe000-0xffff` | 起動、main loop、VBlank/VDC state、data ref helper、小さい dispatch/metadata |
| `rom_bank1` | slot2 (`0x4000-0x5fff`) | scene pack reader、command dispatch、variables/branch/effect command |
| `rom_bank2` | slot3 (`0x6000-0x7fff`) | BG/VRAM copy、palette/fade、sprite pattern transfer/draw、SATB upload |
| `rom_bank3` | slot4 (`0x8000-0x9fff`) | message compositor、choice、glyph decode、spritetext |
| `rom_bank4` | slot5 (`0xa000-0xbfff`) | PSG song/SFX sequencer、sprite state/layout/animation、`spritemove` DDA、小型 support helper |
| `rom_bank5..127` | slot6 (`0xc000-0xdfff`) | image/sprite payload、VN font mask、scene pack、spritetext font、PSG pattern data |

`pce_vn_hucard_banks.h` が banks 1..4 を `PCE_ROM_BANK_AT()` で宣言し、runtime 起動直後に slot2..5 へ常駐 map します。asset/VN data は slot6 だけを使うため、visual data を読んでも runtime code bank は外れません。

Sprite は、VRAM/SATB へ実際に書き込む描画側を bank2、状態・pattern layout・animation・移動計算を bank4 に分けます。両 bank は異なる CPU window に常駐するため、相互呼び出しで ROM bank の map 操作は不要です。大きい sprite helper を追加するときはこの責務分離を保ち、片方だけを 8KB 上限近くまで増やさないでください。

`assets.c` では runtime code banks だけ full `PCE_ROM_BANK_AT()` を使います。data banks は `PCE_EDITOR_ROM_DATA_BANK_AT()` の map-only declaration で、不要な `pce_rom_bankN_call()` trampoline を bank0 `.text` に増やしません。

## PSG timing

HuCARD VN の PSG BGM/SFX は HuC6280 TIMER IRQ ではなく、runtime の `wait_vblank()` を通過した安全地点を時間源にします。main loop、palette fade、BG map clear、message window、sprite/SATB 更新などの cooperative service point が VBlank を待った直後に `psg_advance(1)` を呼び、PSG register を main thread だけで更新します。

テンポの不変条件は **「実際に実行した `wait_vblank()` 1 回 = 1 フレーム経過 = `service_psg()`（=`psg_advance(1)`）1 回」** です（`wait_vblank()` は VBlank の「終了 → 開始」を待つため、連続呼び出しでも 1 回につき必ず 1 フレーム消費する）。したがって **新しい VBlank を待つヘルパーは、その直後に `service_psg()` を 1 回ペアで呼びます**。`service_psg_during_blocking_work()` / `map_message_window_cells()` / blocking `flush_msg_tile_batch()` / `upload_sprite_table()` / `apply_effect()` がこれに該当します。

一方、main loop がすでに入った同じ VBlank を使う小さい転送は `_now` helper を使い、追加の `wait_vblank()` と `service_psg()` を呼びません。typewriter の1グリフ転送は `draw_message_next_entry_now()` → `flush_msg_tile_batch_now()`、sprite move/animation は `upload_sprite_table_now()` を通り、main loop末尾の1回だけPSGを進めます。message window の begin/end/hide も自身では待たず、1回だけ待つ `map_message_window_cells()` に委譲します。ここで待機を入れ子にするとゲーム進行が約30Hzになり、serviceを重ねるとPSGだけ倍速、serviceを欠くとPSGが低速になります。

PSG pattern の 1 event は 8 bytes で、末尾 byte 7 は `wave`（0..45）です。CD-ROM2 用に MIDI から再変換した同じ pattern を HuCARD build でも使い、`wave` 未指定時は従来の矩形波 45 とします。HuCARD には System Card ROM の 32-sample 内蔵波形そのものはないため、wave ID はエディタの WebAudio preview と同じ分類で近似します。`1/8/13` は sine、`2/5/11/30/35/43` は saw、`6/20/22/24/25/31` は triangle、その他（45 を含む）は square の 32-sample wave を runtime が生成します。noise event は従来どおり channel 4/5 の noise generator を使います。

song/BGM と SFX は別々の logical voice state を持ちます。SFX が発音している物理 channel だけを一時的に優先し、SFX の note-off・終了・`stop sfx` 後は、その channel の BGM の period/volume/noise/wave を復元します。新しい play は同じ bus だけを置換し、`stop bgm` / `stop sfx` / `stop all` は指定 bus だけを停止します。asset 開始時に全 6 channel の wave/control を初期化してはなりません。これは別 bus の発音とテンポを破壊します。

ただし、**画面に見える 1 枚の面（メッセージウィンドウ BAT など）を複数の `wait_vblank()` に分割して転送しないでください**。`map_message_window_cells()` は `VN_MSG_TILE_ROWS`(=8) 行 × `VN_MSG_TILE_COLS`(=26) word の BAT を **1 回の `wait_vblank()` 内でまとめて**書きます（合計 208 word は 1 VBlank に十分収まる）。以前は行ごとに `wait_vblank()` していたため、ウィンドウの表示/消去が 8 フレームかけて上から下へ「ワイプ」して見えました。CD runtime の同関数も行ごとには待ちません。1 VBlank に収まらない大きい転送（tile ピクセル本体など）だけを `service_psg_during_blocking_work()` で分割し、BAT のような小さい面は 1 VBlank で一括更新します。

TIMER IRQ は HuCARD 側では使いません。過去の TIMER credit 実験では main thread の VBlank service と独立した credit が積まれ、通常時の高速再生や不安定な catch-up を起こしやすかったためです。`IRQ_VDC` は引き続き mask し、VDC の VBlank status latch は polling 用として使います。割り込み内で PSG を直接鳴らす実装も、VDC/SATB/ROM bank 操作と再入して表示破壊を起こしやすいため採用しません。

`wait_vblank()` のstatus polling中だけHuC6280を`CSL`で低速モードにし、終了時に必ず`CSH`へ戻します。待機時間そのものはVDCに同期した1フレームのままですが、高速CPUでVDC statusを連続readする量を減らし、エミュレーターのI/O dispatch負荷も抑えます。

`spritemove`とsprite animationの毎frame更新はmain loopの1回の`wait_vblank()`を共有します。DDAで座標を進めてshadow SATBを組み直した後は`upload_sprite_table_now()`で次VBlank用のSATB DMAをarmし、追加の`wait_vblank()`や`service_psg()`を呼びません。同期moveは完了SATBが反映された次loopでscriptを再開し、async moveは最大4 slotを並行更新します。4 slot分の移動状態はconsole RAM 96 bytes以下です。

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

Test Play は通常の HuCARD ROM と同じく `.pce` を標準エミュレーターまたは外部エミュレーターへ渡します。標準EmulatorJSはbrowser側ですでにframe schedulingするため、内側のVSyncは既定で無効です。重いframeがpresentation deadlineを外したときに次の約30fps段へ固定されることと、それに伴うaudio slowdownを防ぎます。ADPCM、CD-DA、`message.voiceAssetId`、ADPCM cache command は silent no-op です。
