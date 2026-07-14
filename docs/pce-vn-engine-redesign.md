# Super CD-ROM² VN runtime — System Card BIOS設計

この文書は、CD版VN runtimeの現行設計を定義します。旧来の自前PSG sequencer、TIMER credit、起動時font upload、4096-byte console scene bufferは廃止済みです。HuCard版、CD-DA、buffered direct ADPCMはこの設計変更の対象外です。

APIの根拠は[Hu7 CD-ROM System Software Development Manualの公開スキャン](https://web.archive.org/web/20160101000000id_/http://www.pcedev.net/docs/Hu7CD_final.zip)です。BIOS、PSG driver、抽出font、マニュアル自体をリポジトリまたはゲーム生成物へ含めてはいけません。

## 対象profile

- CD VNは`cd.systemCardProfile: "jp-v3"`へ常に正規化します。これは生成物のBIOS ABIを表す固定契約であり、ユーザー選択項目でもSystem Card ROMパスでもありません。
- 対象は日本版Super System Card 3.0、および同じBIOS契約を持つArcade Card環境です。
- BuildはROMファイルを参照せず、固定profileに従ってPSG bytecode・Shift-JIS scene pack・BIOS adapterを生成します。Test Play／HTML ExportだけがSetupで指定されたユーザー所有ROMのサイズとSHA-1を検査します。512-byte copier headerだけは正規化します。
- 起動時にもversion 3.0、代表Shift-JIS glyph、12×12出力をprobeします。不一致時は固定図形だけの`SC3 ERR`診断画面で停止し、fallback runtimeへ移行しません。

## BIOS境界

`vn_system_card.c`がSystem Cardとの唯一の境界です。`PCE_CDB_USE_PSG_DRIVER(1)`、`PCE_CDB_USE_GRAPHICS_DRIVER(0)`を固定し、次を一元管理します。

- llvm-mos ABIとBIOS疑似レジスタ
- BIOS呼び出し中のIRQ lock
- MPR0/4/5/6の保存と復帰
- `$20F5`のIRQ user-vector bit再確立
- VDC R5とHuC6280 IRQ maskの再確立
- `PSG_BIOS`、`PSG_DRIVE`、`EX_GETFNT`の呼び出し

PSG/font BIOS callは短い非再入区間です。長いCD data transferは既存のdirect async loaderを使い、VBlankごとのPSG駆動を止めません。

### PSG初期化

初期化順は変更禁止です。

1. `PSG_OFF`
2. `PSG_INIT(2)`
3. `PSG_BANK(134, 135)`
4. `PSG_WAVE($8000)`
5. `PSG_TRACK($8020)`
6. user IRQ vector登録
7. `PSG_ON(IRQ)`

bank134の`$8000-$801F`に固定square wave（user waveform 45）、`$8020-$8023`にmain/subの2-entry indexを置きます。

## VSync IRQ所有権

CD VNはSystem Cardのgeneric IRQ user vectorを1本だけ所有します。full graphics/VBlank handler、SYNC handler、HuC6280 TIMER/TIQは使いません。

resident naked handlerの契約:

1. A/X/Yと必要なMPRを保存する。
2. VDC statusを1回読み、VBlank sourceをackする。
3. VDでなければPSGを呼ばず復帰する。
4. VDなら`PSG_DRIVE/$E0E1`を正確に1回呼ぶ。
5. `vn_irq_frame_epoch`を1加算する。
6. 全register/MPRを復元して`RTI`する。

`$20F5`はgeneric IRQ user-vector bitを維持し、SYNC/VBlank graphics handler用bitを立てません。frame waitは`vn_irq_frame_epoch`の変化だけを待ち、main-thread VDC polling、credit、catch-up、合成frame補償を持ちません。

BIOS helperがmask/vector/R5を変更し得るため、adapterは呼び出し後にuser vector、IRQ mask、R5を再確立します。ISRの前後でMPR4/5/6が一致しない変更は不正です。

## System Card PSG package

エディタの`psg-song`、`psg-sfx`、step編集、MIDI/VGM取込、SFXデザイナーは共通source形式を維持します。tone stepはoptionalな`wave: 0..45`を持てます。CD buildだけが`pce-system-card-psg.js`でSystem Card track bytecodeへ変換し、HuCard buildは`wave`を無視して既存のstep形式を維持します。

### bus

| asset | BIOS track | RAM | 動作 |
|---|---|---|---|
| `psg-song` | main | bank134 `$8024`以降 | BGM。新しいBGMだけが置換 |
| `psg-sfx` | sub | bank135 `$A000`以降 | SFX。新しいSFXだけが置換 |

BGMとSFXは同時再生できます。`audio stop`の`target`は`bgm`、`sfx`、`all`で、未指定は`all`です。

packageは実際に参照された`(assetId, channel)`ごとに生成します。`channel`を各stepのchannelへ加算して0..5へclampしたvariantをコンパイルするため、runtime transposeは行いません。同じbusの再生中に別packageをpreloadするscriptはvalidation errorです。

### bytecode変換

- step長は現行BPM規則からframe数へ変換します。
- 長いdurationはdirect-length commandへ分割し、継続部分をtieで結びます。
- songは`SEGNO`/`DAL SEGNO`でloopし、SFXはend commandで停止します。
- toneはnote+signed detuneから元periodを正確に再現します。表現不能periodはasset/step/channel位置付きbuild errorです。
- toneの`wave`は発音時の`WAVE` commandへ変換します。0..44はSystem Card内蔵wave、45はbank134へ登録したuser squareです。未指定は45です。
- noiseはchannel 4/5のmode 2へ変換します。
- MIDI Program Changeは取込時にGM 16ファミリーへまとめ、設定可能なfamily→wave tableでtone stepへ焼き込みます。
- waveform 45以外のuser waveform、外部envelope、FMは使いません。System Card内蔵wave bytesを生成物へ複製しません。

容量上限はBGM 8156 bytes、SFX 8192 bytesです。loaderは対象busだけを停止し、statusで停止を確認してから宣言byte数だけをdirect async転送します。sector paddingをRAMへ書いてはいけません。他方のbusは転送中もIRQ駆動を継続します。

CD VNの`asset_meta.bin`には旧`pce_editor_psg_step_t`、pattern record、PSG regionを出しません。System Card package referenceはscene commandから独立した生成tableで管理します。

## scene pack v2

CD scene packは最大8192 bytesで、bank123/MPR6へ読み込みます。console RAM上の生pointerは使いません。

- readerは`offset + count`だけを受け取る。
- accessの直前だけMPR6をbank123へ切り替える。
- 成否を問わず元MPR6へ戻す。
- message開始時に最大68個の16-bit glyphを136-byte console bufferへコピーする。
- typewriter、ADPCM、入力待ち中はbank123を参照しない。

CD文字列はlength付き16-bit Shift-JIS列です。LFは内部制御値`0xFFFE`、終端は`0xFFFF`です。printable ASCIIはbuild時に全角JISへ正規化します。

許可する文字は日本版v3の非漢字領域とJIS第一水準だけです。第二水準、CP932拡張、半角カナ、絵文字、結合文字はscene/command/field位置付きbuild errorにします。旧scene packを読む互換layerはありません。

## BIOS font

message glyphは必要時に`EX_GETFNT/$E060`の12×12 modeで32-byte scratchへ取得し、24-byte maskへ変換して既存の68-glyph cacheへ入れます。17×4 layout、色、typewriter、選択肢、VRAM readback不要compositorは維持します。

`spritetext`も12×12 modeを必要時に呼び、2pxの透明余白を持つ16×16 hardware sprite patternへ4bpp化してVRAMへuploadします。SATBは従来どおり1文字1entryですが、配置はmessageと同じ横12px・縦16pxピッチです。

CD生成物には`font.bin`、`font_sprite.bin`を出しません。起動時全font uploadと全glyph VRAM mask領域もありません。`>`、`▼`、起動失敗表示だけを固定図形として持ち、一般文字のfallbackには使いません。

## 音声・描画で維持する契約

- CD-DAは従来どおりCD BIOS APIを使います。
- ADPCMは既存buffered direct pathを維持します。PSG BIOS化を理由にstatus polling、自然終了後stop/reset、joypad baselineを変更してはいけません。
- graphics driver/full VBlank handlerは使いません。VDC/BAT/SATB/compositorはruntimeが所有します。
- VDC access、PSG/font BIOS call、overlay/bank switchは各境界のIRQ lock契約を守ります。
- `spritemove`はCD/HuCard共通の19-byte command契約で、CDのPSG/font/ADPCM/CD-DA契約には影響させません。

## RAM/bank配置

詳細とlink gateは[pce-memory-bank-strategy.md](pce-memory-bank-strategy.md)を正とします。要約:

| bank | 用途 |
|---:|---|
| 123 / MPR6 | 8192-byte active scene pack |
| 128/129/130 | resident code、BIOS adapter、通常runtime |
| 132 / MPR6 | generated metadata、CD scratch、変換済みglyph cache |
| 133 / MPR4 | code overlay |
| 134 / PSG MPR4 | waveform/index/BGM package |
| 135 / PSG MPR5 | SFX package |
| 124-127 | 未使用予約 |

bank123/134/135は8KBの`NOLOAD`予約です。link gateはconsole RAM使用量`<=0x1200`、空き`>=2026` bytes、ZP終端`<=$20E6`、code/data bank使用量`<0x2000`も検査します。

## 変更時の受入条件

- compiler: main/sub header、absolute pointer relocation、loop/end、duration split/tie、period/detune、noise、channel variant、bank上限
- font/scene: ASCII全角化、Shift-JIS coverage、12×12 message mask / SpriteText pattern変換、SpriteText 12pxピッチ、68-glyph cache、位置付きerror
- build: 8192-byte scene、bank123/134/135 NOLOAD、console/ZP/code-bank gate、catalog再計算、旧font/PSG file不在、CD/HuCard両build
- Geargrafx: `$E86D`と`$E6CF`が各VBlank 1回、full handler`$E873`が0回、MPR4/5/6とR5/R7/R8/R13・SATB・BGが非破壊
- 組合せ: BGM+SFX、別bus load、async CD、CD-DA、ADPCM、message font、spritetext、同期/4-slot非同期spritemove、scene切替
- EmulatorJS/WASM: ADPCM自然終了後入力、押しっぱなしedge、明示stop/resetの既存回帰

BIOS probeまたはIRQ一回性gateが成立しない場合はfallbackを追加せず、BIOS-only移行を停止して原因を報告します。
