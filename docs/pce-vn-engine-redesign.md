# PC Engine CD-ROM2 VN Runtime エンジン再設計 — 設計書

このドキュメントは `template/template_pce_vn_cd/src/pce_vn_runtime.c` の音声/表示足回り（PSG・buffered ADPCM・Message・basic cache load）をゼロベースで再設計するための設計書である。対象読者は実装担当モデル（Codex / Claude 等）。実装フェーズの詳細な手順・Gate・Stop And Ask 条件は `refactor-instructions-engine-core.md` を参照すること。本書は設計そのものを記述し、実装コードは含まない。

設計内容は承認済みプラン（`runtime-fizzy-matsumoto` セッションの計画）で確定済みであり、本書はその骨子を実装可能な形に展開したものである。記載する関数名・定数名・セクションマクロ名は HEAD `637592f` 時点の `template/template_pce_vn_cd/src/pce_vn_runtime.c`（約7,100行）と照合済みである。行番号は変更のたびに腐るため、原則として関数名・定数名のみで参照する。

## 0. 前提の補足（実ソース照合で判明した現状）

設計に入る前に、現行実装が `refactor-instructions-psg-adpcm.md` に記載された初期状態からすでに前進している点を明記する。実装担当は「ゼロからの改修」ではなく「現行の到達点からの置き換え」であることを認識すること。

- `VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES` は現在 `10u`。旧ドキュメントに記載された `24u` の一律バーストや `VN_CD_CHUNK_ESTIMATED_FRAMES` は解消済みで、補償は PSG 専用に即時適用する。CD helper 後の settle poll は `VN_CD_TRANSFER_SETTLE_POLL_ITERATIONS`（既定 `4096u`）へ短縮し、RAM 直読み payload は `VN_CD_RAM_READ_CHUNK_SECTORS`（既定 `2u`）までまとめる。ADPCM RAM への CD read は既定 `8u` sector chunk（`VN_ADPCM_MESSAGE_READ_CHUNK_SECTORS` / `VN_ADPCM_PRELOAD_READ_CHUNK_SECTORS`）でまとめ読みする。**当初は「1 sector chunk なら PSG の聴感停止を細切れにできる」と考え `1u` にしていたが、Geargrafx 実測（2026-07）でこれは逆効果と判明**した: 各 `pce_cdb_adpcm_read_from_cd` コマンドは sector 数にほぼ依らない seek 支配の約10フレーム（≈150ms）latency を払うため、1 sector/コマンドだと N sector 音声が ~N 回の seek（30 sector 音声で約4.5秒・その間 PSG 凍結）になっていた。数 sector/コマンドにまとめると seek が `ceil(N/chunk)` に集約され、voice ロード中の PSG 停止が実測・聴感 A/B で軽減する（1 コマンドあたりの凍結は延びるが総凍結は激減。音声飛びは完全には消えないため今後の追加改善余地あり）。helper 後の ADPCM busy wait は `VN_ADPCM_BUSY_PSG_POLL_INTERVAL`（既定 `16u`）ごとに `VN_ADPCM_BUSY_PSG_POLL_ITERATIONS`（既定 `192u`）で PSG 専用に濃くサンプリングする。busy sampler が実 VBlank を拾えなかった窓だけ `VN_ADPCM_BUSY_PSG_FALLBACK_FRAMES`（既定 `1u`）を滴下し、ADPCM CD read の seek 補償（`VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES`）は **BIOS read コマンド（chunk）ごとに1回**だけ適用する（`wait_adpcm_cd_transfer_ready` は sector 数ぶん `cd_transfer_wait` をループしない）。seek latency は chunk サイズにほぼ依らないため、sector 毎に補償すると chunk 化した voice ロードで PSG が chunk 倍だけ過剰進行し BGM が飛ぶ。chunk 内の per-sector 転送ぶんだけ `VN_ADPCM_CD_READ_PSG_COMPENSATION_FRAMES`（既定 `1u` × sector 数）で追加補償する。PSG 再生中の VRAM copy は `VN_VISUAL_VRAM_COPY_SLICE_BYTES`（既定 `16u`）で細かく service へ戻す。
- `vn_vblank_credit` による実フレーム credit は `VN_TIME_SOURCE_TIMER 1` の TIMER IRQ が一次ソースになった。CD/ADPCM BIOS helper 中は TIMER を System Card へ返すため、`time_blocked_poll()` の実測に加えて、helper 内で見えない時間だけ `VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES` で PSG 専用に補う。
- `VN_TIME_SOURCE_TIMER` は既定 `1`。`vn_psg_timer_irq_handler` の naked asm ISR、`vn_psg_timer_own()`/`vn_psg_timer_release()`、release-first guarded wrapper 群、`vn_timer_owned` ゲートを標準 path として使う。
- PSG ステップ適用（`psg_apply_step_row` → `psg_apply_step_row_impl`）はすでに bank133 overlay（`VN_OVERLAY_CODE`、`vn_overlay_dispatch_locked` 経由）に退避済みで、bank134/135 の PSG パターンバッファも稼働中である。「PSG ドライバをゼロから overlay 化する」のではなく、「overlay 化された edge-driven ドライバを state-driven へ置き換える」のが本設計のスコープである。

以上を踏まえ、以降の章では現行実装を出発点として差分を記述する。

