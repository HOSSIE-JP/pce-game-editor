# refactor-instructions-cd-load-chunking.md — CD-ROM2 VN: 重いロード時の PSG 詰まり解消（Phase 0〜2）実装指示書

> **文書区分: タスク時点の実装指示。** 現行仕様の入口ではありません。2026-07-10 の全体監査は [docs/implementation-audit-2026-07-10.md](docs/implementation-audit-2026-07-10.md) を参照し、CD/ADPCM の最終挙動は現行コードと `docs/pce-memory-bank-strategy.md` を優先してください。

このファイルは実装担当モデル（Codex）向けの作業指示書である。
作業前に必ず `CLAUDE.md` / `AGENTS.md` を読むこと。優先順位は次のとおり:

**人間の指示 > `CLAUDE.md` / `AGENTS.md` > 本書**

矛盾が見つかった場合は、より優先度の高い文書に従い、その齟齬を最終報告に明記すること。

---

## 0. 前提（この指示書に至る経緯・既に適用済みの修正）

CD-ROM2 VN runtime で「PSG BGM 再生中に ADPCM 音声再生（CD ロードを伴う）をすると PSG が停止/大幅減速する」という不具合をユーザーから報告され、Geargrafx MCP（`--mcp-http`、HTTP JSON-RPC 直叩き、`debug_step_frame`/`set_breakpoint`/`get_cdrom_status`/`get_psg_status`/`get_adpcm_status`/`controller_macro` 等）で実測調査した。判明した事実:

- **CD 読みは 1 sector = 1 BIOS コマンド (`pce_cdb_adpcm_read_from_cd` / `pce_cdb_cd_read`) = 1 シーク**。1 シークの latency は sector 数にほぼ依らず **約 10 フレーム（≈150ms、seek 支配）**。
- 旧実装は音声 1 asset を **1 sector/コマンドで逐次読み**していたため、N sector の音声は N 回の独立シークになり、30 sector（約60KB）の音声で約 4.5 秒、その間 PSG は BIOS 呼び出し中ずっと凍結していた。
- 対策として **chunk 化**（`VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS` / `VN_ADPCM_PRELOAD_READ_CHUNK_SECTORS` を `1u→8u`）を実施し、シークを `ceil(N/chunk)` へ集約。実機 A/B でユーザーが「軽減した」と確認済み（**完全解消ではない**）。
- chunk 化にあわせて `wait_adpcm_cd_transfer_ready()`（`vn_adpcm_core.c:198`）の PSG seek 補償バグも修正済み: 旧実装は sector 数ぶん `cd_transfer_wait()` をループしていたため chunk 化後は補償が chunk 倍に過剰適用され BGM が前方へジャンプしていた。修正後は **BIOS 読みコマンド単位（chunk 単位）に1回**だけ settle+補償する。
- `bank128` が **1 byte overflow**でビルド不能になっていた（ADPCM chunk 化とは無関係の既存 RAM 壁が顕在化）。`vn_glyph_decode`/`vn_glyph_stride`（`vn_msg_core.c`）を `VN_RESIDENT_CODE`(bank128) → `VN_BANKED_CODE`(bank129) へ再配置して解消済み。

**これらは既に `template/template_pce_vn_cd/src/` に適用済みのベースラインである。本書の作業はこの状態から差分を積む。逆行（chunk=1 に戻す、per-sector 補償ループを戻す等）は禁止。**

ユーザーからの追加報告: **上記対応後も、重いロード（BG/sprite/scene pack を含むシーン遷移など）で PSG が詰まる**。調査の結果、これは ADPCM 音声とは**別のコード経路**（visual cache: BG tiles/map、sprite patterns、scene pack、asset meta の CD→VRAM/RAM 転送）が **依然 1 sector/コマンドの逐次読み**のままであることが原因と判明した（詳細は §2）。今回の指示書はこれを解消する Phase 0〜2 を定義する。

Phase 0/1 は「重いロードのシーク回数を減らす」低リスク改善、Phase 2 は「ロード中も PSG を本物の main-loop タイミングで進め続ける」協調ロード（通称「案B」）への構造変更である。**Phase 2 は RAM 予算次第で実装不能になり得る**ため、Phase 0 で先に予算を検証・確保する。

## 1. Objective

