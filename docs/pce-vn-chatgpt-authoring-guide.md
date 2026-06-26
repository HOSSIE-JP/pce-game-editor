# PCE VN ChatGPT authoring guide

この文書は、PC Engine / Super CD-ROM2 Visual Novel engine 向けのシナリオ、スクリプト JSON、画像・音声アセット案を ChatGPT に生成させるための前提ルールです。

ChatGPT へ渡すときは、この文書の「制作ルール」と「スクリプト JSON 形式」をそのまま前提情報として与え、最後に「依頼プロンプト例」を目的に合わせて書き換えてください。

## 制作ルール

- 出力するスクリプトの正本は `assets/pce-vn-scenes.json` と同じ JSON です。
- JSON は `version: 2`, `settings`, `startScene`, `scenes` を持つ 1 つの object にしてください。
- `scenes` は配列順に scene pack が生成されます。`startScene` は最初に開始する scene の `id` です。
- scene の `id` は英数字・`_`・`-` のみを推奨します。例: `opening`, `chapter1_branch_a`。
- scene の `name` は表示用です。`chapter1/opening` のように `/` 区切りにできます。
- scene 遷移は `id` 参照です。`name` を参照先に使わないでください。
- 使える command type は `background`, `sprite`, `message`, `audio`, `variable`, `choice`, `if`, `switch`, `label`, `goto`, `inputcheck`, `jump`, `wait`, `effect`, `spritetext` です。
- `preload` は旧互換の no-op なので、新規シナリオでは原則使わないでください。
- 未定義の command type や独自フィールドを作らないでください。必要な説明は JSON の外に別セクションとして出してください。
- 1 scene pack は runtime の 4096 byte cache に収まる必要があります。長い会話や分岐は複数 scene に分割し、`jump` でつないでください。
- 1 scene の command 数、message 数、choice 数、switch 数、変数数などは各 255 未満にしてください。
- 1 プロジェクトの使用文字種は既定レイアウトでおよそ 1000 種までです。漢字を大量に増やすより、表記ゆれを減らして文字種を抑えてください。
- message は画面下部の 17 文字 x 4 行に表示されます。1 message は短く、読みやすく分割してください。
- `message.text` は最大 96 文字に正規化されます。1 文を詰め込まず、2 から 4 行程度にしてください。
- `message.speaker` は最大 16 文字です。
- `choice.choices` は最大 4 個です。各 `label` は最大 24 文字です。
- `spritetext.text` は短い演出文字向けです。最大 64 文字に正規化されますが、実用上は 16 から 32 文字程度にしてください。
- `background` は BG asset を 32x32 BAT 上の tile 座標 `x`, `y` に配置します。通常は `x: 0..63`, `y: 0..31`、画面内では `x: 0`, `y: 0` または余白調整用の小さい値を使います。
- BG 切替は fade 前提です。`transition` は `"fade"`、`fadeOutFrames` / `fadeInFrames` は `10`, `20`, `30`, `40`, `50`, `60` のいずれかにしてください。既定は `30`。
- 通常 BG 画像は 256px 幅以下にしてください。画面は 256x224 px です。
- `fullScreenBg: true` の scene は 256x224 px の全画面 BG 専用です。この scene では `message`, `choice`, visible な `sprite`, visible な `spritetext` を置かないでください。`background` は `x: 0`, `y: 0` にしてください。
- `sprite` は立ち絵 slot 0..3 の表示・差し替え・非表示です。複数人を出す場合は別 slot を使ってください。
- `sprite.x` は 0..319、`sprite.y` は 0..223 の pixel 座標です。立ち絵の標準 y は 24 付近です。
- `message.mouthSlot` / `message.mouthAnimationId` を使う場合、その message より前に同じ slot へ visible な `sprite` を表示してください。
- 口パク後に口を閉じたい場合は、message の後に同じ slot へ idle animation の `sprite` command を置いてください。runtime は自動では戻しません。
- `audio.kind` は `cdda`, `adpcm`, `psg` です。`action` は `play` または `stop`。
- CD-DA 再生中に BG / sprite / ADPCM などの CD data load が入ると CD-DA は短く一時停止します。音楽を自然に始めたい scene では、BG / sprite 表示を先に置いてから CD-DA を再生してください。
- `adpcm` voice は message の `voiceAssetId` に指定できます。文字送り速度はビルド時に voice 長へ合わせて自動計算されます。
- `psg` は `psg-song` または `psg-sfx` asset を再生します。`channel` は 0..5 の基準チャンネルです。
- `variable` は `define`, `set`, `add`, `sub`, `random` を使えます。値は signed 16-bit 範囲にしてください。
- `if`, `switch`, `goto`, `inputcheck` の移動先は同一 scene 内の `label.name` です。別 scene へ行くときは `jump` または `choice.choices[].targetSceneId` を使ってください。
- `inputcheck.buttons` は `up`, `down`, `left`, `right`, `select`, `run`, `i`, `ii` から選びます。複数指定は OR 条件です。
- `effect.effect` は `fadeOut`, `fadeIn`, `blank`, `shake`, `flash` です。`frames` は 0..255、`shake` の `intensity` は 1..16。
- 色は `#rrggbb` 形式で指定します。PCE 表示可能色へ丸められるため、細かい色差に依存しないでください。
- 画像・音声などの asset ID は、最終的な `assets/pce-assets.json` に登録される ID と一致させる必要があります。未登録 ID を使うとエディタ保存時に空参照へ正規化されることがあります。
- ChatGPT が asset を提案する場合は、スクリプト JSON とは別に「asset manifest 案」と「画像生成プロンプト案」を出してください。
- 最終回答は必ず valid JSON とし、コメントや末尾カンマを入れないでください。説明は JSON の外に分けてください。

