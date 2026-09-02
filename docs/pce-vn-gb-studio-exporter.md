# PCE VN → GB Studio exporter 仕様・実装記録

## 文書の状態

- 状態: **Phase 1～3実装済み、v1.4.0 Visual両mode・公式build/runtime受入済み**
- 対象日: 2026-08-30
- plugin ID: `pce-vn-gb-studio-exporter`
- exporter/plugin version: `1.4.0`（sidecar format versionは`1`を維持）
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
- 日本語本文、話者名、2～4択分岐、scene遷移
- PCE PSG BGMを変換したhUGE/MOD音楽
- 立ち絵、移動、SpriteText、fade/flash/blank/shakeを再現するvisual resourceとevent
- 変換根拠、近似、欠落、色・tile・font・音楽の監査結果
- 正規化前の全source commandの処理区分、到達性、GBC/DMG event IDを持つ制御flow監査
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
   - font、CD-DA、BGM個別調整、画像個別補正、警告確認UI
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

GB Studio 4.3.1または4.3.2の実行file指定をproject生成時から必須とします。ダイアログで最後に選択した実行fileは、
projectの`project.json`にある`pluginSettings.pce-vn-gb-studio-exporter.gbStudioExecutable`へ保存し、次回のダイアログで再利用します。
環境変更などで保存済みpathが消えた場合は、ダイアログ起動時のpreflightが実行file欠落errorを表示し、再選択するまで生成を許可しません。engine versionは
`4.3.0-e1`を期待し、実行file、app metadata、engine headerのversionが一致しない場合は
開始しません。
検出は選択した`gb-studio.exe`と同階層の`resources/app.asar`から
`package.json`と`appData/engine/engine.json`だけを読みます。Electron main processでは
ASAR対応`fs`を迂回する抽出APIとWindows native entry pathを使い、archive本体を通常fileとして開きません。

二段階の実行modeを提供します。

| mode | 内容 |
|---|---|
| Project生成 | 4.3.1/4.3.2とengineを検証し、project、resource、監査fileを生成する。ROM buildは行わない |
| 生成＋検証 | Project生成に加え、隔離profileの選択版でROM/Webを公式出力して成果物を検査する |

公式build helperも起動前に指定された`gb-studio.exe`の`app.asar`から実versionとengine versionを
再検出し、期待versionとの不一致を`GBVN_GB_STUDIO_VERSION_MISMATCH`で停止します。CLI引数だけを
reportのversionへ転記しないため、同じ実行fileを4.3.1/4.3.2として二重計上できません。

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
- `project.json`のGB Studio実行file設定
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
- source project identityが一致する。ただしexporter 1.1.0/1.1.1だけは、source signatureが完全一致する場合に限り現行identityへ一度再結合できる
- exporter IDが一致する
- owned pathsが列挙されている
- 解決後の各owned pathが選択された出力root内にある

manifestのないdirectory、別sourceの出力、所有外fileとの衝突はerrorです。再生成で不要になった
owned fileを削除した後は、generator-owned出力の空`plugins` directoryも除去します。再帰削除の
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

GB Studio sceneはbackground変更点でsegmentへ分割します。先行Messageなどの実行command後に
最初のbackgroundが現れた場合もそこで必ず分割し、後続backgroundを先行commandへ遡及させません。
comment/cacheなどmetadata-only commandは独立blockにせず、後続labelまたは実行blockへ付属させます。
到達不能warningは実行命令を含むblockだけへ出しますが、command単位の監査記録は残します。

CFGは`block × inheritedBackground`の積状態として走査します。明示backgroundは状態を置換し、
backgroundなしblockは遷移元の状態を継承します。異なるbackgroundが同じbackgroundなしblockへ
合流する場合はentry backgroundをstable keyへ含め、GBC/DMG sceneを背景別に特殊化します。
本当に到達不能な実行blockは同一source scene内の直前background、なければblankを監査用fallbackとして
1回だけ生成します。監査には`originBlockKey`、`entryBackgroundKey`、`effectiveBackgroundKey`、
`backgroundSource`、特殊化先GBC/DMG scene IDを保存します。

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

## Phase 2 command mapping

| PCE VN入力 | GB Studio 4.3.1/4.3.2出力 | 契約 |
|---|---|---|
| `background` | mode別backgroundを持つscene segment | background変更点でscene分割。通常/全面とfadeを反映 |
| `message` | 標準`EVENT_SET_DIALOGUE_FRAME`、font選択、文字音、`EVENT_TEXT` | 本文と話者を欠落させない |
| 2～4択`choice` | `PCE_VN_EVENT_MENU`、値設定、mode内scene switch | 16セル単位で全labelを折り返す。`defaultIndex`、Bキャンセル無効、重複value、値とtargetの独立性を保持 |
| `jump` | mode内scene switch | target存在と到達性を検査 |
| `nextSceneId` | segment末尾のmode内scene switch | 明示jump/choiceがあれば二重生成しない |
| `wait` | frame単位wait | 1未満、範囲外はsource位置付きerror |
| `background` fade | scene transition/fade event | source frameを最も近い表現へ変換し差を記録 |
| `effect: shake` | camera shake | frame数と強度を近似 |
| `variable define/set/add/sub` | signed 16-bit GB variable演算 | PCEの符号を保持し、0～255 clampや不要な絶対値化をしない |
| `variable random` | `PCE_VN_EVENT_RANDOM` | signed 16-bitのinclusive min/max。逆順を正規化し、最大65535幅 |
| `if` / `switch` / `label` / `goto` | 条件分岐・mode内scene switch | 比較6演算子、label、case、fallbackを検査。else/defaultなしはfallthrough |
| sync/async/cancel `inputcheck` | await input・scene-local input callback・callback解除 | 成立時に同groupの全callbackを解除 |
| PSG song play | hUGE music play | source順序とloop状態を保持 |
| PSG song stop | music stop | source順序を保持 |
| `comment` | runtime eventなし | `generated-metadata`として消費を記録 |

