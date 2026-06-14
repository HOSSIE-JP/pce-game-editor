# PCE Game Editor User Guide

このガイドは、PCE Game Editor で PC Engine / Super CD-ROM2 project を作成、ビルド、Test Play するユーザー向けのメモです。

## セットアップ

`SetUp` 画面で、使用する機能に応じて次の外部ファイルを設定します。

- `llvm-mos-sdk`: HuCard / CD-ROM2 のビルドに使います。
- IPL / System Card: Super CD-ROM2 のビルドや Test Play に使います。ユーザー所有ファイルとして扱い、リポジトリには同梱しません。
- EmulatorJS runtime: 標準エミュレーターで Test Play する場合に使います。

## 新規プロジェクト

プロジェクト選択画面の `新規プロジェクト` では、作成場所、プロジェクトフォルダ名、ゲームタイプを指定します。PCE project は PC Engine 専用として扱うため、対象コアの選択は表示しません。

Mega Drive ROM ヘッダー向けだったタイトル、作者名、シリアルの入力は PCE 新規作成では使用しません。作成直後の内部表示名はプロジェクトフォルダ名から初期化されます。

Settings の `プロジェクト表示名` は、アプリ内表示とエクスポート候補名のための project metadata です。PCE ROM ヘッダー情報ではないため、作者名やシリアルの編集欄は表示しません。

## Image / Sprites

`Image` の `BG` では PCE 背景画像を、`Sprites` では PCE sprite sheet を編集します。画像の `Palette bank`、出力幅/高さ、`Transparent index` は import 時に決める変換条件です。変換後に生成済み tile / pattern と metadata がずれないよう、詳細フォームでは直接編集しません。

`Sprites` は sprite asset tree、Frame Preview、Sprite Sheet、Animation Rows、Properties を持つ編集画面です。フレーム幅・高さと ROW ごとの有効 frame 数 / time を編集すると、PCE VN runtime が参照する `options.animations` と、エディタ再表示用の `options.spriteEditor` metadata に保存されます。

## Novel（スクリプト編集）

`Novel` プラグインの `スクリプト` タブは VN シーンをコマンド単位で編集します。中央のコマンド一覧では、各コマンド行の右側にアイコンボタンが並びます。

- **コピー（⧉）**: 選択中のコマンドをクリップボードに複製します。
- **前にペースト（⤒）/ 後にペースト（⤓）**: コピーしたコマンドをその行の前 / 後ろに挿入します。クリップボードが空のときは無効です。
- **削除（×）**: その行を削除します。

右列のプレビューは、`BG` / `Sprite` などの画像系コマンドを選ぶと **320×224 のゲーム画面**として表示し、その時点までの背景・立ち絵の配置（背景は tile 座標、立ち絵はピクセル座標）を実際のレイアウトで確認できます。選択中コマンドが置いた要素は枠線でハイライトされます。

シーン編集画面右上の **▶ プレビュー** ボタンで、表示中のシーンを起点に疑似ゲーム画面を別ウィンドウで再生できます。プレビュー画面にはメニューバーがなく、クリック / Enter でメッセージ送り、選択肢は上下キーまたはクリックで決定、Esc で閉じます。背景・立ち絵・メッセージ・選択肢・変数・分岐（IF / Switch / GOTO / Label / Jump）・Wait・音声・演出を簡易再生します。

## Build

`Build` は現在の project 設定と有効な builder plugin を使って ROM / CUE を生成します。Super CD-ROM2 project では `.cue` と `.iso`、必要に応じて CD-DA track WAV や Test Play 用 zip が `out/` に作られます。

## Test Play

Test Play は Plugins 画面の `Test Play` role で選択した plugin が担当します。

### 標準エミュレーター

`標準エミュレーター (EmulatorJS)` は、Setup 済みの EmulatorJS `mednafen_pce` core でエディター内の Test Play window を開きます。HuCard と Super CD-ROM2 の通常確認に使えます。

Super CD-ROM2 / ADPCM を含む project では、Geargrafx などの外部エミュレーターでは正常でも、標準 EmulatorJS/WASM 側だけ ADPCM 再生後のメッセージ送りが止まることがあります。この場合は ROM 自体の不具合と決めつけず、外部エミュレーターでも確認してください。

### 外部エミュレーター

`外部エミュレーター` は、Project Settings に設定したアプリへ生成済み ROM / CUE パスを渡して起動します。Geargrafx など、実機寄りの確認に使うエミュレーターを直接起動したい場合に選択します。

使い方:

1. Plugins 画面で Test Play plugin を `外部エミュレーター` にします。
2. Settings 画面の `外部エミュレーター` で `起動パス` を設定します。
3. 必要なら `追加パラメータ` を設定します。
4. Build 後に `Test Play` を押します。

`起動パス` は macOS の `.app` bundle か実行ファイルを指定できます。macOS では既定値として `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` が入ります。`.app` bundle を指定した場合も、起動時に `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE パスを渡します。

`追加パラメータ` に `{rom}`、`{romPath}`、`{file}`、`%ROM%` のいずれかを書くと、その位置へ生成済み `.cue` / `.pce` のパスを挿入します。placeholder を書かなかった場合、ROM / CUE パスは末尾へ自動追加されます。

例:

```text
--fullscreen {rom}
```

外部エミュレーター側のキー設定、セーブステート、画面サイズなどはエディターではなく起動先エミュレーター側の管理になります。

## ADPCM 確認時の注意

ADPCM の音質や再生後の進行確認では、次の順で切り分けると安全です。

1. Build し直して generated ADPCM が最新か確認します。
2. 標準エミュレーターと外部エミュレーターの両方で確認します。
3. 外部エミュレーターで正常、標準エミュレーターだけ停止する場合は、標準 WASM core 側の制約として扱い、外部エミュレーターでの動作を優先して確認します。
