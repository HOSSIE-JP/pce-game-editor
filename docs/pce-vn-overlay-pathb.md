# PCE VN コードオーバーレイ（Path B）運用ガイド / 引き継ぎ

CD-ROM2 VN runtime の **コードオーバーレイ機構**（未使用物理 bank133 へコードを退避し、ブート時に CD からロードして MPR slot4 を bank130 と時分割する）の設計・実装・拡張手順をまとめた引き継ぎドキュメントです。`docs/pce-memory-bank-strategy.md`（バンク全体方針）と [[vn-runtime-code-bank-budget]] メモリの内容を前提に、オーバーレイ固有の作業手順とハマりどころを集約します。

> **このファイルを読むタイミング**: VN runtime のコードが 3 常駐バンク（128/129/130）に収まらず溢れたとき、またはオーバーレイ（bank133）に関数を追加・変更するとき。

## 1. 背景と現状

- HuC6280 は 64KB を 8KB×8 ページ（MPR0-7）で覗く。CD-ROM2 VN では **コード常駐に使える窓は MPR2/3/4（bank128/129/130）の 3 枚＝約24KB だけ**。MPR5(bank131) は System Card/CD-BIOS が使うため毒、MPR6(bank132) は VN generated data、MPR0/1/7 は予約。
- 機能（ADPCM/PSG/sprite/choice/12px フォント合成など）を増やすとこの 3 バンクが埋まり、`ld.lld: section '.ram_bankN' will not fit ... overflowed` が出る。
- **Path B = 未使用物理 bank133 にコードを置き、CD からブート時にロードして slot4 を bank130 と時分割する**機構。
  - **Phase B0（完了・コミット ebb9f78）**: bank133 への CD ロード基盤（no-op オーバーレイ）。
  - **Phase B1（完了・当時の実測）**: 実コード（CD RLE 展開 `cd_rle_ref_to_vram` / `cd_rle_bg_map_ref_to_vram`）をオーバーレイへ退避し、**bank130 を 95% → 55%（7782 → 4494 bytes、約3.3KB）緩和**。Geargrafx で BG/sprite/入力の正常動作を実証済み。
  - **Phase 2（完了）**: RLE 撤去後に空いた overlay へ message グリフコンポジタを退避。VBlank/VDC/SATB/message-window hardening 後の Kitahe build 実測で bank130 は 7545B/8192B、`.vn_overlay` は 2260B/4096B。
- **重要な認識**: B1 で得た余白は「一度きりの約3.3KB ＋ 再利用可能な退避の仕組み」。常駐コード総枠（3バンク＝約24KB）は増えていない。Phase 2 後も overlay は 4KB 予約内だが、追加退避時は `-Wl,--print-memory-usage` と `llvm-size -A` で bank128/129/130/`.vn_overlay` を必ず確認する。

## 2. アーキテクチャ全体像

```
[ビルド時]
 pce_vn_runtime.c の VN_OVERLAY_CODE 関数 ──(本体と同一 link)──> main.elf の .vn_overlay (VMA 0x8000, LMA bank132 末尾)
   └ 同一コンパイルなので zp 仮想レジスタ・常駐シンボルが解決される
 link 後: llvm-objcopy で .vn_overlay を overlay.bin に抽出（予約 2 sector に pad）
          + .rela.vn_overlay を main.elf から除去（mkcd の reloc 再適用を回避）
 mkcd: main.elf（除去済）+ overlay.bin（CD data file）を ISO へ

[ブート時]
 IPL が bank128-132 を RAM へ自動ロード（bank133 は対象外）
 init_video() の load_overlay_code() が overlay.bin を CD から bank133(CPU 0x8000) へストリーム

[実行時]
 常駐コード(bank128) の call_overlay_* ラッパが:
   （VDC を触る overlay では IRQ mask）
   pce_ram_bank133_map()  → MPR4 = bank133（slot4 が overlay に切替）
   overlay 関数を JSR 0x8000 で実行
   pce_ram_bank130_map()  → MPR4 = bank130 に復帰
   （VDC を触る overlay では IRQ restore）
```

