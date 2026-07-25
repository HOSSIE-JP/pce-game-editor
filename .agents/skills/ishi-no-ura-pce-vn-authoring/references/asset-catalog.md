# 「いしのうらにいる！？」再利用アセット台帳

## この文書の使い方

この台帳は `assets/pce-assets.json` の現行IDを、シナリオ作成時に使いやすい形へ整理したものです。

- スクリプトでは必ずこの文書の `ID` を使う
- 表示名やsource filenameを `assetId` に使わない
- この台帳にないIDが必要なら、スクリプトへ直接書かず「追加アセット案」に分ける
- 第1話の台詞音声は新しい台詞へ流用しない
- 第1話固有スチルは、回想や題材が一致する場合を除いて再利用しない
- 第2話以降は、シナリオに合わせた224×136の話数固有イベントスチルを最低3枚新規作成する

現行登録数:

| 種別 | 件数 |
| --- | ---: |
| image | 13 |
| sprite | 18 |
| psg-song | 5 |
| psg-sfx | 4 |
| cdda-track | 3 |
| adpcm | 280 |

ADPCM 280件の内訳は、第1話台詞音声279件とシステム音 `eye_catch_all` 1件です。

## 共通背景

通常背景はすべて224×136pxです。通常sceneでは原則 `x: 2`, `y: 1` に置きます。

| ID | 表示名 | source | 第1話での使用 | 再利用用途 |
| --- | --- | --- | ---: | --- |
| `bg_clubroom_day` | 背景/部室(昼) | `assets/images/bg_clubroom_day.png` | 7回 | 基本の部室。会話の中心 |
| `bg_clubroom_door` | 背景/部室(入口) | `assets/images/bg_clubroom_door.png` | 1回 | 入退室、廊下からの声、登場 |
| `bg_hallway_day` | 背景/廊下(昼) | `assets/images/bg_hallway_day.png` | 1回 | 登下校、退場、部室外の短い場面 |
| `bg_school_day` | 背景/私立星屑学園(外観) | `assets/images/bg_clubroom_day_01.png` | 1回 | 冒頭の学校紹介、時間経過 |

`bg_school_day` はsource filenameとIDが一致しません。スクリプトでは正本ID `bg_school_day` を使います。

## システム画像

システム画像はすべて256×224pxです。`fullScreenBg: true` のsceneで `x: 0`, `y: 0` に置きます。

| ID | 表示名 | source | 用途 |
| --- | --- | --- | --- |
| `system_01` | システム/CD-ROM2 | `assets/images/system_01.png` | 起動デモ |
| `system_02` | システム/フィクション | `assets/images/system_03.png` | 起動デモ |
| `title` | システム/タイトル | `assets/images/bg_asset.png` | タイトル画面 |
| `eye_catch` | システム/アイキャッチ | `assets/images/eye_catch.png` | エンディング後のアイキャッチ |

第2話以降も、複製したプロジェクトの `logo`、`title`、`eye_catch` sceneで共通利用します。`title` sceneから新話の開始sceneへ向かう `jump.sceneId` だけを更新します。

## 第1話固有スチル

いずれも224×136pxです。第2話以降では原則として使いません。

| ID | 表示名 | source | 第1話の用途 |
| --- | --- | --- | --- |
| `ep01_001` | イベントスチル/PCエンジン | `assets/images/ep01_001.png` | PCエンジン本体の提示 |
| `ep01_002` | イベントスチル/CD-ROM2 | `assets/images/ep01_002.png` | CD-ROM2の提示 |
| `ep01_003` | イベントスチル/ゲームバトル | `assets/images/ep01_003.png` | 実際に対戦する場面 |
| `ep01_004` | イベントスチル/下校 | `assets/images/ep01_004.png` | エンディング |
| `ep01_005` | イベントスチル/レスバトル | `assets/images/res_battle.png` | レスバ第1ラウンド |

第2話以降は、`ep02_001` のような話数別IDで新規スチルを作ります。既存スチルへ台詞だけを無理に合わせません。

## 新話イベントスチルの必須仕様

各話につき最低3枚を作成します。標準IDと役割は次のとおりです。

| ID | 標準の役割 |
| --- | --- |
| `epNN_001` | 題材または現物の提示 |
| `epNN_002` | レスバ／因果応報のクライマックス |
| `epNN_003` | エンディング／タグのオチ |

必須3枚は原則として全分岐から見られる共通経路で使用します。4枚目以降を作る場合も、役割と使用sceneを明示します。

| 項目 | 仕様 |
| --- | --- |
| サイズ | 224×136px |
| ファイル形式 | PNG |
| asset type | `image` |
| kind | `background` |
| ID | `epNN_001` から始まる話数別連番 |
| 表示名 | `イベントスチル/第NN話/場面名` |
| source | `assets/images/epNN_001.png` など |
| 配置 | 通常sceneで `x: 2`, `y: 1` |
| 使用scene | 原則として分岐合流後の共通scene |

