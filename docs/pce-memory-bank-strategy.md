# PCE / Super CD-ROM2 メモリバンク運用ルール

このメモは、PCE Game Editor の CD-ROM2 / VN runtime で使う HuC6280 MPR と llvm-mos section の割り当てを固定化するための引き継ぎルールです。

## 基本方針

- CD-ROM2 build では、背景 tiles/map、sprite pattern、ADPCM 本体のような大きい payload は RAM bank へ詰め込まず、`cd.dataFiles` に並べます。BG/sprite 表示 data は `cd_transfer_scratch` 経由で VRAM へ転送し、ADPCM は ADPCM RAM または streaming 経路へ送ります。
- CPU が頻繁に読む小さい runtime data だけを RAM bank に置きます。表示 asset の実体は CD data file 優先です。
- `cd.dataFiles` は sector 64 以降に並ぶ前提で generated metadata に sector を埋め込みます。build は IPL program の後ろへ padding file を挟み、ISO 上の最初の data file が sector 64 から始まるようにします。padding サイズは固定ではなく、ELF build 後に `pce-mkcd -v` でプログラム像の実セクタ数を測定して `64 - program終端sector` で決めます（`finalizePceCdDataPadding()` / `parseMkcdFirstDataSector()`）。**RAM bank の配置やデータ量を変えて program 像のサイズが変わると、固定 padding では data 開始 sector がずれ、埋め込み済みの sector 参照（`pce_vn_font_data` / `pce_vn_scene_packs[]` / asset の `cd_data_ref`）が全部ずれて全画面が壊れます。** font tiles の CD streaming 化のように program サイズに影響する変更をしたら、必ず実 ISO で data 開始 sector が 64 のままか確認してください。
- VN runtime は `template/template_pce_vn_cd/src/pce_vn_runtime.c` が単一の実体です。project 側へ同期されるので、bank ルール変更は必ず template を直します。

## CD-ROM2 RAM Bank Map

| Bank | MPR | 主用途 | ルール |
|---:|---:|---|---|
| 128 | 2 | llvm-mos 既定の常駐 `.text` / `.rodata` | 起動・薄い制御・小さい rodata 用。大きい runtime や asset を押し込まない。CD BIOS や VN data access 後に常駐 metadata を読む場合は `map_resident_data()` で戻す |
| 129 | 3 | VN runtime の banked code | `PCE_RAM_BANK_AT(129, 3)` と `VN_BANKED_CODE` で command interpreter / sprite refresh / ADPCM 制御、scene pack command/message reader を置く。asset data を置かない |
| 130 | 4 | VN runtime の 2 本目の banked code | `PCE_RAM_BANK_AT(130, 4)` と `VN_BANKED_CODE2` で scene pack choice/switch reader や preload scan helper を置く。asset data を置かない |
| 131 | 5 | CD fallback の小さい CPU-readable data | 例外的な fallback 用。通常の画像・sprite・ADPCM payload には使わない |
| 132 | 6 | VN generated data ＋ CD転送スクラッチ | `PCE_VN_DATA_SECTION`。sprite animation、variable 初期値、scene pack directory、font tiles の CD data ref (`pce_vn_font_data`) を置く。**font tiles 本体は bank132 に常駐させず CD data file (`assets/generated/vn/font.bin`) からストリーム**。scene script 本体も CD data file。font streaming で空いた領域に **`cd_transfer_scratch`(2KB) を `section(".ram_bank132")` で移設**し、逼迫する console_ram を空ける |

## 実装ルール

