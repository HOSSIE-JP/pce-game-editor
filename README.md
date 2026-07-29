# PCE Game Editor

Electron ベースの PC Engine / Super CD-ROM2 向けゲームエディターです。
このリポジトリでは PC Engine core、PCE asset pipeline、HuCard / CD-ROM2 build、Test Play、PCE 用プラグインを管理します。

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

アプリ内の `SetUp` 画面では、PCE 向けの `llvm-mos-sdk`、EmulatorJS runtime、PCE-CD IPL / System Card を設定できます。Windows 標準の `tar.exe`、Windows PowerShell / System.Drawing は内部実装として使いますが、ユーザーが追加導入する依存ではないため成功行を表示しません。機能ごとの必須・任意要件と取得経路は[公開時の外部依存・ライセンス監査](docs/release-dependencies-and-licenses.md)を参照してください。

CD-ROM2 VNは日本版Super System Card 3.0 profile `jp-v3`専用です。HuC6280 PSGはSystem Cardのmain/sub track driverをVSync IRQで駆動し、本文とSpriteTextは`EX_GETFNT`のJIS第一水準glyphを必要時に使います。BIOS、PSG driver、抽出glyphはゲーム生成物へ含めません。CD VNのPSG/font/scene/bank契約は[System Card BIOS設計](docs/pce-vn-engine-redesign.md)を参照してください。

大規模CD-ROM2 VNでは、同一ビルドから参照できる正式上限をADPCM 2048件、BG 1024件、Sprite 1024件、Sprite Animation合計1024件、System Card PSG package variant 512件、CD-DA 98本とします。PSG variantは`assetId`と再生channelの組ごとに1件で、参照PSG source asset自体も512件までです。これはディスク容量、1 assetのサイズ、同時描画・再生数とは別のcatalog上限です。scene pack、BG/Sprite/ADPCM payload、CD on-demand metadata、System Card PSG packageは2048-byte境界で`assets/generated/vn/vn_payload.bin`へ集約し、論理ファイルのsector aliasで参照します。CD-DA音声trackはpack対象外です。4つのruntime code blob（render overlay、logic overlay、visual helper、async/runtime support）はlink後に抽出するため独立した物理CD fileのままです。詳細は[CD-ROM2 VN大規模プロジェクト上限](docs/pce-vn-large-project-limits.md)を参照してください。

`Export` は HuCard project 専用です。`.pce`、または itch.io の HTML5 upload 用 ZIP（ルートの `index.html`、HuCard ROM、EmulatorJS runtime/core、両コンポーネントのGPL本文）を出力できます。CD-ROM2 project は System Card / IPL を必要とする配布境界を避けるため Export の対象外です。ZIP を再配布する場合は、EmulatorJS/core の GPL 条件に従って、正確に対応する完全なソースとライセンス表示も提供してください。

Novel画面の `Godot出力` は、CD-ROM2 / HuCARD VNのどちらでも利用できます。現行Scene JSON、参照中の元画像・プレビュー可能音声・PSG metadata、任意のproject fontを、Godotネイティブプレイヤー用の `*.pcevn.zip` へまとめます。`assets/images/player-border.png`がある場合は、未参照画像でもワイド画面枠として`presentation/player-border.png`へ自動同梱します。これはROM/CUE/ISOのExportとは独立しており、System Card、IPL、EmulatorJS、実機向け変換済みbinaryは含めません。

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
- [公開時の外部依存・ライセンス監査](docs/release-dependencies-and-licenses.md): 利用機能別の外部前提、取得経路、アプリ同梱依存、公開前チェック。
- [CD VN System Card BIOS Design](docs/pce-vn-engine-redesign.md): IRQ、PSG package、Shift-JIS scene/font契約。
- [CD VN Memory Strategy](docs/pce-memory-bank-strategy.md): bank123/128-135とlink-map gate。
- [CD-ROM2 VN Large Project Limits](docs/pce-vn-large-project-limits.md): 大規模catalogの正式上限、payload pack、個別制約。
- [Implementation Audit (2026-07-10)](docs/implementation-audit-2026-07-10.md): 実装と文書の照合結果、残存互換層、潜在課題、次の作業計画。

`refactor-instructions*.md`、`docs/refactor-report.md`、`docs/tasks/`、`*-handoff.md`、`*-phase*.md` は、その時点の作業指示・調査結果・移行記録です。現行仕様の入口にはせず、記述が競合する場合は現行コード、上記の利用者/開発者向け文書、`AGENTS.md` の順に確認してください。

## 注意

PCE-CD の IPL / System Card、EmulatorJS runtime、llvm-mos-sdk などの外部バイナリは同梱しません。Setup 画面からユーザー所有ファイル、ユーザー操作によるダウンロード、または手動パス指定として設定してください。

PCE Game Editor本体はCopyright (c) 2026 HOSSIEの[MIT License](LICENSE)で配布します。アプリ配布物には本体`LICENSE`、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)、[`licenses/`](licenses/)を同梱し、Aboutから参照できます。Electron が生成する `LICENSE.electron.txt` / `LICENSES.chromium.html` も削除しないでください。

MIT LicenseはPCE Game Editor自身のコードと、HOSSIEがMITで配布する権利を持つ同梱物に適用されます。EmulatorJS/core、llvm-mos-sdk、Electron等の第三者コンポーネント、ユーザー所有のIPL/System Card、ユーザーが取り込んだ素材には、それぞれの権利・ライセンスが引き続き適用されます。
