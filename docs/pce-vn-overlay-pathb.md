# PCE VN コードオーバーレイ（Path B）運用ガイド / 引き継ぎ

CD-ROM2 VN runtime の **コードオーバーレイ機構**（未使用物理 bank133 へコードを退避し、ブート時に CD からロードして MPR slot4 を bank130 と時分割する）の設計・実装・拡張手順をまとめた引き継ぎドキュメントです。`docs/pce-memory-bank-strategy.md`（バンク全体方針）と [[vn-runtime-code-bank-budget]] メモリの内容を前提に、オーバーレイ固有の作業手順とハマりどころを集約します。

> **このファイルを読むタイミング**: VN runtime のコードが 3 常駐バンク（128/129/130）に収まらず溢れたとき、またはオーバーレイ（bank133）に関数を追加・変更するとき。

> **関連するが別物**: `cache load bg/sprite` 用の visual payload RAM cache は bank133 Path B overlay ではありません。現行の実験版では helper code を `assets/generated/vn/visual_code.bin` として bank121/slot4 へ読み込み、payload page は bank104-119/slot6 に保持します。direct CD/SCSI async helper も bank133 overlay ではなく、`assets/generated/vn/cd_async_code.bin` として bank122/slot4 へ読み込みます。いずれも bank133 overlay を上書きせず、slot4 時分割と fixed entry 経由の呼び出し制約だけを共有します。

## 1. 背景と現状

- HuC6280 は 64KB を 8KB×8 ページ（MPR0-7）で覗く。CD-ROM2 VN では **コード常駐に使える窓は MPR2/3/4（bank128/129/130）の 3 枚＝約24KB だけ**。MPR5(bank131) は System Card/CD-BIOS が使うため毒、MPR6(bank132) は VN generated data、MPR0/1/7 は予約。
- 機能（ADPCM/PSG/sprite/choice/12px フォント合成など）を増やすとこの 3 バンクが埋まり、`ld.lld: section '.ram_bankN' will not fit ... overflowed` が出る。
- **Path B = 未使用物理 bank133 にコードを置き、CD からブート時にロードして slot4 を bank130 と時分割する**機構。
  - **Phase B0（完了・コミット ebb9f78）**: bank133 への CD ロード基盤（no-op オーバーレイ）。
  - **Phase B1（完了・当時の実測）**: 実コード（CD RLE 展開 `cd_rle_ref_to_vram` / `cd_rle_bg_map_ref_to_vram`）をオーバーレイへ退避し、**bank130 を 95% → 55%（7782 → 4494 bytes、約3.3KB）緩和**。Geargrafx で BG/sprite/入力の正常動作を実証済み。
  - **Phase 2（完了）**: RLE 撤去後に空いた overlay へ message グリフコンポジタを退避。VBlank/VDC/SATB/message-window hardening 後の Kitahe build 実測で bank130 は 7686B/8192B、`.vn_overlay` は 2260B/4096B。
  - **Phase 3（完了・全コマンド搭載対応）**: overlay を **op-dispatch 化して物理 bank133 を full 8KB へ解放**（残課題(A)を解消）。`call_overlay_*` の直接呼びを単一固定エントリ `vn_overlay_entry` への間接呼び（literal 0x8000）へ置換し、resident→overlay の reloc を消去。これで `.vn_overlay` を visual-code と同様に **ELF から完全除去＋PT_LOAD 無効化** でき、bank132 末尾の良性 LMA 窓（約4KB上限）を撤廃。予約は 4 sector(8KB)。さらに **scene_pack reader 群 / cache_sprite_animation / cdda_sector_from_remaining / message_glyph_cache_find** を overlay へ退避し、`ishi_no_ura`（全スクリプトコマンド搭載）が bank128=99.84% / bank129=99.61% / bank130=99.77% / `.vn_overlay`=7552B/8192B で **正常リンク**。
