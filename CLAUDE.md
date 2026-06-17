# CLAUDE.md

このリポジトリは PC Engine / Super CD-ROM2 専用のゲームエディター `pce-game-editor`（Electron 製）です。
このファイルは Claude Code がこのリポジトリで作業するための指示です。元々 Codex 向けに書かれた `AGENTS.md` と同じルールを Claude 向けに整理したものです。**`AGENTS.md` の内容も有効です** — 矛盾する場合はこのファイルを優先してください。

## まず読むもの（変更前に）

作業対象に応じて、コードを編集する前に該当ドキュメントを読んでください。

- **PCE プラグイン / アセット / ビルド / Test Play を変更する前** → [PLUGIN.md](PLUGIN.md)
- **Test Play や実機/エミュレーター表示崩れを調査する前** → [docs/pce-testplay-debugging.md](docs/pce-testplay-debugging.md)
- **CD-ROM2 / VN runtime のメモリバンク配置を変更する前** → [docs/pce-memory-bank-strategy.md](docs/pce-memory-bank-strategy.md)
- **画像 / スプライト / ADPCM / CD-DA の実装** → [docs/pce-media-programming-guide.md](docs/pce-media-programming-guide.md)
- **AI Control（REST/MCP）API の仕様** → [AI_CONTROL.md](AI_CONTROL.md)

## ドキュメント更新ルール（重要）

- 公開 API、プラグイン manifest、IPC、ビルド仕様を変更する場合は、**同じ作業内で** `PLUGIN.md` または該当する `docs/` ファイルを更新してください。
- ユーザーに見える機能追加・仕様変更・既知制約の追加を行う場合は、**同じ作業内で** `README.md` / `docs/user-guide.md` / `PLUGIN.md` / 関連 `docs/` のいずれかを更新し、**最終回答で更新したドキュメントを明記**してください。

## 外部コードの扱い

- **外部リポジトリからコードをコピーしないでください。** 外部情報は挙動理解のためだけに使い、実装は独自に行ってください。
- PCE-CD の IPL / System Card、EmulatorJS runtime、llvm-mos-sdk などの外部バイナリは同梱しません。ユーザー所有ファイル / ユーザー操作によるダウンロードとして扱います。

## コマンド

```sh
npm install     # セットアップ
npm start       # 起動（= npm run dev）
npm test        # 回帰テスト（tests/run-tests.js）
npm run mcp     # 起動中エディターの REST bridge につなぐ MCP sidecar
```

ビルド: `npm run build:mac` / `npm run build:win` / `npm run build:win:installer`

## 回帰テスト

- コードを変更したら、**編集範囲に対応する最小限のテスト**を実行してください。
- PCE 全体の基本確認は `npm test`。AI Control の REST/MCP 境界、plugin manager、packaging、PCE asset/build/Test Play/VN まわりを含みます。
- テストを実行できない場合は、その理由と残るリスクを最終回答に書いてください。

## コミットメッセージ

このリポジトリでコミットを作成する場合、**コミットメッセージは日本語**で書いてください。（コミット/プッシュはユーザーが明示的に依頼したときのみ。）

## アーキテクチャと配置