`choice`または`random`を使うprojectだけへ、GB Studio公式のproject-local Script Event Plugin
`plugins/pce-vn-control`を生成します。GB Studio 4.3.1/4.3.2のcompiler helperへ固定し、
native Cやengine差し替えは行いません。未検証versionはpreflight errorです。


`message.textColor`は本文そのものではなく視覚属性です。MVPで同色を表現できない場合は
既定dialogue paletteへ近似し、source色と出力policyをwarningへ記録します。本文を省略しては
いけません。

`inputcheck`はtitleを含む全sceneで変換します。targetありasyncは指定labelへ、targetなしasyncは
直後の`wait`を早送りする経路、または後続sync inputの通常継続へ接続します。たとえば
targetなしA/RUN、targetあり右、sync左を並べた3経路では、A/RUNがsync直後の通常flow、右と左が
各labelへ進みます。このselector形式は3経路すべてをscene-local callbackへ変換し、末尾の
`EVENT_IDLE`で非ブロッキング待機します。いずれかが成立した時点で同じ入力待ちgroupをすべて解除します。

## 省略とerror

「未対応」は一律のwarningではありません。

### 明示確認後に省略できるもの

- tile/controller予算内へ収めるためのloop animation frame/state削減
- tile/並行処理予算を超えるSpriteText blinkの常時表示化
- 独立ADPCM再生
- 変換不能な`psg-sfx`

visualはcommand全体ではなく属性単位で記録し、preflightで件数、source位置、source値、生成値、
理由を表示します。`visualOmissionsConfirmed`が同じinspection/visual audit hashへ明示された場合だけ
生成できます。本文、分岐、状態、BGM、SpriteText内容、立ち絵の最終状態は省略できません。
時間、色、移動速度、非原子的tile更新など内容を失わない近似はwarningへ分類し、
`warningsAcknowledged`を要求します。

### 必ずerrorにするもの

- 1択または5択以上、不正なlabel/valueを持つchoice
- 未解決label、case、fallbackを持つ`if` / `switch` / `goto`
- 直後の`wait`にも後続sync inputの通常継続にも接続できないtargetなしasync `inputcheck`
- 未知command
- skip指定なしで正規化時に消えたcommand
- 未解決scene、asset、font、music参照
- mappingされていないCD-DA play
- BGMとして分類されたaudioの省略

- 制御flow監査の未分類、未確認省略、分岐・状態・本文・BGMのGBC/DMG event欠落

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

組み込みMisakiは8×8のまま使用します。BDF glyphの配置は`FONT_ASCENT`と`BBX`の
Y offsetからbaselineを算出し、7px高などのglyphを下端で切り落とさないようにします。

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

GB Studio 4.3.xのfont compilerは、resourceの`.png.gbsres`にある`mapping`ではなく、PNGと
同じbasenameの`page_NN.json`を直接読みます。エクスポーターは各pageについてPNG、`.png.gbsres`、
隣接`.json`を同じmappingから生成し、sidecar欠落・mapping不一致・Message/Choiceのinline font
参照欠落をstatic validation errorにします。`.png.gbsres`だけを生成しても公式buildは成功し得ますが、
日本語は正しい1-byte codeへ符号化されないため受入不可です。

次はerrorです。

- fontに存在しないvisible文字
- 1 atomic unitが222 safe codesを超える
- reserved codeへの割当
- mapping、PNG位置、`.gbsres`、inline tag、compiled byteの不一致

不明文字を`□`へ自動置換しません。本文欠落禁止の契約を優先します。

### dialogue frameの再設定

各framed Message/Choiceの直前でGB Studio 4.3.1/4.3.2標準の
`EVENT_SET_DIALOGUE_FRAME`を発行し、空の`tilesetId`で既定frame tileを再転送します。
project-local engine pluginやnative C helperは生成しません。標準eventが欠落した
Message/Choiceをstatic validatorでerrorにします。

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
8. GB Studio compilerと同じgreedy autoColor palette数を再計算し、7本を超えた場合はcluster上限を1本ずつ下げて再量子化する。
9. 選択したGB Studio 4.3.1/4.3.2の公式buildを確認する。

RGB成分の単純二乗距離だけを品質指標にしません。少なくとも知覚色差、tileごとの色数、
palette使用数、unique 8×8 tiles、source hash、output hashを記録します。
監査には最終autoColor palette数に加えて`quantizerPalettes`と`quantizerPaletteLimit`も残します。

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