- **重要な認識**: Phase 3 で overlay 予約が 4KB→8KB になり、slot4 退避リザーバが約2倍になった（durable headroom）。常駐コード総枠（128/129/130 ＝約24KB）は依然不変なので、機能追加で常駐が溢れたら **純粋関数（delay_frame/bank130/visual_cache を呼ばない自己完結関数）を overlay/bank121 へ退避** するのが基本。direct CD/SCSI helper のように CD bus 契約が異なる処理は bank122 の `.vn_cd_async_code` に分離する。追加退避時は `-Wl,--print-memory-usage` で全 bank を、`llvm-objdump -dr --section=.vn_overlay`（または該当 section）で slot4 別バンクへの reloc が無いことを必ず確認する。

## 2. アーキテクチャ全体像

```
[ビルド時]  ※ Phase 3 以降: visual-code と同じ op-dispatch + ELF 除去方式
 pce_vn_runtime.c の VN_OVERLAY_CODE / VN_OVERLAY_ENTRY_CODE 関数 ──(本体と同一 link)──> main.elf の .vn_overlay
   （独自 load 領域 >ram_bank133、VMA=VN_OVERLAY_LINK_ADDR 0x1858000。低16bit=0x8000 で CPU 0x8000 実行）
   └ 同一コンパイルなので zp 仮想レジスタ・常駐シンボルが解決される
   └ 単一固定エントリ vn_overlay_entry(op,a0,a1,a2) を .vn_overlay.entry に先頭固定
 link 後: llvm-objcopy で .vn_overlay を overlay.bin に抽出（予約 4 sector=8KB に pad）
          + .rela.vn_overlay と .vn_overlay section 本体を main.elf から除去
          + neutralizeElfLoadSegments() で ram_bank133 の PT_LOAD を PT_NULL 化（mkcd/IPL が初期像に含めない）
 mkcd: main.elf（除去済）+ overlay.bin（CD data file）を ISO へ

[ブート時]
 IPL が bank128-132 を RAM へ自動ロード（bank133 は対象外）
 init_video() の load_overlay_code() が overlay.bin を CD から bank133(CPU 0x8000) へ 8KB ストリーム

[実行時]
 常駐コード(bank128/129) の dispatcher が:
   （VDC を触る overlay では IRQ mask = vn_overlay_dispatch_locked、純粋関数は vn_overlay_dispatch）
   pce_ram_bank133_map()                       → MPR4 = bank133（slot4 が overlay に切替）
   ((fn)PCE_VN_OVERLAY_LOAD_ADDR)(op,a0,a1,a2)  → literal 0x8000 への間接呼び（reloc 無し）→ vn_overlay_entry が op 分岐
   pce_ram_bank130_map()                       → MPR4 = bank130 に復帰
   （VDC を触る overlay では IRQ restore）
```

**op-dispatch の要点**: 直接 `call_overlay_xxx()` を呼ぶと resident→overlay の reloc が生まれ、section を ELF に残さざるを得ず（＝bank132 末尾良性 LMA 窓の約4KB上限に縛られる）。Phase 3 では visual-code(`visual_cache_entry`) と同じく **単一固定エントリへの literal 間接呼び**にして reloc を消し、section を丸ごと除去できるようにした。これで物理 bank133 8KB がフルに使える。引数 `op,a0,a1,a2` は通常呼出規約（zp 仮想レジスタ＋HW スタック、常時マップ）に乗るので console_ram グローバルを増やさない（ポインタは 16bit で渡し overlay 側でキャスト）。

VDC を触る overlay（message compositor / sprite frame）は `vn_overlay_dispatch_locked` 経由で、bank swap 全体を `vn_vdc_irq_lock()` / `vn_vdc_irq_unlock()` で囲みます。順序は **IRQ lock → `pce_ram_bank133_map()` → overlay → `pce_ram_bank130_map()` → IRQ unlock**。純粋関数（scene_pack reader 等、VDC を触らない）は `vn_overlay_dispatch`（IRQ ロック無し、visual_cache_call と同様）。bank133 map 後から lock まで等に ADPCM/CD external IRQ が入ると VDC latch/MAWR を壊しうるため、VDC を触る経路は必ず locked を使う。

