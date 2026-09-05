# AIによるPCEゲーム制作・エンジン改善

## Codex設定

このリポジトリの `.codex/config.toml` は既定モデルを `gpt-6-astra` にします。推論量は個人設定またはタスク側の指定を継承します。権限・sandbox・MCP・認証情報はこの共有設定で変更しません。

プロジェクト設定は信頼されたプロジェクトで読み込まれます。CLIやタスク側の明示指定がある場合はそちらを確認してください。設定ファイルの追加だけでは、実行中タスクのモデル切替やアカウントの利用権限は検証できません。新しい作業をこのルートで開始し、モデル表示を確認してください。

- [OpenAI Codex設定](https://learn.chatgpt.com/docs/config-file/config-basic)
- [GPT-6 Astra移行ガイド](https://developers.openai.com/api/docs/guides/latest-model)

今回は開発エージェントの設定です。ゲームにOpenAI API呼出しを追加するものではありません。将来APIを導入する場合は、その時点の公式モデル仕様を別途確認してください。

## 作業別の入口

| 作業 | 最初に確認する資料・実装 |
|---|---|
| エディタ・プラグイン・IPC | [PLUGIN.md](../PLUGIN.md)、対象manifest、renderer/preload/mainの境界 |
| ゲーム作成・操作 | [user-guide.md](user-guide.md)、対象プロジェクトの設定・assets・制作資料 |
| VNシナリオ・JSON | [pce-vn-chatgpt-authoring-guide.md](pce-vn-chatgpt-authoring-guide.md)、現行compilerとテンプレート |
| CD VN runtime・メモリ | [pce-memory-bank-strategy.md](pce-memory-bank-strategy.md)、[pce-vn-overlay-pathb.md](pce-vn-overlay-pathb.md)、`template/template_pce_vn_cd/src/` |
| バンク不足 | [pce-vn-code-bank-optimization.md](pce-vn-code-bank-optimization.md)、変更前後のELF/map |
| HuCARD VN | [pce-vn-hucard-bank-layout.md](pce-vn-hucard-bank-layout.md)、対象HuCARDテンプレート |
| 大規模作品・CD metadata | [pce-vn-large-project-limits.md](pce-vn-large-project-limits.md)、[pce-asset-meta-cd-ondemand.md](pce-asset-meta-cd-ondemand.md) |
| 表示・入力・音声・Test Play | [pce-testplay-debugging.md](pce-testplay-debugging.md)、対象ROM/CUEと実際に使用するcore |

ルートの [AGENTS.md](../AGENTS.md) と対象ディレクトリの追加指示に従います。スキルは現在利用できるものから作業に合うものを選び、特定PCの絶対パスを共有手順に固定しません。

## ゲーム制作の完了条件

1. 実在する作品ディレクトリ、HuCARD/CDの別、納品範囲を確認します。制作packがある作品はその正本を修正し、生成JSONだけの手修正が次回生成で失われないようにします。scene ID・asset IDを安定させ、現行形式をcompilerで検証します。
2. 画像指示・構図・時代・人物設定を守り、承認済みの最初のアンカーを保存して使い続けます。生成画像のプレビューだけで完了にせず、masterと対象の解像度に合わせた派生画像を保存します。224×136などの作品固有寸法を全ゲーム共通の制約にしないでください。
3. 作品のimport scriptまたは現行import APIから登録し、sourceとgeneratedの対応、asset ID、寸法、palette、欠落参照を確認します。画像・音声の原本を無断で上書きせず、古いgenerated metadataは現在のconverterで再生成します。
4. JSON構文、文字表示量、分岐・到達性、終端、未定義asset、音声容量を検査します。未使用assetは意図を確認し、自動削除しません。作品専用validatorの引数は実装またはhelpで確認します。
5. 対象作品を実ビルドし、生成されたROMまたはCUEと参照track一式を確認します。素材差替え前の成功結果を再利用しません。HuCARD/CD両対応の依頼では各ターゲットを個別にビルドします。
6. 要求範囲のタイトル・入力・分岐・画像切替・BGM/SE/音声後の復帰を実行確認します。ダミー音声や仮素材が残る場合は配布完成としません。ビルド成功、画面観察、音声収録、人の聴取、実機確認を区別して報告します。

## エンジン改善の検証

UI → 保存データ → compiler/generated asset → builder → runtimeのうち、症状が発生する境界を追跡します。共通処理では別ターゲットへの影響も確認します。メモリ不足は容量とcall graphを測り、gateを弱めて回避しません。

対象テストは `tests/run-tests.js` から選びます。例えばバンク契約の確認は次です。

```powershell
node --test tests/pce-build-memory-gate.test.js
```

共通コード・ビルド仕様変更の基本回帰は `npm test`。実VNビルドの入口は `tools/dev/vn-cli-build.js` です。リポジトリルートで、実在を確認した作品の絶対パスを指定します。

```powershell
$env:PCE_VN_PROJECT = '<対象プロジェクトの絶対パス>'
node tools/dev/vn-cli-build.js
Remove-Item Env:PCE_VN_PROJECT
```

既存の `PCE_VN_PROJECT` がある作業環境では元の値を保存し、終了後に復元します。上の削除は今回初めて設定した場合だけです。

エミュレーター調査は既存の `tools/dev/geargrafx-system-card-smoke.js` とデバッグ資料を先に確認します。MCP schemaは実行中ツールを正とし、CD起動には実時間を使います。WASMだけで起きる問題に対し、Geargrafxで正常なruntimeの契約を壊して合わせないでください。

文書・設定だけの変更は構文と参照先・差分を確認します。機能変更には失敗を再現する最小回帰と実ビルドを選び、GUIや実機が使えない場合は残る確認項目を明示します。
