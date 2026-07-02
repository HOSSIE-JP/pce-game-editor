# refactor-instructions-psg-adpcm.md — PSG(SONG) × ADPCM 同時再生の安定化

このファイルは実装担当モデル（Codex / Opus 等）向けの作業指示書である。
作業前に必ず `CLAUDE.md` / `AGENTS.md` を読み、本書と矛盾する場合は人間の指示 > `CLAUDE.md`/`AGENTS.md` > 本書 の順で優先すること。
既存の `refactor-instructions.md`（MD レガシー除去）とは**別件**であり、本書のスコープは VN runtime の音声タイミングに限定する。

---

## 1. Objective

CD-ROM2 VN runtime（`template/template_pce_vn_cd/src/pce_vn_runtime.c`）で、**PSG(SONG) 再生中に ADPCM 再生・CD ロードが走っても、PSG がスローダウン / ぶつ切れ / テンポ急変せず連続再生されること**。あわせて ADPCM 音声が本来の長さより早く切れる問題を解消する。

目的ではないこと: PSG ドライバの全面書き換え、見た目の綺麗さ、エミュレータのエラーログをゼロにすること自体（原因が game 側と確認できたものだけ直す）。

## 2. 背景知識（PCE CD-ROM2 の音声再生の仕組み）

実装前に以下のハードウェア事実を前提として共有する。

- **PSG** は HuC6280 内蔵の 6ch 波形音源で、シーケンサを持たない。曲のテンポは CPU が一定周期でレジスタを書くことでのみ成立する。市販 CD-ROM2 ゲームおよび System Card BIOS 内蔵の PSG ドライバは、**HuC6280 TIMER IRQ（または VBlank IRQ）駆動**が標準で、CD シーク/リード中も IRQ で曲が進む。
- **ADPCM** は CD ユニット側（OKI MSM5205 系 + 64KB ADPCM RAM）で、いったん再生を開始すれば **CPU の介在なしに自走する**。つまり PSG と ADPCM の同時再生自体はハードウェア的に何の競合もない。
- **CD-DA** はドライブが直接再生するため、CD データリードとは同時実行できない（現行 runtime の pause/resume 対応は正しい。変更しない）。
- 本 runtime は方針として **System Card の VBlank handler / HuC6280 IRQ を使わず**、VDC status（`IO_VDC_STATUS` の VBlank flag、read-clear）を直接ポーリングする協調（cooperative）方式で PSG を進めている（`docs/pce-memory-bank-strategy.md`「PSG 補償 tick 調整 TIPS」: 「HuC6280 timer IRQ では駆動しません」）。**今回の症状の根本原因はこの協調方式が「CPU が数フレーム以上ブロックする区間」を原理的にカバーできないこと**である。

## 3. Project Understanding（対象と反映経路）

- 対象 runtime: `template/template_pce_vn_cd/src/pce_vn_runtime.c`（約 6,500 行）。プロジェクト側 `data/projects/<name>/src/pce_vn_runtime.c` は `pce-vn-manager.js:3802` がテンプレートから同期するため、**テンプレートだけを編集すればビルド時に反映される**。
- 回帰テスト: `tests/pce-vn-manager.test.js` が runtime のソースを**正規表現レベルで固定**している。挙動を変える場合は該当 assert を同時更新する（後述）。実行は `npm test`（または `node --test tests/pce-vn-manager.test.js`）。
- 検証エミュレータ: Geargrafx（MCP あり。`geargrafx-debugging` スキル参照）を一次、EmulatorJS/WASM を二次とする（`CLAUDE.md` Test Play 節）。
- 再現プロジェクト: `data/projects/ishi_no_ura`（PSG SONG 再生中に voiced message で ADPCM 再生）。

### 現行 PSG ドライバの構造（読み替え用の地図）

