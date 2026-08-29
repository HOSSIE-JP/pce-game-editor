# 北へ。PhotoMemories SCR → PCE VN converter

`pce-kitahe-pm-converter` は、Dreamcast 版「北へ。PhotoMemories」の解析済み
`*.SCR` を、PC Engine Game Editor の CD-ROM2 Visual Novel scene document へ
変換する組み込みプラグインです。

この機能はスクリプトだけを変換します。元画像の結合・crop・縮小・減色、P04
のADPCM化、MIDIのPSG化、GD-DA trackの登録は行いません。変換前に人手で
加工・登録したPCE assetを、取込画面でSCR上の参照へ対応付けてください。

上記はSCR取込の責務です。同じpluginは、Kitahe PhotoMemories Asset Viewerが
P04をWAV、MIDIをStandard MIDI、PVRをcrop・結合済みPNGへ変換したasset packageを
PCE assetへ一括登録する機能も提供します。GD-DA trackの自動登録は初版対象外です。


## 対象と前提

- 出力先は `targetMedia: "cd"` のCD-ROM2 VNだけです。HuCARD projectへは
  適用できません。
- ユーザーが選んだresource root直下の `SCRIPT` 以下だけを読みます。
- 変換対象は取込画面で明示的に選択したSCRだけです。
- 選択した各SCRの先頭を変換rootとして扱います。entry SCRからexternal GOTOで
  到達しないSCRもscene化し、entry指定は取込後の開始sceneだけを決めます。
- 選択したSCR群では変数を共有し、labelとscene IDはSCR単位のnamespaceへ
  分離します。
- 取り込んだscene名は `北へ。PM/<SCR path>/<開始行>` の2段階groupとして保存し、
  SCR path、開始行、終了行の順に並べます。
- 外部projectのソースやゲーム本文、絶対source pathをPCE projectへコピー
  しません。
- 画像・音声のsource binaryは生成しません。変換結果が参照するのは既存の
  PCE asset IDだけです。

## Viewer asset packageの一括取込

CD-ROM2 projectのAssets画面で **北へ。PM素材** を押し、Viewerが出力した
`kitahe-pm-assets.csv` を選択します。HuCARDではボタンを無効化し、CD-ROM2専用
である理由をtooltipへ表示します。既存の **AD CSV** は従来どおりADPCM専用で、
このpackage取込には流用しません。

packageは次の固定構成です。

```text
kitahe-pm-pce-assets/
  kitahe-pm-assets.csv
  adpcm-import.csv
  conversion-report.json
  SCRIPT/**/*.SCR
  audio/*.wav
  midi/*.mid
  images/*.png
```

Wizardで選択したSCRだけを`SCRIPT/...`の相対pathとCP932の元byte列を保って同梱します。ADV stateの事前解析だけに使った選択外context SCRは含めません。このpackage rootをそのままSCR取込のresource rootとして選択できます。

混在manifestはUTF-8 BOM付きRFC 4180で、headerを次の順に固定します。

```csv
version,kind,targetType,sourceKey,source,file,id,name,usage,playbackRate,loop,sampleRate,splitPolicy,details
```

Viewerは`ADV_*.SCR`の外部GOTO graphをたどり、選択した後続SCRだけを出力する場合も、
先行SCRをstate継承専用contextとして解析します。context内のasset参照はmanifestへ
追加せず、CGDIR、CG slot、変数など、選択SCRの解決に必要な状態だけを引き継ぎます。

画像種別の既定値はLCG crop・LINK結合後の論理寸法で決まり、640×480は
`background`、512×480は`sprite`です。Viewerでは結合画像上の共通source cropを1px単位で指定し、
その枠を切り出してからbilinearで指定出力サイズへ変換します。`sourceCrop`、`outputSize`、処理順は`details`へ記録しますが、
`sourceKey`はordered partsと各LCG cropから生成するため、設定変更時も同じ所有asset IDを
維持して更新できます。
LCGの表示寸法がPVR実寸を超える場合は、Quick Playと同じく各軸を実寸へclampします。
script上の指定寸法はidentityへ維持し、後段の共通export cropは暗黙にclampしません。


