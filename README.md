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

Novel画面の `Godot出力` は、組み込みプラグイン **NVプロジェクトのGodotエクスポート** が有効な場合だけ表示され、CD-ROM2 / HuCARD VNのどちらでも利用できます。現行Scene JSON、参照中の画像・プレビュー可能音声・PSG metadata、任意のproject fontを、Godotネイティブプレイヤー用の `*.pcevn.zip` へまとめます。BG/Spriteは、import時に保持したPCE減色前の高画質PNGと、最終`palette.bin` / tile / pattern / cell mapから再構成したPCE相当PNGを同じasset IDの`hd` / `pce`として二系統収録します。旧assetで減色前PNGがない場合は現行sourceをHD側へ使い、件数をmanifestと出力ログへ残します。参照中のCD-DA/ADPCM再生用WAVは出力時にOgg Vorbis（VBR quality 4）へ圧縮し、既存のOGG/MP3は再エンコードしません。Godot Playerのワイド画面枠は配布側の`package/library.json`にあるトップレベル`border`で指定し、シナリオZIPには同梱しません。package v3の詳細とGodot runtimeのワンボタン切替契約は [Godot VN package exporter](docs/pce-vn-godot-exporter.md) を参照してください。これはROM/CUE/ISOのExportとは独立しており、System Card、IPL、EmulatorJS、実機向けraw binaryは含めません。v3の`hd` / `pce`両対応packageでは、HD本文は配布側`package/library.json`の`font`、PCE本文は`entrypoints.font`の選択project fontを使います。`library.json.font`が未指定または読込不能なら同梱Noto Sans JPへfallbackし、旧version 1／2 packageは従来どおりproject fontを本文全体で使います。

Novel画面の `GB Studio出力` は、組み込みプラグイン **PCE VN GB Studio出力** が有効な場合だけ表示されます。v1.4.0はPCE VN v2のBG、本文、2～4択、scene/label分岐、signed変数・IF/Switch/GOTO/Input/random、PSG BGMに加え、`sprite` / `spritemove` / `spritetext` / fade / flash / blank / shakeを、GB Studio 4.3.1/4.3.2・engine `4.3.0-e1`用のgenerator-owned projectへ変換します。出力は起動時にGBC/DMG用scene graphを選ぶ`Color + Monochrome`単一ROMです。

立ち絵はproject全体で、既定の「背景焼き込み」または最大2人の「sprite actor」を選びます。背景modeは論理4slot、重なり、sync/async移動、animation、SpriteTextをvisual timelineへ合成し、actor modeは40×48 bust、A/B枠循環、flip、animation、公式actor移動eventを使います。SpriteTextはGB Studio内部のscene分割では維持しますが、別のPCE元sceneへの遷移と同じ元sceneへの明示jump/choice再入場では全slotを消去します。タイトル／シナリオ選択sceneでは文字色を黒へ正規化し、「← シナリオ選択 →」へ変換後8pxの上余白を加えます。SpriteText内容・座標・色と立ち絵の最終状態は省略不可です。OBJ/走査線/tile、keyframe削減、非原子的tile更新、時間・色近似、属性省略は`build/qa/visual-audit.json`へ記録し、errorまたは明示確認gateにします。native Cやengine overrideは生成しません。

export modalではMisaki Gothic 8x8を既定fontとし、`BGM調整`、`画像調整`、`立ち絵調整`からA/B preview、crop、scale、offset、色補正、GBC/DMG別ditherを編集できます。previewと正式exportは同じ変換coreを使い、sidecar format v1へ成功時だけ保存します。全source commandの処理区分とGBC/DMG event IDは`control-flow-audit.json`、visualのasset/timeline/hashは`visual-audit.json`へ保存します。`生成＋公式build`ではGB Studio本体の通常Export経路でROM/Webを作り、warning 0、ROM/Web hash一致、CGB flag `0x80`を検査します。詳細とPhase 4～6は[GB Studio exporter仕様](docs/pce-vn-gb-studio-exporter.md)を参照してください。
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
