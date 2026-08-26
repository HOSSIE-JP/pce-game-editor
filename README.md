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

大規模CD-ROM2 VNでは、同一ビルドから参照できる正式上限をADPCM 2048件、BG 1024件、Sprite 1024件、Sprite Animation合計1024件、System Card PSG package variant 512件、ゲーム用CD-DA 97本（Track 3〜99）とします。PSG variantは`assetId`と再生channelの組ごとに1件で、参照PSG source asset自体も512件までです。これはディスク容量、1 assetのサイズ、同時描画・再生数とは別のcatalog上限です。scene pack、BG/Sprite/ADPCM payload、CD on-demand metadata、System Card PSG packageは2048-byte境界で`assets/generated/vn/vn_payload.bin`へ集約し、論理ファイルのsector aliasで参照します。CD-DA音声trackはpack対象外です。4つのruntime code blob（render overlay、logic overlay、visual helper、async/runtime support）はlink後に抽出するため独立した物理CD fileのままです。詳細は[CD-ROM2 VN大規模プロジェクト上限](docs/pce-vn-large-project-limits.md)を参照してください。

CD-ROM2出力は市販ソフトと同じ基本構造に固定しています。Track 1は必須の警告音声、Track 2は`MODE1/2048`のゲームデータ（`PREGAP 00:03:00`）、Track 3以降はゲーム用CD-DAで、Track 3だけに`PREGAP 00:02:00`を置きます。警告音声はSound > CD-DAでユーザーが設定し、標準音声は同梱しません。未設定、ゲーム音声がTrack 2始まり、重複・欠番がある場合は具体的な修正案を表示してビルドを停止します。旧projectは自動移行せず、同画面の「Track 3から再採番」を明示的に実行してください。

`Export` は HuCard project 専用です。`.pce`、または itch.io の HTML5 upload 用 ZIP（ルートの `index.html`、HuCard ROM、EmulatorJS runtime/core、両コンポーネントのGPL本文）を出力できます。CD-ROM2 project は System Card / IPL を必要とする配布境界を避けるため Export の対象外です。ZIP を再配布する場合は、EmulatorJS/core の GPL 条件に従って、正確に対応する完全なソースとライセンス表示も提供してください。

Novel画面の `Godot出力` は、組み込みプラグイン **NVプロジェクトのGodotエクスポート** が有効な場合だけ表示され、CD-ROM2 / HuCARD VNのどちらでも利用できます。現行Scene JSON、参照中の画像・プレビュー可能音声・PSG metadata、任意のproject fontを、Godotネイティブプレイヤー用の `*.pcevn.zip` へまとめます。BG/Spriteは、import時に保持したPCE減色前の高画質PNGと、最終`palette.bin` / tile / pattern / cell mapから再構成したPCE相当PNGを同じasset IDの`hd` / `pce`として二系統収録します。旧assetで減色前PNGがない場合は現行sourceをHD側へ使い、件数をmanifestと出力ログへ残します。参照中のCD-DA/ADPCM再生用WAVは出力時にOgg Vorbis（VBR quality 4）へ圧縮し、既存のOGG/MP3は再エンコードしません。Godot Playerのワイド画面枠は配布側の`package/library.json`にあるトップレベル`border`で指定し、シナリオZIPには同梱しません。package v3の詳細とGodot runtimeのワンボタン切替契約は [Godot VN package exporter](docs/pce-vn-godot-exporter.md) を参照してください。これはROM/CUE/ISOのExportとは独立しており、System Card、IPL、EmulatorJS、実機向けraw binaryは含めません。

