# PCE VN → GB Studio exporter 仕様・実装記録

## 文書の状態

- 状態: **Phase 1実装済み・Phase 2主要command実装済み**
- 対象日: 2026-08-24
- plugin ID: `pce-vn-gb-studio-exporter`
- 出力: GB Studio 4.3.1/4.3.2 `Color + Monochrome` 単一ROM project

この文書は、PCE Game EditorのVisual Novel projectをGame Boy / Game Boy Color
両対応のGB Studio projectへ変換する実装仕様、検証記録、将来Phaseの引継ぎ正本です。
公開APIとUI手順は`PLUGIN.md`と`docs/user-guide.md`、実装は
`pce-vn-gb-studio-exporter.js`および`pce-vn-gb-studio-*.js`を正とします。
GB Studio 4.3.1/4.3.2のschemaとevent compilerは選択した同版本体、生成物は公式build結果をauthorityとし、
古い移植projectの派生fileを正として扱いません。

## 目的

PCE VN v2の正規化済みscene documentと参照中assetから、次を決定的に生成します。

- Game BoyとGame Boy Colorで動く1本のROMを作るGB Studio project
- GBC向けのscene別カラー背景
- DMG向けの4階調背景
- 日本語本文、話者名、2択分岐、scene遷移
- PCE PSG BGMを変換したhUGE/MOD音楽
- 変換根拠、近似、欠落、色・tile・font・音楽の監査結果
- 再出力の所有権と入力identityを証明するmanifest

最低限の成功条件は「画像やJSONを生成した」ことではありません。正規化した
全入力commandが、生成、明示的省略、または位置付きerrorのいずれかに分類され、
必須commandがすべて消費され、選択したGB Studio 4.3.1/4.3.2の公式ROM/Web buildを通せることです。

## 背景となる実績

過去の「いしのうらにいる！？」第1話から第3話の個別移植では、主要な変換script
3本が各話で同一hashのまま再利用され、話数差分は設定へ分離できました。第1話では
511 commands、275 messages、2 choices、13 backgrounds、5 PSG songs、4 font pagesを
消費した実績があります。

別のGB Studio 4.3.1 projectでは、`Color + Monochrome`、起動時の機種判定、
GBC/DMG別scene graph、27組のGBC/DMG背景、ROM/Web公式build、両モードのruntime
確認まで成立しています。

ただし、過去の個別移植器には次の作品固有処理があり、そのまま本機能へコピー
しません。

- 話者名、表情asset、曲asset、イベントスチルのhard-code
- `choice1` / `choice2`だけを認める変数mapping
- 2択だけを前提にしたevent生成
- PSG songを256 stepsに限定したMOD生成
- 6chから4chへの固定かつ未監査の縮約
- GBC背景にもDMG相当の192 unique tilesを要求する不要な画質低下
- GB Studio公式`ui.c`全体を複製するengine override

本機能はこれらを一般化し、外部repositoryのコードをコピーせず独自実装します。

## 成果物と責務

### PCE Game Editor側

次の3層に分けます。

1. `pce-vn-gb-studio-exporter` plugin
   - Novel toolbar action
   - preflight modal
   - font、CD-DA、背景override、警告確認UI
2. 再利用可能な変換core
   - source inventoryと正規化
   - 中間表現、graph、asset変換、GB Studio resource生成
   - manifest、diagnostics、validation
3. テスト用CLI
   - GUIを使わずfixtureと実projectを同じcoreで生成・検証
   - CIとgolden regressionで利用

plugin固有の分岐を`main.js`、preload、Novel editor本体へ追加しません。
rendererは`novel-toolbar-action` capabilityを登録し、main側処理はplugin manifestの
`hooks`と`mainApi.hooks`へ宣言した汎用hookから呼びます。

### GB Studio側

出力projectはエクスポーター管理の生成物です。MVPでは次を行いません。

- 任意の既存GB Studio projectへのmerge
- GB Studio editorで手編集した生成scene/eventの自動3-way merge
- 4.3.1/4.3.2以外のschema互換
- 生成projectをPCE側へ逆import

手編集する場合は生成projectを複製し、エクスポーター所有から切り離します。

## 必須環境

### GB Studio

GB Studio 4.3.1または4.3.2の実行file指定をproject生成時から必須とします。engine versionは
`4.3.0-e1`を期待し、実行file、app metadata、engine headerのversionが一致しない場合は
開始しません。
検出は選択した`gb-studio.exe`と同階層の`resources/app.asar`から
`package.json`と`appData/engine/engine.json`だけを読みます。Electron main processでは
ASAR対応`fs`を迂回する抽出APIとWindows native entry pathを使い、archive本体を通常fileとして開きません。

二段階の実行modeを提供します。

| mode | 内容 |
|---|---|
| Project生成 | 4.3.1/4.3.2とengineを検証し、project、resource、独自plugin、監査fileを生成する。ROM buildは行わない |
| 生成＋検証 | Project生成に加え、隔離profileの選択版でROM/Webを公式出力して成果物を検査する |

GB Studio本体、engine source、公式`ui.c`をPCE Game Editorへ同梱しません。

### 組み込みfont