- PCE 固有実装は `pce-*.js`、`plugins/pce-*`、`plugins/pc-engine-core`、`template/template_pce_*` を優先して確認してください。
- 共有アプリ基盤ユーティリティは本体に取り込んだ `game-editor-common.js` にあります（旧 `../game-editor-common` 外部パッケージは廃止）。このモジュールは特定ハードウェアの知識を持ちません。
- **PCE 固有のプロジェクト移行処理は `pce-project-migration.js`** に置き、共通ライブラリへ戻さないでください。
- Electron の **renderer / preload / main process の責務を分離**してください。
- **ファイルシステム IPC はプロジェクトルート内に限定**し、パストラバーサルを拒否してください。
- 画像アセットは内蔵 PCE 変換を使い、Superfamiconv には依存しません。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` を前提に扱います。

## PCE 固有のノウハウ（変更時に壊しやすい点）

### メモリバンク / CD-ROM2
- 大きい画像 / sprite / ADPCM payload は `cd.dataFiles` に置き、RAM bank に詰め込まないでください。
- VN runtime のバンク割り当て: **bank129 = 実行コード**、**bank132 = VN generated data**、**bank130-131 = 例外的な小さい fallback data**。
- CD-ROM2 VN の BG `map_vram.bin` は `VN_MAP_WIDTH`(=32) タイル幅の「ソース行」として扱い、`mapBase` から一括転送しないでください。`width_tiles` 分だけを行単位で BAT へ転送し、左右/上下余白は `clear_screen_map()` の blank tile を残します。画面は **256x224**・**BAT 32x32**。BG 画像は 256px(32 タイル)以下。
- メッセージフォントは **12x12**（1 行 17 文字 x 4 行）。`font.bin` は 12x12 1bpp マスク(24byte/字)で、起動時に VRAM へストリーム後、runtime のグリフコンポジタ（`draw_message_glyph_at` 他、**bank130**）が 12px ピッチで read-modify-write 合成します。常駐ピクセルバッファは持たず（console_ram 圧迫回避）、コンポジタコードを bank128 に置かないこと。

### ADPCM
- `divider` は音量ではなく **ADPCM 再生 rate code**。`sampleRate` から `32000 / (16 - code)` に最も近い `0..15` の code を補完します（代表値: 32000Hz→15、16000Hz→14、8000Hz→12、4000Hz→8）。旧実装の `round(32000/sampleRate - 1)` などは読み込み時と runtime で補正します。
- generated metadata の `codec` / `nibbleOrder` / `encoderVersion` が現行値と違う場合は source WAV から再生成してください（同じ表記でも古い `encoderVersion` は先頭ノイズの可能性）。
- ADPCM preload は ADPCM RAM への先読みだけ。`loaded_adpcm_valid` が立っていても、再生時は必ず `pce_cdb_adpcm_play()` を呼んでください。
- VN runtime の短い one-shot / buffered 再生では、再生開始後に毎フレーム `pce_cdb_adpcm_status()` で自然終了監視しないでください（標準 WASM core で joypad edge が戻らなくなることがある）。
- 自然終了後に追加の `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_reset()` を投げないでください（明示的 AUDIO stop 時のみ stop/reset する）。
- ADPCM 1 asset の安全上限は `min(65535, 65536 - adpcmAddress)` bytes。再生時間概算 `bytes * 2 / sampleRate` 秒。

### VN sprite / VDC
- VN sprite 表示は generated `pce_editor_sprite_draw_meta[]` の compact metadata を使い、単一 frame/default animation は sheet 全体表示として扱います。
- VDC memory control は `VN_VDC_MEMORY_CONTROL` を使い、**sprite cycle bit を落とさない**でください。

### Test Play / エミュレーター
- PCE の描画崩れ、VRAM/SATB/VDC レジスタ調査、Test Play の実画面デバッグでは、利用可能なら **Geargrafx MCP を優先**してください（`geargrafx-debugging` / `geargrafx-romhacking` スキル、`mcp__geargrafx__*` ツール）。
- Super CD-ROM2 / ADPCM の挙動確認では **標準 EmulatorJS/WASM だけを正としない**でください。Geargrafx で正常動作し標準 WASM だけが ADPCM 再生後に入力待ちから進まないことがあります。まず ADPCM あり/なし比較、frame counter、`simulateInput()` 直接注入、読み込まれた core を確認し、**runtime を壊す変更で回避しようとしない**でください。
- Test Play の外部エミュレーター起動は `pce-external-emulator` plugin が担当。`testPlay.externalEmulator.executablePath` / `extraArgs` は Test Play role が `pce-external-emulator` のときだけ有効。macOS の Geargrafx 既定は `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` で、`.app` bundle path は main process で `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE path を渡します。
