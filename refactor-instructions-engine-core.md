# refactor-instructions-engine-core.md — VN Runtime エンジン足回りゼロベース再設計 実装指示書

> **本書は `refactor-instructions-psg-adpcm.md` の F1〜F6 個別パッチ路線を置き換える。**
> F1〜F6 の背景調査（PSG/ADPCM タイミング乖離の構造的原因）と Behaviors To Preserve は引き続き有効な参照資料だが、
> 新規実装は `refactor-instructions-psg-adpcm.md` の Implementation Phases（Phase 0〜4）には従わず、本書の Phase A〜E に従うこと。

> **[2026-07-05 as-built 追記]** Phase A/B/C は実装完了（`codex/psg`: Phase A=`4fa52c6`, Phase B+C=`bdad97b`）し、Geargrafx 実機で Gate 合格。**本再設計の主目的（再生中の cache load / ADPCM start による PSG 論理状態と HW レジスタの乖離）は Phase C の state-driven PSG で解決済み**。Phase D（`bus_cd_*` 集約）は RAM/bank が限界（bank 99%+、console_ram 残 2〜3B）で構造的集約が実装不能かつ機能要件は Phase B/C で達成済みのため**見送り**。Phase E の msg_core credit 化・死コード削除は利益<リスク（LTO が死コードを既にストリップ、msg 変更はテキスト速度回帰リスク）で見送り、docs 最終化のみ実施。詳細と恒久知見（**zp/MPR0 ポインタの罠**、RAM 予算の壁）は設計書 `docs/pce-vn-engine-redesign.md` §12 を参照。

このファイルは実装担当モデル（Codex / Sonnet 等）向けの作業指示書である。
作業前に必ず `CLAUDE.md` / `AGENTS.md` を読むこと。優先順位は次のとおり:

**人間の指示 > `CLAUDE.md` / `AGENTS.md` > 設計書 `docs/pce-vn-engine-redesign.md` > 本書**

矛盾が見つかった場合は、より優先度の高い文書に従い、その齟齬を最終報告に明記すること。

---

## 1. Objective

CD-ROM2 VN runtime（`template/template_pce_vn_cd/src/pce_vn_runtime.c`、現状約 7,100 行の単一ファイル）の音声・タイミング足回り（PSG / ADPCM / cache load / CD / VRAM 更新の時間管理）を、設計書 [`docs/pce-vn-engine-redesign.md`](docs/pce-vn-engine-redesign.md) の設計に基づき**ゼロベースで書き直す**。

- **スコープ内**: PSG（state-driven sequencer への刷新）、buffered ADPCM、Message（typewriter/credit 化）、basic cache load（BG/Sprite/PSG pattern の CD→RAM 先読み）、これらを支える `engine_time`（credit + TIMER IRQ 一次昇格）と `engine_bus`（MPR/IRQ/BIOS 呼び出しの唯一のチョークポイント）。
- **スコープ外・変更禁止**: Editor UI、asset pipeline（`pce-asset-manager.js` 等）、`vn.h` の生成データ形式・コマンド契約。CD-DA / sprite / BG / choice / spritetext の**挙動**は変更しないが、新しい `engine_bus` / `engine_time` 経由へ**移植**する（動作は不変のままファイル構成・呼び出し経路だけ変わる）。
- 目的ではないこと: 見た目のリファクタリング、Editor UI の変更、生成データフォーマットの変更、CD-DA の pause/resume 設計変更。

## 2. 背景知識

`refactor-instructions-psg-adpcm.md` §2 の PCE 音声ハードウェアの前提（PSG はシーケンサを持たない CPU 駆動音源、ADPCM は自走、CD-DA はドライブ排他）はすべて有効。加えて、今回の再設計が解決する問題:

