# PCE VN コードオーバーレイ（Path B）運用ガイド / 引き継ぎ

CD-ROM2 VN runtimeの **slot4コードオーバーレイ機構**（物理bank133のrender/compositorとbank124のlogicをCDからロードし、bank121 visual helper、bank122 async/runtime support、bank130 resident codeとMPR4を時分割する）の設計・実装・拡張手順をまとめた引き継ぎドキュメントです。`docs/pce-memory-bank-strategy.md`（バンク全体方針）を前提に、オーバーレイ固有の作業手順とハマりどころを集約します。

> **このファイルを読むタイミング**: VN runtimeのコードが3常駐bank（128/129/130）またはbank124の1024-byte headroom gateを割ったとき、あるいはbank121/122/124/133のslot4 codeへ関数を追加・変更するとき。

> **4つの独立blob**: `overlay.bin`（bank133 render/compositor）、`logic_overlay.bin`（bank124 logic）、`visual_code.bin`（bank121 visual helper）、`cd_async_code.bin`（bank122 async/runtime support）は、それぞれ独立した物理CD fileです。画像・音声・scene・metadataを集約する`vn_payload.bin`には入れません。4つともslot4時分割とfixed entry経由の呼び出し制約を共有します。

## 1. 背景と現状

- HuC6280 は 64KB を 8KB×8 ページ（MPR0-7）で覗く。CD-ROM2 VN では **コード常駐に使える窓は MPR2/3/4（bank128/129/130）の 3 枚＝約24KB だけ**。MPR5(bank131) は System Card/CD-BIOS が使うため毒、MPR6(bank132) は VN generated data、MPR0/1/7 は予約。
- 機能（ADPCM/PSG/sprite/choice/12px フォント合成など）を増やすとこの 3 バンクが埋まり、`ld.lld: section '.ram_bankN' will not fit ... overflowed` が出る。
- **Path B = 未使用物理 bank133 にコードを置き、CD からブート時にロードして slot4 を bank130 と時分割する**機構。
  - **Phase B0（完了・コミット ebb9f78）**: bank133 への CD ロード基盤（no-op オーバーレイ）。
  - **Phase B1（完了・当時の実測）**: 実コード（CD RLE 展開 `cd_rle_ref_to_vram` / `cd_rle_bg_map_ref_to_vram`）をオーバーレイへ退避し、**bank130 を 95% → 55%（7782 → 4494 bytes、約3.3KB）緩和**。Geargrafx で BG/sprite/入力の正常動作を実証済み。
  - **Phase 2（完了）**: RLE 撤去後に空いた overlay へ message グリフコンポジタを退避。VBlank/VDC/SATB/message-window hardening 後の Kitahe build 実測で bank130 は 7686B/8192B、`.vn_overlay` は 2260B/4096B。
  - **Phase 3（完了・全コマンド搭載対応）**: overlay を **op-dispatch 化して物理 bank133 を full 8KB へ解放**（残課題(A)を解消）。`call_overlay_*` の直接呼びを単一固定エントリ `vn_overlay_entry` への間接呼び（literal 0x8000）へ置換し、resident→overlay の reloc を消去。これで `.vn_overlay` を visual-code と同様に **ELF から完全除去＋PT_LOAD 無効化** でき、bank132 末尾の良性 LMA 窓（約4KB上限）を撤廃。予約は 4 sector(8KB)。さらに **scene_pack reader 群 / cache_sprite_animation / cdda_sector_from_remaining / message_glyph_cache_find** を overlay へ退避し、`ishi_no_ura`（全スクリプトコマンド搭載）が bank128=99.84% / bank129=99.61% / bank130=99.77% / `.vn_overlay`=7552B/8192B で **正常リンク**。
  - **Phase 4（現行）**: scene/control decodeとSprite Animation状態をbank124 `.vn_logic_overlay`へ分離し、bank133をmessage/sprite/SATB描画合成へ専念させる。Sprite Animation metadataとSystem PSG metadataはCD on-demand化し、件数比例tableをresident/bank132から除外する。
- **重要な認識**: 常駐コード総枠（128/129/130＝約24KB）は不変です。退避先は責務で選び、logic=124、render=133、visual=121、CD/runtime support=122を混在させません。bank128/129/130/124は各1024 bytesの空きをhard gateで要求します。追加退避時は`-Wl,--print-memory-usage`で全bankを、`llvm-objdump -dr --section=<section>`で別slot4 bankへのrelocationが無いことを必ず確認します。

