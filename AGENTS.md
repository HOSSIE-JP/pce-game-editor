# Codex 向け指示

このリポジトリは PC Engine / Super CD-ROM2 専用の `pce-game-editor` です。

## 最初に読むもの

- PCE プラグイン、アセット、ビルド、Test Play を変更する前に `PLUGIN.md` を読んでください。
- Test Play や実機/エミュレーター表示崩れを調査する前に `docs/pce-testplay-debugging.md` を読んでください。
- CD-ROM2 / VN runtime のメモリバンク配置を変更する前に `docs/pce-memory-bank-strategy.md` を読んでください。
- 公開 API、プラグイン manifest、IPC、ビルド仕様を変更する場合は、同じ作業内で `PLUGIN.md` または `docs/` 配下の関連ファイルを更新してください。
- ユーザーに見える機能追加・仕様変更・既知制約の追加を行う場合は、同じ作業内で `README.md`、`docs/user-guide.md`、`PLUGIN.md`、関連する `docs/` のいずれかを更新し、最終回答で更新したドキュメントを明記してください。
- 外部リポジトリからコードをコピーしないでください。外部情報は挙動理解だけに使い、実装は独自に行ってください。

## 現在の運用

- PCE 固有の実装は `pce-*.js`、`plugins/pce-*`、`plugins/pc-engine-core`、`template/template_pce_*` を優先して確認してください。
- 共有アプリ基盤ユーティリティは本体に取り込んだ `game-editor-common.js` にあります（旧 `../game-editor-common` 外部パッケージは廃止）。
- PCE 固有のプロジェクト移行処理は `pce-project-migration.js` に置き、共通ライブラリへ戻さないでください。
- 画像アセットは内蔵 PCE 変換を使い、Superfamiconv には依存しません。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` を前提に扱います。IPL / System Card はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。
- CD-ROM2 の大きい画像/sprite/ADPCM payload は `cd.dataFiles` に置き、RAM bank には詰め込まないでください。VN runtime は bank129 を実行コード、bank132 を VN generated data、bank130-131 を例外的な小さい fallback data として扱います。
- ADPCM の `divider` は音量ではなく ADPCM 再生 rate code です。`sampleRate` から `32000 / (16 - code)` に最も近い `0..15` の code を補完し、代表値は 32000Hz -> 15、16000Hz -> 14、8000Hz -> 12、4000Hz -> 8 です。旧実装で保存された `round(32000 / sampleRate - 1)` や `round(16000 / sampleRate - 1)` の値は読み込み時と runtime で補正します。
- ADPCM generated metadata の `codec`、`nibbleOrder`、`encoderVersion` が現行値と違う場合は source WAV から再生成してください。同じ `oki-msm5205/msn-first` 表記でも、古い `encoderVersion` のバイナリは先頭ノイズが出る可能性があります。
- ADPCM preload は ADPCM RAM への先読みだけです。`loaded_adpcm_valid` が立っていても、実際の再生時には必ず `pce_cdb_adpcm_play()` を呼んでください。
- VN runtime の短い ADPCM one-shot / buffered 再生は、再生開始後に毎フレーム `pce_cdb_adpcm_status()` で自然終了監視しないでください。標準 EmulatorJS/WASM core では、ADPCM 終了まで status polling した後に joypad edge が戻らないことがあります。
- VN runtime の ADPCM 自然終了後処理では、再生済みの one-shot / stream に追加で `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()` を投げないでください。明示的な AUDIO stop は stop/reset しますが、自然終了後の余分な reset は標準 EmulatorJS/WASM core で joypad edge が戻らない原因になり得ます。
- ADPCM 1 asset の安全上限は `min(65535, 65536 - adpcmAddress)` bytes です。4-bit ADPCM なので再生時間は概算で `bytes * 2 / sampleRate` 秒です。
- VN sprite 表示では generated `pce_editor_sprite_draw_meta[]` の compact metadata を使い、単一 frame/default animation は sheet 全体表示として扱います。VDC memory control は `VN_VDC_MEMORY_CONTROL` を使い、sprite cycle bit を落とさないでください。
- CD-ROM2 VN の BG `map_vram.bin` は `VN_MAP_WIDTH`(=32)タイル幅の「ソース行」として扱い、`mapBase` から一括転送しないでください。`width_tiles` 分だけを行単位でBATへ転送し、左右/上下余白は `clear_screen_map()` のblank tileを残します。画面は 256x224・BAT 32x32 で、BG 画像は 256px(32 タイル)以下にしてください。
- PCE の描画崩れ、VRAM/SATB/VDC レジスタ調査、Test Play の実画面デバッグでは、利用可能なら Geargrafx MCP を優先して使ってください。
- Super CD-ROM2 / ADPCM の挙動確認では、標準 EmulatorJS/WASM だけを正としないでください。Geargrafx で正常動作し、標準 WASM だけが ADPCM 再生後に入力待ちから進まない場合があります。まず ADPCM あり/なしの比較、frame counter、`simulateInput()` 直接注入、読み込まれた core (`mednafen_pce-wasm.data` など) を確認し、runtime を壊す変更で回避しようとしないでください。
- Test Play の外部エミュレーター起動は `pce-external-emulator` plugin が担当します。プロジェクト設定の `testPlay.externalEmulator.executablePath` / `extraArgs` は、Test Play role が `pce-external-emulator` のときだけ有効です。macOS の Geargrafx 既定値は `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` で、保存済み `.app` bundle path は main process で `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE path を渡します。
- Electron renderer、preload、main process の責務を分離してください。
- ファイルシステム IPC はプロジェクトルート内に限定し、パストラバーサルを拒否してください。

## 回帰テスト

- コードを変更した後は、編集範囲に対応する最小限のテストを実行してください。
- PCE 全体の基本確認は `npm test` です。
- テストを実行できない場合は、その理由と残るリスクを最終回答に書いてください。

## コミットメッセージ

Codex がこのリポジトリでコミットを作成する場合、コミットメッセージは日本語で書いてください。
