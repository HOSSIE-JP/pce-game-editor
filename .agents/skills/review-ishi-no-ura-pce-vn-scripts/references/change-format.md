# レビュー変更票フォーマット

## JSON正本

レビュー結果は次の構造で保存する。locationIdは抽出パックに表示された値を完全一致で使い、command番号とchoiceNumberは1始まりである。

    {
      "schemaVersion": 1,
      "episodeId": "ep03",
      "source": {
        "project": "ishi_no_ura_03",
        "sceneFile": "assets/pce-vn-scenes.json",
        "sha256": "抽出パックと同じ64桁hash"
      },
      "reviewer": "reviewer name",
      "reviewSummary": {
        "episodeTitle": "話数の題名または題材",
        "premise": "この話で起きる具体的な出来事",
        "strengths": [],
        "structuralFindings": [],
        "continuityFindings": [],
        "coverage": {
          "messagesRead": 0,
          "messagesTotal": 0,
          "scenesRead": 0,
          "scenesTotal": 0,
          "choicesChecked": 0,
          "notes": ""
        }
      },
      "changes": [
        {
          "changeId": "EP03-R001",
          "locationId": "EP03::ep03_05_crown_choice::C014",
          "operation": "replace-choice-label",
          "choiceNumber": 2,
          "category": ["unnatural-japanese"],
          "severity": "high",
          "before": { "label": "お店で買いやすことです" },
          "after": { "label": "お店で買いやすいことです" },
          "context": "チカがゲーム機を選ぶ理由の二つ目",
          "reason": "選択肢ラベルの脱字を直す",
          "decision": "proposed"
        }
      ]
    }

## operation

| 値 | 用途 | before | after |
| --- | --- | --- | --- |
| replace | 本文、話者、mouthSlotの置換 | 対象message | 修正message |
| insert-before | 対象messageの直前へ追加 | null | 追加message |
| insert-after | 対象messageの直後へ追加 | null | 追加message |
| delete | 対象messageを削除 | 対象message | null |
| replace-choice-label | choice内のラベル置換 | 対象のlabel | 修正label |

replaceとdeleteのbeforeは、現行JSONのspeaker、text、mouthSlotと完全一致させる。replace-choice-labelはchoiceNumberで1始まりの選択肢を指定し、before.labelを現行ラベルと完全一致させる。追加messageのvoiceAssetIdは作らず、反映時に空文字となる。

既存messageにmouthSlot不一致があっても、本文だけの提案で同じmouthSlotを保つことはできる。不一致自体はreview-pack.mdの機械検査に残るため、スチル中の口パク停止など演出意図を確認してから別提案にする。

decisionはproposed、approved、rejected、needs-discussionのいずれか。外部reviewerはproposedで返し、人間が判断後に変更する。

## Markdown表示

1件につき、修正前後を同じ表の左右へ置く。

    ### EP03-R001 — unnatural-japanese

    - 場所: EP03::ep03_05_crown_choice::C014 / 選択肢 2
    - 重要度: high
    - 文脈: チカがゲーム機を選ぶ理由の二つ目

    | 修正前 | 修正後 |
    | --- | --- |
    | お店で買いやすことです | お店で買いやすいことです |

    理由: 選択肢ラベルの脱字を直す。

messageでは話者、mouthSlot、改行済み本文も左右へ表示する。改行はbr要素へ変換し、縦棒などMarkdown記号をescapeする。挿入は修正前を「なし」、削除は修正後を「削除」と表示する。

## 競合

同じlocationIdへ複数のreplaceまたはdeleteを置かない。同じchoiceの同じchoiceNumberへ複数のreplace-choice-labelを置かない。異なるreviewerの競合案は別ファイルのまま比較し、人間が一案を選んでから統合する。同じ位置への複数挿入は配列順で適用されるため、順番を理由欄に明記する。