### co-residency（最重要の実行時制約）
- slot4（CPU 0x8000-0x9fff）は **bank130 / bank133(overlay) / bank121(visual-code)** が時分割で共有する。オーバーレイ実行中は **bank130 が見えない**。
- ⇒ **オーバーレイ関数は bank130 の関数を呼べない**。呼んでよいのは slot2(bank128)・slot3(bank129)・`always_inline`/`map_vn_data`(slot6) ヘルパ・console_ram(zp)・CD BIOS(MPR7) のみ。**`delay_frame()` は `pce_ram_bank130_map()` を含む**ため overlay からは呼べない（フレーム待ちを伴う関数・CD read で `service_psg`(bank130 map) を経由する `vn_get_*_asset` 系も不可）。退避候補は純粋デコーダ/純粋計算/bank132 read のみの自己完結関数に限る。
- dispatcher は **bank128/129（slot2/3）に置く**。bank130 に置くと bank133 map で自分自身が slot4 から消える。
- 引数は zp 仮想レジスタ（console_ram, MPR0/1 常駐）とハードウェアスタック（0x0100-0x01ff）に乗るため、バンク切替を跨いでも保持される。だから dispatcher は任意のシグネチャで機能する。

## 3. 実装ファイルと関数の地図

| 役割 | 場所 |
|---|---|
| オーバーレイ関数の配置タグ `VN_OVERLAY_CODE` | `template/template_pce_vn_cd/src/pce_vn_runtime.c`（マクロ定義部）|
| bank133 宣言 `PCE_RAM_BANK_AT(133, 4)` | 同上（先頭バンク宣言部）|
| visual cache 用低位 RAM 宣言 | 同上。`VN_ENABLE_VISUAL_PAYLOAD_CACHE 1` の実験版では bank121 を helper code、bank104-119 を payload cache として使う。Path B overlay ではない |
| ブート時ローダ `load_overlay_code()` | 同上（`init_video()` から呼ぶ）|
| ブート時ローダ `load_visual_cache_code()` | 同上。標準 runtime では無効で `init_video()` から呼ばれない |
| 固定エントリ `vn_overlay_entry(op,a0,a1,a2)`（`VN_OVERLAY_ENTRY_CODE` = `.vn_overlay.entry`、先頭固定） | 同上 |
| 共有 dispatcher `vn_overlay_dispatch`(IRQ ロック無し・純粋関数用) / `vn_overlay_dispatch_locked`(IRQ ロック有り・VDC を触る関数用) | 同上 |
| 常駐 dispatcher（元名を保持）`draw_message_*_locked` / `call_overlay_preload_message_glyph_masks` / `call_overlay_draw_message_glyph_at` / `call_overlay_show_sprite_slot` / `refresh_scene_sprite_patterns` / `scene_pack_read_*` / `cache_sprite_animation` / `cdda_sector_from_remaining` | 同上 |
| 退避済み関数（`VN_OVERLAY_CODE`）: message compositor（`draw_message_*` / glyph mask cache / `message_glyph_cache_find`）、sprite（`show_character_sprite_frame` / `_slot` / `refresh_scene_sprite_patterns_impl`）、scene_pack decoder（`scene_pack_read_*_impl` / `scene_pack_u16` / `scene_pack_s16`）、`cache_sprite_animation_impl` / `cdda_sector_from_remaining_impl` | 同上 |
| オーバーレイ定数（link addr/予約 sector/section 名等） | `pce-vn-manager.js`（`VN_OVERLAY_LINK_ADDR` / `VN_OVERLAY_RESERVED_SECTORS` / `VN_OVERLAY_SECTION` / `VN_BANK132_TAIL_VMA`）|
| 予約・fragment 生成・抽出 | `pce-vn-manager.js`: `ensureOverlayReservation` / `writeOverlayFragment` / `overlayLinkerArgs` / `finalizeOverlayBlob` |
| link への `-Wl,-T` 注入 | `pce-build-system.js`: `buildCommandForProject`（`vnManager.overlayLinkerArgs(projectDir)`）|
| link 後の抽出フック | `pce-build-system.js`: `buildProject` の CD 分岐（`finalizePceCdDataPadding` の直前で `vnManager.finalizeOverlayBlob`）|
| 生成される CD ref / load addr | `src/generated/vn.{c,h}`（`pce_vn_overlay_data`、`PCE_VN_OVERLAY_LOAD_ADDR`）|
| visual helper の CD ref / load addr | `src/generated/vn.{c,h}` に `pce_vn_visual_code_data`、`PCE_VN_VISUAL_CODE_LOAD_ADDR` を出す。`visual_code.bin` は bank121/slot4 用で、bank133 overlay とは別に予約・抽出する |
| CD async helper の CD ref / load addr | `src/generated/vn.{c,h}` に `pce_vn_cd_async_code_data`、`PCE_VN_CD_ASYNC_CODE_LOAD_ADDR` を出す。`cd_async_code.bin` は bank122/slot4 用で、direct SCSI READ(6) / DATA IN service を担当する。bank133 overlay とは別に予約・抽出する |
| 生成されるリンカ fragment | `src/generated/overlay_insert.ld` |

