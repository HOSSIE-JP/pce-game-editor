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

Settings > Pluginsで「PCE VN プロジェクト結合」を有効にすると、CD-ROM2 projectのNovel toolbarへ「プロジェクト結合」が表示されます。現在のprojectは第1入力として固定され、後続入力の追加・削除・並べ替え、出力親folder、出力名、タイトル、所有出力の置換をmodalで指定できます。

「検査」は現在のNovel編集内容を先に保存し、main hook `inspectVnProjectMerge`を呼びます。検査後に入力順や出力設定を変更すると結果を破棄し、再検査するまで「結合」を無効にします。「結合」は検査時のsignatureを`applyVnProjectMerge`へ渡し、main側が全入力を再検査して一致した場合だけ実行します。生成後もeditorのactive projectは切り替えません。

## 結合規約

- 現行CD VN templateから空の出力を作り、第1入力のauthor、serial、System Card、Test Play、VN設定、fontを引き継ぎます。targetとbuilderはCD-ROM2へ固定します。
- 入力順に`m001_`、`m002_`…の名前空間をscene ID、asset ID、global variable名へ付けます。scene/assetは48文字、variableは32文字に収め、切り詰める場合はhash suffixで衝突を防ぎます。
- `startScene`、`nextSceneId`、Jump、Choice、scene/asset/variableを参照する全commandを変換します。
- 各入力の開始sceneでは、`NEXT_SCR` label直後のJumpを次projectの開始sceneへ、`PREV_SCR` label直後のJumpを前projectの開始sceneへ付け替えます。最後のNEXTは先頭へ、先頭のPREVは最後へ接続します。
- 登録assetのsource、generated file、高品質sourceを`assets/merged/<namespace>/`へcopyし、catalog pathを更新します。同内容でも入力をまたぐ暗黙dedupeは行いません。
- `cdda-warning`は入力順で最初の有効な1件だけを残します。`cdda-track`は入力順・元track順に並べ、Track 3から連番へ振り直します。
- 第1入力の全体設定を正とし、後続入力との差分はwarningにします。空scene document、selector規約不一致、未解決参照、登録file欠損はerrorです。
- `source/`、`out/`、QA画像など、catalogに登録されていない制作物・派生物は結合しません。

## 共通APIと原子性

`pce-vn-project-merger.js`は次を公開します。

- `inspectProjectMerge(options)`: canonical入力path、入力signature、名前空間と変換表、scene/asset/file件数、copy byte数、診断を返します。
- `applyProjectMerge(options)`: 必須の`signature`を再検査し、出力と同じ親folderの一時directoryへ生成します。生成物を`inspectVnSceneDocumentBuild()`で再検査してからrenameで確定します。

出力の`.pce-vn-merge.json`には入力順、canonical path、signature、名前空間、変換表、件数を記録します。入力と出力の包含関係は拒否し、所有markerのないdirectoryを置換しません。

## Scene index

結合後のscene count、start scene、runtimeのcurrent/preloaded/cache scene indexは16-bitです。`0xffff`を無効scene sentinelにし、CD-ROM2 / HuCARD runtimeとgenerated headerを同期しています。`VN_MAX_SCENE_COUNT`は32767です。command、message、choice、switch、variableの既存8-bit上限は変わりません。
