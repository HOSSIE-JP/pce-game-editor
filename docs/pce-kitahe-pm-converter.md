# 北へ。PhotoMemories SCR → PCE VN converter

`pce-kitahe-pm-converter` は、Dreamcast 版「北へ。PhotoMemories」の解析済み
`*.SCR` を、PC Engine Game Editor の CD-ROM2 Visual Novel scene document へ
変換する組み込みプラグインです。

この機能はスクリプトだけを変換します。元画像の結合・crop・縮小・減色、P04
のADPCM化、MIDIのPSG化、GD-DA trackの登録は行いません。変換前に人手で
加工・登録したPCE assetを、取込画面でSCR上の参照へ対応付けてください。

## 対象と前提

- 出力先は `targetMedia: "cd"` のCD-ROM2 VNだけです。HuCARD projectへは
  適用できません。
- ユーザーが選んだresource root直下の `SCRIPT` 以下だけを読みます。
- 変換対象は取込画面で明示的に選択したSCRだけです。
- 選択したSCR群では変数を共有し、labelとscene IDはSCR単位のnamespaceへ
  分離します。
- 外部projectのソースやゲーム本文、絶対source pathをPCE projectへコピー
  しません。
- 画像・音声のsource binaryは生成しません。変換結果が参照するのは既存の
  PCE asset IDだけです。

## 取込手順

Novel画面の `北へ。PM取込` を押し、次の順で設定します。

1. resource rootを選ぶ。root直下に `SCRIPT` directoryが必要です。
2. 一覧から変換対象のSCRを複数選択し、entry SCRと主人公名を指定する。
3. 検出されたすべての `COLOR` tokenを、16文字以内の話者名または
   `ナレーション` へ割り当てる。
4. 到達可能な画像・P04・MIDI・GD-DA参照を確認する。source名と既存PCE
   asset名が一致する参照は自動的に割り当てられ、一致しない参照は省略状態になる。
   必要に応じて対応assetを変更するか、カード右上のチェックをOFFにして省略する。
5. 行番号付き診断、近似内容、scene予算を確認する。
6. `置換` または `追加` を選び、warningを確認して適用する。

`置換` は現在のVN settingsを維持してsceneだけを置き換え、取込entryを
`startScene` にします。`追加` は既存sceneと既存`startScene`を既定で維持し、
安定したimport namespaceを付けたsceneを追加します。追加時に「取込entryから
開始」を選んだ場合だけ`startScene`を変更します。

再取込では、前回のsidecarに所有sceneとして記録されたIDだけを更新できます。
同じIDが現在のdocumentにあっても、converterの所有を確認できない場合は
衝突errorとして停止します。

## Mapping

### 話者

`COLOR WIN_MSG, token` のtokenごとに、次のどちらかを必ず指定します。

- `speaker`: 1〜16文字の話者名
- `narration`: 話者欄を使わない本文

`NAME` の置換はページ分割より先に行います。主人公を表す既知tokenには、
取込画面で指定した主人公名を優先します。

### 画像

`LCG` はslot、画像名、crop幅・高さを追跡します。`LINKCG` / `LINK` は
ファイル名suffixから推測せず、その命令時点の左右slotをordered pairとして
1つの「事前結合済みPCE asset」へ対応付けます。`CCG` でslotを複製した場合も
この結合関係を引き継ぎます。

画像mappingでは次を指定します。

- `background`: image asset IDとBG tile座標
- `sprite`: sprite asset ID、slot、画面座標、animation ID
- カード右上のチェックOFF: 意図的に表示しない

単一sourceは拡張子を除いたpathをasset名として照合します。たとえば
`NEW/AYU/KAPM_001.PVR` は `NEW/AYU/KAPM_001` と一致します。複数画像の
事前結合assetは、各sourceから拡張子と一致しない末尾部分を除いた共通名で
照合します。`BG/KYOTSUU/BGF011_A.PVR` と
`BG/KYOTSUU/BGF011_B.PVR` の組は `BG/KYOTSUU/BGF011` へ対応します。
照合はasset型を考慮し、大文字小文字とslash表記の差は無視します。

