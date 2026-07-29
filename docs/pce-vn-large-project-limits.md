# CD-ROM2 VN 大規模プロジェクト上限

この文書は、CD-ROM2 VNで大量の画像・音声を使うときの正式保証値と、その数え方をまとめます。対象は`targetMedia: "cd"`のVisual Novel buildです。HuCard VNの容量保証ではありません。

## 正式保証値

| 種別 | 同一ビルドの参照上限 | 数え方 |
|---|---:|---|
| ADPCM | 2048 | sceneから参照されるasset/partごとに1件 |
| BG | 1024 | 参照される`image` assetごとに1件 |
| Sprite | 1024 | 参照される`sprite` assetごとに1件 |
| Sprite Animation | 1024 | 参照Spriteから生成されるruntime Animation recordの合計。静止defaultはrecordを作らない |
| System Card PSG package variant | 512 | `assetId`と再生channelの組ごとに1件。参照PSG source asset自体も512件まで |
| CD-DA | 98 | 物理track 2..99 |

CD-DA以外の未参照assetはcatalog件数に含めません。CD-DAはCUEの物理track配置を維持するため、未参照でも登録済みの全CD-DA assetを98本上限・連番検査とディスク出力の対象にします。これらは最大値と上限+1の生成テスト、および16-bit runtime indexを前提にした正式保証ラインです。理論上のCD容量限界やindex表現の最大値そのものではありません。

## 件数上限と別に考える制約

- **ディスク容量**: 上限件数以内でも、payload合計が使用するCD容量に収まる必要があります。
- **個別ADPCM**: buffered direct playbackの安全上限以下である必要があります。自動分割された`_partNN`は、それぞれADPCM 1件として数えます。partは自動連続再生されません。
- **個別画像**: BGのBAT/VRAM、Sprite pattern/palette/SATBなど、既存の画像寸法・VRAM layout検査を通る必要があります。
- **同時表示**: Sprite catalogが1024件あっても、VN runtimeが同時に表示・保持する立ち絵は4 slotです。
- **同時再生**: ADPCMは1つのbuffered playback、PSGはBGM/SFX bus、CD-DAは物理trackというruntime上の制約があります。catalog件数は同時再生数を増やしません。
- **scene**: 1 scene packは最大8192 bytesで、scene数・command数など既存のscript上限も別に適用されます。
- **PSG package**: System Card BGM packageは8156 bytes、SFX packageは8192 bytes以下である必要があります。

## 大量payloadを扱える理由

CD管理下の次の論理ファイルは`assets/generated/vn/vn_payload.bin`へstreaming結合します。

- BG / Sprite / ADPCM payload
- `asset_meta.bin`
- Sprite Animation metadata
- System Card PSG metadataとpackage
- scene pack

各論理ファイルは2048-byte境界から始まり、`vn_payload-index.json`が`logicalPath`、`sectorOffset`、`sectorCount`、`byteSize`、hashを保持します。build時は`vn_payload.bin`先頭sectorへ相対offsetを加えたlogical sector aliasを作るため、runtimeは論理ファイル単位のCD refを維持できます。物理ファイル数がasset件数に比例しないため、Windowsのコマンドライン長や`pce-mkcd`引数数も抑えられます。

CD-DA音声はCUEの物理audio trackとして配置するため、`vn_payload.bin`には入りません。

次のruntime code blobは、link後抽出と固定8KB予約のためpackしません。

- `overlay.bin`: bank133 render/compositor overlay
- `logic_overlay.bin`: bank124 logic overlay
- `visual_code.bin`: bank121 visual helper
- `cd_async_code.bin`: bank122 async/runtime supportとSprite catalog/layout/upload

## RAMとコードbank

catalog総件数分をRAMへ読み込むことはありません。BG 8件、Sprite 4件、ADPCM 1件、表示中4 slot分のSprite Animationなど、用途別の小さいcacheだけを持ちます。Sprite Animation metadataとSystem Card PSG metadataも必要なrecordだけをCDからdecodeします。

コード側は次のhard gateを持ちます。

| bank | 役割 | 必要空き |
|---:|---|---:|
| 128 | resident起動・adapter・薄いdispatch | 1024 bytes以上 |
| 129 | resident banked code | 1024 bytes以上 |
| 130 | resident slot4 code | 1024 bytes以上 |
| 124 | `.vn_logic_overlay` | 1024 bytes以上 |

素材を追加しただけでこれらのbankへ件数比例の配列を置かないことが設計上の前提です。gateに失敗した場合は、エラーに表示されるbank名、used、free、requiredを確認し、logic/render/visual/asyncの責務に沿ってコードを再配置します。

## 上限超過時

上限を超えたassetは、登録そのものではなくCD VN buildの参照件数検査で拒否されます。使っていない素材をprojectへ保管することはできます。

- ADPCM 2049件目: sceneを分割しても同一buildで参照される限り超過です。CD-DA化、素材統合、不要参照の削除を検討します。
- BG/Sprite 1025件目: 未参照素材を外すか、別project/buildへ分けます。
- Sprite Animation 1025件目: 使わないROWを削るか、SpriteごとのAnimation定義を整理します。
- PSG package variant 513件目: 同じassetの不要なchannel違いを整理する、効果音を共用する、またはADPCM化を検討します。
- CD-DA 99本目: CD-DAは増やせないため、ADPCMまたはPSGへ移します。

## 回帰確認

- 最大件数を同時に含むCD catalog/source生成。
- 各種別の上限+1を、種別・件数・上限が分かるerrorで拒否。
- index 0、中間、末尾（ADPCM 2047、BG/Sprite 1023、Animation 1023）をruntimeで参照。
- payload packの2048-byte alignment、logical sector alias、決定的順序、hash整合。
- CD VNの実CUE buildとGeargrafx確認。
- HuCard buildと`npm test`の回帰確認。