VDC を触る overlay（message compositor など）は、上の bank swap 全体を `vn_vdc_irq_lock()` / `vn_vdc_irq_unlock()` で囲みます。順序は **IRQ lock → `pce_ram_bank133_map()` → overlay 関数 → `pce_ram_bank130_map()` → IRQ unlock** です。bank133 map 後から lock まで、または unlock 後から bank130 復帰までに ADPCM/CD external IRQ が入ると、slot4 が bank133 の状態を IRQ 側へ見せたり、VDC latch/MAWR を壊して数フレームだけ BG/メッセージが崩れることがあります。

### co-residency（最重要の実行時制約）
- slot4（CPU 0x8000-0x9fff）は **bank130 と bank133 が時分割**で共有する。オーバーレイ実行中は **bank130 が見えない**。
- ⇒ **オーバーレイ関数は bank130 の関数を呼べない**。呼んでよいのは slot2(bank128)・slot3(bank129)・`always_inline` ヘルパ・console_ram(zp)・CD BIOS(MPR7) のみ。
- 引数は zp 仮想レジスタ（console_ram, MPR0/1 常駐）とハードウェアスタック（0x0100-0x01ff）に乗るため、バンク切替を跨いでも保持される。だから dispatcher は任意のシグネチャで機能する。

## 3. 実装ファイルと関数の地図

| 役割 | 場所 |
|---|---|
| オーバーレイ関数の配置タグ `VN_OVERLAY_CODE` | `template/template_pce_vn_cd/src/pce_vn_runtime.c`（マクロ定義部）|
| bank133 宣言 `PCE_RAM_BANK_AT(133, 4)` | 同上（先頭バンク宣言部）|
| ブート時ローダ `load_overlay_code()` | 同上（`init_video()` から呼ぶ）|
| 常駐 dispatcher `draw_message_next_glyph_locked` / `draw_message_text_locked` / `call_overlay_preload_message_glyph_masks` / `call_overlay_draw_message_glyph_at` | 同上 |
| 退避済み関数 `draw_message_glyph_at` / `draw_message_next_glyph` / `draw_message_text` / `preload_message_glyph_masks` / message compositor helper 群 | 同上（`VN_OVERLAY_CODE` タグ）|
| オーバーレイ定数（LMA/予約 sector/section 名等） | `pce-vn-manager.js`（`VN_OVERLAY_*`）|
| 予約・fragment 生成・抽出 | `pce-vn-manager.js`: `ensureOverlayReservation` / `writeOverlayFragment` / `overlayLinkerArgs` / `finalizeOverlayBlob` |
| link への `-Wl,-T` 注入 | `pce-build-system.js`: `buildCommandForProject`（`vnManager.overlayLinkerArgs(projectDir)`）|
| link 後の抽出フック | `pce-build-system.js`: `buildProject` の CD 分岐（`finalizePceCdDataPadding` の直前で `vnManager.finalizeOverlayBlob`）|
| 生成される CD ref / load addr | `src/generated/vn.{c,h}`（`pce_vn_overlay_data`、`PCE_VN_OVERLAY_LOAD_ADDR`）|
| 生成されるリンカ fragment | `src/generated/overlay_insert.ld` |

### 現在の定数（`pce-vn-manager.js`）
- `VN_OVERLAY_VRAM_LOAD_ADDR = 0x8000`（実行アドレス＝slot4）
- `VN_OVERLAY_RESERVED_SECTORS = 2`（= 4096 bytes、CD/bank133 への固定予約。Phase 2 + VBlank/VDC/SATB/message-window hardening 後の Kitahe build 実測で 2260 bytes）
- `VN_OVERLAY_LMA = 0x0184d000`（bank132 末尾 CPU 0xd000、良性 LMA）
- `VN_OVERLAY_SECTION = '.vn_overlay'`

## 4. オーバーレイに関数を追加する手順