### 現在の定数（`pce-vn-manager.js`）— Phase 3
- `VN_OVERLAY_VRAM_LOAD_ADDR = 0x8000`（実行アドレス＝slot4、dispatcher が literal 間接呼びに使う）
- `VN_OVERLAY_LINK_ADDR = 0x01858000`（`.vn_overlay` の load 領域＝ram_bank133 ORIGIN `0x01850000 + __ram_bank133(=0x8000)`。低16bit=0x8000 で CPU 0x8000 実行。section は抽出後 ELF から除去するので link 専用）
- `VN_OVERLAY_RESERVED_SECTORS = 4`（= 8192 bytes = 物理 bank133 フル。`ishi_no_ura` 全コマンド搭載で実測 7552 bytes）
- `VN_OVERLAY_SECTION = '.vn_overlay'`（出力 section は `.vn_overlay.entry`(先頭) ＋ `.vn_overlay` をマージ）
- `VN_BANK132_TAIL_VMA = 0xd078`：`.ram_bank132_tail`(NOLOAD) の CPU アドレス。固定 write-before-read バッファ（`cd_transfer_scratch` 2KB ＋ `message_glyph_cache_masks` 1632B ＋ BG descriptor cache palette storage 256B）を bank132 末尾に置く。**overlay はもう bank132 末尾に良性コピーを置かない**（bank133 に load 領域を持つ）ので、tail は素の bank132 RAM。メタデータ予算 [0xc000, 0xd078) は不変。
- 旧 `VN_OVERLAY_LMA` / `VN_BANK132_LMA_END` は撤去（良性 LMA 窓が不要になったため）。
- `VN_VISUAL_CODE_LINK_ADDR` / `VN_VISUAL_CODE_RESERVED_SECTORS = 4` / `VN_VISUAL_CODE_SECTION = '.vn_visual_code'` は visual cache helper code 用。overlay と**同じ** 抽出方式（`.entry` 先頭固定 → `--remove-section` → `neutralizeElfLoadSegments()` で bank121 `PT_LOAD` を `PT_NULL` 化）。`pce-mkcd` は section table でなく program header も参照するため、ここを残すと初期ロードヘッダが `$8000` 側へ引っ張られ System Card の `JUST A MOMENT...` で停止しうる。実コードが予約 sector を超えると build error。
- `VN_CD_ASYNC_CODE_LINK_ADDR` / `VN_CD_ASYNC_CODE_RESERVED_SECTORS = 4` / `VN_CD_ASYNC_CODE_SECTION = '.vn_cd_async_code'` は direct CD/SCSI async helper code 用。bank122/slot4 に読み込み、scene pack cache の CPU RAM read は System Card BIOS の `pce_cdb_cd_read()` ではなくこの fixed entry を毎 loading frame で service する。DATA IN 中は `quiet_cd_unit_irqs()` を呼ばず、TIMER は runtime 所有のままにする。

## 4. オーバーレイに関数を追加する手順