## 1. 目的と背景

### 1.1 目的

PSG(SONG/SFX) 再生中に buffered ADPCM 再生や CD からの cache load が割り込んでも、PSG の論理的な演奏状態（どのチャンネルが何の音を鳴らすべきか）と PSG ハードウェアレジスタの実際の値が乖離しないことを構造的に保証する。あわせて、テンポ源・BIOS ブロック区間の扱い・呼び出し規律を単純化し、今後の機能追加（Audio/Sprite コマンド拡張等）で bank128/129/130 が逼迫したときにコードの見通しが失われないようにする。

本作業はドキュメント（設計書 + 実装フェーズ計画）の作成のみを行い、実装は次の作業（`refactor-instructions-engine-core.md` に基づく別セッション）で行う。

### 1.2 乖離問題の構造的原因（現行ソースの該当箇所）

再設計前の実装で PSG とハードウェアが乖離しうる原因は次の4点に整理できる。いずれも個別パッチ（`refactor-instructions-psg-adpcm.md` の F1〜F6）では対症療法にしかならず、構造自体の書き直しが必要という結論に至った。

**(1) PSG ドライバが edge-driven である**

`psg_apply_step_row(step_no)`（`VN_BANKED_CODE`、内部で `vn_overlay_dispatch_locked(VN_OVERLAY_OP_APPLY_PSG_STEP, ...)` 経由に `psg_apply_step_row_impl` を呼ぶ）は、その step に属する entry だけを `psg_apply_step_entry()` 経由でハードウェアへ書く。`tick_psg()` が呼ばれる回数（= サービス頻度）が実フレームより少なければ `psg_step` の進行が遅れるだけで実害はないが、`service_psg_ticks()` の tick clamp（`VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME` / `VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM`）や `psg_apply_step_span()` の cursor 前進ロジックにより、**ある step の entry 群がハードウェアに一度も書かれないまま次の step へ進む**経路が存在する。entry が書かれなければ、その step で本来鳴るべき note-on/note-off/音量変化/period 変化はハードウェアに反映されない。ハードウェアは「最後に書かれた値」を保持し続けるため、飛ばされた変化は**その後何を演奏してもレジスタに現れず、消音漏れ・音程残留として蓄積する**。

**(2) BIOS 呼び出し後の再同期手段がない**

System Card の CD/ADPCM BIOS helper（`pce_cdb_cd_read` / `pce_cdb_adpcm_*` / `pce_cdb_cdda_*`。再設計前は `#define pce_cdb_*(...) vn_cdb_*_guarded(...)` マクロで TIMER 実験時だけ release-first ラッパへ横取りされる）は、PSG レジスタの SELECT ラッチや、System Card 自身の TIMER/IRQ 関連レジスタを触ることがある。しかし PSG 側には**ハードウェアの現在値を読み戻す手段も、ソフトウェア shadow と突き合わせて差分修復する手段もない**。BIOS helper が PSG SELECT latch を書き替えた場合、次に `psg_apply_step_entry()` が実行するまでその汚染は残る。

**(3) タイミングが二重系統のパッチワークになっている**

再設計前は実フレーム credit (`vn_vblank_credit`、`vn_record_vblank_frames()` で加算、`vn_consume_vblank_credit()` で消費) と、PSG 専用の合成 credit (`vn_psg_synthetic_credit`、`VN_ADD_ESTIMATED_FRAME()` で加算、`vn_consume_psg_synthetic_credit()` で消費) の**2系統**が並存していた。サービス入口も `service_psg_ticks()` / `service_psg_compensation_ticks()` / `service_psg_during_blocking_work()` / `service_psg_during_blocking_frames()` / `service_psg_during_visual_cache_work()` / `service_psg_during_visual_cache_frames()` の**5系統6関数**が重複して存在し、それぞれ微妙に異なる credit 消費・clamp ロジックを持っていた。BIOS ブロック中は `cd_transfer_wait()` が `VN_CD_CHUNK_ESTIMATED_FRAMES` による**推測**でしか経過フレームを補えない。二重系統であること自体が「どの credit がどのサブシステムを進めているか」の見通しを悪くしている。

**(4) 横断的不変条件が呼び出し規律頼みである**

MPR slot4（bank129/130/133/121 の時分割）・slot6（bank132/134/135 の時分割）の save/restore、IRQ guard の順序、TIMER own/release の順序（release = TIQ mask → timer 停止 → `$20F5` bit clear の順序厳守）は、コメントと呼び出し規律だけで約20箇所に分散して守られている。`service_psg_ticks()` の実装コメントが明示する通り、過去に「呼び出し元が bank133 overlay である場合を考慮せず bank130 へ無条件復帰した結果、overlay からの RTS が bank130 のバイト列を実行し I/O ページへ暴走した」という実バグが発生している（`slot4_bank = vn_slot4_current_bank(); ... vn_slot4_map_bank(slot4_bank);` という現在の保存/復元パターンはこの修正の産物）。この種の不変条件がモジュール横断で規律頼みになっている限り、新しい呼び出し経路を追加するたびに同種の事故が再発しうる。

## 2. 設計原則

新設計は以下の4原則に基づく。

