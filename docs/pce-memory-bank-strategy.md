# PCE-CD VN memory / bank strategy

この文書はCD-ROM2 VN runtimeの現行bank配置とlink gateを定義します。旧来のconsole RAM scene buffer、bank134/135の自前PSG step buffer、CD上の`font.bin`/`font_sprite.bin`は使用しません。

## 配置

| physical bank | CPU slot | 用途 | 契約 |
|---:|---:|---|---|
| 104-119 | MPR6 | visual payload cache | 8KB×16 page。BG/spriteの低位RAM cache |
| 120 | — | 未使用 | 将来用 |
| 121 | MPR4 | visual helper overlay | `visual_code.bin`をCDからロード。固定entry経由 |
| 122 | MPR4 | CD async / runtime support overlay | `cd_async_code.bin`をCDからロード。固定entry経由。palette、部分BAT clear、SATB upload、ADPCM容量判定・再生終了serviceも担当 |
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

- CD scene pack v3は最大8192 bytesです。
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
- BG行転送後の左右margin clear (`clear_bg_map_side_margins_impl`) 本体はbank122 runtime support overlayへ置き、bank129には薄いdispatchだけを残します。bank122内では同じoverlayの`clear_map_rect_at_dest_impl`を直接呼び、slot4 dispatcherを再入させません。Full BG対応コードが有効なprojectでもbank128/129のload imageを8KB未満に保つためです。
- bank122はdirect CD/SCSI処理だけでなく、palette upload/fade、部分BAT clear、SATB upload、ADPCM buffered容量判定と毎frameのADPCM再生終了serviceを担うruntime support overlayです。dispatcherは呼出元のMPR4とMPR6を保存・復元するためbank121 visual helperからも呼べますが、bank122実行中にbank130へmapするhelperは呼びません。
- choiceカーソル移動の2×2 BAT差分更新本体もbank122 runtime supportへ置きます。上下入力側はbank128の薄いdispatchとし、bank130の常駐512-byte余白を消費せず、同一VBlank内で旧行をblank、新行を初期描画済みarrow patternへ差し替えます。
- bank122のruntime-support op番号は疎に保ちます。連番へ詰めるとLLVM-MOSがresident `.rodata`にcross-section jump tableを生成し、`llvm-objcopy`が`.vn_cd_async_code`を抽出・除去できなくなります。
- sprite pattern cache loadの調停は、CD metadata accessとbank121 visual cache呼出を橋渡しするためbank128の薄いresident wrapperに置きます。大きな転送本体をresidentへ戻してはいけません。
- overlay実行中はbank130が見えません。`VN_OVERLAY_CODE`から呼ぶhelperはbank129か本当に必要な最小bank128へ置き、bank130へ置きません。
- visual/async helperは`.vn_visual_code`/`.vn_cd_async_code`としてlink後に抽出し、対応する`PT_LOAD`を`PT_NULL`化します。これを怠ると`pce-mkcd`の初期load imageが壊れます。
- bank133 overlayは`.vn_overlay`を抽出し、residentからは`vn_overlay_entry`の固定address dispatchだけで呼びます。message口パクの次ROW切替／通常ROW復帰もここでsprite stateを更新します。bank122のADPCM終了serviceから復帰を要求するときは`vn_overlay_dispatch_locked()`を使い、overlayから戻った後も呼出元のbank122をMPR4へ復元します。
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
| bank128/129/130 | 各`< 0x2000`かつ空き`>= 512` bytes |
| bank132/133 | 各`< 0x2000` |
| visual/async helper | 各予約8KB未満 |

境界を「予約済み」とみなしてgateを緩めてはいけません。NOLOADでない8KB bankはBIOS/user RAM初期化契約を壊すため失敗です。
常駐3バンク(bank128/129/130)は空き512 bytesをhard gateで予約します。これにより、小さなruntime追加を繰り返してリンカが突然溢れる前に回帰テストとbuildを止めます。bank128/129/130/132/133は、上限未満でも空きが256 bytesを切った時点でbuild logへ低headroom warningも出します。bank132は末尾に固定scratch tailがあるため、単純なbank終端high-waterではなく、generated data終端からtail開始までの実際の割当可能gapをheadroomとして表示します。

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
