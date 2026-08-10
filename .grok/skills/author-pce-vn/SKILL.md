---
name: author-pce-vn
description: PC Engine / Super CD-ROM2 / HuCARD Visual Novel engine向けに、作品企画、キャラクター設定、シナリオ構成、分岐設計、アセット計画、assets/pce-vn-scenes.jsonの生成と検証を行う。新規VN作品を設計するとき、既存のpce-assets.jsonに合わせて台本を実装するとき、PCE VNのmessage・choice・sprite・audio・変数分岐などの記述規則へ適合させるとき、または生成済みシーンJSONをCD-ROM2/HuCARD両方の制約で点検するときに使う。
---

# PCE VNを設計・実装する

固定の世界観やキャラクターを持ち込まず、依頼ごとの作品設定を正本にする。物語上の判断とエンジン上の判断を分離し、企画から保存可能なJSONまで段階的に作る。

## 最初に確認する

- 対象プロジェクト、対象メディア（`cd`、`hucard`、または両方）、希望尺、ジャンル、対象年齢、分岐数、既存アセット、新規アセットの許可範囲を確認する。
- 対象プロジェクトがある場合は、先に `assets/pce-assets.json` と `assets/pce-vn-scenes.json` を読む。アセットIDやanimation IDを推測しない。
- エンジン制約を扱う前に [references/engine-contract.md](references/engine-contract.md) を読む。
- JSONを設計・生成・修正するときは [references/script-schema.md](references/script-schema.md) も全文読む。
- 企画から始めるときは [references/authoring-workflow.md](references/authoring-workflow.md) の入力票と段階別出力を使う。

## 制作フロー

1. 依頼内容から作品企画、登場人物表、物語の核、想定読了時間、分岐方針を整理する。不足は安全な仮定として明記する。
2. シーン別ビート表を作り、各シーンの目的、対立、感情変化、使用アセット、選択肢と合流点を示す。この段階では、ユーザーが一括生成を求めない限りJSONを作らない。
3. 既存アセットを優先し、不足素材を `asset plan` として別出力する。未登録IDをシーンJSONへ先行記載しない。画像生成まで依頼された場合は、利用可能な画像生成機能で作成し、登録後の確定IDを使う。画像生成機能がなければ生成プロンプトと登録案を出す。
4. 承認済み設計を、完全な `assets/pce-vn-scenes.json` に変換する。差分断片ではなく保存可能な全文を出すよう求められた場合は、`version`、`settings`、`startScene`、全`scenes`を含める。
5. `message`を表示枠に合わせて分割し、scene pack容量を考慮してシーンを早めに分ける。跨ぎ参照には`jump`、同一シーン内分岐には`label`系を使う。
6. 対象プロジェクト内で検証スクリプトを実行する。

```powershell
node .grok/skills/author-pce-vn/scripts/validate-vn-project.mjs <project-directory> --media both
```

7. エラーを修正して再検証する。`--media both`はCD-ROM2を非書き込み検査し、HuCARDを一時ディレクトリ上で生成検査する。実プロジェクトのシーンや生成物を書き換えない。
8. 最終受け入れでは対象メディアを実際にビルドする。両対応作品はCD-ROM2とHuCARDの双方を通す。静的検査だけでROM/CUEの成立を断定しない。

## 作品設計の原則

- ユーザーの企画を最優先し、特定作品の構成、口調、キャラクター、話数命名、イベントスチル枚数を既定値にしない。
- 主人公、視点、恋愛、暴力、実在名、話の型、選択肢数は作品ごとに決める。
- 選択肢は数合わせで入れず、選ぶ情報・価値観・代償が異なるようにする。短い差分で合流するかルート化するかを先に定義する。
- キャラクターごとに欲求、恐れ、誤解、会話機能、語彙、呼称を定義し、説明役だけにしない。
- 事実に依存する題材は、ユーザー提供資料または信頼できる一次情報へ紐づける。確認できない事実を台詞で断定しない。

## JSON生成の原則

- JSON内へコメント、Markdown、末尾カンマを入れない。編集メモが必要なら正式な`comment` commandを使う。
- command typeやフィールドを発明しない。高度な分岐より、短いscene、`choice`、`jump`、必要最小限の変数を優先する。
- `pce-assets.json`に存在し、型が一致するアセットIDだけを参照する。新規素材は登録後にJSONへ反映する。
- 台詞音声が未制作なら`voiceAssetId`を空文字にする。既存音声を文面の異なる台詞へ流用しない。
- `mouthSlot`は表示中の話者sprite slotだけに指定する。ナレーションは`null`または省略する。
- CD-DAは画像やspriteのCDロード後に開始する。ADPCMとCD-DAはHuCARDで無音になるため、物語進行の必須条件にしない。
- scene packの正確なbyte数は生成結果で確認する。文字数から推測して合格扱いにしない。

## 納品形式

依頼範囲に応じて、次の順で必要なものだけを出す。

1. 前提と未確定事項
2. 作品企画・キャラクター表
3. シーン別ビートと分岐表
4. 既存アセット使用表と新規`asset plan`
5. 保存可能なシーンJSON全文
6. 検証結果と、実ビルドで残る確認項目

ユーザーが「JSONのみ」と指定した場合は、検証済みJSONだけを出す。説明とJSONの同時納品では、JSONを独立したコードブロックに置く。
