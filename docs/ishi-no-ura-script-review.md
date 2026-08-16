# 「いしのうらにいる！？」台本レビュー運用

## 目的

既存話の設定、話数固有コンセプト、連続性、scene遷移、選択肢、演出付き全文台本を話数ごとに抽出し、Codex、外部AI、人間が同じ位置IDと差分形式で校正できるようにする。

対象スキルは `.agents/skills/review-ishi-no-ura-pce-vn-scripts/`。新話の企画・執筆ではなく、現行の `ishi_no_ura_NN/assets/pce-vn-scenes.json` をレビューするためのスキルである。

## 正本と対象話

標準では次を現行正本とする。

- 第1話: `data/projects/ishi_no_ura_01`
- 第2話: `data/projects/ishi_no_ura_02`
- 第3話: `data/projects/ishi_no_ura_03`
- 第4話: `data/projects/ishi_no_ura_04`

`ishi_no_ura_00` とコピー名のJSONは、明示指定がない限り旧稿として除外する。

## 各話の生成物

`data/projects/ishi_no_ura_reviews/epNN/` に次を生成する。

| ファイル | 用途 |
| --- | --- |
| `review-pack.md` | 設定、話数コンセプト、事実／未確定事項、scene・分岐、使用asset、機械検査、演出付き全文台本 |
| `review-changes.template.json` | 外部AI／人間が返す空の変更票 |
| `review-changes.json` | Codex自己レビューまたは統合済み提案。正本hashと修正前スナップショットを保持 |
| `self-review.md` | 修正前と修正後を横並びにした人間向け差分 |
| `pce-vn-scenes.reviewed.json` | 承認済み変更を適用するときだけ作る別JSON |

messageの位置IDは `EP03::ep03_05_02_branch_shop::C005` のように、話数、scene ID、1始まりのcommand番号を組み合わせる。choiceラベルはchoice commandの位置IDと1始まりの`choiceNumber`で指定する。

## 抽出

例として第1話を抽出する。

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs extract --project data/projects/ishi_no_ura_01 --out data/projects/ishi_no_ura_reviews/ep01

抽出は正本を変更しない。`review-pack.md`の`sourceSha256`が対象JSONに固定されるため、レビュー中に正本が変わった場合は古い変更票を適用できない。

## レビューと差分表示

外部reviewerは`review-pack.md`を全文読み、`review-changes.template.json`へ提案を書く。operationはmessageの`replace`、`insert-before`、`insert-after`、`delete`と、choiceラベルの`replace-choice-label`を使用できる。

変更票を検査し、人間向け差分を生成する。

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs validate --project data/projects/ishi_no_ura_01 --changes data/projects/ishi_no_ura_reviews/ep01/review-changes.json

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs render --project data/projects/ishi_no_ura_01 --changes data/projects/ishi_no_ura_reviews/ep01/review-changes.json --out data/projects/ishi_no_ura_reviews/ep01/self-review.md

検査は正本hash、修正前の完全一致、位置ID、競合、17文字、行数、96文字、話者とmouthSlotを確認する。既存mouthSlot不一致を本文校正で変更しない場合は許容するが、不一致自体は抽出パックの機械検査に残る。スチル中の口パク停止など演出意図を確認してから判断する。

## 承認と反映

外部AIとCodexの提案は`proposed`で保持する。同じ位置の競合案を自動採用せず、人間が`approved`、`rejected`、`needs-discussion`へ変更する。

承認済みだけを別JSONへ適用する。

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs apply --project data/projects/ishi_no_ura_01 --changes data/projects/ishi_no_ura_reviews/ep01/review-changes.json --out data/projects/ishi_no_ura_reviews/ep01/pce-vn-scenes.reviewed.json --clear-voices

正本は直接上書きしない。台詞本文または話者を変えると既存`voiceAssetId`の音声が古くなるため、`--clear-voices`で変更箇所のIDを空にし、採用後に音声を再生成する。choiceラベルだけの変更では音声再生成は不要。

## 2026-08-13 自己レビュー基準点

第1〜4話の正本を全件通読し、次の成果物を生成した。

| 話 | scene | message | choice | Codex提案 |
| --- | ---: | ---: | ---: | ---: |
| 第1話 | 15 | 275 | 2 | 15 |
| 第2話 | 28 | 243 | 2 | 26 |
| 第3話 | 29 | 251 | 2 | 42 |
| 第4話 | 26 | 261 | 2 | 25 |
| 合計 | 98 | 1030 | 8 | 108 |

全4変更票は`validate`でerror 0、warning 0。提案はまだ正本へ適用しておらず、状態は`SELF_REVIEWED / EXTERNAL_REVIEW_PENDING`である。

共通して強かったAI調は、終幕で一般論を連続説明する、直前の物を指さない比喩を使う、チカが完成した倫理規則を断言する、対象や期間のない市場動向を権威として使う、という傾向だった。自己レビューでは、紙へ書く、棚から探す、同じ画面を見る、次の対戦を選ぶなど、各sceneで見える行動へ置き換えている。

抽出時の機械検査候補は全4話で171件ある。17文字超過、句読点、mouthSlotなどを含み、イベントスチルの演出意図も混ざるため、171件をそのまま欠陥数として扱わない。