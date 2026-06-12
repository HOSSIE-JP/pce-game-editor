# PCE / Super CD-ROM2 メモリバンク運用ルール

このメモは、PCE Game Editor の CD-ROM2 / VN runtime で使う HuC6280 MPR と llvm-mos section の割り当てを固定化するための引き継ぎルールです。

## 基本方針

- CD-ROM2 build では、背景 tiles/map、sprite pattern、ADPCM 本体のような大きい payload は RAM bank へ詰め込まず、`cd.dataFiles` に並べて CD sector から VRAM / ADPCM RAM へ直接転送します。
- CPU が頻繁に読む小さい runtime data だけを RAM bank に置きます。表示 asset の実体は CD data file 優先です。
- `cd.dataFiles` は sector 64 以降に並ぶ前提で generated metadata に sector を埋め込みます。build は IPL program の後ろへ padding file を挟み、ISO 上の最初の data file が sector 64 から始まるようにします。
- VN runtime は `template/template_pce_vn_cd/src/pce_vn_runtime.c` が単一の実体です。project 側へ同期されるので、bank ルール変更は必ず template を直します。

## CD-ROM2 RAM Bank Map

| Bank | MPR | 主用途 | ルール |
|---:|---:|---|---|
| 128 | 2 | llvm-mos 既定の常駐 `.text` / `.rodata` | 起動・薄い制御・小さい rodata 用。大きい runtime や asset を押し込まない。CD BIOS や VN data access 後に常駐 metadata を読む場合は `map_resident_data()` で戻す |
| 129 | 3 | VN runtime の banked code | `PCE_RAM_BANK_AT(129, 3)` と `VN_BANKED_CODE` で command interpreter / sprite refresh / ADPCM 制御を置く。asset data を置かない |
| 130 | 4 | CD fallback の小さい CPU-readable data | 例外的な fallback 用。通常の画像・sprite・ADPCM payload には使わない |
| 131 | 5 | CD fallback の小さい CPU-readable data | bank130 と同じ。将来の一時 data 用に空きを保つ |
| 132 | 6 | VN generated data | `PCE_VN_DATA_SECTION` / `PCE_VN_FONT_SECTION`。font tiles、message/choice/switch/command/scene tables と variable 初期値を置く |

## 実装ルール

- `ram_bank129` は起動時に `pce_ram_bank129_map()` で MPR3 へ常時 map します。`VN_BANKED_CODE` 関数はこの前提で直接呼びます。ADPCM の load/play/streaming 制御も bank128 を圧迫しないよう bank129 側へ置きます。
- `ram_bank128` の常駐 data を読む runtime code は、CD BIOS helper や `map_vn_data()` 呼び出し後に `map_resident_data()` を挟んでから参照します。特に `pce_editor_sprite_assets[]`、`pce_editor_sprite_draw_meta[]`、CD data ref のような小さい metadata は bank128 resident data として扱います。
- 生成済み C metadata は scene 生成時に asset ID を index へ解決済みで、runtime では ID 文字列を使いません。`pce_editor_psg_asset_t` / `pce_editor_adpcm_asset_t` / `pce_editor_cdda_asset_t` に `id` field を戻すと bank128 の `.rodata` を直接圧迫するため、debug 用文字列は JSON 側に留めます。
- `ram_bank132` を読む前は `pce_vn_font_tiles_map()` または runtime の `map_vn_data()` を呼びます。MPR6 を切り替えるため、MPR6 上で実行される code を作らないでください。
- 現状の VN script は scene 単位に CD から動的ロードする形式ではなく、`pce_vn_commands[]` / `pce_vn_messages[]` / `pce_vn_scenes[]` などを bank132 の常駐 generated data としてまとめて置きます。scene 単位ロードへ移行する場合は、command/message のポインタ参照をなくした relocatable pack 形式と cache/invalidate ルールを別途設計してください。
- `pce_vn_commands[]` や `pce_vn_messages[]` の要素は、CD / asset bank / VDC 転送で MPR が変わる可能性を考え、必要なら stack local にコピーしてから処理します。特に ADPCM は BIOS 呼び出し前に data size、address、divider、loop、stream、CD sector を local snapshot へコピーし、BIOS 呼び出し後に `pce_editor_adpcm_assets[]` のポインタを再読みに使わないでください。
- `pce_editor_map_asset_bank()` を使う banked asset fallback は bank130-131 のみを使います。bank129 と bank132 は VN runtime / VN data 専用です。
- CD-ROM2 の BG `map_vram.bin` は CD 上では64タイル幅のソース行です。`mapBase` からファイル全体を一括転送すると、行末が次行左端へ回り込んで本来画像にない縦縞が出ます。runtime は `cd_transfer_scratch` へ1 sectorずつ読み、各行の `width_tiles` 分だけを `mapBase + command.y * VN_MAP_WIDTH + command.x + row * VN_MAP_WIDTH` へコピーし、左右/上下余白は `clear_screen_map()` のblank tileを残します。
- sprite 描画に必要な cell size、sheet cell 数、pattern base、palette bank は generated `pce_editor_sprite_draw_meta[]` にも小さく出します。runtime はこの compact metadata を `sprite_draw_meta` へコピーしてから SATB を組み、animation metadata は `frame_count > 1` かつ sheet 範囲内のときだけ frame size として使います。単一 frame / default animation は sprite sheet 全体を表示します。
- sprite pattern は VRAM の sprite pattern 領域へ転送し、SATB は `VN_SATB_ADDR` (`0x7f00`) を使います。CD-ROM2 では BIOS sprite table helper へ shadow SATB を渡した後、`VDC_REG_SATB_START` を維持します。pattern upload のために sprite layer を落とした場合は、refresh 後に display active なら必ず sprite layer を再有効化します。
- VDC memory control は `VN_VDC_MEMORY_CONTROL` (`VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_64_32`) を標準にします。BG size を設定し直す時に sprite cycle bit を落とすと sprite layer が見えなくなるため、`VDC_REG_MEMORY` へはこの定義を使ってください。

## 変更時の確認

- runtime / bank 変更後は `npm test -- --test-name-pattern "PCE VN"` を最低限実行します。
- CD image を作れる環境では VN template を build し、Geargrafx MCP で VDC control、SATB、sprite pattern VRAM、sprite palette を確認します。
- Geargrafx MCP が使えない場合は、その理由を書いたうえで EmulatorJS / Test Play screenshot を補助確認にします。
