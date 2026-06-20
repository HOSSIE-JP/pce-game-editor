# Codex タスク: VN メインループの ADPCM 再生中フレームレート低下の特定と削減

## 目的（ゴール）
CD-ROM2 VN runtime で **ADPCM 音声再生中にメインループが 60fps を維持できず**、フレームタイマ方式の文字送り（typewriter）がハードウェアクロックの音声から遅れる問題を解消する。**タイミングのトリック（実フレーム補正・音声追従）ではなく、毎フレーム処理コストを下げて 60fps を取り戻す**ことで、現行のエディタ計算の `text_speed` のまま音声と同期させる。

## 背景・症状
- 音声付き message で、ADPCM 音声が鳴り終わっても文字表示が半分程度しか進んでいない（文字が音声より遅い）。
- 標準 EmulatorJS と Geargrafx の両方で発生（実機準拠の挙動の疑い）。
- 仮説: ADPCM 再生 DMA の bus contention で CPU 実効速度が落ち、メインループの 1 反復が 1 フレームを超える → `delay_frame()` を基準に時間を数える typewriter / `adpcm_play_frames_remaining` が実時間より遅く進む。

## 確定事実（証拠）
- メインループ: `template/template_pce_vn_cd/src/pce_vn_runtime.c` の `while (1)`（約 L3824）。1 反復で `tick_active_message()`(L3885) / `tick_psg()` / `tick_sprite_animations()`(L3899) / `tick_spritetext()` / `if (pending_sprite_refresh) refresh_scene_sprites()`(L3901) / `delay_frame()`(L3903)。
- `delay_frame()`（約 L448）は `service_adpcm_playback()`（counter `adpcm_play_frames_remaining` を 1 減算）→ VDC status の VBlank フラグを guard 付きで待つ → `service_cdda_playback()`。`IO_VDC_STATUS` を読むのはここだけ。
- 過去の Geargrafx 実測: 音声(AMVL1009: 20240B@16kHz=152フレーム)がハードウェア完了した時点で `adpcm_play_frames_remaining` 由来の進捗も文字も約 50% → **ループが約 30fps**（1 反復≈2 フレーム）に落ちている。
- 対象シーン `data/projects/Kitahe`（startScene=opening, msg index1 が音声付き）。スプライト `AMf_054_001-sheet` は 320x256 / cell16x16、animation `default`(frameCount5, frameDelay8, frame64x128=4x8=**32 cell**) と `row_1`(frameCount5, frameDelay4)。**音声付き message 中、この 32 セルスプライトが frameDelay 4〜8 ごとにアニメする**。
- ビルド: `data/projects/Kitahe/out/Kitahe.elf` と **`Kitahe-link.map`**（シンボルアドレスあり）。BIOS: `data/projects/[BIOS] Super CD-ROM System (Japan) (v3.0).pce`。Geargrafx MCP 利用可。

## 有力な原因候補（優先度順・要検証）
1. **`refresh_scene_sprites()`（L2857）の毎回フルリビルド**。`pending_sprite_refresh` はアニメのフレーム変化時（`tick_sprite_animations` 約 L2987 の `if (changed)`）に立つ。リフレッシュ毎に: `clear_sprites()` → 各可視スプライトで `upload_palette()`（16色 VCE 書き込み、アニメで色は不変なのに毎回）→ `ensure_sprite_patterns_loaded()`（キャッシュ済みなら CD 読まない）→ `show_character_sprite_frame()` が **最大 32 個の SATB エントリを構築**（`cell_map[]` 経由）→ `upload_sprite_table()`（SATB 512B を VRAM 転送）。これが 1 フレームを超えると、アニメ周期ごとにループがヒッチ。
2. **グリフ合成 `draw_message_glyph_at()`（約 L1825）** の VRAM read-back（`pce_vdc_copy_from_vram` でマスク読み出し）。文字表示間隔ごと。
3. **ADPCM 再生中の bus contention 自体**（削減不能な実機制約の可能性）。この場合は「フレーム計数では同期不能」と結論し、別アプローチの提言を残す。

