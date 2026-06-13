# CD-ROM2 テンプレート ビルド失敗 / 表示崩壊 — 調査と修正記録

作成: 2026-06-13 / 調査・実装: Claude Code（Geargrafx MCP で特定・検証）
関連: [pce-memory-bank-strategy.md](pce-memory-bank-strategy.md), [AGENTS.md](../AGENTS.md)

## ★ 実装完了サマリ（2026-06-13）

リンクオーバーフローと表示崩壊（BG/スプライト/テキストが出ない）は **同一の根本原因＝CD BIOS グラフィックドライバ（`PCE_CDB_USE_GRAPHICS_DRIVER`）** だった。対応済み:

- **グラフィックドライバを無効化**（`PCE_CDB_USE_GRAPHICS_DRIVER(0)`）し、VDC を直接制御に統一。VBlank は `PCE_CDB_MASK_VBLANK_NO_BIOS` で有効化し、`pce_cdb_wait_vblank()` が参照する BIOS R5 shadow (`$F3/$F4`) も runtime の `set_vdc_control()` で更新する。これで (a) ドライバ VBLANK ハンドラによる VDW=0 / sprite bit 上書き（表示崩壊）が消え、(b) console_ram が 6583→7472B に拡大、(c) bank130/131 がドライバ占有から解放。
  - `pce_cdb_vdc_*`（set_resolution / bg_set_size / set_copy / bg_sprite_enable・disable / sprite_enable・disable / sprite_table_set_vram_addr / sprite_table_put）を `pce_vdc_*`（直接）へ置換。CD core（`pce_cdb_cd_read` / cdda / adpcm / `pce_cdb_wait_vblank`）は維持し、VBlank IRQ だけ BIOS 表示処理なしにする。
- **オーバーフロー解消**: ビルドを `-Oz` 化（[pce-build-system.js](../pce-build-system.js) の CD args）。scene pack reader を banked code へ退避（`scene_pack_read_command/message`→bank129、`scene_pack_read_choice/choice_option`→新規 bank130 を `pce_ram_bank130_map()` で常駐）。別シーン先読みバッファ `vn_preload_scene_pack_data`(4096B) を廃止（先読みはスキップしシーン入場時に通常ロード）。
- 対象は `template/template_pce_vn_cd/src/pce_vn_runtime.c`（ビルド毎に `syncVisualNovelRuntime` で全プロジェクトへ同期）。
- **検証**: `-Oz` でリンク成功 / `node tests/run-tests.js` 78件全合格 / Geargrafx で背景・テキスト・スプライトが正常描画され、R05=0x04C8、R13(VDW)=0x00DF、R14(VCR)=0x000C が描画中も維持されることを確認（旧来は R13 や sprite bit が BIOS 側に潰れていた）。スプライト pattern の VRAM ロード、SATB、パレットも正常。

> 以下は調査時の詳細記録（原因特定の根拠）。

---

## 1. 症状（再現済み）

PCE Game Editor で CD-ROM2（VN）テンプレートから新規プロジェクトを作成しビルドすると、リンク時に失敗する。`out/` には `pce_cd_data_padding.bin` だけが残り、ELF / ISO は生成されない。

実際のエラー（`mos-pce-cd-clang` リンク段）:

```
ld.lld: error: section '.text'    will not fit in region 'ram_bank128': overflowed by 3811 bytes
ld.lld: error: section '.rodata'  will not fit in region 'ram_bank128': overflowed by 4174 bytes
ld.lld: error: section '.data'    will not fit in region 'ram_bank128': overflowed by 4176 bytes
ld.lld: error: section '.zp.data' will not fit in region 'ram_bank128': overflowed by 4176 bytes
ld.lld: error: section '.bss'     will not fit in region 'console_ram': overflowed by 4462 bytes
ld.lld: error: section '.noinit'  will not fit in region 'console_ram': overflowed by 4585 bytes
mos-pce-cd-clang: error: ld.lld command failed with exit code 1
```