1. **State-driven（状態駆動）**: PSG は「今この瞬間にどう鳴っているべきか」を表す論理状態を唯一の真実とし、ハードウェアへの書き込みはこの論理状態からの差分同期（commit）としてのみ発生する。edge（entry を見つけた瞬間にハードウェアへ書く）を廃止する。tick が遅延・バッチ化されても論理状態は失われないため、乖離が構造的に起こり得ない。
2. **単一 credit**: テンポを進める「時間」の出所を一本化する。実フレーム経過と PSG 専用推定の二重帳簿をやめ、TIMER IRQ による実測 credit を唯一のソースにする。BIOS ブロック窓も推測ではなく VBlank エッジの実測で埋める。
3. **単一チョークポイント**: BIOS 呼び出し・MPR remap・IRQ mask に触れるコードパスを1モジュール（`engine_bus`）に集約する。他のモジュールは一切これらに直接触れない。呼び出し規律ではなく静的な構造（テストの grep pin）で違反を検出できるようにする。
4. **呼び出し規律の構造化**: 「BIOS 呼び出し後は必ず PSG を dirty にする」「own は特定の2箇所からしか呼ばない」といった不変条件を、コメントではなく関数の契約とシグネチャ、および呼び出しグラフの形で強制する。

## 3. モジュール構成

### 3.1 ビルド構造の制約（変更不可）

以下は実ソース・ビルドコードで確認済みの制約であり、新設計はこれを前提とする。

- `data/projects/<name>/src/main.c` は `#include "pce_vn_runtime.c"` の1行のみでなければならない。`pce-build-system.js` の `isThinVisualNovelMain(source)`（567行付近）が `String(source).trim() === '#include "pce_vn_runtime.c"'` を厳密比較しており、これに一致しない場合 HuCard スライドショー用の `repairHuCardSlideshowMainIfNeeded()` が別テンプレートで上書きする分岐に入る。**`main.c` の内容と、umbrella ファイル名 `pce_vn_runtime.c` は変更不可。**
- `collectSourceFiles(projectDir, config)`（`pce-build-system.js` 583行付近）は VN プロジェクトの場合 `src/main.c` + `src/generated/assets.c` + `src/generated/vn.c` の3ファイルのみをコンパイル対象にする（unity build）。モジュールファイルを増やしても `collectSourceFiles` 自体は無変更で成立させる必要がある。
- したがって、モジュール分割は「`pce_vn_runtime.c` を umbrella ファイルとして、実体は別ファイルへ分割したうえで `#include` する」方式で実現する。これにより `collectSourceFiles` は無変更のまま、static リンケージ・インライン化（bank 使用率99%対策で必須）も維持できる。

### 3.2 ファイル構成

全ファイルは `template/template_pce_vn_cd/src/` 配下に置く。

| ファイル | 責務 | bank 配置 |
|---|---|---|
| `main.c` | `#include "pce_vn_runtime.c"`（**不変**） | — |
| `pce_vn_runtime.c` | umbrella: `vn_engine_config.h` → state → `vn_engine_time.c` → `vn_engine_bus.c` → `vn_psg_core.c` → `vn_adpcm_core.c` → `vn_cache_core.c` → `vn_msg_core.c` → 各 `vn_port_*.c` → `vn_main.c` の順に `#include` | — |
| `vn_engine_config.h` | プリプロセッサ定義、section マクロ（`VN_BANKED_CODE` 等)、PSG MMIO アドレス定義 | — |
| `vn_engine_time.c` / `.h` | 単一 credit カウンタ、TIQ ISR、own/release、BIOS ブロック窓の実測 poll | bank129 + resident（ISR は現行どおり `VN_BANKED_CODE`。bank129 は MPR3 co-resident で常時マップのため IRQ 配送時も安全） |
| `vn_engine_bus.c` / `.h` | MPR slot4/slot6 の push/pop、IRQ guard、overlay dispatch、BIOS bracket | bank129 |
| `vn_psg_core.c` / `.h` | state-driven シーケンサ: `psg_advance`（overlay）+ `psg_commit`（bank129）+ shadow | 混在（advance は overlay、commit は resident 寄り） |
| `vn_adpcm_core.c` / `.h` | buffered ADPCM の load/play/stop/service（bus 経由に移植） | bank130 / bank129 |
| `vn_cache_core.c` / `.h` | `load_runtime_cache` dispatch + CD chunk protocol | bank130 |
| `vn_msg_core.c` / `.h` | typewriter service（credit 消費化） | bank130 + overlay |
| `vn_port_video.c` / `vn_port_scene.c` / `vn_port_sprite.c` / `vn_port_cdda.c` | スコープ外サブシステム（VDC/scene pack/sprite/CD-DA）の移植。挙動不変 | 現状同等のバンク配置を維持 |
| `vn_main.c` | `main()` + `engine_frame_end()` | 現状同等 |

分割は「挙動を変えない transplant」（Phase A、後述）としてまず行い、その後の Phase で各モジュールの中身を新設計へ置き換える。

### 3.3 同期・ハッシュ機構への影響