検査画面は、行ごとにsource、ID、`sourceKey`、新規/更新、Viewerで確定した
`background` / `sprite` / `adpcm` / `psg-song`、寸法、警告、エラーを表示します。
画像はaspect比を維持したPNG thumbnail、WAVは再生時間・rate・channel・変換後
ADPCM bytes、MIDIはPSG変換previewを表示します。WAV/MIDI本体をpreview IPCの
data URLへ複製しないため、大量素材でもmanifest検査payloadを抑えます。

Viewerで決定した画像種別はPCE側で変更しません。PNGはすでにcrop・出力サイズ変換済みなので
PCE側では素材種別や寸法を変更せず、生成済みPNGをそのまま変換入力に使います。
ここでいう変換済みPNGは、LCG crop・結合・最終出力と同じアスペクト比のsource crop・
指定出力サイズへのbilinear resizeまでをViewerで完了したものです。8px／Sprite Cell境界は出力サイズだけに適用されます。
resize modalを開かず、既存のPCE画像importerが内蔵16色変換とBG/Sprite生成を
行います。P04由来WAVは指定sample rateでADPCM化し、32767 bytesのbuffered
上限を超える行を分割せずerrorにします。MIDIは既存のMIDI→PSG経路を使い、採用した
全発音を既定でPSG最大振幅31へ変換して、現行のquantizer / MIDI importer metadataを保存します。
P04の`sourceKey` identityは`source`、`usage`、`loop`、`PLAYP playbackRate`を含むため、
同じP04 sourceでも再生rateが異なる参照は別asset要件として扱います。

warningが1件でもある場合は確認checkboxをONにするまで登録を開始できません。
開始直前にmanifest、各file、asset catalogを再検査し、`inspectionSignature`が
preview時と変わっていれば登録しません。開始後はmanifest順に1行ずつ登録し、
変換失敗した行の後も続行します。**残りをキャンセル** は処理中の1行を完了して
保存した後で止まり、それまでの成功assetを保持します。

登録assetの`data.import.kitahePm`には、絶対pathを含まない次のprovenanceだけを
保存します。

```json
{
  "version": 1,
  "sourceKey": "image-... / p04-... / midi-...",
  "kind": "image / p04 / midi",
  "source": "logical source",
  "manifestFileName": "kitahe-pm-assets.csv",
  "row": 2
}
```

同じ`sourceKey`を所有するassetが1件なら既存IDを維持して更新します。所有画像は
Viewer側の再分類に合わせたBG↔Sprite変更を許可します。複数所有、無関係な同一ID、
P04→画像などの型違いはerrorです。SCR converterの自動mappingもprovenanceの
`sourceKey`完全一致を最優先し、provenanceのない旧assetだけname照合へfallbackします。

## 取込手順

Settings > Pluginsで `北へ。PhotoMemories 取込` を有効にすると、CD-ROM2 projectのNovel画面に `北へ。PM取込` が表示されます。プラグインをOFFにした場合とHuCARD projectではボタンを表示しません。ボタンを押し、次の順で設定します。

1. resource rootを選ぶ。root直下に `SCRIPT` directoryが必要です。
2. 一覧から変換対象のSCRを複数選択し、entry SCRと主人公名を指定する。resource rootを
   選んだ直後は、SCRIPT配下で検出したSCRをすべて選択します。個別のチェックを変更しても
   SCR一覧のスクロール位置は維持します。新規取込の既定名は「ハドソン」で、同じSCR集合・
   entryの再取込ではsidecarに保存した名前を復元する。選択したSCRはentryとの接続有無に
   かかわらずすべて変換対象になり、entryは開始sceneの指定に使う。