Misaki Gothic 8×8 BDF 2021-05-05版を、原著作者表示とライセンス文とともに
エクスポーターへ同梱しています。確認済みのライセンスは、改変の有無、
商用・非商用を問わず利用、複製、再配布を許可しています。

実装では次を行っています。

- font binary、原文license、version、source URLまたは入手元を保存
- `docs/release-dependencies-and-licenses.md`へ追記
- packaged applicationへfontとlicenseが入ることをtest
- 出力manifestへfont SHA-256とlicense IDを記録

## 入力の正本

変換入力は次の同一snapshotです。

- Novel editorの正規化済み現在scene document
- diskから再読込した`assets/pce-assets.json`
- 参照中assetのsource fileと現行generated metadata
- `assets/pce-vn-gb-studio-export.json`の保存済み変換設定
- export UIで今回選択したfontとoverride

sceneの正本はv2 `commands`です。旧scene fieldは現行
`normalizeSceneDocument()`相当を通した後のcommandだけを扱います。

`skip: true`など現行`compiledSceneCommands()`から除外されるcommandは、runtime入力とは
別にsource inventoryへ`source-skipped`として記録します。実行対象commandを無言で
除外してはいけません。

## 書込みと安全性

preflightは非書込みです。次の順序を固定します。

1. editor snapshot、asset catalog、sidecar、GB Studio versionを読む。
2. 入力hashと`inspectionSignature`を作る。
3. 中間表現、diagnostics、preview、見積りを生成する。
4. ユーザーがfont、mapping、override、警告を確認する。
5. 出力先を選択する。
6. main hookがscene、asset、sidecar、source file、GB Studio versionを再検査する。
7. signatureがpreview時と同じ場合だけ一時directoryへ全成果物を生成する。
8. static validationを完了する。
9. 再出力なら既存manifestの所有権を確認し、scoped backupを作る。
10. 検証済み一時directoryを出力先へ反映する。
11. 出力成功後だけ、同じscene snapshotとsidecarをPCE projectへ保存する。

cancel、error、signature差分では、出力project、scene document、sidecarを変更しません。

再出力で上書きできるのは、出力rootのmanifestが次を満たす場合だけです。

- formatとversionが対応している
- source project identityが一致する
- exporter IDが一致する
- owned pathsが列挙されている
- 解決後の各owned pathが選択された出力root内にある

manifestのないdirectory、別sourceの出力、所有外fileとの衝突はerrorです。再帰削除の
対象を未解決path、環境変数、globから作りません。

## Preflight UI

Novel toolbarに`GB Studio出力`を表示します。pluginをOFFにするとcapabilityとボタンを
ともに消します。CD-ROM2とHuCARDのどちらも同じVN v2入力として対象にできますが、
PCE固有のCD/ROM配置は出力しません。

modalは少なくとも次を表示します。

- source scene、実行command、message、choice、asset件数
- command type別の変換、近似、省略、error件数
- 背景thumbnail、通常/全面、focus、crop、analysis mask
- GBC palette数、tileごとの色数、知覚色差、unique tile数
- DMG各shadeの使用率、threshold、相関、unique tile数
- PSG曲、step数、loop、channel競合、欠落event数
- CD-DA playごとの代替mapping
- font種別、font page、glyph、未収録文字、atomic unit overflow
- output ownershipと前回manifest identity
- static validationと任意の公式build検証。runtime検証は未実行の外部gateとして表示

warningが1件でもあれば確認checkboxを要求します。errorが1件でもあれば生成を開始できません。
大量項目はpaginationまたはvirtualizationし、全thumbnailや診断を一度にDOMへ置きません。

## 中間表現

PCE固有構造から直接`.gbsres`を出さず、最初に小さい中間表現へ正規化します。
各recordには必ず`sourceSceneId`と0始まり`sourceCommandIndex`を持たせます。

中間表現で扱う状態は次です。

- backgroundとfullscreen/event-still区分
- message、speaker、text color、voice substitution
- choice、値、target scene
- scene jumpとimplicit next scene
- waitと単純fade
- BGMのasset、play/stop、loop状態
- 意図的に省略するvisual command
- source location、stable semantic key、diagnostic

source command数をtype別に数え、すべてを次のどれかへ一意に分類します。

- `generated`
- `substituted`
- `omitted-confirmed`
- `source-skipped`
- `error`

1 commandを複数回消費したり、実行commandが分類されず消えたりした場合はerrorです。

## Stable ID

scene、event、background、font、music、variable、symbolのIDは、source位置の単純な配列index
ではなくsemantic keyから安定生成します。例:

```text
scene:<source-project-id>:<source-scene-id>:<segment>:<mode>
event:<source-scene-id>:<command-index>:<role>:<mode>
background:<asset-id>:<layout-hash>:<mode>
music:<asset-id>:<conversion-profile-hash>
font:<font-hash>:<page>
```

別commandの挿入で無関係なresource IDが変わらないことをgolden testで確認します。

## Scene graph生成

### 背景単位の分割

GB Studio sceneはbackground変更点でsegmentへ分割します。分岐先sceneにbackground commandが
ない場合は、全incoming pathで同じbackground状態になることを証明して継承します。
異なるbackgroundが同じsceneへ合流する場合は、entry state別segmentへ分けるかerrorにし、
辞書順などで1つを選びません。