1. **退避候補を選ぶ**: 呼び出し先が bank130/visual_cache/`delay_frame` を含まない自己完結した関数を選ぶ（後述の検証で確認）。純粋デコーダ（scene_pack reader）・純粋計算（cdda_sector）・bank132 read のみ（cache_sprite_animation）が好適。**全部が overlay-internal でしか呼ばれない関数なら、retag だけで dispatcher 不要**（例: `message_glyph_cache_find`）。
2. **タグを付ける**: 対象関数を `VN_BANKED_CODE/CODE2` から `VN_OVERLAY_CODE` に変更。エントリから呼ぶため名前を `xxx_impl` にし、元の名前は dispatcher に使う（呼び出し元を変えない）。エントリ(4369付近)より後ろに定義する場合は forward 宣言を足す。
3. **op を足してエントリに分岐を追加**: `VN_OVERLAY_OP_xxx` を定義し、`vn_overlay_entry(op,a0,a1,a2)` に `if (o==VN_OVERLAY_OP_xxx) return xxx_impl(...);` を追加。引数はポインタ=16bit(`(uintptr_t)`)・スカラ=a2 等に割付。
4. **常駐 dispatcher を足す**: 元の名前で `VN_BANKED_CODE`（bank129）か `VN_RESIDENT_CODE`（bank128）の薄い wrapper を作り、純粋関数は `vn_overlay_dispatch(op,...)`、VDC を触る関数は `vn_overlay_dispatch_locked(op,...)` を呼ぶ。`#else`(非CD) は `_impl` を直接呼ぶ。
   - **dispatcher は必ず bank128/129（slot2/3）に置く**。bank130 や overlay に置くと bank133 map で自分自身が消える。
6. **co-residency 検証（必須・reloc ベース）**: build pipeline は `.vn_overlay` を ELF から除去するので、検証用に **`-Wl,--emit-relocs` を足して別 elf を link** し、`.rela.vn_overlay` の参照シンボルを確認する。⚠️ **アドレスでの判別は不可**: overlay(VMA 0x1858xxx) も bank130(VMA 0x1828xxx) も `R_MOS_ADDR16` は低16bit=0x8xxx に解決されるので、`jsr $8xxx` だけでは内部/bank130 を区別できない。reloc の**ターゲット symbol/section**で見る。
   ```sh
   SDK=data/tools/llvm-mos-sdk/llvm-mos/bin
   # <link cmd> に -Wl,--emit-relocs を足して dbg.elf を作る
   $SDK/llvm-objdump -dr --section=.vn_overlay dbg.elf | grep -iE "jsr|jmp|R_MOS"
   ```
  - **許容**: 呼出先 reloc が `.vn_overlay+...`(内部)・`.text+...`(bank128/常駐)・`__memset` 等の compiler-rt(.text)・`.ram_bank129+...`(bank129/slot3)・BIOS。
  - **危険**: `.ram_bank130+...` / `.ram_bank121+...`（slot4 を時分割する別バンク）への reloc。その関数も一緒に退避するか、退避をやめる。本 Phase 3 では全 228 件の JSR/JMP が `.vn_overlay`/`.text`/`__memset` のみで bank130 ゼロを確認済み。
7. **サイズ確認**: ビルドログの「PCE VN overlay blob: N bytes (reserved 8192, full bank133)」。`N > 8192` だと build error（物理 bank133 8KB 上限）。超えたら bank121 visual-code への退避や runtime コード削減を検討。
8. **Geargrafx 検証**（§6）。

## 5. ハマりどころ（B1 で実際に踏んだ罠）

- **pce-mkcd は ELF の relocation を再適用する**（`strings bin/pce-mkcd` に `Relocating @ ... / File address %08X out of range`）。オーバーレイは実行アドレス VMA=0x8000 を持つため、その内部 reloc を残すと mkcd が `File address 0x8001 out of range` で失敗する。
  - **対策**: link 後に `llvm-objcopy --remove-section=.rela.vn_overlay` で **オーバーレイの内部 reloc テーブルだけ除去**する。lld が既に適用済みなので overlay.bin は完成形。**全 reloc を消してはいけない**（mkcd が他バンクの再配置に使う）。`.vn_overlay` セクション本体は残す（消すと dispatcher の reloc が宙に浮いて objcopy が拒否する）。