| 要素 | 場所（行番号は現 HEAD 1a97678 時点） |
|---|---|
| シーケンサ状態・定数 (`VN_PSG_STEP_ACCUM_UNIT 3600` / `VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES 24`) | `pce_vn_runtime.c:150-152, 356-379` |
| 1 tick 進める `tick_psg()`（1 サービス = 1/60 秒ぶんの accumulator 加算） | `pce_vn_runtime.c:4528` |
| tick 実行 + MPR6 復帰 `service_psg_ticks()` | `pce_vn_runtime.c:4556` |
| VBlank flag のエッジ検出 `psg_vblank_elapsed()` / `psg_mark_frame_serviced()` | `pce_vn_runtime.c:4578, 4596` |
| ADPCM フレームカウンタ減算 `service_adpcm_during_blocking_frames()` | `pce_vn_runtime.c:4603` |
| ブロッキング作業中のサービス入口 `service_psg_during_blocking_work/frames()` | `pce_vn_runtime.c:4621, 4633` |
| CD 転送 settle 待ち + 補償 tick `cd_transfer_wait()` | `pce_vn_runtime.c:1203-1228` |
| ADPCM voice の CD ロード（ブロッキング BIOS 呼び出し） | `pce_vn_runtime.c:3914-4015`（BIOS 呼び出しは 3959-4008） |
| ADPCM 再生の残フレーム減算・自然終了 `service_adpcm_playback()` | `pce_vn_runtime.c:4214` |
| 通常フレームの心拍 `delay_frame()` / `vn_wait_next_vblank()` | `pce_vn_runtime.c:750, 711` |
| メインループ（1 周 = 1 frame、末尾で delay_frame） | `pce_vn_runtime.c:6419-6506` |
| voiced message 開始（glyph 先読み → `play_adpcm_voice`） | `pce_vn_runtime.c:5448-5511` |

テンポの実体: `tick_psg()` は「サービス関数が呼ばれた回数」を 1/60 秒とみなして accumulator（`bpm*4` / 3600 単位）を進める。**壁時計は存在しない**。したがって、サービス呼び出しが実フレームより少なければ曲は遅れ、多ければ走る。

## 4. Findings（問題点の指摘）

### F1. ブロッキング BIOS CD 呼び出し中は PSG が 1 tick も進まない（最重要・音の「ぶつ切れ」の主因）

- **根拠**: `load_adpcm_voice()`（`pce_vn_runtime.c:3914-4015`）は `pce_cdb_adpcm_reset()` → `pce_cdb_adpcm_read_from_cd()`（voice 全体を 1 回の BIOS 呼び出しでロード）→ `wait_adpcm_cd_transfer_ready()` を実行するが、`pce_cdb_adpcm_read_from_cd()` の内部（= System Card BIOS 実行中）には PSG サービスを挟む手段がない。CD シーク（BGM パターン領域 → voice 領域の移動を含む）+ リードで数十フレーム以上 CPU が BIOS に取られ、その間 PSG レジスタは最後の音を鳴らしたまま固まる。
- **なぜ問題か**: PSG はシーケンサレスなので、CPU が止まれば曲も止まる。voiced message のたびに発生するため「message ごとに音楽が引っかかる」体験になる。
- **影響範囲**: PSG SONG + ADPCM voice を併用する全プロジェクト。SFX（短い resident パターン）も同様に停止する。
- **変更リスク**: BIOS 呼び出しの分割（F1 改善案 b）は SCSI 状態の settle 問題（`docs/pce-memory-bank-strategy.md` に「cd_transfer_wait を省くと sectors_left が残ったまま COMMAND phase で止まる」既知事象あり）を踏みやすい。IRQ 駆動化（改善案 c）は過去に撤回された経緯がある（F6）。
- **改善案**（併用可）:
  - (a) 【小】voice ロードの発生回数を減らす: `loaded_adpcm_valid` による同一 voice 再利用は既にあるため変更不要。確認のみ。
  - (b) 【中】`pce_cdb_adpcm_read_from_cd()` を N セクタずつ（推奨: 4 セクタ、`#define VN_ADPCM_CD_READ_CHUNK_SECTORS 4`、0 で旧挙動）の複数回呼び出しに分割し、チャンク間で `cd_transfer_wait()` + PSG サービスを挟む。ギャップが「シーク + 4 セクタ」に短縮される。ロード総時間は伸びる（チャンクごとの BIOS オーバーヘッド）ため、Geargrafx で voiced message 開始遅延を計測し、著しく悪化（目安 +50% 超）するなら chunk サイズを 8 に上げる。
  - (c) 【大・要承認】F6 の TIMER IRQ クレジット方式。これが唯一の根治策（BIOS 実行中もテンポが進む）。
- **検証方法**: Geargrafx trace logger で PSG レジスタ書き込みのタイムスタンプ（frame 番号）を記録し、voiced message 開始をまたいで書き込み間隔が指定 BPM の step 間隔 ±1 frame に収まること。耳での確認（音の途切れが知覚できないこと）。
- **実装可否**: (a)(b) は実装してよい。(c) は質問 Q1 の回答待ち。

