# PCE Game Editor Refactor Report

作成日: 2026-06-13

このレポートは `refactor-instructions.md` に基づく段階的リファクタリングの実施結果、未完了の Stop-and-Ask 項目、Phase 8 の提案をまとめたものです。

## 実施済みフェーズ

| Phase | Commit | 要約 |
|---|---|---|
| Phase 1 | `6702b19` | `tests/run-tests.js` に現行 PCE 実装で pass する安全網を追加し、`pce-file-safety` の境界テストを追加 |
| Phase 2 | `60ba2e3` | 存在しない plugin を参照する孤児テストと MD 由来の未使用トップレベルファイルを削除 |
| Phase 3 | `1ab97a7` | `PLUGIN.md` / `README.md` を現行 PCE plugin 構成と test runner 実態へ同期 |
| Phase 4 | `3e30630` | `core-manager.js` を PCE 専用 router に単純化し、`build-system.js` と stale core/build tests を削除 |
| Phase 5 | `648bcc9` | Test Play 静的サーバーを `pce-testplay-server.js` へ抽出し、path safety を共通化 |
| Phase 6 | `278e5cb` | AI Control の公開名を `pce-editor://` / `PCE_EDITOR_CONTROL_*` / `pce-game-editor-mcp.js` へ移行 |

## 検証結果

Baseline:

- `git status --short`: `?? refactor-instructions.md`
- `npm test`: 37 tests / 37 pass
- `npm start`: build meta 注入後に起動。初期出力に追加エラーなし

最終確認:

- `npm test`: 78 tests / 78 pass
- `node tests/editor-control-service.test.js`: 5 tests / 5 pass
- `node tests/pce-testplay-server.test.js`: 3 tests / 3 pass
- `./node_modules/.bin/electron scripts/smoke-pce-cd-testplay.js data/projects/1123/out/MY_NEW_GAME.cue`: `SMOKE_OK`、canvas 表示あり
- AI Control manual check: `GET /v1/status`、`GET /v1/tools`、`POST /v1/resources/read` がすべて HTTP 200
- `npm start`: Phase 6 後に build meta 注入まで確認。初期出力に追加エラーなし

未検証:

- HuCard Test Play の実画面 smoke は、リポジトリ内に使用できる HuCard ROM が無かったため未実施
- Phase 4 の GUI 操作項目のうち、新規作成、両テンプレート作成、オープン、ビルド dryRun、Test Play のフル手動巡回は未完了
- Geargrafx MCP での VDC / VRAM / SATB 確認は、描画崩れ修正ではないため実施対象外

## 削除したファイル

Phase 2 (`60ba2e3`):

- `block-stage-exporter.js`
- `stage-data-manager.js`
- `tests/asset-checker-plugin.test.js`
- `tests/block-plugins.test.js`
- `tests/dungeon-plugins.test.js`
- `tests/md-bgm-composer.test.js`
- `tests/midi-converter.test.js`
- `tests/plugin-renderer-utils.test.js`
- `tests/rhythm-plugins.test.js`
- `tests/slideshow-plugin.test.js`
- `tests/tilemap-editor.test.js`
- `tests/vgm-preview-player.test.js`

Phase 4 (`3e30630`):

- `build-system.js`
- `tests/build-system.test.js`
- `tests/core-manager.test.js`

参照確認は `rg` で実施しました。なお `renderer/renderer.js` には `vgm-preview-player` capability 文字列が残っていますが、これは任意 capability lookup であり、削除した test file の require 参照ではありません。

## Stop-and-Ask 項目

### D7: `api:startServer`

現状:

- `main.js` の `resolveApiLaunch()` は開発時に `cargo run -p md-api`、packaged 時に `plugins/standard-api-emulator/bin/md-api` を起動します
- `standard-api-emulator` plugin はこの PCE リポジトリに存在しません
- IPC `api:startServer` / `api:stopServer` / `api:isRunning` と preload API は残っています

選択肢:

1. 削除する
   - `api:*` IPC、preload の API testplay surface、関連 stale tests / UI entry を削除します
   - PCE に存在しない md-api 経路を完全に消せます
   - 既存外部利用者がいた場合は breaking change になります
