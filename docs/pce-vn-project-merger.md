# PCE VN 複数プロジェクト結合

`pce-vn-project-merger`は、2件以上のCD-ROM2 Visual Novel projectを1つの編集・build可能なprojectへ結合します。共通coreをCLIとNovel toolbarの両方から使うため、検査結果、ID変換、asset copy、診断は同じです。

## CLI

```powershell
npm run merge:vn -- --output <出力先> [--title <タイトル>] [--dry-run] [--replace] <project1> <project2> ...
```

- 入力は指定順に扱い、2件以上必要です。
- `--dry-run`は入力検査、変換表、件数、容量、診断、signatureだけを返し、出力を書きません。
- title未指定時は出力folder名を`title` / `romName`へ使います。
- 既存出力は既定で拒否します。`--replace`は、その出力直下に有効な`.pce-vn-merge.json`がある、このtool自身の既存出力だけへ使用できます。

## Novel toolbar

Settings > Pluginsで「PCE VN プロジェクト結合」を有効にすると、CD-ROM2 projectのNovel toolbarへ「プロジェクト結合」が表示されます。modalは現在projectの親folderをproject rootとして再帰探索し、左ペインのcheckboxで任意の有効projectを選択し、右ペインで統合順を確認・上下移動できます。現在projectは初期選択されますが固定入力ではなく解除可能です。検索結果だけを一括選択する「表示中を全選択」と「全解除」も使用できます。

候補一覧はrootからの相対pathを数値込みの自然順で表示します。PC Engine/CD-ROM2でないproject、必須JSONやselector規約が不正なproject、番号表示用SpriteTextと衝突するproject、既存のtool所有merge出力は選択不可にし、理由を行内に表示します。symlink/junctionは再帰探索せず、選択pathは検査・結合時にもcanonical root内か再検証します。

初期出力親folderはroot、初期出力名は`<root folder名>_merged`です。root、選択、統合順、出力設定を変更すると検査結果を破棄します。2件未満では検査・結合できません。

「検査」は現在projectが選択に含まれる場合だけNovel編集内容を先に保存し、main hook `inspectVnProjectMerge`を呼びます。「結合」は検査時のsignatureを`applyVnProjectMerge`へ渡し、main側がroot、明示入力、全fileを再検査して一致した場合だけ実行します。生成後もeditorのactive projectは切り替えません。

## 結合規約

- 現行CD VN templateから空の出力を作り、第1入力のauthor、serial、System Card、Test Play、VN設定、fontを引き継ぎます。targetとbuilderはCD-ROM2へ固定します。
- 入力順に`m001_`、`m002_`…の名前空間をscene ID、asset ID、global variable名へ付けます。scene/assetは48文字、variableは32文字に収め、切り詰める場合はhash suffixで衝突を防ぎます。
- `startScene`、`nextSceneId`、Jump、Choice、scene/asset/variableを参照する全commandを変換します。
- 各入力の開始sceneでは、`NEXT_SCR` label直後のJumpを次projectの開始sceneへ、`PREV_SCR` label直後のJumpを前projectの開始sceneへ付け替えます。最後のNEXTは先頭へ、先頭のPREVは最後へ接続します。
- 各入力の開始sceneでは、最初の入力/control-flow commandより前へ既存`spritetext` commandを1件追加し、選択順と選択総数を`(1/N)`〜`(N/N)`で表示します。slot 2、y=194、点滅なし、12px pitchによる256px画面中央配置です。色はその位置までに表示された最後のSpriteText色を継承し、存在しなければ白です。
- 開始sceneがSpriteText slot 2を既に使う、または別の可視SpriteTextがy=194の16px行と重なる場合はerrorです。既存表示の移動・削除・slot 3への退避は行いません。入力projectは変更せず、生成outputだけに番号を追加します。
- 登録assetのsource、generated file、高品質sourceを`assets/merged/<namespace>/`へcopyし、catalog pathを更新します。同内容でも入力をまたぐ暗黙dedupeは行いません。
- `cdda-warning`は入力順で最初の有効な1件だけを残します。`cdda-track`は入力順・元track順に並べ、Track 3から連番へ振り直します。
- 第1入力の全体設定を正とし、後続入力との差分はwarningにします。空scene document、selector規約不一致、未解決参照、登録file欠損はerrorです。
- `source/`、`out/`、QA画像など、catalogに登録されていない制作物・派生物は結合しません。

## 共通APIと原子性

`pce-vn-project-merger.js`は次を公開します。

- `discoverProjectMergeCandidates(options)`: root配下を非同期・再帰探索し、path、相対path、title、選択可否、無効理由を自然順で返します。
- `inspectProjectMerge(options)`: canonical入力path、入力signature、名前空間と変換表、scene/asset/file件数、copy byte数、診断を返します。
- `applyProjectMerge(options)`: 必須の`signature`を再検査し、出力と同じ親folderの一時directoryへ生成します。生成物を`inspectVnSceneDocumentBuild()`で再検査してからrenameで確定します。

renderer用main hookは`discoverVnProjectMergeCandidates`、`inspectVnProjectMerge`、`applyVnProjectMerge`です。rendererは汎用filesystem IPCを使わず、明示したrootとprojectsだけをhookへ渡します。CLIは従来どおり個別project pathを指定しますが、共通coreを使うため番号生成規約はtoolbarと同じです。

出力の`.pce-vn-merge.json`には入力順、canonical path、signature、名前空間、変換表、件数を記録します。入力と出力の包含関係は拒否し、所有markerのないdirectoryを置換しません。

## Scene index

結合後のscene count、start scene、runtimeのcurrent/preloaded/cache scene indexは16-bitです。`0xffff`を無効scene sentinelにし、CD-ROM2 / HuCARD runtimeとgenerated headerを同期しています。`VN_MAX_SCENE_COUNT`は32767です。command、message、choice、switch、variableの既存8-bit上限は変わりません。

結合出力はCD-ROM2固定です。将来HuCARDへ媒体変更する場合、HuCARD runtimeでは全SpriteText slotがSATB tail 16 entriesを共有するため、見出し・題名・番号の合計glyph数を別途再設計・検証する必要があります。