音高はPCE `period`を第一情報とし、欠けている場合だけnote文字列を使います。`Bb/Eb/Ab`と
`♭/♯`は正規化し、発音eventに有効なperiod/noteがない場合は位置付きerrorです。PCE periodから
GB Studio 4.3.x公式MOD importerが受理する最近傍ProTracker periodへ量子化し、cent誤差と
note/period不一致を監査します。

自動mappingは6 source channelの活動量、volume、持続時間、wave/noise特性を解析し、priorityと
決定論的tie-breakでpulse 1、pulse 2、wave、noiseへ割り当てます。wave instrumentは
sine=15、saw=13、triangle=12、square/default=14、noiseは16～31へ対応付けます。収まらないchannel、
手動target競合、event競合は黙って上書きせず全dropを監査します。sidecar overrideでは曲ごとの
tempo 50～200%、各PCE channelのtarget、instrument、volume 0～200%、transpose -24～+24、
priority 0～100を指定できます。

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
- 正規化event列hash、period/note正規化、cent誤差、音色代替
- source BPM、steps、loop point
- channel mappingとoverride
- mapped、merged、dropped、transposed event件数
- eventごとのsource step/channelと処理理由
- tempo/timing誤差
- output MOD signature、pattern数、bytes
- GB Studio resource IDとbuild warning

BGMのplay、stop、loop位置はscript順で保持します。BGM eventの欠落はerrorです。
`exact`は発音eventがなく制御だけを無損失変換できた場合などに限定し、音色置換・音高量子化は
`approximated`、drop・channel/control conflictは`warning`です。export modalのSource/GB A/Bは
同じ正規化設定・event列から作るWebAudio近似previewであり、hUGEの完全再現とは扱いません。

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
  plugins/pce-vn-control/       # choice/randomを使う場合だけ生成
    plugin.json
    LICENSE
    events/eventPceVnMenu.js
    events/eventPceVnRandom.js

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
  build/qa/
    background-audit.json
    music-audit.json
    conversion-audit.json
    control-flow-audit.json
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
  "portraitRenderMode": "baked",
  "visualOmissionsConfirmed": false,
  "visualOmissionsConfirmationHash": "",
  "warningsAcknowledged": false,
  "warningsAcknowledgementHash": "",
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
      "brightness": 0,
      "saturation": 100,
      "gbcDither": false,
      "dmgDither": false,
      "focusX": 0.5,
      "focusY": 0.5
    }
  },
  "sprites": {
    "portrait_akari": {
      "crop": null,
      "scale": 100,
      "offsetX": 0,
      "offsetY": 0,
      "brightness": 0,
      "saturation": 100,
      "gbcDither": false,
      "dmgDither": false,
      "sourceHash": "<source png sha256>"
    }
  },
  "music": {
    "title_theme": {
      "tempoScale": 100,
      "channels": {
        "0": { "target": "auto", "instrument": "auto", "volumeScale": 100, "transpose": 0, "priority": 50 }
      }
    }
  }
}
```

`backgrounds`のbrightness/saturationはartwork領域へRec.709彩度補正、sRGB加算式明るさ補正の
順に適用し、その後GBC/DMG独立の4×4 ordered Bayer ditherを適用します。dialogue matteは補正・
dither対象外です。previewと正式exportは同じ変換coreを使い、preview hashと最終PNG hashを比較できます。
modalをcancelした場合は変更を保存せず、正式export成功時だけsidecarを更新します。
`portraitRenderMode`はproject全体で`baked`または`actor`のどちらか1つです。`sprite[assetId]`はassetごとの
共通crop、scale、offset、色補正、GBC/DMG別dither、設定時source hashを持ちます。source hashが
変わっても設定を破棄せずstale warningを出し、ユーザーが再previewできます。
2つの確認hashはscene・asset・設定・GB Studio版と該当監査内容へ結び付けられます。入力が変わった場合、
保存済みbooleanだけでは承認を再利用せず、preflightで再確認を要求します。

sidecarへ次を保存しません。

- external absolute path
- scene本文またはchoice本文の複製
- font binary
- GB Studio executable path（これはproject.jsonのproject settingへ保存）
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
    "version": "1.4.0"
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
    "portraitRenderMode": "baked",
    "confirmations": {
      "inputHash": "...",
      "visualOmissionsHash": "...",
      "warningsAcknowledgementHash": "..."
    },
    "cddaMappings": {},
    "audioSubstitutions": {},
    "backgrounds": {},
    "sprites": {},
    "music": {},
    "backgroundOutputs": [],
    "spriteOutputs": [],
    "musicOutputs": [],
    "backgroundAuditHash": "...",
    "visualAuditHash": "...",
    "musicAuditHash": "...",
    "automaticVoiceSubstitutions": [],
    "visualOmissions": []
  },
  "stats": {},
  "ownedPaths": []
}
```

本文をmanifestへ重複保存しません。pathはoutput rootまたはPCE project rootからの相対pathに
限定し、再出力時はexporter IDとsource project identityを一致させます。1.1.0/1.1.1の旧identityを
移行する場合も、保存済みsource signatureと現在のpreflight signatureの完全一致を必須にします。

## 変換core API

実装名は変更可能ですが、inspectとwriteを分けます。