3. 各選択SCRの変換rootから到達可能な画像・P04・MIDI・GD-DA参照を確認する。source名と既存PCE
   asset名が一致する参照は自動的に割り当てられ、一致しない参照は省略状態になる。
   必要に応じて対応assetを変更するか、カード右上のチェックをOFFにして省略する。大量取込時は
   Mappingを40件ずつページ表示し、画面外のasset候補をDOMへ一括生成しない。
4. 行番号付き診断、近似内容、scene予算を確認する。適用を止めるerrorは警告より上へ固定表示し、
   errorがある場合は詳細一覧もERRORだけを既定表示する。警告はcode別件数へ集約でき、
   すべて／ERROR／WARN／INFOで絞り込みながら200件ずつページ表示する。
5. `置換` または `追加` を選び、warningを確認して適用する。

`置換` は現在のVN settingsを維持してsceneだけを置き換え、取込entryを
`startScene` にします。`追加` は既存sceneと既存`startScene`を既定で維持し、
安定したimport namespaceを付けたsceneを追加します。追加時に「取込entryから
開始」を選んだ場合だけ`startScene`を変更します。

再取込では、前回のsidecarに所有sceneとして記録されたIDだけを更新できます。
同じIDが現在のdocumentにあっても、converterの所有を確認できない場合は
衝突errorとして停止します。

## Mapping

### COLORとメッセージ色

話者mapping UIと必須指定はありません。取り込むmessageはすべて
`speaker: ""` のナレーションとして生成します。

`COLOR WIN_MSG, GCOLOR` の第2引数は、数値・16進値・静的定数として解決し、
16-bit ARGB4444のRGB nibbleを`#rrggbb`へ展開して`message.textColor`へ設定します。
alpha nibbleは本文色には使いません。保存後は通常のVN messageと同じくPCEの
3-bit/channel表示色へ丸められます。値を解決できない場合は行番号付きwarningを残し、
そのmessageだけ既定の白を使います。

`NAME` の置換はページ分割より先に行います。主人公を表す既知token
（`【主人公】`、`主人公`、`\主人公`、`￥主人公`）は、SCR内の`NAME`命令で
「こあら」「真人」などへ定義・再定義されていても、取込画面の主人公名を優先します。
指定名を別の`NAME` keyとして再置換することもありません。空欄を明示した場合だけ
元SCRの`NAME`定義を使います。この置換は本文だけでなく`MENU`選択肢にも適用します。

### 画像

`LCG` はslot、画像名、crop幅・高さを追跡します。`LINKCG` / `LINK` は
ファイル名suffixから推測せず、その命令時点の左右slotをordered pairとして
1つの「事前結合済みPCE asset」へ対応付けます。`CCG` でslotを複製した場合も
この結合関係を引き継ぎます。

`UNLOADCG` / `UNLOAD` / `UNL` は表示中のCGを消す命令として扱います。変換時は
元CG slotとPCE Sprite slotの現在の所有関係を制御フローごとに追跡し、対象CGがその
PCE slotの現在の表示所有者である場合だけ`Visible: false`を生成します。別の表情や立ち絵が
同じPCE slotを後から上書きしている場合、古いCGへの消去命令で新しい表示を消しません。
範囲付き`UNLOADCG`は`LINKCG`の実際の左右slotも使って対象を解決します。
元SCRは同じslotを再度`LCG`せず`ICG`で再表示するため、変換解析ではLCGのsource metadataを
保持します。後続の`LCG`は同じslotのmetadataを上書きし、`CLEARCG`は全slotのmetadataと
表示状態を初期化します。

画像mappingでは次を指定します。

- `background`: image asset IDとBG tile座標
- `sprite`: sprite asset ID、slot、animation ID
- カード右上のチェックOFF: 意図的に表示しない