## 2. アーキテクチャ全体像

| physical bank | section / file | 責務 |
|---:|---|---|
| 121 | `.vn_visual_code` / `visual_code.bin` | visual payload cache、VRAM転送、SpriteText/animation描画補助 |
| 122 | `.vn_cd_async_code` / `cd_async_code.bin` | CD/SCSI async、palette/BAT/SATB、ADPCM support、Sprite catalog/layout/upload |
| 124 | `.vn_logic_overlay` / `logic_overlay.bin` | scene/control decode、Sprite Animation状態など非描画logic |
| 133 | `.vn_overlay` / `overlay.bin` | message glyph、sprite frame、SATBのrender/compositor |

各blobは4 sector（8192 bytes）を予約し、link後にsectionを抽出・8KBへpadしてELFから除去し、対応する`PT_LOAD`を`PT_NULL`化します。bank124とbank128/129/130はlink-map gateで最低1024 bytesの空きを要求します。

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
   tma #$10 で呼出時 MPR4 を保存
   pce_ram_bank133_map()                       → MPR4 = bank133（slot4 が overlay に切替）
   ((fn)PCE_VN_OVERLAY_LOAD_ADDR)(op,a0,a1,a2)  → literal 0x8000 への間接呼び（reloc 無し）→ vn_overlay_entry が op 分岐
   tam #$10 で保存値を復元                    → MPR4 = 呼出時 bank に復帰
   （VDC を触る overlay では IRQ restore）
