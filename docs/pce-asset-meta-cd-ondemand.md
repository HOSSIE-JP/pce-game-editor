# PCE-CD VN Asset Catalog / Payload Pack

CD-ROM2 VN buildは、件数に比例するruntime metadataをresident bank128/132へ配列常駐させず、CD on-demand catalogとして扱います。BG / Sprite / ADPCM / CD-DA descriptorは論理`assets/generated/meta/asset_meta.bin`、Sprite Animationは論理`assets/generated/vn/sprite_animation_meta.bin`、System Card PSGもpackage選択用metadataをCD catalogへ置きます。

これらの論理ファイル、scene pack、BG/Sprite/ADPCM payload、System Card PSG packageは、物理的には`assets/generated/vn/vn_payload.bin`へ集約します。CD-DA音声trackはpack対象外です。HuCardはresident/ROM向けの既存形式を維持し、この契約の対象外です。

## 対象と件数

`targetMedia: "cd"`かつCD VN builderのprojectは常にcatalogを使います。CD-DA以外はVNから実際に参照されるassetだけを数えます。CD-DAはCUEの物理track配置を維持するため、未参照でも登録済みassetをtrack数・連番検査とディスク出力の対象にします。

| 種別 | 同一ビルドの参照上限 | 備考 |
|---|---:|---|
| ADPCM | 2048 | 自動分割されたpartも各1件 |
| BG | 1024 | raw tiles/map CD ref |
| Sprite | 1024 | raw pattern CD ref、cell map |
| Sprite Animation | 1024 | 参照Spriteから生成されるruntime Animation recordの合計。静止defaultはrecordを作らない |
| System Card PSG package variant | 512 | `assetId`と再生channelの組ごとに1件。参照PSG source asset自体も512件まで |
| CD-DA | 98 | 物理track 2..99 |

この表は、同一CUE/ISOのsceneから参照できるcatalog件数の正式保証です。CD容量、1 assetのbyte/VRAM制約、同時描画・再生数ではありません。詳細は[pce-vn-large-project-limits.md](pce-vn-large-project-limits.md)を参照してください。

## `vn_payload.bin`とlogical sector alias

pack対象ファイルを入力順に連結し、各entryの開始を2048-byte境界へ揃えます。空payloadにも1 sectorを割り当てます。`vn_payload-index.json`は次を保持します。

- `logicalPath`
- `sectorOffset`（`vn_payload.bin`先頭からの相対sector）
- `sectorCount`
- `byteSize`
- 内容hash

CD layoutは`vn_payload.bin`の絶対先頭sectorへ`sectorOffset`を加え、元の論理ファイルpathに対するsector aliasを作ります。generator/runtimeのCD refは従来どおり論理ファイル単位で扱えますが、`pce-mkcd`へ渡す物理ファイル数はasset件数に比例しません。packとindexは一時ファイルへstreaming生成し、検証後に置換します。

次のruntime code blobはpack対象外です。

| file | bank / section | 理由 |
|---|---|---|
| `overlay.bin` | bank133 / `.vn_overlay` | render/compositor code |
| `logic_overlay.bin` | bank124 / `.vn_logic_overlay` | scene/control/Animation logic |
| `visual_code.bin` | bank121 / `.vn_visual_code` | visual helper code |
| `cd_async_code.bin` | bank122 / `.vn_cd_async_code` | CD async/runtime support、Sprite catalog/layout/upload code |

これらはlink前に4 sectorを予約し、link後にELF sectionを抽出して同じ8KB footprintへ上書きするため、独立した物理CD fileとして残します。

## レコード配置

論理`asset_meta.bin`は種別ごとにsector整列された固定長recordを持ちます。resident側に置くのは`pce_editor_meta_region_t { sector, count }`などの小さいdirectory/refだけです。

| 種別 | record size | 内容 |
|---|---:|---|
| BG | 128B | descriptor、palette 32B、tile/map CD ref |
| Sprite | 512B | descriptor、palette 32B、pattern CD ref、最大256-cell map |
| ADPCM | 32B | size/rate/address/divider/loop/play_frames、CD ref |
| CD-DA | 32B | track、loop、start sector、排他的end sector、end time、duration用play_frames |
| Sprite Animation | 256B | Sprite index、frame geometry、loop、16-bit per-frame delay |
| System Card PSG | 16B | package CD sector/count/size、BGM/SFX bus、channel |

record Nは`region.sector + N / (2048 / slot)`、sector内offsetは`(N % (2048 / slot)) * slot`です。generated header offsetとruntime `_Static_assert`を同時に更新し、layout driftをbuild errorにします。System Card PSG metadataも必要なrecordだけをCDからdecodeし、件数比例tableをresidentへ置きません。

## Runtime cache

`vn_get_bg_asset()`、`vn_get_sprite_asset()`、`vn_get_adpcm_asset()`がcatalog recordをdecodeします。CD-DAはcommand実行時にdecodeします。recordへCPU pointerを保存しません。

cacheはBG 8枠、Sprite 4枠、ADPCM 1枠、Sprite Animationは表示中4 slot分です。key/indexは16-bitで扱い、`uint8_t`へcastして比較してはいけません。consumerはaccessorを1回だけ呼び、必要fieldをruntime-owned snapshotへ落としてからhot pathで使います。

ADPCMのmulti-byte fieldを構造体連続copyへ戻さず、offsetからscalar decodeします。llvm-mosがblock transferへ畳んだときにWRAM高位addressを落とす可能性があるためです。自然終了/loop用`play_frames`はgeneratorがrecordへ焼き込みます。

## Hard error

- ADPCM参照数が2048件、BG/Sprite参照数が各1024件、Sprite Animation合計が1024件、PSG source assetまたはcompiled `(assetId, channel)` package variantが512件を超える。
- 必須の`cdda-warning`がない/重複する、ゲーム用CD-DAが97本を超える、trackが3..99外、trackが重複する、またはtrack 3からの連番に欠番がある。
- Sprite cell mapが256 cellを超える。
- ADPCM 1 asset/partがdirect-buffered安全上限を超える。
- System Card PSG packageがBGM 8156 bytes / SFX 8192 bytesを超える。
- 同じPSG busの再生中に別packageをpreloadする。
- payload packの論理path重複、missing file、index/pack不整合、sector範囲外。

## 変更時の確認

- 最大件数と上限+1のcatalog regressionを更新する。
- payload packの決定的順序、2048-byte alignment、sector alias、hash、atomic更新を検査する。
- CD generated headerに件数比例のresident Animation/PSG metadata配列が無いことを検査する。
- `font.bin`/`font_sprite.bin`/旧PSG patternがCD payloadに無いことを検査する。
- 4つのruntime code blobが`vn_payload.bin`へ混入しないことを検査する。
- HuCard generated headerには既存resident/ROM形式が残ることを検査する。
- recordを増やす場合はgenerator、header、runtime decode、assert、unit testを同時に更新する。