```js
inspectGbStudioExport({ projectDir, doc, assets, settings, gbStudio })
generateGbStudioProject({ inspection, outputDir, mode })
validateGbStudioProject({ outputDir, inspection, requireBuild })
previewVnGbStudioMusic({ projectDir, assets, assetId, settings, generation })
previewVnGbStudioBackground({ projectDir, assets, assetId, fullScreen, settings, generation })
previewVnGbStudioSprite({ projectDir, assets, assetId, settings, renderMode, mode, usageSceneId, animationId, generation })
```

preview hookはproject-relative assetだけを受理し、asset ID、PNG signature、source byte、展開寸法、
data URL上限を検査します。rendererは200ms debounceし、返却generationが最新要求と違う応答を破棄します。

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
  --portrait-mode baked|actor \
  --cdda-map cdda_id=psg_song_id \
  --cdda-mod another_cdda=replacement.mod \
  --audio-sub sfx_id=tone:440:0.08 \
  --confirm-visual-omissions \
  --ack-warnings \
  --mode generate|verify
```

CLIもpluginと同じcore、sidecar、path検査、manifestを使います。CLIだけが未対応commandを
無視するoptionを持ってはいけません。

実作品の決定性回帰は次を使います。既定では`000_百物語`、`001_境の間`、`北へ。PM`をinspectionし、
同じmodelからA/B生成、静的validate、resource/control-flow/visual audit hash一致、sidecarを除く参照入力
hash不変を検査します。独立ADPCM/PSG SFXは明示`omit`へ自動設定しますが、BGMを省略する設定は作りません。

```text
node --max-old-space-size=8192 tools/dev/pce-vn-gb-studio-real-regression.js \
  --gb-studio <gb-studio-4.3.2-executable>
```

## Validation

### Static gate

- 正規化前source commandが`sceneId + commandIndex`で一意に棚卸しされ、type別件数と分類件数が一致
- 全commandが`generated`、`generated-metadata`、`omitted-confirmed`、`skipped-source`、または位置付きerrorのちょうど1つになる
- scene、event、resource、variable IDが一意
- GBC/DMG両graphの全jump/choice targetが存在
- segmentのfallthrough/terminal、join、loop、到達不能が記録される
- modeを跨ぐedgeがない
- 2～4択のvalue、label、target、`defaultIndex`がsourceと一致し、labelの16セル折返しで文字欠落がない
- message/choice normalized text hashがsourceと一致
- 全visible glyphが選択pageへ存在
- safe code、physical font tile、inline tagが一致
- 全framed Message直前に標準`EVENT_SET_DIALOGUE_FRAME`がある
- GBC backgroundが160×144、各tile最大4色、背景palette最大7
- DMG backgroundが許可4色だけ、最大192 unique tiles。低階調原画は確認必須warning
- BGM play/stop/loop commandが全件生成される
- CD-DAにmappingがある
- generated pluginのmanifest/versionと`PCE_VN_EVENT_MENU` / `PCE_VN_EVENT_RANDOM`参照が一致
- `build/qa/control-flow-audit.json`に未分類、未確認省略、branch/state/text/BGM欠落がない
- `build/qa/visual-audit.json`に全visual command、render mode、state ID、actor/tileset/script/event参照、OBJ/tile/keyframe/timing/fidelityがある
- actor modeの到達可能な2人組が合計40 OBJ・1走査線10 OBJ以内
- baked modeのtilesetが256 tile、1 GB frameのtile更新が32件以内に分割される
- SpriteText内容・座標・色と立ち絵最終stateがGBC/DMG双方で生成される
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

graphから入力列を自動生成する全分岐playthroughはPhase 6です。Phase 2では
`tools/dev/pce-vn-gb-studio-bgb-smoke.js`でBGB 1.6.4用の決定論的demo入力を生成し、
GBC/DMG mode、終了screenshot、state、ROM/demo hashをruntime reportへ保存できます。
このCLIは生成時に自動実行しないため、生成結果には`GBVN_RUNTIME_NOT_RUN`を残します。

- 同じROMをGBC modeでboot
- 同じROMをDMG modeでboot
- device dispatcherが正しいmode graphへ入る
- 最初のMessageを通常入力で進める
- 最初のChoiceで両方向の反応を確認する
- BGM開始、停止、loop継続をsampleする
- native 160×144 screenshotを保存する

static/official build成功をruntime成功や実機成功として扱いません。BGB smoke成功も実機成功とは
扱わず、実機DMG/GBCとflash cartridgeは別gateです。

### 必須test

実装時は少なくとも次をrepository testへ追加します。

- normalize/inventory/full-consumption unit tests
- unresolved/duplicate/unreachable graph tests
- deterministic ID tests
- scene splitとstate inheritance tests
- mixed-mode edge isolation tests
- 2-choice text/value/target tests
- Japanese atomic font packingとreserved code tests
- 標準dialogue frame event欠落検出test
- GBC 7-palette/4-colors-per-tile tests
- DMG adaptive threshold/4 shades/192-tile tests
- source master不変hash test
- PSG 1/256/4096 steps、loop、channel conflict audit tests
- CD-DA blocker/substitution tests
- path traversal、ownership collision、旧identity完全一致再結合、空plugin cleanup、signature change tests
- 同一入力2回生成のbyte/hash一致golden test
- 3/4slot、A/B循環、hide/re-entry、flip、全animation、64 frame量子化、非loop最終frame保持
- actor pairの40 OBJ/scanline 10 OBJ超過とbaked timelineの16→8→4→2→1 keyframe削減
- sync/async move、連続async＋sync、途中遷移、32 tile分割、最終座標
- SpriteText折返し/色/blink/下端error、fade/flash/blank/shake境界と監査分類
- sprite preview/export hash、sidecar stale/copy/reset/cancel、generation競合、preview path/data URL制限
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
  "message": "Choice requires 2 to 4 options",
  "resolution": "Use 2 to 4 options; 1 or 5+ options are rejected"
}
```