CD-ROM2 VN runtime の **全 CD 読み込み経路**（ADPCM 音声、BG tiles/map、sprite patterns、scene pack、asset meta、PSG pattern）について、重いロード中の PSG BGM 停止/詰まりを構造的に軽減する。

- **スコープ内**: `template/template_pce_vn_cd/src/vn_cache_core.c`（visual payload cache、CD→VRAM/RAM データムーバー、asset meta アクセサ）、`vn_adpcm_core.c`（ADPCM ロード、Phase 2 でのみ再訪）、`vn_engine_bus.c`（CD ブラケット）、`vn_engine_time.c`（credit）、`vn_engine_state.c`（RAM レイアウト）、`vn_main.c`（main loop）。
- **スコープ外・変更禁止**: Editor UI、asset pipeline（`pce-asset-manager.js` 等）、`vn.h` の生成データ形式・コマンド契約、CD-DA の pause/resume の**最終的な HW 挙動**（呼び出し経路の変更は可）、PSG state-driven sequencer（`vn_psg_core.c`。Phase C で確立済み・変更不要）、メッセージ文字送り（`textSpeedFrames`）の計算方式。
- 目的ではないこと: 見た目のリファクタリング、無関係な整形、CD 読み込みと無関係な機能追加。

## 2. Project Understanding

### 2.1 現状のバンク/RAM 予算（実測、`ishi_no_ura` プロジェクト、本書起草時点）

`mos-pce-cd-clang -Wl,--print-memory-usage` の実測値（`data/projects/ishi_no_ura` を `data/tools/llvm-mos-sdk/llvm-mos/bin/clang.exe --config .../mos-pce-cd.cfg -Oz -DPCE_EDITOR_TARGET_CD=1 -Wl,-T,<project>/src/generated/overlay_insert.ld -Wl,--print-memory-usage` でビルドして取得）:

| リージョン | 使用量 | 空き | 備考 |
|---|---:|---:|---|
| `console_ram`（zp 含む work RAM） | 7463 / 7472 B | **9 B** | 実質ゼロ |
| `zp` | 188 / 204 B | 16 B | |
| `ram_bank128`（MPR2, resident `.text`） | 8111 / 8192 B (99.01%) | 81 B | |
| `ram_bank129`（MPR3, `VN_BANKED_CODE`） | 8033 / 8192 B (98.06%) | 159 B | |
| `ram_bank130`（MPR4, `VN_BANKED_CODE2`） | 8056 / 8192 B (98.34%) | 136 B | |
| `ram_bank121`（visual cache page ロードコード、System Card boot 後に stream） | 7878 / 8192 B (96.17%) | 314 B | |
| `ram_bank104`〜`119`（visual cache page pool、16 page） | ランタイム専用、静的配置なし | — | §2.2 参照。**`--print-memory-usage` は静的配置しか見ないため「空き」に見えるが実際は使用中** |
| `ram_bank132`〜`133` | 別報告あり（overlay/font mask cache） | — | 本書スコープ外 |

**再測定すること**: この表は本書起草時点のスナップショット。Phase 0 開始時に必ず自分で再計測し、以降の各 Phase 末でも再計測して差分を報告すること。

### 2.2 visual payload cache の実態（重要な事実誤認の訂正）

`vn_engine_state.c:151-162` で以下が定義されている:

```c
#define VN_VISUAL_CACHE_PAGE_COUNT 16u
#define VN_VISUAL_CACHE_FIRST_BANK 104u
#define VN_VISUAL_CACHE_PAGE_ADDR ((uint8_t *)0xc000)
#define VN_VISUAL_CACHE_COPY_CHUNK 128u
```

これは **`bank104`〜`119`（16 バンク = 16×8KB）を LRU ページキャッシュとして丸ごと使う設計**であり（`CLAUDE.md` の `PCE_RAM_BANK_AT(121, 4)` 周辺記述、`vn_engine_config.h` の bank121 コメントも参照）、`VN_ENABLE_VISUAL_PAYLOAD_CACHE`（既定 1、CD build 有効）が立っていれば**常時稼働**する。ページは (kind, asset_index, part) キーで LRU 割当・再利用され、BG tile/map、sprite pattern 等の**再訪問時の CD 再読み込みを避ける**ためのキャッシュである。

