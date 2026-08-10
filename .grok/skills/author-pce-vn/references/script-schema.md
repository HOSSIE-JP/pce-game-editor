# `assets/pce-vn-scenes.json`記述規則

## 目次

- ルート構造
- settings
- scene
- command一覧
- command別JSON
- 予約変数
- 生成前チェック

## ルート構造

最小の保存可能例:

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
      "name": "chapter01/opening",
      "fullScreenBg": false,
      "nextSceneId": "",
      "commands": [
        {
          "type": "message",
          "speaker": "",
          "text": "物語が始まる",
          "textColor": "",
          "voiceAssetId": "",
          "mouthSlot": null
        }
      ]
    }
  ]
}
```

- JSONコメント、説明フィールド、末尾カンマを入れない。
- ルートは単一object。`version`、`settings`、`startScene`、`scenes`を持つ。
- 参照先IDが空でない場合は必ず実在させる。

## settings

```json
{
  "messageSpeedFrames": 10,
  "messageAdvanceMode": "button",
  "messageAutoWaitFrames": 60
}
```

| field | 値 |
|---|---|
| `messageSpeedFrames` | 0 / 10 / 20 / 30 / 40 / 50。`MSG_SPEED=0`時の既定速度 |
| `messageAdvanceMode` | `"button"`または`"auto"`。`AUTO_ENABLE`初期値 |
| `messageAutoWaitFrames` | 0〜255、60fps基準。音声なしAUTO等の待機 |

個々のmessageへ旧`textSpeedFrames`、`advanceMode`、`autoWaitFrames`を付けない。現在はsettingsと予約変数で管理する。

## scene

```json
{
  "id": "chapter01_opening",
  "name": "第1章/オープニング",
  "fullScreenBg": false,
  "nextSceneId": "chapter01_meeting",
  "commands": []
}
```

| field | 規則 |
|---|---|
| `id` | 安定した参照ID。重複不可 |
| `name` | エディタ表示名。省略可。`/`で階層表示可能 |
| `fullScreenBg` | 256×224全画面背景sceneだけ`true` |
| `nextSceneId` | command列終了後の自動遷移先。停止なら空文字 |
| `commands` | 実行順のcommand配列 |

Full BG sceneには`message`と`choice`を置かず、background座標を0,0にする。

## command一覧

保存可能なtype:

- `background`
- `sprite`
- `spritemove`
- `message`
- `audio`
- `cache`
- `variable`
- `choice`
- `if`
- `switch`
- `label`
- `goto`
- `inputcheck`
- `jump`
- `wait`
- `effect`
- `spritetext`
- `comment`（エディタ専用、scene packへcompileしない）

`preload`や独自command typeを作らない。

## command別JSON

### background

```json
{
  "type": "background",
  "assetId": "bg_room_day",
  "transition": "fade",
  "fadeOutFrames": 30,
  "fadeInFrames": 30,
  "x": 2,
  "y": 1
}
```

- `assetId`: `image` asset。
- `x`: tile座標0〜63。`y`: 0〜31。
- 標準224×136背景・スチルは2,1。Full BGは0,0。
- fade frameは10 / 20 / 30 / 40 / 50 / 60。

### sprite

```json
{
  "type": "sprite",
  "slot": 0,
  "assetId": "hero_sprite",
  "x": 96,
  "y": 24,
  "animationId": "default",
  "flipX": false,
  "flipY": false,
  "visible": true
}
```

非表示:

```json
{
  "type": "sprite",
  "slot": 0,
  "assetId": "",
  "x": 96,
  "y": 24,
  "animationId": "default",
  "flipX": false,
  "flipY": false,
  "visible": false
}
```

- slotは0〜3。
- visibleなspriteは登録済み`sprite` assetと実在animation IDを使う。
- xは0〜319、yは0〜223。
- 同じslotへ再指定すると差し替える。

### spritemove

```json
{
  "type": "spritemove",
  "slot": 0,
  "x": 224,
  "y": 24,
  "frames": 60,
  "async": false,
  "animationAssetId": "",
  "animationId": ""
}
```

移動とanimation変更を同時に行う例:

```json
{
  "type": "spritemove",
  "slot": 1,
  "x": 32,
  "y": 24,
  "frames": 60,
  "async": true,
  "animationAssetId": "companion_sprite",
  "animationId": "walk"
}
```

- 表示中slotを移動する。framesは1〜65535。
- `async: false`は移動完了まで待つ。`true`は後続commandと並行。
- animationを変えない場合は両animation fieldを空文字にする。
- 変える場合は表示中assetと`animationAssetId`を一致させる。

### message

```json
{
  "type": "message",
  "speaker": "アカリ",
  "text": "ここから先は\n引き返せないよ",
  "textColor": "#ffffff",
  "voiceAssetId": "",
  "mouthSlot": 0
}
```

ナレーション:

```json
{
  "type": "message",
  "speaker": "",
  "text": "夜の駅に\n冷たい風が吹く",
  "textColor": "",
  "voiceAssetId": "",
  "mouthSlot": null
}
```

- 話者あり本文は最大3行、ナレーションは最大4行。各行17文字以内を原則とする。
- `speaker`は最大16文字、`text`は最大96文字。
- 話者名や括弧を本文へ重ねて書かない。
- `voiceAssetId`は登録済み`adpcm`または空文字。
- `mouthSlot`は0〜3。対象spriteを先に表示する。口パク不要ならnullまたは省略。

### audio

CD-DA再生:

```json
{
  "type": "audio",
  "kind": "cdda",
  "action": "play",
  "assetId": "bgm_main_theme",
  "channel": 0
}
```

PSG再生:

```json
{
  "type": "audio",
  "kind": "psg",
  "action": "play",
  "assetId": "psg_room_bgm",
  "channel": 0
}
```

PSG BGM停止:

```json
{
  "type": "audio",
  "kind": "psg",
  "action": "stop",
  "assetId": "",
  "channel": 0,
  "target": "bgm"
}
```

ADPCM単独再生:

```json
{
  "type": "audio",
  "kind": "adpcm",
  "action": "play",
  "assetId": "se_door_voice",
  "channel": 0
}
```

- kindは`cdda`、`adpcm`、`psg`。actionは`play`、`stop`。
- playのasset型をkindへ合わせる。
- channelは0〜5。CD-DA / ADPCMは通常0。
- PSG stopのtargetは`bgm`、`sfx`、`all`。省略時はall。

### cache

cache判定を消す:

```json
{
  "type": "cache",
  "action": "clear",
  "scope": "visual"
}
```

明示load:

```json
{
  "type": "cache",
  "action": "load",
  "scope": "bg",
  "assetId": "bg_room_night",
  "slot": 0,
  "x": 2,
  "y": 1
}
```

PSG packageを先読み:

```json
{
  "type": "cache",
  "action": "load",
  "scope": "psg",
  "assetId": "psg_alert",
  "channel": 4,
  "slot": 0,
  "x": 0,
  "y": 0
}
```

- clear scope: `visual`、`bg`、`sprite`、`adpcm`、`psg`、`all`。
- load scope: `bg`、`sprite`、`adpcm`、`psg`。1 commandにつき1 asset。
- BG / sprite loadは表示状態を変えない。
- 同じPSG busで別packageが再生中なら、先にそのbusをstopしてからloadする。
- 通常は自動先読みに任せ、測定根拠がある場合だけ使う。

### variable

```json
{
  "type": "variable",
  "variableName": "route",
  "operation": "define",
  "value": 0,
  "min": 0,
  "max": 2
}
```

- operation: `define`、`set`、`add`、`sub`、`random`。
- randomだけmin / maxを範囲として使う。
- value、min、maxはsigned 16-bit。

### choice

```json
{
  "type": "choice",
  "variableName": "route",
  "defaultIndex": 0,
  "choices": [
    {
      "label": "扉を開ける",
      "value": 1,
      "targetSceneId": "open_door"
    },
    {
      "label": "声をかける",
      "value": 2,
      "targetSceneId": "call_out"
    }
  ]
}
```

- choicesは1〜4。labelは最大24文字。
- `variableName`が空でなければ選択valueを代入する。
- `targetSceneId`が空でなければ即scene遷移する。
- 分岐後に値を参照しないなら`variableName`を空にしてよい。

### label / goto / if / switch

```json
{
  "type": "label",
  "name": "route_a"
}
```

```json
{
  "type": "goto",
  "targetLabel": "after_branch"
}
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
    {
      "value": 1,
      "targetLabel": "route_a"
    },
    {
      "value": 2,
      "targetLabel": "route_b"
    }
  ],
  "defaultLabel": "route_default"
}
```

- label参照は同一scene内だけ。
- operator: `eq`、`ne`、`lt`、`lte`、`gt`、`gte`。
- switch caseは最大16。
- sceneを跨ぐ場合はjumpまたはchoice targetを使う。

### inputcheck

同期入力待ち:

```json
{
  "type": "inputcheck",
  "buttons": ["i", "right"],
  "mode": "sync",
  "targetLabel": "continue"
}
```

非同期監視:

```json
{
  "type": "inputcheck",
  "buttons": ["ii"],
  "mode": "async",
  "targetLabel": "skip"
}
```

監視解除:

```json
{
  "type": "inputcheck",
  "buttons": [],
  "mode": "cancel",
  "targetLabel": ""
}
```

- buttons: `up`、`down`、`left`、`right`、`run`、`i`、`ii`。複数はOR。
- `select`は指定しない。
- targetLabelは同一scene内。

### jump / wait

```json
{
  "type": "jump",
  "sceneId": "next_scene"
}
```

```json
{
  "type": "wait",
  "frames": 60
}
```

- waitは60fps基準、0〜65535 frames。

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

- effect: `fadeOut`、`fadeIn`、`blank`、`shake`、`flash`。
- framesは0〜255。shake intensityは1〜16。
- shake以外のintensityは0。fadeOut / flashはcolorを使える。

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

非表示:

```json
{
  "type": "spritetext",
  "slot": 0,
  "text": "",
  "x": 0,
  "y": 0,
  "color": "#ffffff",
  "blinkFrames": 0,
  "visible": false
}
```

- slotは0〜3、xは0〜319、yは0〜223、blinkFramesは0〜255。
- 短い演出文字専用。長文本文に使わない。
- hardware spriteとSATBを共有するため、同一走査線へ大量に並べない。

### comment

```json
{
  "type": "comment",
  "text": "分岐後の合流点",
  "color": "#66ccff"
}
```

- エディタ内注釈。保存されるがscene packにはcompileされない。
- textは最大200文字。物語上必要な処理の代用にしない。

## 予約変数

| name | 値 | 意味 |
|---|---|---|
| `AUTO_ENABLE` | 0 / 1 | 手動送り / AUTO |
| `MSG_SPEED` | 0〜6 | 0はsettingsまたは音声同期、1〜6は速度preset |

- 大文字完全一致で使う。
- `AUTO_ENABLE`はSELECTでも切り替わる。
- 予約変数をdefineしても起動初期値は変えず、そのcommand時点の代入になる。

## 生成前チェック

- `version`が2。
- `startScene`が実在する。
- scene IDとlabelが重複していない。
- scene参照と同一scene label参照がすべて解決する。
- command typeが一覧内だけ。
- asset参照が実在し、型が一致する。
- messageのspeaker、本文長、行数、1行17文字を守る。
- choiceが1〜4、switch caseが16以下。
- Full BG sceneにmessage / choiceがない。
- mouthSlotのspriteが先に表示されている。
- CD-DA playより前に必要なCD画像loadがある。
- HuCARDで無音になる音声へ進行を依存していない。
- JSON parserとvalidatorを通している。