- `syncVisualNovelRuntime(projectDir, logger)`（`pce-vn-manager.js:3875`）は現在 `['main.c', ...], ['pce_vn_runtime.c', ...]` の**2ファイル固定リスト**をテンプレートからコピーする。モジュール分割後はこのリストを module ファイル群の列挙（またはディレクトリ内 `.c`/`.h` の走査）へ拡張する必要がある。
- `vnBuildSignature()`（`pce-vn-manager.js:374`）は `generator.runtime = readTextHash(path.join(templateDir, 'pce_vn_runtime.c'))` として **umbrella ファイル1つだけをハッシュ**している。モジュール分割後、umbrella の中身（`#include` 行のリスト）は変わらないファイルサイズになりうるが、include される実体ファイルの変更を検知できない。**全 module ファイルをハッシュ対象に含めるよう拡張が必要**（この関数名は設計書上「build-meta hash」と呼んでいるが、実体は `vnBuildSignature()` である。実装時にこの対応関係を確認すること）。
- `collectSourceFiles`（`pce-build-system.js:583`）は前述の通り無変更で成立する。

## 4. psg_core 設計

### 4.1 データ構造

```c
/* Logical state: what the song *should* be doing right now, independent of
   whether the hardware has caught up. Always-mapped console RAM (not bank132
   tail, not bank134/135) because commit() must be callable while MPR6 is
   mapped to the PSG pattern bank. */
typedef struct {
    uint16_t period;   /* 12-bit tone period, or noise period in low bits */
    uint8_t  volume;   /* 0 = silent, 0x80 | (0..0x1f) = ON + level */
    uint8_t  noise;    /* 1 = channel 4/5 in noise mode */
} vn_psg_channel_state_t;

static vn_psg_channel_state_t psg_logical[6];   /* ~ intent */
static vn_psg_channel_state_t psg_shadow[6];    /* ~ last known HW value */
static uint8_t psg_shadow_valid;                 /* bitmask: 1 = shadow trustworthy */
```

`psg_logical[6]` + `psg_shadow[6]` + `psg_shadow_valid` で合計約80バイト。**常時マップされる console RAM に置くこと**（bank132_tail 等の time-shared 領域は不可。`psg_commit()` は bank134/135 が MPR6 にマップされている最中にも呼ばれうるため）。

### 4.2 API スケッチ

```c
/* Advance the logical sequencer state by n ticks. Reads the pattern (bank134/
   135 via MPR6, or resident .rodata) but touches NO PSG MMIO. Safe to call
   from the overlay; safe to call from any blocking context because it never
   maps MPR4/slot4 for hardware access. */
void psg_advance(uint8_t n);

/* Diff psg_logical vs psg_shadow per channel (only channels in psg_used_mask
   or psg_shadow_valid-cleared), write only the registers that changed, then
   update psg_shadow / psg_shadow_valid. No pattern-bank access required, so
   this may be called from any context, including immediately after a BIOS
   helper returns. */
void psg_commit(void);

/* Mark the shadow untrustworthy. Called by engine_bus after EVERY BIOS
   helper returns (bus_cd_end() etc.), because the BIOS may have touched the
   PSG SELECT latch or other shared state. The next psg_commit() then does a
   full resync (every channel in psg_used_mask, ~36 MMIO writes worst case)
   instead of a diff. */
void psg_mark_hw_dirty(void);
```

### 4.3 設計上の要点

- `psg_advance(n)` はパターンエントリを**論理状態にのみ**適用する。accumulator + 単調 cursor（現行の `psg_step_accum` / `psg_pattern_cursor` に相当）を使い、複数 tick 分をまとめて進めても中間の note-off が失われない — 論理状態は「最後に適用された値」を保持するので、途中の中間状態を再現する必要がない。
- ループ wrap（`psg_step >= psg_current->steps` で `psg_is_song` なら `psg_step = 0`）では **cursor/step だけをリセットし、論理状態は持ち越す**。これは現行 `stop_psg()` を経由しないループ再開時の実ハードウェア挙動（音が瞬断しない）と一致させるための意図的な設計であり、「ループ境界で全チャンネルを無音にリセットする」実装に戻さないこと。
- `psg_commit()` は使用中チャンネル（`psg_used_mask` 相当）ごとに論理値と shadow を比較し、変化したレジスタのみ SELECT → データの順で書く。**pattern バンク（bank134/135）へのアクセスを一切必要としない**ため、DMA 中の MPR6 remap 禁止という制約下でも安全に呼べる — これは現行の `service_psg_ticks()` が抱える「呼び出し元の slot4/slot6 状態を意識しないと壊れる」という問題を構造的に解消する。full resync（`psg_mark_hw_dirty()` 後）でも高々 ~36 MMIO write（6ch × 6 register 相当）に収まる。
- `psg_mark_hw_dirty()` は**全 BIOS 呼び出し後に `engine_bus` が必ず呼ぶ**（`bus_cd_end()` の最終ステップ、後述）。これにより次の `psg_commit()` が全チャンネルを再同期し、BIOS が latch を汚染していた場合でも1フレーム以内に修復される。note-off も論理状態に存在し続けるため、tick がどれだけ遅延・バッチ化されても失われない。
- 現行の tick clamp 定数 `VN_PSG_MAX_TICKS_PER_FRAME_DURING_ADPCM` / `VN_PSG_MAX_CATCHUP_TICKS_PER_FRAME` は**廃止**する。新設計では credit の上限（`VN_VBLANK_CREDIT_MAX` 相当、1フレームあたり4、最大8）が唯一の上限となり、これは「正しさ」ではなく「遅延の上限」としてのみ機能する（advance が論理状態にしか触れないため、catch-up burst で音が飛ぶ・和音を取りこぼす、という現行のF2相当の問題が構造的に起きない）。
- 波形 RAM（PSG wave RAM、`psg_load_basic_wave()` が書く領域）は**再生中に書き換え不可**という前提のため resync 対象外とする。BIOS が波形 RAM を破壊する証拠は現時点でない。これは **open question** として第9章に記録する。