Spriteの座標はmappingでは指定しません。各`ICG`のXを数値・16進値・静的定数として
解決し、Dreamcast側の640px座標系から、現在のPCE BG assetの幅と表示位置を使って
`BG表示X（tile X * 8） + round((ICG X + 元source crop X) * BG幅 / 640)`で
PCE座標へ変換します。元source crop Xは **北へ。PM素材** 一括取込時にViewer manifestの
`sourceSize` / `sourceCrop` / `outputSize`とともにasset provenanceへ保存します。
BG assetの幅はassetのpixel幅（通常`224`）から取得し、直前までに変換したBGのtile Xを
表示位置として使います。対応するBGがまだない場合はPCE VN標準の`224px`幅・tile X=`2`
（pixel X=`16`）を使います。変換後はSprite assetの出力幅も考慮し、左端だけでなく
Sprite全幅がBGの左右内側へ収まる範囲へ補正して、行番号付きwarningを残します。
Yはすべて`17`です。同じsprite assetを異なる`ICG`位置で使った場合も、各表示commandへ
個別のXが入ります。

単一sourceは拡張子を除いたpathをasset名として照合します。たとえば
`NEW/AYU/KAPM_001.PVR` は `NEW/AYU/KAPM_001` と一致します。複数画像の
事前結合assetは、各sourceから拡張子と一致しない末尾部分を除いた共通名で
照合します。`BG/KYOTSUU/BGF011_A.PVR` と
`BG/KYOTSUU/BGF011_B.PVR` の組は `BG/KYOTSUU/BGF011` へ対応します。
照合はasset型を考慮し、大文字小文字とslash表記の差は無視します。

asset IDが存在しない場合や、backgroundへsprite、spriteへimageを指定した場合は
errorです。Mapping画面の **アセット対応をリセットして自動照合** は、現在の画像・音声mappingだけを破棄し、最新のasset catalogを再読込して`sourceKey`完全一致、続いて旧assetの名前一致から候補を作り直します。一致しない参照は明示的な省略へ戻します。SCR選択、主人公名、append sceneの所有情報は維持します。リセットは取込画面の作業コピーだけに作用し、キャンセル時はsidecarを変更せず、変換適用に成功した時だけ新しいasset mappingを保存します。

### 音声

- P04 voice / SEは `adpcm` assetへ対応付ける。
- MIDI trackは `psg-song` assetへ対応付ける。
- GD-DAは `cdda-track` assetへ対応付ける。
- 不要な参照はカード右上のチェックをOFFにして明示的に省略する。

非loop P04 voiceは、同じ直線経路上で次に生成されるmessageの先頭ページへ
`voiceAssetId` として付与します。SEとloop P04は独立した`audio` commandへ
変換します。loop P04は対応先ADPCMの`options.loop: true`で保持します。
loop P04を非loop assetへ対応付けた場合は近似warning、非loop P04をloop assetへ
対応付けた場合は意図しない継続再生を防ぐerrorです。音量・pan・音量fadeは
再現せず、行番号付きwarningへ残します。

## メッセージ

`MSG WIN_MSG` は次の `WAIT WIN_MSG` まで連結します。元SCRの明示改行と
改行前後の空白は除去して本文を詰め、`NAME` / 主人公名を置換した後、ナレーションとして
67 glyphずつに再分割します。PCE runtimeが17文字ごとに自動折り返しし、4行目の
最終1文字はページ送りcursor用に予約します。このため、Dreamcast側の行幅を前提にした
改行とPCE側の自動折り返しが重なって空行になることはありません。1つの元messageが
複数ページになった場合、対応するvoiceは先頭ページだけへ付けます。

北へ。PM取込では、NAME・主人公名置換後の本文とMENU選択肢を
System Card jp-v3の収録文字で検査します。非対応のUnicode code pointは1文字ごとに
`□`へ置換し、元のcode point、field、0始まりの文字位置、SCR path・行番号を
`font-character-replaced` warningへ残します。本文は67 glyphへのページ分割前、
MENU選択肢は24文字への切り詰め後に検査するため、実際に保存する表示文字だけが対象です。
不正なCP932 byte列は従来どおりerrorです。この代替は今回取り込むsceneだけに適用し、
Novel editorで手入力したsceneや既存sceneのjp-v3文字検査は引き続きbuild errorにします。

