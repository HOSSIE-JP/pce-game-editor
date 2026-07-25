# いしのうらにいる！？ PCE VN話数制作スキル

「いしのうらにいる！？」の新話を、企画からPCE向けシナリオJSONとイベントスチルまで一貫して作るためのChatGPT／Codex Agent Skillです。

## 含まれるもの

- `SKILL.md`: 実行ワークフローと制約
- `references/`: シリーズ正本の基準スナップショット、制作チェック、事例
- `scripts/validate_pce_vn.py`: JSON、分岐、文字数、asset、到達性の検査
- `scripts/prepare_event_stills.py`: 224×136、4bit indexed、15表示色＋予約1色への変換
- `scripts/integrate_event_stills.py`: 指定scene先頭へのスチル挿入
- `scripts/package_episode.py`: スクリプトとスチルの納品ZIP作成
- `assets/templates/`: 企画入力、スチル計画、組み込み対応表のテンプレート
- `assets/character-references/`: 部長、チカ、レンの参照設定画
- `examples/episode-02/`: 第2話で実施した4スチル組み込み例

## インストール

リポジトリ専用スキルとして使う場合、フォルダごと次へ置きます。

```text
<repo-root>/.agents/skills/ishi-no-ura-pce-vn-authoring/
```

個人用として全リポジトリで使う場合は次へ置きます。

```text
~/.agents/skills/ishi-no-ura-pce-vn-authoring/
```

ZIPは単一のトップレベルフォルダを含むため、そのまま展開して利用できます。

## 呼び出し例

Codex:

```text
$ishi-no-ura-pce-vn-authoring 第3話のシナリオ設計を作って
```

```text
$ishi-no-ura-pce-vn-authoring 登録済みスチルを使ってpce-vn-scenes.jsonを更新し検査して
```

ChatGPTではスキル一覧から「いしのうら PCE VN話数制作」を選択して同様に依頼します。

## 推奨プロジェクト配置

```text
docs/
  series-bible.md
  asset-catalog.md
  chatgpt-authoring-workflow.md
assets/
  pce-assets.json
  pce-vn-scenes.json
  images/
  sprites/
```

プロジェクト内の同名正本が、スキル同梱の基準スナップショットより優先されます。

## 必要環境

- Python 3.10以降
- Pillow 10以降（イベントスチル変換に使用）

```bash
python -m pip install -r scripts/requirements.txt
```

validatorはPython標準ライブラリだけで動作します。