## 5. engine_time 設計

### 5.1 credit ソースの一本化

新設計は credit ソースを2つに整理する。

1. **runtime が timer を own している間**: TIQ ISR（naked asm）が唯一の credit 源。契約は現行の `vn_psg_timer_irq_handler` を維持する: A/X/Y と MPR0（`tma #$01` で保存。`tma`/`tam` のオペランドはビットマスクで `#$01` = MPR0）を退避し、MPR0 を `$ff` I/O page にしてから `$1403` へ ack、`vn_vblank_credit` を `VN_VBLANK_CREDIT_MAX` で clamp して inc、MPR0 復元、RTI。**PSG レジスタ・MPR2-7・VDC・BIOS 呼び出し・C 関数呼び出しは ISR 内で一切禁止**（前回の IRQ 駆動 PSG 実装がスプライト/BG破壊で撤回された経緯を踏まえた制約。この契約が守れない設計に傾いた場合は Stop And Ask）。
2. **BIOS ブロック窓内**: `time_blocked_poll()` が settle busy-wait 中（現行 `cd_transfer_wait()` 相当の待ち）に `IO_VDC_STATUS` の VBlank ビットの 0→1 エッジを数え、経過フレームとして credit へ加算する。実機/エミュレーター検証では BIOS helper 自体の中で進む時間がこの sampler から見えないため、`VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES` の小さい PSG 専用補償を併用する。この補償は ADPCM/message timing へ混ぜない。

### 5.2 廃止するもの

- `vn_psg_synthetic_credit` / `VN_CD_CHUNK_ESTIMATED_FRAMES` は全廃する。`VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES` だけは BIOS helper 内で観測できない時間への PSG 専用補償として残し、`vn_vblank_credit` へ混ぜない。
- `service_psg_ticks` / `service_psg_compensation_ticks` / `service_psg_during_blocking_work` / `service_psg_during_blocking_frames` / `service_psg_during_visual_cache_work` / `service_psg_during_visual_cache_frames` の**5系統6関数**は、`engine_service()`（通常フレーム経路）と `engine_service_blocking()`（BIOS/CD ブロック経路）の**2本に集約**する。
- 実測 credit は実時間そのものなので、ADPCM 停止カウントダウン・message pacing（typewriter）も同じ credit で駆動してよい。「real credit」と「synthetic credit」という分離自体が設計から消える。

```c
/* Normal per-frame heartbeat. Called once per main-loop iteration after
   vn_wait_next_vblank(). Consumes real credit, advances psg_core / adpcm /
   message pacing by the same amount. */
void engine_service(void);

/* Called from inside blocking CD/ADPCM/BG work (the old cd_transfer_wait()
   call sites). Polls time_blocked_poll() for the elapsed span, then behaves
   like engine_service() with that measured frame count. */
void engine_service_blocking(void);
```

### 5.3 own/release プロトコル

既存の lab 実装（`vn_psg_timer_own()` / `vn_psg_timer_release()`）の契約をそのまま維持する。

- release は **TIQ mask → timer 停止 → `$20F5` bit clear** の順序を厳守する（逆順は「bit clear なのに TIQ 配送可能」な窓を作り、System Card のデフォルトパスが ack しないためハングする — 現行コードのコメントで明示済みの既知ハマり）。
- own はリロード再書き込みを `vn_timer_owned` フラグでゲートする（毎フレームの無条件リロードはカウンタ位相をリセットし TIQ を永久に飢えさせる）。
- **own を呼んでよいのは `bus_bios_close()`（BIOS helper 完了後）と `engine_frame_end()`（通常フレーム終端）の2箇所のみ**という制約を構造化する。現行は `quiet_cd_unit_irqs()` という汎用名の関数がこの役割を兼ねているため、呼び出し側の意図が読み取りにくい。新設計では「own を呼べるのはこの2関数だけ」という制約をコードの構造（`engine_time.h` が `vn_psg_timer_own` を non-static にせず、`engine_bus.c` からのみ呼べるようにする等）で表現する。
- CD シーケンス途中（`cd_transfer_wait()` 相当の1セクタ待ち）では own しない。この待ちの中では `time_blocked_poll()` の実測 credit のみを積む。

### 5.4 不変とするもの

- `vn_wait_next_vblank()` の asm 実装と映像同期セマンティクスは**不変**。映像同期（VBlank に表示更新を寄せる）とテンポ源は別の関心事であり、混同しない。
- fallback として `VN_TIME_SOURCE_TIMER=0` を用意し、TIQ ゲートが成立しない場合に全 credit ソースを VBlank エッジサンプラ（現行の協調ポーリング相当）へ切り替えられる抽象を残す。これは「TIMER 一次昇格が Gate で不成立だった場合の脱出口」であり、実装の第一候補ではない。

## 6. engine_bus 設計

### 6.1 唯一のチョークポイント