各segmentはentry時に次を復元します。

- mode別background
- BGM play/stop/loop状態
- dialogue runtime設定
- source上必要なその他MVP状態

### GB/GBC分岐

生成projectのcolor modeは`mixed`です。boot sceneに
`EVENT_IF_COLOR_SUPPORTED`相当を置き、次へ一度だけ振り分けます。

```text
device_dispatch
  ├─ GBC graph: <scene-key>
  └─ DMG graph: <scene-key>:dmg
```

以後のjump、choice、ending returnは必ず同じmode内へ閉じます。GBC sceneからDMG scene、
DMG sceneからGBC sceneへのedgeはvalidation errorです。

## MVP command mapping

| PCE VN入力 | GB Studio 4.3.1/4.3.2出力 | 契約 |
|---|---|---|
| `background` | mode別backgroundを持つscene segment | background変更点でscene分割。通常/全面とfadeを反映 |
| `message` | dialogue準備event、font選択、文字音、`EVENT_TEXT` | 本文と話者を欠落させない |
| 2択`choice` | font選択、`EVENT_CHOICE`、値設定、mode内scene switch | 2 labelを同一font pageへ置く。値とtargetを保持 |
| `jump` | mode内scene switch | target存在と到達性を検査 |
| `nextSceneId` | segment末尾のmode内scene switch | 明示jump/choiceがあれば二重生成しない |
| `wait` | frame単位wait | 1未満、範囲外はsource位置付きerror |
| `background` fade | scene transition/fade event | source frameを最も近い表現へ変換し差を記録 |
| `effect: shake` | camera shake | frame数と強度を近似 |
| `variable` / `if` / `switch` / `label` / `goto` | GB variable・条件分岐・mode内scene switch | label、case、fallback参照を検査 |
| sync/async/cancel `inputcheck` | await input・scene-local input callback・callback解除 | 成立時に同groupの全callbackを解除 |
| PSG song play | hUGE music play | source順序とloop状態を保持 |
| PSG song stop | music stop | source順序を保持 |
| `comment` | runtime eventなし | `generated-metadata`として消費を記録 |

`message.textColor`は本文そのものではなく視覚属性です。MVPで同色を表現できない場合は
既定dialogue paletteへ近似し、source色と出力policyをwarningへ記録します。本文を省略しては
いけません。

`inputcheck`はtitleを含む全sceneで変換します。targetありasyncは指定labelへ、targetなしasyncは
直後の`wait`を早送りする経路、または後続sync inputの通常継続へ接続します。たとえば
targetなしA/RUN、targetあり右、sync左を並べた3経路では、A/RUNがsync直後の通常flow、右と左が
各labelへ進みます。いずれかが成立した時点で同じ入力待ちgroupをすべて解除します。

## MVPでの省略とerror

「未対応」は一律のwarningではありません。

### 明示確認後に省略できるもの

- `sprite`
- `spritemove`
- `shake`以外の純粋な画面effect（background transitionのfadeは別途変換）
- 独立ADPCM再生
- 変換不能な`psg-sfx`

これらはpreflightで件数とsource位置を表示し、ユーザーが省略を確認した場合だけ
`omitted-confirmed`にできます。既定で黙って省略しません。

### MVPで必ずerrorにするもの

- 3択以上、targetなし、重複値などMVP契約外のchoice
- 未解決label、case、fallbackを持つ`if` / `switch` / `goto`
- 直後の`wait`にも後続sync inputの通常継続にも接続できないtargetなしasync `inputcheck`
- 未知command
- 未解決scene、asset、font、music参照
- mappingされていないCD-DA play
- BGMとして分類されたaudioの省略

制御flowや状態をwarningで落として「変換成功」にしません。

## Dialogueと日本語font

### 表示形式

名前付きmessageは次の1 atomic unitとして生成します。

```text
【話者】
本文
```

ナレーションは話者行を付けません。既定layoutは次です。

| 種別 | `textY` | 用途 |
|---|---:|---|
| 名前付きmessage | 0 | `【話者】`をframe上段へ置き、本文をその下へ表示 |
| ナレーション | 1 | 空の話者行を作らず本文だけ表示 |

dialogue overlayの出入りはinstantを既定とします。A入力は標準の2段階動作を維持します。

1. typewriter途中のAは現在本文を完成する。
2. 次のAで閉じる、または次messageへ進む。

### Font選択UI

exportごとにfont選択画面を表示します。

- `builtin:misaki-gothic-8x8`を既定・推奨
- custom BDF
- custom TTF/OTF

custom fontは出力前に全文字を8×8でrasterizeし、native-size contact sheetを作ります。
潰れ、欠け、空glyphを自動検出できない場合もvisual確認を要求します。外部fontの絶対pathは
sidecarや出力manifestへ保存せず、出力へ含めるfont byteとlicenseのhashだけを記録します。

### Page packing

messageは1件、choiceは2 labelを合わせた1件をatomic unitとします。1 unitを複数font pageへ
分割しません。

GB Studio 4.3.x用pageではbyte `32..255`に対応する224 physical slotsを維持し、次を予約して
空けます。

- `0x25`: formatted-text prefix
- `0x5c`: assembler escape prefix