`--print-memory-usage` で `bank104`〜`119` が「0 GB / 0.00%」と出るのは、これらのページ内容が**リンク時ではなくランタイムに CD からストリームされる**（静的シンボルが置かれない）ためであり、**「空いている」ことを意味しない**。過去の調査でこの点を「大量に空いている」と誤読した経緯があるため、Phase 0 で必ず自分の目で `visual_cache_map_page_bank_impl` / `visual_cache_page_ptr_impl`（`vn_cache_core.c:20-32`）と `PCE_RAM_BANK_AT` 宣言（`vn_engine_config.h` 冒頭）を確認し、この認識を前提に設計すること。

### 2.3 CD 読み込みの現行経路（chunk 化されているものと、されていないもの）

| 経路 | 関数 | 現状 chunk | ファイル:行（目安） |
|---|---|---:|---|
| ADPCM 音声（message/preload） | `load_adpcm_voice` → `wait_adpcm_cd_transfer_ready` | **8 sector/コマンド（Phase 適用済み）** | `vn_adpcm_core.c:198`, `:228` 付近 |
| visual cache ページの CD miss-fill | `visual_cache_load_cd_part_impl` | **1 sector/コマンド固定**（`chunk = remaining > VN_CD_SECTOR_BYTES ? VN_CD_SECTOR_BYTES : remaining`） | `vn_cache_core.c:326-369`（読み込みループは `:351-362`） |
| visual cache 非該当（大きい一枚絵・cache miss 前）の直接転送 | `cd_data_ref_to_vram_visual_impl` | **1 sector/コマンド固定** | `vn_cache_core.c:182-213` |
| BG map の非キャッシュ経路 | `cd_bg_map_ref_to_vram` 系（要確認、`visual_cache_bg_map_to_vram_impl` の非キャッシュ fallback） | 要調査 | `vn_cache_core.c:479` 付近（`visual_cache_bg_map_to_vram`） |
| 汎用 CD→VRAM（非 visual-cache） | `copy_data_ref_to_vram` | **1 sector/コマンド固定** | `vn_cache_core.c:657` |
| asset meta（BG/sprite/ADPCM/PSG/CDDA descriptor） | `vn_read_meta_sector` | 1 sector（record は sector 内に詰まっているため元々効率的、優先度低） | `vn_cache_core.c:748` |
| scene pack | `vn_cache_core.c:1096` 付近のロードループ | **1 sector/コマンド固定** | `vn_cache_core.c:1080-1100` 付近 |

**Phase 0 の最初のタスクとして、この表を実ソースで再検証し正確な行番号・chunk 状態表に更新すること**（本書のものは目安）。

### 2.4 CD read の共有バッファ

`cd_transfer_scratch`（`vn_engine_state.c:250`）は **`VN_CD_SECTOR_BYTES`(2048B) 固定**、section `.ram_bank132_tail`（`overlay_insert.ld` で `NOLOAD`、overlay の benign LMA コピー窓を再利用、実測 3936B の窓のうち scratch 以外に `cdda_resume_start` 等が同居し **空きは約 1888B**。2 sector(4096B) すら入らない）。この窓は resident metadata（cd_data_refs、cell_maps、scene-pack directory）の増加でさらに縮む設計（`vn_engine_state.c:240-249` のコメント参照）。**この窓を拡張して scratch を大きくする方針は Phase 0 で優先度低**（§2.2 の LRU ページを一時 scratch として借用する方が RAM 新規消費ゼロで済む可能性が高い。§4.2 参照）。

### 2.5 Geargrafx MCP による実測方法（既に確立済みの手順、再利用すること）

Windows 環境の Geargrafx は `C:\homebrew\emulator\Geargrafx\Geargrafx.exe`。`.mcp.json` の `geargrafx` stdio シムは macOS パスで動かないため、**HTTP MCP を手動起動**して JSON-RPC を直接 POST する。

```sh
# 起動（バックグラウンド）。-w でウィンドウ表示、対象 CUE を渡す。
"/c/homebrew/emulator/Geargrafx/Geargrafx.exe" --mcp-http --mcp-no-router -w "<絶対パス>/pce_sample.cue" &
sleep 5  # port 7777 の LISTEN を待つ

# 呼び出しヘルパー（bash）。curl の -d へ直接 JSON を書くと二重引用符が壊れるため、
# 引数 JSON を stdin から受けてファイル経由で POST すること。
ggcall() {
  local tool="$1"; local args; args="$(cat)"; [ -z "$args" ] && args='{}'
  printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$tool" "$args" > /tmp/req.json
  curl -s -X POST http://127.0.0.1:7777/mcp -H 'Content-Type: application/json' -d @/tmp/req.json | sed 's/\\"/"/g; s/\\n/\n/g'
}
```