最低限のcode群:

- `GBVN_UNKNOWN_COMMAND`
- `GBVN_UNSUPPORTED_CONTROL_COMMAND`
- `GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION`
- `GBVN_VISUAL_APPROXIMATION_REQUIRES_ACKNOWLEDGEMENT`
- `GBVN_UNSUPPORTED_VISUAL_COMMAND`
- `GBVN_SPRITE_SLOT_UNDEFINED`
- `GBVN_SPRITE_ANIMATION_ASSET_MISMATCH`
- `GBVN_SPRITE_ANIMATION_MISSING`
- `GBVN_SPRITE_ANIMATION_FRAME_LIMIT`
- `GBVN_SPRITE_OAM_OVERFLOW`
- `GBVN_SPRITE_SETTING_STALE`
- `GBVN_SPRITETEXT_BOTTOM_OVERFLOW`
- `GBVN_VISUAL_TIMELINE_TILE_BUDGET`
- `GBVN_VISUAL_LOOP_TILE_BUDGET`
- `GBVN_VISUAL_RESOURCE_COLLISION`
- `GBVN_UNRESOLVED_SCENE`
- `GBVN_UNRESOLVED_ASSET`
- `GBVN_CHOICE_MENU_OVERFLOW`
- `GBVN_CHOICE_OPTION_COUNT`
- `GBVN_UNCONSUMED_COMMAND`
- `GBVN_UNREACHABLE_BLOCK`
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

2026-08-30時点の実装は次です。

- `pce-vn-gb-studio-exporter` v1.4.0、再利用core、CLI、sidecar v1、ownership manifest
- GB Studio 4.3.1/4.3.2 / engine `4.3.0-e1`の実file検査と引用符付きpath正規化
- GBC/DMG二重graphをboot dispatcherで選ぶmixed-mode project
- BG、Message、2～4択、Jump/next、Wait、BGM play/stop
- signed Variable define/set/add/sub/random、比較6演算子、IF、Switch、Label/GOTO、sync/async/cancel Input
- 明示fallthrough/terminalを持つbasic block graph、join/loop/到達不能解析
- 必要時だけ生成する`pce-vn-control` Script Event Plugin
- 全raw source commandを一意に追跡する`control-flow-audit.json`
- baked/actor両立ち絵mode、4論理slot/A-B actor mapping、全animation/flip/show/hide、sync/async move
- 8×8 SpriteText、blink、fadeIn/out、flash、blank、shakeとvisual state特殊化
- Misaki Gothic組み込み、custom BDF/TTF/OTF/TTC、atomic font page
- GBC 7 palette×4 colors/tile、DMG固定4色×192 unique tile、contact sheet
- PSG→4ch MOD、非0 loop point、drop/transpose/control-conflict曲別audit
- CD-DA→登録PSG曲または外部4ch MOD、voice→話者別text tone、SFX/独立ADPCMのtone/omit
- static validationとGB Studio公式ROM/Web build。ROM CGB flag `0x80`を必須検査
- metadata-only block統合、持続背景CFG伝播、背景状態別scene特殊化、背景state監査
- period優先PSG変換、6ch自動割当、wave/noise instrument、曲別調整とWebAudio A/B近似preview
- asset別brightness/saturation、GBC/DMG独立dither、原画/変換後preview、preview/export hash照合
- asset別立ち絵crop/scale/offset/色補正、animation preview、OBJ/scanline/tile予算、stale source hash
- command単位とasset/timeline/tile bank単位を相互参照する`visual-audit.json`

2026-08-30のPhase 3 v1.4.0最終受入では、focused回帰52/52、`npm test`は
534 pass / 0 fail / 1 skipでした。`いしのうらにいる！？/01_部室の白い箱`はsource 18 scenes /
511 commandsからactor/bakedとも97 scenesを生成し、全511 commandsを一意に消費、未確認省略0件、
static validation成功を確認しました。actorは18 sprite assets、250 visual timelinesを生成し、visual audit
SHA-256は`ddd6142b6045621962b377d43f701c8c0b5b142c08749385f766a82dfbe97c54`です。

actor出力はGB Studio 4.3.1/4.3.2、baked出力は4.3.2の公式ROM/Web Exportをwarning 0件で通過し、
全てCGB flag `0x80`かつROM/Web内ROM hash一致でした。actor ROM SHA-256は4.3.1が
`c18b26a84fa014747aa4c9852203193d133f0726cf8843a67784a6decef9c5b1`、4.3.2が
`b32eee3d8837113d0f65453e2c329147bc5e801b7fd2b4544c776aa6328bbb03`、baked 4.3.2は
`08f216199bcbf73204469248522a1fa63b0b79bafdfe335c2a7d38b1235f4170`です。BGBでは4.3.2 ROMを
actor/baked × GBC/DMGの4通りで各6200 frames、246回の明示A入力により連続進行し、failure 0、
日本語本文、カラー/4階調、3人画面、クラッシュ不在を終了screenshotとstateへ保存しました。