したがって1 pageの安全なmapped codeは222です。code holeを詰めてPNG上のphysical tile位置を
変えてはいけません。各message、choice labelの先頭へ`!F:<font-id>!`を付け、compilerのUnicode
encodingとruntime page選択を一致させます。

次はerrorです。

- fontに存在しないvisible文字
- 1 atomic unitが222 safe codesを超える
- reserved codeへの割当
- mapping、PNG位置、`.gbsres`、inline tag、compiled byteの不一致

不明文字を`□`へ自動置換しません。本文欠落禁止の契約を優先します。

### 独自dialogue準備plugin

GB Studio 4.3.1/4.3.2の公式`ui.c`は複製・patchしません。公開される`ui_load_tiles()`と
`ui_set_start_tile(TEXT_BUFFER_START, 0)`を呼ぶ独自のengine pluginとcustom eventを
生成します。各framed Message/Choiceの直前で次の動作を行います。

- UI frame tileを再ロード
- text tileを`TEXT_BUFFER_START` bank 0へ戻す

pluginのC実装、event compiler、manifestは独自に記述し、engine versionを
`4.3.0-e1`へ固定します。両対応版で必要symbolが存在することをexport前に検証します。
このeventが欠落したMessage/Choiceをstatic validatorでerrorにします。

## 背景変換

source masterと変換結果を別fileとして保持します。PCE向けgenerated tile/palette binaryを
GBC sourceとして使わず、登録assetの元画像をproject root内から読みます。project外path、
missing file、path traversalを拒否します。

### 構図

通常背景は次の構図を既定とします。

- 出力: 160×144
- artwork: 上部160×96
- dialogue用領域: 下部48px

sourceを一度160px幅へresizeし、aspect比を維持してcropまたはcontainします。タイトル、logo、
event stillは160×144全面を使います。各assetに次のoverrideを持てます。

- `layout: message-safe | fullscreen`
- `focusX`, `focusY`
- source crop
- DMG threshold解析用art mask
- composition固有の簡略化指定

空間解像度を、未計測のtile制約を理由に先回りして落としません。

### GBC量子化

Game Boy Colorは背景palette 0..6の最大7本を画像へ使い、palette 7をdialogue UIへ予約します。
hardware上は合計8 paletteですが、「背景8 palette」として使い切ってはいけません。

各8×8 tileは最大4色です。初期実装は次の決定的処理を採用します。

1. sourceを最終160×144構図へ変換する。
2. RGBをGBC 15-bitで表現可能な色へsnapする。
3. tileごとに最大4色のlocal palette候補を作る。
4. local paletteを知覚色空間の誤差で最大7 clusterへまとめる。
5. tileを最小誤差のclusterへ割り当てる。
6. assignmentとcluster medoid/representativeを収束まで反復する。
7. 各tileを割当paletteの4色へ量子化する。
8. 選択したGB Studio 4.3.1/4.3.2のauto palette結果と公式buildを確認する。

RGB成分の単純二乗距離だけを品質指標にしません。少なくとも知覚色差、tileごとの色数、
palette使用数、unique 8×8 tiles、source hash、output hashを記録します。

ditheringは既定OFFです。採用する場合は画像別overrideとし、unique tile、ROM bank、native-size
表示を再検証します。

GBC背景へDMGの192 unique tile上限を適用しません。160×144全画面の位置数は360ですが、
engine側の予約と圧縮はGB Studio公式buildを最終 authorityとします。実測buildが通る限り、
推測したtile数を理由に中間解像度を落としません。

### DMG量子化

DMG派生は次をすべて満たします。

- 160×144
- exact colors: `#E0F8CF`, `#86C06C`, `#306850`, `#071821`
- 原画に階調がある場合はartwork領域で4 shadeを意味のある量だけ使用
- 最大192 unique 8×8 tiles
- sourceに対する暗部・明部の順序を維持

処理は次です。

1. dialogue band等を除いたanalysis maskからRec.709知覚輝度を取る。
2. 画像別の4-class multi-Otsu thresholdを決める。
3. 全画面へ同thresholdを適用する。
4. shade count、使用率、luminance correlation、unique tileを測る。
5. 192 tilesを超えた場合だけ、thresholdを`[64,128,192]`へ0.05刻みでblendする。
6. 最もadaptive比率が高い合格結果を採用する。

artwork領域の各shadeは最低`max(16 pixels, 0.1%)`を初期floorとします。孤立pixelやdialogue
bandだけで4色使用を満たした扱いにしません。単色blankや元から階調が少ない原画は、存在しない
階調を捏造せず`GBVN_DMG_SHADE_UNDERUSE`の確認必須warningにします。許可外色と192 tile超過は
引き続きerrorです。必要ならcrop、focus、局所簡略化のoverrideを使い、自動で全画像を
低解像度化しません。

### Visual evidence

生成ごとに次を作ります。

- GBC native-size contact sheet
- DMG native-size contact sheet
- 同一cutのGBC/DMG横並びsheet
- source/GBC/DMGの比較sheet
- 暗いsceneを含むpalette/tile report

contact sheetだけを合格根拠にせず、数値、GB Studio resource、公式build、runtimeを別々に
検証します。