### F2. 「補償 tick」が盲目的な定数バーストで、テンポを逆方向に壊す

- **根拠**: `cd_transfer_wait()`（`pce_vn_runtime.c:1203-1228`）は CD 1 チャンクごとに固定 65535 回の busy-wait + `VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES = 24` tick の補償を行う。bank134/135 に置かれた大きいパターン（= MIDI/VGM から import した SONG。今回のユーザー報告のケース）では 24 tick を**一瞬で連射**する（1227 行）。さらに `wait_adpcm_cd_transfer_ready()`（3889 行）はセクタ数ぶん `cd_transfer_wait()` を繰り返すため、voice ロード 1 回で「セクタ数 × 24 tick」が実経過時間と無関係に注入される。実際の CD リードは等倍速でおよそ 0.8 frame/セクタなので、**大幅な過補償（曲が前へ飛ぶ）**になり得る。逆にシークが長いときは補償不足（遅れ）になる。定数がどちらにも合わない open-loop 制御である。
- **なぜ問題か**: 「スローダウン」と「急に走る」が交互に起き、ユーザー報告の「ぶつぎれ再生」に一致する。一瞬での 24 連射はステップを飛ばして和音・ノートオフを取りこぼす。
- **影響範囲**: PSG 再生中のすべての CD アクセス（BG/sprite/font/scene pack/glyph mask/ADPCM ロード）。
- **変更リスク**: 補償値は `docs/pce-memory-bank-strategy.md` でチューニング手順込みで文書化された既存仕様。極端に減らすと「BG 切替中に曲全体が遅く聞こえる」旧問題が再発し得る。banked パターンの分散 tick は「tick 中の MPR6 remap が CD DMA と競合しないため post-wait 一括にした」というコメント（1223-1225 行）に反するため、変更時は必ず Geargrafx で bank132 転送破損がないことを確認する。
- **改善案**:
  1. banked パターンも resident パターンと同じく settle 待ちへ**分散 tick** する（`service_psg_ticks()` は毎回 `map_vn_data()` で MPR6 を bank132 へ戻してから返るため、チャンク間の分散呼び出しでも CD リード再開時点の bank 状態は同一。懸念が残る場合は 24×1 でなく 6×4 の粗い分散でもよい）。
  2. 補償量を「そのチャンクで実際に読んだセクタ数」から概算する: `ticks = max(1, sectors)`（等倍速 ≈ 0.8 frame/セクタ + settle 待ち ≈ 定数）を起点に Geargrafx で実測合わせ。定数 24 の一律適用をやめ、`cd_transfer_wait()` の呼び出し元がセクタ数を渡す形にする。
  3. 実測手順: Geargrafx trace logger で「CD リード開始 frame / 終了 frame」と「その間に注入した tick 数」を突き合わせ、60 秒再生でテンポ累積誤差 ±0.5 秒以内を目標とする。
- **検証方法**: 上記実測 + `npm test`（`tests/pce-vn-manager.test.js` の `VN_PSG_CD_TRANSFER_COMPENSATION_FRAMES` / `cd_transfer_wait` 系 assert を新仕様に更新）。SFX（resident パターン）が BG ロードで無音化しない既存挙動（1206-1212 行コメント）を維持。
- **実装可否**: 実装してよい。ただし改善案 1 の DMA 競合確認を必須とする。

### F3. ADPCM の残フレームカウンタが「偽フレーム」で減り、音声が早く切れる

