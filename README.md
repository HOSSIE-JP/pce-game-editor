# PCE Game Editor

Electron ベースの PC Engine / Super CD-ROM2 向けゲームエディターです。

このリポジトリは `md_emulator/pce-game-editor` から分離した PCE 専用版です。Mega Drive / SGDK 側の作業は元の `md-game-editor` 側で扱い、このリポジトリでは PC Engine core、PCE asset pipeline、HuCard / CD-ROM2 build、Test Play、PCE 用プラグインを管理します。

## 構成

```text
pce-game-editor/
├── .agents/skills/
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

## Codex共有スキル

PCE PSG作曲用の`compose-pce-psg`スキルを[`.agents/skills/compose-pce-psg`](.agents/skills/compose-pce-psg/SKILL.md)へ同梱しています。このリポジトリ内でCodexを起動するとプロジェクトスキルとして検出され、個人のskillsディレクトリへコピーする必要はありません。表示されない場合はCodexを再起動してください。

プロンプトで`$compose-pce-psg`を指定し、用途、雰囲気、テンポ、長さと構成、ループ有無を伝えると、PCE Game Editorへ取り込める`*.psg.json`を1ファイル生成します。ROM/CUE生成、プロジェクトへの組み込み、エミュレーターまたは実機での確認はスキルの対象外です。

## 起動

```sh
npm start
```

`.portable` がある開発時は、ユーザーデータは `data/` 配下に作られます。`data/`、`node_modules/`、`dist/`、toolchain ダウンロード物はリポジトリ管理対象外です。

アプリ内の `SetUp` 画面では、PCE 向けの `llvm-mos-sdk`、EmulatorJS runtime、PCE-CD IPL / System Card を設定できます。ZIP / 7z 展開コマンドや VN フォント描画 renderer も診断表示されるため、別ユーザーへ配布する前にこの画面で不足を確認してください。

CD-ROM2 VNは日本版Super System Card 3.0 profile `jp-v3`専用です。HuC6280 PSGはSystem Cardのmain/sub track driverをVSync IRQで駆動し、本文とSpriteTextは`EX_GETFNT`のJIS第一水準glyphを必要時に使います。BIOS、PSG driver、抽出glyphはゲーム生成物へ含めません。CD VNのPSG/font/scene/bank契約は[System Card BIOS設計](docs/pce-vn-engine-redesign.md)を参照してください。

`Export` は HuCard project 専用です。`.pce`、または itch.io の HTML5 upload 用 ZIP（ルートの `index.html`、HuCard ROM、EmulatorJS runtime/core、ライセンス表示）を出力できます。CD-ROM2 project は System Card / IPL を必要とする配布境界を避けるため Export の対象外です。ZIP を再配布する場合は、EmulatorJS/core の GPL 条件に従って、正確に対応する完全なソースとライセンス表示も提供してください。

Novel画面の `Godot出力` は、CD-ROM2 / HuCARD VNのどちらでも利用できます。現行Scene JSON、参照中の元画像・プレビュー可能音声・PSG metadata、任意のproject fontを、Godotネイティブプレイヤー用の `*.pcevn.zip` へまとめます。これはROM/CUE/ISOのExportとは独立しており、System Card、IPL、EmulatorJS、実機向け変換済みbinaryは含めません。

## テスト

```sh
npm test
```

PCE 関連の基本回帰テストは `tests/run-tests.js` から実行されます。AI Control の REST/MCP 境界、plugin manager、packaging、PCE asset/build/Test Play/VN まわりのテストを含みます。

## ドキュメント

- [User Guide](docs/user-guide.md): Setup、Build、標準/外部エミュレーター Test Play の使い方。
- [PLUGIN.md](PLUGIN.md): plugin manifest、hook、capability、PCE 内蔵 plugin の開発仕様。
- [PCE Test Play Debugging](docs/pce-testplay-debugging.md): Geargrafx MCP / EmulatorJS を使った Test Play 調査手順。
- [PCE Media Programming Guide](docs/pce-media-programming-guide.md): 画像、スプライト、System Card PSG/font、ADPCM、CD-DA の実装ガイド。
- [CD VN System Card BIOS Design](docs/pce-vn-engine-redesign.md): IRQ、PSG package、Shift-JIS scene/font契約。
- [CD VN Memory Strategy](docs/pce-memory-bank-strategy.md): bank123/128-135とlink-map gate。
- [Implementation Audit (2026-07-10)](docs/implementation-audit-2026-07-10.md): 実装と文書の照合結果、残存互換層、潜在課題、次の作業計画。

`refactor-instructions*.md`、`docs/refactor-report.md`、`docs/tasks/`、`*-handoff.md`、`*-phase*.md` は、その時点の作業指示・調査結果・移行記録です。現行仕様の入口にはせず、記述が競合する場合は現行コード、上記の利用者/開発者向け文書、`AGENTS.md` の順に確認してください。

## 共有コード

共有アプリ基盤は `game-editor-common.js` として本体に取り込み、独自にメンテナンスします（外部パッケージ参照はありません）。このモジュールは特定ハードウェアの知識を持たず、PCE 固有の移行処理は `pce-project-migration.js` に置きます。

## 注意

PCE-CD の IPL / System Card、EmulatorJS runtime、llvm-mos-sdk などの外部バイナリは同梱しません。Setup 画面からユーザー所有ファイル、ユーザー操作によるダウンロード、または手動パス指定として設定してください。
