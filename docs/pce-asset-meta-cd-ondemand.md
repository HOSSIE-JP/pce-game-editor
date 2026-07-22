# PCE-CD VN Asset Catalog

CD-ROM2 VN buildはBG / Sprite / ADPCM / CD-DAのruntime metadataを`assets/generated/meta/asset_meta.bin`へ置きます。asset数に比例する構造体配列をbank128/132へ常駐させません。

System Card BIOS化後のPSGはこのcatalogの対象外です。CD VNは`pce_editor_psg_step_t`、PSG asset record、`PCE_EDITOR_META_PSG` region、`assets/generated/psg/<id>.bin`を生成しません。PSGは`(assetId, channel)`単位のSystem Card packageとして`assets/generated/vn/system-card-psg/`に生成されます。HuCardは従来のPSG step形式を維持します。

## 対象と件数

`targetMedia: "cd"`かつCD VN builderのprojectは常にcatalogを使います。VNから実際に参照されるassetだけを含めます。

| 種別 | 標準保証上限 | 備考 |
|---|---:|---|
| BG | 512 | raw tiles/map CD ref |
| Sprite | 512 | raw pattern CD ref、cell map |
| ADPCM | 512 | direct-buffered metadata |
| PSG source asset | 512 | catalog recordなし。package生成のvalidation上限 |
| CD-DA | 98 | 物理track 2..99 |

## レコード配置

`asset_meta.bin`は種別ごとにsector整列された固定長recordを持ちます。resident側に置くのは`pce_editor_meta_region_t { sector, count, slot }`だけです。

| 種別 | record size | 内容 |
|---|---:|---|
| BG | 128B | descriptor、palette 32B、tile/map CD ref |
| Sprite | 512B | descriptor、palette 32B、pattern CD ref、最大256-cell map |
| ADPCM | 32B | size/rate/address/divider/loop/play_frames、CD ref |
| CD-DA | 32B | track、loop、start sector、排他的end sector、end time、duration用play_frames |

record Nは`region.sector + N / (2048 / slot)`、sector内offsetは`(N % (2048 / slot)) * slot`です。generated header offsetとruntime `_Static_assert`を同時に更新し、layout driftをbuild errorにします。

## Runtime

`vn_get_bg_asset()`、`vn_get_sprite_asset()`、`vn_get_adpcm_asset()`がcatalog recordをdecodeします。CD-DAはcommand実行時に直接decodeします。recordへCPU pointerを保存しません。

cacheはBG 8枠、Sprite 4枠、ADPCM 1枠です。key/indexは16-bitで扱い、`uint8_t`へcastして比較してはいけません。consumerはaccessorを1回だけ呼び、必要fieldをruntime-owned snapshotへ落としてからhot pathで使います。

ADPCMのmulti-byte fieldを構造体連続copyへ戻さず、offsetからscalar decodeします。llvm-mosがblock transferへ畳んだときにWRAM高位addressを落とす可能性があるためです。自然終了/loop用`play_frames`はgeneratorがrecordへ焼き込みます。

## Hard error

- BG / Sprite / ADPCM / PSG参照数が各512件を超える。
- CD-DAが98本を超える、trackが2..99外、trackが重複する、またはtrack 2からの連番に欠番がある。
- Sprite cell mapが256 cellを超える。
- ADPCM 1 assetが`min(65535, 65536 - adpcmAddress)` bytesを超える。
- System Card PSG packageがBGM 8156 bytes / SFX 8192 bytesを超える。
- 同じPSG busの再生中に別packageをpreloadする。

## 変更時の確認

- catalogのstable orderとsector再計算テストを更新する。
- CD generated headerに旧PSG型/region/countが無いことを検査する。
- `font.bin`/`font_sprite.bin`/旧PSG patternがCD dataFilesに無いことを検査する。
- HuCard generated headerには既存PSG型が残ることを検査する。
- recordを増やす場合はgenerator、header、runtime decode、assert、unit testを同時に更新する。
