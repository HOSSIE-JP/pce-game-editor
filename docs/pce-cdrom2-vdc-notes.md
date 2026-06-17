# PCE CD-ROM2 / Super CD-ROM2 VDC・VRAM・スプライト作業ノート

この文書は、PCE Game Editor の CD-ROM2 / Super CD-ROM2 向けテンプレート、
`pce-sample-builder`、`pce-asset-manager`、Test Play、画像・スプライト・ADPCM
実装を変更する前に読む前提資料です。

直近の失敗から、PCEのVDC・SATB・CD BIOSまわりを一般的なタイルエンジンや
HuCard初期化の延長として扱うと危険であることが分かりました。今後はこの文書の
チェックリストを通してから実装します。

## 参照した資料

- ローカルSDK:
  - `pce-game-editor/data/tools/llvm-mos-sdk/llvm-mos/mos-platform/pce-common/include/pce/hardware.h`
  - `pce-game-editor/data/tools/llvm-mos-sdk/llvm-mos/mos-platform/pce-common/include/pce/vdc.h`
  - `pce-game-editor/data/tools/llvm-mos-sdk/llvm-mos/mos-platform/pce-cd/include/pce/cd/bios.h`
- ローカルツール:
  - `pce-game-editor/data/tools/superfamiconv/README.md`
- 外部資料:
  - `https://llvm-mos.org/wiki/PCE_target`
  - `https://www.magicengine.com/mkit/doc_hard_vdc.html`
  - `https://www.magicengine.com/mkit/doc_tut_spr.html`
  - `https://www.copetti.org/writings/consoles/pc-engine/`

外部資料は仕様理解のためだけに使います。外部コードをコピーしてはいけません。

## llvm-mos PCE / PCE-CD の前提

- PCEはHuC6280ベースで、21-bitアドレス空間を8KB単位のMPRで切り替えます。
- 通常PCE RAMは小さく、PCE-CDではプログラムやデータがRAMバンクへロードされます。
- llvm-mosのPCE-CDターゲットでは、CD内部RAMは主に bank `128..135`、Super System
  Card追加RAMは bank `104..127` として扱われます。
- `pce-mkcd` はIPL ELFと追加ファイルをISOへ入れ、追加ファイルのセクタ・バンク情報を
  シンボルとして解決します。
- `.rodata` を大きくしすぎるとRAM bankに収まらないため、大きな画像・音声はC配列に
  直置きしないで、必要ならCDファイル、RAM bank、または分割チャンクとして扱います。

## VDC / VCE / VRAM の基本

- PCEのVDCは背景とスプライトを扱い、VCEは色インデックスをRGBへ変換します。
- VRAMは64KBで、SDKのVDC APIでは多くの場合「word address」として扱います。
- BGタイルは8x8、4bppなら32 bytes、つまり16 wordsです。
- スプライトは16x16を基本単位とします。16x16、32x16、16x32、32x32、16x64、
  32x64 などのサイズ指定があります。
- スプライトは64個まで、同一走査線の実用上限は16個程度です。大量の16x16分割
  スプライトを横に並べる時は、16個/scanline制限を必ず計算します。
- BGパレットとスプライトパレットは別領域です。スプライトパレットはVCEの
  `256 + paletteBank * 16` からロードします。
- スプライトの色0は透明として扱う前提でアセットを作ります。画像変換時は透明色を
  palette index 0 に固定します。

## SAT / SATB の理解

- スプライト属性表は、VRAM上に置くローカル表と、VDC内部で実際に描画に使われる
  内部バッファを区別して考えます。資料によってSAT/SATBの呼称が逆になることが
  ありますが、重要なのは「VRAMへ書いただけでは描画側へ反映されない」ことです。
- VDC内部のスプライト表へ反映するには、VRAM-SATB DMAが必要です。
- `pce_cdb_vdc_sprite_table_set_vram_addr(addr)` はCD BIOS側のVRAM sprite table
  位置を設定します。
- `pce_cdb_vdc_sprite_table_clear()` と `pce_cdb_vdc_sprite_table_put()` はVRAM上の
  sprite tableへ書くためのCD BIOS補助APIです。
- `pce_vdc_sprite_set_table_start(addr)` は通常VDC APIで、VDCのsprite attribute
  table位置を設定します。
- `pce_cdb_vdc_configure_dma(PCE_CDB_VRAM_DMA_REPEAT_SATB)` のようなCD BIOS DMA設定は、
  BIOS側のグローバルなVDC DMA状態に触る可能性があります。テンプレートへ直接入れる前に、
  必ず最小ROMで単独確認してください。
- 黒画面やEmulatorJSの `memory access out of bounds` が出た場合は、まず直前の
  VDC DMA / 表示制御 / BIOSワーク領域アクセス変更を疑います。

## スプライトパターン番号の単位

ここは特に間違えやすい箇所です。

- SuperFamiconv の `pce_sprite` で16x16、4bppスプライトを出力すると、1セルは
  128 bytesです。
