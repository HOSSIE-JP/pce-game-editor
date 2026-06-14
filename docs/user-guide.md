# PCE Game Editor User Guide

このガイドは、PCE Game Editor で PC Engine / Super CD-ROM2 project を作成、ビルド、Test Play するユーザー向けのメモです。

## セットアップ

`SetUp` 画面で、使用する機能に応じて次の外部ファイルを設定します。

- `llvm-mos-sdk`: HuCard / CD-ROM2 のビルドに使います。
- IPL / System Card: Super CD-ROM2 のビルドや Test Play に使います。ユーザー所有ファイルとして扱い、リポジトリには同梱しません。
- EmulatorJS runtime: 標準エミュレーターで Test Play する場合に使います。

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