```

**op-dispatch の要点**: 直接 `call_overlay_xxx()` を呼ぶと resident→overlay の reloc が生まれ、section を ELF に残さざるを得ず（＝bank132 末尾良性 LMA 窓の約4KB上限に縛られる）。Phase 3 では visual-code(`visual_cache_entry`) と同じく **単一固定エントリへの literal 間接呼び**にして reloc を消し、section を丸ごと除去できるようにした。これで物理 bank133 8KB がフルに使える。引数 `op,a0,a1,a2` は通常呼出規約（zp 仮想レジスタ＋HW スタック、常時マップ）に乗るので console_ram グローバルを増やさない（ポインタは 16bit で渡し overlay 側でキャスト）。

VDCを触るbank133 render overlay（message compositor / sprite frame）は`vn_overlay_dispatch_locked`経由で、bank swap全体を`vn_vdc_irq_lock()` / `vn_vdc_irq_unlock()`で囲みます。順序は **caller MPR4保存 → IRQ lock → bank133 map → fixed entry → caller MPR4復元 → IRQ unlock**です。scene/control decodeやAnimation stateの純粋logicはbank124のfixed entryへ分離し、bank133 render dispatcherへ混在させません。bank map後からlockまで等にADPCM/CD external IRQが入るとVDC latch/MAWRを壊しうるため、VDCを触る経路は必ずlockedを使います。

### co-residency（最重要の実行時制約）
- slot4（CPU 0x8000-0x9fff）は **bank130 / bank121 / bank122 / bank124 / bank133** が時分割で共有します。いずれかのblob実行中はbank130と他のslot4 blobが見えません。
- ⇒ **slot4関数はbank130や別slot4 bankの関数を直接呼べません**。呼んでよいのはslot2(bank128)・slot3(bank129)・`always_inline`/MPR6 helper・console_ram(zp)・CD BIOS(MPR7)・同一section内の関数です。別blobへ移る必要がある処理は、一度resident dispatcherへ戻ってからmapし直します。
- dispatcher は **bank128/129（slot2/3）に置く**。bank130 に置くと bank133 map で自分自身が slot4 から消える。
- 引数は zp 仮想レジスタ（console_ram, MPR0/1 常駐）とハードウェアスタック（0x0100-0x01ff）に乗るため、バンク切替を跨いでも保持される。だから dispatcher は任意のシグネチャで機能する。

## 3. 実装ファイルと関数の地図

| 役割 | 場所 |
|---|---|
| オーバーレイ関数の配置タグ `VN_OVERLAY_CODE` | `template/template_pce_vn_cd/src/pce_vn_runtime.c`（マクロ定義部）|
| bank133 宣言 `PCE_RAM_BANK_AT(133, 4)` | 同上（先頭バンク宣言部）|
| visual cache用低位RAM宣言 | 同上。現行の`VN_ENABLE_VISUAL_PAYLOAD_CACHE 1`ではbank121をhelper code、bank104-119をpayload cacheとして使う。bank133 render overlayとは独立 |
| ブート時ローダ | `load_overlay_code()` / `load_logic_overlay_code()` / `load_visual_cache_code()` / `load_cd_async_code()`。現行runtimeは起動時に4 blobをロードする |
| 固定エントリ `vn_overlay_entry(op,a0,a1,a2)`（`VN_OVERLAY_ENTRY_CODE` = `.vn_overlay.entry`、先頭固定） | 同上 |
| 共有 dispatcher `vn_overlay_dispatch`(IRQ ロック無し・純粋関数用) / `vn_overlay_dispatch_locked`(IRQ ロック有り・VDC を触る関数用) | 同上 |
| bank133常駐dispatcher | `draw_message_*_locked`、glyph/sprite/SATB描画呼出。VDCを触る経路はIRQ lock付き |
| bank133退避済み関数（`VN_OVERLAY_CODE`） | message compositor、glyph mask cache、sprite frame、SATB/render合成 |
| bank124 logic配置タグ/固定entry | `VN_LOGIC_OVERLAY_CODE`、`.vn_logic_overlay.entry`。scene/control decode、Sprite Animation状態など非描画logic |
| オーバーレイ定数（link addr/予約 sector/section 名等） | `pce-vn-manager.js`（`VN_OVERLAY_LINK_ADDR` / `VN_OVERLAY_RESERVED_SECTORS` / `VN_OVERLAY_SECTION` / `VN_BANK132_TAIL_VMA`）|
| 予約・fragment 生成・抽出 | `pce-vn-manager.js`: `ensureOverlayReservation` / `writeOverlayFragment` / `overlayLinkerArgs` / `finalizeOverlayBlob` |
| link への `-Wl,-T` 注入 | `pce-build-system.js`: `buildCommandForProject`（`vnManager.overlayLinkerArgs(projectDir)`）|
| link 後の抽出フック | `pce-build-system.js`: `buildProject` の CD 分岐（`finalizePceCdDataPadding` の直前で `vnManager.finalizeOverlayBlob`）|
| 生成される CD ref / load addr | `src/generated/vn.{c,h}`（`pce_vn_overlay_data`、`PCE_VN_OVERLAY_LOAD_ADDR`）|
| visual helper の CD ref / load addr | `src/generated/vn.{c,h}` に `pce_vn_visual_code_data`、`PCE_VN_VISUAL_CODE_LOAD_ADDR` を出す。`visual_code.bin` は bank121/slot4 用で、bank133 overlay とは別に予約・抽出する |
| CD async/runtime helper の CD ref / load addr | `src/generated/vn.{c,h}` に `pce_vn_cd_async_code_data`、`PCE_VN_CD_ASYNC_CODE_LOAD_ADDR` を出す。`cd_async_code.bin` は bank122/slot4 用で、direct SCSI READ(6) / DATA IN serviceとSprite catalog/layout/uploadを担当する。bank133 overlay とは別に予約・抽出する |
| logic overlayのCD ref / load addr | `src/generated/vn.{c,h}`に`pce_vn_logic_overlay_data`、`PCE_VN_LOGIC_OVERLAY_LOAD_ADDR`を出す。`logic_overlay.bin`はbank124/slot4用で、他の3 blobとは別に予約・抽出する |
| 生成されるリンカ fragment | `src/generated/overlay_insert.ld` |

### 現在の定数（`pce-vn-manager.js`）— Phase 4
- `VN_OVERLAY_VRAM_LOAD_ADDR = 0x8000`（実行アドレス＝slot4、dispatcher が literal 間接呼びに使う）
- `VN_OVERLAY_LINK_ADDR = 0x01858000`（`.vn_overlay` の load 領域＝ram_bank133 ORIGIN `0x01850000 + __ram_bank133(=0x8000)`。低16bit=0x8000 で CPU 0x8000 実行。section は抽出後 ELF から除去するので link 専用）
- `VN_OVERLAY_RESERVED_SECTORS = 4`（= 8192 bytes = 物理 bank133 フル。`ishi_no_ura` 全コマンド搭載で実測 7552 bytes）
- `VN_OVERLAY_SECTION = '.vn_overlay'`（出力 section は `.vn_overlay.entry`(先頭) ＋ `.vn_overlay` をマージ）
- `VN_BANK132_TAIL_VMA = 0xd078`：`.ram_bank132_tail`(NOLOAD) の CPU アドレス。固定 write-before-read バッファ（`cd_transfer_scratch` 2KB ＋ `message_glyph_cache_masks` 1632B ＋ BG descriptor cache palette storage 256B）を bank132 末尾に置く。**overlay はもう bank132 末尾に良性コピーを置かない**（bank133 に load 領域を持つ）ので、tail は素の bank132 RAM。メタデータ予算 [0xc000, 0xd078) は不変。
- 旧 `VN_OVERLAY_LMA` / `VN_BANK132_LMA_END` は撤去（良性 LMA 窓が不要になったため）。
- `VN_VISUAL_CODE_LINK_ADDR` / `VN_VISUAL_CODE_RESERVED_SECTORS = 4` / `VN_VISUAL_CODE_SECTION = '.vn_visual_code'` は visual cache helper code 用。overlay と**同じ** 抽出方式（`.entry` 先頭固定 → `--remove-section` → `neutralizeElfLoadSegments()` で bank121 `PT_LOAD` を `PT_NULL` 化）。`pce-mkcd` は section table でなく program header も参照するため、ここを残すと初期ロードヘッダが `$8000` 側へ引っ張られ System Card の `JUST A MOMENT...` で停止しうる。実コードが予約 sector を超えると build error。
- `VN_CD_ASYNC_CODE_LINK_ADDR` / `VN_CD_ASYNC_CODE_RESERVED_SECTORS = 4` / `VN_CD_ASYNC_CODE_SECTION = '.vn_cd_async_code'`はCD/SCSI async・runtime support code用。bank122/slot4へ読み込み、scene pack、ADPCM RAM、System Card PSG packageをfixed entryでserviceし、Sprite descriptor取得・VRAM layout計画・slot単位uploadも担当する。DATA IN中もgeneric VSync user IRQを維持し、各VBlankの`PSG_DRIVE`を止めない。
- `VN_LOGIC_OVERLAY_LINK_ADDR = 0x017c8000` / `VN_LOGIC_OVERLAY_RESERVED_SECTORS = 4` / `VN_LOGIC_OVERLAY_SECTION = '.vn_logic_overlay'`はbank124 logic用です。実行時はMPR4へbank124をmapし、固定entryをliteral `$8000`で呼びます。link gateは実サイズ7168 bytes以下（空き1024 bytes以上）を要求します。

## 4. オーバーレイに関数を追加する手順

1. **退避候補と責務を選ぶ**: message/sprite/SATB描画はbank133、scene/control/Animation logicはbank124、visual transferはbank121、CD/runtime supportはbank122です。呼び出し先にbank130や別slot4 blobを含まない自己完結した関数だけを選びます。
2. **タグを付ける**: bank133は`VN_OVERLAY_CODE`、bank124は`VN_LOGIC_OVERLAY_CODE`を使います。エントリから呼ぶため名前を`xxx_impl`にし、元名はresident dispatcherに使います。同一blob内からしか呼ばれないhelperはretagだけで構いません。
3. **対象blobのopと固定entry分岐を追加**: bank133なら`VN_OVERLAY_OP_xxx` / `vn_overlay_entry`、bank124ならlogic overlay側のop / fixed entryへ追加します。引数はpointer=16bit(`uintptr_t`)・scalar=`a0..a2`へ割り付け、件数比例の引数bufferを増やしません。
4. **常駐dispatcherを足す**: 元名で`VN_BANKED_CODE`（bank129）か`VN_RESIDENT_CODE`（bank128）の薄いwrapperを作り、対象blobをmapしてliteral `$8000`のfixed entryを呼び、元のMPR4へ復元します。VDCを触るbank133経路だけIRQ lockを使います。
   - **dispatcherは必ずbank128/129（slot2/3）に置く**。bank130やslot4 blobに置くとmapした瞬間に自分自身が消えます。
5. **co-residency 検証（必須・reloc ベース）**: build pipelineは対象sectionをELFから除去するので、検証用に **`-Wl,--emit-relocs`を足して別ELFをlink**し、対象の`.rela.<section>`が参照するsymbolを確認します。次はbank133 `.vn_overlay`の例です。⚠️ **アドレスでの判別は不可**: overlay(VMA 0x1858xxx)もbank130(VMA 0x1828xxx)も`R_MOS_ADDR16`は低16bit=0x8xxxに解決されるので、`jsr $8xxx`だけでは内部/bank130を区別できません。relocationの**target symbol/section**で判定します。
   ```sh
   SDK=data/tools/llvm-mos-sdk/llvm-mos/bin
   # <link cmd> に -Wl,--emit-relocs を足して dbg.elf を作る
   $SDK/llvm-objdump -dr --section=.vn_overlay dbg.elf | grep -iE "jsr|jmp|R_MOS"
   ```
  - **許容**: 呼出先relocationが検査中の同一section・`.text+...`(bank128/常駐)・`__memset`等のcompiler-rt(.text)・`.ram_bank129+...`(bank129/slot3)・BIOS。
  - **危険**: `.ram_bank130`、`.vn_visual_code`、`.vn_cd_async_code`、`.vn_logic_overlay`、`.vn_overlay`のうち、検査中sectionとは異なるslot4 sectionへのreloc。その関数も同じ責務のblobへ移すか、resident dispatcherへ一度戻します。
6. **サイズ確認**: render/visual/asyncは予約8192 bytes未満、logicはさらにheadroom gateにより7168 bytes以下であることをbuild logで確認します。超えた処理は同じ責務の範囲で分割するか、runtimeコード自体を削減します。
7. **Geargrafx 検証**（§6）。

## 5. ハマりどころ（B1 で実際に踏んだ罠）

- **pce-mkcdはELFのrelocationを再適用する**ため、抽出対象sectionのrelocationを残すと`File address ... out of range`で失敗します。link後は各blobをbinary抽出し、`.rela.vn_overlay` / `.rela.vn_logic_overlay` / `.rela.vn_visual_code` / `.rela.vn_cd_async_code`と対応section本体をtemp ELFから除去します。resident→blobの直接relocationが残っているとsection除去できないため、fixed entryをliteral `$8000`で間接呼出しすることが前提です。全relocationを消してはいけません。
- **各blobは独自link VMAを持つ**ため、section除去だけでなく対応`PT_LOAD`の`PT_NULL`化が必要です。bank132末尾を良性LMA窓として使う旧方式へ戻してはいけません。
- **CD sector のズレ＝全画面破壊**。`pce_vn_overlay_data` の sector は link 前に確定する（`buildCdDataLayout` がファイルを stat するため、`ensureOverlayReservation` が link 前に予約サイズの overlay.bin を作る）。link 後は実バイトで**同サイズ**上書きするので sector は不変。予約サイズを実コードより小さくしてはいけない。
- **`SHF_ALLOC` を落としても PT_LOAD は消えない**（objcopy はプログラムヘッダを書き換えない）。no-alloc 化で mkcd を回避しようとしても無駄。reloc 除去が正解。
- **Windows での `llvm-objcopy` 解決はドライバ拡張子をコピーしない**。toolchain driver は Windows では `mos-pce-cd-clang.bat`（ラッパー）だが、`llvm-objcopy` は `.exe` のみで `.bat` ラッパーは無い。`finalizeOverlayBlob()` がドライバの `.bat` を流用して `llvm-objcopy.bat` を組むと、(1) 存在せず (2) Node が `.bat`/`.cmd` を `shell:true` 無し spawn で `EINVAL` を投げるため、`overlay objcopy extract failed: ... EINVAL` でビルド失敗する（macOS は無拡張なので顕在化しない）。実バイナリを拡張子プローブ（Win は `.exe` 優先）で解決し、`.bat`/`.cmd` ラッパーしか無いときだけ `shell:true` にフォールバックすること。
- **`.rela.vn_overlay` の strip を in-place で書いてはいけない（Windows）**。`llvm-objcopy --remove-section=.rela.vn_overlay elf`（出力先 = 入力と同一）の in-place 書き換えは、書き込んだ実行ファイルを Defender/インデクサがスキャンするのと競合して、**main.elf を一瞬 0 バイトにする**ことがある。直後の `pce-mkcd` は ELF を mmap して読み取り結果を検証しないため、**空 ELF で SEGSEGV（exit 0xC0000005 = 3221225781）**でクラッシュする（probe mkcd も同じ ELF を読むので一緒に落ち「セクタ数を測定できませんでした」が出る）。**対策**: strip は別 temp ファイルに出力（`objcopy --remove-section=… in out`）し、**サイズ>0 を検証してから `fs.renameSync` で原子的に main.elf へ置換**する。`pce-build-system.js` 側でも mkcd 実行直前に ELF の非空をガードし、空なら segfault でなく明確なエラーにする。macOS はこのスキャナ競合が無いので顕在化しない。`truncated`（途中まで）ELF は mkcd がクリーンエラーを返すが、**0 バイトだけは segfault** する点に注意。
- **`always_inline`ストリームヘルパをnoinline化してはいけない**。ポインタ書き換えが呼出規約を跨ぐとBG/spriteが全く出なくなる。`cd_byte_stream_*` / `vram_byte_writer_*`等はslot4関数内へinline展開し、別のbank130呼出にしない。

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

### (B) 複数オーバーレイ（bank124実装済み）
- bank134/135はSystem Card PSG driverのmain/BGM・sub/SFX package bankです。runtime overlayやMPR6 work bufferとして流用しないでください。
- bank122 は direct CD/SCSI async helper として使用中です。追加 overlay 用に流用しないでください。
- bank124は`.vn_logic_overlay` / `logic_overlay.bin`として使用中です。scene/control/Animation系logicを置き、最低1024 bytesの空きを維持します。bank133 render overlayとの直接相互呼び出しは禁止です。
- **制約**: slot4 を時分割する以上、**同時に map できるオーバーレイは 1 枚**。別オーバーレイ間の直接相互呼び出しは不可（co-residency）。常駐 dispatcher 経由でのみ切替える。あるいは別 slot（ただし空き slot は実質ない）。
- さらに必要な場合はbank125-127を候補とし、descriptor駆動の予約・link fragment・抽出・PT_LOAD無効化へ追加します。bankごとの処理を手作業で複製せず、同じfixed-entry ABIと検証を共有します。

### (C) 退避できないコード
- bank130や複数slot4 blobと密結合する新機能は、そのままでは退避できません。まず責務境界を分け、**自己完結したサブシステム単位**で退避を検討します。

### (D) 根本的なコード削減（オーバーレイより先に検討すべき場合あり）
- テーブル/データ駆動化でbank132/CDへ追い出す。素材（シーン/画像/音声）はcode bank予算を食わないので、増えるのは常にエンジンコード量。

## 8. やってはいけないこと（要約）

- 全`.rela.*`をstripする（mkcdがresident sectionの再配置に使うため壊れる）。除去は4つの抽出対象sectionに対応するrelocationだけ。
- residentから抽出対象sectionへの直接relocationを残したままsectionを除去する。固定entryへのliteral間接呼出しへ変えてから除去する。
- dispatcher を bank130 / overlay に置く（swap 中に自滅）。
- オーバーレイ関数から bank130 関数を呼ぶ（実行中 bank130 不可視 → 暴走）。
- 予約sectorを実コードより小さくする、または4つのblobを予約サイズと違うサイズで残す（後続pack baseとlogical sector aliasがずれる）。
- bank131をコードに使う（System Cardがslot5で実行するため暴走する。配置契約は[pce-memory-bank-strategy.md](pce-memory-bank-strategy.md)を参照）。
- `always_inline` ストリーム/writer ヘルパを noinline 実関数化する（ポインタ書き換えバグで BG/sprite 全消失）。

## 9. 変更時のドキュメント更新

- バンク配置・オーバーレイ機構を変えたら、本ファイルと `docs/pce-memory-bank-strategy.md` を**同じ作業内で**更新すること（CLAUDE.md / AGENTS.md のドキュメント更新ルール）。
- 回帰テストは最低限 `node --test tests/pce-vn-manager.test.js`（オーバーレイの ref/fragment/タグ/CD data 順を検証）と `npm test`。