主要ツール:
- `debug_reset` / `debug_pause` / `debug_continue` / `debug_step_frame {"frames":N}`（1 VBlank ずつ確定的に進める）
- `set_breakpoint {"address":"<hex>","memory_area":"cpu_addr","execute":true}` / `remove_breakpoint` / `debug_get_status`（`at_breakpoint`/`pc`）
  - **アドレス解決**: ELF シンボルの下位16bitが CPU 論理アドレス（`llvm-nm.exe <elf> | grep <func>` で取得。例 `01829605 t load_adpcm_voice` → `cpu_addr "9605"`）。bank128/129/130/133 は co-resident なので実行 BP がそのまま張れる。
- `controller_macro {"commands":[{"tap":"I"},{"wait":N},{"tap":"run"},...]}` — BP に当たると macro が自動停止する。フレーム送りにも使える（`{"wait":N}`）。
- `get_cdrom_status` — `cycles_to_load`（残りマスタクロック。1フレーム=357630、シーク中は非ゼロ→毎フレーム減少→0で完了。**このパルスの立ち上がり回数を数えるとシーク回数**）、`scsi_phase`、`sectors_left`。
- `get_psg_status` — 各チャンネルの `frequency`/`enabled`/`amplitude`。**フレーム間で値が変化しない = PSG 凍結中**の直接証拠。
- `get_adpcm_status` — `playing`/`length`/`read_address`。
- `get_screenshot` — `result.content[0].data` が base64 PNG。`grep -oE '"data":"[A-Za-z0-9+/=]+"' | sed ... | base64 -d > out.png` でデコードして Read ツールで確認。

**既知の落とし穴**:
- LTO で小関数がインライン化されると JSR が発生せず、シンボルアドレスへの実行 BP が当たらない（`load_adpcm_voice`/`play_adpcm_message_voice` で発生した）。その場合は呼び出し元の非インライン関数（`cd_transfer_wait` 等）や、`cycles_to_load` パルスのポーリングで代替すること。
- `ishi_no_ura` は音声を scene 入場で preload するため、狙った fresh ロードを再現するには十分な回数タップしてナビゲートする必要がある。
- ブート手順: 白画面 → 数秒で `SUPER CD-ROM²` 画面 → RUN 1回 → `JUST A MOMENT` → ゲーム。`{"wait":300〜320},{"tap":"run"},{"wait":250〜260},{"tap":"run"},{"wait":250〜260}` 程度で安定して抜けられる。
- scene 4（部室、PSG SONG + voiced message）が PSG×ADPCM 同時再生の再現シーンとして確認済み。

### 2.6 ビルド方法（GUI を使わない headless ビルド）

`tests/helpers/mock-electron.js` の `loadWithMockedElectron` を使う。`.codex-tmp/` 配下に使い捨てハーネスを作ってよい（既存の `.codex-tmp/build-ishi-real.js` 相当を再利用/複製可）。骨子:

```js
const { loadWithMockedElectron } = require('../tests/helpers/mock-electron');
const buildSystem = loadWithMockedElectron(path.join(root, 'pce-build-system.js'), { userData, paths: { userData, home } });
const setup = require(path.join(root, 'pce-setup-manager.js'));
setup.getLlvmMosPceCdPath = () => path.join(root, 'data/tools/llvm-mos-sdk/llvm-mos/bin/mos-pce-cd-clang.bat');
setup.getPceMkcdPath = () => path.join(root, 'data/tools/llvm-mos-sdk/llvm-mos/bin/pce-mkcd.exe');
setup.getPceCdIplPath = () => path.join(root, 'data/tools/pce-cd/ipl/ipl.bin');
buildSystem.openProject(projectDir);
await buildSystem.buildProject((line) => logs.push(line), { skipClean: false });
```