2. PCE 用 API サーバーとして再設計する
   - md-api 互換ではなく、PCE build/Test Play/asset preview 向けの明示的な API として作り直します
   - `api:startServer` の名前を維持するか、PCE 名へ breaking rename するかの判断が必要です
   - 新規設計・新規テストが必要で、このリファクタリングの範囲を超えます

推奨:

- PCE 代替仕様が無い現時点では削除を推奨します。必要になったら AI Control の REST/MCP と責務が重ならない PCE API として別設計する方が安全です。

### Phase 7: `export_html`

現状:

- `handleExportHtml()` は `plugins/standard-emulator/pkg/md_wasm.js`、`md_wasm_bg.wasm`、`wasm-player.js` を前提にした MD 用 single-file export です
- `editor-control-service.js` の `export_html` tool と IPC `export:html` は残す必要があります
- `plugins/standard-emulator/` と `wasm-player.js` は Phase 7 完了まで旧 export の依存として残っています

設計案:

- PCE HTML export は EmulatorJS ベースの export directory 方式にします
- `index.html`、PCE 用 EmulatorJS runtime files、HuCard ROM または CD-ROM2 testplay zip を同じディレクトリに配置します
- HuCard export は System Card 不要なので、まず HuCard ROM でブラウザ起動確認を行います
- CD-ROM2 export は System Card を同梱しません。ユーザー所有ファイルとして別途指定する UI / 取り扱いが必要です
- 完全 single-file HTML は初期実装では避けます。EmulatorJS runtime、WASM、CD image、音声 track、System Card の配布境界が重く、ライセンスとユーザー所有ファイルの扱いが曖昧になるためです

承認後の作業:

1. `handleExportHtml()` を PCE EmulatorJS export directory 生成へ置換
2. IPC `export:html` と AI Control tool `export_html` は維持
3. `tests/export-html.test.js` を新仕様に更新
4. HuCard ROM でブラウザ起動確認
5. 旧依存 `plugins/standard-emulator/` / `wasm-player.js` / MD wasm assets を削除

## Phase 8 提案

### `renderer/renderer.js` 分割

根拠:

- 現在 8,896 行、関数相当の定義が約 445 個あります
- plugin host、sidebar state、build log、asset UI、audio conversion、AI Control UI が単一ファイルに混在しています

提案:

- `renderer/core/`: API wrapper、state key migration、plugin capability lookup
- `renderer/plugins/`: sidebar / plugin host / tab activation
- `renderer/assets/`: asset list、preview、import、reorder
- `renderer/audio/`: audio conversion UI と preview player
- `renderer/build/`: build log、export、Test Play launch
- `renderer/ai-control/`: AI Control panel と operation logs

移行手順:

1. DOM id と `window.electronAPI` 呼び出しを変えず、純粋 helper から移動
2. sidebar/plugin migration 周りは既存 tests に migration case を追加してから移動
3. 画面単位で 1 module ずつ import 化し、最後に `renderer.js` を bootstrap のみに縮小

リスク:

- 保存済み sidebar order / panel width / plugin state key を壊すと既存プロジェクトの見た目が崩れます
- plugin capability の呼び出し順が変わると hidden compatibility plugin の表示に影響します

### `main.js` IPC 分割

根拠:

- 現在 3,342 行で、`ipcMain.handle` が 90 個以上あります
- API server、AI Control、Test Play、setup、project、asset、export、plugin hook が同居しています
- `setup-manager.js` と `rescomp-manager.js` は `main.js` から直接 require されており、D1 の「core-manager 経由のみ」という前提と矛盾しています

提案:

- `main/ipc/project-ipc.js`
- `main/ipc/codefs-ipc.js`
- `main/ipc/assets-ipc.js`
- `main/ipc/plugins-ipc.js`
- `main/ipc/testplay-ipc.js`
- `main/ipc/setup-ipc.js`
- `main/ipc/export-ipc.js`
- `main/ipc/ai-control-ipc.js`

移行手順:

1. `main.js` の状態変数を小さな dependency object として渡す register 関数を作る
2. 先に AI Control / Test Play のようにテストがある領域から抽出
3. `setup-manager.js` / `rescomp-manager.js` を削除する前に、PCE で必要な機能を `pce-setup-manager.js` / `pce-asset-manager.js` / 新規 PCE resource manager へ移すか、UI/API ごと削除判断する

リスク:

- Electron window lifecycle と IPC lifecycle が絡むため、登録順序や close handler の副作用が出やすいです
- path safety の境界が分散しないよう、`pce-file-safety.js` を唯一の file path validation entry にする必要があります

### `catch (_) {}` 方針

根拠:

- `main.js`、`renderer/renderer.js`、`pce-asset-manager.js`、`pce-vn-manager.js` に複数の握り潰しがあります
- すべてを一括変更すると、復旧可能な best-effort 処理まで noisy になります

提案:

- 許可する握り潰しは、UI cleanup、window close、temp file cleanup、optional state read のみに限定します
- それ以外は `debug` / operation log / build log のいずれかへ出します
- 触ったコードパスだけで方針を適用し、横断的な置換は行いません

リスク:

- ログを増やしすぎると renderer と AI Control の operation log が読みづらくなります
- 例外を再 throw すると既存の best-effort 起動復旧が壊れる可能性があります

### `pce-asset-manager.js` 分割

根拠:

- 現在 2,329 行で、asset document I/O、image decode、PCE 画像変換、ADPCM/CDDA import、CD data file metadata、C source generation が同居しています

提案:

- `pce-assets/document.js`: schema normalize、load/save、legacy migration
- `pce-assets/image-import.js`: image decode、palette、BG/sprite conversion
- `pce-assets/audio-import.js`: WAV/ADPCM/CDDA import
- `pce-assets/source-generation.js`: generated C / headers
- `pce-assets/cd-data.js`: `cd.dataFiles` と sector metadata

移行手順:

1. 生成物を変えない helper extraction のみから始める
2. `tests/pce-asset-manager.test.js` の既存 fixture を binary/string snapshot として強化
3. ADPCM rate code、encoderVersion、CD data file 配置は絶対に同時変更しない

リスク:

- 生成 C / binary metadata が変わると VN runtime と CD-ROM2 memory bank へ波及します
- path safety と source WAV 再生成条件を移動時に落とすと、古い ADPCM ノイズ再発につながります

### `pce-vn-manager.js` 分割

根拠:

- 現在 2,058 行で、scene schema normalize、legacy command 読み替え、font encode、scene pack、source generation が同居しています

提案:

- `pce-vn/schema.js`: scene / command normalize、legacy migration
- `pce-vn/font.js`: font asset、glyph encode、tile output
- `pce-vn/scene-pack.js`: binary pack format、size validation
- `pce-vn/source-generation.js`: generated C / metadata

移行手順:

1. `normalizeLegacy*` を外へ出す前に tests を scene command 種別ごとに追加
2. 4096 byte scene cache 制限、bank129 / bank132 配置、CD data file ordering の tests を維持
3. runtime template と generated source を同時変更しない

リスク:

- legacy VN scene の読み込み互換性を壊す可能性があります
- scene pack ordering や bank metadata の微差が CD-ROM2 runtime の表示や音声に影響します

## Breaking Change

Phase 6 は承認済みの breaking change です。外部ツール設定は以下へ更新が必要です。

- resource URI: `md-editor://...` から `pce-editor://...`
- env: `MD_EDITOR_CONTROL_URL` / `MD_EDITOR_CONTROL_TOKEN` から `PCE_EDITOR_CONTROL_URL` / `PCE_EDITOR_CONTROL_TOKEN`
- MCP sidecar: `scripts/md-game-editor-mcp.js` から `scripts/pce-game-editor-mcp.js`
- optional token header: `X-MD-Editor-Token` から `X-PCE-Editor-Token`

## 現時点の結論

Phase 1 から Phase 6 までは実装・コミット済みです。Phase 7 は設計承認待ち、D7 は削除または再設計の人間判断待ちです。Phase 8 は本レポートで提案に留め、実装していません。