> 注意: これは **リンク時（ビルド時）エラー**であり、ROM/ISO が生成されないため **Geargrafx（ランタイムエミュレータ）では観測できない**。Geargrafx はビルドが通った後の VDC/SATB/sprite 検証用（[pce-memory-bank-strategy.md](pce-memory-bank-strategy.md) §変更時の確認）に使う。今回の原因特定はリンカマップ + オブジェクトのシンボル解析で行った。

## 2. 再現コマンド

```sh
PROJ=data/projects/my_pce_game22      # テンプレート由来の失敗プロジェクト（1123 でも同一エラー）
BIN=data/tools/llvm-mos-sdk/llvm-mos/bin
cd "$PROJ"
"$OLDPWD/$BIN/mos-pce-cd-clang" -Os -DPCE_EDITOR_TARGET_CD=1 \
  -o out/test.elf src/main.c src/generated/assets.c src/generated/vn.c
```

エディタの実ビルドコマンドは [pce-build-system.js:538](../pce-build-system.js) `buildCommandForProject()` と同一。

## 3. 根本原因

CD-ROM2 VN ランタイム（`template/template_pce_vn_cd/src/pce_vn_runtime.c`、単一の実体）の**コードと作業 RAM が固定メモリ予算を超過**した。プロジェクト固有ではなく、テンプレートを新規展開しただけで再現する（成功痕跡のある `1123` も**現在のソースでは同じく失敗**する＝既存 ISO は肥大化前の古い成果物）。

メモリ領域（`mos-platform/pce-cd/lib/`、各 RAM バンク = 0x2000 = 8192 byte）:

| 領域 | 用途 | 容量 | 現在の需要 | 判定 |
|---|---|---:|---:|---|
| `ram_bank128` (MPR2) | 常駐 `.text`/`.rodata`/`.data` | 8192 | 約 12,368 (`.text` 12,003 + `.rodata` 363 + `.data` 2) | **約 4,176 超過** |
| `ram_bank129` (MPR3) | banked code（`VN_BANKED_CODE`） | 8192 | 約 7,112 | 空き約 1,080 のみ |
| `ram_bank130` (MPR4) | CD fallback data | 8192 | **0（未使用）** | 空き |
| `ram_bank131` (MPR5) | CD fallback data | 8192 | **0（未使用）** | 空き |
| `ram_bank132` (MPR6) | VN generated data | 8192 | 約 4,386 | 空き約 3,800 |
| `console_ram` | `.data`/`.bss`/`.noinit`/stack | **6,583** | `.bss` 約 11,045 ほか | **約 4,462〜4,585 超過** |

`console_ram` が 6,583 byte と小さいのは、ランタイム 13 行目 `PCE_CDB_USE_GRAPHICS_DRIVER(1)` により CD BIOS 用に `__pce_ram_start = 0x2649`（`cd-memory.ld`）まで予約され、`0x4000 - 0x2649 = 0x19B7` しか残らないため。グラフィックドライバを切っても約 6,634 byte で焼け石に水。

### 3-1. なぜ bank128（コード）が溢れるか

VN ランタイムの大型関数群が `VN_BANKED_CODE`（= `.ram_bank129` 配置属性）を**付与されず**、常駐 `.text`（bank128）に載っている。pce-memory-bank-strategy.md では「bank128 は起動・薄い制御・小さい rodata 用。command interpreter / sprite refresh / ADPCM 制御は bank129」と定めているが、後から追加された **scene-pack ストリーミング / preload 系**が常駐のまま残っている。

bank128 常駐 `.text` 上位（`pce_vn_runtime.c` で `VN_BANKED_CODE` 無しを確認済み。`llvm-objdump -t` 集計）:

