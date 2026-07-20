# PCE Game Editor — プラグイン開発ガイド

このドキュメントは、**PCE Game Editor** 向けのカスタムプラグインを開発する方を対象としています。  
現行の `plugin-manager.js`、`main.js`、`renderer/renderer.js` と組み込み manifest を基準に、マニフェスト定義、フック API、レンダラーモジュール、および renderer からの呼び出し方を解説します。

このリポジトリには manifest の世代を表す公開 `manifestVersion` はありません。本書は、アプリが現在検証している manifest フィールドだけを現行フォーマットとして説明します。

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

### 組み込みプラグイン

```
<app source>/plugins/<plugin-id>/
```

開発時はこの場所から読み込み、パッケージ済みアプリでは同じ内容が `<app resources>/plugins/` に配置されます。組み込みプラグインはアプリ配布物の一部であり、ユーザーが編集する場所ではありません。

### ユーザープラグイン

```
<userData>/plugins/<plugin-id>/
```

同じフォルダ名の組み込みプラグインがある場合は、有効なユーザープラグインが優先されます。ユーザー側の manifest が不正な場合は診断に表示し、同じ ID の有効な組み込みプラグインを隠しません。**Settings > Plugins** の「フォルダを開く」は、この書き込み可能なユーザープラグインフォルダを作成して開きます。

新しく検出したユーザープラグインは未信頼・無効状態で表示されます。有効化時に、renderer と main process code を実行してよいか確認ダイアログを表示します。明示的に信頼した後だけ実行でき、Settings > Plugins の「信頼を解除」で再び無効化できます。