## Audio変換

### PSG song

入力は現行PCE PSG v2の`psg-song`です。1..4096 steps、最大2048 pattern events、ch0..5を
扱い、過去移植の256-step前提を持ち込みません。

hUGE/MODの4 channelへ次の論理roleを割り当てます。

- pulse 1
- pulse 2
- wave
- noise

自動mappingはsource channel、note、volume、wave、noise、同時発音を解析して決めます。
初期候補はch0→pulse 1、ch1/ch2→pulse 2候補、ch3→wave、ch4/ch5→noise候補ですが、
曲ごとの競合を監査し、sidecarのchannel overrideを優先します。

次を黙って行いません。

- 同時発音の上書き
- ch1/ch2またはch4/ch5の片方を理由なしに破棄
- 範囲外noteの無通知transpose
- source loop pointの行境界への無通知丸め
- source song長を256 stepsへ切り詰め

loop pointがMOD pattern境界にない場合はpatternを分割して正確に表現します。正確に表現
できない場合はerrorです。最終rowには必要なBxx jumpを置き、非loop songはendとして扱います。

曲ごとのauditには次を残します。

- source/output hash
- source BPM、steps、loop point
- channel mappingとoverride
- mapped、merged、dropped、transposed event件数
- eventごとのsource step/channelと処理理由
- tempo/timing誤差
- output MOD signature、pattern数、bytes
- GB Studio resource IDとbuild warning

BGMのplay、stop、loop位置はscript順で保持します。BGM eventの欠落はerrorです。

### CD-DA

参照中の各CD-DA playへ次のいずれかを明示します。

| mapping | 用途 |
|---|---|
| PCE PSG代替 | 登録済み`psg-song`をMOD変換して使用 |
| 外部MOD | ユーザー指定のGB Studio 4.3.1/4.3.2対応MODをcopyして検証 |
| generated jingle | 将来Phase。短い非BGM cueを決定的tone列へ置換 |
| omit non-BGM | 将来Phase。BGMでないことを明示確認してwarning付き省略 |

mappingなしはerrorです。loop CD-DAやBGM指定のcueを`omit non-BGM`へできません。波形から
自動採譜して4ch曲を生成する機能はMVP対象外です。

### SFXとvoice

- `psg-sfx`: 明示mappingした単純toneへ近似、またはBGMでないことを確認して省略
- `message.voiceAssetId`: voice audioは含めず、話者別text toneへ置換
- 独立ADPCM play: 明示mappingした単純toneへ置換、またはBGMでないことを確認して省略
- 明示audio stop: 対応中のGB music/SFX状態だけへ適用

話者toneはspeaker identityから安定生成し、毎message直前に設定します。branch joinや
ナレーションで前話者のtoneを継承しません。全substitutionをmanifestへ記録します。

## 生成project

現行構成は次です。

```text
<output>/
  <project>.gbsproj
  project/
    settings.gbsres
    variables.gbsres
    scenes/**/*.gbsres
    palettes/*.gbsres
  assets/
    backgrounds/pce-vn/gbc/*.png
    backgrounds/pce-vn/dmg/*.png
    fonts/pce-vn/*.png
    music/pce-vn/*.mod
  plugins/
    pce-vn-dialogue-prepare/
  build/qa/
    background-audit.json
    music-audit.json
    conversion-audit.json
    backgrounds-gbc.png
    backgrounds-dmg.png
    official-build-report.json  # verify mode
  pce-vn-gb-studio-export.manifest.json
```

generatorは同じversionの最小projectで確認したfieldだけを出します。生成後、選択版で
disposable copyを開いて保存し、正規化差分を採取します。`numTiles`などeditorが再計算する
fieldをmemoryから作りません。

## Source sidecar

PCE projectへ次を保存します。

```text
assets/pce-vn-gb-studio-export.json
```

version 1の現行schema例:

```json
{
  "format": "pce-vn-gb-studio-export",
  "version": 1,
  "font": "builtin:misaki-gothic-8x8",
  "visualOmissionsConfirmed": false,
  "warningsAcknowledged": false,
  "cddaMappings": {
    "cdda_title": "title_theme",
    "cdda_other": {
      "type": "external-mod",
      "source": "assets/music/gb-studio-export/0123456789abcdef.mod"
    }
  },
  "audioSubstitutions": {
    "sfx_id": { "type": "tone", "frequency": 440, "duration": 0.08 }
  },
  "backgrounds": {
    "title": {
      "focusX": 0.5,
      "focusY": 0.5
    }
  }
}
```

sidecarへ次を保存しません。

- external absolute path
- scene本文またはchoice本文の複製
- font binary
- GB Studio executable path
- output directoryの絶対path

custom fontと外部MODがproject外にある場合は、生成成功後にhash名でproject内へcopyし、sidecarを
相対pathへ更新します。次回preflightはそのportable copyを入力snapshotへ含めます。

## Output manifest

`pce-vn-gb-studio-export.manifest.json`は機械判定の正本です。現行の主要fieldは次です。

