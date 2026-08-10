# PCE Visual Novel engine contract

## 目次

- 正本と対象メディア
- ドキュメントとscene pack上限
- 文字とメッセージ表示
- 背景・イベントスチル
- 立ち絵・口パク・移動
- 音声
- 分岐・入力・演出
- アセット参照
- 検証と受け入れ

## 正本と対象メディア

- シーンの正本はプロジェクトの `assets/pce-vn-scenes.json`、アセットの正本は `assets/pce-assets.json` とする。
- Scene JSONは`version: 2`を使用する。
- CD-ROM2とHuCARDは同じScene JSONを共有できるが、容量と音声機能が異なる。
- CD-ROM2はCD-DA、ADPCM、PSGを使用できる。HuCARDではCD-DAとADPCM commandは無音のno-opになり、PSGだけが鳴る。
- CD固有音声の有無でフラグ、分岐、待機結果を変えない。HuCARDでも物語が完結する構造にする。

## ドキュメントとscene pack上限

| 項目 | 上限・規則 |
|---|---|
| scene数 | 最大255 |
| 1 sceneのcompiled command数 | 最大255。`comment`とskip済みcommandはcompile対象外 |
| 1 sceneのmessage / choice / switch | 各最大255 |
| 1 choiceの選択肢 | 1〜4 |
| 1 switchのcase | 最大16 |
| ユーザー変数 | 最大253。予約変数2個を含めた総数は255 |
| CD-ROM2 scene pack | 1 scene 8192 bytes以下 |
| HuCARD scene pack | 1 scene 4096 bytes以下 |
| 整数変数 | signed 16-bit（-32768〜32767） |

- `scenes`の配列順でscene packが生成される。
- `startScene`、`nextSceneId`、`jump.sceneId`、`choice.choices[].targetSceneId`はscene `id`を参照する。表示名`name`を参照しない。
- scene ID、label、variable、asset IDは英数字・`_`・`-`を基本とする。
- 4096 bytesは台詞文字数だけで決まらない。command record、message、選択肢、Shift-JIS文字列を含む生成結果で確認する。
- 両対応では厳しいHuCARD上限に合わせて早めにsceneを分割する。

## 文字とメッセージ表示

- メッセージ窓は17文字×4行。
- `speaker`を指定すると話者行が1行を使うため、本文は最大3行を原則とする。ナレーションは本文最大4行。
- 各明示行は17文字以内にする。自動切り詰めに依存せず、意味とテンポの切れ目でmessageを分ける。
- `message.text`は最大96文字、`message.speaker`は最大16文字へ正規化される。
- `choice`の各`label`は最大24文字。
- `spritetext.text`は最大64文字だが、SATBを共有するため16〜32文字程度の短い演出文字に限定する。
- CD日本語テキストはprintable ASCII（全角化）、日本版System Card v3非漢字領域、JIS第一水準だけを使う。第二水準、CP932拡張、半角カナ、絵文字、結合文字は使わない。
- 両対応作品もCD側の文字集合制約を共通基準にする。
- 句読点、括弧、空白、改行の作風は作品ごとに決めてよい。エンジン仕様として句読点禁止や特定の空白形式を強制しない。

## 背景・イベントスチル

- 画面は256×224 px、BATは32×32 tile。
- 通常背景は幅256 px以下。VN標準の背景・イベントスチルは224×136 pxを推奨し、`background`の`x: 2`, `y: 1`で配置する。
- 224×136は通常表示向けの推奨値であり、イベントスチルの必須枚数や画風は作品ごとに決める。
- AI画像をPCE変換しやすくするには、明快な輪郭、少ない中間色、ベタ塗り寄り、弱いグラデーション、文字なしを推奨する。ただし作品の美術方針を優先する。
- メッセージ窓が重なる通常背景では、重要な顔・手掛かり・文字を下端64 pxに置かない。
- 全画面画像は256×224 pxちょうどのimage assetを使い、sceneを`fullScreenBg: true`にする。`background`は`x: 0`, `y: 0`にする。
- Full BG sceneに`message`と`choice`は置けない。`sprite`、`spritemove`、`spritetext`は使えるが、前sceneのspriteとSpriteTextは消えるため同scene内で再表示する。
- 背景切替は`transition: "fade"`を使う。`fadeOutFrames`と`fadeInFrames`は10 / 20 / 30 / 40 / 50 / 60から選び、既定は30。
- 色指定は`#rrggbb`。PCE色へ丸められるので微妙な色差だけに意味を持たせない。