- 現行 PSG ドライバは **edge-driven**（`psg_apply_step_row(step_no)` がその step の entry だけを HW に書く）。tick クランプや補償バーストで step が飛ぶと、飛んだ step の note-off / period 変更が永久に失われる。
- BIOS 呼び出し（CD read / ADPCM read from CD 等）後に PSG シャドウを再同期する手段がない。System Card helper が PSG select latch 等を触っても復元不能。
- タイミングが実フレーム credit（`vn_vblank_credit`）と PSG 専用 synthetic credit + open-loop 補償定数の二重系統になっており、BIOS ブロック中は常に推測。
- bank slot4/6 の push/pop・IRQ guard 順序・timer release-first のような横断的不変条件が呼び出し規律だけに頼って ~20 箇所に分散している（過去に `service_psg` が overlay 呼び出し元の slot4 を bank130 に戻したまま RTS し、I/O ページ暴走を起こした実バグあり）。

これらを構造的に解消するのが `engine_time` / `engine_bus` / state-driven `psg_core` である。詳細な設計根拠は設計書を参照。

## 3. Project Understanding（対象と反映経路）

- 対象 runtime: `template/template_pce_vn_cd/src/pce_vn_runtime.c`。プロジェクト側 `data/projects/<name>/src/pce_vn_runtime.c` は `pce-vn-manager.js` の `syncVisualNovelRuntime`（**3875 行**）がテンプレートから同期する。同関数は 3877-3880 行で `main.c` と `pce_vn_runtime.c` の 2 ファイル固定リストを `copyIfChanged` している。**モジュール分割後もこのリストが同期対象を漏れなくカバーするよう、Phase A で拡張すること**（後述）。
- ビルド構造: `main.c` は `#include "pce_vn_runtime.c"` の 1 行のみ（`isThinVisualNovelMain`、`pce-build-system.js:567-569` が正規化して判定）。`collectSourceFiles`（`pce-build-system.js:583-592`）は `src/main.c` + `src/generated/assets.c` + （VN プロジェクトなら）`src/generated/vn.c` の**3 ファイルのみ**をコンパイル対象にする **unity build** である。→ `pce_vn_runtime.c` を **umbrella** として module `.c` を `#include` する方式にすれば、`collectSourceFiles` / `pce-build-system.js` は無変更で済み、static リンケージ・インライン最適化（bank 99% 満杯対策で必須）も維持できる。
- build-meta hash: `pce-vn-manager.js` の `vnBuildSignature`（**374 行**）が `generator.runtime = readTextHash(path.join(templateDir, 'pce_vn_runtime.c'))`（**380 行**）で単一ファイルのハッシュだけを見ている。umbrella が `#include` する module ファイル群もハッシュ対象に含めないと、module だけを変更したビルドがキャッシュヒットして再ビルドされない。Phase A で対応必須。
- 回帰テスト: `tests/pce-vn-manager.test.js` が runtime のソースを正規表現レベルで固定している。今回確認した主な pin:
  - **1594-1596 行**: `fs.readFileSync(path.join(__dirname, '..', 'template', 'template_pce_vn_cd', 'src', 'pce_vn_runtime.c'), 'utf-8')` で単一ファイルを読む。umbrella 化後もこのパスと読み込み方は変わらない（`#include` はプリプロセッサ展開前の生ファイルを見るので、grep 対象は umbrella ファイルの生テキストのみになる点に注意。module 側へ移した内容を検証する pin は、pin 自体を module ファイル読み込みへ書き換える必要がある）。
  - **1647 行**: `assert.match(runtime, /#define VN_PSG_TIMER_IRQ_DRIVER 0/);` — 現行は edge-driven ドライバの実験的 IRQ fallback フラグが既定 0 で固定されている。Phase B 以降、TIMER IRQ が一次昇格されると、このフラグの意味・既定値が変わる可能性が高い。**この pin は Phase B で新設計の契約に合わせて書き換える**（後述 Gate 参照）。
  - **1650-1651 行**: ISR 実装を固定する pin。`vn_psg_timer_irq_handler` の asm 本体（`sta $1403"`, `vn_vblank_credit++`, `"rti"`）と、ISR 本体スライス（関数開始から 1400 文字）に `tick_psg|psg_apply|pce_vdc|pce_ram_bank1(2[1-9]|3[0-5])|IO_VDC` を**含まないこと**を assert している。この「ISR は PSG/MPR/VDC に触れない」契約は新設計でも**不変**（Stop And Ask 条件そのもの）。
  - **2056-2154 行付近**: message / ADPCM 順序の pin。特に 2152 行 `call_overlay_preload_message_glyph_masks(message);\n        service_psg_during_blocking_work();\n        (void)play_adpcm_message_voice(message->voice_index);` のような呼び出し順序 assert、2069 行の `main.c` / `template-vn/src/main.c` が `#include "pce_vn_runtime.c"` 固定であることの assert。
  - この他 service topology 系（`service_psg_ticks` / `service_psg_during_blocking_frames` / `service_adpcm_during_blocking_frames` 等の関数シグネチャ・呼び出し関係を固定する pin）が 1594-1712 行に集中している。
  - **2398-2430 行付近**: `vn_cd_irq1_quiet_handler` / `quiet_cd_unit_irqs` / `VN_CDB_IRQ_MASK_RUNTIME_QUIET` / `vn_psg_timer_own` / `vn_psg_timer_release` の実装断片を固定する pin 群。IRQ mask の quiet/own 切り替えロジックが正確に該当箇所にあり、`engine_bus` へ移植する際にこれらも書き換え対象になる。