`pce_cdb_*` BIOS 呼び出し、MPR remap（`pce_ram_bank1NN_map()` 系）、`$20F2`/`$20F5` の直接操作、IRQ guard（`vn_vdc_irq_lock`/`unlock` 相当）に触れるのは **`engine_bus` モジュールだけ**とする。他モジュールはこれらのプリミティブへ直接触れず、必ず `engine_bus` の API 経由にする。

- 既存の `#define pce_cdb_* → vn_cdb_*_guarded` マクロ横取り機構は `engine_bus` 内に維持する。
- `bus_slot4_push(bank)` / `bus_slot4_pop(prev)`、`bus_slot6_push(bank)` / `bus_slot6_pop(prev)`: 現行 `service_psg_ticks()` が個別に実装している「呼び出し元の bank を保存し復元する」パターン（過去の overlay RTS 暴走バグの修正イディオム）を、**全クロススロット呼び出しで共通の API として構造化**する。

```c
uint8_t bus_slot4_push(uint8_t bank); /* returns previous bank */
void    bus_slot4_pop(uint8_t prev_bank);
uint8_t bus_slot6_push(uint8_t bank);
void    bus_slot6_pop(uint8_t prev_bank);
```

### 6.2 ブロッキング CD プロトコル

```c
void bus_cd_begin(void);                 /* CDDA pause + external IRQ open + time_bios_begin */
uint8_t bus_cd_read_chunk(/* sector, dest, length, ... */);
void bus_cd_settle(void);                /* settle wait + blocked-poll + engine_service_blocking */
void bus_cd_end(void);                   /* quiet/sync + time_bios_end + psg_mark_hw_dirty + CDDA resume */
```

- `bus_cd_begin()` → チャンクごとに `bus_cd_read_chunk()` → `bus_cd_settle()` → `bus_cd_end()` の形にまとめる。
- **`bus_cd_end()` の最終ステップとして `psg_mark_hw_dirty()` を呼ぶことを必須とする**。これにより「BIOS 呼び出し後に PSG が汚染されているかもしれない」という懸念を、呼び出し規律ではなく `bus_cd_end()` という単一関数の契約として保証する。
- ADPCM primitive（load/play/stop）も同形のブラケット（`bus_adpcm_begin/read_chunk/settle/end`）で統一する。

### 6.3 新しい test pin

`engine_bus` 以外のモジュールで以下のトークンを grep して検出されないことをテストで固定する。

- `pce_cdb_` （BIOS 直接呼び出し）
- `pce_ram_bank1` （MPR remap の直接呼び出し。`bank128`〜`bank135` すべて含む）
- `vn_vdc_irq_` （IRQ guard の直接呼び出し）

これは設計当時の `tests/pce-vn-manager.test.js` が個別関数のソース断片を正規表現で固定する方式（例: `VN_PSG_TIMER_IRQ_DRIVER 0` の pin）に加えて、**構造的な違反検出**を追加するものである。

## 7. 3シナリオの制御フロー

新設計における代表的な3シナリオの制御フローを示す。

### A. idle（PSG BGM のみ、message 表示中でメッセージ送りが主体）

```
engine_frame_end()
  -> engine_service()
       -> credit を消費
       -> psg_advance(credit分)         # 論理状態のみ更新
       -> psg_commit()                  # 変化レジスタのみ書く。無変化なら overlay dispatch すら発生しない
```

変化がない場合、`psg_commit()` は diff の結果が空なので overlay（bank133）を呼ぶ必要すらない。現行の「毎 tick 必ず `vn_overlay_dispatch_locked()` を通る」経路より軽量になる。

### B. PSG BGM 中に ADPCM 開始（voice ロード + 再生）

```
bus_cd_begin()                          # CDDA pause, external IRQ open
  chunk 1: bus_cd_read_chunk() -> bus_cd_settle()   # settle 中は time_blocked_poll() が実測 credit
  chunk 2: bus_cd_read_chunk() -> bus_cd_settle()
  ...
bus_cd_end()                            # quiet/sync, psg_mark_hw_dirty(), CDDA resume
engine_service()  (次フレーム以降)
  -> psg_advance(実測credit分)          # ロード中に遅延した分をまとめて進める（無損失）
  -> psg_commit()                       # dirty につき全チャンネル resync。BIOS の latch 汚染を修復
```

voice の発音長は実測 credit 駆動になるため、load のブロック時間そのものに依存しない。

### C. PSG BGM 中にキャッシュロード（DMA を伴う BG/sprite 転送）

```
DMA 開始
  psg_advance() を延期            # 論理状態なので遅延しても無損失
  bus_cd_settle() のループ中に time_blocked_poll() が credit を積む
DMA/settle 完了
  psg_advance(蓄積credit分)       # 一括 fast-forward（note-off を含む正味差分が反映される）
  psg_commit()                    # 単一 commit
```

## 8. バンク・RAM 予算

