---
name: ishi-no-ura-pce-vn-authoring
description: 「いしのうらにいる！？」の新話を、企画整理、シナリオ設計、台詞執筆、224x136イベントスチル制作、PCE向け16色化、pce-vn-scenes.json組み込み、分岐・文字数・assetId・到達性検査まで一貫して行う。第2話以降の話数制作、PCE VNスクリプト修正、イベントスチル選定・生成・減色・登録計画、HuCARD向け検証を依頼されたときに使う。一般的なPCEエンジン開発や別作品のシナリオには使わない。
---

# 「いしのうらにいる！？」PCE VN話数制作

このスキルは、女子部活日常コメディ「いしのうらにいる！？」の新しい話を、正本資料に従って制作・検査するための専用ワークフローである。

## 最優先ルール

1. プロジェクト内の正本を探して先に読む。
   - `docs/series-bible.md` または `series-bible.md`
   - `docs/asset-catalog.md` または `asset-catalog.md`
   - `docs/chatgpt-authoring-workflow.md` または `chatgpt-authoring-workflow.md`
   - スクリプト工程では `assets/pce-vn-scenes.json`
   - スクリプト工程では `assets/pce-assets.json`
   - ユーザーが承認したシナリオ設計
2. 同名のプロジェクト資料がある場合、`references/` の同梱資料よりプロジェクト側を優先する。同梱資料は基準スナップショットである。
3. 資料にないキャラクター設定、話者名、asset ID、command、エンジン仕様を作らない。
4. 事実とキャラクターの偏見を分離する。時点で変わり得る製品・価格・販売数・契約条件は、ユーザー提供資料または確認済み一次情報なしに断定しない。
5. 部長だけを正解にせず、レンを悪役にせず、チカを専門家にしない。
6. 画像やJSONが不足している場合、完成したと装わない。不足物と次工程を明示する。

必要に応じて次を読む。

- キャラクター・シリーズ判断: `references/series-bible.md`
- asset ID・画像・音声判断: `references/asset-catalog.md`
- JSON仕様・工程・受け入れ条件: `references/chatgpt-authoring-workflow.md`
- 今回までの具体例: `references/episode-02-case-study.md`
- 短い実務チェック: `references/production-checklist.md`

## 依頼を工程へ振り分ける

ユーザーの依頼を次のいずれかへ分類し、その工程だけを実行する。複数工程を明示的に頼まれた場合は順番に進める。

### A. シナリオ設計

台詞全文やJSONをまだ作らない。

必須出力:

1. 作品概要と仮タイトル
2. 確認済み事実と各キャラクターの偏見
3. scene候補一覧と想定message数
4. 部長・チカ・レンの攻守表
5. 分岐1の2択、短い差分、共通合流先
6. 分岐2の2択、短い差分、共通合流先
7. 既存asset利用表
8. イベントスチル計画
9. イベントスチル以外の不足asset
10. 合計想定message数
11. シリーズ設定セルフチェック

基準:

- 1話15〜20分、全scene合計220〜280 message
- 2択を2回
- 選択肢はチカの反応または行動
- 各分岐は数messageから十数messageで合流
- 現物または実際の行動による因果応報
- 最後にチカの日常的な観察
- 短いタグのオチ
- 話数固有イベントスチルは最低3枚
- 必須スチルは原則として全ルート共通経路で見られる構造

入力テンプレートは `assets/templates/episode-brief.md` を使う。

### B. イベントスチル選定・画像生成

まず物語上の役割を選定する。標準は次の3枚である。

- `epNN_001`: 題材・現物の提示
- `epNN_002`: レスバまたは因果応報の最高潮
- `epNN_003`: エンディングまたはタグのオチ

必要なら4枚目以降を追加する。追加理由と使用sceneを明示する。

画像生成ツールが利用できる場合は、プロンプトだけで終わらず画像を生成する。各スチルは独立画像として1枚ずつ作る。登場人物の参照画像を必ず使う。プロジェクト側に参照spriteまたは設定画がある場合はそれを優先し、なければ `assets/character-references/` を使う。