- 検証エミュレータ: Geargrafx（MCP あり、`geargrafx-debugging` / `geargrafx-romhacking` スキル）を一次、EmulatorJS/WASM を二次とする（`CLAUDE.md` Test Play 節）。
- 再現プロジェクト: `data/projects/ishi_no_ura`（PSG SONG 再生中に voiced message で ADPCM 再生する構成が存在）。

### 現状の主要関数・行番号（現 HEAD 637592f 時点、Phase A 開始前の参照値）

作業中にファイル分割で行番号がずれるため、これらは**着手前のスナップショット**として扱うこと。

| 要素 | 行番号 |
|---|---|
| `VN_PSG_TIMER_IRQ_DRIVER` 定義 | 163 |
| `service_adpcm_playback` 前方宣言 | 684 |
| `tick_psg` 前方宣言 | 689 |
| `service_psg_ticks` 前方宣言 | 690 |
| `vn_wait_next_vblank` 実装（asm） | 836 |
| `delay_frame` 実装 | 875 |
| `cd_transfer_wait` 実装 | 1401 |
| `vn_psg_timer_own` | 1356 |
| `vn_psg_timer_release` | 1369 |
| `load_adpcm_voice` | 4226 |
| `play_adpcm_voice` | 4494 |
| `service_adpcm_playback` 実装 | 4568 |
| `psg_apply_step_row` | 4734 |
| `tick_psg` 実装 | 4992 |
| `service_psg_ticks` 実装 | 5020 |
| `vn_psg_timer_irq_handler` | 5072 |

常駐バンクの MPR co-residency 宣言（`PCE_RAM_BANK_AT`）: bank128=MPR2（12 行）、bank129=MPR3（13 行）、bank130=MPR4（14 行）。

## 4. 設計参照

本書は設計の再発明を行わない。実装は必ず [`docs/pce-vn-engine-redesign.md`](docs/pce-vn-engine-redesign.md) のモジュール構成表・中核設計 3 点（psg_core state-driven / engine_time 単一credit / engine_bus 唯一のチョークポイント）・3 シナリオ制御フローに従うこと。設計書と本書が食い違う場合は設計書を優先し、その齟齬を報告すること。疑問点や設計上の未決事項（open questions）は変更を加えずに最終報告へ書くこと。

## 5. Behaviors To Preserve（壊してはいけない既存挙動）