画風:

- グラデーションを少なくする
- ベタ塗りを中心としたアニメ塗り
- 影は2〜3段階程度の明快なセル塗り
- 輪郭線とシルエットを明快にする
- 色数を抑え、大きな色面と高い視認性を優先する
- PCEの16色変換後にも人物、表情、重要な物が判別できる構図にする

避けるもの:

- 写実的な写真表現
- 油彩、水彩、厚塗り
- 3Dレンダー風の質感
- エアブラシによる広いグラデーション
- 細かいノイズ、微細な模様、過剰な反射
- 文字、字幕、ロゴ、吹き出し、ウォーターマーク、UI
- 重要な顔や物が画面端で切れる構図

キャラクターを描く場合:

- 画像生成時に、登場するキャラクターの既存sprite PNGを参照画像として添付する
- 髪型、髪色、服装、配色、年齢感を既存立ち絵へ合わせる
- 表情とポーズはシナリオの感情に合わせて変えてよい
- キャラクターを別人へ見せる大幅な衣装変更や体格変更はしない

画像生成サービスが224×136を直接出力できない場合は、構図を維持して224×136へリサイズまたはクロップしてから登録します。縦横比を変形させません。

## 立ち絵の共通仕様

- 各source sheetは128×256px
- 各animation rowのframeは64×128px
- `animationId: "default"` が通常ROW
- `row_1` が直後の口パクROW
- 台詞開始時の口パクは `message.mouthSlot` で行い、手動で `row_1` を指定しない
- 台詞完了時はruntimeが通常ROWへ戻す

標準配置:

| キャラクター | slot | x | y | message.mouthSlot |
| --- | ---: | ---: | ---: | ---: |
| 部長 | 0 | 30 | 16 | 0 |
| チカ | 1 | 180 | 16 | 1 |
| レン | 2 | 117 | 16 | 2 |

一時的な入退場や2人構図では `spritemove` で移動できますが、台詞の直前に話者のslotとassetが一致していることを確認します。

### 部長

| ID | 表情 | source | 向いている場面 |
| --- | --- | --- | --- |
| `sp_mu_01` | 通常 | `assets/sprites/sp_mu_01.png` | 導入、説明、静かな応答 |
| `sp_mu_02` | 呆れ顔 | `assets/sprites/sp_mu_02.png` | レンへの軽い返し、自分の雑さを認める |
| `sp_mu_03` | 笑顔 | `assets/sprites/sp_mu_03.png` | ゲームへの誘い、楽しさ、穏やかなまとめ |
| `sp_mu_04` | 怒り | `assets/sprites/sp_mu_04.png` | 強いツッコミ。使用は少なめ |
| `sp_mu_05` | ドヤ顔 | `assets/sprites/sp_mu_05.png` | 得意分野の説明、正論、発見 |
| `sp_mu_06` | 考え中 | `assets/sprites/sp_mu_06.png` | 話題の転換、問い、理屈の組み立て |

### チカ

| ID | 表情 | source | 向いている場面 |
| --- | --- | --- | --- |
| `sp_chika_01` | 通常 | `assets/sprites/sp_chika_01.png` | 質問、聞き役、通常会話 |
| `sp_chika_02` | ドヤ顔 | `assets/sprites/sp_chika_02.png` | 本質的なまとめ、珍しく自信のある発言 |
| `sp_chika_03` | 驚き | `assets/sprites/sp_chika_03.png` | 登場、専門用語、急展開への反応 |
| `sp_chika_04` | 笑顔 | `assets/sprites/sp_chika_04.png` | 好意的な観察、和解、楽しさ |
| `sp_chika_05` | 呆れ顔 | `assets/sprites/sp_chika_05.png` | 二人の暴走、矛盾、冷静なツッコミ |
| `sp_chika_06` | 怒り | `assets/sprites/sp_chika_06.png` | 争いを止める強い一言。多用しない |

### レン

| ID | 表情 | source | 向いている場面 |
| --- | --- | --- | --- |
| `sp_ren_01` | 通常 | `assets/sprites/sp_ren_01.png` | 通常会話、反論の準備 |
| `sp_ren_02` | 呆れ顔 | `assets/sprites/sp_ren_02.png` | 部長への反発、苦しい否定 |
| `sp_ren_03` | 怒り | `assets/sprites/sp_ren_03.png` | レスバ、ゲーム中の失敗、退場 |
| `sp_ren_04` | ドヤ顔 | `assets/sprites/sp_ren_04.png` | 最新機の主張、強がり、言い訳 |
| `sp_ren_05` | 嘲笑 | `assets/sprites/sp_ren_05.png` | 煽り。相手を傷つけるほど強くしない |
| `sp_ren_06` | 笑顔 | `assets/sprites/sp_ren_06.png` | 欲しい物を見つけた時、素直さが漏れる時 |

## PSG BGM