## スクリプト JSON 形式

最小構造:

```json
{
  "version": 2,
  "settings": {
    "messageSpeedFrames": 10,
    "messageAdvanceMode": "button",
    "messageAutoWaitFrames": 60
  },
  "startScene": "opening",
  "scenes": [
    {
      "id": "opening",
      "name": "chapter1/opening",
      "fullScreenBg": false,
      "nextSceneId": "",
      "commands": [
        {
          "type": "message",
          "speaker": "",
          "text": "メッセージ",
          "textColor": "",
          "voiceAssetId": "",
          "mouthSlot": 0,
          "mouthAnimationId": ""
        }
      ]
    }
  ]
}
```

### settings

- `messageSpeedFrames`: `0`, `10`, `20`, `30`, `40`, `50` のいずれか。0 が最速。
- `messageAdvanceMode`: `"button"` または `"auto"`。
- `messageAutoWaitFrames`: auto advance 時に待つ frame 数。60fps 基準。

### scene

```json
{
  "id": "opening",
  "name": "chapter1/opening",
  "fullScreenBg": false,
  "nextSceneId": "",
  "commands": []
}
```

- `id`: scene 参照用の安定 ID。
- `name`: エディタ表示名。省略可。
- `fullScreenBg`: 全画面 BG 専用 scene なら true。
- `nextSceneId`: scene 終了後の自動遷移先。空文字なら遷移しません。
- `commands`: 実行する command 配列。

## command 形式

### background

```json
{
  "type": "background",
  "assetId": "bg_classroom",
  "transition": "fade",
  "fadeOutFrames": 30,
  "fadeInFrames": 30,
  "x": 0,
  "y": 0
}
```

- `assetId`: image asset ID。
- `x`, `y`: tile 座標。
- `fadeOutFrames`, `fadeInFrames`: `10`, `20`, `30`, `40`, `50`, `60`。

### sprite

```json
{
  "type": "sprite",
  "slot": 0,
  "assetId": "akari_sprite",
  "x": 96,
  "y": 24,
  "animationId": "default",
  "flipX": false,
  "flipY": false,
  "visible": true
}
```

- `assetId`: sprite asset ID。
- `slot`: 0..3。
- `animationId`: sprite asset の animation ID。例: `default`, `blink`, `mouth`。
- `visible: false` でその slot を非表示にします。

### message

```json
{
  "type": "message",
  "speaker": "Akari",
  "text": "こんにちは。\n今日は大切な話が\nあります。",
  "textColor": "#ffffff",
  "voiceAssetId": "",
  "mouthSlot": 0,
  "mouthAnimationId": ""
}
```

- `speaker`: 話者名。空文字可。指定するとゲーム内では `話者：` が即時表示され、次行から本文が表示されます。
- `text`: 本文。`\n` で強制改行。話者名や括弧は本文に含めません。
- `textColor`: 空文字なら既定色。
- `voiceAssetId`: ADPCM voice asset ID。空文字可。
- ADPCM voice の文字送り同期は本文の文字数だけを使い、話者行は同期対象に含めません。
- `mouthSlot` / `mouthAnimationId`: 口パク用。使わない場合は `0` / `""`。

### audio

```json
{
  "type": "audio",
  "kind": "cdda",
  "action": "play",
  "assetId": "opening_theme",
  "channel": 0
}
```

- `kind`: `cdda`, `adpcm`, `psg`。
- `action`: `play`, `stop`。
- `assetId`: stop の場合は空文字でよい。
- `channel`: PSG の基準チャンネル。CD-DA / ADPCM では通常 0。

### variable

```json
{
  "type": "variable",
  "variableName": "route",
  "operation": "define",
  "value": 0,
  "min": 0,
  "max": 9
}
```