- **VMA≠LMA は基本 NG**。mkcd は reloc 適用時に VMA==LMA を前提とする。本機構が VMA(0x8000)≠LMA(bank132末尾) でも通るのは、上記で **オーバーレイの reloc を消している**ため。VMA を変えるなら必ずこの除去とセットで考える。
- **CD sector のズレ＝全画面破壊**。`pce_vn_overlay_data` の sector は link 前に確定する（`buildCdDataLayout` がファイルを stat するため、`ensureOverlayReservation` が link 前に予約サイズの overlay.bin を作る）。link 後は実バイトで**同サイズ**上書きするので sector は不変。予約サイズを実コードより小さくしてはいけない。
- **`SHF_ALLOC` を落としても PT_LOAD は消えない**（objcopy はプログラムヘッダを書き換えない）。no-alloc 化で mkcd を回避しようとしても無駄。reloc 除去が正解。
- **Windows での `llvm-objcopy` 解決はドライバ拡張子をコピーしない**。toolchain driver は Windows では `mos-pce-cd-clang.bat`（ラッパー）だが、`llvm-objcopy` は `.exe` のみで `.bat` ラッパーは無い。`finalizeOverlayBlob()` がドライバの `.bat` を流用して `llvm-objcopy.bat` を組むと、(1) 存在せず (2) Node が `.bat`/`.cmd` を `shell:true` 無し spawn で `EINVAL` を投げるため、`overlay objcopy extract failed: ... EINVAL` でビルド失敗する（macOS は無拡張なので顕在化しない）。実バイナリを拡張子プローブ（Win は `.exe` 優先）で解決し、`.bat`/`.cmd` ラッパーしか無いときだけ `shell:true` にフォールバックすること。
- **`.rela.vn_overlay` の strip を in-place で書いてはいけない（Windows）**。`llvm-objcopy --remove-section=.rela.vn_overlay elf`（出力先 = 入力と同一）の in-place 書き換えは、書き込んだ実行ファイルを Defender/インデクサがスキャンするのと競合して、**main.elf を一瞬 0 バイトにする**ことがある。直後の `pce-mkcd` は ELF を mmap して読み取り結果を検証しないため、**空 ELF で SEGSEGV（exit 0xC0000005 = 3221225781）**でクラッシュする（probe mkcd も同じ ELF を読むので一緒に落ち「セクタ数を測定できませんでした」が出る）。**対策**: strip は別 temp ファイルに出力（`objcopy --remove-section=… in out`）し、**サイズ>0 を検証してから `fs.renameSync` で原子的に main.elf へ置換**する。`pce-build-system.js` 側でも mkcd 実行直前に ELF の非空をガードし、空なら segfault でなく明確なエラーにする。macOS はこのスキャナ競合が無いので顕在化しない。`truncated`（途中まで）ELF は mkcd がクリーンエラーを返すが、**0 バイトだけは segfault** する点に注意。
- **`always_inline` ストリームヘルパを noinline 化してはいけない**（[[vn-glyph-stream-16bit-escape]] と同クラスのポインタ書き換えバグで BG/sprite が全く出なくなる）。`cd_byte_stream_*` / `vram_byte_writer_*` 等。オーバーレイ関数内ではこれらは inline 展開され、別の bank130 呼び出しにはならない（co-residency 的にも安全）。

## 6. 検証手順（CLI ビルド + Geargrafx）

```sh
# 1) エディタと同一パイプラインで ISO をビルド（untracked ツール）
node tools/dev/vn-cli-build.js
#   → data/projects/my_pce_game/out/my_pce_game.cue

# 2) Geargrafx MCP（mcp__geargrafx__*）で:
#    load_media(my_pce_game.cue) → debug_continue
#    → splash で controller_button(player1, run, press_and_release) → debug_continue
#    → get_screenshot で BG/sprite/メッセージを確認
#    → controller_button(I) で送り、ハングしないことを確認
```

### bank133 にオーバーレイがロードされたかの確認
Geargrafx のメモリエリア **id2 = CDROM RAM 64KB（banks 0x80-0x87 = 128-135）**、offset = `(bank-128)*0x2000`。bank133 ⇒ **offset 0xA000**。
```
read_memory(area=2, offset=A000, size=16)
→ overlay.bin 先頭バイトと一致すれば OK（message compositor のエントリと一致）
```
message typewriter / skip / choice glyph が正常描画されれば、オーバーレイ経由の compositor が動作している証拠。