- **根拠**: buffered ADPCM の停止は `adpcm_play_frames_remaining` の減算で行う（`service_adpcm_playback()`、4214 行。ハードウェア length は 0xffff + repeat で流しっぱなしにする設計のため、このカウンタが実質の停止タイマ）。ところが `service_psg_during_blocking_frames(frames)`（4633 行）は同じ `frames` を `service_adpcm_during_blocking_frames()` にも渡すため、**F2 の補償バースト（実時間を伴わない 24 frame）が ADPCM の残時間からも 24 frame（0.4 秒）を奪う**。`cd_transfer_wait()` 1 回ごとに発生する。さらに `VN_ADPCM_BUFFERED_END_GUARD_FRAMES = 4`（73 行）で設計上すでに 4 frame 早く切っているため、体感の「語尾切れ」が増幅される。
- **なぜ問題か**: PSG 補償のための架空の時間が、実時間で自走している ADPCM ハードウェアの停止判定に混入している。関心の分離違反であり、voice 再生中に CD アクセスが走る構成（PSG SONG 併用時は特に）で語尾が切れる。
- **影響範囲**: buffered / stream 両方の ADPCM 停止タイミング、ループ voice の再スタート周期。
- **変更リスク**: 小。ADPCM 側は実 VBlank エッジ由来の呼び出し（`delay_frame()`、`vn_wait_next_vblank()` 直後の `service_psg_during_blocking_frames(1)`、`psg_vblank_elapsed()` ゲートの `service_psg_during_blocking_work()`）だけで減算すれば現行より正確になる。早すぎる停止がなくなる方向の変更なので、逆に「voice が止まらない」回帰は `IO_PCD_STATUS` の ADPCM_END 検出（4222 行）が保険になる。
- **改善案**: `cd_transfer_wait()`（および visual cache 版）の補償呼び出しを「PSG tick のみ」に分離する。具体的には補償専用の `service_psg_compensation_ticks(n)`（ADPCM を触らない）を新設し、`service_psg_during_blocking_frames()` は実フレーム経過箇所専用とする。関数名で意図を区別すること。
- **検証方法**: 32000Hz・約 3 秒の voice を PSG SONG 再生中の message に割り当て、（CD ロードを挟む sprite 差し替えコマンドを同 message 内に置いた上で）Geargrafx で音声が最後まで発音されること。`npm test` の `service_adpcm_during_blocking_frames` 系 assert（`tests/pce-vn-manager.test.js:1507` 付近）更新。
- **実装可否**: 実装してよい。

### F4. VBlank flag（read-clear）の消費者が複数いて、tick の取りこぼしが構造的に起きる

- **根拠**: `IO_VDC_STATUS` の VBlank bit は読むと消える latch である。読者は `vn_wait_next_vblank()`（asm、711 行）、`psg_vblank_elapsed()`（4578 行）、`psg_mark_frame_serviced()`（4596 行）の 3 系統あり、`psg_vblank_elapsed()` は 1 latch = 最大 1 tick しか数えられないため、**ブロッキング作業が 2 frame 以上かかった場合の 2 個目以降の VBlank は永久に失われる**（catch-up 手段がない）。また `psg_mark_frame_serviced()` の追加読みが次の VBlank latch を食うと、その分の tick も消える。`CLAUDE.md` 自身が「IO_VDC_STATUS の追加読み出し（VBlank フラグを消す）は表示を壊しやすい」と警告している箇所である。
- **なぜ問題か**: 重い frame（glyph 一括描画、SATB 更新、VRAM sliced copy）が続く区間で tick が単調に失われ、**恒常的なスローダウン**として蓄積する。F2 の補償はこれを CD 区間でしか埋めない。
- **影響範囲**: PSG テンポ全般、ADPCM 残フレーム減算（同じゲートを共有）。
- **変更リスク**: 中。`vn_wait_next_vblank()` の asm と SATB 更新の VBlank 合わせは表示品質に直結する既知の壊れやすい箇所（`CLAUDE.md` VN sprite/VDC 節）。**wait 自体のセマンティクスは変えないこと**。
- **改善案**: 「VBlank latch を観測した者が、必ず共有カウンタに記帳する」方式に一本化する。
  1. zp/bss に `vn_vblank_credit`（uint8）を置き、`psg_vblank_elapsed()` / `psg_mark_frame_serviced()` / `delay_frame()`（wait 復帰直後）の flag 観測をすべて「credit++」に置き換える。
  2. PSG/ADPCM サービスは credit を消費して tick する（`while (credit) { credit--; tick; }`、暴走防止に 1 呼び出しの消費上限 4 程度）。これにより「誰が flag を食っても tick は失われない」。
  3. `vn_wait_next_vblank()` の asm は変更しない（復帰＝1 VBlank 経過なので呼び出し側で credit++ するだけでよい。既存の「wait 直後に service(1)」呼び出し箇所をそのまま credit 記帳に読み替える）。
- **検証方法**: Geargrafx で 60 秒間 PSG SONG のみ再生（message 送り・BG 切替・sprite 差し替えを操作しながら）し、`psg_step` の進行数が理論値（`bpm*4*60秒/3600`）±1% に収まることを memory watch で確認。表示回帰は `huc6270_reg` R19 write breakpoint で表示期間中の SATB 書き込みがないこと（`CLAUDE.md` 記載の手順）。
- **実装可否**: 実装してよい。ただし wait の asm・呼び出し順は変えない。