- 現状 bank128 は 99.0% 埋まっている（Kitahe CD build 実測）。**resident（bank128）への追加はゼロ方針**とする。`psg_commit()` / `engine_time` 関連のコードは bank129 側に配置する。
- 削減見込み: サービス関数 5系統6→2本（約400B）、synthetic credit 機構の全廃（約150B）、呼び出し側の guard boilerplate 削減（約300〜600B）。
- 増加見込み: `psg_commit()` の diff ロジック（約300B）、`engine_time` 関連（約150B）、`engine_bus` helper（約100B）。
- 正味でフラット〜微減を見込むが、各 Phase の末尾で必ず `mos-pce-cd-clang -Wl,--print-memory-usage` を実行し diff を確認する。**bank使用率が 99.2% を超えた時点でその Phase をブロックする**（機能を諦めるのではなく `VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替え、または bank133 overlay への追加退避で均す）。
- RAM 増加分（`psg_logical[6]` + `psg_shadow[6]` + `psg_shadow_valid` で約80B）は console_ram の空き領域に置く。console_ram の上限（`< 0x19B7`）に対する空き容量を、実装前に `--print-memory-usage` または map ファイルで確認すること。

## 9. リスクと open questions

1. **G-B1（TIQ during BIOS の配送有無）**: 「`$20F5` の TIMER dispatch bit を clear しないと CD_READ がハングする」という既知事実（現行 `vn_psg_timer_release()` のコメントに明記）から、「BIOS 実行中は TIQ が配送されない」ことを前提として `time_blocked_poll()` の実測で補う設計にしている。この前提は Phase B の Gate で実証する。もし不成立パターンが見つかった場合、セクタ数からの実測ベース推定（1倍速の既知転送レートを用いる）を該当ブロック窓のみに限定して使用するフォールバックを許容する。
2. **bank128 が 99.0% で余裕がない**: 8章に記載の通り、resident への追加ゼロ方針を維持し、各 Phase 末で `--print-memory-usage` diff を確認する。>99.2% でブロック。
3. **RAM 予算 +約80B**: console_ram の空き（上限 `< 0x19B7`）を実装前に map で確認する。
4. **TIMER 60.0Hz vs VBlank 59.94Hz のドリフト**: 約1 credit / 16秒のドリフトが発生するが、credit の上限（cap）で有界化される。テンポ精度に対しては reload 量子化誤差（約±0.43%）の方が支配的であり、全体として ±1% の Gate 基準内に収まる見込み。
5. **テスト書き換え規模**: 設計当時の `tests/pce-vn-manager.test.js` には `VN_PSG_TIMER_IRQ_DRIVER 0` の pin（1647行付近）、`vn_psg_timer_own`/`vn_psg_timer_release` の実装断片 pin（1652-1653行付近）、`VN_CDB_IRQ_MASK_RUNTIME_QUIET` / `quiet_cd_unit_irqs` / `vn_cd_irq1_quiet_handler` の実装断片 pin（2424-2429行付近）など、約150箇所規模の正規表現 pin が存在した。Phase A ではパスの付け替えのみ、Phase B/C/E では契約 pin を新設計版へ全面的に書き換える。
6. **不変条件**: `main.c` の内容（`#include "pce_vn_runtime.c"` の1行）と umbrella ファイル名 `pce_vn_runtime.c` は、`pce-build-system.js` の `isThinVisualNovelMain()` と `collectSourceFiles()`、および対応するテストが byte 単位で固定しているため**変更不可**。

波形 RAM の resync 除外（4.3節）も open question として扱う。BIOS が波形 RAM を書き換える証拠が今後の検証で見つかった場合、`psg_mark_hw_dirty()` に波形 RAM の再アップロードを含める設計変更が必要になる。

## 10. ビルド・同期・テストへの影響

- `pce-build-system.js` の `collectSourceFiles` / `isThinVisualNovelMain` は**無変更**で成立する（3.1節）。
- `pce-vn-manager.js` の `syncVisualNovelRuntime`（3875行付近）は、現在 `main.c` / `pce_vn_runtime.c` の2ファイル固定リストになっているものを、module ファイル群の列挙へ拡張する（3.3節）。
- `pce-vn-manager.js` の `vnBuildSignature()`（374行付近、設計書内では通称「build-meta hash」）が現在 umbrella ファイル1つだけをハッシュしている点も、全 module ファイルを対象に含めるよう拡張する。
- `tests/pce-vn-manager.test.js` の pin は Phase A でパスのみ付け替え、Phase B 以降で契約 pin を新設計版へ書き換える（9章5項）。

## 11. 実装フェーズ概要

詳細な手順・Gate・Stop And Ask 条件は `refactor-instructions-engine-core.md` を参照すること。ここでは各 Phase の要約のみ示す。

- **Phase A — モジュール分割（挙動不変の transplant）**: 単一ファイルを3.2節のファイル群へ分割する。ロジックは変更しない。
- **Phase B — engine_time + engine_bus、TIMER 一次昇格**: PSG は edge-driven のまま、テンポ源だけを TIMER 一次へ差し替える（変更の分離）。Gate G-B1（BIOS 中の TIQ 配送実証）が最重要。
- **Phase C — psg_core を state-driven へ書き直す**: 4章の `psg_advance` / `psg_commit` / `psg_mark_hw_dirty` を実装し、edge-driven ドライバを置き換える。
- **Phase D — adpcm_core + cache_core を engine_bus へ載せ替える**: ADPCM の load/play/stop、cache load の CD chunk 処理を `bus_cd_*` / `bus_adpcm_*` プロトコルへ移行する。
- **Phase E — msg_core の credit 化 + 死コード削除 + ドキュメント/テスト最終化**: typewriter を credit 消費方式にし、旧5系統サービス関数等の死コードを除去し、ドキュメント・テストを最終形にする。