1. `CLAUDE.md` の禁止事項すべて。特に: `pce_cdb_adpcm_status()` の毎フレームポーリング禁止 / 短尺音声を true streaming に戻さない / 自然終了後の stop/reset 追撃禁止 / glyph カーソルは値渡し（ポインタ経由 `(*pos)++` 禁止） / sprite tick を ADPCM 中に止めない / resident SFX が BG ロード中に無音化しない。
2. **textSpeedFrames は build 時にエディタが焼き込む値のまま凍結**。文字送り速度の計算方式を runtime へ戻さない（改行を除いた発話文字数を分母にする式も含め不変）。
3. `vn_wait_next_vblank()` の asm 実装とセマンティクス（映像同期 ≠ テンポ源）は不変。
4. CD-DA の pause/resume・deferred resume 機構（`prepare_cd_data_access()` 系、`begin_cdda_deferred_resume()` / `end_cdda_deferred_resume()`）は今回のスコープ外であり、挙動を変えない（呼び出し経路が `engine_bus` 経由に変わっても最終的な HW 挙動は同一）。
5. `main.c` の内容（`#include "pce_vn_runtime.c"` 1 行のみ）と umbrella ファイル名 `pce_vn_runtime.c` は test/build が byte 固定するため**変更不可**。
6. glyph カーソルは値渡し + 直接インクリメント（`vn_glyph_decode`/`vn_glyph_stride` の `pos = pos + stride` 方式）。
7. sprite tick（口パク・animation）を ADPCM 再生中に止めない。差分 refresh（SATB pattern word だけの更新）を維持し、`clear_sprites()`・palette upload・pattern CD load・64 entry 全転送への逆行を禁止。
8. resident SFX が BG ロード中に無音化しない（分散 tick の意図を維持）。
9. HuCard（非 CD）ビルドのコンパイル可否（`#if defined(__PCE_CD__)` ガードの整合）。umbrella 分割後も `__PCE_CD__` 未定義時に module 群が破綻なくコンパイルされること。
10. bank128/129/130 の使用率が限界に近い（実測 93〜99%）。コード追加で `ld.lld: .ram_bank129 ... overflowed` が出たら、機能を削らず `VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替えか overlay 退避で均す。`-Wl,--print-memory-usage` で確認する。

## 6. Stop And Ask Conditions

以下に該当したら実装を止めて人間に報告すること（該当しない他 Phase の作業は独立に継続してよい）。

1. **G-B1 不成立**: Geargrafx で「BIOS CD_READ 実行中に TIQ が配送されるか」を実証できず、かつ代替の VBlank エッジ実測でもカバーできない窓が見つかった場合（設計書の fallback 抽象 `VN_TIME_SOURCE_TIMER=0` でも解決しない場合）。
2. bank使用率が **>99.2%** に達し、`VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替えや overlay（bank133）退避を尽くしても解消できない場合。
3. PSG 波形 RAM の破壊が観測された場合（再生中の書き換え不可という前提が崩れた場合）。
4. `tests/pce-vn-manager.test.js` の test pin 書き換えが、本書に列挙した想定範囲（1594-1712 行付近の service topology、1647 行 `VN_PSG_TIMER_IRQ_DRIVER` 固定、1650-1651 行 ISR 禁止 assert、2056-2154 行付近の message/ADPCM 順序）を超えて連鎖的に他領域まで波及する場合。
5. 設計上、ISR（naked asm TIQ ハンドラ）に PSG レジスタ・MPR2-7 切替・VDC アクセスを入れないと成立しない構造になった場合（前回 TIMER IRQ 実装がスプライト/BG 破壊で撤回された再発リスク）。

## 7. Implementation Phases

各 Phase は「ビルド可能・Geargrafx 検証可能・1 コミットで revert 可能」を満たすこと。コミット/プッシュは人間の明示指示があるときのみ行う（それまでは作業内容を明確なコミット単位に分けておく）。コミットメッセージは日本語。

### Phase A — モジュール分割（挙動不変の transplant）