### F5. Geargrafx の「PSG buffer overflow / ADPCM buffer overflow」ログ（**素の RUN で発生をユーザー確認済み** — 状態捕捉と IRQ mask 監査が必要）

- **根拠**: Geargrafx 1.7.12 のソース確認結果、両エラーは「音声チップの frame 内サンプルバッファ（`GG_AUDIO_BUFFER_SIZE = 2048`、約 1.39 frame 分）が `EndFrame()` で排出される前に溢れた」ことを意味する（`src/huc6280_psg.cpp:376-393`, `src/adpcm_inline.h:342-371`）。フレーム長は VCE 固定（1365 サイクル × 262 ライン）のため、静的解析上は通常実行で起きない条件だが、**ユーザーがデバッグ操作なしの素の RUN で発生することを確認済み**。つまりエミュレータ内で「フレーム終端が到達しない/遅延する」異常状態に実際に入っている。最有力候補は `docs/pce-memory-bank-strategy.md` に記録済みの Geargrafx 既知状態「`$F5=0`（System Card IRQ mask soft copy が空）のまま ADPCM direct playback へ入ると BIOS `$E73x-$E82x` VBlank/IRQ dispatcher に張り付き、ADPCM frame counter と PSG service が止まる」であり、症状（PSG 停止・画面崩れ・両バッファ同時 overflow）と整合する。
- **なぜ問題か**: この状態に入ると PSG/ADPCM/表示がまとめて壊れるため、F1〜F4 のタイミング改善だけでは今回の報告症状を解消できない可能性がある。一方で、エラーログの発火行そのものを黙らせる方向の修正は誤り（`CLAUDE.md` の「エミュレータ差異を runtime を壊す変更で回避しない」原則）。
- **影響範囲**: PSG SONG 再生中に buffered ADPCM を開始する全パス（`play_adpcm_buffered_voice()` → `start_buffered_adpcm_playback_direct()`、およびループ再スタートを行う `service_adpcm_playback()` 4236 行）。
- **変更リスク**: 中。IRQ mask（`$20F5` soft copy / `VN_CDB_IRQ_MASK_RUNTIME_QUIET` / `quiet_cd_unit_irqs()` / `sync_cd_external_irq_after_bios_call()`）の順序は docs に多数の既知ハマりが記録された繊細な領域。変更は最小差分とし、変更ごとに Geargrafx で回帰確認する。
- **改善案（= Phase 0 で状態捕捉 → 該当したら Phase 1 で修正）**:
  1. エラーがスパムし始めた瞬間に pause し、PC（System Card `$E73x-$E82x` 内か）、`$20F2`（pending latch）、`$20F5`（IRQ mask soft copy）、HuC6280 の IRQ disable register、VDC R5〜R14、CPU speed を dump して記録する。
  2. 「BIOS dispatcher 張り付き + `$F5=0`」が確認できたら、**PSG SONG 再生中に ADPCM を開始/ループ再スタートする全パス**について、`start_buffered_adpcm_playback_direct()` 呼び出し時点で `$F5` が `PCE_CDB_MASK_IRQ_EXTERNAL` に戻っていることを保証するよう順序を修正する（`quiet_cd_unit_irqs()` / `sync_cd_external_irq_after_bios_call()` の呼び忘れ・順序逆転の監査。特に `service_adpcm_playback()` 内のループ再スタート 4236 行は BIOS 呼び出し後の `sync_cd_external_irq_after_bios_call()` が 4238 行と直後にあるが、`cd_transfer_wait()` 由来の補償パスから呼ばれた場合の状態を確認すること）。
  3. 張り付きが確認できない別状態だった場合は Stop And Ask（条件 4）。
- **検証方法**: 修正後、素の RUN で「PSG SONG + voiced message 連続 20 ページ」を実行し、overflow エラーが出ないこと。エラー消失と同時に画面崩れ・PSG 停止も消えることを確認（同根であることの裏取り）。
- **実装可否**: 状態捕捉は実施してよい。IRQ mask 順序の修正は「張り付き状態を捕捉できた場合のみ」実装してよい（推測での順序変更は禁止）。

### F6. 【条件付き承認済み】協調ポーリング方式の限界と TIMER IRQ クレジット方式