## 制御フロー

初版で保持するものは次のとおりです。

- 数値、16進値、静的定数を使う `DEFINE`、代入、加減算、`IF`
- 同一SCR内のlabel / GOTO
- 選択SCR間のexternal GOTO
- 通常の三択menu
- 認識可能な `WAITBTN` 分岐
- 同一SCR内の `CALL` / `RETURN`

`IF`の比較ではruntime variableが左辺・右辺のどちらに書かれていても判定します。
片側がSCRごとに固定された数値定数、もう片側が更新されるvariableなら、variableを左辺へ
正規化します。左右を入れ替える場合は`<` / `<=` / `>` / `>=`も反転するため、
`IF CG_NORMAL == CG_NOW ...`や`IF LIMIT > SCORE ...`を元と同じ意味で変換できます。
固定数値定数からruntime variableへの代入も、各命令位置の定数値へ解決して保持します。

到達性解析はentry SCRの連結graphを先に処理し、そのgraphから未到達の選択SCRを
先頭から独立rootとして順次処理します。すでにexternal GOTOで接続済みのSCRには
新しい初期stateを重ねないため、CGDIR、CG slot、定数、messageなどの状態継承を維持します。
空でない選択SCRは必ずscene生成対象になり、変換可能な命令がないSCRだけをwarningにします。

`CALL` / `RETURN` は静的に展開し、最大call stackは16です。選択SCRの元命令数は
そのまま解析対象にし、CALL/分岐で増える展開state用の安全枠を選択SCR 1本あたり4096件
加えます。大量の直線命令だけで展開上限を消費することはありません。
再帰、stack超過、state超過はerrorです。重複label、未解決label、戻り先のない
`RETURN`、判定不能な入力cycleもerrorです。

選択外SCRへのexternal GOTOはwarning付きの終端へ変換します。`INCLUDE` は
warning付きで省略します。

写真撮影用として認識できる `ONG` / `KEY` / `ONTG` patternは、timeoutまたは
非撮影側へ固定します。このとき待機用の自己loopを取り除きます。撮影patternか
通常menuかを安全に判定できない入力cycleはerrorです。

引数を持たない `ONTG` は分岐命令ではなくタイマーリセットとして扱い、
`timer-reset-omitted` warning付きで省略します。この命令からGOTOやscene jumpは
生成しません。

変換coreは制御フロー解析用のbasic blockをそのままsceneへせず、同じSCRのblockを
source位置順にまとめます。packing目標はbuild時command見積り220件以下、scene pack
見積り7000 bytes以下で、runtimeのhard limit（255 command / 8192 bytes）に余白を
残します。選択SCRのrootと、容量分割後に別sceneから参照されるblockは必ずscene先頭に
置きます。同一scene内の分岐はblock entry labelへの`goto`、別sceneへの分岐だけを
`jump`へ変換するため、元のlabel / GOTOを保ったままscene数を減らします。
`END`など後続edgeを持たないblockはpacked scene末尾の共通labelへ`goto`し、source順で
後ろに置かれた別blockへ意図せずfall-throughしないようにします。

Choiceは選択値を従来どおり一時variableへ保存し、直接scene遷移は指定しません。直後の
`switch`が同一sceneのblock entry labelまたは別sceneへのbridge `jump`へ振り分けます。
このためChoiceの分岐先だけを理由にsceneを細分化しません。