- `operation`: `define`, `set`, `add`, `sub`, `random`。
- `random` のとき `min` / `max` を使います。

### choice

```json
{
  "type": "choice",
  "variableName": "route",
  "defaultIndex": 0,
  "choices": [
    { "label": "行く", "value": 1, "targetSceneId": "go_scene" },
    { "label": "残る", "value": 2, "targetSceneId": "stay_scene" }
  ]
}
```

- `choices` は 1..4 個。
- `variableName` が空でなければ、選択した `value` が変数へ入ります。
- `targetSceneId` が空でなければ、その scene へ遷移します。

### label / goto / if / switch

```json
{ "type": "label", "name": "after_branch" }
```

```json
{ "type": "goto", "targetLabel": "after_branch" }
```

```json
{
  "type": "if",
  "variableName": "route",
  "operator": "eq",
  "value": 1,
  "targetLabel": "route_a",
  "elseLabel": "route_b"
}
```

```json
{
  "type": "switch",
  "variableName": "route",
  "cases": [
    { "value": 1, "targetLabel": "route_a" },
    { "value": 2, "targetLabel": "route_b" }
  ],
  "defaultLabel": "route_default"
}
```

- `operator`: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`。
- label 分岐は同一 scene 内だけです。

### inputcheck

```json
{
  "type": "inputcheck",
  "buttons": ["run"],
  "mode": "async",
  "targetLabel": "skip_wait"
}
```

- `mode`: `sync`, `async`, `cancel`。
- `cancel` の場合、`buttons` は空配列、`targetLabel` は空文字でよい。

### jump / wait

```json
{ "type": "jump", "sceneId": "next_scene" }
```

```json
{ "type": "wait", "frames": 60 }
```

- `jump` は別 scene へ移動します。
- `wait.frames` は 60fps 基準です。

### effect

```json
{
  "type": "effect",
  "effect": "shake",
  "frames": 16,
  "intensity": 4,
  "color": ""
}
```

```json
{
  "type": "effect",
  "effect": "flash",
  "frames": 4,
  "intensity": 0,
  "color": "#ffffff"
}
```

- `effect`: `fadeOut`, `fadeIn`, `blank`, `shake`, `flash`。
- `shake` 以外では `intensity: 0` でよい。
- `fadeOut` / `flash` は `color` を使います。

### spritetext

```json
{
  "type": "spritetext",
  "slot": 0,
  "text": "PRESS RUN",
  "x": 56,
  "y": 16,
  "color": "#ffdb00",
  "blinkFrames": 24,
  "visible": true
}
```

- `slot`: 0..3。
- `x`, `y`: pixel 座標。
- `blinkFrames`: 0 なら点滅なし。
- `visible: false` でその slot を消します。

## アセット生成ルール

ChatGPT に画像や音声案も作らせる場合は、スクリプト JSON と別に、次のような asset plan を出させてください。

```json
{
  "assets": [
    {
      "id": "bg_classroom_evening",
      "type": "image",
      "name": "背景/教室/夕方",
      "size": "256x224",
      "usage": "通常BG",
      "prompt": "PC Engine visual novel background, Japanese classroom at sunset, pixel-art friendly, clear composition, 256x224, no text"
    },
    {
      "id": "akari_sprite",
      "type": "sprite",
      "name": "立ち絵/Akari",
      "size": "transparent PNG, sprite sheet",
      "animations": ["default", "blink", "mouth"],
      "prompt": "anime visual novel character standing pose, transparent background, pixel-art friendly, front-facing, separate mouth/blink frames"
    },
    {
      "id": "opening_theme",
      "type": "cdda-track",
      "name": "音楽/Opening",
      "prompt": "loopable short opening theme, bright nostalgic PC Engine CD visual novel mood"
    },
    {
      "id": "akari_voice_001",
      "type": "adpcm",
      "name": "Voice/Akari/001",
      "text": "こんにちは。今日は大切な話があります。"
    }
  ]
}
```

画像案の注意:

- BG は 256x224 を基準にし、文字や UI を画像内に描かないでください。
- 通常 BG はメッセージ窓が下部に重なるので、重要な情報を下端 64px に置かないでください。
- Full BG 用は 256x224 ぴったりにしてください。
- Sprite は透明背景を前提にし、立ち絵の余白を含めて PC Engine で見やすいコントラストにしてください。
- Sprite animation は `default`, `blink`, `mouth` など、スクリプトから参照しやすい ID にしてください。
- asset ID は小文字英数字・`_`・`-` を推奨します。

音声案の注意:

- `cdda-track` は BGM や長い音楽向けです。
- `adpcm` は voice や短い効果音向けです。1 asset の安全上限は概ね 65535 bytes 以下です。
- `psg-song` / `psg-sfx` はチップ音源風の BGM / SE 向けです。
- voice を message に合わせる場合、`voiceAssetId` と本文を 1 対 1 で対応させると管理しやすくなります。

## ChatGPT への依頼プロンプト例

### 新規短編シナリオを作る

```text
あなたは PC Engine / Super CD-ROM2 向け Visual Novel engine のシナリオライター兼スクリプト作成者です。
以下の制作ルールと JSON 形式に厳密に従って、短編 VN のシナリオと `assets/pce-vn-scenes.json` 用 JSON を作成してください。