asset IDが存在しない場合や、backgroundへsprite、spriteへimageを指定した場合は
errorです。

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

`MSG WIN_MSG` は次の `WAIT WIN_MSG` まで連結します。明示改行、NAME置換、
話者mappingを適用した後、PCE VNの17文字×4行へ再分割します。話者名がある
messageは本文を残り3行に収めます。1つの元messageが複数ページになった場合、
対応するvoiceは先頭ページだけへ付けます。

CD-ROM2 VNでencodeできない文字はerrorです。文字を黙って代替したり削除したり
しません。

## 制御フロー

初版で保持するものは次のとおりです。

- 数値、16進値、静的定数を使う `DEFINE`、代入、加減算、`IF`
- 同一SCR内のlabel / GOTO
- 選択SCR間のexternal GOTO
- 通常の三択menu
- 認識可能な `WAITBTN` 分岐
- 同一SCR内の `CALL` / `RETURN`

`CALL` / `RETURN` は静的に展開し、最大call stackは16、展開stateは4096です。
再帰、stack超過、state超過はerrorです。重複label、未解決label、戻り先のない
`RETURN`、判定不能な入力cycleもerrorです。

選択外SCRへのexternal GOTOはwarning付きの終端へ変換します。`INCLUDE` は
warning付きで省略します。

写真撮影用として認識できる `ONG` / `KEY` / `ONTG` patternは、timeoutまたは
非撮影側へ固定します。このとき待機用の自己loopを取り除きます。撮影patternか
通常menuかを安全に判定できない入力cycleはerrorです。

変換coreはbasic blockを決定的にsceneへ分割します。同一scene外を指すlabel分岐は
scene内のbridge labelと`jump`へ変換します。scene ID、command数、変数数、
scene pack byte数の上限は、保存前にPCE VN managerの非書込みbuild検査を通します。

## 演出の近似

単純な画面fade、flash、blank、`SCREEN` はPCE VNの`effect`へ近似します。
`SCG`、`MCG`、`RCG`、`WCG`、`CFADE`など、初版で安全に表現できない演出は
省略してwarningへ記録します。不明命令も行番号付きwarningとして残します。

演出の省略は適用を禁止しません。一方、制御フローの破損、未解決label、
必須mapping不足、asset型違い、文字encode失敗、各種build予算超過はerrorであり、
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

`kitahe-pm-conversion.json` v1には、選択SCRの相対path、entry、主人公名、話者mapping、
asset mapping、import namespace、追加時の所有scene IDを保存します。絶対source
pathとmessage本文は保存しません。

reportにはsummary、行番号付き診断、asset要件、近似一覧、scene budget、source mapを
保存します。source mapはPCE scene/commandとSCRの相対path・行番号を対応付けますが、
原文は含みません。

scene documentとsidecarは一度temp fileへ書き、同じdirectory内で置換します。
適用前には選択SCR、mapping、適用mode、現在のdisk scene document、renderer側doc、
asset catalog、既存sidecarから入力signatureを再計算し、preview時と一致しない場合は
stale errorとして停止します。

## Plugin API

main hookの初回検査では、SCR一覧、到達可能命令の相対SCR path・行番号・opcode、
asset要件、COLOR token、診断を取得します。`reachableInstructions`には本文や
絶対pathを含めません。各`assetRequirements[]`にはsourceから導出した
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

renderer capability:

```js
kitahe-pm-script-converter.openImportModal({
  doc,
  assets,
  targetMedia,
})
```

rendererからmain hookを呼ぶ際、現在のproject directoryとasset catalogはhostが
contextとして渡します。plugin専用IPCや本体main/preloadのplugin ID分岐は使いません。

## Security and reproducibility

- SCR pathは選択resource rootの`SCRIPT`以下へ正規化し、絶対path、`..`、symlink
  escapeを拒否します。
- 外部rootは読取り専用です。
- projectへの書込み先は上記3 sidecarと正規のVN scene fileだけです。
- inspectはprojectを変更しません。
- diagnosticsとscene IDの順序は同じ入力から決定的に生成します。
- テストfixtureは合成CP932だけを使い、ゲーム本文や抽出assetをrepositoryへ
  追加しません。