画像仕様:

- 最終サイズは正確に224×136 PNG
- 224:136、すなわち28:17の比率
- 日本のアニメのセル画風
- 太く明快な輪郭線
- ベタ塗り中心、影は2〜3段階
- 広いグラデーションを避ける
- 大きな色面と高いシルエット可読性
- 16色化後も顔、表情、重要物が判別できる構図
- 文字、字幕、ロゴ、吹き出し、UI、透かしを描かない
- 顔や重要物を画面端で切らない
- 参照画像の髪型、髪色、服装、年齢感、体格を維持する

生成ツールが224×136を直接出せない場合は、28:17に近い横長画像を作り、後工程で中央クロップまたは指定クロップして224×136へ変換する。縦横へ引き伸ばさない。

画像生成ツールが利用できない場合は、作成できなかったことを明示し、`assets/templates/still-plan.json` 形式の生成計画だけを返す。

### C. PCE向け16色化

元画像を直接上書きしない。次のスクリプトを使う。

```bash
python scripts/prepare_event_stills.py \
  --input-dir path/to/source-stills \
  --output-dir assets/images \
  --prefix ep02_
```

または個別指定:

```bash
python scripts/prepare_event_stills.py \
  --input source.png \
  --output assets/images/ep02_001.png
```

既定処理:

- 224×136へ比率維持クロップ
- ディザなし
- PCEの3bit RGB段階へ丸める
- 表示15色以内＋予約1色の4bit indexed PNG
- index 0を予約し、通常画素では使わない
- 出力検査を実施

輪郭がつぶれる、顔が読めない、重要物が消える場合は、単なる減色の再試行ではなく元画像の構図・輪郭・模様密度を直してから再生成する。

### D. 台詞全文と `pce-vn-scenes.json` 生成

承認済みのシナリオ設計と、現行の入力JSONを基に全文を作る。

構造:

- `version` は2
- `startScene` は入力の `logo` を維持
- `settings` は入力値を維持
- `logo`、`title`、`eye_catch` sceneを原則そのまま維持
- `title` の `GAME_START` 後にあるゲーム開始jumpだけを新話冒頭へ変更
- 旧 `ep01_*` など前話本文sceneを新話 `epNN_*` へ置換
- 新話末尾から `eye_catch` へjump
- `nextSceneId` と末尾jumpを重複させない
- 原則として末尾jumpを使う
- episode sceneのIDは `epNN_*`
- episode sceneのnameは `第NN話/...`
- 1sceneのUTF-8 JSON概算が4096 bytesを超えないよう早めに分割する。最終判定はエディタのscene budgetとbuildで行う

新しいepisode sceneで使えるcommand:

- `background`
- `sprite`
- `spritemove`
- `message`
- `audio`
- `choice`
- `jump`
- `wait`
- `effect`

`logo`、`title`、`eye_catch`に既存の `inputcheck`、`label`、`spritetext`、`comment` がある場合だけ維持する。新話本文へ `cache`、`variable`、`if`、`switch`、`goto`、`inputcheck`、`spritetext`、独自commandを追加しない。

台詞表示:

- 話者名は `部長`、`チカ`、`レン` のみ
- 部長の `mouthSlot` は0
- チカは1
- レンは2
- ナレーションは `speaker: ""`、`mouthSlot: null`
- 話者あり本文は最大3行
- ナレーションは最大4行
- 各行17文字以内
- `message.text` は96文字以内
- 自動折り返しへ頼らず改行を入れる
- 句点と読点は原則使わない
- 全角空白、改行、`…`、`！`、`？`でテンポを作る
- `voiceAssetId` は新話の全messageで空文字
- 半角カナ、絵文字、CP932拡張、JIS第二水準を使わない

アセット:

- `pce-assets.json` に登録済みのIDだけを完成JSONへ使う
- event stillをまだ登録していない段階では、ユーザーが明示的にプレースホルダ統合を求めた場合だけ、登録計画を同時生成して仮参照を許す
- その場合は「登録前でstrict validationは未完了」と明示する
- 背景は登録済みの学校、廊下、部室、話数固有スチルだけ
- 立ち絵は登録済みの表情だけ
- 会話BGM・SEは既存PSGを優先
- ADPCMとCD-DAはHuCARDで無音になるため、新しい会話演出へ依存させない

イベントスチルを表示するsceneでは、直前の立ち絵を `visible: false` にしてからスチルをbackground表示する。次の通常会話sceneでは背景と立ち絵を明示的に復帰させる。

### E. 既存スクリプトへイベントスチルを組み込む

1. 物語上の瞬間とsceneを対応付ける。
2. `assets/templates/still-integration-map.json` をコピーして対応表を作る。
3. 必要なら次の補助スクリプトを使う。

```bash
python scripts/integrate_event_stills.py \
  --scenes assets/pce-vn-scenes.json \
  --mapping still-integration-map.json \
  --output assets/pce-vn-scenes.with-stills.json
```

このスクリプトは指定sceneの先頭へ、立ち絵非表示とスチルbackgroundを挿入する。物語上の表示位置がscene途中である場合は、自動挿入に頼らずsceneを分割して、その新scene先頭に置く。

4. 全分岐からスチルを含むエンディング経路へ到達できるようにする。
5. 通常背景へ戻るsceneで立ち絵を再表示する。
6. validatorを実行する。

### F. 検査・納品

必ずvalidatorを実行する。

登録済みassetだけで厳密検査:

```bash
python scripts/validate_pce_vn.py \
  --scenes assets/pce-vn-scenes.json \
  --assets assets/pce-assets.json \
  --episode 2 \
  --strict
```

スチル登録前の計画検査:

```bash
python scripts/validate_pce_vn.py \
  --scenes assets/pce-vn-scenes.json \
  --assets assets/pce-assets.json \
  --episode 2 \
  --planned-assets event-still-registration-plan.json
```

納品用ZIPを作る場合:

```bash
python scripts/package_episode.py \
  --scenes assets/pce-vn-scenes.json \
  --stills assets/images \
  --registration-plan event-still-registration-plan.json \
  --output episode-package.zip
```

validatorで確認する項目:

- JSON parse
- version、startScene、system scene
- scene ID重複
- jump、choice target、nextSceneIdの存在
- 末尾jumpとnextSceneIdの重複
- 2回のchoice、各2択
- episode sceneのcommand制限
- message数220〜280
- 行数、1行17文字、96文字
- 話者とmouthSlot
- `voiceAssetId` 空文字
- JIS第一水準相当と非漢字領域
- asset ID存在とtype整合
- event still最低3枚
- event stillがepisode startからeye_catchまでの全経路で見られるか
- 各分岐からeye_catchへ到達可能か
- sceneのUTF-8 JSONサイズ概算

機械検査を通っても、次は人間またはエディタで確認する。

- 表情と台詞の一致
- レンの方言が濃すぎない
- 部長とレンの両方に正しさと滑稽さがある
- チカが専門家化していない
- スチルの顔、手、重要物の崩れ
- PCE previewでの判読性
- scene budget 4096 bytes
- HuCARD buildとCD-ROM2 build
- 全選択肢の実プレイ

## 出力の扱い

- ユーザーが「JSON全文だけ」と指定した場合、説明を付けずJSONだけを返す。
- ファイル作成環境がある場合、巨大JSONは保存可能なファイルとして作成し、検査レポートを別ファイルにする。
- 画像生成を行った直後は、画像ツールの仕様に従う。
- 失敗や未登録assetを隠さない。
- 完了時は、作成物、検査結果、残る手動工程だけを短く報告する。

## 完了条件

- 正本と承認済み設計から逸脱していない
- 220〜280 message
- 2択を2回、短く合流
- 最低3枚の224×136話数固有スチル
- 16色化後にも意味が読める
- 登録済みassetだけを参照する完成JSON
- 全分岐からエンディングと `eye_catch` に到達
- validatorにerrorがない
- エディタと両media buildの確認項目が明示されている