目的:
- 5 分程度で読める短編
- ジャンル: [ここにジャンルを書く]
- 舞台: [ここに舞台を書く]
- 登場人物: [名前、性格、口調]
- 分岐: 2 択を 1 回以上入れる
- 使用予定 asset ID:
  - BG: bg_room_evening, bg_rooftop_night
  - Sprite: akari_sprite, mika_sprite
  - CD-DA: opening_theme
  - ADPCM voice: 使う場合は voice_キャラ名_番号 の仮 ID でよい

出力形式:
1. 作品概要
2. asset plan JSON
3. `assets/pce-vn-scenes.json` として保存できる valid JSON
4. ビルド前チェックリスト

制約:
- command type は指定されたものだけを使う
- message は 17 文字 x 4 行を意識して短く分割する
- 1 scene が長くなりすぎないよう scene を分割する
- `preload` は使わない
- JSON 内にコメントを入れない
- scene / label / variable / asset ID は英数字・`_`・`-` にする
- 未登録 asset を使う場合は asset plan に必ず列挙する
- JSON は末尾カンマなしの valid JSON にする

[ここにこの文書の「制作ルール」と「スクリプト JSON 形式」を貼る]
```

### 既存 asset ID に合わせてスクリプトだけ作る

```text
次の asset ID だけを使って、PCE VN engine 用の `assets/pce-vn-scenes.json` を作ってください。

使用可能 asset:
- image: bg_classroom, bg_corridor, bg_rooftop
- sprite: akari_sprite(default, blink, mouth), mika_sprite(default, blink, mouth)
- cdda-track: opening_cdda
- adpcm: akari_voice_001, akari_voice_002, mika_voice_001
- psg-song: vn_psg_chime

要件:
- 開始 scene は `opening`
- 3 scene 程度
- `choice` で route 変数に 1 または 2 を入れる
- `if` または `switch` を 1 回使う
- 口パクは voice 付き message でだけ使う
- message 後に idle animation へ戻す `sprite` command を置く
- BGM は BG / Sprite 表示後に開始する

出力は valid JSON のみ。説明文、Markdown、コメントは禁止。

[ここにこの文書の「制作ルール」と「スクリプト JSON 形式」を貼る]
```

### 画像生成まで含めた発注書を作る

```text
PCE VN engine 用の短編シナリオ、スクリプト JSON、画像生成プロンプトを作成してください。

出力:
1. `asset_plan` JSON
2. 画像生成用 prompt 一覧
3. `assets/pce-vn-scenes.json` 用 valid JSON

画像生成ルール:
- BG は 256x224、PC Engine visual novel に合う、文字なし、下部 64px に重要情報を置かない
- Sprite は透明背景、表情差分・blink・mouth animation を作りやすい立ち絵
- 色は PCE 風に少ない色数でも成立する明快な配色
- asset ID は script JSON と完全一致

スクリプトルール:
- message は短く、改行を使う
- Full BG scene は必要な場合だけ使い、message / choice / visible sprite / visible spritetext を置かない
- CD-DA は画像ロード後に開始する
- JSON は valid JSON、コメントなし

[ここにこの文書の「制作ルール」と「スクリプト JSON 形式」を貼る]
```

## 生成結果のチェックリスト

- JSON として parse できる。
- `version` は 2。
- `startScene` が存在する scene id を指している。
- `jump.sceneId`, `choice.targetSceneId`, `nextSceneId` が存在する scene id を指しているか、空文字。
- `goto.targetLabel`, `if.targetLabel`, `if.elseLabel`, `switch.cases[].targetLabel`, `switch.defaultLabel`, `inputcheck.targetLabel` が同一 scene 内の label を指しているか、空文字。
- すべての assetId / voiceAssetId が asset plan または既存 asset にある。
- message は読みやすく分割されている。
- choice は 4 個以下。
- Full BG scene に message / choice / visible sprite / visible spritetext がない。
- CD-DA を流したい scene では、BG / Sprite command が CD-DA play より前にある。
- voice 付き message の前に mouth slot の sprite が表示済み。
- mouth animation 後に必要なら idle animation へ戻している。
- scene が長い場合は `jump` で分割されている。