Phase 3専用fixtureは3 scenes / 27 commandsで、4 logical sprite slots、30/45/60/90 frameの
sync/async移動、連続async＋sync、SpriteText blink、fadeIn/out、flash、shake、blank、全画面event still、
PSG、choiceを一つの入力へ収録しています。全27 commandsを一意に消費し、未確認省略0件、static validation
成功を確認しました。GB Studio 4.3.1/4.3.2の実行fileをそれぞれ検出して公式ROM/Web Exportをwarning 0件で
通過し、CGB flag `0x80`、ROM/Web内ROM hash一致を確認しました。ROM SHA-256は4.3.1が
`e8c48930753b50e9a36efa1b19c78be3bd7f9e8415a33e132e78355725e40c2d`、4.3.2が
`149641382f6303ef65826c8b844bc087fe2607a34802140a9dab6852fb358653`です。4.3.2 ROMはBGBの
GBC/DMG双方で各7200 frames、116回の明示A入力によりfailure 0で連続進行し、終了screenshotとstateを
保存しました。このfixtureはsource上限4 slotを同時に検査するためbaked modeを使い、actor modeのA/B循環、
OBJ/scanline gate、全animation再構成、移動状態継承は上記実作品とfocused回帰で検査しています。

`000_百物語`、`001_境の間`、`北へ。PM`は同一入力からA/B二重生成し、全てsource不変・resource/audit
hash一致でした。000は194 commands→73 scenes・344 files、001は244 commands→93 scenes・423 files、
北へ。PMは13,324 commands→25,371 scenes・91,117 filesです。北へ。PMの332件の
`omitted-confirmed`は既存のADPCM effect/voice代替だけで、BGM省略0件、Phase 3 visual省略0件を監査しました。
北へ。PMは1出力約920 MB、inspectionからA/B生成・検証まで約50分を要したため、巨大入力の
visual-state特殊化共有とresource deduplicationはPhase 5の性能残件です。正しさの受入と、生成規模の
実用性評価を混同しません。

v1.3.0のfocused回帰では36件を実行し、`000_百物語`の旧`01_hyakumonogatari::1` / `::3`
到達不能warningが消えること、`scene_tale_isamu_a/b`が`still_tale_kouichi_01_candlelit_circle`、
`scene_search_a/b`が`still_vanish_02_group_waits`を継承すること、flat note 11件をperiod由来で
保持することを確認しました。同じv1.3.0 fixtureをGB Studio 4.3.1/4.3.2の公式ROM/Web Exportへ通し、
双方warning 0件、CGB flag `0x80`、ROM/Web内ROM hash一致を確認しました。ROM SHA-256は4.3.1が
`d61ab354e963ad2fda60e2e5c81cde1fb62f8153e80e9bbcce8e5546957458c0`、4.3.2が
`bc6e6273a9213a49081b20746710b0aa3909806b1a07ae562b8bc1212e766fe1`です。

v1.3.0の`000_百物語`はsource 16 scenesから背景状態を反映した71 scenes、21 background variants、
5 font pages、5 MOD tracksを生成し、4.3.2公式ROM/Web buildをwarning 0件で通過しました。ROM SHA-256は
`95bda5cf6fd0adac3f45a6f718df16654183e68f002aa083d6422c41c033ad8a`で、Web内ROMと一致します。
control-flow auditは到達不能block 0件で、上記4分岐sceneのGBC/DMG双方に期待する継承背景と個別scene IDを
記録しています。BGBではfixtureの4択全armとDMG loop、`000_百物語`のA系/B系をGBC/DMG双方で
6300 frames連続進行し、全reportがfailure 0、背景表示、本文、長文選択、BGM遷移、クラッシュ不在でした。

PSGは`natsu_no_hibi`の正式監査で50 note-on、drop 0を確認しました。4.3.2公式ROMをBGBからmixと
4 hardware channel別WAVへ46.96秒録音し、割当済みpulse 1 / pulse 2 / waveの3 channelがすべて非無音、
mixは平均`-26.4 dB`、peak `-13.1 dB`でした。3 channelの音高・音量feature列は20.00秒周期で相関
`0.931`となり、2周目のloopを確認しました。mix WAVのSHA-256は
`0a49fbb03808c5dff57d65c3afad105b4f031d17acd9eeeb58348bd16f4f1521`です。正式exportで更新対象となる
sidecarを除く入力744 filesの集約SHA-256は原本/受入copyとも
`0a3acce25ecf453f26da1fd53446472feac625abc79a0c7df6508779540c5c7f`で不変でした。最終回帰はfocused
36/36、`npm test` 516 pass / 0 fail / 1 skipです。下記v1.2.0記録は履歴として維持します。

2026-08-24のPhase 1実作品回帰では、Misaki BDFのbaseline/BBX配置、selectorのcallback＋
`EVENT_IDLE`待機、Message/Choice前の標準`EVENT_SET_DIALOGUE_FRAME`へ修正しました。
旧project-local dialogue native pluginは生成対象から削除しました。