- `ram_bank129` は起動時に `pce_ram_bank129_map()` で MPR3 へ常時 map します。`VN_BANKED_CODE` 関数はこの前提で直接呼びます。ADPCM の load/play/streaming 制御も bank128 を圧迫しないよう bank129 側へ置きます。
- `ram_bank130` も起動時に `pce_ram_bank130_map()` で MPR4 へ常時 map します。`VN_BANKED_CODE2` は bank129 に収まらない scene pack reader / preload helper 用で、MPR4 を asset fallback に切り替えない前提です。
- `ram_bank128` の常駐 data を読む runtime code は、CD BIOS helper や `map_vn_data()` 呼び出し後に `map_resident_data()` を挟んでから参照します。特に `pce_editor_sprite_assets[]`、`pce_editor_sprite_draw_meta[]`、CD data ref のような小さい metadata は bank128 resident data として扱います。
- 生成済み C metadata は scene 生成時に asset ID を index へ解決済みで、runtime では ID 文字列を使いません。`pce_editor_psg_asset_t` / `pce_editor_adpcm_asset_t` / `pce_editor_cdda_asset_t` に `id` field を戻すと bank128 の `.rodata` を直接圧迫するため、debug 用文字列は JSON 側に留めます。
- `ram_bank132` を読む前は `pce_vn_font_tiles_map()` または runtime の `map_vn_data()` を呼びます。MPR6 を切り替えるため、MPR6 上で実行される code を作らないでください。
- `cd_transfer_scratch`(1 sector=2KB) は `section(".ram_bank132")` に置き、CD→VRAM 転送ヘルパ（`cd_data_ref_to_vram` / `cd_bg_map_ref_to_vram` / `upload_font_tiles`）でのみ使います。各ヘルパは asset/font の参照 (`ref` は bank128 常駐) を local へ読んだ**後に** `map_vn_data()` で MPR6=bank132 を張ってから `pce_cdb_cd_read`（書き込み先）と VRAM copy（読み出し元）のループに入ります。`pce_cdb_cd_read` は呼び出し元 (bank129) へ戻る都合上 MPR を保存するため、ループ前に 1 回 map すれば足りることを Geargrafx で確認済み。逆に **CD BIOS の書き込み先になる buffer を MPR6=bank132 を張らずに bank132 へ置くと、転送データが別バンクへ化けて全画面が壊れます**。`vn_active_scene_pack_data`(4KB) はコマンド解釈の各所から読むため console_ram に残します（bank132 へ移すなら全 reader で MPR6 を保証する必要があり要慎重）。
- グリフフォントは BG タイルと同じく `cd.dataFiles` の `assets/generated/vn/font.bin` に並べ、起動時に `upload_font_tiles()` が `cd_transfer_scratch` 経由で 1 回だけ VRAM (`PCE_VN_FONT_TILE_BASE` から) へストリーム転送します。bank132 には sector/サイズだけを持つ `pce_vn_font_data` (`pce_vn_cd_data_ref_t`) を常駐させ、glyph 数に比例した数 KB を bank132 から外します。font.bin は `collectCdDataFiles()` で先頭 (CD sector 64) に置き、埋め込み sector と ISO 配置を一致させます。VRAM 側の上限だけが残るため、`generateVnSources()` の `computeFontBudget()` が glyph index 上限 (254)・VRAM tile 末尾 (SATB `0x7f00` = tile 2032) をビルド時に検査し、超過は build error、接近は警告します。非 CD (`__PCE__`) build だけ従来通り `pce_vn_font_tiles[]` を埋め込みます。
- VN script は scene 単位の `assets/generated/vn/scenes/NNN_<sceneId>.bin` として `cd.dataFiles` に置きます。pack は pointer を持たない little-endian / offset ベース形式で、`pce_vn_scene_packs[]` だけを bank132 に常駐させます。
- runtime は scene 入場時に active scene cache (`4096` bytes) へ pack を読み込みます。別 scene 用の preload scan cache は持たず、`preload` が別 scene を指す場合は事前走査せず target scene 入場時に通常ロードします。pack が 4096 bytes を超える場合は build error にして scene 分割を促します。
- scene pack から読む command/message/choice/switch の要素は、CD / asset bank / VDC 転送で MPR が変わる可能性を考え、処理前に stack local にコピーしてから扱います。特に ADPCM は BIOS 呼び出し前に data size、address、divider、loop、stream、CD sector を runtime-owned snapshot へ直接コピーし、BIOS 呼び出し後に `pce_editor_adpcm_assets[]` のポインタを再読みに使わないでください。
- CD-ROM2 VN runtime では bank129 / bank130 / bank132 は runtime code / VN data 専用です。`pce_editor_map_asset_bank()` を使う banked asset fallback が必要な場合も、VN runtime では bank131 だけを例外的に使います。
- CD-ROM2 の BG `map_vram.bin` は CD 上では64タイル幅のソース行です。`mapBase` からファイル全体を一括転送すると、行末が次行左端へ回り込んで本来画像にない縦縞が出ます。runtime は `cd_transfer_scratch` へ1 sectorずつ読み、各行の `width_tiles` 分だけを `mapBase + command.y * VN_MAP_WIDTH + command.x + row * VN_MAP_WIDTH` へコピーし、左右/上下余白は `clear_screen_map()` のblank tileを残します。
- sprite 描画に必要な cell size、sheet cell 数、pattern base、palette bank は generated `pce_editor_sprite_draw_meta[]` にも小さく出します。runtime はこの compact metadata を `sprite_draw_meta` へコピーしてから SATB を組み、animation metadata は `frame_count > 1` かつ sheet 範囲内のときだけ frame size として使います。単一 frame / default animation は sprite sheet 全体を表示します。
- sprite pattern は VRAM の sprite pattern 領域へ転送し、SATB は `VN_SATB_ADDR` (`0x7f00`) を使います。CD-ROM2 でも CD BIOS graphics driver は使わず、VBlank は `PCE_CDB_MASK_VBLANK_NO_BIOS` で有効化して VDC 表示レジスタを runtime 側で所有します。`pce_cdb_wait_vblank()` が参照する BIOS R5 shadow (`$F3/$F4`) も `set_vdc_control()` で更新し、sprite bit が次 VBlank で戻されないようにします。shadow SATB は直接 VRAM へ転送してから `VDC_REG_SATB_START` を維持します。pattern upload のために sprite layer を落とした場合は、refresh 後に display active なら必ず sprite layer を再有効化します。
- VDC memory control は `VN_VDC_MEMORY_CONTROL` (`VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_64_32`) を標準にします。BG size を設定し直す時に sprite cycle bit を落とすと sprite layer が見えなくなるため、`VDC_REG_MEMORY` へはこの定義を使ってください。
- ADPCM / CD-DA の CD BIOS helper から戻った後は、R5 だけでなく `pce_vdc_set_resolution(320, 224, VCE_COLORBURST_ON)`、`VDC_REG_MEMORY`、SATB start、scroll を runtime 標準値へ戻します。System Card BIOS は ADPCM 処理中に水平/垂直 timing register を触ることがあり、display enable だけの復元では画面が上下に二重表示されることがあります。

## 変更時の確認

- runtime / bank 変更後は `npm test -- --test-name-pattern "PCE VN"` を最低限実行します。
- CD image を作れる環境では VN template を build し、Geargrafx MCP で VDC control、SATB、sprite pattern VRAM、sprite palette を確認します。
- Geargrafx MCP が使えない場合は、その理由を書いたうえで EmulatorJS / Test Play screenshot を補助確認にします。
