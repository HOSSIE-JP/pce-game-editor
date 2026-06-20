# Codex タスク: VN runtime 表示/同期の改善（口パク・切替崩れ・コマンド同期）＋エディタ文字色プレビュー

前タスク（docs/tasks/codex-vn-loop-fps.md / ループ fps 削減）の続き。直近の最適化で **ADPCM 再生中にスプライト更新を止めた**ことが口パクを壊した。以下 4 点を修正する。runtime 編集は `template/template_pce_vn_cd/src/pce_vn_runtime.c`（ビルドで project へ同期）。

## Item 1: ADPCM 再生中もスプライト更新を止めない（口パク維持・最優先）
- 現状: main loop（`while (1)` 内、約 L4099）が `if (!adpcm_playback_active()) { tick_sprite_animations(); tick_spritetext(); if (pending_sprite_refresh) refresh_scene_sprites(); }` とゲートしており、**音声付き message 中に口パクアニメが停止**する。
- 要件: **ADPCM 再生中もスプライト/spritetext アニメと refresh を毎フレーム実行**する（ゲートを外す）。口パクが動かないのは許容不可。
- fps 維持の方法（ゲートで止めるのは不可）: 直近実装した**差分リフレッシュ（`VN_SPRITE_REFRESH_PATTERNS` = pattern word 差分のみ、`clear_sprites`/palette/CD load/64entry 全 SATB 転送を毎回しない）**でアニメ更新コストを十分軽くして 60fps を保つ。フレーム変化が pattern のみなら full refresh を要求しないこと。
- 合格: Geargrafx で voiced message 中に口パク（`mouthSlot`/`mouthAnimationId`）が動く。かつ前タスクの成果（voiced 中 ~60fps、音声終了時に文字ほぼ完了、画面乱れ無し）を**維持**。両立できない場合は口パク優先で実装し、残る fps 差を計測して報告。

## Item 3: BG/スプライト切替時に VRAM 書き換えが画面に見える崩れを消す
- BG: 切替時、transition 指定が無く（cut）ても **暗黙のパレットフェードで滑らかに**切り替える前提で見直す。VRAM/BAT 転送中の崩れが見えないよう、既定で「(a) 現 BG パレットをフェードアウト（または表示無効化）→ (b) tiles/BAT/パレット転送 → (c) フェードイン」を行う。既存 `fade_palette()`(L1452) / display 制御 / `upload_bg_graphics()`(L2044) を活用。明示的 `fade` transition との二重適用に注意。
- スプライト: **同一スロットに別アセットのパターンをロードする場合**、VRAM 書き換え中を画面に見せないよう **一度 sprite layer を無効化→パターン転送→有効化**する。既存 `sprite_layer_disable()`(L509)/`sprite_layer_enable()`(L518) と `refresh_scene_sprites()` の pattern upload 経路（`VN_SPRITE_REFRESH_FULL` / `requires_pattern_upload`）を、別アセットロード時は必ず disable→upload→enable で囲む。同一アセットの frame 変化（口パク）では無効化しない（Item1 と矛盾させない）。
- 合格: Geargrafx で BG 切替・スプライト差し替え時に書き換え途中フレームの崩れが見えない。

## Item 4: BG/スプライト表示コマンドは実描画完了まで次コマンドへ進まない（同期化）
- 現状: ロード中に次コマンド（例: メッセージ描画）が始まり非同期に見える。
- 要件: `background` / `sprite` 表示コマンドは、**VRAM 転送 + BAT/SATB 反映 +（Item3 の）フェード/有効化が完了してから**次コマンドへ進む（同期実行）。`run_commands_until_wait` / `execute_command` 経路で、表示反映が次コマンド開始前に完了することを保証する。preload（先読み）とは整合させる（preload は先読みのみ、実反映はコマンド実行時に同期完了）。
- 合格: BG/スプライト表示の直後にメッセージが始まっても、表示が確定してからメッセージが出る（ロード中にメッセージが先に出ない）。

## Item 5: エディタのスクリプトプレビューで文字色（textColor）が反映されない
- 該当: `plugins/pce-visual-novel-editor/renderer.js` の `previewRuntime` 内。message セルは `.pv-cell`（CSS で `color:#fff` 固定、L783）で生成（`paintMsg` L1064-1079、`showMessage` L1094-）。message の `textColor`（正規化済み, L668 `snapHexToPce(raw.textColor)`）が描画に未適用。
- 修正: プレビューのメッセージ本文に message の `textColor` を適用（空/未指定は白、選択肢・END は既定色）。`paintMsg` に色を渡す or 現在表示中 message の色を保持して cell/`#pv-msg` に反映。runtime 同様、speaker ラベルも本文色で良い。
- 合格: エディタのシーンプレビューで、`textColor` を設定した message が指定色で表示される。

## 制約（厳守）
- **撤去済みタイミング手法を再導入しない**（`delay_frame` の VBlank 計数 / `adpcm_play_frames_remaining` 実フレーム減算 / 文字の ADPCM 進捗比例追従）。`pce_cdb_adpcm_status()` 毎フレームポーリング禁止。`IO_VDC_STATUS` は `delay_frame` 内のみで読む。NO_BIOS VBlank・R5 shadow・sprite cycle bit を壊さない。
- **bank130 が残り 66 バイトと逼迫**（`.ram_bank130=0x1fbe/0x2000`）。コード増を最小化し、必要なら `VN_BANKED_CODE`↔`VN_BANKED_CODE2` の付け替えや既存ロジック流用で吸収。`-Wl,--print-memory-usage` で各バンクを確認し、オーバーフローさせない。
- 編集は template runtime と上記エディタ renderer のみ。生成 C は手編集しない。
- 同じ作業内でドキュメント更新（`CLAUDE.md` / `PLUGIN.md` / 関連 `docs/`）。

## 検証
- Geargrafx MCP（BIOS: `data/projects/[BIOS] Super CD-ROM System (Japan) (v3.0).pce`、対象: `data/projects/Kitahe/out/Kitahe.cue`、ビルドは前回同様 node CLI、シンボルはビルド直後の `llvm-nm` で取得）で Item1〜4 を実画面確認。
- `npm test` 全パス（runtime 照合テストは新挙動へ更新）。
- Item5 はエディタのプレビュー実行で色反映を確認（手順を報告）。

## 成果物
- 各 Item の修正と Geargrafx/プレビュー検証エビデンス、`npm test` 結果、更新ドキュメント、bank 使用率。
