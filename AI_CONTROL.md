# PCE Game Editor AI Control API

AI Control は、Codex / Claude / Copilot などの外部 AI ツールが PCE Game Editor を操作するための localhost 専用 API です。

## 起動

Editor の `AI Control` タブで `Start` を押すと、`127.0.0.1` のみで REST / MCP bridge が起動します。外部公開は行いません。

- 既定 port: `17777`
- 認証: `Authorization: Bearer <token>` または `X-MD-Editor-Token: <token>`
- token は起動ごとに生成され、`AI Control` タブに表示されます。
- `Origin` header がある場合、`localhost` / `127.0.0.1` / `[::1]` 以外は拒否します。

## REST

### `GET /v1/status`

サーバー状態、base URL、公開 tool 数、直近ログを返します。

### `GET /v1/tools`

AI が呼び出せる tool 一覧を返します。

### `GET /v1/resources`

AI が読める resource 一覧を返します。

### `GET /v1/prompts`

AI が利用できる prompt template 一覧を返します。

### `GET /v1/logs`

直近の AI Control 操作ログを返します。`POST /v1/tools/call` と HTTP MCP の `tools/call` は、protocol、tool 名、引数の要約、所要時間、結果の要約を同じ形式で記録します。`dataBase64`、`dataUrl`、`content`、`sourceCode` のような大きい payload は長さだけを残して redaction されます。

### `POST /v1/resources/read`

```json
{ "uri": "md-editor://project/config" }
```

### `POST /v1/tools/call`

```json
{
  "name": "asset_list",
  "arguments": {},
  "dryRun": false,
  "confirm": false
}
```

書き込み、削除、ビルド、エクスポートなど project state を変える tool は、`dryRun: true` または `confirm: true` が必要です。

## MCP

Editor 起動中の REST bridge に接続する stdio sidecar を用意しています。

```powershell
$env:MD_EDITOR_CONTROL_URL = "http://127.0.0.1:17777"
$env:MD_EDITOR_CONTROL_TOKEN = "<AI Control tab token>"
npm run mcp
```

MCP sidecar は stdout に JSON-RPC メッセージだけを書き、ログは stderr に出します。sidecar 経由の `tools/call` は REST bridge の `/v1/tools/call` を通るため、Editor の `AI Control` タブと `GET /v1/logs` から同じ操作ログを確認できます。

## Tools

- `editor_status`
- `project_list`
- `project_open` — `{ projectName }` または `{ projectDir }` で既存プロジェクトを開きます。`projectDir` は `project.json` を含むフォルダのみ有効です。
- `project_create` — `{ projectName, parentDir?, templateId?, config?, sourceCode? }` で新規プロジェクトを作成します。`parentDir` 未指定時は既定の `projects` フォルダ、`templateId` 指定時は `template/template_*` テンプレートからコピーします。
- `project_config_get`
- `project_config_update`
- `asset_list`
- `asset_write_file`
- `asset_add`
- `asset_update`
- `asset_delete`
- `code_tree`
- `code_read`
- `code_write`
- `plugin_list`
- `plugin_set_role`
- `plugin_run_generator`
- `build_run`
- `testplay_open`
- `export_rom`
- `export_html`

## Resources

- `md-editor://project/current`
- `md-editor://project/config`
- `md-editor://project/resources`
- `md-editor://project/source/<path>`

## Prompts

- `create_game_from_assets`
- `fix_build_error`
- `add_asset_and_rebuild`