```json
{
  "format": "pce-vn-gb-studio-export",
  "version": 1,
  "exporter": {
    "id": "pce-vn-gb-studio-exporter",
    "version": "1.0.0"
  },
  "sourceProject": {
    "identity": "<project path hash>",
    "title": "...",
    "romName": "..."
  },
  "sourceSignature": "<input snapshot hash>",
  "gbStudio": {
    "version": "4.3.2",
    "engineVersion": "4.3.0-e1"
  },
  "conversion": {
    "font": {},
    "cddaMappings": {},
    "audioSubstitutions": {},
    "automaticVoiceSubstitutions": [],
    "visualOmissions": []
  },
  "stats": {},
  "ownedPaths": []
}
```

本文をmanifestへ重複保存しません。pathはoutput rootまたはPCE project rootからの相対pathに
限定し、再出力時はexporter IDとsource project identityを一致させます。

## 変換core API

実装名は変更可能ですが、inspectとwriteを分けます。

```js
inspectGbStudioExport({ projectDir, doc, assets, settings, gbStudio })
generateGbStudioProject({ inspection, outputDir, mode })
validateGbStudioProject({ outputDir, inspection, requireBuild })
```

`inspection`はserialize可能なdataだけを持ち、rendererへ大きな画像/audio byteを返しません。
thumbnailはproject限定のpreview URLまたは小さいdata URLにし、生成用source binaryはmain側で
再読込します。

テスト用CLI:

```text
node tools/dev/pce-vn-gb-studio-export.js \
  --project <pce-project-dir> \
  --out <generated-project-dir> \
  --gb-studio <gb-studio-4.3.1-or-4.3.2-executable> \
  --font builtin:misaki-gothic-8x8 \
  --cdda-map cdda_id=psg_song_id \
  --cdda-mod another_cdda=replacement.mod \
  --audio-sub sfx_id=tone:440:0.08 \
  --confirm-visual-omissions \
  --ack-warnings \
  --mode generate|verify
```

CLIもpluginと同じcore、sidecar、path検査、manifestを使います。CLIだけが未対応commandを
無視するoptionを持ってはいけません。

## Validation

### Static gate

- source command type別件数と分類件数が一致
- 実行commandがちょうど1回消費される
- scene、event、resource、variable IDが一意
- GBC/DMG両graphの全jump/choice targetが存在
- startから必須segmentが到達可能
- modeを跨ぐedgeがない
- 2択のvalue、label、targetがsourceと一致
- message/choice normalized text hashがsourceと一致
- 全visible glyphが選択pageへ存在
- safe code、physical font tile、inline tagが一致
- 全framed Message/Choice直前にdialogue準備eventがある
- GBC backgroundが160×144、各tile最大4色、背景palette最大7
- DMG backgroundが許可4色だけ、最大192 unique tiles。低階調原画は確認必須warning
- BGM play/stop/loop commandが全件生成される
- CD-DAにmappingがある
- output pathとowned pathがroot内
- manifest hashが実fileと一致

### GB Studio editor gate

- 選択した4.3.1/4.3.2でdisposable copyを開ける
- missing/duplicate resource warningがない
- editor保存後の差分が許可fieldだけ
- font、background、music resourceがeditorで認識される
- generated projectに未保存変更が残らない

### Official build gate

`生成＋検証`ではROMとWebを公式exportし、次を記録します。

- GB Studio/engine version
- command lineまたはeditor automation method
- warning/error全文
- output timestampと入力timestamp
- ROM path、bytes、SHA-256
- Web内ROM path、bytes、SHA-256
- ROM/Web内ROMのhash一致
- cartridge headerのCGB互換flag `0x80`
- cart typeとROM size
- stale outputでないこと

警告を無条件で許可しません。既知かつmanifestへ分類したwarningだけを受理します。

### Runtime smoke

次はPhase 6で実装する外部gateです。現行版は自動実行せず、生成結果へ
`GBVN_RUNTIME_NOT_RUN`を残します。

- 同じROMをGBC modeでboot
- 同じROMをDMG modeでboot
- device dispatcherが正しいmode graphへ入る
- 最初のMessageを通常入力で進める
- 最初のChoiceで両方向の反応を確認する
- BGM開始、停止、loop継続をsampleする
- native 160×144 screenshotを保存する

static/official build成功をruntime成功や実機成功として扱いません。

### 必須test

実装時は少なくとも次をrepository testへ追加します。

- normalize/inventory/full-consumption unit tests
- unresolved/duplicate/unreachable graph tests
- deterministic ID tests
- scene splitとstate inheritance tests
- mixed-mode edge isolation tests
- 2-choice text/value/target tests
- Japanese atomic font packingとreserved code tests
- dialogue準備event欠落検出test
- GBC 7-palette/4-colors-per-tile tests
- DMG adaptive threshold/4 shades/192-tile tests
- source master不変hash test
- PSG 1/256/4096 steps、loop、channel conflict audit tests
- CD-DA blocker/substitution tests
- path traversal、ownership collision、signature change tests
- 同一入力2回生成のbyte/hash一致golden test
- GB Studio 4.3.1/4.3.2公式ROM/Web build fixture
- `npm test`

## Diagnostics

全diagnosticは安定したcode、severity、source位置、説明、解決策を持ちます。例:

```json
{
  "code": "GBVN_CHOICE_OPTION_COUNT",
  "severity": "error",
  "sourceSceneId": "branch",
  "sourceCommandIndex": 12,
  "message": "Only two-option choices are supported",
  "resolution": "Split the source choice into two-option branches or implement multi-option choice support"
}
```

最低限のcode群:

- `GBVN_UNKNOWN_COMMAND`
- `GBVN_UNSUPPORTED_CONTROL_COMMAND`
- `GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION`
- `GBVN_UNRESOLVED_SCENE`
- `GBVN_UNRESOLVED_ASSET`
- `GBVN_CHOICE_OPTION_COUNT`
- `GBVN_FONT_GLYPH_MISSING`
- `GBVN_FONT_ATOMIC_UNIT_OVERFLOW`
- `GBVN_GBC_PALETTE_OVERFLOW`
- `GBVN_DMG_TILE_OVERFLOW`
- `GBVN_DMG_SHADE_UNDERUSE`
- `GBVN_PSG_EVENT_DROPPED`
- `GBVN_CDDA_MAPPING_REQUIRED`
- `GBVN_GB_STUDIO_VERSION_MISMATCH`
- `GBVN_OUTPUT_NOT_OWNED`
- `GBVN_INPUT_SIGNATURE_CHANGED`
- `GBVN_OFFICIAL_BUILD_WARNING`
- `GBVN_RUNTIME_NOT_RUN`

## 実装状況と段階

2026-08-24時点の実装は次です。

- `pce-vn-gb-studio-exporter` plugin、再利用core、CLI、sidecar、ownership manifest
- GB Studio 4.3.1/4.3.2 / engine `4.3.0-e1`の実file検査と引用符付きpath正規化
- GBC/DMG二重graphをboot dispatcherで選ぶmixed-mode project
- BG、Message、2択、Jump/next、Wait/Fade、BGM play/stop
- Variable set/add/sub/random、IF、Switch、Label/GOTO、sync/async/cancel Input
- SpriteTextの背景文字近似とshake。sprite/spritemove・その他visual effectは確認後省略
- Misaki Gothic組み込み、custom BDF/TTF/OTF/TTC、atomic font page
- GBC 7 palette×4 colors/tile、DMG固定4色×192 unique tile、contact sheet
- PSG→4ch MOD、非0 loop point、drop/transpose/control-conflict曲別audit
- CD-DA→登録PSG曲または外部4ch MOD、voice→話者別text tone、SFX/独立ADPCMのtone/omit
- static validationとGB Studio公式ROM/Web build。ROM CGB flag `0x80`を必須検査

実装fixtureでは通常の本文/2択/BGM、外部MOD、Variable/IF/Switch/GOTO/Input/SpriteText/shakeを
GB Studio 4.3.1の既存fixtureに加え、targetLabelなしasync→sync継続を含むfixtureを4.3.2でも
公式ROM/Web Exportへ通し、warning 0件を確認しました。生成ROMはいずれも131072 bytes、CGB flagは
`0x80`で、4.3.2 fixtureの単体ROM/Web内ROM SHA-256は
`53b4daccf7c75405037bed140dc38d36a9b06f628bb40747d641c93823006610`で一致しました。
実作品`ホラーストーリー/001_sakai_no_ma`もsource 16 scenes / 184 commandsから69 scenes、
51 background resources、4 font pages、5 MOD tracksを生成し、4.3.2公式ROM/Web Exportをwarning 0件で
通過しました。ROMは524288 bytes、CGB flag `0x80`、単体ROM/Web内ROM SHA-256は
`2b3ffbaea3405b38bcb624f089abedf013be907101e90d1e02c5e330cc7dfc87`で一致しました。
内蔵emulator上の全入力playthrough、実機DMG/GBC、
全分岐screen/audio比較は未実行の外部gateです。

### Phase 1: MVP

**実装済み**です。runtime smokeだけは生成結果に`GBVN_RUNTIME_NOT_RUN`として残し、外部gateです。

- plugin、core、CLI
- preflight、sidecar、manifest、ownership
- GB Studio 4.3.1/4.3.2検出
- mixed-mode graph
- BG、Message、2択、Jump/next、Wait、単純Fade
- Japanese font pages、Misaki組み込み、dialogue準備plugin
- GBC/DMG背景変換とcontact sheet
- PSG BGM MOD変換とaudit
- CD-DA mapping、voice/SFX substitution
- static validation
- 二段階の生成/公式build
- runtime smoke未実行の外部gate記録

### Phase 2: 制御flow

**主要command実装済み、3択以上と網羅runtime QAは未実装**です。

対象:

- [x] `variable`: define/set/add/sub/random
- [x] `if`
- [x] `switch`
- [x] `label`
- [x] `goto`
- [x] sync/async/cancel `inputcheck`
- [ ] 3択以上のchoice

想定方針:

- PCE variable名からstable GB Studio variable IDを生成
- scene内label graphをbasic blockへ正規化
- branchごとに新しいevent IDを生成
- 3択以上はcustom menuまたは2段階menuへ無通知変形せず、UI仕様を別途承認
- async inputはscene-local callbackのinstall/removeを明示

必要test:

- 全operatorとrandom bounds
- nested if/switch
- loop、join、unreachable block
- sync/async inputの競合と解除
- 3択以上のcursor/input/runtime capture
- branchごとのfont pageとBGM state継承