## 調査ステップ
1. `Kitahe-link.map` から `adpcm_play_frames_remaining` の WRAM アドレスを特定。
2. Geargrafx で Kitahe を起動（BIOS ロード → RUN → 音声付き message へ進める）。**音声付き message は長押しでスキップされる**ので、進めたら素早く操作を離す。
3. **ループ fps の定量測定（決定的）**: ADPCM 再生中に pause し、(a) ハードウェア ADPCM の進捗（`get_adpcm_status` の read_address/length から経過バイト→経過フレーム）と (b) `adpcm_play_frames_remaining`（メモリ読み）を同時取得。`loop_fps ≈ 60 * (counter 経過) / (hardware 経過)`。30fps 付近かを確認。
4. **コスト内訳の特定**: 次のいずれかで 1 反復の重い処理を切り分ける。
   - Geargrafx の trace log / breakpoint で `refresh_scene_sprites` と `draw_message_glyph_at` の実行サイクルを計測（VBlank 間サイクル比較）。
   - もしくは runtime に一時デバッグカウンタ（ループ反復数・refresh 回数）を追加し、`.map` のアドレスをメモリ読みして反復数/秒を測る（検証後に必ず除去）。
   - スプライト無し / アニメ無しの比較 message を一時的に作り、ループ fps が回復するかで犯人を特定。
5. ADPCM **あり/なし** で同一シーンのループ fps を比較し、純粋な bus contention 寄与分を分離する。

## 削減（修正）の方針候補
- `refresh_scene_sprites`: アニメのフレーム変化では **SATB の pattern フィールドのみ更新**し、`clear_sprites`＋全 SATB 再構築＋全 512B 転送＋`upload_palette` を毎回やらない。位置/サイズ不変なら差分更新、または使用エントリ数分だけ転送。`upload_palette` はアニメ周期で呼ばない（色不変）。
- グリフ合成のコスト削減（read-back 回数/範囲の最小化）が有効なら適用。
- 上記で voiced message 中も実効 ~60fps を維持できれば、**現行のフレームタイマ `text_speed` のまま音声と同期**する（タイミング改修不要）。

## 制約（厳守・やってはいけない）
- **撤去済みの手法を再導入しない**: `delay_frame` で VBlank を数える / `adpcm_play_frames_remaining` を実フレーム減算 / 文字表示を ADPCM カウンタへ比例追従。これらは**画面の乱れ・文字が音声後に表示・低速化**の回帰を起こして撤去済み（[[CLAUDE.md の VN message / ADPCM 文字送り]] 参照）。
- `pce_cdb_adpcm_status()` の毎フレームポーリング禁止（標準 WASM core で joypad edge が戻らなくなる）。
- VDC 表示管理を壊さない: `IO_VDC_STATUS` の読みは `delay_frame` のみ（他で読むと VBlank フラグが消える）。NO_BIOS VBlank・R5 shadow・sprite cycle bit を維持（`docs/pce-testplay-debugging.md`、`docs/pce-memory-bank-strategy.md`）。
- 常駐バンク 128/129/130 の予算は逼迫（`docs/pce-vn-overlay-pathb.md`、`-Wl,--print-memory-usage` で確認）。コード増を最小に。
- 編集対象は **テンプレートの runtime** `template/template_pce_vn_cd/src/pce_vn_runtime.c`（ビルドで project へ同期される）。生成 C（assets.c/vn.c 等）は手編集しない。
- ADPCM 周りの runtime 変更は **Geargrafx で「ADPCM 再生中フレーム」の画面・VRAM・SATB・VDC を必ず確認**。`debug_step_frame` は 1:1 を強制し実時間のフレーム落ちを隠すので、fps 測定は実時間 pause での counter 比較で行う。

## 合格条件（検証）
1. Geargrafx 実測: voiced message 中のループ fps が実効 ~60fps に回復（counter 進捗 ≈ hardware ADPCM 進捗）。
2. 音声付き message で、**音声終了時に文字表示がほぼ完了**（数フレーム差以内）。ADPCM 再生中に**画面の乱れが無い**。
3. 非 voiced message・スプライトアニメ・口パクに回帰が無い。
4. `npm test` 全パス（必要なら runtime 照合テストを新挙動へ更新）。
5. ドキュメント更新（同じ作業内で）: 原因と対策を `CLAUDE.md` / `PLUGIN.md` / 関連 `docs/` に反映。bus contention が削減不能と判明した場合はその結論と推奨を記載。

## 成果物
- 原因特定の根拠（ループ fps 実測値、重い処理のサイクル内訳）。
- 毎フレームコストを下げる最小修正（または「削減不能」結論＋安全な代替案の設計）。
- Geargrafx 検証エビデンス（スクショ/数値）と回帰テスト結果。
- 一時的に入れたデバッグ計装は全て除去。
