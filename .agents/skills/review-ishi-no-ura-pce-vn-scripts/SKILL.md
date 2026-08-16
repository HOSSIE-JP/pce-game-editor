---
name: review-ishi-no-ura-pce-vn-scripts
description: 「いしのうらにいる！？」の既存PCE VN各話を、設定・コンセプト・連続性・分岐・演出付きの外部レビュー用パックへ抽出し、不自然な日本語、唐突な発話、設定矛盾、抽象的なAI調表現、人物口調、表示制約を校正する。ishi_no_ura_NN/assets/pce-vn-scenes.jsonの台本レビュー、人間や外部AIへの校正依頼、修正前後の比較、承認済み修正の反映を依頼されたときに使う。新話のゼロからの企画・執筆には使わない。
---

# 「いしのうらにいる！？」既存台本レビュー

既存話の正本を壊さず、各発話へ再現可能な位置IDを付け、自己レビューと外部レビューを同じ差分形式で扱う。

## 最優先ルール

1. 先に references/series-context.md、references/review-criteria.md、references/change-format.md を全文読む。
2. 現行正本は対象プロジェクトの assets/pce-vn-scenes.json と assets/pce-assets.json とする。ishi_no_ura_00 や pce-vn-scenes - コピー.json は、ユーザーが明示しない限り旧稿として除外する。
3. 利用可能なら既存 ishi-no-ura-pce-vn-authoring の series-bible.md と natural-dialogue-guidelines.md も読み、同名のプロジェクト資料があればそちらを優先する。
4. 全messageと全choiceラベルを順番に読み、問題候補だけを検索結果から拾って完了としない。choiceの両分岐と合流後も読む。
5. messageとchoiceラベルの修正案は必ず正本の修正前テキストと並べ、locationId、scene、前後文脈、理由を残す。
6. 外部レビュー結果は提案として扱い、人間またはユーザーの承認前に正本へ反映しない。ユーザーがこのターンで直接修正まで依頼した場合は、その依頼を承認として扱える。
7. 台詞変更で既存 voiceAssetId と音声が不一致になる。反映時は変更messageの音声IDを空にし、VOICE_REGEN_REQUIRED を報告する。音声が一致しないまま残さない。
8. 事実・設定・人物の目的を変える大幅な再構成は、単純な校正と分けて structure として提示する。

## 1. 対象を確定する

project.json と scene ID prefix を確認する。標準の対象は ishi_no_ura_01 から存在する最大話数までで、各プロジェクトに話数prefixが1種類だけあることを確かめる。

第1話は通常 ishi_no_ura_01 を正とし、ishi_no_ura_00 は比較対象にしない。同じ話数の候補が複数ある場合だけ、更新日時、内容hash、ユーザー指定から正本を決める。

## 2. 各話パックを抽出する

次を実行する。--episode-contexts は現行話数の題材・コンセプト・連続性を補う同梱資料である。

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs extract --project data/projects/ishi_no_ura_01 --out data/projects/ishi_no_ura_reviews/ep01 --series-context .agents/skills/review-ishi-no-ura-pce-vn-scripts/references/series-context.md --episode-contexts .agents/skills/review-ishi-no-ura-pce-vn-scripts/references/episode-contexts.json

生成物:

- review-pack.md: 設定、話数固有コンセプト、scene/分岐、使用asset、機械検査、演出付き全文台本
- review-changes.template.json: 外部AIまたは人間が返す変更票の雛形。messageとchoiceラベルの双方を扱える

パックの sourceSha256 がレビュー対象JSONと一致することを確認する。別話の設定や未来の展開を、その話の既知情報として混ぜない。

## 3. 自分で二段階レビューする

外部へ渡す前に必ず自分でレビューする。

### 構成レビュー

- scene開始の原因、人物ごとの当面の目的、発話の反応先を追う。
- 質問への答え、感情の段階、分岐差分、合流、因果応報、オチを確認する。
- 設定矛盾、知識越境、事実の断定、説明の不足を記録する。
- scene単位の問題は、個別の言い換えへ分解できなければ structure として残す。

### 台詞レビュー

- 音読し、不自然な助詞、書き言葉、主語不足、抽象語、同義反復を直す。choiceラベルも本文と同じ基準で読む。
- 直前の台詞・行動へ反応しない台詞には、接続を補うか順番の見直しを提案する。
- 話者入れ替えテストを行い、部長・チカ・レン固有の目的と口調へ戻す。
- 自然な日本語を先に決め、最後に17文字・3行または4行へ分割する。

すべての提案を review-changes.json に書く。変更しない箇所も全文を読んだことを reviewSummary.coverage に記録する。

## 4. 差分を検査・表示する

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs validate --project data/projects/ishi_no_ura_01 --changes data/projects/ishi_no_ura_reviews/ep01/review-changes.json

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs render --project data/projects/ishi_no_ura_01 --changes data/projects/ishi_no_ura_reviews/ep01/review-changes.json --out data/projects/ishi_no_ura_reviews/ep01/self-review.md

validation errorを残したまま外部へ渡さない。warningは意図を確認し、残す場合は理由を書く。

既存messageのmouthSlot不一致を本文校正と同時に強制修正しない。スチル中の口パク停止などの演出意図を確認し、不一致自体を直す場合だけspeaker-metadataの独立提案にする。

## 5. 外部レビューへ引き渡す

各話ごとに review-pack.md、review-changes.template.json、既存のself-review.mdがあればそれも渡す。外部 reviewer には次を依頼する。

- 全文を読み、既存の自己レビューへ同意するだけで終えない。
- 1件ごとに before と after を並べ、正確な locationId を使う。
- 変更不要な好みの差は追加しない。
- 設定変更やscene再構成は structure として分離する。
- decision は proposed のまま返す。

複数 reviewer の提案を統合するとき、同じ locationId の競合案を自動で一つに決めない。根拠を並べて人間へ選択を求める。

## 6. 承認後に反映する

decisionがapprovedの変更だけを新しいJSONへ出力する。正本を直接上書きしない。

    node .agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs apply --project data/projects/ishi_no_ura_01 --changes data/projects/ishi_no_ura_reviews/ep01/review-changes.json --out data/projects/ishi_no_ura_reviews/ep01/pce-vn-scenes.reviewed.json --clear-voices

出力を確認してから正本へ採用する。採用後はJSON parse、scene遷移、choice、mouthSlot、全asset ID、scene budget、対象media buildを既存ハーネスで検査する。台詞が変わった話は音声バッチを再出力する。

## 状態の報告

- PACK_READY: 各話パック抽出済み
- SELF_REVIEWED: 自己レビュー差分を検査済み
- EXTERNAL_REVIEW_PENDING: 外部AI／人間の返答待ち
- CHANGES_APPROVED: 採用変更が確定
- SCRIPT_APPLIED: 新JSONへ反映済み
- VOICE_REGEN_REQUIRED: 台詞変更により音声再生成が必要
- BUILD_VERIFIED: 対象buildと進行を確認済み

## 完了条件

- 対象全話に独立したレビュー用パックがある。
- 全message、全choiceラベル、全choice分岐、全合流経路を自己レビューしている。
- 各提案に修正前、修正後、位置、分類、理由、前後文脈がある。
- 外部レビュー用雛形が機械検査できる。
- 正本を変えた場合は音声不一致を残さず、対応テストとbuild結果を報告している。