1. **退避候補を選ぶ**: 呼び出し先が bank130 を含まない自己完結した関数を選ぶ（後述の検証で確認）。RLE 展開のような「CD→VRAM のストリーミング処理」が好適。
2. **タグを付ける**: `template/template_pce_vn_cd/src/pce_vn_runtime.c` で対象関数を `VN_BANKED_CODE2`（bank130）等から `VN_OVERLAY_CODE` に変更。
3. **呼び出し元をラップする**: その関数を呼ぶ常駐コード（bank128 の `.text`、untagged）から、`call_overlay_*` ラッパ経由で呼ぶ。ラッパは `pce_ram_bank133_map()` → 関数 → `pce_ram_bank130_map()` の形（`#if defined(__PCE_CD__)` で囲み、非 CD は直接呼び出し）。VDC を触る overlay では、この 3 手を IRQ lock/unlock で外側から囲む。
   - **ラッパは必ず常駐（untagged = bank128）に置く**。bank130 や overlay に置くと swap 中に自分自身が消える。
4. **ビルド**: `node tools/dev/vn-cli-build.js`
5. **co-residency 検証（必須）**: ビルド後の elf でオーバーレイの外部呼び出し先を確認する。
   ```sh
   SDK=data/tools/llvm-mos-sdk/llvm-mos/bin
   PROJ=data/projects/my_pce_game
   # オーバーレイ範囲（__vn_overlay_start..__vn_overlay_end）を確認
   $SDK/llvm-readelf -s $PROJ/out/my_pce_game.elf | grep -E "__vn_overlay_(start|end)"
   # JSR/JMP 先を列挙。0x8000-0x9fff(slot4) への "非内部" ジャンプがあれば bank130 を呼んでいる＝危険
   $SDK/llvm-objdump -d --section=.vn_overlay $PROJ/out/my_pce_game.elf | grep -iE "jsr|jmp"
   ```
  - 許容される外部呼び出し: `0x4000-0x5fff`(bank128/slot2)、`0x6000-0x7fff`(bank129/slot3)、`0xe000+`(BIOS/MPR7)。
  - **危険**: オーバーレイ範囲外の `0x8000-0x9fff` への JSR/JMP（= 退避し忘れた bank130 関数を呼んでいる）。その関数も一緒に退避するか、退避をやめる。
6. **サイズ確認**: ビルドログの「PCE VN overlay blob: N bytes (reserved ...)」。`N > 4096` だと build error（4KB 上限）。
7. **Geargrafx 検証**（§6）。

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

### (A) オーバーレイ 4KB 上限の引き上げ
- **現状の上限は物理 bank133(8KB) ではなく、良性 LMA の置き場所（bank132 末尾 0xd000-0xdfff = 4KB）**。Phase 2 + VBlank/VDC/SATB/message-window hardening 後の Kitahe 実測は 2260B で、残りは約1836B。
- **着眼点**: オーバーレイの LMA コピーは**実行時に一切読まれない**（実体は CD から bank133 へロードする）。LMA は「(a) link が通る」「(b) IPL がロードしても何も壊さない」だけ満たせばよい。
- **候補アプローチ**（要・Geargrafx 実証）:
  1. LMA をより広い良性領域へ移す（例: bank132 のデータ配置を見直して連続 8KB を確保、または別の常駐バンクの空き末尾）。Phase B1 直後は bank130 末尾に約3.7KB の空きがあったが、直近 meta build では bank128/129/130 ともほぼ満杯で、bank130 は残り37Bしかない点に注意。
  2. `.vn_overlay` を PT_LOAD から完全に外す（PHDRS 制御 or 別 elf へ分離）。外せれば LMA 制約が消え bank133 フル(8KB)まで使える。`--set-section-flags` での alloc 落としは PT_LOAD を消せなかった（§5）ので、PHDRS を持つ別フラグメント or link 後の segment 編集が要る。
  3. 予約サイズ `VN_OVERLAY_RESERVED_SECTORS` は CD/bank133 側の footprint。bank133 は 8KB あるので予約は最大 4 sector まで上げられる（上限を上げても LMA 制約が先に効く点に注意）。

### (B) 複数オーバーレイ（bank134/135）
- bank134/135 も未使用＆CD ロード可能。同じ機構で 2 枚目以降を追加できる。
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
