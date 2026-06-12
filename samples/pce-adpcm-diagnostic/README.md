# PCE ADPCM Diagnostic Sample

PC Engine / Super CD-ROM2 の ADPCM ノイズ切り分け用サンプルです。VN runtime や scene command を通さず、System Card BIOS の ADPCM helper だけで同じ 1kHz サイン波を再生します。

## 生成されるデータ

```sh
node scripts/pce-adpcm-diagnostic.js generate
```

- `assets/source/sine_1khz_16000.wav`: 16000Hz / 1秒 / 1kHz の基準 WAV
- `assets/generated/sine_1khz_16000_lsn/adpcm.bin`: low nibble first
- `assets/generated/sine_1khz_16000_msn/adpcm.bin`: high nibble first
- `assets/generated/*/decoded.wav`: 生成 ADPCM をアプリ内 decoder で WAV に戻した確認用
- `assets/generated/manifest.json`: sector、byte length、divider の一覧

## ADPCM データ解析

```sh
node scripts/pce-adpcm-diagnostic.js analyze
node scripts/pce-adpcm-diagnostic.js analyze data/projects/1123/assets/adpcm/adpcm.wav data/projects/1123/assets/generated/adpcm/adpcm.bin 16000
```

OKI/MSM5205 と旧実験形式の両方を `lsn-first` / `msn-first` で decode した RMS error、SNR、correlation を出します。元 WAV に近い codec/nibble order が正しい候補です。どれも悪い場合は、ADPCM encoder ではなく BIOS への渡し方や CD sector を疑います。

## 最小 CD-ROM2 ISO

```sh
node scripts/pce-adpcm-diagnostic.js build
```

既定では `data/tools/pce-cd/ipl/ipl.bin` を使います。別の IPL を使う場合は `PCE_CD_IPL_PATH=/path/to/ipl.bin` を指定してください。出力は `out/pce-adpcm-diagnostic.iso` と `out/pce-adpcm-diagnostic.cue` です。

操作:

- `I`: high-nibble-first の ADPCM を ADPCM RAM へ読み込んで再生
- `II`: low-nibble-first の ADPCM を ADPCM RAM へ読み込んで再生
- `RUN`: high-nibble-first の ADPCM を CD streaming 再生
- `SELECT`: ADPCM stop

起動後に何も押さない場合も、約45 frame 後に `I` と同じ high-nibble-first buffered 再生を自動実行します。画面はステータス確認用に背景色だけを変えます。緑が `I` / 自動再生、赤が `II`、水色が `RUN`、黄色が BIOS helper のエラーです。