**作業内容**:
1. 設計書のモジュール構成表に従い、`pce_vn_runtime.c` の内容を以下へ分割する（ファイルはすべて `template/template_pce_vn_cd/src/` 配下）。既存ロジックはそのまま移動するだけで、動作を変えない。
   - `vn_engine_config.h`（defines / section macros / PSG MMIO）
   - `vn_engine_time.c/.h`（credit counter、TIQ ISR、own/release、blocked-poll — この時点では既存の `vn_vblank_credit` ロジックをそのまま移植するだけでよい。TIMER 一次昇格は Phase B）
   - `vn_engine_bus.c/.h`（MPR slot4/6 push/pop、IRQ guard、overlay dispatch、BIOS bracket）
   - `vn_psg_core.c/.h`（既存の edge-driven ロジックをそのまま移植。state-driven 化は Phase C）
   - `vn_adpcm_core.c/.h`
   - `vn_cache_core.c/.h`
   - `vn_msg_core.c/.h`
   - `vn_port_video.c` / `vn_port_scene.c` / `vn_port_sprite.c` / `vn_port_cdda.c`（スコープ外サブシステムの移植、挙動不変）
   - `vn_main.c`（`main()` + `engine_frame_end()`）
2. `pce_vn_runtime.c` 自体は umbrella として、config → state → time → bus → cores → ports → main の順で上記ファイルを `#include` するだけにする。
3. `pce-vn-manager.js` の `syncVisualNovelRuntime`（3875 行）の `targets` 配列（3877-3880 行）を、`main.c` + `pce_vn_runtime.c` に加えて新規 module ファイル群を列挙する形に拡張する（ディレクトリ列挙化でもよいが、対象拡張子・除外パターンを明示すること）。
4. `vnBuildSignature`（374 行）の `generator.runtime` ハッシュ（380 行）を、umbrella が `#include` する全 module ファイルのハッシュを合成する形に拡張する（module 追加・変更を検知できるようにする）。
5. `tests/pce-vn-manager.test.js` の該当 pin のうち、内容が module 側へ移った箇所は読み込みパスを付け替える（例: PSG 実装検証 pin は `vn_psg_core.c` を読むよう変更）。**pin が検証する正規表現の内容自体は変えない**（Phase A は挙動不変の transplant であるため）。

**変更ファイル**: `template/template_pce_vn_cd/src/pce_vn_runtime.c`（umbrella 化）、同ディレクトリ配下の新規 module ファイル群、`pce-vn-manager.js`（`syncVisualNovelRuntime` / `vnBuildSignature`）、`tests/pce-vn-manager.test.js`（pin のパス付け替えのみ）。

**Gate**:
- `mos-pce-cd-clang -Wl,--print-memory-usage` の各バンク使用 byte 数が分割前と**同等**（コード移動のみなので実質同一になるはず。差異があれば原因を報告）。
- `ishi_no_ura` を CD ビルドし、Geargrafx で BGM（PSG）+ voiced message（buffered ADPCM）が分割前と同じ挙動で動作すること。
- `npm test` green。

### Phase B — engine_time + engine_bus、TIMER IRQ 一次昇格

**作業内容**: `vn_engine_time.c/.h` と `vn_engine_bus.c/.h` を設計書の仕様に刷新する。**PSG ドライバ自体（`vn_psg_core.c`）は Phase B ではまだ edge-driven のままにし**、テンポ源（timing）だけを差し替える（変更の分離）。

- 単一 credit カウンタを TIQ ISR（naked asm、A/X/Y + MPR0 保存、`$1403` ack、counter++、RTI。PSG/MPR2-7/VDC/BIOS/C 呼び出し禁止）駆動に一次昇格。
- BIOS ブロック窓内は推測ではなく blocked-poll（`IO_VDC_STATUS` VBlank エッジの実測）で credit 化。
- synthetic credit（`vn_psg_synthetic_credit`）・`VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES`・`VN_CD_CHUNK_ESTIMATED_FRAMES`・5 系統の `service_psg_*` 変種は全廃し、`engine_service()` / `engine_service_blocking()` の 2 本に集約する。
- own/release プロトコル（release = TIQ mask → timer 停止 → `$20F5` bit clear の順序厳守）は既存 lab 実装の契約を維持。own は `bus_bios_close` と `engine_frame_end` からのみ。
- `vn_wait_next_vblank()` の asm と映像同期セマンティクスは不変。
- fallback: `VN_TIME_SOURCE_TIMER=0` で VBlank エッジサンプラへ全時間ソース切替できる抽象を用意する。
- `tests/pce-vn-manager.test.js` の 1647 行 `VN_PSG_TIMER_IRQ_DRIVER 0` 固定 pin、1650-1651 行の ISR 禁止 assert を新設計の契約（TIMER が一次昇格した状態、ただし ISR は credit-only のまま）に合わせて書き換える。「ISR 内で PSG/MPR6/VDC を触らない」という契約自体を固定する assert は必ず残すこと。