- SATBのpattern fieldは「16x16セル番号」そのものではなく、より細かいpattern code
  単位です。開発資料では、pattern codeは32 bytes単位として扱う例があります。
- そのため、16x16セル1枚ぶんのデータを連続して置く場合、次の16x16セルへ進む
  pattern code stepは通常 `+4` です。
- VRAM word addressへ変換する時は、pattern code `n` から `n * 16 words`
  として扱うのが自然です。
- ただし、SDKやCD BIOS補助APIの期待単位が異なる可能性があります。実装修正時は
  必ず「1枚の単色16x16スプライト」だけの最小テストで、pattern codeとVRAM addressの
  対応を実機相当エミュレータ上で確認してから多セル画像へ進みます。

## SuperFamiconv 使用時の注意

- BG画像には `-M pce -B 4 -W 8 -H 8` を使います。
- スプライト画像には `-M pce_sprite -B 4` を使います。
- `-S` はsprite output settingsを適用するスイッチです。スプライトでは原則付けます。
- `-D` と `-F` は、重複タイル破棄やflip最適化を避けたい時に使います。スプライトの
  SATB順序とパターン順序を固定したい場合は有効です。
- 画像変換結果だけを信用しないで、生成されたbinのサイズを確認します。
  - 16x16 4bpp sprite cell 1枚: 128 bytes
  - 64x128を16x16分割: 4列 x 8行 = 32セル = 4096 bytes

## VRAMレイアウト設計ルール

- VRAMは64KB、word addressでは `0..32767` です。
- BG BAT、BGタイル、フォント、UIタイル、スプライトパターン、SATB領域を同じ単位で
  表にしてから配置します。
- BG tile baseは8x8タイル単位、1 tile = 16 wordsです。
- スプライトpattern codeも32 bytes単位として計算する場合、1 code = 16 wordsです。
- SATB領域は512 bytes、つまり256 words必要です。一般的にはVRAM末尾付近を使います。
- 画面が突然黒くなる変更は、VRAM重なりだけでなく、SATB領域上書き、VDC register、
  DMA control、表示enable/disable順序を疑います。

## 作業前チェックリスト

PCE CD-ROM2 / Super CD-ROM2のVDC、VRAM、スプライト、画像変換に触る前に必ず確認します。

1. 変更対象がBG、スプライト、SATB、DMA、CD BIOS、VCE paletteのどれかを明確にする。
2. 同時に複数領域を変更しない。BGとスプライトとADPCMを同時に直さない。
3. VRAMレイアウト表を作り、word単位とbyte単位を併記する。
4. SATB pattern codeとVRAM word addressの換算式をコメントに残す。
5. CD BIOS DMA設定を変更する場合は、テンプレートではなく最小ROMで先に検証する。
6. 最初は画像変換を使わず、単色16x16スプライト1枚の生データで表示確認する。
7. 次にSuperFamiconvの16x16 1セル、次に4セル、最後に64x128全体へ段階的に進む。
8. Test Playは既存ウィンドウやWASM状態を再利用せず、新規起動する。
9. CD-ROM2 Test PlayはBIOS画面後にRUNボタンを押して起動する。
10. 黒画面・WASM OOB・波打ち表示が出たら、最後のDMA/表示制御変更を最優先で戻す。

## 推奨デバッグ順序

今後スプライトが壊れた場合は、次の順に切り分けます。

1. BGなし、テキストなし、ADPCMなし、黒背景のみ。
2. スプライトパレットだけロードし、単色16x16の生パターン1枚をVRAMへ置く。
3. SATB entry 0だけ設定し、VRAM-SATB転送経路を確認する。
4. 同じ生パターンを4枚並べ、pattern stepを確認する。
5. SuperFamiconv `pce_sprite` の16x16 1セルを表示する。
6. 64x128画像を16x16分割で表示する。
7. 大型スプライト属性、BG、フォント、ADPCMを順に戻す。

## 実装時の禁止事項

- SATBが出ないからといって、CD BIOSのDMA controlを推測で書き換えない。
- パターン番号単位を確認せずに `*16`、`*32`、`*64` を入れ替えない。
- 背景・フォント・UI・スプライトのVRAM配置を暗算で決めない。
- 画像変換、VRAMコピー、SATB更新、表示enable、ADPCM再生を同時に変更しない。
- EmulatorJSのWASMメモリエラーを「画像が悪い」と決めつけない。VDC/DMA/BIOS状態破壊を先に疑う。

## 現在のPCE VNサンプルで注意すべき点

- 背景は288x128、テキストは16x16で18文字x4行、画面外は黒塗りという設計です。
- 背景・フォント・UIでVRAMを消費するため、スプライト用VRAMは必ず表で空き領域を
  確認してから決めます。
- 64x128バストアップを16x16セルで組むと32スプライトを使います。右側に置く場合、
  同一scanlineに4スプライト載るため、16/scanline制限上は成立します。
- ただし、pattern code、VRAM word address、SuperFamiconv出力順、SATB DMAのどれか
  1つでもズレると「断面」「ゴミ」「真っ黒」になります。