PSGはCD-ROM2／HuCARDの両方で使えます。

| ID | 表示名 | 第1話での使用 | 再利用用途 |
| --- | --- | --- | --- |
| `nonki_bukatsu_bgm` | のんきな部活動 | `ep01_01_openning`, `ep01_10_ending` | 導入、日常、平和な締め |
| `classroom_whisper` | 授業中のひそひそ話 | `ep01_02_clubroom`, 2つの第2分岐 | 穏やかな説明、レスバの小休止 |
| `desperate_battle` | 決死の戦闘 | `ep01_05_round1` | 大げさなレスバ開始 |
| `argument_battle` | 口論バトル！ | `ep01_08_wakai` | 口論、対戦、テンポの速い場面 |
| `club_activity_comedy` | ドタバタ部活動！ | 未使用 | 新話で利用可能。軽い混乱、追いかけ、因果応報 |

同じBGM/SFX busへ別PSG packageをloadする場合は、現行の音を先にstopする必要があります。ChatGPTが複雑なload/cache制御を独自に追加せず、基本は既存の `audio` commandだけを使います。

## PSG SFX

| ID | 表示名 | 第1話での使用 | 再利用用途 |
| --- | --- | --- | --- |
| `psg_1784890793301` | SE/やられた | `ep01_09_game_battle` | 敗北、失敗、ブーメラン成立 |
| `psg_1784890911053` | SE/レーザー | `ep01_02_clubroom`, `ep01_09_game_battle` | ゲーム操作、攻撃、機械的な合図 |
| `psg_1784891064899` | SE/警告 | 未使用 | 注意、危険、言ってはいけない事実の直前 |
| `se_pirorin` | SE/ピロリん | 未使用 | 発見、決定、軽いオチ |

PSG SFXはBGMと別busで扱われます。SFXの `channel` は既存データやエディタ設定に合わせ、ChatGPTが根拠なく変更しません。

## CD-DA

CD-DAはCD-ROM2版だけで鳴ります。HuCARD版では無音です。

| ID | 表示名 | loop | 第1話での使用 | 再利用用途 |
| --- | --- | ---: | --- | --- |
| `cdda_title` | タイトル画面 | true | `title` | 共通タイトルBGM |
| `cdda_eyecatch` | アイキャッチ | true | `eye_catch` | 共通アイキャッチBGM |
| `cdda_eye_catch_all` | いしのうらにいる！？ | false | `title`, `eye_catch` | 開始・終了の短いシリーズ音 |

これらはシステムsceneの共通素材です。通常の会話BGMにはPSGを優先します。

## ADPCM

### システム音

| ID | 表示名 | 長さ | 第1話での使用 |
| --- | --- | ---: | --- |
| `eye_catch_all` | eye_catch_all | 約1.46秒 | sceneの `audio` からは未使用 |

同内容の `cdda_eye_catch_all` がシステムsceneで使われています。新話で `eye_catch_all` を使う必要はありません。

### 第1話台詞音声

- 登録ID: `voice_0001`〜`voice_0279`
- 登録件数: 279
- 第1話のmessageで使用: 275
- 未使用: `voice_0276`, `voice_0277`, `voice_0278`, `voice_0279`
- 使用音声の合計時間: 約1060.8秒

これらは第1話本文と1対1で対応するため、新しい台詞へ流用しません。

新話の作業順:

1. ChatGPT生成時は全messageの `voiceAssetId` を空文字にする
2. シナリオと改行を確定する
3. Novel画面のIrodori-TTS音声バッチ出力を使う
4. ツールが既存IDと衝突しない `voice_NNNN` を割り当てる
5. TTSとADPCM取込後、音声バッチ反映でmessageへ設定する

古い音声assetが複製先に残っていても、sceneから参照されなければruntime出力には入りません。

## 新規アセットを提案するとき

話数固有イベントスチルは各話の必須新規アセットです。それ以外は既存素材で成立する構成を最初に検討します。追加を許可する主なケースは次のとおりです。

- ゲストキャラクターの立ち絵
- 既存背景では成立しない場所
- オチに不可欠な短いSE

ChatGPTは第1段階で、必須イベントスチルとその他の追加候補を次の形式で提案します。

```json
{
  "proposedAssets": [
    {
      "id": "ep02_001",
      "type": "image",
      "name": "イベントスチル/題材名",
      "size": "224x136",
      "requiredByScene": "ep02_05_topic",
      "reason": "この話のレスバが現物によって崩れる瞬間を見せるため",
      "imagePrompt": "224x136 anime cel illustration, flat colors, minimal gradients, clear outlines, ..."
    }
  ]
}
```

このJSONは画像制作計画であり、`pce-assets.json` へそのまま追加するmanifestではありません。画像を生成し、224×136 PNGとして保存し、Image画面でbackground assetへ登録します。更新後の `pce-assets.json` に正しいIDが存在することを確認してから完成スクリプトへ反映します。
