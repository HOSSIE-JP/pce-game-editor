# Godot VN package exporter

`pce-vn-godot-exporter` は、Novel の正規化済み scene と参照中の素材だけを
`*.pcevn.zip` へ出力します。現行 package 契約は
`format: "pce-vn-godot-package"`, `version: 3` です。

## 画像の二系統出力

BG と Sprite は、同じ asset ID に対して次の2ファイルを出力します。

- `hd`: 画像 import の resize / crop 確定後、PCE 16色減色を行う直前の PNG。
- `pce`: `palette.bin` と `tiles.bin`、または `patterns.bin` と `cellmap.bin` から再構成した indexed PNG。VCE 9-bit色、BG tile配置、Sprite cell dedupe、透明indexを最終PCE生成物どおり反映します。

標準画像 import は `hd` 用PNGをproject内の `assets/images-hd/` または
`assets/sprites-hd/` に保存し、`data.import.highQualitySource` から参照します。
このためGodot出力時に外部の元画像pathは必要ありません。旧assetにこのmetadataがない場合だけ
現行 `asset.source` をHD側へfallbackし、manifestの
`stats.visualHighQualityFallbackAssets` と出力ログへ件数を残します。

`data/assets.json` は version 2 で、visual assetは次の形です。

```json
{
  "id": "classroom",
  "type": "image",
  "file": "media/0000_classroom/hd.png",
  "visual": {
    "defaultMode": "hd",
    "hd": {
      "file": "media/0000_classroom/hd.png",
      "width": 256,
      "height": 136,
      "source": "pre-pce-quantize"
    },
    "pce": {
      "file": "media/0000_classroom/pce.png",
      "width": 256,
      "height": 136,
      "source": "generated-pce-binary"
    }
  }
}
```

package manifestは次の共通modeを宣言します。

```json
"visual": {
  "defaultMode": "hd",
  "modes": ["hd", "pce"]
}
```

`stats` は `visualAssets`, `visualHighQualityBytes`, `visualPceBytes`,
`visualHighQualityFallbackAssets` を持ちます。`files` のbyte数とSHA-256には両画像を含めます。

## Godot runtime側の切替契約

Godot Playerはpackage読込時に `visual.defaultMode` を選び、1つのUIボタンまたは
`toggle_visual_mode` input actionで `hd` / `pce` を全画面共通に切り替えます。
切替時は表示中BGと全Sprite textureを同じasset IDの別variantへ同一frameで差し替え、
scene位置、Sprite slot、animation ROW/frame、移動、fade、message/audioの進行状態を変更しません。
ボタンは現在modeを表示し、packageを開き直したときはmanifest既定の `hd` へ戻します。

## 音声・フォント

WAVはOgg Vorbis VBR quality 4へ変換し、既存OGG/MP3は再encodeしません。
選択中project fontだけを `font/` に同梱します。System Card、IPL、ROM/CUE/ISO、
PCE runtime向けraw binaryはpackageへ含めません（PCE版PNGの生成入力としてだけ使います）。
