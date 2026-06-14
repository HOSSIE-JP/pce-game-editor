# PCE Game Editor

Electron ベースの PC Engine / Super CD-ROM2 向けゲームエディターです。

このリポジトリは `md_emulator/pce-game-editor` から分離した PCE 専用版です。Mega Drive / SGDK 側の作業は元の `md-game-editor` 側で扱い、このリポジトリでは PC Engine core、PCE asset pipeline、HuCard / CD-ROM2 build、Test Play、PCE 用プラグインを管理します。

## 構成

```text
pce-game-editor/
├── app.config.js
├── main.js
├── pce-*.js
├── plugins/
├── renderer/
├── scripts/
├── template/
└── tests/
```

## セットアップ

```sh
npm install
```

## 起動

```sh
npm start
```

`.portable` がある開発時は、ユーザーデータは `data/` 配下に作られます。`data/`、`node_modules/`、`dist/`、toolchain ダウンロード物はリポジトリ管理対象外です。

## テスト

```sh
npm test
```

PCE 関連の基本回帰テストは `tests/run-tests.js` から実行されます。AI Control の REST/MCP 境界、plugin manager、packaging、PCE asset/build/Test Play/VN まわりのテストを含みます。

## ドキュメント

- [User Guide](docs/user-guide.md): Setup、Build、標準/外部エミュレーター Test Play の使い方。
- [PLUGIN.md](PLUGIN.md): plugin manifest、hook、capability、PCE 内蔵 plugin の開発仕様。
- [PCE Test Play Debugging](docs/pce-testplay-debugging.md): Geargrafx MCP / EmulatorJS を使った Test Play 調査手順。
- [PCE Media Programming Guide](docs/pce-media-programming-guide.md): 画像、スプライト、ADPCM、CD-DA の実装ガイド。

## 共有コード

共有アプリ基盤は `game-editor-common.js` として本体に取り込み、独自にメンテナンスします（外部パッケージ参照はありません）。このモジュールは特定ハードウェアの知識を持たず、PCE 固有の移行処理は `pce-project-migration.js` に置きます。

## 注意

PCE-CD の IPL / System Card、EmulatorJS runtime、llvm-mos-sdk などの外部バイナリは同梱しません。Setup 画面からユーザー所有ファイルまたはユーザー操作によるダウンロードとして設定してください。
