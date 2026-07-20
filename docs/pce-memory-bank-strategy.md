# PCE-CD VN memory / bank strategy

この文書はCD-ROM2 VN runtimeの現行bank配置とlink gateを定義します。旧来のconsole RAM scene buffer、bank134/135の自前PSG step buffer、CD上の`font.bin`/`font_sprite.bin`は使用しません。

## 配置

| physical bank | CPU slot | 用途 | 契約 |
|---:|---:|---|---|
| 104-119 | MPR6 | visual payload cache | 8KB×16 page。BG/spriteの低位RAM cache |
| 120 | — | 未使用 | 将来用 |
| 121 | MPR4 | visual helper overlay | `visual_code.bin`をCDからロード。固定entry経由 |
| 122 | MPR4 | direct CD/SCSI async helper | `cd_async_code.bin`をCDからロード。固定entry経由 |
| 123 | MPR6 | active scene pack | 8KB `NOLOAD`。最大8192 bytes |
| 124-127 | — | 未使用 | 将来用。新用途を割り当てる前に文書とgateを更新 |
| 128 | MPR2 | resident code | 起動、薄いdispatch、System Card adapter、小さいmetadata |
| 129 | MPR3 | resident code | `VN_BANKED_CODE`。overlayから呼び得るhelperを優先 |
| 130 | MPR4 | resident code | `VN_BANKED_CODE2`。bank133/121/122と時分割 |
| 131 | MPR5 | System Card | code/dataを配置しない |
| 132 | MPR6 | generated data/scratch/cache | metadata、sprite per-frame delay table、CD scratch、message glyph mask cache |
| 133 | MPR4 | code overlay | `overlay.bin`、`VN_OVERLAY_CODE`。bank130と時分割 |
| 134 | PSG MPR4 | waveform/index/BGM | `$8000-$801F` wave 45、`$8020-$8023` index、`$8024-` BGM |
| 135 | PSG MPR5 | SFX | `$A000-` SFX package |

bank131はSystem Cardがslot5で実行するため使用禁止です。bank134/135はSystem Card PSG driverの所有物であり、runtimeのMPR6 work bufferとしてmapしてはいけません。

## scene pack

- CD scene pack v2は最大8192 bytesです。
- bank123全体を`.ram_bank123 (NOLOAD)`として予約します。IPL/main ELFのload imageへ含めません。
- readerは生pointerを返さず、`offset/count`でrange checkします。
- accessごとにMPR6を保存し、bank123をmapし、copy/decode後に必ず元のMPR6へ戻します。
- active messageは最大68 glyphの16-bit列を136-byte console bufferへdetachします。typewriter、音声、入力待ち中はbank123を読みません。

## System Card PSG banks

bank134:

- `$8000-$801F`: 32-byte fixed square waveform。user waveform 45。MIDI割り当てで使う0..44はSystem Card内蔵waveであり、このbankへ複製しない
- `$8020-$8021`: main track package pointer
- `$8022-$8023`: sub track package pointer
- `$8024-$9FFF`: active BGM package、最大8156 bytes

bank135:

- `$A000-$BFFF`: active SFX package、最大8192 bytes

package loaderは対象busを停止してstatusを確認し、宣言byte数だけをdirect async loaderで転送します。CD sector paddingは書きません。他方のbusとVSync IRQは継続します。同じbusの再生中packageを上書きするpreloadは生成時に拒否します。

## MPR契約

- MPR4はbank130、bank133、bank121、bank122の時分割です。dispatcherは呼出時MPR4を保存し、終了時に元の値へ戻します。固定entry以外の相互relocationは禁止です。
- MPR5/bank131はSystem Card用です。PSG driver内部のbank135 mappingをruntimeが仮定してはいけません。
- MPR6は通常bank132です。scene access時だけbank123、visual cache access時だけbank104-119へ切り替え、必ず元へ戻します。
- `EX_GETFNT` adapterはMPR0/4/5/6を保存します。PSG BIOS adapterも呼び出し前後のMPRを不変にします。
- IRQ handlerの入口/出口でMPR4/5/6が一致することをGeargrafxで検査します。

