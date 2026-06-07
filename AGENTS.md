# Codex 向け指示

このリポジトリは PC Engine / Super CD-ROM2 専用の `pce-game-editor` です。

## 最初に読むもの

- PCE プラグイン、アセット、ビルド、Test Play を変更する前に `PLUGIN.md` を読んでください。
- Test Play や実機/エミュレーター表示崩れを調査する前に `docs/pce-testplay-debugging.md` を読んでください。
- 公開 API、プラグイン manifest、IPC、ビルド仕様を変更する場合は、同じ作業内で `PLUGIN.md` または `docs/` 配下の関連ファイルを更新してください。
- 外部リポジトリからコードをコピーしないでください。外部情報は挙動理解だけに使い、実装は独自に行ってください。

## 現在の運用

- PCE 固有の実装は `pce-*.js`、`plugins/pce-*`、`plugins/pc-engine-core`、`template/template_pce_*` を優先して確認してください。
- 共有ユーティリティは隣接リポジトリ `/Users/hossie/development/game-editor-common` にあります。
- PCE 固有のプロジェクト移行処理は `pce-project-migration.js` に置き、共通ライブラリへ戻さないでください。
- 画像アセットは内蔵 PCE 変換を使い、Superfamiconv には依存しません。
- CD-ROM2 は `targetMedia: "cd"` と `toolchain: "llvm-mos"` を前提に扱います。IPL / System Card はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。
- PCE の描画崩れ、VRAM/SATB/VDC レジスタ調査、Test Play の実画面デバッグでは、利用可能なら Geargrafx MCP を優先して使ってください。
- Electron renderer、preload、main process の責務を分離してください。
- ファイルシステム IPC はプロジェクトルート内に限定し、パストラバーサルを拒否してください。

## 回帰テスト

- コードを変更した後は、編集範囲に対応する最小限のテストを実行してください。
- PCE 全体の基本確認は `npm test` です。
- テストを実行できない場合は、その理由と残るリスクを最終回答に書いてください。

## コミットメッセージ

Codex がこのリポジトリでコミットを作成する場合、コミットメッセージは日本語で書いてください。