## 7. 残課題と対応方針（Codex 向け）

### (A) オーバーレイ 4KB 上限の引き上げ → ✅ **解決済み（Phase 3）**
- 上記候補アプローチ 2（PT_LOAD から外す）を採用。**op-dispatch 化で resident→overlay の reloc を消し**、`.vn_overlay` を visual-code と同じく `--remove-section` ＋ `neutralizeElfLoadSegments()` で ELF から完全除去。良性 LMA 窓が不要になり、`.vn_overlay` は独自 load 領域 `>ram_bank133`(VMA `VN_OVERLAY_LINK_ADDR`=0x1858000) へ。予約 `VN_OVERLAY_RESERVED_SECTORS = 4`(8KB) で物理 bank133 フル。`finalizeOverlayBlob()` の上限検査は `realSize > 8192`(bank133 物理) に変更（旧 `VN_OVERLAY_LMA + realSize > VN_BANK132_LMA_END` は撤去）。
- **残る上限**: 物理 bank133 = 8KB。これを超えるなら bank121 visual-code(別の 8KB slot4 退避先)へ分散するか、(B) の追加 overlay、または runtime コード削減。

### (B) 複数オーバーレイ（追加バンク）
- bank134/135 は PSG pattern の CD ストリーム再生バッファとして使用中です。追加 overlay を作る場合は、PSG バッファと同じ物理 bank を共有しない未使用 bank を選んでください。
- bank122 は direct CD/SCSI async helper として使用中です。追加 overlay 用に流用しないでください。
- **制約**: slot4 を時分割する以上、**同時に map できるオーバーレイは 1 枚**。別オーバーレイ間の直接相互呼び出しは不可（co-residency）。常駐 dispatcher 経由でのみ切替える。あるいは別 slot（ただし空き slot は実質ない）。
- 実装は load_overlay_code / dispatcher / 予約・抽出を bank ごとに複製する形になる。

### (C) 退避できないコード
- bank130 常駐コード（グリフ合成・ADPCM 制御・scene pack reader・PSG 等）と密結合する新機能は、トランポリンなしには退避できない。まずは **自己完結したサブシステム単位**で退避を検討する。

### (D) 根本的なコード削減（オーバーレイより先に検討すべき場合あり）
- テーブル/データ駆動化で bank132/CD へ追い出す（[[vn-runtime-code-bank-budget]] の方針）。素材（シーン/画像/音声）は予算を食わないので、増えるのは常にエンジンコード量。

## 8. やってはいけないこと（要約）

- 全 `.rela.*` を strip する（mkcd が再配置に使う → 壊れる）。除去は `.rela.vn_overlay` だけ。
- `.vn_overlay` セクション本体を消す（dispatcher の reloc が宙に浮き objcopy が拒否、かつ dispatcher の呼び先が解決不能）。
- dispatcher を bank130 / overlay に置く（swap 中に自滅）。
- オーバーレイ関数から bank130 関数を呼ぶ（実行中 bank130 不可視 → 暴走）。
- 予約 sector を実コードより小さくする / overlay.bin を予約サイズと違うサイズで残す（CD sector ズレ → 全画面破壊）。
- bank131 をコードに使う（System Card が slot5 で実行 → 暴走。[[vn-12px-font-mask-storage]]）。
- `always_inline` ストリーム/writer ヘルパを noinline 実関数化する（ポインタ書き換えバグで BG/sprite 全消失）。

## 9. 変更時のドキュメント更新

- バンク配置・オーバーレイ機構を変えたら、本ファイルと `docs/pce-memory-bank-strategy.md` を**同じ作業内で**更新すること（CLAUDE.md / AGENTS.md のドキュメント更新ルール）。
- 回帰テストは最低限 `node --test tests/pce-vn-manager.test.js`（オーバーレイの ref/fragment/タグ/CD data 順を検証）と `npm test`。