Novel画面の `GB Studio出力` は、組み込みプラグイン **PCE VN GB Studio出力** が有効な場合だけ表示されます。PCE VN v2のBG、本文、2～4択、scene/label分岐、signed変数・IF/Switch/GOTO/Input/random、PSG BGMを、GB Studio 4.3.1/4.3.2・engine `4.3.0-e1`用のgenerator-owned projectへ変換します。出力は起動時にGBC/DMG用scene graphを選ぶ`Color + Monochrome`単一ROMです。2～4択とrandomを使うprojectだけへproject-local Script Event Plugin `pce-vn-control`を生成し、長い選択肢を16セル単位で欠落なく折り返し、`defaultIndex`とBキャンセル無効を再現します。GBC背景は最大7 palette・tileごと最大4色、DMG背景は固定4色・最大192 unique tileへ変換します。v1.3.0ではPCEの持続背景をCFG上で伝播し、背景なし分岐sceneへ継承します。異なる背景が同じblockへ合流する場合は背景状態をstable IDへ含めてsceneを特殊化します。既定fontは組み込みMisaki Gothic 8x8で、BDF/TTF/OTF/TTCも選択できます。font pageはGB Studio compilerが読むPNG隣接mapping JSONを含めて生成・検査します。全source commandの処理区分、到達性、背景entry/effective状態、GBC/DMG event IDは`build/qa/control-flow-audit.json`へ保存され、本文・分岐・状態・BGMの欠落や未分類commandがあれば生成を止めます。MessageのframeはGB Studio標準eventで再設定し、scenario selectorは非ブロッキングinput callbackで待機します。GB Studio exeの選択値はproject設定へ保存して次回再利用し、環境変更で保存済みpathが消えた場合はpreflight errorを表示します。export modalの`BGM調整`では6ch自動割当と曲別target/instrument/volume/transpose/priority/tempoをWebAudio A/B近似再生で調整でき、`画像調整`ではasset別brightness/saturationとGBC/DMG独立ditherを原画/変換後previewで調整できます。previewと正式exportは同じ変換coreを使い、設定は正式export成功時だけsidecarへ保存します。Phase 3の立ち絵・sprite移動・flash等は凍結中で、列挙された視覚装飾だけ確認後に省略できます。CD-DAは登録済みPSG曲または4ch ProTracker MODへの明示mappingが必要です。`生成＋公式build`ではGB Studio本体の通常Export経路でROMとWebを作り、warningとROMのmixed-mode headerも検査します。詳細と将来Phaseは[GB Studio exporter仕様](docs/pce-vn-gb-studio-exporter.md)を参照してください。
2～4択の折返し後label合計が画面上限16行を超える場合は、欠落や画面外表示にせずpreflight errorで停止します。

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
- [PCE VN GB Studio Exporter](docs/pce-vn-gb-studio-exporter.md): GB/GBC mixed ROM変換、制約、CLI、監査、将来Phase。
- [Implementation Audit (2026-07-10)](docs/implementation-audit-2026-07-10.md): 実装と文書の照合結果、残存互換層、潜在課題、次の作業計画。

`refactor-instructions*.md`、`docs/refactor-report.md`、`docs/tasks/`、`*-handoff.md`、`*-phase*.md` は、その時点の作業指示・調査結果・移行記録です。現行仕様の入口にはせず、記述が競合する場合は現行コード、上記の利用者/開発者向け文書、`AGENTS.md` の順に確認してください。

## 注意

PCE-CD の IPL / System Card、EmulatorJS runtime、llvm-mos-sdk などの外部バイナリは同梱しません。Setup 画面からユーザー所有ファイル、ユーザー操作によるダウンロード、または手動パス指定として設定してください。

PCE Game Editor本体はCopyright (c) 2026 HOSSIEの[MIT License](LICENSE)で配布します。アプリ配布物には本体`LICENSE`、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)、[`licenses/`](licenses/)を同梱し、Aboutから参照できます。Electron が生成する `LICENSE.electron.txt` / `LICENSES.chromium.html` も削除しないでください。

MIT LicenseはPCE Game Editor自身のコードと、HOSSIEがMITで配布する権利を持つ同梱物に適用されます。EmulatorJS/core、llvm-mos-sdk、Electron等の第三者コンポーネント、ユーザー所有のIPL/System Card、ユーザーが取り込んだ素材には、それぞれの権利・ライセンスが引き続き適用されます。