- **根拠**: F1〜F4 をすべて実施しても、「BIOS 実行中はテンポ源が止まる」事実は残る（補償は永久に推測）。PCE の標準解は TIMER IRQ 駆動の音声ドライバである。本リポジトリでは直近コミット 1a97678 が `tests/pce-vn-manager.test.js:1508` に **`psg_clock_irq|psg_clock_credit|PCE_CDB_ID_IRQ_TIMER|pce_timer_enable|pce_irq_enable(IRQ_TIMER)` を禁止する assert** を追加している。
- **過去の撤回理由（ユーザー確認済み）**: 前回の TIMER IRQ 実装では**スプライトや背景の破壊が発生した**ため巻き戻された。原因の最有力候補は、ISR 内で PSG レジスタ書き込み（select/data latch の競合）・MPR6 バンク切替・VDC アクセスのいずれかを行い、メインスレッドの VDC register-select latch / バンク状態を非同期に壊したこと。もう 1 つの候補は llvm-mos の imaginary zp レジスタが ISR で保存されず、メインスレッドの計算（VRAM アドレス等）を壊したこと。
- **改善案（再挑戦は許可されたが、下記制約を厳守すること）**: ISR を「**何も知らないカウンタ**」まで縮退させる:
  1. ISR は **naked/手書き asm** とし、llvm-mos の imaginary zp レジスタを一切使わない。処理は「A を push → TMA #1 で MPR0 保存 → MPR0 を I/O page へ → `$1403` に timer ack → 固定 RAM アドレスの `vn_vblank_credit` を inc → MPR0 復元 → A を pop → RTI 相当」のみ。**PSG レジスタ・MPR6/bank 切替・VDC・BIOS 呼び出し・C 関数呼び出しをすべて禁止**（前回破壊の再発防止。この制約が守れない設計になった時点で Stop And Ask）。
  2. credit の消費は F4 と同一機構のメインスレッド側で行う。読み出しは「TIMER IRQ を一時 mask → credit を読み 0 クリア → unmask」のスワップで行い、read-modify-write 競合を避ける。
  3. TIMER は約 60Hz（reload ≈ 116〜117、Geargrafx 実測で合わせる）。
  4. System Card 側は TIMER soft vector（`pce_cdb_irq_set(PCE_CDB_ID_IRQ_TIMER, ...)`）へ ISR を登録し、`VN_CDB_IRQ_MASK_RUNTIME_QUIET`（現在 `PCE_CDB_MASK_IRQ_TIMER` を含む）から TIMER を外す。`$20F5` 系の既知ハマり（F5）と干渉しないか必ず確認。
  5. 実装ゲート（順に通過すること）: (i) 最小実験で「BIOS CD リード（`pce_cdb_cd_read` / `pce_cdb_adpcm_read_from_cd`）実行中に TIQ が配送され credit が増えるか」を実証（増えないならこの案の利点が消えるため中止して報告）。(ii) **前回破壊が出たシナリオの再現テスト**: PSG SONG 再生中の sprite pattern CD ロード + SATB 差分更新 + BG 切替 + message glyph 描画を連続実行し、Geargrafx で VRAM/SATB/VDC レジスタの破壊がないことを確認。(iii) EmulatorJS でも同シナリオを確認（WASM core の joypad edge 既知問題含む）。
  6. `tests/pce-vn-manager.test.js:1508` の禁止 assert は Phase 4 着手時に「naked asm ISR + credit のみ」を許す形へ書き換え、代わりに「ISR 内で PSG/MPR6/VDC を触らない」ことを固定する assert を追加する。
- **変更リスク**: 大。ゲート (ii) を省略しないこと。IRQ 版が安定するまで F2 の補償系は**併存**させ、`#define` で切り替え可能にしておく。
- **実装可否**: 上記制約とゲートを守る前提で実装してよい（ユーザー承認済み）。ゲート (i)(ii) の結果は中間報告すること。

## 5. Behaviors To Preserve（壊してはいけない既存挙動）