## 立ち絵・口パク・移動

- runtimeの論理sprite slotは0〜3。複数人物は別slotを使う。
- `sprite.x`は0〜319、`sprite.y`は0〜223。立ち絵の標準yは24付近だが、asset寸法に合わせる。
- 同じslotへの`sprite`再指定は差し替え、`visible: false`は非表示。
- `spritemove`は表示中slotを直線移動する。同期移動は完了まで待ち、`async: true`は後続commandと並行する。
- `spritemove.animationId`を使う場合は、同じslotに表示中のsprite assetと一致する`animationAssetId`を指定する。
- `message.mouthSlot`を指定する前に、同じslotへvisibleなspriteを表示する。
- 口パク対象animation ROWの直後に対応する口パクROWを置く。runtimeはmessage開始時に次ROWへ移り、本文表示完了またはone-shot ADPCM終了時に元ROWへ戻る。
- ナレーションや画面外話者は`mouthSlot: null`またはフィールド省略とする。

## 音声

| asset type | 用途 | CD-ROM2 | HuCARD |
|---|---|---|---|
| `psg-song` | BGM | 使用可 | 使用可 |
| `psg-sfx` | SE | 使用可 | 使用可 |
| `cdda-track` | 長いBGM・音楽 | 使用可 | 無音 |
| `adpcm` | 台詞音声・短い音声 | 使用可 | 無音 |

- `audio.kind`は`cdda`、`adpcm`、`psg`。`action`は`play`または`stop`。
- PSGの`channel`は0〜5。PSG stopは`target: "bgm" | "sfx" | "all"`を使える。
- CD-DA再生中のBG、sprite、ADPCM、scene pack等のCD data loadではCD-DAが短く中断する。自然に開始したいBGMは背景・立ち絵の表示後に再生する。
- message voiceは`voiceAssetId`へADPCM asset IDを指定する。未制作なら空文字にする。
- 同じ音声IDを異なる台詞へ流用しない。音声生成後に台詞を変えた場合は音声も再生成する。
- 独立`audio` commandやHuCARDのPSG再生終了はAUTO進行の待機条件にならない。

## 分岐・入力・演出

- 同一scene内の制御には`label`、`goto`、`if`、`switch`、`inputcheck`を使う。
- sceneを跨ぐ遷移には`jump`、`choice.choices[].targetSceneId`、またはscene末尾の`nextSceneId`を使う。
- `variable.operation`は`define`、`set`、`add`、`sub`、`random`。
- 比較演算子は`eq`、`ne`、`lt`、`lte`、`gt`、`gte`。
- 予約変数`AUTO_ENABLE`は0〜1、`MSG_SPEED`は0〜6。大文字完全一致で使う。
- `inputcheck.buttons`は`up`、`down`、`left`、`right`、`run`、`i`、`ii`。複数指定はOR。`select`はAUTO切替専用なので指定しない。
- `effect.effect`は`fadeOut`、`fadeIn`、`blank`、`shake`、`flash`。`frames`は0〜255、shakeの`intensity`は1〜16。

## アセット参照

- 参照IDは必ず現行`pce-assets.json`に存在し、型がcommand用途と一致する必要がある。
- `background`は`image`、`sprite`は`sprite`、message voiceは`adpcm`を参照する。
- `audio.kind: "psg"`は`psg-song`または`psg-sfx`、`cdda`は`cdda-track`、`adpcm`は`adpcm`を参照する。
- 未登録素材はScene JSONへ直接入れず、別のasset planにID、型、用途、寸法、生成プロンプト、登録手順を列挙する。
- 新規素材を登録したあと、確定したIDをScene JSONへ反映して再検証する。
- `cache`は必要な先読みやcache無効化だけに使う。通常はruntimeの自動先読みへ任せ、根拠なく増やさない。

## 検証と受け入れ

- JSON parse、参照整合、アセット型、文字集合、Full BG制約、scene pack byte数は現行`pce-vn-manager.js`の生成・検査を正とする。
- `validate-vn-project.mjs`は追加の17文字×行数ルールも検査する。
- CD-ROM2は非書き込みinspection、HuCARDは一時コピー上のsource生成で検査する。
- スクリプト検査に合格しても、VRAM、sprite palette、PSG package、CD track、link bankなどは実ビルドで初めて確定する。
- 完成条件は対象メディアの実ビルド成功と、エミュレーターまたは実機での画面・入力・音声確認である。