**変更ファイル**: `vn_engine_time.c/.h`、`vn_engine_bus.c/.h`、関連する呼び出し元（`vn_psg_core.c` 等の credit 消費箇所）、`tests/pce-vn-manager.test.js`。

**Gate G-B1（最重要）**:
- Geargrafx で **BIOS CD_READ 実行中の TIQ 配送有無を実証**する。
- blocked-poll credit ≈ 実時間 ±1 frame/chunk。
- `psg_step` 進行数の 60 秒テンポ誤差 ±1%（旧 edge-driven ドライバのまま、テンポ源だけ差し替えた状態で計測）。
- cache load を 100 回連続実行してハングしないこと。
- **過去破壊シナリオ再現テスト**: PSG SONG 再生 + sprite pattern CD ロード + SATB 差分更新 + BG 切替 + message glyph 描画を連続実行し、VRAM/SATB/VDC レジスタに破壊がないこと（前回 TIMER IRQ 実装が撤回された原因の再発がないことの確認）。
- 上記が崩れた場合は Stop And Ask 条件 1 に従う。

### Phase C — psg_core を state-driven へ書き直す

**作業内容**: 設計書 (a) の仕様に従い、edge-driven `psg_apply_step_row()` ベースの実装を、論理 state（`psg_logical[6]`）+ HW shadow（`psg_shadow[6]` + `psg_shadow_valid`）+ `psg_advance(n)` / `psg_commit()` / `psg_mark_hw_dirty()` の state-driven sequencer へ全面書き直しする。

- `psg_advance(n)` は論理 state にのみ適用（MMIO なし、bank134/135 walk は overlay のまま）。
- `psg_commit()` は logical vs shadow の diff から変化 register だけを SELECT→書き込み。pattern bank アクセス不要なので任意のブロッキング文脈から安全に呼べる設計にする。
- `psg_mark_hw_dirty()` は全 BIOS 呼び出し後に `engine_bus` が必ず呼ぶようにする。
- 旧 clamp 定数（`VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM` / `VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME`）は廃止し、credit cap（4/frame, max 8）だけを遅延上限として残す。
- 波形 RAM は再生中書き換え不可のため resync 対象外とする（BIOS が波形 RAM を壊す証拠がないことを前提にするが、open question として設計書に記録済みの内容を踏襲する）。

**変更ファイル**: `vn_psg_core.c/.h`、`vn_engine_bus.c`（`psg_mark_hw_dirty()` 呼び出し箇所の追加）、関連 test pin。

**Gate**:
- **register 乖離テスト**: SONG 再生中に ADPCM 開始 + cache load を実行 → halt → Geargrafx で PSG レジスタダンプを取得し、JS 側で pattern から独立に計算した論理 state oracle と一致すること。
- 強制的に 8-tick catch-up を発生させる窓（credit cap 上限）で note-off が正しく消音されること（取りこぼしがないこと）。
- テンポ ±1% を再計測して Phase B の値から悪化していないこと。

### Phase D — adpcm_core + cache_core を bus へ載せ替え

**作業内容**: `vn_adpcm_core.c` の buffered load/play/stop/service と `vn_cache_core.c` の load_runtime_cache dispatch + chunk protocol を、`engine_bus` の `bus_cd_begin()` → `bus_cd_read_chunk()` → `bus_cd_settle()` → `bus_cd_end()` プロトコル経由へ載せ替える。ADPCM primitive も同形にする。

**変更ファイル**: `vn_adpcm_core.c/.h`、`vn_cache_core.c/.h`、`vn_engine_bus.c`。