`--print-memory-usage` を見たい場合は `data/tools/llvm-mos-sdk/llvm-mos/bin/clang.exe --config data/tools/llvm-mos-sdk/llvm-mos/bin/mos-pce-cd.cfg -Oz -DPCE_EDITOR_TARGET_CD=1 -Wl,-T,<project>/src/generated/overlay_insert.ld -Wl,--print-memory-usage -o /tmp/probe.elf <project>/src/main.c <project>/src/generated/assets.c <project>/src/generated/vn.c` を直接叩く（`data/projects/ishi_no_ura` はビルド生成物 `src/generated/*` が既に存在するので、これで即座に測れる）。

**実プロジェクト `data/projects/ishi_no_ura` を直接ビルド対象にしてよい**（これまでの調査で使用してきた実データ）。テンプレート変更は `pce-vn-manager.js` の `syncVisualNovelRuntime` がプロジェクトへ同期する。

## 3. Behaviors To Preserve

1. `CLAUDE.md` の禁止事項すべて。特に: `pce_cdb_adpcm_status()` の毎フレームポーリング禁止 / 短尺音声を true streaming に戻さない / 自然終了後の stop/reset 追撃禁止 / glyph カーソルは値渡し / sprite tick を ADPCM 中に止めない。
2. **§0 に記載した既に適用済みの修正を逆行させない**（ADPCM chunk=8、`wait_adpcm_cd_transfer_ready` のコマンド単位補償、glyph 関数の bank129 配置）。
3. `psg_mark_hw_dirty()` は**全 BIOS 呼び出し後に必ず呼ばれる**契約（`sync_cd_external_irq_after_bios_call()` 内、`vn_engine_bus.c`）。CD 読み込み経路を変更する際もこの契約を壊さないこと（BIOS 呼び出し後の PSG shadow 再同期が保証されなくなると、Phase C で解決した「PSG 論理状態と HW の乖離」が再発する）。
4. CD-DA の pause/resume・deferred resume 機構（`prepare_cd_data_access()` / `resume_cdda_after_cd_data_access()` / `begin_cdda_deferred_resume()` / `end_cdda_deferred_resume()`）の最終的な HW 挙動は変えない。
5. visual cache の LRU 意味論（(kind, asset_index, part) キー、`visual_cache_next_lru_impl` のクロック方式）を壊さない。ページ内容の読み込み効率化（chunk 化）はページの**中身の取得方法**を変えるだけで、キャッシュの割当/追い出しロジックには触れない。
6. bank128/129/130/121 の使用率が限界に近い（実測 96〜99%）。コード追加で `ld.lld: ... overflowed` が出たら、機能を削らず `VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替えや overlay（bank133）退避で均す。`--print-memory-usage` で必ず確認する。
7. `tests/pce-vn-manager.test.js` の既存 pin（特に `VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS 8u` / `VN_ADPCM_PRELOAD_READ_CHUNK_SECTORS 8u` / `VN_ADPCM_CD_READ_PSG_COMPENSATION_FRAMES 1u` / `wait_adpcm_cd_transfer_ready` の「per-command 1回」構造）を壊さない。visual cache 側に新設する pin は本書の変更内容に合わせて追加する。

## 4. Stop And Ask Conditions

以下に該当したら実装を止めて人間に報告すること（該当しない他 Phase の作業は独立に継続してよい）。

1. Phase 0 の RAM 予算調査の結果、Phase 1（visual cache chunk 化）に必要な予算すら確保できない場合。
2. bank 使用率が **>99.5%** に達し、`VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替えや overlay 退避を尽くしても解消できない場合。
3. visual cache のページ借用（§4.2 のアイデア）を実装した結果、LRU キャッシュの意味論が壊れる（同時に必要な複数ページが奪い合いになる、キャッシュヒット率が実用にならないレベルで下がる等）ことが Geargrafx 実測で確認された場合。
4. Phase 2（協調ロード状態機械）で、CD ブラケット（CDDA pause/resume、外部 IRQ、TIMER 所有）をフレーム跨ぎで開いたままにする設計が、`vn_wait_next_vblank()` 内の `quiet_cd_unit_irqs()` や CD-DA 状態と両立できないことが判明した場合。
5. `tests/pce-vn-manager.test.js` の pin 書き換えが、本書のスコープ（visual cache / ADPCM CD 読み込み経路）を超えて無関係な領域まで連鎖的に波及する場合。
6. Geargrafx で「1回の BIOS 読みコマンドで複数 sector をまとめて読んでもシークが1回に集約されない」（＝ chunk 化してもシーク回数が sector 数に比例したまま）ことが実測で判明した場合（Phase 1 の前提が崩れるため設計を再検討する必要がある）。