ユーザープラグインの `index.js` は main process で実行され、Node.js とファイルシステムへアクセスできます。現在は process sandbox に隔離していないため、内容と入手元を確認したコードだけを信頼してください。

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
  "supportedCores": ["pc-engine"], // PCE プラグインでは必須
  "core": {                     // types: ["core"] の場合のみ使用
    "id": "pc-engine",
    "label": "PC Engine",
    "platform": "pce"
  },
  "hooks": ["onBuildStart"],   // 任意: 実装するフック名の一覧
  "permissions": [              // 任意: 使用する host 権限の宣言
    "project.read",
    "project.write",
    "dialog.openFile",
    "res.read",
    "res.write",
    "main.invokeHook",
    "build.configure"
  ],
  "roles": [                    // 任意: 単一選択 role の宣言
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
| `id` | `string` | ✅ | manifest 上の ID。現行 loader が実際の lookup に使う ID はフォルダ名なので、必ずフォルダ名と一致させること |
| `name` | `string` | ✅ | UI に表示される名前。空文字や未指定は manifest 不正となる |
| `description` | `string` | — | 設定画面に表示される説明文 |
| `version` | `string` | ✅ | 表示用のバージョン (例: `"1.0.0"`)。現行 loader は semver 検証を行わない |
| `hidden` | `boolean` | — | `true` の場合は catalog から完全に除外され、hook / role / renderer の通常ロード対象にもならない。`private` / `internal` も同じ扱い |
| `icon` | `string` | — | サイドバーなどで使う組み込みアイコン名。`assets` / `code` / `grid` / `sprite` / `music` / `play` / `bug` / `build` / `puzzle` など |
| `types` | `string[]` | ✅ | 空でないタイプ名の配列。複数タイプを持てる |
| `generator` | `boolean` | — | `generateSource` / `generateSourceAsync` を持つ plugin かを明示する。hook 専用 build plugin は `false` を推奨 |
| `supportedCores` | `string[]` | ✅ | PCE 専用は `["pc-engine"]`、ハード非依存は `["*"]`。それ以外、空配列、未指定は manifest 不正となる |
| `core` | `object` | — | `types` に `"core"` を含む core plugin の metadata。`id` / `label` / `platform` を持つ |
| `hooks` | `string[]` | — | 実装するフック名を列挙する（宣言のみ。実装は `index.js`） |
| `permissions` | `string[]` | — | 使用する host 権限の宣言。現在は表示・レビュー用途で、実行時の sandbox 強制はしない |
| `roles` | `Array<object|string>` | — | builder/testplay など、設定画面で単一選択する plugin role |
| `mainApi` | `object` | — | `hooks` は renderer から呼び出せる main hook の許可リストとして強制される。`capabilities` は現在 metadata として列挙されるだけで、main API 権限制御には使われない |
| `tab` | `object` | — | エディタにタブを追加する場合。[§9 参照](#9-タブ-ui-の追加-tab-オブジェクト) |
| `renderer` | `object` | — | renderer process 側の UI/capability を提供する場合。[§10 参照](#10-renderer-module) |
| `dependencies` | `string[]` | — | 依存プラグイン ID。[§8 参照](#8-依存関係の宣言) |

> **注意**: `id` はフォルダ名と一致し、`name` / `version` / `types` / `supportedCores` を必ず指定してください。不正な manifest と不足 dependency は Settings > Plugins の診断欄に理由を表示します。文字列単体の `"type"` フィールドは使用しません。

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

このアプリが公開する core は `pc-engine` だけです。現行テンプレートの `project.json` は `coreId: "pc-engine"` を持ち、`app.config.js` も `allowedCoreIds: ["pc-engine"]` に固定されています。

PCE 専用 plugin は `["pc-engine"]`、ハードウェア非依存 plugin は `["*"]` を宣言します。宣言がないpluginや別coreを指定したpluginはmanifest不正としてcatalogへ読み込まれません。

`pc-engine-core` は `types: ["core"]` と `core` metadata を持つ catalog 項目です。実際の project / setup / build routing は `core-manager.js` と `pce-*.js` が担当し、core plugin の `index.js` provider を動的に呼び出す仕組みではありません。

---

## 5. フック一覧

### `onBuildStart`

ビルド開始直前に呼び出されます。

```ts
// PCE build payload
{ projectDir: string, toolchain: string, toolchainPath: string | null }

// context
{ coreId: 'pc-engine', projectDir: string, assets: PceAsset[], logger: Logger }

// 戻り値
{ ok: boolean, error?: string } | void
```

`onBuildStart` が `{ ok: false, error }` を返すか例外になった場合、ビルド本体は実行せず失敗として終了します。組み込み builder の実際の生成・検証は `pce-build-system.js` が担当します。

### `onBuildLog`

ビルドプロセスからのログ行が届くたびに呼び出されます。

```ts
// payload
{ line: string, level: 'info' | 'warn' | 'error' | 'debug' }

// 戻り値
{ ok: boolean }
```

### `onBuildEnd`

ビルド完了（成功）後に呼び出されます。

```ts
// payload: pce-build-system.js の build result
{
  success: true,
  projectDir: string,
  romPath: string,
  elapsedMs?: number,
  targetMedia?: 'hucard' | 'cd',
  [key: string]: unknown
}

// 戻り値
{ ok: boolean, error?: string }
```

### `onBuildError`

ビルド失敗時に呼び出されます。

```ts
// payload
{ error: string, result?: object }

// 戻り値
{ ok: boolean }
```

### `getTab`

`code-editor` に残る旧 export です。現行 renderer は `manifest.tab` と `manifest.renderer.page` から sidebar/page を構築し、通常の画面遷移で `getTab` を呼びません。新規 editor plugin は `manifest.tab` と renderer module を使ってください。

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

`code-editor` に残る旧 export で、現行の page 切替からは自動呼び出しされません。page activation は renderer event の `page:activated` を購読します。

```ts
// payload: {}
// context: { logger: Logger }
// 戻り値: { ok: boolean }
```

### `onDeactivate`

`code-editor` に残る旧 export で、現行の page 切替からは自動呼び出しされません。必要な cleanup は `activatePlugin()` が返す `deactivate()` に実装します。

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

`context` には `coreId`、`projectDir`、`assets`、`logger` と、組み込みエミュレータープラグイン向けの `testPlay` host API が渡されます。

```ts
context.testPlay.openWasmWindow({ romPath, pluginId })
context.testPlay.getProjectConfig()
context.testPlay.launchExternalEmulator({ executablePath, args, romPath })
context.testPlay.getEmulatorStatus()
```

Test Play の表示崩れ、VDC / VRAM / SATB / palette の調査では、EmulatorJS の画面確認だけで判断せず、利用可能なら Geargrafx MCP を優先して使ってください。詳しい手順は `docs/pce-testplay-debugging.md` にまとめています。

### `generateSource` / `generateSourceAsync`

`build` タイプのプラグインがソースコードを生成するために実装します。  
フックではなく **ジェネレータ関数** として扱われ、`plugins:runGenerator` IPC から呼び出されます。

```ts
// 引数
assets: PceAsset[] // assets/pce-assets.json の正規化済み assets

context: {
  coreId: 'pc-engine',
  projectDir: string,
  assets: PceAsset[],
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
 * @param {Array<{id:string, type:string, name:string, source:string}>} assets
 * @param {{ projectDir:string, logger:object }} context
 */
async function generateSourceAsync(assets, context) {
  context.logger.info('generateSource 開始');

  const images = assets.filter((a) => a.type === 'image');
  if (images.length === 0) {
    return { ok: false, error: 'image アセットが見つかりません' };
  }

  const sourceCode = `#include <pce.h>\n/* ${images.length} image(s), generated by ${manifest.id} */\nint main(void) { for (;;) {} }\n`;
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
  coreId: 'pc-engine';
  projectDir: string;    // 現在のプロジェクトディレクトリの絶対パス
  assets: PceAsset[];    // assets/pce-assets.json から収集した asset
  logger: Logger;        // ログ出力オブジェクト
  testPlay?: TestPlayHostApi; // onTestPlay の場合
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

### ユーザー向けメッセージの二重出力ルール

Renderer プラグインのユーザー操作（保存、書き出し、インポートなど）が結果やエラーを表示する場合は、次の2経路へ同じ内容を出力します。

1. 操作画面のプラグイン専用ステータス／エラー領域へ、ユーザーがその場で確認できる短いメッセージを表示する。
2. `logger.info()`（成功・キャンセル）または `logger.error()` / `logger.warn()`（失敗・注意）へ、原因や修正箇所などの診断に必要な詳細を出力する。

キャンセルはエラー扱いにせず `info` とし、エラー領域にもエラー表示を残しません。非同期操作では、成功・キャンセル・失敗のいずれでも操作中のUIを必ず復元します。ログにはシナリオ本文などの不要な大きなペイロードや秘密情報を含めません。

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
- 依存するプラグインが存在しない場合は有効化全体が失敗し、状態を変更せず `ok: false` と `missingDependencies` を返します

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

現行フォーマットでは、main process の `index.js` とは別に renderer process 用 ES module を提供できます。
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

> 新規プラグインは本体の `renderer/renderer.js` や `renderer/index.html` へ追記せず、plugin 側 `renderer.js` の `activatePlugin()` 内で `root` / `pageRoot` / `hostRoot` に DOM を構築してください。converter のようにページを持たないプラグインにも `hostRoot` が渡されるため、独自モーダルや非表示 UI を本体 HTML に事前定義する必要はありません。

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
| `api.assets.inspectPceAdpcmBatch({ csvPath, sourceRoot? })` | ADPCM batch CSV を読み、行ごとの検査結果、上書き対象、推定 part 数、警告を返す。相対 `source` は任意の WAV root へ切替可能。asset は変更しない |
| `api.assets.importPceAdpcmBatch({ csvPath, sourceRoot?, batchId })` | 同じ WAV root で検査をやり直して有効行を順次変換・保存する。完了時に共有ストアを1回更新し、`assets:pce:changed` を1回発行する |
| `api.assets.cancelPceAdpcmBatch({ batchId })` | 実行中の ADPCM batch にキャンセルを要求する。現在行の変換・保存後に残りを未処理として終了する |
| `api.assets.inspectPcePsgJson({ sourcePath })` | `*.psg.json`を読み取り専用で厳格検査し、曲情報、構成、衝突ID、試聴用assetを返す |
| `api.assets.importPcePsgJson(payload)` | 検査を再実行し、ID・Name・Song/SFX・master volumeを反映して登録する。同一IDは`replace: true`が必須 |
| `api.assets.importPceVgm(payload)` | VGM / VGZ を PSG asset として取り込み、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
| `api.assets.importPceMidi(payload)` | MIDI を PSG asset として取り込み、成功時に共有ストアを更新して `assets:pce:changed` を発行する |
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

renderer から main process hook を呼ぶ場合は、`hooks` と `mainApi.hooks` の両方に hook 名を宣言してください。新規 plugin で本体 `main.js` / `preload.js` / `pce-build-system.js` の個別追記が必要に見える場合は、まず host API の不足として扱い、個別 plugin ID の分岐を本体へ追加しないでください。

### Asset 関連 capability

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

音声変換UIは `audio-convert-ui` capability の `openAudioConvertModal()` を使い、WAVの `dataUrl` と変換metadataを呼び出し元へ返します。PCE assetへの保存は呼び出し元が `api.assets.importPceAudio()` で行います。一時ファイル用APIや汎用 `writeAssetFile()` は公開していません。

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
// PCEまたは共有coreを宣言したプラグイン一覧を取得
const plugins = await window.electronAPI.listPlugins({ includeIncompatible: false });
// => Array<PluginInfo>

// 特定プラグインの renderer asset を取得
const assets = await window.electronAPI.getPluginRendererAssets('my-plugin');
// => { ok: boolean, renderer?: object, rendererAssets?: object, error?: string }

// 単一選択 role の現在値を取得/保存
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

### VN Irodori-TTS バッチ出力 API

組み込み Novel editor は、現在の正規化済み scene document と予約済み asset ID を専用 IPC へ渡し、Irodori-TTS 用の話者別 CSV、Message対応表、ADPCM一括取込CSVを1つの ZIP に保存できます。保存先は main process のダイアログでユーザーが選び、renderer から任意パスを直接指定することはできません。

```js
const result = await window.electronAPI.exportVnIrodoriBatch({
  doc: normalizedSceneDocument,
  assetIds: assets.map((asset) => asset.id),
});
// {
//   ok: boolean,
//   canceled: boolean,
//   path: string,
//   speakerCount: number,
//   messageCount: number,
//   jobCount: number,
//   error: string
// }
```

IPC channel は `vn:exportIrodoriBatch` です。`doc` からはスキップされていない本文ありの `message` だけを抽出します。既存 `voiceAssetId` は `[A-Za-z0-9_-]{1,48}` を要求し、未指定行には `assetIds` と衝突しない `voice_NNNN` を割り当てます。ZIP は `batches/*.csv`、`manifest.csv`、`output/adpcm-import.csv` を含みます。ADPCM CSV は一意なTTSジョブごとに `source,id,name,sampleRate,loop,splitPolicy` を持ち、相対 `source` は `<speaker-folder>/<id>.wav`、既定変換値は `8000,false,auto` です。低レベルexport API自体はscene documentやasset documentを書き換えませんが、Novel editorの「音声バッチ出力」はZIP保存成功後に、渡した同じscene snapshotを `assets/pce-vn-scenes.json` へ保存します。

生成済みADPCMをMessageへ戻す検査APIは次のとおりです。ファイル読込とCSV検査はmain processで行い、sceneの変更・保存はrendererが確認後に行います。

```js
const assignmentInspection = await window.electronAPI.inspectVnIrodoriVoiceAssignments({
  manifestPath: '/absolute/path/manifest.csv',
  doc: normalizedSceneDocument,
  assets: assets.map(({ id, type }) => ({ id, type })),
});
// IPC: vn:inspectIrodoriVoiceAssignments
// => { ok, rows, assignments, summary, inspectionSignature, ... }
```

`manifest.csv` は `id,speaker_kind,speaker,scene_id,command_index,text` を必須とし、追加列を許可します。各行は scene ID、1-based command index、Message種別、skip状態、正規化済み話者・本文、asset ID/typeを厳密照合します。同一位置・同一内容の重複は集約し、異なる内容は関係行をすべてerrorにします。完全一致する単一ADPCMだけを `assignments` に含め、`<id>_partNN` だけがある分割音声、欠落asset、移動・編集されたMessageはskip、非ADPCM同名assetはerrorです。rendererは確認後に同じmanifest/doc/assetsを再検査し、`inspectionSignature`が変わった場合は適用せず最新一覧を再表示します。

### PCE asset API

PC Engine core のプロジェクトでは、PCE asset manager 用の安全な project-local IPC を利用できます。

画像表示、スプライト表示、ADPCM 再生、CD-DA 再生を実装する場合は、より実装寄りの流れを `docs/pce-media-programming-guide.md` にまとめています。ここでは IPC の入口だけを示します。
renderer plugin から asset を読む・変更する場合は、共有ストアと変更通知を扱う `api.assets.*` を優先してください。`window.electronAPI.*Asset*` は低レベル IPC として残しています。
Image プラグインの BG 追加 UI では `paletteBank` / `transparentIndex` を表示せず、互換用 metadata として `0` 固定で渡します。Sprites 追加 UI でも `paletteBank` / `tileBase` / `x` / `y` / `transparentIndex` と初期 animation 詳細は通常表示せず、既定値で登録します。変換時だけ有効な `Cell size` は追加 modal の `アドバンス` に隠し、既存 asset では生成済み pattern と metadata がずれないよう通常の Properties からは編集しません。`tileBase` / `x` / `y` は有効な低レベル既定値として Sprites タブの `アドバンス` に隠します。

HuCard slideshow template は builder role に `pce-slideshow-builder` を使います。BG 画像アセットのうち ID が `slide_001` または `slide_001_title` の形式に一致するものだけをビルド時に採用します。番号は `001` から連番で、出力順は番号順です。対象画像は保存済み PNG、8px アライン、256x224px 以下であることを build 時に検査し、生成済み palette / tiles / map が欠けている場合や HuCard の 127 ROM bank を超える場合は build error にします。命名規則に合わない画像は slideshow には入らず、VN/CD-ROM2 build の未使用 asset 除外とは別の HuCard sample 専用ルールです。`psg-song` / `psg-sfx` は画像の連番選別後も同梱でき、テンプレート runtime は先頭の `psg-song` を BGM としてループ再生します。操作は `←` で前の画像、`→` またはその他のボタンで次の画像へ即時遷移し、入力がない場合も従来どおり一定時間で次の画像へ進みます。新規 slideshow project の `pluginSettings.enabled` は `novel-editor` と `sound-editor` を `false` にし、不要な sidebar plugin を開かない既定です。

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
  sampleRate: 8000,
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
  defaults: { sampleRate: 8000, mono: true },
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

// CSV を検査してから ADPCM を一括登録する
const inspection = await window.electronAPI.inspectAssetAdpcmBatch({
  csvPath: '/absolute/path/voices.csv',
  sourceRoot: '/absolute/path/irodori-output', // 省略時はCSV所在folder
});
const batchId = `voice-batch-${Date.now()}`;
const offProgress = window.electronAPI.onAssetAdpcmBatchProgress((progress) => {
  console.log(progress.batchId, progress.completed, progress.total, progress.status);
});
const batchPromise = window.electronAPI.importAssetAdpcmBatch({
  csvPath: inspection.csvPath,
  sourceRoot: inspection.sourceRoot,
  batchId,
});
// 別のUI eventから止める場合は、現在行の完了を待って残りが中止される。
// await window.electronAPI.cancelAssetAdpcmBatch({ batchId });
const batchResult = await batchPromise;
offProgress();

// 1曲入りの手作りPSG JSONを検査し、必要なら明示的に置換して登録する。
const psgJsonInspection = await window.electronAPI.inspectAssetPsgJson({
  sourcePath: '/absolute/path/clubroom_day.psg.json',
});
const importedPsgJson = await window.electronAPI.importAssetPsgJson({
  sourcePath: psgJsonInspection.sourcePath,
  id: psgJsonInspection.asset.id,
  name: psgJsonInspection.asset.name,
  type: psgJsonInspection.asset.type,
  volume: psgJsonInspection.asset.options.volume,
  replace: psgJsonInspection.collisionIds.includes(psgJsonInspection.asset.id),
});

// MIDI を PSG pattern へ近似変換して登録する。midiOptions は省略可能。
const importedPsg = await window.electronAPI.importAssetMidi({
  sourcePath: '/absolute/path/song.mid',
  id: 'song_psg',
  name: 'song/psg',
  bpm: '', // 空欄なら MIDI の先頭 tempo を使う
  type: 'psg-song',
  midiOptions: {
    maxToneVoices: 4,
    drumMode: 'soft', // "off" | "soft" | "full"
    toneVolumeScale: 100,
    drumVolumeScale: 35,
    minVelocity: 8,
    voicePriority: 'melodyBass', // "melodyBass" | "high" | "low" | "loud"
    patternDetail: 'auto', // "auto" | "full" | "half" | "quarter" | "eighth"
    timbreMode: 'gm-family', // "gm-family" | "legacy-square"
    // GM program 1-8, 9-16, ... 121-128 に対応する System Card wave 0..45
    programWaveMap: [9, 22, 20, 5, 10, 8, 13, 14, 11, 1, 35, 6, 30, 24, 21, 28],
  },
});

// 同じ MIDI 変換設定で保存前の PSG preview data だけを作る。
const midiPreview = await window.electronAPI.previewAssetMidi({
  sourcePath: '/absolute/path/song.mid',
  type: 'psg-song',
  midiOptions: { maxToneVoices: 4, drumMode: 'soft' },
});

// project root 内の asset source だけを Data URL 化する
const preview = await window.electronAPI.previewAssetSource('assets/images/title_bg.png');

// pce-assets.json の順序を保存する
await window.electronAPI.reorderAssets(['title_bg', 'hero_sprite']);
```

`previewAssetSource` と `reorderAssets` は絶対パス、`..`、symlink escape を拒否します。`importAssetImage` / `importAssetAudio` / `inspectAssetPsgJson` / `importAssetPsgJson` の `sourcePath` は読み取り元として dialog 由来の絶対パスを許可しますが、保存される `source` / generated file path は必ず project 相対です。BMP / WebP は renderer 側で PNG Data URL (`convertedDataUrl`) に変換してから import します。MP3 入力は renderer の `audio-convert-ui` で WAV Data URL へ加工してから `importAssetAudio({ dataUrl, sourceFileName, originalFileName, processing })` に渡します。

ADPCM で `splitPolicy: "auto"` を指定すると、変換後の ADPCM が runtime 側の direct-buffered 安全上限を超える場合に `<id>_part01`, `<id>_part02`, ... の独立 asset として分割登録します。上限は `min(32767, 65536 - adpcmAddress)` bytes です。分割 asset は自動連続再生されないため、scene/message から必要な part を個別に参照してください。

#### ADPCM batch CSV 契約

Sound > ADPCM の `CSV一括` と統合 Assets の `AD CSV` は同じ batch importer を使います。CSV は UTF-8 または UTF-8 BOM の RFC 4180 形式で、CRLF / LF、引用符内のカンマ、`""` による引用符 escape に対応します。header 順は任意ですが、未知・重複 header は typo として CSV 全体のエラーになります。`source` の相対パスは既定でCSV自体のfolder、`sourceRoot`指定時はそのWAV rootを基準に解決し、絶対パスは常にそのまま使います。確認画面の「WAVルート（任意）」からfolderを選び直すと、同じCSVを新しいrootで再検査します。

| 列 | 必須 | 契約 |
|---|---:|---|
| `source` | 必須 | PCM WAV (`.wav`)。mono / stereo、8 / 16 / 24 / 32-bit PCM。MP3 は不可 |
| `id` | 必須 | `[A-Za-z0-9_-]{1,48}`。不正文字の暗黙置換はしない |
| `name` | 任意 | 空なら WAV basename。`voice/chapter1/line001` のような `/` group 名を許可 |
| `sampleRate` | 任意 | 既定 `8000`。`4000,4571,5333,6400,8000,10666,16000,32000` のいずれか |
| `loop` | 任意 | 既定 `false`。`true` / `false` / `1` / `0` |
| `splitPolicy` | 任意 | 既定 `auto`。`auto` は 32767-byte 単位で独立 part 化し、`error` は超過行を失敗にする |

```csv
source,id,name,sampleRate,loop,splitPolicy
voices/akari/line001.wav,akari_001,voice/akari/line001,8000,false,auto
"voices/mika/line,002.wav",mika_002,voice/mika/line002,10666,0,error
```

CSV 内で同じ `id` が複数行にある場合、または自動分割後の `<id>_partNN` が別行の出力 ID と衝突する場合は、順序に依存させず関係する行をすべてエラーにします。既存の同一 ID / group の ADPCM は確認なしで置換し、画像・sprite・PSG・CD-DA など非 ADPCM との ID 衝突はその行だけ失敗します。`type`、`adpcmAddress`、`divider`、`stream` は CSV 列にせず、address は `0`、divider は sample rate から自動計算します。trim、normalize、音量、fade 等は事前に WAV へ反映してください。

検査結果にエラー行があっても、有効行が1件以上あれば実行できます。実行時は行順に変換し、成功行ごとに `assets/pce-assets.json` へ確定してから次へ進みます。失敗行やキャンセル以前の成功は保持されます。戻り値の `results[]` は `lineNumber`, `id`, `status`, `errors[]`, `warnings[]`, `assetIds[]` を持ち、`summary` は成功・失敗・未処理行数と登録 asset / part 数を持ちます。登録 metadata の `data.import.batchFileName` / `batchRow` には CSV basename と行番号だけを保存し、CSV 本体や絶対パスは project へ保存しません。取込後の ADPCM が512件を超えても登録は続行しますが、CD VN の標準上限を超える警告を返し、build 時の参照数制約は別途適用されます。

公開境界は IPC `assets:inspectAdpcmBatch` / `assets:importAdpcmBatch` / `assets:cancelAdpcmBatch`、progress event `assets:adpcmBatchProgress`、preload `inspectAssetAdpcmBatch()` / `importAssetAdpcmBatch()` / `cancelAssetAdpcmBatch()` / `onAssetAdpcmBatchProgress()` です。inspect/import payloadの任意 `sourceRoot` は必ず対で渡してください。renderer plugin は共有 cache と変更通知を保つため、取込には host の `api.assets.inspectPceAdpcmBatch()` / `importPceAdpcmBatch()` / `cancelPceAdpcmBatch()` を使ってください。

ADPCM の `divider` は再生速度の rate code です。取り込み時は、`divider` 未指定なら `32000 / (16 - code)` が `sampleRate` に最も近い `0..15` の code を自動計算し、代表値は `32000Hz -> 15`, `16000Hz -> 14`, `8000Hz -> 12`, `4000Hz -> 8` です。エディターUIでは現行の入力範囲で実機rate codeに対応する `4000`, `4571`, `5333`, `6400`, `8000`, `10666`, `16000`, `32000` Hz から選択します。`divider` を明示した場合は保存値をそのまま使い、runtime 側でも旧式値としての補正は行いません。direct-buffered playback で安定して鳴らせる 1 asset / part の長さは `min(32767, 65536 - adpcmAddress)` bytes、つまり `bytes * 2 / sampleRate` 秒が目安です。`adpcmAddress: 0` なら 16000Hz で約 4.09 秒、8000Hz で約 8.19 秒です。`assets/generated/<id>/adpcm.bin` は OKI/MSM5205 互換 4-bit adaptive data を高位 nibble 先 (`msn-first`) で保存します。旧 `pce-cd-adpcm-experimental`、古い `lsn-first`、nibble order 未記録、または `encoderVersion` が古い generated file は、source WAV が残っていれば build/source 生成時に自動再生成されます。
ADPCM の true CD streaming (`pce_cdb_adpcm_stream`) は VN runtime / editor 機能から削除しました。ADPCM は常に ADPCM RAM へ読み込んでから buffered direct playback します。長い音声は `splitPolicy: "auto"` で分割する、sample rate を下げる、または CD-DA を使ってください。安全上限を超える ADPCM asset は build error になります。

`assets/pce-assets.json` の v2 画像/音声タイプは `image` (BG), `sprite`, `palette`, `psg-song`, `psg-sfx`, `adpcm`, `cdda-track` です。旧 `psg-sequence` は読み込み時に `psg-sfx` として正規化されます。PCE/CD-ROM2 は `llvm-mos-sdk` 固定で扱い、IPL / System Card は Setup でユーザー所有ファイルを指定します。

MIDIからPSGへ取り込む場合、`midiOptions`でvoice削減、drum noise、velocity threshold、pattern detail、音色割り当てを調整できます。`timbreMode: "gm-family"`は発音開始時のMIDI Program Changeを16個のGM familyへまとめ、`programWaveMap`の対応するSystem Card wave番号をpatternの`wave`へ保存します。wave `0..44`はSystem Card内蔵、`45`はエディタが登録する32-byte squareです。`legacy-square`は全toneを45へ統一します。previewは同じoptionsでstep sourceを返します。CD VNはこのsourceをSystem Card packageへcompileし、BGM 8156 bytes/SFX 8192 bytesの最終byte上限で検査します。HuCardは`wave`を無視して既存step/event上限とsquare toneを維持します。WebAudio previewは内蔵wave番号ごとの大まかなsine/saw/triangle/square近似であり、System Cardの32-sample波形や実機mixを完全再現しません。

BG の `tileBase` / `mapBase` は PCE asset manager 側で自動管理されます。CD-ROM2 VN runtime の 32x32 BAT を `mapBase: 0` に置き、BG tile は BAT の後ろ (`tileBase: 128`) に配置するため、UI ではこれらをユーザー選択させません。古い asset に値が残っていても読み込み・生成時に BG は自動値へ正規化されます。

CD-ROM2 VN build は asset catalog を常に使います。標準保証ラインは、VN から参照される BG / Sprite / ADPCM / PSG が各 512 件までです。`pce_editor_*_asset_count` と `pce_editor_meta_region_t.count` は `unsigned int` とし、runtime は scene command の signed index を `0..count-1` で検証してから使います。CD-DA は物理 track の制約により track 2..99（最大 98 本）だけを有効とし、track 2 から欠番なしの連番にします。重複または欠番のある track は、標準 EmulatorJS/WASM core が CUE をゲームディスクとして認識できないため build error です。Catalog では BG / Sprite / ADPCM に加えて PSG / CD-DA metadata も `assets/generated/meta/asset_meta.bin` へ置き、runtime は BG descriptor 8 枠（direct-mapped）、Sprite descriptor 4 枠の metadata cache で小さな catalog 再読込を抑えます。短い PSG SFX も pattern CD data file として扱います。詳細は `docs/pce-asset-meta-cd-ondemand.md` を参照してください。

`targetMedia: "cd"`のPCE VN buildはgenerated image/sprite/ADPCM、scene pack、overlay/helper、System Card PSG packageを`cd.dataFiles`へ登録します。CD font payloadは登録しません。bank132には小さいgenerated metadata、CD scratch、`EX_GETFNT`から変換した68-glyph message cacheだけを置きます。data fileのstable orderはoverlay、visual/async helper、asset catalog、scene/payload、System Card PSG packageです。

CD runtimeはmessage開始時にShift-JIS word列をbank123から最大68 glyph/136 bytesだけconsole RAMへdetachし、`EX_GETFNT` 12×12の32-byte出力を24-byte maskへ変換してbank132 cacheへ保存します。compositorはこのcacheを使い、VRAM glyph readbackを行いません。`spritetext`も`EX_GETFNT` 12×12を使い、2pxの透明余白を持つ16×16 hardware sprite patternへon-demand 4bpp化して、本文と同じ横12px・縦16pxピッチで配置します。改行は`0xFFFE`、終端は`0xFFFF`で、文字payloadはすべて16-bitです。

各 scene pack は pointer を持たない little-endian / offset ベース形式で、runtime は scene 入場時に active cache (`4096` bytes) へ読み込みます。明示的な `preload` command は削除済みです。読み込み最適化は scene 入場時の内部 preload が担当します。VN build は各 scene pack をその scene が参照する BG/Sprite/ADPCM data file より前に並べ、build は IPL program の後ろへ padding file を挟み、最初の data file が固定の CD sector 64 から始まるように配置します。padding のサイズは固定ではなく、ELF build 後に `pce-mkcd -v` でプログラム像の実セクタ数を測定し `PCE_CD_DATA_BASE_SECTOR(64) - (program 終端 sector)` で算出します（`finalizePceCdDataPadding()`）。font tiles を bank132 から CD data file へ移すなどで program 像のサイズが変わっても、埋め込んだ sector 64 と実 ISO 配置を一致させ続けるためです。固定 padding のままだと program 縮小で data が前倒しになり、`pce_vn_font_data` 等の sector 参照がずれて全画面 BAT が壊れた glyph で埋まります。

runtime は scene 入場時に script pack を active cache へ読み、暗転中なら最初の待ちコマンドまでに必要な BG/Sprite/ADPCM だけを active cache から先読みし、表示 command では固定 VRAM 領域へ反映します。さらに generator は voice 付き `message` の直前へ内部 `Cache Load ADPCM` を挿入し、手動で同じ ADPCM の cache load が直前にある場合だけ重複を避けます。ボタン待ち message の完了待機中には、次の ADPCM cache load を先取りしません。`background` / `sprite` 表示 command は、VRAM/BAT/SATB 反映、必要な暗黙 fade、表示 layer の再有効化まで完了してから次 command へ進む同期 command です。CD-DA と CD data read は同時に行えないため、script pack や画像/sprite/ADPCM の CD data file を読む場合は runtime が CD-DA を `pce_cdb_cdda_pause()` で止めます。CD-DA を維持したい scene では、BG/Sprite command を CD-DA の前に置いてください。ADPCM 読み込みに失敗した場合はロード済みにせず再生もしません。再生前に ADPCM metadata を local snapshot へコピーし、BIOS helper 後に MPR が変わっても length/divider/sector を読み間違えないようにします。Message voice は build 時点で buffered-only に制限され、可視 glyph を描く前に buffered direct playback を開始します。buffered playback は `pce_cdb_adpcm_play()` を使わず、ADPCM hardware に長い length (`0xffff`) を latch して開始し、runtime が frame counter で数 frame 早く direct stop / loop restartします。true CD streaming への runtime fallback はありません。長い message voice は `splitPolicy: "auto"` で 32767 byte 以下の part に分ける、sample rate を下げる、または CD-DA へ逃がしてください。

CD-DA と visual payload の補足: 上記の pause は CD data read 区間の制約です。raw BG/Sprite payload は、1 sector の CD read が終わるたびに CD-DA を再開し、`cd_transfer_scratch` または visual RAM cache から VRAM/BAT へ書き込む間は pause を引きずらないようにします。RAM→VDC data port 転送は HuC6280 の TIA block transfer を使います。PSG 再生中は VRAM 転送を約32 byteごとに区切り、slice ごとに PSG service と MPR 復帰を挟みます。CD settle の補償 tick は PSG 専用で、ADPCM の再生残フレームは実 VBlank credit だけで減らします。PSG が鳴っていない場面では 1 sector までまとめて転送し、full-width BG map は行ごとの 64 byte copy ではなく連続 BAT copy にして、Image command の反映時間を短縮します。BG/Sprite の `cache load` は実験版として低位 System Card RAM へ payload を先読みしますが、VRAM/BAT/SATB へ反映するのは `background` / `sprite` command 実行時だけです。

VN scene commandは`cache`を持てます。`clear`はruntimeの読み込み済み判定だけを無効化し、VRAM/BAT/SATB、ADPCM controller、再生中CD-DA/PSG、active scene pack、変数を破壊しません。CDの`psg`はBGM/SFXそれぞれのloaded package key、`all`はこれにBIOS message glyph cacheを加えます。command recordは19 bytesのままです。

`load`は1 commandにつき1 assetです。CDの`scope: "psg"`は`assetId`と`channel`でSystem Card package variantを選び、BGMならbank134、SFXならbank135へ先読みします。同じbusで別packageを再生中にpreloadするsceneはgeneratorがvalidation errorにします。ADPCM/BG/Spriteの既存load契約は維持します。

メッセージ開始時の window clear と初回全文表示（速度0など）は、208 タイル以上のメッセージ帯 VRAM を連続更新するため、runtime がメッセージ窓 BAT だけを一時的に blank tile へ向けてから実行し、完了後に次の VBlank で strip BAT へ戻します。表示途中のボタンスキップでは窓を blank にせず、現在の glyph cursor から残りの文字を連続描画して既存テキストを消さないようにします。typewriter 中の通常の 1 glyph 更新は、bank133 overlay dispatcher の IRQ guard と glyph mask cache を使って短い VDC 更新に抑えます。ボタン送り待ちの完了ページでは、4 行目の最後の 1 セルを予約し、本文の代わりに `▼` を点滅表示します。このため message 本文は 1〜3 行目が 17 文字、4 行目が 16 文字として折り返されます。自動送りメッセージでは `▼` は表示しません。

**Windows 固有: `pce-mkcd.exe` は MinGW ランタイム DLL に依存します。** llvm-mos-sdk の LLVM 系ツール（clang / ld.lld / llvm-objcopy）は静的リンクですが、`pce-mkcd.exe` だけは MinGW-GCC ビルドで `libstdc++-6.dll` / `libgcc_s_seh-1.dll` / `libwinpthread-1.dll` を動的に必要とします。SDK はこれらを exe の隣に同梱しないため、実行時は PATH から解決されます。ターミナル（Git Bash / MSYS2 等）の PATH には互換 DLL があり動きますが、**Electron の PATH には無いことが多く、見つからない (exit `0xC0000135`) か、ABI 非互換の DLL をロードして実行時にクラッシュ (exit `0xC0000005` = `3221225781`) します**（macOS は該当依存が無いため起きません）。DLL 検索は exe と同じフォルダが PATH より優先されるため、build は mkcd 実行前に `ensurePceMkcdRuntimeDlls()`（[pce-build-system.js](pce-build-system.js)）で、これらが exe の隣に無ければ MinGW/MSYS2/Git の bin から**完全な一組だけ**を選んでコピーします。コピー元が見つからない場合は cryptic な segfault でなく、DLL を `pce-mkcd.exe` と同じフォルダに置くよう促す明確なエラーを出します。

**Windows 固有: `ld.lld.exe` が Application Control に拒否される場合があります。** `clang.exe` は起動できても、linker の `ld.lld.exe` だけが Windows Application Control / Smart App Control / WDAC により `Application Control policy has blocked this file` で停止することがあります。この場合は HuCARD / CD-ROM2 どちらの build も link できません。build は compile 前に `ld.lld.exe --version` を preflight し、起動できない場合は project / C source のエラーと区別して `llvm-mos linker を起動できません` を返します。対処は Windows 側でその `ld.lld.exe` を許可するか、SetUp で実行可能な `llvm-mos-sdk` を指定することです。

**VRAM 領域の排他予約（VN build）。** PCE VRAM は 32768 word の単一空間で、BAT(0–1024)、BG タイル、メッセージフォント/グリフマスク、spritetext フォント、スプライト pattern、SATB(0x7f00–) を各々独立規則で配置します。これらが重なるとレイアウトが破壊されるため、`generateVnSources()` は `validateVnVramLayout()`（[pce-vn-manager.js](pce-vn-manager.js)）で全領域を word range に展開し、**異なるカテゴリ間の重なりを検出したら build error**で停止します（どの 2 領域が word いくつで重なるかを表示し、同じ配置形状へ至る複数scene pathの同文は1件にまとめます）。BG 同士は `background` ごとに差し替えるため同カテゴリ内の重なりを許容し、BG カテゴリは所属 asset の union extent で判定します。CDのspritetextフォントは固定64 glyph分ではなく、compiled sceneが参照する固有glyph数（runtime上限64）だけを予約し、generated `PCE_VN_FONT_SPRITE_GLYPH_CAPACITY`をruntime cacheの上限にも使います。spritetext fontとSLOT別sprite patternは、同時表示時に重ならない2通りの並びをbuild時に比較し、VRAM high-water markが低い順序へpackします。scene path解析で各SLOTに登場する最大asset容量を`PCE_VN_SPRITE_SLOT0_PATTERN_BASE/CAPACITY`〜`SLOT3`として固定予約し、sprite palette bankもassetの`paletteBank + SLOT番号`へ固定するため、別SLOTの差し替えでpattern/palette配置を移動しません。SLOT別最大容量の合計がSATBへ届く構成、またはpalette bankがspritetext予約bankへ届く構成はbuild errorです。重なった場合はBG/スプライト/メッセージのいずれかを縮小するかfont tileBase/paletteBankを調整してください。

**BG/Sprite の visual payload は常に無圧縮（raw）です。** 以前あった RLE 圧縮（`tiles.rle` / `map_vram.rle` / `patterns.rle` sidecar）と `options.compression` オプション/UI は撤去しました。RLE streaming デコーダが VDC の書き込みアドレスを CD 読み込みを跨いで保持して BG 破壊の原因になり、かつ bank133 overlay の約 87% を占めていたためです（dithered 写真 BG では RLE が ~13% しか効かず CD 増分も軽微）。変換は raw の `tiles.bin` / `map_vram.bin` / `patterns.bin` だけを生成し、`cd.dataFiles` と generated C metadata は常にこの raw を参照します（`pce_editor_cd_data_ref_t.compression` は常に `0`=NONE）。runtime は CD sector を `cd_transfer_scratch` へ 1 セクタずつ読み、resident/noinline かつ IRQ guard 付きの `pce_editor_vram_copy()` で VRAM へ転送します（MAWR を CD 読み込みを跨いで保持せず、MAWR 設定から VRAM data 転送までは IRQ を mask）。CD-ROM2 ではこの helper が HuC6280 の TIA block transfer で `cd_transfer_scratch` / generated data から VDC data port へ送ります。PSG 再生中は従来どおり約32 byte sliceで cooperative service を挟み、PSG が鳴っていない場面は最大 1 sector の大きい slice と full-width BG map の連続 BAT copy で Image command 反映を短縮します。この helper は SDK の `pce_vdc_set_copy_word()` を使わず、R5 high byte の DRAM refresh / VBlank status latch bit を維持します。`write_map_words()` の BAT 行更新も同じ helper を通ります。`pce_editor_cd_data_ref_t` は bank128 の常駐 `.rodata` を圧迫しないよう bank132 に置きます。旧プロジェクトに残る `.rle` / `compression: "auto"` メタは無視され（raw を使用）、再生成時に NONE へ正規化されます。

ADPCM は CD 上の payload を bank122 の direct CD/SCSI async helper で ADPCM RAM へ流し込み、32767 bytes 以下の buffered playback は System Card BIOS の `pce_cdb_adpcm_play()` を使わず direct ADPCM latch / direct stop で制御します。direct latch は ADPCM read address / `0xffff` length / divider を設定し、runtime が generated `play_frames` で PLAY bit を落とすか loop restart します。実データ長を hardware length に入れると通常再生の中間地点で ADPCM half IRQ (`0x04`) が立ち、Geargrafx では System Card IRQ path が VDC/PSG state を壊すため使いません。安全上限超過は build/import 時に分割または error とし、true CD streaming へ fallback しません。CD から ADPCM RAM へ読む場合、runtime は `vn_wait_next_vblank_raw()` + `engine_service()` + `vn_cd_async_service_frame()` の loading frame で SCSI DATA IN を `IO_PCD_ADPCM_DATA` へ書き、async data phase 中は System Card BIOS helper / external IRQ / `quiet_cd_unit_irqs()` を使いません。message 開始時に cache miss した場合だけ、可視 glyph を描く前に同じ direct async path で ADPCM RAM へ読み込みます。自然終了監視では System Card BIOS の ADPCM status polling に頼らず、generated catalog の `play_frames` で one-shot / buffered loop の終了や再発行を管理します。標準 EmulatorJS/WASM core では buffered ADPCM one-shot の完了IRQで CPU が止まることがあるため、buffered 再生中の CD unit IRQ / System Card pending latch は runtime 側で消します。ADPCM 再生開始後は次の joypad edge 判定を一度だけ初期化します。暗転中 preload では意図した暗転を維持します。VN の audio command は buffered direct playback を開始したら待ち状態を返さず次の command へ進みます。ただし未 preload の通常 ADPCM は、再生開始前の ADPCM RAM 読み込みだけ同期的に完了待ちします。

ADPCM のデータ/再生経路切り分けには `samples/pce-adpcm-diagnostic` を使います。`node scripts/pce-adpcm-diagnostic.js analyze <source.wav> <adpcm.bin> <sampleRate>` は generated ADPCM を OKI/MSM5205 と旧実験形式、low/high nibble first の各組み合わせで decode し、元 WAV との RMS error、SNR、correlation を出します。`node scripts/pce-adpcm-diagnostic.js build` は VN runtime を通らず BIOS の ADPCM helper だけを呼ぶ最小 CD-ROM2 ISO を作ります。`I` は high-nibble-first buffered、`II` は low-nibble-first buffered、`SELECT` は停止です。

CD-ROM2 RAM bankの標準ルールは`docs/pce-memory-bank-strategy.md`を正とします。bank123/MPR6は8192-byte active scene pack、bank128/129/130はresident codeとSystem Card adapter、bank132はgenerated metadata/CD scratch/変換済みglyph cache、bank133はPath B overlay、bank134はSystem Card main/BGM、bank135はsub/SFXです。bank124-127は未使用、bank131はSystem Cardがslot5で使うため使用禁止です。bank121のvisual helper、bank122のdirect async helper、bank104-119のvisual payload cacheは既存配置を維持します。CD VNは`font.bin`/`font_sprite.bin`/旧PSG patternを生成せず、scene pack・画像/sprite/ADPCM・System Card PSG packageをCD data fileとして扱います。link後はbank123/134/135の8KB NOLOAD、console RAM`<=0x1200`、空き`>=2026` bytes、ZP`<=$20E6`、各code bank`<0x2000`をhard gateで検査します。

PCE background conversion は、入力画像の各 8x8 cell を表示順の tile としてそのまま出力します。同一内容の tile を dedupe しないため、VN の背景切替では絵が過度に共通タイル化されず、raw の `tiles.bin` は `width / 8 * height / 8 * 32` bytes を基準に扱われます。CD-ROM2 でも visual payload は raw の `tiles.bin` / `map_vram.bin` / `patterns.bin` を使い、表示 command 実行時に CD→scratch→VRAM へ chunked 転送します。同一SLOTへ別sprite assetをロードする場合は、runtimeがそのSLOTの旧SATB entryだけを画面外へ逃がしてから、SLOT専用pattern VRAMとpaletteを転送し、完成したSATBを反映します（PCEではゼロSATB entryも実spriteなので、無効化には使いません）。**sprite pattern は background tile と違い、同一内容の表示 cell block を dedupe します。** 変換時に sheet の `cellWidth` × `cellHeight` cell を比較し、ユニークな block だけを `patterns.bin`（= VRAM 転送本体）へ詰めます。16×16 cell は 128 byte の pattern 1 個、32×64 cell は 16×16 pattern 8 個が連続した block になります。各 positional display cell → ユニーク block slot の対応表を `cellmap.bin`（1 byte/cell）として出力します。`generated.tileCount` / `vramBytes` は dedupe 後の 16×16 pattern 数 / byte 数で算出し、`pce_editor_sprite_asset_t.cell_map` に `cellmap.bin` を resident 配列として埋め込みます。runtime の `show_character_sprite_frame()` は positional display cell を `cell_map[]` 経由で VRAM slot へ解決するため、目パチ・口パクなど frame 間で共通する cell block が 1 枚に畳まれ、VN の VRAM 予算（message tile・font mask・SATB を除いた残り）に大きな多 frame sheet を収められます。ユニーク block が 256 を超える sheet は build error（cell map は 1 byte index 上限）。

sprite pattern 領域は SATB (`0x7f00`) より手前に収めます。asset metadataの`tileBase`（既定`704`）は単体変換用の低レベル値ですが、VN runtimeの実配置開始位置`PCE_VN_SPRITE_PATTERN_BASE`とspritetext font開始位置はbuildごとに同時算出します。通常はメッセージ/spritetext領域の後ろにsprite patternを置きますが、Full BG上のSpriteTextによってfontだけを高位へ置く必要がある場合は、通常scene用sprite patternを先に置く順序も比較してSATB手前へpackします。CD VNテンプレートのmessage font `tileBase`は`540`で、BGタイル末尾から連続して空き領域を利用します。各SLOTはscene全体でそのSLOTに登場する最大`patterns.bin`を収める専用範囲を持ち、paletteも`asset paletteBank + SLOT番号`を使います。**SLOT別最大pattern容量の合計が`0x7f00`を超える場合、またはpalette bankが予約bankへ届く場合はbuild error**です。message fontのtileBaseを必要以上に高くすると後続pattern領域を圧迫するため、現行テンプレート値を基準にし、large sheetはdedupe + build時の安全な自動配置を使います。同一 sprite sheet 内の目パチ・口パク frame 変更では pattern を再転送せず、SATB の frame 参照だけを更新します。指定SLOTを別assetへ差し替える場合は、そのSLOTの旧SATB entryだけを画面外へ退避してから専用pattern/palette範囲を書き換え、完成したSATBを反映します。VDCのsprite layer全体は無効化しないため、操作対象外SLOTの表示は維持されます。

PCE background conversion は、入力画像の各 8x8 cell を表示順の tile としてそのまま出力します（sprite と異なり dedupe しません）。VN の背景切替では絵が過度に共通タイル化されず、raw の `tiles.bin` は `width / 8 * height / 8 * 32` bytes を基準に扱われます。CD-ROM2 でも `tiles.bin` / `map_vram.bin` を raw のまま使い、`cache load bg` は tiles と map を visual RAM cache へ先読みします。実際の VRAM/BAT 反映は `background` command 実行時だけです。

VN sprite runtime は sprite asset descriptor の cell size、sheet cell 数と、SLOT順に割り当てた実 pattern base / palette bank を slot ごとのローカル描画メタへスナップショットしてSATBを組みます。palette / pattern の data ref と `cell_map` も helper 呼び出し前に退避するため、32x64 のSLOT0と16x64のSLOT1のように cell size が違う asset を連続表示しても描画メタが混ざりません。animation metadata が sheet 範囲内なら `frame_count: 1` の default でも 1 frame の表示サイズとして使い、frame size 未指定時は generator 側で sprite sheet 全体表示へ正規化します。VDC memory control は `VN_VDC_MEMORY_CONTROL` (`VDC_CYCLE_4_SLOTS | VDC_BG_SIZE_32_32`) を使い、BG size 更新時に sprite cycle bit を落とさないでください。

CD-ROM2 VN runtime では `map_vram.bin` を `mapBase` から一括転送しません。raw `map_vram.bin`（無圧縮）は `VN_MAP_WIDTH`(=32)タイル幅のソース行として読み、各行の `width_tiles` 分だけを `mapBase + command.y * 32 + command.x + row * 32` へコピーします。これにより、224px背景を256px画面へ配置したときの左右余白は blank tile のまま残り、CD上の0埋めpaddingや古いVRAM tileが縦枠として表示されません。BG 画像は 256px(32 タイル)以下にしてください（`encodePceBackground` が超過時にビルドエラー）。BG command の切替は Fade 前提で、エディタは `cut` を表示しません。`fadeOutFrames` / `fadeInFrames` は速度プリセット `10 / 20 / 30 / 40 / 50 / 60` から選び、未指定時は速度3の `30` です。保存済みの旧 `transition: "cut"` は読み込み時に `transition: "fade"` へ正規化されます。fade は BG palette bank だけを段階変更し、display layer 全体を落とさないため、下部メッセージ領域や UI palette まで暗転させません。BG の VRAM/BAT 転送と fade 完了まで次 command へ進みません。

Sprite asset は `options.animations` で VN runtime 向けの差分アニメーションを定義できます。各 entry は `id`, `name`, `frameWidth`, `frameHeight`, `firstCell`, `frameCount`, `frameDelay`, `frameDelays`, `frameStrideCells`, `loop` を持ちます。Animation Rows の `name` は任意文字列（最大48文字）として編集でき、表示名を変えても scene command が参照する `id`（`default` / `row_N`）は変えません。全ROWの編集名は `spriteEditor.rowNames` にも保存するため、無効ROWを含めて再表示できます。未指定時は sprite sheet 全体を 1 frame とする `default` animation が生成時に補われます。`firstCell` と `frameStrideCells` は、PCE 16x16/16x32/32x32 などの sprite cell を左上から数えた index です。

**各フレームの表示時間（per-frame display time）**: `frameDelay` は全フレーム共通の既定値、`frameDelays`（長さ `frameCount` の配列）は **1 フレームごとの表示フレーム数**です。値は60fps基準の `1..65535` で、`1000` は約16.67秒、`65535` は約18分12.25秒です。スプライトエディタの time フィールド（`spriteEditor.time` = `[[行0…][行1…]]` 行列、1 行 = 1 animation）から保存され、build 時に各 animation の16-bit per-frameテーブルとして `vn.c` に出力されます（`pce_vn_sprite_anim_delays_N[]`）。CD-ROM2ではプロジェクト依存で増えるテーブルを固定常駐bank128へ置かず、animation metadataと同じgenerated-data bank132へ配置し、animation tickの直前にMPR6をbank132へmapします。HuCARDではgenerated ROM dataとして配置します。`pce_vn_sprite_anim_t.frame_delays` がこのテーブルを指し、CD-ROM2 / HuCARD runtime の16-bit timerは **現在フレームの `frame_delays[frame]`** で各フレームを送ります（空セルや legacy data で `frame_delays` が無い場合は `frame_delay` にフォールバック）。`frameDelays` を持たない旧 asset でも、`spriteEditor.time` 行列があれば正規化時に per-frame 値へ移行します。time フィールドは右ペインから直接編集でき、上部の Time フィールド（ROW/Frame 選択）でセル単位の編集も可能です。

CD-ROM2 VNのlink gateはbank128/129/130/132/133の空きが256 bytes未満になると、buildを成功させたまま低headroom警告を出します。上限到達時のhard errorに先立ち、次のruntime変更で溢れる可能性をbuild logから把握できます。

CD-ROM2 VN templateはbuilder roleに`pce-visual-novel-builder`を使い、`targetMedia: "cd"`、`toolchain: "llvm-mos"`を使用します。`cd.systemCardProfile`はbuilderが固定値`"jp-v3"`へ正規化する生成契約であり、ユーザー設定ではありません。VN runtimeは`template/template_pce_vn_cd/src/pce_vn_runtime.c`を共通実体とし、build前にcurrent runtime/generated filesを同期します。CD scene pack v2は16-bit Shift-JIS、最大8192 bytesで、旧pack/font/PSG生成物を読む互換layerはありません。version 4 generation stampと必要なmanaged outputが一致する場合は通常BuildでもVN生成を省略し、`skipClean` buildでは最終mediaの入力署名も一致すればcompile/linkを省略します。System Card ROM、PSG driver bytes、抽出glyphは生成物へ含めず、ROM本体はTest Play／HTML Export時だけSetup設定から検証・使用します。

CD VNのPSG/font/IRQ契約は`docs/pce-vn-engine-redesign.md`を正とします。`PCE_CDB_USE_PSG_DRIVER(1)`、`PCE_CDB_USE_GRAPHICS_DRIVER(0)`で、generic VSync user vectorが各VBlankに`PSG_DRIVE/$E0E1`を1回呼びます。full graphics handler、HuC6280 TIMER、main-thread credit/catch-upは使用禁止です。`psg-song`はmain/BGM、`psg-sfx`はsub/SFXへコンパイルし、`(assetId, channel)`単位のpackageをbank134/135へdirect async loadします。fontは`EX_GETFNT/$E060`の12×12字形をmessage用maskまたは16×16 hardware sprite patternへon-demand変換し、許可範囲を日本版v3の非漢字領域+JIS第一水準に限定します。起動probe不一致時にfallbackを追加してはいけません。

HuCARD VN template は builder role に `pce-visual-novel-hucard-builder` を使い、`template/template_pce_vn_hucard` から `.pce` だけを生成します。Novel editor の scene JSON と scene-pack command binary layout は CD-ROM2 VN と同じですが、runtime は `template/template_pce_vn_hucard/src/pce_vn_hucard_runtime.c` と `pce-vn-hucard-manager.js` の独立実装です。`pce-cd.h`、`pce-mkcd`、overlay extraction、`cd.dataFiles`、System Card BIOS 経路は使いません。HuCARD VN の generated `src/generated/vn.h` / `vn.c` は scene pack、font mask、spritetext font、PSG pattern を `pce_editor_data_ref_t` として参照し、`pce-asset-manager.generateAssetSources({ extraDataFiles })` の同じ ROM bank allocator に流します。このため HuCARD の 127 ROM bank を超える場合は build error になります。ADPCM / CD-DA audio command、`message.voiceAssetId`、ADPCM cache command は silent no-op で、HuCARD asset output には ADPCM / CD-DA metadata を出しません。PSG は HuCARD 専用の `pce_vn_psg_assets[]` と serialized pattern data を使い、song loop、SFX one-shot、base channel、ch4/ch5 noise、blocking visual/fade work 中の cooperative tick を runtime 側で処理します。HuCARDの12x12 message fontとspritetext fontは、使用glyphの和集合をWindows System.DrawingまたはPython/Pillowへ1回だけ渡してbatch生成し、FFmpegは使用しません。VN生成スタンプは通常Buildでも再利用し、scene/assets/font/runtime入力が同じ場合はfont・scene pack・PSG pattern・`vn.h` / `vn.c`の再生成を省略します。`skipClean` 付き buildでは、さらに`out/build-stamp.json`の最終出力スタンプが一致すれば`.pce`の再リンクも省略します。Test Play は HuCARD ROM (`.pce`) を標準/外部 emulator に渡します。CD-ROM2 VN runtime/template の挙動はこの builder では変更しません。

HuCARD VN の bank layout は [docs/pce-vn-hucard-bank-layout.md](docs/pce-vn-hucard-bank-layout.md) を正とします。`rom_bank0` は起動、resident main loop、VDC state、data ref helper、小さい dispatch/metadata だけに残し、runtime worker code は `rom_bank1..4` に固定予約します。bank2 は BG/VRAM と sprite draw/SATB、bank4 は PSG と sprite state/layout/animation/move を担当します。`pce-vn-hucard-manager.js` の `HUCARD_VN_RUNTIME_ROM_BANKS` と `template/template_pce_vn_hucard/src/pce_vn_hucard_banks.h` を同じ配置に保ってください。asset/VN data は `rom_bank5..127 @ slot6` だけを使い、HuCARD VN の `extraDataFiles` は 8KB 未満でも `forceBanked` として `pce_editor_data_ref_t` にします。HuCARD VN では BG / Sprite の generated visual payload も小さい palette / map を含めて banked data ref にし、bank0 `.rodata` に直置きしません。message font は 12x12 mask、1 glyph = 24 bytes の banked ROM data で、1000 glyph でも bank0 `.rodata` には置きません。scene pack は 4096 bytes cache 上限、spritetext font は別枠 254 glyph 上限を維持し、超過は build error としてください。

### PCE VN scene schema

`assets/pce-vn-scenes.json` は v2 から `commands` を正式形式にします。旧 `backgroundAssetId` / `characters` / `messages` / `bgmAssetId` を持つ scene は読み込み時に commands へ正規化されます。

Novel > スクリプトは同じ scene document を `GUI` / `JSON` の 2 モードで編集できます。`JSON` モードは `assets/pce-vn-scenes.json` 全体を直接編集するビューで、保存・プレビュー・GUI へ戻る操作では `normalizeSceneDocument` 相当の正規化を通します。ビルド入力の正本は引き続きこの JSON で、runtime 向け scene pack / `src/generated/vn.c` は build 時に生成されます。スクリプト再生プレビューの debug panel は、変数に加えて visual RAM cache、ADPCM RAM、active scene pack の使用量見積もりを表示します。Cache 欄は runtime RAM を直接読むのではなく、preview payload に含めた generated asset metadata と command 実行順から `cache load` / `cache clear` / BG・Sprite表示時の RAM cache hit / CD fallback をシミュレートします。

```jsonc
{
  "version": 2,
  "settings": { "messageSpeedFrames": 10, "messageAdvanceMode": "button", "messageAutoWaitFrames": 60 },
  "startScene": "opening",
  "scenes": [
    {
      "id": "opening",
      "name": "chapter1/opening",
      "fullScreenBg": false,
      "nextSceneId": "",
      "commands": [
        { "type": "background", "assetId": "classroom", "transition": "fade", "fadeOutFrames": 30, "fadeInFrames": 30, "x": 2, "y": 1 },
        { "type": "sprite", "slot": 0, "assetId": "akari", "x": 128, "y": 24, "animationId": "default", "visible": true },
        { "type": "spritemove", "slot": 0, "x": 200, "y": 24, "frames": 60, "async": false, "animationAssetId": "akari", "animationId": "walk" },
        { "type": "audio", "kind": "cdda", "action": "play", "assetId": "opening_theme" },
        { "type": "variable", "variableName": "route", "operation": "define", "value": 0 },
        { "type": "audio", "kind": "psg", "action": "play", "assetId": "chime", "channel": 0 },
        { "type": "audio", "kind": "psg", "action": "stop", "target": "bgm" },
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

CD VNの`audio kind: "psg"`は`psg-song`をmain/BGM、`psg-sfx`をsub/SFXへ割り当てます。`play`の`channel`（0..5）はbuild時のpackage variant keyです。`stop`は`target: "bgm" | "sfx" | "all"`を受け、未指定は`all`です。CD command recordのPSG playはpackage indexを`asset_index`へ、stop targetを`arg0`へ格納します。HuCardでは既存step asset indexとbase channelを維持します。

CD message/choice/spritetextはlength付き16-bit Shift-JIS列です。printable ASCIIは全角JISへ正規化し、改行は`0xFFFE`、終端は`0xFFFF`です。日本版v3の非漢字領域+JIS第一水準以外はscene/command位置付きbuild errorです。CD scene pack上限は8192 bytes、HuCard上限は4096 bytesです。

`spritemove`はCD/HuCard共通commandです。`slot: 0..3`の表示中spriteを`x: 0..319`, `y: 0..223`へ`frames: 1..65535` VBlankで整数DDA移動します。`async`未指定/`false`は完了までscriptを停止し、`true`は後続を実行するため別slotを最大4枚同時に動かせます。任意の`animationAssetId`/`animationId`は移動開始時に同じassetのanimationへ切り替えます。command recordは19 bytesを維持し、durationは`arg0/arg1`、非同期は`flags bit0`、animationは`asset_index/animation_index`です。同じslotへの新しいmove/sprite、scene切替、`blank`は先行移動を中止します。Full BG sceneでもsprite表示後の`spritemove`を使用でき、未定義/asset不一致animationは位置付きbuild errorです。

scene の `name` はエディタ表示用の任意名です。`chapter1/opening` のように `/` で区切ると Novel > スクリプトの Scenes 一覧ではグループ見出しと leaf 名に分けて表示します。scene pack の生成順は `scenes` 配列順で、Scenes 一覧のドラッグ＆ドロップ並び替えはこの配列順を更新します。`Jump` / `Choice.targetSceneId` / `startScene` は `id` を参照するため、`name` を変更しても遷移先は変わりません。GUI ではヘッダの `ID` で scene `id` を変更でき、`Start` で `startScene` を選べます。`ID` 変更時は `Jump` / `Choice.targetSceneId` / `nextSceneId` / `startScene` の参照を同時に更新し、重複 ID は自動で suffix を付けて回避します。

scene の `fullScreenBg` を `true` にすると、その scene は 256x224 の全画面 BG とhardware spriteを表示するモードになります。`background` command は 256x224px の BG asset を `x: 0`, `y: 0` に置く必要があり、`message` / `choice` を含めると build error になります。`sprite` / `spritemove` / `spritetext` は使用できますが、scene入場時に前sceneから引き継いだsprite slotとSpriteText slotは消去されるため、そのscene内で表示commandを置いてください。256x224 BG は `tileBase` 次第で message/font/spritetext/sprite pattern 用 VRAM と重なるため、VN build はFull BGで使用するspritetext fontとsprite pattern予約をFull BG tile末尾より後ろへ自動配置し、SATBまでに収まらなければbuild errorにします。Full BG読み込み後はmessage/blank用VRAMをdirty扱いし、通常sceneへ戻る前または`message` / `choice`の直前に再転送します。同じBG assetを通常sceneの`background`でも使う場合は通常どおり排他予約errorです。

VN build が generated `assets.c` / runtime asset index へ出すのは、scene command から参照される BG / sprite / audio asset だけです。未使用の大きな BG や sprite は Asset 一覧には残せますが、VRAM 排他予約、runtime metadata、resident bank128 予算、scene command の index には入りません。未使用 asset を scene から参照した時点で通常のサイズ・VRAM・bank 予算チェック対象になります。

VN build では `src/generated/vn.h` / `vn.c` に `pce_vn_command_t`, `pce_vn_message_t`, `pce_vn_choice_t`, `pce_vn_switch_t`, `pce_vn_sprite_anim_t` を出力します。runtime は command を順に実行し、`message`, `choice`, `wait` command で停止します。`background.x` / `background.y` は32x32 BAT上のタイル座標で、指定した位置へBG mapを配置します。未指定時は通常 BG 向けの `(2, 1)` です。`background.transition` は互換用に `"fade"` を保存し、`fadeOutFrames` / `fadeInFrames` は `10 / 20 / 30 / 40 / 50 / 60` のプリセット値へ正規化されます。未指定時の既定値は速度3の `30` です。`sprite` command は表示・差し替え・非表示を即時反映します。旧 `durationFrames` / `moveFrames` は読み込み時に破棄され、生成には使われません。`-1` sentinel を持つ generated index field は `signed int` とし、件数を `unsigned char` で公開する scene/message/choice/switch/variable/sprite animation/command は build 時に 255 件上限を検証します。メッセージ表示領域は 17 文字 × 4 行（メッセージ窓 208x64px、タイル (3, 19) 起点、1 文字 12×12px・横 12px ピッチ・縦 16px 行ピッチ）で、`message.text` は 17 文字で自動折り返しし、4 行を超えた分は表示しません。12px 横ピッチは 8x8 タイル境界に乗らないため、runtime のグリフコンポジタが各文字を VRAM 上のメッセージ帯へ合成描画します。`speaker` がある場合は `speaker：\ntext` を 1 つの glyph stream として流し込みます。話者行（`speaker：` と改行）は message 先頭で即時表示され、typewriter 速度はその後の本文から適用されます。`text` 内の改行 (`\n`) は強制改行として扱い、build 時に `PCE_VN_GLYPH_NEWLINE`(0xfe) として encode、runtime が次の行へ送ります（フォントグリフは消費しません）。`text` を空文字にするとメッセージ領域をクリアした空ページになります（先頭メッセージのみ、未入力時にプレースホルダ文言で初期化されますが、明示的に空にすると空のまま保持します）。`message.textColor` は本文の文字色で、`#rrggbb` の hex をエディタ側で PCE 表示可能色（各チャンネル 3bit）へスナップし、build 時に 9-bit パレット word（`PCE_VN_MESSAGE_COLOR_NONE`=未指定）として scene pack の message record へ格納します。runtime は message 表示開始時に UI パレット (`VN_UI_PALETTE`=15) の前景色をその色へ書き換え、本文と話者ラベルを着色します。エディタの VN プレビューも同じ `textColor` をメッセージ描画へ反映します。未指定の message と選択肢描画時は既定の白へ戻します（このため message record は 13 byte、`PCE_VN_SCENE_PACK_MESSAGE_SIZE`。mouth slot byte は下位 2bit が slot、上位 6bit が即時表示する先頭 glyph entry 数です）。`settings.messageSpeedFrames` はノベルエンジン全体のメッセージ速度で、`0 / 10 / 20 / 30 / 40 / 50` のプリセット値へ正規化されます。`settings.messageAdvanceMode` は既定 `"button"` で、`"auto"` の場合は `settings.messageAutoWaitFrames` 経過後に次 command へ進みます。個々の `message` command の旧 `textSpeedFrames` / `advanceMode` / `autoWaitFrames` は読み込み時に破棄され、生成には使われません。`voiceAssetId` に ADPCM を指定した場合、**build 時にエディタ側が** 1 文字あたりの表示フレーム（scene pack の `text_speed_frames`）を ADPCM 実再生長に合わせて算出し、再生長が取れない場合だけ `settings.messageSpeedFrames` を fallback として焼き込みます（runtime は焼き込まれた値をフレームタイマで使い、再生長計算は行いません）。再生長は `voiceFrames = round(byteLength * 2 * 60 / 実再生レート)`、表示速度は `round(voiceFrames / 本文描画グリフ数)`。**実再生レートは公称 `sampleRate` ではなく量子化レート `32000 / (16 - code)`**（runtime の `adpcm_rate_code` と一致）を使います。**本文描画グリフ数は話者行と改行を除いた本文の発話文字数**で、runtime も改行で typewriter tick を消費せず即座に次行へ送ります（scene pack の `glyph_count` は話者行と改行込み全エントリ数で別）。

> **CD VN runtime契約**: active messageはbank123から最大68 glyphをdetachし、`EX_GETFNT`で準備したbank132 mask cacheを使うため、typewriter/ADPCM中にscene bankを参照しません。ADPCM direct path、自然終了後のno stop/reset、現在buttonを使うjoypad baseline、CD-DA BIOS APIは維持します。PSGはmain-threadでは進めず、generic VSync user IRQが各VBlankに`PSG_DRIVE`を1回呼びます。frame waitはIRQ epochだけを参照します。graphics/full VBlank handlerは使わず、VDC/SATB/compositorをruntimeが所有します。BIOS helper後はSystem Card adapterがuser vector、IRQ mask、R5、MPRを再確立します。`audio kind: "psg"`のplayはpackage index、stopは`target`でBGM/SFX/allを独立制御します。

CD `spritemove`の開始/中止はbank130、毎frame DDAはbank121 visual helper、SATB再構築はbank133 overlayへ配置します。4 slotの移動状態はconsole RAM 96 bytes以下です。複数slotのY/X/pattern/attrをVRAM側SATBへ書いた後にR13を1回armし、main loop末尾の1 VBlankだけで反映します。移動中もSystem Card VSync IRQの`PSG_DRIVE`を止めません。

Sprite animation / movement の差分更新では、既存 SATB layout の Y / X / pattern / attr word を同時に更新し、VDC write address を hidden SATB entry へ逃がしてから戻ります。これにより、移動座標をSATBへ反映しつつ、ADPCM / CD-DA BIOS helper 後の復元処理で最後の表示 sprite attr が一瞬壊れることを避けます。

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
  supportedCores: string[]; // PCE plugin は ["pc-engine"]、共有 plugin は ["*"]
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
  isUserPlugin: boolean;   // userData/plugins 由来か
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

この一覧は `plugins/*/manifest.json` を持つ現行プラグインに合わせています。`hidden: true` の項目は plugin manager から完全に除外されます。組み込みの統合 UI は、それらの renderer module を親 plugin から相対 import して利用しています。

| ID | 表示名 | types | 表示 | 主な役割 |
|---|---|---|---|---|
| `pc-engine-core` | PC Engine Core | `core` | 表示 | `pc-engine` core metadata と setup / project / build provider の入口 |
| `code-editor` | コードエディタ | `editor` | 表示 | `src/` など project 配下のファイル編集 |
| `pce-slideshow-builder` | HuCard スライドショービルダー | `build` | 表示 | HuCard slideshow template の build role |
| `pce-visual-novel-builder` | CD-ROM2 ノベルビルダー | `build` | 表示 | CD-ROM2 VN template の build role |
| `pce-visual-novel-hucard-builder` | HuCARD ノベルビルダー | `build` | 表示 | HuCARD VN template の build role |
| `pce-standard-emulator` | 標準エミュレーター (EmulatorJS) | `emulator` | 表示 | Setup 済み EmulatorJS `mednafen_pce` core で Test Play を起動 |
| `pce-external-emulator` | 外部エミュレーター | `emulator` | 表示 | Project Settings の起動パスへ生成済み ROM / CUE を渡して Test Play を起動 |
| `pce-asset-manager` | アセット管理 | `editor`, `asset` | 表示 | `assets/pce-assets.json` の BG / sprite / palette / PSG / ADPCM / CD-DA 管理 |
| `image-editor` | イメージ | `editor`, `asset` | 表示 | BG / Sprites / Palette を 1 つの Image タブに統合 |
| `sound-editor` | サウンド | `editor`, `asset` | 表示 | ADPCM / CD-DA / PSG を 1 つの Sound タブに統合 |
| `novel-editor` | ノベル | `editor`, `asset` | 表示 | VN scene 編集と font 生成を 1 つの Novel タブに統合 |
| `pce-image-converter` | 画像コンバーター | `converter` | 表示 | PNG/BMP/WebP を PCE BG / sprite 用 import pipeline へルーティング |
| `image-resize-converter` | 画像リサイズコンバーター | `converter` | 表示 | 画像の 8 dot 境界 resize / clipping |
| `image-quantize-converter` | 画像減色コンバーター | `converter` | 表示 | PCE 用 16 色減色 |
| `pce-audio-converter` | 音声コンバーター | `converter` | 表示 | WAV / MP3 の trim / rate / mono / normalize など共通音声 import UI |
| `pce-adpcm-manager` | ADPCM 管理 | `editor`, `asset` | 内部 | `sound-editor` の ADPCM タブ用モジュール |
| `pce-cdda-manager` | CD-DA 管理 | `editor`, `asset` | 内部 | `sound-editor` の CD-DA タブ用モジュール |
| `pce-music-editor` | ミュージックエディター | `editor`, `asset` | 内部 | `sound-editor` の PSG タブ用モジュール（`新規`＝効果音デザイナーで step pattern を生成 / `取込`＝PSG JSON登録またはVGM・MIDI量子化）。デザイナーの合成ロジックは `psg-sfx-synth.mjs` |
| `pce-background-manager` | 背景管理 | `editor`, `asset` | 内部 | `image-editor` の BG タブ用モジュール |
| `pce-sprite-manager` | スプライト管理 | `editor`, `asset` | 内部 | `image-editor` の Sprites タブ用モジュール |
| `pce-palette-editor` | パレットエディター | `editor`, `asset` | 内部 | `image-editor` の Palette タブ用モジュール |
| `pce-visual-novel-editor` | ビジュアルノベル | `editor`, `asset` | 内部 | `novel-editor` の VN タブ用モジュール |
| `pce-font-editor` | フォント | `editor`, `asset` | 内部 | `novel-editor` の Font タブ用モジュール |

### PCE アセット系

`pce-asset-manager` は `assets/pce-assets.json` v2 を正とする標準アセット管理です。BG image / Sprite sheet / Palette / PSG song/SFX / ADPCM / CD-DA track を扱います。画像の追加は `pce-image-converter` の `image-import-pipeline` を経由し、内蔵 PCE 変換で BG tile / BAT map / sprite pattern 形式の generated asset を作成します。音声の追加は `pce-audio-converter` の共通音声 UI を経由し、project-local WAV を生成してから ADPCM / CD-DA へ登録します。

`image-editor` は BG / Sprites / Palette の画像画面を 1 つの sidebar タブに統合します。画面上部のタブで `BG`、`Sprites`、`Palette` を切り替えます。`pce-background-manager` / `pce-sprite-manager` / `pce-palette-editor` は親 plugin から直接 import される内部 renderer module です。BG / sprite の生成物は内蔵 PCE 変換を使います。BG 追加 UI では出力幅/高さだけを指定し、`paletteBank` / `transparentIndex` は `0` 固定です。Sprites 追加 UI では通常表示を出力幅/高さに絞り、変換時だけ有効な `Cell size` は `アドバンス` に隠します。`paletteBank: 0`、`tileBase: 704`、`x: 144`、`y: 104`、`transparentIndex: 0`、初期 animation `16x16` / `1 frame` / `1 frame delay` で登録します。BG の一覧と詳細 preview の境界はドラッグで幅調整でき、preview はホイールで拡大縮小し、中央ボタンドラッグで表示位置を動かせます。BG の一覧は `Name` と `ID` を別列にし、各列ヘッダーで昇順/降順ソートできます。Image 配下の asset 一覧では `Name` に `folder/item` のような `/` 区切りを使うと、エディタ上ではグループ見出しと leaf 名に分けて表示します。Sprites タブは左に sprite asset tree、中央に frame preview / sprite sheet / Animation Rows、右に properties を表示します。PCE では `assets/pce-assets.json` の sprite asset を正とし、frame size、ROW ごとの有効 frame 数、time、collision などの編集結果は `options.animations` と `options.spriteEditor` metadata へ保存します。

### Sound / Novel 統合 UI

`sound-editor`はADPCM / CD-DA / PSGを1つのsidebarタブに統合します。PSGタブのstep編集、`*.psg.json`/VGM/VGZ/MIDI取込、SFXデザイナー、WebAudio previewは共通source形式を維持します。PSG JSONの正式入力は`version: 2`かつ`assets`が1件だけの文書で、typeは`psg-song`または`psg-sfx`です。BPM 30–300、steps 1–4096、pattern最大2048 events、channel 0–5、period 1–4095、event volume 0–31、wave 0–45を厳格検査し、noiseはch4/5だけを許可します。同一step/channel、曲長以上のstep、範囲外値は切り詰めずerrorです。取込元は`assets/psg/<id>.psg.json`へ元のbytesのまま保存し、MIDI/VGMの`quantizerVersion`を付けないため再量子化されません。同一IDの登録には取込画面またはAPIの明示的な置換確認が必要です。HuCard buildは既存`pce_editor_psg_step_t`/banked patternを使い、optionalな`wave`は無視します。CD VN buildだけは`pce-system-card-psg.js`でmain/sub track bytecodeへ変換し、旧PSG C struct/catalog record/`assets/generated/psg/<id>.bin`を出しません。実際に参照された`(assetId, channel)` variantを`assets/generated/vn/system-card-psg/`へ生成し、BGMはbank134最大8156 bytes、SFXはbank135最大8192 bytesです。duration split/tie、loop/end、period+detune、発音ごとのSystem Card `WAVE`（内蔵0..44/user 45）、ch4/ch5 mode-2 noiseをcompileし、表現不能値と容量超過は位置付きerrorにします。user waveformは45の32-byte squareだけを登録し、外部envelope/FMは使いません。

Sound > ADPCM の詳細フォームと取込ダイアログは、通常編集する ID / Name / Sample rate / Loop / Split だけを表示します。新規取り込みの標準 sample rate は 8000Hz です。Streaming 再生指定は削除済みです。低レベルの `adpcmAddress` と `divider` は UI には出さず、address は既定値、divider は `sampleRate` からの自動値を使います。

`novel-editor`はscript scene編集、システム設定、font管理を1つのsidebarタブに統合します。scene budgetは`project.json`を読み、CD=8192 bytes/16-bit Shift-JIS、HuCard=4096 bytes/glyph index streamで見積ります。CD VNはSystem Card `EX_GETFNT`を正とし、FontタブのTTF/OTF設定をゲーム生成物へ反映しません。CDで第二水準、CP932拡張、半角カナ、絵文字、結合文字を保存してもbuild時に位置付きerrorになります。HuCardのbanked font生成は維持します。

### Test Play

`pce-standard-emulator`は`pce-setup-manager`が検出したEmulatorJS runtimeと`mednafen_pce` coreを使います。browser側のframe schedulingとcore内VSyncの二重同期で約30fpsへ段落ちしないよう、`EJS_defaultOptions`は`webgl2Enabled: enabled`、`vsync: disabled`を既定にします。CD VN Test Playはprojectの`cd.systemCardProfile: "jp-v3"`とユーザー所有System Card ROMのversion/profileを検証してから起動します。不一致時は起動しません。System Card / IPLはリポジトリやゲーム生成物へ同梱しません。描画/IRQ調査はGeargrafx MCPを優先します。

`pce-external-emulator`は`testplay` roleの代替pluginです。標準Test Playと同じ`jp-v3` profile検証host APIを通過したCD VNだけを外部起動します。Project Settingsのexecutable/args、macOS `.app`解決、ROM placeholder規則は従来どおりです。

Super CD-ROM2 / ADPCM の挙動確認では、標準 EmulatorJS/WASM だけを正としないでください。標準 WASM の `mednafen_pce-wasm.data` だけ ADPCM 再生後の message advance が止まり、Geargrafx / 外部エミュレーターでは進むケースがあります。再生開始後に次 command へ進んでも、非loop buffered ADPCM の自然終了時に CPU が止まる場合があるため、ADPCMあり/なしの最小 scene で完了後の next message まで確認します。詳細な切り分け手順は `docs/pce-testplay-debugging.md` に残しています。

---

## 14. 開発の流れ (チュートリアル)

### 現行 plugin 開発者が必ず行うこと

1. `manifest.json` に `types`、`supportedCores`、`permissions`、必要な `roles`、`hooks`、`renderer.capabilities` を宣言する。
2. Build / Test Play の単一選択 plugin は `roles` を宣言し、プロジェクト側は `project.json.pluginRoles` に plugin ID を保存する。
3. PCE 専用 plugin は `supportedCores: ["pc-engine"]`、ハードウェア非依存 plugin は `["*"]` を宣言する。
4. UI、modal、preview、converter 連携は plugin の `renderer.js` で実装し、本体 HTML / renderer / main / preload へ個別追記しない。
5. main process の処理が必要な場合は `hooks` と `mainApi.hooks` に同じ hook 名を宣言し、renderer から `api.plugins.invokeHook()` で呼ぶ。
6. asset 登録拡張は `asset-type-provider` / `asset-import-handler` / `image-import-pipeline` capability として提供する。
7. 新しい plugin で本体修正が必要に見えた場合は、まず汎用 API または core provider の不足として扱い、plugin 固有分岐を本体へ追加しない。
8. renderer 側の入力 UI は `window.prompt()` / `alert()` ではなく、`api.createModal()` で plugin-owned modal として実装する。
9. PCE asset は `api.assets.*` を通じて `assets/pce-assets.json` に保存し、asset `id` の重複を登録前・build 前に検査する。
10. ユーザーに見える機能追加、plugin role/API、project 設定、既知制約を変えた場合は、実装と同じ変更で `docs/user-guide.md`、`PLUGIN.md`、関連する `docs/` を更新する。
11. Build plugin は PCE build の通知・テンプレート同期に留め、compile/link/CD bundle の本体処理は `pce-build-system.js` に集約する。
12. アセット参照を持つ editor plugin は、画面を開いた時点または sidebar で再アクティブになった時点で `api.assets.listPceAssets({ force: true })` を使い、一覧・select・preview を最新化する。
13. 選択中アセットに未保存変更がある状態で別アセット選択・新規追加・import を行う場合は、保存 / 破棄 / キャンセルを選べる plugin-owned modal を出し、暗黙に編集内容を捨てない。

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
// ❌ 現行 loader では無効
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

Image / Sprite / Sound / Novel のような editor plugin は、画面表示時と sidebar で再アクティブになった時点で `api.assets.listPceAssets({ force: true })` または対応する project data を再読込してください。別 plugin で追加・削除された asset を古い一覧のまま編集すると、preview や保存先が実体とずれます。

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

現行 PCE asset の正本は `assets/pce-assets.json` です。plugin UI では物理ファイル名、ユーザー向け `name`、参照用 `id` を混同しないでください。runtime や scene command が参照するのは `id` です。

アセット登録の基本フロー:

1. ファイルを選択する
2. converter を起動する前に ID / Name 入力 modal を出す
3. ID を project 内で一意な安全な識別子へ正規化する
4. `api.assets.listPceAssets({ force: true })` で既存 ID と重複していないか確認する
5. `api.assets.importPceImage()` / `importPceAudio()` / `importPceVgm()` / `importPceMidi()` の対応 API へ渡す
6. 成功後は共有ストアが発行する `assets:pce:changed` を受けて一覧・preview・validation を更新する

`window.prompt()` / `alert()` は Electron の埋め込み renderer で期待通り動かないことがあるため、plugin UI では `api.createModal()` を使います。

### 画像 import pipeline と保存形式

画像アセットを登録する plugin は、変換結果の `dataUrl` だけでなく保存形式も明示してください。`image-import-pipeline.convertToIndexed16()` のような capability が `{ convertedDataUrl, targetExtension }` を返す場合、呼び出し側は `targetFileName` の拡張子を `targetExtension` に合わせます。これを怠ると、中身と拡張子がずれ、preview / PCE 変換 / palette 表示のどこかで原因が分かりにくい不具合になります。

```js
const converted = await imagePipeline.convertToIndexed16({ sourcePath, targetSize });
const result = await api.assets.importPceImage({
  id: symbol,
  name: displayName,
  sourceFileName: `${symbol}${converted.targetExtension || '.png'}`,
  convertedDataUrl: converted.convertedDataUrl,
  kind: 'background',
});
```

画像変換後は `convertedDataUrl` と実際の形式に一致する `sourceFileName` を `importPceImage()` へ渡します。PCE asset managerがproject内への保存、hardware形式への変換、`assets/pce-assets.json` の更新を一括して行います。

標準アセット登録画面とゲーム固有エディタの登録 UI の両方が同じ `image-import-pipeline` を使う可能性があります。片方だけ直すと、もう片方に古い PNG 変換や拡張子固定の経路が残ります。画像 import の仕様を変えたら、標準登録経路と plugin 固有登録経路の両方で `convertedDataUrl` / `targetExtension` / `targetFileName` の扱いを確認してください。

### アセット一覧と保存ガード

Image / Sprite / Sound / Novel のような editor plugin は、画面を開いた時点で PCE asset store や編集元ファイルを再読込し、一覧・filter・select・preview を最新状態にします。ユーザーが手動で押す「更新」ボタンだけを同期手段にすると、別 plugin で追加・削除されたアセットを古い状態のまま編集してしまいます。

選択中アセットに未保存変更がある場合、別アセット選択・新規追加・import・reload で内容が消えないように、保存 / 破棄 / キャンセルを選べる modal を出してください。`window.confirm()` ではなく `api.createModal()` を使い、保存を選んだ場合は現在の asset を保存してから次の操作へ進めます。

### SPRITE editor / preview の注意

PCE sprite asset は単なる画像ファイルではなく、`data.options.animations`、`spriteEditor`、cell size、collision などを含む定義です。preview ではスプライトシート全体を cover 表示せず、定義された frame size と ROW ごとの animation を使って再生確認できるようにします。canvas 描画では `imageSmoothingEnabled = false` を指定し、pixel art をぼかさないでください。

ROW ごとの名前は `spriteEditor.rowNames` と `options.animations[].name`、有効フレーム数とTimeは `spriteEditor.time` 行列と `options.animations[]` に保存します。現行 runtime が直接使う値は `animations[].frameDelays` です。UI 編集後は両者を同期し、preview も各 frame の16-bit delayを使います。

Sprite Sheet には cell grid、選択 frame、無効 frame の overlay、各 frame の time 値を重ねて表示します。シートクリックは ROW / frame 選択だけを行い、自動再生は開始しません。Frame Preview / Sprite Sheet の canvas は preview 領域内でスクロールでき、中央ボタンドラッグでも scroll 位置を移動できます。倍率入力は 10-500% の percentage として扱い、mouse wheel で滑らかに変化させます。import が受理する cell size は manifest/UI にある `16x16`、`16x32`、`16x64`、`32x16`、`32x32`、`32x64` です。最終的な pattern VRAM / SATB 境界は build 時に検査されます。

Asset Manager の右列 preview でも SPRITE はシートそのものではなく、選択 ROW の animation を表示します。再生 / 停止は icon button にし、animation select の表示は `1 (4 frames)` のように簡潔にします。

### BMP / PNG palette の扱い

PCE 用 indexed 画像を単に canvas へ描いて `canvas.toDataURL('image/png')` すると indexed palette が失われ、実際に使われている色だけで RGBA PNG へ再構成されます。未使用 palette、特に BMP の palette index 0 を保持したい場合、この経路を通してはいけません。

安全な方針:

- indexed PNG は `PLTE` / `tRNS` / `IDAT` を直接読んで palette と index を扱う
- indexed BMP は BMP ヘッダー、カラーテーブル、ピクセル index を直接読む
- BMP を PNG 化する場合は、BMP の index 0 を PNG palette index 0 に固定する
- 8bit BMP のようにカラーテーブルが256色でも、実使用 index が16色以内なら、使用 index だけを16色以内に remap して indexed PNG として保存できる
- sprite の透明色を除く実使用色が15色以内なら、RGB各色を個別に3bitへ丸めて重複させない。元色と512個のVCE色の最小誤差割当を行い、実使用色へ互いに異なるVCE color wordを割り当てる。近接した灰色などはわずかな色ずれを許して階調を維持する
- このsprite色割当を変更した場合は `data.generated.spriteColorConverterVersion` を上げ、`ensureVisualGeneratedAssets()` が既存の `palette.bin` / `patterns.bin` をbuild時に再生成できるようにする
- 変換後に palette preview を見るだけでなく、保存されたファイルを再読込して `PLTE` / BMP カラーテーブルを確認する

リサイズやクリッピングを実施した場合は canvas 経由を避けられないことがあります。その場合でも、元画像が indexed PNG / BMP なら元 palette を参照 palette として保持し、最終的に自前の indexed PNG encoder で保存してください。`imageDataToIndexedPng()` のように実ピクセルから palette を作り直す関数は、未使用 palette を落とすため「最適化してよい画像」にだけ使います。

### 画像・音声 preview

- 画像 thumbnail は「画像全体が見える」「アスペクト比を維持する」「領域内で最大化する」を満たす
- 一覧 thumbnail は `background-size: contain` か同等の処理を使う
- `cover` 相当の表示や `width:100%; height:100%` による引き伸ばしは禁止
- 小さい sprite も拡大表示する。`img` の `max-width/max-height` だけでは元サイズのまま小さく見える場合がある
- WAV preview は再生/停止の icon button にし、一覧では `HTMLAudioElement` の metadata などから再生長を表示すると確認しやすい
- 画像アセットでは、実画像から使用色を抽出し palette swatch として表示すると、PCE の 16 色 palette 制約を確認しやすい

### 複数 C ファイルを持つ build plugin

PCE build は `pce-build-system.js` が template と target media に応じて compile 対象を決めます。`onBuildStart()` の `makeVariables` / `SRC_C` は PCE build では反映されません。複数 C ファイルを追加する builder は、現行 template と `pce-build-system.js` の source collection を更新し、同じ変更で build test と関連ドキュメントを追加してください。

### テストと確認

- plugin manager / renderer metadata / hook / build option の回帰は `pce-game-editor/tests/*.test.js` に追加する
- Windows では `node --test tests/**/*.test.js` より `node tests/run-tests.js` が安定する
- 変更後は `node --check <変更した .js>` と `cd pce-game-editor && node tests/run-tests.js` を実行する
- Build plugin を変更した場合は、対象 template で HuCard または CD-ROM2 build を通し、生成 `.pce` / `.cue` と build log を確認する
- パッケージ済みアプリで確認する場合は、source tree の `pce-game-editor/plugins` と packaged tree の `resources/plugins` が同期しているか確認する

---

## 17. AI Control API

AI Control API の詳細は [AI_CONTROL.md](AI_CONTROL.md) を参照してください。

- Editor 内の `AI Control` タブで明示的に起動した場合のみ `127.0.0.1` に公開する
- REST と MCP は同じ tool registry を使い、`editor_status` / `asset_add` / `build_run` などの tool 名と引数を共有する
- project state を変更する tool は `dryRun: true` または `confirm: true` が必要
- MCP stdio sidecar は `scripts/pce-game-editor-mcp.js` で、`PCE_EDITOR_CONTROL_URL` と `PCE_EDITOR_CONTROL_TOKEN` を環境変数から読む
- stdout には MCP JSON-RPC メッセージだけを出し、診断ログは stderr に出す