初回検査の`summary.basicBlockCount`は解析上のblock数、`summary.minimumSceneCount`は
独立して保持すべき選択SCR root数です。raw basic block数が32767を超えても初回検査を
止めず、minimumが32767を超える場合だけ`scene-count-limit` errorにします。mapping後の
previewではpacking済みscene数を検査し、さらにPCE VN managerの非書込みbuild検査で
document全体のscene ID、command数、変数数、実scene pack byte数を確定します。
PCE VN runtimeのscene count、start、current/preloaded/cache indexは16-bitで、
`0xffff`を無効scene sentinelにします。1 documentのscene上限は32767です。
CD-ROM2 buildで音声付きmessageの前に自動挿入されるADPCM preloadは、元のSCR
command indexではなく、生成後の実command列へ反映されます。そのため、IF / SWITCH /
GOTO / WAITBTN のlabel分岐先はpreload挿入後も同じlabel commandを指します。

## 演出の近似

`SCREEN`の全画面fade、flash、blankはPCE VNの`effect`へ近似します。
alpha形式の`FADE`がSprite mapping対象なら、段階的な透明度ではなく同じslotの
`Visible: false/true`へ近似します。`ICG`の初期opacity 0は、元ゲームと同様に後続の
FADE INへ向けた透明状態での準備として追跡し、そのCGがすでにPCE slotの表示所有者でない限り
物理的な非表示commandを生成しません。これにより、同じPCE slotに表示中の旧表情を
透明な次表情の`ICG`だけで消すことを防ぎます。
`CLEARCG`、`DCG <slot>, OFF`、`UNLOADCG` / `UNLOAD` / `UNL`で元スクリプトが
CGを消去・非表示にする場合も同じ所有者判定を使います。FADE IN後に旧CGのFADE OUTが
続くクロスフェード順でも、新しく表示したSpriteを旧CGの命令で消しません。分岐の合流で
同じPCE slotの所有者が経路ごとに異なる場合は、別所有者を消す可能性がある非表示commandを
保守的に生成しません。`CLEARCG`だけは全対応Sprite slotを明示的に非表示にします。
通常のscene切替はSprite状態を保持するため、元スクリプトに消去命令がない場合は表示を引き継ぎます。
BG対象のalpha `FADE`、9引数の明度系`FADE`、`SCG`、`MCG`、`RCG`、`WCG`、
`CFADE`など、初版で安全に表現できない演出も省略してwarningへ記録します。
不明命令も行番号付きwarningとして残します。

`ICG`から生成する`background` commandはFade out / Fade inをともに速度3の`30`へ
設定し、PCE VN runtimeのpalette fadeへ切替演出を任せます。BG対象のalpha `FADE`は
省略するためBG command自身のfadeと重なりません。Spriteのalpha `FADE`は同じslotの
Visible切替へ近似し、`SCREEN`の全画面effect近似は
BG・キャラクター単位のfadeとは別の演出として維持します。

演出の省略は適用を禁止しません。一方、制御フローの破損、未解決label、
必須asset mapping不足、asset型違い、不正なCP932 byte列、各種build予算超過はerrorであり、
scene documentを変更しません。

## 保存ファイル

適用前の現行scene documentを次へ退避します。

```text
assets/pce-vn-scenes.kitahe-backup.json
```

適用後は次のsidecarを保存します。

```text
assets/kitahe-pm-conversion.json
assets/kitahe-pm-conversion-report.json
```

`kitahe-pm-conversion.json` v1には、選択SCRの相対path、entry、主人公名、
asset mapping、import namespace、追加時の所有scene IDを保存します。旧v1 schemaとの
互換用`speakerMappings`は空objectとして保存し、UIや変換には使いません。保存済み主人公名と
mappingは選択SCR集合とentryが一致するimport identityでだけ復元し、直前に扱った別identityの
値へfallbackしません。保存名が空または未保存の新規取込では「ハドソン」を使います。絶対source
pathとmessage本文は保存しません。

reportにはsummary、行番号付き診断、asset要件、近似一覧、scene budget、source mapを
保存します。source mapはPCE scene/commandとSCRの相対path・行番号を対応付けますが、
原文は含みません。