## 5. Implementation Phases

各 Phase は「ビルド可能・Geargrafx 検証可能・1 コミットで revert 可能」を満たすこと。コミット/プッシュは人間の明示指示があるときのみ行う。コミットメッセージは日本語。

### Phase 0 — RAM 予算の確定と確保

**目的**: Phase 1/2 に必要な RAM/バンク予算を明らかにし、可能な範囲で確保する。**新しい常駐 RAM は極力増やさない**方針（既存バンクは限界のため）。

**作業内容**:
1. §2.1 の表を実測で更新する（`--print-memory-usage`、`data/projects/ishi_no_ura` を対象）。
2. §2.3 の CD 読み込み経路表を実ソースで検証し、正確な chunk 状態・行番号に更新する。特に「BG map の非キャッシュ経路」「asset meta アクセサ」の chunk 状態を確定させる。
3. §2.2 の visual cache ページ機構を実ソースで裏取りし、**「LRU ページを一時 scratch として借用してマルチ sector DMA する」アイデア（§4.2 参照）が技術的に成立するか**を検証する:
   - `pce_cdb_cd_read()` の宛先アドレスは、呼び出し時点で MPR6(slot6, 0xc000) にマップされている物理バンクへの生の書き込みでよいか（既存の `cd_data_ref_to_vram_visual_impl` 等が `cd_transfer_scratch`（bank132_tail、同じく slot6 経由）への書き込みに使っている実績があるので、同一パターンで別バンクへ向けられるはず。これを Geargrafx 実機で確認する）。
   - `visual_cache_load_cd_part_impl` が扱う「1 part = 1 page = 8KB = 4 sector」の粒度で、page をあらかじめ `visual_cache_page_ptr_impl` でマップしてから `pce_cdb_cd_read()` を直接そのアドレスへ向けられれば、**新規 RAM 消費ゼロで 4 sector/コマンドへ chunk 化**できる（§4.2）。この経路が実際に動くかを最小の実験コードで確認する。
4. 上記 3 が成立しない場合の代替として、`.ram_bank132_tail` 窓（§2.4）を拡張できないか（resident metadata の使用量を圧縮する、または overlay の benign LMA コピー窓の再利用範囲を広げられないか linker script を確認する）を調査する。
5. Phase 2（協調ロード状態機械）に必要な永続状態変数の概算サイズを見積もる（ロード種別、対象 kind/index/part、進捗 sector/offset、宛先アドレス、chunk サイズ等。数バイト〜十数バイト程度になる見込みだが実装前に確定させる）。console_ram の残り 9B では確実に不足するため、確保先候補（bank129/130 の残り 136〜159B の一部を BSS に転用する等）を具体化する。

**変更ファイル**: 基本的に調査のみ。RAM 確保の実装（例: `.ram_bank132_tail` 拡張、visual cache ページ借用の最小実装）はここで着手してよいが、恒久的な chunk 化ロジック自体は Phase 1 に回す。

**Gate**:
- 更新済みの RAM 予算表と CD 読み込み経路表を報告に含める。
- Geargrafx 実機で「page を事前マップしてから複数 sector を直接 DMA できる」ことを最小限のコード変更で実証する（またはできないことを実証し、代替案を提示する）。
- Phase 1 着手に十分な予算（新規 RAM ほぼゼロ、または確保可能な数百バイト以内）の見通しが立つこと。立たない場合は Stop And Ask 条件 1 に従う。

### Phase 1 — visual cache / CD→VRAM 経路の chunk 化

**目的**: §2.3 の「1 sector/コマンド固定」経路を、Phase 0 で確立した方式（page 借用によるゼロ RAM chunk 化、または確保した RAM でのバッファ拡張）でまとめ読みし、シーン遷移などの重いロードでのシーク回数を `ceil(N/chunk)` へ削減する。