| size | 関数 | 分類 |
|---:|---|---|
| 1493 | `upload_bg_graphics` | BG 転送 |
| 1350 | `scene_pack_read_command` | scene-pack 解析 |
| 1194 | `copy_data_ref_to_vram` | CD→VRAM 転送 |
| 1163 | `preload_scene_assets` | preload |
| 1081 | `scene_pack_read_message` | scene-pack 解析 |
| 830 | `load_scene_pack_into_cache` | scene-pack ロード |
| 719 | `fade_palette` | パレット |
| 584 | `scene_pack_read_choice` | scene-pack 解析 |
| 582 | `upload_palette` | パレット |
| 571 | `scene_pack_read_choice_option` | scene-pack 解析 |
| 375 | `clear_bg_map_region` | BG |
| 290 | `draw_choice_options` | UI |
| 262 | `play_cdda_track` | CDDA |
| 154 | `scene_pack_u16` | scene-pack 解析 |
| … | （以下 `main`(967) 等の小〜中関数） | |

`scene_pack_read_*` ＋ `scene_pack_u16` ＋ `load_scene_pack_into_cache` ＋ `preload_scene_assets` だけで **約 5,733 byte**。これを bank へ移すだけで bank128 超過（約 4,176）は解消できる。

### 3-2. なぜ console_ram（作業 RAM）が溢れるか

`.bss` を圧迫している大型バッファ（`llvm-objdump -t` の OBJECT シンボル）:

| size | シンボル | 備考 |
|---:|---|---|
| 4096 | `vn_active_scene_pack_data` | 実行中 scene pack キャッシュ |
| 4096 | `vn_preload_scene_pack_data` | preload scan キャッシュ（2 つ目の 4KB） |
| 2048 | `cd_transfer_scratch` | CD 1 sector 転送バッファ |
| 512 | `sprite_shadow` | shadow SATB |

4096 × 2 ＋ 2048 ＝ 10,240 byte だけで 6,583 byte の `console_ram` を大きく超える。**2 つ目の 4KB scene-pack バッファ（preload）追加が console_ram 超過の主因**。最低でも約 4,585 byte を `console_ram` の外へ出す必要がある。

## 4. 重要な前提（修正の自由度）