1. `CLAUDE.md` の禁止事項すべて。特に: `pce_cdb_adpcm_status()` の毎フレームポーリング禁止 / 短尺音声を true streaming に戻さない / 自然終了後の stop/reset 追撃禁止 / glyph カーソルは値渡し / sprite tick を ADPCM 中に止めない。
2. resident SFX が BG ロード中に無音化しない（`cd_transfer_wait()` の分散 tick、1206-1212 行コメントの経緯）。
3. CD-DA の pause/resume・deferred resume 機構（`prepare_cd_data_access()` 系）。今回のスコープ外。
4. `vn_wait_next_vblank()` の asm 実装と、SATB/VDC 更新を VBlank に寄せる既存の順序。
5. bank128/129/130 の使用率が限界に近い（`CLAUDE.md`: 実測 93〜99%）。コード追加で `ld.lld: .ram_bank129 ... overflowed` が出たら、機能を削らず `VN_BANKED_CODE` ↔ `VN_BANKED_CODE2` の付け替えか overlay 退避で均す。`-Wl,--print-memory-usage` で各バンクを確認。
6. HuCard（非 CD）ビルドのコンパイル可否（`#if defined(__PCE_CD__)` ガードの整合）。

## 6. Stop And Ask Conditions

1. F2 改善案 1（banked パターンの分散 tick）で Geargrafx の bank132 / CD 転送データ破損が観測された場合。
2. F1 改善案 (b)（チャンク分割リード）で SCSI COMMAND phase 停止・sectors_left 残留が再現した場合。
3. バンク溢れが付け替え/overlay 退避で解消できない場合。
4. F5 の状態捕捉で「BIOS dispatcher 張り付き + `$F5=0`」に**該当しなかった**場合（未知の事象。dump 一式を添えて人間に報告。ただし Phase 1〜3 は独立に有効なので継続してよい）。
4b. Phase 4 で ISR に PSG/MPR6/VDC アクセスを入れないと成立しない設計になった場合（前回破壊の再発リスク。設計を持ち帰って報告）。
5. テスト更新が本書の想定（該当 assert の列挙）を超えて連鎖する場合。

## 7. Implementation Phases

各フェーズ末で「検証 → コミット（日本語メッセージ）」。コミット/プッシュは人間の指示がある場合のみ。

### Phase 0 — 再現と状態捕捉（変更なし）

1. `git status` 確認（未コミット変更があれば報告して停止）。`npm test` を実行し記録。
2. `ishi_no_ura` をビルドし、Geargrafx で「PSG SONG 再生 → voiced message 数ページ送り」を再現。以下を記録:
   - PSG レジスタ書き込みの trace（間隔の乱れがどのタイミングで起きるか: message 開始 / CD ロード / 常時）。
   - **buffer overflow エラーは素の RUN で発生することがユーザー確認済み**。スパム開始の瞬間に pause し、F5 改善案 1 の状態 dump（PC / `$20F2` / `$20F5` / IRQ disable register / VDC R5〜R14 / CPU speed）を取得する。これが本フェーズの最重要成果物。
   - 「BIOS `$E73x-$E82x` 張り付き + `$F5=0`」に該当するかの判定。
3. 60 秒間の `psg_step` 進行数（理論値との誤差）をベースラインとして記録。

### Phase 0.5 — 【状態捕捉で該当した場合のみ】IRQ mask 順序の修正（F5）

Phase 0 で「BIOS dispatcher 張り付き」が確認できた場合、F5 改善案 2 の監査と最小修正を**他のフェーズより先に**行う（この 1 件だけで報告症状の大半が消える可能性があるため）。修正後に Phase 0 の計測を再実行し、残る症状を確認してから Phase 1 以降を進める。該当しなかった場合は Stop And Ask（条件 4）で人間に報告し、指示を待たずに Phase 1 へ進んでよい（Phase 1〜3 は独立に有効なため）。

### Phase 1 — 実フレームと補償の分離（F3 + F4、低リスク）

1. `vn_vblank_credit` 共有カウンタを導入し、`psg_vblank_elapsed()` / `psg_mark_frame_serviced()` / wait 復帰直後のサービス呼び出しを credit 記帳・消費方式に統一する（F4 改善案。wait の asm は不変）。
2. 補償専用 `service_psg_compensation_ticks(n)` を新設し、`cd_transfer_wait()`（通常 + visual cache 版）から ADPCM 減算を切り離す（F3 改善案）。
3. `tests/pce-vn-manager.test.js` の該当 assert（`psg_vblank_elapsed` / `psg_mark_frame_serviced` / `service_psg_during_blocking_frames` / `service_adpcm_during_blocking_frames` / `cd_transfer_wait` 系。1495-1516 行付近と 2 箇所の visual cache 系）を新実装に合わせて更新。**禁止 assert（1508 行）はこのフェーズでは触らない。**
4. 検証: Phase 0 の計測を再実行し、(i) `psg_step` 誤差がベースラインより改善、(ii) voice の語尾切れ解消、(iii) 表示回帰なし（R19 breakpoint / VRAM 目視）、(iv) `npm test` pass、(v) EmulatorJS でも入力・進行が正常（`CLAUDE.md` の WASM 注意点）。