**作業内容**（優先度順、Phase 0 の調査結果に応じて調整可）:
1. **`visual_cache_load_cd_part_impl`**（`vn_cache_core.c:326-369`）: page 全体（最大 4 sector = 8KB）を 1 コマンドで読む形に変更する。Phase 0 で page 借用方式が成立するなら scratch 経由の copy を廃し、page マップ後に直接 `pce_cdb_cd_read()` する。既存の「sector 単位ループで CD read → wait → scratch→page copy」を「1コマンドで page 分（またはそれ未満の残りバイト）を読む → wait」に置き換える。
2. **`cd_data_ref_to_vram_visual_impl`**（`vn_cache_core.c:182-213`）・**`copy_data_ref_to_vram`**（`vn_cache_core.c:657`）・scene pack ロードループ（`vn_cache_core.c:1080-1100` 付近）: これらは page キャッシュを経由しないため、Phase 0 で確保した scratch 拡張（または一時的な page 借用）を使い、既存の ADPCM 側と同じ思想（コマンド単位の chunk 化、`cd_transfer_wait()` はコマンドごとに1回）で multi-sector 化する。
3. 変更後も **`sync_cd_external_irq_after_bios_call()`（`psg_mark_hw_dirty()` を含む）が各読み込みコマンド完了後に呼ばれる**契約を維持する。
4. ADPCM 側の教訓（§0）を踏襲: **PSG seek 補償はコマンド単位に1回**。新たに multi-sector 化する経路でも、sector 数ぶんループで補償を積まないこと。visual cache 系の補償定数（`VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES`、既定 10u、`vn_engine_bus.c:268-269` / `vn_cache_core.c:159-160`）が sector 数と無関係にコマンド単位で適用されていることを確認・維持する。

**変更ファイル**: `vn_cache_core.c`、必要なら `vn_engine_state.c`（RAM 確保）、`vn_engine_config.h`（新規 chunk 定数）、`tests/pce-vn-manager.test.js`（新設 pin）。

**Gate**:
- `data/projects/ishi_no_ura` が正常ビルドできること（`--print-memory-usage` で全バンク 99.5% 未満）。
- Geargrafx で **BG/sprite/scene pack を含む重いシーン遷移**（§2.5 の実測手順で `cd_transfer_wait` 相当の BP、または `cycles_to_load` パルス計測でシーク回数を数える）のシーク回数が Phase 0 着手前と比べて明確に減っていること（理想は `ceil(N/chunk)` へ集約）。
- 同じシーン遷移中の PSG 凍結フレーム数（`get_psg_status` の `frequency` が変化しないフレーム数の合計）が明確に減っていること。
- visual cache のキャッシュヒット/追い出し挙動に回帰がないこと（再訪問シーンで BG/sprite が正しく表示される。可能なら `vn_visual_cache_valid`/`kind`/`asset`/`part` を `read_memory` で確認）。
- `npm test` green。
- 実機での聴感確認（PSG BGM の詰まりが Phase 0/1 前と比べて軽減しているか）を人間へ依頼する一文を報告に含める。

### Phase 2 — 協調ロード状態機械（「案B」フル実装）

**目的**: CD 読み込み（ADPCM 音声 + visual cache 双方）を「1 コマンドをブロッキングで待つ」方式から、「1 フレームにつき 1 コマンド（またはそれ未満）だけ進め、main loop へ復帰する」協調方式に変え、ロード中も PSG が本物の main-loop タイミング（credit）で進み続けるようにする。

**前提**: Phase 0 で永続状態変数の置き場（RAM）を確保できていること。確保できなければ Stop And Ask 条件 1 に従い、Phase 0/1 のみで完了とする。