### Phase 3: Visual表現

**SpriteTextとshakeだけ実装済み**です。立ち絵系は引き続き明示省略対象です。

対象:

- `spritetext`
- 立ち絵、表情、表示/非表示
- 左右配置、flip
- `spritemove`
- 複数portraitとevent still
- shake/flash/blank等のeffect

想定方針:

- full-body自動縮小ではなくface/bust cropを既定
- 8×16 tileとMetasprite Canvasを正規resourceとして生成
- source座標、editor座標、compiler-relative座標を別々に検証
- 40px portraitなら同一scanline最大2枚を既定
- event still中はportraitを全非表示
- `spritetext`は本文と同じ「text欠落禁止」に分類

必要test:

- metasprite Canvasのpixel完全再構成
- 10 sprites/scanline gate
- expression/side/visibility inheritance
- still enter/leaveのportrait復元
- move timingと最終座標
- editor表示とruntime表示の双方

### Phase 4: Audio拡張

**外部4ch MOD mappingまで実装済み**です。以下は次段階です。

対象:

- PSG SFXの完全な4ch変換
- 曲ごとのinstrument editor
- channel arbitration preview
- BGM録音比較
- CD-DAからの半自動採譜支援

CD-DA採譜は自動合格機能にしません。音高、rhythm、loop、編曲を提示し、人間が承認した
scoreをPSG/MOD変換へ渡します。

必要test:

- 全wave/noise combination
- SFX中のBGM継続
- loop seam録音
- event時刻と録音変化の対応
- 人間承認前後のprovenance

### Phase 5: Project統合とversion拡張

対象:

- 任意GB Studio projectへの差分merge
- exporter-owned resourceとuser-owned resourceの共存
- GB Studio複数version
- generated projectからの設定再import

必要test:

- ID/name/path collision matrix
- user edit保持とconflict stop
- editor normalization差分
- version別schema fixture
- versionを跨ぐupgrade/downgrade拒否

### Phase 6: 全自動playthrough

対象:

- graphから入力計画を生成
- GB/GBC両modeで全choice armを走破
- ending、return、BGM transitionを検証
- screenshot/state/audio evidence

固定sleep列を正とせず、scene、variable、画面、audioの観測状態で次入力を決めます。全自動化
できないeventは外部gateとして残し、debuggerで直接endingへ飛んだ結果を通常playthroughと
扱いません。

## 初回実装順序と残件

1. source inventory、IR、diagnostic、full-consumption validator
2. stable ID、mixed graph、MVP command generator
3. Misaki packaging、font page、compiled byte validator
4. GBC/DMG background converterとQA report
5. PSG→MOD、CD-DA mapping、audio audit
6. GB Studio 4.3.1/4.3.2 resource/project generator
7. 独自dialogue準備plugin
8. ownership、temp output、sidecar、manifest
9. preflight UIとNovel toolbar capability
10. official ROM/Web automation
11. runtime smoke（未実行。Phase 6へ継続）
12. `PLUGIN.md`、`docs/user-guide.md`、`README.md`、license文書の実装同期

各段階でgenerator-owned resourceだけを更新し、derived `.gbsres`だけを直接patchしません。

## MVP受入基準

MVP完了を宣言できるのは、代表fixtureと少なくとも1つの実PCE VN projectについて次が
すべて成立した場合だけです。

- 対応範囲の全source commandが一意に分類・消費される
- 未確認省略、未知command、未解決参照が0件
- GBC/DMG両graphが到達可能かつmode内で閉じる
- 全message/choice text hashが一致
- 日本語font mappingとcompiled bytesが一致
- GBC背景が各tile最大4色、背景最大7 palette
- DMG背景が許可4色だけを使い192 unique tiles以内。低階調原画のshade不足は確認済みwarning
- 全BGM commandとloopが生成され、auditに未説明dropがない
- CD-DAに明示mappingがある
- projectを選択したGB Studio 4.3.1/4.3.2で開いて保存できる
- 公式ROM/Web buildがwarning policyを通る
- ROM/Web内ROM hashが一致する
- ROM headerがCGB互換`0x80`
- 両modeのbootと最初のMessage/Choiceがruntimeで確認されるか、未実行外部gateとして明示される
- source master、PCE scene、asset catalogが意図せず変更されない
- 同一入力の再生成が同じIDと同じhashを返す

実機DMG、実機GBC、flash cartridge、実display/audioは、実際に確認するまで外部gateです。

## 文書同期

初回実装と同じ作業で次を更新済みです。

- `PLUGIN.md`
  - plugin manifest、capability、main hook、sidecar、public core API
- `docs/user-guide.md`
  - UI手順、font/CD-DA/background設定、生成/検証、制約
- `README.md`
  - ユーザーに見えるexport機能と必要環境
- `docs/release-dependencies-and-licenses.md`
  - Misaki fontと生成物へ同梱するlicense
- 本書
  - 実装済み範囲、実測値、残るPhase、検証結果

未実装のPhaseをユーザーガイドへ利用可能機能として先行記載しません。本書のPhase表を
引き継ぎの正本とし、次の対応では対象Phase、必要test、前提versionを先に確認します。