### Phase 2 — 補償量の実測化と分散（F2）

1. `cd_transfer_wait()` にセクタ数（または呼び出し元区分）を渡し、補償 tick 数を実測ベースの式に置き換える。banked パターンも分散 tick 化（DMA 競合確認を必須）。
2. `docs/pce-memory-bank-strategy.md`「PSG 補償 tick 調整 TIPS」を新仕様（定数 → 実測式）に書き換える。
3. 検証: BG 切替・sprite ロード・voice ロードそれぞれの前後で trace を取り、テンポ累積誤差 60 秒 ±0.5 秒以内。SFX 無音化回帰なし。

### Phase 3 — ADPCM voice ロードのチャンク分割（F1(b)）

1. `#define VN_ADPCM_CD_READ_CHUNK_SECTORS 4`（0 = 旧挙動）を導入し、`load_adpcm_voice()` の CD リードを分割、チャンク間で PSG サービス。
2. 検証: voice 波形が旧実装と一致（Geargrafx で ADPCM RAM を dump して比較）、SCSI 停止なし（連続 20 message の耐久操作）。**ロード総時間の増加はユーザー許容済み**だが、悪化率は計測して報告に含める（音の途切れ短縮とのトレードオフを人間が後から判断できるように）。
3. `PLUGIN.md` / `docs/pce-media-programming-guide.md` の ADPCM 節に挙動と define を追記。

### Phase 4 — TIMER IRQ クレジット方式（F6、条件付き承認済み）

F6 の制約（naked asm・credit のみの ISR）とゲート (i)〜(iii) を厳守して実装する。**前回の実装はスプライト/背景破壊で巻き戻された**ため、ゲート (ii) の破壊再現テストを省略しないこと。ゲート (i)（BIOS CD リード中の TIQ 配送）が不成立ならこの Phase を中止して報告する。実装後も F2/F3 の補償系は `#define` 切り替えで併存させ、撤去は IRQ 方式の検証（Geargrafx + EmulatorJS + 可能なら実機）が全部通ってから別コミットで行う。

## 8. Verification Requirements（全フェーズ共通）

- `npm test`（少なくとも `node --test tests/pce-vn-manager.test.js` と `tests/pce-asset-manager.test.js`）。
- Geargrafx（一次）: PSG register write trace のテンポ整合 / ADPCM 発音長 / VRAM・SATB・VDC レジスタの表示回帰確認。`debug_step_frame` は 1:1 強制で実時間フレーム落ちを隠す点に注意（`CLAUDE.md`）。
- EmulatorJS/WASM（二次）: ADPCM 後の入力待ちが進むこと（joypad edge 既知問題）。
- テストを実行できない場合は理由と残リスクを最終報告に明記（`CLAUDE.md` ルール）。
- ドキュメント更新（同一作業内）: 挙動変更したら `docs/pce-memory-bank-strategy.md`、ユーザー可視の変化があれば `docs/user-guide.md`、ADPCM 仕様変更は `docs/pce-media-programming-guide.md` / `PLUGIN.md`。最終回答で更新ドキュメントを列挙。

## 9. Reporting Format

1. フェーズごとの変更概要・コミット hash・更新したテスト assert の一覧。
2. Phase 0 と各フェーズ後の計測値（psg_step 誤差、voice 発音長、ロード時間、overflow エラー有無）。
3. 実施できなかった検証と残存リスク。
4. Stop And Ask で停止した項目。
5. 更新したドキュメントの一覧。

## 10. Out-of-scope

- CD-DA の pause/resume 設計変更。
- PSG 音色・波形・エンコーダ（editor 側 `pce-psg-quantize.js` / import 系）の変更。
- メッセージ文字送り（textSpeedFrames）の計算方式変更（`CLAUDE.md` で凍結済み）。
- EmulatorJS 側の修正、Geargrafx 本体の修正（upstream 報告は可）。
- 見た目のためのリファクタリング、無関係な整形。