- **bank130 / bank131（MPR4 / MPR5）は本テンプレートで完全に未使用**。全アセットは `cd.dataFiles` 経由（`assets.c` の各 asset は `cd_data_ref` を持ち、RAM-bank chunk は未使用）。`pce_editor_map_asset_bank()`（[assets.c:108](../template/template_pce_vn_cd/src/generated/assets.c)）は CD ビルドでは実質 no-op。→ **bank130/131 を新規のコード/バッファ用に使える。**
- bank マッピングの既定（[pce_vn_runtime.c:188-200](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）:
  - `pce_ram_bank128_map()` → MPR2（常駐 data）。`map_resident_data()` が呼ぶ。
  - bank129 → MPR3（banked code）。起動時に常時 map（`pce_ram_bank129_map()`）。
  - `pce_vn_font_tiles_map()` → MPR6（bank132, VN data）。`map_vn_data()` が呼ぶ。MPR6 は data 専用でトグルするため **MPR6 上で実行するコードは作らない**。
- バンク確保マクロ: 11-12 行目 `PCE_RAM_BANK_AT(128, 2); PCE_RAM_BANK_AT(129, 3);`。`PCE_CDB_USE_GRAPHICS_DRIVER(1)` と同じく `pce-cd.h` の `PCE_CONFIG_IMPLEMENTATION` で実装が生成される。
- 割り込み/フレーム処理は `pce_cdb_wait_vblank()`（275 行）/ `pce_cdb_irq_enable(...)`（2340 行）を使うが、VBlank は `PCE_CDB_MASK_VBLANK_NO_BIOS` にして BIOS の表示レジスタ復元処理を通さない。`pce_cdb_wait_vblank()` 内で R5 shadow (`$F3/$F4`) は書き戻されるため、runtime が display control 変更時に同じ shadow も更新する。CD-ROM 外部 IRQ は維持する。ユーザー定義 ISR から直接呼ぶ関数の常駐縛りは無い（バンクを常時 map していれば banked code でも可）。

## 5. 推奨修正方針（Codex 実装対象）

ターゲットは **`template/template_pce_vn_cd/src/pce_vn_runtime.c`** のみ。これが単一の実体で、ビルド時に project へ同期される（[pce-memory-bank-strategy.md](pce-memory-bank-strategy.md) §基本方針）。`.c`/`.h` の自動生成物（`assets.c`/`vn.c`）はいじらない。

### 手当て A: コード超過（bank128 → bank130 を 2 本目の常駐コードバンク化）

bank129 は空き約 1KB しか無く、移すべき関数は約 4〜5.7KB。bank130（MPR4）を bank129 と同様「起動時に常時 map する 2 本目のコードバンク」として導入する。

1. バンク確保を追加: `PCE_RAM_BANK_AT(130, 4);`（11-12 行付近）。
2. 起動時に `pce_ram_bank130_map()` を呼び MPR4 を常時 bank130 に固定（bank129 を map している箇所＝`pce_ram_bank129_map()` の隣、[2339 行付近](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）。
3. 2 本目の配置属性を定義:
   ```c
   #if defined(__PCE_CD__)
   #define VN_BANKED_CODE2 __attribute__((noinline, section(".ram_bank130")))
   #else
   #define VN_BANKED_CODE2
   #endif
   ```
4. **scene-pack 解析/ロード/preload 系**を `VN_BANKED_CODE2` で bank130 へ移す（約 5.7KB、bank130 に収まる）:
   `scene_pack_read_command` / `scene_pack_read_message` / `scene_pack_read_choice` / `scene_pack_read_choice_option` / `scene_pack_u16` / `load_scene_pack_into_cache` / `preload_scene_assets`。
   余裕を見て `upload_bg_graphics` / `copy_data_ref_to_vram` を bank129 の空き or bank130 に追加してもよい。
5. 制約: bank130 の関数からは **MPR4 を一時的に別バンクへ切り替えない**こと（asset paging は no-op なので問題なし）。これらの関数が触る VN data は MPR6（map_vn_data）、CD BIOS 呼び出しは BIOS 側 MPR を使うので MPR4 固定で安全。`main` は常駐のまま（起動コードは bank128）。

> 目標: bank128 常駐 `.text` を約 7KB 以下（ヘッダ rodata/data 込みで 8192 未満、できれば 1KB 以上の余裕）まで落とす。最低でも約 4,176 byte を bank129/130 へ移動。

### 手当て B: 作業 RAM 超過（大型バッファを bank131 へ退避 or 1 本化）

`console_ram`（6,583 byte）から最低約 4,585 byte を逃がす。いずれか:

- **B-1（推奨・低リスク）: preload バッファと scratch を bank131 へ移す。**
  `vn_preload_scene_pack_data`(4096) を `__attribute__((section(".ram_bank131")))` で bank131 に置き、`PCE_RAM_BANK_AT(131, 5);` を追加。preload 関連の読み書き前後で MPR5 を bank131 に map/復帰する（preload は実行中 scene の処理と分離されているので mapping 境界を作りやすい）。これだけで 4096 byte 削減。さらに足りなければ `cd_transfer_scratch`(2048) も bank131 へ（bank131 は 8192 byte 入る）。
  - 注意: bank131 上のバッファへアクセスするコードは MPR5 が bank131 に向いている間だけ。MPR5 を戻し忘れると asset/その他に波及するので、アクセスは小さなヘルパに閉じる。
- **B-2（設計簡素化・要検証）: preload 用の 2 本目 4KB バッファを廃し、active キャッシュと共用 or 縮小。**
  preload を「次 scene を別バッファへ先読み」ではなく「必要時にだけ active キャッシュへロード」に変える、または preload scan を full 4KB ではなく小さい走査窓で行う。`.bss` 4096 byte をまるごと削減できるが、preload 挙動の回帰確認が必要。

最小修正なら **A（scene-pack 系を bank130 へ）＋ B-1（preload バッファを bank131 へ）** で両オーバーフローが解消する。

## 6. 検証手順（実装後）

1. リンク再現コマンド（§2）でエラーが消え ELF が出ることを確認。
2. `npm test -- --test-name-pattern "PCE VN"`（[pce-memory-bank-strategy.md](pce-memory-bank-strategy.md) §変更時の確認）。
3. セクション収まりを数値確認:
   ```sh
   "$BIN/mos-pce-cd-clang" -Os -DPCE_EDITOR_TARGET_CD=1 -Wl,-Map=out/build.map -o out/test.elf \
     src/main.c src/generated/assets.c src/generated/vn.c
   # build.map で .ram_bank128/129/130/131/132 と console_ram 各サイズ < 0x2000 / < 0x19B7 を確認
   ```
4. エディタから CD-ROM2 テンプレートを新規作成 → ビルド → ISO 生成を確認。
5. **Geargrafx MCP でランタイム検証**（ここで初めて Geargrafx を使う）: bank130/131 を常時 map した状態で VDC memory control（`VN_VDC_MEMORY_CONTROL`）、SATB（`0x7f00`）、sprite pattern VRAM、sprite palette、scene-pack 読み出しが正しいか、`get_huc6280_status` の MPR マッピングと併せて確認。preload バッファを bank へ出した場合は MPR5 の戻し忘れによる表示崩れが無いかを重点確認。

## 7. 補足データ（調査時の実測値）

- 失敗プロジェクト: `data/projects/my_pce_game22`（テンプレート由来）, `data/projects/1123`（旧成功 ISO 有り・現ソースでは同一エラー）。
- toolchain: `data/tools/llvm-mos-sdk/llvm-mos/bin/mos-pce-cd-clang`、ld スクリプト `mos-platform/pce-cd/lib/`（`link.ld` → `ipl.ld`、`cd-ram-banked-sections.ld`、`cd-memory.ld`）。
- LTO 有効（`out/*.elf.lto.o`）。関数別サイズは `-fno-lto -c` でオブジェクト化し `llvm-objdump -t` で集計（LTO 後の最終値は若干小さくなるが超過量の桁は同じ）。
- bank129 既存 banked code 上位: `run_commands_until_wait`(6015), `refresh_scene_sprites`(2560)。これらは移動しない（既に bank129）。

---

# 併発: スプライトが「全く表示されない」ランタイム不具合（調査中 / Geargrafx 検証待ち）

リンクエラーとは別に、**立ち絵スプライトが全く表示されない**ランタイム不具合が併発している（ユーザー報告: 症状=「全く表示されない」）。これはビルドが通った後の表示問題で、Geargrafx MCP での確認対象。

## 確認済み（潰した仮説）

- `VN_VDC_MEMORY_CONTROL = VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_64_32` は **sprite cycle bit を含む**（`VDC_CYCLE_4_SLOTS = VDC_VRAM_CYCLE_4_SLOTS | VDC_SPRITE_CYCLE_4_SLOTS(0x08)`、`pce/hardware.h`）。→ memory-bank-strategy.md が警告する「sprite cycle bit 落とし」は**起きていない**。
- CD ビルドは `__PCE__` と `__PCE_CD__` の**両方が定義**される（`mos-pce-cd-clang -dM` で確認）。→ `show_character_sprite_frame()` / `clear_sprites()` の SATB shadow 構築（`#if defined(__PCE__)`）は CD でも**コンパイルされる**。preprocessor 除外による非表示ではない。
- bank128(MPR2) と bank132(MPR6) は **別 MPR 窓**（ipl-cd-ram-banked-sections.ld: bank128=0x4000, 129=0x6000, 130=0x8000, 131=0xa000, 132=0xc000）。→ `refresh_scene_sprites` 内の `map_resident_data`/`map_vn_data` 交互呼びは別 MPR を触るので衝突せず、MPR 取り違えによる metadata 破壊は（少なくとも 128/132 間では）起きない。

## 有力仮説（優先度順）

1. **シーンパック・コマンドのパース不整合（最有力）。** スプライト表示は `run_commands_until_wait` → show-sprite コマンド処理（[pce_vn_runtime.c:2105-2124](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）で `sprite_slots[slot].visible = (command->flags & PCE_VN_SPRITE_VISIBLE) && command->asset_index >= 0` により slot を可視化する。`command` の各フィールドは **CD 上のシーンパックから `scene_pack_read_command()` で読む**。最近追加された scene-pack ストリーミング（オーバーフローの主因でもある）で、**生成側（`pce-vn-manager.js` の scene pack writer）と読取側（runtime の `scene_pack_read_command` / オフセット定数 `VN_SCENE_PACK_OFFSET_*`）のフィールド配置がずれる**と、`asset_index`/`flags`/`x`/`y` を誤読し `visible` が立たない or 不正 index → 全 slot 非表示。
   - 静的検証ポイント: `pce-vn-manager.js` の scene pack バイナリ生成（command レコードの byte 配置）と、runtime の `scene_pack_read_command()`（70-77 行の `VN_SCENE_PACK_OFFSET_COMMAND_TABLE` 等）を突き合わせ、command レコードのサイズ・各フィールド offset・エンディアンが一致するか確認する。
2. **SATB 転送 / DVSSR の問題。** `upload_sprite_table()` CD パス（[1088-1109](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）は BIOS `pce_cdb_vdc_sprite_table_put()` で 64 エントリを書き、`VDC_REG_SATB_START(0x13)=0x7f00` で VRAM→SATB DMA を起動する。順序・タイミング・SATB アドレス競合（0x7f00 に BG/pattern が被る）で全 sprite 不可視になり得る。
3. **sprite layer 再有効化漏れ。** pattern upload 時に `sprite_layer_disable()` してから `sprite_layer_enable()` で戻す（1661-1722）。`display_active`（=`!pending_display_enable`）の判定タイミングで enable が飛ぶと layer が落ちたまま。

## Geargrafx での切り分け手順（最短）

1. `1123/out/MY_NEW_GAME.iso`（6/13 09:52 build、スプライト回帰コミット以降を含む想定）を System Card BIOS 付きで `load_media`。立ち絵が出るはずの scene まで進める。
2. `get_screenshot` で現象確認 → `get_huc6270_registers` で **VDC CONTROL(0x05) の ENABLE_SPRITE(0x40) ビット**と **MWR(0x09) の sprite cycle ビット**を確認。
3. **SATB を読む（最重要の分岐点）**: `read_memory` で VRAM 0x7f00 から 64×8byte を読む。
   - エントリが **0/ゴミばかり** → shadow が埋まっていない → 仮説1（slot が visible にならない／scene-pack パース）。`list_sprites` も 0 件のはず。
   - エントリに **妥当な y/x/pattern/attr が入っているのに不可視** → 仮説2/3（VDC layer・pattern VRAM・palette）。続けて pattern VRAM（`pattern_base*32`）と sprite palette（256+）と CONTROL レジスタを確認。
4. `get_huc6280_status` で refresh 時の MPR マッピングも併せて確認。
5. 仮説1濃厚なら `pce-vn-manager.js`（生成）↔ `scene_pack_read_command`（読取）の byte 配置を突き合わせて確定。

> 注: スプライト不具合の発生コミット特定は、本リポジトリが md_emulator から分離（squash）された関係で `git --follow` がリネームを跨ぎ、差分での厳密追跡が不正確。回帰の確定は Geargrafx 実測 + 生成/読取コード突合で行う。

## Geargrafx 実測結果（2026-06-13 実施）— 仮説1は否定

`data/projects/1123/out/MY_NEW_GAME.cue` を System Card BIOS でロードし、立ち絵シーンで一時停止して実測した。

**スプライトのデータ経路は完全に正常**（＝シーンパック parse もアセットロードも壊れていない。当初の有力仮説1は否定）:

- **SATB(VRAM 0x7F00) に 32 個のスプライトが正しく配置**: `list_sprites` で 4列×8行グリッド、x=0xA0-0xD0(160-208)、y=0x5B-0xCB(91-203)、pattern 0x1B8-0x1D7、palette 1、priority=FG。立ち絵1枚（4×8セル）として整合。→ show-sprite コマンドの parse と slot 可視化、SATB 構築は正しく動いている。
- **sprite palette 1 は正常**: VCE palette offset 0x110 に `00 00 8A 00 41 00 FE 01 ...` = assets.c の akari_sprite palette と一致。
- **sprite pattern データは VRAM にロード済み**: 先頭セル(0x6E00)は空（立ち絵の左上＝透明で正常）だが、中央セル(0x7100/0x7200)に実データあり。`get_sprite_image` で実際のキャラ断片が描画される。
- **CD→VRAM / CD→RAM 転送は機能**: BG map は ISO sector 84 → BAT(VRAM 0x0000) に正しくロード（`80 00 81 00 ...`）。BG tiles も sector 75 → VRAM 0x800 にロード。
- **VDC CONTROL(R05)=0x00C8** = ENABLE_BG | ENABLE_SPRITE | IRQ_VBLANK（両レイヤー有効）。**MPR は 128→MPR2 / 129→MPR3 / 132→MPR6** が正しくマップ。

**にもかかわらず合成画面に立ち絵が出ない。** 画面は等間隔の横線のみ（BG 本来の画像も出ていない）。BG レイヤーを実験的に無効化（R05←0x48）しても横線は消えず、`debug_step_frame` 後に R05 は **0xC8 へ戻っていた** → **CD BIOS グラフィックドライバ（`PCE_CDB_USE_GRAPHICS_DRIVER(1)`）が VDC CONTROL と表示タイミングを所有・上書きしている**。

**さらに異常レジスタ**: R13(VDW 垂直表示幅)=0x0000、R14(VCR)=0x0000。垂直表示ウィンドウが潰れた値になっており、画面が数ラインしか正常出力されない＝横線だけになる症状と整合する可能性。

### 結論（スプライト不具合の所在）

不具合は **アセット/シーンパックのデータ層ではなく、表示（VDC 表示ウィンドウ/タイミング）と CD BIOS グラフィックドライバの相互作用**にある。データ（SATB・palette・pattern・BAT）は正しくハードへ届いている。

### Codex への調査・修正の起点

1. **VDC 表示タイミングの所有権**: runtime は `pce_cdb_vdc_*`（BIOS）と `pce_vdc_poke(VDC_REG_CONTROL/MEMORY/...)`（直接）を併用している（[display_enable/sprite_layer_enable](../template/template_pce_vn_cd/src/pce_vn_runtime.c) 284-323、upload_sprite_table 1101 で R09 直書き）。BIOS が CR/表示タイミングを毎 VBLANK で復元するため、直接 poke と競合する。**どちらか一方に統一**（BIOS グラフィックドライバを使うなら表示制御は BIOS API に寄せ、VDC タイミングレジスタの直書きを避ける）方針を検討。
2. **R13(VDW)/R14 が 0**: 垂直表示ウィンドウの設定が欠落/上書きされていないか。BIOS 初期化と runtime の VDC 設定順序（`init` での MWR/表示設定）を確認。
3. **BG タイルの退化**: classroom tiles(sector 75)が `FF00`（単色 color1）主体＝BG 画像変換側（`pce-asset-manager.js` の image→tiles 生成）も別途要確認。横線の一因。
4. 1123 はユーザー改変プロジェクトのため、確証は**テンプレート由来の新規プロジェクトをビルド（要・前半のリンク修正）→ 同手順で Geargrafx 再確認**で取ること。

> Geargrafx 操作メモ（再現用）: `load_bios(syscard, "data/projects/[BIOS] Super CD-ROM System (Japan) (v3.0).pce")` → `load_media(".../1123/out/MY_NEW_GAME.cue")` → `debug_continue` → RUN ボタン → 立ち絵シーンで `debug_pause` → `list_sprites` / `read_memory(VRAM 0x7F00, 0x6E00, 0x7100)` / `get_huc6270_registers` / `get_sprite_image`。

## ★確定した根本原因（2026-06-13 Geargrafx で特定・検証済み）

**VDC の垂直表示ウィンドウ（R13=VDW / R14=VCR）が 0 に潰され、画面表示全体（BG・スプライト・メッセージテキスト）が崩壊している。** スプライト固有の不具合ではなく「表示ウィンドウ崩壊」が全症状の単一原因。

### 確証の連鎖

1. `init_video()`（[pce_vn_runtime.c:2336](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）直後は **R13(VDW)=0x00DF, R14(VCR)=0x000C と正常**（`pce_cdb_vdc_set_resolution(7MHz, 40, 28)` が正しくハードを設定）。
2. シーン読込・描画が進むと **R13=0x0000, R14=0x0000 に変化**＝垂直表示が約1ラインに潰れ、画面は等間隔の横線だけになる。
3. R13 書き込みに write ブレークポイントを張ると、**毎フレーム CD BIOS の VBLANK ハンドラ経由で 0 が書かれる**（コールスタック: BIOS vblank `$E14C` → … → bank `0x83`(グラフィックドライバ)。VDW 値はドライバ専用 RAM の表示設定構造体 `ZP($02)=0xAD90` から読まれており、その VDW が 0）。
4. **検証**: 一時停止中に手動で R13←0x00DF, R14←0x000C を書いて 1 フレーム描画させると、**背景・キャラクタースプライト・メッセージテキストがすべて正常表示された**（スクリーンショットで確認）。→ データ・SATB・パレット・パターン・BAT はすべて正しく、唯一 VDW/VCR が原因と確定。

### メカニズム

`init_video()` は **`pce_cdb_irq_enable(PCE_CDB_MASK_IRQ_EXTERNAL | PCE_CDB_MASK_VBLANK)`**（0x40 = **BIOS 処理付き VBLANK**）で CD BIOS グラフィックドライバの VBLANK ハンドラを有効化している。このハンドラは毎フレーム、ドライバ自前の表示設定から VDC の表示ウィンドウ（VDW/VCR 等）を書き戻す。ところがそのドライバ設定の VDW=0 であり、`pce_cdb_vdc_set_resolution()`（ハードを直接設定）と**ドライバの VBLANK 用表示設定がずれている**。結果、init で一旦正しく設定した VDW を毎フレーム 0 で塗り潰す。`PCE_CDB_USE_GRAPHICS_DRIVER(1)`（[pce_vn_runtime.c:13](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）＋ BIOS-VBLANK 運用に切り替えた回帰と整合（「以前は表示できていた」）。

### Codex への修正方針（表示不具合）

対象は `init_video()` の表示初期化シーケンス。以下のいずれか／組合せ:

1. **呼び出し順序**: `pce_cdb_irq_enable(...VBLANK)` を **`pce_cdb_vdc_set_resolution()` / `pce_cdb_vdc_bg_set_size()` の後**に移す（ドライバ表示設定が確定してから VBLANK ハンドラを有効化する）。現状は irq_enable が先（[2340-2342](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）。
2. **set_resolution の結果確認**: 戻り値 `bool` を現在 `(void)` で捨てている（[2341](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）。失敗していないか確認し、ドライバの表示設定が VDW=224(28tile) で確定するまで初期化する。
3. **直接 poke とドライバの競合排除**: `pce_vdc_poke(VDC_REG_MEMORY, VN_VDC_MEMORY_CONTROL)`（R09 直書き, [2343](../template/template_pce_vn_cd/src/pce_vn_runtime.c)）など、BIOS グラフィックドライバが管理する表示系レジスタを直接叩いている箇所がドライバ設定と非同期になっていないか点検。表示制御は BIOS API（`pce_cdb_vdc_*`）に統一する。
4. **採用済み**: VBLANK を `PCE_CDB_MASK_VBLANK_NO_BIOS`(0x80) にして表示ウィンドウをランタイム側で一貫管理する。さらに `pce_cdb_wait_vblank()` が毎回 R5 を `$F3/$F4` から復元するため、runtime の display control helper がその shadow も更新する。これにより R13 だけでなく R05 の sprite enable bit も次 VBlank で戻されない。

**修正確認**: 修正後、Geargrafx で `get_huc6270_registers` の R13(VDW)≈0xDF / R14(VCR)≈0x0C が**シーン描画中も維持される**ことを確認し、立ち絵・BG・テキストが出ることを `get_screenshot` で確認する。

> なお BG タイルが単色化（横線の元）に見えた件は、VDW を直すと正常な背景画像が描画されたため**別不具合ではなく VDW 崩壊の症状だった**。画像変換側の追加対応は不要。
