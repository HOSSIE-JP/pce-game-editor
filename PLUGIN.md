# PCE Game Editor — プラグイン開発ガイド

このドキュメントは、**PCE Game Editor** 向けのカスタムプラグインを開発する方を対象としています。  
プラグインシステム (Plugin Runtime v2.5) の仕様、マニフェスト定義、コア選択、フック API、レンダラーモジュール、およびレンダラーからの呼び出し方を解説します。

---

## 目次

1. [プラグインの配置場所](#1-プラグインの配置場所)
2. [ディレクトリ構成](#2-ディレクトリ構成)
3. [manifest.json 仕様](#3-manifestjson-仕様)
4. [プラグインタイプ一覧](#4-プラグインタイプ一覧)
5. [フック一覧](#5-フック一覧)
6. [index.js の書き方](#6-indexjs-の書き方)
7. [コンテキストオブジェクト](#7-コンテキストオブジェクト)
8. [依存関係の宣言](#8-依存関係の宣言)
9. [タブ UI の追加 (tab オブジェクト)](#9-タブ-ui-の追加-tab-オブジェクト)
10. [Renderer Module](#10-renderer-module)
11. [有効 / 無効の管理](#11-有効--無効の管理)
12. [レンダラーから呼び出せる IPC API](#12-レンダラーから呼び出せる-ipc-api)
13. [既存プラグイン一覧](#13-既存プラグイン一覧)
14. [開発の流れ (チュートリアル)](#14-開発の流れ-チュートリアル)
15. [よくある間違い](#15-よくある間違い)
16. [実装ノウハウ](#16-実装ノウハウ)
17. [AI Control API](#17-ai-control-api)

---

## 1. プラグインの配置場所

### 開発時（非パッケージ）

```
pce-game-editor/plugins/<plugin-id>/
```

### パッケージ済みアプリ

```
<app resources>/plugins/<plugin-id>/
```

アプリ内の **Settings > Plugins** パネルの「📂 フォルダを開く」ボタンで、実際の配置先を Explorer で開けます。

---

## 2. ディレクトリ構成

プラグインは `manifest.json` を必須とし、必要に応じて main process 用の `index.js` と renderer process 用の `renderer.js` を追加します。

```
pce-game-editor/plugins/
└── my-plugin/
    ├── manifest.json   ← 必須: メタデータ・タイプ・フック宣言
    ├── index.js        ← 任意: main process のフック/ジェネレータ実装
    ├── renderer.js     ← 任意: renderer process の UI/capability 実装
    └── style.css       ← 任意: renderer module 用スタイル
```

その他のファイル（ライブラリ・アセットなど）を追加することも可能です。  
`index.js` から `require('./lib/util.js')` のように相対パスで参照できます。`renderer.js` は ES module として読み込まれます。

---

## 3. manifest.json 仕様

```jsonc
{
  "id": "my-plugin",           // 必須: 一意な ID (英小文字・ハイフンのみ推奨)
  "name": "My Plugin",         // 必須: 表示名
  "description": "...",        // 任意: 説明文
  "version": "1.0.0",          // 必須: semver 形式
  "hidden": false,             // 任意: true の場合は内部モジュールとして一覧から除外
  "icon": "puzzle",            // 任意: サイドバーなどで使う組み込みアイコン名
  "types": ["build"],          // 必須: プラグインタイプ (配列)
  "generator": true,           // 任意: generateSource/generateSourceAsync を明示する場合
  "supportedCores": ["mega-drive"], // 任意: 対応 core。未指定は legacy 互換で mega-drive 扱い
  "core": {                     // types: ["core"] の場合のみ使用
    "id": "mega-drive",
    "label": "PC Engine",
    "platform": "md"
  },
  "hooks": ["onBuildStart"],   // 任意: 実装するフック名の一覧
  "permissions": [              // 任意: 使用する host 権限の宣言 (v2.5)
    "project.read",
    "project.write",
    "dialog.openFile",
    "res.read",
    "res.write",
    "main.invokeHook",
    "build.configure"
  ],
  "roles": [                    // 任意: 単一選択 role の宣言 (v2.5)
    { "id": "builder", "label": "Build", "exclusive": true, "order": 10 }
  ],
  "mainApi": {                  // 任意: renderer から呼び出せる main hook/capability
    "hooks": ["convertAudio"],
    "capabilities": ["audio-convert"]
  },
  "tab": { ... },              // 任意: タブ UI を追加する場合
  "renderer": {                 // 任意: renderer module を提供する場合
    "entry": "renderer.js",
    "styles": ["style.css"],
    "page": "my-page",
    "capabilities": ["page"]
  },
  "dependencies": ["other-id"] // 任意: 依存プラグイン ID の一覧
}
```

### フィールド詳細

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `string` | ✅ | プラグインを一意に識別する ID。フォルダ名と一致させること |
| `name` | `string` | ✅ | UI に表示される名前 |
| `description` | `string` | — | 設定画面に表示される説明文 |
| `version` | `string` | ✅ | semver 形式 (例: `"1.0.0"`) |
| `hidden` | `boolean` | — | `true` の場合、互換用・統合 UI 用の内部モジュールとして扱い、Plugins 画面や sidebar の通常一覧から除外する |
| `icon` | `string` | — | サイドバーなどで使う組み込みアイコン名。`assets` / `code` / `grid` / `sprite` / `music` / `play` / `bug` / `build` / `puzzle` など |
| `types` | `string[]` | ✅ | タイプ名の配列。複数タイプを持てる |
| `generator` | `boolean` | — | `generateSource` / `generateSourceAsync` を持つ plugin かを明示する。hook 専用 build plugin は `false` を推奨 |
| `supportedCores` | `string[]` | — | 対応する project core。`"mega-drive"` / `"pc-engine"` / `"*"`。未指定の既存 plugin は `"mega-drive"` として扱う |
| `core` | `object` | — | `types` に `"core"` を含む core plugin の metadata。`id` / `label` / `platform` を持つ |
| `hooks` | `string[]` | — | 実装するフック名を列挙する（宣言のみ。実装は `index.js`） |
| `permissions` | `string[]` | — | 使用する host 権限の宣言。v2.5 では表示・レビュー用途で、sandbox 強制はしない |
| `roles` | `Array<object|string>` | — | builder/testplay など、設定画面で単一選択する plugin role |
| `mainApi` | `object` | — | renderer plugin から呼び出し可能な main process hook / capability の許可リスト |
| `tab` | `object` | — | エディタにタブを追加する場合。[§9 参照](#9-タブ-ui-の追加-tab-オブジェクト) |
| `renderer` | `object` | — | renderer process 側の UI/capability を提供する場合。[§10 参照](#10-renderer-module) |
| `dependencies` | `string[]` | — | 依存プラグイン ID。[§8 参照](#8-依存関係の宣言) |

> **注意**: `types` は必ず **配列**で記述してください。文字列単体の `"type"` フィールドは Runtime v2.5 では使用しません。

---

## 4. プラグインタイプ一覧

`types` に指定できる値の一覧です。一つのプラグインが複数のタイプを持てます。

| タイプ名 | 説明 | 主なフック |
|---|---|---|
| `build` | ビルドパイプラインに参加するプラグイン | `onBuildStart` / `onBuildLog` / `onBuildEnd` / `onBuildError` |
| `editor` | エディタ UI にタブを提供するプラグイン | `getTab` / `onActivate` / `onDeactivate` |
| `asset` | アセット管理機能を提供するプラグイン | （`editor` との組み合わせが一般的） |
| `emulator` | Test Play 実行を担当するプラグイン | `onTestPlay` |
| `converter` | 画像などの変換処理を提供するプラグイン | （主にレンダラー側から直接利用） |
| `core` | project core の setup / project / build / asset schema / template provider | main process 側 provider として扱う |

### Project core と `supportedCores`

Runtime v2.5 では、PC Engine と PC Engine の違いをプロジェクト単位の core として扱います。`project.json.coreId` が実効 core で、未指定の既存 MD project は `"mega-drive"`、`platform: "pce"` を持つ既存 PCE project は `"pc-engine"` として推定されます。

通常 plugin は `supportedCores` を宣言してください。MD 専用なら `["mega-drive"]`、PCE 専用なら `["pc-engine"]`、project FS API だけを使う共有 plugin は `["*"]` を指定します。未宣言 plugin は後方互換のため `["mega-drive"]` として扱われます。現在の core に非対応の plugin は Plugins 画面で既定非表示になり、有効化、role 選択、hook/generator 呼び出しの対象からも除外されます。

core plugin は `types: ["core"]` と `core` metadata を持つ manifest で宣言します。組み込み core plugin ID は `mega-drive-core` / `pc-engine-core`、core ID は `mega-drive` / `pc-engine` です。core plugin は UI を直接持たず、main process 側の provider として setup / project template / build / asset schema / default roles を提供します。

---

## 5. フック一覧

### `onBuildStart`

ビルド開始直前に呼び出されます。

```ts
// payload
{ projectDir: string }

// context
{ logger: Logger }

// 戻り値
{ ok: boolean, error?: string }
```

### `onBuildLog`

ビルドプロセスからのログ行が届くたびに呼び出されます。

```ts
// payload
{ text: string, level: 'info' | 'warn' | 'error' | 'debug' }

// 戻り値
{ ok: boolean }
```

### `onBuildEnd`

ビルド完了（成功）後に呼び出されます。

```ts
// payload
{ projectDir: string, romPath: string, elapsed: number }

// 戻り値
{ ok: boolean, error?: string }
```

### `onBuildError`

ビルド失敗時に呼び出されます。

```ts
// payload
{ projectDir: string, error: string }

// 戻り値
{ ok: boolean }
```

### `getTab`

エディタのタブ情報を返します。`editor` タイプのプラグインが実装します。

```ts
// payload: なし

// 戻り値
{
  id: string,
  label: string,
  icon?: string,
  mountType: 'builtin-code-editor' | string
}
```

### `onActivate`

タブがアクティブになったときに呼び出されます。

```ts
// payload: {}
// context: { logger: Logger }
// 戻り値: { ok: boolean }
```

### `onDeactivate`

タブが非アクティブになったときに呼び出されます。

```ts
// payload: {}
// context: { logger: Logger }
// 戻り値: { ok: boolean }
```

### `onTestPlay`

Test Play ボタンが押されたときに呼び出されます。`emulator` タイプのプラグインが実装します。

```ts
// payload
{ romPath: string }

// 戻り値
{
  ok: boolean,
  handled: boolean  // true を返すとプラグイン側で Test Play 起動済みとして扱う
}
```

`context.testPlay` には、組み込みエミュレータープラグイン向けのホスト API が渡されます。

```ts
context.testPlay.openWasmWindow({ romPath, pluginId })
context.testPlay.openApiWindow({ romPath, pluginId, port? })
context.testPlay.startApiServer({ port? })
context.testPlay.stopApiServer()
context.testPlay.isApiServerRunning()
context.testPlay.getProjectConfig()
context.testPlay.launchExternalEmulator({ executablePath, args, romPath })
```

Test Play の表示崩れ、VDC / VRAM / SATB / palette の調査では、EmulatorJS の画面確認だけで判断せず、利用可能なら Geargrafx MCP を優先して使ってください。詳しい手順は `docs/pce-testplay-debugging.md` にまとめています。

### `generateSource` / `generateSourceAsync`

`build` タイプのプラグインがソースコードを生成するために実装します。  
フックではなく **ジェネレータ関数** として扱われ、`plugins:runGenerator` IPC から呼び出されます。

```ts
// 引数
assets: Array<{
  type: string,       // 'IMAGE' | 'SPRITE' | 'XGM2' | 'WAV' など
  name: string,       // リソース名 (例: 'image001')
  sourcePath: string, // プロジェクト相対パス
  sourceAbsolutePath: string // 絶対パス
}>

context: {
  projectDir: string,
  logger: Logger
}

// 戻り値
{ ok: boolean, sourceCode?: string, error?: string }
```

---

## 6. index.js の書き方

### 最小構成

```js
'use strict';

module.exports = {
  // hooks ここに実装
};
```

### build プラグイン例

```js
'use strict';

const manifest = require('./manifest.json');

/**
 * ソースコード生成関数
 * @param {Array<{type:string, name:string, sourcePath:string}>} assets
 * @param {{ projectDir:string, logger:object }} context
 */
async function generateSourceAsync(assets, context) {
  context.logger.info('generateSource 開始');

  const images = assets.filter((a) => a.type === 'IMAGE');
  if (images.length === 0) {
    return { ok: false, error: 'IMAGE アセットが見つかりません' };
  }

  const sourceCode = `#include <genesis.h>\n/* generated by ${manifest.id} */\n`;
  return { ok: true, sourceCode };
}

async function onBuildStart(payload, context) {
  context.logger.info(`ビルド開始: ${payload.projectDir}`);
  return { ok: true };
}

async function onBuildEnd(payload, context) {
  context.logger.info(`ビルド完了: ${payload.romPath}`);
  return { ok: true };
}

module.exports = {
  generateSourceAsync,
  onBuildStart,
  onBuildEnd,
};
```

### editor タブ プラグイン例

```js
'use strict';

const manifest = require('./manifest.json');

function getTab() {
  return {
    id: manifest.id,
    label: manifest.tab?.label || manifest.name,
    icon: manifest.tab?.icon || 'default',
    mountType: 'builtin-code-editor', // または独自のマウントタイプ
  };
}

function onActivate(_payload, context) {
  context?.logger?.info(`${manifest.id} activated`);
  return { ok: true };
}

function onDeactivate(_payload, context) {
  context?.logger?.info(`${manifest.id} deactivated`);
  return { ok: true };
}

module.exports = { manifest, getTab, onActivate, onDeactivate };
```

---

## 7. コンテキストオブジェクト

フック関数の第 2 引数 `context` には、以下のプロパティが含まれます。

```ts
interface PluginContext {
  projectDir: string;    // 現在のプロジェクトディレクトリの絶対パス
  logger: Logger;        // ログ出力オブジェクト
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  log(message: string): void;  // info の別名
}
```

`logger` で出力したメッセージは、エディタの **Build Log** パネルと **Plugin Log** パネルの両方に表示されます。

---

## 8. 依存関係の宣言

プラグイン A がプラグイン B の機能を必要とする場合、`dependencies` に宣言します。

```jsonc
{
  "id": "my-editor",
  "dependencies": ["image-resize-converter", "image-quantize-converter"]
}
```

**動作ルール**:

- プラグイン A を **有効化** すると、依存している B も自動的に有効化されます
- プラグイン B を **無効化** しようとすると、B に依存している A も自動的に無効化されます
- 単一選択 role で別のプラグインが選ばれて B が無効化される場合も、B に依存している A は同時に無効化されます
- 依存するプラグインが存在しない場合、`setEnabled` の戻り値 `missingDependencies` に ID が含まれます

---

## 9. タブ UI の追加 (tab オブジェクト)

`editor` タイプのプラグインは `manifest.json` に `tab` オブジェクトを追加することで、エディタ上部のタブバーに項目を追加できます。

```jsonc
"tab": {
  "label": "My Tab",   // 必須: タブに表示されるラベル
  "icon": "code",      // 任意: アイコン識別子
  "page": "my-page",   // 任意: ページ識別子
  "order": 20          // 任意: タブの表示順 (小さい値が左)
}
```

サイドバーの初期表示順も `tab.order` の昇順です。ユーザーがドラッグで並び替えた後は、プロジェクトごとの保存済み順序が優先されます。
組み込み plugin の基本 order は、ゲーム特化エディタを最優先にし、その後に Assets / BGM / Code / Plugins / Settings が並ぶようにしています。

| order | 目安 |
|---:|---|
| 1-9 | ゲーム特化エディタ（例: ブロック崩しステージエディタ） |
| 10 | Assets |
| 20 | BGM |
| 30 | Code |
| 40 以降 | 追加エディタ / 補助ツール |

`getTab` フックで返すオブジェクトの `mountType` により、タブコンテンツのマウント方式が決まります。

| `mountType` | 説明 |
|---|---|
| `"builtin-code-editor"` | 組み込みのコードエディタを使用 |
| その他の文字列 | カスタムマウントタイプ（将来の拡張用） |

---

## 10. Renderer Module

Plugin Runtime v2.5 では、main process の `index.js` とは別に renderer process 用 ES module を提供できます。
本体 renderer はアプリシェル、ページ切替、IPC host API、プラグイン読込を担当し、Assets / Code / Converter などの機能固有 UI は renderer module が capability として登録します。

```jsonc
"renderer": {
  "entry": "renderer.js",          // 必須: plugin ディレクトリ内の ES module
  "styles": ["style.css"],         // 任意: plugin ディレクトリ内 CSS
  "page": "assets",                // 任意: タブ/ページを持つ場合のマウント先
  "capabilities": ["page"]         // 任意: 提供する機能名
}
```

`entry` と `styles` は plugin ディレクトリ内の相対パスだけが有効です。絶対パスや `../` で plugin 外へ出る指定は拒否され、`PluginInfo.hasRenderer` は `false` になります。

renderer module は次の関数を export します。

```js
export function activatePlugin({ plugin, root, api, logger, registerCapability }) {
  registerCapability('my-capability', { /* plugin-owned UI helpers */ });
  return {
    deactivate() {
      // 任意: イベント購読や DOM 状態の片付け
    },
  };
}
```

| 引数 | 説明 |
|---|---|
| `plugin` | `PluginInfo` |
| `root` | pageRoot があれば pageRoot、なければ hostRoot。既定 mount 先 |
| `pageRoot` | ページを持つプラグインの `<section>`。ページを持たない場合は `null` |
| `hostRoot` | すべての renderer plugin に割り当てられる plugin 専用 root。converter や modal UI はここへ mount する |
| `api` | 本体が公開する安全な host API と `window.electronAPI` |
| `logger` | Plugin Log / Build Log に出力する logger |
| `registerCapability` | `capabilities` の実装を登録する関数 |

> v2.5 以降、新規プラグインは `pce-game-editor/renderer/renderer.js` や `pce-game-editor/renderer/index.html` へ追記せず、`renderer.js` の `activatePlugin()` 内で `root` / `pageRoot` / `hostRoot` に DOM を構築してください。converter のようにページを持たないプラグインにも `hostRoot` が渡されるため、独自モーダルや非表示 UI を本体 HTML に事前定義する必要はありません。

### Renderer Host API

`activatePlugin()` に渡される `api` は、既存 IPC の薄いラッパーに加えて、プラグイン間連携と plugin-owned UI 用の helper を提供します。

```js
export function activatePlugin({ plugin, hostRoot, api, registerCapability }) {
  const modal = api.createModal({
    id: `${plugin.id}-modal`,
    html: '<div class="settings-form compact-form"><p>Plugin UI</p></div>',
  });

  registerCapability('my-tool', {
    open() {
      modal.open();
    },
  });

  const off = api.events.on('my-tool:refresh', (payload) => {
    console.log(payload?.reason);
  });

  return {
    deactivate() {
      off();
      modal.destroy();
    },
  };
}
```

| API | 説明 |
|---|---|
| `api.mountElement(element, target?)` | plugin 専用 root へ DOM を mount する。`target: "page"` で pageRoot 優先 |
| `api.unmountElement(element)` | mount 済み DOM を削除する |
| `api.createModal(options)` | plugin 専用 root 配下に標準 modal を作成し、`open()` / `close()` / `destroy()` を返す |
| `api.capabilities.get(name)` | 有効な provider の capability 実装を取得する |
| `api.capabilities.require(name, timeoutMs?)` | capability 登録を待つ。見つからない場合は `null` |
| `api.capabilities.list()` | 現在有効な capability と provider plugin ID を列挙する |
| `api.plugins.invokeHook(id, hook, payload)` | `mainApi.hooks` で許可された main process hook を呼び出す |
| `api.assets.listPceAssets({ force? })` | PCE asset 共有ストアから `assets/pce-assets.json` を取得する。`force: true` で IPC から再読込する |
| `api.assets.upsertPceAsset(asset)` | PCE asset を保存し、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
| `api.assets.deletePceAsset(id)` | PCE asset を削除し、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
| `api.assets.importPceImage(payload)` | 画像 asset を取り込み、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
| `api.assets.importPceAudio(payload)` | 音声 asset を取り込み、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
| `api.assets.reorderPceAssets(ids)` | PCE asset の順序を保存し、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
| `api.assets.previewPceAssetSource(relativePath)` | project root 内の PCE asset source を Data URL として取得する |
| `api.events.emit(name, detail)` | renderer plugin 間の軽量イベントを発行する |
| `api.events.on(name, handler)` | renderer plugin 間イベントを購読し、解除関数を返す |

Host は sidebar/page 切替後に `page:activated` (`{ pageId, pluginId }`) を発行します。アセット参照を持つ editor plugin は、このイベントと `assets:pce:changed` を購読し、表示中に必要な一覧・select・preview を再読込してください。PCE asset を変更する renderer plugin は、直接 `window.electronAPI.*Asset*` を呼ぶのではなく `api.assets.*` を優先し、他 plugin と同じ共有ストアを更新してください。

本体側に残すべきものは、プロジェクト内ファイル操作 IPC、ビルド/Test Play orchestration、plugin 読込、共通 shell UI です。新しいページ、ツール、converter、モーダル、プレビュー、plugin 間連携は plugin 側 renderer module と capability/event で実装してください。

### Renderer ページ CSS の注意

`pageRoot` / `root` が `<section class="editor-page">` 自体になる editor plugin では、その root 要素へ `display` を指定しないでください。ページの表示・非表示はホスト側の `.editor-page.active` が管理します。plugin CSS で次のような指定をすると、非アクティブな plugin ページが隠れず、別のサイドバータブを選択しても前の editor plugin が表示され続けます。

```css
/* NG: page root が .editor-page の場合、ホストの display:none を上書きする */
.my-plugin-root {
  display: flex;
}
```

ページ全体のレイアウトは、root 直下に wrapper を作ってそこへ `display: flex` / `grid` を指定してください。

```js
export function activatePlugin({ root }) {
  root.classList.add('my-plugin-page');
  root.innerHTML = '<div class="my-plugin-layout"></div>';
}
```

```css
.my-plugin-layout {
  display: grid;
  height: 100%;
}
```

renderer から main process hook を呼ぶ場合は、`hooks` と `mainApi.hooks` の両方に hook 名を宣言してください。新規 plugin で本体 `main.js` / `preload.js` / `pce-build-system.js` の個別追記が必要に見える場合は、まず Runtime v2.5 の汎用 API 不足として扱い、個別 plugin ID の分岐を本体へ追加しないでください。

### Plugin Runtime v2.5 の追加 capability

Asset 登録や converter 連携は本体 renderer へ追記せず、renderer capability として登録します。

| capability | 用途 |
|---|---|
| `asset-type-provider` | 拡張子から候補 type、既定 subdir、既定 symbol、追加 UI 情報を返す |
| `asset-import-handler` | import の優先度・処理可否・copy/変換/登録方針を提供する。`handleImport(payload)` を実装すると標準コピー前に plugin-owned wizard を開ける |
| `image-import-pipeline` | 画像 import 時の resize / quantize / Indexed PNG 化を提供する |

新規 asset type や converter を追加するときは、`asset-manager` や converter plugin がこれらを登録します。本体 `renderer.js` に type 分岐を追加しないでください。

### Plugin roles

Build / Test Play のように「有効 plugin のうち 1 つだけを選ぶ」機能は `roles` で宣言します。

```jsonc
"roles": [
  { "id": "builder", "label": "Build", "exclusive": true, "order": 10 },
  { "id": "testplay", "label": "Test Play", "exclusive": true, "order": 20 }
]
```

Build ボタンに使う plugin は `builder` role、Test Play ボタンに使う plugin は `testplay` role を manifest に必ず宣言します。プロジェクト設定では `pluginRoles` だけを使用します。

### Audio converter の実装

音声変換 plugin は `hooks` と `mainApi.hooks` に `convertAudio` を宣言し、renderer からは `api.plugins.invokeHook(plugin.id, "convertAudio", payload)` を使います。preview は `readTempFileAsDataUrl(tempPath, { deleteAfter: true })`、登録は `writeAssetFile()` を使います。

---

## 11. 有効 / 無効の管理

プラグインの有効・無効状態は `<userData>/plugins-state.json` に保存されます。  
デフォルトはすべて **有効** です。

### `plugins-state.json` の形式

```json
{
  "my-plugin": { "enabled": false },
  "other-plugin": { "enabled": true }
}
```

ユーザーは Settings 画面の Plugins タブからトグルで切り替えられます。  
プラグイン自身がこのファイルを直接編集する必要はありません。

---

## 12. レンダラーから呼び出せる IPC API

レンダラープロセス（`renderer.js` など）は `window.electronAPI` 経由でプラグイン関連の IPC を呼び出せます。

### プラグイン管理

```js
// 全プラグイン一覧を取得。現在 core 非対応 plugin も含める場合は includeIncompatible を使う
const plugins = await window.electronAPI.listPlugins({ includeIncompatible: false });
// => Array<PluginInfo>

// core 一覧と現在の active core
const cores = await window.electronAPI.listCores();
const activeCore = await window.electronAPI.getActiveCore();

// 特定プラグインの renderer asset を取得
const assets = await window.electronAPI.getPluginRendererAssets('my-plugin');
// => { ok: boolean, renderer?: object, rendererAssets?: object, error?: string }

// 単一選択 role の現在値を取得/保存 (v2.5)
const roles = await window.electronAPI.getPluginRoles();
await window.electronAPI.setPluginRole('builder', 'my-build-plugin');

// プラグインを有効/無効化
const result = await window.electronAPI.setPluginEnabled('my-plugin', true);
// => { ok: boolean, changed: Array<{id,enabled,reason}>, changedIds: string[], missingDependencies: string[] }

// ジェネレータ実行 (src/main.c が生成される)
const result = await window.electronAPI.runPluginGenerator('my-plugin');
// => { ok: boolean, srcPath?: string, error?: string }

// plugins フォルダを Explorer で開く
await window.electronAPI.openPluginsFolder();

// converter preview 用の一時ファイルを Data URL 化
const preview = await window.electronAPI.readTempFileAsDataUrl(tempWavPath, { deleteAfter: true });
```

### PCE asset API

PC Engine core のプロジェクトでは、PCE asset manager 用の安全な project-local IPC を利用できます。

画像表示、スプライト表示、ADPCM 再生、CD-DA 再生を実装する場合は、より実装寄りの流れを `docs/pce-media-programming-guide.md` にまとめています。ここでは IPC の入口だけを示します。
renderer plugin から asset を読む・変更する場合は、共有ストアと変更通知を扱う `api.assets.*` を優先してください。`window.electronAPI.*Asset*` は低レベル IPC として残しています。
Image プラグインの BG 追加 UI では `paletteBank` / `transparentIndex` を表示せず、互換用 metadata として `0` 固定で渡します。Sprites 追加 UI でも `paletteBank` / `tileBase` / `x` / `y` / `transparentIndex` と初期 animation 詳細は通常表示せず、既定値で登録します。変換時だけ有効な `Cell size` は追加 modal の `アドバンス` に隠し、既存 asset では生成済み pattern と metadata がずれないよう通常の Properties からは編集しません。`tileBase` / `x` / `y` は有効な低レベル既定値として Sprites タブの `アドバンス` に隠します。

```js
// assets/pce-assets.json を取得
const assets = await window.electronAPI.listAssets();

// PNG/BMP/WebP を project 配下へコピーし、内蔵 PCE 変換で BG tile / map を生成する
const importedBg = await window.electronAPI.importAssetImage({
  sourcePath: '/absolute/path/source.png', // dialog で選ばれた読み取り元
  kind: 'background',
  id: 'title_bg',
  width: 224,
  height: 136,
});

// sprite pattern を生成する。paletteBank / tileBase / x / y / transparentIndex は省略時に既定値が入る
const importedSprite = await window.electronAPI.importAssetImage({
  sourcePath: '/absolute/path/hero.png',
  kind: 'sprite',
  id: 'hero_sprite',
  cellWidth: 16,
  cellHeight: 16,
});

// WAV を ADPCM / CD-DA 用に project 配下へコピー・変換する
const audio = await window.electronAPI.importAssetAudio({
  sourcePath: '/absolute/path/source.wav',
  kind: 'adpcm', // "adpcm" | "cdda-track"
  id: 'voice_01',
  sampleRate: 16000,
  track: 2,
  loop: false,
});

// WAV / MP3 を renderer の共通音声コンバーターで加工してから登録する場合
const processedVoice = await audioConvertUi.openAudioConvertModal({
  mode: 'pce-asset',
  returnResult: true,
  kind: 'adpcm',
  picked: { sourcePath: '/absolute/path/source.mp3', fileName: 'source.mp3', ext: '.mp3' },
  targetFileName: 'voice_01.wav',
  defaults: { sampleRate: 16000, mono: true },
});
const importedVoice = await window.electronAPI.importAssetAudio({
  dataUrl: processedVoice.dataUrl,
  sourceFileName: 'voice_01.wav',
  originalFileName: processedVoice.originalFileName,
  processing: processedVoice.processing,
  splitPolicy: 'auto',
  kind: 'adpcm',
  id: 'voice_01',
  sampleRate: processedVoice.processing.sampleRate,
});

// project root 内の asset source だけを Data URL 化する
const preview = await window.electronAPI.previewAssetSource('assets/images/title_bg.png');

// pce-assets.json の順序を保存する
await window.electronAPI.reorderAssets(['title_bg', 'hero_sprite']);
```

`previewAssetSource` と `reorderAssets` は絶対パス、`..`、symlink escape を拒否します。`importAssetImage` / `importAssetAudio` の `sourcePath` は読み取り元として dialog 由来の絶対パスを許可しますが、保存される `source` / generated file path は必ず project 相対です。BMP / WebP は renderer 側で PNG Data URL (`convertedDataUrl`) に変換してから import します。MP3 入力は renderer の `audio-convert-ui` で WAV Data URL へ加工してから `importAssetAudio({ dataUrl, sourceFileName, originalFileName, processing })` に渡します。

ADPCM で `splitPolicy: "auto"` を指定すると、変換後の ADPCM が runtime 側の 16-bit size/address 制約を超える場合に `<id>_part01`, `<id>_part02`, ... の独立 asset として分割登録します。上限は `min(65535, 65536 - adpcmAddress)` bytes です。分割 asset は自動連続再生されないため、scene/message から必要な part を個別に参照してください。

ADPCM の `divider` は再生速度の rate code です。取り込み時は `32000 / (16 - code)` が `sampleRate` に最も近い `0..15` の code を自動計算し、代表値は `32000Hz -> 15`, `16000Hz -> 14`, `8000Hz -> 12`, `4000Hz -> 8` です。旧実装で保存された `round(32000 / sampleRate - 1)` や `round(16000 / sampleRate - 1)` の値は読み込み時と runtime で補正します。1 asset の長さは `min(65535, 65536 - adpcmAddress)` bytes、つまり `bytes * 2 / sampleRate` 秒が目安です。`adpcmAddress: 0` なら 16000Hz で約 8.19 秒、8000Hz で約 16.38 秒です。`assets/generated/<id>/adpcm.bin` は OKI/MSM5205 互換 4-bit adaptive data を高位 nibble 先 (`msn-first`) で保存します。旧 `pce-cd-adpcm-experimental`、古い `lsn-first`、nibble order 未記録、または `encoderVersion` が古い generated file は、source WAV が残っていれば build/source 生成時に自動再生成されます。
`options.stream: true` の ADPCM import では ADPCM RAM の 16-bit size/address 制約で分割せず、1つの CD data file として保持します。

`assets/pce-assets.json` の v2 画像/音声タイプは `image` (BG), `sprite`, `palette`, `psg-song`, `psg-sfx`, `adpcm`, `cdda-track` です。旧 `psg-sequence` は読み込み時に `psg-sfx` として正規化されます。PCE/CD-ROM2 は `llvm-mos-sdk` 固定で扱い、IPL / System Card は Setup でユーザー所有ファイルを指定します。

BG の `tileBase` / `mapBase` は PCE asset manager 側で自動管理されます。CD-ROM2 VN runtime の 32x32 BAT を `mapBase: 0` に置き、BG tile は BAT の後ろ (`tileBase: 128`) に配置するため、UI ではこれらをユーザー選択させません。古い asset に値が残っていても読み込み・生成時に BG は自動値へ正規化されます。

`targetMedia: "cd"` の PCE VN build では、generated image の tile data、VRAM 幅へ展開した BG map、sprite pattern、ADPCM 本体を RAM bank へ詰め込まず、project 相対パスのまま `cd.dataFiles` へ登録します。VN script 本体も `assets/generated/vn/scenes/NNN_<sceneId>.bin` の scene pack として `cd.dataFiles` に並べ、bank132 には sprite animation、variable 初期値、`pce_vn_scene_packs[]` の sector directory、font tiles の CD data ref (`pce_vn_font_data`)、asset の CD data ref (`pce_editor_cd_data_ref_t`) だけを常駐させます。**グリフフォント本体は `assets/generated/vn/font.bin` として `cd.dataFiles` の先頭 (CD sector 64) に並べ、起動時に 1 回だけ VRAM へストリーム転送します**（bank132 に font tiles を常駐させないため、使用文字種を増やしても bank132 が溢れません）。font.bin の中身は表示用の先焼きタイルではなく **12×12 1bpp マスク（1 glyph = 12 word = 24 byte）**で、起動時に `PCE_VN_FONT_MASK_VRAM_WORD` 以降の VRAM へ転送します。CD runtime は message 開始時にそのページの glyph mask だけを `.ram_bank132` cache へ先読みし、runtime のグリフコンポジタ（bank133 overlay = `VN_OVERLAY_CODE`）は resident dispatcher 経由で IRQ を mask したまま bank133 を map し、bank130 へ復帰してから IRQ を戻したうえで、cache を優先し、12px 横ピッチで合成します（cache 外 glyph だけ VRAM から fallback 読み、メッセージ帯 208 タイルを read-modify-write）。メッセージ/選択肢の glyph ストリームはバイト指向で、glyph index 0..252 は 1 byte、253 以上は `0xfd` エスケープ + 16bit little-endian index で符号化します（stream byte `0xfe` = 改行、`0xff` = 終端。runtime はこれらをそれぞれ 16bit の `PCE_VN_GLYPH_NEWLINE`(0xfffe) / `PCE_VN_GLYPH_END`(0xffff) に復号するので、エスケープした実 index と衝突しません）。これにより使用文字種は旧 254 種上限を超えられ、実際の上限はマスクを置く VRAM のみで決まります（既定 `tileBase` でおよそ 1000 種 = `VN_MAX_GLYPH_COUNT`）。build 時に `generateVnSources()` の `computeFontBudget()` がマスク領域末尾 (SATB `0x7f00`) を検査し、超過は build error、上限接近 (`VN_GLYPH_COUNT_SOFT_WARN` 種以上 / VRAM tile 1728 超) や `VN_MAX_GLYPH_COUNT` を超えた文字の切り捨ては build ログに警告 (`warn`) を出します。インデックス 253 以上の文字は 1 文字 3 byte になるため、その文字を多用する scene が 4096 byte の active cache を超える場合は scene を分割してください（build error で検知）。なお `spritetext` overlay 用フォントは別系統で、従来どおり最大 254 glyph・1 byte index のままです。各 scene pack は pointer を持たない little-endian / offset ベース形式で、runtime は scene 入場時に active cache (`4096` bytes) へ読み込みます。明示的な `preload` command は旧 scene data 互換として読み込めますが、現行 CD-ROM2 VN runtime では no-op です。読み込み最適化は scene 入場時の内部 preload が担当します。VN build は各 scene pack をその scene が参照する BG/Sprite/ADPCM data file より前に並べ、build は IPL program の後ろへ padding file を挟み、最初の data file が固定の CD sector 64 から始まるように配置します。padding のサイズは固定ではなく、ELF build 後に `pce-mkcd -v` でプログラム像の実セクタ数を測定し `PCE_CD_DATA_BASE_SECTOR(64) - (program 終端 sector)` で算出します（`finalizePceCdDataPadding()`）。font tiles を bank132 から CD data file へ移すなどで program 像のサイズが変わっても、埋め込んだ sector 64 と実 ISO 配置を一致させ続けるためです。固定 padding のままだと program 縮小で data が前倒しになり、`pce_vn_font_data` 等の sector 参照がずれて全画面 BAT が壊れた glyph で埋まります。runtime は scene 入場時に script pack を active cache へ読み、暗転中なら最初の待ちコマンドまでに必要な BG/Sprite/ADPCM だけを active cache から先読みし、表示 command では固定 VRAM 領域へ反映します。`background` / `sprite` 表示 command は、VRAM/BAT/SATB 反映、必要な暗黙 fade、表示 layer の再有効化まで完了してから次 command へ進む同期 command です。CD-DA と CD data read は同時に行えないため、script pack や画像/sprite/ADPCM の CD data file を読む場合は runtime が CD-DA を `pce_cdb_cdda_pause()` で止めます。CD-DA を維持したい scene では、BG/Sprite command を CD-DA の前に置いてください。ADPCM 読み込みに失敗した場合はロード済みにせず再生もしません。ADPCM は再生中に current scene の `preload_scene_assets()` が同じ asset を再 reset/load しないようにし、実際の再生時は必ず `pce_cdb_adpcm_play()` を呼んでください。再生前に ADPCM metadata を local snapshot へコピーし、BIOS helper 後に MPR が変わっても length/divider/sector を読み間違えないようにします。`options.stream: true` の ADPCM は scene 入場時の内部 preload では読み込みませんが、ADPCM RAM に収まる音声は play 時に安定した buffered 経路（read_from_cd → play）で再生します。`pce_cdb_adpcm_stream()` による真の CD streaming は ADPCM RAM に収まらない大きい asset のときだけ使います（真の streaming は非同期 BIOS external IRQ で CD を供給し続け、VBlank を自前所有するこの runtime と衝突してノイズ・別音声混入・ハングを起こすため）。真の streaming を使う大きい asset では、streaming 中に同じ CD data path を BG/sprite/別 ADPCM 読み込みへ使わない scene 構成にしてください。

メッセージ開始時の window clear と全文 reveal は、208 タイル以上のメッセージ帯 VRAM を連続更新するため、runtime が一時的に display blank にしてから実行し、完了後に次の VBlank で表示を戻します。typewriter 中の通常の 1 glyph 更新は、bank133 overlay dispatcher の IRQ guard と glyph mask cache を使って短い VDC 更新に抑えます。

**Windows 固有: `pce-mkcd.exe` は MinGW ランタイム DLL に依存します。** llvm-mos-sdk の LLVM 系ツール（clang / ld.lld / llvm-objcopy）は静的リンクですが、`pce-mkcd.exe` だけは MinGW-GCC ビルドで `libstdc++-6.dll` / `libgcc_s_seh-1.dll` / `libwinpthread-1.dll` を動的に必要とします。SDK はこれらを exe の隣に同梱しないため、実行時は PATH から解決されます。ターミナル（Git Bash / MSYS2 等）の PATH には互換 DLL があり動きますが、**Electron の PATH には無いことが多く、見つからない (exit `0xC0000135`) か、ABI 非互換の DLL をロードして実行時にクラッシュ (exit `0xC0000005` = `3221225781`) します**（macOS は該当依存が無いため起きません）。DLL 検索は exe と同じフォルダが PATH より優先されるため、build は mkcd 実行前に `ensurePceMkcdRuntimeDlls()`（[pce-build-system.js](pce-build-system.js)）で、これらが exe の隣に無ければ MinGW/MSYS2/Git の bin から**完全な一組だけ**を選んでコピーします。コピー元が見つからない場合は cryptic な segfault でなく、DLL を `pce-mkcd.exe` と同じフォルダに置くよう促す明確なエラーを出します。

**VRAM 領域の排他予約（VN build）。** PCE VRAM は 32768 word の単一空間で、BAT(0–1024)、BG タイル、メッセージフォント/グリフマスク、spritetext フォント、スプライト pattern、SATB(0x7f00–) を各々独立規則で配置します。これらが重なるとレイアウトが破壊されるため、`generateVnSources()` は `validateVnVramLayout()`（[pce-vn-manager.js](pce-vn-manager.js)）で全領域を word range に展開し、**異なるカテゴリ間の重なりを検出したら build error**で停止します（どの 2 領域が word いくつで重なるかを表示）。BG 同士・スプライト同士は同一 VRAM を 1 枚ずつ使い回す（BG は `background` ごとに差し替え、スプライトは単一 pattern キャッシュ共有）ため、**同カテゴリ内の重なりは許容**し、各カテゴリは所属 asset の union extent で判定します。重なった場合は BG/スプライト/メッセージのいずれかを縮小するか tileBase を調整してください。

**BG/Sprite の visual payload は常に無圧縮（raw）です。** 以前あった RLE 圧縮（`tiles.rle` / `map_vram.rle` / `patterns.rle` sidecar）と `options.compression` オプション/UI は撤去しました。RLE streaming デコーダが VDC の書き込みアドレスを CD 読み込みを跨いで保持して BG 破壊の原因になり、かつ bank133 overlay の約 87% を占めていたためです（dithered 写真 BG では RLE が ~13% しか効かず CD 増分も軽微）。変換は raw の `tiles.bin` / `map_vram.bin` / `patterns.bin` だけを生成し、`cd.dataFiles` と generated C metadata は常にこの raw を参照します（`pce_editor_cd_data_ref_t.compression` は常に `0`=NONE）。runtime は CD sector を `cd_transfer_scratch` へ 1 セクタずつ読み、resident/noinline かつ IRQ guard 付きの `pce_editor_vram_copy()` で VRAM へ転送します（MAWR を CD 読み込みを跨いで保持せず、MAWR 設定から VRAM data 転送までは IRQ を mask）。この helper は SDK の `pce_vdc_set_copy_word()` を使わず、R5 high byte の DRAM refresh / VBlank status latch bit を維持します。`write_map_words()` の BAT 行更新も同じ helper を通ります。`pce_editor_cd_data_ref_t` は bank128 の常駐 `.rodata` を圧迫しないよう bank132 に置きます。旧プロジェクトに残る `.rle` / `compression: "auto"` メタは無視され（raw を使用）、再生成時に NONE へ正規化されます。

ADPCM は llvm-mos SDK の `pce_cdb_adpcm_reset()` / `pce_cdb_adpcm_read_from_cd()` / `pce_cdb_adpcm_read_from_ram()` / `pce_cdb_adpcm_play()` / `pce_cdb_adpcm_stream()` / `pce_cdb_adpcm_stop()` / `pce_cdb_adpcm_status()` 経由で System Card BIOS の ADPCM 機能を使います。通常 asset は CD data file を ADPCM RAM へ読み込んでから再生します。`options.stream: true` の asset も、ADPCM RAM に収まる音声は同じ buffered 経路（read_from_cd → play）で再生し、`ad_stream_start` 相当の真の CD streaming 経路は ADPCM RAM に収まらない大きい asset のときだけ使います。自然終了監視では `pce_cdb_adpcm_status()` を毎 frame 読まず、generated data size と sample rate から計算した frame counter で one-shot / streaming の終了と streaming loop を管理します。標準 EmulatorJS/WASM core では buffered ADPCM one-shot の完了IRQで CPU が止まることがあるため、runtime は ADPCM load / CD data read / stop など BIOS 操作時だけ external IRQ を有効にし、非loop buffered 再生中は完了IRQをマスクします。ADPCM BIOS call 直後の message advance edge が落ちることもあるため、ADPCM 再生開始後は次の joypad edge 判定を一度だけ初期化します。ADPCM BIOS helper は表示状態を変えることがあるため、runtime は表示中に ADPCM load/play/stream を実行した場合だけ完了後に display を再 enable します。暗転中 preload では意図した暗転を維持します。VN の audio command は `pce_cdb_adpcm_play()` / `pce_cdb_adpcm_stream()` を開始したら待ち状態を返さず次の command へ進みます。ただし未 preload の通常 ADPCM は、再生開始前の ADPCM RAM 読み込みだけ同期的に完了待ちします。

ADPCM のデータ/再生経路切り分けには `samples/pce-adpcm-diagnostic` を使います。`node scripts/pce-adpcm-diagnostic.js analyze <source.wav> <adpcm.bin> <sampleRate>` は generated ADPCM を OKI/MSM5205 と旧実験形式、low/high nibble first の各組み合わせで decode し、元 WAV との RMS error、SNR、correlation を出します。`node scripts/pce-adpcm-diagnostic.js build` は VN runtime を通らず BIOS の ADPCM helper だけを呼ぶ最小 CD-ROM2 ISO を作ります。`I` は high-nibble-first buffered、`II` は low-nibble-first buffered、`RUN` は high-nibble-first streaming 再生です。

CD-ROM2 RAM bank の標準ルールは `docs/pce-memory-bank-strategy.md` にまとめています。要点は、bank129 を VN runtime の `VN_BANKED_CODE`、bank130 を 2 本目の `VN_BANKED_CODE2`、bank132 を sprite animation / variable 初期値 / scene pack directory / font tiles と asset の CD data ref などの小さい VN generated data、bank133 を Path B overlay（message グリフコンポジタなど）に分けることです。script pack・画像/sprite/ADPCM の大きい payload・グリフフォント本体は CD data file のまま扱い、bank129 / bank130 / bank132 へ asset data を混ぜないでください。

PCE background conversion は、入力画像の各 8x8 cell を表示順の tile としてそのまま出力します。同一内容の tile を dedupe しないため、VN の背景切替では絵が過度に共通タイル化されず、raw の `tiles.bin` は `width / 8 * height / 8 * 32` bytes を基準に扱われます。CD-ROM2 では `options.compression` が `auto` の場合に `.rle` sidecar を使うことがありますが、raw 生成物は preview / fallback / 非 CD build 用に残ります。同一 slot へ別 sprite asset をロードする場合は、runtime が sprite layer を一度無効化して未使用 entry を画面外へ逃がした SATB を反映し、pattern VRAM を転送してから SATB と sprite layer を戻します（PCE ではゼロ SATB entry も実 sprite なので、無効化には使いません）。**sprite pattern は background tile と違い、同一内容の 16×16 cell を dedupe します。** 変換時に sheet の全 cell を 128 byte 単位で比較し、ユニークな cell だけを `patterns.bin`（= VRAM 転送本体）へ詰め、各 positional cell → ユニーク slot の対応表を `cellmap.bin`（1 byte/cell）として出力します。`generated.tileCount` / `vramBytes` は dedupe 後のユニーク cell 数で算出し、`pce_editor_sprite_asset_t.cell_map` に `cellmap.bin` を resident 配列として埋め込みます。runtime の `show_character_sprite_frame()` は positional cell を `cell_map[]` 経由で VRAM slot へ解決するため、目パチ・口パクなど frame 間で共通する cell が 1 枚に畳まれ、VN の VRAM 予算（message tile・font mask・SATB を除いた残り）に大きな多 frame sheet を収められます。ユニーク cell が 256 を超える sheet は build error（cell map は 1 byte index 上限）。

sprite pattern 領域は SATB (`0x7f00`) より手前に収めます。`tileBase`（= `pattern_base`、既定 `704` = VRAM word 22528）は message/font tile より後ろ・SATB より前の、VN runtime が character sprite を差し替えて共有する領域を指します。**dedupe 後の `tileBase * 32 + patterns.bin / 2` が `0x7f00` を超える場合は build error（旧実装の warning 止まりをやめ、壊れた ROM の生成を防止）**。tileBase が message tile (`PCE_VN_FONT_TILE_BASE`=712 以降) に被ると message glyph と blank tile を壊し、font 色を変えた余白が化け、SATB まで上書きされるため、large sheet は必ず dedupe + 安全な tileBase で配置します。同一 sprite sheet 内の目パチ・口パク frame 変更では pattern を再転送せず、SATB の frame 参照だけを更新します。別 sprite asset への差し替えでは、表示無効化 → VRAM 転送 → SATB/display 有効化の順で同期し、pattern 書き換え中の中間表示を出しません。

PCE background conversion は、入力画像の各 8x8 cell を表示順の tile としてそのまま出力します（sprite と異なり dedupe しません）。VN の背景切替では絵が過度に共通タイル化されず、raw の `tiles.bin` は `width / 8 * height / 8 * 32` bytes を基準に扱われます。CD-ROM2 では `options.compression` が `auto` の場合に `.rle` sidecar を使うことがありますが、raw 生成物は preview / fallback / 非 CD build 用に残ります。

VN sprite runtime は generated `pce_editor_sprite_draw_meta[]` の cell size、sheet cell 数、pattern base、palette bank を小さい常駐 metadata として読みます。animation metadata が sheet 範囲内なら `frame_count: 1` の default でも 1 frame の表示サイズとして使い、未指定の legacy default は generator 側で sprite sheet 全体表示へ補正します。VDC memory control は `VN_VDC_MEMORY_CONTROL` (`VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_32_32`) を使い、BG size 更新時に sprite cycle bit を落とさないでください。

CD-ROM2 VN runtime では `map_vram.bin` を `mapBase` から一括転送しません。raw `map_vram.bin`（無圧縮）は `VN_MAP_WIDTH`(=32)タイル幅のソース行として読み、各行の `width_tiles` 分だけを `mapBase + command.y * 32 + command.x + row * 32` へコピーします。これにより、224px背景を256px画面へ配置したときの左右余白は blank tile のまま残り、CD上の0埋めpaddingや古いVRAM tileが縦枠として表示されません。BG 画像は 256px(32 タイル)以下にしてください（`encodePceBackground` が超過時にビルドエラー）。BG command の切替は Fade 前提で、エディタは `cut` を表示しません。`fadeOutFrames` / `fadeInFrames` は速度プリセット `10 / 20 / 30 / 40 / 50 / 60` から選び、未指定時は速度3の `30` です。保存済みの旧 `transition: "cut"` は読み込み時に `transition: "fade"` へ正規化されます。fade は BG palette bank だけを段階変更し、display layer 全体を落とさないため、下部メッセージ領域や UI palette まで暗転させません。BG の VRAM/BAT 転送と fade 完了まで次 command へ進みません。

Sprite asset は `options.animations` で VN runtime 向けの差分アニメーションを定義できます。各 entry は `id`, `name`, `frameWidth`, `frameHeight`, `firstCell`, `frameCount`, `frameDelay`, `frameDelays`, `frameStrideCells`, `loop` を持ちます。未指定時は sprite sheet 全体を 1 frame とする `default` animation が生成時に補われます。`firstCell` と `frameStrideCells` は、PCE 16x16/16x32/32x32 などの sprite cell を左上から数えた index です。

**各フレームの表示時間（per-frame display time）**: `frameDelay` は全フレーム共通の既定値、`frameDelays`（長さ `frameCount` の配列）は **1 フレームごとの表示フレーム数**です。スプライトエディタの time フィールド（`spriteEditor.time` = `[[行0…][行1…]]` 行列、1 行 = 1 animation）から保存され、build 時に各 animation の per-frame テーブルとして `vn.c` に出力されます（`pce_vn_sprite_anim_delays_N[]`、resident rodata）。`pce_vn_sprite_anim_t.frame_delays` がこのテーブルを指し、runtime の `tick_sprite_animations()` は **現在フレームの `frame_delays[frame]`** で各フレームを送ります（空セルや legacy data で `frame_delays` が無い場合は `frame_delay` にフォールバック）。`frameDelays` を持たない旧 asset でも、`spriteEditor.time` 行列があれば正規化時に per-frame 値へ移行します。time フィールドは右ペインから直接編集でき、上部の Time フィールド（ROW/Frame 選択）でセル単位の編集も可能です。

VN runtime は `template/template_pce_vn_cd/src/pce_vn_runtime.c` を共通実体とし、各 project の `src/main.c` は `#include "pce_vn_runtime.c"` の薄い wrapper です。`pce-vn-manager.prepareVisualNovelBuild()` と `plugins/pce-sample-builder` は build 前に `main.c` と `pce_vn_runtime.c` を project `src/` へ同期します。runtime の変更はこの共通 source を更新してください。

### PCE VN scene schema

`assets/pce-vn-scenes.json` は v2 から `commands` を正式形式にします。旧 `backgroundAssetId` / `characters` / `messages` / `bgmAssetId` を持つ scene は読み込み時に commands へ正規化されます。

```jsonc
{
  "version": 2,
  "settings": { "messageSpeedFrames": 10, "messageAdvanceMode": "button", "messageAutoWaitFrames": 60 },
  "startScene": "opening",
  "scenes": [
    {
      "id": "opening",
      "fullScreenBg": false,
      "nextSceneId": "",
      "commands": [
        { "type": "background", "assetId": "classroom", "transition": "fade", "fadeOutFrames": 30, "fadeInFrames": 30, "x": 0, "y": 0 },
        { "type": "sprite", "slot": 0, "assetId": "akari", "x": 128, "y": 24, "animationId": "default", "visible": true },
        { "type": "audio", "kind": "cdda", "action": "play", "assetId": "opening_theme" },
        { "type": "variable", "variableName": "route", "operation": "define", "value": 0 },
        { "type": "audio", "kind": "psg", "action": "play", "assetId": "chime", "channel": 0 },
        { "type": "message", "speaker": "アカリ", "text": "こんにちは", "textColor": "#ffdb00", "voiceAssetId": "voice_01", "mouthSlot": 0, "mouthAnimationId": "mouth" },
        { "type": "inputcheck", "mode": "sync", "buttons": ["i", "right"], "targetLabel": "go_next" },
        { "type": "choice", "variableName": "route", "defaultIndex": 0, "choices": [{ "label": "進む", "value": 1, "targetSceneId": "" }, { "label": "待つ", "value": 2, "targetSceneId": "" }] },
        { "type": "if", "variableName": "route", "operator": "eq", "value": 1, "targetLabel": "go_next", "elseLabel": "stay" },
        { "type": "switch", "variableName": "route", "cases": [{ "value": 2, "targetLabel": "stay" }], "defaultLabel": "go_next" },
        { "type": "label", "name": "go_next" },
        { "type": "goto", "targetLabel": "after_branch" },
        { "type": "label", "name": "stay" },
        { "type": "wait", "frames": 30 },
        { "type": "label", "name": "after_branch" },
        { "type": "effect", "effect": "fadeOut", "frames": 16, "color": "#000000" },
        { "type": "effect", "effect": "flash", "frames": 4, "color": "#ffffff" },
        { "type": "jump", "sceneId": "next_scene" },
        { "type": "audio", "kind": "adpcm", "action": "stop", "assetId": "" }
      ]
    }
  ]
}
```

scene の `fullScreenBg` を `true` にすると、その scene は 256x224 の全画面 BG 専用になります。`background` command は 256x224px の BG asset を `x: 0`, `y: 0` に置く必要があり、`message` / `choice` / 表示中の `sprite` / 表示中の `spritetext` を含めると build error になります。runtime も scene pack flag を見てこれらの表示 command を無視するため、前後 scene の UI や sprite が全画面 BG を上書きしません。

VN build では `src/generated/vn.h` / `vn.c` に `pce_vn_command_t`, `pce_vn_message_t`, `pce_vn_choice_t`, `pce_vn_switch_t`, `pce_vn_sprite_anim_t` を出力します。runtime は command を順に実行し、`message`, `choice`, `wait` command で停止します。`background.x` / `background.y` は32x32 BAT上のタイル座標で、指定した位置へBG mapを配置します。未指定時は `(0, 0)` です。`background.transition` は互換用に `"fade"` を保存し、`fadeOutFrames` / `fadeInFrames` は `10 / 20 / 30 / 40 / 50 / 60` のプリセット値へ正規化されます。未指定時の既定値は速度3の `30` です。`sprite` command は表示・差し替え・非表示を即時反映します。旧 `durationFrames` / `moveFrames` は読み込み時に破棄され、生成には使われません。`-1` sentinel を持つ generated index field は `signed int` とし、件数を `unsigned char` で公開する scene/message/choice/switch/variable/sprite animation/command は build 時に 255 件上限を検証します。メッセージ表示領域は 17 文字 × 4 行（メッセージ窓 208x64px、タイル (3, 20) 起点、1 文字 12×12px・横 12px ピッチ・縦 16px 行ピッチ）で、`message.text` は 17 文字で自動折り返しし、4 行を超えた分は表示しません。12px 横ピッチは 8x8 タイル境界に乗らないため、runtime のグリフコンポジタが各文字を VRAM 上のメッセージ帯へ合成描画します。`speaker` がある場合は `speaker「text」` を 1 つの文字列として流し込みます。`text` 内の改行 (`\n`) は強制改行として扱い、build 時に `PCE_VN_GLYPH_NEWLINE`(0xfe) として encode、runtime が次の行へ送ります（フォントグリフは消費しません）。`text` を空文字にするとメッセージ領域をクリアした空ページになります（先頭メッセージのみ、未入力時にプレースホルダ文言で初期化されますが、明示的に空にすると空のまま保持します）。`message.textColor` は本文の文字色で、`#rrggbb` の hex をエディタ側で PCE 表示可能色（各チャンネル 3bit）へスナップし、build 時に 9-bit パレット word（`PCE_VN_MESSAGE_COLOR_NONE`=未指定）として scene pack の message record へ格納します。runtime は message 表示開始時に UI パレット (`VN_UI_PALETTE`=15) の前景色をその色へ書き換え、本文と話者ラベルを着色します。エディタの VN プレビューも同じ `textColor` をメッセージ描画へ反映します。未指定の message と選択肢描画時は既定の白へ戻します（このため message record は 13 byte、`PCE_VN_SCENE_PACK_MESSAGE_SIZE`）。`settings.messageSpeedFrames` はノベルエンジン全体のメッセージ速度で、`0 / 10 / 20 / 30 / 40 / 50` のプリセット値へ正規化されます。`settings.messageAdvanceMode` は既定 `"button"` で、`"auto"` の場合は `settings.messageAutoWaitFrames` 経過後に次 command へ進みます。個々の `message` command の旧 `textSpeedFrames` / `advanceMode` / `autoWaitFrames` は読み込み時に破棄され、生成には使われません。`voiceAssetId` に ADPCM を指定した場合、**build 時にエディタ側が** 1 文字あたりの表示フレーム（scene pack の `text_speed_frames`）を ADPCM 実再生長に合わせて算出し、再生長が取れない場合だけ `settings.messageSpeedFrames` を fallback として焼き込みます（runtime は焼き込まれた値をフレームタイマで使い、再生長計算は行いません）。再生長は `voiceFrames = round(byteLength * 2 * 60 / 実再生レート)`、表示速度は `round(voiceFrames / 描画グリフ数)`。**実再生レートは公称 `sampleRate` ではなく量子化レート `32000 / (16 - code)`**（runtime の `adpcm_rate_code` と一致）を使います。**描画グリフ数は改行を除いた発話文字数**で、runtime も改行で typewriter tick を消費せず即座に次行へ送ります（scene pack の `glyph_count` は改行込み全エントリ数で別）。

> **ADPCM 再生中の文字送り**: CD/ADPCM の bus contention で VN メインループが重くなるため、現行 runtime は timing 補正ではなく毎フレーム処理コスト削減で同期を保ちます。sprite animation は ADPCM 中も停止せず、slot に cache した animation metadata と既存 SATB layout を使って pattern / attr word だけを差分更新します。ADPCM 再生中という理由で sprite/spritetext refresh を gate しないため、message の mouth animation は音声中も動き続けます。voiced message は ADPCM 開始前に glyph mask を `.ram_bank132` cache へ先読みし、glyph compositor は tile と glyph の交差範囲だけを走査します。active message record も `active_message_state` に保持し、typewriter tick で scene pack decode を繰り返しません。`delay_frame()` は `IO_VDC_STATUS` を同関数内だけで読む inline asm の短い guard 付き polling にして、待ちループの I/O read 数を抑えます。runtime 側で VBlank を数えて文字表示を ADPCM 進捗へ追従させる試みは、**再生中の画面の乱れ・文字が音声後に表示・低速化**の回帰を起こしたため撤去しました（`docs` の方針どおり、ADPCM 周りの runtime 改修は Geargrafx で再生中フレームの画面/VRAM/VDC を必ず確認のこと）。メッセージ中の入力は typewriter 表示を即時完了し（ウェイトスキップ。ADPCM はそのまま継続）、完了後の入力で次ページへ進みます。システム設定の `messageAdvanceMode: "button"` でウェイトスキップ後に次ページへ送ると、まだ再生中の ADPCM は `stop_adpcm_voice()` で終了します。システム設定の `messageAdvanceMode: "auto"` と `messageAutoWaitFrames` の待ち時間経過でも次 command へ進みます。`message.mouthSlot` (0..3) と `message.mouthAnimationId` は口パク（リップシンク）用で、message 表示開始時に指定 sprite slot の animation を切り替えます。動作には前提条件があります: (1) **同一 scene 内でその message より前に `sprite` command が同じ `slot` 番号へ対象 sprite を `visible: true` で配置している**こと、(2) その sprite asset に `mouthAnimationId` と一致する `animationId` の animation（`frameCount > 1`、口を回し続けるなら `loop: true`）が定義されていること。両方を満たすと build 時に `pce_vn_message_t.mouth_animation_index` が解決され、満たさない場合（slot に sprite なし / 一致 animation なし / `mouthAnimationId` 空）は `-1`（口パクなし）になります。runtime は message 開始時にその slot の `animation_index` を切り替え `frame` / `timer` を 0 にリセットして再生を始め、以降は毎フレームの `tick_sprite_animations()` が frame を進めます（`loop` なら回り続けます）。**message 完了時に自動で元の animation へ戻す処理はありません**。喋り終わりで口を閉じたい場合は、その message の後に同じ slot へ idle 用 animation を再適用する `sprite` command を置いてください。`choice` は上下で選択、I/II/RUN で確定し、`variableName` が指定されていれば選択肢の `value` を変数へ代入します。従来互換として各選択肢の `targetSceneId` が指定されている場合は、その scene へ遷移します。`variable` は `define` / `set` / `add` / `sub` / `random` を持ち、値は signed 16-bit へ丸められます。`if` / `switch` / `goto` は同一 scene 内の `label.name` へ command pointer を移動します。`inputcheck` は指定ボタン（`buttons`: `up`/`down`/`left`/`right`/`select`/`run`/`i`/`ii` の OR 条件）の入力で同一 scene 内の `targetLabel` へ GOTO する分岐 command です。`mode` は 3 種: `sync`（条件入力まで同期待機して GOTO）、`async`（待機状態を保持したまま次 command へ進み、以後どのフレームでも条件成立で GOTO）、`cancel`（保持中の非同期待機を終了）。非同期待機は単一ウォッチャで、scene 切替時に自動クリアされます。ボタンマスクは command record の `arg0`、`mode` は `flags`、移動先 label index は `x` に格納します。`audio` の `kind` は `cdda` / `adpcm` / `psg` で、`psg` は `psg-song`（ループ）/ `psg-sfx`（ワンショット）アセットをフレーム駆動シーケンサで再生します。`channel`（0..5）を基準チャンネルとし、パターン各 step の channel をそこからのオフセットとして 0..5 にクランプして発音します（基準チャンネルは command record の `slot` に格納）。`audio` の `action: "stop"` は kind ごとに該当再生を停止します。表示待ちのない無限ループを避けるため、runtime は1回の advance で実行する命令数にガードを置き、超過時は1 frame 待って継続します。明示的な `preload` command は旧 scene data 互換の no-op です。BG/Sprite/ADPCM の先読みは scene 入場時の内部 preload が担当します。CD-ROM2 VN runtime は CD BIOS graphics driver と System Card の VBlank handler を使わず、VDC 表示制御と SATB 転送を runtime 側で直接管理します。通常 frame wait は `pce_cdb_wait_vblank()` の BIOS counter ではなく VDC status の `VDC_FLAG_VBLANK` を guard 付きで直接待ちます。VDC R5 の `VDC_CONTROL_IRQ_VBLANK` はこの status latch 用に有効化し、HuC6280 側の `IRQ_VDC` は `pce_irq_disable(IRQ_VDC)` で mask します。`PCE_CDB_MASK_VBLANK_NO_BIOS` だけでは System Card の VBlank handler が R5/R7/R8 を毎フレーム書くことがあるため、message 中の BG 水平ずれの原因になります。CD/ADPCM BIOS helper 後は System Card の R5 shadow も runtime が更新するため、sprite enable bit は helper 後も維持されます。SATB の全転送と口パク差分更新は VDC 書き込み直前に `vn_wait_next_vblank()` で VBlank へ寄せ、表示期間中の R19/SATB DMA start を避けます。CD/ADPCM/CD-DA BIOS helper 後の timing/control/scroll 復元と display/sprite layer 切り替えも VBlank 側で行い、表示期間中の R5/R7/R8/R9/R10 書き換えを避けます。CD-DA 再生は explicit な audio command でのみ開始し、asset の track 番号から生成済みの開始 sector を求め、`PCE_CDB_LOCATION_TYPE_SECTOR` と `PCE_CDB_LOCATION_TYPE_UNTIL_END` で `pce_cdb_cdda_play()` を呼びます。track 境界は BIOS の明示終了指定ではなく、WAV 長から生成した `play_frames` を runtime が毎 VBlank で減算して管理します。loop 有効時は BIOS repeat に任せ、runtime は pause/resume 用の進行位置を概算更新するだけで、境界ごとに `pce_cdb_cdda_play()` を再発行しません。loop 無効時は `pce_cdb_cdda_pause()` で停止します。CD-DA 停止は `pce_cdb_cdda_pause()`、ADPCM 停止は `pce_cdb_adpcm_stop()` を使います。

Sprite animation の差分更新では、既存 SATB layout の pattern word と attr word を同時に更新し、VDC write address を hidden SATB entry へ逃がしてから戻ります。これにより、ADPCM / CD-DA BIOS helper 後の復元処理で最後の表示 sprite attr が一瞬壊れることを避けます。

`effect` command は `fadeOut` / `fadeIn` / `blank` / `shake` / `flash` を持ちます。`fadeOut` と `flash` の `color` は PCE 表示可能色へ丸めた 9-bit GRB として command record の `x` に格納します（未指定時は `fadeOut` が黒、`flash` が白）。このため `flash` / 色付き `fadeOut` を追加しても scene pack の command record サイズは増えません。

### `PluginInfo` の型

```ts
interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;            // manifest.icon。未指定時は tab.icon、どちらもなければ空文字
  pluginTypes: string[];   // types 配列の正規化済み値
  pluginType: string;      // pluginTypes[0]
  supportedCores: string[]; // 対応 core。未宣言 plugin は ["mega-drive"] に正規化される
  compatibleWithActiveCore: boolean; // listPlugins({ coreId }) 時の互換判定
  core: {
    id: string;
    label: string;
    platform: string;
  } | null;                // types に core を含む場合の core metadata
  tab: object | null;      // manifest.tab の値
  dependencies: string[];
  hooks: string[];
  permissions: string[];
  roles: Array<{
    id: string;
    label: string;
    exclusive: boolean;
    order: number;
  }>;
  mainApi: {
    hooks: string[];
    capabilities: string[];
  };
  hasGenerator: boolean;   // generateSource / generateSourceAsync が存在するか
  renderer: {
    entry: string;
    styles: string[];
    page: string;
    capabilities: string[];
    error?: string;
  } | null;
  hasRenderer: boolean;
  rendererAssets: {
    scriptUrl: string;      // file:// URL
    styleUrls: string[];    // file:// URL
  } | null;
  enabled: boolean;        // 現在の有効状態
}
```

### イベント購読

プラグインのログは `onPluginLog` で購読できます。

```js
window.electronAPI.onPluginLog((payload) => {
  // payload: { pluginId: string, text: string, level: 'info'|'warn'|'error'|'debug' }
  console.log(`[${payload.pluginId}] ${payload.text}`);
});
```

---

## 13. 既存プラグイン一覧

この一覧は `plugins/*/manifest.json` を持つ現行プラグインに合わせています。`hidden: true` のものは統合 UI の内部モジュールで、通常の Plugins 画面や sidebar には表示されません。

| ID | 表示名 | types | 表示 | 主な役割 |
|---|---|---|---|---|
| `pc-engine-core` | PC Engine Core | `core` | 表示 | `pc-engine` core metadata と setup / project / build provider の入口 |
| `code-editor` | コードエディタ | `editor` | 表示 | `src/` など project 配下のファイル編集 |
| `pce-sample-builder` | サンプルゲームビルダー | `build` | 表示 | PCE sample / VN template の build role |
| `pce-standard-emulator` | 標準エミュレーター (EmulatorJS) | `emulator` | 表示 | Setup 済み EmulatorJS `mednafen_pce` core で Test Play を起動 |
| `pce-external-emulator` | 外部エミュレーター | `emulator` | 表示 | Project Settings の起動パスへ生成済み ROM / CUE を渡して Test Play を起動 |
| `pce-asset-manager` | アセット管理 | `editor`, `asset` | 表示 | `assets/pce-assets.json` の BG / sprite / palette / PSG / ADPCM / CD-DA 管理 |
| `image-editor` | イメージ | `editor`, `asset` | 表示 | BG / Sprites / Palette を 1 つの Image タブに統合 |
| `sound-editor` | サウンド | `editor`, `asset` | 表示 | ADPCM / CD-DA / PSM を 1 つの Sound タブに統合 |
| `novel-editor` | ノベル | `editor`, `asset` | 表示 | VN scene 編集と font 生成を 1 つの Novel タブに統合 |
| `pce-image-converter` | 画像コンバーター | `converter` | 表示 | PNG/BMP/WebP を PCE BG / sprite 用 import pipeline へルーティング |
| `image-resize-converter` | 画像リサイズコンバーター | `converter` | 表示 | 画像の 8 dot 境界 resize / clipping |
| `image-quantize-converter` | 画像減色コンバーター | `converter` | 表示 | PCE 用 16 色減色 |
| `pce-audio-converter` | 音声コンバーター | `converter` | 表示 | WAV / MP3 の trim / rate / mono / normalize など共通音声 import UI |
| `pce-adpcm-manager` | ADPCM 管理 | `editor`, `asset` | 内部 | `sound-editor` の ADPCM タブ用モジュール |
| `pce-cdda-manager` | CD-DA 管理 | `editor`, `asset` | 内部 | `sound-editor` の CD-DA タブ用モジュール |
| `pce-music-editor` | ミュージックエディター | `editor`, `asset` | 内部 | `sound-editor` の PSM / PSG タブ用モジュール |
| `pce-background-manager` | 背景管理 | `editor`, `asset` | 内部 | `image-editor` の BG タブ用モジュール |
| `pce-sprite-manager` | スプライト管理 | `editor`, `asset` | 内部 | `image-editor` の Sprites タブ用モジュール |
| `pce-palette-editor` | パレットエディター | `editor`, `asset` | 内部 | `image-editor` の Palette タブ用モジュール |
| `pce-visual-novel-editor` | ビジュアルノベル | `editor`, `asset` | 内部 | `novel-editor` の VN タブ用モジュール |
| `pce-font-editor` | フォント | `editor`, `asset` | 内部 | `novel-editor` の Font タブ用モジュール |

### PCE アセット系

`pce-asset-manager` は `assets/pce-assets.json` v2 を正とする標準アセット管理です。BG image / Sprite sheet / Palette / PSG song/SFX / ADPCM / CD-DA track を扱います。画像の追加は `pce-image-converter` の `image-import-pipeline` を経由し、内蔵 PCE 変換で BG tile / BAT map / sprite pattern 形式の generated asset を作成します。音声の追加は `pce-audio-converter` の共通音声 UI を経由し、project-local WAV を生成してから ADPCM / CD-DA へ登録します。

`image-editor` は BG / Sprites / Palette の画像画面を 1 つの sidebar タブに統合します。画面上部のタブで `BG`、`Sprites`、`Palette` を切り替えます。`pce-background-manager` / `pce-sprite-manager` / `pce-palette-editor` は互換用の内部モジュール (`hidden: true`) として残し、ユーザー向けプラグイン一覧には表示しません。BG / sprite の生成物は PCE 変換を使い、Superfamiconv や SGDK ResComp 用の converter には依存しません。BG 追加 UI では出力幅/高さだけを指定し、`paletteBank` / `transparentIndex` は `0` 固定です。Sprites 追加 UI では通常表示を出力幅/高さに絞り、変換時だけ有効な `Cell size` は `アドバンス` に隠します。`paletteBank: 0`、`tileBase: 704`、`x: 144`、`y: 104`、`transparentIndex: 0`、初期 animation `16x16` / `1 frame` / `1 frame delay` で登録します。`tileBase` / `x` / `y` は Properties の `アドバンス` に隠し、旧 ResComp 圧縮由来の `opt_type` / `opt_level` / `opt_duplicate` / `comment` は表示しません。BG の一覧と詳細 preview の境界はドラッグで幅調整できます。preview はホイールで拡大縮小し、中央ボタンドラッグで表示位置を動かせます。一覧では固定的で意味が薄い palette 数列を表示せず、palette count / palette file / swatch は詳細側で確認します。BG の一覧は `Name` と `ID` を別列にし、各列ヘッダーで昇順/降順ソートできます。Image 配下の asset 一覧では `Name` に `folder/item` のような `/` 区切りを使うと、エディタ上ではグループ見出しと leaf 名に分けて表示します。Sprites タブは MD Game Editor の Sprite editor と同じ 3 ペイン構成に寄せ、左に sprite asset tree、中央に frame preview / sprite sheet / Animation Rows、右に properties を表示します。Frame Preview と Sprite Sheet はスクロールでき、倍率は 10-500% の percentage でホイール調整し、中央ボタンドラッグで表示位置を動かせます。Palette タブでは手動 palette の追加、保存、確認付き削除ができます。PCE では `.res` の `SPRITE` 定義ではなく `assets/pce-assets.json` の sprite asset を正とし、frame size、ROW ごとの有効 frame 数、time、collision などの編集結果は `options.animations` と `options.spriteEditor` metadata へ保存します。

### Sound / Novel 統合 UI

`sound-editor` は ADPCM / CD-DA / PSM の音声画面を 1 つの sidebar タブに統合します。`pce-adpcm-manager` / `pce-cdda-manager` / `pce-music-editor` は互換用の内部モジュール (`hidden: true`) として残し、ユーザー向けプラグイン一覧には表示しません。ADPCM / CD-DA の一覧と詳細 pane の境界はドラッグで幅調整できます。一覧行右端の preview / delete は横並びの icon button として扱い、狭い列幅でも縦に崩れないようにします。ADPCM / CD-DA の一覧は `Name` と `ID` を別列にし、各列ヘッダーで昇順/降順ソートできます。Sound 配下の asset 一覧でも `Name` の `/` 区切りをグループ表示として扱います。

`novel-editor` は script scene 編集と font 生成を 1 つの sidebar タブに統合します。画面上部のタブは `スクリプト` / `Font` です。Scenes 一覧では各行右端の削除アイコンから scene を削除できます。`pce-visual-novel-editor` / `pce-font-editor` は内部モジュール (`hidden: true`) として残します。CD-ROM2 / VN runtime の bank 配置を変える作業では、先に `docs/pce-memory-bank-strategy.md` を読んでください。

### Test Play

`pce-standard-emulator` は `pce-setup-manager` が検出した EmulatorJS runtime と `mednafen_pce` core を使います。HuCard / CD-ROM2 の Test Play では、System Card / IPL はユーザー所有ファイルとして扱い、リポジトリへ同梱しません。描画崩れの原因調査は EmulatorJS の見た目だけに依存せず、利用可能なら Geargrafx MCP で VDC / VRAM / SATB / palette を確認してください。

`pce-external-emulator` は `testplay` role の代替 plugin です。Project Settings の `testPlay.externalEmulator.executablePath` と `testPlay.externalEmulator.extraArgs` を読み、`context.testPlay.launchExternalEmulator()` で外部プロセスを起動します。macOS では未設定時の起動パスを `/Applications/Geargrafx.app/Contents/MacOS/geargrafx` に補完します。`.app` bundle が指定された場合は、main process 側で `Contents/MacOS` の実行ファイルへ解決してから ROM / CUE path を渡します。`extraArgs` に `{rom}` / `{romPath}` / `{file}` / `%ROM%` を含めるとその位置へ生成済み ROM / CUE path を挿入し、placeholder が無い場合は末尾へ自動追加します。この設定 UI は Test Play role が `pce-external-emulator` の場合だけ有効です。ユーザー向け手順は `docs/user-guide.md` を参照してください。

Super CD-ROM2 / ADPCM の挙動確認では、標準 EmulatorJS/WASM だけを正としないでください。標準 WASM の `mednafen_pce-wasm.data` だけ ADPCM 再生後の message advance が止まり、Geargrafx / 外部エミュレーターでは進むケースがあります。再生開始後に次 command へ進んでも、非loop buffered ADPCM の自然終了時に CPU が止まる場合があるため、ADPCMあり/なしの最小 scene で完了後の next message まで確認します。詳細な切り分け手順は `docs/pce-testplay-debugging.md` に残しています。

---

## 14. 開発の流れ (チュートリアル)

### Runtime v2.5 で plugin 開発者が必ず行うこと

1. `manifest.json` に `types`、`supportedCores`、`permissions`、必要な `roles`、`hooks`、`renderer.capabilities` を宣言する。
2. Build / Test Play の単一選択 plugin は `roles` を宣言し、プロジェクト側は `project.json.pluginRoles` に plugin ID を保存する。
3. MD 専用 plugin は `supportedCores: ["mega-drive"]`、PCE 専用 plugin は `["pc-engine"]`、共有 plugin は `["*"]` を宣言する。
4. UI、modal、preview、converter 連携は plugin の `renderer.js` で実装し、本体 HTML / renderer / main / preload へ個別追記しない。
5. main process の処理が必要な場合は `hooks` と `mainApi.hooks` に同じ hook 名を宣言し、renderer から `api.plugins.invokeHook()` で呼ぶ。
6. asset 登録拡張は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として提供する。
7. 新しい plugin で本体修正が必要に見えた場合は、まず汎用 API または core provider の不足として扱い、plugin 固有分岐を本体へ追加しない。
8. renderer 側の入力 UI は `window.prompt()` / `alert()` ではなく、`api.createModal()` で plugin-owned modal として実装する。
9. `.res` のアセット名は物理ファイル名ではなく ResComp alias / C symbol として扱い、登録前・ビルド前に重複検査する。
10. ユーザーに見える機能追加、plugin role/API、project 設定、既知制約を変えた場合は、実装と同じ変更で `docs/user-guide.md`、`PLUGIN.md`、関連する `docs/` を更新する。
11. SGDK の `src/boot/sega.s` / `src/boot/rom_head.c` は専用 build rule が扱うため、plugin の `makeVariables` へ通常ソースとして追加しない。
12. `src/boot/rom_head.c` はプロジェクト設定からエディタ本体が生成するため、build plugin のテンプレート同期で上書きしない。
13. アセット参照を持つ editor plugin は、画面を開いた時点または sidebar で再アクティブになった時点で `.res` / source data を再読込し、一覧・select・preview を最新化する。更新ボタンに依存した状態同期だけにしない。
14. 選択中アセットに未保存変更がある状態で別アセット選択・新規追加・import を行う場合は、保存 / 破棄 / キャンセルを選べる plugin-owned modal を出し、暗黙に編集内容を捨てない。

### 手順 1: フォルダを作成する

```
pce-game-editor/plugins/my-build-plugin/
├── manifest.json
└── index.js
```

### 手順 2: manifest.json を作成する

```json
{
  "id": "my-build-plugin",
  "name": "My Build Plugin",
  "description": "カスタムビルドプラグインのサンプル",
  "version": "1.0.0",
  "icon": "build",
  "types": ["build"],
  "supportedCores": ["pc-engine"],
  "permissions": ["project.read", "build.configure"],
  "roles": [{ "id": "builder", "label": "Build", "exclusive": true, "order": 10 }],
  "hooks": ["onBuildEnd"]
}
```

### 手順 3: index.js を作成する

```js
'use strict';

async function onBuildEnd(payload, context) {
  context.logger.info(`ROM が生成されました: ${payload.romPath}`);
  return { ok: true };
}

module.exports = { onBuildEnd };
```

### 手順 4: アプリを再起動して有効化する

1. `npm start` でアプリを起動
2. Settings > Plugins を開く
3. `my-build-plugin` が一覧に表示されていることを確認
4. トグルを ON にする

### 手順 5: 動作確認

プロジェクトをビルドすると、Build Log に `ROM が生成されました: ...` と表示されます。

---

## 15. よくある間違い

### `types` を文字列で書いてしまう

```jsonc
// ❌ Runtime v2.5 では無効
{ "type": "build" }

// ✅ 正しい書き方
{ "types": ["build"] }
```

### `hooks` の宣言が `index.js` の実装と一致しない

`hooks` フィールドは宣言のみです。実装がなくても起動時エラーにはなりませんが、  
`invokeHook` を呼び出したときに `skipped: true` が返されます。  
宣言と実装は必ず一致させてください。

### `generateSource` と `generateSourceAsync` の混在

どちらか一方のみ実装してください。両方ある場合は `generateSourceAsync` が優先されます。

### 依存プラグインが存在しないのに `dependencies` に記載する

`setPluginEnabled` の `missingDependencies` に含まれます。  
存在しない ID は `dependencies` に記載しないでください。

### `context.logger` が undefined になる

`invokeHook` は `context` 引数が省略された場合、空オブジェクト `{}` を渡します。  
`context?.logger?.info(...)` のようにオプショナルチェーンを使うか、  
フック関数のデフォルト引数を `context = {}` にしてください。

### アセット一覧や select を初回読込時のまま使う

Sprite / TileMap / Music / Block Stage のような editor plugin は、画面表示時と sidebar で再アクティブになった時点で `.res` / source data を再読込してください。別 plugin で追加・削除された asset を古い一覧のまま編集すると、preview や保存先が実体とずれます。

### 保存 / 削除をプロパティフォーム末尾にだけ置く

アセット単位の editor では、保存・削除 action を選択中リスト項目の右端にも置き、未保存状態をリスト上で見えるようにしてください。プロパティフォームの末尾だけに action を置くと、一覧と編集状態の対応が弱くなります。

### 繰り返し行の入力に同じ説明ラベルを重ねる

Animation Rows のような繰り返し UI は、各行に `有効` / `既定 time` などの label を繰り返さず、ヘッダー行 + テーブル型レイアウトにします。行の高さを抑えることで、ROW 数が増えても preview 領域を圧迫しません。

### preview で素材ファイルそのものだけを表示する

SPRITE など定義に意味がある asset は、画像ファイル全体ではなく frame size / animation ROW / time / collision などの定義を反映した preview を表示してください。

---

## 16. 実装ノウハウ

### Editor plugin の画面設計

複数の editor plugin が sidebar に並ぶ前提で、各 plugin は独立した page として振る舞います。`root` 自体の `display` を上書きせず、root 直下の wrapper で grid / flex を構成してください。plugin page の activation を検知して必要な再読込を行う場合は、`MutationObserver` で `.active` class の付与を監視し、非アクティブ時の描画や保存処理を避けます。

アセット編集 UI は、左にアセット一覧、中央に preview / editor、右に property form を置く 3 列構成を基本にします。左右列は resizer で調整可能にし、中央の上下 preview も splitter で高さ調整できると、画像・TileMap・SPRITE のような大きな canvas を扱いやすくなります。

ヘッダーや toolbar は pane の端まで通し、フォームや空状態メッセージ側だけに padding を持たせます。pane 自体に padding を入れると、特定列のヘッダーだけ内側へずれて見えます。繰り返し行の編集 UI では label を各行で反復せず、ヘッダー行に「有効」「既定 time」などの意味を置き、各行は input と状態表示だけにします。

再生・停止・先頭・末尾・loop などの preview 操作は icon button を使い、文脈が明確な select label は簡潔にします。たとえば SPRITE animation select は `ROW 1 (4 frames)` ではなく `1 (4 frames)` のように、周辺 UI で意味が分かる情報を繰り返さないでください。

保存 / 削除 action は、プロパティフォームの末尾だけでなく、選択中アセットのリスト項目右端に置くと状態と操作が対応しやすくなります。未保存状態ではリスト名に `*` や status を出し、別アセットを開く前に保存 guard modal を挟みます。

### アセット登録 UI

`resources.res` の `name` は ResComp が生成する C symbol です。UI で「アセット名」として表示する値は物理ファイル名ではなく、この alias を使ってください。

アセット登録の基本フロー:

1. ファイルを選択する
2. converter を起動する前に alias 入力 modal を出す
3. alias を C symbol として安全な形へ正規化する
4. `res:listDefinitions` で現在の `.res` を読み、既存 alias と重複していないか確認する
5. converter に `symbol` / `targetFileName` を渡す
6. `addResEntry()` または converter の登録処理後に `.res` を読み直し、select / preview / validation を更新する

`window.prompt()` / `alert()` は Electron の埋め込み renderer で期待通り動かないことがあるため、plugin UI では `api.createModal()` を使います。

### 画像 import pipeline と保存形式

画像アセットを登録する plugin は、変換結果の `dataUrl` だけでなく保存形式も明示してください。`image-import-pipeline.convertToIndexed16()` のような capability が `{ convertedDataUrl, targetExtension }` を返す場合、呼び出し側は `targetFileName` の拡張子を `targetExtension` に合わせます。これを怠ると、中身は BMP なのにファイル名が `.png`、またはその逆になり、preview / ResComp / palette 表示のどこかで原因が分かりにくい不具合になります。

```js
const converted = await imagePipeline.convertToIndexed16({ sourcePath, targetSize });
const ext = converted.targetExtension || '.png';
const copyResult = await api.electronAPI.writeAssetFile({
  sourcePath,
  targetSubdir: 'gfx',
  targetFileName: `${symbol}${ext}`,
  dataUrl: converted.convertedDataUrl || '',
});
```

変換を行わず元ファイルをそのままコピーしたい場合は、`convertedDataUrl: ''` を返します。`writeAssetFile()` は `dataUrl` が空なら `sourcePath` をコピーします。一方、PNG などに変換済みのバイナリを保存したい場合は必ず `convertedDataUrl` を渡します。

標準アセット登録画面とゲーム固有エディタの登録 UI の両方が同じ `image-import-pipeline` を使う可能性があります。片方だけ直すと、もう片方に古い PNG 変換や拡張子固定の経路が残ります。画像 import の仕様を変えたら、標準登録経路と plugin 固有登録経路の両方で `convertedDataUrl` / `targetExtension` / `targetFileName` の扱いを確認してください。

### アセット一覧と保存ガード

Sprite / TileMap / Music / Block Stage のような editor plugin は、画面を開いた時点で `.res` や編集元ファイルを再読込し、一覧・filter・select・preview を最新状態にします。ユーザーが手動で押す「更新」ボタンだけを同期手段にすると、別 plugin で追加・削除されたアセットを古い状態のまま編集してしまいます。

選択中アセットに未保存変更がある場合、別アセット選択・新規追加・import・reload で内容が消えないように、保存 / 破棄 / キャンセルを選べる modal を出してください。`window.confirm()` ではなく `api.createModal()` を使い、保存を選んだ場合は現在の asset を保存してから次の操作へ進めます。

### SPRITE editor / preview の注意

SPRITE は単なる画像ファイルではなく、`width` / `height` / `time` / `collision` などを含む RESCOMP 定義です。preview ではスプライトシート全体を cover 表示せず、定義された frame size と ROW ごとの animation を使って再生確認できるようにします。canvas 描画では `imageSmoothingEnabled = false` を指定し、pixel art をぼかさないでください。

ROW ごとの有効フレーム数は `time` 行列の各 ROW 長で表現します。scalar time を読み込んだ場合は全 ROW / 全列有効として展開し、UI 編集後は `[[...][...]]` 形式へ serialize します。フレーム time が `0` の場合、SGDK 上ではそのフレーム以降の再生が進まないため、editor preview でも停止として扱います。

Sprite Sheet には 8x8 grid、選択 frame、無効 frame の overlay、各 frame の time 値を重ねて表示します。シートクリックは ROW / frame 選択だけを行い、自動再生は開始しません。Frame Preview / Sprite Sheet の canvas は preview 領域内でスクロールでき、中央ボタンドラッグでも scroll 位置を移動できます。倍率入力は 10-500% の percentage として扱い、mouse wheel で滑らかに変化させます。collision が `BOX` / `CIRCLE` の場合は、SGDK の collision size が frame の約 75% であることを踏まえて frame preview に overlay を出します。frame size は RESCOMP 制約に合わせ、tile 幅・高さが 32 未満、pixel では最大 248px までに制約してください。

Asset Manager の右列 preview でも SPRITE はシートそのものではなく、選択 ROW の animation を表示します。再生 / 停止は icon button にし、animation select の表示は `1 (4 frames)` のように簡潔にします。

### BMP / PNG palette の扱い

SGDK / ResComp 向け画像では、単に canvas へ描いて `canvas.toDataURL('image/png')` すると indexed palette が失われ、実際に使われている色だけで RGBA PNG へ再構成されます。未使用 palette、特に BMP の palette index 0 を保持したい場合、この経路を通してはいけません。

安全な方針:

- indexed PNG は `PLTE` / `tRNS` / `IDAT` を直接読んで palette と index を扱う
- indexed BMP は BMP ヘッダー、カラーテーブル、ピクセル index を直接読む
- BMP を PNG 化する場合は、BMP の index 0 を PNG palette index 0 に固定する
- 8bit BMP のようにカラーテーブルが256色でも、実使用 index が16色以内なら、使用 index だけを16色以内に remap して indexed PNG として保存できる
- 変換後に palette preview を見るだけでなく、保存されたファイルを再読込して `PLTE` / BMP カラーテーブルを確認する

リサイズやクリッピングを実施した場合は canvas 経由を避けられないことがあります。その場合でも、元画像が indexed PNG / BMP なら元 palette を参照 palette として保持し、最終的に自前の indexed PNG encoder で保存してください。`imageDataToIndexedPng()` のように実ピクセルから palette を作り直す関数は、未使用 palette を落とすため「最適化してよい画像」にだけ使います。

### resources.res の重複検査

同じ alias を複数行に登録すると、ResComp 後の assembler で次のようなエラーになります。

```text
Error: symbol `se_block_hit' is already defined
```

この状態はビルドログだけでは原因箇所が分かりにくいため、build plugin は ResComp 前に `assets` の `name` を集計し、重複があれば `{ ok: false, error }` を返してください。`lineNumber` / `resFileAbsolutePath` が取れる場合は、`resources.res:17` のように行番号付きで表示します。

### 画像・音声 preview

- 画像 thumbnail は「画像全体が見える」「アスペクト比を維持する」「領域内で最大化する」を満たす
- 一覧 thumbnail は `background-size: contain` か同等の処理を使う
- `cover` 相当の表示や `width:100%; height:100%` による引き伸ばしは禁止
- 小さい sprite も拡大表示する。`img` の `max-width/max-height` だけでは元サイズのまま小さく見える場合がある
- WAV preview は再生/停止の icon button にし、一覧では `HTMLAudioElement` の metadata などから再生長を表示すると確認しやすい
- 画像アセットでは、実画像から使用色を抽出し palette swatch として表示すると、SGDK の palette 制約を確認しやすい

### 複数 C ファイルを持つ build plugin

ゲームエンジンを複数 C ファイルで構成する build plugin は、`onBuildStart()` で `makeVariables.SRC_C` を明示します。

```js
function onBuildStart(payload, context) {
  return {
    ok: true,
    makeVariables: {
      SRC_C: [
        'src/main.c',
        'src/ball.c',
        'src/block.c',
        'src/player.c',
      ].join(' '),
    },
  };
}
```

注意点:

- `SRC_C` の明示は SGDK の wildcard compile による無関係な `src/*.c` 混入を防ぐ
- `src/boot/rom_head.c` は `SRC_C` に入れない
- `src/boot/sega.s` は `SRC_S` に入れない
- `src/boot/rom_head.c` はプロジェクト設定の ROM ヘッダー情報を反映する本体生成ファイルなので、build plugin の `syncEngine()` などでテンプレートからコピーして上書きしない
- SGDK 2.11 の `makefile.gen` は `src/boot/sega.s` を専用 rule で `out/sega.o` としてリンクする
- `out/sega.o` と `out/src/boot/sega.o` が同時にリンクされる場合、`rom_header` の multiple definition が起きる

### テストと確認

- plugin manager / renderer metadata / hook / build option の回帰は `pce-game-editor/tests/*.test.js` に追加する
- Windows では `node --test tests/**/*.test.js` より `node tests/run-tests.js` が安定する
- 変更後は `node --check <変更した .js>` と `cd pce-game-editor && node tests/run-tests.js` を実行する
- Build plugin を変更した場合は、可能なら実プロジェクトで generator 実行と SGDK build を通し、`out/cmd_` に不要な object が入っていないか確認する
- パッケージ済みアプリで確認する場合は、source tree の `pce-game-editor/plugins` と packaged tree の `resources/plugins` が同期しているか確認する

---

## 17. AI Control API

AI Control API の詳細は [AI_CONTROL.md](AI_CONTROL.md) を参照してください。

- Editor 内の `AI Control` タブで明示的に起動した場合のみ `127.0.0.1` に公開する
- REST と MCP は同じ tool registry を使い、`editor_status` / `asset_add` / `build_run` などの tool 名と引数を共有する
- project state を変更する tool は `dryRun: true` または `confirm: true` が必要
- MCP stdio sidecar は `scripts/pce-game-editor-mcp.js` で、`PCE_EDITOR_CONTROL_URL` と `PCE_EDITOR_CONTROL_TOKEN` を環境変数から読む
- stdout には MCP JSON-RPC メッセージだけを出し、診断ログは stderr に出す