scene documentとsidecarは一度temp fileへ書き、同じdirectory内で置換します。
適用前には選択SCR、mapping、適用mode、現在のdisk scene document、renderer側doc、
asset catalog、既存sidecarから入力signatureを再計算し、preview時と一致しない場合は
stale errorとして停止します。

## Plugin API

main hookの初回検査では、SCR一覧、各選択SCRの変換rootから到達可能な命令の相対SCR path・行番号・opcode、
asset要件、COLOR token、診断を取得します。`reachableInstructions`には本文や
絶対pathを含めません。`summary.estimatedSceneCount`にはmapping前のbasic block
scene推定数を返します。各`assetRequirements[]`にはsourceから導出した
`suggestedAssetName`と、同名・適合型のassetが存在する場合は
`suggestedAssetId` / `suggestedAssetType`が追加されます。

```js
inspectKitahePmSource({
  sourceRoot,
  selectedScripts,
  entryScript,
  protagonistName,
  doc,
  targetMedia,
})
```

mapping後は、同じhookを変換previewとしてもう一度呼びます。

```js
inspectKitahePmSource({
  sourceRoot,
  selectedScripts,
  entryScript,
  protagonistName,
  doc,
  targetMedia: 'cd',
  mapping,
  mode: 'replace', // または 'append'
  setStartScene: true,
  previewConversion: true,
})
```

このpreviewは変換候補を非書込みVN build inspectorへ通し、`diagnostics`、
`sceneBudgets`、`totals`、`canApply`と`signature`を返します。適用には、この
mapping・mode・`setStartScene`と完全に一致するpreviewの`signature`だけを
使用できます。

```js
applyKitahePmConversion({
  sourceRoot,
  selectedScripts,
  entryScript,
  protagonistName,
  doc,
  targetMedia,
  signature,
  mapping,
  mode,
  setStartScene,
  confirmWarnings,
})
```

renderer capabilities:

```js
novel-toolbar-action = {
  label: '北へ。PM取込',
  placement: 'before-preview',
  supportedTargetMedia: ['cd'],
  run(editor),
}

kitahe-pm-script-converter.openImportModal({
  doc,
  assets,
  targetMedia,
})
```

`北へ。PM取込`のボタン定義と実行処理はconverter pluginが所有します。Novel editorは
`novel-toolbar-action`を汎用列挙するだけで、plugin IDを判定しません。そのため
pluginをOFFにした場合とHuCARD projectではボタン自体を表示しません。

asset package inspector hook:

```js
inspectKitahePmAssetPackage({
  manifestPath,
  targetMedia: 'cd',
  assetCatalogSignature,
})
```

戻り値はstrict検査済みの`rows`、画像/MIDI/音声metadata preview、`summary`、
`inspectionSignature`、`assetCatalogSignature`を持ちます。inspectはassetを変更しません。

asset package renderer capabilities:

```js
kitahe-pm-asset-importer.openImportModal({ targetMedia, assets, reload })

asset-batch-importer = {
  label: '北へ。PM素材',
  supportedTargetMedia: ['cd'],
  open(options),
}
```

rendererからmain hookを呼ぶ際、現在のproject directoryとasset catalogはhostが
contextとして渡します。plugin専用IPCや本体main/preloadのplugin ID分岐は使いません。

## Security and reproducibility

- SCR pathは選択resource rootの`SCRIPT`以下へ正規化し、絶対path、`..`、symlink
  escapeを拒否します。
- packageの`file`はpackage rootからの相対pathだけを許可し、絶対path、`..`、
  missing file、symlink/junction escapeを拒否します。
- package manifest、素材file、asset catalogのhash/signatureを適用直前にも検査します。
- 外部rootは読取り専用です。
- projectへの書込み先は上記3 sidecarと正規のVN scene fileだけです。
- inspectはprojectを変更しません。
- diagnosticsとscene IDの順序は同じ入力から決定的に生成します。
- テストfixtureは合成CP932だけを使い、ゲーム本文や抽出assetをrepositoryへ
  追加しません。