**設計骨子**（詳細設計は実装前に固めること。以下は必須要件）:
1. ロード状態機械 `{active, kind, target(asset/voice index, part), remaining, dest, chunk_pos}` を導入する。置き場所は Phase 0 で確保した RAM。
2. `engine_service()` / `engine_service_blocking()`（`vn_engine_time.c`）と同じ「main loop から毎フレーム呼ばれる」設計に倣い、ロード中は毎フレーム 1 chunk だけ CD read コマンドを発行し、即座に呼び出し元へ戻る（呼び出し元は "loading" 状態でメッセージ/シーン進行を待機する）。
3. **CD ブラケット（`prepare_cd_data_access()`/`resume_cdda_after_cd_data_access()`/`sync_cd_external_irq_after_bios_call()`、TIMER 所有 `vn_psg_timer_own()`/`release()`）をフレーム跨ぎで開いたまま保持できるか**を最初に検証する（Stop And Ask 条件 4 に直結する最難所）。成立しない場合、ロード全体ではなく「1 コマンド分だけ」ブラケットを開閉する粒度（Phase 1 の chunk 化と同等の粒度で、単にブロッキング wait を来フレームへ delay するだけ）に設計を落とすことを検討する。
4. `psg_mark_hw_dirty()` の契約（全 BIOS 呼び出し後に必ず呼ぶ）を、コマンド単位に分割しても維持する。
5. 呼び出し元（`load_adpcm_voice`、`visual_cache_load_cd_part_impl` 等）を、単一ブロッキング関数から「開始/進行/完了」を返す非ブロッキング API へ変える。既存の呼び出し箇所（メッセージ開始、シーン遷移、scene pack 先読み等）がこの非同期化に耐えられるか個別に確認し、耐えられない箇所（同期完了が必須なもの）は明示的にブロッキング版を残す設計にしてよい（全経路を無理に協調化しない）。

**変更ファイル**: `vn_adpcm_core.c`、`vn_cache_core.c`、`vn_engine_bus.c`、`vn_engine_time.c`、`vn_msg_core.c`（呼び出し元の状態待機化）、`vn_main.c`（main loop への統合）、`tests/pce-vn-manager.test.js`。

**Gate**:
- Geargrafx で、重いロード中も PSG BGM の周波数/音量レジスタが**フレームごとに正しく進行**していること（`get_psg_status` を毎フレーム記録し、ロード完了を待たずに演奏が進んでいることを確認）。
- ADPCM voice の発音長・タイミングに回帰がないこと（Phase B/C の Gate 相当: ±数フレーム以内）。
- CD-DA pause/resume に回帰がないこと。
- 過去破壊シナリオ再現テスト: PSG SONG 再生 + 重いシーン遷移（BG+sprite+scene pack 同時ロード）+ voiced message を連続実行し、VRAM/SATB/VDC レジスタに破壊がないこと。
- `npm test` green。
- 最終的な `--print-memory-usage` レポート（全バンク）を提出する。
- 実機での聴感確認（PSG BGM の詰まりが解消しているか）を人間へ依頼する一文を報告に含める。

## 6. Verification Requirements

- **Geargrafx MCP を一次**とする。§2.5 の手順・落とし穴を再利用し、車輪の再発明をしないこと。
- 各 Phase Gate で `npm test`（少なくとも `node --test tests/pce-vn-manager.test.js`）を実行する。
- `pce_cdb_adpcm_status()` の毎フレームポーリングは全 Phase を通して禁止。
- テストを実行できない場合は理由と残るリスクを最終報告に明記する（`CLAUDE.md` ルール）。
- ドキュメント更新: 公開 API・ビルド仕様・既知制約に変化があれば、同じ作業内で `docs/pce-vn-engine-redesign.md` / `docs/pce-memory-bank-strategy.md` / `docs/pce-asset-meta-cd-ondemand.md` のうち該当するものを更新し、最終回答で明記する。

## 7. Reporting Format

1. Phase ごとの変更概要・コミット hash（コミットした場合）・更新した test pin の一覧。
2. 各 Phase Gate の計測値（シーク回数の before/after、PSG 凍結フレーム数の before/after、bank 使用率 `--print-memory-usage` 結果）。
3. §2.1〜2.3 の表の実測による訂正内容。
4. 実施できなかった検証と残存リスク。
5. Stop And Ask で停止した項目（該当する場合）。
6. 更新したドキュメントの一覧。
7. 人間が実機/エミュで聴感確認すべき項目のリスト。

## 8. Out-of-scope

- Editor UI / asset pipeline / `vn.h` コマンド契約の変更。
- PSG state-driven sequencer（`vn_psg_core.c`）自体の設計変更（Phase C で確立済み、触らない）。
- メッセージ文字送り（`textSpeedFrames`）の計算方式変更。
- CD-DA の pause/resume の最終的な HW 挙動の変更（呼び出し経路の変更は可）。
- EmulatorJS 側の修正、Geargrafx 本体の修正（upstream 報告は可）。
- 見た目のためのリファクタリング、無関係な整形。
- HuCard（非 CD）ビルドへの影響（本書は CD 専用経路のみが対象。ただし `#if defined(__PCE_CD__)` ガードを壊してビルド不能にしないこと）。