## code配置

- bank128は起動、BIOS境界、IRQ handler、薄いdispatchに残します。無属性helperはbank128へ入りやすいため、追加前に配置属性を決めます。
- sprite animationの16-bit per-frame delay tableはプロジェクトのanimation数に応じて増えるためbank128 resident rodataへ置かず、`PCE_VN_DATA_SECTION`でbank132へ置きます。bank121 visual helperのanimation tickへ入るresident wrapperは、MPR4を切り替える前にMPR6をbank132へmapします。
- BG行転送後の左右margin clear (`clear_bg_map_side_margins`) はbank129へ置きます。Full BG対応コードが有効なprojectでもbank128のload imageを8KB未満に保つためで、呼出先のresident VDC helperはslot2から利用できます。
- overlay実行中はbank130が見えません。`VN_OVERLAY_CODE`から呼ぶhelperはbank129か本当に必要な最小bank128へ置き、bank130へ置きません。
- visual/async helperは`.vn_visual_code`/`.vn_cd_async_code`としてlink後に抽出し、対応する`PT_LOAD`を`PT_NULL`化します。これを怠ると`pce-mkcd`の初期load imageが壊れます。
- bank133 overlayは`.vn_overlay`を抽出し、residentからは`vn_overlay_entry`の固定address dispatchだけで呼びます。
- `spritemove`の開始/中止helperはbank130、毎frameのDDA tickはbank121 visual helper、SATB再構築はbank133 overlayに置きます。console RAMの移動状態は4 slot合計96 bytes以下とし、command recordは19 bytesから増やしません。
- 詳しい抽出/relocation規則は[pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md)を参照してください。

## console RAM / ZP gate

CD VN link後にELF sectionとmapを読み、次をhard errorにします。

| 対象 | 条件 |
|---|---:|
| app console RAM使用量 | `<= 0x1200` bytes |
| PSG予約後のconsole RAM空き | `>= 2026` bytes |
| ZP終端 | `<= $20E6` |
| bank123 | `== 0x2000`かつ`SHT_NOBITS/NOLOAD` |
| bank134/135 | 各`== 0x2000`かつ`SHT_NOBITS/NOLOAD` |
| bank128/129/130/132/133 | 各`< 0x2000` |
| visual/async helper | 各予約8KB未満 |

境界を「予約済み」とみなしてgateを緩めてはいけません。NOLOADでない8KB bankはBIOS/user RAM初期化契約を壊すため失敗です。
bank128/129/130/132/133は、上限未満でも空きが256 bytesを切った時点でbuild logへ低headroom warningを出します。これはhard errorではありませんが、次のruntime/generated-data変更前に配置を測り直す合図です。

## CD data file

大きいBG/sprite/ADPCM payload、scene pack、overlay/helper、System Card PSG packageは`cd.dataFiles`に置きます。並び順はgeneratorがsectorを確定するための公開build契約です。現行の概略順:

1. `overlay.bin`
2. `visual_code.bin`
3. `cd_async_code.bin`
4. `asset_meta.bin`
5. scene packと参照payload
6. `(assetId, channel)`単位のSystem Card PSG package

`font.bin`、`font_sprite.bin`、`assets/generated/psg/<id>.bin`はCD VN catalogへ含めません。HuCard生成物は別契約です。

## 変更時の確認

1. CD templateを実linkし、build logのbank/console/ZP gateを保存する。
2. `llvm-readelf -S`でbank123/134/135がNOBITSであることを確認する。
3. `llvm-objdump -dr`でoverlay/visual/asyncから時分割bankへの禁止relocationがないことを確認する。
4. GeargrafxでIRQ前後のMPR4/5/6、scene切替、BGM+SFX+async loadを確認する。
5. 同期/非同期`spritemove`を60/6000 frame動かし、R13/SATB、PSG IRQ一回性、4 slot同時移動、scene切替キャンセルを確認する。
6. HuCard VN buildを通し、CD固有配置が混入していないことを確認する。