Phase 2 v1.2.0の最終受入では、2/3/4択、全`defaultIndex`、長文、重複value、signed演算、random、
fallthrough/join/loop/unreachableを含む専用fixtureをGB Studio 4.3.1/4.3.2の公式ROM/Web Exportへ通し、
双方warning 0件、CGB flag `0x80`、ROM/Web内ROM hash一致を確認しました。ROM SHA-256は4.3.1が
`195697e013570be167ef632c4f172d2f804435c5f2bbcaad70d76f7d5d338c66`、4.3.2が
`eb8f9e16efd1e5f8a4b5abccee1df66ed2377e66edc10ef4b39502477d1071da`です。

実作品`000_hyakumonogatari`はsource 16 scenes / 194 commands、2択2件、3択1件を一意に消費し、
4.3.2公式buildをwarning 0件で通過しました。ROM SHA-256は
`6948411fbc5de984de3e1e55a7179c8965c363beb3fdff5972134f268fdca301`です。BGBでGBC/DMG双方を
6300 frames連続進行し、3つのchoice画面、全arm用入力経路、長文、先頭への1周復帰、クラッシュ不在を確認しました。
GBC/DMG録音は105.56秒/105.554秒、平均音量-31.2 dB/-30.8 dBで非無音でした。

実作品`001_境の間`はsource 16 scenes / 184 commandsから69 scenes、51 background resources、4 font pages、
5 MOD tracksを生成し、4.3.2公式buildをwarning 0件で通過しました。ROM SHA-256は
`ac4af88fea2a94c7fd9c49ff775864189bd21e19cffd9931d983b48cc99883ec`です。BGBのGBC/DMG双方で
selector、本文、7000 frames連続進行、message frame、font、クラッシュ不在を確認し、録音も117.28秒/117.274秒、
平均音量-33.0 dB/-32.9 dBで非無音でした。000/001のsource signatureは受入前後でそれぞれ
`2efcee21d5485084115e70954a03892c66d62ed6b3b8e438545e49f4e411ced6`、
`bb6c9e80ad29a44ba55d8ebf8ab37c76a60285e2b524396b5a4b7f3111a47305`のままです。

GB Studio内蔵emulatorによる全入力playthrough、実機DMG/GBC、全分岐の自動screen/audio比較はPhase 6または
外部gateです。今回のBGB受入はその代わりにfixture全armと実作品の代表経路を明示入力で検査したものです。

### Phase 1: MVP

**実装済み**です。runtime smokeだけは生成結果に`GBVN_RUNTIME_NOT_RUN`として残し、外部gateです。

- plugin、core、CLI
- preflight、sidecar、manifest、ownership
- GB Studio 4.3.1/4.3.2検出
- mixed-mode graph
- BG、Message、2択、Jump/next、Wait、単純Fade
- Japanese font pages、Misaki組み込み、標準dialogue frame event
- GBC/DMG背景変換とcontact sheet
- PSG BGM MOD変換とaudit
- CD-DA mapping、voice/SFX substitution
- static validation
- 二段階の生成/公式build
- runtime smoke未実行の外部gate記録

### Phase 2: 制御flow

**実装済み・公式build/runtime受入済みです。**

対象:

- [x] `variable`: define/set/add/sub/random
- [x] `if`
- [x] `switch`
- [x] `label`
- [x] `goto`
- [x] sync/async/cancel `inputcheck`
- [x] 2～4択、全`defaultIndex`、長文、重複value
- [x] 明示fallthrough/terminal、join、loop、到達不能解析
- [x] 全raw source commandの一意な消費監査

実装方針:

- PCE variable名からstable GB Studio variable IDを生成
- scene内label graphをbasic blockへ正規化
- branchごとに新しいevent IDを生成
- 2～4択は公式project-local Script Event Pluginで縦型表示
- signed 16-bitとinclusive random rangeをPCE runtime semanticsへ合わせる
- async inputはscene-local callbackのinstall/removeを明示

回帰test:

- [x] 全operatorとrandom bounds
- [x] nested if/switch
- [x] loop、join、unreachable block
- [x] sync/async inputの競合と解除
- [x] 2/3/4択、全`defaultIndex`、長文折返し、重複value
- [x] unknown/normalized-away commandの位置付きerror
- [x] 同一入力からのstable ID/hash
- [x] GBC/DMG runtimeでの選択arm、初期cursor、font/BGM継承（全自動graph探索はPhase 6）

### Phase 3: Visual表現

**v1.4.0で実装済み・公式build/runtime受入済みです。** 対象は`sprite`、`spritemove`、`spritetext`、fadeIn/out、
flash、blank、shakeです。GB Studio 4.3.1/4.3.2の公式eventだけを使い、native Cとengine overrideは
追加しません。

CFGの特殊化stateは`block × background × SpriteText slot × logical sprite slot × physical mapping ×
blank/active timeline`です。通常背景は立ち絵を継承し、全面event stillは表示stateを消去します。
SpriteTextは同一PCE元scene内の内部segment間だけ継承し、元scene IDが変わる入口と`jump` / `choice`による
同scene再入場では、全面event stillかどうかにかかわらず全4slotを消去します。
blankは進行中moveをcancelしてblank背景へ移り、論理slotは保持します。特殊化scene IDにはvisual-state
hashを含めます。

