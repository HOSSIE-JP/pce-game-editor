# PCE-CD Asset Catalog v2

VN プロジェクトで BG / Sprite / ADPCM / PSG / CD-DA の登録数が増えると、従来の常駐
metadata は bank128 `.rodata` と bank132 VN data を圧迫します。Catalog v2 は、VN で実際に
参照される asset の metadata を CD data file `assets/generated/meta/asset_meta.bin` へ移し、
RAM 常駐量を asset 数に比例させないための形式です。

CD-ROM2 VN では、BG / Sprite / ADPCM / PSG は各 512 件までを標準保証ラインにします。
CD-DA は CD 規格の物理 track 制約があるため、track 2..99 の最大 98 本までです。数百件の
音声用途には ADPCM または PSG を使ってください。

## 対象

Catalog v2 は CD-ROM2 VN build 用です。HuCard や小規模 CD project の resident mode は互換
目的で残します。

生成時は `assetIds` で絞った「VN から実際に参照される asset」だけを catalog と `cd.dataFiles`
へ含めます。Asset 一覧に未使用素材が残っていても、runtime metadata、VRAM 予約、ISO data file
は膨らませません。

## レコード配置

`asset_meta.bin` は種別ごとに sector 整列された固定長 record を持ちます。常駐側には
`pce_editor_meta_region_t { sector, count, slot }` だけを置きます。`count` と各
`pce_editor_*_asset_count` は 512 件を扱えるよう `unsigned int` です。

| 種別 | record size | 内容 |
|---|---:|---|
| BG | 128B | descriptor、palette 32B、tile/map CD ref |
| Sprite | 512B | descriptor、palette 32B、pattern CD ref、`cell_map` 最大 384 cell |
| ADPCM | 32B | size/rate/address/divider/loop/stream、ADPCM CD ref |
| PSG | 32B | song/SFX flag、period/BPM、step count、pattern count、PSG pattern CD ref |
| CD-DA | 32B | track、loop、start/end sector、end time、play frames |

レコード N の位置は `region.sector + N / (2048 / slot)`、sector 内 offset は
`(N % (2048 / slot)) * slot` です。生成ヘッダの `PCE_EDITOR_META_*` offset と runtime の
`_Static_assert` で record layout の drift を検出します。

PSG は Catalog mode では短い SFX も含めて pattern を `assets/generated/psg/<id>.bin` に出し、
`pce_editor_psg_*_pattern[]` を常駐生成しません。CD-DA も `pce_editor_cdda_assets[]` を出さず、
catalog record から decode します。

## Runtime

runtime は `vn_get_bg_asset()` / `vn_get_sprite_asset()` / `vn_get_adpcm_asset()` /
`vn_get_psg_asset()` / `vn_get_cdda_asset()` で catalog record を読みます。Record 内に
pointer は保存せず、palette、CD ref、`cell_map`、PSG pattern ref は runtime cache へ decode
してから既存構造体の形で返します。

Cache は現在、BG 2 枠、Sprite 4 枠、ADPCM 1 枠、PSG 1 枠、CD-DA 1 枠です。Cache key と
preload / loaded index は 16bit asset index として扱い、scene command の signed index は
`0..count-1` を検証してから使います。`(uint8_t)asset_index` で比較しないでください。

Accessor は CD BIOS helper、MPR 復帰、`cd_transfer_scratch` を触るため、consumer では
関数入口で 1 回呼び、必要 field を local snapshot へ落としてから hot path で使います。
特に ADPCM の multi-byte field は `memcpy` や構造体同士の連続 copy に戻さず、offset から
scalar decode してください。llvm-mos が `tii` へ畳むと WRAM 高位アドレスを落とすことがあります。

## 自動切替

`assetMetaDecision()` は次の条件で Catalog mode へ切り替えます。

- CD target である。
- 参照 asset 数が増え、resident metadata の bank128 見積もりが budget を超える。
- bank132 init data 見積もりが budget を超える。
- BG / Sprite / ADPCM / PSG のいずれかが 32 件を超える。
- PSG resident pattern 見積もりが 512B を超える。

`PCE_ASSET_META_BUDGET` で budget を上書きできます。`0` は catalog 強制に使えます。巨大値を
指定しても、32 件超の scale 判定は残ります。大量 asset build を resident mode に戻すと
bank overflow を再発させやすいためです。

Build log には catalog mode、切替理由、種別ごとの件数、catalog size、resident 削減見積もりを
出します。調査時は scene pack / font / overlay の制約と catalog metadata 制約を混同しないで
ください。

## Hard Error

- BG / Sprite / ADPCM / PSG の VN 参照数が各 512 件を超える。
- CD-DA が 98 本を超える。
- CD-DA track が 2..99 の範囲外。
- CD-DA track が重複する。
- Sprite `cell_map` が 384 cell を超える。
- PSG pattern が 2048 event を超える。
- ADPCM 1 asset が `min(65535, 65536 - adpcmAddress)` bytes を超える。

## 変更時の確認

- `pce_editor_*_asset_count` と `pce_editor_meta_region_t.count` は `unsigned int` のままにする。
- Runtime で asset index を `uint8_t` へ cast して比較しない。
- `cd.dataFiles` の安定順は、font/scene pack など VN data、asset payload、PSG pattern、
  `asset_meta.bin` の予約順を崩さない。
- Catalog record を増やす場合は、generator offset、generated header、runtime decode、
  `_Static_assert`、unit test を同時に更新する。