各 Phase はビルド可能・Geargrafx 検証可能・1コミットでの revert 境界を維持することを前提とする。

## 12. 実装結果（as-built、2026-07-05 時点）

本設計の実装は以下の状態で完了した。コミットは `codex/psg` ブランチ（Phase A = `4fa52c6`、Phase B+C = `bdad97b`）。

### 完了状況
- **Phase A（モジュール分割）**: 完了。umbrella `#include` 方式で 13 module へ分割。関数欠落・重複ゼロを機械照合、bank 使用量ベースライン同等を確認。
- **Phase B（TIMER credit 一次昇格）**: 完了。`VN_TIME_SOURCE_TIMER`（既定1）へ。service 2本化、blocked-poll 実測。CD/ADPCM BIOS helper 内で観測できない時間だけ `VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES` の PSG 専用補償を残す。
- **Phase C（state-driven PSG）**: 完了。`psg_logical`/`psg_dirty_mask`/`psg_advance`/`psg_commit`/`psg_mark_hw_dirty`。**これが「再生中の cache load / ADPCM start による PSG 論理状態と HW レジスタの乖離」という本再設計の主目的を解決する**。Gate C 実機合格（logical が実 note を時系列変化、note-off 機能、cache load 跨ぎで乖離なし）。
- **Phase D（bus_cd_* 集約）**: **構造的集約は見送り（deferred）**。理由は §12「Phase D 見送り」参照。機能要件は Phase B/C で達成済み。
- **Phase E（最終化）**: msg_core credit 化と死コード削除は見送り（下記）、本節と関連 docs の as-built 更新のみ実施。

### RAM 予算の壁（重要・恒久制約）
実装完了時点で **console_ram 7469〜7470 / 7472B（残 2〜3B）**、bank128/129/130 は **99.4〜99.8%**。§8/§9 が予見したとおり RAM/コードは限界に達した。この結果:
- **新規の常駐コード・RAM をほぼ一切足せない**。Phase D の構造的集約（`bus_cd_read_ref_to_vram` への font upload 統合）は、struct 値渡しにより 6502 コードが純増して bank130 を 59B 溢れさせたため revert した。ソース行数が減っても実バイナリが増えるケースに注意。
- **死コード削除で bank は空かない**: LTO（`-mlto`）が未参照 static を既にストリップ済みで、bank 使用は全て live コード。よって Phase E の「死コード削除」は無益。
- **msg_core の credit 化は見送り**: メッセージ表示は実機で正常動作しており、`textSpeedFrames` は凍結仕様。credit 化はコード増（RAM 壁に抵触）とテキスト速度回帰のリスクを負う一方、体感上の利益が無いため実施しない。message pacing は現行の main-loop 駆動を維持する。

### zp / MPR0 ポインタの罠（Phase C で発覚・最重要の実装知見）
この runtime は **MPR0 = I/O（$FF）を常時維持**するため、llvm-mos のゼロページはハードウェア page 0 に無い。**address を取られる／far deref されるグローバルが `.zp`（`-mlto-zp=188` の自動割り当て）に入ると、`&obj` が page-0 相対（高位バイト 0x00、例 `0x00A0`）になり、実体（`0x20A0`）に届かず壊れる**。Phase C で `psg_logical` を追加した際に `g_psg_cache`（アドレスが `psg_current` に入る）と `psg_logical`（`&psg_logical[ch]` を commit が取る）が zp に押し込まれ、**ビルド・テストは通るのに実機で PSG が完全無音化**した。対策は既存コード（`active_message_state` / `loaded_sprite_pattern_*` 等）と同じ `__attribute__((section(".bss")))` による zp からの追い出し。ポインタ「値」を持つだけ・null チェックのみの参照先・名前アクセスのみのグローバルは zp のままでよい（過剰 pin は console_ram を溢れさせる）。**新規グローバル追加時は `llvm-readelf -S` で `.zp.bss` に入っていないか必ず確認すること。**

### Phase D 見送りの根拠
設計 §6.2 の `bus_cd_begin/read_chunk/settle/end` 名前付きプロトコルは、**単一チョークポイントの機能的実体が既に存在する**ため構造的集約の価値が低い: (1) 全 `pce_cdb_*` は guarded wrapper マクロで横取り済み、(2) BIOS 完了共通点 `sync_cd_external_irq_after_bios_call()` が `psg_mark_hw_dirty()` を必ず呼ぶ（Phase C）、(3) ADPCM 残フレームは Phase B の統一 credit 駆動。名前付き wrapper の追加は cosmetic であり、RAM 壁（bank 99%+）では実装できない。将来 runtime コードを削減して余地ができた場合に再検討可。

### 未完了の検証
- Phase D の ADPCM voice 発音長 ±4 frame の精密計測は、テストプロジェクト `ishi_no_ura` の scene 遷移操作が難しく、クリーンな長尺 voice countdown の測定には至っていない。ただし ADPCM voice の再生自体（`adpcm_play_active`=1、`adpcm_play_frames_remaining` の減算、PSG BGM との同時再生、破壊なし）は実機確認済み。CD-DA pause/resume は本再設計でコード変更しておらず（設計スコープ外）、個別再検証はしていない。