`actor` modeは全frame共通cropから40×48 canvas（38×46内側＋透明gutter）のbustを生成し、
A/B 2枠をA→B→Aで循環します。現在枠はその場で更新し、非表示・退避slotの論理stateも保持します。
GBCはasset全animation共通3不透明色＋透明、DMGは独立3階調です。flipX/flipY、全animation、
show/hideを保持し、非loop animationは1回再生後の最終frame用stateへ移ります。`frameDelays`は
最大64 generated frameへ決定論的に量子化します。到達可能な2人組の全animation/frame組合せを検査し、
合計40 OBJまたは1走査線10 OBJ超過をerrorにします。

`baked` modeはsource上限4slotを画面比率とslot重なり順で背景へ合成し、移動とanimationを最大16、
必要なら8/4/2/1 keyframeへ削減します。始点・終点は必ず保持します。連続async moveと直後のsync moveは
1本のtimelineにし、隠しcontroller actorと公式`EVENT_REPLACE_TILE_XY`で1 frame最大32 tileずつ更新します。
宣言時間に収まらない分だけ待機を延長し、追加frameと非原子的更新を監査します。async途中の遷移は最後に
完全描画されたkeyframeを継承します。loop animationは予算内で状態を削減し、最終的に先頭frame固定へ
縮退した属性を監査します。非loop animationはsource delay列を1回再生し、最終frameを継承します。

SpriteTextは選択済み8×8 font glyphを背景へ合成し、座標・色・表示/消去・内容を必達とします。
タイトル／シナリオ選択sceneは全SpriteTextを黒へ正規化し、「← シナリオ選択 →」だけPCE座標の比率変換後に
Yを8px加算して、96px artwork下端との間へ1tileの余白を設けます。source色・生成色・余白policyはcommand
監査へ残します。タイトル冒頭でblocking commandより前に並ぶ連続SpriteTextは完成状態を背景へ事前焼き込みし、
初期表示でGB Studioの共有blank tile patternを動的置換しません。右端では文字欠落なく折り返し、下端超過は位置付きerrorです。blinkは同じcontrollerで再現し、予算超過時
だけ常時表示へ属性縮退します。shakeは公式camera shake、fadeは5/10/20/40/80/160/320 frameの最近値、
flashは最近overlay色＋正確なwait、blankはblank背景＋actor非表示へ写像します。

export modalの`立ち絵調整`はasset/使用scene catalog、source/GBC/DMG、animation再生、crop、scale、
offset、brightness、saturation、GBC/DMG別dither、OBJ/scanline/tile指標、copy/paste/resetを提供します。
actor previewは正式sprite sheet、baked previewは選択した使用sceneの背景・座標・flipを使った160×144の
formal timeline合成を表示し、`fullFrameHashes`で正式生成frameと照合できます。previewとexportは同じcoreと
source hashを使います。`control-flow-audit.json`へcommand単位のvisual処理、
`visual-audit.json`へasset/pair/timeline/tile bank単位の詳細とhashを保存します。

### Phase 4: Audio拡張

**BGMのinstrument/channel調整とWebAudio A/B近似previewまで実装済み**です。以下は次段階です。

対象:

- PSG SFXの完全な4ch変換
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
- 巨大入力で等価なvisual-state特殊化scene/timeline/resourceを共有し、observable stateとstable IDを
  変えずに生成時間・file数・容量を抑える

必要test:

- ID/name/path collision matrix
- user edit保持とconflict stop
- editor normalization差分
- version別schema fixture
- versionを跨ぐupgrade/downgrade拒否
- `北へ。PM`相当の1万command超入力に対するscene/resource上限、dedup前後のaudit同値性、生成時間回帰

### Phase 6: 全自動playthrough

対象:

- graphから入力計画を生成
- GB/GBC両modeで全choice armを走破
- ending、return、BGM transitionを検証
- screenshot/state/audio evidence

固定sleep列を正とせず、scene、variable、画面、audioの観測状態で次入力を決めます。全自動化
できないeventは外部gateとして残し、debuggerで直接endingへ飛んだ結果を通常playthroughと
扱いません。

## 実装順序と残件

1. [x] raw source inventory、IR、diagnostic、full-consumption validator
2. [x] stable ID、mixed graph、Phase 2 command generator
3. [x] Misaki packaging、font page、compiled byte validator
4. [x] GBC/DMG background converterとQA report
5. [x] PSG→MOD、CD-DA mapping、audio audit
6. [x] GB Studio 4.3.1/4.3.2 resource/project generator
7. [x] 標準dialogue frame event、selector input callback、2～4択custom event
8. [x] ownership、temp output、sidecar、manifest、control-flow audit
9. [x] preflight UIとNovel toolbar capability
10. [x] Phase 2版の公式ROM/Web buildとruntime受入記録
11. [x] v1.3.0のGB Studio 4.3.1/4.3.2公式build、BGB GBC/DMG、公式ROM WAV再受入記録
12. [x] Phase 3 Visual（baked/actor、SpriteText、move、animation、fade/flash/blank/shake）と4.3.1/4.3.2公式build、BGB GBC/DMG受入
13. [ ] Phase 4 Audio拡張、Phase 5統合、Phase 6全自動playthrough
14. [x] `PLUGIN.md`、`docs/user-guide.md`、`README.md`、本書の実装同期

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
