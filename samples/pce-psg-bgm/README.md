# のんきな部活動 — PCE PSG BGM

72 BPM・4/4・16小節の、ゆっくりした部活動の日常向けBGMです。1〜8小節は音数を抑えた「メロ」、9〜16小節は音域、対旋律、ベースとノイズ打楽器の刻みを増やした「サビ」です。16小節目のG和音から1小節目のC和音へ解決し、そのままループします。

## ファイル

- `nonki_bukatsu_bgm.psg.json`: PCE Game Editorの正式な`psg-song`アセット文書。`Sound > PSG > 取込`から選択して使います。
- `nonki_bukatsu_bgm.hucard.psg.bin`: HuCARDランタイム用の8-byte step event列。72 BPM、256 steps、ループ曲として使います。
- `nonki_bukatsu_bgm.super-cd.psg.bin`: Super CD-ROM2 System Card PSGのmain/BGM package。bank134の`$8024`へロードする形式で、各channel streamにSEGNO/DAL SEGNOループを含みます。

PCE Game Editorでの利用では、JSON版を正本として使ってください。取込画面で構成と試聴を確認して登録すると、元JSONはプロジェクトの`assets/psg/nonki_bukatsu_bgm.psg.json`へ保存されます。`psg-song`としてビルドすると、HuCARD VNではstep event列、CD-ROM2 VNではSystem Card BGM packageへ自動変換されます。

再生成:

```powershell
node samples/pce-psg-bgm/generate.js
```