**Gate**:
- mid-message cache load を挟んでも voice 発音長 = `play_frames` ±4 frame。
- ADPCM_END backstop（`IO_PCD_STATUS` の ADPCM_END 検出）が維持されていること。
- CD-DA pause/resume が正常動作すること。
- Phase B/C の破壊シナリオ再現テストを再実行して回帰がないこと。

### Phase E — msg_core credit 化 + 死コード削除 + docs/tests 最終化

**作業内容**:
- `vn_msg_core.c` の typewriter service を credit 消費方式に刷新する（textSpeedFrames の焼き込み値・計算方式自体は不変、消費機構だけを engine_time の credit に統一）。
- 旧実装で不要になったコード（synthetic credit 機構、廃止された service 変種、旧 clamp 定数等）を削除する。
- `docs/pce-memory-bank-strategy.md`・`docs/pce-vn-engine-redesign.md`・`tests/pce-vn-manager.test.js` を新設計の最終形に合わせて更新する。

**変更ファイル**: `vn_msg_core.c/.h`、死コード削除対象の各モジュール、`docs/pce-memory-bank-strategy.md`、`tests/pce-vn-manager.test.js`。

**Gate**:
- `ishi_no_ura` 全編を Geargrafx で通しプレイし、回帰がないこと。
- EmulatorJS smoke テスト（joypad edge が ADPCM 再生後も正常に戻ること）。
- `npm test` green。
- 最終的なメモリ使用率レポート（各バンクの `--print-memory-usage` 結果）を提出すること。

## 8. Verification Requirements

- **Geargrafx を一次**とする（`geargrafx-debugging` / `geargrafx-romhacking` スキル、`mcp__geargrafx__*` ツール）。PSG register write trace のテンポ整合、ADPCM 発音長、VRAM/SATB/VDC レジスタの表示回帰を確認する。`debug_step_frame` は 1:1 を強制し実時間のフレーム落ちを隠す点に注意すること（`CLAUDE.md` 記載どおり）。
- **EmulatorJS/WASM を二次**とする。標準 EmulatorJS/WASM core は ADPCM 再生後に入力待ちから進まなくなることがある既知の挙動があるため、これを runtime のバグと誤認しないこと。まず ADPCM あり/なし比較、frame counter、`simulateInput()` 直接注入、読み込まれた core（`mednafen_pce-wasm.data` 等）を確認し、**runtime を壊す変更で回避しない**。
- `npm test`（少なくとも `node --test tests/pce-vn-manager.test.js`）を各 Phase Gate で実行する。
- `pce_cdb_adpcm_status()` の毎フレームポーリングは全 Phase を通して禁止（WASM core が固まる）。
- ドキュメント更新: 公開 API・ビルド仕様・既知制約に変化があれば、同じ作業内で `PLUGIN.md` / `docs/pce-memory-bank-strategy.md` / `docs/pce-media-programming-guide.md` / `docs/user-guide.md` のうち該当するものを更新し、最終回答で明記する。
- テストを実行できない場合は理由と残るリスクを最終報告に明記する（`CLAUDE.md` ルール）。

## 9. Reporting Format

1. Phase ごとの変更概要・コミット hash（コミットした場合）・更新した test pin の一覧。
2. 各 Phase Gate の計測値（`psg_step` 誤差、voice 発音長、blocked-poll credit 誤差、bank 使用率 `--print-memory-usage` 結果、cache load 連続実行結果）。
3. 実施できなかった検証と残存リスク。
4. Stop And Ask で停止した項目（該当する場合）。
5. 設計書・本書の記載と実ソースとの齟齬が見つかった場合はその内容。
6. 更新したドキュメントの一覧。

## 10. Out-of-scope

- Editor UI / asset pipeline / `vn.h` コマンド契約の変更。
- CD-DA の pause/resume 設計変更（挙動を変えずに `engine_bus` 経由へ移植するのみ）。
- PSG 音色・波形・エンコーダ（editor 側 `pce-psg-quantize.js` / import 系）の変更。
- メッセージ文字送り（`textSpeedFrames`）の計算方式変更。
- EmulatorJS 側の修正、Geargrafx 本体の修正（upstream 報告は可）。
- 見た目のためのリファクタリング、無関係な整形。
